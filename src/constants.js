/**
 * COSTANTI UNIVERSALI — Il Ricettario
 * Singolo punto di verità per le impostazioni globali dell'app backend e dei generatori AI.
 *
 * ⚠️ Le categorie NON sono definite qui. La fonte unica è il registry del sito,
 * `Ricettario/js/categories.js`: questo file lo legge e ne deriva le forme che il
 * backend e i prompt AI usano da sempre (stessi nomi di export, stessa struttura).
 *
 * Perché: qui esisteva una seconda copia dell'elenco, ed è divergita in silenzio.
 * "Pasta" è rimasta qui per mesi dopo che il sito l'aveva rinominata "Primi", quindi
 * le ricette finivano in `ricette/pasta/` — una cartella non dichiarata nel registry —
 * e il `npm run check` del sito si fermava, bloccando la pubblicazione.
 */

import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Trova `js/categories.js` nel repo del sito.
 * Stessa convenzione del resto del progetto (RICETTARIO_PATH, poi `../Ricettario`),
 * più un ultimo tentativo relativo a questo file: così il modulo funziona anche se
 * il processo viene avviato da una cartella diversa da `tools/`.
 */
let baseRicettario = null;

function trovaRegistryCategorie() {
    const candidati = [
        process.env.RICETTARIO_PATH && resolve(process.cwd(), process.env.RICETTARIO_PATH),
        resolve(process.cwd(), '../Ricettario'),
        resolve(__dirname, '..', '..', 'Ricettario'),
    ].filter(Boolean);

    for (const base of candidati) {
        const file = resolve(base, 'js', 'categories.js');
        if (existsSync(file)) { baseRicettario = base; return file; }
    }

    throw new Error(
        'Registry delle categorie non trovato: cercato js/categories.js in\n  ' +
        candidati.join('\n  ') +
        '\nImposta RICETTARIO_PATH nel .env con il percorso del repo del sito.'
    );
}

const { CATEGORIES, CATEGORY_ORDER } = await import(pathToFileURL(trovaRegistryCategorie()).href);

// La radice del repo del sito, trovata risalendo dal registry qui sopra: chi
// deve leggere i JSON delle ricette (es. sensory.js per gli assi di famiglia)
// la prende da qui invece di rifare la stessa ricerca per conto suo.
export const RICETTARIO_DIR = baseRicettario;

// Chiavi nell'ordine della homepage; eventuali categorie non elencate finiscono in coda.
const CHIAVI = [
    ...CATEGORY_ORDER.filter(k => CATEGORIES[k]),
    ...Object.keys(CATEGORIES).filter(k => !CATEGORY_ORDER.includes(k)),
];

// Lista ordinata delle categorie riconosciute
export const ALL_CATEGORIES = CHIAVI.map(k => CATEGORIES[k].name);

// Mapping per ottenere l'ID (cartella) dalla Label (Categoria Utente).
// Attenzione: la cartella è `dir`, non la chiave — `secondi_piatti` sta in `secondi-piatti/`.
export const CATEGORY_FOLDERS = Object.fromEntries(
    CHIAVI.map(k => [CATEGORIES[k].name, CATEGORIES[k].dir])
);

// Dati estesi delle categorie (Usato in sync-cards, UI index dashboard, ecc).
// `emoji` qui è l'emoji unicode (quella che finisce in recipes.json), non lo slug Fluent.
export const CATEGORIES_DATA = Object.fromEntries(
    CHIAVI.map((k, i) => [k, {
        emoji: CATEGORIES[k].unicode,
        label: CATEGORIES[k].name,
        order: i + 1,
    }])
);

// Costruisce la Regex (es. Pane|Lievitati|Primi...) per prompt AI e validatori
export const CATEGORY_REGEX_PATTERN = ALL_CATEGORIES.join('|');
