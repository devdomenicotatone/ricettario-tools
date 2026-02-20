/**
 * VERIFY — Verifica qualità ricette con Claude API
 * 
 * Diverso da validator.js (cross-check SerpAPI con fonti web),
 * questo usa Claude come esperto per verificare:
 * - Dosi e proporzioni realistiche
 * - Temperature (max 280°C per forni casalinghi)
 * - Tempi coerenti
 * - Termini tecnici → genera glossario
 * - Setup corretto per categoria
 * - Sezione cottura presente per pane/pizza
 */
import { callClaude, parseClaudeJson } from './utils/api.js';
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

5. SETUP CORRETTO:
   - PANE/PIZZA: "Impastatrice a spirale" + "A mano" = ✅
   - PASTA: "Estrusore con trafila" + "A mano" (SOLO se il formato lo permette) = ✅
   - PASTA con "Spirale" = ❌ ERRORE

6. SEZIONE COTTURA (pane/pizza):
   - Deve essere presente con: temperatura, tempo, suggerimenti
   - Per forni casalinghi: pietra refrattaria, vapore nei primi minuti, posizione teglia

RISPONDI con un JSON valido (NO markdown fences):
{
  "score": 85,
  "verdict": "🟢 Buona|🟡 Da migliorare|🔴 Problematica",
  "issues": [
    {"severity": "❌|⚠️|💡", "area": "Dosi|Temperature|Tempi|Setup|Cottura|Terminologia", "message": "Descrizione del problema", "fix": "Suggerimento di correzione"}
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
  "setupCorrection": {
    "needed": false,
    "currentSetup": "Spirale + A mano",
    "correctSetup": "Estrusore + A mano",
    "reason": "Le orecchiette sono un formato di pasta, non di pane"
  },
  "summary": "Breve riepilogo di 2-3 righe sulla qualità complessiva della ricetta"
}`;


/**
 * Estrae il contenuto leggibile da un file HTML di ricetta
 */
function extractRecipeContent(filePath) {
    const html = readFileSync(filePath, 'utf-8');

    // Titolo
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const title = titleMatch ? titleMatch[1].trim() : basename(filePath, '.html');

    // Categoria dal path o dal tag
    const pathParts = filePath.replace(/\\/g, '/').split('/');
    const catFromPath = pathParts[pathParts.length - 2] || '';
    const catMatch = html.match(/tag--category[^>]*>[^<]*?([A-Za-zÀ-ú]+)\s*<\/span>/i);
    const category = catMatch ? catMatch[1] : catFromPath;

    // Ingredienti dalla tabella
    const ingredients = [];
    const tableMatch = html.match(/<table[^>]*class="[^"]*ingredients-table[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
    if (tableMatch) {
        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let row;
        while ((row = rowRegex.exec(tableMatch[1])) !== null) {
            const text = row[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (text.length > 3) ingredients.push(text);
        }
    }

    // Sospensioni
    const suspensions = [];
    const allTables = html.matchAll(/<table[^>]*class="[^"]*ingredients-table[^"]*"[^>]*>([\s\S]*?)<\/table>/gi);
    let tableIdx = 0;
    for (const tbl of allTables) {
        tableIdx++;
        if (tableIdx === 2) { // seconda tabella = sospensioni
            const rowRegex2 = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
            let row2;
            while ((row2 = rowRegex2.exec(tbl[1])) !== null) {
                const text = row2[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                if (text.length > 3) suspensions.push(text);
            }
        }
    }

    // Procedimento (tutti gli step)
    const steps = [];
    const stepRegex = /<li[^>]*class="[^"]*step-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    let step;
    while ((step = stepRegex.exec(html)) !== null) {
        const text = step[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > 10) steps.push(text);
    }

    // Fallback: cerca <ol class="steps-list"> → <li>
    if (steps.length === 0) {
        const olRegex = /<ol[^>]*class="[^"]*steps-list[^"]*"[^>]*>([\s\S]*?)<\/ol>/gi;
        let ol;
        while ((ol = olRegex.exec(html)) !== null) {
            const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
            let li;
            while ((li = liRegex.exec(ol[1])) !== null) {
                const text = li[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                if (text.length > 10) steps.push(text);
            }
        }
    }

    // Tech badges
    const hydrationMatch = html.match(/[Ii]dratazione[^<]*?(\d{2,3})\s*%/);
    const hydration = hydrationMatch ? hydrationMatch[1] + '%' : '';

    const tempMatch = html.match(/Target Temp[^<]*?<span[^>]*>([^<]+)/i);
    const targetTemp = tempMatch ? tempMatch[1].trim() : '';

    const fermMatch = html.match(/Lievitazione[^<]*?<span[^>]*>([^<]+)/i);
    const fermentation = fermMatch ? fermMatch[1].trim() : '';

    // Setup attuale
    const setupMatch = html.match(/Setup[^<]*?<span[^>]*>([^<]+)/i);
    const currentSetup = setupMatch ? setupMatch[1].trim() : '';

    // Alert
    const alertMatch = html.match(/ALERT PROFESSIONALE[\s\S]*?<p>([^<]+)<\/p>/i);
    const alert = alertMatch ? alertMatch[1].trim() : '';

    // Pro Tips
    const proTips = [];
    const tipRegex = /PRO TIP:<\/strong>\s*([^<]+)/gi;
    let tip;
    while ((tip = tipRegex.exec(html)) !== null) {
        proTips.push(tip[1].trim());
    }

    return {
        title, category, filePath,
        ingredients, suspensions, steps,
        hydration, targetTemp, fermentation,
        currentSetup, alert, proTips,
    };
}

/**
 * Verifica una singola ricetta con Claude
 */
export async function verifyRecipe(filePath) {
    const recipe = extractRecipeContent(filePath);

    log.info(`Verifico: "${recipe.title}" (${recipe.category})`);
    log.debug(`${recipe.ingredients.length} ingredienti, ${recipe.steps.length} step`);

    const userPrompt = `Verifica questa ricetta del mio Ricettario:

TITOLO: ${recipe.title}
CATEGORIA: ${recipe.category}
IDRATAZIONE: ${recipe.hydration}
TEMPERATURA TARGET: ${recipe.targetTemp}
LIEVITAZIONE: ${recipe.fermentation}
SETUP ATTUALE: ${recipe.currentSetup}

INGREDIENTI:
${recipe.ingredients.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}

${recipe.suspensions.length > 0 ? `SOSPENSIONI:\n${recipe.suspensions.map((s, idx) => `${idx + 1}. ${s}`).join('\n')}` : ''}

PROCEDIMENTO:
${recipe.steps.map((s, idx) => `${idx + 1}. ${s}`).join('\n')}

${recipe.alert ? `ALERT: ${recipe.alert}` : ''}
${recipe.proTips.length > 0 ? `PRO TIPS: ${recipe.proTips.join(' | ')}` : ''}

Verifica la correttezza di TUTTO: dosi, temperature, tempi, setup, termini tecnici.
Per la categoria "${recipe.category}", il setup è corretto?
La ricetta ha una sezione cottura completa con temperatura, tempo e suggerimenti?`;

    const text = await callClaude({
        model: 'claude-sonnet-4-20250514',
        maxTokens: 3000,
        system: VERIFY_SYSTEM,
        messages: [{ role: 'user', content: userPrompt }],
    });

    const result = parseClaudeJson(text);
    return { recipe, result };
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

