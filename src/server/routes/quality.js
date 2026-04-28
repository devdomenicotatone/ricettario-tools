/**
 * ROUTES/QUALITY — Analisi qualità, fix AI, profilo sensoriale
 */

import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';

export function setupQualityRoutes(app, { getRicettarioPath, nextJobId, createJobContext, withOutputCapture }) {

    // ── Qualità (pipeline unificata — sostituisce valida + verifica) ──
    async function handleQualita(req, res) {
        const { slug, slugs, grounding, geminiModel } = req.body || {};
        const batchSlugs = slugs || (slug ? [slug] : null);
        const groundingEnabled = grounding === true;
        const label = batchSlugs
            ? `Qualità: ${batchSlugs.length} ricett${batchSlugs.length === 1 ? 'a' : 'e'}${groundingEnabled ? ' + Web' : ''}`
            : 'Qualità tutte';
        const jobId = nextJobId('qlt');
        const ctx = createJobContext(jobId, label);
        res.json({ jobId, status: 'started' });

        try {
            if (batchSlugs) {
                const { CATEGORY_FOLDERS } = await import('../../constants.js');
                const { analyzeQuality } = await import('../../quality.js');
                const ricettarioPath = getRicettarioPath();

                await withOutputCapture(ctx, async () => {
                    ctx.log(`🔍 Analisi qualità${groundingEnabled ? ' + fonti web' : ''} di ${batchSlugs.length} ricette...\n`);
                    for (const s of batchSlugs) {
                        let jsonFile = null;
                        for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
                            const candidate = resolve(ricettarioPath, 'ricette', folder, `${s}.json`);
                            if (existsSync(candidate)) { jsonFile = candidate; break; }
                        }
                        if (!jsonFile) { ctx.log(`  ⚠️ ${s}: non trovato`); continue; }

                        try {
                            const { recipe, result } = await analyzeQuality(jsonFile, { grounding: groundingEnabled, geminiModel });
                            const emoji = result.score >= 80 ? '🟢' : result.score >= 60 ? '🟡' : '🔴';
                            ctx.log(`  ${emoji} ${result.score}/100 — ${recipe.title}`);
                            if (result.schema && !result.schema.pass) {
                                ctx.log(`     📐 Schema: ${result.schema.errors.length} errori`);
                            }
                            if (result.issues?.length > 0) {
                                result.issues.forEach(i => ctx.log(`     ${i.severity} [${i.area}] ${i.message}`));
                            }
                            if (result.gemini) {
                                ctx.log(`     🤖 Gemini: ${result.gemini.score}/100 — ${result.gemini.verdict}`);
                            }
                            if (result.grounding) {
                                ctx.log(`     🌐 Fonti: ${result.grounding.sourcesCount} (${result.grounding.sources.map(s => s.domain).join(', ')})`);
                            }
                        } catch (err) {
                            ctx.log(`  ❌ ${s}: ${err.message}`);
                        }
                    }
                });
            }
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    }

    app.post('/api/qualita', handleQualita);

    // Backward-compat: /api/verifica → qualità senza grounding
    app.post('/api/verifica', handleQualita);
    // Backward-compat: /api/valida → qualità CON grounding
    app.post('/api/valida', (req, res) => {
        req.body = { ...(req.body || {}), grounding: true };
        handleQualita(req, res);
    });



    // ── Quality Index (per badge dashboard) ──
    app.get('/api/quality-index', async (req, res) => {
        try {
            const { loadQualityIndex } = await import('../../quality.js');
            res.json(loadQualityIndex());
        } catch (err) {
            res.json({});
        }
    });

    // ── Quality Report (per modal dashboard) ──
    app.get('/api/quality-report/:slug', async (req, res) => {
        const slug = req.params.slug;
        const ricettarioPath = getRicettarioPath();

        try {
            const { CATEGORY_FOLDERS } = await import('../../constants.js');
            for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
                const reportPath = resolve(ricettarioPath, 'ricette', folder, `${slug}.qualita.md`);
                if (existsSync(reportPath)) {
                    const content = readFileSync(reportPath, 'utf-8');
                    return res.json({ slug, report: content });
                }
            }
            res.status(404).json({ error: `Nessun report qualità trovato per "${slug}"` });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Qualità Fix (applica correzioni AI alla ricetta) ──
    app.post('/api/qualita/fix', async (req, res) => {
        const { slug, slugs, force, geminiModel } = req.body || {};
        const batchSlugs = slugs || (slug ? [slug] : null);
        if (!batchSlugs?.length) return res.status(400).json({ error: 'Nessun slug' });

        const jobId = nextJobId('fix');
        const ctx = createJobContext(jobId, `Fix: ${batchSlugs.length} ricett${batchSlugs.length === 1 ? 'a' : 'e'}`);
        res.json({ jobId, status: 'started' });

        try {
            const { CATEGORY_FOLDERS } = await import('../../constants.js');
            const { loadQualityIndex } = await import('../../quality.js');
            const { callClaude, parseClaudeJson } = await import('../../utils/api.js');
            const { getSchemaPromptDescription, validateRecipeSchema } = await import('../../recipe-schema.js');
            const ricettarioPath = getRicettarioPath();
            const qualityIndex = loadQualityIndex();

            await withOutputCapture(ctx, async () => {
                ctx.log(`🔧 Applicazione fix AI a ${batchSlugs.length} ricette...\n`);

                for (const s of batchSlugs) {
                    const scoreData = qualityIndex[s];
                    if (!force && (!scoreData || scoreData.score >= 85)) {
                        ctx.log(`  ⏭️ ${s}: score ${scoreData?.score || '?'}/100 — skip (>= 85)`);
                        continue;
                    }

                    // Trova JSON
                    let jsonFile = null;
                    for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
                        const candidate = resolve(ricettarioPath, 'ricette', folder, `${s}.json`);
                        if (existsSync(candidate)) { jsonFile = candidate; break; }
                    }
                    if (!jsonFile) { ctx.log(`  ⚠️ ${s}: non trovato`); continue; }

                    // Leggi report qualità
                    const reportPath = jsonFile.replace('.json', '.qualita.md');
                    const report = existsSync(reportPath) ? readFileSync(reportPath, 'utf-8') : null;
                    if (!report) {
                        ctx.log(`  ⚠️ ${s}: nessun report qualità — esegui prima l'analisi`);
                        continue;
                    }

                    try {
                        const recipeJson = readFileSync(jsonFile, 'utf-8');
                        ctx.log(`  🔧 ${s}: invio a Claude per correzione...`);

                        const fixPrompt = `Correggi questa ricetta JSON basandoti ESCLUSIVAMENTE sul report di qualità.

══ SCHEMA JSON OBBLIGATORIO — RISPETTA QUESTA STRUTTURA ══
${getSchemaPromptDescription()}

⚠️ STRUTTURA ingredientGroups (OBBLIGATORIA — mai inventare formati diversi):
- Ogni gruppo DEVE avere: { "group": "Nome Gruppo", "items": [ { "name": "...", "grams": N, "note": "...", "tokenId": "..." } ] }
- Il campo si chiama "group" (NON "label", NON "title")
- Il campo items contiene gli oggetti ingrediente completi (NON array di stringhe, NON refs)
- "ingredients" deve essere SEMPRE un array vuoto []
- Se la ricetta ha un solo componente, usa ingredientGroups con un singolo gruppo

══ REPORT QUALITÀ ══
${report}

══ RICETTA JSON ORIGINALE ══
${recipeJson}

REGOLE TASSATIVE — VIOLARNE ANCHE UNA SOLA INVALIDA IL FIX:
1. Restituisci SOLO il JSON corretto, nessun testo prima o dopo
2. NON cambiare la struttura del JSON (stessi campi, stessi nomi chiave)
3. Correggi SOLO ed ESCLUSIVAMENTE i problemi segnalati nel report (severity ❌ e ⚠️)
4. NON TOCCARE MAI questi campi a meno che il report non li menzioni esplicitamente come errore:
   - hydration, totalFlour, targetTemp, fermentation
   - grams degli ingredienti (NON cambiare le quantità!)
   - slug, category, image, tags, imageKeywords
5. Se il report segnala un problema di TESTO (token invertiti, refusi, istruzioni errate), correggi SOLO il testo specificato
6. NON "migliorare" o "ottimizzare" la ricetta — il tuo compito è SOLO correggere gli errori segnalati
7. Se un ingrediente è nel gruppo sbagliato, spostalo SENZA cambiarne la quantità
8. Mantieni lo stesso stile e livello di dettaglio del testo originale
9. OGNI campo non menzionato nel report DEVE restare IDENTICO byte per byte
10. Se il report indica che ingredientGroups deve avere almeno 1 gruppo, sposta gli ingredienti da "ingredients" dentro ingredientGroups e svuota ingredients`;

                        const fixedText = await callClaude({
                            model: 'claude-sonnet-4-6',
                            maxTokens: 16000,
                            system: 'Sei un correttore chirurgico di ricette JSON. Il tuo UNICO compito è applicare le correzioni ESATTE descritte nel report di qualità. NON modificare NULLA che non sia esplicitamente segnalato come errore. NON cambiare quantità, idratazione, o metadata a meno che il report non lo richieda. RISPETTA SEMPRE la struttura dello schema fornito — usa ESATTAMENTE i nomi dei campi indicati ("group" e "items" per ingredientGroups, MAI "label" o "refs"). Restituisci SOLO JSON valido.',
                            messages: [{ role: 'user', content: fixPrompt }],
                        });

                        // Parsa e valida
                        const fixed = parseClaudeJson(fixedText);
                        if (!fixed?.title) throw new Error('JSON corretto non valido');

                        // Validazione schema post-fix: verifica che il fix non abbia peggiorato la situazione
                        const postFixValidation = validateRecipeSchema(fixed);
                        if (postFixValidation.errors.length > 0) {
                            ctx.log(`  ⚠️ ${s}: Fix ha generato ${postFixValidation.errors.length} errori schema:`);
                            postFixValidation.errors.forEach(e => ctx.log(`     ❌ ${e}`));
                            ctx.log(`  ⏭️ ${s}: Fix RIFIUTATO — il JSON originale è mantenuto`);
                            continue;
                        }

                        // Backup
                        const backupPath = jsonFile.replace('.json', '.backup.json');
                        writeFileSync(backupPath, recipeJson, 'utf-8');

                        // Salva
                        writeFileSync(jsonFile, JSON.stringify(fixed, null, 2), 'utf-8');
                        ctx.log(`  ✅ ${s}: corretto (backup salvato)`);

                        // Auto-revalidation: rilancia qualità per aggiornare report e badge
                        try {
                            const { analyzeQuality, loadQualityIndex, saveQualityIndex } = await import('../../quality.js');
                            ctx.log(`  🔄 ${s}: ri-validazione in corso...`);
                            const { result } = await analyzeQuality(jsonFile, { geminiModel });
                            const emoji = result.score >= 80 ? '🟢' : result.score >= 60 ? '🟡' : '🔴';
                            ctx.log(`  ${emoji} ${s}: nuovo score ${result.score}/100`);

                            // Marca come fixata nell'indice
                            const qi = loadQualityIndex();
                            if (qi[s]) {
                                qi[s].fixed = true;
                                saveQualityIndex(qi);
                            }
                        } catch (revalErr) {
                            ctx.log(`  ⚠️ ${s}: ri-validazione fallita — ${revalErr.message}`);
                        }
                    } catch (err) {
                        ctx.log(`  ❌ ${s}: fix fallito — ${err.message}`);
                    }
                }
            });
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Profilo Sensoriale (AI) ──
    app.post('/api/qualita/sensory', async (req, res) => {
        const { slugs, slug } = req.body || {};
        const targetSlugs = slugs || (slug ? [slug] : []);
        
        if (targetSlugs.length === 0) return res.status(400).json({ error: 'Nessun slug fornito' });

        const jobId = nextJobId('sns');
        const ctx = createJobContext(jobId, `Sensory: ${targetSlugs.length} ricette`);
        res.json({ jobId, status: 'started' });

        try {
            const { CATEGORY_FOLDERS } = await import('../../constants.js');
            const { generateAnalyticsProfile } = await import('../../sensory.js');
            const ricettarioPath = getRicettarioPath();

            await withOutputCapture(ctx, async () => {
                
                for (let i = 0; i < targetSlugs.length; i++) {
                    const currentSlug = targetSlugs[i];
                    ctx.log(`\n🧪 [${i+1}/${targetSlugs.length}] Inizio generazione per "${currentSlug}"...`);

                    let jsonFile = null;
                    for (const [cat, folder] of Object.entries(CATEGORY_FOLDERS)) {
                        const candidate = resolve(ricettarioPath, 'ricette', folder, `${currentSlug}.json`);
                        if (existsSync(candidate)) { jsonFile = candidate; break; }
                    }
                    
                    if (!jsonFile) {
                        ctx.log(`❌ Ricetta non trovata: ${currentSlug}`);
                        continue;
                    }

                    const recipeJson = readFileSync(jsonFile, 'utf-8');
                    const recipeData = JSON.parse(recipeJson);

                    // Call agent
                    const analytics = await generateAnalyticsProfile(recipeData);
                    
                    // Assign back to recipe data
                    recipeData.sensoryProfile = analytics.sensory;
                    recipeData.nutrition = analytics.nutrition;

                    // Save
                    const backupPath = jsonFile.replace('.json', '.backup.json');
                    writeFileSync(backupPath, recipeJson, 'utf-8');
                    writeFileSync(jsonFile, JSON.stringify(recipeData, null, 2), 'utf-8');
                    
                    ctx.log(`✅ Profilo aggiunto con successo a ${currentSlug}`);
                }
                ctx.log(`\n🎉 Processo completato per ${targetSlugs.length} ricette!`);
            });
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });
}
