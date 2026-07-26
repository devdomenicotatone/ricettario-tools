# 🔥 Ricettario Tools

Strumenti per creare, validare e gestire le ricette de **Il Ricettario**.
Mettono insieme scraping web, OCR locale, AI (Claude e Gemini) e ricerca
immagini stock, e scrivono il risultato **come JSON dentro il repo del sito**.

> **Il sito non è più fatto di pagine HTML.** È una SPA che legge i `.json`
> delle ricette: `ricette/<categoria>/<slug>.json` più l'indice
> `public/recipes.json`. Se in questo README o in un messaggio dei comandi
> trovi ancora scritto "genera la pagina HTML", è testo vecchio: l'HTML lo
> costruisce il sito a runtime.

Si usa in due modi:

| | Come si avvia | Quando |
|---|---|---|
| **Dashboard web** (modo principale) | `npm run dashboard` → <http://localhost:3500> | Uso normale: creare, modificare, pubblicare, controllare qualità |
| **CLI** | `node crea-ricetta.js --help` | Batch, automazioni, tutto ciò che vuoi lanciare senza browser |

I due modi condividono lo stesso codice (`src/`): la dashboard è un server
Express che chiama gli stessi comandi della CLI e ne trasmette l'output in
diretta via WebSocket.

---

## Setup Rapido

```bash
# 1. Installa le dipendenze
cd tools
npm install

# 2. Configura le chiavi
cp .env.example .env
# Compila .env (vedi sezione sotto)

# 3a. Dashboard
npm run dashboard          # → http://localhost:3500

# 3b. oppure CLI
node crea-ricetta.js --help
```

`npm run dashboard:dev` fa la stessa cosa passando da nodemon: riavvia il
server a ogni salvataggio dei file sotto `src/server/`, `src/commands/` e
`dashboard.js`.

### Variabili d'ambiente

L'elenco completo, con i commenti, sta in [`.env.example`](./.env.example) —
quello è il riferimento, questa tabella è un riassunto.

| Variabile | Serve a | Obbligatoria |
|---|---|:---:|
| `ANTHROPIC_API_KEY` | Claude: riscrittura, strutturazione, QA | ✅ |
| `RICETTARIO_PATH` | Cartella del repo del sito (default `../Ricettario`) | ❌ |
| `SITE_URL` | Base URL per l'anteprima (default dev server Vite) | ❌ |
| `GEMINI_API_KEY` | Gemini: verifica qualità e "challenger" | ❌ |
| `GEMINI_API_KEY2` | Seconda chiave Gemini, a rotazione | ❌ |
| `SERPAPI_KEY` | Ricerca fonti reali su Google | ❌ |
| `SERPAPI_KEY_2` | Seconda chiave SerpAPI, a rotazione | ❌ |
| `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` | Volumi di ricerca nella barra SEO | ❌ |
| `PEXELS_API_KEY` | Immagini Pexels | ❌ |
| `UNSPLASH_ACCESS_KEY` | Immagini Unsplash | ❌ |
| `PIXABAY_API_KEY` | Immagini Pixabay | ❌ |
| `OCR_PAGINE_PER_BLOCCO` | Pagine per blocco nell'OCR locale (default 10) | ❌ |
| `OCR_TIMEOUT_BLOCCO_MS` | Timeout fisso per blocco OCR in ms; 0 = dinamico (default) | ❌ |

`npm run check:env` rilegge le `process.env.*` scritte nel codice e fallisce
se una non compare sia in `.env.example` sia in questa tabella. Serve a non
ripetere la deriva di prima: il codice leggeva undici variabili e il file di
esempio ne documentava quattro.

> ⚠️ **Attenzione ai due nomi che si somigliano:** la seconda chiave Gemini è
> `GEMINI_API_KEY2` (senza underscore), la seconda SerpAPI è `SERPAPI_KEY_2`
> (con underscore). Sbagliare l'underscore non produce nessun errore: la
> chiave semplicemente non viene letta.

> Una chiave mancante **non** ferma niente e **non** stampa un avviso: il
> provider corrispondente resta muto e il flusso prosegue senza di lui. Se un
> risultato ti sembra povero, controlla prima `.env`. La pagina
> Impostazioni della dashboard mostra quali servizi risultano configurati.

Le API immagini sono opzionali ma **almeno una** è consigliata. Vengono usate
in cascata: Pexels → Unsplash → Pixabay → Wikimedia (che non richiede chiave).

---

## Categorie

Le categorie del sito sono nove e la loro **unica fonte** è
`Ricettario/js/categories.js`:

`Pane`, `Pizza`, `Primi`, `Lievitati`, `Focaccia`, `Dolci`, `Conserve`,
`Condimenti`, `Secondi Piatti`.

Non esiste più la categoria "Pasta": è stata rinominata in "Primi". Se trovi
"Pasta" scritta da qualche parte in questi strumenti, è un residuo da
correggere — una ricetta classificata così finisce in `ricette/pasta/`, che
sul sito non è dichiarata, e fa fallire `npm run check`.

---

## Comandi CLI

### 📥 `--url` — Importa ricetta da URL

```bash
node crea-ricetta.js --url "https://esempio.it/ricetta/focaccia"
node crea-ricetta.js --url "https://sito1.it/ricetta1,https://sito2.it/ricetta2"
```

1. **Scraping** del sito (JSON-LD → selettori CSS → browser headless Puppeteer)
2. **Ricerca fonti reali** via SerpAPI (query Google IT+EN) per cross-reference
3. **Claude** riscrive la ricetta nel formato tecnico del Ricettario
4. **Cross-check** ingredienti vs fonti web (punteggio di confidenza)
5. **Immagine** cercata e scaricata (Pexels/Unsplash/Pixabay/Wikimedia)
6. **JSON scritto** in `ricette/<categoria>/<slug>.json`
7. **`public/recipes.json`** aggiornato (indice della homepage)

### 🧠 `--nome` — Genera ricetta da zero

```bash
node crea-ricetta.js --nome "Focaccia Barese"
node crea-ricetta.js --nome "Pane Cafone" --tipo Pane
node crea-ricetta.js --nome "Pizza Napoletana" --note "con poolish al 30%"
```

- `--tipo <categoria>` — Una delle nove categorie qui sopra
- `--note <testo>` — Istruzioni aggiuntive per Claude
- `--aiModel <id>` — Chi genera: `claude` (default, Sonnet 4.6),
  `claude-opus`, `gemini`, `gemini-3.1`

> Non esiste un `--idratazione`. L'help lo pubblicizzava, ma nessuno leggeva
> quel valore: `src/commands/genera.js` passa a `generateRecipe` solo `tipo`,
> `note` e `aiModel`, e `generateRecipe` in `src/enhancer.js` nel prompt usa
> solo quei campi. Per chiedere un'idratazione precisa scrivila in `--note`,
> che nel prompt ci finisce davvero.

### 📝 `--testo` — Ricetta da testo libero

```bash
node crea-ricetta.js --testo ricetta.txt --tipo Pizza
```

Claude **struttura** il testo senza toccare dosi e ingredienti: le fonti
esterne servono solo per glossario, pro tips e tabella farine.

### 🔍 `--scopri` — Cerca ricette su Google

```bash
node crea-ricetta.js --scopri "focaccia pugliese" --quante 8
```

Mostra i risultati e ti fa scegliere quali generare (`--quante`, default 5,
max 10).

### ✅ `--valida` — Cross-check con fonti reali

```bash
node crea-ricetta.js --valida
```

Per ogni ricetta cerca fonti autorevoli via SerpAPI, ne estrae gli
ingredienti e calcola un punteggio di confidenza, salvando un report
`.validazione.md` accanto alla ricetta.

### 🔬 `--verifica` — Verifica qualità con l'AI

```bash
node crea-ricetta.js --verifica
node crea-ricetta.js --verifica-ricetta ricette/pizza/napoletana.json
node crea-ricetta.js --verifica --forza     # ignora la cache
```

Claude fa da tecnologo alimentare su dosi, temperature, tempi, setup,
cottura e glossario. La cache si basa sull'hash dei file: una ricetta non
modificata viene saltata.

> Entrambi cercavano file `.html`, che sul sito non esistono più: finivano in
> due secondi senza nominare nessuna ricetta e stampavano `Media: NaN/100`,
> cioè dicevano di aver controllato tutto senza aver aperto niente (punto 12
> del [CHECKUP](./CHECKUP.md)). **Risolto:** l'elenco lo costruisce ora
> `elencaRicetteJson`, esportata da `src/verify.js` e usata sia da
> `verifyAllRecipes` (stesso file) sia da `validateAllRecipes` in
> `src/validator.js`, e un elenco vuoto è un errore esplicito invece di un
> riepilogo vuoto.

### 🔄 `--sync-cards` — Ricostruisce `public/recipes.json`

```bash
node crea-ricetta.js --sync-cards
```

Rilegge i JSON delle ricette e ricostruisce l'indice della homepage. Utile
dopo modifiche o cancellazioni manuali.

### 🖼️ `--aggiorna-immagini` e `--refresh-image`

```bash
node crea-ricetta.js --aggiorna-immagini              # tutte
node crea-ricetta.js --aggiorna-immagini --nome "focaccia"
node crea-ricetta.js --refresh-image focaccia-barese  # solo la copertina
```

Provider in cascata, scoring sui risultati (keyword food obbligatorie,
penalità non-food, bonus landscape/hi-res), deduplica tramite
`data/used-images.json`.

### 📖 `--trascrivi-philips` / 📸 `--trascrivi-immagini`

Digitalizzazione del ricettario Philips Pasta Maker Serie 7000: dai PDF in
`public/pdf/` oppure da immagini PNG passando per l'OCR locale Surya
(PyTorch + CUDA). Deduplica su slug, titolo fuzzy e indice delle pagine già
processate (`data/image-process-index.json`).

---

## Flag Globali

| Flag | Descrizione |
|---|---|
| `--preview` | Riepilogo + apertura nel browser, conferma prima di pubblicare |
| `--dry-run` | Mostra il JSON senza scrivere file |
| `--verbose` / `-v` | Output dettagliato |
| `--quiet` / `-q` | Output minimale (solo errori) |
| `--no-image` | Salta ricerca e download immagini |
| `--no-inject` | Salta l'inserimento diretto della card in `public/recipes.json` |
| `--no-valida` (o `--no-validate`) | Salta il cross-check con le fonti |
| `--no-enrich` | Salta l'arricchimento SerpAPI + Claude in `--trascrivi-immagini` |
| `--keepExisting` | Non sovrascrive una ricetta già presente: la salva come `<slug>-v2` |
| `--forza` | Ignora la cache di verifica |
| `--output <path>` | Percorso del repo del sito, alternativo a `RICETTARIO_PATH` |

> **`--no-valida` è l'unico modo per non spendere in validazione.** Il
> cross-check chiama SerpAPI e Claude, e `--dry-run` **non** lo evita: salta
> le scritture, non le chiamate a pagamento.
>
> Per un periodo l'help scriveva `--no-valida` mentre il codice leggeva solo
> `--no-validate`, quindi la forma documentata non spegneva niente. Oggi
> `publishRecipe` in `src/publisher.js` accetta entrambe
> (`skipValidation = !!(args['no-valida'] || args['no-validate'])`): scrivi
> quella che preferisci.
>
> Vale per la pipeline di pubblicazione. L'altra spesa a chiamata sta in
> `--trascrivi-immagini`, dove l'arricchimento SerpAPI + Claude è governato da
> un flag suo, `--no-enrich` (`trascriviImmagini` in
> `src/commands/trascrivi.js`).

> `--no-inject` salta solo `injectCard`, cioè l'aggiunta immediata della card
> all'indice. `public/recipes.json` viene comunque rigenerato subito dopo dal
> passo `sync-cards` di `publishRecipe` (`src/publisher.js`, la chiamata
> `await syncCards({})` che segue l'inject), che rilegge tutte le ricette:
> il flag non tiene la ricetta fuori dall'indice, evita solo la doppia
> scrittura.

---

## Struttura

```
crea-ricetta.js          ← Dispatcher CLI
dashboard.js             ← Avvio dashboard web (porta 3500)
deploy.bat               ← Controlli → commit → push → deploy (vedi sotto)
│
├── src/commands/        ← Un file per comando CLI
│   genera.js · testo.js · scopri.js · trascrivi.js · valida.js
│   verifica.js · sync-cards.js · immagini.js · refresh-image.js
│
├── src/                 ← Motore condiviso CLI + dashboard
│   publisher.js         ← Pipeline unificata (validazione → JSON → indice)
│   scraper.js           ← Estrazione da URL (JSON-LD / CSS / Puppeteer)
│   enhancer.js          ← Riscrittura e strutturazione con l'AI
│   prompt-templates.js  ← Prompt riusati dai vari flussi
│   recipe-schema.js     ← Schema della ricetta
│   image-finder.js      ← Ricerca immagini multi-provider con scoring
│   image-picker.js      ← Selezione immagine
│   injector.js          ← Aggiornamento di public/recipes.json
│   validator.js         ← Cross-check con fonti reali
│   verify.js            ← Verifica qualità con l'AI
│   quality.js           ← Punteggi qualità (indice per i badge)
│   sensory.js           ← Profilo sensoriale
│   seo-keywords.js      ← Keyword e volumi di ricerca
│   discovery.js         ← Ricerca ricette su Google
│   ocr.js               ← Bridge Node → Python (Surya OCR locale)
│   constants.js         ← Percorsi e costanti condivise
│
├── src/utils/           ← api.js (client Claude/Gemini, con retry e
│                          rotazione delle chiavi) · logger.js (livelli
│                          di log, --verbose / --quiet)
│
├── src/server/          ← Dashboard lato server
│   index.js · routes.js · ws-handler.js
│   routes/ (recipes, image, quality, categories, seo, settings)
│
├── src/dashboard/       ← Dashboard lato browser (HTML/CSS/JS senza build)
│   index.html · dashboard.js · modules/ · editor/
│
├── data/                ← Cache e indici locali
│   image-cache.json · used-images.json · verify-index.json
│   quality-index.json · seo-cache.json · image-process-index.json
│   ocr-*.json · backup-ricette/ · logs/
│
├── archive/             ← Script dismessi, tenuti solo come storia. Non
│                          fanno parte della pipeline: non lanciarli.
│
├── scripts/             ← Manutenzione, non pipeline
│   check-env.mjs        ← npm run check:env (allineamento .env / README)
│
└── ocr-surya.py         ← OCR locale (Surya + CUDA)
```

**Tutti i percorsi sono ancorati al modulo, non alla cartella di lancio.**
`quality-index.json` stava nella radice di `tools/` e `src/quality.js` lo
cercava con `resolve(process.cwd(), ...)`: avviando la dashboard da un'altra
cartella l'indice veniva ricreato vuoto altrove e i badge di qualità
scomparivano senza nessun errore. Ora sta in `data/` come gli altri, risolto a
partire da `import.meta.url`. Se aggiungi un indice, fai lo stesso: `cwd()` non
è una posizione, è una coincidenza.

---

## Output prodotto

| File | Posizione (nel repo del sito) | Contenuto |
|---|---|---|
| **Ricetta** | `ricette/<categoria>/<slug>.json` | Dati strutturati della ricetta |
| **Indice** | `public/recipes.json` | Metadati per la homepage — **generato**, non modificarlo a mano |
| **Immagine** | `public/images/ricette/<categoria>/<slug>.webp` (+ `.avif`) | Foto di copertina, già ottimizzata |
| **Report validazione** | `ricette/<categoria>/<slug>.validazione.md` | Cross-check con le fonti |
| **Report verifica** | `ricette/<categoria>/<slug>.verifica.md` | QA tecnica dell'AI |

I file `.backup.json` e `.pre-edit.json` che trovi accanto alle ricette sono
copie di sicurezza scritte prima di una modifica. Il sito le ignora.

---

## Pubblicazione

**Il push su `main` non pubblica niente.** GitHub Pages serve dal branch
`gh-pages`, che viene aggiornato solo da `npm run deploy` dentro il repo del
sito — e quel comando è preceduto da `npm run check`, il cancello che
verifica dati, build e pre-rendering.

Il flusso completo (controlli → revisione → commit → push → deploy) sta in
[`deploy.bat`](./deploy.bat), qui dentro `tools/`:

```bat
deploy.bat "aggiunta focaccia genovese"
```

Senza argomenti il messaggio di commit te lo chiede (serve per il doppio
clic, che argomenti non ne può passare). L'ordine è: `npm run check` →
`git status` dei due repo con conferma → commit e push → `npm run deploy`.
Se salta qualcosa — controlli, `git add`, commit, **push** o deploy — si
ferma lì e te lo dice: non arriva mai a scrivere "pubblicato" quando non lo
è.

### Il pulsante Deploy (e perché non va cancellato niente)

Nella cartella **sopra** i due repo (`Progetti personali\Ricettario\`) c'è
`Deploy.exe`: un launcher .NET di venti righe (sorgente `DeployLauncher.cs`,
compilato da `build-deploy-exe.ps1`) che fa una cosa sola, aprire `cmd /k`
sul `deploy.bat` che trova **accanto a sé**. Il percorso è compilato dentro
l'eseguibile: non è configurabile. Lo stesso script di build crea anche una
scorciatoia `Deploy Ricettario.lnk` sul Desktop che punta all'exe (oggi sul
Desktop non c'è: se la rimetti, vale lo stesso discorso).

Per questo il `deploy.bat` di quella cartella **non va cancellato**. Oggi non
è più il vecchio script: è uno stub di due righe che passa il controllo a
`tools\deploy.bat`. È l'unica cosa che tiene vivo il pulsante — cancellarlo
lascia il doppio clic su una finestra nera che dice "impossibile trovare il
file". Se un giorno vuoi che l'exe punti direttamente qui, cambia la riga 10
di `DeployLauncher.cs` e ricompila; sappi però che `build-deploy-exe.ps1`
ricostruisce anche l'icona a partire da un PNG in una cartella temporanea
che **non esiste più**, quindi lo script si ferma al primo passo così com'è.

> **Cosa faceva il vecchio `deploy.bat`** (fino al 26/07/2026, stessa
> cartella): `git add -A` + `git commit -m "deploy manuale"` + `push` su
> entrambi i repo, e **solo dopo** `npm run deploy` — cioè i controlli
> giravano a commit già spedito. Conseguenze ancora visibili: 73 commit su
> 118 chiamati tutti "deploy manuale", una copia morta della cache
> immagini da 6,9 MB committata in radice (`image-cache.json`, che nessun
> file legge — quella viva è `data/image-cache.json`), e il testo incollato
> di ogni ricetta finito nella storia git (`data/_tmp_testo.txt`, ora
> ignorato).

---

## Requisiti

- **Node.js ≥ 20.18.1** — è il minimo richiesto dalle dipendenze (`cheerio`
  chiede `>=20.18.1`, `pdf-to-img` chiede `>=20`). Il vincolo è dichiarato
  nel campo `engines` di `package.json`.
- **Python 3.13** con PyTorch + Surya — solo per `--trascrivi-immagini`,
  richiede GPU CUDA.
- **Chromium** — scaricato in automatico da Puppeteer per lo scraping.

### Manutenzione

- **Revoca la vecchia `SERPAPI_KEY_2`.** Fino al 26/07/2026 `.env.example`
  conteneva il valore vero di quella chiave invece di un segnaposto. È stato
  tolto, ma toglierlo non la disattiva: resta nella storia di git (commit
  `848f474`, visibile con `git log -p -- .env.example`) ed è tuttora la
  chiave in uso nel `.env` locale. Rigenerala su serpapi.com e aggiorna il
  `.env`; finché non lo fai, quella chiave è pubblica.
- `npm audit` oggi dice **11 vulnerabilità (1 bassa, 2 medie, 7 alte, 1
  critica)**, in buona parte transitive e arrivate da Puppeteer. Lo strumento
  gira in locale e non è esposto, quindi non è un'emergenza, ma vale la pena
  passare `npm audit fix` ogni tanto — e ricordare che `sharp` richiede un
  aggiornamento major.
- **Rilancia `npm install`.** `pdf-poppler` e `slugify` sono stati tolti da
  `package.json` (nessun file del progetto li nominava), ma finché non
  reinstalli restano in `package-lock.json` e soprattutto dentro
  `node_modules/`: `npm ls --depth=0` li marca `extraneous` e `pdf-poppler`
  da solo occupa 87 MB. Non è `npm ci` a rompersi — provato, `npm ci
  --dry-run` con questi due file esce 0 e non li installa: è spazio e
  confusione che restano lì finché non riallinei.
