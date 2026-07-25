/**
 * BACKFILL STORAGE — migrazione una tantum, GIÀ ESEGUITA.
 *
 * Aggiunge il campo `storage` (consigli di conservazione, generati con Gemini)
 * alle ricette che non ce l'hanno. Tutte e 80 le ricette attuali ce l'hanno
 * già, quindi oggi questo script non tocca niente: sta qui in archive/ insieme
 * alle altre migrazioni una tantum, non fra i comandi vivi.
 *
 * Stava in src/commands/ ed era l'unico file di quella cartella a NON esportare
 * una funzione: chiamava main() all'ultima riga, quindi partiva al semplice
 * import invece che su richiesta. Non lo importava nessuno, e il percorso che
 * costruiva era comunque sbagliato (cercava tools/Ricettario/ricette, che non
 * esiste), quindi non ha mai fatto danni — ma era un rastrello nell'erba alta.
 *
 * Ora: parte solo se lanciato esplicitamente, usa lo stesso percorso di tutti
 * gli altri comandi, fa una copia di sicurezza prima di riscrivere, e ha un
 * --dry-run.
 *
 * Uso:  node archive/add-storage-backfill.js --dry-run
 *       node archive/add-storage-backfill.js
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { pathToFileURL } from 'url';
import { callGemini, parseClaudeJson } from '../src/utils/api.js';
import { log } from '../src/utils/logger.js';

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    log.header(dryRun ? 'BACKFILL STORAGE — PROVA (nessuna scrittura)' : 'INIZIO BACKFILL STORAGE RICETTE');

    // Stessa convenzione di tutti gli altri comandi del progetto.
    const ricettarioPath = resolve(process.cwd(), process.env.RICETTARIO_PATH || '../Ricettario');
    const ricettePath = resolve(ricettarioPath, 'ricette');
    log.info(`Ricette: ${ricettePath}`);

    const categoryDirs = readdirSync(ricettePath, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

    let processed = 0;
    let skipped = 0;

    for (const dir of categoryDirs) {
        const categoryPath = join(ricettePath, dir);
        const jsonFiles = readdirSync(categoryPath)
            .filter(f => f.endsWith('.json') && f !== 'index.json' && !f.includes('.backup.') && !f.includes('.pre-'));

        for (const file of jsonFiles) {
            const filePath = join(categoryPath, file);
            try {
                const originale = readFileSync(filePath, 'utf-8');
                const data = JSON.parse(originale);
                if (data.storage && Array.isArray(data.storage) && data.storage.length > 0) {
                    skipped++;
                    // bypass, already has storage
                    continue;
                }

                log.info(`[PROC] Generazione storage per: ${data.title}...`);

                const prompt = `Sei un esperto tecnologo alimentare e artigiano della ristorazione.
Ti sto fornendo una ricetta dal mio "Ricettario". Il tuo compito è generare ESCLUSIVAMENTE 2-3 "consigli tecnici sulla CONSERVAZIONE delle pietanze" per questa specifica ricetta (tempi in frigo/freezer, tecniche ottimali come sottovuoto o contenitore ermetico, ed eventuale modalità di rigenerazione consigliata es. in forno a 150°C per ripristinare la croccantezza o la morbidezza).

Ecco i dettagli della ricetta:
- TITOLO: ${data.title}
- CATEGORIA: ${data.category}
- SOTTOTITOLO: ${data.subtitle || ''}

Genera e restituisci SOLO un JSON array di stringhe, ad esempio:
[
  "Primo consiglio tecnico sulla conservazione...",
  "Secondo consiglio su congelamento...",
  "Eventuale consiglio sulla rigenerazione in forno/padella..."
]
Non aggiungere codice markdown se possibile, rispondi con l'array [ ... ] purissimo.`;

                const text = await callGemini({
                    system: "Sei un panificatore e artigiano professionista. Rispondi SEMPRE in JSON (array).",
                    messages: [{ role: 'user', content: prompt }]
                });

                // Tenta di parsare
                let storageArray = [];
                try {
                    storageArray = parseClaudeJson(text);
                } catch (e) {
                    const match = text.match(/\[[\s\S]*\]/);
                    if (match) {
                        storageArray = JSON.parse(match[0]);
                    } else {
                        throw new Error(`Impossibile estrarre array JSON da: ${text}`);
                    }
                }

                if (Array.isArray(storageArray) && storageArray.length > 0) {
                    // Inseriamo lo storage esattamente prima dei proTips o imageKeywords se ci riusciamo,
                    // oppure semplicemente nell'oggetto per poi salvarlo
                    // Per mantenere l'ordine delle chiavi originarie nel JSON il più possibile,
                    // le copiamo e aggiungiamo storage al posto giusto
                    const newObj = {};
                    for (const key in data) {
                        newObj[key] = data[key];
                        if (key === 'proTips') {
                            newObj['storage'] = storageArray;
                        }
                    }
                    if (!newObj.storage) {
                        newObj.storage = storageArray;
                    }

                    if (dryRun) {
                        log.info(`   [prova] scriverei ${storageArray.length} consigli in ${dir}/${file}`);
                        storageArray.forEach(s => log.info(`      · ${s}`));
                    } else {
                        // Copia di sicurezza prima di riscrivere, come in ogni altro
                        // punto del progetto che modifica una ricetta.
                        writeFileSync(filePath.replace(/\.json$/, '.backup.json'), originale, 'utf-8');
                        writeFileSync(filePath, JSON.stringify(newObj, null, 2), 'utf-8');
                        log.success(`   ✅ Storage aggiunto (${storageArray.length} items)`);
                    }
                    processed++;
                } else {
                     log.warn(`   ❌ Nessun storage generato per ${data.title}`);
                }

                // Rate limit spacing
                await new Promise(r => setTimeout(r, 1200));
            } catch (err) {
                log.error(`   ❌ Errore elaborando ${file}: ${err.message}`);
            }
        }
    }

    log.header('BACKFILL COMPLETATO');
    log.info(`Ricette verificate e skippate: ${skipped}`);
    log.success(dryRun
        ? `Ricette che verrebbero aggiornate: ${processed}`
        : `Ricette aggiornate con storage: ${processed}`);
    if (!dryRun && processed > 0) {
        log.warn('Ricorda di risincronizzare l\'indice: node crea-ricetta.js --sync-cards');
    }
}

// Parte SOLO se lanciato esplicitamente, mai al semplice import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(err => {
        log.error(`Errore: ${err.message}`);
        process.exit(1);
    });
}
