// ==========================================================================
// Le portage de python/projet.py (1.0.0, 2026-09-15).
// Explication : les projets sur le disque — ou on les range, ce qu'on y
//               ecrit, et comment on en reprend un.
//
//   UN PROJET EST UN DOSSIER, PAS UN FICHIER. C'est le seul choix qui laisse
//   cohabiter les trois choses que produit une seance : ce qu'on a dessine
//   (quelques kilo-octets), la carte qu'on a ouverte (quelques dizaines de
//   mega-octets sur une carte de fabrication) et ce que le solveur a rendu
//   (des courbes, et parfois des giga-octets de champs .vtr que la visionneuse
//   relit). Un fichier unique obligerait a tout charger pour lire une cote,
//   et a tout reecrire pour changer une frequence.
//
//       <racine>/<nom du projet>/
//           projet.json      le dessin, les reglages, l'affichage
//           carte.json       le document de la carte, tel que le parseur l'a rendu
//           resultats.json   le dernier resultat : S11, impedance, rayonnement
//           calculs/         un dossier par simulation lancee (voir openems_run)
//
//   Chaque morceau est absent quand il n'a pas lieu d'etre : un projet ou
//   l'on n'a fait que dessiner n'a pas de resultats.json, et le relire ne
//   doit pas s'en plaindre.
//
//   POURQUOI LE SERVEUR ET NON LE NAVIGATEUR. Une page web n'ecrit pas sur
//   le disque — et l'API qui le permet (showDirectoryPicker) n'existe que
//   sur Chrome et Edge, redemande l'autorisation a chaque session, et ne
//   sait rien faire des dossiers de calcul qu'openEMS remplit lui-meme.
//   Le serveur, lui, est deja la, tourne sur le poste, et c'est deja lui qui
//   ecrit les .vtr.
//
//   CE QUE CE MODULE NE FAIT PAS : il n'efface pas de PROJET. Aucune route de
//   suppression, aucun ecrasement d'un dossier qui n'est pas un projet. Un
//   outil qui ecrit dans un dossier choisi a la main par l'utilisateur ne
//   doit pas avoir de moyen d'en detruire le contenu par une requete.
//
//   LA SEULE EXCEPTION, ET ELLE EST BORNEE : `enregistrer` retire `carte.json`
//   ou `resultats.json` quand la charge les porte a `null` — c'est ainsi qu'un
//   projet repart d'un dessin apres avoir ete ouvert sur un fichier, et il faut
//   bien que la carte d'hier s'en aille. Absent et nul ne se confondent donc
//   pas : ABSENT veut dire « inchange, n'y touche pas », NUL veut dire « il n'y
//   en a plus ». Cela ne porte que sur ces deux fichiers-la, nommes en dur, et
//   dans un dossier dont le nom a passe `_verifier_nom` et la comparaison a la
//   racine. Dans un projet existant qui n'est pas l'ouvert, il faut en plus
//   `"ecraser": true` (l'accord demande par la page). Rien d'autre n'est
//   jamais retire.
//
// Fonctions : etat, definir_racine, liste, ouvrir, enregistrer, ouvert,
//            fermer, dossier_calculs, calculs, importer_calcul,
//            ouvrir_explorateur,
//            debit_lu, debit_noter, debit_fils_lu, fils_lu, fils_noter,
//            banc_lu, banc_noter
// ==========================================================================
//! Les projets sur le disque : ou on les range, et comment on les reprend.

use std::path::{Component, Path, PathBuf};
use std::sync::{LazyLock, Mutex, MutexGuard};

use antenne_modele::outils::py_str;
use antenne_modele::{json_depuis_texte, obj, Json, Objet};
use ipc2581::py::dumps;
use regex::Regex;

pub const FORMAT: &str = "antenne-openems/projet";
pub const VERSION: i64 = 1;

// Le nom des trois fichiers. Ils sont nommes, et pas devines : on ne relit
// que ceux-la, et on n'ecrit que ceux-la.
pub const F_PROJET: &str = "projet.json";
pub const F_CARTE: &str = "carte.json";
pub const F_RESULTATS: &str = "resultats.json";
pub const D_CALCULS: &str = "calculs";
// La fiche qu'un dossier de calcul IMPORTE porte, et que les autres n'ont
// pas : d'ou il vient, et quand il est arrive. Sans elle, un dossier importe
// serait indiscernable d'un calcul mene ici, et la liste ne pourrait pas dire
// « celui-la vient de la cle USB ».
pub const F_IMPORT: &str = "import.json";

// CE QU'ON ACCEPTE DE COPIER, ET POURQUOI C'EST UNE LISTE BLANCHE. Importer
// un dossier de calcul veut dire copier des champs et de quoi les relire ; ce
// n'est pas une commande « copie ce dossier chez moi ». Le chemin vient de
// l'utilisateur — comme la racine des projets, et c'est legitime —, mais ce
// qu'on en tire est borne a ce qu'un dossier openEMS contient.
pub const EXT_CALCUL: [&str; 14] =
    [".vtr", ".vtk", ".vts", ".vti", ".vtu", ".h5", ".xml", ".py", ".log", ".txt", ".json", ".csv", ".dat", ".m"];
// Deux garde-fous chiffres, annonces quand ils se declenchent. Un
// enregistrement temporel fait des dizaines de milliers de fichiers : les
// bornes sont larges, elles n'arretent qu'un dossier qui n'a rien a faire la.
pub const MAX_IMPORT_OCTETS: u64 = 20 * 1024 * 1024 * 1024;
pub const MAX_IMPORT_FICHIERS: usize = 200000;

// Combien de projets la liste rend au plus. Une racine qui en contient mille
// n'est pas un cas a servir : elle est un cas a signaler.
pub const MAX_LISTE: usize = 300;

/// Refus explicite : un message, et le geste qui le leve.
#[derive(Debug)]
pub struct ErreurProjet {
    pub message: String,
    pub conseil: String,
}

type Res<T> = Result<T, ErreurProjet>;

fn refus(message: impl Into<String>, conseil: &str) -> ErreurProjet {
    ErreurProjet { message: message.into(), conseil: conseil.to_string() }
}

// ==========================================================================
// Ce que Python faisait tout seul : les chemins d'os.path, et json.dump
// ==========================================================================
fn joindre(a: &str, b: &str) -> String {
    Path::new(a).join(b).to_string_lossy().into_owned()
}

fn maison() -> String {
    web_tools_commun::appairage::dossier_personnel().to_string_lossy().into_owned()
}

/// os.path.abspath : absolu, « . » et « .. » resolus sur le texte.
fn abspath(chemin: &str) -> String {
    let p = std::path::absolute(chemin).unwrap_or_else(|_| PathBuf::from(chemin));
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            c => out.push(c),
        }
    }
    out.to_string_lossy().into_owned()
}

/// Sous Windows, canonicalize rend « \\?\C:\... » : la page afficherait ce prefixe.
fn sans_prefixe(p: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let t = p.to_string_lossy();
        if let Some(unc) = t.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{}", unc));
        }
        if let Some(reste) = t.strip_prefix(r"\\?\") {
            return PathBuf::from(reste.to_string());
        }
    }
    p
}

/// os.path.realpath : les liens suivis ; ce qui n'existe pas encore reste tel quel au bout.
fn realpath(chemin: &str) -> PathBuf {
    let p = PathBuf::from(abspath(chemin));
    let mut reste = Vec::new();
    let mut tete = p.as_path();
    loop {
        if let Ok(reel) = tete.canonicalize() {
            return reste.iter().rev().fold(sans_prefixe(reel), |c, m| c.join(m));
        }
        match (tete.parent(), tete.file_name()) {
            (Some(parent), Some(nom)) => {
                reste.push(nom.to_os_string());
                tete = parent;
            }
            _ => return p,
        }
    }
}

/// os.path.expanduser(os.path.expandvars(brut)) : « $NOM » et « ${NOM} » (« %NOM% » sous
/// Windows) connus de l'environnement, puis « ~ » en tete.
fn developper(brut: &str) -> String {
    static VARS: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(if cfg!(windows) { r"\$([A-Za-z0-9_]+)|\$\{([^}]*)\}|%([^%]+)%" } else { r"\$([A-Za-z0-9_]+)|\$\{([^}]*)\}" }).unwrap()
    });
    let t = VARS.replace_all(brut, |c: &regex::Captures| {
        let nom = c.iter().skip(1).flatten().next().map_or("", |m| m.as_str());
        std::env::var(nom).unwrap_or_else(|_| c[0].to_string())
    });
    match t.strip_prefix('~') {
        Some("") => maison(),
        Some(reste) if reste.starts_with(['/', '\\']) => joindre(&maison(), reste.trim_start_matches(['/', '\\'])),
        _ => t.into_owned(),
    }
}

/// os.path.basename.
fn basename(chemin: &str) -> &str {
    chemin.rsplit(if cfg!(windows) { &['/', '\\'][..] } else { &['/'][..] }).next().unwrap_or("")
}

/// os.path.splitext(chemin)[1] : l'extension commence au dernier point du nom, sauf en tete.
fn extension(chemin: &str) -> &str {
    let nom = basename(chemin);
    match nom.rfind('.') {
        Some(i) if !nom[..i].chars().all(|c| c == '.') => &nom[i..],
        _ => "",
    }
}

/// str(OSError) : « [Errno 13] Permission denied: 'chemin' ».
fn erreur_os(e: &std::io::Error, chemin: &str) -> String {
    let texte = e.to_string();
    format!("[Errno {}] {}: '{}'", e.raw_os_error().unwrap_or(0), texte.split(" (os error").next().unwrap_or(""), chemin)
}

/// json.dumps(v, ensure_ascii=False, separators=(",", ":")) : l'ecriture de `dumps`, sans
/// l'espace qui suit « , » et « : » hors des textes.
fn compact(v: &Json) -> String {
    let texte = dumps(v);
    let mut out = String::with_capacity(texte.len());
    let (mut dans, mut echappe, mut avant) = (false, false, ' ');
    for c in texte.chars() {
        if dans {
            out.push(c);
            if echappe {
                echappe = false;
            } else if c == '\\' {
                echappe = true;
            } else if c == '"' {
                dans = false;
            }
        } else if !(c == ' ' && (avant == ',' || avant == ':')) {
            out.push(c);
            dans = c == '"';
        }
        avant = c;
    }
    out
}

fn maintenant() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

fn verrou<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ==========================================================================
// La racine : ou sont ranges les projets
// ==========================================================================
// ELLE SE CHOISIT, ET ELLE SE RETIENT. Le reglage vit dans le profil de
// l'utilisateur du systeme, et non dans le depot : deux personnes sur le
// meme poste n'ont pas les memes projets, et un depot qu'on met a jour par
// git ne doit pas trainer le chemin de travail de celui qui l'a clone.
struct Poste {
    config: Option<String>,
    racine: Option<String>,
    /// (nom, dossier) du projet ouvert
    ouvert: Option<(String, String)>,
}

static POSTE: Mutex<Poste> = Mutex::new(Poste { config: None, racine: None, ouvert: None });
// Toutes les ecritures du reglage passent par ce verrou : deux requetes qui
// lisent-modifient-ecrivent en meme temps perdraient l'une des deux cles.
static CONFIG_VERROU: Mutex<()> = Mutex::new(());

/// Le fichier de reglages : ~/.antenne-openems.json.
fn config() -> String {
    verrou(&POSTE).config.clone().unwrap_or_else(|| joindre(&maison(), ".antenne-openems.json"))
}

/// « Documents/Antennes openEMS », ou le profil a defaut de Documents.
pub fn racine_defaut() -> String {
    let maison = maison();
    for nom in ["Documents", "Mes documents"] {
        let chemin = joindre(&maison, nom);
        if Path::new(&chemin).is_dir() {
            return joindre(&chemin, "Antennes openEMS");
        }
    }
    joindre(&maison, "Antennes openEMS")
}

fn _config_lire() -> Objet {
    let lu = std::fs::read_to_string(config()).ok().and_then(|t| json_depuis_texte(&t).ok());
    match lu {
        Some(Json::Objet(d)) => d,
        _ => Objet::new(),
    }
}

fn _config_ecrire(cle: &str, valeur: Json) {
    let _v = verrou(&CONFIG_VERROU);
    let mut d = _config_lire();
    d.insert(cle.to_string(), valeur);
    // Un profil en lecture seule ne doit pas faire echouer
    // l'enregistrement du projet lui-meme : la racine vaudra pour la
    // session, et c'est tout ce qu'on perd.
    let _ = _ecrire_json(&config(), &Json::Objet(d)); // .tmp puis remplacement
}

/// Le dossier ou sont les projets. Retenu d'une session a l'autre.
pub fn racine() -> String {
    if let Some(r) = verrou(&POSTE).racine.clone() {
        return r;
    }
    let r = match _config_lire().get("racine").filter(|c| c.vrai()) {
        Some(chemin) => abspath(&py_str(chemin)),
        None => racine_defaut(),
    };
    verrou(&POSTE).racine = Some(r.clone());
    r
}

/// La racine de ce lancement seulement (--projets) : rien n'est ecrit dans le profil.
pub fn poser_racine(chemin: Option<String>) {
    verrou(&POSTE).racine = chemin;
}

/// Change le dossier de travail, et le cree s'il n'existe pas.
///
/// LE CHEMIN VIENT DE L'UTILISATEUR, ET C'EST LE POINT DE TOUTE CETTE
/// FONCTION : c'est lui qui decide ou vivent ses projets, et un outil local
/// qui l'en empecherait ne servirait a rien. Ce qui est borne, en revanche,
/// c'est ce qu'on en fait — voir `_dossier` plus bas : sous cette racine, on
/// ne lit et n'ecrit que trois fichiers nommes, dans un sous-dossier dont le
/// nom est verifie caractere par caractere.
pub fn definir_racine(chemin: &str) -> Res<String> {
    let brut = ipc2581::py::strip(chemin).trim_matches('"');
    if brut.is_empty() {
        return Err(refus("Aucun dossier indique.", ""));
    }
    let voulu = abspath(&developper(brut));
    if Path::new(&voulu).is_file() {
        return Err(refus(
            format!("« {} » est un fichier, pas un dossier.", voulu),
            "Indiquez le dossier qui contiendra les projets — chaque projet y aura son propre sous-dossier.",
        ));
    }
    if let Err(exc) = std::fs::create_dir_all(&voulu) {
        return Err(refus(
            format!("Ce dossier n'a pas pu etre cree : {}", erreur_os(&exc, &voulu)),
            "Verifiez le chemin et les droits d'ecriture. Sur un lecteur reseau, verifiez aussi qu'il est connecte.",
        ));
    }
    if !inscriptible(&voulu) {
        return Err(refus(format!("Ce dossier n'est pas accessible en ecriture : {}", voulu), ""));
    }
    verrou(&POSTE).racine = Some(voulu.clone());
    _config_ecrire("racine", voulu.clone().into());
    Ok(voulu)
}

/// os.access(dossier, os.W_OK). Sous Windows, Python le rend vrai pour tout dossier.
fn inscriptible(dossier: &str) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let Ok(c) = std::ffi::CString::new(Path::new(dossier).as_os_str().as_bytes()) else { return false };
        unsafe { libc::access(c.as_ptr(), libc::W_OK) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = dossier;
        true
    }
}

// ==========================================================================
// Le nom d'un projet
// ==========================================================================
// UN NOM DE PROJET EST UN NOM DE DOSSIER, et c'est la toute la difficulte :
// il arrive d'une requete HTTP et il devient un chemin. Les refus qui
// comptent sont donc ici, et ils sont bornes par une liste de ce qui est
// PERMIS plutot que par une liste de ce qui est interdit — une liste noire
// oublie toujours quelque chose.
static NOM_OK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"^[^\x00-\x1f<>:"/\\|?*]{1,80}$"#).unwrap());

// Les noms que Windows reserve a ses peripheriques. « CON » n'est pas un
// dossier : c'est la console, et un fichier ouvert sous ce nom ecrit dans le
// vide sans lever la moindre erreur.
fn reserve(nom: &str) -> bool {
    let n = nom.to_uppercase();
    ["CON", "PRN", "AUX", "NUL", "CLOCK$"].contains(&n.as_str())
        || (n.len() == 4 && (n.starts_with("COM") || n.starts_with("LPT")) && matches!(n.as_bytes()[3], b'1'..=b'9'))
}

pub fn _verifier_nom(nom: &str) -> Res<String> {
    let n = ipc2581::py::strip(nom);
    if n.is_empty() {
        return Err(refus("Le projet n'a pas de nom.", ""));
    }
    if !NOM_OK.is_match(n) {
        return Err(refus(
            format!("« {} » ne peut pas etre un nom de dossier.", n),
            "Les caracteres  \\ / : * ? \" < > |  y sont interdits, et le nom ne doit pas depasser 80 caracteres.",
        ));
    }
    // Un point en tete fait un dossier cache (et la regle commune les refuse).
    if n.starts_with('.') || n.ends_with('.') {
        return Err(refus("Un nom de projet ne peut ni commencer ni finir par un point.", ""));
    }
    if reserve(n.split('.').next().unwrap_or("")) {
        return Err(refus(
            format!("« {} » est un nom reserve par Windows.", n),
            "CON, PRN, AUX, NUL, COM1 a COM9 et LPT1 a LPT9 designent des peripheriques : aucun dossier ne peut porter ces noms.",
        ));
    }
    Ok(n.to_string())
}

/// Le dossier d'un projet, verifie deux fois plutot qu'une.
///
/// Le nom est valide caractere par caractere ci-dessus, ET le chemin
/// resolu est compare a la racine : un nom qui passerait quand meme la
/// premiere barriere — un lien symbolique depose dans la racine, par
/// exemple — ne sortirait pas de la seconde.
fn _dossier(nom: &str, creer: bool) -> Res<String> {
    let n = _verifier_nom(nom)?;
    let base = racine();
    let chemin = joindre(&base, &n);
    if creer {
        std::fs::create_dir_all(&chemin).map_err(|exc| refus(format!("Ce projet n'a pas pu etre cree : {}", erreur_os(&exc, &chemin)), ""))?;
    }
    // (deux lecteurs differents ne commencent pas l'un par l'autre)
    if !realpath(&chemin).starts_with(realpath(&base)) {
        return Err(refus(format!("Ce nom sort du dossier de travail : {}", n), ""));
    }
    Ok(chemin)
}

// ==========================================================================
// Lire
// ==========================================================================
/// Le contenu d'un fichier JSON, ou None s'il n'est pas la.
///
/// UN FICHIER ILLISIBLE N'EST PAS UN FICHIER ABSENT : on leve, en disant
/// lequel. Rendre None ferait rouvrir un projet ampute sans que personne ne
/// s'en apercoive — et c'est le dessin de la veille qui manquerait.
fn _lire_json(chemin: &str) -> Res<Option<Json>> {
    if !Path::new(chemin).is_file() {
        return Ok(None);
    }
    let octets = std::fs::read(chemin).map_err(|exc| refus(format!("« {} » n'a pas pu etre lu : {}", basename(chemin), erreur_os(&exc, chemin)), ""))?;
    let lu = String::from_utf8(octets).map_err(|e| e.to_string()).and_then(|t| json_depuis_texte(&t));
    lu.map(Some).map_err(|exc| {
        refus(
            format!("« {} » est illisible : {}", basename(chemin), exc),
            "Le fichier a ete modifie a la main, ou une ecriture a ete interrompue. Le reste du projet, lui, est intact.",
        )
    })
}

fn _poids(chemin: &str) -> u64 {
    std::fs::metadata(chemin).map(|m| m.len()).unwrap_or(0)
}

/// os.path.getmtime : un flottant, ou l'entier 0 quand le fichier n'est pas la.
fn _mtime(chemin: &str) -> Json {
    let date = std::fs::metadata(chemin).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok());
    match date {
        Some(d) => Json::Flottant(d.as_secs() as f64 + 1e-9 * d.subsec_nanos() as f64),
        None => Json::Entier(0),
    }
}

/// `v or defaut` de Python.
fn ou(v: &Json, defaut: Json) -> Json {
    if v.vrai() { v.clone() } else { defaut }
}

/// Ce qu'on affiche d'un projet SANS l'ouvrir : le strict necessaire.
///
/// La liste ne lit que `projet.json`, jamais `carte.json` : une racine de
/// trente projets contenant chacun une carte de fabrication ferait des
/// centaines de mega-octets a relire pour afficher trente lignes.
fn _resume(dossier: &str, nom: &str) -> Json {
    let chemin = joindre(dossier, F_PROJET);
    let tete = std::fs::read_to_string(&chemin).ok().and_then(|t| json_depuis_texte(&t).ok());
    let Some(tete @ Json::Objet(_)) = tete else {
        // Un projet dont l'en-tete ne se lit pas apparait quand meme dans la
        // liste, et il le dit : le faire disparaitre laisserait croire qu'il
        // n'existe plus.
        return obj! {"nom" => nom, "modifie" => _mtime(&chemin), "abime" => true, "titre" => "(en-tete illisible)"};
    };
    let (carte, resultats) = (joindre(dossier, F_CARTE), joindre(dossier, F_RESULTATS));
    obj! {
        "nom" => nom,
        "modifie" => if tete["modifie"].vrai() { tete["modifie"].clone() } else { _mtime(&chemin) },
        "cree" => ou(&tete["cree"], Json::Entier(0)),
        "titre" => ou(&tete["titre"], "".into()),
        "carte" => Path::new(&carte).is_file(),
        "resultats" => Path::new(&resultats).is_file(),
        "dessin" => tete["dessin"]["elements"].vrai(),
        "poids" => (_poids(&chemin) + _poids(&carte) + _poids(&resultats)) as i64,
    }
}

/// sorted(os.listdir(dossier)), ou None si le dossier ne se lit pas.
fn lister(dossier: &str) -> Option<Vec<String>> {
    let mut noms: Vec<String> = std::fs::read_dir(dossier).ok()?.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    noms.sort();
    Some(noms)
}

/// list.sort(key=lambda p: p.get("modifie") or 0, reverse=True)
fn trier_par_date(liste: &mut [Json]) {
    let date = |p: &Json| p["modifie"].as_f64().unwrap_or(0.0);
    liste.sort_by(|a, b| date(b).partial_cmp(&date(a)).unwrap_or(std::cmp::Ordering::Equal));
}

/// Les projets de la racine, du plus recemment modifie au plus ancien.
pub fn liste() -> Vec<Json> {
    let base = racine();
    let mut out = Vec::new();
    // La racine n'existe pas encore : ce n'est pas une erreur, c'est un
    // dossier vide. On ne la cree pas ici — la creer sur une simple
    // lecture semerait des dossiers a chaque demarrage.
    let Some(noms) = lister(&base) else { return out };
    for nom in noms {
        let dossier = joindre(&base, &nom);
        if nom.starts_with('.') || !Path::new(&dossier).is_dir() {
            continue; // un dossier cache ne s'ouvrirait pas
        }
        if !Path::new(&joindre(&dossier, F_PROJET)).is_file() {
            continue;
        }
        out.push(_resume(&dossier, &nom));
        if out.len() >= MAX_LISTE {
            break;
        }
    }
    trier_par_date(&mut out);
    out
}

/// Tout ce qu'un projet contient, pret a repeupler la page ; il devient le projet ouvert.
pub fn ouvrir(nom: &str) -> Res<Json> {
    let charge = lire(nom)?;
    _ouvrir_memoire(nom, charge["dossier"].as_str().unwrap_or(""));
    Ok(charge)
}

/// Le contenu d'un projet, sans rien changer a l'etat du serveur.
pub fn lire(nom: &str) -> Res<Json> {
    let dossier = _dossier(nom, false)?;
    let Some(tete) = _lire_json(&joindre(&dossier, F_PROJET))? else {
        return Err(refus(
            format!("Il n'y a pas de projet nomme « {} » dans {}.", nom, racine()),
            "Le dossier a ete deplace ou renomme depuis, ou le dossier de travail n'est pas celui ou ce projet a ete enregistre.",
        ));
    };
    let Json::Objet(mut charge) = tete else { return Err(pas_un_projet(nom)) };
    if charge.get("format").and_then(Json::as_str) != Some(FORMAT) {
        return Err(pas_un_projet(nom));
    }
    charge.insert("nom".into(), nom.into());
    charge.insert("dossier".into(), dossier.clone().into());
    for (cle, fichier) in [("carte", F_CARTE), ("resultats", F_RESULTATS)] {
        let lu = _lire_json(&joindre(&dossier, fichier))?;
        // un objet ou rien : une chaine faisait tomber la page a la reprise
        if lu.as_ref().is_some_and(|v| !matches!(v, Json::Nul | Json::Objet(_))) {
            return Err(refus(format!("« {} » n'est pas un objet JSON.", fichier), "Le fichier a ete modifie a la main ou est corrompu."));
        }
        charge.insert(cle.into(), lu.unwrap_or(Json::Nul));
    }
    Ok(Json::Objet(charge))
}

fn pas_un_projet(nom: &str) -> ErreurProjet {
    refus(
        format!("« {} » n'est pas un projet de cet outil.", nom),
        &format!("Son fichier projet.json ne porte pas la marque « {} ».", FORMAT),
    )
}

// ==========================================================================
// Ecrire
// ==========================================================================
/// Ecrit a cote, puis remplace. Une ecriture interrompue ne doit pas
/// laisser un projet a moitie ecrit : tant que le remplacement n'a pas eu
/// lieu, c'est l'ancien fichier qui est la, entier.
fn _ecrire_json(chemin: &str, valeur: &Json) -> Res<()> {
    let provisoire = format!("{}.tmp", chemin);
    std::fs::write(&provisoire, compact(valeur)).and_then(|_| std::fs::rename(&provisoire, chemin)).map_err(|exc| {
        let _ = std::fs::remove_file(&provisoire);
        refus(
            format!("« {} » n'a pas pu etre ecrit : {}", basename(chemin), erreur_os(&exc, &provisoire)),
            "Verifiez qu'il reste de la place sur le disque et que le dossier n'est pas en lecture seule.",
        )
    })
}

/// str(v or "")[:n]
fn texte(v: &Json, n: usize) -> String {
    if v.vrai() { py_str(v).chars().take(n).collect() } else { String::new() }
}

/// Ecrit un projet. Le nom est dans la charge ; le reste est facultatif.
///
/// LES TROIS FICHIERS S'ECRIVENT SEPAREMENT, ET C'EST CE QUI PERMET DE NE
/// PAS TOUT REECRIRE : une carte de fabrication ne bouge plus une fois
/// ouverte, et la renvoyer a chaque fois qu'on change une frequence ferait
/// passer des dizaines de mega-octets sur la boucle locale pour rien. La
/// page envoie donc `carte` ABSENTE quand la carte n'a pas change, et le
/// fichier deja ecrit reste en place.
///
/// Une carte a `null`, en revanche, veut dire « il n'y en a plus » : c'est
/// le cas d'un projet qu'on repart de zero. Absent et nul ne se confondent
/// pas.
pub fn enregistrer(charge: &Json) -> Res<Json> {
    let Json::Objet(c) = charge else { return Err(refus("Document de projet illisible.", "")) };
    // shortcut: un nom qui n'est pas un texte est refuse comme un nom vide, Python s'arretait sur une erreur interne
    let nom = _verifier_nom(charge["nom"].as_str().unwrap_or(""))?;
    for cle in ["carte", "resultats"] {
        if !matches!(charge[cle], Json::Nul | Json::Objet(_)) {
            return Err(refus(format!("« {} » doit etre un objet JSON.", cle), ""));
        }
    }
    let dossier = _dossier(&nom, true)?;
    // « Enregistrer sous » un projet existant : effacer SA carte ou SES
    // resultats demande l'accord que la page envoie (`ecraser`) apres l'avoir
    // demande. Le projet ouvert, lui, se reecrit sans.
    let perdus: Vec<&str> = [("carte", F_CARTE), ("resultats", F_RESULTATS)]
        .into_iter()
        .filter(|(cle, f)| c.get(*cle) == Some(&Json::Nul) && Path::new(&joindre(&dossier, f)).is_file())
        .map(|(_, f)| f)
        .collect();
    if !perdus.is_empty() && charge["ecraser"] != Json::Bool(true) && ouvert().map(|(n, _)| n).as_deref() != Some(nom.as_str()) {
        return Err(refus(
            format!("Le projet « {} » existe deja : l'enregistrer sous ce nom supprimerait {}.", nom, perdus.join(" et ")),
            "Choisissez un autre nom, ou confirmez le remplacement.",
        ));
    }

    // un en-tete abime ne bloque pas l'enregistrement
    let ancien = _lire_json(&joindre(&dossier, F_PROJET)).ok().flatten().unwrap_or(Json::Nul);

    let maintenant = maintenant();
    let cree = ou(&ancien["cree"], maintenant.into());
    let tete = obj! {
        "format" => FORMAT,
        "version" => VERSION,
        "nom" => nom.clone(),
        "titre" => texte(&charge["titre"], 200),
        "cree" => cree.clone(),
        "modifie" => maintenant,
        "outil" => texte(&charge["outil"], usize::MAX),
        // D'OU VIENT LA CARTE, ET COMMENT ELLE S'APPELAIT. « source » dit
        // laquelle des deux branches relire — un dessin se refabrique, un
        // fichier se recharge —, et « fichier » est le nom que portait
        // l'IPC-2581 : il voyage jusque dans le document envoye au solveur,
        // et le remplacer par le nom du projet ferait changer en silence le
        // nom du script Python exporte.
        "source" => texte(&charge["source"], usize::MAX),
        "fichier" => texte(&charge["fichier"], 200),
        "dessin" => ou(&charge["dessin"], obj! {}),
        "antenne" => ou(&charge["antenne"], obj! {}),
        "affichage" => ou(&charge["affichage"], obj! {}),
    };
    _ecrire_json(&joindre(&dossier, F_PROJET), &tete)?;

    for (cle, fichier) in [("carte", F_CARTE), ("resultats", F_RESULTATS)] {
        let Some(valeur) = c.get(cle) else { continue }; // inchange : on n'y touche pas
        let chemin = joindre(&dossier, fichier);
        if *valeur == Json::Nul {
            let _ = std::fs::remove_file(&chemin);
            continue;
        }
        _ecrire_json(&chemin, valeur)?;
    }

    _ouvrir_memoire(&nom, &dossier);
    Ok(obj! {"nom" => nom, "dossier" => dossier, "modifie" => maintenant, "cree" => cree, "racine" => racine(),
             "projets" => Json::Liste(liste())})
}

// ==========================================================================
// Le projet ouvert
// ==========================================================================
// POURQUOI LE SERVEUR RETIENT LEQUEL EST OUVERT. Pas pour l'affichage — la
// page sait tres bien ou elle en est —, mais pour les dossiers de calcul :
// une simulation lancee alors qu'un projet est ouvert doit ecrire ses champs
// DANS ce projet, et non dans le dossier temporaire du systeme, ou ils se
// font effacer au premier nettoyage de disque.
fn _ouvrir_memoire(nom: &str, dossier: &str) {
    verrou(&POSTE).ouvert = Some((nom.to_string(), dossier.to_string()));
}

/// Le projet ouvert, (nom, dossier), ou None. Rend une copie : personne ne le modifie.
pub fn ouvert() -> Option<(String, String)> {
    verrou(&POSTE).ouvert.clone()
}

pub fn fermer() {
    verrou(&POSTE).ouvert = None;
}

/// Ou les simulations doivent ecrire, ou "" quand aucun projet n'est
/// ouvert — auquel cas openems_run retombe sur le dossier temporaire.
pub fn dossier_calculs() -> String {
    ouvert().map(|(_, dossier)| joindre(&dossier, D_CALCULS)).unwrap_or_default()
}

// ==========================================================================
// Les calculs d'un projet : les lister, et en importer un d'ailleurs
// --------------------------------------------------------------------------
// POURQUOI CES DEUX FONCTIONS EXISTENT. Un projet accumule un dossier de
// calcul par simulation lancee, et `resultats.json` n'en retient qu'UN : le
// dernier. Apres cinq simulations, cinq dossiers sont sur le disque avec
// leurs champs, et la page n'en atteignait qu'un seul — les quatre autres
// etaient la, invisibles, et il fallait fouiller le disque pour les revoir.
//
// `calculs()` rend la liste. `importer_calcul()` fait entrer dans cette liste
// un dossier venu d'ailleurs : une cle USB, un partage reseau, un calcul mene
// a la main sur une autre machine.
//
// ON COPIE, ON NE DEPLACE PAS, et la difference est tout sauf un detail. Le
// dossier archive de la simulation d'aujourd'hui est A NOUS — il est dans le
// TEMP, nous l'avons cree, le bouger ne prive personne. Un dossier qu'on
// IMPORTE appartient a l'utilisateur, il est peut-etre sur la cle d'un
// collegue, et le vider en croyant l'ouvrir serait la faute la plus grave que
// cet outil puisse commettre.
// ==========================================================================
/// Les fichiers d'un dossier de calcul : (chemin relatif, taille).
///
/// UN SEUL NIVEAU DE SOUS-DOSSIER. Un dossier openEMS est plat, a ceci pres
/// qu'un enregistrement de champ lointain range parfois ses fichiers a cote.
/// Descendre plus bas ne servirait qu'a suivre une arborescence qui n'est
/// plus celle d'un calcul.
fn _entrees_calcul(dossier: &str) -> Vec<(String, u64)> {
    let mut out = Vec::new();
    for nom in lister(dossier).unwrap_or_default() {
        let chemin = joindre(dossier, &nom);
        if Path::new(&chemin).is_file() {
            out.push((nom, _poids(&chemin)));
        } else if Path::new(&chemin).is_dir() {
            for n2 in lister(&chemin).unwrap_or_default() {
                let c2 = joindre(&chemin, &n2);
                if Path::new(&c2).is_file() {
                    out.push((joindre(&nom, &n2), _poids(&c2)));
                }
            }
        }
    }
    out
}

fn compte_vtr(entrees: &[(String, u64)]) -> usize {
    entrees.iter().filter(|(c, _)| c.to_lowercase().ends_with(".vtr")).count()
}

fn _resume_calcul(base: &str, nom: &str) -> Res<Json> {
    let dossier = joindre(base, nom);
    let entrees = _entrees_calcul(&dossier);
    Ok(obj! {
        "id" => nom,
        "modifie" => _mtime(&dossier),
        "octets" => entrees.iter().map(|(_, o)| *o).sum::<u64>() as i64,
        "fichiers" => entrees.len(),
        "vtr" => compte_vtr(&entrees),
        "importe" => _lire_json(&joindre(&dossier, F_IMPORT))?.unwrap_or(Json::Nul),
    })
}

/// Les dossiers de calcul du projet ouvert, du plus recent au plus ancien.
///
/// Rend une liste vide quand aucun projet n'est ouvert : ce n'est pas une
/// erreur, c'est qu'il n'y a nulle part ou regarder.
///
/// Une fiche d'import illisible remonte telle quelle : Python n'attrapait pas ce refus-la,
/// et le serveur en faisait une erreur interne.
pub fn calculs() -> Res<Vec<Json>> {
    let base = dossier_calculs();
    if base.is_empty() || !Path::new(&base).is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for nom in lister(&base).unwrap_or_default() {
        if Path::new(&joindre(&base, &nom)).is_dir() {
            out.push(_resume_calcul(&base, &nom)?);
        }
    }
    trier_par_date(&mut out);
    Ok(out)
}

/// Le dossier a importer, verifie. Rend son chemin absolu.
///
/// Le chemin VIENT DE L'UTILISATEUR, comme celui de la racine : c'est lui
/// qui sait ou est son calcul, et un outil local qui l'en empecherait ne
/// servirait a rien. Ce qui est borne, c'est ce qu'on en fait — on ne fait
/// que LIRE, et seulement les fichiers dont l'extension est celle d'un
/// dossier de calcul.
fn _source_importable(chemin: &str) -> Res<String> {
    let brut = ipc2581::py::strip(chemin).trim_matches('"');
    if brut.is_empty() {
        return Err(refus("Aucun dossier indique.", ""));
    }
    let voulu = abspath(&developper(brut));
    if Path::new(&voulu).is_file() {
        return Err(refus(
            format!("« {} » est un fichier, pas un dossier.", voulu),
            "Indiquez le DOSSIER du calcul — celui qui contient les .vtr.",
        ));
    }
    if !Path::new(&voulu).is_dir() {
        return Err(refus(
            format!("Ce dossier n'existe pas : {}", voulu),
            "Sur un lecteur reseau, verifiez qu'il est connecte ; le chemin est celui du poste qui fait tourner le serveur, et non celui du navigateur.",
        ));
    }
    Ok(voulu)
}

/// shutil.copy2 : le contenu, les droits et la date.
fn copier(source: &str, cible: &str) -> std::io::Result<()> {
    std::fs::copy(source, cible)?;
    if let Ok(date) = std::fs::metadata(source).and_then(|m| m.modified()) {
        let _ = std::fs::File::options().write(true).open(cible).and_then(|f| f.set_modified(date));
    }
    Ok(())
}

/// Copie un dossier de calcul venu d'ailleurs dans le projet ouvert.
///
/// `ident` est POSE PAR LE SERVEUR, et c'est voulu : la forme d'un
/// identifiant de calcul appartient a openems_run — c'est lui qui la
/// fabrique et lui qui la reconnait —, et ce module ne sait toujours pas
/// qu'openEMS existe.
pub fn importer_calcul(chemin: &str, ident: &str) -> Res<Json> {
    let Some((_, dossier_ouvert)) = ouvert() else {
        return Err(refus(
            "Aucun projet n'est ouvert.",
            "Donnez un nom au projet et enregistrez-le d'abord : c'est lui qui fournit le dossier ou ranger le calcul.",
        ));
    };
    let source = _source_importable(chemin)?;
    let base = dossier_calculs();

    // UN DOSSIER DEJA DANS LE PROJET NE S'IMPORTE PAS, il s'ouvre. Copier
    // ferait un doublon de plusieurs centaines de mega-octets pour rien, et
    // l'utilisateur croirait avoir fait quelque chose.
    // (deux lecteurs differents ne commencent pas l'un par l'autre)
    if realpath(&source).starts_with(realpath(&dossier_ouvert)) {
        return Err(refus(
            "Ce dossier est deja dans le projet.",
            "Il est dans la liste des calculs : ouvrez-le, il n'y a rien a importer.",
        ));
    }

    let toutes = _entrees_calcul(&source);
    let entrees: Vec<&(String, u64)> = toutes.iter().filter(|(c, _)| EXT_CALCUL.contains(&extension(c).to_lowercase().as_str())).collect();
    let vtr = entrees.iter().filter(|(c, _)| c.to_lowercase().ends_with(".vtr")).count();
    if vtr == 0 {
        return Err(refus(
            "Aucun fichier .vtr dans ce dossier : il n'y a pas de champ a regarder.",
            "Un dossier de calcul openEMS porte ses champs sous forme de fichiers .vtr. Verifiez que c'est bien le dossier du calcul, et non celui qui le contient.",
        ));
    }
    let octets: u64 = entrees.iter().map(|(_, o)| *o).sum();
    if entrees.len() > MAX_IMPORT_FICHIERS {
        return Err(refus(
            format!("Ce dossier contient {} fichiers a copier ; la limite est {}.", entrees.len(), MAX_IMPORT_FICHIERS),
            "",
        ));
    }
    if octets > MAX_IMPORT_OCTETS {
        return Err(refus(
            format!("Ce dossier pese {:.1} Go ; la limite a l'import est {} Go.", octets as f64 / 1024f64.powi(3), MAX_IMPORT_OCTETS / 1024u64.pow(3)),
            "",
        ));
    }

    // `realpath` comme le fait openems_run en rangeant les siens : sous
    // Windows, TEMP porte souvent le nom court 8.3 du profil, et deux
    // ecritures du meme dossier ne se comparent pas. La page affiche ce
    // chemin, et les deux routes doivent en donner le meme.
    let destination = realpath(&base).join(ident).to_string_lossy().into_owned();
    if Path::new(&destination).exists() {
        return Err(refus(format!("Un calcul porte deja cet identifiant : {}", ident), ""));
    }
    let copie = || -> Result<(), String> {
        std::fs::create_dir_all(&destination).map_err(|e| erreur_os(&e, &destination))?;
        for (relatif, _) in &entrees {
            let cible = joindre(&destination, relatif);
            if let Some(sous) = Path::new(&cible).parent() {
                std::fs::create_dir_all(sous).map_err(|e| erreur_os(&e, &sous.to_string_lossy()))?;
            }
            let origine = joindre(&source, relatif);
            copier(&origine, &cible).map_err(|e| erreur_os(&e, &origine))?;
        }
        Ok(())
    };
    if let Err(exc) = copie() {
        // UNE COPIE A MOITIE FAITE NE RESTE PAS. Elle apparaitrait dans la
        // liste comme un calcul ordinaire, et l'on regarderait des champs
        // tronques sans le savoir. La SOURCE, elle, n'est jamais touchee.
        let _ = std::fs::remove_dir_all(&destination);
        return Err(refus(
            format!("La copie a echoue : {}", exc),
            "Rien n'a ete ajoute au projet, et le dossier d'origine n'a pas ete modifie.",
        ));
    }

    let fiche = obj! {"source" => source.clone(), "nom" => basename(source.trim_end_matches(['/', std::path::MAIN_SEPARATOR])),
                      "date" => maintenant(), "fichiers" => entrees.len(), "octets" => octets as i64};
    _ecrire_json(&joindre(&destination, F_IMPORT), &fiche)?;
    Ok(obj! {"id" => ident, "dossier" => destination, "fichiers" => entrees.len(), "octets" => octets as i64, "vtr" => vtr,
             "source" => source, "ignores" => toutes.len() - entrees.len()})
}

// ==========================================================================
// Le debit du poste
// --------------------------------------------------------------------------
// IL EST ICI PARCE QUE C'EST ICI QU'EST LE FICHIER DE REGLAGES, et nulle part
// ailleurs : ce module ne sait toujours pas qu'openEMS existe. Il range un
// nombre que le serveur lui donne et le rend quand on le lui demande — ce
// nombre pourrait etre la vitesse d'autre chose, cela ne changerait rien ici.
//
// POURQUOI IL SURVIT A LA SESSION. Le debit est une propriete du POSTE, comme
// la racine des projets : le mesurer a chaque demarrage obligerait a lancer un
// calcul avant que la premiere annonce de duree soit juste — c'est-a-dire
// exactement au moment ou l'on decide de le lancer ou non.
// ==========================================================================
/// float(v or 0.0), ou None la ou Python levait TypeError ou ValueError.
fn flottant(v: &Json) -> Option<f64> {
    match v {
        _ if !v.vrai() => Some(0.0),
        Json::Bool(_) => Some(1.0),
        Json::Texte(t) => ipc2581::py::float(t),
        _ => v.as_f64(),
    }
}

/// max(0, int(v or 0)), ou 0 la ou Python levait TypeError ou ValueError.
fn entier(v: &Json) -> i64 {
    let n = match v {
        Json::Texte(t) => ipc2581::py::strip(t).parse::<i64>().ok(),
        _ => flottant(v).filter(|f| f.is_finite()).map(|f| f.trunc() as i64),
    };
    n.unwrap_or(0).max(0)
}

fn reglage(cle: &str) -> Json {
    _config_lire().get(cle).cloned().unwrap_or(Json::Nul)
}

/// Le debit retenu pour ce poste, ou 0.0 si l'on n'en a jamais mesure.
pub fn debit_lu() -> f64 {
    flottant(&reglage("debit_mcps")).unwrap_or(0.0)
}

/// Range le debit. Un profil en lecture seule ne fait pas echouer l'appel.
///
/// Rien n'est reecrit quand la valeur n'a pas bouge : cette fonction est
/// appelee a chaque calcul termine, et un fichier de reglages reecrit pour
/// rien est un fichier de reglages qu'on finit par trouver corrompu apres
/// une coupure de courant.
///
/// `fils` : avec combien de fils ce debit a ete mesure (0 : on ne sait pas).
pub fn debit_noter(valeur: f64, fils: i64) -> f64 {
    let f = fils.max(0);
    if valeur.is_nan() || valeur <= 0.0 {
        return debit_lu();
    }
    if (valeur - debit_lu()).abs() >= 1e-9 {
        _config_ecrire("debit_mcps", valeur.into());
    }
    if f != debit_fils_lu() {
        _config_ecrire("debit_fils", f.into());
    }
    valeur
}

/// Les fils avec lesquels le debit retenu a ete mesure, ou 0.
pub fn debit_fils_lu() -> i64 {
    entier(&reglage("debit_fils"))
}

// ==========================================================================
// Les fils de calcul, et le banc de vitesse
// --------------------------------------------------------------------------
// MEME RAISON QUE LE DEBIT : c'est le poste qui a un bon nombre de fils, pas
// l'antenne. Ce module range deux nombres et une table sans savoir ce
// qu'ils mesurent.
// ==========================================================================
/// Le nombre de fils regle sur ce poste, ou 0 (au solveur de choisir).
pub fn fils_lu() -> i64 {
    entier(&reglage("fils"))
}

pub fn fils_noter(n: i64) -> i64 {
    let v = n.max(0);
    if v != fils_lu() {
        _config_ecrire("fils", v.into());
    }
    v
}

/// La derniere table du banc de vitesse, {fils: MC/s}, ou {}.
pub fn banc_lu() -> Json {
    match reglage("banc_fils") {
        d @ Json::Objet(_) => d,
        _ => obj! {},
    }
}

/// `table` est un objet : ses cles sont deja des textes.
pub fn banc_noter(table: &Json) -> Json {
    if !matches!(table, Json::Objet(_)) || !table.vrai() {
        return banc_lu();
    }
    if *table != banc_lu() {
        _config_ecrire("banc_fils", table.clone());
    }
    table.clone()
}

// ==========================================================================
// Etat, et ouverture dans l'explorateur
// ==========================================================================
/// Ce que la page affiche avant tout choix : ou l'on range, et ce qu'il
/// y a deja.
pub fn etat() -> Json {
    let base = racine();
    obj! {
        "racine" => base.clone(),
        "defaut" => racine_defaut(),
        "existe" => Path::new(&base).is_dir(),
        "projets" => Json::Liste(liste()),
        "ouvert" => ouvert().map(|(nom, dossier)| obj! {"nom" => nom, "dossier" => dossier}).unwrap_or(Json::Nul),
        "format" => FORMAT,
    }
}

/// Ouvre la racine, ou le dossier d'un projet, dans l'explorateur.
///
/// Meme borne que pour les dossiers de calcul (voir openems_run) : on
/// n'ouvre que ce que ce module fabrique lui-meme — la racine choisie, ou
/// un sous-dossier dont le nom a passe `_verifier_nom`. Aucun chemin venu
/// de la requete n'arrive ici tel quel.
pub fn ouvrir_explorateur(nom: Option<&str>) -> Res<Json> {
    let dossier = match nom {
        Some(nom) => _dossier(nom, false)?,
        None => racine(),
    };
    if !Path::new(&dossier).is_dir() {
        return Err(refus(format!("Ce dossier n'existe pas encore : {}", dossier), "Il sera cree au premier enregistrement."));
    }
    let programme = if cfg!(windows) { "explorer" } else if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    use std::process::Stdio;
    std::process::Command::new(programme)
        .arg(&dossier)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|exc| refus(format!("Le dossier n'a pas pu etre ouvert : {}", erreur_os(&exc, programme)), ""))?;
    Ok(obj! {"lance" => "dossier", "dossier" => dossier})
}

#[cfg(test)]
mod essais;
