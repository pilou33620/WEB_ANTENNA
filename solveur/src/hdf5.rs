//! Un lecteur HDF5 minimal, en Rust pur : juste ce qu'il faut pour relire le fichier que
//! `nf2ff` ecrit (quelques groupes, des tableaux de flottants, trois attributs).
//!
//! POURQUOI A LA MAIN. La seule caisse HDF5 eprouvee lie la bibliotheque C, qu'il faudrait
//! alors livrer avec le lanceur sous Windows -- pour lire six tableaux. Or `nf2ff` ecrit par
//! l'API C avec ses reglages d'usine, et le fichier a toujours la meme forme, la plus
//! ancienne du format : superbloc 0 (ou 1), groupes « a table de symboles » (arbre B v1 et
//! tas local), en-tetes d'objet v1, donnees contigues ou compactes, sans filtre. C'est cette
//! forme-la qui est lue ici (HDF5 File Format Specification, version 1.1), et rien d'autre :
//! tout le reste est refuse par un message qui dit quoi.
//!
//!     let h = Fichier::ouvrir(chemin)?;
//!     let e = h.jeu("/nf2ff/E_theta/FD/f0_real")?;      // e.dims, e.v
//!     let d = h.attribut("/nf2ff", "Dmax")?;

use std::path::Path;

const SIGNATURE: &[u8] = b"\x89HDF\r\n\x1a\n";

pub struct Fichier {
    d: Vec<u8>,
    /// taille d'une adresse, taille d'une longueur
    to: usize,
    tl: usize,
    base: u64,
    racine: u64,
}

/// Un tableau de nombres : ses dimensions (aucune pour un scalaire) et ses valeurs, rangees
/// dans l'ordre du fichier (la derniere dimension varie le plus vite).
#[derive(Debug, Clone, PartialEq)]
pub struct Jeu {
    pub dims: Vec<usize>,
    pub v: Vec<f64>,
}

type Res<T> = Result<T, String>;

/// Le type d'un nombre : classe (0 entier, 1 flottant), taille, signe.
#[derive(Clone, Copy)]
struct Type {
    classe: u8,
    taille: usize,
    signe: bool,
}

#[derive(Default)]
struct Entete {
    table: Option<(u64, u64)>,
    dims: Option<Vec<usize>>,
    genre: Option<Type>,
    /// Ou sont les donnees : (adresse, taille) dans le fichier, ou les octets eux-memes.
    contigu: Option<(u64, u64)>,
    compact: Option<Vec<u8>>,
    attributs: Vec<(String, Jeu)>,
}

impl Fichier {
    pub fn ouvrir(chemin: &Path) -> Res<Fichier> {
        let d = std::fs::read(chemin).map_err(|e| format!("{} : {e}", chemin.display()))?;
        Fichier::lire(d)
    }

    pub fn lire(d: Vec<u8>) -> Res<Fichier> {
        if d.len() < 64 || &d[..8] != SIGNATURE {
            return Err("ce n'est pas un fichier HDF5 (signature absente)".into());
        }
        let version = d[8];
        let mut h = Fichier { d, to: 8, tl: 8, base: 0, racine: 0 };
        match version {
            0 | 1 => {
                h.to = h.d[13] as usize;
                h.tl = h.d[14] as usize;
                let p = if version == 0 { 24 } else { 28 };
                h.base = h.adr(p)?;
                // base, espace libre, fin de fichier, pilote, puis l'entree de la racine :
                // decalage du nom, puis l'adresse de son en-tete d'objet.
                h.racine = h.adr(p + 4 * h.to + h.to)?;
            }
            2 | 3 => {
                h.to = h.d[9] as usize;
                h.tl = h.d[10] as usize;
                h.base = h.adr(12)?;
                h.racine = h.adr(12 + 3 * h.to)?;
            }
            v => return Err(format!("superbloc HDF5 de version {v} : non pris en charge")),
        }
        if !(h.to == 4 || h.to == 8) || !(h.tl == 4 || h.tl == 8) {
            return Err("tailles d'adresse HDF5 inattendues".into());
        }
        Ok(h)
    }

    fn octets(&self, p: usize, n: usize) -> Res<&[u8]> {
        self.d.get(p..p.checked_add(n).ok_or("debordement")?).ok_or_else(|| "fichier HDF5 tronque".to_string())
    }

    fn ent(&self, p: usize, n: usize) -> Res<u64> {
        Ok(self.octets(p, n)?.iter().rev().fold(0u64, |a, o| (a << 8) | *o as u64))
    }

    fn adr(&self, p: usize) -> Res<u64> {
        self.ent(p, self.to)
    }

    /// Une adresse du fichier -> une position dans les octets lus.
    fn pos(&self, a: u64) -> Res<usize> {
        if a == u64::MAX || (self.to == 4 && a == u32::MAX as u64) {
            return Err("adresse HDF5 indefinie (donnees jamais ecrites)".into());
        }
        usize::try_from(a + self.base).map_err(|_| "adresse HDF5 hors du fichier".to_string())
    }

    /// Les valeurs d'un tableau, par son chemin (« /Mesh/theta »).
    pub fn jeu(&self, chemin: &str) -> Res<Jeu> {
        let e = self.entete(self.objet(chemin)?)?;
        let dims = e.dims.ok_or_else(|| format!("{chemin} : pas un tableau"))?;
        let genre = e.genre.ok_or_else(|| format!("{chemin} : type absent"))?;
        let n: usize = dims.iter().product();
        let brut = match (&e.compact, e.contigu) {
            (Some(o), _) => o.as_slice(),
            (None, Some((a, _))) => self.octets(self.pos(a)?, n * genre.taille)?,
            _ => return Err(format!("{chemin} : rangement des donnees non pris en charge (morcele ou filtre)")),
        };
        Ok(Jeu { v: nombres(brut, genre, n)?, dims })
    }

    /// Un attribut d'un groupe ou d'un tableau.
    pub fn attribut(&self, chemin: &str, nom: &str) -> Res<Jeu> {
        let e = self.entete(self.objet(chemin)?)?;
        e.attributs.into_iter().find(|(n, _)| n == nom).map(|(_, j)| j).ok_or_else(|| format!("{chemin} : attribut « {nom} » absent"))
    }

    /// L'adresse de l'en-tete d'un objet, en descendant les groupes.
    fn objet(&self, chemin: &str) -> Res<u64> {
        let mut a = self.racine;
        for nom in chemin.split('/').filter(|s| !s.is_empty()) {
            let (arbre, tas) = self.entete(a)?.table.ok_or_else(|| format!("{chemin} : « {nom} » n'est pas dans un groupe a table de symboles"))?;
            // le tas local : « HEAP », version, 3 reserves, taille, liste libre, adresse des donnees
            let pt = self.pos(tas)?;
            if self.octets(pt, 4)? != b"HEAP" {
                return Err("tas local HDF5 attendu".into());
            }
            let noms = self.pos(self.adr(pt + 8 + 2 * self.tl)?)?;
            a = self.chercher(arbre, noms, nom, 0)?.ok_or_else(|| format!("{chemin} : « {nom} » introuvable"))?;
        }
        Ok(a)
    }

    /// Cherche un nom sous un noeud de l'arbre B d'un groupe.
    fn chercher(&self, noeud: u64, noms: usize, nom: &str, prof: usize) -> Res<Option<u64>> {
        let p = self.pos(noeud)?;
        if prof > 32 {
            return Err("arbre HDF5 trop profond".into());
        }
        match self.octets(p, 4)? {
            b"TREE" => {
                // type, niveau, nombre d'entrees, freres gauche et droit, puis cle, enfant, cle...
                let n = self.ent(p + 6, 2)? as usize;
                let debut = p + 8 + 2 * self.to;
                for k in 0..n {
                    let enfant = self.adr(debut + self.tl + k * (self.tl + self.to))?;
                    if let Some(a) = self.chercher(enfant, noms, nom, prof + 1)? {
                        return Ok(Some(a));
                    }
                }
                Ok(None)
            }
            b"SNOD" => {
                let n = self.ent(p + 6, 2)? as usize;
                for k in 0..n {
                    // une entree : decalage du nom, adresse de l'en-tete, 4 + 4 + 16 octets de cache
                    let e = p + 8 + k * (2 * self.to + 24);
                    let pn = noms + self.adr(e)? as usize;
                    let fin = self.d.get(pn..).and_then(|s| s.iter().position(|o| *o == 0)).ok_or("nom HDF5 sans fin")?;
                    if &self.d[pn..pn + fin] == nom.as_bytes() {
                        return Ok(Some(self.adr(e + self.to)?));
                    }
                }
                Ok(None)
            }
            _ => Err("noeud de groupe HDF5 inattendu".into()),
        }
    }

    /// Les messages d'un en-tete d'objet (version 1), blocs de continuation compris.
    fn entete(&self, adresse: u64) -> Res<Entete> {
        let p = self.pos(adresse)?;
        if self.octets(p, 4)? == b"OHDR" {
            return Err("en-tete d'objet HDF5 de version 2 : non pris en charge (fichier ecrit au format « latest »)".into());
        }
        if self.d[p] != 1 {
            return Err(format!("en-tete d'objet HDF5 de version {} : non pris en charge", self.d[p]));
        }
        let mut reste = self.ent(p + 2, 2)? as usize;
        let mut blocs = vec![(p + 16, self.ent(p + 8, 4)? as usize)];
        let mut e = Entete::default();
        let mut k = 0;
        while k < blocs.len() && reste > 0 {
            let (mut q, taille) = blocs[k];
            let fin = q + taille;
            while q + 8 <= fin && reste > 0 {
                let genre = self.ent(q, 2)?;
                let n = self.ent(q + 2, 2)? as usize;
                let partage = self.d[q + 4] & 2 != 0;
                let m = self.octets(q + 8, n)?;
                reste -= 1;
                q += 8 + n;
                if partage && matches!(genre, 1 | 3 | 8 | 12) {
                    return Err("message HDF5 partage : non pris en charge".into());
                }
                match genre {
                    0x01 => e.dims = Some(self.espace(m)?),
                    0x03 => e.genre = Some(type_de(m)?),
                    0x08 => {
                        if m[0] != 3 {
                            return Err(format!("rangement HDF5 de version {} : non pris en charge", m[0]));
                        }
                        match m[1] {
                            0 => {
                                let t = u16::from_le_bytes([m[2], m[3]]) as usize;
                                e.compact = Some(m.get(4..4 + t).ok_or("donnees compactes tronquees")?.to_vec());
                            }
                            1 => e.contigu = Some((lire(m, 2, self.to)?, lire(m, 2 + self.to, self.tl)?)),
                            _ => {}
                        }
                    }
                    0x0C => e.attributs.push(self.attribut_de(m)?),
                    0x10 => blocs.push((self.pos(lire(m, 0, self.to)?)?, lire(m, self.to, self.tl)? as usize)),
                    0x11 => e.table = Some((lire(m, 0, self.to)?, lire(m, self.to, self.tl)?)),
                    _ => {}
                }
            }
            k += 1;
        }
        Ok(e)
    }

    /// Un message « espace » : les dimensions.
    fn espace(&self, m: &[u8]) -> Res<Vec<usize>> {
        let (version, rang) = (*m.first().ok_or("espace vide")?, m[1] as usize);
        let debut = match version {
            1 => 8,
            2 => 4,
            v => return Err(format!("espace HDF5 de version {v} : non pris en charge")),
        };
        (0..rang).map(|k| lire(m, debut + k * self.tl, self.tl).map(|v| v as usize)).collect()
    }

    /// Un message « attribut » : son nom et ses valeurs.
    fn attribut_de(&self, m: &[u8]) -> Res<(String, Jeu)> {
        let version = m[0];
        let (tn, tt, te) = (lire(m, 2, 2)? as usize, lire(m, 4, 2)? as usize, lire(m, 6, 2)? as usize);
        // La version 1 aligne chaque partie sur huit octets, les suivantes non ; la 3 ajoute
        // un octet pour le codage du nom.
        let aligne = |n: usize| if version == 1 { n.div_ceil(8) * 8 } else { n };
        let mut p = if version == 3 { 9 } else { 8 };
        let nom = m.get(p..p + tn).ok_or("attribut tronque")?;
        let nom = String::from_utf8_lossy(nom.split(|o| *o == 0).next().unwrap_or(&[])).into_owned();
        p += aligne(tn);
        let genre = type_de(m.get(p..p + tt).ok_or("attribut tronque")?);
        p += aligne(tt);
        let dims = self.espace(m.get(p..p + te).ok_or("attribut tronque")?)?;
        p += aligne(te);
        let n: usize = dims.iter().product();
        // Un attribut d'un type qu'on ne lit pas (du texte) reste vide : il n'empeche pas
        // de lire les autres.
        let v = match genre {
            Ok(g) => nombres(m.get(p..).unwrap_or(&[]), g, n)?,
            Err(_) => Vec::new(),
        };
        Ok((nom, Jeu { dims, v }))
    }
}

fn lire(m: &[u8], p: usize, n: usize) -> Res<u64> {
    Ok(m.get(p..p + n).ok_or("message HDF5 tronque")?.iter().rev().fold(0u64, |a, o| (a << 8) | *o as u64))
}

/// Un message « type » : entier ou flottant, petit-boutiste.
fn type_de(m: &[u8]) -> Res<Type> {
    if m.len() < 8 {
        return Err("type HDF5 tronque".into());
    }
    let classe = m[0] & 0x0F;
    let taille = u32::from_le_bytes([m[4], m[5], m[6], m[7]]) as usize;
    if m[1] & 1 != 0 {
        return Err("nombres HDF5 gros-boutistes : non pris en charge".into());
    }
    match (classe, taille) {
        (0, 1 | 2 | 4 | 8) | (1, 4 | 8) => Ok(Type { classe, taille, signe: m[1] & 8 != 0 }),
        _ => Err(format!("type HDF5 non pris en charge (classe {classe}, {taille} octets)")),
    }
}

fn nombres(brut: &[u8], g: Type, n: usize) -> Res<Vec<f64>> {
    let brut = brut.get(..n * g.taille).ok_or("donnees HDF5 tronquees")?;
    Ok(brut.chunks_exact(g.taille).map(|c| {
        let mut o = [0u8; 8];
        o[..c.len()].copy_from_slice(c);
        match (g.classe, g.taille) {
            (1, 4) => f32::from_le_bytes([c[0], c[1], c[2], c[3]]) as f64,
            (1, _) => f64::from_le_bytes(o),
            (_, t) if g.signe => {
                let d = 64 - 8 * t as u32;
                ((u64::from_le_bytes(o) << d) as i64 >> d) as f64
            }
            _ => u64::from_le_bytes(o) as f64,
        }
    }).collect())
}
