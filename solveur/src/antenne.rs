//! La porte unique de l'outil « Antenne openEMS » : ce que le serveur appelle.
//! Le portage de python/openems_antenne.py (1.0.0, 2026-09-14).
//!
//!   Le serveur n'appelle que ce module, et n'en connait que ses fonctions.
//!   Tout le reste — la lecture du document, le maillage, l'ecriture du XML,
//!   le lancement du solveur — est derriere.
//!
//!   DEUX DISPONIBILITES DISTINCTES. Le modele ne depend de rien et fonctionne
//!   toujours : l'assistant, les verifications et l'export s'obtiennent sur
//!   n'importe quel poste. Le lancement, lui, a besoin d'openEMS installe. La
//!   reponse d'`etat` dit exactement ce qui marche et ce qui ne marche pas.
//!
//! Fonctions : etat, preparer, script, balayage, tableau_s, lancer,
//!            lancer_balayage, lancer_tableau_s, journal, arreter, liste,
//!            dossier, dossier_calculs, archiver_calcul, identifiant_neuf,
//!            debit, debit_noter, fils, regler_fils, banc_noter, lancer_banc,
//!            champs, champ

use antenne_modele::modele::{self, ErreurModele};
use antenne_modele::{champs as lecteur, obj, pieces, Json};

use crate::{lancement, xml};

pub use antenne_modele::modele::MAX_CORPS;

type Res<T> = Result<T, ErreurModele>;

fn poser(o: &mut Json, cle: &str, v: impl Into<Json>) {
    if let Json::Objet(o) = o {
        o.insert(cle.to_string(), v.into());
    }
}

/// Ce que ce poste sait faire, et ce qu'il ne sait pas.
///
/// Deux disponibilites distinctes, et la page les distingue : « preparer »
/// marche toujours, « lancer » demande openEMS. Une interface qui se
/// contenterait d'un booleen unique se griserait entierement sur un poste
/// ou l'on peut parfaitement preparer une simulation et exporter son fichier.
pub fn etat() -> Json {
    let mut out = modele::etat();
    poser(&mut out, "preparer", true);
    // La visionneuse de champs est interne a l'outil : elle marche solveur present ou non.
    poser(&mut out, "visionneuse", true);
    poser(&mut out, "script", true);
    let solveur = lancement::etat(false);
    poser(&mut out, "lancer", solveur["dispo"].vrai());
    poser(&mut out, "fils", fils());
    if !solveur["dispo"].vrai() {
        poser(&mut out, "lancer_detail", solveur["detail"].as_str().unwrap_or(""));
        poser(&mut out, "lancer_conseil", solveur["conseil"].as_str().unwrap_or(""));
    }
    poser(&mut out, "solveur", solveur);
    out
}

/// Verifie et complete le document. C'est l'appel de l'assistant : il a
/// lieu a chaque modification d'un champ, et il ne calcule rien de lourd.
///
/// Les triangles des pieces importees ne remontent pas : la page les a deja,
/// c'est elle qui les a envoyes.
pub fn preparer(doc: &Json) -> Res<Json> {
    Ok(pieces::sans_geometrie(&modele::normaliser(doc)?).clone())
}

/// Ce qu'on exporte : le XML d'openEMS, en texte, et son lisez-moi. Rien n'est ecrit sur
/// le disque. La cle « script » garde son nom : c'est celle que la page telecharge.
pub fn script(doc: &Json) -> Res<Json> {
    let m = modele::normaliser(doc)?;
    let sim = xml::generer(&m.m, &m.pieces)?;
    let nom = m.m["nom"].as_str().filter(|n| !n.is_empty()).unwrap_or("antenne");
    let nom = format!("{}_openems.xml", nom.rsplit_once('.').map(|(a, _)| a).unwrap_or(nom));
    Ok(obj! {"nom" => nom.clone(), "script" => sim.xml, "lisez_moi" => xml::lisez_moi(&m.m, &nom),
             "estimation" => m.m["estimation"].clone(), "avis" => m.m["avis"].clone()})
}

pub fn lancer(doc: &Json) -> Res<Json> {
    lancement::lancer(modele::normaliser(doc)?)
}

/// Prepare un balayage : N documents -> N modeles verifies, sans rien
/// lancer. C'est le pendant de `preparer` : la page l'appelle pour chiffrer
/// la plage avant de s'engager — combien de points, combien de cellules,
/// combien de temps — et pour se faire refuser tout de suite un point qui ne
/// tient pas debout.
pub fn balayage(doc: &Json) -> Res<Json> {
    let bal = modele::balayage(doc)?.json;
    // Les modeles complets ne remontent pas a la page : une trentaine de
    // maillages entiers font des megaoctets de JSON pour un tableau de trois
    // colonnes. Ce qui remonte, c'est ce qui se lit.
    Ok(obj! {
        "nom" => bal["nom"].clone(), "unite" => bal["unite"].clone(), "estimation" => bal["estimation"].clone(),
        "points" => Json::Liste(bal["points"].as_liste().into_iter().flatten().map(|p| obj! {
            "etiquette" => p["etiquette"].clone(), "valeur" => p["valeur"].clone(),
            "cellules" => p["modele"]["estimation"]["cellules"].clone(), "avis" => p["modele"]["avis"].clone()}).collect()),
    })
}

/// Chiffre un tableau S complet sans rien lancer : combien de colonnes,
/// combien de cellules, combien de temps. Le refus arrive AVANT l'engagement.
pub fn tableau_s(doc: &Json) -> Res<Json> {
    let ts = modele::tableau_s(doc)?.json;
    Ok(obj! {
        "ports" => ts["ports"].clone(), "estimation" => ts["estimation"].clone(),
        "colonnes" => Json::Liste(ts["colonnes"].as_liste().into_iter().flatten().map(|c| obj! {
            "n" => c["n"].clone(), "nom" => c["nom"].clone(),
            "cellules" => c["modele"]["estimation"]["cellules"].clone(), "avis" => c["modele"]["avis"].clone()}).collect()),
    })
}

pub fn lancer_tableau_s(doc: &Json) -> Res<Json> {
    lancement::lancer_tableau_s(modele::tableau_s(doc)?)
}

pub fn lancer_balayage(doc: &Json) -> Res<Json> {
    lancement::lancer_balayage(modele::balayage(doc)?)
}

pub fn journal(ident: &str, depuis: usize) -> Res<Json> {
    lancement::journal(ident, depuis)
}

pub fn arreter(ident: &str) -> Res<Json> {
    lancement::arreter(ident)
}

pub fn liste() -> Json {
    lancement::liste_taches()
}

/// Ouvre le dossier de calcul dans l'explorateur du systeme.
pub fn dossier(ident: &str) -> Res<Json> {
    lancement::ouvrir_dossier(ident)
}

// ==========================================================================
// Regarder les champs SANS quitter l'outil
// ==========================================================================
fn de_champs(e: lecteur::ErreurChamps) -> ErreurModele {
    ErreurModele { message: e.message, conseil: e.conseil }
}

/// Ce que ce calcul a laisse a regarder : la liste, sans les donnees.
///
/// Ne lit que des noms de fichiers : un dossier de plusieurs giga-octets
/// repond instantanement.
pub fn champs(ident: &str) -> Res<Json> {
    lecteur::inventaire(&lancement::dossier_de(ident)?).map_err(de_champs)
}

/// Une carte de champ, prete a animer dans la page.
///
/// `cle` designe une serie de l'inventaire ; `axe` et `indice` decoupent la
/// tranche a regarder quand l'enregistrement est un volume. Aucun nom de
/// fichier ne circule : la page ne connait que des cles.
pub fn champ(ident: &str, cle: &str, axe: &str, indice: Option<i64>, max_points: usize) -> Res<Json> {
    lecteur::serie(&lancement::dossier_de(ident)?, cle, axe, indice, max_points, 0).map_err(de_champs)
}

/// Le debit sur lequel les durees sont annoncees, et d'ou il vient.
///
/// Le serveur le lit apres chaque calcul pour le ranger dans les reglages du
/// poste : c'est lui qui fait le pont, parce que le projet ne sait pas
/// qu'openEMS existe et que le lancement ne sait pas ce qu'est un projet.
pub fn debit() -> Json {
    // `mcps_brut` ET NON `mcps` VA DANS LES REGLAGES : `mcps` est ramene au
    // nombre de fils du moment, et le ranger puis le ramener une seconde fois
    // au redemarrage compterait le gain deux fois.
    let brut = modele::debit_mesure();
    obj! {"mcps" => modele::debit_suppose(), "mcps_brut" => brut.map(Json::from).unwrap_or(Json::Nul),
          "fils" => modele::debit_fils(), "mesure" => brut.is_some(), "n" => modele::debit_n()}
}

/// Recolle un debit retenu d'une session precedente. Sans effet s'il est
/// nul ou hors des bornes du plausible — un reglage abime ne doit pas faire
/// annoncer des heures pour une minute.
pub fn debit_noter(mcps: f64, fils_mesure: i64) -> Option<f64> {
    modele::noter_debit(mcps, fils_mesure)
}

/// Le reglage des fils de calcul, et ce que le banc en sait.
///
/// Le serveur le range dans les reglages du poste, comme le debit : c'est
/// une propriete de la machine, pas de l'antenne.
pub fn fils() -> Json {
    let coeurs = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0);
    obj! {
        "regle" => modele::fils_regle(),
        // Ce que les calculs recoivent : le reglage, ou le meilleur du banc
        // quand le reglage est « Auto ».
        "effectif" => modele::fils_effectif(), "coeurs" => coeurs, "max" => modele::FILS_MAX,
        "banc" => Json::Objet(modele::banc().into_iter().map(|(k, v)| (k.to_string(), v.into())).collect()),
        "meilleur" => modele::banc_meilleur(),
        "essais" => Json::Liste(lancement::fils_a_essayer(Some(coeurs)).into_iter().map(Json::from).collect()),
        // Le banc qui tourne, s'il y en a un -- celui du demarrage que la
        // page n'a pas lance, et qu'elle doit pourtant pouvoir suivre.
        "banc_tache" => lancement::banc_en_cours(),
    }
}

pub fn regler_fils(n: i64) -> Json {
    modele::regler_fils(n);
    fils()
}

/// Recolle un banc de vitesse d'une session precedente.
pub fn banc_noter(mesures: impl IntoIterator<Item = (i64, f64)>) -> Json {
    modele::noter_banc(mesures);
    fils()
}

/// Demarre le banc de vitesse : une boite vide, un essai par nombre de
/// fils. Rend la vue de la tache, que la page suit comme un calcul.
///
/// `auto` : lance par le serveur a son demarrage ; il cede la place a la
/// premiere simulation demandee.
pub fn lancer_banc(auto: bool) -> Res<Json> {
    lancement::lancer_banc(auto)
}

/// Ou les prochaines simulations ecriront. "" remet le dossier temporaire.
///
/// C'est le serveur qui l'appelle, a l'ouverture et a l'enregistrement d'un
/// projet : les champs d'une simulation appartiennent au projet qui l'a
/// demandee, et le dossier temporaire du systeme se vide tout seul.
pub fn dossier_calculs(chemin: &str) -> String {
    lancement::definir_racine_calculs(chemin)
}

/// Un identifiant de calcul neuf, a la forme que le lancement reconnait : il sert au
/// dossier de calcul importe d'ailleurs, que le serveur range dans le projet.
pub fn identifiant_neuf() -> String {
    lancement::identifiant_neuf()
}

/// Range le dossier d'un calcul deja fait sous `base_destination`.
///
/// LE PENDANT DE `dossier_calculs`, POUR LE PASSE. La premiere dit ou les
/// prochains calculs ecriront ; celle-ci rapatrie ceux qui ont deja ecrit
/// ailleurs — c'est-a-dire dans le dossier temporaire du systeme, ce qui est
/// le cas de tout calcul lance avant qu'un projet ne soit ouvert.
pub fn archiver_calcul(ident: &str, base_destination: &str) -> Res<Json> {
    lancement::archiver(ident, base_destination)
}
