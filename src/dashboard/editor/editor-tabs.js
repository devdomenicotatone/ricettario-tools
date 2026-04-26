/**
 * RECIPE EDITOR — Tab Renderers
 * 
 * Rendering dei 4 tab panels: Meta, Ingredienti, Procedimento, Supporto.
 * Include anche il pannello validazione e i binding degli input.
 */

import { VALID_CATEGORY_NAMES as VALID_CATEGORIES } from '/shared/categories.js';
import { esc } from './editor-state.js';

// ═══════════════════════════════════════════════════════
//  TAB DISPATCHER
// ═══════════════════════════════════════════════════════

/**
 * Renderizza il tab attivo nel container.
 * @param {HTMLElement} content 
 * @param {string} activeTab 
 * @param {import('./editor-state.js').RecipeEditorState} state 
 * @param {HTMLTextAreaElement|null} activeTextarea — ref per token helper
 */
export function renderActiveTab(content, activeTab, state, activeTextareaRef) {
    if (!state.currentRecipe) return;

    switch (activeTab) {
        case 'meta': renderMetaTab(content, state); break;
        case 'ingredients': renderIngredientsTab(content, state); break;
        case 'steps': renderStepsTab(content, state, activeTextareaRef); break;
        case 'support': renderSupportTab(content, state); break;
    }
    lucide.createIcons({ nodes: [content] });
}

// ═══════════════════════════════════════════════════════
//  TAB META
// ═══════════════════════════════════════════════════════

function renderMetaTab(container, state) {
    const r = state.currentRecipe;
    container.innerHTML = `
        <div class="re-field">
            <label class="re-label">Titolo</label>
            <input class="re-input" id="re-title-input" value="${esc(r.title)}" data-path="title">
        </div>
        <div class="re-field">
            <label class="re-label">Sottotitolo</label>
            <input class="re-input" id="re-subtitle-input" value="${esc(r.subtitle)}" data-path="subtitle">
        </div>
        <div class="re-field">
            <label class="re-label">Descrizione</label>
            <textarea class="re-textarea" data-path="description" rows="3">${esc(r.description)}</textarea>
        </div>
        <div class="re-row">
            <div class="re-field">
                <label class="re-label">Emoji</label>
                <input class="re-input re-input-sm" value="${esc(r.emoji)}" data-path="emoji" style="width:80px">
            </div>
            <div class="re-field">
                <label class="re-label">Categoria</label>
                <select class="re-select" data-path="category">
                    ${VALID_CATEGORIES.map(c => `<option value="${c}" ${c === r.category ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
            </div>
            <div class="re-field">
                <label class="re-label">Slug</label>
                <input class="re-input re-input-sm re-input-mono" value="${esc(r.slug)}" data-path="slug">
            </div>
        </div>
        <div class="re-row">
            <div class="re-field">
                <label class="re-label">Idratazione %</label>
                <input class="re-input re-input-sm" type="number" value="${r.hydration ?? ''}" data-path="hydration" data-type="number">
            </div>
            <div class="re-field">
                <label class="re-label">Temp. Target</label>
                <input class="re-input re-input-sm" value="${esc(r.targetTemp)}" data-path="targetTemp">
            </div>
            <div class="re-field">
                <label class="re-label">Lievitazione</label>
                <input class="re-input re-input-sm" value="${esc(r.fermentation)}" data-path="fermentation">
            </div>
            <div class="re-field">
                <label class="re-label">Farina Totale (g)</label>
                <input class="re-input re-input-sm" type="number" value="${r.totalFlour ?? ''}" data-path="totalFlour" data-type="number">
            </div>
        </div>
        <div class="re-field">
            <label class="re-label">Alert ⚠️</label>
            <textarea class="re-textarea" data-path="alert" rows="2">${esc(r.alert)}</textarea>
        </div>
        <div class="re-field">
            <label class="re-label">Tags</label>
            <div class="re-tags-wrap" id="reTagsWrap">
                ${(r.tags || []).map((t, i) => `<span class="re-tag">${esc(t)}<button class="re-tag-remove" data-tag-idx="${i}">×</button></span>`).join('')}
                <input class="re-tag-input" id="reTagInput" placeholder="Aggiungi tag...">
            </div>
        </div>
        <div class="re-field">
            <label class="re-label">Immagine</label>
            <input class="re-input re-input-sm re-input-mono" value="${esc(r.image)}" data-path="image" style="color:#64748b">
            ${r.image ? `<img class="re-image-preview" src="/${r.image}" alt="" onerror="this.style.display='none'">` : ''}
        </div>

        ${renderValidationPanel(state)}
    `;

    bindInputs(container, state);
    bindTags(state);
}

// ═══════════════════════════════════════════════════════
//  TAB INGREDIENTI
// ═══════════════════════════════════════════════════════

function renderIngredientsTab(container, state) {
    const r = state.currentRecipe;
    const groups = r.ingredientGroups || [];

    let html = '';
    groups.forEach((g, gi) => {
        const totalGrams = (g.items || []).reduce((sum, it) => sum + (it.grams || 0), 0);
        html += `
            <div class="re-section" data-group-idx="${gi}">
                <div class="re-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                    <div class="re-section-title">
                        <span class="emoji">🧂</span>
                        <input class="re-input re-input-sm" value="${esc(g.group)}" 
                            data-path="ingredientGroups.${gi}.group" 
                            style="flex:1;max-width:300px;background:transparent;border:none;color:#e2e8f0;font-weight:600"
                            onclick="event.stopPropagation()">
                    </div>
                    <div style="display:flex;gap:8px;align-items:center">
                        <span style="font-size:11px;color:#818cf8;font-weight:600;font-feature-settings:'tnum'">${totalGrams}g</span>
                        <span style="font-size:11px;color:#475569">${(g.items || []).length} ing.</span>
                        <span class="re-section-chevron">▸</span>
                        <button class="re-row-delete" onclick="event.stopPropagation(); removeGroup(${gi})" title="Rimuovi gruppo"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
                <div class="re-section-body">
                    <div style="display:grid;grid-template-columns:1fr 80px 1fr 130px 40px 36px;gap:6px;padding:0 0 6px;font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:0.5px">
                        <span>Nome</span><span>Grammi</span><span>Note</span><span>Token ID</span><span>Exc.</span><span></span>
                    </div>
                    ${(g.items || []).map((item, ii) => `
                        <div class="re-ingredient-row">
                            <input class="re-input" value="${esc(item.name)}" data-path="ingredientGroups.${gi}.items.${ii}.name" placeholder="Nome">
                            <input class="re-input" type="number" value="${item.grams ?? ''}" data-path="ingredientGroups.${gi}.items.${ii}.grams" data-type="number" placeholder="g">
                            <input class="re-input" value="${esc(item.note)}" data-path="ingredientGroups.${gi}.items.${ii}.note" placeholder="Note">
                            <input class="re-input re-input-mono" value="${esc(item.tokenId)}" data-path="ingredientGroups.${gi}.items.${ii}.tokenId" placeholder="token_id">
                            <div class="re-checkbox-wrap"><input type="checkbox" class="re-checkbox" data-path="ingredientGroups.${gi}.items.${ii}.excludeFromTotal" ${item.excludeFromTotal ? 'checked' : ''}></div>
                            <button class="re-row-delete" onclick="removeIngredient(${gi},${ii})"><i data-lucide="x"></i></button>
                        </div>
                    `).join('')}
                    <div class="re-group-totals">
                        <span class="re-group-totals-label">Totale ${esc(g.group)}</span>
                        <span class="re-group-totals-value">${totalGrams} g</span>
                    </div>
                    <button class="re-add-btn" onclick="addIngredient(${gi})"><i data-lucide="plus"></i> Ingrediente</button>
                </div>
            </div>
        `;
    });

    // Sospensioni
    const susp = r.suspensions || [];
    html += `
        <div class="re-section${susp.length === 0 ? ' collapsed' : ''}">
            <div class="re-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="re-section-title"><span class="emoji">🥜</span> Sospensioni / Aggiunte <span style="color:#475569;font-weight:400">(${susp.length})</span></div>
                <span class="re-section-chevron">▸</span>
            </div>
                <div class="re-section-body">
                    ${susp.map((s, si) => `
                        <div class="re-ingredient-row" style="grid-template-columns:1fr 80px 1fr 36px">
                            <input class="re-input" value="${esc(s.name)}" data-path="suspensions.${si}.name">
                            <input class="re-input" type="number" value="${s.grams ?? ''}" data-path="suspensions.${si}.grams" data-type="number">
                            <input class="re-input" value="${esc(s.note)}" data-path="suspensions.${si}.note">
                            <button class="re-row-delete" onclick="removeSuspension(${si})"><i data-lucide="x"></i></button>
                        </div>
                    `).join('')}
                <button class="re-add-btn" onclick="addSuspension()"><i data-lucide="plus"></i> Sospensione</button>
            </div>
        </div>
    `;

    html += `<button class="re-add-btn" onclick="addGroup()" style="margin-top:4px"><i data-lucide="plus"></i> Nuovo Gruppo Ingredienti</button>`;
    html += renderValidationPanel(state);

    container.innerHTML = html;
    bindInputs(container, state);
}

// ═══════════════════════════════════════════════════════
//  TAB PROCEDIMENTO
// ═══════════════════════════════════════════════════════

function renderStepsTab(container, state, activeTextareaRef) {
    const r = state.currentRecipe;
    const sections = [
        { key: 'steps', label: '⚙️ Procedimento', icon: 'list-ordered' },
        { key: 'stepsCondiment', label: '🍅 Condimento', icon: 'salad' },
    ];

    // Token helper: collect all tokenIds
    const allTokens = [];
    for (const g of (r.ingredientGroups || [])) {
        for (const item of (g.items || [])) {
            if (item.tokenId) allTokens.push({ id: item.tokenId, grams: item.grams, name: item.name });
        }
    }

    let html = '';
    for (const sec of sections) {
        const steps = r[sec.key] || [];
        const isCollapsed = steps.length === 0;
        html += `
            <div class="re-section ${isCollapsed ? 'collapsed' : ''}">
                <div class="re-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                    <div class="re-section-title"><span class="emoji">${sec.label.split(' ')[0]}</span> ${sec.label.split(' ').slice(1).join(' ')} <span style="color:#475569;font-weight:400">(${steps.length})</span></div>
                    <span class="re-section-chevron">▸</span>
                </div>
                <div class="re-section-body">
                    ${steps.map((s, si) => `
                        <div class="re-step">
                            <div class="re-step-header">
                                <span class="re-step-num">${si + 1}</span>
                                <input class="re-input re-step-title-input" value="${esc(s.title)}" data-path="${sec.key}.${si}.title" placeholder="Titolo step">
                                <div class="re-step-actions">
                                    <button class="re-row-delete" onclick="moveStep('${sec.key}',${si},-1)" title="Sposta su"><i data-lucide="arrow-up"></i></button>
                                    <button class="re-row-delete" onclick="moveStep('${sec.key}',${si},1)" title="Sposta giù"><i data-lucide="arrow-down"></i></button>
                                    <button class="re-row-delete" onclick="removeStep('${sec.key}',${si})"><i data-lucide="x"></i></button>
                                </div>
                            </div>
                            <textarea class="re-textarea re-step-textarea" data-path="${sec.key}.${si}.text" rows="4" 
                                onfocus="window.__editorActiveTextarea=this">${esc(s.text)}</textarea>
                        </div>
                    `).join('')}
                    <button class="re-add-btn" onclick="addStep('${sec.key}')"><i data-lucide="plus"></i> Step</button>
                </div>
            </div>
        `;
    }

    // Token Helper
    if (allTokens.length) {
        html += `
            <div class="re-token-helper">
                <div class="re-token-helper-title">📎 Token Helper — clicca per inserire nel textarea attivo</div>
                ${allTokens.map(t => `<span class="re-token-chip" onclick="insertToken('${t.id}', ${t.grams})" title="${t.name}">{${t.id}:<span class="value">${t.grams}</span>}</span>`).join('')}
            </div>
        `;
    }

    html += renderValidationPanel(state);
    container.innerHTML = html;
    bindInputs(container, state);
}

// ═══════════════════════════════════════════════════════
//  TAB SUPPORTO
// ═══════════════════════════════════════════════════════

function renderSupportTab(container, state) {
    const r = state.currentRecipe;
    let html = '';

    // Flour Table
    const fl = r.flourTable || [];
    html += `
        <div class="re-section">
            <div class="re-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="re-section-title"><span class="emoji">🌾</span> Tabella Farine</div>
                <span class="re-section-chevron">▸</span>
            </div>
            <div class="re-section-body">
                <div style="display:grid;grid-template-columns:1fr 100px 1fr 36px;gap:6px;padding:0 0 6px;font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:0.5px">
                    <span>Tipo</span><span>W</span><span>Marchi</span><span></span>
                </div>
                ${fl.map((f, fi) => `
                    <div class="re-flour-row">
                        <input class="re-input" value="${esc(f.type)}" data-path="flourTable.${fi}.type">
                        <input class="re-input" value="${esc(f.w)}" data-path="flourTable.${fi}.w">
                        <input class="re-input" value="${esc(f.brands)}" data-path="flourTable.${fi}.brands">
                        <button class="re-row-delete" onclick="removeFlour(${fi})"><i data-lucide="x"></i></button>
                    </div>
                `).join('')}
                <button class="re-add-btn" onclick="addFlour()"><i data-lucide="plus"></i> Farina</button>
            </div>
        </div>
    `;

    // Baking
    const b = r.baking || {};
    html += `
        <div class="re-section">
            <div class="re-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="re-section-title"><span class="emoji">🔥</span> Cottura</div>
                <span class="re-section-chevron">▸</span>
            </div>
            <div class="re-section-body">
                <div class="re-baking-grid">
                    <div class="re-field">
                        <label class="re-label">Temperatura</label>
                        <input class="re-input" value="${esc(b.temperature)}" data-path="baking.temperature">
                    </div>
                    <div class="re-field">
                        <label class="re-label">Tempo</label>
                        <input class="re-input" value="${esc(b.time)}" data-path="baking.time">
                    </div>
                </div>
                <label class="re-label">Tips Cottura</label>
                ${(b.tips || []).map((t, ti) => `
                    <div class="re-string-item">
                        <textarea class="re-textarea" data-path="baking.tips.${ti}" rows="2">${esc(t)}</textarea>
                        <button class="re-row-delete" onclick="removeBakingTip(${ti})"><i data-lucide="x"></i></button>
                    </div>
                `).join('')}
                <button class="re-add-btn" onclick="addBakingTip()"><i data-lucide="plus"></i> Tip Cottura</button>
            </div>
        </div>
    `;

    // Pro Tips
    html += `
        <div class="re-section">
            <div class="re-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="re-section-title"><span class="emoji">💡</span> Pro Tips</div>
                <span class="re-section-chevron">▸</span>
            </div>
            <div class="re-section-body">
                ${(r.proTips || []).map((t, ti) => `
                    <div class="re-string-item">
                        <textarea class="re-textarea" data-path="proTips.${ti}" rows="2">${esc(t)}</textarea>
                        <button class="re-row-delete" onclick="removeProTip(${ti})"><i data-lucide="x"></i></button>
                    </div>
                `).join('')}
                <button class="re-add-btn" onclick="addProTip()"><i data-lucide="plus"></i> Pro Tip</button>
            </div>
        </div>
    `;

    // Storage
    html += `
        <div class="re-section">
            <div class="re-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="re-section-title"><span class="emoji">📦</span> Conservazione</div>
                <span class="re-section-chevron">▸</span>
            </div>
            <div class="re-section-body">
                ${(r.storage || []).map((t, ti) => `
                    <div class="re-string-item">
                        <textarea class="re-textarea" data-path="storage.${ti}" rows="2">${esc(t)}</textarea>
                        <button class="re-row-delete" onclick="removeStorage(${ti})"><i data-lucide="x"></i></button>
                    </div>
                `).join('')}
                <button class="re-add-btn" onclick="addStorage()"><i data-lucide="plus"></i> Consigli Conservazione</button>
            </div>
        </div>
    `;

    // Glossary
    html += `
        <div class="re-section">
            <div class="re-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="re-section-title"><span class="emoji">📖</span> Glossario</div>
                <span class="re-section-chevron">▸</span>
            </div>
            <div class="re-section-body">
                ${(r.glossary || []).map((g, gi) => `
                    <div class="re-glossary-item">
                        <input class="re-input" value="${esc(g.term)}" data-path="glossary.${gi}.term" placeholder="Termine">
                        <input class="re-input" value="${esc(g.definition)}" data-path="glossary.${gi}.definition" placeholder="Definizione">
                        <button class="re-row-delete" onclick="removeGlossary(${gi})"><i data-lucide="x"></i></button>
                    </div>
                `).join('')}
                <button class="re-add-btn" onclick="addGlossary()"><i data-lucide="plus"></i> Voce Glossario</button>
            </div>
        </div>
    `;

    // Image keywords
    html += `
        <div class="re-token-helper">
            <div class="re-token-helper-title" style="color:#a5b4fc;">🖼️ Image Keywords</div>
            <div class="re-tags-wrap" id="reImgKwWrap" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);padding:6px;min-height:36px;margin-bottom:0;">
                ${(r.imageKeywords || []).map((t, i) => `<span class="re-tag" style="background:rgba(129,140,248,0.2)">${esc(t)}<button class="re-tag-remove" data-imgkw-idx="${i}">×</button></span>`).join('')}
                <input class="re-tag-input" id="reImgKwInput" placeholder="Aggiungi keyword...">
            </div>
        </div>
    `;

    html += renderValidationPanel(state);
    container.innerHTML = html;
    bindInputs(container, state);
    bindImageKeywords(state);
}

// ═══════════════════════════════════════════════════════
//  VALIDATION PANEL
// ═══════════════════════════════════════════════════════

function renderValidationPanel(state) {
    const v = state.validationResult;
    if (!v) return '';
    if (v.valid && !v.warnings.length) return `<div class="re-validation"><div class="re-validation-title">✅ Schema Valido</div></div>`;

    return `
        <div class="re-validation">
            <div class="re-validation-title">${v.valid ? '⚠️' : '❌'} Validazione Schema</div>
            ${v.errors.map(e => `<div class="re-validation-item error">❌ ${esc(e)}</div>`).join('')}
            ${v.warnings.map(w => `<div class="re-validation-item warning">⚠️ ${esc(w)}</div>`).join('')}
        </div>
    `;
}

// ═══════════════════════════════════════════════════════
//  INPUT BINDINGS
// ═══════════════════════════════════════════════════════

function bindInputs(container, state) {
    container.querySelectorAll('[data-path]').forEach(el => {
        const path = el.dataset.path;
        const type = el.dataset.type;
        const event = el.tagName === 'SELECT' ? 'change' : 'input';

        el.addEventListener(event, () => {
            let val = el.type === 'checkbox' ? el.checked : el.value;
            if (type === 'number') val = val === '' ? null : parseFloat(val);
            state.update(path, val);
        });
    });
}

function bindTags(state) {
    const input = document.getElementById('reTagInput');
    if (!input) return;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
            e.preventDefault();
            const tags = [...(state.currentRecipe.tags || []), input.value.trim()];
            state.update('tags', tags);
            renderActiveTab(document.getElementById('reContent'), 'meta', state, null);
        }
        if (e.key === 'Backspace' && !input.value) {
            const tags = [...(state.currentRecipe.tags || [])];
            if (tags.length) {
                tags.pop();
                state.update('tags', tags);
                renderActiveTab(document.getElementById('reContent'), 'meta', state, null);
            }
        }
    });
    document.querySelectorAll('.re-tag-remove[data-tag-idx]').forEach(btn => {
        btn.onclick = () => {
            const idx = parseInt(btn.dataset.tagIdx);
            const tags = [...(state.currentRecipe.tags || [])];
            tags.splice(idx, 1);
            state.update('tags', tags);
            renderActiveTab(document.getElementById('reContent'), 'meta', state, null);
        };
    });
}

function bindImageKeywords(state) {
    const input = document.getElementById('reImgKwInput');
    if (!input) return;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
            e.preventDefault();
            const kws = [...(state.currentRecipe.imageKeywords || []), input.value.trim()];
            state.update('imageKeywords', kws);
            renderActiveTab(document.getElementById('reContent'), 'support', state, null);
        }
    });
    document.querySelectorAll('.re-tag-remove[data-imgkw-idx]').forEach(btn => {
        btn.onclick = () => {
            const idx = parseInt(btn.dataset.imgkwIdx);
            const kws = [...(state.currentRecipe.imageKeywords || [])];
            kws.splice(idx, 1);
            state.update('imageKeywords', kws);
            renderActiveTab(document.getElementById('reContent'), 'support', state, null);
        };
    });
}
