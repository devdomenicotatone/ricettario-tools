/**
 * DASHBOARD — Escape HTML condiviso
 *
 * Unica fonte per la neutralizzazione del testo che finisce in `innerHTML`.
 * Esisteva già una `escapeHtml` in `seo.js`, ma passava per
 * `div.textContent -> div.innerHTML`: quella variante NON tocca gli apici,
 * quindi dentro un attributo (`data-keyword="..."`) un doppio apice nel testo
 * chiude l'attributo e apre la porta a codice arbitrario.
 *
 * Qui si scappa anche `"` e `'`, così la stessa funzione è sicura sia nel
 * testo sia dentro gli attributi.
 */

const MAPPA = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

/**
 * Neutralizza il testo per l'inserimento in HTML (testo e attributi).
 * Accetta qualsiasi cosa: `null`/`undefined` diventano stringa vuota.
 */
export function escapeHtml(valore) {
    if (valore === null || valore === undefined) return '';
    return String(valore).replace(/[&<>"']/g, (c) => MAPPA[c]);
}

/** Alias esplicito per l'uso dentro gli attributi, per leggibilità. */
export const escapeAttr = escapeHtml;
