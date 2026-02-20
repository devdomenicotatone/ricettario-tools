/**
 * API UTILS — Wrapper Claude API con retry e parsing robusto
 * 
 * Features:
 *   - Retry con exponential backoff (3 tentativi)
 *   - Parsing JSON tollerante (strippa fences, commenti, virgole trailing)
 *   - Funzione unificata callClaude() per tutti i moduli
 */

import Anthropic from '@anthropic-ai/sdk';
import { log } from './logger.js';

const client = new Anthropic();

const DEFAULT_RETRY = {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
};

/**
 * Chiama Claude API con retry automatico e exponential backoff
 *
 * @param {object} options
 * @param {string} options.model - Modello Claude (default: claude-sonnet-4-5-20250929)
 * @param {number} options.maxTokens - Max tokens risposta (default: 4096)
 * @param {string} [options.system] - System prompt
 * @param {Array} options.messages - Array messaggi [{role, content}]
 * @param {object} [options.retry] - Config retry (maxAttempts, baseDelayMs)
 * @returns {Promise<string>} Testo della risposta
 */
export async function callClaude({
    model = 'claude-sonnet-4-5-20250929',
    maxTokens = 4096,
    system,
    messages,
    retry = DEFAULT_RETRY,
}) {
    const { maxAttempts, baseDelayMs, maxDelayMs } = { ...DEFAULT_RETRY, ...retry };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const params = { model, max_tokens: maxTokens, messages };
            if (system) params.system = system;

            const message = await client.messages.create(params);
            return message.content[0].text.trim();
        } catch (err) {
            const isRetryable = isRetryableError(err);
            const isLast = attempt === maxAttempts;

            if (isLast || !isRetryable) {
                log.error(`Claude API fallita dopo ${attempt} tentativ${attempt === 1 ? 'o' : 'i'}: ${err.message}`);
                throw err;
            }

            const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
            log.warn(`Claude API errore (tentativo ${attempt}/${maxAttempts}): ${err.message}`);
            log.warn(`   Retry in ${delay / 1000}s...`);
            await sleep(delay);
        }
    }
}

/**
 * Determina se un errore è ritentabile
 */
function isRetryableError(err) {
    // Rate limit (429), server errors (5xx), timeout, network errors
    if (err.status === 429) return true;
    if (err.status >= 500) return true;
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') return true;
    if (err.message?.includes('overloaded')) return true;
    if (err.message?.includes('rate limit')) return true;
    return false;
}

/**
 * Parsing JSON robusto — gestisce output Claude imperfetti
 * 
 * Strategia:
 *   1. Parse diretto
 *   2. Strippa markdown fences
 *   3. Rimuovi commenti JS
 *   4. Fix virgole trailing
 *   5. Estrai primo oggetto/array con regex
 * 
 * @param {string} text - Testo da parsare
 * @returns {object|Array} JSON parsato
 * @throws {Error} Se nessuna strategia funziona
 */
export function parseClaudeJson(text) {
    // 1. Tenta parse diretto
    try {
        return JSON.parse(text);
    } catch { /* continua */ }

    // 2. Strippa markdown fences (```json ... ``` in qualsiasi posizione)
    let cleaned = text
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch { /* continua */ }

    // 3. Fix virgole trailing (es. [1, 2,] → [1, 2])
    let fixed = cleaned.replace(/,\s*([\]}])/g, '$1');

    try {
        return JSON.parse(fixed);
    } catch { /* continua */ }

    // 4. Estrai primo oggetto JSON bilanciato (gestisce nested objects)
    const extracted = extractBalancedJson(cleaned);
    if (extracted) {
        try {
            return JSON.parse(extracted);
        } catch { /* continua */ }

        // 4b. Prova con fix trailing commas sull'estratto
        const fixedExtracted = extracted.replace(/,\s*([\]}])/g, '$1');
        try {
            return JSON.parse(fixedExtracted);
        } catch { /* continua */ }
    }

    throw new Error(`Impossibile parsare JSON dalla risposta Claude: ${text.substring(0, 200)}...`);
}

/**
 * Estrae il primo oggetto JSON bilanciato da una stringa mixed
 * Tiene conto di stringhe (per non contare { e } dentro "...")
 */
function extractBalancedJson(text) {
    const start = text.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];

        if (escape) {
            escape = false;
            continue;
        }
        if (ch === '\\') {
            escape = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;

        if (ch === '{') depth++;
        if (ch === '}') depth--;
        if (depth === 0) {
            return text.substring(start, i + 1);
        }
    }
    return null;
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
