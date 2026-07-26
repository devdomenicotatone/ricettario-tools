/**
 * Alias di comodo per risincronizzare l'indice delle ricette del sito.
 *
 * Fa esattamente quello che fa `npm run crea -- --sync-cards`: chiama
 * `syncCards`, che lancia `scripts/build-recipes.js` nel repo del sito e
 * riscrive `public/recipes.json`. Nessuno lo importa e non è in package.json
 * né nel README — se un giorno dà fastidio, si può cancellare senza rimpianti.
 *
 * Parte SOLO se lanciato a mano: prima chiamava `syncCards({})` all'ultima
 * riga, quindi bastava importarlo per riscrivere l'indice del sito.
 *
 * Uso:  node run-sync.mjs
 */
import { syncCards } from './src/commands/sync-cards.js';
import { pathToFileURL } from 'url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    syncCards({}).catch(console.error);
}
