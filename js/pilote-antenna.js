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

/* Ce qu'une carte peut toucher : les racines de IA_CHAMPS, le balayage, et le mode conception. */
function piloteAntennaEtat(){
  const con = typeof CON === "undefined" ? null :
    {gabaritP:CON.gabaritP, gabaritTouche:CON.gabaritTouche, elements:CON.elements, carte:CON.carte,
     gabarit:CON.gabarit, calcul:CON.calcul};
  return JSON.stringify({bande:ANT.bande, boite:ANT.boite, maillage:ANT.maillage, arret:ANT.arret,
                         pertes:ANT.pertes, ports:ANT.ports, balayage:ANT.balayage, con:con});
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
    return {titre:p.titre || ("Carte " + p.type), details:lignes.join("\n")};
  },
  appliquer:function(a){
    // Recalculée au clic : l'état a pu changer depuis que la carte est affichée
    const p = piloteAntennaProposition(a.carte);
    const balayage = JSON.parse(JSON.stringify(ANT.balayage));
    window.iaAppliquer(p);
    return {p:p, balayage:balayage};
  },
  annuler:function(_a, jeton){
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
}
