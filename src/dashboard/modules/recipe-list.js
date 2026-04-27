/**
 * DASHBOARD — Recipe List & Rendering
 * 
 * Gestione stato ricette, filtraggio, ordinamento, selezione e rendering cards/rows.
 */

import { showToast, showCustomConfirm } from './toast.js';
import { apiPost, setRunning } from './navigation.js';
import { appendTerminal } from './terminal.js';
import { qualityIndex, getQualityBadge, getSelectedGeminiModel, showQualitaModelDropdown, showModelDropdown, showFixModelDropdown, runQualita, runFix, runFixSingle, fetchQualityIndex, setSelectedSlugsRef } from './qa-tools.js';

// Global state
export let allRecipes = [];
export let siteBaseUrl = 'http://localhost:5173/Ricettario/';
export let selectedSlugs = new Set();
export let recipeFilter = { category: 'all', search: '', sort: 'name-asc', view: 'grid', status: 'all' };

// Condividiamo la reference di selectedSlugs con qa-tools
setSelectedSlugsRef(selectedSlugs);

export const CATEGORY_COLORS = {
    'Pane':      '#d4a574',
    'Pizza':     '#e74c3c',
    'Focaccia':  '#27ae60',
    'Lievitati': '#f39c12',
    'Pasta':     '#3498db',
    'Dolci':     '#e91e63',
    'Condimenti':'#2ecc71',
    'Conserve':  '#9b59b6',
};

export const CATEGORY_ICONS = {
    'Pane': 'wheat', 'Pizza': 'pizza', 'Focaccia': 'sandwich',
    'Lievitati': 'croissant', 'Pasta': 'utensils', 'Dolci': 'cake-slice',
    'Condimenti': 'leaf', 'Conserve': 'archive',
};

export const CATEGORY_DIR_MAP = {
    'Pane': 'pane', 'Pizza': 'pizza', 'Focaccia': 'focaccia',
    'Lievitati': 'lievitati', 'Pasta': 'pasta', 'Dolci': 'dolci',
    'Condimenti': 'condimenti', 'Conserve': 'conserve',
};

export const ALL_CATEGORIES = ['Pane', 'Pizza', 'Focaccia', 'Lievitati', 'Pasta', 'Dolci', 'Condimenti', 'Conserve'];

window.imageCacheBuster = window.imageCacheBuster || Date.now();

export function setSiteBaseUrl(url) {
    if (url) siteBaseUrl = url;
}

export async function loadRecipes() {
    const grid = document.getElementById('recipesGrid');
    grid.innerHTML = '<p class="empty-state">Caricamento...</p>';
    try {
        const [resp] = await Promise.all([
            fetch('/api/ricette'),
            fetchQualityIndex(),
        ]);
        allRecipes = await resp.json();
        ensureDynamicCategories();
        updateCategoryTabs();
        renderRecipes();
        updateActionBar();
    } catch (err) {
        grid.innerHTML = `<p class="empty-state">❌ Errore caricamento: ${err.message}</p>`;
    }
}

function ensureDynamicCategories() {
    const uniqueCats = [...new Set(allRecipes.map(r => r.category).filter(Boolean))];
    const selects = ['gen-tipo', 'url-tipo', 'testo-tipo'].map(id => document.getElementById(id)).filter(Boolean);
    const seoTabsEl = document.getElementById('seoTabs');

    uniqueCats.forEach(cat => {
        if (!ALL_CATEGORIES.includes(cat)) {
            ALL_CATEGORIES.push(cat);
        }
        
        selects.forEach(sel => {
            const exists = Array.from(sel.options).some(opt => opt.value === cat);
            if (!exists) {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = `📁 ${cat}`;
                sel.appendChild(opt);
            }
        });

        if (seoTabsEl) {
            const exists = Array.from(seoTabsEl.querySelectorAll('.seo-tab')).some(btn => btn.dataset.category === cat);
            if (!exists) {
                const btn = document.createElement('button');
                btn.className = 'seo-tab';
                btn.dataset.category = cat;
                btn.textContent = `📁 ${cat}`;
                btn.onclick = () => {
                    document.querySelectorAll('.seo-tab').forEach(t => t.classList.remove('active'));
                    btn.classList.add('active');
                    // currentSeoCategory logic will be in seo.js
                    if (window.loadSeoSuggestions) window.loadSeoSuggestions(cat);
                };
                seoTabsEl.appendChild(btn);
            }
        }
    });
}

function updateCategoryTabs() {
    const tabsEl = document.getElementById('recipeCategoryTabs');
    const counts = {};
    allRecipes.forEach(r => {
        const cat = r.category || 'Altro';
        counts[cat] = (counts[cat] || 0) + 1;
    });

    let html = `<button class="recipe-cat-tab ${recipeFilter.category === 'all' ? 'active' : ''}" data-category="all">
        Tutte <span class="cat-count">${allRecipes.length}</span>
    </button>`;

    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
        const icon = CATEGORY_ICONS[cat] || 'folder';
        const isActive = recipeFilter.category === cat ? 'active' : '';
        const color = CATEGORY_COLORS[cat] || '#888';
        html += `<button class="recipe-cat-tab ${isActive}" data-category="${cat}" style="--cat-color:${color}">
            <i data-lucide="${icon}"></i> ${cat} <span class="cat-count">${count}</span>
        </button>`;
    });

    tabsEl.innerHTML = html;
    if (window.lucide) lucide.createIcons();

    tabsEl.querySelectorAll('.recipe-cat-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            recipeFilter.category = tab.dataset.category;
            tabsEl.querySelectorAll('.recipe-cat-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderRecipes();
        });
    });
}

export function renderRecipes() {
    const grid = document.getElementById('recipesGrid');
    const counterEl = document.getElementById('recipesCounter');
    const filtered = getFilteredRecipes();

    if (filtered.length === allRecipes.length) {
        counterEl.textContent = `${allRecipes.length} ricette`;
    } else {
        counterEl.textContent = `${filtered.length} di ${allRecipes.length} ricette`;
    }

    if (!filtered.length) {
        const catName = recipeFilter.category !== 'all' ? recipeFilter.category : '';
        grid.innerHTML = `<div class="empty-state-pro">
            <div class="empty-state-icon">📭</div>
            <p>Nessuna ricetta${catName ? ` in "${catName}"` : ''}</p>
            <button class="btn btn-primary" onclick="document.querySelector('[data-panel=genera]').click()">
                🔥 Crea la prima!
            </button>
        </div>`;
        return;
    }

    grid.className = recipeFilter.view === 'list' ? 'recipes-list' : 'recipes-grid';

    if (recipeFilter.view === 'list') {
        const allChecked = filtered.length > 0 && filtered.every(r => selectedSlugs.has(r.slug));
        grid.innerHTML = `<div class="recipe-list-header">
            <span><input type="checkbox" class="recipe-checkbox-all" ${allChecked ? 'checked' : ''} 
                onchange="toggleSelectAll(this.checked)"> Ricetta</span>
            <span>Categoria</span><span>Qualità</span><span>Idratazione</span><span>Tempo</span><span>Data</span><span>Azioni</span>
        </div>` + filtered.map(r => renderRecipeRow(r)).join('');
    } else {
        grid.innerHTML = filtered.map(r => renderRecipeCard(r)).join('');
    }
    if (window.lucide) lucide.createIcons();
}

function getFilteredRecipes() {
    let filtered = [...allRecipes];
    if (recipeFilter.category !== 'all') {
        filtered = filtered.filter(r => (r.category || '') === recipeFilter.category);
    }
    if (recipeFilter.search) {
        const s = recipeFilter.search.toLowerCase();
        filtered = filtered.filter(r =>
            (r.title || r.name || '').toLowerCase().includes(s) ||
            (r.description || '').toLowerCase().includes(s)
        );
    }
    
    if (recipeFilter.status !== 'all') {
        filtered = filtered.filter(r => {
            if (recipeFilter.status === 'no-qa') return !qualityIndex[r.slug];
            if (recipeFilter.status === 'no-fix') return qualityIndex[r.slug]?.fixed !== true;
            if (recipeFilter.status === 'no-tech') return !r.hydration && !r.time && !r.temp && !r.hasSensory;
            return true;
        });
    }
    
    const sortKey = recipeFilter.sort;
    filtered.sort((a, b) => {
        switch (sortKey) {
            case 'name-asc': return (a.title || '').localeCompare(b.title || '', 'it');
            case 'name-desc': return (b.title || '').localeCompare(a.title || '', 'it');
            case 'hydration-asc': return getHydrationNum(a.hydration) - getHydrationNum(b.hydration);
            case 'hydration-desc': return getHydrationNum(b.hydration) - getHydrationNum(a.hydration);
            case 'category': return (a.category || '').localeCompare(b.category || '', 'it') || (a.title || '').localeCompare(b.title || '', 'it');
            case 'quality-desc': return (qualityIndex[b.slug]?.score ?? -1) - (qualityIndex[a.slug]?.score ?? -1);
            case 'quality-asc': return (qualityIndex[a.slug]?.score ?? 999) - (qualityIndex[b.slug]?.score ?? 999);
            case 'date-desc': return (b._createdAt ? new Date(b._createdAt).getTime() : 0) - (a._createdAt ? new Date(a._createdAt).getTime() : 0);
            case 'date-asc': return (a._createdAt ? new Date(a._createdAt).getTime() : 0) - (b._createdAt ? new Date(b._createdAt).getTime() : 0);
            default: return 0;
        }
    });
    
    return filtered;
}

// Rendering helpers
function getAiBadge(generatedBy) {
    if (!generatedBy) return '';
    const models = {
        'claude': { label: 'Sonnet', icon: 'sparkles', color: '#a855f7' },
        'claude-opus': { label: 'Opus', icon: 'sparkles', color: '#7c3aed' },
        'gemini': { label: 'Gemini', icon: 'sparkles', color: '#4285f4' },
        'gemini-3.1': { label: 'Gemini 3.1', icon: 'sparkles', color: '#34a853' },
    };
    const m = models[generatedBy] || { label: generatedBy, icon: 'cpu', color: '#888' };
    return `<span class="recipe-badge ai-badge" style="color:${m.color};border-color:${m.color}40;background:${m.color}15" title="Generata con ${m.label}"><i data-lucide="${m.icon}"></i> ${m.label}</span>`;
}

function buildRecipeUrl(r) {
    if (r.href) {
        return `${siteBaseUrl}${r.href.replace(/\.html$/, '')}`;
    }
    const dir = r.categoryDir || CATEGORY_DIR_MAP[r.category] || (r.category || '').toLowerCase();
    if (dir && r.slug) {
        return `${siteBaseUrl}ricette/${dir}/${r.slug}`;
    }
    return '#';
}

function getHydrationNum(h) {
    if (!h) return 0;
    return parseFloat(String(h).replace('%', '')) || 0;
}

function getHydrationClass(val) {
    if (val >= 75) return 'hydration-high';
    if (val >= 60) return 'hydration-mid';
    return 'hydration-low';
}

function formatCreatedAt(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const mesi = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
        return `${d.getDate()} ${mesi[d.getMonth()]} ${d.getFullYear()}`;
    } catch { return ''; }
}

function renderRecipeCard(r) {
    const title = r.title || r.name || r.slug;
    const img = r.image ? `/${r.image}?t=${window.imageCacheBuster}` : '';
    const cat = r.category || '';
    const catColor = CATEGORY_COLORS[cat] || '#888';
    const catIcon = CATEGORY_ICONS[cat] || 'folder';
    const hydNum = getHydrationNum(r.hydration);
    const hydClass = getHydrationClass(hydNum);
    const recipeUrl = buildRecipeUrl(r);
    const isSelected = selectedSlugs.has(r.slug);
    const qEntry = qualityIndex[r.slug];
    const hasReport = !!qEntry;
    const isFixed = qEntry?.fixed === true;
    const fixDisabled = !hasReport || isFixed;
    const fixTitle = !hasReport ? 'Esegui prima l\'analisi qualità' : isFixed ? 'Già fixata' : 'Fix AI';

    return `
        <div class="recipe-card${isSelected ? ' selected' : ''}" data-slug="${r.slug}" data-category="${cat}" onclick="toggleSelect('${r.slug}', event)">
            <button class="recipe-delete-btn" onclick="event.stopPropagation(); eliminaSingola('${r.slug}')" title="Elimina ricetta"><i data-lucide="trash-2"></i></button>
            ${img ? `<div class="recipe-card-img-wrap">
                <img class="recipe-card-img" src="${img}" alt="${title}" loading="lazy" onerror="this.parentElement.style.display='none'">
                <span class="recipe-card-cat-badge clickable" style="--cat-color:${catColor}" 
                    onclick="event.stopPropagation(); showCategoryDropdown('${r.slug}', '${cat}', this)"><i data-lucide="${catIcon}"></i> ${cat}</span>
                ${r._createdAt ? `<span class="recipe-card-date-badge"><i data-lucide="calendar"></i> ${formatCreatedAt(r._createdAt)}</span>` : ''}
                <a class="recipe-card-open-btn" href="${recipeUrl}" target="_blank" title="Apri nel sito" onclick="event.stopPropagation()"><i data-lucide="external-link"></i></a>
            </div>` : `<div class="recipe-card-no-img">
                <span class="recipe-card-cat-badge clickable" style="--cat-color:${catColor}" onclick="event.stopPropagation(); showCategoryDropdown('${r.slug}', '${cat}', this)"><i data-lucide="${catIcon}"></i> ${cat}</span>
                <a class="recipe-card-open-btn" href="${recipeUrl}" target="_blank" title="Apri nel sito" onclick="event.stopPropagation()"><i data-lucide="external-link"></i></a>
            </div>`}
            <div class="recipe-card-body">
                <div class="recipe-card-title">${title}</div>
                <div class="recipe-card-badges">
                    ${getAiBadge(r._generatedBy)}
                    ${getQualityBadge(r.slug)}
                    ${r.hydration ? `<span class="recipe-badge ${hydClass}"><i data-lucide="droplets"></i> ${r.hydration}</span>` : ''}
                    ${r.time ? `<span class="recipe-badge recipe-badge-time"><i data-lucide="clock"></i> ${r.time}</span>` : ''}
                </div>
                ${r.description ? `<div class="recipe-card-desc">${r.description.substring(0, 90)}…</div>` : ''}
                <div class="recipe-card-actions" onclick="event.stopPropagation()">
                    <div class="btn-split" title="Cambia immagine">
                        <button class="btn-split-main" onclick="runRefreshImageForSlug('${r.slug}')"><i data-lucide="image"></i></button>
                        <button class="btn-split-chevron" onclick="showImageGenerateDropdown('${r.slug}', '${cat}', this.parentElement)">▾</button>
                    </div>
                    <div class="btn-split" title="Analisi Qualità">
                        <button class="btn-split-main" onclick="apiPost('qualita', {slugs:['${r.slug}'], geminiModel: getSelectedGeminiModel()})" title="Analisi Qualità (${getSelectedGeminiModel()})"><i data-lucide="shield-check"></i></button>
                        <button class="btn-split-chevron" onclick="showModelDropdown('${r.slug}', this.parentElement)" title="Scegli modello">▾</button>
                    </div>
                    <div class="btn-split btn-split-fix${fixDisabled ? ' disabled' : ''}" title="${fixTitle}">
                        <button class="btn-split-main btn-fix-card" onclick="runFixSingle('${r.slug}')" title="Fix AI (${getSelectedGeminiModel()})" ${fixDisabled ? 'disabled' : ''}><i data-lucide="wrench"></i></button>
                        <button class="btn-split-chevron btn-fix-chevron" onclick="showFixModelDropdown('${r.slug}', this.parentElement)" title="Scegli modello ri-validazione" ${fixDisabled ? 'disabled' : ''}>▾</button>
                    </div>
                    <button class="btn btn-secondary btn-sm btn-edit-recipe" onclick="openRecipeEditor('${r.slug}', '${r.categoryDir || CATEGORY_DIR_MAP[r.category] || (r.category||'').toLowerCase()}')" title="Modifica ricetta"><i data-lucide="pencil"></i></button>
                </div>
            </div>
        </div>`;
}

function renderRecipeRow(r) {
    const title = r.title || r.name || r.slug;
    const img = r.image ? `/${r.image}?t=${window.imageCacheBuster}` : '';
    const cat = r.category || '';
    const catColor = CATEGORY_COLORS[cat] || '#888';
    const catIcon = CATEGORY_ICONS[cat] || 'folder';
    const recipeUrl = buildRecipeUrl(r);
    const isSelected = selectedSlugs.has(r.slug);
    const qEntry = qualityIndex && qualityIndex[r.slug];
    const hasReport = !!qEntry;
    const isFixed = qEntry && qEntry.fixed === true;
    const fixDisabled = !hasReport || isFixed;
    const fixTitle = !hasReport ? 'Esegui prima l\'analisi qualità' : isFixed ? 'Già fixata' : 'Fix AI';

    return `
        <div class="recipe-row${isSelected ? ' selected' : ''}" data-slug="${r.slug}" data-category="${cat}" onclick="toggleSelect('${r.slug}', event)">
            <div class="recipe-row-info">
                <input type="checkbox" class="recipe-checkbox" ${isSelected ? 'checked' : ''}
                    onchange="toggleSelect('${r.slug}', event)" onclick="event.stopPropagation()">
                ${img ? `<img class="recipe-row-thumb" src="${img}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<div class="recipe-row-thumb-empty"></div>'}
                <span class="recipe-row-title">${title}</span>
            </div>
            <span class="recipe-row-cat clickable" style="--cat-color:${catColor}" 
                onclick="event.stopPropagation(); showCategoryDropdown('${r.slug}', '${cat}', this)"><i data-lucide="${catIcon}"></i> ${cat}</span>
            <div class="recipe-row-badges">
                ${getAiBadge(r._generatedBy)}
                ${getQualityBadge(r.slug) ? `<span class="recipe-row-quality">${getQualityBadge(r.slug)}</span>` : ''}
            </div>
            <span class="recipe-row-hydration">${r.hydration || '—'}</span>
            <span class="recipe-row-time">${r.time || '—'}</span>
            <span class="recipe-row-date">${r._createdAt ? formatCreatedAt(r._createdAt) : '—'}</span>
            <div class="recipe-row-actions" onclick="event.stopPropagation()">
                <div class="btn-split" title="Cambia immagine">
                    <button class="btn-split-main" onclick="runRefreshImageForSlug('${r.slug}')"><i data-lucide="image"></i></button>
                    <button class="btn-split-chevron" onclick="showImageGenerateDropdown('${r.slug}', '${cat}', this.parentElement)">▾</button>
                </div>
                <div class="btn-split" title="Analisi Qualità">
                    <button class="btn-split-main" onclick="apiPost('qualita', {slugs:['${r.slug}'], geminiModel: getSelectedGeminiModel()})" title="Analisi Qualità (${getSelectedGeminiModel()})"><i data-lucide="shield-check"></i></button>
                    <button class="btn-split-chevron" onclick="showModelDropdown('${r.slug}', this.parentElement)" title="Scegli modello">▾</button>
                </div>
                <div class="btn-split btn-split-fix${fixDisabled ? ' disabled' : ''}" title="${fixTitle}">
                    <button class="btn-split-main btn-fix-card" onclick="runFixSingle('${r.slug}')" title="Fix AI (${getSelectedGeminiModel()})" ${fixDisabled ? 'disabled' : ''}><i data-lucide="wrench"></i></button>
                    <button class="btn-split-chevron btn-fix-chevron" onclick="showFixModelDropdown('${r.slug}', this.parentElement)" title="Scegli modello ri-validazione" ${fixDisabled ? 'disabled' : ''}>▾</button>
                </div>
                <button class="btn btn-secondary btn-sm btn-edit-recipe" onclick="openRecipeEditor('${r.slug}', '${r.categoryDir || CATEGORY_DIR_MAP[r.category] || (r.category||'').toLowerCase()}')" title="Modifica ricetta"><i data-lucide="pencil"></i></button>
                <a class="btn btn-secondary btn-sm" href="${recipeUrl}" target="_blank" title="Apri nel sito"><i data-lucide="external-link"></i></a>
                <button class="btn btn-secondary btn-sm btn-danger-subtle recipe-row-delete" onclick="eliminaSingola('${r.slug}')" title="Elimina ricetta"><i data-lucide="trash-2"></i></button>
            </div>
        </div>`;
}

// ── Selection System ──
let lastClickedSlug = null;

export function toggleSelect(slug, event) {
    const filtered = getFilteredRecipes();
    if (event && event.shiftKey && lastClickedSlug) {
        const slugs = filtered.map(r => r.slug);
        const fromIdx = slugs.indexOf(lastClickedSlug);
        const toIdx = slugs.indexOf(slug);
        if (fromIdx !== -1 && toIdx !== -1) {
            const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
            for (let i = start; i <= end; i++) {
                selectedSlugs.add(slugs[i]);
            }
            renderRecipes();
            updateActionBar();
            return;
        }
    }
    if (selectedSlugs.has(slug)) selectedSlugs.delete(slug);
    else selectedSlugs.add(slug);

    lastClickedSlug = slug;
    renderRecipes();
    updateActionBar();
}

export function toggleSelectAll(checked) {
    const filtered = getFilteredRecipes();
    if (checked) {
        filtered.forEach(r => selectedSlugs.add(r.slug));
    } else {
        filtered.forEach(r => selectedSlugs.delete(r.slug));
    }
    lastClickedSlug = null;
    renderRecipes();
    updateActionBar();
}

export function clearSelection() {
    selectedSlugs.clear();
    lastClickedSlug = null;
    renderRecipes();
    updateActionBar();
}

// Keyboard shortcuts for selection
document.addEventListener('keydown', (e) => {
    const isInInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    const ricettePanel = document.getElementById('panel-ricette');
    if (!ricettePanel?.classList.contains('active')) return;

    if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !isInInput) {
        e.preventDefault();
        toggleSelectAll(true);
    }
    if (e.key === 'Escape' && selectedSlugs.size > 0) {
        e.preventDefault();
        clearSelection();
    }
});

function updateActionBar() {
    let bar = document.getElementById('selectionActionBar');
    if (selectedSlugs.size === 0) {
        if (bar) bar.remove();
        return;
    }

    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'selectionActionBar';
        bar.className = 'selection-action-bar';
        document.body.appendChild(bar);
    }

    bar.innerHTML = `
        <div class="action-bar-info">
            <span class="action-bar-count"><i data-lucide="check-square" style="width:16px;height:16px;vertical-align:-3px;margin-right:4px"></i>${selectedSlugs.size} selezionat${selectedSlugs.size === 1 ? 'a' : 'e'}</span>
        </div>
        <div class="action-bar-actions">
            <div class="btn-split" style="display:inline-flex">
                <button class="action-bar-btn" onclick="runQualita()" title="Analisi qualità (Schema + Gemini)">
                    <i data-lucide="shield-check"></i> Qualità
                </button>
                <button class="action-bar-btn btn-split-chevron" onclick="showQualitaModelDropdown(this, false)" title="Scegli modello" style="padding:0 6px;border-left:1px solid rgba(255,255,255,0.2)">▾</button>
            </div>
            <div class="btn-split" style="display:inline-flex">
                <button class="action-bar-btn action-bar-ai" onclick="runQualita(true)" title="Qualità + fonti web (SerpAPI grounding)">
                    <i data-lucide="globe"></i> + Web
                </button>
                <button class="action-bar-btn action-bar-ai btn-split-chevron" onclick="showQualitaModelDropdown(this, true)" title="Scegli modello" style="padding:0 6px;border-left:1px solid rgba(255,255,255,0.2)">▾</button>
            </div>
            <div class="btn-split" style="display:inline-flex">
                <button class="action-bar-btn action-bar-fix" onclick="runFix()" title="Applica fix AI alle ricette problematiche (< 85)">
                    <i data-lucide="wrench"></i> Fix AI
                </button>
                <button class="action-bar-btn action-bar-fix btn-split-chevron" onclick="showFixModelDropdown(null, this.parentElement, true)" title="Scegli modello ri-validazione" style="padding:0 6px;border-left:1px solid rgba(255,255,255,0.2)">▾</button>
            </div>
            <div class="btn-split" style="display:inline-flex">
                <button class="action-bar-btn" onclick="showToast('Usa la freccetta laterale per generare in blocco con AI!', 'info')" title="Gestione Immagini">
                    <i data-lucide="image"></i> Immagini
                </button>
                <button class="action-bar-btn btn-split-chevron" onclick="if(window.showImageGenerateDropdownBatch) window.showImageGenerateDropdownBatch(this.parentElement)" title="Opzioni Generazione Immagini" style="padding:0 6px;border-left:1px solid rgba(255,255,255,0.2)">▾</button>
            </div>
            <button class="action-bar-btn" onclick="runSensoryBatch()" title="Genera Dati Tecnici AI (Sensoriale + Nutrizionale)" style="color: #fbbf24;">
                <i data-lucide="sparkles"></i> Dati Tecnici
            </button>
            <button class="action-bar-btn action-bar-danger" onclick="batchElimina()" title="Elimina selezionate">
                <i data-lucide="trash-2"></i> Elimina
            </button>
            <button class="action-bar-btn action-bar-close" onclick="clearSelection()" title="Deseleziona">
                <i data-lucide="x"></i>
            </button>
        </div>
    `;
    if (window.lucide) lucide.createIcons({ attrs: { 'width': 16, 'height': 16 } });
}

export async function runSensoryBatch() {
    if (selectedSlugs.size === 0) return showToast('Seleziona almeno una ricetta', 'warning');
    const slugs = [...selectedSlugs];
    showCustomConfirm(`Generare Analisi Avanzata per ${slugs.length} ricett${slugs.length === 1 ? 'a' : 'e'}?`, async () => {
        if (window.expandTerminal) window.expandTerminal();
        showToast('Batch job Sensoriale avviato...', 'success');
        try {
            await apiPost('qualita/sensory', { slugs });
            clearSelection();
        } catch (e) {
            showToast('Errore: ' + e.message, 'error');
        }
    });
}

export async function batchElimina() {
    const slugs = [...selectedSlugs];
    showCustomConfirm(`⚠️ Eliminare ${slugs.length} ricett${slugs.length === 1 ? 'a' : 'e'}?\n\nQuesta azione è irreversibile!\n\n${slugs.slice(0, 5).join('\n')}${slugs.length > 5 ? '\n...' : ''}`, async () => {
        await apiPost('elimina', { slugs });
        selectedSlugs.clear();
        updateActionBar();
        setTimeout(() => loadRecipes(), 1500);
    });
}

export async function eliminaSingola(slug) {
    showCustomConfirm(`⚠️ Eliminare "${slug}"?\n\nQuesta azione è irreversibile!`, async () => {
        await apiPost('elimina', { slugs: [slug] });
        selectedSlugs.delete(slug);
        updateActionBar();
        setTimeout(() => loadRecipes(), 1500);
    });
}

export async function changeCategory(slug, oldCategory, newCategory) {
    appendTerminal(`\n🔄 Cambio categoria: "${slug}" → ${newCategory}...`, 'job-start');
    setRunning(true);
    try {
        const resp = await fetch('/api/cambia-categoria', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug, oldCategory, newCategory }),
        });
        const data = await resp.json();
        if (data.error) {
            appendTerminal(`❌ ${data.error}`, 'stderr');
            setRunning(false);
            return;
        }
        setTimeout(() => loadRecipes(), 2000);
    } catch (err) {
        appendTerminal(`❌ Errore: ${err.message}`, 'stderr');
        setRunning(false);
    }
}

export function showCategoryDropdown(slug, currentCategory, anchorEl) {
    document.querySelector('.cat-dropdown')?.remove();
    const rect = anchorEl.getBoundingClientRect();
    const dd = document.createElement('div');
    dd.className = 'cat-dropdown';
    dd.style.top = `${rect.bottom + 4}px`;
    dd.style.left = `${rect.left}px`;

    dd.innerHTML = ALL_CATEGORIES
        .map(cat => {
            const icon = CATEGORY_ICONS[cat] || 'folder';
            const color = CATEGORY_COLORS[cat] || '#888';
            const isCurrent = cat === currentCategory;
            return `<button class="cat-dropdown-item${isCurrent ? ' current' : ''}" 
                data-cat="${cat}" style="--cat-color:${color}" 
                ${isCurrent ? 'disabled' : ''}>
                <i data-lucide="${icon}"></i> ${cat}${isCurrent ? ' ✓' : ''}
            </button>`;
        }).join('');

    document.body.appendChild(dd);
    if (window.lucide) lucide.createIcons();

    dd.addEventListener('click', async (e) => {
        const btn = e.target.closest('.cat-dropdown-item');
        if (!btn || btn.disabled) return;
        const newCat = btn.dataset.cat;
        dd.remove();
        await changeCategory(slug, currentCategory, newCat);
    });

    setTimeout(() => {
        document.addEventListener('click', function closeDD(e) {
            if (!dd.contains(e.target)) {
                dd.remove();
                document.removeEventListener('click', closeDD);
            }
        });
    }, 10);
}

export function initRecipeFilters() {
    document.getElementById('recipes-search')?.addEventListener('input', (e) => {
        recipeFilter.search = e.target.value;
        renderRecipes();
    });
    document.getElementById('recipes-sort')?.addEventListener('change', (e) => {
        recipeFilter.sort = e.target.value;
        renderRecipes();
    });
    document.getElementById('recipes-status')?.addEventListener('change', (e) => {
        recipeFilter.status = e.target.value;
        renderRecipes();
    });
    document.getElementById('viewToggle')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.view-btn');
        if (!btn) return;
        recipeFilter.view = btn.dataset.view;
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderRecipes();
    });
}

// Global exposes for HTML onclicks
window.loadRecipes = loadRecipes;
window.toggleSelectAll = toggleSelectAll;
window.toggleSelect = toggleSelect;
window.clearSelection = clearSelection;
window.runSensoryBatch = runSensoryBatch;
window.batchElimina = batchElimina;
window.eliminaSingola = eliminaSingola;
window.showCategoryDropdown = showCategoryDropdown;
window.buildRecipeUrl = buildRecipeUrl;
