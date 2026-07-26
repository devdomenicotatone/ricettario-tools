/**
 * PULIZIA TAG FERMENTAZIONE — migrazione una tantum, GIÀ ESEGUITA.
 *
 * Accorcia i campi "fermentation" e "time" troppo verbosi nei JSON delle
 * ricette: toglie i dettagli fra parentesi e somma le fasi ("~18-20h biga +
 * 2-2.5h puntata + 1h appretto" → "~21-24h totali").
 *
 * Perché sta in archive/: nessuno lo importa, non è in package.json né nel
 * README, e stava in `src/dashboard/scratch/` — cioè dentro la cartella che il
 * server pubblica con `express.static` (in src/server/index.js), quindi era
 * anche scaricabile da chiunque raggiungesse la dashboard.
 *
 * Com'era pericoloso, e più di add-storage-backfill: chiamava `processDir()`
 * all'ultima riga, quindi bastava importarlo per farlo partire; riscriveva
 * TUTTI i JSON delle ricette senza copia di sicurezza, senza conferma e senza
 * dry-run; e il percorso che costruiva — a differenza di add-storage-backfill —
 * era quello vero (`Ricettario/ricette`, 9 categorie, 166 file). L'unica cosa
 * che l'ha tenuto innocuo è che nessuno l'ha mai importato.
 *
 * Da tenere a mente se lo rilanci: `cleanTag` somma le durate delle fasi in
 * modo approssimato e tronca. Su una ricetta i cui tag sono già a posto non
 * cambia niente (interviene solo sopra i 20 caratteri), ma non è una funzione
 * che si può rilanciare a occhi chiusi: guarda prima il --dry-run.
 *
 * Ora: parte solo se lanciato a mano, usa lo stesso percorso di tutti gli altri
 * comandi e ha un --dry-run.
 *
 * Sulla copia di sicurezza, che NON è una rete gratis: `<slug>.backup.json` è
 * uno slot solo, condiviso con l'editor e con i fix AI della dashboard. Se la
 * ricetta ne ha già uno, scriverci sopra butterebbe via quella versione, quindi
 * qui la ricetta viene SALTATA e il file lasciato com'è: tocca a te decidere
 * cosa fare del backup vecchio. Un nome alternativo con la data non è
 * un'opzione: il generatore del sito scarta solo `.backup.json` e
 * `.pre-edit.json` (scripts/build-recipes.js), quindi un `.backup-2026-…json`
 * finirebbe nell'indice come se fosse una ricetta vera.
 *
 * Cosa aspettarsi lanciandolo OGGI, che non è quello che sembra: 79 delle 80
 * ricette del sito hanno già un `.backup.json` accanto, quindi lo slot è quasi
 * sempre occupato e lo script SALTA senza fare niente. Il --dry-run del
 * 26/07/2026 stampa la trasformazione di pinsa-romana.json (`"24-72h in frigo
 * (maturazione a freddo)" → "24-72h in frigo"`) e poi chiude con «0 ricette
 * verrebbero aggiornate, 1 saltate». Non è un guasto: è la regola del backup
 * che fa il suo mestiere. Se vuoi davvero applicare quella modifica, sposta o
 * cancella a mano il backup della ricetta in questione e rilancia.
 *
 * Uso — riattivazione a mano, fuori dalla pipeline: il flusso normale non lo
 * lancia mai e il README dice giustamente di non lanciarlo. Queste righe
 * servono a chi decide di rieseguirlo apposta, sapendo cosa fa.
 *       node archive/clean-fermentation-tags.js --dry-run
 *       node archive/clean-fermentation-tags.js
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, resolve, basename } from 'path';
import { pathToFileURL } from 'url';
import { config } from 'dotenv';

// Il .env sta nella radice di tools/, non dove ti trovi quando lanci il comando.
config({ path: resolve(import.meta.dirname, '..', '.env') });

// Stessa convenzione di percorso di tutti gli altri comandi del progetto.
const RICETTARIO_PATH = resolve(process.cwd(), process.env.RICETTARIO_PATH || '../Ricettario');
const RICETTE_DIR = join(RICETTARIO_PATH, 'ricette');

const DRY_RUN = process.argv.includes('--dry-run');

function cleanTag(value) {
    if (!value || typeof value !== 'string') return value;

    // Mapping specifici per casi noti
    const overrides = {
        'Nessuna fermentazione richiesta': 'Nessuna',
        'nessuna (riposo 20-40 min)': 'Riposo 20-40 min',
    };
    if (overrides[value]) return overrides[value];

    // Rimuovi tutto tra parentesi: "5-6h totali (biga 1,5-2h ...)" → "5-6h totali"
    let cleaned = value.replace(/\s*\([^)]*\)/g, '').trim();

    // Rimuovi dettagli dopo il "+" quando è molto verboso
    // Es: "~18-20h biga + 2-2.5h puntata + 1h appretto" → "~21-24h totali"
    // Ma prima proviamo un approccio: se contiene più di 2 segmenti con "+", sintetizziamo
    if (cleaned.split('+').length > 1 && cleaned.length > 25) {
        // Estrai i numeri e somma approssimativamente
        const parts = value.split('+').map(s => s.trim());
        const nums = parts.map(p => {
            const m = p.match(/([\d.,]+)(?:\s*-\s*([\d.,]+))?\s*h/);
            if (m) {
                const lo = parseFloat(m[1].replace(',', '.'));
                const hi = m[2] ? parseFloat(m[2].replace(',', '.')) : lo;
                return { lo, hi };
            }
            const mMin = p.match(/([\d]+)\s*min/);
            if (mMin) return { lo: parseInt(mMin[1]) / 60, hi: parseInt(mMin[1]) / 60 };
            return null;
        }).filter(Boolean);

        if (nums.length >= 2) {
            const totalLo = Math.round(nums.reduce((s, n) => s + n.lo, 0));
            const totalHi = Math.round(nums.reduce((s, n) => s + n.hi, 0));
            if (totalLo === totalHi) {
                cleaned = `~${totalLo}h totali`;
            } else {
                cleaned = `~${totalLo}-${totalHi}h totali`;
            }
        }
    }

    // Tronca a max 25 caratteri per sicurezza
    if (cleaned.length > 30) {
        // Cerca di tagliare a un punto sensato
        const cutIdx = cleaned.indexOf('+');
        if (cutIdx > 5) cleaned = cleaned.substring(0, cutIdx).trim();
    }

    return cleaned;
}

function processDir(dir) {
    let changes = 0;
    let saltate = 0;
    for (const f of readdirSync(dir)) {
        const full = join(dir, f);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            const sotto = processDir(full);
            changes += sotto.changes;
            saltate += sotto.saltate;
        } else if (extname(f) === '.json' && !f.includes('.backup.') && !f.includes('.pre-edit.')) {
            try {
                const raw = readFileSync(full, 'utf8');
                const recipe = JSON.parse(raw);
                let changed = false;

                if (recipe.fermentation && recipe.fermentation.length > 20) {
                    const orig = recipe.fermentation;
                    recipe.fermentation = cleanTag(orig);
                    if (orig !== recipe.fermentation) {
                        console.log(`  ✏️  ${f}: fermentation`);
                        console.log(`      "${orig}" → "${recipe.fermentation}"`);
                        changed = true;
                    }
                }
                if (recipe.time && recipe.time.length > 20) {
                    const orig = recipe.time;
                    recipe.time = cleanTag(orig);
                    if (orig !== recipe.time) {
                        console.log(`  ✏️  ${f}: time`);
                        console.log(`      "${orig}" → "${recipe.time}"`);
                        changed = true;
                    }
                }

                if (changed) {
                    // Copia di sicurezza prima di riscrivere, come in ogni altro
                    // punto del progetto che modifica una ricetta — ma lo slot
                    // `.backup.json` è uno solo: se è già occupato non ci scrivo
                    // sopra, lascio stare la ricetta.
                    const backupPath = full.replace(/\.json$/, '.backup.json');
                    const backupOccupato = existsSync(backupPath);

                    if (backupOccupato) {
                        console.log(`      ⏭️  salto ${f}: esiste già ${basename(backupPath)}`);
                        console.log('         (riscriverlo perderebbe quella versione: spostalo o cancellalo a mano)');
                        saltate++;
                    } else if (DRY_RUN) {
                        console.log(`      [prova] non scrivo niente in ${f}`);
                        changes++;
                    } else {
                        writeFileSync(backupPath, raw, 'utf8');
                        writeFileSync(full, JSON.stringify(recipe, null, 2), 'utf8');
                        changes++;
                    }
                }
            } catch (e) {
                // skip invalid json
            }
        }
    }
    return { changes, saltate };
}

// Parte SOLO se lanciato esplicitamente, mai al semplice import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    console.log(DRY_RUN
        ? '🔍 PROVA (nessuna scrittura) — scansione ricette per tag troppo lunghi...\n'
        : '🔍 Scansione ricette per tag troppo lunghi...\n');
    console.log(`📂 Ricette: ${RICETTE_DIR}\n`);
    // Se il percorso è sbagliato (lanciato dalla cartella storta, o
    // RICETTARIO_PATH che punta altrove) meglio dirlo in italiano che lasciar
    // uscire lo stack trace di readdirSync.
    if (!existsSync(RICETTE_DIR)) {
        console.error(`❌ La cartella delle ricette non esiste: ${RICETTE_DIR}`);
        console.error('   Lancialo dalla radice di tools/, oppure sistema RICETTARIO_PATH nel .env.');
        process.exit(1);
    }
    const { changes: total, saltate } = processDir(RICETTE_DIR);
    console.log(DRY_RUN
        ? `\n✅ ${total} ricette verrebbero aggiornate.`
        : `\n✅ ${total} ricette aggiornate.`);
    if (saltate > 0) {
        console.log(`⏭️  ${saltate} saltate: avevano già una copia di sicurezza .backup.json, che non viene mai sovrascritta.`);
    }
    if (!DRY_RUN && total > 0) {
        console.log('ℹ️ Ricorda di risincronizzare l\'indice: node crea-ricetta.js --sync-cards');
    }
}
