/**
 * COMANDO: trascrivi — Trascrivi PDF o immagini Philips in ricette JSON
 * (le pagine .html non esistono più: il sito è una SPA che legge i .json)
 */

import { resolve, dirname } from 'path';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { transcribePhilipsPdf } from '../verify.js';
import { injectCard } from '../injector.js';
import { findAndDownloadImage } from '../image-finder.js';
import { log } from '../utils/logger.js';
import {
    cartellaCategoria,
    cartelleAmmesse,
    eFileDiRicetta,
    etichetteAmmesse,
    percorsoRicetta,
    radiceRicettario,
    slugDaNomeFile,
    slugValido,
} from '../utils/percorsi-ricette.js';

/**
 * Categoria di ripiego quando l'estrazione non ne indica una.
 *
 * È un'ETICHETTA del registry del sito ("Primi"), non un nome di cartella: la
 * traduzione in `ricette/primi/` la fa `cartellaCategoria`. Se un giorno il
 * sito rinomina anche questa, `cartellaCategoria` lancia con un messaggio che
 * lo dice — invece di creare in silenzio una cartella che blocca il deploy.
 */
const CATEGORIA_PREDEFINITA = 'Primi';

/**
 * Etichetta del registry ("Primi", "Secondi Piatti") a partire dalla cartella.
 *
 * È il verso opposto di `cartellaCategoria`, e serve perché il campo `category`
 * scritto nel JSON e il nome della cartella sono due cose che il sito confronta
 * fra loro: metterci la cartella al posto dell'etichetta fa fallire
 * `npm run check`, esattamente come ci scriverebbe una categoria inventata.
 *
 * L'elenco non viene fotografato: `etichetteAmmesse()` rilegge il registry a
 * ogni chiamata, così una categoria appena creata dalla dashboard è già qui.
 *
 * NOTA: questa funzione dovrebbe stare in `utils/percorsi-ricette.js` accanto a
 * `cartellaCategoria` (vedi `fileDiAltriDaAggiornare`), così anche publisher.js
 * e le rotte normalizzerebbero allo stesso modo. Quel file non è di questo
 * agente, quindi qui c'è la versione locale — costruita comunque SOLO sull'API
 * pubblica del modulo, senza rileggere il registry per conto proprio.
 */
function etichettaCanonica(cartella) {
    const etichetta = etichetteAmmesse().find(e => cartellaCategoria(e) === cartella);
    if (!etichetta) {
        // Impossibile finché `cartella` arriva da `cartellaCategoria`: se accade,
        // il registry è incoerente e si scarta la ricetta invece di scriverne una
        // che bloccherà il deploy.
        throw new Error(`Nessuna categoria del registry corrisponde alla cartella "${cartella}".`);
    }
    return etichetta;
}

/**
 * Slug di ricetta a partire dal titolo estratto dall'OCR.
 *
 * L'espressione usata prima (`title.toLowerCase().replace(/[^a-z0-9]+/g,'-')`)
 * su "Purè di patate" dava `pur-di-patate` e su "Ragù." lasciava il trattino
 * finale: nomi di file che `slugValido` rifiuta. Qui gli accenti vengono
 * ridotti alla lettera base e i trattini di bordo tolti.
 *
 * ⚠️ DA SPOSTARE in `utils/percorsi-ricette.js`, accanto a `slugValido` — che è
 * la regola che questa funzione deve soddisfare. Oggi la stessa domanda ha tre
 * risposte diverse (qui, `publisher.js:38`, `injector.js:62`) e le altre due
 * sbagliano sulle accentate. Finché resta qui è la quarta copia di una regola
 * che il checkup chiedeva di unificare: la richiesta è in
 * `fileDiAltriDaAggiornare`, il file del modulo non è di questo agente.
 */
function slugDaTitolo(titolo) {
    return String(titolo || '')
        .normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 120)
        .replace(/^-+|-+$/g, '');
}

/**
 * Trascrivi PDF Philips
 */
export async function trascriviPdf(args) {
    const ricettarioPath = radiceRicettario(args.output);
    const pdfDir = resolve(ricettarioPath, 'public', 'pdf');
    log.header('TRASCRIZIONE PDF — Philips Serie 7000');

    const pdfs = readdirSync(pdfDir).filter(f => f.toLowerCase().endsWith('.pdf'));
    const allRecipes = [];

    for (const pdf of pdfs) {
        try {
            const result = await transcribePhilipsPdf(resolve(pdfDir, pdf));
            log.success(`${pdf}: ${result.recipes?.length || 0} ricette trovate`);
            if (result.recipes) allRecipes.push(...result.recipes);
        } catch (err) {
            log.error(`${pdf}: ${err.message}`);
        }
    }

    // Salva risultato
    const dataDir = resolve(process.cwd(), 'data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    const outputPath = resolve(dataDir, 'philips-recipes.json');
    writeFileSync(outputPath, JSON.stringify({ machine: 'Philips Serie 7000', recipes: allRecipes }, null, 2), 'utf-8');
    log.success(`Salvate ${allRecipes.length} ricette in: ${outputPath}`);
}

/**
 * Trascrivi immagini Philips -> ricette JSON (Surya OCR locale + Claude testo)
 */
export async function trascriviImmagini(args) {
    const ricettarioPath = radiceRicettario(args.output);
    const pdfDirs = [
        resolve(ricettarioPath, 'public', 'pdf', 'Philips Pasta maker'),
        resolve(ricettarioPath, 'public', 'pdf', 'Philips Pasta maker2'),
        resolve(ricettarioPath, 'public', 'pdf', 'Philips Pasta maker3')
    ];
    log.header('TRASCRIZIONE IMMAGINI — Philips Serie 7000 (Surya OCR + Claude)');

    // ── Step 1: OCR locale con Surya ──
    log.info('Step 1/3 — OCR locale con Surya...');
    const { runOcr, groupOcrPages } = await import('../ocr.js');
    const ocrResults = await runOcr(pdfDirs);

    const totalPages = Object.keys(ocrResults).length;
    const pagesWithText = Object.values(ocrResults).filter(r => r.lines > 0).length;

    if (pagesWithText === 0) {
        log.error('Nessun testo estratto dalle immagini. Verifica che Surya sia installato correttamente.');
        return;
    }

    log.success(`OCR completato: ${pagesWithText}/${totalPages} pagine con testo`);

    // ── Step 2: Indice di tracciamento ──
    const dataDir = resolve(process.cwd(), 'data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    const indexPath = resolve(dataDir, 'image-process-index.json');
    let processedIndex = {};
    try {
        if (existsSync(indexPath)) {
            processedIndex = JSON.parse(readFileSync(indexPath, 'utf-8'));
        }
    } catch { processedIndex = {}; }

    const saveIndex = () => {
        writeFileSync(indexPath, JSON.stringify(processedIndex, null, 2), 'utf-8');
    };

    // ── Step 3: Raggruppa in batch e invia a Claude ──
    log.info('Step 2/3 — Raggruppamento batch per Claude...');
    const BATCH_SIZE = 10;
    const allBatches = groupOcrPages(ocrResults, BATCH_SIZE);

    // Filtra batch già processati (solo le pagine NON-overlap contano)
    //
    // Una pagina è "da fare" se non è mai stata lavorata OPPURE se l'ultimo
    // tentativo è finito in errore. Senza la seconda condizione un batch fallito
    // veniva comunque scritto nell'indice (con dentro il messaggio d'errore) e
    // da lì in poi saltato per sempre, mentre il programma annunciava "Tutte le
    // pagine sono già state processate!".
    //
    // Il fallimento NON si riconosce dal testo del messaggio: `err.message` è ''
    // su un Error senza messaggio ed è `undefined` se viene lanciato qualcosa che
    // non è un Error — e in quel caso JSON.stringify toglie del tutto la chiave,
    // così la voce fallita tornava a sembrare una lavorazione riuscita. Si guarda
    // quindi il flag `esito`, più la semplice presenza di `error` per le voci
    // scritte dalle versioni precedenti.
    //
    // Il controllo di tipo non è pignoleria: l'indice si ripara a mano, e su un
    // valore primitivo (una stringa, un numero) l'operatore `in` lancia
    // TypeError, uccidendo l'intero comando prima ancora dell'OCR. Una voce che
    // non sappiamo leggere vale "da rifare".
    const voceLeggibile = (voce) => !!voce && typeof voce === 'object' && !Array.isArray(voce);
    const inErrore = (voce) => !voceLeggibile(voce) || voce.esito === 'errore' || 'error' in voce;

    // Quante volte abbiamo già bruciato una chiamata a pagamento su quelle pagine.
    // Senza questo contatore un batch che fallisce SEMPRE (pagina OCR illeggibile,
    // risposta mai parsabile) tornava in coda a ogni lancio, all'infinito, pagando
    // ogni volta lo stesso input.
    const MAX_TENTATIVI = 3;
    const tentativiDi = (voce) => (voceLeggibile(voce) && Number(voce.tentativi)) || 0;

    const daRifare = (filename) => {
        const voce = processedIndex[filename];
        if (!inErrore(voce)) return false;               // lavorata bene: non si tocca
        if (!voceLeggibile(voce)) return true;           // mai vista, o voce illeggibile
        return tentativiDi(voce) < MAX_TENTATIVI;        // in errore: solo se restano tentativi
    };

    const pendingBatches = allBatches.filter(batch =>
        batch.filter(p => !p.isOverlap).some(page => daRifare(page.filename))
    );

    const pagineNonRiuscite = Object.keys(processedIndex).filter(f => inErrore(processedIndex[f]));
    const pagineDaRiprovare = pagineNonRiuscite.filter(daRifare).length;
    const pagineAbbandonate = pagineNonRiuscite.length - pagineDaRiprovare;
    if (pagineDaRiprovare > 0) {
        log.warn(`${pagineDaRiprovare} pagine erano rimaste in errore da un lancio precedente: vengono riprovate.`);
    }
    if (pagineAbbandonate > 0) {
        log.warn(`${pagineAbbandonate} pagine sono state abbandonate dopo ${MAX_TENTATIVI} tentativi falliti: non vengono più riprovate.`);
        log.warn(`   Per farle ripartire, cancella le loro voci da ${indexPath}.`);
    }

    const alreadyDone = allBatches.length - pendingBatches.length;
    if (alreadyDone > 0) {
        log.success(`${alreadyDone} batch già processati. Rimangono ${pendingBatches.length} batch.`);
    }

    if (pendingBatches.length === 0) {
        if (pagineAbbandonate > 0) {
            log.warn(`Niente da fare: restano solo ${pagineAbbandonate} pagine abbandonate dopo ${MAX_TENTATIVI} tentativi.`);
        } else {
            log.success('Tutte le pagine sono già state processate!');
        }
        return;
    }

    log.info(`Step 3/3 — Invio ${pendingBatches.length} batch a Claude (${BATCH_SIZE} pagine/batch)...`);

    const { extractRecipesFromText } = await import('../enhancer.js');
    let totalExtracted = 0;
    let totalDuplicates = 0;
    const extractedSlugs = new Set(); // Slug già estratti in questo run
    const batchFalliti = [];          // Riepilogo finale: cosa non è stato estratto e perché

    // ── Deduplicazione: carica ricette esistenti su disco ──
    const existingRecipes = loadExistingRecipes(ricettarioPath);
    log.info(`Trovate ${existingRecipes.size} ricette già esistenti su disco.`);

    for (let b = 0; b < pendingBatches.length; b++) {
        const batch = pendingBatches[b];
        log.info(`\nBatch ${b + 1}/${pendingBatches.length}: ${batch.length} pagine (${batch[0].filename} → ${batch[batch.length - 1].filename})`);

        try {
            const recipes = await extractRecipesFromText(batch);
            if (recipes && recipes.length > 0) {
                log.success(`Trovate ${recipes.length} ricette in questo batch.`);
                for (const recipe of recipes) {
                    recipe.slug = slugValido(recipe.slug) ? recipe.slug : slugDaTitolo(recipe.title);
                    if (!recipe.category) recipe.category = CATEGORIA_PREDEFINITA;

                    // Uno slug malformato (titolo fatto di sola punteggiatura, o
                    // vuoto) non può diventare un nome di file: si scarta la
                    // singola ricetta, non tutto il batch.
                    //
                    // Il titolo si controlla insieme allo slug, e non "tanto per":
                    // una ricetta con slug buono ma senza `title` supera questo
                    // punto e poi fa esplodere `checkDuplicate` su
                    // `recipe.title.toLowerCase()`. Quel TypeError finisce nel
                    // try/catch del batch, che marca come FALLITO l'INTERO batch —
                    // dieci pagine di OCR già pagate buttate via, e un tentativo
                    // consumato su tutte — per colpa di una sola ricetta storta.
                    if (!slugValido(recipe.slug) || !String(recipe.title || '').trim()) {
                        const nome = String(recipe.title || '').trim() || `(senza titolo, slug "${recipe.slug}")`;
                        log.error(`${nome} non salvata: servono un titolo e uno slug validi.`);
                        continue;
                    }

                    // ── DEDUPLICAZIONE ──
                    const dupCheck = checkDuplicate(recipe, existingRecipes, extractedSlugs);
                    if (dupCheck.isDuplicate) {
                        totalDuplicates++;
                        log.warn(`⚠️  DUPLICATO: "${recipe.title}" (${recipe.slug}) → già esistente come "${dupCheck.existingTitle}" (${dupCheck.existingSlug})`);
                        continue;
                    }

                    // ── DOVE VA SCRITTA ──
                    // La cartella la decide il registry del sito, non una costante
                    // scritta qui: prima era fissa a `ricette/pasta/`, cioè una
                    // categoria che il sito ha rinominato "Primi" mesi fa. Ogni
                    // ricetta trascritta creava quindi una cartella non dichiarata
                    // in js/categories.js, e da lì in poi `npm run check` del sito
                    // falliva — non si pubblicava più niente, nemmeno le ricette
                    // che con la trascrizione non c'entravano nulla.
                    //
                    // Il percorso si calcola PRIMA dell'arricchimento: se la
                    // categoria non è nel registry è inutile spendere le chiamate a
                    // SerpAPI e a Claude per una ricetta che non si potrà salvare.
                    let cartella;
                    let jsonFile;
                    try {
                        cartella = cartellaCategoria(recipe.category);
                        jsonFile = percorsoRicetta(recipe.category, recipe.slug, { ricettarioPath });
                        // La cartella è giusta, ma non basta: il generatore del
                        // sito (scripts/build-recipes.js) confronta il campo
                        // `category` del JSON con il NOME della categoria del
                        // registry, e se non coincidono si ferma con
                        // `process.exit(1)` — di nuovo `npm run check` rosso e
                        // pubblicazione bloccata, solo per un'altra strada.
                        // `cartellaCategoria` accetta di proposito anche la forma
                        // cartella ("primi", "secondi-piatti"), quindi una ricetta
                        // così finirebbe nel posto giusto con dentro scritto
                        // «"category": "primi"» invece di «"Primi"». Qui il campo
                        // torna alla forma canonica del registry prima di essere
                        // scritto.
                        recipe.category = etichettaCanonica(cartella);
                    } catch (err) {
                        log.error(`"${recipe.title}" non salvata: ${err.message}`);
                        continue;
                    }

                    // Segna come estratto
                    extractedSlugs.add(recipe.slug);

                    // ── ARRICCHIMENTO SerpAPI ──
                    if (args['no-enrich'] !== true) {
                        try {
                            await enrichWithRealSources(recipe);
                        } catch (err) {
                            log.warn(`Arricchimento fallito per "${recipe.title}": ${err.message}. Procedo con dati OCR.`);
                        }
                    }

                    totalExtracted++;
                    const outputDir = dirname(jsonFile);
                    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

                    // Immagine
                    if (args['no-image'] !== true) {
                        try {
                            const imageData = await findAndDownloadImage(recipe, ricettarioPath);
                            if (imageData) {
                                recipe.image = imageData.homeRelativePath;
                                recipe.imageAttribution = imageData.attribution;
                                // Stessa scrittura di publisher.js: `_originalImageUrl`
                                // è l'unica traccia che lega la ricetta alla foto
                                // usata, ed è ciò che "Ricostruisci da ricette"
                                // rilegge per l'indice anti-duplicati. Senza, ogni
                                // ricetta trascritta è una voce che quel pulsante
                                // butta via. `url` è vuoto quando l'immagine era già
                                // sul disco: in quel caso non si azzera il campo.
                                const urlOrigine = imageData.url || recipe._originalImageUrl || '';
                                if (urlOrigine) recipe._originalImageUrl = urlOrigine;
                            }
                        } catch (err) {
                            log.warn(`Immagine per ${recipe.title} non trovata (${err.message}).`);
                        }
                    }

                    writeFileSync(jsonFile, JSON.stringify(recipe, null, 2), 'utf-8');

                    // Aggiungi alla mappa esistenti per dedup futuri batch
                    existingRecipes.set(recipe.slug, recipe.title);

                    // `injectCard` è `async` (scrive public/recipes.json dentro un
                    // lock): senza `await`, il try/catch qui intorno è codice
                    // morto — una promise rifiutata non ci passa, diventa una
                    // unhandled rejection e su Node moderno TERMINA il processo.
                    // Conseguenza vera, non teorica: con tre batch e un inject che
                    // fallisce, l'esecuzione moriva dopo il primo batch (OCR degli
                    // altri due già pagato e mai usato), senza riepilogo e senza il
                    // `syncCards` finale — cioè proprio quando l'indice del sito
                    // avrebbe avuto più bisogno di essere rigenerato.
                    if (args['no-inject'] !== true) {
                        try {
                            await injectCard(recipe, ricettarioPath);
                        } catch (err) {
                            log.warn(`Errore inject card per ${recipe.title}: ${err.message}`);
                        }
                    }

                    log.success(`Salvata: ${recipe.title} -> ricette/${cartella}/${recipe.slug}.json`);
                }
            } else {
                log.info('Nessuna ricetta trovata in questo batch.');
            }

            // Segna solo le pagine NON-overlap come processate
            for (const page of batch.filter(p => !p.isOverlap)) {
                processedIndex[page.filename] = {
                    processedAt: new Date().toISOString(),
                    esito: 'ok',
                    recipesFound: recipes?.length || 0,
                    mode: 'surya-ocr'
                };
            }
            saveIndex();

        } catch (err) {
            // `String(err)` come rete: se non è un Error, `err.message` è undefined
            // e la voce salvata perderebbe ogni traccia del fallimento.
            const messaggio = err?.message || String(err);
            log.error(`Errore durante estrazione batch ${b + 1}: ${messaggio}`);

            // Il conteggio dei tentativi è del batch, non della singola pagina: i
            // raggruppamenti cambiano fra un lancio e l'altro, quindi si riparte
            // dal massimo già registrato sulle pagine coinvolte.
            const paginePiene = batch.filter(p => !p.isOverlap);
            const tentativiOra = Math.max(0, ...paginePiene.map(p => tentativiDi(processedIndex[p.filename]))) + 1;
            const abbandonato = tentativiOra >= MAX_TENTATIVI;

            batchFalliti.push({
                numero: b + 1,
                pagine: `${batch[0].filename} → ${batch[batch.length - 1].filename}`,
                messaggio,
                tentativi: tentativiOra,
                abbandonato,
            });
            for (const page of paginePiene) {
                processedIndex[page.filename] = {
                    processedAt: new Date().toISOString(),
                    esito: 'errore',
                    error: messaggio,
                    tentativi: tentativiOra,
                    mode: 'surya-ocr'
                };
            }
            saveIndex();
        }

        // Pausa tra batch per rate limit
        if (b < pendingBatches.length - 1) {
            log.debug('Attesa per rate limit API (2s)...');
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    // ── Sincronizza l'indice del sito ──
    // `injectCard` aggiunge la scheda a `public/recipes.json` una ricetta alla
    // volta; il file però lo genera il sito, e qui restava indietro (categorie,
    // conteggi, date). Tutti gli altri flussi che scrivono una ricetta chiudono
    // con `syncCards` (publisher.js Step 7, e le rotte della dashboard): questo
    // era l'unico che non lo faceva. Una volta sola a fine trascrizione, non a
    // ogni ricetta: il generatore rilegge comunque l'intera cartella `ricette/`.
    if (totalExtracted > 0) {
        try {
            const { syncCards } = await import('./sync-cards.js');
            await syncCards({ output: args.output });
            log.info('🔄 recipes.json sincronizzato');
        } catch (err) {
            log.warn(`Sync cards fallito: ${err.message}`);
        }
    }

    log.success(`\n${'═'.repeat(50)}`);
    log.success(`TRASCRIZIONE COMPLETATA!`);
    log.success(`Estratte: ${totalExtracted} ricette`);
    if (totalDuplicates > 0) log.warn(`Duplicati saltati: ${totalDuplicates}`);
    if (batchFalliti.length > 0) {
        const daRiprovare = batchFalliti.filter(f => !f.abbandonato);
        const abbandonati = batchFalliti.filter(f => f.abbandonato);
        log.error(`Batch falliti: ${batchFalliti.length}/${pendingBatches.length}`);
        if (daRiprovare.length > 0) {
            log.error(`   ${daRiprovare.length} verranno riprovati al prossimo lancio:`);
            for (const f of daRiprovare) {
                log.error(`      Batch ${f.numero} (${f.pagine}) — tentativo ${f.tentativi}/${MAX_TENTATIVI}: ${f.messaggio}`);
            }
        }
        if (abbandonati.length > 0) {
            log.error(`   ${abbandonati.length} abbandonati dopo ${MAX_TENTATIVI} tentativi — NON verranno più riprovati:`);
            for (const f of abbandonati) {
                log.error(`      Batch ${f.numero} (${f.pagine}): ${f.messaggio}`);
            }
        }
    }
    log.success(`${'═'.repeat(50)}`);
}

// ── UTILITY: Carica ricette esistenti su disco ──

/**
 * Tutte le ricette già sul disco, slug → titolo.
 *
 * Le cartelle arrivano dal registry del sito, non da un elenco scritto a mano:
 * quello di prima ne conosceva cinque su nove (e fra queste "pasta", che non
 * esiste più), quindi il controllo anti-duplicati era CIECO su condimenti,
 * conserve, focaccia, primi e secondi-piatti — le prime due da sole valgono più
 * ricette di tutte le altre messe insieme. Una categoria aggiunta al sito entra
 * qui da sola.
 */
function loadExistingRecipes(ricettarioPath) {
    const existing = new Map(); // slug → title

    for (const cartella of cartelleAmmesse()) {
        const dir = resolve(ricettarioPath, 'ricette', cartella);
        if (!existsSync(dir)) continue;
        // `eFileDiRicetta` salta index.json e i file di lavoro (.backup.json,
        // .pre-edit.json, .qualita.json): non sono ricette e occuperebbero uno
        // slug negli scarti per duplicato.
        for (const file of readdirSync(dir).filter(eFileDiRicetta)) {
            const slug = slugDaNomeFile(file);
            // Estrai titolo dal file JSON
            try {
                const data = JSON.parse(readFileSync(resolve(dir, file), 'utf-8'));
                existing.set(slug, data.title || slug);
            } catch {
                existing.set(slug, slug);
            }
        }
    }

    return existing;
}

// ── UTILITY: Check duplicato ──

function checkDuplicate(recipe, existingRecipes, extractedSlugs) {
    const slug = recipe.slug;
    const title = recipe.title.toLowerCase().trim();

    // 1. Slug identico (già su disco o già estratto in questo run)
    if (existingRecipes.has(slug)) {
        return { isDuplicate: true, existingSlug: slug, existingTitle: existingRecipes.get(slug) };
    }
    if (extractedSlugs.has(slug)) {
        return { isDuplicate: true, existingSlug: slug, existingTitle: '(estratta in questo run)' };
    }

    // 2. Titolo molto simile (fuzzy match)
    for (const [existSlug, existTitle] of existingRecipes) {
        if (isSimilarTitle(title, existTitle.toLowerCase())) {
            return { isDuplicate: true, existingSlug: existSlug, existingTitle: existTitle };
        }
    }

    return { isDuplicate: false };
}

function isSimilarTitle(a, b) {
    // Normalizza: rimuovi "philips", "pasta maker", prefissi, suffissi comuni
    const normalize = (s) => s
        .replace(/philips/gi, '')
        .replace(/pasta\s*maker/gi, '')
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const na = normalize(a);
    const nb = normalize(b);

    // Match esatto dopo normalizzazione
    if (na === nb) return true;

    // Uno contiene l'altro (>80% della lunghezza)
    if (na.length > 4 && nb.length > 4) {
        if (na.includes(nb) || nb.includes(na)) return true;
    }

    // Parole chiave comuni (>70% overlap)
    const wordsA = new Set(na.split(' ').filter(w => w.length > 2));
    const wordsB = new Set(nb.split(' ').filter(w => w.length > 2));
    if (wordsA.size >= 2 && wordsB.size >= 2) {
        const intersection = [...wordsA].filter(w => wordsB.has(w));
        const overlap = intersection.length / Math.min(wordsA.size, wordsB.size);
        if (overlap >= 0.7) return true;
    }

    return false;
}

// ── UTILITY: Arricchimento SerpAPI + Secondo Claude Call ──

async function enrichWithRealSources(recipe) {
    const { searchRealSources, scrapeRecipePage } = await import('../validator.js');
    // enhancer.js importa callClaude/parseClaudeJson ma non le riesporta: da lì
    // arrivavano `undefined` e l'arricchimento moriva con "callClaude is not a
    // function" dopo aver già speso le query SerpAPI. La fonte vera è utils/api.js.
    const { callClaude, parseClaudeJson } = await import('../utils/api.js');
    // Stessa recinzione usata dai prompt di enhancer.js: anche qui nel prompt
    // finisce testo scritto da terzi (snippet SerpAPI, passaggi e ingredienti
    // scrappati da tre pagine web).
    const { bloccoFontiEsterne } = await import('../enhancer.js');

    const searchQuery = `ricetta ${recipe.title} pasta consigli trucchi`;
    log.info(`🔍 SerpAPI: cerco fonti per "${recipe.title}"...`);

    const sources = await searchRealSources(searchQuery);
    if (!sources || sources.length === 0) {
        log.debug(`Nessuna fonte trovata per "${recipe.title}".`);
        return;
    }

    log.info(`📡 Trovate ${sources.length} fonti, scraping migliori 3...`);
    const scrapedData = [];

    for (const source of sources.slice(0, 3)) {
        try {
            const data = await scrapeRecipePage(source.url);
            if (data) {
                scrapedData.push({
                    domain: source.domain,
                    snippet: source.snippet || '',
                    steps: (data.steps || []).slice(0, 5).join(' '),
                    ingredients: (data.ingredients || []).slice(0, 10).join(', ')
                });
                log.debug(`   ✅ ${source.domain}`);
            }
        } catch {
            // Ignora errori scraping
        }
        await new Promise(r => setTimeout(r, 300));
    }

    if (scrapedData.length === 0) return;

    // ── SECONDO CLAUDE CALL: arricchimento ──
    const sourcesText = scrapedData.map((s, i) =>
        `Fonte ${i + 1} (${s.domain}):\n${s.snippet}\nPassaggi: ${s.steps}\nIngredienti menzionati: ${s.ingredients}`
    ).join('\n\n');

    const enrichPrompt = `Hai questa ricetta Philips Pasta Maker:
Titolo: ${recipe.title}
Ingredienti impasto: ${recipe.ingredients.filter(i => i.note?.includes('impasto')).map(i => `${i.name} ${i.grams}g`).join(', ')}
Ingredienti condimento: ${recipe.ingredients.filter(i => !i.note?.includes('impasto')).map(i => `${i.name} ${i.grams}g`).join(', ') || 'nessuno'}

Ecco dati REALI da fonti autorevoli italiane su questa ricetta:
${bloccoFontiEsterne(sourcesText)}
Basandoti SOLO sulle fonti reali sopra, genera un JSON con SOLO queste 3 cose:
1. "proTips": array di 2-4 consigli PRO da maestro (trucchi, segreti veri trovati nelle fonti)
2. "glossary": array di 1-3 termini tecnici con definizione (es. {"term": "Incordatura", "definition": "..."})
3. "flourTable": array di 0-2 farine consigliate con marca reale (es. {"type": "Semola rimacinata", "w": "250-280", "brands": "Molino Caputo, De Cecco"})

⚠️ NON modificare ingredienti o dosi. NON inventare nulla. Usa SOLO dati dalle fonti.
Rispondi SOLO con il JSON oggetto (non array). Niente markdown.`;

    try {
        // Niente messaggio assistant pre-riempito con "{": i modelli in uso
        // rispondono 400 e la chiamata fallisce sempre. La regola nel prompt
        // ("rispondi SOLO con il JSON oggetto") più il parser tollerante bastano.
        const enrichText = await callClaude({
            maxTokens: 2048,
            messages: [
                { role: 'user', content: enrichPrompt }
            ],
        });

        const enrichData = parseClaudeJson(enrichText);

        // Applica arricchimento — SOLO campi aggiuntivi, mai ingredienti
        if (enrichData.proTips?.length > 0) {
            recipe.proTips = [...(recipe.proTips || []), ...enrichData.proTips];
        }
        if (enrichData.glossary?.length > 0) {
            recipe.glossary = [...(recipe.glossary || []), ...enrichData.glossary];
        }
        if (enrichData.flourTable?.length > 0) {
            recipe.flourTable = [...(recipe.flourTable || []), ...enrichData.flourTable];
        }

        recipe._enriched = true;
        recipe._sourcesCount = scrapedData.length;
        recipe._sourcesDomains = scrapedData.map(s => s.domain);

        log.success(`Arricchita "${recipe.title}" con ${scrapedData.length} fonti: ${scrapedData.map(s => s.domain).join(', ')}`);
    } catch (err) {
        log.warn(`Arricchimento Claude fallito per "${recipe.title}": ${err.message}`);
    }
}
