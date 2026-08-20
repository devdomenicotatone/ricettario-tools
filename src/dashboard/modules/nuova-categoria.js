/**
 * NUOVA CATEGORIA — creazione di una categoria senza ricette di mezzo.
 *
 * Il percorso storico sta nel dropdown sul badge di una card (recipe-list.js):
 * lì "Nuova categoria..." crea E POI SPOSTA la ricetta della card nella
 * categoria appena nata — coerente per un menu che si chiama "cambia
 * categoria", una sorpresa per chi voleva soltanto creare la categoria.
 * Questo modulo è il punto d'ingresso neutro: stesso endpoint
 * (/api/aggiungi-categoria, con l'AI che genera emoji/colore/SEO), nessuno
 * slug coinvolto, nessuno spostamento.
 */

import { showToast } from './toast.js';
import { refreshCategorieUI } from './categorie-ui.js';
import { syncRegistroCategorie } from './recipe-list.js';

/**
 * L'endpoint risponde subito con {jobId} e lavora in background (log nel
 * terminal via WebSocket): "creata davvero" lo sa solo chi ascolta la fine del
 * job. terminal.js rilancia job:end come CustomEvent 'ws:job-end' proprio per
 * attese puntuali come questa. Il timeout evita listener orfani se il WS è
 * giù: si risolve a null e l'aggiornamento arriverà col prossimo reload.
 */
function attendiFineJob(jobId, timeoutMs = 180000) {
    return new Promise((risolvi) => {
        const pulisci = () => {
            clearTimeout(timer);
            document.removeEventListener('ws:job-end', alTermine);
        };
        const alTermine = (e) => {
            if (e.detail?.jobId !== jobId) return;
            pulisci();
            risolvi(!!e.detail.success);
        };
        const timer = setTimeout(() => { pulisci(); risolvi(null); }, timeoutMs);
        document.addEventListener('ws:job-end', alTermine);
    });
}

async function creaCategoria(nome, onCreated) {
    const resp = await fetch('/api/aggiungi-categoria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nome }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    showToast(`Categoria "${nome}" in creazione...`, 'success');

    // Toast di esito e loadRecipes() li fa già il gestore generico di job:end
    // (dashboard.js): qui resta solo ciò che quel gestore non sa fare.
    const esito = await attendiFineJob(data.jobId);
    if (esito !== true) return;

    // Registry del sito riletto da disco: tendine dei form, tab SEO e mappe
    // della lista ricette vedono la categoria nuova senza ricaricare la pagina.
    const registry = await refreshCategorieUI();
    if (registry) syncRegistroCategorie(registry);
    onCreated?.(nome);
}

export function showNuovaCategoriaPopup(anchorEl, { onCreated } = {}) {
    document.querySelector('.cat-dropdown')?.remove();
    const rect = anchorEl.getBoundingClientRect();
    const dd = document.createElement('div');
    dd.className = 'cat-dropdown';
    dd.style.top = `${rect.bottom + 4}px`;
    // Ancorato a sinistra del bottone, ma senza sforare il bordo destro:
    // i "+" dei form stanno a fine riga, dove 260px non sempre ci stanno.
    dd.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 260))}px`;
    dd.style.minWidth = '240px';

    dd.innerHTML = `
        <div class="cat-dropdown-form" style="display:flex">
            <input type="text" class="cat-dropdown-input" placeholder="Nome nuova categoria..." maxlength="30">
            <button class="cat-dropdown-submit" data-action="conferma" title="Crea categoria">
                <i data-lucide="check"></i>
            </button>
        </div>`;

    document.body.appendChild(dd);
    if (window.lucide) lucide.createIcons();
    const input = dd.querySelector('.cat-dropdown-input');
    setTimeout(() => input.focus(), 50);

    const conferma = () => {
        const nome = input.value.trim();
        if (!nome) {
            input.classList.add('shake');
            setTimeout(() => input.classList.remove('shake'), 500);
            return;
        }
        // Il popup si chiude subito: il seguito vive nel terminal e nei toast.
        dd.remove();
        creaCategoria(nome, onCreated).catch(err => showToast(`Errore: ${err.message}`, 'error'));
    };

    dd.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="conferma"]')) conferma();
    });
    dd.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); conferma(); }
        if (e.key === 'Escape') dd.remove();
    });
    setTimeout(() => {
        document.addEventListener('click', function chiudi(e) {
            if (!dd.contains(e.target)) {
                dd.remove();
                document.removeEventListener('click', chiudi);
            }
        });
    }, 10);
}

/**
 * Aggancia i pulsantini "+" accanto alle tendine categoria dei form di
 * creazione (Da Nome / Da URL / Da Testo): creata la categoria, la tendina
 * del form si posiziona su di lei, pronta per generarci dentro la ricetta.
 */
export function initNuovaCategoriaButtons() {
    document.querySelectorAll('.btn-nuova-categoria[data-target-select]').forEach(btn => {
        btn.addEventListener('click', () => {
            showNuovaCategoriaPopup(btn, {
                onCreated: (nome) => {
                    const sel = document.getElementById(btn.dataset.targetSelect);
                    if (sel) sel.value = nome;
                },
            });
        });
    });
}
