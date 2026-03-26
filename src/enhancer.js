/**
 * ENHANCER — Claude riscrive la ricetta nello stile tecnico del Ricettario
 */

import { callClaude, parseClaudeJson } from './utils/api.js';
import { log } from './utils/logger.js';

const SYSTEM_PROMPT = `Sei un esperto panificatore, pastaio e tecnologo alimentare italiano.
Il tuo compito è trasformare ricette grezze (scrappate da siti web) in ricette professionali nel formato esatto del "Ricettario" — un sito artigianale con documentazione tecnica precisa.

REGOLE:
1. Riscrivere tutti gli ingredienti in formato tecnico: nome generico + caratteristica tecnica tra parentesi (es. "Farina Tipo 0 Media Forza (W 260–280)")
2. Le dosi devono essere in GRAMMI, mai "cucchiai", "bicchieri" ecc. Se la fonte usa misure casalinghe, converti con precisione
3. Calcolare SEMPRE: idratazione totale (% su farina), temperatura target impasto
4. SETUP per categoria:
   - PANE/PIZZA/LIEVITATI: Creare DUE procedimenti → "stepsSpiral" (impastatrice a spirale) + "stepsHand" (a mano)
   - PASTA: Creare DUE procedimenti → "stepsExtruder" (estrusore con trafila Philips) + "stepsHand" (a mano, SOLO se il formato lo permette)
     Formati pasta fattibili a mano: orecchiette, pici, tagliatelle, pappardelle, tajarin, malloreddus, cavatelli, trofie, fusilli al ferretto, fettuccine, lasagne, ravioli, tortellini, pizzoccheri
     Formati SOLO estrusore: spaghetti, linguine, rigatoni, maccheroni, fusilli, penne, bucatini, paccheri
5. Se la ricetta ha sospensioni (noci, olive, uvetta, cioccolato ecc.), separarle dagli ingredienti base
6. Se ci sono farine specifiche, creare la tabella "Consigli Farine" con tipo, forza W e marchi consigliati
7. Generare un alert professionale pertinente (cosa NON fare)
8. Generare 2-3 PRO TIP utili e non banali
9. Il tono è tecnico ma accessibile — come un artigiano che spiega al suo apprendista
10. TUTTE le temperature in °C, TUTTI i tempi in minuti
11. Generare 3-5 keyword specifiche per trovare immagini reali del piatto
12. GLOSSARIO: Identifica TUTTI i termini tecnici usati nella ricetta e aggiungi una spiegazione breve e chiara. Esempi: autolisi, incordatura, puntata, pirlatura, cilindratura, appretto, cascatura, staglio, maturazione, poolish, biga, slap & fold, stretch & fold, trafila al bronzo
13. COTTURA (per Pane/Pizza): Genera una sezione cottura separata con:
    - Temperatura forno (MAX 280°C per forni casalinghi moderni, MAI temperature superiori)
    - Tempo di cottura specifico
    - Suggerimenti: pietra refrattaria, vapore, posizione teglia, come riconoscere la cottura perfetta
14. Le temperature dei forni devono SEMPRE essere per forni casalinghi (max 280°C). MAI suggerire temperature superiori.
15. INGREDIENTI DINAMICI PER SETUP: Se un ingrediente ha caratteristiche diverse a seconda del setup (spirale vs mano), usa il campo opzionale "setupNote". Esempi:
    - Acqua: spirale → "ghiacciata 2-4°C" / mano → "20-22°C, in 3 riprese"
    - Lievito: dosi diverse se impasto più lungo a mano
    Il campo "note" classico deve contenere la nota del setup PRIMARIO (spirale/estrusore). "setupNote" serve per le VARIAZIONI.

RISPONDI ESCLUSIVAMENTE con un JSON valido (senza markdown code fences) con questa struttura:
{
  "title": "Nome Ricetta",
  "slug": "nome-ricetta",
  "emoji": "🍞",
  "description": "Descrizione breve per meta tag (max 160 caratteri)",
  "subtitle": "Sottotitolo tecnico della ricetta",
  "category": "Pane|Lievitati|Pasta|Pizza|Dolci",
  "hydration": 75,
  "targetTemp": "24-25°C",
  "fermentation": "~24h",
  "totalFlour": 1000,
  "ingredients": [
    { "name": "Nome Ingrediente", "note": "(nota tecnica setup primario)", "grams": 600, "setupNote": { "spirale": "ghiacciata 2-4°C", "mano": "20-22°C, in 3 riprese" } }
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
  "stepsExtruder": [
    { "title": "Titolo Step", "text": "Per pasta: preparare l'impasto, inserire nel Philips 7000..." }
  ],
  "stepsCondiment": [
    { "title": "Titolo Step", "text": "Istruzioni opzionali su come preparare il sugo/salsa di accompagnamento..." }
  ],
  "flourTable": [
    { "type": "Tipo Farina", "w": "260-280", "brands": "Marchio1, Marchio2, Marchio3" }
  ],
  "baking": {
    "temperature": "250°C",
    "time": "25-30 minuti",
    "tips": ["Preriscaldare forno + pietra refrattaria per 45 min", "Vapore nei primi 10 min"]
  },
  "glossary": [
    { "term": "Autolisi", "definition": "Riposo di farina e acqua senza lievito per 20-60 min" }
  ],
  "alert": "Testo dell'alert professionale (cosa NON fare e perché)",
  "proTips": ["Tip 1", "Tip 2"],
  "imageKeywords": ["keyword1 per ricerca immagini", "keyword2 in english", "keyword3"],
  "tags": ["tag1", "tag2", "tag3"]
}

NOTE IMPORTANTI:
- Per PASTA: usa "stepsExtruder" al posto di "stepsSpiral". "stepsHand" solo se il formato è fattibile a mano. Se non è fattibile, ometti "stepsHand" o lascialo come array vuoto.
- CONDIMENTO/SALSA: se la ricetta prevede la preparazione di un sugo o condimento (es. "Preparazione" per le acciughe, sugo al pomodoro ecc.), usa l'array "stepsCondiment". Non inserire queste istruzioni dentro stepsExtruder o stepsHand.
- Per PANE/PIZZA: usa "stepsSpiral" + "stepsHand". Aggiungi sempre "baking" con temperatura max 280°C.
- Il "glossary" è OBBLIGATORIO: deve contenere TUTTI i termini tecnici usati nel procedimento.
- "baking" è obbligatorio per Pane e Pizza, opzionale per Pasta (cottura in acqua bollente).`;

/**
 * Riscrive una ricetta con Claude, arricchita da fonti reali
 * 
 * Pipeline PRO:
 *   1. Cerca fonti reali via SerpAPI (GialloZafferano, forum, mulini)
 *   2. Scrappa ingredienti e proporzioni dalle fonti trovate
 *   3. Passa i dati scrappati + fonti reali a Claude
 *   4. Claude genera con contesto completo, senza inventare
 * 
 * @param {object} rawRecipe - Dati scrappati dal modulo scraper
 * @returns {Promise<object>} Ricetta enhanced in formato JSON strutturato
 */
export async function enhanceRecipe(rawRecipe) {
  // ── Step 1: Cerca fonti reali per cross-reference ──
  let realSourcesText = '';
  let sourcesFound = 0;

  // Estrai il nome ricetta per la ricerca fonti (3 strategie di fallback)
  let recipeName = rawRecipe.title;
  if (!recipeName || recipeName === 'ricetta' || recipeName.length < 3) {
    // Fallback 1: Estrai dal slug della URL sorgente (es. "pizza-napoletana" → "Pizza Napoletana")
    if (rawRecipe.sourceUrl) {
      const urlSlug = rawRecipe.sourceUrl.replace(/\/+$/, '').split('/').pop();
      if (urlSlug && urlSlug.length > 2) {
        recipeName = urlSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }
    }
  }
  if (!recipeName || recipeName === 'ricetta' || recipeName.length < 3) {
    // Fallback 2: Prima riga non vuota del testo grezzo
    const firstLine = (rawRecipe.ingredients?.[0] || rawRecipe.steps?.[0] || '').substring(0, 60);
    recipeName = firstLine || 'ricetta italiana';
  }
  // Prefissa "ricetta" per migliorare la ricerca
  const searchQuery = recipeName.toLowerCase().includes('ricetta') ? recipeName : `ricetta ${recipeName}`;

  try {
    const { searchRealSources, scrapeRecipePage } = await import('./validator.js');
    console.log(`🔍 Cerco fonti reali per "${searchQuery}" per arricchire la generazione...`);
    const sources = await searchRealSources(searchQuery);
    console.log(`📡 Trovate ${sources.length} fonti, scraping...`);

    const scrapedData = [];
    for (const source of sources) {
      try {
        process.stdout.write(`   🌐 ${source.domain}... `);
        const data = await scrapeRecipePage(source.url);
        if (data && data.ingredients?.length > 0) {
          scrapedData.push({ ...data, domain: source.domain, title: source.title });
          console.log(`✅ ${data.ingredients.length} ingredienti (${data.source})`);
        } else {
          console.log('❌ nessun dato utile');
        }
      } catch {
        console.log('❌ errore');
      }
      await new Promise(r => setTimeout(r, 400));
    }

    sourcesFound = scrapedData.length;

    if (scrapedData.length > 0) {
      realSourcesText = '\n\n══════ DATI REALI DA FONTI AUTOREVOLI ══════\n';
      realSourcesText += 'USA QUESTI DATI come riferimento per ingredienti, proporzioni e tecniche.\n';
      realSourcesText += 'NON inventare dati tecnici (forza W, temperature, tempi) se le fonti li specificano.\n\n';

      for (const [i, src] of scrapedData.entries()) {
        realSourcesText += `── FONTE ${i + 1}: ${src.domain} ──\n`;
        if (src.ingredients.length > 0) {
          realSourcesText += `   Ingredienti:\n`;
          src.ingredients.forEach(ing => { realSourcesText += `   - ${ing}\n`; });
        }
        if (src.prepTime) realSourcesText += `   Tempo prep: ${src.prepTime}\n`;
        if (src.cookTime) realSourcesText += `   Tempo cottura: ${src.cookTime}\n`;
        if (src.steps?.length > 0) {
          realSourcesText += `   Procedimento:\n`;
          src.steps.slice(0, 6).forEach((step, j) => {
            realSourcesText += `   ${j + 1}. ${step.substring(0, 200)}\n`;
          });
        }
        realSourcesText += '\n';
      }
    }
  } catch (err) {
    console.log(`⚠️  Ricerca fonti non riuscita: ${err.message}`);
    console.log('   Procedo con i soli dati scrappati...');
  }

  // ── Step 2: Genera con Claude usando dati scrappati + fonti reali ──
  const sourceLabel = sourcesFound > 0
    ? `(arricchita con ${sourcesFound} fonti reali)`
    : '(senza fonti reali aggiuntive)';
  log.info(`Claude sta riscrivendo la ricetta ${sourceLabel}...`);

  const dataDirective = sourcesFound > 0
    ? `IMPORTANTE: Ho trovato ${sourcesFound} fonti reali autorevoli. DEVI basare i dati tecnici (forza farina W, temperature impasto, temperature acqua per setup spirale vs mano, tempi, proporzioni) sui dati reali sotto. Per gli ingredienti che cambiano tra setup (es. acqua ghiacciata per spirale vs tiepida per mano), compila il campo setupNote.`
    : `Non ho trovato fonti reali. Basati sui dati scrappati e sulla tua conoscenza, ma sii conservativo.`;

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

${dataDirective}
${realSourcesText}

Trasforma questa ricetta nel formato JSON tecnico del Ricettario. I dati tecnici devono riflettere le fonti reali quando disponibili.`;

  const text = await callClaude({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const recipe = parseClaudeJson(text);
  recipe._sourcesUsed = sourcesFound;
  log.success(`Ricetta "${recipe.title}" elaborata con successo ${sourceLabel}`);
  return recipe;
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

  const text = await callClaude({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const recipe = parseClaudeJson(text);
  recipe._sourcesUsed = sourcesFound;
  log.success(`Ricetta "${recipe.title}" generata ${sourceLabel}`);
  return recipe;
}

/**
 * Legge immagini e usa Claude per estrarre direttamente il JSON strutturato per HTML
 * @param {string[]} imagePaths - path delle immagini (max 5 per batch)
 */
export async function extractRecipesFromImages(imagePaths) {
  const fs = await import('fs');
  const contentArray = [];

  for (const imgPath of imagePaths) {
    const base64Img = fs.readFileSync(imgPath).toString('base64');
    contentArray.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: base64Img,
      }
    });
  }

  const prompt = `Queste immagini contengono pagine del ricettario ufficiale Philips Pasta Maker.
Estrai TUTTE le ricette presenti.
Usa ESATTAMENTE questa struttura JSON per ogni ricetta (devi restituire un array \`[]\` di oggetti).
Non aggiungere testo fuori dal JSON.

Esempio Struttura di ritorno:
[
  {
    "title": "Maccheroni al farro",
    "slug": "maccheroni-al-farro-philips",
    "emoji": "🍝",
    "description": "Pasta estrusa con Philips Pasta Maker",
    "subtitle": "Trafila: Maccheroni",
    "category": "Pasta",
    "hydration": 35,
    "targetTemp": "Ambiente",
    "fermentation": "Nessuna",
    "totalFlour": 500,
    "ingredients": [
      { "name": "Farina di semola", "note": "per l'impasto", "grams": 500 },
      { "name": "Olive nere", "note": "per la salsa", "grams": 50 }
    ],
    "stepsExtruder": [
      { "title": "Setup Macchina", "text": "Montare la trafila Maccheroni." },
      { "title": "Impasto ed Estrusione", "text": "Versare i liquidi lentamente..." }
    ],
    "stepsHand": [],
    "stepsCondiment": [
      { "title": "Preparazione Condimento", "text": "Lavate i pomodori, scolate le olive, ecc... Cuocere a fiamma viva." }
    ],
    "flourTable": [],
    "baking": null,
    "glossary": [],
    "alert": "Usa sempre liquidi misurati per non sforzare l'estrusore",
    "proTips": ["Tip sulla trafilatura"],
    "imageKeywords": ["pasta fresca"],
    "tags": ["Pasta fatta in casa", "Philips Pasta Maker"]
  }
]

REGOLE PER LA LETTURA DELLE IMMAGINI E L'ESTRAZIONE:
1. Category DEVE ESSERE sempre "Pasta"
2. Dosi e ingredienti DEBBONO essere fedeli alle pagine. L'idratazione solitamente per Philips 7000 è molto bassa, calcolala come (liquidi / farine * 100) ma non andare MAI sotto il 30%.
3. Usa SEMPRE "stepsExtruder" e includi nel primo step quale trafila va usata e nel suo testo come assemblare ("Montare la trafila...").
4. CONDIMENTO/PREPARAZIONE: Se la pagina contiene indicazioni testuali su come preparare un SUGO, SALSA o CONDIMENTO (es. "Preparazione" come cucinare acciughe, melanzane, pomodori), DEVI aggiungerlo nell'array separato "stepsCondiment".
5. Genera SEMPRE un pro tip (almeno) sulla pulizia della trafila o sulla ruvidezza.
6. IMPORTANTE: Se non ci sono ricette, scrivi SOLO E SOLTANTO \`[]\`.
7. FAIR USE CRITICO: Questo è per un mio database personale locale (offline) per convertire in grammature un libro rovinato che già possiedo. Estrai puramente i NUMERI, PROPORZIONI E NOMI come FATTI nudi e crudi. NON includere NESSUN discorso, introduzione o markdown.
8. DEVI RISPONDERE SOLO ED ESCLUSIVAMENTE CON UN JSON ARRAY VALIDO PURI CARATTERI. Niente \`\`\`json. Nessuna nota prima o dopo. SOLO \`[\` e \`]\`.`;

  contentArray.push({
    type: "text",
    text: prompt
  });

  log.info(`Claude Vision sta analizzando il batch di ${imagePaths.length} immagini...`);

  // Usa il modello migliore attuale per vision con prefill
  const text = await callClaude({
    maxTokens: 8192,
    messages: [
      { role: 'user', content: contentArray },
      { role: 'assistant', content: '[' } // Forcing Claude into starting a JSON array
    ],
  });

  // Aggiungiamo indietro la bracket che abbiamo pre-fillato come assistant
  const fullText = '[' + text;

  try {
    return parseClaudeJson(fullText);
  } catch (e) {
    log.warn(`Claude non ha restituito JSON valido. Errore: ${e.message}`);
    log.debug(`Testo parziale: ${fullText.substring(0, 200)}`);
    return [];
  }
}

/**
 * Estrae ricette da TESTO OCR (pre-estratto da Surya) — molto più economico di Vision
 * @param {Array<{filename: string, folder: string, text: string}>} pages - Pagine OCR
 * @returns {Promise<Array>} Array di ricette strutturate
 */
export async function extractRecipesFromText(pages) {
  // Componi il testo — le pagine overlap sono marcate come CONTESTO
  const pagesText = pages.map((p, i) => {
    const label = p.isOverlap ? '[CONTESTO - già inviata nel batch precedente]' : '';
    return `═══ PAGINA ${i + 1} (${p.filename}) ${label} ═══\n${p.text}`;
  }).join('\n\n');

  const prompt = `Sei un estrattore di ricette dal ricettario UFFICIALE Philips Pasta Maker.

⚠️ ATTENZIONE CRITICA — TESTO MULTILINGUA:
Queste pagine contengono fino a 4 LINGUE AFFIANCATE (Italiano, English, Deutsch, Ελληνικά, Français).
Le righe delle diverse lingue sono INTERCALATE nel testo OCR, NON separate.
Ogni ricetta appare tradotta in tutte le lingue SULLO STESSO BLOCCO DI TESTO.
DEVI estrarre SOLO ED ESCLUSIVAMENTE il contenuto ITALIANO. Ignora completamente tutto ciò che è in altre lingue.

⚠️ ATTENZIONE — STRUTTURA TIPICA DI OGNI RICETTA NEL LIBRO:
Ogni ricetta nel libro Philips segue SEMPRE questo schema:
  1. TITOLO DELLA RICETTA (es. "Spaghetti con salsa di pomodoro")
  2. SEZIONE "Per l'impasto" → lista ingredienti per la pasta (farine, acqua, uova)
  3. SEZIONE "Esecuzione" → istruzioni per il Pasta Maker (trafila, programma, estrusione)
  4. SEZIONE "Per la salsa/condimento" (opzionale) → lista ingredienti del condimento
  5. SEZIONE "Preparazione" (opzionale) → istruzioni per cuocere il condimento

REGOLA FONDAMENTALE: ogni ingrediente che estrai DEVE apparire ESPLICITAMENTE nel testo italiano della ricetta.
NON inventare ingredienti. NON combinare ingredienti da ricette diverse.
NON aggiungere ingredienti da fonti esterne. NON arricchire le dosi.
Se una dose non è chiara nel testo, scrivi 0 nei grammi e "q.b." nella note.

Struttura JSON di ritorno (array di oggetti):
[
  {
    "title": "Maccheroni al farro",
    "slug": "maccheroni-al-farro-philips",
    "emoji": "🍝",
    "description": "Breve descrizione dalla ricetta originale",
    "subtitle": "Trafila: Maccheroni",
    "category": "Pasta",
    "hydration": 35,
    "targetTemp": "Ambiente",
    "fermentation": "Nessuna",
    "totalFlour": 500,
    "ingredients": [
      { "name": "Farina di semola", "note": "per l'impasto", "grams": 500 },
      { "name": "Pomodori", "note": "per la salsa", "grams": 300 }
    ],
    "stepsExtruder": [
      { "title": "Setup Macchina", "text": "Montare la trafila Maccheroni." },
      { "title": "Impasto ed Estrusione", "text": "Versare le farine nella vasca..." }
    ],
    "stepsHand": [],
    "stepsCondiment": [
      { "title": "Preparazione Condimento", "text": "Istruzioni esatte dal libro..." }
    ],
    "flourTable": [],
    "baking": null,
    "glossary": [],
    "alert": "Usa sempre liquidi misurati per non sforzare l'estrusore",
    "proTips": ["Tip sulla trafilatura"],
    "imageKeywords": ["pasta fresca", "keyword descrittivo"],
    "tags": ["Pasta fatta in casa", "Philips Pasta Maker"]
  }
]

REGOLE:
1. Category = sempre "Pasta". Lo slug DEVE finire con "-philips".
2. INGREDIENTI: estrai SOLO quelli scritti esplicitamente nel testo italiano. Per l'impasto: farine + liquidi. Per la salsa: solo se indicata. Idratazione = (liquidi / farine × 100), minimo 30%.
3. Usa SEMPRE "stepsExtruder" con nel primo step quale trafila usare.
4. Se c'è un condimento/salsa nel testo, mettilo in "stepsCondiment". Copia le istruzioni FEDELMENTE dal libro.
5. Se NON ci sono ricette nel testo, restituisci SOLO [].
6. CORREGGI solo errori OCR evidenti (es. "5OOg" → 500g, "tarlila" → "trafila").
7. LINGUE: trascrivi SOLO italiano. Se non c'è italiano, traduci dalla prima lingua disponibile.
8. DEDUPLICAZIONE: pagine marcate [CONTESTO] servono solo per completare ricette dal batch precedente. Non estrarre ricette che iniziano lì.
9. RISPONDI SOLO con un JSON ARRAY valido. Niente markdown, niente note, SOLO [ e ].
10. NON INVENTARE NULLA. Ogni dato deve provenire dal testo. Se un'informazione manca, omettila o usa valori vuoti.

TESTI OCR ESTRATTI:
${pagesText}`;

  log.info(`Claude sta analizzando ${pages.length} pagine di testo OCR...`);

  const text = await callClaude({
    maxTokens: 8192,
    messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: '[' }
    ],
  });

  const fullText = '[' + text;

  try {
    return parseClaudeJson(fullText);
  } catch (e) {
    log.warn(`Claude non ha restituito JSON valido. Errore: ${e.message}`);
    log.debug(`Testo parziale: ${fullText.substring(0, 200)}`);
    return [];
  }
}

/**
 * Struttura una ricetta da TESTO LIBERO (appunti, copia-incolla, note personali)
 * usando Claude AI per adattarla al formato del Ricettario.
 *
 * A differenza di enhanceRecipe() (che parte da dati scrappati strutturati),
 * questa funzione accetta testo completamente destrutturato.
 *
 * @param {string} rawText - Testo libero della ricetta
 * @param {object} options - Opzioni aggiuntive (tipo, note)
 * @returns {Promise<object>} Ricetta strutturata in formato JSON
 */
export async function enhanceFromText(rawText, options = {}) {
  log.info('Claude sta strutturando la ricetta dal testo libero...');

  // ── Step 1 (opzionale): Cerca fonti reali per arricchire ──
  let realSourcesText = '';
  let sourcesFound = 0;

  // Estrai un possibile nome ricetta dalla prima riga significativa
  const firstLine = rawText.split('\n').find(l => l.trim().length > 3)?.trim() || '';
  const recipeName = firstLine.replace(/^[🍕🥖🍝🥐🍪🫓#*\-—]+\s*/, '').replace(/["']/g, '').substring(0, 60);

  if (recipeName.length > 3) {
    try {
      const { searchRealSources, scrapeRecipePage } = await import('./validator.js');
      const searchQuery = recipeName.toLowerCase().includes('ricetta') ? recipeName : `ricetta ${recipeName}`;
      console.log(`🔍 Cerco fonti reali per "${searchQuery}" per arricchire la strutturazione...`);
      const sources = await searchRealSources(searchQuery);
      console.log(`📡 Trovate ${sources.length} fonti, scraping...`);

      const scrapedData = [];
      for (const source of sources.slice(0, 5)) {
        try {
          process.stdout.write(`   🌐 ${source.domain}... `);
          const data = await scrapeRecipePage(source.url);
          if (data && data.ingredients?.length > 0) {
            scrapedData.push({ ...data, domain: source.domain, title: source.title });
            console.log(`✅ ${data.ingredients.length} ingredienti (${data.source})`);
          } else {
            console.log('❌ nessun dato utile');
          }
        } catch {
          console.log('❌ errore');
        }
        await new Promise(r => setTimeout(r, 400));
      }

      sourcesFound = scrapedData.length;

      if (scrapedData.length > 0) {
        realSourcesText = '\n\n══════ DATI REALI DA FONTI AUTOREVOLI (per confronto) ══════\n';
        realSourcesText += 'Usa questi dati SOLO come RIFERIMENTO per validare proporzioni e tecniche.\n';
        realSourcesText += 'La ricetta dell\'utente ha PRIORITÀ ASSOLUTA — non modificare dosi e ingredienti.\n\n';

        for (const [i, src] of scrapedData.entries()) {
          realSourcesText += `── FONTE ${i + 1}: ${src.domain} ──\n`;
          if (src.ingredients.length > 0) {
            realSourcesText += `   Ingredienti:\n`;
            src.ingredients.forEach(ing => { realSourcesText += `   - ${ing}\n`; });
          }
          if (src.steps?.length > 0) {
            realSourcesText += `   Procedimento:\n`;
            src.steps.slice(0, 4).forEach((step, j) => {
              realSourcesText += `   ${j + 1}. ${step.substring(0, 150)}\n`;
            });
          }
          realSourcesText += '\n';
        }
      }
    } catch (err) {
      console.log(`⚠️  Ricerca fonti non riuscita: ${err.message}`);
      console.log('   Procedo con il solo testo dell\'utente...');
    }
  }

  // ── Step 2: Claude struttura il testo ──
  const sourceLabel = sourcesFound > 0
    ? `(con ${sourcesFound} fonti di riferimento)`
    : '(senza fonti aggiuntive)';
  log.info(`Claude sta strutturando la ricetta ${sourceLabel}...`);

  const userPrompt = `L'utente ha inserito questa ricetta in formato TESTO LIBERO (appunti personali, note, copia-incolla).
Il tuo compito è STRUTTURARLA nel formato JSON del Ricettario, SENZA modificare dosi e ingredienti dell'utente.

⚠️ REGOLA FONDAMENTALE: Le dosi, le temperature, i tempi e gli ingredienti dell'utente hanno PRIORITÀ ASSOLUTA.
NON modificarli. NON "correggere" le proporzioni. Rispetta fedelmente la ricetta fornita.
Puoi AGGIUNGERE: glossario, proTips, flourTable, alert, imageKeywords — basandoti sulla tua esperienza e sulle fonti reali.

${options.tipo ? `Categoria suggerita dall'utente: ${options.tipo}` : ''}
${options.note ? `Note aggiuntive: ${options.note}` : ''}

══════ TESTO RICETTA DELL'UTENTE ══════
${rawText}
══════ FINE TESTO ══════
${realSourcesText}

Trasforma il testo in un JSON strutturato. Le dosi DEVONO essere fedeli al testo originale.
Aggiungi glossario tecnico, proTips, flourTable e alert basandoti sulla tua esperienza.`;

  const text = await callClaude({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const recipe = parseClaudeJson(text);
  recipe._sourcesUsed = sourcesFound;
  recipe._inputMode = 'testo-libero';
  log.success(`Ricetta "${recipe.title}" strutturata con successo ${sourceLabel}`);
  return recipe;
}
