//! Le pilotage d'openEMS par WEB_ANTENNA, sans Python : ce que faisaient
//! python/openems_script.py, openems_run.py et openems_antenne.py (1.0.0).
//!
//!     let modele = antenne_modele::modele::normaliser(&doc)?;
//!     let sim = antenne_solveur::xml::generer(&modele.m, &modele.pieces)?;   // le XML d'openEMS
//!     let vue = antenne_solveur::antenne::lancer(&doc)?;                      // le lance et le suit
//!
//! `xml` et `ports` ecrivent ce que lit l'executable `openEMS` ; `lancement` le fait
//! tourner et suit son journal ; `depouillement` passe les sondes en frequence (S, Z, ROE)
//! et pilote `nf2ff` ; `hdf5` relit ce que `nf2ff` ecrit ; `antenne` est la porte du serveur.

pub mod antenne;
pub mod depouillement;
pub mod hdf5;
pub mod lancement;
pub mod ports;
pub mod xml;
