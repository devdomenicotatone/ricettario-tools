/**
 * MIGRATE RECIPES — Aggiunge token {id:base} ai testi degli step
 * 
 * Questo script analizza ogni ricetta JSON e sostituisce le dosi hardcoded 
 * nei testi degli step con token {nome_generico:valore_base} per il 
 * sistema di dosi dinamiche del frontend.
 * 
 * Strategia: pattern-matching deterministico (senza AI)
 *   1. Raccoglie tutti gli ingredienti con le loro dosi dal JSON
 *   2. Per ogni step, cerca occorrenze di "XXXg" dove XXX corrisponde a una dose nota
 *   3. Sostituisce con {token_id:XXX}g
 * 
 * Usage: node tools/migrate-tokens.js [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { resolve, join, relative } from 'path';

const RECIPES_DIR = resolve(import.meta.dirname, '../Ricettario/ricette');
const DRY_RUN = process.argv.includes('--dry-run');
const STEP_KEYS = ['steps', 'stepsCondiment'];

// ── Token name generator ──
function generateTokenId(ingredientName, groupName = '') {
  const name = ingredientName.toLowerCase()
    .replace(/\(.*?\)/g, '')  // rimuovi parentesi
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // rimuovi accenti
    .trim();

  // Mappatura nomi comuni → token ID
  const tokenMap = [
    { match: /farina.*tipo\s*0|farina.*media/i, id: 'farina_media' },
    { match: /farina.*tipo\s*1|farina.*integrale/i, id: 'farina_integrale' },
    { match: /farina.*manitoba|farina.*w\s*3[0-9]{2}/i, id: 'farina_forte' },
    { match: /semola|semolato/i, id: 'semola' },
    { match: /lievito.*madre|lievito.*naturale|pasta.*madre/i, id: 'lievito_madre' },
    { match: /lievito.*birra.*fresco/i, id: 'lievito_fresco' },
    { match: /lievito.*secco/i, id: 'lievito_secco' },
    { match: /lievito/i, id: 'lievito' },
    { match: /criscito/i, id: 'criscito' },
    { match: /acqua/i, id: 'acqua' },
    { match: /sale/i, id: 'sale' },
    { match: /olio.*oliva|olio.*evo/i, id: 'olio_evo' },
    { match: /olio/i, id: 'olio' },
    { match: /burro/i, id: 'burro' },
    { match: /strutto/i, id: 'strutto' },
    { match: /zucchero/i, id: 'zucchero' },
    { match: /miele/i, id: 'miele' },
    { match: /malto|malto.*orzo/i, id: 'malto' },
    { match: /uov[ao]/i, id: 'uova' },
    { match: /latte/i, id: 'latte' },
    { match: /panna/i, id: 'panna' },
    { match: /ricotta/i, id: 'ricotta' },
    { match: /patate|patata/i, id: 'patate' },
  ];

  // Trova il match migliore
  for (const { match, id } of tokenMap) {
    if (match.test(ingredientName)) {
      return id;
    }
  }

  // Fallback: genera da nome
  return name
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .substring(0, 20) || 'ingrediente';
}

// ── Suffisso per disambiguare token duplicati ──
function makeUniqueTokens(ingredients, groupName = '') {
  const tokens = [];
  const usedIds = new Map(); // id → count
  const groupSuffix = groupName ? '_' + groupName.toLowerCase()
    .replace(/per (il|la|l'|lo|gli|le|i)\s*/gi, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .substring(0, 15)
    : '';

  for (const ing of ingredients) {
    if (ing.grams == null || ing.grams === 0) continue;

    let baseId = generateTokenId(ing.name);

    // Aggiungi suffisso gruppo se presente
    if (groupSuffix) {
      baseId = baseId + groupSuffix;
    }

    // Disambigua se già usato
    const count = usedIds.get(baseId) || 0;
    usedIds.set(baseId, count + 1);
    const finalId = count > 0 ? `${baseId}_${count + 1}` : baseId;

    tokens.push({
      name: ing.name,
      grams: ing.grams,
      tokenId: finalId,
    });
  }

  return tokens;
}

// ── Tokenize un testo di step ──
function tokenizeStepText(text, tokens) {
  if (!text) return { text, changes: 0 };

  let result = text;
  let changes = 0;

  // Ordina per grams descrescenti (per evitare che "30" matchi prima di "300")
  const sortedTokens = [...tokens].sort((a, b) => {
    const aStr = String(a.grams);
    const bStr = String(b.grams);
    return bStr.length - aStr.length || b.grams - a.grams;
  });

  for (const { grams, tokenId } of sortedTokens) {
    // Cerca pattern: "XXXg" o "XXX g" o "~XXXg" dove XXX è la dose esatta
    const gramStr = String(grams);
    // Evita di tokenizzare se è già un token
    const tokenPattern = new RegExp(
      `(?<!\\{[a-z_]+:)(?<![\\d.])~?(${gramStr.replace('.', '\\.')})(?=\\s*g(?!ram|lutin))`,
      'g'
    );

    const newText = result.replace(tokenPattern, (match, gramsMatch) => {
      changes++;
      return `{${tokenId}:${gramsMatch}}`;
    });

    result = newText;
  }

  return { text: result, changes };
}

// ── Process a single recipe file ──
function processRecipe(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  let recipe;
  try {
    recipe = JSON.parse(raw);
  } catch (e) {
    console.log(`  ❌ JSON non valido: ${e.message}`);
    return { changed: false, error: e.message };
  }

  // Controlla se ha già token (skip se già migrato)
  const hasTokens = STEP_KEYS.some(key =>
    recipe[key]?.some(s => /\{[a-z_]+:\d+\.?\d*\}/.test(s.text))
  );
  if (hasTokens) {
    console.log(`  ⏭️  Già tokenizzata — skip`);
    return { changed: false, skipped: true };
  }

  // Raccogli tutti gli ingredienti con token IDs
  let allTokens = [];

  if (recipe.ingredientGroups?.length) {
    for (const group of recipe.ingredientGroups) {
      const groupTokens = makeUniqueTokens(group.items, group.group);
      allTokens.push(...groupTokens);
    }
  } else if (recipe.ingredients?.length) {
    allTokens = makeUniqueTokens(recipe.ingredients);
  }

  if (allTokens.length === 0) {
    console.log(`  ⚠️  Nessun ingrediente con grammi — skip`);
    return { changed: false, noIngredients: true };
  }

  // Tokenize step texts
  let totalChanges = 0;

  for (const key of STEP_KEYS) {
    if (!recipe[key]?.length) continue;

    for (const step of recipe[key]) {
      const { text: newText, changes } = tokenizeStepText(step.text, allTokens);
      if (changes > 0) {
        step.text = newText;
        totalChanges += changes;
      }
    }
  }

  if (totalChanges === 0) {
    console.log(`  ⚠️  Nessuna dose trovata negli step — skip`);
    return { changed: false, noMatches: true };
  }

  // Scrivi il file aggiornato
  if (!DRY_RUN) {
    writeFileSync(filePath, JSON.stringify(recipe, null, 2) + '\n', 'utf-8');
  }

  console.log(`  ✅ ${totalChanges} token inseriti ${DRY_RUN ? '(dry-run)' : ''}`);
  return { changed: true, tokenCount: totalChanges };
}

// ── Main ──
function main() {
  console.log(`\n🔄 Migrazione Token Dosi Dinamiche`);
  console.log(`   Directory: ${RECIPES_DIR}`);
  console.log(`   Modalità: ${DRY_RUN ? '🧪 DRY RUN (nessuna modifica)' : '⚡ LIVE'}\n`);

  let totalFiles = 0;
  let changedFiles = 0;
  let totalTokens = 0;

  // Scansiona ricorsivamente
  function scanDir(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith('.json') && !entry.name.includes('.qualita.')) {
        totalFiles++;
        const rel = relative(RECIPES_DIR, fullPath);
        console.log(`📄 ${rel}`);
        const result = processRecipe(fullPath);
        if (result.changed) {
          changedFiles++;
          totalTokens += result.tokenCount;
        }
      }
    }
  }

  scanDir(RECIPES_DIR);

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 Risultato:`);
  console.log(`   File analizzati: ${totalFiles}`);
  console.log(`   File aggiornati: ${changedFiles}`);
  console.log(`   Token inseriti:  ${totalTokens}`);
  if (DRY_RUN) {
    console.log(`\n   ℹ️  Esegui senza --dry-run per applicare le modifiche`);
  }
  console.log('');
}

main();
