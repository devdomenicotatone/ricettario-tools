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
 * ⚠️ Se aggiungi un modello, mettilo qui: quelli non elencati ripiegano su
 * DEFAULT_MAX_TOKENS, che può essere molto più basso del loro tetto reale e
 * produce troncamenti silenziosi.
 *
 * Ref: https://platform.claude.com/docs/en/about-claude/models/overview
 */
const MODEL_MAX_TOKENS = {
    'claude-opus-4-6': 128000,
    'claude-sonnet-4-6': 128000,        // era 64000: metà del tetto reale del modello
    'claude-sonnet-4-5-20250929': 64000,
    'claude-sonnet-4-20250514': 64000,
};
const DEFAULT_MAX_TOKENS = 64000;  // Fallback prudente per modelli non in mappa

/**
 * Risposta arrivata incompleta o non utilizzabile.
 *
 * Non è un errore di rete: la chiamata è riuscita e l'abbiamo pagata, ma quello
 * che è tornato non si può usare. Rilanciare la stessa identica richiesta
 * produrrebbe lo stesso risultato, quindi `retryable` è false e il wrapper non
 * la ritenta.
 */
export class RispostaIncompletaError extends Error {
    constructor(messaggio, { motivo }) {
        super(messaggio);
        this.name = 'RispostaIncompletaError';
        this.motivo = motivo;   // 'max_tokens' | 'rifiuto' | 'contesto_esaurito' | 'nessun_testo' | ...
        this.retryable = false;
    }
}

/**
 * Chiama Claude API con retry automatico e exponential backoff
 *
 * @param {object} options
 * @param {string} options.model - Modello Claude (default: claude-sonnet-4-6)
 * @param {number} [options.maxTokens] - Max tokens risposta (default: max del modello)
 * @param {string} [options.system] - System prompt
 * @param {Array} options.messages - Array messaggi [{role, content}]
 * @param {object} [options.retry] - Config retry (maxAttempts, baseDelayMs)
 * @returns {Promise<string>} Testo della risposta
 */
export async function callClaude({
    model = 'claude-sonnet-4-6',
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
            // Ref: https://platform.claude.com/docs/en/build-with-claude/streaming
            const stream = client.messages.stream(params);
            const message = await stream.finalMessage();
            return testoDallaRisposta(message, { model, maxTokens: resolvedMaxTokens });
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
 * Estrae il testo da una risposta Claude, DOPO aver verificato che sia completa.
 *
 * `stop_reason` dice perché il modello ha smesso di scrivere. Non guardarlo
 * significa trattare come finita una risposta tagliata a metà: la chiamata
 * l'hai pagata per intero, quello che ne esce è parziale, e il danno si vede
 * molto più tardi — un array troncato diventa un oggetto solo, e il chiamante
 * conclude "nessun risultato" invece di "risposta incompleta".
 *
 * Ref: https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
 */
export function testoDallaRisposta(message, { model, maxTokens }) {
    const tetto = MODEL_MAX_TOKENS[model] || DEFAULT_MAX_TOKENS;

    if (message.stop_reason === 'max_tokens') {
        const generati = message.usage?.output_tokens ?? '?';
        const consiglio = maxTokens < tetto
            ? ` Rilancia con maxTokens più alto: ${model} arriva a ${tetto}.`
            : ` Sei già al tetto di ${model} (${tetto}): spezza la richiesta in parti più piccole.`;
        throw new RispostaIncompletaError(
            `Risposta troncata: esaurito il budget di ${maxTokens} token di output (${generati} generati). ` +
            `Il testo arrivato è incompleto e non va usato.${consiglio}`,
            { motivo: 'max_tokens' }
        );
    }

    if (message.stop_reason === 'model_context_window_exceeded') {
        throw new RispostaIncompletaError(
            'Finestra di contesto esaurita: è troppo grande quello che hai MANDATO, non quello che il ' +
            'modello ha scritto. Riduci il testo in ingresso o dividilo in blocchi.',
            { motivo: 'contesto_esaurito' }
        );
    }

    if (message.stop_reason === 'refusal') {
        // stop_details è popolato SOLO sui rifiuti, e `explanation` non è garantito.
        const dettagli = message.stop_details || {};
        const categoria = dettagli.category ? ` [${dettagli.category}]` : '';
        const spiegazione = dettagli.explanation ? ` ${dettagli.explanation}` : '';
        throw new RispostaIncompletaError(
            `Il modello ha rifiutato di rispondere${categoria}.${spiegazione}`,
            { motivo: 'rifiuto' }
        );
    }

    // I blocchi possono essere di tipi diversi (text, thinking, tool_use...) e
    // il testo può arrivare spezzato in più blocchi: prenderli tutti è più
    // corretto che dare per scontato che content[0] sia testo.
    const testo = (message.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();

    if (!testo) {
        const tipi = (message.content || []).map(b => b.type).join(', ') || 'nessuno';
        throw new RispostaIncompletaError(
            `Risposta senza testo (stop_reason: ${message.stop_reason}, blocchi ricevuti: ${tipi}).`,
            { motivo: 'nessun_testo' }
        );
    }

    return testo;
}

/**
 * Determina se un errore è ritentabile
 */
function isRetryableError(err) {
    // Le risposte incomplete si marcano da sole: rilanciare identico non aiuta.
    if (err.retryable === false) return false;
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

    // 1.5 Cerca esplicitamente blocchi markdown ```json ... ``` (ignora tutto il resto del testo)
    const blockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    let targetText = text;
    if (blockMatch && blockMatch[1]) {
        targetText = blockMatch[1];
        try {
            return JSON.parse(targetText.trim());
        } catch (e) { lastError = e; }
    }

    // 2. Strippa markdown fences rimanenti per le altre strategie
    let cleaned = targetText
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

    const inizio = cleaned.trimStart()[0];

    // 4. Estrai il primo valore JSON bilanciato (oggetto o array, gestisce nested)
    const extracted = extractBalancedJson(cleaned);

    // 4b. Ripiego: se la prima parentesi era solo prosa ("Ecco [la lista]: {...}"),
    // l'estratto non parsa. Riprova partendo dal primo oggetto vero.
    //
    // ⚠️ NON si applica quando il testo COMINCIA con "[": lì l'array è il valore
    // richiesto, e pescarne dentro il primo oggetto è esattamente il bug da
    // evitare — una ricetta consegnata al posto di N, senza nessun errore.
    const iOggetto = cleaned.indexOf('{');
    const daOggetto = (inizio !== '[' && iOggetto !== -1)
        ? extractBalancedJson(cleaned.slice(iOggetto))
        : null;

    for (const candidato of [extracted, daOggetto]) {
        if (!candidato) continue;
        try {
            return JSON.parse(candidato);
        } catch (e) { lastError = e; }

        // Stesso candidato, con le virgole finali ripulite
        try {
            return JSON.parse(candidato.replace(/,\s*([\]}])/g, '$1'));
        } catch (e) { lastError = e; }
    }

    // Debug: salva la risposta su file per analisi post-mortem
    try {
        writeFileSync('debug-failed-response.txt', text, 'utf-8');
        log.warn('Risposta Claude salvata in debug-failed-response.txt per diagnosi');
    } catch { /* ignore */ }

    // Se il testo COMINCIA come JSON ma non si chiude, il problema non è il
    // formato: è che la risposta è stata tagliata. Dirlo cambia la diagnosi.
    if ((inizio === '[' || inizio === '{') && extracted === null) {
        throw new RispostaIncompletaError(
            `Risposta troncata: comincia come JSON ma la parentesi "${inizio}" non si chiude mai ` +
            `(${text.length} caratteri ricevuti). Alza maxTokens o spezza la richiesta. ` +
            `Copia salvata in debug-failed-response.txt.`,
            { motivo: 'json_troncato' }
        );
    }

    const parseMsg = lastError ? ` (JSON.parse: ${lastError.message})` : '';
    throw new Error(`Impossibile parsare JSON dalla risposta Claude${parseMsg}: ${text.substring(0, 200)}...`);
}

/**
 * Estrae il primo valore JSON bilanciato (oggetto O array) da una stringa mista.
 * Tiene conto delle stringhe, per non contare parentesi dentro "...".
 *
 * ⚠️ Parte dalla PRIMA parentesi che incontra, `[` o `{` che sia. Prima cercava
 * solo `{`: da un array troncato — `[{...},{...},{..` — estraeva il primo
 * oggetto completo e lo restituiva senza un errore. Il chiamante riceveva UNA
 * ricetta invece di N, concludeva "nessuna ricetta trovata", marcava le pagine
 * come già lavorate, e le altre non erano più recuperabili.
 *
 * Se la parentesi non si chiude mai, restituisce null: il testo è troncato, e
 * meglio fallire che consegnare mezzo risultato.
 */
export function extractBalancedJson(text) {
    const iOggetto = text.indexOf('{');
    const iArray = text.indexOf('[');
    if (iOggetto === -1 && iArray === -1) return null;

    const start = iArray === -1 ? iOggetto
        : iOggetto === -1 ? iArray
            : Math.min(iOggetto, iArray);

    const apertura = text[start];
    const chiusura = apertura === '[' ? ']' : '}';

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

        if (ch === apertura) depth++;
        else if (ch === chiusura) {
            depth--;
            if (depth === 0) return text.substring(start, i + 1);
        }
    }
    return null;  // mai chiusa: risposta troncata
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

/** Ritorna la chiave API Gemini attiva (plaintext) utile per le chiamate REST dirette (come Imagen) */
export function getActiveGeminiKey() {
    return _activeGeminiSlot === 2 ? process.env.GEMINI_API_KEY2 : process.env.GEMINI_API_KEY;
}

/**
 * Catena di fallback modelli Gemini.
 * Quando un modello preview è sovraccarico (503), il sistema scala automaticamente
 * al modello stabile successivo nella catena.
 */
const GEMINI_MODEL_FALLBACK = {
    'gemini-3.1-pro-preview': 'gemini-2.5-pro',
    // Aggiungi qui futuri modelli preview → fallback stabile
};

/**
 * Estrae il testo da una risposta Gemini, DOPO aver verificato che sia completa.
 *
 * L'equivalente di `stop_reason` qui si chiama `finishReason`, e vale lo stesso
 * discorso: senza guardarlo, una risposta tagliata passa per buona.
 *
 * Con i modelli 2.5 e 3.x c'è una trappola in più: i token di ragionamento
 * interno attingono allo STESSO budget di `maxOutputTokens`. Il modello può
 * quindi consumare tutto il budget pensando e restituire una risposta vuota o
 * troncata, senza che nulla segnali un errore.
 */
export function testoDaRispostaGemini(response, { model, maxTokens }) {
    const bloccoPrompt = response.promptFeedback?.blockReason;
    if (bloccoPrompt) {
        throw new RispostaIncompletaError(
            `Gemini ha bloccato la richiesta prima ancora di rispondere (${bloccoPrompt}).`,
            { motivo: 'blocco_prompt' }
        );
    }

    const candidato = response.candidates?.[0];
    if (!candidato) {
        throw new RispostaIncompletaError(
            'Gemini non ha restituito nessun candidato di risposta.',
            { motivo: 'nessun_testo' }
        );
    }

    const finish = candidato.finishReason;

    if (finish === 'MAX_TOKENS') {
        const pensiero = response.usageMetadata?.thoughtsTokenCount;
        const dettaglio = pensiero
            ? ` Di quel budget, ${pensiero} token sono finiti in ragionamento interno: su ${model} il ` +
              `"pensiero" attinge allo stesso budget della risposta.`
            : '';
        throw new RispostaIncompletaError(
            `Risposta Gemini troncata: esaurito il budget di ${maxTokens} token di output.${dettaglio} ` +
            `Alza maxTokens o spezza la richiesta.`,
            { motivo: 'max_tokens' }
        );
    }

    if (finish && finish !== 'STOP') {
        const perche = candidato.finishMessage ? `: ${candidato.finishMessage}` : '';
        throw new RispostaIncompletaError(
            `Gemini ha interrotto la risposta (${finish}${perche}).`,
            { motivo: 'finish_reason' }
        );
    }

    const testo = response.text().trim();
    if (!testo) {
        throw new RispostaIncompletaError(
            `Gemini ha restituito una risposta vuota (finishReason: ${finish || 'assente'}).`,
            { motivo: 'nessun_testo' }
        );
    }

    return testo;
}

/**
 * Chiama Gemini API con retry automatico e model fallback intelligente
 *
 * Strategia resilienza (per errori 503/overloaded):
 *   1. Retry con exponential backoff (3 tentativi) sul modello richiesto
 *   2. Se fallisce, switcha API key e riprova (3 tentativi)
 *   3. Se fallisce ancora, fallback al modello stabile (es. gemini-2.5-pro)
 *
 * @param {object} options
 * @param {string} [options.model] - Modello Gemini (default: gemini-2.5-pro)
 * @param {number} [options.maxTokens] - Max tokens output (default: 8192)
 * @param {string} [options.system] - System instruction
 * @param {Array} options.messages - Array messaggi [{role: 'user'|'model', content: string}]
 * @param {object} [options.retry] - Config retry
 * @param {boolean} [options._isFallback] - Interno: true se è già un tentativo di fallback
 * @returns {Promise<string>} Testo della risposta
 */
export async function callGemini({
    model = 'gemini-2.5-pro',
    maxTokens = 8192,
    system,
    messages,
    retry = DEFAULT_RETRY,
    _isFallback = false,
}) {
    const { maxAttempts, baseDelayMs, maxDelayMs } = { ...DEFAULT_RETRY, ...retry };

    /** Esegue i tentativi di retry sul modello corrente */
    async function tryWithRetries(activeModel) {
        const client = getGeminiClient();
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const genModel = client.getGenerativeModel({
                    model: activeModel,
                    ...(system ? { systemInstruction: system } : {}),
                    generationConfig: { maxOutputTokens: maxTokens },
                });

                // Converti messaggi nel formato Gemini
                const history = messages.slice(0, -1).map(m => ({
                    role: m.role === 'assistant' ? 'model' : m.role,
                    parts: m.parts || [{ text: m.content }],
                }));

                const lastMessage = messages[messages.length - 1];
                const contentOrParts = lastMessage.parts || lastMessage.content;

                const result = history.length > 0
                    ? await genModel.startChat({ history }).sendMessage(contentOrParts)
                    : await genModel.generateContent(contentOrParts);

                return testoDaRispostaGemini(result.response, { model: activeModel, maxTokens });
            } catch (err) {
                const isLast = attempt === maxAttempts;
                // Le risposte incomplete si marcano da sole (retryable: false):
                // rilanciare identico produrrebbe lo stesso troncamento.
                const retryable = err.retryable !== false && (
                    err.status === 429 || err.status >= 500 ||
                    err.message?.includes('overloaded') || err.message?.includes('rate') ||
                    err.message?.includes('Service Unavailable'));

                if (isLast || !retryable) {
                    err._isServiceUnavailable = err.status === 503 ||
                        err.message?.includes('503') || err.message?.includes('Service Unavailable');
                    throw err;
                }

                const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
                log.warn(`Gemini API errore (tentativo ${attempt}/${maxAttempts}): ${err.message}`);
                log.warn(`   Retry in ${delay / 1000}s...`);
                await sleep(delay);
            }
        }
    }

    // ── Fase 1: Prova con il modello richiesto ──
    try {
        return await tryWithRetries(model);
    } catch (primaryErr) {
        // Se non è un errore di sovraccarico, o è già un fallback, rilancia
        if (!primaryErr._isServiceUnavailable || _isFallback) {
            log.error(`Gemini API fallita dopo ${maxAttempts} tentativi: ${primaryErr.message}`);
            throw primaryErr;
        }

        // ── Fase 2: Switcha API key e riprova stesso modello ──
        const originalSlot = _activeGeminiSlot;
        const otherSlot = originalSlot === 1 ? 2 : 1;
        const otherKey = otherSlot === 2 ? process.env.GEMINI_API_KEY2 : process.env.GEMINI_API_KEY;

        if (otherKey) {
            switchGeminiKey(otherSlot);
            try {
                return await tryWithRetries(model);
            } catch (keyErr) {
                if (!keyErr._isServiceUnavailable) throw keyErr;
                log.warn(`Modello ${model} sovraccarico anche con chiave slot ${otherSlot}`);
            }
        }

        // ── Fase 3: Fallback a modello stabile ──
        const fallbackModel = GEMINI_MODEL_FALLBACK[model];
        if (fallbackModel) {
            // Ripristina la chiave originale per il fallback
            if (_activeGeminiSlot !== originalSlot) switchGeminiKey(originalSlot);
            log.warn(`⚡ Modello ${model} non disponibile — fallback automatico a ${fallbackModel}`);
            return callGemini({
                model: fallbackModel,
                maxTokens,
                system,
                messages,
                retry,
                _isFallback: true,
            });
        }

        // Nessun fallback disponibile
        log.error(`Gemini API fallita: modello ${model} sovraccarico, nessun fallback disponibile`);
        throw primaryErr;
    }
}

