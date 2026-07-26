/**
 * HERO DI CATEGORIA — scarico una tantum da Pexels, GIÀ ESEGUITO.
 *
 * Scaricava due immagini di copertina (Lievitati e Dolci) cercandole su Pexels.
 * Le categorie e le query sono scritte a mano qui dentro: non è un comando
 * generico, è lo scarico di quella volta lì.
 *
 * Perché sta in archive/: nessuno lo importa, non è in package.json né nel
 * README, e la cartella `images/categories/` sul sito oggi non esiste — quelle
 * copertine non le usa più nessuna pagina.
 *
 * Com'era pericoloso: la cartella di destinazione era un percorso assoluto
 * scritto a mano (`C:/Users/dom19/Desktop/Ricettario/Ricettario/Ricettario/...`)
 * che non esiste più da quando il progetto si è spostato. Siccome creava la
 * cartella con `recursive: true`, non falliva: si costruiva da solo un albero
 * di cartelle finto sul Desktop, fuori da entrambi i repo, e ci scaricava
 * dentro le foto. Zero errori a schermo, due file scritti nel posto sbagliato.
 *
 * Ora: il percorso è derivato dal repo del sito come in tutti gli altri
 * comandi, non scrive niente finché non glielo chiedi con --scrivi, parte solo
 * se lanciato a mano e si ferma subito se manca la chiave Pexels.
 *
 * Uso — riattivazione a mano, fuori dalla pipeline: il flusso normale non lo
 * lancia mai e il README dice giustamente di non lanciarlo. Queste righe
 * servono a chi decide di rieseguirlo apposta, sapendo cosa fa.
 *       node archive/download-category-hero.mjs            ← mostra cosa scaricherebbe
 *       node archive/download-category-hero.mjs --scrivi   ← scarica davvero
 */

import { config } from 'dotenv';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

// Il .env sta nella radice di tools/, non dove ti trovi quando lanci il comando.
config({ path: path.resolve(import.meta.dirname, '..', '.env') });

const PEXELS_KEY = process.env.PEXELS_API_KEY;

// Stessa convenzione di percorso di tutti gli altri comandi del progetto.
const RICETTARIO_PATH = path.resolve(process.cwd(), process.env.RICETTARIO_PATH || '../Ricettario');
const OUT_DIR = path.resolve(RICETTARIO_PATH, 'public', 'images', 'categories');

function pexelsSearch(query) {
    return new Promise((resolve, reject) => {
        const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`;
        https.get(url, { headers: { Authorization: PEXELS_KEY } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

function download(url, filepath) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return download(res.headers.location, filepath).then(resolve).catch(reject);
            }
            const file = fs.createWriteStream(filepath);
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
    });
}

const HERO = [
    { nome: 'Lievitati', query: 'fresh croissants pastry bakery golden', file: 'lievitati-hero.jpg' },
    { nome: 'Dolci', query: 'italian biscotti cookies pastry dessert', file: 'dolci-hero.jpg' },
];

async function main() {
    const scrivi = process.argv.includes('--scrivi');

    if (!PEXELS_KEY) {
        console.error('❌ Manca PEXELS_API_KEY nel file .env: senza chiave la ricerca non risponde.');
        process.exit(1);
    }

    console.log(`📁 Destinazione: ${OUT_DIR}`);
    if (!scrivi) {
        console.log('🔍 Modalità prova: nessun file verrà scritto (usa --scrivi per scaricare davvero)\n');
    } else if (!fs.existsSync(OUT_DIR)) {
        console.error(`❌ La cartella non esiste: ${OUT_DIR}`);
        console.error('   Sul sito le copertine di categoria non esistono più. Se le vuoi davvero,');
        console.error('   crea prima la cartella a mano: così non se ne inventa una nel posto sbagliato.');
        process.exit(1);
    }

    for (const { nome, query, file } of HERO) {
        console.log(`🔍 Cerco immagine per ${nome}...`);
        const risultato = await pexelsSearch(query);
        const img = risultato.photos?.[0];
        if (!img) {
            console.warn(`  ⚠️ Nessun risultato per "${query}" — salto ${file}`);
            continue;
        }
        console.log(`  🏆 "${img.alt}" — ${img.src.large2x}`);
        if (!scrivi) {
            console.log(`  [prova] la salverei in ${path.join(OUT_DIR, file)}`);
            continue;
        }
        await download(img.src.large2x, path.join(OUT_DIR, file));
        console.log(`  ✅ Salvata ${file}`);
    }
}

// Parte SOLO se lanciato esplicitamente, mai al semplice import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(console.error);
}
