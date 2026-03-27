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
    genera: '🆕 Crea Ricetta da Nome',
    url: '🔗 Importa Ricetta da URL',
    testo: '📝 Converti Testo in Ricetta',
    scopri: '🔍 Scopri Ricette Online',
    ricette: '📋 Le mie Ricette',
    immagini: '🖼️ Image Picker',
    rigenera: '🔄 Rigenera HTML',
    seo: '📈 SEO Ideas — Suggerimenti Ricette',
    valida: '📊 Validazione Ricette',
    verifica: '✅ Verifica Qualità AI',
    sync: '🔄 Sincronizza Cards',
};

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        const panel = item.dataset.panel;

        // Update sidebar
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');

        // Update panel
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        document.getElementById(`panel-${panel}`).classList.add('active');

        // Update title
        document.getElementById('panelTitle').textContent = panelTitles[panel] || '';

        // Load data if needed
        if (panel === 'ricette') loadRecipes();
        if (panel === 'immagini') loadRecipesForPicker();
        if (panel === 'seo') loadSeoSuggestions();
    });
});

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
        idratazione: document.getElementById('gen-idratazione').value,
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
        idratazione: document.getElementById('url-idratazione').value,
        tipo: document.getElementById('url-tipo').value,
    });
}

async function runTesto() {
    const text = document.getElementById('testo-input').value.trim();
    if (!text) return alert('Inserisci il testo della ricetta');

    await apiPost('testo', {
        text,
        tipo: document.getElementById('testo-tipo').value,
        idratazione: document.getElementById('testo-idratazione').value,
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

async function runValida() {
    await apiPost('valida', {});
}

async function runVerifica() {
    await apiPost('verifica', {});
}

async function runSyncCards() {
    await apiPost('sync-cards', {});
}

// ── Recipes List ──
async function loadRecipes() {
    const grid = document.getElementById('recipesGrid');
    grid.innerHTML = '<p class="empty-state">Caricamento...</p>';

    try {
        const resp = await fetch('/api/ricette');
        const recipes = await resp.json();

        if (!recipes.length) {
            grid.innerHTML = '<p class="empty-state">Nessuna ricetta trovata.</p>';
            return;
        }

        const searchTerm = (document.getElementById('recipes-search').value || '').toLowerCase();
        const filtered = searchTerm
            ? recipes.filter(r => (r.title || r.name || '').toLowerCase().includes(searchTerm))
            : recipes;

        grid.innerHTML = filtered.map(r => {
            const title = r.title || r.name || r.slug;
            const img = r.image ? `/${r.image}` : '';
            const cat = r.category || '';

            return `
                <div class="recipe-card">
                    ${img ? `<img class="recipe-card-img" src="${img}" alt="${title}" loading="lazy" onerror="this.style.display='none'">` : ''}
                    <div class="recipe-card-body">
                        <div class="recipe-card-title">${title}</div>
                        <div class="recipe-card-meta">${cat}${r.hydration ? ` · ${r.hydration}%` : ''}</div>
                        <div class="recipe-card-actions">
                            <button class="btn btn-secondary" onclick="runRefreshImageForSlug('${r.slug}')">🖼️ Immagine</button>
                            <button class="btn btn-secondary" onclick="apiPost('rigenera', {slug:'${r.slug}'})">🔄</button>
                        </div>
                    </div>
                </div>`;
        }).join('');
    } catch (err) {
        grid.innerHTML = `<p class="empty-state">❌ Errore: ${err.message}</p>`;
    }
}

// Search filter
document.getElementById('recipes-search')?.addEventListener('input', loadRecipes);

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

        const pills = document.getElementById('statusPills');
        pills.innerHTML = [
            status.hasAnthropic ? '<span class="pill active">🤖 Claude</span>' : '<span class="pill">🤖 No Claude</span>',
            status.hasPexels ? '<span class="pill active">📸 Pexels</span>' : '',
            status.hasUnsplash ? '<span class="pill active">📸 Unsplash</span>' : '',
        ].filter(Boolean).join('');

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
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || '💬'}</span>
        <span class="toast-text">${message}</span>
    `;
    container.appendChild(toast);

    // Auto-dismiss dopo 4s
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ── Command Palette (Ctrl+K) ──
const commands = [
    { icon: '🆕', name: 'Crea Ricetta da Nome', panel: 'genera' },
    { icon: '🔗', name: 'Importa da URL', panel: 'url' },
    { icon: '📝', name: 'Crea da Testo', panel: 'testo' },
    { icon: '🔍', name: 'Scopri Ricette', panel: 'scopri' },
    { icon: '📋', name: 'Le mie Ricette', panel: 'ricette' },
    { icon: '🖼️', name: 'Image Picker', panel: 'immagini' },
    { icon: '🔄', name: 'Rigenera Tutte', action: () => runRigenera(true) },
    { icon: '📊', name: 'Valida Ricette', action: () => runValida() },
    { icon: '✅', name: 'Verifica AI', action: () => runVerifica() },
    { icon: '🔄', name: 'Sync Cards', action: () => runSyncCards() },
    { icon: '🗑️', name: 'Pulisci Terminal', action: () => clearTerminal() },
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
            <span class="command-item-icon">${cmd.icon}</span>
            <span class="command-item-name">${cmd.name}</span>
        </div>
    `).join('');
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

