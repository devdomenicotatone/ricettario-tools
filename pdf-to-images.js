#!/usr/bin/env node
/**
 * 📄➡️🖼️ PDF to Images Converter
 * 
 * Divide ogni PDF in singole pagine e le converte in immagini PNG.
 * Le immagini vengono salvate nella stessa cartella dei PDF originali.
 * I PDF originali vengono eliminati dopo la conversione.
 * 
 * Uso:
 *   node pdf-to-images.js                        ← converte tutti i PDF in public/pdf/
 *   node pdf-to-images.js --input "path/to/pdf"  ← converte un PDF specifico
 *   node pdf-to-images.js --keep                 ← mantiene i PDF originali
 *   node pdf-to-images.js --quality 90           ← qualità PNG (default: 100)
 *   node pdf-to-images.js --scale 2              ← scala rendering (default: 2)
 */

import { readdir, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, basename, join } from 'path';

// ── Parse CLI args ──
function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].replace('--', '');
            parsed[key] = (args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : true;
            if (parsed[key] !== true) i++;
        }
    }
    return parsed;
}

async function convertPdfToImages(pdfPath, options = {}) {
    const { scale = 2, keepOriginal = false } = options;
    const pdfName = basename(pdfPath, '.pdf');
    const outputDir = resolve(pdfPath, '..');

    // Crea sottocartella per le immagini di questo PDF
    const imgDir = join(outputDir, pdfName);
    if (!existsSync(imgDir)) {
        await mkdir(imgDir, { recursive: true });
    }

    console.log(`\n📄 Converto: ${basename(pdfPath)}`);
    console.log(`   📁 Output: ${imgDir}`);

    // Importa pdf-to-img (ESM dynamic import)
    const { pdf } = await import('pdf-to-img');

    let pageNum = 0;
    const pages = await pdf(pdfPath, { scale });

    for await (const image of pages) {
        pageNum++;
        const imgName = `${pdfName}_pagina_${String(pageNum).padStart(3, '0')}.png`;
        const imgPath = join(imgDir, imgName);

        // image è un Buffer PNG
        const { writeFile } = await import('fs/promises');
        await writeFile(imgPath, image);

        process.stdout.write(`   🖼️ Pagina ${pageNum} → ${imgName}\r`);
    }

    console.log(`\n   ✅ ${pageNum} pagine convertite in PNG`);

    // Elimina il PDF originale se richiesto
    if (!keepOriginal) {
        await unlink(pdfPath);
        console.log(`   🗑️ PDF originale eliminato: ${basename(pdfPath)}`);
    }

    return { pdfName, pages: pageNum, outputDir: imgDir };
}

// ── Main ──
async function main() {
    const args = parseArgs();

    console.log('\n🖼️ ═══════════════════════════════════════');
    console.log('   PDF → IMAGES CONVERTER');
    console.log('═══════════════════════════════════════════\n');

    const scale = parseFloat(args.scale) || 2;
    const keepOriginal = !!args.keep;
    const options = { scale, keepOriginal };

    if (keepOriginal) {
        console.log('📌 Modalità: mantieni PDF originali');
    } else {
        console.log('🗑️ Modalità: elimina PDF dopo conversione');
    }
    console.log(`📐 Scala rendering: ${scale}x\n`);

    let pdfFiles = [];

    if (args.input) {
        // PDF specifico
        const inputPath = resolve(process.cwd(), args.input);
        if (!existsSync(inputPath)) {
            console.error(`❌ File non trovato: ${inputPath}`);
            process.exit(1);
        }
        pdfFiles.push(inputPath);
    } else {
        // Tutti i PDF nella cartella public/pdf/
        const pdfDir = resolve(process.cwd(), '..', 'Ricettario', 'public', 'pdf');
        if (!existsSync(pdfDir)) {
            console.error(`❌ Cartella non trovata: ${pdfDir}`);
            process.exit(1);
        }

        const files = await readdir(pdfDir);
        pdfFiles = files
            .filter(f => f.toLowerCase().endsWith('.pdf'))
            .map(f => join(pdfDir, f));

        if (pdfFiles.length === 0) {
            console.log('⚠️ Nessun PDF trovato nella cartella.');
            process.exit(0);
        }

        console.log(`📂 Trovati ${pdfFiles.length} PDF in: ${pdfDir}\n`);
    }

    const results = [];

    for (const pdfPath of pdfFiles) {
        try {
            const result = await convertPdfToImages(pdfPath, options);
            results.push(result);
        } catch (err) {
            console.error(`\n❌ Errore con ${basename(pdfPath)}: ${err.message}`);
        }
    }

    // Riepilogo
    console.log('\n' + '═'.repeat(50));
    console.log('   📊 RIEPILOGO');
    console.log('═'.repeat(50));

    let totalPages = 0;
    for (const r of results) {
        console.log(`   📁 ${r.pdfName}: ${r.pages} immagini`);
        totalPages += r.pages;
    }
    console.log(`\n   🖼️ Totale: ${totalPages} immagini PNG create`);
    if (!keepOriginal) {
        console.log(`   🗑️ ${results.length} PDF eliminati`);
    }
    console.log();
}

main().catch(err => {
    console.error('❌ Errore fatale:', err.message);
    process.exit(1);
});
