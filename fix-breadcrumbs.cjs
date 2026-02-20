/**
 * Fix breadcrumbs: aggiunge livello categoria
 * Da: Home › Ricette › Titolo
 * A:  Home › Ricette › Categoria › Titolo
 */
const fs = require('fs');
const path = require('path');

const base = path.resolve(__dirname, '../Ricettario/ricette');
const catMap = { pane: 'Pane', pasta: 'Pasta', pizza: 'Pizza', lievitati: 'Lievitati', focaccia: 'Focaccia' };
let updated = 0;
let skipped = 0;

for (const [dir, label] of Object.entries(catMap)) {
    const dirPath = path.join(base, dir);
    if (!fs.existsSync(dirPath)) continue;
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.html') && f !== 'index.html');

    for (const file of files) {
        const fp = path.join(dirPath, file);
        let html = fs.readFileSync(fp, 'utf-8');

        // Già aggiornato? (contiene il link alla categoria nel breadcrumb)
        if (html.includes(`<a href="./">${label}</a>`)) {
            skipped++;
            continue;
        }

        // Pattern: trova il breadcrumb vecchio e inietta il livello categoria
        // Cerca: <a href="...#ricette">Ricette</a> + separatore + <span>TITOLO
        const oldPattern = /(<a href="[^"]*#ricette">Ricette<\/a>\s*\n\s*<span class="breadcrumb__separator">›<\/span>\s*\n\s*)(<span>)/;

        if (oldPattern.test(html)) {
            html = html.replace(oldPattern,
                `$1<a href="./">${label}</a>\n                <span class="breadcrumb__separator">›</span>\n                $2`
            );
            fs.writeFileSync(fp, html, 'utf-8');
            updated++;
            console.log(`  ✅ ${dir}/${file}`);
        } else {
            console.log(`  ⚠️  Pattern non trovato: ${dir}/${file}`);
        }
    }
}

console.log(`\n📋 Breadcrumbs aggiornati: ${updated}, già ok: ${skipped}`);
