/**
 * VERIFY — Verifica qualità ricette con Claude + Gemini Challenge
 * 
 * ARCHITETTURA DUAL-LLM (Anti-Loop):
 *   1. Claude → genera verifica iniziale (score, issues, glossario)
 *   2. Gemini → challenge singolo passaggio (conferma, contesta, aggiunge)
 *   3. Report finale → merge dei due verdetti, senza loop
 * 
 * Diverso da validator.js (cross-check SerpAPI con fonti web),
 * questo usa LLM come esperti per verificare:
 * - Dosi e proporzioni realistiche
 * - Temperature (max 280°C per forni casalinghi)
 * - Tempi coerenti
 * - Termini tecnici → genera glossario
 * - Setup corretto per categoria
 * - Sezione cottura presente per pane/pizza
 */
import { callClaude, callGemini, parseClaudeJson } from './utils/api.js';
import { log } from './utils/logger.js';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { resolve, basename, relative } from 'path';
import { createHash } from 'crypto';

// ── Indice verifiche (evita ri-verifiche inutili) ──
const INDEX_DIR = resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), '..', 'data');
const INDEX_PATH = resolve(INDEX_DIR, 'verify-index.json');

function loadIndex() {
    try {
        if (existsSync(INDEX_PATH)) {
            return JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
        }
    } catch { /* ignore */ }
    return { verified: {}, lastRun: null };
}

function saveIndex(index) {
    if (!existsSync(INDEX_DIR)) mkdirSync(INDEX_DIR, { recursive: true });
    index.lastRun = new Date().toISOString();
    writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
}

function computeHash(filePath) {
    const content = readFileSync(filePath, 'utf-8');
    return createHash('md5').update(content).digest('hex');
}

// ── Formati pasta che si possono fare a mano ──
const PASTA_A_MANO = [
    'orecchiette', 'pici', 'tagliatelle', 'pappardelle', 'tajarin',
    'malloreddus', 'gnocchetti', 'cavatelli', 'trofie', 'strascinati',
    'lagane', 'fettuccine', 'lasagne', 'ravioli', 'tortellini',
    'cappelletti', 'agnolotti', 'pizzoccheri',
    'fusilli al ferretto', 'fusilli ferretto',
];

// Formati pasta SOLO estrusore (non fattibili a mano)
const PASTA_SOLO_ESTRUSORE = [
    'spaghetti', 'linguine', 'rigatoni', 'maccheroni', 'fusilli',
    'penne', 'bucatini', 'paccheri', 'mezze maniche', 'tortiglioni',
    'sedanini', 'ditalini', 'caserecce',
];

// ── Prompt di verifica ──
const VERIFY_SYSTEM = `Sei un esperto tecnologo alimentare, panificatore e pastaio italiano con 30 anni di esperienza.
Il tuo compito è VERIFICARE la correttezza di ricette già generate, trovando errori e suggerendo miglioramenti.

CRITERI DI VERIFICA:

1. DOSI E PROPORZIONI:
   - Idratazione: verifica che sia realistica per il tipo di prodotto
   - % lievito: pane (0.1-3% su farina), pizza (0.5-3%), lievitati (3-15% lievito di birra)
   - Rapporti farina/acqua coerenti con la tradizione
   - Sale: tipicamente 2-3% su farina per pane, 2.5-3% per pizza

2. TEMPERATURE:
   - Forno casalingo: max 280°C (mai suggerire temperature superiori)
   - Pane casalingo: 220-250°C tipico
   - Pizza in forno casalingo: 250-280°C con pietra refrattaria
   - Pasta: temperature acqua di cottura ~100°C
   - Temperatura impasto target: 23-26°C tipica

3. TEMPI:
   - Verifica coerenza tra lievitazione e tipo/quantità di lievito
   - Cottura pane: 25-50 min tipico
   - Cottura pizza casalinga: 5-12 min con pietra
   - Pasta fresca: 2-5 min

4. TERMINI TECNICI:
   - Identifica tutti i termini che un hobbista potrebbe non conoscere
   - Genera un GLOSSARIO con spiegazioni brevi e chiare

6. SEZIONE COTTURA (pane/pizza):
   - Deve essere presente con: temperatura, tempo, suggerimenti
   - Per forni casalinghi: pietra refrattaria, vapore nei primi minuti, posizione teglia

RISPONDI con un JSON valido (NO markdown fences):
{
  "score": 85,
  "verdict": "🟢 Buona|🟡 Da migliorare|🔴 Problematica",
  "issues": [
    {"severity": "❌|⚠️|💡", "area": "Dosi|Temperature|Tempi|Cottura|Terminologia", "message": "Descrizione del problema", "fix": "Suggerimento di correzione"}
  ],
  "glossary": [
    {"term": "Autolisi", "definition": "Riposo di farina e acqua (senza lievito) per 20-60 min, permette alla farina di idratarsi e al glutine di formarsi spontaneamente"}
  ],
  "bakingSection": {
    "needed": true,
    "temperature": "250°C",
    "time": "25-30 minuti",
    "tips": ["Preriscaldare con pietra refrattaria per 45 min", "Spruzzare acqua nei primi 5 min per creare vapore"]
  },
  "summary": "Breve riepilogo di 2-3 righe sulla qualità complessiva della ricetta"
}`;

// ── Prompt Gemini Challenger ──
const GEMINI_CHALLENGE_SYSTEM = `Sei un revisore critico indipendente — un secondo parere esperto.
Hai ricevuto:
1. Una RICETTA originale
2. Il VERDETTO DI UN ALTRO AI (Claude) che l'ha già verificata

Il tuo compito è METTERE IN DISCUSSIONE il verdetto, NON ripeterlo passivamente.

COSA DEVI FARE:
- CONFERMA i problemi reali trovati dall'altro AI
- CONTESTA le segnalazioni che ritieni sbagliate o troppo punitive ("falsi positivi")
- AGGIUNGI problemi che l'altro AI ha MANCATO
- VALUTA se lo score assegnato è giusto, troppo alto o troppo basso

CRITERI TECNICI:
- Idratazione: coerente con il tipo di prodotto?
- Sale: 2-3% su farina è standard, ma varia per tipo
- Temperature acqua: devono corrispondere al contesto (spirale vs mano, W farina, durata impasto)
- Forno casalingo: MAX 280°C
- Lieviti: proporzioni realistiche per il tipo e i tempi
- ingredientGroups: gli ingredienti sono nel gruppo giusto? Manca qualcosa?

ATTENZIONE:
- NON essere pignolo senza motivo — segnala solo problemi REALI
- Se il verdetto dell'altro AI è corretto, dillo chiaramente
- Se hai dubbi, segnala come "⚠️ Da verificare" non come errore

RISPONDI con un JSON valido (NO markdown fences):
{
  "agreement": "🟢 Confermo il verdetto|🟡 Parziale disaccordo|🔴 Forte disaccordo",
  "scoreAdjustment": 0,
  "challengedIssues": [
    {"originalIssue": "Breve rif. al problema segnalato da Claude", "verdict": "✅ Confermo|❌ Falso positivo|⚠️ Parzialmente corretto", "reason": "Spiegazione"}
  ],
  "missedIssues": [
    {"severity": "❌|⚠️|💡", "area": "Area", "message": "Problema non rilevato", "fix": "Correzione suggerita"}
  ],
  "ingredientGroupsReview": {
    "correct": true,
    "issues": []
  },
  "summary": "Breve giudizio del revisore indipendente (2-3 righe)"
}`;


/**
 * Estrae il contenuto leggibile da un file JSON di ricetta (SPA)
 */
function extractRecipeContentFromJson(filePath) {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    // Ingredienti: supporta sia ingredientGroups che ingredients flat
    const ingredients = [];
    if (data.ingredientGroups?.length > 0) {
        for (const group of data.ingredientGroups) {
            ingredients.push(`── ${group.group} ──`);
            for (const item of group.items) {
                const parts = [item.name];
                if (item.note) parts.push(`(${item.note})`);
                if (item.grams != null) parts.push(`${item.grams}g`);
                ingredients.push(parts.join(' '));
            }
        }
    } else if (data.ingredients?.length > 0) {
        for (const item of data.ingredients) {
            const parts = [item.name];
            if (item.note) parts.push(`(${item.note})`);
            if (item.grams != null) parts.push(`${item.grams}g`);
            ingredients.push(parts.join(' '));
        }
    }

    // Sospensioni
    const suspensions = (data.suspensions || []).map(s => {
        const parts = [s.name];
        if (s.note) parts.push(`(${s.note})`);
        if (s.grams != null) parts.push(`${s.grams}g`);
        return parts.join(' ');
    });

    // Procedimento
    const steps = [];
    for (const key of ['steps', 'stepsCondiment']) {
        if (data[key]?.length > 0) {
            steps.push(`── ${key === 'stepsCondiment' ? 'Condimento' : 'Procedimento'} ──`);
            for (const step of data[key]) {
                const text = step.title + (step.text ? `: ${step.text}` : '');
                steps.push(text);
            }
        }
    }

    // Alert e ProTips
    const alert = data.alert || '';
    const proTips = (data.proTips || []).map(t => typeof t === 'string' ? t : t.text || '');

    // Categoria dal path
    const pathParts = filePath.replace(/\\/g, '/').split('/');
    const catFromPath = pathParts[pathParts.length - 2] || '';

    return {
        title: data.title || basename(filePath, '.json'),
        category: data.category || catFromPath,
        filePath,
        ingredients,
        suspensions,
        steps,
        hydration: data.hydration ? `${data.hydration}%` : '',
        targetTemp: data.targetTemp || '',
        fermentation: data.fermentation || '',
        alert,
        proTips,
    };
}

/**
 * Verifica una singola ricetta con Claude + Gemini Challenge
 * Supporta sia file .json (SPA) che .html (legacy)
 * @param {string} filePath - Percorso al file della ricetta
 * @param {object} options - { skipGemini: boolean } per saltare il challenge Gemini
 */
export async function verifyRecipe(filePath, options = {}) {
    const isJson = filePath.endsWith('.json');
    const recipe = isJson
        ? extractRecipeContentFromJson(filePath)
        : extractRecipeContent(filePath);

    log.info(`Verifico: "${recipe.title}" (${recipe.category})`);
    log.debug(`${recipe.ingredients.length} ingredienti, ${recipe.steps.length} step`);

    const userPrompt = `Verifica questa ricetta del mio Ricettario:

TITOLO: ${recipe.title}
CATEGORIA: ${recipe.category}
IDRATAZIONE: ${recipe.hydration}
TEMPERATURA TARGET: ${recipe.targetTemp}
LIEVITAZIONE: ${recipe.fermentation}

INGREDIENTI:
${recipe.ingredients.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}

${recipe.suspensions.length > 0 ? `SOSPENSIONI:\n${recipe.suspensions.map((s, idx) => `${idx + 1}. ${s}`).join('\n')}` : ''}

PROCEDIMENTO:
${recipe.steps.map((s, idx) => `${idx + 1}. ${s}`).join('\n')}

${recipe.alert ? `ALERT: ${recipe.alert}` : ''}
${recipe.proTips.length > 0 ? `PRO TIPS: ${recipe.proTips.join(' | ')}` : ''}

Verifica la correttezza di TUTTO: dosi, temperature, tempi, termini tecnici.
La ricetta ha una sezione cottura completa con temperatura, tempo e suggerimenti?`;

    // ── STEP 1: Claude verifica ──
    log.info('   🔵 Claude sta verificando...');
    const claudeText = await callClaude({
        model: 'claude-sonnet-4-20250514',
        maxTokens: 3000,
        system: VERIFY_SYSTEM,
        messages: [{ role: 'user', content: userPrompt }],
    });
    const claudeResult = parseClaudeJson(claudeText);

    // ── STEP 2: Gemini Challenge (singolo passaggio, NO loop) ──
    let geminiResult = null;
    if (!options.skipGemini && process.env.GEMINI_API_KEY) {
        try {
            log.info('   🔴 Gemini sta contestando...');
            const geminiPrompt = `RICETTA ORIGINALE:
${userPrompt}

══════════════════════════════════════
VERDETTO DI CLAUDE (altro AI):
${JSON.stringify(claudeResult, null, 2)}
══════════════════════════════════════

Analizza CRITICAMENTE il verdetto di Claude. Conferma, contesta o aggiungi problemi.`;

            const geminiText = await callGemini({
                model: 'gemini-2.5-pro',
                maxTokens: 4096,
                system: GEMINI_CHALLENGE_SYSTEM,
                messages: [{ role: 'user', content: geminiPrompt }],
            });
            geminiResult = parseClaudeJson(geminiText); // stesso parser JSON robusto
            log.info(`   🔴 Gemini: ${geminiResult.agreement}`);
        } catch (err) {
            log.warn(`   ⚠️ Gemini challenge fallito: ${err.message}`);
            log.warn('   Procedo con solo verdetto Claude.');
        }
    } else if (!process.env.GEMINI_API_KEY) {
        log.debug('   ⏭️ GEMINI_API_KEY non configurata, skip challenge');
    }

    // ── STEP 3: Merge risultati ──
    const result = mergeVerifyResults(claudeResult, geminiResult);
    return { recipe, result, claudeResult, geminiResult };
}

/**
 * Merge i risultati di Claude e Gemini in un verdetto unificato
 * Gemini può aggiustare lo score e aggiungere issues mancanti
 */
function mergeVerifyResults(claude, gemini) {
    // Se non c'è Gemini, restituisci solo Claude
    if (!gemini) return { ...claude, challenger: null };

    const merged = { ...claude };

    // Aggiusta score se Gemini suggerisce
    if (gemini.scoreAdjustment && gemini.scoreAdjustment !== 0) {
        merged.originalScore = claude.score;
        merged.score = Math.max(0, Math.min(100, claude.score + gemini.scoreAdjustment));
    }

    // Aggiungi issues mancanti trovate da Gemini
    if (gemini.missedIssues?.length > 0) {
        merged.issues = [
            ...(claude.issues || []),
            ...gemini.missedIssues.map(i => ({ ...i, source: '🔴 Gemini' })),
        ];
    }

    // Attach Gemini metadata
    merged.challenger = {
        agreement: gemini.agreement,
        scoreAdjustment: gemini.scoreAdjustment || 0,
        challengedIssues: gemini.challengedIssues || [],
        missedIssues: gemini.missedIssues || [],
        ingredientGroupsReview: gemini.ingredientGroupsReview || null,
        summary: gemini.summary,
    };

    return merged;
}

/**
 * Genera report di verifica in formato markdown
 */
function generateVerifyReport(recipe, result) {
    const r = result;
    const emoji = r.score >= 80 ? '🟢' : r.score >= 60 ? '🟡' : '🔴';

    let report = `# Verifica: ${recipe.title}\n\n`;
    report += `## ${emoji} Score: ${r.score}/100 — ${r.verdict}\n\n`;
    report += `${r.summary}\n\n`;

    // Issues
    if (r.issues?.length > 0) {
        report += `## Problemi trovati\n\n`;
        report += `| Sev. | Area | Problema | Correzione |\n|------|------|----------|------------|\n`;
        r.issues.forEach(i => {
            report += `| ${i.severity} | ${i.area} | ${i.message} | ${i.fix} |\n`;
        });
        report += '\n';
    }

    // Glossario
    if (r.glossary?.length > 0) {
        report += `## 📖 Glossario suggerito\n\n`;
        r.glossary.forEach(g => {
            report += `- **${g.term}**: ${g.definition}\n`;
        });
        report += '\n';
    }

    // Sezione cottura
    if (r.bakingSection?.needed) {
        report += `## 🔥 Sezione Cottura suggerita\n\n`;
        report += `- **Temperatura**: ${r.bakingSection.temperature}\n`;
        report += `- **Tempo**: ${r.bakingSection.time}\n`;
        if (r.bakingSection.tips?.length > 0) {
            report += `- **Suggerimenti**:\n`;
            r.bakingSection.tips.forEach(t => { report += `  - ${t}\n`; });
        }
        report += '\n';
    }

    // Setup
    if (r.setupCorrection?.needed) {
        report += `## ⚠️ Correzione Setup\n\n`;
        report += `- Attuale: ${r.setupCorrection.currentSetup}\n`;
        report += `- Corretto: ${r.setupCorrection.correctSetup}\n`;
        report += `- Motivo: ${r.setupCorrection.reason}\n\n`;
    }

    // ── Gemini Challenge ──
    if (r.challenger) {
        report += `## 🔴 Revisione Gemini (Challenge)\n\n`;
        report += `**Verdetto**: ${r.challenger.agreement}\n`;
        if (r.challenger.scoreAdjustment !== 0) {
            const dir = r.challenger.scoreAdjustment > 0 ? '+' : '';
            report += `**Score adjustment**: ${dir}${r.challenger.scoreAdjustment} punti`;
            if (r.originalScore != null) {
                report += ` (Claude: ${r.originalScore} → Finale: ${r.score})`;
            }
            report += '\n';
        }
        report += `\n${r.challenger.summary}\n\n`;

        // Issues contestate
        if (r.challenger.challengedIssues?.length > 0) {
            report += `### Issues di Claude contestate\n\n`;
            report += `| Problema originale | Verdetto Gemini | Motivazione |\n|---|---|---|\n`;
            r.challenger.challengedIssues.forEach(i => {
                report += `| ${i.originalIssue} | ${i.verdict} | ${i.reason} |\n`;
            });
            report += '\n';
        }

        // Issues mancanti
        if (r.challenger.missedIssues?.length > 0) {
            report += `### Issues mancanti (trovate solo da Gemini)\n\n`;
            report += `| Sev. | Area | Problema | Correzione |\n|------|------|----------|------------|\n`;
            r.challenger.missedIssues.forEach(i => {
                report += `| ${i.severity} | ${i.area} | ${i.message} | ${i.fix} |\n`;
            });
            report += '\n';
        }

        // Review ingredientGroups
        if (r.challenger.ingredientGroupsReview && !r.challenger.ingredientGroupsReview.correct) {
            report += `### ⚠️ Problemi ingredientGroups\n\n`;
            r.challenger.ingredientGroupsReview.issues.forEach(issue => {
                report += `- ${issue}\n`;
            });
            report += '\n';
        }
    }

    return report;
}

/**
 * Verifica tutte le ricette nella cartella
 * @param {string} ricettarioPath - Path al progetto Ricettario
 * @param {object} options - { force: boolean } per forzare ri-verifica
 */
export async function verifyAllRecipes(ricettarioPath, options = {}) {
    const ricettePath = resolve(ricettarioPath, 'ricette');
    const results = [];
    const index = loadIndex();
    let skipped = 0;

    const subdirs = readdirSync(ricettePath, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

    for (const subdir of subdirs) {
        const subPath = resolve(ricettePath, subdir);
        let files;
        try { files = readdirSync(subPath).filter(f => f.endsWith('.html')); }
        catch { continue; }

        for (const file of files) {
            const filePath = resolve(subPath, file);
            const relPath = relative(ricettarioPath, filePath).replace(/\\/g, '/');
            const currentHash = computeHash(filePath);

            // Controlla indice: skip se già verificata e non modificata
            if (!options.force && index.verified[relPath]?.hash === currentHash) {
                const cached = index.verified[relPath];
                const emoji = cached.score >= 80 ? '🟢' : cached.score >= 60 ? '🟡' : '🔴';
                console.log(`\n⏭️  Skip: "${cached.title}" ${emoji} ${cached.score}/100 (già verificata)`);
                results.push({
                    file, title: cached.title,
                    category: cached.category || subdir,
                    score: cached.score,
                    issues: cached.issues || 0,
                    glossaryTerms: cached.glossaryTerms || 0,
                    needsBaking: cached.needsBaking || false,
                    needsSetupFix: cached.needsSetupFix || false,
                    cached: true,
                });
                skipped++;
                continue;
            }

            console.log(`\n${'═'.repeat(60)}`);

            try {
                const { recipe, result } = await verifyRecipe(filePath);

                // Salva report
                const reportPath = filePath.replace('.html', '.verifica.md');
                const report = generateVerifyReport(recipe, result);
                writeFileSync(reportPath, report, 'utf-8');

                const emoji = result.score >= 80 ? '🟢' : result.score >= 60 ? '🟡' : '🔴';
                console.log(`   ${emoji} Score: ${result.score}/100`);

                if (result.issues?.length > 0) {
                    result.issues.forEach(i => console.log(`   ${i.severity} ${i.area}: ${i.message}`));
                }

                console.log(`   📄 Report: ${reportPath}`);

                const entry = {
                    file, title: recipe.title,
                    category: recipe.category,
                    score: result.score,
                    issues: result.issues?.length || 0,
                    glossaryTerms: result.glossary?.length || 0,
                    needsBaking: result.bakingSection?.needed || false,
                    needsSetupFix: result.setupCorrection?.needed || false,
                };

                results.push(entry);

                // Aggiorna indice
                index.verified[relPath] = {
                    hash: currentHash,
                    ...entry,
                    verifiedAt: new Date().toISOString(),
                };
                saveIndex(index);

            } catch (err) {
                console.error(`   ❌ Errore: ${err.message}`);
                results.push({ file, title: file, score: -1, error: err.message });
            }

            // Pausa tra ricette per rispettare rate limits
            await new Promise(r => setTimeout(r, 1500));
        }
    }

    if (skipped > 0) {
        console.log(`\n📋 ${skipped} ricette saltate (già verificate, file non modificato)`);
        console.log(`   Usa --forza per ri-verificare tutto`);
    }

    return results;
}

/**
 * Trascrive ricette da un PDF Philips usando Claude API
 * Per PDF grandi (>5MB): divide in batch di pagine con pdf-lib
 */
export async function transcribePhilipsPdf(pdfPath) {
    const { PDFDocument } = await import('pdf-lib');
    console.log(`\n📄 Trascrivo PDF: ${basename(pdfPath)}`);

    const pdfBuffer = readFileSync(pdfPath);
    const fileSizeMB = pdfBuffer.length / (1024 * 1024);
    console.log(`   📏 Dimensione: ${fileSizeMB.toFixed(1)} MB`);

    const TRANSCRIBE_PROMPT = `Questo è parte del ricettario ufficiale della Philips Serie 7000 Pasta Maker.
Trascrivi TUTTE le ricette presenti in queste pagine in formato JSON strutturato.
Se una pagina non contiene ricette (es. copertina, indice, istruzioni macchina), scrivi "recipes": [].

Per ogni ricetta, estrai:
- Nome del formato di pasta
- Ingredienti con dosi ESATTE (grammi, ml, numero uova)
- Quale disco/trafila usare
- Tempo di estrusione
- Eventuali note o consigli

RISPONDI con un JSON valido (NO markdown fences):
{
  "recipes": [
    {
      "name": "Nome Pasta",
      "disk": "Disco utilizzato",
      "ingredients": [
        {"name": "Ingrediente", "quantity": "300g"}
      ],
      "extrusionTime": "10 min",
      "notes": "Note opzionali"
    }
  ]
}`;

    const PAGES_PER_BATCH = 5;
    const MAX_BATCH_SIZE_B64 = 25 * 1024 * 1024; // 25MB in base64

    // Se il file è piccolo (<5MB), invia direttamente
    if (fileSizeMB < 5) {
        const base64Pdf = pdfBuffer.toString('base64');
        return await sendPdfToClaudeForTranscription(base64Pdf, TRANSCRIBE_PROMPT);
    }

    // PDF grande: dividi in batch di pagine
    console.log(`   ✂️ PDF troppo grande, divido in batch di ${PAGES_PER_BATCH} pagine...`);

    const srcDoc = await PDFDocument.load(pdfBuffer);
    const totalPages = srcDoc.getPageCount();
    console.log(`   📃 Totale pagine: ${totalPages}`);

    const allRecipes = [];
    let batchNum = 0;

    for (let start = 0; start < totalPages; start += PAGES_PER_BATCH) {
        batchNum++;
        const end = Math.min(start + PAGES_PER_BATCH, totalPages);
        const pageRange = `${start + 1}-${end}`;
        console.log(`\n   📦 Batch ${batchNum}: pagine ${pageRange}/${totalPages}`);

        // Crea un nuovo PDF con solo queste pagine
        const batchDoc = await PDFDocument.create();
        const pageIndices = Array.from({ length: end - start }, (_, i) => start + i);
        const copiedPages = await batchDoc.copyPages(srcDoc, pageIndices);
        copiedPages.forEach(page => batchDoc.addPage(page));

        const batchBytes = await batchDoc.save();
        const batchBase64 = Buffer.from(batchBytes).toString('base64');

        // Safety check dimensione
        if (batchBase64.length > MAX_BATCH_SIZE_B64) {
            console.log(`   ⚠️ Batch troppo grande (${(batchBase64.length / 1024 / 1024).toFixed(1)}MB b64), salto`);
            continue;
        }

        console.log(`   📤 Invio a Claude (${(batchBytes.length / 1024).toFixed(0)} KB)...`);

        try {
            const result = await sendPdfToClaudeForTranscription(batchBase64, TRANSCRIBE_PROMPT);
            if (result.recipes?.length > 0) {
                console.log(`   ✅ ${result.recipes.length} ricette trovate`);
                allRecipes.push(...result.recipes);
            } else {
                console.log(`   ⏭️ Nessuna ricetta in queste pagine`);
            }
        } catch (err) {
            console.error(`   ❌ Errore batch ${batchNum}: ${err.message}`);
        }

        // Pausa tra batch per rate limits
        if (start + PAGES_PER_BATCH < totalPages) {
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    console.log(`\n   📊 Totale ricette estratte: ${allRecipes.length}`);
    return { machine: 'Philips Serie 7000', recipes: allRecipes };
}

/**
 * Invia un PDF (base64) a Claude per la trascrizione
 */
async function sendPdfToClaudeForTranscription(base64Pdf, prompt) {
    const text = await callClaude({
        model: 'claude-sonnet-4-20250514',
        maxTokens: 8000,
        messages: [{
            role: 'user',
            content: [
                {
                    type: 'document',
                    source: {
                        type: 'base64',
                        media_type: 'application/pdf',
                        data: base64Pdf,
                    },
                },
                { type: 'text', text: prompt }
            ],
        }],
    });

    return parseClaudeJson(text);
}

