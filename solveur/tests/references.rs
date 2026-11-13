//! Les references figees du Python (essais/ref/, produites par essais/outils/banc_numpy.py) :
//! pour chaque cas, la structure que le script posait par les liaisons CSXCAD et les vraies
//! classes de ports d'openEMS 0.0.36, et le resultats.json que numpy tirait de sondes de
//! synthese. Le XML ecrit ici doit porter la meme structure, cote pour cote, et le
//! depouillement rendre les memes nombres.

use std::path::Path;

use antenne_modele::{json_depuis_texte, modele, obj, Json};
use antenne_solveur::{depouillement, hdf5, xml};

fn json(chemin: &Path) -> Json {
    json_depuis_texte(&std::fs::read_to_string(chemin).unwrap_or_else(|e| panic!("{} : {e}", chemin.display()))).unwrap()
}

fn nombres(texte: &str) -> Json {
    Json::Liste(texte.split(',').map(|v| Json::Flottant(v.parse().unwrap_or_else(|_| panic!("nombre illisible « {v} »")))).collect())
}

fn nb(n: roxmltree::Node, cle: &str) -> Json {
    Json::Flottant(n.attribute(cle).unwrap_or_else(|| panic!("{cle} absent de <{}>", n.tag_name().name())).parse().unwrap())
}

fn enfant<'a>(n: roxmltree::Node<'a, 'a>, nom: &str) -> Option<roxmltree::Node<'a, 'a>> {
    n.children().find(|c| c.has_tag_name(nom))
}

fn poser(o: &mut Json, cle: &str, v: Json) {
    if let Json::Objet(o) = o {
        o.insert(cle.into(), v);
    }
}

/// Le XML, ramene a la forme que note le faux CSXCAD du banc numpy.
fn structure(texte: &str) -> Json {
    let d = roxmltree::Document::parse(texte).expect("XML mal forme");
    let props = d.descendants().find(|n| n.has_tag_name("Properties")).unwrap();
    let mut out = Vec::new();
    for (rang, e) in props.children().filter(|n| n.is_element()).enumerate() {
        assert_eq!(e.attribute("ID"), Some(rang.to_string().as_str()));
        let g = e.tag_name().name();
        let mut a = obj! {};
        match g {
            "Material" | "DebyeMaterial" => {
                let pr = enfant(e, "Property").unwrap();
                for at in pr.attributes() {
                    let trois: Vec<f64> = at.value().split(',').map(|v| v.parse().unwrap()).collect();
                    assert!(trois.iter().all(|v| *v == trois[0]), "{} anisotrope", at.name());
                    if matches!(at.name(), "Epsilon" | "Kappa") || at.name().contains('_') {
                        poser(&mut a, at.name(), trois[0].into());
                    }
                }
                assert!(enfant(e, "Weight").unwrap().attributes().all(|at| at.value().split(',').all(|v| v == "1")));
            }
            "ConductingSheet" => ["Conductivity", "Thickness"].iter().for_each(|k| poser(&mut a, k, nb(e, k))),
            "LumpedElement" => {
                ["Direction", "Caps", "R"].iter().for_each(|k| poser(&mut a, k, nb(e, k)));
                assert!(e.attribute("C").is_none() && e.attribute("L").is_none());
            }
            "Excitation" => {
                poser(&mut a, "Type", nb(e, "Type"));
                poser(&mut a, "Excite", nombres(e.attribute("Excite").unwrap()));
                poser(&mut a, "Delay", nb(e, "Delay"));
            }
            "ProbeBox" => ["Type", "Weight", "NormDir"].iter().for_each(|k| poser(&mut a, k, nb(e, k))),
            "DumpBox" => {
                ["DumpType", "DumpMode", "FileType"].iter().for_each(|k| poser(&mut a, k, nb(e, k)));
                if let Some(s) = e.attribute("SubSampling") {
                    poser(&mut a, "SubSampling", nombres(s));
                }
                if let Some(s) = enfant(e, "FD_Samples") {
                    poser(&mut a, "FD_Samples", nombres(s.text().unwrap()));
                }
            }
            "Metal" => {}
            autre => panic!("propriete inattendue <{autre}>"),
        }
        let mut prims = Vec::new();
        for q in enfant(e, "Primitives").unwrap().children().filter(|n| n.is_element()) {
            let mut b = obj! {"Priority" => nb(q, "Priority")};
            for k in ["Radius", "ShellWidth", "Elevation", "NormDir", "Length", "WireRadius"] {
                if q.attribute(k).is_some() {
                    poser(&mut b, k, nb(q, k));
                }
            }
            for k in ["P1", "P2", "Center"] {
                if let Some(p) = enfant(q, k) {
                    poser(&mut b, k, Json::Liste(["X", "Y", "Z"].iter().map(|c| nb(p, c)).collect()));
                }
            }
            let sommets = |cles: &[&str]| Json::Liste(q.children().filter(|n| n.has_tag_name("Vertex")).flat_map(|v| cles.iter().map(move |c| nb(v, c))).collect());
            let textes = |nom: &str| Json::Liste(q.children().filter(|n| n.has_tag_name(nom))
                .flat_map(|v| v.text().unwrap().split(',').map(|x| Json::Flottant(x.parse().unwrap())).collect::<Vec<_>>()).collect());
            match q.tag_name().name() {
                "Polygon" | "LinPoly" => {
                    poser(&mut b, "pts", sommets(&["X1", "X2"]));
                    assert_eq!(q.attribute("QtyVertices").unwrap().parse::<usize>().unwrap() * 2, b["pts"].as_liste().unwrap().len());
                }
                "Wire" => poser(&mut b, "pts", sommets(&["X", "Y", "Z"])),
                "Polyhedron" => {
                    poser(&mut b, "sommets", textes("Vertex"));
                    poser(&mut b, "faces", textes("Face"));
                }
                _ => {}
            }
            prims.push(obj! {"genre" => q.tag_name().name(), "a" => b});
        }
        out.push(obj! {"genre" => g, "nom" => e.attribute("Name").unwrap(), "a" => a, "prims" => Json::Liste(prims)});
    }
    Json::Liste(out)
}

/// Le premier ecart entre deux valeurs, ou None. Les nombres a `tol` pres, en relatif ; les
/// cles d'un objet sans regard a leur ordre.
fn ecart(a: &Json, b: &Json, chemin: &str, tol: f64) -> Option<String> {
    match (a, b) {
        (Json::Objet(x), Json::Objet(y)) => {
            if x.len() != y.len() || x.keys().any(|k| !y.contains_key(k)) {
                return Some(format!("{chemin} : cles {:?} / {:?}", x.keys().collect::<Vec<_>>(), y.keys().collect::<Vec<_>>()));
            }
            x.iter().find_map(|(k, v)| ecart(v, &y[k], &format!("{chemin}/{k}"), tol))
        }
        (Json::Liste(x), Json::Liste(y)) => {
            if x.len() != y.len() {
                return Some(format!("{chemin} : {} / {} elements", x.len(), y.len()));
            }
            x.iter().zip(y).enumerate().find_map(|(i, (v, w))| ecart(v, w, &format!("{chemin}[{i}]"), tol))
        }
        _ => match (a.as_f64(), b.as_f64()) {
            (Some(x), Some(y)) if !matches!(a, Json::Bool(_)) => ((x - y).abs() > tol * x.abs().max(y.abs()).max(1.0)).then(|| format!("{chemin} : {x} / {y}")),
            _ => (a != b).then(|| format!("{chemin} : {a:?} / {b:?}")),
        },
    }
}

fn cas() -> Vec<std::path::PathBuf> {
    let mut v: Vec<_> = std::fs::read_dir("essais/ref").unwrap().flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    v.sort();
    assert!(v.len() >= 15, "{} cas", v.len());
    v
}

#[test]
fn structure_du_script_python() {
    for dossier in cas() {
        let nom = dossier.file_name().unwrap().to_string_lossy().into_owned();
        let reference = json(&dossier.join("reference.json"));
        let m = modele::normaliser(&json(&dossier.join("document.json"))).unwrap();
        let sim = xml::generer(&m.m, &m.pieces).unwrap();
        if let Some(e) = ecart(&reference["structure"], &structure(&sim.xml), &nom, 1e-12) {
            panic!("{e}");
        }
        // le solveur : les pas, le critere d'arret, l'impulsion, les six PML
        let d = roxmltree::Document::parse(&sim.xml).unwrap();
        let fdtd = d.descendants().find(|n| n.has_tag_name("FDTD")).unwrap();
        let exc = enfant(fdtd, "Excitation").unwrap();
        let vu = obj! {"NumberOfTimesteps" => nb(fdtd, "NumberOfTimesteps"), "endCriteria" => nb(fdtd, "endCriteria"),
                       "f0" => nb(exc, "f0"), "fc" => nb(exc, "fc"),
                       "bords" => Json::Liste(enfant(fdtd, "BoundaryCond").unwrap().attributes().map(|a| a.value().into()).collect())};
        if let Some(e) = ecart(&reference["fdtd"], &vu, &format!("{nom}/fdtd"), 1e-15) {
            panic!("{e}");
        }
    }
}

#[test]
fn depouillement_de_numpy() {
    for dossier in cas() {
        let nom = dossier.file_name().unwrap().to_string_lossy().into_owned();
        let reference = json(&dossier.join("reference.json"));
        let m = modele::normaliser(&json(&dossier.join("document.json"))).unwrap();
        let sim = xml::generer(&m.m, &m.pieces).unwrap();
        let p = depouillement::depouiller_ports(&m.m, &sim.ports, &dossier).unwrap_or_else(|e| panic!("{nom} : {e}"));
        let n = |k: &str| m.m["nf2ff"][k].as_liste().unwrap().len();
        let nf = m.m["nf2ff"]["actif"].vrai().then(|| depouillement::lire_nf2ff(&dossier.join("nf2ff.h5"), n("theta"), n("phi")).unwrap());
        let r = depouillement::resultats(&m.m, &sim.ports, &p, nf.as_ref());
        if let Some(e) = ecart(&reference["resultats"], &r, &nom, 1e-9) {
            panic!("{e}");
        }
        // les lignes que le script imprimait, au caractere pres
        let mut journal = p.journal.clone();
        if let Some(nf) = &nf {
            let (p_inc, p_acc) = depouillement::puissances(&m.m, &sim.ports, &p);
            journal.extend(depouillement::journal_nf2ff(nf, p_inc, p_acc));
            // ce que le script passait a CalcNF2FF : la frequence, les angles en radians, le centre en METRES
            let x = depouillement::xml_nf2ff(&m.m, p.freq[p.i0], &sim.nf2ff);
            let d = roxmltree::Document::parse(&x).unwrap();
            let e = d.root_element();
            let vu = obj! {"freq" => nb(e, "freq"), "theta" => nombres(enfant(e, "theta").unwrap().text().unwrap()),
                           "phi" => nombres(enfant(e, "phi").unwrap().text().unwrap()), "centre" => nombres(e.attribute("Center").unwrap()),
                           "rayon" => nb(e, "Radius")};
            if let Some(e) = ecart(&reference["nf2ff"], &vu, &format!("{nom}/nf2ff"), 1e-12) {
                panic!("{e}");
            }
            assert_eq!(e.children().filter(|n| n.has_tag_name("Planes")).count(), 6);
            assert_eq!(e.attribute("Outfile"), Some("nf2ff.h5"));
        }
        let attendu: Vec<&str> = reference["journal"].as_liste().unwrap().iter().filter_map(|l| l.as_str()).collect();
        assert_eq!(journal, attendu, "{nom}");
    }
}

#[test]
fn hdf5_de_la_vraie_bibliotheque() {
    // essais/ref/champ_lointain/nf2ff.h5 est ecrit par libhdf5 (essais/outils/ecrire_nf2ff_h5.py),
    // avec les appels de l'ecrivain d'openEMS.
    let h = hdf5::Fichier::ouvrir(Path::new("essais/ref/champ_lointain/nf2ff.h5")).unwrap();
    let theta = h.jeu("/Mesh/theta").unwrap();
    assert_eq!(theta.dims, [181]);
    assert!((theta.v[0] + std::f64::consts::PI).abs() < 1e-6 && (theta.v[180] - std::f64::consts::PI).abs() < 1e-6 && theta.v[90].abs() < 1e-9);
    assert_eq!(h.jeu("/Mesh/phi").unwrap().v.len(), 2);
    assert_eq!(h.jeu("/Mesh/r").unwrap(), hdf5::Jeu { dims: vec![1], v: vec![1.0] });
    assert_eq!(h.attribut("/Mesh", "MeshType").unwrap().v, [2.0]);
    assert_eq!(h.attribut("/nf2ff", "Frequency").unwrap().v, [2e9]);
    assert_eq!(h.attribut("/nf2ff", "Dmax").unwrap().v, [5.6183]);
    assert_eq!(h.attribut("/nf2ff", "Prad").unwrap().v, [3.2e-23]);
    let e = h.jeu("/nf2ff/E_theta/FD/f0_real").unwrap();
    assert_eq!((e.dims.clone(), e.v.len()), (vec![2, 181], 362));
    // P_rad = |E_theta|^2 + |E_phi|^2 : les cinq tableaux se relisent a leur place
    let lire = |nom: &str| h.jeu(nom).unwrap().v;
    let (ti, pr, pi, p) = (lire("/nf2ff/E_theta/FD/f0_imag"), lire("/nf2ff/E_phi/FD/f0_real"), lire("/nf2ff/E_phi/FD/f0_imag"), lire("/nf2ff/P_rad/FD/f0"));
    for k in 0..362 {
        let s = e.v[k] * e.v[k] + ti[k] * ti[k] + pr[k] * pr[k] + pi[k] * pi[k];
        assert!((s - p[k]).abs() < 1e-12 * p[k].max(1.0), "{k}");
    }
    // ce qui n'y est pas se dit, et ce qui n'est pas du HDF5 aussi
    assert!(h.jeu("/nf2ff/E_theta/FD/f1_real").unwrap_err().contains("introuvable"));
    assert!(h.attribut("/nf2ff", "Eps_r").unwrap_err().contains("absent"));
    assert!(hdf5::Fichier::lire(vec![0; 100]).is_err() && hdf5::Fichier::lire(b"\x89HDF\r\n\x1a\n".to_vec()).is_err());
    let mut tronque = std::fs::read("essais/ref/champ_lointain/nf2ff.h5").unwrap();
    tronque.truncate(3000);
    assert!(hdf5::Fichier::lire(tronque).map(|h| h.jeu("/nf2ff/P_rad/FD/f0").is_err()).unwrap_or(true));
}

#[test]
fn grandeurs_non_finies() {
    // Une sonde de courant nulle : tout est NaN ou infini, et rien de cela ne part a la page.
    let d = std::env::temp_dir().join(format!("essai_solveur_nan_{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    let m = modele::normaliser(&json(Path::new("essais/ref/localise/document.json"))).unwrap();
    let sim = xml::generer(&m.m, &m.pieces).unwrap();
    for nom in ["port_ut_1", "port_it_1"] {
        std::fs::write(d.join(nom), "% t/s\tvoltage\n0\t0\n1e-12\t0\n2e-12\t0\n").unwrap();
    }
    let p = depouillement::depouiller_ports(&m.m, &sim.ports, &d).unwrap();
    let r = depouillement::resultats(&m.m, &sim.ports, &p, None);
    let texte = antenne_modele::dumps(&r);
    assert!(!texte.contains("NaN") && !texte.contains("Infinity"), "{}", &texte[..200]);
    assert_eq!((r["s11_min_db"].clone(), r["z0_re"].clone(), r["s11_re"][0].clone()), (Json::Nul, Json::Nul, Json::Nul));
    assert_eq!(r["f"].as_liste().unwrap().len(), 41);
    // une sonde absente ou vide est une erreur qui se lit
    std::fs::write(d.join("port_it_1"), "% t/s\n").unwrap();
    assert!(depouillement::depouiller_ports(&m.m, &sim.ports, &d).err().unwrap().contains("rien enregistre"));
    std::fs::remove_file(d.join("port_it_1")).unwrap();
    assert!(depouillement::depouiller_ports(&m.m, &sim.ports, &d).err().unwrap().contains("port_it_1"));
    let _ = std::fs::remove_dir_all(&d);
}
