"use strict";
/* =============================================================================
   Antenne openEMS — 10-etat.js
   Ce que l'utilisateur a décidé, et rien d'autre.

   LA SÉPARATION QUI COMPTE ICI. `V` (02-modele.js) porte la CARTE : ce que le
   fichier IPC-2581 déclare, ce qu'on ne choisit pas. `ANT`, ci-dessous, porte
   la SIMULATION : ce que l'utilisateur désigne, saisit et pose. Les deux ne se
   mélangent jamais — ouvrir une autre carte remet `ANT` à neuf sans toucher à
   ce que la visionneuse sait faire, et changer un réglage de simulation ne
   peut pas altérer la lecture du fichier.

   Une exception assumée : l'empilage. Les épaisseurs et permittivités que le
   fichier ne déclare pas se saisissent dans `V.sur`, parce que c'est déjà là
   que la visionneuse les range et que `ltPreparer()` sait les relire. Les
   dupliquer ici aurait fait deux vérités pour une seule grandeur.
   ============================================================================= */

/* Les six étapes, dans l'ordre où les décisions se prennent. Cet ordre n'est
   pas décoratif : on ne peut pas poser un port avant de savoir entre quelles
   couches il va, ni dimensionner une boîte d'air avant de connaître la bande
   — c'est la longueur d'onde la plus basse qui donne la marge. */
const ANT_ETAPES=[
  {id:"cuivre",   titre:"Le cuivre",    sous:"quel métal part au solveur"},
  {id:"empilage", titre:"L'empilage",   sous:"épaisseurs, permittivités, pertes"},
  {id:"objets",   titre:"Autour",       sous:"ce qui n'est pas sur la carte"},
  {id:"bande",    titre:"La bande",     sous:"ce qu'on veut mesurer, et où"},
  {id:"port",     titre:"Les ports",    sous:"par où l'onde entre, et ce qui en ressort"},
  {id:"boite",    titre:"La boîte",     sous:"air, PML, maillage"},
  {id:"calcul",   titre:"Le calcul",    sous:"arrêt, champ lointain, lancement"}
];

const ANT={
  etape:0,

  /* -- 1. le cuivre ------------------------------------------------------ */
  /* Les nets retenus, par index. Un Set et non un tableau : on ajoute et on
     retire au clic, et l'ordre n'a aucun sens. */
  nets:new Set(),

  /* Les formes retenues UNE À UNE, quand le net ne répond pas de la question.

     UN FICHIER NE DÉCLARE PAS TOUJOURS SA CONNECTIVITÉ. Un IPC-2581 exporté
     sans netlist range tout son cuivre dans un fourre-tout que le parseur
     nomme « Non-Net » : désigner ce net-là, c'est prendre la carte entière,
     antenne et masse confondues, et le port n'excite plus rien. Le net n'est
     qu'un index de confort ; ce qui part au solveur, ce sont des polygones.
     On garde donc aussi la liste des objets cliqués — piste, versement,
     pastille, perçage —, et elle marche quelle que soit la qualité du
     fichier.

     Elle sert aussi quand le net existe mais qu'il est plus gros que
     l'antenne : une antenne coupée par un condensateur d'accord n'est pas un
     net, c'est deux morceaux d'un net, et on les prend à la main.

     Chaque entrée : {k, c, o} — genre, index de couche, OBJET DU MODÈLE. On
     garde la référence et non une copie : `antRaz` vide tout à l'ouverture
     d'un autre fichier, donc aucune entrée ne peut survivre à la carte qui
     l'a produite. */
  formes:[],
  netMasse:-1,                 // index du net de masse, -1 = aucun
  couches:new Set(),           // index des couches de cuivre à modéliser
  avecVias:true,               // les perçages métallisés des nets retenus
  avecPastilles:true,          // les pastilles des nets retenus

  /* -- 2. l'empilage ----------------------------------------------------- */
  /* « feuille » : surface sans épaisseur qui porte quand même la résistance
     du cuivre réel. C'est le bon réglage dans l'immense majorité des cas —
     voir le commentaire de python/openems_modele.py. */
  modeleCuivre:"feuille",

  /* Le modèle de pertes du diélectrique. « kappa » : une conductivité
     équivalente, juste à UNE seule fréquence. « debye » : un jeu de pôles de
     relaxation qui tient tanδ plat sur toute la bande — ce que fait un
     stratifié réel. `f_kappa` à zéro veut dire « le centre de la bande ». */
  pertes:{mode:"kappa", f_kappa:0},

  /* -- 3. ce qui n'est pas sur la carte ----------------------------------- */
  /* Fil, cylindre, boîte, sphère : un monopole, une vis, un boîtier métallique,
     un radôme. Saisis à la main, en coordonnées, dans l'unité du fichier. */
  primitives:[],

  /* -- 3. la bande ------------------------------------------------------- */
  bande:{f1:2.4e9, f2:2.5e9, n:401, fcible:2.45e9},
  /* L'unité de saisie des fréquences. Elle n'existe pas par confort : écrire
     « 868 » dans un champ étiqueté GHz est une faute qui ne se voit pas, et
     elle ne produit ni refus ni champ vide — seulement une bande cent mille
     fois trop haute et un résultat qui a l'air d'en être un. */
  uniteF:"GHz",

  /* -- 4. les ports ------------------------------------------------------ */
  /* UN TABLEAU, ET NON UN PORT. Un seul port donne le S₁₁ ; deux donnent en
     plus le S₂₁, c'est-à-dire la seule grandeur qui dise si deux antennes se
     gênent. Elle ne se déduit d'aucun S₁₁, et c'est elle qui décide du sort
     d'un produit à deux antennes.

     UN SEUL EXCITE À LA FOIS, et ce n'est pas un réglage mais une définition :
     S(j,i) vaut « ce qui sort de j QUAND SEUL i excite ». Les autres sont
     posés en charge — ils mesurent, ils n'émettent pas. La colonne du tableau
     S qu'on obtient est celle du port excité ; l'autre colonne demande une
     seconde simulation, l'excitation déplacée. */
  ports:[antPortNeuf()],
  /* Celui que le clic pose et que les champs règlent. Ce n'est pas forcément
     l'excité : on peut vouloir déplacer le port 2 pendant que le 1 excite. */
  portActif:0,
  /* Vrai pendant qu'on attend le clic qui posera le port. Déclaré ici plutôt
     que créé au vol : un état qui change le sens d'un clic sur la carte doit
     se lire dans la liste des états, pas se découvrir dans un gestionnaire. */
  posePort:false,
  /* Combien de vias sont entrés dans le modèle avec une portée SUPPOSÉE
     traversante faute de déclaration. Rempli par `antVias`, affiché à
     l'étape 1 : « vide » ne veut pas dire « traversant ». */
  viasSupposes:0,

  /* -- 5. la boîte ------------------------------------------------------- */
  /* Zéro veut dire « laisse l'assistant décider » : le serveur remplace alors
     par le quart de la longueur d'onde basse et le dit. */
  boite:{mx:0, my:0, mz_haut:0, mz_bas:0, pml:8},
  maillage:{res_air:0, res_die:0, tiers:true},

  /* -- 6. le calcul ------------------------------------------------------ */
  arret:{energie:-40, nmax:30000},
  /* Le balayage parametrique : une cote, une plage, une simulation par
     valeur. `source` designe la cote dans la liste que 24-balayage.js dresse
     a partir de ce qui est a l'ecran. */
  /* Le balayage. `croise` ouvre un SECOND axe : les deux cotes varient
     ensemble, et l'on obtient N×M simulations au lieu de N. C'est le couple
     qui décide d'un patch alimenté par ligne encastrée — la longueur pose la
     résonance, l'encastrement pose l'adaptation, et les lire l'un après
     l'autre fait tourner en rond. Le prix est un PRODUIT, pas une somme :
     6×6 font 36 simulations, et le garde-fou porte sur ce produit. */
  balayage:{actif:false, source:"", nom:"", min:0, max:0, pas:0,
            croise:false, source2:"", min2:0, max2:0, pas2:0,
            points:[], devis:null},
  nf2ff:{actif:true},
  /* L'enregistrement des champs. Le mode fréquentiel rend UN champ complexe
     par fréquence ; le temporel, un fichier PAR PAS DE TEMPS — des dizaines
     de milliers. Le premier suffit pour voir où passe le courant. */
  dumps:{actif:false, types:["J"], mode:"frequentiel", region:"plan_z",
         z:0, x:0, y:0, sous_ech:2},

  /* -- ce qui revient du serveur ----------------------------------------- */
  etatServeur:null,            // /api/openems : ce que ce poste sait faire
  modele:null,                 // dernier modèle normalisé, ou null
  refus:null,                  // {message, conseil} quand il n'y en a pas
  tache:null,                  // {id, etat, avancement, …} pendant le calcul
  resultat:null,               // S11, Z, ROE, champ lointain
  vue:"2d",
  vueMaillage:false
};

/* ==========================================================================
   Les ports
   --------------------------------------------------------------------------
   `ANT.port` DÉSIGNE LE PORT COURANT, et c'est un accesseur, pas un champ.
   Tout ce qui ne parle que d'UN port — la pose au clic, les gabarits, le
   récapitulatif, l'export Touchstone — continue d'écrire `ANT.port.x` sans
   rien savoir de la liste, et écrit dans celui qu'on est en train de régler.
   Un tableau visible ET un nom simple pour le cas courant : les deux, plutôt
   que de choisir.
   ========================================================================== */

/* Les valeurs d'un port neuf. Une fonction et non une constante : deux ports
   partageraient sinon le même objet, et déplacer l'un déplacerait l'autre. */
function antPortNeuf(exc){
  return {pose:false, type:"localise", x:0, y:0, de:"", a:"", dir:"z",
          w:0.5, l:0.5, ecart:0.2, R:50, excite:exc!==false,
          /* Le connecteur, quand `type` vaut « coaxial ». Ce sont les cotes
             d'une SMA ordinaire : âme de 1,27 mm de diamètre, diélectrique
             PTFE de 4,1 mm, ce qui donne 49 Ω — un coaxial n'est à 50 Ω que
             par le rapport de ses deux rayons. */
          ra:0.635, rb:2.05, er:2.05, ep_gaine:0.3, longueur:3,
          /* La ligne d'alimentation DÉCLARÉE entre le port et le pied de
             l'antenne. Zéro veut dire « non déclarée », et c'est le défaut :
             l'impédance est alors lue là où le port est posé, sans rien
             ajouter. Voir `_ligne_alim` dans python/openems_modele.py. */
          ligne_d:0, ligne_w:0};
}

Object.defineProperty(ANT,"port",{
  get:function(){ return ANT.ports[ANT.portActif]||ANT.ports[0]; },
  set:function(v){ ANT.ports[ANT.portActif]=v; }
});

/* Le port excité, celui qui donne le S₁₁. */
function antPortExcite(){
  return ANT.ports.find(p=>p.excite)||ANT.ports[0];
}

/* Exciter celui-ci, et lui seul. Deux excitations simultanées superposeraient
   leurs ondes, et aucun paramètre S ne se déduirait du mélange — le serveur
   le refuse, autant ne jamais le produire. */
function antPortExciter(i){
  ANT.ports.forEach(function(p,k){ p.excite=(k===i); });
}

function antPortAjouter(){
  if(ANT.ports.length>=8)return false;
  const modele=ANT.port;
  const p=antPortNeuf(false);
  /* Les couches et l'impédance du port courant : un second port relie presque
     toujours les mêmes deux couches que le premier, et le retaper serait une
     punition. La POSITION, elle, n'est pas reprise — deux ports au même
     endroit sont un court-circuit, pas un couplage. */
  p.de=modele.de; p.a=modele.a; p.R=modele.R; p.dir=modele.dir;
  p.w=modele.w; p.l=modele.l;
  ANT.ports.push(p);
  ANT.portActif=ANT.ports.length-1;
  return true;
}

function antPortRetirer(i){
  if(ANT.ports.length<2)return false;
  const partait=ANT.ports[i].excite;
  ANT.ports.splice(i,1);
  if(partait)ANT.ports[0].excite=true;
  ANT.portActif=Math.min(ANT.portActif,ANT.ports.length-1);
  return true;
}

/* Le document décrit un port. Les champs du coaxial n'y sont que s'il en est
   un : un document qui porterait un rayon d'âme sur un port localisé
   laisserait croire qu'il compte pour quelque chose. */
function antPortDoc(p,i){
  const d={type:p.type||"localise", nom:"port "+(i+1),
           dir:p.dir, x:p.x, y:p.y, w:p.w, l:p.l, ecart:p.ecart,
           R:p.R, de:p.de, a:p.a, excite:!!p.excite};
  if(p.type==="coaxial"){
    d.ra=p.ra; d.rb=p.rb; d.er=p.er;
    d.ep_gaine=p.ep_gaine; d.longueur=p.longueur;
  }else if(p.ligne_d>0&&p.ligne_w>0){
    /* UN COAXIAL N'EN DÉCLARE PAS : il porte déjà son propre déport de plan
       de référence, ramené à la surface de la carte, et en empiler un second
       reviendrait à compter deux fois. */
    d.ligne={longueur:p.ligne_d, largeur:p.ligne_w};
  }
  return d;
}

/* L'impédance caractéristique d'un coaxial : 60/√εr · ln(b/a). Calculée aussi
   côté page, et pas seulement au serveur, parce qu'elle doit s'afficher
   PENDANT qu'on tape les rayons — un connecteur qui ne fait pas 50 Ω ajoute sa
   désadaptation à celle de l'antenne, et on croit alors corriger l'antenne
   alors qu'on corrige le câble. */
function antCoaxZ0(p){
  if(!(p.ra>0)||!(p.rb>p.ra)||!(p.er>0))return 0;
  return 59.9585/Math.sqrt(p.er)*Math.log(p.rb/p.ra);
}

/* Multiplicateur de l'unité de fréquence affichée. */
const ANT_UNITES_F={"Hz":1, "kHz":1e3, "MHz":1e6, "GHz":1e9};
function antKf(){ return ANT_UNITES_F[ANT.uniteF]||1e9; }

/* Millimètres par unité du fichier. Tout ce qui est envoyé au serveur reste
   dans l'unité du fichier — c'est le serveur qui convertit, une fois, et le
   document porte l'unité. */
function antUnite(){ return V.unite==="in" ? "in" : "mm"; }

/* ==========================================================================
   Remise à neuf
   ========================================================================== */
/* Appelée à chaque ouverture de fichier. Elle ne laisse RIEN de la carte
   précédente : garder une sélection de nets d'une autre carte produirait une
   simulation sur des index qui ne désignent plus le même cuivre — une faute
   silencieuse, et la pire espèce. */
function antRaz(){
  ANT.etape=0;
  ANT.nets=new Set();
  ANT.formes=[];
  ANT.netMasse=-1;
  ANT.couches=new Set();
  ANT.ports=[antPortNeuf()]; ANT.portActif=0;
  ANT.posePort=false; ANT.viasSupposes=0;
  ANT.balayage={actif:false, source:"", nom:"", min:0, max:0, pas:0,
                points:[], devis:null};
  document.body.classList.remove("pose-port");
  ANT.boite={mx:0,my:0,mz_haut:0,mz_bas:0,pml:8};
  ANT.maillage={res_air:0,res_die:0,tiers:true};
  ANT.primitives=[];
  ANT.dumps.actif=false;
  ANT.modele=null; ANT.refus=null; ANT.tache=null; ANT.resultat=null;

  /* Ce qu'on peut deviner sans rien demander : les couches de cuivre qui
     portent du cuivre, et le net de masse le plus probable. Deviner n'est pas
     décider — tout reste modifiable, et l'assistant dit ce qu'il a supposé. */
  antDevinerCouches();
  antDevinerMasse();
}

/* Les couches de cuivre qui portent quelque chose. Une couche vide dans le
   modèle FDTD ne coûte rien de faux, mais elle encombre la liste. */
function antDevinerCouches(){
  for(const c of V.couches)
    if(c.cuivre && (c.pistes.length||c.plans.length||c.pads.length||c.arcs.length))
      ANT.couches.add(c.i);
}

/* Le net de masse : celui que `ltPreparer` a désigné comme tel sur la plus
   grande couche de plan, à défaut celui dont le nom le dit. */
function antDevinerMasse(){
  let meilleur=-1, aire=0;
  for(const n of V.parNet){
    if(!n||!n.plans.length)continue;
    if(!/^(GND|AGND|DGND|MASSE|VSS|0V|GROUND)/i.test(n.nom))continue;
    let a=0;
    for(const g of n.plans)a+=mdlAirePlan(g);
    if(a>aire){aire=a;meilleur=n.i;}
  }
  if(meilleur<0){
    /* Aucun nom ne le dit : on prend le net qui couvre le plus de surface en
       versements, quel que soit son nom. Sur une carte dont les nets sont
       numérotés, c'est la seule piste qui reste.

       SAUF UN FOURRE-TOUT. Sur un fichier sans connectivité, le plus grand
       versement est dans le sac commun, et le retenir comme masse ferait
       rentrer la carte entière par la porte de derrière — antenne comprise,
       ce qui court-circuite le port. Mieux vaut ne rien deviner : la masse se
       désigne alors au clic, comme le reste. */
    for(const n of V.parNet){
      if(!n||!n.plans.length||antNetFourreTout(n.i))continue;
      let a=0;
      for(const g of n.plans)a+=mdlAirePlan(g);
      if(a>aire){aire=a;meilleur=n.i;}
    }
  }
  ANT.netMasse=meilleur;
}

/* ==========================================================================
   L'antenne, tirée de la sélection de la visionneuse
   ========================================================================== */
/* Un clic sur la carte désigne du cuivre ; `V.sel` le sait déjà. Ce qui suit
   fait le pont : ce que l'utilisateur vient de cliquer devient l'antenne,
   sans qu'il ait à la retrouver dans une liste de trois cents noms. Ctrl+clic
   empile — une antenne coupée par un condensateur d'accord n'est pas un net
   mais deux morceaux. */
function antNetDe(s){
  if(!s)return -1;
  if(typeof s.net==="number"&&s.net>=0)return s.net;
  if(s.o&&typeof s.o.n==="number"&&s.o.n>=0)return s.o.n;
  return -1;
}

/* ==========================================================================
   Les formes désignées, quand le net ne dit rien
   ========================================================================== */
/* LES NOMS QUI NE SONT PAS DES NETS. IPC-2581 n'oblige pas à porter `net` sur
   un `<Set>` ; quand l'attribut manque, le parseur pose « Non-Net »
   (python/ipc2581_parser.py) parce qu'il faut bien ranger le cuivre quelque
   part. Ce n'est pas une connectivité, c'est un fourre-tout : il tient
   l'antenne, la masse et les alimentations dans le même sac. Le retenir comme
   « net de l'antenne » donnerait un modèle où les deux bornes du port sont le
   même conducteur — un S11 propre, et faux. On le reconnaît donc, et on
   retombe sur la forme cliquée, qui elle désigne quelque chose.

   La liste est courte et le restera : un net numéroté (« 12 », « $3 ») EST
   un net — un outil qui numérote sa netlist en déclare quand même une, et le
   prendre pour un fourre-tout casserait la sélection sur les cartes qui vont
   bien. On ne reconnaît que ce qui dit explicitement « pas de net ». */
const ANT_FOURRETOUT=/^(non[-_ ]?net|no[-_ ]?net|nonet|unnamed|noname|none|nc|n\/c)$/i;

function antNetFourreTout(i){
  const n=V.parNet[i];
  return !!n&&ANT_FOURRETOUT.test((n.nom||"").trim());
}

/* La forme du modèle que désigne une entrée de sélection, s'il y en a une.
   Les arcs n'y sont pas : `designer` ne les teste pas non plus — un arc se
   prend par son net, ou par la piste qui le prolonge. */
function antFormeDe(s){
  if(!s)return null;
  if(s.type==="piste"&&s.piste)  return {k:"piste",c:s.piste.c,o:s.piste};
  if(s.type==="plan"&&s.plan)    return {k:"plan", c:s.plan.c, o:s.plan};
  if(s.type==="pad"&&s.pastille) return {k:"pad",  c:s.pastille.c,o:s.pastille};
  if(s.type==="percage"&&s.trou) return {k:"via",  c:-1,o:s.trou};
  return null;
}

function antFormeMeme(a,b){ return !!a&&!!b&&a.k===b.k&&a.o===b.o; }

/* Le libellé d'un jeton. Il dit le genre et la couche, pas un identifiant :
   une piste n'a pas de nom dans le fichier, et en inventer un ne se
   retrouverait nulle part sur la carte. */
function antFormeNom(f){
  const c=(f.c>=0&&V.couches[f.c])?V.couches[f.c].nom:"";
  const ou=c?" · "+c:"";
  if(f.k==="piste")return "piste"+ou;
  if(f.k==="plan") return "versement"+ou;
  if(f.k==="pad")  return "pastille"+(f.o.hote&&f.o.hote.ref?" "+f.o.hote.ref:"")+ou;
  if(f.k==="via")  return "via";
  return "forme";
}

/* Ce que la sélection désigne, rangé en deux tas : les nets quand il y en a
   de vrais, les formes sinon.

   LE TRI SE FAIT ENTRÉE PAR ENTRÉE et non sur l'ensemble. Un clic sur une
   piste nettée suivi d'un Ctrl+clic sur du cuivre sans net doit donner un net
   ET une forme : c'est exactement ce qui a été montré du doigt, et rien
   d'autre. */
function antPriseDeLaSelection(){
  const nets=new Set(), formes=[];
  for(const e of (V.sel||[])){
    const s=e&&e.s;
    if(!s)continue;
    const n=antNetDe(s), f=antFormeDe(s);
    if(n>=0&&!antNetFourreTout(n))nets.add(n);
    else if(f)formes.push(f);
    else if(n>=0)nets.add(n);        // un fourre-tout sans forme vaut mieux que rien
  }
  if(!nets.size&&!formes.length&&V.net>=0)nets.add(V.net);
  return {nets:nets,formes:formes};
}

/* Ajouter sans doubler : cliquer deux fois la même piste ne doit pas la faire
   entrer deux fois dans le modèle. Renvoie ce qui a réellement été ajouté. */
function antAjouterFormes(liste){
  let n=0;
  for(const f of liste){
    if(ANT.formes.some(g=>antFormeMeme(g,f)))continue;
    ANT.formes.push(f); n++;
  }
  return n;
}

/* ==========================================================================
   Le document envoyé au serveur
   ========================================================================== */
/* C'est LE point de contact avec python/openems_modele.py, et il est décrit
   là-bas clé par clé. Tout y est dans l'unité du fichier ; les fréquences
   sont en hertz, toujours — l'unité choisie dans l'interface est convertie
   ici, une fois, et n'existe plus au-delà. */
function antDocument(){
  const cuivre=antCuivreDuModele();
  return {
    nom:V.fichier||"antenne",
    unite:antUnite(),
    modele_cuivre:ANT.modeleCuivre,
    empilage:antEmpilage(),
    cuivre:cuivre.blocs,
    vias:cuivre.vias,
    ports:ANT.ports.map(antPortDoc),
    bande:{f1:ANT.bande.f1, f2:ANT.bande.f2, n:ANT.bande.n,
           fcible:ANT.bande.fcible},
    boite:{mx:ANT.boite.mx, my:ANT.boite.my,
           mz_haut:ANT.boite.mz_haut, mz_bas:ANT.boite.mz_bas,
           pml:ANT.boite.pml},
    maillage:{res_air:ANT.maillage.res_air, res_die:ANT.maillage.res_die,
              tiers:ANT.maillage.tiers},
    arret:{energie:ANT.arret.energie, nmax:ANT.arret.nmax},
    nf2ff:{actif:ANT.nf2ff.actif},
    pertes:{mode:ANT.pertes.mode, f_kappa:ANT.pertes.f_kappa},
    primitives:ANT.primitives,
    dumps:{actif:ANT.dumps.actif, types:ANT.dumps.types.slice(),
           mode:ANT.dumps.mode, region:ANT.dumps.region,
           z:ANT.dumps.z, x:ANT.dumps.x, y:ANT.dumps.y,
           sous_ech:ANT.dumps.sous_ech, f:[ANT.bande.fcible]}
  };
}

/* L'empilage tel que le serveur l'attend : un tableau à plat, conducteurs et
   diélectriques mêlés, dans l'ordre de séquence du fichier. `LT.pile` le
   porte déjà — c'est `ltPreparer()` qui l'a dressé, en tenant compte des
   valeurs saisies à la main dans `V.sur`. On n'a plus qu'à le traduire. */
/* La conductivité que le document DE LA CARTE déclare pour ce conducteur, ou
   zéro. Elle est relue ici, sur `V.modele.empilage`, et non portée par `LT` :
   `ltPreparer()` appartient à la visionneuse, qui évoluera de son côté, et
   cette grandeur ne sert qu'à la simulation. Un fichier IPC-2581 ne la
   déclare jamais — il ne dit pas de quel métal est sa couche —, mais le mode
   conception, lui, la choisit : une antenne sérigraphiée à l'encre argent est
   dix fois plus résistive que du cuivre, et ça se voit sur le rendement. */
function antSigmaDe(nom){
  const t=(V.modele&&V.modele.empilage)||[];
  for(const e of t)
    if(e&&e.nom===nom&&isFinite(e.sigma)&&e.sigma>0)return +e.sigma;
  return 0;
}

function antEmpilage(){
  const k=(V.unite==="in")?(1/25.4):1;       // LT est en mm, le doc en unité fichier
  const out=[];
  LT.pile.forEach(function(e,rang){
    if(e.cuivre){
      const cu=LT.cu.find(c=>c.rang===rang);
      const sigma=antSigmaDe(e.nom);
      out.push({nom:e.nom, cuivre:true, seq:rang,
                ep:(cu?cu.ep:e.ep)*k,
                role:cu?cu.role:"signal",
                ...(sigma?{sigma:sigma}:{})});
    }else{
      out.push({nom:e.nom, cuivre:false, seq:rang, ep:e.ep*k,
                er:e.er||0, df:e.df||0});
    }
  });
  /* Les intervalles saisis à la main ne sont pas dans `LT.pile` : ils vivent
     dans `LT.gap`, qui les porte entre deux conducteurs. Quand le fichier ne
     déclare aucun diélectrique entre deux cuivres — cas courant d'un empilage
     qui ne liste que ses conducteurs —, la pile n'a rien à offrir et c'est
     l'intervalle saisi qui doit prendre sa place. */
  const out2=[];
  for(let i=0;i<out.length;i++){
    out2.push(out[i]);
    if(!out[i].cuivre)continue;
    const suivant=out[i+1];
    if(!suivant||!suivant.cuivre)continue;         // il y a déjà quelque chose
    const g=LT.gap.find(g=>g.a===out[i].nom&&g.b===suivant.nom);
    if(!g||!(g.t>0))continue;
    out2.push({nom:g.cle, cuivre:false, seq:out[i].seq+0.5,
               ep:g.t*k, er:g.er||0, df:g.df||0});
  }
  return out2;
}

/* ==========================================================================
   Mémoire des réglages
   --------------------------------------------------------------------------
   Une bande, une cible, un mode de cuivre se saisissent une fois et servent
   longtemps : les reperdre à chaque ouverture de fichier serait une punition.
   La SÉLECTION, elle, n'est pas gardée — elle désigne du cuivre par index, et
   ces index ne veulent rien dire sur une autre carte.
   ========================================================================== */
const ANT_CLE="openems-antenne.reglages.v1";

function antReglagesEcrire(){
  try{
    localStorage.setItem(ANT_CLE,JSON.stringify({
      uniteF:ANT.uniteF, bande:ANT.bande, modeleCuivre:ANT.modeleCuivre,
      boite:{pml:ANT.boite.pml}, maillage:{tiers:ANT.maillage.tiers},
      arret:ANT.arret, nf2ff:ANT.nf2ff, portR:ANT.port.R,
      pertes:ANT.pertes, dumps:ANT.dumps
    }));
  }catch(e){}
}

function antReglagesLire(){
  let j=null;
  try{ j=JSON.parse(localStorage.getItem(ANT_CLE)||"null"); }catch(e){}
  if(!j||typeof j!=="object")return;
  if(ANT_UNITES_F[j.uniteF])ANT.uniteF=j.uniteF;
  if(j.bande&&j.bande.f1>0&&j.bande.f2>j.bande.f1)Object.assign(ANT.bande,j.bande);
  if(["feuille","pec","volume"].indexOf(j.modeleCuivre)>=0)
    ANT.modeleCuivre=j.modeleCuivre;
  if(j.boite&&j.boite.pml>=4&&j.boite.pml<=20)ANT.boite.pml=j.boite.pml|0;
  if(j.maillage)ANT.maillage.tiers=!!j.maillage.tiers;
  if(j.arret)Object.assign(ANT.arret,j.arret);
  if(j.nf2ff)ANT.nf2ff.actif=!!j.nf2ff.actif;
  if(j.portR>0)ANT.port.R=j.portR;
  if(j.pertes&&(j.pertes.mode==="kappa"||j.pertes.mode==="debye"))
    ANT.pertes={mode:j.pertes.mode, f_kappa:+j.pertes.f_kappa||0};
  if(j.dumps&&typeof j.dumps==="object"){
    /* La SÉLECTION n'est pas gardée — elle désigne du cuivre par index — mais
       les réglages d'enregistrement, si : ce sont des préférences. En
       revanche `actif` repart à faux, pour qu'une carte ouverte demain ne
       remplisse pas un disque sans qu'on l'ait demandé. */
    Object.assign(ANT.dumps, j.dumps, {actif:false});
    if(!Array.isArray(ANT.dumps.types)||!ANT.dumps.types.length)
      ANT.dumps.types=["J"];
  }
}
