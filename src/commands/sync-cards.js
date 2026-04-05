/**
 * COMANDO: sync-cards — Ricostruisce recipes.json scannerizzando tutti i JSON ricetta
 * 
 * Scannerizza ricette/{pane,pizza,pasta,lievitati,dolci,focaccia}/*.json
 * Estrae metadati da ogni JSON e ricostruisce recipes.json da zero.
 * 
 * I file JSON sono la UNICA fonte di verità — gli HTML sono template
 * generati dinamicamente e non vengono mai usati come sorgente dati.
 * 
 * Uso: node crea-ricetta.js --sync-cards
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
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
    conserve: { name: 'Conserve', emoji: '🫙' },
};

/**
 * Estrae i metadati di una ricetta dal file JSON
 */
function extractRecipeFromJson(jsonPath, categoryDir) {
    const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    const filename = basename(jsonPath, '.json');

    // Salta eventuali file index.json
    if (filename === 'index') return null;

    // Fallback _createdAt: usa mtime del file se non c'è nel JSON
    let createdAt = data._createdAt || null;
    if (!createdAt) {
        try { createdAt = statSync(jsonPath).mtime.toISOString(); } catch {}
    }

    const slug = data.slug || filename;
    const category = data.category || CATEGORIES[categoryDir]?.name || categoryDir;
    const emoji = data.emoji || CATEGORIES[categoryDir]?.emoji || '🍝';

    // Immagine: dal JSON, oppure path convenzionale
    const image = data.image || `images/ricette/${categoryDir}/${slug}.webp`;

    // Fermentation / time: normalizzazione
    const time = data.fermentation || data.time || null;

    // Temperatura
    const temp = data.targetTemp || data.temp || null;

    // Tool/Setup
    const tool = data.tool || '';

    return {
        title: data.title || slug,
        slug,
        category,
        categoryDir,
        emoji,
        href: `ricette/${categoryDir}/${slug}.html`,
        image,
        description: (data.description || '').substring(0, 160),
        hydration: data.hydration ? `${data.hydration}%` : null,
        time,
        temp,
        tool,
        _generatedBy: data._generatedBy || null,
        _createdAt: createdAt,
    };
}

/**
 * Sync-cards: scannerizza tutti i JSON ricetta e ricostruisce recipes.json
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
        const jsonFiles = readdirSync(categoryPath)
            .filter(f => f.endsWith('.json') && f !== 'index.json' && !f.includes('.backup.') && !f.includes('.pre-fix.') && !f.includes('.pre-edit.'));

        for (const file of jsonFiles) {
            const filePath = join(categoryPath, file);
            try {
                const recipe = extractRecipeFromJson(filePath, dir);
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
        const catOrder = ['Pane', 'Pizza', 'Pasta', 'Lievitati', 'Dolci', 'Focaccia', 'Conserve'];
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
