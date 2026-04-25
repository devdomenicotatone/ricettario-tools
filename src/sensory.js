import { callClaude, parseClaudeJson } from './utils/api.js';
import { log } from './utils/logger.js';

const SENSORY_SYSTEM_PROMPT = `Sei un esperto sommelier, tecnologo alimentare e analista sensoriale di livello Masterclass.
Il tuo compito è analizzare una ricetta fornita in formato JSON e determinare il profilo tecnico-sensoriale della preparazione risultante.

REGOLE TASSATIVE:
1. IDENTIFICA LA CATEGORIA LOGICA: Analizza se si tratta di un Lievitato (Pane/Pizza), di un Condimento (Olio infuso/Salsa), di una Pasta Fresca, ecc.
2. DETERMINA ESATTAMENTE 5 ASSI DINAMICI: Scegli le 5 caratteristiche sensoriali/tecniche PIÙ RILEVANTI per la preparazione.
   - Es. Pane/Focaccia: "Croccantezza Crosta", "Alveolatura", "Acidità", "Umidità Mollica", "Complessità Aromatica".
   - Es. Olio Infuso/Condimento: "Piccantezza", "Amarezza", "Fruttato", "Dolcezza", "Intensità Aromatica".
   - Es. Salse/Maionesi: "Sapidità (Umami)", "Acidità", "Grassezza", "Persistenza", "Dolcezza".
   - Es. Pasta Fresca: "Ruvidezza", "Tenacia al morso", "Elasticità", "Sapore di Grano", "Assorbenza Sugo".
3. ASSEGNA UN VALORE DA 0 A 10 per ciascun asse, basandoti SUI DATI MATEMATICI E TECNICI DELLA RICETTA.
   - Es. Se l'idratazione è 80% e c'è la piega, l'alveolatura sarà alta (8-10).
   - Es. Se è una frittura a 160°C, le note di tostatura (Maillard) o amarezza saranno alte.
   - Es. Se c'è peperoncino Habanero, la piccantezza sarà 9-10. Se c'è aglio nero, umami sarà 9.
4. RISPONDI ESCLUSIVAMENTE CON UN JSON VALIDO avente questa esatta struttura, senza markdown o altro testo:
{
  "summary": "Breve nota di degustazione (2-3 frasi) in stile sommelier che descrive il profilo organolettico complessivo.",
  "axes": [
    { "label": "Nome Asse 1", "value": 8 },
    { "label": "Nome Asse 2", "value": 5 },
    { "label": "Nome Asse 3", "value": 7 },
    { "label": "Nome Asse 4", "value": 2 },
    { "label": "Nome Asse 5", "value": 9 }
  ]
}
`;

/**
 * Genera un profilo sensoriale analizzando il contenuto JSON della ricetta.
 * @param {object} recipeData 
 * @returns {Promise<object>} Profilo sensoriale { axes: [...] }
 */
export async function generateSensoryProfile(recipeData) {
    log.info(`🧪 Analisi sensoriale in corso per "${recipeData.title}"...`);

    // Riduciamo il payload inviato estraendo solo i campi essenziali
    const recipeContext = {
        title: recipeData.title,
        category: recipeData.category,
        hydration: recipeData.hydration,
        ingredients: recipeData.ingredientGroups || recipeData.ingredients,
        steps: recipeData.steps,
        stepsCondiment: recipeData.stepsCondiment,
        baking: recipeData.baking
    };

    const userPrompt = `Analizza la seguente ricetta e genera il Profilo Sensoriale Dinamico (5 assi).
Ecco i dati:
${JSON.stringify(recipeContext, null, 2)}`;

    try {
        const text = await callClaude({
            model: 'claude-sonnet-4-6', // Usa Sonnet per operazioni standard veloci
            system: SENSORY_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }]
        });

        const profile = parseClaudeJson(text);
        if (!profile || !Array.isArray(profile.axes)) {
            throw new Error("Formato JSON restituito non valido per il profilo sensoriale.");
        }
        
        log.success(`✅ Profilo sensoriale generato con ${profile.axes.length} assi.`);
        return profile;
    } catch (err) {
        log.error(`❌ Errore durante l'analisi sensoriale: ${err.message}`);
        throw err;
    }
}
