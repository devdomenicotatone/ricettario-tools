/**
 * BATCH RIGENERAZIONE — Rigenera tutte le 13 ricette da famagsrl
 * con la pipeline PRO (fonti reali pre-generazione + cross-check)
 * 
 * Uso: node batch-rigenera.mjs
 */

import { execSync } from 'child_process';
import { unlinkSync, existsSync } from 'fs';
import { resolve } from 'path';

// ── Vecchi file da cancellare (slug precedenti) ──
const OLD_FILES_TO_DELETE = [
    // Test duplicati
    '../Ricettario/ricette/dolci/cantuccini-toscani-tradizionali.html',
    '../Ricettario/ricette/dolci/cantuccini-toscani-tradizionali.validazione.md',
    // Vecchi file generati
    '../Ricettario/ricette/dolci/cantuccini-toscani-classici.html',
    '../Ricettario/ricette/dolci/pasta-frolla-classica.html',
    '../Ricettario/ricette/lievitati/burger-buns-artigianali.html',
    '../Ricettario/ricette/lievitati/cartocci-alla-crema.html',
    '../Ricettario/ricette/lievitati/cornetti-classici.html',
    '../Ricettario/ricette/lievitati/impasto-rosticceria-siciliana.html',
    '../Ricettario/ricette/lievitati/panettone-classico-artigianale.html',
    '../Ricettario/ricette/lievitati/panettone-pera-cioccolato.html',
    '../Ricettario/ricette/lievitati/pasta-brioche-classica.html',
    '../Ricettario/ricette/pane/ciabatta-italiana-tradizionale.html',
    '../Ricettario/ricette/pane/pane-alle-noci.html',
    '../Ricettario/ricette/pizza/pinsa-romana-classica.html',
    '../Ricettario/ricette/pizza/pizza-napoletana-stg.html',
    // Nuovo test generato
    '../Ricettario/ricette/pizza/pizza-napoletana-tradizionale.html',
    '../Ricettario/ricette/pizza/pizza-napoletana-tradizionale.validazione.md',
];

// ── 13 ricette da rigenerare ──
const RECIPES = [
    'https://www.famagsrl.com/it/recipes/cantuccini/',
    'https://www.famagsrl.com/it/recipes/pasta-frolla/',
    'https://www.famagsrl.com/it/recipes/cornetti/',
    'https://www.famagsrl.com/it/recipes/pasta-brioche/',
    'https://www.famagsrl.com/it/recipes/pane-alle-noci/',
    'https://www.famagsrl.com/it/recipes/ciabatta/',
    'https://www.famagsrl.com/it/recipes/impasto-rositcceria-siciliana/',
    'https://www.famagsrl.com/it/recipes/burger-buns/',
    'https://www.famagsrl.com/it/recipes/cartocci-alla-crema/',
    'https://www.famagsrl.com/it/recipes/pizza-napoletana/',
    'https://www.famagsrl.com/it/recipes/pinsa-romana/',
    'https://www.famagsrl.com/it/recipes/panettone-classico/',
    'https://www.famagsrl.com/it/recipes/panettone-pera-e-cioccolato/',
];

// ── Step 1: Cancella vecchi file ──
console.log('\n🗑️  Cancello vecchi file...');
let deleted = 0;
for (const file of OLD_FILES_TO_DELETE) {
    const fullPath = resolve(process.cwd(), file);
    if (existsSync(fullPath)) {
        unlinkSync(fullPath);
        console.log(`   ✅ ${file}`);
        deleted++;
    }
}
console.log(`   Cancellati: ${deleted} file\n`);

// ── Step 2: Rigenera sequenzialmente ──
console.log('🚀 INIZIO RIGENERAZIONE BATCH\n');
const results = [];

for (let i = 0; i < RECIPES.length; i++) {
    const url = RECIPES[i];
    const num = `[${i + 1}/${RECIPES.length}]`;
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`${num} ${url}`);
    console.log(`${'═'.repeat(60)}\n`);

    try {
        execSync(
            `node crea-ricetta.js --url "${url}" --no-inject --no-image`,
            { stdio: 'inherit', timeout: 300000 } // 5 min timeout per ricetta
        );
        results.push({ url, status: '✅' });
    } catch (err) {
        console.error(`\n❌ ERRORE su ${url}: ${err.message}`);
        results.push({ url, status: '❌' });
    }

    // Pausa 2s tra ricette per non sovraccaricare API
    if (i < RECIPES.length - 1) {
        console.log('\n⏳ Pausa 2s...');
        await new Promise(r => setTimeout(r, 2000));
    }
}

// ── Riepilogo ──
console.log(`\n\n${'═'.repeat(60)}`);
console.log('RIEPILOGO BATCH RIGENERAZIONE');
console.log(`${'═'.repeat(60)}\n`);
for (const r of results) {
    console.log(`${r.status} ${r.url}`);
}
const success = results.filter(r => r.status === '✅').length;
console.log(`\n✅ ${success}/${RECIPES.length} ricette rigenerate con successo`);
