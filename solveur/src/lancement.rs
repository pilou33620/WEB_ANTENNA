//! Lance vraiment openEMS, et rend compte pendant qu'il tourne.
//! Le portage de python/openems_run.py (1.0.0, 2026-09-14).
//!
//!   LE SOLVEUR TOURNE DANS UN PROCESSUS A LUI, ET C'EST DELIBERE. Ce module ecrit le XML
//!   produit par `xml`, puis lance l'executable `openEMS` dessus. Trois raisons, dans
//!   l'ordre ou elles comptent :
//!
//!   1. CE QUI TOURNE EST EXACTEMENT CE QU'ON EXPORTE. Le bouton « Exporter » et le bouton
//!      « Lancer » passent par le meme fichier. Un export qui ne reproduirait pas le
//!      resultat de l'interface serait pire qu'inutile : il serait trompeur.
//!   2. UN SOLVEUR QUI PLANTE NE DOIT PAS EMPORTER LE SERVEUR. Une geometrie degeneree peut
//!      faire tomber openEMS par une faute de segmentation : elle ne tue que lui.
//!   3. ON PEUT L'ARRETER. Un calcul de trois heures lance par erreur se tue par son PID.
//!
//! Fonctions : etat, lancer, lancer_balayage, lancer_tableau_s, lancer_banc,
//!            fils_a_essayer, journal, arreter, definir_racine_calculs,
//!            identifiant_neuf, archiver, dossier_de, ouvrir_dossier, liste

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use antenne_modele::modele::{self, ErreurModele, Modele, Suite, MAX_CORPS};
use antenne_modele::outils::fmt_g;
use antenne_modele::pieces::Piece;
use antenne_modele::{dumps, obj, Json, Objet};
use regex::Regex;

use crate::xml::{self, f, liste, refus, txt};
use crate::{depouillement, ports::PortMesure};

type Res<T> = Result<T, ErreurModele>;

// Une tache oubliee garde son dossier de calcul et ses champs : on ne les
// efface pas (la visionneuse en a besoin), mais on cesse de suivre la tache elle-meme
// au bout d'un moment, sinon le serveur les accumule sans fin.
pub const DUREE_MEMOIRE: f64 = 12.0 * 3600.0;

fn maintenant() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

fn verrou<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ==========================================================================
// Ou sont les executables
// ==========================================================================
// D'ABORD LE DOSSIER « openEMS » A COTE DE L'OUTIL, ensuite l'installation du
// systeme. Sur Windows openEMS se distribue en archive : openEMS.exe, nf2ff.exe
// et leurs DLL dans un meme dossier, que rien n'inscrit dans le PATH. Ailleurs
// il s'installe par le gestionnaire de paquets, et ses executables y sont.
static RACINE: Mutex<Option<PathBuf>> = Mutex::new(None);
static ETAT: Mutex<Option<Json>> = Mutex::new(None);

/// La racine du depot : la ou est le dossier « openEMS ». Le serveur la pose ; a defaut
/// on regarde autour de l'executable qui tourne.
pub fn definir_racine_depot(chemin: &Path) {
    *verrou(&RACINE) = Some(chemin.to_path_buf());
    *verrou(&ETAT) = None;
}

fn exe(nom: &str) -> String {
    if cfg!(windows) { format!("{nom}.exe") } else { nom.to_string() }
}

/// Ou sont les executables d'openEMS, s'ils sont dans le depot ; "" sinon.
pub fn dossier_openems() -> String {
    let mut racines: Vec<PathBuf> = match verrou(&RACINE).clone() {
        Some(r) => vec![r],
        None => {
            let ici = std::env::current_exe().ok();
            let mut v: Vec<PathBuf> = ici.iter().flat_map(|p| p.ancestors().skip(1).take(4)).map(|p| p.to_path_buf()).collect();
            v.extend(std::env::current_dir().ok());
            v
        }
    };
    racines.dedup();
    let mut candidats: Vec<PathBuf> = racines.iter().flat_map(|r| [r.join("openEMS"), r.join("openems")]).collect();
    candidats.extend(std::env::var_os("OPENEMS_DLL").filter(|v| !v.is_empty()).map(PathBuf::from));
    if cfg!(windows) {
        candidats.extend([PathBuf::from(r"C:\openEMS"), PathBuf::from(r"C:\openems")]);
    }
    candidats.into_iter().find(|c| c.join(exe("openEMS")).is_file()).map(|c| c.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Le chemin d'un executable d'openEMS (« openEMS », « nf2ff ») : dans le depot, sinon dans le PATH.
pub fn executable(nom: &str) -> Option<PathBuf> {
    let d = dossier_openems();
    if !d.is_empty() && Path::new(&d).join(exe(nom)).is_file() {
        return Some(Path::new(&d).join(exe(nom)));
    }
    let chemins = std::env::var_os("PATH")?;
    std::env::split_paths(&chemins).flat_map(|p| [p.join(exe(nom)), p.join(exe(&nom.to_lowercase()))]).find(|p| p.is_file())
}

/// La commande d'un executable d'openEMS : ses bibliotheques d'abord dans les chemins de
/// recherche, pour une archive posee dans le depot.
fn commande(programme: &Path, dossier: &Path) -> Command {
    let mut c = Command::new(programme);
    c.current_dir(dossier).stdin(Stdio::null());
    if let Some(d) = programme.parent().filter(|d| !d.as_os_str().is_empty()) {
        for var in ["PATH", "LD_LIBRARY_PATH"] {
            let mut v = vec![d.to_path_buf()];
            v.extend(std::env::var_os(var).iter().flat_map(std::env::split_paths));
            if let Ok(j) = std::env::join_paths(v) {
                c.env(var, j);
            }
        }
    }
    c
}

/// Lance `openEMS` sans argument : il se presente, donne son usage et sort.
///
/// à vérifier sur un vrai openEMS : qu'il rend bien la main sans argument, et la ligne
/// « openEMS ... version X » dont on tire la version.
fn sonder(programme: &Path) -> Json {
    let mut c = commande(programme, Path::new("."));
    let sortie = match c.stdout(Stdio::piped()).stderr(Stdio::piped()).output() {
        Ok(s) => s,
        Err(e) => return obj! {"dispo" => false, "detail" => format!("{} : {e}", programme.display())},
    };
    let texte = format!("{}{}", String::from_utf8_lossy(&sortie.stdout), String::from_utf8_lossy(&sortie.stderr));
    if !texte.contains("openEMS") {
        let fin: String = texte.trim().chars().rev().take(300).collect::<Vec<_>>().into_iter().rev().collect();
        return obj! {"dispo" => false, "detail" => if fin.is_empty() { format!("{} : aucune reponse ({})", programme.display(), sortie.status) } else { fin }};
    }
    static VERSION: OnceLock<Regex> = OnceLock::new();
    let re = VERSION.get_or_init(|| Regex::new(r"openEMS.*version\s+(\S+)").unwrap());
    obj! {"dispo" => true, "version" => re.captures(&texte).map(|c| c[1].to_string()).unwrap_or_else(|| "?".into())}
}

/// openEMS est-il utilisable, et par quel executable ?
///
/// On le verifie en le LANCANT POUR DE VRAI : une reponse devinee ne vaudrait
/// rien -- c'est exactement le genre de chose qui echoue pour une raison
/// qu'on n'aurait pas pensee (une DLL absente, une archive incomplete).
pub fn etat(refaire: bool) -> Json {
    if let (false, Some(e)) = (refaire, verrou(&ETAT).clone()) {
        return e;
    }
    let programme = executable("openEMS");
    let mut out = match &programme {
        Some(p) => sonder(p),
        None => obj! {"dispo" => false, "detail" => "l'executable « openEMS » est introuvable"},
    };
    if let Json::Objet(o) = &mut out {
        let chemin = |p: Option<PathBuf>| p.map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        o.insert("dll".into(), dossier_openems().into());
        o.insert("executable".into(), chemin(programme).into());
        o.insert("nf2ff".into(), chemin(executable("nf2ff")).into());
        o.insert("max".into(), MAX_CORPS.into());
        if !o["dispo"].vrai() {
            o.insert("conseil".into(), "openEMS se pilote par ses deux executables, « openEMS » et « nf2ff ». Sur \
                Windows, posez l'archive binaire dans un dossier « openEMS » a cote de l'outil : ce module y cherche \
                openEMS.exe, nf2ff.exe et leurs DLL. Ailleurs, installez openEMS de sorte que ces deux executables \
                soient dans le PATH.".into());
        }
    }
    *verrou(&ETAT) = Some(out.clone());
    out
}

// ==========================================================================
// Le suivi d'avancement
// ==========================================================================
// openEMS ecrit une ligne par tranche de pas de temps, de cette forme :
//
//   [@     1m40s] Timestep:    14586 || Speed:  7.1 MC/s (8.654e-03 s/TS)
//   || Energy: ~2.68e-17 (-39.06dB)
//
// IL N'Y A PAS DE POURCENTAGE DANS CETTE LIGNE, et c'est pour cela qu'on le
// calcule ici : le rapport au nombre maximal de pas ne figure pas dans la
// sortie d'openEMS 0.0.36, alors que la page a besoin d'une barre qui avance.
// Ce pourcentage-la ne dit d'ailleurs pas grand-chose — NrTS est un garde-fou,
// pas le critere d'arret : une simulation qui converge s'arrete a 30 % et
// c'est normal. C'est l'ENERGIE qui dit vraiment ou on en est, et c'est elle
// que la page montre en grand.
struct Motifs {
    pas: Regex,
    energie: Regex,
    vitesse: Regex,
    fils: Regex,
    banc: Regex,
    fin: Regex,
    erreur: Regex,
}

fn motifs() -> &'static Motifs {
    static M: OnceLock<Motifs> = OnceLock::new();
    M.get_or_init(|| Motifs {
        pas: Regex::new(r"Timestep:?\s+(\d+)").unwrap(),
        // « (- 1.88dB) » : openEMS aligne ses colonnes en glissant une ESPACE entre le
        // signe et le nombre. Sans le `\s*` qui suit le moins, l'energie ne se lit que
        // sur les lignes ou elle passe les dix decibels — c'est-a-dire jamais au debut,
        // quand on la regarde le plus.
        energie: Regex::new(r"Energy:\s*~?([\d.eE+-]+)\s*\(\s*(-?\s*[\d.]+)\s*dB").unwrap(),
        vitesse: Regex::new(r"Speed:\s*([\d.]+)\s*MC/s").unwrap(),
        // « Multithreaded engine using 3 threads. » -- une ligne par palier quand
        // openEMS tatonne (reglage a 0), une seule quand le nombre est impose. La
        // derniere dit avec combien de fils le calcul tourne vraiment.
        fils: Regex::new(r"Multithreaded engine using\s+(\d+)\s+thread").unwrap(),
        // La ligne que le banc de vitesse ecrit apres chaque essai.
        banc: Regex::new(r"Banc : (\d+) fil\(s\) -> ([\d.]+) MCells/s").unwrap(),
        // « Speed: 243.1 MCells/s » : la vitesse de la boucle FDTD seule, montage du
        // maillage exclu.
        fin: Regex::new(r"Speed:\s*([\d.]+)\s*MCells/s").unwrap(),
        erreur: Regex::new(r"^[A-Za-z_][\w.]*(Error|Exception|Exit)\b").unwrap(),
    })
}

type Point3 = (f64, i64, f64);

/// Pente de l'energie (dB) en fonction du pas, aux moindres carres.
///
/// Une difference entre le premier et le dernier point suffirait si l'energie
/// descendait sagement. Elle ne le fait pas : elle ressaute d'un facteur deux
/// d'une ligne a l'autre, et deux points mal tombes donnent une pente nulle ou
/// montante. La regression, elle, encaisse le bruit.
fn _pente(points: &[Point3]) -> f64 {
    let n = points.len() as f64;
    let sx: f64 = points.iter().map(|p| p.1 as f64).sum();
    let sy: f64 = points.iter().map(|p| p.2).sum();
    let sxx: f64 = points.iter().map(|p| (p.1 * p.1) as f64).sum();
    let sxy: f64 = points.iter().map(|p| p.1 as f64 * p.2).sum();
    let d = n * sxx - sx * sx;
    if d.abs() < 1e-9 { 0.0 } else { (n * sxy - sx * sy) / d }
}

/// L'energie que la droite ajustee donne au pas `x`.
fn _ordonnee(points: &[Point3], x: f64) -> f64 {
    let n = points.len() as f64;
    let mx = points.iter().map(|p| p.1 as f64).sum::<f64>() / n;
    let my = points.iter().map(|p| p.2).sum::<f64>() / n;
    my + _pente(points) * (x - mx)
}

#[derive(Debug, Clone, Default)]
struct Avancement {
    pas: i64,
    pourcent: f64,
    energie_db: Option<f64>,
    vitesse: f64,
    restant_s: Option<f64>,
    cause: String,
    fils: i64,
    /// (point, points) d'une suite
    point: Option<(usize, usize)>,
}

impl Avancement {
    fn json(&self) -> Json {
        let ou_nul = |v: Option<f64>| v.map(Json::from).unwrap_or(Json::Nul);
        let mut o = obj! {"pas" => self.pas, "pourcent" => self.pourcent, "energie_dB" => ou_nul(self.energie_db),
                          "vitesse" => self.vitesse, "restant_s" => ou_nul(self.restant_s), "cause" => self.cause.clone(),
                          "fils" => self.fils};
        if let (Some((p, n)), Json::Objet(o)) = (self.point, &mut o) {
            o.insert("point".into(), p.into());
            o.insert("points".into(), n.into());
        }
        o
    }
}

/// Un point d'une suite (balayage ou tableau S).
#[derive(Debug, Clone)]
struct Point {
    n: usize,
    etiquette: String,
    valeur: f64,
    valeur2: Json,
    etat: &'static str, // attend | calcule | fini | echoue
    resultat: Json,
    detail: String,
    dossier: PathBuf,
}

/// Ce qui distingue une suite d'une simulation seule.
struct SuiteEnCours {
    /// SOUS QUELLE CLEF LA PAGE LIT CETTE SUITE. Un balayage et un tableau S sont la meme
    /// mecanique — N simulations a la suite, un dossier par point, un resultat assemble a
    /// la fin — et c'est la seule chose qui les separe : ce qu'ils rendent, et sous quel
    /// nom la page va le chercher.
    clef: &'static str,
    bal: Json,
    modeles: Vec<(Json, Vec<Piece>)>,
    points: Vec<Point>,
    courant: usize,
    /// les ports d'un tableau S
    ports: Json,
}

struct Banc {
    essais: Vec<i64>,
    mesures: Vec<(i64, f64)>,
    faits: usize,
    /// Lance par le serveur a son demarrage, et non par un clic : il cede alors la place
    /// au premier calcul demande (voir `_exiger_libre`).
    auto: bool,
}

enum Genre {
    Simple,
    Suite(Box<SuiteEnCours>),
    Banc(Banc),
}

struct Interne {
    dossier: PathBuf,
    modele: Json,
    etat: &'static str, // prepare | calcule | fini | echoue | arrete
    journal: Vec<String>,
    avancement: Avancement,
    // L'historique (instant, pas, energie en dB) des dernieres lignes
    // d'avancement. Il sert a estimer le temps restant -- voir `_reste`.
    hist: Vec<Point3>,
    // L'energie BRUTE (pas, valeur), qui dit ce que les decibels cachent :
    // voir `ajouter` et `diagnostic_energie`.
    brute: Vec<(i64, f64)>,
    // Les vitesses qu'openEMS a annoncees, dans l'ordre. Elles servent
    // apres coup, quand le calcul a fini : voir `_noter_debit`.
    vitesses: Vec<f64>,
    resultat: Json,
    detail: String,
    debut: f64,
    fin: f64,
    genre: Genre,
}

/// Une simulation : son dossier, son processus, son journal, son resultat.
pub struct Tache {
    pub id: String,
    i: Mutex<Interne>,
    proc: Mutex<Option<Child>>,
}

/// Comment un calcul a tourne court.
enum Echec {
    Arrete,
    Detail(String),
}

impl Interne {
    fn nmax(&self) -> i64 {
        self.modele["arret"]["nmax"].as_i64().unwrap_or(0)
    }

    fn cible(&self) -> Option<f64> {
        self.modele["arret"]["energie_dB"].as_f64()
    }

    // -- journal ---------------------------------------------------------
    fn ajouter(&mut self, ligne: &str) {
        let ligne = ligne.trim_end_matches(['\r', '\n']);
        if ligne.is_empty() {
            return;
        }
        self.journal.push(ligne.to_string());
        // Une simulation bavarde peut ecrire des dizaines de milliers de
        // lignes. On garde le debut (ou sont les erreurs de geometrie) et
        // la fin (ou est l'avancement), pas le milieu.
        if self.journal.len() > 4000 {
            self.journal.drain(200..1200);
            self.journal.insert(200, "  … (lignes intermediaires omises) …".into());
        }
        let re = motifs();
        if let Genre::Banc(b) = &mut self.genre {
            if ligne.starts_with("Banc : ") {
                b.faits += 1;
                if let Some(m) = re.banc.captures(ligne) {
                    if let (Ok(fils), Ok(v)) = (m[1].parse::<i64>(), m[2].parse::<f64>()) {
                        match b.mesures.iter_mut().find(|(k, _)| *k == fils) {
                            Some(e) => e.1 = v,
                            None => b.mesures.push((fils, v)),
                        }
                        self.avancement.fils = fils;
                        self.avancement.vitesse = v;
                    }
                }
                self.avancement.pourcent = 100.0 * b.faits as f64 / b.essais.len().max(1) as f64;
            }
            return;
        }
        let pas = re.pas.captures(ligne).and_then(|m| m[1].parse::<i64>().ok());
        if let Some(pas) = pas {
            self.avancement.pas = pas;
            let nmax = self.nmax();
            if nmax > 0 {
                self.avancement.pourcent = (100.0 * pas as f64 / nmax as f64).min(100.0);
            }
        }
        if let Some(m) = re.energie.captures(ligne) {
            if let Ok(v) = m[2].replace(' ', "").parse::<f64>() {
                self.avancement.energie_db = Some(v);
            }
            // L'ENERGIE BRUTE EN PLUS DES DECIBELS, ET C'EST ELLE QUI DISTINGUE
            // UNE DIVERGENCE. Les decibels d'openEMS sont pris sur le MAXIMUM
            // ATTEINT JUSQUE-LA : un calcul qui explose les affiche a 0,00 dB
            // d'un bout a l'autre, exactement comme un calcul dont l'impulsion
            // entre encore. Les deux se lisent pareil en dB et n'ont rien a
            // voir -- seul le nombre devant le dit.
            if let Ok(v) = m[1].parse::<f64>() {
                self.brute.push((self.avancement.pas, v));
                if self.brute.len() > 400 {
                    self.brute.drain(..200);
                }
            }
        }
        if let Some(n) = re.fils.captures(ligne).and_then(|m| m[1].parse().ok()) {
            self.avancement.fils = n;
        }
        if let Some(v) = re.vitesse.captures(ligne).and_then(|m| m[1].parse::<f64>().ok()) {
            self.avancement.vitesse = v;
            self.vitesses.push(v);
        }
        // Une ligne d'avancement porte le pas ET l'energie : c'est celle-la, et
        // elle seule, qui entre dans l'historique.
        if let (Some(_), Some(e)) = (pas, self.avancement.energie_db) {
            self.hist.push((maintenant(), self.avancement.pas, e));
            if self.hist.len() > 400 {
                self.hist.drain(..200);
            }
            self._reste();
        }
    }

    // -- le temps restant ------------------------------------------------
    /// Combien de temps encore, et a cause de quoi.
    ///
    /// DEUX COMPTEURS COURENT, ET CE N'EST PAS LE MEME QUI GAGNE SELON LES
    /// CAS. Le garde-fou `nmax` donne une borne franche : il reste tant de
    /// pas, on sait a quelle vitesse ils defilent. Mais ce n'est presque
    /// jamais lui qui arrete -- c'est l'ENERGIE RESIDUELLE, qui doit tomber
    /// sous un seuil. Un pourcentage calcule sur `nmax` annoncerait donc
    /// systematiquement trois fois trop de temps, et une barre qui ment est
    /// pire qu'une barre absente.
    ///
    /// L'ENERGIE DECROIT EN EXPONENTIELLE, donc en DROITE quand on la lit en
    /// decibels : une regression sur les derniers points donne la pente, et
    /// la pente dit dans combien de pas le seuil sera franchi. On rend le
    /// plus court des deux, et on DIT lequel commande -- « l'energie » ou
    /// « le garde-fou » ne veulent pas dire la meme chose pour qui regarde.
    ///
    /// DEUX PRECAUTIONS. On ne regarde que les points posterieurs au MAXIMUM
    /// d'energie : tant que l'impulsion entre, l'energie monte, et une pente
    /// montante extrapolerait l'infini. Et on ne rend rien tant qu'on n'a pas
    /// quelques points apres ce maximum -- l'energie ressaute d'un facteur
    /// deux d'une ligne a l'autre, une estimation sur deux points serait un
    /// chiffre au hasard.
    fn _reste(&mut self) {
        self.avancement.restant_s = None;
        self.avancement.cause.clear();
        let h = &self.hist;
        if h.len() < 10 {
            return;
        }
        // APRES LE MAXIMUM D'ENERGIE, ET SUR TOUT CE QUI SUIT -- pas seulement
        // sur les derniers points. La descente est une droite en decibels : plus
        // la fenetre est longue, plus la pente est sure, et une fenetre glissante
        // de trente points faisait sauter l'annonce de 5 a 44 minutes d'une ligne
        // a l'autre. On jette le premier quart, ou l'impulsion finit de sortir et
        // ou la descente n'a pas encore sa pente definitive.
        let mut i_max = 0;
        for (i, p) in h.iter().enumerate() {
            if p.2 > h[i_max].2 {
                i_max = i;
            }
        }
        let apres = &h[i_max + 1..];
        let fen = &apres[apres.len() / 4..];
        if fen.len() < 8 {
            return;
        }
        let (t0, pas0) = (fen[0].0, fen[0].1);
        let (t1, pas1) = (fen[fen.len() - 1].0, fen[fen.len() - 1].1);
        // L'ENERGIE DE DEPART EST CELLE DE LA DROITE, PAS CELLE DU DERNIER
        // POINT. Le dernier point ressaute volontiers de quatre decibels ; le
        // prendre pour depart ferait osciller l'annonce du simple au triple a
        // chaque rafraichissement. On lit donc l'energie SUR la droite ajustee.
        let e1 = _ordonnee(fen, pas1 as f64);
        if pas1 <= pas0 || t1 <= t0 {
            return;
        }
        let pas_par_s = (pas1 - pas0) as f64 / (t1 - t0);
        let pente = _pente(fen); // dB par pas, negative quand ca descend
        let mut fins: Vec<(f64, &str)> = Vec::new();
        if self.nmax() > 0 {
            fins.push((self.nmax() as f64, "le garde-fou"));
        }
        if let Some(cible) = self.cible() {
            if pente < -1e-9 && e1 > cible {
                fins.push((pas1 as f64 + (e1 - cible) / (-pente), "l'energie"));
            }
        }
        let Some((fin, cause)) = fins.into_iter().reduce(|a, b| if b.0 < a.0 || (b.0 == a.0 && b.1 < a.1) { b } else { a }) else { return };
        self.avancement.restant_s = Some(((fin - pas1 as f64) / pas_par_s).max(0.0));
        self.avancement.cause = cause.to_string();
        if fin > 0.0 {
            let pct = (100.0 * pas1 as f64 / fin).clamp(0.0, 99.0);
            self.avancement.pourcent = self.avancement.pourcent.max(pct);
        }
    }

    /// La courbe d'energie repart a zero : elle decrit UNE simulation.
    ///
    /// Un balayage enchaine N calculs dans la MEME tache, et l'historique s'y
    /// accumulait d'un point sur l'autre : le maximum d'energie restait celui du
    /// point 1, si bien que le temps restant des points suivants etait extrapole
    /// sur une pente calculee a cheval sur deux calculs.
    ///
    /// LES VITESSES, ELLES, NE SONT PAS REMISES A ZERO : celles-la decrivent
    /// le poste et non le point, et c'est leur mediane sur toute la suite qui
    /// cale les durees annoncees.
    fn _repartir_energie(&mut self) {
        self.hist.clear();
        self.brute.clear();
    }

    // -- quand il ne revient AUCUN chiffre ---------------------------------
    /// Pourquoi ce calcul n'a rien rendu d'exploitable.
    ///
    /// TROIS CAS, ET ILS NE SE CORRIGENT PAS DE LA MEME FACON :
    ///
    /// - l'energie MONTE encore a la fin. Une impulsion qui entre monte
    ///   aussi, mais elle s'arrete ; une montee qui ne s'arrete pas est une
    ///   divergence, et elle vient du maillage -- une cellule trop petite
    ///   quelque part, ou une geometrie degeneree qui en fabrique une.
    /// - l'energie DESCEND mais n'arrive pas au seuil. C'est le garde-fou
    ///   `nmax` qui a coupe, et la transformee porte alors sur une descente
    ///   tronquee : elle ne rend pas une mesure, elle rend un artefact.
    /// - l'energie est BIEN descendue. Le calcul s'est deroule normalement,
    ///   et ce qui manque est ailleurs -- un port qui n'excite rien, une
    ///   sonde qui ne voit aucun cuivre.
    ///
    /// LES DECIBELS NE SUFFISENT PAS A TRANCHER LE PREMIER, et c'est la
    /// raison d'etre de `brute` : openEMS rapporte ses decibels par
    /// rapport au maximum atteint jusque-la, si bien qu'un calcul qui explose
    /// affiche 0,00 dB du debut a la fin.
    ///
    /// Rend `None` quand il n'y a rien a dire -- pas de journal d'avancement,
    /// donc pas de courbe a lire.
    fn diagnostic_energie(&self) -> Option<String> {
        // Une boite vide fermee en PEC n'a pas d'energie qui descende : il
        // n'y a rien a diagnostiquer, et le message des antennes serait faux.
        if matches!(self.genre, Genre::Banc(_)) {
            return None;
        }
        let h = &self.hist;
        if h.len() < 6 || self.brute.len() < 6 {
            if h.is_empty() {
                return Some("openEMS n'a publie aucun pas de temps : il s'est \
                    arrete avant la boucle de calcul. Le debut du \
                    journal dit sur quoi -- le maillage et la geometrie \
                    y passent en premier.".into());
            }
            return None;
        }
        let brutes: Vec<f64> = self.brute.iter().map(|b| b.1).collect();
        let mut i_max = 0;
        for (i, v) in brutes.iter().enumerate() {
            if *v > brutes[i_max] {
                i_max = i;
            }
        }
        let fin = brutes.len() - 1;
        let e_fin = h[h.len() - 1].2;

        // 1. Ca montait encore. Le maximum est dans le dernier dixieme de ce
        //    qu'on a vu : l'impulsion est finie depuis longtemps.
        if i_max as f64 >= 0.9 * fin as f64 && fin > 5 {
            let mut debut = brutes[..(fin / 3).max(1)].to_vec();
            debut.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let r = debut[debut.len() / 2];
            let r = if r != 0.0 { r } else { 1e-300 };
            let facteur = fmt_g(brutes[fin] / r, 3);
            // UNE MONTEE N'EST PAS FORCEMENT UNE DIVERGENCE. Tant que
            // l'impulsion entre, l'energie monte aussi -- c'est normal, et un
            // calcul coupe la se corrige au compteur de pas, pas au maillage.
            // Ce qui les separe est l'ORDRE DE GRANDEUR : une impulsion fait
            // monter l'energie de quelques decades pendant sa montee, une
            // divergence de beaucoup plus, et sans jamais s'arreter. Envoyer
            // au mauvais reglage est pire que ne rien dire.
            if brutes[fin] / r < 1e3 {
                return Some(format!("L'energie MONTAIT encore quand le calcul s'est arrete, \
                    mais modestement (x{facteur}) : le compteur de pas a coupe \
                    pendant que l'impulsion entrait encore. Ce n'est pas \
                    une divergence, c'est un calcul interrompu avant \
                    d'avoir commence a mesurer. Relevez `nmax` : openEMS \
                    demande au moins trois fois la duree de l'excitation, \
                    et une antenne resonante en demande bien davantage \
                    pour se vider ensuite."));
            }
            return Some(format!("L'energie MONTAIT encore quand le calcul s'est arrete \
                (x{facteur} depuis le debut) : le calcul diverge, il ne \
                converge pas lentement. Une divergence FDTD vient du \
                maillage -- une cellule beaucoup plus petite que les \
                autres, souvent fabriquee par une geometrie degeneree : \
                deux bords a un micron l'un de l'autre, un polygone \
                d'aire nulle, un port plus mince qu'une cellule. \
                Regardez le maillage avant de relancer : les decibels \
                du journal, eux, ne le montrent pas -- openEMS les \
                compte sur le maximum atteint, et ils restent a 0,00 dB \
                pendant toute la montee."));
        }

        // 2. Ca descendait, mais pas assez loin.
        if let Some(cible) = self.cible() {
            if e_fin > cible + 6.0 {
                return Some(format!("L'energie n'est descendue qu'a {e_fin:.1} dB, pour un seuil \
                    demande a {cible:.0} dB : c'est le garde-fou du nombre de pas \
                    qui a arrete le calcul, pas l'energie. La transformee \
                    porte alors sur une descente tronquee, et ce qu'elle \
                    rend n'est pas une mesure. Relevez `nmax`, ou remontez \
                    le seuil si cette antenne se vide vraiment lentement -- \
                    une antenne resonante met du temps, c'est normal."));
            }
        }

        // 3. La descente s'est bien passee : ce n'est pas elle.
        Some(format!("L'energie est bien descendue ({e_fin:.1} dB) : le calcul s'est \
            deroule normalement, et ce qui manque ne vient pas de sa \
            convergence. Les causes qui restent sont du cote de la \
            mesure -- un port qui n'excite rien parce que sa pastille \
            est plus fine que la maille, ou une sonde posee hors du \
            cuivre. L'assistant compte ces deux cas AVANT le lancement : \
            relisez ses avis."))
    }

    /// Le code de sortie seul n'apprend rien : on cherche dans le journal
    /// les pannes qu'on sait nommer.
    fn _diagnostic(&self, code: i64) -> String {
        let fin = &self.journal[self.journal.len().saturating_sub(80)..];
        let texte = fin.join("\n");
        // 0xC0000135 : Windows n'a pas trouve une DLL, et le processus n'a rien pu ecrire.
        if texte.contains("DLL load failed") || texte.contains("error while loading shared libraries") || code == 0xC000_0135 {
            return "Les bibliotheques d'openEMS n'ont pas pu etre chargees. \
                Verifiez que le dossier openEMS/ contient bien les DLL \
                (CSXCAD.dll, openEMS.dll) et qu'il est a cote de l'outil.".into();
        }
        if texte.contains("MemoryError") || texte.contains("bad_alloc") {
            return "Memoire insuffisante pour ce maillage. Elargissez le pas \
                de maillage ou reduisez la bande vers le haut : le \
                nombre de cellules varie comme le cube de la frequence \
                maximale.".into();
        }
        if texte.contains("Mesh") && texte.to_lowercase().contains("invalid") {
            return "openEMS a refuse le maillage. Une ligne en double ou une \
                boite plus petite que la geometrie en sont les causes \
                habituelles.".into();
        }
        if code < 0 {
            return format!("Le solveur s'est arrete brutalement (signal {}). Une \
                geometrie degeneree — polygone d'aire nulle, port \
                d'epaisseur nulle — en est la cause la plus frequente.", -code);
        }
        // Une panne qu'on ne sait pas nommer se CITE : « voir le journal »
        // renvoie a un panneau qu'on n'a pas forcement ouvert. La derniere
        // ligne d'erreur, ou a defaut les dernieres lignes ecrites.
        let lignes: Vec<&str> = fin.iter().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
        let erreur = lignes.iter().rev().find(|l| {
            let bas = l.to_lowercase();
            motifs().erreur.is_match(l) || bas.starts_with("error") || bas.starts_with("erreur") || bas.starts_with("fatal")
        });
        let cite = match erreur {
            Some(l) => l.to_string(),
            None => lignes[lignes.len().saturating_sub(3)..].join(" / "),
        };
        if !cite.is_empty() {
            return format!("Le calcul s'est arrete (code {code}) : {}", cite.chars().take(400).collect::<String>());
        }
        format!("Le calcul s'est arrete (code {code}) sans rien ecrire au journal.")
    }

    /// Ce que ce calcul a appris du poste : sa vitesse.
    ///
    /// ELLE NE SE NOTE QU'A LA FIN, ET SEULEMENT SI LE CALCUL A ABOUTI. Une
    /// simulation arretee a la main ou tombee sur une erreur a souvent passe
    /// son temps ailleurs que dans la boucle FDTD, et sa vitesse moyenne ne
    /// dit rien du poste.
    ///
    /// LA PREMIERE LIGNE EST ECARTEE quand il y en a d'autres : le premier
    /// rapport d'openEMS compte le temps de montage du maillage avec les
    /// premiers pas de temps, et annonce donc une vitesse plus basse que le
    /// regime etabli. La mediane de ce qui reste va au modele, qui la range
    /// avec celles des calculs precedents.
    ///
    /// LE BANC, LUI, NE NOTE PAS DE DEBIT mais sa table entiere : une boite vide va
    /// bien plus vite qu'une antenne -- 182 MC/s contre 20 pour un patch sur le meme
    /// poste, a huit fils --, et la melanger aux vrais calculs ferait annoncer des
    /// durees d'antenne au rythme d'une boite vide. Seuls les RAPPORTS servent.
    fn _noter_debit(&self) {
        if let Genre::Banc(b) = &self.genre {
            modele::noter_banc(b.mesures.iter().copied());
            return;
        }
        let v = if self.vitesses.len() > 2 { &self.vitesses[1..] } else { &self.vitesses[..] };
        if v.is_empty() {
            return;
        }
        let mut t = v.to_vec();
        t.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let n = t.len();
        let med = if n % 2 == 1 { t[n / 2] } else { 0.5 * (t[n / 2 - 1] + t[n / 2]) };
        // AVEC LES FILS QUI L'ONT DONNEE : c'est ce qui permet de ramener
        // cette vitesse a un autre reglage (voir debit_suppose dans le modele).
        let fils = if self.avancement.fils != 0 { self.avancement.fils } else { self.modele["fils"].as_i64().unwrap_or(0) };
        modele::noter_debit(med, fils);
    }

    /// Ce que la page affiche : l'etat, l'avancement, les lignes nouvelles.
    fn vue(&self, id: &str, depuis: usize) -> Json {
        let total = self.journal.len();
        let depuis = depuis.min(total);
        let mut av = self.avancement.clone();
        let mut o = Objet::new();
        if let Genre::Suite(s) = &self.genre {
            if !s.points.is_empty() && s.courant > 0 {
                match self.etat {
                    "fini" => av.pourcent = 100.0,
                    "arrete" | "echoue" => av.restant_s = None,
                    _ => av.pourcent = (((s.courant - 1) as f64 + av.pourcent / 100.0) / s.points.len() as f64 * 100.0).clamp(0.0, 99.0),
                }
            }
        }
        o.insert("id".into(), id.into());
        o.insert("etat".into(), self.etat.into());
        o.insert("avancement".into(), av.json());
        o.insert("lignes".into(), Json::Liste(self.journal[depuis..].iter().map(|l| l.as_str().into()).collect()));
        o.insert("n".into(), total.into());
        o.insert("duree".into(), ((if self.fin != 0.0 { self.fin } else { maintenant() }) - self.debut).into());
        o.insert("detail".into(), self.detail.clone().into());
        o.insert("dossier".into(), self.dossier.to_string_lossy().into_owned().into());
        if self.etat == "fini" {
            o.insert("resultat".into(), self.resultat.clone());
        }
        match &self.genre {
            Genre::Simple => {}
            Genre::Suite(s) => {
                let mut v = obj! {
                    "nom" => s.bal["nom"].clone(), "unite" => s.bal["unite"].clone(), "croise" => s.bal["croise"].vrai(),
                    "nom2" => txt(&s.bal["nom2"]), "unite2" => txt(&s.bal["unite2"]),
                    "courant" => s.courant, "total" => s.points.len(),
                    // UN RESUME, ET NON LES COURBES. Cette vue est demandee toutes
                    // les deux secondes ; y mettre les quatre cents points de chaque
                    // courbe ferait passer des megaoctets par sondage, pour afficher
                    // une ligne de tableau. Les courbes partent une fois, a la fin,
                    // dans le resultat.
                    "points" => Json::Liste(s.points.iter().map(|p| obj! {
                        "n" => p.n, "etiquette" => p.etiquette.clone(), "valeur" => p.valeur, "valeur2" => p.valeur2.clone(),
                        "etat" => p.etat, "detail" => p.detail.clone(), "resume" => _resume(&p.resultat)}).collect()),
                };
                if let (true, Json::Objet(v)) = (s.clef == "tableau_s", &mut v) {
                    v.insert("ports".into(), s.ports.clone());
                }
                o.insert(s.clef.into(), v);
            }
            Genre::Banc(b) => {
                o.insert("genre".into(), "banc".into());
                o.insert("banc".into(), obj! {
                    "essais" => Json::Liste(b.essais.iter().map(|e| (*e).into()).collect()), "auto" => b.auto,
                    "mesures" => Json::Objet(b.mesures.iter().map(|(k, v)| (k.to_string(), (*v).into())).collect())});
            }
        }
        Json::Objet(o)
    }
}

/// La bande passante d'un resultat, quand ses deux bords y sont.
fn _bp(r: &Json) -> Json {
    if r["bp_f1"].vrai() && r["bp_f2"].vrai() { (f(&r["bp_f2"]) - f(&r["bp_f1"])).into() } else { Json::Nul }
}

/// Ce qu'on peut dire d'un resultat en cinq nombres. Sert au suivi d'un
/// balayage : la ligne de tableau apparait des que le point est fini, sans
/// attendre la fin de la serie.
fn _resume(r: &Json) -> Json {
    if !r.vrai() {
        return Json::Nul;
    }
    obj! {"f0" => r["f0"].clone(), "s11_min_db" => r["s11_min_db"].clone(), "z0_re" => r["z0_re"].clone(),
          "z0_im" => r["z0_im"].clone(), "bp" => _bp(r)}
}

/// Un nombre pour le journal, ou un tiret quand il n'y en a pas.
fn _chiffre(v: &Json, echelle: f64, dec: usize, unite: &str) -> String {
    match v.as_f64() {
        Some(x) => format!("{:.*} {unite}", dec, x / echelle),
        None => "—".into(),
    }
}

/// De combien S(i,j) et S(j,i) different, et ou.
///
/// POURQUOI CE CHIFFRE VAUT D'ETRE CALCULE. Une structure passive et sans
/// materiau gyrotrope est RECIPROQUE : S(i,j) = S(j,i), exactement, par la
/// physique. Les deux moities du tableau sortent pourtant de deux simulations
/// independantes, avec deux excitations differentes. Leur ecart ne mesure
/// donc pas l'antenne : il mesure ce que le calcul a perdu en route — un
/// maillage trop laches, une energie residuelle trop haute, une PML trop
/// proche. C'est la seule verification interne que ce tableau permette, et
/// elle est gratuite.
pub fn _reciprocite(s: &[Vec<Json>]) -> Json {
    let (mut pire, mut ou, mut ampl) = (0.0f64, String::new(), 0.0f64);
    for i in 0..s.len() {
        for j in i + 1..s.len() {
            let (a, b) = (&s[i][j], &s[j][i]);
            if !a.vrai() || !b.vrai() {
                continue;
            }
            let (ar, ai, br, bi) = (liste(&a["re"]), liste(&a["im"]), liste(&b["re"]), liste(&b["im"]));
            for x in 0..ar.len().min(ai.len()).min(br.len()).min(bi.len()) {
                let d = ((f(&ar[x]) - f(&br[x])).powi(2) + (f(&ai[x]) - f(&bi[x])).powi(2)).sqrt();
                ampl = ampl.max((f(&ar[x]).powi(2) + f(&ai[x]).powi(2)).sqrt());
                if d > pire {
                    pire = d;
                    ou = format!("S{}{} / S{}{}", i + 1, j + 1, j + 1, i + 1);
                }
            }
        }
    }
    obj! {"ecart" => pire, "ou" => ou, "amplitude" => ampl}
}

impl Tache {
    fn nouvelle(id: String, dossier: PathBuf, modele: Json, genre: Genre) -> Arc<Tache> {
        Arc::new(Tache {
            id,
            i: Mutex::new(Interne {
                dossier, modele, etat: "prepare", journal: Vec::new(), avancement: Avancement::default(), hist: Vec::new(),
                brute: Vec::new(), vitesses: Vec::new(), resultat: Json::Nul, detail: String::new(), debut: maintenant(), fin: 0.0, genre,
            }),
            proc: Mutex::new(None),
        })
    }

    fn i(&self) -> MutexGuard<'_, Interne> {
        verrou(&self.i)
    }

    fn ajouter(&self, ligne: &str) {
        self.i().ajouter(ligne);
    }

    pub fn vue(&self, depuis: usize) -> Json {
        self.i().vue(&self.id, depuis)
    }

    pub fn etat(&self) -> &'static str {
        self.i().etat
    }

    pub fn dossier(&self) -> PathBuf {
        self.i().dossier.clone()
    }

    /// Lance un executable dans `dossier` et attend sa fin. Sa sortie (les deux flux, dans
    /// l'ordre) va au journal, ou revient en texte quand `silencieux`. Rend le code de
    /// sortie : negatif pour un signal.
    fn executer(&self, programme: &Path, args: &[String], dossier: &Path, silencieux: bool) -> Result<(i64, String), String> {
        let (lecture, ecriture) = std::io::pipe().map_err(|e| e.to_string())?;
        let mut c = commande(programme, dossier);
        c.args(args).stdout(ecriture.try_clone().map_err(|e| e.to_string())?).stderr(ecriture);
        let enfant = c.spawn().map_err(|e| e.to_string())?;
        // La commande tient encore le bout « ecriture » du tube : tant qu'elle vit, la
        // lecture ne verrait jamais la fin.
        drop(c);
        *verrou(&self.proc) = Some(enfant);
        // ARRETE AVANT D'AVOIR UN PROCESSUS : `arreter()` n'a rien trouve a
        // tuer, et le calcul tournerait jusqu'au bout sans que personne le
        // suive. Le banc du demarrage, qui cede sa place au premier calcul
        // demande, peut tomber dans cette fenetre.
        if self.etat() == "arrete" {
            self.tuer();
        }
        let mut texte = String::new();
        let mut tube = BufReader::new(lecture);
        let mut octets = Vec::new();
        while tube.read_until(b'\n', &mut octets).map_err(|e| e.to_string())? > 0 {
            let ligne = String::from_utf8_lossy(&octets);
            if silencieux {
                texte.push_str(&ligne);
            } else {
                self.ajouter(&ligne);
            }
            octets.clear();
        }
        let statut = match verrou(&self.proc).take() {
            Some(mut e) => e.wait().map_err(|e| e.to_string())?,
            None => return Err("processus perdu".into()),
        };
        #[cfg(unix)]
        let signal = std::os::unix::process::ExitStatusExt::signal(&statut);
        #[cfg(not(unix))]
        let signal: Option<i32> = None;
        let code = match (signal, statut.code()) {
            (Some(s), _) => -(s as i64),
            // Windows rend les codes NTSTATUS en negatif : on les garde tels qu'il les ecrit.
            (None, Some(c)) => if cfg!(windows) { c as u32 as i64 } else { c as i64 },
            (None, None) => -1,
        };
        Ok((code, texte))
    }

    fn tuer(&self) -> bool {
        match verrou(&self.proc).as_mut() {
            Some(e) => {
                let _ = e.kill();
                true
            }
            None => false,
        }
    }

    /// Arreter un balayage, c'est arreter le point en cours ET ne pas lancer les suivants :
    /// l'etat « arrete » est lu par la suite avant chaque point.
    pub fn arreter(&self) -> bool {
        let suite = {
            let mut i = self.i();
            i.etat = "arrete";
            i.detail = "Arrete a la demande.".into();
            i.avancement.restant_s = None;
            matches!(i.genre, Genre::Suite(_))
        };
        self.tuer() || suite
    }

    /// Une simulation entiere dans `dossier` : le XML, le solveur, le depouillement, le
    /// champ lointain, resultats.json. C'est ce que faisait le script genere.
    fn simuler(&self, m: &Json, pieces: &[Piece], dossier: &Path) -> Result<Json, Echec> {
        let sim = xml::generer(m, pieces).map_err(|e| Echec::Detail(format!("{} {}", e.message, e.conseil).trim().to_string()))?;
        std::fs::write(dossier.join("antenne.xml"), &sim.xml)
            .map_err(|e| Echec::Detail(format!("Le fichier du solveur n'a pas pu etre ecrit : {e}")))?;
        let Some(programme) = executable("openEMS") else {
            return Err(Echec::Detail("Impossible de lancer le solveur : l'executable « openEMS » est introuvable.".into()));
        };
        // LES FILS DE CALCUL. Sans --numThreads, openEMS part d'UN fil et en ajoute tant que
        // la vitesse monte : le tatonnement s'arrete souvent a deux ou trois. Le banc de
        // vitesse mesure le bon nombre pour CE poste. -vvv : le journal complet, comme
        // `verbose=3` du script.
        // à vérifier sur un vrai openEMS : ces trois arguments (main.cpp et global.cpp de 0.0.36),
        // et que le journal arrive bien ligne a ligne par le tube.
        let mut args = vec!["antenne.xml".to_string()];
        let fils = m["fils"].as_i64().unwrap_or(0);
        if fils > 0 {
            args.push(format!("--numThreads={fils}"));
        }
        args.push("-vvv".into());
        let (code, _) = self.executer(&programme, &args, dossier, false)
            .map_err(|e| Echec::Detail(format!("Impossible de lancer le solveur : {e}")))?;
        if self.etat() == "arrete" {
            return Err(Echec::Arrete);
        }
        if code != 0 {
            return Err(Echec::Detail(self.i()._diagnostic(code)));
        }
        let r = self.depouiller(m, &sim.ports, &sim.nf2ff, dossier).map_err(Echec::Detail)?;
        if self.etat() == "arrete" {
            return Err(Echec::Arrete);
        }
        std::fs::write(dossier.join("resultats.json"), dumps(&r)).map_err(|e| Echec::Detail(format!("Resultats illisibles : {e}")))?;
        self.ajouter("resultats.json ecrit");
        Ok(r)
    }

    fn depouiller(&self, m: &Json, ports: &[PortMesure], plans: &[(String, String)], dossier: &Path) -> Result<Json, String> {
        let p = depouillement::depouiller_ports(m, ports, dossier)
            .map_err(|e| format!("Le calcul s'est termine sans resultats exploitables : {e}"))?;
        for l in &p.journal {
            // une ligne vide separait le tableau de la resonance ; le journal ne garde pas les vides
            self.ajouter(l);
        }
        let mut nf = None;
        if m["nf2ff"]["actif"].vrai() {
            // UN CHAMP LOINTAIN MANQUE NE DOIT PAS EMPORTER LE S11 : il se dit au journal, et
            // le resultat part sans diagramme.
            match self.champ_lointain(m, p.freq[p.i0], plans, dossier) {
                Ok(c) => {
                    let (p_inc, p_acc) = depouillement::puissances(m, ports, &p);
                    for l in depouillement::journal_nf2ff(&c, p_inc, p_acc) {
                        self.ajouter(&l);
                    }
                    nf = Some(c);
                }
                Err(e) => self.ajouter(&format!("Champ lointain indisponible : {e}")),
            }
        }
        Ok(depouillement::resultats(m, ports, &p, nf.as_ref()))
    }

    /// Le champ lointain a la resonance : le XML de nf2ff, son lancement, la lecture de son HDF5.
    fn champ_lointain(&self, m: &Json, frequence: f64, plans: &[(String, String)], dossier: &Path) -> Result<depouillement::ChampLointain, String> {
        let la: Vec<(String, String)> = plans.iter().filter(|(e, h)| dossier.join(e).is_file() && dossier.join(h).is_file()).cloned().collect();
        if la.is_empty() {
            return Err("openEMS n'a ecrit aucun plan nf2ff_E_*.h5 / nf2ff_H_*.h5.".into());
        }
        let programme = executable("nf2ff").ok_or("l'executable « nf2ff » est introuvable.")?;
        std::fs::write(dossier.join("nf2ff.xml"), depouillement::xml_nf2ff(m, frequence, &la)).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(dossier.join("nf2ff.h5"));
        // à vérifier sur un vrai openEMS : le code de sortie de nf2ff (0 quand tout s'est bien passe).
        let (code, _) = self.executer(&programme, &["nf2ff.xml".to_string()], dossier, false)?;
        if code != 0 {
            return Err(format!("nf2ff s'est arrete (code {code})."));
        }
        let n = |k: &str| liste(&m["nf2ff"][k]).len();
        depouillement::lire_nf2ff(&dossier.join("nf2ff.h5"), n("theta"), n("phi"))
    }

    fn echouer(&self, detail: String) {
        let mut i = self.i();
        if i.etat != "arrete" {
            i.etat = "echoue";
            i.detail = detail;
        }
        i.avancement.restant_s = None;
        i.fin = maintenant();
    }

    // -- une simulation seule ------------------------------------------------
    fn courir(&self, pieces: &[Piece]) {
        let (m, dossier) = {
            let i = self.i();
            (i.modele.clone(), i.dossier.clone())
        };
        let r = self.simuler(&m, pieces, &dossier);
        let mut i = self.i();
        i.fin = maintenant();
        i.avancement.restant_s = None;
        let mut r = match r {
            Ok(r) => r,
            Err(Echec::Arrete) => {
                i.detail = "Arrete a la demande.".into();
                return;
            }
            Err(Echec::Detail(d)) => {
                if i.etat != "arrete" {
                    i.etat = "echoue";
                    i.detail = d;
                }
                return;
            }
        };
        // UNE SIMULATION SEULE MERITE LE MEME DIAGNOSTIC QU'UN POINT DE
        // BALAYAGE. Elle est meme le cas le plus frequent : c'est par elle
        // qu'on commence, et c'est donc elle qui rend pour la premiere fois un
        // panneau de resultats entierement vide.
        if r["s11_min_db"] == Json::Nul {
            if let Some(d) = i.diagnostic_energie() {
                if let Json::Objet(o) = &mut r {
                    o.insert("diagnostic".into(), d.clone().into());
                }
                i.detail = d.clone();
                i.ajouter("Aucune grandeur exploitable : la simulation n'a rien rendu de fini.");
                i.ajouter(&d);
            }
        }
        i.resultat = r;
        i.avancement.pourcent = 100.0;
        i.avancement.restant_s = Some(0.0);
        i.etat = "fini"; // en dernier : le resultat est complet
        i._noter_debit();
    }

    // -- une suite : UNE SEULE SIMULATION A LA FOIS, ET C'EST DELIBERE ---------
    // Chaque point demande la memoire d'un maillage complet ; deux en parallele ne
    // vont pas deux fois plus vite sur un poste dont la barre est la bande passante
    // memoire, et trois font tomber la machine dans le fichier d'echange. La
    // sequence, elle, laisse aussi le premier resultat arriver tot : on voit le sens
    // de la variation avant la fin, et on peut arreter des qu'il est clair.
    //
    // CE QUI EST VERIFIE L'EST AVANT, PAS PENDANT. Les modeles des N points sont
    // tous normalises — et donc tous refusables — avant que le premier ne parte.
    fn courir_tout(&self) {
        let n = match &self.i().genre {
            Genre::Suite(s) => s.points.len(),
            _ => return,
        };
        for k in 0..n {
            if self.etat() == "arrete" {
                break;
            }
            let (m, pieces, dossier, etiquette, nom, unite) = {
                let mut i = self.i();
                let Genre::Suite(s) = &mut i.genre else { return };
                s.courant = k + 1;
                s.points[k].etat = "calcule";
                let (m, pieces) = s.modeles[k].clone();
                let r = (m.clone(), pieces, s.points[k].dossier.clone(), s.points[k].etiquette.clone(),
                         txt(&s.bal["nom"]).to_string(), txt(&s.bal["unite"]).to_string());
                // Le pourcentage d'avancement se lit sur le modele EN COURS : les
                // points n'ont pas tous le meme nombre de pas de temps.
                i.modele = m;
                i.avancement = Avancement { point: Some((k + 1, n)), ..Avancement::default() };
                i._repartir_energie();
                i.ajouter(&format!("=== point {}/{} — {} = {} {} ===", k + 1, n, r.4, r.3, r.5));
                r
            };
            // UN POINT QUI TOURNE MAL NE DOIT PAS EMPORTER LA SUITE : une suite de N
            // simulations doit survivre a chacune d'elles.
            let r = std::fs::create_dir_all(&dossier).map_err(|e| Echec::Detail(format!("Le dossier du point n'a pas pu etre cree : {e}")))
                .and_then(|_| self.simuler(&m, &pieces, &dossier));
            let mut i = self.i();
            let diag = i.diagnostic_energie();
            let mut lignes = Vec::new();
            {
                let Genre::Suite(s) = &mut i.genre else { return };
                let pt = &mut s.points[k];
                match r {
                    Err(Echec::Arrete) => {
                        pt.etat = "echoue";
                        pt.detail = "Arrete a la demande.".into();
                    }
                    Err(Echec::Detail(d)) => {
                        pt.etat = "echoue";
                        pt.detail = d;
                        lignes.push(format!("  … point {} : {}", pt.etiquette, pt.detail));
                    }
                    Ok(mut r) => {
                        pt.etat = "fini";
                        // UN RESULTAT PEUT NE PAS AVOIR DE CHIFFRES. Le depouillement remplace
                        // par `null` toute grandeur qui n'est pas un nombre fini, et une
                        // simulation qui a diverge les rend TOUTES nulles. La ligne de journal
                        // doit le dire, pas s'y casser.
                        lignes.push(format!("  → {nom} = {etiquette} {unite} : resonance {}, S11 {}", _chiffre(&r["f0"], 1e9, 4, "GHz"),
                                            _chiffre(&r["s11_min_db"], 1.0, 2, "dB")));
                        if r["s11_min_db"] == Json::Nul {
                            lignes.push("     (aucune grandeur exploitable : la simulation n'a rien rendu de fini.)".into());
                            // ET POURQUOI. La courbe d'energie de CE point vient d'etre lue
                            // pas a pas ; la nommer ici epargne de relire quatre mille lignes.
                            if let Some(d) = diag {
                                if let Json::Objet(o) = &mut r {
                                    o.insert("diagnostic".into(), d.clone().into());
                                }
                                pt.detail = d.clone();
                                lignes.push(format!("     {d}"));
                            }
                        }
                        pt.resultat = r;
                    }
                }
            }
            for l in lignes {
                i.ajouter(&l);
            }
        }

        let mut i = self.i();
        i.fin = maintenant();
        let Genre::Suite(s) = &i.genre else { return };
        let (courant, total) = (s.courant, s.points.len());
        if i.etat == "arrete" {
            i.detail = format!("Arrete a la demande apres {courant} point{} sur {total}.", if courant < 2 { "" } else { "s" });
            return;
        }
        let finis: Vec<&Point> = s.points.iter().filter(|p| p.etat == "fini").collect();
        if finis.is_empty() {
            i.etat = "echoue";
            i.detail = "Aucun point n'a abouti. Le journal ci-dessous dit ou le premier s'est arrete.".into();
            return;
        }
        // UN POINT RATE N'EFFACE PAS LES AUTRES. Une geometrie degeneree au
        // milieu d'une plage est une information en soi — et les courbes deja
        // obtenues valent ce qu'elles valent, c'est-a-dire beaucoup.
        // LE RESULTAT D'ABORD, L'ETAT ENSUITE : la page cesse de sonder des
        // qu'elle lit « fini », et lirait alors un resultat encore vide.
        let n_finis = finis.len();
        let resultat = if s.clef == "tableau_s" { _assembler_tableau(s, &finis) } else { _assembler(s, &finis) };
        // UNE SUITE APPREND AUTANT DU POSTE QU'UNE SIMULATION SEULE, et meme
        // davantage : elle a tourne N fois. Les vitesses de tous les points
        // sont dans le meme sac, et c'est leur mediane qui part au modele.
        i._noter_debit();
        if n_finis < total {
            i.detail = format!("{n_finis} point{} sur {total} ont abouti ; les autres sont marques dans la liste, avec leur raison.",
                               if n_finis < 2 { "" } else { "s" });
        }
        i.resultat = resultat;
        i.etat = "fini";
    }

    // -- le banc de vitesse --------------------------------------------------
    fn courir_banc(&self) {
        let (dossier, essais) = {
            let i = self.i();
            let Genre::Banc(b) = &i.genre else { return };
            (i.dossier.clone(), b.essais.clone())
        };
        let programme = executable("openEMS");
        if let Err(e) = std::fs::write(dossier.join("banc.xml"), xml::generer_banc()) {
            return self.echouer(format!("Le fichier du banc n'a pas pu etre ecrit : {e}"));
        }
        for n in essais {
            if self.etat() == "arrete" {
                break;
            }
            // UN PROCESSUS ET UN DOSSIER PAR ESSAI, vide a chaque fois.
            let d = dossier.join(format!("fils_{n}"));
            let _ = std::fs::remove_dir_all(&d);
            let r = std::fs::create_dir_all(&d).map_err(|e| e.to_string()).and_then(|_| {
                let p = programme.as_ref().ok_or("l'executable « openEMS » est introuvable")?;
                self.executer(p, &["../banc.xml".to_string(), format!("--numThreads={n}"), "-v".to_string()], &d, true)
            });
            let _ = std::fs::remove_dir_all(&d);
            if self.etat() == "arrete" {
                break;
            }
            let vitesse = r.as_ref().ok().filter(|(code, _)| *code == 0)
                .and_then(|(_, t)| motifs().fin.captures_iter(t).last().and_then(|m| m[1].parse::<f64>().ok()));
            match vitesse {
                Some(v) => self.ajouter(&format!("Banc : {n} fil(s) -> {v:.1} MCells/s")),
                None => {
                    self.ajouter(&format!("Banc : {n} fil(s) -> echec"));
                    let texte = match &r {
                        Ok((_, t)) => t.clone(),
                        Err(e) => e.clone(),
                    };
                    let fin: String = texte.chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect();
                    for l in fin.lines() {
                        self.ajouter(l);
                    }
                }
            }
        }
        let mut i = self.i();
        i.fin = maintenant();
        i.avancement.restant_s = None;
        if i.etat == "arrete" {
            return;
        }
        let Genre::Banc(b) = &i.genre else { return };
        if b.mesures.is_empty() {
            i.ajouter("Aucun essai n'a abouti.");
            i.etat = "echoue";
            i.detail = i._diagnostic(1);
            return;
        }
        let [nx, ny, nz] = xml::BANC_LIGNES;
        let r = obj! {"banc" => Json::Objet(b.mesures.iter().map(|(k, v)| (k.to_string(), (*v).into())).collect()),
                      "cellules" => nx * ny * nz, "pas" => xml::BANC_PAS};
        let _ = std::fs::write(i.dossier.join("resultats.json"), dumps(&r));
        i.resultat = r;
        i.avancement.pourcent = 100.0;
        i.avancement.restant_s = Some(0.0);
        i.etat = "fini";
        i._noter_debit();
    }
}

/// Le resultat du balayage : la famille de courbes, et le tableau qui
/// se lit d'un coup d'oeil — une ligne par point, la resonance, le S11
/// minimal, la bande. C'est ce tableau qui repond a la seule question
/// qu'on se pose vraiment : de quel cote faut-il aller, et de combien.
///
/// Le PREMIER point sert aussi de resultat « ordinaire », pour que les
/// courbes, les exports et le diagramme marchent sans rien savoir du
/// balayage.
fn _assembler(s: &SuiteEnCours, finis: &[&Point]) -> Json {
    let lignes: Vec<Json> = finis.iter().map(|p| {
        let r = &p.resultat;
        obj! {"n" => p.n, "etiquette" => p.etiquette.clone(), "valeur" => p.valeur, "valeur2" => p.valeur2.clone(),
              "f0" => r["f0"].clone(), "s11_min_db" => r["s11_min_db"].clone(), "z0_re" => r["z0_re"].clone(),
              "z0_im" => r["z0_im"].clone(), "bp" => _bp(r), "bp_bord" => r["bp_bord"].clone(),
              "rendement" => r["nf2ff"]["rendement"].clone(), "gain_dbi" => r["nf2ff"]["gain_dbi"].clone()}
    }).collect();
    // LA SENSIBILITE, ET NON LE MEILLEUR POINT. « 0,42 MHz par centieme de
    // millimetre » dit combien la cote doit etre tenue en fabrication ;
    // « le meilleur est 38,4 » ne le dit pas, et c'est pourtant la seule
    // des deux qui survive au prochain lot de stratifie.
    //
    // SUR UN CROISEMENT, CETTE PENTE N'EN EST PAS UNE. Du premier au
    // dernier point, DEUX cotes ont change : le rapport rendrait un nombre
    // de MHz par millimetre qui ne dirait de quelle cote, et personne ne
    // peut le deviner en le lisant. On ne le calcule donc pas — un chiffre
    // absent se voit, un chiffre faux non.
    let croise = s.bal["croise"].vrai();
    let mut pente = Json::Nul;
    if lignes.len() >= 2 && !croise {
        let (a0, a1) = (&lignes[0], &lignes[lignes.len() - 1]);
        let dv = f(&a1["valeur"]) - f(&a0["valeur"]);
        if dv != 0.0 && a0["f0"].vrai() && a1["f0"].vrai() {
            pente = ((f(&a1["f0"]) - f(&a0["f0"])) / dv).into();
        }
    }
    obj! {
        "balayage" => true, "nom" => s.bal["nom"].clone(), "unite" => s.bal["unite"].clone(), "croise" => croise,
        "nom2" => txt(&s.bal["nom2"]), "unite2" => txt(&s.bal["unite2"]),
        "lignes" => Json::Liste(lignes), "pente_hz_par_unite" => pente,
        // LES RESULTATS COMPLETS, POINT PAR POINT. Ils partent une seule
        // fois, quand tout est fini : l'impedance et le diagramme du point
        // 38,4 mm valent autant que sa courbe de S11, et les jeter
        // obligerait a relancer la simulation pour les revoir.
        "points" => Json::Liste(finis.iter().map(|p| obj! {"etiquette" => p.etiquette.clone(), "valeur" => p.valeur,
                                                            "valeur2" => p.valeur2.clone(), "resultat" => p.resultat.clone()}).collect()),
        "premier" => finis[0].resultat.clone(),
    }
}

/// Les colonnes rangees ensemble : S[i][j], i recoit, j excite.
///
/// CE QUE CHAQUE COLONNE APPORTE. Le port j excite rend S(j,j) — c'est le
/// « s11 » de son resultat, qui porte ce nom parce qu'il est la reflexion du
/// port qui emet — et S(i,j) pour chaque autre port i, dans ses couplages.
///
/// UNE COLONNE MANQUANTE RESTE MANQUANTE. Si la simulation du port 2 n'a
/// pas abouti, sa colonne vaut `null` et la page le dit — la remplir de
/// zeros produirait un tableau que tous les outils liraient sans broncher
/// et dont un quart serait invente.
fn _assembler_tableau(s: &SuiteEnCours, finis: &[&Point]) -> Json {
    let n = liste(&s.ports).len();
    let r0 = &finis[0].resultat;
    let ou_vide = |v: &Json| if v.vrai() { v.clone() } else { Json::Liste(Vec::new()) };
    let mut t = vec![vec![Json::Nul; n]; n];
    for pt in finis {
        let r = &pt.resultat;
        let j = pt.valeur.round() as i64 - 1; // le port excite, 0-indexe
        if j < 0 || j as usize >= n {
            continue;
        }
        let j = j as usize;
        t[j][j] = obj! {"re" => ou_vide(&r["s11_re"]), "im" => ou_vide(&r["s11_im"])};
        for (clef, c) in r["couplages"].as_objet().into_iter().flatten() {
            if let Ok(i) = clef.parse::<usize>() {
                if (1..=n).contains(&i) && i - 1 != j {
                    t[i - 1][j] = obj! {"re" => ou_vide(&c["re"]), "im" => ou_vide(&c["im"])};
                }
            }
        }
    }
    obj! {
        "tableau_s" => true, "ports" => s.ports.clone(), "f" => ou_vide(&r0["f"]),
        "s" => Json::Liste(t.iter().map(|l| Json::Liste(l.clone())).collect()),
        // LE RESULTAT COMPLET DE CHAQUE COLONNE VOYAGE AVEC ELLE, et c'est
        // le diagramme de rayonnement qui l'exige. Deux antennes couplees
        // ne rayonnent pas de la meme facon selon celle qui emet : le
        // champ lointain de la colonne 2 n'est pas celui de la colonne 1,
        // et c'est meme toute la question quand on pose deux ports. Une
        // colonne qui n'a pas abouti porte `null` : c'est la meme regle que
        // ses cases du tableau.
        "colonnes" => Json::Liste(s.points.iter().map(|p| obj! {"n" => p.valeur.round() as i64, "etat" => p.etat,
                                                                 "detail" => p.detail.clone(), "resultat" => p.resultat.clone()}).collect()),
        "reciprocite" => _reciprocite(&t),
        // Le premier resultat sert de resultat « ordinaire » : les courbes,
        // le diagramme et les exports d'une simulation seule continuent de
        // marcher sans rien savoir du tableau.
        "premier" => r0.clone(),
    }
}

/// Les nombres de fils que le banc essaie sur ce poste.
///
/// PAS TOUS : de un a trente-deux fils, cela ferait trente-deux essais pour
/// une courbe qui plafonne vers quatre ou huit. On prend les paliers
/// usuels, et le nombre de coeurs logiques en dernier -- c'est lui qu'on
/// serait tente de mettre, et c'est lui qu'il faut avoir mesure pour le
/// deconseiller.
pub fn fils_a_essayer(coeurs: Option<usize>) -> Vec<i64> {
    let n = coeurs.filter(|n| *n > 0).or_else(|| std::thread::available_parallelism().ok().map(|n| n.get())).unwrap_or(4) as i64;
    let mut v: Vec<i64> = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64].into_iter().filter(|p| *p < n).collect();
    v.push(n);
    v
}

// ==========================================================================
// Le registre des taches
// ==========================================================================
static TACHES: Mutex<Vec<Arc<Tache>>> = Mutex::new(Vec::new());

fn tache(ident: &str) -> Option<Arc<Tache>> {
    verrou(&TACHES).iter().find(|t| t.id == ident).cloned()
}

fn _oublier_les_vieilles() {
    let limite = maintenant() - DUREE_MEMOIRE;
    verrou(&TACHES).retain(|t| {
        let i = t.i();
        // `fin` nul : une tache arretee dont le processus n'a pas encore rendu la main
        !(matches!(i.etat, "fini" | "echoue" | "arrete") && i.fin != 0.0 && i.fin < limite)
    });
}

/// Oublie toutes les taches. Les essais s'en servent ; rien d'autre.
pub fn nettoyer() {
    verrou(&TACHES).clear();
}

// OU LES CALCULS ECRIVENT. Par defaut le dossier temporaire du systeme :
// c'est le bon endroit pour un essai qu'on ne gardera pas, et le nettoyage de
// disque de Windows s'en charge. Des qu'un PROJET est ouvert, en revanche, ils
// doivent aller dedans — un enregistrement de champ fait des centaines de
// mega-octets de .vtr que la visionneuse relit, et les laisser dans TEMP revient a
// les perdre au premier nettoyage, sans que rien ne l'annonce.
//
// Le chemin est POSE PAR LE SERVEUR (voir projet.dossier_calculs) et jamais
// lu d'une requete : ce module ne sait pas ce qu'est un projet, il sait
// seulement ou ecrire.
static RACINE_CALCULS: Mutex<String> = Mutex::new(String::new());

/// Ou creer les dossiers de calcul. "" remet le dossier temporaire.
pub fn definir_racine_calculs(chemin: &str) -> String {
    *verrou(&RACINE_CALCULS) = chemin.to_string();
    chemin.to_string()
}

fn _base_temporaire() -> PathBuf {
    std::env::temp_dir().join("openems_antenne")
}

/// Cree la base temporaire, a soi seul. /tmp est partage et le nom est connu : un autre
/// compte qui l'aurait posee avant nous (dossier a lui, ou lien) recevrait nos calculs.
#[cfg(unix)]
pub fn _exiger_base_sure(base: &Path) -> Res<()> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
    let _ = std::fs::DirBuilder::new().mode(0o700).create(base);
    let sure = std::fs::symlink_metadata(base).is_ok_and(|m| m.is_dir() && m.uid() == unsafe { libc::geteuid() })
        && std::fs::set_permissions(base, std::fs::Permissions::from_mode(0o700)).is_ok();
    if !sure {
        return Err(refus(format!("Le dossier temporaire des calculs n'est pas sur : {}", base.display()),
                         "C'est un lien symbolique, ou il appartient a un autre compte. Supprimez-le, ou ouvrez un projet : les calculs iront dedans."));
    }
    Ok(())
}

#[cfg(not(unix))]
pub fn _exiger_base_sure(_: &Path) -> Res<()> {
    Ok(())
}

/// La base du moment. Un projet devenu inaccessible — cle USB retiree,
/// lecteur reseau tombe — ne doit pas empecher de lancer : on retombe sur
/// le dossier temporaire, ce que le journal de la tache dit ligne 1 en
/// annoncant son dossier de calcul.
fn _base_calculs() -> PathBuf {
    let racine = verrou(&RACINE_CALCULS).clone();
    if !racine.is_empty() && std::fs::create_dir_all(&racine).is_ok() {
        return PathBuf::from(racine);
    }
    _base_temporaire()
}

/// Un identifiant de calcul neuf : douze chiffres hexadecimaux.
///
/// LA FORME D'UN IDENTIFIANT APPARTIENT A CE MODULE, et a lui seul : c'est
/// lui qui la fabrique ici, et c'est lui qui la reconnait dans `_est_ident`
/// pour retrouver un dossier apres un redemarrage. Un dossier de calcul
/// IMPORTE doit porter la meme forme que les autres, sans quoi il serait le
/// seul a ne pas se retrouver — d'ou cette fonction publique, que le serveur
/// appelle pour le compte du projet, lequel ne sait toujours pas
/// qu'openEMS existe.
pub fn identifiant_neuf() -> String {
    use std::hash::{BuildHasher, Hasher};
    static COMPTEUR: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    // Le hasard du systeme, par la graine que la bibliotheque standard tire pour ses tables.
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u64(COMPTEUR.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    format!("{:012x}", h.finish() & 0xFFFF_FFFF_FFFF)
}

fn _est_ident(ident: &str) -> bool {
    ident.len() == 12 && ident.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

/// Un dossier de calcul vierge, et son identifiant.
pub fn _dossier_neuf() -> Res<(String, PathBuf)> {
    let ident = identifiant_neuf();
    let base = _base_calculs();
    if base == _base_temporaire() {
        _exiger_base_sure(&base)?;
    }
    let dossier = base.join(&ident);
    std::fs::create_dir_all(&dossier).map_err(|e| refus(format!("Le dossier de calcul n'a pas pu etre cree : {e}"), ""))?;
    Ok((ident, dossier))
}

fn _exiger_solveur() -> Res<()> {
    let e = etat(false);
    if !e["dispo"].vrai() {
        return Err(refus(format!("openEMS n'est pas utilisable sur ce poste : {}", e["detail"].as_str().unwrap_or("raison inconnue")),
                         txt(&e["conseil"])));
    }
    Ok(())
}

/// Combien de taches calculent ensemble, au plus (un balayage compte pour une).
const MAX_SIMULTANES: usize = 2;

/// La tache qui calcule en ce moment, ou None.
fn _en_cours() -> Option<Arc<Tache>> {
    verrou(&TACHES).iter().find(|t| matches!(t.etat(), "prepare" | "calcule")).cloned()
}

/// Refuse de superposer un banc et un calcul.
///
/// UN BANC MESURE LE POSTE, ET UN POSTE OCCUPE SE MESURE MAL. Lance pendant
/// une simulation, il partagerait la memoire avec elle et trouverait un
/// optimum qui n'est pas le bon ; une simulation lancee pendant le banc
/// fausserait tous les essais qui restent. Deux simulations ensemble, en
/// revanche, restent permises comme avant : c'est un choix de l'utilisateur.
/// Pas davantage : chaque solveur prend sa memoire et ses fils, et un client
/// qui en lancerait sans compter mettrait le poste a genoux.
fn _exiger_libre(pour_banc: bool) -> Res<()> {
    let Some(t) = _en_cours() else { return Ok(()) };
    let banc = match &t.i().genre {
        Genre::Banc(b) => Some(b.auto),
        _ => None,
    };
    if pour_banc && banc.is_some() {
        return Err(refus("Le banc de vitesse tourne deja.", "Il dure une a deux minutes : ses mesures s'afficheront a la fin."));
    }
    if pour_banc {
        return Err(refus("Un calcul tourne deja : le banc de vitesse le mesurerait en meme temps que le poste.",
                         "Attendez la fin du calcul, ou arretez-le, puis relancez le banc."));
    }
    // LE BANC DU DEMARRAGE CEDE SA PLACE. Personne ne l'a demande : refuser
    // pour lui le premier calcul de la seance ferait attendre deux minutes
    // pour un chronometrage. Il s'arrete, le banc precedent reste en vigueur,
    // et il repassera au prochain demarrage.
    match banc {
        Some(true) => {
            t.arreter();
            t.i().detail = "Interrompu pour laisser passer une simulation : les mesures precedentes restent en vigueur.".into();
            Ok(())
        }
        Some(false) => Err(refus("Le banc de vitesse tourne : une simulation lancee maintenant fausserait ses mesures.",
                                 "Il dure une a deux minutes. Attendez sa fin, ou arretez-le.")),
        None if verrou(&TACHES).iter().filter(|t| matches!(t.etat(), "prepare" | "calcule")).count() >= MAX_SIMULTANES => {
            Err(refus(format!("{MAX_SIMULTANES} calculs tournent deja : le poste n'en mene pas davantage a la fois."),
                      "Attendez la fin de l'un d'eux, ou arretez-le, puis relancez."))
        }
        None => Ok(()),
    }
}

fn _inscrire(t: &Arc<Tache>, entete: &[String]) {
    {
        let mut i = t.i();
        for l in entete {
            i.ajouter(l);
        }
        i.ajouter(&format!("Solveur : {}", executable("openEMS").map(|p| p.display().to_string()).unwrap_or_default()));
        let d = format!("Dossier de calcul : {}", i.dossier.display());
        i.ajouter(&d);
        i.etat = "calcule";
    }
    verrou(&TACHES).push(t.clone());
}

/// Demarre une simulation. Rend la vue initiale de la tache.
pub fn lancer(modele: Modele) -> Res<Json> {
    _exiger_solveur()?;
    _exiger_libre(false)?;
    _oublier_les_vieilles();
    // Ce que le solveur ne pourrait pas lire se refuse ICI, avant de creer quoi que ce soit.
    xml::generer(&modele.m, &modele.pieces)?;
    let (ident, dossier) = _dossier_neuf()?;
    let t = Tache::nouvelle(ident, dossier.clone(), modele.m, Genre::Simple);
    _inscrire(&t, &[format!("Fichier du solveur : {}", dossier.join("antenne.xml").display())]);
    let (t2, pieces) = (t.clone(), modele.pieces);
    std::thread::spawn(move || t2.courir(&pieces));
    Ok(t.vue(0))
}

fn _lancer_suite(clef: &'static str, bal: Json, modeles: Vec<(Json, Vec<Piece>)>, points: Vec<(String, f64, Json)>, ports: Json, entete: String) -> Res<Json> {
    _exiger_solveur()?;
    _exiger_libre(false)?;
    _oublier_les_vieilles();
    let Some(premier) = modeles.first().map(|m| m.0.clone()) else {
        return Err(refus("Aucun point a calculer.", ""));
    };
    let (ident, dossier) = _dossier_neuf()?;
    let points = points.into_iter().enumerate().map(|(i, (etiquette, valeur, valeur2))| Point {
        n: i + 1, etiquette, valeur, valeur2, etat: "attend", resultat: Json::Nul, detail: String::new(),
        dossier: dossier.join(format!("p{:02}", i + 1)),
    }).collect();
    let t = Tache::nouvelle(ident, dossier, premier, Genre::Suite(Box::new(SuiteEnCours { clef, bal, modeles, points, courant: 0, ports })));
    _inscrire(&t, &[entete]);
    let t2 = t.clone();
    std::thread::spawn(move || t2.courir_tout());
    Ok(t.vue(0))
}

/// Demarre un balayage : N simulations a la suite, une par valeur.
///
/// Le balayage arrive DEJA VERIFIE — `modele::balayage()` a normalise
/// les N modeles, et refuse l'ensemble si l'un d'eux ne tient pas debout.
/// Ici on ne fait plus que les faire tourner.
pub fn lancer_balayage(bal: Suite) -> Res<Json> {
    let pts = liste(&bal.json["points"]);
    let points: Vec<(String, f64, Json)> = pts.iter().map(|p| (txt(&p["etiquette"]).to_string(), f(&p["valeur"]), p["valeur2"].clone())).collect();
    let modeles: Vec<(Json, Vec<Piece>)> = pts.iter().map(|p| p["modele"].clone()).zip(bal.pieces.clone()).collect();
    let entete = match (points.first(), points.last()) {
        (Some(a), Some(z)) => format!("Balayage de « {} » : {} points, de {} a {} {}", txt(&bal.json["nom"]), points.len(), a.0, z.0,
                                      txt(&bal.json["unite"])),
        _ => String::new(),
    };
    _lancer_suite("balayage", bal.json.clone(), modeles, points, Json::Nul, entete)
}

/// Demarre un tableau S complet : une simulation par port excite.
///
/// C'EST LA MEME SUITE QUE LE BALAYAGE, ET C'EST VOULU. Un tableau S est
/// N simulations a la suite dont on assemble les resultats ; un balayage
/// aussi. Tout ce qui a ete ecrit pour l'un — la sequence, le journal,
/// l'arret qui n'enchaine pas sur le point suivant, le point rate qui
/// n'efface pas les autres — vaut ici sans etre recopie. Ne changent que
/// l'etiquette des points et ce qu'on en fait a la fin.
pub fn lancer_tableau_s(ts: Suite) -> Res<Json> {
    let cols = liste(&ts.json["colonnes"]);
    let points: Vec<(String, f64, Json)> = cols.iter().map(|c| {
        let n = c["n"].as_i64().unwrap_or(0);
        (format!("port {n}"), n as f64, Json::Nul)
    }).collect();
    let modeles: Vec<(Json, Vec<Piece>)> = cols.iter().map(|c| c["modele"].clone()).zip(ts.pieces.clone()).collect();
    let entete = format!("Tableau S complet : {} simulations, l'excitation deplacee d'un port a l'autre", points.len());
    _lancer_suite("tableau_s", obj! {"nom" => "port excite", "unite" => ""}, modeles, points, ts.json["ports"].clone(), entete)
}

/// La vue du banc qui tourne, ou Nul. La page s'en sert pour suivre le
/// banc du demarrage, qu'elle n'a pas lance elle-meme.
pub fn banc_en_cours() -> Json {
    match _en_cours() {
        Some(t) if matches!(t.i().genre, Genre::Banc(_)) => t.vue(0),
        _ => Json::Nul,
    }
}

/// Demarre le banc de vitesse. Rend la vue initiale de la tache.
///
/// `auto` : lance par le serveur a son demarrage. Il cede alors la place a
/// toute simulation demandee pendant qu'il tourne.
pub fn lancer_banc(auto: bool) -> Res<Json> {
    _exiger_solveur()?;
    _exiger_libre(true)?;
    _oublier_les_vieilles();
    let ident = identifiant_neuf();
    // DANS LE DOSSIER TEMPORAIRE, jamais dans le projet : ce ne sont pas des
    // calculs de l'antenne, et ils n'ont rien a faire dans sa liste.
    _exiger_base_sure(&_base_temporaire())?;
    let dossier = _base_temporaire().join(format!("banc_{ident}"));
    std::fs::create_dir_all(&dossier).map_err(|e| refus(format!("Le dossier du banc n'a pas pu etre cree : {e}"), ""))?;
    let essais = fils_a_essayer(None);
    let t = Tache::nouvelle(ident, dossier.clone(), obj! {}, Genre::Banc(Banc { essais, mesures: Vec::new(), faits: 0, auto }));
    _inscrire(&t, &[format!("Fichier du solveur : {}", dossier.join("banc.xml").display())]);
    let t2 = t.clone();
    std::thread::spawn(move || t2.courir_banc());
    Ok(t.vue(0))
}

pub fn journal(ident: &str, depuis: usize) -> Res<Json> {
    match tache(ident) {
        Some(t) => Ok(t.vue(depuis)),
        None => Err(refus(format!("Cette simulation n'existe plus ({ident})."),
                          "Le serveur oublie les taches terminees au bout de douze heures, \
                           et toutes lorsqu'il redemarre. Les fichiers de calcul, eux, \
                           restent sur le disque.")),
    }
}

pub fn arreter(ident: &str) -> Res<Json> {
    let t = tache(ident).ok_or_else(|| refus("Cette simulation n'existe plus.", ""))?;
    let arrete = t.arreter();
    Ok(obj! {"arrete" => arrete, "etat" => t.etat()})
}

/// Le dossier de calcul d'une tache, resolu et verifie : la seule porte par laquelle un
/// identifiant venu d'une requete devient un chemin. On n'ouvre que ce qu'on a cree
/// soi-meme : une route qui ouvre un chemin venu de la requete ouvrirait n'importe quel
/// dossier du poste.
///
/// LA LISTE DES TACHES NE SURVIT PAS AU SERVEUR, LES DOSSIERS SI. Le registre est en
/// memoire : redemarrer le serveur le vide, et la page restee ouverte garde pourtant
/// l'identifiant de son calcul. Refuser alors par « cette simulation n'existe plus »
/// serait faux deux fois — elle existe, ses fichiers sont la. On retombe donc sur le
/// dossier, a deux conditions qui ferment la porte a tout le reste : l'identifiant a
/// EXACTEMENT la forme que `identifiant_neuf` fabrique, et le dossier est sous une base
/// que nous seuls remplissons.
pub fn dossier_de(ident: &str) -> Res<PathBuf> {
    if let Some(t) = tache(ident) {
        let d = t.dossier();
        if !d.is_dir() {
            return Err(refus(format!("Le dossier de calcul a disparu : {}", d.display()), ""));
        }
        return Ok(d);
    }
    // DEUX BASES A REGARDER, ET NON UNE : le dossier temporaire, et celui du
    // projet ouvert. Une page rouverte sur un projet d'hier tient l'identifiant
    // d'un calcul qui est sous ce projet-la, et le chercher dans TEMP seul
    // ferait repondre « cette simulation n'existe plus » sur des fichiers
    // parfaitement presents.
    if _est_ident(ident) {
        for base in [_base_calculs(), _base_temporaire()] {
            let d = base.join(ident);
            if d.is_dir() {
                return Ok(d);
            }
        }
    }
    Err(refus(format!("Cette simulation n'existe plus ({ident})."), "Ses fichiers ont ete effaces, ou le dossier temporaire a ete vide."))
}

/// Ce que pese un dossier de calcul, pour l'annoncer avant et apres.
fn _poids_dossier(dossier: &Path) -> u64 {
    let Ok(entrees) = std::fs::read_dir(dossier) else { return 0 };
    entrees.flatten().map(|e| match e.file_type() {
        Ok(t) if t.is_dir() => _poids_dossier(&e.path()),
        Ok(t) if t.is_file() => e.metadata().map(|m| m.len()).unwrap_or(0),
        _ => 0,
    }).sum()
}

fn _copier(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(destination)?;
    for e in std::fs::read_dir(source)? {
        let e = e?;
        let cible = destination.join(e.file_name());
        if e.file_type()?.is_dir() {
            _copier(&e.path(), &cible)?;
        } else {
            std::fs::copy(e.path(), &cible)?;
        }
    }
    Ok(())
}

fn _reel(p: &Path) -> PathBuf {
    let reel = p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    // Sous Windows, canonicalize rend « \\?\C:\... » : la page afficherait ce prefixe, et le
    // chemin ne serait plus celui que rend le projet pour le meme dossier.
    #[cfg(windows)]
    {
        let t = reel.to_string_lossy();
        if let Some(unc) = t.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{}", unc));
        }
        if let Some(reste) = t.strip_prefix(r"\\?\") {
            return PathBuf::from(reste.to_string());
        }
    }
    reel
}

/// Range le dossier d'un calcul deja fait sous `base_destination`.
///
/// POURQUOI CETTE FONCTION EXISTE. `definir_racine_calculs` ne vaut que pour
/// les calculs A VENIR : elle est posee a l'ouverture d'un projet, et un
/// calcul lance AVANT — donc sans projet ouvert — a ecrit ses .vtr dans le
/// dossier temporaire du systeme, ou le nettoyage de disque de Windows les
/// efface un jour sans rien annoncer.
///
/// POURQUOI C'EST ICI ET NON DANS LE PROJET. `dossier_de` est la seule porte
/// qui transforme un identifiant venu d'une requete en un chemin ; et la
/// tache GARDE son dossier en memoire — le bouger sans le lui dire ferait
/// repondre « le dossier de calcul a disparu » a la visionneuse deux secondes
/// plus tard.
///
/// `base_destination` est POSEE PAR LE SERVEUR, comme la racine des calculs :
/// ce module ne sait toujours pas ce qu'est un projet.
pub fn archiver(ident: &str, base_destination: &str) -> Res<Json> {
    if base_destination.is_empty() {
        return Err(refus("Aucun dossier ou ranger ce calcul.", "Ouvrez ou enregistrez un projet : c'est lui qui donne le dossier."));
    }
    let source = dossier_de(ident)?;
    // UN CALCUL QUI TOURNE NE SE DEPLACE PAS. openEMS ecrit dans ce dossier
    // et l'a ouvert en courant : le bouger sous ses pieds ferait echouer la
    // simulation a la prochaine ecriture, et sur Windows le deplacement
    // serait refuse net.
    let t = tache(ident);
    if t.as_ref().is_some_and(|t| matches!(t.etat(), "prepare" | "calcule")) {
        return Err(refus("Ce calcul tourne encore : ses fichiers ne peuvent pas etre deplaces maintenant.", "Attendez la fin, ou arretez-le."));
    }
    let texte = |p: &Path| p.to_string_lossy().into_owned();
    let destination = _reel(Path::new(base_destination)).join(source.file_name().unwrap_or_default());
    if _reel(&source) == _reel(&destination) {
        return Ok(obj! {"deplace" => false, "deja" => true, "dossier" => texte(&source), "octets" => _poids_dossier(&source) as i64});
    }
    // ON N'ECRASE RIEN. Un dossier deja en place porte le meme identifiant :
    // c'est le meme calcul, archive une premiere fois, et le remplacer
    // jetterait ce qu'on croit justement mettre a l'abri.
    if destination.exists() {
        return Err(refus(format!("Un dossier de calcul du meme nom est deja range la : {}", destination.display()), "Rien n'a ete touche."));
    }
    let octets = _poids_dossier(&source);
    let deplacer = || -> std::io::Result<()> {
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if std::fs::rename(&source, &destination).is_ok() {
            return Ok(()); // meme disque : d'un coup
        }
        // D'un disque a l'autre : copie, puis effacement de la source
        // SEULEMENT une fois la copie entiere (un reste dans le TEMP ne
        // perd rien ; une copie partielle effacee, si).
        _copier(&source, &destination)?;
        let _ = std::fs::remove_dir_all(&source);
        Ok(())
    };
    if let Err(e) = deplacer() {
        // Elle n'existait pas avant (verifie plus haut) : une copie partielle
        // laissee la gagnerait sur l'originale au prochain archivage.
        let _ = std::fs::remove_dir_all(&destination);
        return Err(refus(format!("Le dossier de calcul n'a pas pu etre range : {e}"), &format!("Il est reste ou il etait : {}", source.display())));
    }
    // La tache suit ses fichiers, sans quoi la visionneuse et « ouvrir le
    // dossier » chercheraient a l'ancienne adresse.
    if let Some(t) = t {
        t.i().dossier = destination.clone();
    }
    Ok(obj! {"deplace" => true, "deja" => false, "dossier" => texte(&destination), "source" => texte(&source), "octets" => octets as i64})
}

/// Ouvre le dossier de calcul dans l'explorateur du systeme.
pub fn ouvrir_dossier(ident: &str) -> Res<Json> {
    let dossier = dossier_de(ident)?;
    let programme = if cfg!(windows) { "explorer" } else if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    // Lance sans attendre, et sans laisser le processus fils nous tenir.
    Command::new(programme).arg(&dossier).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
        .map_err(|e| refus(format!("Le dossier n'a pas pu etre ouvert : {e}"), ""))?;
    Ok(obj! {"lance" => "dossier", "dossier" => dossier.to_string_lossy().into_owned()})
}

pub fn liste_taches() -> Json {
    let mut taches: Vec<Arc<Tache>> = verrou(&TACHES).clone();
    taches.sort_by(|a, b| b.i().debut.partial_cmp(&a.i().debut).unwrap_or(std::cmp::Ordering::Equal));
    obj! {"taches" => Json::Liste(taches.iter().map(|t| {
        let i = t.i();
        obj! {"id" => t.id.clone(), "etat" => i.etat, "debut" => i.debut,
              "duree" => (if i.fin != 0.0 { i.fin } else { maintenant() }) - i.debut,
              "nom" => txt(&i.modele["nom"]), "dossier" => i.dossier.to_string_lossy().into_owned()}
    }).collect())}
}

/// Inscrit une tache deja finie sur un dossier existant. Les essais s'en servent pour
/// l'archivage ; rien d'autre.
pub fn _inscrire_pour_essai(ident: &str, dossier: &Path, etat: &'static str) {
    let t = Tache::nouvelle(ident.to_string(), dossier.to_path_buf(), obj! {}, Genre::Simple);
    t.i().etat = etat;
    verrou(&TACHES).push(t);
}

/// Une tache hors registre nourrie d'un journal, pour les essais du suivi : rend la vue,
/// le diagnostic d'energie et le diagnostic du code de sortie.
pub fn _suivi_pour_essai(modele: Json, lignes: &[String], code: i64) -> (Json, Option<String>, String) {
    let t = Tache::nouvelle("essai".into(), PathBuf::new(), modele, Genre::Simple);
    let mut i = t.i();
    for l in lignes {
        i.ajouter(l);
    }
    i._noter_debit();
    (i.vue("essai", 0), i.diagnostic_energie(), i._diagnostic(code))
}
