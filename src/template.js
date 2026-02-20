/**
 * TEMPLATE — Genera HTML completo dal JSON della ricetta
 * Output identico al design di pane-noci-olive.html
 */

/**
 * Genera una riga ingrediente con data-base e setupNote dinamiche
 */
function ingredientRow({ name, note, grams, setupNote }) {
    // Costruisci nota HTML con data attributes per setup dinamico
    let noteHtml = '';
    if (setupNote && typeof setupNote === 'object') {
        const dataAttrs = Object.entries(setupNote)
            .map(([setup, text]) => `data-setup-note-${setup}="(${text})"`)
            .join(' ');
        // Nota iniziale = setup primario (spirale/estrusore)
        const primaryNote = setupNote.spirale || setupNote.estrusore || note || '';
        noteHtml = ` <span class="ingredient-note" ${dataAttrs}>(${primaryNote})</span>`;
    } else if (note) {
        noteHtml = ` <span class="ingredient-note">${note}</span>`;
    }

    // Se grams è null/undefined → riga header sezione (es. "BIGA", "IMPASTO FINALE")
    if (grams == null) {
        return `                            <tr class="ingredient-section-header">
                                <td><strong>${name}</strong>${noteHtml}</td>
                                <td class="ingredient-qty"></td>
                            </tr>`;
    }
    return `                            <tr>
                                <td>${name}${noteHtml}</td>
                                <td class="ingredient-qty" data-base="${grams}">${grams}g</td>
                            </tr>`;
}

/**
 * Genera uno step del procedimento
 */
function stepItem({ title, text }) {
    return `                            <li>
                                <strong>${title}</strong>
                                <p>${text}</p>
                            </li>`;
}

/**
 * Genera riga tabella farine
 */
function flourRow({ type, w, brands }) {
    const wStyle = w && w !== '—'
        ? 'color: var(--color-accent); font-weight: 600;'
        : 'color: var(--color-text-muted);';
    return `                        <tr>
                            <td>${type}</td>
                            <td style="${wStyle}">${w || '—'}</td>
                            <td>${brands}</td>
                        </tr>`;
}

/**
 * Genera l'HTML completo della ricetta
 * @param {object} recipe - JSON strutturato dal modulo enhancer
 * @returns {string} HTML completo della pagina
 */
export function generateHtml(recipe) {
    const r = recipe;
    const ingredientRows = r.ingredients.map(ingredientRow).join('\n');
    const suspensionRows = r.suspensions?.length
        ? r.suspensions.map(ingredientRow).join('\n')
        : '';

    // Calcola il totale grammi SOLO delle farine (non tutti gli ingredienti)
    const FLOUR_KEYWORDS = ['farina', 'semola', 'manitoba'];
    const isFlour = (name) => {
        // Rimuovi note parentetiche tipo "(2% su farina)" prima del matching
        const cleanName = name.replace(/\([^)]*\)/g, '').trim().toLowerCase();
        return FLOUR_KEYWORDS.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(cleanName));
    };
    const totalGrams = r.ingredients
        .filter(ing => isFlour(ing.name))
        .reduce((sum, ing) => sum + (ing.grams || 0), 0);
    const totalKg = Math.round((totalGrams / 1000) * 10) / 10; // Valore reale, arrotondato a 1 decimale

    // Setup dinamico basato sulla categoria
    const isPasta = (r.category || '').toLowerCase() === 'pasta';
    const primarySteps = isPasta
        ? (r.stepsExtruder || r.stepsSpiral || []).map(stepItem).join('\n')
        : (r.stepsSpiral || []).map(stepItem).join('\n');
    const secondarySteps = (r.stepsHand || []).map(stepItem).join('\n');
    const hasSecondary = secondarySteps.trim().length > 0;

    const condimentSteps = (r.stepsCondiment || []).map(stepItem).join('\n');
    const hasCondiment = condimentSteps.trim().length > 0;

    const primaryLabel = isPasta ? '🍝 Pasta' : '🔧 Impastatrice a spirale';
    const primaryBadge = isPasta ? '🍝 Pasta' : '🔧 Spirale';
    const primarySetupId = isPasta ? 'estrusore' : 'spirale';

    const flourRows = r.flourTable?.length
        ? r.flourTable.map(flourRow).join('\n')
        : '';

    const tags = r.tags || [];
    const tagBadges = tags.map(t => `                            <span class="tag tag--grain">${t}</span>`).join('\n');

    return `<!DOCTYPE html>
<html lang="it" data-theme="light">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description"
        content="${r.description}">
    <title>${r.title} — Il Ricettario</title>
    <link rel="icon"
        href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔥</text></svg>">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Playfair+Display:ital,wght@0,700;0,800;0,900;1,700&display=swap"
        rel="stylesheet">
    <!-- FOUC Prevention: applica tema prima del rendering -->
    <script>
        (function () {
            const saved = localStorage.getItem('theme');
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            const theme = saved || (prefersDark ? 'dark' : 'light');
            document.documentElement.setAttribute('data-theme', theme);
        })();
    </script>
</head>

<body>

    <!-- Skip to content — Accessibilità -->
    <a href="#recipe-content" class="skip-link">Vai al contenuto principale</a>

    <!-- ═══════════ NAVBAR ═══════════ -->
    <nav class="navbar" id="navbar">
        <div class="navbar__inner">
            <a href="../../index.html" class="navbar__logo">
                <div class="navbar__logo-icon">🔥</div>
                <span>Il Ricettario</span>
            </a>

            <ul class="navbar__links" id="nav-links">
                <li><a href="../../index.html#ricette">Ricette</a></li>
                <li><a href="../../index.html#strumenti">Strumenti</a></li>
                <li><a href="../../index.html#chi-sono">Chi Sono</a></li>
            </ul>

            <button class="theme-toggle" id="theme-toggle" aria-label="Cambia tema">
                <span class="theme-toggle__icon theme-toggle__sun">☀️</span>
                <span class="theme-toggle__icon theme-toggle__moon">🌙</span>
            </button>

            <button class="navbar__hamburger" id="hamburger" aria-label="Menu">
                <span></span>
                <span></span>
                <span></span>
            </button>
        </div>
    </nav>

    <!-- ═══════════ RECIPE HERO ═══════════ -->
    <div class="recipe-hero"${r.image ? ` style="background-image: url('../../${r.image}')"` : ''}>
        <div class="container">
            <nav class="breadcrumb reveal">
                <a href="../../index.html">Home</a>
                <span class="breadcrumb__separator">›</span>
                <a href="../../index.html#ricette">Ricette</a>
                <span class="breadcrumb__separator">›</span>
                <a href="./">${r.category || 'Pane'}</a>
                <span class="breadcrumb__separator">›</span>
                <span>${r.title}</span>
            </nav>

            <div class="recipe-hero__content">
                <div class="recipe-hero__tags reveal">
                    <span class="tag tag--tool" id="hero-setup-tag">${primaryLabel}</span>
                    <span class="tag tag--category">${r.emoji || '🥖'} ${r.category || 'Pane'}</span>
                </div>
                <h1 class="recipe-hero__title reveal reveal-delay-1">${r.title}</h1>
                <p class="recipe-hero__subtitle reveal reveal-delay-2">
                    ${r.subtitle || ''}
                </p>
            </div>
        </div>
    </div>

    <!-- ═══════════ TECH BADGES ═══════════ -->
    <div class="container" style="padding-top: 40px;">
        <div class="tech-badges reveal">
            <div class="tech-badge">
                💧 Idratazione: <span class="tech-badge__value">&nbsp;${r.hydration}%</span>
            </div>
            <div class="tech-badge">
                🌡️ Target Temp: <span class="tech-badge__value">&nbsp;${r.targetTemp}</span>
            </div>
            <div class="tech-badge">
                ⏱️ Lievitazione: <span class="tech-badge__value">&nbsp;${r.fermentation}</span>
            </div>
            <div class="tech-badge tech-badge--toggle" id="setup-badge" role="button" tabindex="0"
                aria-label="Cambia setup">
                🔧 Setup: <span class="tech-badge__value" id="setup-badge-value">&nbsp;${isPasta ? 'Macchina Pasta' : 'A mano'}</span>
            </div>
        </div>
    </div>

    <!-- ═══════════ RECIPE CONTENT ═══════════ -->
    <section class="recipe-content">
        <div class="container">
            <div class="recipe-layout">

                <!-- COLONNA SINISTRA: Ingredienti -->
                <div>
                    <div class="recipe-panel reveal">
                        <h2 class="recipe-panel__title">
                            <span class="recipe-panel__title-icon">🛒</span>
                            Ingredienti Base
                        </h2>

                        <!-- Calcolatore Dosi -->
                        <div class="dose-calculator" id="dose-calculator">
                            <div class="dose-calculator__label">
                                <span class="dose-calculator__label-icon">⚖️</span>
                                Farina totale
                            </div>
                            <div class="dose-calculator__controls">
                                <button class="dose-calculator__btn" id="dose-decrease"
                                    aria-label="Diminuisci dosi">−</button>
                                <div class="dose-calculator__input-wrapper">
                                    <input type="number" class="dose-calculator__input" id="dose-input" value="${totalKg}"
                                        min="${totalKg}" max="5" step="${totalKg}" data-base-total="${totalGrams}" aria-label="Kg di farina">
                                    <span class="dose-calculator__unit">kg</span>
                                </div>
                                <button class="dose-calculator__btn" id="dose-increase"
                                    aria-label="Aumenta dosi">+</button>
                            </div>
                            <div class="dose-calculator__badge" id="dose-badge">×1</div>
                        </div>

                        <table class="ingredients-table" id="ingredients-table">
${ingredientRows}
                        </table>
                    </div>
${suspensionRows ? `
                    <div class="recipe-panel reveal" style="margin-top: 28px;">
                        <h2 class="recipe-panel__title">
                            <span class="recipe-panel__title-icon">🥜</span>
                            Sospensioni
                        </h2>
                        <table class="ingredients-table" id="suspensions-table">
${suspensionRows}
                        </table>
${r.proTips?.[0] ? `
                        <div class="pro-tip-box" style="margin-top: 16px;">
                            <p><strong>💡 PRO TIP:</strong> ${r.proTips[0]}</p>
                        </div>` : ''}
                    </div>` : ''}
                </div>

                <!-- COLONNA DESTRA: Procedimento -->
                <div>

                    <!-- ── Procedimento: Primario (Spirale o Estrusore) ── -->
                    <div class="recipe-panel reveal reveal-delay-1" data-setup="${primarySetupId}" id="steps-${primarySetupId}">
                        <h2 class="recipe-panel__title">
                            <span class="recipe-panel__title-icon">⚙️</span>
                            Procedimento
                            <span class="recipe-panel__title-badge">${primaryBadge}</span>
                        </h2>
                        <ol class="steps-list">
${primarySteps}
                        </ol>
                    </div>
${hasSecondary ? `
                    <!-- ── Procedimento: A mano ── -->
                    <div class="recipe-panel reveal reveal-delay-1" data-setup="mano" id="steps-mano"
                        style="display: none;">
                        <h2 class="recipe-panel__title">
                            <span class="recipe-panel__title-icon">⚙️</span>
                            Procedimento
                            <span class="recipe-panel__title-badge">🤲 A mano</span>
                        </h2>
                        <ol class="steps-list">
${secondarySteps}
                        </ol>
${r.proTips?.[1] ? `
                        <div class="pro-tip-box" style="margin-top: 16px;">
                            <p><strong>💡 PRO TIP:</strong> ${r.proTips[1]}</p>
                        </div>` : ''}
                    </div>` : ''}
${hasCondiment ? `
                    <!-- ── Procedimento: Condimento ── -->
                    <div class="recipe-panel reveal reveal-delay-2" data-setup="condimento" id="steps-condimento"
                        style="margin-top: 32px;">
                        <h2 class="recipe-panel__title">
                            <span class="recipe-panel__title-icon">🍳</span>
                            Preparazione Condimento
                        </h2>
                        <ol class="steps-list">
${condimentSteps}
                        </ol>
                    </div>` : ''}

                </div>

            </div>
${flourRows ? `
            <!-- ═══════════ CONSIGLI FARINE & MARCHI ═══════════ -->
            <div class="recipe-panel reveal" style="margin-top: 40px;">
                <h2 class="recipe-panel__title">
                    <span class="recipe-panel__title-icon">🌾</span>
                    Consigli Farine & Marchi
                </h2>
                <table class="flour-table">
                    <thead>
                        <tr>
                            <th>Tipo Farina</th>
                            <th>Forza (W)</th>
                            <th>Marchi Consigliati</th>
                        </tr>
                    </thead>
                    <tbody>
${flourRows}
                    </tbody>
                </table>

                <div class="pro-tip-box" style="margin-top: 16px;">
                    <p><strong>💡 PRO TIP:</strong> La forza (W) è il parametro chiave. Se non trovi i marchi suggeriti,
                        cerca qualsiasi farina con il valore W indicato.</p>
                </div>
            </div>` : ''}

            <!-- ═══════════ ALERT ═══════════ -->
            <div class="alert alert--danger reveal" style="margin-top: 32px;">
                <span class="alert__icon">🚫</span>
                <div class="alert__content">
                    <strong>ALERT PROFESSIONALE</strong>
                    <p>${r.alert}</p>
                </div>
            </div>
${r.baking ? `
            <!-- ═══════════ COTTURA ═══════════ -->
            <div class="recipe-panel reveal" style="margin-top: 32px;">
                <h2 class="recipe-panel__title">
                    <span class="recipe-panel__title-icon">🔥</span>
                    Cottura
                </h2>
                <div class="tech-badges" style="margin-bottom: 16px;">
                    <div class="tech-badge">
                        🌡️ Temperatura: <span class="tech-badge__value">&nbsp;${r.baking.temperature}</span>
                    </div>
                    <div class="tech-badge">
                        ⏱️ Tempo: <span class="tech-badge__value">&nbsp;${r.baking.time}</span>
                    </div>
                </div>
${r.baking.tips?.length > 0 ? `                <ul class="baking-tips" style="list-style: none; padding: 0;">
${r.baking.tips.map(t => `                    <li style="padding: 6px 0; border-bottom: 1px solid var(--border-subtle);">💡 ${t}</li>`).join('\n')}
                </ul>` : ''}
            </div>` : ''}
${r.glossary?.length > 0 ? `
            <!-- ═══════════ GLOSSARIO ═══════════ -->
            <div class="recipe-panel reveal" style="margin-top: 32px;">
                <h2 class="recipe-panel__title">
                    <span class="recipe-panel__title-icon">📖</span>
                    Glossario
                </h2>
                <dl class="glossary-list" style="margin: 0; padding: 0;">
${r.glossary.map(g => `                    <dt style="font-weight: 600; color: var(--color-text); margin-top: 12px;">${g.term}</dt>
                    <dd style="margin: 4px 0 0 0; color: var(--color-text-secondary); font-size: 0.92rem;">${g.definition}</dd>`).join('\n')}
                </dl>
            </div>` : ''}

        </div>
    </section>

    <!-- ═══════════ FOOTER ═══════════ -->
    <footer class="footer">
        <div class="container">
            <div class="footer__grid">
                <div class="footer__brand">
                    <div class="footer__brand-name">🔥 <span>Il Ricettario</span></div>
                    <p class="footer__brand-desc">
                        Ricettario personale. Ricette artigianali documentate con precisione tecnica per
                        risultati replicabili al 100%.
                    </p>
                </div>

                <div>
                    <h4 class="footer__col-title">Navigazione</h4>
                    <ul class="footer__links">
                        <li><a href="../../index.html">↗ Home</a></li>
                        <li><a href="../../index.html#ricette">↗ Ricette</a></li>
                        <li><a href="../../index.html#strumenti">↗ Strumenti</a></li>
                    </ul>
                </div>

                <div>
                    <h4 class="footer__col-title">Questa Ricetta</h4>
                    <ul class="footer__links">
                        <li><a href="#">${r.emoji || '🍞'} ${r.title}</a></li>
                        <li><a href="#">💧 Idratazione ${r.hydration}%</a></li>
                    </ul>
                </div>

                <div>
                    <h4 class="footer__col-title">Altre Ricette</h4>
                    <ul class="footer__links">
                        <li><a href="../../index.html#ricette">↗ Tutte le Ricette</a></li>
                    </ul>
                </div>
            </div>

            <div class="footer__bottom">
                <span>© <span id="current-year">2026</span> Il Ricettario</span>
                <div class="footer__social">
                    <a href="https://github.com/devdomenicotatone" target="_blank" rel="noopener" aria-label="GitHub">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            <path
                                d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                        </svg>
                    </a>
                </div>
            </div>
        </div>
    </footer>

    <script type="module" src="/js/main.js"></script>
</body>

</html>`;
}
