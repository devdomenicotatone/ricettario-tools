/**
 * COSTANTI UNIVERSALI — Il Ricettario
 * Singolo punto di verità per le impostazioni globali dell'app backend e dei generatori AI.
 */

// Lista ordinata delle categorie riconosciute
export const ALL_CATEGORIES = [
    'Pane', 
    'Pizza', 
    'Focaccia', 
    'Pasta', 
    'Lievitati', 
    'Dolci', 
    'Conserve', 
    'Condimenti',
    'Secondi Piatti'
];

// Mapping per ottenere l'ID (cartella) dalla Label (Categoria Utente)
export const CATEGORY_FOLDERS = {
    'Pane': 'pane',
    'Pizza': 'pizza',
    'Focaccia': 'focaccia',
    'Pasta': 'pasta',
    'Lievitati': 'lievitati',
    'Dolci': 'dolci',
    'Conserve': 'conserve',
    'Condimenti': 'condimenti',
    'Secondi Piatti': 'secondi-piatti'
};

// Dati estesi delle categorie (Usato in sync-cards, UI index dashboard, ecc)
export const CATEGORIES_DATA = {
    pasta: { emoji: '🍝', label: 'Pasta', order: 1 },
    pane: { emoji: '🥖', label: 'Pane', order: 2 },
    pizza: { emoji: '🍕', label: 'Pizza', order: 3 },
    lievitati: { emoji: '🥐', label: 'Lievitati', order: 4 },
    focaccia: { emoji: '🫓', label: 'Focaccia', order: 5 },
    dolci: { emoji: '🍪', label: 'Dolci', order: 6 },
    conserve: { emoji: '🫙', label: 'Conserve', order: 7 },
    condimenti: { emoji: '🌿', label: 'Condimenti', order: 8 },
    secondi_piatti: { emoji: '🍲', label: 'Secondi Piatti', order: 9 },
};

// Costruisce la Regex (es. Pane|Lievitati|Pasta...) per prompt AI e validatori
export const CATEGORY_REGEX_PATTERN = ALL_CATEGORIES.join('|');
