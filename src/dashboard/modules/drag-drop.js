/**
 * DASHBOARD — Drag & Drop / Clipboard Paste
 * 
 * Gestione upload immagini tramite drag & drop su card/row e paste da clipboard.
 */

import { showToast } from './toast.js';
import { loadRecipes } from './recipe-list.js';

const UPLOAD_MAX_SIZE = 15 * 1024 * 1024; // 15 MB
const UPLOAD_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/bmp', 'image/tiff'];

function findCardFromEvent(e) {
    return e.target.closest('.recipe-card, .recipe-row');
}

export function initDragAndDrop() {
    const grid = document.getElementById('recipesGrid');
    if (!grid) return;

    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => e.preventDefault());

    grid.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        const card = findCardFromEvent(e);
        if (card && !card.classList.contains('drag-over')) {
            grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
            card.classList.add('drag-over');
        }
    });

    grid.addEventListener('dragleave', (e) => {
        const card = findCardFromEvent(e);
        if (card && !card.contains(e.relatedTarget)) {
            card.classList.remove('drag-over');
        }
    });

    grid.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));

        const card = findCardFromEvent(e);
        if (!card) return;

        const slug = card.dataset.slug;
        const category = card.dataset.category;
        if (!slug || !category) return;

        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            handleImageFile(file, slug, category, card);
            return;
        }

        const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (url && url.match(/^https?:\/\/.+\.(jpg|jpeg|png|webp|avif|gif)/i)) {
            handleImageUrl(url, slug, category, card);
            return;
        }

        showToast('⚠️ Trascina un\'immagine (JPG, PNG, WebP)', 'warning');
    });

    document.addEventListener('paste', (e) => {
        const panel = document.getElementById('panel-ricette');
        if (!panel || !panel.classList.contains('active')) return;

        const items = e.clipboardData?.items;
        if (!items) return;

        let imageItem = null;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                imageItem = item;
                break;
            }
        }
        if (!imageItem) return;

        const selectedCards = document.querySelectorAll('.recipe-card.selected, .recipe-row.selected');
        if (selectedCards.length !== 1) {
            showToast('📋 Seleziona una sola ricetta per incollare l\'immagine', 'info');
            return;
        }

        e.preventDefault();
        const card = selectedCards[0];
        const slug = card.dataset.slug;
        const category = card.dataset.category;
        if (!slug || !category) return;

        const file = imageItem.getAsFile();
        if (file) {
            handleImageFile(file, slug, category, card);
        }
    });
}

function handleImageFile(file, slug, category, card) {
    if (!UPLOAD_ALLOWED_TYPES.includes(file.type)) {
        showToast(`⚠️ Formato non supportato: ${file.type}. Usa JPG, PNG o WebP.`, 'warning');
        return;
    }
    if (file.size > UPLOAD_MAX_SIZE) {
        showToast(`⚠️ File troppo grande: ${(file.size / 1024 / 1024).toFixed(1)} MB (max 15 MB)`, 'warning');
        return;
    }

    const blobUrl = URL.createObjectURL(file);
    showPreviewOverlay(card, blobUrl, slug, category, () => {
        const reader = new FileReader();
        reader.onload = () => {
            uploadImageBase64(slug, category, reader.result, card);
        };
        reader.readAsDataURL(file);
    });
}

function handleImageUrl(url, slug, category, card) {
    showPreviewOverlay(card, url, slug, category, () => {
        uploadImageUrl(slug, category, url, card);
    });
}

function showPreviewOverlay(card, previewSrc, slug, category, onConfirm) {
    card.querySelector('.drop-preview-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'drop-preview-overlay';
    overlay.innerHTML = `
        <img src="${previewSrc}" alt="Preview" class="drop-preview-img">
        <div class="drop-preview-info">
            <span>Aggiornare l'immagine di <strong>${slug}</strong>?</span>
        </div>
        <div class="drop-preview-actions">
            <button class="drop-preview-btn confirm" title="Conferma">
                <i data-lucide="check"></i> Conferma
            </button>
            <button class="drop-preview-btn cancel" title="Annulla">
                <i data-lucide="x"></i> Annulla
            </button>
        </div>
    `;

    overlay.querySelector('.confirm').addEventListener('click', (e) => {
        e.stopPropagation();
        overlay.remove();
        onConfirm();
    });
    overlay.querySelector('.cancel').addEventListener('click', (e) => {
        e.stopPropagation();
        overlay.remove();
        if (previewSrc.startsWith('blob:')) URL.revokeObjectURL(previewSrc);
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
            if (previewSrc.startsWith('blob:')) URL.revokeObjectURL(previewSrc);
        }
    });

    card.style.position = 'relative';
    card.appendChild(overlay);
    if (window.lucide) lucide.createIcons({ nodes: [overlay] });
}

async function uploadImageBase64(slug, category, dataUrl, card) {
    const cardImg = card.querySelector('.recipe-card-img, .recipe-row-thumb');
    const oldSrc = cardImg?.src;
    if (cardImg) cardImg.src = dataUrl;

    showCardUploadState(card, true);

    try {
        const resp = await fetch('/api/upload-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug, category, imageBase64: dataUrl }),
        });
        const data = await resp.json();

        if (!resp.ok) throw new Error(data.error || 'Upload fallito');

        showToast(`✅ Immagine di "${slug}" aggiornata!`, 'success');
        window.imageCacheBuster = Date.now();
        setTimeout(() => loadRecipes(), 1500);
    } catch (err) {
        showToast(`❌ Errore upload: ${err.message}`, 'error');
        if (cardImg && oldSrc) cardImg.src = oldSrc;
    } finally {
        showCardUploadState(card, false);
    }
}

async function uploadImageUrl(slug, category, url, card) {
    showCardUploadState(card, true);

    try {
        const resp = await fetch('/api/upload-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug, category, imageUrl: url }),
        });
        const data = await resp.json();

        if (!resp.ok) throw new Error(data.error || 'Upload fallito');

        showToast(`✅ Immagine di "${slug}" scaricata e ottimizzata!`, 'success');
        window.imageCacheBuster = Date.now();
        setTimeout(() => loadRecipes(), 2000);
    } catch (err) {
        showToast(`❌ Errore download: ${err.message}`, 'error');
    } finally {
        showCardUploadState(card, false);
    }
}

function showCardUploadState(card, loading) {
    if (loading) {
        let spinner = card.querySelector('.upload-spinner-overlay');
        if (!spinner) {
            spinner = document.createElement('div');
            spinner.className = 'upload-spinner-overlay';
            spinner.innerHTML = `
                <div class="upload-spinner-ring"></div>
                <span>Elaborazione...</span>
            `;
            card.style.position = 'relative';
            card.appendChild(spinner);
        }
    } else {
        card.querySelector('.upload-spinner-overlay')?.remove();
    }
}
