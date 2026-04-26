import 'dotenv/config';

async function testKey(keyName, key) {
    if (!key) {
        console.log(`❌ ${keyName} non è impostata nel file .env`);
        return;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${key}`;
    const payload = {
        instances: [ { prompt: "A tiny cute cat, highly detailed" } ],
        parameters: { sampleCount: 1 }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            console.log(`✅ ${keyName} è ABILITATA per la generazione immagini!`);
        } else {
            const errorText = await response.text();
            console.log(`❌ ${keyName} NON è abilitata o ha dato errore. HTTP ${response.status}`);
            try {
                console.log(`   Dettagli: ${JSON.parse(errorText).error.message}`);
            } catch(e) {
                console.log(`   Dettagli: ${errorText}`);
            }
        }
    } catch (err) {
        console.log(`❌ Errore di rete con ${keyName}: ${err.message}`);
    }
}

async function run() {
    console.log("🔍 Test API Immagini Gemini (Imagen 4.0 Fast)...");
    await testKey('GEMINI_API_KEY (API 1)', process.env.GEMINI_API_KEY);
    await testKey('GEMINI_API_KEY2 (API 2)', process.env.GEMINI_API_KEY2);
}

run();
