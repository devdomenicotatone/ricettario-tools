#!/usr/bin/env node

/**
 * CREA RICETTA — CLI Entry Point (Dispatcher)
 *
 * Comandi, opzioni e flag stanno in `showHelp()` qui sotto, che è la loro
 * unica fonte: `node crea-ricetta.js --help`.
 *
 * Qui c'era una seconda copia dell'elenco, scritta a mano, e aveva già preso
 * una strada sua: annunciava `--no-inject` come «non inserire la card nella
 * homepage», mentre in homepage la card ci finisce lo stesso — subito dopo
 * l'inject, `publishRecipe` in src/publisher.js rilancia `syncCards`, che
 * ricostruisce l'indice rileggendo tutte le ricette. Non reintrodurla.
 */

import 'dotenv/config';
import { log } from './src/utils/logger.js';

// ── Parse CLI args ──
function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].replace('--', '');
            // Flag booleani (no valore dopo)
            if (!args[i + 1] || args[i + 1].startsWith('--')) {
                parsed[key] = true;
            } else {
                parsed[key] = args[i + 1];
                i++;
            }
        }
    }
    return parsed;
}

/**
 * Elenco delle categorie da mostrare nell'help.
 *
 * Non è scritto a mano: l'help elencava «Pane, Pizza, Pasta, Lievitati», cioè
 * una quarta copia dell'elenco, ferma a una "Pasta" che sul sito non esiste
 * più (oggi è "Primi") e che manda le ricette in una cartella non dichiarata.
 * La fonte è `Ricettario/js/categories.js`, letta via `src/constants.js`.
 *
 * Se il repo del sito non è raggiungibile l'help deve comunque uscire: qui si
 * ripiega su una riga che dice dove guardare, invece di far fallire `--help`.
 */
async function elencoCategorie() {
    try {
        const { etichetteAmmesse } = await import('./src/utils/percorsi-ricette.js');
        return etichetteAmmesse().join(', ');
    } catch {
        return 'quelle dichiarate in js/categories.js del sito (registry non raggiungibile)';
    }
}

async function showHelp() {
    console.log(`
🔥 ═══════════════════════════════════════
   RICETTARIO TOOLS — Recipe Generator
═══════════════════════════════════════════

Comandi:
  --url <url>                Scraping + AI rewriting da URL (virgola per batch)
  --nome <nome>              Genera ricetta da zero con AI
  --testo <file.txt>         Inserisci ricetta da testo libero (appunti, note)
  --scopri <query>           Cerca ricette su Google e genera
  --valida                   Valida tutte le ricette (SerpAPI cross-check)
  --verifica                 Verifica qualità con Claude AI
  --verifica-ricetta <path>  Verifica singola ricetta
  --sync-cards               Ricostruisce public/recipes.json dai .json delle ricette
  --refresh-image <slug>     Rigenera solo l'immagine di copertina
  --trascrivi-philips        Trascrivi PDF Philips Serie 7000
  --trascrivi-immagini       Trascrivi immagini PNG in ricette JSON (OCR Surya)
  --aggiorna-immagini        Scarica immagini multi-provider

Opzioni:
  --quante <n>        Risultati ricerca (default: 5, max: 10)
  --tipo <cat>        Categoria: ${await elencoCategorie()}
  --note <testo>      Note aggiuntive per Claude
  --aiModel <id>      Modello che genera la ricetta: claude (default, Sonnet 4.6),
                      claude-opus, gemini, gemini-3.1
  --output <path>     Percorso del repo del sito (alternativo a RICETTARIO_PATH)

Flag:
  --preview           Anteprima: mostra riepilogo + apre browser, conferma prima di pubblicare
  --dry-run           Mostra JSON senza scrivere file
  --verbose, -v       Output dettagliato
  --quiet, -q         Output minimale
  --no-image          Salta ricerca immagini
  --no-inject         Salta l'inserimento diretto della card in public/recipes.json
  --no-valida         Salta il cross-check con le fonti: è l'unico modo per non
                      spendere in validazione (--dry-run non lo evita).
                      Vale anche la forma --no-validate
  --no-enrich         Salta l'arricchimento SerpAPI + Claude in
                      --trascrivi-immagini (l'altra spesa, con un flag suo)
  --sovrascrivi       Rimpiazza una ricetta già presente (ne salva prima una
                      copia in tools/data/backup-ricette/). Senza questo flag,
                      se la ricetta esiste il comando si ferma senza scrivere
                      niente e senza spendere: rimpiazzare lavoro già fatto è
                      una decisione, non un default
  --keepExisting      Tiene entrambe le versioni: lascia intatta quella che
                      c'è e salva la nuova accanto come <slug>-v2.
                      Attenzione: finiscono online tutte e due
  --forza             Forza ri-verifica (ignora cache)
`);
}

// ── Main Dispatcher ──
async function main() {
    const args = parseArgs();

    // Help
    if (!args.url && !args.nome && !args.testo && !args.scopri && !args.valida &&
        !args.verifica && !args['verifica-ricetta'] && !args['trascrivi-philips'] &&
        !args['trascrivi-immagini'] && !args['aggiorna-immagini'] && !args['sync-cards'] &&
        !args['refresh-image']) {
        await showHelp();
        process.exit(0);
    }

    log.header('RICETTARIO TOOLS — Recipe Generator');

    // ── Route ai comandi ──

    if (args['aggiorna-immagini']) {
        const { aggiornaImmagini } = await import('./src/commands/immagini.js');
        await aggiornaImmagini(args);
        process.exit(0);
    }

    if (args['sync-cards']) {
        const { syncCards } = await import('./src/commands/sync-cards.js');
        await syncCards(args);
        process.exit(0);
    }

    if (args['refresh-image']) {
        const { refreshImage } = await import('./src/commands/refresh-image.js');
        await refreshImage(args);
        process.exit(0);
    }


    // API key necessaria per i comandi seguenti
    if (!process.env.ANTHROPIC_API_KEY) {
        log.error('ANTHROPIC_API_KEY non trovata. Copia .env.example in .env e inserisci la tua chiave.');
        process.exit(1);
    }

    if (args.testo) {
        const { testo } = await import('./src/commands/testo.js');
        await testo(args);
        process.exit(0);
    }

    if (args.valida) {
        const { valida } = await import('./src/commands/valida.js');
        await valida(args);
        process.exit(0);
    }

    if (args.verifica || args['verifica-ricetta']) {
        const { verifica } = await import('./src/commands/verifica.js');
        await verifica(args);
        process.exit(0);
    }

    if (args['trascrivi-philips']) {
        const { trascriviPdf } = await import('./src/commands/trascrivi.js');
        await trascriviPdf(args);
        process.exit(0);
    }

    if (args['trascrivi-immagini']) {
        const { trascriviImmagini } = await import('./src/commands/trascrivi.js');
        await trascriviImmagini(args);
        process.exit(0);
    }

    if (args.scopri) {
        const { scopri } = await import('./src/commands/scopri.js');
        await scopri(args);
        process.exit(0);
    }

    // Mode A/B: URL o generazione da zero
    const { genera } = await import('./src/commands/genera.js');

    // Batch: supporto URL multipli separati da virgola
    if (args.url && args.url.includes(',')) {
        const urls = args.url.split(',').map(u => u.trim()).filter(Boolean);
        log.header(`BATCH SEQUENZIALE — ${urls.length} ricette`);

        const results = [];
        for (let i = 0; i < urls.length; i++) {
            log.header(`RICETTA ${i + 1}/${urls.length}`);
            log.info(`URL: ${urls[i]}`);

            const batchArgs = { ...args, url: urls[i] };
            try {
                await genera(batchArgs);
                results.push({ url: urls[i], status: '✅' });
            } catch (err) {
                log.error(`Errore ricetta ${i + 1}: ${err.message}`);
                results.push({ url: urls[i], status: '❌', error: err.message });
            }

            // Pausa tra ricette per evitare rate limit
            if (i < urls.length - 1) {
                log.info('Pausa 5s prima della prossima ricetta...');
                await new Promise(r => setTimeout(r, 5000));
            }
        }

        // Riepilogo finale
        log.header('RIEPILOGO BATCH');
        results.forEach((r, i) => {
            console.log(`  ${r.status} ${i + 1}. ${r.url}${r.error ? ` — ${r.error}` : ''}`);
        });
        const ok = results.filter(r => r.status === '✅').length;
        log.info(`${ok}/${results.length} ricette generate con successo`);
    } else {
        await genera(args);
    }
}

main().catch(err => {
    log.error(`Errore: ${err.message}`);
    if (log.isVerbose) console.error(err.stack);
    process.exit(1);
});
