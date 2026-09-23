"use strict";
/* =============================================================================
   Antenne openEMS — 12-api-openems.js
   Les échanges avec le serveur, et rien d'autre.

     GET  /api/openems                 ce que ce poste sait faire
     POST /api/openems                 un document -> un modèle vérifié
     POST /api/openems/script          un document -> un script Python autonome
     POST /api/openems/lancer          un document -> une tâche de calcul
     POST /api/openems/balayage        + une liste de points -> ce qu'elle coûte
     POST /api/openems/balayage/lancer + une liste de points -> N calculs
     POST /api/openems/tableau-s       N ports -> ce que le tableau coûte
     POST /api/openems/tableau-s/lancer N ports -> N calculs, un par colonne
     GET  /api/openems/journal         où en est cette tâche
     POST /api/openems/arreter         tuer cette tâche

   LA RACINE DU SERVEUR EST CELLE QUE js/01-api.js A DÉJÀ TROUVÉE. Ce module ne refait pas la découverte : elle a lieu une fois,
   au chargement du fichier, et si elle a échoué il n'y a de toute façon pas de
   carte à simuler.

   POURQUOI LE SUIVI EST UN SONDAGE ET NON UN FLUX. Une simulation FDTD écrit
   une ligne toutes les quelques secondes pendant des minutes. Un flux
   d'événements (SSE) tiendrait une connexion ouverte tout ce temps sur un
   serveur qui est un `http.server` de la bibliothèque standard, avec un fil
   par connexion — et il ne survivrait ni à un rechargement de page, ni à une
   veille de l'ordinateur portable. Le sondage, lui, reprend là où il s'est
   arrêté : la page dit combien de lignes elle a déjà, le serveur envoie la
   suite, et fermer l'onglet n'interrompt pas le calcul.
   ============================================================================= */

const OE_ROUTE="/api/openems";

/* Intervalle de sondage. Deux secondes : assez pour que la barre bouge, assez
   peu pour qu'une simulation d'une heure ne fasse pas dix-huit mille requêtes.
   Il s'allonge quand rien ne change (voir `oeSuivre`). */
const OE_SONDAGE=2000;
const OE_SONDAGE_MAX=8000;

function oeBase(){ return (typeof API_BASE==="string")?API_BASE:""; }

async function oeErreur(rep){
  let detail="";
  try{
    const j=await rep.json();
    detail=(j&&(j.detail||j.message))||"";
    if(typeof detail!=="string")detail=JSON.stringify(detail);
  }catch(e){}
  return detail||("HTTP "+rep.status);
}

async function oeAppel(route,options){
  const rep=await fetch(oeBase()+route,options||{});
  if(!rep.ok){
    const e=new Error(await oeErreur(rep));
    e.statut=rep.status;
    throw e;
  }
  return rep.json();
}

function oePost(route,doc){
  return oeAppel(route,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(doc)
  });
}

/* -- 1. l'état du poste --------------------------------------------------- */
/* Deux disponibilités et non une : « préparer » marche partout, « lancer »
   demande openEMS installé. L'interface s'en sert pour griser le bon bouton
   et pour dire POURQUOI il est grisé — un bouton mort sans explication est
   la pire réponse qu'une interface puisse faire. */
async function oeEtat(){
  ANT.etatServeur=await oeAppel(OE_ROUTE);
  return ANT.etatServeur;
}

/* -- 2. la préparation ---------------------------------------------------- */
/* Appelée à chaque modification d'un champ. Elle ne calcule rien de lourd —
   un maillage à chiffrer, pas un champ à propager — et c'est elle qui remplit
   tout ce que l'assistant affiche : marges conseillées, nombre de cellules,
   mémoire, avis.

   UN REFUS N'EST PAS UNE PANNE. Le serveur répond 422 avec un message et un
   conseil quand le document ne décrit pas une simulation qu'on puisse lancer
   — « le port relie une couche à elle-même », « la bande est de largeur nulle ».
   On le range dans `ANT.refus` et l'assistant l'affiche à sa place, dans
   l'étape concernée. Le traiter comme une erreur réseau ferait disparaître la
   seule chose utile : ce qu'il faut changer. */
/* DEUX VÉRIFICATIONS PEUVENT SE CROISER, ET LA PLUS ANCIENNE PEUT ARRIVER LA
   DERNIÈRE. Ouvrir un fichier lance une vérification ; poser un port juste
   après en lance une seconde. Si la première — faite sans port — revient
   après la seconde, elle écrase un modèle valide par son refus, et l'assistant
   affiche « le port ne relie rien » alors que le port est posé. Ce n'est pas
   une faute rare : c'est le déroulement NORMAL des premières secondes.

   Un numéro d'ordre suffit : une réponse plus vieille que la dernière partie
   est jetée sans rien toucher. */
let OE_SEQ=0;

async function oePreparer(){
  const mien=++OE_SEQ;
  /* UN REFUS NE SURVIT PAS AU DOCUMENT QUI L'A VALU. Laissé à l'écran pendant
     la vérification suivante, il accuse le port qu'on vient de poser — « le
     port relie « ? » et « ? » » alors qu'il relie Conductor-1 et
     Conductor-2 — tant que le serveur n'a pas répondu, et sur une carte
     entière cela peut durer. Le bilan dit alors « vérification… ». */
  if(ANT.refus){
    ANT.refus=null;
    if(typeof antBilanRendre==="function")antBilanRendre();
  }
  try{
    const modele=await oePost(OE_ROUTE,antDocument());
    if(mien!==OE_SEQ)return ANT.modele;      // dépassée : on ne touche à rien
    ANT.modele=modele; ANT.refus=null;
    return modele;
  }catch(e){
    if(mien!==OE_SEQ)throw e;
    ANT.modele=null;
    const t=String(e.message||e);
    const i=t.indexOf("\n");
    ANT.refus={message:i>0?t.slice(0,i):t, conseil:i>0?t.slice(i+1):""};
    throw e;
  }
}

/* -- 3. le script --------------------------------------------------------- */
async function oeScript(){
  return oePost(OE_ROUTE+"/script",antDocument());
}

/* -- 4. le lancement ------------------------------------------------------ */
async function oeLancer(){
  ANT.tache=await oePost(OE_ROUTE+"/lancer",antDocument());
  ANT.resultat=null;
  return ANT.tache;
}

async function oeArreter(){
  if(!ANT.tache)return null;
  return oePost(OE_ROUTE+"/arreter?id="+encodeURIComponent(ANT.tache.id),{});
}

/* -- 6. le balayage paramétrique ------------------------------------------ */
/* DEUX APPELS ET NON UN, comme pour la simulation simple : le premier chiffre
   la plage sans rien lancer — combien de points, combien de cellules, combien
   de temps —, le second l'exécute. On ne s'engage pas dans une heure de
   calcul sans avoir vu ce qu'elle va coûter.

   Le document est le MÊME que celui d'une simulation ordinaire, augmenté
   d'une liste de points. Chaque point ne porte que ce qu'il CHANGE — un
   polygone, une cote —, pas une copie du document : une carte importée fait
   des mégaoctets, et trente copies feraient trente fois ces mégaoctets sur le
   réseau pour changer un dixième de millimètre. */
function oeDocBalayage(){
  const doc=antDocument();
  doc.balayage=antBalayageSpec();
  return doc;
}

async function oeBalayage(){
  return oePost(OE_ROUTE+"/balayage",oeDocBalayage());
}

async function oeLancerBalayage(){
  ANT.tache=await oePost(OE_ROUTE+"/balayage/lancer",oeDocBalayage());
  ANT.resultat=null;
  return ANT.tache;
}

/* -- 7. le tableau S complet ---------------------------------------------- */
/* MÊME DÉCOUPE QUE LE BALAYAGE, ET POUR LA MÊME RAISON : on chiffre d'abord,
   on lance ensuite. Ici le coût est particulièrement facile à sous-estimer —
   il est multiplié par le nombre de ports, et rien dans le document ne le
   laisse voir.

   LE DOCUMENT EST CELUI D'UNE SIMULATION ORDINAIRE, sans rien de plus. C'est
   le serveur qui en tire N copies, l'excitation déplacée d'un port à l'autre :
   la page n'a pas à savoir comment on excite un port, et elle ne doit surtout
   pas fabriquer elle-même des documents que l'assistant n'aurait pas vus. */
async function oeTableauS(){
  return oePost(OE_ROUTE+"/tableau-s",antDocument());
}

async function oeLancerTableauS(){
  ANT.tache=await oePost(OE_ROUTE+"/tableau-s/lancer",antDocument());
  ANT.resultat=null;
  return ANT.tache;
}

/* -- 5. le suivi ---------------------------------------------------------- */
/* Sonde jusqu'à ce que la tâche s'arrête, en appelant `surAvance` à chaque
   tour. Les lignes de journal s'ACCUMULENT côté page : le serveur n'envoie
   que la suite, et `ANT.tache.lignes` garde tout.

   Le compteur ralentit quand rien n'arrive. Une simulation qui met vingt
   secondes à écrire une ligne n'a pas besoin d'être interrogée dix fois
   entre-temps ; une qui parle vite doit l'être. */
let OE_SUIVI=0;

async function oeSuivre(surAvance){
  if(!ANT.tache)return null;
  const id=ANT.tache.id;
  const mien=++OE_SUIVI;
  let vues=(ANT.tache.lignes||[]).length;
  let attente=OE_SONDAGE;
  const toutes=(ANT.tache.lignes||[]).slice();

  while(mien===OE_SUIVI){
    let j;
    try{
      j=await oeAppel(OE_ROUTE+"/journal?id="+encodeURIComponent(id)
                      +"&depuis="+vues);
    }catch(e){
      /* Le serveur a redémarré, ou le réseau a hoqueté. On ne fait pas
         disparaître le calcul pour autant : il tourne dans son propre
         processus, et il continuera sans nous. */
      ANT.tache.etat="perdu";
      ANT.tache.detail="Le serveur ne répond plus : "+(e.message||e)+
        "\nLe calcul, lui, tourne dans son propre processus — il continue, et "+
        "ses fichiers restent dans son dossier.";
      if(surAvance)surAvance(ANT.tache);
      return ANT.tache;
    }

    const neuf=(j.lignes||[]).length;
    if(neuf){ toutes.push.apply(toutes,j.lignes); attente=OE_SONDAGE; }
    else attente=Math.min(OE_SONDAGE_MAX,attente*1.5);
    vues=j.n;

    ANT.tache=j;
    ANT.tache.lignes=toutes;
    if(surAvance)surAvance(ANT.tache);

    if(j.etat==="fini"||j.etat==="echoue"||j.etat==="arrete"){
      ANT.resultat=(j.etat==="fini")?j.resultat:null;
      return ANT.tache;
    }
    await new Promise(r=>setTimeout(r,attente));
  }
  return ANT.tache;
}

function oeSuiviStop(){ OE_SUIVI++; }
