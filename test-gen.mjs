import 'dotenv/config';
import fs from 'fs';

async function generate() {
    const key = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${key}`;
    const payload = {
        instances: [ { prompt: "A tiny cute cat, 100x100 pixels" } ],
        parameters: { sampleCount: 1 }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        console.log(Object.keys(data));
        if (data.predictions) {
            console.log(Object.keys(data.predictions[0]));
            console.log("mimeType:", data.predictions[0].mimeType);
            console.log("bytesBase64 length:", data.predictions[0].bytesBase64?.length);
            // Save to disk to verify
            const buffer = Buffer.from(data.predictions[0].bytesBase64, 'base64');
            fs.writeFileSync('test-cat.jpg', buffer);
            console.log("Saved test-cat.jpg");
        }
    } catch(e) {
        console.log("Error:", e.message);
    }
}
generate();
