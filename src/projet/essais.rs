//! Ce que python/test/banc-openems.py verifiait des projets (sa section 15) : les refus
//! d'abord — un nom de projet arrive d'une requete HTTP et devient un nom de dossier —,
//! puis le rangement d'un calcul deja fait, la liste des calculs et l'import.

use super::*;
use antenne_solveur::lancement;

/// La racine, le projet ouvert et le reglage du poste sont globaux : un essai a la fois.
static VERROU: Mutex<()> = Mutex::new(());

fn bac(nom: &str) -> String {
    let d = std::env::temp_dir().join(format!("{}-{}", nom, std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    realpath(&d.to_string_lossy()).to_string_lossy().into_owned()
}

fn doc(texte: &str) -> Json {
    json_depuis_texte(texte).unwrap()
}

fn fichier(dossier: &str, nom: &str) -> bool {
    Path::new(dossier).join(nom).is_file()
}

fn noms(liste: &[Json], cle: &str) -> Vec<String> {
    liste.iter().map(|p| p[cle].as_str().unwrap().to_string()).collect()
}

#[test]
fn ecritures_et_formes() {
    let v = doc(r#"{"a": [1, 2.5, "x, y: z \" , "], "b": {"c": null, "é": true}}"#);
    assert_eq!(compact(&v), r#"{"a":[1,2.5,"x, y: z \" , "],"b":{"c":null,"é":true}}"#);
    assert_eq!(abspath("/a/b/../c/./d"), "/a/c/d");
    assert_eq!((extension("a/b.tar.GZ"), extension(".cache"), extension("sans")), (".GZ", "", ""));
    assert_eq!(developper("${HOME}/x"), format!("{}/x", std::env::var("HOME").unwrap()));
    assert_eq!(developper("$INCONNUE_DE_TOUS/x"), "$INCONNUE_DE_TOUS/x");
    assert_eq!(developper("~/x"), joindre(&maison(), "x"));
    assert_eq!((entier(&doc("3.7")), entier(&doc("\"4\"")), entier(&doc("\"4.2\"")), entier(&doc("-2")), entier(&doc("[1]"))), (3, 4, 0, 0, 0));
    assert_eq!((flottant(&doc("\"12.5\"")), flottant(&doc("null")), flottant(&doc("{\"a\": 1}"))), (Some(12.5), Some(0.0), None));
}

#[test]
fn projets() {
    let _v = verrou(&VERROU);
    let bac = bac("banc-projets");
    let travail = joindre(&bac, "travail");
    std::fs::create_dir_all(&travail).unwrap();
    poser_racine(Some(travail.clone()));

    let out = enregistrer(&doc(
        r#"{"nom": "Patch 2,45 GHz", "titre": "un essai", "source": "dessin", "fichier": "patch-2450.xml",
            "dessin": {"elements": [{"k": "rect"}], "carte": {"L": 40, "W": 47}},
            "antenne": {"bande": {"f1": 2.3e9, "f2": 2.6e9}}, "carte": {"couches": [], "nets": ["GND"]}}"#,
    ))
    .unwrap();
    let dossier = out["dossier"].as_str().unwrap().to_string();
    // un projet s'ecrit dans un sous-dossier a son nom
    assert!(Path::new(&dossier).is_dir() && basename(&dossier) == "Patch 2,45 GHz");
    // les trois fichiers sont separes
    assert!(fichier(&dossier, "projet.json") && fichier(&dossier, "carte.json") && !fichier(&dossier, "resultats.json"));
    // l'ecriture est celle de json.dump(..., separators=(",", ":"))
    assert_eq!(std::fs::read_to_string(joindre(&dossier, "carte.json")).unwrap(), r#"{"couches":[],"nets":["GND"]}"#);

    let relu = ouvrir("Patch 2,45 GHz").unwrap();
    // ce qui est relu est ce qui a ete ecrit
    assert_eq!(dumps(&relu["dessin"]["elements"]), r#"[{"k": "rect"}]"#);
    assert_eq!((dumps(&relu["carte"]["nets"]), &relu["resultats"]), (r#"["GND"]"#.to_string(), &Json::Nul));
    // le nom du fichier d'origine survit a l'aller-retour : il voyage jusque dans le document envoye au solveur
    assert_eq!(relu["fichier"].as_str(), Some("patch-2450.xml"));
    let cles: Vec<&String> = relu.as_objet().unwrap().keys().collect();
    assert_eq!(cles, ["format", "version", "nom", "titre", "cree", "modifie", "outil", "source", "fichier", "dessin", "antenne", "affichage", "dossier", "carte", "resultats"]);

    // lire un projet ne change pas le projet courant
    enregistrer(&doc(r#"{"nom": "Voisin"}"#)).unwrap();
    assert_eq!(lire("Patch 2,45 GHz").unwrap()["nom"].as_str(), Some("Patch 2,45 GHz"));
    assert_eq!(ouvert().map(|(nom, _)| nom).as_deref(), Some("Voisin"));
    std::fs::remove_dir_all(joindre(&travail, "Voisin")).unwrap();
    ouvrir("Patch 2,45 GHz").unwrap();

    // UNE CARTE ABSENTE N'EST PAS UNE CARTE NULLE, et confondre les deux
    // effacerait des dizaines de mega-octets a chaque changement de frequence.
    enregistrer(&doc(r#"{"nom": "Patch 2,45 GHz", "dessin": {"elements": []}}"#)).unwrap();
    assert!(fichier(&dossier, "carte.json"), "une carte ABSENTE de la charge n'est pas reecrite");
    enregistrer(&doc(r#"{"nom": "Patch 2,45 GHz", "carte": null}"#)).unwrap();
    assert!(!fichier(&dossier, "carte.json"), "une carte NULLE est effacee");

    // la liste rend le projet, du plus recent au plus ancien
    assert_eq!(noms(&liste(), "nom"), ["Patch 2,45 GHz"]);

    // les calculs vont dans le projet ouvert
    assert_eq!(dossier_calculs(), joindre(&dossier, "calculs"));
    fermer();
    // aucun projet ouvert : les calculs retombent dans le temporaire
    assert_eq!(dossier_calculs(), "");

    // Les refus. Chacun est un chemin qui sortirait de la racine, ou un nom
    // que le systeme de fichiers ne peut pas porter.
    let long = "x".repeat(81);
    for (mauvais, pourquoi) in [
        ("..", "remonter d'un cran"),
        ("../autre", "remonter et redescendre"),
        ("a/b", "un separateur"),
        ("a\\b", "un separateur Windows"),
        ("C:\\Windows", "un chemin absolu"),
        ("CON", "un peripherique Windows"),
        ("nul.json", "un peripherique deguise"),
        ("fin.", "un point final"),
        (".cache", "un point en tete (dossier cache)"),
        (long.as_str(), "quatre-vingt-un caracteres"),
        ("", "rien du tout"),
    ] {
        assert!(_verifier_nom(mauvais).is_err(), "refuse un nom de projet : {} (« {} » a ete accepte)", pourquoi, mauvais);
    }
    assert_eq!(_verifier_nom("  lpt10 ").unwrap(), "lpt10");
    assert!(_verifier_nom("Com7.txt").is_err() && _verifier_nom(&"é".repeat(80)).is_ok());

    // ouvrir un projet absent est refuse, et le dit
    let exc = ouvrir("il-n-existe-pas").unwrap_err();
    assert!(exc.message.contains("il-n-existe-pas") && !exc.conseil.is_empty());

    // Un dossier qui n'est pas un projet ne doit ni apparaitre dans la liste,
    // ni s'ouvrir : on n'ecrit pas dans un dossier qu'on n'a pas fabrique.
    std::fs::create_dir_all(joindre(&travail, "pas-un-projet")).unwrap();
    assert_eq!(noms(&liste(), "nom"), ["Patch 2,45 GHz"]);
    assert!(ouvrir("pas-un-projet").is_err(), "ouvrir un dossier quelconque est refuse");
    // un lien depose dans la racine ne fait pas sortir du dossier de travail
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&bac, joindre(&travail, "lien")).unwrap();
        assert!(ouvrir("lien").unwrap_err().message.starts_with("Ce nom sort du dossier de travail"));
    }

    // « ENREGISTRER SOUS » UN PROJET EXISTANT N'EFFACE PAS SA CARTE NI SES
    // RESULTATS sans l'accord (`ecraser`) que la page demande avant.
    let autre = enregistrer(&doc(r#"{"nom": "Autre", "carte": {"nets": []}, "resultats": {"r": 1}}"#)).unwrap()["dossier"].as_str().unwrap().to_string();
    enregistrer(&doc(r#"{"nom": "Patch 2,45 GHz"}"#)).unwrap(); // l'ouvert change
    let exc = enregistrer(&doc(r#"{"nom": "Autre", "carte": null, "resultats": null}"#)).unwrap_err();
    assert_eq!(exc.message, "Le projet « Autre » existe deja : l'enregistrer sous ce nom supprimerait carte.json et resultats.json.");
    // ... et sa carte et ses resultats sont toujours la
    assert!(fichier(&autre, "carte.json") && fichier(&autre, "resultats.json"));
    enregistrer(&doc(r#"{"nom": "Autre", "resultats": null, "ecraser": true}"#)).unwrap();
    assert!(!fichier(&autre, "resultats.json"), "avec l'accord, ses resultats s'effacent");
    std::fs::remove_dir_all(&autre).unwrap();
    fermer();

    // Le reglage du poste : lire-modifier-ecrire sous verrou, par .tmp.
    let cfg = joindre(&bac, "config.json");
    verrou(&POSTE).config = Some(cfg.clone());
    let fils: Vec<_> = ["a", "b", "c", "d", "e", "f"]
        .into_iter()
        .map(|k| std::thread::spawn(move || (0..30).for_each(|i| _config_ecrire(k, Json::Entier(i)))))
        .collect();
    fils.into_iter().for_each(|f| f.join().unwrap());
    // six ecrivains en meme temps ne perdent aucune cle
    assert_eq!(dumps(&Json::Objet(_config_lire())).len(), r#"{"a": 29, "b": 29, "c": 29, "d": 29, "e": 29, "f": 29}"#.len());
    assert!("abcdef".chars().all(|k| _config_lire()[&k.to_string()] == Json::Entier(29)));
    assert!(!Path::new(&format!("{}.tmp", cfg)).exists(), "reglage : aucun .tmp ne traine");

    // le debit, les fils et le banc : rien n'est reecrit quand la valeur n'a pas bouge
    assert_eq!((debit_lu(), debit_fils_lu(), fils_lu()), (0.0, 0, 0));
    assert_eq!((debit_noter(31.5, 4), debit_lu(), debit_fils_lu()), (31.5, 31.5, 4));
    assert_eq!(debit_noter(0.0, 0), debit_lu());
    assert_eq!((fils_noter(-3), fils_noter(6), fils_lu()), (0, 6, 6));
    let table = doc(r#"{"1": 20.0, "4": 61.5}"#);
    assert_eq!((banc_noter(&table), banc_lu(), banc_noter(&obj! {})), (table.clone(), table.clone(), table));
    let date = std::fs::metadata(&cfg).unwrap().modified().unwrap();
    debit_noter(31.5, 4);
    fils_noter(6);
    banc_noter(&banc_lu());
    assert_eq!(std::fs::metadata(&cfg).unwrap().modified().unwrap(), date);
    verrou(&POSTE).config = None;

    // ----------------------------------------------------------------------
    // RANGER UN CALCUL DEJA FAIT DANS LE PROJET.
    //
    // CE QUE CETTE PARTIE PROTEGE. Le cas courant n'est pas « ouvrir un projet
    // puis lancer » : c'est lancer, regarder la courbe deux heures plus tard,
    // et nommer son travail seulement s'il a donne quelque chose. Les champs
    // sont alors dans le dossier temporaire du systeme, et les y laisser
    // revient a les perdre au premier nettoyage de disque. Ce qui doit tenir,
    // c'est que le deplacement suive sa tache (sans quoi la visionneuse
    // cherche a l'ancienne adresse), qu'il refuse un calcul en cours, et
    // qu'il n'ecrase jamais rien.
    let tmp = self::bac("banc-calculs");
    let ailleurs = joindre(&tmp, "ailleurs");
    lancement::definir_racine_calculs(&ailleurs);
    let (id, dos) = lancement::_dossier_neuf().unwrap();
    std::fs::write(dos.join("J_xy_000.vtr"), "x".repeat(4096)).unwrap();

    enregistrer(&doc(r#"{"nom": "Patch 2,45 GHz"}"#)).unwrap();
    let cible = dossier_calculs();
    let out = lancement::archiver(&id, &cible).unwrap();
    let range = out["dossier"].as_str().unwrap().to_string();
    // le dossier de calcul est deplace dans le projet
    assert!(out["deplace"].vrai() && realpath(&range) == realpath(&joindre(&cible, &id)));
    assert!(!dos.is_dir(), "... et il ne reste rien a l'ancienne adresse");
    assert!(fichier(&range, "J_xy_000.vtr"), "... avec les champs dedans");
    assert_eq!(out["octets"].as_i64(), Some(4096), "... et son poids est annonce");

    // La tache n'existe qu'en memoire ici ; c'est la base des calculs qui
    // doit permettre de retrouver le dossier, comme apres un redemarrage.
    lancement::definir_racine_calculs(&cible);
    assert_eq!(lancement::dossier_de(&id).unwrap(), PathBuf::from(&range), "le calcul se retrouve a sa nouvelle adresse");
    let deja = lancement::archiver(&id, &cible).unwrap();
    assert!(deja["deja"].vrai() && !deja["deplace"].vrai(), "archiver deux fois ne fait rien la seconde");

    // Un calcul qui tourne ne se deplace pas : openEMS ecrit dedans.
    lancement::definir_racine_calculs(&ailleurs);
    let (id2, dos2) = lancement::_dossier_neuf().unwrap();
    lancement::_inscrire_pour_essai(&id2, &dos2, "calcule");
    assert!(lancement::archiver(&id2, &cible).is_err(), "un calcul en cours ne se deplace pas");
    assert!(dos2.is_dir(), "... et ses fichiers n'ont pas bouge");

    // Rien ne s'ecrase : un dossier deja range porte le meme identifiant.
    let jumeau = dos2.parent().unwrap().join(&id);
    std::fs::rename(&dos2, &jumeau).unwrap();
    lancement::nettoyer();
    lancement::_inscrire_pour_essai(&id, &jumeau, "fini");
    assert!(lancement::archiver(&id, &cible).is_err(), "un dossier deja range n'est jamais ecrase");
    assert!(fichier(&range, "J_xy_000.vtr"), "... et les champs ranges sont toujours la");

    // Un identifiant qui n'est pas un des notres n'ouvre aucun chemin.
    for faux in ["..", "../../windows", "n-importe-quoi", ""] {
        assert!(lancement::archiver(faux, &cible).is_err(), "un identifiant invente est refuse : {:?}", faux);
    }
    assert!(lancement::archiver(&id, "").is_err(), "sans projet ouvert, archiver est refuse");
    lancement::nettoyer();

    // ------------------------------------------------------------------
    // LISTER LES CALCULS, ET EN IMPORTER UN D'AILLEURS.
    //
    // CE QUE CETTE PARTIE PROTEGE. `resultats.json` ne retient qu'UN
    // calcul ; un projet en accumule un par simulation. La liste est le
    // seul moyen d'atteindre les autres, et l'import le seul moyen de
    // faire entrer le calcul d'un collegue. Ce qui doit tenir, c'est que
    // l'import COPIE — la source d'un tiers ne se deplace jamais —, qu'il
    // ne prenne que ce qui appartient a un dossier de calcul, et qu'un
    // dossier sans champ soit refuse plutot qu'accepte a vide.
    // Les calculs suivent le projet ouvert : c'est ce que le serveur
    // refait apres chaque ouverture et chaque enregistrement (_pr_suivre).
    lancement::definir_racine_calculs(&cible);

    let l = calculs().unwrap();
    assert_eq!(noms(&l, "id"), std::slice::from_ref(&id), "la liste rend le calcul archive");
    // ... avec son compte de champs et son poids, et il n'est pas marque comme importe
    assert_eq!((l[0]["vtr"].as_i64(), l[0]["octets"].as_i64(), &l[0]["importe"]), (Some(1), Some(4096), &Json::Nul));

    let dehors = joindre(&joindre(&tmp, "cle-usb"), "run-du-collegue");
    std::fs::create_dir_all(joindre(&dehors, "nf2ff")).unwrap();
    for n in ["Jt_xy_000.vtr", "Jt_xy_001.vtr"] {
        std::fs::write(joindre(&dehors, n), "y".repeat(512)).unwrap();
    }
    std::fs::write(joindre(&dehors, "simulation.py"), "# script\n").unwrap();
    std::fs::write(joindre(&dehors, "notes.docx"), "z".repeat(64)).unwrap();
    std::fs::write(joindre(&dehors, "nf2ff/nf2ff.h5"), "h".repeat(32)).unwrap();

    let neuf = lancement::identifiant_neuf();
    let imp = importer_calcul(&dehors, &neuf).unwrap();
    let importe = imp["dossier"].as_str().unwrap().to_string();
    // un dossier venu d'ailleurs entre dans le projet
    assert_eq!((imp["id"].as_str(), imp["vtr"].as_i64(), imp["fichiers"].as_i64(), imp["octets"].as_i64()), (Some(neuf.as_str()), Some(2), Some(4), Some(1065)));
    // ... et le .docx n'est pas venu avec ; le sous-dossier, si
    assert!(imp["ignores"].as_i64() == Some(1) && !fichier(&importe, "notes.docx") && fichier(&importe, "nf2ff/nf2ff.h5"));
    assert!(fichier(&dehors, "Jt_xy_000.vtr") && fichier(&dehors, "notes.docx"), "... LA SOURCE N'A PAS BOUGE");
    // ... et il se retrouve comme n'importe quel calcul
    assert_eq!(lancement::dossier_de(&neuf).unwrap(), PathBuf::from(&importe));

    let l = calculs().unwrap();
    assert_eq!(l.len(), 2, "la liste rend les deux calculs");
    let fiche = &l.iter().find(|c| c["id"].as_str() == Some(neuf.as_str())).unwrap()["importe"];
    // ... et dit d'ou vient celui qui a ete importe
    assert!(fiche["nom"].as_str() == Some("run-du-collegue") && realpath(fiche["source"].as_str().unwrap()) == realpath(&dehors));

    for (quoi, ou) in [
        ("un dossier sans le moindre .vtr", tmp.clone()),
        ("un dossier qui n'existe pas", joindre(&tmp, "nulle-part")),
        ("un fichier au lieu d'un dossier", joindre(&dehors, "notes.docx")),
        ("rien du tout", "   ".to_string()),
        ("un dossier deja dans le projet", importe.clone()),
    ] {
        assert!(importer_calcul(&ou, &lancement::identifiant_neuf()).is_err(), "importer est refuse : {}", quoi);
    }
    assert_eq!(calculs().unwrap().len(), 2, "aucun de ces refus n'a laisse de dossier a moitie copie");
    // une fiche d'import abimee ne se tait pas
    std::fs::write(joindre(&importe, F_IMPORT), "{").unwrap();
    assert!(calculs().unwrap_err().message.starts_with("« import.json » est illisible"));

    // sans projet ouvert : nulle part ou ranger, et rien a lister
    fermer();
    assert_eq!(importer_calcul(&dehors, &neuf).unwrap_err().message, "Aucun projet n'est ouvert.");
    assert!(calculs().unwrap().is_empty());

    lancement::definir_racine_calculs("");
    poser_racine(None);
    let _ = std::fs::remove_dir_all(&tmp);
    let _ = std::fs::remove_dir_all(&bac);
}
