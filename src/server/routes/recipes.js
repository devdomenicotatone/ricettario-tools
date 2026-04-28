/**
 * ROUTES/RECIPES — CRUD ricette, generazione, scopri, sync, elimina
 */

import { resolve } from 'path';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'fs';

export function setupRecipeRoutes(app, { getRicettarioPath, nextJobId, createJobContext, withOutputCapture }) {

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
                    const { syncCards } = await import('../../commands/sync-cards.js');
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
        
        const jobId = nextJobId('gen');
        let jobName = '';
        if (nome) jobName = `Genera: ${nome}`;
        else if (isBatch) jobName = `Scraping: ${targetUrls.length} ricette`;
        else jobName = `Scraping: ${url}`;
        
        const ctx = createJobContext(jobId, jobName);
        res.json({ jobId, status: 'started' });

        try {
            const { genera } = await import('../../commands/genera.js');
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
        const jobId = nextJobId('txt');
        const ctx = createJobContext(jobId, `Testo: ${(text || '').substring(0, 40)}...`);
        res.json({ jobId, status: 'started' });

        try {
            // Salva il testo in un file temporaneo
            const tmpFile = resolve(process.cwd(), 'data', '_tmp_testo.txt');
            writeFileSync(tmpFile, text, 'utf-8');

            const { testo } = await import('../../commands/testo.js');
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
        const jobId = nextJobId('scp');
        const ctx = createJobContext(jobId, `Scopri: ${query}`);
        res.json({ jobId, status: 'started' });

        try {
            const { scopri } = await import('../../commands/scopri.js');
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
            const { discoverRecipes } = await import('../../discovery.js');
            const results = await discoverRecipes(query, Number(quante) || 10);
            res.json({ results });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Sync Cards ──
    app.post('/api/sync-cards', async (req, res) => {
        const jobId = nextJobId('sync');
        const ctx = createJobContext(jobId, 'Sync Cards');
        res.json({ jobId, status: 'started' });

        try {
            const { syncCards } = await import('../../commands/sync-cards.js');
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

        const jobId = nextJobId('del');
        const ctx = createJobContext(jobId, `Elimina: ${slugs.length} ricette`);
        res.json({ jobId, status: 'started' });

        try {
            const { CATEGORY_FOLDERS } = await import('../../constants.js');
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
                const { syncCards } = await import('../../commands/sync-cards.js');
                await syncCards({});

                // Rimuovi entry fantasma da quality-index.json
                try {
                    const { loadQualityIndex, saveQualityIndex } = await import('../../quality.js');
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
}
