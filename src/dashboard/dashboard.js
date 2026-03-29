/**
 * DASHBOARD.JS — Client logic + WebSocket
 */

// ── WebSocket Connection ──
let ws = null;
let reconnectTimeout = null;

function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => {
        document.querySelector('.status-dot').classList.add('connected');
        document.querySelector('.api-status span').textContent = 'Connesso';
        appendTerminal('✅ WebSocket connesso', 'success');
    };

    ws.onclose = () => {
        document.querySelector('.status-dot').classList.remove('connected');
        document.querySelector('.api-status span').textContent = 'Disconnesso';
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWsMessage(data);
    };
}

function handleWsMessage(data) {
    switch (data.type) {
        case 'connected':
            fetchStatus();
            break;
        case 'job:start':
            appendTerminal(`\n▶ ${data.name}`, 'job-start');
            setRunning(true);
            break;
        case 'job:output':
            appendTerminal(data.text, data.stream);
            break;
        case 'job:end':
            const icon = data.success ? '✅' : '❌';
            appendTerminal(`${icon} Job completato`, data.success ? 'success' : 'stderr');
            setRunning(false);
            // Refresh ricette se necessario
            if (document.getElementById('panel-ricette').classList.contains('active')) {
                loadRecipes();
            }
            break;
    }
}

// ── Terminal ──
function appendTerminal(text, type = 'stdout') {
    const terminal = document.getElementById('terminal');
    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.textContent = text;
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;

    // Expand terminal if minimized
    document.getElementById('terminalContainer').classList.remove('minimized');
}

function clearTerminal() {
    document.getElementById('terminal').innerHTML =
        '<div class="terminal-line system">🔥 Terminal pulito.</div>';
}

function toggleTerminal() {
    const container = document.getElementById('terminalContainer');
    container.classList.toggle('minimized');
    document.getElementById('terminalToggle').textContent =
        container.classList.contains('minimized') ? '▲' : '▼';
}

// ── Running state ──
let isRunning = false;
function setRunning(running) {
    isRunning = running;
    document.querySelectorAll('.btn-primary').forEach(btn => {
        btn.disabled = running;
    });
}

// ── Navigation ──
const panelTitles = {
    genera: 'Crea Ricetta da Nome',
    url: 'Importa Ricetta da URL',
    testo: 'Converti Testo in Ricetta',
    scopri: 'Scopri Ricette Online',
    ricette: 'Le mie Ricette',
    immagini: 'Image Picker',
    rigenera: 'Rigenera HTML',
    seo: 'SEO Ideas — Suggerimenti Ricette',
    valida: 'Validazione Ricette',
    verifica: 'Verifica Qualità AI',
    sync: 'Sincronizza Cards',
};

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        let panel = item.dataset.panel;

        // Update sidebar
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');

        // Update panel
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        const panelEl = document.getElementById(`panel-${panel}`);
        if (panelEl) panelEl.classList.add('active');

        // Update title
        document.getElementById('panelTitle').textContent = panelTitles[panel] || '';

        // Load data if needed
        if (panel === 'ricette') loadRecipes();
        if (panel === 'immagini') loadRecipesForPicker();
        if (panel === 'seo') loadSeoSuggestions();
    });
});

function navigateAndRun(panel, action) {
    // Naviga al pannello ricette
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navBtn = document.querySelector(`[data-panel="${panel}"]`) || 
                   document.querySelector('[data-panel="ricette"]');
    if (navBtn) navBtn.classList.add('active');

    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const panelEl = document.getElementById(`panel-${panel}`);
    if (panelEl) panelEl.classList.add('active');
    document.getElementById('panelTitle').textContent = panelTitles[panel] || '';

    if (panel === 'ricette') {
        loadRecipes().then(() => { if (action) action(); });
    } else {
        if (action) action();
    }
}

// ── Slider values ──
document.querySelectorAll('.form-range').forEach(slider => {
    const valId = slider.id + '-val';
    const valEl = document.getElementById(valId);
    if (valEl) {
        slider.addEventListener('input', () => {
            valEl.textContent = slider.id.includes('quante') ? slider.value : slider.value + '%';
        });
    }
});

// ── API Calls ──
async function apiPost(endpoint, body) {
    const resp = await fetch(`/api/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return resp.json();
}

// ── Commands ──
async function runGenera() {
    const nome = document.getElementById('gen-nome').value.trim();
    if (!nome) return alert('Inserisci il nome della ricetta');

    await apiPost('genera', {
        nome,
        tipo: document.getElementById('gen-tipo').value,
        note: document.getElementById('gen-note').value,
        noImage: document.getElementById('gen-noimage').checked,
    });
}

async function runUrl() {
    const url = document.getElementById('url-input').value.trim();
    if (!url) return alert('Inserisci un URL');

    await apiPost('genera', {
        url,
        tipo: document.getElementById('url-tipo').value,
    });
}

async function runTesto() {
    const text = document.getElementById('testo-input').value.trim();
    if (!text) return alert('Inserisci il testo della ricetta');

    await apiPost('testo', {
        text,
        tipo: document.getElementById('testo-tipo').value,
    });
}

async function runScopri() {
    const query = document.getElementById('scopri-query').value.trim();
    if (!query) return alert('Inserisci una query di ricerca');

    await apiPost('scopri', {
        query,
        quante: document.getElementById('scopri-quante').value,
    });
}

async function runRigenera(tutte) {
    await apiPost('rigenera', { tutte: true });
}

async function runQualita(withGrounding = false) {
    if (selectedSlugs.size === 0) return alert('Seleziona almeno una ricetta');
    await apiPost('qualita', { slugs: [...selectedSlugs], grounding: withGrounding });
}

async function runSyncCards() {
    await apiPost('sync-cards', {});
}

// ── Recipes List PRO ──
let allRecipes = [];
let siteBaseUrl = 'http://localhost:5173/Ricettario/';
let selectedSlugs = new Set();
let recipeFilter = { category: 'all', search: '', sort: 'name-asc', view: 'grid' };
let qualityIndex = {}; // slug → {score, verdict, issueCount, timestamp}

async function fetchQualityIndex() {
    try {
        const res = await fetch('/api/quality-index');
        qualityIndex = await res.json();
    } catch { qualityIndex = {}; }
}

function getQualityBadge(slug) {
    const q = qualityIndex[slug];
    if (!q) return '';
    const cls = q.score >= 80 ? 'quality-good' : q.score >= 60 ? 'quality-warn' : 'quality-bad';
    const emoji = q.score >= 80 ? '🟢' : q.score >= 60 ? '🟡' : '🔴';
    return `<span class="quality-badge ${cls}" title="Qualità: ${q.score}/100 — ${q.issueCount} issue (${new Date(q.timestamp).toLocaleDateString()})">${emoji} ${q.score}</span>`;
}

async function runFix() {
    if (selectedSlugs.size === 0) return alert('Seleziona almeno una ricetta');
    // Filtra solo quelle con score < 85
    const fixable = [...selectedSlugs].filter(s => qualityIndex[s] && qualityIndex[s].score < 85);
    if (fixable.length === 0) return alert('Nessuna ricetta selezionata necessita di fix (tutte >= 85)');
    if (!confirm(`Applicare fix AI a ${fixable.length} ricett${fixable.length === 1 ? 'a' : 'e'} con problemi?\n\nVerrà creato un backup .backup.json per ogni file.`)) return;
    await apiPost('qualita/fix', { slugs: fixable });
}

const CATEGORY_COLORS = {
    'Pane':      '#d4a574',
    'Pizza':     '#e74c3c',
    'Focaccia':  '#27ae60',
    'Lievitati': '#f39c12',
    'Pasta':     '#3498db',
    'Dolci':     '#e91e63',
};

const CATEGORY_ICONS = {
    'Pane': 'wheat', 'Pizza': 'pizza', 'Focaccia': 'sandwich',
    'Lievitati': 'croissant', 'Pasta': 'utensils', 'Dolci': 'cake-slice',
};

function getHydrationNum(h) {
    if (!h) return 0;
    return parseFloat(String(h).replace('%', '')) || 0;
}

function getHydrationClass(val) {
    if (val >= 75) return 'hydration-high';
    if (val >= 60) return 'hydration-mid';
    return 'hydration-low';
}

// ── Cambio Categoria One-Click ──
const ALL_CATEGORIES = ['Pane', 'Pizza', 'Focaccia', 'Lievitati', 'Pasta', 'Dolci'];

function showCategoryDropdown(slug, currentCategory, anchorEl) {
    // Rimuovi dropdown precedente
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
    lucide.createIcons();

    // Click handler
    dd.addEventListener('click', async (e) => {
        const btn = e.target.closest('.cat-dropdown-item');
        if (!btn || btn.disabled) return;
        const newCat = btn.dataset.cat;
        dd.remove();
        await changeCategory(slug, currentCategory, newCat);
    });

    // Chiudi al click fuori
    setTimeout(() => {
        document.addEventListener('click', function closeDD(e) {
            if (!dd.contains(e.target)) {
                dd.remove();
                document.removeEventListener('click', closeDD);
            }
        });
    }, 10);
}

async function changeCategory(slug, oldCategory, newCategory) {
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

        // Ricarica ricette dopo sync (aspetta un po' per i file)
        setTimeout(() => loadRecipes(), 2000);
    } catch (err) {
        appendTerminal(`❌ Errore: ${err.message}`, 'stderr');
        setRunning(false);
    }
}

async function loadRecipes() {
    const grid = document.getElementById('recipesGrid');
    grid.innerHTML = '<p class="empty-state">Caricamento...</p>';
    try {
        const [resp] = await Promise.all([
            fetch('/api/ricette'),
            fetchQualityIndex(),
        ]);
        allRecipes = await resp.json();
        updateCategoryTabs();
        renderRecipes();
        updateActionBar();
    } catch (err) {
        grid.innerHTML = `<p class="empty-state">❌ Errore caricamento: ${err.message}</p>`;
    }
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
    lucide.createIcons();

    // Attach click handlers
    tabsEl.querySelectorAll('.recipe-cat-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            recipeFilter.category = tab.dataset.category;
            tabsEl.querySelectorAll('.recipe-cat-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderRecipes();
        });
    });
}

function renderRecipes() {
    const grid = document.getElementById('recipesGrid');
    const counterEl = document.getElementById('recipesCounter');

    // Filter
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

    // Sort
    const sortKey = recipeFilter.sort;
    filtered.sort((a, b) => {
        switch (sortKey) {
            case 'name-asc':
                return (a.title || '').localeCompare(b.title || '', 'it');
            case 'name-desc':
                return (b.title || '').localeCompare(a.title || '', 'it');
            case 'hydration-asc':
                return getHydrationNum(a.hydration) - getHydrationNum(b.hydration);
            case 'hydration-desc':
                return getHydrationNum(b.hydration) - getHydrationNum(a.hydration);
            case 'category':
                return (a.category || '').localeCompare(b.category || '', 'it') ||
                       (a.title || '').localeCompare(b.title || '', 'it');
            default: return 0;
        }
    });

    // Counter
    if (filtered.length === allRecipes.length) {
        counterEl.textContent = `${allRecipes.length} ricette`;
    } else {
        counterEl.textContent = `${filtered.length} di ${allRecipes.length} ricette`;
    }

    // Empty state
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

    // Toggle view class
    grid.className = recipeFilter.view === 'list' ? 'recipes-list' : 'recipes-grid';

    // Render
    if (recipeFilter.view === 'list') {
        const allChecked = filtered.length > 0 && filtered.every(r => selectedSlugs.has(r.slug));
        grid.innerHTML = `<div class="recipe-list-header">
            <span><input type="checkbox" class="recipe-checkbox-all" ${allChecked ? 'checked' : ''} 
                onchange="toggleSelectAll(this.checked)"> Ricetta</span>
            <span>Categoria</span><span>Qualità</span><span>Idratazione</span><span>Tempo</span><span>Azioni</span>
        </div>` + filtered.map(r => renderRecipeRow(r)).join('');
    } else {
        grid.innerHTML = filtered.map(r => renderRecipeCard(r)).join('');
    }
    lucide.createIcons();
}

function renderRecipeCard(r) {
    const title = r.title || r.name || r.slug;
    const img = r.image ? `/${r.image}` : '';
    const cat = r.category || '';
    const catColor = CATEGORY_COLORS[cat] || '#888';
    const catIcon = CATEGORY_ICONS[cat] || 'folder';
    const hydNum = getHydrationNum(r.hydration);
    const hydClass = getHydrationClass(hydNum);
    const recipeUrl = r.href ? `${siteBaseUrl}${r.href}` : '#';
    const isSelected = selectedSlugs.has(r.slug);

    return `
        <div class="recipe-card${isSelected ? ' selected' : ''}" onclick="toggleSelect('${r.slug}', event)">
            <button class="recipe-delete-btn" onclick="event.stopPropagation(); eliminaSingola('${r.slug}')" title="Elimina ricetta"><i data-lucide="trash-2"></i></button>
            ${img ? `<div class="recipe-card-img-wrap">
                <img class="recipe-card-img" src="${img}" alt="${title}" loading="lazy" onerror="this.parentElement.style.display='none'">
                <span class="recipe-card-cat-badge clickable" style="--cat-color:${catColor}" 
                    onclick="event.stopPropagation(); showCategoryDropdown('${r.slug}', '${cat}', this)"><i data-lucide="${catIcon}"></i> ${cat}</span>
            </div>` : `<div class="recipe-card-no-img"><span class="recipe-card-cat-badge clickable" style="--cat-color:${catColor}" onclick="event.stopPropagation(); showCategoryDropdown('${r.slug}', '${cat}', this)"><i data-lucide="${catIcon}"></i> ${cat}</span></div>`}
            <div class="recipe-card-body">
                <div class="recipe-card-title">${title}</div>
                <div class="recipe-card-badges">
                    ${getQualityBadge(r.slug)}
                    ${r.hydration ? `<span class="recipe-badge ${hydClass}"><i data-lucide="droplets"></i> ${r.hydration}</span>` : ''}
                    ${r.time ? `<span class="recipe-badge recipe-badge-time"><i data-lucide="clock"></i> ${r.time}</span>` : ''}
                </div>
                ${r.description ? `<div class="recipe-card-desc">${r.description.substring(0, 90)}…</div>` : ''}
                <div class="recipe-card-actions" onclick="event.stopPropagation()">
                    <button class="btn btn-secondary btn-sm" onclick="runRefreshImageForSlug('${r.slug}')" title="Cambia immagine"><i data-lucide="image"></i></button>
                    <button class="btn btn-secondary btn-sm" onclick="apiPost('rigenera', {slug:'${r.slug}'})" title="Rigenera HTML"><i data-lucide="refresh-cw"></i></button>
                    <button class="btn btn-secondary btn-sm" onclick="apiPost('qualita', {slugs:['${r.slug}']})" title="Analisi Qualità"><i data-lucide="shield-check"></i></button>
                    <a class="btn btn-secondary btn-sm" href="${recipeUrl}" target="_blank" title="Apri nel sito"><i data-lucide="external-link"></i></a>
                </div>
            </div>
        </div>`;
}

function renderRecipeRow(r) {
    const title = r.title || r.name || r.slug;
    const img = r.image ? `/${r.image}` : '';
    const cat = r.category || '';
    const catColor = CATEGORY_COLORS[cat] || '#888';
    const catIcon = CATEGORY_ICONS[cat] || 'folder';
    const recipeUrl = r.href ? `${siteBaseUrl}${r.href}` : '#';
    const isSelected = selectedSlugs.has(r.slug);

    return `
        <div class="recipe-row${isSelected ? ' selected' : ''}" onclick="toggleSelect('${r.slug}', event)">
            <div class="recipe-row-info">
                <input type="checkbox" class="recipe-checkbox" ${isSelected ? 'checked' : ''}
                    onchange="toggleSelect('${r.slug}', event)" onclick="event.stopPropagation()">
                ${img ? `<img class="recipe-row-thumb" src="${img}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<div class="recipe-row-thumb-empty"></div>'}
                <span class="recipe-row-title">${title}</span>
            </div>
            <span class="recipe-row-cat clickable" style="--cat-color:${catColor}" 
                onclick="event.stopPropagation(); showCategoryDropdown('${r.slug}', '${cat}', this)"><i data-lucide="${catIcon}"></i> ${cat}</span>
            ${getQualityBadge(r.slug) ? `<span class="recipe-row-quality">${getQualityBadge(r.slug)}</span>` : ''}
            <span class="recipe-row-hydration">${r.hydration || '—'}</span>
            <span class="recipe-row-time">${r.time || '—'}</span>
            <div class="recipe-row-actions" onclick="event.stopPropagation()">
                <button class="btn btn-secondary btn-sm" onclick="runRefreshImageForSlug('${r.slug}')" title="Cambia immagine"><i data-lucide="image"></i></button>
                <button class="btn btn-secondary btn-sm" onclick="apiPost('rigenera', {slug:'${r.slug}'})" title="Rigenera HTML"><i data-lucide="refresh-cw"></i></button>
                <button class="btn btn-secondary btn-sm" onclick="apiPost('qualita', {slugs:['${r.slug}']})" title="Analisi Qualità"><i data-lucide="shield-check"></i></button>
                <a class="btn btn-secondary btn-sm" href="${recipeUrl}" target="_blank" title="Apri nel sito"><i data-lucide="external-link"></i></a>
                <button class="btn btn-secondary btn-sm btn-danger-subtle recipe-row-delete" onclick="eliminaSingola('${r.slug}')" title="Elimina ricetta"><i data-lucide="trash-2"></i></button>
            </div>
        </div>`;
}

// ── Selection System (PRO — Shift+click, Ctrl+A, click-on-card) ──
let lastClickedSlug = null; // Per Shift+click range selection

function toggleSelect(slug, event) {
    const filtered = getFilteredRecipes();

    // ── Shift+Click: range selection ──
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

    // ── Normal toggle ──
    if (selectedSlugs.has(slug)) selectedSlugs.delete(slug);
    else selectedSlugs.add(slug);

    lastClickedSlug = slug;
    renderRecipes();
    updateActionBar();
}

function toggleSelectAll(checked) {
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

function clearSelection() {
    selectedSlugs.clear();
    lastClickedSlug = null;
    renderRecipes();
    updateActionBar();
}

// ── Keyboard shortcuts: Ctrl+A seleziona tutte, Escape deseleziona ──
document.addEventListener('keydown', (e) => {
    // Solo se siamo nel pannello ricette e non in un input
    const isInInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    const ricettePanel = document.getElementById('panel-ricette');
    if (!ricettePanel?.classList.contains('active')) return;

    // Ctrl+A o Cmd+A → seleziona tutte le filtrate
    if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !isInInput) {
        e.preventDefault();
        toggleSelectAll(true);
    }

    // Escape → deseleziona tutte
    if (e.key === 'Escape' && selectedSlugs.size > 0) {
        e.preventDefault();
        clearSelection();
    }
});

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
    return filtered;
}

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
            <button class="action-bar-btn" onclick="runQualita()" title="Analisi qualità (Schema + Claude + Gemini)">
                <i data-lucide="shield-check"></i> Qualità
            </button>
            <button class="action-bar-btn action-bar-ai" onclick="runQualita(true)" title="Qualità + fonti web (SerpAPI grounding)">
                <i data-lucide="globe"></i> + Web
            </button>
            <button class="action-bar-btn" onclick="batchRigenera()" title="Rigenera selezionate (da JSON esistente)">
                <i data-lucide="refresh-cw"></i> Rigenera
            </button>
            <button class="action-bar-btn action-bar-fix" onclick="runFix()" title="Applica fix AI alle ricette problematiche (< 85)">
                <i data-lucide="wrench"></i> Fix AI
            </button>
            <button class="action-bar-btn action-bar-danger" onclick="batchElimina()" title="Elimina selezionate">
                <i data-lucide="trash-2"></i> Elimina
            </button>
            <button class="action-bar-btn action-bar-close" onclick="clearSelection()" title="Deseleziona">
                <i data-lucide="x"></i>
            </button>
        </div>
    `;
    lucide.createIcons({ attrs: { 'width': 16, 'height': 16 } });
}

async function batchRigenera() {
    const slugs = [...selectedSlugs];
    appendTerminal(`\n🔄 Rigenerazione di ${slugs.length} ricette...`, 'job-start');
    for (const slug of slugs) {
        await apiPost('rigenera', { slug });
    }
}


async function batchElimina() {
    const slugs = [...selectedSlugs];
    const conferma = confirm(`⚠️ Eliminare ${slugs.length} ricett${slugs.length === 1 ? 'a' : 'e'}?\n\nQuesta azione è irreversibile!\n\n${slugs.join('\n')}`);
    if (!conferma) return;

    await apiPost('elimina', { slugs });
    selectedSlugs.clear();
    updateActionBar();
    // Ricarica dopo un breve delay per dare tempo al sync
    setTimeout(() => loadRecipes(), 1500);
}

async function eliminaSingola(slug) {
    const conferma = confirm(`⚠️ Eliminare "${slug}"?\n\nQuesta azione è irreversibile!`);
    if (!conferma) return;

    await apiPost('elimina', { slugs: [slug] });
    selectedSlugs.delete(slug);
    updateActionBar();
    setTimeout(() => loadRecipes(), 1500);
}

// ── Recipes Event Handlers ──
document.getElementById('recipes-search')?.addEventListener('input', (e) => {
    recipeFilter.search = e.target.value;
    renderRecipes();
});

document.getElementById('recipes-sort')?.addEventListener('change', (e) => {
    recipeFilter.sort = e.target.value;
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

// ── Image Picker ──
async function loadRecipesForPicker() {
    const select = document.getElementById('img-slug');
    try {
        const resp = await fetch('/api/ricette');
        const recipes = await resp.json();
        select.innerHTML = '<option value="">-- Seleziona ricetta --</option>' +
            recipes.map(r => `<option value="${r.slug}">${r.title || r.slug} (${r.category || '?'})</option>`).join('');
    } catch {}
}

async function runRefreshImage() {
    const slug = document.getElementById('img-slug').value;
    if (!slug) return alert('Seleziona una ricetta');
    await runRefreshImageForSlug(slug);
}

async function runRefreshImageForSlug(slug) {
    appendTerminal(`\n🖼️ Ricerca immagini per "${slug}"...`, 'job-start');
    setRunning(true);

    try {
        const resp = await fetch('/api/refresh-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug }),
        });
        const data = await resp.json();

        if (data.error) {
            appendTerminal(`❌ ${data.error}`, 'stderr');
            setRunning(false);
            return;
        }

        appendTerminal(`✅ Trovate immagini da ${data.providerResults.filter(p => p.images.length > 0).length} provider`, 'success');
        setRunning(false);

        // Apri il modal con le immagini
        showImagePickerModal(data);
    } catch (err) {
        appendTerminal(`❌ Errore: ${err.message}`, 'stderr');
        setRunning(false);
    }
}

function showImagePickerModal(data) {
    const modal = document.getElementById('imageModal');
    const tabsEl = document.getElementById('modalTabs');
    const bodyEl = document.getElementById('modalBody');
    document.getElementById('modalTitle').textContent = `🖼️ Immagine per: ${data.recipeName}`;

    const providers = data.providerResults.filter(p => p.images.length > 0);

    // Tabs
    tabsEl.innerHTML = providers.map((p, i) =>
        `<button class="modal-tab${i === 0 ? ' active' : ''}" data-idx="${i}">${p.emoji} ${p.provider} (${p.images.length})</button>`
    ).join('');

    // Grids
    const gridsHtml = providers.map((p, i) =>
        `<div class="modal-grid" data-idx="${i}" style="display:${i === 0 ? 'grid' : 'none'}">
            ${p.images.map(img => `
                <div class="modal-img-card" onclick='confirmImageSelection(${JSON.stringify({
                    url: img.url, thumbUrl: img.thumbUrl, title: img.title,
                    author: img.author, license: img.license, provider: img.provider,
                    width: img.width, height: img.height,
                }).replace(/'/g, "&#39;")}, "${data.slug}", "${data.category}")'>
                    <img src="${img.thumbUrl || img.url}" alt="${(img.title || '').substring(0, 40)}" loading="lazy">
                    <div class="modal-img-card-info">
                        <span class="modal-img-card-score">⭐${img.score}</span> · ${img.width}×${img.height} · ${img.author || '?'}
                    </div>
                </div>
            `).join('')}
        </div>`
    ).join('');

    bodyEl.innerHTML = gridsHtml;

    // Tab switching
    tabsEl.querySelectorAll('.modal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            tabsEl.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            bodyEl.querySelectorAll('.modal-grid').forEach(g => g.style.display = 'none');
            bodyEl.querySelector(`.modal-grid[data-idx="${tab.dataset.idx}"]`).style.display = 'grid';
        });
    });

    modal.classList.add('active');
}

async function confirmImageSelection(image, slug, category) {
    closeImageModal();
    appendTerminal(`⬇️ Scaricando immagine da ${image.provider}...`, 'job-start');

    await apiPost('refresh-image/confirm', { slug, image, category });
}

function closeImageModal() {
    document.getElementById('imageModal').classList.remove('active');
}

// Close modal on backdrop click
document.getElementById('imageModal')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeImageModal();
});

// ── Status ──
async function fetchStatus() {
    try {
        const resp = await fetch('/api/status');
        const status = await resp.json();

        // Salva URL del sito Vite per i link "Apri nel sito"
        if (status.siteUrl) siteBaseUrl = status.siteUrl;

        const pills = document.getElementById('statusPills');
        pills.innerHTML = [
            status.hasAnthropic ? '<span class="pill active"><i data-lucide="sparkles"></i> Claude</span>' : '<span class="pill"><i data-lucide="sparkles"></i> No Claude</span>',
            status.hasGemini ? '<span class="pill active"><i data-lucide="shield-check"></i> Gemini</span>' : '',
            status.hasPexels ? '<span class="pill active"><i data-lucide="camera"></i> Pexels</span>' : '',
            status.hasUnsplash ? '<span class="pill active"><i data-lucide="camera"></i> Unsplash</span>' : '',
        ].filter(Boolean).join('');
        lucide.createIcons();

        // Update stats
        const providerCount = [status.hasAnthropic, status.hasPexels, status.hasUnsplash, status.hasSerpApi].filter(Boolean).length;
        document.getElementById('stat-provider').textContent = providerCount;
    } catch {}
}

// ── Stats Bar ──
async function loadStats() {
    try {
        const resp = await fetch('/api/ricette');
        const recipes = await resp.json();

        document.getElementById('stat-ricette').textContent = recipes.length;

        const categories = new Set(recipes.map(r => r.category).filter(Boolean));
        document.getElementById('stat-categorie').textContent = categories.size;

        const withImage = recipes.filter(r => r.image).length;
        document.getElementById('stat-immagini').textContent = withImage;
    } catch {}
}

// ── Toast Notifications ──
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const icons = { success: 'check-circle', error: 'x-circle', warning: 'alert-triangle', info: 'info' };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon"><i data-lucide="${icons[type] || 'message-circle'}"></i></span>
        <span class="toast-text">${message}</span>
    `;
    container.appendChild(toast);
    lucide.createIcons({ attrs: { 'width': 18, 'height': 18 } });

    // Auto-dismiss dopo 4s
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ── Command Palette (Ctrl+K) ──
const commands = [
    { icon: 'plus-circle', name: 'Crea Ricetta da Nome', panel: 'genera' },
    { icon: 'link', name: 'Importa da URL', panel: 'url' },
    { icon: 'file-text', name: 'Crea da Testo', panel: 'testo' },
    { icon: 'search', name: 'Scopri Ricette', panel: 'scopri' },
    { icon: 'book-open', name: 'Le mie Ricette', panel: 'ricette' },
    { icon: 'image', name: 'Image Picker', panel: 'immagini' },
    { icon: 'refresh-cw', name: 'Rigenera Tutte', action: () => runRigenera(true) },
    { icon: 'shield-check', name: 'Qualità Ricette', action: () => runQualita() },
    { icon: 'globe', name: 'Qualità + Web', action: () => runQualita(true) },
    { icon: 'refresh-cw', name: 'Sync Cards', action: () => runSyncCards() },
    { icon: 'trash-2', name: 'Pulisci Terminal', action: () => clearTerminal() },
];

let cmdSelectedIdx = 0;

function openCommandPalette() {
    const overlay = document.getElementById('commandPalette');
    overlay.classList.add('active');
    const input = document.getElementById('cmdInput');
    input.value = '';
    input.focus();
    cmdSelectedIdx = 0;
    renderCommands('');
}

function closeCommandPalette() {
    document.getElementById('commandPalette').classList.remove('active');
}

function renderCommands(filter) {
    const results = document.getElementById('cmdResults');
    const filtered = filter
        ? commands.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()))
        : commands;

    cmdSelectedIdx = Math.min(cmdSelectedIdx, Math.max(0, filtered.length - 1));

    results.innerHTML = filtered.map((cmd, i) => `
        <div class="command-item${i === cmdSelectedIdx ? ' selected' : ''}"
             onmouseenter="cmdSelectedIdx=${i}; renderCommands(document.getElementById('cmdInput').value)"
             onclick="executeCommand(${commands.indexOf(cmd)})">
            <span class="command-item-icon"><i data-lucide="${cmd.icon}"></i></span>
            <span class="command-item-name">${cmd.name}</span>
        </div>
    `).join('');
    lucide.createIcons();
}

function executeCommand(idx) {
    const cmd = commands[idx];
    closeCommandPalette();

    if (cmd.panel) {
        // Naviga al pannello
        const navItem = document.querySelector(`[data-panel="${cmd.panel}"]`);
        if (navItem) navItem.click();
    }

    if (cmd.action) {
        cmd.action();
    }

    showToast(`${cmd.icon} ${cmd.name}`, 'info');
}

document.getElementById('cmdInput')?.addEventListener('input', (e) => {
    cmdSelectedIdx = 0;
    renderCommands(e.target.value);
});

document.getElementById('cmdInput')?.addEventListener('keydown', (e) => {
    const filter = e.target.value;
    const filtered = filter
        ? commands.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()))
        : commands;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        cmdSelectedIdx = Math.min(cmdSelectedIdx + 1, filtered.length - 1);
        renderCommands(filter);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        cmdSelectedIdx = Math.max(cmdSelectedIdx - 1, 0);
        renderCommands(filter);
    } else if (e.key === 'Enter' && filtered.length > 0) {
        e.preventDefault();
        executeCommand(commands.indexOf(filtered[cmdSelectedIdx]));
    } else if (e.key === 'Escape') {
        closeCommandPalette();
    }
});

document.getElementById('commandPalette')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('command-palette-overlay')) closeCommandPalette();
});

// Global keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl+K or Cmd+K → Command Palette
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openCommandPalette();
    }
    // Escape → close any modal/palette
    if (e.key === 'Escape') {
        closeCommandPalette();
        closeImageModal();
    }
});

// ── Enhanced WS handler with toasts ──
const _origHandleWs = handleWsMessage;
handleWsMessage = function(data) {
    _origHandleWs(data);

    if (data.type === 'job:end') {
        if (data.success) {
            showToast('Operazione completata con successo!', 'success');
        } else {
            showToast('Operazione fallita — controlla il terminal', 'error');
        }
        loadStats(); // Refresh stats after job
    }
};

// ── Init ──
connectWebSocket();
fetchStatus();
loadStats();

// ── SEO Ideas ──
let currentSeoCategory = 'Pane';
let seoLoading = false;

// Tab click handler
document.getElementById('seoTabs')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.seo-tab');
    if (!tab) return;
    const category = tab.dataset.category;
    if (category === currentSeoCategory && !seoLoading) return;

    document.querySelectorAll('.seo-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentSeoCategory = category;
    loadSeoSuggestions(category);
});

async function loadSeoSuggestions(category, forceRefresh = false) {
    category = category || currentSeoCategory;
    const grid = document.getElementById('seoGrid');
    const countEl = document.getElementById('seoCount');
    const sourceEl = document.getElementById('seoSource');

    seoLoading = true;

    // Show skeleton
    grid.innerHTML = Array(6).fill(
        `<div class="seo-skeleton">
            <div class="seo-skeleton-line"></div>
            <div class="seo-skeleton-line"></div>
            <div class="seo-skeleton-line"></div>
        </div>`
    ).join('');

    try {
        const resp = await fetch(`/api/seo-suggestions?category=${encodeURIComponent(category)}&refresh=${forceRefresh}`);
        const data = await resp.json();

        if (!resp.ok) {
            grid.innerHTML = `<div class="seo-loading"><p>❌ ${data.error || 'Errore di caricamento'}</p></div>`;
            return;
        }

        const suggestions = data.suggestions || [];
        const newCount = suggestions.filter(s => !s.alreadyCreated).length;
        countEl.textContent = `${newCount} nuove / ${suggestions.length} totali`;

        const hasDataForSeo = suggestions.some(s => s.source === 'dataforseo');
        sourceEl.textContent = hasDataForSeo
            ? 'Fonte: DataForSEO (volumi reali) + Google Autocomplete'
            : 'Fonte: Google Autocomplete via SerpAPI';

        if (suggestions.length === 0) {
            grid.innerHTML = `<div class="seo-loading"><p>Nessun suggerimento trovato per "${category}"</p></div>`;
            return;
        }

        renderSeoCards(grid, suggestions);
    } catch (err) {
        grid.innerHTML = `<div class="seo-loading"><p>❌ ${err.message}</p></div>`;
    } finally {
        seoLoading = false;
    }
}

function renderSeoCards(container, suggestions) {
    container.innerHTML = suggestions.map((s, i) => {
        const score = s.popularity?.score || 50;
        const fillClass = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
        const badgeClass = s.alreadyCreated ? 'created' : score >= 70 ? 'hot' : score >= 40 ? 'medium' : 'low';
        const badgeText = s.alreadyCreated ? '✅ Creata' : s.popularity?.label || `#${i + 1}`;
        const emoji = s.popularity?.emoji || '📊';
        const volumeText = s.volume ? `${s.volume.toLocaleString('it')} ricerche/mese` : `${emoji} ${s.popularity?.label || ''}`;

        return `
            <div class="seo-card ${s.alreadyCreated ? 'already-created' : ''}" data-keyword="${escapeHtml(s.keyword)}">
                <div class="seo-card-header">
                    <div class="seo-card-keyword">${escapeHtml(s.keyword)}</div>
                    <span class="seo-card-badge ${badgeClass}">${badgeText}</span>
                </div>
                <div class="seo-card-popularity">
                    <span>${volumeText}</span>
                    <div class="seo-popularity-bar">
                        <div class="seo-popularity-fill ${fillClass}" style="width:${score}%"></div>
                    </div>
                </div>
                <div class="seo-card-footer">
                    <span class="seo-card-source">${s.source || 'autocomplete'}</span>
                    ${s.alreadyCreated
                        ? '<span style="font-size:11px;color:var(--success)">Già nel Ricettario</span>'
                        : `<button class="seo-gen-btn" onclick="generateFromSeo('${escapeHtml(s.keyword)}', '${s.category}')">
                            🔥 Genera
                           </button>`
                    }
                </div>
            </div>
        `;
    }).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function generateFromSeo(keyword, category) {
    // Pre-fill the Genera form and switch to it
    document.getElementById('gen-nome').value = keyword;

    // Set category
    const tipoSelect = document.getElementById('gen-tipo');
    if (category && tipoSelect) {
        const option = Array.from(tipoSelect.options).find(o => o.value === category);
        if (option) tipoSelect.value = category;
    }

    // Switch to genera panel
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('[data-panel="genera"]').classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-genera').classList.add('active');
    document.getElementById('panelTitle').textContent = panelTitles.genera;

    showToast(`📝 "${keyword}" pronta per la generazione!`, 'info');
}

