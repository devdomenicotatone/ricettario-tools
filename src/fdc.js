/**
 * FDC — client per USDA FoodData Central (https://fdc.nal.usda.gov/)
 *
 * Primo mattone del piano in USDA-TODO.md: i nutrizionali delle ricette
 * devono venire da una fonte vera, non dalle stime del modello. Qui vive
 * solo il trasporto: ricerca delle voci FDC e lettura dei nutrienti per
 * 100 g. Niente stime — se un dato non c'è, il campo resta null e se ne
 * accorge chi chiama.
 *
 * La chiave è gratuita: https://fdc.nal.usda.gov/api-key-signup.html
 * (il modulo è di api.data.gov; la chiave vale per tutti i loro servizi).
 * `DEMO_KEY` funziona per le prove ma con limiti stretti — 30 richieste
 * l'ora, 50 al giorno per IP: per i batch serve la chiave personale.
 */

const FDC_BASE = 'https://api.nal.usda.gov/fdc/v1';

// I dataType affidabili per ingredienti generici: misure di laboratorio
// (Foundation) e lo storico USDA (SR Legacy). "Branded" è il rumore dei
// prodotti confezionati americani: fuori di default.
const DATATYPE_DEFAULT = ['Foundation', 'SR Legacy'];

// I quattro numeri che il sito mostra (schema { kcal_per_100g, macros }).
// Valori = "nutrient number" USDA, in ordine di preferenza: per l'energia
// alcune voci Foundation recenti non hanno il classico 208 ma solo i
// calcoli Atwater (957 generale, 958 specifico), tutti in kcal; per i
// grassi alcune (es. olio EVO 748608) hanno solo il "Total fat (NLEA)"
// 298 — anche quello è misura USDA, non stima. Attenzione però: certe
// voci Foundation restano comunque monche (niente energia né proteine):
// il dizionario dovrà scartarle a favore di una voce completa.
const NUMERI_NUTRIENTI = {
    kcal: ['208', '957', '958'],
    carbs: ['205'],
    protein: ['203'],
    fat: ['204', '298'],
};

function chiaveFdc() {
    const chiave = process.env.FDC_API_KEY;
    if (!chiave) {
        throw new Error(
            'FDC_API_KEY mancante nel .env — creala su ' +
            'https://fdc.nal.usda.gov/api-key-signup.html (vedi .env.example)'
        );
    }
    return chiave;
}

async function chiamaFdc(percorso, params = {}) {
    const url = new URL(`${FDC_BASE}${percorso}`);
    for (const [nome, valore] of Object.entries(params)) {
        if (valore !== undefined && valore !== null) url.searchParams.set(nome, valore);
    }
    // Chiave nell'header, non nell'URL: gli URL finiscono nei log.
    const risposta = await fetch(url, { headers: { 'X-Api-Key': chiaveFdc() } });
    if (risposta.status === 429) {
        throw new Error(
            'FDC: limite di richieste raggiunto (429). Con DEMO_KEY è 30/ora: ' +
            'riprova più tardi o metti la chiave personale in FDC_API_KEY.'
        );
    }
    if (!risposta.ok) {
        const corpo = await risposta.text().catch(() => '');
        throw new Error(`FDC: ${risposta.status} su ${percorso} — ${corpo.slice(0, 200)}`);
    }
    return risposta.json();
}

/**
 * Cerca voci FDC per una query in inglese ("wheat flour", "guanciale"…).
 * Ritorna l'essenziale per scegliere una voce: id, descrizione, dataType
 * e i quattro macro per 100 g (la ricerca li porta già con sé).
 */
export async function searchFoods(query, { dataType = DATATYPE_DEFAULT, pageSize = 10 } = {}) {
    const dati = await chiamaFdc('/foods/search', {
        query,
        dataType: dataType.join(','),
        pageSize,
    });
    return (dati.foods || []).map(voce => ({
        fdcId: voce.fdcId,
        description: voce.description,
        dataType: voce.dataType,
        per100g: nutrientiPer100g(voce),
    }));
}

/** Voce FDC completa per fdcId (formato "abridged": basta per i macro). */
export async function getFood(fdcId) {
    return chiamaFdc(`/food/${fdcId}`, { format: 'abridged' });
}

/**
 * Valore di un nutriente per 100 g da una voce FDC, in qualunque dei
 * formati che l'API usa (la ricerca: nutrientNumber/value; il dettaglio:
 * number/amount o nutrient.number). `numeri` è una lista di "nutrient
 * number" in ordine di preferenza. Assente → null, mai zero: lo zero è
 * un valore, il buco no.
 */
export function valoreNutriente(voce, numeri) {
    const trovati = {};
    for (const n of voce.foodNutrients || []) {
        const numero = String(n.nutrientNumber ?? n.number ?? n.nutrient?.number ?? '');
        const valore = n.value ?? n.amount;
        if (numero && valore !== undefined && !(numero in trovati)) trovati[numero] = valore;
    }
    for (const numero of numeri) {
        if (numero in trovati) return trovati[numero];
    }
    return null;
}

/** Estrae { kcal, carbs, protein, fat } per 100 g da una voce FDC. */
export function nutrientiPer100g(voce) {
    return {
        kcal: valoreNutriente(voce, NUMERI_NUTRIENTI.kcal),
        carbs: valoreNutriente(voce, NUMERI_NUTRIENTI.carbs),
        protein: valoreNutriente(voce, NUMERI_NUTRIENTI.protein),
        fat: valoreNutriente(voce, NUMERI_NUTRIENTI.fat),
    };
}
