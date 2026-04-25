/**
 * RECIPE EDITOR — Ultra Pro Inline Editor
 * 
 * Ispirato al Template Studio di OmniWriter.
 * State Manager + Tab Panels + Auto-Save + Undo/Redo + Validazione Inline.
 */

// ── Imports (schema validation è nello scope del browser, usiamo fetch) ──

const VALID_CATEGORIES = ['Pane', 'Pizza', 'Focaccia', 'Pasta', 'Lievitati', 'Dolci', 'Conserve'];
const TOKEN_REGEX = /\{([a-z_]+):(\d+(?:\.\d+)?)(!)?\}/g;

// ═══════════════════════════════════════════════════════
//  STATE MANAGER (ispirato a TemplateStateManager)
// ═══════════════════════════════════════════════════════

class RecipeEditorState {
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
        // Push undo
        this._pushUndo();
        // Deep set
        this._setPath(this.currentRecipe, path, value);
        this.isDirty = true;
        this.redoStack = [];
        this._emitChange();
        this._emitStatus('Modifiche non salvate', 'dirty');
        this._debouncedValidation();
        this._debouncedAutoSave();
    }

    /** Update senza auto-save (per batch di modifiche) */
    updateSilent(path, value) {
        this._setPath(this.currentRecipe, path, value);
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
        this.redoStack.push(JSON.parse(JSON.stringify(this.currentRecipe)));
        this.currentRecipe = this.undoStack.pop();
        this.isDirty = JSON.stringify(this.currentRecipe) !== JSON.stringify(this.originalRecipe);
        this._emitChange();
        this._debouncedValidation();
        if (!this.isDirty) this._emitStatus('Tutte le modifiche annullate', 'saved');
        else this._emitStatus('Undo', 'dirty');
    }

    redo() {
        if (!this.redoStack.length) return;
        this.undoStack.push(JSON.parse(JSON.stringify(this.currentRecipe)));
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

    runValidation() {
        const r = this.currentRecipe;
        if (!r) return;
        const errors = [];
        const warnings = [];

        // Required string checks
        const requiredStrings = ['title', 'slug', 'emoji', 'description', 'subtitle', 'category', 'targetTemp', 'fermentation', 'alert'];
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

        // Hydration vs ingredients
        if (r.hydration && r.hydration > 0 && r.ingredientGroups?.length) {
            const flourKw = ['farina', 'semola', 'manitoba', 'tipo 0', 'tipo 00', 'tipo 1', 'tipo 2', 'integrale', 'nuvola', 'saccorosso'];
            const liquidKw = [{ kw: 'acqua', c: 1 }, { kw: 'latte', c: 0.87 }, { kw: 'uova', c: 0.75 }, { kw: 'uovo', c: 0.75 }, { kw: 'tuorlo', c: 0.5 }, { kw: 'tuorli', c: 0.5 }, { kw: 'albume', c: 0.9 }, { kw: 'albumi', c: 0.9 }];
            const assembled = ['biga', 'poolish', 'lievitino', 'prefermento', 'lievito madre', 'pasta madre'];
            let flour = 0, water = 0, pureWater = 0, rawLiquid = 0;
            for (const g of r.ingredientGroups) {
                // skip non dough groups
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
    }

    // ── Private Helpers ──
    _pushUndo() {
        this.undoStack.push(JSON.parse(JSON.stringify(this.currentRecipe)));
        if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    }

    _setPath(obj, path, value) {
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

    _debouncedAutoSave() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => this.save(), 1500);
    }

    _debouncedValidation() {
        if (this.validationTimeout) clearTimeout(this.validationTimeout);
        this.validationTimeout = setTimeout(() => this.runValidation(), 500);
    }
}

// ═══════════════════════════════════════════════════════
//  RECIPE EDITOR UI
// ═══════════════════════════════════════════════════════

const state = new RecipeEditorState();
let editorOverlay = null;
let activeTab = 'meta';
let activeTextarea = null; // per token helper insertion

function createEditorDOM() {
    if (editorOverlay) return;

    editorOverlay = document.createElement('div');
    editorOverlay.className = 'recipe-editor-overlay';
    editorOverlay.id = 'recipeEditorOverlay';
    editorOverlay.innerHTML = `
        <div class="recipe-editor" id="recipeEditorPanel">
            <!-- Header -->
            <div class="re-header">
                <button class="re-back-btn" id="reCloseBtn" title="Chiudi (Esc)">
                    <i data-lucide="arrow-left"></i>
                </button>
                <div class="re-title-area">
                    <div class="re-title" id="reTitle">—</div>
                    <div class="re-subtitle" id="reSubtitle">—</div>
                </div>
                <div class="re-actions" style="position:relative">
                    <div class="re-status-pill" id="reStatusPill"></div>
                    <button class="re-action-btn" id="reSensoryBtn" title="Genera Profilo Sensoriale AI"><i data-lucide="sparkles"></i></button>
                    <button class="re-action-btn" id="reUndoBtn" title="Undo (Ctrl+Z)" disabled><i data-lucide="undo-2"></i></button>
                    <button class="re-action-btn" id="reRedoBtn" title="Redo (Ctrl+Shift+Z)" disabled><i data-lucide="redo-2"></i></button>
                    <button class="re-action-btn" id="reOpenBtn" title="Apri nel sito"><i data-lucide="external-link"></i></button>
                </div>
            </div>

            <!-- Tabs -->
            <div class="re-tabs">
                <button class="re-tab active" data-tab="meta"><span class="re-tab-icon">🏷️</span> Meta</button>
                <button class="re-tab" data-tab="ingredients"><span class="re-tab-icon">🛒</span> Ingredienti</button>
                <button class="re-tab" data-tab="steps"><span class="re-tab-icon">⚙️</span> Procedimento</button>
                <button class="re-tab" data-tab="support"><span class="re-tab-icon">📚</span> Supporto</button>
            </div>

            <!-- Content -->
            <div class="re-content" id="reContent"></div>

            <!-- Footer -->
            <div class="re-footer">
                <div class="re-footer-info">
                    <span id="reValidationBadge"></span>
                    <span id="reValidationSummary"></span>
                </div>
                <div class="re-footer-info">
                    <span id="reSlugDisplay" style="font-family:monospace;font-size:11px;color:#475569"></span>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(editorOverlay);
    lucide.createIcons({ nodes: [editorOverlay] });

    // Bind events
    document.getElementById('reCloseBtn').onclick = closeEditor;
    document.getElementById('reUndoBtn').onclick = () => { state.undo(); renderActiveTab(); };
    document.getElementById('reRedoBtn').onclick = () => { state.redo(); renderActiveTab(); };
    document.getElementById('reSensoryBtn').onclick = () => runSensoryProfile();
    document.getElementById('reOpenBtn').onclick = () => {
        const r = state.currentRecipe;
        if (r) window.open(buildRecipeUrl({ slug: state.slug, categoryDir: state.cat, category: r.category }), '_blank');
    };

    // Tab switching
    editorOverlay.querySelectorAll('.re-tab').forEach(tab => {
        tab.onclick = () => {
            editorOverlay.querySelectorAll('.re-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeTab = tab.dataset.tab;
            renderActiveTab();
        };
    });

    // Keyboard shortcuts (only when not typing in an input)
    editorOverlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeEditor(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); state.save(); return; }

        // Undo/Redo: only intercept when focused on the overlay itself, NOT on inputs
        const activeEl = document.activeElement;
        const isEditing = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');
        if (isEditing) return; // Let native undo handle it

        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); state.undo(); renderActiveTab(); return; }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); state.redo(); renderActiveTab(); return; }
    });

    // Close on overlay click
    editorOverlay.addEventListener('click', (e) => {
        if (e.target === editorOverlay) closeEditor();
    });

    // State listeners
    state.onChange((recipe, dirty) => {
        document.getElementById('reUndoBtn').disabled = !state.undoStack.length;
        document.getElementById('reRedoBtn').disabled = !state.redoStack.length;
        if (recipe) {
            document.getElementById('reTitle').textContent = recipe.title || '(senza titolo)';
            document.getElementById('reSubtitle').textContent = `${recipe.category || '?'} • ${recipe.hydration || 0}% idr.`;
            document.getElementById('reSlugDisplay').textContent = state.slug;
        }
    });

    state.onStatus((msg, type) => {
        const pill = document.getElementById('reStatusPill');
        pill.textContent = msg;
        pill.className = `re-status-pill visible ${type}`;
        if (type === 'saved') {
            setTimeout(() => pill.classList.remove('visible'), 2500);
        }
    });

    state.onValidation((result) => {
        if (!result) return;
        const badge = document.getElementById('reValidationBadge');
        const summary = document.getElementById('reValidationSummary');
        const cls = result.score >= 80 ? 'good' : result.score >= 40 ? 'warn' : 'bad';
        badge.className = `re-footer-score ${cls}`;
        badge.textContent = result.valid ? `✓ ${result.score}` : `✗ ${result.score}`;
        summary.textContent = result.errors.length ? `${result.errors.length} errori, ${result.warnings.length} warning` : result.warnings.length ? `${result.warnings.length} warning` : 'Schema valido';
    });
}

// ═══════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════

window.openRecipeEditor = async function (slug, cat) {
    createEditorDOM();
    activeTab = 'meta';
    editorOverlay.querySelectorAll('.re-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'meta'));
    editorOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Show loading
    document.getElementById('reContent').innerHTML = `
        <div class="re-loading">
            <div class="re-loading-spinner"></div>
            <div class="re-loading-text">Caricamento ricetta...</div>
        </div>
    `;

    try {
        await state.load(cat, slug);
        renderActiveTab();
    } catch (err) {
        document.getElementById('reContent').innerHTML = `<p style="color:#f87171;padding:40px;text-align:center">Errore: ${err.message}</p>`;
    }
};

async function closeEditor() {
    if (state.saveTimeout) clearTimeout(state.saveTimeout);
    
    // Auto-save flush on close
    if (state.isDirty) {
        // Mostra brevemente lo stato per gli split-second di attesa
        const pill = document.getElementById('reStatusPill');
        if (pill) {
            pill.textContent = 'Salvataggio...';
            pill.className = 're-status-pill visible saving';
        }
        await state.save();
    }

    editorOverlay?.classList.remove('active');
    document.body.style.overflow = '';
    
    // Refresh recipe list
    if (typeof loadRecipes === 'function') loadRecipes();
}

async function runSensoryProfile() {
    if (state.isDirty) {
        if (typeof showToast === 'function') showToast('Salva le modifiche prima di generare il profilo sensoriale.', 'warning');
        return;
    }
    const slug = state.slug;
    
    // Mostriamo il terminale per far vedere l'output
    if (typeof expandTerminal === 'function') expandTerminal();
    
    if (typeof showToast === 'function') showToast('Generazione profilo sensoriale in corso...', 'success');
    
    try {
        const resp = await fetch('/api/qualita/sensory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        
        const data = await resp.json();
        console.log("Sensory job started", data.jobId);
    } catch (err) {
        if (typeof showToast === 'function') showToast(`Errore: ${err.message}`, 'error');
    }
}

// ═══════════════════════════════════════════════════════
//  TAB RENDERERS
// ═══════════════════════════════════════════════════════

function renderActiveTab() {
    const content = document.getElementById('reContent');
    if (!state.currentRecipe) return;

    switch (activeTab) {
        case 'meta': renderMetaTab(content); break;
        case 'ingredients': renderIngredientsTab(content); break;
        case 'steps': renderStepsTab(content); break;
        case 'support': renderSupportTab(content); break;
    }
    lucide.createIcons({ nodes: [content] });
}

// ── TAB META ──
function renderMetaTab(container) {
    const r = state.currentRecipe;
    container.innerHTML = `
        <div class="re-field">
            <label class="re-label">Titolo</label>
            <input class="re-input" id="re-title-input" value="${esc(r.title)}" data-path="title">
        </div>
        <div class="re-field">
            <label class="re-label">Sottotitolo</label>
            <input class="re-input" id="re-subtitle-input" value="${esc(r.subtitle)}" data-path="subtitle">
        </div>
        <div class="re-field">
            <label class="re-label">Descrizione</label>
            <textarea class="re-textarea" data-path="description" rows="3">${esc(r.description)}</textarea>
        </div>
        <div class="re-row">
            <div class="re-field">
                <label class="re-label">Emoji</label>
                <input class="re-input re-input-sm" value="${esc(r.emoji)}" data-path="emoji" style="width:80px">
            </div>
            <div class="re-field">
                <label class="re-label">Categoria</label>
                <select class="re-select" data-path="category">
                    ${VALID_CATEGORIES.map(c => `<option value="${c}" ${c === r.category ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
            </div>
            <div class="re-field">
                <label class="re-label">Slug</label>
                <input class="re-input re-input-sm re-input-mono" value="${esc(r.slug)}" data-path="slug">
            </div>
        </div>
        <div class="re-row">
            <div class="re-field">
                <label class="re-label">Idratazione %</label>
                <input class="re-input re-input-sm" type="number" value="${r.hydration ?? ''}" data-path="hydration" data-type="number">
            </div>
            <div class="re-field">
                <label class="re-label">Temp. Target</label>
                <input class="re-input re-input-sm" value="${esc(r.targetTemp)}" data-path="targetTemp">
            </div>
            <div class="re-field">
                <label class="re-label">Lievitazione</label>
                <input class="re-input re-input-sm" value="${esc(r.fermentation)}" data-path="fermentation">
            </div>
            <div class="re-field">
                <label class="re-label">Farina Totale (g)</label>
                <input class="re-input re-input-sm" type="number" value="${r.totalFlour ?? ''}" data-path="totalFlour" data-type="number">
            </div>
        </div>
        <div class="re-field">
            <label class="re-label">Alert ⚠️</label>
            <textarea class="re-textarea" data-path="alert" rows="2">${esc(r.alert)}</textarea>
        </div>
        <div class="re-field">
            <label class="re-label">Tags</label>
            <div class="re-tags-wrap" id="reTagsWrap">
                ${(r.tags || []).map((t, i) => `<span class="re-tag">${esc(t)}<button class="re-tag-remove" data-tag-idx="${i}">×</button></span>`).join('')}
                <input class="re-tag-input" id="reTagInput" placeholder="Aggiungi tag...">
            </div>
        </div>
        <div class="re-field">
            <label class="re-label">Immagine</label>
            <input class="re-input re-input-sm re-input-mono" value="${esc(r.image)}" data-path="image" style="color:#64748b">
            ${r.image ? `<img class="re-image-preview" src="/${r.image}" alt="" onerror="this.style.display='none'">` : ''}
        </div>

        ${renderValidationPanel()}
    `;

    bindInputs(container);
    bindTags();
}

// ── TAB INGREDIENTI ──
function renderIngredientsTab(container) {
    const r = state.currentRecipe;
    const groups = r.ingredientGroups || [];

    let html = '';
    groups.forEach((g, gi) => {
        const totalGrams = (g.items || []).reduce((sum, it) => sum + (it.grams || 0), 0);
        html += `
            <div class="re-section" data-group-idx="${gi}">
                <div class="re-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                    <div class="re-section-title">
                        <span class="emoji">🧂</span>
                        <input class="re-input re-input-sm" value="${esc(g.group)}" 
                            data-path="ingredientGroups.${gi}.group" 
                            style="flex:1;max-width:300px;background:transparent;border:none;color:#e2e8f0;font-weight:600"
                            onclick="event.stopPropagation()">
                    </div>
                    <div style="display:flex;gap:8px;align-items:center">
                        <span style="font-size:11px;color:#818cf8;font-weight:600;font-feature-settings:'tnum'">${totalGrams}g</span>
                        <span style="font-size:11px;color:#475569">${(g.items || []).length} ing.</span>
                        <span class="re-section-chevron">▸</span>
                        <button class="re-row-delete" onclick="event.stopPropagation(); removeGroup(${gi})" title="Rimuovi gruppo"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
                <div class="re-section-body">
                    <div style="display:grid;grid-template-columns:1fr 80px 1fr 130px 40px 36px;gap:6px;padding:0 0 6px;font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:0.5px">
                        <span>Nome</span><span>Grammi</span><span>Note</span><span>Token ID</span><span>Exc.</span><span></span>
                    </div>
                    ${(g.items || []).map((item, ii) => `
                        <div class="re-ingredient-row">
                            <input class="re-input" value="${esc(item.name)}" data-path="ingredientGroups.${gi}.items.${ii}.name" placeholder="Nome">
                            <input class="re-input" type="number" value="${item.grams ?? ''}" data-path="ingredientGroups.${gi}.items.${ii}.grams" data-type="number" placeholder="g">
                            <input class="re-input" value="${esc(item.note)}" data-path="ingredientGroups.${gi}.items.${ii}.note" placeholder="Note">
                            <input class="re-input re-input-mono" value="${esc(item.tokenId)}" data-path="ingredientGroups.${gi}.items.${ii}.tokenId" placeholder="token_id">
                            <div class="re-checkbox-wrap"><input type="checkbox" class="re-checkbox" data-path="ingredientGroups.${gi}.items.${ii}.excludeFromTotal" ${item.excludeFromTotal ? 'checked' : ''}></div>
                            <button class="re-row-delete" onclick="removeIngredient(${gi},${ii})"><i data-lucide="x"></i></button>
                        </div>
                    `).join('')}
                    <div class="re-group-totals">
                        <span class="re-group-totals-label">Totale ${esc(g.group)}</span>
                        <span class="re-group-totals-value">${totalGrams} g</span>
                    </div>
                    <button class="re-add-btn" onclick="addIngredient(${gi})"><i data-lucide="plus"></i> Ingrediente</button>
                </div>
            </div>
        `;
    });

    // Sospensioni
    const susp = r.suspensions || [];
    html += `
        <div class="re-section${susp.length === 0 ? ' collapsed' : ''}">
            <div class="re-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="re-section-title"><span class="emoji">🥜</span> Sospensioni / Aggiunte <span style="color:#475569;font-weight:400">(${susp.length})</span></div>
                <span class="re-section-chevron">▸</span>
            </div>
                <div class="re-section-body">
                    ${susp.map((s, si) => `
                        <div class="re-ingredient-row" style="grid-template-columns:1fr 80px 1fr 36px">
                            <input class="re-input" value="${esc(s.name)}" data-path="suspensions.${si}.name">
                            <input class="re-input" type="number" value="${s.grams ?? ''}" data-path="suspensions.${si}.grams" data-type="number">
                            <input class="re-input" value="${esc(s.note)}" data-path="suspensions.${si}.note">
                            <button class="re-row-delete" onclick="removeSuspension(${si})"><i data-lucide="x"></i></button>
                        </div>
                    `).join('')}
                <button class="re-add-btn" onclick="addSuspension()"><i data-lucide="plus"></i> Sospensione</button>
            </div>
        </div>
    `;

    html += `<button class="re-add-btn" onclick="addGroup()" style="margin-top:4px"><i data-lucide="plus"></i> Nuovo Gruppo Ingredienti</button>`;
    html += renderValidationPanel();

    container.innerHTML = html;
    bindInputs(container);
}

// ── TAB PROCEDIMENTO ──
function renderStepsTab(container) {
    const r = state.currentRecipe;
    const sections = [
        { key: 'steps', label: '⚙️ Procedimento', icon: 'list-ordered' },
        { key: 'stepsCondiment', label: '🍅 Condimento', icon: 'salad' },
    ];

    // Token helper: collect all tokenIds
    const allTokens = [];
    for (const g of (r.ingredientGroups || [])) {
        for (const item of (g.items || [])) {
            if (item.tokenId) allTokens.push({ id: item.tokenId, grams: item.grams, name: item.name });
        }
    }

    let html = '';
    for (const sec of sections) {
        const steps = r[sec.key] || [];
        const isCollapsed = steps.length === 0;
        html += `
            <div class="re-section ${isCollapsed ? 'collapsed' : ''}">
                <div class="re-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                    <div class="re-section-title"><span class="emoji">${sec.label.split(' ')[0]}</span> ${sec.label.split(' ').slice(1).join(' ')} <span style="color:#475569;font-weight:400">(${steps.length})</span></div>
                    <span class="re-section-chevron">▸</span>
                </div>
                <div class="re-section-body">
                    ${steps.map((s, si) => `
                        <div class="re-step">
                            <div class="re-step-header">
                                <span class="re-step-num">${si + 1}</span>
                                <input class="re-input re-step-title-input" value="${esc(s.title)}" data-path="${sec.key}.${si}.title" placeholder="Titolo step">
                                <div class="re-step-actions">
                                    <button class="re-row-delete" onclick="moveStep('${sec.key}',${si},-1)" title="Sposta su"><i data-lucide="arrow-up"></i></button>
                                    <button class="re-row-delete" onclick="moveStep('${sec.key}',${si},1)" title="Sposta giù"><i data-lucide="arrow-down"></i></button>
                                    <button class="re-row-delete" onclick="removeStep('${sec.key}',${si})"><i data-lucide="x"></i></button>
                                </div>
                            </div>
                            <textarea class="re-textarea re-step-textarea" data-path="${sec.key}.${si}.text" rows="4" 
                                onfocus="activeTextarea=this">${esc(s.text)}</textarea>
                        </div>
                    `).join('')}
                    <button class="re-add-btn" onclick="addStep('${sec.key}')"><i data-lucide="plus"></i> Step</button>
                </div>
            </div>
        `;
    }

    // Token Helper
    if (allTokens.length) {
        html += `
            <div class="re-token-helper">
                <div class="re-token-helper-title">📎 Token Helper — clicca per inserire nel textarea attivo</div>
                ${allTokens.map(t => `<span class="re-token-chip" onclick="insertToken('${t.id}', ${t.grams})" title="${t.name}">{${t.id}:<span class="value">${t.grams}</span>}</span>`).join('')}
            </div>
        `;
    }

    html += renderValidationPanel();
    container.innerHTML = html;
    bindInputs(container);
}

// ── TAB SUPPORTO ──
function renderSupportTab(container) {
    const r = state.currentRecipe;
    let html = '';

    // Flour Table
    const fl = r.flourTable || [];
    html += `
        <div class="re-section">
            <div class="re-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="re-section-title"><span class="emoji">🌾</span> Tabella Farine</div>
                <span class="re-section-chevron">▸</span>
            </div>
            <div class="re-section-body">
                <div style="display:grid;grid-template-columns:1fr 100px 1fr 36px;gap:6px;padding:0 0 6px;font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:0.5px">
                    <span>Tipo</span><span>W</span><span>Marchi</span><span></span>
                </div>
                ${fl.map((f, fi) => `
                    <div class="re-flour-row">
                        <input class="re-input" value="${esc(f.type)}" data-path="flourTable.${fi}.type">
                        <input class="re-input" value="${esc(f.w)}" data-path="flourTable.${fi}.w">
                        <input class="re-input" value="${esc(f.brands)}" data-path="flourTable.${fi}.brands">
                        <button class="re-row-delete" onclick="removeFlour(${fi})"><i data-lucide="x"></i></button>
                    </div>
                `).join('')}
                <button class="re-add-btn" onclick="addFlour()"><i data-lucide="plus"></i> Farina</button>
            </div>
        </div>
    `;

    // Baking
    const b = r.baking || {};
    html += `
        <div class="re-section">
            <div class="re-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="re-section-title"><span class="emoji">🔥</span> Cottura</div>
                <span class="re-section-chevron">▸</span>
            </div>
            <div class="re-section-body">
                <div class="re-baking-grid">
                    <div class="re-field">
                        <label class="re-label">Temperatura</label>
                        <input class="re-input" value="${esc(b.temperature)}" data-path="baking.temperature">
                    </div>
                    <div class="re-field">
                        <label class="re-label">Tempo</label>
                        <input class="re-input" value="${esc(b.time)}" data-path="baking.time">
                    </div>
                </div>
                <label class="re-label">Tips Cottura</label>
                ${(b.tips || []).map((t, ti) => `
                    <div class="re-string-item">
                        <textarea class="re-textarea" data-path="baking.tips.${ti}" rows="2">${esc(t)}</textarea>
                        <button class="re-row-delete" onclick="removeBakingTip(${ti})"><i data-lucide="x"></i></button>
                    </div>
                `).join('')}
                <button class="re-add-btn" onclick="addBakingTip()"><i data-lucide="plus"></i> Tip Cottura</button>
            </div>
        </div>
    `;

    // Pro Tips
    html += `
        <div class="re-section">
            <div class="re-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="re-section-title"><span class="emoji">💡</span> Pro Tips</div>
                <span class="re-section-chevron">▸</span>
            </div>
            <div class="re-section-body">
                ${(r.proTips || []).map((t, ti) => `
                    <div class="re-string-item">
                        <textarea class="re-textarea" data-path="proTips.${ti}" rows="2">${esc(t)}</textarea>
                        <button class="re-row-delete" onclick="removeProTip(${ti})"><i data-lucide="x"></i></button>
                    </div>
                `).join('')}
                <button class="re-add-btn" onclick="addProTip()"><i data-lucide="plus"></i> Pro Tip</button>
            </div>
        </div>
    `;

    // Storage
    html += `
        <div class="re-section">
            <div class="re-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="re-section-title"><span class="emoji">📦</span> Conservazione</div>
                <span class="re-section-chevron">▸</span>
            </div>
            <div class="re-section-body">
                ${(r.storage || []).map((t, ti) => `
                    <div class="re-string-item">
                        <textarea class="re-textarea" data-path="storage.${ti}" rows="2">${esc(t)}</textarea>
                        <button class="re-row-delete" onclick="removeStorage(${ti})"><i data-lucide="x"></i></button>
                    </div>
                `).join('')}
                <button class="re-add-btn" onclick="addStorage()"><i data-lucide="plus"></i> Consigli Conservazione</button>
            </div>
        </div>
    `;

    // Glossary
    html += `
        <div class="re-section">
            <div class="re-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="re-section-title"><span class="emoji">📖</span> Glossario</div>
                <span class="re-section-chevron">▸</span>
            </div>
            <div class="re-section-body">
                ${(r.glossary || []).map((g, gi) => `
                    <div class="re-glossary-item">
                        <input class="re-input" value="${esc(g.term)}" data-path="glossary.${gi}.term" placeholder="Termine">
                        <input class="re-input" value="${esc(g.definition)}" data-path="glossary.${gi}.definition" placeholder="Definizione">
                        <button class="re-row-delete" onclick="removeGlossary(${gi})"><i data-lucide="x"></i></button>
                    </div>
                `).join('')}
                <button class="re-add-btn" onclick="addGlossary()"><i data-lucide="plus"></i> Voce Glossario</button>
            </div>
        </div>
    `;


    // Image keywords
    html += `
        <div class="re-token-helper">
            <div class="re-token-helper-title" style="color:#a5b4fc;">🖼️ Image Keywords</div>
            <div class="re-tags-wrap" id="reImgKwWrap" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);padding:6px;min-height:36px;margin-bottom:0;">
                ${(r.imageKeywords || []).map((t, i) => `<span class="re-tag" style="background:rgba(129,140,248,0.2)">${esc(t)}<button class="re-tag-remove" data-imgkw-idx="${i}">×</button></span>`).join('')}
                <input class="re-tag-input" id="reImgKwInput" placeholder="Aggiungi keyword...">
            </div>
        </div>
    `;

    html += renderValidationPanel();
    container.innerHTML = html;
    bindInputs(container);
    bindImageKeywords();
}

// ═══════════════════════════════════════════════════════
//  VALIDATION PANEL RENDERER
// ═══════════════════════════════════════════════════════

function renderValidationPanel() {
    const v = state.validationResult;
    if (!v) return '';
    if (v.valid && !v.warnings.length) return `<div class="re-validation"><div class="re-validation-title">✅ Schema Valido</div></div>`;

    return `
        <div class="re-validation">
            <div class="re-validation-title">${v.valid ? '⚠️' : '❌'} Validazione Schema</div>
            ${v.errors.map(e => `<div class="re-validation-item error">❌ ${esc(e)}</div>`).join('')}
            ${v.warnings.map(w => `<div class="re-validation-item warning">⚠️ ${esc(w)}</div>`).join('')}
        </div>
    `;
}

// ═══════════════════════════════════════════════════════
//  INPUT BINDINGS
// ═══════════════════════════════════════════════════════

function bindInputs(container) {
    container.querySelectorAll('[data-path]').forEach(el => {
        const path = el.dataset.path;
        const type = el.dataset.type;
        const event = el.tagName === 'SELECT' ? 'change' : 'input';

        el.addEventListener(event, () => {
            let val = el.type === 'checkbox' ? el.checked : el.value;
            if (type === 'number') val = val === '' ? null : parseFloat(val);
            state.update(path, val);
        });
    });
}

function bindTags() {
    const input = document.getElementById('reTagInput');
    if (!input) return;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
            e.preventDefault();
            const tags = [...(state.currentRecipe.tags || []), input.value.trim()];
            state.update('tags', tags);
            renderActiveTab();
        }
        // Backspace on empty input removes last tag
        if (e.key === 'Backspace' && !input.value) {
            const tags = [...(state.currentRecipe.tags || [])];
            if (tags.length) {
                tags.pop();
                state.update('tags', tags);
                renderActiveTab();
            }
        }
    });
    document.querySelectorAll('.re-tag-remove[data-tag-idx]').forEach(btn => {
        btn.onclick = () => {
            const idx = parseInt(btn.dataset.tagIdx);
            const tags = [...(state.currentRecipe.tags || [])];
            tags.splice(idx, 1);
            state.update('tags', tags);
            renderActiveTab();
        };
    });
}

function bindImageKeywords() {
    const input = document.getElementById('reImgKwInput');
    if (!input) return;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
            e.preventDefault();
            const kws = [...(state.currentRecipe.imageKeywords || []), input.value.trim()];
            state.update('imageKeywords', kws);
            renderActiveTab();
        }
    });
    document.querySelectorAll('.re-tag-remove[data-imgkw-idx]').forEach(btn => {
        btn.onclick = () => {
            const idx = parseInt(btn.dataset.imgkwIdx);
            const kws = [...(state.currentRecipe.imageKeywords || [])];
            kws.splice(idx, 1);
            state.update('imageKeywords', kws);
            renderActiveTab();
        };
    });
}

// ═══════════════════════════════════════════════════════
//  CRUD ACTIONS
// ═══════════════════════════════════════════════════════

window.addGroup = function () {
    const groups = [...(state.currentRecipe.ingredientGroups || []), { group: 'Nuovo Gruppo', items: [{ name: '', grams: 0, note: '', tokenId: '' }] }];
    state.update('ingredientGroups', groups);
    renderActiveTab();
};

window.removeGroup = function (gi) {
    if (!confirm('Rimuovere questo gruppo?')) return;
    const groups = [...(state.currentRecipe.ingredientGroups || [])];
    groups.splice(gi, 1);
    state.update('ingredientGroups', groups);
    renderActiveTab();
};

window.addIngredient = function (gi) {
    const groups = JSON.parse(JSON.stringify(state.currentRecipe.ingredientGroups || []));
    groups[gi].items.push({ name: '', grams: 0, note: '', tokenId: '' });
    state.update('ingredientGroups', groups);
    renderActiveTab();
};

window.removeIngredient = function (gi, ii) {
    const groups = JSON.parse(JSON.stringify(state.currentRecipe.ingredientGroups || []));
    groups[gi].items.splice(ii, 1);
    state.update('ingredientGroups', groups);
    renderActiveTab();
};

window.addSuspension = function () {
    const susp = [...(state.currentRecipe.suspensions || []), { name: '', grams: 0, note: '' }];
    state.update('suspensions', susp);
    renderActiveTab();
};

window.removeSuspension = function (si) {
    const susp = [...(state.currentRecipe.suspensions || [])];
    susp.splice(si, 1);
    state.update('suspensions', susp);
    renderActiveTab();
};

window.addStep = function (key) {
    const steps = [...(state.currentRecipe[key] || []), { title: '', text: '' }];
    state.update(key, steps);
    renderActiveTab();
};

window.removeStep = function (key, si) {
    const steps = [...(state.currentRecipe[key] || [])];
    steps.splice(si, 1);
    state.update(key, steps);
    renderActiveTab();
};

window.moveStep = function (key, si, dir) {
    const steps = JSON.parse(JSON.stringify(state.currentRecipe[key] || []));
    const newIdx = si + dir;
    if (newIdx < 0 || newIdx >= steps.length) return;
    [steps[si], steps[newIdx]] = [steps[newIdx], steps[si]];
    state.update(key, steps);
    renderActiveTab();
};

window.addFlour = function () {
    const fl = [...(state.currentRecipe.flourTable || []), { type: '', w: '', brands: '' }];
    state.update('flourTable', fl);
    renderActiveTab();
};

window.removeFlour = function (fi) {
    const fl = [...(state.currentRecipe.flourTable || [])];
    fl.splice(fi, 1);
    state.update('flourTable', fl);
    renderActiveTab();
};

window.addBakingTip = function () {
    const b = JSON.parse(JSON.stringify(state.currentRecipe.baking || { temperature: '', time: '', tips: [] }));
    if (!b.tips) b.tips = [];
    b.tips.push('');
    state.update('baking', b);
    renderActiveTab();
};

window.removeBakingTip = function (ti) {
    const b = JSON.parse(JSON.stringify(state.currentRecipe.baking || {}));
    b.tips.splice(ti, 1);
    state.update('baking', b);
    renderActiveTab();
};

window.addProTip = function () {
    const tips = [...(state.currentRecipe.proTips || []), ''];
    state.update('proTips', tips);
    renderActiveTab();
};

window.removeProTip = function (ti) {
    const tips = [...(state.currentRecipe.proTips || [])];
    tips.splice(ti, 1);
    state.update('proTips', tips);
    renderActiveTab();
};

window.addStorage = function () {
    const tips = [...(state.currentRecipe.storage || []), ''];
    state.update('storage', tips);
    renderActiveTab();
};

window.removeStorage = function (ti) {
    const tips = [...(state.currentRecipe.storage || [])];
    tips.splice(ti, 1);
    state.update('storage', tips);
    renderActiveTab();
};

window.addGlossary = function () {
    const gl = [...(state.currentRecipe.glossary || []), { term: '', definition: '' }];
    state.update('glossary', gl);
    renderActiveTab();
};

window.removeGlossary = function (gi) {
    const gl = [...(state.currentRecipe.glossary || [])];
    gl.splice(gi, 1);
    state.update('glossary', gl);
    renderActiveTab();
};



// ── Token Inserter ──
window.insertToken = function (tokenId, grams) {
    if (!activeTextarea) { showToast('Clicca prima su un textarea del procedimento', 'warning'); return; }
    const token = `{${tokenId}:${grams}}`;
    const start = activeTextarea.selectionStart;
    const end = activeTextarea.selectionEnd;
    const text = activeTextarea.value;
    activeTextarea.value = text.slice(0, start) + token + text.slice(end);
    activeTextarea.focus();
    activeTextarea.setSelectionRange(start + token.length, start + token.length);
    // Trigger input event
    activeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
};

// ── Utility ──
function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
