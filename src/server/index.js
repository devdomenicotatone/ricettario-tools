/**
 * SERVER — Express + WebSocket setup
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { exec } from 'child_process';
import { setupRoutes } from './routes.js';
import { setupWebSocket } from './ws-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function startServer(port = 3500) {
    const app = express();
    const server = createServer(app);

    // ── Middleware ──
    app.use(express.json({ limit: '5mb' }));
    app.use(express.urlencoded({ extended: true }));

    // ── Static files (dashboard UI) ──
    const dashboardPath = resolve(__dirname, '..', 'dashboard');
    app.use(express.static(dashboardPath));

    // ── Static files (Ricettario public — immagini, ecc.) ──
    const ricettarioPublic = resolve(
        process.cwd(),
        process.env.RICETTARIO_PATH || '../Ricettario',
        'public'
    );
    app.use(express.static(ricettarioPublic));

    // ── API Routes ──
    setupRoutes(app);

    // ── WebSocket ──
    const wss = new WebSocketServer({ server, path: '/ws' });
    setupWebSocket(wss);

    // ── Start ──
    server.listen(port, () => {
        console.log('');
        console.log('  🔥 ═══════════════════════════════════════');
        console.log('     RICETTARIO TOOLS — Dashboard');
        console.log('  ═══════════════════════════════════════════');
        console.log('');
        console.log(`     🌐 http://localhost:${port}`);
        console.log('     📡 WebSocket: /ws');
        console.log('');
        console.log('     Premi Ctrl+C per fermare');
        console.log('');

        // Apri nel browser
        const url = `http://localhost:${port}`;
        const cmd = process.platform === 'win32'
            ? `cmd.exe /c start "" "${url}"`
            : process.platform === 'darwin'
                ? `open "${url}"`
                : `xdg-open "${url}"`;
        exec(cmd);
    });

    return server;
}

