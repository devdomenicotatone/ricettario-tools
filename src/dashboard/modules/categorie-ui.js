/**
 * CATEGORIE UI — riempie menu a tendina e tab SEO dal registry del sito.
 *
 * Le opzioni erano scritte a mano dentro index.html, quindi mostravano "Pasta"
 * (categoria che sul sito non esiste più) e non mostravano "Primi": una ricetta
 * generata da lì finiva in `ricette/pasta/`, cartella non dichiarata nel registry,
 * e il `npm run check` del sito si fermava bloccando la pubblicazione.
 *
 * La fonte è `js/categories.js` del sito, che il server espone su /shared.
 */

import { CATEGORIES, CATEGORY_ORDER } from '/shared/categories.js';

const CHIAVI = [
    ...CATEGORY_ORDER.filter(k => CATEGORIES[k]),
    ...Object.keys(CATEGORIES).filter(k => !CATEGORY_ORDER.includes(k)),
];

// I tre form di creazione: "Da Nome", "Da URL", "Da Testo".
const SELECT_CATEGORIA = ['gen-tipo', 'url-tipo', 'testo-tipo'];

export function initCategorieUI() {
    for (const id of SELECT_CATEGORIA) {
        const select = document.getElementById(id);
        if (!select) continue;

        const scelta = select.value;
        select.replaceChildren();

        const auto = document.createElement('option');
        auto.value = '';
        auto.textContent = 'Auto-detect';
        select.appendChild(auto);

        for (const chiave of CHIAVI) {
            const cat = CATEGORIES[chiave];
            const opt = document.createElement('option');
            opt.value = cat.name;
            opt.textContent = `${cat.unicode} ${cat.name}`;
            select.appendChild(opt);
        }

        // Ripristina la scelta precedente se esiste ancora fra le categorie.
        if (scelta) select.value = scelta;
    }

    const tabs = document.getElementById('seoTabs');
    if (tabs) {
        tabs.replaceChildren();
        CHIAVI.forEach((chiave, i) => {
            const cat = CATEGORIES[chiave];
            const btn = document.createElement('button');
            btn.className = i === 0 ? 'seo-tab active' : 'seo-tab';
            btn.dataset.category = cat.name;
            btn.textContent = `${cat.unicode} ${cat.name}`;
            tabs.appendChild(btn);
        });
    }
}
