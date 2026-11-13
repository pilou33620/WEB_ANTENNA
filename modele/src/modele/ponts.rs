//! L'ecart que le maillage referme, et les lignes qui l'ouvrent (openems_modele.py, de
//! `_Seau` a `_elargir_cellules`).

use super::*;
use std::collections::{HashMap, HashSet};

// ==========================================================================
// L'ecart que le maillage referme
// --------------------------------------------------------------------------
// DEUX CUIVRES SEPARES SUR LE DESSIN PEUVENT N'EN FAIRE QU'UN DANS LE SOLVEUR.
// openEMS decide arete par arete : une arete de la grille est du metal quand
// son milieu tombe dans un polygone de metal. Deux aretes de metal qui
// partagent un noeud forment un conducteur continu ; un noeud qui sert a la
// fois une arete de l'antenne et une arete de la masse les SOUDE, quel que
// soit l'ecart dessine. Il suffit pour cela qu'aucune ligne de maillage ne
// tombe dans l'ecart.
//
// Le cas qui l'a fait ecrire, sur P01x274PCB-C.xml : la pastille RF du point
// de test PTST401 (1,2 mm) dans sa reserve du plan de masse, a 0,21 mm du
// bord, sur les deux couches internes, sous une maille de 0,43 mm ; et ses
// deux broches de masse a 0,38 mm, sur les quatre couches. Le port voyait
// une self de 0,9 nH -- le trou metallise de la pastille --, et le calcul a
// tourne une heure trois quarts pour rendre un S11 plat a 0 dB, que rien ne
// distinguait d'une antenne desaccordee.
//
// LE TEST REJOUE LA REGLE, IL NE LA DEVINE PAS. Comparer l'ecart a « la
// taille de la maille » se tromperait dans les deux sens : un ecart de 0,2 mm
// est franc si une ligne tombe dedans, et un de 0,4 mm soude si aucune n'y
// tombe. On pose donc les aretes de la VRAIE grille au voisinage de chaque
// bord d'antenne, et l'on cherche un noeud partage. Au voisinage seulement :
// un pont est forcement a moins d'une maille d'un bord, et le cout reste
// proportionnel au perimetre de l'antenne, pas a la surface de la carte.
//
// UN CONTACT DESSINE N'EST PAS UN PONT. La patte d'un IFA touche la masse, et
// c'est voulu : un noeud partage la ou l'ecart dessine est nul n'apprend
// rien, et il est ecarte.
pub const PONT_CONTACT_MM: f64 = 0.001; // en dessous, le cuivre se touche sur le dessin
pub const PONT_ARETES_MAX: i64 = 400000; // borne du travail, pour une selection enorme

/// Des objets ranges par case d'une grille grossiere, selon leur boite :
/// ne parcourir, pour un point, que ce qui peut le contenir.
struct _Seau {
    pas: f64,
    cases: HashMap<(i64, i64), Vec<usize>>,
}

impl _Seau {
    fn new(pas: f64) -> _Seau {
        _Seau { pas, cases: HashMap::new() }
    }

    fn _plage(&self, x0: f64, y0: f64, x1: f64, y1: f64) -> impl Iterator<Item = (i64, i64)> {
        let p = self.pas;
        let (j0, j1) = ((y0 / p).floor() as i64, (y1 / p).floor() as i64);
        ((x0 / p).floor() as i64..=(x1 / p).floor() as i64).flat_map(move |i| (j0..=j1).map(move |j| (i, j)))
    }

    fn poser(&mut self, boite: [f64; 4], objet: usize) {
        for k in self._plage(boite[0], boite[1], boite[2], boite[3]) {
            self.cases.entry(k).or_default().push(objet);
        }
    }

    /// Les objets des cases autour de (x, y), chacun une fois, dans l'ordre ou ils se presentent.
    fn autour(&self, x: f64, y: f64, r: f64) -> Vec<usize> {
        let mut vus = HashSet::new();
        let mut out = Vec::new();
        for k in self._plage(x - r, y - r, x + r, y + r) {
            for &o in self.cases.get(&k).map(|v| v.as_slice()).unwrap_or(&[]) {
                if vus.insert(o) {
                    out.push(o);
                }
            }
        }
        out
    }
}

/// Le point du segment [a, b] le plus proche de (px, py).
fn _proj_point_seg(px: f64, py_: f64, a: P, b: P) -> P {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let l2 = dx * dx + dy * dy;
    let t = if l2 <= 0.0 { 0.0 } else { maxi(0.0, mini(1.0, ((px - a.0) * dx + (py_ - a.1) * dy) / l2)) };
    (a.0 + t * dx, a.1 + t * dy)
}

/// Distance entre deux segments, et les deux points qui la realisent --
/// le premier sur [a, b], le second sur [c, d]. Nulle s'ils se coupent.
fn _proches_seg_seg(a: P, b: P, c: P, d: P) -> (f64, P, P) {
    let orient = |p: P, q: P, r: P| (q.0 - p.0) * (r.1 - p.1) - (q.1 - p.1) * (r.0 - p.0);
    let (o1, o2) = (orient(a, b, c), orient(a, b, d));
    let (o3, o4) = (orient(c, d, a), orient(c, d, b));
    if ((o1 > 0.0) != (o2 > 0.0)) && ((o3 > 0.0) != (o4 > 0.0)) && o1 != 0.0 && o2 != 0.0 && o3 != 0.0 && o4 != 0.0 {
        return (0.0, a, a);
    }
    let paires = [(_proj_point_seg(c.0, c.1, a, b), c),
                  (_proj_point_seg(d.0, d.1, a, b), d),
                  (a, _proj_point_seg(a.0, a.1, c, d)),
                  (b, _proj_point_seg(b.0, b.1, c, d))];
    let ecart = |pq: &(P, P)| py::hypot(pq.0 .0 - pq.1 .0, pq.0 .1 - pq.1 .1);
    let mut choix = paires[0];
    for pq in &paires[1..] {
        if ecart(pq) < ecart(&choix) {
            choix = *pq;
        }
    }
    (ecart(&choix), choix.0, choix.1)
}

// --------------------------------------------------------------------------
// L'ordre d'un set de Python
// --------------------------------------------------------------------------
// `_ponts_couche` parcourt un set de noeuds (i, j), et l'ordre de ce parcours se voit : c'est
// lui qui range les aretes de metal de chaque noeud, donc l'ordre dans lequel `_couper_arete`
// pose ses lignes, donc `ecarts_ouverts.lignes`. Cet ordre n'a rien d'aleatoire -- le hachage
// d'un tuple d'entiers est fixe -- mais il est celui de la table de CPython : on la rejoue ici
// (Objects/setobject.c et tuplehash de Objects/tupleobject.c, CPython 3.8 a 3.13).

/// hash((i, j)) pour deux entiers positifs.
fn hash_noeud(n: (i64, i64)) -> u64 {
    const P1: u64 = 11400714785074694791;
    const P2: u64 = 14029467366897019727;
    const P5: u64 = 2870177450012600261;
    let mut acc = P5;
    for lane in [n.0 as u64, n.1 as u64] {
        acc = acc.wrapping_add(lane.wrapping_mul(P2));
        acc = acc.rotate_left(31);
        acc = acc.wrapping_mul(P1);
    }
    acc = acc.wrapping_add(2 ^ (P5 ^ 3527539));
    if acc == u64::MAX { 1546275796 } else { acc }
}

/// Un set de noeuds (i, j) qui se parcourt dans l'ordre de CPython. On n'y fait qu'ajouter.
pub(super) struct Noeuds {
    table: Vec<Option<((i64, i64), u64)>>,
    n: usize,
}

const SONDES: usize = 9; // LINEAR_PROBES

impl Noeuds {
    pub fn new() -> Noeuds {
        Noeuds { table: vec![None; 8], n: 0 }
    }

    pub fn len(&self) -> usize {
        self.n
    }

    /// La case libre ou tombe ce hachage, ou celle qui porte deja la cle.
    fn case(table: &[Option<((i64, i64), u64)>], cle: Option<(i64, i64)>, h: u64) -> (usize, bool) {
        let masque = table.len() - 1;
        let mut i = h as usize & masque;
        let mut perturb = h;
        loop {
            let sondes = if i + SONDES <= masque { SONDES } else { 0 };
            for k in i..=i + sondes {
                match table[k] {
                    None => return (k, false),
                    Some((c, hc)) if hc == h && Some(c) == cle => return (k, true),
                    _ => {}
                }
            }
            perturb >>= 5;
            i = (i.wrapping_mul(5).wrapping_add(1).wrapping_add(perturb as usize)) & masque;
        }
    }

    pub fn add(&mut self, cle: (i64, i64)) {
        let h = hash_noeud(cle);
        let (k, deja) = Noeuds::case(&self.table, Some(cle), h);
        if deja {
            return;
        }
        self.table[k] = Some((cle, h));
        self.n += 1;
        if self.n * 5 < (self.table.len() - 1) * 3 {
            return;
        }
        // set_table_resize : la table grandit, et tout y est repose dans l'ordre de l'ancienne
        let vise = if self.n > 50000 { self.n * 2 } else { self.n * 4 };
        let mut taille = 8;
        while taille <= vise {
            taille <<= 1;
        }
        let mut neuve = vec![None; taille];
        for e in self.table.iter().flatten() {
            let (k, _) = Noeuds::case(&neuve, None, e.1);
            neuve[k] = Some(*e);
        }
        self.table = neuve;
    }

    pub fn iter(&self) -> impl Iterator<Item = (i64, i64)> + '_ {
        self.table.iter().flatten().map(|e| e.0)
    }
}

/// bisect.bisect_right : le premier indice dont la valeur depasse v.
fn bisect_right(t: &[f64], v: f64) -> usize {
    t.partition_point(|x| *x <= v)
}

/// Un endroit ou la grille soude l'antenne a la masse.
#[derive(Debug, Clone)]
pub(super) struct Site {
    pub couche: String,
    pub x: f64,
    pub y: f64,
    pub ecart: f64,
    pub cx: f64,
    pub cy: f64,
    pub pa: P,
    pub pm: P,
    /// Pour couper (`grappes` faux) : les autres bouts des aretes de metal du noeud, et la
    /// distance du noeud a chacun des deux cuivres.
    pub coupe: Option<Coupe>,
}

#[derive(Debug, Clone)]
pub(super) struct Coupe {
    pub bords_a: Vec<(&'static str, f64)>,
    pub bords_m: Vec<(&'static str, f64)>,
    pub da: f64,
    pub dm: f64,
}

impl Site {
    pub fn json(&self) -> Json {
        let mut s = obj! {"couche" => self.couche.clone(), "x" => self.x, "y" => self.y, "ecart" => self.ecart,
                          "cx" => self.cx, "cy" => self.cy,
                          "pa" => nombres([self.pa.0, self.pa.1]), "pm" => nombres([self.pm.0, self.pm.1])};
        if let Some(c) = &self.coupe {
            let bords = |b: &[(&str, f64)]| Json::Liste(b.iter().map(|(a, v)| Json::Liste(vec![(*a).into(), (*v).into()])).collect());
            poser(&mut s, "bords_a", bords(&c.bords_a));
            poser(&mut s, "bords_m", bords(&c.bords_m));
            poser(&mut s, "da", c.da);
            poser(&mut s, "dm", c.dm);
        }
        s
    }
}

/// Les endroits ou la grille soude le cuivre de l'antenne a celui de la
/// masse, couche par couche. Rend une liste de sites, du plus etroit au plus
/// large : {couche, x, y, ecart, cx, cy}.
///
/// Muet quand la masse n'est pas connue (aucun polygone marque « m ») : sur
/// un fichier sans connectivite, tout le cuivre est dans le meme sac, et la
/// question n'a pas de reponse -- comme pour `_avis_ports_court_circuit`.
pub fn _ponts_de_maille(m: &Json, grappes: bool) -> Vec<Json> {
    let (mx, my) = (reels(&m["maillage"]["x"]), reels(&m["maillage"]["y"]));
    ponts(&cuivre_de(m), &mx, &my, f(&m["resolution"]["die"]), grappes).iter().map(Site::json).collect()
}

/// `_ponts_de_maille`, sur le cuivre et la grille deja relus.
pub(super) fn ponts(cuivre: &[Bloc], mx: &[f64], my: &[f64], res_die: f64, grappes: bool) -> Vec<Site> {
    if !cuivre.iter().flat_map(|b| &b.polys).any(|q| q.m) {
        return Vec::new();
    }
    if mx.len() < 2 || my.len() < 2 {
        return Vec::new();
    }
    // Un pont est a moins d'une maille d'un bord d'antenne : une et demie
    // laisse de la place a une cellule plus large que le pas du dielectrique.
    let portee = 1.5 * res_die;
    let pas = maxi(portee, 0.5);

    let mut sites = Vec::new();
    let mut budget = PONT_ARETES_MAX;
    for b in cuivre {
        let ant: Vec<&Poly> = b.polys.iter().filter(|q| !q.m && !q.mixte).collect();
        let mas: Vec<&Poly> = b.polys.iter().filter(|q| q.m && !q.mixte).collect();
        if ant.is_empty() || mas.is_empty() {
            continue;
        }
        sites.extend(_ponts_couche(&b.couche, &ant, &mas, mx, my, portee, pas, &mut budget, grappes));
        if budget <= 0 {
            break;
        }
    }
    sites.sort_by(|a, b| croissant(&a.ecart, &b.ecart));
    sites
}

/// Les polygones d'un cuivre, ranges pour y chercher : leurs surfaces et leurs aretes.
struct Range {
    surfaces: Vec<_Surface>,
    seau_s: _Seau,
    aretes: Vec<(P, P)>,
    seau_a: _Seau,
}

impl Range {
    fn new(polys: &[&Poly], pas: f64) -> Range {
        let mut r = Range { surfaces: Vec::new(), seau_s: _Seau::new(pas), aretes: Vec::new(), seau_a: _Seau::new(pas) };
        for q in polys {
            let s = _Surface::new(q, pas);
            r.seau_s.poser(s.boite, r.surfaces.len());
            r.surfaces.push(s);
            for anneau in std::iter::once(&q.o).chain(&q.t) {
                let n = anneau.len();
                for k in 0..n {
                    let (a, c) = (anneau[k], anneau[(k + 1) % n]);
                    r.seau_a.poser([mini(a.0, c.0), mini(a.1, c.1), maxi(a.0, c.0), maxi(a.1, c.1)], r.aretes.len());
                    r.aretes.push((a, c));
                }
            }
        }
        r
    }

    fn dedans(&self, x: f64, y: f64) -> bool {
        self.seau_s.autour(x, y, 0.0).into_iter().any(|i| {
            let s = &self.surfaces[i];
            let bx = &s.boite;
            bx[0] <= x && x <= bx[2] && bx[1] <= y && y <= bx[3] && s._dedans(x, y)
        })
    }

    fn aretes_autour(&self, x: f64, y: f64, r: f64) -> impl Iterator<Item = (P, P)> + '_ {
        self.seau_a.autour(x, y, r).into_iter().map(|i| self.aretes[i])
    }

    /// La distance du point a ce cuivre (nulle dedans), `portee` s'il n'y a rien autour.
    fn dist(&self, x: f64, y: f64, portee: f64) -> f64 {
        if self.dedans(x, y) {
            return 0.0;
        }
        self.aretes_autour(x, y, portee).map(|sg| {
            let p = _proj_point_seg(x, y, sg.0, sg.1);
            py::hypot(p.0 - x, p.1 - y)
        }).reduce(mini).unwrap_or(portee)
    }
}

/// `_ponts_de_maille` sur une couche.
#[allow(clippy::too_many_arguments)]
fn _ponts_couche(couche: &str, ant: &[&Poly], mas: &[&Poly], mx: &[f64], my: &[f64], portee: f64, pas: f64,
                 budget: &mut i64, grappes: bool) -> Vec<Site> {
    let r_ant = Range::new(ant, pas);
    let r_mas = Range::new(mas, pas);

    // LES ARETES A EXAMINER : celles qui passent a moins de `portee` d'un bord
    // d'antenne. Chaque bord est decoupe en troncons de `portee` au plus, pour
    // qu'un long bord en biais n'embrasse pas un carre de la carte entiere.
    let mut aretes = Noeuds::new();
    for q in ant {
        for anneau in std::iter::once(&q.o).chain(&q.t) {
            let n = anneau.len();
            for k in 0..n {
                let (a, c) = (anneau[k], anneau[(k + 1) % n]);
                let lg = py::hypot(c.0 - a.0, c.1 - a.1);
                let morceaux = ((lg / portee).ceil() as i64).max(1);
                for t in 0..morceaux {
                    let (u0, u1) = (t as f64 / morceaux as f64, (t + 1) as f64 / morceaux as f64);
                    let x0 = a.0 + (c.0 - a.0) * u0;
                    let y0 = a.1 + (c.1 - a.1) * u0;
                    let x1 = a.0 + (c.0 - a.0) * u1;
                    let y1 = a.1 + (c.1 - a.1) * u1;
                    let i0 = _place(mx, mini(x0, x1) - portee).saturating_sub(1);
                    let i1 = (mx.len() - 1).min(bisect_right(mx, maxi(x0, x1) + portee));
                    let j0 = _place(my, mini(y0, y1) - portee).saturating_sub(1);
                    let j1 = (my.len() - 1).min(bisect_right(my, maxi(y0, y1) + portee));
                    for i in i0..=i1 {
                        for j in j0..=j1 {
                            aretes.add((i as i64, j as i64));
                        }
                    }
                    if aretes.len() as i64 > *budget {
                        break;
                    }
                }
            }
        }
    }

    // Chaque noeud (i, j) porte deux aretes : vers (i+1, j) et vers (i, j+1).
    let (mut n_ant, mut n_mas, mut recouvre) = (HashSet::new(), HashSet::new(), HashSet::new());
    // Les aretes de metal de chaque noeud, pour `_ouvrir_ecarts` : c'est l'une
    // d'elles qu'il coupe quand les lignes au tiers n'ont pas suffi.
    let (mut bords_a, mut bords_m): (HashMap<(i64, i64), Vec<(i64, i64)>>, HashMap<(i64, i64), Vec<(i64, i64)>>) = Default::default();
    for (i, j) in aretes.iter() {
        let (iu, ju) = (i as usize, j as usize);
        let mut voisins = Vec::new();
        if iu + 1 < mx.len() {
            voisins.push(((i + 1, j), ((mx[iu] + mx[iu + 1]) / 2.0, my[ju])));
        }
        if ju + 1 < my.len() {
            voisins.push(((i, j + 1), (mx[iu], (my[ju] + my[ju + 1]) / 2.0)));
        }
        for (fin, milieu) in voisins {
            let da = r_ant.dedans(milieu.0, milieu.1);
            let dm = r_mas.dedans(milieu.0, milieu.1);
            if da && dm {
                recouvre.extend([(i, j), fin]);
            } else if da {
                n_ant.extend([(i, j), fin]);
                bords_a.entry((i, j)).or_default().push(fin);
                bords_a.entry(fin).or_default().push((i, j));
            } else if dm {
                n_mas.extend([(i, j), fin]);
                bords_m.entry((i, j)).or_default().push(fin);
                bords_m.entry(fin).or_default().push((i, j));
            }
        }
    }
    *budget -= aretes.len() as i64;

    let mut noeuds: Vec<(i64, i64)> = n_ant.intersection(&n_mas).filter(|n| !recouvre.contains(n)).copied().collect();
    noeuds.sort();

    // Un site par grappe : les noeuds d'un meme ecart se suivent le long du
    // bord, et en faire autant de lignes noierait l'avis.
    let mut out: Vec<Site> = Vec::new();
    for (i, j) in noeuds {
        let (iu, ju) = (i as usize, j as usize);
        let (x, y) = (mx[iu], my[ju]);
        if grappes && out.iter().any(|s| (x - s.x).abs() <= 2.0 * portee && (y - s.y).abs() <= 2.0 * portee) {
            continue;
        }
        let cx = maxi(if iu > 0 { mx[iu] - mx[iu - 1] } else { 0.0 },
                      if iu + 1 < mx.len() { mx[iu + 1] - mx[iu] } else { 0.0 });
        let cy = maxi(if ju > 0 { my[ju] - my[ju - 1] } else { 0.0 },
                      if ju + 1 < my.len() { my[ju + 1] - my[ju] } else { 0.0 });
        // L'ECART DESSINE, AU NOEUD : la plus courte distance entre un bord
        // d'antenne et un bord de masse. Nulle, c'est un contact voulu.
        // A UNE MAILLE DU NOEUD, PAS DANS TOUT LE SEAU : les aretes du noeud
        // n'atteignent pas plus loin. Mesure sur tout le voisinage, la patte de
        // court-circuit de l'IFA de P01x274PCB-C.xml -- un contact dessine, a
        // 4,7 mm -- donnait un ecart nul au pied de l'alimentation, soude a
        // 0,21 mm de la masse : pris pour un contact voulu, il n'etait ni
        // ouvert ni dit, et le port voyait un court-circuit.
        let r = maxi(cx, cy);
        let boite = [x - r, y - r, x + r, y + r];
        let bords_ant: Vec<(P, P)> = r_ant.aretes_autour(x, y, r).filter_map(|sa| _couper_seg(sa, &boite)).collect();
        let bords_mas: Vec<(P, P)> = r_mas.aretes_autour(x, y, r).filter_map(|sm| _couper_seg(sm, &boite)).collect();
        let proche = bords_ant.iter().flat_map(|sa| bords_mas.iter().map(move |sm| _proches_seg_seg(sa.0, sa.1, sm.0, sm.1).0))
            .reduce(mini);
        let Some(ecart) = proche.filter(|e| !(*e < PONT_CONTACT_MM)) else { continue };
        // OU COUPER, EN CE NOEUD-LA : le pied du noeud sur le bord d'antenne,
        // puis le point de masse en face. Les deux points les plus proches de
        // tout le voisinage ne vont pas : le long d'un ecart droit, tous se
        // valent, et le calcul rendait un coin de la pastille a 1,2 mm du
        // noeud soude -- des lignes posees ailleurs que la ou il fallait.
        let mut pied: Option<(P, P, f64)> = None;
        for sa in r_ant.aretes_autour(x, y, portee) {
            let fa = _proj_point_seg(x, y, sa.0, sa.1);
            for sm in r_mas.aretes_autour(x, y, portee) {
                let fm = _proj_point_seg(fa.0, fa.1, sm.0, sm.1);
                let d = py::hypot(fm.0 - fa.0, fm.1 - fa.1) + py::hypot(fa.0 - x, fa.1 - y);
                if pied.is_none_or(|p| d < p.2) {
                    pied = Some((fa, fm, d));
                }
            }
        }
        // Sans arete a portee des deux cuivres (une cellule plus large que la portee), le
        // Python echouait ici ; le site est laisse.
        let Some((pa, pm, _)) = pied else { continue };
        let coupe = (!grappes).then(|| {
            // Pour couper : les autres bouts des aretes de metal du noeud, et
            // la distance du noeud a chacun des deux cuivres (nulle dedans).
            let autre = |n: &(i64, i64)| if n.1 == j { ("x", mx[n.0 as usize]) } else { ("y", my[n.1 as usize]) };
            let bords = |b: &HashMap<(i64, i64), Vec<(i64, i64)>>| b.get(&(i, j)).map(|l| l.iter().map(autre).collect()).unwrap_or_default();
            Coupe { bords_a: bords(&bords_a), bords_m: bords(&bords_m),
                    da: r_ant.dist(x, y, portee), dm: r_mas.dist(x, y, portee) }
        });
        out.push(Site { couche: couche.to_string(), x, y, ecart, cx, cy, pa, pm, coupe });
    }
    out
}

// ==========================================================================
// Ouvrir les ecarts soudes : deux lignes dans l'ecart, et seulement la
// --------------------------------------------------------------------------
// AFFINER TOUTE LA CARTE POUR UN ECART DE 0,21 mm COUTERAIT DES JOURS. Ce qu'il
// faut, c'est qu'aucune arete de la grille n'enjambe l'ecart avec son milieu
// dans le metal ; deux lignes y suffisent, posees au tiers et aux deux tiers :
// l'arete qui les joint a son milieu au milieu de l'ecart -- dans le vide --,
// et chacune des deux lignes ne peut plus toucher qu'un seul des deux cuivres.
// UNE seule ligne au milieu ne suffit pas, et c'est verifie : ses deux aretes
// voisines peuvent avoir chacune leur milieu dans un metal different, et le
// noeud du milieu soude alors les deux.
//
// DANS L'AXE OU L'ECART EST LE PLUS LARGE -- en travers de lui. Un ecart en
// biais (deux pastilles rondes en diagonale) recoit les deux axes.
//
// LE PRIX EST DIT, PAS CACHE : ces lignes font des cellules du tiers de
// l'ecart, et c'est la plus petite cellule qui fixe le pas de temps de tout le
// calcul. L'avis le chiffre. En dessous de ECART_OUVRABLE_MM, on n'ouvre pas :
// un ecart de dix microns est un reste d'export, pas une fente, et l'ouvrir
// diviserait le pas de temps par vingt.
//
// LE CONTROLE EST REJOUE APRES CHAQUE TOUR, sur la grille enrichie : une ligne
// posee pour un ecart peut en souder un autre a cote, ou n'avoir pas suffi a
// un ecart en biais. Au bout de ECARTS_TOURS, ce qui reste est rendu tel quel
// a `_avis_ponts_de_maille`.
pub const ECART_OUVRABLE_MM: f64 = 0.08;
// LE PLANCHER DES CELLULES QUE CES LIGNES FABRIQUENT. Chaque ecart se regle
// sans voir les autres, et deux ecarts voisins -- les deux cotes d'un meme
// ruban, deux pastilles cote a cote -- posaient leurs lignes a 0,016 mm l'une
// de l'autre : un pas de temps divise par quatre pour tout le calcul, et
// quatorze heures annoncees au lieu de trois (P01x274PCB-C.xml, port sur
// A400.1). Une ligne qui tomberait plus pres qu'ECART_CELLULE_MIN_MM d'une
// ligne deja posee n'est pas posee : celle qui est la tient sa place, et le
// controle rejoue au tour suivant dit si cela suffit.
pub const ECART_CELLULE_MIN_MM: f64 = 0.03;
pub const ECARTS_TOURS: usize = 8;

/// Le bilan de `_ouvrir_ecarts` : les lignes posees par axe, et ce qu'elles ont ouvert.
struct Bilan {
    n: [i64; 2],
    sites: usize,
    plus_petit_ecart: Option<f64>,
    lignes: [Vec<f64>; 2],
    elargies: Option<i64>,
}

/// La grille du plan, x puis y, que `_ouvrir_ecarts` complete en place.
type Grille = [Vec<f64>; 2];

fn rang_axe(axe: &str) -> usize {
    if axe == "x" { 0 } else { 1 }
}

/// Insere la ligne c dans la liste triee t, sauf si une ligne est deja a
/// moins de `marge` : elle fait l'affaire, et une seconde a cote ne ferait
/// qu'une cellule-copeau. Le bilan garde la trace de chaque ligne posee :
/// `_coupable_cellule` doit pouvoir dire qu'une cellule mince vient d'ici.
fn _inserer(t: &mut Vec<f64>, c: f64, marge: f64, bilan: &mut Bilan, axe: usize) -> bool {
    let k = _place(t, c);
    if (k < t.len() && t[k] - c < marge) || (k > 0 && c - t[k - 1] < marge) {
        return false;
    }
    t.insert(k, c);
    bilan.n[axe] += 1;
    bilan.lignes[axe].push(c);
    true
}

/// La plus petite cellule d'une suite de lignes, une fois triee.
fn plus_serre(mut pos: Vec<f64>) -> f64 {
    pos.sort_by(croissant);
    pos.windows(2).map(|w| w[1] - w[0]).reduce(mini).unwrap_or(f64::INFINITY)
}

/// Les deux lignes a poser dans l'ecart ]a, b[, placees pour que la plus
/// petite cellule qui en sort soit la plus large possible.
///
/// AU TIERS ET AUX DEUX TIERS, C'EST L'IDEAL SUR UNE GRILLE VIDE. Sur la
/// vraie, une ligne voisine tombe souvent juste a cote -- l'arete du cuivre,
/// une ligne d'affinage --, et la ligne au tiers faisait avec elle une
/// cellule de 0,03 mm, soit un pas de temps divise par trois pour tout le
/// calcul (P01x274PCB-C.xml). On essaie donc une grille de positions, une de
/// chaque cote du milieu, et l'on garde le couple qui ecarte le plus toutes
/// les lignes les unes des autres. Une ligne deja DANS l'ecart compte : elle
/// peut tenir lieu de l'une des deux.
fn _meilleures_coupes(t: &[f64], a: f64, b: f64) -> Vec<f64> {
    let g = b - a;
    let k0 = _place(t, a - g);
    let k1 = bisect_right(t, b + g);
    let voisines = &t[k0.saturating_sub(1)..(k1 + 1).min(t.len())];
    let n = 12;
    let gauche: Vec<f64> = (0..=n).map(|i| a + g * (0.08 + 0.40 * i as f64 / n as f64)).collect();
    let droite: Vec<f64> = (0..=n).map(|i| a + g * (0.52 + 0.40 * i as f64 / n as f64)).collect();
    let avec = |c: &[f64]| plus_serre(voisines.iter().chain(c).copied().collect());
    let (mut meilleur, mut score) = (Vec::new(), -1.0);
    for &c1 in &gauche {
        for &c2 in &droite {
            let d = avec(&[c1, c2]);
            if d > score {
                (meilleur, score) = (vec![c1, c2], d);
            }
        }
    }
    // Une seule ligne manque quand une autre est deja dans l'ecart, loin de
    // ses bords : on ne pose que celle de l'autre cote.
    for &v in voisines.iter().filter(|v| a < **v && **v < b) {
        for &c in if v < a + g / 2.0 { &droite } else { &gauche } {
            let d = avec(&[c]);
            if d > score {
                (meilleur, score) = (vec![c], d);
            }
        }
    }
    meilleur
}

/// Premier remede : deux lignes au tiers et aux deux tiers de l'ecart, en
/// travers de lui -- dans l'axe ou il est le plus large, les deux s'il est
/// en biais.
fn _lignes_au_tiers(s: &Site, lignes: &mut Grille, bilan: &mut Bilan) -> bool {
    let ((ax, ay), (bx, by)) = (s.pa, s.pm);
    let (dx, dy) = ((bx - ax).abs(), (by - ay).abs());
    let part = dx / maxi(dx + dy, 1e-12);
    let axes: &[usize] = if 0.4 < part && part < 0.6 { &[0, 1] } else if dx >= dy { &[0] } else { &[1] };
    let mut neuf = false;
    for &axe in axes {
        let (a, b) = if axe == 0 { (mini(ax, bx), maxi(ax, bx)) } else { (mini(ay, by), maxi(ay, by)) };
        let g = b - a;
        if g < ECART_OUVRABLE_MM {
            continue;
        }
        for c in _meilleures_coupes(&lignes[axe], a, b) {
            if _inserer(&mut lignes[axe], c, maxi(g / 12.0, ECART_CELLULE_MIN_MM), bilan, axe) {
                neuf = true;
            }
        }
    }
    neuf
}

/// Second remede, quand le noeud reste soude malgre les lignes au tiers --
/// un ecart courbe, une couronne mince autour d'une pastille ronde, que des
/// lignes droites traversent en biais. On COUPE EN DEUX les aretes de metal
/// du noeud, du cote du cuivre le plus eloigne de lui : une arete n'atteint
/// le metal que si son milieu y tombe, et chaque coupure divise sa portee
/// par deux. Le noeud etant dans l'ecart a une distance non nulle de ce
/// cuivre-la, quelques coupures suffisent a l'en detacher. Du cote du cuivre
/// le plus proche -- ou il est dedans --, couper ne servirait a rien.
fn _couper_arete(s: &Site, lignes: &mut Grille, bilan: &mut Bilan) -> bool {
    let Some(coupe) = &s.coupe else { return false };
    let bords = if coupe.da >= coupe.dm { &coupe.bords_a } else { &coupe.bords_m };
    let mut neuf = false;
    for (axe, autre) in bords {
        let ici = if *axe == "x" { s.x } else { s.y };
        let c = (ici + autre) / 2.0;
        if (autre - ici).abs() / 2.0 < ECART_CELLULE_MIN_MM {
            continue;
        }
        if _inserer(&mut lignes[rang_axe(axe)], c, ECART_CELLULE_MIN_MM, bilan, rang_axe(axe)) {
            neuf = true;
        }
    }
    neuf
}

/// Pose des lignes dans les ecarts que la grille soude. Modifie
/// m["maillage"] en place ; rend le bilan {x, y, sites}.
pub(super) fn _ouvrir_ecarts(m: &mut Json, cuivre: &[Bloc]) -> Json {
    let mut lignes: Grille = [reels(&m["maillage"]["x"]), reels(&m["maillage"]["y"])];
    let res_die = f(&m["resolution"]["die"]);
    let mut bilan = Bilan { n: [0, 0], sites: 0, plus_petit_ecart: None, lignes: [Vec::new(), Vec::new()], elargies: None };
    let mut deja = HashSet::new();
    // Le compte annonce est celui des GRAPPES, comme dans l'avis des ponts :
    // un ecart le long d'un bord soude une dizaine de noeuds, c'est un ecart.
    bilan.sites = ponts(cuivre, &lignes[0], &lignes[1], res_die, true).len();
    if bilan.sites != 0 {
        for _ in 0..ECARTS_TOURS {
            // TOUS LES NOEUDS, PAS UN PAR GRAPPE : le representant d'une grappe
            // est souvent un coin, et c'est le long du bord que l'ecart se coupe.
            let sites = ponts(cuivre, &lignes[0], &lignes[1], res_die, false);
            let mut neuf = false;
            for s in &sites {
                if s.ecart < ECART_OUVRABLE_MM {
                    continue;
                }
                let cle = (s.couche.clone(), (py::round(s.x, 3) + 0.0).to_bits(), (py::round(s.y, 3) + 0.0).to_bits());
                // Les lignes au tiers d'abord ; si elles sont deja la, ou si le
                // noeud a survecu a un tour, on coupe ses aretes.
                if deja.contains(&cle) || !_lignes_au_tiers(s, &mut lignes, &mut bilan) {
                    neuf |= _couper_arete(s, &mut lignes, &mut bilan);
                } else {
                    neuf = true;
                }
                deja.insert(cle);
                bilan.plus_petit_ecart = Some(bilan.plus_petit_ecart.map_or(s.ecart, |e| mini(e, s.ecart)));
            }
            if !neuf {
                break;
            }
        }
        _elargir_cellules(m, cuivre, &mut lignes, &mut bilan);
    }
    let mut out = obj! {"x" => bilan.n[0], "y" => bilan.n[1], "sites" => bilan.sites,
                        "plus_petit_ecart" => bilan.plus_petit_ecart.map(Json::Flottant).unwrap_or(Json::Nul),
                        "lignes" => obj! {"x" => nombres(bilan.lignes[0].iter().copied()),
                                          "y" => nombres(bilan.lignes[1].iter().copied())}};
    if let Some(n) = bilan.elargies {
        poser(&mut out, "elargies", n);
    }
    let [x, y] = lignes;
    poser(champ(m, "maillage"), "x", nombres(x));
    poser(champ(m, "maillage"), "y", nombres(y));
    out
}

// LA PLUS PETITE CELLULE, REPRISE APRES COUP. Chaque ecart se regle sans voir
// les autres, et une ligne d'ecart finissait a 0,034 mm d'une ligne de grille
// que l'ecart n'avait pas vue (P01x274PCB-C.xml, ruban d'alimentation en L4) :
// 564 000 pas de temps, 49 h annoncees. Une fois tous les ecarts ouverts, on
// reprend la plus petite cellule de chaque axe tant qu'une ligne d'ecart la
// borde : on essaie de retirer cette ligne, puis de la deplacer entre ses deux
// voisines, du plus large au plus serre, et le controle des ponts est REJOUE
// a chaque essai -- un essai qui ressoude quoi que ce soit est defait. On
// s'arrete au plancher de l'axe : en dessous d'elle, une cellule n'est plus
// un accident.
pub const ELARGIR_ESSAIS: i64 = 60;

fn _elargir_cellules(m: &Json, cuivre: &[Bloc], lignes: &mut Grille, bilan: &mut Bilan) {
    if bilan.lignes[0].is_empty() && bilan.lignes[1].is_empty() {
        return;
    }
    let res_die = f(&m["resolution"]["die"]);
    // CE QUI COMPTE, CE SONT LES ECARTS SOUDES, PAS LEUR NOMBRE. Un essai qui
    // ressoude un ecart ici en liberant un noeud la garderait le meme compte.
    // Un essai est sain quand chaque noeud soude qu'il laisse l'etait deja
    // avant lui -- meme couche, memes points de cuivre en regard, a une
    // demi-maille pres (le noeud bouge avec la ligne). Les ecarts trop minces
    // pour etre ouverts (un contact d'IFA dessine a 10 microns) ne jugent rien :
    // le maillage n'y peut rien, et ils sont deja dans l'avis des ponts.
    let soudes = |lignes: &Grille| -> Vec<Site> {
        ponts(cuivre, &lignes[0], &lignes[1], res_die, false).into_iter().filter(|s| s.ecart >= ECART_OUVRABLE_MM).collect()
    };
    let tol = 0.5 * res_die;
    let base = soudes(lignes);
    let connu = |s: &Site| base.iter().any(|b| {
        b.couche == s.couche
            && py::hypot(b.pa.0 - s.pa.0, b.pa.1 - s.pa.1) <= tol
            && py::hypot(b.pm.0 - s.pm.0, b.pm.1 - s.pm.1) <= tol
    });
    let reste = std::cell::Cell::new(ELARGIR_ESSAIS);
    let sain = |lignes: &Grille| -> bool {
        reste.set(reste.get() - 1);
        soudes(lignes).iter().all(&connu)
    };

    for (axe, nom) in ["x", "y"].into_iter().enumerate() {
        let cible = f(&m["maillage_detail"]["plancher"][nom]);
        // Seule la plus petite cellule de l'axe compte pour le pas de temps :
        // des qu'elle resiste -- deux lignes de grille, ou aucun essai sain --,
        // elargir les suivantes ne gagnerait rien.
        while reste.get() > 0 && lignes[axe].len() > 2 {
            let k = plus_petite_cellule(&lignes[axe]);
            let (a, b) = (lignes[axe][k], lignes[axe][k + 1]);
            let d = b - a;
            if d >= cible {
                break;
            }
            let ecart: Vec<f64> = [a, b].into_iter().filter(|v| bilan.lignes[axe].contains(v)).collect();
            if ecart.is_empty() {
                break;
            }
            let mut fait = false;
            for v in ecart {
                let Some(j) = lignes[axe].iter().position(|w| *w == v) else { continue };
                if j == 0 || j == lignes[axe].len() - 1 {
                    continue;
                }
                let (g, dr) = (lignes[axe][j - 1], lignes[axe][j + 1]);
                let Some(posee) = bilan.lignes[axe].iter().position(|w| *w == v) else { continue };
                // Retirer la ligne : la cellule devient dr - g.
                lignes[axe].remove(j);
                if sain(lignes) {
                    bilan.lignes[axe].remove(posee);
                    bilan.n[axe] -= 1;
                    bilan.elargies = Some(bilan.elargies.unwrap_or(0) + 1);
                    fait = true;
                    break;
                }
                lignes[axe].insert(j, v);
                if reste.get() <= 0 {
                    break;
                }
                // La deplacer : du centre vers les bords, et seulement la ou
                // la plus petite des deux cellules voisines grandit.
                let mut essais: Vec<f64> = (1..8).map(|i| g + (dr - g) * i as f64 / 8.0).collect();
                essais.sort_by(|p, q| croissant(&-mini(p - g, dr - p), &-mini(q - g, dr - q)));
                for c in essais {
                    if mini(c - g, dr - c) <= d + 1e-9 || reste.get() <= 0 {
                        break;
                    }
                    lignes[axe][j] = c;
                    if sain(lignes) {
                        bilan.lignes[axe][posee] = c;
                        bilan.elargies = Some(bilan.elargies.unwrap_or(0) + 1);
                        fait = true;
                        break;
                    }
                    lignes[axe][j] = v;
                }
                if fait {
                    break;
                }
            }
            if !fait {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Noeuds;

    #[test]
    fn ordre_d_un_set_de_python() {
        // relevés sur Python 3.13 : list(set((i * 7 % 13, i * 5 % 11) for i in range(40)))
        let mut s = Noeuds::new();
        for i in 0..40 {
            s.add((i * 7 % 13, i * 5 % 11));
        }
        let attendu = [(12, 10), (3, 7), (5, 4), (4, 6), (9, 2), (8, 3), (10, 0), (0, 8), (1, 9), (2, 8), (7, 4), (6, 5), (12, 0),
                       (12, 9), (4, 5), (5, 6), (3, 6), (8, 2), (9, 1), (10, 2), (11, 1), (0, 10), (2, 7), (11, 10), (1, 8), (6, 4),
                       (7, 3), (4, 7), (3, 8), (5, 5), (8, 4), (9, 3), (0, 0), (11, 0), (10, 1), (0, 9), (2, 9), (1, 10), (7, 5), (6, 3)];
        assert_eq!(s.iter().collect::<Vec<_>>(), attendu);
        // ... et set((i, j) for i in range(300) for j in range(250)) : la table grandit autrement au-delà de 50 000
        let mut s = Noeuds::new();
        for i in 0..300 {
            for j in 0..250 {
                s.add((i, j));
                s.add((i, j));
            }
        }
        let l: Vec<_> = s.iter().collect();
        assert_eq!(s.len(), 75000);
        assert_eq!(&l[..6], &[(165, 216), (113, 26), (206, 217), (247, 26), (16, 93), (90, 42)]);
        assert_eq!((&l[74997..], l[40000]), (&[(14, 47), (0, 149), (74, 98)][..], (106, 236)));
    }
}
