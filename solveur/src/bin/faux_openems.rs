//! Un faux `openEMS` (et un faux `nf2ff`), pour essayer le lancement, le suivi et l'arret
//! sans solveur. Il ne calcule rien : il ecrit le journal qu'ecrit le vrai, et des sondes de
//! synthese pour chaque <ProbeBox> du XML qu'on lui donne.
//!
//! Il joue le role que dit son nom de fichier (« openEMS », « nf2ff »). Un fichier
//! « scenario » pose a cote de lui change son comportement, une consigne par ligne :
//!   plante        sort en erreur apres quelques lignes
//!   lent          une ligne d'avancement toutes les 50 ms, pendant une minute
//!   muet          sort sans ecrire aucune sonde
//!   nf2ff=CHEMIN  le fichier HDF5 que le faux nf2ff recopie en nf2ff.h5

use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let moi = std::env::current_exe().unwrap_or_default();
    let role = moi.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    let scenario = std::fs::read_to_string(moi.with_file_name("scenario")).unwrap_or_default();
    let consigne = |nom: &str| scenario.lines().any(|l| l.trim() == nom);

    if role.starts_with("nf2ff") {
        println!(" | nf2ff, near-field to far-field transformation for openEMS (faux)");
        let Some(source) = scenario.lines().find_map(|l| l.trim().strip_prefix("nf2ff=")) else { std::process::exit(1) };
        if args.len() < 2 || std::fs::copy(source, "nf2ff.h5").is_err() {
            std::process::exit(1);
        }
        return;
    }

    println!(" ---------------------------------------------------------------------- ");
    println!(" | openEMS 64bit -- version v0.0.36-faux");
    println!(" ---------------------------------------------------------------------- ");
    let Some(xml) = args.get(1) else {
        println!(" Usage: openEMS <FDTD_XML_FILE> [<options>...]");
        std::process::exit(255);
    };
    let texte = match std::fs::read_to_string(xml) {
        Ok(t) => t,
        Err(_) => {
            eprintln!("openEMS: Error File-Loading failed!!! File: {xml}");
            std::process::exit(255);
        }
    };
    let fils = args.iter().find_map(|a| a.strip_prefix("--numThreads=")).unwrap_or("2");
    println!("Multithreaded engine using {fils} threads. Utilization: (...)");
    let attribut = |balise: &str, nom: &str| -> Vec<String> {
        texte.split(&format!("<{balise} ")).skip(1).filter_map(|m| {
            let m = m.split('>').next()?;
            Some(m.split(&format!("{nom}=\"")).nth(1)?.split('"').next()?.to_string())
        }).collect()
    };
    let nmax: usize = attribut("FDTD", "NumberOfTimesteps").first().and_then(|v| v.parse().ok()).unwrap_or(1000);
    if consigne("plante") {
        println!("Create FDTD operator");
        eprintln!("Error: la geometrie de ce faux calcul est degeneree");
        std::process::exit(3);
    }
    let sortie = std::io::stdout();
    let lignes = if consigne("lent") { 1200 } else { 24 };
    for i in 1..=lignes {
        let pas = i * (nmax / 60).max(1);
        // l'energie monte pendant trois lignes, puis descend de deux decibels par ligne
        let db = if i <= 3 { 0.0 } else { 2.0 * (i - 3) as f64 };
        println!("[@ {:>8}s] Timestep: {:>12} || Speed: {:>6.1} MC/s (1.000e-03 s/TS) || Energy: ~{:.2e} (-{:5.2}dB)",
                 i, pas, if i == 1 { 3.0 } else { 20.0 + (i % 3) as f64 }, 1e-15 * 10f64.powf(-db / 10.0), db);
        let _ = sortie.lock().flush();
        if consigne("lent") {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
    if !consigne("muet") {
        for (k, nom) in attribut("ProbeBox", "Name").iter().enumerate() {
            let mut t = String::from("% time-domain voltage integration by openEMS (faux)\n% t/s\tvoltage\n");
            let courant = nom.contains("_it");
            for i in 0..400 {
                let s = i as f64 * 1.5e-12;
                let v = (-s / 1.2e-10).exp() * (2.0 * std::f64::consts::PI * 2.45e9 * s + 0.4 * k as f64 + if courant { 0.5 } else { 0.0 }).sin();
                t.push_str(&format!("{:e}\t{:e}\n", s, if courant { v / 70.0 } else { v }));
            }
            let _ = std::fs::write(nom, t);
        }
        if attribut("DumpBox", "Name").iter().any(|n| n == "nf2ff_E") {
            for n in 0..6 {
                let _ = std::fs::write(format!("nf2ff_E_{n}.h5"), "");
                let _ = std::fs::write(format!("nf2ff_H_{n}.h5"), "");
            }
        }
    }
    println!("Time for {nmax} iterations with 1e+06 cells : 1 sec");
    println!("Speed: {:.1} MCells/s ", 100.0 + fils.parse::<f64>().unwrap_or(0.0));
}
