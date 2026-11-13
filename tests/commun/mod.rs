//! Client HTTP des bancs : une requête, une réponse, sur la boucle locale.
//! (La même aide que WEB_3D/tests/commun/mod.rs, le JSON lu comme le lit le serveur.)
#![allow(dead_code)]
use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::time::Duration;

pub struct Rep {
    pub code: u16,
    pub entetes: Vec<(String, String)>,
    pub corps: Vec<u8>,
}

impl Rep {
    pub fn entete(&self, nom: &str) -> Option<&str> {
        self.entetes.iter().find(|(k, _)| k.eq_ignore_ascii_case(nom)).map(|(_, v)| v.as_str())
    }
    pub fn texte(&self) -> String {
        String::from_utf8_lossy(&self.corps).into_owned()
    }
    pub fn json(&self) -> antenne_modele::Json {
        antenne_modele::json_depuis_texte(&self.texte()).unwrap_or_else(|e| panic!("JSON attendu ({e}) : {}", self.texte()))
    }
}

/// Écrit la requête sur `flux` (TCP ou TLS) et lit la réponse. Host et Content-Length sont
/// ajoutés s'ils ne sont pas dans `entetes` (Content-Length : seulement avec un corps ou en POST).
pub fn echanger<F: Read + Write>(
    flux: &mut F, port: u16, methode: &str, chemin: &str, entetes: &[(&str, &str)], corps: &[u8],
) -> io::Result<Rep> {
    let a = |nom: &str| entetes.iter().any(|(k, _)| k.eq_ignore_ascii_case(nom));
    let mut d = format!("{methode} {chemin} HTTP/1.1\r\n");
    if !a("Host") {
        d += &format!("Host: 127.0.0.1:{port}\r\n");
    }
    for (k, v) in entetes {
        d += &format!("{k}: {v}\r\n");
    }
    if !a("Content-Length") && (!corps.is_empty() || methode == "POST") {
        d += &format!("Content-Length: {}\r\n", corps.len());
    }
    // l'envoi peut être coupé par un serveur qui a déjà refusé (corps annoncé géant) : on lit quand même
    let _ = flux.write_all(d.as_bytes()).and_then(|_| flux.write_all(b"\r\n")).and_then(|_| flux.write_all(corps));
    let _ = flux.flush();

    let (mut brut, mut bloc) = (Vec::new(), [0u8; 65536]);
    let coupe = loop {
        if let Some(i) = brut.windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
        match flux.read(&mut bloc)? {
            0 => return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "réponse HTTP sans en-têtes")),
            n => brut.extend_from_slice(&bloc[..n]),
        }
    };
    let tete = String::from_utf8_lossy(&brut[..coupe]).into_owned();
    let mut lignes = tete.split("\r\n");
    let code = lignes.next().and_then(|l| l.split(' ').nth(1)).and_then(|c| c.parse().ok())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "ligne d'état HTTP illisible"))?;
    let entetes: Vec<(String, String)> =
        lignes.filter_map(|l| l.split_once(':')).map(|(k, v)| (k.to_string(), v.trim().to_string())).collect();
    let mut rep = Rep { code, entetes, corps: brut[coupe + 4..].to_vec() };
    let attendu = if methode == "HEAD" || code == 204 || code == 304 {
        Some(0)
    } else {
        rep.entete("Content-Length").and_then(|n| n.parse::<usize>().ok())
    };
    // une fin de flux (ou une fermeture TLS sans adieu) termine le corps
    while attendu.is_none_or(|n| rep.corps.len() < n) {
        match flux.read(&mut bloc) {
            Ok(0) | Err(_) => break,
            Ok(n) => rep.corps.extend_from_slice(&bloc[..n]),
        }
    }
    if let Some(n) = attendu {
        rep.corps.truncate(n);
    }
    Ok(rep)
}

pub fn connecter(port: u16) -> io::Result<TcpStream> {
    let c = TcpStream::connect(("127.0.0.1", port))?;
    c.set_read_timeout(Some(Duration::from_secs(20)))?;
    Ok(c)
}

pub fn requete(port: u16, methode: &str, chemin: &str, entetes: &[(&str, &str)], corps: &[u8]) -> io::Result<Rep> {
    echanger(&mut connecter(port)?, port, methode, chemin, entetes, corps)
}

// -- le serveur lancé ---------------------------------------------------------
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, ChildStdout, Command, Stdio};
use std::time::Instant;

pub const EXE: &str = env!("CARGO_BIN_EXE_web_antenna");
pub const RACINE: &str = env!("CARGO_MANIFEST_DIR");

/// Un serveur web_antenna lancé ; `stdout` reste ouvert tant qu'il tourne (il y écrit encore).
pub struct Lance {
    proc: Child,
    _stdout: BufReader<ChildStdout>,
    pub port: u16,
    pub annonce: String,
}

impl Lance {
    pub fn arreter(mut self) {
        #[cfg(unix)]
        unsafe {
            libc::kill(self.proc.id() as libc::pid_t, libc::SIGTERM);
        }
        #[cfg(not(unix))]
        let _ = self.proc.kill();
        let limite = Instant::now() + Duration::from_secs(10);
        while self.proc.try_wait().unwrap().is_none() {
            assert!(Instant::now() < limite, "web_antenna ne s'arrête pas");
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for Lance {
    fn drop(&mut self) {
        let _ = self.proc.kill();
        let _ = self.proc.wait();
    }
}

/// Lance web_antenna sur un port libre de 127.0.0.1 ; rend la main quand il sert. Son dossier
/// personnel est `maison` (le réglage ~/.antenne-openems.json du poste ne bouge pas), et sa
/// sortie d'erreur s'ajoute à `maison`/erreurs.txt.
pub fn demarrer(maison: &Path, args: &[&str], env: &[(&str, &str)]) -> Lance {
    let journal = std::fs::File::options().create(true).append(true).open(maison.join("erreurs.txt")).unwrap();
    let mut proc = Command::new(EXE)
        .args(["--local", "--sans-navigateur", "--sans-maj", "--sans-banc", "--sans-pause", "--port", "0"]).args(args)
        .current_dir(RACINE)
        .env_remove("WEBSUITE_LANCEUR").env_remove("WEBSUITE_JETON").env_remove("WEB_TOOLS_BANC_DISTANT")
        .env("HOME", maison).env("USERPROFILE", maison).env("WEB_ANTENNA_DEPOT", RACINE).envs(env.iter().copied())
        .stdout(Stdio::piped()).stderr(journal)
        .spawn().unwrap();
    let mut stdout = BufReader::new(proc.stdout.take().unwrap());
    let mut annonce = String::new();
    while !annonce.lines().last().is_some_and(|l| l.contains("Ctrl+C")) {
        assert!(stdout.read_line(&mut annonce).unwrap() > 0, "web_antenna s'est arrêté au démarrage :\n{annonce}");
    }
    let port = annonce.split_once("Adresse   http://127.0.0.1:").and_then(|(_, s)| s.split_once('/')).and_then(|(p, _)| p.parse().ok())
        .unwrap_or_else(|| panic!("adresse attendue dans :\n{annonce}"));
    Lance { proc, _stdout: stdout, port, annonce }
}

/// Un dossier d'essai neuf, sous le dossier temporaire du système.
pub fn dossier_neuf(nom: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("{nom}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// Les vérifications faites et celles qui ont échoué : tout est essayé, le bilan vient à la fin.
#[derive(Default)]
pub struct Bilan {
    pub essais: usize,
    pub echecs: Vec<String>,
}

impl Bilan {
    pub fn verifier<T: PartialEq + std::fmt::Debug>(&mut self, nom: &str, obtenu: T, attendu: T) {
        self.essais += 1;
        if obtenu != attendu {
            self.echecs.push(format!("ECHEC {nom} : attendu {attendu:?}, obtenu {obtenu:?}"));
        }
    }

    pub fn conclure(self) -> usize {
        for e in &self.echecs {
            println!("{e}");
        }
        println!("{}/{} ok", self.essais - self.echecs.len(), self.essais);
        assert!(self.echecs.is_empty(), "{} échec(s) :\n{}", self.echecs.len(), self.echecs.join("\n"));
        self.essais
    }
}
