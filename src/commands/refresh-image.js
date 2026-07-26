/**
 * REFRESH IMAGE — Rigenera l'immagine di copertina con selettore visuale
 *
 * Uso:
 *   node crea-ricetta.js --refresh-image focaccia-genovese-classica
 *   node crea-ricetta.js --refresh-image focaccia-genovese-classica --tipo Focaccia
 *
 * Flusso:
 *   1. Trova il JSON della ricetta tramite slug
 *   2. Cerca immagini su TUTTI i provider (Pexels, Unsplash, Pixabay, Wikimedia)
 *   3. Apre l'Image Picker nel browser — l'utente sceglie visualmente
 *   4. Scarica l'immagine selezionata, aggiorna JSON e rigenera HTML
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { log } from '../utils/logger.js';
import { searchAllProviders, downloadImage, buildAttribution } from '../image-finder.js';
import { startImagePicker } from '../image-picker.js';
import { aggiornaIndiceImmagini } from '../utils/indice-immagini.js';
import {
    slugValido,
    ERRORE_SLUG,
    cartellaCategoriaSeValida,
    etichetteAmmesse,
    radiceRicettario,
    percorsoRicetta,
    percorsoImmagineRicetta,
    riferimentoImmagineRicetta,
} from '../utils/percorsi-ricette.js';

export async function refreshImage(args) {
    const slug = args['refresh-image'];
    if (!slug || slug === true) {
        log.error('Specifica lo slug della ricetta: --refresh-image <slug>');
        log.info('Esempio: --refresh-image focaccia-genovese-classica');
        process.exit(1);
    }
    if (!slugValido(slug)) {
        log.error(`${ERRORE_SLUG} — ricevuto: "${slug}"`);
        process.exit(1);
    }

    const ricettarioPath = radiceRicettario(args.output);

    // ── Trova il JSON della ricetta ──
    let jsonFile = null;
    let category = null;

    // `--tipo` che il registry non conosce non diventa una cartella: prima
    // `args.tipo.toLowerCase()` cercava in `ricette/secondi piatti/` (con lo
    // spazio), non trovava niente e si passava comunque alla ricerca completa.
    if (args.tipo) {
        if (cartellaCategoriaSeValida(args.tipo)) {
            const candidate = percorsoRicetta(args.tipo, slug, { ricettarioPath });
            if (existsSync(candidate)) {
                jsonFile = candidate;
                category = args.tipo;
            }
        } else {
            log.warn(`Categoria "${args.tipo}" non dichiarata in js/categories.js: cerco in tutte le categorie.`);
        }
    }

    if (!jsonFile) {
        for (const cat of etichetteAmmesse()) {
            const candidate = percorsoRicetta(cat, slug, { ricettarioPath });
            if (existsSync(candidate)) {
                jsonFile = candidate;
                category = cat;
                break;
            }
        }
    }

    if (!jsonFile) {
        log.error(`JSON non trovato per slug "${slug}" in nessuna categoria.`);
        process.exit(1);
    }

    log.info(`📄 Trovato: ${jsonFile}`);

    const recipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));
    recipe.slug = slug;
    recipe.category = category;

    const oldUrl = recipe._originalImageUrl || '';

    // ── Cerca su TUTTI i provider ──
    log.header('RICERCA IMMAGINI — TUTTI I PROVIDER');
    const providerResults = await searchAllProviders(
        recipe.title,
        recipe.category,
        recipe.imageKeywords || []
    );

    const totalImages = providerResults.reduce((s, p) => s + p.images.length, 0);
    if (totalImages === 0) {
        log.warn('Nessuna immagine trovata su nessun provider.');
        return;
    }

    log.info(`📊 Totale: ${totalImages} immagini da ${providerResults.filter(p => p.images.length > 0).length} provider`);

    // ── Apri Image Picker nel browser ──
    log.header('IMAGE PICKER');
    log.info('🖼️  Apro il selettore visuale nel browser...');
    log.info('   Seleziona l\'immagine che preferisci, poi conferma.');

    const selectedImage = await startImagePicker(recipe.title, providerResults);

    log.info(`✅ Selezionata: "${(selectedImage.title || '').substring(0, 60)}"`);
    log.info(`   ${selectedImage.width}×${selectedImage.height} — ${selectedImage.provider}`);

    // ── Elimina immagini vecchie ──
    const localPath = percorsoImmagineRicetta(category, slug, { ricettarioPath });
    const oldAvif = percorsoImmagineRicetta(category, slug, { ricettarioPath, estensione: '.avif' });
    if (existsSync(localPath)) unlinkSync(localPath);
    if (existsSync(oldAvif)) unlinkSync(oldAvif);

    // ── Scarica nuova immagine ──
    try {
        await downloadImage(selectedImage.url, localPath);
        log.info(`💾 Scaricata: ${localPath}`);
    } catch (err) {
        log.error(`Download fallito: ${err.message}`);
        return;
    }

    // ── Aggiorna index persistente ──
    // Il vecchio URL lo libera il modulo condiviso, e SOLO se era di questa
    // ricetta: qui bastava che esistesse (`if (oldUrl && index[oldUrl]) delete`)
    // per cancellarlo anche quando apparteneva a un'altra, che restava così
    // senza protezione e poteva vedersi riproporre la propria foto.
    const esitoIndice = await aggiornaIndiceImmagini({
        slug,
        nuovoUrl: selectedImage.url,
        vecchioUrl: oldUrl,
    });
    log.info(`🗂️  Indice immagini usate: ${esitoIndice.totale} voci${esitoIndice.rimosso ? ' (vecchio URL liberato)' : ''}`);

    // ── Aggiorna JSON ──
    recipe.image = riferimentoImmagineRicetta(category, slug);
    recipe.imageAttribution = buildAttribution(selectedImage);
    recipe._originalImageUrl = selectedImage.url;
    // URI della licenza e pagina d'origine: obbligatori per le CC, e ora
    // arrivano dai provider invece di essere indovinati dal testo del credito.
    // Si cancellano quando la foto nuova non li ha, altrimenti resterebbero
    // quelli della foto precedente — un credito che indica la licenza sbagliata.
    if (selectedImage.licenseUrl) recipe.imageLicenseUrl = selectedImage.licenseUrl;
    else delete recipe.imageLicenseUrl;
    if (selectedImage.sourceUrl) recipe.imageSourceUrl = selectedImage.sourceUrl;
    else delete recipe.imageSourceUrl;

    const persistentJson = { ...recipe };
    delete persistentJson._validation;
    delete persistentJson._imageData;
    delete persistentJson._sourcesUsed;
    delete persistentJson._inputMode;

    writeFileSync(jsonFile, JSON.stringify(persistentJson, null, 2), 'utf-8');

    // ── Aggiorna recipes.json (card homepage + categoria) ──
    const { syncCards } = await import('./sync-cards.js');
    await syncCards({ output: args.output });

    log.header('✅ COMPLETATO');
    log.info(`📸 Immagine: ${localPath}`);
    log.info(`💾 JSON: ${jsonFile}`);
    log.info(`🔄 recipes.json aggiornato`);
}
