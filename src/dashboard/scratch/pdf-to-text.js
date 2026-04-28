/**
 * PDF Text Extractor — Console Script
 * 
 * Incolla questo script nella console del browser (F12 → Console).
 * Si aprirà un file picker per selezionare un PDF.
 * Il testo estratto verrà scaricato come file .txt.
 */
(async () => {
  // 1. Carica PDF.js da CDN se non già presente
  if (!window.pdfjsLib) {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs';
    script.type = 'module';

    // Poiché i module script non espongono direttamente su window,
    // usiamo un import() dinamico
    const pdfjsModule = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs');
    window.pdfjsLib = pdfjsModule;
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs';
    console.log('✅ PDF.js caricato con successo');
  }

  // 2. Apri file picker per selezionare il PDF
  const fileHandle = await new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.addEventListener('change', () => resolve(input.files[0]));
    input.click();
  });

  if (!fileHandle) {
    console.warn('⚠️ Nessun file selezionato.');
    return;
  }

  console.log(`📄 File selezionato: ${fileHandle.name} (${(fileHandle.size / 1024).toFixed(1)} KB)`);

  // 3. Leggi il file come ArrayBuffer
  const arrayBuffer = await fileHandle.arrayBuffer();

  // 4. Carica il documento PDF
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;
  console.log(`📖 Pagine trovate: ${totalPages}`);

  // 5. Estrai il testo da ogni pagina
  const textParts = [];

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Ricostruisci il testo preservando la struttura riga per riga
    let lastY = null;
    let lineText = '';

    for (const item of content.items) {
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 2) {
        // Nuova riga (la Y è cambiata)
        textParts.push(lineText);
        lineText = '';
      }
      lineText += item.str;
      lastY = item.transform[5];
    }

    if (lineText) textParts.push(lineText);

    // Separatore di pagina
    textParts.push(`\n--- Pagina ${i}/${totalPages} ---\n`);

    console.log(`  ✅ Pagina ${i}/${totalPages} estratta`);
  }

  const fullText = textParts.join('\n');
  console.log(`\n📊 Caratteri totali estratti: ${fullText.length.toLocaleString()}`);

  // 6. Salva come file .txt
  const outputName = fileHandle.name.replace(/\.pdf$/i, '') + '_testo.txt';
  const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = outputName;
  a.click();
  URL.revokeObjectURL(url);

  console.log(`\n💾 File salvato: ${outputName}`);
  console.log('🎉 Estrazione completata!');
})();
