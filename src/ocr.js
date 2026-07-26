/**
 * OCR Module — Bridge Node → Python (Surya OCR)
 *
 * Chiama lo script Python ocr-surya.py e restituisce i risultati OCR.
 *
 * Il lavoro è spezzato in blocchi di poche pagine: dopo ogni blocco i
 * risultati vengono uniti a quelli già sul disco e riscritti. Prima la
 * chiamata era una sola, con un timeout di 30 minuti sull'intera estrazione e
 * il salvataggio solo alla fine: se il timeout scadeva (151 pagine sono ore di
 * lavoro) non restava niente e si ripartiva da zero. Ora un'interruzione costa
 * al massimo un blocco, e il lancio successivo riprende dalle pagine mancanti.
 */

import { execFileSync } from 'child_process';
import {
    readFileSync, writeFileSync, existsSync, readdirSync,
    mkdirSync, rmSync, renameSync, linkSync, copyFileSync
} from 'fs';
import { resolve, join, basename } from 'path';
import { tmpdir } from 'os';
import { log } from './utils/logger.js';

const RADICE = resolve(import.meta.dirname, '..');
const OCR_SCRIPT = resolve(RADICE, 'ocr-surya.py');
const OCR_OUTPUT = resolve(RADICE, 'data', 'ocr-results.json');

// I file di servizio dell'archivio (la scrittura a metà, e la copia messa da
// parte quando l'archivio è illeggibile) stanno in una cartella a parte che si
// auto-esclude da git. Motivo: `tools/.gitignore` ignora `data/ocr-results.json`
// per percorso ESATTO, quindi `ocr-results.json.tmp` e `.corrotto` non sarebbero
// coperti, e `deploy.bat` fa `git add -A` anche dentro `tools/`: un `.corrotto`
// pesa quanto l'archivio (~290 KB) e finirebbe in un commit.
const CARTELLA_SERVIZIO = resolve(RADICE, 'data', 'ocr-appoggio');

// Cartella di appoggio fuori da entrambi i repo: contiene i collegamenti alle
// pagine del blocco in corso e l'uscita parziale di Python. Non deve sporcare
// né `tools/` né il sito, e viene sempre ripulita a fine estrazione.
const TEMP = join(tmpdir(), 'ricettario-ocr');
const STAGING = join(TEMP, 'pagine');
const USCITA_BLOCCO = join(TEMP, 'blocco.json');

// Ogni blocco è una chiamata a Python: ricarica i modelli Surya (qualche
// decina di secondi) ma è anche un punto di salvataggio. Blocco più piccolo =
// meno lavoro perso in caso di interruzione, più tempo speso a caricare i
// modelli. Regolabile con OCR_PAGINE_PER_BLOCCO.
const PAGINE_PER_BLOCCO = Number(process.env.OCR_PAGINE_PER_BLOCCO) || 10;

// Timeout PER BLOCCO, non per l'intera estrazione: 5 min per il caricamento
// dei modelli + 2 min a pagina, cioè 25 minuti per un blocco pieno da 10.
// Sostituibile in blocco con OCR_TIMEOUT_BLOCCO_MS (millisecondi).
//
// Attenzione al conto peggiore: con la regola «mi fermo dopo 2 blocchi falliti
// di fila», due blocchi appesi costano fino a 50 minuti prima che il comando si
// arrenda — più dei 30 minuti del timeout unico di prima. È il prezzo
// dell'incrementalità e non fa perdere lavoro (quello che è stato estratto è
// già sul disco), ma se serve un'attesa più corta si abbassa
// OCR_PAGINE_PER_BLOCCO o si fissa OCR_TIMEOUT_BLOCCO_MS.
const TIMEOUT_MODELLI_MS = 300000;      // 5 min per il caricamento di Surya
const TIMEOUT_PER_PAGINA_MS = 120000;   // 2 min a pagina

/**
 * Una voce dei risultati va (ri)estratta se manca, se è malformata o se
 * contiene un errore: un errore registrato non è un risultato, altrimenti la
 * pagina resterebbe saltata per sempre.
 */
function vaEstratta(voce) {
    return !voce || typeof voce !== 'object' || voce.error !== undefined || typeof voce.text !== 'string';
}

/** Elenca le pagine PNG delle cartelle, in ordine e senza nomi duplicati. */
function elencaPagine(cartelle) {
    const perNome = new Map();
    for (const cartella of cartelle) {
        const nomi = readdirSync(cartella).filter(f => f.toLowerCase().endsWith('.png')).sort();
        for (const nome of nomi) {
            if (perNome.has(nome)) {
                log.warn(`Pagina con lo stesso nome in due cartelle: "${nome}" — tengo quella di ${basename(cartella)}.`);
            }
            perNome.set(nome, {
                filename: nome,
                percorso: join(cartella, nome),
                cartella: basename(cartella)
            });
        }
    }
    return [...perNome.values()];
}

/**
 * Crea la cartella di servizio e ci mette dentro un `.gitignore` con `*`, che
 * esclude da git tutto il contenuto (compreso se stesso). La garanzia nasce
 * insieme alla cartella, senza dipendere da una riga in `tools/.gitignore` che
 * qualcuno può riscrivere senza sapere che questa cartella esiste.
 */
function cartellaServizio() {
    mkdirSync(CARTELLA_SERVIZIO, { recursive: true });
    const regola = resolve(CARTELLA_SERVIZIO, '.gitignore');
    if (!existsSync(regola)) writeFileSync(regola, '*\n', 'utf-8');
    return CARTELLA_SERVIZIO;
}

/** Legge i risultati già estratti; se il file è illeggibile lo mette da parte. */
function caricaRisultatiEsistenti() {
    if (!existsSync(OCR_OUTPUT)) return {};
    try {
        const dati = JSON.parse(readFileSync(OCR_OUTPUT, 'utf-8'));
        return dati && typeof dati === 'object' ? dati : {};
    } catch (err) {
        // Con la data nel nome, una seconda corruzione non cancella la copia
        // della prima.
        const quando = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
        const daParte = join(cartellaServizio(), `ocr-results-${quando}.json.corrotto`);
        try { renameSync(OCR_OUTPUT, daParte); } catch { /* se non ci riesco, pazienza */ }
        log.warn(`${basename(OCR_OUTPUT)} illeggibile (${err.message}): l'ho messo da parte in data/ocr-appoggio/${basename(daParte)} e riparto da zero.`);
        return {};
    }
}

/** Scrive i risultati in modo atomico: un'interruzione non lascia un file troncato. */
function salvaRisultati(risultati) {
    mkdirSync(resolve(RADICE, 'data'), { recursive: true });
    // Il temporaneo sta nella cartella di servizio (stesso disco: il rename
    // resta atomico) così un'interruzione non lascia un file estraneo accanto
    // all'archivio, dove git lo vedrebbe.
    const temporaneo = join(cartellaServizio(), 'ocr-results.json.tmp');
    writeFileSync(temporaneo, JSON.stringify(risultati, null, 2), 'utf-8');
    renameSync(temporaneo, OCR_OUTPUT);
}

/**
 * Prepara la cartella di appoggio con le sole pagine del blocco.
 * ocr-surya.py accetta cartelle, non singoli file: per dargli un sottoinsieme
 * si usano collegamenti fisici (niente copia dei byte; se il filesystem non li
 * supporta si ripiega sulla copia).
 */
function preparaStaging(blocco) {
    rmSync(STAGING, { recursive: true, force: true });
    mkdirSync(STAGING, { recursive: true });
    for (const pagina of blocco) {
        const destinazione = join(STAGING, pagina.filename);
        try {
            linkSync(pagina.percorso, destinazione);
        } catch {
            copyFileSync(pagina.percorso, destinazione);
        }
    }
}

/** Esegue Surya su un singolo blocco di pagine e ne restituisce i risultati. */
function eseguiSurya(blocco, timeoutMs) {
    preparaStaging(blocco);
    rmSync(USCITA_BLOCCO, { force: true });

    // execFileSync e non execSync: senza shell di mezzo il timeout colpisce il
    // processo che abbiamo lanciato e non una `cmd.exe` intermedia (con la
    // shell moriva solo lei, e il figlio vero restava a girare sulla GPU), e i
    // percorsi con gli spazi non hanno bisogno di virgolette.
    //
    // Fin dove arriva la garanzia: il timeout uccide il FIGLIO DIRETTO, cioè
    // `py.exe`. Su Windows il launcher lancia a sua volta `python.exe`, che è
    // un NIPOTE, e nessuno promette che muoia col padre. Su questa macchina non
    // è verificabile (`py -3.13 --version` risponde «No suitable Python runtime
    // found»); simulando l'albero con Node, un nipote normale muore col padre,
    // uno staccato sopravvive e continua a scrivere. Quindi: se dopo un timeout
    // si vedesse Surya ancora sulla GPU, la strada è spawnSync + `taskkill /T
    // /F /PID` sull'albero, non un timeout più lungo.
    //
    // Sui DATI però non cambia niente in nessuno dei due casi: il
    // `rmSync(USCITA_BLOCCO)` qui sopra pulisce prima di ogni blocco, quindi un
    // file lasciato indietro da un processo sopravvissuto non viene mai letto
    // come risultato.
    const argomenti = ['-3.13', OCR_SCRIPT, '--input', STAGING, '--output', USCITA_BLOCCO];
    log.debug(`Comando: py ${argomenti.join(' ')}`);

    execFileSync('py', argomenti, {
        stdio: 'inherit',
        timeout: timeoutMs,
        cwd: RADICE,
        env: {
            ...process.env,
            TORCH_DEVICE: 'cuda',
            PYTHONIOENCODING: 'utf-8'
        }
    });

    if (!existsSync(USCITA_BLOCCO)) {
        throw new Error(`Python non ha prodotto nessun risultato (${basename(USCITA_BLOCCO)} assente)`);
    }
    const parziale = JSON.parse(readFileSync(USCITA_BLOCCO, 'utf-8'));
    rmSync(USCITA_BLOCCO, { force: true });
    return parziale;
}

/** Restituisce solo le voci relative alle pagine di questa esecuzione. */
function soloPagine(risultati, pagine) {
    const uscita = {};
    for (const pagina of pagine) {
        if (risultati[pagina.filename]) uscita[pagina.filename] = risultati[pagina.filename];
    }
    return uscita;
}

/**
 * Esegue OCR Surya su una lista di cartelle di immagini, a blocchi, salvando
 * dopo ognuno.
 * @param {string[]} folders - Percorsi assoluti alle cartelle di immagini
 * @param {Object} [opzioni]
 * @param {number} [opzioni.paginePerBlocco] - Pagine per invocazione di Python
 * @param {boolean} [opzioni.riprendi=true] - Salta le pagine già estratte (con
 *   `false` le ri-estrae tutte, senza però buttare via il resto dell'archivio)
 * @param {number} [opzioni.timeoutBloccoMs] - Timeout di un singolo blocco
 * @param {Function} [opzioni.eseguiBlocco] - Esecutore alternativo (test)
 * @returns {Object} Risultati OCR: { filename: { folder, text, lines, confidence } }
 */
export async function runOcr(folders, opzioni = {}) {
    // Filtra cartelle esistenti
    const existingFolders = folders.filter(f => existsSync(f));
    if (existingFolders.length === 0) {
        log.error('Nessuna cartella di immagini trovata.');
        return {};
    }

    const pagine = elencaPagine(existingFolders);
    if (pagine.length === 0) {
        log.error('Nessuna immagine PNG trovata nelle cartelle indicate.');
        return {};
    }

    const paginePerBlocco = Math.max(1, opzioni.paginePerBlocco || PAGINE_PER_BLOCCO);
    const riprendi = opzioni.riprendi !== false;
    const esegui = opzioni.eseguiBlocco || eseguiSurya;
    const timeoutFisso = Number(opzioni.timeoutBloccoMs) || Number(process.env.OCR_TIMEOUT_BLOCCO_MS) || 0;
    const timeoutDi = (quantePagine) => timeoutFisso || (TIMEOUT_MODELLI_MS + quantePagine * TIMEOUT_PER_PAGINA_MS);

    log.header('SURYA OCR — Estrazione Testo Locale');
    log.info(`Cartelle: ${existingFolders.length} — pagine trovate: ${pagine.length}`);

    // L'archivio si carica SEMPRE, anche con `riprendi: false`: `salvaRisultati`
    // riscrive tutto il file, quindi partire da `{}` cancellerebbe le voci delle
    // pagine che non stanno nelle cartelle di questa esecuzione (ore di OCR di
    // un altro PDF, sparite senza un avviso). `riprendi: false` vuol dire
    // "ri-estrai tutte queste pagine", non "butta via il resto".
    const risultati = caricaRisultatiEsistenti();
    const daFare = riprendi ? pagine.filter(p => vaEstratta(risultati[p.filename])) : [...pagine];
    const giaFatte = pagine.length - daFare.length;
    if (giaFatte > 0) {
        log.success(`${giaFatte} pagine erano già state estratte: le salto e riprendo da dove ero rimasto.`);
    }
    if (daFare.length === 0) {
        log.success('Niente da estrarre: tutte le pagine sono già a posto.');
        return soloPagine(risultati, pagine);
    }

    const blocchi = [];
    for (let i = 0; i < daFare.length; i += paginePerBlocco) {
        blocchi.push(daFare.slice(i, i + paginePerBlocco));
    }
    log.info(`${daFare.length} pagine da estrarre in ${blocchi.length} blocc${blocchi.length === 1 ? 'o' : 'hi'} da max ${paginePerBlocco} (salvataggio dopo ogni blocco).`);

    const blocchiFalliti = [];
    let fallitiDiFila = 0;

    try {
        for (let i = 0; i < blocchi.length; i++) {
            const blocco = blocchi[i];
            log.info(`Blocco ${i + 1}/${blocchi.length}: ${blocco.length} pagine (${blocco[0].filename} → ${blocco[blocco.length - 1].filename})`);

            try {
                const parziale = await esegui(blocco, timeoutDi(blocco.length));
                let estratte = 0;
                for (const pagina of blocco) {
                    const voce = parziale?.[pagina.filename];
                    if (!voce) continue;
                    // La cartella la conosciamo noi: Python vede solo la cartella di appoggio.
                    risultati[pagina.filename] = { ...voce, folder: pagina.cartella };
                    if (!vaEstratta(risultati[pagina.filename])) estratte++;
                }
                salvaRisultati(risultati);
                log.success(`Blocco ${i + 1}: ${estratte}/${blocco.length} pagine estratte e salvate (${Object.keys(risultati).length} pagine in archivio).`);
                fallitiDiFila = 0;
            } catch (err) {
                blocchiFalliti.push(i + 1);
                fallitiDiFila++;
                log.error(`Blocco ${i + 1} fallito: ${err.message}`);
                log.warn('Le sue pagine restano da fare: rilancia il comando e riprenderà da lì.');
                if (fallitiDiFila >= 2) {
                    log.error('Due blocchi falliti di seguito: mi fermo qui. Quello che era già stato estratto è salvato in data/ocr-results.json.');
                    break;
                }
            }
        }
    } finally {
        rmSync(TEMP, { recursive: true, force: true });
    }

    const finali = soloPagine(risultati, pagine);
    const successCount = Object.values(finali).filter(r => r.lines > 0).length;
    log.success(`OCR completato: ${successCount}/${pagine.length} pagine con testo`);
    if (blocchiFalliti.length > 0) {
        log.warn(`Blocchi falliti: ${blocchiFalliti.join(', ')} — rilancia il comando per riprovarli.`);
    }

    return finali;
}

/**
 * Raggruppa le pagine OCR in batch per invio a Claude.
 * Include overlap tra batch per gestire ricette cross-pagina.
 * @param {Object} ocrResults - Risultati OCR da runOcr()
 * @param {number} batchSize - Numero di pagine nuove per batch
 * @param {number} overlap - Pagine di overlap tra batch consecutivi
 * @returns {Array<Array<{filename, folder, text, isOverlap}>>} Array di batch
 */
export function groupOcrPages(ocrResults, batchSize = 10, overlap = 2) {
    const pages = Object.entries(ocrResults)
        .filter(([, data]) => data.lines > 0 && data.text.trim().length > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([filename, data]) => ({
            filename,
            folder: data.folder,
            text: data.text,
            confidence: data.confidence
        }));

    const batches = [];
    for (let i = 0; i < pages.length; i += batchSize) {
        const batch = [];

        // Aggiungi pagine overlap dal batch precedente (marcate come overlap)
        if (i > 0 && overlap > 0) {
            const overlapStart = Math.max(0, i - overlap);
            for (let j = overlapStart; j < i; j++) {
                batch.push({ ...pages[j], isOverlap: true });
            }
        }

        // Aggiungi le pagine nuove di questo batch
        const end = Math.min(i + batchSize, pages.length);
        for (let j = i; j < end; j++) {
            batch.push({ ...pages[j], isOverlap: false });
        }

        batches.push(batch);
    }

    return batches;
}
