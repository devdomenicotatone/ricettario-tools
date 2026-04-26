/**
 * DASHBOARD — Recipe Commands
 * 
 * Comandi di creazione ricette: Genera da Nome, URL, Testo, Scopri.
 */

import { showToast } from './toast.js';
import { apiPost, navigateToPanel } from './navigation.js';
import { appendTerminal } from './terminal.js';

export async function runGenera() {
    const btn = document.getElementById('btn-run-genera') || document.querySelector('button[onclick="runGenera()"]');
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
        container.innerHTML = `<div style="color:var(--danger); padding:10px;">Errore: ${e.message}</div>`;
    } finally {
        btn.innerHTML = orgHtml;
        btn.disabled = false;
        lucide.createIcons();
    }
}

function renderScopriResults(results) {
    const container = document.getElementById('scopri-results-container');
    if (!results || results.length === 0) {
        container.innerHTML = '<div style="padding:15px;color:var(--text-muted)">Nessun risultato trovato.</div>';
        return;
    }

    let html = `<div class="scopri-results" style="margin-top:20px;display:flex;flex-direction:column;gap:10px;">`;
    results.forEach((r, idx) => {
        html += `
            <label class="scopri-card" style="display:flex; gap:12px; padding:12px; background:var(--bg-elevated); border:1px solid var(--border); border-radius:8px; cursor:pointer; align-items:flex-start;">
                <input type="checkbox" class="scopri-checkbox" value="${r.url}" style="margin-top:4px;" checked>
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:600; font-size:14px; margin-bottom:4px; color:var(--text-primary);">${r.title}</div>
                    <div style="font-size:11px; color:var(--accent); margin-bottom:6px;">${r.source}</div>
                    <div style="font-size:12px; color:var(--text-secondary); line-height:1.4;">${r.snippet}</div>
                </div>
            </label>
        `;
    });
    html += `</div>
    <div style="margin-top:16px;">
        <button class="btn btn-primary" onclick="generateSelectedScopri()" style="width:100%;">
            <i data-lucide="wand-2"></i> Genera Selezionate
        </button>
    </div>`;

    container.innerHTML = html;
    lucide.createIcons();
}

export async function generateSelectedScopri() {
    const checkboxes = document.querySelectorAll('.scopri-checkbox:checked');
    const urls = Array.from(checkboxes).map(cb => cb.value);

    if (urls.length === 0) {
        return showToast('Seleziona almeno un link da generare.', 'warning');
    }

    const btn = document.querySelector('button[onclick="generateSelectedScopri()"]');
    btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Avvio generazione...';
    btn.disabled = true;

    try {
        await apiPost('genera', { urls });
    } catch (e) {
        showToast('Errore in accodamento job: ' + e.message, 'error');
    } finally {
        document.getElementById('scopri-results-container').innerHTML = '';
        showToast(`Batch job avviato per ${urls.length} ricette.`, 'success');
    }
}

// Expose globally for onclick in HTML
window.runGenera = runGenera;
window.runUrl = runUrl;
window.runTesto = runTesto;
window.runScopri = runScopri;
window.generateSelectedScopri = generateSelectedScopri;
