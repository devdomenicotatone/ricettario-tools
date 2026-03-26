/**
 * COMANDO: rigenera — Rigenera HTML da JSON salvati (senza chiamate API)
 *
 * Utile dopo aver aggiornato il template, il CSS, o il dose calculator.
 * Non consuma API Claude, SerpAPI o provider immagini.
 *
 * Uso:
 *   node crea-ricetta.js --rigenera ricette/pizza/pizza-canotto.json
 *   node crea-ricetta.js --rigenera --tutte
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { generateHtml } from '../template.js';
import { resolveOutputPaths } from '../publisher.js';
import { log } from '../utils/logger.js';

/**
 * Trova tutti i file .json nelle sottocartelle ricette/
 */
function findJsonFiles(dir) {
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...findJsonFiles(fullPath));
        } else if (entry.name.endsWith('.json') && entry.name !== 'recipes.json') {
            files.push(fullPath);
        }
    }
    return files;
}

export async function rigenera(args) {
    const ricettarioPath = resolve(
        process.cwd(),
        args.output || process.env.RICETTARIO_PATH || '../Ricettario'
    );
    const ricettePath = resolve(ricettarioPath, 'ricette');

    let jsonFiles = [];

    if (args.tutte) {
        // Modalità batch: rigenera tutte le ricette
        log.header('RIGENERAZIONE BATCH DI TUTTE LE RICETTE');
        jsonFiles = findJsonFiles(ricettePath);

        if (jsonFiles.length === 0) {
            log.warn('Nessun file .json trovato in ricette/');
            log.info('Genera prima alcune ricette con --url, --nome o --testo.');
            return;
        }

        log.info(`Trovati ${jsonFiles.length} file JSON da rigenerare`);
    } else {
        // Modalità singola: rigenera un file specifico
        const target = typeof args.rigenera === 'string' ? args.rigenera : null;

        if (!target) {
            log.error('Specifica un file JSON o usa --tutte:');
            log.error('  node crea-ricetta.js --rigenera ricette/pizza/pizza-canotto.json');
            log.error('  node crea-ricetta.js --rigenera --tutte');
            process.exit(1);
        }

        const fullPath = resolve(process.cwd(), target);
        jsonFiles = [fullPath];
    }

    let success = 0;
    let errors = 0;

    for (const jsonFile of jsonFiles) {
        const basename = jsonFile.split(/[/\\]/).pop();
        try {
            const recipe = JSON.parse(readFileSync(jsonFile, 'utf-8'));
            const htmlFile = jsonFile.replace('.json', '.html');

            // Rigenera HTML dal JSON
            const html = generateHtml(recipe);
            writeFileSync(htmlFile, html, 'utf-8');

            success++;
            log.info(`  ✅ ${basename} → ${basename.replace('.json', '.html')}`);
        } catch (err) {
            errors++;
            log.warn(`  ❌ ${basename}: ${err.message}`);
        }
    }

    log.header('RIGENERAZIONE COMPLETATA');
    log.info(`✅ Successo: ${success}/${jsonFiles.length}`);
    if (errors > 0) log.warn(`❌ Errori: ${errors}`);
    log.info('');
    log.info('Nota: i file .json non sono stati modificati.');
    log.info('Per aggiornare anche la homepage: node crea-ricetta.js --sync-cards');
}
