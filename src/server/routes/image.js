/**
 * ROUTES/IMAGE — Pipeline immagini: refresh, confirm, craft-prompt, generate, upload, used-images
 */

import { resolve, dirname } from 'path';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { withCacheLock, readImageCache, writeImageCache } from './_helpers.js';

// ══════════════════════════════════════════════════════════
//  INDICE DELLE IMMAGINI GIÀ USATE (data/used-images.json)
// ══════════════════════════════════════════════════════════
// Serve a non riproporre la stessa foto su due ricette diverse.
// Ogni percorso che cambia l'immagine di una ricetta DEVE passare da
// `aggiornaIndiceImmagini`: era proprio la mancanza di quel passaggio nel
// selettore visuale a far divergere i conteggi (foto già usate riproposte,
// URL bloccati per ricette che non esistono più).
//
// Le funzioni stanno in `src/utils/indice-immagini.js` e NON più qui: la stessa
// mappa la scrivono anche la CLI e `image-finder.js`, e finché ogni file aveva
// la sua copia le scritture si sovrascrivevano a vicenda (è la spiegazione dei
// tre conteggi diversi in dashboard). Il modulo aggiunge lock e scrittura
// atomica, quindi le funzioni che scrivono vanno ATTESE.
import {
    leggiIndiceImmagini,
    aggiornaIndiceImmagini,
    modificaIndiceImmagini,
    sostituisciIndiceImmagini,
} from '../../utils/indice-immagini.js';

// ══════════════════════════════════════════════════════════
//  VALIDAZIONE DEI PERCORSI CHE ARRIVANO DAL BROWSER
// ══════════════════════════════════════════════════════════
// slug e categoria finiscono dentro `resolve()` e `mkdirSync()`. Senza
// controllo una richiesta con slug "../../.." scriverebbe fuori dal repo del
// sito, e una categoria inventata creerebbe una cartella che `npm run check`
// non riconosce (bloccando la pubblicazione).
//
// Regola dello slug, traduzione categoria→cartella e costruzione dei percorsi
// arrivano da `src/utils/percorsi-ricette.js`. Erano copiate carattere per
// carattere anche in `routes/recipes.js`: due copie della stessa regola sono
// due occasioni di cambiarne una sola.
import {
    slugValido,
    ERRORE_SLUG,
    ERRORE_CATEGORIA,
    cartellaCategoriaSeValida,
    cartelleAmmesse,
    percorsoRicetta,
    percorsoImmagineRicetta,
    riferimentoImmagineRicetta,
    eFileDiRicetta,
    eFileDiLavoro,
    slugDaNomeFile,
} from '../../utils/percorsi-ricette.js';

/**
 * Raccoglie gli `_originalImageUrl` presenti nei JSON delle ricette.
 * Salta backup e sidecar: `focaccia.pre-edit.json` produrrebbe lo slug
 * "focaccia.pre-edit", che non è una ricetta.
 */
function scansionaUrlRicette(ricettarioPath) {
    const indice = {};
    const righe = [];
    let saltati = 0;

    for (const folder of cartelleAmmesse()) {
        const catDir = resolve(ricettarioPath, 'ricette', folder);
        if (!existsSync(catDir)) continue;

        for (const file of readdirSync(catDir)) {
            if (!eFileDiRicetta(file)) {
                if (eFileDiLavoro(file)) saltati++;
                continue;
            }
            try {
                const data = JSON.parse(readFileSync(resolve(catDir, file), 'utf-8'));
                const slug = slugDaNomeFile(file);
                if (data._originalImageUrl) {
                    indice[data._originalImageUrl] = slug;
                    righe.push(`  ✅ ${slug} → ${String(data._originalImageUrl).substring(0, 60)}...`);
                }
            } catch {}
        }
    }

    return { indice, righe, saltati };
}

export function setupImageRoutes(app, { getRicettarioPath, findRecipeJsonDynamic, nextJobId, createJobContext, withOutputCapture }) {

    /**
     * Controlli comuni alle rotte che scrivono su disco.
     * Risponde direttamente (400) e restituisce `null` se la richiesta va
     * scartata; altrimenti la cartella di categoria da usare nei percorsi.
     *
     * `cartellaCategoriaSeValida` è la variante che NON lancia: qui serve
     * rispondere 400 al browser, non interrompere il job.
     *
     * @returns {{catFolder: string}|null}
     */
    function controllaPercorso(res, slug, category) {
        if (!slugValido(slug)) {
            res.status(400).json({ error: ERRORE_SLUG });
            return null;
        }
        const catFolder = cartellaCategoriaSeValida(category);
        if (!catFolder) {
            res.status(400).json({ error: ERRORE_CATEGORIA });
            return null;
        }
        return { catFolder };
    }

    // ── Refresh Image (con image picker) ──
    app.post('/api/refresh-image', async (req, res) => {
        const { slug, forceRefresh } = req.body;

        // Validazione PRIMA di registrare il job: un job creato e mai chiuso
        // lascia nella pagina un blocco con la rotella che gira per sempre.
        if (!slugValido(slug)) return res.status(400).json({ error: ERRORE_SLUG });

        const jobId = nextJobId('img');
        const ctx = createJobContext(jobId, `Refresh Image: ${slug}`);

        try {
            const ricettarioPath = getRicettarioPath();
            // Importa searchAllProviders per restituire i risultati alla UI
            const { searchAllProviders, sanificaGruppiCache } = await import('../../image-finder.js');
            const { CATEGORY_FOLDERS } = await import('../../constants.js');

            // Trova il JSON
            const found = findRecipeJsonDynamic(ricettarioPath, CATEGORY_FOLDERS, slug);
            let jsonFile = found.jsonFile;
            let category = found.category;

            if (!jsonFile) {
                // Senza questo `ctx.end(false)` il job resta "in corso" per sempre.
                ctx.error(`❌ JSON non trovato per "${slug}"`);
                ctx.end(false);
                return res.status(404).json({ error: `JSON non trovato per "${slug}"` });
            }

            const recipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));

            // Gestione Cache (protetta da mutex)
            const cachedEntry = readImageCache()[slug];

            if (!forceRefresh && cachedEntry && cachedEntry.providerResults) {
                // Il filtro licenze va applicato ANCHE qui, non solo alla ricerca
                // nuova: questo è il percorso normale (il pulsante immagine della
                // dashboard non fa nessuna ricerca), e la cache è stata riempita
                // prima che il filtro esistesse. Senza questa riga la correzione
                // su ND (vieta le opere derivate, e noi ridimensioniamo) e NC
                // resta inerte proprio dove serve.
                const ripuliti = sanificaGruppiCache(cachedEntry.providerResults);
                ctx.log('⚡ Immagini caricate istantaneamente dalla cache locale');
                if (ripuliti.scartateND > 0) {
                    ctx.log(`🚫 ${ripuliti.scartateND} immagini scartate dalla cache (licenza ND: vieta le opere derivate)`);
                }
                if (ripuliti.marcateNC > 0) {
                    ctx.log(`⚠️ ${ripuliti.marcateNC} immagini con licenza NC (uso non commerciale) — segnalate nel titolo`);
                }
                ctx.end();
                return res.json({
                    jobId,
                    slug,
                    category,
                    jsonFile,
                    recipeName: recipe.title,
                    providerResults: ripuliti.gruppi,
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
            ctx.end(false); // era `ctx.end()`: un job fallito veniva chiuso come riuscito
            res.status(500).json({ error: err.message });
        }
    });

    // ── Conferma immagine selezionata ──
    app.post('/api/refresh-image/confirm', async (req, res) => {
        const { slug, image, category } = req.body;

        if (!image?.url) return res.status(400).json({ error: 'Immagine mancante: serve image.url' });

        const controllo = controllaPercorso(res, slug, category);
        if (!controllo) return;
        const { catFolder } = controllo;

        const jobId = nextJobId('imgc');
        const ctx = createJobContext(jobId, `Download: ${slug}`);
        res.json({ jobId, status: 'started' });

        try {
            const ricettarioPath = getRicettarioPath();
            const { downloadImage, buildAttribution } = await import('../../image-finder.js');

            const localPath = percorsoImmagineRicetta(catFolder, slug, { ricettarioPath });
            const jsonFile = percorsoRicetta(catFolder, slug, { ricettarioPath });

            await withOutputCapture(ctx, async () => {
                // Download
                ctx.log(`⬇️ Scaricando da ${image.provider}...`);
                await downloadImage(image.url, localPath);
                ctx.log(`✅ Salvata: ${localPath}`);

                // Aggiorna JSON
                const recipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));
                const vecchioUrl = recipe._originalImageUrl || '';
                recipe.image = riferimentoImmagineRicetta(catFolder, slug);
                recipe.imageAttribution = buildAttribution(image);
                recipe._originalImageUrl = image.url;
                writeFileSync(jsonFile, JSON.stringify(recipe, null, 2), 'utf-8');
                ctx.log(`💾 JSON aggiornato`);

                // Indice immagini usate: senza questo la foto poteva essere riproposta
                const esito = await aggiornaIndiceImmagini({ slug, nuovoUrl: image.url, vecchioUrl });
                ctx.log(`🗂️ Indice immagini usate: ${esito.totale} voci${esito.rimosso ? ' (vecchio URL liberato)' : ''}`);

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

        const controllo = controllaPercorso(res, slug, category);
        if (!controllo) return;
        const { catFolder } = controllo;

        try {
            const ricettarioPath = getRicettarioPath();
            const { callGemini } = await import('../../utils/api.js');

            const jsonFile = percorsoRicetta(catFolder, slug, { ricettarioPath });
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

        const controllo = controllaPercorso(res, slug, category);
        if (!controllo) return;
        const { catFolder } = controllo;

        const jobId = nextJobId('img-ai');
        const ctx = createJobContext(jobId, `AI Generate: ${slug}`);
        res.json({ jobId, status: 'started' });

        try {
            const ricettarioPath = getRicettarioPath();
            const { generateImageWithGemini } = await import('../../image-finder.js');

            const localPathTemp = percorsoImmagineRicetta(catFolder, slug, { ricettarioPath, estensione: '-temp.jpg' });
            const webpPath = percorsoImmagineRicetta(catFolder, slug, { ricettarioPath });
            const avifPath = percorsoImmagineRicetta(catFolder, slug, { ricettarioPath, estensione: '.avif' });
            const jsonFile = percorsoRicetta(catFolder, slug, { ricettarioPath });

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
                const vecchioUrl = currentRecipe._originalImageUrl || '';
                currentRecipe.image = riferimentoImmagineRicetta(catFolder, slug);
                currentRecipe.imageAttribution = "📷 Foto: Generata da AI (Nano Banana 2)";
                currentRecipe._originalImageUrl = ""; // non c'è URL originale
                writeFileSync(jsonFile, JSON.stringify(currentRecipe, null, 2), 'utf-8');
                ctx.log(`💾 JSON aggiornato`);

                // L'immagine AI non ha URL: la vecchia foto torna disponibile
                const esito = await aggiornaIndiceImmagini({ slug, nuovoUrl: '', vecchioUrl });
                if (esito.rimosso) ctx.log(`🗂️ Indice immagini usate: vecchio URL liberato (${esito.totale} voci)`);

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

        // slug e categoria finiscono in `mkdirSync`: qui i percorsi vengono creati,
        // quindi un valore inventato crea davvero una cartella nel repo del sito.
        const controllo = controllaPercorso(res, slug, category);
        if (!controllo) return;
        const { catFolder } = controllo;

        const jobId = nextJobId('upload');
        const ctx = createJobContext(jobId, `Upload Image: ${slug}`);
        res.json({ jobId, status: 'started' });

        try {
            const ricettarioPath = getRicettarioPath();
            const sharp = (await import('sharp')).default;

            const webpPath = percorsoImmagineRicetta(catFolder, slug, { ricettarioPath });
            const avifPath = percorsoImmagineRicetta(catFolder, slug, { ricettarioPath, estensione: '.avif' });
            const jsonFile = percorsoRicetta(catFolder, slug, { ricettarioPath });

            // Assicurati che la directory esista
            const imgDir = dirname(webpPath);
            if (!existsSync(imgDir)) mkdirSync(imgDir, { recursive: true });

            await withOutputCapture(ctx, async () => {
                let imageBuffer;

                if (imageBase64) {
                    // Decodifica Base64 (rimuovi header data:image/...;base64, se presente)
                    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
                    imageBuffer = Buffer.from(base64Data, 'base64');
                    ctx.log(`📦 Immagine ricevuta: ${(imageBuffer.length / 1024).toFixed(0)} KB`);
                } else if (imageUrl) {
                    // Download da URL (drag da un'altra scheda del browser).
                    // `downloadImage` converte con sharp: il file che chiediamo (.jpg)
                    // non esiste mai, scrive .webp e .avif e restituisce il percorso
                    // vero. Leggere il .jpg falliva sempre e lasciava due orfani qui
                    // dentro, che finivano pubblicati.
                    ctx.log(`⬇️ Download da URL: ${imageUrl}`);
                    const { downloadImage } = await import('../../image-finder.js');
                    const tmpBase = resolve(imgDir, `${slug}-tmp-upload`);
                    const tmpFiles = [`${tmpBase}.jpg`, `${tmpBase}.webp`, `${tmpBase}.avif`];
                    try {
                        const savedPath = await downloadImage(imageUrl, `${tmpBase}.jpg`);
                        imageBuffer = readFileSync(savedPath);
                        ctx.log(`✅ Download completato: ${(imageBuffer.length / 1024).toFixed(0)} KB`);
                    } finally {
                        // Sempre, anche se il download è fallito a metà.
                        for (const f of tmpFiles) {
                            try { if (existsSync(f)) unlinkSync(f); } catch {}
                        }
                    }
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
                    const vecchioUrl = recipe._originalImageUrl || '';
                    recipe.image = riferimentoImmagineRicetta(catFolder, slug);
                    recipe.imageAttribution = imageUrl
                        ? `📷 Fonte: ${new URL(imageUrl).hostname}`
                        : '📷 Foto: Caricata manualmente';
                    recipe._originalImageUrl = imageUrl || '';
                    writeFileSync(jsonFile, JSON.stringify(recipe, null, 2), 'utf-8');
                    ctx.log(`💾 JSON aggiornato`);

                    // Indice immagini usate: stesso passaggio degli altri percorsi
                    const esito = await aggiornaIndiceImmagini({ slug, nuovoUrl: imageUrl || '', vecchioUrl });
                    if (esito.aggiunto || esito.rimosso) {
                        ctx.log(`🗂️ Indice immagini usate: ${esito.totale} voci`);
                    }
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
        try {
            const index = leggiIndiceImmagini();
            res.json({
                count: Object.keys(index).length,
                entries: index,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Used Images Index: Reset (svuota) ──
    app.post('/api/used-images/reset', async (req, res) => {
        try {
            await sostituisciIndiceImmagini({});
            res.json({ ok: true, count: 0, message: 'Index resettato' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Used Images Index: Rebuild (ricostruisci da ricette esistenti) ──
    //
    // Di default UNISCE. La ricostruzione secca cancellava le voci che solo
    // l'indice conosce — la pipeline principale non scrive `_originalImageUrl`
    // su tutte le ricette, quindi un clic faceva scendere l'indice da 61 a 10
    // e il sistema dimenticava 51 foto già usate.
    //
    // Per sostituire davvero servono `sostituisci: true` e `conferma: true`:
    // senza conferma la rotta risponde 409 dicendo quante voci si perderebbero.
    app.post('/api/used-images/rebuild', async (req, res) => {
        const { sostituisci = false, conferma = false } = req.body || {};

        let scansione;
        let indiceAttuale;
        let urlPersi;
        try {
            scansione = scansionaUrlRicette(getRicettarioPath());
            indiceAttuale = leggiIndiceImmagini();
            urlPersi = Object.keys(indiceAttuale).filter(url => !(url in scansione.indice));
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }

        // Sostituzione = operazione distruttiva: non parte senza conferma esplicita.
        if (sostituisci && !conferma && urlPersi.length > 0) {
            return res.status(409).json({
                richiedeConferma: true,
                vociAttuali: Object.keys(indiceAttuale).length,
                vociDalleRicette: Object.keys(scansione.indice).length,
                vociPerse: urlPersi.length,
                messaggio: `Sostituire l'indice cancellerebbe ${urlPersi.length} voci su ${Object.keys(indiceAttuale).length}: quelle foto potrebbero essere riproposte su altre ricette. Richiama con "conferma": true per procedere, oppure con "sostituisci": false per unire senza perdere niente.`,
            });
        }

        const jobId = nextJobId('imgidx');
        const ctx = createJobContext(jobId, sostituisci ? 'Rebuild Image Index (sostituzione)' : 'Rebuild Image Index (unione)');
        res.json({ jobId, status: 'started' });

        try {
            await withOutputCapture(ctx, async () => {
                ctx.log('🖼️ Ricostruzione index immagini usate...\n');
                for (const riga of scansione.righe) ctx.log(riga);
                if (scansione.saltati > 0) {
                    ctx.log(`\n⏭️ Saltati ${scansione.saltati} file di appoggio (.backup / .pre-edit / .qualita)`);
                }

                // L'unione rilegge l'indice DENTRO il lock: fra il conteggio qui
                // sopra e questa riga c'è la scansione del repo del sito, e una
                // /api/refresh-image/confirm arrivata nel frattempo scriveva una
                // voce che la vecchia riscrittura in blocco cancellava.
                const { totale } = sostituisci
                    ? await sostituisciIndiceImmagini(scansione.indice)
                    : await modificaIndiceImmagini(indice => Object.assign(indice, scansione.indice));

                if (sostituisci) {
                    ctx.log(`\n🗑️ Sostituzione confermata: ${urlPersi.length} voci rimosse`);
                } else if (urlPersi.length > 0) {
                    ctx.log(`\n🛟 Conservate ${urlPersi.length} voci che una sostituzione avrebbe perso`);
                }
                ctx.log(`\n🎉 Index aggiornato: ${scansione.righe.length} URL letti dalle ricette, ${totale} voci in totale`);
            });

            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });
}
