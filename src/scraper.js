/**
 * SCRAPER — Estrae dati ricetta da URL
 * Supporta: JSON-LD (Schema.org Recipe), GialloZafferano, fallback generico
 */

import * as cheerio from 'cheerio';

/**
 * Scarica HTML da URL e restituisce DOM cheerio
 */
async function fetchPage(url) {
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'it-IT,it;q=0.9',
        }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    const html = await res.text();
    return cheerio.load(html);
}

/**
 * Tenta di estrarre JSON-LD Recipe dal <script type="application/ld+json">
 */
function extractJsonLd($) {
    const scripts = $('script[type="application/ld+json"]');
    for (let i = 0; i < scripts.length; i++) {
        try {
            let data = JSON.parse($(scripts[i]).html());

            // Gestisci array
            if (Array.isArray(data)) data = data.find(d => d['@type'] === 'Recipe');

            // Gestisci @graph
            if (data?.['@graph']) data = data['@graph'].find(d => d['@type'] === 'Recipe');

            if (data?.['@type'] === 'Recipe') return data;
        } catch { /* ignora script non validi */ }
    }
    return null;
}

/**
 * Normalizza JSON-LD Recipe in formato interno
 */
function fromJsonLd(recipe) {
    return {
        title: recipe.name || '',
        description: recipe.description || '',
        ingredients: (recipe.recipeIngredient || []).map(i => i.trim()),
        steps: (recipe.recipeInstructions || []).map(step => {
            if (typeof step === 'string') return step.trim();
            return step.text?.trim() || step.name?.trim() || '';
        }).filter(Boolean),
        prepTime: recipe.prepTime || '',
        cookTime: recipe.cookTime || '',
        totalTime: recipe.totalTime || '',
        servings: recipe.recipeYield || '',
        category: recipe.recipeCategory || '',
        cuisine: recipe.recipeCuisine || '',
        image: typeof recipe.image === 'string' ? recipe.image : recipe.image?.[0] || recipe.image?.url || '',
    };
}

/**
 * Fallback: estrae dati dai selettori CSS comuni
 */
function extractFromSelectors($) {
    const title = $('h1').first().text().trim() ||
        $('[class*="title"]').first().text().trim();

    const ingredients = [];
    $('[class*="ingredient"] li, [class*="ingredienti"] li, .gz-ingredient, .ingredient-text').each((_, el) => {
        const text = $(el).text().trim();
        if (text) ingredients.push(text);
    });

    const steps = [];
    $('[class*="step"] p, [class*="procedimento"] li, .gz-content-recipe-step p, [class*="instruction"] li').each((_, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 20) steps.push(text);
    });

    return {
        title,
        description: $('meta[name="description"]').attr('content') || '',
        ingredients,
        steps,
        prepTime: '',
        cookTime: '',
        totalTime: '',
        servings: '',
        category: '',
        cuisine: '',
        image: $('meta[property="og:image"]').attr('content') || '',
    };
}

/**
 * Funzione principale: scrapa una ricetta da URL
 * @param {string} url 
 * @returns {Promise<object>} Dati ricetta normalizzati
 */
export async function scrapeRecipe(url) {
    console.log(`🔍 Scraping: ${url}`);
    const $ = await fetchPage(url);

    // Prova JSON-LD prima (più affidabile)
    const jsonLd = extractJsonLd($);
    if (jsonLd) {
        console.log('✅ Trovato JSON-LD Schema.org Recipe');
        return { ...fromJsonLd(jsonLd), sourceUrl: url };
    }

    // Fallback su selettori CSS
    console.log('⚠️  JSON-LD non trovato, uso selettori CSS');
    const fallback = extractFromSelectors($);

    if (!fallback.ingredients.length && !fallback.steps.length) {
        throw new Error('Impossibile estrarre dati dalla pagina. Struttura non riconosciuta.');
    }

    return { ...fallback, sourceUrl: url };
}
