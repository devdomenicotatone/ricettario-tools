/**
 * RECIPE EDITOR — Ultra Pro Inline Editor (Orchestratore)
 * 
 * Ispirato al Template Studio di OmniWriter.
 * Modularizzato in:
 *   editor/editor-state.js      — State Manager (load, save, undo/redo)
 *   editor/editor-validation.js — Validazione schema ricetta
 *   editor/editor-tabs.js       — Tab renderers (Meta, Ingredienti, Procedimento, Supporto)
 *   editor/editor-actions.js    — CRUD globali (add/remove items)
 */

import { RecipeEditorState } from './editor/editor-state.js';
import { installValidation } from './editor/editor-validation.js';
import { renderActiveTab } from './editor/editor-tabs.js';
import { installCrudActions } from './editor/editor-actions.js';
import { showToast } from './modules/toast.js';
import { loadRecipes } from './modules/recipe-list.js';
import { expandTerminal } from './modules/terminal.js';

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════

const state = new RecipeEditorState();
installValidation(state);

let editorOverlay = null;
let activeTab = 'meta';

// Callback per ri-renderizzare il tab attivo
function rerender() {
    const content = document.getElementById('reContent');
    if (content) renderActiveTab(content, activeTab, state, null);
}

// Installa CRUD globali (window.addGroup, removeIngredient, etc.)
installCrudActions(state, rerender);

// ═══════════════════════════════════════════════════════
//  EDITOR DOM
// ═══════════════════════════════════════════════════════

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
                    <button class="re-action-btn" id="reSensoryBtn" title="Genera Dati Tecnici AI (Sensoriale + Nutrizionale)"><i data-lucide="sparkles"></i></button>
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

    // ── Bind header events ──
    document.getElementById('reCloseBtn').onclick = closeEditor;
    document.getElementById('reUndoBtn').onclick = () => { state.undo(); rerender(); };
    document.getElementById('reRedoBtn').onclick = () => { state.redo(); rerender(); };
    document.getElementById('reSensoryBtn').onclick = () => runSensoryProfile();
    document.getElementById('reOpenBtn').onclick = () => {
        const r = state.currentRecipe;
        if (r) window.open(buildRecipeUrl({ slug: state.slug, categoryDir: state.cat, category: r.category }), '_blank');
    };

    // ── Tab switching ──
    editorOverlay.querySelectorAll('.re-tab').forEach(tab => {
        tab.onclick = () => {
            editorOverlay.querySelectorAll('.re-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeTab = tab.dataset.tab;
            rerender();
        };
    });

    // ── Keyboard shortcuts ──
    editorOverlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeEditor(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); state.save(); return; }

        const activeEl = document.activeElement;
        const isEditing = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');
        if (isEditing) return;

        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); state.undo(); rerender(); return; }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); state.redo(); rerender(); return; }
    });

    // ── Close on overlay click ──
    editorOverlay.addEventListener('click', (e) => {
        if (e.target === editorOverlay) closeEditor();
    });

    // ── State listeners ──
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

    document.getElementById('reContent').innerHTML = `
        <div class="re-loading">
            <div class="re-loading-spinner"></div>
            <div class="re-loading-text">Caricamento ricetta...</div>
        </div>
    `;

    try {
        await state.load(cat, slug);
        rerender();
    } catch (err) {
        document.getElementById('reContent').innerHTML = `<p style="color:#f87171;padding:40px;text-align:center">Errore: ${err.message}</p>`;
    }
};

async function closeEditor() {
    if (state.saveTimeout) clearTimeout(state.saveTimeout);
    
    if (state.isDirty) {
        const pill = document.getElementById('reStatusPill');
        if (pill) {
            pill.textContent = 'Salvataggio...';
            pill.className = 're-status-pill visible saving';
        }
        await state.save();
    }

    editorOverlay?.classList.remove('active');
    document.body.style.overflow = '';
    
    loadRecipes();
}

async function runSensoryProfile() {
    if (state.isDirty) {
        showToast('Salva le modifiche prima di generare il profilo sensoriale.', 'warning');
        return;
    }
    const slug = state.slug;
    
    expandTerminal();
    showToast('Generazione profilo sensoriale in corso...', 'success');
    
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
        showToast(`Errore: ${err.message}`, 'error');
    }
}
