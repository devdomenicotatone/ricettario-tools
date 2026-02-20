/**
 * COMANDO: trascrivi — Trascrivi PDF o immagini Philips in ricette HTML
 */

import { resolve, basename } from 'path';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { transcribePhilipsPdf } from '../verify.js';
import { extractRecipesFromImages } from '../enhancer.js';
import { generateHtml } from '../template.js';
import { injectCard } from '../injector.js';
import { findAndDownloadImage } from '../image-finder.js';
import { log } from '../utils/logger.js';

/**
 * Trascrivi PDF Philips
 */
export async function trascriviPdf(args) {
    const ricettarioPath = resolve(process.cwd(), args.output || process.env.RICETTARIO_PATH || '../Ricettario');
    const pdfDir = resolve(ricettarioPath, 'public', 'pdf');
    log.header('TRASCRIZIONE PDF — Philips Serie 7000');

    const pdfs = readdirSync(pdfDir).filter(f => f.toLowerCase().endsWith('.pdf'));
    const allRecipes = [];

    for (const pdf of pdfs) {
        try {
            const result = await transcribePhilipsPdf(resolve(pdfDir, pdf));
            log.success(`${pdf}: ${result.recipes?.length || 0} ricette trovate`);
            if (result.recipes) allRecipes.push(...result.recipes);
        } catch (err) {
            log.error(`${pdf}: ${err.message}`);
        }
    }

    // Salva risultato
    const dataDir = resolve(process.cwd(), 'data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    const outputPath = resolve(dataDir, 'philips-recipes.json');
    writeFileSync(outputPath, JSON.stringify({ machine: 'Philips Serie 7000', recipes: allRecipes }, null, 2), 'utf-8');
    log.success(`Salvate ${allRecipes.length} ricette in: ${outputPath}`);
}

/**
 * Trascrivi immagini Philips -> HTML
 */
export async function trascriviImmagini(args) {
    const ricettarioPath = resolve(process.cwd(), args.output || process.env.RICETTARIO_PATH || '../Ricettario');
    const pdfDirs = [
        resolve(ricettarioPath, 'public', 'pdf', 'Philips Pasta maker'),
        resolve(ricettarioPath, 'public', 'pdf', 'Philips Pasta maker_')
    ];
    log.header('TRASCRIZIONE IMMAGINI — Philips Serie 7000');

    // Indice di tracciamento
    const dataDir = resolve(process.cwd(), 'data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    const indexPath = resolve(dataDir, 'image-process-index.json');
    let processedIndex = {};
    try {
        if (existsSync(indexPath)) {
            processedIndex = JSON.parse(readFileSync(indexPath, 'utf-8'));
        }
    } catch { processedIndex = {}; }

    const saveIndex = () => {
        writeFileSync(indexPath, JSON.stringify(processedIndex, null, 2), 'utf-8');
    };

    let allImages = [];
    for (const dir of pdfDirs) {
        try {
            if (existsSync(dir)) {
                const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.png')).map(f => resolve(dir, f));
                allImages.push(...files);
            }
        } catch {
            log.warn(`Cartella non trovata: ${dir}`);
        }
    }

    allImages.sort();
    if (allImages.length === 0) {
        log.error('Nessuna immagine trovata nelle cartelle specificate.');
        return;
    }

    const pendingImages = allImages.filter(img => !processedIndex[basename(img)]);
    const alreadyDone = allImages.length - pendingImages.length;

    log.info(`Trovate ${allImages.length} immagini totali.`);
    if (alreadyDone > 0) {
        log.success(`${alreadyDone} già processate. Rimangono ${pendingImages.length} da processare.`);
    }

    if (pendingImages.length === 0) {
        log.success('Tutte le immagini sono già state processate!');
        return;
    }

    const BATCH_SIZE = 1;
    let totalExtracted = 0;

    for (let i = 0; i < pendingImages.length; i += BATCH_SIZE) {
        const batch = pendingImages.slice(i, i + BATCH_SIZE);
        const currentBatchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(pendingImages.length / BATCH_SIZE);
        log.info(`Processo batch ${currentBatchNum}/${totalBatches}: ${basename(batch[0])}`);

        try {
            const recipes = await extractRecipesFromImages(batch);
            if (recipes && recipes.length > 0) {
                log.success(`Trovate ${recipes.length} ricette in questo batch.`);
                for (const recipe of recipes) {
                    totalExtracted++;
                    recipe.slug = recipe.slug || recipe.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                    if (!recipe.category) recipe.category = 'Pasta';

                    const outputDir = resolve(ricettarioPath, 'ricette', 'pasta');
                    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

                    // Immagine
                    if (args['no-image'] !== true) {
                        try {
                            const imageData = await findAndDownloadImage(recipe, ricettarioPath);
                            if (imageData) {
                                recipe.image = imageData.homeRelativePath;
                                recipe.imageAttribution = imageData.attribution;
                            }
                        } catch (err) {
                            log.warn(`Immagine per ${recipe.title} non trovata (${err.message}).`);
                        }
                    }

                    const outputHtml = generateHtml(recipe);
                    const outputFile = resolve(outputDir, `${recipe.slug}.html`);
                    writeFileSync(outputFile, outputHtml, 'utf-8');

                    if (args['no-inject'] !== true) {
                        try { injectCard(recipe, ricettarioPath); }
                        catch { log.warn(`Errore inject card per ${recipe.title}.`); }
                    }

                    log.success(`Salvata: ${recipe.title} -> ricette/pasta/${recipe.slug}.html`);
                }
            } else {
                log.info('Nessuna ricetta trovata in questo batch.');
            }

            for (const img of batch) {
                processedIndex[basename(img)] = {
                    processedAt: new Date().toISOString(),
                    recipesFound: recipes?.length || 0
                };
            }
            saveIndex();

        } catch (err) {
            log.error(`Errore durante estrazione: ${err.message}`);
            for (const img of batch) {
                processedIndex[basename(img)] = {
                    processedAt: new Date().toISOString(),
                    error: err.message
                };
            }
            saveIndex();
        }

        if (i + BATCH_SIZE < pendingImages.length) {
            log.debug('Attesa per rate limit API (1s)...');
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    log.success(`TRASCRIZIONE COMPLETATA! Estratte ${totalExtracted} ricette totali.`);
}
