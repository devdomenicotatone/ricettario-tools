/**
 * COMANDO: testo — Inserisci una ricetta da testo libero (file o stdin)
 *
 * Legge una ricetta completa in formato testo libero e la adatta al template
 * del Ricettario, passando attraverso il flusso standard:
 *   Testo → Claude AI (strutturazione JSON) → validazione → immagine → HTML → inject
 *
 * Uso:
 *   node crea-ricetta.js --testo ricetta.txt
 *   node crea-ricetta.js --testo ricetta.txt --tipo Pizza --no-image
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { enhanceFromText } from '../enhancer.js';
import { generateHtml } from '../template.js';
import { injectCard } from '../injector.js';
import { findAndDownloadImage } from '../image-finder.js';
import { validateRecipe, generateReport } from '../validator.js';
import { log } from '../utils/logger.js';

export async function testo(args) {
    const filePath = typeof args.testo === 'string' ? args.testo : null;

    if (!filePath) {
        log.error('Specifica il percorso al file di testo: --testo ricetta.txt');
        process.exit(1);
    }

    const fullPath = resolve(process.cwd(), filePath);
    if (!existsSync(fullPath)) {
        log.error(`File non trovato: ${fullPath}`);
        process.exit(1);
    }

    log.header('INSERIMENTO RICETTA DA TESTO');
    log.info(`File: ${fullPath}`);

    // Leggi il testo della ricetta
    const recipeText = readFileSync(fullPath, 'utf-8');
    if (recipeText.trim().length < 20) {
        log.error('Il file è troppo corto. Inserisci una ricetta completa.');
        process.exit(1);
    }

    log.info(`Testo letto: ${recipeText.length} caratteri, ${recipeText.split('\n').length} righe`);

    // ── Step 1: Claude struttura il testo in JSON ──
    const enhancedRecipe = await enhanceFromText(recipeText, {
        tipo: args.tipo,
        note: args.note,
    });

    // ── Step 2: Cross-check con fonti reali (opzionale) ──
    if (args['no-validate'] !== true) {
        log.header('CROSS-CHECK FONTI REALI');
        try {
            const { comparison, report } = await validateRecipe(enhancedRecipe);
            const emoji = comparison.confidence >= 80 ? '🟢' : comparison.confidence >= 60 ? '🟡' : '🔴';
            log.info(`${emoji} Confidenza: ${comparison.confidence}%`);
            log.info(`Fonti analizzate: ${comparison.sourcesUsed?.length || 0}`);
            if (comparison.warnings?.length > 0) {
                comparison.warnings.forEach(w => log.warn(`  ⚠️  ${w}`));
            }
            enhancedRecipe._validation = { score: comparison.confidence, report };
        } catch (err) {
            log.warn(`Cross-check non riuscito: ${err.message}`);
            log.info('Procedo senza validazione.');
        }
    }

    // ── Step 3: Genera HTML ──
    const slug = enhancedRecipe.slug || enhancedRecipe.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    enhancedRecipe.slug = slug;

    const ricettarioPath = resolve(process.cwd(), args.output || process.env.RICETTARIO_PATH || '../Ricettario');
    const category = enhancedRecipe.category || args.tipo || 'Pane';
    const categoryFolder = {
        Pane: 'pane', Pizza: 'pizza', Pasta: 'pasta',
        Lievitati: 'lievitati', Focaccia: 'focaccia', Dolci: 'dolci',
    };
    const subfolder = categoryFolder[category] || category.toLowerCase();
    const outputDir = resolve(ricettarioPath, 'ricette', subfolder);
    const outputFile = resolve(outputDir, `${slug}.html`);

    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
    }

    // ── Step 4: Ricerca immagine stock ──
    if (args['no-image'] !== true) {
        const imageData = await findAndDownloadImage(enhancedRecipe, ricettarioPath);
        if (imageData) {
            enhancedRecipe.image = imageData.homeRelativePath;
            enhancedRecipe.imageAttribution = imageData.attribution;
        }
    }

    // --dry-run: mostra JSON senza scrivere
    if (args['dry-run']) {
        log.header('DRY RUN — JSON generato (nessun file scritto)');
        console.log(JSON.stringify(enhancedRecipe, null, 2));
        return;
    }

    // ── Step 5: Salva HTML ──
    const finalHtml = generateHtml(enhancedRecipe);
    writeFileSync(outputFile, finalHtml, 'utf-8');

    // Salva report validazione
    if (enhancedRecipe._validation?.report) {
        const reportFile = outputFile.replace('.html', '.validazione.md');
        writeFileSync(reportFile, enhancedRecipe._validation.report, 'utf-8');
        log.info(`📋 Report validazione: ${reportFile}`);
    }

    log.header('RICETTA GENERATA DA TESTO');
    log.info(`Titolo: ${enhancedRecipe.title}`);
    log.info(`Categoria: ${enhancedRecipe.category}`);
    log.info(`Idratazione: ${enhancedRecipe.hydration}%`);
    log.info(`Ingredienti: ${enhancedRecipe.ingredients.length}`);
    if (enhancedRecipe.stepsSpiral) log.info(`Step spirale: ${enhancedRecipe.stepsSpiral.length}`);
    if (enhancedRecipe.stepsExtruder) log.info(`Step estrusore: ${enhancedRecipe.stepsExtruder.length}`);
    if (enhancedRecipe.stepsHand) log.info(`Step a mano: ${enhancedRecipe.stepsHand.length}`);
    if (enhancedRecipe.image) log.info(`Immagine: ${enhancedRecipe.image}`);
    log.info(`File: ${outputFile}`);

    // ── Step 6: Inject nella homepage ──
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
