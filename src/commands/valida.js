/**
 * COMANDO: valida — Valida ricette con fonti reali (SerpAPI cross-check)
 */

import { resolve } from 'path';
import { validateAllRecipes } from '../validator.js';
import { log } from '../utils/logger.js';

export async function valida(args) {
    const ricettarioPath = resolve(process.cwd(), args.output || process.env.RICETTARIO_PATH || '../Ricettario');
    log.header('VALIDAZIONE PRO — Cross-check con fonti reali');

    const results = await validateAllRecipes(ricettarioPath);

    // Riepilogo finale
    log.header('RIEPILOGO VALIDAZIONE');

    const sorted = results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    for (const r of sorted) {
        const emoji = r.confidence >= 75 ? '🟢' : r.confidence >= 50 ? '🟡' : '🔴';
        console.log(`  ${emoji} ${r.confidence}% — ${r.title}`);
    }

    // Senza ricette validate la media è NaN: meglio un errore che un
    // riepilogo vuoto che sembra dire "controllato tutto, tutto a posto".
    const valide = sorted.filter(r => r.confidence >= 0);
    if (valide.length === 0) {
        throw new Error(
            `Nessuna ricetta validata su ${results.length} trovate: media non calcolabile. ` +
            'Controlla gli errori qui sopra.'
        );
    }

    const avgConfidence = Math.round(
        valide.reduce((sum, r) => sum + r.confidence, 0) / valide.length
    );
    log.info(`Media confidenza: ${avgConfidence}% su ${valide.length} ricette validate`);
    const falliti = results.length - valide.length;
    if (falliti > 0) log.warn(`${falliti} ricette in errore, escluse dalla media`);
    log.info('Report salvati come .validazione.md accanto a ogni ricetta');
}
