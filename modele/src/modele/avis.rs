//! Ce que l'assistant a a dire du modele : la plus petite cellule et sa cause, les controles
//! des ports, et les avis (openems_modele.py, `_coupable_cellule`, `_cause_cellule`, les
//! `_avis_*` et `_avis`).

use super::ponts::ECART_OUVRABLE_MM;
use super::*;

/// La plus petite cellule du domaine, son axe, et la couche qui la fait.
///
/// UNE SEULE AUTORITE POUR UNE SEULE QUESTION. Deux surfaces posent celle-ci
/// -- l'avis de l'assistant et le rapport d'ingenierie --, et elles y
/// repondaient chacune de son cote, toutes deux a cote de la plaque : « deux
/// aretes de cuivre presque confondues » pour l'un, « un sommet decale d'une
/// fraction de micron » pour l'autre, quand la cause etait le vernis epargne
/// de l'empilage. Le modele repond ici, une fois ; la page et le rapport
/// lisent.
pub fn _coupable_cellule(m: &Json) -> Json {
    let cotes = reels(&m["estimation"]["plus_petite_cellule_mm"]);
    let mm = min_de(cotes.iter().copied());
    let axe = ["x", "y", "z"][cotes.iter().position(|c| *c == mm).unwrap_or(0).min(2)];
    let mut out = obj! {"mm" => mm, "axe" => axe,
                        "quoi" => "", "couche" => "", "ep" => 0.0, "revetement" => false,
                        "pincee" => Json::Nul};
    // LES DEUX LIGNES QUI LA BORNENT, SUR TOUS LES AXES. En z elles ne
    // remplacent pas la couche nommee plus bas -- elles la confirment, et
    // elles disent en plus si la ligne d'en face etait du remplissage.
    let pincee = m["maillage_detail"]["pincee"][axe].clone();
    poser(&mut out, "pincee", pincee.clone());
    if axe != "z" {
        // Une cellule mince dans le plan ne vient pas d'une couche : elle
        // vient de deux lignes que la grille a gardees toutes les deux.
        // LESQUELLES, C'EST `pincee` QUI LE DIT, et ce n'est plus une
        // supposition : « deux aretes de cuivre presque confondues » etait
        // faux des que la paire venait d'un port ou d'une primitive.
        if pincee.vrai() {
            poser(&mut out, "quoi", "lignes");
        }
        // LA GRILLE A PU CHANGER APRES `_maillage` : `_ouvrir_ecarts` y pose
        // ses lignes, et la pincee notee plus haut decrit alors une grille qui
        // n'existe plus. On relit la vraie.
        let posees = ensemble9(reels(&m["ecarts_ouverts"]["lignes"][axe]));
        let r9 = |v: f64| (py::round(v, 9) + 0.0).to_bits();
        let t = reels(&m["maillage"][axe]);
        if !posees.is_empty() && t.len() > 1 {
            let k = plus_petite_cellule(&t);
            let (a, b) = (t[k], t[k + 1]);
            if posees.contains(&r9(a)) || posees.contains(&r9(b)) {
                let rang = |v: f64| -> Json {
                    if posees.contains(&r9(v)) {
                        return "ecart".into();
                    }
                    for cle in ["a", "b"] {
                        if !matches!(pincee[cle], Json::Nul) && (f(&pincee[cle]) - v).abs() < 1e-9 {
                            return pincee[format!("rang_{cle}").as_str()].clone();
                        }
                    }
                    "grille".into()
                };
                poser(&mut out, "pincee", obj! {"a" => a, "b" => b, "mm" => b - a,
                                                "rang_a" => rang(a), "rang_b" => rang(b)});
                poser(&mut out, "quoi", "lignes");
            }
        }
        return out;
    }
    for d in liste(&m["dielectriques"]) {
        if (f(&d["ep"]) - mm).abs() < 1e-6 {
            poser(&mut out, "quoi", "dielectrique");
            poser(&mut out, "couche", d["nom"].clone());
            poser(&mut out, "ep", d["ep"].clone());
            poser(&mut out, "revetement", liste(&m["revetements"]).iter().any(|r| r["nom"] == d["nom"]));
            return out;
        }
    }
    if txt(&m["modele_cuivre"]) == "volume" {
        for c in liste(&m["conducteurs"]) {
            if f(&c["ep_geo"]) > 0.0 && (f(&c["ep_geo"]) - mm).abs() < 1e-6 {
                poser(&mut out, "quoi", "cuivre");
                poser(&mut out, "couche", c["nom"].clone());
                poser(&mut out, "ep", c["ep_geo"].clone());
                return out;
            }
        }
    }
    out
}

/// La meme chose en une phrase, pour l'avis.
///
/// L'AVIS PROPOSAIT DEUX CAUSES PROBABLES, ET LA VRAIE ETAIT UNE TROISIEME.
/// Sur antenna4c.xml, la cellule de 15 microns n'etait ni du cuivre presque
/// confondu ni un substrat mince : c'etait le VERNIS EPARGNE, declare dans
/// l'empilage comme une couche a part entiere et invisible dans le panneau
/// qui montre l'empilage, lequel n'affiche que les conducteurs et ce qui les
/// separe. Lire « deux aretes presque confondues, ou un substrat tres mince »
/// envoyait donc chercher dans le DESSIN ce qui etait dans l'EMPILAGE, et
/// aucune retouche du dessin n'y aurait rien change. Le modele connait
/// l'epaisseur et le NOM de chaque couche : il n'a aucune raison de faire
/// deviner.
///
/// L'AXE DECIDE OU CHERCHER, et il coute un mot : une cellule mince en z
/// vient d'une couche, une cellule mince en x ou en y vient de deux aretes de
/// cuivre que la grille n'a pas su confondre. Les melanger, c'est renvoyer la
/// moitie des lecteurs au mauvais endroit.
pub fn _cause_cellule(m: &Json) -> String {
    let c = &m["estimation"]["cellule"];
    if txt(&c["quoi"]) == "dielectrique" {
        let suite = if c["revetement"].vrai() {
            " C'est un revetement EXTERIEUR : l'etape « L'empilage » le \
             sort du maillage d'une case a decocher."
        } else {
            " C'est un substrat -- il est entre deux conducteurs, \
             il porte le champ, et il doit rester."
        };
        return format!("Cause : le dielectrique « {} » ne fait que {:.4} mm, et ses \
                        deux faces portent chacune une ligne de maillage qu'on ne \
                        peut pas deplacer sans deplacer la couche elle-meme.{}",
                       py_str(&c["couche"]), f(&c["ep"]), suite);
    }
    if txt(&c["quoi"]) == "cuivre" {
        return format!("Cause : l'epaisseur de « {} » ({:.4} mm), que le mode \
                        « volume » fait entrer dans le maillage. Le mode \
                        « feuille » donne le meme resultat en une fraction du temps.",
                       py_str(&c["couche"]), f(&c["ep"]));
    }
    let p = &c["pincee"];
    if txt(&c["axe"]) == "z" && !p.vrai() {
        return "Cause : deux lignes obligatoires voisines en z -- une \
                interface de l'empilage, une face de port, un objet ajoute \
                a la main -- posees a cette distance l'une de l'autre.".into();
    }
    if !p.vrai() {
        return "Cause probable : deux aretes de cuivre presque confondues \
                dans le plan, que la tolerance de regroupement n'a pas \
                rapprochees.".into();
    }
    // CHAQUE RANG SE CORRIGE AILLEURS, et c'est tout l'interet de le nommer.
    let geste = |rang: &str| match rang {
        "obligatoire" => "une ligne qu'on ne peut pas deplacer sans deplacer \
                          l'objet : une face de port, une arete de primitive. \
                          Elargissez l'objet jusqu'au pas vise, ou retirez-le",
        "affinage" => "une ligne de la regle du tiers, posee autour d'une \
                       arete de cuivre, ou le plan d'une face de piece \
                       importee. Retirez de la selection le cuivre qui ne \
                       rayonne pas, ou marquez « ignore » le corps en cause",
        "remplissage" => "une ligne reguliere de la grille. Le pas vise la \
                          commande",
        "ecart" => "une ligne posee dans un ecart antenne-masse que la grille \
                    aurait soude (voir l'avis des ecarts ouverts). C'est le prix \
                    d'un resultat juste ; l'ecart dessine est a revoir si ce \
                    prix est trop haut",
        "grille" => "une ligne deja presente, voisine de la precedente",
        _ => "",
    };
    let mut rangs = vec![txt(&p["rang_a"]), txt(&p["rang_b"])];
    rangs.sort();
    rangs.dedup();
    format!("Cause : les lignes {} = {:.4} et {} = {:.4} mm, distantes de \
             {:.4} mm. La premiere est {}, la seconde {} -- {}.",
            txt(&c["axe"]), f(&p["a"]), txt(&c["axe"]), f(&p["b"]), f(&p["mm"]),
            txt(&p["rang_a"]), txt(&p["rang_b"]),
            rangs.iter().map(|r| geste(r)).collect::<Vec<_>>().join(" ; "))
}

/// Pair-impair sur un seul anneau.
fn _point_dans_anneau(pts: &[P], x: f64, y: f64) -> bool {
    let mut dedans = false;
    let n = pts.len();
    for k in 0..n {
        let (ax, ay) = pts[k];
        let (bx, by) = pts[(k + 1) % n];
        if (ay > y) != (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay) {
            dedans = !dedans;
        }
    }
    dedans
}

/// Ce que `_cuivre_sous` a vu : l'ensemble { « antenne », « masse » }, ou rien.
#[derive(Clone, Copy, PartialEq, Default)]
struct Vu {
    antenne: bool,
    masse: bool,
}

const ANTENNE: Vu = Vu { antenne: true, masse: false };
const MASSE: Vu = Vu { antenne: false, masse: true };

/// Ce qu'il y a de cuivre en (x, y) sur cette couche : un ensemble de
/// « antenne » / « masse », vide s'il n'y a rien.
fn _cuivre_sous(cuivre: &[Bloc], couche: &str, x: f64, y: f64) -> Vu {
    let mut vu = Vu::default();
    for q in cuivre.iter().filter(|b| b.couche == couche).flat_map(|b| &b.polys) {
        let bx = _boite_pts(&q.o);
        if x < bx[0] || x > bx[2] || y < bx[1] || y > bx[3] {
            continue;
        }
        if !_point_dans_anneau(&q.o, x, y) {
            continue;
        }
        if q.t.iter().any(|t| _point_dans_anneau(t, x, y)) {
            continue;
        }
        if q.mixte {
            vu = Vu { antenne: true, masse: true };
        } else if q.m {
            vu.masse = true;
        } else {
            vu.antenne = true;
        }
    }
    vu
}

fn avis(rang: &str, titre: impl Into<String>, texte: impl Into<String>) -> Json {
    obj! {"rang" => rang, "titre" => titre.into(), "texte" => texte.into()}
}

// UN PORT DONT LES DEUX BORNES SONT LE MEME CONDUCTEUR NE MESURE RIEN. Il est
// court-circuite par le cuivre lui-meme : le solveur calcule jusqu'au bout et
// rend un S11 propre -- proche de -0 dB, ou une resonance qui n'est pas celle
// de l'antenne --, que rien ne distingue d'un vrai resultat. Le cas vu sur
// P01x274PCB-C.xml : une pastille fantome du net d'antenne recopiee sur la
// couche de masse, juste sous le port. On ne peut trancher que si la masse
// est connue (cuivre marque « m ») : sur un fichier sans connectivite, tout
// le cuivre est dans le meme sac et la question n'a pas de reponse -- on se
// tait plutot que de crier au loup.
fn _avis_ports_court_circuit(m: &Json, cuivre: &[Bloc]) -> Vec<Json> {
    let mut out = Vec::new();
    if !cuivre.iter().flat_map(|b| &b.polys).any(|q| q.m || q.mixte) {
        return out;
    }
    for p in liste(&m["ports"]) {
        if p["coax"].vrai() || txt(&p["dir"]) != "z" || !p["de"].vrai() || !p["a"].vrai() || p["de"] == p["a"] {
            continue;
        }
        let x = (f(&p["x1"]) + f(&p["x2"])) / 2.0;
        let y = (f(&p["y1"]) + f(&p["y2"])) / 2.0;
        let de = _cuivre_sous(cuivre, txt(&p["de"]), x, y);
        let a = _cuivre_sous(cuivre, txt(&p["a"]), x, y);
        for (nature, vu) in [("antenne", ANTENNE), ("masse", MASSE)] {
            if de == vu && a == vu {
                out.push(avis(
                    "grave",
                    format!("Le port {} relie {} a elle-meme", ent(&p["n"]),
                            if nature == "antenne" { "l'antenne" } else { "la masse" }),
                    format!("En ({:.3} ; {:.3}) mm, il y a du cuivre {} sur \
                             « {} » ET sur « {} » -- les deux bornes du \
                             port. Il est court-circuite par ce cuivre : le \
                             calcul ira au bout et rendra un S11 qui a l'air \
                             d'un resultat, sans rien dire de l'antenne. \
                             Deplacez le port la ou une borne touche \
                             l'antenne et l'autre la masse, ou changez la \
                             couche « vers » du port ; si ce cuivre ne \
                             devrait pas etre la (une pastille sur une couche \
                             ou le fichier n'en met pas), verifiez-le a \
                             l'etape « Le cuivre ».",
                            x, y, if nature == "antenne" { "de l'antenne" } else { "de la masse" },
                            txt(&p["de"]), txt(&p["a"]))));
            }
        }
    }
    out
}

// LE CONNECTEUR COAXIAL A AUSSI DEUX BORNES, et aucune n'etait verifiee. L'ame
// se raccorde a « de » sur l'axe, la gaine a « a » sur tout son tour. Une ame
// posee a cote du cuivre est un circuit ouvert ; une gaine dans une reserve de
// masse aussi. Le calcul va au bout dans les deux cas, et rend un S11 vers
// 0 dB que rien ne distingue d'une antenne desaccordee. La gaine est lue au
// milieu de son epaisseur, sur COAX_POINTS_GAINE points ; la page tient la
// meme regle (36-port-verdict.js, `antPortVerdictCoax`). Comme pour
// `_avis_ports_court_circuit`, ce qui distingue l'antenne de la masse n'est
// dit que si la masse est connue.
pub const COAX_POINTS_GAINE: usize = 16;

fn _avis_coax_contacts(m: &Json, cuivre: &[Bloc]) -> Vec<Json> {
    let mut out = Vec::new();
    let connue = cuivre.iter().flat_map(|b| &b.polys).any(|q| q.m || q.mixte);
    for p in liste(&m["ports"]) {
        let c = &p["coax"];
        if !c.vrai() {
            continue;
        }
        let (x, y, n, de, a) = (f(&p["x"]), f(&p["y"]), ent(&p["n"]), txt(&p["de"]), txt(&p["a"]));
        let ame = _cuivre_sous(cuivre, de, x, y);
        if ame == Vu::default() {
            out.push(avis(
                "grave",
                format!("L'ame du port {} ne touche aucun cuivre", n),
                format!("En ({:.3} ; {:.3}) mm, il n'y a pas de cuivre retenu \
                         sur « {} », la couche ou l'ame se raccorde. Le port \
                         est ouvert : le calcul ira au bout et rendra un S11 \
                         vers 0 dB. Posez le connecteur sur le cuivre de \
                         l'antenne.", x, y, de)));
        } else if connue && ame == MASSE {
            out.push(avis(
                "grave",
                format!("L'ame du port {} se raccorde a la masse", n),
                format!("En ({:.3} ; {:.3}) mm, le cuivre de « {} » est de la \
                         masse : l'ame et la gaine sont au meme potentiel, \
                         le connecteur est court-circuite.", x, y, de)));
        }
        let r = f(&c["rb"]) + f(&c["ep_gaine"]) / 2.0;
        let tour = |k: usize| 2.0 * std::f64::consts::PI * k as f64 / COAX_POINTS_GAINE as f64;
        let vus: Vec<Vu> = (0..COAX_POINTS_GAINE)
            .map(|k| _cuivre_sous(cuivre, a, x + r * tour(k).cos(), y + r * tour(k).sin())).collect();
        let vides = vus.iter().filter(|v| **v == Vu::default()).count();
        if connue && vus.contains(&ANTENNE) {
            out.push(avis(
                "grave",
                format!("La gaine du port {} touche l'antenne", n),
                format!("Sur « {} », autour du connecteur (rayon {:.3} mm), \
                         une partie du cuivre est celle de l'antenne : la \
                         gaine la met a la masse, et le connecteur est \
                         court-circuite par ce cuivre.", a, r)));
        } else if vides == vus.len() {
            out.push(avis(
                "grave",
                format!("La gaine du port {} ne touche aucun cuivre", n),
                format!("Sur « {} », il n'y a pas de cuivre retenu autour du \
                         connecteur (rayon {:.3} mm) : la gaine ne touche pas \
                         la masse, et le port est ouvert. Verifiez la couche \
                         « vers » du port, ou la reserve du plan de masse a \
                         cet endroit.", a, r)));
        } else if vides != 0 {
            out.push(avis(
                "attention",
                format!("La gaine du port {} ne touche la masse qu'en partie", n),
                format!("Sur « {} », {} points sur {} du tour de la gaine \
                         (rayon {:.3} mm) tombent hors du cuivre : un bord ou \
                         une reserve passe sous le connecteur. Le retour de \
                         courant fait alors un detour que le vrai connecteur \
                         ne fait pas.", a, vides, vus.len(), r)));
        }
    }
    out
}

fn _avis_ecarts_ouverts(m: &Json) -> Vec<Json> {
    let b = &m["ecarts_ouverts"];
    let n = ent(&b["x"]) + ent(&b["y"]);
    if n == 0 {
        return Vec::new();
    }
    let pc = reels(&m["estimation"]["plus_petite_cellule_mm"]);
    let elargies = if b["elargies"].vrai() {
        format!(" {} de ces lignes ont ensuite ete retirees ou deplacees \
                 pour elargir la plus petite cellule, le controle des \
                 ponts rejoue a chaque fois.", ent(&b["elargies"]))
    } else {
        String::new()
    };
    vec![avis(
        "info",
        format!("{} ecart(s) antenne-masse ouvert(s) par le maillage", ent(&b["sites"])),
        format!("Ils etaient plus etroits que la moitie d'une cellule : sans \
                 ligne dedans, openEMS aurait soude l'antenne a la masse. \
                 {} ligne(s) en x et {} en y y ont ete posees, deux par \
                 ecart, placees pour garder les cellules les plus larges \
                 possible ; le plus etroit fait {:.3} mm. \
                 Le prix : la plus petite cellule fait maintenant {:.3} x {:.3} \
                 mm dans le plan, et le pas de temps de tout le calcul la suit.{}",
                ent(&b["x"]), ent(&b["y"]), f(&b["plus_petit_ecart"]), pc[0], pc[1], elargies))]
}

fn _avis_ponts_de_maille(m: &Json) -> Vec<Json> {
    let sites = liste(&m["ponts_maille"]);
    let Some(s) = sites.first() else { return Vec::new() };
    let autres = &sites[1..sites.len().min(4)];
    let mut texte = format!(
        "Sur « {} », en ({:.3} ; {:.3}) mm, l'antenne et la masse sont \
         separees de {:.3} mm sur le dessin, et la grille y fait {:.3} x \
         {:.3} mm : aucune ligne ne tombe dans l'ecart, les deux cuivres \
         partagent un noeud, et openEMS les soude.",
        txt(&s["couche"]), f(&s["x"]), f(&s["y"]), f(&s["ecart"]), f(&s["cx"]), f(&s["cy"]));
    if !autres.is_empty() {
        texte += " Aussi : ";
        texte += &autres.iter()
            .map(|o| format!("« {} » ({:.2} ; {:.2}), {:.3} mm", txt(&o["couche"]), f(&o["x"]), f(&o["y"]), f(&o["ecart"])))
            .collect::<Vec<_>>().join(" ; ");
        if sites.len() > 4 {
            texte += &format!(" ; et {} autre(s)", sites.len() - 4);
        }
        texte += ".";
    }
    texte += &format!(" Le maillage n'a pas pu l'ouvrir lui-meme (ecart de moins de \
                       {:.3} mm, ou lignes ajoutees sans effet).", ECART_OUVRABLE_MM);
    texte += &format!(" Si ce cuivre est relie au port, le port verra un court-circuit : \
                       un S11 plat pres de 0 dB, une impedance d'entree de quelques \
                       ohms inductifs -- et le calcul ira au bout sans rien dire. Un \
                       morceau isole n'est que mis a la masse, sans \
                       consequence sur l'alimentation. Si ce cuivre n'est pas l'antenne \
                       (pastille d'un connecteur, d'un point de test), retirez-le de la \
                       selection ou posez le port ailleurs ; sinon affinez le maillage \
                       jusqu'a {:.3} mm au plus a cet endroit.", f(&s["ecart"]) / 2.0);
    vec![avis(
        "grave",
        format!("Le maillage soude l'antenne a la masse ({} endroit{})", sites.len(), if sites.len() > 1 { "s" } else { "" }),
        texte)]
}

/// « {:,} ».format(n).replace(",", " ") : les milliers separes d'une espace.
fn milliers(n: i64) -> String {
    let chiffres = n.unsigned_abs().to_string();
    let mut s = String::from(if n < 0 { "-" } else { "" });
    for (i, c) in chiffres.chars().enumerate() {
        if i > 0 && (chiffres.len() - i) % 3 == 0 {
            s.push(' ');
        }
        s.push(c);
    }
    s
}

/// ", ".join("« %s »" % n for n in noms)
fn entre_guillemets(noms: &[Json]) -> String {
    noms.iter().map(|n| format!("« {} »", py_str(n))).collect::<Vec<_>>().join(", ")
}

/// Les remarques de l'assistant : ce qui passera, ce qui coincera.
///
/// Chacune porte un rang -- « info », « attention », « grave » -- et dit ce
/// qu'il faut changer. Aucune n'empeche de lancer : l'utilisateur sait des
/// choses que ce module ne sait pas, a commencer par le temps dont il
/// dispose.
pub(super) fn _avis(m: &Json) -> Vec<Json> {
    let mut out = Vec::new();
    let cuivre = cuivre_de(m);
    let (b, est) = (&m["boite"], &m["estimation"]);
    let res_die = f(&m["resolution"]["die"]);
    let nmax = ent(&m["arret"]["nmax"]);
    let cellules_est = f(&est["cellules"]);
    let pl = |n: usize, un: &'static str, plusieurs: &'static str| if n > 1 { plusieurs } else { un };

    if !b["marge_suffisante"].vrai() {
        let texte = if f(&b["air_restant"]) <= 0.0 {
            format!("La couche absorbante mord DANS la structure : la marge \
                     fait {:.1} mm et la PML a elle seule en occupe {:.1} \
                     ({} cellules de {:.2} mm). Ce qui se trouve dans la PML \
                     n'est pas simule, il est mange — le resultat ne veut \
                     rien dire. Portez la marge a {:.1} mm.",
                    min_de([f(&b["mx"]), f(&b["my"]), f(&b["mz_haut"]), f(&b["mz_bas"])]),
                    f(&b["ep_pml"]), ent(&b["pml"]), f(&m["resolution"]["air"]),
                    f(&b["marge_conseil"]))
        } else {
            format!("Il ne reste que {:.1} mm d'air entre l'antenne et le \
                     debut de la PML ; il en faudrait {:.1}, soit un quart de \
                     la longueur d'onde a {} GHz. Trop pres, la PML absorbe \
                     du champ proche reactif qu'elle n'est pas faite pour \
                     absorber : l'impedance d'entree derive et la resonance \
                     se deplace, sans que rien ne le signale. Marge totale \
                     conseillee : {:.1} mm ({:.1} d'air + {:.1} de PML).",
                    f(&b["air_restant"]), f(&b["air_utile"]),
                    fmt_g(f(&m["bande"]["f1"]) / 1e9, 4), f(&b["marge_conseil"]),
                    f(&b["air_utile"]), f(&b["ep_pml"]))
        };
        out.push(avis("grave", "Marge d'air trop courte", texte));
    }

    if cellules_est > 20e6 {
        out.push(avis(
            "grave",
            "Maillage hors de portee",
            format!("{:.1} millions de cellules, soit {:.1} Go. Elargissez le \
                     pas de maillage, reduisez la bande vers le haut, ou \
                     restreignez la selection de cuivre.",
                    cellules_est / 1e6, f(&est["memoire_Mo"]) / 1024.0)));
    } else if cellules_est > 5e6 {
        out.push(avis(
            "attention",
            "Maillage lourd",
            // PLUS DE DUREE ANNONCEE ICI. Le nombre de cellules ne suffit pas
            // a la deduire -- il y manque le pas de temps, donc le nombre de
            // pas -- et « dizaines de minutes » se lisait juste au-dessus d'un
            // avis qui disait 3 h 26 sur le meme maillage. C'est l'avis de
            // duree qui repond a cette question, et lui seul.
            format!("{:.1} millions de cellules, environ {:.0} Mo.", cellules_est / 1e6, f(&est["memoire_Mo"]))));
    }

    // LA DUREE, ENFIN DITE POUR UN CALCUL SEUL -- voir DUREE_AVIS_S.
    let secondes = duree_estimee(m);
    if secondes >= DUREE_AVIS_S {
        let debit = if est["mcps_mesure"].vrai() {
            format!("mesure sur ce poste{}",
                    if est["mcps_ramene"].vrai() { format!(" et ramene a {} fils", ent(&est["fils"])) } else { String::new() })
        } else {
            "suppose".to_string()
        };
        out.push(avis(
            if secondes >= 4.0 * DUREE_AVIS_S { "attention" } else { "info" },
            if secondes >= 3600.0 { "Ce calcul se comptera en heures" } else { "Ce calcul prendra un moment" },
            format!("Environ {} : {:.1} million(s) de cellules x {} pas de \
                     temps, au debit {} de {:.0} MC/s. LES DEUX FACTEURS SE \
                     MULTIPLIENT -- une cellule deux fois plus fine, c'est \
                     deux fois plus de cellules ET deux fois plus de pas, \
                     parce que le nombre de pas suit le pas de temps.",
                    _duree_texte(secondes), cellules_est / 1e6,
                    milliers(nmax), debit, ou(f(&est["mcps_suppose"]), MCPS))));
    }

    let petite = f(&est["cellule"]["mm"]);
    let axe = txt(&est["cellule"]["axe"]);
    let plancher = f(&m["maillage_detail"]["plancher"][axe]);
    // Un modele d'avant `maillage_detail["plancher"]` -- un projet relu, par
    // exemple -- retombe sur l'ancien repere plutot que de ne rien dire.
    let sous = if plancher > 0.0 { petite < plancher * CELLULE_AVIS_MARGE } else { petite < res_die / 20.0 };
    if sous {
        out.push(avis(
            "attention",
            "Une cellule minuscule ralentit tout",
            format!("La plus petite cellule fait {:.4} mm en {}, soit {:.0} \
                     fois moins que le pas vise{}. Le pas de temps FDTD est \
                     commande par elle SEULE, et le nombre de pas suit le \
                     pas de temps : elle se paie DEUX FOIS. {}",
                    petite, axe,
                    res_die / maxi(petite, 1e-9),
                    if plancher > 0.0 {
                        format!(" et {:.0} fois sous le plancher que la grille \
                                 s'est donne sur cet axe ({:.4} mm)",
                                plancher / maxi(petite, 1e-9), plancher)
                    } else {
                        String::new()
                    },
                    _cause_cellule(m))));
    }

    let ecartes: Vec<&Json> = liste(&m["revetements"]).iter().filter(|r| !r["garde"].vrai()).collect();
    if !ecartes.is_empty() {
        // LE PLURIEL SE DECLINE, PARCE QU'UN AVIS SE LIT. Un masque de soudure
        // arrive presque toujours par DEUX -- une face et l'autre --, et « la
        // couche reste dans la fiche » sur deux couches est la petite negligence
        // qui fait douter du reste du texte.
        let n = ecartes.len();
        let mince = min_de(ecartes.iter().map(|r| f(&r["ep"])));
        out.push(avis(
            "info",
            pl(n, "Revetement exterieur hors du maillage", "Revetements exterieurs hors du maillage"),
            format!("{} pose{} sur le cuivre exterieur, ecarte{} du \
                     modele : {} dans la fiche mais pas dans la geometrie. \
                     {} deux faces porteraient deux lignes de maillage a \
                     {:.4} mm l'une de l'autre, soit {:.0} fois moins que le \
                     pas vise, et cette cellule-la commanderait le pas de \
                     temps de TOUTE la simulation -- un facteur huit sur la \
                     duree, mesure sur une carte de quatre millions de \
                     cellules. Ce qu'{} apporterai{} en echange est du \
                     second \
                     ordre : une permittivite posee au-dessus du ruban, sur \
                     un vingt-cinquieme de la hauteur du substrat. L'etape \
                     « L'empilage » laisse {} remettre si {} compte{} -- un \
                     coverlay de flex, un radome mince.",
                    ecartes.iter().map(|r| format!("« {} » ({:.4} mm)", txt(&r["nom"]), f(&r["ep"]))).collect::<Vec<_>>().join(", "),
                    pl(n, "", "s"),
                    pl(n, "", "s"),
                    pl(n, "la couche reste", "les couches restent"),
                    pl(n, "Ses", "Leurs"),
                    mince, res_die / maxi(mince, 1e-9),
                    pl(n, "elle", "elles"),
                    pl(n, "t", "ent"),
                    pl(n, "la", "les"),
                    pl(n, "elle", "elles"),
                    pl(n, "", "nt"))));
    }

    if txt(&m["modele_cuivre"]) == "volume" {
        out.push(avis(
            "attention",
            "Cuivre modelise en volume",
            "L'epaisseur du cuivre (quelques dizaines de microns) \
             entre dans le maillage et commande le pas de temps. A \
             2,4 GHz l'epaisseur de peau fait 1,3 micron : le \
             courant ne voit pas cette epaisseur, et le mode \
             « feuille » donne le meme resultat en une fraction du \
             temps. Ne gardez « volume » que si la geometrie de la \
             tranche compte — une fente etroite, un couplage par le \
             flanc."));
    } else if txt(&m["modele_cuivre"]) == "pec" {
        out.push(avis(
            "info",
            "Cuivre suppose parfait",
            "Sans pertes ohmiques, le rendement ressort surestime et \
             la resonance plus pointue qu'en realite. C'est le bon \
             mode pour degrossir une geometrie, pas pour annoncer un \
             gain."));
    }

    // -- une cote de port qui n'etait pas sur une ligne --------------------
    // ELLE DEVRAIT TOUJOURS L'ETRE : les faces des ports sont posees en lignes
    // OBLIGATOIRES, et une obligatoire ne cede jamais. Un deplacement plus
    // grand qu'un arrondi veut donc dire qu'une de ces lignes a disparu en
    // route -- et une boite d'excitation plate qui n'est pas sur une ligne
    // n'excite RIEN, pour un calcul qui va au bout et rend une energie nulle.
    let colle = f(&m["ports_colles_mm"]);
    if colle > 1e-6 {
        out.push(avis(
            "grave",
            "Une cote de port n'etait pas sur une ligne de maillage",
            format!("Elle a ete deplacee de {} mm pour y tomber. Les faces \
                     d'un port sont pourtant posees en lignes obligatoires : \
                     un tel ecart signale que l'une d'elles a ete perdue. \
                     Verifiez la position du port -- une boite d'excitation \
                     qui n'est pas sur une ligne n'excite rien du tout, et \
                     le calcul va au bout en rendant une energie nulle.",
                    fmt_g(colle, 4))));
    }

    // -- les ports ---------------------------------------------------------
    let ports = liste(&m["ports"]);
    if m["reseau"].vrai() {
        let excites: Vec<&Json> = ports.iter().filter(|p| p["excite"].vrai()).collect();
        let dephase = ports.iter().any(|p| f(&p["retard_s"]) > 0.0);
        let phases = if !dephase {
            " Tous en phase.".to_string()
        } else {
            format!(" Phases d'excitation : {} -- realisees par un \
                     RETARD de l'impulsion, exactes a la frequence \
                     visee.",
                    excites.iter().map(|p| format!("port {} a {} deg", ent(&p["n"]), fmt_g(py::round(f(&p["phase"]), 1), 6)))
                        .collect::<Vec<_>>().join(", "))
        };
        out.push(avis(
            "info",
            format!("{}, pas un tableau S", if dephase { "Un reseau dephase" } else { "Un reseau alimente en phase" }),
            format!("Les ports {} excitent ensemble, a la meme amplitude. \
                     Ce qui revient a chacun est son \
                     coefficient de reflexion ACTIF -- ce qu'il voit quand \
                     tous emettent, couplages compris --, et non un S11 : \
                     le « S11 » affiche est celui actif du port {}. Le \
                     diagramme est celui du reseau entier.{}",
                    excites.iter().map(|p| ent(&p["n"]).to_string()).collect::<Vec<_>>().join(", "),
                    excites.first().map_or(0, |p| ent(&p["n"])), phases)));
    } else if ports.len() > 1 {
        let exc = ports.iter().find(|p| p["excite"].vrai()).map_or(0, |p| ent(&p["n"]));
        let autres: Vec<i64> = ports.iter().filter(|p| !p["excite"].vrai()).map(|p| ent(&p["n"])).collect();
        let rendus = std::iter::once(&exc).chain(&autres).map(|n| format!("S{}{}", n, exc)).collect::<Vec<_>>().join(", ");
        let manquants = autres.iter().map(|n| format!("S{}{}", n, n)).collect::<Vec<_>>().join(", ");
        out.push(avis(
            "info",
            "Une colonne du tableau S, pas le tableau",
            format!("Le port {} excite ; {} en charge. Cette simulation rend \
                     donc {} — ce qui sort de chaque port pendant que \
                     celui-la emet, et rien d'autre. {} demande{} une seconde \
                     simulation, l'excitation deplacee : c'est la definition \
                     d'un parametre S, pas une limite de l'outil. Le bouton \
                     « Tableau S complet » enchaine ces {} simulations et \
                     range les colonnes ensemble — la duree est multipliee \
                     par {}.",
                    exc,
                    autres.iter().map(|n| format!("le {}", n)).collect::<Vec<_>>().join(", "),
                    rendus, manquants,
                    pl(autres.len(), "", "nt"),
                    ports.len(), ports.len())));
    }

    for p in ports {
        let c = &p["coax"];
        if !c.vrai() {
            continue;
        }
        let (n, r) = (ent(&p["n"]), f(&p["R"]));
        let ecart = 100.0 * (f(&c["z0_ligne"]) - r).abs() / maxi(r, 1e-9);
        if ecart > 5.0 {
            out.push(avis(
                if ecart < 20.0 { "attention" } else { "grave" },
                format!("Le coaxial du port {} ne fait pas {:.0} ohms", n, r),
                format!("Sa geometrie donne {:.1} ohms : 60/racine({:.2}) . \
                         ln({:.3}/{:.3}). Un coaxial n'est a l'impedance voulue \
                         que par le RAPPORT de ses deux rayons, et cet ecart \
                         de {:.0} % n'est pas une erreur de calcul — c'est une \
                         desadaptation reelle, qui se lira dans le S11 comme \
                         si elle venait de l'antenne. Une SMA ordinaire fait \
                         a = 0,635 et b = 2,05 mm dans du PTFE.",
                        f(&c["z0_ligne"]), f(&c["er"]), f(&c["rb"]), f(&c["ra"]), ecart)));
        }
        // L'AME EST RONDE DANS UNE GRILLE CARREE. Si la maille est plus large
        // que son diametre, le cylindre est rendu par les cellules qui
        // l'approchent : il grossit, maigrit, ou disparait -- et le port
        // n'excite plus rien. La borne est ici le rayon, parce qu'il faut au
        // moins deux cellules dans le diametre pour que le rond soit un rond.
        if f(&c["ra"]) < res_die {
            out.push(avis(
                "attention",
                format!("L'ame du port {} est plus fine que la maille", n),
                format!("Rayon {:.3} mm contre un pas de {:.3} mm dans le \
                         dielectrique. Le maillage pose bien une ligne sur \
                         chaque rayon, mais entre deux lignes il n'y a rien : \
                         l'ame sera rendue par une ou deux cellules, et son \
                         inductance avec. Resserrez le maillage, ou prenez un \
                         connecteur plus gros.",
                        f(&c["ra"]), res_die)));
        }
        if !c["degagements"].vrai() {
            out.push(avis(
                "info",
                format!("Aucun degagement pour le port {}", n),
                "L'ame ne traverse aucune couche de cuivre autre que \
                 la sienne : rien a percer. C'est normal sur un \
                 empilage a deux couches ou la masse est du meme \
                 cote ; cela ne l'est pas si vous attendiez un \
                 connecteur qui traverse la carte."));
        }
    }

    out.extend(_avis_ports_court_circuit(m, &cuivre));
    out.extend(_avis_coax_contacts(m, &cuivre));
    out.extend(_avis_ecarts_ouverts(m));
    out.extend(_avis_ponts_de_maille(m));

    // -- les pertes dielectriques -----------------------------------------
    let p = &m["pertes"];
    if txt(&p["mode"]) == "kappa" && f(&p["ecart_kappa_pc"]) > 8.0 {
        out.push(avis(
            if f(&p["ecart_kappa_pc"]) < 40.0 { "attention" } else { "grave" },
            "Les pertes ne sont justes qu'a une frequence",
            format!("La conductivite equivalente est calculee a {} GHz. \
                     Ailleurs, tan(delta) varie comme 1/f alors qu'un \
                     stratifie reel le garde a peu pres constant : aux bords \
                     de la bande l'ecart atteint {:.0} %. Passez au modele de \
                     Debye, ou resserrez la bande.",
                    fmt_g(f(&p["f_kappa"]) / 1e9, 4), f(&p["ecart_kappa_pc"]))));
    }
    if p["replis"].vrai() {
        out.push(avis(
            "attention",
            "Debye impossible, retour a la conductivite",
            format!("Pour {}, le pas de temps ({} s) ne laisse pas de place \
                     a un jeu de poles : openEMS ignore tout pole plus rapide \
                     que deux pas de temps. C'est kappa qui s'applique, avec \
                     l'erreur que cela suppose. Un maillage plus fin — donc \
                     un pas de temps plus court — rouvrirait la porte.",
                    entre_guillemets(liste(&p["replis"])),
                    fmt_g(f(&m["estimation"]["dt_s"]), 3))));
    } else if p["actif"].vrai() {
        let bornes: Vec<Json> = liste(&m["dielectriques"]).iter()
            .filter(|d| d["debye"].vrai() && d["debye"]["borne_par_dt"].vrai()).map(|d| d["nom"].clone()).collect();
        out.push(avis(
            if f(&p["ecart_debye_pc"]) > 5.0 { "attention" } else { "info" },
            "Pertes large bande (Debye)",
            format!("tan(delta) est tenu a {:.2} % pres sur toute la bande \
                     (mesure sur le jeu de poles retenu, pas promis).{} \
                     Ce materiau n'est pas construit par les liaisons \
                     Python d'openEMS, qui ne les exposent pas : le script \
                     ecrit le XML de CSXCAD et le relit. C'est documente \
                     dans le script lui-meme.",
                    f(&p["ecart_debye_pc"]),
                    if bornes.is_empty() {
                        String::new()
                    } else {
                        format!(" Les poles les plus rapides ont ete ramenes a trois \
                                 pas de temps pour {} — la borne en dessous de \
                                 laquelle openEMS les sauterait ; l'ecart ci-dessus en \
                                 tient compte.", entre_guillemets(&bornes))
                    })));
    }

    let d = &m["dumps"];
    if d["actif"].vrai() {
        let mo = f(&d["octets"]) / 1048576.0;
        if txt(&d["mode"]) == "temporel" {
            out.push(avis(
                if mo > 20000.0 { "grave" } else { "attention" },
                format!("Enregistrement temporel : {} sur le disque",
                        if mo > 1024.0 { format!("{:.1} Go", mo / 1024.0) } else { format!("{:.0} Mo", mo) }),
                "openEMS ecrit un fichier PAR PAS DE TEMPS, pas par \
                 frequence. Le temporel ne sert qu'a faire une \
                 animation ; pour voir ou passe le courant, le mode \
                 frequentiel rend la meme information en quelques \
                 mega-octets."));
        } else if mo > 200.0 {
            out.push(avis(
                "attention",
                format!("Enregistrement volumineux ({:.0} Mo)", mo),
                "Reduisez la region, ou augmentez le sous-\
                 echantillonnage : un champ vu une cellule sur deux \
                 se lit aussi bien et pese huit fois moins."));
        }
    }

    // -- ce qui a ete simplifie sans rien changer a la physique ------------
    let n_abs = ent(&m["stats"]["absorbes"]);
    if n_abs != 0 {
        out.push(avis(
            "info",
            format!("{} polygone(s) recouvert(s) retire(s)", n_abs),
            "Pastilles et pistes posees DANS un plan de la meme \
             couche : le metal est le meme avec ou sans elles, \
             mais leurs aretes posaient des lignes de maillage qui \
             ne decrivaient rien."));
    }
    let mc = &m["masse_cachee"];
    // Le cuivre d'antenne du cote cache garde la masse qui l'entoure : la
    // phrase qui le dit sert aux deux avis ci-dessous.
    let tries = |o: &Json| -> Vec<(String, Json)> {
        let mut t: Vec<(String, Json)> = o.as_objet().map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default();
        t.sort_by(|a, b| a.0.cmp(&b.0));
        t
    };
    let mut proches = String::new();
    if mc["gardes_proches"].vrai() {
        proches = format!(" {} polygone(s) de masse sont gardes quand meme, a moins \
                           de {:.0} mm du cuivre d'antenne retenu de ce cote-la -- {} \
                           -- qu'ils bordent. Si ce cuivre ne rayonne pas (la piste \
                           qui repart vers la radio, la pastille d'un point de test), \
                           retirez-le de la selection a l'etape « Le cuivre » : cette \
                           masse-la partira aussi.",
                          ent(&mc["gardes_proches"]), PROCHE_ANTENNE_MM,
                          tries(&mc["antenne_derriere"]).iter().map(|(c, a)| format!("« {} » ({:.1} mm2)", c, f(a)))
                              .collect::<Vec<_>>().join(", "));
    }
    if mc["retires"].vrai() {
        out.push(avis(
            "info",
            format!("Masse cachee par « {} » retiree", py_str(&mc["reference"])),
            format!("{} : cuivre de masse entierement derriere le plan de \
                     reference, que l'antenne ne voit pas -- un plan de \
                     cuivre plein est opaque a ces frequences. Ce qui \
                     deborde du plan est garde. Les vias de couture \
                     s'arretent a la derniere couche gardee ; {}, qui ne \
                     reliaient plus deux couches gardees, sont retires. \
                     Ecart attendu : faible, par les seuls trous du plan. \
                     Cochez « Garder toute la masse » a l'etape « Le \
                     cuivre » pour comparer.{}",
                    tries(&mc["retires"]).iter().map(|(c, n)| format!("« {} » ({} polygone(s))", c, ent(n)))
                        .collect::<Vec<_>>().join(", "),
                    ent(&mc["vias_retires"]), proches)));
    } else if !proches.is_empty() {
        out.push(avis(
            "info",
            format!("Masse gardee derriere « {} »", py_str(&mc["reference"])),
            format!("Le port prend sa masse sur « {} », et du cuivre \
                     d'antenne retenu est aussi de l'autre cote.{}", py_str(&mc["reference"]), proches)));
    }
    if m["empilage_reduit"].vrai() {
        out.push(avis(
            "info",
            "Empilage simplifie",
            format!("{} : aucun cuivre, via ni port retenu, entre deux \
                     dielectriques identiques. Les deux sont fusionnes en \
                     un seul -- meme epaisseur totale, meme Dk, meme Df --, \
                     et le maillage en z s'allege d'autant.",
                    entre_guillemets(liste(&m["empilage_reduit"])))));
    }

    // -- les polygones degeneres, ecartes a l'entree -----------------------
    let n_deg = ent(&m["stats"]["degeneres"]);
    if n_deg != 0 {
        out.push(avis(
            "info",
            format!("{} polygone(s) degenere(s) ecarte(s)", n_deg),
            format!("Moins de {:.0} micron de large : des restes d'export \
                     (rayons de pastilles thermiques, contours aplatis), \
                     pas du cuivre. openEMS les aurait ignores ; ils ne \
                     faussent plus le maillage.", LARGEUR_DEGENEREE_MM * 1000.0)));
    }

    // -- le cuivre trop fin pour le maillage -------------------------------
    // UN POLYGONE PLUS PETIT QU'UNE CELLULE NE DISPARAIT PAS AVEC FRACAS : il
    // disparait, voila tout. openEMS le signale par un « Warning: Unused
    // primitive » noye au milieu de trois cents lignes de demarrage, et le
    // calcul continue sans lui. Une pastille d'alimentation evaporee, et le
    // port n'est plus relie a rien — pour un S11 qui a toujours l'air d'un S11.
    // LE COMPTE VIENT DU BILAN PAR POLYGONE, chacun mesure contre LA GRILLE
    // QUI LE CONCERNE : une piste prise dans une bande fine n'est pas plus fine
    // que sa maille, et la compter ici envoyait chercher un probleme resolu.
    let det = &m["resolution"]["detail"];
    let pistes = &det["pistes"];
    let pas_fin = f(&det["fin"]);
    if pistes["ignores"].vrai() {
        out.push(avis(
            "attention",
            format!("{} polygone(s) plus fins que la maille", ent(&pistes["ignores"])),
            format!("Le plus petit fait {:.3} mm de large, pour une maille de \
                     {:.3} mm a cet endroit-la. openEMS les ignorera en \
                     silence — il l'ecrit une fois dans son journal, au \
                     milieu du demarrage. Si l'un d'eux est la pastille du \
                     port, le port n'excitera plus rien. Affinez le \
                     maillage, ou verifiez que ces polygones-la ne portent \
                     rien d'essentiel.",
                    f(&pistes["ignore_mm"]), ou(pas_fin, res_die))));
    }

    if m["supposes"].vrai() {
        out.push(avis(
            "info",
            "Valeurs completees faute de mieux",
            format!("Le fichier ne les declare pas : {}. Une permittivite devinee \
                     deplace la resonance de plusieurs pour cent — \
                     corrigez-la si vous la connaissez.",
                    liste(&m["supposes"]).iter().map(py_str).collect::<Vec<_>>().join(", "))));
    }

    // UNE ANTENNE EQUILIBREE -- un dipole, un bras par face -- n'a ni masse ni
    // vias, et c'est voulu. On la reconnait a ses ports : chacun relie deux
    // couches qui portent TOUTES DEUX du cuivre d'antenne. Une masse oubliee
    // dans la selection, elle, laisse la couche d'arrivee du port vide -- et
    // les deux avis restent.
    let masses = cuivre.iter().any(|c| c.role == "gnd" || c.role == "masse");
    let avec_cuivre = |couche: &str| cuivre.iter().any(|c| c.couche == couche && !c.polys.is_empty());
    let equilibree = !masses && ports.iter().filter(|p| p["excite"].vrai())
        .all(|p| avec_cuivre(txt(&p["de"])) && avec_cuivre(txt(&p["a"])) && p["de"] != p["a"]);

    if !m["vias"].vrai() && !equilibree {
        out.push(avis(
            "info",
            "Aucun via dans le modele",
            "Si l'antenne a une masse sur une autre couche que son \
             cuivre rayonnant, les vias qui les relient font partie \
             de la structure : sans eux le chemin de retour n'existe \
             pas et le S11 est faux."));
    }

    if !masses && !equilibree {
        out.push(avis(
            "attention",
            "Pas de plan de masse dans la selection",
            "Une antenne imprimee rayonne CONTRE quelque chose. Si \
             le plan de masse est le contrepoids, il doit etre dans \
             le modele, sur toute son etendue reelle : le tronquer \
             change le diagramme et l'impedance."));
    }

    // -- l'impulsion a-t-elle seulement le temps de sortir ? -----------------
    // openEMS pose la question lui-meme dans son journal, une fois la
    // simulation lancee et le temps deja engage. On la pose ici, avant.
    let dt = f(&est["dt_s"]);
    let t_exc = f(&m["bande"]["t_excitation"]);
    let nmax_auto = m["arret"]["nmax_auto"].vrai();
    if dt > 0.0 && t_exc > 0.0 && !nmax_auto {
        let pas_exc = t_exc / dt;
        let mini_pas = (3.0 * pas_exc).ceil() as i64;
        if nmax < mini_pas {
            out.push(avis(
                "attention",
                "Le calcul s'arretera avant la fin de l'impulsion",
                format!("L'impulsion d'excitation dure a elle seule {} pas \
                         de temps ({:.2} ns). Le garde-fou est a {} pas, soit \
                         {:.1} fois cette duree ; openEMS en demande trois, et \
                         en dessous ce n'est plus une mesure mais une \
                         troncature — la transformee lit une impulsion \
                         coupee. Portez le nombre de pas a {} au moins.",
                        pas_exc as i64, t_exc * 1e9, nmax,
                        nmax as f64 / pas_exc, mini_pas)));
        }
    }

    // -- un garde-fou impose plus court que la decroissance attendue --------
    // CE N'EST PAS UN REFUS, C'EST UN CHIFFRE A COTE D'UN AUTRE. Le nombre
    // saisi peut etre le bon -- une antenne large bande s'eteint vite. Mais
    // quand il est plus court que ce que le modele calcule, le calcul a des
    // chances de finir sur le compteur au lieu de finir sur l'energie, et
    // cela ne se voit qu'apres coup, dans le rapport.
    let calc = ent(&m["arret"]["nmax_calcule"]);
    if !nmax_auto && calc != 0 && (nmax as f64) < calc as f64 * 0.95 {
        let det = &m["arret"]["nmax_detail"];
        out.push(avis(
            "attention",
            "Le garde-fou est plus court que la decroissance attendue",
            format!("Le compteur est a {} pas ; le modele en calcule {} pour \
                     ce maillage — {} pour emettre l'impulsion, {} pour \
                     laisser l'antenne s'eteindre ({:.0} periodes a {:.3} GHz, \
                     soit environ -40 dB pour un Q charge ordinaire). Si \
                     l'energie n'est pas descendue avant, la simulation \
                     s'arretera sur le compteur et la transformee lira une \
                     reponse coupee. Laissez le champ a zero pour que le \
                     nombre suive le maillage.",
                    nmax, calc,
                    ent(&det["impulsion"]), ent(&det["decroissance"]),
                    ou(f(&det["periodes"]), NMAX_PERIODES),
                    f(&det["f_res"]) / 1e9)));
    }

    // -- des aretes ont-elles ete confondues pour le maillage ? --------------
    // ON LE DIT PLUTOT QUE DE S'EN FELICITER EN SILENCE. Le regroupement fait
    // gagner un facteur quatre sur un dessin ordinaire, mais il signale aussi
    // un dessin qui porte des bords presque confondus — deux rubans de largeurs
    // voisines sur le meme axe, un arrondi de bout de piste. Les voir est utile
    // a qui dessine, et les taire reviendrait a corriger le dessin de quelqu'un
    // sans le lui dire.
    let md = &m["maillage_detail"];
    if md["aretes_groupees"].vrai() {
        out.push(avis(
            "info",
            "Des aretes de cuivre ont ete confondues pour le maillage",
            format!("{} bord(s) se trouvaient a moins de {:.3} mm d'un autre \
                     et ne recoivent qu'un seul jeu de lignes. LE CUIVRE, LUI, \
                     GARDE SES COTES : seule la grille est simplifiee. Sans \
                     cela, chacun poserait ses lignes au tiers et deux cellules \
                     minuscules en resulteraient — or la plus petite cellule du \
                     domaine commande le pas de temps de toute la simulation.",
                    ent(&md["aretes_groupees"]), f(&md["eps_aretes"]))));
    }

    // -- le cuivre le plus fin est-il resolu ? -------------------------------
    // CET AVIS NE REGARDE PLUS QUI A CHOISI LE PAS, ET C'EST UNE CORRECTION.
    // Il ne sortait qu'en mode automatique : un pas saisi a la main etait
    // repute assume, donc tu. C'etait exactement le cas a ne pas taire — un
    // pas de 0,80 mm entre a la main pour des brins de 1,00 mm ne fait qu'UNE
    // cellule en travers du cuivre, la resonance part plusieurs pour cent trop
    // haut, et rien ne le disait. Le pas saisi reste saisi : on ne le corrige
    // pas, on le commente.
    let largeur = f(&pistes["largeur"]);
    let cellules = f(&pistes["cellules"]);

    // -- l'affinage local a eu lieu : on le dit ----------------------------
    // UN MAILLAGE A DEUX PAS NE SE LIT PAS SUR LE SEUL « PAS DE MAILLAGE ». La
    // page affiche le fond ; sans cet avis, personne ne saurait qu'une piste
    // de 0,5 mm est maillee cinq fois plus fin que la carte qui la porte, ni ce
    // que cela a coute.
    if pas_fin > 0.0 {
        let (cout, fond) = (f(&det["cout"]), f(&det["cout_fond"]));
        let borne = if det["fin_borne"].vrai() {
            format!(" Le budget a arrete l'affinage la : pour {} cellules en \
                     travers du cuivre le plus etroit il faudrait descendre a \
                     {:.3} mm, et le calcul coutait alors plus de {} fois le \
                     maillage de fond.",
                    fmt_g(CELLULES_PAR_PISTE, 6), f(&det["fin_voulu"]),
                    fmt_g(AFFINAGE_COUT_MAX, 6))
        } else {
            String::new()
        };
        out.push(avis(
            "info",
            "Maillage affine en travers du cuivre etroit",
            format!("Le fond reste a {:.3} mm — c'est ce que l'emprise du \
                     cuivre permet — mais {} bande(s) en x et {} en y \
                     descendent a {:.3} mm. Elles sont posees EN TRAVERS des \
                     pistes trop fines pour le fond, et sur ce seul axe : le \
                     champ tourne sur la largeur d'un ruban, pas sur sa \
                     longueur, et raffiner les deux axes couterait quarante \
                     fois plus de lignes pour la meme physique. Le plus mal \
                     resolu des polygones a maintenant {:.1} cellules en \
                     travers. Prix : {:.1} fois le maillage de fond.{}",
                    res_die, ent(&md["bandes_x"]),
                    ent(&md["bandes_y"]), pas_fin, cellules,
                    if fond > 0.0 { cout / fond } else { 1.0 }, borne)));
    }

    // -- ce qui reste mal resolu, et pourquoi ------------------------------
    if largeur > 0.0 && cellules < CELLULES_PAR_PISTE * 0.999 {
        let cause = if det["saisi"].vrai() {
            format!("Le pas est celui que vous avez saisi : {:.3} mm. \
                     Mettez-le a {:.3} mm pour resoudre ce cuivre, ou \
                     rendez-le automatique en le remettant a zero.",
                    res_die, largeur / CELLULES_PAR_PISTE)
        } else if pas_fin > 0.0 || det["fin_borne"].vrai() {
            format!("Le maillage est deja affine en travers du cuivre \
                     etroit, et c'est le BUDGET qui arrete l'affinage : \
                     au-dela, le nombre de cellules et le nombre de pas de \
                     temps faisaient plus de {} fois le maillage de fond. \
                     Retirez de la selection le cuivre qui ne rayonne pas — \
                     c'est lui qui paie, chaque piste fine coutant sa propre \
                     bande.", fmt_g(AFFINAGE_COUT_MAX, 6))
        } else {
            format!("Le maillage s'arrete a {:.3} mm — c'est le pas en \
                     dessous duquel l'emprise du cuivre demanderait plus de \
                     {} lignes par axe, et le calcul ne finirait pas. \
                     Retirez ce cuivre de la selection s'il ne rayonne pas.",
                    f(&det["plancher"]), LIGNES_MAX_EMPRISE as i64)
        };
        out.push(avis(
            "attention",
            "Le cuivre le plus fin n'est pas resolu",
            format!("Le plus mal resolu des polygones retenus fait {:.3} mm \
                     de large ; il en faudrait {} cellules en travers, et il \
                     n'en a que {:.1}. Un ruban rendu par une cellule ou deux \
                     n'a pas la largeur qu'on a dessinee : son impedance \
                     n'est pas la bonne, et sa resonance sort trop haut. {}",
                    largeur, fmt_g(CELLULES_PAR_PISTE, 6), cellules, cause)));
    }

    // UNE PIECE TOURNEE HORS DES QUARTS DE TOUR PAR RAPPORT A LA GRILLE. Ses
    // parois ne sont plus alignees sur les lignes : elles sont vues en
    // marches d'escalier, et une paroi mince n'y porte plus de ligne de
    // maillage (`_plans` ne retient que les faces alignees) -- elle est vue a
    // moitie ou pas du tout selon l'endroit ou elle tombe. C'est le cas d'un
    // boitier dans lequel on a tourne la CARTE de 30 degres : le solveur, lui,
    // voit le boitier tourne de -30.
    for p in liste(&m["pieces"]) {
        if !liste(&p["corps"]).iter().any(|c| txt(&c["materiau"]) != "ignore") {
            continue;
        }
        let biais: Vec<f64> = reels(&p["rotation"]).into_iter()
            .filter(|v| (v / 90.0 - (v / 90.0).round_ties_even()).abs() > 1e-6).collect();
        if !biais.is_empty() {
            out.push(avis(
                "attention",
                "Piece de biais dans la grille",
                format!("« {} » est tournee de {} degres par rapport a la \
                         carte : ses parois ne sont plus alignees sur la \
                         grille, qui suit toujours la carte. Elles y sont \
                         vues en marches d'escalier, et une paroi mince n'y \
                         porte plus de ligne de maillage. Preferez des \
                         quarts de tour entre la carte et son boitier.",
                        txt(&p["nom"]), biais.iter().map(|v| fmt_g(*v, 6)).collect::<Vec<_>>().join(", "))));
        }
    }

    out
}
