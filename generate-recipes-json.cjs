/**
 * GENERATE RECIPES JSON
 * Scansiona tutte le ricette HTML e genera recipes.json con i metadati.
 * Usato dalla homepage per il rendering dinamico dei caroselli.
 */
const fs = require('fs');
const path = require('path');

const ricettarioPath = path.resolve(__dirname, '..', 'Ricettario');
const recipeDirs = {
    pasta: { emoji: '🍝', label: 'Pasta', order: 1 },
    pane: { emoji: '🥖', label: 'Pane', order: 2 },
    pizza: { emoji: '🍕', label: 'Pizza', order: 3 },
    lievitati: { emoji: '🥐', label: 'Lievitati', order: 4 },
    focaccia: { emoji: '🫓', label: 'Focaccia', order: 5 },
};

const recipes = [];

for (const [dir, meta] of Object.entries(recipeDirs)) {
    const fullDir = path.join(ricettarioPath, 'ricette', dir);
    if (!fs.existsSync(fullDir)) continue;

    const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.html') && f !== 'index.html');

    for (const file of files) {
        const filePath = path.join(fullDir, file);
        const html = fs.readFileSync(filePath, 'utf8');
        const slug = file.replace('.html', '');

        // Estrai title
        const titleMatch = html.match(/<title>([^<]+?)\s*[—–-]\s*Il Ricettario/);
        const title = titleMatch?.[1]?.trim() || slug.replace(/-/g, ' ');

        // Estrai description dal meta tag
        const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/);
        const description = descMatch?.[1]?.trim() || '';

        // Estrai immagine dall'hero background
        const imgMatch = html.match(/recipe-hero"[^>]*style="background-image:\s*url\('([^']+)'\)/);
        let image = imgMatch?.[1] || '';

        // Estrai immagine dalla card (recipe-card__image) se non trovata nell'hero
        if (!image) {
            const cardImgMatch = html.match(/recipe-card__image[^>]*src="([^"]+)"/);
            image = cardImgMatch?.[1] || '';
        }

        // Normalizza path immagine (rimuovi ../../)
        image = image.replace(/^\.\.\/\.\.\//g, '');

        // Estrai idratazione: cerca nel tech-badge o nel testo generico
        const hydrationMatch = html.match(/[Ii]dratazione[^<]*<span[^>]*>\s*(?:&nbsp;)?\s*([\d.]+%)/)
            || html.match(/💧[^<]*<span[^>]*>\s*(?:&nbsp;)?\s*([\d.]+%)/)
            || html.match(/[Ii]dratazione\s*([\d.]+)%/)
            || html.match(/💧\s*([\d.]+)%/);
        const hydration = hydrationMatch?.[1] || null;

        // Estrai tempo/lievitazione dai tech-badge
        const timeBadgeMatch = html.match(/[Ll]ievitazione[^<]*<span[^>]*>\s*(?:&nbsp;)?\s*([^<]+)/);
        let time = timeBadgeMatch?.[1]?.trim() || null;
        if (!time) {
            const allTimeMatches = [...html.matchAll(/⏱️\s*([^<\n]+)/g)];
            for (const m of allTimeMatches) {
                const val = m[1].trim();
                if (val && val !== 'Nessuna' && val !== 'Lievitazione:' && val !== 'Tempo:' && !val.includes('Farina') && val.length < 80) {
                    time = val;
                    break;
                }
            }
        }

        // Estrai temperatura dai tech-badge
        const tempBadgeMatch = html.match(/Target Temp[^<]*<span[^>]*>\s*(?:&nbsp;)?\s*([^<]+)/);
        let temp = tempBadgeMatch?.[1]?.trim() || null;
        if (!temp) {
            const allTempMatches = [...html.matchAll(/🌡️\s*([^<\n]+)/g)];
            for (const m of allTempMatches) {
                const val = m[1].trim();
                if (val && val !== 'Ambiente' && val !== 'Temperatura:' && val !== 'Target Temp:' && val.length < 30) {
                    temp = val;
                    break;
                }
            }
        }

        // Estrai tag strumento dall'HTML
        const toolMatch = html.match(/hero-setup-tag[^>]*>([^<]+)/);
        const tool = toolMatch?.[1]?.trim() || '';

        recipes.push({
            title,
            slug,
            category: meta.label,
            categoryDir: dir,
            emoji: meta.emoji,
            href: `ricette/${dir}/${file}`,
            image,
            description,
            hydration: hydration || null,
            time,
            temp,
            tool,
        });
    }
}

// Ordina per categoria e poi per titolo
recipes.sort((a, b) => {
    const catA = recipeDirs[a.categoryDir]?.order || 99;
    const catB = recipeDirs[b.categoryDir]?.order || 99;
    if (catA !== catB) return catA - catB;
    return a.title.localeCompare(b.title, 'it');
});

// Statistiche
const stats = {};
for (const r of recipes) {
    stats[r.category] = (stats[r.category] || 0) + 1;
}

const output = {
    generatedAt: new Date().toISOString(),
    totalRecipes: recipes.length,
    categories: Object.entries(stats).map(([name, count]) => ({
        name,
        count,
        emoji: Object.values(recipeDirs).find(d => d.label === name)?.emoji || '',
    })),
    recipes,
};

const outputPath = path.join(ricettarioPath, 'public', 'recipes.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

console.log(`\n📋 RECIPES.JSON GENERATO`);
console.log(`   📁 ${outputPath}`);
console.log(`   📊 ${recipes.length} ricette totali`);
for (const [cat, count] of Object.entries(stats)) {
    console.log(`      ${recipeDirs[Object.keys(recipeDirs).find(k => recipeDirs[k].label === cat)]?.emoji || '📁'} ${cat}: ${count}`);
}
console.log('');
