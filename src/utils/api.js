/**
 * API UTILS — Wrapper Claude API con retry e parsing robusto
 * 
 * Features:
 *   - Retry con exponential backoff (3 tentativi)
 *   - Parsing JSON tollerante (strippa fences, trailing commas, balanced extract)
 *   - Auto-configurazione max_tokens per modello (nessun hardcoding necessario)
 *   - Funzione unificata callClaude() per tutti i moduli
 */

import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'fs';
import { log } from './logger.js';

const client = new Anthropic();

const DEFAULT_RETRY = {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
};

/**
 * Massimo output tokens per modello Claude.
 * Quando maxTokens non è specificato dal chiamante, si usa il max del modello.
 * Non ha impatto sui costi: Anthropic fattura solo i token effettivamente generati.
 * 
 * Ref: https://docs.anthropic.com/en/docs/about-claude/models
 */
const MODEL_MAX_TOKENS = {
    // Claude 4.6
    'claude-opus-4-6-20260201': 128000,
    'claude-sonnet-4-6-20260220': 64000,
    // Claude 4.5
    'claude-opus-4-5-20250918': 64000,
    'claude-sonnet-4-5-20250929': 64000,
    // Claude 4
    'claude-sonnet-4-20250514': 64000,
    'claude-opus-4-20250514': 64000,
    // Alias latest
    'claude-sonnet-4-5-latest': 64000,
    'claude-opus-4-5-latest': 64000,
};
const DEFAULT_MAX_TOKENS = 64000;  // Safe fallback per modelli non in mappa

/**
 * Chiama Claude API con retry automatico e exponential backoff
 *
 * @param {object} options
 * @param {string} options.model - Modello Claude (default: claude-sonnet-4-5-20250929)
 * @param {number} [options.maxTokens] - Max tokens risposta (default: max del modello)
 * @param {string} [options.system] - System prompt
 * @param {Array} options.messages - Array messaggi [{role, content}]
 * @param {object} [options.retry] - Config retry (maxAttempts, baseDelayMs)
 * @returns {Promise<string>} Testo della risposta
 */
export async function callClaude({
    model = 'claude-sonnet-4-5-20250929',
    maxTokens,
    system,
    messages,
    retry = DEFAULT_RETRY,
}) {
    // Auto-configura maxTokens dal modello se non specificato
    const resolvedMaxTokens = maxTokens || MODEL_MAX_TOKENS[model] || DEFAULT_MAX_TOKENS;
    const { maxAttempts, baseDelayMs, maxDelayMs } = { ...DEFAULT_RETRY, ...retry };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const params = { model, max_tokens: resolvedMaxTokens, messages };
            if (system) params.system = system;

            // Usa streaming + finalMessage() per evitare timeout HTTP con max_tokens alti
            // Ref: https://docs.anthropic.com/en/api/messages-streaming
            const stream = client.messages.stream(params);
            const message = await stream.finalMessage();
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
    let lastError = null;

    // 1. Tenta parse diretto
    try {
        return JSON.parse(text);
    } catch (e) { lastError = e; }

    // 2. Strippa markdown fences (```json ... ``` in qualsiasi posizione)
    let cleaned = text
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch (e) { lastError = e; }

    // 3. Fix virgole trailing (es. [1, 2,] → [1, 2])
    let fixed = cleaned.replace(/,\s*([\]}])/g, '$1');

    try {
        return JSON.parse(fixed);
    } catch (e) { lastError = e; }

    // 4. Estrai primo oggetto JSON bilanciato (gestisce nested objects)
    const extracted = extractBalancedJson(cleaned);
    if (extracted) {
        try {
            return JSON.parse(extracted);
        } catch (e) { lastError = e; }

        // 4b. Prova con fix trailing commas sull'estratto
        const fixedExtracted = extracted.replace(/,\s*([\]}])/g, '$1');
        try {
            return JSON.parse(fixedExtracted);
        } catch (e) { lastError = e; }
    }

    // Debug: salva la risposta su file per analisi post-mortem
    try {
        writeFileSync('debug-failed-response.txt', text, 'utf-8');
        log.warn('Risposta Claude salvata in debug-failed-response.txt per diagnosi');
    } catch { /* ignore */ }

    const parseMsg = lastError ? ` (JSON.parse: ${lastError.message})` : '';
    throw new Error(`Impossibile parsare JSON dalla risposta Claude${parseMsg}: ${text.substring(0, 200)}...`);
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

// ═══════════════════════════════════════════════════════════
// GEMINI API — Challenger / Reviewer
// ═══════════════════════════════════════════════════════════

import { GoogleGenerativeAI } from '@google/generative-ai';

let _geminiClient = null;
let _activeGeminiSlot = 1; // 1 = GEMINI_API_KEY, 2 = GEMINI_API_KEY2

function getGeminiClient() {
    if (!_geminiClient) {
        const key = _activeGeminiSlot === 2
            ? process.env.GEMINI_API_KEY2
            : process.env.GEMINI_API_KEY;
        if (!key) throw new Error(`GEMINI_API_KEY${_activeGeminiSlot === 2 ? '2' : ''} non configurata nel .env`);
        _geminiClient = new GoogleGenerativeAI(key);
    }
    return _geminiClient;
}

/** Resetta il client Gemini (forza ricreazione al prossimo uso) */
export function resetGeminiClient() {
    _geminiClient = null;
}

/** Cambia la chiave Gemini attiva (1 o 2) */
export function switchGeminiKey(slot) {
    if (slot !== 1 && slot !== 2) throw new Error('Slot deve essere 1 o 2');
    _activeGeminiSlot = slot;
    _geminiClient = null; // forza ricreazione
    log.info(`🔑 Gemini API Key switchata a slot ${slot}`);
}

/** Ritorna lo slot attivo (1 o 2) */
export function getActiveGeminiSlot() {
    return _activeGeminiSlot;
}

/**
 * Chiama Gemini API con retry automatico
 *
 * @param {object} options
 * @param {string} [options.model] - Modello Gemini (default: gemini-2.5-pro)
 * @param {number} [options.maxTokens] - Max tokens output (default: 8192)
 * @param {string} [options.system] - System instruction
 * @param {Array} options.messages - Array messaggi [{role: 'user'|'model', content: string}]
 * @param {object} [options.retry] - Config retry
 * @returns {Promise<string>} Testo della risposta
 */
export async function callGemini({
    model = 'gemini-2.5-pro',
    maxTokens = 8192,
    system,
    messages,
    retry = DEFAULT_RETRY,
}) {
    const { maxAttempts, baseDelayMs, maxDelayMs } = { ...DEFAULT_RETRY, ...retry };
    const client = getGeminiClient();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const genModel = client.getGenerativeModel({
                model,
                ...(system ? { systemInstruction: system } : {}),
                generationConfig: { maxOutputTokens: maxTokens },
            });

            // Converti messaggi nel formato Gemini
            const history = messages.slice(0, -1).map(m => ({
                role: m.role === 'assistant' ? 'model' : m.role,
                parts: [{ text: m.content }],
            }));

            const lastMessage = messages[messages.length - 1];

            if (history.length > 0) {
                const chat = genModel.startChat({ history });
                const result = await chat.sendMessage(lastMessage.content);
                return result.response.text().trim();
            } else {
                const result = await genModel.generateContent(lastMessage.content);
                return result.response.text().trim();
            }
        } catch (err) {
            const isLast = attempt === maxAttempts;
            const retryable = err.status === 429 || err.status >= 500 ||
                err.message?.includes('overloaded') || err.message?.includes('rate');

            if (isLast || !retryable) {
                log.error(`Gemini API fallita dopo ${attempt} tentativ${attempt === 1 ? 'o' : 'i'}: ${err.message}`);
                throw err;
            }

            const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
            log.warn(`Gemini API errore (tentativo ${attempt}/${maxAttempts}): ${err.message}`);
            log.warn(`   Retry in ${delay / 1000}s...`);
            await sleep(delay);
        }
    }
}

