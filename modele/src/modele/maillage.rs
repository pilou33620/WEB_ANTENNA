//! La boite d'air, la PML et le maillage, son budget, les pertes dielectriques, les
//! enregistrements de champ et l'estimation (openems_modele.py, de `_boite` a `_estimation`).

use super::*;

// ==========================================================================
// La boite d'air, la PML et le maillage
// ==========================================================================

/// La boite de calcul : le cuivre, l'air, puis la PML.
///
/// LA MARGE SE COMPTE EN DEUX MORCEAUX, ET LES CONFONDRE EST LA FAUTE QUI
/// COUTE LE PLUS CHER ICI.
///
///   1. l'AIR PHYSIQUE, entre l'antenne et le debut de la couche absorbante :
///      un quart de la longueur d'onde a la frequence LA PLUS BASSE. C'est la
///      distance au bout de laquelle le champ proche reactif s'est assez
///      eteint pour que la PML n'ait plus a l'absorber. Trop court,
///      l'impedance d'entree derive et la resonance se deplace — sans que
///      rien ne le signale ;
///   2. la PML ELLE-MEME, qui occupe les N cellules les plus exterieures de
///      la boite. Ce n'est pas de l'air : c'est un materiau absorbant, et ce
///      qui s'y trouve n'est pas simule mais mange.
///
/// Une marge de « lambda/4 » tout court place donc la PML SUR l'antenne :
/// avec un pas d'air de lambda/20, huit couches de PML font 8/20 = 0,4
/// lambda, c'est-a-dire plus que le quart de lambda qu'on croyait s'etre
/// reserve. Le conseil rendu ici est la SOMME des deux.
pub(super) fn _boite(doc: &Json, emprise: &[f64; 6], bande: &Json, res_air: f64, k_mm: f64) -> Json {
    let b = &doc["boite"];
    let lam_max = C0 / f(&bande["f1"]) * 1000.0; // mm, a la frequence basse
    let pml = (_nb_pos(&b["pml"], PML_DEFAUT as f64) as i64).clamp(4, 20);

    let air_utile = MARGE_LAMBDA * lam_max;
    let ep_pml = pml as f64 * res_air;
    let marge_conseil = air_utile + ep_pml;

    // LES MARGES SONT DANS L'UNITE DU FICHIER, comme tout le reste du
    // document : sur une carte en pouces, saisir une marge en millimetres a
    // cote de coordonnees en pouces serait une invitation a se tromper. Elles
    // passent donc par k_mm, exactement comme les polygones et le port. Sans
    // cela une carte en pouces recevait une boite vingt-cinq fois trop
    // petite — et l'erreur ne se voyait que sur le nombre de cellules.
    let mx = ou(_nb_pos(&b["mx"], 0.0) * k_mm, marge_conseil);
    let my = ou(_nb_pos(&b["my"], 0.0) * k_mm, marge_conseil);
    let mz_h = ou(_nb_pos(&b["mz_haut"], 0.0) * k_mm, marge_conseil);
    let mz_b = ou(_nb_pos(&b["mz_bas"], 0.0) * k_mm, marge_conseil);

    let petit = min_de([mx, my, mz_h, mz_b]);
    let [x1, y1, z1, x2, y2, z2] = *emprise;
    obj! {
        "x1" => x1 - mx, "x2" => x2 + mx,
        "y1" => y1 - my, "y2" => y2 + my,
        "z1" => z1 - mz_b, "z2" => z2 + mz_h,
        "mx" => mx, "my" => my, "mz_haut" => mz_h, "mz_bas" => mz_b,
        "pml" => pml,
        "ep_pml" => ep_pml,
        "air_utile" => air_utile,
        "marge_conseil" => marge_conseil,
        // L'air qui RESTE une fois la PML retranchee : c'est lui qui compte,
        // et il peut etre negatif — une marge plus courte que la PML veut dire
        // que l'absorbeur mord dans la structure.
        "air_restant" => petit - ep_pml,
        "marge_suffisante" => (petit - ep_pml) >= air_utile * 0.95,
    }
}

/// La boite englobante d'un contour : (x0, x1, y0, y1), ou None pour moins de trois points.
fn etendue(poly: &Poly) -> Option<[f64; 4]> {
    if poly.o.len() < 3 {
        return None;
    }
    let [x0, y0, x1, y1] = _boite_pts(&poly.o);
    Some([x0, x1, y0, y1])
}

/// Le plus petit cote du plus petit polygone de cuivre, dans le plan.
///
/// C'EST UNE APPROXIMATION, ET ELLE SE TROMPE TOUJOURS DU BON COTE. On prend
/// le petit cote de la BOITE ENGLOBANTE de chaque polygone : pour un troncon
/// de piste droit -- le cas courant, et celui qui compte -- c'est exactement
/// sa largeur. Pour une piste coudee, la boite est plus grosse que la piste :
/// la regle raffine alors MOINS qu'il ne faudrait, jamais plus. Une regle qui
/// se tromperait dans l'autre sens ferait exploser le maillage sur une carte
/// reelle sans que personne ne l'ait demande.
fn _largeur_cuivre_min(cuivre: &[Bloc]) -> Option<f64> {
    let mut petit: Option<f64> = None;
    for poly in cuivre.iter().flat_map(|b| &b.polys) {
        // LE CONTOUR SEUL, ET PAS LES DECOUPES. Compter aussi les fentes
        // serait defendable — une encoche etroite porte du champ — mais
        // mesure faite sur l'exemple, cela divise encore le pas par 1,25
        // et multiplie le calcul par pres de deux, pour une resonance qui
        // etait deja juste sans. Une structure dont la FENTE est l'organe
        // rayonnant (antenne a fente, patch a fente couplee) demande donc
        // encore un pas saisi a la main ; c'est dit ici plutot que
        // decouvert apres coup.
        let Some([x0, x1, y0, y1]) = etendue(poly) else { continue };
        let cote = mini(x1 - x0, y1 - y0);
        if cote > 1e-9 && petit.is_none_or(|m| cote < m) {
            petit = Some(cote);
        }
    }
    petit
}

/// Le pas de maillage le plus grand admissible, dans l'air et dans le
/// dielectrique.
///
/// DEUX BORNES, ET C'EST LA PLUS PETITE QUI GAGNE :
///
///   1. lambda/20 dans le milieu le plus lent, a la frequence LA PLUS HAUTE
///      de la bande -- c'est elle qui a la longueur d'onde la plus courte,
///      donc elle qui commande. C'est la borne classique, et elle suffit a
///      une antenne filaire dans l'air ;
///   2. la LARGEUR DU CUIVRE LE PLUS ETROIT, divisee par
///      CELLULES_PAR_PISTE. Un ruban rendu par deux cellules n'a pas
///      l'impedance d'un ruban.
///
/// La seconde ne s'applique QU'AU DIELECTRIQUE : l'air n'a pas de piste, et
/// le raffiner couterait des cellules pour rien. Elle est bornee par
/// LIGNES_MAX_EMPRISE -- voir la constante.
pub(super) fn _resolution(bande: &Json, er_max: f64, cuivre: &[Bloc], boite_cu: &[f64; 4]) -> (f64, f64, Json) {
    let lam_air = C0 / f(&bande["f2"]) * 1000.0;
    let res_air = lam_air / CELLULES_PAR_LAMBDA;
    let res_lam = lam_air / (CELLULES_PAR_LAMBDA * maxi(1.0, er_max).sqrt());

    let mut res_die = res_lam;
    let largeur = _largeur_cuivre_min(cuivre);
    // Le fond suit le cuivre, mais pas plus bas que `fond_min` : au-dela, ce
    // sont les bandes fines de `_mailler` qui resolvent la piste, en travers
    // d'elle seule. Voir FOND_DIVISEUR_MAX.
    let fond_min = res_lam / FOND_DIVISEUR_MAX;
    if let Some(l) = largeur {
        res_die = mini(res_die, maxi(l / CELLULES_PAR_PISTE, fond_min));
    }

    let cote = maxi(boite_cu[2] - boite_cu[0], boite_cu[3] - boite_cu[1]);
    let plancher = if cote > 0.0 { cote / LIGNES_MAX_EMPRISE } else { res_lam / 8.0 };
    // Un plancher plus grossier que le pas de lambda/20 n'aurait pas de sens :
    // la borne est la pour freiner le raffinement, pas pour degrader le fond.
    let plancher = mini(plancher, res_lam);
    let bornee = res_die < plancher;
    let res_die = maxi(res_die, plancher);
    // `air` et `die` sont les pas CALCULES. Ils restent lisibles meme quand le
    // document en impose d'autres : la page affiche alors les deux, et l'ecart
    // se voit au lieu de se subir.
    (res_air, res_die, obj! {"lambda" => res_lam, "largeur_cuivre" => largeur.map(Json::Flottant).unwrap_or(Json::Nul),
                             "plancher" => plancher, "bornee" => bornee,
                             "fond_min" => fond_min,
                             "air" => res_air, "die" => res_die})
}

/// Une suite de lignes de maillage regulieres, bornes comprises.
fn _lignes(debut: f64, fin: f64, pas: f64) -> Vec<f64> {
    if fin <= debut {
        return vec![debut];
    }
    let n = (((fin - debut) / pas).ceil() as i64).max(1);
    let h = (fin - debut) / n as f64;
    (0..=n).map(|i| debut + i as f64 * h).collect()
}

/// Rassemble en UNE coordonnee celles qui ne different que de `eps`.
///
/// LA GEOMETRIE N'EST PAS TOUCHEE, LA GRILLE SEULE L'EST. Ce qui part au
/// solveur reste le polygone exact ; ce qui est regroupe ici, ce sont les
/// lignes de maillage qu'on en deduit. Un bord a 32,810 et un bord a 32,800
/// donnent donc un seul jeu de lignes au lieu de deux jeux qui se touchent,
/// et le cuivre, lui, garde ses cotes au micron.
///
/// Une grappe est bornee a `eps` DEPUIS SON PREMIER ELEMENT et non de proche
/// en proche : sans cela une file de bords espaces d'un demi-eps se
/// ramasserait en un seul point, et le dernier aurait glisse de bien plus que
/// la tolerance qu'on s'est donnee.
///
/// Rend les coordonnees regroupees et le nombre de bords absorbes -- c'est ce
/// second nombre que l'assistant rapporte, parce qu'un regroupement silencieux
/// serait exactement le genre de correction qu'on decouvre trop tard.
fn _grouper(valeurs: &[f64], eps: f64) -> (Vec<f64>, usize) {
    let tri = ensemble_trie(valeurs.iter().map(|v| py::round(*v, 9)));
    if eps <= 0.0 || tri.is_empty() {
        return (tri, 0);
    }
    let mut grappes: Vec<Vec<f64>> = Vec::new();
    let mut courante = vec![tri[0]];
    for &v in &tri[1..] {
        if v - courante[0] > eps {
            grappes.push(std::mem::take(&mut courante));
        }
        courante.push(v);
    }
    grappes.push(courante);
    let absorbes = grappes.iter().map(|g| g.len() - 1).sum();
    (grappes.iter().map(|g| py::sum(g.iter().copied()) / g.len() as f64).collect(), absorbes)
}

/// Un seuil ou un pas : un nombre, ou une fonction de l'endroit -- le pas fin dans une bande,
/// le fond ailleurs, divise par `k`. Ce que le Python passait en nombre ou en fonction
/// (`_pas_local`, `_divise`, `_val`).
#[derive(Clone)]
pub(super) enum Pas<'a> {
    Fixe(f64),
    Local { bandes: &'a [P], fin: f64, die: f64, k: f64 },
}

impl Pas<'_> {
    /// La valeur d'un seuil a un endroit donne, qu'il soit nombre ou fonction.
    fn val(&self, v: f64) -> f64 {
        match self {
            Pas::Fixe(x) => *x,
            Pas::Local { bandes, fin, die, k } => (if _dans(bandes, v) { *fin } else { *die }) / k,
        }
    }

    /// `pas / k`, que `pas` soit un nombre ou une fonction de la position.
    fn divise(&self, k: f64) -> Self {
        match self {
            Pas::Fixe(x) => Pas::Fixe(x / k),
            Pas::Local { bandes, fin, die, .. } => Pas::Local { bandes, fin: *fin, die: *die, k },
        }
    }

    /// Le seuil d'une CELLULE, entre deux lignes : le plus serre des deux bouts.
    ///
    /// Sert au lissage, ou le seuil qualifie une cellule et non une ligne : une
    /// cellule a cheval sur le bord d'une bande a le droit d'etre fine comme la
    /// bande, sinon le lissage la redecouperait pour rattraper le fond.
    fn seuil(&self, v: f64, w: f64) -> f64 {
        mini(self.val(v), self.val(w))
    }
}

/// Trie, dedoublonne, et supprime les lignes trop proches.
///
/// DEUX LIGNES DE MAILLAGE A UN MICRON L'UNE DE L'AUTRE NE RAFFINENT RIEN :
/// elles fabriquent une cellule minuscule, et comme le pas de temps FDTD est
/// commande par la PLUS PETITE cellule de tout le domaine, cette cellule-la
/// ralentit la simulation entiere. C'est la panne la plus frequente d'un
/// maillage construit a partir de geometrie reelle, ou les coordonnees se
/// repetent a l'epsilon pres.
///
/// MAIS TOUTES LES LIGNES NE SE VALENT PAS, et les confondre etait un defaut
/// a part entiere : une interface de l'empilage, une face du port, ne sont
/// pas des lignes de remplissage. Les effacer parce qu'une ligne d'air passe
/// a cote deplace physiquement la geometrie -- un substrat de 1,6 mm dont la
/// face superieure a glisse de 0,3 mm n'est plus le meme substrat. Les
/// lignes OBLIGATOIRES sont donc posees d'abord et ne cedent jamais : ce sont
/// les lignes ordinaires qui s'ecartent pour elles.
///
/// LES SEUILS PEUVENT ETRE DES FONCTIONS DE L'ENDROIT, et non des nombres :
/// depuis qu'il y a deux pas dans le plan — le fond, et le pas fin d'une bande
/// en travers d'une piste —, un seuil unique calcule sur le fond effacerait
/// une par une les lignes de la bande. Voir `_pas_local`.
///
/// CHAQUE LIGNE EST JUGEE A SON SEUIL, CELUI DE L'ENDROIT OU ON LA POSE, et
/// non au plus serre des deux voisinages. La difference se paie comptant au
/// bord d'une bande : une ligne du FOND qui tombe a 0,05 mm d'une ligne de
/// bande doit ceder -- elle n'a rien a decrire la, et sa cellule de 0,05 mm
/// commanderait le pas de temps de tout le domaine --, tandis que la ligne de
/// BANDE, elle, reste a son propre seuil, trois fois plus serre. Juger les
/// deux au seuil le plus serre laissait passer la premiere : mesure sur vingt
/// pistes de 0,5 mm, la plus petite cellule tombait a 0,05 mm pour un pas fin
/// de 0,125, soit deux fois et demie le pas de temps qu'il fallait.
///
/// TROIS RANGS, ET LE TROISIEME EST CELUI QUI COUTAIT CHER. Entre la ligne
/// qu'on ne peut pas bouger et celle qui remplit, il y a celle de l'AFFINAGE
/// -- les deux lignes que la regle du tiers pose de part et d'autre d'une
/// arete de cuivre. Elle tombe ou l'arete tombe, c'est-a-dire n'importe ou
/// par rapport a la grille reguliere : rien n'empeche une ligne de
/// remplissage de se poser a quarante microns d'elle, et cette cellule-la
/// commande alors le pas de temps de tout le domaine. C'est ce qui est arrive
/// sur l'IFA du gabarit -- 0,0433 mm entre la ligne d'affinage 4,7067 et la
/// ligne de remplissage 4,7500, pour un pas vise de 0,25 mm. (Cotes de l'IFA
/// d'avant, quand le gabarit les tirait d'une note d'application ; la
/// collision, elle, ne tient pas a la cote qui l'a revelee.)
///
/// Le remede n'est PAS d'elargir le seuil pour tout le monde : fusionner deux
/// lignes d'affinage entre elles efface le raffinement des bords rayonnants,
/// et cela s'est mesure -- au tiers du pas, le creux de S11 du patch tombait
/// de -6,6 a -2,1 dB. C'est le REMPLISSAGE qui doit s'ecarter : la ou
/// l'affinage decrit deja le voisinage d'une arete, une ligne reguliere de
/// plus n'ajoute rien qu'une cellule mince. L'affinage garde donc le seuil
/// serre, le remplissage en recoit un plus large (`mini_affinage`), et ce
/// qu'on perd est exactement ce qui ne servait a rien.
fn _fusionner(lignes: &[f64], seuil: &Pas, obligatoires: &[f64], affinage: &[f64], seuil_autres: &Pas) -> Vec<f64> {
    let r9 = |t: &[f64]| ensemble_trie(t.iter().map(|v| py::round(*v, 9)));
    let cles = |t: &[f64]| -> std::collections::HashSet<u64> { t.iter().map(|v| (*v + 0.0).to_bits()).collect() };
    let obl = r9(obligatoires);
    let dans_obl = cles(&obl);
    let aff: Vec<f64> = r9(affinage).into_iter().filter(|v| !dans_obl.contains(&(*v + 0.0).to_bits())).collect();
    let dans_aff = cles(&aff);
    let autres: Vec<f64> = r9(lignes).into_iter()
        .filter(|v| !dans_obl.contains(&(*v + 0.0).to_bits()) && !dans_aff.contains(&(*v + 0.0).to_bits())).collect();

    let mut out: Vec<f64> = Vec::new();
    for v in obl {
        // Deux obligatoires trop proches l'une de l'autre restent toutes les
        // deux : elles decrivent la geometrie, et c'est a l'assistant de
        // signaler la cellule mince qui en resulte, pas a nous de la cacher.
        if out.last().is_none_or(|d| v - d > 1e-9) {
            out.push(v);
        }
    }

    for (file, seuil) in [(aff, seuil), (autres, seuil_autres)] {
        for v in file {
            let i = _place(&out, v);
            if i > 0 && v - out[i - 1] < seuil.val(v) {
                continue;
            }
            if i < out.len() && out[i] - v < seuil.val(v) {
                continue;
            }
            out.insert(i, v);
        }
    }
    out
}

/// Adoucit les marches du maillage : deux cellules voisines ne different
/// plus d'un facteur beaucoup superieur a `ratio`.
///
/// POURQUOI UNE MARCHE COUTE QUELQUE CHOSE. Une onde qui passe d'une cellule
/// de 0,5 mm a une cellule de 2 mm voit un changement brusque de la grille et
/// s'y REFLECHIT -- numeriquement, sans qu'aucun objet physique ne soit la.
/// Ce parasite revient au port, s'ajoute a l'onde reflechie par l'antenne, et
/// rien dans le resultat ne dit lequel des deux on lit. C'est la raison d'etre
/// de SmoothMeshLines chez openEMS, et de cette fonction ici.
///
/// ON N'AJOUTE QUE DES LIGNES, ON N'EN DEPLACE AUCUNE : les interfaces de
/// l'empilage, les faces du port et les aretes de cuivre restent exactement
/// ou `_fusionner` les a posees.
///
/// LA TAILLE ADMISSIBLE SE PROPAGE D'ABORD, LA SUBDIVISION VIENT APRES, et
/// cet ordre est tout le sujet. Une premiere version coupait chaque grande
/// cellule des qu'une voisine etait plus fine ; la meme cellule se faisait
/// alors decouper deux fois, une fois par chaque bord, et les deux series de
/// coupes s'entremelaient en copeaux. Le maillage d'essai passait de cent
/// mille a vingt-sept millions de cellules. On calcule donc D'ABORD, pour
/// chaque cellule, la taille que ses voisines lui autorisent -- une passe
/// vers la droite, une vers la gauche --, PUIS on coupe chacune une seule
/// fois, en parts egales.
///
/// `plancher` empeche une cellule mince isolee -- deux aretes de cuivre
/// presque confondues, l'epaisseur d'un conducteur -- d'imposer sa finesse a
/// tout le domaine de proche en proche. Elle reste mince ; elle ne contamine
/// pas. Il peut etre une FONCTION DE L'ENDROIT : dans une bande fine, le
/// plancher est le pas fin, sinon le lissage subdiviserait la bande jusqu'a
/// rattraper le fond de proche en proche.
fn _lisser(lignes: Vec<f64>, plancher: &Pas) -> Vec<f64> {
    let ratio = GRADIENT_MAX;
    let mut out = lignes;
    out.sort_by(croissant);
    if out.len() < 3 || ratio <= 1.0 {
        return out;
    }
    let n = out.len() - 1;
    let pas: Vec<f64> = (0..n).map(|i| out[i + 1] - out[i]).collect();
    let mut lim: Vec<f64> = (0..n).map(|i| maxi(pas[i], plancher.seuil(out[i], out[i + 1]))).collect();
    for i in 1..n {
        lim[i] = mini(lim[i], lim[i - 1] * ratio);
    }
    for i in (0..n - 1).rev() {
        lim[i] = mini(lim[i], lim[i + 1] * ratio);
    }

    let mut coupe = vec![out[0]];
    for i in 0..n {
        let k = if lim[i] > 0.0 { (pas[i] / lim[i] - 1e-9).ceil() as i64 } else { 1 };
        let k = k.clamp(1, 64);
        for j in 1..k {
            coupe.push(py::round(out[i] + pas[i] * j as f64 / k as f64, 9));
        }
        coupe.push(out[i + 1]);
    }
    coupe
}

/// Index d'insertion de v dans une liste triee (bissection).
pub(super) fn _place(triee: &[f64], v: f64) -> usize {
    let (mut lo, mut hi) = (0, triee.len());
    while lo < hi {
        let mi = (lo + hi) / 2;
        if triee[mi] < v {
            lo = mi + 1;
        } else {
            hi = mi;
        }
    }
    lo
}

/// Le pas VISE en un point de l'axe : le fond, ou le pas fin d'une bande.
///
/// TOUS LES SEUILS DE `_fusionner` ET DE `_lisser` EN DECOULENT, et c'est la
/// seule facon de faire tenir deux pas sur un meme axe. Les seuils sont des
/// fractions du pas vise -- le quart pour l'affinage, le tiers pour le
/// remplissage --, et calcules sur le pas de FOND ils effacent toute ligne
/// posee a moins de 0,2 mm d'une autre : les lignes d'une bande a 0,13 mm y
/// passeraient une par une, et le raffinement n'aurait jamais lieu.
///
/// REND UN NOMBRE QUAND IL N'Y A PAS DE BANDE. Le chemin sans affinage local
/// reste alors exactement celui d'avant, aux memes valeurs mesurees -- il n'y
/// a pas deux codes a eprouver.
fn _pas_local(bandes: &[P], res_die: f64, res_fin: f64) -> Pas<'_> {
    if bandes.is_empty() || res_fin <= 0.0 || res_fin >= res_die {
        return Pas::Fixe(res_die);
    }
    Pas::Local { bandes, fin: res_fin, die: res_die, k: 1.0 }
}

/// Ce point tombe-t-il dans une bande fine ?
fn _dans(bandes: &[P], v: f64) -> bool {
    bandes.iter().any(|(a, b)| *a <= v && v <= *b)
}

/// Bandes triees, celles qui se chevauchent reunies en une seule.
fn _souder(mut bandes: Vec<P>) -> Vec<P> {
    bandes.sort_by(|p, q| p.partial_cmp(q).unwrap_or(std::cmp::Ordering::Equal));
    let mut out: Vec<P> = Vec::new();
    for (a, b) in bandes {
        match out.last_mut() {
            Some(d) if a <= d.1 => d.1 = maxi(d.1, b),
            _ => out.push((a, b)),
        }
    }
    out
}

/// Les bandes fines, axe par axe.
pub(super) struct Bandes {
    pub x: Vec<P>,
    pub y: Vec<P>,
}

/// Les intervalles, axe par axe, ou le cuivre est trop etroit pour le pas
/// de fond -- et SEULEMENT sur l'axe ou il est etroit.
///
/// C'EST TOUT CE QUI REND LE RAFFINEMENT PAYABLE. Une piste longue de 20 mm
/// et large de 0,5 ne demande le pas fin que sur un demi-millimetre : le champ
/// tourne EN TRAVERS du ruban, pas le long. C'est la largeur qui fixe
/// l'impedance ; la longueur se contente du pas de fond. Raffiner les deux
/// axes couterait quarante fois plus de lignes pour la meme physique, et
/// raffiner toute l'emprise -- ce que faisait le pas unique -- en couterait
/// mille : c'est la, et pas ailleurs, que le budget de LIGNES_MAX_EMPRISE
/// mordait et que l'outil renoncait.
///
/// UN POLYGONE ETROIT DANS LES DEUX AXES -- une pastille, un bout de piste --
/// donne deux bandes. C'est correct et c'est rarement ce qu'on veut payer : le
/// budget s'en charge, et une bande plus mince que le pas fin retenu est
/// abandonnee (voir `_maillage`).
fn _bandes_fines(cuivre: &[Bloc], seuil: f64) -> Bandes {
    let (mut bx, mut by) = (Vec::new(), Vec::new());
    for poly in cuivre.iter().flat_map(|b| &b.polys) {
        let Some([x0, x1, y0, y1]) = etendue(poly) else { continue };
        if 1e-9 < x1 - x0 && x1 - x0 < seuil {
            bx.push((x0, x1));
        }
        if 1e-9 < y1 - y0 && y1 - y0 < seuil {
            by.push((y0, y1));
        }
    }
    Bandes { x: _souder(bx), y: _souder(by) }
}

/// Combien de lignes les bandes poseraient a ce pas, sans les poser.
fn _lignes_bandes(bandes: &[P], pas: f64) -> f64 {
    py::sum(bandes.iter().map(|(a, b)| (b - a) / pas + 1.0 + (2 * MARGE_BANDE) as f64))
}

/// Les lignes d'une bande fine : le cuivre en parts egales, et MARGE_BANDE
/// cellules de plus de chaque cote.
///
/// LES LIGNES TOMBENT SUR LES DEUX BORDS DU RUBAN, et c'est voulu. Le ruban a
/// donc un nombre ENTIER de cellules en travers, ses bords sur la grille, et
/// sa largeur est exactement celle qu'on a dessinee. Un bord de conducteur
/// parfait pose SUR une ligne est le cas normal des qu'il est resolu ; la
/// regle du tiers ne sert qu'a corriger la densite de courant d'un bord que la
/// grille ne resout PAS -- c'est exactement la condition qu'openEMS se donne
/// lui aussi dans `mesh_hint_from_box` : au-dela de `metal_edge_res` il
/// decale, en deca il pose les lignes sur les aretes.
fn _bande_lignes(a: f64, b: f64, pas: f64) -> Vec<f64> {
    let mut out = _lignes(a, b, pas);
    let h = (b - a) / (out.len() - 1).max(1) as f64;
    for i in 1..=MARGE_BANDE {
        out.push(a - i as f64 * h);
        out.push(b + i as f64 * h);
    }
    out
}

/// Les trois listes de lignes de maillage.
///
/// Le principe : un fond regulier a la resolution de l'air sur toute la
/// boite, remplace par la resolution du dielectrique dans l'emprise de la
/// carte, plus une ligne posee sur chaque cote de cuivre en z, plus -- si la
/// regle du tiers est demandee -- un raffinement aux aretes du cuivre dans le
/// plan, plus des BANDES FINES en travers du cuivre trop etroit pour le fond.
///
/// CE QUI PART AU SOLVEUR, C'EST CETTE GRILLE-LA, ET RIEN D'AUTRE. Le
/// commentaire d'avant disait « openEMS ajoute lui-meme les aretes par
/// AddEdges2Grid » ; c'etait faux, et c'etait l'idee fausse la plus couteuse
/// de ce module. `AddEdges2Grid` demande a chaque primitive un « hint », et
/// `mesh_hint_from_primitive` (openEMS/automesh.py) n'en rend QUE pour un
/// point ou une boite : pour un polygone elle rend None, sans un mot. Or tout
/// le cuivre part en AddPolygon et en AddLinPoly. L'appel etait donc SANS
/// EFFET -- verifie sur CSXCAD 0.6.3 et openEMS 0.0.36, grille identique avant
/// et apres --, et le script ne l'emet plus. La bonne nouvelle est que le
/// nombre de cellules et le pas de temps annonces ici sont ceux que le solveur
/// calculera vraiment ; la mauvaise, qu'aucune arete n'etait raffinee par
/// personne d'autre que ce module.
///
/// DEUX PAS DANS LE PLAN, ET NON UN SEUL. `res_die` est le FOND : lambda/20
/// dans le dielectrique, borne par le budget de lignes de l'emprise (voir
/// LIGNES_MAX_EMPRISE). Sur une carte de 120 mm ce fond tombe a 0,6 mm, et une
/// piste de 0,5 mm n'a plus une cellule en travers : son impedance n'est plus
/// la sienne, sa resonance sort trop haut, et l'outil n'avait rien d'autre a
/// proposer que « retirez ce cuivre de la selection ». `res_fin` est le pas
/// des BANDES : il ne s'applique qu'en travers du cuivre etroit, sur le seul
/// axe ou ce cuivre est etroit. Voir `_bandes_fines` pour l'axe, et `_mailler`
/// pour le budget qui borne le tout.
#[allow(clippy::too_many_arguments)]
fn _maillage(modele: &mut Json, cuivre: &[Bloc], pieces: &[Piece], res_air: f64, res_die: f64, res_fin: f64,
             bandes: Option<&Bandes>) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
    let boite = &modele["boite"];
    let em = reels(&modele["emprise"]);
    let z_haut = f(&modele["z_haut"]);

    // UNE BANDE PLUS MINCE QUE LE PAS FIN N'EST PAS UNE BANDE : elle poserait
    // une cellule de sa largeur, laquelle commanderait le pas de temps de tout
    // le domaine pour un cuivre qu'elle ne resout meme pas. Ces polygones-la
    // restent a la regle du tiers, et l'avis dit qu'ils ne sont pas resolus.
    let mut fin = if 0.0 < res_fin && res_fin < res_die { res_fin } else { 0.0 };
    let garder = |t: Option<&Vec<P>>| -> Vec<P> {
        if fin != 0.0 { t.map(|t| t.iter().filter(|(a, b)| b - a >= fin).copied().collect()).unwrap_or_default() } else { Vec::new() }
    };
    let bx = garder(bandes.map(|b| &b.x));
    let by = garder(bandes.map(|b| &b.y));
    if bx.is_empty() && by.is_empty() {
        fin = 0.0;
    }
    // LA ZONE FINE COMPREND LES MARGES, et l'oublier coutait les marges
    // elles-memes : posees HORS de [a, b], elles etaient jugees au seuil du
    // fond -- le tiers de 0,35 mm contre un pas fin de 0,125 -- et sautaient
    // une fois sur deux, selon la carte. Ce sont des lignes de la bande ; elles
    // sont jugees comme telles.
    let marge = MARGE_BANDE as f64 * fin;
    let large_x = _souder(bx.iter().map(|(a, b)| (a - marge, b + marge)).collect());
    let large_y = _souder(by.iter().map(|(a, b)| (a - marge, b + marge)).collect());
    let pas_x = _pas_local(&large_x, res_die, fin);
    let pas_y = _pas_local(&large_y, res_die, fin);

    // -- x et y : fond d'air, structure plus fine ----------------------------
    // « Structure » et non « carte » : un boitier ou un fil ajoute a la main
    // rayonne autant que le cuivre, et un maillage d'air autour de lui ne le
    // represente pas. C'est aussi pourquoi un gros objet fait exploser le
    // nombre de cellules — le bilan le montre plutot que de le cacher.
    // Trois zones par axe : l'air, le pas « exterieur » des pieces et de la
    // carte au-dela du cuivre, et le pas fin du cuivre. Voir `emprise_fin`
    // dans `normaliser`.
    let fe = if modele["emprise_fin"].vrai() { reels(&modele["emprise_fin"]) } else { em.clone() };
    let rx = maxi(res_die, ou(f(&modele["resolution"]["ext"]), res_die));

    let axe = |a: usize, b1: f64, b2: f64| -> Vec<f64> {
        [_lignes(b1, em[a], res_air), _lignes(em[a], fe[a], rx), _lignes(fe[a], fe[a + 3], res_die),
         _lignes(fe[a + 3], em[a + 3], rx), _lignes(em[a + 3], b2, res_air)].concat()
    };
    let mut x = axe(0, f(&boite["x1"]), f(&boite["x2"]));
    let mut y = axe(1, f(&boite["y1"]), f(&boite["y2"]));

    // -- les bandes fines, en travers du cuivre etroit -----------------------
    // LE FOND NE PASSE PAS SOUS UNE BANDE : elle l'y remplace, plus fin. Une
    // ligne du fond tombee dans une bande n'y decrit rien de plus -- la bande
    // a deja quatre lignes la ou le fond en avait une -- et elle y laisse une
    // cellule de quelques centiemes de millimetre, laquelle commande le pas de
    // temps de TOUT le domaine. Mesure sur vingt pistes de 0,5 mm : une ligne
    // du fond a 0,05 mm d'une ligne de marge, et le pas de temps divise par
    // deux et demi pour rien. Aucun filtrage ne saurait les distinguer apres
    // coup -- une ligne ne dit pas d'ou elle vient --, on ne les pose donc pas.
    if !large_x.is_empty() {
        x.retain(|v| !_dans(&large_x, *v));
    }
    if !large_y.is_empty() {
        y.retain(|v| !_dans(&large_y, *v));
    }
    // ET ELLES SONT DE L'AFFINAGE, PAS DU REMPLISSAGE, ce qui decide de l'ORDRE
    // dans lequel `_fusionner` les pose -- et l'ordre decide de qui cede a qui.
    // Rangees dans le remplissage, elles arrivaient dans la meme file que les
    // lignes du fond, triees par position : une ligne du fond posee juste avant
    // une ligne de marge etait jugee la premiere, donc gardee, et la marge
    // ensuite -- au seuil FIN, trois fois plus tolerant -- s'installait a 0,05
    // mm d'elle. Mesure sur vingt pistes de 0,5 mm : cellule de 0,05 mm pour un
    // pas fin de 0,125, et le pas de temps de tout le domaine avec elle. Posees
    // d'abord, ce sont les lignes du fond qui s'ecartent -- ce qu'elles doivent
    // faire, puisqu'il n'y a rien a decrire la ou la bande decrit deja.
    let (mut x_aff, mut y_aff) = (Vec::new(), Vec::new());
    for (a, b) in &bx {
        x_aff.extend(_bande_lignes(*a, *b, fin));
    }
    for (a, b) in &by {
        y_aff.extend(_bande_lignes(*a, *b, fin));
    }

    // -- z : chaque interface de l'empilage porte une ligne ------------------
    // Elles sont OBLIGATOIRES : une interface de substrat qui glisse parce
    // qu'une ligne d'air passait a cote, c'est un autre substrat.
    let mut z_obl = vec![0.0, z_haut];
    let mut z = Vec::new();
    for c in liste(&modele["conducteurs"]).iter().chain(liste(&modele["dielectriques"])) {
        z_obl.push(f(&c["z0"]));
        z_obl.push(f(&c["z1"]));
    }
    z.extend(_lignes(f(&boite["z1"]), em[2], res_air));
    z.extend(_lignes(em[2], fe[2], rx));
    z.extend(_lignes(fe[2], 0.0, res_die));
    z.extend(_lignes(z_haut, fe[5], res_die));
    z.extend(_lignes(fe[5], em[5], rx));
    z.extend(_lignes(em[5], f(&boite["z2"]), res_air));

    // -- les aretes du port, qui doivent tomber sur des lignes ---------------
    // Elles aussi sont obligatoires : un port dont une face a glisse sur la
    // ligne voisine n'excite plus le meme volume, et c'est le S11 entier qui
    // s'en ressent.
    let (mut x_obl, mut y_obl) = (Vec::new(), Vec::new());
    for p in liste(&modele["ports"]) {
        x_obl.extend([f(&p["x1"]), f(&p["x2"])]);
        y_obl.extend([f(&p["y1"]), f(&p["y2"])]);
        z_obl.extend([f(&p["z1"]), f(&p["z2"])]);
        let q = if p["msl"].vrai() { &p["msl"] } else { &p["msl_maillage"] };
        if q.vrai() {
            // LE PORT MICRORUBAN A BESOIN DE LIGNES LE LONG DU RUBAN : ses
            // trois sondes de tension tombent sur trois lignes voisines au
            // milieu du port. Ses extremites et les bords du ruban sont
            // obligatoires ; huit pas au moins le long du ruban.
            let en_x = txt(&q["axe"]) == "x";
            let (debut, fin_q) = (f(&q["debut"]), f(&q["fin"]));
            let (le_long, en_travers) = if en_x { (&mut x_obl, &mut y_obl) } else { (&mut y_obl, &mut x_obl) };
            le_long.extend([debut, fin_q]);
            en_travers.extend([f(&q["t1"]), f(&q["t2"])]);
            z_obl.extend([f(&q["z_ruban"]), f(&q["z_masse"])]);
            // De l'AFFINAGE, comme les bandes fines : rangees dans le
            // remplissage, le fond les ecarterait.
            // « grossier » : quatre pas, le minimum de cinq lignes du port.
            let pas = (fin_q - debut).abs() / if q["grossier"].vrai() { 4.0 } else { 8.0 };
            let affiner = if en_x { &mut x_aff } else { &mut y_aff };
            affiner.extend(_lignes(mini(debut, fin_q), maxi(debut, fin_q), pas));
        }
        let c = &p["coax"];
        if !c.vrai() {
            continue;
        }
        // LE COAXIAL EST UNE GEOMETRIE RONDE DANS UNE GRILLE CARREE, et c'est
        // la seule facon de la rater : si aucune ligne ne tombe sur le rayon
        // de l'ame, le cylindre est rendu par les cellules qui l'approchent --
        // une ame de 0,635 mm dans une maille de 1 mm devient un carre de
        // 1 mm, ou disparait. On pose donc une ligne sur CHAQUE rayon, des
        // deux cotes de l'axe, plus trois lignes dans la couronne isolante :
        // c'est elle qui porte le champ du mode TEM.
        let (px, py_, ra, rb) = (f(&p["x"]), f(&p["y"]), f(&c["ra"]), f(&c["rb"]));
        for r in [ra, f(&c["rm"]), rb, rb + f(&c["ep_gaine"])] {
            x_obl.extend([px - r, px + r]);
            y_obl.extend([py_ - r, py_ + r]);
        }
        x_obl.push(px);
        y_obl.push(py_);
        let pas = (rb - ra) / 3.0;
        for i in [1.0, 2.0] {
            x.extend([px - ra - i * pas, px + ra + i * pas]);
            y.extend([py_ - ra - i * pas, py_ + ra + i * pas]);
        }
        // Le fond du connecteur, le plan de la source et la sortie de carte :
        // trois cotes en z qu'un glissement d'une demi-cellule fausserait,
        // puisque c'est la longueur du troncon qui transforme l'impedance.
        let (z_bas, z_gaine) = (f(&c["z_bas"]), f(&c["z_gaine"]));
        z_obl.extend([z_bas, f(&c["z_mes"]), z_gaine, f(&c["z_ame"])]);
        z.extend(_lignes(mini(z_bas, z_gaine), maxi(z_bas, z_gaine), res_die));
    }

    // -- les aretes des objets hors carte ------------------------------------
    // Obligatoires pour la meme raison : une face de boitier qui glisse d'une
    // demi-cellule, c'est un boitier d'une autre taille. APRES le port, parce
    // que c'est lui qui cree x_obl et y_obl.
    for o in liste(&modele["primitives"]) {
        let e = _emprise_primitive(o);
        x_obl.extend([e[0], e[3]]);
        y_obl.extend([e[1], e[4]]);
        z_obl.extend([e[2], e[5]]);
    }

    // -- les faces des pieces importees --------------------------------------
    // DE L'AFFINAGE, ET NON DES LIGNES OBLIGATOIRES, a la difference des
    // primitives juste au-dessus. Une primitive a six faces ; une piece
    // importee en a des dizaines, et deux d'entre elles a un dixieme de
    // millimetre -- un epaulement, une nervure -- poseraient, obligatoires,
    // une cellule-copeau qui commanderait le pas de temps de tout le domaine.
    // Rangees dans l'affinage, elles cedent au quart du pas vise : une paroi
    // plus epaisse que cela garde ses deux faces, donc au moins une cellule
    // entiere a son epaisseur exacte -- c'est ce qu'il fallait. Voir
    // openems_pieces._plans pour le choix des faces.
    let carte = &modele["carte"];
    if carte.vrai() {
        x_aff.extend(reels(&carte["lignes_x"]));
        y_aff.extend(reels(&carte["lignes_y"]));
    }
    let mut z_pieces = Vec::new();
    for i in pieces::corps_inclus(pieces).filter_map(|(_, c)| c.inclus.as_ref()) {
        let (e, pl) = (&i.emprise, &i.plans);
        x_aff.extend([e[0], e[3]].iter().chain(&pl[0]));
        y_aff.extend([e[1], e[4]].iter().chain(&pl[1]));
        z_pieces.extend([e[2], e[5]].iter().chain(&pl[2]));
    }

    // -- la regle du tiers aux aretes de cuivre ------------------------------
    // On ne la pose que sur les aretes qui bornent l'emprise du cuivre : poser
    // trois lignes sur chacun des sommets d'un plan de masse decoupe ferait
    // exploser le maillage.
    let mut aretes_groupees = 0;
    let mut eps_aretes = 0.0;
    // Les lignes de l'affinage tiennent leur propre liste : ce ne sont ni des
    // lignes qu'on ne peut pas bouger, ni du remplissage. Voir `_fusionner`.
    // Les bandes fines y sont deja.
    if modele["maillage_tiers"].vrai() {
        let d = res_die / 3.0;
        // LA TOLERANCE EST LA PLUS SERREE DES TROIS, ET CHACUNE DIT NON A UNE
        // FAUTE DIFFERENTE : le vingtieme du cuivre le plus etroit interdit de
        // confondre deux rubans voisins, le huitieme du pas vise interdit
        // d'effacer un raffinement que le maillage aurait vraiment demande, et
        // les cinquante microns interdisent de depasser ce qu'un fabricant
        // tient. Sur un dessin en ondes millimetriques, c'est la premiere qui
        // gagne et la tolerance descend avec le cuivre.
        let largeur = f(&modele["resolution"]["detail"]["largeur_cuivre"]);
        eps_aretes = mini(res_die / 8.0, EPS_ARETES_MM);
        if largeur > 0.0 {
            eps_aretes = mini(eps_aretes, largeur / 20.0);
        }
        let (mut ax, mut ay) = (Vec::new(), Vec::new());
        for poly in cuivre.iter().flat_map(|b| &b.polys) {
            let [x0, y0, x1, y1] = _boite_pts(&poly.o);
            ax.extend([x0, x1]);
            ay.extend([y0, y1]);
        }
        let (ax, n_ax) = _grouper(&ax, eps_aretes);
        let (ay, n_ay) = _grouper(&ay, eps_aretes);
        aretes_groupees = n_ax + n_ay;
        // PAS DE REGLE DU TIERS DANS UNE BANDE FINE, et ce n'est pas une
        // economie de lignes : la bande resout deja le ruban en plusieurs
        // cellules et son arete tombe sur une ligne. La paire du tiers n'y
        // decrirait rien de plus et poserait une cellule au tiers du pas FIN --
        // laquelle commanderait le pas de temps de tout le domaine. Ce serait
        // payer le raffinement une deuxieme fois, et sur tout le calcul.
        for v in ax {
            if !_dans(&bx, v) {
                x_aff.extend([v - d, v + 2.0 * d]);
            }
        }
        for v in ay {
            if !_dans(&by, v) {
                y_aff.extend([v - d, v + 2.0 * d]);
            }
        }
    }
    let mut detail = obj! {"eps_aretes" => eps_aretes,
                           "aretes_groupees" => aretes_groupees,
                           "bandes_x" => bx.len(), "bandes_y" => by.len()};

    // Deux lignes plus proches que cela ne raffinent rien : elles coutent un
    // pas de temps, et LE PAS DE TEMPS EST COMMANDE PAR LA PLUS PETITE CELLULE
    // DE TOUT LE DOMAINE. Une seule cellule-copeau ralentit donc la simulation
    // entiere, sans rien decrire de plus.
    //
    // LE HUITIEME DU PAS VISE, ET PAS DAVANTAGE — ESSAYE, ET REGRETTE. Le
    // huitieme laisse subsister des cellules de 0,10 mm la ou le pas vise est
    // de 0,78, ce qui divise le pas de temps par 2,7 : la tentation de le
    // porter au tiers pour aller trois fois plus vite est forte. Elle coute le
    // resultat. Ces cellules-la ne sont pas du gaspillage : ce sont les lignes
    // que la regle du tiers pose de part et d'autre des aretes de cuivre, et
    // deux aretes voisines en produisent naturellement de tres rapprochees.
    // Les fusionner efface le raffinement des bords rayonnants. Mesure faite
    // sur le patch de l'exemple : au tiers, le creux de S11 tombe de -6,6 a
    // -2,1 dB et la resistance de resonance de 118 a 11 ohms. Le huitieme
    // laisse de la place a la regle du tiers sans laisser passer les
    // coordonnees presque confondues d'un fichier de CAO ; c'est tout ce qu'on
    // lui demande.
    // LE SEUIL DE L'AFFINAGE CONTRE LUI-MEME. Deux aretes de cuivre plus
    // proches que le pas vise demandent chacune leurs deux lignes, et ces
    // lignes-la se croisent : sur l'IFA, le bord du plan de masse (25,000) et
    // le bout du patin de court-circuit (24,700) — 0,3 mm d'ecart, deux aretes
    // bien reelles — posent 24,9167 et 24,8667, soit une cellule de 50 microns.
    // (Cotes de l'IFA d'avant : le gabarit pose aujourd'hui sa masse ailleurs,
    // mais la paire d'aretes rapprochees, elle, revient a chaque motif.)
    // La grille ne PEUT PAS mettre les deux aretes au tiers de leur cellule
    // sans descendre sous le pas vise ; insister rend une cellule mince qui
    // commande le pas de temps de toute la simulation. Le quart du pas est la
    // borne : la paire voulue autour d'UNE arete est espacee de 3d, c'est-a-
    // dire du pas vise entier, soit quatre fois ce seuil — elle ne peut donc
    // jamais se refermer sur elle-meme.
    //
    // ET DESORMAIS CES SEUILS SONT LOCAUX : dans une bande fine, c'est le pas
    // FIN qu'il faut diviser par quatre et par trois, sans quoi le seuil du
    // fond effacerait les lignes de la bande une par une. Voir `_pas_local`.
    let (mini_x, mini_y) = (pas_x.divise(4.0), pas_y.divise(4.0));
    // CE QU'UNE LIGNE DE REMPLISSAGE DOIT LAISSER A UNE LIGNE D'AFFINAGE :
    // exactement le decalage de la regle du tiers, `d = res_die / 3`. En deca,
    // la ligne reguliere tombe DANS le motif que la regle vient de dessiner
    // autour d'une arete : elle n'y decrit rien de plus et n'y laisse qu'une
    // cellule mince, qui commande alors le pas de temps de tout le domaine.
    //
    // LES QUATRE VALEURS ONT ETE MESUREES, sur l'IFA du gabarit (le maillage a
    // eprouver, dans les cotes qu'il avait alors) et sur le patch sonde du banc
    // (l'ajustement de Debye, qui se degrade des que le pas de temps grandit --
    // openEMS refuse tout pole plus rapide que trois pas de temps) :
    //
    //   seuil      IFA : cellules / dt        patch du banc : poles, ecart tan(d)
    //   res_die/2  2 784 804 / 0,235 ps       7 poles, 1,42 %
    //   res_die/3  2 921 314 / 0,235 ps       8 poles, 0,64 %      <- retenu
    //   res_die/4  3 090 528 / 0,163 ps       8 poles, 0,53 %
    //   res_die/6  3 247 405 / 0,108 ps       8 poles, 0,29 %
    //
    // Le tiers prend tout le gain de pas de temps (0,108 -> 0,235 ps, deux fois
    // moins de pas a calculer) pour cinq pour cent de cellules de plus que le
    // demi, et il laisse au modele de pertes ses huit poles. Descendre plus bas
    // ne rend rien : a res_die/6 on est revenu au point de depart.
    let (remp_x, remp_y) = (pas_x.divise(3.0), pas_y.divise(3.0));
    // LE LISSAGE EN DERNIER, ET APRES LA FUSION : il raisonne sur les cellules
    // telles qu'elles seront, et une ligne supprimee apres coup rouvrirait la
    // marche qu'il vient de combler.
    // LE PLANCHER DU LISSAGE EST LE PAS VISE LUI-MEME, et ce choix vaut un
    // facteur deux sur le calcul. Une cellule plus fine que le pas vise est un
    // ACCIDENT LOCAL — deux aretes de cuivre voisines, l'epaisseur d'un
    // conducteur — et non une consigne de finesse : la laisser propager sa
    // taille de proche en proche ferait remonter tout le voisinage avec elle.
    // Mesure faite sur l'exemple : plancher au quart du pas, le lissage coute
    // 2,7 fois le maillage ; plancher au pas, il en coute 1,45 — et il comble
    // les memes marches, celles qui separent la carte de l'air.
    let mx = _lisser(_fusionner(&x, &mini_x, &x_obl, &x_aff, &remp_x), &pas_x);
    let my = _lisser(_fusionner(&y, &mini_y, &y_obl, &y_aff, &remp_y), &pas_y);

    // -- z : les cellules du substrat, apres le plan et a cause de lui -------
    // AU MOINS TROIS CELLULES DANS UN SUBSTRAT, ET CETTE FOIS ELLES SURVIVENT.
    // Une seule ne represente pas le champ qui se courbe sous une piste -- or
    // c'est ce champ-la qui fait l'impedance de la ligne. L'intention etait
    // ecrite ici depuis toujours et n'avait jamais eu lieu : ces lignes etaient
    // rangees dans le REMPLISSAGE, et sur une grande carte le pas de fond
    // (0,6 mm) est plus epais que le substrat lui-meme (0,37 mm), si bien que
    // le seuil du tiers les effacait toutes les trois. Elles sont donc de
    // l'AFFINAGE -- une finesse demandee, pas un remplissage.
    //
    // LE PLANCHER EN Z EST LA MOITIE DE LA PLUS PETITE CELLULE DU PLAN, et ce
    // n'est pas un chiffre en l'air : le pas de temps suit
    // 1/racine(1/dx^2 + 1/dy^2 + 1/dz^2), donc une cellule en z deux fois plus
    // fine que la plus fine du plan pese quatre contre deux -- un facteur 1,4
    // au plus sur le pas de temps, pour les trois cellules qui decrivent le
    // champ sous le ruban. En dessous de ce plancher, c'est le z qui
    // commanderait le pas de temps de tout le domaine : c'est exactement ce que
    // faisait le vernis de 15 microns.
    let plan = mini(_plus_petit(&mx), _plus_petit(&my));
    let plancher_z = if plan > 0.0 { plan / 2.0 } else { 0.0 };
    let mut z_aff = Vec::new();
    for d in liste(&modele["dielectriques"]) {
        let (ep, z0) = (f(&d["ep"]), f(&d["z0"]));
        let mut n = ((ep / res_die).ceil() as i64).max(1);
        if plancher_z > 0.0 {
            n = n.max(CELLULES_PAR_SUBSTRAT.min((ep / plancher_z) as i64));
        }
        for i in 1..n {
            z_aff.push(z0 + ep * i as f64 / n as f64);
        }
    }
    let mini_z = if plancher_z > 0.0 { plancher_z } else { res_die / 4.0 };
    // Les faces des pieces en z, au seuil du plan et non au plancher du
    // substrat : ce dernier descend a la moitie de la plus petite cellule du
    // plan pour les trois cellules qu'il faut SOUS UNE PISTE, et une paroi de
    // boitier n'a pas a payer ce prix-la.
    // Et entre elles aussi : deux faces de piece plus proches que ce seuil
    // n'en gardent qu'une, la premiere venue dans l'ordre des cotes.
    let mini_z_pieces = maxi(mini_z, res_die / 4.0);
    let mut deja: Vec<f64> = z_obl.iter().chain(&z_aff).copied().collect();
    deja.sort_by(croissant);
    for v in ensemble_trie(z_pieces.iter().map(|v| py::round(*v, 9))) {
        let i = _place(&deja, v);
        if i > 0 && v - deja[i - 1] < mini_z_pieces {
            continue;
        }
        if i < deja.len() && deja[i] - v < mini_z_pieces {
            continue;
        }
        deja.insert(i, v);
        z_aff.push(v);
    }
    let mz = _lisser(_fusionner(&z, &Pas::Fixe(mini_z), &z_obl, &z_aff, &Pas::Fixe(res_die / 3.0)), &Pas::Fixe(res_die));
    // CE QUI SERRE LA GRILLE, AXE PAR AXE. Ecrit ici et nulle part ailleurs :
    // c'est le seul endroit ou les trois listes -- obligatoires, affinage,
    // remplissage -- existent encore separement. Une fois `mx` rendu, une
    // ligne ne dit plus d'ou elle vient.
    // LE PLANCHER DE CHAQUE AXE, c'est-a-dire la finesse SOUHAITEE -- celle
    // sous laquelle `_fusionner` ne laisse passer aucune ligne ordinaire.
    // C'est a lui, et non au pas vise, que se compare la plus petite cellule
    // quand on veut savoir si elle est un accident ou le travail de la grille.
    poser(&mut detail, "plancher", obj! {
        "x" => (if res_fin > 0.0 { res_fin } else { res_die }) / 4.0,
        "y" => (if res_fin > 0.0 { res_fin } else { res_die }) / 4.0,
        "z" => plancher_z,
    });
    poser(&mut detail, "pincee", obj! {
        "x" => _pincee(&mx, &x_obl, &x_aff),
        "y" => _pincee(&my, &y_obl, &y_aff),
        "z" => _pincee(&mz, &z_obl, &z_aff),
    });
    poser(modele, "maillage_detail", detail);
    (mx, my, mz)
}

/// La plus petite cellule d'une liste de lignes.
fn _plus_petit(lignes: &[f64]) -> f64 {
    lignes.windows(2).map(|w| w[1] - w[0]).reduce(mini).unwrap_or(0.0)
}

/// min(range(len(t) - 1), key=lambda k: t[k + 1] - t[k]) : la premiere des plus petites cellules.
pub(super) fn plus_petite_cellule(t: &[f64]) -> usize {
    let mut k = 0;
    for i in 1..t.len().saturating_sub(1) {
        if t[i + 1] - t[i] < t[k + 1] - t[k] {
            k = i;
        }
    }
    k
}

/// La plus petite cellule d'un axe, et CE QUI POSE SES DEUX BORDS.
///
/// POURQUOI CE N'EST PAS UN DETAIL DE PLUS. Le pas de temps est commande par
/// la plus petite cellule du domaine, et le nombre de pas suit le pas de
/// temps : une cellule deux fois trop fine coute DEUX FOIS sur la facture,
/// en cellules et en pas. C'est donc le premier chiffre a regarder quand un
/// calcul dure plus longtemps qu'annonce -- et jusqu'ici, dans le plan,
/// l'outil ne savait pas le dire. `_coupable_cellule` nommait la couche
/// fautive en z et rendait, en x et en y, une phrase qui commencait par
/// « cause probable » : elle renvoyait aux aretes de cuivre alors qu'une
/// face de port ou une primitive posee a la main font exactement la meme
/// cellule, et ne se corrigent pas du tout de la meme facon.
///
/// LES TROIS RANGS SONT CEUX DE `_fusionner`, et ils disent chacun un geste
/// different : « obligatoire » se corrige sur l'objet (elargir un port,
/// retirer une primitive), « affinage » sur la selection de cuivre,
/// « remplissage » sur le pas vise. Une ligne posee apres coup par `_lisser`
/// n'est dans aucune des deux listes : elle est du remplissage, et c'est
/// exactement ce qu'elle est.
fn _pincee(lignes: &[f64], obligatoires: &[f64], affinage: &[f64]) -> Json {
    if lignes.len() < 2 {
        return Json::Nul;
    }
    let i = plus_petite_cellule(lignes);
    let obl = ensemble9(obligatoires.iter().copied());
    let aff = ensemble9(affinage.iter().copied());
    let rang = |v: f64| {
        let v = (py::round(v, 9) + 0.0).to_bits();
        if obl.contains(&v) {
            "obligatoire"
        } else if aff.contains(&v) {
            "affinage"
        } else {
            "remplissage"
        }
    };
    let (a, b) = (lignes[i], lignes[i + 1]);
    obj! {"mm" => b - a, "a" => a, "b" => b,
          "rang_a" => rang(a), "rang_b" => rang(b)}
}

/// La ligne de maillage la plus proche de `v`.
fn _coller(lignes: &[f64], v: f64) -> f64 {
    let i = _place(lignes, v);
    let mut choix: Option<f64> = None;
    for j in [i.wrapping_sub(1), i] {
        if let Some(&w) = lignes.get(j) {
            if choix.is_none_or(|c| (w - v).abs() < (c - v).abs()) {
                choix = Some(w);
            }
        }
    }
    choix.unwrap_or(v)
}

/// Colle les cotes des ports SUR les lignes de maillage, exactement.
///
/// UNE BOITE D'EXCITATION EST PLATE DANS DEUX DIRECTIONS, et c'est ce qui
/// rend ce detail mortel. openEMS cherche dans cette boite une composante de
/// champ a exciter ; une boite d'epaisseur nulle posee a quatre MICRONS de la
/// ligne de maillage n'en contient aucune. Le solveur le dit une fois --
/// « Unused primitive (type: Box) detected in property: port_excite_1 » --,
/// au milieu de trois cents lignes de demarrage, puis il calcule jusqu'au
/// bout un champ rigoureusement nul : energie a 0,00e+00 d'un bout a l'autre,
/// aucune resonance, et tout le temps de calcul depense. C'est la panne la
/// plus chere que cet outil puisse produire, et la moins visible.
///
/// D'OU VENAIENT LES QUATRE MICRONS. De deux arrondis qui ne se parlaient
/// pas : `_fusionner` arrondit les lignes obligatoires au milliardieme de
/// millimetre, et le script ecrivait les lignes de maillage a cinq decimales
/// quand il ecrivait les cotes du port a six. Un port a y = 30,111544 tombait
/// sur une grille qui disait 30,11154, et personne ne pouvait le voir en
/// relisant l'un ou l'autre : il fallait comparer les deux. Le port d'une
/// antenne dessinee a la main tombe souvent sur un compte rond et ne montrait
/// rien ; celui du patch d'essai, dont la cote sort d'une formule, tombait a
/// cote a chaque fois.
///
/// DEUX VERROUS, ET IL EN FAUT DEUX. Ici, les cotes sont collees sur la
/// ligne -- elles y etaient posees en obligatoires, l'ecart n'est qu'un
/// arrondi. Dans le script, les lignes et les cotes s'ecrivent desormais a la
/// MEME precision : deux nombres egaux dans le modele doivent s'ecrire
/// pareil, sans quoi le collage d'ici ne survit pas a l'impression.
///
/// Rend le plus grand deplacement, pour que l'assistant puisse crier si ce
/// n'etait pas un arrondi.
pub(super) fn _coller_ports(modele: &mut Json) -> f64 {
    let mx = reels(&modele["maillage"]["x"]);
    let my = reels(&modele["maillage"]["y"]);
    let mz = reels(&modele["maillage"]["z"]);
    let mut pire = 0.0;
    let mut coller = |o: &mut Json, cle: &str, lignes: &[f64]| {
        let avant = f(&o[cle]);
        let v = _coller(lignes, avant);
        pire = maxi(pire, (v - avant).abs());
        poser(o, cle, v);
    };
    for p in liste_mut(modele, "ports") {
        let mut cotes: Vec<(&str, &Vec<f64>)> = vec![("x1", &mx), ("x2", &mx), ("y1", &my), ("y2", &my), ("z1", &mz), ("z2", &mz)];
        if p.get("x").is_some() {
            cotes.extend([("x", &mx), ("y", &my)]);
        }
        // LE CENTRE D'UN PORT DANS LE PLAN EST AU MILIEU DE SON ECART, pas sur
        // une ligne : ce sont ses deux bornes, x1/x2 ou y1/y2, qui y tombent.
        // Le coller deplacait le centre d'une demi-fente et criait a la face
        // perdue -- 0,1075 mm sur le point de test de P01x274PCB-C.xml.
        if !p["coax"].vrai() && matches!(txt(&p["dir"]), "x" | "y") {
            let dir = txt(&p["dir"]).to_string();
            cotes.retain(|cv| cv.0 != dir);
        }
        for (cle, lignes) in cotes {
            coller(p, cle, lignes);
        }
        if p["msl"].vrai() {
            let en_x = txt(&p["msl"]["axe"]) == "x";
            let (le_long, en_travers) = if en_x { (&mx, &my) } else { (&my, &mx) };
            let q = champ(p, "msl");
            for (cle, lignes) in [("debut", le_long), ("fin", le_long),
                                  ("t1", en_travers), ("t2", en_travers),
                                  ("z_ruban", &mz), ("z_masse", &mz)] {
                coller(q, cle, lignes);
            }
        }
        if !p["coax"].vrai() {
            continue;
        }
        let c = champ(p, "coax");
        for cle in ["z_bas", "z_mes", "z_gaine", "z_ame"] {
            if c.get(cle).is_some() {
                coller(c, cle, &mz);
            }
        }
    }
    pire
}

/// Le prix d'un maillage, en cellules-pas de temps.
///
/// C'EST LA SEULE GRANDEUR QUI MESURE VRAIMENT CE QUE COUTE UN MAILLAGE. Le
/// nombre de cellules seul n'en dit que la moitie : l'autre moitie est dans le
/// NOMBRE DE PAS, c'est-a-dire dans la plus petite cellule du domaine. Un
/// maillage deux fois plus fin dans une seule bande coute peu de cellules et
/// peut couter le double de pas.
///
/// ET C'EST LA SEULE QUI NE DEPENDE PAS DE LA MACHINE. Une duree en heures
/// suppose un debit, et le debit de ce poste se mesure et remonte des qu'un
/// calcul y finit (voir `noter_debit`) : un maillage qui changerait parce
/// qu'une autre simulation a fini serait une surprise tres desagreable. Le
/// nombre de pas est celui de `duree_estimee`, pour que le budget et la duree
/// annoncee parlent de la meme chose.
pub fn _cout(est: &Json, bande: &Json) -> f64 {
    let dt = f(&est["dt_s"]);
    // LA MEME FREQUENCE ET LE MEME NOMBRE DE PERIODES QUE `nmax`, ET C'EST
    // TOUT LE CORRECTIF. Ce budget comptait 20 periodes autour de f0 quand le
    // solveur en recoit NMAX_PERIODES autour de la frequence CIBLE : il
    // chiffrait donc une simulation deux fois plus courte que celle qui part.
    // Sur une carte relais 868 MHz, le maillage de fond etait annonce a
    // 4,0e11 -- juste sous le plafond -- pour 8,2e11 reellement calcules, et
    // cinq heures passees sans qu'aucun garde-fou ait eu l'occasion de parler.
    // CELLULES_PAS_MAX ne change pas : c'est justement parce que ce chiffre
    // est cense valoir des heures de calcul qu'il faut le nourrir avec les
    // vrais pas.
    let f_res = ou(f(&bande["fcible"]), f(&bande["f0"]));
    if dt <= 0.0 || f_res <= 0.0 || !est["cellules"].vrai() {
        return 0.0;
    }
    f(&est["cellules"]) * maxi(NMAX_PLANCHER as f64, NMAX_PERIODES / (f_res * dt))
}

/// Comment chaque polygone est resolu PAR LA GRILLE QUI LE CONCERNE.
///
/// PAS LE PLUS ETROIT : LE PLUS MAL RESOLU. Ce n'est plus la meme question
/// depuis qu'il y a deux pas dans le plan. Un ruban de 0,5 mm dans une bande a
/// 0,13 mm en a quatre en travers ; un ruban de 1,2 mm laisse au pas de fond
/// de 0,6 n'en a que deux, et c'est celui-la qu'il faut nommer. Les deux avis
/// qui parlaient de largeur de cuivre comparaient tout au pas de fond : l'un
/// annoncait « resolu » ce qui ne l'etait pas, l'autre « ignore » ce qu'une
/// bande venait de sauver.
///
/// Rend le pire cas (largeur, cellules en travers) et le compte de ceux qu'
/// openEMS laissera tomber faute d'une cellule entiere.
fn _bilan_pistes(cuivre: &[Bloc], res_die: f64, fin: f64, bx: &[P], by: &[P]) -> Json {
    let mut pire: Option<(f64, f64)> = None;
    let (mut ignores, mut plus_petit) = (0i64, None::<f64>);
    for poly in cuivre.iter().flat_map(|b| &b.polys) {
        let Some([x0, x1, y0, y1]) = etendue(poly) else { continue };
        let mut cas: Option<(f64, f64)> = None;
        for (larg, deb, bandes) in [(x1 - x0, x0, bx), (y1 - y0, y0, by)] {
            if larg <= 1e-9 {
                continue;
            }
            let pas = if fin > 0.0 && _dans(bandes, deb) { fin } else { res_die };
            let n = larg / pas;
            if cas.is_none_or(|c| n < c.1) {
                cas = Some((larg, n));
            }
        }
        let Some(cas) = cas else { continue };
        if pire.is_none_or(|p| cas.1 < p.1) {
            pire = Some(cas);
        }
        if cas.1 < 1.0 {
            ignores += 1;
            plus_petit = Some(plus_petit.map_or(cas.0, |p| mini(p, cas.0)));
        }
    }
    obj! {"largeur" => pire.map_or(0.0, |p| p.0),
          "cellules" => pire.map_or(0.0, |p| p.1),
          "ignores" => ignores, "ignore_mm" => ou(plus_petit.unwrap_or(0.0), 0.0)}
}

/// Le maillage, et le budget qui borne son affinage local.
///
/// POURQUOI UNE BOUCLE, ET NON UNE FORMULE. Le prix d'un raffinement ne se
/// calcule pas d'avance : il depend du nombre de bandes, de leurs
/// chevauchements, des lignes que la fusion supprimera, de celles que le
/// lissage ajoutera, et surtout de la plus petite cellule qui en sortira --
/// laquelle commande le nombre de pas. On construit donc le maillage, on le
/// chiffre, et on RECULE d'un cran tant qu'il depasse le budget. Un maillage
/// coute quelques millisecondes a construire ; une vingtaine d'essais ne se
/// voit pas, et c'est le seul moyen de tenir une promesse chiffree.
///
/// LE BUDGET A DEUX BORNES, ET LA PLUS SERREE GAGNE : un plafond absolu
/// (CELLULES_PAS_MAX, de quoi ne pas lancer une nuit de calcul sans l'avoir
/// demande) et un plafond RELATIF au maillage de fond (AFFINAGE_COUT_MAX) --
/// sans lui, une petite carte dont le fond coute trois minutes se verrait
/// affinee cent fois, ce qui est exactement « exploser le temps de
/// simulation ». Et le maillage de fond passe toujours : on refuse d'affiner,
/// jamais de calculer.
pub(super) fn _mailler(modele: &mut Json, cuivre: &[Bloc], pieces: &[Piece], bande: &Json, res_air: f64,
                       res_die: f64) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
    fn det(modele: &mut Json) -> &mut Json {
        let d = champ(champ(modele, "resolution"), "detail");
        if !matches!(d, Json::Objet(_)) {
            *d = Json::Objet(Objet::new());
        }
        d
    }
    let largeur = f(&det(modele)["largeur_cuivre"]);
    let voulu = if largeur > 0.0 { largeur / CELLULES_PAR_PISTE } else { 0.0 };
    poser(det(modele), "fin_voulu", voulu);
    poser(det(modele), "fin", 0.0);
    poser(det(modele), "fin_borne", false);
    poser(det(modele), "cout_fond", 0.0);
    poser(det(modele), "cout", 0.0);

    let fond = _maillage(modele, cuivre, pieces, res_air, res_die, 0.0, None);
    let cout_fond = _cout(&_estimation(&fond.0, &fond.1, &fond.2, res_die), bande);
    poser(det(modele), "cout_fond", cout_fond);
    poser(det(modele), "cout", cout_fond);
    if voulu <= 0.0 || voulu >= res_die {
        // Le fond resout deja le cuivre le plus etroit : il n'y a rien a
        // affiner, et le chemin reste celui d'avant, ligne pour ligne.
        poser(det(modele), "pistes", _bilan_pistes(cuivre, res_die, 0.0, &[], &[]));
        return fond;
    }

    let bandes = _bandes_fines(cuivre, CELLULES_PAR_PISTE * res_die);
    if bandes.x.is_empty() && bandes.y.is_empty() {
        poser(det(modele), "pistes", _bilan_pistes(cuivre, res_die, 0.0, &[], &[]));
        return fond;
    }

    let budget = maxi(cout_fond, mini(CELLULES_PAS_MAX, cout_fond * AFFINAGE_COUT_MAX));
    let mut fin = voulu;
    for _ in 0..AFFINAGE_ESSAIS {
        if fin >= res_die {
            break;
        }
        // LES BANDES QUI SURVIVENT A CE PAS-LA, ET ELLES SEULES. Une bande plus
        // mince que le pas fin est abandonnee (voir `_maillage`) : quand il n'en
        // reste plus aucune, il n'y a plus d'affinage a chiffrer -- et
        // continuer a reculer annoncerait un pas fin qui ne maille rien.
        let bx: Vec<P> = bandes.x.iter().filter(|t| t.1 - t.0 >= fin).copied().collect();
        let by: Vec<P> = bandes.y.iter().filter(|t| t.1 - t.0 >= fin).copied().collect();
        if bx.is_empty() && by.is_empty() {
            break;
        }
        // UN ESSAI ABSURDE NE SE CONSTRUIT PAS. Sur une carte entiere, les
        // milliers de pastilles donnent des bandes qui se soudent en travers de
        // toute la carte, et le cuivre le plus etroit -- un copeau de quelques
        // microns -- fixe le pas fin : le premier essai posait seize millions
        // de lignes sur un axe, et sa seule fusion prenait une minute et
        // demie (P01x274PCB-C.xml, 7 000 pastilles). Un tel maillage depasse
        // le budget de tres loin ; on recule sans le batir.
        if maxi(_lignes_bandes(&bx, fin), _lignes_bandes(&by, fin)) > LIGNES_MAX_BANDES {
            fin *= AFFINAGE_RECUL;
            continue;
        }
        let essai = _maillage(modele, cuivre, pieces, res_air, res_die, fin, Some(&bandes));
        let cout = _cout(&_estimation(&essai.0, &essai.1, &essai.2, res_die), bande);
        if cout <= budget {
            poser(det(modele), "fin", fin);
            poser(det(modele), "fin_borne", fin > voulu * 1.001);
            poser(det(modele), "cout", cout);
            poser(det(modele), "pistes", _bilan_pistes(cuivre, res_die, fin, &bx, &by));
            return essai;
        }
        fin *= AFFINAGE_RECUL;
    }
    // Aucun pas fin ne tient dans le budget : le fond, et l'avis le dira.
    // ON LE RECONSTRUIT, et ce n'est pas du gaspillage : `_maillage` ecrit dans
    // `modele["maillage_detail"]` a chaque appel, et le dernier essai y a laisse
    // SES bandes. Rendre le fond en laissant parler d'un affinage qui n'a pas
    // eu lieu, c'est le genre de chiffre qu'on croit et qu'on ne verifie pas.
    poser(det(modele), "fin_borne", true);
    poser(det(modele), "pistes", _bilan_pistes(cuivre, res_die, 0.0, &[], &[]));
    _maillage(modele, cuivre, pieces, res_air, res_die, 0.0, None)
}

// ==========================================================================
// Les pertes dielectriques
// ==========================================================================

/// Conductivite equivalente d'un dielectrique a pertes, a la frequence f.
fn _kappa(er: f64, df: f64, freq: f64) -> f64 {
    2.0 * std::f64::consts::PI * freq * EPS0 * er * df
}

/// Permittivite complexe du jeu de poles, a la frequence f.
fn _eps_debye(eps_inf: f64, poles: &[(f64, f64)], freq: f64) -> (f64, f64) {
    let w = 2.0 * std::f64::consts::PI * freq;
    let (mut re, mut im) = (eps_inf, 0.0);
    for (de, tau) in poles {
        let d = 1.0 + (w * tau).powf(2.0);
        re += de / d;
        im -= de * w * tau / d;
    }
    (re, im)
}

/// Un jeu de poles de Debye qui rend tan(delta) plat sur [f1, f2].
///
/// LA FORMULE ASYMPTOTIQUE NE SUFFIT PAS. La distribution continue donne
/// tan(d) ~ (pi/2).(d_eps_total / ln(tau_max/tau_min)) / er, et c'est de
/// l'ordre de DIX POUR CENT trop bas des qu'on la discretise sur quatre
/// poles : le nombre fini de poles et la plage finie de tau y mordent tous
/// les deux. On s'en sert comme point de depart, puis on CALIBRE -- eps''
/// est lineaire en d_eps et eps' est tenu a er par construction, si bien que
/// quelques tours suffisent a tomber sur la valeur visee.
///
/// Rend None quand la borne du pas de temps ne laisse pas de place.
fn _debye(er: f64, df: f64, f1: f64, f2: f64, dt_s: f64) -> Option<Json> {
    let pi = std::f64::consts::PI;
    let tau_max = 1.0 / (2.0 * pi * (f1 / 10.0f64.powf(DEBYE_DECADES)));
    let mut tau_min = 1.0 / (2.0 * pi * (f2 * 10.0f64.powf(DEBYE_DECADES)));

    let borne = DEBYE_TAU_SUR_DT * dt_s;
    let bornee = tau_min < borne;
    if bornee {
        tau_min = borne;
    }
    if tau_min >= tau_max / 1.5 {
        return None;
    }

    let etendue = (tau_max / tau_min).log10();
    let n = ((DEBYE_POLES_PAR_DECADE * etendue).round_ties_even() as i64).clamp(DEBYE_POLES_MIN, DEBYE_POLES_MAX);

    let l = (tau_max / tau_min).ln();
    let taus: Vec<f64> = (0..n).map(|i| tau_min * (l * (i as f64 + 0.5) / n as f64).exp()).collect();

    let f_ref = (f1 * f2).sqrt();
    let mut de = (2.0 / pi) * er * df * l / n as f64; // depart asymptotique
    let jeu = |de: f64| -> Vec<(f64, f64)> { taus.iter().map(|t| (de, *t)).collect() };
    for _ in 0..8 {
        let poles = jeu(de);
        let eps_inf = er - _eps_debye(0.0, &poles, f_ref).0;
        let (re, im) = _eps_debye(eps_inf, &poles, f_ref);
        let obtenu = if re > 0.0 { -im / re } else { 0.0 };
        if obtenu <= 0.0 {
            break;
        }
        de *= df / obtenu;
    }

    let poles = jeu(de);
    let eps_inf = er - _eps_debye(0.0, &poles, f_ref).0;

    // CE QUE LE JEU VAUT VRAIMENT, mesure et non suppose : on parcourt la
    // bande et on garde les ecarts les plus grands. C'est ce chiffre que la
    // page affiche, pas la promesse du modele.
    let (mut pire_d, mut pire_e) = (0.0, 0.0);
    for i in 0..41 {
        let freq = f1 * (f2 / f1).powf(i as f64 / 40.0);
        let (re, im) = _eps_debye(eps_inf, &poles, freq);
        if re <= 0.0 {
            continue;
        }
        pire_d = maxi(pire_d, ((-im / re) / df - 1.0).abs());
        pire_e = maxi(pire_e, (re / er - 1.0).abs());
    }

    Some(obj! {
        "eps_inf" => eps_inf,
        "poles" => Json::Liste(poles.iter().map(|(d, t)| obj! {"de" => *d, "tau" => *t}).collect()),
        "ecart_tand_pc" => 100.0 * pire_d,
        "ecart_er_pc" => 100.0 * pire_e,
        "borne_par_dt" => bornee,
        "tau_min" => taus[0], "tau_max" => taus[taus.len() - 1],
    })
}

/// Complete chaque dielectrique avec son modele de pertes.
///
/// Rend le mode retenu et ce qu'il coute en justesse. Le mode « debye »
/// peut echouer par manque de place entre le pas de temps et la bande : on
/// retombe alors sur kappa EN LE DISANT, plutot que de rendre un materiau
/// dont les poles seraient sautes en silence par le solveur.
pub(super) fn _pertes(doc: &Json, dielectriques: &mut [Json], bande: &Json, dt_s: f64) -> Json {
    let p = &doc["pertes"];
    let mut mode = ou_texte(_texte(&p["mode"], 10), "kappa").to_lowercase();
    if mode != "kappa" && mode != "debye" {
        mode = "kappa".into();
    }
    let (f1, f2) = (f(&bande["f1"]), f(&bande["f2"]));
    let f_kappa = ou(_nb_pos(&p["f_kappa"], 0.0), f(&bande["f0"]));
    let f_kappa = maxi(f1 * 0.1, mini(f2 * 10.0, f_kappa));

    let mut replis = Vec::new();
    for d in dielectriques.iter_mut() {
        let (er, df) = (f(&d["er"]), f(&d["df"]));
        poser(d, "kappa", _kappa(er, df, f_kappa));
        poser(d, "debye", Json::Nul);
        if mode != "debye" || df <= 0.0 {
            continue;
        }
        match _debye(er, df, f1, f2, dt_s) {
            None => replis.push(d["nom"].clone()),
            Some(jeu) => poser(d, "debye", jeu),
        }
    }

    // L'ERREUR DE kappa SE CHIFFRE SANS RIEN CALCULER : a kappa constant,
    // tan(d) varie comme 1/f. Au bord bas de la bande il vaut f_kappa/f1 fois
    // la valeur visee, au bord haut f_kappa/f2 fois.
    let ecart = maxi((f_kappa / f1 - 1.0).abs(), (f_kappa / f2 - 1.0).abs()) * 100.0;

    let ecarts: Vec<f64> = dielectriques.iter().filter(|d| d["debye"].vrai()).map(|d| f(&d["debye"]["ecart_tand_pc"])).collect();
    obj! {
        "mode" => mode,
        "f_kappa" => f_kappa,
        "ecart_kappa_pc" => ecart,
        "replis" => Json::Liste(replis),
        // Ce que le mode Debye a reellement obtenu, pire cas sur les couches.
        "ecart_debye_pc" => if ecarts.is_empty() { 0.0 } else { max_de(ecarts.iter().copied()) },
        "actif" => !ecarts.is_empty(),
    }
}

// ==========================================================================
// Les enregistrements de champ
// ==========================================================================
// CE QU'ON VIENT CHERCHER ICI. Un S11 dit que l'antenne resonne a 2,37 GHz ;
// il ne dit pas POURQUOI. La carte du courant de surface, elle, montre d'un
// coup d'oeil ou il circule -- et l'on voit tout de suite qu'il fait le tour
// d'une fente qu'on n'avait pas remarquee, ou qu'il se perd dans un plan de
// masse trop court.
//
// LE DOMAINE FREQUENTIEL PLUTOT QUE TEMPOREL, ET DE LOIN. Un enregistrement
// frequentiel rend UN champ complexe par frequence demandee : quelques
// fichiers, quelques mega-octets. Un enregistrement temporel rend un fichier
// PAR PAS DE TEMPS -- des dizaines de milliers -- et remplit un disque en
// quelques minutes. Le temporel ne sert qu'a faire une animation ; pour
// comprendre, le frequentiel suffit et coute mille fois moins.
/// nom, type temporel, type frequentiel, libelle
pub const DUMP_TYPES: [(&str, i64, i64, &str); 4] = [
    ("E", 0, 10, "champ electrique"),
    ("H", 1, 11, "champ magnetique"),
    ("J", 2, 12, "densite de courant"),
    ("I", 3, 13, "courant total (rot H)"),
];
pub const DUMP_REGIONS: [&str; 5] = ["structure", "plan_z", "coupe_x", "coupe_y", "boite"];
// Un flottant simple precision par composante, trois composantes par cellule.
pub const OCTETS_PAR_CELLULE_DUMP: f64 = 12.0;

/// Ce qu'on enregistre du champ, et ce que cela coutera en disque.
#[allow(clippy::too_many_arguments)]
pub(super) fn _dumps(doc: &Json, emprise: &[f64; 6], boite: &Json, bande: &Json, mx: &[f64], my: &[f64], mz: &[f64],
                     nmax: i64) -> Json {
    let d = &doc["dumps"];
    if !d["actif"].vrai() {
        return obj! {"actif" => false};
    }

    let mut types: Vec<Json> = liste(&d["types"]).iter()
        .filter(|t| t.as_str().is_some_and(|t| DUMP_TYPES.iter().any(|d| d.0 == t))).cloned().collect();
    if types.is_empty() {
        types.push("J".into());
    }
    let mut mode = ou_texte(_texte(&d["mode"], 14), "frequentiel").to_lowercase();
    if mode != "frequentiel" && mode != "temporel" {
        mode = "frequentiel".into();
    }
    let mut region = ou_texte(_texte(&d["region"], 12), "structure").to_lowercase();
    if !DUMP_REGIONS.contains(&region.as_str()) {
        region = "structure".into();
    }
    let sous = (_nb_pos(&d["sous_ech"], 2.0) as i64).clamp(1, 20);

    let [mut x1, mut y1, mut z1, mut x2, mut y2, mut z2] = *emprise;
    match region.as_str() {
        "boite" => {
            (x1, y1, z1) = (f(&boite["x1"]), f(&boite["y1"]), f(&boite["z1"]));
            (x2, y2, z2) = (f(&boite["x2"]), f(&boite["y2"]), f(&boite["z2"]));
        }
        "plan_z" => {
            // Un plan horizontal : c'est la vue qui montre le courant sur le
            // cuivre, et c'est celle qu'on regarde neuf fois sur dix.
            let z = _nb(&d["z"], 0.0) * _k_mm(&doc["unite"]);
            (z1, z2) = (z, z);
        }
        "coupe_x" => {
            let x = _nb(&d["x"], (x1 + x2) / 2.0);
            (x1, x2) = (x, x);
        }
        "coupe_y" => {
            let y = _nb(&d["y"], (y1 + y2) / 2.0);
            (y1, y2) = (y, y);
        }
        _ => {}
    }

    let cellules = |lignes: &[f64], a: f64, b: f64| -> i64 {
        (lignes.iter().filter(|v| a - 1e-9 <= **v && **v <= b + 1e-9).count() as i64).max(1)
    };

    let nc = cellules(mx, x1, x2) * cellules(my, y1, y2) * cellules(mz, z1, z2);
    let nc = (if region == "boite" || z1 != z2 { nc / sous.pow(3) } else { nc / sous.pow(2) }).max(1);

    let mut freqs: Vec<f64> = liste(&d["f"]).iter().map(|v| _nb_pos(v, 0.0)).filter(|v| *v != 0.0).collect();
    if freqs.is_empty() {
        freqs.push(f(&bande["fcible"]));
    }

    // LE POIDS SUR LE DISQUE, ANNONCE AVANT ET NON DECOUVERT APRES. En
    // temporel, openEMS ecrit un fichier par pas de temps : le facteur n'est
    // pas le nombre de frequences mais le nombre de PAS.
    let octets = if mode == "frequentiel" {
        nc as f64 * OCTETS_PAR_CELLULE_DUMP * freqs.len() as f64 * 2.0 * types.len() as f64
    } else {
        // LE NOMBRE DE PAS RESOLU, et non celui du document : a zero, le
        // document dit « calcule-le », et chiffrer le disque sur un defaut
        // annoncerait des gigaoctets qui ne correspondent a aucun calcul.
        let pas = if nmax != 0 { nmax as f64 } else { _nb_pos(&doc["arret"]["nmax"], NMAX_DEFAUT as f64) };
        nc as f64 * OCTETS_PAR_CELLULE_DUMP * pas * types.len() as f64
    };

    obj! {
        "actif" => true, "types" => Json::Liste(types), "mode" => mode, "region" => region,
        "sous_ech" => sous, "f" => nombres(freqs),
        "x1" => x1, "y1" => y1, "z1" => z1, "x2" => x2, "y2" => y2, "z2" => z2,
        "cellules" => nc, "octets" => octets,
    }
}

/// Cellules, memoire, pas de temps et duree — avec ce que ces chiffres
/// valent, dit sans detour : le pas de temps est celui de Courant sur la
/// plus petite cellule, la duree est un ordre de grandeur.
pub fn _estimation(mx: &[f64], my: &[f64], mz: &[f64], res_die: f64) -> Json {
    let (nx, ny, nz) = (mx.len() as i64, my.len() as i64, mz.len() as i64);
    let cellules = (nx - 1).max(0) * (ny - 1).max(0) * (nz - 1).max(0);

    let plus_petit = |t: &[f64]| t.windows(2).map(|w| w[1] - w[0]).reduce(mini).unwrap_or(res_die);

    let dx = plus_petit(mx) / 1000.0; // mm -> m
    let dy = plus_petit(my) / 1000.0;
    let dz = plus_petit(mz) / 1000.0;
    // Condition de Courant-Friedrichs-Lewy en 3D, dans le vide.
    let dt = 1.0 / (C0 * (1.0 / dx.powf(2.0) + 1.0 / dy.powf(2.0) + 1.0 / dz.powf(2.0)).sqrt());
    let p = poste();
    obj! {
        "lignes" => Json::Liste(vec![nx.into(), ny.into(), nz.into()]),
        "cellules" => cellules,
        "memoire_Mo" => cellules as f64 * OCTETS_PAR_CELLULE / 1048576.0,
        "plus_petite_cellule_mm" => nombres([dx * 1000.0, dy * 1000.0, dz * 1000.0]),
        "dt_s" => dt,
        // Le debit sur lequel la duree est annoncee, et D'OU IL VIENT. La page
        // le dit : « ordre de grandeur » sur une valeur supposee n'est pas la
        // meme promesse que « mesure sur ce poste ».
        "mcps_suppose" => p.debit_suppose(),
        "mcps_mesure" => p.debit_mesure().is_some(),
        "mcps_n" => p.vus.len(),
        // Les fils avec lesquels ce debit est annonce, et s'il a ete ramene a
        // ce reglage par le banc de vitesse (voir `debit_suppose`).
        "fils" => p.fils_effectif(),
        "mcps_ramene" => p.vus.iter().any(|(_, fils)| p.facteur_fils(*fils) != 1.0),
    }
}
