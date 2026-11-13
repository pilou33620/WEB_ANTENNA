//! Banc d'essai du relai « Enregistrer + GitHub » de web_antenna :
//!
//!     GET  /api/github             -- l'envoi est-il possible d'ici ?
//!     POST /api/github/envoyer     -- relaye au lanceur WEB_SUITE (/api/envoyer)
//!     POST /api/github/identite    -- relaye au lanceur WEB_SUITE (/api/identite)
//!
//!     cargo test --test banc_github_relai
//!
//! Un faux lanceur, sur la boucle locale, note ce qu'il recoit et repond comme le
//! vrai. Rien n'est commite ni pousse. Ce qui compte surtout ici : un autre
//! appareil du reseau ne passe qu'avec le jeton du lanceur, comme chez le lanceur
//! lui-meme -- sans quoi n'importe qui pousserait sur GitHub avec les identifiants
//! du poste. Meme banc que celui de WEB_CAO, au nom d'outil pres.
//!
//! C'est python/test/banc-github-relai.py, cas pour cas. Le lanceur et son jeton
//! arrivent par l'environnement (WEBSUITE_LANCEUR, WEBSUITE_JETON) : chaque reglage
//! est un serveur lance ; « un autre appareil » est WEB_TOOLS_BANC_DISTANT=1.
mod commun;

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

use antenne_modele::{dumps, json_depuis_texte, Json};
use commun::{Bilan, Lance};

const JETON: &str = "jeton-du-lanceur-0123456789";

struct Recu {
    route: String,
    entetes: Vec<(String, String)>,
    corps: Json,
}

/// Le faux lanceur : note chaque POST et rend `reponse`.
struct FauxLanceur {
    port: u16,
    recus: Arc<Mutex<Vec<Recu>>>,
    reponse: Arc<Mutex<String>>,
}

impl FauxLanceur {
    fn demarrer() -> FauxLanceur {
        let ecoute = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = ecoute.local_addr().unwrap().port();
        let recus = Arc::new(Mutex::new(Vec::new()));
        let reponse = Arc::new(Mutex::new(String::new()));
        let (r2, rep2) = (recus.clone(), reponse.clone());
        std::thread::spawn(move || {
            for flux in ecoute.incoming().flatten() {
                let mut lecteur = BufReader::new(flux);
                let mut ligne = String::new();
                lecteur.read_line(&mut ligne).unwrap();
                let route = ligne.split(' ').nth(1).unwrap_or("").to_string();
                let mut entetes = Vec::new();
                loop {
                    ligne.clear();
                    lecteur.read_line(&mut ligne).unwrap();
                    match ligne.trim_end().split_once(':') {
                        Some((k, v)) => entetes.push((k.to_string(), v.trim().to_string())),
                        None => break,
                    }
                }
                let n = entetes.iter().find(|(k, _)| k.eq_ignore_ascii_case("Content-Length")).and_then(|(_, v)| v.parse().ok()).unwrap_or(0);
                let mut corps = vec![0u8; n];
                lecteur.read_exact(&mut corps).unwrap();
                r2.lock().unwrap().push(Recu { route, entetes, corps: json_depuis_texte(&String::from_utf8_lossy(&corps)).unwrap_or(Json::Nul) });
                let rendu = rep2.lock().unwrap().clone();
                let _ = write!(lecteur.get_mut(), "HTTP/1.0 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", rendu.len(), rendu);
            }
        });
        FauxLanceur { port, recus, reponse }
    }

    fn repondre(&self, reponse: &str) {
        *self.reponse.lock().unwrap() = reponse.to_string();
    }

    fn compte(&self) -> usize {
        self.recus.lock().unwrap().len()
    }
}

fn req(serveur: &Lance, methode: &str, route: &str, corps: Option<&str>, entetes: &[(&str, &str)]) -> (u16, Json) {
    let mut h = vec![("Content-Type", "application/json"), ("X-WEB_ANTENNA", "1")];
    h.extend_from_slice(entetes);
    let r = commun::requete(serveur.port, methode, route, &h, corps.unwrap_or("").as_bytes()).unwrap();
    (r.code, json_depuis_texte(&r.texte()).unwrap_or(Json::Nul))
}

#[test]
fn banc() {
    let maison = commun::dossier_neuf("banc-webantenna-github");
    let lanceur = FauxLanceur::demarrer();
    let adresse = format!("http://127.0.0.1:{}", lanceur.port);
    let regler = |lanceur: &str, local: bool, jeton: &str| {
        let mut env = vec![("WEBSUITE_LANCEUR", lanceur), ("WEBSUITE_JETON", jeton)];
        if !local {
            env.push(("WEB_TOOLS_BANC_DISTANT", "1"));
        }
        commun::demarrer(&maison, &[], &env)
    };
    let envoyer = |s: &Lance, message: &str, entetes: &[(&str, &str)]| req(s, "POST", "/api/github/envoyer", Some(&format!(r#"{{"message": "{message}"}}"#)), entetes);
    let mut b = Bilan::default();

    // -- sans lanceur : la route n'existe pas ---------------------------
    let s = regler("", true, JETON);
    b.verifier("sans lanceur, GET /api/github -> 404", req(&s, "GET", "/api/github", None, &[]).0, 404);
    b.verifier("sans lanceur, rien n'est relaye", (envoyer(&s, "x", &[]).0, lanceur.compte()), (404, 0));
    s.arreter();

    // -- un « lanceur » hors de ce poste n'est jamais appele ------------
    let s = regler("http://192.168.1.50:8100", true, JETON);
    b.verifier("lanceur hors boucle locale refuse", req(&s, "GET", "/api/github", None, &[]).0, 404);
    s.arreter();

    // -- ce poste ---------------------------------------------------------
    let s = regler(&adresse, true, JETON);
    lanceur.repondre(r#"{"ok": true, "message": "Envoyé sur GitHub.", "outils": []}"#);
    let (code, d) = req(&s, "GET", "/api/github", None, &[]);
    b.verifier("ce poste : envoi disponible", (code, dumps(&d)), (200, r#"{"disponible": true}"#.to_string()));
    let (code, d) = envoyer(&s, "Antenne : patch recale", &[]);
    b.verifier("ce poste : envoi relaye au lanceur", (code, dumps(&d)), (200, r#"{"ok": true, "identite": false, "message": "Envoyé sur GitHub."}"#.to_string()));
    {
        let recus = lanceur.recus.lock().unwrap();
        let r = recus.last().unwrap();
        b.verifier(
            "relai : route /api/envoyer, outil web_antenna, message transmis",
            (r.route.as_str(), dumps(&r.corps)),
            ("/api/envoyer", r#"{"id": "web_antenna", "message": "Antenne : patch recale"}"#.to_string()),
        );
        let entete = |nom: &str| r.entetes.iter().find(|(k, _)| k.eq_ignore_ascii_case(nom)).map(|(_, v)| v.clone());
        b.verifier(
            "relai : en-tete X-WebSuite et Host local (exiges par le lanceur)",
            (entete("X-WebSuite"), entete("Host")),
            (Some("1".to_string()), Some(format!("127.0.0.1:{}", lanceur.port))),
        );
    }
    let code = envoyer(&s, &"m".repeat(2000), &[]).0;
    let longueur = lanceur.recus.lock().unwrap().last().unwrap().corps["message"].as_str().unwrap().len();
    b.verifier("message tronque a 500 caracteres", (code, longueur), (200, 500));

    // -- poste neuf : le lanceur demande l'identite git --------------------
    lanceur.repondre(r#"{"ok": false, "identite": true, "message": "git ne connaît pas encore"}"#);
    let (code, d) = envoyer(&s, "x", &[]);
    b.verifier("identite manquante transmise a la page", (code, d["identite"].clone(), d["ok"].clone()), (200, Json::Bool(true), Json::Bool(false)));
    lanceur.repondre(r#"{"ok": true, "message": "Identité git enregistrée pour PROJETS."}"#);
    let (code, d) = req(&s, "POST", "/api/github/identite", Some(r#"{"nom": "Pilou", "email": "p@example.com"}"#), &[]);
    {
        let recus = lanceur.recus.lock().unwrap();
        let r = recus.last().unwrap();
        b.verifier(
            "identite relayee",
            (code, d["ok"].clone(), r.route.as_str(), dumps(&r.corps)),
            (200, Json::Bool(true), "/api/identite", r#"{"nom": "Pilou", "email": "p@example.com"}"#.to_string()),
        );
    }
    lanceur.repondre(r#"{"ok": true, "message": "Envoyé sur GitHub.", "outils": []}"#);

    // -- page d'un autre site : protection CSRF ----------------------------
    let avant = lanceur.compte();
    b.verifier("origine inter-site refusee", (envoyer(&s, "x", &[("Origin", "https://exemple.com")]).0, lanceur.compte()), (403, avant));
    // une reponse du lanceur qui n'est pas un objet JSON, puis son refus : 502 lisible
    b.verifier("corps JSON attendu pour l'identite", req(&s, "POST", "/api/github/identite", Some("[]"), &[]).0, 400);
    lanceur.repondre("pas du JSON");
    let (code, d) = envoyer(&s, "x", &[]);
    b.verifier("reponse illisible du lanceur : 502", (code, dumps(&d)), (502, r#"{"detail": "Reponse illisible du lanceur WEB_SUITE"}"#.to_string()));
    lanceur.repondre(r#"{"ok": true, "message": "Envoyé sur GitHub.", "outils": []}"#);
    s.arreter();

    // -- autre appareil du reseau : le jeton du lanceur est exige ----------
    let s = regler(&adresse, false, JETON);
    let avant = lanceur.compte();
    b.verifier("autre appareil sans jeton : refuse, rien de relaye", (envoyer(&s, "x", &[]).0, lanceur.compte()), (403, avant));
    b.verifier(
        "autre appareil, mauvais jeton : refuse",
        (envoyer(&s, "x", &[("Cookie", "websuite_jeton=mauvais-jeton-0000000000")]).0, lanceur.compte()),
        (403, avant),
    );
    let biscuit = format!("websuite_jeton={JETON}");
    b.verifier(
        "autre appareil, bon jeton (cookie du lanceur) : disponible",
        req(&s, "GET", "/api/github", None, &[("Cookie", &format!("autre=1; {biscuit}"))]).0,
        200,
    );
    let (code, d) = envoyer(&s, "depuis l'iPad", &[("Cookie", &biscuit)]);
    let transmis = lanceur.recus.lock().unwrap().last().unwrap().corps["message"].as_str().map(str::to_string);
    b.verifier("autre appareil, bon jeton : envoi relaye", (code, d["ok"].clone(), transmis), (200, Json::Bool(true), Some("depuis l'iPad".to_string())));
    s.arreter();

    let s = regler(&adresse, false, "");
    let avant = lanceur.compte();
    b.verifier(
        "lanceur sans jeton : un autre appareil ne passe jamais",
        (envoyer(&s, "x", &[("Cookie", "websuite_jeton=")]).0, lanceur.compte()),
        (403, avant),
    );
    s.arreter();

    // -- lanceur arrete -----------------------------------------------------
    let ferme = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port(); // plus personne n'y ecoute
    let s = regler(&format!("http://127.0.0.1:{ferme}"), true, JETON);
    let (code, d) = envoyer(&s, "x", &[]);
    b.verifier("lanceur injoignable : 502 lisible", (code, d["detail"].as_str().is_some_and(|t| t.contains("injoignable"))), (502, true));
    s.arreter();

    let essais = b.conclure();
    assert_eq!(essais, 19, "les 17 verifications du banc d'origine, et deux de plus");
    let _ = std::fs::remove_dir_all(&maison);
}
