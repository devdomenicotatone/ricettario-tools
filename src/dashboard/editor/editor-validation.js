/**
 * RECIPE EDITOR — Validation Engine
 * 
 * Validazione inline dello schema ricetta:
 * campi obbligatori, range idratazione, token, coerenza ingredienti.
 */

import { VALID_CATEGORY_NAMES as VALID_CATEGORIES } from '/shared/categories.js';

const TOKEN_REGEX = /\{([a-z_]+):(\d+(?:\.\d+)?)(!)?}/g;

/**
 * Installa la logica di validazione sullo state manager.
 * @param {import('./editor-state.js').RecipeEditorState} state 
 */
export function installValidation(state) {
    state.runValidation = function () {
        const r = this.currentRecipe;
        if (!r) return;
        const errors = [];
        const warnings = [];

        // Required string checks
        const requiredStrings = ['title', 'slug', 'emoji', 'description', 'subtitle', 'category'];
        for (const f of requiredStrings) {
            if (!r[f] || !String(r[f]).trim()) errors.push(`"${f}" è obbligatorio`);
        }

        // Category
        if (r.category && !VALID_CATEGORIES.includes(r.category)) {
            errors.push(`Categoria "${r.category}" non valida`);
        }

        // Hydration
        if (r.hydration != null && typeof r.hydration === 'number') {
            if (r.hydration !== 0 && (r.hydration < 25 || r.hydration > 100)) {
                errors.push(`Idratazione ${r.hydration}% fuori range (0 o 25-100)`);
            }
        } else {
            errors.push('"hydration" deve essere un numero');
        }

        // IngredientGroups
        if (!r.ingredientGroups?.length) {
            errors.push('Almeno 1 gruppo ingredienti');
        } else {
            for (const g of r.ingredientGroups) {
                if (!g.group) errors.push('Gruppo ingredienti senza nome');
                if (!g.items?.length) errors.push(`Gruppo "${g.group}" senza ingredienti`);
                for (const item of (g.items || [])) {
                    if (!item.name) errors.push(`Ingrediente senza nome in "${g.group}"`);
                    if (typeof item.grams !== 'number') errors.push(`"${item.name}": grams non è un numero`);
                }
            }
        }

        // Steps
        if (!r.steps?.length) errors.push('Almeno 1 step nel procedimento');
        const allSteps = [...(r.steps || []), ...(r.stepsCondiment || [])];
        for (const s of allSteps) {
            if (!s.title || !s.text) errors.push(`Step senza title o text`);
        }

        // Token validation in steps
        for (const step of allSteps) {
            if (!step.text) continue;
            const tokenRegex = new RegExp(TOKEN_REGEX.source, 'g');
            let m;
            while ((m = tokenRegex.exec(step.text)) !== null) {
                const num = parseFloat(m[2]);
                if (isNaN(num) || num <= 0) {
                    warnings.push(`Token {${m[1]}:${m[2]}} non valido in "${step.title}"`);
                }
            }
        }

        // Baking for categories that need it
        const needsBaking = ['Pane', 'Pizza', 'Focaccia', 'Lievitati', 'Dolci'];
        if (needsBaking.includes(r.category) && !r.baking) {
            errors.push(`Categoria "${r.category}" richiede sezione cottura`);
        }

        // Slug format
        if (r.slug && !/^[a-z0-9-]+$/.test(r.slug)) {
            errors.push('Slug deve essere kebab-case (solo a-z, 0-9, -)');
        }

        // Hydration vs ingredients cross-validation
        if (r.hydration && r.hydration > 0 && r.ingredientGroups?.length) {
            const flourKw = ['farina', 'semola', 'manitoba', 'tipo 0', 'tipo 00', 'tipo 1', 'tipo 2', 'integrale', 'nuvola', 'saccorosso'];
            const liquidKw = [{ kw: 'acqua', c: 1 }, { kw: 'latte', c: 0.87 }, { kw: 'uova', c: 0.75 }, { kw: 'uovo', c: 0.75 }, { kw: 'tuorlo', c: 0.5 }, { kw: 'tuorli', c: 0.5 }, { kw: 'albume', c: 0.9 }, { kw: 'albumi', c: 0.9 }];
            const assembled = ['biga', 'poolish', 'lievitino', 'prefermento', 'lievito madre', 'pasta madre'];
            let flour = 0, water = 0, pureWater = 0, rawLiquid = 0;
            for (const g of r.ingredientGroups) {
                const groupName = (g.group || '').toLowerCase();
                const nonDoughGroups = ['doratura', 'decorazione', 'finitura', 'copertura', 'glassa', 'guarnizione', 'topping'];
                if (nonDoughGroups.some(kw => groupName.includes(kw))) continue;

                for (const it of (g.items || [])) {
                    if (it.excludeFromTotal) continue;

                    const n = (it.name || '').toLowerCase();
                    const isExcluded = ['zucchero', 'sale', 'lievito', 'malto', 'miele'].some(kw => n.includes(kw));
                    const isFL = !isExcluded && flourKw.some(k => n.includes(k));
                    const lq = liquidKw.find(l => n.includes(l.kw));
                    const isA = !isFL && !lq && assembled.some(k => n.includes(k));
                    if (isA) continue;
                    
                    if (isFL) flour += it.grams || 0;
                    if (lq) {
                        const amount = it.grams || 0;
                        water += amount * lq.c;
                        rawLiquid += amount;
                        if (lq.c === 1) pureWater += amount;
                    }
                }
            }
            if (flour > 0 && water > 0) {
                const computedTotal = Math.round((water / flour) * 100);
                const computedPure = pureWater > 0 ? Math.round((pureWater / flour) * 100) : null;
                const computedRaw = rawLiquid > 0 ? Math.round((rawLiquid / flour) * 100) : null;
                
                const dec = r.hydration;
                const diffTotal = Math.abs(computedTotal - dec);
                const diffPure = computedPure !== null ? Math.abs(computedPure - dec) : Infinity;
                const diffRaw = computedRaw !== null ? Math.abs(computedRaw - dec) : Infinity;
                
                const bestDiff = Math.min(diffTotal, diffPure, diffRaw);
                const bestComputed = bestDiff === diffTotal ? computedTotal : (bestDiff === diffPure ? computedPure : computedRaw);
                
                if (bestDiff > 3) errors.push(`Idratazione dichiarata ${dec}% ma calcolata ${bestComputed}%`);
                else if (bestDiff > 1) warnings.push(`Idratazione: ${dec}% vs calcolata ${bestComputed}%`);
            }
        }

        const score = errors.length === 0 ? (warnings.length === 0 ? 100 : Math.max(60, 100 - warnings.length * 5)) : Math.max(10, 50 - errors.length * 8);
        this.validationResult = { errors, warnings, valid: errors.length === 0, score };
        this._emitValidation();
    };
}
