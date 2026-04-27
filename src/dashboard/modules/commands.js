/**
 * DASHBOARD — Recipe Commands
 * 
 * Comandi di creazione ricette: Genera da Nome, URL, Testo, Scopri.
 */

import { showToast } from './toast.js';
import { apiPost, navigateToPanel } from './navigation.js';
import { appendTerminal } from './terminal.js';

export async function runGenera() {
    const btn = document.getElementById('btn-run-genera');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Avvio...'; lucide?.createIcons?.(); }

    const nome = document.getElementById('gen-nome').value.trim();
    if (!nome) {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="wand-2"></i> Genera Ricetta'; lucide?.createIcons?.(); }
        return showToast('Inserisci il nome della ricetta', 'warning');
    }

    await apiPost('genera', {
        nome,
        tipo: document.getElementById('gen-tipo').value,
        note: document.getElementById('gen-note').value,
        noImage: document.getElementById('gen-noimage').checked,
        keepExisting: document.getElementById('gen-keep').checked,
        aiModel: document.getElementById('gen-model').value,
    });
    
    setTimeout(() => {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="wand-2"></i> Genera Ricetta'; lucide?.createIcons?.(); }
    }, 1000);
}

export async function runUrl() {
    const url = document.getElementById('url-input').value.trim();
    if (!url) return showToast('Inserisci un URL', 'warning');

    await apiPost('genera', {
        url,
        tipo: document.getElementById('url-tipo').value,
        aiModel: document.getElementById('url-model').value,
    });
}

export async function runTesto() {
    const text = document.getElementById('testo-input').value.trim();
    if (!text) return showToast('Inserisci il testo della ricetta', 'warning');

    await apiPost('testo', {
        text,
        tipo: document.getElementById('testo-tipo').value,
        aiModel: document.getElementById('testo-model').value,
    });
}

export async function runScopri() {
    const query = document.getElementById('scopri-query').value.trim();
    if (!query) return showToast('Inserisci una query di ricerca', 'warning');

    const quante = document.getElementById('scopri-quante').value;
    const btn = document.getElementById('btn-run-scopri');
    const orgHtml = btn.innerHTML;
    const container = document.getElementById('scopri-results-container');

    btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Ricerca in corso...';
    btn.disabled = true;
    container.innerHTML = '';

    try {
        const resp = await fetch('/api/scopri-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, quante })
        });
        const data = await resp.json();

        if (data.error) throw new Error(data.error);
        renderScopriResults(data.results || []);
    } catch (e) {
        container.innerHTML = `<div class="feedback-error">Errore: ${e.message}</div>`;
    } finally {
        btn.innerHTML = orgHtml;
        btn.disabled = false;
        lucide.createIcons();
    }
}

function renderScopriResults(results) {
    const container = document.getElementById('scopri-results-container');
    if (!results || results.length === 0) {
        container.innerHTML = '<div class="feedback-empty">Nessun risultato trovato.</div>';
        return;
    }

    let html = `<div class="scopri-results">`;
    results.forEach((r, idx) => {
        html += `
            <label class="scopri-card">
                <input type="checkbox" class="scopri-checkbox" value="${r.url}" checked>
                <div class="scopri-card-body">
                    <div class="scopri-card-title">${r.title}</div>
                    <div class="scopri-card-source">${r.source}</div>
                    <div class="scopri-card-snippet">${r.snippet}</div>
                </div>
            </label>
        `;
    });
    html += `</div>
    <div class="scopri-actions">
        <button class="btn btn-primary btn-full-width" data-action="generate-scopri">
            <i data-lucide="wand-2"></i> Genera Selezionate
        </button>
    </div>`;

    container.innerHTML = html;
    
    // Event delegation instead of onclick
    container.querySelector('[data-action="generate-scopri"]')
        ?.addEventListener('click', generateSelectedScopri);
    
    lucide.createIcons();
}

export async function generateSelectedScopri() {
    const checkboxes = document.querySelectorAll('.scopri-checkbox:checked');
    const urls = Array.from(checkboxes).map(cb => cb.value);

    if (urls.length === 0) {
        return showToast('Seleziona almeno un link da generare.', 'warning');
    }

    const btn = document.querySelector('[data-action="generate-scopri"]');
    if (btn) {
        btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Avvio generazione...';
        btn.disabled = true;
    }

    try {
        await apiPost('genera', { urls });
    } catch (e) {
        showToast('Errore in accodamento job: ' + e.message, 'error');
    } finally {
        document.getElementById('scopri-results-container').innerHTML = '';
        showToast(`Batch job avviato per ${urls.length} ricette.`, 'success');
    }
}

// Global expose — only for cross-module usage
window.generateSelectedScopri = generateSelectedScopri;

