/**
 * COMANDO: rigenera-claude — Rigenera ricetta legacy tramite Claude
 *
 * Legge l'HTML esistente (senza JSON), lo invia a Claude per estrarre
 * i dati strutturati in formato JSON, salva il JSON, e rigenera l'HTML
 * con il template corrente.
 *
 * Uso:
 *   Dalla dashboard: seleziona ricette → "Rigenera con Claude"
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { callClaude, parseClaudeJson } from '../utils/api.js';
import { generateHtml } from '../template.js';
import { log } from '../utils/logger.js';

const EXTRACT_PROMPT = `Sei un esperto panificatore, pastaio e tecnologo alimentare italiano.
Ti viene fornito il codice HTML di una ricetta del "Ricettario" — un sito artigianale con documentazione tecnica.

Il tuo compito è ESTRARRE tutti i dati dalla pagina HTML e restituire un JSON strutturato COMPLETO.
NON inventare informazioni — estrai SOLO ciò che trovi nell'HTML.
Se un campo non è presente nell'HTML, omettilo o usa un valore ragionevole basato sul contesto.

REGOLE:
1. Estrai TUTTI gli ingredienti con nome, nota e grammi esatti dall'HTML
2. Estrai TUTTI gli step del procedimento (sia spirale/estrusore sia a mano se presenti)
3. Estrai tabella farine, glossario, cottura, alert, pro tips se presenti
4. L'idratazione va calcolata come % acqua su farina totale
5. Le dosi devono restare in GRAMMI come nell'HTML originale
6. Se ci sono sospensioni (noci, olive, etc.), separale dagli ingredienti base
7. SETUP: mantieni la struttura originale (stepsSpiral/stepsHand per pane/pizza, stepsExtruder/stepsHand per pasta)
8. Se nell'HTML c'è un solo procedimento senza distinzione setup, mettilo in stepsSpiral (per pane/pizza) o stepsExtruder (per pasta) e genera tu il stepsHand adattato
9. INGREDIENTI DINAMICI: Se trovi note diverse per setup diversi (data-setup-note-*), usa il campo "setupNote"

RISPONDI ESCLUSIVAMENTE con un JSON valido (senza markdown code fences) con questa struttura:
{
  "title": "Nome Ricetta",
  "slug": "nome-ricetta",
  "emoji": "🍞",
  "description": "Descrizione breve per meta tag (max 160 caratteri)",
  "subtitle": "Sottotitolo tecnico della ricetta",
  "category": "Pane|Lievitati|Pasta|Pizza|Dolci|Focaccia",
  "hydration": 75,
  "targetTemp": "24-25°C",
  "fermentation": "~24h",
  "totalFlour": 1000,
  "ingredients": [
    { "name": "Nome Ingrediente", "note": "(nota tecnica)", "grams": 600, "setupNote": { "spirale": "nota spirale", "mano": "nota mano" } }
  ],
  "suspensions": [
    { "name": "Nome Sospensione", "note": "(nota)", "grams": 160 }
  ],
  "stepsSpiral": [
    { "title": "Titolo Step", "text": "Descrizione dettagliata..." }
  ],
  "stepsHand": [
    { "title": "Titolo Step", "text": "Descrizione dettagliata..." }
  ],
  "stepsExtruder": [],
  "stepsCondiment": [],
  "flourTable": [
    { "type": "Tipo Farina", "w": "260-280", "brands": "Marchio1, Marchio2" }
  ],
  "baking": {
    "temperature": "250°C",
    "time": "25-30 minuti",
    "tips": ["Tip cottura 1", "Tip cottura 2"]
  },
  "glossary": [
    { "term": "Termine", "definition": "Definizione del termine tecnico" }
  ],
  "alert": "Testo dell'alert professionale",
  "proTips": ["Tip 1", "Tip 2"],
  "imageKeywords": ["english stock photo keyword", "another english term", "italian keyword", "german keyword"],
  "tags": ["tag1", "tag2"]
}

NOTE:
- "baking" è obbligatorio per Pane/Pizza/Focaccia, opzionale per Pasta
- Il glossary deve contenere TUTTI i termini tecnici presenti nel procedimento
- Se l'HTML ha un'immagine, estrai il percorso e mettilo nel campo "image"`;

/**
 * Rigenera una singola ricetta legacy (HTML → Claude → JSON → HTML)
 * @param {string} htmlPath - Percorso al file HTML esistente
 * @param {string} slug - Slug della ricetta
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function rigeneraClaude(htmlPath, slug) {
    log.info(`  🤖 ${slug}: lettura HTML...`);

    // 1. Leggi HTML esistente
    const htmlContent = readFileSync(htmlPath, 'utf-8');

    // Estrai solo il body (rimuovi header/footer boilerplate per risparmiare token)
    const bodyMatch = htmlContent.match(/<!-- ═+ RECIPE HERO ═+ -->([\s\S]*?)<!-- ═+ FOOTER ═+ -->/);
    const relevantHtml = bodyMatch ? bodyMatch[1] : htmlContent;

    // 2. Chiama Claude per estrarre JSON
    log.info(`  🤖 ${slug}: estrazione dati con Claude...`);

    const userMessage = `Ecco l'HTML della ricetta "${slug}". Estrai TUTTI i dati e restituisci il JSON strutturato:

${relevantHtml}`;

    const response = await callClaude({
        system: EXTRACT_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 8000,
    });

    // 3. Parse JSON dalla risposta
    const recipe = parseClaudeJson(response);

    if (!recipe || !recipe.title) {
        throw new Error('Claude non ha generato un JSON valido');
    }

    // Assicura che lo slug sia corretto
    recipe.slug = slug;

    // Estrai immagine dall'HTML originale se presente
    const imgMatch = htmlContent.match(/background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/);
    if (imgMatch) {
        // Converti percorso relativo (../../images/...) in percorso sito (images/...)
        recipe.image = imgMatch[1].replace(/^\.\.\/\.\.\//, '');
    }

    // 4. Salva JSON accanto all'HTML
    const jsonPath = htmlPath.replace('.html', '.json');
    writeFileSync(jsonPath, JSON.stringify(recipe, null, 2), 'utf-8');
    log.info(`  ✅ ${slug}: JSON salvato`);

    // 5. Rigenera HTML dal nuovo JSON
    const newHtml = generateHtml(recipe);
    writeFileSync(htmlPath, newHtml, 'utf-8');
    log.info(`  ✅ ${slug}: HTML rigenerato`);

    return { success: true };
}
