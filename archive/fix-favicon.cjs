const fs = require('fs');
const path = require('path');

const rootDir = 'C:/Users/dom19/Desktop/Ricettario/Ricettario/Ricettario';
const targetRegex = /<link rel="icon"\s*href="data:image\/svg\+xml,<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg' viewBox='0 0 100 100'><text y='\.9em' font-size='90'>🔥<\/text><\/svg>">/g;
const replacement = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🔥%3C/text%3E%3C/svg%3E">`;

function processDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (!file.includes('node_modules') && !file.includes('dist')) {
                processDir(fullPath);
            }
        } else if (fullPath.endsWith('.html')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            if (targetRegex.test(content)) {
                content = content.replace(targetRegex, replacement);
                fs.writeFileSync(fullPath, content, 'utf-8');
                console.log(`Pariato: ${fullPath}`);
            }
        }
    }
}

processDir(rootDir);
console.log('Script Completato!');
