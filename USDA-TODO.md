# TODO — Nutrizionali da USDA FoodData Central

> Appunto per la sessione che farà questo lavoro (da un altro PC va bene:
> tutto il contesto necessario è qui). Scritto il 28/07/2026.

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
