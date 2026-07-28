/**
 * VARIANTI RESPONSIVE — genera i file -640 e aggiorna la mappa del sito
 *
 * Il sito emette `srcset` a due larghezze per le foto che stanno nella mappa
 * `Ricettario/js/dimensioni-foto.js` (vedi il suo header): l'INVARIANTE è che
 * una chiave sta nella mappa SE E SOLO SE accanto all'originale esistono
 * `<nome>-640.avif` e `<nome>-640.webp`. Una voce senza varianti produce 404;
 * varianti senza voce sono risorse orfane che il cancello del sito segnala.
 *
 * Prima era un passo manuale «rigenera con sharp in una cartella temporanea»
 * che dipendeva da chi se ne ricordava: brisket e pulled pork sono nati senza,
 * e le varianti sono arrivate a mano. Da qui in poi le genera la pipeline
 * immagini (downloadImage in image-finder.js), per ogni via: generazione
 * nuova e refresh di una foto esistente.
 *
 * Le regole di codifica sono LE STESSE delle 83 varianti esistenti
 * (e del header di dimensioni-foto.js): avif quality 55 effort 6,
 * webp quality 75, larghezza 640.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { sep, posix } from 'path';

/**
 * Dal path assoluto del .webp deriva radice del sito, chiave della mappa e
 * path del file mappa. La radice è tutto ciò che precede `public/`:
 * il layout `<radice>/public/images/...` è quello del repo del sito.
 */
function coordinate(webpPath) {
    const norma = webpPath.split(sep).join('/');
    const idx = norma.lastIndexOf('/public/images/');
    if (idx === -1) {
        throw new Error(`path fuori da public/images/: ${webpPath}`);
    }
    const radice = norma.slice(0, idx);
    const chiave = norma.slice(idx + '/public/'.length).replace(/\.webp$/i, '');
    return {
        chiave,
        fileMappa: posix.join(radice, 'js', 'dimensioni-foto.js'),
        base640: norma.replace(/\.webp$/i, '-640'),
    };
}

/**
 * Inserisce o aggiorna una voce nella mappa, in ordine alfabetico, senza
 * toccare il resto del file. Esportata col path esplicito per poterla
 * provare su una copia; i chiamanti veri passano da aggiungiVariantiResponsive.
 */
export function scriviVoceMappa(fileMappa, chiave, larghezza, altezza) {
    const testo = readFileSync(fileMappa, 'utf-8');
    const vocePattern = /^  '([^']+)': \[\d+, \d+\],$/;
    const righe = testo.split('\n');
    const riga = `  '${chiave}': [${larghezza}, ${altezza}],`;

    const esistente = righe.findIndex(r => r.startsWith(`  '${chiave}':`));
    if (esistente !== -1) {
        if (righe[esistente] === riga) return false; // già giusta
        righe[esistente] = riga;                     // foto sostituita: dimensioni nuove
    } else {
        // Prima voce alfabeticamente MAGGIORE della nuova: si inserisce lì.
        // Se non c'è (la nuova è l'ultima), si inserisce prima della chiusura
        // dell'oggetto, che è la prima riga `};` dopo l'apertura della mappa.
        const inizio = righe.findIndex(r => r.includes('export const DIMENSIONI_FOTO'));
        if (inizio === -1) throw new Error(`DIMENSIONI_FOTO non trovato in ${fileMappa}`);
        let posa = -1;
        for (let i = inizio + 1; i < righe.length; i++) {
            if (righe[i].startsWith('};')) { posa = i; break; }
            const m = righe[i].match(vocePattern);
            if (m && m[1] > chiave) { posa = i; break; }
        }
        if (posa === -1) throw new Error(`chiusura della mappa non trovata in ${fileMappa}`);
        righe.splice(posa, 0, riga);
    }
    writeFileSync(fileMappa, righe.join('\n'), 'utf-8');
    return true;
}

/**
 * Genera le varianti -640 accanto all'originale e aggiorna la mappa.
 * Se la mappa non si riesce a scrivere, le varianti appena create vengono
 * TOLTE: mai lasciare file che nessun markup referenzia — il cancello del
 * sito li conterebbe come orfani. Una foto senza voce degrada al markup
 * vecchio, che è la rete di sicurezza prevista da image-utils.js.
 *
 * @returns {{width:number, height:number, chiave:string}}
 */
export async function aggiungiVariantiResponsive(webpPath) {
    const sharp = (await import('sharp')).default;
    const { chiave, fileMappa, base640 } = coordinate(webpPath);
    if (!existsSync(fileMappa)) throw new Error(`mappa non trovata: ${fileMappa}`);

    const meta = await sharp(webpPath).metadata();
    if (!meta.width || !meta.height) throw new Error(`dimensioni illeggibili: ${webpPath}`);

    const avif640 = `${base640}.avif`;
    const webp640 = `${base640}.webp`;
    await sharp(webpPath).resize({ width: 640 }).avif({ quality: 55, effort: 6 }).toFile(avif640);
    await sharp(webpPath).resize({ width: 640 }).webp({ quality: 75 }).toFile(webp640);

    try {
        scriviVoceMappa(fileMappa, chiave, meta.width, meta.height);
    } catch (err) {
        for (const f of [avif640, webp640]) {
            try { unlinkSync(f); } catch { /* già assente */ }
        }
        throw err;
    }
    return { width: meta.width, height: meta.height, chiave };
}
