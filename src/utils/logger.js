/**
 * LOGGER — Logging strutturato per la CLI
 * 
 * Livelli: debug, info, success, warn, error
 * Flag: --verbose (mostra debug), --quiet (solo errori)
 */

// Detecta flags dalla CLI
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose') || args.includes('-v');
const QUIET = args.includes('--quiet') || args.includes('-q');

const LEVELS = {
    debug: { emoji: '🔍', color: '\x1b[90m' },   // grigio
    info: { emoji: 'ℹ️ ', color: '\x1b[36m' },   // cyan
    success: { emoji: '✅', color: '\x1b[32m' },   // verde
    warn: { emoji: '⚠️ ', color: '\x1b[33m' },   // giallo
    error: { emoji: '❌', color: '\x1b[31m' },   // rosso
};

const RESET = '\x1b[0m';

function formatMsg(level, msg) {
    const { emoji } = LEVELS[level];
    return `${emoji} ${msg}`;
}

export const log = {
    /**
     * Debug — visibile solo con --verbose
     */
    debug(msg) {
        if (VERBOSE) console.log(formatMsg('debug', msg));
    },

    /**
     * Info — nascosto con --quiet
     */
    info(msg) {
        if (!QUIET) console.log(formatMsg('info', msg));
    },

    /**
     * Success — nascosto con --quiet
     */
    success(msg) {
        if (!QUIET) console.log(formatMsg('success', msg));
    },

    /**
     * Warning — sempre visibile
     */
    warn(msg) {
        console.warn(formatMsg('warn', msg));
    },

    /**
     * Error — sempre visibile
     */
    error(msg) {
        console.error(formatMsg('error', msg));
    },

    /**
     * Header sezione — nascosto con --quiet
     */
    header(title) {
        if (QUIET) return;
        console.log(`\n${'═'.repeat(50)}`);
        console.log(`   ${title}`);
        console.log(`${'═'.repeat(50)}\n`);
    },

    /**
     * Separatore — nascosto con --quiet
     */
    separator() {
        if (!QUIET) console.log(`${'─'.repeat(50)}`);
    },

    /**
     * Step inline (sovrascrive riga corrente) — nascosto con --quiet
     */
    step(msg) {
        if (!QUIET) process.stdout.write(`   ${msg}`);
    },

    /**
     * Stato attuale dei flag
     */
    isVerbose: VERBOSE,
    isQuiet: QUIET,
};
