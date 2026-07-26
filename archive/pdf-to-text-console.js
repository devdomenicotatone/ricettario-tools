/**
 * ESTRAI TESTO DA PDF — appunto da incollare nella console del browser.
 *
 * NON è un modulo del progetto: è un frammento usa-e-getta, da incollare nella
 * console (F12) di una pagina qualsiasi. Apre un selettore file, legge il PDF
 * scelto e scarica il testo come .txt.
 *
 * Perché sta in archive/: nessuna pagina lo carica e nessun file lo importa,
 * ma stava in `src/dashboard/scratch/`, cioè dentro la cartella che il server
 * pubblica con `express.static` (in src/server/index.js). Era quindi
 * scaricabile da chiunque potesse aprire la dashboard — che non ha
 * autenticazione. Qui in archive/ non è più servito.
 *
 * Attenzione prima di usarlo: **scarica ed esegue codice da un CDN**
 * (cdnjs.cloudflare.com). Vuol dire che ti fidi di quel server, in quel
 * momento, dentro la pagina in cui lo incolli — e con i permessi di quella
 * pagina. Non incollarlo dentro la dashboard mentre gira: da lì il codice
 * caricato potrebbe chiamare le rotte /api/*, `/api/elimina` compresa.
 * Incollalo in una scheda vuota (about:blank non basta, serve una pagina
 * http/https qualsiasi).
 *
 * Alternativa senza CDN, già dentro il progetto: `archive/pdf-to-images.js`
 * converte il PDF in PNG e `src/ocr.js` + `ocr-surya.py` ne estraggono il
 * testo, tutto in locale.
 *
 * Uso — riattivazione a mano, fuori dalla pipeline: il flusso normale non lo
 * carica mai e il README dice giustamente di non lanciarlo. Queste righe
 * servono a chi decide di riusarlo apposta, sapendo cosa fa.
 *      incolla tutto il file nella console, poi chiama a mano
 *      estraiTestoDaPdf()
 * (prima non parte da solo: incollarlo non fa più partire il download del CDN)
 */
async function estraiTestoDaPdf() {
  // 1. Carica PDF.js da CDN se non già presente
  if (!window.pdfjsLib) {
    // Import dinamico: i module script non espongono niente su window.
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
}

console.log('📋 Pronto. Lancia l\'estrazione con:  estraiTestoDaPdf()');
