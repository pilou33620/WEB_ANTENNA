//! Le modèle d'antenne de WEB_ANTENNA, en Rust : le portage de python/openems_pieces.py,
//! openems_modele.py et openems_champs.py (1.0.0).
//!
//!     let doc = antenne_modele::json_depuis_texte(&texte)?;        // le document de la page
//!     let modele = antenne_modele::modele::normaliser(&doc)?;      // vérifié, complété, maillé
//!     let json = antenne_modele::dumps(&modele.m);                 // ce que la page reçoit
//!
//! Le JSON rendu est, à l'octet, celui de `json.dumps(..., ensure_ascii=False)` du Python
//! (essais/ garde des sorties de référence). Le pilotage d'openEMS n'est pas ici.

pub mod b64;
pub mod champs;
pub mod comparaison;
pub mod modele;
pub mod outils;
pub mod pieces;

pub use ipc2581::py::{dumps, Json, Objet};
pub use outils::json_depuis_texte;

#[cfg(test)]
mod essais;
