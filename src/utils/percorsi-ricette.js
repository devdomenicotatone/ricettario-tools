/**
 * PERCORSI-RICETTE — Dove sta sul disco una ricetta, e come si chiama.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  PERCHÉ QUESTO MODULO ESISTE
 * ══════════════════════════════════════════════════════════════════════
 *
 * Perché una cartella inventata blocca la pubblicazione del sito.
 *
 * Il sito genera il suo indice con `scripts/build-recipes.js`, che alla fine
 * confronta le cartelle presenti sotto `ricette/` con quelle dichiarate in
 * `js/categories.js` e, se ne trova una non dichiarata, si ferma con un errore
 * (`ricette/<x>/ non è dichiarata in js/categories.js`). `npm run check` del
 * sito include quel passaggio, e `npm run deploy` è preceduto da `npm run
 * check` con `&&`: una singola cartella sbagliata scritta dalla dashboard non
 * rompe "una ricetta", ferma OGNI pubblicazione finché qualcuno non la trova a
 * mano.
 *
 * È già successo: `constants.js` conosceva ancora "Pasta" dopo che il sito
 * l'aveva rinominata "Primi", le ricette finivano in `ricette/pasta/` e il
 * cancello del sito si bloccava. La cura è stata far leggere le categorie dal
 * registry del sito — ma il RIPIEGO è rimasto sparso ovunque nella forma
 * `CATEGORY_FOLDERS[x] || x.toLowerCase()`, che è esattamente il modo di
 * inventarsi `ricette/pasta/` una seconda volta: se la categoria non è nel
 * registry, quella riga non si ferma, tira a indovinare una cartella e ci
 * scrive dentro.
 *
 * Al momento in cui questo file è stato scritto la stessa domanda aveva NOVE
 * risposte diverse (`injector.js:37`, `publisher.js:37`, `image-finder.js:1026`,
 * `categories.js:220-221`, `categories.js:560/575`, `image.js:132`,
 * `recipes.js:54`) e TRE comportamenti diversi: `toLowerCase()` secco (che per
 * "Secondi Piatti" dà `secondi piatti`, con lo spazio), `toLowerCase()` con gli
 * spazi trasformati in trattini, e il confronto col registry. La regola dello
 * slug era copiata carattere per carattere in due rotte, e la domanda "questo
 * .json è una ricetta o un file di lavoro?" aveva QUATTRO regex diverse.
 *
 * Qui c'è una risposta sola, e quando la categoria non esiste **lancia**
 * invece di inventare: un errore in dashboard si legge subito, una cartella
 * sbagliata si scopre giorni dopo, al primo deploy che non parte.
 *
 * ── Fonti di verità a cui questo modulo si appoggia (non copiarle) ──
 *   • categorie → `Ricettario/js/categories.js`, letto da `src/constants.js`
 *     (`CATEGORY_FOLDERS`: etichetta → cartella, `dir` e non la chiave).
 *   • file di lavoro → `Ricettario/scripts/build-recipes.js:23`, che decide
 *     cosa finisce online (vedi `eFileDiLavoro`).
 */

import { resolve, sep } from 'path';
import { CATEGORY_FOLDERS } from '../constants.js';

// ══════════════════════════════════════════════════════════
//  SLUG
// ══════════════════════════════════════════════════════════

/**
 * Forma di uno slug di ricetta: kebab-case stretto.
 * Niente punti, niente barre, niente `..`, niente maiuscole.
 *
 * È questa regola — e non un controllo su "../" — a rendere impossibile
 * uscire dalla cartella della categoria. Vale anche per il nome della
 * cartella di categoria, che ha la stessa forma (`secondi-piatti`).
 */
const FORMA_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Oltre questa lunghezza non è uno slug, è un tentativo. */
const LUNGHEZZA_MAX_SLUG = 120;

/**
 * Vero se lo slug è nella forma usata dalle ricette: minuscole, cifre, trattini.
 *
 * @param {unknown} slug
 * @returns {boolean}
 */
export function slugValido(slug) {
    return typeof slug === 'string'
        && slug.length <= LUNGHEZZA_MAX_SLUG
        && FORMA_SLUG.test(slug);
}

/** Messaggio unico per lo slug rifiutato: la dashboard lo mostra così com'è. */
export const ERRORE_SLUG = 'Slug non valido: ammessi solo minuscole, cifre e trattini (es. pane-pugliese-biga)';

// ══════════════════════════════════════════════════════════
//  CATEGORIA → CARTELLA
// ══════════════════════════════════════════════════════════

/**
 * Cartelle ammesse sotto `ricette/`, lette dal registry del sito.
 *
 * Il risultato NON viene memorizzato: la dashboard sa creare e rinominare
 * categorie mentre il server gira (`routes/categories.js` riscrive
 * `js/categories.js` e aggiorna `CATEGORY_FOLDERS` in memoria nello stesso
 * processo). Un elenco fotografato alla prima chiamata faceva sparire
 * dall'editor le ricette della categoria appena creata.
 *
 * @returns {Set<string>}
 */
export function cartelleAmmesse() {
    return new Set(Object.values(CATEGORY_FOLDERS));
}

/** Etichette ammesse ("Pane", "Secondi Piatti", ...), nell'ordine del registry. */
export function etichetteAmmesse() {
    return Object.keys(CATEGORY_FOLDERS);
}

/**
 * Traduce una categoria nella cartella su disco, senza lanciare.
 *
 * Accetta sia l'etichetta del registry ("Secondi Piatti") sia la cartella
 * ("secondi-piatti", che è ciò che alcune rotte restituiscono). Qualsiasi
 * altro valore vale `null`: categoria che il sito non conosce.
 *
 * @param {unknown} categoria
 * @returns {string|null} la cartella (`dir`), oppure null
 */
export function cartellaCategoriaSeValida(categoria) {
    if (typeof categoria !== 'string' || !categoria.trim()) return null;

    // `Object.hasOwn` e non `CATEGORY_FOLDERS[categoria]`: l'oggetto arriva da
    // `Object.fromEntries`, quindi ha Object.prototype, e una categoria che si
    // chiama "constructor" o "toString" restituirebbe una FUNZIONE come se
    // fosse un nome di cartella.
    const etichetta = categoria.trim();
    if (Object.hasOwn(CATEGORY_FOLDERS, etichetta)) return CATEGORY_FOLDERS[etichetta];

    const cartella = etichetta.toLowerCase();
    return cartelleAmmesse().has(cartella) ? cartella : null;
}

/**
 * Traduce una categoria nella cartella su disco, oppure lancia.
 *
 * Non esiste un ripiego: una cartella inventata (`ricette/pasta/`) manda in
 * errore `npm run check` del sito e blocca ogni pubblicazione, e il momento in
 * cui accorgersene è adesso, non al deploy. Chi deve rispondere 400 al browser
 * invece di interrompersi usi `cartellaCategoriaSeValida`.
 *
 * @param {unknown} categoria - etichetta ("Secondi Piatti") o cartella ("secondi-piatti")
 * @returns {string} la cartella sotto `ricette/`
 * @throws {Error} se la categoria non è dichiarata in js/categories.js
 */
export function cartellaCategoria(categoria) {
    const cartella = cartellaCategoriaSeValida(categoria);
    if (cartella) return cartella;

    const mostrata = typeof categoria === 'string' ? categoria : String(categoria);
    throw new Error(
        `Categoria "${mostrata}" non dichiarata in js/categories.js del sito. ` +
        `Attese: ${etichetteAmmesse().join(', ')} ` +
        `(oppure le cartelle: ${[...cartelleAmmesse()].join(', ')}). ` +
        `Scrivere in una cartella non dichiarata fa fallire "npm run check" del sito ` +
        `e blocca la pubblicazione: aggiungi prima la categoria al registry.`
    );
}

/** Messaggio unico per la categoria rifiutata nelle rotte HTTP. */
export const ERRORE_CATEGORIA = 'Categoria non riconosciuta: deve essere una di quelle dichiarate in js/categories.js';

// ══════════════════════════════════════════════════════════
//  RADICE DEL REPO DEL SITO
// ══════════════════════════════════════════════════════════

/**
 * Percorso assoluto del repo del sito.
 * Stessa convenzione usata da sempre: parametro esplicito, poi
 * `RICETTARIO_PATH` dal .env, poi `../Ricettario`.
 *
 * @param {string} [percorsoEsplicito] - es. `args.output` o `body.output`
 * @returns {string}
 */
export function radiceRicettario(percorsoEsplicito) {
    return resolve(
        process.cwd(),
        percorsoEsplicito || process.env.RICETTARIO_PATH || '../Ricettario'
    );
}

// ══════════════════════════════════════════════════════════
//  PERCORSI
// ══════════════════════════════════════════════════════════

/**
 * Percorso assoluto del JSON di una ricetta, con difesa dal path traversal.
 *
 * L'ordine dei controlli conta: prima la FORMA (slug e categoria), poi la
 * costruzione del percorso. Così nessun valore ostile arriva al filesystem,
 * nemmeno per uno `statSync`. Il confronto finale con la radice è cintura e
 * bretelle: se per qualsiasi motivo il percorso finisse fuori da `ricette/`,
 * non ci si scrive comunque.
 *
 * @param {unknown} categoria - etichetta o cartella (vedi `cartellaCategoria`)
 * @param {unknown} slug
 * @param {object} [opzioni]
 * @param {string} [opzioni.ricettarioPath] - radice del repo del sito (default: `radiceRicettario()`)
 * @param {string} [opzioni.estensione] - default `.json`; es. `.pre-edit.json`, `.backup.json`
 * @returns {string} percorso assoluto
 * @throws {Error} slug malformato, categoria sconosciuta o percorso fuori da `ricette/`
 */
export function percorsoRicetta(categoria, slug, opzioni = {}) {
    const { ricettarioPath = radiceRicettario(), estensione = '.json' } = opzioni;

    if (!slugValido(slug)) {
        throw new Error(`${ERRORE_SLUG} — ricevuto: "${String(slug).slice(0, 60)}"`);
    }
    const cartella = cartellaCategoria(categoria);

    const radice = resolve(ricettarioPath, 'ricette');
    const file = resolve(radice, cartella, `${slug}${estensione}`);
    if (!file.startsWith(radice + sep)) {
        throw new Error(`Percorso fuori dalla cartella delle ricette: "${file}"`);
    }
    return file;
}

/**
 * Percorso assoluto di un'immagine di ricetta dentro `public/images/ricette/`.
 * Stesse difese di `percorsoRicetta`: è l'altro posto dove slug e categoria
 * diventano cartelle vere (`mkdirSync`), quindi l'altra strada per creare una
 * cartella che il sito non conosce.
 *
 * @param {unknown} categoria
 * @param {unknown} slug
 * @param {object} [opzioni]
 * @param {string} [opzioni.ricettarioPath]
 * @param {string} [opzioni.estensione] - default `.webp`; es. `.avif`
 * @returns {string} percorso assoluto
 * @throws {Error} come `percorsoRicetta`
 */
export function percorsoImmagineRicetta(categoria, slug, opzioni = {}) {
    const { ricettarioPath = radiceRicettario(), estensione = '.webp' } = opzioni;

    if (!slugValido(slug)) {
        throw new Error(`${ERRORE_SLUG} — ricevuto: "${String(slug).slice(0, 60)}"`);
    }
    const cartella = cartellaCategoria(categoria);

    const radice = resolve(ricettarioPath, 'public', 'images', 'ricette');
    const file = resolve(radice, cartella, `${slug}${estensione}`);
    if (!file.startsWith(radice + sep)) {
        throw new Error(`Percorso fuori dalla cartella delle immagini: "${file}"`);
    }
    return file;
}

/**
 * Percorso relativo dell'immagine come va scritto nel campo `image` della
 * ricetta (il sito lo risolve rispetto a `public/`). Barre in avanti sempre:
 * è un URL, non un percorso di Windows.
 *
 * @returns {string} es. `images/ricette/secondi-piatti/brasato.webp`
 */
export function riferimentoImmagineRicetta(categoria, slug, estensione = '.webp') {
    if (!slugValido(slug)) {
        throw new Error(`${ERRORE_SLUG} — ricevuto: "${String(slug).slice(0, 60)}"`);
    }
    return `images/ricette/${cartellaCategoria(categoria)}/${slug}${estensione}`;
}

// ══════════════════════════════════════════════════════════
//  RICETTA O FILE DI LAVORO?
// ══════════════════════════════════════════════════════════

/**
 * File che vivono accanto alle ricette ma ricette non sono: le copie di
 * sicurezza (`.backup.json`), le istantanee pre-modifica (`.pre-edit.json`,
 * `.pre-gen.json`) e i sidecar di qualità (`.qualita.json`).
 *
 * La regola CANONICA è quella del sito, `scripts/build-recipes.js:23`:
 *
 *     const NOT_A_RECIPE = /\.(backup|pre-edit)\.json$/;
 *
 * perché è quella che decide cosa finisce online. Questa qui la CONTIENE per
 * intero (`.pre-edit.json` ricade in `\.pre-<qualcosa>\.json$`) e in più copre
 * i due sidecar che il sito non conosce ancora ma che i tools scrivono:
 * `.pre-gen.json` e `.qualita.json`. L'ampliamento è deliberato e va in una
 * direzione sola — qui non può essere considerato "ricetta" niente che il sito
 * pubblicherebbe.
 *
 * ⚠️ Il buco è dall'altra parte, e sta nel sito: `.pre-gen.json` e
 * `.qualita.json` NON sono filtrati da `build-recipes.js`, quindi il giorno in
 * cui uno di quei file finisce sotto `ricette/` il sito prova a indicizzarlo
 * come ricetta e `npm run check` si ferma. Va allargata quella regex, non
 * ristretta questa.
 *
 * Perché saltarli: `focaccia.pre-edit.json` produrrebbe lo slug
 * "focaccia.pre-edit" — che non è una ricetta ma ne occuperebbe il posto negli
 * indici, nei report di qualità e nelle chiamate AI (pagate due volte).
 */
const FILE_DI_LAVORO = /\.(backup|qualita)\.json$|\.pre-[a-z0-9-]+\.json$/i;

/**
 * Vero se il file è un file di lavoro accanto a una ricetta, non una ricetta.
 * Accetta il nome del file o un percorso completo.
 *
 * @param {unknown} nomeFile
 * @returns {boolean}
 */
export function eFileDiLavoro(nomeFile) {
    if (typeof nomeFile !== 'string') return false;
    return FILE_DI_LAVORO.test(nomeFile);
}

/**
 * Vero se il file, dentro una cartella di categoria, è davvero una ricetta:
 * un `.json` che non è né un file di lavoro né l'indice della cartella.
 *
 * È la combinazione che tutti i punti di scansione facevano a mano, ognuno con
 * la sua regex.
 *
 * @param {unknown} nomeFile
 * @returns {boolean}
 */
export function eFileDiRicetta(nomeFile) {
    if (typeof nomeFile !== 'string' || !nomeFile.toLowerCase().endsWith('.json')) return false;
    if (nomeFile === 'index.json') return false;
    return !eFileDiLavoro(nomeFile);
}

/**
 * Slug di una ricetta a partire dal nome del suo file.
 *
 * Toglie SOLO l'estensione finale: `String.replace('.json', '')` — usato in
 * `routes/recipes.js` — sostituisce la PRIMA occorrenza ovunque si trovi, e su
 * un nome come `pane.json.json` (o su un percorso che contiene `.json` in
 * mezzo) restituisce lo slug sbagliato.
 *
 * @param {string} nomeFile - solo il nome, non il percorso
 * @returns {string}
 */
export function slugDaNomeFile(nomeFile) {
    const nome = String(nomeFile);
    return nome.toLowerCase().endsWith('.json') ? nome.slice(0, -'.json'.length) : nome;
}
