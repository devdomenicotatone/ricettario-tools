/**
 * ROUTES/CATEGORIES — Cambia, aggiungi, rimuovi categorie
 */

import { resolve, dirname } from 'path';
import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync, cpSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Backup delle categorie rimosse. DEVE stare fuori dal repo del sito: dentro
 * `ricette/` ogni cartella è per contratto una categoria dichiarata in
 * js/categories.js, quindi `ricette/.backup/` faceva fallire `npm run check`
 * con «non è dichiarata in js/categories.js» e bloccava la pubblicazione.
 */
const BACKUP_DIR = resolve(__dirname, '..', '..', '..', 'data', 'backup-categorie');

// ── Helper condivisi per riscrivere i registry (js/categories.js, js/emoji.js) ──

/** Rende una stringa sicura dentro un literal JS con apici singoli (apostrofi italiani!). */
export function escJs(str) {
    return String(str ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, ' ');
}

/** Inserisce testo prima della chiusura di un blocco `export const NOME = ...`. */
export function insertBeforeBlockClose(content, constName, closingStr, insertion) {
    const declIdx = content.indexOf(`export const ${constName}`);
    if (declIdx === -1) return content;
    const closeIdx = content.indexOf(closingStr, declIdx);
    if (closeIdx === -1) return content;
    return content.slice(0, closeIdx) + insertion + '\n' + content.slice(closeIdx);
}

/** Rimuove la riga che contiene `pattern` dentro un blocco oggetto (una voce per riga). */
export function removeLineFromBlock(content, constName, pattern) {
    const lines = content.split('\n');
    const declIdx = lines.findIndex(l => l.includes(`export const ${constName}`));
    if (declIdx === -1) return content;
    let closeIdx = -1;
    for (let i = declIdx + 1; i < lines.length; i++) {
        if (lines[i].match(/^(};|];)/)) { closeIdx = i; break; }
    }
    if (closeIdx === -1) return content;
    for (let i = declIdx + 1; i < closeIdx; i++) {
        if (lines[i].includes(pattern)) {
            lines.splice(i, 1);
            closeIdx--;
            break;
        }
    }
    if (closeIdx > 0 && lines[closeIdx - 1]) {
        lines[closeIdx - 1] = lines[closeIdx - 1].replace(/,(\s*)$/, '$1');
    }
    return lines.join('\n');
}

/**
 * Rimuove UN elemento da un array di stringhe, anche quando l'array sta tutto
 * su una riga sola — che è il caso di CATEGORY_ORDER nel sito. Con la rimozione
 * "per riga" si cancellavano tutte e nove le categorie insieme.
 */
export function removeKeyFromArrayBlock(content, constName, key) {
    const declIdx = content.indexOf(`export const ${constName}`);
    if (declIdx === -1) return content;
    const openIdx = content.indexOf('[', declIdx);
    const closeIdx = content.indexOf(']', openIdx);
    if (openIdx === -1 || closeIdx === -1) return content;

    const voci = content.slice(openIdx + 1, closeIdx)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    const rimaste = voci.filter(v => v.replace(/['"]/g, '') !== key);
    if (rimaste.length === voci.length) return content;

    return content.slice(0, openIdx + 1)
        + `\n  ${rimaste.join(', ')},\n`
        + content.slice(closeIdx);
}

/**
 * Valuta il contenuto di js/categories.js SENZA scriverlo su disco e ne restituisce
 * gli export. Serve come rete di sicurezza: se la riscrittura ha prodotto JS non
 * valido o un registry incoerente, ce ne accorgiamo qui invece che al prossimo
 * `npm run check` del sito, in un altro repo e con un errore che non nomina niente.
 */
export async function leggiRegistry(contenuto) {
    const url = 'data:text/javascript;base64,' + Buffer.from(contenuto, 'utf-8').toString('base64');
    const mod = await import(url);
    return { CATEGORIES: mod.CATEGORIES || {}, CATEGORY_ORDER: mod.CATEGORY_ORDER || [] };
}

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

                // ── 4. Aggiorna il registry del sito (js/categories.js) ──
                // È la fonte unica delle categorie: constants.js di tools lo legge e ne
                // deriva le proprie strutture, quindi non c'è più niente da scrivere lato
                // backend (prima si scrivevano entrambi, e le due copie divergevano).
                const nextOrder = Object.keys(CATEGORIES_DATA).length + 1;
                const catKey = slug.replace(/-/g, '_');

                const categoriesPath = resolve(ricettarioPath, 'js', 'categories.js');
                const catContentPrima = readFileSync(categoriesPath, 'utf-8');

                // `dir` e `unicode` sono obbligatori. Senza `dir` il sito non sa in quale
                // cartella vive la categoria e `npm run check` muore al primo comando con
                // "The paths[1] argument must be of type string" — un errore che non nomina
                // né la categoria né la dashboard, e che blocca ogni pubblicazione.
                const catEntry = `  ${catKey}: { name: '${escJs(categoryName)}', dir: '${escJs(slug)}', emoji: '${escJs(metadata.fluentEmojiSlug)}', unicode: '${escJs(metadata.unicodeEmoji)}', title: '${escJs(metadata.title)}', desc: '${escJs(metadata.description)}' },`;

                let catContent = insertBeforeBlockClose(catContentPrima, 'CATEGORIES', '\n};', catEntry);
                catContent = insertBeforeBlockClose(catContent, 'CATEGORY_ORDER', '\n];', ` '${catKey}',`);

                // Rete di sicurezza: valuta il risultato PRIMA di scriverlo su disco.
                const regPrima = await leggiRegistry(catContentPrima);
                const regDopo = await leggiRegistry(catContent);
                const nuova = regDopo.CATEGORIES[catKey];
                if (Object.keys(regDopo.CATEGORIES).length !== Object.keys(regPrima.CATEGORIES).length + 1
                    || regDopo.CATEGORY_ORDER.length !== regPrima.CATEGORY_ORDER.length + 1
                    || !nuova?.name || !nuova?.dir || !nuova?.unicode) {
                    throw new Error(
                        `Riscrittura di js/categories.js incoerente (da ${Object.keys(regPrima.CATEGORIES).length} ` +
                        `a ${Object.keys(regDopo.CATEGORIES).length} categorie). Non ho scritto niente.`
                    );
                }

                writeFileSync(categoriesPath, catContent, 'utf-8');
                ctx.log(`💾 js/categories.js del sito aggiornato (${Object.keys(regDopo.CATEGORIES).length} categorie)`);

                // Aggiorna oggetti live in memoria (no restart necessario)
                ALL_CATEGORIES.push(categoryName);
                CATEGORY_FOLDERS[categoryName] = slug;
                CATEGORIES_DATA[catKey] = { emoji: metadata.unicodeEmoji, label: categoryName, order: nextOrder };

                // ── 5. Aggiorna emoji.js (frontend SPA) — EMOJI_MAP ──
                if (emojiDownloaded) {
                    const emojiJsPath = resolve(ricettarioPath, 'js', 'emoji.js');
                    let emojiContent = readFileSync(emojiJsPath, 'utf-8');
                    emojiContent = insertBeforeBlockClose(emojiContent, 'EMOJI_MAP',
                        '\n};', `  '${metadata.fluentEmojiSlug}': '${metadata.fluentEmojiSlug}',`);
                    writeFileSync(emojiJsPath, emojiContent, 'utf-8');
                    ctx.log(`💾 emoji.js aggiornato`);
                }

                // ── 6. Sync cards ──
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
                // La cartella viene creata solo se c'è davvero qualcosa da salvare.
                const haRicette = existsSync(recipesDir) && readdirSync(recipesDir).length > 0;
                const haImmagini = existsSync(imagesDir) && readdirSync(imagesDir).length > 0;
                if (haRicette || haImmagini) mkdirSync(BACKUP_DIR, { recursive: true });

                if (haRicette) {
                    const backupDir = resolve(BACKUP_DIR, `${slug}_${timestamp}`);
                    cpSync(recipesDir, backupDir, { recursive: true });
                    ctx.log(`\n💾 Backup salvato in: tools/data/backup-categorie/${slug}_${timestamp}/`);
                }

                // Backup immagini ricette
                if (haImmagini) {
                    const imgBackup = resolve(BACKUP_DIR, `${slug}_images_${timestamp}`);
                    cpSync(imagesDir, imgBackup, { recursive: true });
                    ctx.log(`💾 Backup immagini in: tools/data/backup-categorie/${slug}_images_${timestamp}/`);
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

                // ── 5. Aggiorna il registry del sito (js/categories.js) ──
                // constants.js di tools non si tocca più: deriva da questo file.
                const categoriesPath = resolve(ricettarioPath, 'js', 'categories.js');
                const catContentPrima = readFileSync(categoriesPath, 'utf-8');

                let catContent = removeLineFromBlock(catContentPrima, 'CATEGORIES', `${catKey}:`);
                // CATEGORY_ORDER sta tutto su una riga sola: va tolto l'ELEMENTO, non la
                // riga. Cancellando la riga si perdevano tutte e nove le categorie insieme,
                // e il job diceva comunque "rimossa con successo".
                catContent = removeKeyFromArrayBlock(catContent, 'CATEGORY_ORDER', catKey);

                // Rete di sicurezza: valuta il risultato PRIMA di scriverlo su disco.
                const regPrima = await leggiRegistry(catContentPrima);
                const regDopo = await leggiRegistry(catContent);
                if (Object.keys(regDopo.CATEGORIES).length !== Object.keys(regPrima.CATEGORIES).length - 1
                    || regDopo.CATEGORY_ORDER.length !== regPrima.CATEGORY_ORDER.length - 1
                    || regDopo.CATEGORIES[catKey]
                    || regDopo.CATEGORY_ORDER.includes(catKey)) {
                    throw new Error(
                        `Riscrittura di js/categories.js incoerente: categorie da ` +
                        `${Object.keys(regPrima.CATEGORIES).length} a ${Object.keys(regDopo.CATEGORIES).length}, ` +
                        `ordine da ${regPrima.CATEGORY_ORDER.length} a ${regDopo.CATEGORY_ORDER.length}. ` +
                        `Non ho scritto niente.`
                    );
                }

                writeFileSync(categoriesPath, catContent, 'utf-8');
                ctx.log(`💾 js/categories.js del sito aggiornato (${Object.keys(regDopo.CATEGORIES).length} categorie rimaste)`);

                // ── 6. Aggiorna emoji.js se l'emoji era stata aggiunta ──
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

                // ── 7. Aggiorna oggetti live in memoria ──
                const idx = ALL_CATEGORIES.indexOf(name);
                if (idx !== -1) ALL_CATEGORIES.splice(idx, 1);
                delete CATEGORY_FOLDERS[name];
                delete CATEGORIES_DATA[catKey];

                // ── 8. Sync cards ──
                ctx.log('\n🔄 Sync cards...');
                const { syncCards } = await import('../../commands/sync-cards.js');
                await syncCards({});
                ctx.log('✅ recipes.json sincronizzato');

                ctx.log(`\n🎉 Categoria "${name}" rimossa con successo!`);
                if (moveTo) ctx.log(`   📦 ${recipesCount} ricette spostate in "${moveTo}"`);
                ctx.log(`   💾 Backup disponibile in tools/data/backup-categorie/`);
            });
            ctx.end(true);
        } catch (err) {
            ctx.error(`❌ Errore: ${err.message}`);
            ctx.end(false);
        }
    });
}
