/**
 * MIGRAZIONE INGREDIENTI → ingredientGroups
 * 
 * Processa TUTTE le ricette JSON e chiede a Claude di raggruppare
 * gli ingredienti per componente logico (Biga, Poolish, Impasto Finale, Decorazione, ecc.)
 * 
 * Uso: node migrate-ingredient-groups.mjs [--dry-run] [--filter <slug>]
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { callClaude, parseClaudeJson } from './src/utils/api.js';

// ── Config ──
const RECIPES_DIR = join(import.meta.dirname, '..', 'Ricettario', 'ricette');
const DRY_RUN = process.argv.includes('--dry-run');
const FILTER = process.argv.includes('--filter') ? process.argv[process.argv.indexOf('--filter') + 1] : null;

const MIGRATION_PROMPT = `Sei un esperto panificatore e pasticciere. Il tuo compito è RIORGANIZZARE gli ingredienti di una ricetta JSON dal formato piatto al formato con GRUPPI LOGICI.

REGOLE:
1. Analizza la ricetta: titolo, ingredienti, passaggi (stepsSpiral/stepsHand/stepsExtruder/stepsCondiment) per capire i COMPONENTI LOGICI della ricetta.

2. Se la ricetta ha 2+ COMPONENTI LOGICHE DISTINTE, crea i gruppi. Esempi:
   - Pane con poolish: "Per il Poolish" + "Per l'Impasto Finale"
   - Pane con biga: "Per la Biga" + "Per l'Impasto Finale"
   - Dolce con frolla + crema: "Per la Pasta Frolla" + "Per la Crema"
   - Pizza con biga + criscito: "Per la Biga" + "Per il Criscito" + "Per l'Impasto Finale"
   - Cornetti sfogliati: "Per l'Impasto" + "Per la Sfogliatura"
   - Panettone: "Per il Primo Impasto" + "Per il Secondo Impasto" o "Per il Lievitino" + "Per l'Impasto" (in base alla ricetta)
   - Ricetta con decorazione: aggiungi "Per la Decorazione" o "Per la Finitura"
   - Focaccia con condimento: "Per l'Impasto" + "Per il Condimento"

3. Se la ricetta ha UN SOLO componente logico (es. biscotti semplici, pane diretto senza prefermento), crea UN SOLO gruppo con nome generico:
   - "Per l'Impasto" (per impasti)
   - "Per il Composto" (per dolci/torte)
   - Scelta basata sul tipo di ricetta

4. OGNI ingrediente deve finire in ESATTAMENTE un gruppo. Non duplicare, non omettere.

5. L'oggetto di ogni ingrediente DEVE rimanere IDENTICO (name, note, grams, setupNote) — cambi solo la STRUTTURA di raggruppamento.

6. I nomi dei gruppi devono essere in italiano, con la preposizione "Per" davanti. Esempi:
   - "Per il Poolish", "Per la Biga", "Per l'Impasto Finale"
   - "Per la Pasta Frolla", "Per la Crema Pasticcera"
   - "Per la Sfogliatura", "Per la Farcitura", "Per la Decorazione"
   - "Per il Condimento", "Per la Finitura"

RISPONDI SOLO con un array JSON di gruppi nel formato:
[
  {
    "group": "Nome del Gruppo",
    "items": [
      { ... oggetto ingrediente originale identico ... }
    ]
  }
]

NIENT'ALTRO. Solo l'array JSON.`;

// ── Trova tutte le ricette ──
function findAllRecipes(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findAllRecipes(full));
    } else if (entry.endsWith('.json')) {
      results.push(full);
    }
  }
  return results;
}

// ── Migra una ricetta ──
async function migrateRecipe(filePath) {
  const relPath = relative(RECIPES_DIR, filePath);
  const raw = readFileSync(filePath, 'utf-8');
  const recipe = JSON.parse(raw);

  // Skip se già migrata
  if (recipe.ingredientGroups?.length > 0) {
    console.log(`   ⏭️  ${relPath} — già migrata, skip`);
    return { file: relPath, status: 'skipped', reason: 'already migrated' };
  }

  // Skip se non ha ingredienti
  if (!recipe.ingredients?.length) {
    console.log(`   ⏭️  ${relPath} — nessun ingrediente, skip`);
    return { file: relPath, status: 'skipped', reason: 'no ingredients' };
  }

  // Filtro opzionale
  if (FILTER && !recipe.slug?.includes(FILTER)) {
    return { file: relPath, status: 'skipped', reason: 'filtered out' };
  }

  console.log(`\n   🔄 ${relPath} (${recipe.title})`);
  console.log(`      ${recipe.ingredients.length} ingredienti da raggruppare...`);

  // Prepara context per Claude
  const recipeContext = {
    title: recipe.title,
    category: recipe.category,
    ingredients: recipe.ingredients,
    suspensions: recipe.suspensions,
    // Passa i titoli degli step per dare contesto a Claude
    stepsSpiral: recipe.stepsSpiral?.map(s => s.title) || [],
    stepsHand: recipe.stepsHand?.map(s => s.title) || [],
    stepsExtruder: recipe.stepsExtruder?.map(s => s.title) || [],
    stepsCondiment: recipe.stepsCondiment?.map(s => s.title) || [],
  };

  try {
    const response = await callClaude({
      model: 'claude-sonnet-4-5-20250929',
      maxTokens: 4096,
      system: MIGRATION_PROMPT,
      messages: [{
        role: 'user',
        content: `Ecco la ricetta da migrare:\n\n${JSON.stringify(recipeContext, null, 2)}`
      }],
    });

    const groups = parseClaudeJson(response);

    if (!Array.isArray(groups) || groups.length === 0) {
      throw new Error('Claude ha restituito un formato non valido (non è un array)');
    }

    // Verifica che tutti gli ingredienti siano presenti
    const originalCount = recipe.ingredients.length;
    const migratedCount = groups.reduce((sum, g) => sum + g.items.length, 0);

    if (migratedCount !== originalCount) {
      console.log(`      ⚠️  Mismatch: ${originalCount} originali → ${migratedCount} raggruppati`);
    }

    // Mostra i gruppi
    for (const g of groups) {
      console.log(`      📦 ${g.group} (${g.items.length} ingredienti)`);
    }

    if (!DRY_RUN) {
      // Aggiorna il JSON
      recipe.ingredientGroups = groups;
      recipe.ingredients = [];

      // Scrivi il file
      writeFileSync(filePath, JSON.stringify(recipe, null, 2) + '\n', 'utf-8');
      console.log(`      ✅ Salvato!`);
    } else {
      console.log(`      🔍 DRY RUN — non salvato`);
    }

    return { file: relPath, status: 'migrated', groups: groups.map(g => g.group) };

  } catch (err) {
    console.error(`      ❌ ERRORE: ${err.message}`);
    return { file: relPath, status: 'error', error: err.message };
  }
}

// ── Main ──
async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   MIGRAZIONE ingredientGroups — Ricettario      ║');
  console.log('╚══════════════════════════════════════════════════╝');
  if (DRY_RUN) console.log('   MODE: 🔍 DRY RUN (nessuna modifica)');
  if (FILTER) console.log(`   FILTER: ${FILTER}`);
  console.log('');

  const files = findAllRecipes(RECIPES_DIR);
  console.log(`   📁 Trovate ${files.length} ricette in ${RECIPES_DIR}\n`);

  const results = [];
  for (const file of files) {
    const result = await migrateRecipe(file);
    results.push(result);

    // Pausa tra le chiamate API per non martellare
    if (result.status === 'migrated') {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Report
  console.log('\n\n══════════════════════════════════════════');
  console.log('   REPORT MIGRAZIONE');
  console.log('══════════════════════════════════════════');

  const migrated = results.filter(r => r.status === 'migrated');
  const skipped = results.filter(r => r.status === 'skipped');
  const errors = results.filter(r => r.status === 'error');

  console.log(`   ✅ Migrate:  ${migrated.length}`);
  console.log(`   ⏭️  Skippate: ${skipped.length}`);
  console.log(`   ❌ Errori:   ${errors.length}`);

  if (migrated.length > 0) {
    console.log('\n   Ricette migrate:');
    for (const r of migrated) {
      console.log(`     ${r.file}: ${r.groups.join(' · ')}`);
    }
  }

  if (errors.length > 0) {
    console.log('\n   ⚠️  Ricette con errore:');
    for (const r of errors) {
      console.log(`     ${r.file}: ${r.error}`);
    }
  }

  console.log('\n');
}

main().catch(err => {
  console.error('💥 Errore fatale:', err);
  process.exit(1);
});
