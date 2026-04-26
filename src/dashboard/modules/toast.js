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
    overlay.className = 'modal-overlay active';
    overlay.style.zIndex = '9999';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    
    overlay.innerHTML = `
        <div class="modal-content" style="max-width: 400px; padding: 24px; text-align: center; border-radius: 12px; background: var(--bg-elevated); box-shadow: 0 10px 25px rgba(0,0,0,0.5); border: 1px solid var(--border);">
            <div style="margin-bottom: 24px; color: var(--text-primary); font-size: 15px; white-space: pre-wrap; line-height: 1.5; font-weight: 500;">${message}</div>
            <div style="display: flex; gap: 12px; justify-content: center;">
                <button class="btn btn-secondary" id="btnConfirmCancel" style="min-width: 100px;">Annulla</button>
                <button class="btn btn-primary" id="btnConfirmOk" style="min-width: 100px;">Ok</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const close = () => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 300);
    };

    overlay.querySelector('#btnConfirmCancel').addEventListener('click', close);
    overlay.querySelector('#btnConfirmOk').addEventListener('click', () => {
        close();
        if (onConfirm) onConfirm();
    });
}

// Expose globally for onclick handlers in HTML
window.showToast = showToast;
window.showCustomConfirm = showCustomConfirm;
