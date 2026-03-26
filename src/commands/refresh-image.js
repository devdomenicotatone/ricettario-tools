/**
 * REFRESH IMAGE — Rigenera l'immagine di copertina di una ricetta
 *
 * Uso:
 *   node crea-ricetta.js --refresh-image focaccia-genovese-classica
 *   node crea-ricetta.js --refresh-image focaccia-genovese-classica --tipo Focaccia
 *
 * Flusso:
 *   1. Trova il JSON della ricetta tramite slug
 *   2. Elimina l'immagine vecchia dal disco e dall'index persistente
 *   3. Cerca una nuova immagine via image-finder
 *   4. Aggiorna il JSON con il nuovo path
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { log } from '../utils/logger.js';
import { findAndDownloadImage } from '../image-finder.js';
import { CATEGORY_FOLDERS } from '../publisher.js';

/**
 * Carica e pulisce l'index persistente delle immagini
 */
function cleanImageIndex(urlToRemove) {
    const indexFile = resolve(process.cwd(), 'data', 'used-images.json');
    if (!existsSync(indexFile)) return;
    try {
        const index = JSON.parse(readFileSync(indexFile, 'utf-8'));
        // Rimuovi per URL
        if (urlToRemove && index[urlToRemove]) {
            delete index[urlToRemove];
            writeFileSync(indexFile, JSON.stringify(index, null, 2), 'utf-8');
            log.info(`🗑️  Rimossa dall'index persistente: ${urlToRemove}`);
        }
        // Rimuovi anche per slug (in caso di URL diverse)
        return index;
    } catch {}
}

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

    // ── Trova il JSON della ricetta cercando in tutte le categorie ──
    let jsonFile = null;
    let category = null;

    if (args.tipo) {
        // Categoria specificata → cerca direttamente
        const folder = CATEGORY_FOLDERS[args.tipo] || args.tipo.toLowerCase();
        const candidate = resolve(ricettarioPath, 'ricette', folder, `${slug}.json`);
        if (existsSync(candidate)) {
            jsonFile = candidate;
            category = args.tipo;
        }
    }

    if (!jsonFile) {
        // Cerca in tutte le categorie
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
        log.info('Categorie cercate: ' + Object.values(CATEGORY_FOLDERS).join(', '));
        process.exit(1);
    }

    log.info(`📄 Trovato: ${jsonFile}`);

    // ── Carica il JSON della ricetta ──
    const recipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));
    recipe.slug = slug;
    recipe.category = category;

    // ── Elimina immagine vecchia ──
    const catFolder = CATEGORY_FOLDERS[category] || category.toLowerCase();
    const oldImagePath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}.jpg`);

    if (existsSync(oldImagePath)) {
        unlinkSync(oldImagePath);
        log.info(`🗑️  Immagine vecchia eliminata: ${oldImagePath}`);
    }

    // Pulisci index persistente
    if (recipe.image) {
        // L'URL potrebbe essere nell'index
        cleanImageIndex(recipe._originalImageUrl);
    }

    // ── Cerca nuova immagine ──
    log.header('RICERCA NUOVA IMMAGINE');
    const imageData = await findAndDownloadImage(recipe, ricettarioPath);

    if (!imageData) {
        log.warn('Nessuna nuova immagine trovata.');
        return;
    }

    // ── Aggiorna JSON ──
    recipe.image = imageData.homeRelativePath;
    recipe.imageAttribution = imageData.attribution;
    recipe._originalImageUrl = imageData.url;

    // Rimuovi campi interni
    const persistentJson = { ...recipe };
    delete persistentJson._validation;
    delete persistentJson._imageData;
    delete persistentJson._sourcesUsed;
    delete persistentJson._inputMode;

    writeFileSync(jsonFile, JSON.stringify(persistentJson, null, 2), 'utf-8');

    log.header('IMMAGINE AGGIORNATA');
    log.info(`📸 Nuova immagine: ${imageData.localPath}`);
    log.info(`💾 JSON aggiornato: ${jsonFile}`);
    log.info('');
    log.info('Per aggiornare anche l\'HTML: node crea-ricetta.js --rigenera ' + jsonFile);
}
