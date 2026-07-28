#!/usr/bin/env node
/**
 * APPLICA-NUTRIZIONE — il batch solo-nutrizione previsto da USDA-TODO.md
 *
 * Ricalcola i valori nutrizionali di TUTTE le ricette del sito con
 * src/nutrizione.js (dati USDA + rese dichiarate) e li scrive nel campo
 * `nutrition` dei JSON, schema invariato: { kcal_per_100g, macros }.
 * Niente AI: è aritmetica su dichiarazioni, rilanciarlo è sempre lecito.
 *
 * Regole di scrittura:
 *   - il valore cambia → copia di sicurezza (serie 'nutrizione') e scrittura;
 *   - il calcolo si rifiuta → il campo `nutrition` viene RIMOSSO se
 *     presente: un numero stimato ieri non può stare sotto il disclaimer
 *     che oggi nomina USDA. Il rifiuto è elencato in fondo, coi motivi.
 *   - `--prova` mostra tutto senza scrivere niente.
 *
 * Alla fine sincronizza recipes.json (sync-cards), come fa la dashboard.
 *
 * Uso:  node scripts/applica-nutrizione.mjs [--prova]
 */

import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { RICETTARIO_DIR } from '../src/constants.js';
import { caricaDatiCalcolo, calcolaNutrizione } from '../src/nutrizione.js';
import { salvaCopiaSicurezza } from '../src/utils/backup-ricette.js';

const PROVA = process.argv.includes('--prova');
const { dizionario, calcolo } = caricaDatiCalcolo();

let scritte = 0, invariate = 0, rimosse = 0;
const rifiutate = [];

for (const percorso of globSync(join(RICETTARIO_DIR, 'ricette', '*', '*.json')).sort()) {
    const pezzi = percorso.split(sep);
    const categoria = pezzi[pezzi.length - 2];
    const slug = pezzi[pezzi.length - 1].replace(/\.json$/, '');

    const testoOriginale = readFileSync(percorso, 'utf8');
    const ricetta = JSON.parse(testoOriginale);
    const esito = calcolaNutrizione(ricetta, { categoria, slug, dizionario, calcolo });

    if (esito.errori) {
        rifiutate.push({ ricetta: `${categoria}/${slug}`, errori: esito.errori });
        if (ricetta.nutrition) {
            rimosse++;
            console.log(`  − ${categoria}/${slug}: calcolo rifiutato, rimuovo la vecchia stima`);
            if (!PROVA) {
                salvaCopiaSicurezza(percorso, testoOriginale, 'nutrizione');
                delete ricetta.nutrition;
                writeFileSync(percorso, JSON.stringify(ricetta, null, 2), 'utf-8');
            }
        }
        continue;
    }

    const nuovo = esito.nutrition;
    const vecchio = ricetta.nutrition;
    const uguale = vecchio
        && vecchio.kcal_per_100g === nuovo.kcal_per_100g
        && vecchio.macros?.carbs === nuovo.macros.carbs
        && vecchio.macros?.protein === nuovo.macros.protein
        && vecchio.macros?.fat === nuovo.macros.fat;

    if (uguale) { invariate++; continue; }

    scritte++;
    console.log(
        `  ~ ${categoria}/${slug}: ${vecchio ? `${vecchio.kcal_per_100g} → ` : ''}${nuovo.kcal_per_100g} kcal/100g` +
        ` (C${nuovo.macros.carbs} P${nuovo.macros.protein} G${nuovo.macros.fat}; resa ${esito.dettaglio.resa})`
    );
    if (!PROVA) {
        salvaCopiaSicurezza(percorso, testoOriginale, 'nutrizione');
        ricetta.nutrition = nuovo;
        writeFileSync(percorso, JSON.stringify(ricetta, null, 2), 'utf-8');
    }
}

console.log(`\n=== ${PROVA ? 'PROVA (niente scritto)' : 'FATTO'} ===`);
console.log(`Aggiornate: ${scritte} — invariate: ${invariate} — stime rimosse senza sostituto: ${rimosse}`);
if (rifiutate.length) {
    console.log(`\nRifiutate (${rifiutate.length}) — la lista di lavoro, non un fallimento:`);
    for (const r of rifiutate) {
        console.log(`  ✗ ${r.ricetta}`);
        for (const e of r.errori) console.log(`      ${e}`);
    }
}

if (!PROVA && (scritte > 0 || rimosse > 0)) {
    console.log('\n🔄 Aggiorno recipes.json (sync-cards)…');
    const { syncCards } = await import('../src/commands/sync-cards.js');
    await syncCards({});
    console.log('✅ recipes.json aggiornato');
}
