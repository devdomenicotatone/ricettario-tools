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

                <div class="ai-reference-section">
                    <div class="ai-section-label">🎨 Riferimento Stile <span class="ai-section-label-hint">(opzionale — per il crafting del prompt)</span></div>
                    <div class="ai-reference-zone" id="ai-reference-zone">
                        <i data-lucide="image-plus"></i>
                        <span>Trascina o clicca per aggiungere un riferimento stile</span>
                        <input type="file" id="ai-reference-input" accept="image/*" hidden>
                    </div>
                    <div class="ai-reference-preview" id="ai-reference-preview" style="display:none">
                        <img id="ai-reference-thumb" alt="Riferimento">
                        <div class="ai-reference-info">
                            <span id="ai-reference-name"></span>
                            <span id="ai-reference-size"></span>
                        </div>
                        <button class="ai-reference-remove" id="ai-reference-remove" title="Rimuovi riferimento">
                            <i data-lucide="x"></i>
                        </button>
                    </div>
                </div>

                <div class="ai-subject-section">
                    <div class="ai-section-label">📷 Riferimento Soggetto <span class="ai-section-label-hint">(opzionale — foto reale del piatto da imitare)</span></div>
                    <div class="ai-subject-zone" id="ai-subject-zone">
                        <i data-lucide="camera"></i>
                        <span>Trascina una foto reale del piatto per imitarne forma e texture</span>
                        <input type="file" id="ai-subject-input" accept="image/*" hidden>
                    </div>
                    <div class="ai-subject-preview" id="ai-subject-preview" style="display:none">
                        <img id="ai-subject-thumb" alt="Soggetto">
                        <div class="ai-reference-info">
                            <span id="ai-subject-name"></span>
                            <span id="ai-subject-size"></span>
                        </div>
                        <button class="ai-reference-remove" id="ai-subject-remove" title="Rimuovi soggetto">
                            <i data-lucide="x"></i>
                        </button>
                    </div>
                </div>

                <button class="btn btn-primary btn-full-width" data-action="generate-ai" data-slug="${data.slug}" data-category="${data.category}" id="ai-generate-btn">
                    <i data-lucide="sparkles"></i> <span id="ai-generate-label">Genera Immagine</span>
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
        // Reset button to step 1
        const btn = document.getElementById('ai-generate-btn');
        if (btn) { btn.dataset.step = 'craft'; btn.classList.remove('btn-confirm-generate'); }
        if (window.lucide) lucide.createIcons();

        // ── Reference image drop zone setup ──
        initReferenceImageZone();
        initSubjectImageZone();
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
    const btn = document.getElementById('ai-generate-btn');
    const textarea = document.getElementById('ai-prompt-input');
    const prompt = textarea.value.trim();
    if (!prompt) return showToast('Inserisci un prompt', 'warning');

    const step = btn.dataset.step || 'craft';

    if (step === 'craft') {
        // ── Step 1: Craft prompt + translate to Italian ──
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-2" class="lucide-icon spin"></i> Composizione prompt...';
        if (window.lucide) lucide.createIcons();

        const refData = window._aiReferenceData;
        const referenceImage = refData?.base64 || null;
        const referenceImageMimeType = refData?.mimeType || null;

        try {
            const resp = await fetch('/api/refresh-image/craft-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slug, category, prompt, referenceImage, referenceImageMimeType })
            });
            const data = await resp.json();
            if (data.error) throw new Error(data.error);

            textarea.value = data.promptIT;
            textarea.classList.add('prompt-reviewed');
            btn.dataset.step = 'generate';
            btn.disabled = false;
            btn.classList.add('btn-confirm-generate');
            btn.innerHTML = '<i data-lucide="check"></i> <span id="ai-generate-label">Conferma e Genera</span>';
            if (window.lucide) lucide.createIcons();
            showToast('Prompt generato! Rileggi e modifica, poi conferma.', 'info');
        } catch (e) {
            showToast(`Errore: ${e.message}`, 'error');
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="sparkles"></i> <span id="ai-generate-label">Genera Immagine</span>';
            if (window.lucide) lucide.createIcons();
        }
        return;
    }

    // ── Step 2: Send confirmed Italian prompt to generate ──
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2" class="lucide-icon spin"></i> Generazione...';
    if (window.lucide) lucide.createIcons();

    const refData = window._aiReferenceData;
    const referenceImage = refData?.base64 || null;
    const referenceImageMimeType = refData?.mimeType || null;

    // Subject reference (foto reale del piatto)
    const subData = window._aiSubjectData;
    const subjectImage = subData?.base64 || null;
    const subjectImageMimeType = subData?.mimeType || null;

    closeImageModal();
    appendTerminal(`🤖 Generazione immagine AI per "${slug}"${subjectImage ? ' (📷 con soggetto reale)' : ''}${referenceImage ? ' (🎨 con stile)' : ''}...`, 'job-start');
    try {
        await apiPost('refresh-image/generate', { slug, category, prompt, promptLanguage: 'it', referenceImage, referenceImageMimeType, subjectImage, subjectImageMimeType });
    } catch (e) {
        showToast('Errore durante la generazione', 'error');
        appendTerminal(`❌ Errore AI: ${e.message}`, 'stderr');
    } finally {
        window._aiReferenceData = null;
        window._aiSubjectData = null;
    }
}

// ── Reference Image Zone (drag & drop + click to browse) ──
function initReferenceImageZone() {
    const zone = document.getElementById('ai-reference-zone');
    const input = document.getElementById('ai-reference-input');
    const preview = document.getElementById('ai-reference-preview');
    if (!zone || !input) return;

    // Click to browse
    zone.addEventListener('click', (e) => {
        if (e.target === input) return;
        input.click();
    });

    // File selected via input
    input.addEventListener('change', () => {
        if (input.files.length > 0) handleReferenceFile(input.files[0]);
    });

    // Drag & drop
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => {
        zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) handleReferenceFile(file);
    });

    // Remove button
    const removeBtn = document.getElementById('ai-reference-remove');
    if (removeBtn) {
        removeBtn.addEventListener('click', clearReferenceImage);
    }
}

function handleReferenceFile(file) {
    const zone = document.getElementById('ai-reference-zone');
    const preview = document.getElementById('ai-reference-preview');
    const thumb = document.getElementById('ai-reference-thumb');
    const nameEl = document.getElementById('ai-reference-name');
    const sizeEl = document.getElementById('ai-reference-size');
    const label = document.getElementById('ai-generate-label');

    // Compress via Canvas: resize to max 1024px + export as webp
    const img = new Image();
    img.onload = () => {
        const MAX = 1024;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
            const scale = MAX / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                // Show preview
                thumb.src = e.target.result;
                nameEl.textContent = file.name.length > 25 ? file.name.substring(0, 22) + '...' : file.name;
                const compressedKB = (blob.size / 1024).toFixed(0);
                const originalKB = (file.size / 1024).toFixed(0);
                sizeEl.textContent = `${compressedKB} KB (da ${originalKB} KB)`;
                zone.style.display = 'none';
                preview.style.display = 'flex';

                window._aiReferenceData = {
                    base64: e.target.result.split(',')[1],
                    mimeType: 'image/webp'
                };

                if (label) label.textContent = 'Genera con Riferimento';
                if (window.lucide) lucide.createIcons();
            };
            reader.readAsDataURL(blob);
        }, 'image/webp', 0.85);
    };
    img.src = URL.createObjectURL(file);
}

function clearReferenceImage() {
    const zone = document.getElementById('ai-reference-zone');
    const preview = document.getElementById('ai-reference-preview');
    const input = document.getElementById('ai-reference-input');
    const label = document.getElementById('ai-generate-label');

    window._aiReferenceData = null;
    if (zone) zone.style.display = '';
    if (preview) preview.style.display = 'none';
    if (input) input.value = '';
    if (label) label.textContent = 'Genera Immagine';
}

export function closeImageModal() {
    document.getElementById('imageModal')?.classList.remove('active');
    // Prevent stale reference data leaking into the next session
    window._aiReferenceData = null;
    window._aiSubjectData = null;
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
        <button class="model-dropdown-item" data-action="quick-generate-subject">
            <i data-lucide="camera"></i>
            Genera da Foto Reale
            <span class="model-tag tag-subject">📷</span>
        </button>
        <button class="model-dropdown-item" data-action="generate-with-ref">
            <i data-lucide="image-plus"></i>
            Genera con Riferimento
            <span class="model-tag tag-ref">REF</span>
        </button>
    `;
    dd.querySelector('[data-action="quick-generate"]').addEventListener('click', () => {
        dd.remove();
        quickGenerateAiImage(slug, cat);
    });
    dd.querySelector('[data-action="quick-generate-subject"]').addEventListener('click', () => {
        dd.remove();
        showSubjectUploadDialog(slug, cat);
    });
    dd.querySelector('[data-action="generate-with-ref"]').addEventListener('click', () => {
        dd.remove();
        // Open directly on AI tab — skip the 5 stock provider API calls
        const r = allRecipes.find(x => x.slug === slug);
        const title = r ? (r.title || r.name) : slug;
        showImagePickerModal({
            recipeName: title,
            slug,
            category: cat,
            providerResults: []
        });
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

// ── Subject Image Zone (foto reale del piatto) ──
function initSubjectImageZone() {
    const zone = document.getElementById('ai-subject-zone');
    const input = document.getElementById('ai-subject-input');
    if (!zone || !input) return;

    zone.addEventListener('click', (e) => {
        if (e.target === input) return;
        input.click();
    });

    input.addEventListener('change', () => {
        if (input.files.length > 0) handleSubjectFile(input.files[0]);
    });

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => {
        zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) handleSubjectFile(file);
    });

    const removeBtn = document.getElementById('ai-subject-remove');
    if (removeBtn) removeBtn.addEventListener('click', clearSubjectImage);
}

function handleSubjectFile(file) {
    const zone = document.getElementById('ai-subject-zone');
    const preview = document.getElementById('ai-subject-preview');
    const thumb = document.getElementById('ai-subject-thumb');
    const nameEl = document.getElementById('ai-subject-name');
    const sizeEl = document.getElementById('ai-subject-size');
    const label = document.getElementById('ai-generate-label');

    const img = new Image();
    img.onload = () => {
        const MAX = 1024;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
            const scale = MAX / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                thumb.src = e.target.result;
                nameEl.textContent = file.name.length > 25 ? file.name.substring(0, 22) + '...' : file.name;
                const compressedKB = (blob.size / 1024).toFixed(0);
                const originalKB = (file.size / 1024).toFixed(0);
                sizeEl.textContent = `${compressedKB} KB (da ${originalKB} KB)`;
                zone.style.display = 'none';
                preview.style.display = 'flex';

                window._aiSubjectData = {
                    base64: e.target.result.split(',')[1],
                    mimeType: 'image/webp'
                };

                if (label) label.textContent = 'Genera da Foto Reale';
                if (window.lucide) lucide.createIcons();
            };
            reader.readAsDataURL(blob);
        }, 'image/webp', 0.85);
    };
    img.src = URL.createObjectURL(file);
}

function clearSubjectImage() {
    const zone = document.getElementById('ai-subject-zone');
    const preview = document.getElementById('ai-subject-preview');
    const input = document.getElementById('ai-subject-input');
    const label = document.getElementById('ai-generate-label');

    window._aiSubjectData = null;
    if (zone) zone.style.display = '';
    if (preview) preview.style.display = 'none';
    if (input) input.value = '';
    // Restore label only if no style reference is set either
    if (label && !window._aiReferenceData) label.textContent = 'Genera Immagine';
}

// ── Quick Generate with Subject (mini dialog) ──
function showSubjectUploadDialog(slug, category) {
    // Remove existing dialog
    document.getElementById('subject-upload-dialog')?.remove();

    const r = allRecipes.find(x => x.slug === slug);
    const title = r ? (r.title || r.name) : slug;

    const overlay = document.createElement('div');
    overlay.id = 'subject-upload-dialog';
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal-content" style="width: 440px; max-width: 90vw;">
            <div class="modal-header">
                <h3>📷 Genera da Foto Reale</h3>
                <button class="modal-close" id="subject-dialog-close">&times;</button>
            </div>
            <div class="modal-body" style="padding: 24px;">
                <p style="color: var(--text-secondary); margin-bottom: 12px; font-size: 13px;">
                    Carica una foto reale di <strong>${title}</strong>. Il modello imiterà forma, texture e colore del piatto.
                </p>
                <div class="ai-subject-zone" id="quick-subject-zone" style="min-height: 100px; flex-direction: column; gap: 8px;">
                    <i data-lucide="camera"></i>
                    <span>Trascina o clicca per caricare</span>
                    <input type="file" id="quick-subject-input" accept="image/*" hidden>
                </div>
                <div class="ai-subject-preview" id="quick-subject-preview" style="display:none">
                    <img id="quick-subject-thumb" alt="Soggetto">
                    <div class="ai-reference-info">
                        <span id="quick-subject-name"></span>
                        <span id="quick-subject-size"></span>
                    </div>
                    <button class="ai-reference-remove" id="quick-subject-remove" title="Rimuovi">
                        <i data-lucide="x"></i>
                    </button>
                </div>
                <button class="btn btn-primary btn-full-width" id="quick-subject-generate" disabled style="margin-top: 16px;">
                    <i data-lucide="sparkles"></i> Genera Immagine
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    if (window.lucide) lucide.createIcons();

    // Close button
    document.getElementById('subject-dialog-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // File handling
    const zone = document.getElementById('quick-subject-zone');
    const input = document.getElementById('quick-subject-input');
    const generateBtn = document.getElementById('quick-subject-generate');
    let subjectData = null;

    zone.addEventListener('click', (e) => { if (e.target !== input) input.click(); });
    input.addEventListener('change', () => { if (input.files.length > 0) processQuickSubject(input.files[0]); });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) processQuickSubject(file);
    });

    function processQuickSubject(file) {
        const img = new Image();
        img.onload = () => {
            const MAX = 1024;
            let { width, height } = img;
            if (width > MAX || height > MAX) {
                const scale = MAX / Math.max(width, height);
                width = Math.round(width * scale);
                height = Math.round(height * scale);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);

            canvas.toBlob((blob) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const preview = document.getElementById('quick-subject-preview');
                    document.getElementById('quick-subject-thumb').src = e.target.result;
                    document.getElementById('quick-subject-name').textContent = file.name.length > 25 ? file.name.substring(0, 22) + '...' : file.name;
                    document.getElementById('quick-subject-size').textContent = `${(blob.size / 1024).toFixed(0)} KB`;
                    zone.style.display = 'none';
                    preview.style.display = 'flex';
                    generateBtn.disabled = false;

                    subjectData = {
                        base64: e.target.result.split(',')[1],
                        mimeType: 'image/webp'
                    };
                    if (window.lucide) lucide.createIcons();
                };
                reader.readAsDataURL(blob);
            }, 'image/webp', 0.85);
        };
        img.src = URL.createObjectURL(file);
    }

    document.getElementById('quick-subject-remove')?.addEventListener('click', () => {
        subjectData = null;
        zone.style.display = '';
        document.getElementById('quick-subject-preview').style.display = 'none';
        input.value = '';
        generateBtn.disabled = true;
    });

    generateBtn.addEventListener('click', async () => {
        if (!subjectData) return;
        overlay.remove();
        const prompt = title + ", food photography, high quality, professional lighting";
        appendTerminal(`🤖 Generazione immagine AI per "${slug}" (📷 con soggetto reale)...`, 'job-start');
        showToast(`Generazione da foto reale per ${title}...`, 'info');
        try {
            await apiPost('refresh-image/generate', {
                slug, category, prompt,
                subjectImage: subjectData.base64,
                subjectImageMimeType: subjectData.mimeType
            });
        } catch (e) {
            showToast('Errore durante la generazione', 'error');
            appendTerminal(`❌ Errore AI: ${e.message}`, 'stderr');
        }
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
window.showSubjectUploadDialog = showSubjectUploadDialog;

