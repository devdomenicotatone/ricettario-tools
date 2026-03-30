/**
 * COMANDO: testo — Inserisci una ricetta da testo libero (file o stdin)
 *
 * Legge una ricetta completa in formato testo libero e la adatta al template
 * del Ricettario, passando attraverso il flusso standard:
 *   Testo → Claude AI (strutturazione JSON) → Publisher (validazione → immagine → JSON → HTML → inject)
 *
 * Uso:
 *   node crea-ricetta.js --testo ricetta.txt
 *   node crea-ricetta.js --testo ricetta.txt --tipo Pizza --no-image
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { enhanceFromText } from '../enhancer.js';
import { publishRecipe } from '../publisher.js';
import { log } from '../utils/logger.js';

export async function testo(args) {
    const filePath = typeof args.testo === 'string' ? args.testo : null;

    if (!filePath) {
        log.error('Specifica il percorso al file di testo: --testo ricetta.txt');
        process.exit(1);
    }

    const fullPath = resolve(process.cwd(), filePath);
    if (!existsSync(fullPath)) {
        log.error(`File non trovato: ${fullPath}`);
        process.exit(1);
    }

    log.header('INSERIMENTO RICETTA DA TESTO');
    log.info(`File: ${fullPath}`);

    // Leggi il testo della ricetta
    const recipeText = readFileSync(fullPath, 'utf-8');
    if (recipeText.trim().length < 20) {
        log.error('Il file è troppo corto. Inserisci una ricetta completa.');
        process.exit(1);
    }

    log.info(`Testo letto: ${recipeText.length} caratteri, ${recipeText.split('\n').length} righe`);

    // ── Step 1: AI struttura il testo in JSON ──
    const enhancedRecipe = await enhanceFromText(recipeText, {
        tipo: args.tipo,
        aiModel: args.aiModel,
    });

    log.info(`Titolo identificato: ${enhancedRecipe.title}`);
    log.info(`Categoria: ${enhancedRecipe.category}`);

    // ── Step 2+: Pipeline unificata ──
    await publishRecipe(enhancedRecipe, args, {
        source: 'DA TESTO',
    });
}
