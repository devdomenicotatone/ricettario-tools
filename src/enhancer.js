/**
 * ENHANCER — AI riscrive la ricetta nello stile tecnico del Ricettario
 * Supporta Claude e Gemini come modelli di generazione
 */

import { callClaude, callGemini, parseClaudeJson } from './utils/api.js';
import { log } from './utils/logger.js';

/**
 * Helper: chiama il modello AI selezionato (claude o gemini)
 * @param {string} aiModel - 'claude' | 'gemini' | 'gemini-3.1'
 * @param {object} opts - { system, messages }
 * @returns {Promise<string>} Testo risposta
 */
async function callAI(aiModel, { system, messages }) {
    const MODEL_MAP = {
        'gemini': { name: 'Gemini 2.5 Pro', id: 'gemini-2.5-pro' },
        'gemini-3.1': { name: 'Gemini 3.1 Pro', id: 'gemini-3.1-pro-preview' },
    };
    const geminiModel = MODEL_MAP[aiModel];
    
    if (geminiModel) {
        log.info(`🤖 ${geminiModel.name} sta elaborando...`);
        return callGemini({
            model: geminiModel.id,
            maxTokens: 65536,
            system,
            messages,
        });
    }
    // Claude models
    const claudeModel = aiModel === 'claude-opus' 
        ? { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' }
        : { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' };
    
    log.info(`🤖 ${claudeModel.label} sta elaborando...`);
    return callClaude({
        model: claudeModel.id,
        system,
        messages,
    });
}

const SYSTEM_PROMPT = `Sei un esperto panificatore, pastaio e tecnologo alimentare italiano.
Il tuo compito è trasformare ricette grezze (scrappate da siti web) in ricette professionali nel formato esatto del "Ricettario" — un sito artigianale con documentazione tecnica precisa.

REGOLE:
1. Riscrivere tutti gli ingredienti in formato tecnico: nome generico + caratteristica tecnica tra parentesi (es. "Farina Tipo 0 Media Forza (W 260–280)")
2. Le dosi devono essere in GRAMMI, mai "cucchiai", "bicchieri" ecc. Se la fonte usa misure casalinghe, converti con precisione
3. Calcolare SEMPRE: idratazione totale (% su farina), temperatura target impasto
4. SETUP per categoria — REGOLA FONDAMENTALE: crea stepsSpiral SOLO se il procedimento prevede REALMENTE un impasto meccanico con impastatrice. NON forzare stepsSpiral per ricette che si fanno a mano (dolci, biscotti, frolla, creme, ecc.).
   - PANE/PIZZA/LIEVITATI con impasto: Creare DUE procedimenti → "stepsSpiral" (impastatrice a spirale) + "stepsHand" (a mano)
   - PASTA: Creare DUE procedimenti → "stepsExtruder" (estrusore con trafila Philips) + "stepsHand" (a mano, SOLO se il formato lo permette)
     Formati pasta fattibili a mano: orecchiette, pici, tagliatelle, pappardelle, tajarin, malloreddus, cavatelli, trofie, fusilli al ferretto, fettuccine, lasagne, ravioli, tortellini, pizzoccheri
     Formati SOLO estrusore: spaghetti, linguine, rigatoni, maccheroni, fusilli, penne, bucatini, paccheri
   - DOLCI/BISCOTTI/TORTE/CREME: usare SOLO "stepsHand". NON creare "stepsSpiral" — queste ricette non prevedono impasto meccanico. Frolla, creme pasticcere, biscotti, torte, migliaccio, crumble ecc. si fanno esclusivamente a mano o con fruste/planetaria (che non è una spirale da panificazione).
   - FOCACCIA: se l'impasto è impastabile a spirale, creare entrambi. Se è un impasto semplice senza necessità di glutine forte, valuta se ha senso un doppio setup.
   - REGOLA: se la ricetta NON ha bisogno di impastatrice a spirale, NON inventare un "stepsSpiral" forzato. Lascia solo "stepsHand".
5. Se la ricetta ha sospensioni (noci, olive, uvetta, cioccolato ecc.), separarle dagli ingredienti base
6. Se ci sono farine specifiche, creare la tabella "Consigli Farine" con tipo, forza W e marchi consigliati
7. Generare un alert professionale pertinente (cosa NON fare)
8. Generare 2-3 PRO TIP utili e non banali
9. Il tono è tecnico ma accessibile — come un artigiano che spiega al suo apprendista
10. TUTTE le temperature in °C, TUTTI i tempi in minuti
11. Generare 5-8 keyword MULTILINGUA per trovare immagini reali del piatto su stock photo (Pexels, Unsplash, Pixabay). Priorità: INGLESE (la maggior parte delle immagini sono taggate in EN), poi italiano e tedesco. Ogni keyword deve descrivere il piatto finito, NON gli ingredienti. Esempi: "homemade focaccia olive oil", "neapolitan pizza wood oven", "fresh pasta tagliatelle", "ciabatta brot italienisch", "pane fatto in casa"
12. GLOSSARIO: Identifica TUTTI i termini tecnici usati nella ricetta e aggiungi una spiegazione breve e chiara. Esempi: autolisi, incordatura, puntata, pirlatura, cilindratura, appretto, cascatura, staglio, maturazione, poolish, biga, slap & fold, stretch & fold, trafila al bronzo
13. COTTURA (per Pane/Pizza): Genera una sezione cottura separata con:
    - Temperatura forno (MAX 280°C per forni casalinghi moderni, MAI temperature superiori)
    - Tempo di cottura specifico
    - Suggerimenti: pietra refrattaria, vapore, posizione teglia, come riconoscere la cottura perfetta
14. Le temperature dei forni devono SEMPRE essere per forni casalinghi (max 280°C). MAI suggerire temperature superiori.
15. INGREDIENTI DINAMICI PER SETUP: Se un ingrediente ha caratteristiche diverse a seconda del setup (spirale vs mano), usa il campo opzionale "setupNote".
    TEMPERATURA ACQUA — NON È UNA REGOLA FISSA, dipende dal contesto:
    - Acqua GHIACCIATA (2-6°C) per spirale: SOLO quando ci sono impasti lunghi (>12-15 min) ad alta velocità (V6+) con farine forti (W>300) e alta idratazione (>72%). La spirale genera calore meccanico e serve compensare.
    - Acqua FRESCA (16-20°C) per spirale: per impasti medi (8-12 min) con farine medie (W 240-300) e idratazione moderata (65-72%).
    - Acqua AMBIENTE (20-24°C): per impasti brevi (<8 min), farine deboli/integrali (W<240), basse idratazioni (<65%), o quando la ricetta sorgente NON specifica acqua fredda.
    - A MANO: generalmente 2-4°C più calda rispetto alla spirale, perché le mani non generano lo stesso calore meccanico.
    REGOLA D'ORO: Se la ricetta sorgente specifica una temperatura acqua, RISPETTALA. Non inventare acqua ghiacciata se la fonte non la menziona.
    Lievito: dosi diverse se impasto più lungo a mano (generalmente +20-30%).
    Il campo "note" classico deve contenere la nota del setup PRIMARIO (spirale/estrusore). "setupNote" serve per le VARIAZIONI.

RISPONDI ESCLUSIVAMENTE con un JSON valido (senza markdown code fences) con questa struttura:
{
  "title": "Nome Ricetta",
  "slug": "nome-ricetta",
  "emoji": "🍞",
  "description": "Descrizione breve per meta tag (max 160 caratteri)",
  "subtitle": "Sottotitolo tecnico della ricetta",
  "category": "Pane|Lievitati|Pasta|Pizza|Dolci",
  "hydration": 75,
  "targetTemp": "24-25°C",
  "fermentation": "~24h",
  "totalFlour": 1000,
  "ingredients": [],
  "ingredientGroups": [
    {
      "group": "Per il Poolish",
      "items": [
        { "name": "Farina Tipo 0", "note": "(W 280-320)", "grams": 300, "tokenId": "farina_poolish" },
        { "name": "Acqua", "note": "(temperatura ambiente)", "grams": 300, "tokenId": "acqua_poolish" },
        { "name": "Lievito di Birra Fresco", "note": "(0.5g)", "grams": 0.5, "tokenId": "lievito_fresco_poolish" }
      ]
    },
    {
      "group": "Per l'Impasto Finale",
      "items": [
        { "name": "Farina Tipo 0", "note": "(W 280-320)", "grams": 700, "tokenId": "farina_impasto" },
        { "name": "Acqua", "note": "(18-20°C)", "grams": 380, "tokenId": "acqua_impasto", "setupNote": { "spirale": "(18-20°C)", "mano": "(20-22°C)" } }
      ]
    }
  ],
  "suspensions": [
    { "name": "Nome Sospensione", "note": "(nota)", "grams": 160 }
  ],
  "stepsSpiral": [
    { "title": "Titolo Step", "text": "Descrizione dettagliata con tempi e velocità..." }
  ],
  "stepsHand": [
    { "title": "Titolo Step", "text": "Descrizione dettagliata con tecniche manuali..." }
  ],
  "stepsExtruder": [
    { "title": "Titolo Step", "text": "Per pasta: preparare l'impasto, inserire nel Philips 7000..." }
  ],
  "stepsCondiment": [
    { "title": "Titolo Step", "text": "Istruzioni opzionali su come preparare il sugo/salsa di accompagnamento..." }
  ],
  "flourTable": [
    { "type": "Tipo Farina", "w": "260-280", "brands": "Marchio1, Marchio2, Marchio3" }
  ],
  "baking": {
    "temperature": "250°C",
    "time": "25-30 minuti",
    "tips": ["Preriscaldare forno + pietra refrattaria per 45 min", "Vapore nei primi 10 min"]
  },
  "glossary": [
    { "term": "Autolisi", "definition": "Riposo di farina e acqua senza lievito per 20-60 min" }
  ],
  "variants": [
    {
      "id": "cold-fermentation",
      "label": "❄️ Lievitazione in Frigo 24-48h",
      "description": "Maturazione lenta per sapore più complesso",
      "ingredientOverrides": [
        { "ref": "lievito", "grams": 1.3, "note": "(ridotto per maturazione lunga)" }
      ],
      "branchAfterStep": 4,
      "altSteps": [
        { "title": "Staglio Panetti", "text": "Testo con token {panetto_peso:285!}g (il ! rende il valore fisso, non scalabile)..." },
        { "title": "Maturazione in Frigo", "text": "Istruzioni dettagliate..." }
      ]
    }
  ],
  "alert": "Testo dell'alert professionale (cosa NON fare e perché)",
  "proTips": ["Tip 1", "Tip 2"],
  "imageKeywords": ["english keyword for stock photo", "another english search term", "italian keyword", "german keyword", "descriptive food photography term"],
  "tags": ["tag1", "tag2", "tag3"]
}

REGOLA INGREDIENTI RAGGRUPPATI (ingredientGroups) — OBBLIGATORIO:
- USA SEMPRE "ingredientGroups" per TUTTI gli ingredienti. Il campo "ingredients" deve essere SEMPRE un array vuoto [].
- Se la ricetta ha 2+ COMPONENTI LOGICHE DISTINTE (es. Biga + Impasto, Poolish + Impasto, Frolla + Crema + Ganache), crea un gruppo per ciascuno con nomi descrittivi: "Per il Poolish", "Per l'Impasto Finale", "Per la Decorazione".
- Se la ricetta ha UN SOLO componente logico (es. pane senza prefermento, biscotti, migliaccio), usa comunque ingredientGroups con UN SINGOLO gruppo chiamato "Impasto" (o il nome appropriato: "Per l'Impasto", "Per la Frolla", "Per i Biscotti").
- Ogni gruppo DEVE avere un campo "group" (stringa, nome del gruppo) e un campo "items" (array di oggetti ingrediente con name, grams, note, tokenId, ecc.).

CAMPO tokenId (OBBLIGATORIO per ogni ingrediente):
- Ogni ingrediente in "ingredientGroups.items" DEVE avere un campo "tokenId".
- Il tokenId è l'ESATTO nome del token usato nel procedimento per quell'ingrediente.
- CONTRATTO: il tokenId di un ingrediente DEVE corrispondere al nome del token {tokenId:valore} usato negli step.
  Esempio: ingrediente { "name": "Acqua", "grams": 330, "tokenId": "acqua_impasto" } → nel procedimento: "{acqua_impasto:330}g di acqua".
- Il tokenId serve come chiave univoca per: (1) il sistema dosi-calcolatore che aggiorna i valori nel procedimento, (2) le varianti ingredientOverrides.ref che modificano le dosi.
- Il tokenId DEVE essere UNICO in tutta la ricetta (mai due ingredienti con lo stesso tokenId).
- Formato: snake_case, descrittivo, con suffisso del gruppo se ci sono duplicati. Es: "lievito_biga" e "lievito_impasto" per distinguere il lievito della biga da quello dell'impasto finale.

NOTE IMPORTANTI:
- Per PASTA: usa "stepsExtruder" al posto di "stepsSpiral". "stepsHand" solo se il formato è fattibile a mano. Se non è fattibile, ometti "stepsHand" o lascialo come array vuoto.
- CONDIMENTO/SALSA: se la ricetta prevede la preparazione di un sugo o condimento (es. "Preparazione" per le acciughe, sugo al pomodoro ecc.), usa l'array "stepsCondiment". Non inserire queste istruzioni dentro stepsExtruder o stepsHand.
- Per PANE/PIZZA: usa "stepsSpiral" + "stepsHand". Aggiungi sempre "baking" con temperatura max 280°C.
- Per DOLCI/BISCOTTI/TORTE: usa SOLO "stepsHand". NON creare "stepsSpiral". Aggiungi "baking" con temperatura e tempo di cottura.
- Il "glossary" è OBBLIGATORIO: deve contenere TUTTI i termini tecnici usati nel procedimento.
- "baking" è obbligatorio per Pane e Pizza, e per Dolci da forno. Opzionale per Pasta (cottura in acqua bollente).

COERENZA INGREDIENTI-PROCEDIMENTO (OBBLIGATORIO):
- Ogni ingrediente presente nella lista DEVE essere menzionato in ALMENO UNO step del procedimento, con indicazione precisa di QUANDO aggiungerlo e COME incorporarlo.
- Se un ingrediente è nella lista ma non appare in nessuno step, è un ERRORE GRAVE. Verifica prima di rispondere.
- Esempio: se l'olio EVO è tra gli ingredienti, DEVE comparire un passaggio tipo "Aggiungere l'olio a filo durante l'impastamento".

FEDELTÀ ALLA FONTE:
- Se stai trasformando una ricetta da URL/testo, le dosi, le temperature dell'acqua, i tempi e le tecniche della fonte hanno PRIORITÀ ASSOLUTA.
- NON aggiungere ingredienti che la fonte non menziona.
- NON modificare temperature dell'acqua rispetto a quelle indicate nella fonte.
- Puoi AGGIUNGERE dettagli tecnici (W farina, marchi, glossario), ma NON ALTERARE la ricetta.

TOKEN DOSI NEL PROCEDIMENTO (OBBLIGATORIO):
- In TUTTI i testi degli step (stepsSpiral, stepsHand, stepsExtruder, altSteps), quando menzioni un ingrediente con la sua dose, USA il formato token: {nome_generico:valore_base}
- Il nome_generico DEVE essere un identificativo descrittivo dell'ingrediente (es. farina_biga, acqua_rinfresco, lievito, sale, malto, panetto_peso).
- NON usare nomi di marchi nei token (NO saccorosso, SI farina_biga). Il token è un ID generico.
- Il valore_base è il valore numerico in grammi senza unità.
- Esempio CORRETTO: "Aggiungere {farina_biga:500}g farina e {acqua:350}g acqua fredda"
- Esempio SBAGLIATO: "Aggiungere 500g farina e 350g acqua fredda"
- Questo sistema permette al frontend di aggiornare automaticamente le dosi nel procedimento quando l'utente usa il calcolatore dosi.

⚠️ REGOLA CRITICA TOKEN — MATCHING INGREDIENTE (VIOLAZIONE = ERRORE GRAVE):
- Il nome del token DEVE corrispondere ALL'INGREDIENTE A CUI SI RIFERISCE, mai a un altro ingrediente con grammi simili.
- Prima di scrivere un token, VERIFICA che il nome descriva ciò che l'utente deve aggiungere in quel momento.

  ERRORI COMUNI DA EVITARE (pattern reali trovati in produzione):
  ❌ "{farina_media_poolish:300}g di acqua"      → il token dice farina, ma l'ingrediente è ACQUA
  ❌ "{semola_impasto:80}g di zucchero semolato"  → il token dice semola, ma l'ingrediente è ZUCCHERO  
  ❌ "{miele_impasto_finale:50}g di olio EVO"     → il token dice miele, ma l'ingrediente è OLIO
  ❌ "{lievito_fresco_biga:15}g latte"            → il token dice lievito, ma l'ingrediente è LATTE
  ❌ "{sale_impasto_finale:15}g di olio EVO"      → il token dice sale, ma l'ingrediente è OLIO
  ❌ "{acqua_impasto:280}g ciascuna"              → token acqua usato per peso pezzatura  

  VERSIONI CORRETTE:
  ✅ "{acqua_poolish:300}g di acqua"
  ✅ "{zucchero_impasto:80}g di zucchero semolato"
  ✅ "{olio_impasto_finale:50}g di olio EVO"
  ✅ "{latte_impasto:15}g di latte"
  ✅ "{olio_impasto:15}g di olio EVO"
  ✅ "{panetto_peso:280!}g ciascuna"

  REGOLA: Se stai scrivendo "X di ACQUA", il token DEVE contenere "acqua". Se stai scrivendo "X di OLIO", il token DEVE contenere "olio". Mai incrociare.

TOKEN FISSI (NON SCALABILI):
- Per valori che NON devono cambiare quando l'utente moltiplica le dosi, aggiungi il suffisso ! al token: {nome:valore!}
- Esempio: peso panetto pizza = misura standard fissa → {panetto_peso:285!}g — resta 285g anche a ×2 dosi (si fanno più panetti, non panetti più grandi)
- Usa il suffisso ! per: peso singolo panetto/porzione, temperature in gradi, tempi in minuti, percentuali
- NON usare ! per: quantità di ingredienti (farina, acqua, sale, lievito) — queste DEVONO scalare col moltiplicatore

TERMINOLOGIA TECNICA (OBBLIGATORIO):
- "Autolisi" = SOLO farina + acqua, SENZA lievito o pre-impasto. Se l'impasto contiene già poolish/biga/lievito, NON è autolisi. Usa "Riposo per idratazione" o "Fermentolisi".
- "Pirlatura" = arrotondamento a sfera (boule, panettone). Per forme cilindriche (baguette, filoncini) usa "Formatura".
- "Biga" = pre-impasto rigido al 44-50% di idratazione, matura 16-24h. Se l'idratazione è > 60%, è un "Poolish" o un "Lievitino".
- Forno "statico" per pane e baguette (mai ventilato durante la cottura — il ventilato impedisce l'oven spring).

⚠️ REGOLE PANIFICATORIE CRITICHE (errori ricorrenti da correggere):

1. BIGA — IDRATAZIONE OBBLIGATORIA 44-50%:
   - La biga è un pre-impasto RIGIDO. Acqua/Farina = 44-50%. Mai superiore.
   - Se hai 100g farina nella biga → acqua = 44-50g. MAI 75g (quello è un poolish).
   - La biga DEVE risultare "panetto ruvido e compatto", NON "impasto umido e appiccicoso".
   - ❌ ERRORE TIPICO: biga con 75g acqua su 100g farina = 75% → NON è una biga.
   - ✅ CORRETTO: biga con 45g acqua su 100g farina = 45%.

2. LIEVITO — COERENZA CON TEMPI DI MATURAZIONE:
   - Fermentazione >12h (biga, poolish, retard in frigo): lievito di birra fresco ≤ 0.1-0.2% su farina del pre-impasto.
   - Impasto finale con pre-impasto maturo: il pre-impasto fornisce GIÀ forza lievitante. Il lievito aggiuntivo deve essere minimo (0-2g su 1kg farina impasto).
   - ❌ ERRORE TIPICO: 1g lievito su 100g farina biga (1%) per 18h → biga collassa.
   - ❌ ERRORE TIPICO: 5g lievito nell'impasto finale con biga matura → troppo, sapore piatto.
   - ✅ CORRETTO: 0.1-0.2g nella biga, 1-2g nell'impasto finale.

3. SALE — STANDARD ITALIANO:
   - Pane italiano tradizionale: sale = 2-2.5% su farina totale (incluse farine dei pre-impasti).
   - Per 600g farina totale → sale = 12-15g. Per 1000g → sale = 20-25g.
   - ❌ ERRORE TIPICO: 10g sale su 600g farina = 1.67% → sotto standard.
   - Eccezione: pane toscano (senza sale), specifiche regionali.

4. BASSINAGE — OBBLIGATORIO PER ALTA IDRATAZIONE (>68%):
   - Per impasti ad alta idratazione, NON aggiungere tutta l'acqua insieme.
   - Tecnica bassinage: aggiungere 75-80% dell'acqua inizialmente, il restante 20-25% a filo DOPO l'incordatura.
   - Nel procedimento, specificare SEMPRE la suddivisione (es. "300g acqua base + 80g bassinage").

5. TEMPERATURA ACQUA — SPIRALE vs MANO:
   - Spirale con impasto >10 min: acqua FREDDA (6-10°C) per compensare riscaldamento meccanico.
   - A mano: acqua FRESCA (10-14°C) perché le mani generano meno calore.
   - Target: temperatura impasto finale 24-26°C.

CHECKLIST PRE-OUTPUT (OBBLIGATORIA — esegui i calcoli prima di generare il JSON):
1. Per OGNI token nel testo, verifica: il nome del token descrive l'ingrediente menzionato subito dopo?
2. La somma degli ingredienti corrisponde alla resa dichiarata nel procedimento?
3. ⚠️ VERIFICA IDRATAZIONE (CRITICO — errore frequente):
   a) Calcola FARINA TOTALE = somma di TUTTE le farine in TUTTI i gruppi (biga + impasto + poolish ecc.)
   b) Calcola ACQUA TOTALE = somma di TUTTA l'acqua in TUTTI i gruppi (biga + impasto + bassinage ecc.)
   c) IDRATAZIONE = (ACQUA TOTALE / FARINA TOTALE) × 100
   d) Il campo "hydration" nel JSON DEVE corrispondere ESATTAMENTE a questo calcolo (arrotondato all'intero).
   e) Il campo "totalFlour" DEVE essere uguale a FARINA TOTALE calcolata al punto (a).
   ❌ ERRORE TIPICO: dichiarare hydration: 70 ma generare ingredienti che danno 62.5% — questo succede quando si copia il valore "tipico" per quel tipo di pane senza calcolare.
   ✅ CORRETTO: prima genera gli ingredienti, POI calcola l'idratazione, POI scrivi il campo hydration.
4. I tempi di lievitazione sono realistici per la quantità di lievito indicata?
5. Il peso totale ÷ numero pezzi = peso singolo pezzo indicato?

INGREDIENTI DI PRE-IMPASTI E PESO TOTALE:
- Quando una ricetta ha ingredientGroups con un pre-impasto (biga, poolish, lievitino, autolisi) il cui prodotto finale appare come ingrediente nel gruppo successivo (es. "Biga matura: 1205g"), gli ingredienti del gruppo pre-impasto DEVONO avere "excludeFromTotal": true.
- Questo evita che il calcolo del peso totale impasto conti gli ingredienti due volte (sia come singoli che come prodotto assemblato).
- Esempio: se il gruppo "Per la Biga" ha farina 830g, acqua 375g, lievito 1.8g, e nel gruppo "Per l'Impasto Finale" c'è "Biga matura: 1205g", allora i 3 ingredienti della biga devono avere "excludeFromTotal": true.
- Se NON c'è un prodotto assemblato nel gruppo successivo (come nella ciabatta con poolish, dove il poolish non appare come riga unica nell'impasto finale), NON usare excludeFromTotal.

VARIANTI DI PROCEDIMENTO (OPZIONALE):
- Il campo "variants" è un array OPZIONALE. Aggiungilo SOLO quando la ricetta ha naturalmente varianti tecniche alternative (es. lievitazione rapida vs frigo, cottura forno vs padella).
- NON forzare varianti su ricette che non ne hanno.
- Ogni variante ha: id, label (con emoji), description, ingredientOverrides (array opzionale di override di ingredienti), branchAfterStep (indice 0-based dello step dopo il quale la variante si innesta), altSteps (step alternativi che sostituiscono quelli successivi).
- ingredientOverrides.ref DEVE matchare un token id usato nel testo degli step (es. ref "lievito" matcha il token {lievito:1.8}).
- I testi degli altSteps DEVONO usare i token {id:base} come gli step normali.
- Ricette tipiche CON varianti: pizza/pane con lievitazione frigo vs temperatura ambiente, pasta con cottura in acqua vs al forno.
- Ricette tipiche SENZA varianti: dolci, biscotti, pasta semplice, focaccia standard.

⚠️ REGOLA CRITICA — branchAfterStep + ingredientOverrides (VIOLAZIONE = BUG FRONTEND):
- Se una variante sovrascrive un ingrediente (ingredientOverrides), verifica IN QUALE STEP quel token viene PRIMA menzionato nel procedimento.
- Il branchAfterStep DEVE essere ≤ all'indice dello step che MENZIONA PER PRIMO l'ingrediente overridato.
- Se la variante cambia TIPO di ingrediente (es. lievito di birra → lievito madre), il testo degli step pre-branch diventa incoerente ("sciogliere il lievito" non ha senso per il lievito madre solido).
- Esempio SBAGLIATO: il token {lievito:6} appare nello step 0 → branchAfterStep: 2 → step 0 mostra "Sciogliere 120g di lievito" (assurdo).
- Esempio CORRETTO: il token {lievito:6} appare nello step 0 → branchAfterStep: 0 → tutti gli step sono sostituiti.
- CHECKLIST: per ogni ingredientOverride, cerca il tokenId nel testo di tutti gli step. Il branchAfterStep NON può essere maggiore dell'indice del primo step che contiene quel token.

⚠️ REGOLA COERENZA BIOLOGICA — ingredientOverrides e tempi di lievitazione:
- Se una variante CAMBIA I TEMPI DI LIEVITAZIONE (es. da 2h a 24h in frigo, o viceversa), DEVE SEMPRE includere un ingredientOverride per il LIEVITO.
- Lievitazione in frigo (18-24h) = MENO lievito (tipicamente 1/3 - 1/6 della dose base). Esempio: se la base usa 3g, la variante frigo deve avere ingredientOverrides con 0.5-1g.
- Lievitazione rapida (2-3h) = PIÙ lievito rispetto alla base. Esempio: se la base usa 1.5g, la variante rapida potrebbe usare 5-6g.
- NON lasciare MAI ingredientOverrides vuoto [] se la variante cambia significativamente i tempi. Questo causa un bug nel frontend (gli ingredienti non si aggiornano).`;

/**
 * Riscrive una ricetta con Claude, arricchita da fonti reali
 * 
 * Pipeline PRO:
 *   1. Cerca fonti reali via SerpAPI (GialloZafferano, forum, mulini)
 *   2. Scrappa ingredienti e proporzioni dalle fonti trovate
 *   3. Passa i dati scrappati + fonti reali a Claude
 *   4. Claude genera con contesto completo, senza inventare
 * 
 * @param {object} rawRecipe - Dati scrappati dal modulo scraper
 * @returns {Promise<object>} Ricetta enhanced in formato JSON strutturato
 */
export async function enhanceRecipe(rawRecipe, options = {}) {
  // ── Step 1: Cerca fonti reali per cross-reference ──
  let realSourcesText = '';
  let sourcesFound = 0;

  // Estrai il nome ricetta per la ricerca fonti (3 strategie di fallback)
  let recipeName = rawRecipe.title;
  if (!recipeName || recipeName === 'ricetta' || recipeName.length < 3) {
    // Fallback 1: Estrai dal slug della URL sorgente (es. "pizza-napoletana" → "Pizza Napoletana")
    if (rawRecipe.sourceUrl) {
      const urlSlug = rawRecipe.sourceUrl.replace(/\/+$/, '').split('/').pop();
      if (urlSlug && urlSlug.length > 2) {
        recipeName = urlSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }
    }
  }
  if (!recipeName || recipeName === 'ricetta' || recipeName.length < 3) {
    // Fallback 2: Prima riga non vuota del testo grezzo
    const firstLine = (rawRecipe.ingredients?.[0] || rawRecipe.steps?.[0] || '').substring(0, 60);
    recipeName = firstLine || 'ricetta italiana';
  }
  // Prefissa "ricetta" per migliorare la ricerca
  const searchQuery = recipeName.toLowerCase().includes('ricetta') ? recipeName : `ricetta ${recipeName}`;

  try {
    const { searchRealSources, scrapeRecipePage } = await import('./validator.js');
    console.log(`🔍 Cerco fonti reali per "${searchQuery}" per arricchire la generazione...`);
    const sources = await searchRealSources(searchQuery);
    console.log(`📡 Trovate ${sources.length} fonti, scraping...`);

    const scrapedData = [];
    for (const source of sources) {
      try {
        process.stdout.write(`   🌐 ${source.domain}... `);
        const data = await scrapeRecipePage(source.url);
        if (data && data.ingredients?.length > 0) {
          scrapedData.push({ ...data, domain: source.domain, title: source.title });
          console.log(`✅ ${data.ingredients.length} ingredienti (${data.source})`);
        } else {
          console.log('❌ nessun dato utile');
        }
      } catch {
        console.log('❌ errore');
      }
      await new Promise(r => setTimeout(r, 400));
    }

    sourcesFound = scrapedData.length;

    if (scrapedData.length > 0) {
      realSourcesText = '\n\n══════ DATI REALI DA FONTI AUTOREVOLI ══════\n';
      realSourcesText += 'USA QUESTI DATI come riferimento per ingredienti, proporzioni e tecniche.\n';
      realSourcesText += 'NON inventare dati tecnici (forza W, temperature, tempi) se le fonti li specificano.\n\n';

      for (const [i, src] of scrapedData.entries()) {
        realSourcesText += `── FONTE ${i + 1}: ${src.domain} ──\n`;
        if (src.ingredients.length > 0) {
          realSourcesText += `   Ingredienti:\n`;
          src.ingredients.forEach(ing => { realSourcesText += `   - ${ing}\n`; });
        }
        if (src.prepTime) realSourcesText += `   Tempo prep: ${src.prepTime}\n`;
        if (src.cookTime) realSourcesText += `   Tempo cottura: ${src.cookTime}\n`;
        if (src.steps?.length > 0) {
          realSourcesText += `   Procedimento:\n`;
          src.steps.slice(0, 6).forEach((step, j) => {
            realSourcesText += `   ${j + 1}. ${step.substring(0, 200)}\n`;
          });
        }
        realSourcesText += '\n';
      }
    }
  } catch (err) {
    console.log(`⚠️  Ricerca fonti non riuscita: ${err.message}`);
    console.log('   Procedo con i soli dati scrappati...');
  }

  // ── Step 2: Genera con Claude usando dati scrappati + fonti reali ──
  const sourceLabel = sourcesFound > 0
    ? `(arricchita con ${sourcesFound} fonti reali)`
    : '(senza fonti reali aggiuntive)';
  const aiName = {'gemini': 'Gemini 2.5 Pro', 'gemini-3.1': 'Gemini 3.1 Pro', 'claude-opus': 'Claude Opus 4.6'}[options.aiModel] || 'Claude Sonnet 4.6';
  log.info(`${aiName} sta riscrivendo la ricetta ${sourceLabel}...`);

  const dataDirective = sourcesFound > 0
    ? `IMPORTANTE: Ho trovato ${sourcesFound} fonti reali autorevoli. DEVI basare i dati tecnici (forza farina W, temperature impasto, temperature acqua, tempi, proporzioni) sui dati reali sotto. Se la fonte specifica una temperatura dell'acqua, RISPETTALA — non sostituirla con acqua ghiacciata a meno che il contesto tecnico lo richieda (vedi regola 15). Per gli ingredienti che cambiano tra setup spirale vs mano, compila il campo setupNote.`
    : `Non ho trovato fonti reali. Basati sui dati scrappati e sulla tua conoscenza, ma sii conservativo.`;

  const userPrompt = `Ecco i dati grezzi di una ricetta scrappata da ${rawRecipe.sourceUrl || 'fonte web'}:

TITOLO: ${rawRecipe.title}
DESCRIZIONE: ${rawRecipe.description}

INGREDIENTI:
${rawRecipe.ingredients.map(i => `- ${i}`).join('\n')}

PROCEDIMENTO:
${rawRecipe.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

PORZIONI: ${rawRecipe.servings || 'non specificato'}
TEMPO PREPARAZIONE: ${rawRecipe.prepTime || 'non specificato'}
TEMPO COTTURA: ${rawRecipe.cookTime || 'non specificato'}
CATEGORIA: ${rawRecipe.category || 'non specificata'}

${dataDirective}
${realSourcesText}

Trasforma questa ricetta nel formato JSON tecnico del Ricettario. I dati tecnici devono riflettere le fonti reali quando disponibili.`;

  const text = await callAI(options.aiModel, {
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const recipe = parseClaudeJson(text);
  recipe._sourcesUsed = sourcesFound;
  recipe._generatedBy = options.aiModel || 'claude';
  log.success(`Ricetta "${recipe.title}" elaborata con successo ${sourceLabel}`);
  return recipe;
}

/**
 * Genera una ricetta BASATA SU FONTI REALI (non dalla memoria di Claude)
 * 
 * Pipeline data-driven:
 *   1. Cerca fonti reali via SerpAPI (forum, mulini, accademie)
 *   2. Scrappa ingredienti e proporzioni dalle pagine trovate
 *   3. Passa i dati reali a Claude come contesto obbligatorio
 *   4. Claude riscrive nel formato Ricettario, senza inventare
 * 
 * @param {string} nome - Nome della ricetta
 * @param {object} options - Opzioni aggiuntive (idratazione, tipo, note)
 */
export async function generateRecipe(nome, options = {}) {
  console.log(`🔍 Cerco fonti reali per "${nome}"...`);

  // ── Step 1: Cerca fonti reali ──
  let realSourcesText = '';
  let sourcesFound = 0;

  try {
    const { searchRealSources, scrapeRecipePage } = await import('./validator.js');
    const sources = await searchRealSources(nome);
    console.log(`📡 Trovate ${sources.length} fonti, scraping...`);

    const scrapedData = [];
    for (const source of sources) {
      try {
        process.stdout.write(`   🌐 ${source.domain}... `);
        const data = await scrapeRecipePage(source.url);
        if (data && data.ingredients?.length > 0) {
          scrapedData.push({ ...data, domain: source.domain, title: source.title });
          console.log(`✅ ${data.ingredients.length} ingredienti`);
        } else {
          console.log('❌ nessun dato');
        }
      } catch {
        console.log('❌ errore');
      }
      // Pausa tra richieste
      await new Promise(r => setTimeout(r, 400));
    }

    sourcesFound = scrapedData.length;

    if (scrapedData.length > 0) {
      realSourcesText = '\n\n══════ DATI REALI DA FONTI VERIFICATE ══════\n';
      realSourcesText += 'USA QUESTI DATI COME BASE. NON INVENTARE ingredienti o proporzioni.\n\n';

      for (const [i, src] of scrapedData.entries()) {
        realSourcesText += `── FONTE ${i + 1}: ${src.domain} ──\n`;
        realSourcesText += `   URL: ${src.url}\n`;
        if (src.name) realSourcesText += `   Nome: ${src.name}\n`;
        if (src.ingredients.length > 0) {
          realSourcesText += `   Ingredienti:\n`;
          src.ingredients.forEach(ing => {
            realSourcesText += `   - ${ing}\n`;
          });
        }
        if (src.prepTime) realSourcesText += `   Tempo prep: ${src.prepTime}\n`;
        if (src.cookTime) realSourcesText += `   Tempo cottura: ${src.cookTime}\n`;
        if (src.servings) realSourcesText += `   Porzioni: ${src.servings}\n`;
        if (src.steps?.length > 0) {
          realSourcesText += `   Procedimento:\n`;
          src.steps.slice(0, 8).forEach((step, j) => {
            realSourcesText += `   ${j + 1}. ${step.substring(0, 200)}\n`;
          });
        }
        realSourcesText += '\n';
      }
    }
  } catch (err) {
    console.log(`⚠️  Ricerca fonti non riuscita: ${err.message}`);
    console.log('   Procedo con la generazione standard...');
  }

  // ── Step 2: Genera con Claude usando i dati reali ──
  const sourceLabel = sourcesFound > 0
    ? `(base: ${sourcesFound} fonti reali)`
    : '(senza fonti — usa conoscenza generale)';
  const aiLabel = {'gemini': 'Gemini 2.5 Pro', 'gemini-3.1': 'Gemini 3.1 Pro', 'claude-opus': 'Claude Opus 4.6'}[options.aiModel] || 'Claude Sonnet 4.6';
  console.log(`\n🤖 ${aiLabel} sta creando la ricetta "${nome}" ${sourceLabel}...`);

  const dataDirective = sourcesFound > 0
    ? `IMPORTANTE: Ho trovato ${sourcesFound} fonti reali. DEVI basare ingredienti e proporzioni sui dati scrappati sotto. Non inventare. Se le fonti si contraddicono, privilegia la media delle proporzioni. Cita mentalmente le fonti nel tuo ragionamento.`
    : `ATTENZIONE: Non ho trovato fonti reali scrappabili. Basati sulla tua conoscenza ma sii conservativo: usa solo ricette tradizionali ben documentate, non inventare varianti creative.`;

  const userPrompt = `Crea una ricetta professionale completa per: "${nome}"

${options.tipo ? `Tipo: ${options.tipo}` : ''}
${options.note ? `Note: ${options.note}` : ''}

${dataDirective}
${realSourcesText}

Genera la ricetta completa nel formato JSON del Ricettario. I dati devono riflettere FEDELMENTE le fonti reali sopra. Se un ingrediente appare nella maggioranza delle fonti, deve essere presente. Se le proporzioni variano, usa la media.`;

  const text = await callAI(options.aiModel, {
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const recipe = parseClaudeJson(text);
  recipe._sourcesUsed = sourcesFound;
  recipe._generatedBy = options.aiModel || 'claude';
  log.success(`Ricetta "${recipe.title}" generata ${sourceLabel}`);
  return recipe;
}

/**
 * Legge immagini e usa Claude per estrarre direttamente il JSON strutturato per HTML
 * @param {string[]} imagePaths - path delle immagini (max 5 per batch)
 */
export async function extractRecipesFromImages(imagePaths) {
  const fs = await import('fs');
  const contentArray = [];

  for (const imgPath of imagePaths) {
    const base64Img = fs.readFileSync(imgPath).toString('base64');
    contentArray.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: base64Img,
      }
    });
  }

  const prompt = `Queste immagini contengono pagine del ricettario ufficiale Philips Pasta Maker.
Estrai TUTTE le ricette presenti.
Usa ESATTAMENTE questa struttura JSON per ogni ricetta (devi restituire un array \`[]\` di oggetti).
Non aggiungere testo fuori dal JSON.

Esempio Struttura di ritorno:
[
  {
    "title": "Maccheroni al farro",
    "slug": "maccheroni-al-farro-philips",
    "emoji": "🍝",
    "description": "Pasta estrusa con Philips Pasta Maker",
    "subtitle": "Trafila: Maccheroni",
    "category": "Pasta",
    "hydration": 35,
    "targetTemp": "Ambiente",
    "fermentation": "Nessuna",
    "totalFlour": 500,
    "ingredients": [
      { "name": "Farina di semola", "note": "per l'impasto", "grams": 500 },
      { "name": "Olive nere", "note": "per la salsa", "grams": 50 }
    ],
    "stepsExtruder": [
      { "title": "Setup Macchina", "text": "Montare la trafila Maccheroni." },
      { "title": "Impasto ed Estrusione", "text": "Versare i liquidi lentamente..." }
    ],
    "stepsHand": [],
    "stepsCondiment": [
      { "title": "Preparazione Condimento", "text": "Lavate i pomodori, scolate le olive, ecc... Cuocere a fiamma viva." }
    ],
    "flourTable": [],
    "baking": null,
    "glossary": [],
    "alert": "Usa sempre liquidi misurati per non sforzare l'estrusore",
    "proTips": ["Tip sulla trafilatura"],
    "imageKeywords": ["pasta fresca"],
    "tags": ["Pasta fatta in casa", "Philips Pasta Maker"]
  }
]

REGOLE PER LA LETTURA DELLE IMMAGINI E L'ESTRAZIONE:
1. Category DEVE ESSERE sempre "Pasta"
2. Dosi e ingredienti DEBBONO essere fedeli alle pagine. L'idratazione solitamente per Philips 7000 è molto bassa, calcolala come (liquidi / farine * 100) ma non andare MAI sotto il 30%.
3. Usa SEMPRE "stepsExtruder" e includi nel primo step quale trafila va usata e nel suo testo come assemblare ("Montare la trafila...").
4. CONDIMENTO/PREPARAZIONE: Se la pagina contiene indicazioni testuali su come preparare un SUGO, SALSA o CONDIMENTO (es. "Preparazione" come cucinare acciughe, melanzane, pomodori), DEVI aggiungerlo nell'array separato "stepsCondiment".
5. Genera SEMPRE un pro tip (almeno) sulla pulizia della trafila o sulla ruvidezza.
6. IMPORTANTE: Se non ci sono ricette, scrivi SOLO E SOLTANTO \`[]\`.
7. FAIR USE CRITICO: Questo è per un mio database personale locale (offline) per convertire in grammature un libro rovinato che già possiedo. Estrai puramente i NUMERI, PROPORZIONI E NOMI come FATTI nudi e crudi. NON includere NESSUN discorso, introduzione o markdown.
8. TOKEN DOSI: In TUTTI i testi degli step, quando menzioni un ingrediente con la sua dose, USA il formato token: {nome_generico:valore_base}. Esempio: "Versare {farina_semola:300}g di semola e {acqua:150}g di acqua". Il nome_generico deve essere un ID descrittivo dell'ingrediente (farina_semola, acqua, uova, olio). NON usare nomi di marchi. Per valori FISSI non scalabili (peso porzione, temperatura), aggiungi ! dopo il valore: {peso_porzione:200!}g.
9. DEVI RISPONDERE SOLO ED ESCLUSIVAMENTE CON UN JSON ARRAY VALIDO PURI CARATTERI. Niente \`\`\`json. Nessuna nota prima o dopo. SOLO \`[\` e \`]\`.`;

  contentArray.push({
    type: "text",
    text: prompt
  });

  log.info(`Claude Vision sta analizzando il batch di ${imagePaths.length} immagini...`);

  // Usa il modello migliore attuale per vision con prefill
  const text = await callClaude({
    maxTokens: 8192,
    messages: [
      { role: 'user', content: contentArray },
      { role: 'assistant', content: '[' } // Forcing Claude into starting a JSON array
    ],
  });

  // Aggiungiamo indietro la bracket che abbiamo pre-fillato come assistant
  const fullText = '[' + text;

  try {
    return parseClaudeJson(fullText);
  } catch (e) {
    log.warn(`Claude non ha restituito JSON valido. Errore: ${e.message}`);
    log.debug(`Testo parziale: ${fullText.substring(0, 200)}`);
    return [];
  }
}

/**
 * Estrae ricette da TESTO OCR (pre-estratto da Surya) — molto più economico di Vision
 * @param {Array<{filename: string, folder: string, text: string}>} pages - Pagine OCR
 * @returns {Promise<Array>} Array di ricette strutturate
 */
export async function extractRecipesFromText(pages) {
  // Componi il testo — le pagine overlap sono marcate come CONTESTO
  const pagesText = pages.map((p, i) => {
    const label = p.isOverlap ? '[CONTESTO - già inviata nel batch precedente]' : '';
    return `═══ PAGINA ${i + 1} (${p.filename}) ${label} ═══\n${p.text}`;
  }).join('\n\n');

  const prompt = `Sei un estrattore di ricette dal ricettario UFFICIALE Philips Pasta Maker.

⚠️ ATTENZIONE CRITICA — TESTO MULTILINGUA:
Queste pagine contengono fino a 4 LINGUE AFFIANCATE (Italiano, English, Deutsch, Ελληνικά, Français).
Le righe delle diverse lingue sono INTERCALATE nel testo OCR, NON separate.
Ogni ricetta appare tradotta in tutte le lingue SULLO STESSO BLOCCO DI TESTO.
DEVI estrarre SOLO ED ESCLUSIVAMENTE il contenuto ITALIANO. Ignora completamente tutto ciò che è in altre lingue.

⚠️ ATTENZIONE — STRUTTURA TIPICA DI OGNI RICETTA NEL LIBRO:
Ogni ricetta nel libro Philips segue SEMPRE questo schema:
  1. TITOLO DELLA RICETTA (es. "Spaghetti con salsa di pomodoro")
  2. SEZIONE "Per l'impasto" → lista ingredienti per la pasta (farine, acqua, uova)
  3. SEZIONE "Esecuzione" → istruzioni per il Pasta Maker (trafila, programma, estrusione)
  4. SEZIONE "Per la salsa/condimento" (opzionale) → lista ingredienti del condimento
  5. SEZIONE "Preparazione" (opzionale) → istruzioni per cuocere il condimento

REGOLA FONDAMENTALE: ogni ingrediente che estrai DEVE apparire ESPLICITAMENTE nel testo italiano della ricetta.
NON inventare ingredienti. NON combinare ingredienti da ricette diverse.
NON aggiungere ingredienti da fonti esterne. NON arricchire le dosi.
Se una dose non è chiara nel testo, scrivi 0 nei grammi e "q.b." nella note.

Struttura JSON di ritorno (array di oggetti):
[
  {
    "title": "Maccheroni al farro",
    "slug": "maccheroni-al-farro-philips",
    "emoji": "🍝",
    "description": "Breve descrizione dalla ricetta originale",
    "subtitle": "Trafila: Maccheroni",
    "category": "Pasta",
    "hydration": 35,
    "targetTemp": "Ambiente",
    "fermentation": "Nessuna",
    "totalFlour": 500,
    "ingredients": [
      { "name": "Farina di semola", "note": "per l'impasto", "grams": 500 },
      { "name": "Pomodori", "note": "per la salsa", "grams": 300 }
    ],
    "stepsExtruder": [
      { "title": "Setup Macchina", "text": "Montare la trafila Maccheroni." },
      { "title": "Impasto ed Estrusione", "text": "Versare le farine nella vasca..." }
    ],
    "stepsHand": [],
    "stepsCondiment": [
      { "title": "Preparazione Condimento", "text": "Istruzioni esatte dal libro..." }
    ],
    "flourTable": [],
    "baking": null,
    "glossary": [],
    "alert": "Usa sempre liquidi misurati per non sforzare l'estrusore",
    "proTips": ["Tip sulla trafilatura"],
    "imageKeywords": ["pasta fresca", "keyword descrittivo"],
    "tags": ["Pasta fatta in casa", "Philips Pasta Maker"]
  }
]

REGOLE:
1. Category = sempre "Pasta". Lo slug DEVE finire con "-philips".
2. INGREDIENTI: estrai SOLO quelli scritti esplicitamente nel testo italiano. Per l'impasto: farine + liquidi. Per la salsa: solo se indicata. Idratazione = (liquidi / farine × 100), minimo 30%.
3. Usa SEMPRE "stepsExtruder" con nel primo step quale trafila usare.
4. Se c'è un condimento/salsa nel testo, mettilo in "stepsCondiment". Copia le istruzioni FEDELMENTE dal libro.
5. Se NON ci sono ricette nel testo, restituisci SOLO [].
6. CORREGGI solo errori OCR evidenti (es. "5OOg" → 500g, "tarlila" → "trafila").
7. LINGUE: trascrivi SOLO italiano. Se non c'è italiano, traduci dalla prima lingua disponibile.
8. DEDUPLICAZIONE: pagine marcate [CONTESTO] servono solo per completare ricette dal batch precedente. Non estrarre ricette che iniziano lì.
9. RISPONDI SOLO con un JSON ARRAY valido. Niente markdown, niente note, SOLO [ e ].
10. NON INVENTARE NULLA. Ogni dato deve provenire dal testo. Se un'informazione manca, omettila o usa valori vuoti.
11. TOKEN DOSI: In TUTTI i testi degli step (stepsExtruder, stepsCondiment), quando menzioni un ingrediente con la sua dose, USA il formato token: {nome_generico:valore_base}. Esempio: "Versare {farina_semola:300}g di semola e {acqua:150}g di acqua". Il nome_generico deve essere un ID descrittivo (farina_semola, acqua, uova, olio). NON usare nomi di marchi. Per valori FISSI non scalabili (peso porzione, temperatura), aggiungi ! dopo il valore: {peso_porzione:200!}g.

TESTI OCR ESTRATTI:
${pagesText}`;

  log.info(`Claude sta analizzando ${pages.length} pagine di testo OCR...`);

  const text = await callClaude({
    maxTokens: 8192,
    messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: '[' }
    ],
  });

  const fullText = '[' + text;

  try {
    return parseClaudeJson(fullText);
  } catch (e) {
    log.warn(`Claude non ha restituito JSON valido. Errore: ${e.message}`);
    log.debug(`Testo parziale: ${fullText.substring(0, 200)}`);
    return [];
  }
}

/**
 * Struttura una ricetta da TESTO LIBERO (appunti, copia-incolla, note personali)
 * usando Claude AI per adattarla al formato del Ricettario.
 *
 * A differenza di enhanceRecipe() (che parte da dati scrappati strutturati),
 * questa funzione accetta testo completamente destrutturato.
 *
 * @param {string} rawText - Testo libero della ricetta
 * @param {object} options - Opzioni aggiuntive (tipo, note)
 * @returns {Promise<object>} Ricetta strutturata in formato JSON
 */
export async function enhanceFromText(rawText, options = {}) {
  log.info('AI sta strutturando la ricetta dal testo libero...');

  // ── Step 1 (opzionale): Cerca fonti reali per arricchire ──
  let realSourcesText = '';
  let sourcesFound = 0;

  // Estrai un possibile nome ricetta dalla prima riga significativa
  const firstLine = rawText.split('\n').find(l => l.trim().length > 3)?.trim() || '';
  const recipeName = firstLine.replace(/^[🍕🥖🍝🥐🍪🫓#*\-—]+\s*/, '').replace(/["']/g, '').substring(0, 60);

  if (recipeName.length > 3) {
    try {
      const { searchRealSources, scrapeRecipePage } = await import('./validator.js');
      const searchQuery = recipeName.toLowerCase().includes('ricetta') ? recipeName : `ricetta ${recipeName}`;
      console.log(`🔍 Cerco fonti reali per "${searchQuery}" per arricchire la strutturazione...`);
      const sources = await searchRealSources(searchQuery);
      console.log(`📡 Trovate ${sources.length} fonti, scraping...`);

      const scrapedData = [];
      for (const source of sources.slice(0, 5)) {
        try {
          process.stdout.write(`   🌐 ${source.domain}... `);
          const data = await scrapeRecipePage(source.url);
          if (data && data.ingredients?.length > 0) {
            scrapedData.push({ ...data, domain: source.domain, title: source.title });
            console.log(`✅ ${data.ingredients.length} ingredienti (${data.source})`);
          } else {
            console.log('❌ nessun dato utile');
          }
        } catch {
          console.log('❌ errore');
        }
        await new Promise(r => setTimeout(r, 400));
      }

      sourcesFound = scrapedData.length;

      if (scrapedData.length > 0) {
        realSourcesText = '\n\n══════ DATI REALI DA FONTI AUTOREVOLI (per confronto) ══════\n';
        realSourcesText += 'Usa questi dati SOLO come RIFERIMENTO per validare proporzioni e tecniche.\n';
        realSourcesText += 'La ricetta dell\'utente ha PRIORITÀ ASSOLUTA — non modificare dosi e ingredienti.\n\n';

        for (const [i, src] of scrapedData.entries()) {
          realSourcesText += `── FONTE ${i + 1}: ${src.domain} ──\n`;
          if (src.ingredients.length > 0) {
            realSourcesText += `   Ingredienti:\n`;
            src.ingredients.forEach(ing => { realSourcesText += `   - ${ing}\n`; });
          }
          if (src.steps?.length > 0) {
            realSourcesText += `   Procedimento:\n`;
            src.steps.slice(0, 4).forEach((step, j) => {
              realSourcesText += `   ${j + 1}. ${step.substring(0, 150)}\n`;
            });
          }
          realSourcesText += '\n';
        }
      }
    } catch (err) {
      console.log(`⚠️  Ricerca fonti non riuscita: ${err.message}`);
      console.log('   Procedo con il solo testo dell\'utente...');
    }
  }

  // ── Step 2: Claude struttura il testo ──
  const sourceLabel = sourcesFound > 0
    ? `(con ${sourcesFound} fonti di riferimento)`
    : '(senza fonti aggiuntive)';
  const aiName = {'gemini': 'Gemini 2.5 Pro', 'gemini-3.1': 'Gemini 3.1 Pro', 'claude-opus': 'Claude Opus 4.6'}[options.aiModel] || 'Claude Sonnet 4.6';
  log.info(`${aiName} sta strutturando la ricetta ${sourceLabel}...`);

  const userPrompt = `L'utente ha inserito questa ricetta in formato TESTO LIBERO (appunti personali, note, copia-incolla).
Il tuo compito è STRUTTURARLA nel formato JSON del Ricettario, SENZA modificare dosi e ingredienti dell'utente.

⚠️ REGOLA FONDAMENTALE: Le dosi, le temperature, i tempi e gli ingredienti dell'utente hanno PRIORITÀ ASSOLUTA.
NON modificarli. NON "correggere" le proporzioni. Rispetta fedelmente la ricetta fornita.
Puoi AGGIUNGERE: glossario, proTips, flourTable, alert, imageKeywords — basandoti sulla tua esperienza e sulle fonti reali.

${options.tipo ? `Categoria suggerita dall'utente: ${options.tipo}` : ''}
${options.note ? `Note aggiuntive: ${options.note}` : ''}

══════ TESTO RICETTA DELL'UTENTE ══════
${rawText}
══════ FINE TESTO ══════
${realSourcesText}

Trasforma il testo in un JSON strutturato. Le dosi DEVONO essere fedeli al testo originale.
Aggiungi glossario tecnico, proTips, flourTable e alert basandoti sulla tua esperienza.`;

  const text = await callAI(options.aiModel, {
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const recipe = parseClaudeJson(text);
  recipe._sourcesUsed = sourcesFound;
  recipe._inputMode = 'testo-libero';
  recipe._generatedBy = options.aiModel || 'claude';
  log.success(`Ricetta "${recipe.title}" strutturata con successo ${sourceLabel}`);
  return recipe;
}
