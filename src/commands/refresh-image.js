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
import { findRecipeImage, downloadImage, buildAttribution } from '../image-finder.js';
import { CATEGORY_FOLDERS } from '../publisher.js';
import { generateHtml } from '../template.js';

/**
 * Carica e pulisce l'index persistente delle immagini
 */
function cleanImageIndex(urlToRemove) {
    const indexFile = resolve(process.cwd(), 'data', 'used-images.json');
    if (!existsSync(indexFile)) return;
    try {
        const index = JSON.parse(readFileSync(indexFile, 'utf-8'));
        if (urlToRemove && index[urlToRemove]) {
            delete index[urlToRemove];
            writeFileSync(indexFile, JSON.stringify(index, null, 2), 'utf-8');
            log.info(`🗑️  Rimossa dall'index persistente: ${urlToRemove}`);
        }
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

    // ── Salva vecchia URL per escluderla ──
    const catFolder = CATEGORY_FOLDERS[category] || category.toLowerCase();
    const oldImagePath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}.jpg`);
    const oldUrl = recipe._originalImageUrl || '';
    const excludeUrls = new Set();
    if (oldUrl) excludeUrls.add(oldUrl);

    if (existsSync(oldImagePath)) {
        unlinkSync(oldImagePath);
        log.info(`🗑️  Immagine vecchia eliminata: ${oldImagePath}`);
    }

    if (oldUrl) cleanImageIndex(oldUrl);

    // ── Cerca nuova immagine (escludendo la vecchia URL) ──
    log.header('RICERCA NUOVA IMMAGINE');
    const image = await findRecipeImage(
        recipe.title,
        recipe.category,
        recipe.imageKeywords || [],
        excludeUrls
    );

    if (!image) {
        log.warn('Nessuna nuova immagine trovata.');
        return;
    }

    // ── Scarica ──
    const localPath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}.jpg`);
    try {
        await downloadImage(image.url, localPath);
    } catch (err) {
        log.error(`Download fallito: ${err.message}`);
        return;
    }

    // ── Aggiorna index persistente ──
    const indexFile = resolve(process.cwd(), 'data', 'used-images.json');
    let index = {};
    try { if (existsSync(indexFile)) index = JSON.parse(readFileSync(indexFile, 'utf-8')); } catch {}
    index[image.url] = slug;
    writeFileSync(indexFile, JSON.stringify(index, null, 2), 'utf-8');

    // ── Aggiorna JSON ──
    recipe.image = `images/ricette/${catFolder}/${slug}.jpg`;
    recipe.imageAttribution = buildAttribution(image);
    recipe._originalImageUrl = image.url;

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

    log.header('IMMAGINE AGGIORNATA + HTML RIGENERATO');
    log.info(`📸 Nuova immagine: ${localPath}`);
    log.info(`🔗 URL: ${image.url}`);
    log.info(`💾 JSON: ${jsonFile}`);
    log.info(`📄 HTML: ${htmlFile}`);
}

