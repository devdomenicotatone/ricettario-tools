/**
 * QUALITY PIPELINE — Pipeline unificata di qualità ricette
 * 
 * Architettura a 4 Layer (standard industria 2026):
 *   Layer 1: SCHEMA VALIDATION — checks deterministici sul JSON
 *   Layer 2: WEB GROUNDING    — fonti reali come contesto (opzionale)
 *   Layer 3: GEMINI REVIEW     — Gemini verifica (single-LLM, indipendente)
 *   Layer 4: SCORE & REPORT   — score composito + markdown report
 * 
 * Sostituisce verify.js (solo AI) + validator.js (solo web).
 * Toggle grounding: default OFF (veloce), ON per analisi profonda.
 */
import { callGemini, callClaude, parseClaudeJson } from './utils/api.js';
import { log } from './utils/logger.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, basename } from 'path';
import { createHash } from 'crypto';

// ── Riuso utility da validator.js per il web grounding ──
import { searchRealSources, scrapeRecipePage } from './validator.js';

// ══════════════════════════════════════════════════════════════════════
// LAYER 1: SCHEMA VALIDATION (deterministico, istantaneo)
// ══════════════════════════════════════════════════════════════════════

// ── Schema centralizzato (Single Source of Truth) ──
import { validateRecipeSchema, TOKEN_REGEX, CATEGORIES_NEEDING_BAKING } from './recipe-schema.js';



/**
 * Validazione deterministica dello schema JSON della ricetta.
 * Usa lo schema centralizzato + check custom extra.
 */
function validateSchema(recipe, filePath) {
    // Validazione base dallo schema centralizzato
    const schemaResult = validateRecipeSchema(recipe);

    const errors = [...schemaResult.errors];
    const warnings = [...schemaResult.warnings];

    // ── Check custom aggiuntivi (non nello schema base) ──

    // Token dosi dinamiche: warning se nessuno step contiene token
    const allStepTexts = [...(recipe.steps || []), ...(recipe.stepsCondiment || [])]
        .map(s => s.text || '');
    const hasTokens = allStepTexts.some(t => TOKEN_REGEX.test(t));
    if (!hasTokens && allStepTexts.length > 0) {
        warnings.push('Nessun token {id:base} trovato negli step — le dosi nel procedimento non saranno dinamiche');
    }


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

        // Formatta come contesto testuale per il verificatore
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
// LAYER 3: GEMINI REVIEW (single-LLM, ~10s)
// ══════════════════════════════════════════════════════════════════════

const GEMINI_VERIFY_SYSTEM = `Sei un esperto tecnologo alimentare, panificatore e pastaio italiano con 30 anni di esperienza.
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

4. COERENZA INGREDIENTI ↔ PROCEDIMENTO:
   - Cerca ogni ingrediente nel TESTO COMPLETO del procedimento prima di segnalare come mancante
   - Cerca varianti del nome (es. "malto d'orzo" potrebbe essere citato come "malto")

5. GRUPPI INGREDIENTI:
   - I raggruppamenti sono logici?
   - Ogni ingrediente è nel gruppo giusto?

6. ⚠️ VERIFICA MATEMATICA IDRATAZIONE (CRITICO — NON SALTARE MAI):
   Il valore IDRATAZIONE DICHIARATA nella ricetta POTREBBE ESSERE SBAGLIATO. NON fidarti.
   DEVI SEMPRE ricalcolarlo da zero seguendo questi step:

   a) Elenca TUTTE le farine/semole in TUTTI i gruppi (inclusi pre-impasti come biga, poolish):
      → es. Farina biga = 100g, Semola impasto = 500g
   b) FARINA TOTALE = somma di (a)
   c) Elenca TUTTA l'acqua in TUTTI i gruppi (inclusi pre-impasti E il bassinage):
      → es. Acqua biga = 45g, Acqua impasto = 310g, Bassinage = 50g
      ⚠️ Il BASSINAGE è acqua aggiunta successivamente durante l'impastamento — CONTA come acqua totale.
   d) ACQUA TOTALE = somma di (c)
   e) IDRATAZIONE REALE = (ACQUA TOTALE / FARINA TOTALE) × 100
   f) Confronta con il valore DICHIARATO

   ⚠️ SELF-CHECK: Se il tuo calcolo conferma il valore dichiarato (scarto ≤ 3%), l'idratazione è CORRETTA.
   NON segnalare errore. SOLO se lo scarto è > 3%, segnala come ❌ errore critico.
   Nella issue MOSTRA LA FORMULA COMPLETA (es. "375g/600g = 62.5% ≠ 70% dichiarato").
   ATTENZIONE: NON contare l'ingrediente assemblato (es. "Biga Matura" 145g) come acqua o farina —
   è il prodotto finito del pre-impasto, le sue componenti sono già listate nel gruppo biga/poolish.

CONTESTO TECNICO RICETTARIO:
- Le ricette usano token {nome_ingrediente:valore}g nel procedimento — sono placeholder per il calcolatore dosi frontend. NON segnalarli come errori.
- Token con suffisso ! (es. {panetto_peso:520!}g) = token FISSO, non scala col moltiplicatore. Il ! è intenzionale, NON un errore.

RISPONDI con un JSON valido (NO markdown fences):
{
  "score": 85,
  "verdict": "🟢 Buona|🟡 Da migliorare|🔴 Problematica",
  "issues": [
    {"severity": "❌|⚠️|💡", "area": "Dosi|Temperature|Tempi|Setup|Coerenza|Gruppi", "message": "Problema", "fix": "Correzione"}
  ],
  "summary": "Riepilogo 2-3 righe sulla qualità complessiva"
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

    // Steps: invia il procedimento per validazione completa
    const steps = [];
    const STEP_LABELS = {
        steps: 'PROCEDIMENTO',
        stepsCondiment: 'CONDIMENTO/SALSA',
    };
    for (const key of ['steps', 'stepsCondiment']) {
        if (recipe[key]?.length > 0) {
            steps.push(`\n── ${STEP_LABELS[key]} ──`);
            for (const step of recipe[key]) {
                const stepText = step.text || step.detail || '';
                steps.push(`${step.title}${stepText ? `: ${stepText}` : ''}`);
            }
        }
    }

    // Nessun tracciamento setup forzato, verrà desunto dalla ricetta.

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
IDRATAZIONE DICHIARATA: ${recipe.hydration}% ⚠️ (VERIFICA OBBLIGATORIA: ricalcola dalla somma ingredienti)
TEMPERATURA TARGET: ${recipe.targetTemp || 'N/A'}
LIEVITAZIONE: ${recipe.fermentation || 'N/A'}

INGREDIENTI:
${ingredients.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}

${suspensions.length > 0 ? `SOSPENSIONI:\n${suspensions.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''}

PROCEDIMENTO:
${steps.map((s, idx) => `${idx + 1}. ${s}`).join('\n')}
${bakingText}
${recipe.alert ? `\nALERT: ${recipe.alert}` : ''}
${recipe.proTips?.length > 0 ? `\nPRO TIPS:\n${recipe.proTips.map(t => `- ${t}`).join('\n')}` : ''}
${recipe.storage?.length > 0 ? `\nCONSERVAZIONE:\n${recipe.storage.map(t => `- ${t}`).join('\n')}` : ''}`;
}

/**
 * Gemini verifica la ricetta (single-LLM, indipendente dal generatore)
 */
async function geminiReview(recipePrompt, groundingContext, geminiModel = 'gemini-2.5-pro') {
    const MODEL_LABELS = {
        'claude-sonnet-4-6': 'Claude Sonnet 4.6',
        'claude-opus-4-6': 'Claude Opus 4.6',
        'gemini-2.5-pro': 'Gemini 2.5 Pro',
        'gemini-2.5-flash': 'Gemini 2.5 Flash',
        'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
        'gemini-2-flash': 'Gemini 2 Flash',
    };
    const modelLabel = MODEL_LABELS[geminiModel] || geminiModel;

    const groundingDirective = groundingContext
        ? `\n\nHai anche accesso a FONTI WEB REALI per cross-check. Confronta ingredienti e proporzioni della ricetta con le fonti. Segnala discrepanze significative come issues.`
        : '';
    const fullPrompt = `Verifica questa ricetta:\n\n${recipePrompt}${groundingContext?.text || ''}${groundingDirective}\n\nVerifica dosi, temperature, tempi, setup, coerenza ingredienti↔procedimento.`;

    log.info(`   🤖 Layer 3: ${modelLabel} sta verificando...`);
    
    let llmText;
    if (geminiModel.startsWith('claude')) {
        llmText = await callClaude({
            model: geminiModel,
            maxTokens: 8192,
            system: GEMINI_VERIFY_SYSTEM,
            messages: [{ role: 'user', content: fullPrompt }],
        });
    } else {
        llmText = await callGemini({
            model: geminiModel,
            maxTokens: 8192,
            system: GEMINI_VERIFY_SYSTEM,
            messages: [{ role: 'user', content: fullPrompt }],
        });
    }
    
    const result = parseClaudeJson(llmText);
    log.info(`   🤖 ${modelLabel}: ${result.score}/100 — ${result.verdict}`);
    return result;
}

// ══════════════════════════════════════════════════════════════════════
// LAYER 4: SCORE COMPOSITO & REPORT
// ══════════════════════════════════════════════════════════════════════

/**
 * Calcola score finale:
 * - Gemini score diretto + schema penalty
 */
function computeFinalScore(schema, gemini) {
    let score = gemini.score;

    // Schema penalty: penalizza proporzionalmente agli errori
    if (!schema.pass) {
        const penalty = schema.errors.length * 15; // -15 per ogni errore schema
        score = Math.max(20, score - penalty);      // floor a 20 (mai zero)
    }

    return Math.round(score);
}

/**
 * Genera report markdown
 */
function generateQualityReport(recipe, schema, gemini, grounding, finalScore) {
    const emoji = finalScore >= 80 ? '🟢' : finalScore >= 60 ? '🟡' : '🔴';
    const issues = [...(gemini.issues || [])];

    let report = `# Qualità: ${recipe.title}\n\n`;
    report += `## ${emoji} Score Finale: ${finalScore}/100\n\n`;

    // Score breakdown
    report += `| Layer | Score | Dettaglio |\n|---|---|---|\n`;
    report += `| Schema | ${schema.pass ? '✅ Pass' : '❌ Fail'} | ${schema.errors.length} errori, ${schema.warnings.length} warning |\n`;
    report += `| Gemini | ${gemini.score}/100 | ${gemini.verdict} |\n`;
    if (grounding) {
        report += `| Grounding | ${grounding.sourcesCount} fonti | ${grounding.sources.map(s => s.domain).join(', ')} |\n`;
    }
    report += '\n';

    // Summary
    report += `${gemini.summary}\n\n`;

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
        report += `| Sev. | Area | Problema | Correzione |\n|------|------|----------|------------|\n`;
        issues.forEach(i => {
            report += `| ${i.severity} | ${i.area} | ${i.message} | ${i.fix || ''} |\n`;
        });
        report += '\n';
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
    report += `---\n*Generato: ${new Date().toISOString()} | Pipeline: Schema → ${grounding ? 'Grounding → ' : ''}Gemini*\n`;

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

    // ── Layer 3: Gemini Review ──
    const recipePrompt = buildRecipePrompt(recipe);
    const gemini = await geminiReview(recipePrompt, grounding, options.geminiModel);

    // ── Layer 4: Score & Report ──
    const finalScore = computeFinalScore(schema, gemini);
    const issues = [...(gemini.issues || [])];
    const report = generateQualityReport(recipe, schema, gemini, grounding, finalScore);

    // Salva report accanto alla ricetta
    const reportPath = filePath.replace('.json', '.qualita.md');
    writeFileSync(reportPath, report, 'utf-8');

    const result = {
        score: finalScore,
        verdict: gemini.verdict,
        issues,
        schema,
        gemini: {
            score: gemini.score,
            verdict: gemini.verdict,
            summary: gemini.summary,
        },
        grounding: grounding ? {
            sourcesCount: grounding.sourcesCount,
            sources: grounding.sources,
        } : null,
        report,
    };

    log.info(`   📊 Layer 4: Score finale ${finalScore >= 80 ? '🟢' : finalScore >= 60 ? '🟡' : '🔴'} ${finalScore}/100`);

    // Salva nello quality index per badge dashboard
    saveScoreToIndex(recipe.slug || basename(filePath, '.json'), {
        score: finalScore,
        verdict: gemini.verdict,
        issueCount: issues.length,
        timestamp: new Date().toISOString(),
    });

    return { recipe, result };
}

// ══════════════════════════════════════════════════════════════════════
// QUALITY INDEX — persistenza score per badge dashboard
// ══════════════════════════════════════════════════════════════════════

const QUALITY_INDEX_PATH = resolve(process.cwd(), 'quality-index.json');

function loadQualityIndex() {
    try {
        if (existsSync(QUALITY_INDEX_PATH)) {
            return JSON.parse(readFileSync(QUALITY_INDEX_PATH, 'utf-8'));
        }
    } catch { /* ignore corrupt file */ }
    return {};
}

function saveScoreToIndex(slug, data) {
    const index = loadQualityIndex();
    index[slug] = data;
    writeFileSync(QUALITY_INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
}

function saveQualityIndex(index) {
    writeFileSync(QUALITY_INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
}

export { loadQualityIndex, saveQualityIndex };

/**
 * Calcola l'hash MD5 del contenuto del file per tracciabilità.
 */
export function computeFileHash(filePath) {
    const content = readFileSync(filePath, 'utf-8');
    return createHash('md5').update(content).digest('hex');
}

