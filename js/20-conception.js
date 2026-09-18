"use strict";
/* =============================================================================
   Antenne openEMS — 20-conception.js
   Le mode CONCEPTION : dessiner la carte au lieu de l'importer.

   POURQUOI CE MODE EXISTE. Le reste de l'outil part d'un fichier IPC-2581 :
   une antenne DÉJÀ routée, qu'on veut vérifier. Mais on ne route pas une
   antenne avant de savoir ce qu'elle doit mesurer, et le premier patch d'un
   projet n'existe dans aucun fichier de fabrication — il se dessine, se
   simule, se corrige, et seulement ensuite passe en CAO. Sans ce mode, l'outil
   ne sait rien faire de la page blanche : c'est exactement le moment où la
   simulation sert le plus.

   LE PARTI PRIS, ET IL COMMANDE TOUT LE RESTE. Ce module ne crée PAS un
   second chemin vers le solveur. Il fabrique un document AU MÊME FORMAT que
   celui que rend le parseur Python, et le donne à `mdlCharger()`. À partir de
   là, rien ne distingue une carte dessinée d'une carte importée : le rendu,
   la désignation du cuivre, l'assistant, la vue 3D, le maillage, le script
   exporté et le solveur travaillent sur le même objet, avec le même code.

   La conséquence pratique : tout ce que l'assistant sait refuser — port entre
   une couche et elle-même, marge d'air trop courte, permittivité absente — il
   le refuse aussi sur une carte dessinée. Un mode qui aurait eu son propre
   chemin aurait perdu ces refus en route, et ce sont eux qui font la valeur
   de l'outil.

   CE QUE CE MODULE N'EST PAS. Ce n'est pas un éditeur de CAO : pas de
   contraintes, pas de DRC, pas de netlist, pas d'empreintes de composants.
   Des surfaces de cuivre, un empilage, des matériaux — c'est-à-dire
   exactement ce qu'un solveur de champ sait lire, et rien de plus. Une carte
   dessinée ici ne se fabrique pas ; elle se simule.
   ============================================================================= */

/* ==========================================================================
   Les matériaux
   --------------------------------------------------------------------------
   DEUX NOMBRES SUFFISENT À DÉPLACER UNE RÉSONANCE DE PLUSIEURS POUR CENT, et
   ce sont les deux qu'un fichier de CAO n'exporte presque jamais : la
   permittivité relative et la tangente de pertes. Les valeurs ci-dessous sont
   celles des notices des fabricants, à la fréquence où elles sont données —
   leur tolérance réelle (±2 % sur un FR-4, ±0,05 sur un Rogers) est plus large
   que la précision affichée, et c'est pour cela que chaque valeur reste
   MODIFIABLE : le stratifié qu'on a en magasin n'est jamais tout à fait celui
   du catalogue.

   `f` dit à quelle fréquence la valeur est donnée. Ce n'est pas décoratif :
   l'εr d'un FR-4 tombe d'environ 4,5 à 1 MHz à 4,2 à 10 GHz, et prendre la
   valeur basse fréquence pour dimensionner un patch à 5 GHz place la
   résonance à côté.
   ========================================================================== */
const CON_DIELECTRIQUES=[
  {id:"fr4",       nom:"FR-4 (époxy verre)",      er:4.30, df:0.020,  f:"1 GHz",
   note:"le stratifié courant : bon marché, dispersif, et dont l'εr varie de ±2 % d'un lot à l'autre"},
  {id:"fr4hf",     nom:"FR-4 haute fréquence",    er:4.20, df:0.012,  f:"1 GHz",
   note:"résine à faible perte sur trame de verre ordinaire"},
  {id:"ro4003c",   nom:"Rogers RO4003C",          er:3.55, df:0.0027, f:"10 GHz",
   note:"hydrocarbure céramique ; se fabrique comme un FR-4"},
  {id:"ro4350b",   nom:"Rogers RO4350B",          er:3.66, df:0.0037, f:"10 GHz",
   note:"la version ignifugée du RO4003C"},
  {id:"rt5880",    nom:"RT/duroid 5880 (PTFE)",   er:2.20, df:0.0009, f:"10 GHz",
   note:"PTFE chargé verre : les pertes les plus basses, le prix le plus haut"},
  {id:"rt5870",    nom:"RT/duroid 5870",          er:2.33, df:0.0012, f:"10 GHz"},
  {id:"ro3003",    nom:"Rogers RO3003",           er:3.00, df:0.0010, f:"10 GHz"},
  {id:"ro3010",    nom:"Rogers RO3010",           er:10.2, df:0.0022, f:"10 GHz",
   note:"εr élevé : antenne compacte, bande étroite et rendement moindre"},
  {id:"fr408",     nom:"Isola FR408HR",           er:3.68, df:0.0092, f:"2 GHz"},
  {id:"megtron6",  nom:"Panasonic Megtron 6",     er:3.40, df:0.0040, f:"12 GHz"},
  {id:"polyimide", nom:"Polyimide (flexible)",    er:3.40, df:0.008,  f:"1 GHz",
   note:"les antennes de nappe souple"},
  {id:"ptfe",      nom:"PTFE pur",                er:2.10, df:0.0004, f:"10 GHz"},
  {id:"alumine",   nom:"Alumine 96 %",            er:9.80, df:0.0004, f:"10 GHz",
   note:"céramique : antennes miniatures, circuits hyperfréquence"},
  {id:"verre",     nom:"Verre borosilicate",      er:4.60, df:0.006,  f:"1 GHz"},
  {id:"abs",       nom:"ABS (radôme, boîtier)",   er:2.80, df:0.006,  f:"1 GHz"},
  {id:"mousse",    nom:"Mousse Rohacell",         er:1.07, df:0.0002, f:"10 GHz"},
  {id:"vernis",    nom:"Vernis épargne (masque)", er:3.80, df:0.020,  f:"1 GHz",
   note:"la couche verte : 25 µm qui couvrent le cuivre et abaissent la "+
        "résonance d'environ 1 % sur un patch"},
  {id:"air",       nom:"Air",                     er:1.0006, df:0,    f:"—",
   note:"un patch suspendu : bande large, rendement élevé, mécanique à inventer"}
];

/* Les conducteurs. La conductivité n'entre dans le calcul QUE par les pertes
   ohmiques du modèle « feuille » : à 2,4 GHz l'épaisseur de peau du cuivre
   fait 1,3 µm, le courant ne voit donc jamais l'épaisseur de la couche, mais
   il voit sa résistance de surface — et c'est elle qui sépare un rendement de
   80 % d'un rendement de 60 % sur une antenne de petite taille. */
const CON_CONDUCTEURS=[
  {id:"cuivre",    nom:"Cuivre",              sigma:5.80e7},
  {id:"argent",    nom:"Argent",              sigma:6.14e7},
  {id:"or",        nom:"Or",                  sigma:4.10e7},
  {id:"aluminium", nom:"Aluminium",           sigma:3.50e7},
  {id:"laiton",    nom:"Laiton",              sigma:1.50e7},
  {id:"encre_ag",  nom:"Encre argent sérigraphiée", sigma:5.00e6,
   note:"antenne imprimée sur film : dix fois plus résistive que le cuivre"},
  {id:"ito",       nom:"ITO (oxyde transparent)",   sigma:1.00e5,
   note:"une antenne sur vitre ; le rendement s'en ressent lourdement"}
];

/* Les épaisseurs de cuivre normalisées. On les donne en onces parce que c'est
   ainsi qu'on les commande, et en microns parce que c'est ainsi qu'elles
   entrent dans le calcul. */
const CON_EP_CUIVRE=[
  {ep:0.0125, nom:"1/3 oz — 12,5 µm"},
  {ep:0.0175, nom:"1/2 oz — 17,5 µm"},
  {ep:0.035,  nom:"1 oz — 35 µm"},
  {ep:0.070,  nom:"2 oz — 70 µm"},
  {ep:0.105,  nom:"3 oz — 105 µm"}
];

function conDielectrique(id){
  return CON_DIELECTRIQUES.find(m=>m.id===id)||CON_DIELECTRIQUES[0];
}
function conConducteur(id){
  return CON_CONDUCTEURS.find(m=>m.id===id)||CON_CONDUCTEURS[0];
}

/* ==========================================================================
   L'état du dessin
   --------------------------------------------------------------------------
   Il est SÉPARÉ de `V` et de `ANT`, et pour la raison qui sépare déjà ces
   deux-là : `V` porte la carte telle qu'elle est, `ANT` ce que l'utilisateur
   a décidé de la simulation, et `CON` ce qu'il a dessiné. Le dessin fabrique
   un `V` à chaque modification ; l'inverse n'arrive jamais. Sans cette règle,
   on ne saurait bientôt plus laquelle des deux représentations fait foi.
   ========================================================================== */
const CON={
  actif:false,

  /* La carte, en millimètres. LE DESSIN EST EN MILLIMÈTRES, TOUJOURS : c'est
     l'unité du document que ce mode fabrique, et celle dans laquelle les
     gabarits calculent. `CON.unite` ne change que l'écriture des cotes dans
     le panneau — millimètre, pouce ou mil —, jamais ce qui est stocké ici.
     Rien n'empêche d'ouvrir ensuite un fichier en pouces : l'unité de ce
     fichier-là revient avec lui. */
  carte:{L:60, W:50},

  /* L'empilage. Chaque entrée porte un `uid` STABLE : les formes dessinées
     désignent leur couche par lui et non par un rang, sans quoi insérer une
     couche au milieu déplacerait d'un cran tout le cuivre déjà dessiné. */
  pile:[],
  uid:1,

  /* Le modèle d'usine appliqué, et l'épaisseur totale visée en millimètres.
     `modele` est vide dès qu'on touche à l'empilage à la main : le panneau
     cesse alors d'annoncer un catalogue qui n'est plus celui-là, et c'est
     honnête — un empilage retouché ne se commande plus par son nom. */
  modele:"",
  cible:1.6,

  /* La couche dont la fiche est ouverte, par son RANG dans `CON.pile`. Un
     rang et non un uid : la coupe et la fiche parlent de la même liste, et un
     empilage refait remet la fiche sur la couche du dessus plutôt que de
     chercher une couche disparue. */
  pileSel:0,

  /* Vrai tant que l'empilage de départ n'a pas été arrêté. C'est la première
     question du mode, et elle vient AVANT le dessin : un patch dessiné sur un
     FR-4 de 1,6 mm puis reporté sur un RO4350B de 0,762 mm n'est plus un
     patch, c'est un rectangle de cuivre. Poser la question après coup ferait
     refaire tout le dessin. */
  demarrage:false,

  /* Les formes dessinées. Genre, couche (uid), net, et des coordonnées.
     Rien d'autre : pas d'identifiant de CAO, pas d'empreinte, pas de règle. */
  elements:[],

  /* L'outil courant, la forme en cours, la forme choisie. */
  outil:"select",
  courant:null,
  sel:-1,

  /* Les réglages du dessin. `grille` à zéro veut dire « aucun magnétisme » ;
     ailleurs, tout point posé s'aligne dessus. Une antenne dont les cotes
     tombent sur des nombres ronds se compare à un calcul ; une antenne dont
     le bord est à 12,0374 mm ne se compare à rien. */
  grille:0.25,
  /* L'unite dans laquelle les cotes s'affichent et se tapent : mm, in ou mil.
     Le dessin, lui, reste en millimetres — voir CON_UNITES. */
  unite:"mm",
  largeur:1.0,                 // largeur de piste par défaut, en mm
  /* Vrai quand ce qu'on dessine RETIRE du cuivre au lieu d'en poser. Il est
     déclaré ici plutôt que créé au vol : un drapeau qui change le sens d'un
     geste sur la carte doit se lire dans la liste des états. */
  trou:false,
  coucheActive:0,              // uid de la couche de cuivre où l'on dessine
  netActif:"ANTENNE",
  diametreVia:0.6,

  /* La fréquence que visent les gabarits d'antenne, en hertz. Elle est ici et
     non dans `ANT.bande` : on dimensionne À une fréquence, on simule SUR une
     bande, et confondre les deux fait dessiner un patch pour le bord de la
     bande. */
  fcible:2.45e9,

  /* Ce que le dernier gabarit a calculé, pour que le panneau puisse le dire :
     largeur de ligne 50 Ω, εr effectif, longueur résonante. Un chiffre rendu
     sans son calcul n'est qu'un chiffre. */
  calcul:null,

  /* Le motif d'antenne dont la fiche est ouverte, et ses cotes en cours de
     réglage. RIEN DE TOUT CELA N'EST DESSINÉ : c'est ce qui est montré dans
     l'aperçu tant qu'on n'a pas pressé « Dessiner ce motif ». On peut donc
     ouvrir un patch, regarder ses cotes et refermer sans rien perdre du
     dessin en cours — ce que l'ancien bouton, qui posait au clic, ne
     permettait pas.

     `gabaritTouche` retient les cotes REPRISES À LA MAIN. Les autres suivent
     la fréquence et le substrat : sans cette distinction, changer la
     fréquence après avoir fixé une largeur de bras effacerait la largeur, ou
     bien la fréquence ne changerait plus rien. */
  gabarit:null,
  gabaritP:{},
  gabaritTouche:{},

  /* Les découpes qu'aucun versement n'a pu prendre. Comptées à la
     construction du document, affichées par le panneau. */
  decoupesOrphelines:0,
  /* Celles dont le découpage lui-même a échoué : un cas dégénéré que
     la perturbation de 25-polygones.js n'a pas levé. Comptées à part,
     parce que ce n'est pas la même faute — ni la même réponse. */
  decoupesRatees:0
};

/* Les couches de cuivre de l'empilage, dans l'ordre physique (la première est
   le dessus). Chaque entrée sait où elle tombe dans la table des couches du
   document : c'est l'index dont tout le reste de l'outil se sert. */
function conCuivres(){
  const out=[];
  CON.pile.forEach(function(e,i){ if(e.k==="cu")out.push({e:e,i:i}); });
  return out;
}
function conCoucheDeUid(uid){
  return CON.pile.findIndex(e=>e.k==="cu"&&e.uid===uid);
}
/* L'uid de repli : la première couche de cuivre. Sert quand une forme désigne
   une couche qui n'existe plus. */
function conPremierCuivre(){
  const cu=conCuivres();
  return cu.length?cu[0].e.uid:0;
}
function conDernierCuivre(){
  const cu=conCuivres();
  return cu.length?cu[cu.length-1].e.uid:0;
}
function conNomCouche(uid){
  const i=conCoucheDeUid(uid);
  return i>=0?CON.pile[i].nom:"";
}

/* ==========================================================================
   Les modèles d'usine
   --------------------------------------------------------------------------
   UN FABRICANT NE VEND PAS « QUATRE COUCHES ». Il vend un empilage : des
   cuivres d'une épaisseur donnée, des prépregs et des âmes d'une épaisseur
   donnée, le tout tombant sur une épaisseur totale normalisée — 1,6 mm le
   plus souvent, parce que c'est l'épaisseur qu'attendent les connecteurs, les
   glissières et les entretoises. Choisir un nombre de couches sans choisir
   l'empilage qui va avec laisse le solveur travailler sur un substrat qui
   n'existe chez personne : l'antenne mesurée ne ressemble alors plus à
   l'antenne simulée, et l'écart ne se voit sur aucune courbe.

   C'est pour cela que ce tableau est ici plutôt que dans l'interface. Chaque
   modèle tombe EXACTEMENT sur l'épaisseur qu'il annonce, masque exclu — c'est
   ce que vérifie le banc d'essai, et c'est la seule façon d'être sûr qu'un
   empilage proposé se commande tel quel.

   `s` dit la nature du diélectrique : une âme (core) est un stratifié cuivré
   des deux faces, un prépreg est la résine qui colle deux âmes au pressage.
   La distinction ne change rien au champ — seuls εr, tan δ et l'épaisseur y
   entrent — mais elle change ce qu'on peut commander, et un empilage qui
   n'alterne pas âme et prépreg ne se fabrique pas.
   ========================================================================== */
const CON_SORTES={core:"âme (core)", prepreg:"prépreg", masque:"masque"};

/* Le vernis épargne : 25 µm, εr 3,8. Il est déclaré ici et non dans un
   modèle, parce qu'il ne dépend ni du nombre de couches ni du stratifié. */
const CON_MASQUE_EP=0.025;

const CON_MODELES=[
  /* -- une face ---------------------------------------------------------- */
  {id:"fr4-1c-16", n:1, cible:1.600, nom:"1 couche · FR-4 1,6 mm",
   cu:[0.035], die:[{s:"core", ep:1.565, mat:"fr4"}],
   note:"le cuivre est sur le dessus, le stratifié le porte : pas de plan de "+
        "masse, donc pas de patch — c'est l'empilage d'une boucle ou d'un dipôle"},

  /* -- double face, le cas ordinaire ------------------------------------- */
  {id:"fr4-2c-16", n:2, cible:1.600, nom:"2 couches · FR-4 1,6 mm · 35 µm",
   cu:[0.035,0.035], die:[{s:"core", ep:1.530, mat:"fr4"}],
   note:"la carte que tout le monde a sous la main, et celle sur laquelle les "+
        "formules de patch sont écrites"},
  {id:"fr4-2c-16-70", n:2, cible:1.600, nom:"2 couches · FR-4 1,6 mm · 70 µm",
   cu:[0.070,0.070], die:[{s:"core", ep:1.460, mat:"fr4"}]},
  {id:"fr4-2c-08", n:2, cible:0.800, nom:"2 couches · FR-4 0,8 mm",
   cu:[0.035,0.035], die:[{s:"core", ep:0.730, mat:"fr4"}],
   note:"un substrat deux fois plus mince : patch plus étroit de bande, "+
        "rendement moindre, carte plus souple"},
  {id:"fr4-2c-16-hf", n:2, cible:1.600,
   nom:"2 couches · FR-4 haute fréquence 1,6 mm",
   cu:[0.035,0.035], die:[{s:"core", ep:1.530, mat:"fr4hf"}]},

  /* -- double face, les stratifiés hyperfréquence ------------------------ */
  {id:"ro4350-2c-0762", n:2, cible:0.832,
   nom:"2 couches · RO4350B 0,762 mm (30 mil)",
   cu:[0.035,0.035], die:[{s:"core", ep:0.762, mat:"ro4350b"}],
   note:"l'épaisseur de patch la plus courante au-dessus de 2 GHz"},
  {id:"ro4350-2c-0508", n:2, cible:0.578,
   nom:"2 couches · RO4350B 0,508 mm (20 mil)",
   cu:[0.035,0.035], die:[{s:"core", ep:0.508, mat:"ro4350b"}]},
  {id:"ro4003-2c-1524", n:2, cible:1.594,
   nom:"2 couches · RO4003C 1,524 mm (60 mil)",
   cu:[0.035,0.035], die:[{s:"core", ep:1.524, mat:"ro4003c"}]},
  {id:"rt5880-2c-1575", n:2, cible:1.645,
   nom:"2 couches · RT/duroid 5880 1,575 mm (62 mil)",
   cu:[0.035,0.035], die:[{s:"core", ep:1.575, mat:"rt5880"}],
   note:"les pertes les plus basses et l'εr le plus bas : la bande la plus "+
        "large qu'un patch imprimé sache donner"},
  {id:"rt5880-2c-0787", n:2, cible:0.857,
   nom:"2 couches · RT/duroid 5880 0,787 mm (31 mil)",
   cu:[0.035,0.035], die:[{s:"core", ep:0.787, mat:"rt5880"}]},
  {id:"ro3003-2c-1524", n:2, cible:1.594,
   nom:"2 couches · RO3003 1,524 mm (60 mil)",
   cu:[0.035,0.035], die:[{s:"core", ep:1.524, mat:"ro3003"}]},

  /* -- double face, hors stratifié rigide -------------------------------- */
  {id:"pi-2c-01", n:2, cible:0.086, nom:"2 couches · polyimide souple 86 µm",
   cu:[0.018,0.018], die:[{s:"core", ep:0.050, mat:"polyimide"}],
   note:"l'antenne de nappe : elle se colle sur un boîtier, et sa courbure "+
        "ne se simule pas ici"},
  {id:"air-2c-3", n:2, cible:3.070,
   nom:"2 couches · patch suspendu sur 3 mm d'air",
   cu:[0.035,0.035], die:[{s:"core", ep:3.000, mat:"air"}],
   note:"bande large et rendement élevé ; la mécanique qui tient le patch à "+
        "3 mm du plan reste à inventer, et elle rayonne aussi"},

  /* -- quatre couches ---------------------------------------------------- */
  {id:"fr4-4c-16", n:4, cible:1.600, nom:"4 couches · FR-4 1,6 mm",
   cu:[0.035,0.0175,0.0175,0.035],
   die:[{s:"prepreg", ep:0.210, mat:"fr4"},
        {s:"core",    ep:1.075, mat:"fr4"},
        {s:"prepreg", ep:0.210, mat:"fr4"}],
   note:"l'antenne travaille contre le plan de la COUCHE 2, à 0,21 mm : un "+
        "patch y est bien plus étroit de bande que sur un 1,6 mm double face"},
  {id:"fr4-4c-10", n:4, cible:1.000, nom:"4 couches · FR-4 1,0 mm",
   cu:[0.035,0.0175,0.0175,0.035],
   die:[{s:"prepreg", ep:0.200, mat:"fr4"},
        {s:"core",    ep:0.495, mat:"fr4"},
        {s:"prepreg", ep:0.200, mat:"fr4"}]},
  {id:"hyb-4c-16", n:4, cible:1.600,
   nom:"4 couches hybride · RO4350B en surface + FR-4",
   cu:[0.035,0.0175,0.0175,0.035],
   die:[{s:"core", ep:0.508, mat:"ro4350b"},
        {s:"core", ep:0.479, mat:"fr4"},
        {s:"core", ep:0.508, mat:"ro4350b"}],
   note:"l'empilage des cartes radio : le stratifié cher n'est que là où "+
        "l'onde passe, le FR-4 porte le reste et tient l'épaisseur"},

  /* -- six et huit couches ----------------------------------------------- */
  {id:"fr4-6c-16", n:6, cible:1.600, nom:"6 couches · FR-4 1,6 mm",
   cu:[0.035,0.0175,0.0175,0.0175,0.0175,0.035],
   die:[{s:"prepreg", ep:0.250, mat:"fr4"},
        {s:"core",    ep:0.355, mat:"fr4"},
        {s:"prepreg", ep:0.250, mat:"fr4"},
        {s:"core",    ep:0.355, mat:"fr4"},
        {s:"prepreg", ep:0.250, mat:"fr4"}]},
  {id:"fr4-8c-16", n:8, cible:1.600, nom:"8 couches · FR-4 1,6 mm",
   cu:[0.035,0.0175,0.0175,0.0175,0.0175,0.0175,0.0175,0.035],
   die:[{s:"prepreg", ep:0.150, mat:"fr4"},
        {s:"core",    ep:0.275, mat:"fr4"},
        {s:"prepreg", ep:0.150, mat:"fr4"},
        {s:"core",    ep:0.275, mat:"fr4"},
        {s:"prepreg", ep:0.150, mat:"fr4"},
        {s:"core",    ep:0.275, mat:"fr4"},
        {s:"prepreg", ep:0.150, mat:"fr4"}]}
];

function conModeleEmpilage(id){
  return CON_MODELES.find(m=>m.id===id)||null;
}
function conModelesPour(n){
  return CON_MODELES.filter(m=>m.n===n);
}
/* Les comptes de couches proposés : ceux pour lesquels un modèle existe. Un
   compte sans modèle serait un empilage à inventer de toutes pièces, et ce
   n'est pas ce que ce mode sait faire — on ajoute alors les couches une à
   une, et l'empilage cesse d'être celui d'un catalogue. */
function conComptesCuivre(){
  const out=[];
  for(const m of CON_MODELES)if(out.indexOf(m.n)<0)out.push(m.n);
  return out.sort((a,b)=>a-b);
}

/* Les noms d'usine. Le dessus et le dessous portent le leur ; les internes
   sont numérotées dans l'ordre où elles se pressent, comme sur la feuille
   d'empilage du fabricant. */
function conNomCuivre(i,n){
  if(i===0)return "Cuivre dessus";
  if(i===n-1)return "Cuivre dessous";
  return "Cuivre interne "+i;
}
/* LE RÔLE D'USINE DE LA SECONDE COUCHE EST « MASSE », et ce n'est pas un
   détail de présentation : une antenne imprimée rayonne CONTRE le plan qui
   est juste sous elle, et un empilage sans masse déclarée donne un port qui
   ne relie rien. Le dessous l'est aussi — c'est le blindage habituel. Tout
   cela reste modifiable, et les motifs d'antenne le modifient : un dipôle
   imprimé n'a aucune masse, et il le dit en posant « signal ». */
function conRoleUsine(i,n){
  if(n<2)return "signal";
  if(i===1||i===n-1)return "gnd";
  return "signal";
}
/* Les noms des diélectriques d'un modèle. Un seul : c'est « le substrat », et
   l'appeler « âme 1 » n'apprendrait rien. Plusieurs : leur nature et leur
   rang, parce que c'est ainsi qu'on les lit sur la feuille d'empilage. */
function conNomsDie(die){
  if(die.length===1)return ["Substrat"];
  const rang={};
  return die.map(function(d){
    const base=(d.s==="prepreg")?"Prépreg":"Âme";
    rang[base]=(rang[base]||0)+1;
    return base+" "+rang[base];
  });
}

/* L'empilage d'un modèle, en oubliant tout ce qui existait avant. Les uid
   sont neufs : c'est `conPileVers()` qui rend aux couches conservées celui
   que les formes dessinées désignent. */
function conPileDeModele(m){
  const noms=conNomsDie(m.die||[]);
  const out=[];
  for(let i=0;i<m.n;i++){
    out.push({k:"cu", uid:CON.uid++, nom:conNomCuivre(i,m.n),
              ep:m.cu[i]||0.035, role:conRoleUsine(i,m.n), mat:"cuivre"});
    const d=(m.die||[])[i];
    if(!d)continue;
    const mat=conDielectrique(d.mat);
    out.push({k:"die", uid:CON.uid++, nom:noms[i], sorte:d.s||"core",
              ep:d.ep, mat:mat.id, er:mat.er, df:mat.df});
  }
  return out;
}

/* ==========================================================================
   L'empilage d'usine
   --------------------------------------------------------------------------
   Deux faces et un FR-4 de 1,6 mm : c'est la carte que tout le monde a sous
   la main, et c'est aussi celle sur laquelle les formules de patch sont
   écrites. Le dessous est déclaré MASSE, parce qu'une antenne imprimée
   rayonne CONTRE un plan de masse et qu'un empilage sans masse déclarée
   donnerait un port qui ne relie rien.
   ========================================================================== */
const CON_MODELE_DEFAUT="fr4-2c-16";

function conPileDefaut(){
  CON.uid=1;
  const m=conModeleEmpilage(CON_MODELE_DEFAUT);
  CON.modele=m.id;
  CON.cible=m.cible;
  return conPileDeModele(m);
}

/* Un nom libre. Les noms de couche servent de clé partout — au port, aux
   vias, aux valeurs saisies — et deux couches du même nom rendraient le
   modèle ambigu sans qu'aucun message ne le dise. */
function conNomLibre(base,pile){
  const pris=new Set((pile||CON.pile).map(e=>e.nom));
  if(!pris.has(base))return base;
  for(let n=2;n<200;n++)if(!pris.has(base+" "+n))return base+" "+n;
  return base+" "+Date.now();
}

/* ==========================================================================
   Le masque
   --------------------------------------------------------------------------
   IL N'EST PAS POSÉ D'USINE, ET CE CHOIX SE PAIE DANS LES DEUX SENS. Le
   vernis épargne existe sur presque toutes les cartes et il compte : 25 µm
   d'εr 3,8 sur un patch abaissent la résonance d'environ un pour cent, assez
   pour expliquer un écart qu'on irait chercher ailleurs.

   MAIS IL COÛTE DU TEMPS DE CALCUL, ET IL FAUT DIRE COMBIEN. Chaque interface
   de l'empilage porte une ligne de maillage OBLIGATOIRE — c'est
   python/openems_modele.py qui le garantit, et il a raison : une interface de
   substrat qui glisse, c'est un autre substrat. Le masque pose donc deux
   lignes distantes de 25 µm là où la plus petite cellule du modèle faisait
   37 µm, et le pas de temps FDTD suit la plus petite cellule du domaine.
   Mesuré sur le patch 2,45 GHz de l'exemple : la simulation devient une fois
   et demie plus longue, pour deux pour cent de cellules en plus. C'est
   supportable au dernier tour, ce ne l'est pas pendant qu'on cherche encore
   la géométrie.

   L'outil ne tranche donc pas à la place de l'utilisateur : le masque est
   proposé, son coût est écrit, et le réglage d'usine est « sans ». On le pose
   à la fin, quand la géométrie est arrêtée et qu'on veut le dernier pour cent.
   ========================================================================== */
function conEstMasque(e){
  return !!(e&&e.k==="die"&&e.sorte==="masque");
}
function conMasqueEntree(nom,pile){
  const m=conDielectrique("vernis");
  return {k:"die", uid:CON.uid++, nom:conNomLibre(nom,pile), sorte:"masque",
          ep:CON_MASQUE_EP, mat:m.id, er:m.er, df:m.df};
}
function conMasques(){
  const n=CON.pile.length;
  return {haut:conEstMasque(CON.pile[0]),
          bas:n>1&&conEstMasque(CON.pile[n-1])};
}
/* Poser ou retirer les deux faces d'un coup : un masque sur une seule face
   décrit une carte qui ne se fabrique pas ainsi, et ferait surtout croire à
   une asymétrie de calcul là où il n'y a qu'un oubli. Celui du dessous n'est
   posé que s'il y a du cuivre à couvrir. */
function conMasquePoser(oui){
  if(!oui){
    CON.pile=CON.pile.filter(e=>!conEstMasque(e));
    return;
  }
  const a=conMasques();
  if(!a.haut&&CON.pile.length&&CON.pile[0].k==="cu")
    CON.pile.unshift(conMasqueEntree("Masque dessus"));
  if(!a.bas&&CON.pile.length&&CON.pile[CON.pile.length-1].k==="cu")
    CON.pile.push(conMasqueEntree("Masque dessous"));
}

/* ==========================================================================
   Les épaisseurs
   --------------------------------------------------------------------------
   Quatre nombres, et ils ne disent pas la même chose : le cuivre total (ce
   qu'on commande en onces), le diélectrique (ce que le champ traverse), le
   stratifié nu (ce que le fabricant presse) et l'épaisseur totale (ce que la
   carte mesure au pied à coulisse, masque compris). C'est la dernière qui
   doit tomber sur l'épaisseur visée, et c'est le diélectrique qu'on ajuste
   pour cela : on ne choisit pas une épaisseur de cuivre pour faire tomber
   juste une épaisseur de carte.
   ========================================================================== */
function conEpCuivre(){
  let s=0;
  for(const e of CON.pile)if(e.k==="cu")s+=+e.ep||0;
  return +s.toFixed(4);
}
function conEpDie(){
  let s=0;
  for(const e of CON.pile)if(e.k==="die"&&!conEstMasque(e))s+=+e.ep||0;
  return +s.toFixed(4);
}
function conEpMasque(){
  let s=0;
  for(const e of CON.pile)if(conEstMasque(e))s+=+e.ep||0;
  return +s.toFixed(4);
}
function conEpStratifie(){ return +(conEpCuivre()+conEpDie()).toFixed(4); }
function conEpTotale(){ return +(conEpStratifie()+conEpMasque()).toFixed(4); }

/* Ramener l'empilage sur l'épaisseur visée en répartissant l'écart sur les
   diélectriques, au prorata de ce qu'ils font déjà. Le cuivre et le masque ne
   bougent pas : ils se commandent, ils ne se négocient pas. Rendre faux plutôt
   que d'écraser l'empilage quand la visée est plus mince que le cuivre
   lui-même — une carte de 0,05 mm dont le cuivre fait 0,07 n'est pas une
   carte. */
function conAjusterEpaisseur(){
  const fixe=conEpCuivre()+conEpMasque();
  const veut=(+CON.cible||0)-fixe, a=conEpDie();
  if(!(veut>0.02)||!(a>0))return false;
  const k=veut/a;
  for(const e of CON.pile)
    if(e.k==="die"&&!conEstMasque(e))
      e.ep=Math.max(0.005,+(e.ep*k).toFixed(4));
  return true;
}

/* ==========================================================================
   La symétrie
   --------------------------------------------------------------------------
   UN EMPILAGE ASYMÉTRIQUE SE VOILE À LA CUISSON : le fabricant le refuse, ou
   le compense à sa façon et rend une carte dont l'empilage n'est plus celui
   qu'on a simulé. Ce n'est pas un défaut de calcul — le solveur simule très
   bien un empilage impossible —, c'est un défaut de commande, et il ne se
   découvre qu'au devis. Plutôt qu'un verdict, la liste des paires qui ne se
   répondent pas : c'est elle qui dit quoi corriger.
   ========================================================================== */
function conAsymetrie(){
  const cu=conCuivres().map(c=>c.e);
  const die=CON.pile.filter(e=>e.k==="die"&&!conEstMasque(e));
  const out=[], eps=1e-4;
  for(let i=0,j=cu.length-1;i<j;i++,j--)
    if(Math.abs((cu[i].ep||0)-(cu[j].ep||0))>eps)
      out.push({quoi:"cuivre", a:cu[i].nom, b:cu[j].nom,
                dit:"épaisseurs différentes"});
  for(let i=0,j=die.length-1;i<j;i++,j--){
    if(Math.abs((die[i].ep||0)-(die[j].ep||0))>eps)
      out.push({quoi:"diélectrique", a:die[i].nom, b:die[j].nom,
                dit:"épaisseurs différentes"});
    else if(die[i].mat!==die[j].mat)
      out.push({quoi:"diélectrique", a:die[i].nom, b:die[j].nom,
                dit:"matières différentes"});
  }
  return out;
}
/* Symétriser, c'est faire la moyenne des couches deux à deux — et donner à
   celle du bas la matière de celle du haut, puisque c'est la face dessinée
   qui commande. */
function conSymetriser(){
  const cu=conCuivres().map(c=>c.e);
  const die=CON.pile.filter(e=>e.k==="die"&&!conEstMasque(e));
  for(let i=0,j=cu.length-1;i<j;i++,j--){
    const t=+(((cu[i].ep||0)+(cu[j].ep||0))/2).toFixed(4);
    cu[i].ep=t; cu[j].ep=t;
  }
  for(let i=0,j=die.length-1;i<j;i++,j--){
    const t=+(((die[i].ep||0)+(die[j].ep||0))/2).toFixed(4);
    die[i].ep=t; die[j].ep=t;
    die[j].mat=die[i].mat; die[j].er=die[i].er; die[j].df=die[i].df;
    die[j].sorte=die[i].sorte;
  }
}

/* ==========================================================================
   Changer le nombre de couches
   --------------------------------------------------------------------------
   LES DIÉLECTRIQUES D'UN QUATRE COUCHES NE VEULENT PLUS RIEN DIRE SUR UN SIX
   COUCHES : on reprend donc le modèle d'usine du nouveau compte plutôt que
   d'étirer l'ancien. Mais on garde ce qui ne dépend pas du compte et qui a
   été décidé — le nom, le rôle et le métal des couches conservées — et
   surtout leur `uid`, parce que c'est par lui que les formes déjà dessinées
   désignent leur couche. Un empilage refait avec des uid neufs laisserait
   tout le cuivre dessiné pointer dans le vide.

   Le report suit la règle de la CAO : dessus → dessus, dessous → dessous,
   internes par rang. Les formes d'une couche interne qui disparaît sont
   ramenées sur la couche voisine et COMPTÉES — effacer du dessin en silence
   parce qu'on a touché à l'empilage est exactement la perte qu'on ne remarque
   qu'au résultat.
   ========================================================================== */
function conPileVers(n,id){
  const m=(id&&conModeleEmpilage(id))||conModelesPour(n)[0];
  if(!m)return null;
  const masques=conMasques();
  const anciens=conCuivres().map(c=>c.e);
  const neuve=conPileDeModele(m);
  const cuNeufs=neuve.filter(e=>e.k==="cu");

  /* Le report des couches conservées. Une source ne sert qu'une fois : sans
     cela, passer de deux à quatre couches donnerait deux couches du même uid,
     et une forme dessinée ne saurait plus sur laquelle elle est. */
  const pris=new Set();
  cuNeufs.forEach(function(e,i){
    let src=null;
    if(anciens.length){
      if(i===0)src=anciens[0];
      else if(i===cuNeufs.length-1)src=anciens[anciens.length-1];
      else src=anciens[Math.min(i,anciens.length-2)]||null;
    }
    if(!src||pris.has(src.uid))return;
    pris.add(src.uid);
    e.uid=src.uid;
    e.nom=src.nom;
    e.role=src.role;
    e.mat=src.mat;
  });

  /* Les noms repris peuvent se heurter à ceux du modèle : on dédoublonne une
     fois, à la fin, plutôt que de refuser un report pour un homonyme. */
  const vus=new Set();
  for(const e of neuve){
    if(vus.has(e.nom))e.nom=conNomLibre(e.nom,neuve);
    vus.add(e.nom);
  }

  /* Les formes orphelines : celles dont la couche a disparu. Elles sont
     ramenées sur la couche de même rang, ou sur la plus basse si ce rang
     n'existe plus. */
  const rangAncien=new Map();
  anciens.forEach(function(e,r){ rangAncien.set(e.uid,r); });
  const vivants=new Set(cuNeufs.map(e=>e.uid));
  let deplacees=0;
  for(const el of CON.elements){
    if(vivants.has(el.cu))continue;
    const r=rangAncien.has(el.cu)?rangAncien.get(el.cu):0;
    const cible=cuNeufs[Math.min(r,cuNeufs.length-1)];
    if(!cible)continue;
    el.cu=cible.uid;
    deplacees++;
  }

  CON.pile=neuve;
  CON.modele=m.id;
  CON.cible=m.cible;
  if(masques.haut||masques.bas)conMasquePoser(true);
  if(conCoucheDeUid(CON.coucheActive)<0)CON.coucheActive=conPremierCuivre();
  return {modele:m, deplacees:deplacees};
}

/* ==========================================================================
   Les ports que l'empilage vient de rendre faux
   --------------------------------------------------------------------------
   UN PORT QUI RELIAIT LE DESSUS AU DESSOUS D'UN DOUBLE FACE relie, sur un
   quatre couches, deux cuivres SÉPARÉS PAR DEUX PLANS. Les deux couches
   existent toujours, elles portent toujours leur nom : ni le solveur ni le
   serveur ne refuseront quoi que ce soit, et le S11 qui sortira sera celui
   d'une antenne alimentée en travers de sa propre masse. C'est exactement le
   genre de faute qu'il faut compter et dire, puisque rien d'autre ne la dira.

   Le critère est la mitoyenneté : un port ordinaire relie deux conducteurs
   VOISINS de l'empilage, avec le seul diélectrique qui les sépare entre eux.
   Tout le reste demande au moins qu'on l'ait voulu.
   ========================================================================== */
function conPortsSuspects(){
  const noms=conCuivres().map(c=>c.e.nom);
  const out=[];
  (typeof ANT!=="undefined"?(ANT.ports||[]):[]).forEach(function(p,i){
    if(!p||!p.pose)return;
    const a=noms.indexOf(p.de), b=noms.indexOf(p.a);
    if(a<0||b<0||Math.abs(a-b)!==1)out.push(i+1);
  });
  return out;
}

/* Appliquer un modèle d'usine SANS changer le nombre de couches : les
   épaisseurs et les matières changent, les noms, les rôles et les uid
   restent. C'est le geste courant — « le même quatre couches, mais en
   1,0 mm » —, et il ne doit rien coûter au dessin. */
function conAppliquerModele(id){
  const m=conModeleEmpilage(id);
  if(!m)return false;
  if(m.n!==conCuivres().length)return !!conPileVers(m.n,m.id);
  const cu=conCuivres().map(c=>c.e);
  const die=CON.pile.filter(e=>e.k==="die"&&!conEstMasque(e));
  cu.forEach(function(e,i){ e.ep=m.cu[i]||e.ep; });
  die.forEach(function(e,i){
    const d=(m.die||[])[i];
    if(!d)return;
    const mat=conDielectrique(d.mat);
    e.sorte=d.s||"core"; e.ep=d.ep; e.mat=mat.id; e.er=mat.er; e.df=mat.df;
  });
  CON.modele=m.id;
  CON.cible=m.cible;
  return true;
}

/* Ajouter une paire diélectrique + cuivre sous l'empilage : c'est ainsi qu'on
   passe de deux à quatre couches à la main, et jamais un conducteur seul —
   deux conducteurs sans rien entre eux ne sont pas un empilage mais un
   court-circuit. La paire se glisse SOUS le dernier cuivre et AVANT le masque
   du dessous : un masque pris au milieu de l'empilage décrirait une carte
   impossible.

   L'empilage cesse alors d'être celui d'un modèle d'usine, et il le dit :
   `CON.modele` est vidé plutôt que de laisser le panneau afficher le nom d'un
   empilage qui n'est plus le sien. */
function conAjouterCouche(){
  const fin=CON.pile.length-(conMasques().bas?1:0);
  CON.pile.splice(fin,0,
    {k:"die", uid:CON.uid++, nom:conNomLibre("Substrat"),
     ep:0.5, sorte:"prepreg", mat:"fr4", er:4.30, df:0.020},
    {k:"cu",  uid:CON.uid++, nom:conNomLibre("Cuivre"),
     ep:0.035, role:"signal", mat:"cuivre"});
  CON.modele="";
}

/* Une couche de cuivre porte-t-elle du dessin ? On ne la retire pas dans ce
   cas : effacer du cuivre en silence parce qu'on a touché à l'empilage est
   exactement le genre de perte qu'on ne remarque qu'au résultat. */
function conCoucheOccupee(uid){
  return CON.elements.some(el=>el.cu===uid);
}

function conRetirerCouche(i){
  const e=CON.pile[i];
  if(!e)return;
  if(e.k==="cu"&&conCoucheOccupee(e.uid))return;
  CON.pile.splice(i,1);
  /* Un diélectrique en bout d'empilage ne sépare plus rien : il part avec.
     LE MASQUE EST LA SEULE EXCEPTION — il est fait pour être en bout, et le
     perdre parce qu'on a retiré la couche d'en dessous serait une surprise. */
  const bout=p=>p.length&&p[p.length-1].k==="die"&&!conEstMasque(p[p.length-1]);
  const tete=p=>p.length&&p[0].k==="die"&&!conEstMasque(p[0]);
  while(bout(CON.pile))CON.pile.pop();
  while(tete(CON.pile))CON.pile.shift();
  /* Un masque qui ne couvre plus aucun cuivre n'a plus d'objet. */
  if(!CON.pile.some(x=>x.k==="cu"))CON.pile=[];
  CON.modele="";
  if(conCoucheDeUid(CON.coucheActive)<0)CON.coucheActive=conPremierCuivre();
}

/* ==========================================================================
   Les formes
   ========================================================================== */
/* Le contour d'une forme, en coordonnées à plat [x,y,x,y,…] — le format du
   document, et celui de tout le reste de l'outil.

   LES DISQUES SONT DES POLYGONES À QUARANTE-HUIT CÔTÉS. Un solveur FDTD
   maille en cartésien : un cercle parfait n'existerait de toute façon pas
   dans le maillage, et quarante-huit côtés sont déjà plus fins que la maille
   à toute fréquence raisonnable. */
const CON_COTES_DISQUE=48;

function conContour(el){
  if(el.type==="rect"){
    const x1=Math.min(el.x1,el.x2), x2=Math.max(el.x1,el.x2);
    const y1=Math.min(el.y1,el.y2), y2=Math.max(el.y1,el.y2);
    if(!(x2>x1)||!(y2>y1))return null;
    return [x1,y1, x2,y1, x2,y2, x1,y2];
  }
  if(el.type==="disque"){
    if(!(el.r>0))return null;
    const p=[];
    for(let i=0;i<CON_COTES_DISQUE;i++){
      const a=2*Math.PI*i/CON_COTES_DISQUE;
      p.push(el.cx+el.r*Math.cos(a), el.cy+el.r*Math.sin(a));
    }
    return p;
  }
  if(el.type==="poly"){
    if(!el.pts||el.pts.length<3)return null;
    const p=[];
    for(const q of el.pts)p.push(q[0],q[1]);
    return p;
  }
  return null;
}

/* La boîte d'une forme : le survol, la sélection et le cadrage s'en servent. */
function conBoite(el){
  if(el.type==="via")
    return {x1:el.x-el.d/2, y1:el.y-el.d/2, x2:el.x+el.d/2, y2:el.y+el.d/2};
  if(el.type==="piste"){
    let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
    for(const q of (el.pts||[])){
      x1=Math.min(x1,q[0]); x2=Math.max(x2,q[0]);
      y1=Math.min(y1,q[1]); y2=Math.max(y2,q[1]);
    }
    if(!isFinite(x1))return {x1:0,y1:0,x2:0,y2:0};
    const d=(el.w||0)/2;
    return {x1:x1-d, y1:y1-d, x2:x2+d, y2:y2+d};
  }
  const p=conContour(el);
  if(!p)return {x1:0,y1:0,x2:0,y2:0};
  let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
  for(let i=0;i+1<p.length;i+=2){
    x1=Math.min(x1,p[i]); x2=Math.max(x2,p[i]);
    y1=Math.min(y1,p[i+1]); y2=Math.max(y2,p[i+1]);
  }
  return {x1:x1,y1:y1,x2:x2,y2:y2};
}

/* Le point tombe-t-il sur la forme ? Sert au clic de désignation. */
function conDedans(el,x,y){
  const b=conBoite(el);
  if(x<b.x1||x>b.x2||y<b.y1||y>b.y2)return false;
  if(el.type==="via")return Math.hypot(x-el.x,y-el.y)<=el.d/2;
  if(el.type==="disque")return Math.hypot(x-el.cx,y-el.cy)<=el.r;
  if(el.type==="piste"){
    const demi=Math.max((el.w||0)/2,0.05);
    for(let i=0;i+1<el.pts.length;i++)
      if(antDistSeg(x,y,el.pts[i][0],el.pts[i][1],
                        el.pts[i+1][0],el.pts[i+1][1])<=demi)return true;
    return false;
  }
  const p=conContour(el);
  return p?mdlDansPoly(p,x,y):false;
}

/* Déplacer une forme : toutes ses coordonnées d'un coup. */
function conDeplacer(el,dx,dy){
  if(el.type==="rect"){ el.x1+=dx; el.x2+=dx; el.y1+=dy; el.y2+=dy; }
  else if(el.type==="disque"){ el.cx+=dx; el.cy+=dy; }
  else if(el.type==="via"){ el.x+=dx; el.y+=dy; }
  else for(const q of el.pts){ q[0]+=dx; q[1]+=dy; }
  conArrondir(el);
}

/* Les cotes sont arrondies au dixième de micron. Ce n'est pas de la
   coquetterie : une coordonnée qui traîne quinze décimales derrière elle rend
   le panneau illisible, et le maillage ne distingue de toute façon rien en
   dessous. */
function conArrondir(el){
  const r=v=>+(+v).toFixed(4);
  if(el.type==="rect"){ el.x1=r(el.x1);el.x2=r(el.x2);el.y1=r(el.y1);el.y2=r(el.y2); }
  else if(el.type==="disque"){ el.cx=r(el.cx);el.cy=r(el.cy);el.r=r(el.r); }
  else if(el.type==="via"){ el.x=r(el.x);el.y=r(el.y);el.d=r(el.d); }
  else for(const q of el.pts){ q[0]=r(q[0]); q[1]=r(q[1]); }
  return el;
}

/* Le nom affiché d'une forme. Il dit le genre, la découpe et la couche — ce
   qui suffit à la retrouver sur le dessin. */
const CON_GENRES={rect:"rectangle", disque:"disque", poly:"polygone",
                  piste:"piste", via:"via"};
function conNomElement(el){
  const g=CON_GENRES[el.type]||el.type;
  const c=conNomCouche(el.cu)||"couche absente";
  return (el.trou?"découpe ":"")+g+" · "+c;
}

/* ==========================================================================
   Du dessin au document
   --------------------------------------------------------------------------
   C'EST LE CŒUR DU MODULE, et c'est aussi ce qui le rend inoffensif : il rend
   un objet qui a exactement la forme de ce que `python/ipc2581_json.py`
   produit à partir d'un vrai fichier. Tout ce qui le lit ensuite — le rendu,
   l'empilage de calcul, la géométrie envoyée au solveur — n'y voit aucune
   différence, et il n'existe donc aucun chemin de code propre au mode
   conception. Un chemin de code propre à un mode est un chemin de code qui
   n'est jamais éprouvé.
   ========================================================================== */

/* Les découpes : une forme marquée `trou` ne pose pas de cuivre, elle en
   retire. On l'attache au versement qu'elle perce, sur la même couche.

   ELLE EST COUPÉE AU BORD DU VERSEMENT, et c'est ce qui a changé. Une découpe
   à cheval débordait autrefois de la forme qu'elle devait trouer ; le trou
   aurait alors effacé du cuivre voisin — une piste qui passe à côté, un
   second versement sur la même couche — sans que rien ne le dise, et on
   préférait l'écarter. `polyIntersection` (25-polygones.js) rend maintenant la
   partie commune exacte : ce qui est retiré est exactement ce qui devait
   l'être, et le reste ne bouge pas.

   UNE DÉCOUPE PEUT DÉSORMAIS SERVIR DEUX FOIS. Une fente qui traverse deux
   versements de la même couche les perce tous les deux, chacun de son propre
   morceau. C'est le comportement juste — une fente ne s'arrête pas au bord
   d'un versement parce que le dessin en a fait deux —, et l'ancienne règle du
   « premier versement qui la contient » ne pouvait pas le rendre.

   CE QUI RESTE REFUSÉ est ce qui n'aboutit pas : quand le découpage échoue
   (`null`), la découpe est comptée et signalée, jamais approchée. */
function conDecoupesPour(el,decoupes,utilisees,rates){
  const out=[];
  const contour=conContour(el);
  if(!contour)return out;
  const b=conBoite(el);
  for(let i=0;i<decoupes.length;i++){
    const d=decoupes[i];
    if(d.cu!==el.cu)continue;
    /* Les boîtes disjointes ne se croisent pas : c'est le test qui écarte en
       une soustraction les quatre-vingt-dix-neuf pour cent des cas. */
    const bd=conBoite(d);
    if(bd.x2<b.x1||bd.x1>b.x2||bd.y2<b.y1||bd.y1>b.y2)continue;
    const p=conContour(d);
    if(!p)continue;
    const morceaux=polyIntersection(contour,p);
    if(morceaux===null){ rates.add(i); continue; }
    if(!morceaux.length)continue;
    for(const m of morceaux)out.push(m);
    utilisees.add(i);
  }
  return out;
}

/* La liste des nets. « ANTENNE » d'abord, « GND » ensuite : l'ordre n'a pas
   d'importance pour le calcul, mais un net de masse nommé GND est reconnu
   sans rien demander par `antDevinerMasse()`. */
function conNets(){
  const noms=["ANTENNE","GND"];
  for(const el of CON.elements)
    if(el.net&&noms.indexOf(el.net)<0)noms.push(el.net);
  return noms;
}

function conModele(){
  const cu=conCuivres();
  const nets=conNets();
  const iNet=function(nom){ const i=nets.indexOf(nom); return i<0?0:i; };
  const iCouche=function(uid){
    const i=conCoucheDeUid(uid);
    return i>=0?i:(cu.length?cu[0].i:0);
  };

  const empilage=CON.pile.map(function(e,i){
    if(e.k==="cu"){
      const c=conConducteur(e.mat);
      return {nom:e.nom, seq:i+1, ep:e.ep, mat:c.nom, dk:"", df:"",
              type:e.role==="gnd"?"GROUND":(e.role==="pwr"?"POWER":"SIGNAL"),
              /* La conductivité voyage avec la couche : c'est elle qui fait
                 la résistance de surface du modèle « feuille », et une
                 antenne sérigraphiée à l'encre argent perd un rendement
                 qu'aucun autre champ du document ne dirait. */
              sigma:c.sigma};
    }
    return {nom:e.nom, seq:i+1, ep:e.ep, mat:conDielectrique(e.mat).nom,
            dk:e.er, df:e.df, type:"DIELECTRIC"};
  });

  const plans=[], pistes=[], percages=[];
  const decoupes=CON.elements.filter(
    el=>el.trou&&el.type!=="via"&&el.type!=="piste");
  const utilisees=new Set(), rates=new Set();

  for(const el of CON.elements){
    if(el.trou&&el.type!=="via")continue;          // traitée comme découpe
    if(el.type==="via"){
      if(!(el.d>0))continue;
      percages.push({x:el.x, y:el.y, d:el.d, p:"PLATED", ps:"",
                     n:iNet(el.net),
                     sa:cu.length?cu[0].i:0,
                     sb:cu.length?cu[cu.length-1].i:0});
      continue;
    }
    if(el.type==="piste"){
      if(!el.pts||el.pts.length<2)continue;
      const p=[];
      for(const q of el.pts)p.push(q[0],q[1]);
      pistes.push({c:iCouche(el.cu), n:iNet(el.net),
                   w:el.w||CON.largeur, p:p});
      continue;
    }
    const o=conContour(el);
    if(!o||o.length<6)continue;
    plans.push({c:iCouche(el.cu), n:iNet(el.net), f:"",
                g:[{o:o, t:conDecoupesPour(el,decoupes,utilisees,rates)}]});
  }

  /* Les découpes qu'aucun versement n'a prises — soit qu'elles ne touchent
     aucun cuivre, soit que le découpage ait échoué. Comptées et non tues :
     une fente qui n'entre pas dans le modèle change complètement l'antenne,
     et rien dans le S11 ne dira qu'elle manquait. Les deux causes sont
     distinguées : « à côté du cuivre » se corrige en déplaçant la forme,
     « pas calculable » est un aveu de l'outil. */
  CON.decoupesOrphelines=decoupes.length-utilisees.size;
  CON.decoupesRatees=rates.size;

  const L=CON.carte.L, W=CON.carte.W;
  let ep=0;
  for(const e of CON.pile)ep+=e.ep||0;

  return {
    format:"conception-1",
    fichier:"conception",
    unites:"MILLIMETER",
    epaisseur:+ep.toFixed(4),
    contour:{o:[0,0, L,0, L,W, 0,W], t:[]},
    empilage:empilage,
    couches:CON.pile.map(e=>e.nom),
    nets:nets,
    pistes:pistes,
    arcs:[],
    plans:plans,
    textes:[],
    percages:percages,
    pads:[],
    composants:[],
    padstacks:{},
    formes:{},
    formesuser:{},
    stats:{couches:CON.pile.length, empilage:CON.pile.length,
           nets:nets.length, pistes:pistes.length, arcs:0,
           plans:plans.length, percages:percages.length, pads:0,
           composants:0, textes:0}
  };
}

/* ==========================================================================
   Appliquer le dessin
   --------------------------------------------------------------------------
   LES VALEURS SAISIES À LA MAIN SONT MISES DE CÔTÉ PENDANT LE MODE, et cette
   précaution vaut d'être dite. `V.sur` garde, PAR NOM DE COUCHE, les
   épaisseurs et permittivités complétées sur des cartes importées dont le
   fichier était muet, et `ltPreparer()` leur donne la priorité sur ce que le
   document déclare. Ici le document n'est plus muet : il déclare exactement
   ce qu'on vient de choisir dans le panneau. Une surcharge d'un autre jour,
   portant le même nom de couche, écraserait donc en silence la valeur qu'on
   est en train de régler — on changerait l'εr sans que rien ne bouge. Les
   surcharges sont vidées à l'entrée du mode et relues à la sortie ; et
   `prefEcrire` est muselée pendant ce temps pour que ce vidage ne parte pas
   dans le stockage local.
   ========================================================================== */
let CON_SUR=null;                 // les surcharges mises de côté

/* LE RÔLE DES COUCHES EST LE SEUL À REVENIR DANS `V.sur`, et il le faut.
   `ltAutoRole()` devine le rôle d'une couche au taux de cuivre qu'elle porte :
   un patch qui couvre plus de 40 % de la carte est donc classé « masse »,
   alors qu'on vient d'écrire « signal / antenne » dans le panneau. La
   supposition est raisonnable sur une carte importée, où personne n'a rien
   déclaré ; ici elle contredit une décision explicite. `V.sur.role` est
   justement le chemin par lequel un rôle DÉCLARÉ l'emporte sur un rôle deviné
   — et comme `prefEcrire` est muselée, rien n'en sort vers le stockage local.

   Extrait de `conAppliquer` parce que le balayage en a besoin aussi : il refait
   le document pour chaque valeur de la cote, et un document construit sans ces
   rôles-là différerait du document de départ sur des couches qu'on n'a pas
   touchées — la comparaison qui décrit un point du balayage y verrait alors
   des modifications qui n'en sont pas. */
function conRolesDeclares(){
  V.sur={cu:{},gap_t:{},gap_er:{},role:{}};
  for(const e of CON.pile)
    if(e.k==="cu")
      V.sur.role[e.nom]=(e.role==="gnd"||e.role==="pwr")?e.role:"signal";
}

/* `sansPanneau` : une cote tapée au clavier refait le document mais ne
   redessine PAS le panneau — on perdrait le curseur du champ en cours de
   saisie, ce qui rend le réglage au clavier impraticable. */
function conAppliquer(recadrer,sansPanneau){
  if(!CON.actif)return;
  const modele=conModele();
  const vue={scale:V.vue.scale, ox:V.vue.ox, oy:V.vue.oy, flip:V.vue.flip};

  conRolesDeclares();
  mdlCharger(modele,"conception");
  for(const c of V.couches)c.visible=true;

  const accueil=document.getElementById("accueil");
  if(accueil)accueil.hidden=true;

  conReprendreSelection();
  pnlTout();
  if(recadrer||!(vue.scale>0))fit();
  else{ V.vue.scale=vue.scale; V.vue.ox=vue.ox; V.vue.oy=vue.oy;
        V.vue.flip=vue.flip; dessiner(); }

  antMaj(true);
  conHistPousser();
  if(!sansPanneau&&typeof conPanneauRendre==="function")conPanneauRendre();
  else if(typeof conBarreRendre==="function")conBarreRendre();
}

/* ==========================================================================
   Annuler, refaire
   --------------------------------------------------------------------------
   POURQUOI L'INSTANTANÉ, ET NON LE JOURNAL DES GESTES. Un journal retient
   l'ordre inverse de chaque commande — retirer la forme qu'on vient de poser,
   remettre le point qu'on vient de déplacer — et il faut alors écrire cet
   inverse pour CHAQUE geste, y compris ceux qu'on ajoutera plus tard. Un
   gabarit posé, lui, n'a pas d'inverse simple : il refait la carte, l'empilage,
   la bande et le port. L'instantané, lui, n'a rien à savoir de ce qui a changé.
   Le dessin entier tient dans quelques dizaines de kilo-octets de JSON, et une
   antenne ne se dessine pas en dix mille gestes : ce qui serait de la
   prodigalité sur un traitement de texte est ici gratuit.

   OÙ IL SE POUSSE, ET POURQUOI C'EST LE BON ENDROIT. `conAppliquer()` est
   appelée après chaque modification ACCEPTÉE — et seulement celles-là : une
   forme trop petite, un polygone à deux points, une cote négative n'y arrivent
   jamais. Le passage obligé qui rend le mode inoffensif sert donc aussi de
   point d'accroche à l'historique, et un geste ajouté demain y entrera sans
   qu'on ait rien à écrire.

   CE QUE L'INSTANTANÉ EMPORTE. Tout ce qu'un geste de dessin peut changer :
   les formes, la carte, l'empilage, la couche active, la fréquence visée, la
   fiche du gabarit — et, du côté simulation, LES PORTS ET LES BORNES DE LA
   BANDE, parce qu'un gabarit les réécrit (`conGabaritDebut`, `conPoser`).
   Annuler un patch sans rendre son port au dessin d'avant laisserait un port
   posé sur du cuivre effacé.

   CE QU'IL N'EMPORTE PAS, DÉLIBÉRÉMENT : le reste de `ANT` — maillage, arrêt,
   nombre de points de la bande, champ lointain. Ce sont des décisions de
   simulation, pas de dessin ; les défaire au Ctrl+Z surprendrait, et le champ
   lointain rallumé par un gabarit ne se regrette pas.
   ========================================================================== */

/* `pile[i]` est TOUJOURS l'état courant : annuler recule d'un cran, refaire
   avance, et une modification faite après une annulation coupe la branche
   abandonnée — c'est ce que fait tout le monde, et c'est ce qu'on attend. */
const CON_HIST={pile:[], i:-1, gel:false};
const CON_HIST_MAX=60;

function conEtatDessin(){
  return JSON.stringify({
    el:CON.elements, carte:CON.carte, pile:CON.pile, uid:CON.uid,
    modele:CON.modele, cible:CON.cible,
    cu:CON.coucheActive, net:CON.netActif, f:CON.fcible,
    gab:CON.gabarit, gabP:CON.gabaritP, gabT:CON.gabaritTouche,
    calc:CON.calcul,
    ports:ANT.ports, pa:ANT.portActif,
    bande:{f1:ANT.bande.f1, f2:ANT.bande.f2, fcible:ANT.bande.fcible}
  });
}

/* Repartir de l'état courant, sans passé. À l'entrée dans le mode et à
   l'ouverture d'un projet : l'historique de la séance précédente désignerait
   un dessin qui n'est plus là, et le premier Ctrl+Z ramènerait le travail de
   quelqu'un d'autre. */
function conHistRaz(){
  CON_HIST.pile=CON.actif?[conEtatDessin()]:[];
  CON_HIST.i=CON_HIST.pile.length-1;
}

function conHistPousser(){
  if(!CON.actif||CON_HIST.gel)return;
  const e=conEtatDessin();
  /* Un état identique au précédent n'est pas une modification. Le balayage
     refait le document pour chaque valeur puis remet le dessin en place par
     `conAppliquer` : sans ce test, quarante points de balayage pousseraient
     quarante fois le même dessin et enterreraient le geste d'avant. */
  if(CON_HIST.i>=0&&CON_HIST.pile[CON_HIST.i]===e)return;
  CON_HIST.pile.length=CON_HIST.i+1;
  CON_HIST.pile.push(e);
  if(CON_HIST.pile.length>CON_HIST_MAX)CON_HIST.pile.shift();
  CON_HIST.i=CON_HIST.pile.length-1;
}

function conPeutAnnuler(){ return CON.actif&&CON_HIST.i>0; }
function conPeutRefaire(){ return CON.actif&&CON_HIST.i<CON_HIST.pile.length-1; }

/* La sélection ne revient pas : après un retour en arrière, le rang d'une
   forme ne désigne plus forcément la même — et désigner la mauvaise forme
   est pire que n'en désigner aucune, puisque la suivante se règle au clavier. */
function conHistAller(j){
  const txt=CON_HIST.pile[j];
  if(txt==null)return false;
  const e=JSON.parse(txt);
  CON.elements=e.el;
  CON.carte=e.carte;
  CON.pile=e.pile;
  CON.uid=e.uid;
  CON.modele=e.modele||"";
  CON.cible=e.cible||CON.cible;
  CON.pileSel=Math.min(CON.pileSel,Math.max(CON.pile.length-1,0));
  CON.coucheActive=e.cu;
  CON.netActif=e.net;
  CON.fcible=e.f;
  CON.gabarit=e.gab;
  CON.gabaritP=e.gabP;
  CON.gabaritTouche=e.gabT;
  CON.calcul=e.calc;
  ANT.ports=e.ports;
  ANT.portActif=Math.min(e.pa,ANT.ports.length-1);
  ANT.bande.f1=e.bande.f1;
  ANT.bande.f2=e.bande.f2;
  ANT.bande.fcible=e.bande.fcible;
  CON.sel=-1;
  CON.courant=null;
  CON_HIST.i=j;
  /* Le gel : la reconstruction passe par `conAppliquer`, qui pousse. Sans lui,
     annuler écrirait l'état d'avant comme s'il était nouveau, et refaire
     n'aurait plus rien à rejouer. */
  CON_HIST.gel=true;
  try{ conAppliquer(false); }
  finally{ CON_HIST.gel=false; }
  return true;
}

function conAnnuler(){
  if(!conPeutAnnuler())return false;
  conHistAller(CON_HIST.i-1);
  if(typeof hint==="function")
    hint("Annulé — "+CON.elements.length+" forme(s). "+
         (conPeutAnnuler()?"Ctrl+Z encore, ou Ctrl+Y pour refaire."
                          :"C'est le début de la séance ; Ctrl+Y refait."));
  return true;
}

function conRefaire(){
  if(!conPeutRefaire())return false;
  conHistAller(CON_HIST.i+1);
  if(typeof hint==="function")
    hint("Refait — "+CON.elements.length+" forme(s).");
  return true;
}

/* Ce que l'assistant doit retenir d'un document à l'autre.

   LES INDEX NE SURVIVENT PAS À UNE RECONSTRUCTION, LES NOMS SI. Chaque
   modification du dessin refait le document : les objets de `ANT.formes`
   désignaient des polygones qui n'existent plus, et les garder ferait entrer
   dans le modèle du cuivre qui n'est nulle part. On les jette, et on redésigne
   par le NET — qui est de toute façon la bonne façon de désigner une antenne
   qu'on vient de dessiner soi-même : elle a un net, on l'a écrit. */
function conReprendreSelection(){
  ANT.formes=[];
  ANT.couches=new Set();
  for(const c of V.couches)if(c.cuivre)ANT.couches.add(c.i);

  ANT.nets=new Set();
  ANT.netMasse=-1;
  for(const n of V.parNet){
    if(!n)continue;
    if(n.nom==="GND"){ ANT.netMasse=n.i; continue; }
    if(n.pistes.length||n.plans.length||n.trous.length)ANT.nets.add(n.i);
  }

  /* Les ports gardent leur position, mais leurs couches doivent encore
     exister : on peut avoir retiré celle sur laquelle l'un d'eux était posé.
     TOUS sont repris, et pas seulement celui qu'on règle — un port 2 qui
     désigne une couche disparue fait refuser la simulation entière, et le
     message parlerait d'un port qu'on n'a pas touché depuis dix minutes. */
  const noms=V.couches.filter(c=>c.cuivre).map(c=>c.nom);
  for(const p of ANT.ports){
    if(!p.pose)continue;
    if(noms.indexOf(p.de)<0)p.de=noms[0]||"";
    if(noms.indexOf(p.a)<0)p.a=noms.length>1?noms[noms.length-1]:"";
  }
}

/* ==========================================================================
   Entrer, sortir
   ========================================================================== */
/* `prefEcrire` écrit les préférences d'affichage ET les surcharges
   d'empilage. Pendant le mode conception, les surcharges sont vidées et les
   couches sont celles qu'on vient d'inventer : les enregistrer effacerait ce
   que l'utilisateur a saisi sur ses vraies cartes. On l'enveloppe donc pour
   qu'elle ne fasse rien tant que le mode est actif — même procédé que
   15-overlay2d.js et 19-demarrage.js, et pour la même raison : le fichier
   enveloppé appartient à la visionneuse et continuera d'évoluer de son côté. */
(function(){
  const base=window.prefEcrire;
  if(typeof base!=="function")return;
  window.prefEcrire=function(){ if(CON.actif)return; return base(); };
})();

/* Le bouton de la barre d'outils dit dans quel mode on est. Un mode qui
   change le sens d'un clic sur la carte sans que rien ne le montre est un
   piège : on croit désigner du cuivre et l'on en pose. */
function conBoutonEtat(){
  const b=document.getElementById("bConcevoir");
  if(b)b.classList.toggle("on",CON.actif);
  const h=document.getElementById("vueHint");
  if(h&&CON.actif&&typeof conAide==="function")h.textContent=conAide();
}

function conEntrer(){
  if(typeof wsShow==="function")wsShow("conception");
  if(CON.actif){
    if(typeof conPanneauRendre==="function")conPanneauRendre();
    return;
  }
  CON_SUR=V.sur;
  CON.actif=true;
  document.body.classList.add("conception");
  if(!CON.pile.length)CON.pile=conPileDefaut();
  if(conCoucheDeUid(CON.coucheActive)<0)CON.coucheActive=conPremierCuivre();
  /* PAGE BLANCHE : ON COMMENCE PAR L'EMPILAGE. Rien n'est dessiné, donc rien
     n'est perdu à changer le nombre de couches ou le stratifié — et tout
     serait à refaire si la question venait après le premier patch. Un dessin
     déjà commencé, lui, ne se fait pas interrompre par une question. */
  CON.demarrage=!CON.elements.length;

  conBoutonEtat();
  conAppliquer(true);
  /* L'entrée dans le mode est le début de la séance de dessin : rien avant
     elle ne s'annule. */
  conHistRaz();
  hint("Mode conception : dessinez le cuivre, ou partez d'un gabarit "+
       "d'antenne. Ce qui est dessiné part au solveur exactement comme s'il "+
       "venait d'un fichier.");
}

function conSortir(){
  if(!CON.actif)return;
  CON.actif=false;
  CON.outil="select";
  CON.courant=null;
  document.body.classList.remove("conception","con-dessin");
  /* Les surcharges reviennent telles qu'elles étaient : le mode ne doit rien
     avoir changé aux cartes importées. */
  V.sur=CON_SUR||{cu:{},gap_t:{},gap_er:{},role:{}};
  CON_SUR=null;
  if(V.modele)ltPreparer();
  conBoutonEtat();
  if(typeof conPanneauRendre==="function")conPanneauRendre();
  redessiner();
  hint("Mode conception quitté. La carte dessinée reste chargée : "+
       "l'assistant continue de travailler dessus.");
}

/* Ouvrir un fichier pendant le mode conception : le fichier gagne. Laisser le
   mode actif ferait cohabiter un dessin et une carte réelle dans le même `V`,
   et le premier coup de crayon effacerait la seconde. */
(function(){
  const base=window.poser;
  if(typeof base!=="function")return;
  window.poser=function(modele,nom,vue){
    if(CON.actif&&nom!=="conception")conSortir();
    return base(modele,nom,vue);
  };
})();
