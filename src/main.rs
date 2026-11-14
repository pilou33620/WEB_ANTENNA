// ==========================================================================
// Antenne openEMS -- le serveur.
//
//   web_antenna
//
// IL NE SERT QUE TROIS CHOSES QU'UN NAVIGATEUR NE SAIT PAS FAIRE :
//
//   1. LIRE UN FICHIER IPC-2581. Le lecteur (la caisse ipc2581, commune a
//      WEB_CAO) ne tourne pas dans un navigateur.
//      La page envoie le fichier tel quel, le modele traduit revient en JSON,
//      et a partir de la tout se passe dans le navigateur : c'est aussi
//      pourquoi « Exporter .json » existe.
//
//   2. APPELER openEMS. Le solveur est un executable, qui tourne dans un
//      processus a lui (voir solveur/src/lancement.rs), et
//      cette page l'interroge sur son avancement.
//
//   3. ECRIRE SUR LE DISQUE, ET RELIRE. Un projet — le dessin, les reglages,
//      la carte, les resultats, les champs — est un dossier que l'utilisateur
//      choisit (voir src/projet.rs). Une page web n'ecrit pas la ou on lui
//      dit, et le stockage local d'un navigateur n'est ni un dossier, ni
//      partageable, ni sauvegarde.
//
// Et une quatrieme, quand WEB_SUITE l'a lance :
//
//   4. RELAYER L'ENVOI SUR GITHUB. « Enregistrer + GitHub » ecrit le projet,
//      puis demande au lanceur WEB_SUITE de commiter et pousser PROJETS --
//      le meme geste que dans WEB_CAO. Voir `_github_garde`.
//
// Tout le reste -- l'affichage, la designation du cuivre, l'assistant, la 3D,
// les courbes -- est dans le navigateur et n'a besoin de personne.
//
// Les caisses dont il depend sont compilees avec lui : un poste sans openEMS
// sert quand meme la
// page, lit quand meme les fichiers IPC-2581, prepare quand meme les modeles
// et exporte quand meme leur XML. Seul « Lancer » s'eteint, en disant
// pourquoi.
// ==========================================================================
//! Serveur local de l'outil « Antenne openEMS ».

mod maj;
mod projet;
mod serveur;

use std::io::Write;
use std::net::{Ipv4Addr, TcpListener};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use antenne_solveur::{antenne, lancement};
use web_tools_commun::appairage::{self, Garde};
use web_tools_commun::pilote::Pilote;
use web_tools_commun::serveur::{Requete, Serveur};

const PORT_DEFAUT: u16 = 8000;
// DES PORTS DE REPLI, ET NON UN TIRAGE AU SORT TOUT DE SUITE. Windows
// reserve des plages entieres (Hyper-V, WSL, Docker) et le 8000 y tombe
// souvent -- c'est le cas sur bien des postes d'entreprise. Un port pris
// au hasard marcherait, mais changerait a chaque demarrage : les favoris
// du navigateur ne suivraient pas. On essaie donc d'abord une poignee de
// ports usuels, et le tirage au sort ne vient qu'en dernier.
const PORTS_REPLI: [u16; 6] = [8080, 8010, 8800, 8081, 5000, 3000];

/// La racine du dépôt WEB_ANTENNA (là où vivent index.html, js/, css/ et le dossier openEMS/).
/// L'exécutable n'est pas à côté des pages comme l'était web_antenna.py : on la donne
/// par WEB_ANTENNA_DEPOT (scripts demarrer_*), sinon on remonte depuis l'exécutable
/// puis depuis le dossier courant jusqu'à trouver index.html et js/.
pub fn depot() -> PathBuf {
    if let Some(d) = std::env::var_os("WEB_ANTENNA_DEPOT").filter(|d| !d.is_empty()) {
        return PathBuf::from(d);
    }
    let departs = [std::env::current_exe().ok(), std::env::current_dir().ok()];
    for depart in departs.into_iter().flatten() {
        if let Some(d) = depart.ancestors().find(|d| d.join("index.html").is_file() && d.join("js").is_dir()) {
            return d.to_path_buf();
        }
    }
    std::env::current_dir().unwrap_or_default()
}

/// shutil.which : l'exécutable `nom` dans le PATH.
pub fn quel(nom: &str) -> Option<PathBuf> {
    let extensions: &[&str] = if cfg!(windows) { &[".exe", ".cmd", ".bat", ""] } else { &[""] };
    std::env::split_paths(&std::env::var_os("PATH")?)
        .flat_map(|d| extensions.iter().map(move |e| d.join(format!("{}{}", nom, e))))
        .find(|p| p.is_file())
}

/// webbrowser.open : la page dans le navigateur par défaut du poste.
pub fn ouvrir_navigateur(url: &str) {
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", url]);
        c
    } else {
        let mut c = std::process::Command::new(if cfg!(target_os = "macos") { "open" } else { "xdg-open" });
        c.arg(url);
        c
    };
    use std::process::Stdio;
    let _ = cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
}

/// L'adresse du poste sur le reseau local, pour l'afficher au demarrage.
///
/// Le connect() d'un socket UDP n'envoie rien : il demande seulement au
/// systeme par quelle interface il sortirait. C'est la facon la plus sure de
/// savoir quelle adresse une tablette devra taper.
fn ip_reseau() -> String {
    let par_route = || {
        let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
        s.connect("10.255.255.255:1").ok()?;
        Some(s.local_addr().ok()?.ip().to_string())
    };
    par_route().unwrap_or_else(|| "127.0.0.1".into())
}

/// Les guillemets et apostrophes typographiques que Windows met dans ses
/// messages d'erreur ne passent pas la console (cp850) : ils y ressortent en
/// losanges noirs, et le message devient illisible la ou il compte le plus.
/// On les ramene a leurs equivalents ASCII.
fn lisible(texte: &str) -> String {
    [("’", "'"), ("‘", "'"), ("“", "\""), ("”", "\""), ("–", "-"), ("—", "-"), ("\u{a0}", " ")]
        .iter()
        .fold(texte.to_string(), |t, (a, b)| t.replace(a, b))
}

/// Traduit l'erreur systeme en quelque chose d'actionnable.
///
/// WSAEACCES (10013) EST LA PLUS TROMPEUSE. « Accès interdit par ses
/// autorisations » laisse croire a un droit administrateur manquant, alors
/// que la cause habituelle sur Windows est tout autre : Hyper-V, WSL et
/// Docker RESERVENT des plages entieres de ports au demarrage, et le 8000
/// tombe souvent dedans. Aucun droit n'y changerait rien — il faut un autre
/// port, ce que ce serveur fait tout seul.
///
/// Le serveur commun ne rend pas la raison d'un refus : on la redemande au systeme, sur
/// l'IPv4 du port.
fn pourquoi(reseau: bool, port: u16) -> String {
    let ip = if reseau { Ipv4Addr::UNSPECIFIED } else { Ipv4Addr::LOCALHOST };
    let Err(exc) = TcpListener::bind((ip, port)) else {
        return "l'ecoute est refusee".into();
    };
    let msg = lisible(&exc.to_string());
    if cfg!(windows) && exc.raw_os_error() == Some(10013) {
        return format!(
            "{}\n        Sur Windows, Hyper-V, WSL et Docker reservent des plages de ports entieres.\n        Pour les voir : netsh interface ipv4 show excludedportrange protocol=tcp",
            msg
        );
    }
    if exc.kind() == std::io::ErrorKind::AddrInUse {
        return format!("{} -- un autre programme ecoute deja sur ce port.", msg);
    }
    msg
}

/// Ouvre un serveur sur (hote, port), ou rend None et les echecs.
///
/// C'EST A L'APPELANT DE JUGER. Une tentative ratee suivie d'un repli reussi
/// n'est pas une panne, et l'afficher comme telle donne l'impression d'un
/// plantage. On rend donc la liste de ce qui n'a pas marche, sans rien dire.
fn ouvrir_socket(reseau: bool, port: u16) -> Result<Arc<Serveur>, Vec<String>> {
    Serveur::ouvrir(port, reseau, 1)
        .map_err(|_| vec![format!("IPv4, {}:{} -- {}", if reseau { "toutes" } else { "127.0.0.1" }, port, pourquoi(reseau, port))])
}

#[cfg(windows)]
unsafe extern "system" fn ctrl_c_ignore(evenement: u32) -> i32 {
    (evenement == windows_sys::Win32::System::Console::CTRL_C_EVENT) as i32
}

/// Relance l'outil avec les memes arguments apres une mise a jour.
fn redemarrer_application() {
    let _ = std::io::stdout().flush();
    if std::env::var("WEB_ANTENNA_RELANCEUR").as_deref() == Ok("1") {
        // Le script demarrer_* reboucle : il récupère le nouvel exécutable et le relance
        // (ce binaire-ci ne peut pas se recompiler).
        std::process::exit(75);
    }
    let lancer = || -> std::io::Result<i32> {
        let mut cmd = std::process::Command::new(std::env::current_exe()?);
        cmd.args(std::env::args_os().skip(1)).env("WEB_ANTENNA_DEJA_MAJ", "1");
        #[cfg(unix)]
        {
            // Sous Unix / macOS, exec remplace l'image du processus courant
            Err(std::os::unix::process::CommandExt::exec(&mut cmd))
        }
        #[cfg(not(unix))]
        {
            // Sous Windows, attendre l'enfant permet de conserver la fenetre console
            // ouverte (en particulier lors d'un lancement par double-clic).
            // Ctrl+C atteint aussi l'enfant, qui s'arrête proprement : on l'attend.
            #[cfg(windows)]
            unsafe {
                windows_sys::Win32::System::Console::SetConsoleCtrlHandler(Some(ctrl_c_ignore), 1);
            }
            Ok(cmd.status()?.code().unwrap_or(1))
        }
    };
    match lancer() {
        Ok(code) => std::process::exit(code),
        Err(exc) => {
            println!("[!] Erreur lors du redemarrage automatique : {}", exc);
            println!("[*] Poursuite avec le processus actuel...");
        }
    }
}

/// Mesure la vitesse du poste des le demarrage, et range le resultat.
///
/// LES BONS FILS SANS AVOIR A LES DEMANDER. Le reglage « Auto » vaut le
/// meilleur nombre du banc (openems_modele.fils_effectif) : le passer ici,
/// une fois par seance, donne ce nombre a tout ce qui suit -- exemples,
/// conception, balayages -- sans clic. Le banc precedent, recolle plus haut
/// depuis les reglages du poste, sert en attendant.
///
/// IL NE BLOQUE RIEN. Une simulation demandee pendant qu'il tourne
/// l'interrompt (openems_run._exiger_libre) : ses mesures partielles sont
/// alors jetees, et l'ancien banc reste en vigueur.
///
/// LE RANGEMENT SE FAIT ICI, PAS DANS LE SUIVI DU JOURNAL : personne ne
/// suivra forcement ce banc -- la page peut ne pas etre ouverte --, et
/// `_oe_ranger_debit` n'est appele que par ce suivi-la.
fn banc_au_demarrage() {
    if !antenne::etat()["lancer"].vrai() {
        return;
    }
    let Ok(vue) = antenne::lancer_banc(true) else { return };
    let Some(ident) = vue["id"].as_str() else { return };
    let etat = loop {
        std::thread::sleep(Duration::from_secs(2));
        let Ok(v) = antenne::journal(ident, 1_000_000_000) else { return };
        let etat = v["etat"].as_str().unwrap_or("").to_string();
        if etat != "prepare" && etat != "calcule" {
            break etat;
        }
    };
    if etat != "fini" {
        return;
    }
    let b = &antenne::fils()["banc"];
    if b.vrai() {
        projet::banc_noter(b);
    }
}

static ARRET: AtomicBool = AtomicBool::new(false);

#[cfg(unix)]
extern "C" fn sur_signal(_: libc::c_int) {
    ARRET.store(true, Ordering::SeqCst);
}

#[cfg(windows)]
unsafe extern "system" fn sur_ctrl_c(evenement: u32) -> i32 {
    if evenement != windows_sys::Win32::System::Console::CTRL_C_EVENT {
        return 0; // fenêtre fermée : le système arrête le processus
    }
    ARRET.store(true, Ordering::SeqCst);
    1
}

/// Ctrl+C demande l'arrêt.
fn ecouter_ctrl_c() {
    #[cfg(unix)]
    unsafe {
        libc::signal(libc::SIGINT, sur_signal as extern "C" fn(libc::c_int) as libc::sighandler_t);
    }
    #[cfg(windows)]
    unsafe {
        windows_sys::Win32::System::Console::SetConsoleCtrlHandler(Some(sur_ctrl_c), 1);
    }
}

const USAGE: &str = "usage: web_antenna [-h] [--port PORT] [--local] [--sans-navigateur]\n\
                     \x20                  [--sans-pause] [--sans-maj] [--sans-banc]\n\
                     \x20                  [--projets DOSSIER]";

fn aide() {
    println!("{}\n", USAGE);
    println!("Serveur local de l'outil « Antenne openEMS ».\n");
    println!("options:");
    println!("  -h, --help         show this help message and exit");
    println!("  --port PORT        port d'ecoute (defaut : {})", PORT_DEFAUT);
    println!("  --local            n'ecouter que sur 127.0.0.1 : aucun acces reseau");
    println!("  --sans-navigateur  ne pas ouvrir le navigateur au demarrage");
    println!("  --sans-pause       sans effet : ce serveur n'attend jamais de touche (option");
    println!("                     commune aux web tools)");
    println!("  --sans-maj         ne pas verifier les mises a jour GitHub au demarrage");
    println!("  --sans-banc        ne pas mesurer la vitesse du poste au demarrage (les fils");
    println!("                     du dernier banc restent en vigueur)");
    println!("  --projets DOSSIER  racine des projets pour ce lancement seulement (WEB_SUITE");
    println!("                     y passe PROJETS/ANTENNA ; n'ecrit pas ~/.antenne-");
    println!("                     openems.json)");
}

/// os.path.abspath(os.path.expanduser(chemin)).
fn absolu(chemin: &str) -> PathBuf {
    let p = match chemin.strip_prefix('~') {
        Some(reste) if reste.is_empty() || reste.starts_with(['/', '\\']) => {
            appairage::dossier_personnel().join(reste.trim_start_matches(['/', '\\']))
        }
        _ => PathBuf::from(chemin),
    };
    std::path::absolute(&p).unwrap_or(p)
}

fn principal(argv: &[String]) -> i32 {
    let mut port: u16 = PORT_DEFAUT;
    let mut projets: Option<String> = None;
    let (mut local, mut navigateur, mut verifier_maj, mut banc) = (false, true, true, true);
    let erreur = |texte: &str| {
        eprintln!("{}\nweb_antenna: error: {}", USAGE, texte);
        2
    };
    let mut args = argv.iter().map(String::as_str);
    while let Some(arg) = args.next() {
        let (nom, mut valeur) = match arg.split_once('=') {
            Some((nom, valeur)) if nom.starts_with("--") => (nom, Some(valeur)),
            _ => (arg, None),
        };
        match nom {
            "-h" | "--help" => {
                aide();
                return 0;
            }
            "--port" | "--projets" => {
                let Some(v) = valeur.take().or_else(|| args.next()) else {
                    return erreur(&format!("argument {}: expected one argument", nom));
                };
                match nom {
                    "--projets" => projets = Some(v.to_string()),
                    _ => match v.parse() {
                        Ok(p) => port = p,
                        Err(_) => return erreur(&format!("argument --port: invalid int value: '{}'", v)),
                    },
                }
            }
            "--local" => local = true,
            "--sans-navigateur" => navigateur = false,
            "--sans-pause" => {}
            "--sans-maj" => verifier_maj = false,
            "--sans-banc" => banc = false,
            _ => return erreur(&format!("unrecognized arguments: {}", arg)),
        }
        if valeur.is_some() {
            return erreur(&format!("argument {}: ignored explicit argument", nom));
        }
    }
    let racine = depot();

    // LA MISE A JOUR AVANT TOUT LE RESTE.
    // Le code telecharge ne sert a rien tant que c'est l'ancien qui tourne :
    // on relance donc l'outil tel quel, avec ses arguments. Le temoin
    // d'environnement evite la boucle si la nouvelle version trouve encore a tirer.
    if verifier_maj && std::env::var("WEB_ANTENNA_DEJA_MAJ").as_deref() != Ok("1") && maj::verifier_et_appliquer_maj(&racine) {
        redemarrer_application();
    }
    // Le dossier « openEMS » du depot : c'est la que le lancement cherche les executables.
    lancement::definir_racine_depot(&racine);

    if let Some(p) = projets.filter(|p| !p.is_empty()) {
        // Comme --lib de WEB_CAO : vaut pour ce lancement, sans toucher au
        // reglage retenu (definir_racine, lui, l'ecrirait dans le profil).
        let chemin = absolu(&p);
        if let Err(e) = std::fs::create_dir_all(&chemin) {
            eprintln!("Dossier des projets impossible à créer ({}) : {}", chemin.display(), e);
            return 1;
        }
        projet::poser_racine(Some(chemin.to_string_lossy().into_owned()));
    }

    // TROIS TENTATIVES, DE LA PLUS SOUHAITABLE A LA PLUS SURE. Un port refuse
    // n'est pas une raison de ne pas demarrer : ce qu'on veut, c'est une page
    // qui s'ouvre. On le dit, on se rabat, et on annonce ou l'on a atterri.
    let detailler = |echecs: &[String]| echecs.iter().for_each(|ligne| println!("      {}", ligne));
    let mut reseau = !local;
    let mut serveur = ouvrir_socket(reseau, port);
    if let (Err(echecs), true) = (&serveur, port != 0) {
        println!();
        println!("  [!] Le port {} est refuse :", port);
        detailler(echecs);
        for repli in PORTS_REPLI {
            if repli == port {
                continue;
            }
            println!("  [*] Essai du port {}...", repli);
            serveur = ouvrir_socket(reseau, repli);
            match &serveur {
                Ok(_) => break,
                Err(echecs) => detailler(echecs),
            }
        }
    }
    if serveur.is_err() && port != 0 {
        println!("  [*] Recherche d'un port libre, au choix du systeme...");
        serveur = ouvrir_socket(reseau, 0);
    }
    if let (Err(echecs), true) = (&serveur, reseau) {
        println!("  [!] Aucune interface reseau n'accepte l'ecoute :");
        detailler(echecs);
        println!("  [*] Tentative en local seulement...");
        reseau = false;
        serveur = ouvrir_socket(false, 0);
    }
    let serveur = match serveur {
        Ok(s) => s,
        Err(echecs) => {
            println!();
            println!("  [X] Impossible de demarrer le serveur :");
            detailler(&echecs);
            return 1;
        }
    };
    // Delai de chaque lecture du socket : un client muet ne tient pas un fil indefiniment.
    serveur.regler_delai(60);

    let port_demande = port;
    let port = serveur.port();
    let local_seul = !reseau;
    let garde = Garde::new("WEB_ANTENNA", !local_seul, None, None);
    garde.brancher(&serveur); // en mode reseau : HTTPS sur le meme port
    let url = format!("http://127.0.0.1:{}/", port);

    // LE DEBIT DU POSTE, RECOLLE AVANT LA PREMIERE PAGE. Sans lui, la premiere
    // annonce de duree de la session repartirait de la valeur supposee — et
    // c'est la premiere qu'on lit, celle sur laquelle on decide de lancer ou
    // non. Le pont est ici et nulle part ailleurs : projet.py range un nombre
    // sans savoir ce qu'il mesure, openems_antenne le mesure sans savoir ou on
    // le range.
    let v = projet::debit_lu();
    if v > 0.0 {
        antenne::debit_noter(v, projet::debit_fils_lu());
    }
    // LES FILS ET LE BANC AVANT LE DEBIT ANNONCE : c'est avec eux
    // que le debit se ramene au reglage du poste.
    antenne::regler_fils(projet::fils_lu());
    let table = projet::banc_lu();
    antenne::banc_noter(table.as_objet().into_iter().flatten().filter_map(|(k, v)| Some((k.trim().parse().ok()?, v.as_f64()?))));

    println!();
    println!("  Antenne openEMS");
    println!("  {}", "-".repeat(48));
    println!("  Dossier   {}", racine.display());
    println!("  Adresse   {}", url);
    if !local_seul {
        println!("            {}   (reseau local)", garde.adresse(&ip_reseau(), port));
        if let Some(ip) = appairage::ip_tailscale() {
            println!("            {}   (Tailscale)", garde.adresse(&ip.to_string(), port));
        }
        println!("            l'autre appareil demande une fois le code d'appairage");
        garde.annoncer();
    }
    if port != port_demande {
        println!("            (le port {} etait refuse : celui-ci a ete pris a sa place)", port_demande);
    }
    println!();
    println!("  Parseur IPC-2581  pret");
    let etat = antenne::etat();
    let solveur = &etat["solveur"];
    let pret = etat["lancer"].vrai();
    if pret {
        println!("  Solveur openEMS   pret");
    } else {
        println!("  Solveur openEMS   indisponible ({})", etat["lancer_detail"].as_str().unwrap_or("?"));
    }
    // QUEL EXECUTABLE FERA LE CALCUL. Le dire evite une
    // demi-heure de recherche quand « Lancer » reste eteint.
    if let Some(exe) = solveur["executable"].as_str().filter(|e| !e.is_empty()) {
        println!("                    via {}", exe);
    }
    if !pret {
        println!("                    la preparation et l'export du XML");
        println!("                    restent possibles");
        for ligne in etat["lancer_conseil"].as_str().unwrap_or("").lines().map(str::trim).filter(|l| !l.is_empty()) {
            println!("                    {}", ligne);
        }
    }
    if let Some(dll) = solveur["dll"].as_str().filter(|d| !d.is_empty()) {
        println!("  DLL               {}", dll);
    }
    let d = antenne::debit();
    let origine = if d["mesure"].vrai() {
        format!("mesure sur {} calcul(s) de ce poste", d["n"].as_i64().unwrap_or(0))
    } else {
        "suppose : aucun calcul n'a encore fini".to_string()
    };
    println!("  Debit annonce     {:.1} Mcellules/s  ({})", d["mcps"].as_f64().unwrap_or(0.0), origine);
    let f = antenne::fils();
    let entier = |cle: &str| f[cle].as_i64().unwrap_or(0);
    let qui = if entier("regle") != 0 {
        format!("{}, choisi a la main", entier("regle"))
    } else if entier("effectif") != 0 {
        format!("auto : {}, le meilleur au dernier banc", entier("effectif"))
    } else {
        "auto : au choix d'openEMS tant que le banc n'a pas parle".to_string()
    };
    println!("  Fils de calcul    {}  ({} coeurs logiques)", qui, entier("coeurs"));
    if banc && pret {
        println!("  Banc de vitesse   lance en arriere-plan (une a deux minutes) ;");
        println!("                    une simulation demandee entre-temps l'interrompt");
    }
    println!();
    println!("  Ctrl+C pour arreter.");
    println!();
    let _ = std::io::stdout().flush();

    if navigateur {
        let url = url.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(800));
            ouvrir_navigateur(&url);
        });
    }
    if banc {
        std::thread::spawn(banc_au_demarrage);
    }

    let poste = serveur::Poste {
        racine,
        garde,
        pilote: Pilote::default(),
        lanceur: std::env::var("WEBSUITE_LANCEUR").unwrap_or_default(),
        jeton_lanceur: std::env::var("WEBSUITE_JETON").unwrap_or_default(),
    };
    ecouter_ctrl_c();
    // Un fil par requete : le suivi d'une simulation sonde pendant que la
    // page continue de charger ses fichiers.
    serveur.servir_en_fond(Arc::new(move |r: &mut Requete| poste.servir(r)));
    while !ARRET.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(100));
    }
    println!("\n  Arret.");
    serveur.arreter();
    0
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    std::process::exit(principal(&args));
}
