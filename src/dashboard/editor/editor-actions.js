/**
 * RECIPE EDITOR — CRUD Actions
 * 
 * Azioni globali richiamate dai template HTML (onclick):
 * add/remove ingredienti, steps, gruppi, farine, tips, glossario, token.
 */

/**
 * Installa tutte le azioni CRUD globali su window.
 * @param {import('./editor-state.js').RecipeEditorState} state 
 * @param {() => void} rerender — callback per ri-renderizzare il tab attivo
 */
export function installCrudActions(state, rerender) {

    window.addGroup = function () {
        const groups = [...(state.currentRecipe.ingredientGroups || []), { group: 'Nuovo Gruppo', items: [{ name: '', grams: 0, note: '', tokenId: '' }] }];
        state.update('ingredientGroups', groups);
        rerender();
    };

    window.removeGroup = function (gi) {
        if (!confirm('Rimuovere questo gruppo?')) return;
        const groups = [...(state.currentRecipe.ingredientGroups || [])];
        groups.splice(gi, 1);
        state.update('ingredientGroups', groups);
        rerender();
    };

    window.addIngredient = function (gi) {
        const groups = JSON.parse(JSON.stringify(state.currentRecipe.ingredientGroups || []));
        groups[gi].items.push({ name: '', grams: 0, note: '', tokenId: '' });
        state.update('ingredientGroups', groups);
        rerender();
    };

    window.removeIngredient = function (gi, ii) {
        const groups = JSON.parse(JSON.stringify(state.currentRecipe.ingredientGroups || []));
        groups[gi].items.splice(ii, 1);
        state.update('ingredientGroups', groups);
        rerender();
    };

    window.addSuspension = function () {
        const susp = [...(state.currentRecipe.suspensions || []), { name: '', grams: 0, note: '' }];
        state.update('suspensions', susp);
        rerender();
    };

    window.removeSuspension = function (si) {
        const susp = [...(state.currentRecipe.suspensions || [])];
        susp.splice(si, 1);
        state.update('suspensions', susp);
        rerender();
    };

    window.addStep = function (key) {
        const steps = [...(state.currentRecipe[key] || []), { title: '', text: '' }];
        state.update(key, steps);
        rerender();
    };

    window.removeStep = function (key, si) {
        const steps = [...(state.currentRecipe[key] || [])];
        steps.splice(si, 1);
        state.update(key, steps);
        rerender();
    };

    window.moveStep = function (key, si, dir) {
        const steps = JSON.parse(JSON.stringify(state.currentRecipe[key] || []));
        const newIdx = si + dir;
        if (newIdx < 0 || newIdx >= steps.length) return;
        [steps[si], steps[newIdx]] = [steps[newIdx], steps[si]];
        state.update(key, steps);
        rerender();
    };

    window.addFlour = function () {
        const fl = [...(state.currentRecipe.flourTable || []), { type: '', w: '', brands: '' }];
        state.update('flourTable', fl);
        rerender();
    };

    window.removeFlour = function (fi) {
        const fl = [...(state.currentRecipe.flourTable || [])];
        fl.splice(fi, 1);
        state.update('flourTable', fl);
        rerender();
    };

    window.addBakingTip = function () {
        const b = JSON.parse(JSON.stringify(state.currentRecipe.baking || { temperature: '', time: '', tips: [] }));
        if (!b.tips) b.tips = [];
        b.tips.push('');
        state.update('baking', b);
        rerender();
    };

    window.removeBakingTip = function (ti) {
        const b = JSON.parse(JSON.stringify(state.currentRecipe.baking || {}));
        b.tips.splice(ti, 1);
        state.update('baking', b);
        rerender();
    };

    window.addProTip = function () {
        const tips = [...(state.currentRecipe.proTips || []), ''];
        state.update('proTips', tips);
        rerender();
    };

    window.removeProTip = function (ti) {
        const tips = [...(state.currentRecipe.proTips || [])];
        tips.splice(ti, 1);
        state.update('proTips', tips);
        rerender();
    };

    window.addStorage = function () {
        const tips = [...(state.currentRecipe.storage || []), ''];
        state.update('storage', tips);
        rerender();
    };

    window.removeStorage = function (ti) {
        const tips = [...(state.currentRecipe.storage || [])];
        tips.splice(ti, 1);
        state.update('storage', tips);
        rerender();
    };

    window.addGlossary = function () {
        const gl = [...(state.currentRecipe.glossary || []), { term: '', definition: '' }];
        state.update('glossary', gl);
        rerender();
    };

    window.removeGlossary = function (gi) {
        const gl = [...(state.currentRecipe.glossary || [])];
        gl.splice(gi, 1);
        state.update('glossary', gl);
        rerender();
    };

    // ── Token Inserter ──
    window.insertToken = function (tokenId, grams) {
        const textarea = window.__editorActiveTextarea;
        if (!textarea) {
            if (typeof showToast === 'function') showToast('Clicca prima su un textarea del procedimento', 'warning');
            return;
        }
        const token = `{${tokenId}:${grams}}`;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        textarea.value = text.slice(0, start) + token + text.slice(end);
        textarea.focus();
        textarea.setSelectionRange(start + token.length, start + token.length);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    };
}
