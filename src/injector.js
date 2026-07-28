/**
 * INJECTOR — Aggiorna recipes.json con la nuova ricetta.
 * Il rendering sulla homepage è ora completamente dinamico (JSON → JS).
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { CATEGORIES_DATA } from './constants.js';
import { conLockFile, leggiJson, scriviJsonAtomico } from './server/routes/_helpers.js';
import { cartellaCategoria, etichetteAmmesse } from './utils/percorsi-ricette.js';

/** Forma di un indice vuoto: serve sia quando il file manca sia quando è corrotto. */
function indiceVuoto() {
    return { totalRecipes: 0, categories: [], recipes: [] };
}

/**
 * Riporta alla forma canonica `{totalRecipes, categories, recipes}`
 * qualunque cosa sia stata letta dal disco.
 *
 * Il caso che conta è la forma ARRAY: `server/routes/recipes.js` la dichiara
 * possibile e in lettura la gestisce (`Array.isArray(data) ? data : data.recipes`),
 * quindi un indice così può davvero esistere. Uno spread diretto
 * `{ ...indiceVuoto(), ...letto }` la trasformerebbe in
 * `{ "0": {...}, "1": {...}, recipes: [] }`: la guardia su `recipes` azzererebbe
 * la lista e il file verrebbe riscritto con UNA sola ricetta, in silenzio.
 * Qui l'array diventa invece la lista delle ricette, e non si perde niente.
 *
 * @param {unknown} letto - il contenuto interpretato del file, o null
 * @returns {{totalRecipes: number, categories: object[], recipes: object[]}}
 */
function normalizzaIndice(letto) {
    if (Array.isArray(letto)) return { ...indiceVuoto(), recipes: letto };
    if (!letto || typeof letto !== 'object') return indiceVuoto();
    const data = { ...indiceVuoto(), ...letto };
    // Un indice troncato o manomesso può avere `recipes` non array: senza
    // questo controllo il `.some` di `injectCard` esploderebbe dentro il lock.
    if (!Array.isArray(data.recipes)) data.recipes = [];
    // Il timestamp è stato tolto dall'indice (era un diff perpetuo su git):
    // un file vecchio che lo porta ancora va ripulito, o lo spread qui sopra
    // se lo trascinerebbe dietro per sempre.
    delete data.generatedAt;
    return data;
}

/**
 * Aggiunge la ricetta al file recipes.json.
 * Se già presente (per slug), skip. Altrimenti la inserisce nella categoria
 * corretta, con etichetta e cartella riportate entrambe alla forma del registry.
 *
 * È `async` perché legge-e-riscrive `public/recipes.json` dentro `conLockFile`,
 * lo STESSO lock che usa `commands/sync-cards.js`: senza, nello stesso processo
 * due percorsi scriverebbero quel file — uno sotto lock e uno no — e il lock non
 * proteggerebbe niente. **I chiamanti devono attenderla** (`await injectCard(...)`),
 * altrimenti un errore diventa una promise rifiutata che il loro try/catch
 * sincrono non vede.
 *
 * @param {object} recipe
 * @param {string} ricettarioPath - radice del repo del sito
 * @returns {Promise<void>}
 * @throws {Error} se la categoria non è dichiarata in js/categories.js del sito
 */
export async function injectCard(recipe, ricettarioPath) {
    const jsonPath = resolve(ricettarioPath, 'public', 'recipes.json');

    // La scrittura atomica crea le cartelle mancanti (`mkdirSync` con
    // `recursive`). Comodo in generale, pericoloso qui: con un
    // `ricettarioPath` sbagliato (RICETTARIO_PATH mal configurato, un refuso in
    // `--output`) prima usciva un ENOENT che il chiamante segnalava, adesso
    // nascerebbe un `public/recipes.json` fantasma con una ricetta sola, e
    // l'indice vero resterebbe indietro senza che nessuno se ne accorga.
    // Meglio fermarsi: la radice del sito deve esistere già.
    if (!existsSync(resolve(ricettarioPath, 'public'))) {
        throw new Error(
            `La cartella public/ del sito non esiste in "${ricettarioPath}": ` +
            'controlla RICETTARIO_PATH (o --output). Non creo un indice nuovo ' +
            'altrove, perché resterebbe invisibile.'
        );
    }

    const r = recipe;
    const slug = r.slug || r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const category = r.category || 'Pane';
    // Niente ripiego `toLowerCase()`: era proprio il meccanismo che inventava
    // cartelle come `ricette/pasta/` (o `ricette/secondi piatti/`, con lo spazio)
    // e faceva fallire `npm run check` del sito, bloccando ogni pubblicazione.
    // `cartellaCategoria` lancia con un messaggio che elenca le categorie attese:
    // un errore in dashboard si legge subito, una cartella sbagliata si scopre
    // giorni dopo. La risoluzione sta PRIMA del lock: se la categoria non esiste
    // non c'è motivo di mettersi in coda sul file.
    const dir = cartellaCategoria(category);
    // Anche l'ETICHETTA va riportata a quella del registry, per lo stesso motivo
    // per cui ci va la cartella: `cartellaCategoria` accetta pure la forma
    // cartella (`--tipo primi`, che publisher.js passa come `recipe.category`),
    // quindi senza questo passaggio l'indice si ritroverebbe `category: "primi"`
    // accanto alle voci `"Primi"` scritte dal generatore del sito
    // (`scripts/build-recipes.js` usa `cat.name`): due voci per la stessa
    // categoria nel conteggio della homepage, la seconda con emoji vuota perché
    // `emojiMap` qui sotto è indicizzata per etichetta. L'elenco arriva dal
    // registry, non da una mappa locale: `dir` viene dal registry, quindi
    // l'etichetta corrispondente esiste sempre.
    const etichetta = etichetteAmmesse().find(e => cartellaCategoria(e) === dir) || category;

    // Trova hydration/time/temp dalle proprietà della ricetta
    const hydration = r.hydration ? `${r.hydration}%` : null;
    const time = r.fermentation || null;
    const temp = r.targetTemp || null;

    // Immagine
    let image = '';
    if (r.image) {
        image = r.image;
    } else if (r.slug) {
        image = `images/ricette/${dir}/${slug}.webp`;
    }

    // Normalizza path immagine
    image = image.replace(/^\.\.\/\.\.\//g, '');

    const newEntry = {
        title: r.title,
        slug,
        category: etichetta,
        categoryDir: dir,
        emoji: r.emoji || '🍝',
        href: `ricette/${dir}/${slug}.html`,
        image,
        description: (r.description || '').substring(0, 120),
        hydration,
        time,
        temp,
        tool: '',
        _createdAt: r._createdAt || new Date().toISOString(),
    };

    // Lettura, controllo duplicati e riscrittura sono un'unica sezione critica:
    // spezzarla lascerebbe passare due inserimenti che si leggono lo stesso
    // indice e si sovrascrivono a vicenda. La chiave è il percorso del file
    // prodotto, la stessa di `syncCards`.
    await conLockFile(jsonPath, () => {
        const letto = leggiJson(jsonPath, null);
        if (Array.isArray(letto)) {
            console.log(`ℹ️  recipes.json era in forma array (${letto.length} voci): lo riporto alla forma { recipes: [...] }.`);
        } else if ((letto === null || typeof letto !== 'object') && existsSync(jsonPath)) {
            console.log('⚠️  recipes.json corrotto, lo ricreo.');
        }
        const data = normalizzaIndice(letto);

        // Verifica duplicati
        if (data.recipes.some(existing => existing.slug === slug)) {
            console.log(`ℹ️  Card già presente in recipes.json, skip inserimento.`);
            return;
        }

        data.recipes.push(newEntry);
        data.totalRecipes = data.recipes.length;

        // Ricalcola categorie
        const stats = {};
        const emojiMap = Object.fromEntries(
            Object.values(CATEGORIES_DATA).map(c => [c.label, c.emoji])
        );
        data.recipes.forEach(rec => {
            stats[rec.category] = (stats[rec.category] || 0) + 1;
        });
        data.categories = Object.entries(stats).map(([name, count]) => ({
            name, count, emoji: emojiMap[name] || '',
        }));

        // Scrittura atomica (tmp + rename): un'interruzione a metà non lascia
        // l'indice della homepage troncato.
        scriviJsonAtomico(jsonPath, data);
        console.log(`✅ Ricetta aggiunta a recipes.json (${data.totalRecipes} totali)`);
    });
}
