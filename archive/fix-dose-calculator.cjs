/**
 * Fix dose-calculator: imposta value e min al valore reale della base farina
 * Legge data-base-total dall'HTML e ricalcola value e min corretti
 */
const fs = require('fs');
const path = require('path');

const base = path.resolve(__dirname, '../Ricettario/ricette');
const catDirs = ['pane', 'pasta', 'pizza', 'lievitati', 'focaccia'];
let updated = 0;

for (const dir of catDirs) {
    const dirPath = path.join(base, dir);
    if (!fs.existsSync(dirPath)) continue;
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.html') && f !== 'index.html');

    for (const file of files) {
        const fp = path.join(dirPath, file);
        let html = fs.readFileSync(fp, 'utf-8');

        // Estrai data-base-total dal dose-input
        const match = html.match(/id="dose-input"\s+value="([^"]+)"\s+min="([^"]+)"\s+max="([^"]+)"\s+step="([^"]+)"\s+data-base-total="(\d+)"/);
        if (!match) continue;

        const [, oldValue, oldMin, oldMax, oldStep, baseTotalStr] = match;
        const baseTotal = parseInt(baseTotalStr);
        const baseKg = Math.round((baseTotal / 1000) * 10) / 10; // reale, 1 decimale

        if (parseFloat(oldValue) === baseKg) {
            continue; // già corretto
        }

        const newMin = baseKg;  // min = base (×1)
        const newStep = baseKg; // step = base kg

        // Sostituisci i valori nell'input
        html = html.replace(
            /id="dose-input"\s+value="[^"]+"\s+min="[^"]+"\s+max="[^"]+"\s+step="[^"]+"/,
            `id="dose-input" value="${baseKg}" min="${newMin}" max="${oldMax}" step="${baseKg}"`
        );

        fs.writeFileSync(fp, html, 'utf-8');
        updated++;
        console.log(`  ✅ ${dir}/${file}: ${oldValue}kg → ${baseKg}kg (base: ${baseTotal}g)`);
    }
}

console.log(`\n📋 Dose calculator aggiornati: ${updated}`);
