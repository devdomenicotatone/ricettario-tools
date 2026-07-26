/**
 * RECIPE EDITOR — State Manager
 * 
 * Gestisce lo stato della ricetta in editing:
 * Load/Save, Undo/Redo, Auto-save, event emitter.
 */

export class RecipeEditorState {
    constructor() {
        this.originalRecipe = null;
        this.currentRecipe = null;
        this.cat = null;
        this.slug = null;
        this.isDirty = false;
        this.isLoading = false;
        this.isSaving = false;
        this.undoStack = [];
        this.redoStack = [];
        this.maxUndo = 50;
        this.saveTimeout = null;
        this.validationTimeout = null;
        this.validationResult = null;
        // Impronta della versione che crediamo ci sia sul disco: serve a
        // accorgersi che qualcun altro ha riscritto il file sotto di noi.
        this.improntaDisco = null;
        this.conflittoPendente = null;
        this._forzaSalvataggio = false;
        // Promessa del salvataggio in volo: chi chiama save() mentre un PATCH sta
        // ancora viaggiando deve poter aspettare QUELLO, non ricevere subito
        // `undefined` e credere che non ci sia niente in corso.
        this._salvataggioInCorso = null;
        // L'utente ha abbandonato le modifiche mentre un PATCH era in volo.
        this._scartato = false;
        // Ultimo errore di salvataggio (null se l'ultimo giro è andato bene):
        // serve a distinguere "fallito" da "non ancora inviato".
        this.ultimoErrore = null;
        // Il controllo anti-conflitto non ha potuto girare all'ultimo salvataggio.
        this.controlloConflittiSaltato = false;
        this.onChangeCallbacks = [];
        this.onValidationCallbacks = [];
        this.onStatusCallbacks = [];
        this.onConflictCallbacks = [];
    }

    onChange(cb) { this.onChangeCallbacks.push(cb); }
    onValidation(cb) { this.onValidationCallbacks.push(cb); }
    onStatus(cb) { this.onStatusCallbacks.push(cb); }
    onConflict(cb) { this.onConflictCallbacks.push(cb); }

    _emitChange() { this.onChangeCallbacks.forEach(cb => cb(this.currentRecipe, this.isDirty)); }
    _emitValidation() { this.onValidationCallbacks.forEach(cb => cb(this.validationResult)); }
    _emitStatus(msg, type) { this.onStatusCallbacks.forEach(cb => cb(msg, type)); }
    _emitConflict(info) { this.onConflictCallbacks.forEach(cb => cb(info)); }

    /** C'è lavoro che non è ancora arrivato sul disco? (chiusura scheda, chiusura editor) */
    modificheNonSalvate() {
        return !!(this.isDirty || this.isSaving || this.conflittoPendente);
    }

    async load(cat, slug) {
        this.isLoading = true;
        this._emitStatus('Caricamento...', 'loading');
        try {
            const resp = await fetch(`/api/ricetta/${cat}/${slug}`, { cache: 'no-store' });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            this.cat = cat;
            this.slug = slug;
            this.originalRecipe = JSON.parse(JSON.stringify(data.recipe));
            this.currentRecipe = JSON.parse(JSON.stringify(data.recipe));
            this.improntaDisco = impronta(data.recipe);
            this.conflittoPendente = null;
            this._forzaSalvataggio = false;
            this._scartato = false;
            this.ultimoErrore = null;
            this.controlloConflittiSaltato = false;
            this.isDirty = false;
            this.undoStack = [];
            this.redoStack = [];
            this.isLoading = false;
            this._emitChange();
            this._emitStatus('Caricata', 'saved');
            this.runValidation();
        } catch (err) {
            this.isLoading = false;
            this._emitStatus(`Errore: ${err.message}`, 'error');
            throw err;
        }
    }

    update(path, value) {
        this._pushUndo();
        setPath(this.currentRecipe, path, value);
        this.isDirty = true;
        this.redoStack = [];
        this._emitChange();
        this._emitStatus('Modifiche non salvate', 'dirty');
        this._debouncedValidation();
        this._debouncedAutoSave();
    }

    /** Update senza auto-save (per batch di modifiche) */
    updateSilent(path, value) {
        setPath(this.currentRecipe, path, value);
    }

    /** Commetti le batch silenti come un singolo undo step */
    commitBatch() {
        this._pushUndo();
        this.isDirty = true;
        this.redoStack = [];
        this._emitChange();
        this._emitStatus('Modifiche non salvate', 'dirty');
        this._debouncedValidation();
        this._debouncedAutoSave();
    }

    undo() {
        if (!this.undoStack.length) return;
        this.redoStack.push(structuredClone(this.currentRecipe));
        this.currentRecipe = this.undoStack.pop();
        this.isDirty = JSON.stringify(this.currentRecipe) !== JSON.stringify(this.originalRecipe);
        this._emitChange();
        this._debouncedValidation();
        if (!this.isDirty) this._emitStatus('Tutte le modifiche annullate', 'saved');
        else this._emitStatus('Undo', 'dirty');
    }

    redo() {
        if (!this.redoStack.length) return;
        this.undoStack.push(structuredClone(this.currentRecipe));
        this.currentRecipe = this.redoStack.pop();
        this.isDirty = JSON.stringify(this.currentRecipe) !== JSON.stringify(this.originalRecipe);
        this._emitChange();
        this._debouncedValidation();
        this._emitStatus('Redo', 'dirty');
    }

    async save() {
        // Salvataggio già in volo: restituiamo LA SUA promessa invece di uscire
        // subito. Uscire subito faceva sì che `await state.save()` alla chiusura
        // dell'editor si sbloccasse mentre il PATCH stava ancora viaggiando:
        // l'editor lo scambiava per un fallimento, chiedeva "chiudere e perdere
        // le modifiche?" mentre il salvataggio stava invece riuscendo, e su "sì"
        // riportava la ricetta alla versione precedente — che l'auto-save poi
        // riscriveva sul file 1,5 s dopo, cancellando il salvataggio riuscito.
        if (this.isSaving) return this._salvataggioInCorso || undefined;
        if (!this.isDirty) return;
        // Conflitto aperto: aspettiamo che l'utente decida, non riscriviamo il file.
        if (this.conflittoPendente) return;
        const promessa = this._eseguiSalvataggio();
        this._salvataggioInCorso = promessa;
        return promessa;
    }

    async _eseguiSalvataggio() {
        this.isSaving = true;
        this._scartato = false;
        this.ultimoErrore = null;
        this.controlloConflittiSaltato = false;
        this._emitStatus('Salvataggio...', 'saving');

        // Fotografia di ciò che stiamo inviando. Mentre la richiesta viaggia l'utente
        // continua a scrivere e `currentRecipe` cambia sotto i piedi: dichiarare
        // "salvato" il contenuto ATTUALE faceva sparire quelle battute in silenzio,
        // con la pillola che diceva comunque "✓ Salvata" e il salvataggio successivo
        // che non trovava più niente da fare.
        const inviata = JSON.parse(JSON.stringify(this.currentRecipe));

        try {
            // ── Rilevamento conflitto ──
            // Il PATCH è una scrittura secca: due schede aperte sulla stessa ricetta
            // (o un Fix AI lanciato dal pannello qualità) si sovrascrivono a vicenda
            // e chi salva per ultimo cancella il lavoro dell'altro senza dire niente.
            // Prima di scrivere confrontiamo l'impronta di ciò che c'è ADESSO sul
            // disco con quella dell'ultima versione che conosciamo.
            if (!this._forzaSalvataggio && this.improntaDisco) {
                const suDisco = await this._leggiDaDisco();
                // Se la lettura fallisce non blocchiamo il salvataggio: perdere le
                // modifiche per un controllo che non ha potuto girare sarebbe peggio.
                // Lo diciamo però nella pillola, perché in quel giro la protezione
                // contro le due schede non c'è stata.
                if (!suDisco) this.controlloConflittiSaltato = true;
                if (suDisco && suDisco.impronta !== this.improntaDisco) {
                    this.isSaving = false;
                    this.conflittoPendente = { recipeDisco: suDisco.recipe, improntaDisco: suDisco.impronta };
                    this._emitStatus('Conflitto: la ricetta è cambiata sul disco', 'error');
                    this._emitConflict(this.conflittoPendente);
                    return;
                }
            }
            this._forzaSalvataggio = false;

            const resp = await fetch(`/api/ricetta/${this.cat}/${this.slug}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recipe: inviata, autoRegen: true }),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            // Da qui in poi il file È stato scritto: allineiamo subito ciò che
            // crediamo ci sia sul disco. Farlo dopo `resp.json()` significava che
            // una risposta troncata (scrittura riuscita, connessione caduta sul
            // corpo) ci lasciava con l'impronta vecchia, e il salvataggio dopo
            // apriva un pannello di conflitto fra l'utente e sé stesso.
            this.originalRecipe = inviata;
            this.improntaDisco = impronta(inviata);

            // Il corpo della risposta serve solo per il messaggio: se non arriva
            // rinunciamo a `syncOk`, non alla certezza di aver salvato.
            const result = await resp.json().catch(() => ({}));

            // `isSaving` resta vero fino a qui: abbassarlo prima dell'attesa
            // aprirebbe una finestra in cui l'auto-save può partire in parallelo.
            this.isSaving = false;

            // Se nel frattempo l'utente ha abbandonato (chiusura con "sì, perdi
            // le modifiche") non rimettiamo niente in coda: riprogrammare
            // l'auto-save qui riscriveva sul file la versione precedente.
            const modificheNuove = !this._scartato
                && JSON.stringify(this.currentRecipe) !== JSON.stringify(inviata);
            this.isDirty = modificheNuove;
            this._emitChange();

            if (modificheNuove) {
                // Arrivate modifiche durante l'invio: resta sporco e risalva.
                this._emitStatus('Modifiche non salvate', 'dirty');
                this._debouncedAutoSave();
            } else {
                let syncMsg = result.syncOk ? '✓ Salvata + cards sync' : '✓ Salvata';
                if (this.controlloConflittiSaltato) syncMsg += ' (controllo conflitti non riuscito)';
                this._emitStatus(syncMsg, 'saved');
            }
        } catch (err) {
            this._forzaSalvataggio = false;
            this.isSaving = false;
            this.ultimoErrore = err.message;
            // Il salvataggio non è andato a buon fine: le modifiche restano pendenti,
            // così chiusura scheda e chiusura editor sanno che c'è ancora da salvare.
            // A meno che l'utente le abbia già abbandonate di proposito.
            this.isDirty = !this._scartato;
            this._emitStatus(`Errore salvataggio: ${err.message}`, 'error');
        } finally {
            this._salvataggioInCorso = null;
        }
    }

    /** Rilegge la ricetta dal server. Torna null se la lettura non riesce. */
    async _leggiDaDisco() {
        try {
            const resp = await fetch(`/api/ricetta/${this.cat}/${this.slug}`, { cache: 'no-store' });
            if (!resp.ok) return null;
            const data = await resp.json();
            if (!data || !data.recipe) return null;
            return { recipe: data.recipe, impronta: impronta(data.recipe) };
        } catch {
            return null;
        }
    }

    /** Conflitto risolto tenendo le modifiche a schermo: il file viene riscritto. */
    async risolviTenendoLeMie() {
        if (!this.conflittoPendente) return;
        this.conflittoPendente = null;
        this._forzaSalvataggio = true;
        this.isDirty = true;
        await this.save();
    }

    /** Conflitto risolto tenendo il file: le modifiche a schermo si perdono. */
    async risolviRicaricando() {
        this.conflittoPendente = null;
        this._forzaSalvataggio = false;
        this.isDirty = false;
        await this.load(this.cat, this.slug);
    }

    /** Decisione rinviata: il prossimo salvataggio rileva di nuovo il conflitto. */
    rinviaConflitto() {
        if (!this.conflittoPendente) return;
        this.conflittoPendente = null;
        this._emitStatus('Modifiche non salvate (conflitto da risolvere)', 'dirty');
    }

    /** Abbandona le modifiche in memoria: si può chiudere senza altri avvisi. */
    scarta() {
        if (this.saveTimeout) { clearTimeout(this.saveTimeout); this.saveTimeout = null; }
        this.conflittoPendente = null;
        this._forzaSalvataggio = false;
        this._scartato = true;
        // Con un PATCH ancora in volo NON riportiamo indietro `currentRecipe`:
        // `originalRecipe` è la versione PRECEDENTE finché il salvataggio non
        // ritorna, e riscriverla qui faceva ripartire un auto-save che rimetteva
        // sul file il contenuto vecchio, cancellando il salvataggio in corso.
        // `_scartato` basta a impedire che il ritorno riprogrammi qualcosa.
        if (!this.isSaving && this.originalRecipe) {
            this.currentRecipe = JSON.parse(JSON.stringify(this.originalRecipe));
        }
        this.isDirty = false;
        this._emitChange();
    }

    /** Placeholder — viene sovrascritta da editor-validation.js */
    runValidation() {}

    // ── Private Helpers ──
    _pushUndo() {
        this.undoStack.push(JSON.parse(JSON.stringify(this.currentRecipe)));
        if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
    }

    _debouncedAutoSave() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => { this.saveTimeout = null; this.save(); }, 1500);
    }

    _debouncedValidation() {
        if (this.validationTimeout) clearTimeout(this.validationTimeout);
        this.validationTimeout = setTimeout(() => this.runValidation(), 500);
    }
}

// ── Deep path setter (utility) ──
export function setPath(obj, path, value) {
    const parts = path.split('.');
    let target = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = isNaN(parts[i]) ? parts[i] : parseInt(parts[i]);
        if (target[key] === undefined) target[key] = {};
        target = target[key];
    }
    const lastKey = isNaN(parts[parts.length - 1]) ? parts[parts.length - 1] : parseInt(parts[parts.length - 1]);
    target[lastKey] = value;
}

// ── Impronta stabile di una ricetta (rilevamento conflitti) ──
// Le chiavi vengono ordinate a ogni livello, così l'impronta dipende solo dal
// contenuto e non da come è serializzato. Oggi il server riscrive l'oggetto
// ricevuto e la GET lo ripassa identico, quindi l'ordine non cambia mai: è una
// precauzione, non la soluzione di un conflitto già osservato.
export function impronta(valore) {
    return JSON.stringify(ordinaChiavi(valore));
}

function ordinaChiavi(valore) {
    if (Array.isArray(valore)) return valore.map(ordinaChiavi);
    if (valore && typeof valore === 'object') {
        const ordinato = {};
        for (const chiave of Object.keys(valore).sort()) ordinato[chiave] = ordinaChiavi(valore[chiave]);
        return ordinato;
    }
    return valore;
}

// L'escape HTML non sta più qui: era una seconda implementazione (senza gli
// apici) accanto a quella di `../modules/escape.js`. Chi ne ha bisogno importa
// `escapeHtml` da lì — una sola funzione, una sola tabella di caratteri.
