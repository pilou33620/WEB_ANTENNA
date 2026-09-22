"use strict";
/* =============================================================================
   Antenne openEMS — 13-assistant.js
   Les sept étapes, et ce qu'elles refusent de laisser passer.

   CE QUE CET ASSISTANT EST, ET CE QU'IL N'EST PAS. Il n'est pas un habillage
   de formulaire : chacune de ses étapes existe parce qu'une simulation FDTD
   d'antenne échoue TOUJOURS de la même poignée de façons, et qu'aucune de ces
   façons ne se voit dans le résultat. Un S11 calculé avec une marge d'air
   trop courte, une permittivité devinée ou un port mal orienté ne ressemble
   pas à une erreur : il ressemble à un résultat. C'est pour cela que chaque
   étape dit ce qu'elle a supposé, et que le bilan du bas ne s'efface jamais.
   ============================================================================= */

function aE(id){ return document.getElementById(id); }
function aEsc(s){ return mdlEsc(String(s==null?"":s)); }

/* Un nombre lisible : espace fine entre les milliers, virgule décimale. */
function aNb(v,dec){
  if(v==null||!isFinite(v))return "—";
  const s=Number(v).toFixed(dec==null?2:dec);
  const p=s.split(".");
  p[0]=p[0].replace(/\B(?=(\d{3})+(?!\d))/g," ");
  return p.join(",");
}
function aEnt(v){ return aNb(v,0); }

/* Une fréquence dans l'unité choisie par l'utilisateur. */
function aF(hz){ return aNb(hz/antKf(),4)+" "+ANT.uniteF; }
/* Une longueur, dans l'unité du fichier. */
function aL(v,dec){ return aNb(v,dec==null?3:dec)+" "+antUnite(); }

/* UNE LONGUEUR VENUE DU MODÈLE, ÉCRITE DANS L'UNITÉ DU FICHIER. Le modèle
   travaille en millimètres — c'est le serveur qui a converti, une fois —, la
   page affiche en mm, en pouces ou en mils selon le document. Les passer à
   `aL` telles quelles écrirait « 6,400 in » pour six millimètres de ruban : un
   nombre juste avec la mauvaise unité, c'est-à-dire un nombre faux qui a l'air
   d'un nombre. La conversion vaut aussi pour 16-resultats.js, d'où la
   fonction plutôt qu'un facteur recopié. */
function antLongModele(v,dec){
  return aL(v*((V.unite==="in")?(1/25.4):1),dec);
}

/* ==========================================================================
   Liaison robuste pour la saisie numérique
   --------------------------------------------------------------------------
   - Accepte indifféremment la virgule ',' et le point '.'.
   - Ne remet PAS la valeur à zéro et ne déclenche PAS de recalcul pendant que
     l'utilisateur tape un état intermédiaire (ex: '0,' ou '-' ou champ vide).
   - Déclenche `antMaj()` dès qu'un nombre valide et complet est saisi.
   - Sur `change` (perte de focus ou Entrée), normalise l'affichage avec `mdlNb()`.
   ========================================================================== */
function antLierNombre(el, obj, cle, options){
  if(!el)return;
  const opts=options||{};
  const min=(opts.min!=null)?opts.min:-Infinity;
  const max=(opts.max!=null)?opts.max:Infinity;
  const defaut=(opts.defaut!=null)?opts.defaut:0;
  const facteur=opts.facteur||1;
  const ent=!!opts.entier;
  const apres=opts.apres;

  el.oninput=function(){
    /* Les espaces sont retirés AVANT la lecture : le champ peut afficher un
       nombre groupé par milliers — « 52 000 » —, et `parseInt` s'arrête au
       premier espace. Il aurait lu 52. */
    const s=String(el.value).trim().replace(/\s/g,"").replace(",",".");
    /* Une valeur CALCULÉE est affichée telle quelle dans le champ (voir
       `antAutoEcrire`). La retrouver à l'identique n'est donc pas une saisie :
       c'est le nombre qu'on y a mis. L'écrire dans l'état figerait le réglage
       sur le maillage du jour, et c'est précisément ce qu'on évite. */
    if(el.dataset.auto&&s===String(el.dataset.auto).replace(/\s/g,"").replace(",","."))return;
    /* Si l'utilisateur est en train de taper (ex: "0," ou "-" ou vide), on le
       laisse taper : écraser à zéro ou recalculer à chaque virgule ferait perdre
       la saisie et le curseur. */
    if(s===""||s==="."||s==="-"||s.endsWith("."))return;
    const v=ent?parseInt(s,10):parseFloat(s);
    if(isFinite(v)){
      const val=v*facteur;
      if(val>=min&&val<=max){
        obj[cle]=val;
        if(typeof apres==="function")apres(val);
        antMaj();
      }
    }
  };

  el.onchange=function(){
    const s=String(el.value).trim().replace(/\s/g,"").replace(",",".");
    if(el.dataset.auto&&s===String(el.dataset.auto).replace(/\s/g,"").replace(",","."))return;
    const v=ent?parseInt(s,10):parseFloat(s);
    if(isFinite(v)){
      let val=v*facteur;
      if(val<min)val=min;
      if(val>max)val=max;
      obj[cle]=val;
      el.value=ent?String(Math.round(val/facteur)):mdlNb(val/facteur);
      if(typeof apres==="function")apres(val);
    }else{
      obj[cle]=defaut;
      el.value=ent?String(Math.round(defaut/facteur)):mdlNb(defaut/facteur);
      if(typeof apres==="function")apres(defaut);
    }
    antMaj(true);
  };
}

/* ==========================================================================
   Les champs dont zéro veut dire « calculé »
   --------------------------------------------------------------------------
   ZÉRO EST UN BON ÉTAT INTERNE ET UN MAUVAIS AFFICHAGE. Sept réglages — les
   quatre marges d'air, les deux pas de maillage, le compteur de pas — se
   calculent quand on les laisse à zéro, et le calcul est le bon : il suit le
   maillage, la bande et le cuivre réellement retenu. Mais un champ qui
   affiche « 0 » ne dit pas ce qui part au solveur, et « 0 = calculé » en
   petit sous le libellé demande de croire sur parole. On affiche donc LE
   NOMBRE, en gris, avec une étiquette qui dit d'où il vient.

   CE QU'ON N'ÉCRIT PAS DANS L'ÉTAT : ce nombre. Il y resterait figé au
   maillage du jour, et l'on retomberait exactement sur le défaut que ces
   champs corrigent — un pas saisi une fois ne vaut plus rien dès qu'on
   retouche la grille. L'état garde zéro ; seul l'affichage est rempli, la
   saisie reprend la main à la première frappe, et l'étiquette « imposé ↺ »
   rend le champ au calcul.

   VRAI PARTOUT, ET PAS SEULEMENT SUR L'EXEMPLE. Ces champs sont les mêmes
   qu'on vienne d'un fichier IPC-2581, du mode conception ou d'un exemple :
   `antRaz()` remet les sept à zéro à chaque ouverture de carte, et le modèle
   les recalcule à chaque modification du dessin.
   ========================================================================== */
const ANT_AUTO=[
  {id:"antMx",  o:function(){return ANT.boite;},    c:"mx",
   v:function(m){return m.boite.marge_conseil;},    etq:"antMargeEtq"},
  {id:"antMy",  o:function(){return ANT.boite;},    c:"my",
   v:function(m){return m.boite.marge_conseil;},    etq:"antMargeEtq"},
  {id:"antMzh", o:function(){return ANT.boite;},    c:"mz_haut",
   v:function(m){return m.boite.marge_conseil;},    etq:"antMargeEtq"},
  {id:"antMzb", o:function(){return ANT.boite;},    c:"mz_bas",
   v:function(m){return m.boite.marge_conseil;},    etq:"antMargeEtq"},
  {id:"antRa",  o:function(){return ANT.maillage;}, c:"res_air",
   v:function(m){return (m.resolution.detail||{}).air;}, etq:"antRaEtq"},
  {id:"antRd",  o:function(){return ANT.maillage;}, c:"res_die",
   v:function(m){return (m.resolution.detail||{}).die;}, etq:"antRdEtq"},
  {id:"antNmax",o:function(){return ANT.arret;},    c:"nmax",
   v:function(m){return m.arret.nmax_calcule;},     etq:"antNmaxEtq", entier:true}
];

/* Le bouton-étiquette posé à côté du libellé. Vide au rendu : c'est
   `antAutoEcrire` qui le remplit, parce que son texte dépend du modèle, qui
   arrive après. */
function antAutoEtq(id){
  return ' <button type="button" class="etq" id="'+id+'"></button>';
}

/* Remplit les champs calculés et leurs étiquettes. Appelée après chaque
   rendu ET à chaque retour du modèle : les valeurs changent quand le dessin
   change, et un champ qui afficherait le pas d'avant mentirait plus qu'un
   zéro. */
function antAutoEcrire(corps){
  if(!corps)return;
  const m=ANT.modele;
  const k=(V.unite==="in")?(1/25.4):1;
  const focus=document.activeElement;
  const etqs={};
  ANT_AUTO.forEach(function(ch){
    const el=corps.querySelector("#"+ch.id);
    if(!el)return;
    const auto=!(+ch.o()[ch.c]>0);
    let v=null;
    if(m){ try{ v=ch.v(m); }catch(e){ v=null; } }
    if(auto&&v!=null&&isFinite(v)){
      const t=ch.entier?mdlEntier(Math.round(v)):mdlNb(v*k);
      /* JAMAIS SOUS LES DOIGTS : réécrire un champ pendant la frappe
         déplacerait le curseur et mangerait la décimale en cours. */
      if(el!==focus){ el.value=t; el.dataset.auto=t; }
    }else{
      el.dataset.auto="";
    }
    el.classList.toggle("auto",auto);
    /* Une étiquette peut commander plusieurs champs — les quatre marges n'en
       ont qu'une. Elle est « calculé » tant que TOUS le sont. */
    const e=etqs[ch.etq]||(etqs[ch.etq]={auto:true, champs:[]});
    e.auto=e.auto&&auto;
    e.champs.push(ch);
  });
  Object.keys(etqs).forEach(function(id){
    const b=corps.querySelector("#"+id);
    if(!b)return;
    const e=etqs[id];
    b.textContent=e.auto?"calculé":"imposé ↺";
    b.className="etq "+(e.auto?"est-auto":"est-impose");
    b.disabled=e.auto;
    b.title=e.auto
      ? "Cette valeur est calculée par le modèle. Tapez-en une pour l'imposer."
      : "Revenir à la valeur que le modèle calcule.";
    b.onclick=e.auto?null:function(){
      e.champs.forEach(function(ch){ ch.o()[ch.c]=0; });
      antMaj(true);
    };
  });
}

/* ==========================================================================
   Le cycle : on change quelque chose -> le serveur revérifie -> on redessine
   --------------------------------------------------------------------------
   La vérification part au serveur à CHAQUE modification, mais pas à chaque
   frappe : un champ de saisie envoie une dizaine d'événements par seconde, et
   dix requêtes par seconde sur un maillage à chiffrer ne serviraient à rien
   qu'à faire clignoter le bilan. Le délai de 350 ms laisse le temps de taper
   une décimale sans hacher la frappe.
   ========================================================================== */
let ANT_ATTENTE=0;

function antMaj(immediat){
  antVieillir();
  clearTimeout(ANT_ATTENTE);
  const faire=async function(){
    if(!V.modele)return;
    try{ await oePreparer(); }
    catch(e){ /* le refus est déjà dans ANT.refus */ }
    antAssistantRendre(false);
    antReglagesEcrire();
    redessiner();
    if(ANT.vue==="3d"&&typeof ant3dMaj==="function")ant3dMaj();
  };
  if(immediat)faire();
  else ANT_ATTENTE=setTimeout(faire,350);
}

/* ==========================================================================
   Le squelette
   ========================================================================== */
function antAssistantRendre(forcer){
  antEtapesRendre();
  const corps=aE("assistantCorps");
  if(!corps)return;
  if(!V.modele){
    corps.innerHTML='<div class="rien">Ouvrez d\'abord une carte : '+
      'l\'assistant travaille sur le cuivre réel, pas sur une page blanche.</div>';
    aE("assistantBilan").innerHTML="";
    corps.dataset.etape="";
    return;
  }
  const etape=ANT_ETAPES[ANT.etape];
  const etapeId=etape.id;

  /* Si l'utilisateur est en train de taper dans un champ de cette étape,
     on ne détruit JAMAIS son champ, même sur un rafraîchissement demandé. */
  const actif=document.activeElement;
  const saisieEnCours=actif&&corps.contains(actif)&&(actif.tagName==="INPUT"||actif.tagName==="TEXTAREA");

  if((forcer&&!saisieEnCours)||corps.dataset.etape!==etapeId){
    corps.dataset.etape=etapeId;
    corps.innerHTML=ANT_CORPS[etapeId]();
    ANT_LIER[etapeId](corps);
  }else{
    antEtapeActualiser(etapeId,corps);
  }
  antBilanRendre();
  antBoutonsEtat();
}

function antEtapeActualiser(etapeId,corps){
  const m=ANT.modele;
  const k=(V.unite==="in")?(1/25.4):1;
  if(etapeId==="boite"){
    const cEl=corps.querySelector("#antBoiteConseil");
    if(cEl){
      cEl.innerHTML=antBoiteConseilHtml(m,k);
    }
    const mEl=corps.querySelector("#antMaillageNote");
    if(mEl)mEl.innerHTML=antMaillageNoteHtml(m,k);
    const rEl=corps.querySelector("#antBoiteRecap");
    if(rEl)rEl.innerHTML=antBoiteRecapHtml(m,k);
  }else if(etapeId==="bande"){
    const rEl=corps.querySelector("#antBandeRecap");
    if(rEl)rEl.innerHTML=antBandeRecapHtml(m);
  }else if(etapeId==="port"){
    const rEl=corps.querySelector("#antPortRecap");
    if(rEl)rEl.innerHTML=antPortRecapHtml();
  }else if(etapeId==="cuivre"){
    const rEl=corps.querySelector("#antCuivreRecap");
    if(rEl)rEl.innerHTML=antCuivreRecapHtml();
  }else if(etapeId==="calcul"){
    const nEl=corps.querySelector("#antNmaxNote");
    if(nEl)nEl.innerHTML=antNmaxNoteHtml(m);
  }
  /* LES CHAMPS CALCULÉS EN DERNIER, ET À CHAQUE PASSAGE : ce sont les seuls
     dont la valeur affichée est produite par le modèle. Les laisser au rendu
     initial voudrait dire afficher le pas de maillage d'avant la dernière
     retouche du dessin. */
  antAutoEcrire(corps);
}

function antEtapesRendre(){
  const box=aE("etapes");
  if(!box)return;
  box.innerHTML=ANT_ETAPES.map(function(e,i){
    const etat=antEtapeEtat(i);
    return '<button class="etp '+(i===ANT.etape?"on":"")+' '+etat+'" '+
      'data-etape="'+i+'" title="'+aEsc(e.sous)+'">'+
      '<span class="n">'+(i+1)+'</span><span class="t">'+aEsc(e.titre)+'</span>'+
      '</button>';
  }).join("");
  box.querySelectorAll("[data-etape]").forEach(function(b){
    b.onclick=function(){ ANT.etape=+b.dataset.etape; antAssistantRendre(true); };
  });
}

/* L'état d'une étape : « vide » tant qu'on n'y a rien mis, « faite » quand ce
   qu'elle demande est là. Ce n'est pas un verrou — on peut aller à la sixième
   sans avoir rempli la première — mais un repère : la pastille grise dit ce
   qui manque, et le bouton « Lancer » reste éteint tant qu'il manque quelque
   chose. */
function antEtapeEtat(i){
  switch(ANT_ETAPES[i].id){
    case "cuivre":   return (ANT.nets.size||ANT.formes.length)?"faite":"vide";
    case "empilage": return (LT.pret&&LT.gap.every(g=>g.t>0))?"faite":"vide";
    /* « Autour » n'a rien d'obligatoire : une antenne nue est un cas
       legitime. La pastille verte dit « j'ai mis quelque chose », pas
       « c'est complet ». */
    case "objets":   return ANT.primitives.length?"faite":"vide";
    case "bande":    return (ANT.bande.f1>0&&ANT.bande.f2>ANT.bande.f1)?"faite":"vide";
    /* Tous les ports, et non le seul qu'on regle : l'etape est faite quand
       l'onde a par ou entrer, pas quand le port 2 est selectionne. */
    case "port":     return ANT.ports.some(p=>p.pose)?"faite":"vide";
    case "boite":    return ANT.modele?"faite":"vide";
    case "calcul":   return ANT.resultat?"faite":"vide";
  }
  return "vide";
}

/* ==========================================================================
   Le bilan, toujours visible
   ========================================================================== */
function antBilanRendre(){
  const box=aE("assistantBilan");
  if(!box)return;

  if(ANT.refus){
    box.className="pnl-bar bilan refus";
    box.innerHTML='<b>Ce modèle ne peut pas être lancé</b>'+
      '<div class="msg">'+aEsc(ANT.refus.message)+'</div>'+
      (ANT.refus.conseil?'<div class="conseil">'+aEsc(ANT.refus.conseil)+'</div>':"");
    return;
  }
  if(!ANT.modele){
    box.className="pnl-bar bilan";
    box.innerHTML='<span class="attente">vérification…</span>';
    return;
  }

  const m=ANT.modele, e=m.estimation;
  /* LA DURÉE EST UN ORDRE DE GRANDEUR ET LE DIT. Cellules x pas de temps
     divisé par un débit supposé : la vérité dépend du processeur, du nombre
     de fils, de la mémoire. Annoncer « 14 min 32 s » serait une précision
     mensongère ; annoncer « quelques dizaines de minutes » est utile. */
  const pas=Math.min(m.arret.nmax,
                     Math.max(2000,Math.round(20/(m.bande.f0*e.dt_s))));
  const secondes=e.cellules*pas/(e.mcps_suppose*1e6);

  box.className="pnl-bar bilan";
  box.innerHTML=
    '<div class="chiffres">'+
      '<span><b>'+aEnt(e.cellules)+'</b> cellules</span>'+
      '<span><b>'+aEnt(e.memoire_Mo)+'</b> Mo</span>'+
      '<span><b>'+e.lignes.join(' × ')+'</b> lignes</span>'+
      '<span title="'+aEsc(antDebitDit(e))+'">'+
        '≈ <b>'+antDuree(secondes)+'</b></span>'+
    '</div>'+
    antAvisHtml(m.avis);
}

/* Le serveur écrit sans accents — c'est sa convention, et ses sources restent
   lisibles partout. Ce qui s'affiche, lui, en porte. */
const ANT_CAUSES={"l'energie":"l'énergie", "le garde-fou":"le garde-fou"};

/* D'OÙ VIENT LA DURÉE ANNONCÉE. « Ordre de grandeur » sur une valeur supposée
   n'est pas la même promesse que « mesuré sur ce poste » : le serveur retient
   la vitesse qu'openEMS annonce lui-même à chaque calcul terminé, et la garde
   d'une session à l'autre. L'infobulle dit lequel des deux on lit — sans quoi
   on ne saurait pas si un écart de trois sur la durée vient du modèle ou du
   fait que personne n'a jamais chronométré cette machine. */
function antDebitDit(e){
  const d=aNb(e.mcps_suppose,1)+" Mcellules/s";
  return e.mcps_mesure
    ? ("Débit mesuré sur ce poste : "+d+
       " (médiane de "+e.mcps_n+" calcul(s) terminé(s)). La durée reste un "+
       "ordre de grandeur : le maillage suivant n'a pas la même empreinte.")
    : ("Ordre de grandeur : débit supposé de "+d+", faute d'un calcul "+
       "terminé sur ce poste. "+
       "Le premier calcul qui finira calera les suivants.");
}

function antDuree(s){
  if(!isFinite(s)||s<=0)return "—";
  if(s<90)return Math.round(s)+" s";
  if(s<5400)return Math.round(s/60)+" min";
  return (s/3600).toFixed(1).replace(".",",")+" h";
}

function antAvisHtml(avis){
  if(!avis||!avis.length)return "";
  const rang={grave:0,attention:1,info:2};
  return '<div class="avis">'+avis.slice()
    .sort((a,b)=>(rang[a.rang]||9)-(rang[b.rang]||9))
    .map(a=>'<div class="av '+a.rang+'"><b>'+aEsc(a.titre)+'</b>'+
            '<span>'+aEsc(a.texte)+'</span></div>').join("")+'</div>';
}

/* ==========================================================================
   Étape 1 — le cuivre
   ========================================================================== */
const ANT_CORPS={}, ANT_LIER={};

ANT_CORPS.cuivre=function(){
  const cu=antCuivreDuModele();
  const c=cu.compte;
  const netsHtml=Array.from(ANT.nets).map(function(i){
    const n=V.parNet[i];
    return '<span class="jeton" data-retirer="'+i+'">'+aEsc(n?n.nom:"?")+
           ' <b>✕</b></span>';
  }).concat(ANT.formes.map(function(f,k){
    return '<span class="jeton" data-retirerf="'+k+'">'+aEsc(antFormeNom(f))+
           ' <b>✕</b></span>';
  })).join("")||'<span class="rien">aucun</span>';

  /* Le fichier ne declare-t-il aucune connectivite ? On le dit ICI, a
     l'endroit ou l'on demande de designer un net, et pas dans un message
     d'erreur trois etapes plus loin. */
  const netsVrais=V.parNet.filter(n=>!antNetFourreTout(n.i)).length;
  const sansNets=V.parNet.length&&!netsVrais;

  /* Le fourre-tout reste dans la liste — le masquer laisserait croire que le
     fichier ne dit rien de ce cuivre —, mais il est marqué : le choisir
     comme masse ferait entrer toute la carte. */
  const options=V.parNet.map(function(n){
    return '<option value="'+n.i+'"'+(n.i===ANT.netMasse?" selected":"")+'>'+
           aEsc(n.nom)+(antNetFourreTout(n.i)?" — fourre-tout, pas un net":"")+
           '</option>';
  }).join("");

  const couches=V.couches.filter(x=>x.cuivre).sort((a,b)=>a.seq-b.seq)
    .map(function(x){
      return '<label class="ck"><input type="checkbox" data-cch="'+x.i+'"'+
        (ANT.couches.has(x.i)?" checked":"")+'>'+
        '<span class="pastille" style="background:'+x.couleur+'"></span>'+
        aEsc(x.nom)+
        '<span class="cpt">'+aEnt(x.cpt)+'</span></label>';
    }).join("");

  return `
<p class="intro">Désignez l'antenne sur la carte — cliquez son cuivre, ou
   <kbd>Ctrl</kbd>+clic pour en prendre plusieurs morceaux —, puis appuyez sur
   « Prendre la sélection ». Ce qui est cliqué entre par son net quand le
   fichier en déclare un, et pièce par pièce sinon.</p>

${sansNets?'<p class="alerte">Ce fichier ne déclare pas de connectivité : tout '+
  'son cuivre est dans un fourre-tout, et prendre ce « net » reviendrait à '+
  'prendre la carte entière. Désignez directement les morceaux de l’antenne '+
  '— pistes, versements, pastilles —, ils entrent un par un.</p>':""}

<div class="champ">
  <label>Antenne <small>nets et morceaux retenus</small></label>
  <div class="jetons" id="antNets">${netsHtml}</div>
  <button class="tb mini" id="bPrendre">⤵ Prendre la sélection de la carte</button>
  <button class="tb mini" id="bViderNets">Vider</button>
</div>

<div class="champ">
  <label>Net de masse <small>le contrepoids : l'antenne rayonne contre lui</small></label>
  <select id="antMasse"><option value="-1">— aucun —</option>${options}</select>
</div>

<div class="champ">
  <label>Couches de cuivre à modéliser</label>
  <div class="cks">${couches}</div>
  <p class="note">Une couche décochée disparaît du modèle, même si un net
     retenu y court. C'est le principal levier sur la taille du maillage.</p>
</div>

<div class="champ">
  <label>Aussi</label>
  <label class="ck"><input type="checkbox" id="antVias"${ANT.avecVias?" checked":""}>
    Les vias métallisés de ces nets
    <small>${ANT.viasSupposes?("dont "+ANT.viasSupposes+" de portée non déclarée"):""}</small></label>
  <label class="ck"><input type="checkbox" id="antPads"${ANT.avecPastilles?" checked":""}>
    Les pastilles de ces nets</label>
</div>

<div class="recap" id="antCuivreRecap">
  ${antCuivreRecapHtml()}
</div>`;
};

function antCuivreRecapHtml(){
  const cu=antCuivreDuModele();
  if(!cu)return "";
  const c=cu.compte;
  return `<span>${aEnt(c.pistes)} segments de piste</span>
  <span>${aEnt(c.arcs)} arcs</span>
  <span>${aEnt(c.plans)} versements</span>
  <span>${aEnt(c.pads)} pastilles</span>
  <span>${aEnt(cu.vias.length)} vias</span>
  ${c.fins?'<span class="alerte">'+aEnt(c.fins)+' trait(s) de largeur nulle, ignorés</span>':""}`;
}

ANT_LIER.cuivre=function(box){
  box.querySelector("#bPrendre").onclick=function(){
    const prise=antPriseDeLaSelection();
    if(!prise.nets.size&&!prise.formes.length){
      typeof wsHint==="function"&&wsHint("Rien n'est désigné sur la carte : cliquez le cuivre de l'antenne.");
      return;
    }
    for(const i of prise.nets)ANT.nets.add(i);
    const n=antAjouterFormes(prise.formes);
    /* Une forme prise sur une couche décochée n'entre pas dans le modèle : la
       règle vaut pour elle comme pour un net, et sans un mot ici le jeton
       apparaîtrait sans que le compte bouge d'un polygone. */
    if(n&&typeof wsHint==="function"){
      const hors=prise.formes.filter(f=>f.c>=0&&!ANT.couches.has(f.c)).length;
      if(hors)wsHint(hors+" morceau(x) sur une couche non cochée : cochez-la plus bas pour qu'ils entrent dans le modèle.");
    }
    antMaj(true);
  };
  box.querySelector("#bViderNets").onclick=function(){
    ANT.nets.clear(); ANT.formes=[]; antMaj(true);
  };
  box.querySelectorAll("[data-retirer]").forEach(function(b){
    b.onclick=function(){ ANT.nets.delete(+b.dataset.retirer); antMaj(true); };
  });
  box.querySelectorAll("[data-retirerf]").forEach(function(b){
    b.onclick=function(){ ANT.formes.splice(+b.dataset.retirerf,1); antMaj(true); };
  });
  box.querySelector("#antMasse").onchange=function(){
    ANT.netMasse=+this.value; antMaj(true);
  };
  box.querySelectorAll("[data-cch]").forEach(function(b){
    b.onchange=function(){
      const i=+b.dataset.cch;
      if(b.checked)ANT.couches.add(i); else ANT.couches.delete(i);
      antMaj(true);
    };
  });
  box.querySelector("#antVias").onchange=function(){
    ANT.avecVias=this.checked; antMaj(true);
  };
  box.querySelector("#antPads").onchange=function(){
    ANT.avecPastilles=this.checked; antMaj(true);
  };
};

/* ==========================================================================
   Étape 2 — l'empilage
   --------------------------------------------------------------------------
   UN EMPILAGE INCOMPLET EST LE CAS ORDINAIRE, PAS L'EXCEPTION. Beaucoup de
   fichiers IPC-2581 ne listent que les conducteurs, sans épaisseur de
   diélectrique ni permittivité : ce sont des informations de fabrication, et
   l'outil de CAO ne les exporte pas toujours. Une permittivité fausse de dix
   pour cent déplace la résonance d'environ cinq pour cent — assez pour que
   l'antenne soit hors bande et qu'on ne sache pas pourquoi. D'où cette étape,
   et d'où les mentions « fichier » / « saisi » à côté de chaque valeur.
   ========================================================================== */
ANT_CORPS.empilage=function(){
  /* Le modèle normalisé, quand il y en a un : c'est lui qui porte les écarts
     mesurés des deux modèles de pertes. Il peut être nul — le document n'a
     pas encore été accepté —, d'où les gardes partout où on le lit. */
  const m=ANT.modele;
  const src=function(s){
    return '<em class="src '+(s||"suppose")+'">'+
      (s==="saisi"?"saisi":s==="fichier"?"fichier":"supposé")+'</em>';
  };
  const cu=LT.cu.map(function(e){
    return `<tr class="cu">
      <td class="nom">${aEsc(e.nom)}</td>
      <td>conducteur</td>
      <td><input type="text" inputmode="decimal" spellcheck="false" data-lt="cu" data-cle="${aEsc(e.nom)}"
                 value="${mdlNb(e.ep)}"> ${antUnite()}</td>
      <td>${src(e.epSrc)}</td>
      <td><select data-lt-role="${aEsc(e.nom)}">
            <option value="signal"${e.role==="signal"?" selected":""}>signal</option>
            <option value="gnd"${e.role==="gnd"?" selected":""}>masse</option>
            <option value="pwr"${e.role==="pwr"?" selected":""}>alimentation</option>
          </select></td></tr>`;
  }).join("");

  const gap=LT.gap.map(function(g){
    return `<tr class="gap${g.t>0?"":" manque"}">
      <td class="nom">${aEsc(g.cle)}</td>
      <td>diélectrique</td>
      <td><input type="text" inputmode="decimal" spellcheck="false" data-lt="gap_t" data-cle="${aEsc(g.cle)}"
                 value="${g.t?mdlNb(g.t):""}" placeholder="épaisseur"> ${antUnite()}</td>
      <td>${src(g.tSrc)}</td>
      <td><input type="text" inputmode="decimal" spellcheck="false" data-lt="gap_er" data-cle="${aEsc(g.cle)}"
                 value="${g.er?mdlNb(g.er):""}" placeholder="εr" class="petit"> ${src(g.erSrc)}</td>
    </tr>`;
  }).join("");

  /* LES REVÊTEMENTS EXTÉRIEURS, QUE CE PANNEAU NE MONTRAIT PAS. Le tableau
     ci-dessus n'a que deux sortes de lignes : les conducteurs, et le
     diélectrique ENTRE deux conducteurs. Un vernis épargne n'est ni l'un ni
     l'autre — il est posé SUR le cuivre extérieur, hors de tout intervalle —,
     si bien qu'il partait au solveur sans jamais s'afficher. Ses 15 µm font
     une cellule quarante fois plus fine que le pas visé, donc un pas de temps
     huit fois plus court : 21 h au lieu de 2 h 30 sur une carte d'essai qui
     reprend l'empilage d'antenna4c. La couche la plus coûteuse du modèle était
     la seule qu'on ne voyait pas. */
  const rev=antRevetements().map(function(r){
    return `<tr class="rev${r.garde?"":" hors"}">
      <td class="nom">${aEsc(r.nom)}</td>
      <td>revêtement${r.garde?"":" — hors modèle"}</td>
      <td>${mdlNb(r.ep)} ${antUnite()}</td>
      <td>${r.choisi?src("saisi"):src("fichier")}</td>
      <td><label class="ck"><input type="checkbox" data-ant-rev="${aEsc(r.nom)}"${r.garde?" checked":""}>
        dans le maillage</label></td></tr>`;
  }).join("");

  return `
<p class="intro">Ce que le fichier déclare est repris tel quel ; ce qu'il ne
   déclare pas se saisit ici. Une permittivité fausse de 10 % déplace la
   résonance d'environ 5 % — assez pour sortir de la bande sans qu'on sache
   pourquoi.</p>

<table class="empilage">
  <thead><tr><th>Couche</th><th>Nature</th><th>Épaisseur</th><th></th>
             <th>Rôle / εr</th></tr></thead>
  <tbody>${cu}${gap}${rev}</tbody>
</table>
<button class="tb mini" id="ltRaz">Oublier mes saisies</button>
${rev?`<p class="note">Les <b>revêtements extérieurs</b> — vernis épargne,
   coverlay, radôme collé — sont posés sur le cuivre extérieur, pas entre deux
   cuivres : ils ne portent aucun champ de ligne. En dessous de 50 µm ils
   restent <b>hors du maillage</b>, et ce n'est pas une économie de cellules :
   les deux faces d'une couche portent chacune une ligne de maillage qu'on ne
   peut pas déplacer, et 15 µm entre deux lignes font une cellule quarante fois
   plus fine que le pas visé. C'est elle, et elle seule, qui commande le pas de
   temps de <b>toute</b> la simulation. Cochez la case si la couche compte
   vraiment — un coverlay de flex, un radôme mince — en sachant ce qu'elle
   coûte.</p>`:""}

<div class="champ">
  <label>Les pertes du diélectrique</label>
  <label class="rd"><input type="radio" name="antPertes" value="kappa"${ANT.pertes.mode==="kappa"?" checked":""}>
    <b>Conductivité équivalente</b> <small>&kappa; = 2&pi;f&middot;&epsilon;₀&middot;&epsilon;ᵣ&middot;tan&delta;, la seule forme
    qu'openEMS accepte directement — et elle n'est juste qu'à <b>une seule
    fréquence</b>. Ailleurs tan&delta; varie comme 1/f, alors qu'un stratifié réel
    le garde à peu près constant.${m?" À la bande actuelle, l'écart aux bords atteint <b>"+aNb(m.pertes.ecart_kappa_pc,0)+" %</b>.":""}</small></label>
  <label class="rd"><input type="radio" name="antPertes" value="debye"${ANT.pertes.mode==="debye"?" checked":""}>
    <b>Pôles de Debye</b> <small>une somme de relaxations qui tient tan&delta; plat sur
    toute la bande. Les liaisons Python d'openEMS n'exposent pas ce matériau :
    le script écrit le XML de CSXCAD et le relit, ce qui est écrit et commenté
    dans le script lui-même.${m&&m.pertes.actif?" Ici : <b>"+m.dielectriques.filter(d=>d.debye).map(d=>d.debye.poles.length).join("/")+" pôles</b>, tan&delta; tenu à <b>"+aNb(m.pertes.ecart_debye_pc,2)+" %</b> près.":""}</small></label>
  ${ANT.pertes.mode==="kappa"?`<div class="ligne">
    <span><label>Fréquence de référence <small>0 = centre de la bande</small></label>
      <input type="text" inputmode="decimal" spellcheck="false" id="antFk" value="${mdlNb(ANT.pertes.f_kappa?ANT.pertes.f_kappa/antKf():0)}"> ${ANT.uniteF}</span>
  </div>`:""}
</div>

<div class="champ">
  <label>Comment le cuivre est modélisé</label>
  <label class="rd"><input type="radio" name="antCu" value="feuille"${ANT.modeleCuivre==="feuille"?" checked":""}>
    <b>Feuille conductrice</b> <small>sans épaisseur géométrique, mais avec la
    résistance du cuivre réel. À 2,4 GHz l'épaisseur de peau fait 1,3 µm : le
    courant ne voit pas les 35 µm de la couche, seulement sa résistance.
    C'est le bon choix presque toujours.</small></label>
  <label class="rd"><input type="radio" name="antCu" value="pec"${ANT.modeleCuivre==="pec"?" checked":""}>
    <b>Conducteur parfait</b> <small>aucune perte. Le plus rapide, pour
    dégrossir une géométrie — mais le rendement en ressort surestimé.</small></label>
  <label class="rd"><input type="radio" name="antCu" value="volume"${ANT.modeleCuivre==="volume"?" checked":""}>
    <b>Volume</b> <small>l'épaisseur entre dans le maillage et commande le pas
    de temps : la simulation devient des dizaines de fois plus longue. À ne
    garder que si la géométrie de la tranche compte vraiment.</small></label>
</div>`;
};

ANT_LIER.empilage=function(box){
  box.querySelectorAll("input[data-lt]").forEach(function(inp){
    inp.onchange=function(){
      const t=V.sur[inp.dataset.lt]||(V.sur[inp.dataset.lt]={});
      const v=parseFloat(String(inp.value).replace(",","."));
      if(isFinite(v)&&v>0){
        t[inp.dataset.cle]=v;
        inp.value=mdlNb(v);
      }else{
        delete t[inp.dataset.cle];
      }
      ltPreparer(); antMaj(true);
    };
  });
  box.querySelectorAll("select[data-lt-role]").forEach(function(s){
    s.onchange=function(){
      V.sur.role[s.dataset.ltRole]=s.value;
      ltPreparer(); antMaj(true);
    };
  });
  box.querySelectorAll("input[data-ant-rev]").forEach(function(c){
    c.onchange=function(){
      ANT.revetements[c.dataset.antRev]=c.checked;
      /* LA LIGNE SE CORRIGE ICI, ET NON PAR UN RE-RENDU. `antAssistantRendre`
         refuse de reconstruire l'étape tant que le focus est dans un champ —
         et la case qu'on vient de cocher EST un champ. On retouche donc les
         deux endroits qui parlent, et le reste attend la réponse du serveur
         comme tout le bilan. */
      const tr=c.closest("tr");
      if(tr){
        tr.classList.toggle("hors",!c.checked);
        const td=tr.children[1];
        if(td)td.textContent="revêtement"+(c.checked?"":" — hors modèle");
      }
      antMaj(true);
    };
  });
  const raz=box.querySelector("#ltRaz");
  if(raz)raz.onclick=function(){
    V.sur={cu:{},gap_t:{},gap_er:{},role:{}};
    ANT.revetements={};
    ltPreparer(); antMaj(true);
  };
  box.querySelectorAll('input[name="antCu"]').forEach(function(r){
    r.onchange=function(){ ANT.modeleCuivre=r.value; antMaj(true); };
  });
  box.querySelectorAll('input[name="antPertes"]').forEach(function(r){
    r.onchange=function(){ ANT.pertes.mode=r.value; antAssistantRendre(true); };
  });
  const fk=box.querySelector("#antFk");
  if(fk)antLierNombre(fk, ANT.pertes, "f_kappa", {facteur: antKf(), min:0});
};

/* L'ÉTAPE 3 — « Autour » — N'EST PAS DANS CE FICHIER, et le saut de numéro
   est le seul endroit où cela se voit. Elle s'enregistre elle-même dans
   `ANT_CORPS` / `ANT_LIER` depuis 17-objets.js, qui est chargé après celui-ci :
   l'assistant n'a rien à savoir de ce qu'elle contient, et c'est ainsi qu'une
   étape s'ajoute sans toucher au squelette. */

/* ==========================================================================
   Étape 4 — la bande
   ========================================================================== */
ANT_CORPS.bande=function(){
  const k=antKf();
  const u=Object.keys(ANT_UNITES_F).map(n=>
    '<option'+(n===ANT.uniteF?" selected":"")+'>'+n+'</option>').join("");
  const m=ANT.modele;
  return `
<p class="intro">La bande commande TOUT le reste : la longueur d'onde la plus
   basse donne la marge d'air, la plus haute donne le pas de maillage. Une
   bande deux fois plus large, c'est huit fois plus de cellules.</p>

<div class="champ ligne">
  <span><label>Début</label>
    <input type="text" inputmode="decimal" spellcheck="false" id="antF1" value="${mdlNb(ANT.bande.f1/k)}"></span>
  <span><label>Fin</label>
    <input type="text" inputmode="decimal" spellcheck="false" id="antF2" value="${mdlNb(ANT.bande.f2/k)}"></span>
  <span><label>Unité</label><select id="antUF">${u}</select></span>
</div>

<div class="champ ligne">
  <span><label>Fréquence visée <small>celle où l'on veut l'adaptation</small></label>
    <input type="text" inputmode="decimal" spellcheck="false" id="antFc" value="${mdlNb(ANT.bande.fcible/k)}"></span>
  <span><label>Points de calcul</label>
    <input type="text" inputmode="numeric" spellcheck="false" id="antN" value="${ANT.bande.n}"></span>
</div>

<div class="champ">
  <label>Raccourcis</label>
  <div class="raccourcis">
    <button class="tb mini" data-bande="0.868e9">868 MHz</button>
    <button class="tb mini" data-bande="0.915e9">915 MHz</button>
    <button class="tb mini" data-bande="2.45e9">2,45 GHz</button>
    <button class="tb mini" data-bande="5.8e9">5,8 GHz</button>
    <button class="tb mini" data-bande="1.5754e9">GNSS L1</button>
  </div>
  <p class="note">Ils posent une bande de ±10 % autour de la fréquence : assez
     large pour voir la résonance se déplacer, assez étroite pour que le
     maillage reste raisonnable.</p>
</div>

<div class="recap" id="antBandeRecap">
  ${antBandeRecapHtml(m)}
</div>`;
};

function antBandeRecapHtml(m){
  if(!m)return "";
  return `<span>impulsion f₀ = ${aF(m.bande.f0)}, f<sub>c</sub> = ${aF(m.bande.fc)}</span>
  <span>λ à ${aF(m.bande.f1)} : ${aNb(m.resolution.lambda_max_mm,1)} mm</span>
  <span>λ à ${aF(m.bande.f2)} : ${aNb(m.resolution.lambda_min_mm,1)} mm</span>`;
}

ANT_LIER.bande=function(box){
  antLierNombre(box.querySelector("#antF1"), ANT.bande, "f1", {facteur: antKf(), min:0});
  antLierNombre(box.querySelector("#antF2"), ANT.bande, "f2", {facteur: antKf(), min:0});
  antLierNombre(box.querySelector("#antFc"), ANT.bande, "fcible", {facteur: antKf(), min:0});
  antLierNombre(box.querySelector("#antN"), ANT.bande, "n", {min:21, max:4001, defaut:1001, entier:true});
  box.querySelector("#antUF").onchange=function(){
    /* On change l'unité, pas la fréquence : 2,45 GHz reste 2,45 GHz quand on
       passe en MHz, il s'affiche 2450. L'inverse — garder le nombre et
       changer l'unité — est exactement la faute que cette liste existe pour
       empêcher. */
    ANT.uniteF=this.value; antAssistantRendre(true);
  };
  box.querySelectorAll("[data-bande]").forEach(function(b){
    b.onclick=function(){
      const f=parseFloat(b.dataset.bande);
      ANT.bande.fcible=f; ANT.bande.f1=f*0.9; ANT.bande.f2=f*1.1;
      const k=antKf();
      const f1=box.querySelector("#antF1"), f2=box.querySelector("#antF2"), fc=box.querySelector("#antFc");
      if(f1)f1.value=mdlNb(ANT.bande.f1/k);
      if(f2)f2.value=mdlNb(ANT.bande.f2/k);
      if(fc)fc.value=mdlNb(ANT.bande.fcible/k);
      antMaj(true);
    };
  });
};

/* ==========================================================================
   Étape 5 — le port
   ========================================================================== */
ANT_CORPS.port=function(){
  const cuivres=LT.cu.map(function(e){ return {nom:e.nom}; });
  const opt=function(sel){
    return '<option value="">— choisir —</option>'+cuivres.map(c=>
      '<option value="'+aEsc(c.nom)+'"'+(c.nom===sel?" selected":"")+'>'+
      aEsc(c.nom)+'</option>').join("");
  };
  const p=ANT.port;
  const coax=(p.type==="coaxial");
  const z0=antCoaxZ0(p);
  const ecart=p.R>0?100*Math.abs(z0-p.R)/p.R:0;

  /* LES ONGLETS DE PORTS. Un seul port : pas de liste — il n'y a rien à
     choisir, et un onglet unique laisserait croire le contraire. Deux : la
     liste apparaît, et avec elle la question qui n'existait pas avant —
     lequel excite.

     LE BOUTON « + PORT », LUI, RESTE. La condition disait d'abord
     `length>1 || length<8`, qui est vraie pour tout nombre de ports entre un
     et huit : la barre s'affichait toujours, à l'exact inverse de ce que ce
     commentaire annonçait. La corriger en `length>1` aurait enterré le seul
     chemin qui mène au second port — on n'aurait plus jamais eu de S₂₁. Les
     deux morceaux se règlent donc séparément : c'est la LISTE qui naît au
     second port, pas la barre. */
  const pluriel=ANT.ports.length>1;
  const onglets=`
<div class="ports-barre${pluriel?"":" seule"}">
  ${pluriel?ANT.ports.map(function(q,i){
    return '<button class="jeton'+(i===ANT.portActif?" on":"")+
      (q.excite?" excite":"")+'" data-port="'+i+'" title="'+
      (q.excite?"Ce port excite : c\'est lui qui donne le S₁₁"
               :"Ce port est en charge : il mesure, il n\'émet pas")+'">'+
      (q.excite?"⚡ ":"")+'port '+(i+1)+
      (q.type==="coaxial"?" ⌾":"")+
      ' <b data-retirer="'+i+'">✕</b></button>';
  }).join(""):""}
  ${ANT.ports.length<8?'<button class="jeton plus" id="bPortPlus" title="Un second port donne le S₂₁ : le couplage entre deux antennes, qui ne se déduit d\'aucun S₁₁">+ port</button>':""}
</div>`;

  return `
<p class="intro">Le port est l'endroit où l'onde entre, et c'est lui qui donne
   le S<sub>11</sub>. S'il est mal posé, tout le reste du calcul est juste et
   le résultat faux — c'est la panne la plus courante, et la moins visible.</p>

${onglets}
${ANT.ports.length>1?`<div class="champ">
  <label class="ck"><input type="checkbox" id="antPexc"${p.excite?" checked":""}>
    Ce port excite
    <small>Un seul à la fois, et ce n'est pas un réglage mais une définition :
    S(j,i) vaut « ce qui sort de j quand SEUL i excite ». Les autres sont
    fermés sur leur impédance — ils mesurent, ils n'émettent pas. Une
    simulation rend donc UNE colonne du tableau S ; l'autre demande une
    seconde simulation, l'excitation déplacée.</small></label>
</div>`:""}

<div class="champ ligne">
  <span><label>Genre</label>
    <select id="antPtype">
      <option value="localise"${coax?"":" selected"}>localisé — une résistance entre deux couches</option>
      <option value="coaxial"${coax?" selected":""}>coaxial — un connecteur, âme et gaine</option>
    </select></span>
</div>

<div class="champ">
  <button class="tb ${ANT.posePort?"on":""}" id="bPosePort">
    ${ANT.posePort?"◉ Cliquez le point d'alimentation sur la carte…":"⌖ Poser le port sur la carte"}
  </button>
  <p class="note">Cliquer vaut mieux que saisir : l'assistant prend alors la
     largeur de la piste sous le curseur, et vérifie que le point est bien sur
     le cuivre retenu.</p>
</div>

<div class="champ ligne">
  <span><label>X</label><input type="text" inputmode="decimal" spellcheck="false" id="antPx" value="${mdlNb(p.x)}"></span>
  <span><label>Y</label><input type="text" inputmode="decimal" spellcheck="false" id="antPy" value="${mdlNb(p.y)}"></span>
  <span class="unite">${antUnite()}</span>
</div>

<div class="champ ligne">
  <span><label>${coax?"Âme sur la couche":"De la couche"}</label><select id="antPde">${opt(p.de)}</select></span>
  <span><label>${coax?"gaine sur":"vers"}</label><select id="antPa">${opt(p.a)}</select></span>
</div>
<p class="note">${coax
  ? `L'âme traverse la carte et vient toucher la première couche ; la gaine
     s'arrête sur la seconde, qui est le plan de masse. Le connecteur sort
     du côté de la masse — c'est là qu'on le visse.`
  : `Un port localisé excite une <b>différence</b> de potentiel : il lui faut
     deux conducteurs distincts. Pour une antenne imprimée, c'est presque
     toujours « couche de l'antenne » → « plan de masse ».`}</p>

${coax?`
<div class="champ ligne">
  <span><label>Rayon de l'âme</label><input type="text" inputmode="decimal" spellcheck="false" id="antPra" value="${mdlNb(p.ra)}"></span>
  <span><label>Rayon de la gaine</label><input type="text" inputmode="decimal" spellcheck="false" id="antPrb" value="${mdlNb(p.rb)}"></span>
  <span class="unite">${antUnite()}</span>
</div>
<div class="champ ligne">
  <span><label>ε<sub>r</sub> de l'isolant</label><input type="text" inputmode="decimal" spellcheck="false" id="antPer" value="${mdlNb(p.er)}"></span>
  <span><label>Épaisseur de gaine</label><input type="text" inputmode="decimal" spellcheck="false" id="antPepg" value="${mdlNb(p.ep_gaine)}"></span>
  <span><label>Longueur du tronçon</label><input type="text" inputmode="decimal" spellcheck="false" id="antPlong" value="${mdlNb(p.longueur)}"></span>
</div>
<div class="recap${ecart>5?" ko":""}">
  <span>Z₀ = 60/√ε<sub>r</sub> · ln(b/a) = <b>${aNb(z0,1)} Ω</b></span>
  <span>port déclaré à <b>${aNb(p.R,0)} Ω</b>${ecart>5?" — "+aNb(ecart,0)+" % d'écart":""}</span>
</div>
<p class="note${ecart>5?" alerte":""}">${ecart>5
  ? `Un coaxial n'est à 50 Ω que par le <b>rapport</b> de ses deux rayons.
     Cet écart-là n'est pas une erreur de calcul : c'est une désadaptation
     réelle, et elle se lira dans le S₁₁ comme si elle venait de l'antenne.`
  : `Le plan de référence des paramètres S est ramené à la <b>surface de la
     carte</b> : la longueur du tronçon ne tourne pas la phase du résultat.
     L'âme, la gaine et le dégagement percé dans les plans traversés, eux,
     comptent — c'est tout l'intérêt de modéliser le connecteur.`}</p>`
:`
<div class="champ ligne">
  <span><label>Orientation</label>
    <select id="antPdir">
      <option value="z"${p.dir==="z"?" selected":""}>z — verticale (sonde, via d'alimentation)</option>
      <option value="x"${p.dir==="x"?" selected":""}>x — horizontale</option>
      <option value="y"${p.dir==="y"?" selected":""}>y — horizontale</option>
    </select></span>
</div>

<div class="champ ligne">
  <span><label>Largeur</label><input type="text" inputmode="decimal" spellcheck="false" id="antPw" value="${mdlNb(p.w)}"></span>
  <span><label>Longueur</label><input type="text" inputmode="decimal" spellcheck="false" id="antPl" value="${mdlNb(p.l)}"></span>
</div>
<p class="note">Ces deux cotes disent <b>où</b> est le port, pas ce qui excite :
   la source envoyée au solveur est la <b>ligne</b> qui joint les deux couches
   au point marqué. Un port étalé en surface fait compter, dans son courant, le
   courant de déplacement du diélectrique qu'il couvre — et l'impédance
   d'entrée n'est alors plus celle de l'antenne.</p>

<div class="champ">
  <label>La ligne d'alimentation, jusqu'au pied de l'antenne
    <small>L'impédance est lue <b>là où le port est posé</b> : au bord de la
    carte quand l'antenne est alimentée par un ruban. Entre les deux il y a un
    bout de ligne, et une ligne <b>fait tourner</b> l'impédance. La déclarer
    ici la ramène au pied de l'antenne — le seul endroit où elle dise quoi
    corriger <i>sur l'antenne</i>. Zéro : rien n'est ramené.</small>
  </label>
</div>
<div class="champ ligne">
  <span><label>Longueur de ruban</label><input type="text" inputmode="decimal" spellcheck="false"
    id="antPlgd" value="${mdlNb(p.ligne_d||0)}"></span>
  <span><label>Largeur du ruban</label><input type="text" inputmode="decimal" spellcheck="false"
    id="antPlgw" value="${mdlNb(p.ligne_w||0)}"></span>
  <span class="unite">${antUnite()}</span>
</div>
${(p.ligne_d>0&&p.ligne_w>0)?(function(){
  const s=(typeof conSubstrat==="function"&&CON&&CON.actif)?conSubstrat():null;
  const q=(ANT.modele&&ANT.modele.ports&&ANT.modele.ports[ANT.portActif]);
  const lg=q&&q.ligne;
  return `<div class="recap">
  ${lg?'<span>Z₀ du ruban = <b>'+aNb(lg.z0,1)+' Ω</b></span>'+
       '<span>ε<sub>r</sub> effectif = <b>'+aNb(lg.eeff,3)+'</b></span>'+
       '<span>sur <b>'+antLongModele(lg.h)+'</b> de ε<sub>r</sub> = '+aNb(lg.er,2)+'</span>'
      :'<span>le serveur calculera Z₀ et l’ε<sub>r</sub> effectif du ruban</span>'}
</div>
<p class="note"><b>Cela n'améliore aucune adaptation, et ne le prétend pas.</b>
   Une ligne sans perte dont le Z₀ est celui de référence ne change pas |Γ| :
   elle le fait <b>tourner</b>. Mesuré sur le patch du gabarit, la ligne
   <b>doublée</b> : le S₁₁ passe de −0,64 à −1,20 dB — un demi-décibel, soit ce
   que 6,4 mm de FR-4 dissipent, et rien de plus. Deux réserves&nbsp;: le Z₀ et
   l'ε<sub>r</sub> effectif sont <b>analytiques</b> (Hammerstad), pas ceux de la
   ligne telle qu'elle est maillée ; et la rotation est <b>sans perte</b>, si
   bien que près du bord de l'abaque — une antenne mal adaptée — elle amplifie
   toute erreur sur ces deux nombres.</p>`;})():""}`}

<div class="champ ligne">
  <span><label>Impédance de référence</label><input type="text" inputmode="numeric" spellcheck="false" id="antPR" value="${p.R}"> Ω</span>
</div>

<div id="antPortRecap">
  ${antPortRecapHtml()}
</div>`;
};

function antPortRecapHtml(){
  if(!ANT.modele||!ANT.modele.ports||!ANT.modele.ports[ANT.portActif])return "";
  const q=ANT.modele.ports[ANT.portActif];
  return `<div class="recap">
  <span>${(q.x2-q.x1<1e-9&&q.y2-q.y1<1e-9)
      ? "source : une ligne de "+aL(q.z2-q.z1)
      : "volume du port : "+aL(q.x2-q.x1)+" × "+aL(q.y2-q.y1)+" × "+
        aL(q.z2-q.z1)}</span>
  <span>entre <b>${aEsc(q.de)}</b> et <b>${aEsc(q.a)}</b></span>
  ${q.coax?'<span>dégagement de '+aL(q.coax.rb)+' dans <b>'+
     (q.coax.degagements.map(d=>aEsc(d.couche)).join(", ")||"aucune couche")+
     '</b></span>':""}
</div>`;
}

ANT_LIER.port=function(box){
  box.querySelectorAll("[data-port]").forEach(function(el){
    el.onclick=function(e){
      /* La croix est DANS le bouton : sans ce test, retirer un port
         sélectionnerait d'abord celui qu'on est en train de retirer. */
      const r=e.target&&e.target.getAttribute("data-retirer");
      if(r!=null){
        e.stopPropagation();
        if(antPortRetirer(+r))antMaj(true);
        return;
      }
      ANT.portActif=+el.getAttribute("data-port");
      antAssistantRendre(true);
    };
  });
  const plus=box.querySelector("#bPortPlus");
  if(plus)plus.onclick=function(){ if(antPortAjouter())antMaj(true); };

  const exc=box.querySelector("#antPexc");
  if(exc)exc.onchange=function(){
    /* Décocher n'a pas de sens : il faut bien que quelqu'un excite. Cocher
       déplace l'excitation ici, et l'enlève partout ailleurs. */
    antPortExciter(ANT.portActif);
    antMaj(true);
  };

  box.querySelector("#bPosePort").onclick=function(){
    ANT.posePort=!ANT.posePort;
    antAssistantRendre(true);
    document.body.classList.toggle("pose-port",!!ANT.posePort);
  };
  const n=function(id,cle,min){
    antLierNombre(box.querySelector(id), ANT.port, cle, {
      min: min!=null?min:-Infinity,
      apres: ()=>{ ANT.port.pose=true; }
    });
  };
  n("#antPx","x"); n("#antPy","y"); n("#antPw","w",0.001);
  n("#antPl","l",0.001); n("#antPR","R",1);
  n("#antPra","ra",0.001); n("#antPrb","rb",0.001); n("#antPer","er",1);
  n("#antPepg","ep_gaine",0.001); n("#antPlong","longueur",0.01);
  antLierNombre(box.querySelector("#antPlgd"), ANT.port, "ligne_d", {min:0});
  antLierNombre(box.querySelector("#antPlgw"), ANT.port, "ligne_w", {min:0});
  const s=function(id,cle){
    const el=box.querySelector(id);
    if(el)el.onchange=function(){ ANT.port[cle]=this.value; antMaj(true); };
  };
  s("#antPde","de"); s("#antPa","a"); s("#antPdir","dir");
  const t=box.querySelector("#antPtype");
  if(t)t.onchange=function(){
    ANT.port.type=this.value;
    /* Un coaxial est toujours vertical : sa source est radiale, et son axe
       est celui du perçage. Laisser « x » affiché sur un port coaxial ferait
       croire à un choix qui n'existe pas. */
    if(this.value==="coaxial")ANT.port.dir="z";
    antMaj(true);
  };
};

/* ==========================================================================
   Étape 6 — la boîte
   ========================================================================== */
ANT_CORPS.boite=function(){
  const m=ANT.modele;
  const b=ANT.boite;
  /* Les marges sont en millimètres dans le modèle, en unité du fichier dans
     la saisie : sur une carte en pouces, saisir une marge en millimètres à
     côté de coordonnées en pouces serait une invitation à se tromper. */
  const k=(V.unite==="in")?(1/25.4):1;
  return `
<p class="intro">La marge se compte en <b>deux morceaux</b> : l'air physique
   entre l'antenne et le début de la couche absorbante — un quart de la
   longueur d'onde la plus basse —, <b>plus</b> l'épaisseur de la PML
   elle-même, qui occupe les dernières cellules de la boîte. Ce qui se trouve
   dans la PML n'est pas simulé, il est mangé : une marge de λ/4 tout court
   pose donc l'absorbeur sur l'antenne.</p>

<div class="champ">
  <label>Marge d'air <small>0 = laisser l'assistant décider</small>${antAutoEtq("antMargeEtq")}</label>
  <div class="ligne">
    <span><label>X</label><input type="text" inputmode="decimal" spellcheck="false" id="antMx" value="${mdlNb(b.mx)}"></span>
    <span><label>Y</label><input type="text" inputmode="decimal" spellcheck="false" id="antMy" value="${mdlNb(b.my)}"></span>
    <span><label>Z haut</label><input type="text" inputmode="decimal" spellcheck="false" id="antMzh" value="${mdlNb(b.mz_haut)}"></span>
    <span><label>Z bas</label><input type="text" inputmode="decimal" spellcheck="false" id="antMzb" value="${mdlNb(b.mz_bas)}"></span>
    <span class="unite">${antUnite()}</span>
  </div>
  <div id="antBoiteConseil">
    ${antBoiteConseilHtml(m,k)}
  </div>
</div>

<div class="champ ligne">
  <span><label>Couches de PML</label>
    <input type="text" inputmode="numeric" spellcheck="false" id="antPml" value="${b.pml}"></span>
  <span class="note-inline">8 est le réglage d'usine d'openEMS et celui de tous
    ses exemples d'antenne. Davantage ne se justifie que pour une structure
    très résonante.</span>
</div>

<div class="champ">
  <label>Maillage <small>0 = calculé</small></label>
  <div class="ligne">
    <span><label>Pas dans l'air${antAutoEtq("antRaEtq")}</label>
      <input type="text" inputmode="decimal" spellcheck="false" id="antRa" value="${mdlNb(ANT.maillage.res_air)}"></span>
    <span><label>dans le diélectrique${antAutoEtq("antRdEtq")}</label>
      <input type="text" inputmode="decimal" spellcheck="false" id="antRd" value="${mdlNb(ANT.maillage.res_die)}"></span>
    <span class="unite">${antUnite()}</span>
  </div>
  <div id="antMaillageNote">${antMaillageNoteHtml(m,k)}</div>
  <label class="ck"><input type="checkbox" id="antTiers"${ANT.maillage.tiers?" checked":""}>
    Règle du tiers aux arêtes de cuivre
    <small>la ligne ne se pose pas SUR l'arête mais à un tiers dehors, deux
    tiers dedans : c'est ce qui rend la densité de courant de bord correcte
    sans raffiner partout.</small></label>
</div>

<div class="recap" id="antBoiteRecap">
  ${antBoiteRecapHtml(m,k)}
</div>`;
};

function antBoiteConseilHtml(m,k){
  if(!m)return "";
  const conseil=m.boite.marge_conseil;
  if(!conseil)return "";
  return `<p class="note">Conseil de l'assistant à cette bande :
     <b>${aNb(conseil*k,2)} ${antUnite()}</b> de tous les côtés —
     ${aNb(m.boite.air_utile*k,2)} d'air (λ/4 à ${aF(m.bande.f1)})
     + ${aNb(m.boite.ep_pml*k,2)} de PML (${m.boite.pml} cellules).
     ${(ANT.boite.mx||ANT.boite.my||ANT.boite.mz_haut||ANT.boite.mz_bas)?
       "":"<b>C'est ce que les champs ci-dessus appliquent.</b>"}</p>
   <p class="note ${m.boite.marge_suffisante?"":"alerte"}">Avec les marges
     actuelles, il reste <b>${aNb(m.boite.air_restant*k,2)} ${antUnite()}</b>
     d'air réel entre l'antenne et l'absorbeur.</p>`;
}

/* CE QUI A DÉCIDÉ DU PAS, ET NON SEULEMENT SA VALEUR. Trois règles se
   disputent le pas dans le diélectrique — λ/20, la largeur du cuivre le plus
   étroit, et le plafond de lignes qui empêche une pastille de 0,2 mm de
   mailler la carte entière. Laquelle a gagné ne se devine pas dans le
   nombre, et c'est pourtant elle qu'il faut connaître pour savoir si l'on
   peut relâcher : un pas tenu par λ/20 se relâche en resserrant la bande, un
   pas tenu par le cuivre ne se relâche qu'en acceptant de moins bien le
   résoudre. */
function antMaillageNoteHtml(m,k){
  if(!m)return "";
  const d=m.resolution.detail||{};
  const u=antUnite();
  const lam=d.lambda, w=d.largeur_cuivre, pl=d.plancher, die=d.die;
  const L=[];
  if(lam)L.push("λ/20 dans le substrat : "+aNb(lam*k,3)+" "+u);
  if(w)L.push("cuivre le plus étroit : "+aNb(w*k,3)+" ÷ 4 = "+aNb(w*k/4,3));
  if(pl)L.push("plafond de 200 lignes : "+aNb(pl*k,3));
  let quoi="λ/20";
  if(d.bornee)quoi="le plafond de lignes — le cuivre en demanderait plus";
  else if(w&&die!=null&&Math.abs(die-w/4)<1e-9)quoi="la largeur du cuivre";
  const impose=d.saisi||d.saisi_air;

  /* LE FOND N'EST PLUS TOUT LE MAILLAGE, et l'afficher seul serait mentir par
     omission. Quand le plafond de lignes empêche de mailler la carte entière
     assez fin, le pas fin est posé EN TRAVERS du cuivre étroit, sur le seul
     axe où il est étroit — quelques dizaines de lignes au lieu de mille. Ce
     qu'il faut lire ici, c'est donc deux nombres et un prix. */
  const md=m.maillage_detail||{};
  const pistes=d.pistes||{};
  let bandes="";
  if(d.fin>0){
    const prix=(d.cout&&d.cout_fond)?(d.cout/d.cout_fond):1;
    const nb=[], tot=(md.bandes_x||0)+(md.bandes_y||0);
    if(md.bandes_x)nb.push(md.bandes_x+" en x");
    if(md.bandes_y)nb.push(md.bandes_y+" en y");
    const axes=[];
    if(md.bandes_x)axes.push("x");
    if(md.bandes_y)axes.push("y");
    const ou=(tot===1)?("<b>une bande</b>, en "+axes.join(""))
                      :("<b>"+tot+" bandes</b> — "+nb.join(", "));
    bandes=`<br>Et <b>${aNb(d.fin*k,3)} ${u}</b> dans ${ou} —
      posée${tot>1?"s":""} en travers du cuivre trop fin
      pour ce fond : le champ tourne sur la largeur d'un ruban, pas sur sa
      longueur. Le plus mal résolu des polygones y a
      <b>${aNb(pistes.cellules||0,1)} cellules</b> en travers, et cela coûte
      <b>${aNb(prix,2)} fois</b> le maillage de fond.` +
      (d.fin_borne?` Le budget a arrêté l'affinage là : il faudrait
      ${aNb((d.fin_voulu||0)*k,3)} ${u} pour quatre cellules en travers du
      cuivre le plus étroit.`:"");
  }else if(d.fin_borne){
    bandes=`<br>Aucune bande fine n'a tenu dans le budget : le cuivre le plus
      étroit reste rendu par <b>${aNb(pistes.cellules||0,1)} cellule(s)</b> en
      travers.`;
  }

  return `<p class="note">Le pas calculé dans le diélectrique est
     <b>${aNb((die||0)*k,3)} ${u}</b>, tenu par ${quoi}.
     <small>(${L.join(" · ")})</small>${impose?
     " Vous en imposez un autre : le vôtre part au solveur.":""}${bandes}</p>`;
}

function antBoiteRecapHtml(m,k){
  if(!m)return "";
  return `<span>boîte : ${aNb((m.boite.x2-m.boite.x1)*k,1)} × ${aNb((m.boite.y2-m.boite.y1)*k,1)}
        × ${aNb((m.boite.z2-m.boite.z1)*k,1)} ${antUnite()}</span>
  <span>pas visé : ${aNb(m.resolution.air*k,3)} / ${aNb(m.resolution.die*k,3)}${
        (m.resolution.detail&&m.resolution.detail.fin>0)
          ? " / "+aNb(m.resolution.detail.fin*k,3):""} ${antUnite()}</span>
  <span>plus petite cellule : ${aNb(Math.min.apply(null,m.estimation.plus_petite_cellule_mm)*k,4)} ${antUnite()}</span>
  <span>pas de temps : ${(m.estimation.dt_s*1e12).toFixed(3).replace(".",",")} ps</span>`;
}

ANT_LIER.boite=function(box){
  antLierNombre(box.querySelector("#antMx"), ANT.boite, "mx", {min:0});
  antLierNombre(box.querySelector("#antMy"), ANT.boite, "my", {min:0});
  antLierNombre(box.querySelector("#antMzh"), ANT.boite, "mz_haut", {min:0});
  antLierNombre(box.querySelector("#antMzb"), ANT.boite, "mz_bas", {min:0});
  antLierNombre(box.querySelector("#antPml"), ANT.boite, "pml", {min:4, max:20, defaut:8, entier:true});
  antLierNombre(box.querySelector("#antRa"), ANT.maillage, "res_air", {min:0});
  antLierNombre(box.querySelector("#antRd"), ANT.maillage, "res_die", {min:0});
  const tiers=box.querySelector("#antTiers");
  if(tiers)tiers.onchange=function(){
    ANT.maillage.tiers=this.checked; antMaj(true);
  };
  /* LE BOUTON « APPLIQUER » A DISPARU AVEC SA RAISON D'ÊTRE. Il recopiait le
     conseil dans les quatre marges — or c'est exactement ce qu'une marge
     laissée à zéro fait déjà, et le champ l'affiche maintenant. Le seul effet
     qui restait était nuisible : il figeait la marge, qui ne suivait plus un
     changement de bande ni de PML. */
  antAutoEcrire(box);
};

/* ==========================================================================
   Étape 7 — le calcul
   ========================================================================== */
ANT_CORPS.calcul=function(){
  const e=ANT.etatServeur;
  const peut=e&&e.lancer;
  return `
<p class="intro">Ce qui décide de la fin du calcul, et ce qu'on veut en plus
   du S<sub>11</sub>.</p>

<div class="champ ligne">
  <span><label>Arrêt à l'énergie résiduelle</label>
    <input type="text" inputmode="decimal" spellcheck="false" id="antEn" value="${ANT.arret.energie}"> dB</span>
  <span><label>Pas de temps maximum <small>0 = calculé</small>${antAutoEtq("antNmaxEtq")}</label>
    <input type="text" inputmode="numeric" spellcheck="false" id="antNmax" value="${ANT.arret.nmax}"></span>
</div>
<p class="note">C'est l'énergie qui arrête en pratique ; le nombre de pas n'est
   qu'un garde-fou. −40 dB convient à une antenne ordinaire, −50 dB à un
   résonateur à fort Q — au prix du temps.<br>
   Laissé à <b>zéro</b>, le garde-fou est calculé : quatre fois la durée de
   l'impulsion d'excitation, openEMS en exigeant trois. C'est le seul réglage
   dont la bonne valeur change avec le maillage — la même antenne demande
   23 000 pas maillée large et 81 000 maillée fin, et un nombre saisi une fois
   ne vaut plus rien dès qu'on retouche la grille.
   <span id="antNmaxNote">${antNmaxNoteHtml(ANT.modele)}</span></p>

<div class="champ">
  <label class="ck"><input type="checkbox" id="antNf"${ANT.nf2ff.actif?" checked":""}>
    Calculer le diagramme de rayonnement
    <small>une boîte enregistre le champ tangentiel autour de l'antenne ; le
    champ lointain, la directivité et le rendement s'en déduisent après coup.
    Coûte quelques pour cent de temps de calcul et un peu de mémoire.</small></label>
</div>

${typeof antChampsHtml==="function"?antChampsHtml():""}
${typeof antBalayageHtml==="function"?antBalayageHtml():""}
${typeof antTableauSHtml==="function"?antTableauSHtml():""}

<div class="champ actions">
  <button class="tb" id="bScript2">⤓ Écrire le script Python</button>
  <button class="tb on" id="bLancer2"${peut?"":" disabled"}>▶ Lancer openEMS</button>
  <button class="tb danger" id="bArret2" style="display:none">■ Arrêter la simulation</button>
</div>
<div class="sim-assist-box" id="assistSimBox" style="display:none"></div>

${typeof antVoirHtml==="function"?antVoirHtml():""}
${typeof antCalcHtml==="function"?antCalcHtml():""}
${peut?"":`<p class="note alerte">openEMS n'est pas utilisable sur ce poste :
  ${aEsc((e&&(e.lancer_detail||e.detail))||"raison inconnue")}
  ${e&&e.lancer_conseil?"<br>"+aEsc(e.lancer_conseil):""}
  <br>La préparation et l'export du script, eux, fonctionnent.</p>`}

<p class="note">Le script écrit ici refait <b>exactement</b> cette simulation,
   sans le serveur ni cette page. C'est aussi ce que le bouton « Lancer »
   exécute — il n'y a pas deux chemins qui pourraient diverger.</p>`;
};

/* LES DEUX CRITÈRES, ET LEQUEL A GAGNÉ. Le compteur doit couvrir deux durées
   qui n'ont rien à voir : le temps d'ÉMETTRE l'impulsion — openEMS refuse de
   tourner en dessous de trois fois cette durée —, et le temps que met
   l'antenne à OUBLIER ce qu'on lui a envoyé, qui ne dépend que de son facteur
   de qualité. Le second est le plus long dès qu'une structure résonne, et
   c'est lui qu'on oubliait : un F inversé dont l'impulsion tenait en 31 000
   pas n'est descendu sous −40 dB qu'au 39 165e. */
function antNmaxNoteHtml(m){
  const a=m&&m.arret;
  if(!a||!a.nmax_calcule)return "";
  const d=a.nmax_detail||{};
  const imp=d.impulsion||0, dec=d.decroissance||0;
  const detail=(imp&&dec)
    ? " — "+mdlEntier(imp)+" pour émettre l'impulsion, "+mdlEntier(dec)+
      " pour laisser l'antenne s'éteindre ("+aNb(d.periodes||0,0)+
      " périodes à "+aF(d.f_res||0)+")"
    : "";
  return a.nmax_auto
    ? " Ici : <b>"+mdlEntier(a.nmax)+" pas</b>"+detail+"."
    : " Ici, le modèle en calculerait <b>"+mdlEntier(a.nmax_calcule)+
      "</b>"+detail+" ; vous en imposez "+mdlEntier(a.nmax)+".";
}

ANT_LIER.calcul=function(box){
  antLierNombre(box.querySelector("#antEn"), ANT.arret, "energie", {
    max: -1,
    defaut: -40,
    apres: v => { ANT.arret.energie = -Math.abs(v); }
  });
  /* `min: 0` ET NON 1000 : zéro est une valeur, pas une saisie vide — c'est la
     consigne « calcule-le ». La borne basse ne protège plus de rien depuis que
     le modèle sait refuser un garde-fou plus court que l'impulsion, et elle
     interdisait d'écrire la seule valeur qui ne se trompe jamais. */
  antLierNombre(box.querySelector("#antNmax"), ANT.arret, "nmax", {min: 0, defaut: 0, entier: true});
  box.querySelector("#antNf").onchange=function(){
    ANT.nf2ff.actif=this.checked; antMaj(true);
  };
  box.querySelector("#bScript2").onclick=antTelechargerScript;
  const l=box.querySelector("#bLancer2");
  if(l&&!l.disabled)l.onclick=antLancer;
  const a2=box.querySelector("#bArret2");
  if(a2)a2.onclick=antArreter;
  if(typeof antChampsLier==="function")antChampsLier(box);
  if(typeof antBalayageLier==="function")antBalayageLier(box);
  if(typeof antTableauSLier==="function")antTableauSLier(box);
  if(typeof antVoirLier==="function")antVoirLier(box);
  /* LES DOSSIERS DE CALCUL SE BRANCHENT À PART, et c'est voulu : le bloc
     « voir les champs » ne s'affiche qu'une fois un calcul terminé dans la
     séance, alors que la liste des calculs du projet doit être là AVANT —
     c'est justement par elle qu'on rouvre un calcul d'hier, ou qu'on importe
     celui d'un collègue, sans rien avoir lancé aujourd'hui. */
  if(typeof antCalcLier==="function")antCalcLier(box);
  antAutoEcrire(box);
};

/* ==========================================================================
   Les deux gestes finaux
   ========================================================================== */
async function antTelechargerScript(){
  try{
    const r=await oeScript();
    const blob=new Blob([r.script],{type:"text/x-python;charset=utf-8"});
    telecharger(blob,r.nom);
    typeof wsHint==="function"&&wsHint("Script écrit : "+r.nom);
  }catch(e){
    typeof wsHint==="function"&&wsHint("Script impossible : "+(e.message||e));
    antAssistantRendre();
  }
}

async function antLancer(){
  try{
    await oeLancer();
  }catch(e){
    typeof wsHint==="function"&&wsHint("Lancement refusé : "+(e.message||e));
    antAssistantRendre();
    return;
  }
  ANT.etape=ANT_ETAPES.findIndex(e=>e.id==="calcul");
  antAssistantRendre();
  antJournalRendre();
  antBoutonsEtat();
  await oeSuivre(function(){ antJournalRendre(); antBoutonsEtat(); });
  antJournalRendre();
  antBoutonsEtat();
  antResultatsRendre();
  antAssistantRendre();
  antBoutonsEtat();
  if(ANT.tache&&ANT.tache.etat==="arrete"){
    typeof wsHint==="function"&&wsHint("Simulation arrêtée. Les fichiers de calcul ont été conservés.");
  }
}

/* ==========================================================================
   L'arrêt propre d'une simulation (sans quitter l'outil)
   ========================================================================== */
async function antArreter(){
  if(!ANT.tache)return;
  const ba=aE("bArreter"), ba2=aE("bArret2"), baj=aE("bArret");
  if(ba){ ba.disabled=true; ba.textContent="⏳ Arrêt…"; }
  if(ba2){ ba2.disabled=true; ba2.textContent="⏳ Arrêt…"; }
  if(baj){ baj.disabled=true; baj.textContent="⏳ Arrêt…"; }
  const bl=aE("bLancer"), bl2=aE("bLancer2");
  if(bl){ bl.disabled=true; bl.textContent="⏳ Arrêt…"; }
  if(bl2){ bl2.disabled=true; }
  if(typeof wsHint==="function")wsHint("Arrêt de la simulation demandé…");
  try{
    await oeArreter();
  }catch(e){
    if(typeof wsHint==="function")wsHint("Erreur lors de l'arrêt : "+(e.message||e));
    antBoutonsEtat();
  }
}

/* ==========================================================================
   Le journal du solveur
   ========================================================================== */
function antJournalRendre(){
  const box=aE("journal"), barre=aE("journalBarre");
  if(!box)return;
  const t=ANT.tache;
  if(!t){
    box.innerHTML='<div class="rien">Aucun calcul lancé.</div>';
    barre.innerHTML="";
    return;
  }
  const a=t.avancement||{};
  const encours=(t.etat==="calcule"||t.etat==="prepare");
  /* UN BALAYAGE AFFICHE OU IL EN EST DANS LA SERIE, et pas seulement dans
     le point courant : une barre qui repart de zero toutes les trois minutes
     sans rien dire d'autre laisse croire que le calcul recommence. */
  const bal=t.balayage;
  barre.innerHTML=
    '<span class="etat '+t.etat+'">'+({prepare:"préparation",calcule:"en cours",
      fini:"terminé",echoue:"échec",arrete:"arrêté",perdu:"suivi perdu"}[t.etat]||t.etat)+'</span>'+
    (bal?'<span class="mes">'+aEsc(bal.nom)+' <b>'+bal.courant+'/'+bal.total+
       '</b>'+(bal.points[bal.courant-1]?" · "+aEsc(bal.points[bal.courant-1].etiquette)+
       " "+aEsc(bal.unite):"")+'</span>':"")+
    '<span class="jauge"><i style="width:'+Math.max(2,Math.min(100,a.pourcent||0))+'%"></i></span>'+
    '<span class="mes">pas <b>'+aEnt(a.pas||0)+'</b></span>'+
    '<span class="mes">énergie <b>'+(a.energie_dB==null?"—":aNb(a.energie_dB,1)+" dB")+'</b></span>'+
    '<span class="mes">'+aNb(a.vitesse||0,1)+' MC/s</span>'+
    '<span class="mes">'+antDuree(t.duree||0)+'</span>'+
    /* LE TEMPS RESTANT, ET CE QUI LE COMMANDE. « 12 min » tout court laisse
       croire a une promesse ; ce qu'on annonce est une extrapolation de la
       pente de l'energie, et elle bouge. Dire QUI commande — l'energie qui
       descend, ou le garde-fou qui plafonne — est la seule facon de rendre le
       chiffre lisible : « il reste 12 min, et c'est le garde-fou » veut dire
       que la simulation sera coupee avant d'avoir converge. */
    (encours&&a.restant_s!=null
      ? '<span class="mes">reste <b>≈ '+antDuree(a.restant_s)+'</b>'+
        (a.cause?' <i>('+aEsc(ANT_CAUSES[a.cause]||a.cause)+')</i>':"")+'</span>'
      : "")+
    (encours?'<button class="tb mini danger" id="bArret">■ Arrêter</button>':"")+
    (t.dossier?'<span class="dossier" title="'+aEsc(t.dossier)+'">'+
       'fichiers de calcul conservés</span>':"");

  const lignes=(t.lignes||[]).slice(-600);
  box.innerHTML=lignes.length
    ? '<pre>'+aEsc(lignes.join("\n"))+'</pre>'
    : '<div class="rien">le solveur démarre…</div>';
  box.scrollTop=box.scrollHeight;

  if(t.detail){
    box.insertAdjacentHTML("afterbegin",
      '<div class="echec">'+aEsc(t.detail)+'</div>');
  }
  const arr=aE("bArret");
  if(arr)arr.onclick=antArreter;
}

/* ==========================================================================
   L'état des boutons de la barre d'outils et de l'avancement global
   ========================================================================== */
function antBoutonsEtat(){
  const pret=!!(V.modele&&ANT.modele);
  const t=ANT.tache;
  const encours=t&&(t.etat==="calcule"||t.etat==="prepare");
  const av=(t&&t.avancement)||{};
  const pct=Math.max(0,Math.min(100,Math.round(av.pourcent||0)));
  const bal=t&&t.balayage;

  /* 1. Boutons du lanceur */
  const bs=aE("bScript"), bl=aE("bLancer"), bl2=aE("bLancer2");
  if(bs)bs.disabled=!pret;
  if(bl){
    bl.disabled=!pret||!(ANT.etatServeur&&ANT.etatServeur.lancer)||!!encours;
    bl.textContent=encours
      ? (av.restant_s!=null ? "⏳ ≈ "+antDuree(av.restant_s) : "⏳ En cours…")
      : "▶ Lancer";
  }
  if(bl2){
    bl2.disabled=!pret||!(ANT.etatServeur&&ANT.etatServeur.lancer)||!!encours;
  }

  /* 2. Boutons d'arrêt */
  const ba=aE("bArreter"), ba2=aE("bArret2");
  if(ba){
    ba.style.display=encours?"inline-flex":"none";
    if(encours){ ba.disabled=false; ba.textContent="■ Stop"; }
  }
  if(ba2){
    ba2.style.display=encours?"inline-flex":"none";
    if(encours){ ba2.disabled=false; ba2.textContent="■ Arrêter la simulation"; }
  }

  /* 3. Barre de chargement d'en-tête et ligne supérieure */
  const sp=aE("simProgression"), st=aE("simTopLine");
  const spf=aE("simProgFill"), spt=aE("simProgTxt"), spr=aE("simProgReste");
  const stf=aE("simTopLineFill");
  if(sp&&spf&&spt){
    if(encours){
      sp.style.display="inline-flex";
      sp.className="sim-header-prog";
      spf.style.width=pct+"%";
      spt.textContent=bal ? (bal.courant+"/"+bal.total+" ("+pct+"%)") : (pct+" %");
      if(spr)spr.textContent=av.restant_s!=null ? ("≈ "+antDuree(av.restant_s)) : "";
    }else if(t&&t.etat==="arrete"){
      sp.style.display="inline-flex";
      sp.className="sim-header-prog arrete";
      spf.style.width=pct+"%";
      spt.textContent="Arrêté";
      if(spr)spr.textContent="";
    }else if(t&&t.etat==="echoue"){
      sp.style.display="inline-flex";
      sp.className="sim-header-prog echoue";
      spf.style.width=pct+"%";
      spt.textContent="Échec";
      if(spr)spr.textContent="";
    }else{
      sp.style.display="none";
    }
  }
  if(st&&stf){
    if(encours){
      st.style.display="block";
      st.className="sim-top-line";
      stf.style.width=pct+"%";
    }else if(t&&t.etat==="arrete"){
      st.style.display="block";
      st.className="sim-top-line arrete";
      stf.style.width=pct+"%";
    }else{
      st.style.display="none";
    }
  }

  /* 4. Avancement dans le pied de page */
  const fa=aE("fAvancement");
  if(fa){
    if(encours){
      fa.style.display="inline";
      let msg=bal
        ? ("⏳ "+(bal.nom||"Balayage")+" "+bal.courant+"/"+bal.total+" ("+pct+"%)")
        : ("⏳ Simulation : "+pct+"%");
      if(av.restant_s!=null)msg+=" · reste ≈ "+antDuree(av.restant_s);
      fa.textContent=msg;
    }else if(t&&t.etat==="arrete"){
      fa.style.display="inline";
      fa.textContent="■ Simulation arrêtée";
    }else{
      fa.style.display="none";
    }
  }

  /* 5. Boîte d'avancement dans l'Assistant */
  const boxSim=aE("assistSimBox");
  if(boxSim){
    if(encours||(t&&(t.etat==="arrete"||t.etat==="fini"||t.etat==="echoue"))){
      boxSim.style.display="block";
      boxSim.className="sim-assist-box"+(t.etat==="arrete"?" arrete":t.etat==="echoue"?" echoue":"");
      const etatLabel={prepare:"Préparation",calcule:"Calcul en cours",fini:"Terminé",
                       echoue:"Échec",arrete:"Arrêté",perdu:"Suivi perdu"}[t.etat]||t.etat;
      let resteInfo="";
      if(encours&&av.restant_s!=null){
        resteInfo='<span>Reste : <b>≈ '+antDuree(av.restant_s)+'</b>'+
                  (av.cause?' <i>('+aEsc(ANT_CAUSES[av.cause]||av.cause)+')</i>':'')+'</span>';
      }
      boxSim.innerHTML=
        '<div class="sim-assist-head">'+
          '<span class="sim-assist-titre">'+
            (bal?aEsc(bal.nom)+' (point '+bal.courant+'/'+bal.total+
                 (bal.points[bal.courant-1]?' · '+aEsc(bal.points[bal.courant-1].etiquette)+' '+aEsc(bal.unite):'')+')'
                :'Simulation openEMS')+
          '</span>'+
          '<span class="etat '+t.etat+'">'+etatLabel+'</span>'+
        '</div>'+
        '<div class="sim-assist-jauge"><i class="sim-assist-fill" style="width:'+pct+'%"></i></div>'+
        '<div class="sim-assist-stats">'+
          '<span>Avancement : <b>'+pct+' %</b></span>'+
          resteInfo+
          '<span>Pas : <b>'+aEnt(av.pas||0)+'</b></span>'+
          '<span>Énergie : <b>'+(av.energie_dB!=null?aNb(av.energie_dB,1)+' dB':'—')+'</b></span>'+
          '<span>Vitesse : <b>'+aNb(av.vitesse||0,1)+' MC/s</b></span>'+
          '<span>Durée : <b>'+antDuree(t.duree||0)+'</b></span>'+
        '</div>';
    }else{
      boxSim.style.display="none";
      boxSim.innerHTML="";
    }
  }

  /* 6. Indicateur solveur */
  const f=aE("fSolveur");
  if(f&&ANT.etatServeur){
    f.textContent="openEMS : "+(ANT.etatServeur.lancer?"prêt":"indisponible");
    f.className=ANT.etatServeur.lancer?"ok":"ko";
  }
}
