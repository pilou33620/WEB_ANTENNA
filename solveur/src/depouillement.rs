//! Le depouillement : des fichiers de sonde d'openEMS aux chiffres que la page affiche.
//!
//! Ce que le script Python faisait avec numpy et les classes de ports d'openEMS 0.0.36, dans
//! le meme ordre et par les memes formules : lecture des sondes (texte, « % » en commentaire),
//! passage en frequence par transformee DIRECTE aux frequences voulues (`DFT_time2freq`),
//! ondes incidente et reflechie (`Port.CalcPort`), S11, couplages, impedance, ROE, bande
//! passante ; puis le champ lointain : le XML de `nf2ff`, son lancement, la lecture de son
//! HDF5. Les lignes ecrites au journal sont celles que le script imprimait.

use std::path::Path;

use antenne_modele::outils::{maxi, mini, nombres};
use antenne_modele::{obj, Json, Objet};

use crate::hdf5::Fichier;
use crate::ports::{GenrePort, PortMesure};
use crate::xml::{self, f, liste, lit, lit_e, liste_nb, Elt, C0, DEC};

// ==========================================================================
// Un complexe, et rien de plus que ce que les formules demandent
// ==========================================================================
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct C {
    pub re: f64,
    pub im: f64,
}

pub const fn c(re: f64, im: f64) -> C {
    C { re, im }
}

const J: C = c(0.0, 1.0);

impl C {
    pub fn abs(self) -> f64 {
        self.re.hypot(self.im)
    }
    pub fn conj(self) -> C {
        c(self.re, -self.im)
    }
    /// La racine principale, comme numpy.
    pub fn sqrt(self) -> C {
        if self.re == 0.0 && self.im == 0.0 {
            return c(0.0, self.im);
        }
        let m = self.abs();
        let r = ((m + self.re.abs()) / 2.0).sqrt();
        if self.re >= 0.0 {
            c(r, self.im / (2.0 * r))
        } else {
            c(self.im.abs() / (2.0 * r), if self.im < 0.0 { -r } else { r })
        }
    }
    pub fn fini(self) -> bool {
        self.re.is_finite() && self.im.is_finite()
    }
}

impl std::ops::Add for C {
    type Output = C;
    fn add(self, o: C) -> C {
        c(self.re + o.re, self.im + o.im)
    }
}
impl std::ops::Sub for C {
    type Output = C;
    fn sub(self, o: C) -> C {
        c(self.re - o.re, self.im - o.im)
    }
}
impl std::ops::Mul for C {
    type Output = C;
    fn mul(self, o: C) -> C {
        c(self.re * o.re - self.im * o.im, self.re * o.im + self.im * o.re)
    }
}
impl std::ops::Mul<f64> for C {
    type Output = C;
    fn mul(self, o: f64) -> C {
        c(self.re * o, self.im * o)
    }
}
impl std::ops::Div for C {
    type Output = C;
    /// La division de Smith : celle de numpy, qui ne deborde pas la ou la formule naive le fait.
    fn div(self, o: C) -> C {
        if o.re.abs() >= o.im.abs() {
            if o.re == 0.0 && o.im == 0.0 {
                return c(self.re / o.re.abs(), self.im / o.re.abs());
            }
            let r = o.im / o.re;
            let d = 1.0 / (o.re + o.im * r);
            c((self.re + self.im * r) * d, (self.im - self.re * r) * d)
        } else {
            let r = o.re / o.im;
            let d = 1.0 / (o.im + o.re * r);
            c((self.re * r + self.im) * d, (self.im * r - self.re) * d)
        }
    }
}
impl std::ops::Neg for C {
    type Output = C;
    fn neg(self) -> C {
        c(-self.re, -self.im)
    }
}

// ==========================================================================
// Les sondes
// ==========================================================================
/// Une sonde d'openEMS : deux colonnes, le temps en secondes et la valeur. Les lignes
/// d'en-tete commencent par « % ».
pub fn lire_sonde(chemin: &Path) -> Result<(Vec<f64>, Vec<f64>), String> {
    let texte = std::fs::read_to_string(chemin).map_err(|e| format!("{} : {e}", chemin.display()))?;
    let (mut t, mut v) = (Vec::new(), Vec::new());
    for ligne in texte.lines() {
        // numpy.loadtxt(comments='%') : ce qui suit un « % » ne compte pas
        let utile = ligne.split('%').next().unwrap_or("").trim();
        if utile.is_empty() {
            continue;
        }
        let mut mots = utile.split_whitespace();
        let a = mots.next().and_then(|m| m.parse::<f64>().ok());
        let b = mots.next().and_then(|m| m.parse::<f64>().ok());
        match (a, b) {
            (Some(a), Some(b)) => {
                t.push(a);
                v.push(b);
            }
            _ => return Err(format!("{} : ligne illisible « {} »", chemin.display(), utile.chars().take(60).collect::<String>())),
        }
    }
    if t.len() < 2 {
        return Err(format!("{} : la sonde n'a rien enregistre", chemin.display()));
    }
    Ok((t, v))
}

/// np.linspace(a, b, n).
pub fn linspace(a: f64, b: f64, n: usize) -> Vec<f64> {
    if n < 2 {
        return vec![a; n];
    }
    let pas = (b - a) / (n - 1) as f64;
    let mut v: Vec<f64> = (0..n).map(|i| i as f64 * pas + a).collect();
    v[n - 1] = b;
    v
}

/// La transformee de Fourier DIRECTE aux frequences demandees (`DFT_time2freq` d'openEMS,
/// signal impulsionnel) : 2 . dt . somme( v(t) . exp(-2j.pi.f.t) ). Pas de FFT : les
/// frequences voulues ne sont pas celles d'une grille, et il n'y en a que quelques centaines.
pub fn dft(t: &[f64], v: &[f64], freq: &[f64]) -> Vec<C> {
    let dt = t[1] - t[0];
    freq.iter().map(|fr| {
        let w = -2.0 * std::f64::consts::PI * fr;
        let (mut re, mut im) = (0.0, 0.0);
        for (ti, vi) in t.iter().zip(v) {
            let (s, co) = (w * ti).sin_cos();
            re += vi * co;
            im += vi * s;
        }
        c(re * dt * 2.0, im * dt * 2.0)
    }).collect()
}

/// Un port depouille : tension et courant totaux, ondes incidente et reflechie.
#[derive(Debug, Clone)]
pub struct PortCalcule {
    pub uf_tot: Vec<C>,
    pub if_tot: Vec<C>,
    pub uf_inc: Vec<C>,
    pub if_inc: Vec<C>,
    pub uf_ref: Vec<C>,
    /// L'impedance de reference, frequence par frequence (mesuree, pour un microruban).
    pub z_ref: Vec<C>,
}

/// `CalcPort` : lit les sondes du port dans `dossier` et separe les ondes.
pub fn calculer_port(p: &PortMesure, dossier: &Path, freq: &[f64]) -> Result<PortCalcule, String> {
    let lire = |noms: &[String]| -> Result<Vec<Vec<C>>, String> {
        noms.iter().map(|n| lire_sonde(&dossier.join(n)).map(|(t, v)| dft(&t, &v, freq))).collect()
    };
    let (u, i) = (lire(&p.u)?, lire(&p.i)?);
    let n = freq.len();
    let unite = 1e-3; // l'unite de dessin : le millimetre
    let moyenne = |a: &[C], b: &[C]| -> Vec<C> { a.iter().zip(b).map(|(x, y)| (*x + *y) * 0.5).collect() };
    // (tension, courant, impedance de reference, constante de propagation, deport en unites de dessin)
    let (mut uf, mut i_f, z_ref, beta, deport): (Vec<C>, Vec<C>, Vec<C>, Option<Vec<f64>>, f64) = match &p.genre {
        GenrePort::Localise { r } => (u[0].clone(), i[0].clone(), vec![c(*r, 0.0); n], None, 0.0),
        GenrePort::Coaxial { z0, er, deport } => {
            // Une tension, deux courants moyennes. La constante de propagation du mode TEM
            // est exacte, et sans dispersion : c'est elle qui permet de ramener le plan de
            // reference du milieu du troncon a la surface de la carte.
            let beta = freq.iter().map(|fr| 2.0 * std::f64::consts::PI * fr * er.sqrt() / 2.99792458e8).collect();
            (u[0].clone(), moyenne(&i[0], &i[1]), vec![c(*z0, 0.0); n], Some(beta), *deport)
        }
        GenrePort::Microruban { u_delta, i_delta, plan, deport } => {
            // Z0 et propagation de la ligne TELLE QU'ELLE EST MAILLEE, par les derivees
            // de la tension et du courant entre les sondes (MSLPort.ReadUIData).
            let ht = moyenne(&i[0], &i[1]);
            let du = (u_delta[0].abs() + u_delta[1].abs()) * unite;
            let di = i_delta.abs() * unite;
            let (mut beta, mut z) = (Vec::with_capacity(n), Vec::with_capacity(n));
            for k in 0..n {
                let et = u[1][k];
                let d_et = (u[2][k] - u[0][k]) * (1.0 / du);
                let d_ht = (i[1][k] - i[0][k]) * (1.0 / di);
                let mut b = (-(d_et * d_ht) / (ht[k] * et)).sqrt();
                if b.re < 0.0 {
                    b = -b;
                }
                beta.push(b.re);
                z.push((et * d_et / (ht[k] * d_ht)).sqrt());
            }
            (u[1].clone(), ht, z, Some(beta), if *plan != 0.0 { deport - plan } else { *deport })
        }
    };
    if let Some(beta) = beta {
        // le deport du plan de reference : une ligne sans perte fait tourner U et I
        for k in 0..n {
            let phase = -(beta[k] * (deport * unite));
            let (s, co) = phase.sin_cos();
            let (a, b) = (uf[k], i_f[k]);
            uf[k] = a * co + J * b * z_ref[k] * s;
            i_f[k] = b * co + J * a / z_ref[k] * s;
        }
    }
    let uf_inc: Vec<C> = (0..n).map(|k| (uf[k] + i_f[k] * z_ref[k]) * 0.5).collect();
    let if_inc: Vec<C> = (0..n).map(|k| (i_f[k] + uf[k] / z_ref[k]) * 0.5).collect();
    let uf_ref = (0..n).map(|k| uf[k] - uf_inc[k]).collect();
    Ok(PortCalcule { uf_tot: uf, if_tot: i_f, uf_inc, if_inc, uf_ref, z_ref })
}

// ==========================================================================
// Le champ lointain
// ==========================================================================
/// Ce que `nf2ff` a rendu, a une frequence.
#[derive(Debug, Clone)]
pub struct ChampLointain {
    pub dmax: f64,
    pub prad: f64,
    /// |E| [phi][theta] : une ligne par plan phi, comme la page les trace.
    pub e_norm: Vec<Vec<f64>>,
}

/// Les angles et le centre de phase que le script donnait a CalcNF2FF.
///
/// LE CENTRE DE PHASE EST EN METRES, pas dans l'unite de dessin : nf2ff le prend tel
/// quel, a cote d'un rayon qui vaut 1 metre par defaut. Un centre donne en millimetres
/// place le point de phase a des dizaines de metres, hors de la boite d'enregistrement —
/// et la directivite ressort « nan », sans la moindre erreur pour le dire.
pub fn xml_nf2ff(m: &Json, frequence: f64, plans: &[(String, String)]) -> String {
    let bc = &m["boite_cuivre"];
    let centre = [lit((f(&bc[0]) + f(&bc[2])) / 2.0, DEC) * 1e-3, lit((f(&bc[1]) + f(&bc[3])) / 2.0, DEC) * 1e-3,
                  lit(f(&m["z_haut"]) / 2.0, DEC) * 1e-3];
    let rad = |cle: &str| liste_nb(liste(&m["nf2ff"][cle]).iter().map(|v| lit(f(v), 2).to_radians()));
    // LegacyHDF5 : les openEMS d'apres 0.0.36 savent ecrire un format plus recent ; on leur
    // demande l'ancien, le seul que 0.0.36 connaisse (qui ignore l'attribut).
    let mut e = Elt::new("nf2ff").n("freq", frequence).a("Outfile", "nf2ff.h5").a("Center", liste_nb(centre)).a("Radius", "1")
        .a("LegacyHDF5", "1").e(Elt::new("theta").t(rad("theta"))).e(Elt::new("phi").t(rad("phi")));
    for (ch_e, ch_h) in plans {
        e = e.e(Elt::new("Planes").a("E_Field", ch_e.clone()).a("H_Field", ch_h.clone()));
    }
    xml::document(&e)
}

/// Relit le fichier de `nf2ff` : directivite, puissance rayonnee, |E| par plan.
pub fn lire_nf2ff(chemin: &Path, n_theta: usize, n_phi: usize) -> Result<ChampLointain, String> {
    let h = Fichier::ouvrir(chemin)?;
    let (theta, phi) = (h.jeu("/Mesh/theta")?, h.jeu("/Mesh/phi")?);
    if theta.v.len() != n_theta || phi.v.len() != n_phi {
        return Err(format!("{} : {} x {} angles, {} x {} attendus", chemin.display(), theta.v.len(), phi.v.len(), n_theta, n_phi));
    }
    let lire = |nom: &str| -> Result<Vec<f64>, String> {
        let j = h.jeu(nom)?;
        // [phi][theta] dans le fichier : c'est deja la transposee que la page veut
        if j.dims != [n_phi, n_theta] {
            return Err(format!("{nom} : dimensions {:?} inattendues", j.dims));
        }
        Ok(j.v)
    };
    let (tr, ti) = (lire("/nf2ff/E_theta/FD/f0_real")?, lire("/nf2ff/E_theta/FD/f0_imag")?);
    let (pr, pi) = (lire("/nf2ff/E_phi/FD/f0_real")?, lire("/nf2ff/E_phi/FD/f0_imag")?);
    let norme: Vec<f64> = (0..tr.len()).map(|k| (tr[k].hypot(ti[k]).powi(2) + pr[k].hypot(pi[k]).powi(2)).sqrt()).collect();
    let premier = |nom: &str| h.attribut("/nf2ff", nom).map(|j| j.v.first().copied().unwrap_or(f64::NAN));
    Ok(ChampLointain { dmax: premier("Dmax")?, prad: premier("Prad")?, e_norm: norme.chunks(n_theta).map(|l| l.to_vec()).collect() })
}

// ==========================================================================
// Les resultats
// ==========================================================================
fn db(v: f64) -> f64 {
    20.0 * maxi(v, 1e-12).log10()
}

/// np.argmin(np.abs(s)) : le premier minimum, et le premier NaN s'il y en a un.
fn argmin(v: &[f64]) -> usize {
    if let Some(i) = v.iter().position(|x| x.is_nan()) {
        return i;
    }
    let mut i = 0;
    for (k, x) in v.iter().enumerate() {
        if *x < v[i] {
            i = k;
        }
    }
    i
}

/// « %+.1f » : le signe toujours ecrit.
fn signe1(v: f64, dec: usize, largeur: usize) -> String {
    format!("{:>largeur$}", format!("{}{:.*}", if v.is_sign_negative() { "" } else { "+" }, dec, v))
}

fn reels(v: &[C]) -> Json {
    nombres(v.iter().map(|x| x.re))
}

fn imags(v: &[C]) -> Json {
    nombres(v.iter().map(|x| x.im))
}

/// UN NaN DANS DU JSON N'EST PAS DU JSON : JSON.parse le refuse, et la page perd TOUT le
/// resultat — le S11 compris — parce qu'une seule grandeur n'a pas converge.
fn sain(v: Json) -> Json {
    match v {
        Json::Flottant(x) if !x.is_finite() => Json::Nul,
        Json::Liste(l) => Json::Liste(l.into_iter().map(sain).collect()),
        Json::Objet(o) => Json::Objet(o.into_iter().map(|(k, e)| (k, sain(e))).collect()),
        v => v,
    }
}

/// Ce que le depouillement des ports a trouve, avant le champ lointain.
pub struct Ports {
    pub freq: Vec<f64>,
    pub calcules: Vec<PortCalcule>,
    /// le rang, dans `calcules`, du port qui donne le S11
    pub excite: usize,
    pub s11: Vec<C>,
    pub zin: Vec<C>,
    /// le rang de la resonance : la ou |S11| est le plus bas
    pub i0: usize,
    couplages: Vec<(i64, Vec<C>)>,
    z_pied: Option<Vec<C>>,
    /// Les lignes que le script imprimait.
    pub journal: Vec<String>,
}

/// Les sondes -> S11, impedance, couplages. Rend aussi ce qui s'imprimait au journal.
pub fn depouiller_ports(m: &Json, mesures: &[PortMesure], dossier: &Path) -> Result<Ports, String> {
    let b = &m["bande"];
    let n = b["n"].as_i64().unwrap_or(0).max(0) as usize;
    let freq = linspace(lit_e(f(&b["f1"]), 6), lit_e(f(&b["f2"]), 6), n);
    if n == 0 || mesures.is_empty() {
        return Err("Rien a depouiller : aucune frequence ou aucun port.".into());
    }
    let calcules: Vec<PortCalcule> = mesures.iter().map(|p| calculer_port(p, dossier, &freq)).collect::<Result<_, _>>()?;
    let ports = liste(&m["ports"]);
    let n_excite = m["port"]["n"].as_i64().unwrap_or(1);
    let excite = mesures.iter().position(|p| p.n == n_excite).unwrap_or(0);
    let port = &calcules[excite];
    let s11: Vec<C> = (0..n).map(|k| port.uf_ref[k] / port.uf_inc[k]).collect();
    let zin: Vec<C> = (0..n).map(|k| port.uf_tot[k] / port.if_tot[k]).collect();
    let reseau = m["reseau"].vrai();

    // LES COUPLAGES. S(j,i) = ce qui RESSORT du port j divise par ce qui ENTRE par le
    // port i. Le denominateur est donc toujours celui du port excite : un S21 rapporte a
    // l'onde incidente du port 2 — qui est nulle, puisqu'il n'excite pas — ne serait qu'une
    // division par du bruit numerique. UN RESEAU : le coefficient de reflexion ACTIF de
    // chaque port excite, b_i / a_i, pendant que tous emettent.
    let mut couplages = Vec::new();
    for (k, q) in mesures.iter().enumerate() {
        if q.n == n_excite {
            continue;
        }
        let den = if reseau && q.excite { &calcules[k].uf_inc } else { &port.uf_inc };
        couplages.push((q.n, (0..n).map(|x| calcules[k].uf_ref[x] / den[x]).collect::<Vec<C>>()));
    }

    let mut journal = Vec::new();
    // |S11| depasse 1 aux bords de la bande, la ou l'impulsion n'a presque plus d'energie :
    // le rapport de deux nombres minuscules n'y a plus de sens. Sans la saturation, le ROE y
    // ressort negatif — une valeur qui n'existe pas et qu'on lirait pourtant dans le tableau.
    let roe = |s: C| {
        let a = s.abs().clamp(0.0, 0.999999);
        (1.0 + a) / (1.0 - a)
    };
    for k in (0..n).step_by((n / 20).max(1)) {
        journal.push(format!("{:9.4} GHz   S11 {:7.2} dB   Z {:7.2} {}j   VSWR {:5.2}", freq[k] / 1e9, 20.0 * s11[k].abs().log10(),
                             zin[k].re, signe1(zin[k].im, 2, 7), roe(s11[k])));
    }
    let i0 = argmin(&s11.iter().map(|s| s.abs()).collect::<Vec<_>>());
    journal.push(String::new());
    journal.push(format!("Resonance : {:.4} GHz, S11 = {:.2} dB, Z = {:.1} {}j ohms", freq[i0] / 1e9, 20.0 * s11[i0].abs().log10(),
                         zin[i0].re, signe1(zin[i0].im, 1, 0)));

    // -- l'impedance ramenee au pied de l'antenne -------------------------
    // Une ligne de longueur d fait tourner l'impedance :
    //   Z(entree) = Z0 . (Z(charge) + j.Z0.tan(beta.d)) / (Z0 + j.Z(charge).tan(beta.d))
    // On la retourne. ATTENTION A CE QUE CELA VEUT DIRE : la rotation est SANS PERTE et
    // son Z0 est ANALYTIQUE (Hammerstad). Elle ne change donc pas l'adaptation -- elle ne
    // fait que deplacer le plan de reference -- et pres du bord de l'abaque de Smith, la ou
    // une antenne est mal adaptee, elle amplifie toute erreur sur Z0 et sur er effectif.
    let mut z_pied = None;
    for (k, p) in ports.iter().enumerate().filter(|(_, p)| p["ligne"].vrai()) {
        let Some(pc) = calcules.get(k) else { continue };
        let src: Vec<C> = if k == excite { zin.clone() } else { (0..n).map(|x| pc.uf_tot[x] / pc.if_tot[x]).collect() };
        // LE PORT MICRORUBAN MESURE DEJA AU PIED : sa propagation et son Z0 sont ceux de
        // la ligne maillee, et une seconde rotation analytique par-dessus compterait la
        // ligne deux fois.
        let z = if p["msl"].vrai() {
            src
        } else {
            let lg = &p["ligne"];
            let (z0, eeff, d) = (lit(f(&lg["z0"]), 6), lit(f(&lg["eeff"]), 6), lit(f(&lg["d"]), 6));
            let z: Vec<C> = (0..n).map(|x| {
                let t = (2.0 * std::f64::consts::PI * freq[x] * eeff.sqrt() / C0 * d / 1000.0).tan();
                (src[x] - J * z0 * t) * z0 / (c(z0, 0.0) - J * src[x] * t)
            }).collect();
            journal.push(format!("Au pied de l'antenne (port {}, ligne de {} mm) : Z = {:.1} {}j ohms", p["n"].as_i64().unwrap_or(0),
                                 xml::_f(f(&lg["d"]), 3), z[i0].re, signe1(z[i0].im, 1, 0)));
            z
        };
        if k == excite {
            z_pied = Some(z);
        }
    }
    for (q, s) in &couplages {
        let pire = s.iter().map(|x| x.abs()).fold(f64::NEG_INFINITY, |a, x| if a.is_nan() || x.is_nan() { f64::NAN } else { a.max(x) });
        let nom = if reseau { format!("Gamma actif {q}") } else { format!("S{q}{n_excite}") };
        journal.push(format!("{nom}       : {:.2} dB a la resonance, {:.2} dB au pire", db(s[i0].abs()), db(pire)));
    }
    Ok(Ports { freq, calcules, excite, s11, zin, i0, couplages, z_pied, journal })
}

/// LA PUISSANCE ACCEPTEE PAR L'ANTENNE, et non 0.5.Re(V.I*) : le signe de cette derniere
/// depend du sens de reference du courant du port, et un rendement negatif n'apprend rien a
/// personne. Ce qui entre vraiment, c'est l'incidente moins la reflechie. Un reseau : la
/// SOMME sur les ports excites, chacun avec son coefficient de reflexion actif.
/// Rend (incidente, acceptee).
pub fn puissances(m: &Json, mesures: &[PortMesure], p: &Ports) -> (f64, f64) {
    let i0 = p.i0;
    let inc = |pc: &PortCalcule| (0.5 * (pc.uf_inc[i0] * pc.if_inc[i0].conj()).re).abs();
    if m["reseau"].vrai() {
        let (mut p_inc, mut p_acc) = (0.0, 0.0);
        for (pc, _) in p.calcules.iter().zip(mesures).filter(|(_, q)| q.excite) {
            let pi = inc(pc);
            p_inc += pi;
            p_acc += pi * (1.0 - mini((pc.uf_ref[i0] / pc.uf_inc[i0]).abs(), 1.0).powi(2));
        }
        (p_inc, p_acc)
    } else {
        let p_inc = inc(&p.calcules[p.excite]);
        (p_inc, p_inc * (1.0 - p.s11[i0].abs().powi(2)))
    }
}

/// Les lignes que le script imprimait sur le champ lointain.
///
/// DEUX GAINS, ET ILS NE REPONDENT PAS A LA MEME QUESTION. Le gain (IEEE) rapporte le
/// rayonnement a la puissance ACCEPTEE : il dit ce que l'antenne perd en elle-meme. Le gain
/// REALISE le rapporte a la puissance INCIDENTE : il compte en plus ce que la desadaptation
/// renvoie au generateur -- c'est lui qu'un bilan de liaison utilise.
pub fn journal_nf2ff(nf: &ChampLointain, p_inc: f64, p_acc: f64) -> Vec<String> {
    let mut t = vec![format!("Directivite : {:.2} dBi", 10.0 * nf.dmax.log10())];
    if p_acc > 0.0 {
        t.push(format!("Rendement   : {:.1} %", 100.0 * nf.prad / p_acc));
        t.push(format!("Gain        : {:.2} dBi (IEEE, desadaptation exclue)", 10.0 * (nf.dmax * nf.prad / p_acc).log10()));
    }
    if p_inc > 0.0 && nf.prad > 0.0 {
        t.push(format!("Gain realise: {:.2} dBi (desadaptation comprise)", 10.0 * (nf.dmax * nf.prad / p_inc).log10()));
    }
    t
}

/// Le resultat rendu a la page : ce que le script ecrivait dans resultats.json.
pub fn resultats(m: &Json, mesures: &[PortMesure], p: &Ports, nf: Option<&ChampLointain>) -> Json {
    let (i0, n) = (p.i0, p.freq.len());
    let s11_db: Vec<f64> = p.s11.iter().map(|s| db(s.abs())).collect();
    // LE ROE DEVIENT NEGATIF DES QUE |S11| DEPASSE 1 : on sature, et la page affiche la
    // saturation au lieu de tracer une courbe qui plonge.
    let vswr = p.s11.iter().map(|s| {
        let a = s.abs().clamp(0.0, 0.999999);
        mini((1.0 + a) / (1.0 - a), 99.0)
    });
    let mut out = Objet::new();
    let mut pose = |k: &str, v: Json| {
        out.insert(k.to_string(), v);
    };
    pose("f", nombres(p.freq.iter().copied()));
    pose("s11_db", nombres(s11_db.iter().copied()));
    pose("s11_re", reels(&p.s11));
    pose("s11_im", imags(&p.s11));
    pose("z_re", reels(&p.zin));
    pose("z_im", imags(&p.zin));
    pose("vswr", nombres(vswr));
    pose("f0", p.freq[i0].into());
    pose("s11_min_db", s11_db[i0].into());
    pose("z0_re", p.zin[i0].re.into());
    pose("z0_im", p.zin[i0].im.into());
    // L'IMPEDANCE RAMENEE AU PIED DE L'ANTENNE, quand la ligne d'alimentation est
    // declaree. Les reserves voyagent AVEC les nombres -- rotation sans perte, Z0
    // analytique -- parce qu'une impedance ramenee qu'on lirait sans elles serait crue au
    // dixieme d'ohm.
    let lg = &m["port"]["ligne"];
    if let (true, Some(z)) = (lg.vrai(), &p.z_pied) {
        pose("ligne", obj! {"d" => lg["d"].clone(), "w" => lg["w"].clone(), "h" => lg["h"].clone(), "er" => lg["er"].clone(),
                            "z0" => lg["z0"].clone(), "eeff" => lg["eeff"].clone()});
        pose("z_pied_re", reels(z));
        pose("z_pied_im", imags(z));
        pose("z0_pied_re", z[i0].re.into());
        pose("z0_pied_im", z[i0].im.into());
    }
    // Le port microruban : le Z0 MESURE de la ligne, a la resonance, et la longueur sur
    // laquelle le solveur a ramene la mesure.
    let q = &m["port"]["msl"];
    if q.vrai() {
        let z = p.calcules[p.excite].z_ref[i0];
        pose("msl", obj! {"z_ref_re" => z.re, "z_ref_im" => z.im, "d" => (f(&q["fin"]) - f(&q["debut"])).abs()});
    }
    // La bande passante : ou le S11 reste sous -10 dB (VSWR < 2), la convention d'usage
    // pour une antenne. Elle n'a de sens que si la resonance est DANS la bande simulee —
    // sinon on mesure un bord.
    let sous: Vec<usize> = (0..n).filter(|k| s11_db[*k] < -10.0).collect();
    if let (Some(a), Some(z)) = (sous.first(), sous.last()) {
        pose("bp_f1", p.freq[*a].into());
        pose("bp_f2", p.freq[*z].into());
        pose("bp_continue", (sous.len() == z - a + 1).into());
        pose("bp_bord", (*a == 0 || *z == n - 1).into());
    }
    if mesures.len() > 1 {
        // LES COUPLAGES, PORT PAR PORT. Un S21 ne se lit pas dans un S11 et ne s'en deduit
        // pas : c'est une mesure a part, et la seule qui dise si deux antennes se genent.
        // On garde le complexe entier — la page trace des decibels, mais l'abaque de Smith
        // aurait besoin des deux parties.
        pose("ports", Json::Liste(liste(&m["ports"]).iter().map(|q| obj! {
            "n" => q["n"].clone(), "nom" => q["nom"].clone(), "type" => q["type"].clone(), "excite" => q["excite"].vrai(),
            "R" => q["R"].clone(), "z0_ligne" => q["coax"]["z0_ligne"].as_f64().unwrap_or(0.0)}).collect()));
        pose("excite", m["port"]["n"].clone());
        // Un reseau : `couplages` porte les coefficients de reflexion ACTIFS, et la page
        // doit les nommer ainsi, pas « S21 ».
        pose("reseau", m["reseau"].vrai().into());
        let mut cs = Objet::new();
        for (q, s) in &p.couplages {
            let modules: Vec<f64> = s.iter().map(|x| x.abs()).collect();
            let pire = modules.iter().fold(f64::NEG_INFINITY, |a, x| if a.is_nan() || x.is_nan() { f64::NAN } else { a.max(*x) });
            cs.insert(q.to_string(), obj! {"db" => nombres(modules.iter().map(|x| db(*x))), "re" => reels(s), "im" => imags(s),
                                           "pire_db" => db(pire), "db_f0" => db(modules[i0])});
        }
        pose("couplages", Json::Objet(cs));
    }
    if let Some(nf) = nf {
        let (p_inc, p_acc) = puissances(m, mesures, p);
        // Le maximum peut etre nul si la boite n'a rien enregistre : diviser par lui
        // remplirait le diagramme entier de NaN.
        let emax = nf.e_norm.iter().flatten().fold(f64::NEG_INFINITY, |a, x| if a.is_nan() || x.is_nan() { f64::NAN } else { a.max(*x) });
        let div = if emax > 0.0 { emax } else { 1.0 };
        // Dmax peut etre « nan » quand la boite de champ lointain n'a rien pu integrer.
        let mut o = Objet::new();
        o.insert("theta".into(), nombres(liste(&m["nf2ff"]["theta"]).iter().map(|v| lit(f(v), 2))));
        o.insert("phi".into(), nombres(liste(&m["nf2ff"]["phi"]).iter().map(|v| lit(f(v), 2))));
        o.insert("f".into(), p.freq[i0].into());
        o.insert("dmax_dbi".into(), if nf.dmax.is_finite() && nf.dmax > 0.0 { (10.0 * nf.dmax.log10()).into() } else { Json::Nul });
        o.insert("prad".into(), nf.prad.into());
        // Une COURBE PAR PLAN — c'est-a-dire par phi.
        o.insert("e_norm".into(), Json::Liste(nf.e_norm.iter().map(|l| nombres(l.iter().map(|v| v / div))).collect()));
        if p_acc > 0.0 && nf.dmax.is_finite() {
            o.insert("rendement".into(), (nf.prad / p_acc).into());
            o.insert("gain_dbi".into(), (10.0 * (nf.dmax * nf.prad / p_acc).log10()).into());
        }
        if p_inc > 0.0 && nf.prad > 0.0 && nf.dmax.is_finite() {
            o.insert("gain_realise_dbi".into(), (10.0 * (nf.dmax * nf.prad / p_inc).log10()).into());
        }
        pose("nf2ff", Json::Objet(o));
    }
    sain(Json::Objet(out))
}
