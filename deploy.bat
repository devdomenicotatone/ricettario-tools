@echo off
setlocal
title Ricettario - Deploy
color 0E

rem =====================================================================
rem  ATTENZIONE - LEGGI PRIMA DI LANCIARLO
rem
rem  Questo file NON e' uno script di pubblicazione: e' uno script che
rem  COMMITTA E PUSHA DUE REPO e poi pubblica online. Fa `git add -A`, cioe'
rem  mette dentro al commit tutto quello che trova nella cartella - anche
rem  file che non hai guardato, anche lavoro di un altro a meta'. Quello
rem  che entra in un commit e viene pushato non e' piu' privato: sta su
rem  GitHub e nella storia, e toglierlo dopo e' un'operazione a se'.
rem
rem  Da qui vengono i danni gia' successi: il vecchio deploy.bat aggiungeva
rem  e committava PRIMA dei controlli, con il messaggio fisso "deploy
rem  manuale" (73 commit su 118 indistinguibili), e cosi' sono entrati nel
rem  repo tools una copia morta della cache immagini da 6,9 MB e il testo
rem  incollato di ogni ricetta. Questa versione inverte l'ordine (controlli,
rem  poi revisione, poi commit) ma `git add -A` resta: e' il .gitignore
rem  l'unica cosa che tiene fuori gli scarti.
rem
rem  NON SERVE PER PUBBLICARE IL SITO. Per mettere online il sito basta
rem  `npm run deploy` dentro Ricettario\: fa `npm run check` e poi aggiorna
rem  il branch gh-pages, senza toccare la storia di nessuno dei due repo.
rem  Usa questo file SOLO quando vuoi davvero anche committare e pushare, e
rem  solo a mano: mai da uno script, mai automatico, mai incustodito.
rem =====================================================================

rem =====================================================================
rem  DEPLOY DEL RICETTARIO - versione versionata (vive dentro tools/)
rem
rem  PERCHE' QUESTO FILE ESISTE
rem  Fino a oggi il deploy passava da un deploy.bat che stava SOPRA i due
rem  repo (accanto a Ricettario\ e tools\), quindi fuori da entrambi:
rem  nessuno lo versionava, nessuno ne vedeva le modifiche, e chi clonava
rem  il progetto non ce l'aveva.
rem
rem  Quel file faceva, in quest'ordine:
rem      git add -A  ->  git commit -m "deploy manuale"  ->  git push
rem      ... e SOLO DOPO  npm run deploy  (che a sua volta fa npm run check)
rem
rem  Tre guasti nati da quell'ordine:
rem   1. I controlli giravano DOPO il commit. Se npm run check falliva, il
rem      commit rotto era gia' nella storia e gia' su GitHub. Il cancello
rem      serve a fermare la pubblicazione PRIMA, non a commentarla dopo.
rem   2. "git add -A" prende tutto quello che trova, senza guardarlo. E'
rem      cosi' che nel repo tools e' finita una copia morta della cache
rem      immagini da 6,9 MB (image-cache.json in radice, che nessun file
rem      del progetto legge) e il testo incollato di ogni ricetta
rem      (data/_tmp_testo.txt). Entrambi sono stati tolti dal tracking
rem      (git rm --cached, il file resta sul disco) e messi nel
rem      .gitignore: se li rimetti, `git add -A` se li riprende.
rem   3. Il messaggio fisso "deploy manuale" ha prodotto 73 commit su 118
rem      indistinguibili: la storia git non dice piu' cosa e' cambiato e
rem      quando, quindi non si puo' tornare indietro a colpo sicuro.
rem
rem  QUESTA VERSIONE INVERTE L'ORDINE: prima i controlli, poi la revisione
rem  di cosa stai per committare, poi il commit con un messaggio vero, e
rem  se un push fallisce ci si ferma li' invece di annunciare "pubblicato".
rem
rem  IL VECCHIO FILE NON E' STATO CANCELLATO, ed e' giusto cosi': Deploy.exe
rem  (il pulsante nella cartella sopra i due repo) ha il percorso
rem  "<cartella dell'exe>\deploy.bat" compilato dentro e non e'
rem  configurabile. Quel file adesso e' uno stub di due righe che chiama
rem  questo. Cancellarlo romperebbe il pulsante; vedi README.md, sezione
rem  "Pubblicazione".
rem
rem  Uso:  deploy.bat "descrizione di cosa hai cambiato"
rem        oppure senza argomenti (doppio clic): il messaggio te lo chiede.
rem =====================================================================

rem %~dp0 e' la cartella di questo file (...\Ricettario\tools\).
rem La cartella che contiene ENTRAMBI i repo e' quella sopra.
set "RADICE=%~dp0.."
set "SITO=%RADICE%\Ricettario"
set "TOOLS=%~dp0."

rem Col doppio clic (Deploy.exe -> deploy.bat stub nella cartella sopra)
rem non c'e' modo di passare argomenti: in quel caso il messaggio si chiede
rem qui, invece di rifiutarsi di partire e lasciare il pulsante inutile.
rem "set /p" sta fuori da qualsiasi blocco fra parentesi di proposito:
rem dentro un blocco, il valore appena letto viene espanso male.
set "MESSAGGIO=%~1"
if not "%MESSAGGIO%"=="" goto :messaggio_letto
echo   Serve un messaggio di commit che dica cosa e' cambiato.
echo   Esempio:  aggiunta focaccia genovese
echo.
set /p "MESSAGGIO=Messaggio di commit: "
echo.

:messaggio_letto
if not "%MESSAGGIO%"=="" goto :messaggio_ok
echo   Nessun messaggio: non ho committato e non ho pubblicato niente.
echo.
pause
exit /b 1

:messaggio_ok

echo ============================================
echo   RICETTARIO - Deploy
echo ============================================
echo.

rem ---- 1) IL CANCELLO, PRIMA DI TOCCARE GIT --------------------------
rem npm run check = build ricette + build cottura + vite build +
rem pre-rendering + verifica su dist/. Se qui si rompe qualcosa, non
rem deve finire ne' in un commit ne' online.
echo [1/4] Controlli sul sito (npm run check)...
pushd "%SITO%" || (echo Cartella del sito non trovata: %SITO% & pause & exit /b 1)
call npm run check
if errorlevel 1 (
    popd
    echo.
    echo   CONTROLLI FALLITI. Non ho committato e non ho pubblicato niente.
    echo   Leggi l'errore qui sopra, correggi, e rilancia.
    echo.
    pause
    exit /b 1
)
popd
echo   Controlli superati.
echo.

rem ---- 2) GUARDA COSA STAI PER COMMITTARE ----------------------------
echo [2/4] Cosa sta per entrare nei commit:
echo.
echo   --- SITO (%SITO%) ---
pushd "%SITO%" & git status --short & popd
echo.
echo   --- TOOLS (%~dp0) ---
pushd "%TOOLS%" & git status --short & popd
echo.
set "CONFERMA="
set /p "CONFERMA=Committo e pubblico tutto questo? (s/N): "
if /i not "%CONFERMA%"=="s" (
    echo   Annullato. Niente commit, niente push, niente deploy.
    pause
    exit /b 0
)
echo.

rem ---- 3) COMMIT + PUSH SUI DUE REPO ---------------------------------
rem Nota: "git add -A" resta comodo solo perche' i .gitignore dei due
rem repo ora escludono gli scarti. Se aggiungi un file generato, la sua
rem riga di .gitignore va scritta PRIMA del deploy successivo.
echo [3/4] Commit e push...
call :committa_e_pusha "%SITO%" "SITO"
if errorlevel 1 exit /b 1
call :committa_e_pusha "%TOOLS%" "TOOLS"
if errorlevel 1 exit /b 1
echo.

rem ---- 4) PUBBLICAZIONE SU GITHUB PAGES ------------------------------
rem Il push su main NON pubblica: GitHub Pages serve dal branch gh-pages,
rem che viene aggiornato solo da npm run deploy.
echo [4/4] Pubblicazione su GitHub Pages...
pushd "%SITO%"
call npm run deploy
if errorlevel 1 (
    popd
    echo.
    echo   DEPLOY FALLITO. I commit sono stati fatti, il sito online e'
    echo   rimasto alla versione precedente.
    echo.
    pause
    exit /b 1
)
popd

echo.
echo ============================================
echo   FATTO. Sito pubblicato su GitHub Pages.
echo ============================================
echo.
pause
endlocal
exit /b 0

rem =====================================================================
rem  SUBROUTINE: commit + push su UN repo.
rem      %1 = cartella del repo,  %2 = etichetta per i messaggi.
rem
rem  Ogni comando git e' controllato. Prima non lo era: se i push
rem  fallivano (rete giu', "origin" sbagliato) lo script tirava dritto
rem  fino a stampare "FATTO. Sito pubblicato su GitHub Pages." e a uscire
rem  con codice 0, mentre i commit erano rimasti solo sul computer. Un
rem  cancello che annuncia successo quando il lavoro non e' partito e'
rem  peggio di nessun cancello.
rem =====================================================================
:committa_e_pusha
setlocal
set "CARTELLA=%~1"
set "ETICHETTA=%~2"
pushd "%CARTELLA%" || goto :git_cartella_ko

git rev-parse --git-dir >nul 2>&1
if errorlevel 1 goto :git_norepo

rem C'e' davvero qualcosa da committare? "git commit" senza modifiche esce
rem con errore, ma e' un errore innocuo: va distinto da un commit fallito.
set "DAFARE="
for /f "delims=" %%r in ('git status --porcelain') do set "DAFARE=1"
if not defined DAFARE goto :git_solo_push

git add -A
if errorlevel 1 goto :git_add_ko
git commit -m "%MESSAGGIO%"
if errorlevel 1 goto :git_commit_ko
goto :git_push

:git_solo_push
echo   %ETICHETTA%: niente di nuovo da committare.

:git_push
git push origin main
if errorlevel 1 goto :git_push_ko
popd
endlocal
exit /b 0

:git_cartella_ko
echo.
echo   %ETICHETTA%: cartella non trovata, %CARTELLA%
echo   Mi fermo: niente commit, niente push, niente deploy.
echo.
pause
endlocal
exit /b 1

:git_norepo
popd
echo.
echo   %ETICHETTA%: %CARTELLA% non e' un repo git.
echo   Mi fermo: niente commit, niente push, niente deploy.
echo.
pause
endlocal
exit /b 1

:git_add_ko
popd
echo.
echo   %ETICHETTA%: "git add" e' fallito. Mi fermo qui, non ho committato.
echo.
pause
endlocal
exit /b 1

:git_commit_ko
popd
echo.
echo   %ETICHETTA%: "git commit" e' fallito e c'erano modifiche da salvare.
echo   Niente push e niente deploy: leggi l'errore qui sopra.
echo.
pause
endlocal
exit /b 1

:git_push_ko
popd
echo.
echo   %ETICHETTA%: PUSH FALLITO. Il commit e' stato fatto ma e' rimasto
echo   solo sul tuo computer, e il sito NON e' stato pubblicato.
echo   Controlla la connessione, oppure "git remote -v" dentro:
echo   %CARTELLA%
echo.
pause
endlocal
exit /b 1
