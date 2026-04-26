/**
 * DASHBOARD — Orchestrator
 * 
 * Entry point per l'interfaccia di gestione del Ricettario.
 */

import { initNavigation, restorePanelFromHash } from './modules/navigation.js';
import { connectWebSocket, setWsMessageHandler, restoreTerminalState } from './modules/terminal.js';
import { fetchStatus, loadStats } from './modules/stats.js';
import { loadRecipes, initRecipeFilters } from './modules/recipe-list.js';
import { initImageModal, loadRecipesForPicker } from './modules/image-picker.js';
import { initQualityModal } from './modules/quality-modal.js';
import { initCommandPalette } from './modules/command-palette.js';
import { initSeoPanel } from './modules/seo.js';
import { initDragAndDrop } from './modules/drag-drop.js';

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
});
