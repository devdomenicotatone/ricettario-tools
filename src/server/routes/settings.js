/**
 * ROUTES/SETTINGS — Gemini API key switching, health/status
 */

export function setupSettingsRoutes(app) {

    // ── Gemini API Key Switching ──
    app.get('/api/gemini-key', async (req, res) => {
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
