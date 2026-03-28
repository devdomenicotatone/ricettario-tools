/**
 * Test della pipeline unificata quality.js
 */
import { analyzeQuality } from './src/quality.js';
import { resolve } from 'path';

const file = process.argv[2];
if (!file) {
    console.error('Uso: node test-quality.mjs <file.json> [--grounding]');
    process.exit(1);
}

const grounding = process.argv.includes('--grounding');
const filePath = resolve(file);

console.log(`╔${'═'.repeat(50)}╗`);
console.log(`║  TEST QUALITY PIPELINE: ${grounding ? '+ Web Grounding' : 'Solo AI'}`);
console.log(`╚${'═'.repeat(50)}╝\n`);

try {
    const { recipe, result } = await analyzeQuality(filePath, { grounding });

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`   SCORE FINALE: ${result.score >= 80 ? '🟢' : result.score >= 60 ? '🟡' : '🔴'} ${result.score}/100`);
    console.log(`   Schema: ${result.schema.pass ? '✅' : '❌'} (${result.schema.errors.length} errori, ${result.schema.warnings.length} warning)`);
    console.log(`   Claude: ${result.claude.score}/100 — ${result.claude.verdict}`);
    if (result.gemini) {
        console.log(`   Gemini: ${result.gemini.agreement} (adj: ${result.gemini.scoreAdjustment > 0 ? '+' : ''}${result.gemini.scoreAdjustment})`);
    }
    if (result.grounding) {
        console.log(`   Web: ${result.grounding.sourcesCount} fonti`);
    }
    console.log(`${'═'.repeat(50)}`);
} catch (err) {
    console.error('❌ Errore:', err.message);
    console.error(err.stack);
    process.exit(1);
}
