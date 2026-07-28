import 'dotenv/config';
import { searchFoods } from './src/fdc.js';

// Prova al volo della chiave USDA FoodData Central: cerca un ingrediente
// e stampa i macro per 100 g delle prime voci trovate.
// Uso:  node test-fdc.mjs [query in inglese]     (default: "wheat flour")

const query = process.argv.slice(2).join(' ') || 'wheat flour';

try {
    const voci = await searchFoods(query, { pageSize: 5 });
    if (voci.length === 0) {
        console.log(`Nessuna voce FDC per "${query}" (dataType Foundation/SR Legacy).`);
    } else {
        console.log(`Voci FDC per "${query}" — nutrienti per 100 g:\n`);
        for (const v of voci) {
            const n = v.per100g;
            console.log(`- [${v.fdcId}] ${v.description} (${v.dataType})`);
            console.log(`    kcal ${n.kcal ?? '—'} | carboidrati ${n.carbs ?? '—'} g | proteine ${n.protein ?? '—'} g | grassi ${n.fat ?? '—'} g`);
        }
    }
    if (process.env.FDC_API_KEY === 'DEMO_KEY') {
        console.log('\nNota: stai usando DEMO_KEY (30 richieste/ora, 50/giorno): ok per le prove, non per i batch.');
    }
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
