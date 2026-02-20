import 'dotenv/config';
import https from 'https';
import fs from 'fs';
import path from 'path';

const PEXELS_KEY = process.env.PEXELS_API_KEY;
const OUT_DIR = 'C:/Users/dom19/Desktop/Ricettario/Ricettario/Ricettario/images/categories';

function pexelsSearch(query) {
    return new Promise((resolve, reject) => {
        const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`;
        https.get(url, { headers: { Authorization: PEXELS_KEY } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

function download(url, filepath) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return download(res.headers.location, filepath).then(resolve).catch(reject);
            }
            const file = fs.createWriteStream(filepath);
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
    });
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    // Lievitati hero
    console.log('🔍 Cerco immagine per Lievitati...');
    const r1 = await pexelsSearch('fresh croissants pastry bakery golden');
    const lievImg = r1.photos[0];
    console.log(`  🏆 "${lievImg.alt}" — ${lievImg.src.large2x}`);
    await download(lievImg.src.large2x, path.join(OUT_DIR, 'lievitati-hero.jpg'));
    console.log('  ✅ Salvata lievitati-hero.jpg');

    // Dolci hero
    console.log('🔍 Cerco immagine per Dolci...');
    const r2 = await pexelsSearch('italian biscotti cookies pastry dessert');
    const dolciImg = r2.photos[0];
    console.log(`  🏆 "${dolciImg.alt}" — ${dolciImg.src.large2x}`);
    await download(dolciImg.src.large2x, path.join(OUT_DIR, 'dolci-hero.jpg'));
    console.log('  ✅ Salvata dolci-hero.jpg');
}

main().catch(console.error);
