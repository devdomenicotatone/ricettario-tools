/**
 * COMANDO: immagini — Aggiorna immagini per le ricette
 * Con --nome: aggiorna solo la ricetta specificata (slug o parte del nome)
 * Senza --nome: aggiorna tutte le ricette
 */

import { resolve } from 'path';
import { readdirSync, readFileSync } from 'fs';
import { findAndDownloadImage } from '../image-finder.js';
import { log } from '../utils/logger.js';
import {
    cartellaCategoria,
    eFileDiRicetta,
    etichetteAmmesse,
    radiceRicettario,
    slugDaNomeFile,
} from '../utils/percorsi-ricette.js';

export async function aggiornaImmagini(args) {
    const ricettarioPath = radiceRicettario(args.output);
    const filterSlug = args.nome?.toLowerCase().replace(/\s+/g, '-') || null;

    if (filterSlug) {
        log.header(`AGGIORNAMENTO IMMAGINE — ${filterSlug}`);
    } else {
        log.header('AGGIORNAMENTO IMMAGINI — Tutte le ricette');
    }

    const results = [];
    const usedUrls = new Set();

    // Le categorie arrivano dal registry del sito, non da un elenco scritto qui.
    // Quello di prima ne conosceva cinque su nove — e fra queste "pasta", che il
    // sito ha rinominato "Primi" mesi fa — quindi condimenti (82 ricette),
    // conserve, primi e secondi-piatti non venivano mai guardati. Ora una
    // categoria aggiunta al sito entra in questo comando da sola.
    for (const categoria of etichetteAmmesse()) {
        const cartella = cartellaCategoria(categoria);
        const dirPath = resolve(ricettarioPath, 'ricette', cartella);

        // Le ricette sono file .json: il sito è una SPA e le pagine .html non
        // esistono più. Cercandole, questo comando scandiva nove cartelle e non
        // trovava mai niente. `eFileDiRicetta` scarta anche index.json e i file
        // di lavoro (.backup.json, .pre-edit.json, .qualita.json), che non sono
        // ricette e per cui non ha senso scaricare una foto.
        let files;
        try { files = readdirSync(dirPath).filter(eFileDiRicetta); }
        catch { continue; }

        for (const file of files) {
            const slug = slugDaNomeFile(file);

            // Filtro per slug: se --nome è specificato, skip tutto tranne il match
            if (filterSlug && !slug.includes(filterSlug) && !filterSlug.includes(slug)) {
                continue;
            }

            const filePath = resolve(dirPath, file);
            let ricetta = {};
            try { ricetta = JSON.parse(readFileSync(filePath, 'utf-8')) || {}; }
            catch (err) { log.warn(`${file} non leggibile (${err.message}): salto.`); continue; }

            const recipeName = ricetta.title?.trim() || slug.replace(/-/g, ' ');

            log.separator();
            log.info(`${recipeName} (${categoria})`);

            const imageData = await findAndDownloadImage(
                {
                    title: recipeName,
                    // L'etichetta del registry ("Secondi Piatti"), non la cartella
                    // capitalizzata a mano: da "secondi-piatti" usciva
                    // "Secondi-piatti", una categoria che il registry non conosce.
                    category: categoria,
                    slug,
                    imageKeywords: ricetta.imageKeywords || [],
                },
                ricettarioPath,
                usedUrls
            );

            // L'insieme non veniva mai riempito: nella stessa esecuzione due
            // ricette potevano ricevere la stessa identica foto.
            if (imageData?.url) usedUrls.add(imageData.url);

            results.push({
                name: recipeName,
                category: categoria,
                found: !!imageData,
                image: imageData?.homeRelativePath || null,
            });

            if (!filterSlug) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    if (results.length === 0) {
        if (filterSlug) log.warn(`Nessuna ricetta trovata con slug "${filterSlug}"`);
        else log.warn('Nessuna ricetta trovata sotto ricette/.');
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
    // Il comando scarica il file ma non riscrive il JSON della ricetta: se il
    // campo `image` non c'era, va impostato dall'editor (o rigenerando la
    // ricetta). È il comportamento di sempre, non un effetto di questa modifica.
}
