/**
 * COMANDO: sync-cards — Ricostruisce recipes.json scannerizzando tutte le ricette HTML
 * 
 * Scannerizza ricette/{pane,pizza,pasta,lievitati,dolci,focaccia}/*.html
 * Estrae metadati da ogni HTML e ricostruisce recipes.json da zero.
 * 
 * Uso: node crea-ricetta.js --sync-cards
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { resolve, basename, join } from 'path';
import { log } from '../utils/logger.js';

// Categorie supportate con emoji
const CATEGORIES = {
    pane: { name: 'Pane', emoji: '🥖' },
    pizza: { name: 'Pizza', emoji: '🍕' },
    pasta: { name: 'Pasta', emoji: '🍝' },
    lievitati: { name: 'Lievitati', emoji: '🥐' },
    dolci: { name: 'Dolci', emoji: '🍪' },
    focaccia: { name: 'Focaccia', emoji: '🫓' },
};

/**
 * Estrae un valore da HTML usando regex
 */
function extract(html, regex, group = 1) {
    const match = html.match(regex);
    return match ? match[group].trim() : null;
}

/**
 * Estrae i metadati di una ricetta da un file HTML
 */
function extractRecipeFromHtml(htmlPath, categoryDir) {
    const html = readFileSync(htmlPath, 'utf-8');
    const filename = basename(htmlPath, '.html');

    // Salta file index.html delle categorie
    if (filename === 'index') return null;

    // Title: dal tag <title> (rimuovi " — Il Ricettario")
    const rawTitle = extract(html, /<title>(.+?)<\/title>/);
    const title = rawTitle ? rawTitle.replace(/\s*[—–-]\s*Il Ricettario\s*$/i, '').trim() : filename;

    // Description: dal meta tag
    const description = extract(html, /<meta\s+name="description"\s+content="([^"]+)"/i) || '';

    // Slug: dal filename
    const slug = filename;

    // Emoji: dal tag category nel hero
    const tagEmoji = extract(html, /class="tag tag--category"[^>]*>([^<]+)/);
    const emoji = tagEmoji ? tagEmoji.trim().split(' ')[0] : (CATEGORIES[categoryDir]?.emoji || '🍝');

    // Immagine: dal hero background-image
    let image = extract(html, /recipe-hero"[^>]*style="background-image:\s*url\('([^']+)'\)/);
    if (image) {
        // Normalizza path relativo a root (rimuovi ../../)
        image = image.replace(/^(?:\.\.\/)*/, '');
    } else {
        // Fallback: cerca nell'immagine OG o default
        image = `images/ricette/${categoryDir}/${slug}.jpg`;
    }

    // Idratazione: dal tech-badge
    const hydration = extract(html, /Idratazione:.*?<span[^>]*>\s*&nbsp;([^<]+)/i);

    // Temp target: dal tech-badge
    const temp = extract(html, /Target Temp:.*?<span[^>]*>\s*&nbsp;([^<]+)/i) ||
        extract(html, /Temperatura.*?:.*?<span[^>]*>\s*&nbsp;([^<]+)/i);

    // Lievitazione/Tempo: dal tech-badge
    const time = extract(html, /Lievitazione:.*?<span[^>]*>\s*&nbsp;([^<]+)/i) ||
        extract(html, /Tempo.*?:.*?<span[^>]*>\s*&nbsp;([^<]+)/i);

    // Setup/Tool: dal tag setup nel hero
    const setupTag = extract(html, /id="hero-setup-tag"[^>]*>([^<]+)/);
    const tool = setupTag ? setupTag.trim() : '';

    const category = CATEGORIES[categoryDir]?.name || categoryDir;

    return {
        title,
        slug,
        category,
        categoryDir,
        emoji,
        href: `ricette/${categoryDir}/${slug}.html`,
        image,
        description: description.substring(0, 160),
        hydration: hydration || null,
        time: time || null,
        temp: temp || null,
        tool,
    };
}

/**
 * Sync-cards: scannerizza tutte le ricette HTML e ricostruisce recipes.json
 */
export async function syncCards(args) {
    const ricettarioPath = resolve(process.cwd(), args.output || process.env.RICETTARIO_PATH || '../Ricettario');
    const ricettePath = resolve(ricettarioPath, 'ricette');
    const jsonPath = resolve(ricettarioPath, 'public', 'recipes.json');

    log.header('SYNC CARDS — Ricostruzione recipes.json');

    if (!existsSync(ricettePath)) {
        log.error(`Cartella ricette non trovata: ${ricettePath}`);
        return;
    }

    const allRecipes = [];
    const categoryDirs = readdirSync(ricettePath, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

    log.info(`Categorie trovate: ${categoryDirs.join(', ')}`);

    for (const dir of categoryDirs) {
        const categoryPath = join(ricettePath, dir);
        const htmlFiles = readdirSync(categoryPath)
            .filter(f => f.endsWith('.html') && f !== 'index.html');

        for (const file of htmlFiles) {
            const filePath = join(categoryPath, file);
            try {
                const recipe = extractRecipeFromHtml(filePath, dir);
                if (recipe) {
                    allRecipes.push(recipe);
                    log.info(`  ✅ ${recipe.title} (${dir}/${file})`);
                }
            } catch (err) {
                log.warn(`  ❌ Errore parsing ${file}: ${err.message}`);
            }
        }
    }

    // Ordina per categoria e poi per titolo
    allRecipes.sort((a, b) => {
        const catOrder = ['Pane', 'Pizza', 'Pasta', 'Lievitati', 'Dolci', 'Focaccia'];
        const catA = catOrder.indexOf(a.category);
        const catB = catOrder.indexOf(b.category);
        if (catA !== catB) return catA - catB;
        return a.title.localeCompare(b.title, 'it');
    });

    // Ricalcola categorie
    const stats = {};
    allRecipes.forEach(r => {
        stats[r.category] = (stats[r.category] || 0) + 1;
    });
    const categories = Object.entries(stats).map(([name, count]) => ({
        name,
        count,
        emoji: Object.values(CATEGORIES).find(c => c.name === name)?.emoji || '',
    }));

    // Scrivi recipes.json
    const data = {
        generatedAt: new Date().toISOString(),
        totalRecipes: allRecipes.length,
        categories,
        recipes: allRecipes,
    };

    writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');

    log.header('SYNC COMPLETATO');
    log.info(`📦 ${allRecipes.length} ricette sincronizzate`);
    categories.forEach(c => log.info(`   ${c.emoji} ${c.name}: ${c.count}`));
    log.info(`📄 ${jsonPath}`);
}
