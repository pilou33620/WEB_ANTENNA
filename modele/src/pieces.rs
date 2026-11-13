//! Pieces 3D importees : lecture, soudure, verification, placement.
//! Le portage de python/openems_pieces.py (1.0.0, 2026-09-24).
//!
//! Explication : les pieces mecaniques importees -- boitier, piles, vis --,
//!   c'est-a-dire des MAILLAGES TRIANGULES fermes, et ce qu'il faut en faire
//!   pour qu'openEMS les voie.
//!
//!   La page lit le fichier STEP (OpenCascade compile en WebAssembly, repris
//!   de WEB_3D) et envoie des triangles. Ce module les relit, les soude, les
//!   verifie, les place, et en tire ce dont le maillage FDTD a besoin : leur
//!   emprise et les plans de leurs faces.
//!
//! Fonctions : pieces, corps_inclus, emprises, sans_geometrie, sommets_b64,
//!             faces_b64
//!
//! Ce que le Python tenait dans des dict est ici typé (`Piece`, `Corps`) ; `Piece::json` rend
//! le dict que la page reçoit, sans les triangles (`sans_geometrie`). Le cache des corps relus
//! (`_CACHE`, `_PLACES`) n'est pas repris : il épargnait à Python des secondes par frappe, la
//! soudure de quatre cent mille triangles coûte ici quelques dizaines de millisecondes.

use crate::b64;
use crate::obj;
use crate::outils::{max_de, min_de, nombres};
use ipc2581::py::{self, repr_flottant, Json};
use std::collections::HashMap;
use std::io::Write;

/// Un refus, avec ce qu'il faut changer -- meme forme qu'ErreurModele,
/// que openems_modele convertit : ce module ne depend pas de lui.
#[derive(Debug, Clone, PartialEq)]
pub struct ErreurPiece {
    pub message: String,
    pub conseil: String,
}

fn refus(message: String, conseil: &str) -> ErreurPiece {
    ErreurPiece { message, conseil: conseil.to_string() }
}

// -- les bornes -------------------------------------------------------------
// UN BUDGET DE TRIANGLES, ET NON UNE TAILLE DE FICHIER. Ce qui coute, c'est
// ce qu'openEMS fait de chaque triangle : pour chaque cellule du maillage, il
// demande « ce point est-il dans la piece ? », et la reponse parcourt un arbre
// de triangles. Un boitier triangule a la finesse d'un rendu (deux cent mille
// triangles, des conges au centieme) n'apprend rien de plus a une grille dont
// la cellule fait un demi-millimetre -- et la page triangule deja grossier
// pour cette raison (voir 33-pieces.js).
pub const MAX_TRIANGLES: usize = 400000;
pub const MAX_PIECES: usize = 32;
// LES CORPS SIMULES, ET EUX SEULS. Un export mecanique complet porte la carte,
// ses composants, sa visserie : des centaines de corps, presque tous ignores,
// et qui ne voyagent meme pas avec leurs triangles. Les compter refusait en
// bloc un produit dont vingt corps seulement partaient au solveur. Le nombre
// TOTAL n'a qu'un garde-fou, contre un document aberrant.
pub const MAX_CORPS: usize = 400;
pub const MAX_CORPS_TOTAL: usize = 20000;

// LA SOUDURE : deux sommets plus proches que cela sont UN sommet. OpenCascade
// triangule chaque face B-Rep a part, et chaque face porte ses propres copies
// des sommets de ses aretes : le maillage n'est alors ferme qu'a la condition
// de les recoller. Le micron suffit : aucune piece mecanique n'a deux sommets
// distincts a moins d'un micron, et les coordonnees d'une meme arete
// discretisee ne different que du bruit d'un flottant 32 bits.
pub const SOUDURE_MM: f64 = 1e-3;

// Les plans des faces qui meritent une ligne de maillage. Voir `_plans`.
pub const PLAN_TOLERANCE: f64 = 0.9999; // |n.axe| au-dessus duquel une face est « plane »
pub const PLAN_GROUPE_MM: f64 = 0.02; // deux faces a moins de cela sont un seul plan
pub const PLAN_AIRE_MIN_MM2: f64 = 1.0; // en dessous, c'est un detail, pas une paroi
pub const PLANS_PAR_AXE: usize = 16; // par corps : une piece n'emporte pas la grille

// LES PRIORITES, ET POURQUOI LE DIELECTRIQUE PASSE SOUS LA CARTE. Le substrat
// est a 1, le cuivre a 10 et au-dessus. Un plastique a 0 cede donc a la
// carte partout ou ils se recouvrent -- et ils se recouvrent souvent : un
// export mecanique porte la carte elle-meme, et un bossage de vissage touche
// le stratifie. La carte decrite par le fichier IPC-2581 est la verite ; le
// plastique autour ne la remplace pas. Le metal, lui, passe au-dessus de tout
// ce qui n'est pas un port : une pile posee sur la carte est une pile.
pub const PRIORITE_DIELECTRIQUE: i64 = 0;
pub const PRIORITE_METAL: i64 = 20;

pub const MATERIAUX: [&str; 3] = ["metal", "dielectrique", "ignore"];

// ==========================================================================
// Petits outils de lecture
// ==========================================================================
fn _nb(v: &Json, defaut: f64) -> f64 {
    let x = match v {
        Json::Bool(b) => *b as i64 as f64,
        Json::Entier(i) => *i as f64,
        Json::Flottant(f) => *f,
        Json::GrandEntier(t) => t.parse().unwrap_or(f64::INFINITY),
        Json::Texte(t) => match py::float(t) {
            Some(x) => x,
            None => return defaut,
        },
        _ => return defaut,
    };
    if x.is_finite() { x } else { defaut }
}

fn _texte(v: &Json, maxi: usize) -> String {
    match v {
        Json::Texte(t) => py::strip(t).chars().take(maxi).collect(),
        _ => String::new(),
    }
}

fn _trois(v: &Json, defaut: f64) -> [f64; 3] {
    match v.as_liste() {
        Some(l) if l.len() >= 3 => [_nb(&l[0], defaut), _nb(&l[1], defaut), _nb(&l[2], defaut)],
        _ => [defaut; 3],
    }
}

/// Une chaine base64 -> un array.array petit-boutiste.
fn _decoder(texte: &Json, taille: usize, nom: &str, quoi: &str) -> Result<Vec<u8>, ErreurPiece> {
    // `texte or ""` : ce qui est faux vaut une chaine vide ; ce qui n'est pas un texte est illisible
    let brut = match texte {
        Json::Texte(t) => b64::decoder(t),
        v if !v.vrai() => Some(Vec::new()),
        _ => None,
    };
    let Some(brut) = brut else {
        return Err(refus(format!("Le corps « {nom} » porte des {quoi} illisibles."),
                         "Le document a ete abime en route : reimportez la piece."));
    };
    if brut.len() % taille != 0 {
        return Err(refus(format!("Le corps « {nom} » a des {quoi} tronques."), "Reimportez la piece."));
    }
    Ok(brut)
}

// ==========================================================================
// Un corps : relu, soude, verifie -- une fois
// ==========================================================================
/// Un corps relu, soude et verifie : ce que `_analyser` rend.
#[derive(Debug, Clone)]
pub struct Analyse {
    /// x, y, z a la suite, en millimetres, dans le repere du fichier.
    pub sommets: Vec<f64>,
    pub faces: Vec<u32>,
    pub n_sommets: usize,
    pub n_triangles: usize,
    pub bords: usize,
    pub boite: [f64; 6],
}

/// La cle d'un sommet : ses trois flottants, 0.0 et -0.0 confondus comme le fait un dict.
fn cle_sommet(x: f64, y: f64, z: f64) -> [u64; 3] {
    [(x + 0.0).to_bits(), (y + 0.0).to_bits(), (z + 0.0).to_bits()]
}

/// Recolle les sommets IDENTIQUES, retire les triangles degeneres.
///
/// Rend (sommets en liste plate de flottants, triangles en array('I')).
///
/// PAS DE TOLERANCE ICI, ET C'EST UNE CORRECTION. La page soude deja, a une
/// vraie distance (33-pieces.js, `antSouder`), et envoie des sommets distincts.
/// Les ressouder ici par ARRONDI au micron pouvait fusionner deux sommets que
/// la page avait gardes -- a un micron d'ecart en diagonale, ils tombent dans
/// la meme maille --, rendre leurs triangles degeneres, et refuser comme
/// « ouvert » un corps que la page montrait ferme. Seuls les doublons exacts
/// sont recolles : un document qui n'aurait pas ete soude est alors vu
/// ouvert, ce qu'il est pour CSXCAD.
fn _souder(s: &[f32], t: &[u32]) -> (Vec<f64>, Vec<u32>) {
    let n = s.len() / 3;
    let mut cles: HashMap<[u64; 3], u32> = HashMap::with_capacity(n);
    let mut nouveaux: Vec<f64> = Vec::new();
    let mut renvoi = vec![0u32; n];
    for i in 0..n {
        let (x, y, z) = (s[3 * i] as f64, s[3 * i + 1] as f64, s[3 * i + 2] as f64);
        let suivant = (nouveaux.len() / 3) as u32;
        let j = *cles.entry(cle_sommet(x, y, z)).or_insert_with(|| {
            nouveaux.extend([x, y, z]);
            suivant
        });
        renvoi[i] = j;
    }
    let mut faces = Vec::new();
    for k in (0..t.len().saturating_sub(2)).step_by(3) {
        let (a, b, c) = (renvoi[t[k] as usize], renvoi[t[k + 1] as usize], renvoi[t[k + 2] as usize]);
        if a == b || b == c || a == c {
            continue;
        }
        faces.extend([a, b, c]);
    }
    (nouveaux, faces)
}

/// Le nombre d'aretes qui ne sont pas partagees par un nombre PAIR de
/// triangles : zero pour une surface fermee.
///
/// POURQUOI C'EST UN REFUS ET NON UN AVIS. CSXCAD decide qu'une cellule est
/// dans la piece en comptant les traversees d'un rayon ; sur une surface
/// ouverte, il repond « dehors » partout, SANS UN MOT. Verifie sur CSXCAD
/// 0.6.3 : un cube dont une face manque, ou dont les sommets ne sont pas
/// recolles, rend IsInside = faux au centre meme du cube. La piece partirait
/// au solveur et n'y existerait pas -- le pire des resultats, parce qu'il a
/// l'air d'en etre un.
fn _bords(faces: &[u32]) -> usize {
    let mut compte: HashMap<(u32, u32), u32> = HashMap::new();
    for f in faces.chunks_exact(3) {
        for (u, v) in [(f[0], f[1]), (f[1], f[2]), (f[2], f[0])] {
            *compte.entry(if u < v { (u, v) } else { (v, u) }).or_insert(0) += 1;
        }
    }
    compte.values().filter(|n| *n % 2 != 0).count()
}

/// Un corps du document (`sommets` et `triangles` en base 64) -> relu, soude, verifie.
pub fn _analyser(nom: &str, s64: &Json, t64: &Json) -> Result<Analyse, ErreurPiece> {
    let s: Vec<f32> = _decoder(s64, 4, nom, "sommets")?
        .chunks_exact(4).map(|o| f32::from_le_bytes([o[0], o[1], o[2], o[3]])).collect();
    let t: Vec<u32> = _decoder(t64, 4, nom, "triangles")?
        .chunks_exact(4).map(|o| u32::from_le_bytes([o[0], o[1], o[2], o[3]])).collect();
    if s.len() % 3 != 0 || t.len() % 3 != 0 {
        return Err(refus(format!("Le corps « {nom} » est mal forme."), "Reimportez la piece."));
    }
    let n = s.len() / 3;
    if n < 4 || t.len() < 12 {
        return Err(refus(
            format!("Le corps « {nom} » n'a pas de volume : {n} sommet(s), {} triangle(s).", t.len() / 3),
            "Un volume ferme demande au moins quatre triangles. Marquez ce \
             corps « ignore » s'il ne represente rien."));
    }
    if t.iter().any(|i| *i as usize >= n) {
        return Err(refus(format!("Le corps « {nom} » designe un sommet qui n'existe pas."), "Reimportez la piece."));
    }
    if s.iter().any(|v| !v.is_finite()) {
        return Err(refus(format!("Le corps « {nom} » a un sommet non fini (NaN ou infini)."),
                         "Le fichier source est abime a cet endroit."));
    }

    let (sommets, faces) = _souder(&s, &t);
    if faces.len() < 12 {
        return Err(refus(format!("Le corps « {nom} » s'efface a la soudure : il est plat ou degenere."),
                         "Marquez-le « ignore »."));
    }
    let boite = boite_de(&sommets);
    Ok(Analyse {
        n_sommets: sommets.len() / 3,
        n_triangles: faces.len() / 3,
        bords: _bords(&faces),
        boite,
        sommets,
        faces,
    })
}

/// (min x, min y, min z, max x, max y, max z) d'une suite de sommets.
fn boite_de(s: &[f64]) -> [f64; 6] {
    let axe = |k: usize| s.iter().skip(k).step_by(3).copied();
    [min_de(axe(0)), min_de(axe(1)), min_de(axe(2)), max_de(axe(0)), max_de(axe(1)), max_de(axe(2))]
}

// ==========================================================================
// Le placement
// ==========================================================================
/// R = Rz.Ry.Rx, angles en degres : on tourne d'abord autour de X, puis
/// de Y, puis de Z, les trois axes etant ceux de la CARTE (fixes). C'est
/// l'ordre dans lequel les champs se lisent, de gauche a droite.
fn _rotation(rx: f64, ry: f64, rz: f64) -> [[f64; 3]; 3] {
    let rad = |v: f64| v * (std::f64::consts::PI / 180.0);
    // Les quarts de tour rendent des zeros et des uns EXACTS : un cosinus de
    // 90 degres qui vaut 6e-17 deplacerait une face « plane » hors de son
    // plan, et son ligne de maillage avec elle.
    let arr = |v: f64| {
        if v.abs() < 1e-12 {
            0.0
        } else if (v - 1.0).abs() < 1e-12 {
            1.0
        } else if (v + 1.0).abs() < 1e-12 {
            -1.0
        } else {
            v
        }
    };
    let (a, b, c) = (rad(rx), rad(ry), rad(rz));
    let (ca, sa) = (arr(a.cos()), arr(a.sin()));
    let (cb, sb) = (arr(b.cos()), arr(b.sin()));
    let (cc, sc) = (arr(c.cos()), arr(c.sin()));
    [
        [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa],
        [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa],
        [-sb, cb * sa, cb * ca],
    ]
}

/// c + t - R.c : la translation de p -> R.(p - c) + c + t.
fn deport(r: &[[f64; 3]; 3], c: &[f64; 3], t: &[f64; 3]) -> [f64; 3] {
    std::array::from_fn(|k| c[k] + t[k] - py::sum((0..3).map(|j| r[k][j] * c[j])))
}

/// La matrice 4x4 (rangee par colonnes, comme three.js l'attend) de
/// p -> R.(p - c) + c + t. La page dessine avec ELLE, et non avec un calcul
/// a elle : ce qui est vu est ce qui est simule.
fn _matrice(r: &[[f64; 3]; 3], c: &[f64; 3], t: &[f64; 3]) -> [f64; 16] {
    let d = deport(r, c, t);
    [r[0][0], r[1][0], r[2][0], 0.0,
     r[0][1], r[1][1], r[2][1], 0.0,
     r[0][2], r[1][2], r[2][2], 0.0,
     d[0], d[1], d[2], 1.0]
}

fn _transformer(sommets: &[f64], r: &[[f64; 3]; 3], c: &[f64; 3], t: &[f64; 3]) -> Vec<f64> {
    let d = deport(r, c, t);
    let mut out = Vec::with_capacity(sommets.len());
    for p in sommets.chunks_exact(3) {
        let (x, y, z) = (p[0], p[1], p[2]);
        out.push(r[0][0] * x + r[0][1] * y + r[0][2] * z + d[0]);
        out.push(r[1][0] * x + r[1][1] * y + r[1][2] * z + d[1]);
        out.push(r[2][0] * x + r[2][1] * y + r[2][2] * z + d[2]);
    }
    out
}

/// Les plans des grandes faces d'un corps, axe par axe.
///
/// POURQUOI UNE PAROI DEMANDE SES LIGNES. Un boitier plastique a des parois
/// de un a deux millimetres ; la grille, dans l'air, en a souvent trois ou
/// six. openEMS ne voit la matiere qu'aux points ou il la cherche : une paroi
/// qui tombe entre deux lignes y est vue a moitie, ou pas du tout, selon
/// l'endroit ou elle tombe -- et la piece change d'epaisseur quand on la
/// deplace d'un demi-millimetre. Une ligne sur CHAQUE face plane d'une paroi
/// lui donne au moins une cellule entiere, a son epaisseur exacte.
///
/// Seules les faces alignees sur un axe comptent (une grille cartesienne ne
/// sait pas suivre une pente), et seulement les grandes : un chanfrein, un
/// congé, un logo en relief n'ont pas a mailler la boite. Les plus grandes
/// d'abord, `PLANS_PAR_AXE` au plus.
pub fn _plans(sommets: &[f64], faces: &[u32]) -> [Vec<f64>; 3] {
    let mut aires: [HashMap<i64, f64>; 3] = Default::default();
    for f in faces.chunks_exact(3) {
        let (a, b, c) = (3 * f[0] as usize, 3 * f[1] as usize, 3 * f[2] as usize);
        let ux = sommets[b] - sommets[a];
        let uy = sommets[b + 1] - sommets[a + 1];
        let uz = sommets[b + 2] - sommets[a + 2];
        let vx = sommets[c] - sommets[a];
        let vy = sommets[c + 1] - sommets[a + 1];
        let vz = sommets[c + 2] - sommets[a + 2];
        let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        let l = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
        if l <= 0.0 || l.is_nan() {
            continue;
        }
        for ax in 0..3 {
            if n[ax].abs() >= PLAN_TOLERANCE * l {
                let v = (sommets[a + ax] + sommets[b + ax] + sommets[c + ax]) / 3.0;
                let cle = (v / PLAN_GROUPE_MM).round_ties_even() as i64;
                *aires[ax].entry(cle).or_insert(0.0) += 0.5 * l;
                break;
            }
        }
    }
    std::array::from_fn(|ax| {
        // Deux cles voisines sont le meme plan a l'arrondi pres : on les
        // rassemble, l'aire s'ajoute et la cote est la moyenne ponderee.
        let mut tri: Vec<(i64, f64)> = aires[ax].iter().map(|(k, v)| (*k, *v)).collect();
        tri.sort_by_key(|(cle, _)| *cle);
        let mut grappes: Vec<(i64, f64, f64)> = Vec::new();
        for (cle, aire) in tri {
            match grappes.last_mut() {
                Some(g) if cle - g.0 <= 1 => {
                    g.1 += aire;
                    g.2 += aire * cle as f64;
                    g.0 = cle;
                }
                _ => grappes.push((cle, aire, aire * cle as f64)),
            }
        }
        let mut plans: Vec<(f64, f64)> = grappes.iter().filter(|g| g.1 >= PLAN_AIRE_MIN_MM2)
            .map(|g| (g.1, g.2 / g.1 * PLAN_GROUPE_MM)).collect();
        plans.sort_by(|p, q| q.partial_cmp(p).unwrap_or(std::cmp::Ordering::Equal));
        let mut cotes: Vec<f64> = plans.iter().take(PLANS_PAR_AXE).map(|(_, v)| py::round(*v, 6)).collect();
        cotes.sort_by(|p, q| p.partial_cmp(q).unwrap_or(std::cmp::Ordering::Equal));
        cotes
    })
}

// ==========================================================================
// Le document -> les pieces
// ==========================================================================
/// Les triangles places d'un corps simule : ce que le Python rangeait sous « _geo ».
#[derive(Debug, Clone)]
pub struct Geo {
    /// Les sommets PLACES, en millimetres : x, y, z a la suite.
    pub sommets: Vec<f64>,
    pub faces: Vec<u32>,
}

/// Ce qu'un corps simule (metal ou dielectrique) porte de plus qu'un corps ignore.
#[derive(Debug, Clone)]
pub struct Inclus {
    pub triangles: usize,
    pub sommets: usize,
    pub ferme: bool,
    pub bords: usize,
    pub emprise: [f64; 6],
    pub plans: [Vec<f64>; 3],
    pub priorite: i64,
    pub geo: Geo,
}

#[derive(Debug, Clone)]
pub struct Corps {
    pub nom: String,
    pub materiau: String,
    pub matiere: String,
    pub er: f64,
    pub df: f64,
    /// None pour un corps « ignore » : il ne voyage pas avec ses triangles.
    pub inclus: Option<Inclus>,
}

#[derive(Debug, Clone)]
pub struct Piece {
    pub id: String,
    pub nom: String,
    pub rotation: [f64; 3],
    pub position_mm: [f64; 3],
    pub centre_mm: [f64; 3],
    pub matrice: [f64; 16],
    pub corps: Vec<Corps>,
    pub emprise: Option<[f64; 6]>,
}

impl Corps {
    /// Le dict du corps, sans « _geo ».
    pub fn json(&self) -> Json {
        let mut q = obj! {"nom" => self.nom.clone(), "materiau" => self.materiau.clone(),
                          "matiere" => self.matiere.clone(), "er" => self.er, "df" => self.df};
        if let (Some(i), Json::Objet(o)) = (&self.inclus, &mut q) {
            o.insert("triangles".into(), i.triangles.into());
            o.insert("sommets".into(), i.sommets.into());
            o.insert("ferme".into(), i.ferme.into());
            o.insert("bords".into(), i.bords.into());
            o.insert("emprise".into(), nombres(i.emprise));
            o.insert("plans".into(), Json::Liste(i.plans.iter().map(|p| nombres(p.iter().copied())).collect()));
            o.insert("priorite".into(), i.priorite.into());
        }
        q
    }
}

impl Piece {
    /// Le dict de la piece tel que la page le recoit : sans les triangles.
    pub fn json(&self) -> Json {
        let mut p = obj! {"id" => self.id.clone(), "nom" => self.nom.clone(), "rotation" => nombres(self.rotation),
                          "position_mm" => nombres(self.position_mm), "centre_mm" => nombres(self.centre_mm),
                          "matrice" => nombres(self.matrice),
                          "corps" => Json::Liste(self.corps.iter().map(Corps::json).collect())};
        if let (Some(e), Json::Objet(o)) = (self.emprise, &mut p) {
            o.insert("emprise".into(), nombres(e));
        }
        p
    }
}

/// Le materiau declare d'un corps du document, en minuscules ; « ignore » quand il n'en dit rien.
fn materiau_de(c: &Json) -> String {
    let m = _texte(&c["materiau"], 16);
    if m.is_empty() { "ignore".into() } else { m.to_lowercase() }
}

/// Les pieces du document, verifiees, placees, pretes a mailler.
///
/// `k_mm` convertit l'unite du fichier (celle de la POSITION) en mm. Les
/// sommets, eux, sont toujours en millimetres : c'est l'unite qu'OpenCascade
/// rend, et la page ne les convertit pas.
pub fn pieces(doc_pieces: &Json, k_mm: f64) -> Result<Vec<Piece>, ErreurPiece> {
    let Some(doc_pieces) = doc_pieces.as_liste() else { return Ok(Vec::new()) };
    if doc_pieces.len() > MAX_PIECES {
        return Err(refus(
            format!("{} pieces importees, {} au plus.", doc_pieces.len(), MAX_PIECES),
            "Rassemblez-les dans un assemblage STEP, ou retirez celles qui \
             sont loin de l'antenne."));
    }
    let mut out = Vec::new();
    let mut total = 0usize;
    let vide = Vec::new();
    for (i, p) in doc_pieces.iter().enumerate() {
        if p.as_objet().is_none() {
            continue;
        }
        let nom = Some(_texte(&p["nom"], 60)).filter(|n| !n.is_empty()).unwrap_or(format!("piece {}", i + 1));
        let corps_doc = p["corps"].as_liste().unwrap_or(&vide);
        let n_sim = corps_doc.iter()
            .filter(|c| c.as_objet().is_some() && matches!(materiau_de(c).as_str(), "metal" | "dielectrique"))
            .count();
        if n_sim > MAX_CORPS || corps_doc.len() > MAX_CORPS_TOTAL {
            return Err(refus(
                format!("La piece « {nom} » a {n_sim} corps simules ({} au total), {MAX_CORPS} au plus.", corps_doc.len()),
                "Marquez « ignore » ce qui ne compte pas pour l'antenne : les \
                 composants, la visserie loin d'elle. Seuls les corps simules \
                 sont comptes."));
        }
        let rot = _trois(&p["rotation"], 0.0);
        let pos = _trois(&p["position"], 0.0).map(|v| v * k_mm);

        let mut corps: Vec<(Corps, Option<Analyse>)> = Vec::new();
        for (j, c) in corps_doc.iter().enumerate() {
            if c.as_objet().is_none() {
                continue;
            }
            let cn = Some(_texte(&c["nom"], 60)).filter(|n| !n.is_empty()).unwrap_or(format!("corps {}", j + 1));
            let mut mat = materiau_de(c);
            if !MATERIAUX.contains(&mat.as_str()) {
                mat = "ignore".into();
            }
            let er = _nb(&c["er"], 0.0);
            let df = crate::outils::maxi(0.0, _nb(&c["df"], 0.0));
            if mat == "dielectrique" && !(er >= 1.0) {
                return Err(refus(
                    format!("Le corps « {cn} » de « {nom} » a une permittivite de {}.", repr_flottant(er)),
                    "Une permittivite relative vaut au moins 1 (le vide). \
                     Choisissez une matiere dans la liste, ou saisissez \
                     celle de la fiche du fournisseur."));
            }
            // UN CORPS IGNORE NE VOYAGE PAS AVEC SES TRIANGLES. Un export
            // mecanique complet porte la carte, ses deux cents composants,
            // la visserie : les renvoyer a chaque frappe pour ne rien en
            // faire serait le gros du document. Son nom suffit au bilan.
            let a = if mat != "ignore" {
                Some(_analyser(&format!("{nom} / {cn}"), &c["sommets"], &c["triangles"])?)
            } else {
                None
            };
            if let Some(a) = &a {
                total += a.n_triangles;
                if a.bords != 0 {
                    return Err(refus(
                        format!("Le corps « {cn} » de « {nom} » n'est pas ferme : {} arete(s) ne bordent qu'une face.", a.bords),
                        "openEMS ne saurait pas dire ce qui est dedans : il \
                         l'ignorerait sans rien dire. Marquez ce corps \
                         « ignore », ou reexportez la piece en solide (et \
                         non en surfaces) depuis l'outil de mecanique."));
                }
            }
            corps.push((Corps { nom: cn, materiau: mat, matiere: _texte(&c["matiere"], 30), er, df, inclus: None }, a));
        }

        if total > MAX_TRIANGLES {
            return Err(refus(
                format!("{total} triangles dans les pieces importees, {MAX_TRIANGLES} au plus."),
                "Reimportez avec une triangulation plus grossiere, ou \
                 marquez « ignore » les corps qui ne comptent pas (vis, \
                 composants loin de l'antenne)."));
        }

        // LE CENTRE DE ROTATION EST CELUI DE LA PIECE ENTIERE, corps ignores
        // compris : sans quoi ignorer une vis ferait bouger le boitier. La
        // page le calcule -- elle seule a encore les corps ignores -- et
        // l'envoie, en millimetres, dans le repere du fichier. A defaut, le
        // centre des corps recus.
        let fini = |v: &Json| match v {
            Json::Bool(b) => Some(*b as i64 as f64),
            Json::Entier(i) => Some(*i as f64),
            Json::Flottant(f) if f.is_finite() => Some(*f),
            _ => None,
        };
        let recu: Option<Vec<f64>> = p["centre"].as_liste().filter(|l| l.len() >= 3)
            .and_then(|l| l[..3].iter().map(fini).collect());
        let centre: [f64; 3] = match recu {
            Some(c) => [c[0], c[1], c[2]],
            None => {
                let bx: Vec<&[f64; 6]> = corps.iter().filter_map(|(_, a)| a.as_ref().map(|a| &a.boite)).collect();
                if bx.is_empty() {
                    [0.0; 3]
                } else {
                    std::array::from_fn(|k| (min_de(bx.iter().map(|b| b[k])) + max_de(bx.iter().map(|b| b[k + 3]))) / 2.0)
                }
            }
        };
        let r = _rotation(rot[0], rot[1], rot[2]);
        let mut piece = Piece {
            id: Some(_texte(&p["id"], 40)).filter(|n| !n.is_empty()).unwrap_or(format!("p{i}")),
            nom, rotation: rot, position_mm: pos, centre_mm: centre,
            matrice: _matrice(&r, &centre, &pos), corps: Vec::new(), emprise: None,
        };
        for (mut c, a) in corps {
            if let Some(a) = a {
                let s = _transformer(&a.sommets, &r, &centre, &pos);
                c.inclus = Some(Inclus {
                    triangles: a.n_triangles,
                    sommets: a.n_sommets,
                    ferme: a.bords == 0,
                    bords: a.bords,
                    emprise: boite_de(&s),
                    plans: _plans(&s, &a.faces),
                    priorite: if c.materiau == "metal" { PRIORITE_METAL } else { PRIORITE_DIELECTRIQUE },
                    geo: Geo { sommets: s, faces: a.faces },
                });
            }
            piece.corps.push(c);
        }
        let inclus: Vec<&[f64; 6]> = piece.corps.iter().filter_map(|q| q.inclus.as_ref().map(|i| &i.emprise)).collect();
        if !inclus.is_empty() {
            piece.emprise = Some(std::array::from_fn(|k| {
                if k < 3 { min_de(inclus.iter().map(|e| e[k])) } else { max_de(inclus.iter().map(|e| e[k])) }
            }));
        }
        out.push(piece);
    }
    Ok(out)
}

/// Les corps qui partent au solveur, dans l'ordre.
pub fn corps_inclus(liste: &[Piece]) -> impl Iterator<Item = (&Piece, &Corps)> {
    liste.iter().flat_map(|p| p.corps.iter().filter(|c| c.materiau != "ignore").map(move |c| (p, c)))
}

pub fn emprises(liste: &[Piece]) -> Vec<[f64; 6]> {
    corps_inclus(liste).filter_map(|(_, c)| c.inclus.as_ref().map(|i| i.emprise)).collect()
}

/// Le modele tel que la page le recoit : sans les triangles.
///
/// Ils y sont venus, ils n'en repartent pas. La page les a deja -- c'est elle
/// qui les a envoyes --, et les lui renvoyer placés doublerait a chaque frappe
/// le poids de l'aller-retour. Elle dessine avec la matrice.
///
/// Ici, les triangles ne sont jamais dans le JSON du modele : ils restent dans `Modele::pieces`.
pub fn sans_geometrie(modele: &crate::modele::Modele) -> &Json {
    &modele.m
}

/// base64(zlib(octets, niveau 6)).
// shortcut: le flux zlib n'est pas, a l'octet, celui de la zlib de Python (miniz_oxide ici) ;
// son contenu decompresse l'est. A reprendre avec la zlib C si un jour le texte compresse lui-meme
// doit etre compare.
fn _b64(octets: &[u8]) -> String {
    let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::new(6));
    let _ = z.write_all(octets);
    b64::encoder(&z.finish().unwrap_or_default())
}

/// Les sommets PLACES, en millimetres, flottants 64 bits compresses.
pub fn sommets_b64(corps: &Corps) -> String {
    let geo = corps.inclus.as_ref().map(|i| &i.geo);
    _b64(&geo.map(|g| g.sommets.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<u8>>()).unwrap_or_default())
}

pub fn faces_b64(corps: &Corps) -> String {
    let geo = corps.inclus.as_ref().map(|i| &i.geo);
    _b64(&geo.map(|g| g.faces.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<u8>>()).unwrap_or_default())
}
