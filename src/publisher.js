/**
 * PUBLISHER — Pipeline unificata di pubblicazione ricette
 *
 * Centralizza tutti i passaggi post-Claude:
 *   JSON persistente → Validazione → Immagine → HTML → [Preview] → Inject homepage
 *
 * Usato da: genera.js, testo.js, rigenera.js
 */

import { writeFileSync, readFileSync, copyFileSync, unlinkSync, mkdirSync, rmdirSync, readdirSync, existsSync } from 'fs';
import { resolve, basename, relative } from 'path';
import { exec } from 'child_process';
import { createInterface } from 'readline';
import { injectCard } from './injector.js';
import { findAndDownloadImage } from './image-finder.js';
import { validateRecipe } from './validator.js';
import { log } from './utils/logger.js';
import { salvaCopiaSicurezza } from './utils/backup-ricette.js';
import { CATEGORY_FOLDERS } from './constants.js';

// NB: qui c'era CATEGORY_META, una terza copia di titoli/emoji/descrizioni delle
// categorie — non era importata da nessuno e conosceva ancora "Pasta". I metadati
// veri stanno nel registry del sito (js/categories.js, campi title/desc/unicode).

/**
 * Risolve il percorso di output per una ricetta
 * @returns {{ ricettarioPath, outputDir, outputFile, jsonFile, cartellaCreataOra }}
 *          cartellaCreataOra è true se la cartella di categoria non c'era e
 *          l'ha creata questa chiamata: serve a poterla togliere se poi la
 *          ricetta viene scartata (vedi rimuoviCartellaSeVuota).
 */
export function resolveOutputPaths(recipe, args) {
    const ricettarioPath = resolve(
        process.cwd(),
        args.output || process.env.RICETTARIO_PATH || '../Ricettario'
    );
    const category = recipe.category || args.tipo || 'Pane';
    const subfolder = CATEGORY_FOLDERS[category] || category.toLowerCase();
    let slug = recipe.slug || recipe.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const outputDir = resolve(ricettarioPath, 'ricette', subfolder);

    // ── Keep existing: non sovrascrivere, aggiungi suffisso numerico ──
    if (args.keepExisting) {
        const existingJson = resolve(outputDir, `${slug}.json`);
        if (existsSync(existingJson)) {
            // Trova il prossimo numero libero (slug-v2, slug-v3, ...)
            let version = 2;
            while (existsSync(resolve(outputDir, `${slug}-v${version}.json`))) {
                version++;
            }
            const newSlug = `${slug}-v${version}`;
            log.info(`📋 "${slug}" esiste → salvo come "${newSlug}" (confronto A/B)`);
            slug = newSlug;
        }
    }

    recipe.slug = slug;
    const outputFile = resolve(outputDir, `${slug}.html`);
    const jsonFile = resolve(outputDir, `${slug}.json`);

    // In --dry-run non si crea niente: anche solo creare la cartella della
    // categoria basterebbe a bloccare la pubblicazione del sito, perché ogni
    // cartella dentro ricette/ dev'essere una categoria dichiarata in
    // js/categories.js (altrimenti build-recipes.js esce con errore).
    // Il controllo è volutamente permissivo (`!args[...]`, non `!== true`): il
    // parser di crea-ricetta.js assegna il token successivo come valore quando
    // non comincia con `--`, quindi `--dry-run 1 --nome "Focaccia"` produce la
    // stringa '1'. Con un confronto stretto quella riga scriverebbe sul disco.
    const cartellaCreataOra = !existsSync(outputDir) && !args['dry-run'];
    if (cartellaCreataOra) {
        mkdirSync(outputDir, { recursive: true });
    }

    return { ricettarioPath, outputDir, outputFile, jsonFile, cartellaCreataOra };
}

/**
 * Toglie una cartella di categoria creata da QUESTA esecuzione se è rimasta vuota.
 *
 * È il rovescio del commento qui sopra: se la ricetta viene scartata (preview
 * rifiutata) o cambia categoria per strada, la cartella creata resta lì vuota.
 * Quando la categoria è inventata dall'AI — la normalizzazione in publishRecipe
 * si limita a capitalizzare, quindi "dessert" passa — `scripts/build-recipes.js`
 * esce con «ricette/<cat>/ non è dichiarata in js/categories.js» e `npm run
 * check`, cioè il cancello del deploy, si blocca. Git non traccia le cartelle
 * vuote: `git status` non mostra niente e la causa resta invisibile.
 *
 * Non tocca mai cartelle che esistevano già: chi chiama passa solo quelle
 * create adesso.
 */
function rimuoviCartellaSeVuota(dir) {
    try {
        if (!dir || !existsSync(dir)) return;
        if (readdirSync(dir).length > 0) return;
        rmdirSync(dir);
        log.info(`🗑️  Rimossa la cartella vuota creata per questa ricetta: ${dir}`);
    } catch (err) {
        log.warn(`Impossibile rimuovere la cartella vuota ${dir}: ${err.message}`);
    }
}

/**
 * Copia la ricetta esistente prima di sovrascriverla.
 *
 * Il backup NON va accanto alla ricetta: `ricette/<cat>/<slug>.pre-gen.json`
 * verrebbe letto come una ricetta vera dal generatore del sito
 * (`scripts/build-recipes.js` scarta solo `.backup.json` e `.pre-edit.json`) e
 * `npm run check` morirebbe con «campo slug diverso dal nome file» — cioè la
 * copia di sicurezza bloccherebbe la pubblicazione.
 *
 * Il DOVE e il COME li decide `utils/backup-ricette.js`, che è l'unico posto da
 * cui nasce una copia. Qui c'era una seconda convenzione — stessa cartella
 * `tools/data/backup-ricette/`, ma sottocartella per CATEGORIA e uno slot unico
 * `<slug>.pre-gen.json` senza data né rotazione — mentre le rotte della
 * dashboard ci scrivevano dentro per SLUG: due schemi nella stessa cartella, e
 * la potatura dell'uno non riconosceva i file dell'altro. Ora si passa di là,
 * con l'operazione `pre-gen`.
 *
 * @returns {{percorso: string, percorsoRelativo: string}|null} la copia, o null
 *          se non c'era niente da salvare (o se la copia non è riuscita: la
 *          generazione va avanti lo stesso, e il ripristino ha come ripiego i
 *          byte tenuti in memoria da chi chiama).
 */
function salvaCopiaPreGenerazione(jsonFile) {
    try {
        return salvaCopiaSicurezza(jsonFile, null, 'pre-gen');
    } catch (err) {
        log.warn(`Copia di sicurezza non riuscita: ${err.message}`);
        return null;
    }
}

/**
 * Annulla la scrittura del JSON quando la preview viene rifiutata.
 *
 * Prima rispondere "no" saltava solo l'inject: il JSON restava sul disco e
 * `sync-cards` (che gira a ogni salvataggio dall'editor) lo ripescava,
 * pubblicando lo stesso la ricetta scartata.
 *
 * @param {Buffer|null} contenutoPrecedente - byte del JSON letti prima di
 *        sovrascriverlo: ripiego quando la copia su disco non è riuscita.
 * @returns {boolean} true se sul disco resta un JSON pubblicabile
 */
function annullaScritturaJson(jsonFile, backupFile, esistevaPrima, contenutoPrecedente = null) {
    try {
        if (esistevaPrima) {
            if (backupFile && existsSync(backupFile)) {
                copyFileSync(backupFile, jsonFile);
                log.info(`↩️  Ripristinata la versione precedente di ${basename(jsonFile)}`);
                return true;
            }
            // La copia di sicurezza può non esserci (disco pieno, permessi, un
            // percorso occupato da una cartella). Il ripristino non deve
            // dipenderne: altrimenti proprio quando il disco fa i capricci sul
            // disco resta la versione RIFIUTATA e sync-cards la pubblica.
            if (contenutoPrecedente) {
                writeFileSync(jsonFile, contenutoPrecedente);
                log.info(`↩️  Ripristinata la versione precedente di ${basename(jsonFile)} (dalla copia in memoria)`);
                return true;
            }
            log.warn(`Nessuna copia di sicurezza disponibile: sul disco resta la versione appena generata (${jsonFile}).`);
            return true;
        }
        if (existsSync(jsonFile)) {
            unlinkSync(jsonFile);
            log.info(`🗑️  JSON scartato rimosso: ${jsonFile}`);
        }
        return false;
    } catch (err) {
        log.warn(`Impossibile annullare la scrittura: ${err.message}`);
        return existsSync(jsonFile);
    }
}

/**
 * Annulla la scrittura del report di validazione (`<slug>.validazione.md`).
 *
 * Ripristinando solo il JSON, sulle rigenerazioni accanto alla ricetta VECCHIA
 * restava il giudizio della versione RIFIUTATA: è il file che la dashboard
 * legge e sposta (src/server/routes/recipes.js, categories.js), quindi
 * mostrerebbe la validazione di una ricetta che sul disco non esiste.
 *
 * @param {string|null} reportFile - report scritto in questa esecuzione (null se nessuno)
 * @param {Buffer|null} contenutoPrecedente - byte del report che c'era prima
 * @param {boolean} ricettaPrecedenteSulDisco - true se accanto al report è
 *        tornata la ricetta di prima (allora il report va ripristinato; se no
 *        va rimosso, perché descriverebbe una versione che non esiste)
 */
function annullaScritturaReport(reportFile, contenutoPrecedente, ricettaPrecedenteSulDisco) {
    if (!reportFile) return;
    try {
        if (contenutoPrecedente && ricettaPrecedenteSulDisco) {
            writeFileSync(reportFile, contenutoPrecedente);
            log.info(`↩️  Ripristinato il report precedente: ${basename(reportFile)}`);
        } else if (existsSync(reportFile)) {
            unlinkSync(reportFile);
            log.info(`🗑️  Report della versione scartata rimosso: ${basename(reportFile)}`);
        }
    } catch (err) {
        log.warn(`Impossibile annullare la scrittura del report: ${err.message}`);
    }
}

/**
 * Legge `_originalImageUrl` dal JSON già presente sul disco.
 * Serve a non perderlo quando l'immagine c'è già e la ricerca viene saltata.
 */
function urlImmagineEsistente(jsonFile) {
    try {
        if (!existsSync(jsonFile)) return '';
        return JSON.parse(readFileSync(jsonFile, 'utf-8'))._originalImageUrl || '';
    } catch {
        return '';
    }
}

// ensureCategoryPage rimossa — la SPA gestisce le pagine di categoria
// tramite il router client-side (renderCategory in main.js)

/**
 * Apre la preview della ricetta nel dev server del sito.
 *
 * Apriva `ricette/<cat>/<slug>.html`: un file che non esiste più da quando il
 * sito è una SPA, quindi la preview mostrava un 404 (o, col fallback file://,
 * "file non trovato"). La rotta buona è quella che usa il sito stesso
 * (`js/main.js`): lo stesso percorso, senza `.html`.
 *
 * @returns {Promise<boolean>} true se un dev server ha risposto e la pagina è stata aperta
 */
function openInBrowser(jsonFile, ricettarioPath) {
    return new Promise(async (res) => {
        // Rotta SPA relativa alla base del sito (es. ricette/focaccia/focaccia-barese)
        const rotta = jsonFile
            .replace(ricettarioPath, '')
            .replace(/\\/g, '/')
            .replace(/^\//, '')
            .replace(/\.json$/, '');

        const rispondeSuPorta = async (port) => {
            try {
                const resp = await fetch(`http://localhost:${port}/Ricettario/`, { signal: AbortSignal.timeout(1000) });
                return resp.ok;
            } catch {
                return false;
            }
        };

        // Solo 5173-5175 (`npm run dev`): sono le uniche che servono la ricetta
        // appena scritta, perché leggono i file del sito così come stanno.
        let serverUrl = null;
        for (const port of [5173, 5174, 5175]) {
            if (await rispondeSuPorta(port)) {
                serverUrl = `http://localhost:${port}/Ricettario/${rotta}`;
                break;
            }
        }

        // Niente fallback file://: senza dev server non c'è nessuna pagina da aprire.
        if (!serverUrl) {
            // La 4173 è `npm run preview`, che serve `dist/`: lì la pagina della
            // ricetta e la copia del .json compaiono solo dopo una build
            // (`scripts/generate-og.js` e il plugin copy-recipe-json di
            // vite.config.js girano a build finita). Aprirla adesso mostrerebbe
            // "ricetta non trovata" per una ricetta che invece è a posto, quindi
            // la si segnala invece di aprirla.
            if (await rispondeSuPorta(4173)) {
                log.warn('Sulla 4173 c\'è `npm run preview`, che serve dist/: mostra l\'ultima build, non la ricetta appena generata.');
            } else {
                log.warn('Nessun dev server del sito in ascolto: preview non aperta.');
            }
            log.info('Avvia prima: cd ../Ricettario && npm run dev');
            log.info(`Poi apri: http://localhost:5173/Ricettario/${rotta}`);
            return res(false);
        }

        const cmd = process.platform === 'win32'
            ? `cmd.exe /c start "" "${serverUrl}"`
            : process.platform === 'darwin'
                ? `open "${serverUrl}"`
                : `xdg-open "${serverUrl}"`;

        exec(cmd, (err) => {
            if (err) log.warn(`Impossibile aprire il browser: ${err.message}`);
        });

        log.info(`🔗 ${serverUrl}`);

        // Attendi 2s per dare tempo al browser
        setTimeout(() => res(true), 2000);
    });
}

/**
 * Chiede conferma all'utente via stdin
 * @returns {Promise<boolean>}
 */
function askConfirmation(question) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase().startsWith('s') || answer.trim().toLowerCase() === 'y');
        });
    });
}

/**
 * Mostra un riepilogo formattato della ricetta per preview CLI
 */
function showPreviewSummary(recipe) {
    const sep = '─'.repeat(50);
    console.log('');
    console.log(`  ${sep}`);
    console.log(`  📋  ANTEPRIMA RICETTA`);
    console.log(`  ${sep}`);
    console.log(`  📌 Titolo:       ${recipe.title}`);
    console.log(`  🏷️  Categoria:    ${recipe.category}`);
    if (recipe.hydration) console.log(`  💧 Idratazione:  ${recipe.hydration}%`);
    if (recipe.targetTemp) console.log(`  🌡️  Temperatura:  ${recipe.targetTemp}`);
    if (recipe.fermentation) console.log(`  ⏱️  Lievitazione: ${recipe.fermentation}`);
    console.log(`  🧂 Ingredienti:  ${recipe.ingredients?.length || 0}`);
    if (recipe.suspensions?.length) console.log(`  🥜 Sospensioni:  ${recipe.suspensions.length}`);
    if (recipe.steps) console.log(`  📝 Step:         ${recipe.steps.length}`);
    if (recipe.stepsCondiment?.length) console.log(`  🍅 Condimento:   ${recipe.stepsCondiment.length}`);
    if (recipe.image) console.log(`  🖼️  Immagine:     ✅`);
    else console.log(`  🖼️  Immagine:     ❌ nessuna`);
    if (recipe._validation?.score) {
        const s = recipe._validation.score;
        const e = s >= 80 ? '🟢' : s >= 60 ? '🟡' : '🔴';
        console.log(`  ${e} Validazione:  ${s}%`);
    }
    console.log(`  ${sep}`);

    // Lista ingredienti compatta
    console.log(`\n  🧾 Ingredienti:`);
    for (const ing of recipe.ingredients || []) {
        if (ing.grams != null) {
            console.log(`     ${ing.grams}g — ${ing.name}${ing.note ? ` ${ing.note}` : ''}`);
        } else {
            console.log(`     ── ${ing.name} ──`);
        }
    }
    console.log('');
}

/**
 * Pipeline completa di pubblicazione di una ricetta.
 *
 * @param {object} recipe - JSON strutturato (da enhancer, testo, o file .json)
 * @param {object} args - Argomenti CLI
 * @param {object} options - Opzioni aggiuntive
 * @param {boolean} options.skipValidation - Salta cross-check
 * @param {boolean} options.skipImage - Salta ricerca immagine
 * @param {boolean} options.skipJson - Non salvare il .json (es. per --rigenera)
 * @param {string}  options.source - Etichetta origine (es. "DA URL", "DA TESTO", "DA JSON")
 * @returns {Promise<{outputFile: string|null, jsonFile: string|null}>}
 *          jsonFile è null quando non è rimasto niente sul disco (--dry-run,
 *          oppure preview rifiutata).
 */
export async function publishRecipe(recipe, args, options = {}) {
    let {
        // Il flag documentato è `--no-valida` (crea-ricetta.js:23 e README), ma
        // qui si leggeva solo `no-validate`: la scorciatoia scritta nell'help non
        // spegneva niente e il cross-check partiva lo stesso, con le chiamate a
        // pagamento (SerpAPI + Claude) che si porta dietro. Ora valgono entrambi.
        // Truthy e non `=== true` per la stessa ragione spiegata per dry-run:
        // `--no-valida 1` arriva dal parser come stringa.
        skipValidation = !!(args['no-valida'] || args['no-validate']),
        skipImage = args['no-image'] === true,
        skipJson = false,
        source = '',
    } = options;

    // ── --dry-run: nessuna scrittura, davvero ──
    // Il controllo stava in fondo alla pipeline: quando scattava, il JSON della
    // ricetta era già stato riscritto e l'immagine già scaricata. Guardare una
    // ricetta "solo per vedere com'è" cancellava quella vecchia. Ora dry-run
    // implica skipImage e skipJson, e resolveOutputPaths non crea la cartella.
    // Qualunque valore vale come "sì": `--dry-run 1` o `--dry-run true` passano
    // dal parser come stringa (crea-ricetta.js prende il token successivo come
    // valore), e con `=== true` la pipeline andrebbe fino in fondo — cioè
    // pubblicherebbe proprio nell'invocazione che chiedeva di non scrivere.
    const dryRun = !!args['dry-run'];
    if (dryRun) {
        skipImage = true;
        skipJson = true;
    }

    // I campi di lavoro (`_validation`, `_imageData`, ...) viaggiano dentro
    // `recipe` lungo la pipeline ma non devono finire nel JSON pubblicato.
    // La lista è UNA e sta qui: la usa il salvataggio (Step 3) e la riusa il
    // profilo analitico (Step 3c) — due copie divergerebbero al primo campo
    // effimero nuovo.
    const senzaCampiEffimeri = (r) => {
        const pulito = { ...r };
        delete pulito._validation;
        delete pulito._imageData;
        delete pulito._sourcesUsed;
        delete pulito._inputMode;
        // NOTA: _generatedBy e _createdAt restano nel JSON per tracciabilità
        return pulito;
    };

    let { ricettarioPath, outputDir, outputFile, jsonFile, cartellaCreataOra } = resolveOutputPaths(recipe, args);

    // Cartelle di categoria nate in questa esecuzione: se la ricetta viene
    // scartata vanno tolte, altrimenti resta una cartella vuota che blocca
    // `npm run check` (vedi rimuoviCartellaSeVuota).
    const cartelleCreateOra = new Set();
    if (cartellaCreataOra) cartelleCreateOra.add(outputDir);

    // ── Ricetta già presente: di default non si tocca ──
    // Il default era "sovrascrivi", e rigenerare una ricetta la cancellava. Ora
    // esiste una copia di sicurezza, ma una copia è un rimedio, non un
    // permesso: rimpiazzare lavoro già fatto è una decisione, e la prende chi
    // lancia il comando. Ci si ferma PRIMA della ricerca immagine, così
    // l'invocazione non spende niente.
    //
    // Non scatta in dry-run (non scrive comunque, e lo scopo è proprio vedere
    // il JSON di una ricetta che esiste), né con `skipJson` (il chiamante ha
    // già dichiarato che non vuole scrivere il .json), né con `--keepExisting`,
    // che salva come slug-v2 senza toccare l'originale.
    //
    // Truthy e non `=== true`: il parser di crea-ricetta.js prende il token
    // successivo come valore, quindi `--sovrascrivi 1` arriva come stringa.
    const sovrascrivi = !!args.sovrascrivi;
    if (!dryRun && !skipJson && !sovrascrivi && !args.keepExisting && existsSync(jsonFile)) {
        log.warn(`"${recipe.slug}" esiste già: non ho scritto niente.`);
        log.info('   Per rimpiazzarla:    --sovrascrivi   (dashboard: "Sovrascrivi")');
        log.info('   Per tenere entrambe: --keepExisting  (dashboard: "Tieni entrambe", salva come -v2)');
        log.info(`   La ricetta attuale è intatta: ${relative(ricettarioPath, jsonFile)}`);
        return { outputFile: null, jsonFile: null };
    }

    // Ricalcolo dei percorsi dopo un cambio di categoria: tiene aggiornato
    // l'elenco delle cartelle create adesso e toglie subito quella che il
    // cambio ha appena abbandonato, se l'aveva creata questa esecuzione.
    const ricalcolaPercorsi = () => {
        const cartellaPrecedente = outputDir;
        ({ ricettarioPath, outputDir, outputFile, jsonFile, cartellaCreataOra } = resolveOutputPaths(recipe, args));
        if (cartellaCreataOra) cartelleCreateOra.add(outputDir);
        if (outputDir !== cartellaPrecedente && cartelleCreateOra.has(cartellaPrecedente)) {
            cartelleCreateOra.delete(cartellaPrecedente);
            rimuoviCartellaSeVuota(cartellaPrecedente);
        }
    };

    // ── Normalizzazione e forzatura categoria ──
    const validCategories = Object.keys(CATEGORY_FOLDERS);
    
    if (args.tipo) {
        const normalizedTipo = validCategories.find(c => c.toLowerCase() === args.tipo.toLowerCase()) 
            || (args.tipo.charAt(0).toUpperCase() + args.tipo.slice(1));
            
        if (recipe.category && recipe.category.toLowerCase() !== args.tipo.toLowerCase()) {
            log.warn(`Claude ha classificato come "${recipe.category}", forzato a "${normalizedTipo}" (da --tipo)`);
        }
        recipe.category = normalizedTipo;
        // Ricalcola paths con la categoria corretta
        ricalcolaPercorsi();
    } else if (recipe.category) {
        // Normalizza la categoria generata da Claude se esiste in CATEGORY_FOLDERS
        const normalizedCat = validCategories.find(c => c.toLowerCase() === recipe.category.toLowerCase());
        if (normalizedCat && normalizedCat !== recipe.category) {
            recipe.category = normalizedCat;
        } else if (!normalizedCat) {
            // Capitalizza la prima lettera se è una categoria nuova non censita
            recipe.category = recipe.category.charAt(0).toUpperCase() + recipe.category.slice(1);
        }
        // Ricalcola i paths nel caso in cui la normalizzazione influisca sul folder
        ricalcolaPercorsi();
    }

    // ── Step 1: Cross-check con fonti reali ──
    if (!skipValidation) {
        // --dry-run promette "nessun file scritto", non "nessuna spesa": il
        // cross-check interroga SerpAPI e Claude. Detto prima di partire, non
        // nel riepilogo finale a chiamate già fatte.
        if (dryRun) {
            log.warn('--dry-run non salta il cross-check: partono chiamate a SerpAPI e Claude (a pagamento). Per evitarle aggiungi --no-valida.');
        }
        log.header('CROSS-CHECK FONTI REALI');
        try {
            const { comparison, report } = await validateRecipe(recipe);
            const score = comparison.score ?? comparison.confidence ?? 0;
            const emoji = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🔴';
            log.info(`${emoji} Confidenza: ${score}%`);
            log.info(`Fonti analizzate: ${comparison.sourcesAnalyzed || comparison.sourcesUsed?.length || 0}`);

            if (comparison.discrepancies?.length > 0) {
                comparison.discrepancies.forEach(d => log.warn(`  ⚠️  ${d}`));
            }
            if (comparison.warnings?.length > 0) {
                comparison.warnings.forEach(w => log.warn(`  ⚠️  ${w}`));
            }
            if (comparison.matches?.length > 0) {
                log.info(`✅ Conferme: ${comparison.matches.length} ingredienti confermati`);
            }

            recipe._validation = { score, report };
        } catch (err) {
            log.warn(`Cross-check non riuscito: ${err.message}`);
            log.info('Procedo senza validazione.');
        }
    }

    // ── Step 2: Ricerca immagine stock ──
    if (!skipImage) {
        const imageData = await findAndDownloadImage(recipe, ricettarioPath);
        if (imageData) {
            recipe.image = imageData.homeRelativePath;
            recipe.imageAttribution = imageData.attribution;
            recipe._imageData = imageData;
            // L'URL di origine va scritto nel JSON: è l'unica traccia che lega la
            // ricetta alla foto usata, ed è ciò che "Ricostruisci da ricette"
            // rilegge per l'indice anti-duplicati. Senza, quel pulsante trovava il
            // campo solo in 10 ricette su 80 e buttava via le altre 59 voci.
            // url è vuoto quando l'immagine era già sul disco: in quel caso
            // recupero il valore dal JSON esistente invece di azzerarlo.
            recipe._originalImageUrl = imageData.url
                || recipe._originalImageUrl
                || urlImmagineEsistente(jsonFile);
        }
    }

    // ── Step 3: Salva JSON intermedio ──
    let backupFile = null;
    let jsonPrecedente = null;
    const esistevaPrima = !skipJson && existsSync(jsonFile);
    if (!skipJson) {
        // ── Copia di sicurezza prima di sovrascrivere ──
        // La generazione era l'unico punto che riscriveva una ricetta senza
        // copia: le correzioni non ancora committate sparivano in silenzio.
        if (esistevaPrima) {
            // Byte della versione precedente tenuti in memoria: il ripristino
            // dopo un "no" non deve dipendere dalla riuscita della copia su disco.
            try { jsonPrecedente = readFileSync(jsonFile); } catch {}
            // `percorso` (assoluto) serve al ripristino, `percorsoRelativo` a
            // dirlo all'utente: annullaScritturaJson continua a ricevere un percorso.
            const copiaPreGen = salvaCopiaPreGenerazione(jsonFile);
            backupFile = copiaPreGen ? copiaPreGen.percorso : null;
            log.warn(`"${recipe.slug}" esisteva già e viene riscritta (--sovrascrivi).`);
            if (copiaPreGen) log.info(`🛟 Copia di sicurezza: tools/${copiaPreGen.percorsoRelativo}`);
            log.info('   Per tenere entrambe le versioni: --keepExisting (dashboard: "Tieni entrambe").');

            // Con --no-image la ricetta riscritta perderebbe l'URL della foto già
            // in uso, e l'indice anti-duplicati dimenticherebbe quella voce.
            if (!recipe._originalImageUrl) {
                const urlPrecedente = urlImmagineEsistente(jsonFile);
                if (urlPrecedente) recipe._originalImageUrl = urlPrecedente;
            }
        }

        const persistentJson = senzaCampiEffimeri(recipe);

        writeFileSync(jsonFile, JSON.stringify(persistentJson, null, 2), 'utf-8');
        log.info(`💾 JSON salvato: ${jsonFile}`);

        // ── Step 3b: Validazione schema pre-pubblicazione ──
        try {
            const { validateRecipeSchema } = await import('./recipe-schema.js');
            const schemaResult = validateRecipeSchema(persistentJson);
            if (!schemaResult.valid) {
                log.warn(`⚠️  SCHEMA VALIDATION: ${schemaResult.errors.length} errori trovati nel JSON generato:`);
                schemaResult.errors.forEach(e => log.warn(`   ❌ ${e}`));
                log.warn(`   Il JSON è stato salvato ma potrebbe non renderizzarsi correttamente nel frontend.`);
                log.warn(`   Esegui "Fix AI" dalla dashboard per correggere automaticamente.`);
            } else if (schemaResult.warnings.length > 0) {
                log.info(`📐 Schema OK con ${schemaResult.warnings.length} warning`);
            }
        } catch (schemaErr) {
            log.warn(`⚠️  Validazione schema non riuscita: ${schemaErr.message}`);
        }
    }

    // --dry-run: mostra il JSON, senza aver scritto niente
    if (dryRun) {
        log.header('DRY RUN — nessun file scritto');
        log.info(`Sarebbe stata scritta: ${jsonFile}`);
        log.info('Ricerca immagine, report e inject in homepage: saltati.');
        // Lo Step 1 gira PRIMA di questo blocco: dire solo cosa è stato saltato
        // farebbe credere che dry-run non abbia fatto niente, mentre il
        // cross-check è già costato chiamate a SerpAPI e Claude.
        log.info(skipValidation
            ? 'Cross-check delle fonti: saltato (--no-valida).'
            : 'Cross-check delle fonti (Step 1): già eseguito — dry-run non lo evita e costa chiamate a SerpAPI e Claude. Per saltarlo: --no-valida.');
        console.log(JSON.stringify(recipe, null, 2));
        return { outputFile: null, jsonFile: null };
    }

    // ── Step 3c: Profilo analitico (sensoriale + nutrizionale) ──
    // Ultimo passaggio automatico della generazione: prima le ricette nuove
    // nascevano senza radar e senza valori nutrizionali finché qualcuno non
    // passava dalla dashboard — la pizza-napoletana-verace-stg è rimasta così
    // per tre mesi senza che nessuno se ne accorgesse. Se l'AI fallisce, o la
    // categoria non ha ancora una famiglia da cui prendere gli assi
    // (generateAnalyticsProfile torna null), la ricetta resta valida: warning
    // e avanti — il filtro «Senza Profilo/Nutrizione» della dashboard la
    // ripesca. Sta PRIMA della preview di proposito: se la preview viene
    // rifiutata, annullaScritturaJson ripristina i byte precedenti e si porta
    // via anche questo.
    if (!skipJson && !recipe.sensoryProfile) {
        try {
            const { generateAnalyticsProfile } = await import('./sensory.js');
            const analytics = await generateAnalyticsProfile(recipe);
            if (analytics) {
                recipe.sensoryProfile = analytics.sensory;
                recipe.nutrition = analytics.nutrition;
                writeFileSync(jsonFile, JSON.stringify(senzaCampiEffimeri(recipe), null, 2), 'utf-8');
                log.success('🧪 Profilo sensoriale e valori nutrizionali aggiunti alla ricetta.');
            }
        } catch (err) {
            log.warn(`⚠️  Profilo analitico non generato (${err.message}). La ricetta è salva comunque: generalo dalla dashboard (Qualità → Sensory).`);
        }
    }

    // ── Step 4: Salva report validazione ──
    let reportFile = null;
    let reportPrecedente = null;
    if (recipe._validation?.report) {
        reportFile = jsonFile.replace('.json', '.validazione.md');
        // Come per il JSON: se la preview viene rifiutata, il report di prima
        // va rimesso com'era invece di lasciare quello della versione scartata.
        if (existsSync(reportFile)) {
            try { reportPrecedente = readFileSync(reportFile); } catch {}
        }
        writeFileSync(reportFile, recipe._validation.report, 'utf-8');
        log.info(`📋 Report validazione: ${reportFile}`);
    }

    // ── Step 5: Log riepilogo ──
    const label = source ? `RICETTA GENERATA ${source}` : 'RICETTA GENERATA';
    log.header(label);
    log.info(`Titolo: ${recipe.title}`);
    log.info(`Categoria: ${recipe.category}`);
    if (recipe.hydration) log.info(`Idratazione: ${recipe.hydration}%`);
    if (recipe.targetTemp) log.info(`Temp target: ${recipe.targetTemp}`);
    log.info(`Ingredienti: ${recipe.ingredients?.length || 0}`);
    if (recipe.steps) log.info(`Step: ${recipe.steps.length}`);
    if (recipe.stepsCondiment?.length) log.info(`Step condimento: ${recipe.stepsCondiment.length}`);
    if (recipe.image) log.info(`Immagine: ${recipe.image}`);
    if (!skipJson) log.info(`JSON: ${jsonFile}`);

    // ── Step 5b: PREVIEW (se --preview è attivo) ──
    if (args.preview) {
        showPreviewSummary(recipe);

        log.info('🌐 Apertura preview nel browser...');
        await openInBrowser(jsonFile, ricettarioPath);

        const confirmed = await askConfirmation(
            '  ❓ Pubblicare questa ricetta nella homepage? (s/n): '
        );

        if (!confirmed) {
            log.warn('⏸️  Pubblicazione annullata.');

            // Non basta saltare l'inject: `sync-cards` gira a ogni salvataggio
            // dall'editor e ripesca dal disco qualunque JSON dentro ricette/,
            // quindi la ricetta scartata finiva pubblicata lo stesso.
            let restaSulDisco = true;
            if (!skipJson) {
                restaSulDisco = annullaScritturaJson(jsonFile, backupFile, esistevaPrima, jsonPrecedente);
            }
            // Il report precedente va rimesso com'era solo se sul disco è tornata
            // (o non è mai stata toccata, con skipJson) la ricetta di prima.
            // Altrimenti va rimosso: è il giudizio di una versione che non c'è.
            const ricettaPrecedenteSulDisco = skipJson || (esistevaPrima && restaSulDisco);
            annullaScritturaReport(reportFile, reportPrecedente, ricettaPrecedenteSulDisco);

            // Tolti JSON e report, la cartella di categoria creata da questa
            // esecuzione resterebbe vuota. Se la categoria è inventata dall'AI,
            // basta quella cartella a far fallire `npm run check` — e siccome
            // git non traccia le cartelle vuote, non si vede da nessuna parte.
            if (!restaSulDisco) {
                for (const dir of cartelleCreateOra) rimuoviCartellaSeVuota(dir);
            }

            if (recipe._imageData) {
                if (!esistevaPrima) {
                    log.warn(`L'immagine scaricata resta in public/${recipe.image} (cancellala a mano se non ti serve).`);
                } else if (recipe._imageData.url) {
                    // Stesso slug = stesso file: la foto nuova ha preso il posto di
                    // quella della ricetta appena ripristinata. Dire "cancellala"
                    // qui lascerebbe la ricetta senza copertina.
                    log.warn(`La foto di "${recipe.slug}" è stata sostituita: public/${recipe.image} ora è quella nuova, e la ricetta ripristinata punta lì.`);
                    log.info(`   Per rimetterne una scelta a mano: node crea-ricetta.js --refresh-image ${recipe.slug}`);
                }
                // Se _imageData.url è vuoto l'immagine era già sul disco e non è
                // stata toccata: non c'è niente da segnalare.
            }
            if (restaSulDisco && !esistevaPrima) {
                // Solo se la rimozione non è riuscita: il file scartato è ancora lì.
                log.info(`Sul disco resta: ${jsonFile} — cancellalo per non pubblicarlo.`);
            }
            return { outputFile: null, jsonFile: restaSulDisco ? jsonFile : null };
        }

        log.info('✅ Confermato! Procedo con l\'integrazione...');
    }

    // ── Step 6: Inject nella homepage ──
    if (args['no-inject'] !== true) {
        log.header('INTEGRAZIONE HOMEPAGE');
        try {
            // `injectCard` è async da quando scrive l'indice sotto lock: senza
            // `await` questo `catch` è codice morto e l'errore diventa una
            // promise rifiutata che ammazza il processo (o finisce in
            // errori.log lato server, dove l'utente non lo legge). È il caso
            // reale: poco sopra la categoria può essere una non censita, e
            // `cartellaCategoria` per quella lancia.
            await injectCard(recipe, ricettarioPath);
        } catch (err) {
            log.warn(`Errore nell'inserimento card: ${err.message}`);
            log.info('La pagina ricetta è stata creata comunque.');
        }
    }

    // ── Step 7: Sync recipes.json ──
    try {
        const { syncCards } = await import('./commands/sync-cards.js');
        await syncCards({});
        log.info('🔄 recipes.json sincronizzato');
    } catch (err) {
        log.warn(`Sync cards fallito: ${err.message}`);
    }

    log.header('COMPLETATO');
    log.info('Prossimi passi:');
    log.info('  1. Apri http://localhost:5173 e verifica il risultato');
    log.info('  2. git add + commit + push');

    return { outputFile, jsonFile };
}

