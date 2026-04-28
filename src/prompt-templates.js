/**
 * PROMPT TEMPLATES — Regole centralizzate per la generazione prompt immagini AI
 * 
 * Unico punto di verità per:
 *   - Positive framing (anti-testo nelle immagini generate)
 *   - Regole stilistiche di food photography
 *   - Vincoli di composizione
 * 
 * Usato da: routes.js (craft-prompt + quick generate)
 */

// ── Regole positive framing (anti-testo) ──
// NOTA: Non usare MAI "no text", "no labels", "unlabeled" etc.
// Il modello di immagini interpreta i token negativi come istruzioni positive.
// Descrivere SOLO ciò che si vuole vedere, mai ciò che NON si vuole.
const POSITIVE_FRAMING_RULES = `- CRITICAL — POSITIVE FRAMING ONLY: Describe containers as "plain smooth clear glass", "simple transparent glassware", or "bare ceramic bowls". Describe butter as "a bare golden block of butter on parchment paper". Describe all ingredients as raw, loose, unpackaged — never mention packaging, wrappers, brands, text, or labels in any form.
- Focus on raw, natural, unpackaged ingredients and clean surfaces.`;

// ── Regole di composizione ──
const COMPOSITION_RULES = `- For sauces, dressings, or doughs: emphasize isolation — "A close-up macro shot isolating only the item in a small bowl, filling the frame".
- NEVER place whole raw ingredients (like a whole raw egg yolk or unpeeled garlic) on top of the finished dish unless explicitly instructed by the recipe. Plating must be authentic, mixed, and realistic.`;

// ── Regole base di fotografia ──
const PHOTOGRAPHY_RULES = `- Professional food photography, high quality, cinematic lighting.
- The prompt MUST be in English.
- Keep it under 450 characters.`;

/**
 * System prompt per il flusso "Craft Prompt" (con o senza riferimento visivo).
 * L'output di Gemini sarà un JSON { en, it }.
 */
export function buildCraftPromptSystem(hasReference) {
    let prompt = `You are an expert food photographer and AI image prompt engineer.
Your task: write a detailed, visually descriptive prompt for Imagen 4.0 to generate a professional food photo.
RULES:
${PHOTOGRAPHY_RULES}
${POSITIVE_FRAMING_RULES}
`;

    if (hasReference) {
        prompt += `- Analyze the provided reference image. Extract its STYLE: the lighting, the mood, the exact camera angle (e.g. 45-degree, overhead, eye-level), the background, and the props.
- IMPORTANT COMPOSITION RULE: If the reference image features raw ingredients scattered in the background/foreground as props (e.g., flour, butter, spices, utensils) and they match the recipe, YOU MUST explicitly include them in your text prompt to enrich the scene just like the reference.
- Write a prompt that APPLIES THIS STYLE and COMPOSITION to the dish described in the recipe. Do not add ingredients that conflict with the recipe.
`;
    } else {
        prompt += `${COMPOSITION_RULES}
`;
    }

    prompt += `OUTPUT: a valid JSON object with exactly two fields:
  "en": the English prompt
  "it": a natural, accurate Italian translation
Output ONLY the JSON. No markdown, no code fences.`;

    return prompt;
}

/**
 * System prompt per il flusso "Quick Generate" (senza review utente).
 * L'output di Gemini sarà il prompt diretto (testo puro, no JSON).
 */
export function buildQuickGenerateSystem() {
    return `You are an expert food photographer and AI image prompt engineer.
Your task is to write a highly detailed, visually descriptive prompt for Google Imagen 4.0 to generate a photo of the provided recipe.
Focus exclusively on the visual appearance, key ingredients visible on the plate, lighting, and mood.
CRITICAL RULES:
${PHOTOGRAPHY_RULES}
- ONLY output the raw prompt, nothing else.
${POSITIVE_FRAMING_RULES}
${COMPOSITION_RULES}`;
}

/**
 * Costruisce il contesto della ricetta per il prompt.
 * Gestisce sia il formato ingredientGroups che il legacy ingredients.
 */
export function buildRecipeContext(recipe, userSuggestion = '') {
    const ingredients = recipe.ingredientGroups || recipe.ingredients || [];
    return `User suggestion: ${userSuggestion}\n\nRecipe Name: ${recipe.title || recipe.name}\nIngredients: ${JSON.stringify(ingredients)}\nDescription: ${recipe.description || ''}`;
}

// ── Termini proibiti nel prompt finale per Imagen ──
// Se presenti, il modello di immagini li interpreta come istruzioni
// e genera esattamente ciò che si voleva evitare.
const FORBIDDEN_TERMS = [
    // Frasi negative esplicite
    'no text', 'no label', 'no labels', 'no words', 'no writing',
    'no lettering', 'no branding', 'no logo', 'no logos',
    'without text', 'without label', 'without labels',
    'without words', 'without writing', 'text-free', 'label-free',
    // Termini che evocano testo/packaging anche in contesto positivo
    'unlabeled', 'unlabelled', 'unbranded', 'unsigned',
];

// Pattern regex compilata una sola volta (case-insensitive)
const FORBIDDEN_REGEX = new RegExp(
    FORBIDDEN_TERMS.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'gi'
);

/** Suffisso obbligatorio anti-testo — appeso a OGNI prompt per Imagen.
 *  Posizionato alla fine = massimo peso nell'attenzione del modello. */
const CLEAN_LABEL_SUFFIX = ' All containers, jars, lids, and surfaces are completely plain and smooth with zero text, zero markings, zero engravings, zero printed elements.';

/** Lunghezza massima del prompt per Imagen (incluso suffisso) */
const MAX_PROMPT_LENGTH = 480;

/**
 * Sanitizza il prompt generato da Gemini prima di inviarlo a Imagen.
 * 
 * 1. Rimuove termini proibiti (che causerebbero testo nelle immagini)
 * 2. Pulisce spazi/punteggiatura residui
 * 3. Appende il suffisso anti-testo obbligatorio
 * 4. Tronca a MAX_PROMPT_LENGTH caratteri (taglio pulito su parola)
 * 
 * @param {string} prompt - Il prompt grezzo generato da Gemini
 * @returns {{ prompt: string, wasModified: boolean, removedTerms: string[] }}
 */
export function sanitizeImagePrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') {
        return { prompt: prompt || '', wasModified: false, removedTerms: [] };
    }

    let sanitized = prompt;
    const removedTerms = [];

    // 1. Trova e rimuovi termini proibiti
    const matches = sanitized.match(FORBIDDEN_REGEX);
    if (matches) {
        removedTerms.push(...[...new Set(matches.map(m => m.toLowerCase()))]);
        sanitized = sanitized.replace(FORBIDDEN_REGEX, '');
    }

    // 2. Pulisci artefatti: doppi spazi, virgole doppie, spazi prima di punteggiatura
    sanitized = sanitized
        .replace(/\s{2,}/g, ' ')           // doppi spazi → singolo
        .replace(/,\s*,/g, ',')            // ,, → ,
        .replace(/\.\s*\./g, '.')          // .. → .
        .replace(/\s+([,.])/g, '$1')       // spazio prima di , o .
        .replace(/^[,.\s]+/, '')           // trim iniziale punteggiatura
        .trim();

    // 3. Tronca il corpo del prompt per lasciare spazio al suffisso
    const maxBody = MAX_PROMPT_LENGTH - CLEAN_LABEL_SUFFIX.length;
    if (sanitized.length > maxBody) {
        const truncated = sanitized.substring(0, maxBody);
        const lastSpace = truncated.lastIndexOf(' ');
        sanitized = lastSpace > maxBody * 0.8
            ? truncated.substring(0, lastSpace).replace(/[,\s]+$/, '') + '.'
            : truncated.replace(/[,\s]+$/, '') + '.';
    }

    // 4. Appendi suffisso anti-testo obbligatorio
    sanitized = sanitized + CLEAN_LABEL_SUFFIX;

    return {
        prompt: sanitized,
        wasModified: removedTerms.length > 0 || prompt.length > maxBody,
        removedTerms,
    };
}
