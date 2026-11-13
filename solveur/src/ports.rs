//! Les ports : la geometrie des connecteurs, les sources, et les sondes de tension et de
//! courant que le depouillement relira.
//!
//! Ce module refait ce que faisaient, appeles par le script, `LumpedPort` et `MSLPort`
//! d'openEMS 0.0.36 (python/openEMS/ports.py, relu dans ses sources) et la classe
//! `PortCoaxial` que le script portait lui-meme : memes boites, memes noms de sonde,
//! memes poids, dans le meme ordre.
//!
//! UN SEUL PORT EXCITE, ET C'EST UNE DEFINITION AVANT D'ETRE UN REGLAGE.
//! S(j,i) vaut « ce qui sort en j quand SEUL i excite » : deux excitations
//! simultanees superposeraient leurs ondes dans la boite et aucun parametre S
//! ne se deduirait du melange. Les autres ports sont donc poses en CHARGE :
//! fermes sur leur impedance, ils absorbent ce qui leur arrive et le
//! mesurent. C'est exactement ce qu'est un analyseur de reseau a un port
//! charge : cinquante ohms et un voltmetre. (Un RESEAU, lui, excite plusieurs
//! ports ensemble : ce que chacun renvoie est alors son coefficient de
//! reflexion ACTIF, couplages compris.)

use antenne_modele::modele::ErreurModele;
use antenne_modele::Json;

use crate::xml::{_die_contre, _disque, f, liste, lit, lit_e, refus, txt, Csx, DEC, P3};

/// Comment un port se depouille.
#[derive(Debug, Clone, PartialEq)]
pub enum GenrePort {
    /// Element localise : l'impedance de reference est sa resistance.
    Localise { r: f64 },
    /// Coaxial : Z0 analytique de la ligne, et le deport du plan de mesure jusqu'a la carte.
    Coaxial { z0: f64, er: f64, deport: f64 },
    /// Microruban : Z0 et propagation MESURES entre trois sondes de tension et deux de courant.
    Microruban { u_delta: [f64; 2], i_delta: f64, plan: f64, deport: f64 },
}

/// Les fichiers de sonde d'un port, et ce qu'il faut pour les lire.
#[derive(Debug, Clone, PartialEq)]
pub struct PortMesure {
    pub n: i64,
    pub excite: bool,
    pub u: Vec<String>,
    pub i: Vec<String>,
    pub genre: GenrePort,
}

fn axe(nom: &str) -> usize {
    match nom {
        "x" => 0,
        "y" => 1,
        _ => 2,
    }
}

fn signe(v: f64) -> f64 {
    if v > 0.0 { 1.0 } else if v < 0.0 { -1.0 } else { 0.0 }
}

/// np.argmin(np.abs(lignes - cote)) : le premier des plus proches.
fn plus_proche(lignes: &[f64], cote: f64) -> usize {
    let mut i = 0;
    for (k, l) in lignes.iter().enumerate() {
        if (l - cote).abs() < (lignes[i] - cote).abs() {
            i = k;
        }
    }
    i
}

/// Le retard d'un port dephase d'un reseau, zero sinon.
///
/// La phase d'un port est rendue par un RETARD de l'impulsion : voir
/// `_retards` dans le modele.
fn retard(p: &Json) -> f64 {
    let r = f(&p["retard_s"]);
    if p["excite"].vrai() && r > 0.0 { lit_e(r, 6) } else { 0.0 }
}

/// Pose tous les ports dans la structure. `subs` : le rang de la propriete de chaque
/// dielectrique ; `lignes` : le maillage tel qu'il est ecrit.
pub fn poser(csx: &mut Csx, m: &Json, subs: &[usize], lignes: &[Vec<f64>; 3]) -> Result<Vec<PortMesure>, ErreurModele> {
    let volume = m["modele_cuivre"].as_str() == Some("volume");
    let mut air = None;
    let mut out = Vec::new();
    for p in liste(&m["ports"]) {
        let n = p["n"].as_i64().unwrap_or(1);
        let excite = if p["excite"].vrai() { 1.0 } else { 0.0 };
        let r = lit(f(&p["R"]), 3);
        if p["msl"].vrai() {
            out.push(microruban(csx, p, n, excite, r, lignes)?);
            continue;
        }
        if !p["coax"].vrai() {
            // -- element localise : une resistance repartie sur un petit volume, orientee
            // selon le sens du champ electrique a l'entree.
            let a = [lit(f(&p["x1"]), DEC), lit(f(&p["y1"]), DEC), lit(f(&p["z1"]), DEC)];
            let b = [lit(f(&p["x2"]), DEC), lit(f(&p["y2"]), DEC), lit(f(&p["z2"]), DEC)];
            out.push(localise(csx, n, r, a, b, axe(txt(&p["dir"])), excite, retard(p))?);
            continue;
        }

        // -- connecteur coaxial ------------------------------------------
        // Les S sont ramenes a la SURFACE DE LA CARTE par un deport de plan de
        // reference (voir le depouillement) : sans lui, le S11 tournerait sur
        // l'abaque de Smith de toute la longueur du connecteur, et l'impedance lue
        // ne serait pas celle de l'antenne.
        let c = &p["coax"];
        let (x, y) = (lit(f(&p["x"]), DEC), lit(f(&p["y"]), DEC));
        let (z_bas, z_gaine) = (lit(f(&c["z_bas"]), DEC), lit(f(&c["z_gaine"]), DEC));
        let die = csx.materiau(&format!("coax_d{n}"), lit(f(&c["er"]), 4), 0.0);
        let met = csx.metal(&format!("coax_m{n}"));
        // Le dielectrique du cable d'abord, l'ame et la gaine par-dessus :
        // c'est la priorite qui tranche, pas l'ordre d'ajout.
        csx.cylindre(die, 4, [x, y, z_bas], [x, y, z_gaine], lit(f(&c["rb"]), DEC));
        csx.cylindre(met, 20, [x, y, z_bas], [x, y, lit(f(&c["z_ame"]), DEC)], lit(f(&c["ra"]), DEC));
        csx.coque(met, 20, [x, y, z_bas], [x, y, z_gaine], lit(f(&c["rb"]) + f(&c["ep_gaine"]) / 2.0, DEC), lit(f(&c["ep_gaine"]), DEC));
        // LES DEGAGEMENTS. Sans eux l'ame touche le cuivre qu'elle traverse : le
        // port est un court-circuit franc, le S11 vaut 0 dB sur toute la bande, et
        // rien dans le resultat ne dit pourquoi.
        //
        // AU-DESSUS DU CUIVRE, ET C'EST TOUT LE SUJET. Le degagement etait
        // emis a la priorite 11, celle des DECOUPES d'un versement -- or un
        // plan de masse SANS decoupe n'est pas emis comme un versement : il
        // part avec les pistes, a la priorite 12. Douze bat onze : le
        // degagement ne percait rien, l'ame du coaxial touchait le plan, et
        // le port etait un court-circuit franc. La simulation le dit sans
        // ambiguite -- Z = 0,0 + 1,5j ohms au plan de reference, |S11| = 0
        // dB sur toute la bande, et openEMS signale en passant un
        // « Unused primitive (type: Polygon) » sur le dielectrique.
        //
        // QUINZE, ET NON TREIZE : treize est la priorite des vias. Un via
        // pris dans le degagement d'un connecteur est une faute de dessin,
        // et c'est alors la geometrie du connecteur qui doit se voir --
        // mais surtout, deux primitives de meme priorite se departagent dans
        // un ordre que rien ne garantit. L'ame et la gaine, elles, restent
        // a 20 : le degagement creuse le cuivre, il ne creuse pas le
        // connecteur.
        for d in liste(&c["degagements"]) {
            let cible = match _die_contre(m, f(&d["z0"])).or_else(|| _die_contre(m, f(&d["z1"]))) {
                Some(i) => subs[i],
                None => *air.get_or_insert_with(|| csx.materiau("coax_air", 1.0, 0.0)),
            };
            // Le disque part des cotes du modele, et s'arrondit a l'ecriture.
            let disque = _disque(f(&p["x"]), f(&p["y"]), f(&d["r"]));
            // Une feuille conductrice est une SURFACE : ce qui la perce doit en etre une aussi.
            let longueur = volume.then(|| lit(f(&d["z1"]) - f(&d["z0"]), DEC));
            csx.polygone(cible, 15, &disque, lit(f(&d["z0"]), DEC), longueur);
        }
        out.push(coaxial(csx, p, n, x, y, excite, &lignes[2]));
    }
    Ok(out)
}

/// `LumpedPort` : la resistance, la source, une sonde de tension le long de l'axe et une
/// sonde de courant au milieu.
#[allow(clippy::too_many_arguments)]
pub fn localise(csx: &mut Csx, n: i64, r: f64, a: P3, b: P3, ny: usize, excite: f64, retard: f64) -> Result<PortMesure, ErreurModele> {
    let sens = signe(b[ny] - a[ny]);
    if sens == 0.0 {
        return Err(refus(format!("Le port {n} n'a aucune longueur dans le sens de son excitation."),
                         "Ses deux bornes sont a la meme cote : verifiez les couches « de » et « a » du port."));
    }
    let res = if r > 0.0 { csx.resistance(&format!("port_resist_{n}"), ny, r) } else { csx.metal(&format!("port_resist_{n}")) };
    csx.boite(res, 50, a, b);
    if excite != 0.0 {
        let mut vec = [0.0; 3];
        vec[ny] = -sens * excite;
        let e = csx.excitation(&format!("port_excite_{n}"), vec, retard);
        csx.boite(e, 50, a, b);
    }
    let milieu = [0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]), 0.5 * (a[2] + b[2])];
    let (mut u1, mut u2) = (milieu, milieu);
    u1[ny] = a[ny];
    u2[ny] = b[ny];
    let u = csx.sonde(&format!("port_ut_{n}"), 0, -1.0, -1);
    csx.boite(u, 0, u1, u2);
    let (mut i1, mut i2) = (a, b);
    i1[ny] = milieu[ny];
    i2[ny] = milieu[ny];
    let i = csx.sonde(&format!("port_it_{n}"), 1, sens, ny as i64);
    csx.boite(i, 0, i1, i2);
    Ok(PortMesure { n, excite: excite != 0.0, u: vec![format!("port_ut_{n}")], i: vec![format!("port_it_{n}")], genre: GenrePort::Localise { r } })
}

/// `MSLPort` : pose SUR la ligne d'alimentation, du point d'alimentation au pied de
/// l'antenne. La source et sa resistance sont au debut ; trois sondes de tension et deux
/// de courant, au milieu, mesurent le Z0 et la propagation de la ligne TELLE QU'ELLE EST
/// MAILLEE. Le depouillement ramene la mesure au pied de l'antenne.
fn microruban(csx: &mut Csx, p: &Json, n: i64, excite: f64, feed_r: f64, lignes: &[Vec<f64>; 3]) -> Result<PortMesure, ErreurModele> {
    let q = &p["msl"];
    let metal = csx.metal(&format!("msl_{n}"));
    let prop = axe(txt(&q["axe"]));
    let exc = 2;
    let (deb, fin, t1, t2) = (lit(f(&q["debut"]), DEC), lit(f(&q["fin"]), DEC), lit(f(&q["t1"]), DEC), lit(f(&q["t2"]), DEC));
    let (zr, zm) = (lit(f(&q["z_ruban"]), DEC), lit(f(&q["z_masse"]), DEC));
    let (a, b): (P3, P3) = if prop == 0 { ([deb, t1, zr], [fin, t2, zm]) } else { ([t1, deb, zr], [t2, fin, zm]) };
    let sens = signe(b[prop] - a[prop]);
    let renverse = signe(b[exc] - a[exc]);
    let l = &lignes[prop];
    if (0..3).any(|k| a[k] == b[k]) || l.len() <= 5 {
        return Err(refus(format!("Le port microruban {n} ne peut pas etre pose : ligne de longueur ou de largeur nulle, ou moins de six lignes de maillage dans son sens."),
                         "Verifiez la ligne d'alimentation declaree, ou revenez au port localise."));
    }
    // le ruban du port
    let mut b_ruban = b;
    b_ruban[exc] = a[exc];
    csx.boite(metal, 50, a, b_ruban);

    // le plan de mesure, a mi-longueur, pose sur une ligne de maillage
    let pos = a[prop] + 0.5 * (a[prop] - b[prop]).abs() * sens;
    let im = plus_proche(l, pos).clamp(1, l.len() - 2);
    let plan = (a[prop] - l[im]).abs();
    let mut idx = [im - 1, im, im + 1];
    if sens < 0.0 {
        idx.reverse();
    }
    let u_pos = idx.map(|k| l[k]);
    let u_delta = [u_pos[1] - u_pos[0], u_pos[2] - u_pos[1]];
    let milieu = [0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]), 0.5 * (a[2] + b[2])];
    let (mut us, mut is) = (Vec::new(), Vec::new());
    for (k, lettre) in ["A", "B", "C"].iter().enumerate() {
        let (mut u1, mut u2) = (milieu, milieu);
        u1[prop] = u_pos[k];
        u2[prop] = u_pos[k];
        u1[exc] = a[exc];
        u2[exc] = b[exc];
        let nom = format!("port_ut_{n}{lettre}");
        let s = csx.sonde(&nom, 0, 1.0, -1);
        csx.boite(s, 0, u1, u2);
        us.push(nom);
    }
    // les courants : a mi-chemin entre deux sondes de tension, parce que dans une grille
    // de Yee H vit une demi-cellule plus loin que E
    let i_pos = [u_pos[0] + u_delta[0] / 2.0, u_pos[1] + u_delta[1] / 2.0];
    for (k, lettre) in ["A", "B"].iter().enumerate() {
        let (mut i1, mut i2) = (a, b);
        i2[exc] = a[exc];
        i1[prop] = i_pos[k];
        i2[prop] = i_pos[k];
        let nom = format!("port_it_{n}{lettre}");
        let s = csx.sonde(&nom, 1, sens, prop as i64);
        csx.boite(s, 0, i1, i2);
        is.push(nom);
    }
    if excite != 0.0 {
        let k = plus_proche(l, a[prop]);
        let (mut e1, mut e2) = (a, b);
        e1[prop] = l[k];
        e2[prop] = l[k];
        let mut vec = [0.0; 3];
        vec[exc] = -renverse * excite;
        let e = csx.excitation(&format!("port_excite_{n}"), vec, retard(p));
        csx.boite(e, 50, e1, e2);
    }
    let mut r2 = b;
    r2[prop] = a[prop];
    if feed_r == 0.0 {
        csx.boite(metal, 0, a, r2);
    } else if feed_r > 0.0 && feed_r.is_finite() {
        let res = csx.resistance(&format!("port_resist_{n}"), exc, feed_r);
        csx.boite(res, 0, a, r2);
    }
    let deport = lit((f(&q["fin"]) - f(&q["debut"])).abs(), 6);
    Ok(PortMesure { n, excite: excite != 0.0, u: us, i: is,
                    genre: GenrePort::Microruban { u_delta, i_delta: i_pos[1] - i_pos[0], plan, deport } })
}

/// Le port coaxial, que les liaisons Python d'openEMS 0.0.36 n'avaient pas et que le
/// script construisait lui-meme.
///
/// CE QU'UN PORT LOCALISE NE PEUT PAS FAIRE ICI, et c'est la raison d'etre de
/// ce port : sa sonde de courant est un segment pose dans le plan
/// PERPENDICULAIRE a l'excitation. Pour une excitation radiale, ce plan
/// contient l'axe du cable -- la sonde ne peut par construction pas encercler
/// l'ame, le courant axial ne traverse jamais sa surface, et l'impedance rendue
/// n'a aucun rapport avec celle de la ligne. Il faut une BOUCLE FERMEE autour
/// de l'ame, dans un plan perpendiculaire a l'axe : une sonde de courant de
/// normale z sur une boite carree centree sur l'ame.
///
/// DEUX BOUCLES ET NON UNE. Dans une grille de Yee, E et H ne sont ni au meme
/// endroit ni au meme instant : les composantes de H vivent une demi-cellule
/// plus loin que celles de E. Mesurer U et I sur le meme plan nominal revient
/// donc a les mesurer a une demi-cellule l'un de l'autre, et l'impedance en
/// ressort biaisee de la moitie d'une cellule de ligne. On encadre donc le plan
/// de tension par deux boucles de courant et on en prend la moyenne -- c'est
/// ce que fait MSLPort, pour la meme raison.
fn coaxial(csx: &mut Csx, p: &Json, n: i64, x: f64, y: f64, excite: f64, z_lignes: &[f64]) -> PortMesure {
    let c = &p["coax"];
    let (ra, rb, rm) = (lit(f(&c["ra"]), DEC), lit(f(&c["rb"]), DEC), lit(f(&c["rm"]), DEC));
    let z0 = lit(f(&c["z0_ligne"]), 4);
    let zs = lit(f(&c["z_bas"]), DEC);
    let sens = lit(f(&c["sens"]), 1);
    // -- la croix : quatre bras radiaux ---------------------------------
    // Le mode TEM d'un coaxial a un champ E radial, continu sur toute la
    // couronne. Quatre bras ne le reproduisent pas exactement, et cela n'a
    // pas d'importance : le premier mode superieur d'une SMA coupe vers
    // 25 GHz, tout ce qui n'est pas TEM est donc evanescent et meurt en
    // quelques cellules -- bien avant le plan de mesure.
    let bras: [(usize, f64, P3, P3); 4] = [
        (0, 1.0, [x + ra, y - ra, zs], [x + rb, y + ra, zs]),
        (0, -1.0, [x - rb, y - ra, zs], [x - ra, y + ra, zs]),
        (1, 1.0, [x - ra, y + ra, zs], [x + ra, y + rb, zs]),
        (1, -1.0, [x - ra, y - rb, zs], [x + ra, y - ra, zs]),
    ];
    for (k, (ny, s, deb, fin)) in bras.into_iter().enumerate() {
        // Quatre resistances de 4.Z0 en parallele font Z0 : le port est
        // ferme sur sa propre impedance, qu'il excite ou non. Un port qui
        // n'est pas ferme sur Z0 renvoie ce qu'il recoit, et le S21 des
        // AUTRES ports s'en trouve faux -- les parametres S se definissent
        // tous les autres ports adaptes.
        let res = csx.resistance(&format!("port_coax_{n}_r{k}"), ny, 4.0 * z0);
        csx.boite(res, 50, deb, fin);
        if excite != 0.0 {
            let mut vec = [0.0; 3];
            vec[ny] = s * excite;
            let e = csx.excitation(&format!("port_coax_{n}_e{k}"), vec, retard(p));
            csx.boite(e, 50, deb, fin);
        }
    }
    // -- le plan de mesure, pose sur une ligne de maillage --------------
    let i = plus_proche(z_lignes, lit(f(&c["z_mes"]), DEC)).clamp(1, z_lignes.len().saturating_sub(2).max(1));
    let z_u = z_lignes[i];
    let z_i = [0.5 * (z_lignes[i - 1] + z_lignes[i]), 0.5 * (z_lignes[i] + z_lignes[(i + 1).min(z_lignes.len() - 1)])];
    // La TENSION : E integre le long d'un rayon, de l'ame vers la gaine.
    // Positive quand l'ame est au potentiel haut, comme sur un cable.
    let u = csx.sonde(&format!("port_ut_{n}"), 0, 1.0, -1);
    csx.boite(u, 0, [x + ra, y, z_u], [x + rb, y, z_u]);
    // Le COURANT : H integre sur une boucle fermee autour de l'ame, une de
    // chaque cote du plan de tension. `sens` pointe vers l'exterieur de la
    // carte ; le courant est compte positif vers la carte, c'est-a-dire
    // dans le sens de propagation de l'onde incidente.
    let mut is = Vec::new();
    for (k, z) in z_i.into_iter().enumerate() {
        let nom = format!("port_it_{n}{}", ["A", "B"][k]);
        let s = csx.sonde(&nom, 1, -sens, 2);
        csx.boite(s, 0, [x - rm, y - rm, z], [x + rm, y + rm, z]);
        is.push(nom);
    }
    // Le plan de mesure est a mi-troncon ; on le ramene a la surface de la carte.
    let deport = lit((f(&c["z_mes"]) - f(&c["z_gaine"])).abs(), 5);
    PortMesure { n, excite: excite != 0.0, u: vec![format!("port_ut_{n}")], i: is,
                 genre: GenrePort::Coaxial { z0, er: lit(f(&c["er"]), 4), deport } }
}
