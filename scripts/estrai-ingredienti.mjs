#!/usr/bin/env node
/**
 * ESTRAI-INGREDIENTI — il censimento che precede il dizionario FDC
 *
 * Primo passo del piano in USDA-TODO.md: prima di mappare gli ingredienti
 * sulle voci USDA FoodData Central serve sapere QUALI ingredienti esistono
 * nel ricettario, con che nomi, in quante ricette, con che pesi. Questo
 * script legge `ricette/x/x.json` dal repo del sito (campo
 * `ingredientGroups`) e scrive il censimento in data/fdc-ingredienti.json:
 * quella è la lista di lavoro su cui si costruisce il dizionario
 * ingrediente→fdcId. Rilanciarlo è sempre lecito: non inventa niente,
 * fotografa lo stato delle ricette.
 *
 * Cose imparate dai dati (28/07/2026) che il censimento conserva:
 *   - tutti gli item hanno `grams` numerico: il caso «q.b.» oggi non esiste;
 *   - `excludeFromTotal` ha DUE significati: «non entra nel prodotto»
 *     (semola per spolverare, olio per la teglia) oppure «già contato
 *     altrove» (i componenti di biga/poolish, che ricompaiono come voce
 *     composta nell'impasto finale). La distinzione va fatta a mano in
 *     fase di dizionario: qui si riporta il conteggio e basta.
 *
 * Uso:  node scripts/estrai-ingredienti.mjs
 */

import 'dotenv/config';
import { globSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RICETTARIO_DIR } from '../src/constants.js';
// La chiave di raggruppamento vive in src/nutrizione.js: censimento,
// dizionario e calcolo DEVONO normalizzare i nomi nello stesso modo.
import { chiaveDi } from '../src/nutrizione.js';

const RADICE = dirname(dirname(fileURLToPath(import.meta.url)));
const USCITA = join(RADICE, 'data', 'fdc-ingredienti.json');

const percorsi = globSync(join(RICETTARIO_DIR, 'ricette', '*', '*.json')).sort();
if (percorsi.length === 0) {
    console.error(`Nessuna ricetta trovata sotto ${join(RICETTARIO_DIR, 'ricette')}`);
    process.exit(1);
}

const censimento = new Map(); // chiave -> accumulatore
let ricetteLette = 0, itemTotali = 0, itemSenzaGrammi = 0;

for (const percorso of percorsi) {
    let ricetta;
    try {
        ricetta = JSON.parse(readFileSync(percorso, 'utf8'));
    } catch (e) {
        console.error(`JSON illeggibile, salto: ${percorso} (${e.message})`);
        continue;
    }
    if (!Array.isArray(ricetta.ingredientGroups)) continue;

    ricetteLette++;
    const pezzi = percorso.split(sep);
    const categoria = pezzi[pezzi.length - 2];
    const slug = pezzi[pezzi.length - 1].replace(/\.json$/, '');

    for (const gruppo of ricetta.ingredientGroups) {
        for (const item of gruppo.items || []) {
            if (!item.name) continue;
            itemTotali++;

            const chiave = chiaveDi(item.name);
            if (!censimento.has(chiave)) {
                censimento.set(chiave, {
                    nome: null,            // grafia più frequente, scelta alla fine
                    grafie: new Map(),     // grafia originale -> occorrenze
                    ricette: new Set(),
                    categorie: new Set(),
                    occorrenze: 0,
                    grammiTotali: 0,
                    esclusiDalTotale: 0,
                    note: new Set(),
                });
            }
            const voce = censimento.get(chiave);
            voce.grafie.set(item.name, (voce.grafie.get(item.name) || 0) + 1);
            voce.ricette.add(`${categoria}/${slug}`);
            voce.categorie.add(categoria);
            voce.occorrenze++;
            if (typeof item.grams === 'number') voce.grammiTotali += item.grams;
            else itemSenzaGrammi++;
            if (item.excludeFromTotal) voce.esclusiDalTotale++;
            if (item.note && voce.note.size < 3) voce.note.add(item.note);
        }
    }
}

// Dalla mappa all'elenco ordinato: prima chi compare in più ricette,
// a parità chi pesa di più nel ricettario.
const ingredienti = [...censimento.entries()]
    .map(([chiave, v]) => ({
        chiave,
        nome: [...v.grafie.entries()].sort((a, b) => b[1] - a[1])[0][0],
        grafie: [...v.grafie.keys()].sort(),
        ricette: v.ricette.size,
        occorrenze: v.occorrenze,
        grammiTotali: Math.round(v.grammiTotali),
        esclusiDalTotale: v.esclusiDalTotale,
        categorie: [...v.categorie].sort(),
        note: [...v.note],
        usaRicette: [...v.ricette].sort(),
    }))
    .sort((a, b) => b.ricette - a.ricette || b.grammiTotali - a.grammiTotali);

mkdirSync(dirname(USCITA), { recursive: true });
writeFileSync(USCITA, JSON.stringify({
    generato: new Date().toISOString(),
    fonte: join(RICETTARIO_DIR, 'ricette'),
    ricette: ricetteLette,
    itemTotali,
    itemSenzaGrammi,
    nomiUnici: ingredienti.length,
    ingredienti,
}, null, 2) + '\n');

// ── Riassunto a video ────────────────────────────────────────────────
console.log(`Ricette lette: ${ricetteLette} — item: ${itemTotali} (senza grammi: ${itemSenzaGrammi})`);
console.log(`Nomi unici (normalizzati): ${ingredienti.length}\n`);

const larghezza = Math.max(...ingredienti.slice(0, 15).map(i => i.nome.length));
console.log('I 15 più diffusi (n. ricette, kg complessivi):');
for (const i of ingredienti.slice(0, 15)) {
    console.log(
        `  ${i.nome.padEnd(larghezza)}  ${String(i.ricette).padStart(3)} ricette` +
        `  ${(i.grammiTotali / 1000).toFixed(1).padStart(7)} kg` +
        (i.esclusiDalTotale ? `  (${i.esclusiDalTotale} escl.)` : '')
    );
}

const singoli = ingredienti.filter(i => i.ricette === 1).length;
const conEsclusi = ingredienti.filter(i => i.esclusiDalTotale > 0).length;
console.log(`\nUsati in una sola ricetta: ${singoli} su ${ingredienti.length}`);
console.log(`Con almeno un uso escluso dal totale: ${conEsclusi}`);
console.log(`\nScritto: ${USCITA}`);
