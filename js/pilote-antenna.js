/* =============================================================================
   Branchement du canal de pilotage (js/pilote.js, copie de web_suite) dans
   WEB_ANTENNA : la page se declare, avec le projet ouvert et la vue 2D, et offre
   « antenna_proposer » — la carte de l'assistant (reglages, cotes, balayage,
   formes), proposee dans le panneau « Claude » et appliquee au clic.

   ANNULER, SEULEMENT SI RIEN N'A BOUGE. iaAnnuler remet l'avant sans regarder
   ce qui s'est passe depuis, et ne sait pas defaire un balayage. Le panneau
   compare donc l'etat ci-dessous avant d'annuler, et l'adaptateur garde
   lui-meme ANT.balayage.
   Banc : node test/banc-interface.js (section 10).
   ========================================================================== */

/* Ce qu'une carte peut toucher : les racines de IA_CHAMPS (lues dans la liste blanche elle-meme,
   pour qu'un champ ajoute plus tard soit couvert d'office), le balayage, et ce que les cartes
   cotes et formes changent du mode conception. */
function piloteAntennaEtat(){
  const ant = {balayage:ANT.balayage}, con = {};
  const aCon = typeof CON !== "undefined";
  for(const k of Object.keys(window.IA_CHAMPS || {})){
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
  const p = window.iaProposition(carte);
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
    window.iaAppliquer(p);
    return {p:p, balayage:balayage};
  },
  annuler:function(_a, jeton){
    if(jeton.p.type === "cotes" && jeton.p.tracer)
      // iaAnnuler remet les cotes, pas le motif redessiné : refuser plutôt qu'annuler à moitié
      throw new Error("le motif a été redessiné : utilise l'Annuler du mode conception.");
    if(jeton.p.type === "balayage"){
      for(const k of Object.keys(ANT.balayage)) delete ANT.balayage[k];
      Object.assign(ANT.balayage, jeton.balayage);
      if(typeof antMaj === "function") antMaj(true);
    }else{
      window.iaAnnuler(jeton.p);
    }
  },
  etat:piloteAntennaEtat,
};

function piloteAntenna(){
  if(typeof Pilote === "undefined") return;
  Pilote.declarer({page:"antenna", projet:() => (typeof PRJ !== "undefined" ? PRJ.nom : "")});
  Pilote.capture(() => document.getElementById("carte"));
  Pilote.commande("antenna_proposer", PILOTE_ANTENNA);
  // les lectures (js/29-lecture-antenna.js) : rien d'écrit, rien de lancé
  Pilote.commande("antenna_lire", {executer:async a => LECTURE_ANTENNA.lire(a.quoi, a)});
}
