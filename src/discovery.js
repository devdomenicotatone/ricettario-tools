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
    const keys = [process.env.SERPAPI_KEY, process.env.SERPAPI_KEY_2].filter(Boolean);

    if (keys.length === 0) {
        throw new Error(
            'SERPAPI_KEY non trovata nel .env.\n' +
            'Registrati su https://serpapi.com e inserisci la tua API key.'
        );
    }

    console.log(`🔍 Cerco ricette per: "${query}"...\n`);

    const searchQuery = `ricetta ${query}`;

    // Prova ogni chiave disponibile (rotazione su fallimento)
    let lastError = null;
    for (let i = 0; i < keys.length; i++) {
        const apiKey = keys[i];
        const url = new URL('https://serpapi.com/search.json');
        url.searchParams.set('api_key', apiKey);
        url.searchParams.set('q', searchQuery);
        url.searchParams.set('num', Math.min(num, 10).toString());
        url.searchParams.set('hl', 'it');
        url.searchParams.set('gl', 'it');
        url.searchParams.set('engine', 'google');

        try {
            const res = await fetch(url);

            if (!res.ok) {
                const error = await res.json().catch(() => ({}));
                // Se crediti esauriti/rate limit, prova la prossima chiave
                if (res.status === 429 || (error?.error || '').includes('limit')) {
                    console.log(`⚠️  Chiave ${i + 1}/${keys.length} esaurita, provo la prossima...`);
                    lastError = error?.error || `HTTP ${res.status}`;
                    continue;
                }
                throw new Error(`SerpAPI errore ${res.status}: ${error?.error || res.statusText}`);
            }

            const data = await res.json();

            if (data.error) {
                if (data.error.includes('limit') || data.error.includes('exceeded')) {
                    console.log(`⚠️  Chiave ${i + 1}/${keys.length} esaurita, provo la prossima...`);
                    lastError = data.error;
                    continue;
                }
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
        } catch (err) {
            lastError = err.message;
            console.log(`⚠️  Chiave ${i + 1}/${keys.length} fallita: ${err.message}`);
            if (i < keys.length - 1) continue;
        }
    }

    console.log(`❌ Tutte le chiavi SerpAPI esaurite. Ultimo errore: ${lastError}`);
    return [];
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
