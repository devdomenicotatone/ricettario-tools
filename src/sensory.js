import { callClaude, parseClaudeJson } from './utils/api.js';
import { log } from './utils/logger.js';

const CATEGORY_AXES = {
    'Pane': [
        'Croccantezza Crosta',
        'Alveolatura Mollica',
        'Complessità Fermentativa',
        'Sapidità',
        'Note Tostate / Cerealicole'
    ],
    'Pizza': [
        'Croccantezza Esterna',
        'Scioglievolezza Impasto',
        'Sapidità / Umami',
        'Equilibrio Condimento-Impasto',
        'Complessità Aromatica'
    ],
    'Focaccia': [
        'Croccantezza Esterna',
        'Scioglievolezza Impasto',
        'Sapidità / Umami',
        'Equilibrio Condimento-Impasto',
        'Complessità Aromatica'
    ],
    'Pasta': [
        'Tenuta al Morso',
        'Ruvidezza Superficie',
        'Elasticità / Masticabilità',
        'Sapore Cerealicolo',
        'Assorbimento Condimento'
    ],
    'Lievitati': [
        'Sofficezza / Alveolatura',
        'Scioglievolezza',
        'Ricchezza Burrosa / Lattica',
        'Dolcezza Percepita',
        'Complessità Aromatica'
    ],
    'Dolci': [
        'Dolcezza Percepita',
        'Friabilità / Croccantezza',
        'Umidità / Cremosità',
        'Intensità Aromatica',
        'Ricchezza / Corpo'
    ],
    'Condimenti': [
        'Sapidità / Umami',
        'Acidità / Pungenza',
        'Cremosità / Densità',
        'Dolcezza / Rotondità',
        'Intensità Aromatica'
    ],
    'Conserve': [
        'Sapidità / Umami',
        'Acidità / Pungenza',
        'Cremosità / Densità',
        'Dolcezza / Rotondità',
        'Intensità Aromatica'
    ]
};

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

    const axes = CATEGORY_AXES[recipeData.category] || CATEGORY_AXES['Pane'];

    const systemPrompt = `Sei un esperto sommelier, tecnologo alimentare e nutrizionista di livello Masterclass.
Il tuo compito è analizzare una ricetta fornita in formato JSON e determinare sia il profilo organolettico che i valori nutrizionali stimati per 100g.

REGOLE TASSATIVE PER IL SENSORIALE:
1. IDENTIFICA LA CATEGORIA LOGICA (${recipeData.category}).
2. UTILIZZA ESATTAMENTE I SEGUENTI 5 ASSI SENSORIALI, senza modificarne il nome in alcun modo:
   - ${axes[0]}
   - ${axes[1]}
   - ${axes[2]}
   - ${axes[3]}
   - ${axes[4]}
3. ASSEGNA UN VALORE DA 0 A 10 (numerico) a ciascun asse basandoti sui dati della ricetta.

REGOLE TASSATIVE PER LA NUTRIZIONE:
1. Calcola una STIMA ACCURATA dei valori nutrizionali per 100g di prodotto finale.
2. Tieni conto del calo peso (es. nel pane l'acqua evapora al 20%, nell'olio infuso rimane quasi invariato).
3. Restituisci Kcal (numero), Carboidrati (numero), Proteine (numero) e Grassi (numero) arrotondati.

RISPONDI ESCLUSIVAMENTE CON UN JSON VALIDO avente questa esatta struttura:
{
  "sensory": {
    "summary": "Breve nota di degustazione (2-3 frasi) in stile sommelier che descrive il profilo organolettico complessivo.",
    "axes": [
      { "label": "${axes[0]}", "value": 8 },
      { "label": "${axes[1]}", "value": 5 },
      { "label": "${axes[2]}", "value": 7 },
      { "label": "${axes[3]}", "value": 2 },
      { "label": "${axes[4]}", "value": 9 }
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
}`;

    try {
        const text = await callClaude({
            model: 'claude-sonnet-4-6',
            system: systemPrompt,
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
