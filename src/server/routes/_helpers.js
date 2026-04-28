/**
 * ROUTE HELPERS — Utility condivise per tutti i moduli di routing
 */

import { resolve } from 'path';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';

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

// ── Mutex leggero in-process per image-cache.json ──
// Evita race condition quando più job scrivono/leggono la cache contemporaneamente.
// Non è un file lock (inadeguato per un singolo processo Node), ma una Promise queue.

let _cacheLock = Promise.resolve();

/**
 * Esegue una funzione con accesso esclusivo a image-cache.json.
 * Serializza le operazioni di lettura/scrittura per evitare corruzioni.
 * 
 * @param {() => T | Promise<T>} fn - Funzione da eseguire con la cache
 * @returns {Promise<T>}
 * @example
 *   const data = await withCacheLock(async () => {
 *       const cache = readImageCache();
 *       cache[slug] = { providerResults, timestamp: Date.now() };
 *       writeImageCache(cache);
 *       return cache;
 *   });
 */
export function withCacheLock(fn) {
    const prev = _cacheLock;
    let releaseFn;
    _cacheLock = new Promise(resolve => { releaseFn = resolve; });
    return prev.then(async () => {
        try {
            return await fn();
        } finally {
            releaseFn();
        }
    });
}

/** Legge image-cache.json (returns {} se non esiste o corrotto) */
export function readImageCache() {
    const cachePath = resolve(process.cwd(), 'data', 'image-cache.json');
    try {
        if (existsSync(cachePath)) {
            return JSON.parse(readFileSync(cachePath, 'utf-8'));
        }
    } catch {}
    return {};
}

/** Scrive image-cache.json atomicamente */
export function writeImageCache(data) {
    const cachePath = resolve(process.cwd(), 'data', 'image-cache.json');
    writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf-8');
}
