"use strict";
/* =============================================================================
   Antenne openEMS — 19-demarrage.js
   Les branchements, et rien qu'eux.

   CE FICHIER NE CONTIENT AUCUNE LOGIQUE MÉTIER, et c'est volontaire : quand
   quelque chose ne se déclenche pas, c'est ici qu'on regarde, et on doit
   pouvoir y lire toutes les liaisons d'un coup sans les chercher entre deux
   calculs.

   Deux enveloppes autour de fonctions de la visionneuse — `poser` et
   `mdlCharger` —, pour la même raison que dans 15-overlay2d.js : ces fichiers
   appartiennent à l'autre outil et continueront d'évoluer de leur côté.
   ============================================================================= */

/* -------------------------------------------------------------------------
   1. Une carte vient d'être ouverte
   -------------------------------------------------------------------------
   `poser` est l'entonnoir par lequel passent les trois chemins d'ouverture :
   le bouton, le dépôt de fichier, et la reprise de session. S'y accrocher
   évite d'avoir à les brancher un par un — et d'en oublier un.
   ------------------------------------------------------------------------- */
(function(){
  const base=window.poser;
  if(typeof base!=="function")return;
  window.poser=function(modele,nom,vue){
    base(modele,nom,vue);
    /* RAZ AVANT TOUT : une sélection de nets d'une autre carte désigne des
       index qui ne veulent plus rien dire. Les garder produirait une
       simulation sur du cuivre quelconque — une faute silencieuse. */
    antRaz();
    antAssistantRendre();
    antJournalRendre();
    antResultatsRendre();
    antMaj(true);
  };
})();

/* -------------------------------------------------------------------------
   2. La sélection sur la carte a changé
   -------------------------------------------------------------------------
   L'étape « Le cuivre » affiche ce que le clic vient de désigner, et le bouton
   « Prendre la sélection » ne doit pas être le seul indice qu'il s'est passé
   quelque chose. On se greffe sur `selPoser`, par où passent le clic sur le
   canevas, le clic dans la liste des nets et celui dans la liste des boîtiers.
   ------------------------------------------------------------------------- */
(function(){
  const base=window.selPoser;
  if(typeof base!=="function")return;
  window.selPoser=function(s,mev,ajouter,isDbl){
    base(s,mev,ajouter,isDbl);
    if(ANT.etape===0&&V.modele)antAssistantRendre();
  };
})();

/* -------------------------------------------------------------------------
   3. La barre d'outils
   ------------------------------------------------------------------------- */
function antBrancherBarre(){
  const b=function(id,fn){
    const el=document.getElementById(id);
    if(el)el.onclick=fn;
  };

  b("bAssistant",function(){
    /* Le panneau peut avoir été fermé : `wsShow` le remet à sa place plutôt
       que de le faire apparaître ailleurs. */
    if(typeof wsShow==="function")wsShow("assistant");
    antAssistantRendre();
  });
  b("bScript",antTelechargerScript);
  b("bLancer",antLancer);
  b("bArreter",antArreter);
  b("bVue2d",function(){ antVuePoser("2d"); });
  b("bVue3d",function(){ antVuePoser("3d"); });

  /* Le raccourci qui sert le plus : passer d'une vue à l'autre sans quitter
     le clavier. `V` est pris par la visionneuse (rien), `3` est libre. */
  window.addEventListener("keydown",function(e){
    if(e.target&&/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;
    if(e.ctrlKey||e.altKey||e.metaKey)return;
    if(e.key==="3"){ antVuePoser(ANT.vue==="3d"?"2d":"3d"); }
    if(e.key==="Escape"&&ANT.posePort){
      ANT.posePort=false;
      document.body.classList.remove("pose-port");
      antAssistantRendre();
    }
  });
}

/* -------------------------------------------------------------------------
   4. L'état du serveur
   -------------------------------------------------------------------------
   Interrogé une fois, au démarrage. La réponse dit DEUX choses distinctes —
   « je sais préparer » et « je sais lancer » — et l'interface les traite
   séparément : sur un poste sans openEMS, tout marche sauf le bouton
   « Lancer », et il dit pourquoi.
   ------------------------------------------------------------------------- */
async function antSonderServeur(){
  const f=document.getElementById("fSolveur");
  try{
    /* La découverte du serveur appartient à 01-api.js : on la déclenche avant
       d'appeler nos routes, sans quoi API_BASE est encore nul et la requête
       part sur la mauvaise origine. */
    await apiConnecter();
    await oeEtat();
  }catch(e){
    ANT.etatServeur={dispo:false,preparer:false,lancer:false,
                     detail:String(e.message||e)};
  }
  antBoutonsEtat();
  if(f&&ANT.etatServeur&&!ANT.etatServeur.lancer)
    f.title=(ANT.etatServeur.lancer_detail||ANT.etatServeur.detail||"")+
            "\n"+(ANT.etatServeur.lancer_conseil||"");
  antAssistantRendre();
}

/* -------------------------------------------------------------------------
   5. Le démarrage
   ------------------------------------------------------------------------- */
window.addEventListener("DOMContentLoaded",function(){
  antReglagesLire();
  antBrancherBarre();
  antPosePortInstaller();
  antVuePoser("2d");
  antAssistantRendre();
  antJournalRendre();
  antResultatsRendre();
  antSonderServeur();
});

/* Quitter pendant un calcul : on prévient, et on ne fait rien de plus. Le
   calcul tourne dans son propre processus côté serveur — fermer l'onglet ne
   l'arrête pas, et c'est exactement ce qu'on veut : une simulation d'une
   heure ne doit pas dépendre d'un onglet resté ouvert. */
window.addEventListener("beforeunload",function(e){
  if(ANT.tache&&(ANT.tache.etat==="calcule"||ANT.tache.etat==="prepare")){
    e.preventDefault();
    e.returnValue="";
  }
});
