/**
 * FIX-TOKENS — Correttore deterministico per token invertiti nei procedimenti
 * 
 * Problema: nelle ricette vecchie, i token {nome:valore} sono spesso associati
 * al testo dell'ingrediente sbagliato (es. {acqua:300}g di sale).
 * 
 * Questo script:
 * 1. Scansiona tutti i JSON ricetta
 * 2. Per ogni step, trova pattern {token:valore}g di TESTO
 * 3. Verifica che il token corrisponda al testo
 * 4. Se trova coppie invertite, le swappa
 * 5. Salva backup + JSON corretto
 * 
 * ZERO costo API — puramente deterministico.
 * 
 * Uso: node fix-tokens.js --dry-run    (solo analisi)
 *      node fix-tokens.js              (applica fix + backup)
 *      node fix-tokens.js --verbose    (dettagli extra)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync, statSync } from 'fs';
import { resolve, basename } from 'path';

const RICETTARIO = resolve(process.cwd(), '../Ricettario/ricette');
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

// ── Mappa token-keyword → tipo ingrediente ──
const TOKEN_KEYWORDS = {
    acqua:    ['acqua', 'water'],
    sale:     ['sale'],
    olio:     ['olio', 'extravergine', 'evo'],
    farina:   ['farina', 'semola', 'manitoba', 'tipo 0', 'tipo 00', 'tipo 1', 'saccorosso', 'integrale', 'caputo'],
    lievito:  ['lievito'],
    malto:    ['malto'],
    zucchero: ['zucchero'],
    burro:    ['burro'],
    miele:    ['miele'],
    latte:    ['latte'],
    uova:     ['uova', 'uovo', 'tuorlo'],
    strutto:  ['strutto'],
};

// Dato un token ID come "acqua_poolish" o "sale_impasto_finale", estrai il tipo
function getTokenType(tokenId) {
    const id = tokenId.toLowerCase();
    for (const [type] of Object.entries(TOKEN_KEYWORDS)) {
        if (id.startsWith(type)) return type;
    }
    return null;
}

// Dato un testo dopo il token, cerca di capire a quale ingrediente si riferisce
function getTextType(textAfterToken) {
    const t = textAfterToken.toLowerCase();
    for (const [type, keywords] of Object.entries(TOKEN_KEYWORDS)) {
        if (keywords.some(k => t.includes(k))) return type;
    }
    return null;
}

function analyzeStep(text) {
    const issues = [];
    const tokens = [];
    
    const regex = /\{([^}:]+):([^}]+)\}g/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const tokenId = match[1];
        const tokenValue = match[2];
        const fullToken = match[0];
        const pos = match.index;
        
        const afterPos = pos + fullToken.length;
        const textAfter = text.substring(afterPos, afterPos + 80);
        
        const tokenType = getTokenType(tokenId);
        const textType = getTextType(textAfter);
        
        tokens.push({ tokenId, tokenValue, fullToken, pos, afterPos, textAfter: textAfter.substring(0, 40), tokenType, textType });
        
        if (tokenType && textType && tokenType !== textType) {
            issues.push({ tokenId, fullToken, tokenType, textType, textAfter: textAfter.substring(0, 40) });
        }
    }
    
    return { tokens, issues };
}

function fixStepText(text, issues) {
    let fixed = text;
    const swapped = new Set();
    
    // Strategia: trova coppie invertite e swappa i token
    for (const issue of issues) {
        if (swapped.has(issue.fullToken)) continue;
        
        const partner = issues.find(other => 
            other !== issue &&
            !swapped.has(other.fullToken) &&
            other.tokenType === issue.textType &&
            other.textType === issue.tokenType
        );
        
        if (partner) {
            const placeholder = '___SWAP_PLACEHOLDER___';
            fixed = fixed.replace(issue.fullToken, placeholder);
            fixed = fixed.replace(partner.fullToken, issue.fullToken);
            fixed = fixed.replace(placeholder, partner.fullToken);
            
            swapped.add(issue.fullToken);
            swapped.add(partner.fullToken);
        }
    }
    
    return fixed;
}

// ══════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════

console.log('');
console.log('═══════════════════════════════════════════════════');
console.log('   FIX-TOKENS — Correttore Token Invertiti');
console.log('═══════════════════════════════════════════════════');
console.log(`   Modalità: ${DRY_RUN ? '🔍 DRY-RUN (nessuna modifica)' : '🔧 FIX (con backup)'}`);
console.log('');

let totalRecipes = 0;
let totalFixed = 0;
let totalIssues = 0;
let unfixable = [];

const categories = readdirSync(RICETTARIO).filter(d => {
    try { return statSync(resolve(RICETTARIO, d)).isDirectory(); } catch { return false; }
});

for (const cat of categories) {
    const catDir = resolve(RICETTARIO, cat);
    const files = readdirSync(catDir).filter(f => 
        f.endsWith('.json') && 
        !f.endsWith('.backup.json') && 
        !f.endsWith('.pre-fix.json') &&
        !f.endsWith('.qualita.json') &&
        f !== 'index.json'
    );
    
    for (const file of files) {
        const filePath = resolve(catDir, file);
        const raw = readFileSync(filePath, 'utf-8');
        const recipe = JSON.parse(raw);
        
        totalRecipes++;
        let recipeIssues = [];
        let recipeFixed = false;
        
        const stepArrays = [
            { key: 'stepsSpiral', label: 'Spirale' },
            { key: 'stepsHand', label: 'A Mano' },
            { key: 'stepsExtruder', label: 'Estrusore' },
            { key: 'stepsCondiment', label: 'Condimento' },
        ];
        
        for (const { key, label } of stepArrays) {
            if (!recipe[key]?.length) continue;
            
            for (let i = 0; i < recipe[key].length; i++) {
                const step = recipe[key][i];
                if (!step.text) continue;
                
                const { tokens, issues } = analyzeStep(step.text);
                
                if (issues.length > 0) {
                    totalIssues += issues.length;
                    
                    for (const issue of issues) {
                        recipeIssues.push({ step: `${label} #${i + 1}`, ...issue });
                    }
                    
                    const fixedText = fixStepText(step.text, issues);
                    
                    if (fixedText !== step.text) {
                        if (!DRY_RUN) {
                            recipe[key][i].text = fixedText;
                        }
                        recipeFixed = true;
                        
                        // Verifica residui
                        const recheck = analyzeStep(fixedText);
                        if (recheck.issues.length > 0) {
                            for (const remaining of recheck.issues) {
                                unfixable.push({ recipe: recipe.title, slug: basename(file, '.json'), step: `${label} #${i + 1}`, ...remaining });
                            }
                        }
                    } else {
                        for (const issue of issues) {
                            unfixable.push({ recipe: recipe.title, slug: basename(file, '.json'), step: `${label} #${i + 1}`, ...issue });
                        }
                    }
                }
            }
        }
        
        if (recipeIssues.length > 0) {
            const emoji = recipeFixed ? '🔧' : '⚠️';
            console.log(`${emoji} ${recipe.title} (${cat}/${file})`);
            for (const issue of recipeIssues) {
                console.log(`   ${issue.step}: {${issue.tokenId}} è "${issue.tokenType}" ma testo dice "${issue.textType}"`);
                if (VERBOSE) console.log(`      → ...${issue.textAfter}`);
            }
            
            if (recipeFixed && !DRY_RUN) {
                const backupPath = filePath.replace('.json', '.pre-fix.json');
                copyFileSync(filePath, backupPath);
                writeFileSync(filePath, JSON.stringify(recipe, null, 2), 'utf-8');
                console.log(`   ✅ Fixato (backup: ${basename(backupPath)})`);
                totalFixed++;
            } else if (recipeFixed) {
                console.log(`   🔍 Fixabile (dry-run)`);
                totalFixed++;
            }
            console.log('');
        }
    }
}

console.log('═══════════════════════════════════════════════════');
console.log('   RISULTATI');
console.log('═══════════════════════════════════════════════════');
console.log(`   📦 Ricette scansionate: ${totalRecipes}`);
console.log(`   🔍 Token invertiti trovati: ${totalIssues}`);
console.log(`   🔧 Ricette fixate: ${totalFixed}`);

if (unfixable.length > 0) {
    console.log(`   ⚠️  Non fixabili automaticamente: ${unfixable.length}`);
    console.log('');
    for (const u of unfixable) {
        console.log(`   ⚠️  ${u.recipe} → ${u.step}: {${u.tokenId}} (${u.tokenType}) ma testo "${u.textType}"`);
    }
}

console.log('');
if (DRY_RUN) console.log('   💡 Per applicare: node fix-tokens.js');
else console.log('   ✅ Completato! Backup in .pre-fix.json');
console.log('');
