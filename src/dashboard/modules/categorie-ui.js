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

// I tre form di creazione: "Da Nome", "Da URL", "Da Testo".
const SELECT_CATEGORIA = ['gen-tipo', 'url-tipo', 'testo-tipo'];

function chiaviOrdinate(categorie, ordine) {
    return [
        ...ordine.filter(k => categorie[k]),
        ...Object.keys(categorie).filter(k => !ordine.includes(k)),
    ];
}

function applicaRegistry(categorie, ordine) {
    const CHIAVI = chiaviOrdinate(categorie, ordine);

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
            const cat = categorie[chiave];
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
        // In un refresh la tab attiva va conservata: azzerarla mentre l'utente
        // guarda i suggerimenti di una categoria gli cambierebbe pagina da solo.
        const attiva = tabs.querySelector('.seo-tab.active')?.dataset.category;
        tabs.replaceChildren();
        CHIAVI.forEach((chiave, i) => {
            const cat = categorie[chiave];
            const btn = document.createElement('button');
            const isActive = attiva ? cat.name === attiva : i === 0;
            btn.className = isActive ? 'seo-tab active' : 'seo-tab';
            btn.dataset.category = cat.name;
            btn.textContent = `${cat.unicode} ${cat.name}`;
            tabs.appendChild(btn);
        });
        if (!tabs.querySelector('.seo-tab.active') && tabs.firstElementChild) {
            tabs.firstElementChild.classList.add('active');
        }
    }
}

export function initCategorieUI() {
    applicaRegistry(CATEGORIES, CATEGORY_ORDER);
}

/**
 * Rilegge il registry dal disco e riallinea tendine e tab SEO senza ricaricare
 * la pagina. Serve dopo /api/aggiungi-categoria: l'import statico qui sopra
 * resta congelato alla versione caricata al boot, il cache-buster nell'URL
 * costringe il browser a richiedere il file appena riscritto dal server.
 * Ritorna il modulo fresco (o null), così chi chiama può riallineare anche le
 * proprie mappe (vedi syncRegistroCategorie in recipe-list.js).
 */
export async function refreshCategorieUI() {
    try {
        const mod = await import(`/shared/categories.js?v=${Date.now()}`);
        applicaRegistry(mod.CATEGORIES, mod.CATEGORY_ORDER);
        return mod;
    } catch (err) {
        console.warn('refreshCategorieUI: registry non ricaricabile:', err);
        return null;
    }
}
