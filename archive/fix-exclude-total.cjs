/**
 * Script deterministico — Scan & Fix excludeFromTotal
 * 
 * Logica: se la somma dei grammi di un gruppo ≈ grammi di un ingrediente
 * in un gruppo successivo, quel gruppo è un pre-impasto → excludeFromTotal: true
 * 
 * Zero API, zero AI — pura matematica.
 */

const fs = require('fs');
const path = require('path');

const RICETTE_DIR = path.join(__dirname, '..', 'Ricettario', 'ricette');
const DRY_RUN = process.argv.includes('--dry-run');
const TOLERANCE = 0.05; // 5% tolerance per match

// Nomi di prodotti intermedi (il match deve avere uno di questi nel nome)
const INTERMEDIATE_KEYWORDS = [
  'biga', 'poolish', 'lievitino', 'prefermento', 'autolisi',
  'matura', 'maturo', 'precedente', 'lievito madre',
];

function isIntermediateName(name) {
  const lower = name.toLowerCase();
  return INTERMEDIATE_KEYWORDS.some(kw => lower.includes(kw));
}

function scanRecipes() {
  const cats = fs.readdirSync(RICETTE_DIR).filter(d =>
    fs.statSync(path.join(RICETTE_DIR, d)).isDirectory()
  );

  let total = 0, withGroups = 0, multiGroup = 0;
  const fixes = [];

  for (const cat of cats) {
    const dir = path.join(RICETTE_DIR, cat);
    const files = fs.readdirSync(dir).filter(f =>
      f.endsWith('.json') &&
      !f.includes('verifica') &&
      !f.includes('qualita') &&
      !f.includes('validazione')
    );

    for (const file of files) {
      total++;
      const filePath = path.join(dir, file);
      const recipe = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      if (!recipe.ingredientGroups?.length) continue;
      withGroups++;

      if (recipe.ingredientGroups.length <= 1) continue;
      multiGroup++;

      const groups = recipe.ingredientGroups;

      for (let i = 0; i < groups.length - 1; i++) {
        const groupItems = groups[i].items || [];
        const groupSum = groupItems.reduce((s, it) => s + (it.grams || 0), 0);
        
        // Skip gruppi con somma troppo bassa (es. "Per lo Spolvero")
        if (groupSum < 10) continue;

        // Cerca un ingrediente nel gruppo successivo che matchi la somma
        // E che abbia un nome che indica un prodotto intermedio
        for (let j = i + 1; j < groups.length; j++) {
          for (const item of (groups[j].items || [])) {
            if (item.grams &&
                Math.abs(item.grams - groupSum) < groupSum * TOLERANCE &&
                isIntermediateName(item.name)) {
              const alreadyDone = groupItems.every(it => it.excludeFromTotal === true);
              
              fixes.push({
                file,
                filePath,
                groupIdx: i,
                groupName: groups[i].group,
                groupSum,
                matchItem: item.name,
                matchGrams: item.grams,
                alreadyDone,
                recipe
              });
            }
          }
        }
      }
    }
  }

  return { total, withGroups, multiGroup, fixes };
}

function applyFixes(fixes) {
  let applied = 0;
  
  for (const fix of fixes) {
    if (fix.alreadyDone) continue;
    
    const group = fix.recipe.ingredientGroups[fix.groupIdx];
    for (const item of group.items) {
      item.excludeFromTotal = true;
    }
    
    fs.writeFileSync(fix.filePath, JSON.stringify(fix.recipe, null, 2) + '\n', 'utf-8');
    applied++;
  }
  
  return applied;
}

// ── Main ──
console.log('🔍 Scanning ricette per excludeFromTotal...\n');

const { total, withGroups, multiGroup, fixes } = scanRecipes();

console.log(`📊 Statistiche:`);
console.log(`   Totale ricette JSON:    ${total}`);
console.log(`   Con ingredientGroups:   ${withGroups}`);
console.log(`   Con gruppi multipli:    ${multiGroup}`);
console.log(`   Serve excludeFromTotal: ${fixes.length}`);
console.log();

if (fixes.length === 0) {
  console.log('✅ Nessuna ricetta necessita di fix!');
  process.exit(0);
}

for (const fix of fixes) {
  const icon = fix.alreadyDone ? '✅' : '⚠️';
  console.log(`${icon} ${fix.file}`);
  console.log(`   Gruppo "${fix.groupName}" (${fix.groupSum}g) → matcha "${fix.matchItem}" (${fix.matchGrams}g)`);
  if (fix.alreadyDone) console.log(`   Già configurato — skip`);
}

if (DRY_RUN) {
  console.log('\n🏃 DRY RUN — nessuna modifica applicata');
  console.log('   Rimuovi --dry-run per applicare le fix');
} else {
  const toFix = fixes.filter(f => !f.alreadyDone);
  if (toFix.length > 0) {
    console.log(`\n🔧 Applico fix a ${toFix.length} ricette...`);
    const applied = applyFixes(fixes);
    console.log(`✅ ${applied} ricette aggiornate!`);
  } else {
    console.log('\n✅ Tutte le ricette sono già configurate!');
  }
}
