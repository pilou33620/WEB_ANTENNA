//! L'empilage, le cuivre, les objets hors carte, les ports et la bande : ce que le document
//! decrit, verifie et ramene au millimetre (openems_modele.py, de `_empilage` a `_bande`).

use super::*;
use std::collections::{HashMap, HashSet};

// ==========================================================================
// L'empilage : du tableau de couches aux cotes en z
// ==========================================================================

struct Entree {
    nom: String,
    cuivre: bool,
    ep: f64,
    er: f64,
    df: f64,
    role: String,
    seq: f64,
    sigma: f64,
    garder: Option<bool>,
    ecarte: bool,
}

/// Ce que `_empilage` rend : conducteurs et dielectriques du bas vers le haut, la cote du
/// dessus, les valeurs supposees et les revetements exterieurs.
pub(super) struct Empilage {
    pub conducteurs: Vec<Json>,
    pub dielectriques: Vec<Json>,
    pub z_haut: f64,
    pub supposes: Vec<String>,
    pub revetements: Vec<Json>,
}

/// Conducteurs et dielectriques, ranges du bas vers le haut, en mm.
///
/// La page envoie l'empilage dans l'ordre physique du fichier -- sequence 1
/// en premier, c'est-a-dire le DESSUS. On le retourne ici une fois pour
/// toutes : dans tout ce qui suit, z croit vers le haut et z = 0 est la face
/// inferieure du cuivre du dessous. Une simulation dont le repere est
/// retourne par rapport a la carte est une source d'erreurs sans fin quand
/// vient le moment de placer un port.
///
/// L'EPAISSEUR DU CUIVRE NE COMPTE PAS DANS L'EMPILAGE, SAUF SI ON LE
/// DEMANDE. 35 microns de cuivre entre deux lignes de maillage, c'est une
/// cellule quarante fois plus fine que le pas vise -- et comme le pas de
/// temps FDTD est commande par la plus petite cellule du domaine, c'est la
/// simulation ENTIERE qui devient quarante fois plus longue, pour modeliser
/// une epaisseur que le courant ne voit pas : a 2,4 GHz l'epaisseur de peau
/// dans le cuivre fait 1,3 micron. Les deux modes sans epaisseur posent donc
/// le conducteur sur un PLAN, et les 35 microns ne servent plus qu'a calculer
/// ses pertes ohmiques (mode « feuille »). Le mode « volume » existe pour les
/// cas ou la geometrie de la tranche compte vraiment -- une fente etroite, un
/// couplage par le flanc --, et il annonce son prix.
pub(super) fn _empilage(doc: &Json, k_mm: f64, modele_cu: &str) -> Res<Empilage> {
    let pile = liste(&doc["empilage"]);
    if pile.is_empty() {
        return Err(refus(
            "Empilage absent du document.",
            "Ouvrez le panneau « Empilage » et completez au moins une couche \
             de cuivre et le dielectrique qui la porte."));
    }

    // Ordre du fichier : sequence croissante = du dessus vers le dessous.
    let mut entrees: Vec<Entree> = pile.iter().enumerate().map(|(rang, e)| Entree {
        nom: ou_texte(_texte(&e["nom"], 120), format!("couche {}", rang + 1)),
        cuivre: e["cuivre"].vrai(),
        ep: _nb_pos(&e["ep"], 0.0) * k_mm,
        er: _nb_pos(&e["er"], 0.0),
        df: maxi(0.0, _nb(&e["df"], 0.0)),
        role: _texte(&e["role"], 20),
        seq: _nb(&e["seq"], rang as f64),
        // La conductivite du conducteur, quand le document la porte. Elle
        // n'arrive que du mode conception : un fichier IPC-2581 ne declare
        // pas de quel metal est sa couche, et le cuivre est alors le seul
        // repli raisonnable. Une antenne serigraphiee a l'encre argent est
        // dix fois plus resistive que du cuivre, et cela se lit sur le
        // rendement -- pas sur le S11, qui reste beau.
        sigma: _nb_pos(&e["sigma"], 0.0),
        // Ce que la page a decide d'un revetement exterieur : None quand
        // elle n'a rien dit, et c'est alors la borne qui tranche. Un
        // booleen plutot qu'un defaut recopie ici : recopier le defaut
        // rendrait un choix indistinguable d'un silence.
        garder: if matches!(e["garder"], Json::Nul) { None } else { Some(e["garder"].vrai()) },
        ecarte: false,
    }).collect();
    entrees.sort_by(|a, b| croissant(&a.seq, &b.seq));
    entrees.reverse(); // du bas vers le haut

    // -- les revetements exterieurs, ecartes par defaut ---------------------
    // Voir EP_REVETEMENT_MM : un vernis de 15 microns pose SUR le cuivre
    // exterieur ne porte pas de champ de ligne, mais ses deux faces portent
    // deux lignes de maillage obligatoires, et la cellule qui en resulte
    // commande le pas de temps de toute la simulation. « Exterieur » se lit
    // sur l'empilage et non sur le nom de la couche : est exterieur ce qui
    // n'est pas entre les deux cuivres extremes. Un fichier qui nomme son
    // masque « L9 » est traite comme celui qui le nomme « Resist-A ».
    let rangs_cu: Vec<usize> = entrees.iter().enumerate().filter(|(_, e)| e.cuivre).map(|(i, _)| i).collect();
    let mut revetements = Vec::new();
    if let (Some(&bas), Some(&haut)) = (rangs_cu.first(), rangs_cu.last()) {
        for (i, e) in entrees.iter_mut().enumerate() {
            if e.cuivre || (bas < i && i < haut) {
                continue;
            }
            // La page a tranche, ou elle n'a rien dit et la borne tranche.
            let garder = e.garder.unwrap_or(e.ep > EP_REVETEMENT_MM);
            e.ecarte = !garder;
            revetements.push(obj! {
                "nom" => e.nom.clone(), "ep" => e.ep,
                "er" => e.er, "df" => e.df,
                "garde" => garder,
                // « choisi » dit si le OUI ou le NON vient de l'utilisateur ou
                // de la borne : la page n'affiche pas les deux pareil, et un
                // defaut qu'on prend pour un choix est un defaut qu'on ne
                // rediscute jamais.
                "choisi" => e.garder.is_some(),
            });
        }
    }

    let (mut conducteurs, mut dielectriques) = (Vec::new(), Vec::new());
    let mut z = 0.0;
    let mut supposes = Vec::new();
    let volume = modele_cu == "volume";
    for e in &entrees {
        if e.ecarte {
            continue;
        }
        if e.cuivre {
            let ep = ou(e.ep, EP_CU_DEFAUT);
            if e.ep == 0.0 {
                supposes.push(format!("epaisseur de « {} » ({:.3} mm)", e.nom, ep));
            }
            conducteurs.push(obj! {
                "nom" => e.nom.clone(),
                "z0" => z, "z1" => z + if volume { ep } else { 0.0 },
                // `ep` reste l'epaisseur PHYSIQUE meme quand la geometrie est
                // plate : le mode « feuille » en a besoin pour la resistance
                // de surface, et la fiche l'affiche.
                "ep" => ep, "ep_geo" => if volume { ep } else { 0.0 },
                "sigma" => ou(e.sigma, SIGMA_CU),
                "role" => ou_texte(e.role.clone(), "signal"),
            });
            if volume {
                z += ep;
            }
        } else {
            let ep = e.ep;
            if ep <= 0.0 {
                // Un intervalle d'epaisseur nulle n'est pas un intervalle :
                // deux conducteurs colles court-circuitent la carte entiere.
                return Err(refus(
                    format!("Le dielectrique « {} » n'a pas d'epaisseur.", e.nom),
                    "Saisissez-la dans le panneau « Empilage » : le fichier \
                     IPC-2581 ne la declare pas toujours."));
            }
            let er = ou(e.er, ER_DEFAUT);
            let df = if e.df > 0.0 { e.df } else { DF_DEFAUT };
            if e.er == 0.0 {
                supposes.push(format!("permittivite de « {} » ({:.2})", e.nom, er));
            }
            if e.df == 0.0 {
                supposes.push(format!("tangente de pertes de « {} » ({:.3})", e.nom, df));
            }
            dielectriques.push(obj! {
                "nom" => e.nom.clone(), "z0" => z, "z1" => z + ep, "ep" => ep,
                "er" => er, "df" => df,
            });
            z += ep;
        }
    }

    if conducteurs.is_empty() {
        return Err(refus(
            "Aucune couche de cuivre dans l'empilage.",
            "Une antenne est faite de cuivre : cochez au moins une couche."));
    }

    Ok(Empilage { conducteurs, dielectriques, z_haut: z, supposes, revetements })
}

/// Ce que `_masse_cachee` rend : le plan de reference, {couche: polygones retires},
/// {couche: mm2 de cuivre d'antenne du cote cache}, et les polygones gardes pour leur voisinage.
#[derive(Default)]
pub(super) struct MasseCachee {
    pub reference: Option<String>,
    pub retires: Vec<(String, i64)>,
    pub antenne_derriere: Vec<(String, f64)>,
    pub proches: i64,
}

/// Retire la masse que le plan de reference cache a l'antenne.
///
/// A CES FREQUENCES, UN PLAN DE CUIVRE PLEIN EST OPAQUE. L'epaisseur de peau
/// est de deux microns a 868 MHz, et le champ de l'antenne ne traverse pas
/// 35 microns de cuivre : ce qui est DERRIERE le plan de reference -- un plan
/// d'alimentation, le versement de masse de la face opposee -- n'est pas vu,
/// sauf par ses bords et par les trous du plan. Relie ou non par des vias de
/// couture : une masse est definie par son CONTOUR, et c'est le plan de
/// reference qui le porte.
///
/// CE QUI EST RETIRE, ET RIEN D'AUTRE : un polygone du net de masse, sur une
/// couche derriere le plan de reference qui ne porte aucun port, et dont la boite englobante entiere tombe dans la surface
/// pleine du plan de reference. Ce qui deborde du plan reste, en entier.
///
/// Le plan de reference : la couche ou le port excite prend sa masse, et
/// seules les couches situees au-dela, du cote oppose a l'antenne, sont
/// concernees. Ce n'est PAS sans perte, a la difference de
/// `_absorber_contenus` : les trous du plan (degagements des vias
/// traversants) laissent fuir un peu de champ vers ce qui est retire. D'ou
/// la case « garder toute la masse » de la page, et l'avis qui le dit.
///
/// L'ANTENNE PEUT ETRE DES DEUX COTES DU PLAN. La couche « de » du port dit
/// ou l'antenne est alimentee, pas ou elle rayonne : sur P01x274PCB-C.xml,
/// la sonde se pose sur le point de test du DESSUS et le trou metallise
/// porte le signal jusqu'a l'antenne, sur le DESSOUS. Un port pose sur la
/// pastille du dessus retirait la masse de la face opposee, celle qui borde
/// l'antenne ; un port pose sous l'antenne retire celle qui entoure la
/// pastille du point de test et sa piste. Le cuivre d'antenne du cote cache
/// voit donc la masse qui l'entoure : tout polygone de masse a moins de
/// PROCHE_ANTENNE_MM de lui est garde. Le reste de cette face est retire
/// comme avant -- loin de tout cuivre d'antenne, il ne fait que doubler le
/// contour que le plan de reference porte deja.
///
/// Rend (plan de reference, {couche: polygones retires},
/// {couche: mm2 de cuivre d'antenne du cote cache}, polygones gardes pour
/// leur voisinage), ou (None, {}, {}, 0).
pub(super) fn _masse_cachee(doc: &Json, cuivre: &mut Vec<Bloc>, conducteurs: &[Json], vias: &mut Vec<Json>,
                            ports: &[Json]) -> MasseCachee {
    let rien = MasseCachee::default();
    if doc["masse"]["cachee"].vrai() {
        return rien;
    }
    // LE PORT DIT OU SONT L'ANTENNE ET SON PLAN : il relie la couche de
    // l'antenne (« de ») a celle de la masse (« a »). La presence de cuivre ne
    // le dirait pas -- un net d'antenne a des pastilles traversantes sur
    // toutes les couches.
    let Some(port) = ports.iter().find(|p| p["excite"].vrai()).or(ports.first()) else { return rien };
    // UN PORT DANS LE PLAN NE DIT RIEN DU PLAN DE REFERENCE. Ses deux bornes
    // sont sur « de », en travers d'une fente ; « a » n'est la que parce qu'il
    // faut deux conducteurs distincts, et la page y met la couche voisine
    // (37-port-auto.js). La prendre pour le plan qui cache la masse
    // retirerait celle d'une antenne coplanaire sur la foi d'un remplissage.
    if !port["coax"].vrai() && matches!(txt(&port["dir"]), "x" | "y") {
        return rien;
    }
    let z_de = |nom: &str| conducteurs.iter().rev().find(|c| txt(&c["nom"]) == nom).map(|c| f(&c["z0"]));
    let Some(reference) = cuivre.iter().rev().find(|b| b.couche == txt(&port["a"])) else { return rien };
    let Some(z_ant) = z_de(txt(&port["de"])) else { return rien };
    if !reference.polys.iter().any(|q| q.m) {
        return rien;
    }
    let (ref_couche, z_ref) = (reference.couche.clone(), reference.z0);
    if (z_ant - z_ref).abs() < 1e-12 {
        return rien;
    }
    let dessous = z_ref < z_ant; // le cote cache est au-dela du plan
    let derriere = |b: &Bloc| if dessous { b.z0 < z_ref } else { b.z0 > z_ref };

    // Le cuivre d'antenne du cote cache, et les boites ou la masse le voit.
    let mut vue: Vec<(String, f64)> = Vec::new();
    let mut voisinages: Vec<[f64; 4]> = Vec::new();
    let d = PROCHE_ANTENNE_MM;
    for b in cuivre.iter() {
        if b.couche == ref_couche || !derriere(b) {
            continue;
        }
        for q in &b.polys {
            if q.m {
                continue;
            }
            let aire = _aire(&q.o).abs();
            let trous = py::sum(q.t.iter().map(|t| _aire(t).abs()));
            match vue.iter_mut().find(|(c, _)| *c == b.couche) {
                Some(e) => e.1 = e.1 + aire - trous,
                None => vue.push((b.couche.clone(), 0.0 + aire - trous)),
            }
            let [x0, y0, x1, y1] = _boite_pts(&q.o);
            voisinages.push([x0 - d, y0 - d, x1 + d, y1 + d]);
        }
    }
    let voisine = |r: &[f64; 4]| voisinages.iter().any(|v| r[0] <= v[2] && r[2] >= v[0] && r[1] <= v[3] && r[3] >= v[1]);

    let mut proteges: HashSet<String> = HashSet::from([ref_couche.clone()]);
    for p in ports {
        proteges.insert(txt(&p["de"]).to_string());
        proteges.insert(txt(&p["a"]).to_string());
    }

    // Les coordonnees sont deja en mm ici. Seules les vraies surfaces du plan
    // servent de contenant : une pastille de 1 mm2 n'en cache aucune autre.
    let surfaces: Vec<_Surface> = reference.polys.iter().filter(|q| {
        let bb = _boite_pts(&q.o);
        (bb[2] - bb[0]) * (bb[3] - bb[1]) >= 1.0
    }).map(|q| _Surface::new(q, 2.0)).collect();
    if surfaces.is_empty() {
        return rien;
    }

    let mut retires: Vec<(String, i64)> = Vec::new();
    let mut proches = 0;
    for b in cuivre.iter_mut() {
        if proteges.contains(&b.couche) {
            continue;
        }
        // Seules les couches DERRIERE le plan, vues depuis l'antenne.
        if !derriere(b) {
            continue;
        }
        let couche = b.couche.clone();
        b.polys.retain(|q| {
            if q.m {
                let r = _boite_pts(&q.o);
                if surfaces.iter().any(|sf| sf.contient(&r)) {
                    if voisine(&r) {
                        proches += 1;
                    } else {
                        match retires.iter_mut().find(|(c, _)| *c == couche) {
                            Some(e) => e.1 += 1,
                            None => retires.push((couche.clone(), 1)),
                        }
                        return false;
                    }
                }
            }
            true
        });
    }
    cuivre.retain(|b| !b.polys.is_empty());
    if proches == 0 {
        vue.clear();
    }
    if retires.is_empty() {
        return MasseCachee { reference: (proches != 0).then_some(ref_couche), retires, antenne_derriere: vue, proches };
    }

    // LES VIAS SUIVENT. Un via de couture qui descendait jusqu'a la face
    // opposee s'arrete desormais a la derniere couche gardee qu'il traverse ;
    // celui qui ne relie plus deux couches gardees ne relie plus rien.
    let mut cond: Vec<&Json> = conducteurs.iter()
        .filter(|c| proteges.contains(txt(&c["nom"])) || cuivre.iter().any(|b| b.couche == txt(&c["nom"]))).collect();
    cond.sort_by(|a, b| croissant(&f(&a["z0"]), &f(&b["z0"])));
    vias.retain_mut(|v| {
        let (z0, z1) = (f(&v["z0"]), f(&v["z1"]));
        let pris: Vec<&&Json> = cond.iter().filter(|c| z0 - 1e-9 <= f(&c["z0"]) && f(&c["z1"]) <= z1 + 1e-9).collect();
        if pris.len() < 2 {
            return false;
        }
        let (bas, haut) = (pris[0], pris[pris.len() - 1]);
        poser(v, "z0", bas["z0"].clone());
        poser(v, "z1", haut["z1"].clone());
        poser(v, "de", bas["nom"].clone());
        poser(v, "a", haut["nom"].clone());
        true
    });
    MasseCachee { reference: Some(ref_couche), retires, antenne_derriere: vue, proches }
}

/// Fusionne deux dielectriques identiques separes par une couche de
/// cuivre que rien n'utilise.
///
/// UNE INTERFACE ENTRE DEUX MATERIAUX IDENTIQUES N'EST PAS UNE INTERFACE.
/// Une couche interne sans cuivre retenu, sans via qui s'y arrete et sans
/// port, entre deux FR-4 de meme Dk et de meme Df : le champ y traverse un
/// milieu homogene, et le decrire comme deux substrats ne change rien a la
/// physique. Mais chaque substrat reclame ses propres cellules en z, et ses
/// deux faces des lignes obligatoires -- c'est ce qui menait l'empilage de
/// P01x274 a 108 lignes. La fusion ne touche AUCUNE cote z : seulement en
/// mode feuille ou pec, ou le cuivre est un plan sans epaisseur. En mode
/// volume, la couche vide a une epaisseur, et la retirer deplacerait tout ce
/// qui est au-dessus.
pub(super) fn _reduire_empilage(conducteurs: Vec<Json>, dielectriques: Vec<Json>, cuivre: &[Bloc], vias: &[Json],
                                ports: &[Json]) -> (Vec<Json>, Vec<Json>, Vec<String>) {
    if conducteurs.iter().any(|c| f(&c["z1"]) != f(&c["z0"])) {
        return (conducteurs, dielectriques, Vec::new());
    }
    let mut utiles: HashSet<&str> = cuivre.iter().map(|b| b.couche.as_str()).collect();
    for v in vias.iter().chain(ports) {
        utiles.insert(txt(&v["de"]));
        utiles.insert(txt(&v["a"]));
    }

    let mut dies = dielectriques.clone();
    dies.sort_by(|a, b| croissant(&f(&a["z0"]), &f(&b["z0"])));
    let mut tries: Vec<&Json> = conducteurs.iter().collect();
    tries.sort_by(|a, b| croissant(&f(&a["z0"]), &f(&b["z0"])));
    let (mut gardes, mut fusions) = (Vec::new(), Vec::new());
    for c in tries {
        if utiles.contains(txt(&c["nom"])) {
            gardes.push(c.clone());
            continue;
        }
        let z = f(&c["z0"]);
        let dessous = dies.iter().position(|d| (f(&d["z1"]) - z).abs() < 1e-9);
        let dessus = dies.iter().position(|d| (f(&d["z0"]) - z).abs() < 1e-9);
        let (Some(i), Some(j)) = (dessous, dessus) else {
            gardes.push(c.clone());
            continue;
        };
        if (f(&dies[i]["er"]) - f(&dies[j]["er"])).abs() > 1e-9 || (f(&dies[i]["df"]) - f(&dies[j]["df"])).abs() > 1e-9 {
            gardes.push(c.clone());
            continue;
        }
        let nom = format!("{} + {}", txt(&dies[i]["nom"]), txt(&dies[j]["nom"]));
        let z1 = f(&dies[j]["z1"]);
        let ep = z1 - f(&dies[i]["z0"]);
        poser(&mut dies[i], "nom", nom);
        poser(&mut dies[i], "z1", z1);
        poser(&mut dies[i], "ep", ep);
        if i != j {
            dies.remove(j);
        }
        fusions.push(txt(&c["nom"]).to_string());
    }
    if fusions.is_empty() || gardes.is_empty() {
        return (conducteurs, dielectriques, Vec::new());
    }
    (gardes, dies, fusions)
}

pub(super) fn _conducteur<'a>(conducteurs: &'a [Json], nom: &str) -> Option<&'a Json> {
    conducteurs.iter().find(|c| txt(&c["nom"]) == nom)
}

// ==========================================================================
// Le cuivre
// ==========================================================================

/// Ce que `_cuivre` rend : les blocs, la boite du cuivre recu, et les comptes.
pub(super) struct Cuivre {
    pub blocs: Vec<Bloc>,
    pub boite: [f64; 4],
    pub polygones: i64,
    pub degeneres: i64,
    pub absorbes: i64,
}

/// Les polygones designes, ranges par couche, avec leurs cotes en z.
///
/// La page envoie ce qu'elle a extrait du modele IPC-2581 : un tableau par
/// couche, chaque polygone sous la forme {"o": contour, "t": [trous]} --
/// exactement la forme que ipc2581_json donne aux versements de cuivre.
pub(super) fn _cuivre(doc: &Json, conducteurs: &[Json], k_mm: f64) -> Res<Cuivre> {
    let mut out = Vec::new();
    let mut boite: Option<[f64; 4]> = None;
    let (mut total, mut degeneres, mut absorbes) = (0i64, 0i64, 0i64);
    for bloc in liste(&doc["cuivre"]) {
        let nom = _texte(&bloc["couche"], 120);
        let Some(cond) = _conducteur(conducteurs, &nom) else {
            return Err(refus(
                format!("Le cuivre designe est sur « {} », qui n'est pas dans l'empilage.",
                        if nom.is_empty() { "(sans nom)" } else { &nom }),
                "Cochez cette couche dans le panneau « Empilage », ou \
                 retirez-la de la selection."));
        };
        let mut polys = Vec::new();
        for p in liste(&bloc["polys"]) {
            let o = _sens(_polyligne(&p["o"]), false);
            if o.len() < 3 {
                continue;
            }
            if _largeur_equivalente(&o) * k_mm < LARGEUR_DEGENEREE_MM {
                degeneres += 1;
                continue;
            }
            let t: Vec<Vec<P>> = liste(&p["t"]).iter().map(|t| _sens(_polyligne(t), true)).filter(|tp| tp.len() >= 3).collect();
            for &(x, y) in &o {
                let (x, y) = (x * k_mm, y * k_mm);
                boite = Some(match boite {
                    None => [x, y, x, y],
                    Some(b) => [mini(b[0], x), mini(b[1], y), maxi(b[2], x), maxi(b[3], y)],
                });
            }
            // « m » : ce polygone vient du net de MASSE seul, pas de l'antenne.
            // C'est lui, et lui seul, que `_masse_cachee` peut retirer.
            polys.push(Poly { o, t, m: p["m"].vrai(), mixte: false });
            total += 1;
        }
        if polys.is_empty() {
            continue;
        }
        let (mut polys, n_abs) = _absorber_contenus(polys, k_mm);
        absorbes += n_abs as i64;
        // Mise a l'echelle apres le calcul de la boite : les deux parcourent
        // les memes points, autant ne les parcourir qu'une fois.
        if k_mm != 1.0 {
            for p in polys.iter_mut() {
                for q in p.o.iter_mut().chain(p.t.iter_mut().flatten()) {
                    *q = (q.0 * k_mm, q.1 * k_mm);
                }
            }
        }
        out.push(Bloc {
            couche: nom, z0: f(&cond["z0"]), z1: f(&cond["z1"]),
            ep: f(&cond["ep"]), ep_geo: f(&cond["ep_geo"]),
            sigma: f(&cond["sigma"]), role: txt(&cond["role"]).to_string(), polys,
        });
    }

    let (false, Some(boite)) = (out.is_empty(), boite) else {
        return Err(refus(
            "Aucun cuivre dans la selection.",
            "Designez l'antenne sur la carte : cliquez son net, ou \
             Ctrl+clic pour en prendre plusieurs."));
    };
    Ok(Cuivre { blocs: out, boite, polygones: total - absorbes, degeneres, absorbes })
}

// LE CUIVRE POSE SUR DU CUIVRE N'AJOUTE AUCUN METAL. Une pastille de masse au
// milieu du plan de masse, la piste qui court dessus : leur union avec le plan
// EST le plan. openEMS remplit les memes cellules avec ou sans elles -- la
// simulation est identique --, mais chacune de leurs aretes attirait des
// lignes de maillage qui ne decrivent plus rien, puisqu'il n'y a pas d'arete
// de metal a cet endroit. Sur P01x274PCB-C.xml, ce sont des milliers de
// pastilles et de troncons. On ne retire QUE ce qui est prouve contenu : la
// boite englobante entiere du petit polygone dans la surface pleine d'un
// autre, sans toucher ni son contour ni aucune de ses decoupes. Le doute
// garde le polygone.
pub(super) fn _boite_pts(pts: &[P]) -> [f64; 4] {
    [min_de(pts.iter().map(|q| q.0)), min_de(pts.iter().map(|q| q.1)),
     max_de(pts.iter().map(|q| q.0)), max_de(pts.iter().map(|q| q.1))]
}

/// La surface pleine d'un polygone -- contour moins decoupes -- et un seul
/// test : ce rectangle y est-il ENTIEREMENT ?
///
/// Les aretes (contour ET decoupes) sont rangees par bande horizontale de
/// `pas`, pour que chaque test ne parcoure que le voisinage.
pub(super) struct _Surface {
    pas: f64,
    pub boite: [f64; 4],
    aretes: Vec<(P, P)>,
    bandes: HashMap<i64, Vec<usize>>,
}

impl _Surface {
    pub fn new(poly: &Poly, pas: f64) -> _Surface {
        let mut s = _Surface { pas, boite: _boite_pts(&poly.o), aretes: Vec::new(), bandes: HashMap::new() };
        for anneau in std::iter::once(&poly.o).chain(&poly.t) {
            let n = anneau.len();
            for k in 0..n {
                let (a, b) = (anneau[k], anneau[(k + 1) % n]);
                let (y0, y1) = (mini(a.1, b.1), maxi(a.1, b.1));
                let i = s.aretes.len();
                s.aretes.push((a, b));
                for j in (y0 / pas).floor() as i64..=(y1 / pas).floor() as i64 {
                    s.bandes.entry(j).or_default().push(i);
                }
            }
        }
        s
    }

    pub fn contient(&self, r: &[f64; 4]) -> bool {
        let bg = &self.boite;
        if r[0] < bg[0] || r[1] < bg[1] || r[2] > bg[2] || r[3] > bg[3] {
            return false;
        }
        // Aucune arete ne traverse le rectangle : il est tout dedans ou tout
        // dehors, et son centre tranche.
        !self._coupe(r) && self._dedans((r[0] + r[2]) / 2.0, (r[1] + r[3]) / 2.0)
    }

    fn _coupe(&self, r: &[f64; 4]) -> bool {
        let [x0, y0, x1, y1] = *r;
        let mut vus = HashSet::new();
        for j in (y0 / self.pas).floor() as i64..=(y1 / self.pas).floor() as i64 {
            for &i in self.bandes.get(&j).map(|v| v.as_slice()).unwrap_or(&[]) {
                if !vus.insert(i) {
                    continue;
                }
                let ((ax, ay), (bx, by)) = self.aretes[i];
                if maxi(ax, bx) < x0 || mini(ax, bx) > x1 {
                    continue;
                }
                if maxi(ay, by) < y0 || mini(ay, by) > y1 {
                    continue;
                }
                // Le segment touche la boite du rectangle : on le decoupe
                // (Liang-Barsky) pour savoir s'il la traverse vraiment.
                if _couper_seg(((ax, ay), (bx, by)), r).is_some() {
                    return true;
                }
            }
        }
        false
    }

    pub fn _dedans(&self, x: f64, y: f64) -> bool {
        // Pair-impair sur tous les anneaux : la surface pleine, trous deduits.
        let mut dedans = false;
        for &i in self.bandes.get(&((y / self.pas).floor() as i64)).map(|v| v.as_slice()).unwrap_or(&[]) {
            let ((ax, ay), (bx, by)) = self.aretes[i];
            if (ay > y) != (by > y) {
                let xc = ax + (y - ay) * (bx - ax) / (by - ay);
                if xc > x {
                    dedans = !dedans;
                }
            }
        }
        dedans
    }
}

/// Le morceau du segment qui tombe dans la boite (Liang-Barsky), ou None.
pub(super) fn _couper_seg(seg: (P, P), boite: &[f64; 4]) -> Option<(P, P)> {
    let ((ax, ay), (bx, by)) = seg;
    let [x0, y0, x1, y1] = *boite;
    let (dx, dy) = (bx - ax, by - ay);
    let (mut t0, mut t1) = (0.0, 1.0);
    for (p, q) in [(-dx, ax - x0), (dx, x1 - ax), (-dy, ay - y0), (dy, y1 - ay)] {
        if p == 0.0 {
            if q < 0.0 {
                return None;
            }
        } else {
            let t = q / p;
            if p < 0.0 {
                t0 = maxi(t0, t);
            } else {
                t1 = mini(t1, t);
            }
            if t0 > t1 {
                return None;
            }
        }
    }
    Some(((ax + t0 * dx, ay + t0 * dy), (ax + t1 * dx, ay + t1 * dy)))
}

/// Retire les polygones entierement recouverts par un autre de la meme
/// couche. Rend (polygones gardes, nombre retires).
fn _absorber_contenus(mut polys: Vec<Poly>, k_mm: f64) -> (Vec<Poly>, usize) {
    if polys.len() < 2 {
        return (polys, 0);
    }

    let boites: Vec<[f64; 4]> = polys.iter().map(|p| _boite_pts(&p.o)).collect();
    let aires: Vec<f64> = boites.iter().map(|b| (b[2] - b[0]) * (b[3] - b[1])).collect();
    // Les contenants possibles : les grandes surfaces, plans et gros troncons.
    // Les coordonnees sont encore dans l'unite du fichier : 1 mm = 1/k_mm.
    let mut ordre: Vec<usize> = (0..polys.len()).collect();
    ordre.sort_by(|i, j| croissant(&-aires[*i], &-aires[*j]));
    let seuil = 1.0 / (k_mm * k_mm);
    let grands: Vec<usize> = ordre.into_iter().filter(|i| aires[*i] >= seuil).take(400).collect();
    if grands.is_empty() {
        return (polys, 0);
    }

    let pas = 2.0 / k_mm;
    let mut surfaces: HashMap<usize, _Surface> = HashMap::new();
    let mut garder = vec![true; polys.len()];
    for i in 0..polys.len() {
        for &g in &grands {
            if g == i || !garder[g] || aires[g] <= aires[i] {
                continue;
            }
            if !surfaces.contains_key(&g) {
                surfaces.insert(g, _Surface::new(&polys[g], pas));
            }
            if surfaces[&g].contient(&boites[i]) {
                garder[i] = false;
                // UN MORCEAU D'ANTENNE AVALE PAR LA MASSE LA REND ANTENNE. Le
                // contenant EST desormais ce cuivre-la : garder sa marque « m »
                // le laisserait retirer par `_masse_cachee`, et un modele dont
                // toute l'antenne a ete absorbee serait refuse comme « masse
                // seule ». Il devient « mixte » : les deux a la fois, ce que
                // le controle des ports doit savoir (voir `_cuivre_sous`).
                if !polys[i].m && polys[g].m {
                    polys[g].m = false;
                    polys[g].mixte = true;
                }
                break;
            }
        }
    }
    let avant = polys.len();
    let mut k = garder.iter();
    polys.retain(|_| *k.next().unwrap_or(&true));
    let gardes = polys.len();
    (polys, avant - gardes)
}

/// Largeur d'un polygone vu comme un ruban : 2 x aire / perimetre.
///
/// Exacte pour un rectangle long, et juste aussi pour un copeau en biais --
/// ce que le petit cote de la boite englobante ne sait pas voir.
fn _largeur_equivalente(pts: &[P]) -> f64 {
    let (mut aire, mut perim) = (0.0, 0.0);
    let n = pts.len();
    for i in 0..n {
        let (x0, y0) = pts[i];
        let (x1, y1) = pts[(i + 1) % n];
        aire += x0 * y1 - x1 * y0;
        perim += py::hypot(x1 - x0, y1 - y0);
    }
    if perim > 0.0 { 2.0 * f64::abs(aire) / 2.0 / perim } else { 0.0 }
}

/// Les tubes metallises qui relient deux couches.
///
/// Un via est modelise par un CYLINDRE PLEIN et non par un tube creux, et
/// c'est un choix, pas un oubli : a ces frequences l'epaisseur de peau est
/// de quelques microns, le courant ne voit pas la difference, et un tube
/// creux demanderait deux cellules dans l'epaisseur de la metallisation --
/// soit un maillage dix fois plus fin pour rien.
pub(super) fn _vias(doc: &Json, conducteurs: &[Json], k_mm: f64) -> Vec<Json> {
    let mut out = Vec::new();
    for v in liste(&doc["vias"]) {
        let r = ou(_nb_pos(&v["d"], 0.0) * k_mm / 2.0, _nb_pos(&v["r"], 0.0) * k_mm);
        if r <= 0.0 {
            continue;
        }
        let (ca, cb) = match (_conducteur(conducteurs, &_texte(&v["de"], 120)), _conducteur(conducteurs, &_texte(&v["a"], 120))) {
            (Some(ca), Some(cb)) => (ca, cb),
            // Portee non declaree, ou couche hors empilage : le via traverse.
            _ => (&conducteurs[0], &conducteurs[conducteurs.len() - 1]),
        };
        let z0 = mini(f(&ca["z0"]), f(&cb["z0"]));
        let z1 = maxi(f(&ca["z1"]), f(&cb["z1"]));
        out.push(obj! {"x" => _nb(&v["x"], 0.0) * k_mm, "y" => _nb(&v["y"], 0.0) * k_mm,
                       "r" => r, "z0" => z0, "z1" => z1,
                       "de" => ca["nom"].clone(), "a" => cb["nom"].clone()});
    }
    out
}

// ==========================================================================
// Les objets qui ne sont pas sur la carte
// ==========================================================================
// UNE ANTENNE NE RAYONNE JAMAIS TOUTE SEULE. Elle est dans un boitier, au
// dessus d'une batterie, a cote d'un ecran, au bout d'un cable. Le fichier
// IPC-2581 ne dit rien de tout cela -- il decrit une carte, pas un produit --
// et une simulation qui l'ignore rend un diagramme de rayonnement propre et
// faux. Ces primitives-la comblent le trou : elles se saisissent a la main,
// en coordonnees, et elles entrent dans le maillage comme le reste.
//
// CE QU'ELLES NE SONT PAS : un editeur 3D. Quatre formes, des nombres, et la
// vue 3D pour verifier. Une piece mecanique reelle -- un boitier avec ses
// parois, ses bossages et ses conges -- s'IMPORTE : c'est le travail de
// `_pieces` et d'openems_pieces.py, a l'etape « Autour ».
pub const PRIMITIVES: [&str; 4] = ["fil", "cylindre", "boite", "sphere"];

fn _xyz(valeur: &Json, k_mm: f64) -> [f64; 3] {
    let v = liste(valeur);
    if v.len() < 3 {
        return [0.0 * k_mm; 3];
    }
    [_nb(&v[0], 0.0) * k_mm, _nb(&v[1], 0.0) * k_mm, _nb(&v[2], 0.0) * k_mm]
}

/// Les objets hors carte, verifies et ramenes au millimetre.
pub(super) fn _primitives(doc: &Json, k_mm: f64) -> Res<Vec<Json>> {
    let mut out = Vec::new();
    for (i, p) in liste(&doc["primitives"]).iter().enumerate() {
        let genre = _texte(&p["type"], 12).to_lowercase();
        if !PRIMITIVES.contains(&genre.as_str()) {
            return Err(refus(
                format!("Objet {} : type « {} » inconnu.", i + 1, genre),
                &format!("Les formes possibles sont : {}.", PRIMITIVES.join(", "))));
        }
        let nom = ou_texte(_texte(&p["nom"], 40), format!("objet {}", i + 1));

        let mut mat = ou_texte(_texte(&p["materiau"], 14), "metal").to_lowercase();
        if mat != "metal" && mat != "dielectrique" {
            mat = "metal".into();
        }
        let er = ou(_nb_pos(&p["er"], 0.0), ER_DEFAUT);
        let df = maxi(0.0, _nb(&p["df"], 0.0));

        let mut o = obj! {"nom" => nom.clone(), "type" => genre.clone(), "materiau" => mat,
                          "er" => er, "df" => df,
                          "priorite" => _nb(&p["priorite"], 20.0) as i64};

        match genre.as_str() {
            "fil" => {
                let pts: Vec<[f64; 3]> = liste(&p["pts"]).iter().map(|q| _xyz(q, k_mm)).collect();
                if pts.len() < 2 {
                    return Err(refus(
                        format!("Le fil « {nom} » n'a qu'un point."),
                        "Un fil est une polyligne : il lui faut au moins deux \
                         sommets."));
                }
                let r = _nb_pos(&p["r"], 0.0) * k_mm;
                if r <= 0.0 {
                    return Err(refus(
                        format!("Le fil « {nom} » n'a pas de rayon."),
                        "Un fil sans epaisseur n'existe pas pour le maillage : \
                         donnez-lui son rayon reel (0,5 mm pour un fil de 1 mm \
                         de diametre)."));
                }
                poser(&mut o, "pts", Json::Liste(pts.into_iter().map(nombres).collect()));
                poser(&mut o, "r", r);
            }
            "cylindre" => {
                let (a, b) = (_xyz(&p["a"], k_mm), _xyz(&p["b"], k_mm));
                let r = _nb_pos(&p["r"], 0.0) * k_mm;
                poser(&mut o, "a", nombres(a));
                poser(&mut o, "b", nombres(b));
                poser(&mut o, "r", r);
                if r <= 0.0 {
                    return Err(refus(format!("Le cylindre « {nom} » n'a pas de rayon."), ""));
                }
                if a == b {
                    return Err(refus(
                        format!("Le cylindre « {nom} » a ses deux extremites au meme point."),
                        "Il serait d'epaisseur nulle."));
                }
            }
            "boite" => {
                let (a, b) = (_xyz(&p["a"], k_mm), _xyz(&p["b"], k_mm));
                let bas: [f64; 3] = std::array::from_fn(|k| mini(a[k], b[k]));
                let haut: [f64; 3] = std::array::from_fn(|k| maxi(a[k], b[k]));
                poser(&mut o, "a", nombres(bas));
                poser(&mut o, "b", nombres(haut));
                // Une boite plate est LEGITIME -- c'est ainsi qu'on pose un plan
                // reflecteur. Une boite nulle sur DEUX axes ne decrit rien.
                let plats = (0..3).filter(|k| haut[*k] - bas[*k] <= 0.0).count();
                if plats >= 2 {
                    return Err(refus(
                        format!("La boite « {nom} » est degeneree : elle est plate sur {plats} axes."),
                        "Une boite plate sur UN axe decrit un plan, et c'est \
                         accepte ; sur deux, il ne reste qu'un segment."));
                }
            }
            _ => { // sphere
                let r = _nb_pos(&p["r"], 0.0) * k_mm;
                poser(&mut o, "c", nombres(_xyz(&p["c"], k_mm)));
                poser(&mut o, "r", r);
                if r <= 0.0 {
                    return Err(refus(format!("La sphere « {nom} » n'a pas de rayon."), ""));
                }
            }
        }
        out.push(o);
    }
    Ok(out)
}

// ==========================================================================
// Le substrat de la carte entiere
// ==========================================================================
// PAR DEFAUT, LE SUBSTRAT NE COUVRE QUE LE CUIVRE RETENU : sa boite englobante,
// `boite_cu`. C'est juste quand on simule une antenne sur son plan de masse ;
// c'est faux des qu'il reste de la carte au-dela -- une carte de 50 x 70 mm
// dont on n'a retenu que l'antenne et sa masse locale est simulee avec un
// stratifie tronque, et ce qui depasse (les deux tiers de la carte, parfois)
// n'existe pas pour le solveur. Avec un boitier autour, c'est pire : la paroi
// plastique « voit » une carte plus petite que la vraie.
//
// Quand la page envoie le CONTOUR de la carte (le <Profile> du fichier, ou le
// contour dessine en conception), le substrat suit ce contour, polygone exact,
// sur toute sa hauteur. Les decoupes interieures ne sont pas reprises : un
// AddLinPoly n'a pas de trou, et une fente dans le stratifie se simule mieux
// en la designant qu'en la devinant.
pub const CARTE_MAX_POINTS: usize = 4000;

/// Le contour de la carte, en mm, ou None s'il n'est pas demande.
pub(super) fn _carte(doc: &Json, k_mm: f64) -> Res<Option<Json>> {
    let c = &doc["carte"];
    if !c["substrat"].vrai() {
        return Ok(None);
    }
    let pts = _polyligne(&c["contour"]);
    if pts.len() < 3 {
        return Ok(None);
    }
    if pts.len() > CARTE_MAX_POINTS {
        return Err(refus(
            format!("Le contour de la carte a {} sommets, {} au plus.", pts.len(), CARTE_MAX_POINTS),
            "Decochez « le substrat suit le contour de la carte » a l'etape \
             « Autour » : le substrat reprendra l'emprise du cuivre."));
    }
    let pts: Vec<P> = pts.into_iter().map(|(x, y)| (x * k_mm, y * k_mm)).collect();
    if _aire(&pts).abs() <= 0.0 {
        return Ok(None);
    }
    let [x0, y0, x1, y1] = _boite_pts(&pts);
    // LES ARETES DROITES DU CONTOUR PORTENT UNE LIGNE : un bord de carte
    // vertical en x qui tombe entre deux lignes fait un stratifie plus large
    // ou plus etroit d'une demi-cellule. Les bords obliques ne se suivent pas
    // sur une grille cartesienne, on ne pretend pas les suivre.
    let (mut lx, mut ly) = (vec![x0, x1], vec![y0, y1]);
    let n = pts.len();
    for i in 0..n {
        let ((xa, ya), (xb, yb)) = (pts[i], pts[(i + 1) % n]);
        if (xb - xa).abs() < 1e-6 && (yb - ya).abs() > 0.5 {
            lx.push(py::round(xa, 6));
        }
        if (yb - ya).abs() < 1e-6 && (xb - xa).abs() > 0.5 {
            ly.push(py::round(ya, 6));
        }
    }
    Ok(Some(obj! {"contour" => pts_json(&pts),
                  "boite" => nombres([x0, y0, x1, y1]),
                  "lignes_x" => nombres(ensemble_trie(lx).into_iter().take(64)),
                  "lignes_y" => nombres(ensemble_trie(ly).into_iter().take(64))}))
}

/// Les pieces importees (STEP, STL), verifiees et placees.
///
/// Le travail est dans openems_pieces.py ; ce qui reste ici est la
/// traduction de ses refus dans la langue de ce module, pour que la page les
/// affiche comme les autres -- un message, un conseil.
pub(super) fn _pieces(doc: &Json, k_mm: f64) -> Res<Vec<Piece>> {
    pieces::pieces(&doc["pieces"], k_mm).map_err(|e| ErreurModele { message: e.message, conseil: e.conseil })
}

/// La boite englobante d'un objet, pour le cadrage et le maillage.
pub fn _emprise_primitive(o: &Json) -> [f64; 6] {
    let r = f(&o["r"]);
    let v = |cle: &str, k: usize| f(&o[cle][k]);
    match txt(&o["type"]) {
        "fil" => {
            let axe = |k: usize| liste(&o["pts"]).iter().map(move |q| f(&q[k]));
            [min_de(axe(0)) - r, min_de(axe(1)) - r, min_de(axe(2)) - r,
             max_de(axe(0)) + r, max_de(axe(1)) + r, max_de(axe(2)) + r]
        }
        "cylindre" => [mini(v("a", 0), v("b", 0)) - r, mini(v("a", 1), v("b", 1)) - r,
                       mini(v("a", 2), v("b", 2)) - r,
                       maxi(v("a", 0), v("b", 0)) + r, maxi(v("a", 1), v("b", 1)) + r,
                       maxi(v("a", 2), v("b", 2)) + r],
        "boite" => [v("a", 0), v("a", 1), v("a", 2), v("b", 0), v("b", 1), v("b", 2)],
        _ => [v("c", 0) - r, v("c", 1) - r, v("c", 2) - r, v("c", 0) + r, v("c", 1) + r, v("c", 2) + r],
    }
}

// ==========================================================================
// Les ports d'excitation
// ==========================================================================
// COMBIEN DE PORTS, ET POURQUOI PLUSIEURS. Un seul port donne le S11 : ce que
// l'antenne renvoie a son alimentation. Deux ports donnent en plus le S21 --
// ce qui passe de l'un a l'autre -- et c'est la seule grandeur qui reponde a
// la question « ces deux antennes se genent-elles ? ». Elle ne se deduit
// d'aucun S11, et elle decide pourtant du sort d'un produit a deux antennes :
// deux brins a 15 dB d'isolation partagent leur puissance au lieu de la
// rayonner, et le diagramme de chacun devient celui de l'ensemble.
//
// UN SEUL PORT EXCITE, SAUF POUR UN RESEAU. openEMS accepte plusieurs
// excitations simultanees ; mais leurs ondes se superposent alors dans la
// boite, et aucun parametre S ne se deduit plus de ce melange -- S21 est par
// definition « ce qui sort en 2 QUAND SEUL 1 excite ». Ce qu'une simulation
// rend, c'est donc UNE COLONNE du tableau S, celle du port excite.
//
// UN RESEAU ALIMENTE EN PHASE est l'exception, et elle change la question :
// on ne cherche plus le S21, on cherche ce que chaque element voit QUAND TOUS
// EMETTENT -- le coefficient de reflexion ACTIF, b_i / a_i port par port, et
// le diagramme du reseau entier. Plusieurs ports excites posent donc le
// modele en mode « reseau » (voir `_bloc_ports` et le depouillement dans
// openems_script.py) : ce qui en sort n'est plus nomme S, et ne l'est jamais.
pub const MAX_PORTS: usize = 9; // un reseau 3 x 3

// -- le port coaxial --------------------------------------------------------
// `AddCoaxialPort` EXISTE DANS L'INTERFACE MATLAB D'openEMS, PAS DANS LES
// LIAISONS PYTHON 0.0.36 : openEMS/python/openEMS/ports.py n'y definit que
// LumpedPort, MSLPort, WaveguidePort et RectWGPort. Un port coaxial se
// construit donc ici a la main, et il est fait de quatre choses :
//
//   1. l'ame -- un cylindre plein de rayon a, qui traverse la carte et vient
//      toucher la couche de l'antenne ;
//   2. la gaine -- un tube de rayon interieur b, qui vient toucher le plan de
//      masse et s'arrete la ;
//   3. le dielectrique du cable entre les deux, de permittivite er_c ;
//   4. les DEGAGEMENTS -- un disque de rayon b perce dans chaque couche de
//      cuivre que l'ame traverse, sauf celle a laquelle elle se raccorde.
//      Sans eux l'ame touche le plan de masse : le port est court-circuite,
//      le S11 vaut 0 dB, et rien dans le resultat ne dit pourquoi.
//
// L'EXCITATION ET LA MESURE NE SE RESSEMBLENT PAS, ET C'EST LA TOUT LE SUJET.
//
//   L'EXCITATION est approchee : une CROIX de quatre bras radiaux au bout du
//   troncon -- +x, -x, +y, -y --, chacun portant une source de champ E dirigee
//   vers l'exterieur et une resistance de 4.Z0 (quatre en parallele font Z0).
//   Ce n'est pas le profil exact du mode TEM, qui est continu sur toute la
//   couronne. Cela n'a aucune importance : tout ce qui n'est pas TEM dans un
//   coaxial est EVANESCENT en dessous du premier mode superieur, et ce mode-la
//   (TE11) coupe vers c/(pi.(a+b).racine(er)) -- 25 GHz pour une SMA. Ce qui
//   n'est pas TEM meurt donc en quelques cellules, bien avant le plan de
//   mesure.
//
//   LA MESURE, elle, est exacte, et c'est pour cela qu'on ne pouvait pas se
//   contenter d'un port localise : la sonde de courant d'un `LumpedPort` est
//   un segment place dans le plan PERPENDICULAIRE a l'excitation. Radiale
//   ici, elle ne peut par construction pas encercler l'ame -- le courant
//   axial du coaxial ne traverse jamais sa surface, et l'impedance rendue
//   n'aurait aucun rapport avec celle de la ligne. Le port est donc bati sur
//   la classe `Port` de base d'openEMS, avec ses propres sondes :
//
//     - la TENSION : l'integrale de E le long d'un rayon, de l'ame a la gaine,
//       dans un plan de mesure a mi-troncon ;
//     - le COURANT : l'integrale de H sur une BOUCLE FERMEE autour de l'ame,
//       dans le meme plan. Deux boucles en fait, une de chaque cote du plan,
//       dont on prend la moyenne : dans une grille de Yee, E et H ne vivent
//       pas au meme endroit, et ne pas le corriger biaise l'impedance d'une
//       demi-cellule de ligne.
//
// Le plan de mesure est donc a mi-troncon, et les S sont ramenes a la SURFACE
// DE LA CARTE par un deport de plan de reference -- beta = 2.pi.f.racine(er)/c,
// exact pour un mode TEM, qui n'est pas disperse.
pub const COAX_RA: f64 = 0.635; // mm, rayon de l'ame d'une SMA (1,27 mm de diametre)
pub const COAX_RB: f64 = 2.05; // mm, rayon interieur de la gaine
pub const COAX_ER: f64 = 2.05; // PTFE
pub const COAX_EP: f64 = 0.3; // mm, epaisseur de la gaine
pub const COAX_LONGUEUR: f64 = 3.0; // mm, troncon modelise sous la carte

/// Impedance caracteristique d'un coaxial : 60/racine(er) . ln(b/a).
///
/// C'EST LE CHIFFRE QUI PIEGE. Un connecteur dessine « a peu pres » ne fait
/// pas 50 ohms, et une ligne d'alimentation qui n'a pas l'impedance du port
/// ajoute sa propre desadaptation a celle de l'antenne : on croit corriger
/// l'antenne alors qu'on corrige le cable.
fn _coax_z0(ra: f64, rb: f64, er: f64) -> f64 {
    if ra <= 0.0 || rb <= ra || er <= 0.0 {
        return 0.0;
    }
    59.9585 / er.sqrt() * (rb / ra).ln()
}

/// Le conducteur du haut et celui du bas, de deux conducteurs.
fn haut_bas<'a>(ca: &'a Json, cb: &'a Json) -> (&'a Json, &'a Json) {
    if f(&ca["z0"]) > f(&cb["z0"]) { (ca, cb) } else { (cb, ca) }
}

/// Le petit volume d'un port localise, entre deux conducteurs.
///
/// LE PORT EST UNE LIGNE, PAS UNE BOITE, ET CE N'EST PAS UN DETAIL DE STYLE.
/// openEMS mesure le courant du port en integrant H sur une SURFACE qui est
/// toute l'empreinte du port, prise a mi-hauteur (voir `LumpedPort.__init__`
/// dans openEMS/ports.py). Donner a cette empreinte la largeur du ruban
/// revient a y compter, en plus du courant du port, le courant de deplacement
/// qui traverse le dielectrique sous le ruban -- lequel n'est pas du courant
/// de port. L'impedance d'entree qui en sort n'est plus celle de l'antenne.
/// Mesure faite sur le patch 2,45 GHz de l'exemple : avec une empreinte de
/// 1,56 x 3,11 mm la resonance n'apparait pas du tout ; avec la ligne
/// ci-dessous, a maillage et geometrie identiques, elle revient. C'est aussi
/// la forme qu'emploient tous les exemples d'openEMS.
///
/// `w` et `l` ne sont donc plus la taille de la source : ils restent la
/// trace de ce que l'utilisateur a designe, et 15-overlay2d.js continue de
/// les dessiner. Ce qui part au solveur est la ligne qui joint les deux
/// conducteurs au point du port.
fn _port_volume_localise(p: &Json, ca: &Json, cb: &Json, direction: &str, x: f64, y: f64, k_mm: f64) -> Res<Json> {
    if direction == "z" {
        // Entre la face superieure du conducteur du bas et la face
        // inferieure de celui du haut : le port occupe le dielectrique, pas
        // le metal. Un port qui mord dans le cuivre est court-circuite.
        let (haut, bas) = haut_bas(ca, cb);
        let (z0, z1) = (f(&bas["z1"]), f(&haut["z0"]));
        if z1 - z0 <= 0.0 {
            return Err(refus(
                "Les deux couches du port se touchent : hauteur nulle.",
                &format!("Verifiez l'epaisseur du dielectrique entre « {} » et « {} ».", txt(&ca["nom"]), txt(&cb["nom"]))));
        }
        return Ok(obj! {"x1" => x, "x2" => x, "y1" => y, "y2" => y,
                        "z1" => z0, "z2" => z1});
    }
    // Port dans le plan : l'excitation est horizontale (fente, dipole
    // imprime). La hauteur est celle du conducteur designe.
    let (z0, z1) = (f(&ca["z0"]), f(&ca["z1"]));
    let ecart = _nb_pos(&p["ecart"], 0.2) * k_mm;
    // Meme regle en travers : l'ECART reste -- c'est la fente aux bornes de
    // laquelle la tension existe, la degenerer supprimerait le port -- mais la
    // largeur s'efface. L'epaisseur en z est celle du conducteur, nulle des
    // que le cuivre est modelise en feuille.
    if direction == "x" {
        return Ok(obj! {"x1" => x - ecart / 2.0, "x2" => x + ecart / 2.0,
                        "y1" => y, "y2" => y,
                        "z1" => z0, "z2" => z1});
    }
    Ok(obj! {"x1" => x, "x2" => x,
             "y1" => y - ecart / 2.0, "y2" => y + ecart / 2.0,
             "z1" => z0, "z2" => z1})
}

/// Le connecteur : ame, gaine, dielectrique, degagements, et la source.
///
/// `ca` porte l'ame (la couche de l'antenne), `cb` la gaine (le plan de
/// masse). Le troncon sort de la carte DU COTE DE LA MASSE : c'est la que se
/// visse un connecteur, et c'est le seul sens ou la gaine puisse toucher le
/// plan sans traverser l'antenne.
fn _port_coaxial(p: &Json, ca: &Json, cb: &Json, conducteurs: &[Json], x: f64, y: f64, k_mm: f64) -> Res<(Json, Json)> {
    let ra = _nb_pos(&p["ra"], COAX_RA) * k_mm;
    let rb = _nb_pos(&p["rb"], COAX_RB) * k_mm;
    let ep = _nb_pos(&p["ep_gaine"], COAX_EP) * k_mm;
    let er = ou(_nb_pos(&p["er"], COAX_ER), COAX_ER);
    // `_nb` ET NON `_nb_pos` : une longueur explicitement nulle doit etre
    // refusee, pas remplacee en silence par le defaut. Absente, elle vaut le
    // troncon standard ; ecrite a zero, elle est une faute.
    let lg = _nb(&p["longueur"], COAX_LONGUEUR) * k_mm;

    if rb <= ra {
        return Err(refus(
            format!("Le coaxial du port a une gaine (rayon {:.3} mm) qui n'est pas \
                     plus large que son ame ({:.3} mm).", rb, ra),
            "L'impedance d'un coaxial vaut 60/racine(er).ln(b/a) : il lui \
             faut b > a. Une SMA ordinaire donne a = 0,635 et b = 2,05 mm."));
    }
    if lg <= 0.0 {
        return Err(refus(
            "Le troncon de coaxial a une longueur nulle.",
            "Donnez-lui quelques millimetres : c'est la ligne de transmission \
             entre la source et la carte, et le plan de reference des S est a \
             son extremite."));
    }

    // Le sens ou sort le connecteur : du cote de la masse.
    let sens = if f(&cb["z0"]) < f(&ca["z0"]) { -1.0 } else { 1.0 };
    let z_gaine = if sens < 0.0 { f(&cb["z0"]) } else { f(&cb["z1"]) };
    let z_bas = z_gaine + sens * lg;
    // L'ame va du bout du troncon jusqu'a la face exterieure de la couche a
    // laquelle elle se raccorde : elle traverse donc toute la carte.
    let z_ame = if sens < 0.0 { f(&ca["z1"]) } else { f(&ca["z0"]) };
    // LA CROIX D'ALIMENTATION EST AU BOUT DU TRONCON, ET IL N'Y A RIEN
    // DERRIERE. C'est exactement la disposition d'un port localise : la source
    // et sa resistance occupent le meme volume, et le cote oppose est le bord
    // du modele. Un fond metallique pose derriere la source la court-
    // circuiterait ; pose derriere une charge, il la renverrait a un
    // court-circuit -- et un port 2 court-circuite au lieu d'etre adapte rend
    // un S21 qui ne veut rien dire, puisque les S se definissent tous autres
    // ports FERMES SUR LEUR IMPEDANCE.
    let z_feed = z_bas;
    // Le plan de mesure : a mi-troncon. Assez loin de la source pour que les
    // modes superieurs soient morts, assez loin de la carte pour que le champ
    // de bord du degagement ne soit pas compte comme de la ligne.
    let z_mes = 0.5 * (z_bas + z_gaine);
    // LA BOUCLE DE COURANT EST UN CARRE, ET SES COINS SONT PLUS LOIN QUE SES
    // COTES. `rm` est son demi-cote : les cotes passent a rm de l'axe, les
    // coins a rm.racine(2). Au milieu de la couronne -- rm = (a+b)/2 -- les
    // coins sortaient de la gaine des que b/a < 2,414 : un coaxial a air de
    // 50 ohms (b/a = 2,3) comptait dans sa boucle une part du courant de
    // retour de la gaine, et l'impedance lue etait fausse sans que rien le
    // dise. Le demi-cote est donc pris a mi-chemin entre l'ame et le plus
    // grand carre qui tienne dans la gaine, b/racine(2).
    let rb_carre = rb / 2.0f64.sqrt();
    if ra >= rb_carre {
        return Err(refus(
            format!("Le coaxial du port est trop gras pour sa gaine : ame de {:.3} mm \
                     pour une gaine de {:.3} mm (b/a = {:.2}).", ra, rb, rb / ra),
            &format!("La sonde de courant est un carre autour de l'ame, qui doit tenir \
                      dans la gaine : il faut b/a > 1,414, soit Z0 > {:.1} ohms avec \
                      er = {:.2}. Une SMA ordinaire donne a = 0,635 et b = 2,05 mm.",
                     _coax_z0(1.0, 2.0f64.sqrt(), er), er)));
    }
    let rm = 0.5 * (ra + rb_carre);

    // LES DEGAGEMENTS. Toute couche de cuivre que l'ame traverse doit etre
    // percee, sauf celle qui la recoit. Celle de la gaine en fait partie : sans
    // son degagement l'ame touche le plan de masse, et le port est un
    // court-circuit.
    let (zmin, zmax) = (mini(z_ame, z_bas), maxi(z_ame, z_bas));
    let mut degagements = Vec::new();
    for c in conducteurs {
        if txt(&c["nom"]) == txt(&ca["nom"]) {
            continue;
        }
        if f(&c["z1"]) < zmin - 1e-9 || f(&c["z0"]) > zmax + 1e-9 {
            continue;
        }
        degagements.push(obj! {"couche" => c["nom"].clone(), "z0" => c["z0"].clone(), "z1" => c["z1"].clone(),
                               "r" => rb});
    }

    let coax = obj! {
        "ra" => ra, "rb" => rb, "ep_gaine" => ep, "er" => er, "longueur" => lg,
        "sens" => sens, "z_gaine" => z_gaine, "z_bas" => z_bas, "z_ame" => z_ame,
        "z_feed" => z_feed, "z_mes" => z_mes, "rm" => rm,
        "z0_ligne" => _coax_z0(ra, rb, er),
        "degagements" => Json::Liste(degagements),
    };
    // Le « volume » declare du port : le bras +x de la croix. Il ne sert qu'a
    // ce qui regarde tous les ports sans distinction -- le maillage, l'emprise,
    // la vue 3D. La croix entiere, elle, est ecrite par le script.
    let volume = obj! {"x1" => x + ra, "x2" => x + rb,
                       "y1" => y - ra, "y2" => y + ra,
                       "z1" => z_feed, "z2" => z_feed};
    Ok((coax, volume))
}

// ==========================================================================
// Le microruban : ce que la ligne d'alimentation fait a l'impedance lue
// --------------------------------------------------------------------------
// POURQUOI CES FORMULES SONT ICI AUSSI. Elles vivent deja dans la page
// (22-antennes.js), qui s'en sert pour SYNTHETISER une largeur de ligne a
// 50 ohms. Ce qu'on en fait ici est l'inverse : une ligne DEJA dessinee, dont
// on veut savoir ce qu'elle fait a l'impedance qu'on mesure a son bout. Les
// deux jeux doivent rendre les memes nombres -- Hammerstad dans sa forme
// usuelle, la meme des deux cotes --, et le banc le verifie.
/// La permittivite effective : une partie du champ passe dans l'air.
pub fn microruban_eeff(er: f64, h: f64, w: f64) -> f64 {
    (er + 1.0) / 2.0 + (er - 1.0) / 2.0 * (1.0 + 12.0 * h / maxi(w, 1e-6)).powf(-0.5)
}

/// L'impedance caracteristique d'un ruban de largeur w sur h.
pub fn microruban_z0(er: f64, h: f64, w: f64) -> f64 {
    let e = microruban_eeff(er, h, w);
    let u = w / maxi(h, 1e-9);
    if u <= 1.0 {
        return 60.0 / e.sqrt() * (8.0 / u + u / 4.0).ln();
    }
    120.0 * std::f64::consts::PI / (e.sqrt() * (u + 1.393 + 0.667 * (u + 1.444).ln()))
}

/// L'epaisseur et la permittivite du dielectrique qui separe deux
/// conducteurs. Rend (0, 0) s'il n'y a rien entre les deux -- un port dans le
/// plan, par exemple, dont les deux bornes sont sur la MEME couche.
///
/// Plusieurs dielectriques empiles se resument a leur epaisseur totale et a
/// la permittivite du plus epais. C'est une approximation, et elle est dite :
/// un microruban sur un empilage mixte n'a pas d'er effectif elementaire, et
/// pretendre le calculer exactement ici serait pretendre plus que ce que le
/// modele de ligne sait faire.
fn _substrat_entre(dielectriques: &[Json], ca: &Json, cb: &Json) -> (f64, f64) {
    let zb = mini(f(&ca["z1"]), f(&cb["z1"]));
    let zh = maxi(f(&ca["z0"]), f(&cb["z0"]));
    if zh - zb <= 0.0 {
        return (0.0, 0.0);
    }
    let (mut h, mut er, mut ep_max) = (0.0, 0.0, 0.0);
    for d in dielectriques {
        let (d0, d1) = (maxi(f(&d["z0"]), zb), mini(f(&d["z1"]), zh));
        if d1 - d0 <= 0.0 {
            continue;
        }
        h += d1 - d0;
        if d1 - d0 > ep_max {
            (ep_max, er) = (d1 - d0, f(&d["er"]));
        }
    }
    (h, er)
}

/// La ligne d'alimentation DECLAREE entre le port et le pied de l'antenne.
///
/// CE QU'ELLE SERT A FAIRE, ET CE QU'ELLE NE FAIT PAS. L'impedance est lue la
/// ou le port est pose -- au bord de la carte quand l'antenne est alimentee
/// par un ruban. Ce n'est pas la meme chose que l'impedance de l'antenne : il
/// y a un bout de ligne entre les deux, et une ligne FAIT TOURNER
/// l'impedance. Declarer sa longueur et sa largeur permet de ramener la
/// mesure au pied de l'antenne, ce qui est le seul endroit ou elle dise quoi
/// corriger sur l'antenne.
///
/// ELLE NE CHANGE PAS L'ADAPTATION, et c'est demontre : une ligne sans perte
/// dont le Z0 est celui de reference ne change pas |Gamma|, elle le fait
/// TOURNER. Deux simulations du gabarit, la seconde avec la ligne DOUBLEE,
/// donnent -0,64 dB et -1,20 dB a 2,45 GHz -- un demi-decibel, soit ce que
/// 6,4 mm de FR-4 a tan d = 0,02 dissipent, et rien de plus. Qui cherche une
/// desadaptation ne la trouvera jamais ici.
///
/// LE DESEMBEDAGE EST SANS PERTE, ET IL FAUT LE DIRE. La rotation se fait sur
/// un Z0 reel : ce que la ligne dissipe reste dans le S11 lu. Et pres du bord
/// de l'abaque -- une antenne mal adaptee, |Gamma| proche de 1 -- la rotation
/// amplifie toute erreur sur Z0 et sur er effectif : l'impedance ramenee y est
/// fragile, et le savoir vaut mieux que de la croire au dixieme d'ohm.
fn _ligne_alim(p: &Json, ca: &Json, cb: &Json, dielectriques: &[Json], k_mm: f64, rang: usize) -> Res<Option<Json>> {
    let b = &p["ligne"];
    let d = _nb_pos(&b["longueur"], 0.0) * k_mm;
    if d <= 0.0 {
        return Ok(None);
    }
    let w = _nb_pos(&b["largeur"], 0.0) * k_mm;
    if w <= 0.0 {
        return Err(refus(
            format!("Le port {} declare une ligne d'alimentation de {:.3} mm de long \
                     sans dire sa largeur.", rang, d),
            "C'est la largeur du ruban qui donne son impedance \
             caracteristique : sans elle, ramener la mesure au pied de \
             l'antenne reviendrait a inventer un nombre."));
    }
    let (h, er) = _substrat_entre(dielectriques, ca, cb);
    if h <= 0.0 || er <= 0.0 {
        return Err(refus(
            format!("Le port {} declare une ligne d'alimentation, mais il n'y a aucun \
                     dielectrique entre « {} » et « {} ».", rang, txt(&ca["nom"]), txt(&cb["nom"])),
            "Un microruban est un ruban AU-DESSUS d'un plan de masse, separe \
             par un substrat. Completez l'empilage a l'etape 2."));
    }
    Ok(Some(obj! {"d" => d, "w" => w, "h" => h, "er" => er,
                  "eeff" => microruban_eeff(er, h, w),
                  "z0" => microruban_z0(er, h, w)}))
}

/// Le port MICRORUBAN d'openEMS (`MSLPort`), pose SUR la ligne declaree.
///
/// CE QU'IL APPORTE, et que la ligne declaree seule ne donne pas : le Z0 de la
/// ligne TELLE QU'ELLE EST MAILLEE (le port le mesure par ses sondes de
/// tension et de courant, au lieu de le calculer sur un ruban ideal), une
/// constante de propagation mesuree elle aussi, et une excitation en onde
/// progressive dont le retour est absorbe par la resistance de source.
/// L'impedance est ramenee au pied de l'antenne par CETTE propagation-la.
///
/// CE QU'IL NE FAIT PAS : prolonger la ligne hors de la carte jusqu'a la
/// paroi, comme le tutoriel `MSL_NotchFilter`. Le port couvre le ruban
/// dessine, du point d'alimentation au pied de l'antenne ; la geometrie
/// simulee reste celle qui est dessinee.
///
/// LA DIRECTION SE LIT AU BORD DU PLAN DE MASSE -- la couche sous le ruban,
/// dont la ligne part, et non l'ensemble du cuivre : le bout arrondi de la
/// piste d'alimentation depasse du bord d'une demi-largeur, et mesurer depuis
/// lui raccourcissait le port d'autant (3,9 mm au lieu de 5,4 sur le patch).
fn _port_msl(port: &Json, ligne: &Json, ca: &Json, cb: &Json, boite_cu: &[f64; 4], rang: usize,
             boites: &[(String, [f64; 4])]) -> Res<Json> {
    if txt(&port["dir"]) != "z" {
        return Err(refus(
            format!("Le port {} est un port microruban, mais son excitation n'est pas \
                     verticale.", rang),
            "Un microruban se mesure entre le ruban et le plan de masse en \
             dessous : posez le port entre ces deux couches."));
    }
    let (haut, bas) = haut_bas(ca, cb);
    let boite_cu = boites.iter().rev().find(|(c, _)| c == txt(&bas["nom"])).map(|(_, b)| b).unwrap_or(boite_cu);
    let (x, y, d) = (f(&port["x"]), f(&port["y"]), f(&ligne["d"]));
    // min() de quatre tuples (distance, axe, sens, bord) : le premier des plus petits
    let mut choix = (x - boite_cu[0], "x", 1.0, boite_cu[0]);
    for c in [(boite_cu[2] - x, "x", -1.0, boite_cu[2]),
              (y - boite_cu[1], "y", 1.0, boite_cu[1]), (boite_cu[3] - y, "y", -1.0, boite_cu[3])] {
        if c.partial_cmp(&choix) == Some(std::cmp::Ordering::Less) {
            choix = c;
        }
    }
    let (dist, axe, sens, bord) = choix;
    if dist > 0.5 * d {
        return Err(refus(
            format!("Le port {} est un port microruban, mais il n'est pas au bord du \
                     cuivre ({:.2} mm du bord le plus proche, ligne de {:.2} mm).", rang, dist, d),
            "Le port microruban part du point d'alimentation, au bord de la \
             carte, et suit la ligne jusqu'au pied de l'antenne. Ailleurs, \
             gardez le port localise et la ligne declaree."));
    }
    let debut = if axe == "x" { x } else { y };
    let fin = bord + sens * d;
    if (fin - debut) * sens <= 0.25 * d {
        return Err(refus(
            format!("Le port {} est un port microruban sur une ligne trop courte \
                     ({:.2} mm).", rang, (fin - debut).abs()),
            "Il lui faut quelques cellules de ruban entre la source et le pied \
             de l'antenne pour y mesurer une onde."));
    }
    let travers = if axe == "x" { y } else { x };
    let w = f(&ligne["w"]);
    Ok(obj! {"axe" => axe, "debut" => debut, "fin" => fin,
             "t1" => travers - w / 2.0, "t2" => travers + w / 2.0,
             "z_ruban" => haut["z0"].clone(), "z_masse" => bas["z1"].clone()})
}

/// Un port : ce qu'il relie, ou il est, et le volume qu'il occupe.
///
/// TROIS FAUTES REVIENNENT TOUJOURS, et les trois sont refusees plutot que
/// rendues : un volume d'epaisseur nulle (les deux couches se touchent), un
/// port qui relie une couche a elle-meme, et un port pose hors du cuivre
/// retenu. Aucune ne se voit dans le S11 : elles ressemblent toutes a des
/// resultats.
fn _un_port(p: &Json, rang: usize, conducteurs: &[Json], dielectriques: &[Json], k_mm: f64, boite_cu: &[f64; 4],
            boites: &[(String, [f64; 4])]) -> Res<Json> {
    // UN PORT JAMAIS CLIQUE N'EST PAS UN PORT. Ses cotes valent (0 ; 0) et ses
    // couches sont les valeurs par defaut : le modele se chiffrait quand meme,
    // sur un point pris au hasard -- douze millions de cellules pour exciter
    // le coin de la carte. `pose` absent (ancien document, banc d'essai) vaut
    // « pose ».
    if matches!(p["pose"], Json::Bool(false)) {
        return Err(refus(
            format!("Le port {} n'est pas pose.", rang),
            "A l'etape « Le port », cliquez « Cliquez le point d'alimentation \
             sur la carte », puis le pied de l'antenne : l'assistant en tire \
             la position, la largeur de la piste et les deux couches."));
    }
    let genre = ou_texte(_texte(&p["type"], 20), "localise").to_lowercase();
    let genre = if genre.starts_with("coax") { "coaxial" } else { "localise" };
    let mut direction = ou_texte(_texte(&p["dir"], 2), "z").to_lowercase();
    if !matches!(direction.as_str(), "x" | "y" | "z") {
        direction = "z".into();
    }

    let x = _nb(&p["x"], 0.0) * k_mm;
    let y = _nb(&p["y"], 0.0) * k_mm;
    // L'etendue du port dans le plan : une petite plage, pas un point. Par
    // defaut la largeur de la piste d'alimentation, a defaut un dixieme de
    // millimetre -- assez pour qu'une cellule s'y pose.
    let w = _nb_pos(&p["w"], 0.3) * k_mm;
    let l = _nb_pos(&p["l"], 0.3) * k_mm;

    let nom_a = _texte(&p["de"], 120);
    let nom_b = _texte(&p["a"], 120);
    let (Some(ca), Some(cb)) = (_conducteur(conducteurs, &nom_a), _conducteur(conducteurs, &nom_b)) else {
        return Err(refus(
            format!("Le port {} doit relier deux couches de l'empilage \
                     (recues : « {} » et « {} »).", rang,
                    if nom_a.is_empty() { "?" } else { &nom_a }, if nom_b.is_empty() { "?" } else { &nom_b }),
            "Choisissez la couche de l'antenne et celle du plan de masse \
             dans le panneau « Le port »."));
    };
    // UN PORT DANS LE PLAN A SES DEUX BORNES SUR LA MEME COUCHE : c'est la
    // fente qu'il enjambe qui fait la difference de potentiel, et `a` ne sert
    // a rien (`_port_volume_localise` ne lit que `ca`). Le refuser rendait
    // impossible toute antenne coplanaire sur une carte simple face, ou la
    // page n'a pas de couche voisine a proposer.
    let dans_plan = genre == "localise" && matches!(direction.as_str(), "x" | "y");
    if txt(&ca["nom"]) == txt(&cb["nom"]) && !dans_plan {
        return Err(refus(
            format!("Le port {} relie « {} » a elle-meme.", rang, txt(&ca["nom"])),
            "Un port excite une DIFFERENCE de potentiel : il lui faut deux \
             conducteurs distincts."));
    }

    let mut coax = None;
    let volume;
    if genre == "coaxial" {
        let (c, v) = _port_coaxial(p, ca, cb, conducteurs, x, y, k_mm)?;
        coax = Some(c);
        volume = v;
        direction = "x".into(); // la source est radiale, selon +x
    } else {
        volume = _port_volume_localise(p, ca, cb, &direction, x, y, k_mm)?;
    }

    let marge = 1.0;
    if !(boite_cu[0] - marge <= x && x <= boite_cu[2] + marge
         && boite_cu[1] - marge <= y && y <= boite_cu[3] + marge) {
        return Err(refus(
            format!("Le port {} est pose hors du cuivre selectionne \
                     ({:.3} ; {:.3} mm).", rang, x, y),
            "Cliquez le point d'alimentation sur la carte plutot que \
             de saisir des coordonnees a la main."));
    }

    let mut out = obj! {
        "n" => rang,
        "nom" => ou_texte(_texte(&p["nom"], 40), format!("port {}", rang)),
        "type" => genre,
        "dir" => direction,
        "x" => x, "y" => y, "w" => w, "l" => l,
        "R" => _nb_pos(&p["R"], 50.0),
        "de" => ca["nom"].clone(), "a" => cb["nom"].clone(),
        "excite" => p.get("excite").map(|v| v.vrai()).unwrap_or(true),
        // La phase d'excitation en degres. Elle ne compte que dans un reseau ;
        // voir `_retards`. PAS RAMENEE A [0, 360) : -90, 0, +90 est un
        // gradient, 270, 0, 90 n'en est plus un hors de la frequence visee.
        "phase" => maxi(-3600.0, mini(3600.0, _nb(&p["phase"], 0.0))),
    };
    if let (Json::Objet(o), Json::Objet(v)) = (&mut out, volume) {
        o.extend(v);
    }
    if let Some(coax) = coax {
        poser(&mut out, "coax", coax);
    } else {
        // UN COAXIAL NE DECLARE PAS DE LIGNE : il porte deja son propre deport
        // de plan de reference, ramene a la surface de la carte, et empiler un
        // second desembedage par-dessus reviendrait a compter deux fois.
        let ligne = _ligne_alim(p, ca, cb, dielectriques, k_mm, rang)?;
        // Deux ESSAIS pour l'ecart de +1 % du MSLPort (HISTORIQUE.md, § 1) :
        // « maillage » pose les lignes du MSLPort sous un port localise (c'est
        // devenu le defaut), « grossier » garde le MSLPort sans son affinage.
        let mode = match &p["msl"] {
            Json::Bool(true) => Some("vrai"),
            Json::Texte(t) if t == "maillage" => Some("maillage"),
            Json::Texte(t) if t == "grossier" => Some("grossier"),
            _ => None,
        };
        if let Some(ligne) = ligne {
            poser(&mut out, "ligne", ligne.clone());
            if let Some(mode) = mode {
                let mut q = _port_msl(&out, &ligne, ca, cb, boite_cu, rang, boites)?;
                if mode == "maillage" {
                    poser(&mut out, "msl_maillage", q);
                } else {
                    if mode == "grossier" {
                        poser(&mut q, "grossier", true);
                    }
                    poser(&mut out, "msl", q);
                }
            } else {
                // LE RUBAN DECLARE SE MAILLE FIN PAR DEFAUT (campagne du
                // 22/10/2026) : sous ses lignes, le port localise remontait la
                // resonance du patch de 0,74 % -- il etait sous-maille. Un port
                // que le MSLPort ne sait pas suivre (loin du bord, de travers)
                // garde le maillage d'avant, sans refus : ce n'est pas un choix.
                if let Ok(q) = _port_msl(&out, &ligne, ca, cb, boite_cu, rang, boites) {
                    poser(&mut out, "msl_maillage", q);
                }
            }
        } else if mode.is_some() {
            return Err(refus(
                format!("Le port {} est un port microruban sans ligne declaree.", rang),
                "Le port microruban couvre la ligne d'alimentation : declarez \
                 sa longueur et sa largeur dans le panneau du port."));
        }
    }
    Ok(out)
}

/// Tous les ports du modele, dans l'ordre ou la page les a poses.
///
/// L'ANCIENNE FORME RESTE LUE. Un document qui ne porte qu'un `port` -- ceux
/// qu'ecrivait la version a un seul port, et ceux du banc d'essai -- vaut une
/// liste d'un element : le format d'entree ne casse pas parce que l'outil a
/// appris a en compter deux.
pub(super) fn _ports(doc: &Json, conducteurs: &[Json], dielectriques: &[Json], k_mm: f64, boite_cu: &[f64; 4],
                     boites: &[(String, [f64; 4])]) -> Res<Vec<Json>> {
    let plein = |p: &&Json| p.as_objet().is_some_and(|o| !o.is_empty());
    let mut bruts: Vec<&Json> = liste(&doc["ports"]).iter().filter(plein).collect();
    if bruts.is_empty() {
        bruts = Some(&doc["port"]).filter(plein).into_iter().collect();
    }
    if bruts.is_empty() {
        return Err(refus(
            "Aucun port d'excitation.",
            "Posez le port a l'etape « Le port » : c'est par lui que l'onde \
             entre, et c'est lui qui donne le S11."));
    }
    if bruts.len() > MAX_PORTS {
        return Err(refus(
            format!("{} ports demandes, {} au plus.", bruts.len(), MAX_PORTS),
            "Au-dela, les volumes de port pesent plus que l'antenne et le \
             tableau des S devient illisible."));
    }

    let mut out = Vec::new();
    for (i, p) in bruts.iter().enumerate() {
        out.push(_un_port(p, i + 1, conducteurs, dielectriques, k_mm, boite_cu, boites)?);
    }

    // Plusieurs ports excites : un reseau alimente en phase (voir MAX_PORTS).
    // Deux excitations AU MEME ENDROIT ne sont pas un reseau, c'est un port
    // compte deux fois -- l'amplitude doublee y passerait pour un gain.
    let mut places = HashSet::new();
    let mut excites = 0;
    for p in out.iter().filter(|p| p["excite"].vrai()) {
        excites += 1;
        let cle = ((py::round(f(&p["x"]), 6) + 0.0).to_bits(), (py::round(f(&p["y"]), 6) + 0.0).to_bits(),
                   txt(&p["de"]).to_string(), txt(&p["a"]).to_string());
        if !places.insert(cle) {
            return Err(refus(
                format!("Deux ports excites au meme endroit (port {}).", ent(&p["n"])),
                "Un reseau excite des elements DISTINCTS. Deplacez le port, ou \
                 decochez son excitation pour le laisser en charge."));
        }
    }
    if excites == 0 {
        poser(&mut out[0], "excite", true);
    }
    Ok(out)
}

/// La phase de chaque port excite, traduite en RETARD de l'impulsion.
///
/// UNE IMPULSION N'A PAS DE PHASE, ELLE A UN INSTANT. openEMS excite par une
/// gaussienne large bande ; la seule facon de dephaser un port est de la
/// retarder (`delay=` des ports d'openEMS). Un retard tau donne une phase
/// -2.pi.f.tau : exacte a UNE frequence -- la frequence visee --, et qui
/// suit f ailleurs. C'est un retard vrai, pas un dephaseur : le faisceau ne
/// louche pas avec la frequence, il garde son angle.
///
/// Un retard est positif : on part de la phase la plus en AVANCE, qui n'est
/// pas retardee, et chaque autre port l'est de son ecart. Les phases ne sont
/// PAS ramenees a [0, 360) : un gradient -90 / 0 / +90 reste un gradient de
/// retards, et le faisceau garde son angle sur toute la bande. Le plus grand
/// retard peut donc depasser une periode ; le compteur de pas en tient
/// compte.
pub(super) fn _retards(ports: &mut [Json], bande: &Json) {
    let freq = ou(ou(f(&bande["fcible"]), f(&bande["f0"])), 0.0);
    for p in ports.iter_mut() {
        poser(p, "retard_s", 0.0);
    }
    let phases: Vec<f64> = ports.iter().filter(|p| p["excite"].vrai()).map(|p| f(&p["phase"])).collect();
    if phases.len() < 2 || freq <= 0.0 {
        return;
    }
    let reference = max_de(phases);
    for p in ports.iter_mut().filter(|p| p["excite"].vrai()) {
        let retard = (reference - f(&p["phase"])) / (360.0 * freq);
        poser(p, "retard_s", retard);
    }
}

/// Ce qu'un port ajoute a l'emprise. Un connecteur coaxial sort de la
/// carte : une boite d'air mesuree sans lui le laisserait DANS la PML --
/// c'est-a-dire hors du calcul, sans que rien ne le dise.
pub(super) fn _emprise_port(p: &Json) -> [f64; 6] {
    let c = &p["coax"];
    if !c.vrai() {
        return [f(&p["x1"]), f(&p["y1"]), f(&p["z1"]), f(&p["x2"]), f(&p["y2"]), f(&p["z2"])];
    }
    let r = f(&c["rb"]) + f(&c["ep_gaine"]);
    let zs = [f(&c["z_bas"]), f(&c["z_gaine"]), f(&c["z_ame"])];
    [f(&p["x"]) - r, f(&p["y"]) - r, min_de(zs),
     f(&p["x"]) + r, f(&p["y"]) + r, max_de(zs)]
}

// ==========================================================================
// La bande de frequence et l'excitation
// ==========================================================================

pub(super) fn _bande(doc: &Json) -> Res<Json> {
    let b = &doc["bande"];
    let mut f1 = _nb_pos(&b["f1"], 0.0);
    let mut f2 = _nb_pos(&b["f2"], 0.0);
    if f1 <= 0.0 || f2 <= 0.0 {
        return Err(refus(
            "Bande de frequence absente ou nulle.",
            "Saisissez la bande a simuler a l'etape 5 (par exemple \
             2,0 a 3,0 GHz pour une antenne 2,45 GHz)."));
    }
    if f2 < f1 {
        (f1, f2) = (f2, f1);
    }
    if f2 - f1 < f2 * 1e-4 {
        return Err(refus(
            format!("La bande est trop etroite ({} a {} Hz).", fmt_g(f1, 4), fmt_g(f2, 4)),
            "Une impulsion gaussienne a besoin d'une largeur : prenez au \
             moins quelques pour cent autour de la frequence visee."));
    }
    let n = (_nb_pos(&b["n"], 401.0) as i64).clamp(21, 4001);
    // L'impulsion gaussienne d'openEMS est decrite par son centre f0 et sa
    // demi-largeur fc : elle couvre alors [f0-fc, f0+fc].
    let f0 = (f1 + f2) / 2.0;
    //
    // ON EXCITE PLUS LARGE QU'ON N'ANALYSE, ET C'EST UN GAIN DES DEUX COTES.
    // La duree de l'impulsion varie comme 1/fc : une bande d'analyse a plus ou
    // moins 15 % donnait une impulsion de 7,8 ns, soit pres de DIX MILLE pas
    // de temps rien que pour l'emettre. openEMS s'en plaint lui-meme --
    // « max. number of timesteps is smaller than three times the excitation »
    // -- et il a raison : une simulation coupee avant que l'impulsion ne soit
    // finie ne rend pas une mesure, elle rend une troncature. En excitant sur
    // une demi-octave, l'impulsion tombe a 2,9 ns et le calcul raccourcit
    // d'autant.
    //
    // Le second gain est la ou on ne l'attend pas : aux BORDS de la bande. Par
    // definition, une gaussienne n'a plus que -20 dB d'energie a f0 +/- fc ;
    // calquer fc sur la bande analysee revenait a mesurer les extremites de la
    // courbe la ou l'excitation n'a presque rien mis. Le S11 y devenait le
    // rapport de deux petits nombres, et il en sortait des |S11| superieurs a
    // 1 qu'il fallait ecreter apres coup.
    //
    // L'analyse, elle, ne bouge pas : f1 et f2 restent la bande demandee.
    let fc = maxi((f2 - f1) / 2.0, EXCITATION_LARGEUR_MIN * f0);
    Ok(obj! {"f1" => f1, "f2" => f2, "n" => n, "f0" => f0, "fc" => fc,
             // La duree de l'impulsion, telle qu'openEMS la calcule
             // (Gauss : 2 x 9/(2.pi.fc)). C'est elle qui fixe le nombre de pas
             // minimal, et l'assistant la relit pour le dire.
             "t_excitation" => 9.0 / (std::f64::consts::PI * fc),
             "fcible" => ou(_nb_pos(&b["fcible"], 0.0), f0)})
}
