"use strict";
/* =============================================================================
   Antenne openEMS — 06-ouverture.js
   Ouvrir un fichier, câbler les boutons, retrouver ses réglages d'affichage.

   Deux façons d'ouvrir, une seule route derrière : le bouton et le
   glisser-déposer se rejoignent dans `charger()`.

   CE QUE CE MODULE N'A PAS. Il vient de la visionneuse IPC-2581 de WEB_CAO,
   d'où l'outil tient aussi sa lecture de carte et son rendu. Là-bas il était
   branché sur trois services du dépôt — profils d'utilisateur, dossiers de
   projet, reprise de session d'un outil à l'autre — qui n'ont plus d'objet ici :
   il n'y a qu'un outil, et rien à reprendre en arrivant. Les réglages
   d'affichage vont donc dans le stockage local du navigateur, ce qui les rend
   propres à la machine plutôt qu'à la personne. C'est le bon compromis pour
   une page unique ; c'est aussi la seule chose qu'on perd.
   ============================================================================= */

/* Les réglages gardés : des préférences d'AFFICHAGE, et les valeurs
   d'empilage saisies à la main. Jamais la carte elle-même — elle se rouvre. */
const PREF_CLE="openems-antenne.affichage.v1";

function prefEcrire(){
  const cachees=[];
  for(const c of V.couches)if(!c.visible)cachees.push(c.nom);
  try{
    localStorage.setItem(PREF_CLE,JSON.stringify(
      {aff:V.aff,flip:V.vue.flip,cachees:cachees,sur:V.sur}));
  }catch(e){}
}
function prefLire(){
  try{
    const p=JSON.parse(localStorage.getItem(PREF_CLE)||"null");
    return (p&&typeof p==="object")?p:null;
  }catch(e){ return null; }
}

/* Les réglages s'appliquent à la carte qui vient d'arriver : les couches se
   désignent par leur NOM, le seul repère qui survive d'un fichier à l'autre.
   Les désigner par leur rang ferait masquer la couche 3 d'une carte parce
   qu'on avait masqué la couche 3 d'une autre. */
function prefAppliquer(){
  const p=prefLire();
  if(!p)return;
  if(p.aff)for(const k in V.aff)if(k in p.aff)V.aff[k]=!!p.aff[k];
  V.vue.flip=!!p.flip;
  if(Array.isArray(p.cachees)){
    const cachees=new Set(p.cachees);
    for(const c of V.couches)if(cachees.has(c.nom))c.visible=false;
  }
  boutonsEtat();
}

/* Les valeurs d'empilage saisies faute de les trouver dans le fichier. Elles
   se relisent AVANT que le modèle ne soit dressé — c'est `ltPreparer()` qui
   s'en sert —, d'où un chargement à part de celui des réglages d'affichage. */
function prefSurcharges(){
  V.sur={cu:{},gap_t:{},gap_er:{},role:{}};
  const p=prefLire();
  if(!p||!p.sur||typeof p.sur!=="object")return;
  for(const quoi of ["cu","gap_t","gap_er"]){
    const t=p.sur[quoi];
    if(!t||typeof t!=="object")continue;
    for(const cle in t){
      const v=+t[cle];
      if(isFinite(v)&&v>0)V.sur[quoi][cle]=v;
    }
  }
  if(p.sur.role&&typeof p.sur.role==="object"){
    for(const cle in p.sur.role){
      const r=String(p.sur.role[cle]||"").toLowerCase();
      if(r==="plan"||r==="signal"||r==="gnd"||r==="pwr")V.sur.role[cle]=r;
    }
  }
}

function boutonsEtat(){
  const bt=function(id,on){
    const b=document.getElementById(id);
    if(b)b.classList.toggle("on",!!on);
  };
  bt("bRefs",V.aff.refs); bt("bTrous",V.aff.trous); bt("bPlans",V.aff.plans);
  bt("bFlip",V.vue.flip);
  const t=document.getElementById("bFlipTxt");
  if(t)t.textContent=V.vue.flip?"Dessus":"Dessous";
}

/* ==========================================================================
   Ouverture
   ========================================================================== */
function attente(on,titre,detail){
  const el=document.getElementById("attente");
  if(!el)return;
  el.hidden=!on;
  if(titre)document.getElementById("attenteTitre").textContent=titre;
  document.getElementById("attenteDetail").textContent=detail||"";
}

function erreur(msg){
  const el=document.getElementById("depotErr");
  if(el)el.textContent=msg||"";
  if(!msg)return;
  /* L'écran d'accueil s'efface dès qu'une carte est ouverte : le message
     n'aurait alors personne pour le lire. Il passe par le pied de page, où la
     première ligne suffit à dire ce qui a manqué. */
  hint(V.modele?("Échec : "+String(msg).split(/\r?\n/)[0]):"Échec de l'ouverture.");
}

async function charger(fichier){
  if(!fichier)return;
  erreur("");
  /* Le fichier est envoyé au serveur et parsé là-bas : quelques secondes sur
     une carte de fabrication, et un écran muet passerait pour un plantage. */
  attente(true,"Lecture de "+fichier.name+"…",
          /\.json$/i.test(fichier.name)
            ? "relecture d'un modèle déjà traduit"
            : "le parseur Python travaille sur le serveur");
  hint("Lecture de "+fichier.name+"…");
  try{
    const modele=await apiCharger(fichier);
    poser(modele,fichier.name);
    let dit="« "+V.fichier+" » ouvert : "+mdlEntier(modele.stats.composants)
      +" composant(s), "+mdlEntier(modele.stats.pistes)+" piste(s).";
    /* CE QUI MANQUE À L'EMPILAGE SE DIT À L'OUVERTURE, et non au moment du
       calcul : c'est ici qu'on peut encore le compléter avant d'avoir choisi
       une bande et posé un port. Une permittivité devinée déplace la
       résonance de plusieurs pour cent. */
    const man=ltManques();
    if(man.total||man.aucunPlan)
      dit+=" Empilage incomplet ("+(man.total||"aucun plan de référence")
        +(man.total?" valeur(s) absente(s)":"")
        +") : complétez-le à l'étape « L'empilage ».";
    hint(dit);
  }catch(e){
    erreur(e.message||String(e));
    document.getElementById("accueil").hidden=!!V.modele;
  }finally{
    attente(false);
  }
}

/* Ce que fait un modèle une fois arrivé : il devient la carte affichée.
   19-demarrage.js enveloppe cette fonction pour remettre l'assistant à neuf —
   c'est l'entonnoir par lequel passent toutes les ouvertures. */
function poser(modele,nom,vue){
  /* Les valeurs d'empilage saisies d'abord : `mdlCharger()` dresse l'empilage
     de calcul en s'en servant. */
  prefSurcharges();
  mdlCharger(modele,nom);
  prefAppliquer();
  pnlTout();
  document.getElementById("accueil").hidden=true;
  if(vue&&vue.scale>0){ V.vue.scale=vue.scale; V.vue.ox=vue.ox; V.vue.oy=vue.oy;
                        V.vue.flip=!!vue.flip; boutonsEtat(); dessiner(); }
  else fit();
}

/* ==========================================================================
   Exports
   ========================================================================== */
function telecharger(blob,nom){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){URL.revokeObjectURL(url);},4000);
}

function nomBase(){
  return (V.fichier||"carte").replace(/\.[^.]+$/,"")||"carte";
}

/* Le modèle traduit, tel qu'il est arrivé du serveur. Les champs calculés à
   l'affichage (boîtes de composants, boîtes de pistes) sont retirés : ils se
   recalculent en une passe, et les garder doublerait le fichier. */
function modeleTexte(){
  return JSON.stringify(V.modele,function(cle,valeur){
    return (cle==="boite"||cle==="_b")?undefined:valeur;
  });
}

function exportJson(){
  if(!V.modele)return;
  telecharger(new Blob([modeleTexte()],{type:"application/json"}),nomBase()+".json");
  hint("Modèle exporté : il se rouvre ici sans que le parseur ait à retravailler.");
}

function exportPng(){
  if(!V.modele)return;
  const k=2, W=cv.clientWidth, H=cv.clientHeight;
  const o=document.createElement("canvas");
  o.width=Math.round(W*k); o.height=Math.round(H*k);
  peindre(o.getContext("2d"),k,o.width,o.height);
  o.toBlob(function(b){
    if(b)telecharger(b,nomBase()+".png");
    hint("Image exportée.");
  },"image/png");
}

/* ==========================================================================
   Câblage
   ========================================================================== */
(function(){
  const champ=document.getElementById("fichier");
  const ouvrir=function(){ champ.click(); };
  document.getElementById("bOuvrir").onclick=ouvrir;
  document.getElementById("bOuvrir2").onclick=ouvrir;
  /* La zone de dépôt entière ouvre le sélecteur : elle dit « cliquez pour le
     choisir », et viser le bouton n'est pas ce qu'on lit. */
  document.getElementById("depot").onclick=function(e){
    if(e.target.tagName!=="BUTTON")ouvrir();
  };
  champ.addEventListener("change",function(){
    if(champ.files&&champ.files[0])charger(champ.files[0]);
    champ.value="";                       // rouvrir le même fichier reste possible
  });

  /* Glisser-déposer sur toute la page : viser une zone de dépôt qu'on ne voit
     plus une fois la carte ouverte n'aurait pas de sens. */
  const depot=document.getElementById("depot");
  const survol=function(on){ if(depot)depot.classList.toggle("survol",on); };
  document.addEventListener("dragover",function(e){
    e.preventDefault(); e.dataTransfer.dropEffect="copy"; survol(true);
  });
  document.addEventListener("dragleave",function(e){
    if(e.relatedTarget===null)survol(false);
  });
  document.addEventListener("drop",function(e){
    e.preventDefault(); survol(false);
    const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];
    if(f)charger(f);
  });

  document.getElementById("bJson").onclick=exportJson;
  document.getElementById("bPng").onclick=exportPng;
  document.getElementById("bFit").onclick=fit;
  document.getElementById("bFlip").onclick=basculerFace;
  document.getElementById("bRefs").onclick=function(){basculer("refs","bRefs");};
  document.getElementById("bTrous").onclick=function(){basculer("trous","bTrous");};
  document.getElementById("bPlans").onclick=function(){basculer("plans","bPlans");};

  document.getElementById("bCchTout").onclick=function(){pnlCouchesToutes(true);};
  document.getElementById("bCchRien").onclick=function(){pnlCouchesToutes(false);};
  document.getElementById("bCchCuivre").onclick=function(){pnlCouchesToutes(false,true);};
  document.getElementById("filtreNets").addEventListener("input",pnlNets);
  document.getElementById("filtreComps").addEventListener("input",pnlComps);
  document.getElementById("bNetRien").onclick=choisirRien;

  window.addEventListener("resize",resize);
})();

/* ==========================================================================
   Démarrage
   ========================================================================== */
(function(){
  boutonsEtat();
  pnlTout();
  resize();
  hint("Ouvrez un fichier IPC-2581 pour commencer.");
  /* Sonder le serveur tout de suite : mieux vaut apprendre qu'il manque avant
     d'avoir choisi un fichier de quarante mégaoctets. */
  if(typeof apiConnecter==="function")
    apiConnecter().catch(function(e){ erreur(e.message); });
})();
