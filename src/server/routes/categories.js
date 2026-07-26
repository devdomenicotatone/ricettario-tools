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

/**
 * Rende una stringa sicura dentro un literal JS con apici singoli.
 * In italiano gli apostrofi sono ovunque ("Ricette d'Autore", "l'aglio"): senza
 * questo escape il nome chiudeva la stringa a metà e js/categories.js del sito
 * diventava JS non valido — cioè il sito intero smetteva di caricarsi.
 * Si neutralizzano anche i terminatori di riga (`\r` da solo incluso), che
 * spezzerebbero il literal su due righe.
 */
export function escJs(str) {
    return String(str ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/[\r\n\u2028\u2029]+/g, ' ');
}

/**
 * Regex che riconosce la dichiarazione `const NOME`, con o senza `export`.
 * Non tutti i registry del sito esportano: `EMOJI_MAP` in js/emoji.js è un
 * `const` interno al modulo, e cercare solo `export const` significava non
 * trovarlo mai — e scrivere il file identico dichiarando "aggiornato".
 */
function reDichiarazione(constName) {
    return new RegExp(`(?:export\\s+)?const\\s+${constName}\\b`);
}

/**
 * Separa una riga nella parte di CODICE e nell'eventuale commento `// ...` di
 * coda. Gli apici vengono seguiti, così un `//` dentro una stringa (un URL in
 * `desc`) non viene scambiato per l'inizio di un commento.
 */
function spezzaCommento(riga) {
    let apice = null;
    for (let i = 0; i < riga.length; i++) {
        const c = riga[i];
        if (apice) {
            if (c === '\\') i++;
            else if (c === apice) apice = null;
        } else if (c === "'" || c === '"' || c === '`') {
            apice = c;
        } else if (c === '/' && riga[i + 1] === '/') {
            return { codice: riga.slice(0, i), commento: riga.slice(i) };
        }
    }
    return { codice: riga, commento: '' };
}

/**
 * Inserisce testo prima della chiusura di un blocco `const NOME = ...`.
 * Se non trova il blocco LANCIA un errore invece di restituire il contenuto
 * invariato: un ritorno silenzioso faceva scrivere il file identico e stampare
 * "💾 aggiornato", cioè il caso peggiore — nessuna modifica e nessun avviso.
 *
 * La voce nuova va su una RIGA PROPRIA. Senza l'a-capo DAVANTI finiva incollata
 * a quella precedente (`'tomato': 'tomato',  'fish': 'fish',`), e `removeLineFromBlock`
 * cancella la riga intera: la rimozione successiva si portava via anche la chiave
 * accanto. "Una voce per riga" è l'invariante su cui l'altro helper si basa.
 *
 * L'ultima voce deve inoltre chiudere con una virgola: `removeLineFromBlock`
 * toglie quella dell'ultima riga, quindi un ciclo rimuovi → aggiungi produceva
 * JS non valido. La virgola va messa in fondo al CODICE, non in fondo alla riga:
 * su `'b': 'b'  // nota` appenderla alla riga la infilava dentro il commento, che
 * se la mangiava — di nuovo JS non valido, su un file che nessuno rilegge prima
 * di scriverlo. E l'ultima riga di codice non è per forza quella subito sopra la
 * chiusura: in mezzo possono esserci righe vuote o di solo commento.
 */
export function insertBeforeBlockClose(content, constName, closingStr, insertion) {
    const decl = reDichiarazione(constName).exec(content);
    if (!decl) throw new Error(`dichiarazione di ${constName} non trovata`);
    const closeIdx = content.indexOf(closingStr, decl.index);
    if (closeIdx === -1) throw new Error(`chiusura del blocco ${constName} non trovata`);

    const righe = content.slice(0, closeIdx).split('\n');
    let i = righe.length - 1;
    while (i >= 0 && spezzaCommento(righe[i]).codice.trim() === '') i--;
    if (i >= 0) {
        const { codice, commento } = spezzaCommento(righe[i]);
        // Niente virgola dopo `{`/`[` (blocco vuoto) o dopo una già presente.
        if (!/[,[{(]$/.test(codice.trim())) {
            const spazi = codice.slice(codice.trimEnd().length);
            righe[i] = commento
                ? `${codice.trimEnd()},${spazi}${commento}`
                : `${codice.trimEnd()},`;
        }
    }
    return righe.join('\n') + '\n' + insertion + content.slice(closeIdx);
}

/**
 * Rimuove la riga che contiene `pattern` dentro un blocco oggetto (una voce per riga).
 * Come sopra: se non c'è niente da rimuovere lancia, non finge.
 */
export function removeLineFromBlock(content, constName, pattern) {
    const lines = content.split('\n');
    const re = reDichiarazione(constName);
    const declIdx = lines.findIndex(l => re.test(l));
    if (declIdx === -1) throw new Error(`dichiarazione di ${constName} non trovata`);
    let closeIdx = -1;
    for (let i = declIdx + 1; i < lines.length; i++) {
        if (lines[i].match(/^(};|];)/)) { closeIdx = i; break; }
    }
    if (closeIdx === -1) throw new Error(`chiusura del blocco ${constName} non trovata`);
    let rigaTrovata = -1;
    for (let i = declIdx + 1; i < closeIdx; i++) {
        if (lines[i].includes(pattern)) { rigaTrovata = i; break; }
    }
    if (rigaTrovata === -1) throw new Error(`nessuna riga con "${pattern}" dentro ${constName}`);
    lines.splice(rigaTrovata, 1);
    closeIdx--;
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
    const decl = reDichiarazione(constName).exec(content);
    if (!decl) throw new Error(`dichiarazione di ${constName} non trovata`);
    const openIdx = content.indexOf('[', decl.index);
    const closeIdx = content.indexOf(']', openIdx);
    if (openIdx === -1 || closeIdx === -1) throw new Error(`chiusura del blocco ${constName} non trovata`);

    const voci = content.slice(openIdx + 1, closeIdx)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    const rimaste = voci.filter(v => v.replace(/['"]/g, '') !== key);
    if (rimaste.length === voci.length) throw new Error(`"${key}" non è presente in ${constName}`);

    // Array svuotato: va emesso `[]`, non `[\n  ,\n]`. Quella virgola solitaria
    // produce un array SPARSO di lunghezza 1, quindi togliere l'ULTIMA categoria
    // faceva scattare la rete di sicurezza con «ordine da 1 a 1» — un messaggio
    // che non nomina la causa vera.
    return content.slice(0, openIdx + 1)
        + (rimaste.length ? `\n  ${rimaste.join(', ')},\n` : '')
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

/**
 * Stessa rete di sicurezza per js/emoji.js, l'altro file del sito che queste
 * rotte riscrivono. Non si può valutare intero come fa `leggiRegistry`: importa
 * `./router.js`, `./icons.js` e `./categories.js`, specificatori relativi che da
 * un `data:` URL non si risolvono. Si estrae quindi il solo blocco
 * `const EMOJI_MAP = { ... };` — un oggetto di sole stringhe — e si valuta quello.
 * Se la riscrittura ha prodotto JS non valido, l'import lancia PRIMA della
 * scrittura: senza, un emoji.js rotto manda giù la SPA del sito intera.
 */
export async function leggiEmojiMap(contenuto) {
    const decl = reDichiarazione('EMOJI_MAP').exec(contenuto);
    if (!decl) throw new Error('dichiarazione di EMOJI_MAP non trovata');
    const closeIdx = contenuto.indexOf('\n};', decl.index);
    if (closeIdx === -1) throw new Error('chiusura del blocco EMOJI_MAP non trovata');

    const blocco = contenuto.slice(decl.index, closeIdx + 3).replace(/^export\s+/, '');
    const url = 'data:text/javascript;base64,'
        + Buffer.from(`export ${blocco}`, 'utf-8').toString('base64');
    const mod = await import(url);
    return mod.EMOJI_MAP || {};
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

                // Lo slug arriva dal JSON del modello e finisce in un percorso su
                // disco, in un URL e (via escJs) nel sorgente JS del sito: `escJs`
                // lo rende innocuo solo dentro il literal. Uno slug tipo
                // `../../js/categories` scriverebbe il PNG fuori dalla cartella
                // emoji del sito, quindi qui vale la stessa regola dello slug
                // categoria. Se non passa si ripiega su fork-and-knife — anche la
                // cartella, altrimenti scaricheremmo un'emoji diversa SOPRA il
                // fork-and-knife.png che il sito già usa.
                if (!/^[a-z0-9-]{1,60}$/.test(String(metadata.fluentEmojiSlug ?? ''))
                    || !String(metadata.fluentEmojiFolder ?? '').trim()) {
                    ctx.log(`   ⚠️ Metadati emoji non validi ("${metadata.fluentEmojiSlug}"), uso fork-and-knife`);
                    metadata.fluentEmojiFolder = 'Fork and knife';
                    metadata.fluentEmojiSlug = 'fork-and-knife';
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
                catContent = insertBeforeBlockClose(catContent, 'CATEGORY_ORDER', '\n];', `  '${catKey}',`);

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
                // Passo secondario: se fallisce non annulliamo la categoria appena creata,
                // ma lo diciamo. Prima l'errore era invisibile — EMOJI_MAP non è esportata,
                // l'inserimento non avveniva mai e il file veniva riscritto identico con
                // sopra scritto "💾 emoji.js aggiornato".
                if (emojiDownloaded) {
                    const emojiJsPath = resolve(ricettarioPath, 'js', 'emoji.js');
                    const emojiKey = escJs(metadata.fluentEmojiSlug);
                    try {
                        const emojiPrima = readFileSync(emojiJsPath, 'utf-8');
                        if (emojiPrima.includes(`'${emojiKey}':`)) {
                            ctx.log(`ℹ️ emoji.js invariato: "${emojiKey}" è già in EMOJI_MAP`);
                        } else {
                            const emojiDopo = insertBeforeBlockClose(emojiPrima, 'EMOJI_MAP',
                                '\n};', `  '${emojiKey}': '${emojiKey}',`);
                            if (emojiDopo === emojiPrima) throw new Error('contenuto invariato');
                            // Rete di sicurezza, come per js/categories.js: valuta il
                            // risultato PRIMA di scriverlo su disco.
                            const mapPrima = await leggiEmojiMap(emojiPrima);
                            const mapDopo = await leggiEmojiMap(emojiDopo);
                            if (Object.keys(mapDopo).length !== Object.keys(mapPrima).length + 1
                                || !mapDopo[emojiKey]) {
                                throw new Error(
                                    `riscrittura incoerente (da ${Object.keys(mapPrima).length} a ` +
                                    `${Object.keys(mapDopo).length} voci). Non ho scritto niente.`
                                );
                            }
                            writeFileSync(emojiJsPath, emojiDopo, 'utf-8');
                            ctx.log(`💾 emoji.js aggiornato ('${emojiKey}' aggiunta a EMOJI_MAP)`);
                        }
                    } catch (emojiErr) {
                        ctx.log(`⚠️ emoji.js NON aggiornato: ${emojiErr.message}`);
                    }
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
                // La chiave di EMOJI_MAP è lo slug Fluent ('baguette-bread'), non l'emoji
                // unicode: CATEGORIES_DATA.emoji contiene l'unicode, quindi lo slug si legge
                // dal registro del sito com'era PRIMA della rimozione.
                const emojiJsPath = resolve(ricettarioPath, 'js', 'emoji.js');
                const fluentSlug = regPrima.CATEGORIES[catKey]?.emoji;
                if (existsSync(emojiJsPath) && fluentSlug) {
                    // Nessun'altra categoria deve usare lo stesso slug Fluent. La
                    // domanda si fa al registry GIÀ RILETTO, non al testo del file:
                    // cercare la sottostringa `'baguette-bread'` in js/categories.js
                    // pescava anche il commento JSDoc di CATEGORY_EMOJI_MAP
                    // (`Es: { Pane: 'baguette-bread', Pizza: 'pizza', ... }`), quindi
                    // per `pane` e `pizza` il job dichiarava «è usata anche da
                    // un'altra categoria» — falso — e non toccava emoji.js.
                    const ancoraUsata = Object.values(regDopo.CATEGORIES)
                        .some(c => c.emoji === fluentSlug);
                    if (ancoraUsata) {
                        ctx.log(`ℹ️ emoji.js invariato: "${fluentSlug}" è usata anche da un'altra categoria`);
                    } else {
                        try {
                            const emojiPrima = readFileSync(emojiJsPath, 'utf-8');
                            const emojiDopo = removeLineFromBlock(emojiPrima, 'EMOJI_MAP', `'${fluentSlug}':`);
                            if (emojiDopo === emojiPrima) throw new Error('contenuto invariato');
                            // Rete di sicurezza, come per js/categories.js.
                            const mapPrima = await leggiEmojiMap(emojiPrima);
                            const mapDopo = await leggiEmojiMap(emojiDopo);
                            if (Object.keys(mapDopo).length !== Object.keys(mapPrima).length - 1
                                || mapDopo[fluentSlug]) {
                                throw new Error(
                                    `riscrittura incoerente (da ${Object.keys(mapPrima).length} a ` +
                                    `${Object.keys(mapDopo).length} voci). Non ho scritto niente.`
                                );
                            }
                            writeFileSync(emojiJsPath, emojiDopo, 'utf-8');
                            ctx.log(`💾 emoji.js aggiornato (emoji ${fluentSlug} rimossa)`);
                        } catch (emojiErr) {
                            ctx.log(`⚠️ emoji.js NON aggiornato: ${emojiErr.message}`);
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
