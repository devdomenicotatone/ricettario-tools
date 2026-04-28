/**
 * ROUTES/IMAGE — Pipeline immagini: refresh, confirm, craft-prompt, generate, upload, used-images
 */

import { resolve } from 'path';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { withCacheLock, readImageCache, writeImageCache } from './_helpers.js';

export function setupImageRoutes(app, { getRicettarioPath, findRecipeJsonDynamic, nextJobId, createJobContext, withOutputCapture }) {

    // ── Refresh Image (con image picker) ──
    app.post('/api/refresh-image', async (req, res) => {
        const { slug, forceRefresh } = req.body;
        const jobId = nextJobId('img');
        const ctx = createJobContext(jobId, `Refresh Image: ${slug}`);

        try {
            const ricettarioPath = getRicettarioPath();
            // Importa searchAllProviders per restituire i risultati alla UI
            const { searchAllProviders } = await import('../../image-finder.js');
            const { CATEGORY_FOLDERS } = await import('../../constants.js');

            // Trova il JSON
            const found = findRecipeJsonDynamic(ricettarioPath, CATEGORY_FOLDERS, slug);
            let jsonFile = found.jsonFile;
            let category = found.category;

            if (!jsonFile) {
                return res.status(404).json({ error: `JSON non trovato per "${slug}"` });
            }

            const recipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));

            // Gestione Cache (protetta da mutex)
            const cachedEntry = readImageCache()[slug];

            if (!forceRefresh && cachedEntry && cachedEntry.providerResults) {
                ctx.log('⚡ Immagini caricate istantaneamente dalla cache locale');
                ctx.end();
                return res.json({
                    jobId,
                    slug,
                    category,
                    jsonFile,
                    recipeName: recipe.title,
                    providerResults: cachedEntry.providerResults,
                });
            }

            ctx.log('🔍 Ricerca su tutti i provider...');
            const providerResults = await withOutputCapture(ctx, () =>
                searchAllProviders(recipe.title, recipe.category || category, recipe.imageKeywords || [])
            );

            // Salva nella cache (mutex-protected)
            await withCacheLock(() => {
                const cache = readImageCache();
                cache[slug] = { providerResults, timestamp: Date.now() };
                writeImageCache(cache);
            });

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
        const jobId = nextJobId('imgc');
        const ctx = createJobContext(jobId, `Download: ${slug}`);
        res.json({ jobId, status: 'started' });

        try {
            const ricettarioPath = getRicettarioPath();
            const { downloadImage, buildAttribution } = await import('../../image-finder.js');
            const { CATEGORY_FOLDERS } = await import('../../constants.js');

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
                const { syncCards } = await import('../../commands/sync-cards.js');
                await syncCards({});
                ctx.log(`🔄 recipes.json sincronizzato`);
            });

            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Craft Prompt (con o senza riferimento visivo) ──
    app.post('/api/refresh-image/craft-prompt', async (req, res) => {
        const { slug, category, prompt, referenceImage, referenceImageMimeType } = req.body;
        if (!slug) return res.status(400).json({ error: 'Slug obbligatorio' });

        try {
            const ricettarioPath = getRicettarioPath();
            const { CATEGORY_FOLDERS } = await import('../../constants.js');
            const { callGemini } = await import('../../utils/api.js');

            const catFolder = CATEGORY_FOLDERS[category] || category?.toLowerCase() || 'condimenti';
            const jsonFile = resolve(ricettarioPath, 'ricette', catFolder, `${slug}.json`);
            const recipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));
            const hasReference = !!referenceImage;

            const { buildCraftPromptSystem, buildRecipeContext } = await import('../../prompt-templates.js');
            const sysPrompt = buildCraftPromptSystem(hasReference);
            const recipeContext = buildRecipeContext(recipe, prompt);

            const messages = [{ role: 'user', content: recipeContext }];
            
            if (hasReference) {
                messages[0] = {
                    role: 'user',
                    parts: [
                        { inlineData: { mimeType: referenceImageMimeType, data: referenceImage } },
                        { text: recipeContext }
                    ]
                };
            }

            const raw = await callGemini({ system: sysPrompt, messages });

            let promptEN, promptIT;
            try {
                const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                const parsed = JSON.parse(cleaned);
                promptEN = parsed.en;
                promptIT = parsed.it;
            } catch (parseErr) {
                console.warn(`⚠️ craft-prompt: JSON parse fallito (${parseErr.message}), uso raw text`);
                promptEN = raw;
                promptIT = prompt;
            }

            // Sanitizza il prompt EN prima di restituirlo
            const { sanitizeImagePrompt } = await import('../../prompt-templates.js');
            const sanitized = sanitizeImagePrompt(promptEN);
            if (sanitized.wasModified) {
                console.log(`🛡️ craft-prompt: sanitizzato (rimossi: ${sanitized.removedTerms.join(', ') || 'nessuno'}, troncato: ${promptEN.length > 450})`);
            }

            res.json({ promptEN: sanitized.prompt, promptIT });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Genera immagine AI (Nano Banana 2 / Gemini) ──
    app.post('/api/refresh-image/generate', async (req, res) => {
        const { slug, prompt, category, promptLanguage, subjectImage, subjectImageMimeType } = req.body;
        const jobId = nextJobId('img-ai');
        const ctx = createJobContext(jobId, `AI Generate: ${slug}`);
        res.json({ jobId, status: 'started' });

        try {
            const ricettarioPath = getRicettarioPath();
            const { generateImageWithGemini } = await import('../../image-finder.js');
            const { CATEGORY_FOLDERS } = await import('../../constants.js');

            const catFolder = CATEGORY_FOLDERS[category] || category?.toLowerCase() || 'pane';
            const localPathTemp = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}-temp.jpg`);
            const webpPath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}.webp`);
            const avifPath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}.avif`);
            const jsonFile = resolve(ricettarioPath, 'ricette', catFolder, `${slug}.json`);

            await withOutputCapture(ctx, async () => {
                const recipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));
                const { callGemini } = await import('../../utils/api.js');

                let craftedPrompt = prompt;

                if (promptLanguage === 'it') {
                    // User reviewed an Italian prompt — translate to English
                    ctx.log('🌐 Traduzione prompt confermato IT → EN...');
                    try {
                        craftedPrompt = await callGemini({
                            system: 'Translate this Italian food photography prompt to English. Output ONLY the English translation, max 450 characters. No explanations.',
                            messages: [{ role: 'user', content: prompt }]
                        });
                        ctx.log(`🎨 Prompt Finale: ${craftedPrompt}`);
                    } catch(e) {
                        ctx.log(`⚠️ Traduzione fallita, uso prompt originale: ${e.message}`);
                    }
                } else {
                    // Auto-craft from recipe (Quick Generate path)
                    ctx.log(`🧠 Analisi ricetta per crafting prompt avanzato...`);

                    const { buildQuickGenerateSystem, buildRecipeContext: buildCtx } = await import('../../prompt-templates.js');
                    const sysPrompt = buildQuickGenerateSystem();
                    const recipeContext = buildCtx(recipe, prompt);

                    try {
                        craftedPrompt = await callGemini({
                            system: sysPrompt,
                            messages: [{ role: 'user', content: recipeContext }]
                        });
                        ctx.log(`🎨 Prompt Generato: ${craftedPrompt}`);
                    } catch(e) {
                        ctx.log(`⚠️ Impossibile craftare il prompt con Gemini: ${e.message}. Uso prompt base.`);
                    }
                }

                // Sanitizza prompt prima di inviare a Imagen
                const { sanitizeImagePrompt } = await import('../../prompt-templates.js');
                const sanitized = sanitizeImagePrompt(craftedPrompt);
                if (sanitized.wasModified) {
                    ctx.log(`🛡️ Prompt sanitizzato (rimossi: ${sanitized.removedTerms.join(', ') || 'nessuno'}, troncato: ${craftedPrompt.length > 450})`);
                }
                craftedPrompt = sanitized.prompt;

                const hasSubject = !!subjectImage;
                if (hasSubject) ctx.log(`📷 Riferimento soggetto allegato — il modello imiterà il piatto reale`);
                ctx.log(`🤖 Generazione in corso con Nano Banana 2${hasSubject ? ' + soggetto reale' : ' (da prompt arricchito)'}...`);
                const imageBuffer = await generateImageWithGemini(craftedPrompt, subjectImage || null, subjectImageMimeType || null);
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
                const { syncCards } = await import('../../commands/sync-cards.js');
                await syncCards({});
                ctx.log(`🔄 recipes.json sincronizzato`);
            });

            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
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

        const jobId = nextJobId('upload');
        const ctx = createJobContext(jobId, `Upload Image: ${slug}`);
        res.json({ jobId, status: 'started' });

        try {
            const ricettarioPath = getRicettarioPath();
            const { CATEGORY_FOLDERS } = await import('../../constants.js');
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
                    const { downloadImage } = await import('../../image-finder.js');
                    const tmpPath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}-tmp-upload.jpg`);
                    await downloadImage(imageUrl, tmpPath);
                    imageBuffer = readFileSync(tmpPath);
                    // Rimuovi il temporaneo
                    try { unlinkSync(tmpPath); } catch {}
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
                const { syncCards } = await import('../../commands/sync-cards.js');
                await syncCards({});
                ctx.log(`🔄 recipes.json sincronizzato`);
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
        const jobId = nextJobId('imgidx');
        const ctx = createJobContext(jobId, 'Rebuild Image Index');
        res.json({ jobId, status: 'started' });

        try {
            const { CATEGORY_FOLDERS } = await import('../../constants.js');
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
}
