/* ============================================
   RICETTARIO TOOLS — Idratazione e farina totale
   ============================================ */

/**
 * Il calcolo di idratazione e farina totale dagli ingredienti, in un posto solo.
 *
 * PERCHÉ STA QUI
 * Lo stesso calcolo viveva in copie separate: lo schema dei tools
 * (recipe-schema.js), l'editor della dashboard (editor-validation.js) e, a
 * parole, i prompt. Le copie avevano regole diverse (l'editor non scomponeva il
 * lievito madre e saltava gli ingredienti uno per uno invece che per gruppo), e
 * a ottobre 2026 sbagliavano tutte e due sulla pizza con biga: 49% invece di 68%.
 * Da quando la pipeline SCRIVE questi numeri invece di limitarsi a controllarli,
 * una copia divergente diventerebbe un numero sbagliato pubblicato.
 *
 * Lo importano il server (Node) e il browser della dashboard, che lo riceve come
 * file statico sotto /condivisi: niente import, niente DOM, niente fs.
 *
 * LE TRE CONVENZIONI
 * - `contenuta`: l'acqua che i liquidi contengono davvero (latte 87%, uova 75%,
 *   tuorli 50%...). È quella che la pipeline scrive nelle ricette nuove, per
 *   decisione del 04/10/2026: rende confrontabili pane, pizza e lievitati ricchi.
 * - `intera`: i liquidi contati per intero, come fanno molti blog per la brioche.
 * - `pura`: solo l'acqua, più quella del lievito madre.
 * Le ricette pubblicate prima di quella decisione le usano tutte e tre, e il
 * controllo le accetta: vale la più vicina al valore dichiarato.
 */

/**
 * I liquidi e la frazione d'acqua che contengono. ORDINE IMPORTANTE: le parole
 * più specifiche prima ("Tuorli d'uovo" è tuorli, non uovo), e le varianti di
 * grafia vicine, perché descriviLiquidi le raggruppa così.
 */
export const LIQUIDI = [
    { kw: 'acqua', frazione: 1.0 },
    { kw: 'latte', frazione: 0.87 },
    { kw: 'tuorlo', frazione: 0.50 }, { kw: 'tuorli', frazione: 0.50 },
    { kw: 'albume', frazione: 0.90 }, { kw: 'albumi', frazione: 0.90 },
    { kw: 'uova', frazione: 0.75 }, { kw: 'uovo', frazione: 0.75 },
    // «Lievito di birra» contiene «birra» ma è lievito: senza l'eccezione i suoi
    // grammi entravano nell'idratazione come birra (+10 g di liquido sui
    // cornetti di ottobre 2026, due punti di idratazione). `salvo` come nelle
    // liste di scripts/build-recipes.js del sito.
    { kw: 'birra', frazione: 0.92, salvo: 'lievito di birra' },
    { kw: 'succo', frazione: 0.88 },
];

const FARINE = ['farina', 'semola', 'manitoba', 'tipo 0', 'tipo 00', 'tipo 1', 'tipo 2', 'integrale', 'nuvola', 'saccorosso'];
// «Zucchero Semolato» contiene «semola» ma non è farina.
const NON_FARINE = ['zucchero', 'sale', 'lievito', 'malto', 'miele'];
// Gruppi che non sono impasto. Finché il controllo accettava qualunque delle
// tre convenzioni bastavano doratura e finitura; contando l'acqua contenuta,
// ogni latte di una crema finisce nel conto. Prima di allungare l'elenco, la
// simulazione sulle 86 ricette dava 225% ai cartocci (la farcitura: un litro di
// latte e 160 g di tuorli) e 53% alla pizza romana (il succo di limone della
// salsa verde). «Emulsione» resta fuori di proposito: nei panettoni l'emulsione
// aromatica entra nell'impasto.
const FUORI_IMPASTO = [
    'doratura', 'decorazione', 'finitura', 'copertura', 'glassa', 'guarnizione', 'topping',
    'farcitura', 'farcia', 'ripieno', 'crema', 'condimento', 'salsa', 'salamoia', 'sciroppo', 'bagna',
];
const PREIMPASTI = ['biga', 'poolish', 'lievitino', 'prefermento', 'pre-fermento'];
// Prodotti finiti di un pre-impasto o di un lievito: non materie prime.
const ASSEMBLATI = [...PREIMPASTI, 'lievito madre', 'pasta madre'];
const LIEVITI_MADRE = ['lievito madre', 'pasta madre'];

/**
 * La voce composta di un pre-impasto si riconosce dall'INIZIO del nome
 * («Biga matura», «Biga di Saccorosso»), non dal contenerlo: «Acqua per biga» è
 * materia prima. E vince sulle parole chiave delle farine: «Biga di Saccorosso»
 * contiene «saccorosso», e veniva sommata come farina.
 */
const preimpastoDi = nome => PREIMPASTI.find(p => nome.startsWith(p));

/**
 * Il liquido di un ingrediente. La parola si cerca a INIZIO di parola:
 * «Fiordilatte» contiene «latte», e la mozzarella del condimento della pizza
 * STG veniva contata come 400 g di latte (106% di idratazione).
 */
const CERCA_LIQUIDI = LIQUIDI.map(l => ({ ...l, re: new RegExp(`\\b${l.kw}`) }));
const liquidoDi = nome => CERCA_LIQUIDI.find(l => l.re.test(nome) && !(l.salvo && nome.includes(l.salvo)));

/**
 * Farina totale e idratazione di una ricetta, nelle tre convenzioni.
 *
 * Si conta tutto il prodotto finale, pre-impasti compresi. La voce composta
 * («Biga matura» nell'impasto finale) non si somma, perché le sue materie prime
 * stanno già nel gruppo del pre-impasto. Un gruppo con tutte le voci escluse dal
 * totale dosi è una fase a parte (starter, bagnetto) e si salta, tranne quando
 * è il gruppo che produce una voce composta: lì le materie prime sono escluse
 * proprio perché la biga ricompare intera nell'impasto. Il lievito madre si
 * scompone in farina e acqua (idratazione dalla nota, altrimenti 50%).
 *
 * @returns {{ farina: number,
 *             acqua: { contenuta: number, pura: number, intera: number },
 *             idratazione: { contenuta: number|null, pura: number|null, intera: number|null } } | null}
 *   null quando non c'è farina. Le idratazioni sono null quando manca il
 *   liquido corrispondente.
 */
export function calcolaIdratazione(ricetta) {
    const gruppi = ricetta?.ingredientGroups || [];
    const composti = new Set(gruppi
        .flatMap(g => (g.items || []).map(i => preimpastoDi((i.name || '').toLowerCase())))
        .filter(Boolean));

    let farina = 0, contenuta = 0, pura = 0, intera = 0;
    for (const g of gruppi) {
        const gruppo = (g.group || '').toLowerCase();
        if (FUORI_IMPASTO.some(kw => gruppo.includes(kw))) continue;
        const items = g.items || [];
        const tuttiEsclusi = items.length > 0 && items.every(i => i.excludeFromTotal === true);
        const produceComposta = [...composti].some(p => gruppo.includes(p));
        if (tuttiEsclusi && !produceComposta) continue;

        for (const item of items) {
            const nome = (item.name || '').toLowerCase();
            const grammi = item.grams || 0;
            const eFarina = !NON_FARINE.some(kw => nome.includes(kw)) && FARINE.some(kw => nome.includes(kw));
            const liquido = liquidoDi(nome);
            const assemblato = Boolean(preimpastoDi(nome))
                || (!eFarina && !liquido && ASSEMBLATI.some(kw => nome.includes(kw)));

            if (assemblato) {
                if (item.excludeFromTotal) continue;
                if (LIEVITI_MADRE.some(kw => nome.includes(kw)) && item.grams > 0) {
                    const nota = (item.note || '').toLowerCase().match(/(\d+)\s*%\s*(?:di\s*)?idratazione/);
                    const idratazioneLievito = nota ? parseInt(nota[1], 10) / 100 : 0.5;
                    const suaFarina = item.grams / (1 + idratazioneLievito);
                    farina += suaFarina;
                    contenuta += item.grams - suaFarina;
                    pura += item.grams - suaFarina;
                }
                continue;
            }

            if (eFarina) farina += grammi;
            if (liquido) {
                contenuta += grammi * liquido.frazione;
                intera += grammi;
                if (liquido.frazione === 1) pura += grammi;
            }
        }
    }

    if (farina <= 0) return null;
    const percento = acqua => (acqua > 0 ? Math.round(acqua / farina * 100) : null);
    return {
        farina,
        acqua: { contenuta, pura, intera },
        idratazione: { contenuta: percento(contenuta), pura: percento(pura), intera: percento(intera) },
    };
}

/**
 * La convenzione più vicina a un'idratazione dichiarata. A parità di scarto
 * vince l'acqua contenuta, poi la sola acqua, poi i liquidi interi: l'ordine del
 * controllo da cui questo calcolo è stato estratto.
 *
 * @returns {{ convenzione: 'contenuta'|'pura'|'intera', valore: number, scarto: number } | null}
 */
export function convenzionePiuVicina(dichiarata, calcolo) {
    let migliore = null;
    for (const convenzione of ['contenuta', 'pura', 'intera']) {
        const valore = calcolo?.idratazione[convenzione];
        if (valore === null || valore === undefined) continue;
        const scarto = Math.abs(valore - dichiarata);
        if (!migliore || scarto < migliore.scarto) migliore = { convenzione, valore, scarto };
    }
    return migliore;
}

/**
 * I liquidi per i prompt, dalla stessa tabella del calcolo:
 * «acqua 100%, latte 87%, tuorlo/tuorli 50%, ...». Così il modello che genera e
 * quello che controlla contano l'acqua come la conta la pipeline.
 */
export function descriviLiquidi() {
    const voci = [];
    for (const l of LIQUIDI) {
        const ultima = voci[voci.length - 1];
        if (ultima && ultima.frazione === l.frazione) ultima.nomi.push(l.kw);
        else voci.push({ nomi: [l.kw], frazione: l.frazione });
    }
    return voci.map(v => `${v.nomi.join('/')} ${Math.round(v.frazione * 100)}%`).join(', ');
}

/** I gruppi che non entrano nel conto, per i prompt: la stessa lista del calcolo. */
export function descriviFuoriImpasto() {
    return FUORI_IMPASTO.join(', ');
}
