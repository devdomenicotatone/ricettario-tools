/**
 * COMANDO: immagini — Aggiorna immagini per le ricette
 * Con --nome: aggiorna solo la ricetta specificata (slug o parte del nome)
 * Senza --nome: aggiorna tutte le ricette
 */

import { resolve } from 'path';
import { readdirSync, readFileSync } from 'fs';
import { findAndDownloadImage } from '../image-finder.js';
import { log } from '../utils/logger.js';

export async function aggiornaImmagini(args) {
    const ricettarioPath = resolve(process.cwd(), args.output || process.env.RICETTARIO_PATH || '../Ricettario');
    const filterSlug = args.nome?.toLowerCase().replace(/\s+/g, '-') || null;

    if (filterSlug) {
        log.header(`AGGIORNAMENTO IMMAGINE — ${filterSlug}`);
    } else {
        log.header('AGGIORNAMENTO IMMAGINI — Tutte le ricette');
    }

    const recipeDirs = ['pane', 'pizza', 'pasta', 'lievitati', 'focaccia'];
    const results = [];
    const usedUrls = new Set();

    for (const dir of recipeDirs) {
        const dirPath = resolve(ricettarioPath, 'ricette', dir);
        let files;
        try { files = readdirSync(dirPath).filter(f => f.endsWith('.html') && f !== 'index.html'); }
        catch { continue; }

        for (const file of files) {
            const slug = file.replace('.html', '');

            // Filtro per slug: se --nome è specificato, skip tutto tranne il match
            if (filterSlug && !slug.includes(filterSlug) && !filterSlug.includes(slug)) {
                continue;
            }

            const filePath = resolve(dirPath, file);
            const html = readFileSync(filePath, 'utf-8');

            const titleMatch = html.match(/<title>([^<]+?)\s*[—–-]/);
            const recipeName = titleMatch?.[1]?.trim() || slug.replace(/-/g, ' ');
            const category = dir.charAt(0).toUpperCase() + dir.slice(1);

            log.separator();
            log.info(`${recipeName} (${category})`);

            const imageData = await findAndDownloadImage(
                { title: recipeName, category, slug, imageKeywords: [] },
                ricettarioPath,
                usedUrls
            );

            results.push({
                name: recipeName,
                category,
                found: !!imageData,
                image: imageData?.homeRelativePath || null,
            });

            if (!filterSlug) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    if (results.length === 0 && filterSlug) {
        log.warn(`Nessuna ricetta trovata con slug "${filterSlug}"`);
        return;
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
