//! Un document de la page -> le XML d'openEMS, ou le depouillement d'un dossier de calcul.
//!
//!     antenne_xml document.json                 # le XML sur la sortie standard
//!     antenne_xml --ports document.json         # les sondes de chaque port, en JSON
//!     antenne_xml --depouiller document.json DOSSIER
//!
//! `--depouiller` relit les sondes de DOSSIER (et son nf2ff.h5 s'il y est) et rend le JSON
//! des resultats : c'est aussi l'outil qui a servi a la comparaison avec numpy (essais/LISEZ-MOI.md).

use antenne_modele::{dumps, json_depuis_texte, modele, obj, Json};
use antenne_solveur::{depouillement, xml};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (mode, reste): (&str, &[String]) = match args.first().map(|s| s.as_str()) {
        Some("--depouiller") => ("depouiller", &args[1..]),
        Some("--ports") => ("ports", &args[1..]),
        _ => ("xml", &args[..]),
    };
    let Some(chemin) = reste.first() else {
        eprintln!("usage : antenne_xml [--ports | --depouiller] document.json [DOSSIER]");
        std::process::exit(2);
    };
    let echec = |e: String| -> ! {
        eprintln!("{e}");
        std::process::exit(1);
    };
    let texte = std::fs::read_to_string(chemin).unwrap_or_else(|e| echec(format!("{chemin} : {e}")));
    let doc = json_depuis_texte(&texte).unwrap_or_else(|e| echec(format!("{chemin} : {e}")));
    let m = modele::normaliser(&doc).unwrap_or_else(|e| echec(format!("{} {}", e.message, e.conseil)));
    let sim = xml::generer(&m.m, &m.pieces).unwrap_or_else(|e| echec(format!("{} {}", e.message, e.conseil)));
    match mode {
        "xml" => print!("{}", sim.xml),
        "ports" => println!("{}", dumps(&Json::Liste(sim.ports.iter().map(|p| obj! {
            "n" => p.n, "u" => Json::Liste(p.u.iter().map(|s| s.as_str().into()).collect()),
            "i" => Json::Liste(p.i.iter().map(|s| s.as_str().into()).collect())}).collect()))),
        _ => {
            let dossier = std::path::Path::new(reste.get(1).map(|s| s.as_str()).unwrap_or("."));
            let p = depouillement::depouiller_ports(&m.m, &sim.ports, dossier).unwrap_or_else(|e| echec(e));
            let nf = dossier.join("nf2ff.h5");
            let nf = (m.m["nf2ff"]["actif"].vrai() && nf.is_file()).then(|| {
                let n = |k: &str| m.m["nf2ff"][k].as_liste().map(|l| l.len()).unwrap_or(0);
                depouillement::lire_nf2ff(&nf, n("theta"), n("phi")).unwrap_or_else(|e| echec(e))
            });
            let journal_nf = nf.as_ref().map(|nf| {
                // le XML de nf2ff, tel que le lancement l'ecrit
                let _ = std::fs::write(dossier.join("nf2ff.xml"), depouillement::xml_nf2ff(&m.m, p.freq[p.i0], &sim.nf2ff));
                let (p_inc, p_acc) = depouillement::puissances(&m.m, &sim.ports, &p);
                depouillement::journal_nf2ff(nf, p_inc, p_acc)
            });
            for l in p.journal.iter().chain(journal_nf.iter().flatten()) {
                eprintln!("{l}");
            }
            println!("{}", dumps(&depouillement::resultats(&m.m, &sim.ports, &p, nf.as_ref())));
        }
    }
}
