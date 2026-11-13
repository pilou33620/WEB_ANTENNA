//! L'outil de comparaison avec le Python : un document de la page -> le JSON du modèle, tel
//! que `json.dumps(openems_pieces.sans_geometrie(openems_modele.normaliser(doc)),
//! ensure_ascii=False)` l'écrit. Un refus sort en {"erreur": ..., "conseil": ...}.
//!
//!     modele_json [--balayage | --tableau-s] [--geo] [--debit MCPS:FILS]... [--fils N]
//!                 [--banc FILS=MCPS,...] document.json
//!     modele_json --champs-inventaire DOSSIER
//!     modele_json --champs-serie DOSSIER CLE [AXE [INDICE [MAX_POINTS [MAX_TRAMES]]]]
//!
//! `--geo` ajoute « _geo » : les sommets et les faces placés de chaque corps simulé, tirés de
//! `sommets_b64` et `faces_b64` puis décompressés (le flux zlib, lui, n'est pas comparable).
//! `--debit`, `--fils` et `--banc` posent l'état du poste avant le calcul.

use antenne_modele::{champs, comparaison, dumps, json_depuis_texte, modele, obj, Json};

fn refus(message: &str, conseil: &str) -> Json {
    obj! {"erreur" => message, "conseil" => conseil}
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut mode = "normaliser";
    let (mut avec_geo, mut reste) = (false, Vec::new());
    let mut i = 0;
    while i < args.len() {
        let suivant = || args.get(i + 1).cloned().unwrap_or_default();
        match args[i].as_str() {
            "--balayage" => mode = "balayage",
            "--tableau-s" => mode = "tableau_s",
            "--champs-inventaire" => mode = "inventaire",
            "--champs-serie" => mode = "serie",
            "--geo" => avec_geo = true,
            "--debit" => {
                let v = suivant();
                let (m, f) = v.split_once(':').unwrap_or((&v, "0"));
                modele::noter_debit(m.parse().unwrap_or(f64::NAN), f.parse().unwrap_or(0));
                i += 1;
            }
            "--fils" => {
                modele::regler_fils(suivant().parse().unwrap_or(0));
                i += 1;
            }
            "--banc" => {
                modele::noter_banc(suivant().split(',').filter_map(|kv| {
                    let (k, v) = kv.split_once('=')?;
                    Some((k.parse().ok()?, v.parse().ok()?))
                }));
                i += 1;
            }
            _ => reste.push(args[i].clone()),
        }
        i += 1;
    }
    let arg = |k: usize| reste.get(k).map(|s| s.as_str()).unwrap_or("");
    let champ = |r: Result<Json, champs::ErreurChamps>| r.unwrap_or_else(|e| refus(&e.message, &e.conseil));
    let sortie = match mode {
        "inventaire" => champ(champs::inventaire(std::path::Path::new(arg(0)))),
        "serie" => champ(champs::serie(std::path::Path::new(arg(0)), arg(1), arg(2), arg(3).parse().ok(),
                                       arg(4).parse().unwrap_or(0), arg(5).parse().unwrap_or(0))),
        _ => {
            let texte = std::fs::read_to_string(arg(0)).unwrap_or_else(|e| {
                eprintln!("{} : {e}", arg(0));
                std::process::exit(2);
            });
            let doc = json_depuis_texte(&texte).unwrap_or_else(|e| {
                eprintln!("{} : {e}", arg(0));
                std::process::exit(2);
            });
            comparaison::rendu(mode, &doc, avec_geo)
        }
    };
    println!("{}", dumps(&sortie));
}
