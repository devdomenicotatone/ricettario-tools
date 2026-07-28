/**
 * BACKUP RICETTE — l'unico posto da cui nasce una copia di sicurezza
 *
 * Ogni volta che la dashboard sta per sovrascrivere il JSON di una ricetta nel
 * repo del sito (fix AI, profilo sensoriale, salvataggio dell'editor,
 * rigenerazione), la copia di quello che c'era prima passa DA QUI.
 *
 * ── Perché un modulo solo ──
 *
 * Prima ne convivevano tre, con convenzioni incompatibili:
 *
 *   - `routes/quality.js`  → `tools/data/backup-ricette/<slug>/<op>-<data>.json`
 *                            (per ricetta, con la data nel nome, rotazione a 5)
 *   - `publisher.js`       → `tools/data/backup-ricette/<categoria>/<slug>.pre-gen.json`
 *                            (per CATEGORIA e a slot unico: stessa cartella,
 *                             schema diverso, nessuna rotazione)
 *   - `routes/recipes.js`  → `ricette/<cat>/<slug>.pre-edit.json`
 *                            (slot unico DENTRO il repo del sito)
 *
 * Due schemi diversi nella stessa cartella vogliono dire che la potatura
 * dell'uno non riconosce i file dell'altro, e che per sapere dov'è finita una
 * copia bisogna sapere quale codice l'ha scritta. Il terzo è peggio: è il
 * produttore più frequente degli 86 file di backup che oggi sporcano il repo
 * del sito, 80 dei quali tracciati da git.
 *
 * ── La convenzione (una sola) ──
 *
 *   tools/data/backup-ricette/<slug>/<operazione>-<data-ora>-<nn>.json
 *
 *   - **una cartella per ricetta**, non per categoria: la categoria di una
 *     ricetta può cambiare, lo slug no, ed è lo slug che si cerca quando si va
 *     a ripescare una copia;
 *   - **l'operazione nel nome**, così `fix-ai` e `sensoriale` non si cancellano
 *     a vicenda come facevano quando condividevano `<slug>.backup.json`;
 *   - **la data nel nome**, ordinabile alfabeticamente: l'ultima copia è
 *     l'ultimo nome;
 *   - **rotazione a {@link MAX_COPIE_PER_OPERAZIONE} per operazione**: le copie
 *     servono a tornare indietro di poco, non a fare da archivio.
 *
 * ── Regola non negoziabile ──
 *
 * **Nessun backup finisce nel repo del sito.** Là dentro ogni cartella dentro
 * `ricette/` è per contratto una categoria (`npm run check` si ferma su una
 * cartella non dichiarata in `js/categories.js`) e ogni file non escluso finisce
 * online: il sito scarta solo `/\.(backup|pre-edit)\.json$/`
 * (`scripts/build-recipes.js:23`), quindi un `<slug>.pre-gen.json` verrebbe
 * letto come una ricetta vera e bloccherebbe la pubblicazione.
 *
 * Qui la garanzia è strutturale, non una raccomandazione: la destinazione si
 * costruisce SEMPRE sotto {@link CARTELLA_COPIE}, e il percorso della ricetta
 * serve solo a ricavarne lo slug.
 */

import { resolve, basename, relative } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';

import { scriviJsonAtomico } from '../server/routes/_helpers.js';
import { log } from './logger.js';

/** Radice del repo tools/ (questo file sta in `src/utils/`) */
const RADICE_TOOLS = resolve(import.meta.dirname, '..', '..');

/** Cartella unica delle copie di sicurezza: fuori dal repo del sito e fuori da git. */
export const CARTELLA_COPIE = resolve(RADICE_TOOLS, 'data', 'backup-ricette');

/** Quante copie si tengono per ogni ricetta E per ogni operazione. */
export const MAX_COPIE_PER_OPERAZIONE = 5;

/**
 * Le operazioni previste. Non è un vincolo: un nome fuori da questo elenco
 * viene accettato lo stesso (purché fatto di lettere minuscole, cifre e
 * trattini) perché rifiutarlo vorrebbe dire far fallire un salvataggio per un
 * nome, ma finisce a log — un refuso creerebbe in silenzio una seconda serie
 * con una sua rotazione indipendente, e la copia "vecchia" non verrebbe mai
 * potata.
 */
export const OPERAZIONI = Object.freeze(['fix-ai', 'sensoriale', 'nutrizione', 'pre-edit', 'pre-gen']);

/** Nomi ammessi per l'operazione: entra nel nome del file e in una RegExp. */
const OPERAZIONE_VALIDA = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Nomi utilizzabili come cartella della copia: `basename` toglie già le
 * cartelle, questo ferma `..` e i nomi vuoti.
 *
 * NON è `slugValido` di `percorsi-ricette.js`, ed è di proposito: quella
 * risponde a «questo slug rispetta la convenzione del sito?» e serve a
 * rifiutare una richiesta, questa risponde a «questo nome è sicuro come nome di
 * cartella?». Una ricetta con un nome fuori convenzione va comunque copiata
 * prima di sovrascriverla — anzi, è proprio quella che conviene non perdere.
 */
const SLUG_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Crea la cartella delle copie e ci mette dentro un `.gitignore` con `*`, che
 * esclude da git tutto il contenuto (compreso se stesso).
 *
 * Non è un vezzo: `deploy.bat` fa `git add -A` anche dentro `tools/`, quindi
 * senza questa regola ogni fix e ogni profilo sensoriale metterebbe una copia
 * della ricetta nell'indice di git — cioè lo stesso guasto che queste copie
 * dovevano togliere di mezzo, spostato da un repo all'altro e moltiplicato per
 * cinque. Una riga in `tools/.gitignore` farebbe lo stesso lavoro, ma vive in
 * un file che si può riscrivere senza sapere che esiste questa cartella: qui
 * la garanzia nasce insieme alla cartella, prima che ci finisca dentro il
 * primo file.
 */
function cartellaFuoriDaGit(cartella) {
    mkdirSync(cartella, { recursive: true });
    const regola = resolve(cartella, '.gitignore');
    if (!existsSync(regola)) {
        writeFileSync(regola, '# Copie di sicurezza delle ricette: usa-e-getta, mai da committare.\n*\n', 'utf-8');
    }
}

/**
 * Scrive la copia sul disco.
 *
 * Passa da `scriviJsonAtomico` (tmp + rename) invece di scrivere diretto: una
 * copia di sicurezza troncata a metà da un'interruzione è peggio di nessuna
 * copia, perché sembra esserci. Quella funzione serializza un oggetto, quindi
 * il testo letto dal disco viene prima interpretato: la ricetta viene
 * ri-scritta con lo stesso formato con cui il sito e la dashboard la scrivono
 * (`JSON.stringify(dati, null, 2)`), quindi per una ricetta vera i byte
 * coincidono con l'originale.
 *
 * Se il testo NON è JSON valido — ed è proprio il caso in cui la copia serve di
 * più — non si perde niente e non si inventa niente: si salvano i byte così
 * com'erano, rinunciando all'atomicità (vedi la nota in `fileDiAltriDaAggiornare`
 * su un `scriviTestoAtomico` in `_helpers.js`).
 */
function scriviCopia(percorso, contenuto) {
    if (typeof contenuto !== 'string') {
        scriviJsonAtomico(percorso, contenuto);
        return;
    }
    let dati;
    try {
        dati = JSON.parse(contenuto);
    } catch {
        writeFileSync(percorso, contenuto, 'utf-8');
        return;
    }
    scriviJsonAtomico(percorso, dati);
}

/**
 * Salva una copia di sicurezza della ricetta prima di sovrascriverla.
 *
 * @param {string} jsonFile - Percorso del JSON della ricetta (serve per lo slug;
 *        se `contenuto` non viene passato, si legge da qui)
 * @param {string|object|null} [contenuto] - Contenuto originale, così com'era sul
 *        disco (testo o oggetto già interpretato). Omesso o `null`: lo legge da
 *        `jsonFile`, e se il file non esiste non c'è niente da copiare.
 * @param {string} operazione - `'fix-ai' | 'sensoriale' | 'pre-edit' | 'pre-gen'`
 *        (vedi {@link OPERAZIONI}): finisce nel nome del file ed è la chiave
 *        della rotazione.
 * @returns {{percorso: string, percorsoRelativo: string}|null} percorso assoluto
 *        della copia (per rimetterla al suo posto) e percorso relativo alla
 *        radice di `tools/` con le barre in avanti (per mostrarlo all'utente).
 *        `null` quando non c'era niente da copiare.
 * @throws {Error} se lo slug o l'operazione non sono utilizzabili, o se la
 *        scrittura fallisce. È voluto: chi sta per sovrascrivere una ricetta
 *        deve poter decidere di fermarsi. Chi invece vuole proseguire lo stesso
 *        (la generazione, che ha già una copia in memoria) lo avvolge nel suo
 *        `try/catch`.
 *
 * @example
 *   const originale = readFileSync(jsonFile, 'utf-8');
 *   const copia = salvaCopiaSicurezza(jsonFile, originale, 'pre-edit');
 *   writeFileSync(jsonFile, JSON.stringify(ricettaAggiornata, null, 2), 'utf-8');
 *   if (copia) log.info(`🛟 Copia di sicurezza: ${copia.percorsoRelativo}`);
 *
 * @example
 *   // Senza contenuto: lo legge dal file, e restituisce null se non c'è.
 *   const copia = salvaCopiaSicurezza(jsonFile, null, 'pre-gen');
 *   // ...più tardi, per annullare:
 *   if (copia) copyFileSync(copia.percorso, jsonFile);
 */
export function salvaCopiaSicurezza(jsonFile, contenuto, operazione) {
    if (!OPERAZIONE_VALIDA.test(String(operazione ?? ''))) {
        throw new Error(
            `salvaCopiaSicurezza: operazione non valida (${operazione}). ` +
            `Attese: ${OPERAZIONI.join(', ')}.`
        );
    }
    if (!OPERAZIONI.includes(operazione)) {
        log.warn(`Copia di sicurezza con operazione fuori elenco: "${operazione}" (attese: ${OPERAZIONI.join(', ')}). La rotazione la tratta come una serie a sé.`);
    }

    const slug = basename(String(jsonFile ?? ''), '.json');
    if (!SLUG_VALIDO.test(slug)) {
        throw new Error(`salvaCopiaSicurezza: nome ricetta non utilizzabile (${jsonFile}).`);
    }

    let daSalvare = contenuto;
    if (daSalvare === undefined || daSalvare === null) {
        if (!existsSync(jsonFile)) return null; // niente da copiare: è il primo salvataggio
        daSalvare = readFileSync(jsonFile, 'utf-8');
    }

    cartellaFuoriDaGit(CARTELLA_COPIE);
    const cartella = resolve(CARTELLA_COPIE, slug);
    mkdirSync(cartella, { recursive: true });

    // Data ISO con i due punti sostituiti (Windows non li accetta nei nomi):
    // resta ordinabile alfabeticamente, che è come si trova la più recente.
    const quando = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
    // Il contatore finale (a due cifre) serve a due cose: due salvataggi nello
    // stesso millesimo di secondo non si sovrascrivono, e il nome resta
    // ordinabile alfabeticamente — è così che si riconosce la più recente.
    //
    // Non riparte da zero cercando il primo nome libero: `potaCopieVecchie`
    // cancella le copie più vecchie e quindi LIBERA i suffissi bassi, così dal
    // settimo salvataggio nello stesso millisecondo in poi la copia più fresca
    // riprendeva `-00`, che alfabeticamente è la più VECCHIA e veniva potata
    // subito — all'utente restava scritto "copia di sicurezza in..." con un
    // percorso già cancellato. Si riprende invece dal suffisso più alto già
    // presente per quel millisecondo, che la potatura non tocca mai (tiene le
    // ultime per nome): il contatore cresce sempre e l'ordine alfabetico
    // continua a coincidere con l'ordine di scrittura.
    //
    // Le due cifre reggono fino a 99 copie nello stesso millisecondo; oltre, i
    // nomi restano unici (nessuna sovrascrittura) ma l'ordine per nome degrada.
    // Misurato: un salvataggio costa ~0,5 ms, quindi a orologio vero ne cadono
    // al massimo 3 nello stesso millisecondo — e nelle rotte ogni salvataggio è
    // preceduto da una chiamata AI, che sono secondi.
    const prefisso = `${operazione}-${quando}-`;
    let n = -1;
    for (const nome of readdirSync(cartella)) {
        if (!nome.startsWith(prefisso) || !nome.endsWith('.json')) continue;
        const suffisso = Number(nome.slice(prefisso.length, -'.json'.length));
        if (Number.isInteger(suffisso) && suffisso > n) n = suffisso;
    }
    let percorso = resolve(cartella, `${prefisso}${String(++n).padStart(2, '0')}.json`);
    // Cintura e bretelle: se per qualsiasi motivo quel nome esistesse già (una
    // copia arrivata da fuori), si va avanti invece di sovrascriverla.
    while (existsSync(percorso)) {
        percorso = resolve(cartella, `${prefisso}${String(++n).padStart(2, '0')}.json`);
    }

    scriviCopia(percorso, daSalvare);

    potaCopieVecchie(cartella, operazione, basename(percorso));

    return {
        percorso,
        percorsoRelativo: relative(RADICE_TOOLS, percorso).split('\\').join('/'),
    };
}

/**
 * Tiene solo le ultime MAX_COPIE_PER_OPERAZIONE copie di quell'operazione.
 * @param {string} appenaScritta - Nome della copia appena creata: non si tocca.
 */
function potaCopieVecchie(cartella, operazione, appenaScritta) {
    // Schema stretto apposta: tocca solo i file scritti da qui, mai un
    // eventuale backup di altra provenienza — compresi i `<slug>.pre-gen.json`
    // a slot unico lasciati in questa stessa cartella dalla vecchia
    // convenzione di `publisher.js`.
    const schema = new RegExp(`^${operazione}-\\d{4}-\\d{2}-\\d{2}T[\\d-]+\\.json$`);
    // La copia appena scritta è esclusa dalla cernita, non messa in fondo: la
    // potatura ordina per NOME, e se in cartella ci sono già copie con una data
    // più avanti dell'orologio (fuso sbagliato, correzione dell'ora, copie
    // arrivate da un'altra macchina) la più recente per nome non è la nuova.
    // Senza questa esclusione la copia veniva cancellata nell'istante in cui
    // era stata creata, e all'utente restava scritto "copia di sicurezza in..."
    // con un percorso che non esiste. Si tengono quindi le ultime
    // MAX_COPIE_PER_OPERAZIONE - 1 delle altre, più questa.
    const copie = readdirSync(cartella).filter(f => f !== appenaScritta && schema.test(f)).sort();
    const daTenere = Math.max(0, MAX_COPIE_PER_OPERAZIONE - 1);
    for (const vecchia of copie.slice(0, Math.max(0, copie.length - daTenere))) {
        try { unlinkSync(resolve(cartella, vecchia)); } catch { /* non è un motivo per fermare il lavoro */ }
    }
}
