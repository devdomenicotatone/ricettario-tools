/**
 * COMANDO: trascrivi — Trascrivi PDF o immagini Philips in ricette HTML
 */

import { resolve } from 'path';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { transcribePhilipsPdf } from '../verify.js';
import { injectCard } from '../injector.js';
import { findAndDownloadImage } from '../image-finder.js';
import { log } from '../utils/logger.js';

/**
 * Trascrivi PDF Philips
 */
export async function trascriviPdf(args) {
    const ricettarioPath = resolve(process.cwd(), args.output || process.env.RICETTARIO_PATH || '../Ricettario');
    const pdfDir = resolve(ricettarioPath, 'public', 'pdf');
    log.header('TRASCRIZIONE PDF — Philips Serie 7000');

    const pdfs = readdirSync(pdfDir).filter(f => f.toLowerCase().endsWith('.pdf'));
    const allRecipes = [];

    for (const pdf of pdfs) {
        try {
            const result = await transcribePhilipsPdf(resolve(pdfDir, pdf));
            log.success(`${pdf}: ${result.recipes?.length || 0} ricette trovate`);
            if (result.recipes) allRecipes.push(...result.recipes);
        } catch (err) {
            log.error(`${pdf}: ${err.message}`);
        }
    }

    // Salva risultato
    const dataDir = resolve(process.cwd(), 'data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    const outputPath = resolve(dataDir, 'philips-recipes.json');
    writeFileSync(outputPath, JSON.stringify({ machine: 'Philips Serie 7000', recipes: allRecipes }, null, 2), 'utf-8');
    log.success(`Salvate ${allRecipes.length} ricette in: ${outputPath}`);
}

/**
 * Trascrivi immagini Philips -> HTML (con Surya OCR locale + Claude testo)
 */
export async function trascriviImmagini(args) {
    const ricettarioPath = resolve(process.cwd(), args.output || process.env.RICETTARIO_PATH || '../Ricettario');
    const pdfDirs = [
        resolve(ricettarioPath, 'public', 'pdf', 'Philips Pasta maker'),
        resolve(ricettarioPath, 'public', 'pdf', 'Philips Pasta maker2'),
        resolve(ricettarioPath, 'public', 'pdf', 'Philips Pasta maker3')
    ];
    log.header('TRASCRIZIONE IMMAGINI — Philips Serie 7000 (Surya OCR + Claude)');

    // ── Step 1: OCR locale con Surya ──
    log.info('Step 1/3 — OCR locale con Surya...');
    const { runOcr, groupOcrPages } = await import('../ocr.js');
    const ocrResults = await runOcr(pdfDirs);

    const totalPages = Object.keys(ocrResults).length;
    const pagesWithText = Object.values(ocrResults).filter(r => r.lines > 0).length;

    if (pagesWithText === 0) {
        log.error('Nessun testo estratto dalle immagini. Verifica che Surya sia installato correttamente.');
        return;
    }

    log.success(`OCR completato: ${pagesWithText}/${totalPages} pagine con testo`);

    // ── Step 2: Indice di tracciamento ──
    const dataDir = resolve(process.cwd(), 'data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    const indexPath = resolve(dataDir, 'image-process-index.json');
    let processedIndex = {};
    try {
        if (existsSync(indexPath)) {
            processedIndex = JSON.parse(readFileSync(indexPath, 'utf-8'));
        }
    } catch { processedIndex = {}; }

    const saveIndex = () => {
        writeFileSync(indexPath, JSON.stringify(processedIndex, null, 2), 'utf-8');
    };

    // ── Step 3: Raggruppa in batch e invia a Claude ──
    log.info('Step 2/3 — Raggruppamento batch per Claude...');
    const BATCH_SIZE = 10;
    const allBatches = groupOcrPages(ocrResults, BATCH_SIZE);

    // Filtra batch già processati (solo le pagine NON-overlap contano)
    const pendingBatches = allBatches.filter(batch =>
        batch.filter(p => !p.isOverlap).some(page => !processedIndex[page.filename])
    );

    const alreadyDone = allBatches.length - pendingBatches.length;
    if (alreadyDone > 0) {
        log.success(`${alreadyDone} batch già processati. Rimangono ${pendingBatches.length} batch.`);
    }

    if (pendingBatches.length === 0) {
        log.success('Tutte le pagine sono già state processate!');
        return;
    }

    log.info(`Step 3/3 — Invio ${pendingBatches.length} batch a Claude (${BATCH_SIZE} pagine/batch)...`);

    const { extractRecipesFromText } = await import('../enhancer.js');
    let totalExtracted = 0;
    let totalDuplicates = 0;
    const extractedSlugs = new Set(); // Slug già estratti in questo run

    // ── Deduplicazione: carica ricette esistenti su disco ──
    const existingRecipes = loadExistingRecipes(ricettarioPath);
    log.info(`Trovate ${existingRecipes.size} ricette già esistenti su disco.`);

    for (let b = 0; b < pendingBatches.length; b++) {
        const batch = pendingBatches[b];
        log.info(`\nBatch ${b + 1}/${pendingBatches.length}: ${batch.length} pagine (${batch[0].filename} → ${batch[batch.length - 1].filename})`);

        try {
            const recipes = await extractRecipesFromText(batch);
            if (recipes && recipes.length > 0) {
                log.success(`Trovate ${recipes.length} ricette in questo batch.`);
                for (const recipe of recipes) {
                    recipe.slug = recipe.slug || recipe.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    if (!recipe.category) recipe.category = 'Pasta';

                    // ── DEDUPLICAZIONE ──
                    const dupCheck = checkDuplicate(recipe, existingRecipes, extractedSlugs);
                    if (dupCheck.isDuplicate) {
                        totalDuplicates++;
                        log.warn(`⚠️  DUPLICATO: "${recipe.title}" (${recipe.slug}) → già esistente come "${dupCheck.existingTitle}" (${dupCheck.existingSlug})`);
                        continue;
                    }

                    // Segna come estratto
                    extractedSlugs.add(recipe.slug);

                    // ── ARRICCHIMENTO SerpAPI ──
                    if (args['no-enrich'] !== true) {
                        try {
                            await enrichWithRealSources(recipe);
                        } catch (err) {
                            log.warn(`Arricchimento fallito per "${recipe.title}": ${err.message}. Procedo con dati OCR.`);
                        }
                    }

                    totalExtracted++;
                    const outputDir = resolve(ricettarioPath, 'ricette', 'pasta');
                    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

                    // Immagine
                    if (args['no-image'] !== true) {
                        try {
                            const imageData = await findAndDownloadImage(recipe, ricettarioPath);
                            if (imageData) {
                                recipe.image = imageData.homeRelativePath;
                                recipe.imageAttribution = imageData.attribution;
                            }
                        } catch (err) {
                            log.warn(`Immagine per ${recipe.title} non trovata (${err.message}).`);
                        }
                    }

                    const outputFile = resolve(outputDir, `${recipe.slug}.json`);
                    writeFileSync(outputFile, JSON.stringify(recipe, null, 2), 'utf-8');

                    // Aggiungi alla mappa esistenti per dedup futuri batch
                    existingRecipes.set(recipe.slug, recipe.title);

                    if (args['no-inject'] !== true) {
                        try { injectCard(recipe, ricettarioPath); }
                        catch { log.warn(`Errore inject card per ${recipe.title}.`); }
                    }

                    log.success(`Salvata: ${recipe.title} -> ricette/pasta/${recipe.slug}.json`);
                }
            } else {
                log.info('Nessuna ricetta trovata in questo batch.');
            }

            // Segna solo le pagine NON-overlap come processate
            for (const page of batch.filter(p => !p.isOverlap)) {
                processedIndex[page.filename] = {
                    processedAt: new Date().toISOString(),
                    recipesFound: recipes?.length || 0,
                    mode: 'surya-ocr'
                };
            }
            saveIndex();

        } catch (err) {
            log.error(`Errore durante estrazione batch ${b + 1}: ${err.message}`);
            for (const page of batch.filter(p => !p.isOverlap)) {
                processedIndex[page.filename] = {
                    processedAt: new Date().toISOString(),
                    error: err.message,
                    mode: 'surya-ocr'
                };
            }
            saveIndex();
        }

        // Pausa tra batch per rate limit
        if (b < pendingBatches.length - 1) {
            log.debug('Attesa per rate limit API (2s)...');
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    log.success(`\n${'═'.repeat(50)}`);
    log.success(`TRASCRIZIONE COMPLETATA!`);
    log.success(`Estratte: ${totalExtracted} ricette`);
    if (totalDuplicates > 0) log.warn(`Duplicati saltati: ${totalDuplicates}`);
    log.success(`${'═'.repeat(50)}`);
}

// ── UTILITY: Carica ricette esistenti su disco ──

function loadExistingRecipes(ricettarioPath) {
    const existing = new Map(); // slug → title
    const recipeDirs = [
        resolve(ricettarioPath, 'ricette', 'pasta'),
        resolve(ricettarioPath, 'ricette', 'pane'),
        resolve(ricettarioPath, 'ricette', 'pizza'),
        resolve(ricettarioPath, 'ricette', 'dolci'),
        resolve(ricettarioPath, 'ricette', 'lievitati')
    ];

    for (const dir of recipeDirs) {
        if (!existsSync(dir)) continue;
        const files = readdirSync(dir).filter(f => f.endsWith('.json'));
        for (const file of files) {
            const slug = file.replace('.json', '');
            // Estrai titolo dal file JSON
            try {
                const data = JSON.parse(readFileSync(resolve(dir, file), 'utf-8'));
                existing.set(slug, data.title || slug);
            } catch {
                existing.set(slug, slug);
            }
        }
    }

    return existing;
}

// ── UTILITY: Check duplicato ──

function checkDuplicate(recipe, existingRecipes, extractedSlugs) {
    const slug = recipe.slug;
    const title = recipe.title.toLowerCase().trim();

    // 1. Slug identico (già su disco o già estratto in questo run)
    if (existingRecipes.has(slug)) {
        return { isDuplicate: true, existingSlug: slug, existingTitle: existingRecipes.get(slug) };
    }
    if (extractedSlugs.has(slug)) {
        return { isDuplicate: true, existingSlug: slug, existingTitle: '(estratta in questo run)' };
    }

    // 2. Titolo molto simile (fuzzy match)
    for (const [existSlug, existTitle] of existingRecipes) {
        if (isSimilarTitle(title, existTitle.toLowerCase())) {
            return { isDuplicate: true, existingSlug: existSlug, existingTitle: existTitle };
        }
    }

    return { isDuplicate: false };
}

function isSimilarTitle(a, b) {
    // Normalizza: rimuovi "philips", "pasta maker", prefissi, suffissi comuni
    const normalize = (s) => s
        .replace(/philips/gi, '')
        .replace(/pasta\s*maker/gi, '')
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const na = normalize(a);
    const nb = normalize(b);

    // Match esatto dopo normalizzazione
    if (na === nb) return true;

    // Uno contiene l'altro (>80% della lunghezza)
    if (na.length > 4 && nb.length > 4) {
        if (na.includes(nb) || nb.includes(na)) return true;
    }

    // Parole chiave comuni (>70% overlap)
    const wordsA = new Set(na.split(' ').filter(w => w.length > 2));
    const wordsB = new Set(nb.split(' ').filter(w => w.length > 2));
    if (wordsA.size >= 2 && wordsB.size >= 2) {
        const intersection = [...wordsA].filter(w => wordsB.has(w));
        const overlap = intersection.length / Math.min(wordsA.size, wordsB.size);
        if (overlap >= 0.7) return true;
    }

    return false;
}

// ── UTILITY: Arricchimento SerpAPI + Secondo Claude Call ──

async function enrichWithRealSources(recipe) {
    const { searchRealSources, scrapeRecipePage } = await import('../validator.js');
    const { callClaude, parseClaudeJson } = await import('../enhancer.js');

    const searchQuery = `ricetta ${recipe.title} pasta consigli trucchi`;
    log.info(`🔍 SerpAPI: cerco fonti per "${recipe.title}"...`);

    const sources = await searchRealSources(searchQuery);
    if (!sources || sources.length === 0) {
        log.debug(`Nessuna fonte trovata per "${recipe.title}".`);
        return;
    }

    log.info(`📡 Trovate ${sources.length} fonti, scraping migliori 3...`);
    const scrapedData = [];

    for (const source of sources.slice(0, 3)) {
        try {
            const data = await scrapeRecipePage(source.url);
            if (data) {
                scrapedData.push({
                    domain: source.domain,
                    snippet: source.snippet || '',
                    steps: (data.steps || []).slice(0, 5).join(' '),
                    ingredients: (data.ingredients || []).slice(0, 10).join(', ')
                });
                log.debug(`   ✅ ${source.domain}`);
            }
        } catch {
            // Ignora errori scraping
        }
        await new Promise(r => setTimeout(r, 300));
    }

    if (scrapedData.length === 0) return;

    // ── SECONDO CLAUDE CALL: arricchimento ──
    const sourcesText = scrapedData.map((s, i) =>
        `Fonte ${i + 1} (${s.domain}):\n${s.snippet}\nPassaggi: ${s.steps}\nIngredienti menzionati: ${s.ingredients}`
    ).join('\n\n');

    const enrichPrompt = `Hai questa ricetta Philips Pasta Maker:
Titolo: ${recipe.title}
Ingredienti impasto: ${recipe.ingredients.filter(i => i.note?.includes('impasto')).map(i => `${i.name} ${i.grams}g`).join(', ')}
Ingredienti condimento: ${recipe.ingredients.filter(i => !i.note?.includes('impasto')).map(i => `${i.name} ${i.grams}g`).join(', ') || 'nessuno'}

Ecco dati REALI da fonti autorevoli italiane su questa ricetta:
${sourcesText}

Basandoti SOLO sulle fonti reali sopra, genera un JSON con SOLO queste 3 cose:
1. "proTips": array di 2-4 consigli PRO da maestro (trucchi, segreti veri trovati nelle fonti)
2. "glossary": array di 1-3 termini tecnici con definizione (es. {"term": "Incordatura", "definition": "..."})
3. "flourTable": array di 0-2 farine consigliate con marca reale (es. {"type": "Semola rimacinata", "w": "250-280", "brands": "Molino Caputo, De Cecco"})

⚠️ NON modificare ingredienti o dosi. NON inventare nulla. Usa SOLO dati dalle fonti.
Rispondi SOLO con il JSON oggetto (non array). Niente markdown.`;

    try {
        const enrichText = await callClaude({
            maxTokens: 2048,
            messages: [
                { role: 'user', content: enrichPrompt },
                { role: 'assistant', content: '{' }
            ],
        });

        const enrichData = JSON.parse('{' + enrichText);

        // Applica arricchimento — SOLO campi aggiuntivi, mai ingredienti
        if (enrichData.proTips?.length > 0) {
            recipe.proTips = [...(recipe.proTips || []), ...enrichData.proTips];
        }
        if (enrichData.glossary?.length > 0) {
            recipe.glossary = [...(recipe.glossary || []), ...enrichData.glossary];
        }
        if (enrichData.flourTable?.length > 0) {
            recipe.flourTable = [...(recipe.flourTable || []), ...enrichData.flourTable];
        }

        recipe._enriched = true;
        recipe._sourcesCount = scrapedData.length;
        recipe._sourcesDomains = scrapedData.map(s => s.domain);

        log.success(`Arricchita "${recipe.title}" con ${scrapedData.length} fonti: ${scrapedData.map(s => s.domain).join(', ')}`);
    } catch (err) {
        log.warn(`Arricchimento Claude fallito per "${recipe.title}": ${err.message}`);
    }
}
