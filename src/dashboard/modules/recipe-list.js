/**
 * DASHBOARD — Recipe List & Rendering
 * 
 * Gestione stato ricette, filtraggio, ordinamento, selezione e rendering cards/rows.
 */

import { showToast, showCustomConfirm, showDeleteCategoryConfirm } from './toast.js';
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
    'Pane': 'wheat',           // Fluent: baguette-bread
    'Pizza': 'pizza',          // Fluent: pizza ✅
    'Focaccia': 'wheat',       // Fluent: flatbread
    'Lievitati': 'croissant',  // Fluent: croissant ✅
    'Pasta': 'utensils-crossed', // Fluent: spaghetti
    'Dolci': 'cake-slice',     // Fluent: shortcake ✅
    'Condimenti': 'leaf',      // Fluent: herb ✅
    'Conserve': 'package',     // Fluent: canned-food
    'Secondi Piatti': 'utensils', // Fluent: fork-and-knife
};

export const CATEGORY_DIR_MAP = {
    'Pane': 'pane', 'Pizza': 'pizza', 'Focaccia': 'focaccia',
    'Lievitati': 'lievitati', 'Pasta': 'pasta', 'Dolci': 'dolci',
    'Condimenti': 'condimenti', 'Conserve': 'conserve', 'Secondi Piatti': 'secondi-piatti',
};

export const ALL_CATEGORIES = ['Pane', 'Pizza', 'Focaccia', 'Lievitati', 'Pasta', 'Dolci', 'Condimenti', 'Conserve', 'Secondi Piatti'];

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
            <button class="btn btn-primary" data-action="go-genera">
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
            if (recipeFilter.status === 'no-tech') return !r.hasSensory && !r.hydration && !r.time && !r.temp;
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
    const catDir = r.categoryDir || CATEGORY_DIR_MAP[r.category] || (r.category||'').toLowerCase();

    return `
        <div class="recipe-card${isSelected ? ' selected' : ''}" data-slug="${r.slug}" data-category="${cat}" data-action="toggle-select">
            <button class="recipe-delete-btn" data-action="elimina" data-slug="${r.slug}" title="Elimina ricetta"><i data-lucide="trash-2"></i></button>
            ${img ? `<div class="recipe-card-img-wrap">
                <img class="recipe-card-img" src="${img}" alt="${title}" loading="lazy" onerror="this.parentElement.style.display='none'">
                <span class="recipe-card-cat-badge clickable" style="--cat-color:${catColor}" 
                    data-action="show-category-dropdown" data-slug="${r.slug}" data-current-cat="${cat}"><i data-lucide="${catIcon}"></i> ${cat}</span>
                ${r._createdAt ? `<span class="recipe-card-date-badge"><i data-lucide="calendar"></i> ${formatCreatedAt(r._createdAt)}</span>` : ''}
                <a class="recipe-card-open-btn" href="${recipeUrl}" target="_blank" title="Apri nel sito" data-action="stop-only"><i data-lucide="external-link"></i></a>
            </div>` : `<div class="recipe-card-no-img">
                <span class="recipe-card-cat-badge clickable" style="--cat-color:${catColor}" data-action="show-category-dropdown" data-slug="${r.slug}" data-current-cat="${cat}"><i data-lucide="${catIcon}"></i> ${cat}</span>
                <a class="recipe-card-open-btn" href="${recipeUrl}" target="_blank" title="Apri nel sito" data-action="stop-only"><i data-lucide="external-link"></i></a>
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
                <div class="recipe-card-actions" data-action="stop-only">
                    <div class="btn-split" title="Cambia immagine">
                        <button class="btn-split-main" data-action="refresh-image" data-slug="${r.slug}"><i data-lucide="image"></i></button>
                        <button class="btn-split-chevron" data-action="image-generate-dropdown" data-slug="${r.slug}" data-cat="${cat}">▾</button>
                    </div>
                    <div class="btn-split" title="Analisi Qualità">
                        <button class="btn-split-main" data-action="qualita" data-slug="${r.slug}" title="Analisi Qualità (${getSelectedGeminiModel()})"><i data-lucide="shield-check"></i></button>
                        <button class="btn-split-chevron" data-action="model-dropdown" data-slug="${r.slug}" title="Scegli modello">▾</button>
                    </div>
                    <div class="btn-split btn-split-fix${fixDisabled ? ' disabled' : ''}" title="${fixTitle}">
                        <button class="btn-split-main btn-fix-card" data-action="fix-single" data-slug="${r.slug}" title="Fix AI (${getSelectedGeminiModel()})" ${fixDisabled ? 'disabled' : ''}><i data-lucide="wrench"></i></button>
                        <button class="btn-split-chevron btn-fix-chevron" data-action="fix-model-dropdown" data-slug="${r.slug}" title="Scegli modello ri-validazione" ${fixDisabled ? 'disabled' : ''}>▾</button>
                    </div>
                    <button class="btn btn-secondary btn-sm btn-edit-recipe" data-action="open-editor" data-slug="${r.slug}" data-cat-dir="${catDir}" title="Modifica ricetta"><i data-lucide="pencil"></i></button>
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
    const catDir = r.categoryDir || CATEGORY_DIR_MAP[r.category] || (r.category||'').toLowerCase();

    return `
        <div class="recipe-row${isSelected ? ' selected' : ''}" data-slug="${r.slug}" data-category="${cat}" data-action="toggle-select">
            <div class="recipe-row-info">
                <input type="checkbox" class="recipe-checkbox" ${isSelected ? 'checked' : ''}
                    data-action="toggle-checkbox" data-slug="${r.slug}">
                ${img ? `<img class="recipe-row-thumb" src="${img}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<div class="recipe-row-thumb-empty"></div>'}
                <span class="recipe-row-title">${title}</span>
            </div>
            <span class="recipe-row-cat clickable" style="--cat-color:${catColor}" 
                data-action="show-category-dropdown" data-slug="${r.slug}" data-current-cat="${cat}"><i data-lucide="${catIcon}"></i> ${cat}</span>
            <div class="recipe-row-badges">
                ${getAiBadge(r._generatedBy)}
                ${getQualityBadge(r.slug) ? `<span class="recipe-row-quality">${getQualityBadge(r.slug)}</span>` : ''}
            </div>
            <span class="recipe-row-hydration">${r.hydration || '—'}</span>
            <span class="recipe-row-time">${r.time || '—'}</span>
            <span class="recipe-row-date">${r._createdAt ? formatCreatedAt(r._createdAt) : '—'}</span>
            <div class="recipe-row-actions" data-action="stop-only">
                <div class="btn-split" title="Cambia immagine">
                    <button class="btn-split-main" data-action="refresh-image" data-slug="${r.slug}"><i data-lucide="image"></i></button>
                    <button class="btn-split-chevron" data-action="image-generate-dropdown" data-slug="${r.slug}" data-cat="${cat}">▾</button>
                </div>
                <div class="btn-split" title="Analisi Qualità">
                    <button class="btn-split-main" data-action="qualita" data-slug="${r.slug}" title="Analisi Qualità (${getSelectedGeminiModel()})"><i data-lucide="shield-check"></i></button>
                    <button class="btn-split-chevron" data-action="model-dropdown" data-slug="${r.slug}" title="Scegli modello">▾</button>
                </div>
                <div class="btn-split btn-split-fix${fixDisabled ? ' disabled' : ''}" title="${fixTitle}">
                    <button class="btn-split-main btn-fix-card" data-action="fix-single" data-slug="${r.slug}" title="Fix AI (${getSelectedGeminiModel()})" ${fixDisabled ? 'disabled' : ''}><i data-lucide="wrench"></i></button>
                    <button class="btn-split-chevron btn-fix-chevron" data-action="fix-model-dropdown" data-slug="${r.slug}" title="Scegli modello ri-validazione" ${fixDisabled ? 'disabled' : ''}>▾</button>
                </div>
                <button class="btn btn-secondary btn-sm btn-edit-recipe" data-action="open-editor" data-slug="${r.slug}" data-cat-dir="${catDir}" title="Modifica ricetta"><i data-lucide="pencil"></i></button>
                <a class="btn btn-secondary btn-sm" href="${recipeUrl}" target="_blank" title="Apri nel sito"><i data-lucide="external-link"></i></a>
                <button class="btn btn-secondary btn-sm btn-danger-subtle recipe-row-delete" data-action="elimina" data-slug="${r.slug}" title="Elimina ricetta"><i data-lucide="trash-2"></i></button>
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

    // Ricrea sempre la barra da zero per evitare accumulo di event listener
    if (bar) bar.remove();
    bar = document.createElement('div');
    bar.id = 'selectionActionBar';
    bar.className = 'selection-action-bar';
    document.body.appendChild(bar);

    bar.innerHTML = `
        <div class="action-bar-info">
            <span class="action-bar-count"><i data-lucide="check-square" class="action-bar-icon"></i>${selectedSlugs.size} selezionat${selectedSlugs.size === 1 ? 'a' : 'e'}</span>
        </div>
        <div class="action-bar-actions">
            <div class="btn-split action-bar-split">
                <button class="action-bar-btn" data-action="bar-qualita" title="Analisi qualità (Schema + Gemini)">
                    <i data-lucide="shield-check"></i> Qualità
                </button>
                <button class="action-bar-btn btn-split-chevron action-bar-chevron" data-action="bar-qualita-model" data-grounding="false" title="Scegli modello">▾</button>
            </div>
            <div class="btn-split action-bar-split">
                <button class="action-bar-btn action-bar-ai" data-action="bar-qualita-web" title="Qualità + fonti web (SerpAPI grounding)">
                    <i data-lucide="globe"></i> + Web
                </button>
                <button class="action-bar-btn action-bar-ai btn-split-chevron action-bar-chevron" data-action="bar-qualita-model" data-grounding="true" title="Scegli modello">▾</button>
            </div>
            <div class="btn-split action-bar-split">
                <button class="action-bar-btn action-bar-fix" data-action="bar-fix" title="Applica fix AI alle ricette problematiche (< 85)">
                    <i data-lucide="wrench"></i> Fix AI
                </button>
                <button class="action-bar-btn action-bar-fix btn-split-chevron action-bar-chevron" data-action="bar-fix-model" title="Scegli modello ri-validazione">▾</button>
            </div>
            <div class="btn-split action-bar-split">
                <button class="action-bar-btn" data-action="bar-images-info" title="Gestione Immagini">
                    <i data-lucide="image"></i> Immagini
                </button>
                <button class="action-bar-btn btn-split-chevron action-bar-chevron" data-action="bar-images-batch" title="Opzioni Generazione Immagini">▾</button>
            </div>
            <button class="action-bar-btn action-bar-sensory" data-action="bar-sensory" title="Genera Dati Tecnici AI (Sensoriale + Nutrizionale)">
                <i data-lucide="sparkles"></i> Dati Tecnici
            </button>
            <button class="action-bar-btn action-bar-danger" data-action="bar-elimina" title="Elimina selezionate">
                <i data-lucide="trash-2"></i> Elimina
            </button>
            <button class="action-bar-btn action-bar-close" data-action="bar-clear" title="Deseleziona">
                <i data-lucide="x"></i>
            </button>
        </div>
    `;
    
    // Event delegation for action bar
    bar.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;
        const action = target.dataset.action;
        switch (action) {
            case 'bar-qualita': runQualita(); break;
            case 'bar-qualita-web': runQualita(true); break;
            case 'bar-qualita-model': showQualitaModelDropdown(target, target.dataset.grounding === 'true'); break;
            case 'bar-fix': runFix(); break;
            case 'bar-fix-model': showFixModelDropdown(null, target.closest('.btn-split'), true); break;
            case 'bar-images-info': showToast('Usa la freccetta laterale per generare in blocco con AI!', 'info'); break;
            case 'bar-images-batch': if (window.showImageGenerateDropdownBatch) window.showImageGenerateDropdownBatch(target.closest('.btn-split')); break;
            case 'bar-sensory': runSensoryBatch(); break;
            case 'bar-elimina': batchElimina(); break;
            case 'bar-clear': clearSelection(); break;
        }
    });
    
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
        }).join('') + `
        <div class="cat-dropdown-divider"></div>
        <button class="cat-dropdown-item cat-dropdown-add-btn" data-action="add-category">
            <i data-lucide="plus-circle"></i> Nuova categoria...
        </button>
        <div class="cat-dropdown-form" style="display:none">
            <input type="text" class="cat-dropdown-input" placeholder="Nome categoria..." maxlength="30" autofocus>
            <button class="cat-dropdown-submit" data-action="confirm-add">
                <i data-lucide="check"></i>
            </button>
        </div>
        <div class="cat-dropdown-divider"></div>
        <button class="cat-dropdown-item cat-dropdown-delete-btn" data-action="delete-category">
            <i data-lucide="trash-2"></i> Elimina "${currentCategory}"...
        </button>`;

    document.body.appendChild(dd);
    if (window.lucide) lucide.createIcons();

    dd.addEventListener('click', async (e) => {
        const target = e.target.closest('[data-action], .cat-dropdown-item');
        if (!target) return;

        const action = target.dataset.action;

        // ── Elimina categoria ──
        if (action === 'delete-category') {
            e.stopPropagation();
            dd.remove();

            // Conta ricette nella categoria corrente
            const recipesInCat = allRecipes.filter(r => r.category === currentCategory).length;
            const otherCats = ALL_CATEGORIES.filter(c => c !== currentCategory);

            showDeleteCategoryConfirm(currentCategory, recipesInCat, otherCats, async (moveTo) => {
                appendTerminal(`\n🗑️ Rimozione categoria: "${currentCategory}"...`, 'job-start');
                setRunning(true);
                try {
                    const resp = await fetch('/api/rimuovi-categoria', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: currentCategory, moveTo }),
                    });
                    const data = await resp.json();
                    if (data.error) throw new Error(data.error);

                    showToast(`Categoria "${currentCategory}" eliminata`, 'success');

                    // Aggiorna stato locale
                    const idx = ALL_CATEGORIES.indexOf(currentCategory);
                    if (idx !== -1) ALL_CATEGORIES.splice(idx, 1);
                    delete CATEGORY_COLORS[currentCategory];
                    delete CATEGORY_ICONS[currentCategory];
                    delete CATEGORY_DIR_MAP[currentCategory];

                    setTimeout(() => loadRecipes(), 2000);
                } catch (err) {
                    showToast(`Errore: ${err.message}`, 'error');
                } finally {
                    setRunning(false);
                }
            });
            return;
        }

        // ── Mostra form inline ──
        if (action === 'add-category') {
            e.stopPropagation();
            target.style.display = 'none';
            const form = dd.querySelector('.cat-dropdown-form');
            form.style.display = 'flex';
            const input = form.querySelector('.cat-dropdown-input');
            setTimeout(() => input.focus(), 50);
            return;
        }

        // ── Conferma nuova categoria ──
        if (action === 'confirm-add') {
            e.stopPropagation();
            const input = dd.querySelector('.cat-dropdown-input');
            const name = input.value.trim();
            if (!name) { input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 500); return; }

            // Disabilita form durante la creazione
            input.disabled = true;
            target.disabled = true;
            target.innerHTML = '<i data-lucide="loader" class="spin"></i>';
            if (window.lucide) lucide.createIcons();

            try {
                const resp = await fetch('/api/aggiungi-categoria', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name }),
                });
                const data = await resp.json();
                if (data.error) throw new Error(data.error);

                dd.remove();
                showToast(`Categoria "${name}" in creazione...`, 'success');

                // Aspetta il completamento del job e poi aggiorna la UI
                const checkJob = async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    // Aggiorna liste locali con dati di fallback
                    if (!ALL_CATEGORIES.includes(name)) ALL_CATEGORIES.push(name);
                    if (!CATEGORY_COLORS[name]) CATEGORY_COLORS[name] = '#1abc9c';
                    if (!CATEGORY_ICONS[name]) CATEGORY_ICONS[name] = 'folder';
                    const catSlug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                    if (!CATEGORY_DIR_MAP[name]) CATEGORY_DIR_MAP[name] = catSlug;

                    // Se c'era un slug ricetta, sposta nella nuova categoria
                    if (slug && currentCategory !== name) {
                        // Attendi che il job di creazione finisca
                        await new Promise(r => setTimeout(r, 5000));
                        await changeCategory(slug, currentCategory, name);
                    }

                    loadRecipes();
                };
                checkJob();

            } catch (err) {
                showToast(`Errore: ${err.message}`, 'error');
                input.disabled = false;
                target.disabled = false;
                target.innerHTML = '<i data-lucide="check"></i>';
                if (window.lucide) lucide.createIcons();
            }
            return;
        }

        // ── Cambio categoria esistente ──
        if (target.classList.contains('cat-dropdown-item') && !target.disabled && target.dataset.cat) {
            const newCat = target.dataset.cat;
            dd.remove();
            await changeCategory(slug, currentCategory, newCat);
        }
    });

    // Enter per confermare nel campo input
    dd.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            dd.querySelector('[data-action="confirm-add"]')?.click();
        }
        if (e.key === 'Escape') {
            dd.remove();
        }
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
    const searchInput = document.getElementById('recipes-search');
    const clearBtn = document.getElementById('searchClearBtn');
    searchInput?.addEventListener('input', (e) => {
        recipeFilter.search = e.target.value;
        if (clearBtn) clearBtn.style.display = e.target.value ? 'flex' : 'none';
        renderRecipes();
    });
    clearBtn?.addEventListener('click', () => {
        if (searchInput) { searchInput.value = ''; searchInput.focus(); }
        recipeFilter.search = '';
        clearBtn.style.display = 'none';
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

    // ── Master event delegation for recipe grid ──
    const grid = document.getElementById('recipesGrid');
    grid?.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;
        
        const action = target.dataset.action;
        const slug = target.dataset.slug || target.closest('[data-slug]')?.dataset.slug;
        
        // Stop propagation for actions inside cards
        if (['stop-only', 'elimina', 'refresh-image', 'image-generate-dropdown', 
             'qualita', 'model-dropdown', 'fix-single', 'fix-model-dropdown', 
             'open-editor', 'show-category-dropdown', 'toggle-checkbox'].includes(action)) {
            e.stopPropagation();
        }
        
        switch (action) {
            case 'stop-only': 
                e.stopPropagation(); 
                break;
            case 'toggle-select':
                toggleSelect(slug, e);
                break;
            case 'toggle-checkbox':
                e.stopPropagation();
                toggleSelect(slug, e);
                break;
            case 'elimina':
                eliminaSingola(slug);
                break;
            case 'refresh-image':
                if (window.runRefreshImageForSlug) window.runRefreshImageForSlug(slug);
                break;
            case 'image-generate-dropdown':
                if (window.showImageGenerateDropdown) window.showImageGenerateDropdown(slug, target.dataset.cat, target.closest('.btn-split'));
                break;
            case 'qualita':
                apiPost('qualita', { slugs: [slug], geminiModel: getSelectedGeminiModel() });
                break;
            case 'model-dropdown':
                showModelDropdown(slug, target.closest('.btn-split'));
                break;
            case 'fix-single':
                runFixSingle(slug);
                break;
            case 'fix-model-dropdown':
                showFixModelDropdown(slug, target.closest('.btn-split'));
                break;
            case 'open-editor':
                if (window.openRecipeEditor) window.openRecipeEditor(slug, target.dataset.catDir);
                break;
            case 'show-category-dropdown':
                e.stopPropagation();
                showCategoryDropdown(slug, target.dataset.currentCat, target);
                break;
            case 'go-genera':
                document.querySelector('[data-panel=genera]')?.click();
                break;
            case 'show-quality-report':
                e.stopPropagation();
                if (window.showQualityReport) window.showQualityReport(slug);
                break;
        }
    });

    // Handle checkbox change events separately
    grid?.addEventListener('change', (e) => {
        const target = e.target.closest('[data-action="toggle-checkbox"]');
        if (target) {
            e.stopPropagation();
            toggleSelect(target.dataset.slug, e);
        }
    });
}

// Global exposes — only for functions used by other modules
window.loadRecipes = loadRecipes;
window.buildRecipeUrl = buildRecipeUrl;

