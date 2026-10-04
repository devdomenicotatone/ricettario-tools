/**
 * RECIPE EDITOR — Validation Engine
 * 
 * Validazione inline dello schema ricetta:
 * campi obbligatori, range idratazione, token, coerenza ingredienti.
 */

import { VALID_CATEGORY_NAMES as VALID_CATEGORIES } from '/shared/categories.js';
// La grammatica dei token è quella del sito, servita sotto /shared come le
// categorie. La copia che stava qui era ferma a `[a-z_]+` e non vedeva i token
// con cifre o maiuscole ({farina_00:250}); e le graffe fuori dagli step, che
// fermano la build del sito, l'editor non le segnalava affatto.
import { tokenDelTesto, graffeFuoriPosto } from '/shared/token-dosi.js';
import { calcolaIdratazione, convenzionePiuVicina } from '../condivisi/idratazione.js';

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
            for (const { token, valore } of tokenDelTesto(step.text)) {
                if (valore <= 0) warnings.push(`Token ${token} non valido in "${step.title}"`);
            }
        }

        // Graffe che il sito non risolverebbe (stessa regola del cancello della build)
        for (const { campo, rotto } of graffeFuoriPosto(r)) {
            errors.push(rotto
                ? `Token malformato in "${campo}": ${JSON.stringify(rotto)}`
                : `Graffe in "${campo}": fuori dagli step arrivano al lettore come testo grezzo`);
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

        // Idratazione e farina totale contro gli ingredienti: lo stesso calcolo
        // dello schema dei tools e della pipeline (../condivisi/idratazione.js).
        // La copia che stava qui aveva regole sue (niente lievito madre scomposto,
        // esclusioni voce per voce) e dava risultati diversi da quelli del server.
        if (r.hydration && r.hydration > 0 && r.ingredientGroups?.length) {
            const calcolo = calcolaIdratazione(r);
            if (calcolo?.idratazione.contenuta != null) {
                const { valore, scarto } = convenzionePiuVicina(r.hydration, calcolo);
                if (scarto > 3) errors.push(`Idratazione dichiarata ${r.hydration}% ma calcolata ${valore}%`);
                else if (scarto > 1) warnings.push(`Idratazione: ${r.hydration}% vs calcolata ${valore}%`);
            }
            if (r.totalFlour && calcolo && Math.abs(r.totalFlour - Math.round(calcolo.farina)) > 5) {
                errors.push(`Farina totale ${r.totalFlour} g ma la somma delle farine è ${Math.round(calcolo.farina)} g`);
            }
        }

        const score = errors.length === 0 ? (warnings.length === 0 ? 100 : Math.max(60, 100 - warnings.length * 5)) : Math.max(10, 50 - errors.length * 8);
        this.validationResult = { errors, warnings, valid: errors.length === 0, score };
        this._emitValidation();
    };
}
