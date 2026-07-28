import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { callClaude, parseClaudeJson } from './utils/api.js';
import { log } from './utils/logger.js';
import { CATEGORY_FOLDERS, RICETTARIO_DIR } from './constants.js';

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
    'Primi': [
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
 * Profili sensoriali già pubblicati nella cartella di una categoria.
 * Sono le ancore per le famiglie senza set in tabella, e la fonte delle
 * etichette riusabili nelle deroghe.
 */
function profiliEsistenti(dirCategoria, slugDaEscludere) {
    const cartella = join(RICETTARIO_DIR, 'ricette', dirCategoria);
    if (!existsSync(cartella)) return [];
    const profili = [];
    for (const file of readdirSync(cartella)) {
        if (!file.endsWith('.json')) continue;
        try {
            const r = JSON.parse(readFileSync(join(cartella, file), 'utf-8'));
            if (slugDaEscludere && r.slug === slugDaEscludere) continue;
            if (r.sensoryProfile?.axes?.length) {
                profili.push({ title: r.title, axes: r.sensoryProfile.axes });
            }
        } catch { /* un JSON illeggibile non deve fermare la scelta degli assi */ }
    }
    return profili;
}

/** Tutte le etichette d'asse già in uso nel sito: le deroghe pescano da qui. */
function etichetteInUso() {
    const etichette = new Set(Object.values(CATEGORY_AXES).flat());
    for (const dir of new Set(Object.values(CATEGORY_FOLDERS))) {
        for (const p of profiliEsistenti(dir, null)) {
            for (const a of p.axes) if (a?.label) etichette.add(a.label);
        }
    }
    return [...etichette];
}

/**
 * Genera un profilo analitico completo (Sensoriale + Nutrizionale)
 * @param {object} recipeData
 * @returns {Promise<object|null>} { sensory, nutrition } — oppure null quando
 *   la categoria non ha né un set in tabella né ricette-ancora: lì il profilo
 *   nasce da una decisione umana, non da un'invenzione dell'AI.
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

    // ── Scelta degli assi: la regola della famiglia, con deroga ──
    // (CLAUDE.md del sito, «Gli assi del profilo sensoriale».) La tabella vale
    // per le famiglie omogenee che elenca. Per le altre NON si ripiega sul
    // pane — è il difetto storico delle costine valutate su «Alveolatura
    // Mollica» per tre mesi: si parte dai profili delle ricette già
    // pubblicate nella stessa famiglia, e se non ce ne sono non si genera.
    const assiTabella = CATEGORY_AXES[recipeData.category] || null;
    const dirCategoria = CATEGORY_FOLDERS[recipeData.category] || null;
    const riusabili = etichetteInUso();

    let regoleSensoriale;
    let axes; // i 5 nomi mostrati nello scheletro JSON del prompt

    if (assiTabella) {
        axes = assiTabella;
        regoleSensoriale = `REGOLE TASSATIVE PER IL SENSORIALE:
1. La famiglia «${recipeData.category}» usa QUESTO set di 5 assi, con questi nomi esatti:
   - ${axes.join('\n   - ')}
2. ASSEGNA UN VALORE DA 0 A 10 (numerico) a ciascun asse. Un valore basso (2-3) su un asse condiviso è INFORMAZIONE: colloca la ricetta rispetto alle altre della famiglia. NON sostituire un asse perché il suo valore è basso.
3. DEROGA — soltanto se un asse per QUESTA ricetta varrebbe 0 o 1 (il tratto non può proprio esprimersi): sostituiscilo con un tratto realmente presente nella ricetta, RIUSANDO se possibile una di queste etichette già in uso nel sito:
   ${riusabili.join(' | ')}
   Conia un'etichetta nuova solo se nessuna di queste descrive il tratto.
4. Ogni sostituzione va dichiarata nel campo "deroghe" (vuoto se non ce ne sono).`;
    } else {
        const ancore = dirCategoria ? profiliEsistenti(dirCategoria, recipeData.slug) : [];
        if (!ancore.length) {
            log.warn(`⚠️  «${recipeData.category}» non ha un set d'assi in tabella né ricette con profilo da usare come ancore: è la prima della famiglia, e il suo profilo va impostato a mano (dashboard → Qualità → Sensory dopo averci pensato). Generazione automatica saltata.`);
            return null;
        }
        axes = ancore[0].axes.map(a => a.label);
        const esempi = ancore
            .map(p => `   ${p.title}: ${p.axes.map(a => `${a.label}=${a.value}`).join(', ')}`)
            .join('\n');
        regoleSensoriale = `REGOLE TASSATIVE PER IL SENSORIALE:
1. La categoria «${recipeData.category}» è una famiglia eterogenea, senza set fisso. Le ricette della famiglia già pubblicate usano questi profili:
${esempi}
2. RIUSA i loro assi ovunque questa ricetta possa esprimerli, anche con valori bassi (2-3): assi uguali sono ciò che rende confrontabili due ricette della stessa famiglia.
3. Sostituisci SOLO gli assi che per questa ricetta varrebbero 0 o 1, con un tratto realmente presente, riusando se possibile una di queste etichette già in uso nel sito:
   ${riusabili.join(' | ')}
4. Il profilo finale ha ESATTAMENTE 5 assi, valori da 0 a 10. Dichiara ogni sostituzione nel campo "deroghe".`;
    }

    const systemPrompt = `Sei un esperto sommelier e tecnologo alimentare di livello Masterclass.
Il tuo compito è analizzare una ricetta fornita in formato JSON e determinare il profilo organolettico.
(I valori nutrizionali NON li stimi tu: si calcolano da USDA FoodData Central, v. src/nutrizione.js.)

${regoleSensoriale}

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
  "deroghe": [
    { "da": "Nome asse sostituito", "a": "Nome asse usato al suo posto", "perche": "Una riga: perché l'asse originale varrebbe 0-1 qui." }
  ]
}
Se non applichi deroghe, "deroghe" è un array vuoto.`;

    // ── Nutrizione: calcolo su dati USDA, non più stima nel prompt ──
    // (USDA-TODO.md, scogli 1-2: dizionario FDC + rese dichiarate.) Se il
    // calcolo si rifiuta — ingrediente non a dizionario, resa non ancora
    // confermata — la ricetta procede SENZA nutrizione: meglio un buco
    // visibile che un numero inventato. Il filtro della dashboard la ripesca.
    let nutrition = null;
    try {
        const { caricaDatiCalcolo, calcolaNutrizione } = await import('./nutrizione.js');
        const cartella = CATEGORY_FOLDERS[recipeData.category];
        const esito = calcolaNutrizione(recipeData, {
            categoria: cartella,
            slug: recipeData.slug,
            ...caricaDatiCalcolo(),
        });
        if (esito.errori) {
            for (const e of esito.errori) log.warn(`⚠️  Nutrizione non calcolabile: ${e}`);
        } else {
            nutrition = esito.nutrition;
            log.info(`🥗 Nutrizione da USDA: ${nutrition.kcal_per_100g} kcal/100g (resa ${esito.dettaglio.resa}, ${esito.dettaglio.fonteResa})`);
        }
    } catch (err) {
        log.warn(`⚠️  Nutrizione non calcolata (${err.message}): la ricetta procede senza.`);
    }

    try {
        const text = await callClaude({
            model: 'claude-sonnet-4-6',
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }]
        });

        const profile = parseClaudeJson(text);
        if (!profile || !profile.sensory || !Array.isArray(profile.sensory.axes)) {
            throw new Error("Formato JSON restituito non valido per il profilo analitico.");
        }
        if (profile.sensory.axes.length !== 5) {
            throw new Error(`Il profilo sensoriale deve avere esattamente 5 assi, ne ha ${profile.sensory.axes.length}.`);
        }

        // Le deroghe si loggano e non si salvano nel JSON della ricetta: sono
        // il racconto della scelta, non un dato del sito.
        for (const d of profile.deroghe || []) {
            log.info(`   ↔️ Deroga: «${d.da}» → «${d.a}» — ${d.perche}`);
        }
        delete profile.deroghe;

        // Un asse a 0-1 dopo le regole qui sopra è la spia che la deroga
        // andava fatta e non è stata fatta: lo stesso segnale che il cancello
        // del sito (build-recipes) dà in fase di check.
        for (const a of profile.sensory.axes) {
            if (Number(a.value) <= 1) {
                log.warn(`⚠️  Asse «${a.label}» a ${a.value}: per la regola della famiglia un asse che la ricetta non può esprimere andava sostituito, non tenuto a zero. Il check del sito lo segnalerà.`);
            }
        }

        log.success(`✅ Profilo Analitico generato (sensoriale AI${nutrition ? ' + nutrizione USDA' : ', nutrizione assente'}).`);
        return { sensory: profile.sensory, nutrition };
    } catch (err) {
        log.error(`❌ Errore durante l'analisi: ${err.message}`);
        throw err;
    }
}
