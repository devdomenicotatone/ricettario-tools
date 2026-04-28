/**
 * Pulisce i campi "fermentation" e "time" troppo verbosi nei JSON ricette.
 * Mantiene solo la durata sintetica, rimuovendo i dettagli tra parentesi.
 * Eseguire con: node clean-fermentation-tags.js
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const RICETTE_DIR = join(import.meta.dirname, '..', '..', '..', '..', 'Ricettario', 'ricette');

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
    for (const f of readdirSync(dir)) {
        const full = join(dir, f);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            changes += processDir(full);
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
                    writeFileSync(full, JSON.stringify(recipe, null, 2), 'utf8');
                    changes++;
                }
            } catch (e) {
                // skip invalid json
            }
        }
    }
    return changes;
}

console.log('🔍 Scansione ricette per tag troppo lunghi...\n');
const total = processDir(RICETTE_DIR);
console.log(`\n✅ ${total} ricette aggiornate.`);
