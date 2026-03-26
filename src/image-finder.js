/**
 * IMAGE FINDER — Ricerca intelligente immagini multi-provider
 * 
 * Strategia cascade PRO:
 *   1. Pexels  (migliori foto food, 200 req/h)
 *   2. Unsplash (alta qualità, 50 req/h demo)
 *   3. Pixabay  (grande catalogo, 100 req/min)
 *   4. Wikimedia Commons (fallback, no API key)
 * 
 * Deduplicazione:
 *   - Per sessione: Set di URL già usati
 *   - Persistente: data/used-images.json (URL→slug)
 *   - Per slug: non scarica se file già esiste su disco
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

// ── Index persistente immagini già usate ──
const IMAGE_INDEX_FILE = resolve(process.cwd(), 'data', 'used-images.json');

function loadImageIndex() {
    try {
        if (existsSync(IMAGE_INDEX_FILE)) {
            return JSON.parse(readFileSync(IMAGE_INDEX_FILE, 'utf-8'));
        }
    } catch {}
    return {}; // { url: slug }
}

function saveImageIndex(index) {
    const dir = dirname(IMAGE_INDEX_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(IMAGE_INDEX_FILE, JSON.stringify(index, null, 2), 'utf-8');
}

const MIN_WIDTH = 600;
const MIN_HEIGHT = 400;

// ── Mappa di traduzione IT → EN per query più efficaci ──
const TRANSLATIONS = {
    // Categorie
    'pane': 'bread',
    'pasta': 'pasta',
    'pizza': 'pizza',
    'focaccia': 'focaccia',
    'lievitati': 'pastry dough',
    // Formati pasta
    'rigatoni': 'rigatoni pasta',
    'spaghetti': 'spaghetti',
    'maccheroni': 'macaroni pasta',
    'fusilli': 'fusilli pasta',
    'linguine': 'linguine pasta',
    'tagliatelle': 'tagliatelle egg pasta',
    'pappardelle': 'pappardelle pasta',
    'orecchiette': 'orecchiette pasta',
    'pici': 'pici tuscan pasta',
    'malloreddus': 'sardinian gnocchi malloreddus',
    'tajarin': 'tajarin piedmont egg pasta',
    'pizzoccheri': 'pizzoccheri buckwheat pasta',
    'gnocco': 'gnocchi potato',
    // Pane — specifici
    'ciabatta': 'ciabatta italian bread',
    'pagnotta': 'round bread loaf',
    'filone': 'italian bread loaf baguette',
    'casalingo': 'homemade rustic bread',
    'integrale': 'whole wheat bread loaf',
    'semola': 'semolina bread puglia',
    'latte': 'milk bread soft rolls',
    'noci': 'walnut bread artisan',
    'olive': 'olive bread mediterranean',
    // Pizza — specifici
    'napoletana': 'neapolitan pizza wood oven',
    'margherita': 'margherita pizza basil mozzarella',
    'teglia': 'roman pizza al taglio',
};

// ── Keywords regionali/geografiche per query più specifiche ──
const REGIONAL_KEYWORDS = [
    'barese', 'genovese', 'napoletana', 'napoletano', 'romana', 'romano',
    'siciliana', 'siciliano', 'pugliese', 'toscana', 'toscano', 'piemontese',
    'ligure', 'calabrese', 'sarda', 'sardo', 'veneta', 'veneto', 'milanese',
    'emiliana', 'emiliano', 'romagnola', 'romagnolo', 'marchigiana', 'marchigiano',
    'campana', 'campano', 'friulana', 'friulano', 'abruzzese', 'lucana', 'lucano',
    'classica', 'classico', 'tradizionale', 'antica', 'antico',
];

// ══════════════════════════════════════════════════════════
//  PROVIDER 1: PEXELS
// ══════════════════════════════════════════════════════════

async function searchPexels(query, limit = 15) {
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) return [];

    const params = new URLSearchParams({
        query,
        per_page: String(limit),
        orientation: 'landscape',
    });

    try {
        const response = await fetch(`https://api.pexels.com/v1/search?${params}`, {
            headers: { Authorization: apiKey }
        });

        if (!response.ok) {
            console.log(`      ⚠️  Pexels HTTP ${response.status}`);
            return [];
        }

        const data = await response.json();
        return (data.photos || []).map(photo => ({
            title: photo.alt || query,
            url: photo.src.large2x || photo.src.large || photo.src.original,
            thumbUrl: photo.src.medium,
            width: photo.width,
            height: photo.height,
            license: 'Pexels License',
            author: photo.photographer || 'Pexels',
            authorUrl: photo.photographer_url || '',
            description: photo.alt || '',
            provider: 'Pexels',
            score: 0,
        }));
    } catch (err) {
        console.log(`      ⚠️  Pexels errore: ${err.message}`);
        return [];
    }
}

// ══════════════════════════════════════════════════════════
//  PROVIDER 2: UNSPLASH
// ══════════════════════════════════════════════════════════

async function searchUnsplash(query, limit = 15) {
    const apiKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!apiKey) return [];

    const params = new URLSearchParams({
        query,
        per_page: String(limit),
        orientation: 'landscape',
        content_filter: 'high',
    });

    try {
        const response = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
            headers: { Authorization: `Client-ID ${apiKey}` }
        });

        if (!response.ok) {
            console.log(`      ⚠️  Unsplash HTTP ${response.status}`);
            return [];
        }

        const data = await response.json();
        return (data.results || []).map(photo => ({
            title: photo.description || photo.alt_description || query,
            url: photo.urls.regular, // 1080px wide
            thumbUrl: photo.urls.small,
            width: photo.width,
            height: photo.height,
            license: 'Unsplash License',
            author: photo.user?.name || 'Unsplash',
            authorUrl: photo.user?.links?.html || '',
            description: photo.alt_description || '',
            provider: 'Unsplash',
            score: 0,
        }));
    } catch (err) {
        console.log(`      ⚠️  Unsplash errore: ${err.message}`);
        return [];
    }
}

// ══════════════════════════════════════════════════════════
//  PROVIDER 3: PIXABAY
// ══════════════════════════════════════════════════════════

async function searchPixabay(query, limit = 15) {
    const apiKey = process.env.PIXABAY_API_KEY;
    if (!apiKey) return [];

    const params = new URLSearchParams({
        key: apiKey,
        q: query,
        per_page: String(limit),
        image_type: 'photo',
        orientation: 'horizontal',
        safesearch: 'true',
        min_width: String(MIN_WIDTH),
        min_height: String(MIN_HEIGHT),
    });

    try {
        const response = await fetch(`https://pixabay.com/api/?${params}`);

        if (!response.ok) {
            console.log(`      ⚠️  Pixabay HTTP ${response.status}`);
            return [];
        }

        const data = await response.json();
        return (data.hits || []).map(photo => ({
            title: photo.tags || query,
            url: photo.largeImageURL || photo.webformatURL,
            thumbUrl: photo.previewURL,
            width: photo.imageWidth,
            height: photo.imageHeight,
            license: 'Pixabay License',
            author: photo.user || 'Pixabay',
            authorUrl: `https://pixabay.com/users/${photo.user_id}/`,
            description: photo.tags || '',
            provider: 'Pixabay',
            score: 0,
        }));
    } catch (err) {
        console.log(`      ⚠️  Pixabay errore: ${err.message}`);
        return [];
    }
}

// ══════════════════════════════════════════════════════════
//  PROVIDER 4: WIKIMEDIA COMMONS (fallback)
// ══════════════════════════════════════════════════════════

const WIKI_API = 'https://commons.wikimedia.org/w/api.php';

async function searchWikimedia(query, limit = 10) {
    const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        generator: 'search',
        gsrnamespace: '6',
        gsrsearch: query,
        gsrlimit: String(limit),
        prop: 'imageinfo',
        iiprop: 'url|size|extmetadata|mime',
        iiurlwidth: '800',
        origin: '*',
    });

    try {
        const response = await fetch(`${WIKI_API}?${params}`, {
            headers: { 'User-Agent': 'IlRicettarioBot/1.0' }
        });

        if (!response.ok) return [];
        const data = await response.json();
        if (!data.query?.pages) return [];

        const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp'];
        const results = [];

        for (const page of Object.values(data.query.pages)) {
            const info = page.imageinfo?.[0];
            if (!info) continue;

            const rawExt = info.url?.split('.').pop()?.toLowerCase()?.split('%')[0]?.split('?')[0];
            if (!ALLOWED_EXT.includes(rawExt)) continue;
            if (info.width < MIN_WIDTH || info.height < MIN_HEIGHT) continue;

            const meta = info.extmetadata || {};
            results.push({
                title: page.title?.replace('File:', '') || query,
                url: info.url,
                thumbUrl: info.thumburl || info.url,
                width: info.width,
                height: info.height,
                license: meta.LicenseShortName?.value || 'CC',
                author: meta.Artist?.value?.replace(/<[^>]*>/g, '').trim() || 'Wikimedia',
                authorUrl: '',
                description: meta.ImageDescription?.value?.replace(/<[^>]*>/g, '').trim() || '',
                provider: 'Wikimedia',
                score: 0,
            });
        }
        return results;
    } catch (err) {
        console.log(`      ⚠️  Wikimedia errore: ${err.message}`);
        return [];
    }
}

// ══════════════════════════════════════════════════════════
//  SCORING & RICERCA INTELLIGENTE
// ══════════════════════════════════════════════════════════

// Keywords food che DEVONO essere presenti nella descrizione per validare l'immagine
const FOOD_KEYWORDS = [
    // EN
    'food', 'dish', 'recipe', 'baked', 'baking', 'bread', 'pastry', 'dough', 'cake',
    'cookie', 'cookies', 'pie', 'tart', 'dessert', 'sweet', 'pizza', 'pasta', 'flour',
    'kitchen', 'cooking', 'chef', 'plate', 'bowl', 'table', 'meal', 'homemade',
    'delicious', 'fresh', 'oven', 'biscuit', 'croissant', 'brioche', 'panettone',
    'chocolate', 'cream', 'butter', 'egg', 'sugar', 'almond', 'walnut', 'nut',
    'ciabatta', 'focaccia', 'rustic', 'artisan', 'sourdough', 'yeast', 'slice',
    'loaf', 'crust', 'golden', 'warm', 'appetizing', 'garnish', 'served',
    // IT
    'cibo', 'ricetta', 'dolce', 'pane', 'forno', 'cucina', 'piatto', 'impasto',
    'lievitato', 'cornetto', 'cantuccini', 'biscotti', 'torta', 'farina',
];

// Keywords NON-FOOD che causano penalita severa
const NON_FOOD_KEYWORDS = [
    'landscape', 'mountain', 'cannon', 'military', 'memorial', 'war', 'monument',
    'building', 'architecture', 'sign', 'signpost', 'road', 'street', 'car', 'vehicle',
    'beach', 'ocean', 'sea', 'lake', 'river', 'forest', 'tree', 'flower', 'garden',
    'people', 'portrait', 'fashion', 'model', 'wedding', 'office', 'computer',
    'skyline', 'city', 'aerial', 'drone', 'sunset', 'sunrise', 'night', 'stadium',
    'sport', 'soccer', 'football', 'basketball', 'gym', 'fitness', 'yoga',
    'cat', 'dog', 'animal', 'pet', 'bird', 'horse', 'aquarium',
    'beans', 'lentils', 'market', 'spices', 'raw ingredient',
];

/**
 * Calcola un punteggio di pertinenza per l'immagine
 * GATE: l'immagine DEVE essere food-related
 */
function scoreImage(image, keywords) {
    let score = 0;
    const textToCheck = `${image.title || ''} ${image.description || ''}`.toLowerCase();

    // ── GATE 1: L'immagine DEVE contenere almeno una keyword food ──
    const isFoodRelated = FOOD_KEYWORDS.some(fw => textToCheck.includes(fw));
    if (!isFoodRelated) {
        score -= 100; // Penalita drammatica per immagini non-food
    }

    // ── GATE 2: Penalizza fortemente immagini esplicitamente non-food ──
    for (const nfk of NON_FOOD_KEYWORDS) {
        if (textToCheck.includes(nfk)) score -= 50;
    }

    // ── Match con keywords ricetta (titolo + descrizione) ──
    for (const kw of keywords) {
        const kwLower = kw.toLowerCase();
        // Match parole singole per evitare false positive
        const words = kwLower.split(/\s+/);
        for (const word of words) {
            if (word.length > 2 && textToCheck.includes(word)) score += 8;
        }
    }

    // Bonus per immagini orizzontali (meglio per card e hero)
    if (image.width > image.height) score += 3;

    // Bonus per alta risoluzione
    if (image.width >= 1200) score += 2;

    // Penalita per immagini troppo piccole
    if (image.width < 800) score -= 2;

    // Penalita per nomi generici tipo "IMG_" o "DSC_"
    if (/^(IMG|DSC|P\d|DSCN)/i.test(image.title)) score -= 3;

    return score;
}

/**
 * Costruisce query di ricerca intelligenti per una ricetta
 */
function buildSearchQueries(recipeName, category, aiKeywords) {
    const cleanName = recipeName.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    const nameWords = cleanName.toLowerCase().split(' ');
    const STOPWORDS = ['di', 'del', 'della', 'delle', 'dei', 'al', 'alla', 'alle', 'con', 'in', 'per', 'tipo'];
    const significantWords = nameWords.filter(w => !STOPWORDS.includes(w) && w.length > 2);

    // Estrai parole regionali/geografiche dal titolo
    const regionalWord = nameWords.find(w => REGIONAL_KEYWORDS.includes(w)) || '';

    const queries = [];

    // 1. Keywords AI (più specifiche)
    if (aiKeywords.length > 0) {
        queries.push(...aiKeywords.slice(0, 2));
    }

    // 2. Query regionale specifica (es. "focaccia genovese" o "pizza napoletana")
    if (regionalWord) {
        const mainFood = significantWords.find(w => w !== regionalWord) || significantWords[0];
        const translated = TRANSLATIONS[mainFood] || mainFood;
        queries.push(`${translated} ${regionalWord} traditional`);
        queries.push(`${mainFood} ${regionalWord}`);
    }

    // 3. Traduzione diretta della prima parola significativa
    const mainWord = significantWords[0] || nameWords[0];
    if (TRANSLATIONS[mainWord]) {
        queries.push(TRANSLATIONS[mainWord]);
    }

    // 4. Combinazione delle prime 2 parole significative tradotte
    if (significantWords.length >= 2) {
        const translated = significantWords.slice(0, 2)
            .map(w => TRANSLATIONS[w] || w)
            .join(' ');
        queries.push(`${translated} homemade`);
    }

    // 5. Nome completo semplificato + "italian"
    const simpleName = significantWords.slice(0, 3).join(' ');
    queries.push(`${simpleName} italian homemade`);

    // 6. Categoria come ultima risorsa
    if (category) {
        const catLower = category.toLowerCase();
        const enCat = TRANSLATIONS[catLower] || catLower;
        queries.push(`${enCat} italian traditional`);
    }

    // Rimuovi duplicati
    return [...new Set(queries)];
}

/**
 * Ricerca intelligente multi-provider con cascade
 * 
 * @param {string} recipeName - Nome della ricetta
 * @param {string} category - Categoria (es. "Pasta")
 * @param {string[]} aiKeywords - Keywords suggerite da Claude
 * @param {Set} usedUrls - URL già usati da evitare (deduplicazione)
 * @returns {Promise<object|null>} Migliore immagine trovata, o null
 */
export async function findRecipeImage(recipeName, category = '', aiKeywords = [], usedUrls = new Set()) {
    console.log('\n📸 ═══════════════════════════════════════');
    console.log('   STOCK IMAGE SEARCH');
    console.log('═══════════════════════════════════════════');
    console.log(`   🍽️  ${recipeName} (${category})`);

    const queries = buildSearchQueries(recipeName, category, aiKeywords);
    const allKeywords = [recipeName.toLowerCase(), ...(aiKeywords.map(k => k.toLowerCase()))];

    // Provider in ordine di priorità
    const providers = [
        { name: 'Pexels', fn: searchPexels, emoji: '🟣' },
        { name: 'Unsplash', fn: searchUnsplash, emoji: '⬛' },
        { name: 'Pixabay', fn: searchPixabay, emoji: '🟢' },
        { name: 'Wikimedia', fn: searchWikimedia, emoji: '🌐' },
    ];

    let bestImage = null;

    for (const provider of providers) {
        console.log(`\n   ${provider.emoji} ${provider.name}`);

        for (const query of queries) {
            process.stdout.write(`      → "${query}" ... `);
            const results = await provider.fn(query, 15);

            if (results.length === 0) {
                console.log('❌ 0 risultati');
                await sleep(300);
                continue;
            }

            // Scoring + deduplicazione
            for (const img of results) {
                img.score = scoreImage(img, allKeywords);
                if (usedUrls.has(img.url)) img.score -= 1000;
            }
            results.sort((a, b) => b.score - a.score);

            const best = results[0];
            console.log(`✅ ${results.length} risultati (top: score ${best.score})`);

            // Prendi solo se score positivo (non già usata)
            if (best.score > -500 && (!bestImage || best.score > bestImage.score)) {
                bestImage = best;
                bestImage._query = query;
            }

            // Se abbiamo un buon risultato food-related, non servono altre query
            if (bestImage && bestImage.score >= 15) break;

            await sleep(300);
        }

        // Se abbiamo trovato un'immagine buona e food-related, non servono altri provider
        if (bestImage && bestImage.score >= 8) {
            console.log(`\n   ✨ Trovata con ${provider.name}!`);
            break;
        }
    }

    if (bestImage) {
        usedUrls.add(bestImage.url);
        console.log(`\n   🏆 Migliore: "${bestImage.title}"`);
        console.log(`      📐 ${bestImage.width}x${bestImage.height} | 🏷️  ${bestImage.provider}`);
        console.log(`      � ${bestImage.author} | 📜 ${bestImage.license}`);
        console.log(`      � ${bestImage.url}`);
    } else {
        console.log('\n   ⚠️  Nessuna immagine trovata su nessun provider.');
    }

    return bestImage;
}

/**
 * Cerca immagini su TUTTI i provider e restituisce risultati raggruppati.
 * Non fa early-exit — interroga ogni provider con ogni query.
 * Usata dall'Image Picker UI per dare scelta visuale all'utente.
 *
 * @returns {Promise<Array<{provider, emoji, images}>>}
 */
export async function searchAllProviders(recipeName, category = '', aiKeywords = []) {
    const queries = buildSearchQueries(recipeName, category, aiKeywords);
    const allKeywords = [recipeName.toLowerCase(), ...(aiKeywords.map(k => k.toLowerCase()))];

    const providers = [
        { name: 'Pexels', fn: searchPexels, emoji: '🟣' },
        { name: 'Unsplash', fn: searchUnsplash, emoji: '⬛' },
        { name: 'Pixabay', fn: searchPixabay, emoji: '🟢' },
        { name: 'Wikimedia', fn: searchWikimedia, emoji: '🌐' },
    ];

    const grouped = [];

    for (const provider of providers) {
        console.log(`   ${provider.emoji} Cerco su ${provider.name}...`);
        const seen = new Set();
        const providerImages = [];

        for (const query of queries) {
            const results = await provider.fn(query, 20);
            for (const img of results) {
                if (seen.has(img.url)) continue;
                seen.add(img.url);
                img.score = scoreImage(img, allKeywords);
                img.provider = provider.name;
                if (img.score > -50) providerImages.push(img); // Solo food-related
            }
            await sleep(300);
        }

        providerImages.sort((a, b) => b.score - a.score);
        grouped.push({
            provider: provider.name,
            emoji: provider.emoji,
            images: providerImages.slice(0, 30), // Max 30 per provider
        });
        console.log(`     ✅ ${providerImages.length} immagini trovate`);
    }

    return grouped;
}


/**
 * Scarica un'immagine in locale
 */
export async function downloadImage(imageUrl, destPath) {
    const dir = dirname(destPath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(imageUrl, {
                headers: { 'User-Agent': 'IlRicettarioBot/1.0' }
            });

            if (response.status === 429) {
                const wait = (attempt + 1) * 3000;
                console.log(`   ⏳ Rate limit download, attendo ${wait / 1000}s...`);
                await sleep(wait);
                continue;
            }

            if (!response.ok) throw new Error(`Download fallito: HTTP ${response.status}`);

            const buffer = Buffer.from(await response.arrayBuffer());
            writeFileSync(destPath, buffer);

            const sizeKB = Math.round(buffer.length / 1024);
            console.log(`   💾 Salvata: ${destPath} (${sizeKB} KB)`);
            return destPath;
        } catch (err) {
            if (attempt === 2) throw err;
            await sleep(1000);
        }
    }
    throw new Error('Download fallito dopo 3 tentativi');
}

/**
 * Genera il testo di attribuzione
 */
export function buildAttribution(image) {
    if (!image) return '';
    const author = image.author || image.provider;
    return `📷 Foto: ${author} — ${image.license} via ${image.provider}`;
}

/**
 * Flusso completo: cerca + scarica + restituisce dati immagine
 */
export async function findAndDownloadImage(recipe, ricettarioPath, usedUrls = new Set()) {
    const ext = 'jpg';
    const slug = recipe.slug || recipe.title.toLowerCase().replace(/\s+/g, '-');

    // Mappa categoria → sottocartella (unica sorgente di verità: publisher.js)
    const categoryFolders = {
        Pane: 'pane', Pizza: 'pizza', Pasta: 'pasta',
        Lievitati: 'lievitati', Focaccia: 'focaccia', Dolci: 'dolci',
    };
    const category = recipe.category || 'pane';
    const catFolder = categoryFolders[category] || category.toLowerCase();
    const localPath = resolve(ricettarioPath, 'public', 'images', 'ricette', catFolder, `${slug}.${ext}`);

    // ── Blocklist per slug: se il file esiste già, skippa ──
    if (existsSync(localPath)) {
        console.log(`\n📸 Immagine già presente per "${slug}", skip ricerca.`);
        const relativePath = `../../images/ricette/${catFolder}/${slug}.${ext}`;
        const homeRelativePath = `images/ricette/${catFolder}/${slug}.${ext}`;
        return { localPath, relativePath, homeRelativePath, url: '', attribution: '📷 Immagine esistente', license: '', author: '', provider: '' };
    }

    // ── Carica index persistente e mergia con usedUrls di sessione ──
    const imageIndex = loadImageIndex();
    const persistentUrls = new Set([...usedUrls, ...Object.keys(imageIndex)]);

    const image = await findRecipeImage(
        recipe.title,
        recipe.category,
        recipe.imageKeywords || [],
        persistentUrls
    );

    if (!image) return null;

    try {
        await downloadImage(image.url, localPath);

        // ── Salva nell'index persistente ──
        imageIndex[image.url] = slug;
        saveImageIndex(imageIndex);

        const relativePath = `../../images/ricette/${catFolder}/${slug}.${ext}`;
        const homeRelativePath = `images/ricette/${catFolder}/${slug}.${ext}`;

        return {
            localPath,
            relativePath,
            homeRelativePath,
            url: image.url,
            thumbUrl: image.thumbUrl,
            attribution: buildAttribution(image),
            license: image.license,
            author: image.author,
            provider: image.provider,
            width: image.width,
            height: image.height,
        };
    } catch (err) {
        console.log(`   ⚠️  Download fallito: ${err.message}`);
        return null;
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
