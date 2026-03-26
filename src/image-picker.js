/**
 * IMAGE PICKER — Selettore visuale immagini via browser
 *
 * Avvia un server HTTP locale, serve una gallery con tutti i risultati
 * raggruppati per provider, e restituisce l'immagine selezionata dall'utente.
 */

import { createServer } from 'http';
import { log } from './utils/logger.js';
import { exec } from 'child_process';

/**
 * Genera l'HTML della gallery di selezione immagini.
 */
function generatePickerHtml(recipeName, providerResults) {
    const totalImages = providerResults.reduce((sum, p) => sum + p.images.length, 0);

    // Genera le tab e i contenuti per provider
    const tabs = providerResults
        .filter(p => p.images.length > 0)
        .map((p, i) => `<button class="tab${i === 0 ? ' active' : ''}" data-provider="${p.provider}">${p.emoji} ${p.provider} <span class="badge">${p.images.length}</span></button>`)
        .join('\n            ');

    const grids = providerResults
        .filter(p => p.images.length > 0)
        .map((p, i) => {
            const cards = p.images.map((img, j) => `
                <div class="card" onclick="selectImage(${JSON.stringify(img).replace(/"/g, '&quot;')})">
                    <div class="card-img-wrap">
                        <img src="${img.thumbUrl || img.url}" alt="${(img.title || '').replace(/"/g, '&quot;')}" loading="lazy">
                        <div class="card-score">${img.score}</div>
                        <div class="card-size">${img.width}×${img.height}</div>
                    </div>
                    <div class="card-info">
                        <div class="card-title">${(img.title || 'Senza titolo').substring(0, 60)}</div>
                        <div class="card-meta">📷 ${img.author || 'Sconosciuto'} · ${img.license || ''}</div>
                    </div>
                </div>`).join('');

            return `<div class="grid" data-provider="${p.provider}" style="display:${i === 0 ? 'grid' : 'none'}">${cards}</div>`;
        }).join('\n');

    return `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🖼️ Image Picker — ${recipeName}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Inter', sans-serif;
            background: #0f0f0f;
            color: #e0e0e0;
            min-height: 100vh;
        }

        .header {
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            padding: 32px 40px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
        }

        .header h1 {
            font-size: 24px;
            font-weight: 700;
            color: #fff;
            margin-bottom: 6px;
        }

        .header p {
            color: #8899aa;
            font-size: 14px;
        }

        .header .stats {
            margin-top: 12px;
            display: flex;
            gap: 16px;
        }

        .header .stat {
            background: rgba(255,255,255,0.06);
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 13px;
            color: #aabbcc;
        }

        .tabs {
            display: flex;
            gap: 8px;
            padding: 16px 40px;
            background: #151515;
            border-bottom: 1px solid #222;
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .tab {
            background: #1e1e1e;
            border: 1px solid #333;
            color: #bbb;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-family: inherit;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
        }

        .tab:hover { background: #2a2a2a; color: #fff; }
        .tab.active {
            background: #e67e22;
            color: #fff;
            border-color: #e67e22;
        }

        .badge {
            background: rgba(255,255,255,0.15);
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
            margin-left: 6px;
        }

        .tab.active .badge { background: rgba(255,255,255,0.3); }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 16px;
            padding: 24px 40px;
        }

        .card {
            background: #1a1a1a;
            border-radius: 12px;
            overflow: hidden;
            cursor: pointer;
            transition: all 0.25s ease;
            border: 2px solid transparent;
        }

        .card:hover {
            transform: translateY(-4px);
            border-color: #e67e22;
            box-shadow: 0 8px 30px rgba(230, 126, 34, 0.2);
        }

        .card-img-wrap {
            position: relative;
            height: 200px;
            overflow: hidden;
            background: #111;
        }

        .card-img-wrap img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.3s;
        }

        .card:hover .card-img-wrap img { transform: scale(1.05); }

        .card-score {
            position: absolute;
            top: 8px;
            right: 8px;
            background: rgba(0,0,0,0.7);
            backdrop-filter: blur(8px);
            color: #4caf50;
            font-weight: 700;
            font-size: 13px;
            padding: 4px 10px;
            border-radius: 6px;
        }

        .card-size {
            position: absolute;
            bottom: 8px;
            left: 8px;
            background: rgba(0,0,0,0.7);
            backdrop-filter: blur(8px);
            color: #aaa;
            font-size: 11px;
            padding: 3px 8px;
            border-radius: 4px;
        }

        .card-info { padding: 12px 14px; }

        .card-title {
            font-size: 13px;
            font-weight: 500;
            color: #ddd;
            line-height: 1.4;
            margin-bottom: 4px;
        }

        .card-meta {
            font-size: 11px;
            color: #777;
        }

        /* Selected overlay */
        .overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.85);
            backdrop-filter: blur(10px);
            z-index: 999;
            justify-content: center;
            align-items: center;
        }

        .overlay.active { display: flex; }

        .confirm-box {
            background: #1e1e1e;
            border-radius: 16px;
            padding: 32px;
            max-width: 600px;
            width: 90%;
            text-align: center;
            border: 1px solid #333;
        }

        .confirm-box img {
            max-width: 100%;
            max-height: 300px;
            border-radius: 10px;
            margin-bottom: 20px;
        }

        .confirm-box h3 { color: #fff; margin-bottom: 8px; }
        .confirm-box p { color: #888; font-size: 13px; margin-bottom: 20px; }

        .btn-row { display: flex; gap: 12px; justify-content: center; }

        .btn {
            padding: 12px 28px;
            border-radius: 8px;
            font-family: inherit;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            border: none;
            transition: all 0.2s;
        }

        .btn-confirm {
            background: #e67e22;
            color: #fff;
        }
        .btn-confirm:hover { background: #d35400; }

        .btn-cancel {
            background: #333;
            color: #aaa;
        }
        .btn-cancel:hover { background: #444; color: #fff; }

        .empty-msg {
            text-align: center;
            padding: 60px 20px;
            color: #555;
            font-size: 16px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🖼️ Image Picker</h1>
        <p>Seleziona l'immagine di copertina per <strong>${recipeName}</strong></p>
        <div class="stats">
            <span class="stat">📊 ${totalImages} immagini trovate</span>
            <span class="stat">🔌 ${providerResults.filter(p => p.images.length > 0).length} provider attivi</span>
        </div>
    </div>

    <div class="tabs">
        ${tabs}
    </div>

    ${grids}

    <div class="overlay" id="overlay">
        <div class="confirm-box">
            <img id="confirm-img" src="" alt="">
            <h3 id="confirm-title"></h3>
            <p id="confirm-meta"></p>
            <div class="btn-row">
                <button class="btn btn-cancel" onclick="cancelSelection()">Annulla</button>
                <button class="btn btn-confirm" onclick="confirmSelection()">✅ Usa questa immagine</button>
            </div>
        </div>
    </div>

    <script>
        let selectedImage = null;

        // Tab switching
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.grid').forEach(g => g.style.display = 'none');
                const target = document.querySelector('.grid[data-provider="' + tab.dataset.provider + '"]');
                if (target) target.style.display = 'grid';
            });
        });

        function selectImage(img) {
            selectedImage = img;
            document.getElementById('confirm-img').src = img.thumbUrl || img.url;
            document.getElementById('confirm-title').textContent = img.title || 'Senza titolo';
            document.getElementById('confirm-meta').textContent =
                img.width + '×' + img.height + ' · ' + (img.author || '') + ' · ' + (img.provider || '') + ' · ' + (img.license || '');
            document.getElementById('overlay').classList.add('active');
        }

        function cancelSelection() {
            selectedImage = null;
            document.getElementById('overlay').classList.remove('active');
        }

        async function confirmSelection() {
            if (!selectedImage) return;
            document.querySelector('.btn-confirm').textContent = '⏳ Scaricando...';
            document.querySelector('.btn-confirm').disabled = true;

            try {
                const resp = await fetch('/select', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(selectedImage),
                });
                if (resp.ok) {
                    document.querySelector('.confirm-box').innerHTML =
                        '<h3 style="color:#4caf50">✅ Immagine selezionata!</h3>' +
                        '<p style="color:#888">Puoi chiudere questa pagina.</p>';
                }
            } catch (err) {
                alert('Errore: ' + err.message);
            }
        }
    </script>
</body>
</html>`;
}

/**
 * Avvia il server Image Picker e restituisce l'immagine selezionata.
 *
 * @param {string} recipeName
 * @param {Array} providerResults - Risultati da searchAllProviders
 * @returns {Promise<object>} L'immagine selezionata dall'utente
 */
export function startImagePicker(recipeName, providerResults) {
    return new Promise((resolve) => {
        const html = generatePickerHtml(recipeName, providerResults);

        const server = createServer((req, res) => {
            if (req.method === 'GET' && req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(html);
                return;
            }

            if (req.method === 'POST' && req.url === '/select') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true }));

                    const selected = JSON.parse(body);
                    // Chiudi il server dopo 1s (tempo per la risposta)
                    setTimeout(() => {
                        server.close();
                        resolve(selected);
                    }, 1000);
                });
                return;
            }

            res.writeHead(404);
            res.end('Not Found');
        });

        // Porta random tra 9100-9199
        const port = 9100 + Math.floor(Math.random() * 100);
        server.listen(port, () => {
            const url = `http://localhost:${port}`;
            log.info(`🖼️  Image Picker aperto: ${url}`);

            // Apri nel browser
            const cmd = process.platform === 'win32'
                ? `cmd.exe /c start "" "${url}"`
                : process.platform === 'darwin'
                    ? `open "${url}"`
                    : `xdg-open "${url}"`;

            exec(cmd, (err) => {
                if (err) log.warn(`Impossibile aprire il browser: ${err.message}`);
            });
        });
    });
}
