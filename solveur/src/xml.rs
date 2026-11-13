//! Le modele normalise -> le fichier XML que lit l'executable `openEMS`.
//! Le successeur de python/openems_script.py (1.0.0) : celui-ci ecrivait un script Python qui
//! construisait la structure par les liaisons CSXCAD ; on ecrit ici directement ce que ces
//! liaisons auraient depose dans le fichier, primitive pour primitive, dans le meme ordre.
//!
//!   POURQUOI CE FICHIER EST AUSSI CE QU'ON EXPORTE. Une interface graphique qui lance un
//!   solveur et ne rend qu'une courbe laisse son utilisateur sans recours : il ne peut ni
//!   rejouer le calcul dans six mois, ni le montrer a un collegue. Le XML rendu ici ne depend
//!   plus ni du serveur, ni de la page, ni de ce depot : `openEMS antenne.xml` le rejoue.
//!
//! Le format est celui de CSXCAD 0.6.3 / openEMS 0.0.36 (ContinuousStructure::ReadFromXML,
//! openEMS::Parse_XML_FDTDSetup), relu dans leurs sources. Deux regles en viennent :
//!   - une liste de nombres s'ecrit SANS AUCUN BLANC (« 1,2,3 ») : String2Double exige d'avoir
//!     tout consomme, et un nombre suivi d'un blanc est saute sans un mot ;
//!   - un attribut absent prend sa valeur d'usine : on n'ecrit que ce que le script posait.

use antenne_modele::modele::{ErreurModele, DUMP_TYPES};
use antenne_modele::outils::fmt_g;
use antenne_modele::pieces::{corps_inclus, Piece};
use antenne_modele::Json;

use crate::ports::{self, PortMesure};

pub const C0: f64 = 299792458.0;
pub const EPS0: f64 = 8.8541878128e-12;

// LA PRECISION D'ECRITURE, UNE SEULE POUR TOUT LE FICHIER. Elle n'est pas un
// detail de presentation : une cote de port et la ligne de maillage sur
// laquelle elle doit tomber sont le MEME nombre dans le modele, et deux
// arrondis differents suffisent a les separer de quatre microns -- de quoi
// qu'une boite d'excitation plate n'excite plus rien. Voir `_coller_ports`.
pub const DEC: usize = 6;

/// Un flottant ecrit court : les coordonnees viennent d'un fichier de
/// CAO au micron, dix-sept chiffres apres la virgule n'apprennent rien.
pub fn _f(v: f64, dec: usize) -> String {
    let s = format!("{:.*}", dec, v);
    let s = if s.contains('.') { s.trim_end_matches('0').trim_end_matches('.') } else { &s };
    if s.is_empty() || s == "-" || s == "-0" { "0".into() } else { s.to_string() }
}

/// Le nombre tel que le solveur le relira d'une cote ecrite a `dec` decimales.
pub fn lit(v: f64, dec: usize) -> f64 {
    _f(v, dec).parse().unwrap_or(0.0)
}

/// Le nombre que Python relisait d'un « %.{dec}e » du script.
pub fn lit_e(v: f64, dec: usize) -> f64 {
    format!("{:.*e}", dec, v).parse().unwrap_or(0.0)
}

/// Un nombre dans le XML : l'ecriture la plus courte qui se relit a l'identique, sans exposant
/// (strtod et sscanf la relisent toutes deux).
pub fn nb(v: f64) -> String {
    let s = format!("{v}");
    if s == "-0" { "0".into() } else { s }
}

/// « a,b,c », sans blanc.
pub fn liste_nb(vals: impl IntoIterator<Item = f64>) -> String {
    vals.into_iter().map(nb).collect::<Vec<_>>().join(",")
}

// Un disque n'existe pas en 2D dans CSXCAD : il s'approche par un polygone
// regulier. Vingt-quatre cotes donnent une erreur de rayon de 0,9 % au pire,
// soit 18 microns sur un degagement de SMA — trente fois moins que la cellule
// la plus fine qu'on maille jamais a ces frequences.
pub const DISQUE_COTES: usize = 24;

/// Un disque, en polygone, dans le plan xy.
pub fn _disque(x: f64, y: f64, r: f64) -> Vec<(f64, f64)> {
    let n = DISQUE_COTES as f64;
    (0..DISQUE_COTES).map(|i| {
        let a = 2.0 * std::f64::consts::PI * i as f64 / n;
        (x + r * a.cos(), y + r * a.sin())
    }).collect()
}

/// Un nom de propriete CSXCAD sur : lettres, chiffres, souligne.
pub fn _ident(nom: &str, prefixe: &str) -> String {
    let s: String = nom.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
    let s = s.trim_matches('_');
    let s = if s.is_empty() { "x" } else { s };
    if s.as_bytes()[0].is_ascii_digit() { format!("{prefixe}_{s}") } else { s.to_string() }
}

/// Un nom venu du fichier, sur UNE ligne, pour un commentaire du XML. Deux tirets
/// fermeraient presque le commentaire, et un XML mal forme est un calcul qui ne part pas.
pub fn _com(s: &str) -> String {
    let mut t = s.split_whitespace().collect::<Vec<_>>().join(" ");
    while t.contains("--") {
        t = t.replace("--", "- -");
    }
    t.trim_end_matches('-').to_string()
}

/// Conductivite equivalente d'un dielectrique a pertes.
///
/// openEMS decrit les pertes dielectriques par une conductivite kappa et non
/// par une tangente de pertes : kappa = 2.pi.f.eps0.er.tan(delta). Elle est
/// donc JUSTE A UNE SEULE FREQUENCE -- celle ou on la calcule. On prend le
/// centre de la bande : c'est la ou la mesure compte, et l'erreur aux bords
/// reste sous le pour-cent sur une bande etroite. Sur une bande large, le
/// modele de Debye d'openEMS est plus juste (voir `materiau_debye`).
pub fn _kappa(er: f64, df: f64, f0: f64) -> f64 {
    2.0 * std::f64::consts::PI * f0 * EPS0 * er * df
}

// ==========================================================================
// Un arbre XML, et son ecriture
// ==========================================================================
#[derive(Debug, Clone)]
pub enum Noeud {
    Elt(Elt),
    Texte(String),
    Com(String),
}

#[derive(Debug, Clone, Default)]
pub struct Elt {
    pub nom: String,
    pub attrs: Vec<(String, String)>,
    pub enfants: Vec<Noeud>,
}

impl Elt {
    pub fn new(nom: &str) -> Elt {
        Elt { nom: nom.to_string(), ..Elt::default() }
    }
    pub fn a(mut self, cle: &str, valeur: impl Into<String>) -> Elt {
        self.attrs.push((cle.to_string(), valeur.into()));
        self
    }
    pub fn n(self, cle: &str, valeur: f64) -> Elt {
        self.a(cle, nb(valeur))
    }
    pub fn e(mut self, enfant: Elt) -> Elt {
        self.enfants.push(Noeud::Elt(enfant));
        self
    }
    pub fn t(mut self, texte: impl Into<String>) -> Elt {
        self.enfants.push(Noeud::Texte(texte.into()));
        self
    }
    pub fn com(&mut self, texte: &str) {
        self.enfants.push(Noeud::Com(_com(texte)));
    }

    fn ecrire(&self, s: &mut String, niveau: usize) {
        let marge = "  ".repeat(niveau);
        s.push_str(&format!("{marge}<{}", self.nom));
        for (k, v) in &self.attrs {
            s.push_str(&format!(" {k}=\"{}\"", echappe(v)));
        }
        match self.enfants.as_slice() {
            [] => s.push_str(" />\n"),
            // Le texte colle a ses balises : c'est une liste de nombres, et le blanc la casse.
            [Noeud::Texte(t)] => s.push_str(&format!(">{}</{}>\n", echappe(t), self.nom)),
            enfants => {
                s.push_str(">\n");
                for e in enfants {
                    match e {
                        Noeud::Elt(e) => e.ecrire(s, niveau + 1),
                        Noeud::Texte(t) => s.push_str(&format!("{marge}  {}\n", echappe(t))),
                        Noeud::Com(t) => s.push_str(&format!("{marge}  <!-- {t} -->\n")),
                    }
                }
                s.push_str(&format!("{marge}</{}>\n", self.nom));
            }
        }
    }
}

fn echappe(t: &str) -> String {
    t.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Le document entier, avec sa declaration.
pub fn document(racine: &Elt) -> String {
    let mut s = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\" ?>\n");
    racine.ecrire(&mut s, 0);
    s
}

// ==========================================================================
// La structure : des proprietes, chacune avec ses primitives
// ==========================================================================
/// Une propriete CSXCAD (materiau, metal, sonde...) et ce qui est dessine avec.
#[derive(Debug, Clone)]
pub struct Prop {
    pub elt: Elt,
    pub prims: Vec<Elt>,
}

/// Ce que `ContinuousStructure` tenait en memoire : les proprietes, dans l'ordre de leur
/// creation. Une primitive s'ajoute a une propriete deja posee, par son rang.
#[derive(Debug, Clone, Default)]
pub struct Csx {
    pub props: Vec<Prop>,
}

pub type P3 = [f64; 3];

fn point(nom: &str, p: P3) -> Elt {
    Elt::new(nom).n("X", p[0]).n("Y", p[1]).n("Z", p[2])
}

impl Csx {
    pub fn poser(&mut self, elt: Elt) -> usize {
        self.props.push(Prop { elt, prims: Vec::new() });
        self.props.len() - 1
    }

    fn prop(&self, genre: &str, nom: &str) -> Elt {
        Elt::new(genre).a("ID", self.props.len().to_string()).a("Name", nom)
    }

    pub fn metal(&mut self, nom: &str) -> usize {
        let e = self.prop("Metal", nom);
        self.poser(e)
    }

    /// CSX.AddMaterial(nom, epsilon=, kappa=) : isotrope, le reste a sa valeur d'usine.
    pub fn materiau(&mut self, nom: &str, epsilon: f64, kappa: f64) -> usize {
        let trois = |v: f64| liste_nb([v, v, v]);
        let e = self.prop("Material", nom).a("Isotropy", "1")
            .e(Elt::new("Property").a("Epsilon", trois(epsilon)).a("Mue", "1,1,1").a("Kappa", trois(kappa)).a("Sigma", "0,0,0")
                .a("Density", "0"))
            .e(Elt::new("Weight").a("Epsilon", "1,1,1").a("Mue", "1,1,1").a("Kappa", "1,1,1").a("Sigma", "1,1,1").a("Density", "1"));
        self.poser(e)
    }

    /// CSX.AddConductingSheet(nom, conductivity=, thickness=).
    pub fn feuille(&mut self, nom: &str, conductivite: f64, epaisseur_m: f64) -> usize {
        let e = self.prop("ConductingSheet", nom).n("Conductivity", conductivite).n("Thickness", epaisseur_m);
        self.poser(e)
    }

    /// CSX.AddLumpedElement(nom, ny=, caps=True, R=) : ni C ni L, que CSXCAD lit alors « absents ».
    pub fn resistance(&mut self, nom: &str, ny: usize, r: f64) -> usize {
        let e = self.prop("LumpedElement", nom).a("Direction", ny.to_string()).a("Caps", "1").n("R", r);
        self.poser(e)
    }

    /// CSX.AddExcitation(nom, exc_type=0, exc_val=vec, delay=).
    pub fn excitation(&mut self, nom: &str, vec: P3, retard: f64) -> usize {
        let e = self.prop("Excitation", nom).a("Number", "0").n("Frequency", 0.0).n("Delay", retard).a("Type", "0")
            .a("Excite", liste_nb(vec)).a("PropDir", "0,0,0").e(Elt::new("Weight").a("X", "1").a("Y", "1").a("Z", "1"));
        self.poser(e)
    }

    /// CSX.AddProbe(nom, p_type=, weight=, norm_dir=). Le fichier de sonde porte ce nom.
    pub fn sonde(&mut self, nom: &str, genre: i64, poids: f64, normale: i64) -> usize {
        let e = self.prop("ProbeBox", nom).a("Number", "0").a("Type", genre.to_string()).n("Weight", poids)
            .a("NormDir", normale.to_string());
        self.poser(e)
    }

    pub fn boite(&mut self, prop: usize, priorite: i64, a: P3, b: P3) {
        self.props[prop].prims.push(Elt::new("Box").a("Priority", priorite.to_string()).e(point("P1", a)).e(point("P2", b)));
    }

    pub fn cylindre(&mut self, prop: usize, priorite: i64, a: P3, b: P3, rayon: f64) {
        self.props[prop].prims.push(Elt::new("Cylinder").a("Priority", priorite.to_string()).n("Radius", rayon)
            .e(point("P1", a)).e(point("P2", b)));
    }

    /// AddCylindricalShell : `rayon` est le rayon MOYEN de la coque.
    pub fn coque(&mut self, prop: usize, priorite: i64, a: P3, b: P3, rayon: f64, epaisseur: f64) {
        self.props[prop].prims.push(Elt::new("CylindricalShell").a("Priority", priorite.to_string()).n("Radius", rayon)
            .n("ShellWidth", epaisseur).e(point("P1", a)).e(point("P2", b)));
    }

    pub fn sphere(&mut self, prop: usize, priorite: i64, c: P3, rayon: f64) {
        self.props[prop].prims.push(Elt::new("Sphere").a("Priority", priorite.to_string()).n("Radius", rayon).e(point("Center", c)));
    }

    /// AddPolygon(pts, 'z', z) ou, avec une longueur, AddLinPoly(pts, 'z', z, longueur).
    /// Les sommets sont ecrits a la precision du fichier, comme `_poly` les ecrivait.
    pub fn polygone(&mut self, prop: usize, priorite: i64, pts: &[(f64, f64)], z: f64, longueur: Option<f64>) {
        let mut e = Elt::new(if longueur.is_some() { "LinPoly" } else { "Polygon" }).a("Priority", priorite.to_string())
            .n("Elevation", z).a("NormDir", "2").a("QtyVertices", pts.len().to_string());
        if let Some(l) = longueur {
            e = e.n("Length", l);
        }
        for (x, y) in pts {
            e = e.e(Elt::new("Vertex").n("X1", lit(*x, DEC)).n("X2", lit(*y, DEC)));
        }
        self.props[prop].prims.push(e);
    }

    fn elt(self) -> Elt {
        let mut props = Elt::new("Properties");
        for p in self.props {
            let mut prims = Elt::new("Primitives");
            for q in p.prims {
                prims = prims.e(q);
            }
            // <Primitives> toujours present, meme vide : sans lui CSXCAD ecrit un avertissement
            // par propriete.
            props = props.e(p.elt.e(prims));
        }
        props
    }
}

/// L'indice du dielectrique dont une face touche la cote z, ou None.
///
/// Sert aux DEGAGEMENTS du coaxial comme aux decoupes d'un versement : un
/// trou dans du cuivre se fait en redessinant la matiere qui l'entoure a une
/// priorite plus haute, et cette matiere-la est le substrat voisin.
pub fn _die_contre(m: &Json, z: f64) -> Option<usize> {
    liste(&m["dielectriques"]).iter().position(|d| (f(&d["z1"]) - z).abs() < 1e-9 || (f(&d["z0"]) - z).abs() < 1e-9)
}

pub(crate) fn f(v: &Json) -> f64 {
    v.as_f64().unwrap_or(0.0)
}

pub(crate) fn liste(v: &Json) -> &[Json] {
    v.as_liste().map(|l| l.as_slice()).unwrap_or(&[])
}

pub(crate) fn txt(v: &Json) -> &str {
    v.as_str().unwrap_or("")
}

fn p3(v: &Json) -> P3 {
    [lit(f(&v[0]), DEC), lit(f(&v[1]), DEC), lit(f(&v[2]), DEC)]
}

pub(crate) fn refus(message: impl Into<String>, conseil: &str) -> ErreurModele {
    ErreurModele { message: message.into(), conseil: conseil.to_string() }
}

/// Les lignes de maillage telles que le solveur les relira : a la precision du fichier.
pub fn lignes_ecrites(m: &Json) -> [Vec<f64>; 3] {
    ["x", "y", "z"].map(|a| liste(&m["maillage"][a]).iter().map(|v| lit(f(v), DEC)).collect())
}

/// Ce que le calcul laissera a depouiller : le XML, et ou sont les sondes de chaque port.
#[derive(Debug, Clone)]
pub struct Simulation {
    pub xml: String,
    pub ports: Vec<PortMesure>,
    /// Les couples (E, H) de fichiers que la boite de champ lointain ecrira.
    pub nf2ff: Vec<(String, String)>,
}

/// Modele normalise -> le XML d'openEMS. Rien n'est ecrit sur le disque.
pub fn generer(m: &Json, pieces: &[Piece]) -> Result<Simulation, ErreurModele> {
    let b = &m["bande"];
    let boite = &m["boite"];
    let est = &m["estimation"];
    let mode = m["modele_cuivre"].as_str().unwrap_or("feuille");
    let pertes = &m["pertes"];
    let f_kappa = match f(&pertes["f_kappa"]) {
        v if v != 0.0 => v,
        _ => f(&b["f0"]),
    };
    let mut csx = Csx::default();

    // -- 1. Le solveur ---------------------------------------------------
    // EndCriteria : la simulation s'arrete quand l'energie residuelle dans
    // la boite est tombee d'autant de decibels. C'est ce critere, et non le
    // nombre de pas, qui decide en pratique — NrTS n'est qu'un garde-fou.
    let pml = format!("PML_{}", m["boite"]["pml"].as_i64().unwrap_or(8));
    let f0 = lit_e(f(&b["f0"]), 6);
    let fc = lit_e(f(&b["fc"]), 6);
    let mut bords = Elt::new("BoundaryCond");
    // PML sur les six faces : la boite rayonne dans l'espace libre.
    for face in ["xmin", "xmax", "ymin", "ymax", "zmin", "zmax"] {
        bords = bords.a(face, pml.clone());
    }
    let fdtd = Elt::new("FDTD").a("NumberOfTimesteps", m["arret"]["nmax"].as_i64().unwrap_or(0).to_string())
        .n("endCriteria", lit_e(10f64.powf(f(&m["arret"]["energie_dB"]) / 10.0), 3)).n("f_max", f0 + fc)
        .e(Elt::new("Excitation").a("Type", "0").n("f0", f0).n("fc", fc)).e(bords);

    // -- 2. Le substrat --------------------------------------------------
    // openEMS ne connait pas la tangente de pertes : il veut une conductivite
    // kappa, juste a une seule frequence, ou un jeu de POLES DE DEBYE qui tient
    // tan(delta) a peu pres constant sur toute la bande.
    let mut subs = Vec::new();
    for d in liste(&m["dielectriques"]) {
        let nom = _ident(txt(&d["nom"]), "die");
        let sub = if pertes["actif"].vrai() && d["debye"].vrai() {
            materiau_debye(&mut csx, &nom, &d["debye"])
        } else {
            let k = d["kappa"].as_f64().unwrap_or_else(|| _kappa(f(&d["er"]), f(&d["df"]), f_kappa));
            csx.materiau(&nom, lit(f(&d["er"]), 4), lit_e(k, 6))
        };
        if m["carte"].vrai() {
            // Le contour de la carte entiere, et non l'emprise du cuivre :
            // voir `_carte` dans le modele.
            csx.polygone(sub, 1, &pts(&m["carte"]["contour"]), lit(f(&d["z0"]), DEC), Some(lit(f(&d["z1"]) - f(&d["z0"]), DEC)));
        } else {
            let bc = &m["boite_cuivre"];
            csx.boite(sub, 1, [lit(f(&bc[0]), DEC), lit(f(&bc[1]), DEC), lit(f(&d["z0"]), DEC)],
                      [lit(f(&bc[2]), DEC), lit(f(&bc[3]), DEC), lit(f(&d["z1"]), DEC)]);
        }
        subs.push(sub);
    }

    // -- 3. Le cuivre ----------------------------------------------------
    // MODE « VOLUME » : le cuivre est extrude sur son epaisseur reelle. C'est le
    // plus fidele et de loin le plus cher — l'epaisseur entre dans le maillage et
    // commande le pas de temps de tout le domaine.
    // MODE « PEC » : conducteur parfait, surface sans epaisseur. Aucune perte
    // ohmique — le rendement en ressort surestime.
    // MODE « FEUILLE » : surface sans epaisseur qui porte quand meme la
    // resistance du cuivre reel (ConductingSheet). A 2,4 GHz l'epaisseur de peau
    // fait 1,3 micron : le courant ne voit pas les 35 microns de la couche, mais
    // il voit sa resistance. On gagne le maillage de l'epaisseur sans perdre les
    // pertes.
    //
    // Les DECOUPES d'un versement (les trous d'un plan de masse) ne sont pas
    // portees par le polygone : elles sont redessinees ensuite avec le materiau
    // du substrat a une priorite PLUS HAUTE. C'est ainsi que CSXCAD fait des
    // trous — la priorite tranche, pas l'ordre d'ajout.
    //
    // `air_trou` est cree au PREMIER trou qui en a besoin, et non au premier trou
    // tout court : les trous de la couche du haut se remplissent de substrat, et
    // ceux de la couche du bas, venus ensuite, n'en trouvent pas.
    let mut air_trou = None;
    for bloc in liste(&m["cuivre"]) {
        let nom = format!("cu_{}", _ident(txt(&bloc["couche"]), "cu"));
        let cu = if mode == "volume" || mode == "pec" {
            csx.metal(&nom)
        } else {
            let sigma = bloc["sigma"].as_f64().unwrap_or(5.8e7);
            csx.feuille(&nom, fmt_g(sigma, 4).parse().unwrap_or(sigma), lit_e(f(&bloc["ep"]) * 1e-3, 6))
        };
        let z0 = lit(f(&bloc["z0"]), DEC);
        let ep = match f(&bloc["ep_geo"]) {
            v if v != 0.0 => v,
            _ => f(&bloc["ep"]),
        };
        let longueur = (mode == "volume").then(|| lit(ep, DEC));
        let polys = liste(&bloc["polys"]);
        // 1. Les versements portant des decoupes (plans de masse) a priorite 10.
        for poly in polys.iter().filter(|p| p["t"].vrai()) {
            csx.polygone(cu, 10, &pts(&poly["o"]), z0, longueur);
        }
        // 2. Les decoupes dans ces versements a priorite 11 (remplies de dielectrique).
        for trou in polys.iter().flat_map(|p| liste(&p["t"])) {
            // Le trou est rempli par le dielectrique qui se trouve juste
            // sous la couche ; a defaut, de l'air.
            let sous = liste(&m["dielectriques"]).iter().position(|d| (f(&d["z1"]) - f(&bloc["z0"])).abs() < 1e-9);
            let cible = match sous {
                Some(i) => subs[i],
                None => *air_trou.get_or_insert_with(|| csx.materiau("air_trou", 1.0, 0.0)),
            };
            csx.polygone(cible, 11, &pts(trou), z0, longueur);
        }
        // 3. Les conducteurs sans decoupe (pistes de signal, brins d'antenne, pastilles)
        // a priorite 12. Ils passent PAR-DESSUS les decoupes pour ne pas etre
        // effaces par une encoche d'isolation ou un degagement de plan de masse.
        for poly in polys.iter().filter(|p| !p["t"].vrai()) {
            csx.polygone(cu, 12, &pts(&poly["o"]), z0, longueur);
        }
    }

    // -- 4. Les vias -----------------------------------------------------
    // Cylindres PLEINS et non tubes creux : a ces frequences l'epaisseur de peau
    // fait quelques microns, le courant ne voit pas la difference, et un tube
    // demanderait deux cellules dans la metallisation — un maillage dix fois plus
    // fin pour rien.
    if m["vias"].vrai() {
        let vias = csx.metal("vias");
        for v in liste(&m["vias"]) {
            let (x, y) = (lit(f(&v["x"]), DEC), lit(f(&v["y"]), DEC));
            csx.cylindre(vias, 13, [x, y, lit(f(&v["z0"]), DEC)], [x, y, lit(f(&v["z1"]), DEC)], lit(f(&v["r"]), DEC));
        }
    }

    // -- 4bis. Les objets qui ne sont pas sur la carte ---------------------
    // Une antenne ne rayonne jamais toute seule : elle est dans un boitier,
    // au-dessus d'une batterie, au bout d'un cable. Le metal est ici un
    // CONDUCTEUR PARFAIT : un boitier en volume avec une conductivite finie
    // demanderait de mailler l'epaisseur de peau, soit quelques microns.
    for o in liste(&m["primitives"]) {
        let nom = _ident(txt(&o["nom"]), "obj");
        let v = if txt(&o["materiau"]) == "metal" {
            csx.metal(&nom)
        } else {
            csx.materiau(&nom, lit(f(&o["er"]), 4), lit_e(_kappa(f(&o["er"]), f(&o["df"]), f(&b["f0"])), 6))
        };
        let pr = o["priorite"].as_i64().unwrap_or(0);
        match txt(&o["type"]) {
            "fil" => {
                let mut e = Elt::new("Wire").a("Priority", pr.to_string()).n("WireRadius", lit(f(&o["r"]), DEC));
                for q in liste(&o["pts"]) {
                    e = e.e(point("Vertex", [lit(f(&q[0]), 5), lit(f(&q[1]), 5), lit(f(&q[2]), 5)]));
                }
                csx.props[v].prims.push(e);
            }
            "cylindre" => csx.cylindre(v, pr, p3(&o["a"]), p3(&o["b"]), lit(f(&o["r"]), DEC)),
            "boite" => csx.boite(v, pr, p3(&o["a"]), p3(&o["b"])),
            _ => csx.sphere(v, pr, p3(&o["c"]), lit(f(&o["r"]), DEC)),
        }
    }

    // -- 4ter. Les pieces importees (STEP, STL) : boitier, piles, vis -------
    // Chaque corps est un POLYEDRE FERME : des triangles, et CSXCAD decide
    // qu'une cellule est dedans en comptant les traversees d'un rayon. Un
    // polyedre ouvert, ou dont les sommets ne sont pas recolles, y serait vu
    // vide PARTOUT, sans avertissement : le modele a verifie avant que chaque
    // arete borde deux triangles.
    //
    // LES TRIANGLES SONT DANS LE FICHIER, et non dans un STL a cote : un fichier
    // annexe se perd a la premiere copie, et le calcul qu'on rejoue dans six mois
    // se ferait alors sans son boitier -- sans que rien ne le dise. Les sommets
    // sont PLACES (rotation et position appliquees), en mm, sans arrondi.
    //
    // Priorites : un plastique cede a la carte -- substrat a 1, cuivre a 10 et
    // plus --, un metal passe au-dessus.
    for (n, (p, c)) in corps_inclus(pieces).enumerate() {
        let Some(inclus) = &c.inclus else { continue };
        let nom = format!("{}_{}", _ident(&format!("{}_{}", p.nom, c.nom), "piece"), n);
        let v = if c.materiau == "metal" {
            csx.metal(&nom)
        } else {
            csx.materiau(&nom, lit(c.er, 4), lit_e(_kappa(c.er, c.df, f_kappa), 6))
        };
        let mut e = Elt::new("Polyhedron").a("Priority", inclus.priorite.to_string());
        for s in inclus.geo.sommets.chunks_exact(3) {
            e = e.e(Elt::new("Vertex").t(liste_nb(s.iter().copied())));
        }
        for t in inclus.geo.faces.chunks_exact(3) {
            e = e.e(Elt::new("Face").t(format!("{},{},{}", t[0], t[1], t[2])));
        }
        csx.props[v].prims.push(e);
    }

    // -- 5. Le maillage --------------------------------------------------
    // LA MEME PRECISION QUE PARTOUT AILLEURS, ET C'EST UNE CORRECTION. Les
    // lignes s'ecrivaient a CINQ decimales quand les cotes des ports
    // s'ecrivaient a six : un port a y = 30,111544 tombait sur une grille qui
    // disait 30,11154, sa boite d'excitation -- plate en x et en y -- ne
    // contenait alors aucune composante de champ, et openEMS calculait
    // jusqu'au bout une energie rigoureusement nulle. Voir `_coller_ports`
    // dans le modele : deux nombres egaux dans le modele doivent s'ecrire
    // pareil dans le fichier, sinon le collage ne sert a rien.
    //
    // La regle du tiers (une ligne a un tiers dehors, deux tiers dedans de
    // chaque arete de conducteur) et les bandes fines sont DEJA dans ces lignes :
    // ce qui est ecrit ici est la grille du calcul, entiere.
    let lignes = lignes_ecrites(m);
    let mut grille = Elt::new("RectilinearGrid").a("DeltaUnit", "0.001").a("CoordSystem", "0");
    for (axe, l) in ["XLines", "YLines", "ZLines"].iter().zip(&lignes) {
        grille = grille.e(Elt::new(axe).a("Qty", l.len().to_string()).t(liste_nb(l.iter().copied())));
    }

    // -- 6. Les ports ----------------------------------------------------
    let ports = ports::poser(&mut csx, m, &subs, &lignes)?;

    // -- 7. La boite de champ lointain -----------------------------------
    // Elle enregistre le champ tangentiel sur une surface fermee autour de
    // l'antenne ; le diagramme de rayonnement s'en deduit apres coup par
    // transformation champ proche / champ lointain. Elle doit etre DANS la boite
    // de calcul mais HORS de la PML, sinon elle integre un champ deja absorbe :
    // `CreateNF2FFBox` la pose une ligne apres la derniere couche absorbante.
    let mut nf2ff = Vec::new();
    if m["nf2ff"]["actif"].vrai() {
        let retrait = boite["pml"].as_i64().unwrap_or(8) as usize + 1;
        let (mut debut, mut fin) = ([0.0; 3], [0.0; 3]);
        for (n, l) in lignes.iter().enumerate() {
            if l.len() <= 2 * retrait {
                return Err(refus("La boite de champ lointain ne tient pas dans le maillage : pas assez de lignes hors de la PML.",
                                 "Agrandissez la marge d'air, ou reduisez le nombre de couches de PML."));
            }
            debut[n] = l[retrait];
            fin[n] = l[l.len() - 1 - retrait];
        }
        // Une sonde par champ, six faces chacune : openEMS numerote alors les fichiers
        // par face, « nf2ff_E_0.h5 » a « nf2ff_E_5.h5 ». Type 0/1 : E et H temporels ;
        // mode 1 : interpole aux noeuds ; fichier 1 : HDF5.
        let dump = |csx: &mut Csx, nom: &str, genre: i64| {
            let e = csx.prop("DumpBox", nom).a("Number", "0").a("Type", "0").a("Weight", "1").a("NormDir", "-1")
                .a("DumpType", genre.to_string()).a("DumpMode", "1").a("FileType", "1").a("MultiGridLevel", "0");
            csx.poser(e)
        };
        let e = dump(&mut csx, "nf2ff_E", 0);
        let h = dump(&mut csx, "nf2ff_H", 1);
        for ny in 0..3 {
            let (mut a, mut b2) = (debut, fin);
            b2[ny] = a[ny];
            csx.boite(e, 0, a, b2);
            csx.boite(h, 0, a, b2);
            (a, b2) = (debut, fin);
            a[ny] = b2[ny];
            csx.boite(e, 0, a, b2);
            csx.boite(h, 0, a, b2);
        }
        nf2ff = (0..6).map(|n| (format!("nf2ff_E_{n}.h5"), format!("nf2ff_H_{n}.h5"))).collect();
    }

    // -- 7bis. Les enregistrements de champ --------------------------------
    // Mode FREQUENTIEL : un champ complexe par frequence demandee, soit quelques
    // fichiers. C'est ce qu'il faut pour voir OU passe le courant — la question
    // qu'un S11 ne repond pas. Mode TEMPOREL : openEMS ecrit un fichier PAR PAS
    // DE TEMPS ; utile pour une animation, ruineux pour le disque.
    // Fichiers .vtr (grille rectiligne VTK).
    let d = &m["dumps"];
    if d["actif"].vrai() {
        let frequentiel = txt(&d["mode"]) == "frequentiel";
        let s = d["sous_ech"].as_i64().unwrap_or(1);
        for nom in liste(&d["types"]).iter().filter_map(|t| t.as_str()) {
            let Some(genre) = DUMP_TYPES.iter().find(|t| t.0 == nom) else { continue };
            let mut e = csx.prop("DumpBox", nom).a("Number", "0").a("Type", "0").a("Weight", "1").a("NormDir", "-1")
                .a("DumpType", (if frequentiel { genre.2 } else { genre.1 }).to_string()).a("DumpMode", "0").a("FileType", "0")
                .a("MultiGridLevel", "0").a("SubSampling", format!("{s},{s},{s}"));
            if frequentiel {
                e = e.e(Elt::new("FD_Samples").t(liste_nb(liste(&d["f"]).iter().map(|v| lit_e(f(v), 6)))));
            }
            let v = csx.poser(e);
            csx.boite(v, 0, [lit(f(&d["x1"]), DEC), lit(f(&d["y1"]), DEC), lit(f(&d["z1"]), DEC)],
                      [lit(f(&d["x2"]), DEC), lit(f(&d["y2"]), DEC), lit(f(&d["z2"]), DEC)]);
        }
    }

    // -- l'en-tete : ce que l'assistant a choisi, en clair -----------------
    let mut racine = Elt::new("openEMS");
    let nom = _com(txt(&m["nom"]));
    racine.com(&format!("Simulation openEMS : {}", if nom.is_empty() { "antenne" } else { &nom }));
    racine.com("Fichier produit par l'outil « Antenne openEMS ». Il est autonome : « openEMS antenne.xml » le rejoue.");
    racine.com(&format!("Bande simulee : {} a {} GHz ({} points)", fmt_g(f(&b["f1"]) / 1e9, 4), fmt_g(f(&b["f2"]) / 1e9, 4),
                        b["n"].as_i64().unwrap_or(0)));
    racine.com(&format!("Impulsion : f0 = {} GHz, fc = {} GHz", fmt_g(f(&b["f0"]) / 1e9, 4), fmt_g(f(&b["fc"]) / 1e9, 4)));
    racine.com(&format!("Maillage : {} x {} x {} lignes, {} cellules ; memoire estimee {:.0} Mo", lignes[0].len(), lignes[1].len(),
                        lignes[2].len(), est["cellules"].as_i64().unwrap_or(0), f(&est["memoire_Mo"])));
    racine.com(&format!("Pas vise : {} mm dans l'air, {} mm dans le dielectrique (er max = {})", _f(f(&m["resolution"]["air"]), 4),
                        _f(f(&m["resolution"]["die"]), 4), _f(f(&m["resolution"]["er_max"]), 3)));
    racine.com(&format!("Marge : {} mm d'air physique entre l'antenne et l'absorbeur, pour {} conseilles{}",
                        _f(f(&boite["air_restant"]), 3), _f(f(&boite["air_utile"]), 3),
                        if boite["marge_suffisante"].vrai() { "" } else { " : C'EST INSUFFISANT" }));
    let structure = Elt::new("ContinuousStructure").a("CoordSystem", "0").e(grille)
        .e(Elt::new("BackgroundMaterial").a("Epsilon", "1").a("Mue", "1").a("Kappa", "0").a("Sigma", "0")).e(csx.elt());
    Ok(Simulation { xml: document(&racine.e(fdtd).e(structure)), ports, nf2ff })
}

fn pts(v: &Json) -> Vec<(f64, f64)> {
    liste(v).iter().map(|q| (f(&q[0]), f(&q[1]))).collect()
}

/// Un dielectrique de Debye, ecrit directement.
///
/// POURQUOI LE SCRIPT PYTHON FAISAIT UN DETOUR, ET POURQUOI IL N'Y EN A PLUS. Les
/// liaisons Python de CSXCAD 0.6.3 n'exposent aucun materiau dispersif : le script
/// ecrivait la structure, convertissait le <Material> en <DebyeMaterial> dans le
/// XML, et la relisait. Ici le XML est notre sortie : le materiau y est pose tel
/// que cette conversion le laissait.
///
/// LE PIEGE QUI RESTE : les poles sont des ATTRIBUTS de l'element <Property>,
/// nommes EpsilonDelta_p / EpsilonRelaxTime_p, et non un element a part. Mal
/// places, ils sont lus comme des zeros : le solveur annonce alors « debye
/// relaxation time is to small, skipping » et le materiau ressort SANS PERTES,
/// sans que rien d'autre ne le signale. Le solveur doit annoncer « Drude/Lorentz
/// Dispersive Material Extension » avec des « Active cells » NON NULLES.
fn materiau_debye(csx: &mut Csx, nom: &str, jeu: &Json) -> usize {
    let trois = |v: f64| liste_nb([v, v, v]);
    // eps_inf remplace eps_r : le reste vient des poles. kappa ne doit PAS
    // s'ajouter aux poles, sinon les pertes sont comptees deux fois.
    let mut prop = Elt::new("Property").a("Epsilon", trois(lit_e(f(&jeu["eps_inf"]), 8))).a("Mue", "1,1,1").a("Kappa", "0,0,0")
        .a("Sigma", "0,0,0").a("Density", "0");
    let mut poids = Elt::new("Weight").a("Epsilon", "1,1,1").a("Mue", "1,1,1").a("Kappa", "1,1,1").a("Sigma", "1,1,1").a("Density", "1");
    for (i, p) in liste(&jeu["poles"]).iter().enumerate() {
        prop = prop.a(&format!("EpsilonDelta_{}", i + 1), trois(lit_e(f(&p["de"]), 8)))
            .a(&format!("EpsilonRelaxTime_{}", i + 1), trois(lit_e(f(&p["tau"]), 8)));
        poids = poids.a(&format!("EpsilonDelta_{}", i + 1), "1,1,1").a(&format!("EpsilonRelaxTime_{}", i + 1), "1,1,1");
    }
    let e = csx.prop("DebyeMaterial", nom).a("Isotropy", "1").e(prop).e(poids);
    csx.poser(e)
}

// ==========================================================================
// Le banc de vitesse
// --------------------------------------------------------------------------
// UNE BOITE VIDE, LE MEME NOMBRE DE PAS, UN NOMBRE DE FILS DIFFERENT A CHAQUE
// FOIS. Ce qu'on veut savoir n'est pas la vitesse d'une antenne, c'est la
// FORME de la courbe vitesse / fils sur ce poste : ou elle plafonne, et si
// elle redescend. Une boite vide la donne en une minute, la ou l'antenne
// elle-meme demanderait un quart d'heure de maillage par essai.
//
// ASSEZ GROSSE POUR SORTIR DES CACHES. Une boite qui tiendrait dans le cache
// du processeur irait plus vite par cellule que n'importe quelle vraie carte,
// et son optimum serait celui d'un autre regime : trois millions de cellules
// pesent trois cents megaoctets, tres loin de tout cache.
//
// UN PROCESSUS PAR ESSAI : un solveur qui garderait un etat d'un calcul au
// suivant fausserait le deuxieme essai, et l'on ne verrait pas lequel.
//
// Les valeurs absolues sont plus hautes que sur une vraie antenne (ni PML, ni
// materiaux, ni enregistrements) : ce sont les RAPPORTS qui servent.
// ==========================================================================
pub const BANC_LIGNES: [usize; 3] = [180, 180, 90]; // 181 x 181 x 91 lignes : ~2,9 M cellules
pub const BANC_PAS: usize = 300;

/// Le XML du banc de vitesse : le meme pour tous les essais, les fils passent en argument.
pub fn generer_banc() -> String {
    let [nx, ny, _] = BANC_LIGNES;
    let mut csx = Csx::default();
    let (x, y) = ((nx / 2) as f64, (ny / 2) as f64);
    // FDTD.AddLumpedPort(1, 50, [x, y, 0], [x, y, 4], 'z', excite=1)
    let r = csx.resistance("port_resist_1", 2, 50.0);
    csx.boite(r, 0, [x, y, 0.0], [x, y, 4.0]);
    let e = csx.excitation("port_excite_1", [0.0, 0.0, -1.0], 0.0);
    csx.boite(e, 0, [x, y, 0.0], [x, y, 4.0]);
    let u = csx.sonde("port_ut_1", 0, -1.0, -1);
    csx.boite(u, 0, [x, y, 0.0], [x, y, 4.0]);
    let i = csx.sonde("port_it_1", 1, 1.0, 2);
    csx.boite(i, 0, [x, y, 2.0], [x, y, 2.0]);
    let mut bords = Elt::new("BoundaryCond");
    for face in ["xmin", "xmax", "ymin", "ymax", "zmin", "zmax"] {
        bords = bords.a(face, "PEC");
    }
    // endCriteria : le script passait 0 (« ne jamais s'arreter sur l'energie ») ; dans le XML
    // un zero veut dire « valeur d'usine », d'ou ce seuil qu'aucune energie n'atteint.
    let fdtd = Elt::new("FDTD").a("NumberOfTimesteps", BANC_PAS.to_string()).a("endCriteria", "1e-30").n("f_max", 3e9)
        .e(Elt::new("Excitation").a("Type", "0").n("f0", 2e9).n("fc", 1e9)).e(bords);
    let mut grille = Elt::new("RectilinearGrid").a("DeltaUnit", "0.001").a("CoordSystem", "0");
    for (axe, n) in ["XLines", "YLines", "ZLines"].iter().zip(BANC_LIGNES) {
        grille = grille.e(Elt::new(axe).a("Qty", (n + 1).to_string()).t(liste_nb((0..=n).map(|v| v as f64))));
    }
    let mut racine = Elt::new("openEMS");
    racine.com("Banc de vitesse openEMS : la meme boite vide, un nombre de fils different a chaque essai.");
    document(&racine.e(fdtd).e(Elt::new("ContinuousStructure").a("CoordSystem", "0").e(grille).e(csx.elt())))
}

/// Le lisez-moi qui accompagne le XML exporte.
pub fn lisez_moi(m: &Json, nom_xml: &str) -> String {
    let fils = m["fils"].as_i64().unwrap_or(0);
    let b = &m["bande"];
    let mut t = String::new();
    t.push_str(&format!("Simulation openEMS : {}\n\n", _com(txt(&m["nom"]))));
    t.push_str("Ce fichier XML est ce que l'outil « Antenne openEMS » donne au solveur : la geometrie,\n");
    t.push_str("le maillage, les ports et leurs sondes, les conditions aux limites. Il est autonome.\n\n");
    t.push_str("Pour le lancer, dans un dossier vide ou il ecrira ses resultats :\n\n");
    t.push_str(&format!("    openEMS {nom_xml}{} -vvv\n\n", if fils > 0 { format!(" --numThreads={fils}") } else { String::new() }));
    // LES FILS DE CALCUL. Sans --numThreads, openEMS part d'UN fil et en ajoute tant que la
    // vitesse monte : le tatonnement s'arrete souvent a deux ou trois, quel que soit le
    // nombre de coeurs. Le banc de vitesse de l'outil mesure le bon nombre pour CE poste.
    t.push_str("Sans --numThreads, openEMS tatonne et s'arrete souvent a deux ou trois fils : le banc de\n");
    t.push_str("vitesse de l'outil mesure le bon nombre pour un poste donne, qui n'est pas celui d'un autre.\n\n");
    t.push_str(&format!("Bande : {} a {} GHz, {} points. Impulsion gaussienne f0 = {} GHz, fc = {} GHz.\n", fmt_g(f(&b["f1"]) / 1e9, 4),
                        fmt_g(f(&b["f2"]) / 1e9, 4), b["n"].as_i64().unwrap_or(0), fmt_g(f(&b["f0"]) / 1e9, 4), fmt_g(f(&b["fc"]) / 1e9, 4)));
    t.push_str(&format!("Arret : energie residuelle a {} dB, ou {} pas de temps au plus.\n\n", fmt_g(f(&m["arret"]["energie_dB"]), 4),
                        m["arret"]["nmax"].as_i64().unwrap_or(0)));
    t.push_str("Ce qu'il ecrit : un fichier texte par sonde de port (port_ut_N : tension, port_it_N :\n");
    t.push_str("courant ; colonnes temps en secondes et valeur), les enregistrements de champ demandes\n");
    t.push_str("(.vtr) et, si le champ lointain est actif, nf2ff_E_*.h5 et nf2ff_H_*.h5 pour « nf2ff ».\n");
    t.push_str("Le passage en frequence (S11, impedance, ROE) est fait par l'outil a partir de ces sondes.\n");
    t
}
