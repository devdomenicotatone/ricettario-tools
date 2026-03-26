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
import { resolve } from 'path';
import { log } from '../utils/logger.js';
import { searchAllProviders, downloadImage, buildAttribution } from '../image-finder.js';
import { CATEGORY_FOLDERS } from '../publisher.js';
import { generateHtml } from '../template.js';
import { startImagePicker } from '../image-picker.js';

export async function refreshImage(args) {
    const slug = args['refresh-image'];
    if (!slug || slug === true) {
        log.error('Specifica lo slug della ricetta: --refresh-image <slug>');
        log.info('Esempio: --refresh-image focaccia-genovese-classica');
        process.exit(1);
    }

    const ricettarioPath = resolve(
        process.cwd(),
        args.output || process.env.RICETTARIO_PATH || '../Ricettario'
    );

    // ── Trova il JSON della ricetta ──
    let jsonFile = null;
    let category = null;

    if (args.tipo) {
        const folder = CATEGORY_FOLDERS[args.tipo] || args.tipo.toLowerCase();
        const candidate = resolve(ricettarioPath, 'ricette', folder, `${slug}.json`);
        if (existsSync(candidate)) {
            jsonFile = candidate;
            category = args.tipo;
        }
    }

    if (!jsonFile) {
        for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
            const candidate = resolve(ricettarioPath, 'ricette', folder, `${slug}.json`);
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

    const catFolder = CATEGORY_FOLDERS[category] || category.toLowerCase();
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

    // ── Elimina immagine vecchia ──
    const oldImagePath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}.jpg`);
    if (existsSync(oldImagePath)) {
        unlinkSync(oldImagePath);
    }

    // ── Scarica nuova immagine ──
    const localPath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}.jpg`);
    try {
        await downloadImage(selectedImage.url, localPath);
        log.info(`💾 Scaricata: ${localPath}`);
    } catch (err) {
        log.error(`Download fallito: ${err.message}`);
        return;
    }

    // ── Aggiorna index persistente ──
    const indexFile = resolve(process.cwd(), 'data', 'used-images.json');
    let index = {};
    try { if (existsSync(indexFile)) index = JSON.parse(readFileSync(indexFile, 'utf-8')); } catch {}
    // Rimuovi vecchia URL
    if (oldUrl && index[oldUrl]) delete index[oldUrl];
    // Aggiungi nuova
    index[selectedImage.url] = slug;
    writeFileSync(indexFile, JSON.stringify(index, null, 2), 'utf-8');

    // ── Aggiorna JSON ──
    recipe.image = `images/ricette/${catFolder}/${slug}.jpg`;
    recipe.imageAttribution = buildAttribution(selectedImage);
    recipe._originalImageUrl = selectedImage.url;

    const persistentJson = { ...recipe };
    delete persistentJson._validation;
    delete persistentJson._imageData;
    delete persistentJson._sourcesUsed;
    delete persistentJson._inputMode;

    writeFileSync(jsonFile, JSON.stringify(persistentJson, null, 2), 'utf-8');

    // ── Rigenera HTML automaticamente ──
    const htmlFile = jsonFile.replace('.json', '.html');
    const html = generateHtml(recipe);
    writeFileSync(htmlFile, html, 'utf-8');

    // ── Aggiorna recipes.json (card homepage + categoria) ──
    const { syncCards } = await import('./sync-cards.js');
    await syncCards({ output: args.output });

    log.header('✅ COMPLETATO');
    log.info(`📸 Immagine: ${localPath}`);
    log.info(`💾 JSON: ${jsonFile}`);
    log.info(`📄 HTML: ${htmlFile}`);
    log.info(`🔄 recipes.json aggiornato`);
}
