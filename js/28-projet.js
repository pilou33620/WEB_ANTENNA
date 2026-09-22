"use strict";
/* =============================================================================
   Antenne openEMS — 28-projet.js
   Choisir où l'on range son travail, et reprendre celui d'hier.

   CE QUE LE STOCKAGE LOCAL NE SAIT PAS FAIRE. Jusqu'ici, ce qui survivait à
   un rechargement tenait dans `localStorage` : des préférences d'affichage
   (06-ouverture.js) et des réglages de simulation (10-etat.js). C'est le bon
   endroit pour des préférences — c'est le pire pour du travail. Le stockage
   local n'est pas un dossier : il ne se sauvegarde pas, ne se copie pas sur
   une clé, ne se met pas sur un serveur de fichiers, ne se compare pas à la
   version d'avant, et le navigateur l'efface sans prévenir quand on « vide
   les données de navigation ». Un dessin d'antenne qui a demandé trois
   heures n'a rien à y faire.

   UN PROJET EST DONC UN DOSSIER, ÉCRIT PAR LE SERVEUR. Le partage des rôles
   est décrit dans python/projet.py ; côté page, ce module ne fait que deux
   choses, et elles sont exactement inverses l'une de l'autre :

     `prjCapturer()`  l'état de la page  ->  un document JSON
     `prjAppliquer()` un document JSON   ->  l'état de la page

   TOUT CE QUI SE CAPTURE EST DÉSIGNÉ PAR UN NOM OU PAR UN RANG, JAMAIS PAR
   UNE RÉFÉRENCE. `ANT.formes` porte des objets du modèle — les polygones
   eux-mêmes —, et ces objets ne survivent pas à un aller-retour par le
   disque. On les range par leur rang dans le document de la carte, et la
   carte est enregistrée AVEC : rouvrir le projet recharge exactement le même
   document, donc exactement les mêmes rangs. C'est ce qui rend la reprise
   fidèle sur une carte importée, là où enregistrer « le net n° 12 » aurait
   suffi sur une carte dessinée mais pas sur un fichier sans netlist.

   CE QUI N'EST PAS DANS LE PROJET : la disposition des panneaux (elle
   appartient au poste, pas au travail — voir 90-workspace.js) et la tâche de
   calcul en cours. Une simulation tourne dans un processus du serveur ; la
   reprendre au vol demanderait de rattacher un suivi à un identifiant qui
   peut avoir expiré, pour regarder défiler un journal qu'on n'a pas lancé.
   Ce qui est gardé, c'est son RÉSULTAT — les courbes —, et le dossier de
   calcul, qui reste sur le disque à côté du projet.
   ============================================================================= */

const PRJ_ROUTE="/api/projet";

const PRJ={
  dispo:false,
  racine:"",                   // le dossier de travail, tel que le serveur le voit
  defaut:"",
  projets:[],                  // ce que la racine contient déjà
  nom:"",                      // le projet ouvert, "" si aucun
  enregistre:0,                // quand, en millisecondes
  /* Vrai dès qu'un geste a changé quelque chose depuis le dernier
     enregistrement. Il ne prétend pas à la finesse : il se lève sur toute
     mise à jour du modèle ou du dessin, ce qui couvre tout ce qui compte et
     ne coûte rien. Mieux vaut proposer d'enregistrer une fois de trop que de
     laisser fermer un onglet sur trois heures de travail. */
  modifie:false,
  /* La carte n'est réécrite que si elle a changé : une carte de fabrication
     fait des dizaines de méga-octets, et changer une fréquence ne doit pas
     les renvoyer. */
  carteAEcrire:false,
  erreur:""
};

/* ==========================================================================
   Les échanges avec le serveur
   ========================================================================== */
/* La racine du serveur est celle que 01-api.js a trouvée, comme pour
   12-api-openems.js : la découverte a lieu une fois. */
function prjBase(){ return (typeof API_BASE==="string")?API_BASE:""; }

async function prjAppel(route,options){
  const rep=await fetch(prjBase()+route,options||{});
  if(!rep.ok){
    let detail="";
    try{
      const j=await rep.json();
      detail=(j&&(j.detail||j.message))||"";
    }catch(e){}
    const err=new Error(detail||("HTTP "+rep.status));
    err.statut=rep.status;
    throw err;
  }
  return rep.json();
}

function prjPost(route,doc){
  return prjAppel(route,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(doc||{})
  });
}

/* L'état : où l'on range, et ce qu'il y a déjà. Appelé au démarrage, puis
   après chaque geste qui change la liste. */
async function prjSonder(){
  try{
    const e=await prjAppel(PRJ_ROUTE);
    PRJ.dispo=!!e.dispo;
    PRJ.racine=e.racine||"";
    PRJ.defaut=e.defaut||"";
    PRJ.projets=Array.isArray(e.projets)?e.projets:[];
    PRJ.erreur=e.dispo?"":(e.detail||"");
  }catch(err){
    PRJ.dispo=false;
    PRJ.erreur=err.message||String(err);
  }
  prjRendre();
  return PRJ;
}

/* ==========================================================================
   Capturer : la page -> un document
   ========================================================================== */
/* D'OÙ VIENT LA CARTE AFFICHÉE. Deux sources, et elles ne s'enregistrent pas
   pareil : une carte importée est un document qu'il faut garder tel quel, un
   dessin est un document qui se REFABRIQUE à partir des formes. Enregistrer
   les deux pour un dessin rangerait côte à côte une source et son produit,
   et rien ne garantirait qu'ils restent d'accord. */
function prjSource(){
  return (V.fichier==="conception")?"dessin":(V.modele?"fichier":"vide");
}

/* Le dessin, à plat. Tout `CON` sauf ce qui n'a de sens que pendant un
   geste : l'outil courant, la forme en cours de tracé, la sélection. */
function prjDessin(){
  return {
    actif:!!CON.actif,
    carte:{L:CON.carte.L, W:CON.carte.W},
    pile:CON.pile, uid:CON.uid,
    /* Le modèle d'usine et l'épaisseur visée voyagent AVEC l'empilage : sans
       eux, un projet rouvert dirait « empilage libre » alors qu'il tient dans
       une référence de catalogue, et le bouton « répartir » n'aurait plus de
       cible à viser. */
    modele:CON.modele, cible:CON.cible,
    elements:CON.elements,
    grille:CON.grille, unite:CON.unite, largeur:CON.largeur,
    trou:!!CON.trou, coucheActive:CON.coucheActive,
    netActif:CON.netActif, diametreVia:CON.diametreVia,
    fcible:CON.fcible,
    /* LE MOTIF OUVERT ET SES COTES, alors que RIEN N'EN EST DESSINÉ. C'est
       précisément pour cela qu'il faut le garder : une fiche de motif est un
       réglage en cours — on ouvre un patch, on retouche deux cotes, on va
       voir ailleurs. `gabaritTouche` dit lesquelles ont été reprises à la
       main, et le perdre ferait suivre à nouveau la fréquence à une largeur
       qu'on venait justement de fixer. */
    gabarit:CON.gabarit, gabaritP:CON.gabaritP,
    gabaritTouche:CON.gabaritTouche,
    calcul:CON.calcul
  };
}

/* Les formes désignées, par leur RANG dans le document de la carte. Voir
   l'en-tête : une référence d'objet ne traverse pas le disque. */
function prjFormesEnrouler(){
  const m=V.modele;
  if(!m)return [];
  const out=[];
  for(const f of ANT.formes){
    let i=-1;
    if(f.k==="piste")     i=(m.pistes||[]).indexOf(f.o);
    else if(f.k==="plan") i=(m.plans||[]).indexOf(f.o);
    else if(f.k==="via")  i=(m.percages||[]).indexOf(f.o);
    else if(f.k==="pad"){
      /* Une pastille n'est pas dans le document telle qu'on la désigne : le
         chargement la PLACE — elle tourne avec son composant — et range le
         résultat dans sa couche. C'est donc le rang dans la couche qui la
         désigne, et il est aussi stable que les autres tant que la carte est
         la même. */
      const c=V.couches[f.c];
      i=c?c.pads.indexOf(f.o):-1;
    }
    if(i>=0)out.push({k:f.k, c:f.c, i:i});
  }
  return out;
}

function prjAntenne(){
  return {
    etape:ANT.etape,
    nets:Array.from(ANT.nets),
    formes:prjFormesEnrouler(),
    netMasse:ANT.netMasse,
    couches:Array.from(ANT.couches),
    avecVias:!!ANT.avecVias, avecPastilles:!!ANT.avecPastilles,
    modeleCuivre:ANT.modeleCuivre,
    pertes:ANT.pertes,
    primitives:ANT.primitives,
    bande:ANT.bande, uniteF:ANT.uniteF,
    ports:ANT.ports, portActif:ANT.portActif,
    boite:ANT.boite, maillage:ANT.maillage,
    arret:ANT.arret, nf2ff:ANT.nf2ff, dumps:ANT.dumps,
    balayage:ANT.balayage
  };
}

/* Les réglages d'affichage. Ils sont dans le projet EN PLUS du stockage
   local, et ce n'est pas un doublon : le stockage local dit « comment cette
   machine aime regarder », le projet dit « comment cette carte-ci se
   regardait ». Les valeurs d'empilage saisies à la main (`V.sur`) sont dans
   le second cas — elles décrivent une carte, pas un goût. */
function prjAffichage(){
  const cachees=[];
  for(const c of V.couches)if(!c.visible)cachees.push(c.nom);
  return {
    sur:V.sur, cachees:cachees, aff:V.aff,
    flip:!!V.vue.flip,
    vue:{scale:V.vue.scale, ox:V.vue.ox, oy:V.vue.oy}
  };
}

/* Le document de la carte, tel qu'il est arrivé du serveur. Même nettoyage
   que l'export .json de 06-ouverture.js : les champs calculés à l'affichage
   se recalculent en une passe, et les garder doublerait le fichier. */
function prjCarte(){
  if(!V.modele)return null;
  return JSON.parse(JSON.stringify(V.modele,function(cle,valeur){
    return (cle==="boite"||cle==="_b")?undefined:valeur;
  }));
}

function prjGHz(f){
  if(!(f>0))return "";
  if(f>=1e9)return (f/1e9).toFixed(2).replace(".",",")+" GHz";
  if(f>=1e6)return Math.round(f/1e6)+" MHz";
  return Math.round(f/1e3)+" kHz";
}

/* La ligne que la liste des projets affiche sous le nom. Elle se fabrique,
   elle ne se saisit pas : un champ « description » de plus resterait vide,
   et ce qu'on veut savoir d'un projet qu'on rouvre — d'où vient la carte,
   sur quelle bande, est-ce que ça a déjà tourné — la page le sait déjà. */
function prjTitre(){
  const bits=[];
  if(prjSource()==="dessin")
    bits.push(CON.elements.length+" forme"+(CON.elements.length>1?"s":"")+
              " dessinée"+(CON.elements.length>1?"s":""));
  else if(V.fichier)bits.push(V.fichier);
  if(ANT.bande&&ANT.bande.f1>0)
    bits.push(prjGHz(ANT.bande.f1)+" – "+prjGHz(ANT.bande.f2));
  if(ANT.resultat)bits.push("simulé");
  return bits.join(" · ");
}

/* Le document complet. `carte` n'y est que quand il faut l'écrire :
   ABSENTE veut dire « inchangée, garde celle du dossier », NULLE veut dire
   « il n'y en a plus » (voir python/projet.py). */
function prjCapturer(nom){
  const doc={
    nom:nom||PRJ.nom,
    titre:prjTitre(),
    outil:"Antenne openEMS",
    source:prjSource(),
    dessin:prjDessin(),
    antenne:prjAntenne(),
    affichage:prjAffichage(),
    fichier:V.fichier||"",
    resultats:ANT.resultat
      ? {resultat:ANT.resultat,
         tache:ANT.tache?{id:ANT.tache.id, dossier:ANT.tache.dossier||"",
                          etat:ANT.tache.etat}:null}
      : null
  };
  if(prjSource()==="dessin")doc.carte=null;
  else if(PRJ.carteAEcrire||nom!==PRJ.nom)doc.carte=prjCarte();
  return doc;
}

/* ==========================================================================
   Appliquer : un document -> la page
   ========================================================================== */
function prjNombre(v,defaut){ const n=+v; return isFinite(n)?n:defaut; }

function prjFormesDerouler(liste){
  const m=V.modele, out=[];
  if(!m)return out;
  for(const e of (liste||[])){
    let o=null;
    if(e.k==="piste")     o=(m.pistes||[])[e.i];
    else if(e.k==="plan") o=(m.plans||[])[e.i];
    else if(e.k==="via")  o=(m.percages||[])[e.i];
    else if(e.k==="pad"){
      const c=V.couches[e.c];
      o=c?c.pads[e.i]:null;
    }
    if(o)out.push({k:e.k, c:e.c, o:o});
  }
  return out;
}

/* LES RÉGLAGES SE RELISENT UN PAR UN, ET NON PAR UN `Object.assign` EN BLOC.
   Un fichier écrit par une version d'avant n'a pas les mêmes clés ; un
   fichier écrit à la main peut en avoir de fausses. Recopier tout un objet
   dans `ANT` y poserait des champs que rien ne lit et, pire, remplacerait un
   `Set` par un tableau — après quoi `ANT.nets.has` n'existe plus et la page
   casse dans un gestionnaire de clic, très loin d'ici. */
function prjAntAppliquer(a){
  if(!a||typeof a!=="object")return;

  if(Array.isArray(a.nets))ANT.nets=new Set(a.nets.filter(i=>V.parNet[i]));
  if(Array.isArray(a.couches))
    ANT.couches=new Set(a.couches.filter(i=>V.couches[i]&&V.couches[i].cuivre));
  ANT.formes=prjFormesDerouler(a.formes);
  if(isFinite(a.netMasse))ANT.netMasse=V.parNet[a.netMasse]?a.netMasse:-1;
  if(typeof a.avecVias==="boolean")ANT.avecVias=a.avecVias;
  if(typeof a.avecPastilles==="boolean")ANT.avecPastilles=a.avecPastilles;

  if(["feuille","pec","volume"].indexOf(a.modeleCuivre)>=0)
    ANT.modeleCuivre=a.modeleCuivre;
  if(a.pertes&&(a.pertes.mode==="kappa"||a.pertes.mode==="debye"))
    ANT.pertes={mode:a.pertes.mode, f_kappa:prjNombre(a.pertes.f_kappa,0)};
  if(Array.isArray(a.primitives))ANT.primitives=a.primitives;

  if(a.bande&&a.bande.f1>0&&a.bande.f2>a.bande.f1)Object.assign(ANT.bande,a.bande);
  if(ANT_UNITES_F[a.uniteF])ANT.uniteF=a.uniteF;

  /* Les ports : chacun complété par un port neuf, pour qu'un champ ajouté
     depuis l'enregistrement ait quand même sa valeur d'usine. Et au moins un
     port excité — deux excitations, ou aucune, et le serveur refuse tout. */
  if(Array.isArray(a.ports)&&a.ports.length){
    ANT.ports=a.ports.slice(0,8).map(p=>Object.assign(antPortNeuf(false),p));
    if(!ANT.ports.some(p=>p.excite))ANT.ports[0].excite=true;
    ANT.portActif=Math.min(Math.max(0,a.portActif|0),ANT.ports.length-1);
  }

  if(a.boite)Object.assign(ANT.boite,a.boite);
  if(a.maillage)Object.assign(ANT.maillage,a.maillage);
  if(a.arret)Object.assign(ANT.arret,a.arret);
  if(a.nf2ff)ANT.nf2ff.actif=!!a.nf2ff.actif;
  /* L'ENREGISTREMENT DES CHAMPS REVIENT ACTIF S'IL L'ÉTAIT, à la différence
     de ce que fait la relecture des préférences (10-etat.js), qui le remet
     toujours à faux. Les deux ont raison : là-bas c'est un goût qui suivrait
     une carte quelconque et remplirait un disque sans qu'on l'ait demandé ;
     ici c'est une décision prise POUR CE PROJET, et la défaire à chaque
     ouverture ferait relancer un calcul de trois heures sans les champs
     qu'on voulait justement regarder. */
  if(a.dumps&&typeof a.dumps==="object"){
    Object.assign(ANT.dumps,a.dumps);
    if(!Array.isArray(ANT.dumps.types)||!ANT.dumps.types.length)
      ANT.dumps.types=["J"];
  }
  if(a.balayage&&typeof a.balayage==="object")
    Object.assign(ANT.balayage,a.balayage,{devis:null});

  if(isFinite(a.etape))ANT.etape=Math.min(Math.max(0,a.etape|0),
                                          ANT_ETAPES.length-1);
}

function prjConAppliquer(d){
  if(!d||typeof d!=="object")return;
  if(d.carte){
    CON.carte.L=prjNombre(d.carte.L,CON.carte.L);
    CON.carte.W=prjNombre(d.carte.W,CON.carte.W);
  }
  if(Array.isArray(d.pile)&&d.pile.length)CON.pile=d.pile;
  CON.modele=(typeof d.modele==="string")?d.modele:"";
  CON.cible=prjNombre(d.cible,conEpTotale()||1.6);
  CON.pileSel=0;
  /* UN PROJET A DÉJÀ RÉPONDU À LA QUESTION DE L'EMPILAGE. La reposer par
     dessus un dessin qu'on vient de rouvrir laisserait croire qu'il reste à
     choisir, et le premier clic sur un nombre de couches referait la carte. */
  CON.demarrage=false;
  CON.uid=Math.max(prjNombre(d.uid,1),
                   1+CON.pile.reduce((m,e)=>Math.max(m,e.uid||0),0));
  if(Array.isArray(d.elements))CON.elements=d.elements;
  CON.grille=prjNombre(d.grille,CON.grille);
  if(typeof d.unite==="string"&&CON_UNITES[d.unite])CON.unite=d.unite;
  CON.largeur=prjNombre(d.largeur,CON.largeur);
  CON.trou=!!d.trou;
  CON.netActif=String(d.netActif||CON.netActif);
  CON.diametreVia=prjNombre(d.diametreVia,CON.diametreVia);
  CON.fcible=prjNombre(d.fcible,CON.fcible);
  CON.coucheActive=(conCoucheDeUid(d.coucheActive)>=0)
    ? d.coucheActive : conPremierCuivre();
  /* Le motif n'est repris que si l'outil le connaît encore : un projet écrit
     avant qu'un motif ne soit renommé rouvrirait sinon une fiche vide. */
  CON.gabarit=(typeof conGabarit==="function"&&conGabarit(d.gabarit))
    ? d.gabarit : null;
  CON.gabaritP=(d.gabaritP&&typeof d.gabaritP==="object")?d.gabaritP:{};
  CON.gabaritTouche=(d.gabaritTouche&&typeof d.gabaritTouche==="object")
    ? d.gabaritTouche : {};
  CON.calcul=(d.calcul&&typeof d.calcul==="object")?d.calcul:null;
  CON.outil="select"; CON.courant=null; CON.sel=-1;
}

/* L'ordre compte, et c'est tout l'intérêt de cette fonction.

   1. LA CARTE D'ABORD, parce que tout le reste la désigne : les nets par
      leur rang, les couches par le leur, les formes par le leur.
   2. LES VALEURS D'EMPILAGE ENSUITE, et `ltPreparer()` derrière elles :
      `poser()` relit celles du stockage local — c'est son travail — et
      celles du projet doivent gagner. C'est le même geste que fait
      `conSortir()` quand il rend la main à une carte importée.
   3. LES RÉGLAGES DE SIMULATION EN DERNIER, parce qu'ils s'appuient sur les
      deux précédents.
*/
async function prjAppliquer(charge){
  const dessin=(charge.source==="dessin")||
               (!charge.carte&&charge.dessin&&
                (charge.dessin.elements||[]).length>0);

  if(dessin){
    /* Le dessin refabrique sa carte : `conAppliquer` appelle `mdlCharger`.
       On entre dans le mode pour que `CON.pile` et la carte soient posées
       par le chemin habituel, puis on en ressort si le projet avait été
       enregistré hors du mode — ce que fait couramment quelqu'un qui dessine
       le lundi et ne fait que relancer des simulations le mardi.

       `antRaz` AVANT de refabriquer : rien de la séance précédente ne doit
       survivre à l'ouverture d'un autre projet. Ce que `conAppliquer` rétablit
       ensuite — couches, nets, ports — vient du dessin ; le reste vient du
       fichier, quelques lignes plus bas. */
    conEntrer();
    prjConAppliquer(charge.dessin);
    antRaz();
    conAppliquer(true);
    /* Le projet ouvert est le nouveau point de départ : l'historique du
       dessin d'avant désignerait des formes qui ne sont plus là. */
    if(typeof conHistRaz==="function")conHistRaz();
    if(charge.dessin&&charge.dessin.actif===false)conSortir();
  }else if(charge.carte){
    poser(charge.carte,charge.fichier||charge.nom);
  }else{
    /* Ni dessin ni carte : un projet qu'on a nommé avant d'avoir rien fait.
       Il s'ouvre quand même — c'est un nom réservé, et l'enregistrement
       suivant le remplira. */
    prjConAppliquer(charge.dessin);
  }

  const aff=charge.affichage||{};
  /* LES VALEURS D'EMPILAGE SAISIES À LA MAIN NE REVIENNENT QUE POUR UNE CARTE
     IMPORTÉE. Sur un dessin, elles se refabriquent — c'est `conRolesDeclares`
     qui les pose à chaque application du dessin, et les réécrire par-dessus
     remettrait celles d'un autre jour sur des couches qui portent les mêmes
     noms. */
  if(!dessin&&aff.sur&&typeof aff.sur==="object"){
    V.sur=Object.assign({cu:{},gap_t:{},gap_er:{},role:{}},aff.sur);
    if(V.modele)ltPreparer();
  }
  if(V.modele){
    if(aff.aff)for(const k in V.aff)if(k in aff.aff)V.aff[k]=!!aff.aff[k];
    V.vue.flip=!!aff.flip;
    if(Array.isArray(aff.cachees)){
      const cachees=new Set(aff.cachees);
      for(const c of V.couches)c.visible=!cachees.has(c.nom);
    }
    if(typeof boutonsEtat==="function")boutonsEtat();
  }

  prjAntAppliquer(charge.antenne);

  const r=charge.resultats;
  ANT.resultat=(r&&r.resultat)||null;
  /* La tâche n'est PAS reprise en suivi : elle est reposée telle qu'elle
     s'est terminée, pour que « Voir les champs » et « Ouvrir le dossier »
     retrouvent leur identifiant. Un suivi rattaché à une tâche que le
     serveur a oubliée passerait son temps à sonder pour rien. */
  ANT.tache=(r&&r.tache)?Object.assign({lignes:[]},r.tache):null;

  if(aff.vue&&aff.vue.scale>0&&V.modele){
    V.vue.scale=aff.vue.scale; V.vue.ox=aff.vue.ox; V.vue.oy=aff.vue.oy;
    dessiner();
  }else if(V.modele)fit();

  pnlTout();
  antMaj(true);
  antAssistantRendre();
  antResultatsRendre();
  antJournalRendre();
}

/* ==========================================================================
   Les gestes
   ========================================================================== */
async function prjDefinirRacine(chemin){
  const e=await prjPost(PRJ_ROUTE+"/racine",{chemin:chemin});
  PRJ.racine=e.racine||"";
  PRJ.projets=Array.isArray(e.projets)?e.projets:[];
  /* La racine a changé : le projet qu'on avait ouvert était dans l'ancienne,
     et son nom ne désigne plus le même dossier. Le serveur l'a fermé de son
     côté ; on fait pareil ici plutôt que de garder un nom qui mentirait sur
     la destination du prochain enregistrement. */
  if(PRJ.nom){ PRJ.nom=""; PRJ.modifie=true; }
  return e;
}

async function prjEnregistrer(nom){
  const cible=(nom||PRJ.nom||"").trim();
  if(!cible)throw new Error("Donnez un nom au projet avant de l'enregistrer.");
  const doc=prjCapturer(cible);
  const out=await prjPost(PRJ_ROUTE+"/enregistrer",doc);
  PRJ.nom=out.nom;
  PRJ.racine=out.racine||PRJ.racine;
  PRJ.projets=Array.isArray(out.projets)?out.projets:PRJ.projets;
  PRJ.enregistre=Date.now();
  PRJ.modifie=false;
  /* La carte est maintenant sur le disque : tant qu'on n'en ouvre pas une
     autre, les enregistrements suivants n'ont plus à l'envoyer. */
  if("carte" in doc)PRJ.carteAEcrire=false;
  return out;
}

/* ==========================================================================
   Ranger le dossier de calcul AVEC le reste
   --------------------------------------------------------------------------
   CE QUE « ENREGISTRER » NE FAISAIT PAS. Un projet ouvert AVANT le lancement
   reçoit les calculs chez lui : le serveur pose la racine des calculs à
   chaque ouverture et à chaque enregistrement, et openEMS écrit ses .vtr
   dans `<projet>/calculs/<id>/`. Mais un calcul lancé SANS projet ouvert —
   le cas de loin le plus courant, parce qu'on nomme son travail quand il a
   donné quelque chose — a écrit dans le dossier temporaire du système. On
   gardait alors les courbes et l'on perdait les champs : `resultats.json`
   pointait sur un chemin que le nettoyage de disque de Windows vide un jour,
   sans rien annoncer, et « Voir les champs » répondait des mois plus tard
   que la simulation n'existait plus.

   C'EST DONC LE MÊME GESTE, ET PAS UN BOUTON DE PLUS. « Enregistrer »
   enregistre tout ce qu'il y a à garder — y compris les centaines de
   méga-octets que le solveur a écrites ailleurs. Un bouton séparé aurait été
   un bouton qu'on oublie, exactement comme la case « Enregistrer les champs »
   qu'on oublie de cocher avant de lancer.
   ========================================================================== */
function prjArchivable(){
  const t=ANT.tache;
  return !!(t&&t.id&&(t.etat==="fini"||t.etat==="arrete"||t.etat==="echoue"));
}

async function prjArchiverCalcul(id){
  return prjPost(PRJ_ROUTE+"/archiver",{id:id});
}

/* LES DOSSIERS DE CALCUL DU PROJET, et un dossier venu d'ailleurs.

   POURQUOI IL FALLAIT LES DEUX. `resultats.json` ne retient qu'UN calcul,
   le dernier ; un projet en accumule un par simulation lancée. Après cinq
   simulations, cinq dossiers sont sur le disque avec leurs champs, et la
   page n'en atteignait qu'un — les quatre autres étaient là, invisibles,
   et il fallait ParaView pour les revoir.

   `prjImporterCalcul` fait entrer dans cette même liste un dossier qui n'y
   était pas : une clé USB, un partage réseau, un calcul mené à la main sur
   une autre machine. Le serveur le COPIE — il ne le déplace pas : ce
   dossier-là appartient à quelqu'un, et le vider en croyant l'ouvrir serait
   la faute la plus grave que cet outil puisse commettre. */
async function prjCalculs(){
  return prjAppel(PRJ_ROUTE+"/calculs");
}

async function prjImporterCalcul(chemin){
  return prjPost(PRJ_ROUTE+"/importer",{chemin:chemin});
}

/* Le geste complet : le document, puis le dossier de calcul, puis le document
   à nouveau SI le dossier a bougé — car `resultats.json` porte son chemin, et
   un chemin qui ment vaut moins que pas de chemin du tout.

   UN ÉCHEC D'ARCHIVAGE NE FAIT PAS ÉCHOUER L'ENREGISTREMENT. Le projet, lui,
   est écrit : le dire perdu parce que quelques fichiers .vtr n'ont pas pu
   être déplacés ferait recommencer un travail qui est en réalité sauvé. On
   rend donc l'ennui, et l'appelant l'affiche. */
async function prjEnregistrerTout(nom){
  const out=await prjEnregistrer(nom);
  if(!prjArchivable())return {projet:out, calcul:null};
  let arch=null;
  try{
    arch=await prjArchiverCalcul(ANT.tache.id);
    if(arch&&arch.dossier&&ANT.tache.dossier!==arch.dossier){
      ANT.tache.dossier=arch.dossier;
      /* La carte n'est pas renvoyée une seconde fois : `prjCapturer` ne la
         joint que si elle a changé ou si le nom a changé, et ni l'un ni
         l'autre n'est vrai ici. Ce second enregistrement ne pèse que le
         document. */
      await prjEnregistrer(out.nom);
    }
  }catch(e){
    arch={erreur:e.message||String(e)};
  }
  return {projet:out, calcul:arch};
}

/* La phrase à ajouter après « projet enregistré ». Elle ne dit rien quand il
   n'y a rien à dire — un projet sans calcul, ou un calcul déjà rangé. */
function prjDireCalcul(arch){
  if(!arch)return "";
  if(arch.erreur)
    return " Le dossier de calcul, lui, n'a pas pu être rangé : "+arch.erreur;
  if(arch.deplace)
    return " Le dossier de calcul ("+antPoids(arch.octets)+
           ") a été rangé dans le projet.";
  return "";
}

async function prjOuvrir(nom){
  const charge=await prjAppel(PRJ_ROUTE+"/ouvrir?nom="+encodeURIComponent(nom));
  await prjAppliquer(charge);
  PRJ.nom=charge.nom;
  PRJ.enregistre=(charge.modifie||0)*1000;
  PRJ.modifie=false;
  PRJ.carteAEcrire=false;
  return charge;
}

async function prjFermer(){
  const e=await prjPost(PRJ_ROUTE+"/fermer",{});
  PRJ.nom="";
  PRJ.projets=Array.isArray(e.projets)?e.projets:PRJ.projets;
  return e;
}

/* ==========================================================================
   Le panneau
   ========================================================================== */
function prjDate(ms){
  if(!ms)return "—";
  const d=new Date(ms);
  if(isNaN(d.getTime()))return "—";
  const auj=new Date();
  const meme=d.toDateString()===auj.toDateString();
  const h=String(d.getHours()).padStart(2,"0")+":"+
          String(d.getMinutes()).padStart(2,"0");
  return meme ? ("aujourd'hui à "+h)
              : (d.toLocaleDateString("fr-FR")+" à "+h);
}

function prjEteint(){
  return '<p class="intro">Les projets demandent le serveur : c\'est lui '+
    'qui écrit sur le disque. '+aEsc(PRJ.erreur||"Il ne répond pas.")+'</p>'+
    '<p class="note">Lancez <code>python web_antenna.py</code> depuis le dossier '+
    'du dépôt, puis ouvrez cette page par l\'adresse qu\'il affiche. Sans lui, '+
    'le travail se garde par « Exporter .json » et se rouvre par '+
    '« Ouvrir un fichier ».</p>';
}

function prjBlocRacine(){
  return '<div class="champ"><label>Le dossier de travail '+
    '<small>chaque projet y aura son propre sous-dossier, avec son dessin, '+
    'sa carte, ses résultats et les dossiers de calcul d\'openEMS.</small>'+
    '</label>'+
    '<div class="ligne">'+
      '<span style="flex:1 1 auto"><input type="text" id="prjRacine" '+
        'value="'+aEsc(PRJ.racine)+'" spellcheck="false" '+
        'placeholder="'+aEsc(PRJ.defaut)+'"></span>'+
      '<span><button class="tb mini" data-prj="racine" '+
        'title="Utiliser ce dossier, et le créer s\'il n\'existe pas">'+
        'Utiliser</button></span>'+
      '<span><button class="tb mini" data-prj="explorer" '+
        'title="Ouvrir ce dossier dans l\'explorateur">📂</button></span>'+
    '</div>'+
    '<p class="note">Le chemin est celui du POSTE QUI FAIT TOURNER LE '+
    'SERVEUR, et non celui du navigateur : un lecteur réseau doit y être '+
    'connecté. Le choix est retenu d\'une séance à l\'autre.</p></div>';
}

function prjBlocProjet(){
  const source=prjSource();
  const etat=PRJ.nom
    ? ('<b>'+aEsc(PRJ.nom)+'</b> — enregistré '+prjDate(PRJ.enregistre)+
       (PRJ.modifie?' <em class="alerte">· modifications non enregistrées</em>'
                   :''))
    : '<em>aucun projet ouvert — ce qui est à l\'écran n\'est nulle part '+
      'sur le disque.</em>';

  const quoi=[];
  if(source==="dessin")
    quoi.push(CON.elements.length+" forme(s) dessinée(s) et leur empilage");
  else if(source==="fichier")
    quoi.push("la carte « "+aEsc(V.fichier)+" »"+
              (PRJ.carteAEcrire?"":" (déjà écrite, non réenvoyée)"));
  quoi.push("les réglages de simulation et le cuivre désigné");
  if(ANT.resultat)quoi.push("le dernier résultat");
  /* LE DOSSIER DE CALCUL EST ANNONCÉ PARCE QU'IL PÈSE. Les autres lignes
     décrivent des kilo-octets ; celle-ci peut valoir plusieurs centaines de
     méga-octets de champs, et l'enregistrement prendra alors le temps de les
     déplacer. Le dire ici, c'est éviter de croire à un outil bloqué. */
  if(prjArchivable())
    quoi.push("le dossier de calcul d'openEMS, champs compris");

  return '<div class="champ"><label>Ce projet</label>'+
    '<p class="note">'+etat+'</p>'+
    '<div class="ligne">'+
      '<span style="flex:1 1 auto"><input type="text" id="prjNom" '+
        'value="'+aEsc(PRJ.nom)+'" maxlength="80" spellcheck="false" '+
        'placeholder="nom du projet"></span>'+
      '<span><button class="tb on" data-prj="enregistrer">💾 Enregistrer'+
        '</button></span>'+
    '</div>'+
    (V.modele
      ? '<p class="note">Sera écrit : '+quoi.join(" ; ")+'.</p>'
      : '<p class="note">Rien n\'est chargé : ouvrez un fichier, dessinez, '+
        'ou reprenez un projet ci-dessous.</p>')+
    '<p class="note">Changer le nom puis « Enregistrer » fait une copie sous '+
    'ce nouveau nom — c\'est l\'« enregistrer sous » de l\'outil, et c\'est ce '+
    'qu\'on fait avant d\'essayer une variante.</p>'+
    '</div>';
}

function prjBlocListe(){
  if(!PRJ.projets.length)
    return '<div class="champ"><label>Reprendre un projet</label>'+
      '<p class="note">Aucun projet dans ce dossier pour l\'instant.</p></div>';

  const lignes=PRJ.projets.map(function(p){
    const marques=[];
    if(p.dessin)marques.push("dessin");
    if(p.carte)marques.push("carte");
    if(p.resultats)marques.push("résultats");
    if(p.abime)marques.push("en-tête illisible");
    return '<div class="prj-ligne'+(p.nom===PRJ.nom?" prj-ouvert":"")+'">'+
      '<button class="prj-nom" data-prj-ouvrir="'+aEsc(p.nom)+'" '+
        'title="Reprendre ce projet">'+aEsc(p.nom)+'</button>'+
      '<div class="prj-sous">'+aEsc(p.titre||"")+'</div>'+
      '<div class="prj-sous">'+prjDate((p.modifie||0)*1000)+
        (marques.length?' · '+marques.join(" · "):"")+
        (p.poids?' · '+moPoids(p.poids):"")+'</div>'+
      '</div>';
  }).join("");

  return '<div class="champ"><label>Reprendre un projet '+
    '<small>du plus récent au plus ancien. Ouvrir remplace ce qui est à '+
    'l\'écran.</small></label><div class="prj-liste">'+lignes+'</div></div>';
}

function prjRendre(){
  const corps=document.getElementById("projetCorps");
  if(corps){
    corps.innerHTML=PRJ.dispo
      ? (prjBlocRacine()+prjBlocProjet()+prjBlocListe())
      : prjEteint();
    prjLier(corps);
  }
  prjAccueilRendre();
  prjBoutonEtat();
}

/* REFAIRE LE PANNEAU PENDANT QU'ON TAPE DEDANS EFFACERAIT LA SAISIE. Le
   panneau dit ce qui sera écrit — « la carte X », « 5 formes dessinées » —,
   donc il doit suivre ce qui se passe à côté ; mais il porte aussi deux
   champs de texte, et un `innerHTML` sous le curseur perd la frappe en cours.
   On ne refait donc que s'il est à l'écran ET qu'aucun de ses champs n'a le
   focus, et jamais plus d'une fois par tour de boucle. */
let PRJ_ATTENTE=0;
function prjRendreDouce(){
  clearTimeout(PRJ_ATTENTE);
  PRJ_ATTENTE=setTimeout(function(){
    const corps=document.getElementById("projetCorps");
    if(!corps||!corps.offsetParent)return;             // replié, ou fermé
    if(corps.contains(document.activeElement))return;  // on tape dedans
    prjRendre();
  },160);
}

function prjBoutonEtat(){
  const b=document.getElementById("bProjet");
  if(!b)return;
  b.classList.toggle("on",!!PRJ.nom);
  b.title=PRJ.nom
    ? ("Projet « "+PRJ.nom+" »"+(PRJ.modifie?" — modifications non "+
       "enregistrées":" — à jour"))
    : "Choisir où ranger le travail, et reprendre un projet existant";
}

/* Attendre, dire, et ne pas laisser un bouton muet : écrire un projet qui
   porte une carte de fabrication prend une seconde ou deux. */
async function prjGeste(quoi,promesse){
  try{
    hint(quoi+"…");
    const out=await promesse;
    return out;
  }catch(e){
    const t=String(e.message||e);
    hint("Échec : "+t.split("\n")[0]);
    window.alert(quoi+" : impossible.\n\n"+t);
    throw e;
  }
}

function prjLier(corps){
  const bt=function(quoi,fn){
    const b=corps.querySelector('[data-prj="'+quoi+'"]');
    if(b)b.onclick=fn;
  };
  bt("racine",async function(){
    const champ=document.getElementById("prjRacine");
    const voulu=(champ&&champ.value||"").trim();
    try{
      await prjGeste("Changer de dossier de travail",prjDefinirRacine(voulu));
      hint("Dossier de travail : "+PRJ.racine+" — "+PRJ.projets.length+
           " projet(s) dedans.");
    }catch(e){}
    prjRendre();
  });
  bt("explorer",async function(){
    try{ await prjPost(PRJ_ROUTE+"/dossier",{}); }
    catch(e){ hint("Échec : "+(e.message||e)); }
  });
  bt("enregistrer",async function(){
    const champ=document.getElementById("prjNom");
    const nom=(champ&&champ.value||"").trim();
    try{
      const r=await prjGeste("Enregistrer le projet",prjEnregistrerTout(nom));
      hint("Projet « "+r.projet.nom+" » enregistré dans "+r.projet.dossier+
           "."+prjDireCalcul(r.calcul));
    }catch(e){}
    prjRendre();
  });
  for(const b of corps.querySelectorAll("[data-prj-ouvrir]")){
    b.onclick=function(){ prjOuvrirDemande(b.dataset.prjOuvrir); };
  }
}

/* OUVRIR REMPLACE TOUT CE QUI EST À L'ÉCRAN, et il faut le demander quand il
   y a quelque chose à perdre. Même règle que le bouton « Exemple » : ce qui
   est perdu ne se rattrape pas. */
async function prjOuvrirDemande(nom){
  if(nom===PRJ.nom&&!PRJ.modifie)return;
  const aPerdre=PRJ.modifie&&(V.modele||CON.elements.length);
  if(aPerdre&&!window.confirm(
      "Des modifications ne sont pas enregistrées"+
      (PRJ.nom?" dans « "+PRJ.nom+" »":"")+".\n\n"+
      "Ouvrir « "+nom+" » les remplacera. Continuer ?"))return;
  try{
    await prjGeste("Ouvrir le projet « "+nom+" »",prjOuvrir(nom));
    hint("Projet « "+nom+" » repris. "+
         (ANT.resultat?"Ses résultats sont revenus avec lui.":
                       "Rien n'a encore été simulé dedans."));
  }catch(e){}
  prjRendre();
}

/* ==========================================================================
   L'écran d'accueil
   --------------------------------------------------------------------------
   « Reprendre un projet » est la TROISIÈME façon de commencer, à côté
   d'ouvrir un fichier et de dessiner — et c'est celle qu'on veut le plus
   souvent, parce qu'une antenne se dimensionne en plusieurs séances. Elle a
   donc sa place sur l'écran d'accueil, et pas seulement dans un panneau.
   ========================================================================== */
function prjAccueilRendre(){
  const zone=document.getElementById("accueilProjets");
  if(!zone)return;
  if(!PRJ.dispo||!PRJ.projets.length){
    zone.hidden=true;
    return;
  }
  zone.hidden=false;
  const cinq=PRJ.projets.slice(0,5).map(function(p){
    return '<button class="tb" data-prj-ouvrir="'+aEsc(p.nom)+'" '+
      'title="'+aEsc((p.titre||"")+" — "+prjDate((p.modifie||0)*1000))+'">'+
      aEsc(p.nom)+'</button>';
  }).join("");
  zone.innerHTML='<span>ou reprendre</span>'+cinq+
    '<small>Vos projets sont dans '+aEsc(PRJ.racine)+'. '+
    (PRJ.projets.length>5?("Les "+PRJ.projets.length+" sont dans le panneau "+
      "« Projet ». "):"")+
    'Un projet rend le dessin, les réglages, le cuivre désigné et les '+
    'dernières courbes exactement comme ils étaient.</small>';
  for(const b of zone.querySelectorAll("[data-prj-ouvrir]"))
    b.onclick=function(){ prjOuvrirDemande(b.dataset.prjOuvrir); };
}

/* ==========================================================================
   Ce qui lève le drapeau « modifié »
   --------------------------------------------------------------------------
   Deux fonctions, et elles suffisent : `antMaj` est appelée après chaque
   réglage de simulation et chaque désignation de cuivre, `conAppliquer`
   après chaque modification du dessin. Les envelopper plutôt que d'aller
   poser un drapeau dans trente gestionnaires est le même procédé que celui
   qu'emploient déjà 15, 19 et 20 — et pour la même raison : ces fichiers
   continueront d'évoluer de leur côté.
   ========================================================================== */
(function(){
  for(const nom of ["antMaj","conAppliquer","poser"]){
    const base=window[nom];
    if(typeof base!=="function")continue;
    window[nom]=function(){
      const out=base.apply(this,arguments);
      /* `poser` veut dire qu'une AUTRE carte est arrivée : celle du projet
         n'est plus la bonne, et le prochain enregistrement doit l'écrire. */
      if(nom==="poser")PRJ.carteAEcrire=true;
      if(!PRJ.modifie){ PRJ.modifie=true; prjBoutonEtat(); }
      prjRendreDouce();
      return out;
    };
  }
})();

/* LA FIN D'UN CALCUL EST UNE MODIFICATION, ET C'EST LA PLUS CHÈRE À PERDRE.
   Les trois fonctions enveloppées au-dessus couvrent les RÉGLAGES ; aucune
   n'est appelée quand une simulation se termine — `oeSuivre` pose le résultat
   et rend la main. Un projet enregistré juste avant le lancement s'affichait
   donc « à jour » deux heures plus tard, alors que `resultats.json` ne
   contenait pas les courbes qui venaient d'arriver, et que le dossier de
   calcul attendait toujours dans le dossier temporaire. */
(function(){
  const base=window.oeSuivre;
  if(typeof base!=="function")return;
  window.oeSuivre=async function(){
    const out=await base.apply(this,arguments);
    if(!PRJ.modifie){ PRJ.modifie=true; prjBoutonEtat(); }
    prjRendreDouce();
    return out;
  };
})();

/* Fermer l'onglet sur du travail non enregistré. Le garde-fou de
   19-demarrage.js ne parle que d'un calcul en cours ; celui-ci parle du
   dessin, et c'est lui qui ne se rattrape pas. */
window.addEventListener("beforeunload",function(e){
  if(PRJ.dispo&&PRJ.modifie&&(V.modele||CON.elements.length)){
    e.preventDefault();
    e.returnValue="";
  }
});

/* ==========================================================================
   Les branchements
   ========================================================================== */
window.addEventListener("DOMContentLoaded",function(){
  const b=document.getElementById("bProjet");
  if(b)b.onclick=function(){
    if(typeof wsShow==="function")wsShow("projet");
    prjRendre();
  };

  /* Le panneau se rouvre aussi par le menu « Espace de travail », et il doit
     alors dire la vérité du moment et non celle d'il y a dix minutes. On
     enveloppe `wsShow` ici plutôt qu'au chargement du fichier : 90-workspace.js
     vient APRÈS celui-ci, et la fonction n'existe pas encore à ce moment-là. */
  (function(){
    const base=window.wsShow;
    if(typeof base!=="function")return;
    window.wsShow=function(id){
      const out=base.apply(this,arguments);
      if(id==="projet")prjRendre();
      return out;
    };
  })();

  /* Ctrl+S : le geste que tout le monde fait sans y penser, et que le
     navigateur détournerait vers « enregistrer la page » — ce qui produirait
     un fichier HTML inutile en croyant sauver le travail. */
  window.addEventListener("keydown",function(e){
    if(!(e.ctrlKey||e.metaKey)||e.key!=="s")return;
    e.preventDefault();
    if(!PRJ.dispo)return;
    if(!PRJ.nom){
      if(typeof wsShow==="function")wsShow("projet");
      prjRendre();
      const champ=document.getElementById("prjNom");
      if(champ)champ.focus();
      hint("Donnez un nom au projet, puis « Enregistrer ».");
      return;
    }
    prjGeste("Enregistrer le projet",prjEnregistrerTout(PRJ.nom))
      .then(function(r){
        hint("Projet « "+r.projet.nom+" » enregistré."+prjDireCalcul(r.calcul));
        prjRendre();
      }).catch(function(){ prjRendre(); });
  });

  /* Le serveur est sondé APRÈS que 01-api.js a trouvé sa racine : sans quoi
     `API_BASE` est encore nul et la requête part sur la mauvaise origine.
     C'est la même précaution que prend `antSonderServeur`. */
  (async function(){
    try{ await apiConnecter(); }catch(e){}
    await prjSonder();
  })();
});
