/**
 * OPTIMIZE IMAGES — AVIF + WebP Generator
 * Scansiona public/images/ e genera versioni AVIF e WebP di ogni JPG/PNG.
 * Mantiene l'originale come fallback.
 *
 * Uso: node tools/optimize-images.cjs [--force]
 *   --force  Rigenera anche file già esistenti
 */
const fs = require('fs');
const path = require('path');
const sharp = require(require.resolve('sharp', { paths: [path.resolve(__dirname, '..', 'Ricettario')] }));

// ── Config ──
const IMAGES_ROOT = path.resolve(__dirname, '..', 'Ricettario', 'public', 'images');
const MAX_WIDTH_CARD = 800;      // Card e strumenti
const MAX_WIDTH_HERO = 1920;     // Hero ricette (background)
const WEBP_QUALITY = 80;
const AVIF_QUALITY = 50;
const FORCE = process.argv.includes('--force');

// Statistiche
let stats = { total: 0, skipped: 0, converted: 0, errors: 0 };
let totalSaved = 0;

/**
 * Determina la larghezza massima in base al path.
 * Le immagini delle ricette vengono usate come hero → massima risoluzione.
 */
function getMaxWidth(filePath) {
  if (filePath.includes('ricette')) return MAX_WIDTH_HERO;
  return MAX_WIDTH_CARD;
}

/**
 * Converte una singola immagine in WebP e AVIF.
 */
async function convertImage(filePath) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const webpPath = path.join(dir, `${base}.webp`);
  const avifPath = path.join(dir, `${base}.avif`);

  stats.total++;

  // Skip se già convertito (e non --force)
  if (!FORCE && fs.existsSync(webpPath) && fs.existsSync(avifPath)) {
    const srcTime = fs.statSync(filePath).mtimeMs;
    const webpTime = fs.statSync(webpPath).mtimeMs;
    const avifTime = fs.statSync(avifPath).mtimeMs;
    if (webpTime >= srcTime && avifTime >= srcTime) {
      stats.skipped++;
      return;
    }
  }

  try {
    const maxWidth = getMaxWidth(filePath);
    const originalSize = fs.statSync(filePath).size;

    // Pipeline base: ridimensiona se necessario
    const pipeline = sharp(filePath).resize({
      width: maxWidth,
      withoutEnlargement: true,
    });

    // WebP
    await pipeline.clone().webp({ quality: WEBP_QUALITY }).toFile(webpPath);
    const webpSize = fs.statSync(webpPath).size;

    // AVIF
    await pipeline.clone().avif({ quality: AVIF_QUALITY }).toFile(avifPath);
    const avifSize = fs.statSync(avifPath).size;

    const savedWebp = ((1 - webpSize / originalSize) * 100).toFixed(1);
    const savedAvif = ((1 - avifSize / originalSize) * 100).toFixed(1);
    totalSaved += (originalSize - avifSize);

    const relPath = path.relative(IMAGES_ROOT, filePath);
    console.log(`  ✅ ${relPath}`);
    console.log(`     JPG: ${formatBytes(originalSize)} → WebP: ${formatBytes(webpSize)} (-${savedWebp}%) | AVIF: ${formatBytes(avifSize)} (-${savedAvif}%)`);

    stats.converted++;
  } catch (err) {
    const relPath = path.relative(IMAGES_ROOT, filePath);
    console.error(`  ❌ ${relPath}: ${err.message}`);
    stats.errors++;
  }
}

/**
 * Scansiona ricorsivamente una directory per immagini.
 */
function findImages(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findImages(fullPath));
    } else if (/\.(jpg|jpeg|png)$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ── Main ──
async function main() {
  console.log('\n🖼️  OPTIMIZE IMAGES — AVIF + WebP Generator');
  console.log(`   📁 Root: ${IMAGES_ROOT}`);
  console.log(`   ${FORCE ? '🔄 Modalità FORCE: rigenera tutto' : '⚡ Modalità incrementale: solo nuove/modificate'}\n`);

  const images = findImages(IMAGES_ROOT);

  if (images.length === 0) {
    console.log('   ⚠️  Nessuna immagine trovata!\n');
    return;
  }

  console.log(`   📊 Trovate ${images.length} immagini sorgente\n`);

  for (const img of images) {
    await convertImage(img);
  }

  console.log('\n' + '═'.repeat(50));
  console.log(`   📊 RISULTATI:`);
  console.log(`      Totale:    ${stats.total}`);
  console.log(`      Convertite: ${stats.converted}`);
  console.log(`      Saltate:   ${stats.skipped}`);
  console.log(`      Errori:    ${stats.errors}`);
  if (totalSaved > 0) {
    console.log(`      💾 Spazio risparmiato (AVIF vs JPG): ${formatBytes(totalSaved)}`);
  }
  console.log('═'.repeat(50) + '\n');
}

main().catch(err => {
  console.error('❌ Errore fatale:', err);
  process.exit(1);
});
