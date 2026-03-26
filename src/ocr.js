/**
 * OCR Module — Bridge Node → Python (Surya OCR)
 * 
 * Chiama lo script Python ocr-surya.py e restituisce i risultati OCR.
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { log } from './utils/logger.js';

const OCR_SCRIPT = resolve(import.meta.dirname, '..', 'ocr-surya.py');
const OCR_OUTPUT = resolve(import.meta.dirname, '..', 'data', 'ocr-results.json');

/**
 * Esegue OCR Surya su una lista di cartelle di immagini.
 * @param {string[]} folders - Percorsi assoluti alle cartelle di immagini
 * @returns {Object} Risultati OCR: { filename: { folder, text, lines, confidence } }
 */
export async function runOcr(folders) {
    // Filtra cartelle esistenti
    const existingFolders = folders.filter(f => existsSync(f));
    if (existingFolders.length === 0) {
        log.error('Nessuna cartella di immagini trovata.');
        return {};
    }

    const folderArgs = existingFolders.map(f => `"${f}"`).join(' ');
    const cmd = `py -3.13 "${OCR_SCRIPT}" --input ${folderArgs} --output "${OCR_OUTPUT}"`;

    log.header('SURYA OCR — Estrazione Testo Locale');
    log.info(`Cartelle: ${existingFolders.length}`);
    log.info(`Comando: ${cmd}`);

    try {
        execSync(cmd, {
            stdio: 'inherit',
            timeout: 1800000, // 30 min max
            cwd: resolve(import.meta.dirname, '..'),
            env: {
                ...process.env,
                TORCH_DEVICE: 'cuda',
                PYTHONIOENCODING: 'utf-8'
            }
        });
    } catch (err) {
        log.error(`Errore OCR Surya: ${err.message}`);
        throw err;
    }

    // Leggi risultati
    if (!existsSync(OCR_OUTPUT)) {
        log.error(`File risultati OCR non trovato: ${OCR_OUTPUT}`);
        return {};
    }

    const results = JSON.parse(readFileSync(OCR_OUTPUT, 'utf-8'));
    const successCount = Object.values(results).filter(r => r.lines > 0).length;
    log.success(`OCR completato: ${successCount}/${Object.keys(results).length} immagini con testo`);

    return results;
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
