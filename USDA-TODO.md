# TODO — Nutrizionali da USDA FoodData Central

> Appunto per la sessione che farà questo lavoro (da un altro PC va bene:
> tutto il contesto necessario è qui). Scritto il 28/07/2026.

## Stato (28/07/2026, sera)

Fatto lo scoglio 1 — infrastruttura e dizionario:

- `FDC_API_KEY` attiva nel `.env` (chiave personale api.data.gov);
  client in `src/fdc.js`, prova rapida con `node test-fdc.mjs "query"`.
- Censimento: `scripts/estrai-ingredienti.mjs` → `data/fdc-ingredienti.json`
  (84 ricette, 791 item, 280 nomi unici — TUTTI con grammatura: lo
  scoglio 3 nei dati attuali non esiste).
- Dizionario: `scripts/costruisci-dizionario.mjs` (AI solo
  traduttore/selettore, numeri sempre USDA, validazione Atwater con
  correzione fibra+alcol) → `data/fdc-dizionario.json`: 280 voci, 272
  con numeri pronti, 0 da rivedere (revisione umana fatta in sessione),
  8 «composte» (bighe/poolish: si espandono nei componenti in fase di
  calcolo — occhio al doppio conteggio, vedi `excludeFromTotal` che ha
  DUE significati: «non entra nel prodotto» e «già contato altrove»).
- Cura manuale: si corregge l'`fdcId` nel JSON e si rilancia
  `scripts/aggiorna-numeri.mjs "chiave"` — i numeri ridiscendono da USDA;
  le voci con `numeriManuali: true` (carbone E153, carapaci filtrati via)
  non si toccano.

Fatto anche lo scoglio 2 — calo peso e motore di calcolo (28/07/2026, notte):

- `src/nutrizione.js`: somma pesata sul crudo → resa dichiarata → per
  100 g di prodotto finito. Espansione dei preimpasti per bilancio di
  massa + nome (NON fidarsi di `excludeFromTotal`: convenzione invertita
  tra ricette), classificazioni `fuoriProdotto`/`dentroProdotto` per gli
  item ambigui, rifiuto parlante quando manca una dichiarazione.
- `data/fdc-calcolo.json`: rese di famiglia per il forno (pane 0.80,
  pizza/focaccia 0.85, lievitati 0.88) + resa PER RICETTA per tutto il
  resto, proposta dall'AI dall'evidenza testuale dei passaggi
  (`scripts/proponi-rese.mjs`) e confermata a mano voce per voce.
- Validazione: `scripts/confronta-nutrizione.mjs` (calcolo USDA vs
  stima AI pubblicata). 84/84 ricette calcolano; grosso modo due terzi
  entro il ±10% dalla vecchia stima. Gli scarti grossi sono quasi tutti
  casi in cui il CALCOLO ha ragione (pulled pork ~380 kcal vs 218
  stimate; confit = vasetto con l'olio d'invaso, deciso in revisione).
- Limiti dichiarati (note nel file, non stime nascoste): grasso colato
  delle carni non modellato; alcol che evapora nelle riduzioni contato
  (teriyaki ~+25 kcal/100g); frittura senza modello dell'olio assorbito
  → `dolci/cartocci-alla-crema-siciliani` è l'UNICA ricetta ancora
  daRivedere, bloccata finché non c'è il modello (v2).
- Due proprietà della resa da non dimenticare (v. commento in
  `src/nutrizione.js`): si riferisce al peso CONTATO, e modella solo
  perdite non proporzionali (l'acqua, non l'olio nel filtro).

Fatta anche l'integrazione (28/07/2026, notte) — IL PIANO È COMPLETO:

- `generateAnalyticsProfile` (`src/sensory.js`) non chiede più la
  nutrizione al modello: il prompt è solo sensoriale, la `nutrition`
  arriva da `calcolaNutrizione` (e se il calcolo si rifiuta, la ricetta
  procede SENZA nutrizione — publisher e route qualità tolgono anche il
  valore vecchio: una stima di ieri non può stare sotto il disclaimer
  che nomina USDA).
- Batch fatto: `scripts/applica-nutrizione.mjs` ha riscritto la
  `nutrition` di 83 ricette su 84 (copie di sicurezza in serie
  'nutrizione'); i cartocci fritti restano senza valori finché non c'è
  il modello dell'olio assorbito (v2, unico daRivedere).
- Il disclaimer del sito nomina di nuovo la fonte, stavolta vera:
  «calcolati sugli ingredienti della ricetta con dati USDA FoodData
  Central e resa di cottura dichiarata» — «per 100 g» al suo posto,
  cancello del punto 9 rispettato. Aggiornato anche il punto 9 di
  `Ricettario/CHECKUP.md`.

V2 in corso (28/07/2026, notte):

- FATTO il modello frittura: `olioAssorbito: { grammi, chiave }` in
  fdc-calcolo.json — l'olio del bagno entra nel prodotto durante la
  cottura, quindi i grammi si sommano al peso finito DOPO la resa (che
  continua a modellare solo il crudo) e i nutrienti vengono dalla voce
  di dizionario citata. I cartocci sono sbloccati: resa 0.94 + 100 g di
  olio di arachidi (voce 171410 aggiunta a mano: l'olio di frittura non
  è mai tra gli ingredienti pesati) → 254 kcal/100g, confermati in
  revisione. proponi-rese sa proporre il modello per le fritture future.

- FATTO il modello alcol: il dizionario annota `alcolPer100g` (nutriente
  USDA 221, aggiorna-numeri lo tiene fresco), e le ricette che cuociono
  con alcol dichiarano `alcolResiduo: { frazione }` con le frazioni
  della tabella USDA di ritenzione (85% a fine cottura, 40% a 15 min,
  25% a 1 h, 5% oltre le 2.5 h) — si scorporano solo le kcal (6.93/g,
  fattore Atwater USDA): l'etanolo non è un macro e la sua massa sta
  già nella resa. Otto ricette dichiarate e confermate; la teriyaki,
  che era il caso peggiore, è passata da 311 a 222 kcal/100g — a un
  soffio dalla vecchia stima AI (218), che l'evaporazione la intuiva.
  Ricette cotte con ≥2 g di alcol senza dichiarazione ricevono un
  avviso, non un blocco.

Resta, dichiarato e non nascosto: grasso colato delle carni (pulled
pork, brisket, ribs — kcal prudenziali in eccesso, note in
fdc-calcolo.json).

## Perché

I valori nutrizionali delle ricette li **stima l'AI** dentro
`generateAnalyticsProfile` (`src/sensory.js`): kcal e macro per 100 g di
prodotto finito, con calo peso stimato. Il disclaimer del sito diceva
«calcolati tramite database USDA» — una fonte che non c'era — ed è stato
corretto in «stimati sugli ingredienti della ricetta» (commit `aee0c98` del
sito). Questo lavoro rende i numeri **veri e tracciabili**: quando è fatto, il
disclaimer torna a nominare USDA.

## Obiettivo

Per ogni ricetta: numeri da **USDA FoodData Central**
(https://fdc.nal.usda.gov/ — API REST gratuita, chiave su api.data.gov),
non più stime del modello. Flusso: per ogni ingrediente con grammatura →
voce FDC corrispondente → valori per 100 g → somma pesata → correzione per
il calo peso di cottura → diviso il peso finito → per 100 g di prodotto.

## I tre scogli (individuati in analisi, non ancora affrontati)

1. **Mapping italiano→FDC** — è il grosso del lavoro. «Farina tipo 00»,
   «guanciale», «colatura di alici», «pasta madre» non esistono su FDC.
   Strada consigliata: **dizionario curato** ingrediente→fdcId per gli
   ingredienti del ricettario (sono qualche centinaio di nomi unici: si
   estraggono da `Ricettario/ricette/**/*.json`, campo `ingredientGroups`),
   con l'AI usata SOLO come traduttore/selettore della voce FDC in fase di
   costruzione del dizionario — i numeri restano di fonte USDA. Il dizionario
   è il pezzo riusabile comunque vada: partire da lì.
2. **Calo peso** — i valori FDC sono sul crudo; il sito dichiara «per 100 g
   di prodotto finito». Serve un fattore di resa per famiglia (pane ~-20%
   d'acqua, brasati altro) o dichiarato per ricetta. Attenzione a non
   reintrodurre la stima proprio qui.
3. **Ingredienti senza grammatura** («q.b.», rametti): decidere
   esplicitamente (di solito trascurabili, ma va scritto).

## Dove si aggancia

- Il punto di sostituzione è `generateAnalyticsProfile` in `src/sensory.js`:
  oggi il prompt chiede all'AI anche la nutrizione; con USDA la parte
  `nutrition` esce dal prompt e diventa un calcolo (la parte `sensory` resta
  com'è — quella È giudizio).
- La condizione del renderer del sito è `nutrition.macros` (vedi
  `hasNutrition` in `Ricettario/scripts/build-recipes.js`): mantenere lo
  stesso schema `{ kcal_per_100g, macros: { carbs, protein, fat } }`.
- Rigenerare poi i nutrizionali delle 82 ricette esistenti (batch: route
  `/api/qualita/sensory`, o comando dedicato solo-nutrizione da creare).
- Ultimo passo: il disclaimer in `Ricettario/js/html-ricetta.js` torna a
  nominare la fonte, e la nota nel punto 9 di `Ricettario/CHECKUP.md` si
  aggiorna.

## Nota di rispetto per il cancello

Il cancello del sito (punto 9 di `verifica-build.js`) pretende che il testo
visibile dichiari la base «per 100 g» quando il JSON-LD ha NutritionInformation:
qualunque nuova frase deve mantenerla.
