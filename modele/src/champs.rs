//! Lecture des .vtr d'openEMS et extraction de tranches animables.
//! Le portage de python/openems_champs.py (1.0.0, 2026-09-21).
//!
//! Explication : lit les enregistrements de champ .vtr et les rend affichables
//!               dans la page — sans ParaView.
//!
//!   POURQUOI CE MODULE EXISTE. Jusqu'ici, regarder un champ voulait dire
//!   quitter l'outil : le serveur cherchait ParaView sur le poste et lui
//!   passait le dossier. Cela marche, mais cela coute une installation de
//!   deux gigaoctets, une fenetre de plus, et surtout un apprentissage —
//!   ParaView ne montre RIEN tant qu'on n'a pas choisi une representation,
//!   une composante et une echelle. Or la question qu'on se pose apres un
//!   calcul tient en une phrase : « ou passe le courant, et a quel moment ».
//!   Une carte animee y repond en une seconde.
//!
//!   CE QUE LE MODULE FAIT, ET CE QU'IL NE FAIT PAS. Il lit les .vtr, il en
//!   tire une grille rectiligne et un champ vectoriel, il en decoupe une
//!   TRANCHE plane, et il rend des tableaux de flottants que la page dessine
//!   elle-meme. Il ne fabrique aucune image : le coloriage, l'echelle et
//!   l'animation sont dans le navigateur, ou ils sont reglables sans aller
//!   -retour avec le serveur.
//!
//!   L'ANIMATION NE COUTE PAS UN FICHIER PAR IMAGE. En mode frequentiel,
//!   openEMS ecrit `<champ>_f=<f>_abs.vtr` (l'amplitude) et
//!   `<champ>_f=<f>_arg.vtr` (la phase) — et, en prime, une vingtaine
//!   d'instantanes `_p=<degres>.vtr` qui ne sont que
//!   `amplitude x cos(phase + wt)` echantillonnes. On ignore donc les
//!   instantanes et on renvoie le COUPLE amplitude/phase : deux tableaux
//!   suffisent a rejouer l'onde a n'importe quelle cadence, aussi finement
//!   qu'un ecran sait l'afficher. C'est verifie : la reconstruction retombe
//!   sur les instantanes d'openEMS a la precision du flottant simple.
//!
//!   LE TEMPOREL, LUI, EST UNE VRAIE SUITE D'IMAGES — un fichier par pas de
//!   temps, des milliers parfois. On n'en garde qu'un echantillon regulier :
//!   soixante images font une animation fluide, six mille font une attente.
//!
//! Fonctions : inventaire, serie, lire_vtr, entete_vtr
//!
//! `inventaire` et `serie` rendent le dict de la page, a l'octet celui du Python ; `lire_vtr`
//! rend une `Grille` typee. Deux ecarts, hors de ce que la page lit d'un fichier sain : le texte
//! d'une erreur XML est celui de roxmltree et non d'expat, et un binaire abime (base 64, zlib)
//! sort en refus la ou le Python laissait echapper l'exception.

use crate::b64;
use crate::obj;
use crate::outils::{fmt_g, maxi, nombres};
use ipc2581::py::{self, repr_flottant, Json};
use ipc2581::roxmltree::{Document, Node};
use regex::Regex;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

/// Un refus lisible : le message part tel quel a la page.
#[derive(Debug, Clone, PartialEq)]
pub struct ErreurChamps {
    pub message: String,
    pub conseil: String,
}

fn refus(message: impl Into<String>, conseil: &str) -> ErreurChamps {
    ErreurChamps { message: message.into(), conseil: conseil.to_string() }
}

type Res<T> = Result<T, ErreurChamps>;

// LES BORNES, ET POURQUOI ELLES SONT LA. Un enregistrement « toute la boite »
// a 300 x 300 x 200 cellules tient sur le disque ; le meme en JSON dans un
// navigateur, non. On ne refuse pas pour autant : on SOUS-ECHANTILLONNE, et
// on le dit. Une carte de champ lue une cellule sur deux montre exactement la
// meme chose -- c'est d'ailleurs deja l'argument du reglage « une cellule
// sur » au moment d'enregistrer.
pub const MAX_POINTS: usize = 90000; // points d'une tranche, apres sous-echantillonnage
pub const MAX_TRAMES: usize = 60; // images d'une animation temporelle
pub const MAX_FICHIERS: usize = 20000; // garde-fou de lecture de dossier

// LE BUDGET D'UNE ANIMATION TEMPORELLE, ET POURQUOI IL EST SEPARE. Une
// tranche frequentielle, c'est deux tableaux ; une animation temporelle, c'est
// soixante fois trois. Garder MAX_POINTS par image ferait une reponse de
// quatre-vingts mega-octets, que le navigateur mettrait plus de temps a lire
// que le solveur a produire. On repartit donc un budget total entre les
// images : moins de points chacune, mais un mouvement qu'on voit.
pub const BUDGET_VALEURS: usize = 2000000;

// Un .vtr d'une boite 3D decompresse pese quelques centaines de mega-octets.
// Le cache en garde donc au plus quatre, ET au plus ce volume-la : la borne
// en nombre de fichiers ne protege de rien quand chacun fait 300 Mo.
pub const CACHE_OCTETS: usize = 400 * 1024 * 1024;

// Ce que chaque champ mesure. openEMS ne l'ecrit nulle part dans le .vtr :
// c'est le nom du fichier qui le porte, et ce nom vient de nous
// (`CSX.AddDump('J', ...)` dans openems_script.py).
/// lettre, unite, libelle
pub const UNITES: [(&str, &str, &str); 4] = [
    ("E", "V/m", "champ electrique"),
    ("H", "A/m", "champ magnetique"),
    ("J", "A/m^2", "densite de courant"),
    ("I", "A", "courant total (rot H)"),
];

pub const AXES: [&str; 3] = ["x", "y", "z"];

fn unite_de(champ: &str) -> Option<&'static (&'static str, &'static str, &'static str)> {
    UNITES.iter().find(|u| u.0 == champ)
}

// ==========================================================================
// 1. Le format .vtr
// ==========================================================================
// UN .vtr EST DU XML QUI CONTIENT DU BINAIRE EN BASE 64, et le binaire a son
// propre entete. VTK ecrit, pour un tableau compresse :
//
//     base64(nblocs, taille_bloc, taille_dernier, taille_comprimee[nblocs])
//   + base64(bloc_zlib_1 ... bloc_zlib_n)
//
// — DEUX chaines base64 COLLEES, et non une seule chaine sur l'ensemble.
// C'est le seul piege du format : decoder le tout d'un coup rend des octets
// decales des que la longueur de l'entete n'est pas un multiple de trois.
// On lit donc l'entete d'abord (ses quatre premiers octets disent combien de
// blocs suivent, donc sa propre longueur), puis le corps.

fn illisible() -> ErreurChamps {
    refus("Fichier de champ illisible : entete incoherent.", "")
}

fn decoder(txt: &str) -> Res<Vec<u8>> {
    b64::decoder(txt).ok_or_else(illisible)
}

fn u32_le(o: &[u8]) -> Res<usize> {
    o.get(..4).map(|o| u32::from_le_bytes([o[0], o[1], o[2], o[3]]) as usize).ok_or_else(illisible)
}

/// txt[:n], le texte etant de l'ASCII (de la base 64).
fn debut(txt: &str, n: usize) -> &str {
    txt.get(..n.min(txt.len())).unwrap_or(txt)
}

/// Le contenu brut d'un <DataArray format="binary">.
fn _bloc_binaire(txt: &str, compresse: bool) -> Res<Vec<u8>> {
    let txt: String = txt.chars().filter(|c| !py::blanc(*c)).collect();
    if txt.is_empty() {
        return Ok(Vec::new());
    }
    if !compresse {
        let n = u32_le(&decoder(debut(&txt, 8))?)?;
        // Entete et donnees sont ici une SEULE chaine base64 : VTK ne les
        // separe que lorsqu'il compresse.
        let tout = decoder(&txt)?;
        return Ok(tout.get(4..).map(|t| t[..n.min(t.len())].to_vec()).unwrap_or_default());
    }

    let nblocs = u32_le(&decoder(debut(&txt, 8))?)?;
    if nblocs > 1 << 20 {
        return Err(illisible());
    }
    let taille_tete = (3 + nblocs) * 4;
    let fin_tete = taille_tete.div_ceil(3) * 4;
    let tete = decoder(debut(&txt, fin_tete))?;
    if tete.len() < taille_tete {
        return Err(illisible());
    }
    let corps = decoder(txt.get(fin_tete.min(txt.len())..).unwrap_or(""))?;
    // L'entete annonce la taille d'un bloc decompresse : un bloc qui en rend
    // davantage est une bombe zlib, pas un champ.
    let taille_bloc = u32_le(&tete[4..])? as u64;
    let mut out = Vec::new();
    let mut pos = 0;
    for k in 3..3 + nblocs {
        let t = u32_le(&tete[4 * k..])?;
        let bloc = &corps[pos.min(corps.len())..(pos + t).min(corps.len())];
        let lus = flate2::read::ZlibDecoder::new(bloc).take(taille_bloc + 1).read_to_end(&mut out).map_err(|_| illisible())?;
        if lus as u64 > taille_bloc {
            return Err(illisible());
        }
        pos += t;
    }
    Ok(out)
}

/// Le type d'un <DataArray> : sa taille en octets, et la lecture d'une valeur.
fn forme(nom: Option<&str>) -> Option<(usize, fn(&[u8]) -> f64)> {
    Some(match nom? {
        "Float32" => (4, |o| f32::from_le_bytes([o[0], o[1], o[2], o[3]]) as f64),
        "Float64" => (8, |o| f64::from_le_bytes([o[0], o[1], o[2], o[3], o[4], o[5], o[6], o[7]])),
        "Int32" => (4, |o| i32::from_le_bytes([o[0], o[1], o[2], o[3]]) as f64),
        "UInt32" => (4, |o| u32::from_le_bytes([o[0], o[1], o[2], o[3]]) as f64),
        "Int64" => (8, |o| i64::from_le_bytes([o[0], o[1], o[2], o[3], o[4], o[5], o[6], o[7]]) as f64),
        "UInt64" => (8, |o| u64::from_le_bytes([o[0], o[1], o[2], o[3], o[4], o[5], o[6], o[7]]) as f64),
        _ => return None,
    })
}

/// Un <DataArray> -> array.array de flottants.
///
/// `simple` ramene le resultat en simple precision : c'est ce qu'on veut
/// pour le CHAMP, qu'openEMS ecrit deja ainsi et qui part en base 64 vers
/// la page. Les COORDONNEES, elles, restent en double : elles sont en
/// metres, et ramener 0,033 82 m a un flottant simple deplace une arete de
/// maillage de quelques nanometres — invisible ici, mais c'est le genre
/// d'arrondi gratuit qu'on regrette quand une comparaison de bornes tombe
/// du mauvais cote.
///
/// `.text` et non `itertext()` : un DataArray porte parfois un enfant
/// <InformationKey> apres ses donnees, et sa queue de texte n'est pas de la
/// base 64.
///
/// Ici la precision est celle du type demande : `T` vaut f32 pour le champ, f64 pour les
/// coordonnees.
fn _tableau<T: Copy>(da: Node, compresse: bool, vers: fn(f64) -> T) -> Res<Vec<T>> {
    let Some((taille, lire)) = forme(da.attribute("type")) else {
        return Err(refus(format!("Type de donnees .vtr non gere : {}", da.attribute("type").unwrap_or("None")), ""));
    };
    // `.text` : le texte qui precede le premier enfant
    let texte = da.first_child().filter(|n| n.is_text()).and_then(|n| n.text()).unwrap_or("");
    let fmt = da.attribute("format").filter(|f| !f.is_empty()).unwrap_or("binary").to_lowercase();
    if fmt == "ascii" {
        return texte.split(py::blanc).filter(|v| !v.is_empty())
            .map(|v| py::float(v).map(vers).ok_or_else(illisible)).collect();
    }
    if fmt != "binary" {
        return Err(refus(
            format!("Ce .vtr range ses donnees en « {} », que l'outil ne lit pas.", fmt),
            "Ouvrez le dossier de calcul pour les lire avec un autre outil."));
    }
    let brut = _bloc_binaire(texte, compresse)?;
    Ok(brut.chunks_exact(taille).map(|o| vers(lire(o))).collect())
}

/// Un .vtr relu : ce que `lire_vtr` rend.
#[derive(Debug, Clone)]
pub struct Grille {
    pub dims: [usize; 3],
    /// Les coordonnees des trois axes, en metres.
    pub axes: Vec<Vec<f64>>,
    pub nom: String,
    pub ncomp: usize,
    /// Le champ, en simple precision, range comme VTK le range.
    pub v: Vec<f32>,
}

fn nom_de(chemin: &Path) -> String {
    chemin.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// str(OSError) : « [Errno 2] No such file or directory: 'chemin' ».
fn erreur_os(e: &std::io::Error, chemin: &Path) -> String {
    let texte = e.to_string();
    let texte = texte.split(" (os error").next().unwrap_or("");
    format!("[Errno {}] {}: '{}'", e.raw_os_error().unwrap_or(0), texte, chemin.display())
}

fn enfant<'a>(n: Node<'a, 'a>, nom: &str) -> Option<Node<'a, 'a>> {
    n.children().find(|c| c.is_element() && c.tag_name().name() == nom)
}

fn tableaux<'a>(n: Option<Node<'a, 'a>>) -> Vec<Node<'a, 'a>> {
    n.map(|n| n.children().filter(|c| c.is_element() && c.tag_name().name() == "DataArray").collect()).unwrap_or_default()
}

/// Un .vtr -> {dims, x, y, z, nom, ncomp, v}.
///
/// `v` est le champ, en simple precision, range comme VTK le range : x
/// varie le plus vite, puis y, puis z, et les composantes sont cote a cote.
pub fn lire_vtr(chemin: &Path) -> Res<Grille> {
    let octets = std::fs::read(chemin).map_err(|e| refus(format!("Fichier de champ introuvable : {}", erreur_os(&e, chemin)), ""))?;
    let texte = String::from_utf8_lossy(&octets);
    let doc = Document::parse(&texte)
        .map_err(|e| refus(format!("Fichier de champ illisible ({}) : {}", nom_de(chemin), e), ""))?;
    let racine = doc.root_element();
    if racine.attribute("type") != Some("RectilinearGrid") {
        return Err(refus(
            format!("Ce .vtr n'est pas une grille rectiligne ({}).", racine.attribute("type").unwrap_or("None")),
            "L'outil ne dessine que les grilles d'openEMS."));
    }
    let compresse = racine.attribute("compressor").is_some_and(|c| !c.is_empty());
    let Some(piece) = enfant(racine, "RectilinearGrid").and_then(|g| enfant(g, "Piece")) else {
        return Err(refus(format!("Fichier de champ vide : {}", nom_de(chemin)), ""));
    };

    let mut axes = Vec::new();
    for da in tableaux(enfant(piece, "Coordinates")) {
        axes.push(_tableau(da, compresse, |x| x)?);
    }
    while axes.len() < 3 {
        axes.push(vec![0.0]);
    }
    let (mut nx, mut ny, mut nz) = (axes[0].len(), axes[1].len(), axes[2].len());

    let mut donnees = tableaux(enfant(piece, "PointData"));
    if donnees.is_empty() {
        // Certaines versions ecrivent le champ en CellData. Le decalage d'une
        // demi-cellule ne change rien a ce qu'on regarde.
        donnees = tableaux(enfant(piece, "CellData"));
        if !donnees.is_empty() {
            (nx, ny, nz) = (nx.saturating_sub(1).max(1), ny.saturating_sub(1).max(1), nz.saturating_sub(1).max(1));
        }
    }
    let Some(da) = donnees.first() else {
        return Err(refus(format!("Aucune donnee dans {}", nom_de(chemin)), ""));
    };

    let ncomp = match da.attribute("NumberOfComponents").filter(|n| !n.is_empty()) {
        Some(n) => py::strip(n).parse().map_err(|_| illisible())?,
        None => 1,
    };
    // Un scalaire, un vecteur, au plus un tenseur 3 x 3 : au-dela, le produit
    // ci-dessous reboucle et « attendu » ne garde plus rien.
    if !(1..=9).contains(&ncomp) {
        return Err(illisible());
    }
    let v = _tableau(*da, compresse, |x| x as f32)?;
    let attendu = [ny, nz, ncomp].iter().try_fold(nx, |p, n| p.checked_mul(*n)).ok_or_else(illisible)?;
    if v.len() < attendu {
        return Err(refus(
            format!("Fichier de champ tronque : {} ({} valeurs pour {} attendues).", nom_de(chemin), v.len(), attendu), ""));
    }
    Ok(Grille { dims: [nx, ny, nz], axes, nom: da.attribute("Name").unwrap_or("").to_string(), ncomp, v })
}

// ---- un cache, parce qu'on relit les memes deux fichiers a chaque tranche --
// Changer de tranche dans une boite 3D redemande le MEME fichier : le relire
// et le decompresser a chaque mouvement d'un curseur rendrait l'interface
// poisseuse. Trois fichiers suffisent (amplitude, phase, et le precedent) ;
// au-dela on oublie le plus ancien, parce qu'un .vtr decompresse peut peser
// quelques centaines de mega-octets.
type Cle = (PathBuf, Option<std::time::SystemTime>, u64);
static CACHE: Mutex<Vec<(Cle, Arc<Grille>)>> = Mutex::new(Vec::new());
const CACHE_MAX: usize = 4;

fn _poids(grille: &Grille) -> usize {
    4 * grille.v.len()
}

fn _lire_cache(chemin: &Path) -> Res<Arc<Grille>> {
    let meta = std::fs::metadata(chemin).map_err(|e| refus(format!("Fichier de champ introuvable : {}", erreur_os(&e, chemin)), ""))?;
    let cle: Cle = (chemin.to_path_buf(), meta.modified().ok(), meta.len());
    let cache = || CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((_, g)) = cache().iter().find(|(c, _)| *c == cle) {
        return Ok(g.clone());
    }
    let grille = Arc::new(lire_vtr(chemin)?);
    let mut c = cache();
    c.retain(|(k, _)| *k != cle);
    c.push((cle, grille.clone()));
    let mut total: usize = c.iter().map(|(_, g)| _poids(g)).sum();
    while c.len() > 1 && (c.len() > CACHE_MAX || total > CACHE_OCTETS) {
        total -= _poids(&c.remove(0).1);
    }
    Ok(grille)
}

static RE_EXTENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"WholeExtent\s*=\s*"([-\d\s]+)""#).unwrap());
static RE_NCOMP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"NumberOfComponents\s*=\s*"(\d+)""#).unwrap());

/// Ce que l'entete d'un .vtr dit de lui.
#[derive(Debug, Clone, PartialEq)]
pub struct Entete {
    pub dims: [i64; 3],
    pub ncomp: i64,
}

/// Les dimensions d'un .vtr, sans lire ses donnees.
///
/// L'INVENTAIRE DOIT RESTER INSTANTANE, MEME SUR UN DOSSIER DE PLUSIEURS
/// GIGA-OCTETS. Ouvrir chaque serie pour connaitre sa taille reviendrait a
/// decompresser trois cents mega-octets par champ, juste pour remplir une
/// liste deroulante. Tout ce qu'il faut tient dans le premier kilo-octet du
/// fichier, en clair, avant la base 64.
pub fn entete_vtr(chemin: &Path) -> Option<Entete> {
    let mut tete = Vec::new();
    std::fs::File::open(chemin).ok()?.take(4096).read_to_end(&mut tete).ok()?;
    let tete = String::from_utf8_lossy(&tete);
    let m = RE_EXTENT.captures(&tete)?;
    let e: Vec<i64> = m[1].split(py::blanc).filter(|v| !v.is_empty()).map(|v| v.parse().ok()).collect::<Option<_>>()?;
    if e.len() < 6 {
        return None;
    }
    let ncomp = RE_NCOMP.captures(&tete).and_then(|n| n[1].parse().ok()).unwrap_or(1);
    Some(Entete { dims: [e[1] - e[0] + 1, e[3] - e[2] + 1, e[5] - e[4] + 1], ncomp })
}

// ==========================================================================
// 2. L'inventaire : quels champs ce calcul a-t-il laisses ?
// ==========================================================================
// LES NOMS DE FICHIERS SONT LE SEUL CATALOGUE. openEMS n'ecrit pas d'index ;
// il ecrit des fichiers dont le nom dit tout :
//
//   frequentiel :  J_f=2450000000.000000_abs.vtr      l'amplitude
//                  J_f=2450000000.000000_arg.vtr      la phase, en radians
//                  J_f=2450000000.000000_p=017.vtr    un instantane (ignore)
//   temporel    :  J_00000123.vtr                     un pas de temps
//
// La derniere regle est volontairement large : si une version d'openEMS
// nommait autrement, un groupe « tout ce qui finit par des chiffres » les
// rattrape quand meme, et l'outil affiche une animation plutot qu'un refus.
static RE_FD: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?P<nom>.+?)_f=(?P<f>[0-9][0-9.eE+-]*)_(?:p=(?P<p>[0-9]+)|(?P<part>abs|arg))\.vtr$").unwrap()
});
static RE_TD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?P<nom>.+?)[_.](?P<n>[0-9]+)\.vtr$").unwrap());

/// « J », « E_haut », « Et » -> la lettre du champ, si on la reconnait.
fn _champ_de(nom: &str) -> &'static str {
    let tete = nom.split('_').next().unwrap_or("");
    for (lettre, _, _) in &UNITES {
        if tete == *lettre || tete == format!("{lettre}t") || tete == format!("{lettre}f") {
            return lettre;
        }
    }
    let premiere: String = tete.chars().take(1).flat_map(char::to_uppercase).collect();
    unite_de(&premiere).map(|u| u.0).unwrap_or("")
}

fn _etiquette(champ: &str, nom: &str, mode: &str, freq: f64) -> String {
    let base = unite_de(champ).map(|u| u.2).unwrap_or(nom);
    if mode == "frequentiel" {
        return format!("{}  ·  {}  ·  {}", nom, base, _hertz(freq));
    }
    format!("{}  ·  {}  ·  au cours du temps", nom, base)
}

fn _hertz(freq: f64) -> String {
    let court = |v: f64| format!("{:.4}", v).trim_end_matches('0').trim_end_matches('.').to_string();
    if freq == 0.0 {
        return String::new();
    }
    if freq >= 1e9 {
        return court(freq / 1e9) + " GHz";
    }
    if freq >= 1e6 {
        return court(freq / 1e6) + " MHz";
    }
    fmt_g(freq, 6) + " Hz"
}

/// Une image d'une serie : son etiquette et son fichier.
#[derive(Debug, Clone)]
struct Trame {
    etiquette: String,
    fichier: String,
}

/// Une serie du dossier, champs prives compris (les noms de fichiers).
#[derive(Debug, Clone)]
struct Serie {
    cle: String,
    nom: String,
    champ: &'static str,
    mode: &'static str,
    f: f64,
    source: &'static str,
    abs: String,
    arg: String,
    trames: Vec<Trame>,
    entete: Option<Entete>,
}

impl Serie {
    fn unite(&self) -> &'static str {
        unite_de(self.champ).map(|u| u.1).unwrap_or("")
    }

    fn titre(&self) -> String {
        _etiquette(self.champ, &self.nom, self.mode, self.f)
    }

    /// Ce que la page voit de la serie : sans les noms de fichiers.
    fn json(&self) -> Json {
        let mut s = obj! {
            "cle" => self.cle.clone(), "nom" => self.nom.clone(), "champ" => self.champ,
            "mode" => self.mode, "f" => self.f, "source" => self.source,
            "unite" => self.unite(),
            "titre" => self.titre(),
            // « continu » : l'animation ne se joue pas image par image mais
            // se CALCULE, aussi finement que l'ecran le demande.
            "continu" => self.source == "abs_arg",
            "n_trames" => self.trames.len(),
        };
        if let (Some(e), Json::Objet(o)) = (&self.entete, &mut s) {
            o.insert("dims".into(), Json::Liste(e.dims.iter().map(|d| Json::Entier(*d)).collect()));
            o.insert("ncomp".into(), e.ncomp.into());
            o.insert("volume".into(), (e.dims.iter().min().copied().unwrap_or(0) > 1).into());
        }
        s
    }

    fn premier(&self) -> &str {
        if !self.abs.is_empty() { &self.abs } else { self.trames.first().map(|t| t.fichier.as_str()).unwrap_or("") }
    }
}

fn par_texte_puis<T: PartialOrd>(a: (&str, T), b: (&str, T)) -> std::cmp::Ordering {
    a.0.cmp(b.0).then(a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
}

/// Les series du dossier, champs prives compris (« _abs », « _trames »).
///
/// Le tri ne lit AUCUN fichier de donnees : rien que les noms. Un dossier
/// de plusieurs giga-octets se catalogue donc instantanement — seule la
/// geometrie de la grille, tout en bas, ouvre un fichier par serie, et le
/// cache fait que c'est la derniere fois.
fn _series(dossier: &Path) -> Res<Vec<Serie>> {
    let mut noms: Vec<String> = std::fs::read_dir(dossier)
        .and_then(|d| d.map(|e| e.map(|e| e.file_name().to_string_lossy().into_owned())).collect())
        .map_err(|e| refus(format!("Dossier de calcul illisible : {}", erreur_os(&e, dossier)), ""))?;
    noms.sort();
    noms.truncate(MAX_FICHIERS);

    #[derive(Default)]
    struct Groupe {
        abs: String,
        arg: String,
        p: Vec<(u128, String)>,
    }
    let mut fd: Vec<((String, f64), Groupe)> = Vec::new(); // (nom, f) -> les fichiers de cette frequence
    let mut rang_fd: HashMap<(String, u64), usize> = HashMap::new();
    let mut td: Vec<(String, Vec<(u128, String)>)> = Vec::new(); // nom -> [(n, fichier), ...]
    let mut rang_td: HashMap<String, usize> = HashMap::new();
    for n in noms {
        if !n.to_lowercase().ends_with(".vtr") {
            continue;
        }
        if let Some(m) = RE_FD.captures(&n) {
            let freq = py::float(&m["f"]).unwrap_or(0.0);
            let k = *rang_fd.entry((m["nom"].to_string(), (freq + 0.0).to_bits())).or_insert_with(|| {
                fd.push(((m["nom"].to_string(), freq), Groupe::default()));
                fd.len() - 1
            });
            let g = &mut fd[k].1;
            match (m.name("part").map(|p| p.as_str()), m.name("p")) {
                (Some("abs"), _) => g.abs = n.clone(),
                (Some(_), _) => g.arg = n.clone(),
                (None, p) => g.p.push((p.and_then(|p| p.as_str().parse().ok()).unwrap_or(0), n.clone())),
            }
            continue;
        }
        if let Some(m) = RE_TD.captures(&n) {
            let k = *rang_td.entry(m["nom"].to_string()).or_insert_with(|| {
                td.push((m["nom"].to_string(), Vec::new()));
                td.len() - 1
            });
            td[k].1.push((m["n"].parse().unwrap_or(0), n.clone()));
        }
    }

    let mut series = Vec::new();
    fd.sort_by(|a, b| par_texte_puis((&a.0 .0, a.0 .1), (&b.0 .0, b.0 .1)));
    for ((nom, freq), mut g) in fd {
        // SANS AMPLITUDE NI PHASE, ON RETOMBE SUR LES INSTANTANES. C'est le
        // cas d'un calcul interrompu pile entre deux ecritures, et ce n'est
        // pas une raison pour ne rien montrer.
        let (trames, source) = if !g.abs.is_empty() && !g.arg.is_empty() {
            (Vec::new(), "abs_arg")
        } else if !g.p.is_empty() {
            g.p.sort();
            (g.p.iter().map(|(d, n)| Trame { etiquette: format!("{}°", d), fichier: n.clone() }).collect(), "instantanes")
        } else {
            continue;
        };
        series.push(Serie {
            cle: format!("fd|{}|{}", nom, repr_flottant(freq)), champ: _champ_de(&nom), nom,
            mode: "frequentiel", f: freq, source,
            abs: g.abs, arg: g.arg, trames, entete: None,
        });
    }

    td.sort_by(|a, b| a.0.cmp(&b.0));
    for (nom, mut paires) in td {
        paires.sort();
        series.push(Serie {
            cle: format!("td|{}", nom), champ: _champ_de(&nom), nom,
            mode: "temporel", f: 0.0, source: "pas_de_temps",
            abs: String::new(), arg: String::new(),
            trames: paires.into_iter().map(|(n, fichier)| Trame { etiquette: format!("pas {}", n), fichier }).collect(),
            entete: None,
        });
    }

    // LA TAILLE DE LA GRILLE VIENT DE L'ENTETE, ET NON DU FICHIER ENTIER.
    // Elle est indicative : c'est `serie()` qui fait foi, apres une vraie
    // lecture. Ici elle ne sert qu'a dire, dans la liste, si l'on a affaire a
    // une image ou a un volume.
    for s in series.iter_mut() {
        if !s.premier().is_empty() {
            s.entete = entete_vtr(&dossier.join(s.premier()));
        }
    }

    // L'ORDRE DE LA LISTE EST CELUI DE L'INTERET, ET NON L'ALPHABET. On
    // ouvre un calcul pour voir ou passe le COURANT — « J » d'abord, donc,
    // puis le champ electrique qui dit ou se concentre la tension.
    let rang = |champ: &str| ["J", "E", "H", "I"].iter().position(|c| *c == champ).unwrap_or(9);
    series.sort_by(|a, b| rang(a.champ).cmp(&rang(b.champ)).then(par_texte_puis((&a.nom, a.f), (&b.nom, b.f))));
    Ok(series)
}

/// Ce qu'il y a a regarder dans ce dossier de calcul, pour la page.
///
/// Les champs prives — les noms de fichiers — ne remontent pas : la page
/// designe une serie par sa CLE, et c'est le serveur qui la resout en
/// fichiers. Une route qui accepterait un nom de fichier venu de la
/// requete ouvrirait tout autre chose qu'un champ.
pub fn inventaire(dossier: &Path) -> Res<Json> {
    let publiques: Vec<Json> = _series(dossier)?.iter().map(Serie::json).collect();
    let n = publiques.len();
    Ok(obj! {"series" => Json::Liste(publiques), "dossier" => dossier.to_string_lossy().into_owned(),
             "n" => n})
}

// ==========================================================================
// 3. Une tranche, prete a dessiner
// ==========================================================================

/// Quel axe est normal a l'image, et quels deux axes la remplissent.
fn _plan(axe: &str) -> (usize, usize, usize) {
    match axe {
        "x" => (0, 1, 2),
        "y" => (1, 0, 2),
        _ => (2, 0, 1),
    }
}

/// La normale la plus evidente : la direction ou la grille est plate.
///
/// Un dump `plan_z` fait une seule cellule en z — c'est une image, il n'y a
/// rien a choisir. Une boite 3D n'a pas de reponse evidente : on prend z,
/// parce que c'est le plan du cuivre et que c'est ce qu'on regarde.
fn _axe_par_defaut(dims: &[usize; 3]) -> &'static str {
    dims.iter().position(|n| *n <= 1).map(|i| AXES[i]).unwrap_or("z")
}

/// L'indice de la tranche ou le champ est le plus fort.
///
/// LE MILIEU D'UNE BOITE, C'EST DE L'AIR. Un enregistrement volumique coupe
/// par defaut a mi-hauteur montre donc une carte noire, et laisse croire que
/// le calcul n'a rien donne. La tranche interessante est celle qui porte
/// l'energie — le plan du cuivre, neuf fois sur dix —, et la trouver ne
/// coute qu'un parcours echantillonne du tableau.
pub fn _tranche_forte(grille: &Grille, axe: &str) -> usize {
    let dims = grille.dims;
    let (i_n, i_u, i_v) = _plan(axe);
    let n_n = dims[i_n];
    if n_n <= 1 {
        return 0;
    }
    let ncomp = grille.ncomp;
    let v = &grille.v;
    let saut = [ncomp, dims[0] * ncomp, dims[0] * dims[1] * ncomp];
    let plan = dims[i_u] * dims[i_v];
    // Au plus deux millions de valeurs lues en tout, quel que soit le volume.
    let pas = ((n_n * plan * ncomp) / 2000000).max(1);
    let (mut meilleur, mut force) = (0, -1.0);
    for k in 0..n_n {
        let base = k * saut[i_n];
        let mut s = 0.0f64;
        for j in (0..dims[i_v]).step_by(pas) {
            let d0 = base + j * saut[i_v];
            for i in (0..dims[i_u]).step_by(pas) {
                let d = d0 + i * saut[i_u];
                for c in 0..ncomp {
                    let x = v[d + c] as f64;
                    s += x * x;
                }
            }
        }
        if s > force {
            (force, meilleur) = (s, k);
        }
    }
    meilleur
}

/// Une tranche plane : ce que `_decouper` rend.
#[derive(Debug, Clone)]
pub struct Tranche {
    pub u_mm: Vec<f64>,
    pub v_mm: Vec<f64>,
    /// `ncomp` tableaux de len(u_mm) * len(v_mm) flottants, ranges u en premier.
    pub comps: Vec<Vec<f32>>,
    pub sous: (usize, usize),
    pub indice: usize,
}

/// Extrait une tranche plane : coordonnees en mm et composantes.
///
/// Rend (u_mm, v_mm, comps) ou `comps` est une liste de `ncomp` tableaux de
/// flottants, chacun de len(u_mm) * len(v_mm), rangee u en premier.
pub fn _decouper(grille: &Grille, axe: &str, indice: i64, max_points: usize) -> Tranche {
    let dims = grille.dims;
    let (i_n, i_u, i_v) = _plan(axe);
    let (n_n, n_u, n_v) = (dims[i_n], dims[i_u], dims[i_v]);
    let indice = indice.min(n_n as i64 - 1).max(0) as usize;

    // Le sous-echantillonnage porte sur les DEUX axes de l'image a la fois :
    // une tranche deux fois moins fine dans chaque direction pese quatre fois
    // moins, et se lit exactement pareil.
    let (mut pu, mut pv) = (1, 1);
    while n_u.div_ceil(pu) * n_v.div_ceil(pv) > max_points {
        if n_u / pu >= n_v / pv {
            pu += 1;
        } else {
            pv += 1;
        }
        if pu > 64 || pv > 64 {
            break;
        }
    }

    let us: Vec<usize> = (0..n_u).step_by(pu).collect();
    let vs: Vec<usize> = (0..n_v).step_by(pv).collect();
    let ncomp = grille.ncomp;
    let v = &grille.v;

    // Le pas d'un indice de grille dans le tableau lineaire, par axe. VTK
    // range x le plus vite.
    let saut = [ncomp, dims[0] * ncomp, dims[0] * dims[1] * ncomp];
    let base = indice * saut[i_n];
    let (su, sv) = (saut[i_u], saut[i_v]);

    let mut comps: Vec<Vec<f32>> = (0..ncomp).map(|_| Vec::with_capacity(us.len() * vs.len())).collect();
    for jv in &vs {
        let dv = base + jv * sv;
        for ju in &us {
            let d = dv + ju * su;
            for (c, comp) in comps.iter_mut().enumerate() {
                comp.push(v[d + c]);
            }
        }
    }

    let mm = |axe: usize, indices: &[usize]| indices.iter().map(|j| grille.axes[axe].get(*j).copied().unwrap_or(0.0) * 1000.0).collect();
    Tranche { u_mm: mm(i_u, &us), v_mm: mm(i_v, &vs), comps, sous: (pu, pv), indice }
}

fn _b64(a: &[f32]) -> Json {
    b64::encoder(&a.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<u8>>()).into()
}

/// Le plus grand module vectoriel de la tranche.
///
/// C'est l'echelle par defaut de l'animation. Elle est FIXE pour toute la
/// duree : une echelle recalculee a chaque image fait clignoter la carte et
/// donne a un champ mourant l'air d'un champ intense.
fn _amplitude_max(comps: &[Vec<f32>]) -> f64 {
    let n = comps.first().map(|c| c.len()).unwrap_or(0);
    let mut fort = 0.0;
    for k in 0..n {
        let mut s = 0.0f64;
        for c in comps {
            s += c[k] as f64 * c[k] as f64;
        }
        if s > fort {
            fort = s;
        }
    }
    fort.powf(0.5)
}

fn arrondis(t: &[f64]) -> Json {
    nombres(t.iter().map(|x| py::round(*x, 6)))
}

/// Les donnees d'une serie, pretes a animer dans la page.
///
/// Frequentiel : deux tableaux (amplitude, phase) par composante. La page
/// rejoue l'onde par `A cos(phi + wt)`, aussi finement qu'elle veut, sans
/// rien redemander au serveur.
///
/// Temporel : jusqu'a `max_trames` images regulierement espacees.
///
/// `indice` None ou negatif : la tranche la plus forte ; `max_points` et `max_trames` a zero :
/// les bornes du module.
pub fn serie(dossier: &Path, cle: &str, axe: &str, indice: Option<i64>, max_points: usize, max_trames: usize) -> Res<Json> {
    let s = _trouver(dossier, cle)?;
    let mut max_points = (if max_points == 0 { MAX_POINTS } else { max_points }).clamp(256, MAX_POINTS);

    // L'axe et l'indice se decident sur la geometrie, donc apres une premiere
    // lecture — mais la premiere lecture a besoin de l'axe. On lit d'abord la
    // grille (le cache la gardera), puis on tranche.
    if s.premier().is_empty() {
        return Err(refus("Cet enregistrement ne contient aucun fichier.", ""));
    }
    let g0 = _lire_cache(&dossier.join(s.premier()))?;
    let dims = g0.dims;
    let axe_final = AXES.iter().find(|a| **a == axe).copied().unwrap_or(_axe_par_defaut(&dims));
    let (i_n, i_u, i_v) = _plan(axe_final);
    let indice = match indice {
        Some(i) if i >= 0 => i,
        _ => _tranche_forte(&g0, axe_final) as i64,
    };
    let position = |g: &Grille, ind: usize| py::round(g.axes[i_n].get(ind).copied().unwrap_or(0.0) * 1000.0, 6);

    let mut sortie = obj! {
        "cle" => s.cle.clone(), "nom" => s.nom.clone(), "champ" => s.champ,
        "titre" => s.titre(), "mode" => s.mode, "f" => s.f,
        "unite" => s.unite(), "source" => s.source,
        "axe" => axe_final, "axes_image" => Json::Liste(vec![AXES[i_u].into(), AXES[i_v].into()]),
        "n_tranches" => dims[i_n], "dims" => Json::Liste(dims.iter().map(|d| Json::from(*d)).collect()),
    };
    let Json::Objet(o) = &mut sortie else { unreachable!() };
    let mut poser = |cle: &str, v: Json| {
        o.insert(cle.to_string(), v);
    };
    let liste_b64 = |comps: &[Vec<f32>]| Json::Liste(comps.iter().map(|c| _b64(c)).collect());

    if s.mode == "frequentiel" && s.source == "abs_arg" {
        let ga = _lire_cache(&dossier.join(&s.abs))?;
        let amp = _decouper(&ga, axe_final, indice, max_points);
        let pha = _decouper(&*_lire_cache(&dossier.join(&s.arg))?, axe_final, indice, max_points);
        if amp.comps.len() != pha.comps.len() {
            return Err(refus("Amplitude et phase ne concordent pas.", ""));
        }
        poser("u", arrondis(&amp.u_mm));
        poser("v", arrondis(&amp.v_mm));
        poser("indice", amp.indice.into());
        poser("position_mm", position(&ga, amp.indice).into());
        poser("sous_ech", Json::Liste(vec![amp.sous.0.into(), amp.sous.1.into()]));
        poser("ncomp", amp.comps.len().into());
        poser("max", _amplitude_max(&amp.comps).into());
        poser("amp", liste_b64(&amp.comps));
        poser("pha", liste_b64(&pha.comps));
        return Ok(sortie);
    }

    // -- une vraie suite d'images -----------------------------------------
    let trames = &s.trames;
    if trames.is_empty() {
        return Err(refus("Cet enregistrement ne contient aucune image.", ""));
    }
    let n = trames.len();
    let max_trames = (if max_trames == 0 { MAX_TRAMES } else { max_trames }).clamp(1, MAX_TRAMES);
    // Le budget se repartit entre les images : c'est lui, et non MAX_POINTS,
    // qui fixe la finesse d'une animation temporelle.
    let ncomp0 = g0.ncomp.max(1);
    max_points = max_points.min(BUDGET_VALEURS / (n.min(max_trames) * ncomp0)).max(1024);
    let pris: Vec<&Trame> = if n > max_trames {
        if max_trames > 1 {
            (0..max_trames).map(|i| &trames[((i * (n - 1)) as f64 / (max_trames - 1) as f64).round_ties_even() as usize]).collect()
        } else {
            vec![&trames[0]]
        }
    } else {
        trames.iter().collect()
    };

    let (mut images, mut fort) = (Vec::new(), 0.0);
    let mut derniere = None;
    for t in pris {
        let g = _lire_cache(&dossier.join(&t.fichier))?;
        let tr = _decouper(&g, axe_final, indice, max_points);
        fort = maxi(fort, _amplitude_max(&tr.comps));
        images.push(obj! {"etiquette" => t.etiquette.clone(),
                          "c" => liste_b64(&tr.comps)});
        derniere = Some(tr);
    }
    let Some(tr) = derniere else { unreachable!() };
    let n_rendues = images.len();
    poser("u", arrondis(&tr.u_mm));
    poser("v", arrondis(&tr.v_mm));
    poser("indice", tr.indice.into());
    poser("position_mm", position(&g0, tr.indice).into());
    poser("sous_ech", Json::Liste(vec![tr.sous.0.into(), tr.sous.1.into()]));
    poser("ncomp", g0.ncomp.into());
    poser("max", fort.into());
    poser("trames", Json::Liste(images));
    poser("n_total", n.into());
    poser("n_rendues", n_rendues.into());
    Ok(sortie)
}

/// La serie complete — champs prives compris — portant cette cle.
fn _trouver(dossier: &Path, cle: &str) -> Res<Serie> {
    _series(dossier)?.into_iter().find(|s| s.cle == cle).ok_or_else(|| refus(
        "Cet enregistrement de champ n'est plus dans le dossier de calcul.",
        "Rechargez la liste : le dossier a peut-etre ete vide ou remplace."))
}
