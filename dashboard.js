#!/usr/bin/env node

/**
 * RICETTARIO TOOLS — Dashboard Web
 *
 * Avvia un server Express con WebSocket per gestire
 * tutte le operazioni del Ricettario da una UI web.
 *
 * Uso: node dashboard.js [--port 3500]
 */

import 'dotenv/config';
import { startServer } from './src/server/index.js';

const port = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '3500');

startServer(port);
