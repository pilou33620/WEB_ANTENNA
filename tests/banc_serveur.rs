//! Banc du serveur : ce qu'il sert, ce qu'il refuse.
//!
//!     cargo test --test banc_serveur
//!
//! Démarre l'exécutable web_antenna (boîte noire : sous-processus et HTTP) sur un port
//! libre de 127.0.0.1 et vérifie que la page se charge, que rien d'autre du dépôt ne sort
//! (.git, clé IA, sources, chemins Windows) et qu'un Host étranger est refusé (DNS rebinding).
//! C'est python/test/banc-serveur.py, cas pour cas ; ce qu'il vérifiait en remplaçant une
//! fonction du serveur (la panne interne, `lire` d'un autre projet) est dans les tests
//! unitaires (src/serveur.rs, src/projet/essais.rs).
mod commun;

use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;

use antenne_modele::{dumps, Json};
use commun::{Bilan, Rep, RACINE};

fn requete(port: u16, methode: &str, chemin: &str, corps: &[u8], entetes: &[(&str, &str)]) -> Rep {
    commun::requete(port, methode, chemin, entetes, corps).unwrap()
}

fn code(port: u16, chemin: &str) -> u16 {
    requete(port, "GET", chemin, b"", &[]).code
}

/// Coupe la connexion par un RST (SO_LINGER à zéro) ; hors Unix, une fermeture ordinaire.
fn couper(s: TcpStream) {
    #[cfg(unix)]
    unsafe {
        use std::os::fd::AsRawFd;
        let l = libc::linger { l_onoff: 1, l_linger: 0 };
        libc::setsockopt(s.as_raw_fd(), libc::SOL_SOCKET, libc::SO_LINGER, &l as *const _ as *const libc::c_void,
                         std::mem::size_of::<libc::linger>() as libc::socklen_t);
    }
    drop(s);
}

#[test]
fn banc() {
    let maison = commun::dossier_neuf("banc-webantenna");
    let projets = maison.join("projets-essai");
    let mut b = Bilan::default();

    let poste = commun::demarrer(&maison, &["--projets", projets.to_str().unwrap()], &[]);
    let port = poste.port;

    // (chemin, Host, code attendu)
    let cas: &[(&str, Option<&str>, u16)] = &[
        ("/", None, 200),
        ("/index.html", None, 200),
        ("/css/theme.css", None, 200),
        ("/js/01-api.js", None, 200),
        ("/js/vendor/occt/occt-import-js.wasm", None, 200),
        ("/api/openems", None, 200),
        ("/.git/config", None, 404),
        ("/.git/", None, 404),
        ("/js/", None, 404),
        ("/js/../web_antenna.py", None, 404),
        ("/js/%2e%2e/web_antenna.py", None, 404),
        ("/web_antenna.py", None, 404),
        ("/README.md", None, 404),
        ("/api_key_free_ia_studio.txt", None, 404),
        ("/C:%5cWindows%5cwin.ini", None, 404),
        ("/js/..%5c..%5cweb_antenna.py", None, 404),
        ("/env/pyvenv.cfg", None, 404),
        ("/", Some("192.168.1.20:8000"), 200),
        ("/", Some("[::1]:8000"), 200),
        ("/", Some("localhost:8000"), 200),
        ("/", Some("evil.example:8000"), 403),
        ("/api/ia/cle", Some("evil.example"), 403),
        ("/api/ia/cle", None, 404), // l'assistant IA est retire : plus de route de cle
        // ce que le depot porte depuis le passage a Rust
        ("/Cargo.toml", None, 404),
        ("/src/main.rs", None, 404),
        ("/js/%2e%2e/Cargo.toml", None, 404),
        ("/target/debug/web_antenna", None, 404),
        ("/openEMS/openEMS", None, 404),
    ];
    for (chemin, hote, attendu) in cas {
        let entetes: Vec<(&str, &str)> = hote.iter().map(|h| ("Host", *h)).collect();
        b.verifier(&format!("{chemin} Host={hote:?}"), requete(port, "GET", chemin, b"", &entetes).code, *attendu);
    }
    b.verifier("HEAD /.git/config", requete(port, "HEAD", "/.git/config", b"", &[]).code, 404);

    // Canal de pilotage (pilote.rs de web_suite, MCP) : une page bat, le MCP de ce poste voit
    // l'onglet ; une autre origine est refusée ; les fichiers de la page sont servis
    let json_ = ("Content-Type", "application/json");
    let maison_ = ("X-WEB_ANTENNA", "1"); // l'en-tête maison que la page pose (js/01-api.js)
    let lire = |chemin: &str| requete(port, "GET", chemin, b"", &[json_, maison_]);
    let poster = |chemin: &str, corps: &str| requete(port, "POST", chemin, corps.as_bytes(), &[json_, maison_]);
    let battement = |navigateur: &str, onglet: &str| {
        format!(r#"{{"navigateur": "{navigateur}", "onglets": [{{"id": "{onglet}", "page": "antenna", "projet": "dipole", "focus_il_y_a": 0}}]}}"#)
    };
    let battre = |corps: &str, entetes: &[(&str, &str)]| requete(port, "POST", "/api/pilote/battement", corps.as_bytes(), entetes).code;
    let onglets = || -> Vec<String> {
        let vus = lire("/api/pilote/onglets").json();
        vus["onglets"].as_liste().unwrap().iter().map(|o| o["id"].as_str().unwrap().to_string()).collect()
    };
    let ici = format!("http://127.0.0.1:{port}");
    b.verifier("autre origine refusée", battre(&battement("n1", "o1"), &[json_, maison_, ("Origin", "http://evil.example")]), 403);
    b.verifier("battement de la page", battre(&battement("n1", "o1"), &[json_, maison_, ("Origin", &ici)]), 200);
    b.verifier("onglet vu par le MCP", onglets(), vec!["o1".to_string()]);
    // En-tête maison X-WEB_ANTENNA (REGLES §2.3) : sans lui, tout POST est refusé et rien n'est noté
    b.verifier(
        "sans en-tête maison : 403, rien de noté",
        (battre(&battement("n2", "o2"), &[json_]), requete(port, "POST", "/api/projet/fermer", b"{}", &[json_]).code, onglets()),
        (403, 403, vec!["o1".to_string()]),
    );
    // Ouvrir change le projet courant : POST {nom}, plus de GET
    b.verifier(
        "ouvrir un projet : POST seulement",
        (lire("/api/projet/ouvrir?nom=x").code, requete(port, "POST", "/api/projet/ouvrir", b"{}", &[json_]).code, poster("/api/projet/ouvrir", "{}").code),
        (404, 403, 400),
    );
    b.verifier("lire le projet ouvert : GET, et rien d'ouvert : 409", lire("/api/projet/lire").code, 409);
    b.verifier("js/pilote.js servi", (code(port, "/js/pilote.js"), code(port, "/js/pilote-antenna.js")), (200, 200));
    b.verifier("css/pilote.css servi", code(port, "/css/pilote.css"), 200);

    // Lire le projet ouvert (GET) : son contenu, sans changer le projet courant
    for nom in ["p1", "p2"] {
        fs::create_dir_all(projets.join(nom)).unwrap();
        fs::write(projets.join(nom).join("projet.json"), r#"{"format": "antenne-openems/projet"}"#).unwrap();
    }
    b.verifier("ouvrir p1", poster("/api/projet/ouvrir", r#"{"nom": "p1"}"#).code, 200);
    let lu = lire("/api/projet/lire");
    b.verifier("lire le projet ouvert : son contenu", (lu.code, lu.json()["nom"].as_str().map(str::to_string)), (200, Some("p1".to_string())));
    let etat = lire("/api/projet").json();
    b.verifier("lire ne change pas le projet courant", dumps(&etat["ouvert"]["nom"]), r#""p1""#.to_string());
    let noms: Vec<&str> = etat["projets"].as_liste().unwrap().iter().filter_map(|p| p["nom"].as_str()).collect();
    b.verifier("la liste des projets est celle de --projets", (noms.len(), etat["dispo"].clone()), (2, Json::Bool(true)));

    let r = lire("/");
    b.verifier(
        "cadres : même origine seulement",
        (r.entete("X-Frame-Options"), r.entete("Content-Security-Policy").unwrap_or("").contains("frame-ancestors 'self'")),
        (Some("SAMEORIGIN"), true),
    );
    b.verifier("pages jamais gardées en cache, l'API sans consigne", (r.entete("Cache-Control"), lire("/api/openems").entete("Cache-Control")), (Some("no-store"), None));

    // --- Ce que le serveur fait de plus qu'un serveur de fichiers, vu de la page ---
    // 1. lire un fichier IPC-2581
    let carte = fs::read(Path::new(RACINE).join("test").join("patch-2450.xml")).unwrap();
    let r = requete(port, "POST", "/api/ipc2581?nom=patch-2450.xml", &carte, &[maison_]);
    let modele = r.json();
    b.verifier("IPC-2581 : la carte d'essai est lue", (r.code, modele["format"].as_str(), modele["stats"]["percages"].as_i64()), (200, Some("cao-ipc2581-1"), Some(1)));
    b.verifier("IPC-2581 : un fichier qui n'en est pas un est refusé, et le dit", requete(port, "POST", "/api/ipc2581?nom=x.xml", b"<pas-du-ipc/>", &[maison_]).code, 422);
    b.verifier("IPC-2581 : requête vide", requete(port, "POST", "/api/ipc2581", b"", &[maison_]).texte(), r#"{"detail": "Requete vide"}"#.to_string());
    // 2. l'antenne : préparer et exporter marchent sans openEMS
    let doc = fs::read_to_string(Path::new(RACINE).join("modele/essais/cas/banc-0001.json")).unwrap();
    let r = poster("/api/openems", &doc);
    b.verifier("antenne : un document se prépare", (r.code, r.json()["estimation"]["cellules"].as_i64().is_some()), (200, true));
    let r = poster("/api/openems/script", &doc);
    let export = r.json();
    b.verifier(
        "antenne : l'export rend le XML d'openEMS et son lisez-moi",
        (r.code, export["nom"].as_str().is_some_and(|n| n.ends_with("_openems.xml")), export["script"].as_str().is_some_and(|x| x.starts_with("<?xml")), export["lisez_moi"].as_str().is_some_and(|l| !l.is_empty())),
        (200, true, true, true),
    );
    b.verifier("antenne : un document vide est refusé avec son conseil", poster("/api/openems", "{}").code, 422);
    b.verifier("antenne : JSON illisible", poster("/api/openems", "{pas du json").code, 400);
    let etat = lire("/api/openems").json();
    let solveur = etat["solveur"].as_objet().unwrap();
    b.verifier("état : préparer toujours, et le solveur dit ses exécutables", (etat["preparer"].clone(), solveur.contains_key("executable"), solveur.contains_key("nf2ff"), solveur.contains_key("python")), (Json::Bool(true), true, true, false));
    b.verifier("fils : un nombre, borné", (poster("/api/openems/fils?n=3", "{}").json()["regle"].as_i64(), poster("/api/openems/fils?n=abc", "{}").texte()), (Some(3), r#"{"detail": "Nombre de fils illisible : 'abc'"}"#.to_string()));
    b.verifier("simulation inconnue : 404", (lire("/api/openems/journal?id=abc").code, lire("/api/openems/champs?id=..").code, lire("/api/openems/journal").code), (404, 404, 400));
    // 3. écrire sur le disque, et relire
    let r = poster("/api/projet/enregistrer", r#"{"nom": "Essai é", "titre": "été", "carte": {"nets": ["GND"]}}"#);
    b.verifier("projet : enregistré dans --projets", (r.code, projets.join("Essai é").join("carte.json").is_file()), (200, true));
    b.verifier("projet : les textes hors ASCII sortent échappés (json.dumps de Python)", (r.texte().contains("Essai \\u00e9"), r.texte().is_ascii()), (true, true));
    b.verifier("projet : un nom qui sort du dossier est refusé", poster("/api/projet/enregistrer", r#"{"nom": "../dehors"}"#).code, 422);
    b.verifier("projet : --projets et les fils rangés n'écrivent que les fils dans le réglage du poste",
               fs::read_to_string(maison.join(".antenne-openems.json")).unwrap_or_default(), r#"{"fils":3}"#.to_string());
    b.verifier("archiver : sans identifiant, puis un identifiant inventé", (poster("/api/projet/archiver", "{}").code, poster("/api/projet/archiver", r#"{"id": "../.."}"#).code), (400, 422));
    b.verifier("GitHub : sans lanceur, la route n'existe pas", lire("/api/github").code, 404);
    b.verifier("route inconnue", (lire("/api/inconnue").texte(), poster("/api/inconnue", "{}").code, requete(port, "PUT", "/", b"", &[]).code), (r#"{"detail": "Route inconnue : /api/inconnue"}"#.to_string(), 404, 501));
    b.verifier("corps trop grand : refusé avant lecture", requete(port, "POST", "/api/projet/ouvrir", &vec![b'x'; 5000], &[maison_]).texte(), r#"{"detail": "Trop grand : 0.0 Mo, maximum 0 Mo"}"#.to_string());

    // WEB_TOOLS_BANC_DISTANT=1 : ce serveur-là traite le poste comme un autre appareil, qui ne choisit aucun dossier du disque
    let distant = commun::demarrer(&maison, &[], &[("WEB_TOOLS_BANC_DISTANT", "1")]);
    let refuse = |chemin: &str, corps: &str| requete(distant.port, "POST", chemin, corps.as_bytes(), &[json_, maison_]).code;
    b.verifier(
        "seul ce poste choisit un dossier du disque",
        (refuse("/api/projet/racine", r#"{"chemin": "/tmp"}"#), refuse("/api/projet/dossier", "{}"), refuse("/api/projet/importer", r#"{"chemin": "/tmp"}"#), code(distant.port, "/")),
        (403, 403, 403, 200),
    );
    distant.arreter();

    // --- Un client coupé en pleine réponse n'est pas une erreur à afficher, et le serveur continue ---
    for _ in 0..3 {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.write_all(format!("GET /js/vendor/occt/occt-import-js.wasm HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").as_bytes()).unwrap();
        let _ = s.read(&mut [0u8; 1000]);
        couper(s); // RST à la fermeture
    }
    b.verifier("client coupé : le serveur sert toujours", code(port, "/index.html"), 200);
    let erreurs = fs::read_to_string(maison.join("erreurs.txt")).unwrap();
    b.verifier("client coupé : rien d'affiché", erreurs.lines().filter(|l| l.contains("panicked")).collect::<Vec<_>>(), vec![]);
    b.verifier(
        "journal : une ligne par requête, et ce que le serveur a fait",
        (erreurs.contains("\"GET /.git/config\" 404"), erreurs.contains("code 404, message File not found"), erreurs.contains("IPC-2581 « patch-2450.xml » : 0 composant(s)"), erreurs.contains("Projet « p1 » ouvert")),
        (true, true, true, true),
    );
    b.verifier("annonce : l'adresse, et pourquoi « Lancer » est éteint ou non", (poste.annonce.contains("  Antenne openEMS\n"), poste.annonce.contains("  Solveur openEMS   ")), (true, true));

    poste.arreter();
    b.conclure();
    let _ = fs::remove_dir_all(&maison);
}
