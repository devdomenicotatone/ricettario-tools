/**
 * DASHBOARD — QA Tools & Model Dropdowns
 * 
 * Gestione modelli AI, dropdown di selezione, analisi qualità e fix.
 */

import { showToast, showCustomConfirm } from './toast.js';
import { apiPost } from './navigation.js';

// ── Models Registry ──
export const GEMINI_MODELS = [
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', tag: 'smart' },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', tag: 'heavy' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tag: 'default' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tag: 'fast' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', tag: 'new' },
    { id: 'gemini-2-flash', label: 'Gemini 2 Flash', tag: 'economy' },
];

window.selectedGlobalModel = 'gemini-2.5-pro';

export function getSelectedGeminiModel() {
    const sel = document.getElementById('gemini-model-select');
    if (sel) return sel.value;
    return window.selectedGlobalModel || 'gemini-2.5-pro';
}

// ── Quality Index ──
export let qualityIndex = {};

export async function fetchQualityIndex() {
    try {
        const res = await fetch('/api/quality-index');
        qualityIndex = await res.json();
    } catch { qualityIndex = {}; }
}

export function getQualityBadge(slug) {
    const q = qualityIndex[slug];
    if (!q) return '';
    const cls = q.score >= 80 ? 'quality-good' : q.score >= 60 ? 'quality-warn' : 'quality-bad';
    const emoji = q.score >= 80 ? '🟢' : q.score >= 60 ? '🟡' : '🔴';
    return `<span class="quality-badge ${cls} clickable" 
        onclick="event.stopPropagation(); showQualityReport('${slug}')" 
        title="Qualità: ${q.score}/100 — ${q.issueCount} issue (${new Date(q.timestamp).toLocaleDateString()}) — Clicca per dettagli">${emoji} ${q.score}</span>`;
}

// ── Model Dropdown Factory ──
function createModelDropdown(anchorEl, title, models, onSelect) {
    document.querySelector('.model-dropdown')?.remove();

    const rect = anchorEl.getBoundingClientRect();
    const dd = document.createElement('div');
    dd.className = 'model-dropdown';
    
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 200) {
        dd.style.bottom = `${window.innerHeight - rect.top + 4}px`;
        dd.style.left = `${rect.left}px`;
    } else {
        dd.style.top = `${rect.bottom + 4}px`;
        dd.style.left = `${rect.left}px`;
    }

    dd.innerHTML = `
        <div class="model-dropdown-title">${title}</div>
        ${models.map(m => `
            <button class="model-dropdown-item" data-model="${m.id}">
                <i data-lucide="sparkles"></i>
                ${m.label}
                <span class="model-tag ${m.tag === 'default' ? 'tag-default' : ''}">${m.tag}</span>
            </button>
        `).join('')}
    `;

    document.body.appendChild(dd);
    if (window.lucide) lucide.createIcons();

    dd.addEventListener('click', (e) => {
        const btn = e.target.closest('.model-dropdown-item');
        if (!btn) return;
        dd.remove();
        onSelect(btn.dataset.model);
    });

    setTimeout(() => {
        document.addEventListener('click', function closeDD(e) {
            if (!dd.contains(e.target) && !anchorEl.contains(e.target)) {
                dd.remove();
                document.removeEventListener('click', closeDD);
            }
        });
    }, 10);
}

export function showQualitaModelDropdown(anchorEl, withGrounding = false) {
    createModelDropdown(anchorEl, 'Modello Analisi Qualità', GEMINI_MODELS, (model) => {
        window.selectedGlobalModel = model;
        runQualita(withGrounding, model);
    });
}

export function showModelDropdown(slug, anchorEl) {
    createModelDropdown(anchorEl, 'Modello Analisi Qualità', GEMINI_MODELS, (model) => {
        apiPost('qualita', { slugs: [slug], geminiModel: model });
    });
}

export function showFixModelDropdown(slug, anchorEl, isBatch = false) {
    createModelDropdown(anchorEl, 'Modello Ri-validazione', GEMINI_MODELS, (model) => {
        if (isBatch) {
            runFix(model);
        } else {
            runFixSingle(slug, model);
        }
    });
}

// ── QA Actions ──
/** @type {Set<string>} */
let _selectedSlugsRef = null;

export function setSelectedSlugsRef(ref) {
    _selectedSlugsRef = ref;
}

function getSelectedSlugs() {
    return _selectedSlugsRef || new Set();
}

export async function runQualita(withGrounding = false, geminiModel = null) {
    const selectedSlugs = getSelectedSlugs();
    if (selectedSlugs.size === 0) return showToast('Seleziona almeno una ricetta', 'warning');
    await apiPost('qualita', { slugs: [...selectedSlugs], grounding: withGrounding, geminiModel: geminiModel || getSelectedGeminiModel() });
}

export async function runSyncCards() {
    await apiPost('sync-cards', {});
}

export async function runFix(geminiModel) {
    const selectedSlugs = getSelectedSlugs();
    if (selectedSlugs.size === 0) return showToast('Seleziona almeno una ricetta', 'warning');
    const fixable = [...selectedSlugs].filter(s => qualityIndex[s]);
    if (fixable.length === 0) return showToast('Nessuna ricetta selezionata ha un report qualità. Esegui prima l\'analisi.', 'warning');
    
    showCustomConfirm(`Applicare fix AI a ${fixable.length} ricett${fixable.length === 1 ? 'a' : 'e'}?\n\nVerrà creato un backup .backup.json per ogni file.`, async () => {
        await apiPost('qualita/fix', { slugs: fixable, geminiModel: geminiModel || getSelectedGeminiModel() });
    });
}

export async function runFixSingle(slug, geminiModel) {
    const q = qualityIndex[slug];
    if (!q) return showToast('Esegui prima l\'analisi qualità su questa ricetta', 'warning');
    
    showCustomConfirm(`Applicare fix AI a questa ricetta? (score: ${q.score}/100)\n\nVerrà creato un backup .backup.json.`, async () => {
        await apiPost('qualita/fix', { slugs: [slug], force: true, geminiModel: geminiModel || getSelectedGeminiModel() });
    });
}

// Expose globally
window.getSelectedGeminiModel = getSelectedGeminiModel;
window.showQualitaModelDropdown = showQualitaModelDropdown;
window.showModelDropdown = showModelDropdown;
window.showFixModelDropdown = showFixModelDropdown;
window.runQualita = runQualita;
window.runSyncCards = runSyncCards;
window.runFix = runFix;
window.runFixSingle = runFixSingle;
