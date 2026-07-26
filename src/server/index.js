/**
 * SERVER — Express + WebSocket setup
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { exec } from 'child_process';
import { setupRoutes } from './routes.js';
import { setupWebSocket, scriviLog, percorsoCartellaLog } from './ws-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Le uniche origini da cui la dashboard viene aperta davvero. Il browser scrive
 * `http://localhost:PORTA`, `http://127.0.0.1:PORTA` o `http://[::1]:PORTA` a
 * seconda di come hai digitato l'indirizzo: valgono tutte e tre. La terza forma
 * è la stessa che `soloDalComputerLocale` (routes/settings.js) accetta come `::1`:
 * se qui mancasse, aprire la dashboard su `[::1]` la renderebbe tutta 403.
 */
function originiAmmesse(port) {
    return new Set([
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`,
        `http://[::1]:${port}`,
    ]);
}

/**
 * I nomi con cui la dashboard si apre davvero. L'header `Host` porta quello che
 * hai scritto nella barra degli indirizzi, e serve contro il DNS rebinding: un
 * sito ostile fa scadere il proprio DNS e lo fa puntare su 127.0.0.1, così il
 * browser considera `http://sito-ostile.example:PORTA` la stessa origine di
 * questo server e manda `Sec-Fetch-Site: same-origin` senza Origin. Il socket
 * dice 127.0.0.1 (il browser È su questa macchina), quindi nemmeno
 * `soloDalComputerLocale` se ne accorge: l'unico indizio che resta è il nome nel
 * Host, che è quello del sito ostile e non uno di questi tre.
 */
function hostAmmessi(port) {
    return new Set([
        `localhost:${port}`,
        `127.0.0.1:${port}`,
        `[::1]:${port}`,
    ]);
}

/** Metodi che non modificano niente: qui l'assenza di Origin è normale. */
const METODI_SOLA_LETTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * `Sec-Fetch-Site` dice chi ha fatto partire la richiesta, e i browser lo mandano
 * SEMPRE — anche su `<img src>`, `<script src>`, `<iframe>` e `<link>`, che invece
 * non mandano MAI Origin. È l'unico header che copre proprio il buco che Origin
 * lascia aperto. `none` = indirizzo digitato o segnalibro; `same-origin` = la
 * dashboard stessa. Tutto il resto (`cross-site`, `same-site`) è una pagina che
 * non è la dashboard.
 */
const PROVENIENZE_AMMESSE = new Set(['same-origin', 'none']);

/**
 * Le rotte `/api/` la dashboard le chiama solo con `fetch` (destinazione `empty`)
 * o digitandole nella barra (`document`). Se una arriva come immagine, script o
 * foglio di stile è una pagina che sta provando a farla partire da sola: è così
 * che `<img src=".../api/seo-suggestions?refresh=true">` brucerebbe credito
 * SerpAPI/DataForSEO senza mai mandare un Origin.
 */
const DESTINAZIONI_API_AMMESSE = new Set(['empty', 'document']);

/**
 * I guasti che `express.json()` sa nominare, con il messaggio da dire all'utente.
 * La chiave è `err.type`, che body-parser mette sui PROPRI errori.
 *
 * Non è però l'elenco completo dei modi in cui un corpo può essere illeggibile:
 * quando la decompressione fallisce (`Content-Encoding: gzip` su un payload che
 * gzip non è) l'errore nasce dentro zlib, e body-parser lo rilancia così com'è —
 * con `status` 400 ma SENZA `type`. Per quello serve anche il ripiego qui sotto:
 * una mappa di nomi chiude i casi che conosciamo, non la categoria.
 */
const ERRORI_DEL_CORPO = new Map([
    ['entity.parse.failed', 'Il corpo della richiesta non è JSON valido.'],
    ['entity.too.large', 'Il corpo della richiesta supera il limite di 20 MB.'],
    ['encoding.unsupported', 'La codifica del corpo della richiesta non è supportata.'],
    ['charset.unsupported', 'Il set di caratteri dichiarato per il corpo non è supportato.'],
    ['request.aborted', 'La richiesta è stata interrotta prima di arrivare tutta.'],
    ['request.size.invalid', 'Il corpo della richiesta non corrisponde al Content-Length dichiarato.'],
    ['stream.encoding.set', 'Il corpo della richiesta è stato letto due volte.'],
    ['stream.not.readable', 'Il corpo della richiesta non è più leggibile.'],
    ['parameters.too.many', 'Il corpo della richiesta contiene troppi campi.'],
]);

/** Quando il guasto è del corpo ma non sappiamo dargli un nome preciso. */
const CORPO_ILLEGGIBILE = 'Il corpo della richiesta non è leggibile.';

export function startServer(port = 3500) {
    const app = express();
    const server = createServer(app);

    // ── Un avvio fallito deve terminare, non restare a mezz'aria ──
    // `ws` ri-emette gli errori del server HTTP sull'istanza WebSocketServer, e
    // sia il gestore in ws-handler.js sia la rete di sicurezza qui sotto li
    // scrivono e basta. Senza questo ascoltatore, con la porta già occupata (la
    // dashboard lanciata due volte, o un node rimasto acceso) il processo
    // stampava una riga e restava vivo per sempre senza ascoltare niente: nessun
    // banner, nessun browser aperto, ogni richiesta in timeout, e con
    // `dashboard:dev` nodemon convinto che l'app stia girando.
    // Va registrato PRIMA del WebSocketServer, così è il primo a vedere l'errore.
    server.on('error', (err) => {
        if (err?.code === 'EADDRINUSE') {
            console.error('');
            console.error(`  ⛔ La porta ${port} è già occupata: c'è un'altra dashboard aperta.`);
            console.error('     Chiudi l\'altra finestra (o il processo node rimasto acceso) e riprova.');
            console.error('');
            scriviLog('errori', `Avvio fallito: porta ${port} già occupata`);
            process.exit(1);
        }
        console.error(`⛔ Errore del server HTTP: ${err?.message || err}`);
        scriviLog('errori', `server HTTP: ${err?.stack || err}`);
        if (!serverInAscolto) process.exit(1);
    });

    const origini = originiAmmesse(port);
    const origineAmmessa = (origin) => typeof origin === 'string' && origini.has(origin);
    const host = hostAmmessi(port);

    const rifiuta = (req, res, motivo) => {
        console.warn(`⛔ Richiesta rifiutata: ${req.method} ${req.url} — ${motivo}`);
        return res.status(403).json({ error: 'Origine non consentita' });
    };

    // ── Controllo della provenienza (anti-CSRF) ──
    // Una pagina qualsiasi aperta nel browser può far partire richieste verso questo
    // server: arrivano qui indistinguibili da quelle della dashboard. Due header che
    // il browser scrive e JavaScript non può falsificare dicono da dove vengono.
    //
    //   1. Sec-Fetch-Site — c'è su TUTTE le richieste, comprese le sotto-risorse
    //      (`<img>`, `<script>`, `<iframe>`, `<link>`) dove Origin non c'è mai.
    //      È questo che ferma la GET che spende soldi: una pagina ostile non può
    //      chiamare `/api/seo-suggestions?refresh=true` travestendola da immagine.
    //   2. Sec-Fetch-Dest sulle rotte /api/ — una rotta JSON caricata come immagine
    //      o come script non è mai la dashboard, nemmeno se arriva da localhost.
    //   3. Host — il nome digitato nella barra degli indirizzi. Chiude il DNS
    //      rebinding, che è il solo modo in cui una pagina ostile può farsi passare
    //      per la dashboard: lì Origin non c'è (è una GET) e Sec-Fetch-Site dice
    //      `same-origin`, quindi i primi due controlli la lasciano passare e
    //      `GET /api/gemini-key` risponderebbe con le anteprime delle chiavi.
    //   4. Origin — obbligatorio e locale sui metodi che modificano (POST/PATCH/
    //      PUT/DELETE): lì il browser lo manda sempre, anche same-origin, quindi se
    //      manca non è la dashboard. Sulle GET invece manca anche quando è la
    //      dashboard a chiamare (`fetch` same-origin non lo manda): assente passa,
    //      di un altro sito no.
    //
    // I client non-browser (curl, uno script Node) non mandano gli header Sec-Fetch,
    // e nemmeno i browser molto vecchi: per loro valgono solo le regole su Host e
    // Origin. Non è un buco — non c'è nessuna pagina ostile in mezzo — ma è il
    // motivo per cui il bind su 127.0.0.1 resta la barriera principale.
    app.use((req, res, next) => {
        const provenienza = req.headers['sec-fetch-site'];
        if (provenienza !== undefined && !PROVENIENZE_AMMESSE.has(provenienza)) {
            return rifiuta(req, res, `Sec-Fetch-Site: ${provenienza}`);
        }

        const destinazione = req.headers['sec-fetch-dest'];
        if (req.path.startsWith('/api/')
            && destinazione !== undefined
            && !DESTINAZIONI_API_AMMESSE.has(destinazione)) {
            return rifiuta(req, res, `Sec-Fetch-Dest: ${destinazione}`);
        }

        // Host assente = client HTTP/1.0 (uno script, non un browser): niente da
        // ribaltare, e su HTTP/1.1 mancante risponde già 400 il parser di Node.
        const nomeHost = req.headers.host;
        if (nomeHost !== undefined && !host.has(nomeHost.toLowerCase())) {
            return rifiuta(req, res, `Host: ${nomeHost}`);
        }

        const origin = req.headers.origin;
        const consentita = METODI_SOLA_LETTURA.has(req.method)
            ? (origin === undefined || origineAmmessa(origin))
            : origineAmmessa(origin);

        if (consentita) return next();

        return rifiuta(req, res, origin === undefined ? '(Origin assente)' : `Origin: ${origin}`);
    });

    // ── Middleware ──
    app.use(express.json({ limit: '20mb' }));
    // NIENTE express.urlencoded: nessuna pagina della dashboard invia moduli HTML
    // (si parla solo JSON). Tenerlo acceso serviva soltanto a far digerire al server
    // i moduli inviati da siti ostili, che è esattamente ciò che non vogliamo.

    // Con express 5 `req.body` resta `undefined` se nessun parser ha toccato il
    // corpo (un POST urlencoded, o senza Content-Type). Le 23 rotte che scrivono
    // lo destrutturano — `const { slot } = req.body` — e su `undefined` quello è un
    // TypeError: 500 con lo stack in console al posto del 400 della rotta. Un
    // oggetto vuoto fa arrivare la richiesta al controllo dei campi, che risponde
    // «Slot deve essere 1 o 2» invece di sembrare un guasto del server.
    app.use((req, res, next) => {
        if (req.body === undefined) req.body = {};
        next();
    });

    // ── Corpo illeggibile: 400 e UNA riga, non dieci ──
    // Senza questo, un JSON malformato arriva al gestore d'errore di serie di
    // Express 5: la risposta HTTP è già giusta (400), ma sullo stderr finisce lo
    // stack completo di body-parser. Dieci righe per una richiesta scritta male
    // sono rumore che nasconde gli errori veri — e un guasto vero, in mezzo al
    // terminale della dashboard, deve restare riconoscibile.
    //
    // Va registrato QUI, subito dopo il parser, e non in fondo al file. Express
    // riprende la scansione dal punto in cui l'errore è nato e va in AVANTI:
    // un gestore d'errore vede solo i guasti dei middleware registrati PRIMA di
    // lui (verificato: un `throw` in una rotta registrata dopo non gli arriva).
    // Messo qui becca il parser e nient'altro — e va bene così, perché i guasti
    // delle rotte devono continuare ad arrivare al gestore di serie con tutto lo
    // stack: quelli sono bug del server e devono urlare.
    //
    // Chi arriva qui, quindi, può essere solo `express.json()` (il normalizzatore
    // di `req.body` qui sopra non lancia, e il controllo della provenienza non
    // chiama mai `next(err)`: risponde 403 e chiude). Per questo il filtro non è
    // più l'elenco dei `type` di body-parser, che copriva solo i guasti che
    // body-parser sa nominare: un `Content-Encoding: gzip` su un payload che gzip
    // non è fallisce dentro zlib e arriva qui SENZA `type` — con la vecchia
    // versione tornava al gestore di serie, cioè stack sullo stderr E stack dentro
    // il corpo della risposta HTML, esattamente i due sintomi da togliere.
    //
    // Il criterio è lo stato: 4xx = ha sbagliato chi ha mandato la richiesta,
    // rispondiamo in italiano con una riga sola. Tutto il resto — 5xx, o un errore
    // senza stato — è un bug nostro e continua al gestore di serie con lo stack
    // intero: quelli devono urlare.
    app.use((err, req, res, next) => {
        const stato = Number(err?.status || err?.statusCode) || 0;
        const colpaDelClient = (stato >= 400 && stato < 500)
            || (stato === 0 && err?.expose === true);
        if (!colpaDelClient) return next(err);

        const messaggio = ERRORI_DEL_CORPO.get(err?.type) || CORPO_ILLEGGIBILE;
        const causa = err?.type || err?.code || `HTTP ${stato || '?'}`;

        console.warn(`⚠️  ${req.method} ${req.url} — corpo non leggibile (${causa}): ${err.message}`);
        scriviLog('errori', `corpo non leggibile su ${req.method} ${req.url} (${causa}): ${err.message}`);

        // Se la risposta è già partita non si può più cambiare: la chiusura della
        // connessione la deve fare Express.
        if (res.headersSent) return next(err);

        // Lo stato lo decide body-parser: 400 per il JSON malformato (il caso
        // normale), 413 per un corpo oltre il limite, 415 per una codifica che non
        // sappiamo leggere. Riscriverlo a mano trasformerebbe «troppo grande» in
        // «scritto male».
        return res.status(stato >= 400 && stato < 500 ? stato : 400).json({ error: messaggio });
    });

    // ── Static files (dashboard UI) ──
    const dashboardPath = resolve(__dirname, '..', 'dashboard');
    app.use(express.static(dashboardPath));

    // ── Static files (Ricettario public — immagini, ecc.) ──
    const ricettarioPublic = resolve(
        process.cwd(),
        process.env.RICETTARIO_PATH || '../Ricettario',
        'public'
    );
    app.use(express.static(ricettarioPublic));

    // ── Favicon (dal sito Ricettario) ──
    const ricettarioRoot = resolve(
        process.cwd(),
        process.env.RICETTARIO_PATH || '../Ricettario'
    );
    app.get('/favicon.svg', (req, res) => {
        res.sendFile(resolve(ricettarioRoot, 'favicon.svg'));
    });

    // ── Shared modules (Ricettario → Dashboard) ──
    const ricettarioJs = resolve(ricettarioRoot, 'js');
    app.use('/shared', express.static(ricettarioJs, {
        setHeaders: (res) => res.setHeader('Content-Type', 'application/javascript'),
    }));

    // ── API Routes ──
    setupRoutes(app);

    // ── WebSocket ──
    // I browser NON applicano la regola same-origin alle WebSocket: senza questo
    // controllo qualsiasi pagina aperta mentre la dashboard gira poteva collegarsi
    // a /ws e leggere in diretta l'output dei job (testi, percorsi delle tue
    // cartelle, messaggi d'errore). L'Origin lo scrive il browser e non è
    // falsificabile da JavaScript: se manca o è di un altro sito, non è la
    // dashboard e la connessione non si apre.
    const wss = new WebSocketServer({
        server,
        path: '/ws',
        verifyClient: ({ origin }, done) => {
            if (origineAmmessa(origin)) return done(true);
            console.warn(`⛔ WebSocket rifiutata da ${origin || '(Origin assente)'}`);
            done(false, 403, 'Origine non consentita');
        },
    });
    setupWebSocket(wss);

    registraReteDiSicurezza();

    // ── Start ──
    // Solo loopback: senza indirizzo, Node ascolta su TUTTE le interfacce di rete e
    // la dashboard (che non ha autenticazione) diventa raggiungibile da chiunque sia
    // sulla stessa WiFi — comprese le rotte che cancellano ricette e quelle che
    // consumano credito API.
    server.listen(port, '127.0.0.1', () => {
        serverInAscolto = true;
        console.log('');
        console.log('  🔥 ═══════════════════════════════════════');
        console.log('     RICETTARIO TOOLS — Dashboard');
        console.log('  ═══════════════════════════════════════════');
        console.log('');
        console.log(`     🌐 http://localhost:${port}`);
        console.log('     📡 WebSocket: /ws');
        console.log(`     📝 Log dei job: ${percorsoCartellaLog()}`);
        console.log('');
        console.log('     Premi Ctrl+C per fermare');
        console.log('');

        // Apri nel browser
        const url = `http://localhost:${port}`;
        const cmd = process.platform === 'win32'
            ? `cmd.exe /c start "" "${url}"`
            : process.platform === 'darwin'
                ? `open "${url}"`
                : `xdg-open "${url}"`;
        exec(cmd);
    });

    return server;
}

let reteDiSicurezzaAttiva = false;
let serverInAscolto = false;

/**
 * I flussi che non accettano più scritture, per nome. Uno stato PER FLUSSO, non
 * un unico interruttore per tutti e due: `npm run dashboard | head` chiude solo
 * stdout, mentre stderr resta attaccato al terminale. Con un interruttore solo,
 * quell'EPIPE su stdout zittiva anche stderr, e da lì in poi un guasto grave
 * faceva uscire il processo senza scrivere una parola su un terminale
 * perfettamente funzionante — nemmeno la riga che dice dove guardare.
 */
const flussiMorti = new Set();

/**
 * Stampa solo se STDERR è ancora vivo: è là che scrive `console.error`. Se a
 * cadere è stdout, i guasti si devono continuare a vedere.
 */
function stampaSenzaRischi(...args) {
    if (flussiMorti.has('stderr')) return;
    console.error(...args);
}

/**
 * Un `write` su stdout/stderr non deve mai diventare un `uncaughtException`.
 *
 * Se la pipa a valle si chiude (la dashboard lanciata con `| qualcosa`, o nodemon
 * terminato prima del figlio) ogni stampa fallisce con EPIPE. L'errore NON viene
 * lanciato: arriva più tardi come evento `error` sul flusso, e un evento `error`
 * senza ascoltatore in Node è un `uncaughtException`. Finiva quindi nella rete di
 * sicurezza, che per segnalarlo stampava — su quella stessa pipa morta —
 * generando l'errore successivo. Ogni giro appendeva uno stack a
 * `data/logs/errori.log`: in due minuti il file era arrivato a 558 MB (visto
 * davvero, non in teoria) con il processo incollato a scrivere nel vuoto.
 *
 * Con un ascoltatore l'evento viene consumato, la riga si perde e basta: il server
 * continua a lavorare e a scrivere sul file, che è l'unico posto rimasto.
 * Un solo avviso PER FLUSSO, non uno per riga: le stampe fallite sono migliaia.
 *
 * Il flusso caduto viene segnato con il proprio nome, perché è solo la morte di
 * stderr che deve zittire `stampaSenzaRischi`.
 */
function nonMorireSullaPipaChiusa(flusso, nome) {
    flusso.on('error', (err) => {
        if (flussiMorti.has(nome)) return;
        flussiMorti.add(nome);
        const causa = err?.code || err?.message || err;
        scriviLog('errori', nome === 'stderr'
            ? `stderr non è più scrivibile (${causa}): da qui in poi solo file di log.`
            : `stdout non è più scrivibile (${causa}): restano stderr e il file di log.`);
        // Se è caduto stdout ma stderr regge, dirlo dove si vede ancora: chi ha
        // lanciato `| head` deve capire perché le stampe normali sono sparite.
        if (nome !== 'stderr') {
            stampaSenzaRischi(`⚠️  stdout non è più scrivibile (${causa}): le stampe normali finiscono solo nel file di log.`);
        }
    });
}

/**
 * I soli guasti dopo i quali il processo è ancora sano: un flusso di I/O che si
 * chiude sotto i piedi. Non è rimasta nessuna istruzione a metà, solo una
 * scrittura che non è arrivata a destinazione — la connessione che il browser ha
 * chiuso mentre rispondevamo, la pipa a valle che è sparita. Sono anche quelli
 * che il checkup voleva smettere di far cadere: un peer che si comporta male non
 * deve portarsi via un batch da ore.
 */
const GUASTI_RECUPERABILI = new Set([
    'EPIPE',
    'ECONNRESET',
    'ECONNABORTED',
    'ERR_STREAM_WRITE_AFTER_END',
    'ERR_STREAM_DESTROYED',
]);

/**
 * Scrive il guasto dove si vede: sullo stderr (se c'è ancora) e sul file di log.
 *
 * Vale però solo a server avviato: prima dell'evento `listening` non c'è nessun
 * lavoro da proteggere, e restare vivi vorrebbe dire trasformare un avvio fallito
 * in una finestra che non fa niente. Finché `serverInAscolto` è falso, si esce.
 *
 * `scriviLog` usa `appendFileSync`: quando chi chiama esce subito dopo, la riga è
 * già sul disco. Sullo stderr non c'è la stessa garanzia (su una pipa la scrittura
 * è asincrona), ed è il motivo per cui il file resta la copia che conta.
 */
function annotaGuasto(etichetta, err, coda = null) {
    stampaSenzaRischi(`💥 ${etichetta}: ${err?.message || err}`);
    scriviLog('errori', `${etichetta}: ${err?.stack || err}`);
    if (!serverInAscolto) {
        stampaSenzaRischi("   È successo prima che il server fosse in ascolto: esco, non c'è niente da salvare.");
        process.exit(1);
    }
    if (coda) stampaSenzaRischi(coda);
}

function registraReteDiSicurezza() {
    if (reteDiSicurezzaAttiva) return;
    reteDiSicurezzaAttiva = true;

    nonMorireSullaPipaChiusa(process.stdout, 'stdout');
    nonMorireSullaPipaChiusa(process.stderr, 'stderr');

    // ── uncaughtException: scrivere e continuare NON va bene per tutto ──
    // Un `uncaughtException` è un'eccezione uscita da una pila che nessuno stava
    // srotolando: una callback interrotta a metà di ciò che stava facendo. Node
    // dice — e ha ragione — che da lì in poi lo stato del processo è ignoto.
    // Restare accesi in quella condizione, con una dashboard che riscrive JSON di
    // ricette e indici, vuol dire rischiare di salvare dati a metà: il guasto
    // grave sparisce dentro una riga di log e ricompare come una ricetta rotta.
    //
    // Quindi il gestore vale davvero solo per i guasti di I/O elencati sopra, che
    // sono il caso per cui il checkup lo chiedeva (punto 25: un peer anomalo non
    // deve portarsi via il batch). Per tutto il resto scrive — che è comunque più
    // di prima, quando lo stack si perdeva alla chiusura del terminale — e poi
    // esce, come faceva Node prima che questo gestore esistesse.
    process.on('uncaughtException', (err) => {
        if (GUASTI_RECUPERABILI.has(err?.code)) {
            annotaGuasto('Errore di I/O non gestito', err,
                '   Il server resta acceso: è solo una scrittura andata persa.');
            return;
        }

        annotaGuasto('Errore non gestito', err);
        stampaSenzaRischi('   Esco: dopo un errore così lo stato del processo è ignoto,');
        stampaSenzaRischi('   e restare accesi rischia di salvare ricette scritte a metà.');
        stampaSenzaRischi(`   Il dettaglio completo è in ${resolve(percorsoCartellaLog(), 'errori.log')}`);
        process.exit(1);
    });

    // Una promise rifiutata è diversa: la pila si è srotolata come previsto dal
    // linguaggio (è la stessa strada di un `await` dentro un `try`), e quello che
    // manca è solo il `.catch()` di chi doveva leggere l'esito. Niente istruzione
    // interrotta, nessuno stato ignoto: qui scrivere e continuare è corretto.
    process.on('unhandledRejection', (motivo) => {
        annotaGuasto('Promise rifiutata senza catch', motivo);
    });
}

