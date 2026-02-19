/**
 * ENHANCER — Claude riscrive la ricetta nello stile tecnico del Ricettario
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const SYSTEM_PROMPT = `Sei un esperto panificatore e tecnologo alimentare italiano.
Il tuo compito è trasformare ricette grezze (scrappate da siti web) in ricette professionali nel formato esatto del "Ricettario" — un sito artigianale con documentazione tecnica precisa.

REGOLE:
1. Riscrivere tutti gli ingredienti in formato tecnico: nome generico + caratteristica tecnica tra parentesi (es. "Farina Tipo 0 Media Forza (W 260–280)")
2. Le dosi devono essere in GRAMMI, mai "cucchiai", "bicchieri" ecc. Se la fonte usa misure casalinghe, converti con precisione
3. Calcolare SEMPRE: idratazione totale (% su farina), temperatura target impasto
4. Creare DUE procedimenti: uno per impastatrice a spirale (con velocità e tempi) e uno a mano (con tecniche come autolisi, slap & fold, stretch & fold)
5. Se la ricetta ha sospensioni (noci, olive, uvetta, cioccolato ecc.), separarle dagli ingredienti base
6. Se ci sono farine specifiche, creare la tabella "Consigli Farine" con tipo, forza W e marchi consigliati
7. Generare un alert professionale pertinente (cosa NON fare)
8. Generare 2-3 PRO TIP utili e non banali
9. Il tono è tecnico ma accessibile — come un artigiano che spiega al suo apprendista
10. TUTTE le temperature in °C, TUTTI i tempi in minuti
11. Generare 3-5 keyword specifiche per trovare immagini reali del piatto (in italiano e inglese, es. "rigatoni pasta", "pasta trafilata bronzo")

RISPONDI ESCLUSIVAMENTE con un JSON valido (senza markdown code fences) con questa struttura:
{
  "title": "Nome Ricetta",
  "slug": "nome-ricetta",
  "emoji": "🍞",
  "description": "Descrizione breve per meta tag (max 160 caratteri)",
  "subtitle": "Sottotitolo tecnico della ricetta",
  "category": "Pane|Lievitati|Pasta|Pizza|Dolci",  // OBBLIGATORIO: deve essere ESATTAMENTE uno di questi 5 valori
  "hydration": 75,
  "targetTemp": "24-25°C",
  "fermentation": "~24h",
  "totalFlour": 1000,
  "ingredients": [
    { "name": "Nome Ingrediente", "note": "(nota tecnica opzionale)", "grams": 600 }
  ],
  "suspensions": [
    { "name": "Nome Sospensione", "note": "(nota)", "grams": 160 }
  ],
  "stepsSpiral": [
    { "title": "Titolo Step", "text": "Descrizione dettagliata con tempi e velocità..." }
  ],
  "stepsHand": [
    { "title": "Titolo Step", "text": "Descrizione dettagliata con tecniche manuali..." }
  ],
  "flourTable": [
    { "type": "Tipo Farina", "w": "260-280", "brands": "Marchio1, Marchio2, Marchio3" }
  ],
  "alert": "Testo dell'alert professionale (cosa NON fare e perché)",
  "proTips": ["Tip 1", "Tip 2"],
  "imageKeywords": ["keyword1 per ricerca immagini", "keyword2 in english", "keyword3"],
  "tags": ["tag1", "tag2", "tag3"]
}`;

/**
 * Riscrive una ricetta con Claude
 * @param {object} rawRecipe - Dati scrappati dal modulo scraper
 * @returns {Promise<object>} Ricetta enhanced in formato JSON strutturato
 */
export async function enhanceRecipe(rawRecipe) {
  console.log('🤖 Claude sta riscrivendo la ricetta...');

  const userPrompt = `Ecco i dati grezzi di una ricetta scrappata da ${rawRecipe.sourceUrl || 'fonte web'}:

TITOLO: ${rawRecipe.title}
DESCRIZIONE: ${rawRecipe.description}

INGREDIENTI:
${rawRecipe.ingredients.map(i => `- ${i}`).join('\n')}

PROCEDIMENTO:
${rawRecipe.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

PORZIONI: ${rawRecipe.servings || 'non specificato'}
TEMPO PREPARAZIONE: ${rawRecipe.prepTime || 'non specificato'}
TEMPO COTTURA: ${rawRecipe.cookTime || 'non specificato'}
CATEGORIA: ${rawRecipe.category || 'non specificata'}

Trasforma questa ricetta nel formato JSON tecnico del Ricettario. Migliora, integra e rendi tutto professionale. Se la ricetta originale manca di dettagli tecnici (forza farina, temperature, tempi precisi), aggiungili basandoti sulla tua competenza.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = message.content[0].text.trim();

  try {
    const recipe = JSON.parse(text);
    console.log(`✅ Ricetta "${recipe.title}" elaborata con successo`);
    return recipe;
  } catch (e) {
    // Prova a estrarre JSON da eventuale markdown
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const recipe = JSON.parse(jsonMatch[0]);
      console.log(`✅ Ricetta "${recipe.title}" elaborata (estratta da risposta)`);
      return recipe;
    }
    throw new Error(`Claude non ha restituito JSON valido: ${text.substring(0, 200)}...`);
  }
}

/**
 * Genera una ricetta BASATA SU FONTI REALI (non dalla memoria di Claude)
 * 
 * Pipeline data-driven:
 *   1. Cerca fonti reali via SerpAPI (forum, mulini, accademie)
 *   2. Scrappa ingredienti e proporzioni dalle pagine trovate
 *   3. Passa i dati reali a Claude come contesto obbligatorio
 *   4. Claude riscrive nel formato Ricettario, senza inventare
 * 
 * @param {string} nome - Nome della ricetta
 * @param {object} options - Opzioni aggiuntive (idratazione, tipo, note)
 */
export async function generateRecipe(nome, options = {}) {
  console.log(`🔍 Cerco fonti reali per "${nome}"...`);

  // ── Step 1: Cerca fonti reali ──
  let realSourcesText = '';
  let sourcesFound = 0;

  try {
    const { searchRealSources, scrapeRecipePage } = await import('./validator.js');
    const sources = await searchRealSources(nome);
    console.log(`📡 Trovate ${sources.length} fonti, scraping...`);

    const scrapedData = [];
    for (const source of sources) {
      try {
        process.stdout.write(`   🌐 ${source.domain}... `);
        const data = await scrapeRecipePage(source.url);
        if (data && data.ingredients?.length > 0) {
          scrapedData.push({ ...data, domain: source.domain, title: source.title });
          console.log(`✅ ${data.ingredients.length} ingredienti`);
        } else {
          console.log('❌ nessun dato');
        }
      } catch {
        console.log('❌ errore');
      }
      // Pausa tra richieste
      await new Promise(r => setTimeout(r, 400));
    }

    sourcesFound = scrapedData.length;

    if (scrapedData.length > 0) {
      realSourcesText = '\n\n══════ DATI REALI DA FONTI VERIFICATE ══════\n';
      realSourcesText += 'USA QUESTI DATI COME BASE. NON INVENTARE ingredienti o proporzioni.\n\n';

      for (const [i, src] of scrapedData.entries()) {
        realSourcesText += `── FONTE ${i + 1}: ${src.domain} ──\n`;
        realSourcesText += `   URL: ${src.url}\n`;
        if (src.name) realSourcesText += `   Nome: ${src.name}\n`;
        if (src.ingredients.length > 0) {
          realSourcesText += `   Ingredienti:\n`;
          src.ingredients.forEach(ing => {
            realSourcesText += `   - ${ing}\n`;
          });
        }
        if (src.prepTime) realSourcesText += `   Tempo prep: ${src.prepTime}\n`;
        if (src.cookTime) realSourcesText += `   Tempo cottura: ${src.cookTime}\n`;
        if (src.servings) realSourcesText += `   Porzioni: ${src.servings}\n`;
        if (src.steps?.length > 0) {
          realSourcesText += `   Procedimento:\n`;
          src.steps.slice(0, 8).forEach((step, j) => {
            realSourcesText += `   ${j + 1}. ${step.substring(0, 200)}\n`;
          });
        }
        realSourcesText += '\n';
      }
    }
  } catch (err) {
    console.log(`⚠️  Ricerca fonti non riuscita: ${err.message}`);
    console.log('   Procedo con la generazione standard...');
  }

  // ── Step 2: Genera con Claude usando i dati reali ──
  const sourceLabel = sourcesFound > 0
    ? `(base: ${sourcesFound} fonti reali)`
    : '(senza fonti — usa conoscenza generale)';
  console.log(`\n🤖 Claude sta creando la ricetta "${nome}" ${sourceLabel}...`);

  const dataDirective = sourcesFound > 0
    ? `IMPORTANTE: Ho trovato ${sourcesFound} fonti reali. DEVI basare ingredienti e proporzioni sui dati scrappati sotto. Non inventare. Se le fonti si contraddicono, privilegia la media delle proporzioni. Cita mentalmente le fonti nel tuo ragionamento.`
    : `ATTENZIONE: Non ho trovato fonti reali scrappabili. Basati sulla tua conoscenza ma sii conservativo: usa solo ricette tradizionali ben documentate, non inventare varianti creative.`;

  const userPrompt = `Crea una ricetta professionale completa per: "${nome}"

${options.idratazione ? `Idratazione target: ${options.idratazione}%` : ''}
${options.tipo ? `Tipo: ${options.tipo}` : ''}
${options.note ? `Note: ${options.note}` : ''}

${dataDirective}
${realSourcesText}

Genera la ricetta completa nel formato JSON del Ricettario. I dati devono riflettere FEDELMENTE le fonti reali sopra. Se un ingrediente appare nella maggioranza delle fonti, deve essere presente. Se le proporzioni variano, usa la media.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = message.content[0].text.trim();

  try {
    const recipe = JSON.parse(text);
    recipe._sourcesUsed = sourcesFound;
    console.log(`✅ Ricetta "${recipe.title}" generata ${sourceLabel}`);
    return recipe;
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const recipe = JSON.parse(jsonMatch[0]);
      recipe._sourcesUsed = sourcesFound;
      console.log(`✅ Ricetta "${recipe.title}" generata (estratta) ${sourceLabel}`);
      return recipe;
    }
    throw new Error(`Risposta Claude non valida`);
  }
}
