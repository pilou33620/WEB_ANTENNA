"use strict";
/* =============================================================================
   Antenne openEMS — 38-tuto.js
   Le mode tuto, sur le modèle de celui de WEB_CAO (commun/tuto.js).

   L'interrupteur « 🎓 Mode tuto » est sur l'écran d'accueil : chaque outil de
   WEB_SUITE tourne sur son port, celui de l'accueil WEB_CAO n'arrive donc pas
   jusqu'ici. Coché :
     · la visite guidée démarre — projecteur sur l'élément, bulle Suivant /
       Précédent (flèches, Entrée, Échap), sur l'exemple patch ;
     · des pastilles « ? » restent sur les grandes fonctions visibles : le
       survol redonne l'explication de la visite.
   L'adresse en ?tuto propose aussi la visite (pour un lien depuis le lanceur).
   Une étape : sel (élément visé), faire (action avant d'afficher), titre,
   texte (HTML statique).
   ============================================================================= */
(function tutoInit(){
  const CLE="cao.tuto";
  const lire=()=>{try{return localStorage.getItem(CLE)==="1";}catch(e){return false;}};
  const ecrire=v=>{try{localStorage.setItem(CLE,v?"1":"0");}catch(e){}};

  const etapes=[
    {titre:"Bienvenue dans Antenne openEMS",
     texte:"De la carte réelle jusqu'au solveur FDTD : on désigne l'antenne, on complète ce que le fichier ne dit pas, et openEMS rend le S<sub>11</sub>, l'impédance d'entrée et le diagramme de rayonnement."},
    {sel:"#depot",titre:"Partir d'une carte",
     texte:"Déposez l'IPC-2581 livré par le fabricant (.xml, .cvg, .zip) ou un .json déjà exporté d'ici. La lecture se fait sur le serveur."},
    {sel:"#accueil .ou:not(.reprendre)",titre:"Ou dessiner",
     texte:"<b>Concevoir</b> : empilage, matériaux, et un gabarit donne le premier dessin à la fréquence visée. Les <b>exemples</b> posent un cas déjà réglé : patch, IFA, réseau 3×3."},
    {sel:"#carte",titre:"L'exemple patch",
     texte:"On pose le patch 2,45 GHz sur FR-4 : le cuivre, couche par couche. <kbd>F</kbd> ajuste, <kbd>B</kbd> retourne la carte, <kbd>P</kbd> montre les plans.",
     faire:()=>typeof exPoser==="function"&&exPoser("patch")},
    {sel:".vues",titre:"2D, 3D, maillage",
     texte:"La 2D pour désigner le cuivre, la <b>3D</b> pour voir le modèle qui part au solveur, <b>Maillage</b> pour les lignes FDTD et leurs coupes."},
    {sel:'[data-pnl="assistant"]',titre:"L'assistant",
     texte:"Sept étapes, de la carte au modèle : le cuivre, l'empilage, ce qui l'entoure, la bande, les ports, la boîte d'air, le calcul. Tout ce qu'il complète est écrit et chiffré."},
    {sel:"#assistantCorps",titre:"Le calcul",
     texte:"L'exemple s'arrête sur la dernière étape : arrêt, champ lointain, et ce que la simulation va coûter — cellules, mémoire, durée attendue."},
    {sel:'[data-pnl="conception"]',titre:"Conception",
     texte:"Retoucher le dessin, changer de gabarit ou de fréquence cible : le modèle suit."},
    {sel:"#bLancer",titre:"Lancer",
     texte:"openEMS calcule sur le serveur ; la progression s'affiche dans la barre, <b>Stop</b> arrête sans fermer l'outil."},
    {sel:"#bScript",titre:"Script .py",
     texte:"Le script Python openEMS qui refait exactement cette simulation, pour la relancer ailleurs."},
    {sel:'[data-pnl="resultats"]',titre:"Résultats",
     texte:"S<sub>11</sub>, impédance d'entrée et diagramme de rayonnement, à la fin du calcul ; <b>Champs</b> anime la carte de champ."},
    {sel:"#bRapport",titre:"Rapport",
     texte:"Un rapport d'ingénierie complet : résultats, empilage, géométrie, maillage et diagnostic des anomalies."},
    {sel:"#bIaAssistant",titre:"Assistant IA",
     texte:"Il vérifie les réglages, même sans réseau ni clé ; rien ne s'applique sans un clic. <kbd>Alt+I</kbd>."},
    {sel:"#bProjet",titre:"Projet",
     texte:"Où ranger le travail : une antenne se dimensionne en plusieurs passes, et chacune reprend la précédente."}
  ];

  let actif=lire(), i=-1, minuterie=0;
  const el=(tag,cls,html)=>{const e=document.createElement(tag);e.className=cls;if(html)e.innerHTML=html;return e;};
  const spot=el("div","tuto-spot"), bulle=el("div","tuto-bulle"), info=el("div","tuto-info");
  const calque=el("div","tuto-calque");
  document.body.append(calque,spot,bulle,info);
  bulle.hidden=spot.hidden=calque.hidden=info.hidden=true;

  /* L'interrupteur, au coin de l'accueil et non dans son texte : centré, le
     texte déborde des deux côtés quand la fenêtre est petite. */
  const bouton=el("button","tb tuto-interrupteur",'<span class="tuto-coche"></span>🎓 Mode tuto');
  bouton.type="button";
  bouton.title="Mode tuto : visite guidée de l'outil, et des ? expliquent les grandes fonctions";
  const accueil=document.getElementById("accueil");
  if(accueil){const l=el("div","tuto-ligne");l.appendChild(bouton);accueil.appendChild(l);}

  const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};

  /* Pose la bulle près du rectangle r : dessous, dessus, à droite, à gauche,
     sinon dedans (canevas, grands panneaux). */
  function placer(b,r){
    const W=innerWidth,H=innerHeight,bw=b.offsetWidth,bh=b.offsetHeight,m=12;
    let x,y;
    if(!r){x=(W-bw)/2;y=(H-bh)/2;}
    else if(r.bottom+m+bh<H){x=r.left;y=r.bottom+m;}
    else if(r.top-m-bh>0){x=r.left;y=r.top-m-bh;}
    else if(r.right+m+bw<W){x=r.right+m;y=r.top;}
    else if(r.left-m-bw>0){x=r.left-m-bw;y=r.top;}
    else{x=r.left+(r.width-bw)/2;y=r.bottom-bh-24;}
    b.style.left=Math.max(m,Math.min(x,W-bw-m))+"px";
    b.style.top=Math.max(m,Math.min(y,H-bh-m))+"px";
  }

  /* ---------------- visite guidée ---------------- */
  function montrer(n){
    i=n;const e=etapes[i];
    if(e.faire){e.faire();setTimeout(afficher,80);}   // la page se remet en place après l'action
    else afficher();
  }
  function afficher(){
    const e=etapes[i], dernier=i===etapes.length-1;
    const cible=e.sel&&document.querySelector(e.sel);
    const r=visible(cible)?cible.getBoundingClientRect():null;
    calque.hidden=!!r; spot.hidden=!r;
    if(r)Object.assign(spot.style,{left:r.left-4+"px",top:r.top-4+"px",width:r.width+8+"px",height:r.height+8+"px"});
    const points=etapes.map((_,k)=>'<i class="'+(k===i?"on":k<i?"fait":"")+'"></i>').join("");
    bulle.innerHTML='<div class="tuto-num">Étape '+(i+1)+' / '+etapes.length+'</div>'+
      '<h4>'+e.titre+'</h4><p>'+e.texte+'</p>'+
      (dernier?'<p class="tuto-fin">C\'est fini ! Les <b>?</b> restent sur l\'interface tant que le mode tuto est coché.</p>':'')+
      '<div class="tuto-pied"><span class="tuto-points">'+points+'</span>'+
      (dernier?'<button class="tb" data-t="off">Couper le mode tuto</button>':'')+
      (i?'<button class="tb" data-t="-1">Précédent</button>':'<button class="tb" data-t="x">Passer</button>')+
      '<button class="tb on" data-t="1">'+(dernier?"Terminer":"Suivant ›")+'</button></div>';
    bulle.hidden=false;
    placer(bulle,r);
  }
  function finir(){i=-1;bulle.hidden=spot.hidden=calque.hidden=true;}
  function avancer(d){const n=i<0?0:i+d;if(n<0)return;if(n<etapes.length)montrer(n);else finir();}
  bulle.addEventListener("click",ev=>{
    const t=ev.target.closest("[data-t]");if(!t)return;
    const a=t.dataset.t;
    if(a==="x")finir();else if(a==="off")basculer(false);else avancer(+a);
  });
  // en capture : l'outil ne voit pas ces touches pendant la visite
  document.addEventListener("keydown",ev=>{
    if(i===-1)return;
    const k={ArrowRight:1,Enter:1,ArrowLeft:-1}[ev.key];
    if(ev.key==="Escape")finir();else if(k)avancer(k);else return;
    ev.preventDefault();ev.stopPropagation();
  },true);
  addEventListener("resize",()=>{if(i>=0)afficher();});

  function proposer(){
    calque.hidden=false;spot.hidden=true;
    bulle.innerHTML='<div class="tuto-num">Mode tuto</div><h4>Visite guidée</h4>'+
      '<p>'+etapes.length+' étapes sur l\'exemple patch 2,45 GHz. <kbd>→</kbd> ou <kbd>Entrée</kbd> pour avancer, <kbd>Échap</kbd> pour quitter.</p>'+
      '<div class="tuto-pied"><button class="tb" data-t="x">Plus tard</button>'+
      '<button class="tb on" data-t="1">Commencer ›</button></div>';
    bulle.hidden=false;placer(bulle,null);
    i=-2;            // carte d'accueil : ni visite (i ≥ 0) ni rien (i = -1)
  }

  /* ---------------- infos bulles ---------------- */
  const pastilles=etapes.filter(e=>e.sel).map(e=>{
    const p=el("button","tuto-pastille","?");p.type="button";p.hidden=true;
    p.onmouseenter=()=>{info.innerHTML="<h4>"+e.titre+"</h4><p>"+e.texte+"</p>";info.hidden=false;placer(info,p.getBoundingClientRect());};
    p.onmouseleave=()=>{info.hidden=true;};
    document.body.appendChild(p);
    return {p,e};
  });
  // ponytail: sondage toutes les 0,5 s (panneaux qui bougent, accueil qui disparaît) ; observer le DOM si ça coûte
  function reposer(){
    for(const {p,e} of pastilles){
      const c=document.querySelector(e.sel);
      p.hidden=!actif||i>=0||!visible(c);
      if(p.hidden)continue;
      const r=c.getBoundingClientRect();
      p.style.left=Math.min(r.right-9,innerWidth-20)+"px";p.style.top=Math.max(r.top-7,2)+"px";
    }
  }

  function basculer(v){
    actif=v;ecrire(v);bouton.classList.toggle("on",v);bouton.setAttribute("aria-pressed",v);
    clearInterval(minuterie);info.hidden=true;
    if(v){minuterie=setInterval(reposer,500);proposer();}
    else finir();
    reposer();
  }
  bouton.onclick=()=>basculer(!actif);
  bouton.classList.toggle("on",actif);bouton.setAttribute("aria-pressed",actif);
  if(actif)minuterie=setInterval(reposer,500);

  if(/[?&]tuto\b/.test(location.search)){
    history.replaceState(null,"",location.pathname);   // un rechargement ne relance pas
    setTimeout(proposer,400);
  }
})();
