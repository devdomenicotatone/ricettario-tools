/**
 * INJECTOR — Inserisce automaticamente la card ricetta nella homepage
 * e aggiorna il footer con il link
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Genera l'HTML della card per la homepage
 */
function generateCard(recipe) {
    const r = recipe;

    // Immagini: priorità Wikimedia (specifiche per ricetta), fallback Unsplash (generiche)
    const imageMap = {
        Pane: 'https://images.unsplash.com/photo-1549931319-a545753467c8?w=600&h=400&fit=crop&q=80',
        Pizza: 'https://images.unsplash.com/photo-1555507036-ab1f4038024a?w=600&h=400&fit=crop&q=80',
        Focaccia: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=600&h=400&fit=crop&q=80',
        Pasta: 'https://images.unsplash.com/photo-1556761223-4c4282c73f77?w=600&h=400&fit=crop&q=80',
        Lievitati: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&h=400&fit=crop&q=80',
    };
    const category = r.category || 'Pane';
    const imageUrl = r.image || imageMap[category] || imageMap.Pane;

    // Mappa categoria → sottocartella
    const categoryFolder = {
        Pane: 'pane', Pizza: 'pizza', Pasta: 'pasta',
        Lievitati: 'lievitati', Focaccia: 'focaccia',
    };
    const subfolder = categoryFolder[category] || category.toLowerCase();

    return `                <!-- Card: ${r.title} -->
                <a href="ricette/${subfolder}/${r.slug}.html" class="recipe-card reveal" data-category="${category}">
                    <div class="recipe-card__image-wrapper">
                        <img src="${imageUrl}"
                            alt="${r.title}" class="recipe-card__image" loading="lazy">
                    </div>
                    <div class="recipe-card__body">
                        <div class="recipe-card__tags">
                            <span class="tag tag--tool">🔧 Famag Grilletta</span>
                            <span class="tag tag--category">${r.emoji || '🥖'} ${category}</span>
                        </div>
                        <h3 class="recipe-card__title">${r.title}</h3>
                        <p class="recipe-card__desc">
                            ${r.description}
                        </p>
                        <div class="recipe-card__meta">
                            <span class="recipe-card__meta-item">⏱️ ${r.fermentation}</span>
                            <span class="recipe-card__meta-item">💧 ${r.hydration}% idratazione</span>
                            <span class="recipe-card__meta-item">🌡️ ${r.targetTemp}</span>
                        </div>
                    </div>
                </a>`;
}

/**
 * Estrae un blocco di card placeholder (div con opacity 0.5 e pointer-events: none)
 * dall'HTML, usando conteggio parentesi per trovare il blocco completo
 */
function findPlaceholderBlock(html) {
    // Cerca il commento "Coming Soon Placeholder"
    const commentMarker = 'Coming Soon Placeholder';
    const markerIdx = html.indexOf(commentMarker);
    if (markerIdx === -1) return null;

    // Torna indietro fino all'inizio del commento HTML
    let blockStart = html.lastIndexOf('<!--', markerIdx);
    if (blockStart === -1) return null;

    // Troval'inizio della riga (newline prima del commento)
    const lineStart = html.lastIndexOf('\n', blockStart);
    blockStart = lineStart !== -1 ? lineStart + 1 : blockStart;

    // Dall'inizio del commento, trova il primo <div dopo il commento
    const divStart = html.indexOf('<div', html.indexOf('-->', markerIdx));
    if (divStart === -1) return null;

    // Conta i <div> aperti/chiusi per trovare la fine del blocco
    let depth = 0;
    let pos = divStart;
    let blockEnd = -1;

    while (pos < html.length) {
        const nextOpen = html.indexOf('<div', pos);
        const nextClose = html.indexOf('</div>', pos);

        if (nextClose === -1) break;

        if (nextOpen !== -1 && nextOpen < nextClose) {
            depth++;
            pos = nextOpen + 4;
        } else {
            depth--;
            if (depth === 0) {
                blockEnd = nextClose + '</div>'.length;
                break;
            }
            pos = nextClose + '</div>'.length;
        }
    }

    if (blockEnd === -1) return null;

    // Includi anche la newline finale
    if (html[blockEnd] === '\r') blockEnd++;
    if (html[blockEnd] === '\n') blockEnd++;

    return {
        start: blockStart,
        end: blockEnd,
        text: html.slice(blockStart, blockEnd)
    };
}

/**
 * Inietta la card nella homepage index.html
 * Sostituisce il primo placeholder "Coming Soon" con la card vera
 */
export function injectCard(recipe, ricettarioPath) {
    const indexPath = resolve(ricettarioPath, 'index.html');
    let html = readFileSync(indexPath, 'utf-8');

    // Verifica che la card non esista già
    if (html.includes(`${recipe.slug}.html`)) {
        console.log('ℹ️  Card già presente nella homepage, skip inserimento.');
        return;
    }

    const cardHtml = generateCard(recipe);

    // Cerca e sostituisci il primo placeholder
    const placeholder = findPlaceholderBlock(html);

    if (placeholder) {
        html = html.slice(0, placeholder.start) + cardHtml + '\n\n' + html.slice(placeholder.end);
        console.log('✅ Card inserita al posto del placeholder "Coming Soon"');
    } else {
        // Fallback: inserisci prima della chiusura della recipes-grid
        const gridMarker = 'class="recipes-grid"';
        const gridStart = html.indexOf(gridMarker);
        if (gridStart !== -1) {
            // Trova la fine della griglia: il </div> che chiude recipes-grid
            // Cerchiamo </div> dopo l'ultimo </a> nella griglia
            const gridCloseSearch = html.indexOf('\n            </div>', gridStart + 200);
            if (gridCloseSearch !== -1) {
                html = html.slice(0, gridCloseSearch) + '\n\n' + cardHtml + '\n' + html.slice(gridCloseSearch);
                console.log('✅ Card aggiunta alla fine della griglia ricette');
            }
        } else {
            console.error('❌ Impossibile trovare la griglia ricette in index.html');
            return;
        }
    }

    writeFileSync(indexPath, html, 'utf-8');
    console.log(`📄 Homepage aggiornata: ${indexPath}`);
}
