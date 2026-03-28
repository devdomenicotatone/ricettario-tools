/**
 * TEST — Verifica Dual-LLM su una singola ricetta JSON
 * Uso: node test-verify-json.mjs <percorso-ricetta.json>
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { callClaude, callGemini, parseClaudeJson } from './src/utils/api.js';

const VERIFY_SYSTEM = `Sei un esperto tecnologo alimentare, panificatore e pastaio italiano con 30 anni di esperienza.
Verifica la correttezza di questa ricetta JSON. Analizza:
1. DOSI: idratazione, % lievito, rapporti farina/acqua, sale (2-3% su farina)
2. TEMPERATURE: forno max 280°C, impasto target 23-26°C
3. TEMPI: coerenza lievitazione vs lievito
4. SETUP: spirale vs mano vs estrusore — corretto per la categoria?
5. ingredientGroups: i gruppi sono logici? Ogni ingrediente è nel gruppo giusto?
6. Coerenza ingredienti ↔ procedimento: ogni ingrediente menzionato negli step?

RISPONDI con un JSON valido (NO markdown fences):
{
  "score": 85,
  "verdict": "🟢 Buona|🟡 Da migliorare|🔴 Problematica",
  "issues": [
    {"severity": "❌|⚠️|💡", "area": "Dosi|Temperature|Tempi|Setup|Gruppi|Coerenza", "message": "Problema", "fix": "Correzione"}
  ],
  "summary": "Riepilogo 2-3 righe"
}`;

const GEMINI_CHALLENGE = `Sei un revisore critico indipendente — secondo parere esperto.
Hai ricevuto una RICETTA e il VERDETTO DI UN ALTRO AI (Claude).
METTI IN DISCUSSIONE il verdetto: conferma, contesta o aggiungi problemi mancanti.
NON essere pignolo senza motivo — segnala solo problemi REALI.

RISPONDI con un JSON valido (NO markdown fences):
{
  "agreement": "🟢 Confermo|🟡 Parziale disaccordo|🔴 Forte disaccordo",
  "scoreAdjustment": 0,
  "challengedIssues": [
    {"originalIssue": "Rif. problema Claude", "verdict": "✅ Confermo|❌ Falso positivo|⚠️ Parziale", "reason": "Motivazione"}
  ],
  "missedIssues": [
    {"severity": "❌|⚠️|💡", "area": "Area", "message": "Problema mancato", "fix": "Correzione"}
  ],
  "ingredientGroupsReview": {"correct": true, "issues": []},
  "summary": "Giudizio revisore (2-3 righe)"
}`;

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: node test-verify-json.mjs <ricetta.json>');
    process.exit(1);
  }

  const recipe = JSON.parse(readFileSync(file, 'utf-8'));
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  TEST DUAL-LLM: ${recipe.title.padEnd(32)}║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);

  // ── Prepara contesto ──
  const flatIngredients = recipe.ingredientGroups?.length
    ? recipe.ingredientGroups.flatMap(g => [`── ${g.group} ──`, ...g.items.map(i => `  ${i.name} ${i.note || ''} ${i.grams != null ? i.grams + 'g' : ''}`)])
    : (recipe.ingredients || []).map(i => `${i.name} ${i.note || ''} ${i.grams != null ? i.grams + 'g' : ''}`);

  const recipeText = `TITOLO: ${recipe.title}
CATEGORIA: ${recipe.category}
IDRATAZIONE: ${recipe.hydration}%
TEMPERATURA TARGET: ${recipe.targetTemp}
LIEVITAZIONE: ${recipe.fermentation}

INGREDIENTI:
${flatIngredients.join('\n')}

${recipe.suspensions?.length ? `SOSPENSIONI:\n${recipe.suspensions.map(s => `${s.name} ${s.note || ''} ${s.grams}g`).join('\n')}` : ''}

PROCEDIMENTO (titoli step):
${(recipe.stepsSpiral || recipe.stepsHand || recipe.stepsExtruder || []).map((s, i) => `${i + 1}. ${s.title}`).join('\n')}`;

  // ── STEP 1: Claude ──
  console.log('🔵 CLAUDE sta verificando...\n');
  const claudeText = await callClaude({
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 3000,
    system: VERIFY_SYSTEM,
    messages: [{ role: 'user', content: recipeText }],
  });
  const claude = parseClaudeJson(claudeText);

  const emoji1 = claude.score >= 80 ? '🟢' : claude.score >= 60 ? '🟡' : '🔴';
  console.log(`   ${emoji1} Score: ${claude.score}/100 — ${claude.verdict}`);
  console.log(`   ${claude.summary}\n`);
  if (claude.issues?.length) {
    claude.issues.forEach(i => console.log(`   ${i.severity} [${i.area}] ${i.message}`));
    console.log('');
  }

  // ── STEP 2: Gemini Challenge ──
  console.log('🔴 GEMINI sta contestando...\n');
  const geminiText = await callGemini({
    model: 'gemini-3.1-pro-preview',
    maxTokens: 4096,
    system: GEMINI_CHALLENGE,
    messages: [{
      role: 'user',
      content: `RICETTA:\n${recipeText}\n\n══════════════════════════════\nVERDETTO CLAUDE:\n${JSON.stringify(claude, null, 2)}\n══════════════════════════════\n\nAnalizza CRITICAMENTE il verdetto.`
    }],
  });
  const gemini = parseClaudeJson(geminiText);

  console.log(`   ${gemini.agreement}`);
  if (gemini.scoreAdjustment) console.log(`   Score adjustment: ${gemini.scoreAdjustment > 0 ? '+' : ''}${gemini.scoreAdjustment}`);
  console.log(`   ${gemini.summary}\n`);

  if (gemini.challengedIssues?.length) {
    console.log('   Issues contestate:');
    gemini.challengedIssues.forEach(i => console.log(`     ${i.verdict} "${i.originalIssue}" → ${i.reason}`));
    console.log('');
  }

  if (gemini.missedIssues?.length) {
    console.log('   Issues mancanti (solo Gemini):');
    gemini.missedIssues.forEach(i => console.log(`     ${i.severity} [${i.area}] ${i.message}`));
    console.log('');
  }

  if (gemini.ingredientGroupsReview && !gemini.ingredientGroupsReview.correct) {
    console.log('   ⚠️ Problemi ingredientGroups:');
    gemini.ingredientGroupsReview.issues.forEach(i => console.log(`     - ${i}`));
    console.log('');
  }

  // ── VERDETTO FINALE ──
  const finalScore = Math.max(0, Math.min(100, claude.score + (gemini.scoreAdjustment || 0)));
  const emoji2 = finalScore >= 80 ? '🟢' : finalScore >= 60 ? '🟡' : '🔴';
  console.log('══════════════════════════════════════════');
  console.log(`   SCORE FINALE: ${emoji2} ${finalScore}/100`);
  if (gemini.scoreAdjustment) console.log(`   (Claude ${claude.score} ${gemini.scoreAdjustment > 0 ? '+' : ''}${gemini.scoreAdjustment} Gemini)`);
  console.log('══════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('💥 Errore:', err.message);
  process.exit(1);
});
