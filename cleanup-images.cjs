/**
 * CLEANUP ORPHAN IMAGES
 * Trova e rimuove immagini (JPG, WebP, AVIF) che non hanno un JSON ricetta corrispondente.
 *
 * Uso:
 *   node tools/cleanup-images.cjs          → Solo report (dry-run)
 *   node tools/cleanup-images.cjs --delete → Cancella le immagini orfane
 */
const fs = require('fs');
const path = require('path');

const DELETE = process.argv.includes('--delete');
const ricettarioPath = path.resolve(__dirname, '..', 'Ricettario');
const imagesRoot = path.join(ricettarioPath, 'public', 'images', 'ricette');
const recipesRoot = path.join(ricettarioPath, 'ricette');

// ── 1. Raccogli tutti gli slug dai JSON ricette ──
function getRecipeSlugs() {
  const slugs = new Set();
  if (!fs.existsSync(recipesRoot)) return slugs;

  const categories = fs.readdirSync(recipesRoot, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const cat of categories) {
    const catPath = path.join(recipesRoot, cat.name);
    const files = fs.readdirSync(catPath).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const slug = file.replace('.json', '');
      slugs.add(`${cat.name}/${slug}`);

      // Leggi anche il campo "image" dal JSON per coprire path non convenzionali
      try {
        const data = JSON.parse(fs.readFileSync(path.join(catPath, file), 'utf8'));
        if (data.image) {
          // Estrai il path relativo senza "images/ricette/"
          const imgRel = data.image.replace(/^images\/ricette\//, '').replace(/\.[^.]+$/, '');
          slugs.add(imgRel);
        }
      } catch {}
    }
  }
  return slugs;
}

// ── 2. Scansiona tutte le immagini ──
function findAllImages(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findAllImages(fullPath));
    } else if (/\.(jpg|jpeg|png|webp|avif)$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── 3. Confronta e trova orfane ──
function main() {
  console.log('\n🔍 CLEANUP ORPHAN IMAGES');
  console.log(`   ${DELETE ? '🗑️  Modalità DELETE — le immagini orfane verranno cancellate!' : '👀 Modalità DRY-RUN — nessun file verrà cancellato'}\n`);

  const slugs = getRecipeSlugs();
  console.log(`   📋 ${slugs.size} ricette trovate nei JSON\n`);

  const allImages = findAllImages(imagesRoot);
  console.log(`   📁 ${allImages.length} immagini totali in public/images/ricette/\n`);

  // File speciali da non cancellare mai
  const KEEP_FILES = new Set(['index.jpg', 'index.webp', 'index.avif']);

  const orphans = [];
  const kept = [];

  for (const imgPath of allImages) {
    const relPath = path.relative(imagesRoot, imgPath);
    const fileName = path.basename(imgPath);

    // Salta file indice
    if (KEEP_FILES.has(fileName)) {
      kept.push(relPath);
      continue;
    }

    // Estrai category/slug (senza estensione)
    const slug = relPath.replace(/\\/g, '/').replace(/\.[^.]+$/, '');

    if (!slugs.has(slug)) {
      orphans.push({ relPath, fullPath: imgPath, size: fs.statSync(imgPath).size });
    }
  }

  if (orphans.length === 0) {
    console.log('   ✅ Nessuna immagine orfana trovata! Tutto pulito.\n');
    return;
  }

  // Raggruppa per categoria
  const byCategory = {};
  let totalSize = 0;
  for (const o of orphans) {
    const cat = o.relPath.split(/[/\\]/)[0];
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(o);
    totalSize += o.size;
  }

  console.log(`   ⚠️  ${orphans.length} immagini orfane trovate (${formatBytes(totalSize)}):\n`);

  for (const [cat, files] of Object.entries(byCategory)) {
    console.log(`   📁 ${cat}/`);
    for (const f of files) {
      console.log(`      🗑️  ${path.basename(f.relPath)} (${formatBytes(f.size)})`);
    }
    console.log('');
  }

  if (DELETE) {
    console.log('   🗑️  Cancellazione in corso...\n');
    let deleted = 0;
    for (const o of orphans) {
      try {
        fs.unlinkSync(o.fullPath);
        deleted++;
      } catch (err) {
        console.error(`   ❌ Errore: ${o.relPath}: ${err.message}`);
      }
    }
    console.log(`   ✅ ${deleted}/${orphans.length} file cancellati. Spazio liberato: ${formatBytes(totalSize)}\n`);
  } else {
    console.log('   💡 Per cancellare, esegui:');
    console.log('      node tools/cleanup-images.cjs --delete\n');
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

main();
