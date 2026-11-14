@echo off
rem Met l'executable de WEB_ANTENNA dans bin\ (appele par les autres .cmd, depuis la racine).
rem Avec cargo sur le poste : compiles ici, toujours a jour avec les sources.
rem Sinon : telecharges depuis GitHub (publication "binaires", compilee par la CI a chaque
rem envoi sur main), une fois par version : bin\commit dit de quelle version ils viennent.
setlocal
rem archive de production (publication "binaires", sans les sources) : son executable est deja la
if not exist Cargo.toml if exist bin\web_antenna.exe exit /b 0
if not exist bin mkdir bin
where cargo >nul 2>nul
if not errorlevel 1 (
  rem web_antenna seul : les outils d'essai des caisses (faux_openems...) restent dans target\
  cargo build --release --bin web_antenna || exit /b 1
  rem un executable en cours d'usage ne se reecrit pas : il est garde tel quel
  copy /y target\release\web_antenna.exe bin\ >nul 2>nul
  exit /b 0
)
set ICI=
for /f %%c in ('git rev-parse HEAD 2^>nul') do set ICI=%%c
set LA=
if exist bin\commit set /p LA=<bin\commit
if exist bin\web_antenna.exe if defined ICI if "%ICI%"=="%LA%" exit /b 0
echo   Telechargement des executables WEB_ANTENNA (windows-x86_64)...
curl -fsSL -o bin\.archive.zip https://github.com/pilou33620/WEB_ANTENNA/releases/download/binaires/web_antenna-windows-x86_64.zip
if not errorlevel 1 tar -xf bin\.archive.zip -C bin
if not errorlevel 1 (
  del bin\.archive.zip >nul 2>nul
  exit /b 0
)
del bin\.archive.zip >nul 2>nul
if exist bin\web_antenna.exe (
  echo   [!] Telechargement impossible : on garde les executables deja presents.
  exit /b 0
)
echo [X] Telechargement des executables impossible.
echo     Installer Rust (https://rustup.rs) puis relancer : ils seront compiles ici.
exit /b 1
