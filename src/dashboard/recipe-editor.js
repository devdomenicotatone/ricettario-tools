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

// ── Rete di sicurezza sulla chiusura della scheda ──
// L'auto-save parte 1,5 secondi dopo l'ultima modifica: chiudere la scheda (o
// ricaricare la pagina) subito dopo aver scritto faceva sparire quelle battute
// senza nemmeno un avviso. Il browser mostra il suo messaggio standard.
window.addEventListener('beforeunload', (e) => {
    if (!state.modificheNonSalvate()) return;
    e.preventDefault();
    e.returnValue = 'Ci sono modifiche alla ricetta non ancora salvate.';
    return e.returnValue;
});

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

    state.onConflict((info) => mostraPannelloConflitto(info));

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
    if (state.saveTimeout) { clearTimeout(state.saveTimeout); state.saveTimeout = null; }

    if (state.modificheNonSalvate()) {
        const pill = document.getElementById('reStatusPill');
        if (pill) {
            pill.textContent = 'Salvataggio...';
            pill.className = 're-status-pill visible saving';
        }
        // Se un PATCH era già in volo questa `await` aspetta QUELLO: `save()`
        // restituisce la promessa del salvataggio in corso invece di uscire
        // subito, altrimenti un salvataggio che stava riuscendo veniva
        // raccontato all'utente come fallito.
        await state.save();

        // Battute arrivate mentre il PATCH viaggiava: il primo giro è riuscito
        // ma non le conteneva. Un secondo giro le manda, invece di chiedere
        // all'utente se vuole buttarle.
        if (state.isDirty && !state.conflittoPendente && !state.ultimoErrore) {
            if (state.saveTimeout) { clearTimeout(state.saveTimeout); state.saveTimeout = null; }
            await state.save();
        }

        // Il salvataggio può non essere andato a buon fine (server giù, JSON
        // rifiutato) o essersi fermato su un conflitto: prima l'editor si
        // chiudeva lo stesso e le modifiche sparivano senza un avviso.
        if (state.modificheNonSalvate()) {
            const motivo = state.conflittoPendente
                ? 'La ricetta è stata modificata anche altrove, quindi il salvataggio si è fermato per non cancellare quelle modifiche.'
                : state.isSaving
                    ? 'Un salvataggio è ancora in corso.'
                    : state.ultimoErrore
                        ? `Il salvataggio non è riuscito (${state.ultimoErrore}): le modifiche sono ancora solo a schermo.`
                        : 'Alcune modifiche non sono ancora arrivate sul disco.';
            if (!confirm(`${motivo}\n\nChiudere comunque e perdere le tue modifiche?`)) return;
            state.scarta();
        }
    }

    chiudiPannelloConflitto();
    editorOverlay?.classList.remove('active');
    document.body.style.overflow = '';

    loadRecipes();
}

// ═══════════════════════════════════════════════════════
//  CONFLITTO — due schede sulla stessa ricetta
// ═══════════════════════════════════════════════════════

function chiudiPannelloConflitto() {
    document.getElementById('reConflictBackdrop')?.remove();
}

function bottoneConflitto(testo, stile) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = testo;
    b.style.cssText = `padding:9px 14px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid ${stile.bordo};background:${stile.sfondo};color:${stile.testo}`;
    return b;
}

function mostraPannelloConflitto(info) {
    chiudiPannelloConflitto();

    const backdrop = document.createElement('div');
    backdrop.id = 'reConflictBackdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(2,6,23,.72);display:flex;align-items:center;justify-content:center;padding:24px';

    const box = document.createElement('div');
    box.style.cssText = 'max-width:540px;width:100%;background:#0f172a;border:1px solid rgba(248,113,113,.35);border-radius:14px;padding:22px 24px;color:#e2e8f0;font-size:14px;line-height:1.55;box-shadow:0 24px 60px rgba(0,0,0,.55)';

    const titolo = document.createElement('div');
    titolo.style.cssText = 'font-size:16px;font-weight:700;color:#f87171;margin-bottom:10px';
    titolo.textContent = 'La ricetta è cambiata sul disco';
    box.appendChild(titolo);

    const spiegazione = document.createElement('p');
    spiegazione.style.cssText = 'margin:0 0 10px';
    spiegazione.textContent = 'Il file è stato riscritto da qualcun altro mentre lo stavi modificando: un\'altra scheda dell\'editor, oppure un Fix AI lanciato dal pannello qualità. Salvare adesso cancellerebbe quelle modifiche senza lasciarne traccia.';
    box.appendChild(spiegazione);

    // textContent, non innerHTML: il titolo arriva dal JSON della ricetta.
    const dettaglio = document.createElement('p');
    dettaglio.style.cssText = 'margin:0 0 18px;font-size:12.5px;color:#94a3b8';
    dettaglio.textContent = `Versione sul disco: "${info?.recipeDisco?.title || '(senza titolo)'}".`;
    box.appendChild(dettaglio);

    const azioni = document.createElement('div');
    azioni.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end';

    const btnMie = bottoneConflitto('Tieni le mie modifiche', { bordo: 'rgba(248,113,113,.45)', sfondo: 'rgba(248,113,113,.15)', testo: '#fca5a5' });
    const btnDisco = bottoneConflitto('Scarta le mie e ricarica', { bordo: 'rgba(148,163,184,.35)', sfondo: 'rgba(148,163,184,.12)', testo: '#cbd5e1' });
    const btnDopo = bottoneConflitto('Decido dopo', { bordo: 'transparent', sfondo: 'transparent', testo: '#94a3b8' });

    btnMie.onclick = async () => {
        chiudiPannelloConflitto();
        await state.risolviTenendoLeMie();
        rerender();
    };

    btnDisco.onclick = async () => {
        if (!confirm('Le modifiche che hai fatto e non salvato andranno perse. Continuare?')) return;
        chiudiPannelloConflitto();
        try {
            await state.risolviRicaricando();
            rerender();
        } catch (err) {
            showToast(`Ricarica fallita: ${err.message}`, 'error');
        }
    };

    btnDopo.onclick = () => {
        chiudiPannelloConflitto();
        state.rinviaConflitto();
        showToast('Conflitto rinviato: la ricetta non è stata salvata.', 'warning');
    };

    azioni.append(btnDisco, btnDopo, btnMie);
    box.appendChild(azioni);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    btnMie.focus();
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
