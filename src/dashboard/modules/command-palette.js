/**
 * DASHBOARD — Command Palette
 * 
 * Interfaccia di comandi rapidi (Ctrl+K).
 */

import { showToast } from './toast.js';
import { clearTerminal } from './terminal.js';
import { runQualita } from './qa-tools.js';
import { runSyncCards } from './qa-tools.js';
import { rebuildUsedImages, resetUsedImages } from './stats.js';

const commands = [
    { icon: 'plus-circle', name: 'Crea Ricetta da Nome', panel: 'genera' },
    { icon: 'link', name: 'Importa da URL', panel: 'url' },
    { icon: 'file-text', name: 'Crea da Testo', panel: 'testo' },
    { icon: 'search', name: 'Scopri Ricette', panel: 'scopri' },
    { icon: 'book-open', name: 'Le mie Ricette', panel: 'ricette' },
    { icon: 'image', name: 'Image Picker', panel: 'immagini' },
    { icon: 'shield-check', name: 'Qualità Ricette', action: () => runQualita() },
    { icon: 'globe', name: 'Qualità + Web', action: () => runQualita(true) },
    { icon: 'refresh-cw', name: 'Sync Cards', action: () => runSyncCards() },
    { icon: 'database', name: 'Ricostruisci Index Immagini', action: () => rebuildUsedImages() },
    { icon: 'image-off', name: 'Reset Index Immagini', action: () => resetUsedImages() },
    { icon: 'trash-2', name: 'Pulisci Terminal', action: () => clearTerminal() },
];

let cmdSelectedIdx = 0;

export function openCommandPalette() {
    const overlay = document.getElementById('commandPalette');
    if (!overlay) return;
    overlay.classList.add('active');
    const input = document.getElementById('cmdInput');
    input.value = '';
    input.focus();
    cmdSelectedIdx = 0;
    renderCommands('');
}

export function closeCommandPalette() {
    document.getElementById('commandPalette')?.classList.remove('active');
}

function renderCommands(filter) {
    const results = document.getElementById('cmdResults');
    if (!results) return;
    const filtered = filter
        ? commands.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()))
        : commands;

    cmdSelectedIdx = Math.min(cmdSelectedIdx, Math.max(0, filtered.length - 1));

    results.innerHTML = filtered.map((cmd, i) => `
        <div class="command-item${i === cmdSelectedIdx ? ' selected' : ''}"
             onmouseenter="window.cmdHoverIdx(${i}, '${filter.replace(/'/g, "\\'")}')"
             onclick="window.executeCommand(${commands.indexOf(cmd)})">
            <span class="command-item-icon"><i data-lucide="${cmd.icon}"></i></span>
            <span class="command-item-name">${cmd.name}</span>
        </div>
    `).join('');
    if (window.lucide) lucide.createIcons();
}

window.cmdHoverIdx = function(idx, filter) {
    cmdSelectedIdx = idx;
    renderCommands(filter);
};

window.executeCommand = function(idx) {
    const cmd = commands[idx];
    closeCommandPalette();

    if (cmd.panel) {
        const navItem = document.querySelector(`[data-panel="${cmd.panel}"]`);
        if (navItem) navItem.click();
    }

    if (cmd.action) {
        cmd.action();
    }

    showToast(`${cmd.icon} ${cmd.name}`, 'info');
};

export function initCommandPalette() {
    document.getElementById('cmdInput')?.addEventListener('input', (e) => {
        cmdSelectedIdx = 0;
        renderCommands(e.target.value);
    });

    document.getElementById('cmdInput')?.addEventListener('keydown', (e) => {
        const filter = e.target.value;
        const filtered = filter
            ? commands.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()))
            : commands;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            cmdSelectedIdx = Math.min(cmdSelectedIdx + 1, filtered.length - 1);
            renderCommands(filter);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            cmdSelectedIdx = Math.max(cmdSelectedIdx - 1, 0);
            renderCommands(filter);
        } else if (e.key === 'Enter' && filtered.length > 0) {
            e.preventDefault();
            window.executeCommand(commands.indexOf(filtered[cmdSelectedIdx]));
        } else if (e.key === 'Escape') {
            closeCommandPalette();
        }
    });

    document.getElementById('commandPalette')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('command-palette-overlay')) closeCommandPalette();
    });

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            openCommandPalette();
        }
    });
}
