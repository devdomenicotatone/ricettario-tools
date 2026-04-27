/**
 * ROUTES — API endpoints per la Dashboard
 *
 * Ogni endpoint avvia il corrispondente comando CLI
 * in un job context con output streaming via WebSocket.
 */

import { resolve, dirname } from 'path';
import { existsSync, readdirSync, readFileSync, statSync, renameSync, mkdirSync, writeFileSync, cpSync, rmSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { createJobContext, withOutputCapture } from './ws-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let jobCounter = 0;

function getRicettarioPath(body) {
    return resolve(
        process.cwd(),
        body?.output || process.env.RICETTARIO_PATH || '../Ricettario'
    );
}

function findRecipeJsonDynamic(ricettarioPath, CATEGORY_FOLDERS, slug) {
    for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
        const candidate = resolve(ricettarioPath, 'ricette', folder, `${slug}.json`);
        if (existsSync(candidate)) return { jsonFile: candidate, category: cat };
    }
    const ricettePath = resolve(ricettarioPath, 'ricette');
    if (existsSync(ricettePath)) {
        for (const catDir of readdirSync(ricettePath)) {
            const candidate = resolve(ricettePath, catDir, `${slug}.json`);
            if (existsSync(candidate)) {
                const fallbackCat = catDir.charAt(0).toUpperCase() + catDir.slice(1);
                return { jsonFile: candidate, category: fallbackCat };
            }
        }
    }
    return { jsonFile: null, category: null };
}

export function setupRoutes(app) {

    // ── Ricette: lista tutte ──
    app.get('/api/ricette', (req, res) => {
        try {
            const ricettarioPath = getRicettarioPath();
            const recipesJsonPath = resolve(ricettarioPath, 'public', 'recipes.json');

            if (existsSync(recipesJsonPath)) {
                const data = JSON.parse(readFileSync(recipesJsonPath, 'utf-8'));
                // recipes.json può essere un oggetto {recipes: [...]} oppure un array
                const recipesArr = Array.isArray(data) ? data : (data.recipes || []);
                return res.json(recipesArr);
            }

            // Fallback: scan filesystem per JSON
            const ricettePath = resolve(ricettarioPath, 'ricette');
            const recipes = [];

            if (existsSync(ricettePath)) {
                for (const cat of readdirSync(ricettePath)) {
                    const catDir = resolve(ricettePath, cat);
                    if (!statSync(catDir).isDirectory()) continue;

                    for (const file of readdirSync(catDir)) {
                        if (file.endsWith('.json') && file !== 'index.json' && !file.includes('.backup.') && !file.includes('.pre-')) {
                            try {
                                const data = JSON.parse(readFileSync(resolve(catDir, file), 'utf-8'));
                                const slug = file.replace('.json', '');
                                recipes.push({
                                    slug,
                                    title: data.title,
                                    category: data.category || cat,
                                    categoryDir: cat,
                                    href: `ricette/${cat}/${slug}`,
                                    hydration: data.hydration,
                                    image: data.image,
                                    date: data.date,
                                    _generatedBy: data._generatedBy || null,
                                });
                            } catch {}
                        }
                    }
                }
            }

            res.json(recipes);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Ricetta singola: GET (per editor) ──
    app.get('/api/ricetta/:cat/:slug', (req, res) => {
        try {
            const { cat, slug } = req.params;
            const ricettarioPath = getRicettarioPath();
            const jsonFile = resolve(ricettarioPath, 'ricette', cat, `${slug}.json`);

            if (!existsSync(jsonFile)) {
                return res.status(404).json({ error: `Ricetta non trovata: ${cat}/${slug}` });
            }

            const recipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));
            res.json({ recipe, cat, slug, path: jsonFile });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Ricetta singola: PATCH (salvataggio editor) ──
    app.patch('/api/ricetta/:cat/:slug', async (req, res) => {
        try {
            const { cat, slug } = req.params;
            const { recipe: updatedRecipe, autoRegen } = req.body;
            const ricettarioPath = getRicettarioPath();
            const jsonFile = resolve(ricettarioPath, 'ricette', cat, `${slug}.json`);

            if (!existsSync(jsonFile)) {
                return res.status(404).json({ error: `Ricetta non trovata: ${cat}/${slug}` });
            }

            // Backup pre-edit
            const backupFile = jsonFile.replace('.json', '.pre-edit.json');
            const originalContent = readFileSync(jsonFile, 'utf-8');
            writeFileSync(backupFile, originalContent, 'utf-8');

            // Salva il JSON aggiornato
            writeFileSync(jsonFile, JSON.stringify(updatedRecipe, null, 2), 'utf-8');

            // Sync cards (aggiorna recipes.json) — NO rigenerazione HTML (il sito è una SPA)
            let syncOk = false;
            if (autoRegen) {
                try {
                    const { syncCards } = await import('../commands/sync-cards.js');
                    await syncCards({});
                    syncOk = true;
                } catch (syncErr) {
                    console.error(`[PATCH] Sync cards fallito: ${syncErr.message}`);
                }
            }

            res.json({ ok: true, slug, cat, syncOk });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Genera da nome o url(s) ──
    app.post('/api/genera', async (req, res) => {
        const { nome, url, urls, tipo, note, noImage, preview, aiModel, keepExisting } = req.body;
        
        const isBatch = Array.isArray(urls) && urls.length > 0;
        const targetUrls = isBatch ? urls : (url ? [url] : []);
        
        const jobId = `gen-${++jobCounter}`;
        let jobName = '';
        if (nome) jobName = `Genera: ${nome}`;
        else if (isBatch) jobName = `Scraping: ${targetUrls.length} ricette`;
        else jobName = `Scraping: ${url}`;
        
        const ctx = createJobContext(jobId, jobName);
        res.json({ jobId, status: 'started' });

        try {
            const { genera } = await import('../commands/genera.js');
            await withOutputCapture(ctx, async () => {
                if (nome) {
                    const args = { nome };
                    if (tipo) args.tipo = tipo;
                    if (note) args.note = note;
                    if (noImage) args['no-image'] = true;
                    if (aiModel) args.aiModel = aiModel;
                    if (keepExisting) args.keepExisting = true;
                    await genera(args);
                } else if (targetUrls.length > 0) {
                    if (isBatch) ctx.log(`🔄 Avvio batch scraping su ${targetUrls.length} URL...\n`);
                    for (const u of targetUrls) {
                        const args = { url: u };
                        if (tipo) args.tipo = tipo;
                        if (note) args.note = note;
                        if (noImage) args['no-image'] = true;
                        if (aiModel) args.aiModel = aiModel;
                        if (keepExisting) args.keepExisting = true;
                        
                        if (isBatch) ctx.log(`\n🔜 Processo: ${u}...`);
                        await genera(args);
                    }
                }
            });
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Genera da testo ──
    app.post('/api/testo', async (req, res) => {
        const { text, tipo, aiModel } = req.body;
        const jobId = `txt-${++jobCounter}`;
        const ctx = createJobContext(jobId, `Testo: ${(text || '').substring(0, 40)}...`);
        res.json({ jobId, status: 'started' });

        try {
            // Salva il testo in un file temporaneo
            const tmpFile = resolve(process.cwd(), 'data', '_tmp_testo.txt');
            const { writeFileSync } = await import('fs');
            writeFileSync(tmpFile, text, 'utf-8');

            const { testo } = await import('../commands/testo.js');
            const args = { testo: tmpFile };
            if (tipo) args.tipo = tipo;
            if (aiModel) args.aiModel = aiModel;

            await withOutputCapture(ctx, () => testo(args));
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Scopri ricette ──
    app.post('/api/scopri', async (req, res) => {
        const { query, quante } = req.body;
        const jobId = `scp-${++jobCounter}`;
        const ctx = createJobContext(jobId, `Scopri: ${query}`);
        res.json({ jobId, status: 'started' });

        try {
            const { scopri } = await import('../commands/scopri.js');
            await withOutputCapture(ctx, () => scopri({ scopri: query, quante: String(quante || 5) }));
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Scopri ricette (M-UI Synchronous REST endpoint) ──
    app.post('/api/scopri-search', async (req, res) => {
        const { query, quante } = req.body;
        try {
            const { discoverRecipes } = await import('../discovery.js');
            const results = await discoverRecipes(query, Number(quante) || 10);
            res.json({ results });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });




    // ── Refresh Image (con image picker) ──
    app.post('/api/refresh-image', async (req, res) => {
        const { slug, forceRefresh } = req.body;
        const jobId = `img-${++jobCounter}`;
        const ctx = createJobContext(jobId, `Refresh Image: ${slug}`);

        try {
            const ricettarioPath = getRicettarioPath();
            // Importa searchAllProviders per restituire i risultati alla UI
            const { searchAllProviders } = await import('../image-finder.js');
            const { CATEGORY_FOLDERS } = await import('../constants.js');
            const { resolve } = await import('path');
            const { existsSync, readFileSync, writeFileSync } = await import('fs');

            // Trova il JSON
            const found = findRecipeJsonDynamic(ricettarioPath, CATEGORY_FOLDERS, slug);
            let jsonFile = found.jsonFile;
            let category = found.category;

            if (!jsonFile) {
                return res.status(404).json({ error: `JSON non trovato per "${slug}"` });
            }

            const recipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));

            // Gestione Cache
            const cachePath = resolve(process.cwd(), 'data', 'image-cache.json');
            let cache = {};
            if (existsSync(cachePath)) {
                try { cache = JSON.parse(readFileSync(cachePath, 'utf-8')); } catch (e) {}
            }

            if (!forceRefresh && cache[slug] && cache[slug].providerResults) {
                ctx.log('⚡ Immagini caricate istantaneamente dalla cache locale');
                ctx.end();
                return res.json({
                    jobId,
                    slug,
                    category,
                    jsonFile,
                    recipeName: recipe.title,
                    providerResults: cache[slug].providerResults,
                });
            }

            ctx.log('🔍 Ricerca su tutti i provider...');
            const providerResults = await withOutputCapture(ctx, () =>
                searchAllProviders(recipe.title, recipe.category || category, recipe.imageKeywords || [])
            );

            // Salva nella cache
            cache[slug] = { providerResults, timestamp: Date.now() };
            writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');

            ctx.end();
            res.json({
                jobId,
                slug,
                category,
                jsonFile,
                recipeName: recipe.title,
                providerResults,
            });
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end();
            res.status(500).json({ error: err.message });
        }
    });

    // ── Conferma immagine selezionata ──
    app.post('/api/refresh-image/confirm', async (req, res) => {
        const { slug, image, category } = req.body;
        const jobId = `imgc-${++jobCounter}`;
        const ctx = createJobContext(jobId, `Download: ${slug}`);
        res.json({ jobId, status: 'started' });

        try {
            const ricettarioPath = getRicettarioPath();
            const { downloadImage, buildAttribution } = await import('../image-finder.js');
            const { CATEGORY_FOLDERS } = await import('../constants.js');
            const { writeFileSync } = await import('fs');

            const catFolder = CATEGORY_FOLDERS[category] || category?.toLowerCase() || 'pane';
            const localPath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}.webp`);
            const jsonFile = resolve(ricettarioPath, 'ricette', catFolder, `${slug}.json`);

            await withOutputCapture(ctx, async () => {
                // Download
                ctx.log(`⬇️ Scaricando da ${image.provider}...`);
                await downloadImage(image.url, localPath);
                ctx.log(`✅ Salvata: ${localPath}`);

                // Aggiorna JSON
                const recipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));
                recipe.image = `images/ricette/${catFolder}/${slug}.webp`;
                recipe.imageAttribution = buildAttribution(image);
                recipe._originalImageUrl = image.url;
                writeFileSync(jsonFile, JSON.stringify(recipe, null, 2), 'utf-8');
                ctx.log(`💾 JSON aggiornato`);

                // Sync cards
                const { syncCards } = await import('../commands/sync-cards.js');
                await syncCards({});
                ctx.log(`🔄 recipes.json sincronizzato`);
            });

            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Genera immagine AI (Nano Banana 2 / Gemini) ──
    app.post('/api/refresh-image/generate', async (req, res) => {
        const { slug, prompt, category, referenceImage } = req.body;
        const jobId = `img-ai-${++jobCounter}`;
        const ctx = createJobContext(jobId, `AI Generate: ${slug}`);
        res.json({ jobId, status: 'started' });

        try {
            const ricettarioPath = getRicettarioPath();
            const { generateImageWithGemini } = await import('../image-finder.js');
            const { CATEGORY_FOLDERS } = await import('../constants.js');
            const { writeFileSync } = await import('fs');

            const catFolder = CATEGORY_FOLDERS[category] || category?.toLowerCase() || 'pane';
            const localPathTemp = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}-temp.jpg`);
            const webpPath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}.webp`);
            const avifPath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}.avif`);
            const jsonFile = resolve(ricettarioPath, 'ricette', catFolder, `${slug}.json`);

            await withOutputCapture(ctx, async () => {
                const { readFileSync } = await import('fs');
                const recipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));

                ctx.log(`🧠 Analisi ricetta per crafting prompt avanzato...`);
                const { callGemini } = await import('../utils/api.js');
                
                const sysPrompt = `You are an expert food photographer and AI image prompt engineer. 
Your task is to write a highly detailed, visually descriptive prompt for Google Imagen 4.0 to generate a photo of the provided recipe. 
Focus exclusively on the visual appearance, key ingredients visible on the plate, lighting, and mood. 
CRITICAL RULES:
- The prompt MUST be in English.
- Keep it under 450 characters.
- ONLY output the raw prompt, nothing else.
- ALWAYS use exclusively POSITIVE framing. DO NOT use negative prompts (e.g., never write "NO salad" or "NO meat"), because image models suffer from the pink elephant paradox and will generate the forbidden items instead.
- If the recipe is a sauce, dressing, or dough, emphasize isolation: "A close-up macro shot isolating only the sauce in a small bowl, filling the frame".
- NEVER place whole raw ingredients (like a whole raw egg yolk or unpeeled garlic) on top of the dish unless explicitly instructed by the recipe. Plating must be authentic, mixed, and realistic to the recipe description.
- Request professional food photography, high quality, cinematic lighting.`;

                const recipeContext = `User suggestion: ${prompt}\n\nRecipe Name: ${recipe.title || recipe.name}\nIngredients: ${JSON.stringify(recipe.ingredients || recipe.ingredientsGroups)}\nDescription: ${recipe.description || ''}`;

                let craftedPrompt = prompt; // Fallback
                try {
                    craftedPrompt = await callGemini({
                        system: sysPrompt,
                        messages: [{ role: 'user', content: recipeContext }]
                    });
                    ctx.log(`🎨 Prompt Generato: ${craftedPrompt}`);
                } catch(e) {
                    ctx.log(`⚠️ Impossibile craftare il prompt con Gemini: ${e.message}. Uso prompt base.`);
                }

                ctx.log(`🤖 Generazione in corso con Nano Banana 2${referenceImage ? ' + riferimento visivo' : ''}...`);
                const imageBuffer = await generateImageWithGemini(craftedPrompt, referenceImage || null);
                ctx.log(`✅ Immagine generata con successo!`);
                
                // Salviamo l'originale temporaneo
                writeFileSync(localPathTemp, imageBuffer);
                ctx.log(`💾 Ottimizzazione formati...`);

                try {
                    const sharp = (await import('sharp')).default;
                    await sharp(imageBuffer)
                        .resize({ width: 1800, withoutEnlargement: true })
                        .webp({ quality: 82 })
                        .toFile(webpPath);
                    await sharp(imageBuffer)
                        .resize({ width: 1800, withoutEnlargement: true })
                        .avif({ quality: 50 })
                        .toFile(avifPath);
                    
                    const { unlinkSync } = await import('fs');
                    unlinkSync(localPathTemp); // rimuove il temp
                } catch (sharpErr) {
                    ctx.log(`⚠️ Errore sharp: ${sharpErr.message}, salvo come webp direttamente`);
                    writeFileSync(webpPath, imageBuffer); // fallback
                }

                // Aggiorna JSON
                const currentRecipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));
                currentRecipe.image = `images/ricette/${catFolder}/${slug}.webp`;
                currentRecipe.imageAttribution = "📷 Foto: Generata da AI (Nano Banana 2)";
                currentRecipe._originalImageUrl = ""; // non c'è URL originale
                writeFileSync(jsonFile, JSON.stringify(currentRecipe, null, 2), 'utf-8');
                ctx.log(`💾 JSON aggiornato`);

                // Sync cards
                const { syncCards } = await import('../commands/sync-cards.js');
                await syncCards({});
                ctx.log(`🔄 recipes.json sincronizzato`);
            });

            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Qualità (pipeline unificata — sostituisce valida + verifica) ──
    async function handleQualita(req, res) {
        const { slug, slugs, grounding, geminiModel } = req.body || {};
        const batchSlugs = slugs || (slug ? [slug] : null);
        const groundingEnabled = grounding === true;
        const label = batchSlugs
            ? `Qualità: ${batchSlugs.length} ricett${batchSlugs.length === 1 ? 'a' : 'e'}${groundingEnabled ? ' + Web' : ''}`
            : 'Qualità tutte';
        const jobId = `qlt-${++jobCounter}`;
        const ctx = createJobContext(jobId, label);
        res.json({ jobId, status: 'started' });

        try {
            if (batchSlugs) {
                const { CATEGORY_FOLDERS } = await import('../constants.js');
                const { analyzeQuality } = await import('../quality.js');
                const ricettarioPath = getRicettarioPath();

                await withOutputCapture(ctx, async () => {
                    ctx.log(`🔍 Analisi qualità${groundingEnabled ? ' + fonti web' : ''} di ${batchSlugs.length} ricette...\n`);
                    for (const s of batchSlugs) {
                        let jsonFile = null;
                        for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
                            const candidate = resolve(ricettarioPath, 'ricette', folder, `${s}.json`);
                            if (existsSync(candidate)) { jsonFile = candidate; break; }
                        }
                        if (!jsonFile) { ctx.log(`  ⚠️ ${s}: non trovato`); continue; }

                        try {
                            const { recipe, result } = await analyzeQuality(jsonFile, { grounding: groundingEnabled, geminiModel });
                            const emoji = result.score >= 80 ? '🟢' : result.score >= 60 ? '🟡' : '🔴';
                            ctx.log(`  ${emoji} ${result.score}/100 — ${recipe.title}`);
                            if (result.schema && !result.schema.pass) {
                                ctx.log(`     📐 Schema: ${result.schema.errors.length} errori`);
                            }
                            if (result.issues?.length > 0) {
                                result.issues.forEach(i => ctx.log(`     ${i.severity} [${i.area}] ${i.message}`));
                            }
                            if (result.gemini) {
                                ctx.log(`     🤖 Gemini: ${result.gemini.score}/100 — ${result.gemini.verdict}`);
                            }
                            if (result.grounding) {
                                ctx.log(`     🌐 Fonti: ${result.grounding.sourcesCount} (${result.grounding.sources.map(s => s.domain).join(', ')})`);
                            }
                        } catch (err) {
                            ctx.log(`  ❌ ${s}: ${err.message}`);
                        }
                    }
                });
            }
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    }

    app.post('/api/qualita', handleQualita);

    // Backward-compat: /api/verifica → qualità senza grounding
    app.post('/api/verifica', handleQualita);
    // Backward-compat: /api/valida → qualità CON grounding
    app.post('/api/valida', (req, res) => {
        req.body = { ...(req.body || {}), grounding: true };
        handleQualita(req, res);
    });



    // ── Quality Index (per badge dashboard) ──
    app.get('/api/quality-index', async (req, res) => {
        try {
            const { loadQualityIndex } = await import('../quality.js');
            res.json(loadQualityIndex());
        } catch (err) {
            res.json({});
        }
    });

    // ── Quality Report (per modal dashboard) ──
    app.get('/api/quality-report/:slug', async (req, res) => {
        const slug = req.params.slug;
        const ricettarioPath = getRicettarioPath();

        try {
            const { CATEGORY_FOLDERS } = await import('../constants.js');
            for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
                const reportPath = resolve(ricettarioPath, 'ricette', folder, `${slug}.qualita.md`);
                if (existsSync(reportPath)) {
                    const content = readFileSync(reportPath, 'utf-8');
                    return res.json({ slug, report: content });
                }
            }
            res.status(404).json({ error: `Nessun report qualità trovato per "${slug}"` });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Qualità Fix (applica correzioni AI alla ricetta) ──
    app.post('/api/qualita/fix', async (req, res) => {
        const { slug, slugs, force, geminiModel } = req.body || {};
        const batchSlugs = slugs || (slug ? [slug] : null);
        if (!batchSlugs?.length) return res.status(400).json({ error: 'Nessun slug' });

        const jobId = `fix-${++jobCounter}`;
        const ctx = createJobContext(jobId, `Fix: ${batchSlugs.length} ricett${batchSlugs.length === 1 ? 'a' : 'e'}`);
        res.json({ jobId, status: 'started' });

        try {
            const { CATEGORY_FOLDERS } = await import('../constants.js');
            const { loadQualityIndex } = await import('../quality.js');
            const { callClaude, parseClaudeJson } = await import('../utils/api.js');
            const { getSchemaPromptDescription, validateRecipeSchema } = await import('../recipe-schema.js');
            const ricettarioPath = getRicettarioPath();
            const qualityIndex = loadQualityIndex();

            await withOutputCapture(ctx, async () => {
                ctx.log(`🔧 Applicazione fix AI a ${batchSlugs.length} ricette...\n`);

                for (const s of batchSlugs) {
                    const scoreData = qualityIndex[s];
                    if (!force && (!scoreData || scoreData.score >= 85)) {
                        ctx.log(`  ⏭️ ${s}: score ${scoreData?.score || '?'}/100 — skip (>= 85)`);
                        continue;
                    }

                    // Trova JSON
                    let jsonFile = null;
                    for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
                        const candidate = resolve(ricettarioPath, 'ricette', folder, `${s}.json`);
                        if (existsSync(candidate)) { jsonFile = candidate; break; }
                    }
                    if (!jsonFile) { ctx.log(`  ⚠️ ${s}: non trovato`); continue; }

                    // Leggi report qualità
                    const reportPath = jsonFile.replace('.json', '.qualita.md');
                    const report = existsSync(reportPath) ? readFileSync(reportPath, 'utf-8') : null;
                    if (!report) {
                        ctx.log(`  ⚠️ ${s}: nessun report qualità — esegui prima l'analisi`);
                        continue;
                    }

                    try {
                        const recipeJson = readFileSync(jsonFile, 'utf-8');
                        ctx.log(`  🔧 ${s}: invio a Claude per correzione...`);

                        const fixPrompt = `Correggi questa ricetta JSON basandoti ESCLUSIVAMENTE sul report di qualità.

══ SCHEMA JSON OBBLIGATORIO — RISPETTA QUESTA STRUTTURA ══
${getSchemaPromptDescription()}

⚠️ STRUTTURA ingredientGroups (OBBLIGATORIA — mai inventare formati diversi):
- Ogni gruppo DEVE avere: { "group": "Nome Gruppo", "items": [ { "name": "...", "grams": N, "note": "...", "tokenId": "..." } ] }
- Il campo si chiama "group" (NON "label", NON "title")
- Il campo items contiene gli oggetti ingrediente completi (NON array di stringhe, NON refs)
- "ingredients" deve essere SEMPRE un array vuoto []
- Se la ricetta ha un solo componente, usa ingredientGroups con un singolo gruppo

══ REPORT QUALITÀ ══
${report}

══ RICETTA JSON ORIGINALE ══
${recipeJson}

REGOLE TASSATIVE — VIOLARNE ANCHE UNA SOLA INVALIDA IL FIX:
1. Restituisci SOLO il JSON corretto, nessun testo prima o dopo
2. NON cambiare la struttura del JSON (stessi campi, stessi nomi chiave)
3. Correggi SOLO ed ESCLUSIVAMENTE i problemi segnalati nel report (severity ❌ e ⚠️)
4. NON TOCCARE MAI questi campi a meno che il report non li menzioni esplicitamente come errore:
   - hydration, totalFlour, targetTemp, fermentation
   - grams degli ingredienti (NON cambiare le quantità!)
   - slug, category, image, tags, imageKeywords
5. Se il report segnala un problema di TESTO (token invertiti, refusi, istruzioni errate), correggi SOLO il testo specificato
6. NON "migliorare" o "ottimizzare" la ricetta — il tuo compito è SOLO correggere gli errori segnalati
7. Se un ingrediente è nel gruppo sbagliato, spostalo SENZA cambiarne la quantità
8. Mantieni lo stesso stile e livello di dettaglio del testo originale
9. OGNI campo non menzionato nel report DEVE restare IDENTICO byte per byte
10. Se il report indica che ingredientGroups deve avere almeno 1 gruppo, sposta gli ingredienti da "ingredients" dentro ingredientGroups e svuota ingredients`;

                        const fixedText = await callClaude({
                            model: 'claude-sonnet-4-6',
                            maxTokens: 16000,
                            system: 'Sei un correttore chirurgico di ricette JSON. Il tuo UNICO compito è applicare le correzioni ESATTE descritte nel report di qualità. NON modificare NULLA che non sia esplicitamente segnalato come errore. NON cambiare quantità, idratazione, o metadata a meno che il report non lo richieda. RISPETTA SEMPRE la struttura dello schema fornito — usa ESATTAMENTE i nomi dei campi indicati ("group" e "items" per ingredientGroups, MAI "label" o "refs"). Restituisci SOLO JSON valido.',
                            messages: [{ role: 'user', content: fixPrompt }],
                        });

                        // Parsa e valida
                        const fixed = parseClaudeJson(fixedText);
                        if (!fixed?.title) throw new Error('JSON corretto non valido');

                        // Validazione schema post-fix: verifica che il fix non abbia peggiorato la situazione
                        const postFixValidation = validateRecipeSchema(fixed);
                        if (postFixValidation.errors.length > 0) {
                            ctx.log(`  ⚠️ ${s}: Fix ha generato ${postFixValidation.errors.length} errori schema:`);
                            postFixValidation.errors.forEach(e => ctx.log(`     ❌ ${e}`));
                            ctx.log(`  ⏭️ ${s}: Fix RIFIUTATO — il JSON originale è mantenuto`);
                            continue;
                        }

                        // Backup
                        const backupPath = jsonFile.replace('.json', '.backup.json');
                        writeFileSync(backupPath, recipeJson, 'utf-8');

                        // Salva
                        writeFileSync(jsonFile, JSON.stringify(fixed, null, 2), 'utf-8');
                        ctx.log(`  ✅ ${s}: corretto (backup salvato)`);

                        // Auto-revalidation: rilancia qualità per aggiornare report e badge
                        try {
                            const { analyzeQuality, loadQualityIndex, saveQualityIndex } = await import('../quality.js');
                            ctx.log(`  🔄 ${s}: ri-validazione in corso...`);
                            const { result } = await analyzeQuality(jsonFile, { geminiModel });
                            const emoji = result.score >= 80 ? '🟢' : result.score >= 60 ? '🟡' : '🔴';
                            ctx.log(`  ${emoji} ${s}: nuovo score ${result.score}/100`);

                            // Marca come fixata nell'indice
                            const qi = loadQualityIndex();
                            if (qi[s]) {
                                qi[s].fixed = true;
                                saveQualityIndex(qi);
                            }
                        } catch (revalErr) {
                            ctx.log(`  ⚠️ ${s}: ri-validazione fallita — ${revalErr.message}`);
                        }
                    } catch (err) {
                        ctx.log(`  ❌ ${s}: fix fallito — ${err.message}`);
                    }
                }
            });
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });
    // ── Profilo Sensoriale (AI) ──
    app.post('/api/qualita/sensory', async (req, res) => {
        const { slugs, slug } = req.body || {};
        const targetSlugs = slugs || (slug ? [slug] : []);
        
        if (targetSlugs.length === 0) return res.status(400).json({ error: 'Nessun slug fornito' });

        const jobId = `sns-${++jobCounter}`;
        const ctx = createJobContext(jobId, `Sensory: ${targetSlugs.length} ricette`);
        res.json({ jobId, status: 'started' });

        try {
            const { CATEGORY_FOLDERS } = await import('../constants.js');
            const { generateAnalyticsProfile } = await import('../sensory.js');
            const ricettarioPath = getRicettarioPath();

            await withOutputCapture(ctx, async () => {
                const { readFileSync, writeFileSync } = await import('fs');
                
                for (let i = 0; i < targetSlugs.length; i++) {
                    const currentSlug = targetSlugs[i];
                    ctx.log(`\n🧪 [${i+1}/${targetSlugs.length}] Inizio generazione per "${currentSlug}"...`);

                    let jsonFile = null;
                    for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
                        const candidate = resolve(ricettarioPath, 'ricette', folder, `${currentSlug}.json`);
                        if (existsSync(candidate)) { jsonFile = candidate; break; }
                    }
                    
                    if (!jsonFile) {
                        ctx.log(`❌ Ricetta non trovata: ${currentSlug}`);
                        continue;
                    }

                    const recipeJson = readFileSync(jsonFile, 'utf-8');
                    const recipeData = JSON.parse(recipeJson);

                    // Call agent
                    const analytics = await generateAnalyticsProfile(recipeData);
                    
                    // Assign back to recipe data
                    recipeData.sensoryProfile = analytics.sensory;
                    recipeData.nutrition = analytics.nutrition;

                    // Save
                    const backupPath = jsonFile.replace('.json', '.backup.json');
                    writeFileSync(backupPath, recipeJson, 'utf-8');
                    writeFileSync(jsonFile, JSON.stringify(recipeData, null, 2), 'utf-8');
                    
                    ctx.log(`✅ Profilo aggiunto con successo a ${currentSlug}`);
                }
                ctx.log(`\n🎉 Processo completato per ${targetSlugs.length} ricette!`);
            });
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Sync Cards ──

    app.post('/api/sync-cards', async (req, res) => {
        const jobId = `sync-${++jobCounter}`;
        const ctx = createJobContext(jobId, 'Sync Cards');
        res.json({ jobId, status: 'started' });

        try {
            const { syncCards } = await import('../commands/sync-cards.js');
            await withOutputCapture(ctx, () => syncCards({}));
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Elimina Ricetta ──
    app.post('/api/elimina', async (req, res) => {
        const { slugs } = req.body || {};
        if (!slugs?.length) return res.status(400).json({ error: 'Nessun slug fornito' });

        const jobId = `del-${++jobCounter}`;
        const ctx = createJobContext(jobId, `Elimina: ${slugs.length} ricette`);
        res.json({ jobId, status: 'started' });

        try {
            const { CATEGORY_FOLDERS } = await import('../constants.js');
            const { unlinkSync } = await import('fs');
            const ricettarioPath = getRicettarioPath();

            // ── Carica index immagini usate per pulizia ──
            const imageIndexFile = resolve(process.cwd(), 'data', 'used-images.json');
            let imageIndex = {};
            try { if (existsSync(imageIndexFile)) imageIndex = JSON.parse(readFileSync(imageIndexFile, 'utf-8')); } catch {}
            let imageIndexDirty = false;

            await withOutputCapture(ctx, async () => {
                ctx.log(`🗑️ Eliminazione di ${slugs.length} ricett${slugs.length === 1 ? 'a' : 'e'}...\n`);
                let deleted = 0;

                for (const slug of slugs) {
                    // Trova la cartella categoria
                    let found = false;
                    for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
                        const jsonFile = resolve(ricettarioPath, 'ricette', folder, `${slug}.json`);
                        const htmlFile = resolve(ricettarioPath, 'ricette', folder, `${slug}.html`);
                        if (!existsSync(jsonFile) && !existsSync(htmlFile)) continue;
                        found = true;

                        // ── Pulisci used-images.json: rimuovi URL dell'immagine ──
                        if (existsSync(jsonFile)) {
                            try {
                                const recipeData = JSON.parse(readFileSync(jsonFile, 'utf-8'));
                                const imgUrl = recipeData._originalImageUrl;
                                if (imgUrl && imageIndex[imgUrl]) {
                                    delete imageIndex[imgUrl];
                                    imageIndexDirty = true;
                                    ctx.log(`  🖼️ Rimossa da used-images: ${imgUrl.substring(0, 60)}...`);
                                }
                            } catch {}
                        }

                        // Cancella tutti i file associati
                        const filesToDelete = [
                            resolve(ricettarioPath, 'ricette', folder, `${slug}.json`),
                            resolve(ricettarioPath, 'ricette', folder, `${slug}.html`),
                            resolve(ricettarioPath, 'ricette', folder, `${slug}.validazione.md`),
                            resolve(ricettarioPath, 'ricette', folder, `${slug}.verifica.md`),
                            resolve(ricettarioPath, 'ricette', folder, `${slug}.qualita.md`),
                            resolve(ricettarioPath, 'ricette', folder, `${slug}.backup.json`),
                            resolve(ricettarioPath, 'public', 'images', 'ricette', folder, `${slug}.webp`),
                            resolve(ricettarioPath, 'public', 'images', 'ricette', folder, `${slug}.avif`),
                        ];

                        for (const f of filesToDelete) {
                            try {
                                if (existsSync(f)) {
                                    unlinkSync(f);
                                    ctx.log(`  ✅ ${f.split(/[/\\]/).pop()}`);
                                }
                            } catch (e) {
                                ctx.log(`  ⚠️ ${f.split(/[/\\]/).pop()}: ${e.message}`);
                            }
                        }

                        deleted++;
                        ctx.log(`  🗑️ "${slug}" eliminata da ${cat}\n`);
                        break;
                    }

                    if (!found) {
                        ctx.log(`  ⚠️ ${slug}: non trovata\n`);
                    }
                }

                // ── Salva index immagini pulito ──
                if (imageIndexDirty) {
                    writeFileSync(imageIndexFile, JSON.stringify(imageIndex, null, 2), 'utf-8');
                    ctx.log(`🖼️ used-images.json aggiornato (${Object.keys(imageIndex).length} immagini)`);
                }

                // Sync cards per aggiornare recipes.json
                ctx.log('🔄 Aggiornamento recipes.json...');
                const { syncCards } = await import('../commands/sync-cards.js');
                await syncCards({});

                // Rimuovi entry fantasma da quality-index.json
                try {
                    const { loadQualityIndex, saveQualityIndex } = await import('../quality.js');
                    const qi = loadQualityIndex();
                    let cleaned = false;
                    for (const s of slugs) {
                        if (qi[s]) { delete qi[s]; cleaned = true; }
                    }
                    if (cleaned) {
                        saveQualityIndex(qi);
                        ctx.log('📊 quality-index.json aggiornato');
                    }
                } catch {}

                ctx.log(`\n🎉 Eliminat${deleted === 1 ? 'a' : 'e'} ${deleted} ricett${deleted === 1 ? 'a' : 'e'}`);
            });

            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── SEO Suggestions ──
    app.get('/api/seo-suggestions', async (req, res) => {
        const category = req.query.category || 'Pane';
        const forceRefresh = req.query.refresh === 'true';

        try {
            const { getSeoSuggestions, getAvailableCategories } = await import('../seo-keywords.js');
            const categories = getAvailableCategories();

            // Rimosso il check restrittivo: !categories.includes(category) 
            // per abilitare generazioni dinamiche dall'AI

            const suggestions = await getSeoSuggestions(category, { forceRefresh });
            res.json({ category, suggestions, categories });
        } catch (err) {
            console.error('SEO Suggestions error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ── Cambia Categoria ──
    app.post('/api/cambia-categoria', async (req, res) => {
        const { slug, oldCategory, newCategory } = req.body;

        if (!slug || !oldCategory || !newCategory) {
            return res.status(400).json({ error: 'slug, oldCategory e newCategory sono obbligatori' });
        }
        if (oldCategory === newCategory) {
            return res.status(400).json({ error: 'La categoria è già la stessa' });
        }

        const jobId = `cat-${++jobCounter}`;
        const ctx = createJobContext(jobId, `Categoria: ${slug} → ${newCategory}`);
        res.json({ jobId, status: 'started' });

        try {
            const { CATEGORY_FOLDERS } = await import('../constants.js');
            const { syncCards } = await import('../commands/sync-cards.js');

            const ricettarioPath = getRicettarioPath();
            const oldFolder = CATEGORY_FOLDERS[oldCategory] || oldCategory.toLowerCase();
            const newFolder = CATEGORY_FOLDERS[newCategory] || newCategory.toLowerCase();

            // Paths vecchi
            const oldJsonFile = resolve(ricettarioPath, 'ricette', oldFolder, `${slug}.json`);
            const oldValidFile = resolve(ricettarioPath, 'ricette', oldFolder, `${slug}.validazione.md`);
            const oldImgWebp = resolve(ricettarioPath, 'public', 'images', 'ricette', oldFolder, `${slug}.webp`);
            const oldImgAvif = resolve(ricettarioPath, 'public', 'images', 'ricette', oldFolder, `${slug}.avif`);

            // Paths nuovi
            const newRecipeDir = resolve(ricettarioPath, 'ricette', newFolder);
            const newImgDir = resolve(ricettarioPath, 'public', 'images', 'ricette', newFolder);
            const newJsonFile = resolve(newRecipeDir, `${slug}.json`);
            const newValidFile = resolve(newRecipeDir, `${slug}.validazione.md`);
            const newImgWebp = resolve(newImgDir, `${slug}.webp`);
            const newImgAvif = resolve(newImgDir, `${slug}.avif`);

            // Extra files that might exist
            const extensionsToMove = ['.html', '.verifica.md', '.qualita.md', '.backup.json', '.pre-edit.json', '.md'];

            // Verifica che il JSON sorgente esista
            if (!existsSync(oldJsonFile)) {
                ctx.error(`❌ JSON non trovato: ${oldJsonFile}`);
                ctx.end(false);
                return;
            }

            // Crea cartelle destinazione se non esistono
            mkdirSync(newRecipeDir, { recursive: true });
            mkdirSync(newImgDir, { recursive: true });

            await withOutputCapture(ctx, async () => {
                // 1. Sposta JSON
                ctx.log(`📦 Spostamento file da ${oldFolder}/ → ${newFolder}/`);
                renameSync(oldJsonFile, newJsonFile);
                ctx.log(`  ✅ ${slug}.json`);

                // 2. Sposta validazione
                if (existsSync(oldValidFile)) {
                    renameSync(oldValidFile, newValidFile);
                    ctx.log(`  ✅ ${slug}.validazione.md`);
                }

                // 3. Sposta immagini (WebP + AVIF)
                if (existsSync(oldImgWebp)) {
                    renameSync(oldImgWebp, newImgWebp);
                    ctx.log(`  ✅ ${slug}.webp`);
                }
                if (existsSync(oldImgAvif)) {
                    renameSync(oldImgAvif, newImgAvif);
                    ctx.log(`  ✅ ${slug}.avif`);
                }

                // 3.5 Sposta altri file (html, md, backup)
                for (const ext of extensionsToMove) {
                    const oldPath = resolve(ricettarioPath, 'ricette', oldFolder, `${slug}${ext}`);
                    if (existsSync(oldPath)) {
                        renameSync(oldPath, resolve(newRecipeDir, `${slug}${ext}`));
                        ctx.log(`  ✅ ${slug}${ext}`);
                    }
                }

                // 4. Aggiorna JSON — category + image path
                ctx.log(`\n📝 Aggiornamento metadati...`);
                const recipe = JSON.parse(readFileSync(newJsonFile, 'utf-8'));
                recipe.category = newCategory;
                if (recipe.image) {
                    recipe.image = recipe.image.replace(
                        `images/ricette/${oldFolder}/`,
                        `images/ricette/${newFolder}/`
                    );
                }
                writeFileSync(newJsonFile, JSON.stringify(recipe, null, 2), 'utf-8');
                ctx.log(`  ✅ category: ${newCategory}`);
                ctx.log(`  ✅ image: ${recipe.image || 'nessuna'}`);

                // 5. Sync cards (ricostruisce recipes.json)
                ctx.log(`\n🔄 Sync cards...`);
                await syncCards({});
                ctx.log(`  ✅ recipes.json aggiornato`);

                ctx.log(`\n🎉 Categoria cambiata: "${slug}" → ${newCategory}`);
            });

            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Aggiungi Categoria (crea infrastruttura completa) ──
    app.post('/api/aggiungi-categoria', async (req, res) => {
        const { name } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'Nome categoria obbligatorio' });

        const categoryName = name.trim();
        const slug = categoryName.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

        const jobId = `cat-new-${++jobCounter}`;
        const ctx = createJobContext(jobId, `Nuova Categoria: ${categoryName}`);
        res.json({ jobId, status: 'started' });

        try {
            const ricettarioPath = getRicettarioPath();
            const { ALL_CATEGORIES, CATEGORY_FOLDERS, CATEGORIES_DATA } = await import('../constants.js');

            if (CATEGORY_FOLDERS[categoryName]) {
                ctx.log(`⚠️ La categoria "${categoryName}" esiste già`);
                ctx.end(false);
                return;
            }

            await withOutputCapture(ctx, async () => {
                // ── 1. AI: genera metadati categoria ──
                ctx.log('🧠 Generazione metadati con AI...');
                const { callGemini } = await import('../utils/api.js');

                const aiPrompt = `Per la categoria di ricette "${categoryName}", suggerisci i metadati.
Rispondi SOLO con un JSON valido (no markdown fences):
{
  "fluentEmojiFolder": "Nome Cartella GitHub esatto (es. 'Meat on bone', 'Cut of meat', 'Herb', 'Poultry leg')",
  "fluentEmojiSlug": "slug locale kebab-case (es. 'meat-on-bone', 'cut-of-meat')",
  "unicodeEmoji": "emoji unicode singola (es. 🥩)",
  "lucideIcon": "nome icona Lucide valida (es. 'beef', 'fish', 'egg', 'utensils', 'leaf', 'cherry', 'salad', 'flame', 'soup')",
  "color": "colore hex dashboard (evita #d4a574,#e74c3c,#27ae60,#f39c12,#3498db,#e91e63,#2ecc71,#9b59b6 già usati)",
  "title": "Titolo pagina categoria in italiano",
  "description": "Descrizione SEO breve in italiano (max 120 char)"
}
REGOLE:
- fluentEmojiFolder DEVE essere un nome emoji valido dal repo microsoft/fluentui-emoji (case-sensitive)
- Scegli un'emoji che rappresenti visivamente il tipo di cibo della categoria
- Il colore deve essere visivamente distinto dai colori già usati
- lucideIcon deve essere un'icona effettivamente esistente in Lucide`;

                let metadata;
                try {
                    const aiText = await callGemini({
                        model: 'gemini-2.5-flash',
                        messages: [{ role: 'user', content: aiPrompt }],
                    });
                    const cleaned = aiText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                    metadata = JSON.parse(cleaned);
                    ctx.log(`   ✅ Emoji: ${metadata.unicodeEmoji} ${metadata.fluentEmojiSlug}`);
                    ctx.log(`   ✅ Icona: ${metadata.lucideIcon} | Colore: ${metadata.color}`);
                    ctx.log(`   ✅ Titolo: ${metadata.title}`);
                } catch (aiErr) {
                    ctx.log(`   ⚠️ AI fallita: ${aiErr.message}, uso fallback`);
                    metadata = {
                        fluentEmojiFolder: 'Fork and knife',
                        fluentEmojiSlug: 'fork-and-knife',
                        unicodeEmoji: '🍽️',
                        lucideIcon: 'utensils',
                        color: '#1abc9c',
                        title: categoryName,
                        description: `Ricette di ${categoryName.toLowerCase()}.`,
                    };
                }

                // ── 2. Download emoji Fluent 3D da GitHub ──
                const emojiSlug = metadata.fluentEmojiSlug;
                const emojiFileName = metadata.fluentEmojiFolder.toLowerCase().replace(/\s+/g, '_');
                const githubUrl = `https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/${encodeURIComponent(metadata.fluentEmojiFolder)}/3D/${emojiFileName}_3d.png`;
                const emojiDir = resolve(ricettarioPath, 'public', 'images', 'emoji');
                const emojiPngPath = resolve(emojiDir, `${emojiSlug}.png`);

                ctx.log(`📥 Download emoji: ${githubUrl}`);
                let emojiDownloaded = false;
                try {
                    const resp = await fetch(githubUrl);
                    if (resp.ok) {
                        const buffer = Buffer.from(await resp.arrayBuffer());
                        writeFileSync(emojiPngPath, buffer);
                        ctx.log(`   ✅ Salvata: ${emojiSlug}.png (${(buffer.length / 1024).toFixed(0)} KB)`);
                        emojiDownloaded = true;

                        // Genera WebP + AVIF con Sharp
                        try {
                            const sharp = (await import('sharp')).default;
                            await sharp(buffer).webp({ quality: 80 }).toFile(resolve(emojiDir, `${emojiSlug}.webp`));
                            await sharp(buffer).avif({ quality: 50 }).toFile(resolve(emojiDir, `${emojiSlug}.avif`));
                            ctx.log(`   ✅ Ottimizzata: .webp + .avif`);
                        } catch (sharpErr) {
                            ctx.log(`   ⚠️ Sharp fallito: ${sharpErr.message} (PNG usabile comunque)`);
                        }
                    } else {
                        ctx.log(`   ⚠️ Download fallito (${resp.status}), uso fork-and-knife come fallback`);
                        metadata.fluentEmojiSlug = 'fork-and-knife';
                    }
                } catch (dlErr) {
                    ctx.log(`   ⚠️ Download errore: ${dlErr.message}, uso fork-and-knife`);
                    metadata.fluentEmojiSlug = 'fork-and-knife';
                }

                // ── 3. Crea cartelle ──
                const recipeDir = resolve(ricettarioPath, 'ricette', slug);
                const imgDir = resolve(ricettarioPath, 'public', 'images', 'ricette', slug);
                mkdirSync(recipeDir, { recursive: true });
                mkdirSync(imgDir, { recursive: true });
                ctx.log(`📁 Cartelle create: ricette/${slug}/ + images/ricette/${slug}/`);

                // ── 4. Aggiorna constants.js (backend) ──
                const constantsPath = resolve(process.cwd(), 'src', 'constants.js');
                let constantsContent = readFileSync(constantsPath, 'utf-8');
                const nextOrder = Object.keys(CATEGORIES_DATA).length + 1;

                // ── Helper: inserisci testo prima della chiusura di un blocco const ──
                function insertBeforeBlockClose(content, constName, closingStr, insertion) {
                    const declIdx = content.indexOf(`export const ${constName}`);
                    if (declIdx === -1) return content;
                    // Trova la chiusura del blocco (]; o };) DOPO la dichiarazione
                    const searchFrom = declIdx;
                    const closeIdx = content.indexOf(closingStr, searchFrom);
                    if (closeIdx === -1) return content;
                    // Inserisci prima della chiusura
                    return content.slice(0, closeIdx) + insertion + '\n' + content.slice(closeIdx);
                }

                // ALL_CATEGORIES: aggiungi prima di ];
                constantsContent = insertBeforeBlockClose(constantsContent, 'ALL_CATEGORIES',
                    '\n];', `,\n    '${categoryName}'`);
                // CATEGORY_FOLDERS: aggiungi prima di };
                constantsContent = insertBeforeBlockClose(constantsContent, 'CATEGORY_FOLDERS',
                    '\n};', `,\n    '${categoryName}': '${slug}'`);
                // CATEGORIES_DATA: aggiungi prima di };
                constantsContent = insertBeforeBlockClose(constantsContent, 'CATEGORIES_DATA',
                    '\n};', `\n    ${slug.replace(/-/g, '_')}: { emoji: '${metadata.unicodeEmoji}', label: '${categoryName}', order: ${nextOrder} },`);

                writeFileSync(constantsPath, constantsContent, 'utf-8');
                ctx.log(`💾 constants.js aggiornato`);

                // Aggiorna oggetti live in memoria (no restart necessario)
                ALL_CATEGORIES.push(categoryName);
                CATEGORY_FOLDERS[categoryName] = slug;
                const dataKey = slug.replace(/-/g, '_');
                CATEGORIES_DATA[dataKey] = { emoji: metadata.unicodeEmoji, label: categoryName, order: nextOrder };

                // ── 5. Aggiorna categories.js (frontend SPA) ──
                const categoriesPath = resolve(ricettarioPath, 'js', 'categories.js');
                let catContent = readFileSync(categoriesPath, 'utf-8');

                const catKey = slug.replace(/-/g, '_');
                const catEntry = `  ${catKey}: { name: '${categoryName}', emoji: '${metadata.fluentEmojiSlug}', title: '${metadata.title}', desc: '${metadata.description.replace(/'/g, "\\'")}' },`;
                catContent = insertBeforeBlockClose(catContent, 'CATEGORIES', '\n};', catEntry);
                // CATEGORY_ORDER: aggiungi prima di ];
                catContent = insertBeforeBlockClose(catContent, 'CATEGORY_ORDER',
                    '\n];', ` '${catKey}',`);

                writeFileSync(categoriesPath, catContent, 'utf-8');
                ctx.log(`💾 categories.js aggiornato`);

                // ── 6. Aggiorna emoji.js (frontend SPA) — EMOJI_MAP ──
                if (emojiDownloaded) {
                    const emojiJsPath = resolve(ricettarioPath, 'js', 'emoji.js');
                    let emojiContent = readFileSync(emojiJsPath, 'utf-8');
                    emojiContent = insertBeforeBlockClose(emojiContent, 'EMOJI_MAP',
                        '\n};', `  '${metadata.fluentEmojiSlug}': '${metadata.fluentEmojiSlug}',`);
                    writeFileSync(emojiJsPath, emojiContent, 'utf-8');
                    ctx.log(`💾 emoji.js aggiornato`);
                }

                // ── 7. Sync cards ──
                ctx.log('🔄 Sync cards...');
                const { syncCards } = await import('../commands/sync-cards.js');
                await syncCards({});
                ctx.log('✅ recipes.json sincronizzato');

                ctx.log(`\n🎉 Categoria "${categoryName}" creata con successo!`);
                ctx.log(`   📁 Slug: ${slug}`);
                ctx.log(`   ${metadata.unicodeEmoji} Emoji: ${metadata.fluentEmojiSlug}`);
                ctx.log(`   🎨 Colore: ${metadata.color}`);
                ctx.log(`   📄 Titolo: ${metadata.title}`);

                // Emetti evento per il frontend (data disponibile nel job context)
                ctx._categoryResult = {
                    name: categoryName,
                    slug,
                    emoji: metadata.unicodeEmoji,
                    fluentEmoji: metadata.fluentEmojiSlug,
                    lucideIcon: metadata.lucideIcon,
                    color: metadata.color,
                    title: metadata.title,
                    description: metadata.description,
                };
            });
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Rimuovi Categoria (soft-delete con backup) ──
    app.post('/api/rimuovi-categoria', async (req, res) => {
        const { name, moveTo } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'Nome categoria obbligatorio' });

        const { ALL_CATEGORIES, CATEGORY_FOLDERS, CATEGORIES_DATA } = await import('../constants.js');
        if (!ALL_CATEGORIES.includes(name)) return res.status(404).json({ error: `Categoria "${name}" non trovata` });
        if (moveTo && !ALL_CATEGORIES.includes(moveTo)) return res.status(400).json({ error: `Categoria destinazione "${moveTo}" non valida` });
        if (moveTo === name) return res.status(400).json({ error: 'Non puoi spostare le ricette nella stessa categoria' });

        const jobId = `rmcat-${++jobCounter}`;
        const ctx = createJobContext(jobId, `Rimuovi: ${name}`);
        res.json({ jobId, status: 'started' });

        try {
            await withOutputCapture(ctx, async () => {
                const ricettarioPath = getRicettarioPath();
                const slug = CATEGORY_FOLDERS[name] || name.toLowerCase().replace(/\s+/g, '-');
                const catKey = slug.replace(/-/g, '_');

                ctx.log(`🗑️ Rimozione categoria: "${name}" (slug: ${slug})`);

                // ── 1. Gestione ricette orfane ──
                const recipesDir = resolve(ricettarioPath, 'ricette', slug);
                const imagesDir = resolve(ricettarioPath, 'public', 'images', 'ricette', slug);
                let recipesCount = 0;

                if (existsSync(recipesDir)) {
                    const jsonFiles = readdirSync(recipesDir).filter(f => f.endsWith('.json') && !f.endsWith('.backup.json'));
                    recipesCount = jsonFiles.length;

                    if (recipesCount > 0 && moveTo) {
                        const destSlug = CATEGORY_FOLDERS[moveTo] || moveTo.toLowerCase().replace(/\s+/g, '-');
                        const destDir = resolve(ricettarioPath, 'ricette', destSlug);
                        const destImgDir = resolve(ricettarioPath, 'public', 'images', 'ricette', destSlug);
                        mkdirSync(destDir, { recursive: true });
                        mkdirSync(destImgDir, { recursive: true });

                        ctx.log(`\n📦 Spostamento ${recipesCount} ricette → ${moveTo}...\n`);

                        for (const file of readdirSync(recipesDir)) {
                            const src = resolve(recipesDir, file);
                            const dst = resolve(destDir, file);
                            try {
                                renameSync(src, dst);
                                // Se è il file .json principale, aggiorna il campo category
                                if (file.endsWith('.json') && !file.endsWith('.backup.json')) {
                                    try {
                                        const data = JSON.parse(readFileSync(dst, 'utf-8'));
                                        data.category = moveTo;
                                        writeFileSync(dst, JSON.stringify(data, null, 2), 'utf-8');
                                    } catch {}
                                }
                                ctx.log(`  ✅ ${file}`);
                            } catch (e) {
                                ctx.log(`  ⚠️ ${file}: ${e.message}`);
                            }
                        }

                        // Sposta anche le immagini
                        if (existsSync(imagesDir)) {
                            for (const imgFile of readdirSync(imagesDir)) {
                                try {
                                    renameSync(resolve(imagesDir, imgFile), resolve(destImgDir, imgFile));
                                    ctx.log(`  🖼️ ${imgFile}`);
                                } catch {}
                            }
                        }
                    } else if (recipesCount > 0) {
                        ctx.log(`\n📦 Backup ${recipesCount} ricette (nessuna destinazione)...`);
                    }
                }

                // ── 2. Backup della cartella (soft-delete) ──
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const backupBase = resolve(ricettarioPath, 'ricette', '.backup');
                mkdirSync(backupBase, { recursive: true });

                if (existsSync(recipesDir) && readdirSync(recipesDir).length > 0) {
                    const backupDir = resolve(backupBase, `${slug}_${timestamp}`);
                    cpSync(recipesDir, backupDir, { recursive: true });
                    ctx.log(`\n💾 Backup salvato in: ricette/.backup/${slug}_${timestamp}/`);
                }

                // Backup immagini ricette
                if (existsSync(imagesDir) && readdirSync(imagesDir).length > 0) {
                    const imgBackup = resolve(backupBase, `${slug}_images_${timestamp}`);
                    cpSync(imagesDir, imgBackup, { recursive: true });
                    ctx.log(`💾 Backup immagini in: ricette/.backup/${slug}_images_${timestamp}/`);
                }

                // ── 3. Rimuovi cartelle originali ──
                if (existsSync(recipesDir)) {
                    rmSync(recipesDir, { recursive: true, force: true });
                    ctx.log(`🗂️ Rimossa cartella: ricette/${slug}/`);
                }
                if (existsSync(imagesDir)) {
                    rmSync(imagesDir, { recursive: true, force: true });
                    ctx.log(`🗂️ Rimossa cartella: images/ricette/${slug}/`);
                }

                // ── 4. Rimuovi emoji PNG (se esclusiva) ──
                const dataKey = catKey;
                const catData = CATEGORIES_DATA[dataKey];
                if (catData) {
                    const emojiPng = resolve(ricettarioPath, 'public', 'images', 'emoji', `${catData.emoji?.replace(/:/g, '') || slug}.png`);
                    // Non rimuoviamo emoji usate da altre categorie — verifica
                    // Per ora le emoji le lasciamo, sono asset condivisi
                }

                // ── 5. Aggiorna constants.js ──
                const constantsPath = resolve(__dirname, '..', 'constants.js');
                let constantsContent = readFileSync(constantsPath, 'utf-8');

                // Helper: rimuovi una riga contenente un pattern da un blocco specifico
                function removeLineFromBlock(content, constName, pattern) {
                    const lines = content.split('\n');
                    const declIdx = lines.findIndex(l => l.includes(`export const ${constName}`));
                    if (declIdx === -1) return content;
                    // Trova la chiusura del blocco
                    let closeIdx = -1;
                    for (let i = declIdx + 1; i < lines.length; i++) {
                        if (lines[i].match(/^(};|];)/)) { closeIdx = i; break; }
                    }
                    if (closeIdx === -1) return content;
                    // Rimuovi la riga che matcha il pattern (tra decl e close)
                    for (let i = declIdx + 1; i < closeIdx; i++) {
                        if (lines[i].includes(pattern)) {
                            lines.splice(i, 1);
                            closeIdx--;
                            break;
                        }
                    }
                    // Pulisci trailing comma sull'ultimo elemento se necessario
                    if (closeIdx > 0 && lines[closeIdx - 1]) {
                        lines[closeIdx - 1] = lines[closeIdx - 1].replace(/,(\s*)$/, '$1');
                    }
                    return lines.join('\n');
                }

                constantsContent = removeLineFromBlock(constantsContent, 'ALL_CATEGORIES', `'${name}'`);
                constantsContent = removeLineFromBlock(constantsContent, 'CATEGORY_FOLDERS', `'${name}'`);
                constantsContent = removeLineFromBlock(constantsContent, 'CATEGORIES_DATA', `${catKey}:`);
                writeFileSync(constantsPath, constantsContent, 'utf-8');
                ctx.log(`💾 constants.js aggiornato`);

                // ── 6. Aggiorna categories.js (frontend SPA) ──
                const categoriesPath = resolve(ricettarioPath, 'js', 'categories.js');
                let catContent = readFileSync(categoriesPath, 'utf-8');
                catContent = removeLineFromBlock(catContent, 'CATEGORIES', `${catKey}:`);
                catContent = removeLineFromBlock(catContent, 'CATEGORY_ORDER', `'${catKey}'`);
                writeFileSync(categoriesPath, catContent, 'utf-8');
                ctx.log(`💾 categories.js aggiornato`);

                // ── 7. Aggiorna emoji.js se l'emoji era stata aggiunta ──
                const emojiJsPath = resolve(ricettarioPath, 'js', 'emoji.js');
                if (existsSync(emojiJsPath)) {
                    const catEmoji = catData?.emoji;
                    if (catEmoji) {
                        // Leggi categories.js per controllare che nessun'altra categoria usi la stessa emoji
                        const freshCatContent = readFileSync(categoriesPath, 'utf-8');
                        if (!freshCatContent.includes(`'${catEmoji}'`)) {
                            let emojiContent = readFileSync(emojiJsPath, 'utf-8');
                            emojiContent = removeLineFromBlock(emojiContent, 'EMOJI_MAP', `'${catEmoji}'`);
                            writeFileSync(emojiJsPath, emojiContent, 'utf-8');
                            ctx.log(`💾 emoji.js aggiornato (emoji ${catEmoji} rimossa)`);
                        }
                    }
                }

                // ── 8. Aggiorna oggetti live in memoria ──
                const idx = ALL_CATEGORIES.indexOf(name);
                if (idx !== -1) ALL_CATEGORIES.splice(idx, 1);
                delete CATEGORY_FOLDERS[name];
                delete CATEGORIES_DATA[catKey];

                // ── 9. Sync cards ──
                ctx.log('\n🔄 Sync cards...');
                const { syncCards } = await import('../commands/sync-cards.js');
                await syncCards({});
                ctx.log('✅ recipes.json sincronizzato');

                ctx.log(`\n🎉 Categoria "${name}" rimossa con successo!`);
                if (moveTo) ctx.log(`   📦 ${recipesCount} ricette spostate in "${moveTo}"`);
                ctx.log(`   💾 Backup disponibile in ricette/.backup/`);
            });
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Used Images Index: Info ──
    app.get('/api/used-images', (req, res) => {
        const imageIndexFile = resolve(process.cwd(), 'data', 'used-images.json');
        try {
            let index = {};
            if (existsSync(imageIndexFile)) {
                index = JSON.parse(readFileSync(imageIndexFile, 'utf-8'));
            }
            res.json({
                count: Object.keys(index).length,
                entries: index,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Used Images Index: Reset (svuota) ──
    app.post('/api/used-images/reset', (req, res) => {
        const imageIndexFile = resolve(process.cwd(), 'data', 'used-images.json');
        try {
            writeFileSync(imageIndexFile, '{}', 'utf-8');
            res.json({ ok: true, count: 0, message: 'Index resettato' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Used Images Index: Rebuild (ricostruisci da ricette esistenti) ──
    app.post('/api/used-images/rebuild', async (req, res) => {
        const jobId = `imgidx-${++jobCounter}`;
        const ctx = createJobContext(jobId, 'Rebuild Image Index');
        res.json({ jobId, status: 'started' });

        try {
            const { CATEGORY_FOLDERS } = await import('../constants.js');
            const ricettarioPath = getRicettarioPath();
            const imageIndexFile = resolve(process.cwd(), 'data', 'used-images.json');

            await withOutputCapture(ctx, async () => {
                ctx.log('🖼️ Ricostruzione index immagini usate...\n');
                const newIndex = {};
                let count = 0;

                for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
                    const catDir = resolve(ricettarioPath, 'ricette', folder);
                    if (!existsSync(catDir)) continue;

                    for (const file of readdirSync(catDir)) {
                        if (!file.endsWith('.json') || file === 'index.json' || file.endsWith('.backup.json') || file.endsWith('.qualita.json')) continue;
                        try {
                            const data = JSON.parse(readFileSync(resolve(catDir, file), 'utf-8'));
                            const slug = file.replace('.json', '');
                            if (data._originalImageUrl) {
                                newIndex[data._originalImageUrl] = slug;
                                count++;
                                ctx.log(`  ✅ ${slug} → ${data._originalImageUrl.substring(0, 60)}...`);
                            }
                        } catch {}
                    }
                }

                writeFileSync(imageIndexFile, JSON.stringify(newIndex, null, 2), 'utf-8');
                ctx.log(`\n🎉 Index ricostruito: ${count} immagini da ricette esistenti`);
            });

            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Gemini API Key Switching ──
    app.get('/api/gemini-key', async (req, res) => {
        try {
            const { getActiveGeminiSlot } = await import('../utils/api.js');
            res.json({
                activeSlot: getActiveGeminiSlot(),
                hasKey1: !!process.env.GEMINI_API_KEY,
                hasKey2: !!process.env.GEMINI_API_KEY2,
                key1Preview: process.env.GEMINI_API_KEY ? '...' + process.env.GEMINI_API_KEY.slice(-6) : null,
                key2Preview: process.env.GEMINI_API_KEY2 ? '...' + process.env.GEMINI_API_KEY2.slice(-6) : null,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/gemini-key', async (req, res) => {
        const { slot } = req.body;
        if (slot !== 1 && slot !== 2) {
            return res.status(400).json({ error: 'Slot deve essere 1 o 2' });
        }
        try {
            const { switchGeminiKey, getActiveGeminiSlot } = await import('../utils/api.js');
            switchGeminiKey(slot);
            res.json({
                ok: true,
                activeSlot: getActiveGeminiSlot(),
                message: `Gemini API Key switchata a slot ${slot}`,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Upload Image (Drag & Drop / Clipboard Paste) ──
    app.post('/api/upload-image', async (req, res) => {
        const { slug, category, imageBase64, imageUrl } = req.body;

        if (!slug || !category) {
            return res.status(400).json({ error: 'slug e category sono obbligatori' });
        }
        if (!imageBase64 && !imageUrl) {
            return res.status(400).json({ error: 'imageBase64 o imageUrl richiesto' });
        }

        const jobId = `upload-${++jobCounter}`;
        const ctx = createJobContext(jobId, `Upload Image: ${slug}`);
        res.json({ jobId, status: 'started' });

        try {
            const ricettarioPath = getRicettarioPath();
            const { CATEGORY_FOLDERS } = await import('../constants.js');
            const sharp = (await import('sharp')).default;

            const catFolder = CATEGORY_FOLDERS[category] || category?.toLowerCase() || 'pane';
            const webpPath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}.webp`);
            const avifPath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}.avif`);
            const jsonFile = resolve(ricettarioPath, 'ricette', catFolder, `${slug}.json`);

            // Assicurati che la directory esista
            const imgDir = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder);
            if (!existsSync(imgDir)) mkdirSync(imgDir, { recursive: true });

            await withOutputCapture(ctx, async () => {
                let imageBuffer;

                if (imageBase64) {
                    // Decodifica Base64 (rimuovi header data:image/...;base64, se presente)
                    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
                    imageBuffer = Buffer.from(base64Data, 'base64');
                    ctx.log(`📦 Immagine ricevuta: ${(imageBuffer.length / 1024).toFixed(0)} KB`);
                } else if (imageUrl) {
                    // Download da URL (drag da browser)
                    ctx.log(`⬇️ Download da URL: ${imageUrl}`);
                    const { downloadImage } = await import('../image-finder.js');
                    const tmpPath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}-tmp-upload.jpg`);
                    await downloadImage(imageUrl, tmpPath);
                    imageBuffer = readFileSync(tmpPath);
                    // Rimuovi il temporaneo
                    try { (await import('fs')).unlinkSync(tmpPath); } catch {}
                    ctx.log(`✅ Download completato: ${(imageBuffer.length / 1024).toFixed(0)} KB`);
                }

                // Sharp: resize + WebP + AVIF
                ctx.log(`🔄 Ottimizzazione: WebP + AVIF...`);
                await sharp(imageBuffer)
                    .resize({ width: 1800, withoutEnlargement: true })
                    .webp({ quality: 82 })
                    .toFile(webpPath);

                await sharp(imageBuffer)
                    .resize({ width: 1800, withoutEnlargement: true })
                    .avif({ quality: 50 })
                    .toFile(avifPath);

                ctx.log(`✅ WebP: ${webpPath.split(/[\\/]/).pop()}`);
                ctx.log(`✅ AVIF: ${avifPath.split(/[\\/]/).pop()}`);

                // Aggiorna JSON ricetta
                if (existsSync(jsonFile)) {
                    const recipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));
                    recipe.image = `images/ricette/${catFolder}/${slug}.webp`;
                    recipe.imageAttribution = imageUrl
                        ? `📷 Fonte: ${new URL(imageUrl).hostname}`
                        : '📷 Foto: Caricata manualmente';
                    recipe._originalImageUrl = imageUrl || '';
                    writeFileSync(jsonFile, JSON.stringify(recipe, null, 2), 'utf-8');
                    ctx.log(`💾 JSON aggiornato`);
                } else {
                    ctx.log(`⚠️ JSON non trovato: ${jsonFile}`);
                }

                // Sync cards
                const { syncCards } = await import('../commands/sync-cards.js');
                await syncCards({});
                ctx.log(`🔄 recipes.json sincronizzato`);
            });

            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Status / Health ──
    app.get('/api/status', async (req, res) => {
        // Leggi URL del sito Vite da env o usa default
        const siteUrl = process.env.SITE_URL || 'http://localhost:5173/Ricettario/';

        let geminiSlot = 1;
        try {
            const { getActiveGeminiSlot } = await import('../utils/api.js');
            geminiSlot = getActiveGeminiSlot();
        } catch {}

        res.json({
            status: 'ok',
            uptime: process.uptime(),
            siteUrl,
            hasAnthropic: !!process.env.ANTHROPIC_API_KEY,
            hasGemini: !!process.env.GEMINI_API_KEY,
            hasGemini2: !!process.env.GEMINI_API_KEY2,
            geminiSlot,
            hasSerpApi: !!process.env.SERPAPI_KEY,
            hasPexels: !!process.env.PEXELS_API_KEY,
            hasUnsplash: !!process.env.UNSPLASH_ACCESS_KEY,
            hasPixabay: !!process.env.PIXABAY_API_KEY,
            hasDataForSeo: !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
        });
    });
}
