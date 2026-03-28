/**
 * QUALITY PIPELINE — Pipeline unificata di qualità ricette
 * 
 * Architettura a 4 Layer (standard industria 2026):
 *   Layer 1: SCHEMA VALIDATION — checks deterministici sul JSON
 *   Layer 2: WEB GROUNDING    — fonti reali come contesto (opzionale)
 *   Layer 3: DUAL-LLM REVIEW  — Claude verifica + Gemini contesta
 *   Layer 4: SCORE & REPORT   — score composito + markdown report
 * 
 * Sostituisce verify.js (solo AI) + validator.js (solo web).
 * Toggle grounding: default OFF (veloce), ON per analisi profonda.
 */
import { callClaude, callGemini, parseClaudeJson } from './utils/api.js';
import { log } from './utils/logger.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, basename } from 'path';
import { createHash } from 'crypto';

// ── Riuso utility da validator.js per il web grounding ──
import { searchRealSources, scrapeRecipePage } from './validator.js';

// ══════════════════════════════════════════════════════════════════════
// LAYER 1: SCHEMA VALIDATION (deterministico, istantaneo)
// ══════════════════════════════════════════════════════════════════════

const REQUIRED_FIELDS = ['title', 'category', 'hydration'];
const REQUIRED_STEP_KEYS = ['stepsSpiral', 'stepsHand', 'stepsExtruder', 'stepsCondiment'];

/**
 * Validazione deterministica dello schema JSON della ricetta.
 * Non usa AI — è puro controllo strutturale.
 */
function validateSchema(recipe, filePath) {
    const errors = [];
    const warnings = [];

    // Campi obbligatori
    for (const field of REQUIRED_FIELDS) {
        if (!recipe[field] && recipe[field] !== 0) {
            errors.push(`Campo obbligatorio mancante: "${field}"`);
        }
    }

    // Ingredienti: deve avere ingredientGroups O ingredients
    const hasGroups = recipe.ingredientGroups?.length > 0;
    const hasFlat = recipe.ingredients?.length > 0;
    if (!hasGroups && !hasFlat) {
        errors.push('Nessun ingrediente trovato (né ingredientGroups né ingredients)');
    }
    if (hasFlat && !hasGroups) {
        warnings.push('Usa formato flat "ingredients" — migrare a "ingredientGroups"');
    }

    // Validazione ingredientGroups
    if (hasGroups) {
        let totalGrams = 0;
        for (const group of recipe.ingredientGroups) {
            if (!group.group) warnings.push('ingredientGroup senza nome di gruppo');
            if (!group.items?.length) errors.push(`Gruppo "${group.group || '?'}" senza ingredienti`);
            for (const item of (group.items || [])) {
                if (!item.name) errors.push(`Ingrediente senza nome nel gruppo "${group.group}"`);
                if (item.grams != null) totalGrams += item.grams;
            }
        }
        if (totalGrams === 0) warnings.push('Nessun ingrediente con grammi definiti');
    }

    // Almeno un tipo di step
    const hasSteps = REQUIRED_STEP_KEYS.some(k => recipe[k]?.length > 0);
    if (!hasSteps) {
        errors.push('Nessun procedimento trovato (stepsSpiral/stepsHand/stepsExtruder/stepsCondiment)');
    }

    // Hydration range check
    const h = parseFloat(recipe.hydration);
    if (!isNaN(h)) {
        if (h < 25 || h > 100) warnings.push(`Idratazione ${h}% fuori range tipico (25-100%)`);
    }

    // Cottura: pane/pizza/focaccia devono avere bakingSection o cookingSection
    const needsBaking = ['Pane', 'Pizza', 'Focaccia'].includes(recipe.category);
    if (needsBaking && !recipe.bakingSection && !recipe.cookingSection) {
        warnings.push(`Categoria "${recipe.category}" senza sezione cottura (bakingSection/cookingSection)`);
    }

    // Metadata qualità
    if (!recipe.description) warnings.push('Manca la descrizione della ricetta');
    if (!recipe.fermentation && needsBaking) warnings.push('Manca il campo "fermentation" (tempi lievitazione)');

    return {
        pass: errors.length === 0,
        errors,
        warnings,
        score: errors.length === 0 ? 100 : Math.max(0, 100 - errors.length * 20),
    };
}

// ══════════════════════════════════════════════════════════════════════
// LAYER 2: WEB GROUNDING (opzionale, ~30s)
// ══════════════════════════════════════════════════════════════════════

/**
 * Cerca fonti web reali e le formatta come contesto per il Layer 3.
 * Ridotto a 2 query SerpAPI (1 IT + 1 EN) per contenere i costi.
 */
async function fetchGroundingContext(recipeName) {
    try {
        log.info('   🌐 Layer 2: Cerco fonti reali...');
        const sources = await searchRealSources(recipeName);
        log.info(`   🌐 Trovate ${sources.length} fonti, scraping top 4...`);

        const scrapedData = [];
        for (const source of sources.slice(0, 4)) {
            try {
                const data = await scrapeRecipePage(source.url);
                if (data?.ingredients?.length > 0) {
                    scrapedData.push({ ...data, domain: source.domain });
                }
            } catch { /* skip broken sources */ }
            await new Promise(r => setTimeout(r, 300));
        }

        if (scrapedData.length === 0) {
            log.warn('   🌐 Nessuna fonte con dati utili trovata');
            return null;
        }

        // Formatta come contesto testuale per Claude
        let context = '\n\n══════ FONTI WEB REALI (per cross-check) ══════\n';
        for (const [i, src] of scrapedData.entries()) {
            context += `\n── FONTE ${i + 1}: ${src.domain} ──\n`;
            if (src.name) context += `   Nome: ${src.name}\n`;
            if (src.ingredients?.length > 0) {
                context += `   Ingredienti:\n`;
                src.ingredients.forEach(ing => { context += `   - ${ing}\n`; });
            }
            if (src.prepTime) context += `   Tempo: ${src.prepTime}\n`;
            if (src.servings) context += `   Porzioni: ${src.servings}\n`;
        }

        log.info(`   🌐 ${scrapedData.length} fonti con dati utili`);
        return {
            text: context,
            sourcesCount: scrapedData.length,
            sources: scrapedData.map(s => ({ domain: s.domain, ingredients: s.ingredients?.length || 0 })),
        };
    } catch (err) {
        log.warn(`   🌐 Grounding fallito: ${err.message}`);
        return null;
    }
}

// ══════════════════════════════════════════════════════════════════════
// LAYER 3: DUAL-LLM REVIEW (Claude + Gemini, ~15s)
// ══════════════════════════════════════════════════════════════════════

const VERIFY_SYSTEM = `Sei un esperto tecnologo alimentare, panificatore e pastaio italiano con 30 anni di esperienza.
Il tuo compito è VERIFICARE la correttezza di ricette, trovando errori e suggerendo miglioramenti.

⚠️ REGOLA FONDAMENTALE — ANTI-ALLUCINAZIONE:
Prima di segnalare QUALSIASI problema, DEVI cercare nel testo della ricetta la prova.
- Se il testo contiene già l'informazione (temperatura forno, uso ingrediente, ecc.), NON segnalare come mancante.
- Leggi TUTTO il testo: procedimento, sezione COTTURA, ALERT e PRO TIPS. Le informazioni possono essere ovunque.
- NON inventare problemi che non esistono. Ogni issue DEVE essere supportata da evidenza testuale.
- Segnala SOLO problemi REALI e VERIFICATI nel testo fornito.

CRITERI DI VERIFICA:

1. DOSI E PROPORZIONI:
   - Idratazione: verifica che sia realistica per il tipo di prodotto
   - % lievito: pane (0.1-3% su farina), pizza (0.5-3%), lievitati (3-15% lievito di birra)
   - Rapporti farina/acqua coerenti con la tradizione
   - Sale: 1.8-3% su farina per pane (la legge francese limita a 1.4%, in Italia 2-2.5% è standard), 2.5-3% per pizza
   - Poolish: idratazione 100% è CORRETTO per definizione (rapporto 1:1 farina:acqua)

2. TEMPERATURE:
   - Forno casalingo: max 280°C (mai suggerire temperature superiori)
   - Pane casalingo: 220-250°C tipico
   - Pizza in forno casalingo: 250-280°C con pietra refrattaria
   - ATTENZIONE: controlla la sezione COTTURA prima di segnalare temperature mancanti!

3. TEMPI:
   - Verifica coerenza tra lievitazione e tipo/quantità di lievito
   - Cottura pane: 25-50 min tipico
   - Cottura pizza casalinga: 5-12 min con pietra
   - ATTENZIONE: controlla la sezione COTTURA prima di segnalare tempi mancanti!

4. SETUP:
   - Il campo SETUP indica i metodi disponibili (Impastatrice a spirale, A mano, Estrusore)
   - PANE/PIZZA con "Impastatrice a spirale" + "A mano" = ✅ CORRETTO
   - PASTA con "Impastatrice a spirale" = ❌ ERRORE (pasta usa estrusore, non spirale)
   - NON segnalare come errore la nomenclatura del setup (spirale = impastatrice a spirale)

5. COERENZA INGREDIENTI ↔ PROCEDIMENTO:
   - Cerca ogni ingrediente nel TESTO COMPLETO del procedimento prima di segnalare come mancante
   - Cerca varianti del nome (es. "malto d'orzo" potrebbe essere citato come "malto")

6. GRUPPI INGREDIENTI:
   - I raggruppamenti sono logici?
   - Ogni ingrediente è nel gruppo giusto?

RISPONDI con un JSON valido (NO markdown fences):
{
  "score": 85,
  "verdict": "🟢 Buona|🟡 Da migliorare|🔴 Problematica",
  "issues": [
    {"severity": "❌|⚠️|💡", "area": "Dosi|Temperature|Tempi|Setup|Coerenza|Gruppi", "message": "Problema", "fix": "Correzione"}
  ],
  "summary": "Riepilogo 2-3 righe sulla qualità complessiva"
}`;

const GEMINI_CHALLENGE_SYSTEM = `Sei un revisore critico indipendente — un secondo parere esperto.
Hai ricevuto:
1. Una RICETTA originale
2. Il VERDETTO DI UN ALTRO AI (Claude) che l'ha già verificata

Il tuo compito è METTERE IN DISCUSSIONE il verdetto, NON ripeterlo passivamente.

COSA DEVI FARE:
- CONFERMA i problemi reali trovati dall'altro AI
- CONTESTA le segnalazioni sbagliate o troppo punitive ("falsi positivi")
- AGGIUNGI problemi che l'altro AI ha MANCATO
- VALUTA se lo score è giusto, troppo alto o troppo basso

ATTENZIONE:
- NON essere pignolo senza motivo — segnala solo problemi REALI
- Se il verdetto è corretto, dillo chiaramente

RISPONDI con un JSON valido (NO markdown fences):
{
  "agreement": "🟢 Confermo il verdetto|🟡 Parziale disaccordo|🔴 Forte disaccordo",
  "scoreAdjustment": 0,
  "challengedIssues": [
    {"originalIssue": "Rif. problema Claude", "verdict": "✅ Confermo|❌ Falso positivo|⚠️ Parziale", "reason": "Spiegazione"}
  ],
  "missedIssues": [
    {"severity": "❌|⚠️|💡", "area": "Area", "message": "Problema", "fix": "Correzione"}
  ],
  "summary": "Giudizio revisore (2-3 righe)"
}`;

/**
 * Estrae il contenuto leggibile dal JSON per passarlo agli LLM
 */
function buildRecipePrompt(recipe) {
    // Ingredienti con gruppi
    const ingredients = [];
    if (recipe.ingredientGroups?.length > 0) {
        for (const group of recipe.ingredientGroups) {
            ingredients.push(`── ${group.group} ──`);
            for (const item of group.items) {
                const parts = [item.name];
                if (item.note) parts.push(`(${item.note})`);
                if (item.grams != null) parts.push(`${item.grams}g`);
                ingredients.push('  ' + parts.join(' '));
            }
        }
    } else if (recipe.ingredients?.length > 0) {
        for (const item of recipe.ingredients) {
            const parts = [item.name];
            if (item.note) parts.push(`(${item.note})`);
            if (item.grams != null) parts.push(`${item.grams}g`);
            ingredients.push(parts.join(' '));
        }
    }

    // Sospensioni
    const suspensions = (recipe.suspensions || []).map(s => {
        const parts = [s.name];
        if (s.note) parts.push(`(${s.note})`);
        if (s.grams != null) parts.push(`${s.grams}g`);
        return parts.join(' ');
    });

    // Steps: invia solo il setup PRIMARIO per evitare diluzione attenzione
    // Priorità: spirale > estrusore > mano > condiment
    const steps = [];
    const primaryKey = ['stepsSpiral', 'stepsExtruder', 'stepsHand', 'stepsCondiment']
        .find(k => recipe[k]?.length > 0);
    if (primaryKey && recipe[primaryKey]?.length > 0) {
        for (const step of recipe[primaryKey]) {
            const stepText = step.text || step.detail || '';
            steps.push(`${step.title}${stepText ? `: ${stepText}` : ''}`);
        }
    }

    // Setup detect (labels allineate al system prompt)
    const setups = [];
    if (recipe.stepsSpiral?.length) setups.push('Impastatrice a spirale');
    if (recipe.stepsHand?.length) setups.push('A mano');
    if (recipe.stepsExtruder?.length) setups.push('Estrusore con trafila');

    // Sezione cottura
    const baking = recipe.baking || recipe.bakingSection || recipe.cookingSection;
    let bakingText = '';
    if (baking) {
        bakingText = `\nCOTTURA:
- Temperatura: ${baking.temperature || 'N/A'}
- Tempo: ${baking.time || 'N/A'}
${baking.tips?.length > 0 ? `- Suggerimenti:\n${baking.tips.map(t => `  • ${t}`).join('\n')}` : ''}`;
    }

    return `TITOLO: ${recipe.title}
CATEGORIA: ${recipe.category}
IDRATAZIONE: ${recipe.hydration}%
TEMPERATURA TARGET: ${recipe.targetTemp || 'N/A'}
LIEVITAZIONE: ${recipe.fermentation || 'N/A'}
SETUP: ${setups.join(' + ') || 'N/A'}

INGREDIENTI:
${ingredients.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}

${suspensions.length > 0 ? `SOSPENSIONI:\n${suspensions.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''}

PROCEDIMENTO:
${steps.map((s, idx) => `${idx + 1}. ${s}`).join('\n')}
${bakingText}
${recipe.alert ? `\nALERT: ${recipe.alert}` : ''}
${recipe.proTips?.length > 0 ? `\nPRO TIPS:\n${recipe.proTips.map(t => `- ${t}`).join('\n')}` : ''}`;
}

/**
 * Claude verifica + Gemini contesta (singolo passaggio, anti-loop)
 */
async function dualLlmReview(recipePrompt, groundingContext) {
    // Se ci sono fonti web, aggiungi una direttiva esplicita
    const groundingDirective = groundingContext
        ? `\n\nHai anche accesso a FONTI WEB REALI per cross-check. Confronta ingredienti e proporzioni della ricetta con le fonti. Segnala discrepanze significative come issues.`
        : '';
    const fullPrompt = `Verifica questa ricetta:\n\n${recipePrompt}${groundingContext?.text || ''}${groundingDirective}\n\nVerifica dosi, temperature, tempi, setup, coerenza ingredienti↔procedimento.`;

    // ── Claude ──
    log.info('   🔵 Layer 3: Claude sta verificando...');
    const claudeText = await callClaude({
        model: 'claude-sonnet-4-20250514',
        maxTokens: 3000,
        system: VERIFY_SYSTEM,
        messages: [{ role: 'user', content: fullPrompt }],
    });
    const claude = parseClaudeJson(claudeText);
    log.info(`   🔵 Claude: ${claude.score}/100 — ${claude.verdict}`);

    // ── Gemini Challenge ──
    let gemini = null;
    if (process.env.GEMINI_API_KEY) {
        try {
            log.info('   🔴 Layer 3: Gemini sta contestando...');
            const geminiPrompt = `RICETTA:\n${recipePrompt}\n\n══════════════════════════════════════\nVERDETTO CLAUDE:\n${JSON.stringify(claude, null, 2)}\n══════════════════════════════════════\n\nAnalizza CRITICAMENTE il verdetto.`;

            const geminiText = await callGemini({
                model: 'gemini-3.1-pro-preview',
                maxTokens: 4096,
                system: GEMINI_CHALLENGE_SYSTEM,
                messages: [{ role: 'user', content: geminiPrompt }],
            });
            gemini = parseClaudeJson(geminiText);
            log.info(`   🔴 Gemini: ${gemini.agreement}`);
        } catch (err) {
            log.warn(`   ⚠️ Gemini challenge fallito: ${err.message}`);
        }
    } else {
        log.debug('   ⏭️ GEMINI_API_KEY non configurata, skip challenge');
    }

    return { claude, gemini };
}

// ══════════════════════════════════════════════════════════════════════
// LAYER 4: SCORE COMPOSITO & REPORT
// ══════════════════════════════════════════════════════════════════════

/**
 * Calcola score finale composito:
 * - Schema (20%) + AI Claude (60%) + Gemini adjustment (20%)
 * Se grounding attivo, bonus/malus basato su conferma fonti
 */
function computeFinalScore(schema, claude, gemini, grounding) {
    // Base: Claude score pesato
    let score = claude.score;

    // Gemini adjustment
    if (gemini?.scoreAdjustment) {
        score = Math.max(0, Math.min(100, score + gemini.scoreAdjustment));
    }

    // Schema penalty: se ci sono errori strutturali, penalizza
    if (!schema.pass) {
        score = Math.min(score, 60); // Cap a 60 se schema rotto
    }

    return Math.round(score);
}

/**
 * Merge issues da Claude + Gemini in lista unificata
 */
function mergeIssues(claude, gemini) {
    const issues = [...(claude.issues || [])];

    // Aggiungi issues mancanti trovate solo da Gemini
    if (gemini?.missedIssues?.length > 0) {
        for (const mi of gemini.missedIssues) {
            issues.push({ ...mi, source: '🔴 Gemini' });
        }
    }

    return issues;
}

/**
 * Genera report markdown unificato
 */
function generateQualityReport(recipe, schema, claude, gemini, grounding, finalScore) {
    const emoji = finalScore >= 80 ? '🟢' : finalScore >= 60 ? '🟡' : '🔴';
    const issues = mergeIssues(claude, gemini);

    let report = `# Qualità: ${recipe.title}\n\n`;
    report += `## ${emoji} Score Finale: ${finalScore}/100\n\n`;

    // Score breakdown
    report += `| Layer | Score | Dettaglio |\n|---|---|---|\n`;
    report += `| Schema | ${schema.pass ? '✅ Pass' : '❌ Fail'} | ${schema.errors.length} errori, ${schema.warnings.length} warning |\n`;
    report += `| Claude | ${claude.score}/100 | ${claude.verdict} |\n`;
    if (gemini) {
        const adj = gemini.scoreAdjustment ? ` (${gemini.scoreAdjustment > 0 ? '+' : ''}${gemini.scoreAdjustment})` : '';
        report += `| Gemini | ${gemini.agreement}${adj} | ${gemini.summary?.substring(0, 60) || ''} |\n`;
    }
    if (grounding) {
        report += `| Grounding | ${grounding.sourcesCount} fonti | ${grounding.sources.map(s => s.domain).join(', ')} |\n`;
    }
    report += '\n';

    // Summary
    report += `${claude.summary}\n\n`;

    // Schema errors
    if (schema.errors.length > 0 || schema.warnings.length > 0) {
        report += `## 🔍 Schema Validation\n\n`;
        schema.errors.forEach(e => { report += `- ❌ ${e}\n`; });
        schema.warnings.forEach(w => { report += `- ⚠️ ${w}\n`; });
        report += '\n';
    }

    // Issues
    if (issues.length > 0) {
        report += `## Problemi trovati\n\n`;
        report += `| Sev. | Area | Problema | Correzione | Fonte |\n|------|------|----------|------------|-------|\n`;
        issues.forEach(i => {
            report += `| ${i.severity} | ${i.area} | ${i.message} | ${i.fix || ''} | ${i.source || '🔵 Claude'} |\n`;
        });
        report += '\n';
    }

    // Gemini Challenge
    if (gemini) {
        report += `## 🔴 Revisione Gemini\n\n`;
        report += `**Verdetto**: ${gemini.agreement}\n`;
        if (gemini.scoreAdjustment) {
            report += `**Adjustment**: ${gemini.scoreAdjustment > 0 ? '+' : ''}${gemini.scoreAdjustment}\n`;
        }
        report += `\n${gemini.summary}\n\n`;

        if (gemini.challengedIssues?.length > 0) {
            report += `### Issues contestate\n\n`;
            report += `| Problema | Verdetto | Motivo |\n|---|---|---|\n`;
            gemini.challengedIssues.forEach(i => {
                report += `| ${i.originalIssue} | ${i.verdict} | ${i.reason} |\n`;
            });
            report += '\n';
        }
    }

    // Web grounding sources
    if (grounding) {
        report += `## 🌐 Fonti Web\n\n`;
        grounding.sources.forEach((s, i) => {
            report += `${i + 1}. **${s.domain}** — ${s.ingredients} ingredienti\n`;
        });
        report += '\n';
    }

    // Footer
    report += `---\n*Generato: ${new Date().toISOString()} | Pipeline: Schema → ${grounding ? 'Grounding → ' : ''}Claude → Gemini*\n`;

    return report;
}

// ══════════════════════════════════════════════════════════════════════
// API PUBBLICA
// ══════════════════════════════════════════════════════════════════════

/**
 * Esegui la pipeline di qualità completa su una ricetta JSON.
 * 
 * @param {string} filePath - Percorso al file .json della ricetta
 * @param {object} options - { grounding: boolean } per attivare il web grounding
 * @returns {object} { recipe, result: { score, issues, claude, gemini, schema, grounding, report } }
 */
export async function analyzeQuality(filePath, options = {}) {
    const raw = readFileSync(filePath, 'utf-8');
    const recipe = JSON.parse(raw);

    log.info(`🔍 Qualità: "${recipe.title}" (${recipe.category})`);

    // ── Layer 1: Schema ──
    log.info('   📐 Layer 1: Schema validation...');
    const schema = validateSchema(recipe, filePath);
    if (!schema.pass) {
        log.warn(`   📐 Schema: ${schema.errors.length} errori`);
    } else {
        log.info('   📐 Schema: ✅ OK');
    }

    // ── Layer 2: Grounding (opzionale) ──
    let grounding = null;
    if (options.grounding) {
        grounding = await fetchGroundingContext(recipe.title);
    }

    // ── Layer 3: Dual-LLM Review ──
    const recipePrompt = buildRecipePrompt(recipe);
    const { claude, gemini } = await dualLlmReview(recipePrompt, grounding);

    // ── Layer 4: Score & Report ──
    const finalScore = computeFinalScore(schema, claude, gemini, grounding);
    const issues = mergeIssues(claude, gemini);
    const report = generateQualityReport(recipe, schema, claude, gemini, grounding, finalScore);

    // Salva report accanto alla ricetta
    const reportPath = filePath.replace('.json', '.qualita.md');
    writeFileSync(reportPath, report, 'utf-8');

    const result = {
        score: finalScore,
        verdict: claude.verdict,
        issues,
        schema,
        claude: { score: claude.score, verdict: claude.verdict, summary: claude.summary },
        gemini: gemini ? {
            agreement: gemini.agreement,
            scoreAdjustment: gemini.scoreAdjustment || 0,
            challengedIssues: gemini.challengedIssues || [],
            missedIssues: gemini.missedIssues || [],
            summary: gemini.summary,
        } : null,
        grounding: grounding ? {
            sourcesCount: grounding.sourcesCount,
            sources: grounding.sources,
        } : null,
        report,
    };

    log.info(`   📊 Layer 4: Score finale ${finalScore >= 80 ? '🟢' : finalScore >= 60 ? '🟡' : '🔴'} ${finalScore}/100`);

    return { recipe, result };
}

/**
 * Calcola l'hash MD5 del contenuto del file per tracciabilità.
 * Usato per evitare ri-analisi inutili e per audit trail.
 */
export function computeFileHash(filePath) {
    const content = readFileSync(filePath, 'utf-8');
    return createHash('md5').update(content).digest('hex');
}
