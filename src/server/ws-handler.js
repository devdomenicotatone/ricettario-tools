/**
 * WS-HANDLER — WebSocket per streaming output comandi
 *
 * Cattura stdout/stderr dei comandi in esecuzione e li trasmette
 * in realtime a tutti i client WebSocket connessi.
 */

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

/** @type {Map<string, {status: string, startedAt: number}>} */
const activeJobs = new Map();

export function setupWebSocket(wss) {
    wss.on('connection', (ws) => {
        clients.add(ws);

        // Invia lo stato corrente
        ws.send(JSON.stringify({
            type: 'connected',
            activeJobs: Array.from(activeJobs.entries()).map(([id, job]) => ({ id, ...job })),
        }));

        ws.on('close', () => clients.delete(ws));
    });
}

/**
 * Broadcast un messaggio a tutti i client WS
 */
export function broadcast(data) {
    const msg = JSON.stringify(data);
    for (const ws of clients) {
        if (ws.readyState === 1) { // OPEN
            ws.send(msg);
        }
    }
}

/**
 * Crea un job context che cattura l'output e lo streamma via WS.
 * Restituisce un oggetto con metodi log/error/end.
 */
export function createJobContext(jobId, jobName) {
    activeJobs.set(jobId, { status: 'running', name: jobName, startedAt: Date.now() });

    broadcast({ type: 'job:start', jobId, name: jobName });

    return {
        id: jobId,

        log(text) {
            broadcast({ type: 'job:output', jobId, text, stream: 'stdout' });
        },

        error(text) {
            broadcast({ type: 'job:output', jobId, text, stream: 'stderr' });
        },

        end(success = true, result = null) {
            activeJobs.delete(jobId);
            broadcast({
                type: 'job:end',
                jobId,
                success,
                result,
                duration: Date.now() - (activeJobs.get(jobId)?.startedAt || Date.now()),
            });
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
