/**
 * ROUTES/RECIPES — CRUD ricette, generazione, scopri, sync, elimina
 *
 * Tutto quello che arriva qui viene dal browser: categoria, slug, corpo della
 * ricetta e URL da scaricare. Le funzioni di validazione in cima al file sono
 * il punto in cui quei dati smettono di essere "quello che ha detto il client"
 * e diventano percorsi su disco o indirizzi da aprire.
 */

import { resolve, sep } from 'path';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { lookup } from 'dns/promises';

import {
    slugValido,
    cartellaCategoriaSeValida,
    cartelleAmmesse,
    etichetteAmmesse,
    percorsoRicetta,
    percorsoImmagineRicetta,
    eFileDiRicetta,
    slugDaNomeFile,
} from '../../utils/percorsi-ricette.js';
import { salvaCopiaSicurezza } from '../../utils/backup-ricette.js';
import { liberaUrlDiRicetta } from '../../utils/indice-immagini.js';

// ── Validazione di categoria e slug ──

// La regola dello slug (kebab-case stretto: niente punti, niente barre, niente
// `..`) e la traduzione categoria → cartella NON stanno più qui: erano copiate
// carattere per carattere anche in `routes/image.js` e in altri sette punti, e
// due copie della stessa regola prima o poi divergono. La fonte unica è
// `src/utils/percorsi-ricette.js`, che non dipende da nessuna rotta — quindi
// non ricrea l'accoppiamento fragile fra moduli pari-grado che c'era quando
// questo file importava da `image.js`.
//
// È quella regola, non un controllo su "../", a rendere impossibile uscire
// dalla cartella della categoria — e vale anche per il nome della cartella di
// categoria, che ha la stessa forma (`secondi-piatti`).

// Ri-esportata perché era già parte della superficie pubblica di questo modulo:
// chi la importava da qui continua a ricevere la stessa (unica) funzione.
export { slugValido };

/** Vero se `<sito>/ricette/<cat>` esiste già come cartella. */
function cartellaCategoriaSuDisco(radice, cat) {
    try {
        return statSync(resolve(radice, cat)).isDirectory();
    } catch {
        return false;
    }
}

/**
 * Risolve il JSON di una ricetta validando categoria e slug.
 * @returns {Promise<{file: string, errore?: undefined} | {errore: string, file?: undefined}>}
 */
export async function risolviPercorsoRicetta(ricettarioPath, cat, slug) {
    // Prima la forma, poi l'esistenza: così nessun valore ostile arriva mai al
    // filesystem, nemmeno per un `statSync`.
    if (!slugValido(cat)) {
        return { errore: `Categoria non valida: "${cat}" — attesa la cartella in kebab-case (es. secondi-piatti)` };
    }
    if (!slugValido(slug)) {
        return { errore: `Slug non valido: "${slug}" — atteso kebab-case (es. pane-pugliese-biga)` };
    }

    const radice = resolve(ricettarioPath, 'ricette');
    const file = resolve(radice, cat, `${slug}.json`);

    // Cintura e bretelle: se per qualsiasi motivo il percorso finisce fuori
    // dalle ricette, non ci si scrive comunque.
    if (!file.startsWith(radice + sep)) {
        return { errore: 'Percorso fuori dalla cartella delle ricette' };
    }

    // La categoria deve esistere davvero: o è dichiarata nel registry del sito,
    // o è già una cartella sotto `ricette/`. Il secondo caso è il ripiego per la
    // finestra in cui il registry su disco è cambiato ma il processo ha ancora
    // in cache il modulo ESM che l'ha letto: senza, l'editor non aprirebbe le
    // ricette di una categoria creata mentre il server era acceso.
    const cartelle = cartelleAmmesse();
    if (!cartelle.has(cat) && !cartellaCategoriaSuDisco(radice, cat)) {
        return { errore: `Categoria non valida: "${cat}" — attese: ${[...cartelle].join(', ')}` };
    }
    return { file };
}

// ── Validazione del corpo di una ricetta ──

/**
 * Campi senza i quali la ricetta non sta in piedi sul sito.
 * Volutamente meno dello schema completo: `validateRecipeSchema` boccia 3 delle
 * 80 ricette già pubblicate, e un salvataggio che rifiuta di scrivere una
 * ricetta esistente sarebbe peggio del problema che risolve.
 */
const CAMPI_MINIMI = ['title', 'slug', 'category', 'ingredientGroups', 'steps'];

function valoreVuoto(v) {
    return v === undefined || v === null
        || (typeof v === 'string' && v.trim() === '')
        || (Array.isArray(v) && v.length === 0);
}

/**
 * Vero se la riga è ancora completamente vuota, cioè lo stato in cui l'editor
 * la crea e la lascia finché non ci scrivi dentro.
 *
 * Serve a distinguere "non compilata" da "compilata a metà", ed è la differenza
 * fra un controllo utile e uno che blocca il lavoro normale: `addStep`
 * (`editor/editor-actions.js:56`) aggiunge `{title:'', text:''}`, `addIngredient`
 * (:29) e `addGroup` (:15) aggiungono `{name:'', grams:0, note:'', tokenId:''}`,
 * e `state.update()` schedula il salvataggio automatico dopo 1,5 s. Trattare
 * quelle righe come errori significava che bastava premere "+ Step" e fermarsi
 * un attimo per prendere un 400 — e finché la riga restava lì NIENTE si
 * salvava più, nemmeno le modifiche fatte altrove nella ricetta.
 *
 * Le righe riempite a metà (un titolo senza testo, dei grammi senza nome)
 * restano bloccanti: quelle sì che arriverebbero sul sito rotte.
 */
function rigaAncoraVuota(riga) {
    if (!riga || typeof riga !== 'object' || Array.isArray(riga)) return false;
    return Object.values(riga).every(v =>
        v === undefined || v === null || v === 0 || v === false
        || (typeof v === 'string' && v.trim() === '')
        || (Array.isArray(v) && v.length === 0)
    );
}

/**
 * Errori bloccanti di una ricetta in arrivo dall'editor.
 * I tipi li chiede a `RECIPE_FIELDS` (fonte unica dello schema), non a un
 * elenco riscritto qui.
 * @returns {Promise<string[]>} elenco vuoto = ricetta scrivibile
 */
export async function validaRicettaInArrivo(recipe) {
    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
        return ['il corpo della richiesta non contiene un oggetto "recipe"'];
    }

    const { RECIPE_FIELDS } = await import('../../recipe-schema.js');
    const errori = [];

    for (const campo of CAMPI_MINIMI) {
        if (valoreVuoto(recipe[campo])) errori.push(`campo obbligatorio mancante o vuoto: "${campo}"`);
    }

    for (const [campo, spec] of Object.entries(RECIPE_FIELDS)) {
        const v = recipe[campo];
        if (v === undefined || v === null) continue;
        const tipo = Array.isArray(v) ? 'array' : typeof v;
        if (tipo !== spec.type) errori.push(`"${campo}": tipo ${tipo}, atteso ${spec.type}`);
    }

    if (typeof recipe.slug === 'string' && recipe.slug && !slugValido(recipe.slug)) {
        errori.push(`"slug": "${recipe.slug}" non è kebab-case`);
    }

    // La categoria è l'unico campo su cui il sito ha un contratto vero: se non è
    // nel registry (`js/categories.js` via `constants.js`) la ricetta finisce in
    // una categoria che non esiste e `npm run check` del sito si ferma. Un
    // controllo di tipo "stringa non vuota" non se ne accorgeva: "Categoria Che
    // Non Esiste" passava e veniva scritta sul disco.
    if (typeof recipe.category === 'string' && recipe.category.trim()) {
        if (!cartellaCategoriaSeValida(recipe.category)) {
            errori.push(
                `"category": "${recipe.category}" non è una categoria del sito — attese: ${etichetteAmmesse().join(', ')}`
            );
        }
    }

    if (Array.isArray(recipe.steps)) {
        recipe.steps.forEach((s, i) => {
            if (rigaAncoraVuota(s)) return;
            if (!s || typeof s !== 'object' || typeof s.text !== 'string' || !s.text.trim()) {
                errori.push(`steps[${i}]: manca il testo del passaggio`);
            }
        });
    }

    if (Array.isArray(recipe.ingredientGroups)) {
        recipe.ingredientGroups.forEach((g, i) => {
            if (!g || typeof g !== 'object' || !Array.isArray(g.items)) {
                errori.push(`ingredientGroups[${i}]: gruppo senza ingredienti`);
                return;
            }
            // `items: []` è raggiungibile togliendo l'ultimo ingrediente di un
            // gruppo (`removeIngredient`) prima di cancellare il gruppo: è uno
            // stato di lavoro, non un corpo ostile. Finisce negli avvisi.
            g.items.forEach((it, j) => {
                if (rigaAncoraVuota(it)) return;
                if (!it || typeof it !== 'object' || typeof it.name !== 'string' || !it.name.trim()) {
                    errori.push(`ingredientGroups[${i}].items[${j}]: ingrediente senza nome`);
                }
            });
        });
    }

    return errori;
}

/**
 * Righe lasciate vuote nella ricetta: non bloccano il salvataggio (vedi
 * `rigaAncoraVuota`) ma vanno dette, altrimenti finiscono sul sito senza che
 * nessuno se ne accorga.
 * @returns {string[]}
 */
function avvisiRigheVuote(recipe) {
    const avvisi = [];
    const steps = Array.isArray(recipe?.steps) ? recipe.steps.filter(rigaAncoraVuota).length : 0;
    if (steps > 0) avvisi.push(`${steps} passagg${steps === 1 ? 'io' : 'i'} ancora vuot${steps === 1 ? 'o' : 'i'}: non compare sul sito.`);

    let ingredienti = 0;
    let gruppiVuoti = 0;
    if (Array.isArray(recipe?.ingredientGroups)) {
        for (const g of recipe.ingredientGroups) {
            if (!g || !Array.isArray(g.items)) continue;
            if (g.items.length === 0) { gruppiVuoti++; continue; }
            ingredienti += g.items.filter(rigaAncoraVuota).length;
        }
    }
    if (ingredienti > 0) avvisi.push(`${ingredienti} ingredient${ingredienti === 1 ? 'e' : 'i'} ancora senza nome: non compare sul sito.`);
    if (gruppiVuoti > 0) avvisi.push(`${gruppiVuoti} grupp${gruppiVuoti === 1 ? 'o' : 'i'} di ingredienti senza righe.`);
    return avvisi;
}

/**
 * Avvisi NON bloccanti: quello che lo schema completo segnala ma che non
 * giustifica il rifiuto di un salvataggio (le ricette storiche ne hanno).
 */
async function avvisiSchema(recipe, slugFile) {
    try {
        const { validateRecipeSchema } = await import('../../recipe-schema.js');
        const { errors, warnings } = validateRecipeSchema(recipe);
        const avvisi = [...avvisiRigheVuote(recipe), ...errors, ...warnings];
        if (typeof recipe?.slug === 'string' && recipe.slug !== slugFile) {
            avvisi.unshift(`Lo slug della ricetta ("${recipe.slug}") non è il nome del file ("${slugFile}"): il file NON viene rinominato.`);
        }
        return avvisi.slice(0, 20);
    } catch {
        return [];
    }
}

// ── Versione del file su disco (rilevamento conflitti) ──

/**
 * Impronta della versione di una ricetta come sta ADESSO sul disco.
 *
 * Serve al rilevamento dei conflitti del salvataggio: la GET la restituisce
 * insieme alla ricetta, il PATCH la riceve indietro e la confronta con quella
 * del file che sta per sovrascrivere. Se non coincidono, fra l'apertura e il
 * salvataggio qualcun altro ha riscritto il file (una seconda scheda
 * dell'editor, un Fix AI dal pannello qualità, una rigenerazione) e scrivere
 * cancellerebbe il suo lavoro senza dirlo a nessuno.
 *
 * È un valore OPACO: lo calcola solo il server, il client si limita a
 * rimandarlo. Così non esiste una seconda implementazione dell'algoritmo nel
 * browser da tenere allineata a questa — il controllo lato client in
 * `editor/editor-state.js` ha una sua impronta, ma è la sua, e le due non si
 * devono somigliare.
 *
 * Si calcola sui BYTE del file, non sulla ricetta interpretata: qualsiasi
 * riscrittura conta come cambiamento, anche una che tocca solo la formattazione.
 * È il verso giusto in cui sbagliare — un conflitto di troppo si risolve con un
 * clic, un conflitto mancato è lavoro perso.
 *
 * @param {string|Buffer} contenuto - il file così com'è stato letto
 * @returns {string} 16 caratteri esadecimali
 */
export function improntaVersione(contenuto) {
    return createHash('sha256').update(contenuto ?? '', 'utf-8').digest('hex').slice(0, 16);
}

// ── Validazione degli URL da scaricare ──

/**
 * Vero se l'indirizzo IP (già in forma letterale) non esce dalla macchina o
 * dalla rete locale. Vale sia per un host scritto nell'URL sia per un indirizzo
 * restituito dal DNS: è la stessa tabella, applicata due volte apposta.
 * @param {string} indirizzo - host già in minuscolo, senza parentesi quadre né punti finali
 * @returns {boolean}
 */
function indirizzoInterno(indirizzo) {
    // IPv4: loopback, reti private, link-local (compreso 169.254.169.254, i
    // metadati cloud), CGNAT e multicast.
    const v4 = indirizzo.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
        const a = Number(v4[1]);
        const b = Number(v4[2]);
        return a === 0 || a === 127 || a === 10
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 169 && b === 254)
            || (a === 100 && b >= 64 && b <= 127)
            || a >= 224;
    }

    // IPv6: ULA (fc00::/7), link-local (fe80::/10) e tutto ciò che comincia per
    // `::` — cioè loopback (::1), indirizzo non specificato e gli IPv4 mappati
    // (`::ffff:127.0.0.1`, che Node normalizza in `::ffff:7f00:1` e che senza
    // questo controllo scavalcherebbe il blocco degli IPv4 privati).
    if (indirizzo.includes(':')) {
        if (indirizzo.startsWith('::') || /^f[cd]/.test(indirizzo) || /^fe[89ab]/.test(indirizzo)) return true;
        // IPv4 mappato scritto per esteso: ::ffff:192.168.1.1
        const mappato = indirizzo.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
        if (mappato) return indirizzoInterno(mappato[1]);
    }

    return false;
}

/** Host dell'URL, normalizzato per il confronto. `null` se l'URL non è utilizzabile. */
function hostNormalizzato(u) {
    // I punti finali vanno via PRIMA di qualsiasi confronto. Node normalizza il
    // punto finale solo negli IPv4: nei nomi host lo conserva, quindi
    // `new URL('http://localhost./').hostname` vale "localhost." — diverso da
    // "localhost", con un punto dentro (quindi supera anche il controllo sui
    // nomi senza punti) e non finisce per ".local". Passava, e il DNS lo
    // risolve lo stesso (`dns.lookup('localhost.')` → ::1): bastava un punto
    // per farsi scaricare il pannello del router. Si tolgono TUTTI i punti
    // finali, non uno: anche "192.168.1.1.." si scriveva senza essere visto.
    return u.hostname.toLowerCase()
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .replace(/\.+$/, '');
}

/**
 * Controllo sulla FORMA dell'URL: protocollo e host scritto nell'indirizzo.
 *
 * Non risolve il DNS, quindi da sola NON garantisce che l'URL punti fuori dalla
 * rete: `http://localtest.me/` e `http://127.0.0.1.nip.io/` sono nomi pubblici
 * che il DNS risolve in 127.0.0.1 e che qui passano. Per il controllo vero usa
 * `urlNonAmmessoRisolto()`, che è quello che chiama la rotta.
 *
 * Resta separata perché è sincrona e senza effetti: serve a scartare subito le
 * forme impossibili prima di spendere una risoluzione DNS.
 *
 * @returns {string|null} il motivo del rifiuto, oppure null se la forma va bene
 */
export function urlNonAmmesso(valore) {
    let u;
    try {
        u = new URL(String(valore));
    } catch {
        return `URL non valido: "${valore}"`;
    }

    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return `Protocollo non ammesso (${u.protocol}) in "${valore}"`;
    }

    const host = hostNormalizzato(u);
    if (!host) return `URL senza indirizzo: "${valore}"`;

    // Nomi che non escono dalla rete locale (compreso "router", senza punti).
    if (host === 'localhost' || (!host.includes('.') && !host.includes(':'))) {
        return `Indirizzo interno non ammesso: "${host}"`;
    }
    if (/\.(localhost|local|internal|home|lan|intranet)$/.test(host)) {
        return `Indirizzo interno non ammesso: "${host}"`;
    }

    if (indirizzoInterno(host)) return `Indirizzo di rete locale non ammesso: "${host}"`;

    return null;
}

/**
 * Controllo completo prima di dare un URL allo scraper: forma **e** indirizzo a
 * cui si arriva davvero.
 *
 * Il nome scritto nell'URL non dice dove si finisce. `localtest.me` e
 * `127.0.0.1.nip.io` sono domini pubblici che risolvono in 127.0.0.1: con il
 * solo controllo sulla stringa il server apriva un servizio in ascolto sulla
 * macchina e ne rimandava il testo nel log del job. Qui l'host viene risolto
 * con `dns.lookup(..., {all: true})` e OGNI indirizzo restituito passa per la
 * stessa tabella di reti private: ne basta uno interno per rifiutare.
 *
 * **Quello che questo controllo NON copre** (scritto qui perché la promessa
 * "punta fuori dalla tua rete" era falsa e ha già ingannato una revisione):
 * - **I redirect.** `src/scraper.js` scarica con `fetch(url)` (riga 12) e, se
 *   il contenuto non basta, riapre l'URL con Chrome headless (`page.goto`,
 *   riga 134): tutti e due seguono i 3xx da soli, e qui si vede solo il primo
 *   salto. Un URL pubblico che risponde 302 verso `http://127.0.0.1:PORTA/`
 *   arriva lo stesso a destinazione — e gli URL del batch vengono dai risultati
 *   di ricerca di `/api/scopri`, cioè da terzi. La chiusura va fatta in
 *   `scraper.js`, che non è di questo modulo: `fetch(url, {redirect:'manual'})`
 *   ri-validando il `Location` a ogni salto, e per il ramo Chrome
 *   `--host-resolver-rules` oppure `page.setRequestInterception(true)` con
 *   questo stesso guardiano.
 * - **Il riaggancio DNS.** Fra questa risoluzione e quella che farà lo scraper
 *   passa del tempo: un nome che risponde prima pubblico e poi interno
 *   scavalca il controllo. Si chiude solo dove si apre la connessione, cioè
 *   sempre in `scraper.js`.
 *
 * Un nome che non si risolve NON viene rifiutato: non raggiunge niente, e
 * bocciarlo qui farebbe fallire in blocco un batch per un solo URL morto —
 * esattamente il comportamento che la gestione per-URL di `/api/genera` ha
 * appena tolto di mezzo. Fallisce da solo nello scraper, con il suo messaggio.
 *
 * @returns {Promise<string|null>} il motivo del rifiuto, oppure null se va bene
 */
export async function urlNonAmmessoRisolto(valore) {
    const perForma = urlNonAmmesso(valore);
    if (perForma) return perForma;

    const host = hostNormalizzato(new URL(String(valore)));

    // Un indirizzo letterale è già stato controllato da `urlNonAmmesso`: la
    // risoluzione non aggiungerebbe niente. Il confronto è sulla forma ESATTA di
    // un IPv4 (quattro ottetti ≤ 255) e non su "solo cifre e punti": un nome
    // come `1.2.3.4.5` è fatto di cifre e punti ma è un nome, e va risolto.
    const ipv4Letterale = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (ipv4Letterale && ipv4Letterale.slice(1).every(o => Number(o) <= 255)) return null;
    if (host.includes(':')) return null; // IPv6 letterale: i nomi non contengono ":"

    let indirizzi;
    try {
        indirizzi = await lookup(host, { all: true });
    } catch {
        return null; // nome che non si risolve: vedi il JSDoc
    }

    for (const { address } of indirizzi) {
        if (indirizzoInterno(String(address).toLowerCase())) {
            return `"${host}" si risolve in un indirizzo della rete locale (${address}): non viene aperto`;
        }
    }
    return null;
}

export function setupRecipeRoutes(app, { getRicettarioPath, nextJobId, createJobContext, withOutputCapture }) {

    // ── Ricette: lista tutte ──
    app.get('/api/ricette', (req, res) => {
        try {
            const ricettarioPath = getRicettarioPath();
            const recipesJsonPath = resolve(ricettarioPath, 'public', 'recipes.json');

            if (existsSync(recipesJsonPath)) {
                const data = JSON.parse(readFileSync(recipesJsonPath, 'utf-8'));
                // recipes.json può essere un oggetto {recipes: [...]} oppure un array
                const recipesArr = Array.isArray(data) ? data : (data.recipes || []);
                return res.json(recipesArr);
            }

            // Fallback: scan filesystem per JSON
            const ricettePath = resolve(ricettarioPath, 'ricette');
            const recipes = [];

            if (existsSync(ricettePath)) {
                for (const cat of readdirSync(ricettePath)) {
                    const catDir = resolve(ricettePath, cat);
                    if (!statSync(catDir).isDirectory()) continue;

                    for (const file of readdirSync(catDir)) {
                        // "questo .json è una ricetta o un file di lavoro?" —
                        // stessa domanda, una risposta sola (`percorsi-ricette.js`).
                        // Qui c'era la quarta variante della regola.
                        if (eFileDiRicetta(file)) {
                            try {
                                const data = JSON.parse(readFileSync(resolve(catDir, file), 'utf-8'));
                                const slug = slugDaNomeFile(file);
                                recipes.push({
                                    slug,
                                    title: data.title,
                                    category: data.category || cat,
                                    categoryDir: cat,
                                    href: `ricette/${cat}/${slug}`,
                                    hydration: data.hydration,
                                    image: data.image,
                                    date: data.date,
                                    _generatedBy: data._generatedBy || null,
                                });
                            } catch {}
                        }
                    }
                }
            }

            res.json(recipes);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Ricetta singola: GET (per editor) ──
    app.get('/api/ricetta/:cat/:slug', async (req, res) => {
        try {
            const { cat, slug } = req.params;
            const ricettarioPath = getRicettarioPath();

            const percorso = await risolviPercorsoRicetta(ricettarioPath, cat, slug);
            if (percorso.errore) return res.status(400).json({ error: percorso.errore });
            const jsonFile = percorso.file;

            if (!existsSync(jsonFile)) {
                return res.status(404).json({ error: `Ricetta non trovata: ${cat}/${slug}` });
            }

            // `versione` è l'impronta del file letto adesso: il client la
            // rimanda nel PATCH e il server rifiuta con 409 se nel frattempo il
            // file è cambiato (vedi `improntaVersione`).
            const contenuto = readFileSync(jsonFile, 'utf-8');
            const recipe = JSON.parse(contenuto);
            res.json({ recipe, cat, slug, path: jsonFile, versione: improntaVersione(contenuto) });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Ricetta singola: PATCH (salvataggio editor) ──
    app.patch('/api/ricetta/:cat/:slug', async (req, res) => {
        try {
            const { cat, slug } = req.params;
            const { recipe: updatedRecipe, autoRegen, versione, forzaScrittura } = req.body || {};
            const ricettarioPath = getRicettarioPath();

            const percorso = await risolviPercorsoRicetta(ricettarioPath, cat, slug);
            if (percorso.errore) return res.status(400).json({ error: percorso.errore });
            const jsonFile = percorso.file;

            if (!existsSync(jsonFile)) {
                return res.status(404).json({ error: `Ricetta non trovata: ${cat}/${slug}` });
            }

            // Prima di toccare il file del sito: quello che arriva deve essere una
            // ricetta, non "qualunque cosa ci fosse nel body".
            const errori = await validaRicettaInArrivo(updatedRecipe);
            if (errori.length > 0) {
                return res.status(400).json({
                    error: `Ricetta non valida, salvataggio annullato: ${errori[0]}`,
                    errori,
                });
            }

            const originalContent = readFileSync(jsonFile, 'utf-8');
            const versioneDisco = improntaVersione(originalContent);

            // ── Rilevamento conflitti ──
            // Il PATCH è una scrittura secca: due schede aperte sulla stessa
            // ricetta (o un Fix AI lanciato dal pannello qualità mentre
            // l'editor è aperto) si sovrascrivono a vicenda, e chi salva per
            // ultimo cancella il lavoro dell'altro in silenzio. Il controllo
            // che l'editor fa da solo — rileggere e confrontare prima di
            // inviare — lascia aperta la finestra fra quella lettura e questa
            // scrittura: qui invece il confronto avviene sul file che stiamo
            // per sovrascrivere, un attimo prima di sovrascriverlo.
            //
            // TOLLERANTE PER SCELTA: se `versione` non arriva (client vecchio,
            // chiamata da script) si scrive come si è sempre fatto. Rifiutare i
            // salvataggi senza impronta vorrebbe dire rompere l'editor finché
            // il client non è aggiornato, cioè perdere lavoro per proteggerlo.
            const versioneAttesa = typeof versione === 'string' ? versione.trim() : '';
            if (versioneAttesa && !forzaScrittura && versioneAttesa !== versioneDisco) {
                let recipeDisco = null;
                try { recipeDisco = JSON.parse(originalContent); } catch {}
                return res.status(409).json({
                    error: 'La ricetta è cambiata sul disco dopo che l\'hai aperta: salvando adesso cancelleresti quelle modifiche.',
                    conflitto: true,
                    versione: versioneDisco,
                    recipeDisco,
                });
            }

            // Copia di sicurezza PRIMA di sovrascrivere, e FUORI dal repo del
            // sito: qui si scriveva `<slug>.pre-edit.json` accanto alla
            // ricetta, ed era il produttore più frequente degli 86 file di
            // backup che sporcano il repo del sito (dove ogni cartella dentro
            // `ricette/` è per contratto una categoria). Adesso la destinazione
            // è `tools/data/backup-ricette/<slug>/`, con una copia per
            // operazione e la rotazione a 5.
            let copia = null;
            try {
                copia = salvaCopiaSicurezza(jsonFile, originalContent, 'pre-edit');
            } catch (err) {
                // Non si sovrascrive una ricetta di cui non si è riusciti a
                // conservare la versione precedente: meglio un salvataggio che
                // fallisce e lo dice, con il testo ancora a schermo.
                return res.status(500).json({
                    error: `Copia di sicurezza non riuscita, salvataggio annullato: ${err.message}`,
                });
            }

            // Salva il JSON aggiornato
            const nuovoContenuto = JSON.stringify(updatedRecipe, null, 2);
            writeFileSync(jsonFile, nuovoContenuto, 'utf-8');

            // Sync cards (aggiorna recipes.json) — NO rigenerazione HTML (il sito è una SPA)
            let syncOk = false;
            if (autoRegen) {
                try {
                    const { syncCards } = await import('../../commands/sync-cards.js');
                    await syncCards({});
                    syncOk = true;
                } catch (syncErr) {
                    console.error(`[PATCH] Sync cards fallito: ${syncErr.message}`);
                }
            }

            res.json({
                ok: true,
                slug,
                cat,
                syncOk,
                // La versione del file appena scritto: il client la tiene e la
                // rimanda al salvataggio successivo, senza dover rileggere.
                versione: improntaVersione(nuovoContenuto),
                backup: copia ? copia.percorsoRelativo : null,
                avvisi: await avvisiSchema(updatedRecipe, slug),
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Genera da nome o url(s) ──
    app.post('/api/genera', async (req, res) => {
        const { nome, url, urls, tipo, note, noImage, preview, aiModel, keepExisting } = req.body || {};

        const isBatch = Array.isArray(urls) && urls.length > 0;
        const targetUrls = isBatch ? urls : (url ? [url] : []);

        // Gli URL vengono aperti con Chrome headless e il testo torna nel log del
        // job: si scaricano solo indirizzi pubblici. Il controllo risolve il
        // nome, non si ferma alla stringa (vedi `urlNonAmmessoRisolto`).
        let urlRifiutati;
        try {
            urlRifiutati = (await Promise.all(targetUrls.map(u => urlNonAmmessoRisolto(u)))).filter(Boolean);
        } catch (err) {
            return res.status(400).json({ error: `Controllo degli URL non riuscito: ${err.message}` });
        }
        if (urlRifiutati.length > 0) {
            return res.status(400).json({ error: urlRifiutati.join(' · ') });
        }
        if (!nome && targetUrls.length === 0) {
            return res.status(400).json({ error: 'Serve un nome ricetta oppure almeno un URL' });
        }

        const jobId = nextJobId('gen');
        let jobName = '';
        if (nome) jobName = `Genera: ${nome}`;
        else if (isBatch) jobName = `Scraping: ${targetUrls.length} ricette`;
        else jobName = `Scraping: ${url}`;
        
        const ctx = createJobContext(jobId, jobName);
        res.json({ jobId, status: 'started' });

        try {
            const { genera } = await import('../../commands/genera.js');
            const falliti = [];
            let riuscite = 0;

            await withOutputCapture(ctx, async () => {
                if (nome) {
                    const args = { nome };
                    if (tipo) args.tipo = tipo;
                    if (note) args.note = note;
                    if (noImage) args['no-image'] = true;
                    if (aiModel) args.aiModel = aiModel;
                    if (keepExisting) args.keepExisting = true;
                    await genera(args);
                } else if (targetUrls.length > 0) {
                    if (isBatch) ctx.log(`🔄 Avvio batch scraping su ${targetUrls.length} URL...\n`);
                    for (const u of targetUrls) {
                        const args = { url: u };
                        if (tipo) args.tipo = tipo;
                        if (note) args.note = note;
                        if (noImage) args['no-image'] = true;
                        if (aiModel) args.aiModel = aiModel;
                        if (keepExisting) args.keepExisting = true;

                        if (isBatch) ctx.log(`\n🔜 Processo: ${u}...`);
                        try {
                            await genera(args);
                            riuscite++;
                        } catch (err) {
                            // Nel batch un URL rotto non deve portarsi via gli altri:
                            // è lo stesso comportamento della versione da riga di
                            // comando (`commands/scopri.js`).
                            if (!isBatch) throw err;
                            falliti.push({ url: u, messaggio: err.message });
                            ctx.error(`  ❌ ${u}: ${err.message}`);
                            ctx.log('  ➡️ Passo alla prossima.\n');
                        }
                    }

                    if (isBatch) {
                        ctx.log(`\n📋 Batch concluso: ${riuscite} su ${targetUrls.length} riuscite.`);
                        if (falliti.length > 0) {
                            ctx.log(`⚠️ Non riuscite (${falliti.length}):`);
                            for (const f of falliti) ctx.log(`   • ${f.url} — ${f.messaggio}`);
                        }
                    }
                }
            });
            ctx.end(falliti.length === 0);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Genera da testo ──
    app.post('/api/testo', async (req, res) => {
        const { text, tipo, aiModel } = req.body;
        const jobId = nextJobId('txt');
        const ctx = createJobContext(jobId, `Testo: ${(text || '').substring(0, 40)}...`);
        res.json({ jobId, status: 'started' });

        try {
            // Salva il testo in un file temporaneo
            const tmpFile = resolve(process.cwd(), 'data', '_tmp_testo.txt');
            writeFileSync(tmpFile, text, 'utf-8');

            const { testo } = await import('../../commands/testo.js');
            const args = { testo: tmpFile };
            if (tipo) args.tipo = tipo;
            if (aiModel) args.aiModel = aiModel;

            await withOutputCapture(ctx, () => testo(args));
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Scopri ricette ──
    app.post('/api/scopri', async (req, res) => {
        const { query, quante } = req.body;
        const jobId = nextJobId('scp');
        const ctx = createJobContext(jobId, `Scopri: ${query}`);
        res.json({ jobId, status: 'started' });

        try {
            const { scopri } = await import('../../commands/scopri.js');
            await withOutputCapture(ctx, () => scopri({ scopri: query, quante: String(quante || 5) }));
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Scopri ricette (M-UI Synchronous REST endpoint) ──
    app.post('/api/scopri-search', async (req, res) => {
        const { query, quante } = req.body;
        try {
            const { discoverRecipes } = await import('../../discovery.js');
            const results = await discoverRecipes(query, Number(quante) || 10);
            res.json({ results });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Sync Cards ──
    app.post('/api/sync-cards', async (req, res) => {
        const jobId = nextJobId('sync');
        const ctx = createJobContext(jobId, 'Sync Cards');
        res.json({ jobId, status: 'started' });

        try {
            const { syncCards } = await import('../../commands/sync-cards.js');
            await withOutputCapture(ctx, () => syncCards({}));
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Elimina Ricetta ──
    app.post('/api/elimina', async (req, res) => {
        const { slugs } = req.body || {};
        if (!Array.isArray(slugs) || slugs.length === 0) {
            return res.status(400).json({ error: 'Nessun slug fornito' });
        }
        const slugNonValidi = slugs.filter(s => !slugValido(s));
        if (slugNonValidi.length > 0) {
            return res.status(400).json({
                error: `Slug non validi: ${slugNonValidi.map(s => `"${String(s).substring(0, 60)}"`).join(', ')}`,
            });
        }

        const jobId = nextJobId('del');
        const ctx = createJobContext(jobId, `Elimina: ${slugs.length} ricette`);
        res.json({ jobId, status: 'started' });

        try {
            const { CATEGORY_FOLDERS } = await import('../../constants.js');
            const ricettarioPath = getRicettarioPath();

            await withOutputCapture(ctx, async () => {
                ctx.log(`🗑️ Eliminazione di ${slugs.length} ricett${slugs.length === 1 ? 'a' : 'e'}...\n`);
                let deleted = 0;

                for (const slug of slugs) {
                    // Trova la cartella categoria
                    let found = false;
                    for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
                        const jsonFile = percorsoRicetta(folder, slug, { ricettarioPath });
                        const htmlFile = percorsoRicetta(folder, slug, { ricettarioPath, estensione: '.html' });
                        if (!existsSync(jsonFile) && !existsSync(htmlFile)) continue;
                        found = true;

                        // ── Pulisci used-images.json ──
                        // Passa dall'indice condiviso (`utils/indice-immagini.js`),
                        // che prende il lock e toglie TUTTE le voci di questa
                        // ricetta: leggerlo e riscriverlo qui a mano guardando
                        // solo `_originalImageUrl` lasciava bloccati gli URL
                        // delle immagini sostituite lungo la vita della ricetta.
                        try {
                            const { rimossi, totale } = await liberaUrlDiRicetta(slug);
                            if (rimossi.length > 0) {
                                ctx.log(`  🖼️ Liberat${rimossi.length === 1 ? 'o' : 'i'} ${rimossi.length} URL in used-images.json (${totale} voci)`);
                            }
                        } catch (e) {
                            ctx.log(`  ⚠️ used-images.json non aggiornato: ${e.message}`);
                        }

                        // Cancella tutti i file associati.
                        // I `.pre-edit.json` / `.pre-gen.json` / `.backup.json`
                        // accanto alla ricetta NON vengono più prodotti (le
                        // copie di sicurezza stanno in
                        // `tools/data/backup-ricette/<slug>/`), ma restano gli
                        // 86 residui già finiti nel repo del sito: se ce n'è uno
                        // di questa ricetta se ne va con lei, altrimenti
                        // sopravvive alla ricetta che avrebbe dovuto proteggere.
                        // Le copie in `tools/data/backup-ricette/` si tengono
                        // apposta: sono l'unico modo di tornare indietro da una
                        // cancellazione sbagliata.
                        const filesToDelete = [
                            ...['.json', '.html', '.validazione.md', '.verifica.md', '.qualita.md',
                                '.backup.json', '.pre-edit.json', '.pre-gen.json', '.qualita.json']
                                .map(estensione => percorsoRicetta(folder, slug, { ricettarioPath, estensione })),
                            ...['.webp', '.avif']
                                .map(estensione => percorsoImmagineRicetta(folder, slug, { ricettarioPath, estensione })),
                        ];

                        for (const f of filesToDelete) {
                            try {
                                if (existsSync(f)) {
                                    unlinkSync(f);
                                    ctx.log(`  ✅ ${f.split(/[/\\]/).pop()}`);
                                }
                            } catch (e) {
                                ctx.log(`  ⚠️ ${f.split(/[/\\]/).pop()}: ${e.message}`);
                            }
                        }

                        deleted++;
                        ctx.log(`  🗑️ "${slug}" eliminata da ${cat}\n`);
                        break;
                    }

                    if (!found) {
                        ctx.log(`  ⚠️ ${slug}: non trovata\n`);
                    }
                }

                // Sync cards per aggiornare recipes.json — solo se qualcosa è
                // stato davvero cancellato. Girava anche quando nessuno slug
                // era stato trovato: il log diceva «non trovata» e subito dopo
                // rigenerava `public/recipes.json` del sito, cioè una
                // riscrittura del repo del sito per una richiesta che non
                // aveva cambiato niente.
                if (deleted > 0) {
                    ctx.log('🔄 Aggiornamento recipes.json...');
                    const { syncCards } = await import('../../commands/sync-cards.js');
                    await syncCards({});
                }

                // Rimuovi entry fantasma da quality-index.json
                try {
                    const { loadQualityIndex, saveQualityIndex } = await import('../../quality.js');
                    const qi = loadQualityIndex();
                    let cleaned = false;
                    for (const s of slugs) {
                        if (qi[s]) { delete qi[s]; cleaned = true; }
                    }
                    if (cleaned) {
                        saveQualityIndex(qi);
                        ctx.log('📊 quality-index.json aggiornato');
                    }
                } catch {}

                if (deleted === 0) ctx.log('\n🤷 Nessuna ricetta eliminata: niente da aggiornare.');
                else ctx.log(`\n🎉 Eliminat${deleted === 1 ? 'a' : 'e'} ${deleted} ricett${deleted === 1 ? 'a' : 'e'}`);
            });

            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });
}
