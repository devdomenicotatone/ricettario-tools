/**
 * INDICE DELLE IMMAGINI GIÀ USATE (data/used-images.json)
 *
 * Fonte UNICA per l'indice anti-duplicati delle foto: una mappa `URL → slug`
 * che risponde alla domanda "questa foto è già finita su una ricetta?".
 *
 * Prima esistevano tre copie divergenti dello stesso indice, ed è il motivo per
 * cui la dashboard mostrava tre numeri diversi (80 / 61 / 10):
 *   - `src/server/routes/image.js` — la più completa (lettura, scrittura,
 *     `aggiornaIndiceImmagini` con il controllo di proprietà);
 *   - `src/commands/refresh-image.js` — cancellava il vecchio URL con
 *     `if (oldUrl && index[oldUrl]) delete index[oldUrl]`, cioè ANCHE quando
 *     l'URL apparteneva a un'altra ricetta: quella ricetta restava senza
 *     protezione e la stessa foto poteva essere riproposta;
 *   - `src/image-finder.js` — `loadImageIndex`/`saveImageIndex`, senza lock:
 *     leggeva prima di una ricerca lunga e riscriveva dopo, sovrascrivendo
 *     tutto quello che nel frattempo aveva scritto il server.
 *
 * Qui il comportamento di riferimento è quello di `routes/image.js` (il
 * percorso più usato), con due cose in più che lì mancavano:
 *   - la scrittura è ATOMICA (`scriviJsonAtomico`: tmp + rename, il file non
 *     resta mai a metà);
 *   - il ciclo legge-modifica-riscrivi sta dentro `conLockFile`, quindi due job
 *     in parallelo si accodano invece di perdersi le modifiche a vicenda.
 *
 * CONSEGUENZA SULLE FIRME: prendere il lock richiede `await`, quindi le
 * funzioni che scrivono sono ASINCRONE, mentre `aggiornaIndiceImmagini` in
 * `routes/image.js` era sincrona di proposito (l'atomicità la otteneva non
 * lasciando spazio a un `await` in mezzo). Chi adotta questo modulo deve
 * aggiungere `await` alla chiamata: la garanzia ora è il lock, più forte,
 * perché copre anche i percorsi che un `await` ce l'hanno per forza (la rotta
 * /api/used-images/rebuild, che fra la lettura e la scrittura scansiona il
 * repo del sito).
 *
 * NON RIENTRANTE: `conLockFile` respinge il lock annidato sulla stessa chiave.
 * Dentro la callback di `modificaIndiceImmagini` non si possono chiamare
 * `segnaUrlUsato`, `liberaUrl`, `aggiornaIndiceImmagini` o
 * `sostituisciIndiceImmagini` — prendono lo stesso lock e la chiamata verrebbe
 * respinta con un errore. Tutto quello che serve va fatto mutando l'oggetto
 * `indice` che la callback riceve.
 */

import { resolve } from 'path';
import { conLockFile, leggiJson, scriviJsonAtomico } from '../server/routes/_helpers.js';

/**
 * Percorso assoluto di `data/used-images.json`.
 *
 * Ricalcolato a ogni chiamata invece che congelato in una costante al caricamento
 * del modulo: dipende da `process.cwd()`, che non è fisso (la CLI si avvia da
 * cartelle diverse, e gli script di collaudo cambiano cwd apposta).
 *
 * È anche la chiave del lock, così server e CLI si accodano sullo stesso file.
 *
 * @returns {string}
 */
export function percorsoIndiceImmagini() {
    return resolve(process.cwd(), 'data', 'used-images.json');
}

/**
 * Legge l'indice `URL → slug`.
 *
 * Senza lock e sincrona: è una lettura sola, e la scrittura atomica garantisce
 * che non si possa mai leggere un file troncato. Restituisce `{}` se il file
 * non esiste o non è JSON valido — un indice illeggibile deve far ripartire la
 * deduplicazione da zero, non far fallire una ricerca immagini.
 *
 * @returns {Record<string, string>} mappa URL → slug della ricetta che la usa
 */
export function leggiIndiceImmagini() {
    const indice = leggiJson(percorsoIndiceImmagini(), {});
    // `leggiJson` restituisce qualunque JSON valido: se il file contenesse un
    // array o un numero, chi legge si aspetterebbe comunque un oggetto.
    return (indice && typeof indice === 'object' && !Array.isArray(indice)) ? indice : {};
}

/**
 * Numero di voci nell'indice (quante foto risultano già usate).
 * @returns {number}
 */
export function contaIndiceImmagini() {
    return Object.keys(leggiIndiceImmagini()).length;
}

/**
 * Chi rivendica un URL, o `null` se è libero.
 * @param {string} url
 * @returns {string|null} slug della ricetta proprietaria
 */
export function proprietarioUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const indice = leggiIndiceImmagini();
    return Object.prototype.hasOwnProperty.call(indice, url) ? indice[url] : null;
}

/**
 * Vero se l'URL è già usato da una ricetta diversa da `slug` (o da chiunque, se
 * `slug` non viene passato). È la domanda che si fa un selettore di immagini
 * prima di proporre una foto.
 *
 * @param {string} url
 * @param {string} [slug] - ricetta che sta chiedendo; la sua stessa foto non
 *   conta come duplicato
 * @returns {boolean}
 */
export function urlGiaUsato(url, slug = '') {
    const proprietario = proprietarioUrl(url);
    if (proprietario === null) return false;
    return slug ? proprietario !== slug : true;
}

/**
 * Esegue `fn` con accesso esclusivo all'indice: prende il lock, legge, passa
 * l'oggetto a `fn` perché lo modifichi, e lo riscrive in modo atomico SOLO se
 * il contenuto è davvero cambiato (niente scrittura, niente rename e niente
 * usura del disco per una modifica che non modifica).
 *
 * È il mattone su cui sono costruite tutte le altre funzioni di scrittura:
 * chi ha bisogno di un'operazione che qui non c'è (la ricostruzione
 * dell'indice, per esempio) usa questa invece di riaprire il file per conto suo.
 *
 * ATTENZIONE: dentro `fn` non si possono chiamare le altre funzioni di
 * scrittura di questo modulo (lock annidato, vedi l'intestazione del file).
 *
 * @template T
 * @param {(indice: Record<string, string>) => T | Promise<T>} fn
 * @returns {Promise<{risultato: T, scritto: boolean, totale: number}>}
 *   `scritto` dice se il file è stato toccato, `totale` quante voci ha adesso
 * @example
 *   // Ricostruzione unendo quanto trovato nelle ricette, senza perdere il resto
 *   await modificaIndiceImmagini(indice => Object.assign(indice, daRicette));
 */
export async function modificaIndiceImmagini(fn) {
    if (typeof fn !== 'function') {
        throw new TypeError('modificaIndiceImmagini: serve una funzione da eseguire sull\'indice');
    }
    const file = percorsoIndiceImmagini();
    return conLockFile(file, async () => {
        const indice = leggiIndiceImmagini();
        const prima = JSON.stringify(indice);
        const risultato = await fn(indice);
        const dopo = JSON.stringify(indice);
        const scritto = dopo !== prima;
        if (scritto) scriviJsonAtomico(file, indice);
        return { risultato, scritto, totale: Object.keys(indice).length };
    });
}

/**
 * Sostituisce l'indice per intero. Serve al reset (`{}`) e alla ricostruzione
 * distruttiva: scrive sempre, anche se il contenuto coincide, perché il
 * chiamante ha chiesto esplicitamente uno stato finale.
 *
 * @param {Record<string, string>} nuovoIndice
 * @returns {Promise<{totale: number}>}
 */
export async function sostituisciIndiceImmagini(nuovoIndice) {
    if (!nuovoIndice || typeof nuovoIndice !== 'object' || Array.isArray(nuovoIndice)) {
        throw new TypeError('sostituisciIndiceImmagini: serve un oggetto URL → slug');
    }
    const file = percorsoIndiceImmagini();
    return conLockFile(file, () => {
        scriviJsonAtomico(file, nuovoIndice);
        return { totale: Object.keys(nuovoIndice).length };
    });
}

/**
 * Segna un URL come usato da `slug`.
 *
 * Se l'URL era rivendicato da un'altra ricetta il proprietario passa a `slug`
 * (l'ultimo che l'ha davvero scaricata) e il vecchio proprietario viene
 * restituito in `precedente`, così il chiamante può segnalarlo: significa che
 * la stessa foto è finita su due ricette, che è proprio ciò che l'indice serve
 * a evitare.
 *
 * @param {string} url - URL originale della foto (`_originalImageUrl`)
 * @param {string} slug - slug della ricetta che la usa
 * @returns {Promise<{aggiunto: boolean, precedente: string|null, totale: number}>}
 *   `aggiunto` è falso se la voce era già identica (nessuna scrittura)
 */
export async function segnaUrlUsato(url, slug) {
    if (!url || typeof url !== 'string') {
        return { aggiunto: false, precedente: null, totale: contaIndiceImmagini() };
    }
    if (!slug || typeof slug !== 'string') {
        throw new TypeError('segnaUrlUsato: serve lo slug della ricetta che usa l\'immagine');
    }
    let precedente = null;
    const esito = await modificaIndiceImmagini(indice => {
        precedente = Object.prototype.hasOwnProperty.call(indice, url) ? indice[url] : null;
        indice[url] = slug;
    });
    return { aggiunto: esito.scritto, precedente, totale: esito.totale };
}

/**
 * Libera un URL, ma SOLO se appartiene a `slug`.
 *
 * È il bug che `src/commands/refresh-image.js` aveva e questo modulo toglie:
 * lì bastava che l'URL esistesse (`if (oldUrl && index[oldUrl]) delete ...`)
 * per cancellarlo, anche quando era di un'altra ricetta — che restava così
 * senza protezione, pronta a vedersi riproporre la propria foto altrove.
 *
 * @param {string} url
 * @param {string} slug - ricetta che dichiara di non usarla più
 * @returns {Promise<{rimosso: boolean, proprietario: string|null, totale: number}>}
 *   `rimosso` falso con `proprietario` valorizzato = la voce è di un'altra
 *   ricetta ed è stata lasciata dov'era
 */
export async function liberaUrl(url, slug) {
    if (!url || typeof url !== 'string') {
        return { rimosso: false, proprietario: null, totale: contaIndiceImmagini() };
    }
    if (!slug || typeof slug !== 'string') {
        throw new TypeError('liberaUrl: serve lo slug della ricetta che libera l\'immagine');
    }
    let proprietario = null;
    const esito = await modificaIndiceImmagini(indice => {
        proprietario = Object.prototype.hasOwnProperty.call(indice, url) ? indice[url] : null;
        if (proprietario === slug) delete indice[url];
    });
    return { rimosso: esito.scritto, proprietario, totale: esito.totale };
}

/**
 * Tiene allineati indice e ricetta in una sola operazione: toglie il vecchio
 * URL (se era di questa ricetta) e segna il nuovo come usato, sotto un unico
 * lock. È la funzione che ogni percorso che CAMBIA l'immagine di una ricetta
 * dovrebbe chiamare — refresh, conferma dal selettore visuale, upload manuale,
 * generazione AI, eliminazione della ricetta (con `nuovoUrl` vuoto).
 *
 * Stessa semantica di `aggiornaIndiceImmagini` in `routes/image.js`, con in più
 * lock e scrittura atomica; l'unica differenza per chi la usa è che va attesa.
 *
 * @param {{slug: string, nuovoUrl?: string, vecchioUrl?: string}} opzioni
 * @returns {Promise<{aggiunto: boolean, rimosso: boolean, totale: number}>}
 */
export async function aggiornaIndiceImmagini({ slug, nuovoUrl = '', vecchioUrl = '' } = {}) {
    if (!slug || typeof slug !== 'string') {
        throw new TypeError('aggiornaIndiceImmagini: serve lo slug della ricetta');
    }
    let rimosso = false;
    let aggiunto = false;

    const esito = await modificaIndiceImmagini(indice => {
        rimosso = false;
        aggiunto = false;

        // Il vecchio URL si toglie solo se era rivendicato da QUESTA ricetta:
        // se è di un'altra, cancellarlo la esporrebbe a un duplicato.
        if (vecchioUrl && vecchioUrl !== nuovoUrl && indice[vecchioUrl] === slug) {
            delete indice[vecchioUrl];
            rimosso = true;
        }

        if (nuovoUrl) {
            aggiunto = indice[nuovoUrl] !== slug;
            indice[nuovoUrl] = slug;
        }
    });

    return { aggiunto, rimosso, totale: esito.totale };
}

/**
 * Toglie dall'indice tutte le voci di una ricetta, qualunque URL abbiano.
 * Serve all'eliminazione: la ricetta non esiste più, quindi le sue foto tornano
 * disponibili. Le voci delle altre ricette non si toccano.
 *
 * @param {string} slug
 * @returns {Promise<{rimossi: string[], totale: number}>} URL liberati
 */
export async function liberaUrlDiRicetta(slug) {
    if (!slug || typeof slug !== 'string') {
        throw new TypeError('liberaUrlDiRicetta: serve lo slug della ricetta');
    }
    const rimossi = [];
    const esito = await modificaIndiceImmagini(indice => {
        rimossi.length = 0;
        for (const [url, proprietario] of Object.entries(indice)) {
            if (proprietario === slug) {
                delete indice[url];
                rimossi.push(url);
            }
        }
    });
    return { rimossi, totale: esito.totale };
}
