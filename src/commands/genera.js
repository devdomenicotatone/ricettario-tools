/**
 * COMANDO: genera — Crea una ricetta da URL o da zero
 */

import { scrapeRecipe } from '../scraper.js';
import { enhanceRecipe, generateRecipe } from '../enhancer.js';
import { publishRecipe } from '../publisher.js';
import { log } from '../utils/logger.js';

/**
 * Processa una singola ricetta (da URL o da zero)
 */
export async function genera(args) {
    let enhancedRecipe;

    if (args.url) {
        // Mode A: Scraping + Enhancement
        const rawData = await scrapeRecipe(args.url);
        if (rawData.steps.length) {
            log.info(`Estratti: ${rawData.ingredients.length} ingredienti, ${rawData.steps.length} step`);
        } else {
            log.info(`Estratte ${rawData.ingredients.length} righe di testo grezzo (Claude farà il parsing)`);
        }
        enhancedRecipe = await enhanceRecipe(rawData);
    } else {
        // Mode B: Generazione da zero
        enhancedRecipe = await generateRecipe(args.nome, {
            tipo: args.tipo,
            note: args.note,
        });
    }

    // Pipeline unificata: validazione → immagine → JSON → HTML → inject
    await publishRecipe(enhancedRecipe, args, {
        source: args.url ? 'DA URL' : 'DA NOME',
    });
}

