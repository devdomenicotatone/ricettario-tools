/**
 * INJECTOR — Aggiorna recipes.json con la nuova ricetta.
 * Il rendering sulla homepage è ora completamente dinamico (JSON → JS).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';

/**
 * Aggiunge la ricetta al file recipes.json.
 * Se già presente (per slug), skip. Altrimenti la inserisce nella categoria corretta.
 */
export function injectCard(recipe, ricettarioPath) {
    const jsonPath = resolve(ricettarioPath, 'public', 'recipes.json');

    // Se recipes.json non esiste, lo crea vuoto
    let data = { generatedAt: '', totalRecipes: 0, categories: [], recipes: [] };
    try {
        if (existsSync(jsonPath)) {
            data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
        }
    } catch {
        console.log('⚠️  recipes.json corrotto, lo ricreo.');
    }

    const r = recipe;
    const slug = r.slug || r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const category = r.category || 'Pasta';
    const categoryDir = { Pane: 'pane', Pizza: 'pizza', Pasta: 'pasta', Lievitati: 'lievitati', Focaccia: 'focaccia', Dolci: 'dolci', Conserve: 'conserve' };
    const dir = categoryDir[category] || category.toLowerCase();

    // Verifica duplicati
    if (data.recipes.some(existing => existing.slug === slug)) {
        console.log(`ℹ️  Card già presente in recipes.json, skip inserimento.`);
        return;
    }

    // Trova hydration/time/temp dalle proprietà della ricetta
    const hydration = r.hydration ? `${r.hydration}%` : null;
    const time = r.fermentation || null;
    const temp = r.targetTemp || null;

    // Immagine
    let image = '';
    if (r.image) {
        image = r.image;
    } else if (r.slug) {
        image = `images/ricette/${dir}/${slug}.webp`;
    }

    // Normalizza path immagine
    image = image.replace(/^\.\.\/\.\.\//g, '');

    const newEntry = {
        title: r.title,
        slug,
        category,
        categoryDir: dir,
        emoji: r.emoji || '🍝',
        href: `ricette/${dir}/${slug}.html`,
        image,
        description: (r.description || '').substring(0, 120),
        hydration,
        time,
        temp,
        tool: '',
        _createdAt: r._createdAt || new Date().toISOString(),
    };

    data.recipes.push(newEntry);
    data.totalRecipes = data.recipes.length;
    data.generatedAt = new Date().toISOString();

    // Ricalcola categorie
    const stats = {};
    const emojiMap = { Pasta: '🍝', Pane: '🥖', Pizza: '🍕', Lievitati: '🥐', Focaccia: '🫓', Dolci: '🍰', Conserve: '🫙' };
    data.recipes.forEach(rec => {
        stats[rec.category] = (stats[rec.category] || 0) + 1;
    });
    data.categories = Object.entries(stats).map(([name, count]) => ({
        name, count, emoji: emojiMap[name] || '',
    }));

    writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`✅ Ricetta aggiunta a recipes.json (${data.totalRecipes} totali)`);
}
