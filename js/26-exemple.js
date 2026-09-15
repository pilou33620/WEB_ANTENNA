"use strict";
/* =============================================================================
   Antenne openEMS — 26-exemple.js
   Un bouton, un cas connu, toute la chaîne d'un coup.

   À QUOI SERT UN EXEMPLE DANS UN OUTIL QUI SAIT DÉJÀ DESSINER. Le mode
   conception demande une dizaine de décisions avant qu'il y ait quoi que ce
   soit à simuler : l'empilage, la fréquence, le gabarit, le cuivre retenu, le
   port, la bande, l'arrêt. Chacune est légitime quand on conçoit une antenne ;
   aucune ne l'est quand on veut seulement savoir si le serveur répond, si
   openEMS est trouvé, si le maillage sort, si la courbe revient. Ce fichier
   pose donc en UN clic un cas complet et déjà réglé : un patch rectangulaire à
   2,45 GHz sur le FR-4 d'usine, alimenté par une ligne encastrée.

   CE QU'IL VÉRIFIE : L'INSTALLATION, PAS L'ANTENNE. Ce qu'on regarde après
   avoir pressé « Lancer », c'est que les six maillons tiennent — le document
   est accepté et chiffré, le script Python s'écrit, openEMS démarre, le
   journal défile, le S₁₁ et l'impédance reviennent, le diagramme de
   rayonnement aussi. Six choses qui marchent, ou celle qui casse, et son
   message. Ce que VALENT les chiffres est une autre question, et elle se pose
   au gabarit et au mailleur, pas à ce bouton — un gabarit tombe déjà à ±5 %
   de la résonance de son plein droit (voir l'en-tête de 22-antennes.js).

   CE FICHIER N'INVENTE AUCUNE GÉOMÉTRIE. Il appelle le gabarit patch de
   22-antennes.js, c'est-à-dire exactement ce que fait le panneau de
   conception : un exemple qui passerait par un chemin à lui ne prouverait
   rien sur le chemin que tout le monde emprunte.
   ============================================================================= */

/* Les réglages de l'exemple, réunis ici pour qu'on les lise d'un coup.

   ILS VALENT CEUX D'USINE, ET C'EST VOLONTAIRE. La tentation est d'alléger
   l'arrêt pour que l'essai rende la main plus vite ; openEMS la refuse, et il
   le dit lui-même quand on essaie : « max. number of timesteps is smaller than
   three times the excitation ». S'arrêter avant la fin de l'impulsion ne rend
   pas une mesure mais une troncature, et un essai qui va deux fois plus vite
   sans rien prouver ne fait pas gagner de temps.

   On REPOSE ces valeurs plutôt que de les laisser telles qu'elles sont : un
   exemple qui hériterait d'un arrêt à 5 000 pas saisi dix minutes plus tôt ne
   serait plus l'exemple, et son résultat n'apprendrait rien sur
   l'installation. Même raison pour le maillage : zéro veut dire « au mailleur
   de décider », et c'est précisément le mailleur qu'on veut éprouver — il
   descend ici à 0,78 mm, le quart de la largeur de la ligne d'alimentation,
   parce que λ/20 seul (2,57 mm) ne fait pas résonner ce patch. */
const EX={
  f:2.45e9,            // la bande ISM : le cas que tout le monde reconnaît
  energie:-40,         // dB d'énergie résiduelle : le seuil d'usine
  /* LE GARDE-FOU EST HAUT, ET C'EST L'ÉNERGIE QUI DOIT ARRÊTER. Un patch est
     résonant : il se vide lentement, et sur le maillage fin que sa ligne
     d'alimentation impose, les 12 ns qu'il lui faut font une quarantaine de
     milliers de pas de temps. Le réglage d'usine, 30 000, couperait la
     descente juste avant la fin — et une transformée sur une descente coupée
     n'est pas une mesure. On laisse donc de la marge : ce qui arrête, c'est
     les −40 dB, pas le compteur. */
  nmax:60000
};

/* Poser l'exemple. Rien de plus que la suite des gestes qu'on ferait à la
   main, dans l'ordre où le panneau les propose. */
function exPoser(){
  /* Le dessin en cours serait effacé par le gabarit — conGabaritDebut() vide
     CON.elements. On le dit avant, et pas après : un travail perdu ne se
     rattrape pas, et ce bouton-ci est à deux centimètres de « Concevoir ».
     Le dessin SURVIT À LA SORTIE DU MODE — quitter la conception ne l'efface
     pas —, on ne regarde donc pas si le mode est actif, seulement s'il y a
     quelque chose à perdre. */
  if(CON.elements.length&&
     !window.confirm("L'exemple remplace le dessin en cours par un patch "+
                     "2,45 GHz. Continuer ?"))return;

  /* 1. Le mode conception, et l'empilage d'usine — deux faces, FR-4 1,6 mm.
        On le REPOSE même si le mode était déjà actif : un exemple qui
        hériterait d'un empilage à quatre couches saisi dix minutes plus tôt ne
        serait plus l'exemple. */
  conEntrer();
  CON.pile=conPileDefaut();
  CON.coucheActive=conPremierCuivre();

  /* 2. La fréquence visée, puis le gabarit. Le gabarit se charge du reste :
        il dessine le patch et sa ligne, règle la bande à ±15 %, pose le port
        entre le cuivre du dessus et le plan de masse, et demande le champ
        lointain. */
  CON.fcible=EX.f;
  conGabaritPoser("patch");

  /* 3. L'arrêt et le maillage, reposés — voir EX plus haut. */
  ANT.arret.energie=EX.energie;
  ANT.arret.nmax=EX.nmax;
  ANT.maillage.res_air=0;
  ANT.maillage.res_die=0;

  /* 4. On s'arrête sur l'étape « Le calcul » : c'est là qu'est le bouton qui
        reste à presser, et c'est là que se lisent les chiffres qui disent ce
        que la simulation va coûter — cellules, mémoire, durée attendue. */
  ANT.etape=ANT_ETAPES.findIndex(e=>e.id==="calcul");
  if(typeof wsShow==="function")wsShow("assistant");
  antMaj(true);
  antAssistantRendre();

  hint("Exemple posé : patch 2,45 GHz sur FR-4 1,6 mm, port au bout de la "+
       "ligne, bande 2,08–2,82 GHz, arrêt à −40 dB. Il ne reste qu'à presser "+
       "▶ Lancer : ce qu'on vérifie, c'est que le journal défile et que les "+
       "courbes reviennent.");
}

/* ==========================================================================
   Les branchements
   ========================================================================== */
window.addEventListener("DOMContentLoaded",function(){
  ["bExemple","bExemple2"].forEach(function(id){
    const b=document.getElementById(id);
    if(b)b.onclick=exPoser;
  });
});
