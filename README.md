# 🔥 Ricettario Tools — `crea-ricetta.js`

CLI professionale per creare, validare e gestire le ricette de **Il Ricettario**.
Combina web scraping, OCR locale, AI (Claude) e ricerca immagini stock per generare pagine HTML complete.

---

## Setup Rapido

```bash
# 1. Installa le dipendenze
cd tools
npm install

# 2. Configura le API keys
cp .env.example .env
# Compila .env con le tue chiavi (vedi sezione API Keys sotto)

# 3. Esegui
node crea-ricetta.js --help
```

### API Keys Necessarie

| Variabile `.env` | Servizio | Obbligatoria | Dove ottenerla |
|---|---|:---:|---|
| `ANTHROPIC_API_KEY` | Claude AI | ✅ | [console.anthropic.com](https://console.anthropic.com) |
| `SERPAPI_KEY` | Google Search | ✅ | [serpapi.com](https://serpapi.com) (100 ricerche/mese gratis) |
| `SERPAPI_KEY_2` | Google Search (rotazione) | ❌ | Opzionale, stesso provider |
| `PEXELS_API_KEY` | Immagini Pexels | ❌ | [pexels.com/api](https://www.pexels.com/api/) |
| `UNSPLASH_ACCESS_KEY` | Immagini Unsplash | ❌ | [unsplash.com/developers](https://unsplash.com/developers) |
| `PIXABAY_API_KEY` | Immagini Pixabay | ❌ | [pixabay.com/api](https://pixabay.com/api/docs/) |
| `RICETTARIO_PATH` | Path output | ❌ | Default: `../Ricettario` |

> Le API immagini sono opzionali ma **almeno una** è consigliata. Il sistema le usa in cascata: Pexels → Unsplash → Pixabay → Wikimedia (senza chiave).

---

## Comandi

### 📥 `--url` — Importa ricetta da URL

Scrappa una ricetta da qualsiasi sito web, la riscrive in stile tecnico con Claude AI, e genera la pagina HTML.

```bash
# Singola ricetta
node crea-ricetta.js --url "https://giallozafferano.it/ricetta/Focaccia.html"

# Batch (più URL separati da virgola)
node crea-ricetta.js --url "https://sito1.it/ricetta1,https://sito2.it/ricetta2"
```

**Come funziona:**
1. **Scraping** del sito (JSON-LD → CSS selettori → browser headless Puppeteer)
2. **Ricerca fonti reali** via SerpAPI (4 query Google IT+EN) per cross-reference
3. **Claude AI** riscrive la ricetta nel formato tecnico del Ricettario
4. **Cross-check** automatico ingredienti vs fonti web (punteggio confidenza)
5. **Immagine stock** cercata e scaricata (Pexels/Unsplash/Pixabay/Wikimedia)
6. **HTML generato** con template completo (hero, ingredienti, procedimenti, glossario...)
7. **`recipes.json`** aggiornato automaticamente (homepage)

---

### 🧠 `--nome` — Genera ricetta da zero

Claude crea una ricetta completa partendo solo dal nome, basandosi su fonti reali trovate online (non dalla memoria).

```bash
node crea-ricetta.js --nome "Focaccia Barese"
node crea-ricetta.js --nome "Pane Cafone" --idratazione 70 --tipo Pane
node crea-ricetta.js --nome "Pizza Napoletana" --note "con poolish al 30%"
```

**Opzioni specifiche:**
- `--idratazione <n>` — Idratazione target in %
- `--tipo <categoria>` — Categoria: `Pane`, `Pizza`, `Pasta`, `Lievitati`, `Dolci`
- `--note <testo>` — Istruzioni aggiuntive per Claude

---

### 📝 `--testo` — Inserisci ricetta da testo libero

Inserisci una ricetta completa che hai già (appunti, note, copia-incolla) e il sistema la adatta al template del sito.

```bash
node crea-ricetta.js --testo ricetta.txt
node crea-ricetta.js --testo pizza-canotto.txt --tipo Pizza
node crea-ricetta.js --testo mia-ricetta.txt --dry-run    # vedi JSON senza scrivere
```

**Come funziona:**
1. Legge il file `.txt` con la tua ricetta completa
2. Cerca fonti reali (SerpAPI) per aggiungere contesto
3. Claude **struttura** il testo nel formato JSON — **senza modificare le tue dosi** (le fonti servono solo per glossario, pro tips, tabella farine)
4. Prosegue col flusso standard (validazione → immagine → HTML → inject)

> ⚠️ Le dosi e gli ingredienti nel tuo testo hanno **priorità assoluta**: Claude non li modifica.

---

### 🔍 `--scopri` — Cerca ricette su Google

Cerca ricette su Google, mostra i risultati, e ti fa scegliere quali generare.

```bash
node crea-ricetta.js --scopri "focaccia pugliese"
node crea-ricetta.js --scopri "pizza in teglia" --quante 8
```

**Interazione:**
```
📋 Trovate 5 ricette:
  1. Focaccia Pugliese — giallozafferano.it
  2. La vera focaccia barese — ricettedellanonna.net
  ...

👉 Quale vuoi generare? (numero, o "tutti", o "esci"): 1,3
```

- `--quante <n>` — Numero risultati (default: 5, max: 10)

---

### ✅ `--valida` — Cross-check con fonti reali

Valida **tutte** le ricette esistenti confrontandole con fonti web autorevoli.

```bash
node crea-ricetta.js --valida
```

**Cosa fa:**
- Per ogni ricetta HTML in `ricette/**/`:
  - Cerca 10+ fonti reali via SerpAPI (4 query parallele IT+EN)
  - Scrappa ingredienti da ogni fonte (JSON-LD / HTML / Claude AI fallback)
  - Confronta: ingredienti match, idratazione, tempi
  - Calcola un **punteggio di confidenza** (0-100%)
- Genera report `.validazione.md` accanto a ogni ricetta
- Riepilogo finale con media confidenza

**Output:**
```
🟢 85% — Pane alle Noci e Olive
🟡 62% — Focaccia Barese
🔴 41% — Pizza in Teglia
```

---

### 🔬 `--verifica` — Verifica qualità con Claude AI

Claude agisce da **tecnologo alimentare** e verifica la correttezza tecnica di ogni ricetta.

```bash
# Tutte le ricette
node crea-ricetta.js --verifica

# Singola ricetta
node crea-ricetta.js --verifica-ricetta ricette/pizza/napoletana.html

# Forza ri-verifica (ignora cache)
node crea-ricetta.js --verifica --forza
```

**Cosa verifica Claude:**
| Area | Controlli |
|------|-----------|
| Dosi | Rapporti farina/acqua, % lievito, sale |
| Temperature | Max 280°C per forni casalinghi |
| Tempi | Coerenza lievitazione vs quantità lievito |
| Setup | Spirale/Estrusore/Mano appropriato per categoria |
| Cottura | Sezione presente per pane/pizza con pietra refrattaria, vapore |
| Glossario | Identifica termini tecnici non spiegati |

**Cache intelligente:** usa un indice con hash MD5 dei file. Se la ricetta non è stata modificata, la salta (usa `--forza` per ri-verificare).

---

### 🔄 `--sync-cards` — Ricostruisce `recipes.json`

Scannerizza tutti i file HTML in `ricette/` e ricostruisce il database JSON da zero.

```bash
node crea-ricetta.js --sync-cards
```

**Quando usarlo:**
- Dopo aver modificato/cancellato manualmente dei file HTML
- Se `recipes.json` è disallineato o corrotto
- Dopo un batch di operazioni

Estrae da ogni HTML: titolo, slug, categoria, emoji, immagine, idratazione, temperatura, tempo, setup.

---

### 🖼️ `--aggiorna-immagini` — Scarica/aggiorna immagini

Cerca e scarica immagini stock per le ricette.

```bash
# Tutte le ricette
node crea-ricetta.js --aggiorna-immagini

# Singola ricetta (per slug o parte del nome)
node crea-ricetta.js --aggiorna-immagini --nome "focaccia"
```

**Provider in cascata:** Pexels → Unsplash → Pixabay → Wikimedia Commons

Ogni immagine è:
- Cercata con query intelligenti (traduzione IT→EN, keywords AI)
- Filtrata con scoring: food-keywords obbligatori, penalità non-food, bonus landscape/hi-res
- Deduplicata (nessuna immagine riusata tra ricette)
- Salvata in `public/images/ricette/<categoria>/<slug>.jpg`

---

### 📖 `--trascrivi-philips` — Trascrivi PDF Philips

Trascrivi i PDF del ricettario Philips Pasta Maker Serie 7000.

```bash
node crea-ricetta.js --trascrivi-philips
```

Legge i PDF da `public/pdf/`, li divide in batch di 5 pagine, e usa Claude Vision per estrarre le ricette.

---

### 📸 `--trascrivi-immagini` — Trascrivi immagini Philips

Pipeline completa per digitalizzare il ricettario Philips da immagini PNG:

```bash
node crea-ricetta.js --trascrivi-immagini
node crea-ricetta.js --trascrivi-immagini --no-image --no-enrich  # veloce, senza extra
```

**Pipeline 3 step:**
1. **OCR locale** con Surya (PyTorch GPU CUDA) → estrae testo da tutte le immagini
2. **Batch a Claude** (10 pagine + 2 overlap per batch) → struttura in JSON
3. **Per ogni ricetta**: deduplicazione → arricchimento SerpAPI → immagine → HTML → inject

**Deduplicazione a 3 livelli:**
- Slug identico (su disco o nel run corrente)
- Fuzzy match titolo (normalizzazione + 70% overlap parole)
- Indice pagine già processate (`data/image-process-index.json`)

---

## Flag Globali

Questi flag funzionano con **tutti** i comandi:

| Flag | Descrizione |
|------|-------------|
| `--dry-run` | Mostra il JSON generato senza scrivere file |
| `--verbose` / `-v` | Output dettagliato (mostra debug) |
| `--quiet` / `-q` | Output minimale (solo errori) |
| `--no-image` | Salta la ricerca e il download di immagini |
| `--no-inject` | Non aggiunge la card a `recipes.json` |
| `--no-validate` | Salta il cross-check con fonti reali |
| `--output <path>` | Percorso output custom per il Ricettario |

---

## Architettura Moduli

```
crea-ricetta.js          ← Dispatcher CLI
│
├── src/commands/
│   ├── genera.js        ← Flusso principale (URL / nome)
│   ├── testo.js         ← Inserimento da testo libero
│   ├── scopri.js        ← Ricerca Google + selezione interattiva
│   ├── trascrivi.js     ← OCR Philips (PDF + immagini)
│   ├── valida.js        ← Cross-check fonti reali
│   ├── verifica.js      ← QA con Claude AI
│   ├── sync-cards.js    ← Ricostruzione recipes.json
│   └── immagini.js      ← Download immagini stock
│
├── src/
│   ├── scraper.js       ← Estrazione dati da URL (JSON-LD / CSS / Puppeteer)
│   ├── enhancer.js      ← Claude AI: rewriting + strutturazione ricette
│   ├── template.js      ← Generatore HTML dal JSON strutturato
│   ├── image-finder.js  ← Ricerca immagini multi-provider con scoring
│   ├── injector.js      ← Aggiornamento recipes.json
│   ├── validator.js     ← SerpAPI search + scraping fonti + confronto
│   ├── verify.js        ← Verifica qualità Claude + trascrizione PDF
│   ├── ocr.js           ← Bridge Node → Python (Surya OCR locale GPU)
│   └── discovery.js     ← Ricerca ricette su Google
│
├── src/utils/
│   ├── api.js           ← Wrapper Claude API (retry, streaming, JSON parser)
│   └── logger.js        ← Logger CLI con livelli e colori
│
├── data/                ← Cache e indici
│   ├── ocr-results.json
│   ├── verify-index.json
│   └── image-process-index.json
│
└── ocr-surya.py         ← Script Python per OCR locale (Surya + CUDA)
```

---

## Output Generato

Per ogni ricetta, il sistema produce:

| File | Posizione | Contenuto |
|------|-----------|-----------|
| **HTML** | `ricette/<categoria>/<slug>.html` | Pagina completa con hero, ingredienti, procedimenti, glossario |
| **Immagine** | `public/images/ricette/<categoria>/<slug>.jpg` | Foto stock scaricata |
| **Entry JSON** | `public/recipes.json` | Metadati per il listing in homepage |
| **Report validazione** | `ricette/<categoria>/<slug>.validazione.md` | Cross-check con fonti |
| **Report verifica** | `ricette/<categoria>/<slug>.verifica.md` | QA tecnica Claude |

### Struttura JSON Ricetta

Il JSON interno generato da Claude ha questa struttura:

```jsonc
{
  "title": "Pizza Contemporanea Canotto",
  "slug": "pizza-contemporanea-canotto",
  "emoji": "🍕",
  "description": "Meta description per SEO (max 160 char)",
  "subtitle": "Biga 30% | Idratazione 72% | Blend Nuvola-Saccorosso",
  "category": "Pizza",           // Pane | Pizza | Pasta | Lievitati | Dolci
  "hydration": 72,
  "targetTemp": "23°C",
  "fermentation": "~24h",
  "totalFlour": 3000,
  "ingredients": [
    { "name": "Farina", "note": "(nota tecnica)", "grams": 1800,
      "setupNote": { "spirale": "ghiacciata 2-4°C", "mano": "20-22°C" } }
  ],
  "suspensions": [               // Opzionale: noci, olive, uvetta...
    { "name": "Olive", "note": "(denocciolate)", "grams": 160 }
  ],
  "stepsSpiral": [               // Pane/Pizza: impastatrice a spirale
    { "title": "Autolisi", "text": "Descrizione dettagliata..." }
  ],
  "stepsHand": [                 // Pane/Pizza: procedimento a mano
    { "title": "Impasto", "text": "..." }
  ],
  "stepsExtruder": [             // Pasta: estrusore Philips
    { "title": "Setup", "text": "Montare la trafila..." }
  ],
  "stepsCondiment": [            // Opzionale: sugo/salsa di accompagnamento
    { "title": "Preparazione", "text": "..." }
  ],
  "flourTable": [                // Consigli farine
    { "type": "Tipo 0", "w": "260-280", "brands": "Caputo, Molino Grassi" }
  ],
  "baking": {                    // Pane/Pizza: sezione cottura
    "temperature": "250°C",
    "time": "25-30 minuti",
    "tips": ["Preriscaldare pietra refrattaria 45 min", "Vapore primi 10 min"]
  },
  "glossary": [                  // Termini tecnici
    { "term": "Autolisi", "definition": "Riposo farina+acqua senza lievito..." }
  ],
  "alert": "Testo dell'alert professionale (cosa NON fare)",
  "proTips": ["Tip 1", "Tip 2"],
  "imageKeywords": ["neapolitan pizza artisan", "pizza dough"],
  "tags": ["Pizza", "Biga", "Lievitazione lunga"]
}
```

---

## Esempi Completi

```bash
# Importa una ricetta da GialloZafferano
node crea-ricetta.js --url "https://giallozafferano.it/ricetta/Focaccia.html"

# Genera una pizza con parametri specifici
node crea-ricetta.js --nome "Pizza Napoletana" --idratazione 65 --tipo Pizza

# Inserisci la tua ricetta personale
node crea-ricetta.js --testo mia-pizza.txt --tipo Pizza

# Cerca e genera ricette di pasta
node crea-ricetta.js --scopri "orecchiette pugliesi" --quante 5

# Batch: importa 3 ricette in sequenza
node crea-ricetta.js --url "url1,url2,url3"

# Solo preview JSON (senza scrivere file)
node crea-ricetta.js --nome "Ciabatta" --dry-run

# Genera senza immagini e senza validazione (veloce)
node crea-ricetta.js --nome "Pane Cafone" --no-image --no-validate

# QA completa del ricettario
node crea-ricetta.js --valida
node crea-ricetta.js --verifica

# Ricostruisci l'indice dopo modifiche manuali
node crea-ricetta.js --sync-cards

# Aggiorna tutte le immagini
node crea-ricetta.js --aggiorna-immagini
```

---

## Requisiti

- **Node.js** ≥ 18 (usa `fetch` nativo e `import.meta`)
- **Python** 3.13 con PyTorch + Surya (solo per `--trascrivi-immagini`, richiede GPU CUDA)
- **Chromium** (scaricato automaticamente da Puppeteer per lo scraping browser)
