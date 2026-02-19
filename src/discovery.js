/**
 * DISCOVERY — Cerca ricette su SerpAPI (Google Search)
 * Usa SerpAPI per trovare URL di ricette da siti italiani
 */

/**
 * Cerca ricette su SerpAPI
 * @param {string} query - Termine di ricerca (es. "focaccia pugliese")
 * @param {number} num - Numero di risultati (max 10)
 * @returns {Promise<Array<{title: string, url: string, snippet: string}>>}
 */
export async function discoverRecipes(query, num = 5) {
    const apiKey = process.env.SERPAPI_KEY;

    if (!apiKey) {
        throw new Error(
            'SERPAPI_KEY non trovata nel .env.\n' +
            'Registrati su https://serpapi.com e inserisci la tua API key.'
        );
    }

    console.log(`🔍 Cerco ricette per: "${query}"...\n`);

    const searchQuery = `ricetta ${query}`;
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('q', searchQuery);
    url.searchParams.set('num', Math.min(num, 10).toString());
    url.searchParams.set('hl', 'it');       // Lingua italiana
    url.searchParams.set('gl', 'it');       // Geolocalizzazione Italia
    url.searchParams.set('engine', 'google');

    const res = await fetch(url);

    if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(
            `SerpAPI errore ${res.status}: ${error?.error || res.statusText}`
        );
    }

    const data = await res.json();

    if (data.error) {
        throw new Error(`SerpAPI: ${data.error}`);
    }

    const organicResults = data.organic_results || [];

    if (organicResults.length === 0) {
        console.log('⚠️  Nessun risultato trovato. Prova con una query diversa.');
        return [];
    }

    const results = organicResults.map((item, i) => ({
        index: i + 1,
        title: item.title,
        url: item.link,
        snippet: item.snippet || '',
        source: new URL(item.link).hostname.replace('www.', ''),
    }));

    // Mostra i risultati
    console.log(`📋 Trovate ${results.length} ricette:\n`);
    results.forEach(r => {
        console.log(`  ${r.index}. ${r.title}`);
        console.log(`     🔗 ${r.url}`);
        console.log(`     📰 ${r.source}`);
        console.log(`     ${r.snippet.substring(0, 120)}...`);
        console.log('');
    });

    return results;
}

/**
 * Chiede conferma interattiva all'utente via stdin
 * @param {string} question
 * @returns {Promise<string>}
 */
export function askUser(question) {
    return new Promise((resolve) => {
        process.stdout.write(question);
        process.stdin.resume();
        process.stdin.setEncoding('utf-8');
        process.stdin.once('data', (data) => {
            process.stdin.pause();
            resolve(data.toString().trim());
        });
    });
}
