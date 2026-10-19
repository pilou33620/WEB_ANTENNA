"use strict";
/* =============================================================================
   Antenne openEMS — 31-cartes-antenna.js
   Le registre des cartes d'action et l'audit local des réglages.

   CE QUI PROPOSE UN RÉGLAGE NE L'ÉCRIT PAS. Une carte (réglages, cotes de motif,
   balayage, géométrie libre) est validée ici contre une liste blanche de chemins
   (CHAMPS), bornée, montrée avec l'avant en face de l'après, et ne devient un
   réglage qu'au clic. C'est la barrière par laquelle passe tout texte venu de
   l'extérieur : aujourd'hui le canal de pilotage (`antenna_proposer` du MCP de
   web_suite, js/pilote-antenna.js), et l'audit local (`controles`, lu par
   `antenna_lire` audit, js/29-lecture-antenna.js), dont chaque remarque porte sa
   carte prête.

   Le code vient de l'ancien assistant IA intégré, déplacé tel quel quand Claude
   (par le MCP) l'a remplacé : le banc test/banc-interface.js §9 l'éprouve ligne
   à ligne.
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

     Cette table sert AUSSI à la lecture `antenna_lire` reglages du canal de
     pilotage (js/29-lecture-antenna.js) : la liste qu'on y lit est celle que le
     code applique, et les deux ne peuvent donc pas diverger.
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
     Quatre genres, et ils ne touchent pas les mêmes choses :

       « reglages » — des champs de la liste blanche, chemin par chemin ;
       « cotes »    — les cotes d'un motif du mode conception ;
       « balayage » — armer un balayage sur une cote existante ;
       « formes »   — poser de la géométrie libre dans le dessin, quand aucun
                      motif ne trace l'antenne demandée.

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
    if(type === "formes") return propFormes(brut);
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
     LA GÉOMÉTRIE LIBRE
     --------------------------------------------------------------------------
     POURQUOI ELLE EXISTE, ET POURQUOI ELLE EST VENUE EN DERNIER. Les trois
     autres cartes déplacent des NOMBRES : une borne de bande, une cote de
     gabarit, une plage de balayage. Celle-ci pose du CUIVRE — c'est-à-dire
     l'antenne elle-même. Elle n'existe que parce qu'il y a des antennes
     qu'aucun des six motifs ne sait tracer : une fente, un anneau, un patch à
     coins coupés, un motif qu'on a en tête et qu'on voudrait éprouver avant de
     l'écrire soi-même. Sans elle, la réponse de l'assistant à « dessine-moi
     ceci » était une liste de cotes à reporter à la main — c'est-à-dire
     exactement le travail qu'on venait lui confier.

     CE QU'ELLE N'EST PAS, ET LA CONSIGNE LE DIT DANS CES TERMES. Elle ne
     remplace pas les motifs : eux calculent leurs cotes, tiennent une fiche,
     savent se reposer et se balayer. Une géométrie libre ne sait rien
     d'elle-même — c'est un tas de formes, et la page ne peut en dire que ce
     qu'elle mesure. C'est donc le dernier recours, jamais le premier.

     LA BARRIÈRE EST DE MÊME NATURE QUE LA LISTE BLANCHE, mais elle porte sur
     des FORMES et non sur des chemins : un genre connu, une couche de cuivre
     qui existe, des coordonnées finies et bornées, une étendue dessinable, un
     nombre de formes et de sommets plafonné, et rien qui tombe hors de la
     carte. Ce qui ne passe pas est refusé UNE FORME À LA FOIS et affiché comme
     tel : une carte qui poserait neuf formes sur dix sans le dire ferait
     croire au dessin qu'on vient de lire.
     ========================================================================== */
  const FORMES_MAX  = 40;    // formes par carte
  const PTS_MAX     = 200;   // sommets d'un polygone ou points d'une piste
  const COORD_MAX   = 2000;  // mm ; la carte dessinée est bornée là aussi
  const MIN_ETENDUE = 0.02;  // mm ; en dessous, c'est un clic qui a bougé
  const GENRES = ["rect", "disque", "poly", "piste", "via"];

  /* La couche de cuivre visée. LE NOM EXACT D'ABORD, LES RACCOURCIS ENSUITE :
     « haut » et « bas » sont les mots des motifs (`js/22-antennes.js`) et
     désignent le premier et le second cuivre de l'empilage — mais sur un
     quatre couches, « Cuivre dessous » est le QUATRIÈME, et laisser le
     raccourci l'emporter poserait le cuivre deux étages trop haut sans que
     rien ne le signale. */
  function coucheCuivre(spec){
    if(typeof conCuivres !== "function") return null;
    const cu = conCuivres();
    if(!cu.length) return null;
    const rendre = c => ({uid:c.e.uid, nom:c.e.nom, role:c.e.role || "signal"});
    if(spec == null || spec === "") return rendre(cu[0]);
    const s = String(spec).trim().toLowerCase();
    const exact = cu.find(c => String(c.e.nom).trim().toLowerCase() === s);
    if(exact) return rendre(exact);
    if(s === "haut" || s === "dessus" || s === "top") return rendre(cu[0]);
    if(s === "bas" || s === "dessous" || s === "bottom")
      return (cu.length > 1) ? rendre(cu[1]) : null;
    return null;
  }

  function nombreFini(v){
    if(v == null) return NaN;
    if(typeof v === "number") return isFinite(v) ? v : NaN;
    const n = +String(v).trim().replace(",", ".");
    return isFinite(n) ? n : NaN;
  }

  /* Une coordonnée : finie, bornée, arrondie comme le dessin arrondit — au
     dixième de micron. HORS BORNES ON REFUSE, ON N'ÉCRÊTE PAS : une forme
     silencieusement ramenée dans la carte n'est plus celle que le texte à côté
     décrit, et c'est la carte d'action qu'on croirait. */
  function coordonnee(v){
    const n = nombreFini(v);
    if(!isFinite(n) || Math.abs(n) > COORD_MAX) return NaN;
    return +n.toFixed(4);
  }

  function pointsLus(src){
    if(!Array.isArray(src)) return null;
    const out = [];
    for(const q of src){
      let a, b;
      if(Array.isArray(q)){ a = coordonnee(q[0]); b = coordonnee(q[1]); }
      else if(q && typeof q === "object"){ a = coordonnee(q.x); b = coordonnee(q.y); }
      else return null;
      if(!isFinite(a) || !isFinite(b)) return null;
      out.push([a, b]);
    }
    return out;
  }

  /* Le nom de net. Il sert de clé dans le document fabriqué, et
     `conReprendreSelection()` retient pour le solveur TOUT net qui porte du
     cuivre et ne s'appelle pas GND : un nom inventé n'est donc pas perdu, il
     devient une antenne de plus. On le borne quand même — un nom de trois
     cents caractères rendrait la liste des nets illisible —, et le rôle
     d'usine de la couche donne le défaut qu'on attend. */
  function netDeForme(v, role){
    let s = String(v == null ? "" : v).trim().toUpperCase()
              .replace(/[^A-Z0-9_.+-]/g, "");
    if(!s) s = (role === "gnd") ? "GND" : "ANTENNE";
    return s.slice(0, 24);
  }

  /* Une forme du bloc d'action, ramenée à un élément de dessin — ou refusée en
     disant laquelle des conditions elle manque. Rend {el, texte} ou {refus}. */
  function formeLue(brut, rang){
    const ref = "forme " + (rang + 1);
    if(!brut || typeof brut !== "object")
      return {refus:ref + " : ce n'est pas un objet."};

    const genre = String(brut.type || brut.forme || "").trim().toLowerCase();
    if(GENRES.indexOf(genre) < 0)
      return {refus:ref + " : genre « " + (genre || "absent") +
                    " » inconnu ; les genres sont " + GENRES.join(", ") + "."};

    const c = coucheCuivre(brut.couche != null ? brut.couche : brut.cu);
    if(!c)
      return {refus:ref + " : « " + (brut.couche || brut.cu || "") +
                    " » ne désigne aucune couche de cuivre de l'empilage."};

    const trou = !!(brut.trou || brut.decoupe);
    if(trou && (genre === "via" || genre === "piste"))
      return {refus:ref + " : une découpe retire du cuivre à une SURFACE ; "+
                    "un via et une piste n'en sont pas une."};

    const el = {type:genre, cu:c.uid, net:trou ? "" : netDeForme(brut.net, c.role),
                trou:trou};
    let quoi = "";

    if(genre === "rect"){
      const x1 = coordonnee(brut.x1), y1 = coordonnee(brut.y1),
            x2 = coordonnee(brut.x2), y2 = coordonnee(brut.y2);
      if(!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2))
        return {refus:ref + " : un rectangle demande x1, y1, x2 et y2, finis "+
                      "et d'au plus " + COORD_MAX + " mm."};
      el.x1 = Math.min(x1, x2); el.x2 = Math.max(x1, x2);
      el.y1 = Math.min(y1, y2); el.y2 = Math.max(y1, y2);
      if(el.x2 - el.x1 < MIN_ETENDUE || el.y2 - el.y1 < MIN_ETENDUE)
        return {refus:ref + " : rectangle de moins de " +
                      nbp(MIN_ETENDUE, 3) + " mm de côté — ce n'est pas "+
                      "une forme."};
      quoi = nbp(el.x2 - el.x1, 3) + " × " + nbp(el.y2 - el.y1, 3) +
             " mm, coin en (" + nbp(el.x1, 3) + " ; " + nbp(el.y1, 3) + ")";
    }
    else if(genre === "disque"){
      const cx = coordonnee(brut.cx != null ? brut.cx : brut.x),
            cy = coordonnee(brut.cy != null ? brut.cy : brut.y),
            r  = nombreFini(brut.r != null ? brut.r : brut.rayon);
      if(!isFinite(cx) || !isFinite(cy))
        return {refus:ref + " : un disque demande un centre cx, cy."};
      if(!(r >= MIN_ETENDUE / 2) || r > COORD_MAX)
        return {refus:ref + " : rayon « r » absent ou hors bornes."};
      el.cx = cx; el.cy = cy; el.r = +r.toFixed(4);
      quoi = "r = " + nbp(el.r, 3) + " mm, centre (" + nbp(cx, 3) + " ; " +
             nbp(cy, 3) + ")";
    }
    else if(genre === "poly"){
      const pts = pointsLus(brut.pts || brut.points);
      if(!pts)
        return {refus:ref + " : « pts » doit être une liste de paires [x, y] "+
                      "finies et bornées."};
      if(pts.length < 3)
        return {refus:ref + " : un polygone demande au moins trois sommets ("+
                      pts.length + " reçu" + (pts.length > 1 ? "s" : "") + ")."};
      if(pts.length > PTS_MAX)
        return {refus:ref + " : " + pts.length + " sommets, le garde-fou est "+
                      "à " + PTS_MAX + "."};
      el.pts = pts;
      const b = conBoite(el);
      if(b.x2 - b.x1 < MIN_ETENDUE || b.y2 - b.y1 < MIN_ETENDUE)
        return {refus:ref + " : polygone sans étendue — des points alignés ne "+
                      "font pas une surface."};
      quoi = pts.length + " sommets, encombrement " + nbp(b.x2 - b.x1, 3) +
             " × " + nbp(b.y2 - b.y1, 3) + " mm";
    }
    else if(genre === "piste"){
      const pts = pointsLus(brut.pts || brut.points);
      if(!pts)
        return {refus:ref + " : « pts » doit être une liste de paires [x, y] "+
                      "finies et bornées."};
      if(pts.length < 2)
        return {refus:ref + " : une piste demande au moins deux points."};
      if(pts.length > PTS_MAX)
        return {refus:ref + " : " + pts.length + " points, le garde-fou est "+
                      "à " + PTS_MAX + "."};
      const w = nombreFini(brut.w != null ? brut.w : brut.largeur);
      if(!(w >= MIN_ETENDUE) || w > COORD_MAX)
        return {refus:ref + " : une piste demande une largeur « w » d'au "+
                      "moins " + nbp(MIN_ETENDUE, 3) + " mm."};
      el.pts = pts; el.w = +w.toFixed(4);
      let lg = 0;
      for(let i = 0; i + 1 < pts.length; i++)
        lg += Math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1]);
      quoi = "large de " + nbp(el.w, 3) + " mm, longue de " + nbp(lg, 3) +
             " mm (" + pts.length + " points)";
    }
    else{                                                        /* un via */
      const x = coordonnee(brut.x), y = coordonnee(brut.y),
            d = nombreFini(brut.d != null ? brut.d : brut.diametre);
      if(!isFinite(x) || !isFinite(y))
        return {refus:ref + " : un via demande x et y."};
      if(!(d >= 0.05) || d > 50)
        return {refus:ref + " : diamètre de via hors bornes (0,05 à 50 mm)."};
      el.x = x; el.y = y; el.d = +d.toFixed(4);
      quoi = "Ø " + nbp(el.d, 3) + " mm en (" + nbp(x, 3) + " ; " +
             nbp(y, 3) + ")";
    }

    const texte = (trou ? "découpe " : "") +
                  ((typeof CON_GENRES !== "undefined" && CON_GENRES[genre])
                     || genre) +
                  " · " + c.nom + (el.net ? (" · " + el.net) : "") +
                  " · " + quoi;
    return {el:el, texte:texte};
  }

  /* La boîte contre laquelle on juge « dans la carte » ou non. ELLE N'EST PAS
     CELLE DU DESSIN POUR UNE PISTE, et c'est mesuré : `conBoite` élargit une
     piste d'une demi-largeur de chaque côté, si bien qu'une ligne
     d'alimentation qui vient mourir au bord de la carte — ce que font les six
     motifs de l'outil, `gPiste("haut","ANTENNE",[[0,yc],…])` — débordait
     toujours de w/2, et l'avis se serait allumé sur presque chaque
     proposition. Un avis qui se déclenche tout le temps ne se lit plus. On
     juge donc une piste sur son AXE, qui est ce que l'on cote. */
  function boiteJugee(el){
    if(el.type !== "piste") return conBoite(el);
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for(const q of el.pts){
      x1 = Math.min(x1, q[0]); x2 = Math.max(x2, q[0]);
      y1 = Math.min(y1, q[1]); y2 = Math.max(y2, q[1]);
    }
    return {x1:x1, y1:y1, x2:x2, y2:y2};
  }

  function propFormes(brut){
    const p = {type:"formes", lignes:[], refus:[], avis:[], detail:[], els:[],
               carte:null, port:null, remplacer:false,
               titre:String(brut.titre || brut.label || "Géométrie proposée")};

    if(typeof CON === "undefined" || !CON.actif){
      p.refus.push("Le mode conception n'est pas actif : il n'y a pas de "+
                   "dessin où poser du cuivre.");
      return p;
    }
    const cu = (typeof conCuivres === "function") ? conCuivres() : [];
    if(!cu.length){
      p.refus.push("L'empilage ne porte aucune couche de cuivre : il n'y a "+
                   "rien sur quoi dessiner.");
      return p;
    }

    /* LA CARTE SE RÈGLE AVANT LES FORMES, et l'ordre compte. C'est elle qui
       dit ce qui est « dans la carte » : une forme jugée hors carte contre
       l'ANCIENNE taille serait refusée alors que la proposition l'agrandit
       justement pour elle. */
    let L = CON.carte.L, W = CON.carte.W;
    let ligneCarte = null;
    if(brut.carte && typeof brut.carte === "object"){
      const nL = nombreFini(brut.carte.L), nW = nombreFini(brut.carte.W);
      if(!(nL >= 1 && nL <= 2000) || !(nW >= 1 && nW <= 2000)){
        p.refus.push("La carte proposée sort des bornes du mode conception "+
                     "(1 à 2000 mm de côté) : elle n'est pas posée.");
      }else{
        const cL = +nL.toFixed(3), cW = +nW.toFixed(3);
        if(Math.abs(cL - CON.carte.L) > 1e-6 || Math.abs(cW - CON.carte.W) > 1e-6){
          p.carte = {L:cL, W:cW};
          ligneCarte = {chemin:"carte", nom:"carte dessinée", texte:true,
                        avant:nbp(CON.carte.L, 3) + " × " +
                              nbp(CON.carte.W, 3) + " mm",
                        apres:nbp(cL, 3) + " × " + nbp(cW, 3) + " mm"};
        }
        L = cL; W = cW;
      }
    }

    p.remplacer = !!(brut.remplacer || brut.remplace);

    const src = Array.isArray(brut.elements) ? brut.elements
              : (Array.isArray(brut.formes) ? brut.formes : null);
    if(!src){
      p.refus.push("Aucune liste « elements » : une carte « formes » pose des "+
                   "formes, et il n'y en a pas.");
      return p;
    }
    if(src.length > FORMES_MAX){
      p.refus.push(src.length + " formes : le garde-fou est à " +
                   FORMES_MAX + ". Au-delà, ce n'est plus une proposition "+
                   "qu'on relit avant de presser.");
      return p;
    }

    let dehors = 0;
    src.forEach(function(f, i){
      const r = formeLue(f, i);
      if(r.refus){ p.refus.push(r.refus); return; }
      /* DU CUIVRE HORS DU SUBSTRAT N'EST PAS UNE ANTENNE : il flotte dans
         l'air du volume de calcul, il rayonne, et rien sur la courbe ne dira
         d'où vient ce qu'on lit. Entièrement dehors, on refuse ; à cheval sur
         le bord, on pose et on le DIT — un brin qui dépasse du substrat est
         parfois voulu, et c'est à qui lit la carte d'en décider. */
      const b = boiteJugee(r.el);
      if(b.x2 < 0 || b.x1 > L || b.y2 < 0 || b.y1 > W){
        p.refus.push("forme " + (i + 1) + " : entièrement hors de la carte "+
                     "(x de 0 à " + nbp(L, 3) + ", y de 0 à " + nbp(W, 3) +
                     " mm) — du cuivre hors substrat ne se simule pas.");
        return;
      }
      if(b.x1 < -1e-6 || b.y1 < -1e-6 || b.x2 > L + 1e-6 || b.y2 > W + 1e-6)
        dehors++;
      p.els.push(r.el);
      p.detail.push(r.texte);
    });

    /* LE PORT, PARCE QU'UN DESSIN SANS PORT NE SE SIMULE PAS. La liste blanche
       sait DÉPLACER un port (« port.x »), elle ne sait pas en POSER un : poser
       un port est une décision géométrique, et elle appartient à la géométrie
       qui la justifie. Il s'applique et se défait avec la même carte. */
    let lignePort = null;
    if(brut.port && typeof brut.port === "object"){
      const px = coordonnee(brut.port.x), py = coordonnee(brut.port.y),
            pw = nombreFini(brut.port.w), pl = nombreFini(brut.port.l);
      if(cu.length < 2)
        p.refus.push("Un port vertical relie deux couches ; l'empilage n'en "+
                     "porte qu'une.");
      else if(!isFinite(px) || !isFinite(py) || !(pw > 0) || !(pl > 0))
        p.refus.push("Le port demande x, y, et deux étendues strictement "+
                     "positives — « w » en x, « l » en y.");
      else if(px < -1e-6 || px > L + 1e-6 || py < -1e-6 || py > W + 1e-6)
        p.refus.push("Le port proposé tombe hors de la carte.");
      else{
        p.port = {x:px, y:py, w:+Math.max(pw, 0.05).toFixed(4),
                  l:+Math.max(pl, 0.05).toFixed(4),
                  de:cu[0].e.nom, a:cu[1].e.nom};
        lignePort = {chemin:"port", nom:"port d'excitation", texte:true,
                     avant:(ANT.port.pose
                              ? ("posé en " + nbp(ANT.port.x, 3) + " ; " +
                                 nbp(ANT.port.y, 3))
                              : "non posé"),
                     apres:nbp(p.port.x, 3) + " ; " + nbp(p.port.y, 3) +
                           ", empreinte " + nbp(p.port.w, 3) + " × " +
                           nbp(p.port.l, 3) + " mm, de « " + p.port.de +
                           " » à « " + p.port.a + " »"};
      }
    }

    if(p.els.length || p.remplacer)
      p.lignes.push({chemin:"formes", nom:"formes dessinées", texte:true,
                     avant:String(CON.elements.length),
                     apres:(p.remplacer ? p.els.length
                                        : CON.elements.length + p.els.length) +
                           (p.remplacer ? "  (le dessin en cours est effacé)"
                                        : "")});
    if(ligneCarte) p.lignes.push(ligneCarte);
    if(lignePort)  p.lignes.push(lignePort);

    if(dehors)
      p.avis.push(dehors + " forme" + (dehors > 1 ? "s débordent" : " déborde") +
                  " de la carte : le cuivre qui dépasse du substrat est "+
                  "simulé dans l'air.");
    if(p.remplacer && CON.gabarit)
      p.avis.push("Le dessin effacé est un motif calculé : sa fiche et le "+
                  "balayage de ses cotes s'en vont avec lui.");
    else if(!p.remplacer && CON.gabarit && CON.elements.length)
      p.avis.push("Ces formes s'AJOUTENT au motif dessiné. Ses cotes restent "+
                  "balayables : à chaque point, le motif est reposé et ces "+
                  "formes recollées aux mêmes coordonnées — elles ne suivent "+
                  "pas le motif quand il s'allonge.");
    if(!p.port && !ANT.port.pose && (p.els.length || p.remplacer))
      p.avis.push("Aucun port n'est posé et cette carte n'en pose pas : rien "+
                  "ne se simulera tant qu'il n'y en aura pas un.");

    if(!p.lignes.length && !p.refus.length) return null;
    return p;
  }

  /* ==========================================================================
     Appliquer, et pouvoir revenir
     ========================================================================== */
  function appliquer(p){
    if(!p || !p.lignes.length) return "";
    if(p.type === "balayage") return appliquerBalayage(p);
    if(p.type === "cotes") return appliquerCotes(p);
    if(p.type === "formes") return appliquerFormes(p);

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

  /* Poser la géométrie libre.

     L'ÉTAT D'AVANT EST GARDÉ ICI, ET EN ENTIER. Le mode conception tient déjà
     son historique — `conAppliquer()` y pousse un instantané à chaque
     modification acceptée —, mais le bouton « Annuler » de la carte doit
     défaire CETTE carte et elle seule, même si trois formes ont été dessinées
     à la main entre-temps. Un Ctrl+Z ne saurait pas faire la différence.

     LES PORTS EN FONT PARTIE. Une pose avec « remplacer » dépose tous les
     ports, comme le fait « Tout effacer » du panneau de conception : ils
     désignaient du cuivre qui vient de disparaître. Les rendre au retour en
     arrière est la moitié du travail qu'on oublie, et un port dépose sans
     raison fait refuser la simulation entière avec un message qui parle d'un
     port auquel on n'a pas touché. */
  function appliquerFormes(p){
    p.avant = {
      elements:JSON.parse(JSON.stringify(CON.elements)),
      carte:{L:CON.carte.L, W:CON.carte.W},
      gabarit:CON.gabarit, calcul:CON.calcul,
      ports:ANT.ports.map(q => ({pose:q.pose, x:q.x, y:q.y, w:q.w, l:q.l,
                                 dir:q.dir, de:q.de, a:q.a}))
    };

    if(p.remplacer){
      CON.elements = [];
      /* La fiche du motif décrirait une antenne qui n'est plus dessinée. */
      CON.calcul = null;
      CON.gabarit = null;
      ANT.ports.forEach(function(q){ q.pose = false; });
    }
    if(p.carte){ CON.carte.L = p.carte.L; CON.carte.W = p.carte.W; }
    /* UNE COPIE, ET NON L'OBJET PRÉPARÉ. La proposition est recalculée à
       chaque réaffichage de la liste tant qu'elle n'est pas appliquée ;
       pousser ses éléments tels quels mettrait le dessin et la carte en
       partage de points, et déplacer une forme à la souris changerait ce que
       la carte prétend avoir posé. */
    p.els.forEach(function(el){ CON.elements.push(JSON.parse(JSON.stringify(el))); });
    if(p.port){
      ANT.port.pose = true;
      ANT.port.dir  = "z";
      ANT.port.x = p.port.x; ANT.port.y = p.port.y;
      ANT.port.w = p.port.w; ANT.port.l = p.port.l;
      ANT.port.de = p.port.de; ANT.port.a = p.port.a;
    }
    CON.sel = -1;
    CON.courant = null;
    if(typeof conAppliquer === "function") conAppliquer(false);
    const bouts = [];
    if(p.els.length) bouts.push(p.els.length + " forme(s) posée(s)");
    if(p.remplacer && !p.els.length) bouts.push("dessin effacé");
    if(p.carte) bouts.push("carte redimensionnée");
    if(p.port) bouts.push("port posé");
    return bouts.join(", ");
  }

  /* Revenir sur ce qui a été appliqué. Les réglages, les cotes et la
     géométrie libre se défont ici ; un balayage armé, lui, se désarme d'une
     case dans l'étape « Le calcul », et un motif redessiné se reprend par
     « Annuler » du mode conception, qui tient déjà son historique. */
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
    }else if(p.type === "formes" && p.avant){
      CON.elements = JSON.parse(JSON.stringify(p.avant.elements));
      CON.carte.L = p.avant.carte.L;
      CON.carte.W = p.avant.carte.W;
      CON.gabarit = p.avant.gabarit;
      CON.calcul  = p.avant.calcul;
      CON.sel = -1;
      CON.courant = null;
      p.avant.ports.forEach(function(a, i){
        const q = ANT.ports[i];
        if(!q) return;
        q.pose = a.pose; q.x = a.x; q.y = a.y; q.w = a.w; q.l = a.l;
        q.dir = a.dir; q.de = a.de; q.a = a.a;
      });
      if(typeof conAppliquer === "function") conAppliquer(false);
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

  /* RELIRE UN BALAYAGE TERMINÉ. Le meilleur point d'une famille de courbes
     n'est un optimum que s'il est ENCADRÉ : au bord de la plage, c'est
     seulement le meilleur des points essayés, et le vrai est au-delà. C'est
     exactement ce que le croisement g × y₀ a montré (A-FAIRE.md § 1) — le
     meilleur point était un coin du tableau, et personne ne l'aurait lu sans
     regarder les bornes une à une. La règle le fait, axe par axe.

     Elle LIT et n'écrit rien : pas de carte d'action. Prolonger une plage est
     une décision de calcul — dix simulations de plus — et elle se prend dans
     l'étape « Le calcul », devis en main.

     Les points sont lus dans `lignes`, le tableau que le serveur assemble
     (`_assembler`, openems_run.py) ; à défaut, dans `points[].resultat`.

     LE CRITÈRE EST LE S₁₁ À LA FRÉQUENCE VISÉE, quand une cible est posée et
     que les courbes sont là. Le S₁₁ minimal, celui du tableau, désigne le
     creux le plus profond OÙ QU'IL TOMBE : sur le croisement L × y₀, c'était
     −33,9 dB… à 2,40 GHz pour 2,45 visés (A-FAIRE.md § 1). Sans courbes ou
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
    /* Voir A-FAIRE.md § 1 : le gabarit corrige désormais sa longueur et sa
       résistance de bord par la mesure (`patchCorrLongueur`,
       `patchCorrRbord`, 22-antennes.js). La seconde n'est mesurée que sur
       DEUX stratifiés, FR-4 et RO4350B ; entre eux et au-delà, c'est une
       interpolation en tan δ, et l'encastrement qui en sort se balaye. */
    if(con && CON.gabarit === "patch" && !CON.gabaritTouche.y0){
      const y0 = +((CON.gabaritP || {}).y0);
      const df = (typeof conSubstrat === "function") ? conSubstrat().df : NaN;
      const mesure = isFinite(df) && (Math.abs(df - 0.02) < 0.002 ||
                                       Math.abs(df - 0.0037) < 0.0005);
      if(isFinite(y0) && y0 > 0 && !mesure)
        dire("attention", "L'encastrement du patch est interpolé, pas mesuré",
             "y0 vaut " + nb(y0, 2) + " mm. Le gabarit corrige la résistance "+
             "de bord du modèle de cavité par la mesure, mais celle-ci n'a été "+
             "faite que sur FR-4 (tan δ 0,02) et RO4350B (tan δ 0,0037) ; ce "+
             "stratifié (tan δ " + nb(df, 4) + ") est entre les deux ou au-delà. "+
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




  return {
    CHAMPS, FORMES_MAX, PTS_MAX,
    resoudre, valider, valeurTexte, proposition, appliquer, annuler, controles
  };
})();
