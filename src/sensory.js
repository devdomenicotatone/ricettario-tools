import { callClaude, parseClaudeJson } from './utils/api.js';
import { log } from './utils/logger.js';

const SENSORY_SYSTEM_PROMPT = `Sei un esperto sommelier, tecnologo alimentare e nutrizionista di livello Masterclass.
Il tuo compito è analizzare una ricetta fornita in formato JSON e determinare sia il profilo organolettico che i valori nutrizionali stimati per 100g.

REGOLE TASSATIVE PER IL SENSORIALE:
1. IDENTIFICA LA CATEGORIA LOGICA.
2. DETERMINA ESATTAMENTE 5 ASSI DINAMICI sensoriali/tecnici rilevanti.
3. ASSEGNA UN VALORE DA 0 A 10 (numerico) basandoti sui dati della ricetta.

REGOLE TASSATIVE PER LA NUTRIZIONE:
1. Calcola una STIMA ACCURATA dei valori nutrizionali per 100g di prodotto finale.
2. Tieni conto del calo peso (es. nel pane l'acqua evapora al 20%, nell'olio infuso rimane quasi invariato).
3. Restituisci Kcal (numero), Carboidrati (numero), Proteine (numero) e Grassi (numero) arrotondati.

RISPONDI ESCLUSIVAMENTE CON UN JSON VALIDO avente questa esatta struttura:
{
  "sensory": {
    "summary": "Breve nota di degustazione (2-3 frasi) in stile sommelier che descrive il profilo organolettico complessivo.",
    "axes": [
      { "label": "Nome Asse 1", "value": 8 },
      { "label": "Nome Asse 2", "value": 5 },
      { "label": "Nome Asse 3", "value": 7 },
      { "label": "Nome Asse 4", "value": 2 },
      { "label": "Nome Asse 5", "value": 9 }
    ]
  },
  "nutrition": {
    "kcal_per_100g": 250,
    "macros": {
      "carbs": 45,
      "protein": 8,
      "fat": 2
    }
  }
}
`;

/**
 * Genera un profilo analitico completo (Sensoriale + Nutrizionale)
 * @param {object} recipeData 
 * @returns {Promise<object>} Profilo analitico { sensory: {...}, nutrition: {...} }
 */
export async function generateAnalyticsProfile(recipeData) {
    log.info(`🧪 Analisi Avanzata in corso per "${recipeData.title}"...`);

    const recipeContext = {
        title: recipeData.title,
        category: recipeData.category,
        hydration: recipeData.hydration,
        ingredients: recipeData.ingredientGroups || recipeData.ingredients,
        steps: recipeData.steps,
        stepsCondiment: recipeData.stepsCondiment,
        baking: recipeData.baking
    };

    const userPrompt = `Analizza la seguente ricetta e genera il Profilo Analitico.
Ecco i dati:
${JSON.stringify(recipeContext, null, 2)}`;

    try {
        const text = await callClaude({
            model: 'claude-sonnet-4-6',
            system: SENSORY_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }]
        });

        const profile = parseClaudeJson(text);
        if (!profile || !profile.sensory || !profile.nutrition || !Array.isArray(profile.sensory.axes)) {
            throw new Error("Formato JSON restituito non valido per il profilo analitico.");
        }
        
        log.success(`✅ Profilo Analitico (Sensoriale + Nutrizione) generato.`);
        return profile;
    } catch (err) {
        log.error(`❌ Errore durante l'analisi: ${err.message}`);
        throw err;
    }
}
