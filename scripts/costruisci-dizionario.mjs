#!/usr/bin/env node
/**
 * COSTRUISCI-DIZIONARIO — il mapping curato ingrediente→FDC
 *
 * Scoglio n. 1 di USDA-TODO.md. Per ogni nome del censimento
 * (data/fdc-ingredienti.json, prodotto da estrai-ingredienti.mjs) trova
 * la voce USDA FoodData Central corrispondente e la fissa nel dizionario
 * data/fdc-dizionario.json insieme ai suoi numeri per 100 g.
 *
 * La divisione dei ruoli è quella promessa dal piano:
 *   - l'AI fa SOLO da traduttore (nome italiano → query FDC inglesi) e
 *     da selettore (quale dei candidati REALI è la voce giusta);
 *   - i numeri vengono sempre e solo dall'API USDA;
 *   - il codice valida: macro completi (kcal, carboidrati, proteine,
 *     grassi), coerenza Atwater (kcal ≈ 4·(C+P) + 9·G), somma macro
 *     plausibile. Ciò che non passa finisce marcato `daRivedere`, non
 *     scartato in silenzio.
 *
 * Il file prodotto è un ARTEFATTO CURATO: si corregge a mano (cambiare
 * un fdcId, marcare una voce, aggiungere un sinonimo) e si rilancia lo
 * script solo per i buchi — le voci già presenti non si toccano.
 *
 * Uso:
 *   node scripts/costruisci-dizionario.mjs              # riprende dai buchi
 *   node scripts/costruisci-dizionario.mjs --solo 10    # solo i primi N mancanti
 *   node scripts/costruisci-dizionario.mjs --rifai      # ricostruisce tutto
 *   node scripts/costruisci-dizionario.mjs --anche-da-rivedere  # ritenta i daRivedere
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callClaude, parseClaudeJson } from '../src/utils/api.js';
import { searchFoods, getFood, nutrientiPer100g, valoreNutriente } from '../src/fdc.js';

const RADICE = dirname(dirname(fileURLToPath(import.meta.url)));
const FILE_CENSIMENTO = join(RADICE, 'data', 'fdc-ingredienti.json');
const FILE_DIZIONARIO = join(RADICE, 'data', 'fdc-dizionario.json');

const DIM_BATCH = 24;           // ingredienti per giro traduttore→ricerca→selettore
const CANDIDATI_PER_NOME = 12;  // risultati FDC mostrati al selettore (dopo il merge)
const RISULTATI_PER_QUERY = 8;  // risultati chiesti a FDC per ogni query
const PAUSA_FDC_MS = 120;      // respiro tra chiamate FDC (1.000/ora di limite)

const argomenti = process.argv.slice(2);
const RIFAI = argomenti.includes('--rifai');
const ANCHE_DA_RIVEDERE = argomenti.includes('--anche-da-rivedere');
const SOLO = (() => {
    const i = argomenti.indexOf('--solo');
    return i >= 0 ? Number(argomenti[i + 1]) : Infinity;
})();

// ── Stato: censimento in ingresso, dizionario in uscita ──────────────

if (!existsSync(FILE_CENSIMENTO)) {
    console.error(`Manca ${FILE_CENSIMENTO}: lancia prima scripts/estrai-ingredienti.mjs`);
    process.exit(1);
}
const censimento = JSON.parse(readFileSync(FILE_CENSIMENTO, 'utf8'));

const dizionario = !RIFAI && existsSync(FILE_DIZIONARIO)
    ? JSON.parse(readFileSync(FILE_DIZIONARIO, 'utf8'))
    : { fonteNumeri: 'USDA FoodData Central (https://fdc.nal.usda.gov/)', voci: {} };

function daFare(voce) {
    const esistente = dizionario.voci[voce.chiave];
    if (!esistente) return true;
    if (ANCHE_DA_RIVEDERE && esistente.daRivedere) return true;
    return false;
}

// Il censimento è già ordinato per diffusione: se ci si ferma a metà,
// è fatta almeno la parte che pesa di più.
const coda = censimento.ingredienti.filter(daFare).slice(0, SOLO);
console.log(
    `Censimento: ${censimento.ingredienti.length} nomi — già a dizionario: ` +
    `${censimento.ingredienti.length - censimento.ingredienti.filter(daFare).length} — da fare ora: ${coda.length}`
);

// ── Fase 1: TRADUTTORE (AI) ──────────────────────────────────────────

const SYSTEM_TRADUTTORE = `Sei il traduttore di un dizionario ingredienti italiano → USDA FoodData Central (FDC).
FDC è un database americano: voci generiche in inglese tipo "Flour, wheat, all-purpose" (dataType Foundation e SR Legacy; niente prodotti di marca).

Per ogni ingrediente ricevi: chiave, nome italiano, note dalle ricette, categorie d'uso.
Rispondi SOLO con un array JSON, un oggetto per ingrediente:
{
  "chiave": "<ricopiata identica>",
  "tipo": "alimento" | "composto",
  "query": ["...", "..."]        // solo per tipo alimento: 1-3 query FDC in inglese, dalla più alla meno specifica
}

Regole:
- "composto" = preparazione interna alla ricetta elencata anche come voce a sé (biga, poolish, lievito madre/pasta madre e rinfreschi, "impasto della ricetta base"...). Non ha voce FDC: niente query.
- Le query FDC funzionano meglio corte e generiche ("wheat flour 00", "olive oil", "tomato raw"). Ignora i nomi di marca (Caputo, Saccorosso → "wheat flour 00").
- Preferisci l'ingrediente CRUDO/base, com'è comprato: i valori FDC sono sul crudo.
- Per prodotti molto italiani senza equivalente esatto, la cosa FDC più vicina e onesta (guanciale → "pork jowl"; colatura di alici → "fish sauce").
- Se il nome base rischia di annegare tra i suoi derivati (latte → formaggi e yogurt "whole milk"), rendi la query inequivocabile: "milk whole 3.25", "milk fluid".
- Niente testo fuori dall'array JSON.`;

async function traduci(batch) {
    const input = batch.map(v => ({
        chiave: v.chiave,
        nome: v.nome,
        note: v.note.slice(0, 2),
        categorie: v.categorie,
    }));
    const testo = await callClaude({
        system: SYSTEM_TRADUTTORE,
        messages: [{ role: 'user', content: JSON.stringify(input, null, 1) }],
        maxTokens: 8000,
    });
    const risposte = parseClaudeJson(testo);
    return new Map(risposte.map(r => [r.chiave, r]));
}

// ── Fase 2: RICERCA (API FDC, con cache per query) ───────────────────

const cacheRicerche = new Map();
const pausa = ms => new Promise(r => setTimeout(r, ms));

async function cercaConCache(query) {
    const q = query.toLowerCase().trim();
    if (!cacheRicerche.has(q)) {
        await pausa(PAUSA_FDC_MS);
        cacheRicerche.set(q, await searchFoods(q, { pageSize: RISULTATI_PER_QUERY }));
    }
    return cacheRicerche.get(q);
}

async function candidatiPer(queries) {
    // TUTTE le query, sempre: fermarsi alla prima che «porta qualcosa» è
    // già costato caro (per il burro, "unsalted butter" riempiva il
    // paniere di snack senza sale e la generica "butter" non partiva mai).
    const visti = new Set();
    const candidati = [];
    for (const query of queries || []) {
        for (const voce of await cercaConCache(query)) {
            if (visti.has(voce.fdcId)) continue;
            visti.add(voce.fdcId);
            candidati.push(voce);
        }
    }
    // Le voci coi 4 macro davanti: sono quelle che il selettore deve
    // preferire; le monche restano in coda come contesto.
    return [
        ...candidati.filter(c => completo(c.per100g)),
        ...candidati.filter(c => !completo(c.per100g)),
    ].slice(0, CANDIDATI_PER_NOME);
}

// ── Fase 3: SELETTORE (AI) ───────────────────────────────────────────

const SYSTEM_SELETTORE = `Scegli la voce USDA FoodData Central giusta per ciascun ingrediente italiano.
Ricevi per ingrediente: chiave, nome, note, e i candidati REALI restituiti dall'API (fdcId, descrizione, dataType, macro per 100 g dove presenti).

Rispondi SOLO con un array JSON, un oggetto per ingrediente:
{
  "chiave": "<ricopiata identica>",
  "fdcId": <numero o null>,
  "ripiegoFdcId": <numero o null>,   // seconda scelta se la prima si rivelasse inutilizzabile
  "confidenza": "alta" | "media" | "bassa",
  "motivo": "<max 15 parole, in italiano>"
}

Regole:
- Scegli SOLO tra i candidati elencati. Nessuno adatto → fdcId null e motivo.
- Preferisci la forma CRUDA/base che corrisponde all'uso in ricetta (i valori valgono sul crudo; la cottura si corregge altrove).
- Una voce coi 4 macro completi BATTE una voce monca anche se semanticamente più fine: sfumature come salato/non salato o il formato non giustificano una voce senza kcal. Scegli una voce monca solo se nessuna completa è accettabile, e dillo nel motivo.
- Diffida dei falsi amici (per "olive oil" la voce "Mayonnaise with olive oil" NON va).
- Un candidato nutrizionalmente onesto anche se non identico (aceto di vino rosso per aceto di vino bianco, burro salato per burro) BATTE il null: scegli e spiega. fdcId null solo se OGNI candidato darebbe numeri sostanzialmente sbagliati (categoria alimentare diversa).
- confidenza bassa = corrispondenza approssimata o dubbio reale: verrà riletta da un umano.
- Niente testo fuori dall'array JSON.`;

async function seleziona(batch) {
    const input = batch.map(v => ({
        chiave: v.chiave,
        nome: v.nome,
        note: v.note.slice(0, 2),
        candidati: v.candidati.map(c => ({
            fdcId: c.fdcId,
            descrizione: c.description,
            dataType: c.dataType,
            per100g: c.per100g,
        })),
    }));
    const testo = await callClaude({
        system: SYSTEM_SELETTORE,
        messages: [{ role: 'user', content: JSON.stringify(input, null, 1) }],
        maxTokens: 8000,
    });
    const risposte = parseClaudeJson(testo);
    return new Map(risposte.map(r => [r.chiave, r]));
}

// ── Fase 4: VALIDAZIONE (codice, numeri alla mano) ───────────────────

const completo = n => n && [n.kcal, n.carbs, n.protein, n.fat].every(x => typeof x === 'number');

/** Macro completi per un fdcId: prima dai risultati di ricerca, poi dal dettaglio. */
async function macroCompleti(fdcId, candidati) {
    const daRicerca = candidati.find(c => c.fdcId === fdcId)?.per100g;
    if (completo(daRicerca)) return daRicerca;
    await pausa(PAUSA_FDC_MS);
    const n = nutrientiPer100g(await getFood(fdcId));
    return completo(n) ? n : null;
}

/** Controlli di plausibilità: tornano un motivo di sospetto, o null se tutto torna. */
function sospetti(n) {
    const somma = n.carbs + n.protein + n.fat;
    if (somma > 105) return `macro oltre i 100 g (${somma.toFixed(0)} g su 100)`;
    if (n.kcal >= 30) {
        const atwater = 4 * (n.carbs + n.protein) + 9 * n.fat;
        const scarto = Math.abs(n.kcal - atwater) / n.kcal;
        if (scarto > 0.3) return `kcal (${n.kcal}) lontane dal calcolo Atwater (${atwater.toFixed(0)})`;
    }
    return null;
}

// ── Il giro completo, un batch alla volta ────────────────────────────

function salva() {
    dizionario.aggiornato = new Date().toISOString();
    writeFileSync(FILE_DIZIONARIO, JSON.stringify(dizionario, null, 2) + '\n');
}

let fatti = 0, mappati = 0, composti = 0, daRivedereTot = 0;

for (let da = 0; da < coda.length; da += DIM_BATCH) {
    const batch = coda.slice(da, da + DIM_BATCH);
    console.log(`\n— Batch ${Math.floor(da / DIM_BATCH) + 1}/${Math.ceil(coda.length / DIM_BATCH)} (${batch.length} nomi) —`);

    const traduzioni = await traduci(batch);

    // Ricerca FDC per gli alimenti (i composti saltano la trafila)
    for (const voce of batch) {
        const t = traduzioni.get(voce.chiave);
        voce.traduzione = t;
        voce.candidati = t && t.tipo === 'alimento' ? await candidatiPer(t.query) : [];
    }

    const alimenti = batch.filter(v => v.traduzione?.tipo === 'alimento' && v.candidati.length > 0);
    const scelte = alimenti.length > 0 ? await seleziona(alimenti) : new Map();

    for (const voce of batch) {
        const base = {
            nome: voce.nome,
            grafie: voce.grafie,
            ricette: voce.ricette,
            grammiTotali: voce.grammiTotali,
        };
        const t = voce.traduzione;
        let entrata;

        if (!t) {
            entrata = { ...base, fdcId: null, daRivedere: true, motivo: 'il traduttore non ha risposto per questa chiave' };
        } else if (t.tipo === 'composto') {
            entrata = { ...base, fdcId: null, nonMappabile: 'voce composta — da espandere nei componenti', daRivedere: false };
            composti++;
        } else if (voce.candidati.length === 0) {
            entrata = { ...base, fdcId: null, daRivedere: true, motivo: `nessun risultato FDC per: ${(t.query || []).join(' / ')}` };
        } else {
            const s = scelte.get(voce.chiave);
            if (!s || !s.fdcId) {
                entrata = { ...base, fdcId: null, daRivedere: true, motivo: s?.motivo || 'il selettore non ha indicato una voce' };
            } else {
                // La scelta va difesa coi numeri: macro completi, poi plausibilità.
                // E dev'essere DAVVERO uno dei candidati: un id inventato dal
                // selettore punterebbe a un alimento a caso con numeri veri —
                // l'errore peggiore, perché non si vede (successo col burro).
                const ammessi = new Set(voce.candidati.map(c => c.fdcId));
                let scelta = s, primaScelta = null;
                let fdcId = ammessi.has(s.fdcId) ? s.fdcId : null;
                let numeri = fdcId ? await macroCompleti(fdcId, voce.candidati) : null;
                if (!numeri && s.ripiegoFdcId && ammessi.has(s.ripiegoFdcId)) {
                    fdcId = s.ripiegoFdcId;
                    numeri = await macroCompleti(fdcId, voce.candidati);
                }
                if (!numeri) {
                    // Entrambe le scelte erano voci monche: ripescaggio tra i
                    // soli candidati completi già in mano (successo col burro:
                    // la Foundation "unsalted" è monca, la SR Legacy no).
                    const completi = voce.candidati.filter(c => completo(c.per100g));
                    if (completi.length > 0) {
                        const riscelta = (await seleziona([{ ...voce, candidati: completi }])).get(voce.chiave);
                        if (riscelta?.fdcId) {
                            primaScelta = s.fdcId;
                            scelta = riscelta;
                            fdcId = riscelta.fdcId;
                            numeri = await macroCompleti(fdcId, completi);
                        }
                    }
                }
                if (!numeri) {
                    const perche = ammessi.has(s.fdcId)
                        ? 'senza i 4 macro (anche al dettaglio)'
                        : 'non era tra i candidati (id inventato dal selettore)';
                    entrata = { ...base, fdcId: null, daRivedere: true, motivo: `scelta ${s.fdcId} ${perche}` };
                } else {
                    let allarme = sospetti(numeri);
                    if (allarme && allarme.startsWith('kcal')) {
                        // Due categorie stanno larghe dal calcolo Atwater grezzo
                        // pur essendo giuste: le voci ricche di fibra (pepe,
                        // spezie — la fibra quasi non dà calorie) e gli alcolici
                        // (vino, rum, estratto di vaniglia — l'etanolo dà
                        // 7 kcal/g e non è un macro). Prima di marcare, riprova
                        // col dettaglio: fibra 291, alcol 221.
                        await pausa(PAUSA_FDC_MS);
                        const dettaglio = await getFood(fdcId);
                        const fibra = valoreNutriente(dettaglio, ['291']) ?? 0;
                        const alcol = valoreNutriente(dettaglio, ['221']) ?? 0;
                        if (fibra > 0 || alcol > 0) {
                            const corretto = 4 * (numeri.carbs - fibra + numeri.protein)
                                + 9 * numeri.fat + 2 * fibra + 7 * alcol;
                            if (Math.abs(numeri.kcal - corretto) / numeri.kcal <= 0.3) allarme = null;
                        }
                    }
                    const descr = voce.candidati.find(c => c.fdcId === fdcId);
                    entrata = {
                        ...base,
                        fdcId,
                        fdc: descr?.description,
                        dataType: descr?.dataType,
                        per100g: numeri,
                        confidenza: scelta.confidenza,
                        motivo: scelta.motivo,
                        ...(primaScelta ? { primaScelta } : {}),
                        daRivedere: scelta.confidenza === 'bassa' || Boolean(allarme),
                        ...(allarme ? { allarme } : {}),
                    };
                    mappati++;
                }
            }
        }

        if (entrata.daRivedere) daRivedereTot++;
        dizionario.voci[voce.chiave] = entrata;
        fatti++;
    }

    salva();
    console.log(`  fatti ${fatti}/${coda.length} — mappati ${mappati}, composti ${composti}, da rivedere ${daRivedereTot}`);
}

// ── Rendiconto finale ────────────────────────────────────────────────

const voci = Object.entries(dizionario.voci);
console.log(`\n=== DIZIONARIO: ${voci.length} voci totali ===`);
console.log(`Mappate su FDC: ${voci.filter(([, v]) => v.fdcId).length}`);
console.log(`Composte (da espandere): ${voci.filter(([, v]) => v.nonMappabile).length}`);
const daControllare = voci.filter(([, v]) => v.daRivedere);
console.log(`Da rivedere a mano: ${daControllare.length}`);
for (const [chiave, v] of daControllare) {
    console.log(`  - ${v.nome}  [${chiave}]  → ${v.fdcId ?? 'nessuna voce'}${v.allarme ? ` ⚠ ${v.allarme}` : ''}${v.motivo ? ` (${v.motivo})` : ''}`);
}
console.log(`\nScritto: ${FILE_DIZIONARIO}`);
