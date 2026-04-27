/**
 * DASHBOARD — Orchestrator
 * 
 * Entry point per l'interfaccia di gestione del Ricettario.
 */

import { initNavigation, restorePanelFromHash } from './modules/navigation.js';
import { connectWebSocket, setWsMessageHandler, restoreTerminalState, toggleTerminal, toggleTerminalPin, toggleExpandTerminal, clearTerminal } from './modules/terminal.js';
import { fetchStatus, loadStats, switchGeminiKey, showUsedImagesMenu } from './modules/stats.js';
import { loadRecipes, initRecipeFilters } from './modules/recipe-list.js';
import { initImageModal, loadRecipesForPicker, closeImageModal } from './modules/image-picker.js';
import { initQualityModal, closeQualityModal } from './modules/quality-modal.js';
import { initCommandPalette } from './modules/command-palette.js';
import { initSeoPanel, loadSeoSuggestions } from './modules/seo.js';
import { initDragAndDrop } from './modules/drag-drop.js';
import { runGenera, runUrl, runTesto, runScopri } from './modules/commands.js';

// ── Inizializzazione ──
document.addEventListener('DOMContentLoaded', () => {
    // 1. Setup UI & Navigation
    initNavigation();
    restorePanelFromHash();
    restoreTerminalState();
    
    // 2. Inizializza filtri e drag & drop ricette
    initRecipeFilters();
    initDragAndDrop();

    // 3. Inizializza modali e pannelli
    initImageModal();
    initQualityModal();
    initCommandPalette();
    initSeoPanel();

    // 4. Connessione WS & Eventi Server
    setWsMessageHandler((data) => {
        if (data.type === 'job:end') {
            if (data.success) {
                window.showToast('Operazione completata con successo!', 'success');
            } else {
                window.showToast('Operazione fallita — controlla il terminal', 'error');
            }
            loadStats();
            loadRecipes();
        } else if (data.type === 'connected') {
            fetchStatus();
        }
    });
    connectWebSocket();

    // 5. Caricamento dati iniziali
    fetchStatus();
    loadStats();
    loadRecipes();
    loadRecipesForPicker();
    
    // Support per select picker
    document.querySelector('[data-panel="immagini"]')?.addEventListener('click', loadRecipesForPicker);

    // ══════════════════════════════════════════════════
    //  6. Static HTML event bindings (replaces onclick)
    // ══════════════════════════════════════════════════
    
    // Gemini key switcher
    document.querySelectorAll('.key-btn[data-slot]').forEach(btn => {
        btn.addEventListener('click', () => switchGeminiKey(parseInt(btn.dataset.slot)));
    });

    // Used images menu
    document.querySelector('.stat-card-clickable')?.addEventListener('click', function() {
        showUsedImagesMenu(this);
    });

    // Generation buttons
    document.getElementById('btn-run-genera')?.addEventListener('click', runGenera);
    document.getElementById('btn-run-url')?.addEventListener('click', runUrl);
    document.getElementById('btn-run-testo')?.addEventListener('click', runTesto);
    document.getElementById('btn-run-scopri')?.addEventListener('click', runScopri);
    
    // Refresh recipes
    document.querySelector('[data-panel="ricette"] .btn-icon')?.addEventListener('click', loadRecipes);
    
    // SEO refresh
    document.getElementById('seoRefreshBtn')?.addEventListener('click', () => loadSeoSuggestions(null, true));

    // Terminal header & actions
    document.querySelector('.terminal-header')?.addEventListener('click', toggleTerminal);
    document.querySelectorAll('.terminal-actions .terminal-btn').forEach(btn => {
        const title = btn.getAttribute('title') || '';
        if (title.includes('Pin')) {
            btn.addEventListener('click', (e) => { e.stopPropagation(); toggleTerminalPin(); });
        } else if (title.includes('Espandi')) {
            btn.addEventListener('click', (e) => { e.stopPropagation(); toggleExpandTerminal(); });
        } else if (title.includes('Pulisci')) {
            btn.addEventListener('click', (e) => { e.stopPropagation(); clearTerminal(); });
        } else if (title.includes('Minimizza')) {
            btn.addEventListener('click', (e) => { e.stopPropagation(); toggleTerminal(); });
        }
    });

    // Modal close buttons
    document.querySelector('#imageModal .modal-close')?.addEventListener('click', closeImageModal);
    document.querySelector('#qualityModal .modal-close')?.addEventListener('click', closeQualityModal);
});

