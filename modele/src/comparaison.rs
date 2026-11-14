//! Ce que l'outil modele_json et les essais rendent d'un document : le JSON à comparer, à
//! l'octet, avec celui du Python (voir src/bin/modele_json.rs pour les arguments).

use crate::modele::{self, Modele};
use crate::{b64, obj, pieces, Json};
use std::io::Read;

/// base64 des octets décompressés d'un `sommets_b64` / `faces_b64` : le flux zlib lui-même
/// dépend de la bibliothèque qui l'écrit, son contenu non.
fn brut(texte: &str) -> Json {
    let mut out = Vec::new();
    let z = b64::decoder(texte).unwrap_or_default();
    let _ = flate2::read::ZlibDecoder::new(&z[..]).read_to_end(&mut out);
    b64::encoder(&out).into()
}

fn geo(m: &Modele) -> Json {
    Json::Liste(pieces::corps_inclus(&m.pieces)
        .map(|(_, c)| obj! {"sommets" => brut(&pieces::sommets_b64(c)), "faces" => brut(&pieces::faces_b64(c))}).collect())
}

/// L'état du poste d'un essai : {"debits": [[mcps, fils], ...], "fils": n, "banc": {"fils": mcps}}.
pub fn poser_etat(etat: &Json) {
    modele::oublier_debit();
    for d in etat["debits"].as_liste().map(|l| l.as_slice()).unwrap_or(&[]) {
        modele::noter_debit(d[0].as_f64().unwrap_or(f64::NAN), d[1].as_i64().unwrap_or(0));
    }
    let banc = etat["banc"].as_objet().map(|o| o.iter().filter_map(|(k, v)| Some((k.parse().ok()?, v.as_f64()?))).collect::<Vec<_>>());
    modele::noter_banc(banc.unwrap_or_default());
    modele::regler_fils(etat["fils"].as_i64().unwrap_or(0));
}

/// Le modèle (« normaliser »), le balayage ou le tableau S d'un document ; un refus sort en
/// {"erreur": ..., "conseil": ...}. `avec_geo` ajoute « _geo » au modèle.
pub fn rendu(mode: &str, doc: &Json, avec_geo: bool) -> Json {
    let rendu = match mode {
        "balayage" => modele::balayage(doc).map(|s| s.json),
        "tableau_s" => modele::tableau_s(doc).map(|s| s.json),
        _ => modele::normaliser(doc).map(|m| {
            let mut json = pieces::sans_geometrie(&m).clone();
            if let (true, Json::Objet(o)) = (avec_geo, &mut json) {
                o.insert("_geo".into(), geo(&m));
            }
            json
        }),
    };
    rendu.unwrap_or_else(|e| obj! {"erreur" => e.message, "conseil" => e.conseil})
}
