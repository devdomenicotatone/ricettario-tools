/**
 * PUBLISHER — Pipeline unificata di pubblicazione ricette
 *
 * Centralizza tutti i passaggi post-Claude:
 *   JSON persistente → Validazione → Immagine → HTML → [Preview] → Inject homepage
 *
 * Usato da: genera.js, testo.js, rigenera.js
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { exec } from 'child_process';
import { createInterface } from 'readline';
import { generateHtml } from './template.js';
import { injectCard } from './injector.js';
import { findAndDownloadImage } from './image-finder.js';
import { validateRecipe } from './validator.js';
import { log } from './utils/logger.js';

/**
 * Mappa categorie → sottocartelle (unica sorgente di verità)
 */
export const CATEGORY_FOLDERS = {
    Pane: 'pane',
    Pizza: 'pizza',
    Pasta: 'pasta',
    Lievitati: 'lievitati',
    Focaccia: 'focaccia',
    Dolci: 'dolci',
};

/**
 * Metadati per le pagine categoria (auto-generazione index.html)
 */
const CATEGORY_META = {
    Pane:      { emoji: '🥖', title: 'Pane Artigianale', desc: 'Ricette di pane ad alta idratazione — ciabatta, filone, baguette e pane speciale.' },
    Pizza:     { emoji: '🍕', title: 'Pizza Artigianale', desc: 'Pizze con lievitazione lunga — napoletana, in teglia, canotto e pinsa romana.' },
    Pasta:     { emoji: '🍝', title: 'Pasta Fresca', desc: 'Pasta fresca fatta in casa — trafilata, ripiena e formati speciali.' },
    Lievitati: { emoji: '🥐', title: 'Lievitati Dolci e Salati', desc: 'Brioche, cornetti, panettone, burger buns e rosticceria.' },
    Focaccia:  { emoji: '🫓', title: 'Focaccia Artigianale', desc: 'Focacce ad alta idratazione — genovese, barese, pugliese e varianti creative.' },
    Dolci:     { emoji: '🍰', title: 'Dolci e Pasticceria', desc: 'Dolci tradizionali, frolle, biscotti e pasticceria artigianale.' },
};

/**
 * Risolve il percorso di output per una ricetta
 * @returns {{ ricettarioPath, outputDir, outputFile, jsonFile }}
 */
export function resolveOutputPaths(recipe, args) {
    const ricettarioPath = resolve(
        process.cwd(),
        args.output || process.env.RICETTARIO_PATH || '../Ricettario'
    );
    const category = recipe.category || args.tipo || 'Pane';
    const subfolder = CATEGORY_FOLDERS[category] || category.toLowerCase();
    const slug = recipe.slug || recipe.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    recipe.slug = slug;

    const outputDir = resolve(ricettarioPath, 'ricette', subfolder);
    const outputFile = resolve(outputDir, `${slug}.html`);
    const jsonFile = resolve(outputDir, `${slug}.json`);

    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
    }

    return { ricettarioPath, outputDir, outputFile, jsonFile };
}

/**
 * Crea automaticamente la pagina categoria (index.html) se non esiste.
 * Usa l'immagine della ricetta appena generata come hero.
 */
function ensureCategoryPage(category, outputDir, heroImagePath) {
    const indexFile = resolve(outputDir, 'index.html');
    if (existsSync(indexFile)) return; // Già esiste

    const meta = CATEGORY_META[category] || {
        emoji: '🍽️',
        title: `${category}`,
        desc: `Tutte le ricette di ${category.toLowerCase()} del Ricettario.`,
    };

    const heroStyle = heroImagePath
        ? `\n        style="background-image: url('${heroImagePath}');"` : '';

    const html = `<!DOCTYPE html>
<html lang="it" data-theme="light">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${meta.desc}">
    <title>${meta.title} — Il Ricettario</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${meta.emoji}</text></svg>">
</head>
<body>
    <nav class="navbar" id="navbar">
        <div class="navbar__inner">
            <a href="../../index.html" class="navbar__brand">🔥 <span>Il Ricettario</span></a>
            <ul class="navbar__links" id="nav-links">
                <li><a href="../../index.html#ricette">Ricette</a></li>
                <li><a href="../../index.html#strumenti">Strumenti</a></li>
                <li><a href="../../index.html#chi-sono">Chi Sono</a></li>
            </ul>
            <div class="navbar__actions">
                <button class="theme-toggle" id="theme-toggle" aria-label="Cambia tema">🌙</button>
                <button class="hamburger" id="hamburger" aria-label="Menu">
                    <span></span><span></span><span></span>
                </button>
            </div>
        </div>
    </nav>

    <section class="category-hero"${heroStyle}>
        <div class="category-hero__content">
            <span class="category-hero__emoji">${meta.emoji}</span>
            <h1 class="category-hero__title">${meta.title}</h1>
            <p class="category-hero__subtitle">${meta.desc}</p>
            <div class="category-hero__count" id="recipe-count">📊 Caricamento...</div>
        </div>
    </section>

    <main class="section">
        <div class="container">
            <nav class="breadcrumb">
                <a href="../../index.html">Home</a>
                <span class="breadcrumb__separator">›</span>
                <a href="../../index.html#ricette">Ricette</a>
                <span class="breadcrumb__separator">›</span>
                <span class="breadcrumb__current">${category}</span>
            </nav>
            <div class="category-toolbar">
                <div class="category-toolbar__search">
                    <span class="category-toolbar__search-icon">🔍</span>
                    <input type="text" class="category-toolbar__search-input" id="category-search"
                        placeholder="Cerca tra le ricette di ${category.toLowerCase()}...">
                </div>
                <div class="category-toolbar__sort">
                    <button class="category-toolbar__sort-btn active" data-sort="az">A-Z</button>
                    <button class="category-toolbar__sort-btn" data-sort="hydration">💧 Idratazione</button>
                </div>
            </div>
            <div class="category-grid" id="category-grid">
                <div class="category-empty">
                    <div class="category-empty__icon">⏳</div>
                    <p>Caricamento ricette...</p>
                </div>
            </div>
        </div>
    </main>

    <footer class="footer">
        <div class="container">
            <div class="footer__grid">
                <div class="footer__brand">
                    <div class="footer__brand-name">🔥 <span>Il Ricettario</span></div>
                    <p class="footer__brand-desc">Ricettario personale. Ricette artigianali documentate con precisione tecnica.</p>
                </div>
                <div>
                    <h4 class="footer__col-title">Navigazione</h4>
                    <ul class="footer__links">
                        <li><a href="../../index.html">↗ Home</a></li>
                        <li><a href="../../index.html#ricette">↗ Tutte le Ricette</a></li>
                    </ul>
                </div>
            </div>
            <div class="footer__bottom">
                <span>© <span id="current-year">2026</span> Il Ricettario</span>
            </div>
        </div>
    </footer>

    <script type="module" src="/js/category-page.js"></script>
</body>
</html>`;

    writeFileSync(indexFile, html, 'utf-8');
    log.info(`📂 Pagina categoria "${category}" creata: ${indexFile}`);
}

/**
 * Apre la preview nel browser via dev server Vite.
 * Se il server non risponde, fallback a file://
 */
function openInBrowser(outputFile, ricettarioPath) {
    return new Promise(async (res) => {
        // Calcola path relativo da ricettarioPath (es. ricette/focaccia/focaccia-barese.html)
        const relative = outputFile
            .replace(ricettarioPath, '')
            .replace(/\\/g, '/')
            .replace(/^\//, '');

        // Prova le porte comuni di Vite
        const ports = [5173, 5174, 5175];
        let serverUrl = null;

        for (const port of ports) {
            try {
                const resp = await fetch(`http://localhost:${port}/Ricettario/`, { signal: AbortSignal.timeout(1000) });
                if (resp.ok) {
                    serverUrl = `http://localhost:${port}/Ricettario/${relative}`;
                    break;
                }
            } catch {}
        }

        const url = serverUrl || outputFile;
        if (!serverUrl) {
            log.warn('Dev server non trovato. Apro file:// (senza CSS).');
            log.info('Avvia prima: cd ../Ricettario && npm run dev');
        }

        const cmd = process.platform === 'win32'
            ? `cmd.exe /c start "" "${url}"`
            : process.platform === 'darwin'
                ? `open "${url}"`
                : `xdg-open "${url}"`;

        exec(cmd, (err) => {
            if (err) log.warn(`Impossibile aprire il browser: ${err.message}`);
        });

        // Attendi 2s per dare tempo al browser
        setTimeout(res, 2000);
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
    if (recipe.stepsSpiral) console.log(`  🌀 Step spirale: ${recipe.stepsSpiral.length}`);
    if (recipe.stepsHand) console.log(`  ✋ Step a mano:  ${recipe.stepsHand.length}`);
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
 * @returns {Promise<{outputFile: string, jsonFile: string}>}
 */
export async function publishRecipe(recipe, args, options = {}) {
    const {
        skipValidation = args['no-validate'] === true,
        skipImage = args['no-image'] === true,
        skipJson = false,
        source = '',
    } = options;

    let { ricettarioPath, outputDir, outputFile, jsonFile } = resolveOutputPaths(recipe, args);

    // ── Forza categoria da --tipo se specificata dall'utente ──
    if (args.tipo && recipe.category !== args.tipo) {
        log.warn(`Claude ha classificato come "${recipe.category}", forzato a "${args.tipo}" (da --tipo)`);
        recipe.category = args.tipo;
        // Ricalcola paths con la categoria corretta
        ({ ricettarioPath, outputDir, outputFile, jsonFile } = resolveOutputPaths(recipe, args));
    }

    // ── Step 1: Cross-check con fonti reali ──
    if (!skipValidation) {
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
        }
    }

    // ── Step 3: Salva JSON intermedio ──
    if (!skipJson) {
        const persistentJson = { ...recipe };
        delete persistentJson._validation;
        delete persistentJson._imageData;
        delete persistentJson._sourcesUsed;
        delete persistentJson._inputMode;

        writeFileSync(jsonFile, JSON.stringify(persistentJson, null, 2), 'utf-8');
        log.info(`💾 JSON salvato: ${jsonFile}`);
    }

    // --dry-run: mostra JSON senza scrivere HTML
    if (args['dry-run']) {
        log.header('DRY RUN — JSON generato (nessun HTML scritto)');
        console.log(JSON.stringify(recipe, null, 2));
        return { outputFile: null, jsonFile };
    }

    // ── Step 4: Genera e salva HTML ──
    const finalHtml = generateHtml(recipe);
    writeFileSync(outputFile, finalHtml, 'utf-8');

    // Salva report validazione
    if (recipe._validation?.report) {
        const reportFile = outputFile.replace('.html', '.validazione.md');
        writeFileSync(reportFile, recipe._validation.report, 'utf-8');
        log.info(`📋 Report validazione: ${reportFile}`);
    }

    // ── Step 4b: Assicura pagina categoria ──
    const heroRelative = recipe.image ? `../../${recipe.image}` : '';
    ensureCategoryPage(recipe.category, outputDir, heroRelative);

    // ── Step 5: Log riepilogo ──
    const label = source ? `RICETTA GENERATA ${source}` : 'RICETTA GENERATA';
    log.header(label);
    log.info(`Titolo: ${recipe.title}`);
    log.info(`Categoria: ${recipe.category}`);
    if (recipe.hydration) log.info(`Idratazione: ${recipe.hydration}%`);
    if (recipe.targetTemp) log.info(`Temp target: ${recipe.targetTemp}`);
    log.info(`Ingredienti: ${recipe.ingredients?.length || 0}`);
    if (recipe.stepsSpiral) log.info(`Step spirale: ${recipe.stepsSpiral.length}`);
    if (recipe.stepsExtruder) log.info(`Step estrusore: ${recipe.stepsExtruder.length}`);
    if (recipe.stepsHand) log.info(`Step a mano: ${recipe.stepsHand.length}`);
    if (recipe.image) log.info(`Immagine: ${recipe.image}`);
    log.info(`HTML: ${outputFile}`);
    if (!skipJson) log.info(`JSON: ${jsonFile}`);

    // ── Step 5b: PREVIEW (se --preview è attivo) ──
    if (args.preview) {
        showPreviewSummary(recipe);

        log.info('🌐 Apertura preview nel browser...');
        await openInBrowser(outputFile, ricettarioPath);

        const confirmed = await askConfirmation(
            '  ❓ Pubblicare questa ricetta nella homepage? (s/n): '
        );

        if (!confirmed) {
            log.warn('⏸️  Inject homepage saltato.');
            log.info(`I file sono stati mantenuti:`);
            log.info(`  HTML: ${outputFile}`);
            log.info(`  JSON: ${jsonFile}`);
            log.info('Per pubblicare dopo: node crea-ricetta.js --sync-cards');
            return { outputFile, jsonFile };
        }

        log.info('✅ Confermato! Procedo con l\'integrazione...');
    }

    // ── Step 6: Inject nella homepage ──
    if (args['no-inject'] !== true) {
        log.header('INTEGRAZIONE HOMEPAGE');
        try {
            injectCard(recipe, ricettarioPath);
        } catch (err) {
            log.warn(`Errore nell'inserimento card: ${err.message}`);
            log.info('La pagina ricetta è stata creata comunque.');
        }
    }

    log.header('COMPLETATO');
    log.info('Prossimi passi:');
    log.info('  1. Apri http://localhost:5173 e verifica il risultato');
    log.info('  2. git add + commit + push');

    return { outputFile, jsonFile };
}

