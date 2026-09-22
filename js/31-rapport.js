"use strict";
/* =============================================================================
   Antenne openEMS — 31-rapport.js
   Rapport technique d'ingénierie & diagnostic complet de simulation FDTD.

   CE QUE CE RAPPORT APPORTE. Une simulation électromagnétique produit des
   chiffres — un S11, une impédance, un gain —, mais un chiffre sans son
   contexte ne permet ni de certifier une antenne, ni d'expliquer pourquoi
   elle ne fonctionne pas. Ce module extrait TOUT ce qui caractérise le cas :
   le type d'antenne, ses dimensions exactes, l'empilage PCB (épaisseurs, εr,
   tanδ), les ports, la boîte d'air, les cellules PML, la grille FDTD (cellules
   Yee, pas spatiaux, pas de temps CFL), et confronte les résultats aux
   règles de l'art pour détecter automatiquement les anomalies (troncature,
   dispersion, résonance fantôme, dissipation excessive).
   ============================================================================= */

/* ---------- Fonctions utilitaires autonomes ---------- */
function rapNb(val, dec){
  if(val == null || isNaN(val)) return "—";
  if(typeof aNb === "function") return aNb(val, dec != null ? dec : 2);
  return Number(val).toFixed(dec != null ? dec : 2);
}

function rapFmtHz(hz){
  if(hz == null || isNaN(hz) || hz <= 0) return "—";
  if(typeof aF === "function") return aF(hz);
  if(hz >= 1e9) return (hz / 1e9).toFixed(3) + " GHz";
  if(hz >= 1e6) return (hz / 1e6).toFixed(2) + " MHz";
  if(hz >= 1e3) return (hz / 1e3).toFixed(1) + " kHz";
  return hz.toFixed(0) + " Hz";
}

function rapFmtMm(v, dec){
  if(v == null || isNaN(v)) return "—";
  const d = (dec != null) ? dec : 3;
  return Number(v).toFixed(d) + " mm";
}

function rapEscHtml(s){
  if(s == null) return "";
  if(typeof aEsc === "function") return aEsc(s);
  return String(s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}

/* =============================================================================
   1. Collecte & Agrégation des données
   ============================================================================= */
function rapCollecterDonnees(){
  const d = {
    date: new Date(),
    projet: {
      nom: (typeof PRJ !== "undefined" && PRJ.nom) ? PRJ.nom : "Projet sans nom",
      source: "vide",
      fichier: "",
      unite: (typeof V !== "undefined" && V.unite) ? V.unite : "mm"
    },
    geometrie: {
      type: "Non défini",
      gabaritId: null,
      gabaritNom: null,
      cotesGabarit: [],
      carte: { L: 0, W: 0 },
      emprise: null,
      stats: { pistes: 0, plans: 0, pads: 0, vias: 0, formes: 0, primitives: 0 }
    },
    empilage: {
      epaisseurTotale: 0,
      couches: [],
      modeleCuivre: (typeof ANT !== "undefined" && ANT.modeleCuivre) ? ANT.modeleCuivre : "feuille",
      pertes: (typeof ANT !== "undefined" && ANT.pertes) ? ANT.pertes : { mode: "kappa", f_kappa: 0 }
    },
    ports: [],
    boite: {
      mx: 0, my: 0, mz_haut: 0, mz_bas: 0,
      pml: 8, ep_pml_mm: 0, air_restant_mm: 0, marge_conseil_mm: 0,
      air_utile_mm: 0
    },
    maillage: {
      lignes: null,
      cellules: 0,
      memoire_Mo: 0,
      res_air_mm: 0,
      res_die_mm: 0,
      /* Le pas des BANDES FINES, posées en travers du cuivre trop étroit pour
         le fond, et 0 quand il n'y en a pas. Le fond seul ne décrit plus le
         maillage depuis qu'il y a deux pas dans le plan. */
      res_fin_mm: 0,
      bandes_x: 0, bandes_y: 0,
      cellules_piste: 0,
      dt_ps: 0,
      min_cell_mm: null,
      /* QUI fabrique cette plus petite cellule : {mm, axe, quoi, couche, ep,
         revetement}, tel que le modele l'a designe. Ce rapport le DEDUISAIT,
         et il se trompait de la meme facon que l'assistant — il renvoyait
         chercher un sommet decale d'un micron quand la cellule etait
         l'epaisseur d'une couche de l'empilage. Voir `_coupable_cellule`
         dans python/openems_modele.py. */
      cellule: null,
      tiers: true,
      er_max: 1.0,
      lambda_min_mm: 0,
      lambda_max_mm: 0
    },
    solver: {
      f1: 0, f2: 0, fcible: 0, n: 0,
      energie_arret_dB: -40,
      nmax: 0,
      nmax_auto: false,
      nf2ff_actif: true
    },
    resultat: null,
    tache: null,
    avisModele: []
  };

  // Identification de la source
  const con = (typeof CON !== "undefined" && CON.actif);
  if(con){
    d.projet.source = "conception";
    d.geometrie.carte.L = (CON.carte && CON.carte.L) || 0;
    d.geometrie.carte.W = (CON.carte && CON.carte.W) || 0;
    if(CON.gabarit && typeof conGabarit === "function"){
      const g = conGabarit(CON.gabarit);
      if(g){
        d.geometrie.type = g.nom;
        d.geometrie.gabaritId = g.id;
        d.geometrie.gabaritNom = g.nom;
        const dfts = (typeof conGabaritDefauts === "function" && typeof conContexte === "function")
                     ? conGabaritDefauts(g, conContexte()) : {};
        g.champs.forEach(function(ch){
          const val = (CON.gabaritP && CON.gabaritP[ch.id] != null) ? CON.gabaritP[ch.id] : dfts[ch.id];
          d.geometrie.cotesGabarit.push({
            id: ch.id,
            nom: ch.nom,
            valeur: val,
            defaut: dfts[ch.id],
            unite: ch.unite || "mm",
            modifie: !!(CON.gabaritTouche && CON.gabaritTouche[ch.id])
          });
        });
      }
    } else {
      d.geometrie.type = "Dessin personnalisé (Mode conception)";
    }
  } else if(typeof V !== "undefined" && V.modele){
    d.projet.source = "ipc2581";
    d.projet.fichier = V.fichier || "Import IPC-2581";
    d.geometrie.type = "Antenne importée (IPC-2581)";
    if(V.modele.carte && V.modele.carte.bbox){
      const bb = V.modele.carte.bbox;
      d.geometrie.carte.L = Math.abs(bb[2] - bb[0]);
      d.geometrie.carte.W = Math.abs(bb[3] - bb[1]);
    }
  }

  // Cuivre & Statistiques géométriques
  if(typeof antCuivreDuModele === "function"){
    try{
      const cu = antCuivreDuModele();
      if(cu && cu.compte){
        d.geometrie.stats.pistes = cu.compte.pistes || 0;
        d.geometrie.stats.plans = cu.compte.plans || 0;
        d.geometrie.stats.pads = cu.compte.pads || 0;
        d.geometrie.stats.vias = (cu.vias && cu.vias.length) || 0;
      }
    }catch(e){}
  }
  if(typeof ANT !== "undefined" && ANT.primitives){
    d.geometrie.stats.primitives = ANT.primitives.length;
  }

  // Empilage PCB (Stackup)
  if(typeof antEmpilage === "function"){
    try{
      const pile = antEmpilage();
      let epTot = 0;
      pile.forEach(function(e){
        epTot += (e.ep || 0);
        d.empilage.couches.push({
          nom: e.nom,
          type: e.cuivre ? "cuivre" : "dielectrique",
          ep: e.ep || 0,
          role: e.role || (e.cuivre ? "signal" : ""),
          er: e.er || 1.0,
          df: e.df || 0,
          sigma: e.sigma || (e.cuivre ? 5.8e7 : 0)
        });
      });
      d.empilage.epaisseurTotale = epTot;
    }catch(e){}
  }

  // Bande & Réglages solveur
  if(typeof ANT !== "undefined"){
    if(ANT.bande){
      d.solver.f1 = ANT.bande.f1;
      d.solver.f2 = ANT.bande.f2;
      d.solver.fcible = ANT.bande.fcible;
      d.solver.n = ANT.bande.n;
    }
    if(ANT.arret){
      d.solver.energie_arret_dB = ANT.arret.energie;
      /* LE COMPTEUR EFFECTIF, PAS CELUI DU FORMULAIRE. Zéro veut dire
         « calculé par le modèle » : le recopier tel quel faisait écrire au
         rapport « 39 165 pas / 0 », et le diagnostic d'arrêt forcé, qui
         compare les pas exécutés au garde-fou, ne se déclenchait plus
         jamais. */
      d.solver.nmax = (ANT.modele && ANT.modele.arret && ANT.modele.arret.nmax)
                      || ANT.arret.nmax;
      d.solver.nmax_auto = !!(ANT.modele && ANT.modele.arret
                              && ANT.modele.arret.nmax_auto);
    }
    if(ANT.nf2ff){
      d.solver.nf2ff_actif = !!ANT.nf2ff.actif;
    }
    if(ANT.boite){
      d.boite.mx = ANT.boite.mx;
      d.boite.my = ANT.boite.my;
      d.boite.mz_haut = ANT.boite.mz_haut;
      d.boite.mz_bas = ANT.boite.mz_bas;
      d.boite.pml = ANT.boite.pml;
    }
    if(ANT.maillage){
      d.maillage.tiers = !!ANT.maillage.tiers;
    }
  }

  // Ports
  const listPorts = (ANT && ANT.modele && ANT.modele.ports) ? ANT.modele.ports : ((ANT && ANT.ports) ? ANT.ports : []);
  listPorts.forEach(function(p, i){
    d.ports.push({
      n: p.n != null ? p.n : (i + 1),
      nom: p.nom || ("Port " + (i + 1)),
      type: p.type || "localise",
      excite: !!p.excite,
      x: p.x || 0,
      y: p.y || 0,
      de: p.de || "",
      a: p.a || "",
      dir: p.dir || "x",
      R: p.R != null ? p.R : 50,
      w: p.w || 0,
      l: p.l || 0,
      ra: p.ra || 0,
      rb: p.rb || 0,
      er: p.er || 1,
      z0_coax: (p.type === "coaxial" && typeof antCoaxZ0 === "function") ? antCoaxZ0(p) : 50,
      ligne: p.ligne || ((p.ligne_d > 0 && p.ligne_w > 0) ? { d: p.ligne_d, w: p.ligne_w } : null)
    });
  });

  // Données du modèle normalisé (si disponible)
  if(typeof ANT !== "undefined" && ANT.modele){
    const m = ANT.modele;
    if(m.emprise) d.geometrie.emprise = m.emprise;
    if(m.boite){
      d.boite.air_restant_mm = m.boite.air_restant || 0;
      d.boite.marge_conseil_mm = m.boite.marge_conseil || 0;
      /* LES DEUX NOMBRES NE SE COMPARENT PAS, et les confondre faisait crier
         au loup sur tout modèle à marges automatiques. `marge_conseil` est la
         marge À SAISIR : l'air utile PLUS l'épaisseur de la PML, qui mange les
         dernières cellules de la boîte. `air_restant` est ce qui reste d'air
         une fois la PML retranchée. Le comparer au conseil complet revient à
         reprocher à la boîte de ne pas contenir sa propre PML deux fois. */
      d.boite.air_utile_mm = m.boite.air_utile || 0;
      d.boite.ep_pml_mm = m.boite.ep_pml || 0;
    }
    if(m.resolution){
      d.maillage.res_air_mm = m.resolution.air || 0;
      d.maillage.res_die_mm = m.resolution.die || 0;
      const _det = m.resolution.detail || {};
      d.maillage.res_fin_mm = _det.fin || 0;
      d.maillage.cellules_piste = (_det.pistes && _det.pistes.cellules) || 0;
      const _md = m.maillage_detail || {};
      d.maillage.bandes_x = _md.bandes_x || 0;
      d.maillage.bandes_y = _md.bandes_y || 0;
      d.maillage.er_max = m.resolution.er_max || 1.0;
      d.maillage.lambda_min_mm = m.resolution.lambda_min_mm || 0;
      d.maillage.lambda_max_mm = m.resolution.lambda_max_mm || 0;
    }
    if(m.estimation){
      d.maillage.lignes = m.estimation.lignes;
      d.maillage.cellules = m.estimation.cellules || 0;
      d.maillage.memoire_Mo = m.estimation.memoire_Mo || 0;
      d.maillage.dt_ps = (m.estimation.dt_s || 0) * 1e12;
      d.maillage.min_cell_mm = m.estimation.plus_petite_cellule_mm;
      d.maillage.cellule = m.estimation.cellule || null;
    }
    if(m.avis) d.avisModele = m.avis;
  }

  // Résultats de simulation
  const res = (typeof antRes === "function") ? antRes() : ((typeof ANT !== "undefined") ? ANT.resultat : null);
  if(res && (res.s11_min_db != null || res.diagnostic)){
    d.resultat = {
      f0: res.f0,
      s11_min_db: res.s11_min_db,
      z0_re: res.z0_re,
      z0_im: res.z0_im,
      z0_pied_re: res.z0_pied_re,
      z0_pied_im: res.z0_pied_im,
      ligne: res.ligne,
      bp: (typeof antBandePassante === "function") ? antBandePassante(res) : {
        existe: res.bp_f1 != null, f1: res.bp_f1, f2: res.bp_f2,
        largeur: (res.bp_f2 && res.bp_f1) ? (res.bp_f2 - res.bp_f1) : 0,
        relative: (res.bp_f2 && res.bp_f1) ? (100 * (res.bp_f2 - res.bp_f1) / ((res.bp_f2 + res.bp_f1) / 2)) : 0,
        continue: res.bp_continue !== false,
        bord: !!res.bp_bord
      },
      vswr: (res.vswr && res.f0 && res.f) ? res.vswr[res.f.indexOf(res.f0)] : null,
      couplages: res.couplages || null,
      nf2ff: res.nf2ff || null,
      diagnostic: res.diagnostic || null
    };
    if(res.f0 && d.solver.fcible > 0){
      d.resultat.ecart_cible_pct = 100 * (res.f0 - d.solver.fcible) / d.solver.fcible;
    }
  }

  // Tâche solveur
  if(typeof ANT !== "undefined" && ANT.tache){
    d.tache = {
      id: ANT.tache.id,
      etat: ANT.tache.etat,
      duree_s: ANT.tache.duree || 0,
      avancement: ANT.tache.avancement || {},
      lignes: ANT.tache.lignes || [],
      dossier: ANT.tache.dossier || ""
    };
  }

  return d;
}

/* =============================================================================
   2. Moteur de Diagnostic RF & Vigilance FDTD
   ============================================================================= */
function rapDiagnostiquer(d){
  const diags = [];

  // Diagnostic 1 : Exécution & Convergence temporelle
  if(!d.resultat){
    diags.push({
      id: "non_simule",
      titre: "Simulation non exécutée",
      rang: "info",
      desc: "Aucun résultat n'est disponible. Le modèle géométrique, l'empilage et le maillage sont prêts à être envoyés au solveur.",
      conseil: "Lancez la simulation depuis l'étape 7 ou le bouton « ▶ Lancer »."
    });
  } else if(d.resultat.diagnostic){
    diags.push({
      id: "echec_calcul",
      titre: "Échec de calcul / Non-convergence grave",
      rang: "crit",
      desc: "La simulation s'est terminée sans produire de grandeurs finies exploitables : " + d.resultat.diagnostic,
      conseil: "Vérifiez la stabilité du maillage, les permittivités des matériaux et les conditions aux limites."
    });
  } else {
    // Vérifier la convergence sur l'énergie résiduelle
    const av = d.tache && d.tache.avancement;
    const nmax = d.solver.nmax;
    const eCible = d.solver.energie_arret_dB;
    if(av && av.pas && nmax && av.pas >= nmax && av.energie_dB != null && av.energie_dB > (eCible + 5)){
      diags.push({
        id: "arret_nmax",
        titre: "Arrêt forcé à nmax : Énergie résiduelle insuffisante (" + rapNb(av.energie_dB, 1) + " dB)",
        rang: "warn",
        desc: "Le solveur a atteint le nombre maximum de pas (" + nmax + ") avant que l'énergie résiduelle n'ait décru sous le seuil d'arrêt (" + eCible + " dB). Une troncature temporelle prématurée engendre des ondulations artificielles (phénomène de Gibbs) sur le S11 et une résonance imprécise.",
        conseil: "Augmentez le garde-fou nmax (ex: 60 000 ou 100 000 pas) à l'étape 'Le calcul' pour laisser résonner l'antenne jusqu'à son extinction complète."
      });
    } else if(av && av.energie_dB != null && av.energie_dB <= eCible){
      diags.push({
        id: "conv_ok",
        titre: "Convergence temporelle complète",
        rang: "ok",
        desc: "L'énergie résiduelle a décru sous " + eCible + " dB (" + rapNb(av.energie_dB, 1) + " dB atteints en " + (av.pas || "—") + " pas). La transformée de Fourier temporelle (DFT) est mathématiquement stable et sans artefact de troncature.",
        conseil: null
      });
    }
  }

  // Diagnostic 2 : Résolution du maillage dans le diélectrique vs dispersion
  const resDie = d.maillage.res_die_mm;
  const lambdaMin = d.maillage.lambda_min_mm;
  const erMax = d.maillage.er_max || 1.0;
  if(resDie > 0 && lambdaMin > 0){
    const lambdaDie = lambdaMin / Math.sqrt(erMax);
    const pasMaxConseille = lambdaDie / 15.0;
    if(resDie > pasMaxConseille * 1.15){
      diags.push({
        id: "maillage_grossier",
        titre: "Maillage diélectrique grossier (Risque de dispersion numérique)",
        rang: "warn",
        desc: "Le pas de discrétisation dans le substrat (" + rapNb(resDie, 3) + " mm) dépasse le critère standard λ_d/15 (" + rapNb(pasMaxConseille, 3) + " mm à " + rapFmtHz(d.solver.f2) + "). En FDTD, une grille trop large induit une dispersion numérique qui abaisse artificiellement la fréquence de résonance calculée.",
        conseil: "Réduisez le pas de maillage diélectrique à l'étape 6 'La boîte' (ex: " + rapNb(pasMaxConseille, 3) + " mm) pour garantir au moins 15 à 20 cellules par longueur d'onde guidée."
      });
    } else {
      diags.push({
        id: "maillage_ok",
        titre: "Discrétisation spatiale conforme aux règles de l'art",
        rang: "ok",
        desc: "Le pas de maillage dans le diélectrique (" + rapNb(resDie, 3) + " mm) offre plus de 15 cellules par longueur d'onde guidée à la fréquence la plus haute. La dispersion numérique est maîtrisée.",
        conseil: null
      });
    }
  }

  // Diagnostic 3 : Cellule minuscule et pas de temps CFL
  if(d.maillage.min_cell_mm && d.maillage.min_cell_mm.length){
    const minCell = Math.min.apply(null, d.maillage.min_cell_mm);
    const dt = d.maillage.dt_ps;
    if(minCell < 0.04 || (dt > 0 && dt < 0.08)){
      /* LA CAUSE VIENT DU MODÈLE, ET NON D'UNE SUPPOSITION D'ICI. Le conseil
         écrit en dur — « vérifiez qu'aucun sommet n'est décalé d'une fraction
         de micron » — renvoyait au DESSIN, où il n'y a le plus souvent rien à
         corriger : sur antenna4c, la cellule de 15 µm était le vernis épargne
         de l'empilage, invisible dans le panneau qui montre l'empilage. */
      const c = d.maillage.cellule;
      let desc = "La présence d'une cellule très petite force un pas de temps CFL de seulement " + rapNb(dt, 3) + " ps. Cela multiplie par 5 à 50 le nombre de pas de temps nécessaires sans gain significatif en précision physique.";
      let conseil = "Vérifiez qu'aucun sommet de piste ou via n'est décalé d'une fraction de micron d'un bord de carte ou d'un contour de masse.";
      if(c && c.couche && c.quoi === "dielectrique"){
        desc += " Elle vient de la couche « " + c.couche + " » de l'empilage, épaisse de " + rapNb(c.ep, 4) + " mm : ses deux faces portent chacune une ligne de maillage obligatoire.";
        conseil = c.revetement
          ? "C'est un revêtement EXTÉRIEUR — vernis épargne, coverlay — posé sur le cuivre extérieur, pas entre deux cuivres : il ne porte aucun champ de ligne. L'étape « L'empilage » le sort du maillage d'une case à décocher."
          : "C'est un substrat : il est entre deux conducteurs, il porte le champ, et il doit rester. Le pas de temps est le prix de cet empilage-là.";
      }else if(c && c.couche && c.quoi === "cuivre"){
        desc += " Elle vient de l'épaisseur de « " + c.couche + " » (" + rapNb(c.ep, 4) + " mm), que le mode « volume » fait entrer dans le maillage.";
        conseil = "Passez le cuivre en mode « feuille » (étape 2) : à ces fréquences l'épaisseur de peau fait un micron, le courant ne voit pas les 35 µm de la couche, et le résultat est le même en une fraction du temps.";
      }else if(c && c.axe && c.axe !== "z"){
        desc += " Elle est dans le plan (" + c.axe + ") : deux arêtes de cuivre presque confondues, que la tolérance de regroupement n'a pas rapprochées.";
      }
      diags.push({
        id: "cellule_minuscule",
        titre: "Cellule Yee minuscule détectée (" + rapNb(minCell * 1000, 1) + " µm)",
        rang: "warn",
        desc: desc,
        conseil: conseil
      });
    }
  }

  // Diagnostic 4 : Marges d'air et couplage avec la PML
  if(d.boite.air_restant_mm > 0 && d.boite.air_utile_mm > 0){
    if(d.boite.air_restant_mm < d.boite.air_utile_mm * 0.75){
      diags.push({
        id: "pml_proche",
        titre: "Couche absorbante PML trop proche du rayonnement",
        rang: "warn",
        desc: "L'air libre devant la PML (" + rapNb(d.boite.air_restant_mm, 1) + " mm) est inférieur au quart de longueur d'onde conseillé (" + rapNb(d.boite.air_utile_mm, 1) + " mm, soit " + rapNb(d.boite.marge_conseil_mm, 1) + " mm de marge à saisir, PML comprise). Le champ réactif proche pénètre la PML, provoquant de fausses pertes d'énergie, une dégradation artificielle du facteur Q et faussant l'intégration en champ lointain.",
        conseil: "Augmentez les marges d'air dans la boîte de simulation (étape 6) pour éloigner la PML d'au moins λ/4 à la fréquence de travail."
      });
    }
  }

  // Diagnostic 5 : Résultats de rayonnement & Rendement
  if(d.resultat && d.resultat.nf2ff){
    const nf = d.resultat.nf2ff;
    if(nf.rendement != null && nf.rendement < 0.50 && d.resultat.s11_min_db < -10){
      diags.push({
        id: "faible_rendement",
        titre: "Faible rendement de rayonnement (" + rapNb(nf.rendement * 100, 1) + " %)",
        rang: "warn",
        desc: "L'antenne est bien adaptée (S11 = " + rapNb(d.resultat.s11_min_db, 1) + " dB), mais moins de la moitié de la puissance acceptée rayonne dans l'espace. Le reste est dissipé en pertes thermiques dans le diélectrique (tanδ) et le cuivre.",
        conseil: "Sur un substrat à fortes pertes (ex: FR-4 avec tanδ ≈ 0,02), privilégiez un substrat RF dédié (Rogers, PTFE) ou augmentez l'épaisseur de diélectrique pour améliorer l'efficacité de rayonnement."
      });
    }
    if(nf.dmax_dbi == null){
      diags.push({
        id: "nf2ff_indefini",
        titre: "Champ lointain indéfini",
        rang: "warn",
        desc: "La boîte d'intégration de champ lointain (NF2FF) n'a pas pu converger ou a enregistré une intégration nulle.",
        conseil: "Vérifiez que la boîte de champ lointain est entièrement contenue dans l'air libre et ne coupe aucun conducteur."
      });
    }
  }

  // Diagnostic 6 : Adaptation & Impédance d'entrée
  if(d.resultat && d.resultat.z0_re != null){
    const re = d.resultat.z0_re;
    if(re < 5.0){
      diags.push({
        id: "zin_court_circuit",
        titre: "Impédance d'entrée très faible (Rin = " + rapNb(re, 1) + " Ω) — Court-circuit suspecté",
        rang: "crit",
        desc: "La partie réelle de l'impédance est quasi nulle. Le port d'excitation semble court-circuité avec le plan de masse ou posé sur un via franc sans intervalle isolant.",
        conseil: "Vérifiez la position du port, les couches de départ/arrivée et l'isolation de la pastille d'excitation."
      });
    } else if(re > 350.0){
      diags.push({
        id: "zin_circuit_ouvert",
        titre: "Impédance d'entrée très élevée (Rin = " + rapNb(re, 1) + " Ω)",
        rang: "warn",
        desc: "Une impédance réelle supérieure à 350 Ω indique que l'antenne est alimentée sur un nœud de tension ou que la continuité électrique avec le brin rayonnant est rompue.",
        conseil: "Rapprochez le point d'alimentation du point à 50 Ω (ex: encastrement sur patch ou adaptation quart d'onde)."
      });
    }

    if(d.resultat.s11_min_db > -6.0){
      diags.push({
        id: "s11_mauvais",
        titre: "Désadaptation marquée (S11 minimal = " + rapNb(d.resultat.s11_min_db, 1) + " dB)",
        rang: "warn",
        desc: "La réflexion est très élevée sur toute la bande simulée : plus de 50 % de la puissance injectée est réfléchie vers le générateur.",
        conseil: "Vérifiez si la géométrie résonne dans la bande simulée ou ajustez les dimensions de l'antenne (longueur de brin/patch)."
      });
    }
  }

  // Diagnostic 7 : Bande passante tronquée
  if(d.resultat && d.resultat.bp && d.resultat.bp.existe && d.resultat.bp.bord){
    diags.push({
      id: "bp_tronquee",
      titre: "Bande passante à -10 dB tronquée sur les bords",
      rang: "warn",
      desc: "Le S11 reste sous -10 dB à l'une des extrémités de la bande simulée. La largeur de bande affichée est donc sous-évaluée.",
      conseil: "Élargissez la bande de fréquence (étape 4 'La bande') pour observer le retour complet du S11 au-dessus de -10 dB."
    });
  }

  // Diagnostic 8 : Écart à la fréquence cible
  if(d.resultat && d.resultat.ecart_cible_pct != null){
    const ec = d.resultat.ecart_cible_pct;
    if(Math.abs(ec) > 4.0){
      diags.push({
        id: "ecart_f0",
        titre: "Écart de résonance de " + (ec > 0 ? "+" : "") + rapNb(ec, 1) + " % vs Cible (" + rapFmtHz(d.solver.fcible) + ")",
        rang: "info",
        desc: "La résonance mesurée est à " + rapFmtHz(d.resultat.f0) + ". Les formules analytiques préliminaires (Hammerstad, Balanis) ignorent l'épaisseur finie du métal, les effets de troncature du substrat et la dispersion.",
        conseil: "Retouchez la longueur résonante proportionnellement à l'écart constaté (ex: allonger de " + rapNb(Math.abs(ec), 1) + " % pour abaisser f0) ou effectuez un balayage paramétrique."
      });
    }
  }

  // Avis du modèle openEMS
  if(d.avisModele && d.avisModele.length){
    d.avisModele.forEach(function(av){
      diags.push({
        id: "avis_" + av.titre,
        titre: av.titre,
        rang: (av.rang === "grave" || av.rang === "erreur") ? "crit" : (av.rang === "attention" ? "warn" : "info"),
        desc: av.texte,
        conseil: null
      });
    });
  }

  return diags;
}

/* =============================================================================
   3. Générateur HTML du Rapport d'Ingénierie
   ============================================================================= */
function rapGenererHtml(d, diags){
  const res = d.resultat;
  const bp = res ? res.bp : null;
  const nf = res ? res.nf2ff : null;

  // Statut global du diagnostic
  const hasCrit = diags.some(x => x.rang === "crit");
  const hasWarn = diags.some(x => x.rang === "warn");
  const statutCls = hasCrit ? "crit" : (hasWarn ? "warn" : (res ? "ok" : "info"));
  const statutTxt = hasCrit ? "Anomalies critiques" : (hasWarn ? "Points de vigilance" : (res ? "Simulation conforme" : "Modèle prêt"));

  let h = '';

  // 1. KPIs / Synthèse immédiate
  h += '<div class="rap-sec">';
  h += '  <div class="rap-kpis">';
  h += '    <div class="rap-kpi accent">';
  h += '      <span class="rap-kpi-lbl">Résonance f₀</span>';
  h += '      <span class="rap-kpi-val">' + (res ? rapFmtHz(res.f0) : "—") + '</span>';
  h += '      <span class="rap-kpi-detail">' + (res && res.ecart_cible_pct != null ? (res.ecart_cible_pct >= 0 ? "+" : "") + rapNb(res.ecart_cible_pct, 2) + " % vs cible" : "Cible : " + rapFmtHz(d.solver.fcible)) + '</span>';
  h += '    </div>';
  h += '    <div class="rap-kpi ' + (res && res.s11_min_db < -10 ? "ok" : (res ? "warn" : "")) + '">';
  h += '      <span class="rap-kpi-lbl">S₁₁ minimal</span>';
  h += '      <span class="rap-kpi-val">' + (res ? rapNb(res.s11_min_db, 2) + " dB" : "—") + '</span>';
  h += '      <span class="rap-kpi-detail">' + (res && bp && bp.existe ? "Bande : " + rapNb(bp.largeur / 1e6, 1) + " MHz (" + rapNb(bp.relative, 1) + " %)" : "Seuil : −10 dB") + '</span>';
  h += '    </div>';
  h += '    <div class="rap-kpi">';
  h += '      <span class="rap-kpi-lbl">Impédance Zᵢₙ(f₀)</span>';
  h += '      <span class="rap-kpi-val">' + (res && res.z0_re != null ? rapNb(res.z0_re, 1) + " " + (res.z0_im >= 0 ? "+" : "−") + rapNb(Math.abs(res.z0_im), 1) + "j Ω" : "—") + '</span>';
  h += '      <span class="rap-kpi-detail">' + (res && res.z0_pied_re != null ? "Pied : " + rapNb(res.z0_pied_re, 1) + (res.z0_pied_im >= 0 ? "+" : "−") + rapNb(Math.abs(res.z0_pied_im), 1) + "j Ω" : "Port : 50 Ω") + '</span>';
  h += '    </div>';
  h += '    <div class="rap-kpi ' + (nf && nf.rendement != null && nf.rendement >= 0.6 ? "ok" : (nf ? "warn" : "")) + '">';
  h += '      <span class="rap-kpi-lbl">Rendement / Gain</span>';
  h += '      <span class="rap-kpi-val">' + (nf && nf.gain_dbi != null ? rapNb(nf.gain_dbi, 2) + " dBi" : (nf && nf.dmax_dbi != null ? rapNb(nf.dmax_dbi, 2) + " dBi" : "—")) + '</span>';
  h += '      <span class="rap-kpi-detail">' + (nf && nf.rendement != null ? "Rendement : " + rapNb(nf.rendement * 100, 1) + " %" : (d.solver.nf2ff_actif ? "NF2FF actif" : "NF2FF inactif")) + '</span>';
  h += '    </div>';
  h += '  </div>';
  h += '</div>';

  // 2. Diagnostics & Analyse des Anomalies
  h += '<div class="rap-sec">';
  h += '  <div class="rap-sec-head">';
  h += '    <span class="rap-sec-titre">🛡️ Diagnostics & Vigilance Technique</span>';
  h += '    <span class="rap-sec-note">' + diags.length + ' point' + (diags.length > 1 ? 's' : '') + ' vérifié' + (diags.length > 1 ? 's' : '') + '</span>';
  h += '  </div>';
  h += '  <div class="rap-diags">';
  diags.forEach(function(dg){
    h += '    <div class="rap-diag-item ' + dg.rang + '">';
    h += '      <div class="rap-diag-head">';
    h += '        <span class="rap-badge-statut ' + dg.rang + '">' + dg.rang.toUpperCase() + '</span>';
    h += '        <span class="rap-diag-titre">' + rapEscHtml(dg.titre) + '</span>';
    h += '      </div>';
    h += '      <div class="rap-diag-desc">' + rapEscHtml(dg.desc) + '</div>';
    if(dg.conseil){
      h += '      <div class="rap-diag-conseil">💡 <b>Conseil ingénieur :</b> ' + rapEscHtml(dg.conseil) + '</div>';
    }
    h += '    </div>';
  });
  h += '  </div>';
  h += '</div>';

  // 3. Géométrie & Dimensions
  h += '<div class="rap-sec">';
  h += '  <div class="rap-sec-head">';
  h += '    <span class="rap-sec-titre">📐 Type d\'Antenne & Géométrie</span>';
  h += '    <span class="rap-sec-note">Dimensions en millimètres</span>';
  h += '  </div>';
  h += '  <div class="rap-grid-2col">';
  h += '    <div class="rap-table-wrap">';
  h += '      <table class="rap-table">';
  h += '        <tbody>';
  h += '          <tr><td>Type d\'antenne / Motif</td><td class="highlight">' + rapEscHtml(d.geometrie.type) + '</td></tr>';
  h += '          <tr><td>Dimensions carte / PCB</td><td class="mono">' + rapNb(d.geometrie.carte.L, 2) + ' × ' + rapNb(d.geometrie.carte.W, 2) + ' mm</td></tr>';
  if(d.geometrie.emprise){
    const ep = d.geometrie.emprise;
    h += '        <tr><td>Emprise 3D complète</td><td class="mono">X [' + rapNb(ep[0], 2) + ', ' + rapNb(ep[3], 2) + '] · Y [' + rapNb(ep[1], 2) + ', ' + rapNb(ep[4], 2) + '] · Z [' + rapNb(ep[2], 2) + ', ' + rapNb(ep[5], 2) + '] mm</td></tr>';
  }
  h += '          <tr><td>Éléments métalliques</td><td class="mono">' + d.geometrie.stats.pistes + ' pistes, ' + d.geometrie.stats.plans + ' plans, ' + d.geometrie.stats.pads + ' pastilles, ' + d.geometrie.stats.vias + ' vias</td></tr>';
  if(d.geometrie.stats.primitives > 0){
    h += '        <tr><td>Objets 3D externes</td><td class="mono">' + d.geometrie.stats.primitives + ' primitive(s) (fil, radôme, boîtier)</td></tr>';
  }
  h += '        </tbody>';
  h += '      </table>';
  h += '    </div>';

  // Table des cotes du gabarit (si applicable)
  if(d.geometrie.cotesGabarit.length){
    h += '    <div class="rap-table-wrap">';
    h += '      <table class="rap-table">';
    h += '        <thead><tr><th>Cote du gabarit</th><th class="num">Valeur</th><th>Unité</th></tr></thead>';
    h += '        <tbody>';
    d.geometrie.cotesGabarit.forEach(function(c){
      h += '          <tr><td>' + rapEscHtml(c.nom) + (c.modifie ? ' <span class="rap-badge-mini rap-badge-cuivre">ajusté</span>' : '') + '</td>';
      h += '          <td class="num highlight">' + rapNb(c.valeur, 3) + '</td><td>' + rapEscHtml(c.unite) + '</td></tr>';
    });
    h += '        </tbody>';
    h += '      </table>';
    h += '    </div>';
  } else {
    h += '    <div class="rap-table-wrap">';
    h += '      <table class="rap-table">';
    h += '        <tbody>';
    h += '          <tr><td>Source des formes</td><td>' + (d.projet.source === "ipc2581" ? "Import de fichier IPC-2581 (" + rapEscHtml(d.projet.fichier) + ")" : "Dessin direct sur couche") + '</td></tr>';
    h += '          <tr><td>Format d\'export</td><td>openEMS CSXCAD XML / Python</td></tr>';
    h += '        </tbody>';
    h += '      </table>';
    h += '    </div>';
  }
  h += '  </div>';
  h += '</div>';

  // 4. Empilage du Circuit Imprimé (Stackup)
  h += '<div class="rap-sec">';
  h += '  <div class="rap-sec-head">';
  h += '    <span class="rap-sec-titre">📚 Empilage PCB (Stack-up)</span>';
  h += '    <span class="rap-sec-note">Épaisseur totale : ' + rapNb(d.empilage.epaisseurTotale, 3) + ' mm · Cuivre : ' + rapEscHtml(d.empilage.modeleCuivre) + ' · Pertes : ' + rapEscHtml(d.empilage.pertes.mode) + '</span>';
  h += '  </div>';
  h += '  <div class="rap-table-wrap">';
  h += '    <table class="rap-table">';
  h += '      <thead>';
  h += '        <tr><th>#</th><th>Nom de couche</th><th>Nature</th><th class="num">Épaisseur</th><th class="num">εᵣ (Dk)</th><th class="num">tanδ (Df)</th><th class="num">Conductivité σ</th><th>Rôle</th></tr>';
  h += '      </thead>';
  h += '      <tbody>';
  if(d.empilage.couches.length){
    d.empilage.couches.forEach(function(c, i){
      const isCu = c.type === "cuivre";
      h += '        <tr>';
      h += '          <td class="mono">' + (i + 1) + '</td>';
      h += '          <td class="highlight">' + rapEscHtml(c.nom) + '</td>';
      h += '          <td><span class="rap-badge-mini ' + (isCu ? "rap-badge-cuivre" : "rap-badge-die") + '">' + (isCu ? "MÉTAL" : "DIÉLECTRIQUE") + '</span></td>';
      h += '          <td class="num">' + rapNb(c.ep, 4) + ' mm</td>';
      h += '          <td class="num">' + (!isCu ? rapNb(c.er, 3) : "—") + '</td>';
      h += '          <td class="num">' + (!isCu ? rapNb(c.df, 4) : "—") + '</td>';
      h += '          <td class="num">' + (isCu && c.sigma ? (c.sigma >= 1e7 ? rapNb(c.sigma / 1e7, 2) + "×10⁷ S/m" : c.sigma + " S/m") : "—") + '</td>';
      h += '          <td>' + rapEscHtml(c.role) + '</td>';
      h += '        </tr>';
    });
  } else {
    h += '        <tr><td colspan="8">Aucune couche déclarée dans l\'empilage.</td></tr>';
  }
  h += '      </tbody>';
  h += '    </table>';
  h += '  </div>';
  h += '</div>';

  // 5. Ports & Excitation
  h += '<div class="rap-sec">';
  h += '  <div class="rap-sec-head">';
  h += '    <span class="rap-sec-titre">⚡ Ports d\'Excitation & Désenchâssement</span>';
  h += '    <span class="rap-sec-note">' + d.ports.length + ' port' + (d.ports.length > 1 ? 's' : '') + ' configuré' + (d.ports.length > 1 ? 's' : '') + '</span>';
  h += '  </div>';
  h += '  <div class="rap-table-wrap">';
  h += '    <table class="rap-table">';
  h += '      <thead>';
  h += '        <tr><th>#</th><th>Nom</th><th>Statut</th><th>Type</th><th class="num">Position (X, Y)</th><th>Couches (De → À)</th><th>Désenchâssement (Feedline)</th></tr>';
  h += '      </thead>';
  h += '      <tbody>';
  if(d.ports.length){
    d.ports.forEach(function(p){
      h += '        <tr>';
      h += '          <td class="mono">' + p.n + '</td>';
      h += '          <td class="highlight">' + rapEscHtml(p.nom) + '</td>';
      h += '          <td><span class="rap-badge-mini ' + (p.excite ? "rap-badge-cuivre" : "rap-badge-die") + '">' + (p.excite ? "EXCITÉ" : "CHARGE 50 Ω") + '</span></td>';
      h += '          <td>' + (p.type === "coaxial" ? "Coaxial (ra=" + rapNb(p.ra, 3) + ", rb=" + rapNb(p.rb, 3) + " mm)" : "Localisé (" + rapNb(p.w, 2) + "×" + rapNb(p.l, 2) + " mm)") + '</td>';
      h += '          <td class="num mono">' + rapNb(p.x, 3) + ', ' + rapNb(p.y, 3) + ' mm</td>';
      h += '          <td>' + rapEscHtml(p.de) + ' → ' + rapEscHtml(p.a) + ' (' + p.dir + ')</td>';
      h += '          <td>' + (p.ligne && p.ligne.d > 0 ? "Ruban d=" + rapNb(p.ligne.d, 2) + " mm (w=" + rapNb(p.ligne.w, 2) + " mm)" : "Aucun") + '</td>';
      h += '        </tr>';
    });
  } else {
    h += '        <tr><td colspan="7">Aucun port posé.</td></tr>';
  }
  h += '      </tbody>';
  h += '    </table>';
  h += '  </div>';
  h += '</div>';

  // 6. Boîte de Simulation & Maillage FDTD
  h += '<div class="rap-sec">';
  h += '  <div class="rap-sec-head">';
  h += '    <span class="rap-sec-titre">🕸️ Boîte de Simulation & Maillage FDTD (Yee Grid)</span>';
  h += '    <span class="rap-sec-note">Critère CFL & Conditions PML</span>';
  h += '  </div>';
  h += '  <div class="rap-grid-2col">';
  h += '    <div class="rap-table-wrap">';
  h += '      <table class="rap-table">';
  h += '        <tbody>';
  h += '          <tr><td>Marges d\'air autour de la carte</td><td class="mono">X: ' + (d.boite.mx > 0 ? rapNb(d.boite.mx, 2) + " mm" : "auto") + ' · Y: ' + (d.boite.my > 0 ? rapNb(d.boite.my, 2) + " mm" : "auto") + ' · Z: +' + (d.boite.mz_haut > 0 ? rapNb(d.boite.mz_haut, 2) + " mm" : "auto") + ' / −' + (d.boite.mz_bas > 0 ? rapNb(d.boite.mz_bas, 2) + " mm" : "auto") + '</td></tr>';
  h += '          <tr><td>Couches absorbantes PML</td><td class="mono">' + d.boite.pml + ' cellules' + (d.boite.ep_pml_mm > 0 ? ' (' + rapNb(d.boite.ep_pml_mm, 2) + ' mm)' : '') + '</td></tr>';
  h += '          <tr><td>Air libre avant la PML</td><td class="mono">' + (d.boite.air_restant_mm > 0 ? rapNb(d.boite.air_restant_mm, 2) + ' mm (conseillé : ' + rapNb(d.boite.marge_conseil_mm, 2) + ' mm)' : 'Calculé par le solveur') + '</td></tr>';
  h += '          <tr><td>Règle du tiers de cellule métallique</td><td class="highlight">' + (d.maillage.tiers ? "Activée (lignes calées à 1/3 sur bords)" : "Désactivée") + '</td></tr>';
  h += '        </tbody>';
  h += '      </table>';
  h += '    </div>';
  h += '    <div class="rap-table-wrap">';
  h += '      <table class="rap-table">';
  h += '        <tbody>';
  h += '          <tr><td>Dimensions de la grille FDTD</td><td class="highlight mono">' + (d.maillage.lignes ? d.maillage.lignes.join(" × ") + " lignes" : "—") + '</td></tr>';
  h += '          <tr><td>Nombre total de cellules Yee</td><td class="highlight mono">' + (d.maillage.cellules ? Math.round(d.maillage.cellules).toLocaleString() : "—") + ' cellules (' + Math.round(d.maillage.memoire_Mo) + ' Mo RAM)</td></tr>';
  h += '          <tr><td>Pas spatial ciblé</td><td class="mono">Air : ' + rapNb(d.maillage.res_air_mm, 3) + ' mm · Substrat : ' + rapNb(d.maillage.res_die_mm, 3) + ' mm'
       + (d.maillage.res_fin_mm ? ' · Bandes fines : ' + rapNb(d.maillage.res_fin_mm, 3) + ' mm ('
          + (d.maillage.bandes_x + d.maillage.bandes_y) + ' bande(s), '
          + rapNb(d.maillage.cellules_piste, 1) + ' cellules en travers du cuivre le plus mal résolu)' : '')
       + '</td></tr>';
  h += '          <tr><td>Plus petite cellule / Pas CFL</td><td class="mono highlight">' + (d.maillage.min_cell_mm ? rapNb(Math.min.apply(null, d.maillage.min_cell_mm), 3) + " mm" : "—") + ' → Δt = ' + rapNb(d.maillage.dt_ps, 4) + ' ps</td></tr>';
  h += '        </tbody>';
  h += '      </table>';
  h += '    </div>';
  h += '  </div>';
  h += '</div>';

  // 7. Résultats Électromagnétiques Détaillés (si disponibles)
  if(res){
    h += '<div class="rap-sec">';
    h += '  <div class="rap-sec-head">';
    h += '    <span class="rap-sec-titre">📊 Résultats Électromagnétiques Détaillés</span>';
    h += '    <span class="rap-sec-note">S-paramètres & Rayonnement</span>';
    h += '  </div>';
    h += '  <div class="rap-grid-2col">';
    h += '    <div class="rap-table-wrap">';
    h += '      <table class="rap-table">';
    h += '        <tbody>';
    h += '          <tr><td>Fréquence de résonance f₀</td><td class="highlight mono">' + rapFmtHz(res.f0) + '</td></tr>';
    h += '          <tr><td>Coefficient de réflexion |S₁₁| min</td><td class="highlight mono">' + rapNb(res.s11_min_db, 2) + ' dB</td></tr>';
    h += '          <tr><td>Impédance au port Z₀</td><td class="mono">' + rapNb(res.z0_re, 2) + ' ' + (res.z0_im >= 0 ? "+" : "−") + rapNb(Math.abs(res.z0_im), 2) + 'j Ω</td></tr>';
    if(res.z0_pied_re != null){
      h += '        <tr><td>Impédance désenchâssée (pied)</td><td class="mono">' + rapNb(res.z0_pied_re, 2) + ' ' + (res.z0_pied_im >= 0 ? "+" : "−") + rapNb(Math.abs(res.z0_pied_im), 2) + 'j Ω</td></tr>';
    }
    h += '          <tr><td>Bande passante sous −10 dB</td><td class="mono">' + (bp && bp.existe ? rapFmtHz(bp.f1) + " → " + rapFmtHz(bp.f2) + " (" + rapNb(bp.largeur / 1e6, 1) + " MHz, " + rapNb(bp.relative, 2) + " %)" : "Aucune résonance sous −10 dB") + '</td></tr>';
    h += '        </tbody>';
    h += '      </table>';
    h += '    </div>';
    h += '    <div class="rap-table-wrap">';
    h += '      <table class="rap-table">';
    h += '        <tbody>';
    if(nf){
      h += '          <tr><td>Directivité maximale Dₘₐₓ</td><td class="mono highlight">' + (nf.dmax_dbi != null ? rapNb(nf.dmax_dbi, 2) + " dBi" : "Indéfinie") + '</td></tr>';
      h += '          <tr><td>Gain réalisé maximal G</td><td class="mono highlight">' + (nf.gain_dbi != null ? rapNb(nf.gain_dbi, 2) + " dBi" : "—") + '</td></tr>';
      h += '          <tr><td>Rendement de rayonnement η</td><td class="mono">' + (nf.rendement != null ? rapNb(nf.rendement * 100, 1) + " %" : "—") + '</td></tr>';
      h += '          <tr><td>Puissance rayonnée P_rad</td><td class="mono">' + (nf.prad != null ? rapNb(nf.prad, 4) + " W" : "—") + '</td></tr>';
    } else {
      h += '          <tr><td>Champ lointain (NF2FF)</td><td>Non calculé pour cette simulation.</td></tr>';
    }
    if(res.couplages){
      for(const k in res.couplages){
        h += '        <tr><td>Couplage Port ' + rapEscHtml(k) + ' (S' + rapEscHtml(k) + '1)</td><td class="mono">' + rapNb(res.couplages[k].db_f0, 2) + ' dB à f₀ (' + rapNb(res.couplages[k].pire_db, 2) + ' dB au pire)</td></tr>';
      }
    }
    h += '        </tbody>';
    h += '      </table>';
    h += '    </div>';
    h += '  </div>';
    h += '</div>';
  }

  // 8. Tâche Solveur & Journal
  if(d.tache){
    h += '<div class="rap-sec">';
    h += '  <div class="rap-sec-head">';
    h += '    <span class="rap-sec-titre">⚙️ Exécution openEMS & Métriques Système</span>';
    h += '    <span class="rap-sec-note">Durée réelle : ' + rapNb(d.tache.duree_s, 1) + ' s</span>';
    h += '  </div>';
    h += '  <div class="rap-table-wrap" style="margin-bottom:12px;">';
    h += '    <table class="rap-table">';
    h += '      <tbody>';
    h += '        <tr><td>Statut du solveur</td><td class="highlight">' + rapEscHtml(d.tache.etat) + '</td><td>Pas calculés</td><td class="mono">' + (d.tache.avancement.pas || "—") + ' / ' + d.solver.nmax + (d.solver.nmax_auto ? ' (calculé)' : '') + '</td></tr>';
    h += '        <tr><td>Énergie finale</td><td class="mono">' + (d.tache.avancement.energie_dB != null ? rapNb(d.tache.avancement.energie_dB, 1) + " dB" : "—") + '</td><td>Vitesse moyenne</td><td class="mono">' + (d.tache.avancement.vitesse ? rapNb(d.tache.avancement.vitesse, 1) + " MC/s" : "—") + '</td></tr>';
    h += '        <tr><td>Dossier de calcul</td><td colspan="3" class="mono" style="font-size:10.5px;">' + rapEscHtml(d.tache.dossier || "Mémoire") + '</td></tr>';
    h += '      </tbody>';
    h += '    </table>';
    h += '  </div>';
    if(d.tache.lignes && d.tache.lignes.length){
      h += '  <div class="rap-log-box">' + rapEscHtml(d.tache.lignes.slice(-25).join("\n")) + '</div>';
    }
    h += '</div>';
  }

  return h;
}

/* =============================================================================
   4. Générateur Markdown / Texte Brut
   ============================================================================= */
function rapGenererMarkdown(d, diags){
  const L = [];
  const res = d.resultat;
  const bp = res ? res.bp : null;
  const nf = res ? res.nf2ff : null;

  L.push("# Rapport Technique d'Ingénierie — Simulation Antenne openEMS (FDTD)");
  L.push("Généré le : " + d.date.toLocaleString() + " | Projet : " + d.projet.nom);
  L.push("");

  // 1. Synthèse
  L.push("## 1. Synthèse & Indicateurs Clés");
  if(res){
    L.push("- Fréquence de résonance f0 : " + rapFmtHz(res.f0) + (res.ecart_cible_pct != null ? " (" + (res.ecart_cible_pct >= 0 ? "+" : "") + rapNb(res.ecart_cible_pct, 2) + " % vs cible)" : ""));
    L.push("- S11 minimal : " + rapNb(res.s11_min_db, 2) + " dB");
    L.push("- Impédance d'entrée Zin(f0) : " + rapNb(res.z0_re, 1) + (res.z0_im >= 0 ? "+" : "−") + rapNb(Math.abs(res.z0_im), 1) + "j Ω");
    if(res.z0_pied_re != null){
      L.push("- Impédance au pied de l'antenne : " + rapNb(res.z0_pied_re, 1) + (res.z0_pied_im >= 0 ? "+" : "−") + rapNb(Math.abs(res.z0_pied_im), 1) + "j Ω");
    }
    L.push("- Bande passante (-10 dB) : " + (bp && bp.existe ? rapFmtHz(bp.f1) + " à " + rapFmtHz(bp.f2) + " (" + rapNb(bp.largeur / 1e6, 1) + " MHz, " + rapNb(bp.relative, 2) + " %)" : "Aucune résonance sous -10 dB"));
    if(nf){
      L.push("- Directivité maximale : " + (nf.dmax_dbi != null ? rapNb(nf.dmax_dbi, 2) + " dBi" : "Indéfinie"));
      if(nf.gain_dbi != null) L.push("- Gain réalisé : " + rapNb(nf.gain_dbi, 2) + " dBi");
      if(nf.rendement != null) L.push("- Rendement de rayonnement : " + rapNb(nf.rendement * 100, 1) + " %");
    }
  } else {
    L.push("- Simulation non exécutée.");
  }
  L.push("");

  // 2. Diagnostics
  L.push("## 2. Diagnostics & Analyse des Anomalies FDTD");
  diags.forEach(function(dg){
    L.push("### [" + dg.rang.toUpperCase() + "] " + dg.titre);
    L.push(dg.desc);
    if(dg.conseil){
      L.push("> Conseil : " + dg.conseil);
    }
    L.push("");
  });

  // 3. Géométrie
  L.push("## 3. Type d'Antenne & Géométrie");
  L.push("- Type d'antenne : " + d.geometrie.type);
  L.push("- Dimensions de la carte : " + rapNb(d.geometrie.carte.L, 2) + " × " + rapNb(d.geometrie.carte.W, 2) + " mm");
  if(d.geometrie.cotesGabarit.length){
    L.push("- Cotes du gabarit :");
    d.geometrie.cotesGabarit.forEach(function(c){
      L.push("  * " + c.nom + " : " + rapNb(c.valeur, 3) + " " + c.unite + (c.modifie ? " (modifié)" : ""));
    });
  }
  L.push("");

  // 4. Empilage
  L.push("## 4. Empilage PCB (Stack-up)");
  L.push("Épaisseur totale : " + rapNb(d.empilage.epaisseurTotale, 3) + " mm | Modèle cuivre : " + d.empilage.modeleCuivre + " | Pertes : " + d.empilage.pertes.mode);
  L.push("| Rang | Couche | Nature | Épaisseur (mm) | εr | tanδ | Conductivité (S/m) |");
  L.push("|---|---|---|---|---|---|---|");
  d.empilage.couches.forEach(function(c, i){
    L.push("| " + (i + 1) + " | " + c.nom + " | " + (c.type === "cuivre" ? "Cuivre" : "Diélectrique") + " | " + rapNb(c.ep, 4) + " | " + (c.type !== "cuivre" ? rapNb(c.er, 3) : "—") + " | " + (c.type !== "cuivre" ? rapNb(c.df, 4) : "—") + " | " + (c.type === "cuivre" ? (c.sigma || 5.8e7) : "—") + " |");
  });
  L.push("");

  // 5. Ports
  L.push("## 5. Ports & Excitation");
  d.ports.forEach(function(p){
    L.push("- Port " + p.n + " (" + p.nom + ") : " + (p.excite ? "EXCITÉ" : "CHARGE 50 Ω") + ", type " + p.type + ", position (" + rapNb(p.x, 3) + ", " + rapNb(p.y, 3) + " mm), de " + p.de + " à " + p.a);
  });
  L.push("");

  // 6. Boîte & Maillage
  L.push("## 6. Boîte de Simulation & Maillage FDTD");
  L.push("- Marges d'air : X=" + rapNb(d.boite.mx, 2) + ", Y=" + rapNb(d.boite.my, 2) + ", Z_haut=" + rapNb(d.boite.mz_haut, 2) + ", Z_bas=" + rapNb(d.boite.mz_bas, 2) + " mm");
  L.push("- PML : " + d.boite.pml + " cellules (" + rapNb(d.boite.ep_pml_mm, 2) + " mm)");
  if(d.maillage.lignes){
    L.push("- Grille Yee : " + d.maillage.lignes.join(" × ") + " lignes (" + Math.round(d.maillage.cellules) + " cellules, " + Math.round(d.maillage.memoire_Mo) + " Mo RAM)");
  }
  L.push("- Pas de discrétisation : Air = " + rapNb(d.maillage.res_air_mm, 3) + " mm, Diélectrique = " + rapNb(d.maillage.res_die_mm, 3) + " mm"
         + (d.maillage.res_fin_mm ? ", bandes fines = " + rapNb(d.maillage.res_fin_mm, 3) + " mm sur "
            + (d.maillage.bandes_x + d.maillage.bandes_y) + " bande(s)" : ""));
  L.push("- Pas de temps CFL : " + rapNb(d.maillage.dt_ps, 4) + " ps");
  L.push("");

  // 7. Solveur
  if(d.tache){
    L.push("## 7. Métriques Solveur");
    L.push("- Statut : " + d.tache.etat + " | Durée : " + rapNb(d.tache.duree_s, 1) + " s");
    L.push("- Pas exécutés : " + (d.tache.avancement.pas || "—") + " / " +
           d.solver.nmax + (d.solver.nmax_auto ? " (calculé)" : ""));
    L.push("- Énergie résiduelle finale : " + (d.tache.avancement.energie_dB != null ? rapNb(d.tache.avancement.energie_dB, 1) + " dB" : "—"));
    L.push("- Vitesse moyenne : " + (d.tache.avancement.vitesse ? rapNb(d.tache.avancement.vitesse, 1) + " MC/s" : "—"));
  }

  return L.join("\n");
}

/* =============================================================================
   5. Contrôleur de la Modale & Actions
   ============================================================================= */
let RAP_DONNEES_CACHE = null;
let RAP_DIAGS_CACHE = null;

function rapOuvrir(){
  let mod = document.getElementById("rapportModal");
  if(!mod){
    // Créer la structure si absente
    mod = document.createElement("div");
    mod.id = "rapportModal";
    mod.className = "rap-modal";
    mod.setAttribute("hidden", "");
    document.body.appendChild(mod);
  }

  const d = rapCollecterDonnees();
  const diags = rapDiagnostiquer(d);
  RAP_DONNEES_CACHE = d;
  RAP_DIAGS_CACHE = diags;

  const hasCrit = diags.some(x => x.rang === "crit");
  const hasWarn = diags.some(x => x.rang === "warn");
  const statutCls = hasCrit ? "crit" : (hasWarn ? "warn" : (d.resultat ? "ok" : "info"));
  const statutTxt = hasCrit ? "Anomalies détectées" : (hasWarn ? "Points de vigilance" : (d.resultat ? "Conforme" : "Modèle prêt"));

  mod.innerHTML =
    '<div class="rap-box" role="dialog" aria-modal="true">' +
      '<div class="rap-head">' +
        '<div class="rap-titres">' +
          '<div class="rap-titre-principal">' +
            '<span>📋 Rapport d\'Ingénierie & Diagnostic FDTD</span>' +
            '<span class="rap-badge-statut ' + statutCls + '">' + statutTxt + '</span>' +
          '</div>' +
          '<div class="rap-sous-titre">' + rapEscHtml(d.projet.nom) + ' · ' + d.date.toLocaleDateString() + ' ' + d.date.toLocaleTimeString() + ' · openEMS</div>' +
        '</div>' +
        '<div class="rap-actions">' +
          '<button class="rap-btn" id="bRapCopier" title="Copier le rapport complet (Markdown / Texte)">📋 Copier</button>' +
          '<button class="rap-btn" id="bRapPrint" title="Imprimer ou enregistrer au format PDF">🖨️ Imprimer / PDF</button>' +
          '<button class="rap-btn" id="bRapDl" title="Télécharger un fichier HTML autonome hors-ligne">⤓ Fichier .html</button>' +
          '<button class="rap-btn fermer" id="bRapFermer" title="Fermer (Échap)">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="rap-corps" id="rapportCorps">' +
        rapGenererHtml(d, diags) +
      '</div>' +
    '</div>';

  mod.removeAttribute("hidden");

  // Attacher les écouteurs d'actions
  const bCopier = mod.querySelector("#bRapCopier");
  if(bCopier) bCopier.onclick = rapCopier;

  const bPrint = mod.querySelector("#bRapPrint");
  if(bPrint) bPrint.onclick = rapImprimer;

  const bDl = mod.querySelector("#bRapDl");
  if(bDl) bDl.onclick = rapTelechargerHtml;

  const bFermer = mod.querySelector("#bRapFermer");
  if(bFermer) bFermer.onclick = rapFermer;

  // Clic sur l'arrière-plan pour fermer
  mod.onclick = function(e){
    if(e.target === mod) rapFermer();
  };
}

function rapFermer(){
  const mod = document.getElementById("rapportModal");
  if(mod) mod.setAttribute("hidden", "");
}

function rapToast(msg){
  const mod = document.getElementById("rapportModal");
  if(!mod) return;
  const t = document.createElement("div");
  t.className = "rap-toast";
  t.textContent = msg;
  mod.appendChild(t);
  setTimeout(function(){
    if(t.parentElement) t.parentElement.removeChild(t);
  }, 2200);
}

function rapCopier(){
  if(!RAP_DONNEES_CACHE) RAP_DONNEES_CACHE = rapCollecterDonnees();
  if(!RAP_DIAGS_CACHE) RAP_DIAGS_CACHE = rapDiagnostiquer(RAP_DONNEES_CACHE);
  const md = rapGenererMarkdown(RAP_DONNEES_CACHE, RAP_DIAGS_CACHE);
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(md).then(function(){
      rapToast("✓ Rapport Markdown copié dans le presse-papier !");
    }).catch(function(){
      rapFallbackCopier(md);
    });
  } else {
    rapFallbackCopier(md);
  }
}

function rapFallbackCopier(txt){
  const ta = document.createElement("textarea");
  ta.value = txt;
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand("copy");
    rapToast("✓ Rapport copié !");
  } catch(e) {
    alert("Impossible de copier automatiquement : veuillez sélectionner le texte.");
  }
  document.body.removeChild(ta);
}

function rapImprimer(){
  window.print();
}

function rapTelechargerHtml(){
  if(!RAP_DONNEES_CACHE) RAP_DONNEES_CACHE = rapCollecterDonnees();
  if(!RAP_DIAGS_CACHE) RAP_DIAGS_CACHE = rapDiagnostiquer(RAP_DONNEES_CACHE);

  const corpsHtml = rapGenererHtml(RAP_DONNEES_CACHE, RAP_DIAGS_CACHE);
  const d = RAP_DONNEES_CACHE;

  // Récupérer le CSS de rapport.css s'il est chargé
  let css = "";
  for(let i = 0; i < document.styleSheets.length; i++){
    const sheet = document.styleSheets[i];
    try {
      if(sheet.href && sheet.href.indexOf("rapport.css") >= 0){
        for(let j = 0; j < sheet.cssRules.length; j++){
          css += sheet.cssRules[j].cssText + "\n";
        }
      }
    }catch(e){}
  }

  const page = '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n' +
    '<title>Rapport FDTD — ' + rapEscHtml(d.projet.nom) + '</title>\n' +
    '<style>\n' +
    ':root{--bg:#0f1012;--panel:#17181b;--panel2:#1c1e22;--border:#2b2e34;--border2:#3a3e46;--txt:#e6e8ec;--txt-dim:#8b919c;--yellow:#f2c744;--blue:#3fa0ea;--blue-deep:#2b7fbf;--red:#e8443a;--green:#4cc38a;--mono:"JetBrains Mono",Consolas,monospace;--ui:system-ui,-apple-system,sans-serif;}\n' +
    'body{background:var(--bg);color:var(--txt);font-family:var(--ui);margin:0;padding:24px;line-height:1.5;}\n' +
    '.rap-box{max-width:1060px;margin:0 auto;background:var(--panel);border:1px solid var(--border2);border-radius:8px;padding:20px;}\n' +
    css +
    '</style>\n</head>\n<body>\n' +
    '<div class="rap-box">\n' +
    '  <header class="rap-head" style="margin-bottom:20px;">\n' +
    '    <div class="rap-titres">\n' +
    '      <div class="rap-titre-principal">📋 Rapport d\'Ingénierie & Diagnostic FDTD</div>\n' +
    '      <div class="rap-sous-titre">' + rapEscHtml(d.projet.nom) + ' · ' + d.date.toLocaleDateString() + ' ' + d.date.toLocaleTimeString() + ' · openEMS</div>\n' +
    '    </div>\n' +
    '  </header>\n' +
    '  <div class="rap-corps">\n' +
    corpsHtml +
    '  </div>\n' +
    '</div>\n</body>\n</html>';

  const blob = new Blob([page], { type: "text/html;charset=utf-8" });
  const a = document.createElement("a");
  const safeName = (d.projet.nom || "antenne").replace(/[^a-zA-Z0-9_-]/g, "_");
  a.download = "rapport_" + safeName + "_" + Date.now() + ".html";
  a.href = URL.createObjectURL(blob);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Touche Échap pour fermer la modale
window.addEventListener("keydown", function(e){
  if(e.key === "Escape"){
    const mod = document.getElementById("rapportModal");
    if(mod && !mod.hasAttribute("hidden")){
      rapFermer();
    }
  }
});

// Branchement au chargement du DOM
window.addEventListener("DOMContentLoaded", function(){
  const bRap = document.getElementById("bRapport");
  if(bRap){
    bRap.onclick = function(){
      rapOuvrir();
    };
  }
});
