/* =============================================================================
   Branchement du canal de pilotage (js/pilote.js, copie de web_suite) dans
   WEB_ANTENNA : la page se declare, avec le projet ouvert et la vue 2D, et offre
   « antenna_proposer » — la carte de l'assistant (reglages, cotes, balayage,
   formes), proposee dans le panneau « Claude » et appliquee au clic.

   ANNULER, SEULEMENT SI RIEN N'A BOUGE. CARTES_ANTENNA.annuler remet l'avant sans regarder
   ce qui s'est passe depuis, et ne sait pas defaire un balayage. Le panneau
   compare donc l'etat ci-dessous avant d'annuler, et l'adaptateur garde
   lui-meme ANT.balayage.
   Banc : node test/banc-interface.js (section 10).
   ========================================================================== */

/* Ce qu'une carte peut toucher : les racines de CARTES_ANTENNA.CHAMPS (lues dans la liste blanche elle-meme,
   pour qu'un champ ajoute plus tard soit couvert d'office), le balayage, et ce que les cartes
   cotes et formes changent du mode conception. */
function piloteAntennaEtat(){
  const ant = {balayage:ANT.balayage}, con = {};
  const aCon = typeof CON !== "undefined";
  for(const k of Object.keys(typeof CARTES_ANTENNA !== "undefined" ? CARTES_ANTENNA.CHAMPS : {})){
    const b = k.split(".");
    if(b[0] === "con"){ if(aCon) con[b[1]] = CON[b[1]]; }
    else ant[b[0]] = ANT[b[0]];
  }
  if(aCon) for(const k of ["gabaritP", "gabaritTouche", "elements", "gabarit", "calcul"]) con[k] = CON[k];
  return JSON.stringify({ant:ant, con:aCon ? con : null});
}

function piloteAntennaAttendu(p){
  return p.lignes.map(l => [l.chemin, l.apres]);
}

function piloteAntennaProposition(carte){
  const p = CARTES_ANTENNA.proposition(carte);
  if(!p || !p.lignes || !p.lignes.length){
    const refus = p && p.refus && p.refus.length ? " : " + p.refus.join(" ; ") : ".";
    throw new Error("Rien d'applicable dans cette carte" + refus);
  }
  return p;
}

const PILOTE_ANTENNA = {
  ecriture:true,
  proposer:function(a){
    const p = piloteAntennaProposition(a.carte);
    const lignes = p.lignes.map(l => (l.nom || l.chemin) + " : " + String(l.avant) + " → " + String(l.apres));
    if(p.refus && p.refus.length) lignes.push("Refusé : " + p.refus.join(" ; "));
    return {titre:p.titre || ("Carte " + p.type), details:lignes.join("\n"), attendu:piloteAntennaAttendu(p)};
  },
  appliquer:function(a, prop){
    // Recalculée au clic : si elle ne vise plus la même chose que la carte affichée (« port. »
    // suit le port courant), on refuse plutôt que d'écrire ce que l'utilisateur n'a pas vu
    const p = piloteAntennaProposition(a.carte);
    if(prop && prop.attendu && JSON.stringify(piloteAntennaAttendu(p)) !== JSON.stringify(prop.attendu))
      throw new Error("La carte a changé depuis son affichage (port ou réglage courant) : redemande-la.");
    const balayage = JSON.parse(JSON.stringify(ANT.balayage));
    CARTES_ANTENNA.appliquer(p);
    return {p:p, balayage:balayage};
  },
  annuler:function(_a, jeton){
    if(jeton.p.type === "cotes" && jeton.p.tracer)
      // CARTES_ANTENNA.annuler remet les cotes, pas le motif redessiné : refuser plutôt qu'annuler à moitié
      throw new Error("le motif a été redessiné : utilise l'Annuler du mode conception.");
    if(jeton.p.type === "balayage"){
      for(const k of Object.keys(ANT.balayage)) delete ANT.balayage[k];
      Object.assign(ANT.balayage, jeton.balayage);
      if(typeof antMaj === "function") antMaj(true);
    }else{
      CARTES_ANTENNA.annuler(jeton.p);
    }
  },
  etat:piloteAntennaEtat,
};

/* antenna_vue : la vue seulement, sans toucher au projet ni aux préférences. Tout est vérifié
   avant le premier changement. La capture suit la toile choisie (carte 2D, vue 3D, courbes). */
let PILOTE_COURBE = false;          // capturer les courbes plutôt que la vue (2D ou 3D, celle qui est affichée)

function piloteAntennaToile(){
  if(PILOTE_COURBE && document.getElementById("courbe")) return document.getElementById("courbe");
  if(ANT.vue === "3d"){
    // la toile WebGL n'a pas preserveDrawingBuffer : un rendu juste avant, pilote.js la copie aussitôt
    if(typeof ant3dDessiner === "function") ant3dDessiner();
    return document.getElementById("vue3d");
  }
  return document.getElementById("carte");
}

/* Un panneau montré et déplié, sans enregistrer la disposition (wsShow passerait par wsSave). */
function piloteAntennaPanneau(id){
  if(wsPlaceOf(id) === "hidden"){
    const p = WS.panels[id], cible = WS_DOCKS.indexOf(p.last) >= 0 ? p.last : "dockR";
    wsPluck(id); WS.order[cible].push(id);
  }
  WS.panels[id].collapsed = false;
  wsApply(false);
}

function piloteAntennaVue(a){
  const faire = [], dit = [];
  let vue = ANT.vue, toile = null, panneau = null;
  if(a.vue != null){
    if(a.vue !== "2d" && a.vue !== "3d") throw new Error("« vue » : 2d ou 3d.");
    vue = a.vue; toile = a.vue;
    faire.push(() => antVuePoser(a.vue)); dit.push("vue " + a.vue.toUpperCase());
  }
  if(a.maillage != null){
    if(typeof a.maillage !== "boolean") throw new Error("« maillage » : true ou false.");
    faire.push(() => antBasculerVueMaillage(a.maillage)); dit.push("maillage " + (a.maillage ? "montré" : "caché"));
  }
  if(a.ajuster){
    if(vue !== "2d") throw new Error("« ajuster » vaut pour la vue 2D.");
    faire.push(() => fit()); dit.push("vue ajustée");
  }
  let point = null;
  if(a.point_balayage != null){
    const b = antBal();
    if(!b) throw new Error("« point_balayage » : aucun balayage terminé.");
    if(!Number.isInteger(a.point_balayage) || a.point_balayage < 1 || a.point_balayage > b.points.length)
      throw new Error("« point_balayage » : de 1 à " + b.points.length + ".");
    point = b.points[a.point_balayage - 1].resultat;
    // comme un clic sur la ligne du tableau : on quitte l'onglet « bal » pour voir le point
    faire.push(() => { ANT_BAL_POINT = a.point_balayage - 1; if(ANT_ONGLET === "bal") ANT_ONGLET = "s11"; antResultatsRendre(); });
    dit.push("point " + a.point_balayage + " du balayage");
  }
  if(a.onglet != null){
    const o = ANT_ONGLETS.find(x => x.id === a.onglet);
    if(!o) throw new Error("resultats « " + a.onglet + " » inconnu : " + ANT_ONGLETS.map(x => x.id).join(", ") + ".");
    const r = point || antRes();
    if(!r) throw new Error("Pas de résultat dans la page : lance un calcul depuis la page.");
    if((o.id === "bal" && !antBal()) || (o.id === "ts" && !(typeof antTs === "function" && antTs())) ||
       (o.id === "s21" && !r.couplages) || (o.id === "ff" && !r.nf2ff))
      throw new Error("resultats « " + o.id + " » sans objet pour ce résultat.");
    faire.push(() => { ANT_ONGLET = o.id; antResultatsRendre(); });
    dit.push(() => "onglet " + (ANT_ONGLETS.find(x => x.id === ANT_ONGLET) || o).titre);   // celui que la page affiche vraiment
  }
  if(a.etape != null){
    if(!Number.isInteger(a.etape) || a.etape < 1 || a.etape > ANT_ETAPES.length)
      throw new Error("« etape » : de 1 à " + ANT_ETAPES.length + " (" + ANT_ETAPES.map(e => e.id).join(", ") + ").");
    faire.push(() => { ANT.etape = a.etape - 1; antAssistantRendre(true); }); dit.push("étape " + ANT_ETAPES[a.etape - 1].id);
  }
  if(a.panneau != null){
    if(typeof a.panneau !== "string" || !Object.prototype.hasOwnProperty.call(WS.panels, a.panneau))
      throw new Error("panneau « " + a.panneau + " » inconnu : " + Object.keys(WS.panels).join(", ") + ".");
    panneau = a.panneau;
  }
  if(a.toile != null){
    if(!["carte", "3d", "courbe"].includes(a.toile)) throw new Error("« toile » : carte, 3d ou courbe.");
    if(a.toile === "3d" && vue !== "3d") throw new Error("« toile » 3d : passe d'abord en vue 3D (vue: 3d).");
    if(a.toile === "courbe" && !antRes()) throw new Error("« toile » courbe : pas de résultat dans la page.");
    toile = a.toile;
    // les courbes cachées ne se capturent pas : leur panneau est montré d'abord
    if(a.toile === "courbe" && (wsPlaceOf("resultats") === "hidden" || WS.panels.resultats.collapsed)) panneau = panneau || "resultats";
  }
  if(panneau){ const id = panneau; faire.push(() => piloteAntennaPanneau(id)); dit.push("panneau " + id); }
  if(!faire.length && !toile) throw new Error("Rien à faire : vue, maillage, ajuster, onglet, point_balayage, etape, panneau ou toile.");
  faire.forEach(f => f());
  if(toile){ PILOTE_COURBE = toile === "courbe"; dit.push("capture : " + (PILOTE_COURBE ? "courbes" : "vue " + ANT.vue.toUpperCase())); }
  return "Vue : " + dit.map(d => typeof d === "function" ? d() : d).join(" ; ") + ".";
}

function piloteAntenna(){
  if(typeof Pilote === "undefined") return;
  Pilote.declarer({page:"antenna", projet:() => (typeof PRJ !== "undefined" ? PRJ.nom : "")});
  Pilote.capture(piloteAntennaToile);
  Pilote.commande("antenna_proposer", PILOTE_ANTENNA);
  // les lectures (js/29-lecture-antenna.js) : rien d'écrit, rien de lancé
  Pilote.commande("antenna_lire", {executer:async a => LECTURE_ANTENNA.lire(a.quoi, a)});
  Pilote.commande("antenna_vue", {executer:async a => piloteAntennaVue(a)});
}
