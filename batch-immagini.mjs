/**
 * BATCH v3 — Solo immagini
 * 
 * Rigenera SOLO le immagini per tutte le ricette esistenti
 * usando il fix scoring food-only + puppeteer stealth.
 * 
 * Le ricette (HTML) restano invariate — solo download nuove immagini.
 */

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, basename } from 'path';
import { config } from 'dotenv';

config({ path: resolve(import.meta.dirname, '.env') });

const RICETTARIO_PATH = resolve(import.meta.dirname, '..', 'Ricettario');
const RICETTE_PATH = resolve(RICETTARIO_PATH, 'ricette');

async function main() {
    console.log('🚀 BATCH v3 — SOLO IMMAGINI (scoring food-only + stealth)');
    console.log('═'.repeat(60));

    // Importa il modulo immagini
    const { findAndDownloadImage } = await import('./src/image-finder.js');

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

main().catch(err => {
    console.error('❌ Errore fatale:', err);
    process.exit(1);
});
