//! Ce que python/test/banc-openems.py verifiait du script genere, repris sur le XML : la
//! meme intention pour chaque verification, sur ce que le solveur lit desormais.

use antenne_modele::{json_depuis_texte, modele, Json};
use antenne_solveur::{antenne, ports::GenrePort, xml};

fn doc(nom: &str) -> Json {
    let chemin = format!("../modele/essais/cas/{nom}.json");
    json_depuis_texte(&std::fs::read_to_string(&chemin).unwrap_or_else(|e| panic!("{chemin} : {e}"))).unwrap()
}

fn generer(d: &Json) -> (Json, xml::Simulation) {
    let m = modele::normaliser(d).unwrap_or_else(|e| panic!("{}", e.message));
    let sim = xml::generer(&m.m, &m.pieces).unwrap_or_else(|e| panic!("{}", e.message));
    roxmltree::Document::parse(&sim.xml).expect("le XML produit est bien forme");
    (m.m, sim)
}

fn avec(mut d: Json, cle: &str, v: Json) -> Json {
    if let Json::Objet(o) = &mut d {
        o.insert(cle.into(), v);
    }
    d
}

/// Les valeurs d'un attribut sur tous les elements d'un nom.
fn attributs(texte: &str, balise: &str, cle: &str) -> Vec<String> {
    let d = roxmltree::Document::parse(texte).unwrap();
    d.descendants().filter(|n| n.has_tag_name(balise)).filter_map(|n| n.attribute(cle).map(String::from)).collect()
}

fn noms(texte: &str, balise: &str) -> Vec<String> {
    attributs(texte, balise, "Name")
}

#[test]
fn ecriture_des_nombres() {
    for (v, dec, attendu) in [(30.111544477, 6, "30.111544"), (-0.0000001, 6, "0"), (100.0, 6, "100"), (1.5, 6, "1.5"),
                              (-77.4463849833, 6, "-77.446385"), (0.035, 4, "0.035"), (4.3, 4, "4.3"), (2.5e-7, 6, "0")] {
        assert_eq!(xml::_f(v, dec), attendu);
    }
    assert_eq!((xml::nb(-0.0), xml::nb(35.0), xml::nb(1e-12), xml::nb(5.8e7)), ("0".into(), "35".into(), "0.000000000001".into(), "58000000".into()));
    assert_eq!(xml::lit_e(0.011960988102576398, 6), 0.01196099);
    assert_eq!((xml::_ident("TOP", "cu"), xml::_ident("3 couche-é", "cu"), xml::_ident("--", "x")), ("TOP".into(), "cu_3_couche".into(), "x".into()));
    assert_eq!(xml::_disque(1.0, 2.0, 0.5).len(), 24);
}

#[test]
fn le_xml_porte_la_simulation() {
    let (m, sim) = generer(&doc("banc-0001"));
    let t = &sim.xml;
    // l'impulsion, la PML et le port
    assert!(t.contains("<Excitation Type=\"0\" f0=\"2500000000\" fc=\"1000000000\" />"));
    assert_eq!(t.matches("\"PML_8\"").count(), 6);
    assert!(t.contains("NumberOfTimesteps=\"20000\" endCriteria=\"0.001\""));
    assert_eq!(noms(t, "ProbeBox"), ["port_ut_1", "port_it_1"]);
    assert_eq!(noms(t, "LumpedElement"), ["port_resist_1"]);
    assert!(t.contains("<LumpedElement ID=\"3\" Name=\"port_resist_1\" Direction=\"2\" Caps=\"1\" R=\"50\">"));
    // aucune valeur NaN ni infinie
    assert!(!t.contains("NaN") && !t.contains("inf") && !t.contains("nan"));
    // une liste de nombres n'a aucun blanc : CSXCAD sauterait le nombre qui en porte un
    for l in t.lines().filter(|l| l.contains("Lines ")) {
        let corps = l.split('>').nth(1).unwrap().split('<').next().unwrap();
        assert!(!corps.contains(' ') && corps.split(',').all(|v| v.parse::<f64>().is_ok()));
    }
    assert_eq!(attributs(t, "XLines", "Qty")[0].parse::<usize>().unwrap(), m["maillage"]["x"].as_liste().unwrap().len());

    // LE PORT LOCALISE PART AU SOLVEUR COMME UNE LIGNE, et ses cotes tombent sur le maillage
    // A LA MEME PRECISION : c'est ce qui fait survivre le collage des ports a l'ecriture.
    let p = &m["port"];
    let (x, y) = (xml::_f(p["x1"].as_f64().unwrap(), 6), xml::_f(p["y1"].as_f64().unwrap(), 6));
    assert!(t.contains(&format!("<P1 X=\"{x}\" Y=\"{y}\" Z=\"0\" />")) && t.contains(&format!("<P2 X=\"{x}\" Y=\"{y}\" Z=\"1.6\" />")));
    assert_eq!(y, "30.111544");
    let ligne = |balise: &str| t.lines().find(|l| l.contains(balise)).unwrap().split('>').nth(1).unwrap().split('<').next().unwrap().to_string();
    assert!(ligne("<XLines").split(',').any(|v| v == x) && ligne("<YLines").split(',').any(|v| v == y) && ligne("<ZLines").split(',').any(|v| v == "1.6"));

    // sans enregistrement de champ, aucune sonde de champ ; sans champ lointain, pas de boite
    assert!(noms(t, "DumpBox").is_empty() && sim.nf2ff.is_empty());
    assert_eq!(sim.ports[0].genre, GenrePort::Localise { r: 50.0 });
}

#[test]
fn un_nom_venu_du_fichier_reste_du_texte() {
    // Le XML est LU par le solveur : un nom de couche ou de document piege ne doit ni fermer
    // un commentaire, ni ouvrir une balise, ni sortir d'un attribut.
    let pique = "--><Metal Name=\"x\"/><!--";
    let mut d = doc("banc-0001");
    if let Json::Objet(o) = &mut d {
        o.insert("nom".into(), format!("a\"\n{pique}\n--").into());
        if let Json::Liste(l) = &mut o["empilage"] {
            for e in l.iter_mut() {
                if let Json::Objet(c) = e {
                    let nom = format!("{}\n{pique} & < >", c["nom"].as_str().unwrap());
                    c.insert("nom".into(), nom.into());
                }
            }
        }
        for cle in ["cuivre"] {
            if let Json::Liste(l) = &mut o[cle] {
                for b in l.iter_mut() {
                    if let Json::Objet(c) = b {
                        let nom = format!("{}\n{pique} & < >", c["couche"].as_str().unwrap());
                        c.insert("couche".into(), nom.into());
                    }
                }
            }
        }
        if let Json::Objet(p) = &mut o["port"] {
            for cle in ["de", "a"] {
                let nom = format!("{}\n{pique} & < >", p[cle].as_str().unwrap());
                p.insert(cle.into(), nom.into());
            }
        }
    }
    let (_, piege) = generer(&d);
    let (_, sain) = generer(&doc("banc-0001"));
    let compte = |t: &str| roxmltree::Document::parse(t).unwrap().descendants().filter(|n| n.is_element()).count();
    assert_eq!(compte(&piege.xml), compte(&sain.xml));
    assert_eq!(noms(&piege.xml, "Metal"), noms(&sain.xml, "Metal"));
    assert!(noms(&piege.xml, "ConductingSheet").iter().all(|n| n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')));
}

#[test]
fn le_cuivre_et_ses_decoupes() {
    // la decoupe sort a une priorite superieure au plan de masse, le conducteur sans trou au-dessus
    let (m, sim) = generer(&doc("banc-0034"));
    let pr = attributs(&sim.xml, "Polygon", "Priority");
    assert!(pr.contains(&"10".to_string()) && pr.contains(&"11".to_string()) && pr.contains(&"12".to_string()));
    // Des trous sur TOUTES les couches : ceux de dessus se remplissent de substrat, ceux de
    // dessous d'air. `air_trou` n'est cree qu'une fois, et seulement s'il sert.
    let mut d = doc("banc-0001");
    if let Json::Objet(o) = &mut d {
        if let Json::Liste(blocs) = &mut o["cuivre"] {
            for b in blocs.iter_mut() {
                if let Json::Objet(b) = b {
                    if let Json::Liste(polys) = &mut b["polys"] {
                        for p in polys.iter_mut() {
                            if let Json::Objet(p) = p {
                                p.insert("t".into(), Json::Liste(vec![Json::Liste([30.0, 30.0, 40.0, 30.0, 40.0, 40.0, 30.0, 40.0].map(Json::from).to_vec())]));
                            }
                        }
                    }
                }
            }
        }
    }
    let (_, s3) = generer(&d);
    let materiaux = noms(&s3.xml, "Material");
    assert_eq!(materiaux.iter().filter(|n| *n == "air_trou").count(), 1, "{materiaux:?}");
    let x = roxmltree::Document::parse(&s3.xml).unwrap();
    let prims = |nom: &str| x.descendants().find(|n| n.attribute("Name") == Some(nom)).unwrap().descendants().filter(|n| n.has_tag_name("Polygon")).count();
    assert_eq!((prims("air_trou"), prims("CORE")), (1, 1));
    let _ = m;

    // Les trois modes de cuivre
    for (mode, balise, primitive) in [("volume", "Metal", "LinPoly"), ("pec", "Metal", "Polygon"), ("feuille", "ConductingSheet", "Polygon")] {
        let (m, s) = generer(&avec(doc("banc-0001"), "modele_cuivre", mode.into()));
        assert_eq!(noms(&s.xml, balise), ["cu_TOP", "cu_BOTTOM"], "{mode}");
        assert_eq!(attributs(&s.xml, primitive, "Priority"), ["12", "12"], "{mode}");
        if mode == "volume" {
            // le cuivre est extrude sur son epaisseur reelle
            assert_eq!(attributs(&s.xml, "LinPoly", "Length"), ["0.035", "0.035"]);
            assert!((m["z_haut"].as_f64().unwrap() - 1.67).abs() < 1e-9);
        }
        if mode == "feuille" {
            assert_eq!(attributs(&s.xml, "ConductingSheet", "Thickness"), ["0.000035", "0.000035"]);
        }
    }
    // La conductivite declaree par le document arrive jusqu'au solveur.
    let (_, s) = generer(&doc("banc-0038"));
    assert!(attributs(&s.xml, "ConductingSheet", "Conductivity").contains(&"5000000".to_string()), "{:?}", attributs(&s.xml, "ConductingSheet", "Conductivity"));
    // le via sort en cylindre plein
    let (m, s) = generer(&doc("banc-0042"));
    assert_eq!(noms(&s.xml, "Metal"), ["vias"]);
    assert_eq!((attributs(&s.xml, "Cylinder", "Priority"), attributs(&s.xml, "Cylinder", "Radius")), (vec!["13".to_string()], vec![xml::_f(m["vias"][0]["r"].as_f64().unwrap(), 6)]));
}

#[test]
fn pertes_de_debye() {
    let (m, sim) = generer(&doc("banc-0045"));
    assert!(noms(&sim.xml, "Material").is_empty());
    assert_eq!(noms(&sim.xml, "DebyeMaterial"), ["CORE"]);
    let x = roxmltree::Document::parse(&sim.xml).unwrap();
    let prop = x.descendants().find(|n| n.has_tag_name("Property")).unwrap();
    let jeu = &m["dielectriques"][0]["debye"];
    let poles = jeu["poles"].as_liste().unwrap();
    // LES POLES SONT DES ATTRIBUTS de <Property>, numerotes a partir de 1 : ailleurs, le
    // solveur les lit comme des zeros et le substrat ressort sans pertes, sans un mot.
    for (i, p) in poles.iter().enumerate() {
        let lu = |cle: &str| prop.attribute(format!("{cle}_{}", i + 1).as_str()).unwrap().split(',').map(|v| v.parse::<f64>().unwrap()).collect::<Vec<_>>();
        let (de, tau) = (lu("EpsilonDelta"), lu("EpsilonRelaxTime"));
        assert!(de.len() == 3 && (de[0] - p["de"].as_f64().unwrap()).abs() < 1e-8 * de[0] && (tau[2] - p["tau"].as_f64().unwrap()).abs() < 1e-8 * tau[2]);
        // LA BORNE QUI COMPTE : openEMS saute en silence tout pole plus rapide que le pas de temps
        assert!(tau[0] > m["estimation"]["dt_s"].as_f64().unwrap());
    }
    assert!(prop.attribute(format!("EpsilonDelta_{}", poles.len() + 1).as_str()).is_none());
    // eps_inf remplace eps_r, et kappa ne s'ajoute pas aux poles
    assert!((prop.attribute("Epsilon").unwrap().split(',').next().unwrap().parse::<f64>().unwrap() - jeu["eps_inf"].as_f64().unwrap()).abs() < 1e-7);
    assert_eq!(prop.attribute("Kappa"), Some("0,0,0"));
    // en kappa, la frequence de calage se lit dans la conductivite
    let (m1, s1) = generer(&doc("banc-0043"));
    let (m2, s2) = generer(&doc("banc-0044"));
    let k = |s: &xml::Simulation| attributs(&s.xml, "Property", "Kappa")[0].split(',').next().unwrap().parse::<f64>().unwrap();
    let rapport = m2["pertes"]["f_kappa"].as_f64().unwrap() / m1["pertes"]["f_kappa"].as_f64().unwrap();
    assert!((k(&s2) / k(&s1) - rapport).abs() < 1e-5 && rapport != 1.0);
}

#[test]
fn objets_pieces_et_carte() {
    let (m, sim) = generer(&doc("banc-0046"));
    let objets = m["primitives"].as_liste().unwrap();
    let x = roxmltree::Document::parse(&sim.xml).unwrap();
    for o in objets {
        let balise = match o["type"].as_str().unwrap() {
            "fil" => "Wire",
            "cylindre" => "Cylinder",
            "boite" => "Box",
            _ => "Sphere",
        };
        let p = x.descendants().find(|n| n.attribute("Name") == Some(xml::_ident(o["nom"].as_str().unwrap(), "obj").as_str())).unwrap();
        assert_eq!(p.tag_name().name(), if o["materiau"].as_str() == Some("metal") { "Metal" } else { "Material" });
        let q = p.descendants().find(|n| n.has_tag_name(balise)).unwrap_or_else(|| panic!("{balise} absent"));
        assert_eq!(q.attribute("Priority"), Some(o["priorite"].as_i64().unwrap().to_string().as_str()));
    }
    // les pieces importees : un polyedre ferme par corps, ses triangles DANS le fichier
    let d = doc("banc-0139");
    let m = modele::normaliser(&d).unwrap();
    let sim = xml::generer(&m.m, &m.pieces).unwrap();
    let x = roxmltree::Document::parse(&sim.xml).unwrap();
    let poly = x.descendants().find(|n| n.has_tag_name("Polyhedron")).unwrap();
    let corps = &m.m["pieces"][0]["corps"][0];
    assert_eq!(poly.children().filter(|n| n.has_tag_name("Face")).count() as i64, corps["triangles"].as_i64().unwrap());
    assert_eq!(poly.children().filter(|n| n.has_tag_name("Vertex")).count() as i64, corps["sommets"].as_i64().unwrap());
    // un plastique cede a la carte : sa priorite est sous celle du substrat
    assert_eq!(poly.attribute("Priority"), Some("0"));
    assert_eq!(poly.parent().unwrap().parent().unwrap().attribute("Name"), Some("boitier_coque_0"));
    // les sommets sont places et se relisent sans arrondi, dans l'emprise annoncee
    let e: Vec<f64> = corps["emprise"].as_liste().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    for v in poly.children().filter(|n| n.has_tag_name("Vertex")) {
        let c: Vec<f64> = v.text().unwrap().split(',').map(|t| t.parse().unwrap()).collect();
        assert!(c.len() == 3 && (0..3).all(|k| c[k] >= e[k] - 1e-9 && c[k] <= e[k + 3] + 1e-9));
    }
    // le contour de la carte entiere, et non l'emprise du cuivre
    let (m, sim) = generer(&doc("banc-0152"));
    assert_eq!(attributs(&sim.xml, "LinPoly", "QtyVertices")[0].parse::<usize>().unwrap(), m["carte"]["contour"].as_liste().unwrap().len());
    assert_eq!(attributs(&sim.xml, "LinPoly", "Priority")[0], "1");
}

#[test]
fn enregistrements_et_champ_lointain() {
    let (m, f) = generer(&doc("banc-0047"));
    assert_eq!(noms(&f.xml, "DumpBox"), ["J"]);
    assert_eq!((attributs(&f.xml, "DumpBox", "DumpType"), attributs(&f.xml, "DumpBox", "SubSampling")), (vec!["12".to_string()], vec!["2,2,2".to_string()]));
    assert!(f.xml.contains("<FD_Samples>2450000000</FD_Samples>"));
    let _ = m;
    let (_, t) = generer(&doc("banc-0048"));
    assert!(!t.xml.contains("FD_Samples") && attributs(&t.xml, "DumpBox", "DumpType").iter().all(|v| v.parse::<i64>().unwrap() < 10));

    // la boite de champ lointain : DANS la boite de calcul, HORS de la PML
    let (m, sim) = generer(&doc("f1-0019"));
    assert_eq!(noms(&sim.xml, "DumpBox"), ["nf2ff_E", "nf2ff_H"]);
    assert_eq!(sim.nf2ff.len(), 6);
    assert_eq!(sim.nf2ff[5], ("nf2ff_E_5.h5".to_string(), "nf2ff_H_5.h5".to_string()));
    let x = roxmltree::Document::parse(&sim.xml).unwrap();
    let e = x.descendants().find(|n| n.attribute("Name") == Some("nf2ff_E")).unwrap();
    assert_eq!((e.attribute("DumpType"), e.attribute("DumpMode"), e.attribute("FileType")), (Some("0"), Some("1"), Some("1")));
    let boites: Vec<_> = e.descendants().filter(|n| n.has_tag_name("Box")).collect();
    assert_eq!(boites.len(), 6);
    let pml = m["boite"]["pml"].as_i64().unwrap() as usize;
    for (axe, cle) in ["x", "y", "z"].iter().zip(["X", "Y", "Z"]) {
        let l: Vec<f64> = m["maillage"][*axe].as_liste().unwrap().iter().map(|v| xml::lit(v.as_f64().unwrap(), 6)).collect();
        for b in &boites {
            for p in b.children().filter(|n| n.is_element()) {
                let v: f64 = p.attribute(cle).unwrap().parse().unwrap();
                assert!(v == l[pml + 1] || v == l[l.len() - 2 - pml], "{axe} {v}");
            }
        }
    }
}

#[test]
fn plusieurs_ports() {
    // DEUX PORTS NE SONT PAS DEUX SIMULATIONS : un seul excite, l'autre est pose en charge.
    let (_, s) = generer(&doc("banc-0049"));
    assert_eq!(noms(&s.xml, "LumpedElement"), ["port_resist_1", "port_resist_2"]);
    assert_eq!(noms(&s.xml, "Excitation"), ["port_excite_1"]);
    assert_eq!(noms(&s.xml, "ProbeBox"), ["port_ut_1", "port_it_1", "port_ut_2", "port_it_2"]);
    assert_eq!(s.ports.iter().map(|p| p.excite).collect::<Vec<_>>(), [true, false]);
    // UN RESEAU : les ports excites emettent ensemble.
    let (_, s) = generer(&doc("banc-0051"));
    assert_eq!(noms(&s.xml, "Excitation"), ["port_excite_1", "port_excite_2"]);
    assert_eq!(attributs(&s.xml, "Excitation", "Delay"), ["0", "0"]);
    // LE DEPHASAGE EST UN RETARD. Port 2 en avance de 90 deg : c'est le port 1 qui attend.
    let (m, s) = generer(&doc("banc-0052"));
    let retards = attributs(&s.xml, "Excitation", "Delay");
    let r1 = m["ports"][0]["retard_s"].as_f64().unwrap();
    assert!(r1 > 0.0 && (retards[0].parse::<f64>().unwrap() - r1).abs() < 1e-6 * r1 && retards[1] == "0", "{retards:?}");
}

#[test]
fn port_coaxial() {
    let (m, s) = generer(&doc("banc-0056"));
    let c = &m["port"]["coax"];
    let x = roxmltree::Document::parse(&s.xml).unwrap();
    // la croix : quatre resistances de 4.Z0 en parallele, quatre sources
    let z0 = xml::lit(c["z0_ligne"].as_f64().unwrap(), 4);
    assert_eq!(attributs(&s.xml, "LumpedElement", "R"), vec![xml::nb(4.0 * z0); 4]);
    assert_eq!(noms(&s.xml, "Excitation").len(), 4);
    assert_eq!(attributs(&s.xml, "Excitation", "Excite"), ["1,0,0", "-1,0,0", "0,1,0", "0,-1,0"]);
    // une tension radiale, deux boucles de courant de normale z qui encadrent le plan de tension
    assert_eq!(noms(&s.xml, "ProbeBox"), ["port_ut_1", "port_it_1A", "port_it_1B"]);
    assert_eq!(attributs(&s.xml, "ProbeBox", "NormDir"), ["-1", "2", "2"]);
    let z_de = |nom: &str| -> f64 {
        x.descendants().find(|n| n.attribute("Name") == Some(nom)).unwrap().descendants().find(|n| n.has_tag_name("P1")).unwrap().attribute("Z").unwrap().parse().unwrap()
    };
    let (zu, za, zb) = (z_de("port_ut_1"), z_de("port_it_1A"), z_de("port_it_1B"));
    assert!(za < zu && zu < zb && (zu - c["z_mes"].as_f64().unwrap()).abs() < 1e-6);
    // LA BOUCLE DE COURANT EST UN CARRE entre l'ame et la gaine
    let rm = c["rm"].as_f64().unwrap();
    assert!(rm > c["ra"].as_f64().unwrap() && rm * 2f64.sqrt() < c["rb"].as_f64().unwrap() + 1e-9);
    // LE DEGAGEMENT PASSE AU-DESSUS DU CUIVRE (12) et sous le connecteur (20) ; c'est une
    // SURFACE, comme la feuille qu'il perce, et il se remplit du substrat voisin
    let core = x.descendants().find(|n| n.attribute("Name") == Some("CORE")).unwrap();
    let deg: Vec<_> = core.descendants().filter(|n| n.has_tag_name("Polygon")).collect();
    assert_eq!((deg.len(), deg[0].attribute("Priority"), deg[0].attribute("QtyVertices")), (1, Some("15"), Some("24")));
    assert!(!s.xml.contains("coax_air"));
    assert_eq!(attributs(&s.xml, "CylindricalShell", "Priority"), ["20"]);
    // l'impedance de reference est celle de la ligne, et le plan est ramene a la carte
    match &s.ports[0].genre {
        GenrePort::Coaxial { z0: z, er, deport } => {
            assert_eq!((*z, *er), (z0, xml::lit(c["er"].as_f64().unwrap(), 4)));
            assert!((deport - (c["z_mes"].as_f64().unwrap() - c["z_gaine"].as_f64().unwrap()).abs()).abs() < 1e-5);
        }
        g => panic!("{g:?}"),
    }
    // en volume, le degagement est extrude comme le cuivre
    let (_, v) = generer(&avec(doc("banc-0056"), "modele_cuivre", "volume".into()));
    assert!(v.xml.contains("<LinPoly Priority=\"15\""));
}

#[test]
fn port_microruban() {
    let (m, s) = generer(&doc("banc-0100"));
    let q = &m["port"]["msl"];
    assert_eq!(noms(&s.xml, "Metal").iter().filter(|n| *n == "msl_1").count(), 1);
    assert_eq!(noms(&s.xml, "ProbeBox"), ["port_ut_1A", "port_ut_1B", "port_ut_1C", "port_it_1A", "port_it_1B"]);
    match &s.ports[0].genre {
        GenrePort::Microruban { u_delta, i_delta, plan, deport } => {
            let longueur = (q["fin"].as_f64().unwrap() - q["debut"].as_f64().unwrap()).abs();
            assert!((deport - longueur).abs() < 1e-6 && *plan > 0.0 && *plan < longueur);
            assert!(u_delta[0] != 0.0 && u_delta[0].signum() == u_delta[1].signum() && (i_delta - 0.5 * (u_delta[0] + u_delta[1])).abs() < 1e-12);
        }
        g => panic!("{g:?}"),
    }
    // « maillage » : les lignes du MSLPort sous un port localise
    let mut d = doc("banc-0100");
    if let Json::Objet(o) = &mut d {
        if let Json::Objet(p) = &mut o["port"] {
            p.insert("msl".into(), "maillage".into());
        }
    }
    let (_, loc) = generer(&d);
    assert!(noms(&loc.xml, "ProbeBox") == ["port_ut_1", "port_it_1"] && matches!(loc.ports[0].genre, GenrePort::Localise { .. }));
}

#[test]
fn fils_banc_et_export() {
    modele::regler_fils(0);
    let d = doc("banc-0001");
    let e = antenne::script(&d).unwrap();
    assert_eq!(e["nom"].as_str(), Some("patch-2450_openems.xml"));
    assert!(e["script"].as_str().unwrap().starts_with("<?xml") && e["estimation"]["cellules"].as_i64().is_some() && e["avis"].as_liste().is_some());
    // a zero, le choix reste a openEMS, et le lisez-moi le dit
    let lm = e["lisez_moi"].as_str().unwrap();
    assert!(lm.contains("openEMS patch-2450_openems.xml -vvv") && !lm.contains("--numThreads=") && lm.contains("tatonne"));
    modele::regler_fils(4);
    let lm = antenne::script(&d).unwrap();
    assert!(lm["lisez_moi"].as_str().unwrap().contains("openEMS patch-2450_openems.xml --numThreads=4 -vvv"));
    modele::regler_fils(0);
    // le banc : une boite vide fermee en PEC, que l'energie n'arrete pas
    let b = xml::generer_banc();
    let x = roxmltree::Document::parse(&b).unwrap();
    assert_eq!(b.matches("\"PEC\"").count(), 6);
    assert_eq!((attributs(&b, "XLines", "Qty"), attributs(&b, "ZLines", "Qty")), (vec!["181".to_string()], vec!["91".to_string()]));
    let fdtd = x.descendants().find(|n| n.has_tag_name("FDTD")).unwrap();
    assert_eq!(fdtd.attribute("NumberOfTimesteps"), Some("300"));
    assert!(fdtd.attribute("endCriteria").unwrap().parse::<f64>().unwrap() > 0.0);
    // un document que le modele refuse est refuse a l'export aussi
    assert!(antenne::script(&Json::Nul).is_err());
    // les chiffrages sans lancement
    let bal = antenne::balayage(&doc("banc-0066")).unwrap();
    assert!(bal["points"][0]["cellules"].as_i64().is_some() && bal["points"][0].get("modele").is_none());
    let ts = antenne::tableau_s(&doc("banc-0053")).unwrap();
    assert_eq!(ts["colonnes"].as_liste().unwrap().len(), 2);
}
