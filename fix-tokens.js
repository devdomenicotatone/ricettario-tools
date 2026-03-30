/**
 * BATCH TOKEN FIX — Corregge automaticamente i token errati nelle ricette
 * 
 * Analizza ogni ricetta, confronta i nomi dei token con gli ingredienti,
 * e corregge automaticamente dove il matching è ovvio.
 * 
 * Uso: node tools/fix-tokens.js [--dry-run] [--slug nome-ricetta]
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, basename } from 'path';

const RECIPES_DIR = resolve('Ricettario/ricette');
const TOKEN_RE = /\{([a-z_]+):(\d+(?:\.\d+)?)(!)?\}/g;
const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_SLUG = process.argv.find((a, i) => process.argv[i - 1] === '--slug');

// ── Mapping ingredienti → categorie semantiche ──
const INGREDIENT_CATEGORIES = {
    acqua: ['acqua', 'water'],
    farina: ['farina', 'semola rimacinata', 'tipo 00', 'tipo 0', 'tipo 1', 'tipo 2', 'manitoba', 'nuvola', 'saccorosso', 'farro', 'integrale', 'segale'],
    sale: ['sale'],
    olio: ['olio', 'evo', 'extravergine', 'oliva'],
    zucchero: ['zucchero', 'zucchero semolato', 'zucchero a velo'],
    lievito: ['lievito', 'ldb', 'lievito di birra', 'lievito secco', 'lievito madre', 'criscito'],
    burro: ['burro'],
    uova: ['uova', 'uovo', 'tuorlo', 'tuorli', 'albume', 'albumi'],
    latte: ['latte'],
    miele: ['miele'],
    malto: ['malto', 'estratto di malto'],
    strutto: ['strutto', 'sugna'],
    semola: ['semola'],
};

function categorizeIngredient(name) {
    const lower = name.toLowerCase();
    for (const [cat, keywords] of Object.entries(INGREDIENT_CATEGORIES)) {
        if (keywords.some(k => lower.includes(k))) return cat;
    }
    return null;
}

function categorizeToken(tokenName) {
    const lower = tokenName.toLowerCase();
    for (const [cat, keywords] of Object.entries(INGREDIENT_CATEGORIES)) {
        if (keywords.some(k => lower.includes(k))) return cat;
    }
    // Fallback: check if the token name itself is a category
    if (INGREDIENT_CATEGORIES[lower]) return lower;
    return null;
}

/**
 * Analizza il contesto testuale dopo un token per capire a cosa si riferisce realmente.
 */
function getContextIngredient(text, tokenEnd) {
    // Prendi i 60 caratteri dopo il token per capire il contesto
    const after = text.substring(tokenEnd, tokenEnd + 60).toLowerCase();
    
    // Pattern: "{token}g di INGREDIENTE" o "{token}g INGREDIENTE"
    const contextMatch = after.match(/^g?\s*(?:di\s+)?(\w[\w\s']*?)(?:\s*[,.\(\{]|$)/);
    if (!contextMatch) return null;
    
    const contextWord = contextMatch[1].trim();
    return categorizeIngredient(contextWord);
}

function processRecipe(filePath) {
    const raw = readFileSync(filePath, 'utf-8');
    const recipe = JSON.parse(raw);
    const slug = recipe.slug || basename(filePath, '.json');
    
    // Raccogli tutti gli ingredienti con i loro grammi
    const ingredients = new Map(); // name → { grams, category, group }
    for (const g of (recipe.ingredientGroups || [])) {
        for (const item of (g.items || [])) {
            const cat = categorizeIngredient(item.name);
            ingredients.set(item.name, { grams: item.grams, category: cat, group: g.group });
        }
    }

    const fixes = [];
    const stepKeys = ['stepsSpiral', 'stepsHand', 'stepsExtruder', 'stepsCondiment'];
    
    // Anche variants altSteps
    const allStepArrays = [];
    for (const k of stepKeys) {
        if (recipe[k]?.length) allStepArrays.push({ key: k, steps: recipe[k] });
    }
    for (const v of (recipe.variants || [])) {
        if (v.altSteps?.length) allStepArrays.push({ key: `variants[${v.id}].altSteps`, steps: v.altSteps });
    }

    for (const { key, steps } of allStepArrays) {
        for (let si = 0; si < steps.length; si++) {
            const step = steps[si];
            if (!step.text) continue;
            
            let newText = step.text;
            let modified = false;

            // Find all tokens and check context
            const tokenRegex = new RegExp(TOKEN_RE.source, 'g');
            let match;
            const replacements = [];

            while ((match = tokenRegex.exec(step.text)) !== null) {
                const [fullMatch, tokenName, tokenValue, fixedSuffix] = match;
                const tokenCategory = categorizeToken(tokenName);
                const contextCategory = getContextIngredient(step.text, match.index + fullMatch.length);
                
                if (contextCategory && tokenCategory && contextCategory !== tokenCategory) {
                    // MISMATCH! Il token dice una cosa, il contesto dice un'altra
                    
                    // Trova l'ingrediente giusto basandosi sul contesto + grammi
                    const grams = parseFloat(tokenValue);
                    let bestIngredient = null;
                    let bestName = null;
                    
                    for (const [name, info] of ingredients) {
                        if (info.category === contextCategory && info.grams === grams) {
                            bestIngredient = info;
                            bestName = name;
                            break;
                        }
                    }
                    
                    if (!bestIngredient) {
                        // Fallback: cerca solo per categoria
                        for (const [name, info] of ingredients) {
                            if (info.category === contextCategory) {
                                bestIngredient = info;
                                bestName = name;
                                break;
                            }
                        }
                    }

                    // Genera nuovo nome token
                    const groupSuffix = bestIngredient?.group 
                        ? '_' + bestIngredient.group.replace(/^Per\s+(la|il|lo|l'|i|le|gli)\s*/i, '').toLowerCase().replace(/[\s']+/g, '_').replace(/[^a-z0-9_]/g, '')
                        : '';
                    const newTokenName = contextCategory + groupSuffix;
                    const newValue = bestIngredient?.grams ?? grams;
                    const newToken = `{${newTokenName}:${newValue}${fixedSuffix || ''}}`;
                    
                    replacements.push({
                        old: fullMatch,
                        new: newToken,
                        reason: `token "${tokenName}" (${tokenCategory}) → contesto "${contextCategory}" [${bestName || '?'}]`
                    });
                }
            }

            // Applica le sostituzioni
            for (const rep of replacements) {
                newText = newText.replace(rep.old, rep.new);
                modified = true;
                fixes.push({
                    step: `${key}[${si}] "${step.title}"`,
                    old: rep.old,
                    new: rep.new,
                    reason: rep.reason
                });
            }

            if (modified) {
                step.text = newText;
            }
        }
    }

    return { slug, recipe, fixes, raw };
}

// ── Main ──
console.log(`\n🔧 Batch Token Fix ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}\n`);

let totalFixes = 0;
let totalRecipes = 0;
let fixedRecipes = 0;

for (const cat of readdirSync(RECIPES_DIR)) {
    const catDir = resolve(RECIPES_DIR, cat);
    try {
        for (const f of readdirSync(catDir)) {
            if (!f.endsWith('.json') || f === 'index.json') continue;
            
            const filePath = resolve(catDir, f);
            const slug = f.replace('.json', '');
            
            if (ONLY_SLUG && slug !== ONLY_SLUG) continue;
            
            totalRecipes++;
            const { fixes, recipe } = processRecipe(filePath);
            
            if (fixes.length > 0) {
                fixedRecipes++;
                totalFixes += fixes.length;
                
                console.log(`\n📝 ${recipe.title || slug} — ${fixes.length} fix`);
                for (const fix of fixes) {
                    console.log(`   ${fix.step}`);
                    console.log(`     ❌ ${fix.old}`);
                    console.log(`     ✅ ${fix.new}`);
                    console.log(`     💡 ${fix.reason}`);
                }
                
                if (!DRY_RUN) {
                    writeFileSync(filePath, JSON.stringify(recipe, null, 2) + '\n', 'utf-8');
                    console.log(`   ✅ Salvato`);
                }
            }
        }
    } catch {}
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`📊 Risultati: ${totalFixes} fix su ${fixedRecipes}/${totalRecipes} ricette`);
if (DRY_RUN) console.log(`⚠️  DRY RUN — Nessuna modifica applicata. Rimuovi --dry-run per applicare.`);
console.log('');
