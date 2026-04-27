/**
 * DASHBOARD — SEO Ideas Panel
 * 
 * Recupero e visualizzazione suggerimenti SEO da Google Autocomplete/DataForSEO.
 */

import { showToast } from './toast.js';
import { navigateToPanel } from './navigation.js';

let currentSeoCategory = 'Pane';
let seoLoading = false;

export async function loadSeoSuggestions(category, forceRefresh = false) {
    category = category || currentSeoCategory;
    currentSeoCategory = category;
    
    const grid = document.getElementById('seoGrid');
    const countEl = document.getElementById('seoCount');
    const sourceEl = document.getElementById('seoSource');
    if (!grid) return;

    seoLoading = true;

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
        if (countEl) countEl.textContent = `${newCount} nuove / ${suggestions.length} totali`;

        const hasDataForSeo = suggestions.some(s => s.source === 'dataforseo');
        if (sourceEl) {
            sourceEl.textContent = hasDataForSeo
                ? 'Fonte: DataForSEO (volumi reali) + Google Autocomplete'
                : 'Fonte: Google Autocomplete via SerpAPI';
        }

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
                        ? '<span class="seo-card-existing">Già nel Ricettario</span>'
                        : `<button class="seo-gen-btn" data-action="generate-seo" data-keyword="${escapeHtml(s.keyword)}" data-category="${s.category}">
                            🔥 Genera
                           </button>`
                    }
                </div>
            </div>
        `;
    }).join('');
    
    // Event delegation for generate buttons
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="generate-seo"]');
        if (btn) generateFromSeo(btn.dataset.keyword, btn.dataset.category);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export async function generateFromSeo(keyword, category) {
    const nomeEl = document.getElementById('gen-nome');
    if (nomeEl) nomeEl.value = keyword;

    const tipoSelect = document.getElementById('gen-tipo');
    if (category && tipoSelect) {
        const option = Array.from(tipoSelect.options).find(o => o.value === category);
        if (option) tipoSelect.value = category;
    }

    navigateToPanel('genera');
    showToast(`📝 "${keyword}" pronta per la generazione!`, 'info');
}

export function initSeoPanel() {
    document.getElementById('seoTabs')?.addEventListener('click', (e) => {
        const tab = e.target.closest('.seo-tab');
        if (!tab) return;
        const category = tab.dataset.category;
        if (category === currentSeoCategory && !seoLoading) return;

        document.querySelectorAll('.seo-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        loadSeoSuggestions(category);
    });
}

// Global expose — only for cross-module usage
window.loadSeoSuggestions = loadSeoSuggestions;

