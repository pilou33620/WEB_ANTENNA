/* =============================================================================
   Branchement du canal de pilotage (js/pilote.js, copie de web_suite) dans
   WEB_ANTENNA : la page se declare, avec le projet ouvert et la vue 2D, et offre
   ses lectures et le reglage de sa vue. Ecrire dans la page se fait par des gestes.
   Banc : node test/banc-interface.js (section 10).
   ========================================================================== */

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

/* Ce qu'antenna_vue a changé et que l'utilisateur n'a pas repris depuis : ni l'étape de
   l'assistant ni un panneau montré ne partent avec un enregistrement (projet, disposition),
   tant qu'ils sont tels que Claude les a laissés. L'écran, lui, garde ce que Claude a montré. */
let PILOTE_ETAPE = null;                    // {posee, avant} : l'étape posée par Claude, celle d'avant
const PILOTE_PANNEAUX = new Map();          // id → {cache, replie, place} : le panneau d'avant, et où Claude l'a mis
function piloteAntennaEtape(){                // ce que prjAntenne enregistre (28-projet.js)
  return PILOTE_ETAPE && ANT.etape === PILOTE_ETAPE.posee ? PILOTE_ETAPE.avant : ANT.etape;
}
function piloteAntennaEtapeOublier(){ PILOTE_ETAPE = null; }   // l'utilisateur a choisi son étape, ou ouvert un projet
function piloteAntennaDisposition(ws){       // ce que wsSave enregistre (90-workspace.js)
  // un panneau que l'utilisateur a depuis replié, fermé ou déplacé est le sien
  for(const [id, p] of PILOTE_PANNEAUX) if(wsPlaceOf(id) !== p.place || ws.panels[id].collapsed) PILOTE_PANNEAUX.delete(id);
  if(!PILOTE_PANNEAUX.size) return ws;
  const copie = JSON.parse(JSON.stringify(ws));
  for(const [id, p] of PILOTE_PANNEAUX){
    copie.panels[id].collapsed = p.replie;
    if(p.cache){
      for(const k of WS_DOCKS){ const i = copie.order[k].indexOf(id); if(i >= 0) copie.order[k].splice(i, 1); }
      copie.hidden.push(id);
    }
  }
  return copie;
}

/* Un panneau montré et déplié, sans enregistrer la disposition (wsShow passerait par wsSave). */
function piloteAntennaPanneau(id){
  const avant = {cache:wsPlaceOf(id) === "hidden", replie:!!WS.panels[id].collapsed};
  if(wsPlaceOf(id) === "hidden"){
    const p = WS.panels[id], cible = WS_DOCKS.indexOf(p.last) >= 0 ? p.last : "dockR";
    wsPluck(id); WS.order[cible].push(id);
  }
  WS.panels[id].collapsed = false;
  wsApply(false);
  const deja = PILOTE_PANNEAUX.get(id);
  if(deja) deja.place = wsPlaceOf(id);
  else if(avant.cache || avant.replie) PILOTE_PANNEAUX.set(id, Object.assign(avant, {place:wsPlaceOf(id)}));
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
    faire.push(() => {
      const avant = piloteAntennaEtape();
      ANT.etape = a.etape - 1;
      PILOTE_ETAPE = {posee:ANT.etape, avant};
      antAssistantRendre(true);
    });
    dit.push("étape " + ANT_ETAPES[a.etape - 1].id);
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
  // les lectures (js/29-lecture-antenna.js) : rien d'écrit, rien de lancé
  Pilote.commande("antenna_lire", {executer:async a => LECTURE_ANTENNA.lire(a.quoi, a)});
  Pilote.commande("antenna_vue", {executer:async a => piloteAntennaVue(a)});
}
