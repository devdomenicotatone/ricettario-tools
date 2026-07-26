/**
 * VALIDATOR PRO — Validazione ricette con fonti reali
 * 
 * Cross-check delle ricette generate da Claude contro siti autorevoli italiani.
 * Usa SerpAPI per trovare fonti + scraping HTML per estrarre dati strutturati.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, basename } from 'path';
import { callClaude, parseClaudeJson } from './utils/api.js';
import { elencaRicetteJson } from './verify.js';

// ── Configurazione ──────────────────────────────────────────────────

// ── FONTI PROFESSIONALI & FORUM (priorità massima) ──
const FORUM_DOMAINS = [
    // Forum pizza & panificazione italiani
    'forum.pizza.it',               // Forum pizzaioli PRO
    'pizzanapoletana.org',           // AVPN — Verace Pizza Napoletana
    'forumpanificazione.it',         // Forum panificazione artigianale
    'panperfocaccia.eu',             // Pan per Focaccia — community lievitisti
    'forumfree.it',                  // ForumFree (Confraternita Pizza, Buona Pizza, etc.)
    'forumdiagraria.org',            // Agraria — pane e lievitati
    'lamadia.com',                   // Pane in Piazza — forum nazionale pane
    'pizzamonamour.it',              // Pizza Mon Amour — ricette professionali
    'coquinaria.it',                 // Forum storico cucina italiana (pasta, pane)
    'mrcarota.it',                   // ScambiaRicette — sezione pasta di semola
    // Forum pastaioli & pasta fresca
    'pastaitaliani.it',              // Associazione Pastai Italiani (110+ aziende)
    'pastaepastai.it',               // APPAFRE — produttori pasta fresca
    'kenwoodclub.it',                // Community pasta maker & impastatrici
    'pastagrannies.com',             // Tradizione pasta fresca — nonne italiane
    // Forum internazionali (EN — cucina italiana)
    'thefreshloaf.com',              // Forum panificazione artigianale
    'pizzamaking.com',               // Forum pizza making
    'fornobravo.com',                // Community forno a legna
    'egullet.org',                   // eGullet — Italy: Cooking & Baking
    'cheftalk.com',                  // ChefTalk — cucina professionale
    'reddit.com/r/pasta',            // Reddit r/pasta
    'reddit.com/r/AskCulinary',      // Reddit r/AskCulinary
    'reddit.com/r/Breadit',          // Reddit r/Breadit (pane)
    // Wikipedia & enciclopedie
    'it.wikipedia.org',              // Wikipedia italiano
    'en.wikipedia.org',              // Wikipedia inglese (cucina italiana)
    // Fonti istituzionali & accademie
    'academia.barilla.it',           // Fonte ufficiale pasta
    'accademiaitalianacucina.it',    // Accademia Italiana della Cucina
    'academiadelpane.it',            // Accademia del Pane
    // Mulini — schede tecniche farine e semole
    'moliniromagnoli.it',
    'molinograssi.it',
    'mulinomarino.it',
    'molinocaputo.it',               // Standard napoletano
    'molinoquaglia.it',
    'caputoflour.com',               // Caputo (sito EN — ricette dettagliate)
];

// ── SITI RICETTE (fonti secondarie) ──
const RECIPE_DOMAINS = [
    // Siti italiani principali
    'giallozafferano.it',
    'ricettedellanonna.net',
    'cucchiaio.it',
    'soniaperonaci.it',
    'dissapore.com',
    'agrodolce.it',
    'cookist.it',
    'fattoincasadabenedetta.it',
    'misya.info',
    'blog.giallozafferano.it',
    'salepepe.it',                   // Sale&Pepe
    'cookaround.com',                // CookAround — ricette dettagliate
    'tavolartegusto.it',             // TavolArtegusto
    'antoniettapolcaro.it',          // Blog pasta tradizionale pugliese
    // Fonti editoriali italiane
    'lucianopignataro.it',           // Critico gastronomico napoletano
    'ricette.corriere.it',           // Corriere della Sera — cucina
    'ilgamberorosso.it',             // Gambero Rosso
    'lacucinaitaliana.it',           // La Cucina Italiana (storica)
    'italiangourmet.it',             // Italian Gourmet magazine
    // Fonti internazionali (EN) — cucina italiana
    'eataly.net',                    // Eataly — ricette ufficiali
    'food52.com',                    // Food52 — Italian recipes
    'seriouseats.com',               // Serious Eats — analisi tecniche
    'finedininglovers.it',           // Fine Dining Lovers (S.Pellegrino)
    'ciaoitalia.com',                // Ciao Italia — show TV americano cucina italiana
    'leitesculinaria.com',           // Leite's Culinaria — ricette validate
];

// Unione per compatibilità
const AUTHORITATIVE_DOMAINS = [...FORUM_DOMAINS, ...RECIPE_DOMAINS];

const MAX_SOURCES = 10;
const SCRAPE_TIMEOUT = 10000; // 10 secondi

// Domini inutili da IGNORARE (walled gardens, social, niente dati ricetta)
const BLOCKED_DOMAINS = [
    'facebook.com', 'instagram.com', 'youtube.com', 'tiktok.com',
    'twitter.com', 'x.com', 'pinterest.com', 'linkedin.com',
    'amazon.com', 'amazon.it', 'ebay.it', 'ebay.com',
    'google.com', 'google.it',
];

// ── 1. Ricerca fonti reali via SerpAPI (4x Google Search: IT+EN) ────

/**
 * Quante volte abbiamo davvero interrogato SerpAPI da quando gira il processo.
 *
 * Serve alla pausa anti-rate-limit di `validateAllRecipes`: aspettare due
 * secondi ha senso solo dopo aver consumato quota, non dopo una ricetta che è
 * fallita prima di chiamare (JSON illeggibile, `SERPAPI_KEY` mancante). Su un
 * elenco di 80 ricette quelle pause a vuoto sono minuti di attesa per niente.
 */
let chiamateSerpApi = 0;

/** Numero di query SerpAPI effettuate finora (solo lettura). */
export function contatoreChiamateSerpApi() {
    return chiamateSerpApi;
}

/**
 * Cerca fonti reali per una ricetta tramite SerpAPI
 * 4 query Google Search parallele con keyword strategiche diverse
 * per massimizzare la diversità di fonti con dati strutturati (JSON-LD)
 * @param {string} recipeName - Nome della ricetta
 * @returns {Promise<Array<{title, url, domain, snippet}>>}
 */
export async function searchRealSources(recipeName) {
    // Rotazione API key round-robin
    const keys = [process.env.SERPAPI_KEY, process.env.SERPAPI_KEY_2].filter(Boolean);
    if (keys.length === 0) throw new Error('SERPAPI_KEY non trovata nel .env');

    const englishName = getEnglishName(recipeName);

    // 4 query mirate con keyword diverse per risultati diversificati
    // Q1: IT — generica "ricetta" (cattura giallozafferano, cookist, misya, etc.)
    const q1 = `ricetta ${recipeName} ingredienti dosi`;
    // Q2: IT — tradizionale/regionale (cattura fonti autorevoli, blog storici)
    const q2 = `${recipeName} ricetta tradizionale originale preparazione`;
    // Q3: EN — recipe + ratios (cattura seriouseats, food52, eataly, etc.)
    const q3 = `authentic Italian ${englishName} recipe ingredients`;
    // Q4: IT — proporzioni e tecnica (cattura mulini, accademie, dissapore)
    const q4 = `${recipeName} proporzioni farina acqua tecnica impasto`;

    // Distribuisci le query tra le 2 chiavi
    const [r1, r2, r3, r4] = await Promise.all([
        serpSearch(keys[0], q1),
        serpSearch(keys[keys.length > 1 ? 1 : 0], q2),
        serpSearch(keys[0], q3, 'en', 'us'),
        serpSearch(keys[keys.length > 1 ? 1 : 0], q4),
    ]);

    // Merge, deduplica per URL, e filtra domini inutili
    const seen = new Set();
    const allResults = [];
    for (const r of [...r1, ...r2, ...r3, ...r4]) {
        if (seen.has(r.url)) continue;
        // Ignora social e walled gardens (mai dati utili)
        if (BLOCKED_DOMAINS.some(d => r.domain.includes(d))) continue;
        seen.add(r.url);
        allResults.push(r);
    }

    // Ranking per dominio autorevole
    allResults.sort((a, b) => getDomainScore(b.domain) - getDomainScore(a.domain));

    return allResults.slice(0, MAX_SOURCES);
}

/**
 * Singola query SerpAPI (supporta lingua e paese)
 */
async function serpSearch(apiKey, query, lang = 'it', country = 'it') {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('q', query);
    url.searchParams.set('num', '10');
    url.searchParams.set('hl', lang);
    url.searchParams.set('gl', country);
    url.searchParams.set('engine', 'google');

    chiamateSerpApi++;   // da qui in poi la quota è consumata, anche se la risposta non serve
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    if (data.error) return [];

    return (data.organic_results || []).map(r => ({
        title: r.title,
        url: r.link,
        domain: new URL(r.link).hostname.replace('www.', ''),
        snippet: r.snippet || '',
    }));
}

/**
 * Query SerpAPI con engine google_forums
 * Restituisce link ai post di forum con snippet testuale (contengono dati utili)
 */
async function serpForumSearch(apiKey, query, lang = 'it', country = 'it') {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('q', query);
    url.searchParams.set('hl', lang);
    url.searchParams.set('gl', country);
    url.searchParams.set('engine', 'google_forums');

    try {
        chiamateSerpApi++;   // vale anche qui: la query parte, la quota si consuma
        const res = await fetch(url);
        if (!res.ok) return [];

        const data = await res.json();
        if (data.error) return [];

        const results = (data.organic_results || []).map(r => {
            // Raccogli tutti gli snippet (principale + sitelinks)
            const snippets = [r.snippet || ''];
            if (r.sitelinks?.list) {
                r.sitelinks.list.forEach(sl => {
                    if (sl.title) snippets.push(sl.title);
                });
            }
            const fullText = snippets.join(' ');

            return {
                title: r.title || '',
                url: r.link || '',
                domain: r.link ? new URL(r.link).hostname.replace('www.', '') : '',
                snippet: fullText,
                forumData: {
                    source: r.source || '',
                    displayedMeta: r.displayed_meta || '',
                    extractedIngredients: extractIngredientsFromText(fullText),
                },
            };
        });

        console.log(`   🗣️  Forum API (${lang}): ${results.length} discussioni trovate`);
        return results;
    } catch {
        return [];
    }
}

/**
 * Estrai ingredienti da testo libero (snippet forum, post, commenti)
 * Cerca pattern comuni: "500g farina", "acqua 300ml", "lievito 3g", etc.
 */
function extractIngredientsFromText(text) {
    if (!text) return [];
    const ingredients = [];

    // Pattern IT: "500g di farina", "300 ml acqua", "3g lievito"
    const itPattern = /(\d+[\.,]?\d*)\s*(g|gr|kg|ml|cl|l|cucchiai?o?|pizzic\w*)\s+(?:di\s+)?([a-zA-ZÀ-ú\s]{3,25})/gi;
    let m;
    while ((m = itPattern.exec(text)) !== null) {
        ingredients.push(`${m[1]}${m[2]} ${m[3].trim()}`);
    }

    // Pattern EN: "500g flour", "300ml water"
    const enPattern = /(\d+[\.,]?\d*)\s*(g|gr|kg|ml|cups?|tbsp|tsp|oz)\s+(?:of\s+)?([a-zA-Z\s]{3,25})/gi;
    while ((m = enPattern.exec(text)) !== null) {
        ingredients.push(`${m[1]}${m[2]} ${m[3].trim()}`);
    }

    // Pattern senza unità: "farina 00", "semola rimacinata", "acqua tiepida"
    const commonIngredients = [
        'farina', 'semola', 'acqua', 'sale', 'lievito', 'olio', 'uova', 'uovo',
        'burro', 'strutto', 'grano', 'flour', 'water', 'salt', 'yeast', 'oil',
        'egg', 'butter', 'durum', 'semolina', 'olive oil', 'ricotta',
    ];
    for (const ing of commonIngredients) {
        if (text.toLowerCase().includes(ing) && !ingredients.some(i => i.toLowerCase().includes(ing))) {
            ingredients.push(ing);
        }
    }

    return [...new Set(ingredients)];
}

/**
 * Mappa nomi ricette italiane → inglesi per query internazionali
 */
function getEnglishName(italianName) {
    const map = {
        'orecchiette': 'orecchiette',
        'pici': 'pici pasta',
        'tajarin': 'tajarin egg pasta Piedmont',
        'tagliatelle': 'tagliatelle egg pasta Bologna',
        'fusilli': 'fusilli pasta',
        'malloreddus': 'malloreddus Sardinian gnocchi',
        'pappardelle': 'pappardelle egg pasta Tuscany',
        'linguine': 'linguine pasta semolina',
        'spaghetti': 'spaghetti pasta durum wheat',
        'rigatoni': 'rigatoni pasta',
        'maccheroni': 'maccheroni pasta',
        'gnocco': 'gnocchi pasta',
        'pizzoccheri': 'pizzoccheri buckwheat pasta Valtellina',
        'pane': 'Italian bread',
        'pane integrale': 'Italian whole wheat bread biga',
        'pane casalingo': 'Italian country bread homemade',
        'pane noci': 'Italian walnut olive bread',
    };
    const lower = italianName.toLowerCase();
    for (const [key, val] of Object.entries(map)) {
        if (lower.includes(key)) return val;
    }
    // Fallback: usa il nome italiano com'è (molti formati sono universali)
    return italianName;
}

/**
 * Punteggio dominio: forum PRO = 10, fonti ufficiali = 8, blog = 3, altro = 1
 */
function getDomainScore(domain) {
    if (FORUM_DOMAINS.some(d => domain.includes(d))) return 10;
    if (RECIPE_DOMAINS.some(d => domain.includes(d))) return 3;
    // Bonus per Wikipedia e fonti istituzionali
    if (domain.includes('wikipedia')) return 8;
    return 1;
}

// ── 2. Scraping e parsing ricette ───────────────────────────────────

/**
 * Scarica e parsa una pagina di ricetta
 * Strategia a 2 livelli: fetch + fallback browser headless
 * @param {string} url - URL della pagina
 * @returns {Promise<Object|null>} Dati estratti o null
 */
export async function scrapeRecipePage(url) {
    // ── Livello 1: fetch classico ──
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT);

        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
            },
        });
        clearTimeout(timeout);

        if (!res.ok) return null;

        const html = await res.text();
        const data = await extractRecipeData(html, url);

        // Se ha trovato ingredienti, usa questi dati
        if (data && data.ingredients?.length > 0) {
            return data;
        }
    } catch {
        // Timeout, rete, etc. — provo con browser
    }

    // ── Livello 2: fallback browser headless STEALTH (anti-bot bypass) ──
    try {
        const puppeteerExtra = await import('puppeteer-extra');
        const StealthPlugin = await import('puppeteer-extra-plugin-stealth');
        puppeteerExtra.default.use(StealthPlugin.default());

        const browser = await puppeteerExtra.default.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
            ],
        });

        try {
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
            await page.waitForSelector('h1', { timeout: 5000 }).catch(() => { });

            const html = await page.content();
            const data = await extractRecipeData(html, url);

            if (data && data.ingredients?.length > 0) {
                data.source = (data.source || 'html') + '+stealth';
                return data;
            }
        } finally {
            await browser.close();
        }
    } catch {
        // Browser non disponibile o errore — silenzioso
    }

    return null;
}

/**
 * Estrae dati ricetta da HTML
 * Prima cerca JSON-LD (Schema.org/Recipe), poi fallback Claude AI
 */
export async function extractRecipeData(html, sourceUrl) {
    // ── Tentativo 1: JSON-LD Schema.org/Recipe ──
    const jsonLdData = extractJsonLd(html);
    if (jsonLdData) {
        return {
            source: 'json-ld',
            url: sourceUrl,
            ...jsonLdData,
        };
    }

    // ── Tentativo 2: Claude AI estrae ingredienti da testo grezzo ──
    const plainText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 3000); // Limita per costi/velocità

    if (plainText.length < 50) {
        return { source: 'empty', url: sourceUrl, name: '', ingredients: [] };
    }

    try {
        const result = await extractWithClaude(plainText, sourceUrl);
        return {
            source: 'claude-ai',
            url: sourceUrl,
            ...result,
        };
    } catch {
        // Se Claude fallisce, ritorna vuoto
        return { source: 'failed', url: sourceUrl, name: '', ingredients: [] };
    }
}

/**
 * Estrae ingredienti da testo grezzo usando Claude AI
 * Funziona con qualsiasi formato: forum, blog, articoli, tabelle, testo narrativo
 */
async function extractWithClaude(plainText, sourceUrl) {
    const response = await callClaude({
        model: 'claude-sonnet-4-5-20250929',
        maxTokens: 1024,
        system: `Sei un estrattore di ingredienti da ricette. Ricevi testo grezzo da una pagina web e devi estrarre SOLO la lista ingredienti.
Rispondi ESCLUSIVAMENTE con un JSON valido nel formato:
{"name": "Nome Ricetta", "ingredients": ["500g farina", "300ml acqua", ...], "servings": "4", "prepTime": "30min"}
Se non trovi ingredienti, rispondi: {"name": "", "ingredients": []}
NON aggiungere testo, spiegazioni o commenti. SOLO il JSON.`,
        messages: [{
            role: 'user',
            content: `Estrai gli ingredienti da questo testo di una pagina web (${sourceUrl}):\n\n${plainText}`
        }],
    });

    const parsed = parseClaudeJson(response);

    // Normalizza ingredienti
    if (parsed.ingredients && Array.isArray(parsed.ingredients)) {
        parsed.ingredients = parsed.ingredients.map(i =>
            typeof i === 'string' ? i.trim() : (i.text || i.name || String(i)).trim()
        ).filter(i => i.length > 0);
    } else {
        parsed.ingredients = [];
    }

    return parsed;
}

/**
 * Estrae dati da blocchi JSON-LD (usati da GialloZafferano, Cookist, etc.)
 */
function extractJsonLd(html) {
    // Trova tutti i blocchi <script type="application/ld+json">
    const ldRegex = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;

    while ((match = ldRegex.exec(html)) !== null) {
        try {
            let data = JSON.parse(match[1]);

            // Gestisci array di oggetti (come fa GialloZafferano)
            if (Array.isArray(data)) {
                data = data.find(d => d['@type'] === 'Recipe') || null;
            }
            // Gestisci @graph (come fa Yoast SEO)
            if (data?.['@graph']) {
                data = data['@graph'].find(d => d['@type'] === 'Recipe') || null;
            }

            if (data && data['@type'] === 'Recipe') {
                return {
                    name: data.name || '',
                    ingredients: normalizeIngredients(data.recipeIngredient || []),
                    prepTime: parseDuration(data.prepTime),
                    cookTime: parseDuration(data.cookTime),
                    totalTime: parseDuration(data.totalTime),
                    servings: data.recipeYield?.toString() || '',
                    steps: extractStepsFromJsonLd(data.recipeInstructions),
                };
            }
        } catch {
            continue;
        }
    }

    return null;
}

/**
 * Fallback: estrai ingredienti e dati da HTML raw con regex
 */
function extractFromHtml(html) {
    const ingredients = [];
    const data = { name: '', ingredients: [], prepTime: '', cookTime: '', servings: '', steps: [] };

    // Titolo dalla pagina
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) data.name = titleMatch[1].replace(/\s*[-|–].*$/, '').trim();

    // Cerca pattern ingredienti comuni in siti italiani
    // Pattern: <li> con quantità (g, ml, kg, cucchiai, etc.)
    const ingredientRegex = /<li[^>]*>([^<]*(?:\d+\s*(?:g|gr|ml|kg|cl|l|cucchia[io]|pizzic|q\.?b|n\.?\s*\d))[^<]*)<\/li>/gi;
    let ingMatch;
    while ((ingMatch = ingredientRegex.exec(html)) !== null) {
        const cleaned = ingMatch[1].replace(/<[^>]+>/g, '').trim();
        if (cleaned.length > 3 && cleaned.length < 200) {
            ingredients.push(cleaned);
        }
    }

    // Pattern alternativo: cerca in blocchi con classe "ingredient"
    const classIngRegex = /class="[^"]*ingredient[^"]*"[^>]*>([^<]+)/gi;
    while ((ingMatch = classIngRegex.exec(html)) !== null) {
        const cleaned = ingMatch[1].trim();
        if (cleaned.length > 3 && !ingredients.includes(cleaned)) {
            ingredients.push(cleaned);
        }
    }

    data.ingredients = normalizeIngredients(ingredients);
    return data;
}

// ── 3. Confronto cross-source ───────────────────────────────────────

/**
 * Confronta la ricetta di Claude con le fonti reali
 * @param {Object} claudeRecipe - Ricetta generata
 * @param {Array} realSources - Dati dalle fonti reali
 * @returns {Object} Risultato del confronto
 */
export function compareRecipes(claudeRecipe, realSources) {
    const validSources = realSources.filter(Boolean);
    if (validSources.length === 0) {
        return {
            confidence: 0,
            message: 'Nessuna fonte reale trovata per il confronto',
            matches: [],
            warnings: ['Impossibile validare — nessuna fonte disponibile'],
            sources: [],
        };
    }

    const matches = [];
    const warnings = [];
    const details = [];

    // ── Confronto ingredienti ──
    const rawIngs = claudeRecipe.ingredients || [];
    const claudeIngs = normalizeIngredients(
        rawIngs.map(i => typeof i === 'string' ? i : (i?.name || i?.item || ''))
    );

    // Raccolta ingredienti da tutte le fonti
    const allSourceIngs = [];
    validSources.forEach(s => {
        if (s?.ingredients?.length) allSourceIngs.push(...s.ingredients);
    });

    // Per ogni ingrediente di Claude, cerca una corrispondenza nelle fonti
    let ingMatchCount = 0;
    const ingAnalysis = [];
    for (const ci of claudeIngs) {
        const found = allSourceIngs.some(si => ingredientMatch(ci, si));
        if (found) {
            ingMatchCount++;
            ingAnalysis.push({ ingredient: ci, status: '✅', note: 'Confermato da fonti' });
        } else {
            ingAnalysis.push({ ingredient: ci, status: '⚠️', note: 'Non trovato nelle fonti' });
        }
    }

    const ingScore = claudeIngs.length > 0 ? (ingMatchCount / claudeIngs.length) * 100 : 0;
    if (ingScore >= 70) {
        matches.push(`Ingredienti: ${ingMatchCount}/${claudeIngs.length} confermati (${Math.round(ingScore)}%)`);
    } else if (ingScore > 0) {
        warnings.push(`Ingredienti: solo ${ingMatchCount}/${claudeIngs.length} confermati (${Math.round(ingScore)}%)`);
    }

    // ── Confronto idratazione ──
    const claudeHydration = parseFloat(claudeRecipe.hydration);
    if (!isNaN(claudeHydration)) {
        const sourceHydrations = extractHydrations(validSources);
        if (sourceHydrations.length > 0) {
            const avgHydration = sourceHydrations.reduce((a, b) => a + b, 0) / sourceHydrations.length;
            const diff = Math.abs(claudeHydration - avgHydration);
            if (diff <= 5) {
                matches.push(`Idratazione: ${claudeHydration}% (media fonti: ${Math.round(avgHydration)}%) — ✅ OK`);
            } else if (diff <= 10) {
                warnings.push(`Idratazione: ${claudeHydration}% vs media fonti ${Math.round(avgHydration)}% (differenza ${Math.round(diff)}%)`);
            } else {
                warnings.push(`⚠️ Idratazione significativamente diversa: ${claudeHydration}% vs media fonti ${Math.round(avgHydration)}%`);
            }
        }
    }

    // ── Confronto tempi ──
    const claudePrep = claudeRecipe.fermentation || claudeRecipe.prepTime || '';
    const sourceTimes = validSources.filter(s => s.prepTime || s.totalTime).map(s => s.prepTime || s.totalTime);
    if (sourceTimes.length > 0) {
        details.push(`Tempi fonti: ${sourceTimes.join(', ')}`);
        details.push(`Tempo Claude: ${claudePrep}`);
    }

    // ── Calcolo score finale ──
    let confidence = 0;

    // Peso fonti per qualità dati
    const richSources = validSources.filter(s => s.source === 'json-ld' || (s.ingredients?.length >= 5));
    const otherSources = validSources.filter(s => s.source !== 'json-ld' && (s.ingredients?.length || 0) < 5);

    // Base: fonti ricche (JSON-LD o 5+ ingredienti) = 8pt, altre = 4pt (max 30)
    const sourceScore = richSources.length * 8 + otherSources.length * 4;
    confidence += Math.min(sourceScore, 30);

    // Ingredienti match (max 40 punti)
    confidence += (ingScore / 100) * 40;

    // JSON-LD (bonus 15 punti per dati strutturati)
    const jsonLdCount = validSources.filter(s => s.source === 'json-ld').length;
    confidence += Math.min(jsonLdCount * 5, 15);

    // Domini autorevoli (max 15 punti)
    const authCount = validSources.filter(s =>
        AUTHORITATIVE_DOMAINS.some(d => s.url?.includes(d))
    ).length;
    confidence += Math.min(authCount * 5, 15);

    confidence = Math.min(Math.round(confidence), 100);

    return {
        confidence,
        matches,
        warnings,
        details,
        ingredientAnalysis: ingAnalysis,
        sourcesUsed: validSources.map(s => ({
            url: s.url,
            domain: new URL(s.url).hostname.replace('www.', ''),
            dataQuality: s.source === 'json-ld' ? 'Dati strutturati' : s.source === 'forum-api' ? 'Forum API' : 'Estrazione HTML',
            ingredientsFound: s.ingredients?.length || 0,
        })),
    };
}

// ── 4. Report ───────────────────────────────────────────────────────

/**
 * Genera un report di validazione in formato markdown
 */
export function generateReport(recipeName, comparison) {
    const { confidence, matches, warnings, ingredientAnalysis, sourcesUsed, details } = comparison;

    const emoji = confidence >= 75 ? '🟢' : confidence >= 50 ? '🟡' : '🔴';

    let report = `# Validazione: ${recipeName}\n\n`;
    report += `## ${emoji} Confidenza: ${confidence}%\n\n`;
    report += `**Fonti consultate:** ${sourcesUsed.length}\n\n`;

    if (matches.length > 0) {
        report += `### ✅ Confermato\n`;
        matches.forEach(m => { report += `- ${m}\n`; });
        report += '\n';
    }

    if (warnings.length > 0) {
        report += `### ⚠️ Attenzione\n`;
        warnings.forEach(w => { report += `- ${w}\n`; });
        report += '\n';
    }

    if (ingredientAnalysis?.length > 0) {
        report += `### 📋 Ingredienti\n`;
        report += `| Status | Ingrediente | Note |\n|--------|-------------|------|\n`;
        ingredientAnalysis.forEach(i => {
            report += `| ${i.status} | ${i.ingredient} | ${i.note} |\n`;
        });
        report += '\n';
    }

    if (details?.length > 0) {
        report += `### 📊 Dettagli\n`;
        details.forEach(d => { report += `- ${d}\n`; });
        report += '\n';
    }

    report += `### 📰 Fonti\n`;
    sourcesUsed.forEach((s, i) => {
        report += `${i + 1}. **${s.domain}** — ${s.dataQuality} (${s.ingredientsFound} ingredienti)\n`;
        report += `   ${s.url}\n`;
    });

    return report;
}

// ── 5. Funzione principale: valida una ricetta ─────────────────────

/**
 * Valida una ricetta completa: cerca, scrappa, confronta, report
 * @param {Object} recipe - Ricetta da validare (oggetto con title, ingredients, etc.)
 * @returns {Promise<Object>} Risultato validazione con report
 */
export async function validateRecipe(recipe) {
    const name = recipe.title || recipe.name || 'Ricetta';
    console.log(`\n🔍 Validazione: "${name}"...`);

    // Step 1: Cerca fonti reali
    console.log('   📡 Cerco fonti reali su Google...');
    const sources = await searchRealSources(name);
    console.log(`   ✅ Trovate ${sources.length} fonti\n`);

    // Step 2: Scrappa ogni fonte
    const scrapedData = [];
    for (const source of sources) {
        process.stdout.write(`   🌐 Scraping ${source.domain}... `);
        const data = await scrapeRecipePage(source.url);
        if (data && (data.ingredients?.length > 0)) {
            scrapedData.push(data);
            console.log(`✅ ${data.ingredients.length} ingredienti (${data.source})`);
        } else {
            console.log('❌ nessun dato utile');
        }

        // Pausa tra le richieste per rispetto
        await sleep(500);
    }

    // Step 3: Confronta
    console.log(`\n   🔬 Confronto con ${scrapedData.length} fonti valide...`);
    const comparison = compareRecipes(recipe, scrapedData);

    // Step 4: Genera report
    const report = generateReport(name, comparison);

    const emoji = comparison.confidence >= 75 ? '🟢' : comparison.confidence >= 50 ? '🟡' : '🔴';
    console.log(`\n   ${emoji} Confidenza: ${comparison.confidence}%`);

    if (comparison.matches.length > 0) {
        comparison.matches.forEach(m => console.log(`   ✅ ${m}`));
    }
    if (comparison.warnings.length > 0) {
        comparison.warnings.forEach(w => console.log(`   ⚠️  ${w}`));
    }

    return { comparison, report };
}

// ── 6. Valida ricetta da file JSON ──────────────────────────────────

// Qui viveva `parseRecipeHtml`: leggeva la ricetta da una pagina HTML del sito
// (`<table class="ingredients-table">`, `basename(filePath, '.html')`) — un
// formato che il sito non produce più da quando è una SPA, e che nessun file
// del progetto chiamava più dopo il passaggio ai .json. Restava lì a suggerire
// che esistesse un secondo modo di leggere una ricetta: due parser per lo
// stesso lavoro, di cui uno già divergente. La lettura di una ricetta dal
// disco è `parseRecipeJson`, qui sotto, e basta quella.

/**
 * Estrae i dati di una ricetta dal suo JSON (formato SPA).
 *
 * È l'unico modo di leggere una ricetta dal disco: il confronto con le fonti
 * riceve sempre questa forma, qualunque sia il chiamante.
 */
export function parseRecipeJson(filePath) {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));

    // ── Ingredienti: solo i nomi, il confronto lavora per parole chiave ──
    const ingredients = [];
    for (const gruppo of data.ingredientGroups || []) {
        for (const item of gruppo.items || []) {
            if (item?.name) ingredients.push(item.name);
        }
    }
    for (const item of data.ingredients || []) {
        if (typeof item === 'string') ingredients.push(item);
        else if (item?.name) ingredients.push(item.name);
    }
    for (const s of data.suspensions || []) {
        if (s?.name) ingredients.push(s.name);
    }

    // Categoria: nel JSON, altrimenti dalla cartella che lo contiene
    const catDaCartella = filePath.replace(/\\/g, '/').split('/').slice(-2)[0] || '';

    return {
        title: data.title || basename(filePath, '.json'),
        ingredients,
        hydration: data.hydration != null ? String(data.hydration) : '',
        fermentation: data.fermentation || '',
        category: data.category || catDaCartella,
        filePath,
    };
}

// ── 7. Valida tutte le ricette nella cartella ───────────────────────

/**
 * Valida tutte le ricette (JSON) di una cartella `ricette/`
 * @throws {Error} se non c'è nessuna ricetta da validare
 */
export async function validateAllRecipes(ricettarioPath) {
    const ricettePath = resolve(ricettarioPath, 'ricette');
    const results = [];

    // Stesso elenco usato dalla verifica: JSON delle ricette, senza i sidecar
    const ricette = elencaRicetteJson(ricettePath);
    console.log(`\n📂 ${ricette.length} ricette da validare in ${ricettePath}`);

    for (const [indice, { file, filePath }] of ricette.entries()) {
        console.log(`\n${'═'.repeat(60)}`);

        const chiamatePrima = chiamateSerpApi;

        try {
            const recipe = parseRecipeJson(filePath);
            const { comparison, report } = await validateRecipe(recipe);

            // Salva il report accanto alla ricetta (mai sopra la ricetta stessa)
            const reportPath = filePath.replace(/\.json$/, '.validazione.md');
            writeFileSync(reportPath, report, 'utf-8');
            console.log(`   📄 Report: ${reportPath}`);

            results.push({
                file,
                title: recipe.title,
                confidence: comparison.confidence,
                matches: comparison.matches.length,
                warnings: comparison.warnings.length,
            });
        } catch (err) {
            console.error(`   ❌ Errore: ${err.message}`);
            results.push({ file, title: file, confidence: -1, error: err.message });
        }

        // Pausa anti-rate-limit: ha senso solo se questa ricetta ha davvero
        // interrogato SerpAPI, e solo se ne resta un'altra da fare. Prima
        // scattava sempre, anche quando la ricetta era fallita senza chiamare
        // (JSON illeggibile, chiave mancante): su un elenco lungo, minuti di
        // attesa per proteggere una quota che nessuno stava consumando.
        const haChiamato = chiamateSerpApi > chiamatePrima;
        const eLUltima = indice === ricette.length - 1;
        if (haChiamato && !eLUltima) await sleep(2000);
    }

    return results;
}

// ── Utility ─────────────────────────────────────────────────────────

function normalizeIngredients(list) {
    return list.map(i => {
        if (typeof i !== 'string') return '';
        return i
            .replace(/<[^>]+>/g, '')    // Strip HTML
            .replace(/\s+/g, ' ')       // Normalizza spazi
            .trim()
            .toLowerCase();
    }).filter(i => i.length > 2);
}

function ingredientMatch(a, b) {
    // Match fuzzy: cerca parole chiave comuni
    const keywordsA = extractKeywords(a);
    const keywordsB = extractKeywords(b);
    // Almeno una keyword deve corrispondere
    return keywordsA.some(ka => keywordsB.some(kb => ka === kb || ka.includes(kb) || kb.includes(ka)));
}

function extractKeywords(ingredient) {
    // Rimuovi quantità, unità di misura, e parole generiche
    const stopWords = ['di', 'da', 'per', 'il', 'la', 'lo', 'un', 'una', 'del', 'della', 'dei', 'delle',
        'al', 'alla', 'con', 'su', 'in', 'quanto', 'basta', 'circa', 'oppure', 'tipo',
        'fresco', 'fresca', 'freschi', 'secco', 'secca'];
    return ingredient
        .replace(/\d+[\.,]?\d*/g, '')           // Rimuovi numeri
        .replace(/\b(g|gr|ml|kg|cl|l|cucchiai?o?|pizzico|q\.?b\.?|n\.?)\b/gi, '') // Unità
        .split(/\s+/)
        .map(w => w.toLowerCase().trim())
        .filter(w => w.length > 2 && !stopWords.includes(w));
}

function extractHydrations(sources) {
    const hydrations = [];
    for (const source of sources) {
        // Cerca nelle stringhe ingredienti il rapporto acqua/farina
        const allText = (source.ingredients || []).join(' ');
        const waterMatch = allText.match(/(\d{2,4})\s*(?:g|gr|ml)\s*(?:di\s+)?acqua/i);
        const flourMatch = allText.match(/(\d{2,4})\s*(?:g|gr)\s*(?:di\s+)?(?:farina|semola)/i);
        if (waterMatch && flourMatch) {
            const water = parseFloat(waterMatch[1]);
            const flour = parseFloat(flourMatch[1]);
            if (flour > 0) hydrations.push(Math.round((water / flour) * 100));
        }
    }
    return hydrations;
}

function parseDuration(iso) {
    if (!iso) return '';
    // PT30M → 30 min, PT1H30M → 1h 30min
    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (!match) return iso;
    const h = match[1] ? `${match[1]}h ` : '';
    const m = match[2] ? `${match[2]}min` : '';
    return (h + m).trim() || iso;
}

function extractStepsFromJsonLd(instructions) {
    if (!instructions) return [];
    if (typeof instructions === 'string') return [instructions];
    if (Array.isArray(instructions)) {
        return instructions.map(step => {
            if (typeof step === 'string') return step;
            return step.text || step.name || '';
        }).filter(Boolean);
    }
    return [];
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
