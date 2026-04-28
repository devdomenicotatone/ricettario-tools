/**
 * ROUTES/SEO — Suggerimenti SEO per categorie
 */

export function setupSeoRoutes(app) {

    // ── SEO Suggestions ──
    app.get('/api/seo-suggestions', async (req, res) => {
        const category = req.query.category || 'Pane';
        const forceRefresh = req.query.refresh === 'true';

        try {
            const { getSeoSuggestions, getAvailableCategories } = await import('../../seo-keywords.js');
            const categories = getAvailableCategories();

            // Rimosso il check restrittivo: !categories.includes(category) 
            // per abilitare generazioni dinamiche dall'AI

            const suggestions = await getSeoSuggestions(category, { forceRefresh });
            res.json({ category, suggestions, categories });
        } catch (err) {
            console.error('SEO Suggestions error:', err);
            res.status(500).json({ error: err.message });
        }
    });
}
