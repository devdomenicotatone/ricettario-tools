#!/usr/bin/env node
/**
 * PDF → IMMAGINI — conversione una tantum del materiale sorgente, GIÀ ESEGUITA.
 *
 * Divide ogni PDF in singole pagine e le converte in PNG, dentro una
 * sottocartella con il nome del PDF. È il primo passo della trascrizione OCR
 * (poi tocca a ocr-surya.py e src/ocr.js).
 *
 * Perché sta in archive/: `public/pdf/` del sito oggi contiene solo le cartelle
 * di immagini già estratte e zero PDF, quindi la conversione è stata fatta e
 * non c'è più niente da convertire. Nessuno lo importa e non è in package.json.
 *
 * Com'era pericoloso: cancellava il PDF originale in automatico (serviva
 * --keep per tenerlo) e `public/pdf/` è nel .gitignore del sito — cioè quei
 * ~173 MB di materiale sorgente non sono recuperabili da git. Un avvio per
 * sbaglio e il PDF era perso davvero.
 *
 * Ora: il PDF si tiene sempre, a meno che tu non chieda esplicitamente di
 * cancellarlo; parte solo se lanciato a mano; e ha un --dry-run.
 *
 * Uso — riattivazione a mano, fuori dalla pipeline: il flusso normale non lo
 * lancia mai e il README dice giustamente di non lanciarlo. Queste righe
 * servono a chi decide di rieseguirlo apposta, sapendo cosa fa.
 *   node archive/pdf-to-images.js --dry-run           ← dice cosa farebbe
 *   node archive/pdf-to-images.js                     ← converte i PDF in public/pdf/
 *   node archive/pdf-to-images.js --input "file.pdf"  ← converte un PDF specifico
 *   node archive/pdf-to-images.js --elimina-pdf       ← cancella l'originale (NON recuperabile)
 *   node archive/pdf-to-images.js --scale 2           ← scala rendering (default: 2)
 */

import { readdir, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, basename, join } from 'path';
import { pathToFileURL } from 'url';
import { config } from 'dotenv';

// Il .env sta nella radice di tools/, non dove ti trovi quando lanci il comando.
config({ path: resolve(import.meta.dirname, '..', '.env') });

// ── Parse CLI args ──
// Attenzione: qui i flag con un valore attaccato (--scale 2, --input file.pdf).
// I flag booleani NON passano di qui — vedi eliminaPdf/dryRun in main().
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
    const { scale = 2, eliminaPdf = false, dryRun = false } = options;
    const pdfName = basename(pdfPath, '.pdf');
    const outputDir = resolve(pdfPath, '..');
    const imgDir = join(outputDir, pdfName);

    if (dryRun) {
        console.log(`\n[prova] convertirei: ${basename(pdfPath)}`);
        console.log(`   [prova] output: ${imgDir}`);
        if (eliminaPdf) console.log('   [prova] e poi cancellerei il PDF originale');
        return { pdfName, pages: 0, outputDir: imgDir };
    }

    // Crea sottocartella per le immagini di questo PDF
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

    // Elimina il PDF originale SOLO se richiesto esplicitamente: public/pdf/ è
    // ignorato da git, quindi qui non si torna indietro.
    if (eliminaPdf) {
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
    // Presenza secca del flag: parseArgs prenderebbe la parola dopo come valore,
    // e `--elimina-pdf false` finirebbe per cancellare comunque il PDF.
    const eliminaPdf = process.argv.includes('--elimina-pdf');
    const dryRun = process.argv.includes('--dry-run');

    // «--elimina-pdf false» non è una negazione: il flag è un interruttore, e
    // qui si cancella roba che git non ha. Meglio fermarsi che tirare a indovinare.
    const dopoIlFlag = process.argv[process.argv.indexOf('--elimina-pdf') + 1];
    if (eliminaPdf && dopoIlFlag && ['false', '0', 'no', 'off'].includes(dopoIlFlag.toLowerCase())) {
        console.error(`❌ "--elimina-pdf ${dopoIlFlag}" non vuol dire "non cancellare": --elimina-pdf è un interruttore.`);
        console.error('   Per tenere i PDF togli il flag; per cancellarli scrivi solo --elimina-pdf.');
        process.exit(1);
    }
    const options = { scale, eliminaPdf, dryRun };

    if (dryRun) {
        console.log('🔍 Modalità prova: nessun file verrà scritto o cancellato');
    }
    if (eliminaPdf) {
        console.log('🗑️ Modalità: elimina i PDF dopo la conversione (NON recuperabili da git)');
    } else {
        console.log('📌 Modalità: mantieni i PDF originali (usa --elimina-pdf per cancellarli)');
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
        // Tutti i PDF nella cartella public/pdf/ del sito. Stessa convenzione di
        // percorso di tutti gli altri comandi del progetto.
        const ricettarioPath = resolve(process.cwd(), process.env.RICETTARIO_PATH || '../Ricettario');
        const pdfDir = resolve(ricettarioPath, 'public', 'pdf');
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
    if (eliminaPdf && !dryRun) {
        console.log(`   🗑️ ${results.length} PDF eliminati`);
    }
    console.log();
}

// Parte SOLO se lanciato esplicitamente, mai al semplice import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(err => {
        console.error('❌ Errore fatale:', err.message);
        process.exit(1);
    });
}
