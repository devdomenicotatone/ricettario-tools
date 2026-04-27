/**
 * DASHBOARD — Image Picker Modal & Batch Actions
 * 
 * Interfaccia ricerca immagini, visualizzazione risultati, e generazione batch AI.
 */

import { showToast, showCustomConfirm } from './toast.js';
import { apiPost, setRunning } from './navigation.js';
import { appendTerminal, expandTerminal } from './terminal.js';
import { allRecipes, selectedSlugs, clearSelection } from './recipe-list.js';

export async function loadRecipesForPicker() {
    const select = document.getElementById('img-slug');
    if (!select) return;
    try {
        const resp = await fetch('/api/ricette');
        const recipes = await resp.json();
        select.innerHTML = '<option value="">-- Seleziona ricetta --</option>' +
            recipes.map(r => `<option value="${r.slug}">${r.title || r.slug} (${r.category || '?'})</option>`).join('');
    } catch {}
}

export async function runRefreshImage() {
    const slug = document.getElementById('img-slug').value;
    if (!slug) return showToast('Seleziona una ricetta', 'warning');
    await runRefreshImageForSlug(slug);
}

export async function runRefreshImageForSlug(slug, forceRefresh = false) {
    appendTerminal(`\n🖼️ Ricerca immagini per "${slug}"...`, 'job-start');
    setRunning(true);
    try {
        const resp = await fetch('/api/refresh-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug, forceRefresh }),
        });
        const data = await resp.json();
        if (data.error) {
            appendTerminal(`❌ ${data.error}`, 'stderr');
            setRunning(false);
            return;
        }
        appendTerminal(`✅ Trovate immagini da ${data.providerResults.filter(p => p.images.length > 0).length} provider`, 'success');
        setRunning(false);
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
    document.getElementById('modalTitle').innerHTML = `🖼️ Immagine per: ${data.recipeName} 
        <button class="btn btn-sm modal-refresh-btn" data-action="force-refresh" data-slug="${data.slug}">🔄 Forza Refresh API</button>
        <input type="text" id="modalImageSearch" placeholder="🔍 Cerca tra i risultati..." class="modal-search-input">
    `;
    
    // Attach event listeners for modal header
    document.getElementById('modalTitle').querySelector('[data-action="force-refresh"]')
        ?.addEventListener('click', () => runRefreshImageForSlug(data.slug, true));
    document.getElementById('modalImageSearch')?.addEventListener('keyup', (e) => filterModalImages(e.target.value));

    const providers = data.providerResults.filter(p => p.images.length > 0);

    tabsEl.innerHTML = providers.map((p, i) =>
        `<button class="modal-tab${i === 0 ? ' active' : ''}" data-idx="${i}">${p.emoji} ${p.provider} (${p.images.length})</button>`
    ).join('') + `<button class="modal-tab${providers.length === 0 ? ' active' : ''}" data-idx="ai">🍌 Genera AI</button>`;

    let gridsHtml = providers.map((p, i) =>
        `<div class="modal-grid" data-idx="${i}" style="display:${i === 0 ? 'grid' : 'none'}">
            ${p.images.map((img, imgIdx) => `
                <div class="modal-img-card" data-action="select-image" data-provider-idx="${i}" data-img-idx="${imgIdx}">
                    <img src="${img.thumbUrl || img.url}" alt="${(img.title || '').substring(0, 40)}" loading="lazy">
                    <div class="modal-img-title" title="${(img.title || '').replace(/"/g, '&quot;')}">${img.title || 'Senza titolo'}</div>
                    <div class="modal-img-card-info">
                        <span class="modal-img-card-score">⭐${img.score}</span> · ${img.width}×${img.height} · ${img.author || '?'}
                    </div>
                </div>
            `).join('')}
        </div>`
    ).join('');

    gridsHtml += `
        <div class="modal-grid modal-grid-ai" data-idx="ai" style="display:${providers.length === 0 ? 'block' : 'none'}">
            <div class="modal-ai-form">
                <p class="modal-ai-desc">Descrivi l'immagine che vuoi generare. Usa parole chiave descrittive.</p>
                <textarea id="ai-prompt-input" class="form-textarea modal-ai-textarea" rows="3"></textarea>
                <button class="btn btn-primary btn-full-width" data-action="generate-ai" data-slug="${data.slug}" data-category="${data.category}" id="ai-generate-btn">
                    <i data-lucide="sparkles"></i> Genera Immagine
                </button>
            </div>
        </div>
    `;
    bodyEl.innerHTML = gridsHtml;
    
    // Store provider data for click delegation
    bodyEl._providerData = { providers, slug: data.slug, category: data.category };
    
    // Event delegation for image selection and AI generate
    bodyEl.addEventListener('click', function modalBodyClick(e) {
        const target = e.target.closest('[data-action]');
        if (!target) return;
        
        if (target.dataset.action === 'select-image') {
            const pIdx = parseInt(target.dataset.providerIdx);
            const iIdx = parseInt(target.dataset.imgIdx);
            const img = bodyEl._providerData.providers[pIdx]?.images[iIdx];
            if (img) confirmImageSelection(img, bodyEl._providerData.slug, bodyEl._providerData.category);
        } else if (target.dataset.action === 'generate-ai') {
            generateAiImage(target.dataset.slug, target.dataset.category);
        }
    });

    setTimeout(() => {
        const ta = document.getElementById('ai-prompt-input');
        if (ta) ta.value = data.recipeName + ", food photography, high quality, professional lighting";
        if (window.lucide) lucide.createIcons();
    }, 10);

    tabsEl.querySelectorAll('.modal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            tabsEl.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            bodyEl.querySelectorAll('.modal-grid').forEach(g => g.style.display = 'none');
            const targetGrid = bodyEl.querySelector(`.modal-grid[data-idx="${tab.dataset.idx}"]`);
            if (targetGrid) targetGrid.style.display = tab.dataset.idx === 'ai' ? 'block' : 'grid';
        });
    });

    modal.classList.add('active');
    setTimeout(() => {
        const searchInput = document.getElementById('modalImageSearch');
        if (searchInput) searchInput.focus();
    }, 100);
}

window.filterModalImages = function(query) {
    const q = query.toLowerCase().trim();
    const cards = document.querySelectorAll('.modal-img-card');
    cards.forEach(card => {
        const titleEl = card.querySelector('div[title]');
        const text = titleEl ? titleEl.getAttribute('title').toLowerCase() : '';
        card.style.display = (q === '' || text.includes(q)) ? 'block' : 'none';
    });
};

export async function confirmImageSelection(image, slug, category) {
    closeImageModal();
    appendTerminal(`⬇️ Scaricando immagine da ${image.provider}...`, 'job-start');
    await apiPost('refresh-image/confirm', { slug, image, category });
}

export async function generateAiImage(slug, category) {
    const prompt = document.getElementById('ai-prompt-input').value.trim();
    if (!prompt) return showToast('Inserisci un prompt', 'warning');
    const btn = document.getElementById('ai-generate-btn');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="lucide-icon spin"></i> Generazione...';
    if (window.lucide) lucide.createIcons();

    closeImageModal();
    appendTerminal(`🤖 Generazione immagine AI per "${slug}"...`, 'job-start');
    try {
        await apiPost('refresh-image/generate', { slug, category, prompt });
    } catch (e) {
        showToast('Errore durante la generazione', 'error');
        appendTerminal(`❌ Errore AI: ${e.message}`, 'stderr');
    }
}

export function closeImageModal() {
    document.getElementById('imageModal')?.classList.remove('active');
}

export function showImageGenerateDropdown(slug, cat, anchorEl) {
    document.querySelector('.model-dropdown')?.remove();
    const rect = anchorEl.getBoundingClientRect();
    const dd = document.createElement('div');
    dd.className = 'model-dropdown';
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 100) {
        dd.style.bottom = `${window.innerHeight - rect.top + 4}px`;
        dd.style.left = `${rect.left}px`;
    } else {
        dd.style.top = `${rect.bottom + 4}px`;
        dd.style.left = `${rect.left}px`;
    }

    dd.innerHTML = `
        <div class="model-dropdown-title">Generazione Immagine</div>
        <button class="model-dropdown-item" data-action="quick-generate">
            <i data-lucide="sparkles"></i>
            Genera con Nano Banana 2
            <span class="model-tag tag-new">AI</span>
        </button>
    `;
    dd.querySelector('[data-action="quick-generate"]').addEventListener('click', () => {
        dd.remove();
        quickGenerateAiImage(slug, cat);
    });
    document.body.appendChild(dd);
    if (window.lucide) lucide.createIcons();

    setTimeout(() => {
        document.addEventListener('click', function closeMD(e) {
            if (!dd.contains(e.target) && !anchorEl.contains(e.target)) {
                dd.remove();
                document.removeEventListener('click', closeMD);
            }
        });
    }, 10);
}

export function showImageGenerateDropdownBatch(anchorEl) {
    document.querySelector('.model-dropdown')?.remove();
    const rect = anchorEl.getBoundingClientRect();
    const dd = document.createElement('div');
    dd.className = 'model-dropdown';
    dd.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    dd.style.left = `${rect.left}px`;

    dd.innerHTML = `
        <div class="model-dropdown-title">Azione Batch Immagini</div>
        <button class="model-dropdown-item" data-action="batch-generate">
            <i data-lucide="sparkles"></i>
            Genera in blocco (Nano Banana 2)
            <span class="model-tag tag-new">AI</span>
        </button>
    `;
    dd.querySelector('[data-action="batch-generate"]').addEventListener('click', () => {
        dd.remove();
        runBatchGenerateAiImage();
    });
    document.body.appendChild(dd);
    if (window.lucide) lucide.createIcons();

    setTimeout(() => {
        document.addEventListener('click', function closeMD(e) {
            if (!dd.contains(e.target) && !anchorEl.contains(e.target)) {
                dd.remove();
                document.removeEventListener('click', closeMD);
            }
        });
    }, 10);
}

export async function quickGenerateAiImage(slug, category) {
    const r = allRecipes.find(x => x.slug === slug);
    const title = r ? (r.title || r.name) : slug;
    const prompt = title + ", food photography, high quality, professional lighting";
    appendTerminal(`🤖 Generazione immagine AI per "${slug}" (Nano Banana 2)...`, 'job-start');
    showToast(`Generazione immagine per ${title}...`, 'info');
    try {
        await apiPost('refresh-image/generate', { slug, category, prompt });
    } catch (e) {
        showToast('Errore durante la generazione', 'error');
        appendTerminal(`❌ Errore AI: ${e.message}`, 'stderr');
    }
}

export async function runBatchGenerateAiImage() {
    if (selectedSlugs.size === 0) return showToast('Seleziona almeno una ricetta', 'warning');
    const slugs = [...selectedSlugs];
    showCustomConfirm(`🤖 Generare immagini AI (Nano Banana 2) per ${slugs.length} ricett${slugs.length === 1 ? 'a' : 'e'}?\n\nVerranno usati i titoli come prompt in background.`, async () => {
        expandTerminal();
        for(const slug of slugs) {
            const r = allRecipes.find(x => x.slug === slug);
            const title = r ? (r.title || r.name) : slug;
            const category = r ? (r.category) : '';
            const prompt = title + ", food photography, high quality, professional lighting";
            appendTerminal(`🤖 Generazione immagine AI per "${slug}"...`, 'job-start');
            try {
                await apiPost('refresh-image/generate', { slug, category, prompt });
                appendTerminal(`✅ Immagine accodata per "${slug}"`, 'success');
            } catch (e) {
                appendTerminal(`❌ Errore API per "${slug}": ${e.message}`, 'stderr');
            }
        }
        clearSelection();
    });
}

export function initImageModal() {
    document.getElementById('imageModal')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) closeImageModal();
    });
}

// Global exposes
window.closeImageModal = closeImageModal;
window.runRefreshImage = runRefreshImage;
window.runRefreshImageForSlug = runRefreshImageForSlug;
window.confirmImageSelection = confirmImageSelection;
window.generateAiImage = generateAiImage;
window.showImageGenerateDropdown = showImageGenerateDropdown;
window.showImageGenerateDropdownBatch = showImageGenerateDropdownBatch;
window.quickGenerateAiImage = quickGenerateAiImage;
window.runBatchGenerateAiImage = runBatchGenerateAiImage;

