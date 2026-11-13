//! Mise à jour au démarrage : git fetch, puis git pull --ff-only s'il y a du nouveau.

use std::io::{self, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

struct Sortie {
    code: i32,
    stdout: String,
    stderr: String,
}

/// subprocess.run(capture_output=True, text=True, timeout=delai) : au-delà du délai,
/// la commande est tuée et l'erreur est TimedOut.
fn lancer(cmd: &mut Command, delai: Option<u64>) -> io::Result<Sortie> {
    let mut proc = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    let lire = |mut flux: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut tout = Vec::new();
            let _ = flux.read_to_end(&mut tout);
            String::from_utf8_lossy(&tout).replace("\r\n", "\n")
        })
    };
    let sortie = lire(Box::new(proc.stdout.take().expect("stdout")));
    let erreur = lire(Box::new(proc.stderr.take().expect("stderr")));
    let fin = delai.map(|d| Instant::now() + Duration::from_secs(d));
    let statut = loop {
        if let Some(statut) = proc.try_wait()? {
            break statut;
        }
        if fin.is_some_and(|fin| Instant::now() >= fin) {
            let _ = proc.kill();
            let _ = proc.wait();
            let args: Vec<String> =
                std::iter::once(cmd.get_program()).chain(cmd.get_args()).map(|a| format!("'{}'", a.to_string_lossy())).collect();
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!("Command '[{}]' timed out after {} seconds", args.join(", "), delai.unwrap_or(0)),
            ));
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    Ok(Sortie { code: statut.code().unwrap_or(-1), stdout: sortie.join().unwrap_or_default(), stderr: erreur.join().unwrap_or_default() })
}

/// Recherche les mises a jour sur GitHub via Git et les applique si disponible.
///
/// Renvoie true si une mise a jour a ete telechargee et appliquee avec succes
/// (necessitant un redemarrage pour executer le code a jour), ou false
/// si l'outil est deja a jour, hors-ligne, ou dans l'impossibilite d'appliquer
/// la mise a jour sans intervention manuelle.
pub fn verifier_et_appliquer_maj(racine: &Path) -> bool {
    // Git doit etre disponible dans l'environnement
    if crate::quel("git").is_none() {
        return false;
    }
    let essayer = |args: &[&str], delai: Option<u64>| {
        lancer(Command::new("git").args(args).current_dir(racine).env("GIT_TERMINAL_PROMPT", "0"), delai)
    };
    // shortcut: une commande git qui dépasse son délai compte pour un échec, Python s'arrêtait sur une trace d'erreur
    let git = |args: &[&str], delai: u64| {
        essayer(args, Some(delai)).unwrap_or_else(|e| Sortie { code: 1, stdout: String::new(), stderr: e.to_string() })
    };

    // Le dossier doit etre un depot Git
    if !racine.join(".git").is_dir() && !essayer(&["rev-parse", "--is-inside-work-tree"], None).is_ok_and(|r| r.code == 0) {
        return false;
    }

    println!("[*] Recherche de mises a jour sur GitHub...");
    match essayer(&["fetch", "--quiet", "origin"], Some(10)) {
        Ok(fetch) if fetch.code == 0 => {}
        Ok(_) => {
            println!("[!] Impossible de contacter GitHub (hors ligne ou depot distant inaccessible).");
            println!("[*] Demarrage normal de l'outil...");
            return false;
        }
        Err(e) if e.kind() == io::ErrorKind::TimedOut => {
            println!("[!] Delai de recherche de mise a jour depasse (reseau lent ou indisponible).");
            println!("[*] Demarrage normal de l'outil...");
            return false;
        }
        Err(e) => {
            println!("[!] Echec de la recherche de mise a jour : {}", e);
            println!("[*] Demarrage normal de l'outil...");
            return false;
        }
    }

    // Determination de la branche amont (upstream) ou repli sur origin/main
    let mut upstream = "@{u}";
    if git(&["rev-parse", "--verify", "@{u}"], 5).code != 0 {
        if git(&["rev-parse", "--verify", "origin/main"], 5).code == 0 {
            upstream = "origin/main";
        } else {
            // Aucune branche amont connue
            return false;
        }
    }

    // Nombre de commits distants en attente de recuperation
    let compte = git(&["rev-list", &format!("HEAD..{}", upstream), "--count"], 5);
    if compte.code != 0 {
        return false;
    }
    let Ok(nb_commits) = compte.stdout.trim().parse::<i64>() else { return false };
    if nb_commits <= 0 {
        println!("[*] Le logiciel est a jour.");
        return false;
    }

    let trait_ = "=".repeat(60);
    println!();
    println!("{}", trait_);
    println!("MISE A JOUR DISPONIBLE ({} nouveau(x) commit(s) sur GitHub)", nb_commits);
    println!("{}", trait_);
    println!("  Application de la mise a jour en cours...");

    // Detection de modifications locales non commitees dans les fichiers suivis
    let modifie = !git(&["status", "--porcelain", "-uno"], 5).stdout.trim().is_empty();
    let mut reserve = false;
    if modifie {
        println!("  Modifications locales detectees : mise en reserve temporaire...");
        reserve = git(&["stash", "push", "-m", "Auto-stash WEB_ANTENNA avant mise a jour"], 10).code == 0;
    }

    // --ff-only : on n'applique que la suite exacte de ce qu'on a. Un historique
    // distant reecrit (force-push) ou divergent est refuse, jamais fusionne en
    // silence dans le code qu'on va executer.
    // Un pull trop long (reseau lent, carte SD) levait une erreur : le
    // serveur ne demarrait pas et la reserve n'etait jamais reappliquee.
    let pull = essayer(&["pull", "--ff-only"], Some(120))
        .unwrap_or_else(|e| Sortie { code: 1, stdout: String::new(), stderr: format!("git pull interrompu ({})", e) });

    if reserve {
        println!("  Restauration des modifications locales...");
        let pop = git(&["stash", "pop"], 10);
        // Un « pop » en conflit laisse les modifications dans la reserve (et
        // des marqueurs de conflit dans les fichiers) : le taire, c'etait
        // laisser croire qu'elles etaient perdues.
        if pop.code != 0 {
            let err = if pop.stderr.trim().is_empty() { pop.stdout.trim() } else { pop.stderr.trim() };
            println!("[!] Vos modifications locales n'ont pas pu etre reappliquees automatiquement :");
            println!("    {}", err);
            println!("    Elles sont conservees dans la reserve Git : voir « git stash list », puis « git stash pop » une fois le conflit resolu.");
        }
    }

    if pull.code != 0 {
        let err = if pull.stderr.trim().is_empty() { pull.stdout.trim() } else { pull.stderr.trim() };
        println!("[!] Echec de l'application de la mise a jour : {}", err);
        println!("[*] Poursuite avec la version actuelle...");
        return false;
    }

    println!();
    println!("{}", trait_);
    println!("MISE A JOUR APPLIQUEE AVEC SUCCES");
    println!("{}", trait_);
    println!("  Redemarrage automatique de l'outil...");
    println!("{}", trait_);
    println!();
    true
}

#[cfg(test)]
mod essais {
    use super::*;

    fn git(dossier: &Path, args: &[&str]) {
        let r = Command::new("git")
            .args(["-c", "user.name=essai", "-c", "user.email=essai@exemple.invalid", "-c", "commit.gpgsign=false"])
            .args(args)
            .current_dir(dossier)
            .output()
            .unwrap();
        assert!(r.status.success(), "git {:?} : {}", args, String::from_utf8_lossy(&r.stderr));
    }

    /// Un dépôt en retard d'un commit sur son origine, avec une modification locale :
    /// elle est mise en réserve, le commit tiré, la modification remise ; puis plus rien à tirer.
    #[test]
    fn mise_a_jour_puis_a_jour() {
        if crate::quel("git").is_none() {
            return;
        }
        let tmp = std::env::temp_dir().join(format!("webantenna-maj-{}", std::process::id()));
        let (origine, clone) = (tmp.join("origine"), tmp.join("clone"));
        std::fs::create_dir_all(&origine).unwrap();
        git(&origine, &["init", "--quiet", "-b", "main"]);
        std::fs::write(origine.join("a.txt"), "1\n").unwrap();
        std::fs::write(origine.join("b.txt"), "1\n").unwrap();
        git(&origine, &["add", "."]);
        git(&origine, &["commit", "--quiet", "-m", "un"]);
        git(&tmp, &["clone", "--quiet", origine.to_str().unwrap(), "clone"]);
        git(&clone, &["config", "user.name", "essai"]); // la mise en réserve signe un commit
        git(&clone, &["config", "user.email", "essai@exemple.invalid"]);
        assert!(!verifier_et_appliquer_maj(&clone));
        std::fs::write(origine.join("a.txt"), "2\n").unwrap();
        git(&origine, &["commit", "--quiet", "-am", "deux"]);
        std::fs::write(clone.join("b.txt"), "local\n").unwrap();
        assert!(verifier_et_appliquer_maj(&clone));
        assert_eq!(std::fs::read_to_string(clone.join("a.txt")).unwrap(), "2\n");
        assert_eq!(std::fs::read_to_string(clone.join("b.txt")).unwrap(), "local\n");
        assert!(!verifier_et_appliquer_maj(&clone));
        assert!(!verifier_et_appliquer_maj(&tmp)); // pas un dépôt
        std::fs::remove_dir_all(&tmp).unwrap();
    }
}
