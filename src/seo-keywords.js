/**
 * SEO-KEYWORDS — Suggerimenti ricette basati su dati SEO
 *
 * Usa SerpAPI (Google Autocomplete + Organic) per suggerire ricette
 * da creare, organizzate per categoria con indicatori di popolarità.
 *
 * Provider supportati (in ordine di priorità):
 *   1. DataForSEO (volumi esatti, se configurato)
 *   2. SerpAPI Google Autocomplete (sempre disponibile)
 *
 * Cache locale: tools/data/seo-cache.json (TTL 7 giorni)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { log } from './utils/logger.js';

// ============================================================================
// SEED KEYWORDS PER CATEGORIA
// ============================================================================

const CATEGORY_SEEDS = {
    Pane: [
        'ricetta pane',
        'pane fatto in casa',
        'pane con lievito madre',
        'pane ad alta idratazione',
        'ricetta pane integrale',
        'pane senza impasto',
        'pane casereccio ricetta'
    ],
    Pizza: [
        'ricetta pizza fatta in casa',
        'impasto pizza alta idratazione',
        'pizza napoletana ricetta',
        'pizza in teglia ricetta',
        'pizza con lievito madre'
    ],
    Focaccia: [
        'ricetta focaccia',
        'focaccia genovese ricetta',
        'focaccia pugliese ricetta',
        'focaccia alta idratazione',
        'focaccia con lievito madre'
    ],
    Lievitati: [
        'ricetta brioche',
        'cornetti fatti in casa',
        'ricetta panettone',
        'burger buns ricetta',
        'babà napoletano ricetta'
    ],
    Pasta: [
        'ricetta pasta fresca',
        'pasta fatta in casa',
        'ricetta ravioli fatti in casa',
        'tagliatelle fatte in casa',
        'gnocchi fatti in casa ricetta'
    ],
    Dolci: [
        'ricetta torta',
        'dolci fatti in casa',
        'ricetta biscotti',
        'ricetta crostata',
        'tiramisù ricetta originale'
    ],
    Condimenti: [
        'salse fatte in casa',
        'olio aromatizzato ricetta',
        'condimenti per pasta',
        'salse per carne ricetta',
        'pesto fatto in casa'
    ],
    Conserve: [
        'conserve fatte in casa',
        'marmellata ricetta fai da te',
        'sottoli fatti in casa',
        'dado vegetale ricetta',
        'passata di pomodoro fatta in casa'
    ]
};

// ============================================================================
// CACHE
// ============================================================================

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 giorni
const CACHE_DIR = resolve(process.cwd(), 'data');
const CACHE_FILE = resolve(CACHE_DIR, 'seo-cache.json');

function loadCache() {
    try {
        if (existsSync(CACHE_FILE)) {
            return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
        }
    } catch { /* ignore */ }
    return {};
}

function saveCache(cache) {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

function getCachedResults(category) {
    const cache = loadCache();
    const entry = cache[category];
    if (entry && (Date.now() - entry.timestamp) < CACHE_TTL_MS) {
        log.info(`📦 Cache SEO hit per "${category}" (${entry.suggestions.length} risultati)`);
        return entry.suggestions;
    }
    return null;
}

function setCachedResults(category, suggestions) {
    const cache = loadCache();
    cache[category] = { timestamp: Date.now(), suggestions };
    saveCache(cache);
}

// ============================================================================
// SERPAPI — Google Autocomplete
// ============================================================================

async function fetchAutocomplete(seed) {
    const keys = [process.env.SERPAPI_KEY, process.env.SERPAPI_KEY_2].filter(Boolean);
    if (keys.length === 0) return [];

    for (const apiKey of keys) {
        const url = new URL('https://serpapi.com/search.json');
        url.searchParams.set('engine', 'google_autocomplete');
        url.searchParams.set('q', seed);
        url.searchParams.set('gl', 'it');
        url.searchParams.set('hl', 'it');
        url.searchParams.set('api_key', apiKey);

        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) {
                if (res.status === 429) continue; // Prova prossima chiave
                return [];
            }
            const data = await res.json();
            if (data.error && (data.error.includes('limit') || data.error.includes('exceeded'))) continue;
            return (data.suggestions || []).map(s => s.value).filter(Boolean);
        } catch (err) {
            log.warn(`Autocomplete fallito per "${seed}": ${err.message}`);
            continue;
        }
    }
    return [];
}

// ============================================================================
// SERPAPI — Google Search (per stimare popolarità)
// ============================================================================

async function fetchSearchResults(keyword) {
    const apiKey = process.env.SERPAPI_KEY || process.env.SERPAPI_KEY_2;
    if (!apiKey) return null;

    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', keyword);
    url.searchParams.set('gl', 'it');
    url.searchParams.set('hl', 'it');
    url.searchParams.set('num', '3');
    url.searchParams.set('api_key', apiKey);

    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return null;
        const data = await res.json();

        return {
            totalResults: parseInt(data.search_information?.total_results?.replace(/[.,]/g, '') || '0'),
            relatedSearches: (data.related_searches || []).map(r => r.query),
            paa: (data.related_questions || []).map(q => q.question),
        };
    } catch {
        return null;
    }
}

// ============================================================================
// DATAFORSEO — Volumi esatti (opzionale)
// ============================================================================

async function fetchDataForSEOVolumes(keywords) {
    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;
    if (!login || !password) return new Map();

    const auth = Buffer.from(`${login}:${password}`).toString('base64');

    try {
        const res = await fetch('https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify([{
                keywords: keywords.slice(0, 1000),
                language_code: 'it',
                location_code: 2380 // Italia
            }]),
            signal: AbortSignal.timeout(15000)
        });

        if (!res.ok) {
            log.warn(`DataForSEO errore ${res.status}`);
            return new Map();
        }

        const data = await res.json();
        const results = data.tasks?.[0]?.result || [];
        const volumes = new Map();

        for (const r of results) {
            if (r.keyword && r.search_volume) {
                volumes.set(r.keyword.toLowerCase(), {
                    volume: r.search_volume,
                    competition: r.competition,
                    cpc: r.cpc
                });
            }
        }

        log.info(`📊 DataForSEO: ${volumes.size} volumi recuperati`);
        return volumes;
    } catch (err) {
        log.warn(`DataForSEO fallito: ${err.message}`);
        return new Map();
    }
}

// ============================================================================
// STIMA POPOLARITÀ DA TOTAL RESULTS
// ============================================================================

function estimatePopularity(totalResults) {
    if (!totalResults) return { score: 50, label: 'Medio', emoji: '📊' };
    if (totalResults > 50_000_000) return { score: 95, label: 'Altissima', emoji: '🔥' };
    if (totalResults > 10_000_000) return { score: 85, label: 'Molto Alta', emoji: '🔥' };
    if (totalResults > 5_000_000)  return { score: 75, label: 'Alta', emoji: '📈' };
    if (totalResults > 1_000_000)  return { score: 60, label: 'Media', emoji: '📊' };
    if (totalResults > 100_000)    return { score: 40, label: 'Bassa', emoji: '📉' };
    return { score: 20, label: 'Nicchia', emoji: '🔬' };
}

// ============================================================================
// FILTRI — Escludi ricette già esistenti
// ============================================================================

function loadExistingRecipes() {
    try {
        const ricettarioPath = resolve(
            process.cwd(),
            process.env.RICETTARIO_PATH || '../Ricettario'
        );
        const recipesFile = resolve(ricettarioPath, 'public', 'recipes.json');
        if (!existsSync(recipesFile)) return [];

        const data = JSON.parse(readFileSync(recipesFile, 'utf-8'));
        const recipes = Array.isArray(data) ? data : (data.recipes || []);
        return recipes.map(r => (r.title || r.name || '').toLowerCase());
    } catch { return []; }
}

function isAlreadyCreated(keyword, existingTitles) {
    const kw = keyword.toLowerCase();
    return existingTitles.some(title =>
        title.includes(kw) || kw.includes(title) ||
        levenshteinSimilarity(kw, title) > 0.7
    );
}

function levenshteinSimilarity(a, b) {
    if (!a.length || !b.length) return 0;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1;

    const costs = [];
    for (let i = 0; i <= longer.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= shorter.length; j++) {
            if (i === 0) { costs[j] = j; }
            else if (j > 0) {
                let newValue = costs[j - 1];
                if (longer[i - 1] !== shorter[j - 1]) {
                    newValue = Math.min(newValue, lastValue, costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) costs[shorter.length] = lastValue;
    }
    return 1 - costs[shorter.length] / longer.length;
}

// ============================================================================
// MAIN: Genera suggerimenti per una categoria
// ============================================================================

/**
 * @param {string} category - Nome categoria (Pane, Pizza, etc.)
 * @param {object} options
 * @param {boolean} options.forceRefresh - Ignora cache
 * @param {boolean} options.withVolumes - Usa DataForSEO per volumi esatti
 * @returns {Promise<Array<{keyword, popularity, volume?, competition?, category, alreadyCreated}>>}
 */
export async function getSeoSuggestions(category, options = {}) {
    const { forceRefresh = false, withVolumes = false } = options;

    // Check cache
    if (!forceRefresh) {
        const cached = getCachedResults(category);
        if (cached) return cached;
    }

    let seeds = CATEGORY_SEEDS[category];
    if (!seeds) {
        // Dynamic fallback seeds for new AI categories
        const catLow = category.toLowerCase();
        seeds = [`ricetta ${catLow}`, `${catLow} fatti in casa`, `come preparare ${catLow}`];
    }

    log.info(`🔍 SEO: cerco suggerimenti per "${category}" (${seeds.length} seed)...`);

    // Step 1: Google Autocomplete per ogni seed
    const allSuggestions = new Set();
    const autocompleteResults = await Promise.all(
        seeds.map(seed => fetchAutocomplete(seed))
    );

    for (const suggestions of autocompleteResults) {
        for (const s of suggestions) allSuggestions.add(s);
    }
    // Aggiungi anche i seed stessi
    for (const seed of seeds) allSuggestions.add(seed);

    log.info(`📋 ${allSuggestions.size} keyword uniche trovate via Autocomplete`);

    // Step 2: Filtra keyword pertinenti
    const recipeKeywords = Array.from(allSuggestions).filter(kw => {
        const lower = kw.toLowerCase();
        // Deve contenere qualcosa di pertinente al food
        return lower.includes('ricetta') || lower.includes('fatto') ||
               lower.includes('casa') || lower.includes('impasto') ||
               lower.includes('lievit') || lower.includes('come fare') ||
               lower.includes('preparare') || lower.includes('ingredienti') ||
               seeds.some(s => lower.includes(s.split(' ').pop()));
    });

    // Step 3: Controlla ricette già esistenti
    const existingTitles = loadExistingRecipes();

    // Step 4: DataForSEO volumi (opzionale)
    let volumes = new Map();
    if (withVolumes || process.env.DATAFORSEO_LOGIN) {
        volumes = await fetchDataForSEOVolumes(recipeKeywords);
    }

    // Step 5: Stima popolarità tramite heuristic (autocomplete order = popularity proxy)
    const suggestions = recipeKeywords.map((keyword, index) => {
        const volumeData = volumes.get(keyword.toLowerCase());
        const alreadyCreated = isAlreadyCreated(keyword, existingTitles);

        // Autocomplete ordina per popolarità — le prime sono le più cercate
        const autocompleteScore = Math.max(100 - index * 3, 10);

        return {
            keyword,
            popularity: volumeData
                ? { score: Math.min(volumeData.volume / 100, 100), label: `${volumeData.volume.toLocaleString('it')}/mese`, emoji: '📊' }
                : { score: autocompleteScore, label: `Top ${Math.min(index + 1, 50)}`, emoji: index < 5 ? '🔥' : '📈' },
            volume: volumeData?.volume || null,
            competition: volumeData?.competition || null,
            cpc: volumeData?.cpc || null,
            category,
            alreadyCreated,
            source: volumeData ? 'dataforseo' : 'autocomplete'
        };
    });

    // Ordina: volumi reali > autocomplete score, non-create prima
    suggestions.sort((a, b) => {
        if (a.alreadyCreated !== b.alreadyCreated) return a.alreadyCreated ? 1 : -1;
        if (a.volume && b.volume) return b.volume - a.volume;
        return b.popularity.score - a.popularity.score;
    });

    // Limita a 30 risultati
    const finalSuggestions = suggestions.slice(0, 30);

    // Salva in cache
    setCachedResults(category, finalSuggestions);

    log.info(`✅ SEO: ${finalSuggestions.length} suggerimenti per "${category}" (${finalSuggestions.filter(s => !s.alreadyCreated).length} nuove)`);

    return finalSuggestions;
}

/**
 * Categorie disponibili
 */
export function getAvailableCategories() {
    // Ritorna le categorie base note + caricate da loadExistingRecipes dinamicamente? 
    // In realtà, questo viene ora saltato in routes.js come limite stringente,
    // ma ritorna i default di base per sicurezza.
    return Object.keys(CATEGORY_SEEDS);
}
