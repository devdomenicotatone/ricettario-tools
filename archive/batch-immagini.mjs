/**
 * BATCH v3 — Solo immagini. SUPERATO: era l'epoca delle ricette in HTML.
 *
 * Rigenerava le immagini di tutte le ricette esistenti e poi riscriveva il
 * percorso della foto dentro il file `.html` della ricetta.
 *
 * Perché sta in archive/: il sito non ha più pagine `.html` da quando è
 * diventato una SPA — oggi in `ricette/` ci sono 166 `.json` e zero `.html`.
 * Questo script cerca solo `.html`, quindi trova zero ricette e non fa niente,
 * ma lo diceva male: stampava «✅ 0/0 immagini scaricate» ed usciva con
 * successo, come se avesse lavorato. Nessuno lo importa e non è in
 * package.json né nel README.
 *
 * Il lavoro che faceva oggi lo fa la pipeline immagini della dashboard
 * (src/image-finder.js + il selettore visuale), che scrive nel `.json`.
 *
 * Cosa è cambiato spostandolo qui: parte solo se lanciato a mano, si ferma con
 * un messaggio chiaro quando non trova ricette invece di fingere di aver
 * finito, e i percorsi non dipendono più da dove sta il file (da archive/
 * `import.meta.dirname/..` avrebbe puntato a `tools/Ricettario`, che non
 * esiste — lo stesso inciampo di add-storage-backfill).
 *
 * Uso — riattivazione a mano, fuori dalla pipeline: il flusso normale non lo
 * lancia mai e il README dice giustamente di non lanciarlo. Questa riga serve
 * a chi decide di rieseguirlo apposta, sapendo cosa fa.
 *       node archive/batch-immagini.mjs
 */

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, basename } from 'path';
import { config } from 'dotenv';
import { pathToFileURL } from 'url';

config({ path: resolve(import.meta.dirname, '..', '.env') });

// Stessa convenzione di percorso di tutti gli altri comandi del progetto.
const RICETTARIO_PATH = resolve(process.cwd(), process.env.RICETTARIO_PATH || '../Ricettario');
const RICETTE_PATH = resolve(RICETTARIO_PATH, 'ricette');

async function main() {
    console.log('🚀 BATCH v3 — SOLO IMMAGINI (scoring food-only + stealth)');
    console.log('═'.repeat(60));

    // Importa il modulo immagini
    const { findAndDownloadImage } = await import('../src/image-finder.js');

    // Scansiona tutte le ricette HTML
    const recipes = [];
    const subdirs = readdirSync(RICETTE_PATH, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

    for (const subdir of subdirs) {
        const subPath = resolve(RICETTE_PATH, subdir);
        const files = readdirSync(subPath).filter(f => f.endsWith('.html'));
        for (const file of files) {
            const filePath = resolve(subPath, file);
            const html = readFileSync(filePath, 'utf-8');

            // Estrai titolo e categoria dal HTML
            const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
            const title = titleMatch ? titleMatch[1].trim() : basename(file, '.html');

            // Categoria dal path
            const categoryMap = {
                pane: 'Pane', pizza: 'Pizza', pasta: 'Pasta',
                lievitati: 'Lievitati', dolci: 'Dolci',
            };
            const category = categoryMap[subdir] || subdir;
            const slug = basename(file, '.html');

            recipes.push({ title, category, slug, filePath, subdir });
        }
    }

    console.log(`\n📊 Trovate ${recipes.length} ricette da aggiornare\n`);

    // Zero ricette non vuol dire "finito": vuol dire che questo script cerca
    // pagine .html che il sito non produce più. Fermarsi e dirlo, invece di
    // stampare un riepilogo 0/0 che sembra un successo.
    if (recipes.length === 0) {
        console.error(`❌ Nessuna ricetta .html trovata in ${RICETTE_PATH}.`);
        console.error('   Il sito è una SPA: le ricette sono file .json e questo script non li');
        console.error('   sa leggere. Per rifare le immagini usa la pipeline della dashboard.');
        process.exit(1);
    }

    const usedUrls = new Set();
    let success = 0;
    let failed = 0;

    for (let i = 0; i < recipes.length; i++) {
        const recipe = recipes[i];
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`[${i + 1}/${recipes.length}] ${recipe.title} (${recipe.category})`);
        console.log('═'.repeat(60));

        try {
            const result = await findAndDownloadImage(
                { title: recipe.title, category: recipe.category, slug: recipe.slug, imageKeywords: [] },
                RICETTARIO_PATH,
                usedUrls
            );

            if (result) {
                // Aggiorna il percorso immagine nel HTML
                const html = readFileSync(recipe.filePath, 'utf-8');
                const newImgPath = `images/ricette/${recipe.subdir}/${recipe.slug}.jpg`;

                // Aggiorna sia src che og:image
                let updatedHtml = html;

                // Hero image src
                const heroImgRegex = /(class="recipe-hero__image"[^>]*src=")[^"]*(")/i;
                if (heroImgRegex.test(updatedHtml)) {
                    updatedHtml = updatedHtml.replace(heroImgRegex, `$1../../${newImgPath}$2`);
                }

                // OG image
                const ogImgRegex = /(property="og:image"\s+content=")[^"]*(")/i;
                if (ogImgRegex.test(updatedHtml)) {
                    updatedHtml = updatedHtml.replace(ogImgRegex, `$1../../${newImgPath}$2`);
                }

                if (updatedHtml !== html) {
                    writeFileSync(recipe.filePath, updatedHtml, 'utf-8');
                    console.log(`   ✅ HTML aggiornato con nuovo percorso immagine`);
                }

                success++;
            } else {
                console.log(`   ⚠️ Nessuna immagine food trovata — saltata`);
                failed++;
            }
        } catch (err) {
            console.error(`   ❌ Errore: ${err.message}`);
            failed++;
        }

        // Pausa per rispettare rate limits API
        await new Promise(r => setTimeout(r, 2000));
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log('RIEPILOGO BATCH v3 — IMMAGINI');
    console.log('═'.repeat(60));
    console.log(`✅ ${success}/${recipes.length} immagini scaricate`);
    if (failed > 0) console.log(`⚠️ ${failed}/${recipes.length} fallite`);
    console.log(`\nExit code: 0`);
}

// Parte SOLO se lanciato esplicitamente, mai al semplice import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(err => {
        console.error('❌ Errore fatale:', err);
        process.exit(1);
    });
}
