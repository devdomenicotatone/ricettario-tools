# Checkup — Ricettario Tools Dashboard

> **STATO — aggiornato 27/07/2026. Il rapporto qui sotto è STORIA: quasi tutto
> è chiuso.** Non usarlo come lista di lavoro, usalo per capire *perché* il
> codice è fatto così adesso.
>
> **CHIUSI, tutti e 26 i punti numerati.** Prima (`43d821a`, `7437a9f`,
> `8aa0766`, `97bf775`, `5746a25`, `e4bc373`, `d622b10`): 1, 2, 3, 4, 5, 6, 7,
> 11. Poi, in due giri (`7f46aa5` → `846072d`): 8, 9, 10, 12, 13, 14, 15, 16,
> 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, più tutte le voci della sezione
> "Minori" tranne quelle elencate sotto.
>
> **Verificato eseguendo, non leggendo.** Il checkup originale ammetteva che
> «tutto l'audit è statico, 8 dimensioni su 8 dichiarano di non aver eseguito
> nulla». Adesso: server avviato davvero (bind su `127.0.0.1`, IP LAN
> irraggiungibile; POST con `Origin` estranea → 403, POST urlencoded → 403,
> WebSocket con `Origin` estranea o assente → 403, corpo JSON malformato → 400);
> `--dry-run` misurato con `git status` prima e dopo; `npm run check` del sito
> verde; crediti CC presenti nell'HTML **statico** di tutte e cinque le ricette.
>
> **Il difetto peggiore non era in questa lista.** `src/commands/trascrivi.js`
> salvava ogni ricetta trascritta in `ricette/pasta/`, la categoria che il sito
> ha rinominato Primi: alla prima trascrizione `npm run check` del sito si
> sarebbe fermato e non si sarebbe pubblicato più niente. Era il punto 5 in un
> file che nessuno stava guardando. Lezione: **spartirsi il lavoro per file
> lascia scoperto quello che sta fra i file.**
>
> **Le fonti uniche adesso esistono** (`7f46aa5`): l'indice foto, i percorsi
> delle ricette, i backup e l'escape HTML hanno un modulo ciascuno in
> `src/utils/` e `src/dashboard/modules/escape.js`. Prima erano rispettivamente
> tre, nove, due e due copie divergenti. Se ti serve una di quelle logiche,
> **importala**: è il difetto che questo checkup denunciava a ogni pagina.
>
> **Punto 10 chiuso del tutto (27/07).** Il default è invertito: se la ricetta
> esiste, il comando **si ferma senza scrivere niente e senza spendere**, e dice
> come procedere. Rimpiazzare vuole `--sovrascrivi` (con copia di sicurezza),
> tenere entrambe vuole `--keepExisting` (salva `-v2`, che però finisce online).
> In dashboard è una tendina sola con tre voci, presente in tutti e **quattro** i
> flussi — non tre: "Scopri" passa da `/api/genera`, e `/api/testo` e
> `/api/scopri` non leggevano affatto la scelta.
>
> **86 copie di sicurezza rimosse dal repo del sito (27/07).** Prima di
> cancellarle: nessun codice le leggeva, 84 su 86 erano identiche o più povere
> della ricetta viva, e le 2 orfane erano versioni precedenti di ricette
> rinominate (le attuali sono più ricche). Erano tracciate, quindi restano nella
> storia git. Gli 83 `.qualita.md` e i 68 `.validazione.md` **non** sono backup e
> restano: `routes/quality.js` ci pesca il report che la dashboard mostra.
>
> **RESTA APERTO, per scelta:**
> - **Nessun lock fra processi distinti** (dashboard + CLI insieme). Dentro un
>   processo gli indici sono protetti, fra due processi no. Rischio basso.
> - **Nessun CI.** Richiede una decisione tua, non è un guasto.
>
> **Mai coperto:** un checkup del repo del **sito** (`../Ricettario`) con lo
> stesso metodo. Ha senso ora che i dati non gli arrivano più sporchi da qui.

Lo strumento è messo meglio di quanto la lista qui sotto faccia sembrare: la pipeline di generazione funziona, la dashboard è comoda, i job hanno un terminale in diretta, e il progetto ha già dentro di sé le soluzioni giuste (c'è una funzione di escape in `seo.js`, c'è un mutex, c'è un backup nell'editor) — solo che non sono state applicate ovunque. Il tema di fondo dei problemi è uno solo, ripetuto in forme diverse: **la dashboard e il sito si sono parlati per copia**. Ogni volta che `tools` scrive nel repo del sito, o si porta dietro una sua copia di un elenco che il sito ha già, prima o poi le due versioni divergono e il guasto salta fuori lontano dal punto in cui è nato — spesso con un messaggio d'errore che punta altrove. Il secondo tema, minore ma diffuso, è che lo strumento è stato scritto dando per scontato che i dati in ingresso siano puliti: testo dal web, risposte dei modelli AI, richieste dal browser, entrano senza controlli. Nessuno di questi problemi ha ancora fatto danni gravi, e quasi tutto è recuperabile con git — ma tre cose possono bloccare del tutto la pubblicazione del sito, e una fa perdere il tuo lavoro in silenzio.

---

## Da sistemare subito

**1. Aggiungere una categoria dalla dashboard blocca la pubblicazione del sito** *(trovato due volte, da due angoli diversi: rottura del contratto col sito e igiene del codice — ha peso doppio)*
Il pulsante "aggiungi categoria" scrive una riga dentro `js/categories.js` del sito, ma le mancano due campi obbligatori: `dir` (la cartella) e `unicode` (l'emoji). Il file resta valido a vederlo, la dashboard dice "creata con successo", e il guasto esplode dopo, in un altro repo: `npm run check` muore al primo comando con "The paths[1] argument must be of type string", che non nomina né la categoria né la dashboard. Da quel momento non pubblichi più nulla, nemmeno una correzione urgente su un'altra ricetta.
`src/server/routes/categories.js:277`
Aggiungi i due campi al template: `dir: '${slug}'` e `unicode: '${metadata.unicodeEmoji}'` — il valore unicode è già disponibile poche righe sopra, alla 261.

**2. Rimuovere una categoria svuota l'intero elenco delle categorie del sito** *(anche questo trovato due volte, da "server" e da "contratto-sito")*
La funzione che ripulisce il registry cancella la **riga intera** che contiene il nome. Ma nel sito tutte e nove le categorie stanno su una riga sola, quindi togliendone una le togli tutte: `CATEGORY_ORDER` resta vuoto. Verificato con una simulazione: succede per 8 categorie su 9. Il job dice "🎉 Categoria rimossa con successo" e sul momento non si vede niente di rotto.
`src/server/routes/categories.js:477`
Non cancellare la riga: togli solo l'elemento (sostituisci `'chiave',` con stringa vuota dentro la riga). E dopo la scrittura rileggi il file: se il numero di categorie non è calato esattamente di una, fermati.

**3. Il backup della categoria rimossa blocca anche lui la pubblicazione**
Stesso pulsante del punto 2, guasto diverso e indipendente: il backup viene salvato in `ricette/.backup/`, cioè dentro la cartella che per il sito contiene solo categorie. Al primo `npm run check` arriva «ricette/.backup/ non è dichiarata in js/categories.js» ed esce con errore — e non pubblichi più niente finché non sposti la cartella. Peggio: la cartella viene creata sempre, anche rimuovendo una categoria vuota.
`src/server/routes/categories.js:407`
Scrivi il backup fuori dal repo del sito, per esempio in `tools/data/backup-categorie/`. Nel repo del sito ogni cartella dentro `ricette/` è, per contratto, una categoria.

**4. Le modifiche fatte mentre un salvataggio è in corso ti spariscono, con scritto "✓ Salvata"**
L'editor salva da solo 1,5 secondi dopo l'ultima modifica. Mentre la richiesta viaggia, quello che continui a scrivere non entra nel salvataggio — ma al ritorno il codice dichiara "salvato" tutto il contenuto attuale e azzera il segnale di modifiche pendenti. Il salvataggio successivo trova "niente da fare" ed esce. Il testo resta solo a schermo, la pillola dice "✓ Salvata", sul disco non c'è. Nessun backup lo contiene, perché non è mai stato inviato.
`src/dashboard/editor/editor-state.js:123`
Fotografa la ricetta prima di inviarla (`JSON.parse(JSON.stringify(...))`) e usa quella copia come riferimento al ritorno; poi riconfronta col contenuto attuale e, se differiscono, rilancia subito un altro salvataggio.

**5. La dashboard conosce "Pasta", che sul sito non esiste più, e ignora "Primi"** *(segnalato da tre dimensioni diverse: contratto-sito, immagini, igiene)*
Il sito ha rinominato Pasta in Primi mesi fa. La dashboard no: "Pasta" è ancora in `constants.js`, nei menu a tendina, nella barra SEO, nell'injector — e soprattutto nell'elenco che finisce dentro il prompt dell'AI, quindi è l'AI stessa a essere istruita a classificare i piatti come "Pasta". Risultato: la ricetta finisce in `ricette/pasta/`, e `npm run check` si ferma perché quella cartella non è dichiarata. Come prova che la strada giusta esiste già: l'editor della dashboard legge l'elenco vero dal sito, quindi due tendine della stessa app mostrano due liste diverse.
`src/constants.js:11` (e a cascata `src/publisher.js:26`, `src/injector.js:29`)
Togli l'elenco locale e importa `CATEGORIES` da `Ricettario/js/categories.js`, come già fa l'editor; deriva da lì cartelle ed emoji, e riempi le tendine via JavaScript invece di scriverle a mano nell'HTML.

**6. Il server è aperto a tutta la rete WiFi e non chiede nessuna password**
`server.listen(port, ...)` senza indirizzo significa "ascolta su tutte le schede di rete", non solo sul tuo PC. Non c'è nessuna autenticazione: chiunque sulla stessa rete apre `http://tuo-ip:3500` e ha la tua dashboard, può cancellare ricette, far partire generazioni che consumano il tuo credito API e scaricarsi i PDF sorgente. Sul tuo PC la regola del firewall per Node è già aperta sul profilo "Pubblico", cioè proprio il WiFi del bar o del coworking: non serve nemmeno un passaggio in più. Le chiavi API non sono esposte e le ricette si recuperano da git, ma il credito bruciato no.
`src/server/index.js:60`
Una parola: `server.listen(port, '127.0.0.1', () => {`. Il browser che apri in locale continua a funzionare identico.

---

## Da sistemare presto

**7. Nessuno controlla se la risposta dell'AI è stata tagliata a metà**
Il codice legge il testo della risposta e lo restituisce, senza mai guardare `stop_reason`, cioè il campo con cui l'API dice "ho smesso perché ho finito i token". Una risposta troncata viene trattata come completa. Peggio di come sembra: un array tagliato non produce nessun errore — il parser di recupero estrae il primo oggetto, il chiamante vede "nessuna ricetta trovata", marca le pagine come fatte e le ricette perse non sono più recuperabili. Zero avvisi, e la chiamata l'hai pagata per intero. Il wrapper è condiviso da una decina di punti.
`src/utils/api.js:67`
Dopo `finalMessage()` controlla `message.stop_reason`: se è `'max_tokens'` lancia un errore esplicito, se è `'refusal'` segnalalo come tale. E cerca il primo blocco di tipo `text` invece di dare per scontato `content[0]`.

**8. Un sito web qualsiasi può cancellarti le ricette mentre navighi**
C'è un parser (`express.urlencoded`) che fa accettare al server i dati di un normale modulo HTML. Il tuo frontend non lo usa mai (manda solo JSON). Quel parser però apre una porta che il browser non chiude: una pagina ostile può inviare in silenzio un modulo a `/api/elimina` o chiamare `/api/genera` venti volte bruciandoti decine di euro. Serve un attaccante che conosca proprio questo strumento, quindi è improbabile — ma la correzione è togliere una riga che nessuno usa.
`src/server/index.js:23`
Cancella quella riga. In più, scarta all'ingresso ogni POST il cui header `Origin` non sia `http://localhost:3500`.

**9. `--dry-run` scrive davvero i file: sovrascrive la ricetta e scarica l'immagine**
Il flag è documentato come "mostra il JSON senza scrivere file", ma il controllo è messo troppo in fondo: quando scatta, il file `.json` della ricetta è già stato riscritto e l'immagine già scaricata. Guardi una ricetta "solo per vedere com'è", la scarti perché non ti piace, e intanto quella vecchia è già stata cancellata. Recuperabile con git (compare in `git status`), ma è l'unica protezione dichiarata dello strumento e non protegge.
`src/publisher.js:272` (il controllo sta alla 293)
Sposta il blocco `if (args['dry-run'])` prima della ricerca immagine (attorno alla riga 225), oppure fai in modo che dry-run implichi `skipImage` e `skipJson`.

**10. Rigenerare una ricetta esistente la cancella e la riscrive, senza copia di sicurezza**
Il salvataggio è una scrittura secca. L'unica protezione è la casella "Mantieni esistente", che è vuota all'apertura, non è nell'help della CLI e in due dei tre flussi di creazione ("Da URL" e "Da testo") non viene nemmeno inviata al server. Tutti gli altri punti che modificano una ricetta fanno prima una copia (`.pre-edit.json`, `.backup.json`): la generazione no. Le correzioni già committate si recuperano da git, quelle recenti no.
`src/publisher.js:50` e `:272`
Prima della scrittura, se il file esiste già copialo in `<slug>.pre-gen.json`. E inverti il default: proteggere sempre, chiedere `--sovrascrivi` per rimpiazzare.

**11. `sync-cards` sostituisce la data di creazione di 17 ricette con la data di modifica**
Per 17 ricette su 80 la vera data di creazione esiste solo dentro `recipes.json` (il generatore del sito lo sa e la recupera da lì). `sync-cards` invece se la inventa dalla data del file e la scrive nell'indice; al `check` successivo il sito la fissa. Cinque ricette sono già in questa condizione e si corrompono alla prossima esecuzione, che parte a ogni salvataggio dall'editor. Conseguenza: Google vede 17 ricette con date sbagliate e l'ordinamento "per novità" si scombina. Recuperabile da git, ma il diff non lo fa notare.
`src/commands/sync-cards.js:31`
Fai come il generatore del sito: leggi il `recipes.json` esistente, costruisci una mappa slug → `_createdAt` e usa quella come ripiego. La data del file solo per una ricetta davvero nuova.

**12. `--verifica` e `--valida` girano a vuoto e dicono di aver finito**
Cercano file `.html`, che sul sito non esistono più da quando è diventato una SPA (oggi ci sono 166 `.json` e zero `.html`). Verificato eseguendoli: finiscono in due secondi, non stampano nessuna ricetta, chiudono con "Media: NaN/100" e "Report salvati", che è falso. Chi li lancia crede di aver controllato la qualità di tutto il ricettario. La funzione che verifica *una* ricetta è già stata aggiornata al JSON: è rimasta indietro solo quella che cerca i file.
`src/verify.js:467` (e `src/validator.js:856`)
Fai leggere i `.json` (`verifyRecipe` li gestisce già), escludendo `.backup.` e `.pre-`. E se l'elenco è vuoto, fermati con un errore invece di stampare NaN. Se invece consideri questi comandi superati dalla pipeline "qualità" della dashboard, toglili dall'help.

**13. Le foto Wikimedia/Openverse con licenza CC sono pubblicate senza i crediti obbligatori**
Il testo dei crediti viene costruito correttamente e salvato nel JSON come `imageAttribution`, ma non arriva mai al sito: non è nei campi che finiscono in `recipes.json` e nessun file del sito lo legge. Oggi 5 ricette pubblicate usano foto CC che i crediti li richiedono sempre (maionese, cantuccini-di-prato, focaccia-barese, focaccia-di-recco-igp, pinsa-romana). È una violazione dei termini d'uso e l'autore può chiederne la rimozione — la CC BY 2.0 della maionese decade automaticamente in caso di inadempimento.
`src/image-finder.js:605`
Fai passare `imageAttribution` in `scripts/build-recipes.js` sul sito e mostralo in una `figcaption` sotto la foto. Il testo c'è già: sono pochi minuti. Meglio se aggiungi anche link alla pagina d'origine e URL della licenza, che la CC BY-SA richiede.

**14. I risultati di Google finiscono nella pagina come HTML**
Il pannello "Scopri Ricette" incolla titolo, fonte e snippet dei risultati Google dentro la pagina senza ripulirli. Quel testo è scritto dal proprietario del sito trovato: se contiene codice HTML, il browser lo esegue come se l'avessi scritto tu — e da dentro la dashboard può chiamare qualsiasi rotta, `/api/elimina` compresa, senza che tu clicchi niente. Serve però che un attaccante si piazzi nella top-10 di Google: è un attacco a strascico, non mirato a te.
`src/dashboard/modules/commands.js:102`
Esiste già la funzione giusta nel progetto: `escapeHtml` in `src/dashboard/modules/seo.js:106`. Passaci title, source, snippet e url. È una riga.

**15. Titoli e descrizioni delle ricette (scritti dall'AI) vengono inseriti come HTML**
Stessa dimenticanza del punto 14, in altri due posti: le schede in "Le mie Ricette" e il selettore immagini. I titoli delle ricette li scrive l'AI leggendo pagine web scaricate; i titoli e gli autori delle foto arrivano da Pexels/Unsplash/Pixabay/Wikimedia, cioè da sconosciuti, senza nessun modello di mezzo che possa ripulirli. Effetto garantito e immediato: basta un titolo tipo `Farina "0"` per rompere la scheda. Effetto grave (codice eseguito) meno probabile, ma possibile.
`src/dashboard/modules/recipe-list.js:304` e `src/dashboard/modules/image-picker.js:19,57,77-80`
Stesso `escapeHtml`, applicato a title, description, category, slug e ai campi dei provider immagini. Anche dentro gli attributi (`alt=`, `title=`, `data-slug=`), non solo nel testo visibile.

**16. Il report qualità scritto dall'AI viene mostrato come HTML senza filtro**
La finestra del report converte il markdown in HTML con delle sostituzioni di testo, che aggiungono tag ma non neutralizzano mai quelli già presenti nel file. Quel file contiene il riassunto scritto dal modello a partire dalla ricetta analizzata: se il modello cita verbatim un frammento HTML trovato nel testo problematico, il report lo esegue.
`src/dashboard/modules/quality-modal.js:26`
Fai l'escape del markdown grezzo prima delle sostituzioni: `renderMarkdown(esc(data.report))`, usando la funzione già presente in `src/dashboard/editor/editor-state.js:169`. Le regex che generano `<h2>`, `<strong>`, `<li>` continuano a funzionare.

**17. Il pulsante "Ricostruisci da ricette" cancella l'indice anti-duplicati (da 61 voci a 10)**
L'indice serve a non riproporre la stessa foto su due ricette. Il pulsante lo rigenera leggendo un campo che la pipeline principale non scrive mai, quindi solo 10 ricette su 80 ce l'hanno. Un clic — senza nessuna conferma, mentre l'opzione dichiaratamente distruttiva accanto la chiede — e il sistema dimentica 59 foto già usate. Danno solo sulle ricette nuove (quelle esistenti non vengono ritoccate), e l'indice è tracciato da git.
`src/server/routes/image.js:434`
Fai scrivere `recipe._originalImageUrl` anche a `src/publisher.js` prima di salvare. Nel frattempo, fai unire i dati invece di sostituire il file, e chiedi conferma mostrando quante voci si perderebbero. Aggiungi `.pre-edit.json` ai file da saltare.

**18. Scegliendo una foto dalla dashboard, l'URL non viene registrato**
Il percorso normale (il selettore visuale) scarica l'immagine e aggiorna la ricetta, ma non aggiunge mai l'URL all'indice delle foto usate — cosa che invece fanno sia il comando da riga di comando sia la pipeline automatica. Otto foto già usate possono quindi essere riproposte; all'opposto, dodici URL restano bloccati per ricette che non esistono più. È esattamente la spiegazione dei tre numeri diversi che vedi in dashboard.
`src/server/routes/image.js:104`
Estrai in un'unica funzione le due operazioni "segna URL come usato" e "togli URL", e chiamala da tutti e tre i percorsi. Un solo posto che tiene allineati indice e ricette.

**19. Trascinare un'immagine da un'altra scheda del browser non funziona e lascia file spazzatura**
Il codice chiede di salvare in un file `.jpg` temporaneo, poi lo rilegge — ma la funzione di download converte con sharp e scrive `.webp` e `.avif`, quindi il `.jpg` non esiste mai e la lettura fallisce. Il job va in errore, la ricetta non viene aggiornata, e restano due file orfani dentro `public/images/` che nessuno cancella e che finiscono pubblicati. Aggravante: la risposta HTTP parte prima del lavoro, quindi vedi comunque "✅ Immagine scaricata e ottimizzata!". Trascinare il file dal disco funziona: è solo il caso "da un'altra scheda" a essere rotto al 100%.
`src/server/routes/image.js:333`
Usa il percorso restituito dalla funzione (`const savedPath = await downloadImage(...)`) e cancella in un blocco `finally` sia il `.webp` sia l'`.avif`. Meglio ancora: scarica in memoria, visto che subito dopo il buffer viene ricompresso comunque.

**20. Un batch OCR che fallisce viene marcato "fatto" e non viene mai più riprovato**
Quando l'estrazione di un blocco di pagine va in errore, il codice scrive comunque quelle pagine nell'indice (con dentro il messaggio d'errore). Al lancio successivo il filtro guarda solo se la voce esiste, non se contiene un errore: quelle pagine sono saltate per sempre e il programma dice "Tutte le pagine sono già state processate!". Non c'è nessun riepilogo finale dei batch falliti. Non ha ancora morso (l'indice attuale non ha errori), ed è recuperabile cancellando le voci a mano.
`src/commands/trascrivi.js:193`
Nel filtro considera "da fare" anche le voci che hanno un campo `error`. E stampa in fondo l'elenco dei batch falliti, non solo il conteggio delle ricette estratte.

---

## Da tenere d'occhio

**21. La trascrizione OCR/PDF è rotta: Claude rifiuta la risposta pre-riempita**
Il codice mette in coda un messaggio che comincia già con `[` per costringere il modello a rispondere con un array. Quella tecnica non è più accettata dai modelli 4.6 che usi: l'API risponde 400, che non è ritentabile, quindi fallisce sempre alla prima chiamata. Il fallimento è rumoroso e la pipeline non ha comunque mai prodotto niente, quindi il raggio d'azione è di 10 pagine.
`src/enhancer.js:700`
Togli `{ role: 'assistant', content: '[' }` e il corrispondente `'[' + text`. Basta la regola già scritta nel prompt più il parser tollerante; in alternativa usa `output_config.format` con uno schema JSON.

**22. L'arricchimento SerpAPI spende e poi va sempre in errore**
Il codice prende `callClaude` da `enhancer.js`, ma quel file non la esporta: la variabile è `undefined` e la chiamata esplode con "callClaude is not a function". Succede sempre, per ogni ricetta, ma il fallimento è morbido — la ricetta viene salvata lo stesso, mancano solo i campi opzionali (proTips, glossario, tabella farine) — e l'errore nomina la funzione mancante. Nota: ogni ricetta lancia 4 query SerpAPI in parallelo, non una.
`src/commands/trascrivi.js:307`
Importa dalla vera origine: `await import('../utils/api.js')` invece di `'../enhancer.js'`. Vale anche per la riga 306.

**23. Il WebSocket accetta connessioni da chiunque e trasmette tutto l'output dei job**
Il canale non controlla da dove arriva la connessione, e i browser non applicano la regola same-origin alle WebSocket: qualsiasi pagina aperta mentre la dashboard gira può collegarsi e leggere in diretta l'output dei job — testo delle ricette (che finisce comunque online), percorsi assoluti delle tue cartelle, messaggi d'errore. Solo in ascolto: non può dare comandi. E a dashboard ferma non esce niente. Nessuna chiave API transita di lì.
`src/server/ws-handler.js:15` (creato in `src/server/index.js:56`)
Passa `verifyClient` alla creazione del WebSocketServer e rifiuta le connessioni il cui `Origin` non sia `http://localhost:3500`. Il bind su localhost del punto 6 vale comunque di più.

**24. Il nome del job viene inserito nella pagina come HTML**
Le righe di output normali sono al sicuro, ma l'intestazione di ogni job no: il nome (composto con quello che hai scritto nel form) viene incollato come HTML. Oggi tutti i nomi nascono da campi che digiti tu, quindi non si realizza da solo; serve il vettore CSRF del punto 8. E la rotta delle chiavi Gemini restituisce solo le ultime sei cifre, non le chiavi.
`src/dashboard/modules/terminal.js:77`
Usa `textContent` per il nome, come già si fa alla riga 119 per le righe di output.

**25. Il WebSocket non ha un gestore di errori: il processo può morire**
Viene registrato solo l'evento `close`, mai `error`, e in Node un errore senza ascoltatore fa terminare il processo — perdendo un batch a metà e i soldi già spesi in chiamate API. Attenzione però: contrariamente a quanto si potrebbe pensare, chiudere il portatile o il browser **non** provoca questo (verificato: quel percorso è già gestito e il processo sopravvive). Serve un peer anomalo che mandi un frame malformato, che il tuo browser non produce.
`src/server/ws-handler.js:15`
Aggiungi `ws.on('error', ...)` dentro `wss.on('connection')` e `wss.on('error', ...)` sul server. Utile anche un `process.on('uncaughtException')` che scriva su file invece di far cadere tutto. È una riga, ma non è un'emergenza.

**26. Se un'immagine non si trova, il job resta appeso**
In `/api/refresh-image` il job viene registrato subito, ma se il JSON della ricetta non si trova la rotta risponde 404 e torna indietro senza mai chiuderlo. Nella pagina aperta in quel momento resta un blocco con la rotella che gira. Ricaricando sparisce (contrariamente a quanto si potrebbe temere, non ricompare), e l'errore lo vedi comunque scritto nel terminale. Resta una voce inutile in memoria, pochi byte.
`src/server/routes/image.js:28`
Chiama `ctx.end(false)` prima del `return res.status(404)`. Meglio ancora: avvolgi il corpo della rotta in un `try/finally` che garantisca sempre la chiusura, perché lo schema si ripete altrove.

---

## Minori, non verificati

Questi **non sono passati per la verifica indipendente**: sono segnalazioni di primo passaggio, plausibili ma non confermate. Trattali come "da guardare quando capita", non come lavoro da pianificare.

- **Percorsi non validati** — categoria e slug arrivano dal browser e finiscono dritti in un percorso su disco senza controlli, sia nel salvataggio dell'editor (`src/server/routes/recipes.js:84`) sia nell'upload immagini (`src/server/routes/image.js:310`), dove `mkdirSync` creerebbe qualunque cartella. Rilevante solo perché non c'è autenticazione.
- **Frammento di chiave SerpAPI in `.env.example:12`** — i primi 12 caratteri su 64 sono quelli veri, pubblici su GitHub dal primo commit. Non ricostruibile, ma l'esempio è stato scritto copiando il file vero: sostituiscilo con un segnaposto.
- **`/api/gemini-key` e `/api/status` senza autenticazione** (`src/server/routes/settings.js:15`) — espongono le ultime 6 cifre e l'elenco dei servizi configurati. Piccolo da solo, tassello utile se sommato al punto 6.
- **Il server apre con Chrome qualsiasi indirizzo gli passi** (`src/server/routes/recipes.js:117`) — inclusi indirizzi interni alla tua rete, tipo il pannello del router, e ne rimanda indietro il testo.
- **Nove rotte riscrivono `recipes.json` in parallelo senza coordinarsi** (`src/commands/sync-cards.js:144`) — il mutex esistente protegge solo la cache immagini.
- **`insertBeforeBlockClose` dichiara "aggiornato" anche quando non ha cambiato niente** (`src/server/routes/categories.js:242`), e un apostrofo nel nome della categoria rompe il file del sito (riga 277) — in italiano gli apostrofi sono ovunque.
- **Eliminare una ricetta della categoria Primi non fa niente** (`src/server/routes/recipes.js:261`) e **l'injector scrive percorsi con uno spazio** per Secondi Piatti (`src/injector.js:29`) — entrambi conseguenze del punto 5.
- **L'output dei job vive solo nel browser** (`src/server/ws-handler.js:31`) — niente log su file, niente recupero dopo una riconnessione.
- **Nessuno controlla che il file scaricato sia davvero un'immagine** (`src/image-finder.js:590`) — una pagina di errore HTML verrebbe salvata come `.webp` e la funzione direbbe che è andato tutto bene.
- **`image-cache.json` (7,8 MB) è scritto non atomicamente** (`src/server/routes/_helpers.js:98`) — un'interruzione a metà lo tronca e l'errore viene ignorato in silenzio.
- **Il selettore mostra licenze NC e ND senza avviso** (`src/image-finder.js:208`) — ma la pipeline ridimensiona e riconverte, cioè crea un'opera derivata: incompatibile.
- **Con Gemini 2.5 i token di ragionamento consumano il budget della risposta** (`src/utils/api.js:301`) e il `finishReason` non viene mai guardato — parente stretto del punto 7.
- **Un array troncato diventa una sola ricetta** (`src/utils/api.js:176`) — l'altra faccia del punto 7, dal lato del parser.
- **Il testo delle pagine web finisce nel prompt senza separazione** (`src/enhancer.js:383`) — per il modello non c'è differenza fra le tue istruzioni e quello che c'era scritto sulla pagina.
- **Chiudere la scheda o un salvataggio fallito perdono le modifiche senza avviso** (`src/dashboard/recipe-editor.js:203`) e **due schede sulla stessa ricetta si sovrascrivono** (`editor-state.js:115`) — stessa area del punto 4.
- **Due pulsanti rotti nella dashboard**: "seleziona tutte" non seleziona niente (`recipe-list.js:178`, la funzione non è esposta su `window`) e il pulsante "Blocca aperto" del terminale non è collegato — anzi, cliccandolo lo chiude (`dashboard.js:90`, cerca un title "Pin" che nell'HTML è "Blocca aperto").
- **Nel batch dalla dashboard il primo URL che fallisce blocca tutti gli altri** (`src/server/routes/recipes.js:154`) — la versione da riga di comando invece protegge ogni ricetta ed è più robusta.
- **La preview apre una pagina `.html` che non esiste, e rispondere "no" non impedisce la pubblicazione** (`src/publisher.js:324`) — il JSON resta sul disco e `sync-cards` lo ripesca comunque.
- **L'OCR salva solo alla fine e ha un timeout di 30 minuti** (`src/ocr.js:38`) — se scade, ore di lavoro perse senza possibilità di riprendere.
- **`.backup.json` è uno slot unico condiviso da Fix AI e profilo sensoriale** (`src/server/routes/quality.js:291`) — il secondo cancella la copia del primo.
- **README fermo a una versione precedente** (`README.md:181`) — descrive file HTML che non esistono più, elenca "Pasta", e non nomina mai la dashboard, che oggi è il modo principale di usare il progetto.
- **Dipendenze inutili in `package.json:18`** — `pdf-poppler` (87 MB) e `slugify` non sono importati da nessuna parte, mentre lo slug viene calcolato a mano in cinque punti con tre regole diverse.
- **`deploy.bat` sta fuori da entrambi i repo e non è versionato da nessuno** — fa `git add -A` e committa alla cieca *prima* dei controlli, da cui i 100+ commit chiamati "deploy manuale" e due copie della cache immagini finite nel repo (una da 6,9 MB che nessun file legge).

---

## Se hai tempo per una cosa sola

**Sistema il punto 1: i due campi mancanti in `src/server/routes/categories.js:277`.**

È letteralmente aggiungere `dir: '${slug}'` e `unicode: '${metadata.unicodeEmoji}'` a una stringa — e il valore ti serve è già lì, due righe sopra. Cinque minuti.

Il beneficio è sproporzionato rispetto alla fatica: oggi premere un pulsante normale della dashboard blocca al 100% l'unica via di pubblicazione del sito, in silenzio (il job dice "creata con successo"), con un errore che compare dopo, in un altro repo, e che non nomina né la dashboard né la categoria — dice solo `paths[1]`. È il caso peggiore possibile: costo di diagnosi altissimo, costo di riparazione bassissimo, e nel frattempo non puoi pubblicare nemmeno una correzione urgente su una ricetta esistente.

Se ti avanzano altri due minuti, il secondo miglior rapporto è aggiungere `'127.0.0.1'` al `listen` di `src/server/index.js:60`: una parola sola, e chiude in un colpo il rischio rete del punto 6 e buona parte di quello del punto 23.

---

# Cosa questo checkup NON ha guardato

## Cosa manca (secondo giro)

- **File che nessuno ha aperto e che scrivono nel sito**: `src/commands/add-storage-backfill.js` — riscrive in massa TUTTI i JSON delle ricette con testo generato da Gemini, senza conferma né dry-run, non è in `package.json` né nel README, e usa `resolve(process.cwd(),'Ricettario','ricette')` (cioè si rompe o scrive altrove a seconda della cartella di avvio). Stessa sorte per `pdf-to-images.js`, `download-category-hero.mjs`, `batch-immagini.mjs`, `src/dashboard/scratch/pdf-to-text.js` (carica codice da un CDN).
- **Concorrenza: rischio tipico mai indagato.** `activeJobs` in `ws-handler.js` è solo una mappa per l'interfaccia: niente impedisce due lavori simultanei. L'unico serializzatore è `withCacheLock` e copre **solo** `image-cache.json`; `used-images.json`, `quality-index.json`, `verify-index.json`, `seo-cache.json` e `public/recipes.json` si sovrascrivono per intero senza lock e senza tmp+rename (il commento "Scrive atomicamente" in `_helpers.js:96` è falso). Due job in parallelo = aggiornamenti persi, ed è una spiegazione alternativa al disallineamento 80/61 attribuito dalla dimensione immagini solo ai "percorsi diversi".
- **La PATCH dell'editor non valida niente**: `src/server/routes/recipes.js:79-113` scrive nel JSON del sito qualunque cosa arrivi in `req.body.recipe`, mentre `src/recipe-schema.js` (24 KB, letto da nessuno oltre le prime 80 righe) è usato solo da publisher/quality. Da guardare insieme: cosa scrivono davvero `routes/image.js` e `routes/quality.js` dentro i JSON — è l'unico punto che **due** note ammettono di non aver ispezionato riga per riga (contratto-sito e sicurezza).
- **Backup senza strategia**: 86 file `.backup.json`/`.pre-edit.json` nel repo del sito, 80 dei quali tracciati da git; slot singolo sovrascritto a ogni salvataggio, nessuna pulizia, nessun undo di un'operazione di massa. Il sito li filtra (`build-recipes.js:23`), i tools no.
- **Deriva del `.env`**: il codice legge `SERPAPI_KEY_2`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `UNSPLASH_ACCESS_KEY`, `DATAFORSEO_LOGIN/PASSWORD`, `SITE_URL`; `.env.example` ne documenta 4 su 11. Su una macchina nuova metà dei provider tace in silenzio.
- **Correzione a una nota**: `data/_tmp_testo.txt` NON è ignorato — è tracciato e committato (`7015f7b`), quindi il testo incollato di ogni ricetta finisce nella storia git. Idem `quality-index.json` in radice mentre gli altri indici stanno in `data/`.
- **Tutto l'audit è statico**: 8 dimensioni su 8 dichiarano di non aver eseguito nulla. Un secondo giro vale soprattutto se su una copia del repo si avvia il server e si esercitano davvero `/api/genera`, `/api/quality-fix`, `/api/upload-image` e la rinomina categoria — è l'unico modo di confermare gemini-2-flash, il 400 sul prefill e `removeLineFromBlock`, oggi tutti dedotti.
- **Mai toccato**: `npm audit` / integrità del lockfile (13 dipendenze, puppeteer-extra-stealth, 277 MB), nessun campo `engines`, nessun CI.
