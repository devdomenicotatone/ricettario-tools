/**
 * WS-HANDLER — WebSocket per streaming output comandi
 *
 * Cattura stdout/stderr dei comandi in esecuzione e li trasmette
 * in realtime a tutti i client WebSocket connessi.
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

/** @type {Map<string, {status: string, name: string, startedAt: number, righeTotali: number, righe: {text: string, stream: string}[]}>} */
const activeJobs = new Map();

// ── Log su file ──
// Finora l'output dei job esisteva solo nel DOM del browser: chiusa la scheda,
// spariva tutto (compresi gli errori di un batch da ore). Ora ogni riga finisce
// anche in un file di testo, uno al giorno.
const CARTELLA_LOG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'logs');
const MAX_RIGHE_IN_MEMORIA = 300;

// I log restano sul computer e fuori da git. `deploy.bat` fa `git add -A` sul repo
// tools senza guardare cosa aggiunge: senza questa barriera ogni riga di output —
// il nome del job (che per /api/testo contiene l'inizio del testo incollato), i
// percorsi assoluti delle tue cartelle, i messaggi d'errore — finirebbe nella
// storia git pubblica. È lo stesso buco già chiuso per `data/_tmp_testo.txt`.
// Il .gitignore sta DENTRO la cartella dei log, non in quello di radice, perché la
// cartella la crea questo modulo: nasce insieme a lei e non può restare indietro.
//
// `*` DA SOLO, senza `!.gitignore` sotto: è la stessa convenzione di
// `data/ocr-appoggio/` (src/ocr.js) e `data/backup-ricette/`
// (src/utils/backup-ricette.js). Un `*` che non fa eccezioni esclude tutto il
// contenuto della cartella, questo file compreso, e git lo legge lo stesso — le
// regole valgono anche quando il file che le contiene è ignorato. Con
// `!.gitignore` invece il file si rimetteva in gioco da solo: `git status`
// mostrava `?? data/logs/` e il primo `git add -A` di `deploy.bat` lo committava,
// cioè proprio la cosa che questa barriera doveva impedire.
const GITIGNORE_LOG = [
    '# Generato da src/server/ws-handler.js — non modificare a mano.',
    '# I log dei job restano su questo computer: contengono nomi dei job, percorsi',
    '# delle tue cartelle e messaggi d\'errore, e `deploy.bat` fa `git add -A`.',
    '# Il `*` copre anche questo file: è voluto, git lo legge comunque.',
    '*',
    '',
].join('\n');

let cartellaLogPronta = false;

export function percorsoCartellaLog() {
    return CARTELLA_LOG;
}

/**
 * Aggiunge una riga a `data/logs/<nomeFile>.log`. Non lancia mai: un log che non
 * si riesce a scrivere non deve fermare il lavoro vero.
 */
export function scriviLog(nomeFile, testo) {
    try {
        if (!cartellaLogPronta) {
            mkdirSync(CARTELLA_LOG, { recursive: true });
            // Scritto PRIMA della prima riga di log: non deve esistere un istante in
            // cui la cartella contiene output e non è ancora ignorata.
            writeFileSync(resolve(CARTELLA_LOG, '.gitignore'), GITIGNORE_LOG, 'utf8');
            cartellaLogPronta = true;
        }
        appendFileSync(
            resolve(CARTELLA_LOG, `${nomeFile}.log`),
            `[${new Date().toISOString()}] ${testo}\n`,
            'utf8'
        );
    } catch {
        // Silenzio voluto: il logging non può diventare la causa di un guasto.
    }
}

function logDelGiorno() {
    return `job-${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Accorpa le righe consecutive dello stesso stream in un unico testo con a-capo.
 * Serve solo al replay: meno messaggi, e soprattutto meno nodi nel DOM se il
 * client si riconnette e riceve il buffer una seconda volta.
 */
function raggruppaPerStream(righe) {
    const blocchi = [];
    for (const riga of righe) {
        const ultimo = blocchi[blocchi.length - 1];
        if (ultimo && ultimo.stream === riga.stream) ultimo.text += `\n${riga.text}`;
        else blocchi.push({ stream: riga.stream, text: riga.text });
    }
    return blocchi;
}

export function setupWebSocket(wss) {
    wss.on('connection', (ws) => {
        clients.add(ws);

        // Invia lo stato corrente (senza il buffer delle righe: viaggia dopo)
        ws.send(JSON.stringify({
            type: 'connected',
            activeJobs: Array.from(activeJobs.entries())
                .map(([id, { righe, righeTotali, ...job }]) => ({ id, ...job })),
        }));

        // Ripristina l'output dei job ancora in corso: ricaricando la pagina mentre
        // un job gira, prima si ritrovava un terminale vuoto.
        //
        // Si rigioca con `job:start` + `job:output`, cioè gli stessi messaggi del
        // flusso normale, perché sono gli unici che il client sa consumare:
        // `handleWsMessage` (src/dashboard/modules/terminal.js) è uno `switch` senza
        // `default`, quindi un tipo nuovo — un `job:replay` di formato più ricco —
        // verrebbe scartato in silenzio e il terminale resterebbe vuoto come prima.
        //
        // Le righe partono a blocchi invece che una per una: `appendTerminal` non è
        // idempotente e il client si riconnette da solo dopo 3 secondi, quindi su
        // una connessione che cade il buffer viene rigiocato più volte. Un messaggio
        // per riga vorrebbe dire fino a MAX_RIGHE_IN_MEMORIA nodi duplicati a ogni
        // riconnessione; raggruppando le righe consecutive dello stesso stream
        // restano pochi nodi. Il testo esce identico: `.terminal-line` ha
        // `white-space: pre-wrap` (css/terminal.css), quindi gli a-capo dentro un
        // blocco restano a-capo.
        for (const [jobId, job] of activeJobs) {
            ws.send(JSON.stringify({ type: 'job:start', jobId, name: job.name }));

            // Il buffer è a scorrimento: su un job lungo le righe più vecchie non
            // ci sono più. Dirlo è meglio che far credere che il job sia partito da lì.
            const perse = job.righeTotali - job.righe.length;
            if (perse > 0) {
                ws.send(JSON.stringify({
                    type: 'job:output',
                    jobId,
                    text: `… ${perse} righe precedenti non sono più in memoria (il file in ${CARTELLA_LOG} le ha tutte)`,
                    stream: 'system',
                }));
            }

            for (const blocco of raggruppaPerStream(job.righe)) {
                ws.send(JSON.stringify({
                    type: 'job:output',
                    jobId,
                    text: blocco.text,
                    stream: blocco.stream,
                }));
            }
        }

        ws.on('close', () => clients.delete(ws));

        // Senza questo ascoltatore un frame malformato di un peer anomalo farebbe
        // terminare il processo Node, portandosi via il batch in corso.
        ws.on('error', (err) => {
            clients.delete(ws);
            console.error(`⚠️  Errore WebSocket client: ${err?.message || err}`);
            scriviLog('errori', `WebSocket client: ${err?.stack || err}`);
        });
    });

    wss.on('error', (err) => {
        console.error(`⚠️  Errore WebSocketServer: ${err?.message || err}`);
        scriviLog('errori', `WebSocketServer: ${err?.stack || err}`);
    });
}

/**
 * Broadcast un messaggio a tutti i client WS
 */
export function broadcast(data) {
    const msg = JSON.stringify(data);
    for (const ws of clients) {
        if (ws.readyState === 1) { // OPEN
            try {
                ws.send(msg);
            } catch (err) {
                // La connessione può morire fra il controllo e l'invio.
                clients.delete(ws);
                scriviLog('errori', `Invio WebSocket fallito: ${err?.message || err}`);
            }
        }
    }
}

/**
 * Crea un job context che cattura l'output e lo streamma via WS.
 * Restituisce un oggetto con metodi log/error/end.
 */
export function createJobContext(jobId, jobName) {
    activeJobs.set(jobId, { status: 'running', name: jobName, startedAt: Date.now(), righeTotali: 0, righe: [] });

    broadcast({ type: 'job:start', jobId, name: jobName });
    scriviLog(logDelGiorno(), `[${jobId}] ▶ ${jobName || 'job'}`);

    /**
     * Tiene in memoria le ultime righe, per ridarle a chi si (ri)connette.
     * `righeTotali` conta anche quelle già uscite dal buffer: è la differenza fra i
     * due che dice al replay quante righe non può più mostrare.
     */
    function ricorda(text, stream) {
        const job = activeJobs.get(jobId);
        if (!job) return;
        job.righeTotali += 1;
        job.righe.push({ text, stream });
        if (job.righe.length > MAX_RIGHE_IN_MEMORIA) job.righe.shift();
    }

    return {
        id: jobId,

        log(text) {
            broadcast({ type: 'job:output', jobId, text, stream: 'stdout' });
            ricorda(text, 'stdout');
            scriviLog(logDelGiorno(), `[${jobId}] ${text}`);
        },

        error(text) {
            broadcast({ type: 'job:output', jobId, text, stream: 'stderr' });
            ricorda(text, 'stderr');
            scriviLog(logDelGiorno(), `[${jobId}] ERR ${text}`);
        },

        end(success = true, result = null) {
            // Va letto PRIMA della delete, altrimenti la durata è sempre 0.
            const startedAt = activeJobs.get(jobId)?.startedAt || Date.now();
            activeJobs.delete(jobId);
            const duration = Date.now() - startedAt;
            broadcast({ type: 'job:end', jobId, success, result, duration });
            scriviLog(logDelGiorno(), `[${jobId}] ${success ? '✔' : '✖'} fine (${Math.round(duration / 1000)}s)`);
        },
    };
}

import { AsyncLocalStorage } from 'async_hooks';

export const jobStorage = new AsyncLocalStorage();

// Intercetta a livello globale UNA SOLA VOLTA per non sovrascrivere distruttivamente in concorrenza
const origLog = console.log;
const origError = console.error;
const origWarn = console.warn;
const origWrite = process.stdout.write;

let _fromConsole = false;

console.log = (...args) => {
    const jobCtx = jobStorage.getStore();
    if (jobCtx) {
        const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
        jobCtx.log(text);
    }
    _fromConsole = true;
    origLog.apply(console, args);
    _fromConsole = false;
};

console.error = (...args) => {
    const jobCtx = jobStorage.getStore();
    if (jobCtx) {
        const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
        jobCtx.error(text);
    }
    _fromConsole = true;
    origError.apply(console, args);
    _fromConsole = false;
};

console.warn = console.error;

process.stdout.write = function (chunk, encoding, callback) {
    if (!_fromConsole) {
        const jobCtx = jobStorage.getStore();
        if (jobCtx) {
            const text = typeof chunk === 'string' ? chunk : chunk.toString();
            if (text.trim()) jobCtx.log(text.trimEnd());
        }
    }
    return origWrite.apply(process.stdout, arguments);
};

/**
 * Esegue un blocco di codice all'interno del contesto AsyncLocalStorage,
 * redirigendo magicamente i log senza distruggere i riferimenti globali.
 */
export async function withOutputCapture(jobCtx, fn) {
    return jobStorage.run(jobCtx, async () => {
        return await fn();
    });
}
