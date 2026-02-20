/**
 * COMANDO: genera — Crea una ricetta da URL o da zero
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { scrapeRecipe } from '../scraper.js';
import { enhanceRecipe, generateRecipe } from '../enhancer.js';
import { generateHtml } from '../template.js';
import { injectCard } from '../injector.js';
import { findAndDownloadImage } from '../image-finder.js';
import { log } from '../utils/logger.js';

/**
 * Processa una singola ricetta (da URL o da zero)
 */
export async function genera(args) {
    let enhancedRecipe;

    if (args.url) {
        // Mode A: Scraping + Enhancement
        const rawData = await scrapeRecipe(args.url);
        log.info(`Estratti: ${rawData.ingredients.length} ingredienti, ${rawData.steps.length} step`);
        enhancedRecipe = await enhanceRecipe(rawData);
    } else {
        // Mode B: Generazione da zero
        enhancedRecipe = await generateRecipe(args.nome, {
            idratazione: args.idratazione,
            tipo: args.tipo,
            note: args.note,
        });
    }

    // Genera HTML
    const html = generateHtml(enhancedRecipe);
    const slug = enhancedRecipe.slug || args.nome?.toLowerCase().replace(/\s+/g, '-') || 'nuova-ricetta';
    enhancedRecipe.slug = slug;

    // Determina output path con sottocartella per categoria
    const ricettarioPath = resolve(process.cwd(), args.output || process.env.RICETTARIO_PATH || '../Ricettario');
    const category = enhancedRecipe.category || args.tipo || 'Pane';
    const categoryFolder = {
        Pane: 'pane', Pizza: 'pizza', Pasta: 'pasta',
        Lievitati: 'lievitati', Focaccia: 'focaccia',
    };
    const subfolder = categoryFolder[category] || category.toLowerCase();
    const outputDir = resolve(ricettarioPath, 'ricette', subfolder);
    const outputFile = resolve(outputDir, `${slug}.html`);

    // Assicurati che la cartella esista
    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
    }

    // Cerca e scarica immagine
    if (args['no-image'] !== true) {
        const imageData = await findAndDownloadImage(enhancedRecipe, ricettarioPath);
        if (imageData) {
            enhancedRecipe.image = imageData.homeRelativePath;
            enhancedRecipe.imageAttribution = imageData.attribution;
            enhancedRecipe._imageData = imageData;
        }
    }

    // --dry-run: mostra JSON senza scrivere
    if (args['dry-run']) {
        log.header('DRY RUN — JSON generato (nessun file scritto)');
        console.log(JSON.stringify(enhancedRecipe, null, 2));
        return;
    }

    // Salva il file HTML (rigenera con immagine)
    const finalHtml = generateHtml(enhancedRecipe);
    writeFileSync(outputFile, finalHtml, 'utf-8');

    log.header('RICETTA GENERATA');
    log.info(`Titolo: ${enhancedRecipe.title}`);
    log.info(`Idratazione: ${enhancedRecipe.hydration}%`);
    log.info(`Temp target: ${enhancedRecipe.targetTemp}`);
    log.info(`Ingredienti: ${enhancedRecipe.ingredients.length}`);
    if (enhancedRecipe.stepsSpiral) log.info(`Step spirale: ${enhancedRecipe.stepsSpiral.length}`);
    if (enhancedRecipe.stepsExtruder) log.info(`Step estrusore: ${enhancedRecipe.stepsExtruder.length}`);
    if (enhancedRecipe.stepsHand) log.info(`Step a mano: ${enhancedRecipe.stepsHand.length}`);
    if (enhancedRecipe.image) log.info(`Immagine: ${enhancedRecipe.image}`);
    log.info(`File: ${outputFile}`);

    // Inserisci la card nella homepage
    if (args['no-inject'] !== true) {
        log.header('INTEGRAZIONE HOMEPAGE');
        try {
            injectCard(enhancedRecipe, ricettarioPath);
        } catch (err) {
            log.warn(`Errore nell'inserimento card: ${err.message}`);
            log.info('La pagina ricetta è stata creata comunque.');
        }
    }

    log.header('COMPLETATO');
    log.info('Prossimi passi:');
    log.info('  1. Apri http://localhost:5173 e verifica il risultato');
    log.info('  2. git add + commit + push');
}
