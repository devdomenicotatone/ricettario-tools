import 'dotenv/config';

async function listModels(key) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        
        console.log("Modelli disponibili:");
        if (data.models) {
            for (const m of data.models) {
                if (m.name.includes("imagen") || m.supportedGenerationMethods?.includes("generateImages")) {
                    console.log(`- ${m.name}`);
                    console.log(`  Metodi: ${m.supportedGenerationMethods?.join(", ")}`);
                }
            }
        } else {
            console.log(data);
        }
    } catch(e) {
        console.log(e.message);
    }
}

listModels(process.env.GEMINI_API_KEY);
