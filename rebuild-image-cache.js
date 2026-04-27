#!/usr/bin/env node

/**
 * REBUILD IMAGE CACHE
 * 
 * Popola data/image-cache.json per tutte le ricette che non hanno
 * ancora una cache dei provider immagini.
 * 
 * Uso: node rebuild-image-cache.js [--force] [--delay 2000]
 *   --force   Rigenera anche le entries già in cache
 *   --delay   Millisecondi di attesa tra ogni ricetta (default: 2000)
 */

import 'dotenv/config';
import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { searchAllProviders } from './src/image-finder.js';
import { CATEGORY_FOLDERS } from './src/constants.js';

const CACHE_PATH = resolve(process.cwd(), 'data', 'image-cache.json');
const RICETTARIO_PATH = resolve(process.cwd(), process.env.RICETTARIO_PATH || '../Ricettario');

const forceRefresh = process.argv.includes('--force');
const delayIdx = process.argv.indexOf('--delay');
const DELAY_MS = delayIdx !== -1 ? parseInt(process.argv[delayIdx + 1]) : 2000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    console.log('\n🔄 ═══════════════════════════════════════');
    console.log('   REBUILD IMAGE CACHE');
    console.log('═══════════════════════════════════════\n');
    console.log(`📂 Ricettario: ${RICETTARIO_PATH}`);
    console.log(`💾 Cache: ${CACHE_PATH}`);
    console.log(`⏱️  Delay: ${DELAY_MS}ms tra ogni ricetta`);
    console.log(`🔁 Force: ${forceRefresh ? 'SÌ — rigenera tutto' : 'NO — solo mancanti'}`);

    // Carica cache esistente
    let cache = {};
    if (existsSync(CACHE_PATH)) {
        try { cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8')); } catch {}
    }
    console.log(`\n📊 Cache attuale: ${Object.keys(cache).length} entries\n`);

    // Scansiona tutte le ricette dal filesystem
    const recipesDir = resolve(RICETTARIO_PATH, 'ricette');
    const recipes = [];

    for (const [category, folder] of Object.entries(CATEGORY_FOLDERS)) {
        const catDir = resolve(recipesDir, folder);
        if (!existsSync(catDir)) continue;
        
        const files = readdirSync(catDir)
            .filter(f => f.endsWith('.json') && !f.includes('.backup.') && !f.includes('.pre-edit.'));
        
        for (const file of files) {
            const slug = file.replace('.json', '');
            const fullPath = resolve(catDir, file);
            try {
                const data = JSON.parse(readFileSync(fullPath, 'utf-8'));
                // Skippa file che non sono ricette (es. dati tecnici)
                if (!data.title && !data.nome) continue;
                recipes.push({
                    slug,
                    title: data.title || data.nome || slug,
                    category,
                    imageKeywords: data.imageKeywords || [],
                });
            } catch {}
        }
    }

    console.log(`📋 Trovate ${recipes.length} ricette\n`);

    // Filtra quelle già in cache
    const toProcess = forceRefresh 
        ? recipes 
        : recipes.filter(r => !cache[r.slug]?.providerResults);

    console.log(`🎯 Da processare: ${toProcess.length} ricette`);
    if (!forceRefresh) {
        console.log(`⏭️  Già in cache: ${recipes.length - toProcess.length} ricette`);
    }
    console.log('');

    if (toProcess.length === 0) {
        console.log('✅ Cache già completa! Nulla da fare.');
        return;
    }

    let success = 0;
    let errors = 0;

    for (let i = 0; i < toProcess.length; i++) {
        const recipe = toProcess[i];
        const progress = `[${i + 1}/${toProcess.length}]`;

        console.log(`\n${progress} 🔍 "${recipe.title}" (${recipe.category})...`);
        
        try {
            const providerResults = await searchAllProviders(
                recipe.title,
                recipe.category,
                recipe.imageKeywords
            );

            const imageCount = providerResults.reduce((sum, p) => sum + p.images.length, 0);
            cache[recipe.slug] = { providerResults, timestamp: Date.now() };
            
            // Salva dopo ogni ricetta (resilienza)
            writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
            
            console.log(`   ✅ ${imageCount} immagini da ${providerResults.filter(p => p.images.length > 0).length} provider`);
            success++;
        } catch (err) {
            console.error(`   ❌ Errore: ${err.message}`);
            errors++;
        }

        // Delay per rate limiting (non sull'ultimo)
        if (i < toProcess.length - 1) {
            await sleep(DELAY_MS);
        }
    }

    console.log('\n═══════════════════════════════════════');
    console.log(`✅ Completato: ${success} ok, ${errors} errori`);
    console.log(`💾 Cache totale: ${Object.keys(cache).length} entries`);
    console.log('═══════════════════════════════════════\n');
}

main().catch(err => {
    console.error('❌ Errore fatale:', err);
    process.exit(1);
});
