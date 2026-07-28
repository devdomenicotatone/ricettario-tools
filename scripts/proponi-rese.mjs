#!/usr/bin/env node
/**
 * PROPONI-RESE — le proposte di calcolo per le ricette bloccate
 *
 * Per ogni ricetta che src/nutrizione.js rifiuta (resa non dichiarata,
 * item excludeFromTotal ambigui) l'AI legge titolo, passaggi e cottura
 * e PROPONE le dichiarazioni mancanti, citando l'evidenza testuale:
 *
 *   - resa (peso finito / peso crudo): 1.0 esatto per le preparazioni
 *     a crudo (fisica, non stima); per cotture e riduzioni SOLO se i
 *     passaggi danno appigli («far ridurre della metà», tempi e fuoco),
 *     sempre con la citazione;
 *   - fuoriProdotto / dentroProdotto per gli item ambigui (ciò che si
 *     filtra, si scarta o serve solo alla lavorazione ↔ ciò che finisce
 *     nel prodotto).
 *
 * OGNI proposta nasce con daRivedere: true in data/fdc-calcolo.json e
 * NON è definitiva finché un umano non la conferma: qui l'AI legge e
 * cita, non decide. Le ricette già dichiarate non si toccano
 * (--anche-da-rivedere per rifare le proposte non confermate).
 *
 * Uso:  node scripts/proponi-rese.mjs [--solo N] [--anche-da-rivedere]
 */

import 'dotenv/config';
import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callClaude, parseClaudeJson } from '../src/utils/api.js';
import { RICETTARIO_DIR } from '../src/constants.js';
import { caricaDatiCalcolo, calcolaNutrizione, chiaveDi } from '../src/nutrizione.js';

const RADICE = dirname(dirname(fileURLToPath(import.meta.url)));
const FILE_CALCOLO = join(RADICE, 'data', 'fdc-calcolo.json');
const DIM_BATCH = 6;

const argomenti = process.argv.slice(2);
const ANCHE_DA_RIVEDERE = argomenti.includes('--anche-da-rivedere');
const SOLO = (() => {
    const i = argomenti.indexOf('--solo');
    return i >= 0 ? Number(argomenti[i + 1]) : Infinity;
})();

const { dizionario, calcolo } = caricaDatiCalcolo();

// ── Le bloccate: si chiede al motore, non si indovina ────────────────

const bloccate = [];
for (const percorso of globSync(join(RICETTARIO_DIR, 'ricette', '*', '*.json')).sort()) {
    const pezzi = percorso.split(sep);
    const categoria = pezzi[pezzi.length - 2];
    const slug = pezzi[pezzi.length - 1].replace(/\.json$/, '');
    const chiave = `${categoria}/${slug}`;

    const gia = calcolo.ricette[chiave];
    if (gia && !(ANCHE_DA_RIVEDERE && gia.daRivedere)) continue;

    const ricetta = JSON.parse(readFileSync(percorso, 'utf8'));
    const esito = calcolaNutrizione(ricetta, { categoria, slug, dizionario, calcolo });
    if (!esito.errori) continue;

    const ambigui = (ricetta.ingredientGroups || []).flatMap(g => (g.items || [])
        .filter(it => it.excludeFromTotal)
        .map(it => ({ nome: it.name, grams: it.grams, note: it.note || '', gruppo: g.group })));

    bloccate.push({
        chiave, categoria,
        titolo: ricetta.title,
        descrizione: (ricetta.description || '').slice(0, 300),
        ingredienti: (ricetta.ingredientGroups || []).flatMap(g => (g.items || []).map(it => `${it.name} ${it.grams}g`)),
        passaggi: (ricetta.steps || []).map(s => typeof s === 'string' ? s : (s.description || s.text || JSON.stringify(s)).slice(0, 400)),
        cottura: ricetta.baking || null,
        itemAmbigui: ambigui,
        errori: esito.errori,
        mancaResa: esito.errori.some(e => e.includes('resa non dichiarata')),
        // Per validare le classificazioni proposte: QUALUNQUE ingrediente
        // può finire fuoriProdotto (i solidi filtrati via di rado sono
        // marcati excludeFromTotal — v. olio al cavolo viola).
        tuttiNomi: (ricetta.ingredientGroups || []).flatMap(g => (g.items || []).map(it => it.name)),
    });
}

const coda = bloccate.slice(0, SOLO);
console.log(`Ricette bloccate dal motore: ${bloccate.length} — proposte da preparare ora: ${coda.length}`);

// ── Il lettore di ricette ────────────────────────────────────────────

const SYSTEM = `Prepari le DICHIARAZIONI di calcolo nutrizionale per ricette italiane, leggendo i passaggi. Non stimi mai a occhio: ogni numero deve avere l'evidenza nel testo o nella fisica della preparazione.

Per ogni ricetta ricevi: chiave, titolo, descrizione, passaggi, dati di cottura, eventuali itemAmbigui (ingredienti marcati excludeFromTotal da classificare) e gli errori del motore di calcolo.

Rispondi SOLO con un array JSON, un oggetto per ricetta:
{
  "chiave": "<ricopiata identica>",
  "resa": <numero, peso finito / peso crudo degli ingredienti che contano>,
  "confidenza": "alta" | "media" | "bassa",
  "evidenza": "<citazione testuale dai passaggi, o la regola fisica usata; max 25 parole>",
  "fuoriProdotto": ["nome item", ...],
  "dentroProdotto": ["nome item", ...],
  "olioAssorbito": { "grammi": <numero>, "ingrediente": "<olio usato, preso dai passaggi>" },  // SOLO per fritture in olio profondo
  "grassoColato": { "frazione": <numero 0-1> }   // SOLO per carni su griglia con raccogligocce che si scarta
}

Regole per la resa:
- Preparazione a crudo / assemblaggio senza cottura (pesti, salse fredde, burri composti, marinature) → resa 1.0 ESATTO, evidenza "nessuna cottura". Confidenza alta.
- Cottura con evidenza testuale ("fate ridurre della metà" → il liquido si dimezza; "sobbollire X minuti scoperto"; "in forno a Y° per Z minuti") → traduci l'evidenza in resa e CITALA. Ricorda che la riduzione dichiarata di solito riguarda la parte liquida, non il totale.
- Fumetti/brodi: la resa è (acqua rimasta dopo riduzione ed evaporazione) / peso totale iniziale; i solidi filtrati via vanno in fuoriProdotto.
- FRITTURA in olio profondo: l'olio del bagno non è tra gli ingredienti pesati ma entra nel prodotto — dichiara "olioAssorbito" con l'olio nominato nei passaggi. Letteratura: 8-15% del peso del pezzo fritto per impasti lievitati, verso il basso se si scola su carta. La resa resta il calo del solo crudo: i grammi d'olio si sommano dopo, non spalmarli nella resa.
- CARNI su griglia con raccogligocce (vaschetta, leccarda) che si scarta: parte del grasso fonde e cola via — dichiara "grassoColato": { "frazione": <0-1 del grasso totale> } citando il passaggio del raccogligocce. NON dichiararlo per i brasati e le cotture in umido: lì il grasso fuso resta nel fondo che si serve.
- Nessuna evidenza e nessuna fisica ovvia → resa più plausibile con confidenza "bassa" e di' nell'evidenza cosa manca. Verrà rivista da un umano.

Regole per le classificazioni (gli itemAmbigui vanno classificati TUTTI; ma fuoriProdotto può citare QUALUNQUE ingrediente della lista, anche non ambiguo, se i passaggi dicono che si scarta):
- fuoriProdotto: si scarta, si filtra via, serve solo alla lavorazione o alla creazione una tantum (spolveri sul piano, acqua di bagnetto, fasi "solo per la creazione", solidi filtrati dagli infusi, verdure del brodo eliminate al colino).
- dentroProdotto: finisce nel prodotto anche se il sito lo esclude dal totale mostrato (sale/malto/lievito dell'impasto, olio assorbito in teglia, il cuore di pasta madre nel rinfresco).
- Componenti di preimpasti già agganciati dal motore per bilancio di massa NON arrivano qui: se un item ambiguo ti sembra un componente, classificalo comunque (dentroProdotto se entra nel prodotto tramite il composto).

Niente testo fuori dall'array JSON.`;

function salva() {
    calcolo.aggiornato = new Date().toISOString();
    writeFileSync(FILE_CALCOLO, JSON.stringify(calcolo, null, 2) + '\n');
}

let proposte = 0;
for (let da = 0; da < coda.length; da += DIM_BATCH) {
    const batch = coda.slice(da, da + DIM_BATCH);
    console.log(`\n— Batch ${Math.floor(da / DIM_BATCH) + 1}/${Math.ceil(coda.length / DIM_BATCH)}: ${batch.map(b => b.chiave).join(', ')}`);

    const testo = await callClaude({
        system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(batch, null, 1) }],
        maxTokens: 8000,
    });
    const risposte = new Map(parseClaudeJson(testo).map(r => [r.chiave, r]));

    for (const ricetta of batch) {
        const r = risposte.get(ricetta.chiave);
        if (!r || (ricetta.mancaResa && (typeof r.resa !== 'number' || r.resa <= 0 || r.resa > 1.2))) {
            console.error(`  ✗ ${ricetta.chiave}: proposta assente o resa implausibile (${r?.resa})`);
            continue;
        }
        // Le classificazioni devono citare ingredienti veri della ricetta
        // (fuoriProdotto vale per qualunque item: ciò che si filtra o si
        // scarta non è quasi mai marcato excludeFromTotal).
        const nomiVeri = new Set(ricetta.tuttiNomi.map(chiaveDi));
        const fuori = (r.fuoriProdotto || []).filter(n => nomiVeri.has(chiaveDi(n)));
        const dentro = (r.dentroProdotto || []).filter(n => nomiVeri.has(chiaveDi(n)));

        // Olio di frittura: si accetta solo se l'olio proposto è a
        // dizionario — se manca, la voce va aggiunta a mano PRIMA (come
        // per l'olio di arachidi dei cartocci) e la proposta rifatta.
        let olioAssorbito = null;
        if (r.olioAssorbito) {
            const { grammi, ingrediente } = r.olioAssorbito;
            const voce = dizionario.voci[chiaveDi(ingrediente || '')];
            if (typeof grammi === 'number' && grammi > 0 && voce) {
                olioAssorbito = { grammi, chiave: chiaveDi(ingrediente), fonte: 'proposto dai passaggi (frittura in olio profondo)' };
            } else {
                console.error(`  ✗ ${ricetta.chiave}: olioAssorbito proposto ma "${ingrediente}" non è a dizionario — aggiungere la voce e rilanciare`);
            }
        }

        calcolo.ricette[ricetta.chiave] = {
            // La resa per-ricetta solo dove manca davvero: dove il default
            // di famiglia basta, dichiararla la ombreggerebbe per sempre.
            ...(ricetta.mancaResa ? {
                resa: r.resa,
                fonte: 'proposta dall\'evidenza testuale della ricetta',
            } : {}),
            evidenza: r.evidenza,
            confidenza: r.confidenza,
            ...(fuori.length ? { fuoriProdotto: fuori } : {}),
            ...(dentro.length ? { dentroProdotto: dentro } : {}),
            ...(olioAssorbito ? { olioAssorbito } : {}),
            ...(typeof r.grassoColato?.frazione === 'number' && r.grassoColato.frazione > 0 && r.grassoColato.frazione <= 1
                ? { grassoColato: { frazione: r.grassoColato.frazione, fonte: 'proposto dai passaggi (raccogligocce scartato)' } }
                : {}),
            daRivedere: true,
        };
        proposte++;
    }
    salva();
}

console.log(`\nProposte scritte: ${proposte} (tutte daRivedere: true) → ${FILE_CALCOLO}`);
console.log('Prossimo passo: node scripts/confronta-nutrizione.mjs per vedere l\'effetto, poi revisione umana.');
