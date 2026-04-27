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
//  PROVIDER 5: OPENVERSE
// ══════════════════════════════════════════════════════════

async function searchOpenverse(query, limit = 20) {
    const params = new URLSearchParams({
        q: query,
        page_size: String(limit)
    });

    try {
        // Openverse allows anonymous access!
        const response = await fetch(`https://api.openverse.org/v1/images/?${params}`, {
            headers: { 
                'User-Agent': 'IlRicettarioBot/1.0',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            console.log(`      ⚠️  Openverse HTTP ${response.status}`);
            return [];
        }

        const data = await response.json();
        return (data.results || []).map(photo => ({
            title: photo.title || query,
            url: photo.url,
            thumbUrl: photo.url, // Usa l'URL diretto bypassando il proxy /thumb/ di Openverse che spesso da 403/404
            width: photo.width || 800,
            height: photo.height || 600,
            license: photo.license ? `CC ${photo.license.toUpperCase()}` : 'CC',
            author: photo.creator || 'Openverse',
            authorUrl: photo.creator_url || '',
            description: photo.attribution || '',
            provider: 'Openverse',
            score: 0,
        }));
    } catch (err) {
        console.log(`      ⚠️  Openverse errore: ${err.message}`);
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
    'loaf', 'crust', 'golden', 'warm', 'appetizing', 'garnish', 'served', 'baguette',
    'sauce', 'dressing', 'pesto', 'mayonnaise', 'oil', 'vinegar', 'spice', 'herb',
    'basil', 'tomato', 'garlic', 'onion', 'cheese', 'parmesan', 'meat', 'chicken',
    'fish', 'vegetable', 'fruit', 'drink', 'beverage', 'cocktail', 'wine', 'beer',
    'coffee', 'tea', 'breakfast', 'lunch', 'dinner', 'snack', 'appetizer', 'side',
    'main', 'course', 'restaurant', 'cafe', 'menu', 'order', 'eat', 'hungry', 'tasty',
    'yummy', 'flavor', 'taste', 'nutrition', 'healthy', 'organic', 'vegan', 'vegetarian',
    'gluten-free', 'dairy-free', 'nut-free', 'sugar-free', 'low-carb', 'keto', 'paleo',
    'diet', 'spoon', 'fork', 'knife', 'napkin', 'glass', 'cup', 'jar', 'bottle', 'can',
    'box', 'bag', 'package', 'wrapper', 'container', 'pot', 'pan', 'skillet', 'wok',
    // IT
    'cibo', 'ricetta', 'dolce', 'pane', 'forno', 'cucina', 'piatto', 'impasto',
    'lievitato', 'cornetto', 'cantuccini', 'biscotti', 'torta', 'farina', 'salsa',
    'condimento', 'olio', 'aceto', 'spezia', 'erba', 'basilico', 'pomodoro', 'aglio',
    'cipolla', 'formaggio', 'parmigiano', 'carne', 'pollo', 'pesce', 'verdura', 'frutta',
    'bevanda', 'cocktail', 'vino', 'birra', 'caffè', 'tè', 'colazione', 'pranzo',
    'cena', 'spuntino', 'antipasto', 'contorno', 'piatto principale', 'ristorante',
    'caffetteria', 'menù', 'ordinare', 'mangiare', 'affamato', 'gustoso', 'squisito',
    'sapore', 'gusto', 'nutrizione', 'sano', 'biologico', 'vegano', 'vegetariano',
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
        score -= 100;
    }

    // ── GATE 2: Penalizza fortemente immagini esplicitamente non-food ──
    for (const nfk of NON_FOOD_KEYWORDS) {
        if (textToCheck.includes(nfk)) score -= 50;
    }

    // ── Match con keywords ricetta (titolo + descrizione) ──
    for (const kw of keywords) {
        const kwLower = kw.toLowerCase();
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
 * Costruisce query di ricerca per una ricetta.
 * Le keyword AI multilingua (EN/IT/DE) sono la fonte primaria.
 * Il nome ricetta e la categoria servono solo come fallback minimale.
 */
function buildSearchQueries(recipeName, category, aiKeywords) {
    const queries = [];

    // 1. Keywords AI multilingua (generate da Claude in EN/IT/DE)
    if (aiKeywords && aiKeywords.length > 0) {
        queries.push(...aiKeywords.slice(0, 4));
    }

    // 2. Nome ricetta semplificato
    const cleanName = recipeName.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    const STOPWORDS = ['di', 'del', 'della', 'delle', 'dei', 'al', 'alla', 'alle', 'con', 'in', 'per', 'tipo', 'fatto', 'casa'];
    const significantWords = cleanName.toLowerCase().split(' ')
        .filter(w => !STOPWORDS.includes(w) && w.length > 2);
    
    if (significantWords.length > 0) {
        queries.push(significantWords.slice(0, 3).join(' ')); // Fino a 3 parole chiave (es. "baguette francese tradizionale")
        if (!aiKeywords || aiKeywords.length === 0) {
            queries.push(significantWords.slice(0, 2).join(' ')); // Fallback a 2 parole
        }
    }

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
        { name: 'Openverse', fn: searchOpenverse, emoji: '🪐' },
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
 * Scarica un'immagine e la converte automaticamente in WebP + AVIF via sharp.
 * @param {string} imageUrl - URL dell'immagine da scaricare
 * @param {string} destPath - Path di destinazione (deve finire in .webp)
 * @returns {Promise<string>} Path del file WebP salvato
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
            const sizeKB = Math.round(buffer.length / 1024);

            // Converti con sharp in WebP + AVIF
            try {
                const sharp = (await import('sharp')).default;
                const webpPath = destPath.replace(/\.[^.]+$/, '.webp');
                const avifPath = destPath.replace(/\.[^.]+$/, '.avif');

                await sharp(buffer)
                    .resize({ width: 1800, withoutEnlargement: true })
                    .webp({ quality: 82 })
                    .toFile(webpPath);

                await sharp(buffer)
                    .resize({ width: 1800, withoutEnlargement: true })
                    .avif({ quality: 50 })
                    .toFile(avifPath);

                const { statSync: fsStat } = await import('fs');
                const webpSize = Math.round(fsStat(webpPath).size / 1024);
                const avifSize = Math.round(fsStat(avifPath).size / 1024);
                console.log(`   💾 Convertita: ${sizeKB}KB originale → ${webpSize}KB WebP + ${avifSize}KB AVIF`);
                return webpPath;
            } catch (sharpErr) {
                // Fallback: se sharp non è disponibile, salva come ricevuto
                console.log(`   ⚠️ Sharp non disponibile (${sharpErr.message}), salvo originale`);
                writeFileSync(destPath, buffer);
                console.log(`   💾 Salvata: ${destPath} (${sizeKB} KB)`);
                return destPath;
            }
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
 * Flusso completo: cerca + scarica + converte + restituisce dati immagine
 */
export async function findAndDownloadImage(recipe, ricettarioPath, usedUrls = new Set()) {
    const ext = 'webp';
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

    // Utilizziamo searchAllProviders per popolare il database di candidati
    const providerResults = await searchAllProviders(
        recipe.title,
        recipe.category,
        recipe.imageKeywords || []
    );

    // Salviamo nel database dei candidati
    try {
        const cachePath = resolve(process.cwd(), 'data', 'image-cache.json');
        let cache = {};
        if (existsSync(cachePath)) {
            cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
        }
        cache[slug] = { providerResults, timestamp: Date.now() };
        writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
        console.log(`\n💾 Database immagini salvato in cache per "${slug}" (${providerResults.length} provider trovati).`);
    } catch (e) {
        console.error("⚠️ Impossibile salvare la cache delle immagini:", e.message);
    }

    // Seleziona la migliore immagine
    let bestImage = null;
    for (const group of providerResults) {
        for (const img of group.images) {
            // Ricalcola lo score escludendo quelle già usate
            let currentScore = img.score;
            if (persistentUrls.has(img.url)) currentScore -= 1000;
            
            if (currentScore > -500 && (!bestImage || currentScore > bestImage.score)) {
                img.score = currentScore;
                bestImage = img;
            }
        }
    }

    const image = bestImage;

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

// ══════════════════════════════════════════════════════════
//  AI IMAGE GENERATION (Gemini Imagen)
// ══════════════════════════════════════════════════════════

export async function generateImageWithGemini(prompt, referenceImageBase64 = null) {
    const { getActiveGeminiKey } = await import('./utils/api.js');
    const key = getActiveGeminiKey();
    if (!key) throw new Error("API Key Gemini non configurata");

    const hasReference = !!referenceImageBase64;
    console.log(`   🤖 Generazione immagine con AI${hasReference ? ' + riferimento visivo' : ''}: "${prompt}"...`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${key}`;

    // Build multimodal parts array
    const parts = [];

    if (hasReference) {
        // Add the reference image first
        parts.push({
            inlineData: {
                mimeType: 'image/jpeg',
                data: referenceImageBase64
            }
        });
        // Wrap prompt with style reference instructions
        parts.push({
            text: `Using the provided reference image as a visual style guide for lighting, composition, angle, and plating style, generate a professional food photograph of: ${prompt}. The result should look like a photo taken in the same setting and style as the reference, but featuring the described dish.`
        });
    } else {
        parts.push({ text: prompt });
    }

    const payload = {
        contents: [
            {
                role: 'user',
                parts
            }
        ],
        generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: "4:3" }
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Errore API Gemini (${response.status}): ${errText}`);
    }

    const data = await response.json();
    let base64Str = null;

    if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
        for (const part of data.candidates[0].content.parts) {
            if (part.inlineData && part.inlineData.data) {
                base64Str = part.inlineData.data;
                break;
            }
        }
    }

    if (!base64Str) {
        throw new Error("Risposta API Gemini non valida (nessuna immagine restituita nel payload inlineData)");
    }

    return Buffer.from(base64Str, 'base64');
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
