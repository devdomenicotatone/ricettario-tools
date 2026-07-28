/**
 * IMAGE FINDER — Ricerca intelligente immagini multi-provider
 * 
 * Strategia cascade PRO:
 *   1. Pexels  (migliori foto food, 200 req/h)
 *   2. Unsplash (alta qualità, 50 req/h demo)
 *   3. Pixabay  (grande catalogo, 100 req/min)
 *   4. Wikimedia Commons (fallback, no API key)
 * 
 * Deduplicazione:
 *   - Per sessione: Set di URL già usati
 *   - Persistente: data/used-images.json (URL→slug)
 *   - Per slug: non scarica se file già esiste su disco
 */

import { writeFileSync, readFileSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { pathToFileURL } from 'url';
// Indice delle foto già usate: fonte UNICA, niente copia locale. Qui c'erano
// `loadImageIndex`/`saveImageIndex`, che leggevano prima di una ricerca lunga e
// riscrivevano tutto dopo — cancellando quanto il server aveva scritto nel
// frattempo. Il modulo condiviso mette lock e scrittura atomica.
import { leggiIndiceImmagini, segnaUrlUsato } from './utils/indice-immagini.js';
// Scrittura tmp+rename: una sola implementazione per tutto il progetto (qui ce
// n'era una terza, sullo STESSO data/image-cache.json protetto da withCacheLock).
import { withCacheLock, scriviJsonAtomico } from './server/routes/_helpers.js';

const MIN_WIDTH = 600;
const MIN_HEIGHT = 400;


// ══════════════════════════════════════════════════════════
//  PROVIDER 1: PEXELS
// ══════════════════════════════════════════════════════════

async function searchPexels(query, limit = 15) {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) return [];

    const params = new URLSearchParams({
        query,
        per_page: String(limit),
        orientation: 'landscape',
    });

    try {
        const response = await fetch(`https://api.pexels.com/v1/search?${params}`, {
            headers: { Authorization: apiKey }
        });

        if (!response.ok) {
            console.log(`      ⚠️  Pexels HTTP ${response.status}`);
            return [];
        }

        const data = await response.json();
        return (data.photos || []).map(photo => ({
            title: photo.alt || query,
            url: photo.src.large2x || photo.src.large || photo.src.original,
            thumbUrl: photo.src.medium,
            width: photo.width,
            height: photo.height,
            license: 'Pexels License',
            author: photo.photographer || 'Pexels',
            authorUrl: photo.photographer_url || '',
            description: photo.alt || '',
            provider: 'Pexels',
            score: 0,
        }));
    } catch (err) {
        console.log(`      ⚠️  Pexels errore: ${err.message}`);
        return [];
    }
}

// ══════════════════════════════════════════════════════════
//  PROVIDER 2: UNSPLASH
// ══════════════════════════════════════════════════════════

async function searchUnsplash(query, limit = 15) {
    const apiKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!apiKey) return [];

    const params = new URLSearchParams({
        query,
        per_page: String(limit),
        orientation: 'landscape',
        content_filter: 'high',
    });

    try {
        const response = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
            headers: { Authorization: `Client-ID ${apiKey}` }
        });

        if (!response.ok) {
            console.log(`      ⚠️  Unsplash HTTP ${response.status}`);
            return [];
        }

        const data = await response.json();
        return (data.results || []).map(photo => ({
            title: photo.description || photo.alt_description || query,
            url: photo.urls.regular, // 1080px wide
            thumbUrl: photo.urls.small,
            width: photo.width,
            height: photo.height,
            license: 'Unsplash License',
            author: photo.user?.name || 'Unsplash',
            authorUrl: photo.user?.links?.html || '',
            description: photo.alt_description || '',
            provider: 'Unsplash',
            score: 0,
        }));
    } catch (err) {
        console.log(`      ⚠️  Unsplash errore: ${err.message}`);
        return [];
    }
}

// ══════════════════════════════════════════════════════════
//  PROVIDER 3: PIXABAY
// ══════════════════════════════════════════════════════════

async function searchPixabay(query, limit = 15) {
    const apiKey = process.env.PIXABAY_API_KEY;
    if (!apiKey) return [];

    const params = new URLSearchParams({
        key: apiKey,
        q: query,
        per_page: String(limit),
        image_type: 'photo',
        orientation: 'horizontal',
        safesearch: 'true',
        min_width: String(MIN_WIDTH),
        min_height: String(MIN_HEIGHT),
    });

    try {
        const response = await fetch(`https://pixabay.com/api/?${params}`);

        if (!response.ok) {
            console.log(`      ⚠️  Pixabay HTTP ${response.status}`);
            return [];
        }

        const data = await response.json();
        return (data.hits || []).map(photo => ({
            title: photo.tags || query,
            url: photo.largeImageURL || photo.webformatURL,
            thumbUrl: photo.previewURL,
            width: photo.imageWidth,
            height: photo.imageHeight,
            license: 'Pixabay License',
            author: photo.user || 'Pixabay',
            authorUrl: `https://pixabay.com/users/${photo.user_id}/`,
            description: photo.tags || '',
            provider: 'Pixabay',
            score: 0,
        }));
    } catch (err) {
        console.log(`      ⚠️  Pixabay errore: ${err.message}`);
        return [];
    }
}

// ══════════════════════════════════════════════════════════
//  LICENZE: cosa possiamo davvero usare
// ══════════════════════════════════════════════════════════
//
// La pipeline ridimensiona ogni foto a 1800px e la riconverte in WebP + AVIF:
// tecnicamente è un'opera derivata. Le licenze ND (NoDerivatives) vietano di
// distribuire opere derivate, quindi quelle immagini NON sono utilizzabili e
// vengono scartate all'origine, prima di arrivare al selettore.
// Le NC (NonCommercial) restano scaricabili — il sito non vende niente — ma
// vanno dichiarate: sono l'unica scelta che vincola il futuro del sito, e chi
// sceglie la foto deve vederlo prima di cliccare, non dopo la pubblicazione.

function analizzaLicenza(testoLicenza) {
    const testo = String(testoLicenza || '').toLowerCase();
    // "nd"/"nc" vanno riconosciute come sigle isolate (by-nc-nd, CC BY-ND 4.0),
    // non dentro altre parole
    const sigla = (s) => new RegExp(`(^|[^a-z])${s}([^a-z]|$)`).test(testo);
    return {
        senzaDerivate: sigla('nd') || testo.includes('noderiv') || testo.includes('no deriv'),
        nonCommerciale: sigla('nc') || testo.includes('noncommercial')
            || testo.includes('non-commercial') || testo.includes('non commercial'),
    };
}

/**
 * Scarta le immagini con licenza ND e marca quelle NC.
 * Esportata perché non basta applicarla alle ricerche nuove: la cache dei
 * candidati era stata riempita prima che esistesse, e il selettore la mostra
 * così com'è. Per quelle vecchie serve una passata a parte, che NON parte da
 * sola: `riparaCacheLicenze` qui sotto, oppure `sanificaGruppiCache` applicata
 * in lettura da chi la cache la legge.
 * @param {Array} immagini - risultati grezzi del provider (o letti dalla cache)
 * @param {string} nomeProvider - solo per il messaggio a schermo
 * @param {boolean} [silenzioso] - niente log (ripulitura in blocco della cache)
 * @returns {Array} le sole immagini utilizzabili
 */
export function filtraPerLicenza(immagini, nomeProvider, silenzioso = false) {
    const utilizzabili = [];
    let scartateND = 0;
    let contaNC = 0;

    for (const img of immagini) {
        const { senzaDerivate, nonCommerciale } = analizzaLicenza(img.license);
        if (senzaDerivate) {
            scartateND++;
            continue;
        }
        if (nonCommerciale) {
            img.nonCommerciale = true;
            img.avvisoLicenza = '⚠️ USO NON COMMERCIALE — la licenza vieta lo sfruttamento commerciale della foto';
            contaNC++;
        }
        utilizzabili.push(img);
    }

    if (!silenzioso && scartateND > 0) {
        console.log(`      🚫 ${nomeProvider}: ${scartateND} immagini scartate (licenza ND: vieta le opere derivate, e noi ridimensioniamo)`);
    }
    if (!silenzioso && contaNC > 0) {
        console.log(`      ⚠️  ${nomeProvider}: ${contaNC} immagini con licenza NC (uso non commerciale) — segnalate nel selettore`);
    }

    return utilizzabili;
}

// L'avviso va in testa al titolo perché il titolo è l'unico testo della foto
// che il selettore mostra davvero (`modules/image-picker.js`: `modal-img-title`,
// e `src/image-picker.js`: `card-title`). Scritto per esteso e non come sigla:
// "NC" non dice niente a chi sta scegliendo una foto. Il titolo sta su una riga
// sola con i puntini di sospensione (`css/modal.css`: `text-overflow: ellipsis`),
// quindi in testa l'avviso resta leggibile anche quando il titolo viene tagliato.
// La frase per esteso resta in `avvisoLicenza`, pronta per quando la modale
// mostrerà la licenza accanto ad autore e dimensioni.
const PREFISSO_NC = '⚠️ NON COMMERCIALE — ';

/** Mette l'avviso NC in testa al titolo. Idempotente: non lo raddoppia. */
function marcaTitoloNC(img) {
    if (img && img.nonCommerciale && !String(img.title || '').startsWith('⚠️')) {
        img.title = `${PREFISSO_NC}${img.title || 'Senza titolo'}`;
    }
    return img;
}

/**
 * Applica il filtro a risultati GIÀ raggruppati per provider — la forma con
 * cui finiscono in cache e con cui tornano alla UI.
 * @param {Array<{provider?: string, images?: Array}>} gruppi
 * @returns {{gruppi: Array, scartateND: number, marcateNC: number}}
 */
export function sanificaGruppiCache(gruppi) {
    let scartateND = 0;
    let marcateNC = 0;

    const puliti = (Array.isArray(gruppi) ? gruppi : []).map(gruppo => {
        const originali = Array.isArray(gruppo?.images) ? gruppo.images : [];
        const utilizzabili = filtraPerLicenza(originali, gruppo?.provider || '?', true);
        scartateND += originali.length - utilizzabili.length;
        for (const img of utilizzabili) {
            if (img.nonCommerciale && !String(img.title || '').startsWith('⚠️')) marcateNC++;
            marcaTitoloNC(img);
        }
        return { ...gruppo, images: utilizzabili };
    });

    return { gruppi: puliti, scartateND, marcateNC };
}

// Marca lasciata dentro OGNI VOCE ripulita, non come chiave in cima alla
// cache: quella mappa è slug→risultati e c'è chi la conta aspettandosi ricette
// (`rebuild-image-cache.js:43` stampa `Object.keys(cache).length` come numero
// di entry). Una chiave finta lì in mezzo diventerebbe una ricetta fantasma,
// e il prossimo che itera dovrebbe ricordarsi di saltarla.
const MARCA_LICENZE = '_licenzeFiltrate';
const VERSIONE_FILTRO_LICENZE = 1;

/** Copia di sicurezza prima di una migrazione che ELIMINA record. */
function copiaDiSicurezza(percorso) {
    const ora = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
    const destinazione = `${percorso.replace(/\.json$/i, '')}.backup-${ora}.json`;
    copyFileSync(percorso, destinazione);
    return destinazione;
}

/**
 * Migrazione UNA-TANTUM della cache dei candidati su disco.
 *
 * `filtraPerLicenza` copre le ricerche NUOVE, ma il pulsante immagine della
 * dashboard non ne fa nessuna: `/api/refresh-image` con `forceRefresh=false`
 * restituisce `data/image-cache.json` così com'è, e quel file è stato riempito
 * prima che il filtro esistesse. Le voci vecchie contengono quindi immagini ND
 * (che non possiamo ridimensionare) e NC senza avviso.
 *
 * NON GIRA DA SOLA, ed è la correzione di un guasto vero: prima era chiamata
 * nel corpo del modulo, quindi il solo `import` di questo file — che fa anche
 * `publisher.js`, per tutt'altro — riscriveva 7,6 MB di cache dell'utente
 * eliminando record, senza che nessuno avesse chiesto niente e senza copia di
 * sicurezza. Si esegue a mano, dalla cartella `tools/`:
 *
 *     node src/image-finder.js --ripara-licenze --anteprima   (conta e basta)
 *     node src/image-finder.js --ripara-licenze               (scrive, con backup)
 *
 * L'alternativa senza migrazione è filtrare in lettura: `routes/image.js`
 * passerebbe `sanificaGruppiCache()` sui `providerResults` presi dalla cache,
 * dentro il `withCacheLock` che già usa. Quella rotta è di un altro modulo e
 * non si tocca da qui.
 *
 * Ogni voce sistemata porta `_licenzeFiltrate: 1`. Se non c'è niente da
 * sistemare il file non viene riscritto affatto.
 *
 * @param {object} [opzioni]
 * @param {string} [opzioni.percorso] - default: `<cwd>/data/image-cache.json`
 * @param {boolean} [opzioni.soloAnteprima] - conta senza scrivere niente
 * @returns {Promise<{riparata: boolean, ricette: number, scartateND: number, marcateNC: number, backup: string|null}>}
 */
export async function riparaCacheLicenze(opzioni = {}) {
    const percorso = opzioni.percorso || resolve(process.cwd(), 'data', 'image-cache.json');
    const soloAnteprima = !!opzioni.soloAnteprima;
    const esito = { riparata: false, ricette: 0, scartateND: 0, marcateNC: 0, backup: null };
    if (!existsSync(percorso)) return esito;

    // `withCacheLock` è il serializzatore che il progetto usa proprio per questo
    // file, e `scriviJsonAtomico` la sua scrittura tmp+rename: sono importati in
    // cima, non qui dentro con un ripiego. Girarci intorno vorrebbe dire
    // riscrivere 7,6 MB di cache mentre il server la sta riscrivendo pure lui.
    return withCacheLock(() => {
        try {
            const cache = JSON.parse(readFileSync(percorso, 'utf-8'));

            for (const voce of Object.values(cache)) {
                if (!voce || typeof voce !== 'object' || !Array.isArray(voce.providerResults)) continue;
                if (voce[MARCA_LICENZE] === VERSIONE_FILTRO_LICENZE) continue; // già sistemata
                const { gruppi, scartateND, marcateNC } = sanificaGruppiCache(voce.providerResults);
                if (scartateND === 0 && marcateNC === 0) continue;
                voce.providerResults = gruppi;
                voce[MARCA_LICENZE] = VERSIONE_FILTRO_LICENZE;
                esito.ricette++;
                esito.scartateND += scartateND;
                esito.marcateNC += marcateNC;
            }

            // Niente da sistemare, o solo anteprima: il file resta com'è.
            if (soloAnteprima || (esito.scartateND === 0 && esito.marcateNC === 0)) return esito;

            esito.backup = copiaDiSicurezza(percorso);
            scriviJsonAtomico(percorso, cache);
            esito.riparata = true;
        } catch (err) {
            // Una cache illeggibile non deve far esplodere il comando.
            console.log(`   ⚠️  Ripulitura licenze in cache saltata: ${err.message}`);
        }
        return esito;
    });
}

// Punto d'ingresso del comando manuale. Si attiva SOLO se questo file è stato
// lanciato con `node`, mai quando qualcuno lo importa.
const ESEGUITO_DA_RIGA_DI_COMANDO = !!process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ESEGUITO_DA_RIGA_DI_COMANDO && process.argv.includes('--ripara-licenze')) {
    const soloAnteprima = process.argv.includes('--anteprima');
    riparaCacheLicenze({ soloAnteprima })
        .then(esito => {
            if (esito.scartateND === 0 && esito.marcateNC === 0) {
                console.log('✅ Cache immagini: nessuna licenza ND o NC da sistemare, file non toccato.');
                return;
            }
            if (soloAnteprima) {
                console.log(`👀 Anteprima (niente scritto): ${esito.scartateND} immagini ND da rimuovere, ${esito.marcateNC} NC da segnalare, su ${esito.ricette} ricette.`);
                console.log('   Per applicare davvero: node src/image-finder.js --ripara-licenze');
                return;
            }
            console.log(`🧹 Cache immagini ripulita: ${esito.scartateND} ND rimosse, ${esito.marcateNC} NC segnalate (${esito.ricette} ricette).`);
            console.log(`   💾 Copia di sicurezza prima della modifica: ${esito.backup}`);
            console.log('      Cancellala quando hai verificato il risultato: sono altri 7 MB, e `deploy.bat` fa `git add -A`.');
        })
        .catch(err => {
            console.error(`❌ Ripulitura licenze fallita: ${err.message}`);
            process.exitCode = 1;
        });
}


// ══════════════════════════════════════════════════════════
//  PROVIDER 5: OPENVERSE
// ══════════════════════════════════════════════════════════

/**
 * Etichetta della licenza di una foto Openverse, VERSIONE COMPRESA.
 *
 * Openverse la restituisce in tre pezzi — `license: "by-sa"`,
 * `license_version: "4.0"`, `license_url` — e qui se ne teneva solo il primo:
 * ne usciva "CC BY-SA", che non identifica nessun documento di licenza. È la
 * causa a monte del punto 13 del checkup: le foto CC BY-SA già pubblicate non
 * hanno l'URI della licenza, che è proprio quello che la CC BY-SA obbliga a
 * citare.
 *
 * Con la versione dentro il testo, `urlLicenza()` del sito
 * (`Ricettario/js/credito-foto.js`) ricava da sola
 * `https://creativecommons.org/licenses/by-sa/4.0/` dal credito: la forma che
 * quella funzione riconosce è esattamente `CC BY-SA 4.0`. Senza numero non
 * collega niente — di proposito, perché un URI di licenza sbagliato dichiara
 * condizioni d'uso che non sono quelle vere.
 */
function etichettaLicenzaOpenverse(photo) {
    const sigla = String(photo?.license || '').trim().toUpperCase();
    if (!sigla) return 'CC';
    const versione = String(photo?.license_version || '').trim();
    return versione ? `CC ${sigla} ${versione}` : `CC ${sigla}`;
}

async function searchOpenverse(query, limit = 20) {
    const params = new URLSearchParams({
        q: query,
        page_size: String(limit)
    });

    try {
        // Openverse allows anonymous access!
        const response = await fetch(`https://api.openverse.org/v1/images/?${params}`, {
            headers: { 
                'User-Agent': 'IlRicettarioBot/1.0',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            console.log(`      ⚠️  Openverse HTTP ${response.status}`);
            return [];
        }

        const data = await response.json();
        const immagini = (data.results || []).map(photo => ({
            title: photo.title || query,
            url: photo.url,
            thumbUrl: photo.url, // Usa l'URL diretto bypassando il proxy /thumb/ di Openverse che spesso da 403/404
            width: photo.width || 800,
            height: photo.height || 600,
            license: etichettaLicenzaOpenverse(photo),
            // L'URI della licenza e la pagina d'origine sono i due dati che la
            // CC BY-SA obbliga a mostrare accanto alla foto: si conservano qui,
            // non si ricostruiscono più a valle.
            licenseUrl: photo.license_url || '',
            sourceUrl: photo.foreign_landing_url || '',
            author: photo.creator || 'Openverse',
            authorUrl: photo.creator_url || '',
            description: photo.attribution || '',
            provider: 'Openverse',
            score: 0,
        }));
        return filtraPerLicenza(immagini, 'Openverse');
    } catch (err) {
        console.log(`      ⚠️  Openverse errore: ${err.message}`);
        return [];
    }
}


// ══════════════════════════════════════════════════════════
//  PROVIDER 4: WIKIMEDIA COMMONS (fallback)
// ══════════════════════════════════════════════════════════

const WIKI_API = 'https://commons.wikimedia.org/w/api.php';

async function searchWikimedia(query, limit = 10) {
    const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        generator: 'search',
        gsrnamespace: '6',
        gsrsearch: query,
        gsrlimit: String(limit),
        prop: 'imageinfo',
        iiprop: 'url|size|extmetadata|mime',
        iiurlwidth: '800',
        origin: '*',
    });

    try {
        const response = await fetch(`${WIKI_API}?${params}`, {
            headers: { 'User-Agent': 'IlRicettarioBot/1.0' }
        });

        if (!response.ok) return [];
        const data = await response.json();
        if (!data.query?.pages) return [];

        const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp'];
        const results = [];

        for (const page of Object.values(data.query.pages)) {
            const info = page.imageinfo?.[0];
            if (!info) continue;

            const rawExt = info.url?.split('.').pop()?.toLowerCase()?.split('%')[0]?.split('?')[0];
            if (!ALLOWED_EXT.includes(rawExt)) continue;
            if (info.width < MIN_WIDTH || info.height < MIN_HEIGHT) continue;

            const meta = info.extmetadata || {};
            results.push({
                title: page.title?.replace('File:', '') || query,
                url: info.url,
                thumbUrl: info.thumburl || info.url,
                width: info.width,
                height: info.height,
                license: meta.LicenseShortName?.value || 'CC',
                // Come per Openverse: Wikimedia dichiara l'URI della licenza
                // (`LicenseUrl`) e la pagina di descrizione del file, che è la
                // "fonte" che la CC chiede di collegare. Buttarli via costringeva
                // a indovinarli dal testo della licenza.
                licenseUrl: meta.LicenseUrl?.value || '',
                sourceUrl: info.descriptionurl || '',
                author: meta.Artist?.value?.replace(/<[^>]*>/g, '').trim() || 'Wikimedia',
                authorUrl: '',
                description: meta.ImageDescription?.value?.replace(/<[^>]*>/g, '').trim() || '',
                provider: 'Wikimedia',
                score: 0,
            });
        }
        return filtraPerLicenza(results, 'Wikimedia');
    } catch (err) {
        console.log(`      ⚠️  Wikimedia errore: ${err.message}`);
        return [];
    }
}

// ══════════════════════════════════════════════════════════
//  SCORING & RICERCA INTELLIGENTE
// ══════════════════════════════════════════════════════════

// Keywords food che DEVONO essere presenti nella descrizione per validare l'immagine
const FOOD_KEYWORDS = [
    // EN
    'food', 'dish', 'recipe', 'baked', 'baking', 'bread', 'pastry', 'dough', 'cake',
    'cookie', 'cookies', 'pie', 'tart', 'dessert', 'sweet', 'pizza', 'pasta', 'flour',
    'kitchen', 'cooking', 'chef', 'plate', 'bowl', 'table', 'meal', 'homemade',
    'delicious', 'fresh', 'oven', 'biscuit', 'croissant', 'brioche', 'panettone',
    'chocolate', 'cream', 'butter', 'egg', 'sugar', 'almond', 'walnut', 'nut',
    'ciabatta', 'focaccia', 'rustic', 'artisan', 'sourdough', 'yeast', 'slice',
    'loaf', 'crust', 'golden', 'warm', 'appetizing', 'garnish', 'served', 'baguette',
    'sauce', 'dressing', 'pesto', 'mayonnaise', 'oil', 'vinegar', 'spice', 'herb',
    'basil', 'tomato', 'garlic', 'onion', 'cheese', 'parmesan', 'meat', 'chicken',
    'fish', 'vegetable', 'fruit', 'drink', 'beverage', 'cocktail', 'wine', 'beer',
    'coffee', 'tea', 'breakfast', 'lunch', 'dinner', 'snack', 'appetizer', 'side',
    'main', 'course', 'restaurant', 'cafe', 'menu', 'order', 'eat', 'hungry', 'tasty',
    'yummy', 'flavor', 'taste', 'nutrition', 'healthy', 'organic', 'vegan', 'vegetarian',
    'gluten-free', 'dairy-free', 'nut-free', 'sugar-free', 'low-carb', 'keto', 'paleo',
    'diet', 'spoon', 'fork', 'knife', 'napkin', 'glass', 'cup', 'jar', 'bottle', 'can',
    'box', 'bag', 'package', 'wrapper', 'container', 'pot', 'pan', 'skillet', 'wok',
    // IT
    'cibo', 'ricetta', 'dolce', 'pane', 'forno', 'cucina', 'piatto', 'impasto',
    'lievitato', 'cornetto', 'cantuccini', 'biscotti', 'torta', 'farina', 'salsa',
    'condimento', 'olio', 'aceto', 'spezia', 'erba', 'basilico', 'pomodoro', 'aglio',
    'cipolla', 'formaggio', 'parmigiano', 'carne', 'pollo', 'pesce', 'verdura', 'frutta',
    'bevanda', 'cocktail', 'vino', 'birra', 'caffè', 'tè', 'colazione', 'pranzo',
    'cena', 'spuntino', 'antipasto', 'contorno', 'piatto principale', 'ristorante',
    'caffetteria', 'menù', 'ordinare', 'mangiare', 'affamato', 'gustoso', 'squisito',
    'sapore', 'gusto', 'nutrizione', 'sano', 'biologico', 'vegano', 'vegetariano',
];

// Keywords NON-FOOD che causano penalita severa
const NON_FOOD_KEYWORDS = [
    'landscape', 'mountain', 'cannon', 'military', 'memorial', 'war', 'monument',
    'building', 'architecture', 'sign', 'signpost', 'road', 'street', 'car', 'vehicle',
    'beach', 'ocean', 'sea', 'lake', 'river', 'forest', 'tree', 'flower', 'garden',
    'people', 'portrait', 'fashion', 'model', 'wedding', 'office', 'computer',
    'skyline', 'city', 'aerial', 'drone', 'sunset', 'sunrise', 'night', 'stadium',
    'sport', 'soccer', 'football', 'basketball', 'gym', 'fitness', 'yoga',
    'cat', 'dog', 'animal', 'pet', 'bird', 'horse', 'aquarium',
    'beans', 'lentils', 'market', 'spices', 'raw ingredient',
];

/**
 * Calcola un punteggio di pertinenza per l'immagine
 * GATE: l'immagine DEVE essere food-related
 */
function scoreImage(image, keywords) {
    let score = 0;
    const textToCheck = `${image.title || ''} ${image.description || ''}`.toLowerCase();

    // ── GATE 1: L'immagine DEVE contenere almeno una keyword food ──
    const isFoodRelated = FOOD_KEYWORDS.some(fw => textToCheck.includes(fw));
    if (!isFoodRelated) {
        score -= 100;
    }

    // ── GATE 2: Penalizza fortemente immagini esplicitamente non-food ──
    for (const nfk of NON_FOOD_KEYWORDS) {
        if (textToCheck.includes(nfk)) score -= 50;
    }

    // ── Match con keywords ricetta (titolo + descrizione) ──
    for (const kw of keywords) {
        const kwLower = kw.toLowerCase();
        const words = kwLower.split(/\s+/);
        for (const word of words) {
            if (word.length > 2 && textToCheck.includes(word)) score += 8;
        }
    }

    // Bonus per immagini orizzontali (meglio per card e hero)
    if (image.width > image.height) score += 3;

    // Bonus per alta risoluzione
    if (image.width >= 1200) score += 2;

    // Penalita per immagini troppo piccole
    if (image.width < 800) score -= 2;

    // Penalita per nomi generici tipo "IMG_" o "DSC_"
    if (/^(IMG|DSC|P\d|DSCN)/i.test(image.title)) score -= 3;

    return score;
}

/**
 * Costruisce query di ricerca per una ricetta.
 * Le keyword AI multilingua (EN/IT/DE) sono la fonte primaria.
 * Il nome ricetta e la categoria servono solo come fallback minimale.
 */
function buildSearchQueries(recipeName, category, aiKeywords) {
    const queries = [];

    // 1. Keywords AI multilingua (generate da Claude in EN/IT/DE)
    if (aiKeywords && aiKeywords.length > 0) {
        queries.push(...aiKeywords.slice(0, 4));
    }

    // 2. Nome ricetta semplificato
    const cleanName = recipeName.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    const STOPWORDS = ['di', 'del', 'della', 'delle', 'dei', 'al', 'alla', 'alle', 'con', 'in', 'per', 'tipo', 'fatto', 'casa'];
    const significantWords = cleanName.toLowerCase().split(' ')
        .filter(w => !STOPWORDS.includes(w) && w.length > 2);
    
    if (significantWords.length > 0) {
        queries.push(significantWords.slice(0, 3).join(' ')); // Fino a 3 parole chiave (es. "baguette francese tradizionale")
        if (!aiKeywords || aiKeywords.length === 0) {
            queries.push(significantWords.slice(0, 2).join(' ')); // Fallback a 2 parole
        }
    }

    return [...new Set(queries)];
}

/**
 * Ricerca intelligente multi-provider con cascade
 * 
 * @param {string} recipeName - Nome della ricetta
 * @param {string} category - Categoria (es. "Pasta")
 * @param {string[]} aiKeywords - Keywords suggerite da Claude
 * @param {Set} usedUrls - URL già usati da evitare (deduplicazione)
 * @returns {Promise<object|null>} Migliore immagine trovata, o null
 */
export async function findRecipeImage(recipeName, category = '', aiKeywords = [], usedUrls = new Set()) {
    console.log('\n📸 ═══════════════════════════════════════');
    console.log('   STOCK IMAGE SEARCH');
    console.log('═══════════════════════════════════════════');
    console.log(`   🍽️  ${recipeName} (${category})`);

    const queries = buildSearchQueries(recipeName, category, aiKeywords);
    const allKeywords = [recipeName.toLowerCase(), ...(aiKeywords.map(k => k.toLowerCase()))];

    // Provider in ordine di priorità
    const providers = [
        { name: 'Pexels', fn: searchPexels, emoji: '🟣' },
        { name: 'Unsplash', fn: searchUnsplash, emoji: '⬛' },
        { name: 'Pixabay', fn: searchPixabay, emoji: '🟢' },
        { name: 'Wikimedia', fn: searchWikimedia, emoji: '🌐' },
    ];

    let bestImage = null;

    for (const provider of providers) {
        console.log(`\n   ${provider.emoji} ${provider.name}`);

        for (const query of queries) {
            process.stdout.write(`      → "${query}" ... `);
            const results = await provider.fn(query, 15);

            if (results.length === 0) {
                console.log('❌ 0 risultati');
                await sleep(300);
                continue;
            }

            // Scoring + deduplicazione
            for (const img of results) {
                img.score = scoreImage(img, allKeywords);
                if (usedUrls.has(img.url)) img.score -= 1000;
            }
            results.sort((a, b) => b.score - a.score);

            const best = results[0];
            console.log(`✅ ${results.length} risultati (top: score ${best.score})`);

            // Prendi solo se score positivo (non già usata)
            if (best.score > -500 && (!bestImage || best.score > bestImage.score)) {
                bestImage = best;
                bestImage._query = query;
            }

            // Se abbiamo un buon risultato food-related, non servono altre query
            if (bestImage && bestImage.score >= 15) break;

            await sleep(300);
        }

        // Se abbiamo trovato un'immagine buona e food-related, non servono altri provider
        if (bestImage && bestImage.score >= 8) {
            console.log(`\n   ✨ Trovata con ${provider.name}!`);
            break;
        }
    }

    if (bestImage) {
        usedUrls.add(bestImage.url);
        console.log(`\n   🏆 Migliore: "${bestImage.title}"`);
        console.log(`      📐 ${bestImage.width}x${bestImage.height} | 🏷️  ${bestImage.provider}`);
        console.log(`      � ${bestImage.author} | 📜 ${bestImage.license}`);
        console.log(`      � ${bestImage.url}`);
        if (bestImage.nonCommerciale) console.log(`      ${bestImage.avvisoLicenza}`);
    } else {
        console.log('\n   ⚠️  Nessuna immagine trovata su nessun provider.');
    }

    return bestImage;
}

/**
 * Cerca immagini su TUTTI i provider e restituisce risultati raggruppati.
 * Non fa early-exit — interroga ogni provider con ogni query.
 * Usata dall'Image Picker UI per dare scelta visuale all'utente.
 *
 * @returns {Promise<Array<{provider, emoji, images}>>}
 */
export async function searchAllProviders(recipeName, category = '', aiKeywords = []) {
    const queries = buildSearchQueries(recipeName, category, aiKeywords);
    const allKeywords = [recipeName.toLowerCase(), ...(aiKeywords.map(k => k.toLowerCase()))];

    const providers = [
        { name: 'Pexels', fn: searchPexels, emoji: '🟣' },
        { name: 'Unsplash', fn: searchUnsplash, emoji: '⬛' },
        { name: 'Pixabay', fn: searchPixabay, emoji: '🟢' },
        { name: 'Wikimedia', fn: searchWikimedia, emoji: '🌐' },
        { name: 'Openverse', fn: searchOpenverse, emoji: '🪐' },
    ];

    const grouped = [];

    for (const provider of providers) {
        console.log(`   ${provider.emoji} Cerco su ${provider.name}...`);
        const seen = new Set();
        const providerImages = [];

        for (const query of queries) {
            const results = await provider.fn(query, 20);
            for (const img of results) {
                if (seen.has(img.url)) continue;
                seen.add(img.url);
                img.score = scoreImage(img, allKeywords);
                img.provider = provider.name;
                // Il selettore mostra il titolo: se la licenza è NC l'avviso si legge lì,
                // prima del clic. (Marcato dopo lo scoring, per non alterare il punteggio.)
                marcaTitoloNC(img);
                if (img.score > -50) providerImages.push(img); // Solo food-related
            }
            await sleep(300);
        }

        providerImages.sort((a, b) => b.score - a.score);
        grouped.push({
            provider: provider.name,
            emoji: provider.emoji,
            images: providerImages.slice(0, 30), // Max 30 per provider
        });
        console.log(`     ✅ ${providerImages.length} immagini trovate`);
    }

    return grouped;
}


/**
 * Nome del primo ELEMENTO di un documento testuale (XML/HTML), saltando
 * dichiarazione XML, commenti, DOCTYPE e istruzioni di elaborazione.
 *
 * Serve a distinguere un SVG vero da una pagina che ne CONTIENE uno: la
 * radice di una pagina di errore XHTML è `html`, anche quando ha un logo
 * `<svg>` inline dieci righe più sotto.
 *
 * @param {string} testa - inizio del file decodificato come testo
 * @returns {string|null} nome dell'elemento in minuscolo, o null se non si capisce
 */
function radiceDocumentoTesto(testa) {
    // Il BOM, letto come latin1, sono i tre byte EF BB BF: vanno tolti a mano.
    let resto = testa.replace(/^(﻿|ï»¿)/, '').trimStart();

    // Il prologo è fatto di poche cose; il limite evita di girare a vuoto su
    // un input costruito apposta (mille commenti vuoti).
    for (let giro = 0; giro < 16; giro++) {
        if (resto.startsWith('<?')) {                 // <?xml version="1.0"?>
            const fine = resto.indexOf('?>');
            if (fine === -1) return null;             // troncato: non si sa
            resto = resto.slice(fine + 2).trimStart();
            continue;
        }
        if (resto.startsWith('<!--')) {               // commento
            const fine = resto.indexOf('-->');
            if (fine === -1) return null;
            resto = resto.slice(fine + 3).trimStart();
            continue;
        }
        if (/^<!doctype/i.test(resto)) {              // DOCTYPE, con o senza subset [...]
            let dentroSubset = false;
            let i = 0;
            for (; i < resto.length; i++) {
                const c = resto[i];
                if (c === '[') dentroSubset = true;
                else if (c === ']') dentroSubset = false;
                else if (c === '>' && !dentroSubset) break;
            }
            if (i >= resto.length) return null;
            resto = resto.slice(i + 1).trimStart();
            continue;
        }
        const elemento = /^<([a-z][a-z0-9:._-]*)/i.exec(resto);
        return elemento ? elemento[1].toLowerCase() : null;
    }
    return null;
}

/**
 * Riconosce il formato dai primi byte del file (i "magic bytes").
 * L'estensione dell'URL e il Content-Type dichiarano, i byte dimostrano.
 * @returns {string|null} nome del formato, o null se non è un'immagine
 */
function riconosciFormatoImmagine(buffer) {
    if (!buffer || buffer.length < 12) return null;

    const inizio = buffer.subarray(0, 4).toString('latin1');

    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'JPEG';
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'PNG';
    if (inizio === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'WebP';
    if (inizio.startsWith('GIF')) return 'GIF';
    if (buffer.subarray(4, 8).toString('latin1') === 'ftyp') {
        const brand = buffer.subarray(8, 12).toString('latin1').toLowerCase();
        return ['avif', 'avis', 'heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(brand) ? 'AVIF/HEIF' : null;
    }
    if (inizio.startsWith('BM')) return 'BMP';
    if ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2A && buffer[3] === 0x00)
        || (buffer[0] === 0x4D && buffer[1] === 0x4D && buffer[2] === 0x00 && buffer[3] === 0x2A)) return 'TIFF';

    // SVG: è testo, quindi firma binaria non ne ha — ma sharp lo rasterizza
    // senza problemi, e su Wikimedia/Openverse ci sono candidati SVG con
    // licenza libera e punteggio alto. Scartarlo qui li perdeva tutti.
    //
    // Conta SOLO che la radice del documento sia `<svg`. Accettare "comincia
    // con <?xml o con un commento E contiene <svg da qualche parte" faceva
    // passare per SVG le pagine di errore XHTML con un logo inline: sharp le
    // rifiutava comunque, ma l'errore diceva "forse troncato" e finiva sul
    // ramo ritentabile, cioè la stessa pagina scaricata tre volte.
    const testa = buffer.subarray(0, 4096).toString('latin1');
    if (radiceDocumentoTesto(testa) === 'svg') return 'SVG';

    return null;
}

/**
 * Errore parlante per quando il server ha risposto qualcosa che immagine non è
 * (tipicamente una pagina di errore o di login). Di regola non ritentabile:
 * riprovare scaricherebbe la stessa pagina altre due volte.
 * L'eccezione è il corpo vuoto — vedi sotto.
 */
function erroreNonImmagine(imageUrl, buffer, contentType) {
    const anteprima = buffer.subarray(0, 160).toString('utf-8').replace(/\s+/g, ' ').trim().slice(0, 90);
    const tipo = contentType ? `Content-Type "${contentType}"` : 'Content-Type assente';
    const dichiarato = (String(contentType || '').split(';')[0] || '').trim().toLowerCase();
    // Un `image/...` che i byte smentiscono è un'immagine rotta o troncata, non
    // una pagina di login: annunciare "hotlink bloccato" manderebbe fuori strada
    // (`image/svg+xml` faceva match su "xml" e si prendeva quella diagnosi).
    const paginaWeb = !dichiarato.startsWith('image/')
        && (/^<(!doctype|!--|html|\?xml)/i.test(anteprima) || /html|xml/i.test(dichiarato));
    const indizio = paginaWeb
        ? ' — è una pagina web (errore del server, login o hotlink bloccato), non una foto'
        : (buffer.length === 0 ? ' — risposta vuota' : '');

    const err = new Error(
        `Il file scaricato non è un'immagine${indizio}. ${tipo}, ${buffer.length} byte` +
        (anteprima ? `, inizia con «${anteprima}»` : '') + `. URL: ${imageUrl}`
    );
    // Una risposta VUOTA è l'errore transitorio per eccellenza (connessione
    // chiusa a metà, singhiozzo del CDN): lì i tre tentativi servono davvero,
    // ed erano già il comportamento di prima. Tutto il resto — una pagina di
    // login, un JSON di errore — riprovando torna identico.
    err.nonRitentabile = buffer.length > 0;
    return err;
}

/**
 * Scarica un'immagine e la converte automaticamente in WebP + AVIF via sharp.
 * @param {string} imageUrl - URL dell'immagine da scaricare
 * @param {string} destPath - Path di destinazione (deve finire in .webp)
 * @returns {Promise<string>} Path del file WebP salvato
 */
export async function downloadImage(imageUrl, destPath) {
    const dir = dirname(destPath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(imageUrl, {
                headers: { 'User-Agent': 'IlRicettarioBot/1.0' }
            });

            if (response.status === 429) {
                const wait = (attempt + 1) * 3000;
                console.log(`   ⏳ Rate limit download, attendo ${wait / 1000}s...`);
                await sleep(wait);
                continue;
            }

            if (!response.ok) throw new Error(`Download fallito: HTTP ${response.status}`);

            const contentType = response.headers.get('content-type') || '';
            const buffer = Buffer.from(await response.arrayBuffer());
            const sizeKB = Math.round(buffer.length / 1024);

            // ── Il file scaricato deve essere davvero un'immagine ──
            // Senza questo controllo una pagina di errore HTML finisce salvata
            // come .webp (sharp fallisce, il fallback qui sotto scrive il buffer
            // così com'è) e la funzione dichiara che è andato tutto bene.
            //
            // A decidere sono SOLO i byte. Il Content-Type non ha voto: parecchi
            // CDN servono foto buone come text/plain o application/json, e
            // scartarle per il tipo dichiarato — com'era prima — voleva dire
            // perderle. L'HTML viene respinto lo stesso, perché firma di
            // immagine non ne ha.
            const tipoDichiarato = (contentType.split(';')[0] || '').trim().toLowerCase();
            const formato = riconosciFormatoImmagine(buffer);

            if (!formato) throw erroreNonImmagine(imageUrl, buffer, contentType);

            // Un Content-Type in disaccordo con i byte va comunque detto, per
            // distinguerlo a terminale dal caso "byte non riconosciuti".
            // "octet-stream" no: lo usano parecchi CDN, non è un indizio.
            if (tipoDichiarato && !tipoDichiarato.startsWith('image/') && !tipoDichiarato.endsWith('/octet-stream')) {
                console.log(`   ⚠️  Content-Type inatteso ("${tipoDichiarato}") ma i byte sono ${formato}: procedo.`);
            }

            // Converti con sharp in WebP + AVIF.
            // Il fallback vale solo se sharp MANCA: se invece sharp c'è e la
            // conversione fallisce, i dati scaricati sono rotti e scriverli
            // com'è riporterebbe il problema di prima (file .webp che immagine
            // non è, con "tutto bene" a schermo).
            let sharp;
            try {
                sharp = (await import('sharp')).default;
            } catch (sharpErr) {
                console.log(`   ⚠️ Sharp non disponibile (${sharpErr.message}), salvo originale`);
                writeFileSync(destPath, buffer);
                console.log(`   💾 Salvata: ${destPath} (${sizeKB} KB)`);
                return destPath;
            }

            const webpPath = destPath.replace(/\.[^.]+$/, '.webp');
            const avifPath = destPath.replace(/\.[^.]+$/, '.avif');

            try {
                await sharp(buffer)
                    .resize({ width: 1800, withoutEnlargement: true })
                    .webp({ quality: 82 })
                    .toFile(webpPath);

                await sharp(buffer)
                    .resize({ width: 1800, withoutEnlargement: true })
                    .avif({ quality: 50 })
                    .toFile(avifPath);
            } catch (convErr) {
                throw new Error(
                    `Conversione fallita: sharp non riesce a leggere i ${buffer.length} byte scaricati ` +
                    `(riconosciuti come ${formato}, forse troncati) — ${convErr.message}. URL: ${imageUrl}`
                );
            }

            const { statSync: fsStat } = await import('fs');
            const webpSize = Math.round(fsStat(webpPath).size / 1024);
            const avifSize = Math.round(fsStat(avifPath).size / 1024);
            console.log(`   💾 Convertita: ${sizeKB}KB originale → ${webpSize}KB WebP + ${avifSize}KB AVIF`);

            // ── Varianti responsive -640 + mappa dimensioni ──
            // Il sito emette srcset a due larghezze solo per le foto presenti
            // in js/dimensioni-foto.js (invariante voce ⇔ varianti su disco).
            // Era un passo manuale e le prime due ricette nuove sono nate
            // senza: adesso lo fa la pipeline, per ogni via (generazione e
            // refresh). Se fallisce non è un errore della foto: la ricetta
            // degrada al markup senza srcset, e lo si rifà a mano.
            try {
                const { aggiungiVariantiResponsive } = await import('./varianti-foto.js');
                const dim = await aggiungiVariantiResponsive(webpPath);
                console.log(`   📐 Varianti -640 generate e mappa dimensioni aggiornata (${dim.width}×${dim.height})`);
            } catch (varErr) {
                console.log(`   ⚠️ Varianti -640 non generate (${varErr.message}): la foto resta senza srcset — istruzioni manuali nel header di js/dimensioni-foto.js`);
            }

            return webpPath;
        } catch (err) {
            // Una pagina HTML al posto di una foto non migliora riprovando
            if (err.nonRitentabile || attempt === 2) throw err;
            await sleep(1000);
        }
    }
    throw new Error('Download fallito dopo 3 tentativi');
}

/**
 * Genera il testo di attribuzione
 */
export function buildAttribution(image) {
    if (!image) return '';
    const author = image.author || image.provider;
    return `📷 Foto: ${author} — ${image.license} via ${image.provider}`;
}

/**
 * Flusso completo: cerca + scarica + converte + restituisce dati immagine
 */
export async function findAndDownloadImage(recipe, ricettarioPath, usedUrls = new Set()) {
    const ext = 'webp';
    const slug = recipe.slug || recipe.title.toLowerCase().replace(/\s+/g, '-');

    // Mappa categoria → sottocartella (sorgente di verità: constants.js)
    const { CATEGORY_FOLDERS } = await import('./constants.js');
    const category = recipe.category || 'pane';
    const catFolder = CATEGORY_FOLDERS[category] || category.toLowerCase();
    const localPath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}.${ext}`);

    // ── Blocklist per slug: se il file esiste già, skippa ──
    if (existsSync(localPath)) {
        console.log(`\n📸 Immagine già presente per "${slug}", skip ricerca.`);
        const relativePath = `../../images/ricette/${catFolder}/${slug}.${ext}`;
        const homeRelativePath = `images/ricette/${catFolder}/${slug}.${ext}`;
        return { localPath, relativePath, homeRelativePath, url: '', attribution: '📷 Immagine esistente', license: '', author: '', provider: '' };
    }

    // ── Carica index persistente e mergia con usedUrls di sessione ──
    const persistentUrls = new Set([...usedUrls, ...Object.keys(leggiIndiceImmagini())]);

    // Utilizziamo searchAllProviders per popolare il database di candidati
    const providerResults = await searchAllProviders(
        recipe.title,
        recipe.category,
        recipe.imageKeywords || []
    );

    // Salviamo nel database dei candidati (mutex-protected)
    try {
        const { withCacheLock, readImageCache, writeImageCache } = await import('./server/routes/_helpers.js');
        await withCacheLock(() => {
            const cache = readImageCache();
            cache[slug] = { providerResults, timestamp: Date.now() };
            writeImageCache(cache);
        });
        console.log(`\n💾 Database immagini salvato in cache per "${slug}" (${providerResults.length} provider trovati).`);
    } catch (e) {
        console.error("⚠️ Impossibile salvare la cache delle immagini:", e.message);
    }

    // Seleziona la migliore immagine
    let bestImage = null;
    for (const group of providerResults) {
        for (const img of group.images) {
            // Ricalcola lo score escludendo quelle già usate
            let currentScore = img.score;
            if (persistentUrls.has(img.url)) currentScore -= 1000;
            
            if (currentScore > -500 && (!bestImage || currentScore > bestImage.score)) {
                img.score = currentScore;
                bestImage = img;
            }
        }
    }

    const image = bestImage;

    if (!image) return null;

    if (image.nonCommerciale) {
        console.log(`   ${image.avvisoLicenza} (${image.license}, ${image.provider})`);
    }

    try {
        await downloadImage(image.url, localPath);

        // ── Salva nell'index persistente ──
        // Rileggendolo sotto lock, non riscrivendo la copia caricata prima della
        // ricerca: fra le due cose passano decine di secondi di chiamate ai
        // provider, e quello che il server ha segnato nel frattempo andava perso.
        const esitoIndice = await segnaUrlUsato(image.url, slug);
        if (esitoIndice.precedente && esitoIndice.precedente !== slug) {
            console.log(`   ⚠️  Questa foto risultava già usata da "${esitoIndice.precedente}": ora è attribuita a "${slug}".`);
        }

        const relativePath = `../../images/ricette/${catFolder}/${slug}.${ext}`;
        const homeRelativePath = `images/ricette/${catFolder}/${slug}.${ext}`;

        return {
            localPath,
            relativePath,
            homeRelativePath,
            url: image.url,
            thumbUrl: image.thumbUrl,
            attribution: buildAttribution(image),
            license: image.license,
            // Vuoti per i banchi immagini (Pexels & c.): là la licenza è una
            // sola e il sito ne conosce già l'indirizzo. Valorizzati per le CC,
            // che l'URI della licenza lo pretendono accanto alla foto.
            licenseUrl: image.licenseUrl || '',
            sourceUrl: image.sourceUrl || '',
            author: image.author,
            provider: image.provider,
            width: image.width,
            height: image.height,
        };
    } catch (err) {
        console.log(`   ⚠️  Download fallito: ${err.message}`);
        return null;
    }
}

// ══════════════════════════════════════════════════════════
//  AI IMAGE GENERATION (Gemini Imagen)
// ══════════════════════════════════════════════════════════

export async function generateImageWithGemini(prompt, referenceImageBase64 = null, referenceImageMimeType = 'image/jpeg') {
    const { getActiveGeminiKey } = await import('./utils/api.js');
    const key = getActiveGeminiKey();
    if (!key) throw new Error("API Key Gemini non configurata");

    const hasReference = !!referenceImageBase64;
    console.log(`   🤖 Generazione immagine con AI${hasReference ? ' + riferimento visivo' : ''}: "${prompt}"...`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${key}`;

    // Build multimodal parts array
    const parts = [];

    if (hasReference) {
        // Add the reference image first
        parts.push({
            inlineData: {
                mimeType: referenceImageMimeType,
                data: referenceImageBase64
            }
        });
        // Wrap prompt with subject-faithful reference instructions
        parts.push({
            text: `Recreate the food item shown in the reference image as faithfully as possible — match its exact shape, texture, crust color, filling, and natural imperfections. The result must look like a real photograph of the same dish, not an idealized version. Then place it in a professional food photography setting with: ${prompt}`
        });
    } else {
        parts.push({ text: prompt });
    }

    const payload = {
        contents: [
            {
                role: 'user',
                parts
            }
        ],
        generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: "4:3" }
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Errore API Gemini (${response.status}): ${errText}`);
    }

    const data = await response.json();
    let base64Str = null;

    if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
        for (const part of data.candidates[0].content.parts) {
            if (part.inlineData && part.inlineData.data) {
                base64Str = part.inlineData.data;
                break;
            }
        }
    }

    if (!base64Str) {
        throw new Error("Risposta API Gemini non valida (nessuna immagine restituita nel payload inlineData)");
    }

    return Buffer.from(base64Str, 'base64');
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
