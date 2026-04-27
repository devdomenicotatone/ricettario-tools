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

// ── Delete Category Confirm Modal (with destination picker) ──
export function showDeleteCategoryConfirm(categoryName, recipeCount, otherCategories, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay confirm-overlay active';

    const options = otherCategories.map(c =>
        `<option value="${c}">${c}</option>`
    ).join('');

    overlay.innerHTML = `
        <div class="confirm-box confirm-delete-cat">
            <div class="confirm-message">
                <strong>🗑️ Eliminare la categoria "${categoryName}"?</strong>
                ${recipeCount > 0 ? `<p class="confirm-recipe-count">Contiene <strong>${recipeCount}</strong> ricett${recipeCount === 1 ? 'a' : 'e'}</p>` : '<p class="confirm-recipe-count confirm-empty">Nessuna ricetta al suo interno</p>'}
            </div>
            ${recipeCount > 0 ? `
            <div class="confirm-move-section">
                <div class="confirm-action-choice">
                    <label>
                        <input type="radio" name="cat-action" value="move" checked>
                        Sposta ricette in:
                    </label>
                    <select class="confirm-move-select" data-field="moveTo">
                        ${options}
                    </select>
                </div>
                <div class="confirm-action-choice delete-choice">
                    <label>
                        <input type="radio" name="cat-action" value="delete">
                        <span class="text-danger">🗑️ Elimina anche tutte le ricette</span>
                    </label>
                </div>
            </div>` : ''}
            <div class="confirm-info">
                <i data-lucide="archive"></i>
                <span>La cartella originale e il suo contenuto verranno comunque salvati in backup per sicurezza.</span>
            </div>
            <div class="confirm-actions">
                <button class="btn btn-secondary" data-action="confirm-cancel">Annulla</button>
                <button class="btn btn-danger" data-action="confirm-delete">
                    <i data-lucide="trash-2"></i> Elimina
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    if (window.lucide) lucide.createIcons();

    // Toggle select disabled state based on radio
    const radios = overlay.querySelectorAll('input[name="cat-action"]');
    const select = overlay.querySelector('[data-field="moveTo"]');
    radios.forEach(r => r.addEventListener('change', () => {
        if (select) select.disabled = (r.value === 'delete');
    }));

    const close = () => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 300);
    };

    overlay.querySelector('[data-action="confirm-cancel"]').addEventListener('click', close);
    overlay.querySelector('[data-action="confirm-delete"]').addEventListener('click', () => {
        let moveTo = null;
        if (recipeCount > 0) {
            const actionNode = overlay.querySelector('input[name="cat-action"]:checked');
            if (actionNode && actionNode.value === 'move' && select) {
                moveTo = select.value;
            }
        }
        close();
        if (onConfirm) onConfirm(moveTo);
    });
}

// Expose globally for onclick handlers in HTML
window.showToast = showToast;
window.showCustomConfirm = showCustomConfirm;
window.showDeleteCategoryConfirm = showDeleteCategoryConfirm;
