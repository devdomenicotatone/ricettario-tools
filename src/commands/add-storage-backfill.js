import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { callGemini, parseClaudeJson } from '../utils/api.js';
import { log } from '../utils/logger.js';

async function main() {
    log.header('INIZIO BACKFILL STORAGE RICETTE');
    const ricettePath = resolve(process.cwd(), 'Ricettario', 'ricette');
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
                const data = JSON.parse(readFileSync(filePath, 'utf-8'));
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
                    
                    writeFileSync(filePath, JSON.stringify(newObj, null, 2), 'utf-8');
                    log.success(`   ✅ Storage aggiunto (${storageArray.length} items)`);
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
    log.success(`Ricette aggiornate con storage: ${processed}`);
}

main();
