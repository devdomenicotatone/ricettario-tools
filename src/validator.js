/**
 * VALIDATOR PRO — Validazione ricette con fonti reali
 * 
 * Cross-check delle ricette generate da Claude contro siti autorevoli italiani.
 * Usa SerpAPI per trovare fonti + scraping HTML per estrarre dati strutturati.
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, basename } from 'path';

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
        const data = extractRecipeData(html, url);

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
            const data = extractRecipeData(html, url);

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
 * Prima cerca JSON-LD (Schema.org/Recipe), poi fallback regex
 */
export function extractRecipeData(html, sourceUrl) {
    // ── Tentativo 1: JSON-LD Schema.org/Recipe ──
    const jsonLdData = extractJsonLd(html);
    if (jsonLdData) {
        return {
            source: 'json-ld',
            url: sourceUrl,
            ...jsonLdData,
        };
    }

    // ── Tentativo 2: Fallback regex su HTML raw ──
    return {
        source: 'html-regex',
        url: sourceUrl,
        ...extractFromHtml(html),
    };
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

// ── 6. Valida ricetta da file HTML ──────────────────────────────────

/**
 * Estrae i dati di una ricetta da un file HTML generato
 * Supporta la struttura table.ingredients-table usata dal generatore
 */
export function parseRecipeHtml(filePath) {
    const html = readFileSync(filePath, 'utf-8');

    // ── Titolo ──
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const title = titleMatch ? titleMatch[1].trim() : basename(filePath, '.html');

    // ── Ingredienti: strategia multi-livello ──
    const ingredients = [];

    // 1️⃣ Parser primario: <table class="ingredients-table"> → <tr> con <td> nome + <td data-base> qty
    const tableMatch = html.match(/<table[^>]*class="[^"]*ingredients-table[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
    if (tableMatch) {
        const tableHtml = tableMatch[1];
        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let row;
        while ((row = rowRegex.exec(tableHtml)) !== null) {
            const cells = [];
            const cellRegex = /<td[^>]*(?:data-base="(\d+[\.,]?\d*)")?[^>]*>([\s\S]*?)<\/td>/gi;
            let cell;
            while ((cell = cellRegex.exec(row[1])) !== null) {
                cells.push({
                    dataBase: cell[1] || '',
                    text: cell[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
                });
            }
            if (cells.length >= 2) {
                const name = cells[0].text.replace(/\(.*?\)/g, '').trim(); // rimuovi note tra parentesi
                const qty = cells[1].text.trim(); // es. "400g"
                if (name && qty) {
                    ingredients.push(`${qty} ${name}`);
                }
            }
        }
    }

    // 2️⃣ Fallback: <li> con class ingredient
    if (ingredients.length === 0) {
        const ingRegex = /<li[^>]*class="[^"]*ingredient[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*ingredient-name[^"]*"[^>]*>([^<]+)<\/span>/gi;
        let m;
        while ((m = ingRegex.exec(html)) !== null) {
            ingredients.push(m[1].trim());
        }
    }

    // 3️⃣ Fallback: qualsiasi <li> con quantità
    if (ingredients.length === 0) {
        const simpleLiRegex = /<li[^>]*>([^<]*\d+[^<]*(?:g|ml|kg|cucchia)[^<]*)<\/li>/gi;
        let m;
        while ((m = simpleLiRegex.exec(html)) !== null) {
            ingredients.push(m[1].replace(/<[^>]+>/g, '').trim());
        }
    }

    // 4️⃣ Ultimo fallback: pattern raw nel testo
    if (ingredients.length === 0) {
        const rawIngRegex = /(\d+\s*(?:g|gr|ml)\s+[A-Za-zÀ-ú\s]+)/g;
        let m;
        while ((m = rawIngRegex.exec(html)) !== null) {
            ingredients.push(m[1].trim());
        }
    }

    // ── Idratazione: dal badge tech ──
    const hydrationMatch = html.match(/[Ii]dratazione[^<]*?(\d{2,3})\s*%/) ||
        html.match(/(\d{2,3})\s*%\s*(?:[Ii]dratazione|[Hh]ydration)/);
    const hydration = hydrationMatch ? hydrationMatch[1] : '';

    // ── Categoria ──
    const catMatch = html.match(/data-category="([^"]+)"/i) ||
        html.match(/class="tag tag--category"[^>]*>[^<]*?([A-Za-zÀ-ú]+)\s*<\/span>/i);
    const category = catMatch ? catMatch[1] : '';

    return { title, ingredients, hydration, category, filePath };
}

// ── 7. Valida tutte le ricette nella cartella ───────────────────────

/**
 * Valida tutte le ricette HTML in una cartella (ricorsivamente)
 */
export async function validateAllRecipes(ricettarioPath) {
    const ricettePath = resolve(ricettarioPath, 'ricette');
    const results = [];

    // Scansiona sottocartelle
    const subdirs = readdirSync(ricettePath, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

    for (const subdir of subdirs) {
        const subPath = resolve(ricettePath, subdir);
        const files = readdirSync(subPath).filter(f => f.endsWith('.html'));

        for (const file of files) {
            const filePath = resolve(subPath, file);
            console.log(`\n${'═'.repeat(60)}`);

            try {
                const recipe = parseRecipeHtml(filePath);
                const { comparison, report } = await validateRecipe(recipe);

                // Salva il report accanto alla ricetta
                const reportPath = filePath.replace('.html', '.validazione.md');
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

            // Pausa tra le ricette per non intasare API
            await sleep(2000);
        }
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
