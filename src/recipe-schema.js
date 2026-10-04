/**
 * RECIPE SCHEMA — Single Source of Truth
 * 
 * Schema formale condiviso tra:
 *   - quality.js       (validazione qualità)
 *   - enhancer.js      (generazione AI)
 *   - recipe-renderer  (frontend rendering)
 *   - dashboard        (gestione ricette)
 * 
 * Ogni modifica al formato ricetta DEVE partire da qui.
 */

// ── Costanti ──

import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { ALL_CATEGORIES, CATEGORIES_DATA, RICETTARIO_DIR } from './constants.js';
import { calcolaIdratazione, convenzionePiuVicina } from './dashboard/condivisi/idratazione.js';

// La grammatica dei token, e la regola su DOVE un token può stare, non si
// riscrivono qui: vivono nel sito (`js/token-dosi.js`), che con la stessa
// funzione boccia la build in `scripts/build-recipes.js`. È lo stesso
// accoppiamento di constants.js con `js/categories.js`. Finché questo schema non
// conosceva la regola, la generazione salvava come valida una ricetta che il
// sito poi rifiutava, bloccando l'indice intero.
const { graffeFuoriPosto, risolviTokenTesto, tokenDelTesto } = await import(
    pathToFileURL(resolve(RICETTARIO_DIR, 'js', 'token-dosi.js')).href
);

// Riesportata per quality.js, così anche lui legge i token con la grammatica
// del sito invece di tenerne una copia.
export { tokenDelTesto };

// ── Costanti ──

export const VALID_CATEGORIES = ALL_CATEGORIES;

export const CATEGORIES_NEEDING_BAKING = ['Pane', 'Pizza', 'Focaccia', 'Lievitati', 'Dolci'];

// Quarta copia delle emoji per categoria, ora derivata dal registry del sito:
// era scritta a mano, conosceva "Pasta" e non conosceva "Primi" né "Secondi Piatti".
export const CATEGORY_EMOJI = Object.fromEntries(
    Object.values(CATEGORIES_DATA).map(c => [c.label, c.emoji])
);

// ── Schema Definition ──

/**
 * Definizione campi con tipo, obbligatorietà, e validazione.
 * 
 * type:     'string' | 'number' | 'array' | 'object' | 'boolean'
 * required: true = errore se mancante, false = opzionale
 * validate: funzione custom di validazione (val, recipe) => string|null
 */
export const RECIPE_FIELDS = {
    // ── Meta ──
    title:       { type: 'string',  required: true,  description: 'Nome completo della ricetta' },
    slug:        { type: 'string',  required: true,  description: 'Slug URL-safe (kebab-case)', 
                   validate: v => /^[a-z0-9-]+$/.test(v) ? null : 'Slug deve essere kebab-case (es. pane-pugliese-biga)' },
    emoji:       { type: 'string',  required: true,  description: 'Emoji rappresentativa' },
    description: { type: 'string',  required: true,  description: 'Descrizione lunga SEO-friendly (80-200 char)' },
    subtitle:    { type: 'string',  required: true,  description: 'Sottotitolo breve' },
    category:    { type: 'string',  required: true,  description: `Categoria principale o nuova categoria personalizzata`,
                   validate: v => typeof v === 'string' && v.trim().length > 0 ? null : `Categoria deve essere testuale` },

    // ── Parametri Tecnici ──
    hydration:    { type: 'number',  required: false,  description: 'Idratazione % (0 per dolci/pasta senza calcolo)',
                    validate: (v, recipe) => {
                        if (v === undefined || v === null) {
                            const needsDough = ['Pane', 'Pizza', 'Focaccia', 'Lievitati', 'Dolci'].includes(recipe?.category);
                            if (needsDough) return 'Idratazione obbligatoria per questa categoria (0 se non ha calcolo)';
                            return null;
                        }
                        return (typeof v === 'number' && (v === 0 || (v >= 25 && v <= 100))) ? null : `Idratazione ${v}% fuori range (0 o 25-100)`;
                    }},
    targetTemp:   { type: 'string',  required: false, description: 'Temperatura target impasto (es. "24-26°C")' },
    fermentation: { type: 'string',  required: false, description: 'Descrizione tempi fermentazione' },
    totalFlour:   { type: 'number',  required: false,  description: 'Farina totale in grammi (base per ricalcolo dosi, 0 per ricette senza farina)',
                    validate: (v, recipe) => {
                        if (v === undefined || v === null) {
                            const needsDough = ['Pane', 'Pizza', 'Focaccia', 'Lievitati', 'Dolci'].includes(recipe?.category);
                            if (needsDough) return 'totalFlour obbligatoria per questa categoria (0 se senza farina)';
                            return null;
                        }
                        if (typeof v !== 'number') return 'totalFlour deve essere un numero';
                        return v >= 0 ? null : 'totalFlour deve essere >= 0';
                    }},

    // ── Ingredienti ──
    ingredients:     { type: 'array',  required: true,  description: 'Array legacy vuoto (deprecato, usare ingredientGroups)' },
    ingredientGroups:{ type: 'array',  required: true,  description: 'Gruppi ingredienti [{group, items: [{name, grams, note?, excludeFromTotal?}]}]',
                       validate: (v) => {
                           if (!Array.isArray(v) || v.length === 0) return 'Deve avere almeno 1 gruppo ingredienti';
                           for (const g of v) {
                               if (!g.group || typeof g.group !== 'string') return `Gruppo senza nome`;
                               if (!Array.isArray(g.items) || g.items.length === 0) return `Gruppo "${g.group}" senza items`;
                               for (const item of g.items) {
                                   if (!item.name) return `Ingrediente senza nome nel gruppo "${g.group}"`;
                                   if (typeof item.grams !== 'number') return `"${item.name}": grams deve essere un numero`;
                               }
                           }
                           return null;
                       }},
    suspensions:     { type: 'array',  required: false,  description: 'Condimenti/sospensioni (vuoto se non applicabile)' },

    // ── Procedimento ──
    steps:         { type: 'array',  required: true,  description: 'Step procedimento [{title, text}]' },
    stepsCondiment:{ type: 'array',  required: false, description: 'Step per condimenti/creme/farciture' },

    // ── Supporto ──
    flourTable:  { type: 'array',  required: false, description: 'Tabella farine [{type, w, brands}]' },
    baking:      { type: 'object', required: false, description: 'Cottura {temperature, time, tips[]}',
                   validate: (v, recipe) => {
                       if (CATEGORIES_NEEDING_BAKING.includes(recipe?.category) && !v) {
                           return `Categoria "${recipe.category}" richiede la sezione baking`;
                       }
                       if (v) {
                           if (!v.temperature) return 'baking.temperature mancante';
                           if (!v.time) return 'baking.time mancante';
                       }
                       return null;
                   }},
    glossary:    { type: 'array',  required: true,  description: 'Glossario [{term, definition}]' },
    alert:       { type: 'string', required: true,  description: 'Avvisi critici (cosa NON fare)' },
    proTips:     { type: 'array',  required: true,  description: 'Consigli pro [string]' },
    storage:     { type: 'array',  required: true,  description: 'Consigli tecnici sulla conservazione [string]' },

    // ── Media & SEO ──
    image:         { type: 'string', required: true,  description: 'Path immagine relativo (images/ricette/cat/slug.webp)' },
    imageKeywords: { type: 'array',  required: true,  description: 'Keyword per ricerca immagini [string]' },
    tags:          { type: 'array',  required: true,  description: 'Tag per SEO e filtri [string]' },

    // ── Opzionali ──
    imageAttribution: { type: 'string',  required: false, description: 'Attribuzione foto (crediti)' },
    _originalImageUrl:{ type: 'string',  required: false, description: 'URL originale immagine (interno)' },
    _generatedBy:     { type: 'string',  required: false, description: 'Modello AI usato per la generazione (interno)' },
    _createdAt:       { type: 'string',  required: false, description: 'Data ISO di creazione della ricetta (interno)' },
    sensoryProfile:   { type: 'object',  required: false, description: 'Profilo sensoriale { summary: string, axes: [{label, value}] }',
                        validate: (v) => {
                            if (!v) return null;
                            if (v.summary !== undefined && typeof v.summary !== 'string') return 'sensoryProfile.summary deve essere una stringa';
                            if (!Array.isArray(v.axes)) return 'sensoryProfile.axes deve essere un array';
                            if (v.axes.length < 4 || v.axes.length > 8) return 'Devono esserci tra 4 e 8 assi sensoriali';
                            for (const axis of v.axes) {
                                if (typeof axis.label !== 'string') return 'axis.label deve essere una stringa';
                                if (typeof axis.value !== 'number' || axis.value < 0 || axis.value > 10) return `Valore per asse "${axis.label}" deve essere un numero tra 0 e 10`;
                            }
                            return null;
                        }},
    nutrition:        { type: 'object',  required: false, description: 'Valori nutrizionali stimati per 100g',
                        validate: (v) => {
                            if (!v) return null;
                            if (typeof v.kcal_per_100g !== 'number') return 'nutrition.kcal_per_100g deve essere un numero';
                            if (!v.macros || typeof v.macros !== 'object') return 'nutrition.macros deve essere un oggetto';
                            if (typeof v.macros.carbs !== 'number') return 'macros.carbs deve essere un numero';
                            if (typeof v.macros.protein !== 'number') return 'macros.protein deve essere un numero';
                            if (typeof v.macros.fat !== 'number') return 'macros.fat deve essere un numero';
                            return null;
                        }},
};


// ── Validatore ──

/**
 * Valida una ricetta contro lo schema.
 * @param {object} recipe - L'oggetto ricetta da validare
 * @returns {{ errors: string[], warnings: string[], valid: boolean }}
 */
export function validateRecipeSchema(recipe) {
    const errors = [];
    const warnings = [];

    if (!recipe || typeof recipe !== 'object') {
        return { errors: ['Input non è un oggetto JSON valido'], warnings: [], valid: false };
    }

    // Check ogni campo definito
    for (const [field, spec] of Object.entries(RECIPE_FIELDS)) {
        const value = recipe[field];
        const hasValue = value !== undefined && value !== null;

        // Required check
        if (spec.required && !hasValue) {
            errors.push(`Campo obbligatorio mancante: "${field}" — ${spec.description}`);
            continue;
        }

        if (!hasValue) continue;

        // Type check
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== spec.type) {
            // Eccezione: hydration/totalFlour/targetTemp/fermentation possono essere null in ricette legacy
            if (['hydration', 'totalFlour'].includes(field) && value === null) {
                warnings.push(`"${field}" è null — dovrebbe essere ${spec.type}`);
            } else {
                errors.push(`"${field}": tipo ${actualType}, atteso ${spec.type}`);
            }
            continue;
        }

        // Custom validation
        if (spec.validate) {
            const err = spec.validate(value, recipe);
            if (err) {
                if (spec.required) {
                    errors.push(`"${field}": ${err}`);
                } else {
                    warnings.push(`"${field}": ${err}`);
                }
            }
        }
    }

    // Check campi extra non nello schema
    for (const key of Object.keys(recipe)) {
        if (!RECIPE_FIELDS[key]) {
            warnings.push(`Campo sconosciuto: "${key}" — non presente nello schema`);
        }
    }

    // Validazioni cross-field
    if (recipe.steps?.length > 0) {
        for (const step of recipe.steps) {
            if (!step.title || !step.text) {
                errors.push(`Step senza title o text: ${JSON.stringify(step).substring(0, 60)}`);
            }
        }
    }

    // Validazione token nei procedimenti (e mappatura per cross-check)
    const tokenValuesInSteps = {};
    const allSteps = [...(recipe.steps || []), ...(recipe.stepsCondiment || [])];
    
    if (allSteps.length > 0) {
        for (const step of allSteps) {
            if (!step.text) continue;
            
            // Check per token fissi malformati scritti testualmente invece che con le graffe (es. "285!g")
            const malformedRegex = /\b\d+(?:\.\d+)?![a-zA-Z]*\b/g;
            if (malformedRegex.test(step.text)) {
                errors.push(`Token fisso malformato nello step "${step.title}": Trovato valore con "!" senza parentesi graffe. Usa il formato {nome:valore!}`);
            }

            // La grammatica è quella del sito: la copia che stava qui era ferma a
            // `[a-z_]+` e non vedeva i token con cifre o maiuscole
            // ({farina_00:250}), quindi per loro il confronto grammi ↔
            // procedimento più sotto non scattava mai.
            for (const { token, id: name, valore: numVal, fisso } of tokenDelTesto(step.text)) {
                if (numVal <= 0) {
                    warnings.push(`Token ${token} ha valore non valido nello step "${step.title}"`);
                } else if (!fisso) {
                    if (tokenValuesInSteps[name] && tokenValuesInSteps[name] !== numVal) {
                        warnings.push(`Token {${name}} usato con valori multipli diversi negli step (${tokenValuesInSteps[name]} vs ${numVal})`);
                    }
                    tokenValuesInSteps[name] = numVal;
                }
            }
        }
    }

    // Graffe che il sito non risolverebbe: stessa funzione del cancello della
    // build, così la ricetta si ferma qui e non al sync, a JSON già scritto.
    for (const { campo, rotto } of graffeFuoriPosto(recipe)) {
        errors.push(rotto
            ? `Token malformato in "${campo}": ${JSON.stringify(rotto)} — la grammatica è {id:numero} o {id:numero!}`
            : `Graffe in "${campo}": il sito risolve i token solo nel testo degli step, qui arriverebbero al lettore come testo grezzo`);
    }

    // Idratazione e farina totale contro gli ingredienti. Il calcolo è quello
    // che usa la pipeline per scriverle (dashboard/condivisi/idratazione.js);
    // qui si accetta la convenzione più vicina al valore dichiarato, perché le
    // ricette pubblicate prima del 04/10/2026 ne usano tre diverse.
    if (recipe.hydration && recipe.hydration > 0 && recipe.ingredientGroups?.length > 0) {
        const calcolo = calcolaIdratazione(recipe);

        if (calcolo?.idratazione.contenuta != null) {
            const { convenzione, valore, scarto } = convenzionePiuVicina(recipe.hydration, calcolo);
            const etichetta = { contenuta: '', pura: ' (solo acqua)', intera: ' (liquidi non pesati, es. brioche)' }[convenzione];
            if (scarto > 3) {
                errors.push(`Idratazione dichiarata ${recipe.hydration}% ma calcolata ${valore}%${etichetta} (${Math.round(calcolo.acqua[convenzione])}g liquido / ${Math.round(calcolo.farina)}g farina). Scarto: ${scarto}%`);
            } else if (scarto > 1) {
                warnings.push(`Idratazione dichiarata ${recipe.hydration}% vs calcolata ${valore}%${etichetta} (scarto ${scarto}%)`);
            }
        }

        // totalFlour deve corrispondere alla somma di tutte le farine
        if (recipe.totalFlour && calcolo) {
            const farina = Math.round(calcolo.farina);
            const differenza = Math.abs(recipe.totalFlour - farina);
            if (differenza > 5) {
                errors.push(`totalFlour dichiarato ${recipe.totalFlour}g ma somma farine = ${farina}g (differenza: ${differenza}g)`);
            }
        }
    }

    // Validazione tokenId: ogni ingrediente DEVE avere un tokenId univoco
    if (recipe.ingredientGroups?.length > 0) {
        const allTokenIds = new Set();
        for (const g of recipe.ingredientGroups) {
            for (const item of g.items || []) {
                if (!item.tokenId) {
                    warnings.push(`Ingrediente \"${item.name}\" nel gruppo \"${g.group}\" senza tokenId — il calcolatore dosi non funzionerà correttamente`);
                } else {
                    if (allTokenIds.has(item.tokenId)) {
                        errors.push(`tokenId duplicato: \"${item.tokenId}\" — ogni ingrediente deve avere un tokenId unico`);
                    }
                    allTokenIds.add(item.tokenId);

                    // Cross-check: grams vs token value negli step
                    if (tokenValuesInSteps[item.tokenId] !== undefined) {
                        const stepVal = tokenValuesInSteps[item.tokenId];
                        // tolleranza per arrotondamenti di virgola mobile (es. 0.01)
                        if (Math.abs(stepVal - item.grams) > 0.05) {
                            errors.push(`Mismatch dosi per token "${item.tokenId}": nel testo c'è {${item.tokenId}:${stepVal}}, ma negli ingredienti grams = ${item.grams}`);
                        }
                    }
                }
            }
        }


    }

    return {
        errors,
        warnings,
        valid: errors.length === 0,
        score: errors.length === 0 ? (warnings.length === 0 ? 100 : Math.max(60, 100 - warnings.length * 5)) : 0,
    };
}


// ── Normalizzazione ──

/**
 * Riscrive come testo semplice i token che stanno FUORI dagli step.
 *
 * Il prompt chiede i token per le dosi del procedimento e il suffisso `!` per
 * temperature e tempi, e il modello ogni tanto li usa anche altrove: i cornetti
 * di ottobre 2026 avevano «{temp_rigenerazione:170!}°C» in `storage`. Lì il sito
 * non li risolve (vedi `graffeFuoriPosto`) e il cancello della build boccia
 * l'indice intero. Il valore sta dentro il token, quindi la riparazione è
 * meccanica e senza perdite: resta il numero, formattato come lo mostrerebbe il
 * sito. Le graffe che non sono token validi non si toccano: le segnala
 * validateRecipeSchema.
 *
 * Modifica `recipe` sul posto, come il resto della pipeline. I campi `_…` sono
 * metadati interni e non si toccano.
 *
 * @returns {string[]} i campi riscritti (es. "storage[2]"), da riportare nel log
 */
export function risolviTokenFuoriDaiStep(recipe) {
    const testiStep = new Set(
        [...(recipe.steps || []), ...(recipe.stepsCondiment || [])].map(s => s?.text)
    );
    const riscritti = [];
    const visita = (contenitore, chiave, percorso) => {
        const val = contenitore[chiave];
        if (typeof val === 'string') {
            if (testiStep.has(val)) return;
            const testo = risolviTokenTesto(val);
            if (testo !== val) {
                contenitore[chiave] = testo;
                riscritti.push(percorso);
            }
        } else if (Array.isArray(val)) {
            val.forEach((_, i) => visita(val, i, `${percorso}[${i}]`));
        } else if (val && typeof val === 'object') {
            for (const k of Object.keys(val)) {
                if (!k.startsWith('_')) visita(val, k, `${percorso}.${k}`);
            }
        }
    };
    for (const k of Object.keys(recipe)) {
        if (!k.startsWith('_')) visita(recipe, k, k);
    }
    return riscritti;
}


// ── Helper per schema summary (usabile nei prompt AI) ──

/**
 * Genera una descrizione testuale dello schema per i prompt AI.
 * @returns {string} Schema description in formato leggibile
 */
export function getSchemaPromptDescription() {
    const lines = ['SCHEMA RICETTA JSON — Campi e Regole:\n'];

    const groups = {
        'Meta': ['title', 'slug', 'emoji', 'description', 'subtitle', 'category'],
        'Parametri Tecnici': ['hydration', 'targetTemp', 'fermentation', 'totalFlour'],
        'Ingredienti': ['ingredients', 'ingredientGroups', 'suspensions'],
        'Procedimento': ['steps', 'stepsCondiment'],
        'Supporto': ['flourTable', 'baking', 'glossary', 'alert', 'proTips', 'storage'],
        'Media & SEO': ['image', 'imageKeywords', 'tags'],
        'Opzionali': ['imageAttribution', '_originalImageUrl', 'sensoryProfile'],
    };

    for (const [groupName, fields] of Object.entries(groups)) {
        lines.push(`\n── ${groupName} ──`);
        for (const field of fields) {
            const spec = RECIPE_FIELDS[field];
            if (!spec) continue;
            const req = spec.required ? '✅ REQUIRED' : '⬜ optional';
            lines.push(`  ${field} (${spec.type}) [${req}] — ${spec.description}`);
        }
    }

    lines.push('\n── Regole Token ──');
    lines.push('  Sintassi: {nome_ingrediente:valore}g nel testo procedimento');
    lines.push('  Token fisso: {nome:valore!}g — NON viene scalato dal dose calculator');
    lines.push('  Esempio: {farina:500}g (scalabile), {panetto_peso:285!}g (fisso)');

    lines.push('\n── Regole ingredientGroups ──');
    lines.push('  excludeFromTotal: true → sub-ingrediente di pre-impasto, i grams NON contano nel totale dosi (ma SI per idratazione)');

    return lines.join('\n');
}
