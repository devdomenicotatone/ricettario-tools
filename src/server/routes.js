/**
 * ROUTES — API endpoints per la Dashboard
 *
 * Ogni endpoint avvia il corrispondente comando CLI
 * in un job context con output streaming via WebSocket.
 */

import { resolve } from 'path';
import { existsSync, readdirSync, readFileSync, statSync, renameSync, mkdirSync, writeFileSync } from 'fs';
import { createJobContext, withOutputCapture } from './ws-handler.js';

let jobCounter = 0;

function getRicettarioPath(body) {
    return resolve(
        process.cwd(),
        body?.output || process.env.RICETTARIO_PATH || '../Ricettario'
    );
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
                        if (file.endsWith('.json') && file !== 'index.json') {
                            try {
                                const data = JSON.parse(readFileSync(resolve(catDir, file), 'utf-8'));
                                recipes.push({
                                    slug: file.replace('.json', ''),
                                    title: data.title,
                                    category: data.category || cat,
                                    hydration: data.hydration,
                                    image: data.image,
                                    date: data.date,
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

    // ── Genera da nome ──
    app.post('/api/genera', async (req, res) => {
        const { nome, url, idratazione, tipo, note, noImage, preview } = req.body;
        const jobId = `gen-${++jobCounter}`;
        const jobName = nome ? `Genera: ${nome}` : `Scraping: ${url}`;
        const ctx = createJobContext(jobId, jobName);

        res.json({ jobId, status: 'started' });

        try {
            const { genera } = await import('../commands/genera.js');
            const args = {};
            if (nome) args.nome = nome;
            if (url) args.url = url;
            if (idratazione) args.idratazione = String(idratazione);
            if (tipo) args.tipo = tipo;
            if (note) args.note = note;
            if (noImage) args['no-image'] = true;

            await withOutputCapture(ctx, () => genera(args));
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Genera da testo ──
    app.post('/api/testo', async (req, res) => {
        const { text, tipo, idratazione } = req.body;
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
            if (idratazione) args.idratazione = String(idratazione);

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

    // ── Rigenera ──
    app.post('/api/rigenera', async (req, res) => {
        const { slug, tutte } = req.body;
        const jobId = `rig-${++jobCounter}`;
        const ctx = createJobContext(jobId, tutte ? 'Rigenera tutte' : `Rigenera: ${slug}`);
        res.json({ jobId, status: 'started' });

        try {
            const { rigenera } = await import('../commands/rigenera.js');
            const args = {};
            if (tutte) {
                args.rigenera = true;
                args.tutte = true;
            } else {
                // Cerca il file JSON reale per slug nelle cartelle categorie
                const { CATEGORY_FOLDERS } = await import('../publisher.js');
                const ricettarioPath = getRicettarioPath();
                let jsonFile = null;
                for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
                    const candidate = resolve(ricettarioPath, 'ricette', folder, `${slug}.json`);
                    if (existsSync(candidate)) { jsonFile = candidate; break; }
                }
                if (!jsonFile) {
                    ctx.error(`❌ ${slug}: JSON non trovato`);
                    ctx.end(false);
                    return;
                }
                args.rigenera = jsonFile;
            }

            await withOutputCapture(ctx, () => rigenera(args));
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Rigenera con Claude (per ricette legacy senza JSON) ──
    app.post('/api/rigenera-claude', async (req, res) => {
        const { slug } = req.body;
        const jobId = `rigcl-${++jobCounter}`;
        const ctx = createJobContext(jobId, `Rigenera Claude: ${slug}`);
        res.json({ jobId, status: 'started' });

        try {
            const { CATEGORY_FOLDERS } = await import('../publisher.js');
            const ricettarioPath = getRicettarioPath();

            // Cerca il file HTML nelle cartelle categorie
            let htmlFile = null;
            for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
                const candidate = resolve(ricettarioPath, 'ricette', folder, `${slug}.html`);
                if (existsSync(candidate)) { htmlFile = candidate; break; }
            }

            if (!htmlFile) {
                ctx.error(`❌ ${slug}: HTML non trovato`);
                ctx.end(false);
                return;
            }

            const { rigeneraClaude } = await import('../commands/rigenera-claude.js');
            await withOutputCapture(ctx, () => rigeneraClaude(htmlFile, slug));
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ ${slug}: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Refresh Image (con image picker) ──
    app.post('/api/refresh-image', async (req, res) => {
        const { slug, tipo } = req.body;
        const jobId = `img-${++jobCounter}`;
        const ctx = createJobContext(jobId, `Refresh Image: ${slug}`);

        try {
            const ricettarioPath = getRicettarioPath();
            // Importa searchAllProviders per restituire i risultati alla UI
            const { searchAllProviders } = await import('../image-finder.js');
            const { CATEGORY_FOLDERS } = await import('../publisher.js');

            // Trova il JSON
            let jsonFile = null;
            let category = null;

            for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
                const candidate = resolve(ricettarioPath, 'ricette', folder, `${slug}.json`);
                if (existsSync(candidate)) {
                    jsonFile = candidate;
                    category = cat;
                    break;
                }
            }

            if (!jsonFile) {
                return res.status(404).json({ error: `JSON non trovato per "${slug}"` });
            }

            const recipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));

            ctx.log('🔍 Ricerca su tutti i provider...');
            const providerResults = await withOutputCapture(ctx, () =>
                searchAllProviders(recipe.title, recipe.category || category, recipe.imageKeywords || [])
            );

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
            const { CATEGORY_FOLDERS } = await import('../publisher.js');
            const { generateHtml } = await import('../template.js');
            const { writeFileSync } = await import('fs');

            const catFolder = CATEGORY_FOLDERS[category] || category?.toLowerCase() || 'pane';
            const localPath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}.jpg`);
            const jsonFile = resolve(ricettarioPath, 'ricette', catFolder, `${slug}.json`);

            await withOutputCapture(ctx, async () => {
                // Download
                ctx.log(`⬇️ Scaricando da ${image.provider}...`);
                await downloadImage(image.url, localPath);
                ctx.log(`✅ Salvata: ${localPath}`);

                // Aggiorna JSON
                const recipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));
                recipe.image = `images/ricette/${catFolder}/${slug}.jpg`;
                recipe.imageAttribution = buildAttribution(image);
                recipe._originalImageUrl = image.url;
                writeFileSync(jsonFile, JSON.stringify(recipe, null, 2), 'utf-8');
                ctx.log(`💾 JSON aggiornato`);

                // Rigenera HTML
                recipe.slug = slug;
                recipe.category = category;
                const html = generateHtml(recipe);
                writeFileSync(jsonFile.replace('.json', '.html'), html, 'utf-8');
                ctx.log(`📄 HTML rigenerato`);

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

    // ── Valida ──
    app.post('/api/valida', async (req, res) => {
        const { slugs } = req.body || {};
        const label = slugs?.length ? `Validazione: ${slugs.length} ricette` : 'Validazione tutte';
        const jobId = `val-${++jobCounter}`;
        const ctx = createJobContext(jobId, label);
        res.json({ jobId, status: 'started' });

        try {
            if (slugs?.length) {
                // Batch: valida singole ricette
                const { CATEGORY_FOLDERS } = await import('../publisher.js');
                const { validateRecipe } = await import('../validator.js');
                const ricettarioPath = getRicettarioPath();

                await withOutputCapture(ctx, async () => {
                    ctx.log(`📊 Validazione di ${slugs.length} ricette...\n`);
                    for (const slug of slugs) {
                        // Trova il JSON della ricetta
                        let jsonFile = null;
                        for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
                            const candidate = resolve(ricettarioPath, 'ricette', folder, `${slug}.json`);
                            if (existsSync(candidate)) { jsonFile = candidate; break; }
                        }
                        if (!jsonFile) { ctx.log(`  ⚠️ ${slug}: JSON non trovato`); continue; }

                        try {
                            const recipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));
                            const { comparison } = await validateRecipe(recipe);
                            const score = comparison.score ?? comparison.confidence ?? 0;
                            const emoji = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🔴';
                            ctx.log(`  ${emoji} ${score}% — ${recipe.title}`);
                        } catch (err) {
                            ctx.log(`  ❌ ${slug}: ${err.message}`);
                        }
                    }
                });
            } else {
                const { valida } = await import('../commands/valida.js');
                await withOutputCapture(ctx, () => valida({ valida: true }));
            }
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Verifica ──
    app.post('/api/verifica', async (req, res) => {
        const { slug, slugs } = req.body || {};
        const batchSlugs = slugs || (slug ? [slug] : null);
        const label = batchSlugs ? `Verifica: ${batchSlugs.length} ricette` : 'Verifica tutte';
        const jobId = `ver-${++jobCounter}`;
        const ctx = createJobContext(jobId, label);
        res.json({ jobId, status: 'started' });

        try {
            if (batchSlugs) {
                const { CATEGORY_FOLDERS } = await import('../publisher.js');
                const { verifyRecipe } = await import('../verify.js');
                const ricettarioPath = getRicettarioPath();

                await withOutputCapture(ctx, async () => {
                    ctx.log(`✅ Verifica AI di ${batchSlugs.length} ricette...\n`);
                    for (const s of batchSlugs) {
                        let jsonFile = null;
                        for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
                            const candidate = resolve(ricettarioPath, 'ricette', folder, `${s}.json`);
                            if (existsSync(candidate)) { jsonFile = candidate; break; }
                        }
                        if (!jsonFile) { ctx.log(`  ⚠️ ${s}: non trovato`); continue; }

                        try {
                            const { recipe, result } = await verifyRecipe(jsonFile);
                            const emoji = result.score >= 80 ? '🟢' : result.score >= 60 ? '🟡' : '🔴';
                            ctx.log(`  ${emoji} ${result.score}/100 — ${recipe.title}`);
                        } catch (err) {
                            ctx.log(`  ❌ ${s}: ${err.message}`);
                        }
                    }
                });
            } else {
                const { verifica } = await import('../commands/verifica.js');
                await withOutputCapture(ctx, () => verifica({ verifica: true }));
            }
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
            const { CATEGORY_FOLDERS } = await import('../publisher.js');
            const { unlinkSync } = await import('fs');
            const ricettarioPath = getRicettarioPath();

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

                        // Cancella tutti i file associati
                        const filesToDelete = [
                            resolve(ricettarioPath, 'ricette', folder, `${slug}.json`),
                            resolve(ricettarioPath, 'ricette', folder, `${slug}.html`),
                            resolve(ricettarioPath, 'ricette', folder, `${slug}.validazione.md`),
                            resolve(ricettarioPath, 'ricette', folder, `${slug}.verifica.md`),
                            resolve(ricettarioPath, 'public', 'images', 'ricette', folder, `${slug}.jpg`),
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

                // Sync cards per aggiornare recipes.json
                ctx.log('🔄 Aggiornamento recipes.json...');
                const { syncCards } = await import('../commands/sync-cards.js');
                await syncCards({});

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

            if (!categories.includes(category)) {
                return res.status(400).json({ error: `Categoria non valida. Disponibili: ${categories.join(', ')}` });
            }

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
            const { CATEGORY_FOLDERS } = await import('../publisher.js');
            const { generateHtml } = await import('../template.js');
            const { syncCards } = await import('../commands/sync-cards.js');

            const ricettarioPath = getRicettarioPath();
            const oldFolder = CATEGORY_FOLDERS[oldCategory] || oldCategory.toLowerCase();
            const newFolder = CATEGORY_FOLDERS[newCategory] || newCategory.toLowerCase();

            // Paths vecchi
            const oldJsonFile = resolve(ricettarioPath, 'ricette', oldFolder, `${slug}.json`);
            const oldHtmlFile = resolve(ricettarioPath, 'ricette', oldFolder, `${slug}.html`);
            const oldValidFile = resolve(ricettarioPath, 'ricette', oldFolder, `${slug}.validazione.md`);
            const oldImgFile = resolve(ricettarioPath, 'public', 'images', 'ricette', oldFolder, `${slug}.jpg`);

            // Paths nuovi
            const newRecipeDir = resolve(ricettarioPath, 'ricette', newFolder);
            const newImgDir = resolve(ricettarioPath, 'public', 'images', 'ricette', newFolder);
            const newJsonFile = resolve(newRecipeDir, `${slug}.json`);
            const newHtmlFile = resolve(newRecipeDir, `${slug}.html`);
            const newValidFile = resolve(newRecipeDir, `${slug}.validazione.md`);
            const newImgFile = resolve(newImgDir, `${slug}.jpg`);

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

                // 2. Sposta HTML
                if (existsSync(oldHtmlFile)) {
                    renameSync(oldHtmlFile, newHtmlFile);
                    ctx.log(`  ✅ ${slug}.html`);
                }

                // 3. Sposta validazione
                if (existsSync(oldValidFile)) {
                    renameSync(oldValidFile, newValidFile);
                    ctx.log(`  ✅ ${slug}.validazione.md`);
                }

                // 4. Sposta immagine
                if (existsSync(oldImgFile)) {
                    renameSync(oldImgFile, newImgFile);
                    ctx.log(`  ✅ ${slug}.jpg`);
                }

                // 5. Aggiorna JSON — category + image path
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

                // 6. Rigenera HTML con la nuova categoria
                ctx.log(`\n📄 Rigenerazione HTML...`);
                recipe.slug = slug;
                const html = generateHtml(recipe);
                writeFileSync(newHtmlFile, html, 'utf-8');
                ctx.log(`  ✅ HTML rigenerato`);

                // 7. Sync cards (ricostruisce recipes.json)
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

    // ── Status / Health ──
    app.get('/api/status', (req, res) => {
        // Leggi URL del sito Vite da env o usa default
        const siteUrl = process.env.SITE_URL || 'http://localhost:5173/Ricettario/';

        res.json({
            status: 'ok',
            uptime: process.uptime(),
            siteUrl,
            hasAnthropic: !!process.env.ANTHROPIC_API_KEY,
            hasSerpApi: !!process.env.SERPAPI_KEY,
            hasPexels: !!process.env.PEXELS_API_KEY,
            hasUnsplash: !!process.env.UNSPLASH_ACCESS_KEY,
            hasDataForSeo: !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
        });
    });
}
