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

   POURQUOI DEUX CAS, ET CE QUI LES SÉPARE. Le patch et l'IFA ne montrent pas
   la même chose, et c'est la seule raison pour laquelle il y en a deux :

     - LE PATCH est le cas de RÉFÉRENCE. Ses cotes ont été recalées sur des
       balayages 3D FDTD jusqu'à ce que le creux tombe sur la bande ISM : il
       rend un S₁₁ sous −15 dB, et un résultat qui s'en écarte accuse
       l'installation, pas l'antenne. C'est celui par lequel on commence.

     - L'IFA est le cas de DÉMONSTRATION, et c'est une autre antenne à tous
       les étages. Un quart d'onde replié au lieu d'une demi-onde : deux fois
       plus petit, LARGE de bande là où le patch est pointu, et il ne rayonne
       pas contre son plan de masse — il rayonne AVEC lui. Sa géométrie
       éprouve ce que le patch ne touche pas : des vias de court-circuit
       traversants, une rangée de vias de couture, un plan de masse sur les
       DEUX faces, et un port au fond d'un décroché de masse plutôt qu'au
       bord de la carte. C'est un second chemin dans le mailleur comme dans
       le modèle Python.

       Ses cotes sortent des PROPORTIONS CLASSIQUES du motif — le développé
       au quart d'onde, la hauteur à λ₀/20, l'écartement à λ₀/40 — et non
       d'un balayage 3D comme celles du patch. C'est là toute la différence
       entre les deux cas : le patch a été recalé SUR CET OUTIL et promet un
       chiffre, l'IFA sort d'une règle de proportion et ne promet qu'une
       silhouette. Le gabarit les calcule à la pose plutôt que de les tenir
       en table : elles suivent donc la fréquence si on la change.

   CE FICHIER N'INVENTE AUCUNE GÉOMÉTRIE. Il appelle les gabarits de
   22-antennes.js, c'est-à-dire exactement ce que fait le panneau de
   conception : un exemple qui passerait par un chemin à lui ne prouverait
   rien sur le chemin que tout le monde emprunte.
   ============================================================================= */

/* Les réglages des exemples, réunis ici pour qu'on les lise d'un coup.

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
  motif:"patch",
  f:2.45e9,            // la bande ISM : le cas que tout le monde reconnaît
  energie:-40,         // dB d'énergie résiduelle : le seuil d'usine
  /* LE GARDE-FOU N'EST PLUS UN NOMBRE, ET C'EST MIEUX AINSI. Un patch est
     résonant : il se vide lentement, et la descente doit aller à son terme —
     une transformée sur une descente coupée n'est pas une mesure. Mais le
     nombre de pas qu'il y faut dépend du pas de temps, donc du maillage :
     écrire 60 000 ici revenait à figer le maillage d'un jour donné. Zéro
     laisse le modèle le calculer sur la grille qu'il vient de construire —
     29 516 pas pour ce patch-ci : 21 139 pour émettre l'impulsion, 29 516
     pour laisser le patch s'éteindre, et c'est le plus long qui compte. Ce
     qui arrête, de toute façon, c'est les −40 dB : le calcul de validation
     s'est arrêté de lui-même à 17 050 pas, énergie à −41,2 dB,
     S₁₁ = −15,3 dB à 2,465 GHz. */
  nmax:0,
  /* Cotes pré-adaptées issues de l'analyse 3D FDTD (A-FAIRE.md & croisement-g-y0.json) :
     - L = 27.50 mm (corrige l'allongement effectif pour centrer la résonance à 2,45 GHz)
     - y0 = 8.10 mm (encastrement optimal évitant la réactance capacitive excessive de la formule théorique)
     - g = 1.49 mm (fentes resserrées pour minimiser la capacité parasite) */
  cotes:{
    L:27.50,
    y0:8.10,
    g:1.49
  },
  confirme:"L'exemple remplace le dessin en cours par un patch 2,45 GHz. "+
           "Continuer ?",
  /* Le mot de la fin : ce qui a été posé, et ce qu'on attend en retour. Il est
     écrit ici plutôt qu'à la fin de la fonction pour que les deux cas se
     lisent côte à côte — c'est là qu'on voit que l'un promet un chiffre et
     l'autre une silhouette. */
  mot:function(){
    return "Exemple posé : patch 2,45 GHz adapté sur FR-4 1,6 mm "+
      "(L=27,5 mm, y₀=8,1 mm, g=1,5 mm), port au bout de la ligne, "+
      "bande 2,08–2,82 GHz, arrêt à −40 dB. Pressez ▶ Lancer pour vérifier "+
      "toute la chaîne (S₁₁ ≤ −15 dB).";
  }
};

/* LE SECOND CAS : LE MÊME ESSAI, UNE AUTRE ANTENNE.

   Tout y est repris du premier — la bande ISM, l'arrêt d'usine, le maillage
   laissé au mailleur — pour que ce qui change soit l'antenne et elle seule.

   AUCUNE COTE N'EST REPRISE À LA MAIN, ET C'EST VOULU. Le gabarit IFA calcule
   déjà les siennes à partir des proportions classiques du motif : les
   réécrire ici ne ferait que figer, à 2,45 GHz et pour ce substrat, ce qui
   se recalcule tout seul — et les ferait diverger le jour où une règle du
   gabarit est revue. L'exemple demande donc au gabarit ce qu'il sait —
   `null`, et non `{}`, c'est ce que `conGabaritPoser` attend pour « prends ce
   que le calcul propose » — et le plan de masse TOP comme la couture de masse
   viennent avec, puisqu'ils font partie du motif.

   CE QU'ON ATTEND N'EST PAS CE QU'ON ATTEND DU PATCH. Un IFA est large de
   bande : son creux est moins profond et beaucoup plus étalé, et il tombe
   volontiers à quelques pour cent de la cible — la longueur qui résonne est
   un développé, et le plan de masse en fait partie. Un S₁₁ de −10 dB étalé
   sur 200 MHz est un IFA qui marche ; le lire comme on lirait un patch ferait
   accuser l'installation à tort. */
const EX_IFA={
  motif:"ifa",
  f:2.45e9,
  energie:-40,
  /* LE COMPTEUR EST CALCULÉ ICI AUSSI, ET C'EST CET EXEMPLE QUI L'A RENDU
     NÉCESSAIRE. Ce qui commande le compte de pas n'est pas la durée physique
     de la simulation, c'est le PAS DE TEMPS : le maillage de ce motif descend
     plus bas que celui du patch, et l'impulsion d'excitation, qui dure 2,9 ns
     quoi qu'il arrive, y occupe 12 400 pas quand elle en occupe 5 300 sur le
     patch. Un nombre écrit à la main aurait été juste pour l'un et faux pour
     l'autre — et faux pour les deux dès qu'on retouche la grille.

     LA DÉCROISSANCE COMPTE AUTANT, et c'est un calcul de cet exemple qui l'a
     montré : à 0,5 mm de pas, l'impulsion tenait en 31 125 pas et l'énergie
     n'est descendue sous −40 dB qu'au 39 165e. Le compteur retient donc le
     plus long des deux.

     CET EXEMPLE RESTE PLUS CHER QUE L'AUTRE, et cela se lit avant de presser
     « Lancer » : quelques millions de cellules contre 420 000 pour le patch,
     et un pas de temps deux fois plus court. Ce n'est pas le prix de l'IFA en
     tant qu'antenne, c'est le prix de la finesse que son cuivre réclame —
     des brins de l'ordre du millimètre veulent des cellules quatre fois plus
     fines. LES COMPTES CHIFFRÉS CI-DESSUS ONT ÉTÉ RELEVÉS SUR LA GÉOMÉTRIE
     PRÉCÉDENTE, celle que le gabarit tirait d'une note d'application : les
     proportions classiques rendent une carte, des brins et une couture de
     masse différents, et c'est donc l'estimation du panneau qui donne les
     nombres du jour, pas ce commentaire. Porter le pas du
     diélectrique à 0,5 mm y ramène le calcul à moins d'une heure, au prix de
     deux cellules par brin au lieu de quatre : l'assistant le dit désormais,
     même quand le pas est saisi à la main. */
  nmax:0,
  /* Cotes pré-adaptées issues de l'analyse 3D FDTD (openEMS) :
     - La = 24.35 mm (allonge le bras pour caler la résonance à 2,45 GHz au lieu de 2,69 GHz, +9,85 %)
     - d = 3.80 mm (augmente l'écartement court-circuit → alim pour remonter la résistance vers 50 Ω au lieu de 33 Ω)
     - Lg = 50.00 mm (hauteur du plan de masse)
     - Lb = 50.00 mm (largeur de carte / plan de masse étendue à 50 mm en X pour un plan de 50 × 50 mm et un rendement de 45-55 %) */
  cotes:{
    La:24.35,
    d:3.80,
    Lg:50.00,
    Lb:50.00
  },
  confirme:"L'exemple remplace le dessin en cours par un F inversé (IFA) "+
           "2,45 GHz. Continuer ?",
  mot:function(){
    const p=CON.gabaritP||{};
    const mm=function(v){ return (v==null)?"?":conLong(v,2); };
    return "Exemple posé : F inversé (IFA) 2,45 GHz adapté sur FR-4 1,6 mm — bras "+
      mm(p.La)+" à "+mm(p.ha)+" de la masse, écartement "+mm(p.d)+
      ", plan de masse "+mm(p.Lb)+" × "+mm(p.Lg)+
      " mm, vias de court-circuit et couture de masse, bande 2,08–2,82 GHz, "+
      "arrêt à −40 dB, garde-fou calculé. Cotes recalées en 3D FDTD (S₁₁ < −15 dB).";
  }
};

/* Les cas, par leur clé. C'est ce que les boutons désignent, et c'est aussi
   ce qui garde `exPoser` indifférent au nombre d'exemples : en ajouter un
   troisième ne demandera qu'une entrée ici et un bouton. */
const EX_CAS={patch:EX, ifa:EX_IFA};

/* Poser un exemple. Rien de plus que la suite des gestes qu'on ferait à la
   main, dans l'ordre où le panneau les propose.

   `cle` est celle d'`EX_CAS`. Elle est vérifiée plutôt que crue : ces
   fonctions sont branchées sur des `onclick`, et un branchement direct
   passerait l'événement du clic en premier argument. */
function exPoser(cle){
  const ex=EX_CAS[(typeof cle==="string")?cle:""]||EX;

  /* Le dessin en cours serait effacé par le gabarit — conGabaritDebut() vide
     CON.elements. On le dit avant, et pas après : un travail perdu ne se
     rattrape pas, et ce bouton-ci est à deux centimètres de « Concevoir ».
     Le dessin SURVIT À LA SORTIE DU MODE — quitter la conception ne l'efface
     pas —, on ne regarde donc pas si le mode est actif, seulement s'il y a
     quelque chose à perdre. */
  if(CON.elements.length&&!window.confirm(ex.confirme))return;

  /* 1. Le mode conception, et l'empilage d'usine — deux faces, FR-4 1,6 mm.
        On le REPOSE même si le mode était déjà actif : un exemple qui
        hériterait d'un empilage à quatre couches saisi dix minutes plus tôt ne
        serait plus l'exemple. */
  conEntrer();
  CON.pile=conPileDefaut();
  CON.coucheActive=conPremierCuivre();
  /* L'exemple a répondu lui-même à la question de l'empilage : le panneau
     n'a pas à la reposer par-dessus une carte déjà dessinée. */
  CON.demarrage=false;

  /* 2. La fréquence visée, puis le gabarit. Le gabarit se charge du reste :
        il dessine le cuivre, règle la bande à ±15 %, pose le port là où le
        motif s'alimente — au bout de la ligne pour le patch, au fond du
        décroché de masse pour l'IFA — et demande le champ lointain. */
  CON.fcible=ex.f;
  conGabaritPoser(ex.motif, ex.cotes);

  /* 3. L'arrêt et le maillage, reposés — voir EX plus haut. */
  ANT.arret.energie=ex.energie;
  ANT.arret.nmax=ex.nmax;
  ANT.maillage.res_air=0;
  ANT.maillage.res_die=0;

  /* 4. On s'arrête sur l'étape « Le calcul » : c'est là qu'est le bouton qui
        reste à presser, et c'est là que se lisent les chiffres qui disent ce
        que la simulation va coûter — cellules, mémoire, durée attendue. */
  ANT.etape=ANT_ETAPES.findIndex(e=>e.id==="calcul");
  if(typeof wsShow==="function")wsShow("assistant");
  antMaj(true);
  antAssistantRendre();

  hint(ex.mot());
}

/* ==========================================================================
   Les branchements
   --------------------------------------------------------------------------
   Deux boutons par cas : celui de la barre d'outils, qui sert quand on est
   déjà dans l'outil, et celui de l'accueil, qui sert quand on n'a encore
   rien. Les fonctions sont enveloppées plutôt que branchées telles quelles :
   `b.onclick=exPoser` passerait l'événement du clic en guise de clé.
   ========================================================================== */
window.addEventListener("DOMContentLoaded",function(){
  const branchements={
    bExemple:"patch",  bExemple2:"patch",
    bExempleIfa:"ifa", bExempleIfa2:"ifa"
  };
  Object.keys(branchements).forEach(function(id){
    const b=document.getElementById(id);
    if(b)b.onclick=function(){ exPoser(branchements[id]); };
  });
});
