/**
 * ROUTES/CATEGORIES — Cambia, aggiungi, rimuovi categorie
 */

import { resolve, dirname } from 'path';
import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync, cpSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function setupCategoryRoutes(app, { getRicettarioPath, nextJobId, createJobContext, withOutputCapture }) {

    // ── Cambia Categoria ──
    app.post('/api/cambia-categoria', async (req, res) => {
        const { slug, oldCategory, newCategory } = req.body;

        if (!slug || !oldCategory || !newCategory) {
            return res.status(400).json({ error: 'slug, oldCategory e newCategory sono obbligatori' });
        }
        if (oldCategory === newCategory) {
            return res.status(400).json({ error: 'La categoria è già la stessa' });
        }

        const jobId = nextJobId('cat');
        const ctx = createJobContext(jobId, `Categoria: ${slug} → ${newCategory}`);
        res.json({ jobId, status: 'started' });

        try {
            const { CATEGORY_FOLDERS } = await import('../../constants.js');
            const { syncCards } = await import('../../commands/sync-cards.js');

            const ricettarioPath = getRicettarioPath();
            const oldFolder = CATEGORY_FOLDERS[oldCategory] || oldCategory.toLowerCase();
            const newFolder = CATEGORY_FOLDERS[newCategory] || newCategory.toLowerCase();

            // Paths vecchi
            const oldJsonFile = resolve(ricettarioPath, 'ricette', oldFolder, `${slug}.json`);
            const oldValidFile = resolve(ricettarioPath, 'ricette', oldFolder, `${slug}.validazione.md`);
            const oldImgWebp = resolve(ricettarioPath, 'public', 'images', 'ricette', oldFolder, `${slug}.webp`);
            const oldImgAvif = resolve(ricettarioPath, 'public', 'images', 'ricette', oldFolder, `${slug}.avif`);

            // Paths nuovi
            const newRecipeDir = resolve(ricettarioPath, 'ricette', newFolder);
            const newImgDir = resolve(ricettarioPath, 'public', 'images', 'ricette', newFolder);
            const newJsonFile = resolve(newRecipeDir, `${slug}.json`);
            const newValidFile = resolve(newRecipeDir, `${slug}.validazione.md`);
            const newImgWebp = resolve(newImgDir, `${slug}.webp`);
            const newImgAvif = resolve(newImgDir, `${slug}.avif`);

            // Extra files that might exist
            const extensionsToMove = ['.html', '.verifica.md', '.qualita.md', '.backup.json', '.pre-edit.json', '.md'];

            // Verifica che il JSON sorgente esista
            if (!existsSync(oldJsonFile)) {
                ctx.error(`❌ JSON non trovato: ${oldJsonFile}`);
                ctx.end(false);
                return;
            }

            // Crea cartelle destinazione se non esistono
            mkdirSync(newRecipeDir, { recursive: true });
            mkdirSync(newImgDir, { recursive: true });

            await withOutputCapture(ctx, async () => {
                // 1. Sposta JSON
                ctx.log(`📦 Spostamento file da ${oldFolder}/ → ${newFolder}/`);
                renameSync(oldJsonFile, newJsonFile);
                ctx.log(`  ✅ ${slug}.json`);

                // 2. Sposta validazione
                if (existsSync(oldValidFile)) {
                    renameSync(oldValidFile, newValidFile);
                    ctx.log(`  ✅ ${slug}.validazione.md`);
                }

                // 3. Sposta immagini (WebP + AVIF)
                if (existsSync(oldImgWebp)) {
                    renameSync(oldImgWebp, newImgWebp);
                    ctx.log(`  ✅ ${slug}.webp`);
                }
                if (existsSync(oldImgAvif)) {
                    renameSync(oldImgAvif, newImgAvif);
                    ctx.log(`  ✅ ${slug}.avif`);
                }

                // 3.5 Sposta altri file (html, md, backup)
                for (const ext of extensionsToMove) {
                    const oldPath = resolve(ricettarioPath, 'ricette', oldFolder, `${slug}${ext}`);
                    if (existsSync(oldPath)) {
                        renameSync(oldPath, resolve(newRecipeDir, `${slug}${ext}`));
                        ctx.log(`  ✅ ${slug}${ext}`);
                    }
                }

                // 4. Aggiorna JSON — category + image path
                ctx.log(`\n📝 Aggiornamento metadati...`);
                const recipe = JSON.parse(readFileSync(newJsonFile, 'utf-8'));
                recipe.category = newCategory;
                if (recipe.image) {
                    recipe.image = recipe.image.replace(
                        `images/ricette/${oldFolder}/`,
                        `images/ricette/${newFolder}/`
                    );
                }
                writeFileSync(newJsonFile, JSON.stringify(recipe, null, 2), 'utf-8');
                ctx.log(`  ✅ category: ${newCategory}`);
                ctx.log(`  ✅ image: ${recipe.image || 'nessuna'}`);

                // 5. Sync cards (ricostruisce recipes.json)
                ctx.log(`\n🔄 Sync cards...`);
                await syncCards({});
                ctx.log(`  ✅ recipes.json aggiornato`);

                ctx.log(`\n🎉 Categoria cambiata: "${slug}" → ${newCategory}`);
            });

            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Aggiungi Categoria (crea infrastruttura completa) ──
    app.post('/api/aggiungi-categoria', async (req, res) => {
        const { name } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'Nome categoria obbligatorio' });

        const categoryName = name.trim();
        const slug = categoryName.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

        const jobId = nextJobId('cat-new');
        const ctx = createJobContext(jobId, `Nuova Categoria: ${categoryName}`);
        res.json({ jobId, status: 'started' });

        try {
            const ricettarioPath = getRicettarioPath();
            const { ALL_CATEGORIES, CATEGORY_FOLDERS, CATEGORIES_DATA } = await import('../../constants.js');

            if (CATEGORY_FOLDERS[categoryName]) {
                ctx.log(`⚠️ La categoria "${categoryName}" esiste già`);
                ctx.end(false);
                return;
            }

            await withOutputCapture(ctx, async () => {
                // ── 1. AI: genera metadati categoria ──
                ctx.log('🧠 Generazione metadati con AI...');
                const { callGemini } = await import('../../utils/api.js');

                const aiPrompt = `Per la categoria di ricette "${categoryName}", suggerisci i metadati.
Rispondi SOLO con un JSON valido (no markdown fences):
{
  "fluentEmojiFolder": "Nome Cartella GitHub esatto (es. 'Meat on bone', 'Cut of meat', 'Herb', 'Poultry leg')",
  "fluentEmojiSlug": "slug locale kebab-case (es. 'meat-on-bone', 'cut-of-meat')",
  "unicodeEmoji": "emoji unicode singola (es. 🥩)",
  "lucideIcon": "nome icona Lucide valida (es. 'beef', 'fish', 'egg', 'utensils', 'leaf', 'cherry', 'salad', 'flame', 'soup')",
  "color": "colore hex dashboard (evita #d4a574,#e74c3c,#27ae60,#f39c12,#3498db,#e91e63,#2ecc71,#9b59b6 già usati)",
  "title": "Titolo pagina categoria in italiano",
  "description": "Descrizione SEO breve in italiano (max 120 char)"
}
REGOLE:
- fluentEmojiFolder DEVE essere un nome emoji valido dal repo microsoft/fluentui-emoji (case-sensitive)
- Scegli un'emoji che rappresenti visivamente il tipo di cibo della categoria
- Il colore deve essere visivamente distinto dai colori già usati
- lucideIcon deve essere un'icona effettivamente esistente in Lucide`;

                let metadata;
                try {
                    const aiText = await callGemini({
                        model: 'gemini-2.5-flash',
                        messages: [{ role: 'user', content: aiPrompt }],
                    });
                    const cleaned = aiText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                    metadata = JSON.parse(cleaned);
                    ctx.log(`   ✅ Emoji: ${metadata.unicodeEmoji} ${metadata.fluentEmojiSlug}`);
                    ctx.log(`   ✅ Icona: ${metadata.lucideIcon} | Colore: ${metadata.color}`);
                    ctx.log(`   ✅ Titolo: ${metadata.title}`);
                } catch (aiErr) {
                    ctx.log(`   ⚠️ AI fallita: ${aiErr.message}, uso fallback`);
                    metadata = {
                        fluentEmojiFolder: 'Fork and knife',
                        fluentEmojiSlug: 'fork-and-knife',
                        unicodeEmoji: '🍽️',
                        lucideIcon: 'utensils',
                        color: '#1abc9c',
                        title: categoryName,
                        description: `Ricette di ${categoryName.toLowerCase()}.`,
                    };
                }

                // ── 2. Download emoji Fluent 3D da GitHub ──
                const emojiSlug = metadata.fluentEmojiSlug;
                const emojiFileName = metadata.fluentEmojiFolder.toLowerCase().replace(/\s+/g, '_');
                const githubUrl = `https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/${encodeURIComponent(metadata.fluentEmojiFolder)}/3D/${emojiFileName}_3d.png`;
                const emojiDir = resolve(ricettarioPath, 'public', 'images', 'emoji');
                const emojiPngPath = resolve(emojiDir, `${emojiSlug}.png`);

                ctx.log(`📥 Download emoji: ${githubUrl}`);
                let emojiDownloaded = false;
                try {
                    const resp = await fetch(githubUrl);
                    if (resp.ok) {
                        const buffer = Buffer.from(await resp.arrayBuffer());
                        writeFileSync(emojiPngPath, buffer);
                        ctx.log(`   ✅ Salvata: ${emojiSlug}.png (${(buffer.length / 1024).toFixed(0)} KB)`);
                        emojiDownloaded = true;

                        // Genera WebP + AVIF con Sharp
                        try {
                            const sharp = (await import('sharp')).default;
                            await sharp(buffer).webp({ quality: 80 }).toFile(resolve(emojiDir, `${emojiSlug}.webp`));
                            await sharp(buffer).avif({ quality: 50 }).toFile(resolve(emojiDir, `${emojiSlug}.avif`));
                            ctx.log(`   ✅ Ottimizzata: .webp + .avif`);
                        } catch (sharpErr) {
                            ctx.log(`   ⚠️ Sharp fallito: ${sharpErr.message} (PNG usabile comunque)`);
                        }
                    } else {
                        ctx.log(`   ⚠️ Download fallito (${resp.status}), uso fork-and-knife come fallback`);
                        metadata.fluentEmojiSlug = 'fork-and-knife';
                    }
                } catch (dlErr) {
                    ctx.log(`   ⚠️ Download errore: ${dlErr.message}, uso fork-and-knife`);
                    metadata.fluentEmojiSlug = 'fork-and-knife';
                }

                // ── 3. Crea cartelle ──
                const recipeDir = resolve(ricettarioPath, 'ricette', slug);
                const imgDir = resolve(ricettarioPath, 'public', 'images', 'ricette', slug);
                mkdirSync(recipeDir, { recursive: true });
                mkdirSync(imgDir, { recursive: true });
                ctx.log(`📁 Cartelle create: ricette/${slug}/ + images/ricette/${slug}/`);

                // ── 4. Aggiorna constants.js (backend) ──
                const constantsPath = resolve(__dirname, '..', '..', 'constants.js');
                let constantsContent = readFileSync(constantsPath, 'utf-8');
                const nextOrder = Object.keys(CATEGORIES_DATA).length + 1;

                // ── Helper: inserisci testo prima della chiusura di un blocco const ──
                function insertBeforeBlockClose(content, constName, closingStr, insertion) {
                    const declIdx = content.indexOf(`export const ${constName}`);
                    if (declIdx === -1) return content;
                    // Trova la chiusura del blocco (]; o };) DOPO la dichiarazione
                    const searchFrom = declIdx;
                    const closeIdx = content.indexOf(closingStr, searchFrom);
                    if (closeIdx === -1) return content;
                    // Inserisci prima della chiusura
                    return content.slice(0, closeIdx) + insertion + '\n' + content.slice(closeIdx);
                }

                // ALL_CATEGORIES: aggiungi prima di ];
                constantsContent = insertBeforeBlockClose(constantsContent, 'ALL_CATEGORIES',
                    '\n];', `,\n    '${categoryName}'`);
                // CATEGORY_FOLDERS: aggiungi prima di };
                constantsContent = insertBeforeBlockClose(constantsContent, 'CATEGORY_FOLDERS',
                    '\n};', `,\n    '${categoryName}': '${slug}'`);
                // CATEGORIES_DATA: aggiungi prima di };
                constantsContent = insertBeforeBlockClose(constantsContent, 'CATEGORIES_DATA',
                    '\n};', `\n    ${slug.replace(/-/g, '_')}: { emoji: '${metadata.unicodeEmoji}', label: '${categoryName}', order: ${nextOrder} },`);

                writeFileSync(constantsPath, constantsContent, 'utf-8');
                ctx.log(`💾 constants.js aggiornato`);

                // Aggiorna oggetti live in memoria (no restart necessario)
                ALL_CATEGORIES.push(categoryName);
                CATEGORY_FOLDERS[categoryName] = slug;
                const dataKey = slug.replace(/-/g, '_');
                CATEGORIES_DATA[dataKey] = { emoji: metadata.unicodeEmoji, label: categoryName, order: nextOrder };

                // ── 5. Aggiorna categories.js (frontend SPA) ──
                const categoriesPath = resolve(ricettarioPath, 'js', 'categories.js');
                let catContent = readFileSync(categoriesPath, 'utf-8');

                const catKey = slug.replace(/-/g, '_');
                const catEntry = `  ${catKey}: { name: '${categoryName}', emoji: '${metadata.fluentEmojiSlug}', title: '${metadata.title}', desc: '${metadata.description.replace(/'/g, "\\'")}' },`;
                catContent = insertBeforeBlockClose(catContent, 'CATEGORIES', '\n};', catEntry);
                // CATEGORY_ORDER: aggiungi prima di ];
                catContent = insertBeforeBlockClose(catContent, 'CATEGORY_ORDER',
                    '\n];', ` '${catKey}',`);

                writeFileSync(categoriesPath, catContent, 'utf-8');
                ctx.log(`💾 categories.js aggiornato`);

                // ── 6. Aggiorna emoji.js (frontend SPA) — EMOJI_MAP ──
                if (emojiDownloaded) {
                    const emojiJsPath = resolve(ricettarioPath, 'js', 'emoji.js');
                    let emojiContent = readFileSync(emojiJsPath, 'utf-8');
                    emojiContent = insertBeforeBlockClose(emojiContent, 'EMOJI_MAP',
                        '\n};', `  '${metadata.fluentEmojiSlug}': '${metadata.fluentEmojiSlug}',`);
                    writeFileSync(emojiJsPath, emojiContent, 'utf-8');
                    ctx.log(`💾 emoji.js aggiornato`);
                }

                // ── 7. Sync cards ──
                ctx.log('🔄 Sync cards...');
                const { syncCards } = await import('../../commands/sync-cards.js');
                await syncCards({});
                ctx.log('✅ recipes.json sincronizzato');

                ctx.log(`\n🎉 Categoria "${categoryName}" creata con successo!`);
                ctx.log(`   📁 Slug: ${slug}`);
                ctx.log(`   ${metadata.unicodeEmoji} Emoji: ${metadata.fluentEmojiSlug}`);
                ctx.log(`   🎨 Colore: ${metadata.color}`);
                ctx.log(`   📄 Titolo: ${metadata.title}`);

                // Emetti evento per il frontend (data disponibile nel job context)
                ctx._categoryResult = {
                    name: categoryName,
                    slug,
                    emoji: metadata.unicodeEmoji,
                    fluentEmoji: metadata.fluentEmojiSlug,
                    lucideIcon: metadata.lucideIcon,
                    color: metadata.color,
                    title: metadata.title,
                    description: metadata.description,
                };
            });
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });

    // ── Rimuovi Categoria (soft-delete con backup) ──
    app.post('/api/rimuovi-categoria', async (req, res) => {
        const { name, moveTo } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'Nome categoria obbligatorio' });

        const { ALL_CATEGORIES, CATEGORY_FOLDERS, CATEGORIES_DATA } = await import('../../constants.js');
        if (!ALL_CATEGORIES.includes(name)) return res.status(404).json({ error: `Categoria "${name}" non trovata` });
        if (moveTo && !ALL_CATEGORIES.includes(moveTo)) return res.status(400).json({ error: `Categoria destinazione "${moveTo}" non valida` });
        if (moveTo === name) return res.status(400).json({ error: 'Non puoi spostare le ricette nella stessa categoria' });

        const jobId = nextJobId('rmcat');
        const ctx = createJobContext(jobId, `Rimuovi: ${name}`);
        res.json({ jobId, status: 'started' });

        try {
            await withOutputCapture(ctx, async () => {
                const ricettarioPath = getRicettarioPath();
                const slug = CATEGORY_FOLDERS[name] || name.toLowerCase().replace(/\s+/g, '-');
                const catKey = slug.replace(/-/g, '_');

                ctx.log(`🗑️ Rimozione categoria: "${name}" (slug: ${slug})`);

                // ── 1. Gestione ricette orfane ──
                const recipesDir = resolve(ricettarioPath, 'ricette', slug);
                const imagesDir = resolve(ricettarioPath, 'public', 'images', 'ricette', slug);
                let recipesCount = 0;

                if (existsSync(recipesDir)) {
                    const jsonFiles = readdirSync(recipesDir).filter(f => f.endsWith('.json') && !f.endsWith('.backup.json'));
                    recipesCount = jsonFiles.length;

                    if (recipesCount > 0 && moveTo) {
                        const destSlug = CATEGORY_FOLDERS[moveTo] || moveTo.toLowerCase().replace(/\s+/g, '-');
                        const destDir = resolve(ricettarioPath, 'ricette', destSlug);
                        const destImgDir = resolve(ricettarioPath, 'public', 'images', 'ricette', destSlug);
                        mkdirSync(destDir, { recursive: true });
                        mkdirSync(destImgDir, { recursive: true });

                        ctx.log(`\n📦 Spostamento ${recipesCount} ricette → ${moveTo}...\n`);

                        for (const file of readdirSync(recipesDir)) {
                            const src = resolve(recipesDir, file);
                            const dst = resolve(destDir, file);
                            try {
                                renameSync(src, dst);
                                // Se è il file .json principale, aggiorna il campo category
                                if (file.endsWith('.json') && !file.endsWith('.backup.json')) {
                                    try {
                                        const data = JSON.parse(readFileSync(dst, 'utf-8'));
                                        data.category = moveTo;
                                        writeFileSync(dst, JSON.stringify(data, null, 2), 'utf-8');
                                    } catch {}
                                }
                                ctx.log(`  ✅ ${file}`);
                            } catch (e) {
                                ctx.log(`  ⚠️ ${file}: ${e.message}`);
                            }
                        }

                        // Sposta anche le immagini
                        if (existsSync(imagesDir)) {
                            for (const imgFile of readdirSync(imagesDir)) {
                                try {
                                    renameSync(resolve(imagesDir, imgFile), resolve(destImgDir, imgFile));
                                    ctx.log(`  🖼️ ${imgFile}`);
                                } catch {}
                            }
                        }
                    } else if (recipesCount > 0) {
                        ctx.log(`\n📦 Backup ${recipesCount} ricette (nessuna destinazione)...`);
                    }
                }

                // ── 2. Backup della cartella (soft-delete) ──
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const backupBase = resolve(ricettarioPath, 'ricette', '.backup');
                mkdirSync(backupBase, { recursive: true });

                if (existsSync(recipesDir) && readdirSync(recipesDir).length > 0) {
                    const backupDir = resolve(backupBase, `${slug}_${timestamp}`);
                    cpSync(recipesDir, backupDir, { recursive: true });
                    ctx.log(`\n💾 Backup salvato in: ricette/.backup/${slug}_${timestamp}/`);
                }

                // Backup immagini ricette
                if (existsSync(imagesDir) && readdirSync(imagesDir).length > 0) {
                    const imgBackup = resolve(backupBase, `${slug}_images_${timestamp}`);
                    cpSync(imagesDir, imgBackup, { recursive: true });
                    ctx.log(`💾 Backup immagini in: ricette/.backup/${slug}_images_${timestamp}/`);
                }

                // ── 3. Rimuovi cartelle originali ──
                if (existsSync(recipesDir)) {
                    rmSync(recipesDir, { recursive: true, force: true });
                    ctx.log(`🗂️ Rimossa cartella: ricette/${slug}/`);
                }
                if (existsSync(imagesDir)) {
                    rmSync(imagesDir, { recursive: true, force: true });
                    ctx.log(`🗂️ Rimossa cartella: images/ricette/${slug}/`);
                }

                // ── 4. Rimuovi emoji PNG (se esclusiva) ──
                const dataKey = catKey;
                const catData = CATEGORIES_DATA[dataKey];
                if (catData) {
                    const emojiPng = resolve(ricettarioPath, 'public', 'images', 'emoji', `${catData.emoji?.replace(/:/g, '') || slug}.png`);
                    // Non rimuoviamo emoji usate da altre categorie — verifica
                    // Per ora le emoji le lasciamo, sono asset condivisi
                }

                // ── 5. Aggiorna constants.js ──
                const constantsPath = resolve(__dirname, '..', '..', 'constants.js');
                let constantsContent = readFileSync(constantsPath, 'utf-8');

                // Helper: rimuovi una riga contenente un pattern da un blocco specifico
                function removeLineFromBlock(content, constName, pattern) {
                    const lines = content.split('\n');
                    const declIdx = lines.findIndex(l => l.includes(`export const ${constName}`));
                    if (declIdx === -1) return content;
                    // Trova la chiusura del blocco
                    let closeIdx = -1;
                    for (let i = declIdx + 1; i < lines.length; i++) {
                        if (lines[i].match(/^(};|];)/)) { closeIdx = i; break; }
                    }
                    if (closeIdx === -1) return content;
                    // Rimuovi la riga che matcha il pattern (tra decl e close)
                    for (let i = declIdx + 1; i < closeIdx; i++) {
                        if (lines[i].includes(pattern)) {
                            lines.splice(i, 1);
                            closeIdx--;
                            break;
                        }
                    }
                    // Pulisci trailing comma sull'ultimo elemento se necessario
                    if (closeIdx > 0 && lines[closeIdx - 1]) {
                        lines[closeIdx - 1] = lines[closeIdx - 1].replace(/,(\s*)$/, '$1');
                    }
                    return lines.join('\n');
                }

                constantsContent = removeLineFromBlock(constantsContent, 'ALL_CATEGORIES', `'${name}'`);
                constantsContent = removeLineFromBlock(constantsContent, 'CATEGORY_FOLDERS', `'${name}'`);
                constantsContent = removeLineFromBlock(constantsContent, 'CATEGORIES_DATA', `${catKey}:`);
                writeFileSync(constantsPath, constantsContent, 'utf-8');
                ctx.log(`💾 constants.js aggiornato`);

                // ── 6. Aggiorna categories.js (frontend SPA) ──
                const categoriesPath = resolve(ricettarioPath, 'js', 'categories.js');
                let catContent = readFileSync(categoriesPath, 'utf-8');
                catContent = removeLineFromBlock(catContent, 'CATEGORIES', `${catKey}:`);
                catContent = removeLineFromBlock(catContent, 'CATEGORY_ORDER', `'${catKey}'`);
                writeFileSync(categoriesPath, catContent, 'utf-8');
                ctx.log(`💾 categories.js aggiornato`);

                // ── 7. Aggiorna emoji.js se l'emoji era stata aggiunta ──
                const emojiJsPath = resolve(ricettarioPath, 'js', 'emoji.js');
                if (existsSync(emojiJsPath)) {
                    const catEmoji = catData?.emoji;
                    if (catEmoji) {
                        // Leggi categories.js per controllare che nessun'altra categoria usi la stessa emoji
                        const freshCatContent = readFileSync(categoriesPath, 'utf-8');
                        if (!freshCatContent.includes(`'${catEmoji}'`)) {
                            let emojiContent = readFileSync(emojiJsPath, 'utf-8');
                            emojiContent = removeLineFromBlock(emojiContent, 'EMOJI_MAP', `'${catEmoji}'`);
                            writeFileSync(emojiJsPath, emojiContent, 'utf-8');
                            ctx.log(`💾 emoji.js aggiornato (emoji ${catEmoji} rimossa)`);
                        }
                    }
                }

                // ── 8. Aggiorna oggetti live in memoria ──
                const idx = ALL_CATEGORIES.indexOf(name);
                if (idx !== -1) ALL_CATEGORIES.splice(idx, 1);
                delete CATEGORY_FOLDERS[name];
                delete CATEGORIES_DATA[catKey];

                // ── 9. Sync cards ──
                ctx.log('\n🔄 Sync cards...');
                const { syncCards } = await import('../../commands/sync-cards.js');
                await syncCards({});
                ctx.log('✅ recipes.json sincronizzato');

                ctx.log(`\n🎉 Categoria "${name}" rimossa con successo!`);
                if (moveTo) ctx.log(`   📦 ${recipesCount} ricette spostate in "${moveTo}"`);
                ctx.log(`   💾 Backup disponibile in ricette/.backup/`);
            });
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });
}
