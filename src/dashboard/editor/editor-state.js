/**
 * RECIPE EDITOR — State Manager
 * 
 * Gestisce lo stato della ricetta in editing:
 * Load/Save, Undo/Redo, Auto-save, event emitter.
 */

export class RecipeEditorState {
    constructor() {
        this.originalRecipe = null;
        this.currentRecipe = null;
        this.cat = null;
        this.slug = null;
        this.isDirty = false;
        this.isLoading = false;
        this.isSaving = false;
        this.undoStack = [];
        this.redoStack = [];
        this.maxUndo = 50;
        this.saveTimeout = null;
        this.validationTimeout = null;
        this.validationResult = null;
        this.onChangeCallbacks = [];
        this.onValidationCallbacks = [];
        this.onStatusCallbacks = [];
    }

    onChange(cb) { this.onChangeCallbacks.push(cb); }
    onValidation(cb) { this.onValidationCallbacks.push(cb); }
    onStatus(cb) { this.onStatusCallbacks.push(cb); }

    _emitChange() { this.onChangeCallbacks.forEach(cb => cb(this.currentRecipe, this.isDirty)); }
    _emitValidation() { this.onValidationCallbacks.forEach(cb => cb(this.validationResult)); }
    _emitStatus(msg, type) { this.onStatusCallbacks.forEach(cb => cb(msg, type)); }

    async load(cat, slug) {
        this.isLoading = true;
        this._emitStatus('Caricamento...', 'loading');
        try {
            const resp = await fetch(`/api/ricetta/${cat}/${slug}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this.cat = cat;
            this.slug = slug;
            this.originalRecipe = JSON.parse(JSON.stringify(data.recipe));
            this.currentRecipe = JSON.parse(JSON.stringify(data.recipe));
            this.isDirty = false;
            this.undoStack = [];
            this.redoStack = [];
            this.isLoading = false;
            this._emitChange();
            this._emitStatus('Caricata', 'saved');
            this.runValidation();
        } catch (err) {
            this.isLoading = false;
            this._emitStatus(`Errore: ${err.message}`, 'error');
            throw err;
        }
    }

    update(path, value) {
        this._pushUndo();
        setPath(this.currentRecipe, path, value);
        this.isDirty = true;
        this.redoStack = [];
        this._emitChange();
        this._emitStatus('Modifiche non salvate', 'dirty');
        this._debouncedValidation();
        this._debouncedAutoSave();
    }

    /** Update senza auto-save (per batch di modifiche) */
    updateSilent(path, value) {
        setPath(this.currentRecipe, path, value);
    }

    /** Commetti le batch silenti come un singolo undo step */
    commitBatch() {
        this._pushUndo();
        this.isDirty = true;
        this.redoStack = [];
        this._emitChange();
        this._emitStatus('Modifiche non salvate', 'dirty');
        this._debouncedValidation();
        this._debouncedAutoSave();
    }

    undo() {
        if (!this.undoStack.length) return;
        this.redoStack.push(structuredClone(this.currentRecipe));
        this.currentRecipe = this.undoStack.pop();
        this.isDirty = JSON.stringify(this.currentRecipe) !== JSON.stringify(this.originalRecipe);
        this._emitChange();
        this._debouncedValidation();
        if (!this.isDirty) this._emitStatus('Tutte le modifiche annullate', 'saved');
        else this._emitStatus('Undo', 'dirty');
    }

    redo() {
        if (!this.redoStack.length) return;
        this.undoStack.push(structuredClone(this.currentRecipe));
        this.currentRecipe = this.redoStack.pop();
        this.isDirty = JSON.stringify(this.currentRecipe) !== JSON.stringify(this.originalRecipe);
        this._emitChange();
        this._debouncedValidation();
        this._emitStatus('Redo', 'dirty');
    }

    async save() {
        if (this.isSaving || !this.isDirty) return;
        this.isSaving = true;
        this._emitStatus('Salvataggio...', 'saving');

        try {
            const resp = await fetch(`/api/ricetta/${this.cat}/${this.slug}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recipe: this.currentRecipe, autoRegen: true }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const result = await resp.json();
            this.originalRecipe = JSON.parse(JSON.stringify(this.currentRecipe));
            this.isDirty = false;
            this.isSaving = false;
            this._emitChange();
            const syncMsg = result.syncOk ? '✓ Salvata + cards sync' : '✓ Salvata';
            this._emitStatus(syncMsg, 'saved');
        } catch (err) {
            this.isSaving = false;
            this._emitStatus(`Errore salvataggio: ${err.message}`, 'error');
        }
    }

    /** Placeholder — viene sovrascritta da editor-validation.js */
    runValidation() {}

    // ── Private Helpers ──
    _pushUndo() {
        this.undoStack.push(JSON.parse(JSON.stringify(this.currentRecipe)));
        if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    }

    _debouncedAutoSave() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => this.save(), 1500);
    }

    _debouncedValidation() {
        if (this.validationTimeout) clearTimeout(this.validationTimeout);
        this.validationTimeout = setTimeout(() => this.runValidation(), 500);
    }
}

// ── Deep path setter (utility) ──
export function setPath(obj, path, value) {
    const parts = path.split('.');
    let target = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = isNaN(parts[i]) ? parts[i] : parseInt(parts[i]);
        if (target[key] === undefined) target[key] = {};
        target = target[key];
    }
    const lastKey = isNaN(parts[parts.length - 1]) ? parts[parts.length - 1] : parseInt(parts[parts.length - 1]);
    target[lastKey] = value;
}

// ── HTML escape utility ──
export function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
