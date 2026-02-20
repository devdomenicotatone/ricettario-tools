#!/usr/bin/env node

/**
 * CREA RICETTA — CLI Entry Point (Dispatcher)
 *
 * Uso:
 *   node crea-ricetta.js --url "https://giallozafferano.it/ricetta/Focaccia.html"
 *   node crea-ricetta.js --nome "Focaccia Barese" --idratazione 80
 *   node crea-ricetta.js --scopri "focaccia pugliese" --quante 3
 *   node crea-ricetta.js --valida
 *   node crea-ricetta.js --verifica
 *   node crea-ricetta.js --trascrivi-philips
 *   node crea-ricetta.js --trascrivi-immagini
 *   node crea-ricetta.js --aggiorna-immagini
 *
 * Flag globali:
 *   --dry-run    Mostra il JSON senza scrivere file
 *   --verbose    Output dettagliato (mostra debug)
 *   --quiet      Output minimale (solo errori)
 *   --no-image   Salta la ricerca immagini
 *   --no-inject  Non inserire la card nella homepage
 *   --no-valida  Salta la validazione post-generazione
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

function showHelp() {
    console.log(`
🔥 ═══════════════════════════════════════
   RICETTARIO TOOLS — Recipe Generator
═══════════════════════════════════════════

Comandi:
  --url <url>                Scraping + AI rewriting da URL (virgola per batch)
  --nome <nome>              Genera ricetta da zero con AI
  --scopri <query>           Cerca ricette su Google e genera
  --valida                   Valida tutte le ricette (SerpAPI cross-check)
  --verifica                 Verifica qualità con Claude AI
  --verifica-ricetta <path>  Verifica singola ricetta
  --trascrivi-philips        Trascrivi PDF Philips Serie 7000
  --trascrivi-immagini       Trascrivi immagini PNG in HTML
  --aggiorna-immagini        Scarica immagini multi-provider

Opzioni:
  --quante <n>        Risultati ricerca (default: 5, max: 10)
  --idratazione <n>   Idratazione target in %
  --tipo <cat>        Categoria: Pane, Pizza, Pasta, Lievitati
  --note <testo>      Note aggiuntive per Claude
  --output <path>     Percorso output custom

Flag:
  --dry-run           Mostra JSON senza scrivere file
  --verbose, -v       Output dettagliato
  --quiet, -q         Output minimale
  --no-image          Salta ricerca immagini
  --no-inject         Non inserire card in homepage
  --forza             Forza ri-verifica (ignora cache)
`);
}

// ── Main Dispatcher ──
async function main() {
    const args = parseArgs();

    // Help
    if (!args.url && !args.nome && !args.scopri && !args.valida &&
        !args.verifica && !args['verifica-ricetta'] && !args['trascrivi-philips'] &&
        !args['trascrivi-immagini'] && !args['aggiorna-immagini']) {
        showHelp();
        process.exit(0);
    }

    log.header('RICETTARIO TOOLS — Recipe Generator');

    // ── Route ai comandi ──

    if (args['aggiorna-immagini']) {
        const { aggiornaImmagini } = await import('./src/commands/immagini.js');
        await aggiornaImmagini(args);
        process.exit(0);
    }

    // API key necessaria per i comandi seguenti
    if (!process.env.ANTHROPIC_API_KEY) {
        log.error('ANTHROPIC_API_KEY non trovata. Copia .env.example in .env e inserisci la tua chiave.');
        process.exit(1);
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
