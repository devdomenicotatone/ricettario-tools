/**
 * COMANDO: sync-cards — Ricostruisce public/recipes.json
 *
 * NON genera più l'indice per conto suo: esegue `scripts/build-recipes.js` del
 * sito, che è la fonte unica di quella derivazione.
 *
 * Perché: qui viveva un secondo generatore, e i due producevano indici DIVERSI
 * a partire dagli stessi dati. Le differenze misurate:
 *
 *  - `_createdAt` veniva riscritto con la data di MODIFICA del file. Le 17
 *    ricette che hanno la data di creazione solo nell'indice la perdevano a
 *    ogni sync — cioè a ogni salvataggio dall'editor — e siccome poi il
 *    generatore del sito recupera il valore dall'indice precedente, la data
 *    sbagliata diventava definitiva. Google vede date false e l'ordinamento
 *    "per novità" si scombina.
 *  - le descrizioni venivano troncate a 160 caratteri, a metà parola
 *    ("...lavorazione mini").
 *  - l'immagine veniva inventata con un percorso convenzionale anche quando
 *    il file non esiste; il sito invece lascia null e segnala.
 *  - i placeholder ("nessuna", "n/a", "-") restavano testo invece di
 *    diventare null.
 *  - l'idratazione non veniva validata.
 *
 * E soprattutto saltavano tutte le validazioni del sito: slug che non
 * corrisponde al nome file, categoria incoerente con la cartella in cui la
 * ricetta sta, immagine dichiarata ma mancante, cartelle non dichiarate nel
 * registry. Ora quei controlli girano anche dalla dashboard, quindi il problema
 * si vede subito invece che al primo `npm run check`, a distanza di giorni.
 *
 * Uso: node crea-ricetta.js --sync-cards
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { log } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

/** Stampa un blocco di output del generatore riga per riga, senza righe vuote. */
function stampa(testo, livello) {
    for (const riga of String(testo || '').split('\n')) {
        if (riga.trim()) log[livello](riga.trimEnd());
    }
}

/**
 * Sync-cards: rigenera recipes.json chiamando il generatore del sito.
 * Lancia un errore se i dati sono incoerenti — i chiamanti lo gestiscono
 * (l'editor risponde `syncOk: false`, i job finiscono in errore).
 */
export async function syncCards(args = {}) {
    const ricettarioPath = resolve(process.cwd(), args.output || process.env.RICETTARIO_PATH || '../Ricettario');
    const generatore = resolve(ricettarioPath, 'scripts', 'build-recipes.js');

    log.header('SYNC CARDS — Ricostruzione recipes.json');

    if (!existsSync(generatore)) {
        log.error(`Generatore del sito non trovato: ${generatore}`);
        log.error('Controlla RICETTARIO_PATH nel .env: senza quello script l\'indice non si rigenera.');
        throw new Error(`build-recipes.js non trovato in ${generatore}`);
    }

    try {
        const { stdout, stderr } = await execFileAsync(process.execPath, [generatore], {
            cwd: ricettarioPath,
            maxBuffer: 10 * 1024 * 1024,
        });
        stampa(stdout, 'info');
        stampa(stderr, 'warn'); // i warning non bloccano: categorie vuote, description mancanti
        log.info(`📄 ${resolve(ricettarioPath, 'public', 'recipes.json')}`);
    } catch (err) {
        // build-recipes.js esce con 1 e stampa gli errori quando i dati sono incoerenti.
        stampa(err.stdout, 'info');
        stampa(err.stderr, 'error');
        throw new Error('recipes.json NON rigenerato: il generatore del sito ha trovato dati incoerenti (vedi sopra)');
    }
}
