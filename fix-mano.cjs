const { readdirSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const dir = '../Ricettario/ricette/pasta';
// Leggi tutti i file .html in dir
const files = readdirSync(dir).filter(f => f.endsWith('.html') && f.includes('philips'));

let count = 0;

for (const file of files) {
    const filePath = join(dir, file);
    let content = readFileSync(filePath, 'utf8');

    const replaceStr = `<!-- ── Procedimento: Condimento ── -->
                    <div class="recipe-panel reveal reveal-delay-2" data-setup="condimento" id="steps-condimento"
                        style="margin-top: 32px;">
                        <h2 class="recipe-panel__title">
                            <span class="recipe-panel__title-icon">🍳</span>
                            Preparazione Condimento
                        </h2>`;

    if (content.includes('data-setup="mano"')) {
        const regex = /<!-- ── Procedimento: A mano ── -->\s*<div class="recipe-panel reveal reveal-delay-1" data-setup="mano" id="steps-mano"\s*style="display: none;">\s*<h2 class="recipe-panel__title">\s*<span class="recipe-panel__title-icon">⚙️<\/span>\s*Procedimento\s*<span class="recipe-panel__title-badge">🤲 A mano<\/span>\s*<\/h2>/g;

        // Rimuoviamo anche il badge "A mano" dal toggle della hero
        const toggleRegex = /<div class="tech-badge tech-badge--toggle" id="setup-badge" role="button" tabindex="0"\s*aria-label="Cambia setup">\s*🔧 Setup: <span class="tech-badge__value" id="setup-badge-value">&nbsp;Macchina Pasta<\/span>\s*<\/div>/g;
        // Actually template.js doesn't include "Macchina Pasta vs A mano" in toggle strings directly like this, it depends on setup dynamically. The badge has the value but main.js hides it if only 1 setup.
        // We only need to replace the panel.

        if (regex.test(content)) {
            content = content.replace(regex, replaceStr);
            writeFileSync(filePath, content, 'utf8');
            count++;
            console.log('Fissato:', file);
        } else {
            console.log('Pattern "A mano" trovato ma regex non perfetta in:', file);
        }
    }
}

console.log('Totale file corretti:', count);
