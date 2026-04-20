const fs = require('fs');
const path = require('path');

const rootDir = '../Ricettario';
const pastaDir = path.join(rootDir, 'ricette', 'pasta');
const paneDir = path.join(rootDir, 'ricette', 'pane');

// 1. Ripristino index.html per la Pasta
const paneIndex = path.join(paneDir, 'index.html');
const pastaIndex = path.join(pastaDir, 'index.html');

if (fs.existsSync(paneIndex)) {
    let content = fs.readFileSync(paneIndex, 'utf8');
    // Basic replacements
    content = content.replace(/Pane/g, 'Pasta');
    content = content.replace(/pane/g, 'pasta');
    content = content.replace(/🥖/g, '🍝');
    // Adattamenti testuali addizionali (se necessario)
    content = content.replace('Arte della Panificazione', 'Arte della Pasta');
    content = content.replace('Lievito madre', 'Semola');

    fs.writeFileSync(pastaIndex, content, 'utf8');
    console.log('✅ Ripristinato ricette/pasta/index.html');
}

// 2. Pulizia recipes.json
const recipesPath = path.join(rootDir, 'public', 'recipes.json');
if (fs.existsSync(recipesPath)) {
    let data = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
    const initialCount = data.recipes.length;

    // Filtra array di ricette: tieni solo se il file esiste
    data.recipes = data.recipes.filter(recipe => {
        // La url in recipes.json è solitamente relativa dal root es: "ricette/pasta/file.html"
        const absolutePath = path.join(rootDir, recipe.href);
        const exists = fs.existsSync(absolutePath);
        if (!exists) {
            console.log('🗑️ Rimossa ricetta orfana da JSON:', recipe.title);
        }
        return exists;
    });

    fs.writeFileSync(recipesPath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`✅ recipes.json pulito. Da ${initialCount} a ${data.recipes.length} ricette.`);
} else {
    // maybe it is not in public? Check if it is in rootDir/recipes.json or frontend root
    // Actually vite uses public/recipes.json during dev, wait, let me check where is recipes.json!
}
