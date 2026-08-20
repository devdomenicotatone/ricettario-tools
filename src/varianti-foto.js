/**
 * VARIANTI RESPONSIVE — genera, sposta e rimuove i file -640 e la voce
 * nella mappa del sito, SEMPRE insieme
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

import { readFileSync, writeFileSync, unlinkSync, existsSync, renameSync } from 'fs';
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
    // Questo è l'unico punto della pipeline dove sharp legge un FILE (ovunque
    // altrove riceve buffer), e la cache di libvips tiene aperto l'handle dei
    // file letti: su Windows il webp appena passato di qui non si può né
    // cancellare (elimina) né rinominare (cambia categoria) — EBUSY finché il
    // server non riavvia. Ogni foto si legge una volta sola: la cache non
    // compra niente.
    sharp.cache(false);
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

/** Legge `[larghezza, altezza]` di una voce, o null se la voce non c'è. */
function leggiVoceMappa(fileMappa, chiave) {
    if (!existsSync(fileMappa)) return null;
    const riga = readFileSync(fileMappa, 'utf-8').split('\n')
        .find(r => r.startsWith(`  '${chiave}':`));
    const m = riga?.match(/\[(\d+), (\d+)\]/);
    return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * Toglie una voce dalla mappa senza toccare il resto del file; false se la
 * voce non c'era. Speculare a scriviVoceMappa (stesso riconoscimento della
 * riga, nessuna sistemazione di virgole: ogni voce chiude con la sua).
 */
export function rimuoviVoceMappa(fileMappa, chiave) {
    const righe = readFileSync(fileMappa, 'utf-8').split('\n');
    const idx = righe.findIndex(r => r.startsWith(`  '${chiave}':`));
    if (idx === -1) return false;
    righe.splice(idx, 1);
    writeFileSync(fileMappa, righe.join('\n'), 'utf-8');
    return true;
}

/**
 * Smonta quello che aggiungiVariantiResponsive ha montato: voce nella mappa
 * e file -640. Per l'endpoint elimina della dashboard, che cancellava JSON,
 * sidecar e immagini base ma lasciava questi due pezzi: il 20/08/2026 (due
 * volte) i -640 orfani hanno bloccato il deploy al controllo «risorse che
 * nessuna pagina referenzia» di scripts/verifica-build.js.
 *
 * PRIMA la voce, POI i file: se la riscrittura della mappa fallisse dopo gli
 * unlink resterebbe una voce che punta a file assenti, cioè srcset che
 * fanno 404. L'ordine inverso al peggio lascia orfani, che il cancello
 * segnala. Idempotente: su una ricetta senza varianti non fa niente.
 *
 * @returns {{chiave:string, voceRimossa:boolean, rimossi:string[]}}
 */
export function rimuoviVariantiResponsive(webpPath) {
    const { chiave, fileMappa, base640 } = coordinate(webpPath);
    const voceRimossa = existsSync(fileMappa) && rimuoviVoceMappa(fileMappa, chiave);
    const rimossi = [];
    for (const est of ['.avif', '.webp']) {
        const f = `${base640}${est}`;
        if (existsSync(f)) {
            unlinkSync(f);
            rimossi.push(f);
        }
    }
    return { chiave, voceRimossa, rimossi };
}

/**
 * Segue l'originale quando cambia cartella: sposta i -640 e ricalca la voce
 * sulla chiave nuova, con le stesse dimensioni (la foto non è cambiata).
 * Per /api/cambia-categoria, che spostava solo .webp/.avif base: il
 * 20/08/2026 un cambio categoria ha lasciato 4 file -640 orfani in conserve/.
 *
 * Se lo stato di partenza è zoppo — coppia -640 incompleta, o varianti senza
 * voce (brisket e pulled pork sono nati così) — non si rattoppa: si rigenera
 * tutto dall'originale appena spostato, che è la fonte. Ricetta mai entrata
 * nella pipeline varianti (né voce né file): non fa niente e torna null.
 *
 * @returns {Promise<{chiave:string, spostati:string[], rigenerate:boolean}|null>}
 */
export async function spostaVariantiResponsive(vecchioWebp, nuovoWebp) {
    const da = coordinate(vecchioWebp);
    const a = coordinate(nuovoWebp);

    // Voce vecchia via per prima, qualunque cosa succeda dopo: la sua chiave
    // non corrisponde più a niente (l'originale è già stato spostato).
    const dims = leggiVoceMappa(da.fileMappa, da.chiave);
    if (dims) rimuoviVoceMappa(da.fileMappa, da.chiave);

    const spostati = [];
    for (const est of ['.avif', '.webp']) {
        const sorgente = `${da.base640}${est}`;
        if (existsSync(sorgente)) {
            renameSync(sorgente, `${a.base640}${est}`);
            spostati.push(`${a.base640}${est}`);
        }
    }

    const coppia = ['.avif', '.webp'].every(est => existsSync(`${a.base640}${est}`));
    if (coppia && dims) {
        try {
            scriviVoceMappa(a.fileMappa, a.chiave, dims[0], dims[1]);
        } catch (err) {
            // Stessa compensazione di aggiungiVariantiResponsive: mai lasciare
            // file senza voce. I -640 si rifanno dall'originale, quindi
            // toglierli non perde niente.
            for (const est of ['.avif', '.webp']) {
                try { unlinkSync(`${a.base640}${est}`); } catch { /* già assente */ }
            }
            throw err;
        }
        return { chiave: a.chiave, spostati, rigenerate: false };
    }

    if (!dims && spostati.length === 0) return null;

    const dim = await aggiungiVariantiResponsive(nuovoWebp);
    return { chiave: dim.chiave, spostati, rigenerate: true };
}
