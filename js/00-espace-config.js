"use strict";
/* =============================================================================
   Antenne openEMS — 00-espace-config.js
   Paramétrage des panneaux détachables (js/90-workspace.js).
   Chargé AVANT lui ; il ne contient que la clé de stockage local et la
   disposition d'usine des panneaux.

   LA DISPOSITION D'USINE DIT L'ORDRE DU TRAVAIL. L'assistant occupe la
   colonne de droite sur toute sa hauteur : c'est lui qu'on suit, du premier
   clic au lancement, et il ne se replie pas. Les couches restent à gauche,
   comme dans la visionneuse — on y désigne le cuivre qui part au solveur.
   Les résultats et le journal sont en bas, repliés : ils n'ont rien à dire
   tant qu'aucun calcul n'a tourné, et prendre de la place avant d'avoir
   quelque chose à montrer est la première façon de rendre un écran illisible.
   ============================================================================= */
const WS_CONFIG={
  key:"openems-antenne.espace-travail.v1",
  layout:{
    docks:{dockL:210,dockR:400,dockB:200},
    order:{dockL:["couches"],
           dockR:["assistant"],
           dockB:["resultats","journal"]},
    /* Déclarés mais hors des docks : ils démarrent masqués et le menu
       « Espace de travail » les fait apparaître. Ce sont les panneaux de la
       visionneuse, utiles pour explorer une carte qu'on ne connaît pas —
       rarement nécessaires quand on sait déjà quelle antenne on simule. */
    /* La conception est masquée d'usine : la plupart des séances partent
       d'un fichier, et un panneau qui ÉCRIT la carte n'a rien à faire dans
       le dock tant qu'on ne l'a pas demandé. Le bouton « Concevoir » de la
       barre d'outils est ce qui le rend trouvable. */
    /* Le projet est masqué d'usine comme la conception, et pour la même
       raison : son bouton de barre d'outils le rend trouvable, et il n'a
       rien à occuper dans un dock pendant qu'on règle une simulation. */
    /* L'IA est masquée d'usine, comme la conception et le projet : c'est un
       relecteur qu'on appelle, pas une étape du travail. Son bouton de barre
       d'outils — et Alt+I — sont ce qui la rendent trouvable, et un panneau
       qui occuperait le dock de droite à côté de l'assistant laisserait
       croire qu'il faut passer par lui, alors que l'outil marche entièrement
       sans. Ses cotes sont celles du même panneau dans WEB_CAO : c'est la
       même section, on lui garde la même place. */
    /* Les champs sont masqués d'usine, et c'est le seul choix honnête : le
       panneau n'a RIEN à montrer tant qu'aucun calcul n'a enregistré de
       champ, et cela suppose une case cochée avant de lancer. Le bouton
       « Voir les champs », à l'étape « Le calcul » et sous les résultats,
       le fait apparaître au moment exact où il a quelque chose à dire. */
    hidden:["projet","conception","ia","champs",
            "carte","nets","composants","detail"],
    panels:{
      assistant :{grow:2  ,collapsed:false,x:260,y:120,w:440,h:640,last:"dockR"},
      ia        :{grow:1.5,collapsed:false,x:250,y:140,w:440,h:580,last:"dockR"},
      conception:{grow:2  ,collapsed:false,x:200,y:100,w:460,h:700,last:"dockR"},
      projet    :{grow:1.4,collapsed:false,x:240,y:120,w:460,h:560,last:"dockR"},
      couches   :{grow:1  ,collapsed:false,x:80 ,y:140,w:250,h:520,last:"dockL"},
      resultats :{grow:1.4,collapsed:false,x:220,y:220,w:640,h:400,last:"dockB"},
      journal   :{grow:1  ,collapsed:true ,x:260,y:260,w:640,h:340,last:"dockB"},
      /* Il s'ouvre DÉTACHÉ, et grand : une carte de champ se regarde, et un
         bandeau de deux cents pixels au fond d'un dock ne se regarde pas.
         `last` reste le dock du bas pour celui qui l'y rattachera. */
      champs    :{grow:2  ,collapsed:false,x:180,y:90 ,w:720,h:620,last:"dockB"},
      carte     :{grow:1  ,collapsed:false,x:150,y:140,w:340,h:420,last:"dockR"},
      detail    :{grow:1  ,collapsed:false,x:190,y:200,w:340,h:380,last:"dockR"},
      composants:{grow:1  ,collapsed:false,x:220,y:260,w:520,h:320,last:"dockB"},
      nets      :{grow:1  ,collapsed:false,x:260,y:300,w:520,h:320,last:"dockB"}
    }
  }
};
