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

export const VALID_CATEGORIES = ['Pane', 'Pizza', 'Focaccia', 'Pasta', 'Lievitati', 'Dolci', 'Conserve'];

export const CATEGORIES_NEEDING_BAKING = ['Pane', 'Pizza', 'Focaccia', 'Lievitati', 'Dolci'];

export const CATEGORY_EMOJI = {
    Pane: '🍞', Pizza: '🍕', Focaccia: '🫓',
    Pasta: '🍝', Lievitati: '🥐', Dolci: '🍰',
    Conserve: '🫙',
};

// Token regex: {nome:valore} con suffisso opzionale ! per fissi
export const TOKEN_REGEX = /\{([a-z_]+):(\d+(?:\.\d+)?)(!)?\}/g;

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
    hydration:    { type: 'number',  required: true,  description: 'Idratazione % (0 per dolci/pasta senza calcolo)',
                    validate: (v) => (typeof v === 'number' && (v === 0 || (v >= 25 && v <= 100))) ? null : `Idratazione ${v}% fuori range (0 o 25-100)` },
    targetTemp:   { type: 'string',  required: true,  description: 'Temperatura target impasto (es. "24-26°C")' },
    fermentation: { type: 'string',  required: true,  description: 'Descrizione tempi fermentazione' },
    totalFlour:   { type: 'number',  required: true,  description: 'Farina totale in grammi (base per ricalcolo dosi, 0 per ricette senza farina)',
                    validate: (v, recipe) => {
                        if (typeof v !== 'number') return 'totalFlour deve essere un numero';
                        // Categorie che possono non avere farina
                        const NO_FLOUR_CATEGORIES = ['Conserve', 'Dolci'];
                        if (NO_FLOUR_CATEGORIES.includes(recipe?.category)) return null; // 0 valido
                        return v > 0 ? null : 'totalFlour deve essere > 0';
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
    suspensions:     { type: 'array',  required: true,  description: 'Condimenti/sospensioni (vuoto se non applicabile)' },

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

    // ── Media & SEO ──
    image:         { type: 'string', required: true,  description: 'Path immagine relativo (images/ricette/cat/slug.webp)' },
    imageKeywords: { type: 'array',  required: true,  description: 'Keyword per ricerca immagini [string]' },
    tags:          { type: 'array',  required: true,  description: 'Tag per SEO e filtri [string]' },

    // ── Opzionali ──
    imageAttribution: { type: 'string',  required: false, description: 'Attribuzione foto (crediti)' },
    _originalImageUrl:{ type: 'string',  required: false, description: 'URL originale immagine (interno)' },
    _generatedBy:     { type: 'string',  required: false, description: 'Modello AI usato per la generazione (interno)' },
    _createdAt:       { type: 'string',  required: false, description: 'Data ISO di creazione della ricetta (interno)' },

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

    // Validazione token nei procedimenti
    if (recipe.steps?.length > 0) {
        for (const step of recipe.steps) {
            if (!step.text) continue;
            let match;
            const tokenRegex = new RegExp(TOKEN_REGEX.source, 'g');
            while ((match = tokenRegex.exec(step.text)) !== null) {
                const [, name, value, fixed] = match;
                const numVal = parseFloat(value);
                if (isNaN(numVal) || numVal <= 0) {
                    warnings.push(`Token {${name}:${value}} ha valore non valido nello step "${step.title}"`);
                }
            }
        }
    }

    // Validazione idratazione vs ingredienti reali (Baker's Percentage)
    // L'idratazione si calcola su TUTTA la farina e TUTTA l'acqua del prodotto finale,
    // inclusi i pre-impasti (biga, poolish, ecc.). Gli ingredienti "assemblati"
    // (es. "Biga Matura" nel gruppo impasto) vengono esclusi per evitare doppio conteggio:
    // le loro materie prime (farina+acqua) sono già nel gruppo pre-impasto.
    // NOTA: excludeFromTotal su singoli ingredienti è per il calcolatore dosi frontend.
    // Per l'idratazione: se TUTTI gli items di un gruppo hanno excludeFromTotal,
    // il gruppo è una fase separata (starter, bagnetto) e viene escluso dal calcolo.
    if (recipe.hydration && recipe.hydration > 0 && recipe.ingredientGroups?.length > 0) {
        const flourKeywords = ['farina', 'semola', 'manitoba', 'tipo 0', 'tipo 00', 'tipo 1', 'tipo 2', 'integrale', 'nuvola', 'saccorosso'];
        // Liquidi con coefficiente idratazione (% di acqua nel liquido)
        // ORDINE IMPORTANTE: keyword più specifiche PRIMA per evitare match errati
        // (es. "Tuorli d'uovo" deve matchare 'tuorli' coeff 0.50, NON 'uovo' coeff 0.75)
        const liquidKeywords = [
            { kw: 'acqua', coeff: 1.0 },
            { kw: 'latte', coeff: 0.87 },
            { kw: 'tuorlo', coeff: 0.50 }, { kw: 'tuorli', coeff: 0.50 },
            { kw: 'albume', coeff: 0.90 }, { kw: 'albumi', coeff: 0.90 },
            { kw: 'uova', coeff: 0.75 }, { kw: 'uovo', coeff: 0.75 },
            { kw: 'birra', coeff: 0.92 },
            { kw: 'succo', coeff: 0.88 },
        ];
        // Ingredienti assemblati: prodotto finito di un pre-impasto, NON materie prime
        const assembledKeywords = ['biga', 'poolish', 'lievitino', 'prefermento', 'pre-fermento', 'lievito madre', 'pasta madre'];
        let totalFlourGrams = 0;
        let totalWaterGrams = 0;
        let totalPureWaterGrams = 0;  // Solo acqua pura (coeff 1.0), per confronto alternativo

        for (const g of recipe.ingredientGroups) {
            // Skip gruppi NON parte dell'impasto (doratura, decorazione, finitura, glassa)
            const groupName = (g.group || '').toLowerCase();
            const nonDoughGroups = ['doratura', 'decorazione', 'finitura', 'copertura', 'glassa', 'guarnizione', 'topping'];
            if (nonDoughGroups.some(kw => groupName.includes(kw))) continue;

            // Skip fasi interamente ausiliarie (starter, bagnetto, ecc.)
            // Se TUTTI gli items hanno excludeFromTotal: true, la fase non è parte del prodotto finale
            const allItemsExcluded = (g.items || []).length > 0 && (g.items || []).every(item => item.excludeFromTotal === true);
            if (allItemsExcluded) continue;

            for (const item of g.items || []) {
                const name = (item.name || '').toLowerCase();

                // Escludi falsi positivi: "Zucchero Semolato" contiene "semola" ma NON è farina
                const notFlourKeywords = ['zucchero', 'sale', 'lievito', 'malto', 'miele'];
                const isExcluded = notFlourKeywords.some(kw => name.includes(kw));
                const isFlour = !isExcluded && flourKeywords.some(kw => name.includes(kw));
                const matchedLiquid = liquidKeywords.find(l => name.includes(l.kw));
                const isFlourOrLiquid = isFlour || !!matchedLiquid;

                // Ingredienti assemblati (es. "Biga Matura", "Poolish Maturo", "Lievito Madre Solido")
                // Le materie prime (farina+acqua) sono già nel gruppo pre-impasto.
                // Eccezione: lievito madre/pasta madre → decomposizione in farina+acqua
                const isAssembled = !isFlourOrLiquid && assembledKeywords.some(kw => name.includes(kw));
                if (isAssembled) {
                    // Se ha excludeFromTotal, è un ingrediente di input (non entra nel prodotto finale)
                    if (item.excludeFromTotal) continue;
                    // Decomposizione lievito madre/pasta madre (contiene farina+acqua intrappolati)
                    const isSourdough = ['lievito madre', 'pasta madre'].some(kw => name.includes(kw));
                    if (isSourdough && item.grams > 0) {
                        const noteText = (item.note || '').toLowerCase();
                        const hydMatch = noteText.match(/(\d+)\s*%\s*(?:di\s*)?idratazione/);
                        const lmHydration = hydMatch ? parseInt(hydMatch[1]) / 100 : 0.5; // default 50%
                        const lmFlour = item.grams / (1 + lmHydration);
                        const lmWater = item.grams - lmFlour;
                        totalFlourGrams += lmFlour;
                        totalWaterGrams += lmWater;
                        totalPureWaterGrams += lmWater;
                    }
                    continue;
                }

                // Conta materie prime per baker's percentage
                if (isFlour) totalFlourGrams += item.grams || 0;
                if (matchedLiquid) {
                    const waterContrib = (item.grams || 0) * matchedLiquid.coeff;
                    totalWaterGrams += waterContrib;
                    if (matchedLiquid.coeff === 1.0) totalPureWaterGrams += waterContrib;
                }
            }
        }

        // Validazione idratazione (baker's percentage con liquidi pesati)
        // Doppio confronto: idratazione "totale" (tutti i liquidi pesati) e "pura" (solo acqua)
        // Per impasti arricchiti (panettone, brioche) il valore dichiarato corrisponde spesso
        // all'idratazione "pura" (acqua/farina), non a quella con uova/latte
        if (totalFlourGrams > 0 && totalWaterGrams > 0) {
            const computedTotal = Math.round((totalWaterGrams / totalFlourGrams) * 100);
            const computedPure = totalPureWaterGrams > 0
                ? Math.round((totalPureWaterGrams / totalFlourGrams) * 100) : null;
            const declared = recipe.hydration;
            const diffTotal = Math.abs(computedTotal - declared);
            const diffPure = computedPure !== null ? Math.abs(computedPure - declared) : Infinity;

            // Usa il confronto più favorevole (evita falsi positivi su impasti arricchiti)
            const bestDiff = Math.min(diffTotal, diffPure);
            const bestComputed = diffTotal <= diffPure ? computedTotal : computedPure;
            const bestWater = diffTotal <= diffPure ? Math.round(totalWaterGrams) : Math.round(totalPureWaterGrams);
            const bestLabel = diffTotal <= diffPure ? '' : ' (solo acqua)';

            if (bestDiff > 3) {
                errors.push(`Idratazione dichiarata ${declared}% ma calcolata ${bestComputed}%${bestLabel} (${bestWater}g acqua / ${Math.round(totalFlourGrams)}g farina). Scarto: ${bestDiff}%`);
            } else if (bestDiff > 1) {
                warnings.push(`Idratazione dichiarata ${declared}% vs calcolata ${bestComputed}%${bestLabel} (scarto ${bestDiff}%)`);
            }
        }

        // Validazione totalFlour (deve corrispondere alla somma di tutte le farine)
        if (recipe.totalFlour && totalFlourGrams > 0) {
            const roundedFlour = Math.round(totalFlourGrams);
            const flourDiff = Math.abs(recipe.totalFlour - roundedFlour);
            if (flourDiff > 5) {
                errors.push(`totalFlour dichiarato ${recipe.totalFlour}g ma somma farine = ${roundedFlour}g (differenza: ${flourDiff}g)`);
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
        'Supporto': ['flourTable', 'baking', 'glossary', 'alert', 'proTips'],
        'Media & SEO': ['image', 'imageKeywords', 'tags'],
        'Opzionali': ['imageAttribution', '_originalImageUrl'],
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
