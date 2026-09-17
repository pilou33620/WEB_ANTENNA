"use strict";
/* =============================================================================
   Antenne openEMS — 30-ia.js
   Assistant IA technique — Google AI Studio.

   LA MÊME INTERFACE QUE CELLE DE WEB_CAO, et ce n'est pas un hasard : les
   modules 00 à 06 de cet outil viennent de la visionneuse de WEB_CAO
   (https://github.com/pilou33620/WEB_CAO), l'espace de travail est le même,
   le thème est le même — et `js/04-interaction.js` appelle déjà
   `iaAfficherMenuContextuel` sur le clic droit, en attendant ce fichier. Le
   panneau, la barre de connexion, la barre d'état, les bulles, les puces de
   questions, le manuel local, les cartes d'action et le menu contextuel sont
   donc repris tels quels de `commun/ia-assistant.js`. Ce qui change est ce qui
   DOIT changer : le contexte transmis, ce que l'assistant sait du domaine, et
   ce qu'une carte d'action a le droit d'écrire.

   GESTION STRICTE DE LA CLÉ API — la règle de WEB_CAO, sans exception :
   - la clé ne vit qu'en mémoire vive et dans le `sessionStorage` de l'onglet ;
   - à chaque fermeture du panneau (✕, Alt+I, Échap, « Oublier clé »), elle est
     effacée — `_cleApi = ""` — et redemandée à la prochaine ouverture ;
   - aucun `localStorage`, aucun cookie, aucun profil, aucun projet.
   Le serveur peut la donner sans qu'on la tape : `GET /api/ia/cle` rend ce
   qu'il trouve dans `api_key_free_ia_studio.txt` ou dans `GEMINI_API_KEY`.

   CE QUE L'ASSISTANT NE FAIT PAS, ET C'EST LA RÈGLE QUI COMMANDE LE RESTE.
   Il n'écrit rien lui-même. Il propose, l'utilisateur applique. Une valeur
   proposée est validée contre une liste blanche de chemins (`IA_CHAMPS`),
   bornée, affichée avec l'avant en face de l'après, et elle ne devient un
   réglage qu'au clic sur la carte d'action. C'est le seul endroit de l'outil
   où du texte venu du réseau touche l'état d'une simulation, et c'est pour
   cela que la barrière est étroite et que le banc l'éprouve.

   DEUX CHOSES SE FONT SANS RÉSEAU NI CLÉ, comme le manuel de WEB_CAO :
   `help` rend le manuel, et `verifier` rend l'audit des réglages — une liste
   de règles écrites ici, en clair, avec leurs corrections en cartes d'action.
   Zéro jeton, zéro requête, et cela marche sur un poste débranché.
   ============================================================================= */

(function(){

  /* ==========================================================================
     État privé éphémère
     ========================================================================== */
  let _cleApi = "";               // EN MÉMOIRE VIVE. Jamais localStorage.
  let _modele = "gemini-2.5-flash";
  let _historique = [];           // les messages de la session en cours
  let _enAttente = false;
  let _inclureContexte = true;    // transmettre l'état des réglages
  let _domConstruit = false;
  let _questionEnAttente = "";    // question préparée depuis le menu contextuel

  /* Les cartes d'action déjà rendues, par leur charge utile encodée. Elles
     survivent au réaffichage de la liste : sans cela, poser une seconde
     question ferait réapparaître « Appliquer » sur un réglage déjà appliqué,
     et on l'appliquerait deux fois sans le voir. */
  const _actions = new Map();

  const IA_SESSION_CLE = "openems_ia_cle";
  const IA_URL = "https://generativelanguage.googleapis.com/v1beta/models/";

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
     Suggestions rapides
     --------------------------------------------------------------------------
     Elles changent selon ce qui est ouvert, comme celles de WEB_CAO changent
     selon l'éditeur : on ne pose pas la même question devant une page blanche,
     devant une antenne dessinée, et devant une courbe qui vient de revenir.
     ========================================================================== */
  const SUGGESTIONS = {
    vide: [
      "Quel substrat choisir pour un patch 2,45 GHz ?",
      "Quelle taille de carte faut-il prévoir pour une antenne à 868 MHz ?",
      "Monopôle, IFA ou patch : lequel pour un objet connecté ?",
      "Que faut-il régler avant de lancer une première simulation FDTD ?"
    ],
    regle: [
      "Relis mes réglages et dis-moi lequel est le plus douteux.",
      "Quel maillage faut-il ici, et pourquoi celui-là ?",
      "Ma marge d'air et ma PML sont-elles cohérentes avec la bande ?",
      "Quelle cote balayer en premier pour gagner le plus ?"
    ],
    resultat: [
      "Ma résonance n'est pas où je la veux : que corriger en premier ?",
      "Mon S11 ne descend pas : est-ce la longueur ou le point d'alimentation ?",
      "Ce résultat est-il crédible ? Qu'est-ce qui pourrait le rendre faux ?",
      "Comment élargir la bande passante de cette antenne ?"
    ]
  };

  function jeuDeSuggestions(){
    if(typeof ANT === "undefined") return SUGGESTIONS.vide;
    if(ANT.resultat) return SUGGESTIONS.resultat;
    if(typeof V !== "undefined" && V.modele) return SUGGESTIONS.regle;
    return SUGGESTIONS.vide;
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

    L.push("=== D'OU VIENT CETTE CARTE ===");
    if(con){
      L.push("Mode conception : la carte est DESSINEE dans l'outil.");
      L.push("Carte " + nbp(CON.carte.L, 2) + " x " + nbp(CON.carte.W, 2) +
             " mm, " + CON.elements.length + " formes dessinees.");
      L.push("Frequence visee par les gabarits : " + fHz(CON.fcible));
      const s = (typeof conSubstrat === "function") ? conSubstrat() : null;
      if(s) L.push("Substrat retenu par les gabarits : er = " + nbp(s.er, 3) +
                   ", h = " + nbp(s.h, 3) + " mm, tand = " + nbp(s.df, 4) + ".");
    }else if(typeof V !== "undefined" && V.modele){
      L.push("Fichier IPC-2581 importe : " + (V.fichier || "sans nom") +
             ", unite du document : " + u + ".");
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
    const z = function(v){
      return v > 0 ? nbp(v, 3) + " " + u : "0 (au mailleur de decider)";
    };
    L.push("Marges d'air : X " + z(ANT.boite.mx) + ", Y " + z(ANT.boite.my) +
           ", au-dessus " + z(ANT.boite.mz_haut) + ", en dessous " +
           z(ANT.boite.mz_bas) + " ; PML " + ANT.boite.pml + " cellules.");
    L.push("Pas de maillage : air " + z(ANT.maillage.res_air) +
           ", dielectrique " + z(ANT.maillage.res_die) + " ; regle du tiers " +
           (ANT.maillage.tiers ? "active" : "desactivee") + ".");
    L.push("Arret : energie residuelle " + nbp(ANT.arret.energie, 1) +
           " dB, garde-fou " + ANT.arret.nmax + " pas de temps.");
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

  function resultatCourant(){
    if(typeof antRes === "function"){
      try{ return antRes(); }catch(e){}
    }
    return (typeof ANT !== "undefined") ? ANT.resultat : null;
  }

  /* ==========================================================================
     LA LISTE BLANCHE
     --------------------------------------------------------------------------
     Tout ce qu'une carte d'action a le droit de toucher, et rien d'autre. Un
     chemin absent d'ici est refusé sans être écrit ; une valeur hors bornes est
     refusée en disant pourquoi. C'est la seule barrière entre un texte venu du
     réseau et l'état de la simulation, et elle est volontairement étroite : on
     y trouve des RÉGLAGES — des nombres qu'un humain taperait dans un champ —,
     jamais la sélection de cuivre, jamais l'empilage lu dans le fichier, jamais
     un chemin qui ferait disparaître un travail.

     `N` dans un chemin désigne un index : « ports.N.x » vaut pour tous les
     ports, « con.pile.N.ep » pour toutes les couches dessinées. « port.x » est
     une écriture de confort pour le port courant.

     Cette table sert AUSSI à écrire la consigne envoyée au modèle (voir
     `grammaire`) : la liste qu'il reçoit est celle que le code applique, et les
     deux ne peuvent donc pas diverger.
     ========================================================================== */
  const IA_CHAMPS = {
    /* -- la bande ------------------------------------------------------- */
    "bande.f1":     {nom:"début de bande", u:"Hz", min:1e6, max:3e11, f:true},
    "bande.f2":     {nom:"fin de bande", u:"Hz", min:1e6, max:3e11, f:true},
    "bande.fcible": {nom:"fréquence visée", u:"Hz", min:1e6, max:3e11, f:true},
    "bande.n":      {nom:"points de fréquence", u:"", min:11, max:4001, entier:true},

    /* -- la boîte d'air -------------------------------------------------- */
    "boite.mx":      {nom:"marge d'air en X", u:"unité du fichier", min:0,
                      max:1e4, zero:"au mailleur de décider"},
    "boite.my":      {nom:"marge d'air en Y", u:"unité du fichier", min:0,
                      max:1e4, zero:"au mailleur de décider"},
    "boite.mz_haut": {nom:"marge d'air au-dessus", u:"unité du fichier", min:0,
                      max:1e4, zero:"au mailleur de décider"},
    "boite.mz_bas":  {nom:"marge d'air en dessous", u:"unité du fichier", min:0,
                      max:1e4, zero:"au mailleur de décider"},
    "boite.pml":     {nom:"cellules de PML", u:"", min:4, max:20, entier:true},

    /* -- le maillage ----------------------------------------------------- */
    "maillage.res_air": {nom:"pas de maillage dans l'air",
                         u:"unité du fichier", min:0, max:1e4,
                         zero:"au mailleur de décider"},
    "maillage.res_die": {nom:"pas de maillage dans le diélectrique",
                         u:"unité du fichier", min:0, max:1e4,
                         zero:"au mailleur de décider"},
    "maillage.tiers":   {nom:"règle du tiers aux arêtes", bool:true},

    /* -- l'arrêt --------------------------------------------------------- */
    "arret.energie": {nom:"énergie résiduelle d'arrêt", u:"dB", min:-80, max:-10},
    "arret.nmax":    {nom:"garde-fou en pas de temps", u:"", min:1000, max:2e6,
                      entier:true},

    /* -- les pertes, le cuivre, le champ lointain ------------------------ */
    "pertes.mode":    {nom:"modèle de pertes du diélectrique",
                       choix:["kappa", "debye"]},
    "pertes.f_kappa": {nom:"fréquence où tanδ est tenu", u:"Hz", min:0,
                       max:3e11, f:true, zero:"le centre de la bande"},
    "modeleCuivre":   {nom:"modèle de cuivre",
                       choix:["feuille", "pec", "volume"]},
    "nf2ff.actif":    {nom:"calcul du champ lointain", bool:true},

    /* -- les ports ------------------------------------------------------- */
    "ports.N.type":  {nom:"type de port", choix:["localise", "coaxial"]},
    "ports.N.x":     {nom:"position X du port", u:"unité du fichier",
                      min:-1e5, max:1e5},
    "ports.N.y":     {nom:"position Y du port", u:"unité du fichier",
                      min:-1e5, max:1e5},
    "ports.N.w":     {nom:"étendue du port en X", u:"unité du fichier",
                      min:1e-4, max:1e4},
    "ports.N.l":     {nom:"étendue du port en Y", u:"unité du fichier",
                      min:1e-4, max:1e4},
    "ports.N.ecart": {nom:"écart du port", u:"unité du fichier", min:0, max:1e4},
    "ports.N.dir":   {nom:"direction du port", choix:["x", "y", "z"]},
    "ports.N.R":     {nom:"impédance de référence", u:"Ω", min:1, max:1000},
    "ports.N.ra":    {nom:"rayon de l'âme du coaxial", u:"unité du fichier",
                      min:1e-4, max:100},
    "ports.N.rb":    {nom:"rayon du diélectrique du coaxial",
                      u:"unité du fichier", min:1e-4, max:100},
    "ports.N.er":    {nom:"permittivité du coaxial", u:"", min:1, max:20},
    "ports.N.longueur": {nom:"longueur du tronçon coaxial",
                         u:"unité du fichier", min:0, max:1e4},
    "ports.N.ligne_d":  {nom:"longueur de ligne à désembeder",
                         u:"unité du fichier", min:0, max:1e4,
                         zero:"aucun désembedage"},
    "ports.N.ligne_w":  {nom:"largeur de la ligne à désembeder",
                         u:"unité du fichier", min:0, max:1e4,
                         zero:"aucun désembedage"},

    /* -- la conception --------------------------------------------------- */
    /* Elles ne valent que le mode conception actif : hors de lui, la carte
       vient d'un fichier et n'a pas à être réécrite par une conversation. */
    "con.fcible":     {nom:"fréquence visée par les gabarits", u:"Hz",
                       min:1e6, max:3e11, f:true},
    "con.carte.L":    {nom:"longueur de la carte dessinée", u:"mm",
                       min:1, max:2000},
    "con.carte.W":    {nom:"largeur de la carte dessinée", u:"mm",
                       min:1, max:2000},
    "con.pile.N.ep":  {nom:"épaisseur de couche", u:"mm", min:1e-4, max:100},
    "con.pile.N.er":  {nom:"permittivité de couche", u:"", min:1, max:100,
                       die:true},
    "con.pile.N.df":  {nom:"tangente de pertes de couche", u:"", min:0, max:1,
                       die:true}
  };

  /* Le chemin normalisé : « port. » se traduit en « ports.<courant>. » — une
     proposition qui dit « le port » parle de celui qu'on est en train de
     régler. */
  function normaliserChemin(chemin){
    let p = String(chemin == null ? "" : chemin).trim();
    if(p.indexOf("port.") === 0) p = "ports." + ANT.portActif + "." + p.slice(5);
    return p;
  }

  function resoudre(chemin){
    const p = normaliserChemin(chemin);
    const norme = p.replace(/\.\d+(?=\.|$)/g, ".N");
    const descr = IA_CHAMPS[norme];
    if(!descr) return {refus:"« " + chemin + " » ne fait pas partie des "+
                             "réglages que l'IA a le droit de proposer."};
    const bouts = p.split(".");
    let racine = ANT;
    if(bouts[0] === "con"){
      if(typeof CON === "undefined" || !CON.actif)
        return {refus:"« " + chemin + " » ne vaut que dans le mode "+
                      "conception, et il n'est pas actif."};
      racine = CON;
      bouts.shift();
    }
    let obj = racine;
    for(let i = 0; i < bouts.length - 1; i++){
      if(obj == null || typeof obj !== "object")
        return {refus:"« " + chemin + " » ne désigne rien dans l'état courant."};
      obj = obj[bouts[i]];
    }
    const cle = bouts[bouts.length - 1];
    if(obj == null || typeof obj !== "object" || !(cle in obj))
      return {refus:"« " + chemin + " » ne désigne rien dans l'état courant "+
                    "(index hors liste ?)."};
    /* Une permittivité sur une couche de cuivre n'a pas de sens, et l'écrire
       ferait apparaître une clé que le reste du code ne lit jamais — une
       valeur sans effet, affichée comme un réglage. */
    if(descr.die && obj.k !== "die")
      return {refus:"« " + chemin + " » vise une couche qui n'est pas un "+
                    "diélectrique."};
    return {obj:obj, cle:cle, descr:descr, chemin:p, norme:norme};
  }

  /* « unité du fichier » est ce que la liste blanche déclare, parce qu'elle
     est écrite une fois pour toutes et qu'un document peut être en pouces. Ce
     qui s'affiche, lui, doit porter l'unité RÉELLE : une carte qui annoncerait
     « 0,78 unité du fichier » ne dit pas ce qu'on va écrire. */
  function uniteTexte(descr){
    if(!descr.u) return "";
    if(descr.u === "unité du fichier") return " " + uniteDoc();
    return " " + descr.u;
  }

  function valeurTexte(descr, v){
    if(descr.bool) return v ? "oui" : "non";
    if(descr.choix) return String(v);
    if(descr.f) return fHz(v);
    if(!isFinite(v)) return "—";
    if(v === 0 && descr.zero) return "0 (" + descr.zero + ")";
    return nb(v, descr.entier ? 0 : 4) + uniteTexte(descr);
  }

  /* Une valeur proposée, ramenée à ce que le champ accepte — ou refusée en
     disant laquelle des bornes elle dépasse. ON NE CORRIGE PAS EN SILENCE :
     une marge de 900 mm qu'on écrêterait à 100 produirait un bouton qui ne
     fait pas ce qu'il annonce. */
  function valider(descr, v){
    if(descr.bool){
      if(typeof v === "boolean") return {ok:true, v:v};
      const t = String(v).toLowerCase();
      if(["true", "oui", "1"].indexOf(t) >= 0) return {ok:true, v:true};
      if(["false", "non", "0"].indexOf(t) >= 0) return {ok:true, v:false};
      return {ok:false, pourquoi:"oui ou non attendu"};
    }
    if(descr.choix){
      const t = String(v).trim().toLowerCase();
      if(descr.choix.indexOf(t) < 0)
        return {ok:false, pourquoi:"valeurs admises : " + descr.choix.join(", ")};
      return {ok:true, v:t};
    }
    let n = +String(v).trim().replace(",", ".");
    if(!isFinite(n)) return {ok:false, pourquoi:"nombre attendu"};
    if(descr.entier) n = Math.round(n);
    if(descr.min != null && n < descr.min)
      return {ok:false, pourquoi:"en dessous de la borne basse (" +
                                 nbp(descr.min, 4) + ")"};
    if(descr.max != null && n > descr.max)
      return {ok:false, pourquoi:"au-dessus de la borne haute (" +
                                 nbp(descr.max, 4) + ")"};
    return {ok:true, v:n};
  }

  /* ==========================================================================
     Les propositions
     --------------------------------------------------------------------------
     Trois genres, et ils ne touchent pas les mêmes choses :

       « reglages » — des champs de la liste blanche, chemin par chemin ;
       « cotes »    — les cotes d'un motif du mode conception ;
       « balayage » — armer un balayage sur une cote existante.

     Une proposition est PRÉPARÉE avant d'être montrée : on relit l'état, on
     valide chaque valeur, et on garde côte à côte l'avant et l'après. Ce qui
     est refusé est affiché aussi — une proposition à moitié valable dont la
     moitié fautive disparaîtrait donnerait une carte qui ne fait pas ce que le
     texte à côté vient d'expliquer.
     ========================================================================== */
  function proposition(brut){
    if(!brut || typeof brut !== "object") return null;
    const type = String(brut.type || "reglages");
    if(type === "cotes") return propCotes(brut);
    if(type === "balayage") return propBalayage(brut);
    return propReglages(brut);
  }

  function propReglages(brut){
    const v = brut.valeurs || brut.values || {};
    const p = {type:"reglages", con:false, lignes:[], refus:[],
               titre:String(brut.titre || brut.label || "Réglages proposés")};
    for(const chemin in v){
      const r = resoudre(chemin);
      if(r.refus){ p.refus.push(r.refus); continue; }
      const c = valider(r.descr, v[chemin]);
      if(!c.ok){ p.refus.push("« " + chemin + " » : " + c.pourquoi + "."); continue; }
      const avant = r.obj[r.cle];
      if(avant === c.v) continue;                     // déjà à cette valeur
      if(r.norme.indexOf("con.") === 0) p.con = true;
      p.lignes.push({chemin:r.chemin, nom:r.descr.nom, descr:r.descr,
                     avant:avant, apres:c.v});
    }
    if(!p.lignes.length && !p.refus.length) return null;
    return p;
  }

  function propCotes(brut){
    const p = {type:"cotes", lignes:[], refus:[],
               titre:String(brut.titre || brut.label || "Cotes de motif")};
    if(typeof CON === "undefined" || !CON.actif){
      p.refus.push("Le mode conception n'est pas actif : il n'y a pas de "+
                   "motif à recoter.");
      return p;
    }
    const g = conGabarit(brut.motif || CON.gabarit);
    if(!g){
      p.refus.push("Aucun motif ouvert, et « " + (brut.motif || "") +
                   " » n'en désigne pas un.");
      return p;
    }
    p.motif = g.id;
    p.tracer = !!brut.tracer;
    if(!brut.titre && !brut.label)
      p.titre = "Cotes proposées pour le " + g.nom.toLowerCase();
    const v = brut.valeurs || brut.values || {};
    const courant = (CON.gabarit === g.id)
      ? CON.gabaritP : conGabaritDefauts(g, conContexte());
    for(const id in v){
      const ch = g.champs.find(c => c.id === id);
      if(!ch){ p.refus.push("« " + id + " » n'est pas une cote du " + g.nom + "."); continue; }
      let n = +String(v[id]).trim().replace(",", ".");
      if(!isFinite(n)){ p.refus.push("« " + id + " » : nombre attendu."); continue; }
      if(ch.entier) n = Math.max(1, Math.round(n));
      /* L'encastrement est la seule cote qui a le droit d'être nulle — un
         patch alimenté au bord existe, il est juste mal adapté. */
      else if(n < 0 || (n === 0 && id !== "y0")){
        p.refus.push("« " + id + " » : une cote dessinable est attendue.");
        continue;
      }
      const avant = courant ? courant[id] : null;
      if(avant != null && Math.abs(avant - n) < 1e-6) continue;
      p.lignes.push({chemin:id, nom:ch.nom, descr:{nom:ch.nom, u:"mm"},
                     avant:avant, apres:n});
    }
    if(!p.lignes.length && !p.refus.length) return null;
    return p;
  }

  function propBalayage(brut){
    const p = {type:"balayage", lignes:[], refus:[],
               titre:String(brut.titre || brut.label || "Balayage proposé")};
    if(typeof balSources !== "function"){
      p.refus.push("Le balayage n'est pas disponible.");
      return p;
    }
    const l = balSources();
    const cible = String(brut.source || "");
    const s = l.find(x => x.id === cible) || l.find(x => x.nom === cible);
    if(!s){
      p.refus.push("« " + cible + " » ne désigne aucune cote balayable. "+
                   "Cotes disponibles : " +
                   (l.length ? l.map(x => x.id).join(", ") : "aucune") + ".");
      return p;
    }
    const min = +String(brut.min).replace(",", "."),
          max = +String(brut.max).replace(",", "."),
          pas = +String(brut.pas != null ? brut.pas : brut.step).replace(",", ".");
    if(!isFinite(min) || !isFinite(max) || !isFinite(pas) || pas <= 0 || !(max > min)){
      p.refus.push("Un balayage demande un début, une fin plus grande, et un "+
                   "pas strictement positif.");
      return p;
    }
    const n = Math.floor((max - min) / pas + 1e-9) + 1;
    if(n > BAL_MAX){
      p.refus.push(n + " points : le garde-fou est à " + BAL_MAX +
                   ". Élargissez le pas ou resserrez la plage.");
      return p;
    }
    p.source = s; p.min = min; p.max = max; p.pas = pas; p.points = n;
    p.lignes.push({chemin:"balayage", nom:"balayage de « " + s.nom + " »",
                   descr:{nom:s.nom, u:s.unite || ""}, texte:true,
                   avant:(ANT.balayage.actif
                            ? (ANT.balayage.nom || "armé") : "éteint"),
                   apres:nbp(min, 4) + " → " + nbp(max, 4) + " par " +
                         nbp(pas, 4) + " (" + n + " points)"});
    return p;
  }

  /* ==========================================================================
     Appliquer, et pouvoir revenir
     ========================================================================== */
  function appliquer(p){
    if(!p || !p.lignes.length) return "";
    if(p.type === "balayage") return appliquerBalayage(p);
    if(p.type === "cotes") return appliquerCotes(p);

    p.lignes.forEach(function(l){
      const r = resoudre(l.chemin);
      if(!r.refus) r.obj[r.cle] = l.apres;
    });
    rafraichir(p.con);
    return p.lignes.length + " réglage(s) appliqué(s)";
  }

  function appliquerCotes(p){
    const g = conGabarit(p.motif);
    if(!g) return "";
    if(CON.gabarit !== g.id){ CON.gabarit = g.id; conGabaritRafraichir(); }
    p.lignes.forEach(function(l){
      /* L'état d'AVANT du drapeau « repris à la main », et pas seulement la
         valeur : sans lui, annuler rendrait la cote du calcul en continuant de
         la présenter comme une décision de l'utilisateur — et la fiche
         mentirait sur ce qu'elle montre. */
      l.toucheAvant = !!CON.gabaritTouche[l.chemin];
      CON.gabaritP[l.chemin] = l.apres;
      CON.gabaritTouche[l.chemin] = true;
    });
    /* « Tracer » REDESSINE le motif, donc efface le dessin en cours et remet
       la bande à ±15 % — c'est ce que fait déjà le bouton « Dessiner ce
       motif », et ce module n'invente pas un second chemin. Sans lui, les
       cotes ne changent que la fiche et son aperçu. */
    if(p.tracer) conGabaritPoser(g, CON.gabaritP);
    else if(typeof conPanneauRendre === "function") conPanneauRendre();
    return p.tracer ? "motif redessiné"
                    : (p.lignes.length + " cote(s) posée(s) sur la fiche");
  }

  function appliquerBalayage(p){
    ANT.balayage.actif = true;
    ANT.balayage.source = p.source.id;
    ANT.balayage.nom = p.source.nom;
    ANT.balayage.min = p.min;
    ANT.balayage.max = p.max;
    ANT.balayage.pas = p.pas;
    ANT.balayage.devis = null;
    const i = ANT_ETAPES.findIndex(e => e.id === "calcul");
    if(i >= 0) ANT.etape = i;
    if(typeof wsShow === "function") wsShow("assistant");
    rafraichir(false);
    return "balayage armé, " + p.points + " points";
  }

  /* Revenir sur ce qui a été appliqué. Seuls les réglages et les cotes se
     défont : un balayage armé se désarme d'une case dans l'étape « Le
     calcul », et un motif redessiné se reprend par « Annuler » du mode
     conception, qui tient déjà son historique. */
  function annuler(p){
    if(!p) return;
    if(p.type === "reglages"){
      p.lignes.forEach(function(l){
        const r = resoudre(l.chemin);
        if(!r.refus) r.obj[r.cle] = l.avant;
      });
      rafraichir(p.con);
    }else if(p.type === "cotes"){
      p.lignes.forEach(function(l){
        if(l.avant != null) CON.gabaritP[l.chemin] = l.avant;
        if(!l.toucheAvant) delete CON.gabaritTouche[l.chemin];
      });
      if(typeof conPanneauRendre === "function") conPanneauRendre();
    }
  }

  /* Ce qu'il faut refaire après une écriture. Le mode conception REFABRIQUE le
     document ; le reste se contente de redemander au serveur ce que le modèle
     vaut maintenant, ce qui rafraîchit le bilan, les avis et la 3D. */
  function rafraichir(con){
    if(con && typeof conAppliquer === "function" && CON.actif){
      conAppliquer(false);
      return;
    }
    if(typeof antMaj === "function") antMaj(true);
    if(typeof antAssistantRendre === "function") antAssistantRendre();
  }

  /* ==========================================================================
     LES VÉRIFICATIONS LOCALES
     --------------------------------------------------------------------------
     Comme le manuel : exécutées par l'outil, sans réseau, sans clé, sans un
     jeton. Ce sont les fautes qu'on fait le plus souvent, elles se détectent
     par un calcul de deux lignes, et il serait absurde de les envoyer chez un
     tiers.

     ELLES NE REFONT PAS LE TRAVAIL DU SERVEUR. `python/openems_modele.py` rend
     déjà ses avis — marge d'air, maillage hors de portée, cellule minuscule —
     et ils s'affichent dans le bilan de l'assistant. On les rappelle ici parce
     que le panneau doit pouvoir être lu seul, mais on ne les recalcule pas :
     ce qui suit porte sur ce que le serveur NE PEUT PAS voir, c'est-à-dire
     l'intention — ce qu'on visait, et ce qu'on a mesuré.
     ========================================================================== */
  function controles(){
    const out = [];
    const dire = function(rang, titre, texte, prop){
      out.push({rang:rang, titre:titre, texte:texte, prop:prop || null});
    };
    const con = (typeof CON !== "undefined" && CON.actif);

    if(!(typeof V !== "undefined" && V.modele)){
      dire("grave", "Rien à vérifier",
           "Aucune carte n'est ouverte : ni fichier importé, ni dessin. "+
           "Ouvrez un fichier, dessinez une antenne, ou posez l'exemple.");
      return out;
    }

    /* -- 1. la bande et la cible ---------------------------------------- */
    const b = ANT.bande;
    if(!(b.f1 > 0 && b.f2 > b.f1)){
      dire("grave", "La bande n'est pas dite",
           "Le début et la fin de bande doivent être deux fréquences, la "+
           "seconde plus grande. Tout le reste en dépend : la marge d'air se "+
           "mesure sur la longueur d'onde basse, le pas de maillage sur la "+
           "haute.");
    }else{
      if(b.fcible > 0 && (b.fcible < b.f1 || b.fcible > b.f2)){
        dire("grave", "La fréquence visée est hors de la bande simulée",
             "Vous visez " + fHz(b.fcible) + " et vous simulez de " +
             fHz(b.f1) + " à " + fHz(b.f2) + ". Le S11 ne dira rien de ce qui "+
             "se passe à la cible, et le champ lointain sera calculé à la "+
             "résonance trouvée dans la bande — pas à celle qui vous "+
             "intéresse.",
             {type:"reglages",
              titre:"Recentrer la bande sur " + fHz(b.fcible) + " (±15 %)",
              valeurs:{"bande.f1":b.fcible * 0.85, "bande.f2":b.fcible * 1.15}});
      }
      const largeur = 200 * (b.f2 - b.f1) / (b.f2 + b.f1);
      if(largeur < 5 && !ANT.resultat){
        const c = b.fcible || (b.f1 + b.f2) / 2;
        dire("attention", "Bande étroite avant d'avoir trouvé la résonance",
             "La bande fait ±" + nb(largeur / 2, 1) + " % autour de son "+
             "centre. Un motif tombe à ±5 % de sa cible de son plein droit : "+
             "une bande aussi serrée rendra une courbe sans creux, et vous ne "+
             "saurez même pas de quel côté chercher. Élargissez d'abord, "+
             "resserrez ensuite.",
             {type:"reglages", titre:"Élargir à ±15 % autour de " + fHz(c),
              valeurs:{"bande.f1":c * 0.85, "bande.f2":c * 1.15}});
      }
      if(b.f2 > 1e11 || b.f1 < 1e6){
        dire("attention", "Une bande hors du vraisemblable",
             "La bande va de " + fHz(b.f1) + " à " + fHz(b.f2) + ". Vérifiez "+
             "l'unité de saisie — elle est actuellement en " + ANT.uniteF +
             " : taper « 868 » dans un champ étiqueté GHz ne produit ni refus "+
             "ni champ vide, seulement un résultat qui a l'air d'en être un.");
      }
    }

    /* -- 2. le cuivre ---------------------------------------------------- */
    if(!ANT.nets.size && !ANT.formes.length)
      dire("grave", "Aucun cuivre n'est désigné",
           "Rien n'a été retenu pour le solveur : ni net, ni forme. La "+
           "simulation n'aurait pas d'antenne. Étape 1 de l'assistant.");

    /* -- 3. l'empilage --------------------------------------------------- */
    if(typeof LT !== "undefined" && LT.pret && Array.isArray(LT.gap)){
      const vides = LT.gap.filter(g => !(g.t > 0));
      if(vides.length)
        dire("grave", "Un intervalle d'empilage n'a pas d'épaisseur",
             vides.length + " intervalle(s) entre deux cuivres sans épaisseur "+
             "saisie. Un substrat d'épaisseur nulle n'a pas de résonance : la "+
             "hauteur commande la longueur électrique autant que la "+
             "permittivité. Étape 2 de l'assistant.");
    }

    /* -- 4. les ports ---------------------------------------------------- */
    if(!ANT.ports.some(p => p.pose))
      dire("grave", "Aucun port n'est posé",
           "Sans port, l'onde n'a pas par où entrer : il n'y a ni S11 ni "+
           "impédance à attendre. Étape 5 de l'assistant.");
    ANT.ports.forEach(function(p, i){
      if(p.pose && p.de && p.a && p.de === p.a)
        dire("grave", "Le port " + (i + 1) + " relie une couche à elle-même",
             "« " + p.de + " » des deux côtés : ce port ne traverse rien, et "+
             "le serveur le refusera.");
      if(p.type === "coaxial" && p.ra > 0 && p.rb > p.ra){
        const z0 = antCoaxZ0(p);
        if(Math.abs(z0 - p.R) / p.R > 0.1)
          dire("attention", "Le coaxial du port " + (i + 1) + " ne fait pas "+
               "son impédance de référence",
               "Les rayons donnent " + nb(z0, 1) + " Ω alors que la référence "+
               "est " + nb(p.R, 1) + " Ω. Un connecteur qui n'est pas à sa "+
               "propre impédance ajoute sa désadaptation à celle de "+
               "l'antenne, et on croit alors corriger l'antenne alors qu'on "+
               "corrige le câble.");
      }
    });

    /* -- 5. l'arrêt : le compteur ne doit pas être ce qui arrête --------- */
    if(ANT.modele && ANT.modele.estimation && ANT.modele.bande){
      const e = ANT.modele.estimation;
      const ideal = Math.max(2000, Math.round(20 / (ANT.modele.bande.f0 * e.dt_s)));
      if(ANT.arret.nmax < ideal){
        const vise = Math.ceil(ideal * 1.5 / 1000) * 1000;
        dire("attention", "Le garde-fou coupera avant l'énergie",
             "Le calcul demanderait environ " + Math.round(ideal) + " pas de "+
             "temps pour se vider jusqu'à " + nb(ANT.arret.energie, 0) +
             " dB, et le compteur est à " + ANT.arret.nmax + ". Ce qui doit "+
             "arrêter une simulation, c'est l'énergie résiduelle ; un "+
             "compteur qui tombe le premier rend une descente coupée, et une "+
             "transformée sur une descente coupée n'est pas une mesure.",
             {type:"reglages", titre:"Porter le garde-fou à " + vise + " pas",
              valeurs:{"arret.nmax":vise}});
      }
    }

    /* -- 6. le maillage face à la plus étroite des lignes ---------------- */
    /* LE PIÈGE LE PLUS CHER DE CET OUTIL, et il a coûté une séance entière :
       λ/20 dans le diélectrique est la règle d'usage, et elle ne suffit pas
       quand une ligne d'alimentation fait trois millimètres. Trois cellules
       en travers d'une ligne, et la résonance disparaît. */
    if(con && CON.gabarit && ANT.modele && ANT.modele.resolution){
      const wf = +((CON.gabaritP || {}).wf);
      if(isFinite(wf) && wf > 0){
        const pas = ANT.modele.resolution.die;
        const n = wf / pas;
        if(n < 3)
          dire("grave", "Moins de trois cellules en travers de la ligne",
               "La ligne d'alimentation fait " + nb(wf, 3) + " mm et le pas "+
               "visé dans le diélectrique " + nb(pas, 3) + " mm, soit " +
               nb(n, 1) + " cellule(s) de large. C'est exactement le cas qui "+
               "fait disparaître la résonance du patch de cet outil : il faut "+
               "descendre le pas au quart de la largeur de ligne.",
               {type:"reglages",
                titre:"Imposer un pas de " + nb(wf / 4, 3) + " mm dans le diélectrique",
                valeurs:{"maillage.res_die":+(wf / 4).toFixed(4)}});
      }
    }

    /* -- 7. le motif patch : ce que la mesure a tranché ------------------ */
    /* Voir A-FAIRE.md § 1 et le croisement g × y0 : le modèle de cavité
       surestime la résistance de bord d'un facteur 3,5, et l'encastrement
       calculé est trop profond d'un bon quart. Ce n'est pas une opinion,
       c'est neuf simulations sur le document que cette page produit. */
    if(con && CON.gabarit === "patch" && !CON.gabaritTouche.y0){
      const y0 = +((CON.gabaritP || {}).y0);
      if(isFinite(y0) && y0 > 0)
        dire("attention", "L'encastrement du patch vient du calcul, et ce "+
             "calcul est faux",
             "y0 vaut " + nb(y0, 2) + " mm, tel que le gabarit le propose. La "+
             "mesure faite sur cet outil dit que la formule surestime la "+
             "résistance de bord d'un facteur 3,5 : l'encastrement est trop "+
             "profond d'un bon quart. Sur le cas mesuré, 11,5 mm rendaient "+
             "-2,5 dB et 8,5 mm en rendent -13. Balayez-le plutôt que de le "+
             "croire.",
             /* « m. » et non « f. » : ce sont les cotes DU MOTIF, celles que
                24-balayage.js propose en reposant le gabarit à chaque point. */
             {type:"balayage",
              titre:"Balayer l'encastrement autour de " + nb(y0 * 0.74, 2) + " mm",
              source:"m.y0", min:+(y0 * 0.6).toFixed(2),
              max:+(y0 * 1.05).toFixed(2), pas:+(y0 * 0.09).toFixed(2)});
    }

    /* -- 8. ce que le résultat dit du réglage ---------------------------- */
    const r = resultatCourant();
    if(r && isFinite(r.f0)){
      if(r.f0 <= b.f1 * 1.02 || r.f0 >= b.f2 * 0.98)
        dire("grave", "La résonance est au bord de la bande simulée",
             "Le minimum de S11 tombe à " + fHz(r.f0) + ", c'est-à-dire sur "+
             "un bord de la bande " + fHz(b.f1) + "–" + fHz(b.f2) + ". Un "+
             "minimum de bord n'est pas une résonance : c'est là que "+
             "l'impulsion n'a presque plus d'énergie. Élargissez la bande de "+
             "ce côté et relancez.",
             {type:"reglages", titre:"Élargir la bande autour de " + fHz(r.f0),
              valeurs:{"bande.f1":Math.max(1e6, r.f0 * 0.8),
                       "bande.f2":r.f0 * 1.2}});

      if(b.fcible > 0){
        const ec = 100 * (r.f0 - b.fcible) / b.fcible;
        if(Math.abs(ec) > 2)
          dire("attention", "La résonance est à " + (ec >= 0 ? "+" : "") +
               nb(ec, 1) + " % de la cible",
               "Mesuré " + fHz(r.f0) + " pour " + fHz(b.fcible) + " visés. "+
               "Une résonance trop " + (ec > 0 ? "haute" : "basse") + " se "+
               "corrige en " + (ec > 0 ? "allongeant" : "raccourcissant") +
               " la cote résonante d'à peu près le même pourcentage — " +
               nb(Math.abs(ec), 1) + " % —, car f est proportionnel à 1/L au "+
               "premier ordre. Ne corrigez qu'une cote à la fois, et relancez.");
      }

      if(r.s11_min_db > -10){
        const re = r.z0_re, im = r.z0_im;
        const reactif = Math.abs(im) > Math.abs(re - 50);
        dire("attention", "L'antenne n'est pas adaptée",
             "S11 minimum à " + nb(r.s11_min_db, 1) + " dB, impédance " +
             nb(re, 1) + (im >= 0 ? " + " : " − ") + nb(Math.abs(im), 1) +
             "j Ω. " + (reactif
               ? "C'est la RÉACTANCE qui domine, pas la partie réelle : ne "+
                 "cherchez pas du côté de la largeur du patch ou de la ligne. "+
                 "Sur une alimentation encastrée, c'est l'encastrement qui la "+
                 "fabrique. N'espérez pas non plus qu'allonger la ligne "+
                 "arrange les choses : une ligne sans perte ne change pas le "+
                 "module de Gamma, elle le fait tourner."
               : "La partie réelle est loin de 50 Ω, la réactance est "+
                 "modeste : c'est un problème de point d'alimentation, pas de "+
                 "longueur résonante."));
      }

      if(r.bp_bord)
        dire("info", "La bande passante est tronquée",
             "Les points sous -10 dB touchent un bord de la bande simulée : "+
             "la largeur affichée est un minorant, pas une mesure.");
    }

    /* -- 9. le balayage armé --------------------------------------------- */
    if(ANT.balayage && ANT.balayage.actif && typeof balCombien === "function"){
      const n = balCombien();
      if(!(n > 1))
        dire("attention", "Le balayage n'a pas de points",
             "Il est armé, mais sa plage ou son pas ne produisent aucune "+
             "valeur. Étape « Le calcul ».");
      else if(n > 12)
        dire("info", n + " simulations en file",
             "Le balayage lancera " + n + " calculs complets, l'un après "+
             "l'autre. Le devis de l'étape « Le calcul » dit ce que cela "+
             "coûte avant de s'y engager.");
    }

    /* -- 10. ce que le serveur a déjà dit -------------------------------- */
    if(ANT.refus)
      dire("grave", "Le serveur refuse ce modèle",
           ANT.refus.message + (ANT.refus.conseil ? (" " + ANT.refus.conseil) : ""));
    else if(ANT.modele && ANT.modele.avis)
      ANT.modele.avis.forEach(function(a){
        dire(a.rang, a.titre + " (avis du serveur)", a.texte);
      });

    if(!out.length)
      dire("info", "Rien à redire",
           "Les vérifications locales ne trouvent pas de faute. Elles ne "+
           "disent pas que l'antenne est bonne — seulement que rien ne les "+
           "alerte dans la façon dont la simulation est réglée.");
    return out;
  }

  /* L'audit, écrit en markdown avec ses corrections en blocs ```action.

     IL PASSE PAR LE MÊME RENDU QUE LA RÉPONSE DU MODÈLE, et c'est voulu : une
     correction locale et une correction proposée par l'IA donnent la même
     carte, avec la même barrière derrière. Deux chemins de rendu auraient fini
     par diverger, et c'est celui qui écrit dans l'état qu'on ne veut pas voir
     diverger. */
  function genererAuditLocal(){
    const l = controles();
    const rang = {grave:0, attention:1, info:2};
    const ico = {grave:"🔴", attention:"🟡", info:"🔵"};
    const tri = l.slice().sort((a, b) => (rang[a.rang] || 9) - (rang[b.rang] || 9));
    const graves = l.filter(a => a.rang === "grave").length;

    let t = "### 🔎 Vérification locale des réglages\n\n" +
            "*(Audit exécuté en local par l'outil — 0 jeton API consommé, " +
            "aucune donnée n'est sortie du poste)*\n\n";
    t += graves
      ? ("**" + graves + " faute(s) grave(s)** relevée(s) sur " + l.length +
         " remarque(s).\n\n---\n\n")
      : ("**Aucune faute grave** sur " + l.length + " remarque(s).\n\n---\n\n");

    tri.forEach(function(a){
      t += "### " + (ico[a.rang] || "•") + " " + a.titre + "\n";
      t += a.texte + "\n\n";
      if(a.prop)
        t += "```action\n" + JSON.stringify(a.prop) + "\n```\n\n";
    });

    t += "---\n\n*Ces règles portent sur ce que le serveur ne peut pas voir : " +
         "l'intention. Elles ne disent pas que l'antenne est bonne, seulement " +
         "que rien ne les alerte dans la façon dont la simulation est réglée. " +
         "Tapez `help` pour le manuel complet.*";
    return t;
  }

  /* ==========================================================================
     Le manuel local — celui de WEB_CAO, écrit pour cet outil-ci
     ========================================================================== */
  function estCommandeAide(txt){
    if(!txt) return false;
    const s = txt.trim().toLowerCase();
    return s === "help" || s === "/help" || s === "aide" || s === "/aide" ||
           s === "?" || s === "man" || s === "manuel";
  }
  function estCommandeAudit(txt){
    if(!txt) return false;
    const s = txt.trim().toLowerCase().replace(/^\//, "");
    return s === "verifier" || s === "vérifier" || s === "verif" ||
           s === "check" || s === "reglages" || s === "réglages" ||
           s === "audit";
  }
  function estCommandeVider(txt){
    if(!txt) return false;
    const s = txt.trim().toLowerCase().replace(/^\//, "");
    return s === "clear" || s === "effacer";
  }

  function genererManuelLocal(){
    return (
      "### 📖 Manuel de l'assistant — Antenne openEMS\n\n" +
      "*(Manuel généré instantanément en local par l'application — 0 jeton API consommé)*\n\n" +
      "---\n\n" +
      "### 1. 🔎 Vérification locale des réglages (sans réseau, sans clé)\n" +
      "Tapez **`verifier`** — ou faites un clic droit sur la carte — pour lancer un audit complet des réglages de simulation. Il applique une liste de règles écrites dans l'outil, et **aucune donnée ne sort du poste**. Ce qu'il attrape :\n" +
      "- **La bande et la cible** : une fréquence visée hors de la bande simulée, une bande trop étroite pour qu'un creux y apparaisse, une bande hors du vraisemblable — c'est-à-dire une faute d'unité.\n" +
      "- **Le cuivre et l'empilage** : rien de désigné pour le solveur, un intervalle sans épaisseur saisie.\n" +
      "- **Les ports** : aucun port posé, un port qui relie une couche à elle-même, un coaxial qui ne fait pas son impédance de référence.\n" +
      "- **L'arrêt** : un garde-fou qui coupera avant que l'énergie soit descendue — une transformée sur une descente tronquée n'est pas une mesure.\n" +
      "- **Le maillage** : moins de trois cellules en travers de la ligne d'alimentation, le cas exact qui fait disparaître la résonance d'un patch.\n" +
      "- **Le dernier résultat** : une résonance au bord de la bande, un écart à la cible *avec le sens de la correction*, une désadaptation en séparant ce qui vient de la réactance de ce qui vient de la partie réelle.\n\n" +
      "---\n\n" +
      "### 2. ⚡ Cartes d'action — les réglages appliqués en 1 clic\n" +
      "L'assistant ne se contente pas d'expliquer : quand il préconise des valeurs, il produit une **carte d'action cliquable** qui montre **l'avant en face de l'après** avant d'écrire quoi que ce soit.\n" +
      "- **Réglages de simulation** : bande, marges d'air, PML, pas de maillage, arrêt, modèle de pertes, cotes et impédance d'un port.\n" +
      "- **Cotes d'un motif** (mode conception) : longueur, largeur, encastrement, encoches… La carte peut se contenter de mettre la fiche à jour, ou redessiner le motif.\n" +
      "- **Balayage** : armer une cote, une plage et un pas — l'étape « Le calcul » en donne le devis avant de lancer.\n" +
      "- *Barrière* : tout passe par une **liste blanche** de chemins, bornée champ par champ. Un chemin hors liste ou une valeur hors bornes est **refusé et affiché comme tel**, jamais écrit en silence.\n" +
      "- *Annulation* : une carte appliquée reste **annulable** tant que la conversation est ouverte.\n\n" +
      "---\n\n" +
      "### 3. 🖱️ Inspection contextuelle par clic droit\n" +
      "Faites un **clic droit** sur la carte pour lancer un diagnostic :\n" +
      "- **🔎 Vérifier les réglages** : l'audit local, sans consommer de jeton.\n" +
      "- **📐 Analyser le net cuivre** : quand un net est désigné, l'IA reçoit son cuivre, ses couches et son rôle dans le modèle.\n" +
      "- **🔍 Inspecter le composant** : le repère et ce que le fichier en dit.\n" +
      "- **✏️ Analyser le motif dessiné** : les cotes posées, celles du calcul, et l'écart entre les deux.\n" +
      "- **💬 Poser une question technique…** : ouvre simplement le panneau.\n\n" +
      "---\n\n" +
      "### 4. ⌨️ Commandes locales & raccourcis clavier\n" +
      "- **`help`** ou **`aide`** : affiche ce manuel (local, 0 requête réseau, 0 jeton).\n" +
      "- **`verifier`** : lance l'audit des réglages (local, 0 jeton).\n" +
      "- **`clear`** ou **`effacer`** : vide la conversation active.\n" +
      "- **`Alt + I`** : affiche ou masque le panneau IA.\n" +
      "- **`Échap`** : ferme le panneau quand le curseur est dedans.\n" +
      "- **`Entrée`** : envoyer · **`Maj + Entrée`** : saut de ligne.\n\n" +
      "---\n\n" +
      "### 5. 🔒 Sécurité, clé API éphémère et données transmises\n" +
      "- **Zéro stockage persistant** : la clé Google AI Studio ne vit qu'en mémoire vive et dans le `sessionStorage` de cet onglet.\n" +
      "- **Purge automatique** : à la fermeture du panneau (✕, Alt+I, Échap, *« Oublier clé »*), elle est effacée et redemandée à la prochaine ouverture.\n" +
      "- **Sans la taper** : posez-la dans `api_key_free_ia_studio.txt` à la racine du dépôt, ou dans la variable d'environnement `GEMINI_API_KEY` — le serveur la rendra à la page, et le fichier est ignoré par git.\n" +
      "- **Ce qui est transmis** quand *« Contexte projet »* est coché : le **résumé** des réglages — bande, empilage, cuivre retenu en nombre d'objets, ports, boîte, maillage, arrêt, chiffres du serveur, motif ouvert, cotes balayables, dernier résultat. **Ni le fichier IPC-2581, ni les polygones de cuivre, ni les courbes.**\n" +
      "- **Sans réseau** : le manuel et la vérification des réglages marchent quand même. C'est pour cela qu'ils existent."
    );
  }

  /* ==========================================================================
     LA CONSIGNE ENVOYÉE AU MODÈLE
     --------------------------------------------------------------------------
     Elle est écrite ici, en toutes lettres, pour qu'on puisse la relire : ce
     qu'un assistant a le droit de dire et de proposer est une décision de
     l'outil, pas un réglage caché.

     LA LISTE DES CHEMINS EST ENGENDRÉE À PARTIR DE `IA_CHAMPS`. Une liste
     recopiée à la main aurait dérivé dès le premier champ ajouté, et le modèle
     aurait proposé des réglages que la page refuse — ce qui ressemble beaucoup
     à un modèle qui se trompe, et n'en est pas un.
     ========================================================================== */
  function grammaire(){
    const l = [];
    for(const c in IA_CHAMPS){
      const d = IA_CHAMPS[c];
      let borne;
      if(d.bool) borne = "oui/non";
      else if(d.choix) borne = d.choix.join(" | ");
      else borne = nbp(d.min, 4) + " .. " + nbp(d.max, 4) + (d.u ? (" " + d.u) : "");
      l.push("  " + c + "  (" + d.nom + " ; " + borne + ")");
    }
    return l.join("\n");
  }

  function promptSysteme(){
    return [
"Tu es l'ingenieur antennes de l'outil « Antenne openEMS » : une page qui mene",
"une carte imprimee — importee d'un fichier IPC-2581 ou dessinee sur place —",
"jusqu'a une simulation FDTD openEMS, et qui en rend le S11, l'impedance",
"d'entree et le diagramme de rayonnement.",
"",
"EXIGENCE ABSOLUE : tu reponds EXCLUSIVEMENT EN FRANCAIS. Aucun mot, aucun",
"meta-commentaire, aucun plan en anglais (bannis tout 'Role:', 'Task:',",
"'Context:', 'Constraint:'). Commence immediatement par ta reponse technique,",
"brievement et avec des chiffres : une explication sans nombre n'aide pas a",
"regler une simulation.",
"",
"CE QUE TU NE FAIS PAS :",
"- tu n'ecris rien toi-meme ; tu proposes, l'utilisateur applique ;",
"- tu n'inventes aucun chiffre du projet : si une grandeur n'est pas dans le",
"  contexte fourni, tu dis qu'elle manque et tu demandes ou la lire ;",
"- tu ne promets pas un resultat : une simulation se relance et se verifie.",
"",
"LES CONVENTIONS DE L'OUTIL, A RESPECTER A LA LETTRE :",
"- les frequences sont TOUJOURS en hertz dans les propositions (2.45e9), quelle",
"  que soit l'unite affichee a l'ecran ;",
"- les longueurs sont dans l'unite du document (mm sauf mention contraire dans",
"  le contexte), sauf les cotes de motif, toujours en millimetres ;",
"- zero veut dire « au mailleur de decider » pour les marges d'air et les pas",
"  de maillage : proposer zero est une decision legitime, pas un oubli ;",
"- l'arret se fait sur l'energie residuelle (-40 dB d'usine) ; le nombre de pas",
"  de temps est un garde-fou et ne doit pas etre ce qui arrete.",
"",
"CE QUE TU SAIS DE CET OUTIL-CI, mesure sur lui et non lu ailleurs :",
"- la marge d'air visee est le quart de la longueur d'onde a la frequence",
"  BASSE, PML comprise ; en dessous, la PML absorbe du champ proche reactif et",
"  la resonance derive sans que rien ne le signale ;",
"- un gabarit d'antenne de l'outil tombe a plus ou moins 5 % de sa cible : le",
"  premier dessin est un point de depart, pas une antenne finie ;",
"- le gabarit patch calcule son encastrement y0 par le modele de cavite, et ce",
"  modele SURESTIME la resistance de bord d'un facteur 3,5 : l'encastrement",
"  propose est trop profond d'environ un quart. Mesure sur FR-4 1,6 mm a",
"  2,45 GHz : y0 = 11,5 mm rendait -2,5 dB, y0 = 8,5 mm rend -13 dB ;",
"- sur ce meme patch, resserrer les encoches g de 3,5 a 1,5 mm gagne 8 dB :",
"  elles ajoutent une capacite que le modele de cavite ignore ;",
"- lambda/20 dans le dielectrique NE SUFFIT PAS quand une ligne d'alimentation",
"  est etroite : il faut au moins trois a quatre cellules en travers de la",
"  ligne, soit un pas au quart de sa largeur ;",
"- allonger une ligne d'alimentation N'ADAPTE PAS : une ligne sans perte au Z0",
"  de reference ne change pas le module de Gamma, elle le fait tourner ;",
"- une resonance trop haute se corrige en allongeant la cote resonante du meme",
"  pourcentage environ (f proportionnel a 1/L au premier ordre) ; on ne",
"  corrige qu'une cote a la fois.",
"",
"LES CARTES D'ACTION.",
"Quand tu preconises des valeurs concretes, termine par un bloc JSON balise",
"```action. L'outil le transforme en une carte cliquable qui montre l'avant en",
"face de l'apres ; l'utilisateur presse, ou ne presse pas. Tu peux en poser",
"plusieurs, une par idee. Trois formes, et aucune autre :",
"",
"1. Des reglages de simulation :",
"```action",
'{"type":"reglages","titre":"Recentrer la bande sur 2,45 GHz","valeurs":{"bande.f1":2.08e9,"bande.f2":2.82e9}}',
"```",
"",
"2. Des cotes d'un motif du mode conception (en millimetres). « tracer » a vrai",
"   redessine le motif — ce qui efface le dessin en cours et remet la bande a",
"   plus ou moins 15 % ; a faux, seule la fiche et son apercu changent :",
"```action",
'{"type":"cotes","motif":"patch","valeurs":{"y0":8.5,"g":1.5},"tracer":false}',
"```",
"",
"3. Armer un balayage sur une cote :",
"```action",
'{"type":"balayage","titre":"Balayer l encastrement","source":"m.y0","min":6,"max":12,"pas":1}',
"```",
"",
"LES SEULS CHEMINS ACCEPTES pour « reglages ». Tout autre chemin est refuse par",
"la page et ta carte devient morte :",
grammaire(),
"",
"« port.X » vise le port en cours de reglage ; « ports.0.X » vise le premier.",
"Les chemins « con.* » n'existent que si le mode conception est actif.",
"Pour « cotes », les identifiants sont ceux que le contexte liste sous",
"« MOTIF OUVERT ». Pour « balayage », « source » est l'un des identifiants",
"listes sous « COTES BALAYABLES », recopie a la lettre ; si le contexte n'en",
"liste aucun, ne propose pas de balayage. Le garde-fou est a " + BAL_MAX +
" points."
    ].join("\n");
  }

  /* ==========================================================================
     Encodage / décodage Base64 UTF-8 sécurisé
     ========================================================================== */
  function encoderBase64Utf8(str){
    try{
      return btoa(Array.from(new TextEncoder().encode(str),
                             b => String.fromCharCode(b)).join(""));
    }catch(_){ return ""; }
  }
  function decoderBase64Utf8(b64){
    try{
      return new TextDecoder().decode(
        Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
    }catch(_){ return ""; }
  }

  /* ==========================================================================
     L'état d'une carte d'action
     --------------------------------------------------------------------------
     La charge utile encodée sert de clé : le même bloc ```action rend toujours
     la même chaîne, et une carte retrouve donc son état à chaque réaffichage
     de la liste. Tant qu'elle n'est pas appliquée, sa proposition est
     RECALCULÉE — l'« avant » doit être celui du moment, pas celui d'il y a
     trois questions.
     ========================================================================== */
  function etatAction(b64){
    const e = _actions.get(b64);
    if(e && e.faite) return e;
    let brut = null;
    try{ brut = JSON.parse(decoderBase64Utf8(b64)); }catch(_){}
    const neuf = {brut:brut, prop:brut ? proposition(brut) : null, faite:false};
    _actions.set(b64, neuf);
    return neuf;
  }

  /* ==========================================================================
     Markdown léger et sécurisé — celui de WEB_CAO
     --------------------------------------------------------------------------
     TOUT EST ÉCHAPPÉ D'ABORD. Ce qui revient du réseau est une donnée, jamais
     du HTML : l'injecter tel quel donnerait à un tiers le droit d'écrire dans
     cette page.
     ========================================================================== */
  function echapperHtml(s){
    return String(s).replace(/[&<>"']/g, ch => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[ch]));
  }

  function carteAction(b64){
    const e = etatAction(b64);
    const p = e.prop;
    if(!p){
      return '<div class="ia-action-card">' +
        '<div class="ia-action-head"><span class="ia-action-icon">⚠</span>' +
        '<span class="ia-action-title">Proposition illisible</span></div>' +
        '<div class="ia-action-desc">Le bloc d’action n’est pas du ' +
        'JSON valide : rien n’a été préparé.</div></div>';
    }
    const desc = p.lignes.map(function(l){
      const av = l.texte ? l.avant : valeurTexte(l.descr, l.avant);
      const ap = l.texte ? l.apres : valeurTexte(l.descr, l.apres);
      return echapperHtml(l.nom) + " : " + echapperHtml(av) +
             " <b>→ " + echapperHtml(ap) + "</b>";
    }).join("<br>");
    const refus = p.refus.map(r => "⚠ " + echapperHtml(r)).join("<br>");

    let pied;
    if(!p.lignes.length){
      pied = '<span class="ia-action-vide">Rien à appliquer : ces valeurs ' +
             'sont déjà celles des réglages.</span>';
    }else if(e.faite){
      pied = '<button type="button" class="ia-btn-action done" disabled>✓ ' +
             echapperHtml(e.resume || "appliqué") + '</button>' +
             (p.type === "balayage" ? "" :
               '<button type="button" class="ia-subbar-btn" ' +
               'data-ia-annuler="' + b64 + '">Annuler</button>');
    }else{
      pied = '<button type="button" class="ia-btn-action" ' +
             'data-ia-appliquer="' + b64 + '">⚡ Appliquer</button>';
    }

    return '<div class="ia-action-card">' +
        '<div class="ia-action-head">' +
          '<span class="ia-action-icon">⚡</span>' +
          '<span class="ia-action-title">' + echapperHtml(p.titre) + '</span>' +
        '</div>' +
        (desc ? ('<div class="ia-action-desc">' + desc + '</div>') : '') +
        (refus ? ('<div class="ia-action-refus">' + refus + '</div>') : '') +
        '<div class="ia-action-footer">' + pied + '</div>' +
      '</div>';
  }

  function formaterMarkdown(texte){
    if(!texte) return "";

    const codeBlocks = [];
    let txt = texte.replace(/```([a-zA-Z0-9_:-]*)[^\S\r\n]*\r?\n([\s\S]*?)```/g,
      function(_, lang, code){
        const idx = codeBlocks.length;
        const langLower = (lang || "").toLowerCase();

        if(langLower === "action" || langLower.indexOf("action:") === 0){
          try{
            const act = JSON.parse(code.trim());
            const b64 = encoderBase64Utf8(JSON.stringify(act));
            codeBlocks.push(carteAction(b64));
            return "%%CODEBLOCK_" + idx + "%%";
          }catch(e){
            console.warn("Bloc action illisible :", e);
          }
        }

        const langLabel = lang || "code";
        codeBlocks.push(
          '<div class="ia-code-wrap">' +
            '<div class="ia-code-head">' +
              '<span>' + echapperHtml(langLabel) + '</span>' +
              '<button type="button" class="ia-btn-copy" data-ia-copier="1">Copier</button>' +
            '</div>' +
            '<pre class="ia-code-block"><code>' + echapperHtml(code.trim()) +
            '</code></pre>' +
          '</div>'
        );
        return "%%CODEBLOCK_" + idx + "%%";
      });

    const lignes = txt.split("\n");
    const out = [];
    let inList = false;

    for(let i = 0; i < lignes.length; i++){
      const l = lignes[i];

      if(l.indexOf("%%CODEBLOCK_") >= 0){
        if(inList){ out.push("</ul>"); inList = false; }
        out.push(l);
        continue;
      }
      if(l.indexOf("### ") === 0){
        if(inList){ out.push("</ul>"); inList = false; }
        out.push("<b>" + echapperHtml(l.slice(4)) + "</b><br>");
        continue;
      }
      if(l.indexOf("## ") === 0){
        if(inList){ out.push("</ul>"); inList = false; }
        out.push("<b style='color:var(--yellow,#f2c744);font-size:1.1em;'>" +
                 echapperHtml(l.slice(3)) + "</b><br>");
        continue;
      }

      const mList = l.match(/^(\s*)[-*+]\s+(.*)$/);
      if(mList){
        if(!inList){ out.push("<ul>"); inList = true; }
        out.push("<li>" + echapperHtml(mList[2])
          .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
          .replace(/`([^`]+)`/g, "<code>$1</code>") + "</li>");
        continue;
      }else if(inList){
        out.push("</ul>");
        inList = false;
      }

      if(!l.trim()){ out.push("<br>"); continue; }

      out.push("<p>" + echapperHtml(l)
        .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
        .replace(/\*(.*?)\*/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>") + "</p>");
    }
    if(inList) out.push("</ul>");

    let finalHtml = out.join("");
    codeBlocks.forEach(function(bloc, idx){
      finalHtml = finalHtml.replace("%%CODEBLOCK_" + idx + "%%", bloc);
    });
    return finalHtml;
  }

  /* ==========================================================================
     Rendu de l'historique
     ========================================================================== */
  function nomModele(){
    const sel = document.getElementById("iaModelSelect");
    if(sel && sel.selectedIndex >= 0) return sel.options[sel.selectedIndex].text;
    return _modele;
  }

  function rendreMessages(){
    const cont = document.getElementById("iaMessages");
    if(!cont) return;

    cont.innerHTML = "";

    if(_historique.length === 0){
      const chips = jeuDeSuggestions();
      const welcome = document.createElement("div");
      welcome.className = "ia-msg model";
      welcome.innerHTML =
        '<span class="ia-msg-role">' + echapperHtml(nomModele()) + '</span>' +
        '<div class="ia-msg-bubble">' +
          '<p>Bonjour ! Je suis votre assistant technique spécialisé en ' +
          'antennes imprimées, simulation FDTD openEMS, empilages et ' +
          'adaptation.</p>' +
          '<p>Que souhaitez-vous régler ou vérifier aujourd’hui ?</p>' +
          '<div class="ia-chips-wrap">' +
            '<div class="ia-chips-title">Vérification locale, manuel et ' +
            'questions fréquentes :</div>' +
            '<div class="ia-chips-grid">' +
              '<button type="button" class="ia-chip ia-chip-audit" ' +
              'data-ia-chip="verifier" title="Audit complet des réglages, ' +
              'en local (0 jeton)">🔎 Vérifier les réglages (verifier)</button>' +
              '<button type="button" class="ia-chip ia-chip-help" ' +
              'data-ia-chip="help" title="Affiche le manuel complet en local ' +
              '(0 jeton)">📖 Manuel &amp; capacités (help)</button>' +
              chips.map(c => '<button type="button" class="ia-chip" ' +
                'data-ia-chip="' + echapperHtml(c) + '">' + echapperHtml(c) +
                '</button>').join("") +
            '</div>' +
          '</div>' +
        '</div>';
      cont.appendChild(welcome);
      lierMessages(cont);
      return;
    }

    _historique.forEach(function(m){
      const d = document.createElement("div");
      d.className = "ia-msg " + m.role + (m.localOutil ? " local-tool" : "");
      let roleLabel = (m.role === "user") ? "Vous" : (m.modele || nomModele());
      if(m.localOutil)
        roleLabel = m.localTitre ||
          "🛠️ Réponse locale de l'outil (aucune donnée transmise)";
      const texte = (m.parts && m.parts[0] && m.parts[0].text) ? m.parts[0].text : "";
      d.innerHTML =
        '<span class="ia-msg-role' + (m.localOutil ? " local-tool" : "") + '">' +
          echapperHtml(roleLabel) + '</span>' +
        '<div class="ia-msg-bubble' + (m.localOutil ? " ia-manual-bubble" : "") +
          '">' + formaterMarkdown(texte) + '</div>';
      cont.appendChild(d);
    });

    if(_enAttente){
      const loading = document.createElement("div");
      loading.className = "ia-loading-bubble";
      loading.innerHTML =
        '<div class="ia-dots"><span class="ia-dot"></span>' +
        '<span class="ia-dot"></span><span class="ia-dot"></span></div>' +
        '<span>' + echapperHtml(nomModele()) + ' analyse vos réglages...</span>';
      cont.appendChild(loading);
    }

    lierMessages(cont);
    cont.scrollTop = cont.scrollHeight;
  }

  /* Les écouteurs des éléments engendrés. Ils sont posés ICI plutôt qu'en
     `onclick` dans le HTML : une charge utile encodée dans un attribut
     `onclick` demande d'échapper des apostrophes dans une chaîne qui en
     contient déjà, et c'est exactement le genre de détail qui casse en
     silence. */
  function lierMessages(cont){
    cont.querySelectorAll("[data-ia-chip]").forEach(function(b){
      b.onclick = function(){ poserQuestionRapide(b.dataset.iaChip); };
    });
    cont.querySelectorAll("[data-ia-appliquer]").forEach(function(b){
      b.onclick = function(){ executerAction(b.dataset.iaAppliquer); };
    });
    cont.querySelectorAll("[data-ia-annuler]").forEach(function(b){
      b.onclick = function(){ annulerAction(b.dataset.iaAnnuler); };
    });
    cont.querySelectorAll("[data-ia-copier]").forEach(function(b){
      b.onclick = function(){ copierCode(b); };
    });
  }

  function copierCode(btn){
    const wrap = btn.closest(".ia-code-wrap");
    const code = wrap ? wrap.querySelector("code") : null;
    if(!code) return;
    navigator.clipboard.writeText(code.textContent).then(function(){
      const orig = btn.textContent;
      btn.textContent = "✓ Copié !";
      btn.style.color = "#44cf6c";
      setTimeout(function(){ btn.textContent = orig; btn.style.color = ""; }, 1500);
    }).catch(function(e){ console.warn("Échec de copie :", e); });
  }

  function poserQuestionRapide(q){
    const input = document.getElementById("iaInput");
    if(!input) return;
    input.value = q;
    envoyerMessage();
  }

  /* ==========================================================================
     Exécuter une carte d'action
     ========================================================================== */
  function executerAction(b64){
    const e = etatAction(b64);
    if(!e.prop || e.faite) return;
    try{
      const resume = appliquer(e.prop);
      e.faite = true;
      e.resume = resume;
      rendreMessages();
      if(typeof hint === "function") hint("IA — " + resume + ".");
    }catch(err){
      console.error("Application d'une carte d'action :", err);
      afficherErreur("Application impossible : " + err.message);
    }
  }

  function annulerAction(b64){
    const e = _actions.get(b64);
    if(!e || !e.faite) return;
    annuler(e.prop);
    e.faite = false;
    e.resume = "";
    /* La proposition est jetée : le prochain rendu la recalculera sur l'état
       remis en place, et son « avant » sera de nouveau celui du moment. */
    _actions.delete(b64);
    rendreMessages();
    if(typeof hint === "function") hint("IA — réglage annulé.");
  }

  /* ==========================================================================
     Le menu contextuel au clic droit
     --------------------------------------------------------------------------
     `js/04-interaction.js` l'appelle déjà : il attendait ce fichier.
     ========================================================================== */
  function iaCacherMenuContextuel(){
    const menu = document.getElementById("iaContextMenu");
    if(menu) menu.hidden = true;
  }

  /* Ce qui est désigné à l'écran, et qui vaut la peine d'être analysé. */
  function selectionDetaillee(){
    if(typeof V === "undefined" || !V.modele) return null;

    if(typeof CON !== "undefined" && CON.actif && CON.gabarit){
      const g = conGabarit(CON.gabarit);
      if(g){
        const c = conContexte();
        const d = conGabaritDefauts(g, c);
        const cotes = g.champs.map(function(ch){
          return {id:ch.id, nom:ch.nom, pose:CON.gabaritP[ch.id],
                  calcul:d[ch.id], repris:!!CON.gabaritTouche[ch.id]};
        });
        return {type:"motif", titre:"Motif dessiné : " + g.nom, badge:g.id,
                json:{motif:g.id, frequence_visee_Hz:CON.fcible,
                      substrat:{er:c.er, h_mm:c.h, tand:c.df}, cotes:cotes}};
      }
    }

    if(V.net >= 0 && V.parNet && V.parNet[V.net]){
      const n = V.parNet[V.net];
      const couches = new Set();
      (n.pistes || []).forEach(p => couches.add(p.c));
      (n.plans || []).forEach(p => couches.add(p.c));
      return {type:"net", titre:"Net cuivre : " + (n.nom || V.net),
              badge:(n.nom || ("#" + V.net)),
              json:{net:n.nom, segments_de_piste:(n.pistes || []).length,
                    versements:(n.plans || []).length,
                    pastilles:(n.pads || []).length,
                    couches:Array.from(couches).map(i => (V.couches[i] || {}).nom),
                    retenu_pour_le_solveur:ANT.nets.has(V.net),
                    est_la_masse:(ANT.netMasse === V.net)}};
    }

    if(V.comp){
      return {type:"composant", titre:"Composant : " + V.comp, badge:V.comp,
              json:{repere:V.comp}};
    }
    return null;
  }

  function questionDeSelection(d){
    if(!d) return "";
    const bloc = "\n\nDonnées techniques (JSON) :\n```json\n" +
                 JSON.stringify(d.json, null, 2) + "\n```\n\n";
    if(d.type === "motif")
      return "Analyse les cotes de ce motif d'antenne dessiné dans l'outil." +
             bloc +
             "Question : ces cotes sont-elles cohérentes avec la fréquence " +
             "visée et ce substrat ? Laquelle est la plus douteuse, et " +
             "laquelle faut-il balayer en premier ?";
    if(d.type === "net")
      return "Analyse ce net de cuivre de la carte." + bloc +
             "Question : ce net doit-il entrer dans le modèle FDTD, et à quel " +
             "titre — élément rayonnant, plan de masse, ligne d'alimentation ? " +
             "Que faut-il vérifier avant de le retenir ?";
    if(d.type === "composant")
      return "Inspecte ce composant de la carte." + bloc +
             "Question : que devient un composant dans une simulation de " +
             "champ, et faut-il le représenter d'une façon ou d'une autre ?";
    return "";
  }

  function lancerAnalyseSelection(d){
    const q = questionDeSelection(d);
    if(!q){ iaOuvrir(); return; }
    _questionEnAttente = q;
    iaOuvrir();
    if(_cleApi){
      const input = document.getElementById("iaInput");
      if(input){
        input.value = q;
        input.style.height = "auto";
        input.style.height = Math.max(56, Math.min(input.scrollHeight, 160)) + "px";
        _questionEnAttente = "";
        setTimeout(() => input.focus(), 60);
      }
    }
  }

  function iaAfficherMenuContextuel(e){
    if(!e) return false;

    /* Laisser la priorité aux gestes en cours : poser un port, tracer une
       forme. Un menu qui s'ouvrirait par-dessus volerait le clic qui annule. */
    if(typeof ANT !== "undefined" && ANT.posePort) return false;
    if(typeof CON !== "undefined" && CON.actif && CON.courant) return false;

    let menu = document.getElementById("iaContextMenu");
    if(!menu){
      menu = document.createElement("div");
      menu.id = "iaContextMenu";
      menu.className = "ia-context-menu";
      menu.hidden = true;
      document.body.appendChild(menu);
      window.addEventListener("pointerdown", function(evt){
        if(!menu.hidden && !menu.contains(evt.target)) menu.hidden = true;
      });
      window.addEventListener("keydown", function(evt){
        if(evt.key === "Escape" && !menu.hidden) menu.hidden = true;
      });
    }

    const d = selectionDetaillee();
    const carte = (typeof V !== "undefined" && V.modele);
    let html = '<div class="ia-menu-head"><span>Assistant IA — ' +
               echapperHtml(nomModele()) + '</span></div>';

    /* L'AUDIT LOCAL EN PREMIER, et c'est délibéré : il ne coûte rien, il ne
       sort pas du poste, et il répond à la question qu'on se pose le plus
       souvent devant un réglage — « est-ce que je peux lancer ? ». */
    if(carte){
      html +=
        '<div class="ia-menu-item primary" id="iaMenuActAudit">' +
          '<div class="ia-menu-item-left">' +
            '<span class="ia-menu-ico">🔎</span>' +
            '<div><div>Vérifier les réglages ✨</div>' +
            '<div class="ia-menu-subtext">En local, sans réseau ni clé</div>' +
            '</div>' +
          '</div>' +
          '<span class="ia-menu-badge">0 jeton</span>' +
        '</div>';
    }

    if(d){
      let titre = "📐 Analyser avec l'IA ✨", sous = "Inspection des données techniques";
      if(d.type === "motif"){ titre = "✏️ Analyser le motif dessiné ✨"; sous = "Cotes posées, cotes calculées, écarts"; }
      else if(d.type === "net"){ titre = "📐 Analyser le net cuivre ✨"; sous = "Couches, rôle dans le modèle, retenue"; }
      else if(d.type === "composant"){ titre = "🔍 Inspecter le composant ✨"; sous = "Ce qu'il devient dans un calcul de champ"; }
      html +=
        '<div class="ia-menu-sep"></div>' +
        '<div class="ia-menu-item primary" id="iaMenuActSelection">' +
          '<div class="ia-menu-item-left">' +
            '<span class="ia-menu-ico">✨</span>' +
            '<div><div>' + titre + '</div>' +
            '<div class="ia-menu-subtext">' + sous + '</div></div>' +
          '</div>' +
          (d.badge ? ('<span class="ia-menu-badge">' + echapperHtml(d.badge) +
                      '</span>') : '') +
        '</div>';
    }

    html +=
      '<div class="ia-menu-sep"></div>' +
      '<div class="ia-menu-item" id="iaMenuActGeneral">' +
        '<div class="ia-menu-item-left">' +
          '<span class="ia-menu-ico">💬</span>' +
          '<div><div>Poser une question technique…</div>' +
          '<div class="ia-menu-subtext">Dimensionnement, maillage, adaptation</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    menu.innerHTML = html;

    const bAudit = menu.querySelector("#iaMenuActAudit");
    if(bAudit) bAudit.onclick = function(){
      menu.hidden = true;
      iaOuvrir();
      auditLocal();
    };
    const bSel = menu.querySelector("#iaMenuActSelection");
    if(bSel) bSel.onclick = function(){
      menu.hidden = true;
      lancerAnalyseSelection(d);
    };
    const bGen = menu.querySelector("#iaMenuActGeneral");
    if(bGen) bGen.onclick = function(){ menu.hidden = true; iaOuvrir(); };

    menu.style.visibility = "hidden";
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    const mw = r.width || 260, mh = r.height || 120;
    menu.style.left = Math.max(10, Math.min(e.clientX + 2, window.innerWidth - mw - 10)) + "px";
    menu.style.top = Math.max(10, Math.min(e.clientY + 2, window.innerHeight - mh - 10)) + "px";
    menu.style.visibility = "visible";
    return true;
  }

  /* ==========================================================================
     Construction du DOM dans la section de l'espace de travail
     ========================================================================== */
  function construireDom(){
    if(_domConstruit) return;
    const panneau = document.getElementById("iaPanneau");
    /* Le panneau est déclaré dans index.html. S'il manque, c'est la page qui
       est incomplète, et en fabriquer un ici ne ferait que masquer la faute
       — le banc d'essai, qui charge ce fichier sans DOM, passe aussi par là. */
    if(!panneau) return;
    _domConstruit = true;

    panneau.innerHTML =
      '<div class="ia-panneau-wrap">' +
        /* 1. Barre de connexion (tant qu'il n'y a pas de clé) */
        '<div class="ia-panel-connect" id="iaPanelConnect">' +
          '<form class="ia-connect-row" id="iaKeyForm" onsubmit="return false;">' +
            '<span class="ia-lock-ico" title="Sécurité éphémère : clé conservée en mémoire vive uniquement">🔒</span>' +
            '<input type="password" id="iaKeyInput" class="ia-key-input-compact" autocomplete="off" spellcheck="false" placeholder="Clé API Google AI Studio (AIzaSy...)" aria-label="Clé API Google AI Studio">' +
            '<button type="button" class="ia-btn-eye-compact" id="iaBtnEye" title="Afficher/Masquer la clé">👁</button>' +
            '<button type="submit" class="ia-btn-ok-compact" id="iaBtnSubmitKey">Valider</button>' +
          '</form>' +
          '<div class="ia-connect-hint">' +
            '<span>🔒 Mémoire vive seule · Oubliée à la fermeture</span>' +
            '<a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Clé gratuite ↗</a>' +
          '</div>' +
          /* SANS CLÉ, LE PANNEAU N'EST PAS INUTILE, et il faut le dire ici :
             c'est le seul endroit où quelqu'un qui n'en a pas regardera. */
          '<div class="ia-connect-local">' +
            'Sans clé, <b>« Vérifier les réglages »</b> et <b>« Manuel »</b> ' +
            'marchent quand même : ils sont exécutés en local.' +
          '</div>' +
        '</div>' +

        /* 2. Barre de statut (dès la clé validée) */
        '<div class="ia-panel-status" id="iaPanelStatus" hidden>' +
          '<div class="ia-status-left">' +
            '<span class="ia-status-dot"></span>' +
            '<select id="iaModelSelect" class="ia-model-select" title="Modèle Google AI Studio">' +
              '<option value="gemini-2.5-flash">Gemini 2.5 Flash</option>' +
              '<option value="gemini-2.5-pro">Gemini 2.5 Pro</option>' +
              '<option value="gemma-4-31b-it">Gemma 4 31B</option>' +
            '</select>' +
            '<span class="ia-status-ctx" id="iaContextText">Prêt</span>' +
          '</div>' +
          '<div class="ia-status-actions">' +
            '<button type="button" class="ia-subbar-btn" id="iaBtnAudit" title="Vérifier les réglages en local (0 jeton)">🔎 Vérifier</button>' +
            '<button type="button" class="ia-subbar-btn" id="iaBtnClear" title="Vider les échanges de cette session">Vider</button>' +
            '<button type="button" class="ia-subbar-btn danger" id="iaBtnPurgeKey" title="Effacer la clé de la mémoire">Oublier clé</button>' +
          '</div>' +
        '</div>' +

        /* 3. Bannière d'erreur */
        '<div class="ia-error-banner" id="iaErrorBanner" hidden>' +
          '<span id="iaErrorText"></span>' +
          '<button type="button" id="iaBtnDismissError">✕</button>' +
        '</div>' +

        /* 4. Liste des messages */
        '<div class="ia-messages scroll" id="iaMessages"></div>' +

        /* 5. Pied : saisie et envoi */
        '<div class="ia-footer">' +
          '<div class="ia-input-row">' +
            '<textarea id="iaInput" class="ia-textarea" rows="2" placeholder="Posez votre question sur ces réglages... (Entrée pour envoyer, Maj+Entrée pour nouvelle ligne)"></textarea>' +
            '<button type="button" class="ia-btn-send" id="iaBtnSend" title="Envoyer (Entrée)">' +
              '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
            '</button>' +
          '</div>' +
          '<div class="ia-footer-hints">' +
            '<label title="Transmet le résumé des réglages de simulation pour guider la réponse. Ni le fichier IPC-2581, ni les polygones, ni les courbes.">' +
              '<input type="checkbox" id="iaChkContext" checked> Contexte projet' +
            '</label>' +
            '<span id="iaFooterModelLabel">Google AI Studio · Session active</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    const selModel = document.getElementById("iaModelSelect");
    if(selModel){
      selModel.value = _modele;
      selModel.addEventListener("change", function(){
        _modele = this.value;
        const lbl = document.getElementById("iaFooterModelLabel");
        if(lbl) lbl.textContent = this.options[this.selectedIndex].text +
                                  " · Session active";
      });
    }

    /* Le ✕ de l'en-tête du panneau purge la clé, comme dans WEB_CAO. */
    const section = document.querySelector('.pnl[data-pnl="ia"]');
    if(section){
      const btnClose = section.querySelector('.pnl-btn[data-act="close"]');
      if(btnClose) btnClose.addEventListener("click", iaPurgerCle);
    }

    document.getElementById("iaBtnPurgeKey").addEventListener("click", iaPurgerCle);
    document.getElementById("iaBtnAudit").addEventListener("click", auditLocal);

    const btnEye = document.getElementById("iaBtnEye");
    const inputCle = document.getElementById("iaKeyInput");
    btnEye.addEventListener("click", function(){
      const estPswd = inputCle.type === "password";
      inputCle.type = estPswd ? "text" : "password";
      btnEye.textContent = estPswd ? "🙈" : "👁";
    });

    document.getElementById("iaKeyForm").addEventListener("submit", function(e){
      e.preventDefault();
      validerCle();
    });
    document.getElementById("iaBtnSubmitKey").addEventListener("click", validerCle);

    document.getElementById("iaBtnClear").addEventListener("click", function(){
      _historique = [];
      _actions.clear();
      rendreMessages();
    });

    document.getElementById("iaBtnDismissError").addEventListener("click", function(){
      document.getElementById("iaErrorBanner").hidden = true;
    });

    const textarea = document.getElementById("iaInput");
    textarea.addEventListener("keydown", function(e){
      if(e.key === "Enter" && !e.shiftKey){
        e.preventDefault();
        envoyerMessage();
      }
    });
    textarea.addEventListener("input", function(){
      this.style.height = "auto";
      this.style.height = Math.max(56, Math.min(this.scrollHeight, 160)) + "px";
    });

    document.getElementById("iaBtnSend").addEventListener("click", envoyerMessage);
    document.getElementById("iaChkContext").addEventListener("change", function(){
      _inclureContexte = this.checked;
    });

    /* Alt+I ouvre et ferme. */
    window.addEventListener("keydown", function(e){
      if(e.altKey && (e.key === "i" || e.key === "I")){
        e.preventDefault();
        if(typeof wsPlaceOf === "function" && wsPlaceOf("ia") !== "hidden") iaFermer();
        else iaOuvrir();
      }
    });

    /* Échap quand le focus est dans le panneau. */
    panneau.addEventListener("keydown", function(e){
      if(e.key === "Escape") iaFermer();
    });

    rendreMessages();
  }

  /* ==========================================================================
     Clé : demander, valider, purger
     ========================================================================== */
  function afficherEcranCle(){
    const c = document.getElementById("iaPanelConnect");
    const s = document.getElementById("iaPanelStatus");
    const i = document.getElementById("iaKeyInput");
    if(c) c.hidden = false;
    if(s) s.hidden = true;
    if(i){ i.value = ""; setTimeout(() => i.focus(), 50); }
  }

  function validerCle(){
    const input = document.getElementById("iaKeyInput");
    const val = (input ? input.value : "").trim();
    if(!val){
      if(input){
        input.focus();
        input.style.borderColor = "var(--red, #e8443a)";
        setTimeout(() => input.style.borderColor = "", 1500);
      }
      return;
    }
    _cleApi = val;
    try{ sessionStorage.setItem(IA_SESSION_CLE, val); }catch(_){}
    input.value = "";                        // vider le champ tout de suite
    basculerVersChat();

    if(_questionEnAttente){
      const inputChat = document.getElementById("iaInput");
      if(inputChat){
        inputChat.value = _questionEnAttente;
        _questionEnAttente = "";
      }
      envoyerMessage();
    }
  }

  function basculerVersChat(){
    const c = document.getElementById("iaPanelConnect");
    const s = document.getElementById("iaPanelStatus");
    if(c) c.hidden = true;
    if(s) s.hidden = false;

    const ctx = document.getElementById("iaContextText");
    if(ctx){
      let quoi = "aucune carte";
      if(typeof CON !== "undefined" && CON.actif) quoi = "conception";
      else if(typeof V !== "undefined" && V.modele) quoi = "IPC-2581";
      if(typeof ANT !== "undefined" && ANT.resultat) quoi += " · simulé";
      ctx.textContent = "Contexte : " + quoi;
    }

    rendreMessages();

    const input = document.getElementById("iaInput");
    if(input){
      if(_questionEnAttente){
        input.value = _questionEnAttente;
        input.style.height = "auto";
        input.style.height = Math.max(56, Math.min(input.scrollHeight, 160)) + "px";
        _questionEnAttente = "";
      }
      setTimeout(() => input.focus(), 60);
    }
  }

  /* La clé est effacée à la fermeture du panneau. Ce n'est pas du zèle : une
     page laissée ouverte une nuit sur un poste partagé garderait sinon de quoi
     facturer quelqu'un d'autre. */
  function iaPurgerCle(){
    _cleApi = "";
    try{ sessionStorage.removeItem(IA_SESSION_CLE); }catch(_){}
    _historique = [];
    _actions.clear();
    _questionEnAttente = "";
    iaCacherMenuContextuel();

    const ik = document.getElementById("iaKeyInput");
    if(ik) ik.value = "";
    const ic = document.getElementById("iaInput");
    if(ic) ic.value = "";
    const eb = document.getElementById("iaErrorBanner");
    if(eb) eb.hidden = true;

    afficherEcranCle();
    rendreMessages();

    const btn = document.getElementById("bIaAssistant");
    if(btn) btn.classList.remove("on");
  }

  function afficherErreur(msg){
    const b = document.getElementById("iaErrorBanner");
    const t = document.getElementById("iaErrorText");
    if(t) t.textContent = msg;
    if(b) b.hidden = false;
  }

  /* ==========================================================================
     L'audit local — une commande, pas une requête
     ========================================================================== */
  function auditLocal(){
    construireDom();
    _historique.push({role:"user", parts:[{text:"verifier"}]});
    _historique.push({role:"model", localOutil:true,
                      localTitre:"🛠️ Vérification locale (aucune donnée transmise)",
                      parts:[{text:genererAuditLocal()}]});
    rendreMessages();
    const graves = controles().filter(a => a.rang === "grave").length;
    if(typeof hint === "function")
      hint(graves
        ? (graves + " faute(s) grave(s) relevée(s) dans les réglages — voir le "+
           "panneau IA.")
        : "Vérifications locales passées : rien d'alarmant dans les réglages.");
  }

  /* ==========================================================================
     Nettoyage des monologues en anglais (Gemma)
     ========================================================================== */
  function scoreFrancais(texte){
    if(!texte) return 0;
    const propre = texte.replace(/^[#*>`_\s\-+0-9.)]+/, "");
    const mots = propre.toLowerCase().match(/[a-zà-ÿ]+/g) || [];
    if(mots.length === 0) return 0;
    const motsFr = new Set([
      "le","la","les","un","une","des","du","de","d","ce","cette","ces","cet",
      "dans","sur","pour","avec","sans","par","est","sont","qui","que","au","aux",
      "antenne","patch","substrat","couche","cuivre","masse","port","bande",
      "frequence","fréquence","resonance","résonance","maillage","boite","boîte",
      "impedance","impédance","adaptation","gabarit","motif","encastrement",
      "il","elle","nous","vous","ils","elles","on","se","sa","son","ses","leur",
      "voici","bonjour","calcul","valeur","valeurs","analyse","permet","utilise",
      "simulation","solveur","cellules","longueur","largeur","epaisseur"
    ]);
    let nbFr = 0;
    for(const m of mots) if(motsFr.has(m) || /[éèêëàâîïôùûç]/.test(m)) nbFr++;
    return nbFr / mots.length;
  }

  function nettoyerReponse(texte){
    if(!texte) return "";
    let s = texte.trim();
    s = s.replace(/<(?:thought|thinking)>[\s\S]*?<\/(?:thought|thinking)>/gi, "").trim();

    /* Les blocs de code sont protégés AVANT le décollage des phrases : une
       carte d'action est du JSON, et y insérer un saut de ligne au milieu
       d'une clé la rendrait illisible. */
    const blocs = [];
    s = s.replace(/```[\s\S]*?```/g, function(m){
      blocs.push(m);
      return "___BLOC_CODE_" + (blocs.length - 1) + "___";
    });
    s = s.replace(/([a-zà-ÿ]{2,}[.!?])([A-ZÀ-Ÿ][a-zà-ÿ]+)/g, "$1\n\n$2");
    if(blocs.length)
      s = s.replace(/___BLOC_CODE_(\d+)___/g, (_, i) => blocs[+i] || "");

    const premier = (s.split("\n")[0] || "").replace(/^[#*>`_\s\-+0-9.)]+/, "").trim();
    if(scoreFrancais(premier) >= 0.35 &&
       !/^(?:Role|Constraint|Context|Task|Thinking|Elite|Senior)\b/i.test(premier))
      return s;

    const paras = s.split(/\n+/);
    for(let i = 0; i < paras.length; i++){
      const p = paras[i].trim();
      if(!p) continue;
      const net = p.replace(/^[#*>`_\s\-+0-9.)]+/, "").trim();
      if(/^(?:Cette antenne|Ce patch|Ce motif|Votre|Le port|La bande|Il s'agit|Voici|Bonjour|Dans ce|Pour |L'analyse|Le maillage|Analyse|Description)/i.test(net) ||
         (scoreFrancais(net) >= 0.28 &&
          !/^(?:Role|Constraint|Context|Task|Thinking|Direct|Explain|Verify|Analyze)\b/i.test(net))){
        if(i > 0) return paras.slice(i).join("\n\n").trim();
        break;
      }
    }
    return s;
  }

  /* ==========================================================================
     Envoi à Google AI Studio
     ========================================================================== */
  async function envoyerMessage(){
    if(_enAttente) return;
    const input = document.getElementById("iaInput");
    const q = (input ? input.value : "").trim();
    if(!q) return;

    /* 1. Le manuel : exécuté par l'outil, sans clé et sans requête. */
    if(estCommandeAide(q)){
      input.value = ""; input.style.height = "";
      _historique.push({role:"user", parts:[{text:q}]});
      _historique.push({role:"model", localOutil:true,
                        localTitre:"🛠️ Manuel du système (réponse locale)",
                        parts:[{text:genererManuelLocal()}]});
      rendreMessages();
      return;
    }

    /* 2. L'audit des réglages : même chose, et c'est le plus utile des deux. */
    if(estCommandeAudit(q)){
      input.value = ""; input.style.height = "";
      auditLocal();
      return;
    }

    /* 3. Vider. */
    if(estCommandeVider(q)){
      input.value = ""; input.style.height = "";
      _historique = [];
      _actions.clear();
      rendreMessages();
      return;
    }

    /* 4. Tout le reste demande la clé. */
    if(!_cleApi){
      _questionEnAttente = q;
      afficherEcranCle();
      const ik = document.getElementById("iaKeyInput");
      if(ik){
        ik.focus();
        ik.style.borderColor = "var(--yellow, #f2c744)";
        setTimeout(() => ik.style.borderColor = "", 1500);
      }
      return;
    }

    input.value = ""; input.style.height = "";
    _historique.push({role:"user", parts:[{text:q}]});
    _enAttente = true;
    rendreMessages();

    const errBanner = document.getElementById("iaErrorBanner");
    if(errBanner) errBanner.hidden = true;

    /* LE CONTEXTE EST JOINT AU DERNIER MESSAGE et non une fois pour toutes :
       entre deux questions, l'utilisateur a pu appliquer une carte, relancer
       un calcul, changer de motif. Un contexte posé au début de la
       conversation serait périmé dès la seconde question — et le modèle
       raisonnerait sur des réglages qui n'existent plus. */
    let contexte = "";
    if(_inclureContexte)
      contexte = "ETAT COURANT DES REGLAGES DANS L'OUTIL :\n" +
                 extraireContexteOpenems();

    const estGemma = _modele.indexOf("gemma") >= 0;
    const contents = [];

    if(estGemma){
      /* Gemma n'accepte pas `systemInstruction` : on amorce la session par un
         tour de rôle explicite, comme le fait WEB_CAO. */
      contents.push({role:"user", parts:[{text:
        "[DIRECTIVE ABSOLUE DU SYSTEME]\n" + promptSysteme()}]});
      contents.push({role:"model", parts:[{text:
        "Bien recu. Je reponds exclusivement en francais, avec rigueur et "+
        "concision, et je termine par un bloc ```action quand je preconise "+
        "des valeurs concretes."}]});
    }

    const passes = _historique.filter(m => !m.localOutil);
    passes.forEach(function(m, i){
      let t = (m.parts && m.parts[0] && m.parts[0].text) || "";
      if(i === passes.length - 1 && m.role === "user" && contexte)
        t = contexte + "\n\n----\nQUESTION : " + t;
      contents.push({role:m.role, parts:[{text:t}]});
    });

    const corps = {
      contents:contents,
      /* Une température basse : on demande un dimensionnement, pas une
         variation. Deux réponses différentes à la même question sur les mêmes
         réglages seraient un défaut, pas une richesse. */
      generationConfig:{temperature:0.15, maxOutputTokens:4096}
    };
    if(!estGemma) corps.systemInstruction = {parts:[{text:promptSysteme()}]};

    try{
      let rep = await fetch(IA_URL + encodeURIComponent(_modele) +
                            ":generateContent?key=" + encodeURIComponent(_cleApi), {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(corps)
      });

      /* Repli pour les modèles qui refusent `systemInstruction`. */
      if(rep.status === 400 && !estGemma){
        const alt = JSON.parse(JSON.stringify(contents));
        if(alt.length && alt[0].role === "user")
          alt[0].parts[0].text = promptSysteme() + "\n\n" + alt[0].parts[0].text;
        rep = await fetch(IA_URL + encodeURIComponent(_modele) +
                          ":generateContent?key=" + encodeURIComponent(_cleApi), {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({contents:alt,
                               generationConfig:corps.generationConfig})
        });
      }

      if(!rep.ok){
        let err = {};
        try{ err = await rep.json(); }catch(_){}
        throw new Error((err.error && err.error.message) || ("Erreur HTTP " + rep.status));
      }

      const donnees = await rep.json();
      let texte = "";
      const c = donnees.candidates && donnees.candidates[0];
      if(c && c.content && Array.isArray(c.content.parts)){
        let parts = c.content.parts.filter(p => !p.thought);
        if(!parts.length) parts = c.content.parts;
        texte = parts.map(p => p.text || "").join("");
      }
      if(!texte) texte = "*(aucune réponse textuelle reçue du modèle)*";

      _historique.push({role:"model", modele:nomModele(),
                        parts:[{text:nettoyerReponse(texte)}]});
    }catch(e){
      /* Le message de l'utilisateur est retiré : l'API attend une alternance
         stricte question / réponse, et une question restée sans réponse ferait
         refuser tout le reste de la conversation. */
      if(_historique.length && _historique[_historique.length - 1].role === "user")
        _historique.pop();
      const m = String(e.message || e);
      console.error("Appel Google AI Studio :", e);
      afficherErreur(
        (m.indexOf("API_KEY_INVALID") >= 0 || m.indexOf("API key not valid") >= 0)
          ? "Clé API Google AI Studio invalide. Vérifiez-la, ou générez-en une autre."
          : ((m.indexOf("Failed to fetch") >= 0)
              ? "Pas de réponse de Google AI Studio : ce poste a-t-il un accès "+
                "réseau ? « verifier » et « help », eux, marchent sans."
              : m));
      _questionEnAttente = q;
    }
    _enAttente = false;
    rendreMessages();
  }

  /* ==========================================================================
     Ouvrir, fermer
     ========================================================================== */
  window.iaOuvrir = async function(){
    construireDom();
    if(typeof wsShow === "function"){
      wsShow("ia");
      if(typeof WS !== "undefined" && WS.panels && WS.panels.ia &&
         WS.panels.ia.collapsed && typeof wsToggleCollapse === "function")
        wsToggleCollapse("ia");
    }
    const btn = document.getElementById("bIaAssistant");
    if(btn) btn.classList.add("on");

    if(!_cleApi){
      try{
        const stocke = sessionStorage.getItem(IA_SESSION_CLE);
        if(stocke) _cleApi = stocke;
      }catch(_){}
      if(!_cleApi){
        try{
          const base = (typeof oeBase === "function") ? oeBase() : "";
          const resp = await fetch(base + "/api/ia/cle");
          if(resp.ok){
            const data = await resp.json();
            if(data && data.dispo && data.cle) _cleApi = data.cle;
          }
        }catch(_){}
      }
    }

    if(!_cleApi) afficherEcranCle();
    else basculerVersChat();
  };

  window.iaFermer = function(){
    iaPurgerCle();
    if(typeof wsClose === "function") wsClose("ia");
    const btn = document.getElementById("bIaAssistant");
    if(btn) btn.classList.remove("on");
  };

  /* ==========================================================================
     Ce qui est exposé
     --------------------------------------------------------------------------
     Les trois premières pour les menus contextuels des outils, comme dans
     WEB_CAO. Les suivantes pour le banc d'essai : il charge ce fichier sans
     navigateur et ne peut pas atteindre l'intérieur de la fermeture, or c'est
     précisément la barrière — liste blanche, bornes, aller-retour — qui doit
     être prouvée ligne à ligne. Les exposer est le prix de cette preuve.
     ========================================================================== */
  window.iaAfficherMenuContextuel = iaAfficherMenuContextuel;
  window.iaCacherMenuContextuel = iaCacherMenuContextuel;
  window.iaPurgerCle = iaPurgerCle;
  window.iaAuditLocal = auditLocal;

  window.iaResoudre = resoudre;
  window.iaValider = valider;
  window.iaProposition = proposition;
  window.iaAppliquer = appliquer;
  window.iaAnnuler = annuler;
  window.iaControles = controles;
  window.iaGrammaire = grammaire;
  window.iaFormaterMarkdown = formaterMarkdown;
  window.IA_CHAMPS = IA_CHAMPS;

  /* ==========================================================================
     Les branchements
     ========================================================================== */
  function initialiserLiaisons(){
    construireDom();

    /* Fermer la section purge la clé — c'est la promesse de l'en-tête, et elle
       ne vaut que si elle est tenue par le code. */
    if(typeof window.wsClose === "function"){
      const base = window.wsClose;
      window.wsClose = function(id){
        if(id === "ia") iaPurgerCle();
        return base.apply(this, arguments);
      };
    }

    /* La disposition peut masquer le panneau sans passer par `wsClose` — un
       profil rechargé, une remise à plat. Le bouton doit suivre, et la clé
       partir avec. */
    if(typeof window.wsApply === "function"){
      const base = window.wsApply;
      window.wsApply = function(){
        const res = base.apply(this, arguments);
        const btn = document.getElementById("bIaAssistant");
        if(btn && typeof wsPlaceOf === "function"){
          const ouvert = wsPlaceOf("ia") !== "hidden";
          btn.classList.toggle("on", ouvert);
          if(!ouvert && _cleApi) iaPurgerCle();
        }
        return res;
      };
    }

    const btn = document.getElementById("bIaAssistant");
    if(btn){
      btn.classList.add("tb-ia");
      btn.onclick = function(e){
        e.preventDefault();
        if(typeof wsPlaceOf === "function" && wsPlaceOf("ia") !== "hidden") iaFermer();
        else iaOuvrir();
      };
    }
  }

  if(typeof document !== "undefined" && document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialiserLiaisons);
  else
    initialiserLiaisons();

})();
