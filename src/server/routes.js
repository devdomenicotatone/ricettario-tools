/**
 * ROUTES — API endpoints per la Dashboard
 *
 * Orchestrator: importa e monta i sotto-moduli di routing per dominio.
 * Ogni modulo registra i propri endpoint su `app`.
 */

import { createJobContext, withOutputCapture } from './ws-handler.js';
import { getRicettarioPath, findRecipeJsonDynamic, nextJobId } from './routes/_helpers.js';
import { setupRecipeRoutes } from './routes/recipes.js';
import { setupImageRoutes } from './routes/image.js';
import { setupQualityRoutes } from './routes/quality.js';
import { setupCategoryRoutes } from './routes/categories.js';
import { setupSeoRoutes } from './routes/seo.js';
import { setupSettingsRoutes } from './routes/settings.js';

export function setupRoutes(app) {
    // Helpers condivisi iniettati in ogni modulo
    const helpers = {
        getRicettarioPath,
        findRecipeJsonDynamic,
        nextJobId,
        createJobContext,
        withOutputCapture,
    };

    setupRecipeRoutes(app, helpers);
    setupImageRoutes(app, helpers);
    setupQualityRoutes(app, helpers);
    setupCategoryRoutes(app, helpers);
    setupSeoRoutes(app, helpers);
    setupSettingsRoutes(app, helpers);
}
