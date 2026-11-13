//! Les fichiers de la page, plus les routes de l'API : ce que faisait la classe `Poste`
//! de web_antenna.py.

use std::fmt::Write as _;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;

use antenne_modele::modele::ErreurModele;
use antenne_modele::outils::py_str;
use antenne_modele::{json_depuis_texte, obj, Json};
use antenne_solveur::antenne;
use ipc2581::py::dumps;
use regex::Regex;
use web_tools_commun::appairage::{self, Garde};
use web_tools_commun::pilote::Pilote;
use web_tools_commun::serveur::{Reponse, Requete};

use crate::projet::{self, ErreurProjet};

// Un IPC-2581 est un XML bavard : une carte de taille moyenne pese quelques
// dizaines de mega-octets, et l'archive ZIP d'un fabricant guere moins une
// fois ouverte. Le plafond protege la memoire du serveur, rien d'autre.
pub const MAX_IPC: usize = 192 * 1024 * 1024;
pub const MAX_OPENEMS: usize = antenne::MAX_CORPS;
// Un projet porte la carte entiere quand elle a change : le plafond est donc
// celui d'un IPC-2581 traduit, et non celui d'un document de simulation.
pub const MAX_PROJET: usize = MAX_IPC;

// CE QUE LA PAGE CHARGE, ET RIEN D'AUTRE. Le dossier servi est aussi celui
// du depot : .git/, env/, openEMS/, un fichier de cle oublie, les cartes posees a la
// racine. Aucun ne regarde un client du reseau. Un segment ne commence jamais
// par un point (ni « .. », ni fichier cache), et ni « \ » ni « : » ne passent :
// sous Windows, « /C:%5cWindows%5cwin.ini » sortait du depot.
pub static STATIQUE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^/(?:index\.html)?$|^/(?:css|js)(?:/[\w-][\w.-]*)+$").unwrap());

// WEB_SUITE : le lanceur qui a demarre cet outil donne son adresse sur ce poste
// et, en mode reseau, son jeton (lanceur/outils.py, par l'environnement : une
// option inconnue ferait echouer une version plus ancienne). Les routes
// /api/github* relaient alors a ce lanceur l'envoi des projets sur GitHub
// (commit + pull + push de PROJETS), pour que la page enregistre ET envoie
// d'un seul geste -- depuis une tablette, le lanceur est dans un autre onglet.
// Sans lanceur, ces routes repondent 404. C'est le meme relai que celui de
// WEB_CAO (web_CAO.py), au nom d'outil pres.
const BISCUIT_LANCEUR: &str = "websuite_jeton"; // le cookie que pose le lanceur (meme hote)
const DELAI_LANCEUR: u64 = 660; // le push du lanceur peut prendre 600 s
const ID_OUTIL: &str = "web_antenna"; // l'outil, tel que le lanceur le connait

/// (hote, port) du lanceur, s'il est sur ce poste ; None sinon.
///
/// Le relai ne part que vers la boucle locale : une adresse venue d'ailleurs
/// ferait de cette route un tremplin vers n'importe quel serveur.
fn adresse_lanceur(lanceur: &str) -> Option<u16> {
    let reste = lanceur.get(..7).filter(|s| s.eq_ignore_ascii_case("http://")).map(|_| &lanceur[7..])?;
    let autorite = reste.split(['/', '?', '#']).next().unwrap_or("");
    let (hote, port) = autorite.rsplit('@').next().unwrap_or("").rsplit_once(':')?;
    let hote = hote.to_lowercase();
    let port: u16 = port.parse().ok().filter(|p| *p != 0)?;
    (hote == "127.0.0.1" || hote == "localhost").then_some(port)
}

/// Refus explicite : code HTTP + message lisible par un humain.
#[derive(Debug)]
pub struct Refus {
    pub code: u16,
    pub message: String,
}

type Rendu = Result<Json, Refus>;

fn refus(code: u16, message: impl Into<String>) -> Refus {
    Refus { code, message: message.into() }
}

/// Ce que Python rendait d'une exception qu'il n'attendait pas : la trace au terminal, pas
/// au client — elle porte des chemins.
fn interne(genre: &str, trace: &str) -> Refus {
    eprintln!("  {} : {}", genre, trace);
    refus(500, format!("Erreur interne ({}) : le detail est dans le terminal du serveur.", genre))
}

/// Message + conseil en un seul texte : la page coupe a la premiere
/// ligne pour le titre et garde le reste comme explication.
fn detail(message: &str, conseil: &str) -> String {
    if conseil.is_empty() { message.to_string() } else { format!("{}\n{}", message, conseil) }
}

fn de_modele(code: u16) -> impl Fn(ErreurModele) -> Refus {
    move |exc| refus(code, detail(&exc.message, &exc.conseil))
}

/// json.dumps(charge) : tout ce qui sort de l'ASCII imprimable s'ecrit \uXXXX.
fn ascii(texte: String) -> String {
    if texte.chars().all(|c| (' '..='~').contains(&c)) {
        return texte;
    }
    let mut out = String::with_capacity(texte.len() + texte.len() / 4);
    let mut paire = [0u16; 2];
    for c in texte.chars() {
        if (' '..='~').contains(&c) {
            out.push(c);
        } else {
            for u in c.encode_utf16(&mut paire) {
                let _ = write!(out, "\\u{:04x}", u);
            }
        }
    }
    out
}

fn rendre_json(code: u16, charge: &Json) -> Reponse {
    Reponse {
        code,
        entetes: vec![("Content-Type".into(), "application/json; charset=utf-8".into())],
        corps: ascii(dumps(charge)).into_bytes(),
        suite: None,
    }
}

fn rendre_detail(code: u16, texte: &str) -> Reponse {
    rendre_json(code, &obj! {"detail" => texte})
}

/// Execute action() et traduit les refus en {"detail": "..."}.
///
/// UN REFUS N'EST PAS UNE PANNE, et la page les traite differemment :
/// « le port relie une couche a elle-meme » est une consigne, pas une
/// erreur de serveur. D'ou un message lisible plutot qu'une trace.
///
/// Une panique tient lieu d'exception inattendue : sa trace part au terminal, et le client
/// recoit un 500 court.
fn proteger(action: impl FnOnce() -> Rendu) -> (u16, Json) {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(action)) {
        Ok(Ok(charge)) => (200, charge),
        Ok(Err(exc)) => (exc.code, obj! {"detail" => exc.message}),
        Err(_) => (500, obj! {"detail" => "Erreur interne (panique) : le detail est dans le terminal du serveur."}),
    }
}

/// send_error de http.server : la meme page d'erreur.
fn erreur(code: u16, message: &str) -> Reponse {
    let explication = match code {
        404 => "Nothing matches the given URI",
        _ => "Server does not support this operation",
    };
    eprintln!("  code {}, message {}", code, message);
    let message = message.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let corps = format!(
        "<!DOCTYPE HTML>\n<html lang=\"en\">\n    <head>\n        <meta charset=\"utf-8\">\n        <title>Error response</title>\n    </head>\n    <body>\n        <h1>Error response</h1>\n        <p>Error code: {code}</p>\n        <p>Message: {message}.</p>\n        <p>Error code explanation: {code} - {explication}.</p>\n    </body>\n</html>\n"
    );
    Reponse { code, entetes: vec![("Content-Type".into(), "text/html;charset=utf-8".into())], corps: corps.into_bytes(), suite: None }
}

fn introuvable() -> Reponse {
    erreur(404, "File not found")
}

// Les types que ce serveur distribue. On ne s'en remet pas au registre du
// systeme : sous Windows, la base de registre rend parfois text/plain pour
// un .js, et le navigateur refuse alors de l'executer.
pub fn type_mime(chemin: &Path) -> &'static str {
    let ext = chemin.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    match ext.as_str() {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "xml" => "application/xml; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        // Le noyau OpenCascade des pieces STEP (js/vendor/occt/). Sans ce
        // type, le navigateur refuse la compilation en flux et retombe sur
        // une compilation plus lente, en le signalant dans la console.
        "wasm" => "application/wasm",
        "txt" => "text/plain", // les licences de js/vendor/ : ce que rendait la table de Python
        _ => "application/octet-stream",
    }
}

/// urllib.parse.unquote : %XX, et « + » reste « + ».
pub fn decoder_chemin(s: &str) -> String {
    let b = s.as_bytes();
    let hex = |i: usize| b.get(i).and_then(|c| (*c as char).to_digit(16));
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match (b[i], hex(i + 1), hex(i + 2)) {
            (b'%', Some(h), Some(l)) => {
                out.push((h * 16 + l) as u8);
                i += 3;
            }
            (c, _, _) => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Le journal de http.server, sur la sortie d'erreur, jeton masque.
fn journal(r: &Requete, code: u16) {
    eprintln!("  {}", appairage::masquer(&format!("\"{} {}\" {} -", r.methode, r.cible, code)));
}

/// int(texte) d'un parametre de l'adresse.
fn entier(texte: &str) -> Option<i64> {
    ipc2581::py::strip(texte).parse().ok()
}

/// repr(texte) de Python.
fn repr(texte: &str) -> String {
    let liste = py_str(&Json::Liste(vec![texte.into()]));
    liste[1..liste.len() - 1].to_string()
}

/// doc.get(cle) or "" : le texte d'un champ du document, "" s'il manque.
fn champ_texte(doc: &Json, cle: &str) -> Result<String, Refus> {
    match doc {
        _ if !doc.vrai() => Ok(String::new()),
        Json::Objet(_) => match &doc[cle] {
            v if !v.vrai() => Ok(String::new()),
            Json::Texte(t) => Ok(t.clone()),
            autre => Err(interne("TypeError", &format!("« {} » devrait etre un texte : {}", cle, dumps(autre)))),
        },
        _ => Err(interne("AttributeError", "le document devrait etre un objet JSON")),
    }
}

pub struct Poste {
    /// Le depot : index.html, css/, js/.
    pub racine: PathBuf,
    // Host controle (DNS rebinding) et code d'appairage exige des autres appareils
    // du reseau : appairage.py, commun aux web tools (meme jeton et meme cookie que
    // le lanceur WEB_SUITE). Remplace dans main() selon --local.
    pub garde: Garde,
    /// Canal de pilotage des pages par le MCP de web_suite
    pub pilote: Pilote,
    /// WEBSUITE_LANCEUR : l'adresse du lanceur sur ce poste.
    pub lanceur: String,
    /// WEBSUITE_JETON : son jeton, en mode reseau.
    pub jeton_lanceur: String,
}

impl Poste {
    pub fn servir(&self, r: &mut Requete) -> Reponse {
        let rendu = match self.garde.filtrer(r) {
            Some(refus) => refus,
            None => match r.methode.as_str() {
                "GET" => self.get(r),
                "HEAD" => self.head(r),
                "POST" => self.post(r),
                autre => erreur(501, &format!("Unsupported method ('{}')", autre)),
            },
        };
        journal(r, rendu.code);
        // Un fichier servi en clair ne doit pas etre mis en cache par le
        // navigateur : on modifie ces fichiers-la en travaillant, et un .js garde
        // en cache donne des heures de debogage sur du code qui n'existe plus.
        let hors_api = !route(r).starts_with("/api/") && !rendu.entetes.iter().any(|(k, _)| k.eq_ignore_ascii_case("Cache-Control"));
        let rendu = if hors_api { rendu.entete("Cache-Control", "no-store") } else { rendu };
        // Pas d'affichage dans le cadre d'un autre site : un clic piégé sur « Appliquer » du panneau Claude
        rendu.entete("X-Frame-Options", "SAMEORIGIN").entete("Content-Security-Policy", "frame-ancestors 'self'")
    }

    // -- garde-fous ------------------------------------------------------
    /// Fichier de la page ? Sinon 404, sans dire s'il existe.
    fn statique(&self, r: &Requete) -> Reponse {
        let chemin = decoder_chemin(r.chemin());
        if !STATIQUE.is_match(&chemin) {
            return introuvable();
        }
        let mut cible = chemin.split('/').filter(|m| !m.is_empty()).fold(self.racine.clone(), |c, m| c.join(m));
        if cible.is_dir() {
            if !chemin.ends_with('/') {
                let requete = if r.requete().is_empty() { String::new() } else { format!("?{}", r.requete()) };
                return Reponse { code: 301, entetes: Vec::new(), corps: Vec::new(), suite: None }
                    .entete("Location", &format!("{}/{}", r.chemin(), requete));
            }
            cible.push("index.html"); // « / » : le seul dossier que STATIQUE laisse passer
        }
        // Par blocs : le noyau OpenCascade pese plusieurs mega-octets.
        let ouvert = std::fs::File::open(&cible).and_then(|f| Ok((f.metadata()?, f)));
        match ouvert {
            Ok((st, f)) if st.is_file() => Reponse {
                code: 200,
                entetes: vec![("Content-type".into(), type_mime(&cible).into()), ("Content-Length".into(), st.len().to_string())],
                corps: Vec::new(),
                suite: Some(Box::new(f)),
            },
            _ => introuvable(),
        }
    }

    /// Vrai si `origine` est ce serveur-ci (« http://<Host> »), comme WEB_CAO.
    ///
    /// Le Host a deja ete verifie (hote_permis). Une liste de plages privees
    /// refusait Tailscale (100.64/10) et acceptait une box ou un autre serveur du LAN.
    fn origine_permise(r: &Requete, origine: &str) -> bool {
        let hote = r.entete("Host").unwrap_or("").trim().to_lowercase();
        let origine = origine.to_lowercase();
        !hote.is_empty() && (origine == format!("http://{}", hote) || origine == format!("https://{}", hote))
    }

    fn csrf(r: &Requete) -> Option<Reponse> {
        // En-tete maison exige (REGLES §2.3) : une page d'un autre site ne peut pas
        // l'ajouter sans pre-vol CORS, que ce serveur ne valide pas (aucun Access-Control-*).
        if r.entete("X-WEB_ANTENNA") != Some("1") {
            return Some(rendre_detail(403, "Requete refusee"));
        }
        match r.entete("Origin") {
            Some(origine) if !origine.is_empty() && !Self::origine_permise(r, origine) => Some(rendre_detail(403, "Origine inter-site refusee")),
            _ => None,
        }
    }

    /// La requete vient-elle de CETTE machine ?
    ///
    /// LE CONTROLE D'ORIGINE NE SUFFIT PAS ICI, ET C'EST LA NUANCE QUI
    /// COMPTE. `_csrf` protege contre une PAGE : un navigateur
    /// qui charge evil.com ne peut pas lire la reponse d'une route d'ici,
    /// faute d'en-tete `Access-Control-Allow-Origin`. Mais il ne protege
    /// de rien contre un client qui n'est pas un navigateur : un `curl` sur
    /// le reseau local pose l'en-tete maison lui-meme et n'envoie aucun
    /// `Origin`, et `_csrf` le laisse passer
    /// — deliberement, puisque c'est ainsi qu'une tablette ouvre la page.
    ///
    /// Pour les routes qui designent un chemin du disque, ce marche-la ne
    /// tient plus : le serveur ecoute sur toutes les interfaces par defaut
    /// pour que la tablette y arrive. Une adresse de boucle locale est le
    /// seul filtre qui distingue « ce poste » de « le reseau », et c'est
    /// exactement la distinction qu'on veut ici.
    fn boucle_locale(r: &Requete) -> bool {
        appairage::ce_poste(r)
    }

    fn api(r: &mut Requete, action: impl FnOnce(&mut Requete) -> Rendu) -> Reponse {
        let (code, charge) = proteger(|| action(r));
        rendre_json(code, &charge)
    }

    /// Le corps de la requete en octets. Refuse vide, trop gros.
    ///
    /// UN REFUS QUI N'ARRIVE PAS N'EST PAS UN REFUS. Repondre 413 sans lire
    /// le corps laisse les octets dans le tuyau, le systeme coupe la
    /// connexion avant que le client ait lu la reponse, et la page affiche
    /// « Failed to fetch » au lieu de « Fichier trop grand ». On vide donc,
    /// mais pas sans limite : le double du plafond, et l'on ferme au-dela.
    fn corps(r: &mut Requete, plafond: usize) -> Result<Vec<u8>, Refus> {
        let taille: i64 = match r.entete("Content-Length") {
            None | Some("") => 0,
            Some(v) => entier(v).ok_or_else(|| refus(400, "Content-Length invalide"))?,
        };
        if taille <= 0 {
            return Err(refus(400, "Requete vide"));
        }
        let taille = taille as u64;
        let plafond = plafond as u64;
        if taille > plafond {
            let _ = std::io::copy(&mut Read::take(r.flux_corps(), taille.min(2 * plafond)), &mut std::io::sink());
            return Err(refus(413, format!("Trop grand : {:.1} Mo, maximum {} Mo", taille as f64 / 1048576.0, plafond / 1048576)));
        }
        let mut corps = Vec::with_capacity(taille as usize);
        let _ = Read::take(r.flux_corps(), taille).read_to_end(&mut corps); // un envoi coupe rend ce qui est arrive
        Ok(corps)
    }

    fn document(r: &mut Requete, plafond: usize) -> Rendu {
        let corps = Self::corps(r, plafond)?;
        String::from_utf8(corps)
            .map_err(|e| e.to_string())
            .and_then(|t| json_depuis_texte(&t))
            .map_err(|exc| refus(400, format!("Document JSON illisible : {}", exc)))
    }

    // ==================================================================
    // Route 1 : lire un fichier IPC-2581
    // ==================================================================
    fn ipc_etat() -> Rendu {
        let extensions: Vec<Json> = ipc2581::EXTENSIONS.iter().chain([".zip"].iter()).map(|e| Json::from(*e)).collect();
        Ok(obj! {"dispo" => true, "format" => ipc2581::FORMAT, "extensions" => Json::Liste(extensions), "max" => MAX_IPC})
    }

    fn ipc_lire(r: &mut Requete) -> Rendu {
        let data = Self::corps(r, MAX_IPC)?;
        let nom = r.param("nom").unwrap_or_default();
        let nom: String = nom.rsplit(if cfg!(windows) { &['/', '\\'][..] } else { &['/'][..] }).next().unwrap_or("").chars().take(200).collect();
        // tout_garder=False : seuls cuivre, percages et contour entrent
        // dans une simulation (la serigraphie y serait prise pour du metal)
        let modele = ipc2581::ipc2581_en_dict(&data, &nom, false).map_err(|exc| match exc {
            ipc2581::Erreur::Parse(e) => refus(422, e.to_string()),
            ipc2581::Erreur::Interne(m) => interne(m.split(':').next().unwrap_or("Exception"), &m),
        })?;
        let compte = |cle: &str| modele["stats"][cle].as_i64().unwrap_or(0);
        eprintln!(
            "  IPC-2581 « {} » : {} composant(s), {} piste(s), {} percage(s)",
            if nom.is_empty() { "(sans nom)" } else { &nom },
            compte("composants"),
            compte("pistes"),
            compte("percages")
        );
        Ok(modele)
    }

    // ==================================================================
    // Routes 2 a 6 : l'antenne
    // ==================================================================
    /// Appelle action(doc) et traduit un refus de modele en 422.
    ///
    /// Le message et le conseil partent ensemble, separes d'une ligne : la
    /// page les affiche tels quels, l'un au-dessus de l'autre.
    fn oe_modele(r: &mut Requete, action: fn(&Json) -> Result<Json, ErreurModele>) -> Rendu {
        let doc = Self::document(r, MAX_OPENEMS)?;
        action(&doc).map_err(de_modele(422))
    }

    fn identifiant(r: &Requete) -> Result<String, Refus> {
        r.param("id").ok_or_else(|| refus(400, "Identifiant de simulation manquant"))
    }

    fn oe_journal(r: &Requete) -> Rendu {
        let ident = Self::identifiant(r)?;
        let depuis = r.param("depuis").and_then(|d| entier(&d)).unwrap_or(0).max(0) as usize;
        let vue = antenne::journal(&ident, depuis).map_err(de_modele(404))?;
        Self::oe_ranger_debit();
        Ok(vue)
    }

    /// Le debit qu'un calcul termine a montre va dans les reglages du poste.
    ///
    /// POURQUOI ICI, ET NON A LA FIN DU CALCUL. Le calcul finit dans un fil
    /// d'openems_run, qui ne sait pas ce qu'est un projet ni ou vivent les
    /// reglages — c'est la separation que `_pr_suivre` dit deja, et elle vaut
    /// dans les deux sens. Le suivi du journal, lui, passe par le serveur et
    /// s'arrete quand le calcul s'arrete : c'est le dernier endroit ou l'on
    /// est sur de repasser, et le seul qui connaisse les deux cotes.
    ///
    /// `debit_noter` ne reecrit rien quand la valeur n'a pas bouge : appelee a
    /// chaque rafraichissement du journal, elle ne touche au fichier qu'une
    /// fois par calcul.
    fn oe_ranger_debit() {
        let d = antenne::debit();
        if d["mesure"].vrai() {
            projet::debit_noter(d["mcps_brut"].as_f64().unwrap_or(0.0), d["fils"].as_i64().unwrap_or(0));
        }
        // LE BANC DE VITESSE PREND LE MEME CHEMIN, et pour la meme raison :
        // il finit dans un fil d'openems_run, qui ne sait pas ou l'on range.
        let b = &antenne::fils()["banc"];
        if b.vrai() {
            projet::banc_noter(b);
        }
    }

    /// Pose le nombre de fils des prochains calculs, et le range.
    ///
    /// UN NOMBRE, DANS L'ADRESSE, BORNE PAR LE MODELE : rien d'autre ne
    /// passe. 0 rend le choix a openEMS.
    fn oe_fils(r: &Requete) -> Rendu {
        let brut = r.param("n").unwrap_or_default();
        let Some(n) = entier(&brut) else {
            return Err(refus(400, format!("Nombre de fils illisible : {}", repr(&brut.chars().take(20).collect::<String>()))));
        };
        let out = antenne::regler_fils(n);
        projet::fils_noter(out["regle"].as_i64().unwrap_or(0));
        Ok(out)
    }

    /// Ouvre le dossier de calcul d'une simulation.
    ///
    /// LE SERVEUR LANCE UN PROGRAMME DU POSTE, et cela merite une borne :
    /// l'identifiant est resolu en dossier par openems_run, qui ne connait
    /// que les taches QU'IL A CREEES. Un chemin venu de la requete
    /// n'atteindrait donc jamais cette route — sans quoi elle ouvrirait
    /// n'importe quel dossier du poste.
    fn oe_voir(r: &Requete) -> Rendu {
        antenne::dossier(&Self::identifiant(r)?).map_err(de_modele(404))
    }

    /// La liste de ce qu'un calcul a laisse a regarder.
    ///
    /// MEME BORNE QUE « ouvrir le dossier », ET POUR LA MEME RAISON : l'identifiant est
    /// resolu en dossier par openems_run, qui ne connait que les dossiers
    /// qu'il a crees. Aucun chemin ne vient de la requete — sans quoi cette
    /// route lirait n'importe quel fichier du poste et le renverrait au
    /// navigateur.
    fn oe_champs(r: &Requete) -> Rendu {
        antenne::champs(&Self::identifiant(r)?).map_err(de_modele(404))
    }

    /// Une carte de champ, prete a animer.
    ///
    /// La page ne designe jamais un fichier : elle donne la CLE d'une serie
    /// de l'inventaire, et le serveur la resout. Les autres parametres ne
    /// decident que du decoupage — quel plan, a quelle hauteur, et combien
    /// de points au plus.
    fn oe_champ(r: &Requete) -> Rendu {
        let (Some(ident), Some(cle)) = (r.param("id"), r.param("cle")) else {
            return Err(refus(400, "Identifiant ou enregistrement manquant"));
        };
        let axe = r.param("axe").unwrap_or_default();
        let indice = r.param("indice").and_then(|i| entier(&i)).unwrap_or(-1);
        let points = r.param("points").and_then(|p| entier(&p)).unwrap_or(0).max(0) as usize;
        antenne::champ(&ident, &cle, &axe, Some(indice), points).map_err(de_modele(404))
    }

    fn oe_arreter(r: &Requete) -> Rendu {
        antenne::arreter(&Self::identifiant(r)?).map_err(|exc| refus(404, exc.message))
    }

    // ==================================================================
    // Routes 7 a 12 : les projets
    // ------------------------------------------------------------------
    // LA PAGE NE CHOISIT PAS UN CHEMIN, ELLE CHOISIT UN NOM. Un seul chemin
    // traverse ces routes — la racine, que l'utilisateur pose lui-meme et qui
    // est le sujet meme de la fonctionnalite. Tout le reste est un NOM de
    // projet, verifie caractere par caractere par projet.py et recolle a la
    // racine la-bas. Aucune de ces routes n'accepte de chemin de fichier.
    // ==================================================================
    /// Execute action() et traduit un refus de projet en 422.
    ///
    /// Comme pour l'antenne : le message et le conseil partent ensemble,
    /// separes d'une ligne, et la page les affiche l'un au-dessus de l'autre.
    fn pr_action<T>(resultat: Result<T, ErreurProjet>) -> Result<T, Refus> {
        resultat.map_err(|exc| refus(422, detail(&exc.message, &exc.conseil)))
    }

    /// Les calculs suivent le projet ouvert.
    ///
    /// Appele apres chaque ouverture, enregistrement ou fermeture : c'est
    /// le seul lien entre les deux modules, et il va dans un seul sens —
    /// projet.py ne sait pas qu'openEMS existe, openems_run ne sait pas ce
    /// qu'est un projet.
    fn pr_suivre() {
        antenne::dossier_calculs(&projet::dossier_calculs());
    }

    fn pr_etat() -> Rendu {
        let mut etat = projet::etat();
        if let Json::Objet(o) = &mut etat {
            o.insert("dispo".into(), true.into());
        }
        Ok(etat)
    }

    fn pr_ouvrir(r: &mut Requete) -> Rendu {
        let doc = Self::document(r, 4096)?;
        let Some(nom) = doc["nom"].as_str().filter(|n| !n.is_empty()) else {
            return Err(refus(400, "Nom de projet manquant"));
        };
        let charge = Self::pr_action(projet::ouvrir(nom))?;
        Self::pr_suivre();
        eprintln!("  Projet « {} » ouvert : {}", nom, charge["dossier"].as_str().unwrap_or(""));
        Ok(charge)
    }

    /// Les routes qui designent un chemin du disque restent a ce poste.
    ///
    /// Voir `_boucle_locale` : sans
    /// cela, un client du reseau deplacait la racine des projets n'importe
    /// ou sur le disque, ou y lisait un dossier quelconque. La tablette garde
    /// tout le reste : ouvrir, enregistrer, archiver dans la racine choisie.
    fn ce_poste(r: &Requete) -> Result<(), Refus> {
        if Self::boucle_locale(r) { Ok(()) } else { Err(refus(403, "Seul ce poste peut choisir un dossier du disque.")) }
    }

    /// Le projet ouvert, en lecture : un GET, qui ne change pas le projet courant.
    fn pr_lire() -> Rendu {
        let Some((nom, _)) = projet::ouvert() else { return Err(refus(409, "Aucun projet ouvert")) };
        Self::pr_action(projet::lire(&nom))
    }

    fn pr_racine(r: &mut Requete) -> Rendu {
        Self::ce_poste(r)?;
        let doc = Self::document(r, 4096)?;
        // shortcut: un chemin qui n'est pas un texte est refuse comme un chemin vide, Python s'arretait sur une erreur interne
        Self::pr_action(projet::definir_racine(doc["chemin"].as_str().unwrap_or("")))?;
        // La racine change : le projet ouvert etait dans l'ancienne, et son
        // nom ne designe plus le meme dossier. On le ferme plutot que de le
        // laisser pointer a cote — un enregistrement silencieux ailleurs est
        // exactement ce qu'on ne veut pas.
        projet::fermer();
        Self::pr_suivre();
        Self::pr_etat()
    }

    fn pr_enregistrer(r: &mut Requete) -> Rendu {
        let doc = Self::document(r, MAX_PROJET)?;
        let out = Self::pr_action(projet::enregistrer(&doc))?;
        Self::pr_suivre();
        eprintln!("  Projet « {} » enregistre : {}", out["nom"].as_str().unwrap_or(""), out["dossier"].as_str().unwrap_or(""));
        Ok(out)
    }

    fn pr_fermer() -> Rendu {
        projet::fermer();
        Self::pr_suivre();
        Self::pr_etat()
    }

    /// Ouvre dans l'explorateur la racine, ou le dossier d'un projet.
    fn pr_dossier(r: &Requete) -> Rendu {
        Self::ce_poste(r)?;
        Self::pr_action(projet::ouvrir_explorateur(r.param("nom").as_deref()))
    }

    /// Range le dossier d'un calcul deja fait DANS le projet ouvert.
    ///
    /// LE TROU QUE CETTE ROUTE BOUCHE. `_pr_suivre` ne vaut que pour les
    /// calculs A VENIR : elle dit ou les prochains ecriront. Un calcul lance
    /// avant qu'un projet ne soit ouvert a ecrit ses .vtr dans le dossier
    /// temporaire du systeme, et enregistrer le projet apres coup n'y
    /// changeait rien — on gardait les courbes et l'on perdait les champs,
    /// sans que rien ne l'annonce, le jour ou Windows vide son TEMP.
    ///
    /// LE PONT EST ICI, ET IL NE VA QUE DANS UN SENS, comme `_pr_suivre` :
    /// projet.py donne un dossier, openems_run deplace le sien et met sa
    /// tache a jour. Aucun chemin ne vient de la requete — seulement un
    /// identifiant de simulation, que openems_run resout lui-meme et
    /// seulement pour les taches qu'il a creees.
    fn pr_archiver(r: &mut Requete) -> Rendu {
        let ident = champ_texte(&Self::document(r, 4096)?, "id")?;
        if ident.is_empty() {
            return Err(refus(400, "Identifiant de simulation manquant"));
        }
        let base = projet::dossier_calculs();
        if base.is_empty() {
            return Err(refus(422, "Aucun projet n'est ouvert : donnez un nom au projet et enregistrez-le d'abord, c'est lui qui fournit le dossier."));
        }
        let out = antenne::archiver_calcul(&ident, &base).map_err(de_modele(422))?;
        if out["deplace"].vrai() {
            eprintln!("  Calcul {} range dans le projet : {}", ident, out["dossier"].as_str().unwrap_or(""));
        }
        Ok(out)
    }

    /// Les dossiers de calcul du projet ouvert.
    ///
    /// POURQUOI CETTE ROUTE. `resultats.json` ne retient qu'UN calcul, le
    /// dernier ; le projet en accumule un par simulation lancee. Sans cette
    /// liste, les precedents restaient sur le disque avec leurs champs, et
    /// la page n'avait aucun moyen de les designer.
    fn pr_calculs() -> Rendu {
        let calculs = projet::calculs().map_err(|exc| interne("ErreurProjet", &exc.message))?;
        Ok(obj! {"calculs" => Json::Liste(calculs), "dossier" => projet::dossier_calculs()})
    }

    /// Copie un dossier de calcul venu d'ailleurs dans le projet ouvert.
    ///
    /// UN CHEMIN VENU DE LA REQUETE, ET C'EST LE SEUL DE TOUTES CES ROUTES
    /// AVEC LA RACINE. La regle que l'outil s'etait fixee — « on ne lit que
    /// des dossiers qu'on a crees soi-meme » — vaut pour les identifiants de
    /// simulation, qui arrivent d'une page et designent un calcul en cours.
    /// Elle ne peut pas valoir ici : personne d'autre que l'utilisateur ne
    /// sait ou est la cle USB de son collegue. Ce qui la remplace tient en
    /// trois bornes, et elles sont dans projet.py :
    ///
    ///   - on ne fait que LIRE la source, jamais l'effacer ni la deplacer ;
    ///   - on n'en copie que les fichiers dont l'extension est celle d'un
    ///     dossier de calcul, un seul niveau de sous-dossier ;
    ///   - on n'ecrit QUE dans `<projet>/calculs/<identifiant neuf>`.
    ///
    /// L'identifiant vient d'openems_run : un dossier importe doit porter la
    /// meme forme que les autres, sinon il serait le seul que la visionneuse
    /// ne retrouverait pas apres un redemarrage du serveur.
    fn pr_importer(r: &mut Requete) -> Rendu {
        Self::ce_poste(r)?;
        let chemin = champ_texte(&Self::document(r, 4096)?, "chemin")?;
        if chemin.is_empty() {
            return Err(refus(400, "Aucun dossier indique."));
        }
        let ident = antenne::identifiant_neuf();
        let out = Self::pr_action(projet::importer_calcul(&chemin, &ident))?;
        eprintln!("  Calcul importe dans le projet : {} -> {}", out["source"].as_str().unwrap_or(""), out["dossier"].as_str().unwrap_or(""));
        Ok(out)
    }

    // ==================================================================
    // Enregistrer + GitHub : relai au lanceur WEB_SUITE
    // ------------------------------------------------------------------
    // Le lanceur exige son jeton de tout autre appareil que ce poste : sans
    // cela, n'importe qui sur le reseau pousserait sur GitHub avec les
    // identifiants du poste. Le relai exige donc le meme jeton, que la
    // tablette porte deja : le cookie pose par le lanceur vaut pour tout
    // l'hote, et le navigateur l'envoie aussi a ce port-ci.
    //
    // Toute la page exige deja le meme cookie des autres appareils (code
    // d'appairage, appairage.py) ; ce controle-ci reste pour le cas ou l'outil
    // est lance seul, sans garde actif, par un lanceur en mode reseau.
    // ==================================================================
    fn github_garde(&self, r: &Requete) -> Result<u16, Refus> {
        let Some(port) = adresse_lanceur(&self.lanceur) else {
            return Err(refus(404, "Envoi sur GitHub indisponible : cet outil n'a pas ete lance par WEB_SUITE."));
        };
        if Self::boucle_locale(r) {
            return Ok(port);
        }
        let recu = appairage::biscuit_recu(r, BISCUIT_LANCEUR).unwrap_or_default();
        if self.jeton_lanceur.is_empty() || recu.is_empty() || !appairage::egal(&recu, &self.jeton_lanceur) {
            return Err(refus(
                403,
                "Envoi sur GitHub refuse : ouvrez d'abord, sur cet appareil, l'adresse Reseau du lanceur WEB_SUITE (elle se termine par ?jeton=...).",
            ));
        }
        Ok(port)
    }

    fn github_relai(port: u16, chemin: &str, charge: &Json) -> Rendu {
        let (code, texte) = poster(port, chemin, &ascii(dumps(charge))).map_err(|exc| refus(502, format!("Lanceur WEB_SUITE injoignable : {}", exc)))?;
        let rep = match json_depuis_texte(&texte) {
            Ok(rep @ Json::Objet(_)) => rep,
            _ => return Err(refus(502, "Reponse illisible du lanceur WEB_SUITE")),
        };
        if code != 200 {
            let pourquoi = if rep["erreur"].vrai() { py_str(&rep["erreur"]) } else { code.to_string() };
            return Err(refus(502, format!("Le lanceur WEB_SUITE refuse : {}", pourquoi)));
        }
        let message = if rep["message"].vrai() { py_str(&rep["message"]) } else { String::new() };
        Ok(obj! {"ok" => rep["ok"].vrai(), "identite" => rep["identite"].vrai(), "message" => message})
    }

    fn github_etat(&self, r: &Requete) -> Rendu {
        self.github_garde(r)?;
        Ok(obj! {"disponible" => true})
    }

    fn github_envoyer(&self, r: &mut Requete) -> Rendu {
        let doc = Self::document(r, 4096)?;
        let port = self.github_garde(r)?;
        let message: String = if doc["message"].vrai() { py_str(&doc["message"]).chars().take(500).collect() } else { String::new() };
        Self::github_relai(port, "/api/envoyer", &obj! {"id" => ID_OUTIL, "message" => message})
    }

    fn github_identite(&self, r: &mut Requete) -> Rendu {
        let doc = Self::document(r, 4096)?;
        let port = self.github_garde(r)?;
        if !matches!(doc, Json::Objet(_)) {
            return Err(refus(400, "Corps JSON attendu"));
        }
        let texte = |cle: &str| if doc[cle].vrai() { py_str(&doc[cle]) } else { String::new() };
        Self::github_relai(port, "/api/identite", &obj! {"nom" => texte("nom"), "email" => texte("email")})
    }

    // ==================================================================
    // Aiguillage
    // ==================================================================
    fn get(&self, r: &mut Requete) -> Reponse {
        if let Some(rendu) = self.pilote.traiter(r) {
            return rendu;
        }
        let route = route(r);
        match route.as_str() {
            "/api/ipc2581" => Self::api(r, |_| Self::ipc_etat()),
            "/api/openems" => Self::api(r, |_| Ok(antenne::etat())),
            "/api/openems/journal" => Self::api(r, |r| Self::oe_journal(r)),
            // Les deux routes de la visionneuse de champs sont en GET : elles ne
            // changent rien, elles LISENT le dossier d'un calcul deja fait.
            "/api/openems/champs" => Self::api(r, |r| Self::oe_champs(r)),
            "/api/openems/champ" => Self::api(r, |r| Self::oe_champ(r)),
            "/api/projet" => Self::api(r, |_| Self::pr_etat()),
            "/api/projet/calculs" => Self::api(r, |_| Self::pr_calculs()),
            "/api/projet/lire" => Self::api(r, |_| Self::pr_lire()),
            "/api/github" => Self::api(r, |r| self.github_etat(r)),
            _ if route.starts_with("/api/") => rendre_detail(404, &format!("Route inconnue : {}", route)),
            _ => self.statique(r),
        }
    }

    fn head(&self, r: &mut Requete) -> Reponse {
        if route(r).starts_with("/api/") { self.get(r) } else { self.statique(r) }
    }

    fn post(&self, r: &mut Requete) -> Reponse {
        if let Some(refus) = Self::csrf(r) {
            return refus;
        }
        if let Some(rendu) = self.pilote.traiter(r) {
            return rendu;
        }
        let route = route(r);
        match route.as_str() {
            "/api/ipc2581" => Self::api(r, Self::ipc_lire),
            "/api/openems" => Self::api(r, |r| Self::oe_modele(r, antenne::preparer)),
            "/api/openems/script" => Self::api(r, |r| Self::oe_modele(r, antenne::script)),
            "/api/openems/lancer" => Self::api(r, |r| Self::oe_modele(r, antenne::lancer)),
            // Le balayage prend le MEME document, augmente d'une liste de points.
            // « balayage » le chiffre sans rien lancer, « balayage/lancer » le
            // lance : la meme separation qu'entre « preparer » et « lancer », et
            // pour la meme raison — on ne s'engage pas dans une heure de calcul
            // sans avoir vu ce qu'elle va couter.
            "/api/openems/balayage" => Self::api(r, |r| Self::oe_modele(r, antenne::balayage)),
            "/api/openems/balayage/lancer" => Self::api(r, |r| Self::oe_modele(r, antenne::lancer_balayage)),
            "/api/openems/tableau-s" => Self::api(r, |r| Self::oe_modele(r, antenne::tableau_s)),
            "/api/openems/tableau-s/lancer" => Self::api(r, |r| Self::oe_modele(r, antenne::lancer_tableau_s)),
            "/api/openems/arreter" => Self::api(r, |r| Self::oe_arreter(r)),
            "/api/openems/fils" => Self::api(r, |r| Self::oe_fils(r)),
            "/api/openems/banc/lancer" => Self::api(r, |_| antenne::lancer_banc(false).map_err(de_modele(409))),
            "/api/openems/dossier" => Self::api(r, |r| Self::oe_voir(r)),
            // En POST : ouvrir change le projet courant du serveur
            "/api/projet/ouvrir" => Self::api(r, Self::pr_ouvrir),
            "/api/projet/racine" => Self::api(r, Self::pr_racine),
            "/api/projet/enregistrer" => Self::api(r, Self::pr_enregistrer),
            "/api/projet/fermer" => Self::api(r, |_| Self::pr_fermer()),
            "/api/projet/dossier" => Self::api(r, |r| Self::pr_dossier(r)),
            "/api/projet/archiver" => Self::api(r, Self::pr_archiver),
            "/api/projet/importer" => Self::api(r, Self::pr_importer),
            "/api/github/envoyer" => Self::api(r, |r| self.github_envoyer(r)),
            "/api/github/identite" => Self::api(r, |r| self.github_identite(r)),
            _ => rendre_detail(404, &format!("Route inconnue : {}", route)),
        }
    }
}

/// La route : le chemin sans sa barre finale.
fn route(r: &Requete) -> String {
    let chemin = r.chemin().trim_end_matches('/');
    if chemin.is_empty() { "/".into() } else { chemin.to_string() }
}

/// Un POST JSON au lanceur, sur la boucle locale ; rend le code et le corps de sa reponse.
fn poster(port: u16, chemin: &str, corps: &str) -> std::io::Result<(u16, String)> {
    let delai = Duration::from_secs(DELAI_LANCEUR);
    let mut s = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, port)), delai)?;
    s.set_read_timeout(Some(delai))?;
    s.set_write_timeout(Some(delai))?;
    write!(
        s,
        "POST {} HTTP/1.0\r\nHost: 127.0.0.1:{}\r\nContent-Type: application/json\r\nX-WebSuite: 1\r\nContent-Length: {}\r\n\r\n{}",
        chemin,
        port,
        corps.len(),
        corps
    )?;
    let mut tout = Vec::new();
    s.read_to_end(&mut tout)?;
    let reponse = String::from_utf8_lossy(&tout);
    let invalide = || std::io::Error::new(std::io::ErrorKind::InvalidData, "reponse HTTP incomplete");
    let (tete, suite) = reponse.split_once("\r\n\r\n").ok_or_else(invalide)?;
    let code = tete.split(' ').nth(1).and_then(|c| c.parse().ok()).ok_or_else(invalide)?;
    Ok((code, suite.to_string()))
}

#[cfg(test)]
mod essais {
    use super::*;

    #[test]
    fn statique_et_types() {
        for permis in ["/", "/index.html", "/css/theme.css", "/js/01-api.js", "/js/vendor/occt/occt-import-js.wasm", "/js/vendor"] {
            assert!(STATIQUE.is_match(permis), "{}", permis);
        }
        for refuse in [
            "/.git/config", "/.git/", "/js/", "/js/../web_antenna.py", "/web_antenna.py", "/README.md", "/Cargo.toml", "/src/main.rs",
            "/api_key_free_ia_studio.txt", "/C:\\Windows\\win.ini", "/js/..\\..\\web_antenna.py", "/env/pyvenv.cfg", "/openEMS/openEMS", "/css/.cache",
        ] {
            assert!(!STATIQUE.is_match(refuse), "{}", refuse);
        }
        assert_eq!(decoder_chemin("/a+b%20c/%2e%2e/%C3%A9%zz"), "/a+b c/../é%zz");
        assert_eq!(type_mime(Path::new("x.WASM")), "application/wasm");
        assert_eq!(type_mime(Path::new("js/01-api.js")), "application/javascript; charset=utf-8");
        assert_eq!(type_mime(Path::new("x.bin")), "application/octet-stream");
    }

    #[test]
    fn json_comme_python() {
        let v = json_depuis_texte(r#"{"détail": "été\u007f €😀", "n": [1, 2.5, null]}"#).unwrap();
        assert_eq!(ascii(dumps(&v)), r#"{"d\u00e9tail": "\u00e9t\u00e9\u007f \u20ac\ud83d\ude00", "n": [1, 2.5, null]}"#);
        assert_eq!(repr("x'y"), r#""x'y""#);
        assert_eq!(repr("abc"), "'abc'");
        assert_eq!((entier(" 12 "), entier("+3"), entier("-4"), entier("1.5"), entier("")), (Some(12), Some(3), Some(-4), None, None));
        assert_eq!(detail("a", ""), "a");
        assert_eq!(detail("a", "b"), "a\nb");
    }

    #[test]
    fn le_lanceur_est_sur_ce_poste() {
        assert_eq!(adresse_lanceur("http://127.0.0.1:8100"), Some(8100));
        assert_eq!(adresse_lanceur("HTTP://LocalHost:8100/chemin?x=1"), Some(8100));
        for refuse in ["", "http://127.0.0.1", "https://127.0.0.1:8100", "http://192.168.1.50:8100", "http://127.0.0.1:0", "http://127.0.0.1:x", "127.0.0.1:8100", "http://evil.example@192.168.1.5:80"] {
            assert_eq!(adresse_lanceur(refuse), None, "{}", refuse);
        }
    }

    /// Une panne interne : 500 court, sans le texte de l'exception (chemins du disque).
    #[test]
    fn panne_interne() {
        let (code, charge) = proteger(|| panic!("/chemin/secret/introuvable.json"));
        assert_eq!(code, 500);
        assert_eq!(dumps(&charge), r#"{"detail": "Erreur interne (panique) : le detail est dans le terminal du serveur."}"#);
        let (code, charge) = proteger(|| Err(refus(422, "non")));
        assert_eq!((code, dumps(&charge)), (422, r#"{"detail": "non"}"#.to_string()));
        assert_eq!(proteger(|| Ok(obj! {"a" => 1i64})).0, 200);
        let exc = champ_texte(&json_depuis_texte("[1]").unwrap(), "id").unwrap_err();
        assert_eq!((exc.code, exc.message.as_str()), (500, "Erreur interne (AttributeError) : le detail est dans le terminal du serveur."));
        assert_eq!(champ_texte(&json_depuis_texte(r#"{"id": "abc"}"#).unwrap(), "id").unwrap(), "abc");
        assert_eq!(champ_texte(&Json::Nul, "id").unwrap(), "");
    }
}
