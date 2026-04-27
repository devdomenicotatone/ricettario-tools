/**
 * DASHBOARD — Toast & Confirm Dialogs
 * 
 * Notifiche toast e dialog di conferma custom.
 */

// ── Toast Notifications ──
export function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const icons = { success: 'check-circle', error: 'x-circle', warning: 'alert-triangle', info: 'info' };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon"><i data-lucide="${icons[type] || 'message-circle'}"></i></span>
        <span class="toast-text">${message}</span>
    `;
    container.appendChild(toast);
    lucide.createIcons({ attrs: { 'width': 18, 'height': 18 } });

    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ── Custom Confirm Modal ──
export function showCustomConfirm(message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay confirm-overlay active';
    
    overlay.innerHTML = `
        <div class="confirm-box">
            <div class="confirm-message">${message}</div>
            <div class="confirm-actions">
                <button class="btn btn-secondary" data-action="confirm-cancel">Annulla</button>
                <button class="btn btn-primary" data-action="confirm-ok">Ok</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const close = () => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 300);
    };

    overlay.querySelector('[data-action="confirm-cancel"]').addEventListener('click', close);
    overlay.querySelector('[data-action="confirm-ok"]').addEventListener('click', () => {
        close();
        if (onConfirm) onConfirm();
    });
}

// Expose globally for onclick handlers in HTML
window.showToast = showToast;
window.showCustomConfirm = showCustomConfirm;
