/**
 * GENERATE RECIPES JSON (v2 — SPA)
 * Scansiona tutti i file .json nelle cartelle ricette e genera recipes.json.
 * Usato dalla homepage SPA per il rendering dinamico dei caroselli.
 *
 * In v2 legge direttamente dai JSON (non più dagli HTML eliminati).
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
    dolci: { emoji: '🍪', label: 'Dolci', order: 6 },
};

const recipes = [];

for (const [dir, meta] of Object.entries(recipeDirs)) {
    const fullDir = path.join(ricettarioPath, 'ricette', dir);
    if (!fs.existsSync(fullDir)) continue;

    // Legge i file .json (non più .html!)
    const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
        const filePath = path.join(fullDir, file);
        const slug = file.replace('.json', '');

        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

            // Determina immagine: dal JSON o path convenzionale
            let image = '';
            if (data.image) {
                image = data.image.replace(/^\//, '');
            } else {
                const imgPath = `images/ricette/${dir}/${slug}.webp`;
                const imgFullPath = path.join(ricettarioPath, 'public', imgPath);
                if (fs.existsSync(imgFullPath)) {
                    image = imgPath;
                }
            }

            // Tool non più tracciato (architettura lineare)
            let tool = '';

            recipes.push({
                title: data.title || slug.replace(/-/g, ' '),
                slug,
                category: meta.label,
                categoryDir: dir,
                emoji: meta.emoji,
                // SPA: href senza .html
                href: `ricette/${dir}/${slug}`,
                image,
                description: data.description || data.subtitle || '',
                hydration: data.hydration ? `${data.hydration}%` : null,
                time: data.fermentation || null,
                temp: data.targetTemp || null,
                tool,
            });
        } catch (err) {
            console.warn(`⚠️  Errore parsing ${file}: ${err.message}`);
        }
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

console.log(`\n📋 RECIPES.JSON GENERATO (v2 — SPA)`);
console.log(`   📁 ${outputPath}`);
console.log(`   📊 ${recipes.length} ricette totali`);
for (const [cat, count] of Object.entries(stats)) {
    console.log(`      ${recipeDirs[Object.keys(recipeDirs).find(k => recipeDirs[k].label === cat)]?.emoji || '📁'} ${cat}: ${count}`);
}
console.log('');
