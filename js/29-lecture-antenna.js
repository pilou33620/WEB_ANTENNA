"use strict";
/* =============================================================================
   Antenne openEMS — 29-lecture-antenna.js
   Les lectures de la page : le contexte et les outils de lecture de
   l'assistant (30-ia.js), sortis tels quels pour que le canal de pilotage de
   web_suite s'en serve aussi (module registre-antenna). Leur texte ne change
   pas : le banc le compare à un relevé pris avant le déplacement. Script
   classique, chargé avant 30-ia.js, qui reprend tout depuis LECTURE_ANTENNA.
   Spec : web_suite/lanceur/docs/SPEC-mcp-registre-antenna.md.
   ========================================================================== */

const LECTURE_ANTENNA = (function(){
  /* ==========================================================================
     Écrire les nombres
     --------------------------------------------------------------------------
     Deux formats, et ils ne servent pas au même public. `nb` écrit POUR
     L'ÉCRAN — virgule décimale. Le contexte envoyé au modèle, lui, garde le
     point : un nombre à virgule dans un texte technique se relit comme un
     séparateur de liste, et « 2,45 » y devient deux nombres.
     ========================================================================== */
  function nb(v, dec){
    if(v == null || !isFinite(v)) return "—";
    let s = (+v).toFixed(dec == null ? 3 : dec);
    if(s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s.replace(".", ",");
  }
  function nbp(v, dec){
    if(v == null || !isFinite(v)) return "?";
    let s = (+v).toFixed(dec == null ? 3 : dec);
    if(s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }
  /* Une fréquence dans l'unité qui la rend lisible, et non dans celle choisie
     pour la saisie : un contexte qui annoncerait « 0,0245 » parce que
     l'utilisateur tape en centaines de gigahertz ne se relit pas. */
  function fHz(hz){
    if(!isFinite(hz) || hz <= 0) return "?";
    if(hz >= 1e9) return nbp(hz / 1e9, 4) + " GHz";
    if(hz >= 1e6) return nbp(hz / 1e6, 3) + " MHz";
    if(hz >= 1e3) return nbp(hz / 1e3, 3) + " kHz";
    return nbp(hz, 0) + " Hz";
  }
  function uniteDoc(){
    return (typeof antUnite === "function") ? antUnite() : "mm";
  }

  /* ==========================================================================
     LE CONTEXTE
     --------------------------------------------------------------------------
     Ce qui part avec la question, et rien de plus. C'est un RÉSUMÉ, pas un
     dump : les polygones de cuivre pèsent des mégaoctets, ne se lisent pas, et
     n'apprendraient rien à un modèle de langage. Ce qui compte, ce sont les
     décisions — la bande, l'empilage, le port, la boîte, le maillage, l'arrêt —
     et les chiffres que le serveur en a tirés.
     ========================================================================== */
  function extraireContexteOpenems(){
    const L = [];
    const u = uniteDoc();
    const con = (typeof CON !== "undefined" && CON.actif);

    L.push("=== PROJET ===");
    L.push((typeof PRJ !== "undefined" && PRJ.nom)
      ? ("Projet ouvert : « " + PRJ.nom + " ».")
      : "Aucun projet ouvert : le travail n'est pas encore enregistre.");
    L.push("");

    L.push("=== D'OU VIENT CETTE CARTE ===");
    if(con){
      L.push("Mode conception : la carte est DESSINEE dans l'outil.");
      L.push("Carte " + nbp(CON.carte.L, 2) + " x " + nbp(CON.carte.W, 2) +
             " mm, " + CON.elements.length + " formes dessinees.");
      L.push("Frequence visee par les gabarits : " + fHz(CON.fcible));
      const s = (typeof conSubstrat === "function") ? conSubstrat() : null;
      if(s) L.push("Substrat retenu par les gabarits : er = " + nbp(s.er, 3) +
                   ", h = " + nbp(s.h, 3) + " mm, tand = " + nbp(s.df, 4) + ".");

      /* LES REPERES DU DESSIN, PARCE QU'UNE CARTE « formes » DESIGNE UNE
         COUCHE ET DES COORDONNEES. Sans cette liste, le modele inventerait un
         nom de couche, et la page le refuserait — ce qui ressemble beaucoup a
         un modele qui se trompe, et n'en est pas un. C'est la meme raison qui
         fait envoyer les identifiants des cotes balayables. */
      L.push("Repere du dessin : origine au coin, x de 0 a " +
             nbp(CON.carte.L, 3) + ", y de 0 a " + nbp(CON.carte.W, 3) +
             ", tout en millimetres.");
      try{
        const cuivres = conCuivres();
        L.push("Couches de cuivre ou poser des formes (« haut » = la "+
               "premiere, « bas » = la seconde) :");
        cuivres.forEach(function(c, i){
          L.push("- " + (i === 0 ? "haut" : (i === 1 ? "bas" : "rang " + i)) +
                 " : « " + c.e.nom + " », role " + (c.e.role || "signal"));
        });
        if(typeof conNets === "function")
          L.push("Nets deja presents : " + conNets().join(", ") +
                 " (un net nomme GND est reconnu comme la masse).");
      }catch(e){}
      L.push("Port : " + (ANT.port.pose ? "pose" : "NON POSE") +
             " ; sans port, rien ne se simule.");
    }else if(typeof V !== "undefined" && V.modele){
      L.push("Fichier IPC-2581 importe : " + (V.fichier || "sans nom") +
             ", unite du document : " + u + ".");
      if(V.bbox) L.push("Encombrement : " + nbp(V.bbox.x2 - V.bbox.x1, 3) + " x " +
                        nbp(V.bbox.y2 - V.bbox.y1, 3) + " " + u +
                        (V.modele.epaisseur ? (", epaisseur " + nbp(V.modele.epaisseur, 3) + " " + u) : "") + ".");
      L.push("Composants : " + (V.modele.composants || []).length + ", nets : " +
             (V.parNet || []).filter(n => n.nom).length + " (detail : outils « composants », « nets »).");
    }else{
      L.push("Rien n'est ouvert : ni fichier, ni dessin. Aucun reglage n'a de "+
             "sens tant que ce n'est pas le cas.");
      return L.join("\n");
    }

    /* -- l'empilage ----------------------------------------------------- */
    try{
      const pile = antEmpilage();
      if(pile.length){
        L.push("");
        L.push("=== EMPILAGE (du dessus vers le dessous, unite " + u + ") ===");
        pile.forEach(function(e){
          L.push("- " + e.nom + " : " + (e.cuivre
            ? ("cuivre, ep = " + nbp(e.ep, 4) + " " + u + ", role " +
               (e.role || "signal") +
               (e.sigma ? (", sigma = " + e.sigma + " S/m") : ""))
            : ("dielectrique, ep = " + nbp(e.ep, 4) + " " + u +
               ", er = " + nbp(e.er, 3) + ", tand = " + nbp(e.df, 4))));
        });
      }
    }catch(e){}

    /* -- le cuivre retenu ------------------------------------------------ */
    try{
      const cu = antCuivreDuModele();
      L.push("");
      L.push("=== CUIVRE RETENU POUR LE SOLVEUR ===");
      L.push("Nets designes : " + ANT.nets.size +
             ", formes designees une a une : " + ANT.formes.length +
             ", net de masse : " + (ANT.netMasse >= 0
               ? ((V.parNet[ANT.netMasse] || {}).nom || ANT.netMasse)
               : "aucun") + ".");
      L.push("Ce qui en sort : " + cu.compte.pistes + " pistes, " +
             cu.compte.plans + " versements, " + cu.compte.pads +
             " pastilles, " + cu.vias.length + " vias.");
    }catch(e){}

    /* -- la bande, les ports --------------------------------------------- */
    L.push("");
    L.push("=== BANDE ===");
    L.push("Simulee de " + fHz(ANT.bande.f1) + " a " + fHz(ANT.bande.f2) +
           " en " + ANT.bande.n + " points ; frequence visee " +
           fHz(ANT.bande.fcible) + ".");
    L.push("Unite de saisie des frequences a l'ecran : " + ANT.uniteF + ".");

    L.push("");
    L.push("=== PORTS (" + ANT.ports.length + ") ===");
    ANT.ports.forEach(function(p, i){
      const bits = ["port " + (i + 1) + (p.excite ? " (EXCITE)" : " (en charge)"),
                    p.type,
                    (p.pose ? ("pose en x = " + nbp(p.x, 4) + ", y = " +
                               nbp(p.y, 4) + " " + u) : "NON POSE"),
                    "de « " + (p.de || "?") + " » a « " + (p.a || "?") + " »",
                    "direction " + p.dir,
                    "R = " + nbp(p.R, 1) + " ohm"];
      if(p.type === "coaxial")
        bits.push("ame " + nbp(p.ra, 3) + " / gaine " + nbp(p.rb, 3) + " " + u +
                  ", er = " + nbp(p.er, 3) + ", Z0 = " +
                  nbp(antCoaxZ0(p), 1) + " ohm");
      else
        bits.push("empreinte " + nbp(p.w, 4) + " x " + nbp(p.l, 4) + " " + u);
      if(p.ligne_d > 0 && p.ligne_w > 0)
        bits.push("desembedage : ligne de " + nbp(p.ligne_d, 3) + " " + u +
                  " de long, " + nbp(p.ligne_w, 3) + " " + u + " de large");
      L.push("- " + bits.join(" ; ") + ".");
    });

    /* -- la boite, le maillage, l'arret ---------------------------------- */
    L.push("");
    L.push("=== BOITE, MAILLAGE, ARRET ===");
    /* LA VALEUR EFFECTIVE, ET SEULEMENT ENSUITE D'OU ELLE VIENT. « 0 (au
       mailleur de decider) » decrivait au modele une simulation sans marge
       et sans maille : il repondait a cote, et conseillait de « remplir les
       champs » qui etaient deja bons. On lui donne le nombre qui part au
       solveur, en disant s'il a ete saisi ou calcule. */
    const z = function(v, calc){
      if (v > 0) return nbp(v, 3) + " " + u;
      return (calc > 0) ? nbp(calc, 3) + " " + u + " (calcule)"
                        : "0 (au mailleur de decider)";
    };
    const mdl = ANT.modele;
    const cmarge = mdl ? mdl.boite.marge_conseil : 0;
    const cres = (mdl && mdl.resolution.detail) || {};
    L.push("Marges d'air : X " + z(ANT.boite.mx, cmarge) + ", Y " +
           z(ANT.boite.my, cmarge) + ", au-dessus " +
           z(ANT.boite.mz_haut, cmarge) + ", en dessous " +
           z(ANT.boite.mz_bas, cmarge) + " ; PML " + ANT.boite.pml +
           " cellules.");
    L.push("Pas de maillage : air " + z(ANT.maillage.res_air, cres.air) +
           ", dielectrique " + z(ANT.maillage.res_die, cres.die) +
           (cres.bornee ? " (borne par le plafond de lignes : le cuivre le "
                        + "plus etroit en demanderait moins)" : "") +
           " ; regle du tiers " +
           (ANT.maillage.tiers ? "active" : "desactivee") + ".");
    /* Le garde-fou EFFECTIF, pas celui du document : zero veut dire « calcule-
       le », et annoncer « garde-fou 0 pas » au modele serait lui decrire une
       simulation qui s'arrete avant de commencer. */
    const nmaxEff = (ANT.modele && ANT.modele.arret && ANT.modele.arret.nmax)
                    || ANT.arret.nmax;
    L.push("Arret : energie residuelle " + nbp(ANT.arret.energie, 1) +
           " dB, garde-fou " + nmaxEff + " pas de temps" +
           ((ANT.modele && ANT.modele.arret && ANT.modele.arret.nmax_auto)
              ? " (calcule)" : "") + ".");
    L.push("Cuivre modelise en « " + ANT.modeleCuivre + " » ; pertes du " +
           "dielectrique en « " + ANT.pertes.mode + " »" +
           (ANT.pertes.f_kappa > 0 ? (" a " + fHz(ANT.pertes.f_kappa))
                                   : " (au centre de la bande)") + ".");
    L.push("Champ lointain : " + (ANT.nf2ff.actif ? "demande" : "non demande") + ".");

    /* -- ce que le serveur a chiffre ------------------------------------- */
    if(ANT.refus){
      L.push("");
      L.push("=== LE SERVEUR REFUSE CE MODELE ===");
      L.push(ANT.refus.message +
             (ANT.refus.conseil ? (" — " + ANT.refus.conseil) : ""));
    }else if(ANT.modele){
      const m = ANT.modele, e = m.estimation;
      L.push("");
      L.push("=== CE QUE LE SERVEUR A CHIFFRE ===");
      L.push("Maillage : " + e.lignes.join(" x ") + " lignes, " +
             Math.round(e.cellules) + " cellules, " +
             Math.round(e.memoire_Mo) + " Mo, pas de temps " +
             nbp(e.dt_s * 1e12, 4) + " ps.");
      if(e.plus_petite_cellule_mm)
        L.push("Plus petite cellule : " +
               nbp(Math.min.apply(null, e.plus_petite_cellule_mm), 5) + " mm.");
      if(m.resolution)
        L.push("Pas vise : " + nbp(m.resolution.air, 4) + " mm dans l'air, " +
               nbp(m.resolution.die, 4) + " mm dans le dielectrique " +
               "(er max " + nbp(m.resolution.er_max, 3) + ").");
      if(m.boite)
        L.push("Boite : air restant devant la PML " +
               nbp(m.boite.air_restant, 2) + " mm, marge conseillee " +
               nbp(m.boite.marge_conseil, 2) + " mm, PML " +
               nbp(m.boite.ep_pml, 2) + " mm.");
      if(m.avis && m.avis.length){
        L.push("Avis rendus par le serveur :");
        m.avis.forEach(function(a){
          L.push("- [" + a.rang + "] " + a.titre + " : " + a.texte);
        });
      }
    }

    /* -- le motif de conception ------------------------------------------ */
    if(con && CON.gabarit){
      const g = conGabarit(CON.gabarit);
      if(g){
        L.push("");
        L.push("=== MOTIF OUVERT : " + g.nom.toUpperCase() +
               " (identifiant « " + g.id + " ») ===");
        const d = conGabaritDefauts(g, conContexte());
        g.champs.forEach(function(ch){
          const pose = CON.gabaritP[ch.id];
          const repris = CON.gabaritTouche[ch.id] ? " [REPRIS A LA MAIN]" : "";
          L.push("- " + ch.id + " (" + ch.nom + ") : pose " + nbp(pose, 4) +
                 " mm, calcul du gabarit " + nbp(d[ch.id], 4) + " mm" +
                 repris + ".");
        });
      }
    }

    /* -- ce qui se balaye ------------------------------------------------- */
    /* LES IDENTIFIANTS, ET PAS SEULEMENT LES NOMS. Une proposition de balayage
       designe sa cote par un identifiant exact ; sans cette liste, le modele
       l'inventerait — et la page la refuserait, ce qui ressemble a un modele
       qui se trompe alors qu'on ne lui a rien dit. */
    if(typeof balSources === "function"){
      const src = balSources();
      if(src.length){
        L.push("");
        L.push("=== COTES BALAYABLES (identifiant = valeur actuelle) ===");
        src.forEach(function(s){
          L.push("- " + s.id + " = " + nbp(s.valeur, 4) +
                 (s.unite ? (" " + s.unite) : "") + "  (« " + s.nom + " »)");
        });
      }
    }

    if(ANT.balayage && ANT.balayage.actif){
      L.push("");
      L.push("=== BALAYAGE ARME ===");
      L.push("Cote « " + (ANT.balayage.nom || ANT.balayage.source) + " » de " +
             nbp(ANT.balayage.min, 4) + " a " + nbp(ANT.balayage.max, 4) +
             " par " + nbp(ANT.balayage.pas, 4) + ".");
    }

    /* -- un balayage termine : son tableau se demande ------------------------ */
    const rb = balayageTermine();
    if(rb){
      L.push("");
      L.push("=== BALAYAGE TERMINE : " + rb.points.length + " POINTS ===");
      L.push("Cote « " + (rb.nom || "cote") + " »" + (rb.croise ? (" croisee avec « " +
             (rb.nom2 || "cote 2") + " »") : "") + " ; le tableau des points (f0, S11, "+
             "impedance, rendement) : outil « balayage ».");
    }

    /* -- le dernier resultat ---------------------------------------------- */
    const r = resultatCourant();
    if(r){
      L.push("");
      L.push("=== DERNIER RESULTAT MESURE ===");
      L.push("Resonance (minimum de S11) a " + fHz(r.f0) + ", S11 min = " +
             nbp(r.s11_min_db, 2) + " dB.");
      L.push("Impedance d'entree a cette frequence : " + nbp(r.z0_re, 1) + " " +
             (r.z0_im >= 0 ? "+" : "-") + " " + nbp(Math.abs(r.z0_im), 1) +
             "j ohm.");
      if(r.bp_f1 && r.bp_f2)
        L.push("Bande a -10 dB : " + fHz(r.bp_f1) + " a " + fHz(r.bp_f2) +
               (r.bp_bord ? " — ELLE TOUCHE LE BORD DE LA BANDE SIMULEE, elle "+
                            "est donc tronquee." : "") +
               (r.bp_continue === false ? " (plusieurs morceaux)" : ""));
      else
        L.push("Aucun point sous -10 dB dans la bande simulee.");
      if(r.z0_pied_re != null)
        L.push("Impedance ramenee au pied de l'antenne : " +
               nbp(r.z0_pied_re, 1) + " " + (r.z0_pied_im >= 0 ? "+" : "-") +
               " " + nbp(Math.abs(r.z0_pied_im), 1) + "j ohm.");
      if(r.nf2ff && r.nf2ff.dmax_dbi != null)
        L.push("Directivite maximale : " + nbp(r.nf2ff.dmax_dbi, 2) + " dBi.");
      if(r.couplages)
        for(const k in r.couplages)
          L.push("Couplage vers le port " + k + " : " +
                 nbp(r.couplages[k].db_f0, 2) + " dB a la resonance.");
      if(ANT.bande.fcible > 0){
        const ec = 100 * (r.f0 - ANT.bande.fcible) / ANT.bande.fcible;
        L.push("Ecart a la frequence visee : " + (ec >= 0 ? "+" : "") +
               nbp(ec, 2) + " %.");
      }
    }else{
      L.push("");
      L.push("=== AUCUN RESULTAT ===");
      L.push("La simulation n'a pas encore tourne, ou son resultat a ete "+
             "efface par une modification.");
    }

    return L.join("\n");
  }

  // ponytail: filtre = sous-chaine sans casse, pas de regex ; suffit pour « USB », « U1 », « 0402 »
  function contient(filtre){
    if(!filtre) return true;
    const f = String(filtre).toLowerCase();
    return Array.prototype.slice.call(arguments, 1).some(function(c){
      return String(c == null ? "" : c).toLowerCase().indexOf(f) >= 0;
    });
  }
  function borner(lignes, max, quoi){
    return lignes.length <= max ? lignes
      : lignes.slice(0, max).concat("... (" + (lignes.length - max) + " " + quoi +
                                    " de plus : precise le filtre)");
  }

  function balayageTermine(){
    const rb = (typeof ANT !== "undefined") ? ANT.resultat : null;
    return (rb && rb.balayage && Array.isArray(rb.points) && rb.points.length) ? rb : null;
  }

  /* Un modele qui doit comparer neuf points d'un croisement les lit mieux en
     colonnes qu'en prose : une ligne par point, les memes colonnes que le
     tableau de la page, plus le S11 A la frequence visee. */
  function tableauBalayage(rb){
    const fc = (ANT.bande && ANT.bande.fcible > 0) ? ANT.bande.fcible : 0;
    const lignes = Array.isArray(rb.lignes) ? rb.lignes : [];
    const L = [[(rb.nom || "cote") + (rb.unite ? " (" + rb.unite + ")" : "")]
               .concat(rb.croise ? [(rb.nom2 || "cote 2") +
                                    (rb.unite2 ? " (" + rb.unite2 + ")" : "")] : [])
               .concat(["f0 (GHz)", "S11 min (dB)"],
                       fc ? ["S11 a " + fHz(fc) + " (dB)"] : [],
                       ["Re Z (ohm)", "Im Z (ohm)", "rendement (%)"]).join(";")];
    rb.points.forEach(function(p, k){
      const q = p.resultat || {}, l = lignes[k] || {};
      const c = v => (v == null || !isFinite(v)) ? "" : nbp(v, 3);
      const n = q.nf2ff || {};
      L.push([c(p.valeur)].concat(rb.croise ? [c(p.valeur2)] : [],
             [c(q.f0 != null ? q.f0 / 1e9 : l.f0 / 1e9),
              c(q.s11_min_db != null ? q.s11_min_db : l.s11_min_db)],
             fc ? [c(s11ALaCible(q, fc))] : [],
             [c(q.z0_re != null ? q.z0_re : l.z0_re),
              c(q.z0_im != null ? q.z0_im : l.z0_im),
              c(n.rendement != null ? 100 * n.rendement :
                (l.rendement != null ? 100 * l.rendement : NaN))]).join(";"));
    });
    return L;
  }

  /* La carte importee : memes outils que la visionneuse de WEB_CAO, meme `V`,
     meme modele (python/ipc2581_json.py). */
  const nomNet = i => (V.parNet[i] || {}).nom || "sans net";
  const nomCouche = i => (V.couches[i] || {}).nom || "?";

  const OUTILS_CARTE = {
    composants: {
      args: '"filtre":"U"',
      desc: "liste des composants de la carte importee (repere, valeur, boitier, reference, couche) ; filtre facultatif",
      fn: function(a){
        const L = (V.modele.composants || []).filter(c => contient(a.filtre, c.ref, c.val, c.pkg, c.part)).map(c =>
          "- " + c.ref + (c.val ? (" = " + c.val) : "") + (c.pkg ? (" (" + c.pkg + ")") : "") +
          (c.part ? (", " + c.part) : "") + ", " + nomCouche(c.c));
        return L.length ? borner(L, 150, "composants") : ["Aucun composant ne correspond."];
      }
    },
    composant: {
      args: '"ref":"U1"',
      desc: "un composant : valeur, boitier, position, et le net de chaque broche",
      fn: function(a){
        const c = (V.modele.composants || []).find(x => String(x.ref).toLowerCase() === String(a.ref || "").toLowerCase());
        if(!c) return ["Composant « " + a.ref + " » introuvable : demande la liste avec l'outil « composants »."];
        const b = c.pins || [];
        return [c.ref + (c.val ? (" = " + c.val) : "") + (c.pkg ? (" (" + c.pkg + ")") : "") +
                (c.part ? (", " + c.part) : "") + ", couche " + nomCouche(c.c) + ", x " + c.x +
                " y " + c.y + ", rotation " + c.r + " deg.", "Broches (" + b.length + ") :"]
          .concat(borner(b.map(p => "- " + p.num + " -> " + (p.n != null ? nomNet(p.n) : "non connectee")), 200, "broches"));
      }
    },
    nets: {
      args: '"filtre":"ANT"',
      desc: "liste des nets de la carte importee (classe, longueur de piste, couches) ; filtre facultatif",
      fn: function(a){
        const u = V.unite || "mm";
        const L = V.parNet.filter(n => n.nom && contient(a.filtre, n.nom)).map(n =>
          "- " + n.nom + " [" + n.classe + "] : " +
          (n.longueur > 0 ? (nbp(n.longueur, 3) + " " + u + " de pistes") : "sans piste") +
          ", " + n.couches.size + " couche(s)" + (ANT.nets.has(n.i) ? " — DESIGNE pour le solveur" : ""));
        return L.length ? borner(L, 150, "nets") : ["Aucun net ne correspond."];
      }
    },
    net: {
      args: '"nom":"ANT"',
      desc: "un net : classe, longueur, couches, nombre de pistes, plans, pastilles et percages, broches reliees",
      fn: function(a){
        const nom = String(a.nom || "").toLowerCase();
        const n = V.parNet.find(x => String(x.nom).toLowerCase() === nom);
        if(!n) return ["Net « " + a.nom + " » introuvable : demande la liste avec l'outil « nets »."];
        const broches = [];
        (V.modele.composants || []).forEach(function(c){
          (c.pins || []).forEach(function(p){ if(p.n === n.i) broches.push(c.ref + "." + p.num); });
        });
        return ["Net " + n.nom + ", classe " + n.classe + (ANT.nets.has(n.i) ? ", designe pour le solveur" : "") + ".",
                "Longueur de piste : " + nbp(n.longueur, 3) + " " + (V.unite || "mm") + ", sur " +
                Array.from(n.couches).map(nomCouche).join(", ") + ".",
                "Objets : " + n.pistes.length + " pistes, " + n.arcs.length + " arcs, " + n.plans.length +
                " plans, " + n.pads.length + " pastilles, " + n.trous.length + " percages.",
                "Broches (" + broches.length + ") : " + broches.slice(0, 200).join(", ") + (broches.length > 200 ? " ..." : "")];
      }
    }
  };

  const OUTIL_BALAYAGE = {
    balayage: {
      desc: "le tableau du balayage termine, une ligne par point (separateur ;) : cote(s), f0, S11 min, S11 a la cible, impedance, rendement",
      fn: function(){
        const rb = balayageTermine();
        return rb ? tableauBalayage(rb) : ["Aucun balayage termine."];
      }
    }
  };

  function resultatCourant(){
    if(typeof antRes === "function"){
      try{ return antRes(); }catch(e){}
    }
    return (typeof ANT !== "undefined") ? ANT.resultat : null;
  }

  /* Le S11 d'un résultat À la fréquence `fc`, lu sur sa courbe ; NaN sans
     courbe, sans cible, ou cible hors de la bande simulée. */
  function s11ALaCible(r, fc){
    const F = r && r.f, S = r && r.s11_db;
    if(!(fc > 0) || !Array.isArray(F) || !Array.isArray(S) || F.length < 2 ||
       fc < F[0] || fc > F[F.length - 1]) return NaN;
    let k = 1;
    while(k < F.length - 1 && F[k] < fc) k++;
    return S[k - 1] + (S[k] - S[k - 1]) * (fc - F[k - 1]) / (F[k] - F[k - 1]);
  }

  /* ==========================================================================
     LES LECTURES DU CANAL DE PILOTAGE (web_suite, antenna_lire)
     --------------------------------------------------------------------------
     En plus du contexte et des outils ci-dessus : le résultat regardé, ses
     courbes, l'audit hors ligne et les réglages de la liste blanche. Rien n'est
     écrit, rien n'est lancé. L'audit et la liste blanche vivent encore dans
     30-ia.js : ils sont lus au moment de l'appel (window.iaControles, IA_CHAMPS).
     Un refus est une Error, que le canal rend en clair.
     ========================================================================== */
  const PAS_DE_RESULTAT = "Pas de résultat dans la page : lance un calcul depuis la page (jamais depuis Claude).";

  function resultatsLignes(){
    const r = resultatCourant();
    if(!r || !Array.isArray(r.f)) throw new Error(PAS_DE_RESULTAT);
    const fc = (typeof ANT !== "undefined" && ANT.bande) ? ANT.bande.fcible : NaN;
    const L = ["Résonance f0 : " + fHz(r.f0) +
               (fc > 0 && isFinite(r.f0) ? " (cible " + fHz(fc) + ", écart " + nbp((r.f0 - fc) / fc * 100, 2) + " %)" : ""),
               "S11 minimal : " + nbp(r.s11_min_db, 2) + " dB" + (fc > 0 ? " ; à la cible : " + nbp(s11ALaCible(r, fc), 2) + " dB" : "")];
    if(isFinite(r.z0_re))
      L.push("Impédance à f0 : " + nbp(r.z0_re, 1) + (r.z0_im < 0 ? " - j" : " + j") + nbp(Math.abs(r.z0_im), 1) + " ohms");
    if(isFinite(r.bp_f1) && isFinite(r.bp_f2)) L.push("Bande à -10 dB : " + fHz(r.bp_f1) + " à " + fHz(r.bp_f2));
    if(r.nf2ff) L.push("Rayonnement : Dmax " + nbp(r.nf2ff.dmax_dbi, 2) + " dBi" +
                       (isFinite(r.nf2ff.rendement) ? ", rendement " + nbp(r.nf2ff.rendement, 3) : ""));
    for(const n of Object.keys(r.couplages || {}))
      L.push("Couplage " + n + " : " + nbp(r.couplages[n].db_f0, 2) + " dB à la résonance, pire " + nbp(r.couplages[n].pire_db, 2) + " dB");
    return L;
  }

  const GRANDEURS = {
    s11: r => [["S11 (dB)", r.s11_db]],
    roe: r => [["ROE", r.vswr]],
    z:   r => [["R (ohms)", r.z_re], ["X (ohms)", r.z_im]],
    s21: r => Object.keys(r.couplages || {}).map(n => ["S" + n + " (dB)", r.couplages[n].db])
  };
  const COURBE_MAX = 200;
  function courbeLignes(grandeur){
    if(!Object.prototype.hasOwnProperty.call(GRANDEURS, grandeur))
      throw new Error("« grandeur » : " + Object.keys(GRANDEURS).join(", ") + ".");
    const r = resultatCourant();
    if(!r || !Array.isArray(r.f)) throw new Error(PAS_DE_RESULTAT);
    const series = GRANDEURS[grandeur](r).filter(x => Array.isArray(x[1]));
    if(!series.length) throw new Error("Pas de courbe « " + grandeur + " » dans ce résultat.");
    const n = r.f.length, pas = Math.max(1, Math.ceil(n / COURBE_MAX));
    const L = ["f (Hz); " + series.map(x => x[0]).join("; ")];
    for(let k = 0; k < n; k += pas) L.push(nbp(r.f[k], 0) + "; " + series.map(x => nbp(x[1][k], 3)).join("; "));
    if(pas > 1) L.push("... (" + n + " points ; un sur " + pas + " gardé)");
    return L;
  }

  function auditLignes(){
    if(typeof window === "undefined" || typeof window.iaControles !== "function") throw new Error("L'audit n'est pas chargé dans cette page.");
    const c = window.iaControles();
    if(!c.length) return ["Aucun contrôle ne signale rien."];
    const L = [];
    for(const a of c){
      L.push("- [" + a.rang + "] " + a.titre + " : " + a.texte);
      if(a.prop) L.push("  carte pour antenna_proposer : " + JSON.stringify(a.prop));
    }
    return borner(L, 150, "lignes d'audit");
  }

  /* Les chemins « .N » valent pour chaque élément de la liste (ports, couches dessinées). */
  function cheminsDe(chemin){
    const i = chemin.indexOf(".N");
    if(i < 0) return [chemin];
    const bouts = chemin.slice(0, i).split(".");
    let liste = bouts[0] === "con" ? (typeof CON !== "undefined" ? CON : null) : ANT;
    for(const b of (bouts[0] === "con" ? bouts.slice(1) : bouts)) liste = liste == null ? null : liste[b];
    if(!Array.isArray(liste)) return [];
    return liste.map((_, k) => chemin.slice(0, i) + "." + k + chemin.slice(i + 2));
  }
  function reglagesLignes(filtre){
    const champs = typeof window !== "undefined" ? window.IA_CHAMPS : null, resoudre = champs && window.iaResoudre;
    if(!champs || typeof resoudre !== "function") throw new Error("La liste des réglages n'est pas chargée dans cette page.");
    const L = [];
    for(const chemin of Object.keys(champs)){
      const d = champs[chemin];
      for(const c of cheminsDe(chemin)){
        if(!contient(filtre, c, d.nom)) continue;
        const r = resoudre(c);
        if(r.refus) continue;                        // hors du mode conception, ou couche sans objet
        L.push("- " + c + " = " + JSON.stringify(r.obj[r.cle]) + (d.u ? " (" + d.u + ")" : "") + " : " + d.nom +
               (d.choix ? " ; choix : " + d.choix.join(", ") : (d.min != null ? " ; de " + d.min + " à " + d.max : "")));
      }
    }
    return L.length ? borner(L, 150, "réglages") : ["Aucun réglage ne correspond."];
  }

  function carteImportee(){
    return typeof V !== "undefined" && V.modele && !(typeof CON !== "undefined" && CON.actif);
  }
  /* antenna_lire : le texte rendu au canal, en lignes. */
  function lire(quoi, a){
    a = a || {};
    if(quoi === "conception") return extraireContexteOpenems();
    if(quoi === "resultats") return resultatsLignes().join("\n");
    if(quoi === "courbe") return courbeLignes(a.grandeur || "s11").join("\n");
    if(quoi === "balayage"){
      const rb = balayageTermine();
      if(!rb) throw new Error("Aucun balayage terminé dans la page.");
      return tableauBalayage(rb).join("\n");
    }
    if(quoi === "audit") return auditLignes().join("\n");
    if(quoi === "reglages") return reglagesLignes(a.filtre).join("\n");
    if(Object.prototype.hasOwnProperty.call(OUTILS_CARTE, quoi)){
      if(!carteImportee()) throw new Error("Pas de carte importée dans la page (mode conception, ou aucun fichier ouvert).");
      return [].concat(OUTILS_CARTE[quoi].fn(a)).join("\n");
    }
    throw new Error("« quoi » inconnu : conception, resultats, courbe, balayage, audit, reglages, " + Object.keys(OUTILS_CARTE).join(", ") + ".");
  }

  return { contexte: extraireContexteOpenems, carte: OUTILS_CARTE, balayage: OUTIL_BALAYAGE, lire,
           aides: { nb, nbp, fHz, uniteDoc, contient, borner, balayageTermine, tableauBalayage,
                    resultatCourant, s11ALaCible } };
})();
