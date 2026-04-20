/**
 * MIGRAZIONE: Rimuovi variants + unifica stepsSpiral/stepsHand → steps
 * 
 * Per ogni ricetta .json:
 * 1. stepsSpiral → steps (pane/pizza/lievitati/focacce)
 * 2. stepsHand senza stepsSpiral → steps (dolci, ricette solo-mano)
 * 3. stepsExtruder → steps (pasta)
 * 4. Elimina: stepsHand, stepsSpiral, stepsExtruder, variants
 * 5. Per ogni ingrediente: rimuovi setupNote, tieni solo note
 * 6. Salva con backup .pre-migration
 */
import { readFileSync, writeFileSync, readdirSync, copyFileSync } from 'fs';
import { join, basename, resolve } from 'path';

const RICETTE_DIR = resolve('../Ricettario/ricette');
const DRY_RUN = process.argv.includes('--dry-run');

function findRecipes(dir) {
    const results = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findRecipes(fullPath));
        } else if (entry.name.endsWith('.json') && !entry.name.includes('.backup') && !entry.name.includes('.pre-edit') && !entry.name.includes('.pre-migration')) {
            results.push(fullPath);
        }
    }
    return results;
}

const recipes = findRecipes(RICETTE_DIR);
console.log(`\n${'═'.repeat(60)}`);
console.log(`  MIGRAZIONE: Rimuovi Varianti + Unifica Step`);
console.log(`  ${DRY_RUN ? '🔍 DRY RUN — nessuna modifica' : '🚀 LIVE — modifiche applicate'}`);
console.log(`  Ricette trovate: ${recipes.length}`);
console.log(`${'═'.repeat(60)}\n`);

let migrated = 0, skipped = 0, errors = 0;

for (const file of recipes) {
    const name = basename(file, '.json');
    try {
        const raw = readFileSync(file, 'utf-8');
        const recipe = JSON.parse(raw);
        const changes = [];

        // 1. Unifica step: stepsSpiral/stepsExtruder → steps
        if (recipe.stepsSpiral?.length > 0 && !recipe.steps?.length) {
            recipe.steps = recipe.stepsSpiral;
            changes.push(`stepsSpiral (${recipe.stepsSpiral.length}) → steps`);
        } else if (recipe.stepsExtruder?.length > 0 && !recipe.steps?.length) {
            recipe.steps = recipe.stepsExtruder;
            changes.push(`stepsExtruder (${recipe.stepsExtruder.length}) → steps`);
        } else if (recipe.stepsHand?.length > 0 && !recipe.steps?.length && !recipe.stepsSpiral?.length && !recipe.stepsExtruder?.length) {
            recipe.steps = recipe.stepsHand;
            changes.push(`stepsHand (${recipe.stepsHand.length}) → steps (solo-mano)`);
        }

        // 2. Rimuovi campi obsoleti
        const removedFields = [];
        if (recipe.stepsSpiral) { delete recipe.stepsSpiral; removedFields.push('stepsSpiral'); }
        if (recipe.stepsHand) { delete recipe.stepsHand; removedFields.push('stepsHand'); }
        if (recipe.stepsExtruder) { delete recipe.stepsExtruder; removedFields.push('stepsExtruder'); }
        if (recipe.variants) { delete recipe.variants; removedFields.push('variants'); }
        if (removedFields.length) changes.push(`rimossi: ${removedFields.join(', ')}`);

        // 3. Rimuovi setupNote da tutti gli ingredienti
        let setupNoteCount = 0;
        const cleanItems = (items) => {
            for (const item of items || []) {
                if (item.setupNote) {
                    delete item.setupNote;
                    setupNoteCount++;
                }
            }
        };
        if (recipe.ingredientGroups) {
            for (const g of recipe.ingredientGroups) {
                cleanItems(g.items);
            }
        }
        cleanItems(recipe.ingredients);
        if (setupNoteCount > 0) changes.push(`${setupNoteCount} setupNote rimossi`);

        // 4. Se non ci sono cambiamenti, skip
        if (changes.length === 0) {
            skipped++;
            console.log(`  ⏭️  ${name} — nessuna modifica necessaria`);
            continue;
        }

        if (DRY_RUN) {
            console.log(`  🔍 ${name} — ${changes.join(' | ')}`);
        } else {
            // Backup
            copyFileSync(file, file.replace('.json', '.pre-migration.json'));
            // Scrivi il file migrato
            writeFileSync(file, JSON.stringify(recipe, null, 2) + '\n', 'utf-8');
            console.log(`  ✅ ${name} — ${changes.join(' | ')}`);
        }
        migrated++;

    } catch (err) {
        errors++;
        console.log(`  💥 ${name}: ${err.message}`);
    }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`  RISULTATO: ${migrated} migrate | ${skipped} invariate | ${errors} errori`);
if (DRY_RUN) console.log(`  ⚠️  DRY RUN — riesegui senza --dry-run per applicare`);
console.log(`${'═'.repeat(60)}\n`);
