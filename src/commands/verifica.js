/**
 * COMANDO: verifica — Verifica qualità ricette con Claude AI
 */

import { resolve } from 'path';
import { verifyRecipe, verifyAllRecipes } from '../verify.js';
import { log } from '../utils/logger.js';

export async function verifica(args) {
    const ricettarioPath = resolve(process.cwd(), args.output || process.env.RICETTARIO_PATH || '../Ricettario');
    log.header('VERIFICA QUALITÀ — Claude AI');

    if (args['verifica-ricetta']) {
        // Singola ricetta
        const filePath = resolve(process.cwd(), args['verifica-ricetta']);
        const { recipe, result } = await verifyRecipe(filePath);
        const emoji = result.score >= 80 ? '🟢' : result.score >= 60 ? '🟡' : '🔴';
        console.log(`\n${emoji} ${result.score}/100 — ${result.verdict}`);
        console.log(`\n${result.summary}`);
        if (result.issues?.length > 0) {
            console.log('\nProblemi:');
            result.issues.forEach(i => console.log(`  ${i.severity} ${i.area}: ${i.message}`));
        }
        if (result.glossary?.length > 0) {
            console.log('\n📖 Glossario:');
            result.glossary.forEach(g => console.log(`  • ${g.term}: ${g.definition}`));
        }
    } else {
        // Tutte le ricette
        const results = await verifyAllRecipes(ricettarioPath, { force: !!args.forza });

        log.header('RIEPILOGO VERIFICA QUALITÀ');

        const sorted = results.filter(r => r.score >= 0).sort((a, b) => b.score - a.score);
        for (const r of sorted) {
            const emoji = r.score >= 80 ? '🟢' : r.score >= 60 ? '🟡' : '🔴';
            const flags = [
                r.needsSetupFix ? '⚠️Setup' : '',
                r.needsBaking ? '🔥Cottura' : '',
                r.glossaryTerms > 0 ? `📖${r.glossaryTerms}` : '',
            ].filter(Boolean).join(' ');
            console.log(`  ${emoji} ${r.score}/100 — ${r.title} ${flags}`);
        }

        const avg = Math.round(sorted.reduce((s, r) => s + r.score, 0) / sorted.length);
        log.info(`Media: ${avg}/100`);
        log.info('Report salvati come .verifica.md');
    }
}
