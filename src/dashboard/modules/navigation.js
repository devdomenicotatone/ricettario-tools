/**
 * DASHBOARD — Navigation & Shared Utilities
 * 
 * Sidebar navigation, panel switching, API helpers, running state.
 */

import { showToast } from './toast.js';

// ── Running state (Deprecato: uso concorrente) ──
export let isRunning = false;
export function setRunning(running) { isRunning = running; }

// ── Panel Titles ──
const panelTitles = {
    genera: 'Crea Ricetta da Nome',
    url: 'Importa Ricetta da URL',
    testo: 'Converti Testo in Ricetta',
    scopri: 'Scopri Ricette Online',
    ricette: 'Le mie Ricette',
    immagini: 'Image Picker',
    seo: 'SEO Ideas — Suggerimenti Ricette',
    valida: 'Validazione Ricette',
    verifica: 'Verifica Qualità AI',
    sync: 'Sincronizza Cards',
};

/** Callbacks da chiamare quando si naviga a un pannello specifico */
const panelLoadCallbacks = {};

export function onPanelLoad(panel, callback) {
    panelLoadCallbacks[panel] = callback;
}

/**
 * Navigazione centralizzata: aggiorna sidebar, panel, titolo, hash URL e carica dati
 */
export function navigateToPanel(panel) {
    if (!panel) return;

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navBtn = document.querySelector(`[data-panel="${panel}"]`);
    if (navBtn) navBtn.classList.add('active');

    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const panelEl = document.getElementById(`panel-${panel}`);
    if (panelEl) panelEl.classList.add('active');

    document.getElementById('panelTitle').textContent = panelTitles[panel] || '';
    history.replaceState(null, '', `#${panel}`);

    // Trigger panel load callback if registered
    if (panelLoadCallbacks[panel]) panelLoadCallbacks[panel]();
}

export function restorePanelFromHash() {
    const hash = location.hash.replace('#', '');
    if (hash && panelTitles[hash]) {
        navigateToPanel(hash);
    }
}

export function navigateAndRun(panel, action) {
    navigateToPanel(panel);
    if (panelLoadCallbacks[panel]) {
        const origCallback = panelLoadCallbacks[panel];
        panelLoadCallbacks[panel] = () => { origCallback(); if (action) action(); };
    } else {
        if (action) action();
    }
}

// ── API Calls ──
export async function apiPost(endpoint, body) {
    const resp = await fetch(`/api/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return resp.json();
}

// ── Init navigation ──
export function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const panel = item.dataset.panel;
            navigateToPanel(panel);
        });
    });

    // Slider values
    document.querySelectorAll('.form-range').forEach(slider => {
        const valId = slider.id + '-val';
        const valEl = document.getElementById(valId);
        if (valEl) {
            slider.addEventListener('input', () => {
                valEl.textContent = slider.id.includes('quante') ? slider.value : slider.value + '%';
            });
        }
    });

    // Handle browser back/forward
    window.addEventListener('hashchange', () => {
        const hash = location.hash.replace('#', '');
        if (hash && panelTitles[hash]) {
            navigateToPanel(hash);
        }
    });
}

// Expose globally
window.navigateToPanel = navigateToPanel;
window.navigateAndRun = navigateAndRun;
window.apiPost = apiPost;
window.setRunning = setRunning;
