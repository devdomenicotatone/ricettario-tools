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

    const avgConfidence = Math.round(
        sorted.filter(r => r.confidence >= 0).reduce((sum, r) => sum + r.confidence, 0) /
        sorted.filter(r => r.confidence >= 0).length
    );
    log.info(`Media confidenza: ${avgConfidence}%`);
    log.info('Report salvati come .validazione.md accanto a ogni ricetta');
}
