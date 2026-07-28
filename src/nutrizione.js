/**
 * NUTRIZIONE — il calcolo che sostituisce la stima (USDA-TODO.md)
 *
 * Dati in ingresso: una ricetta del sito (ingredientGroups), il
 * dizionario ingrediente→FDC (data/fdc-dizionario.json) e le regole di
 * calcolo dichiarate (data/fdc-calcolo.json: rese e classificazione
 * degli item ambigui). Nessuna stima a runtime: tutto ciò che serve o
 * è un numero USDA, o è dichiarato in un file versionato, o il calcolo
 * SI RIFIUTA e dice cosa manca. Il rifiuto parlante è una feature: è
 * l'elenco di lavoro della curatela.
 *
 * I tre problemi che questo modulo risolve, coi loro attrezzi:
 *
 * 1. DOPPI CONTEGGI (bighe, poolish, maionese di base). Le ricette
 *    elencano il preimpasto due volte: come gruppo di componenti e come
 *    voce composta nell'impasto finale. Il flag `excludeFromTotal` NON
 *    è affidabile per decidere (convenzione invertita tra ricette:
 *    v. pizza-napoletana vs pizza-contemporanea-canotto). Qui la voce
 *    composta si aggancia al suo gruppo di produzione per NOME (token
 *    condivisi: «Biga matura» ↔ «Per la Biga») e BILANCIO DI MASSA;
 *    se il gruppo produce più di quanto la ricetta usa (maionese:
 *    fatti 308 g, usati 250), i componenti contano in proporzione.
 *
 * 2. ITEM FUORI PRODOTTO (semola per spolverare, olio per la teglia,
 *    acqua del bagnetto). Distinguerli dai gemelli che invece nel
 *    prodotto ci finiscono è un giudizio: si dichiara una volta per
 *    ricetta in fdc-calcolo.json (`fuoriProdotto` / `dentroProdotto`),
 *    e ciò che resta ambiguo blocca il calcolo finché non è deciso.
 *
 * 3. CALO PESO (scoglio 2). I numeri FDC valgono sul crudo; il sito
 *    dichiara «per 100 g di prodotto finito». La resa (peso finito /
 *    peso crudo) viene da fdc-calcolo.json: per ricetta se dichiarata,
 *    altrimenti dal default di famiglia (solo famiglie da forno, dove
 *    la fisica è omogenea). Mai dal modello.
 *
 *    Due proprietà della resa da non dimenticare (costate un bug a testa):
 *    - si riferisce al peso degli ingredienti CONTATI: ciò che è
 *      fuoriProdotto non fa parte né del crudo né del finito;
 *    - modella solo perdite che NON portano via nutrienti in proporzione
 *      (acqua che evapora, liquidi che si riducono). Una perdita
 *      proporzionale (olio rimasto nel filtro, impasto rimasto in
 *      ciotola) porta via i suoi nutrienti con sé e NON cambia i valori
 *      per 100 g: lì la resa resta 1.0.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * La chiave di normalizzazione dei nomi ingrediente: LA STESSA del
 * censimento e del dizionario (estrai-ingredienti la importa da qui).
 * Minuscole, spazi collassati, apostrofi tipografici raddrizzati —
 * e niente di più: «tipo 0» e «tipo 00» devono restare distinte.
 */
export function chiaveDi(nome) {
    return nome
        .normalize('NFC')
        .replaceAll('’', "'")
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

export function caricaDatiCalcolo() {
    return {
        dizionario: JSON.parse(readFileSync(join(RADICE, 'data', 'fdc-dizionario.json'), 'utf8')),
        calcolo: JSON.parse(readFileSync(join(RADICE, 'data', 'fdc-calcolo.json'), 'utf8')),
    };
}

// Token significativi di un nome, per l'aggancio composta↔gruppo.
const PAROLE_VUOTE = new Set([
    'di', 'del', 'della', 'dello', 'dei', 'delle', 'da', 'per', 'la', 'il',
    'lo', 'le', 'i', 'gli', 'un', 'una', 'e', 'o', 'con', 'al', 'alla',
    'base', 'matura', 'maturo', 'finale', 'fase', 'standard', 'primaria', 'solo',
]);
function tokenDi(testo) {
    return new Set(
        testo.toLowerCase()
            .replace(/\(.*?\)/g, ' ')
            .replace(/[^a-zàèéìòù0-9]+/g, ' ')
            .split(' ')
            .filter(t => t.length > 2 && !PAROLE_VUOTE.has(t))
    );
}
function condividonoToken(a, b) {
    for (const t of a) if (b.has(t)) return true;
    return false;
}

const completo = n => n && [n.kcal, n.carbs, n.protein, n.fat].every(x => typeof x === 'number');

/**
 * Calcola la nutrizione «per 100 g di prodotto finito» di una ricetta.
 *
 * @param ricetta   il JSON della ricetta del sito (serve ingredientGroups)
 * @param contesto  { categoria: cartella es. 'pane', slug, dizionario, calcolo }
 * @returns { nutrition, dettaglio } oppure { errori: [...] } se qualcosa
 *          non è dichiarato: il chiamante NON deve pubblicare numeri parziali.
 */
export function calcolaNutrizione(ricetta, { categoria, slug, dizionario, calcolo }) {
    const errori = [];
    const avvisi = [];
    const chiaveRicetta = `${categoria}/${slug}`;
    const regole = calcolo.ricette?.[chiaveRicetta] || {};
    const fuori = new Set((regole.fuoriProdotto || []).map(chiaveDi));
    const dentro = new Set((regole.dentroProdotto || []).map(chiaveDi));

    // ── Item piatti, con voce di dizionario ──────────────────────────
    const gruppi = (ricetta.ingredientGroups || []).map((g, i) => ({
        indice: i,
        nome: g.group || `gruppo ${i + 1}`,
        token: tokenDi(g.group || ''),
        items: (g.items || []).map(it => ({
            nome: it.name,
            chiave: chiaveDi(it.name),
            grams: it.grams,
            escl: Boolean(it.excludeFromTotal),
            voce: dizionario.voci[chiaveDi(it.name)],
            gruppo: i,
            scala: 1,       // ridotta se il gruppo produce più di quanto si usa
            conta: true,    // deciso qui sotto
            ruolo: 'ingrediente',
        })),
    }));
    const tutti = gruppi.flatMap(g => g.items);

    for (const item of tutti) {
        if (!item.voce) errori.push(`«${item.nome}» non è a dizionario (rilanciare il censimento e il dizionario?)`);
        else if (typeof item.grams !== 'number') errori.push(`«${item.nome}» senza grammatura numerica`);
    }
    if (errori.length) return { errori, avvisi };

    // ── 1. Voci composte → il gruppo che le produce ──────────────────
    for (const item of tutti) {
        if (!item.voce.nonMappabile) continue;
        const tokenItem = tokenDi(item.nome);
        const candidati = gruppi.filter(g =>
            g.indice !== item.gruppo &&
            condividonoToken(tokenItem, g.token) &&
            g.items.every(i => !i.voce.nonMappabile)
        );
        if (candidati.length !== 1) {
            errori.push(
                `«${item.nome}» è una voce composta ma il suo gruppo di produzione ` +
                `non si trova (candidati per nome: ${candidati.length}) — dichiarare o espandere a mano`
            );
            continue;
        }
        const gruppo = candidati[0];
        const prodotto = gruppo.items.reduce((s, i) => s + i.grams, 0);
        const rapporto = item.grams / prodotto;
        if (rapporto > 1.1) {
            errori.push(
                `«${item.nome}» (${item.grams} g) supera ciò che «${gruppo.nome}» produce ` +
                `(${prodotto} g): bilancio di massa impossibile`
            );
            continue;
        }
        item.conta = false;
        item.ruolo = `composta → espansa in «${gruppo.nome}»`;
        for (const comp of gruppo.items) {
            comp.scala = Math.min(rapporto, 1);
            comp.conta = true;
            comp.ruolo = `componente di «${item.nome}»`;
        }
        if (rapporto < 0.9) {
            avvisi.push(
                `«${gruppo.nome}» produce ${prodotto} g ma la ricetta ne usa ${item.grams}: ` +
                `componenti contati al ${Math.round(rapporto * 100)}%`
            );
        }
    }

    // ── 2. Fuori prodotto dichiarato, ed ESCL rimasti ambigui ────────
    for (const item of tutti) {
        if (!item.conta) continue;
        if (fuori.has(item.chiave)) {
            item.conta = false;
            item.ruolo = 'fuori prodotto (dichiarato)';
            continue;
        }
        if (item.escl && item.ruolo === 'ingrediente' && !dentro.has(item.chiave)) {
            errori.push(
                `«${item.nome}» è excludeFromTotal ma nessuna dichiarazione lo classifica: ` +
                `metterlo in fuoriProdotto o dentroProdotto di ${chiaveRicetta} in fdc-calcolo.json`
            );
        }
    }
    if (errori.length) return { errori, avvisi };

    // ── 3. Somma pesata sul crudo ────────────────────────────────────
    let pesoCrudo = 0;
    let alcolTotale = 0; // g di etanolo in ingresso (dal 221 USDA, via dizionario)
    const totali = { kcal: 0, carbs: 0, protein: 0, fat: 0 };
    const contributi = [];
    for (const item of tutti) {
        if (!item.conta) continue;
        const numeri = item.voce.per100g;
        if (!completo(numeri)) {
            errori.push(`«${item.nome}» è a dizionario ma senza i 4 macro (daRivedere?)`);
            continue;
        }
        const grammi = item.grams * item.scala;
        pesoCrudo += grammi;
        alcolTotale += grammi * (item.voce.alcolPer100g || 0) / 100;
        for (const campo of Object.keys(totali)) totali[campo] += grammi * numeri[campo] / 100;
        contributi.push({ nome: item.nome, grammi, kcal: Math.round(grammi * numeri.kcal / 100), ruolo: item.ruolo });
    }
    if (errori.length) return { errori, avvisi };
    if (pesoCrudo <= 0) return { errori: ['nessun ingrediente conta: peso crudo zero'], avvisi };

    // ── 4. La resa dichiarata, mai stimata ───────────────────────────
    let resa, fonteResa;
    if (typeof regole.resa === 'number') {
        if (regole.daRivedere) {
            // Una proposta non confermata non è una dichiarazione: numeri
            // costruiti su di essa non si pubblicano.
            return {
                errori: [`la resa di ${chiaveRicetta} è una proposta non ancora confermata (daRivedere in fdc-calcolo.json)`],
                avvisi,
            };
        }
        resa = regole.resa;
        fonteResa = `dichiarata per la ricetta${regole.fonte ? ` — ${regole.fonte}` : ''}`;
    } else if (typeof calcolo.famiglie?.[categoria]?.resa === 'number') {
        resa = calcolo.famiglie[categoria].resa;
        fonteResa = `default di famiglia «${categoria}»${calcolo.famiglie[categoria].fonte ? ` — ${calcolo.famiglie[categoria].fonte}` : ''}`;
    } else {
        return {
            errori: [
                `resa non dichiarata per ${chiaveRicetta} e la famiglia «${categoria}» non ha default: ` +
                `aggiungerla in fdc-calcolo.json (scripts/proponi-rese.mjs prepara le proposte)`,
            ],
            avvisi,
        };
    }

    // ── 4b. Frittura: l'olio assorbito, dichiarato (modello v2) ──────
    // L'olio del bagno di frittura non sta tra gli ingredienti pesati:
    // entra nel prodotto DURANTE la cottura. Chi frigge lo dichiara in
    // fdc-calcolo.json come { grammi, chiave }: i grammi si sommano al
    // peso finito (arrivano dopo il calo del crudo, non lo subiscono) e
    // i nutrienti alla somma — dalla voce di dizionario citata, come
    // tutto il resto. La resa continua a modellare solo il crudo.
    let olioAssorbito = null;
    if (regole.olioAssorbito) {
        const { grammi, chiave } = regole.olioAssorbito;
        const voceOlio = dizionario.voci[chiaveDi(chiave || '')];
        if (typeof grammi !== 'number' || grammi <= 0 || !voceOlio || !completo(voceOlio.per100g)) {
            return {
                errori: [
                    `olioAssorbito di ${chiaveRicetta} non utilizzabile: servono grammi > 0 e una ` +
                    `chiave di dizionario coi 4 macro (ricevuto: ${JSON.stringify(regole.olioAssorbito)})`,
                ],
                avvisi,
            };
        }
        olioAssorbito = { grammi, voce: voceOlio };
        for (const campo of Object.keys(totali)) totali[campo] += grammi * voceOlio.per100g[campo] / 100;
        contributi.push({
            nome: `${voceOlio.nome} — assorbito in frittura (dichiarato)`,
            grammi,
            kcal: Math.round(grammi * voceOlio.per100g.kcal / 100),
            ruolo: 'olio di frittura',
        });
    }

    // ── 4c. Alcol evaporato in cottura (modello v2) ──────────────────
    // L'etanolo bolle a 78°C e in cottura se ne va quasi tutto — MA
    // quanto, dipende dal tempo: la tabella USDA di ritenzione dice 85%
    // residuo se aggiunto a fine cottura, ~40% dopo 15 min di sobbollore,
    // ~25% dopo un'ora, ~5% dopo due ore e mezza. Quindi anche qui si
    // DICHIARA per ricetta (alcolResiduo.frazione, con la tabella come
    // fonte) e si scorporano le kcal dell'alcol evaporato: 6.93 kcal/g,
    // il fattore Atwater che USDA stessa usa. Solo kcal: l'etanolo non è
    // un macro, e la sua MASSA evaporata sta già dentro la resa.
    const KCAL_PER_G_ALCOL = 6.93;
    if (regole.alcolResiduo) {
        const { frazione } = regole.alcolResiduo;
        if (typeof frazione !== 'number' || frazione < 0 || frazione > 1) {
            return {
                errori: [`alcolResiduo di ${chiaveRicetta} non utilizzabile: frazione deve stare tra 0 e 1 (ricevuto: ${JSON.stringify(regole.alcolResiduo)})`],
                avvisi,
            };
        }
        if (alcolTotale === 0) {
            avvisi.push('alcolResiduo dichiarato ma nessun ingrediente porta alcol: dichiarazione inutile');
        } else {
            const kcalPerse = alcolTotale * (1 - frazione) * KCAL_PER_G_ALCOL;
            totali.kcal -= kcalPerse;
            contributi.push({
                nome: `Alcol evaporato in cottura (residuo ${Math.round(frazione * 100)}%, dichiarato)`,
                grammi: -Math.round(alcolTotale * (1 - frazione) * 10) / 10,
                kcal: -Math.round(kcalPerse),
                ruolo: 'alcol evaporato',
            });
        }
    } else if (alcolTotale >= 2 && resa < 1) {
        // Niente blocco: i numeri restano interi (com'erano prima del
        // modello), ma la cottura c'è e l'alcol pure — che si veda.
        avvisi.push(
            `la ricetta porta ${alcolTotale.toFixed(1)} g di alcol e cuoce (resa ${resa}): ` +
            `valutare alcolResiduo in fdc-calcolo.json — senza, le sue kcal restano contate per intero`
        );
    }

    // ── 4d. Grasso colato in cottura (modello v2) ────────────────────
    // Nelle cotture su griglia con raccogligocce (pulled pork, ribs) una
    // parte del grasso fonde, cola e SI SCARTA: porta via i suoi grammi
    // di grassi e le sue kcal (9/g, fattore Atwater). Si dichiara per
    // ricetta come frazione del grasso totale, con l'evidenza dei
    // passaggi — e attenzione ai brasati: lì il grasso fuso finisce nel
    // fondo che si serve, e NON va dichiarato (v. brisket).
    // La massa colata, come per l'alcol, sta già dentro la resa.
    const KCAL_PER_G_GRASSO = 9;
    if (regole.grassoColato) {
        const { frazione } = regole.grassoColato;
        if (typeof frazione !== 'number' || frazione < 0 || frazione > 1) {
            return {
                errori: [`grassoColato di ${chiaveRicetta} non utilizzabile: frazione deve stare tra 0 e 1 (ricevuto: ${JSON.stringify(regole.grassoColato)})`],
                avvisi,
            };
        }
        const grassiPersi = totali.fat * frazione;
        if (grassiPersi > 0) {
            totali.fat -= grassiPersi;
            totali.kcal -= grassiPersi * KCAL_PER_G_GRASSO;
            contributi.push({
                nome: `Grasso colato in cottura (${Math.round(frazione * 100)}% del grasso, dichiarato)`,
                grammi: -Math.round(grassiPersi * 10) / 10,
                kcal: -Math.round(grassiPersi * KCAL_PER_G_GRASSO),
                ruolo: 'grasso colato',
            });
        }
    }

    const pesoFinito = pesoCrudo * resa + (olioAssorbito?.grammi || 0);
    const per = campo => totali[campo] / pesoFinito * 100;

    return {
        nutrition: {
            kcal_per_100g: Math.round(per('kcal')),
            macros: {
                carbs: Math.round(per('carbs')),
                protein: Math.round(per('protein')),
                fat: Math.round(per('fat')),
            },
        },
        dettaglio: {
            pesoCrudo: Math.round(pesoCrudo),
            resa,
            fonteResa,
            ...(olioAssorbito ? { olioAssorbitoGrammi: olioAssorbito.grammi } : {}),
            pesoFinito: Math.round(pesoFinito),
            contributi: contributi.sort((a, b) => b.kcal - a.kcal),
            avvisi,
        },
    };
}
