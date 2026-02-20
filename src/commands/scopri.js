/**
 * COMANDO: scopri — Cerca ricette su Google e genera
 */

import { discoverRecipes, askUser } from '../discovery.js';
import { genera } from './genera.js';
import { log } from '../utils/logger.js';

export async function scopri(args) {
    const numResults = parseInt(args.quante) || 5;
    const results = await discoverRecipes(args.scopri, numResults);

    if (results.length === 0) return;

    const choice = await askUser('👉 Quale vuoi generare? (numero, o "tutti", o "esci"): ');

    if (choice.toLowerCase() === 'esci' || choice === 'q') {
        log.info('Alla prossima!');
        return;
    }

    let urlsToProcess = [];

    if (choice.toLowerCase() === 'tutti') {
        urlsToProcess = results.map(r => r.url);
    } else {
        // Supporta singolo numero o lista separata da virgola: "1,3,5"
        const indices = choice.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        urlsToProcess = indices
            .map(i => results.find(r => r.index === i)?.url)
            .filter(Boolean);
    }

    if (urlsToProcess.length === 0) {
        log.error('Nessuna selezione valida.');
        process.exit(1);
    }

    log.info(`Genero ${urlsToProcess.length} ricett${urlsToProcess.length === 1 ? 'a' : 'e'}...`);

    for (const url of urlsToProcess) {
        log.separator();
        log.info(`${url}`);
        try {
            args.url = url;
            await genera(args);
        } catch (err) {
            log.warn(`Errore: ${err.message}. Passo alla prossima.`);
        }
    }
}
