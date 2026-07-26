#!/usr/bin/env node
/**
 * CHECK:ENV — la deriva del .env non deve tornare
 *
 * `.env.example` promette di essere "completo e allineato al codice".
 * Una promessa scritta in un commento invecchia in silenzio: è già
 * successo (il file documentava 4 variabili su 11, e più tardi ne
 * mancava un'altra aggiunta all'OCR). Questo script la rende verificabile.
 *
 * Confronta tre elenchi:
 *   1. le `process.env.NOME` che il codice legge davvero;
 *   2. i nomi dichiarati in `.env.example`;
 *   3. i nomi citati nella tabella del README.
 * Se non coincidono, esce con codice 1 e dice quali mancano e dove.
 *
 * Uso:  npm run check:env
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUESTO_FILE = fileURLToPath(import.meta.url);
const RADICE = dirname(dirname(QUESTO_FILE));
const ESEMPIO = join(RADICE, '.env.example');
const README = join(RADICE, 'README.md');

// Cartelle che non descrivono il comportamento dello strumento.
const CARTELLE_SALTATE = new Set(['node_modules', '.git', 'public', 'data', '.vscode']);
const ESTENSIONI = ['.js', '.mjs', '.cjs', '.html'];

function* fileDaLeggere(cartella) {
    for (const voce of readdirSync(cartella)) {
        const percorso = join(cartella, voce);
        let info;
        try {
            info = statSync(percorso);
        } catch {
            continue; // link rotto o file sparito sotto i piedi: non è affar nostro
        }
        if (info.isDirectory()) {
            if (CARTELLE_SALTATE.has(voce)) continue;
            yield* fileDaLeggere(percorso);
        } else if (ESTENSIONI.some(e => voce.endsWith(e))) {
            yield percorso;
        }
    }
}

const lette = new Map();      // NOME -> ["file:riga", ...]
const accessiDinamici = [];   // process.env[...] : lo script non li vede

for (const file of fileDaLeggere(RADICE)) {
    if (file === QUESTO_FILE) continue; // i propri esempi non sono codice che legge l'ambiente
    const righe = readFileSync(file, 'utf8').split(/\r?\n/);
    righe.forEach((riga, i) => {
        for (const m of riga.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
            const dove = `${relative(RADICE, file).split(sep).join('/')}:${i + 1}`;
            if (!lette.has(m[1])) lette.set(m[1], []);
            lette.get(m[1]).push(dove);
        }
        if (/process\.env\s*\[/.test(riga)) {
            accessiDinamici.push(`${relative(RADICE, file).split(sep).join('/')}:${i + 1}`);
        }
    });
}

const testoEsempio = readFileSync(ESEMPIO, 'utf8');
const dichiarate = new Set(
    testoEsempio
        .split(/\r?\n/)
        .map(r => r.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/))
        .filter(Boolean)
        .map(m => m[1])
);

const testoReadme = readFileSync(README, 'utf8');

const problemi = [];

for (const [nome, posizioni] of [...lette].sort()) {
    if (!dichiarate.has(nome)) {
        problemi.push(
            `${nome}: letta dal codice (${posizioni[0]}) ma assente da .env.example`
        );
    }
    if (!testoReadme.includes(`\`${nome}\``)) {
        problemi.push(
            `${nome}: letta dal codice (${posizioni[0]}) ma assente dalla tabella del README`
        );
    }
}

for (const nome of [...dichiarate].sort()) {
    if (!lette.has(nome)) {
        problemi.push(
            `${nome}: dichiarata in .env.example ma nessun file la legge — ` +
            `o è stata rinominata nel codice, o va tolta di qui`
        );
    }
}

console.log(`Variabili lette dal codice: ${lette.size}`);
console.log(`Variabili dichiarate in .env.example: ${dichiarate.size}`);

if (accessiDinamici.length > 0) {
    console.log(
        `\nNota: ${accessiDinamici.length} accesso/i dinamico/i a process.env[...] ` +
        `(${accessiDinamici.join(', ')}). Questo controllo non li vede: verificali a mano.`
    );
}

if (problemi.length > 0) {
    console.error(`\n=== ${problemi.length} PROBLEMA/I ===`);
    for (const p of problemi) console.error(`  - ${p}`);
    console.error('\n.env.example dice di essere "completo e allineato al codice": rendilo vero.');
    process.exit(1);
}

console.log('\n=== TUTTO ALLINEATO === codice, .env.example e README dicono le stesse variabili.');
