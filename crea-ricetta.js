#!/usr/bin/env node

/**
 * CREA RICETTA — CLI Entry Point
 *
 * Uso:
 *   node crea-ricetta.js --url "https://giallozafferano.it/ricetta/Focaccia.html"
 *   node crea-ricetta.js --nome "Focaccia Barese" --idratazione 80
 *   node crea-ricetta.js --nome "Pizza Napoletana" --tipo "Pizza" --note "cottura in forno casalingo"
 *   node crea-ricetta.js --scopri "focaccia pugliese"         ← cerca e genera!
 *   node crea-ricetta.js --scopri "pane rustico" --quante 3   ← cerca 3 risultati
 *   node crea-ricetta.js --valida                             ← valida TUTTE le ricette!
 *
 * Il flusso automatizzato:
 *   1. [--scopri] Cerca ricette su SerpAPI
 *   2. Scraping dati dalla URL (o generazione da zero)
 *   3. Riscrittura AI con Claude Sonnet (stile tecnico Ricettario)
 *   4. [VALIDAZIONE] Cross-check con fonti reali
 *   5. Generazione HTML completo (identico al template)
 *   6. Salvataggio in ricette/{categoria}/slug.html
 *   7. Inserimento automatico della card nella homepage
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { scrapeRecipe } from './src/scraper.js';
import { enhanceRecipe, generateRecipe } from './src/enhancer.js';
import { generateHtml } from './src/template.js';
import { injectCard } from './src/injector.js';
import { discoverRecipes, askUser } from './src/discovery.js';
import { validateRecipe, validateAllRecipes } from './src/validator.js';
import { findAndDownloadImage } from './src/image-finder.js';

// ── Parse CLI args ──
function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].replace('--', '');
            parsed[key] = args[i + 1] || true;
            i++;
        }
    }
    return parsed;
}

// ── Main ──
async function main() {
    const args = parseArgs();

    console.log('\n🔥 ═══════════════════════════════════════');
    console.log('   RICETTARIO TOOLS — Recipe Generator');
    console.log('═══════════════════════════════════════════\n');

    if (!args.url && !args.nome && !args.scopri && !args.valida && !args['aggiorna-immagini']) {
        console.log(`Uso:
  node crea-ricetta.js --url "https://sito.com/ricetta"
  node crea-ricetta.js --nome "Focaccia Barese" [--idratazione 80] [--tipo Pizza] [--note "..."]
  node crea-ricetta.js --scopri "focaccia pugliese" [--quante 5]
  node crea-ricetta.js --valida                                    ← valida tutte le ricette
  node crea-ricetta.js --aggiorna-immagini                         ← scarica immagini Wikimedia

Opzioni:
  --url                 URL della ricetta da scrappare e migliorare
  --nome                Nome ricetta da generare da zero con AI
  --scopri              Cerca ricette su Google e scegli quale generare
  --valida              Valida le ricette con fonti reali (cross-check)
  --aggiorna-immagini   Scarica immagini da Wikimedia Commons per tutte le ricette
  --quante              Numero di risultati da mostrare (default: 5, max: 10)
  --idratazione         Idratazione target in % (opzionale)
  --tipo                Categoria: Pane, Pizza, Pasta, Lievitati (opzionale)
  --note                Note aggiuntive per Claude (opzionale)
  --output              Percorso output personalizzato (opzionale)
  --no-inject           Non inserire la card nella homepage (opzionale)
  --no-image            Salta la ricerca immagini Wikimedia (opzionale)
  --no-valida           Salta la validazione post-generazione (opzionale)
`);
        process.exit(0);
    }

    // ── Mode E: Aggiorna immagini da Wikimedia ──
    if (args['aggiorna-immagini']) {
        const ricettarioPath = resolve(process.cwd(), args.output || process.env.RICETTARIO_PATH || '../Ricettario');
        console.log('📸 AGGIORNAMENTO IMMAGINI — Wikimedia Commons\n');

        const { readdirSync, readFileSync: readFS } = await import('fs');
        const recipeDirs = ['pane', 'pizza', 'pasta', 'lievitati', 'focaccia'];
        const results = [];
        const usedUrls = new Set(); // Track immagini già scaricate per evitare duplicati

        for (const dir of recipeDirs) {
            const dirPath = resolve(ricettarioPath, 'ricette', dir);
            let files;
            try { files = readdirSync(dirPath).filter(f => f.endsWith('.html')); }
            catch { continue; }

            for (const file of files) {
                const filePath = resolve(dirPath, file);
                const html = readFS(filePath, 'utf-8');

                const titleMatch = html.match(/<title>([^<]+?)\s*[—–-]/);
                const recipeName = titleMatch?.[1]?.trim() || file.replace('.html', '').replace(/-/g, ' ');
                const category = dir.charAt(0).toUpperCase() + dir.slice(1);

                console.log(`\n${'─'.repeat(50)}`);
                console.log(`📋 ${recipeName} (${category})`);
                console.log(`${'─'.repeat(50)}`);

                const imageData = await findAndDownloadImage(
                    { title: recipeName, category, slug: file.replace('.html', ''), imageKeywords: [] },
                    ricettarioPath,
                    usedUrls
                );

                results.push({
                    name: recipeName,
                    category,
                    found: !!imageData,
                    image: imageData?.homeRelativePath || null,
                });

                await new Promise(r => setTimeout(r, 2000));
            }
        }

        console.log('\n' + '═'.repeat(60));
        console.log('   📊 RIEPILOGO IMMAGINI');
        console.log('═'.repeat(60) + '\n');
        for (const r of results) {
            const emoji = r.found ? '🟢' : '🔴';
            console.log(`  ${emoji} ${r.name} → ${r.image || 'nessuna immagine'}`);
        }
        const found = results.filter(r => r.found).length;
        console.log(`\n  📈 ${found}/${results.length} immagini scaricate`);
        console.log(`  📁 Salvate in: images/ricette/\n`);

        process.exit(0);
    }

    // Verifica API key
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error('❌ ANTHROPIC_API_KEY non trovata. Copia .env.example in .env e inserisci la tua chiave.');
        process.exit(1);
    }

    // ── Mode D: Validazione ricette ──
    if (args.valida) {
        const ricettarioPath = resolve(process.cwd(), args.output || process.env.RICETTARIO_PATH || '../Ricettario');
        console.log('🔬 VALIDAZIONE PRO — Cross-check con fonti reali\n');

        const results = await validateAllRecipes(ricettarioPath);

        // Riepilogo finale
        console.log('\n' + '═'.repeat(60));
        console.log('   📊 RIEPILOGO VALIDAZIONE');
        console.log('═'.repeat(60) + '\n');

        const sorted = results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
        for (const r of sorted) {
            const emoji = r.confidence >= 75 ? '🟢' : r.confidence >= 50 ? '🟡' : '🔴';
            console.log(`  ${emoji} ${r.confidence}% — ${r.title}`);
        }

        const avgConfidence = Math.round(
            sorted.filter(r => r.confidence >= 0).reduce((sum, r) => sum + r.confidence, 0) /
            sorted.filter(r => r.confidence >= 0).length
        );
        console.log(`\n  📈 Media confidenza: ${avgConfidence}%`);
        console.log(`  📄 Report salvati come .validazione.md accanto a ogni ricetta\n`);

        process.exit(0);
    }

    // ── Mode C: Discovery — cerca e genera ──
    if (args.scopri) {
        const numResults = parseInt(args.quante) || 5;
        const results = await discoverRecipes(args.scopri, numResults);

        if (results.length === 0) process.exit(0);

        const choice = await askUser('👉 Quale vuoi generare? (numero, o "tutti", o "esci"): ');

        if (choice.toLowerCase() === 'esci' || choice === 'q') {
            console.log('\n👋 Alla prossima!');
            process.exit(0);
        }

        let urlsToProcess = [];

        if (choice.toLowerCase() === 'tutti') {
            urlsToProcess = results.map(r => r.url);
        } else {
            // Supporta singolo numero o lista separata da virgola: "1,3,5"
            const indices = choice.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
            urlsToProcess = indices
                .map(i => results.find(r => r.index === i)?.url)
                .filter(Boolean);
        }

        if (urlsToProcess.length === 0) {
            console.log('❌ Nessuna selezione valida.');
            process.exit(1);
        }

        console.log(`\n🚀 Genero ${urlsToProcess.length} ricett${urlsToProcess.length === 1 ? 'a' : 'e'}...\n`);

        for (const url of urlsToProcess) {
            console.log(`\n${'─'.repeat(50)}`);
            console.log(`🔗 ${url}`);
            console.log(`${'─'.repeat(50)}`);
            try {
                // Reusa il flusso URL standard
                args.url = url;
                await processRecipe(args);
            } catch (err) {
                console.error(`⚠️  Errore: ${err.message}. Passo alla prossima.`);
            }
        }

        process.exit(0);
    }

    // ── Mode A/B: URL o generazione da zero ──
    await processRecipe(args);
}

/**
 * Processa una singola ricetta (da URL o da zero)
 */
async function processRecipe(args) {
    let enhancedRecipe;

    if (args.url) {
        // Mode A: Scraping + Enhancement
        const rawData = await scrapeRecipe(args.url);
        console.log(`📋 Estratti: ${rawData.ingredients.length} ingredienti, ${rawData.steps.length} step\n`);
        enhancedRecipe = await enhanceRecipe(rawData);
    } else {
        // Mode B: Generazione da zero
        enhancedRecipe = await generateRecipe(args.nome, {
            idratazione: args.idratazione,
            tipo: args.tipo,
            note: args.note,
        });
    }

    // Genera HTML
    const html = generateHtml(enhancedRecipe);
    const slug = enhancedRecipe.slug || args.nome?.toLowerCase().replace(/\s+/g, '-') || 'nuova-ricetta';
    enhancedRecipe.slug = slug;

    // Determina output path con sottocartella per categoria
    const ricettarioPath = resolve(process.cwd(), args.output || process.env.RICETTARIO_PATH || '../Ricettario');
    const category = enhancedRecipe.category || args.tipo || 'Pane';
    const categoryFolder = {
        Pane: 'pane', Pizza: 'pizza', Pasta: 'pasta',
        Lievitati: 'lievitati', Focaccia: 'focaccia',
    };
    const subfolder = categoryFolder[category] || category.toLowerCase();
    const outputDir = resolve(ricettarioPath, 'ricette', subfolder);
    const outputFile = resolve(outputDir, `${slug}.html`);

    // Assicurati che la cartella esista
    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
    }

    // Step 4: Cerca e scarica immagine Wikimedia
    if (args['no-image'] !== true) {
        const imageData = await findAndDownloadImage(enhancedRecipe, ricettarioPath);
        if (imageData) {
            enhancedRecipe.image = imageData.homeRelativePath;
            enhancedRecipe.imageAttribution = imageData.attribution;
            enhancedRecipe._imageData = imageData;
        }
    }

    // Step 5: Salva il file HTML (rigenera con immagine)
    const finalHtml = generateHtml(enhancedRecipe);
    writeFileSync(outputFile, finalHtml, 'utf-8');

    console.log('\n═══════════════════════════════════════════');
    console.log('   📄 RICETTA GENERATA');
    console.log('═══════════════════════════════════════════');
    console.log(`📝 Titolo: ${enhancedRecipe.title}`);
    console.log(`💧 Idratazione: ${enhancedRecipe.hydration}%`);
    console.log(`🌡️ Temp target: ${enhancedRecipe.targetTemp}`);
    console.log(`🛒 Ingredienti: ${enhancedRecipe.ingredients.length}`);
    console.log(`⚙️ Step spirale: ${enhancedRecipe.stepsSpiral.length}`);
    console.log(`🤲 Step a mano: ${enhancedRecipe.stepsHand.length}`);
    if (enhancedRecipe.image) {
        console.log(`📸 Immagine: ${enhancedRecipe.image}`);
    }
    console.log(`📄 File: ${outputFile}`);

    // Step 6: Inserisci la card nella homepage
    if (args['no-inject'] !== true) {
        console.log('\n═══════════════════════════════════════════');
        console.log('   🏠 INTEGRAZIONE HOMEPAGE');
        console.log('═══════════════════════════════════════════');
        try {
            injectCard(enhancedRecipe, ricettarioPath);
        } catch (err) {
            console.error(`⚠️  Errore nell'inserimento card: ${err.message}`);
            console.log('La pagina ricetta è stata creata comunque.');
        }
    }

    console.log('\n═══════════════════════════════════════════');
    console.log('   ✅ COMPLETATO');
    console.log('═══════════════════════════════════════════');
    console.log(`\n👉 Prossimi passi:`);
    console.log(`   1. Apri http://localhost:5173 e verifica il risultato`);
    console.log(`   2. git add + commit + push\n`);
}


main().catch(err => {
    console.error('\n❌ Errore:', err.message);
    process.exit(1);
});
