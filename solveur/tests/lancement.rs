//! Le lancement, le suivi et l'arret, sur un faux openEMS (src/bin/faux_openems.rs) ; puis
//! ce que python/test/banc-openems.py verifiait du journal, des diagnostics, du tableau S
//! et de l'archivage des calculs.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use antenne_modele::{json_depuis_texte, modele, obj, Json};
use antenne_solveur::{antenne, lancement};

/// La racine du depot, le registre des taches et l'etat du poste sont globaux : un essai a la fois.
static VERROU: Mutex<()> = Mutex::new(());

fn doc(chemin: &str) -> Json {
    json_depuis_texte(&std::fs::read_to_string(chemin).unwrap_or_else(|e| panic!("{chemin} : {e}"))).unwrap()
}

fn temp(nom: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("essai_solveur_{}_{nom}_{}", std::process::id(), lancement::identifiant_neuf()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// Un depot de poche : un dossier « openEMS » ou le faux solveur tient les deux roles.
fn poste(scenario: &str) -> (std::sync::MutexGuard<'static, ()>, PathBuf) {
    let v = VERROU.lock().unwrap_or_else(|e| e.into_inner());
    let racine = temp("depot");
    let d = racine.join("openEMS");
    std::fs::create_dir_all(&d).unwrap();
    let suffixe = if cfg!(windows) { ".exe" } else { "" };
    for nom in ["openEMS", "nf2ff"] {
        std::fs::copy(env!("CARGO_BIN_EXE_faux_openems"), d.join(format!("{nom}{suffixe}"))).unwrap();
    }
    let h5 = std::fs::canonicalize("essais/ref/champ_lointain/nf2ff.h5").unwrap();
    std::fs::write(d.join("scenario"), format!("{scenario}\nnf2ff={}\n", h5.display())).unwrap();
    lancement::nettoyer();
    lancement::definir_racine_depot(&racine);
    lancement::definir_racine_calculs(racine.join("calculs").to_str().unwrap());
    modele::oublier_debit();
    modele::regler_fils(0);
    modele::noter_banc([]);
    (v, racine)
}

fn attendre(ident: &str) -> Json {
    for _ in 0..600 {
        let v = lancement::journal(ident, 0).unwrap();
        if !matches!(v["etat"].as_str(), Some("prepare" | "calcule")) {
            return v;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    panic!("la tache {ident} ne finit pas");
}

fn lignes(v: &Json) -> Vec<&str> {
    v["lignes"].as_liste().unwrap().iter().filter_map(|l| l.as_str()).collect()
}

#[test]
fn etat_du_poste() {
    let (_v, racine) = poste("");
    let e = antenne::etat();
    assert_eq!((e["preparer"].clone(), e["lancer"].clone(), e["script"].clone()), (true.into(), true.into(), true.into()));
    assert_eq!(e["solveur"]["version"].as_str(), Some("v0.0.36-faux"));
    assert!(e["solveur"]["dll"].as_str().unwrap().ends_with("openEMS") && e["solveur"]["nf2ff"].vrai());

    // Sans executable : « preparer » marche toujours, « lancer » dit pourquoi il ne marche pas.
    std::fs::remove_dir_all(racine.join("openEMS")).unwrap();
    let chemins = std::env::var_os("PATH");
    std::env::set_var("PATH", "");
    lancement::definir_racine_depot(&racine);
    let e = antenne::etat();
    assert_eq!((e["preparer"].clone(), e["lancer"].clone()), (true.into(), false.into()));
    assert!(e["lancer_detail"].as_str().unwrap().contains("introuvable") && e["lancer_conseil"].as_str().unwrap().contains("nf2ff"));
    let r = antenne::lancer(&doc("essais/ref/localise/document.json")).unwrap_err();
    assert!(r.message.starts_with("openEMS n'est pas utilisable sur ce poste : ") && !r.conseil.is_empty(), "{}", r.message);
    assert!(antenne::preparer(&doc("essais/ref/localise/document.json")).is_ok());
    if let Some(c) = chemins {
        std::env::set_var("PATH", c);
    }
}

#[test]
fn une_simulation() {
    let (_v, _racine) = poste("");
    modele::regler_fils(3);
    let vue = antenne::lancer(&doc("essais/ref/champ_lointain/document.json")).unwrap();
    let ident = vue["id"].as_str().unwrap().to_string();
    assert!(ident.len() == 12 && matches!(vue["etat"].as_str(), Some("calcule" | "fini")));
    let v = attendre(&ident);
    assert_eq!(v["etat"].as_str(), Some("fini"), "{} {:?}", v["detail"].as_str().unwrap_or(""), lignes(&v));
    let dossier = PathBuf::from(v["dossier"].as_str().unwrap());
    assert!(dossier.join("antenne.xml").is_file() && dossier.join("resultats.json").is_file() && dossier.join("nf2ff.xml").is_file());
    // le suivi : les fils imposes, la vitesse, l'energie lue malgre l'espace apres le signe
    let a = &v["avancement"];
    assert_eq!((a["fils"].as_i64(), a["pourcent"].as_f64(), a["restant_s"].as_f64()), (Some(3), Some(100.0), Some(0.0)));
    assert!(a["energie_dB"].as_f64().unwrap() < -30.0 && a["vitesse"].as_f64().unwrap() >= 20.0);
    // le resultat : les courbes, la resonance, le champ lointain
    let r = &v["resultat"];
    let n = r["f"].as_liste().unwrap().len();
    assert_eq!(n, 41);
    for cle in ["s11_db", "s11_re", "s11_im", "z_re", "z_im", "vswr"] {
        assert_eq!(r[cle].as_liste().unwrap().len(), n, "{cle}");
    }
    assert!(r["s11_min_db"].as_f64().is_some() && r["nf2ff"]["dmax_dbi"].as_f64().is_some());
    assert_eq!(r["nf2ff"]["e_norm"].as_liste().unwrap().len(), 2);
    // ce qui s'imprimait au journal s'y trouve toujours
    let j = lignes(&v);
    assert!(j.iter().any(|l| l.starts_with("Resonance : ")) && j.iter().any(|l| l.starts_with("Directivite : ")) && j.contains(&"resultats.json ecrit"));
    assert!(j.iter().any(|l| l.starts_with("Dossier de calcul : ")));
    // le journal se lit par morceaux
    let suite = lancement::journal(&ident, v["n"].as_i64().unwrap() as usize - 2).unwrap();
    assert_eq!(suite["lignes"].as_liste().unwrap().len(), 2);
    // le debit : la mediane, premiere ligne ecartee, avec les fils qui l'ont donnee
    assert!(modele::debit_mesure().is_some_and(|d| d >= 20.0) && modele::debit_fils() == 3);
    // le dossier se retrouve, meme le registre vide (le serveur a redemarre)
    lancement::nettoyer();
    assert_eq!(lancement::dossier_de(&ident).unwrap(), dossier);
    assert!(antenne::champs(&ident).is_ok());
    assert!(lancement::journal(&ident, 0).unwrap_err().message.contains("n'existe plus"));
    assert!(lancement::dossier_de("../../etc").is_err() && lancement::dossier_de("0123456789ab").is_err());
}

#[test]
fn echec_et_arret() {
    let (_v, racine) = poste("plante");
    let d = doc("essais/ref/localise/document.json");
    let v = attendre(antenne::lancer(&d).unwrap()["id"].as_str().unwrap());
    assert_eq!(v["etat"].as_str(), Some("echoue"));
    assert_eq!(v["detail"].as_str(), Some("Le calcul s'est arrete (code 3) : Error: la geometrie de ce faux calcul est degeneree"));
    assert!(v.get("resultat").is_none() && modele::debit_mesure().is_none());

    // un calcul qui finit sans sondes ne rend pas de chiffres inventes
    std::fs::write(racine.join("openEMS/scenario"), "muet\n").unwrap();
    let v = attendre(antenne::lancer(&d).unwrap()["id"].as_str().unwrap());
    assert_eq!(v["etat"].as_str(), Some("echoue"));
    assert!(v["detail"].as_str().unwrap().starts_with("Le calcul s'est termine sans resultats exploitables"));

    // l'arret : le processus est tue, la tache le dit
    std::fs::write(racine.join("openEMS/scenario"), "lent\n").unwrap();
    let ident = antenne::lancer(&d).unwrap()["id"].as_str().unwrap().to_string();
    std::thread::sleep(std::time::Duration::from_millis(400));
    let avant = lancement::journal(&ident, 0).unwrap();
    assert_eq!(avant["etat"].as_str(), Some("calcule"));
    assert!(lancement::archiver(&ident, racine.join("ailleurs").to_str().unwrap()).unwrap_err().message.contains("tourne encore"));
    let r = antenne::arreter(&ident).unwrap();
    assert_eq!((r["arrete"].clone(), r["etat"].as_str()), (true.into(), Some("arrete")));
    let v = attendre(&ident);
    assert_eq!((v["etat"].as_str(), v["detail"].as_str()), (Some("arrete"), Some("Arrete a la demande.")));
    std::thread::sleep(std::time::Duration::from_millis(300));
    let n = lancement::journal(&ident, 0).unwrap()["n"].as_i64().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(300));
    assert_eq!(lancement::journal(&ident, 0).unwrap()["n"].as_i64().unwrap(), n, "le solveur ecrit encore");
    assert!(antenne::arreter("inconnue").unwrap_err().message.contains("n'existe plus"));
}

#[test]
fn balayage_et_tableau_s() {
    let (_v, racine) = poste("");
    let vue = antenne::lancer_balayage(&doc("../modele/essais/cas/banc-0066.json")).unwrap();
    let total = vue["balayage"]["total"].as_i64().unwrap();
    assert!(total >= 2);
    let v = attendre(vue["id"].as_str().unwrap());
    assert_eq!(v["etat"].as_str(), Some("fini"), "{:?}", lignes(&v));
    let r = &v["resultat"];
    assert_eq!(r["balayage"], true.into());
    assert_eq!(r["lignes"].as_liste().unwrap().len() as i64, total);
    assert!(r["premier"]["s11_db"].vrai() && r["points"][1]["resultat"]["f0"].as_f64().is_some());
    let pts = v["balayage"]["points"].as_liste().unwrap();
    assert!(pts.iter().all(|p| p["etat"].as_str() == Some("fini") && p["resume"]["f0"].as_f64().is_some() && p.get("resultat").is_none()));
    let j = lignes(&v);
    assert!(j[0].starts_with("Balayage de « ") && j.iter().any(|l| l.starts_with("=== point 2/")) && j.iter().any(|l| l.starts_with("  → ")));
    assert!(Path::new(v["dossier"].as_str().unwrap()).join("p02/resultats.json").is_file());

    // le tableau S : une simulation par port, S[i][j] rempli, la reciprocite chiffree
    let vue = antenne::lancer_tableau_s(&doc("../modele/essais/cas/banc-0053.json")).unwrap();
    assert_eq!(vue["tableau_s"]["ports"].as_liste().unwrap().len(), 2);
    let v = attendre(vue["id"].as_str().unwrap());
    assert_eq!(v["etat"].as_str(), Some("fini"), "{:?}", lignes(&v));
    let r = &v["resultat"];
    assert_eq!(r["tableau_s"], true.into());
    for i in 0..2 {
        for j in 0..2 {
            assert_eq!(r["s"][i][j]["re"].as_liste().unwrap().len(), r["f"].as_liste().unwrap().len(), "S{i}{j}");
        }
    }
    assert!(r["reciprocite"]["ecart"].as_f64().is_some() && r["colonnes"][1]["resultat"]["excite"].as_i64() == Some(2));
    assert!(lignes(&v)[0].starts_with("Tableau S complet : 2 simulations"));

    // un point qui tourne mal n'emporte pas la suite ; aucun point abouti, c'est un echec
    std::fs::write(racine.join("openEMS/scenario"), "plante\n").unwrap();
    let v = attendre(antenne::lancer_balayage(&doc("../modele/essais/cas/banc-0066.json")).unwrap()["id"].as_str().unwrap());
    assert_eq!(v["etat"].as_str(), Some("echoue"));
    assert!(v["detail"].as_str().unwrap().starts_with("Aucun point n'a abouti."));
    assert!(v["balayage"]["points"].as_liste().unwrap().iter().all(|p| p["etat"].as_str() == Some("echoue") && p["detail"].vrai()));

    // arreter un balayage, c'est aussi ne pas lancer les points suivants
    std::fs::write(racine.join("openEMS/scenario"), "lent\n").unwrap();
    let ident = antenne::lancer_balayage(&doc("../modele/essais/cas/banc-0066.json")).unwrap()["id"].as_str().unwrap().to_string();
    std::thread::sleep(std::time::Duration::from_millis(300));
    antenne::arreter(&ident).unwrap();
    let v = attendre(&ident);
    std::thread::sleep(std::time::Duration::from_millis(300));
    let v2 = lancement::journal(&ident, 0).unwrap();
    assert_eq!((v["etat"].as_str(), v2["balayage"]["courant"].as_i64()), (Some("arrete"), Some(1)));
    assert!(v2["detail"].as_str().unwrap().starts_with("Arrete a la demande apres 1 point sur "), "{}", v2["detail"].as_str().unwrap());
}

#[test]
fn banc_de_vitesse() {
    let (_v, racine) = poste("");
    assert_eq!(lancement::fils_a_essayer(Some(8)), [1, 2, 3, 4, 6, 8]);
    assert_eq!(lancement::fils_a_essayer(Some(10)), [1, 2, 3, 4, 6, 8, 10]);
    assert_eq!(lancement::fils_a_essayer(Some(1)), [1]);
    let vue = antenne::lancer_banc(false).unwrap();
    assert_eq!(vue["genre"].as_str(), Some("banc"));
    let essais: Vec<i64> = vue["banc"]["essais"].as_liste().unwrap().iter().filter_map(|e| e.as_i64()).collect();
    let v = attendre(vue["id"].as_str().unwrap());
    assert_eq!(v["etat"].as_str(), Some("fini"), "{:?}", lignes(&v));
    // le faux solveur annonce 100 + fils MCells/s : chaque essai a bien recu ses fils
    for n in &essais {
        assert_eq!(v["banc"]["mesures"][n.to_string().as_str()].as_f64(), Some(100.0 + *n as f64));
    }
    assert_eq!(v["resultat"]["cellules"].as_i64(), Some(180 * 180 * 90));
    assert!(lignes(&v).contains(&"Banc : 1 fil(s) -> 101.0 MCells/s"));
    // la table va au modele, le debit non : une boite vide n'est pas une antenne
    assert_eq!(modele::banc().len(), essais.len());
    assert!(modele::debit_mesure().is_none());
    // a vitesse egale a 3 % pres, le plus petit gagne
    assert_eq!(antenne::fils()["meilleur"].as_i64(), Some(1));
    assert!(!v["dossier"].as_str().unwrap().contains("calculs"), "le banc n'ecrit pas dans le projet");

    // un banc et un calcul ne se superposent pas...
    std::fs::write(racine.join("openEMS/scenario"), "lent\n").unwrap();
    let d = doc("essais/ref/localise/document.json");
    let banc = antenne::lancer_banc(false).unwrap()["id"].as_str().unwrap().to_string();
    assert_eq!(antenne::lancer_banc(false).unwrap_err().message, "Le banc de vitesse tourne deja.");
    assert!(antenne::lancer(&d).unwrap_err().message.starts_with("Le banc de vitesse tourne : une simulation lancee maintenant"));
    assert_eq!(antenne::fils()["banc_tache"]["id"].as_str(), Some(banc.as_str()));
    antenne::arreter(&banc).unwrap();
    attendre(&banc);
    // ... sauf le banc du demarrage, qui cede sa place au premier calcul demande
    let auto = antenne::lancer_banc(true).unwrap()["id"].as_str().unwrap().to_string();
    let calcul = antenne::lancer(&d).unwrap()["id"].as_str().unwrap().to_string();
    let v = attendre(&auto);
    assert_eq!(v["etat"].as_str(), Some("arrete"));
    assert!(v["detail"].as_str().unwrap().starts_with("Interrompu pour laisser passer une simulation"));
    assert!(antenne::lancer_banc(false).unwrap_err().message.starts_with("Un calcul tourne deja"));
    antenne::arreter(&calcul).unwrap();
    attendre(&calcul);
}

fn ligne(pas: i64, brute: f64, db: f64) -> String {
    format!("[@ {}s] Timestep: {} || Speed: 20.0 MC/s (1.0e-02 s/TS) || Energy: ~{:.3e} (- {:.2}dB)", pas / 10, pas, brute, db.abs())
}

#[test]
fn suivi_et_diagnostics() {
    let _v = VERROU.lock().unwrap_or_else(|e| e.into_inner());
    modele::oublier_debit();
    // Le trajet complet : le journal d'openEMS -> le debit retenu. Les lignes sont
    // celles que le solveur ecrit vraiment, prises telles quelles.
    let journal: Vec<String> = ["[@     1m40s] Timestep:  1000 || Speed:   1.0 MC/s (1.0e-02 s/TS)",
                                "[@     3m20s] Timestep:  2000 || Speed:   8.0 MC/s (1.2e-03 s/TS)",
                                "[@     5m00s] Timestep:  3000 || Speed:   8.2 MC/s (1.2e-03 s/TS)",
                                "[@     6m40s] Timestep:  4000 || Speed:   7.8 MC/s (1.3e-03 s/TS) || Energy: ~2.68e-17 (- 1.88dB)",
                                "Multithreaded engine using 3 threads. Utilization: (67;67;67)"].map(String::from).to_vec();
    let (vue, _, _) = lancement::_suivi_pour_essai(obj! {"arret" => obj! {"nmax" => 10000i64}}, &journal, 0);
    // le premier rapport, qui compte le montage du maillage, est ecarte
    assert!((modele::debit_suppose() - 8.0).abs() < 0.001 && modele::debit_fils() == 3);
    let a = &vue["avancement"];
    assert_eq!((a["pas"].as_i64(), a["pourcent"].as_f64(), a["energie_dB"].as_f64(), a["fils"].as_i64()), (Some(4000), Some(40.0), Some(-1.88), Some(3)));
    modele::oublier_debit();

    // LES TROIS CAS NE SE CORRIGENT PAS DE LA MEME FACON, et c'est tout l'interet du diagnostic.
    let arret = obj! {"arret" => obj! {"nmax" => 20000i64, "energie_dB" => -40.0}};
    let diag = |f: &dyn Fn(i32) -> (f64, f64)| {
        let l: Vec<String> = (1..25).map(|i| ligne(200 * i as i64, f(i).0, f(i).1)).collect();
        lancement::_suivi_pour_essai(arret.clone(), &l, 0).1.unwrap_or_default()
    };
    let d = diag(&|i| (1e-18 * 3f64.powi(i), 0.0));
    assert!(d.contains("diverge") && d.contains("maillage"), "{d}");
    let d = diag(&|i| (1e-18 * 1.3f64.powi(i), 0.0));
    assert!(d.contains("n'est pas une divergence") && d.contains("nmax") && !d.contains("maillage"), "{d}");
    let d = diag(&|i| (1e-15 * 0.85f64.powi(i), -0.55 * i as f64));
    assert!(d.contains("garde-fou") && d.contains("-40") && d.contains("13"), "{d}");
    let d = diag(&|i| (1e-15 * 0.8f64.powi(i), -2.0 * i as f64));
    assert!(d.contains("bien descendue") && !d.contains("garde-fou"), "{d}");
    let (_, d, _) = lancement::_suivi_pour_essai(arret.clone(), &[], 0);
    assert!(d.unwrap().contains("aucun pas de temps"));

    // les pannes qu'on sait nommer, et celle qu'on cite
    let code = |l: &[&str], c: i64| lancement::_suivi_pour_essai(arret.clone(), &l.iter().map(|s| s.to_string()).collect::<Vec<_>>(), c).2;
    assert!(code(&["terminate called after throwing an instance of 'std::bad_alloc'"], 134).starts_with("Memoire insuffisante"));
    assert!(code(&[], -11).starts_with("Le solveur s'est arrete brutalement (signal 11)"));
    assert_eq!(code(&["a", "b", "c", "d"], 2), "Le calcul s'est arrete (code 2) : b / c / d");
    assert_eq!(code(&[], 2), "Le calcul s'est arrete (code 2) sans rien ecrire au journal.");

    // la reciprocite : de combien S(i,j) et S(j,i) different, et ou
    let s = |re: f64| obj! {"re" => Json::Liste(vec![re.into(), 0.0.into()]), "im" => Json::Liste(vec![0.0.into(), 0.0.into()])};
    let r = lancement::_reciprocite(&[vec![s(0.5), s(0.01)], vec![s(0.013), s(0.4)]]);
    assert!((r["ecart"].as_f64().unwrap() - 0.003).abs() < 1e-12 && r["ou"].as_str() == Some("S12 / S21") && r["amplitude"].as_f64() == Some(0.01));
    let r = lancement::_reciprocite(&[vec![s(0.5), Json::Nul], vec![s(0.013), s(0.4)]]);
    assert_eq!((r["ecart"].as_f64(), r["ou"].as_str()), (Some(0.0), Some("")));
}

#[test]
fn archivage_des_calculs() {
    let (_v, racine) = poste("");
    let cible = racine.join("projet").join("calculs");
    lancement::definir_racine_calculs(racine.join("ailleurs").to_str().unwrap());
    let (ident, dossier) = lancement::_dossier_neuf().unwrap();
    std::fs::create_dir_all(dossier.join("sous")).unwrap();
    std::fs::write(dossier.join("resultats.json"), "{}").unwrap();
    std::fs::write(dossier.join("sous/E_0001.vtr"), vec![0u8; 1000]).unwrap();
    let cible_s = cible.to_str().unwrap();

    let out = lancement::archiver(&ident, cible_s).unwrap();
    assert_eq!((out["deplace"].clone(), out["deja"].clone(), out["octets"].as_i64()), (true.into(), false.into(), Some(1002)));
    let range = PathBuf::from(out["dossier"].as_str().unwrap());
    assert!(range.join("sous/E_0001.vtr").is_file() && !dossier.exists() && range.ends_with(&ident));
    // le calcul se retrouve sous le projet, une fois celui-ci ouvert
    lancement::definir_racine_calculs(cible_s);
    assert_eq!(lancement::dossier_de(&ident).unwrap().canonicalize().unwrap(), range.canonicalize().unwrap());
    let deja = lancement::archiver(&ident, cible_s).unwrap();
    assert_eq!((deja["deplace"].clone(), deja["deja"].clone()), (false.into(), true.into()));

    // la tache suit ses fichiers
    lancement::definir_racine_calculs(racine.join("ailleurs").to_str().unwrap());
    let (id2, dos2) = lancement::_dossier_neuf().unwrap();
    lancement::_inscrire_pour_essai(&id2, &dos2, "fini");
    let out = lancement::archiver(&id2, cible_s).unwrap();
    assert_eq!(lancement::dossier_de(&id2).unwrap(), PathBuf::from(out["dossier"].as_str().unwrap()));

    // on n'ecrase rien : un dossier du meme nom deja range reste intact
    let jumeau = racine.join("ailleurs").join(&ident);
    std::fs::create_dir_all(&jumeau).unwrap();
    lancement::nettoyer();
    lancement::_inscrire_pour_essai(&ident, &jumeau, "fini");
    let r = lancement::archiver(&ident, cible_s).unwrap_err();
    assert!(r.message.starts_with("Un dossier de calcul du meme nom est deja range la") && r.conseil == "Rien n'a ete touche.");
    assert!(jumeau.is_dir() && range.join("resultats.json").is_file());

    // ce qui n'est pas a nous ne se deplace pas, et sans projet il n'y a nulle part ou ranger
    assert!(lancement::archiver("../../../etc", cible_s).is_err());
    assert_eq!(lancement::archiver(&ident, "").unwrap_err().message, "Aucun dossier ou ranger ce calcul.");

    // l'identifiant neuf a la forme que le module reconnait, et ne se repete pas
    let (a, b) = (antenne::identifiant_neuf(), antenne::identifiant_neuf());
    assert!(a != b && a.len() == 12 && a.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    std::fs::create_dir_all(cible.join(&a)).unwrap();
    lancement::definir_racine_calculs(cible_s);
    assert_eq!(lancement::dossier_de(&a).unwrap(), cible.join(&a));
    let l = antenne::liste();
    assert_eq!(l["taches"][0]["id"].as_str(), Some(ident.as_str()));
}
