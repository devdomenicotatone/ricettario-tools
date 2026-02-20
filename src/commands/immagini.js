/**
 * COMANDO: immagini — Aggiorna immagini da Wikimedia per tutte le ricette
 */

import { resolve } from 'path';
import { readdirSync, readFileSync } from 'fs';
import { findAndDownloadImage } from '../image-finder.js';
import { log } from '../utils/logger.js';

export async function aggiornaImmagini(args) {
    const ricettarioPath = resolve(process.cwd(), args.output || process.env.RICETTARIO_PATH || '../Ricettario');
    log.header('AGGIORNAMENTO IMMAGINI — Multi-Provider');

    const recipeDirs = ['pane', 'pizza', 'pasta', 'lievitati', 'focaccia'];
    const results = [];
    const usedUrls = new Set();

    for (const dir of recipeDirs) {
        const dirPath = resolve(ricettarioPath, 'ricette', dir);
        let files;
        try { files = readdirSync(dirPath).filter(f => f.endsWith('.html')); }
        catch { continue; }

        for (const file of files) {
            const filePath = resolve(dirPath, file);
            const html = readFileSync(filePath, 'utf-8');

            const titleMatch = html.match(/<title>([^<]+?)\s*[—–-]/);
            const recipeName = titleMatch?.[1]?.trim() || file.replace('.html', '').replace(/-/g, ' ');
            const category = dir.charAt(0).toUpperCase() + dir.slice(1);

            log.separator();
            log.info(`${recipeName} (${category})`);

            const imageData = await findAndDownloadImage(
                { title: recipeName, category, slug: file.replace('.html', ''), imageKeywords: [] },
                ricettarioPath,
                usedUrls
            );

            results.push({
                name: recipeName,
                category,
                found: !!imageData,
                image: imageData?.homeRelativePath || null,
            });

            await new Promise(r => setTimeout(r, 2000));
        }
    }

    log.header('RIEPILOGO IMMAGINI');
    for (const r of results) {
        const emoji = r.found ? '🟢' : '🔴';
        console.log(`  ${emoji} ${r.name} → ${r.image || 'nessuna immagine'}`);
    }
    const found = results.filter(r => r.found).length;
    log.info(`${found}/${results.length} immagini scaricate`);
    log.info('Salvate in: images/ricette/');
}
