"use strict";
/* ==========================================================================
   Téléphone — disposition des outils sur un petit écran (voir telephone.css)
   COPIE IDENTIQUE dans WEB_ANTENNA (js/) et WEB_3D (js/) ; l'original est
   WEB_CAO/commun/telephone.js.

   Pose body.tel + tel-portrait / tel-paysage selon l'écran, et range les
   panneaux des docks dans un tiroir à onglets. Avec l'espace de travail
   modulaire (workspace.js, chargé AVANT ce fichier), les panneaux sont ceux
   des docks et les flottants ; sa disposition mémorisée n'est pas touchée et
   revient telle quelle quand l'écran grandit. Sans lui (WEB_3D), ce sont les
   sections .pan des .dock, remises à leur place au retour.
   ========================================================================== */
(function(){
  const qPortrait=matchMedia("(max-width:600px) and (orientation:portrait)");
  const qPaysage=matchMedia("(max-height:500px) and (orientation:landscape)");
  const B=document.body;
  const tir=document.createElement("div");
  tir.id="telTiroir";
  tir.innerHTML='<button type="button" class="tel-poignee" aria-label="Ouvrir ou fermer les panneaux"></button>'+
    '<div class="tel-onglets" role="tablist"></div><div class="tel-corps"></div>';
  const lang=document.createElement("button");
  lang.type="button";lang.id="telLanguette";lang.textContent="Panneaux ‹";
  B.append(tir,lang);
  const onglets=tir.querySelector(".tel-onglets"), corps=tir.querySelector(".tel-corps");
  const avecWS=typeof wsApply==="function";
  const fixes=avecWS?null:Array.from(document.querySelectorAll(".dock > .pan"));
  const origine=new Map();
  let mode="", actif=null;

  function panneaux(){
    if(!avecWS)return fixes;
    return WS_DOCKS.flatMap(function(k){return WS.order[k];}).concat(WS.floats)
      .map(function(id){return wsEl[id];}).filter(Boolean);
  }
  function titre(el){
    const h=el.querySelector("h3");
    return el.dataset.title||(h&&h.firstChild&&h.firstChild.textContent.trim())||"Panneau";
  }
  function remplir(){
    const els=panneaux();
    if(els.indexOf(actif)<0)actif=els[0]||null;
    tir.classList.toggle("vide",!els.length);
    onglets.textContent="";
    els.forEach(function(el){
      if(!avecWS&&!origine.has(el))origine.set(el,[el.parentNode,el.nextSibling]);
      el.classList.remove("floating","maximized","collapsed");
      el.style.left=el.style.top=el.style.width=el.style.height="";
      el.classList.toggle("tel-cache",el!==actif);
      corps.appendChild(el);
      const b=document.createElement("button");
      b.type="button";b.setAttribute("role","tab");b.textContent=titre(el);
      b.setAttribute("aria-selected",String(el===actif));
      b.onclick=function(){
        if(el===actif&&tir.classList.contains("ouvert"))ouvrir(false);
        else{actif=el;remplir();ouvrir(true);}
      };
      onglets.appendChild(b);
    });
  }
  function rendre(){
    corps.querySelectorAll(".tel-cache").forEach(function(el){el.classList.remove("tel-cache");});
    if(avecWS){wsApply(false);return;}
    /* à rebours : le voisin de chaque panneau est déjà revenu quand on le remet */
    Array.from(origine).reverse().forEach(function(o){o[1][0].insertBefore(o[0],o[1][1]);});
    origine.clear();
  }
  function mesurer(){
    const h=document.querySelector("body>header"), f=document.querySelector("body>footer");
    const s=document.documentElement.style;
    s.setProperty("--tel-haut",Math.round(h?h.getBoundingClientRect().bottom+4:100)+"px");
    s.setProperty("--tel-bas",Math.round(tir.offsetHeight+(f?f.offsetHeight:0))+"px");
  }
  /* le canevas suit la place que le tiroir lui laisse */
  function redimensionner(){
    requestAnimationFrame(function(){mesurer();dispatchEvent(new Event("resize"));});
  }
  function ouvrir(o){
    tir.classList.toggle("ouvert",o);
    B.classList.toggle("tel-ouvert",o);
    redimensionner();
  }
  function appliquer(){
    const m=qPortrait.matches?"portrait":qPaysage.matches?"paysage":"";
    if(m===mode)return;
    const avant=mode;
    mode=m;
    B.classList.toggle("tel",!!m);
    B.classList.toggle("tel-portrait",m==="portrait");
    B.classList.toggle("tel-paysage",m==="paysage");
    if(m&&!avant)remplir();
    else if(!m){ouvrir(false);rendre();}
    redimensionner();
  }

  /* l'espace de travail réarrange ses docks (menu « Espace de travail »,
     changement de profil…) : on reprend ses panneaux dans le tiroir */
  if(avecWS){
    const base=wsApply;
    wsApply=function(save){base(save);if(mode)remplir();};
  }
  tir.querySelector(".tel-poignee").onclick=function(){ouvrir(!tir.classList.contains("ouvert"));};
  lang.onclick=function(){ouvrir(true);};
  qPortrait.addEventListener("change",appliquer);
  qPaysage.addEventListener("change",appliquer);
  appliquer();
})();
