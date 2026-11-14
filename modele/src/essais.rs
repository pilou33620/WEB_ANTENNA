//! Les essais : les références figées du Python (essais/), et les vérifications des bancs
//! python/test/banc-openems.py et banc-champs.py qui visent ces trois modules.
//!
//! essais/references.json : pour chaque document de essais/cas/, l'empreinte SHA-256 du JSON
//! que rend le Python (`json.dumps(..., ensure_ascii=False)` du modèle sans géométrie, du
//! balayage ou du tableau S), avec l'état du poste qu'il suppose. Deux sorties sont gardées
//! entières (*.modele.json) pour qu'un écart se lise. essais/champs/ : des .vtr du banc, et
//! les sorties d'`inventaire` et de `serie`.

use crate::modele::{self, *};
use crate::{champs, comparaison, dumps, json_depuis_texte, obj, pieces, Json};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::Mutex;

/// L'état du poste (débit, fils, banc) est global : un essai à la fois.
static VERROU: Mutex<()> = Mutex::new(());

fn seul() -> std::sync::MutexGuard<'static, ()> {
    let v = VERROU.lock().unwrap_or_else(|e| e.into_inner());
    comparaison::poser_etat(&Json::Nul);
    v
}

fn lire(chemin: &str) -> String {
    std::fs::read_to_string(chemin).unwrap_or_else(|e| panic!("{chemin} : {e}"))
}

fn json(chemin: &str) -> Json {
    json_depuis_texte(&lire(chemin)).unwrap_or_else(|e| panic!("{chemin} : {e}"))
}

#[test]
fn references_du_python() {
    let _v = seul();
    let mut ecarts = Vec::new();
    let references = json("essais/references.json");
    let cas = references.as_liste().unwrap();
    assert!(cas.len() >= 200, "{} cas", cas.len());
    for r in cas {
        let nom = r["cas"].as_str().unwrap();
        comparaison::poser_etat(&r["etat"]);
        let sortie = dumps(&comparaison::rendu(r["mode"].as_str().unwrap(), &json(&format!("essais/cas/{nom}.json")), r["geo"].vrai()));
        let empreinte: String = Sha256::digest(sortie.as_bytes()).iter().map(|o| format!("{o:02x}")).collect();
        if Some(empreinte.as_str()) != r["sha256"].as_str() {
            ecarts.push(format!("{nom} ({} octets, {} attendus)", sortie.len(), r["octets"].as_i64().unwrap_or(0)));
        }
    }
    comparaison::poser_etat(&Json::Nul);
    assert!(ecarts.is_empty(), "{} écart(s) avec le Python : {}", ecarts.len(), ecarts.join(", "));
}

#[test]
fn sorties_entieres() {
    let _v = seul();
    for nom in ["banc-0001", "ipc-01"] {
        let sortie = dumps(&comparaison::rendu("normaliser", &json(&format!("essais/cas/{nom}.json")), false));
        assert_eq!(sortie, lire(&format!("essais/{nom}.modele.json")).trim_end_matches('\n'), "{nom}");
    }
}

#[test]
fn champs_references() {
    let references = json("essais/champs/references.json");
    let cas = references.as_liste().unwrap();
    assert!(cas.len() >= 10);
    for r in cas {
        let a: Vec<&str> = r["args"].as_liste().unwrap().iter().map(|a| a.as_str().unwrap()).collect();
        let rendu = if a[0] == "--champs-inventaire" {
            champs::inventaire(Path::new(a[1]))
        } else {
            champs::serie(Path::new(a[1]), a[2], a[3], a[4].parse().ok(), a[5].parse().unwrap_or(0), a[6].parse().unwrap_or(0))
        };
        let rendu = rendu.unwrap_or_else(|e| obj! {"erreur" => e.message, "conseil" => e.conseil});
        assert_eq!(dumps(&rendu), dumps(&r["sortie"]), "{a:?}");
    }
}

// -- banc-champs.py ----------------------------------------------------------

#[test]
fn banc_champs() {
    // 1. Lire un .vtr fabrique a la main : 7 x 5 x 3, le champ vaut (i, j, k)
    let (nx, ny, nz) = (7, 5, 3);
    for nom in ["T_zlib.vtr", "T_nu.vtr"] {
        let g = champs::lire_vtr(Path::new("essais/champs").join(nom).as_path()).unwrap_or_else(|e| panic!("{}", e.message));
        assert_eq!(g.dims, [nx, ny, nz]);
        assert_eq!(g.v.len(), nx * ny * nz * 3);
        let mut k = 0;
        for z in 0..nz {
            for y in 0..ny {
                for x in 0..nx {
                    assert_eq!(&g.v[k..k + 3], &[x as f32, y as f32, z as f32]);
                    k += 3;
                }
            }
        }
        assert!((g.axes[1][ny - 1] - (ny - 1) as f64 * 0.002).abs() < 1e-12);
    }
    let e = champs::entete_vtr(Path::new("essais/champs/T_zlib.vtr")).unwrap();
    assert_eq!((e.dims, e.ncomp), ([7, 5, 3], 3));

    // 2. Decouper une tranche
    let g = champs::lire_vtr(Path::new("essais/champs/T_zlib.vtr")).unwrap();
    for (axe, attendu, normale) in [("z", (nx, ny), 2), ("y", (nx, nz), 1), ("x", (ny, nz), 0)] {
        let t = champs::_decouper(&g, axe, 1, champs::MAX_POINTS);
        assert_eq!((t.u_mm.len(), t.v_mm.len()), attendu, "{axe}");
        assert!(t.comps[normale].iter().all(|v| *v == 1.0), "{axe}");
    }
    assert_eq!(champs::_tranche_forte(&g, "z"), nz - 1);

    // 3. L'inventaire et les series
    let dos = Path::new("essais/champs/calcul");
    let inv = champs::inventaire(dos).unwrap();
    let cles: Vec<&str> = inv["series"].as_liste().unwrap().iter().map(|s| s["cle"].as_str().unwrap()).collect();
    assert_eq!(cles.len(), 2);
    assert!(cles[0].starts_with("fd|J|") && cles[1] == "td|E", "{cles:?}");
    let fd = &inv["series"][0];
    assert_eq!((fd["continu"].clone(), fd["volume"].clone(), inv["series"][1]["n_trames"].as_i64()), (true.into(), true.into(), Some(4)));
    let s = champs::serie(dos, cles[0], "z", Some(0), 0, 0).unwrap();
    assert_eq!((s["amp"].as_liste().unwrap().len(), s["pha"].as_liste().unwrap().len()), (3, 3));
    let st = champs::serie(dos, cles[1], "z", Some(0), 0, 0).unwrap();
    let images: Vec<&str> = st["trames"].as_liste().unwrap().iter().map(|t| t["etiquette"].as_str().unwrap()).collect();
    assert_eq!(images, ["pas 0", "pas 1", "pas 2", "pas 3"]);
    assert!(champs::serie(dos, "fd|../../secret|1.0", "", None, 0, 0).is_err());
}

/// Un .vtr forge : un nombre de composantes qui fait reboucler le produit, puis un bloc
/// zlib qui rend plus que ce que son entete annonce.
#[test]
fn vtr_forge() {
    let chemin = std::env::temp_dir().join(format!("essai_vtr_forge_{}.vtr", std::process::id()));
    let ecrire = |attributs: &str, donnees: &str| {
        let x: Vec<String> = (0..64).map(|i| i.to_string()).collect();
        std::fs::write(&chemin, format!(
            r#"<VTKFile type="RectilinearGrid" compressor="vtkZLibDataCompressor"><RectilinearGrid><Piece>
            <PointData><DataArray type="Float32" Name="E" {attributs}>{donnees}</DataArray></PointData>
            <Coordinates><DataArray type="Float64" format="ascii">{}</DataArray></Coordinates>
            </Piece></RectilinearGrid></VTKFile>"#, x.join(" "))).unwrap();
        champs::lire_vtr(&chemin).map(|g| g.v.len())
    };
    assert_eq!(ecrire(r#"NumberOfComponents="1" format="ascii""#, &"1 ".repeat(64)), Ok(64));
    for ncomp in ["288230376151711744", "0", "10"] {
        let e = ecrire(&format!(r#"NumberOfComponents="{ncomp}" format="ascii""#), &"1 ".repeat(64)).unwrap_err();
        assert!(e.message.contains("entete incoherent"), "{ncomp} : {}", e.message);
    }

    let bloc = |annonce: u32, octets: &[u8]| {
        use std::io::Write;
        let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        z.write_all(octets).unwrap();
        let z = z.finish().unwrap();
        let tete: Vec<u8> = [1, annonce, annonce, z.len() as u32].iter().flat_map(|n| n.to_le_bytes()).collect();
        crate::b64::encoder(&tete) + &crate::b64::encoder(&z)
    };
    assert_eq!(ecrire(r#"format="binary""#, &bloc(256, &[0; 256])), Ok(64));
    assert!(ecrire(r#"format="binary""#, &bloc(256, &vec![0; 1 << 20])).is_err());
    let _ = std::fs::remove_file(&chemin);
}

// -- banc-openems.py ---------------------------------------------------------

#[test]
fn banc_debit_et_fils() {
    let _v = seul();
    assert!(debit_suppose() == MCPS && debit_mesure().is_none());
    noter_debit(MCPS / 4.0, 0);
    assert!((debit_suppose() - MCPS / 4.0).abs() < 1e-9 && debit_n() == 1);
    for faux in [0.0, -3.0, 1e9, f64::NAN] {
        noter_debit(faux, 0);
    }
    assert_eq!(debit_n(), 1);
    oublier_debit();
    for v in [10.0, 11.0, 10.5] {
        noter_debit(v, 0);
    }
    assert!((debit_suppose() - 10.5).abs() < 1e-9);
    for v in [40.0, 41.0, 42.0, 43.0, 44.0, 45.0] {
        noter_debit(v, 0);
    }
    assert!(debit_suppose() > 35.0 && debit_n() == MCPS_GARDE);
    oublier_debit();

    assert!(regler_fils(-3) == 0 && regler_fils(1_000_000) == FILS_MAX);
    regler_fils(6);
    assert_eq!((fils_regle(), fils_effectif()), (6, 6));
    regler_fils(0);
    noter_banc([(1, 100.0), (2, 180.0), (4, 245.0), (8, 250.0), (0, 50.0), (3, 1e9)]);
    assert_eq!(banc().len(), 4);
    noter_debit(27.0, 2);
    regler_fils(8);
    assert!((debit_suppose() - 27.0 * 250.0 / 180.0).abs() < 1e-6);
    regler_fils(3);
    assert!((debit_suppose() - 27.0 * 212.5 / 180.0).abs() < 1e-6);
    regler_fils(0);
    assert_eq!(banc_meilleur(), 4); // a 3 % pres, le plus petit gagne
    assert!((debit_suppose() - 27.0 * 245.0 / 180.0).abs() < 1e-6);
    assert_eq!(debit_fils(), 2);
    noter_banc([]);
    assert!(banc_meilleur() == 0 && debit_suppose() == 27.0);
    comparaison::poser_etat(&Json::Nul);
}

#[test]
fn banc_formules_et_textes() {
    let _v = seul();
    // le microruban : Hammerstad, les memes nombres que la page (22-antennes.js)
    let (er, h, wf, wpatch) = (4.3, 1.6, 3.112, 37.5839);
    assert!((microruban_eeff(er, h, wf) - 3.2662).abs() < 1e-4, "{}", microruban_eeff(er, h, wf));
    assert!((microruban_eeff(er, h, wpatch) - 3.9924).abs() < 1e-4);
    assert!((microruban_z0(er, h, wf) - 50.24).abs() < 0.01, "{}", microruban_z0(er, h, wf));
    assert!(microruban_z0(er, h, 6.0) < microruban_z0(er, h, 3.0));

    assert_eq!(_duree_texte(3.0 * 3600.0 + 26.0 * 60.0), "3 h 26");
    assert_eq!(_duree_texte(70.0), "70 s");
    assert_eq!(_duree_texte(600.0), "10 min");
    assert_eq!(_duree_texte(7199.0), "2 h 00");

    assert_eq!(dumps(&etat()), "{\"dispo\": true, \"version\": \"1.0.0\", \"max\": 67108864, \"regles\": {\"marge_lambda\": 0.25, \
                                \"cellules_par_lambda\": 20.0, \"pml\": 8, \"er_defaut\": 4.3, \"df_defaut\": 0.02}}");

    // le modele du patch : ce que le banc en verifie sans solveur
    let m = normaliser(&json("essais/cas/banc-0001.json")).unwrap_or_else(|e| panic!("{}", e.message)).m;
    assert_eq!(m["format"].as_str(), Some("openems-antenne-1"));
    let est = &m["estimation"];
    assert!(est["cellules"].as_i64().unwrap() > 10000 && est["dt_s"].as_f64().unwrap() > 0.0);
    assert!((duree_estimee(&m) - est["duree_s"].as_f64().unwrap()).abs() < 1e-12);
    let cout = _cout(est, &m["bande"]);
    assert!(cout > 0.0 && cout <= est["cellules"].as_f64().unwrap() * m["arret"]["nmax"].as_f64().unwrap() * 1.0001);
    assert_eq!(m["port"], m["ports"][0]);
    assert!(_ponts_de_maille(&m, true).is_empty());
    assert_eq!(pieces::sans_geometrie(&normaliser(&json("essais/cas/banc-0001.json")).unwrap()), &m);
    assert_eq!(_emprise_primitive(&obj! {"type" => "sphere", "c" => crate::outils::nombres([1.0, 2.0, 3.0]), "r" => 0.5}),
               [0.5, 1.5, 2.5, 1.5, 2.5, 3.5]);

    // les refus gardent leur texte
    let refus = |doc: &str| normaliser(&json_depuis_texte(doc).unwrap()).unwrap_err();
    assert_eq!(refus("[]").message, "Document JSON (objet) attendu.");
    assert_eq!(refus("{}").message, "Empilage absent du document.");
    assert_eq!(modele::balayage(&json("essais/cas/banc-0001.json")).unwrap_err().message,
               "Un balayage demande au moins deux points (0 recu).");
    assert_eq!(modele::tableau_s(&json("essais/cas/banc-0001.json")).unwrap_err().message,
               "Un tableau S complet demande au moins deux ports (1 pose).");
}

/// Un cube ferme de cote 2, douze triangles : les sommets et les faces en base 64.
fn cube() -> (Json, Json) {
    let mut s = Vec::new();
    for i in 0..8u32 {
        for k in 0..3 {
            s.extend((if i >> k & 1 == 1 { 2.0f32 } else { 0.0 }).to_le_bytes());
        }
    }
    let faces: [u32; 36] = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5];
    let t: Vec<u8> = faces.iter().flat_map(|v| v.to_le_bytes()).collect();
    (crate::b64::encoder(&s).into(), crate::b64::encoder(&t).into())
}

#[test]
fn banc_pieces() {
    let (s, t) = cube();
    let a = pieces::_analyser("t", &s, &t).unwrap_or_else(|e| panic!("{}", e.message));
    assert_eq!((a.n_sommets, a.n_triangles, a.bords), (8, 12, 0));
    assert_eq!(a.boite, [0.0, 0.0, 0.0, 2.0, 2.0, 2.0]);
    assert_eq!(pieces::_plans(&a.sommets, &a.faces), [vec![0.0, 2.0], vec![0.0, 2.0], vec![0.0, 2.0]]);

    let doc = |materiau: &str, t: &Json| Json::Liste(vec![obj! {
        "nom" => "boitier", "position" => crate::outils::nombres([10.0, 0.0, 0.0]), "rotation" => crate::outils::nombres([0.0, 0.0, 90.0]),
        "corps" => Json::Liste(vec![obj! {"nom" => "coque", "materiau" => materiau, "er" => 3.0, "sommets" => s.clone(), "triangles" => t.clone()}]),
    }]);
    let p = pieces::pieces(&doc("dielectrique", &t), 1.0).unwrap_or_else(|e| panic!("{}", e.message));
    let c = &p[0].corps[0];
    let inclus = c.inclus.as_ref().unwrap();
    assert_eq!((inclus.priorite, inclus.ferme, inclus.triangles), (pieces::PRIORITE_DIELECTRIQUE, true, 12));
    assert_eq!(inclus.emprise, [10.0, 0.0, 0.0, 12.0, 2.0, 2.0]); // un quart de tour autour du centre : des cotes exactes
    assert_eq!(pieces::corps_inclus(&p).count(), 1);
    assert_eq!(pieces::pieces(&doc("metal", &t), 1.0).unwrap()[0].corps[0].inclus.as_ref().unwrap().priorite, pieces::PRIORITE_METAL);
    assert!(pieces::pieces(&doc("ignore", &Json::Nul), 1.0).unwrap()[0].corps[0].inclus.is_none());
    // les triangles places se relisent
    let relire = |texte: &str| {
        let mut out = Vec::new();
        std::io::Read::read_to_end(&mut flate2::read::ZlibDecoder::new(&crate::b64::decoder(texte).unwrap()[..]), &mut out).unwrap();
        out
    };
    assert_eq!(relire(&pieces::sommets_b64(c)).len(), 8 * 3 * 8);
    assert_eq!(relire(&pieces::faces_b64(c)).len(), 36 * 4);

    // une face en moins : le corps est ouvert, et c'est un refus
    let ouvert: Json = crate::b64::encoder(&crate::b64::decoder(t.as_str().unwrap()).unwrap()[..33 * 4]).into();
    let e = pieces::pieces(&doc("metal", &ouvert), 1.0).unwrap_err();
    assert_eq!(e.message, "Le corps « coque » de « boitier » n'est pas ferme : 3 arete(s) ne bordent qu'une face.");
    assert!(pieces::MAX_TRIANGLES == 400000 && pieces::MAX_CORPS == 400 && modele::MAX_CORPS == 64 * 1024 * 1024);
}
