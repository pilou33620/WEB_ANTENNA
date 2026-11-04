"use strict";
/* =============================================================================
   Antenne openEMS — 31-cartes-antenna.js
   La liste des réglages et l'audit local, lus par `antenna_lire` (reglages et
   audit, js/29-lecture-antenna.js) : rien n'est écrit ici. Chaque remarque de
   l'audit porte sa correction (`prop`), à faire à l'interface.

   Le code vient de l'ancien assistant IA intégré : le banc
   test/banc-interface.js §9 l'éprouve.
   ============================================================================= */

/* L'ancien assistant gardait sa clé et son serveur local dans le stockage de session :
   on les efface une fois, au chargement, pour qu'une clé n'y traîne pas. */
try { sessionStorage.removeItem("openems_ia_cle"); sessionStorage.removeItem("openems_ia_local"); } catch (_) {}

const CARTES_ANTENNA = (function(){
  // les aides de lecture partagées (js/29-lecture-antenna.js), comme dans l'ancien assistant
  const { nb, nbp, fHz, uniteDoc, resultatCourant, s11ALaCible } = LECTURE_ANTENNA.aides;
  /* ==========================================================================
     LA LISTE BLANCHE
     --------------------------------------------------------------------------
     Ce que l'audit a le droit de proposer de corriger, et rien d'autre. On
     y trouve des RÉGLAGES — des nombres qu'un humain taperait dans un champ —,
     jamais la sélection de cuivre, jamais l'empilage lu dans le fichier, jamais
     un chemin qui ferait disparaître un travail.

     `N` dans un chemin désigne un index : « ports.N.x » vaut pour tous les
     ports, « con.pile.N.ep » pour toutes les couches dessinées. « port.x » est
     une écriture de confort pour le port courant.

     Cette table sert AUSSI à la lecture `antenna_lire` reglages du canal de
     pilotage (js/29-lecture-antenna.js).
     ========================================================================== */
  const CHAMPS = {
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
    const descr = CHAMPS[norme];
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

  /* RELIRE UN BALAYAGE TERMINÉ. Le meilleur point d'une famille de courbes
     n'est un optimum que s'il est ENCADRÉ : au bord de la plage, c'est
     seulement le meilleur des points essayés, et le vrai est au-delà. C'est
     exactement ce que le croisement g × y₀ a montré (HISTORIQUE.md § 1) — le
     meilleur point était un coin du tableau, et personne ne l'aurait lu sans
     regarder les bornes une à une. La règle le fait, axe par axe.

     Elle LIT et n'écrit rien. Prolonger une plage est
     une décision de calcul — dix simulations de plus — et elle se prend dans
     l'étape « Le calcul », devis en main.

     Les points sont lus dans `lignes`, le tableau que le serveur assemble
     (`_assembler`, openems_run.py) ; à défaut, dans `points[].resultat`.

     LE CRITÈRE EST LE S₁₁ À LA FRÉQUENCE VISÉE, quand une cible est posée et
     que les courbes sont là. Le S₁₁ minimal, celui du tableau, désigne le
     creux le plus profond OÙ QU'IL TOMBE : sur le croisement L × y₀, c'était
     −33,9 dB… à 2,40 GHz pour 2,45 visés (HISTORIQUE.md § 1). Sans courbes ou
     sans cible, on retombe sur le S₁₁ minimal, et l'on dit de combien le
     point désigné résonne à côté de la cible. */

  function lireBalayage(bal, dire){
    const pts = (Array.isArray(bal.lignes) && bal.lignes.length) ? bal.lignes
      : (bal.points || []).map(p => Object.assign(
          {etiquette:p.etiquette, valeur:p.valeur, valeur2:p.valeur2},
          p.resultat || {}));
    const bons = pts.filter(p => isFinite(p.s11_min_db) && isFinite(p.valeur) &&
                                 (!bal.croise || isFinite(p.valeur2)));
    if(bons.length < 2) return;
    const seuil = (typeof ANT_SEUIL_RESONANCE_DB !== "undefined")
                    ? ANT_SEUIL_RESONANCE_DB : -3;
    const plusCreux = bons.reduce((a, p) => (p.s11_min_db < a.s11_min_db ? p : a));
    const avant = "Sur " + bons.length + " points" +
                  (bons.length < pts.length
                     ? " (" + (pts.length - bons.length) + " sans résultat)" : "");
    if(plusCreux.s11_min_db > seuil){
      dire("attention", "Aucun point du balayage ne résonne",
           avant + ", le meilleur S11 est " + nb(plusCreux.s11_min_db, 2) +
           " dB en « " + plusCreux.etiquette + " » : au-dessus de " +
           nb(seuil, 0) + " dB, aucun creux n'est "+
           "une résonance. La plage ne contient pas l'antenne qu'on cherche — "+
           "ou le port ne la voit pas. Regardez l'impédance d'un point avant "+
           "de prolonger quoi que ce soit.");
      return;
    }

    /* Le S11 de chaque point À la cible, lu sur sa courbe. */
    const fc = (ANT.bande && ANT.bande.fcible > 0) ? ANT.bande.fcible : 0;
    const courbes = {};
    (bal.points || []).forEach(function(p){ courbes[p.etiquette] = p.resultat || p; });
    const aLaCible = p => s11ALaCible(courbes[p.etiquette] || p, fc);
    const s11c = new Map(bons.map(p => [p, aLaCible(p)]));
    const parCible = fc > 0 && bons.every(p => isFinite(s11c.get(p)));
    const best = parCible
      ? bons.reduce((a, p) => (s11c.get(p) < s11c.get(a) ? p : a)) : plusCreux;
    const tete = avant + ", le meilleur S11 " +
                 (parCible ? "à " + fHz(fc) + " est " + nb(s11c.get(best), 2)
                           : "est " + nb(best.s11_min_db, 2)) +
                 " dB en « " + best.etiquette + " »";
    const ecart = (!parCible && fc > 0 && isFinite(best.f0))
                    ? 100 * (best.f0 - fc) / fc : 0;
    const horsCible = Math.abs(ecart) > 1
      ? "Ce point résonne à " + nb(Math.abs(ecart), 1) + " % " +
        (ecart < 0 ? "sous" : "au-dessus de") + " la cible (" + fHz(fc) +
        ") : son creux est profond, mais ailleurs. Sans les courbes, le S11 à "+
        "la cible ne se lit pas — rouvrez les résultats du balayage. "
      : "";

    const axes = [{nom:bal.nom, u:bal.unite, cle:"valeur"}];
    if(bal.croise) axes.push({nom:bal.nom2, u:bal.unite2, cle:"valeur2"});
    const bords = [];
    axes.forEach(function(ax){
      const v = Array.from(new Set(bons.map(p => p[ax.cle]))).sort((a, b) => a - b);
      if(v.length < 2) return;
      const x = best[ax.cle], u = ax.u ? " " + ax.u : "";
      const bas = (x === v[0]);
      if(!bas && x !== v[v.length - 1]) return;
      bords.push("à la borne " + (bas ? "basse" : "haute") + " de « " + ax.nom +
                 " » (" + nb(x, 3) + u + ", plage " + nb(v[0], 3) + " à " +
                 nb(v[v.length - 1], 3) + u + ", " + v.length + " valeurs) : "+
                 "prolongez le balayage vers les " +
                 (bas ? "petites" : "grandes") + " valeurs" +
                 (v.length < 3 ? " — deux valeurs n'encadrent rien" : ""));
    });

    const mesure = tete + " — résonance " + fHz(best.f0) +
      (isFinite(best.z0_re) && isFinite(best.z0_im)
         ? ", Z = " + nb(best.z0_re, 1) + (best.z0_im >= 0 ? " + " : " − ") +
           nb(Math.abs(best.z0_im), 1) + "j Ω" : "") + ". " + horsCible;
    if(bords.length)
      dire("attention", "L'optimum du balayage est au bord de la plage",
           mesure + "Il est " + bords.join(" ; et ") + "." +
           (bords.length > 1 ? " C'est un COIN du tableau : les deux cotes "+
                               "sont à leur borne." : "") +
           " Un optimum de bord n'est que le meilleur des points essayés : le "+
           "vrai est au-delà, et la pente des courbes dit seulement de quel "+
           "côté.");
    else
      dire("info", "L'optimum du balayage est dans la plage",
           mesure + "Il est encadré par ses voisins sur " +
           (axes.length > 1 ? "les deux axes" : "l'axe balayé") + " : la "+
           "plage le contient. Si la précision compte, resserrez le pas "+
           "autour de lui plutôt que d'élargir.");
  }

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

    /* -- 3 bis. une couche déclarée masse qui ne porte rien -------------- */
    /* LE CAS DU DIPÔLE IMPRIMÉ EN GÉOMÉTRIE LIBRE. `conRoleSeconde()` met la
       seconde couche en « signal » pour les motifs qui le savent ; une carte
       « formes » ne touche pas aux rôles — `CHAMPS` n'en porte aucun, et
       c'est voulu : une carte qui changerait un plan de masse en signal ferait
       disparaître une masse sans qu'aucune ligne ne le dise. La seconde couche
       reste donc « masse » d'usine sur une antenne qui n'en a pas. On le
       RELÈVE au lieu de le corriger : zéro droit d'écriture de plus, et la
       règle attrape aussi la masse qu'on a oublié de dessiner.
       Un via ne compte pas : il traverse, il ne fait pas un plan. */
    if(con && typeof conCuivres === "function"){
      conCuivres().forEach(function(c){
        if(c.e.role !== "gnd") return;
        const porte = CON.elements.some(el => el.cu === c.e.uid && !el.trou &&
                                              el.type !== "via");
        if(!porte)
          dire("attention", "« " + c.e.nom + " » est déclarée masse et ne "+
               "porte aucun cuivre",
               "Aucune forme n'est dessinée sur cette couche. Le solveur n'y "+
               "verra rien — une couche vide n'entre pas dans le modèle —, "+
               "mais le reste de l'outil la croit là : un port posé à la main "+
               "va par défaut vers la masse la plus proche, donc vers une "+
               "couche vide, et c'est un circuit ouvert ; le document et le "+
               "contexte envoyé à l'IA décrivent une antenne à plan de masse. "+
               "Sur une antenne équilibrée (dipôle imprimé), déclarez-la "+
               "« signal / antenne » dans l'empilage du mode conception ; si "+
               "un plan devait y être, c'est lui qui manque.");
      });
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
      /* LE COMPTEUR EFFECTIF, celui que le modèle a retenu : à zéro dans le
         document, il est calculé, et comparer zéro à quoi que ce soit ferait
         crier au loup à chaque ouverture du panneau. Un compteur calculé peut
         malgré tout être trop court — il couvre l'impulsion, pas la descente
         d'un résonateur à fort Q —, donc l'avis reste, et ce qu'il propose
         est alors de reprendre le réglage à la main. */
      const nmaxEff = (ANT.modele.arret && ANT.modele.arret.nmax)
                      || ANT.arret.nmax;
      if(nmaxEff < ideal){
        const vise = Math.ceil(ideal * 1.5 / 1000) * 1000;
        dire("attention", "Le garde-fou coupera avant l'énergie",
             "Le calcul demanderait environ " + Math.round(ideal) + " pas de "+
             "temps pour se vider jusqu'à " + nb(ANT.arret.energie, 0) +
             " dB, et le compteur est à " + nmaxEff +
             ((ANT.modele.arret && ANT.modele.arret.nmax_auto)
                ? " (calculé sur l'impulsion)" : "") + ". Ce qui doit "+
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
    /* Voir HISTORIQUE.md § 1 : le gabarit corrige désormais sa longueur et sa
       résistance de bord par la mesure (`patchCorrLongueur`,
       `patchCorrRbord`, 22-antennes.js). La seconde est mesurée sur quatre
       stratifiés ; ailleurs c'est une loi interpolée en tan δ et en épaisseur,
       et l'encastrement qui en sort se balaye. */
    if(con && CON.gabarit === "patch" && !CON.gabaritTouche.y0){
      const y0 = +((CON.gabaritP || {}).y0);
      const sub = (typeof conSubstrat === "function") ? conSubstrat() : {};
      const df = sub.df, h = sub.h;
      // les quatre stratifiés mesurés : tan δ, épaisseur (mm)
      const mesure = isFinite(df) && isFinite(h) &&
        [[0.02, 1.53], [0.012, 1.53], [0.0027, 1.524], [0.0037, 0.762]].some(m =>
          Math.abs(df - m[0]) < 0.1 * m[0] && Math.abs(h - m[1]) < 0.03);
      if(isFinite(y0) && y0 > 0 && !mesure)
        dire("attention", "L'encastrement du patch est interpolé, pas mesuré",
             "y0 vaut " + nb(y0, 2) + " mm. Le gabarit corrige la résistance "+
             "de bord du modèle de cavité par la mesure, mais celle-ci n'a été "+
             "faite que sur FR-4, FR-4 haute fréquence et RO4003C de 1,5 mm, et "+
             "RO4350B de 0,76 mm ; ce stratifié (tan δ " + nb(df, 4) + ", " +
             nb(h, 3) + " mm) est entre eux ou au-delà. "+
             "Balayez l'encastrement plutôt que de le croire.",
             /* « m. » et non « f. » : ce sont les cotes DU MOTIF, celles que
                24-balayage.js propose en reposant le gabarit à chaque point. */
             {type:"balayage",
              titre:"Balayer l'encastrement autour de " + nb(y0, 2) + " mm",
              source:"m.y0", min:+(y0 * 0.8).toFixed(2),
              max:+(y0 * 1.2).toFixed(2), pas:+(y0 * 0.1).toFixed(2)});
    }

    /* -- 8. ce que le résultat dit du réglage ---------------------------- */
    const r = resultatCourant();
    /* UN MINIMUM DE BRUIT N'EST PAS UNE RÉSONANCE : sans creux sous −3 dB,
       aucun des conseils ci-dessous — écart à la cible, bord de bande,
       adaptation — ne porte sur l'antenne. C'est le port qu'il faut regarder. */
    const reso = (r && typeof antResonance === "function") ? antResonance(r) : null;
    if(r && isFinite(r.f0) && reso && !reso.reelle)
      dire("grave", "Aucune résonance dans la bande",
           antResonanceTexte(r, reso));
    else if(r && isFinite(r.f0)){
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

    /* -- 8 bis. un balayage terminé : l'optimum est-il DANS la plage ? ---- */
    if(ANT.resultat && ANT.resultat.balayage) lireBalayage(ANT.resultat, dire);

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




  return { CHAMPS, resoudre, controles };
})();
