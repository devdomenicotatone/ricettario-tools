#!/usr/bin/env node
/**
 * CONFRONTA-NUTRIZIONE — il calcolo USDA contro la stima AI in carica
 *
 * Per ogni ricetta del sito prova il calcolo vero (src/nutrizione.js) e
 * lo affianca ai numeri oggi pubblicati (stima del modello dentro
 * `nutrition`). Serve a due cose:
 *
 *   1. VALIDARE rese e dizionario: uno scarto enorme sulle kcal è quasi
 *      sempre una resa sbagliata o un ingrediente mappato male — la
 *      stima AI, per quanto stima, non sbaglia di 3 volte.
 *   2. Elencare ciò che BLOCCA il calcolo (rese non dichiarate, item
 *      ambigui): è la lista di lavoro della curatela, non un fallimento.
 *
 * Solo lettura: non tocca né le ricette né i dati. Uso:
 *   node scripts/confronta-nutrizione.mjs             # tutte
 *   node scripts/confronta-nutrizione.mjs pane pizza  # solo famiglie
 */

import { globSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { RICETTARIO_DIR } from '../src/constants.js';
import { caricaDatiCalcolo, calcolaNutrizione } from '../src/nutrizione.js';

const soloFamiglie = process.argv.slice(2);
const { dizionario, calcolo } = caricaDatiCalcolo();

const righe = [];
const bloccate = new Map(); // motivo sintetico -> [ricette]

for (const percorso of globSync(join(RICETTARIO_DIR, 'ricette', '*', '*.json')).sort()) {
    const pezzi = percorso.split(sep);
    const categoria = pezzi[pezzi.length - 2];
    const slug = pezzi[pezzi.length - 1].replace(/\.json$/, '');
    if (soloFamiglie.length && !soloFamiglie.includes(categoria)) continue;

    const ricetta = JSON.parse(readFileSync(percorso, 'utf8'));
    const esito = calcolaNutrizione(ricetta, { categoria, slug, dizionario, calcolo });

    if (esito.errori) {
        for (const errore of esito.errori) {
            const motivo = errore.replace(/«[^»]*»/g, '«…»').slice(0, 90);
            if (!bloccate.has(motivo)) bloccate.set(motivo, []);
            bloccate.get(motivo).push(`${categoria}/${slug}`);
        }
        continue;
    }

    const ai = ricetta.nutrition;
    const kcalAI = ai?.kcal_per_100g ?? null;
    const kcal = esito.nutrition.kcal_per_100g;
    righe.push({
        ricetta: `${categoria}/${slug}`,
        kcal,
        kcalAI,
        scarto: kcalAI ? Math.round(100 * (kcal - kcalAI) / kcalAI) : null,
        m: esito.nutrition.macros,
        mAI: ai?.macros || {},
        resa: esito.dettaglio.resa,
        avvisi: esito.dettaglio.avvisi,
    });
}

righe.sort((a, b) => Math.abs(b.scarto ?? 0) - Math.abs(a.scarto ?? 0));

console.log(`=== CALCOLATE: ${righe.length} ===`);
console.log('scarto% | kcal USDA vs AI | C/P/G USDA vs AI | resa | ricetta');
for (const r of righe) {
    console.log(
    `  ${String(r.scarto ?? '—').padStart(4)}% | ${String(r.kcal).padStart(4)} vs ${String(r.kcalAI ?? '—').padStart(4)}` +
        ` | ${r.m.carbs}/${r.m.protein}/${r.m.fat} vs ${r.mAI.carbs ?? '—'}/${r.mAI.protein ?? '—'}/${r.mAI.fat ?? '—'}` +
        ` | ${r.resa} | ${r.ricetta}` + (r.avvisi.length ? `  ⚠ ${r.avvisi.length} avvisi` : '')
    );
}

if (bloccate.size) {
    const totale = new Set([...bloccate.values()].flat()).size;
    console.log(`\n=== BLOCCATE: ${totale} ricette ===`);
    for (const [motivo, ricette] of [...bloccate.entries()].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`  [${ricette.length}] ${motivo}`);
        for (const r of ricette.slice(0, 4)) console.log(`        ${r}`);
        if (ricette.length > 4) console.log(`        … e altre ${ricette.length - 4}`);
    }
}
