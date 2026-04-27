/**
 * DASHBOARD — Stats & System Status
 * 
 * Recupero statistiche, stato API e gestione chiavi Gemini.
 */

import { showToast, showCustomConfirm } from './toast.js';
import { appendTerminal } from './terminal.js';
import { apiPost } from './navigation.js';
import { setSiteBaseUrl } from './recipe-list.js';

export async function fetchStatus() {
    try {
        const resp = await fetch('/api/status');
        const status = await resp.json();

        if (status.siteUrl) setSiteBaseUrl(status.siteUrl);

        const pills = document.getElementById('statusPills');
        if (!pills) return;
        
        const hasTesto = status.hasAnthropic || status.hasGemini;
        const hasImmaginiGen = status.hasGemini; 
        const hasRicercaFoto = status.hasPexels || status.hasUnsplash || status.hasPixabay || true; 
        const hasSEO = status.hasSerpApi || status.hasDataForSeo;

        pills.innerHTML = [
            hasTesto ? '<span class="pill active"><i data-lucide="bot"></i> AI Testuale</span>' : '<span class="pill"><i data-lucide="bot"></i> No AI Testuale</span>',
            hasImmaginiGen ? '<span class="pill active"><i data-lucide="image-plus"></i> Creazione Immagini</span>' : '',
            hasRicercaFoto ? '<span class="pill active"><i data-lucide="images"></i> Ricerca Immagini</span>' : '',
            hasSEO ? '<span class="pill active"><i data-lucide="bar-chart-2"></i> Ricerca SEO</span>' : '',
        ].filter(Boolean).join('');
        
        if (window.lucide) lucide.createIcons();

        const providerCount = [hasTesto, hasImmaginiGen, hasRicercaFoto, hasSEO].filter(Boolean).length;
        const provEl = document.getElementById('stat-provider');
        if (provEl) provEl.textContent = providerCount;

        if (status.hasGemini2) {
            fetchGeminiKeyStatus();
        }
    } catch {}
}

export async function fetchGeminiKeyStatus() {
    try {
        const resp = await fetch('/api/gemini-key');
        const data = await resp.json();

        const switcher = document.getElementById('geminiKeySwitcher');
        if (!switcher) return;

        if (data.hasKey1 && data.hasKey2) {
            switcher.style.display = '';
        } else {
            switcher.style.display = 'none';
            return;
        }

        const p1 = document.getElementById('keyPreview1');
        const p2 = document.getElementById('keyPreview2');
        if (p1) p1.textContent = data.key1Preview || '';
        if (p2) p2.textContent = data.key2Preview || '';

        switcher.querySelectorAll('.key-btn').forEach(btn => {
            const slot = parseInt(btn.dataset.slot);
            btn.classList.toggle('active', slot === data.activeSlot);
        });
    } catch {}
}

export async function switchGeminiKey(slot) {
    try {
        const resp = await fetch('/api/gemini-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slot }),
        });
        const data = await resp.json();

        if (data.ok) {
            appendTerminal(`🔑 ${data.message}`, 'success');
            fetchGeminiKeyStatus();
            fetchStatus(); 
        } else {
            appendTerminal(`❌ ${data.error}`, 'stderr');
        }
    } catch (err) {
        appendTerminal(`❌ Errore switch key: ${err.message}`, 'stderr');
    }
}

export async function loadStats() {
    try {
        const resp = await fetch('/api/ricette');
        const recipes = await resp.json();

        const elRic = document.getElementById('stat-ricette');
        if (elRic) elRic.textContent = recipes.length;

        const categories = new Set(recipes.map(r => r.category).filter(Boolean));
        const elCat = document.getElementById('stat-categorie');
        if (elCat) elCat.textContent = categories.size;

        const withImage = recipes.filter(r => r.image).length;
        const elImg = document.getElementById('stat-immagini');
        if (elImg) elImg.textContent = withImage;
    } catch {}

    loadUsedImagesCount();
}

export async function loadUsedImagesCount() {
    const elUsed = document.getElementById('stat-used-images');
    if (!elUsed) return;
    try {
        const resp = await fetch('/api/used-images');
        const data = await resp.json();
        elUsed.textContent = data.count;
    } catch {
        elUsed.textContent = '?';
    }
}

export function showUsedImagesMenu(anchorEl) {
    document.querySelector('.used-images-dropdown')?.remove();

    const rect = anchorEl.getBoundingClientRect();
    const dd = document.createElement('div');
    dd.className = 'used-images-dropdown cat-dropdown';
    dd.style.top = `${rect.bottom + 4}px`;
    dd.style.left = `${rect.left}px`;
    dd.style.minWidth = '220px';

    dd.innerHTML = `
        <button class="cat-dropdown-item" data-action="rebuild-images">
            <i data-lucide="database"></i> 🔄 Ricostruisci da ricette
        </button>
        <button class="cat-dropdown-item cat-dropdown-danger" data-action="reset-images">
            <i data-lucide="trash-2"></i> 🗑️ Reset (svuota tutto)
        </button>
    `;
    
    dd.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        dd.remove();
        if (btn.dataset.action === 'rebuild-images') rebuildUsedImages();
        else if (btn.dataset.action === 'reset-images') resetUsedImages();
    });

    document.body.appendChild(dd);
    if (window.lucide) lucide.createIcons();

    setTimeout(() => {
        document.addEventListener('click', function closeDD(e) {
            if (!dd.contains(e.target) && !anchorEl.contains(e.target)) {
                dd.remove();
                document.removeEventListener('click', closeDD);
            }
        });
    }, 10);
}

export async function resetUsedImages() {
    showCustomConfirm('⚠️ Resettare l\'index delle immagini usate?\n\nTutte le immagini saranno considerate "nuove" e potranno essere riproposte.', async () => {
        try {
            const resp = await fetch('/api/used-images/reset', { method: 'POST' });
            const data = await resp.json();
            appendTerminal(`\n🗑️ Used Images: index resettato (${data.count} entries)`, 'success');
            showToast('Index immagini resettato', 'success');
            loadUsedImagesCount();
        } catch (err) {
            appendTerminal(`❌ Reset fallito: ${err.message}`, 'stderr');
            showToast('Reset fallito', 'error');
        }
    });
}

export async function rebuildUsedImages() {
    appendTerminal('\n🔄 Ricostruzione index immagini da ricette esistenti...', 'job-start');
    await apiPost('used-images/rebuild', {});
    setTimeout(() => loadUsedImagesCount(), 2000);
}

// Global expose — only for cross-module usage
window.rebuildUsedImages = rebuildUsedImages;

