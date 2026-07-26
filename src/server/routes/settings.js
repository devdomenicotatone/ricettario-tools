/**
 * ROUTES/SETTINGS — Gemini API key switching, health/status
 */

/**
 * Queste rotte raccontano com'è configurata la macchina: quali servizi hanno una
 * chiave e le ultime sei cifre di quelle Gemini. Non c'è autenticazione, quindi
 * l'unica barriera è che la richiesta arrivi dal computer stesso. Il server
 * ascolta già solo su 127.0.0.1 (src/server/index.js), ma quel bind è una riga
 * sola: questo è il controllo di riserva se domani qualcuno la cambia.
 *
 * Cosa NON copre, per non illudersi: dietro un reverse proxy sulla stessa
 * macchina l'indirizzo del socket è quello del proxy (127.0.0.1), quindi una
 * richiesta arrivata dalla rete passerebbe con il corpo completo (verificato).
 * Se il proxy diventa uno scenario vero, l'unica difesa è un segreto condiviso,
 * non l'indirizzo del socket.
 *
 * Non copre nemmeno il DNS rebinding, per lo stesso motivo: lì il browser È su
 * questa macchina, quindi il socket dice 127.0.0.1 anche se la pagina è di un
 * sito ostile. `GET /api/gemini-key` rispondeva 200 con le anteprime delle chiavi
 * (verificato). A chiuderlo è il controllo sull'header `Host` in
 * src/server/index.js: se qualcuno lo toglie, questa GET torna leggibile.
 * Restituisce true se si può procedere; altrimenti ha già risposto 403.
 */
function soloDalComputerLocale(req, res) {
    const indirizzo = (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    if (indirizzo === '127.0.0.1' || indirizzo === '::1') return true;

    console.warn(`⛔ ${req.method} ${req.url} rifiutata: arriva da ${indirizzo || 'origine sconosciuta'}`);
    res.status(403).json({ error: 'Accessibile solo dal computer locale' });
    return false;
}

export function setupSettingsRoutes(app) {

    // ── Gemini API Key Switching ──
    app.get('/api/gemini-key', async (req, res) => {
        if (!soloDalComputerLocale(req, res)) return;
        // Le anteprime delle chiavi non devono restare nella cache del browser.
        res.set('Cache-Control', 'no-store');
        try {
            const { getActiveGeminiSlot } = await import('../../utils/api.js');
            res.json({
                activeSlot: getActiveGeminiSlot(),
                hasKey1: !!process.env.GEMINI_API_KEY,
                hasKey2: !!process.env.GEMINI_API_KEY2,
                key1Preview: process.env.GEMINI_API_KEY ? '...' + process.env.GEMINI_API_KEY.slice(-6) : null,
                key2Preview: process.env.GEMINI_API_KEY2 ? '...' + process.env.GEMINI_API_KEY2.slice(-6) : null,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/gemini-key', async (req, res) => {
        if (!soloDalComputerLocale(req, res)) return;
        const { slot } = req.body;
        if (slot !== 1 && slot !== 2) {
            return res.status(400).json({ error: 'Slot deve essere 1 o 2' });
        }
        try {
            const { switchGeminiKey, getActiveGeminiSlot } = await import('../../utils/api.js');
            switchGeminiKey(slot);
            res.json({
                ok: true,
                activeSlot: getActiveGeminiSlot(),
                message: `Gemini API Key switchata a slot ${slot}`,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Status / Health ──
    app.get('/api/status', async (req, res) => {
        if (!soloDalComputerLocale(req, res)) return;
        res.set('Cache-Control', 'no-store');

        // Leggi URL del sito Vite da env o usa default
        const siteUrl = process.env.SITE_URL || 'http://localhost:5173/Ricettario/';

        let geminiSlot = 1;
        try {
            const { getActiveGeminiSlot } = await import('../../utils/api.js');
            geminiSlot = getActiveGeminiSlot();
        } catch {}

        res.json({
            status: 'ok',
            uptime: process.uptime(),
            siteUrl,
            hasAnthropic: !!process.env.ANTHROPIC_API_KEY,
            hasGemini: !!process.env.GEMINI_API_KEY,
            hasGemini2: !!process.env.GEMINI_API_KEY2,
            geminiSlot,
            hasSerpApi: !!process.env.SERPAPI_KEY,
            hasPexels: !!process.env.PEXELS_API_KEY,
            hasUnsplash: !!process.env.UNSPLASH_ACCESS_KEY,
            hasPixabay: !!process.env.PIXABAY_API_KEY,
            hasDataForSeo: !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
        });
    });
}
