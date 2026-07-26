/**
 * ROUTE HELPERS — Utility condivise per tutti i moduli di routing
 */

import { resolve, dirname, basename } from 'path';
import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'fs';
import { AsyncLocalStorage } from 'async_hooks';
import { log } from '../../utils/logger.js';

let jobCounter = 0;

/**
 * Genera un ID job univoco con prefisso
 * @param {string} prefix - Prefisso per l'ID (es. 'gen', 'img', 'qlt')
 * @returns {string} ID univoco (es. 'gen-42')
 */
export function nextJobId(prefix) {
    return `${prefix}-${++jobCounter}`;
}

/**
 * Risolve il path base del Ricettario
 */
export function getRicettarioPath(body) {
    return resolve(
        process.cwd(),
        body?.output || process.env.RICETTARIO_PATH || '../Ricettario'
    );
}

/**
 * Cerca un file JSON ricetta in tutte le cartelle categoria.
 * Prima controlla le cartelle note (CATEGORY_FOLDERS), poi fa fallback con scan.
 */
export function findRecipeJsonDynamic(ricettarioPath, CATEGORY_FOLDERS, slug) {
    for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
        const candidate = resolve(ricettarioPath, 'ricette', folder, `${slug}.json`);
        if (existsSync(candidate)) return { jsonFile: candidate, category: cat };
    }
    const ricettePath = resolve(ricettarioPath, 'ricette');
    if (existsSync(ricettePath)) {
        for (const catDir of readdirSync(ricettePath)) {
            const candidate = resolve(ricettePath, catDir, `${slug}.json`);
            if (existsSync(candidate)) {
                const fallbackCat = catDir.charAt(0).toUpperCase() + catDir.slice(1);
                return { jsonFile: candidate, category: fallbackCat };
            }
        }
    }
    return { jsonFile: null, category: null };
}

// ── Mutex leggero in-process, uno per file ──
// Evita race condition quando più job scrivono/leggono lo stesso indice.
// Non è un lock di sistema (inadeguato dentro un singolo processo Node): è una
// coda di Promise, tenuta separata per chiave. Prima ce n'era una sola e
// copriva solo image-cache.json; used-images.json, quality-index.json,
// verify-index.json, seo-cache.json e public/recipes.json restavano scoperti.
//
// STATO DELL'ADOZIONE (aggiornalo quando ne migri uno): coperti image-cache.json
// (withCacheLock) e public/recipes.json (commands/sync-cards.js). NON ancora
// migrati — leggono e riscrivono per intero senza lock e senza tmp+rename:
//   used-images.json   → routes/image.js (scriviIndiceImmagini) e la rotta
//                        /api/used-images/rebuild, che legge, attende un await
//                        e riscrive: una /api/refresh-image/confirm nel mezzo
//                        viene persa
//   verify-index.json  → src/verify.js (saveIndex)
//   seo-cache.json     → src/seo-keywords.js (saveCache)
//   quality-index.json → src/quality.js (saveScoreToIndex, saveQualityIndex)
// Per migrarne uno: leggiJson/scriviJsonAtomico al posto di readFileSync/
// writeFileSync, e il blocco legge-modifica-riscrive dentro conLockFile(file).

/** @type {Map<string, Promise<void>>} coda in corso, una per chiave */
const _codePerChiave = new Map();

/**
 * Chiavi già possedute lungo la catena di chiamate corrente. Serve solo a
 * trasformare un annidamento in un errore leggibile invece che in un blocco
 * senza messaggio (vedi `conLockFile`).
 * @type {AsyncLocalStorage<Set<string>>}
 */
const _chiaviPossedute = new AsyncLocalStorage();

/**
 * Normalizza la chiave del lock.
 *
 * Su Windows il filesystem è insensibile alle maiuscole: `.../Ricettario/...` e
 * `.../ricettario/...` sono lo STESSO file ma sarebbero due chiavi diverse,
 * cioè due scritture in parallelo sull'indice che il lock doveva proteggere
 * (raggiungibile dalla CLI con `--output Ricettario` e da refresh-image.js, che
 * propaga `args.output`). Sugli altri sistemi le maiuscole contano davvero e la
 * chiave resta com'è.
 */
function normalizzaChiave(chiave) {
    const testo = String(chiave);
    return process.platform === 'win32' ? testo.toLowerCase() : testo;
}

/**
 * Esegue una funzione con accesso esclusivo alla chiave indicata — di norma il
 * percorso assoluto del file che la funzione legge e riscrive.
 *
 * Le chiamate sulla stessa chiave si accodano; chiavi diverse restano
 * indipendenti, quindi un job sulla cache immagini non blocca un job
 * sull'indice qualità.
 *
 * **NON è rientrante**: dentro `fn` non si può chiamare di nuovo `conLockFile`
 * sulla stessa chiave, nemmeno indirettamente (per esempio avvolgendo in un
 * lock su `public/recipes.json` una funzione che a sua volta chiama
 * `syncCards`, o in un lock su `image-cache.json` una che chiama
 * `writeImageCache`): la chiamata interna aspetterebbe quella esterna, che sta
 * aspettando lei. Per non lasciare il server appeso senza messaggi
 * l'annidamento viene riconosciuto e respinto con un errore.
 *
 * @template T
 * @param {string} chiave - Percorso del file (o altro identificatore stabile)
 * @param {() => T | Promise<T>} fn - Funzione da eseguire in esclusiva
 * @returns {Promise<T>}
 * @example
 *   await conLockFile(percorso, () => {
 *       const indice = leggiJson(percorso);
 *       indice[slug] = valore;
 *       scriviJsonAtomico(percorso, indice);
 *   });
 */
export function conLockFile(chiave, fn) {
    const id = normalizzaChiave(chiave);

    const ereditate = _chiaviPossedute.getStore();
    if (ereditate && ereditate.has(id)) {
        // Meglio un errore subito che un server fermo per sempre: chi legge lo
        // stack vede quale funzione ha annidato il lock.
        return Promise.reject(new Error(
            `conLockFile: lock annidato sulla stessa chiave (${chiave}). ` +
            'Sarebbe un blocco definitivo: sposta la chiamata interna fuori dal lock esterno.'
        ));
    }
    // Copia: aggiungere la chiave al Set del chiamante la renderebbe visibile
    // anche ai suoi altri rami, che invece il lock non ce l'hanno.
    const possedute = new Set(ereditate);
    possedute.add(id);

    const precedente = _codePerChiave.get(id) || Promise.resolve();
    let rilascia;
    const mio = new Promise(res => { rilascia = res; });
    _codePerChiave.set(id, mio);
    return precedente.then(() => _chiaviPossedute.run(possedute, async () => {
        try {
            return await fn();
        } finally {
            // Tolta appena `fn` finisce: se `fn` ha lasciato in giro un lavoro
            // differito che riprova a prendere lo stesso lock, a quel punto è
            // legittimo — il lock è già stato rilasciato.
            possedute.delete(id);
            rilascia();
            // Se nessuno si è accodato dopo di noi la voce non serve più:
            // senza questa riga la mappa crescerebbe a ogni job.
            if (_codePerChiave.get(id) === mio) _codePerChiave.delete(id);
        }
    }));
}

/** Percorso di data/image-cache.json (dipende dalla cwd, quindi si ricalcola) */
function percorsoCacheImmagini() {
    return resolve(process.cwd(), 'data', 'image-cache.json');
}

/**
 * Accesso esclusivo a image-cache.json.
 * Scorciatoia storica per `conLockFile(<data/image-cache.json>, fn)`.
 *
 * @template T
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withCacheLock(fn) {
    return conLockFile(percorsoCacheImmagini(), fn);
}

/**
 * Legge un JSON restituendo `ripiego` se il file non esiste o è illeggibile.
 * @param {string} percorso
 * @param {*} [ripiego={}]
 */
export function leggiJson(percorso, ripiego = {}) {
    try {
        if (existsSync(percorso)) {
            return JSON.parse(readFileSync(percorso, 'utf-8'));
        }
    } catch {}
    return ripiego;
}

/**
 * Pausa sincrona di pochi millisecondi, usata solo fra i tentativi di rename
 * (vedi `rinominaOppureRipiega` per quanto può costare al massimo).
 */
function attendi(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Tentativi di rename e pausa fra l'uno e l'altro: al massimo 2 pause. Chieste
 * da 5 ms l'una, su Windows ne durano ~16 (granularità del timer), quindi il
 * blocco misurato nel caso peggiore è ~45 ms — vedi `rinominaOppureRipiega`.
 */
const TENTATIVI_RENAME = 3;
const PAUSA_RENAME_MS = 5;

/**
 * Rinomina il temporaneo sulla destinazione, ritentando pochissimo.
 *
 * Serve ritentare perché su Windows il rename fallisce con EPERM/EBUSY quando
 * qualcun altro tiene aperto il file di arrivo — antivirus, indicizzatore, o
 * semplicemente un'altra lettura della cache. Misurato con un lettore in loop
 * su un file da 2,3 MB: senza ritenti 56 scritture su 239 ripiegavano sulla
 * scrittura diretta, e 2 letture trovavano il file troncato; con questi
 * ritenti, zero e zero.
 *
 * Ma le pause sono `Atomics.wait`, che NON è un `await`: blocca il thread, cioè
 * il server intero. Prima erano 5 tentativi con attesa raddoppiata
 * (20/40/80/160 ms) e un rename impossibile congelava l'event loop per ~350 ms
 * misurati — nessuna richiesta HTTP, nessun frame WebSocket, per un terzo di
 * secondo. Ora le pause sono 2 e il caso peggiore misurato è ~45 ms (attenzione:
 * una pausa da 5 ms su Windows ne dura ~16, è la granularità del timer). Resta
 * dello stesso ordine dei ~30 ms che il chiamante paga comunque per serializzare
 * e scrivere un indice da 6 MB, mentre 350 ms non lo erano.
 *
 * Se i tentativi finiscono NON solleva: riscrive il contenuto direttamente
 * sulla destinazione, com'era prima del tmp+rename, e restituisce false. Lì
 * l'atomicità si perde davvero, ma il chiamante lo viene a sapere
 * (`scriviJsonAtomico` lo scrive nel log) invece che in silenzio. Sollevare
 * sarebbe peggio: l'errore risalirebbe writeImageCache → withCacheLock → il
 * catch di /api/refresh-image e una ricerca immagini riuscita diventerebbe un
 * job rosso, buttando via il risultato. Meglio una scrittura non atomica di una
 * scrittura persa.
 *
 * @returns {boolean} true se è passato il rename, false se si è ripiegato
 */
function rinominaOppureRipiega(origine, destinazione, contenuto) {
    for (let tentativo = 1; ; tentativo++) {
        try {
            renameSync(origine, destinazione);
            return true;
        } catch (err) {
            // Un errore non transitorio (percorso inesistente, disco pieno) non
            // migliora ritentando e non va nascosto.
            if (!err || !['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) throw err;
            if (tentativo >= TENTATIVI_RENAME) {
                writeFileSync(destinazione, contenuto, 'utf-8');
                try { unlinkSync(origine); } catch {}
                return false;
            }
            attendi(PAUSA_RENAME_MS);
        }
    }
}

/**
 * Toglie i temporanei lasciati da processi che non ci sono più
 * (`<file>.<pid>.tmp`).
 *
 * Un'interruzione fra la scrittura del temporaneo e il rename lascia sul disco
 * una copia INTERA del file — su image-cache.json sono 7,6 MB — che `git
 * status` mostra come non tracciata e che `deploy.bat`, che fa `git add -A`
 * alla cieca, si porterebbe dentro un commit. Il temporaneo di un processo VIVO
 * non si tocca: potrebbe essere una scrittura in corso (server e CLI avviati
 * insieme scrivono lo stesso file, ognuno con il proprio PID nel nome).
 *
 * Non solleva mai: è pulizia, non parte del contratto di scrittura.
 */
function togliTemporaneiOrfani(percorso) {
    try {
        const cartella = dirname(percorso);
        const prefisso = `${basename(percorso)}.`;
        for (const nome of readdirSync(cartella)) {
            if (!nome.startsWith(prefisso) || !nome.endsWith('.tmp')) continue;
            const pid = Number(nome.slice(prefisso.length, -'.tmp'.length));
            if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
            try {
                // Il segnale 0 non invia niente: serve solo a sapere se il
                // processo esiste ancora.
                process.kill(pid, 0);
                continue; // vivo: il temporaneo potrebbe essere suo e in uso
            } catch (err) {
                // ESRCH = non esiste più, il temporaneo è orfano.
                // EPERM = esiste ma è di un altro utente: si lascia stare.
                if (err?.code !== 'ESRCH') continue;
            }
            try { unlinkSync(resolve(cartella, nome)); } catch {}
        }
    } catch {}
}

/**
 * Scrive un JSON davvero atomicamente: prima su `<file>.<pid>.tmp`, poi rename
 * sul posto. Su un filesystem locale il rename è atomico, quindi chi legge
 * trova o il contenuto vecchio o quello nuovo, mai un file troncato a metà —
 * che con image-cache.json (7,8 MB) era lo scenario realistico di
 * un'interruzione. Il PID nel nome evita che server e CLI, avviati insieme, si
 * pestino il temporaneo a vicenda.
 *
 * Non sostituisce il lock: serializzare le scritture resta compito di
 * `conLockFile`, questa funzione garantisce solo che il file su disco non
 * rimanga mai a metà.
 *
 * Non fallisce dove prima passava `writeFileSync`: se il rename resta
 * impossibile si ripiega sulla scrittura diretta (vedi `rinominaOppureRipiega`)
 * restituendo false, e il ripiego finisce nel log.
 *
 * COSTA: si scrive e poi si rinomina, e sotto contesa si aspetta. Misurato su un
 * file da 2,3 MB con un lettore in loop per 3 secondi, su due esecuzioni:
 * 127 e 110 scritture con tmp+rename contro 243 e 197 dirette, cioè 1,8-1,9
 * volte più lento (letture trovate troncate: 114 e 54 senza rename, 0 e 0 con).
 * Su image-cache.json (7,6 MB,
 * riscritta a ogni ricerca immagini) è quasi un raddoppio del costo di I/O, ed è
 * il prezzo per non lasciare mai il file a metà. Inoltre il rename SOSTITUISCE
 * la destinazione: eventuali attributi o ACL del file di arrivo vengono presi
 * dal temporaneo, non conservati.
 *
 * ATTENZIONE (duplicazione nota): `src/image-finder.js` ha una seconda
 * implementazione di tmp+rename sullo STESSO file data/image-cache.json
 * (`scriviCacheAtomica`), scritta lì per non legare i comandi CLI ai moduli del
 * server. Le due copie sono già divergute (quella lì non crea la cartella e
 * inghiotte qualunque errore di rename). Vanno unificate in un modulo neutro:
 * finché non succede, chi tocca questa funzione controlli anche quella.
 *
 * @param {string} percorso - Percorso assoluto del file finale
 * @param {*} dati - Oggetto serializzabile
 * @returns {boolean} true se il file è stato sostituito atomicamente, false se
 *   si è dovuto ripiegare sulla scrittura diretta
 */
export function scriviJsonAtomico(percorso, dati) {
    const temporaneo = `${percorso}.${process.pid}.tmp`;
    const contenuto = JSON.stringify(dati, null, 2);
    mkdirSync(dirname(percorso), { recursive: true });
    togliTemporaneiOrfani(percorso);
    let atomico;
    try {
        writeFileSync(temporaneo, contenuto, 'utf-8');
        atomico = rinominaOppureRipiega(temporaneo, percorso, contenuto);
    } catch (err) {
        try { unlinkSync(temporaneo); } catch {}
        throw err;
    }
    if (!atomico) {
        // Senza questa riga il ripiego sarebbe invisibile: il file tornerebbe a
        // riscriversi in modo non atomico e nessuno se ne accorgerebbe.
        log.warn(`${basename(percorso)}: rename impossibile, riscritto in modo NON atomico (file tenuto aperto da un altro processo?)`);
    }
    return atomico;
}

/** Legge image-cache.json (restituisce {} se non esiste o è corrotto) */
export function readImageCache() {
    return leggiJson(percorsoCacheImmagini(), {});
}

/**
 * Scrive image-cache.json con tmp + rename, con ripiego NON atomico (e avviso a
 * log) se il rename resta impossibile — vedi `scriviJsonAtomico`.
 */
export function writeImageCache(data) {
    return scriviJsonAtomico(percorsoCacheImmagini(), data);
}
