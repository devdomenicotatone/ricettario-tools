#!/usr/bin/env node
/**
 * AGGIORNA-NUMERI — i numeri del dizionario ridiscendono da USDA
 *
 * Il dizionario (data/fdc-dizionario.json) è un artefatto curato: quando
 * una voce ha l'fdcId sbagliato la si corregge A MANO nel JSON — ma i
 * numeri non si scrivono mai a mano. Questo script li rilegge dall'API
 * per ogni voce con fdcId (o solo per le chiavi passate), aggiorna
 * per100g, descrizione e dataType, e marca daRivedere ciò che al
 * dettaglio risulta monco.
 *
 * Flusso di cura tipico:
 *   1. apri data/fdc-dizionario.json, correggi "fdcId" della voce;
 *   2. node scripts/aggiorna-numeri.mjs "chiave della voce"
 *   3. la voce ha numeri, descrizione e dataType della nuova scelta.
 *
 * Voci con "numeriManuali": true vengono saltate SEMPRE: sono le
 * eccezioni dichiarate (es. carbone vegetale E153, inerte: zero fissati
 * a mano) e nessun refresh le deve toccare.
 *
 * Uso:
 *   node scripts/aggiorna-numeri.mjs                # tutte le voci con fdcId
 *   node scripts/aggiorna-numeri.mjs "burro" "latte intero"   # solo queste
 */

import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFood, nutrientiPer100g } from '../src/fdc.js';

const RADICE = dirname(dirname(fileURLToPath(import.meta.url)));
const FILE_DIZIONARIO = join(RADICE, 'data', 'fdc-dizionario.json');
const PAUSA_FDC_MS = 120;
const pausa = ms => new Promise(r => setTimeout(r, ms));

const dizionario = JSON.parse(readFileSync(FILE_DIZIONARIO, 'utf8'));
const chiesteAMano = process.argv.slice(2);

const daFare = Object.entries(dizionario.voci).filter(([chiave, v]) => {
    if (chiesteAMano.length > 0 && !chiesteAMano.includes(chiave)) return false;
    if (v.numeriManuali) return false;
    return Boolean(v.fdcId);
});

for (const chiave of chiesteAMano) {
    if (!dizionario.voci[chiave]) console.error(`Chiave non nel dizionario: "${chiave}"`);
    else if (dizionario.voci[chiave].numeriManuali) console.log(`"${chiave}": numeriManuali, non si tocca.`);
    else if (!dizionario.voci[chiave].fdcId) console.error(`"${chiave}" non ha fdcId: niente da aggiornare.`);
}

console.log(`Voci da riallineare a USDA: ${daFare.length}`);
const completo = n => n && [n.kcal, n.carbs, n.protein, n.fat].every(x => typeof x === 'number');
let cambiate = 0, monche = 0;

for (const [chiave, voce] of daFare) {
    await pausa(PAUSA_FDC_MS);
    let cibo;
    try {
        cibo = await getFood(voce.fdcId);
    } catch (e) {
        console.error(`  ${chiave} [${voce.fdcId}]: ${e.message}`);
        voce.daRivedere = true;
        voce.allarme = `fdcId irraggiungibile: ${e.message.slice(0, 80)}`;
        continue;
    }

    const numeri = nutrientiPer100g(cibo);
    const prima = JSON.stringify({ d: voce.fdc, n: voce.per100g });
    voce.fdc = cibo.description;
    voce.dataType = cibo.dataType;
    voce.per100g = numeri;
    if (!completo(numeri)) {
        voce.daRivedere = true;
        voce.allarme = 'al dettaglio mancano macro: voce monca, cambiare fdcId';
        monche++;
    }
    if (JSON.stringify({ d: voce.fdc, n: voce.per100g }) !== prima) {
        cambiate++;
        console.log(`  ~ ${voce.nome} [${voce.fdcId}] → ${cibo.description}`);
    }
}

// ── Voci derivate: aritmetica dichiarata su numeri USDA già in casa ──
// (es. pasta madre solida = 2/3 farina + 1/3 acqua). Si calcolano DOPO
// il refresh, così pescano i numeri appena riallineati.
let derivate = 0;
for (const [chiave, voce] of Object.entries(dizionario.voci)) {
    if (!Array.isArray(voce.derivataDa)) continue;
    if (chiesteAMano.length > 0 && !chiesteAMano.includes(chiave)) continue;
    const per100g = { kcal: 0, carbs: 0, protein: 0, fat: 0 };
    const pezzi = [];
    let rotta = false;
    for (const { chiave: rif, quota } of voce.derivataDa) {
        const base = dizionario.voci[rif];
        if (!base || !completo(base.per100g)) {
            console.error(`  ${chiave}: riferimento "${rif}" assente o senza macro — derivata non calcolabile`);
            voce.daRivedere = true;
            rotta = true;
            break;
        }
        for (const campo of Object.keys(per100g)) per100g[campo] += quota * base.per100g[campo];
        pezzi.push(`${Math.round(quota * 100)}% ${base.fdc}`);
    }
    if (rotta) continue;
    for (const campo of Object.keys(per100g)) per100g[campo] = Math.round(per100g[campo] * 100) / 100;
    voce.per100g = per100g;
    voce.fdc = `derivata: ${pezzi.join(' + ')}`;
    derivate++;
}

dizionario.aggiornato = new Date().toISOString();
writeFileSync(FILE_DIZIONARIO, JSON.stringify(dizionario, null, 2) + '\n');
console.log(`\nAggiornate: ${cambiate} — derivate ricalcolate: ${derivate} — monche (marcate daRivedere): ${monche}`);
console.log(`Scritto: ${FILE_DIZIONARIO}`);
