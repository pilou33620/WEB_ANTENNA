"use strict";
/* =============================================================================
   visionneuse IPC-2581 — 03-rendu.js
   Le canevas. Tout est dessiné à chaque image : la carte entière tient en une
   trentaine d'appels au navigateur (voir 02-modele.js, mdlChemins), et un
   rendu complet coûte moins cher qu'une gestion de zones sales.

   Repère : IPC-2581 compte les Y vers le haut, un canevas vers le bas. Le
   retournement est fait une fois, dans la matrice — les coordonnées du modèle
   ne sont jamais touchées, et ce qu'affiche le pied de page est bien ce que
   contient le fichier.
   ============================================================================= */

const cv=document.getElementById("carte");
const ctx=cv.getContext("2d");

const FOND="#0b0c0d";          // le vide autour de la carte
const SUBSTRAT="#161a17";      // l'époxy, sous le cuivre
const TROU="#050607";          // un perçage, c'est un trou : rien dessous

/* Ordre de dessin des couches non cuivrées : ce qui est physiquement au-dessus
   du cuivre l'est aussi à l'écran. */
const ORDRE_TECH=["dielectrique","masque","pate","serigraphie","autre",
                  "percage","contour"];

const MONO='"JetBrains Mono","SF Mono",Consolas,monospace';

/* ==========================================================================
   Repère écran / monde
   ========================================================================== */
function bcx(){ return V.bbox?(V.bbox.x1+V.bbox.x2)/2:0; }
function mirX(x){ return V.vue.flip?(2*bcx()-x):x; }
function w2s(x,y){
  return {x:mirX(x)*V.vue.scale+V.vue.ox, y:-y*V.vue.scale+V.vue.oy};
}
function s2w(px,py){
  const X=(px-V.vue.ox)/V.vue.scale;
  return {x:mirX(X), y:-(py-V.vue.oy)/V.vue.scale};
}
function poserMonde(c,dpr){
  const s=V.vue.scale*dpr;
  if(V.vue.flip)
    c.setTransform(-s,0,0,-s,(2*bcx()*V.vue.scale+V.vue.ox)*dpr,V.vue.oy*dpr);
  else
    c.setTransform(s,0,0,-s,V.vue.ox*dpr,V.vue.oy*dpr);
}
/* Le rectangle du monde actuellement visible : ce qui tombe en dehors n'a pas
   à être calculé, et c'est ce qui garde le survol fluide sur une grande carte. */
function fenetre(marge){
  const a=s2w(0,0), b=s2w(cv.clientWidth,cv.clientHeight), m=marge||0;
  return {x1:Math.min(a.x,b.x)-m, y1:Math.min(a.y,b.y)-m,
          x2:Math.max(a.x,b.x)+m, y2:Math.max(a.y,b.y)+m};
}
function dansFenetre(f,x1,y1,x2,y2){
  return !(x2<f.x1||x1>f.x2||y2<f.y1||y1>f.y2);
}

/* ==========================================================================
   Cadrage
   ========================================================================== */
let TAILLE={w:0,h:0,dpr:0};
function resize(){
  const r=cv.parentElement.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  /* La densité de pixels compte autant que la taille : changer d'écran ou
     zoomer le navigateur la fait bouger sans toucher à la mise en page, et le
     canevas se retrouverait dessiné plus grand que sa toile. */
  if(Math.abs(r.width-TAILLE.w)<0.5&&Math.abs(r.height-TAILLE.h)<0.5&&
     TAILLE.dpr===dpr)return;
  /* Le canevas naît sans dimensions : l'espace de travail n'a pas encore posé
     ses panneaux, et un onglet en arrière-plan ne mesure rien du tout. Le
     premier vrai calibre est donc aussi le premier cadrage possible — sans
     quoi une carte ouverte trop tôt reste à l'échelle d'un canevas d'un pixel. */
  const premier=(TAILLE.w<=1||TAILLE.h<=1);
  TAILLE={w:r.width,h:r.height,dpr:dpr};
  cv.width=Math.max(1,Math.round(r.width*dpr));
  cv.height=Math.max(1,Math.round(r.height*dpr));
  cv.style.width=r.width+"px"; cv.style.height=r.height+"px";
  if(premier&&V.modele&&r.width>1&&r.height>1)fit();
  else dessiner();
}
/* Le canevas ne change pas de taille qu'avec la fenêtre : ranger un panneau,
   en détacher un, tirer une poignée entre deux docks — tout cela le
   redimensionne sans qu'aucun évènement de fenêtre ne parte. */
if(window.ResizeObserver)
  new ResizeObserver(function(){resize();}).observe(cv.parentElement);
/* Un onglet ouvert en arrière-plan est mis en page mais ne reçoit ni images
   d'animation ni observation de taille : le canevas y reste à un pixel. On le
   remesure au moment où l'onglet revient au premier plan, c'est-à-dire au seul
   moment où cela se voit. */
document.addEventListener("visibilitychange",function(){
  if(document.visibilityState==="visible")resize();
});
function fit(){
  if(!V.modele)return;
  const b=V.bbox, marge=(b.x2-b.x1+b.y2-b.y1)*0.03+0.5;
  const W=cv.clientWidth||1, H=cv.clientHeight||1;
  V.vue.scale=Math.min(W/(b.x2-b.x1+marge*2), H/(b.y2-b.y1+marge*2));
  if(!isFinite(V.vue.scale)||V.vue.scale<=0)V.vue.scale=1;
  const cx=(b.x1+b.x2)/2, cy=(b.y1+b.y2)/2;
  V.vue.ox=W/2-mirX(cx)*V.vue.scale;
  V.vue.oy=H/2+cy*V.vue.scale;
  dessiner();
}
/* Zoom au point visé : c'est le point sous le curseur qui ne bouge pas, pas le
   centre de l'écran — sans quoi on perd de vue ce qu'on regardait. */
function zoomer(k,px,py){
  if(!V.modele)return;
  if(px==null) px=(typeof cv!=="undefined"&&cv&&cv.clientWidth)?cv.clientWidth/2:0;
  if(py==null) py=(typeof cv!=="undefined"&&cv&&cv.clientHeight)?cv.clientHeight/2:0;
  const vise=s2w(px,py);
  V.vue.scale=Math.max(0.02,Math.min(4000,V.vue.scale*k));
  /* On replace la vue pour que le point vise retombe sous le curseur : c'est
     l'inversion directe de w2s, plus sure qu'un rattrapage par difference. */
  V.vue.ox=px-mirX(vise.x)*V.vue.scale;
  V.vue.oy=py+vise.y*V.vue.scale;
  dessiner();
}
function centrerSur(x,y,echelle){
  if(echelle)V.vue.scale=Math.max(0.02,Math.min(4000,echelle));
  V.vue.ox=cv.clientWidth/2-mirX(x)*V.vue.scale;
  V.vue.oy=cv.clientHeight/2+y*V.vue.scale;
  dessiner();
}

/* ==========================================================================
   Dessin
   ========================================================================== */
let RAF=0;
function redessiner(){
  if(RAF)return;
  RAF=requestAnimationFrame(function(){RAF=0;dessiner();});
}
function dessiner(){
  const dpr=window.devicePixelRatio||1;
  /* La densité de pixels peut changer sans qu'aucun évènement ne le dise (on
     déplace la fenêtre sur un autre écran, on zoome le navigateur). On la
     vérifie ici, au seul endroit par lequel tout passe : sans cela, la toile
     garde son ancienne taille et le dessin déborde. */
  if(TAILLE.dpr!==dpr&&TAILLE.w>1){resize();return;}
  peindre(ctx,dpr,cv.width,cv.height);
  piedZoom();
}

/* L'ordre dans lequel les couches passent : le cuivre du fond d'abord, celui
   qu'on regarde en dernier. Se retourner inverse la pile — c'est tout ce que
   « voir la carte par dessous » veut dire. */
function ordreCouches(){
  const cu=V.couches.filter(c=>c.cuivre).sort((a,b)=>a.seq-b.seq);
  if(!V.vue.flip)cu.reverse();               // le dessus se dessine en dernier
  const tech=[];
  for(const genre of ORDRE_TECH)
    for(const c of V.couches)if(!c.cuivre&&c.genre===genre)tech.push(c);
  return cu.concat(tech);
}

function peindre(c,dpr,W,H){
  c.setTransform(1,0,0,1,0,0);
  c.fillStyle=FOND; c.fillRect(0,0,W,H);
  if(!V.modele)return;

  /* Le substrat : la carte a une surface, et la voir aide à situer le reste.
     Sans profil dans le fichier, on ne l'invente pas. */
  poserMonde(c,dpr);
  if(V.contour&&V.aff.contour){
    c.fillStyle=SUBSTRAT;
    c.fill(V.contour,"evenodd");
  }

  for(const couche of ordreCouches()){
    if(!couche.visible)continue;
    peindreCouche(c,dpr,couche);
  }

  if(V.aff.trous)peindreTrous(c,dpr);

  if(V.contour&&V.aff.contour){
    poserMonde(c,dpr);
    c.strokeStyle="#f2c744";
    c.lineWidth=1.2/V.vue.scale;
    c.stroke(V.contour);
  }

  peindreSelection(c,dpr);
  /* La carte de chaleur de la simulation d'impédance (07-simulation.js), quand
     le panneau est ouvert sur ce mode : elle repeint les pistes désignées
     selon leur écart à l'impédance visée. Après la mise en évidence du net —
     c'est un jugement sur ce que celle-ci vient de montrer — et avant les
     composants et les textes, qui doivent rester lisibles par-dessus. */
  /* LE VOILE : le cuivre qui n'est pas dans la simulation s'estompe, pour ne
     pas se confondre avec celui qui porte une couleur de chaleur. Il se pose
     JUSTE AVANT les cartes — celle des impédances comme celle du potentiel —
     et n'existe que tant que l'une d'elles peint. */
  if(typeof simVoile==="function")simVoile(c,W,H);
  if(typeof simZTrace==="function")simZTrace(c,dpr);
  if(typeof simMaillageTrace==="function")simMaillageTrace(c,dpr);
  /* La carte de POTENTIEL (chute DC). Elle ne s'affiche jamais en même
     temps que celle des impédances : `simDCActif()` exige l'onglet DC,
     `simZActif()` l'onglet Impédance. La couche montrée est celle de la
     borne source — le panneau n'en peint qu'une, deux potentiels
     superposés ne se liraient pas. */
  if(typeof simDCTrace==="function"&&typeof simDCCoucheVue==="function")
    simDCTrace(c,simDCCoucheVue());
  /* L'étiquette de la sonde, au-dessus de la carte : elle désigne un point,
     elle ne décrit pas le cuivre. */
  if(typeof simDCTraceSonde==="function")simDCTraceSonde(c,dpr,w2s);
  /* LE CHEVELU DU COURANT DE RETOUR : quels vias de masse referment la boucle
     d'un via de signal, ce que chacun porte, et lesquels ne le peuvent pas. Il
     se pose APRES les cartes de chaleur -- c'est un jugement sur des vias, pas
     sur du cuivre peint -- et AVANT les composants et les textes, qui doivent
     rester lisibles par-dessus. */
  if(typeof simRetourTraceIpc==="function")simRetourTraceIpc(c,dpr);
  /* LES ZONES À RISQUE DU CROSSTALK, peintes sur le cuivre des victimes :
     les portions où LEUR couplage se fabrique. Même place que le chevelu,
     et pour la même raison — elles désignent des portions de cuivre, elles
     ne décrivent pas le cuivre. */
  if(typeof simXtRisqueTraceIpc==="function")simXtRisqueTraceIpc(c,dpr);
  if(V.aff.composants)peindreComposants(c,dpr);
  peindreTextes(c,dpr);
  /* Les boîtiers retenus — plusieurs quand on les a pris à Ctrl+clic. Le reflet
     `V.comp` sert de repli : un banc d'essai peut le poser sans passer par la
     liste de sélection. */
  const boitiers=V.sel.filter(e=>e.s&&e.s.type==="composant").map(e=>e.s.ref);
  if(!boitiers.length&&V.comp)boitiers.push(V.comp);
  for(const ref of boitiers)peindreCompChoisi(c,dpr,ref);
  if(V.survol)peindreSurvol(c,dpr);

  c.setTransform(1,0,0,1,0,0);
  peindreEchelle(c,dpr,W,H);
}

function peindreCouche(c,dpr,couche){
  poserMonde(c,dpr);
  const min=1/V.vue.scale;                   // un trait ne descend pas sous 1 px

  if(V.aff.plans&&couche.chemins.plans){
    c.fillStyle=couche.couleur;
    c.globalAlpha=0.55;                      // un plan reste un fond : on doit
                                             // voir les pistes qui le croisent
    /* UN REMPLISSAGE PAR CONTOUR, et c'est ce qui rend le dessin juste :
       evenodd est un OU EXCLUSIF, pas une union. Tous les contours dans un
       seul chemin, deux dégagements qui se recouvraient se rendaient leur
       cuivre et deux îlots qui se recouvraient s'annulaient en un trou noir.
       Voir `mdlPlansDans`. */
    for(const p of couche.chemins.plans)c.fill(p,"evenodd");
    c.globalAlpha=1;
  }
  if(V.aff.pistes){
    c.strokeStyle=couche.couleur;
    c.lineCap="round"; c.lineJoin="round";
    for(const [w,chemin] of couche.chemins.traits){
      c.lineWidth=Math.max(w||0,min);
      c.stroke(chemin);
    }
  }
  if(V.aff.pads&&couche.chemins.pads){
    c.fillStyle=couche.couleur;
    c.fill(couche.chemins.pads,"nonzero");
  }
}

/* Les perçages passent après le cuivre : un trou traverse tout, et le voir
   percer les pastilles est ce qui rend une carte lisible d'un coup d'œil. */
function peindreTrous(c,dpr){
  poserMonde(c,dpr);
  c.fillStyle=TROU;
  c.fill(V.trous.pth,"nonzero");
  c.fill(V.trous.npth,"nonzero");
  c.strokeStyle="#5f656f";
  c.lineWidth=Math.max(0.4/V.vue.scale,0.02);
  c.stroke(V.trous.npth);                    // non métallisé : cerclé, pour le
}                                            // distinguer d'un via au premier
                                             // regard
/* TOUT CE QUI EST RETENU, un morceau après l'autre. Un clic simple n'en met
   qu'un dans la liste et le dessin est celui d'avant ; Ctrl+clic en met
   plusieurs, et ils s'allument ensemble — c'est à cela qu'on voit qu'une ligne
   RF coupée par trois condensateurs est bien prise d'un bout à l'autre.

   LE REFLET SERT DE REPLI. `V.net` et `V.mev` portent la dernière entrée ; un
   banc d'essai, ou du code qui ne connaîtrait pas la liste, peut les poser
   seuls et obtenir le dessin attendu. */
function peindreSelection(c,dpr){
  if(V.sel.length){
    for(const e of V.sel){
      const s=e.s;
      if(!s||s.type==="composant")continue;    // le cadre du boîtier suit, plus bas
      const net=(s.net!=null&&s.net>=0)?s.net:-1;
      const mev=e.mev||mdlMevTout();
      if(net<0&&!mev.seul)continue;
      peindreNet(c,dpr,net,mev);
    }
    return;
  }
  if(V.net>=0||V.mev.seul)peindreNet(c,dpr,V.net,V.mev);
}

/* La mise en évidence, dans la portée choisie : tout le net, la seule couche
   cliquée, ses seuls perçages, ou le seul via désigné. Ce que la portée écarte
   n'est pas construit — les chemins absents sont nuls, pas vides. */
function peindreNet(c,dpr,net,mev){
  const g=mdlCheminsNet((net==null)?V.net:net,mev||V.mev);
  if(!g)return;
  poserMonde(c,dpr);
  const min=1/V.vue.scale;
  c.strokeStyle="#ffffff"; c.fillStyle="#ffffff";
  c.globalAlpha=0.85; c.lineCap="round"; c.lineJoin="round";
  if(g.plans)for(const p of g.plans)c.fill(p,"evenodd");
  if(g.pads)c.fill(g.pads,"nonzero");
  for(const [w,chemin] of g.traits){
    c.lineWidth=Math.max(w||0,min);
    c.stroke(chemin);
  }
  if(g.trous){
    /* Un anneau posé sur le bord du trou : il se voit sur le cuivre comme sur
       le substrat, et le trou reste un trou. */
    c.lineCap="butt";
    c.lineWidth=Math.max(2/V.vue.scale,0.03);
    c.stroke(g.trous);
  }
  c.globalAlpha=1;
}

/* Les composants : une boîte et, au zoom qui le permet, leur repère. On ne
   dessine que ceux qui sont à l'écran — c'est ici que le tri par fenêtre
   compte, une carte dense en portant des milliers. */
function peindreComposants(c,dpr){
  const f=fenetre(0), vus=[];
  for(const comp of V.modele.composants){
    const b=comp.boite;
    if(!dansFenetre(f,b.x1,b.y1,b.x2,b.y2))continue;
    vus.push(comp);
    if(vus.length>4000)break;
  }
  poserMonde(c,dpr);
  c.lineWidth=Math.max(0.8/V.vue.scale,0.01);
  for(const comp of vus){
    const b=comp.boite, cu=V.couches[comp.c];
    c.strokeStyle=(cu&&cu.dessous)?"#3fa0ea":"#8b919c";
    c.globalAlpha=0.55;
    c.strokeRect(b.x1,b.y1,b.x2-b.x1,b.y2-b.y1);
  }
  c.globalAlpha=1;
  if(!V.aff.refs)return;

  /* Les repères sont écrits dans le repère de l'écran : un texte retourné par
     la matrice serait illisible, et sa taille doit se lire en pixels. */
  c.setTransform(dpr,0,0,dpr,0,0);
  c.font="600 10px "+MONO;
  c.textAlign="center"; c.textBaseline="middle";
  c.fillStyle="#e6e8ec";
  for(const comp of vus){
    const b=comp.boite;
    const wPx=(b.x2-b.x1)*V.vue.scale;
    if(wPx<14)continue;  // trop petit : ce serait une tache
    const p=w2s((b.x1+b.x2)/2,(b.y1+b.y2)/2);
    if(comp.val&&wPx>=28){
      c.font="600 10px "+MONO;
      c.fillStyle="#e6e8ec";
      c.fillText(comp.ref,p.x,p.y-6);
      c.font="500 8.5px "+MONO;
      c.fillStyle="#f59e0b";
      c.fillText(comp.val,p.x,p.y+6);
    }else{
      c.font="600 10px "+MONO;
      c.fillStyle="#e6e8ec";
      c.fillText(comp.ref,p.x,p.y);
    }
  }
}

/* Les textes du fichier (sérigraphie, repères de fabrication). IPC-2581 ne
   donne pas ici de hauteur exploitable : on prend une hauteur de référence,
   celle d'une sérigraphie courante, et le zoom fait le reste. */
function peindreTextes(c,dpr){
  if(!V.aff.textes)return;
  const h=(V.unite==="in")?0.05:1.2;         // hauteur de référence
  const px=h*V.vue.scale;
  if(px<5)return;                            // illisible : autant ne rien mettre
  const f=fenetre(h*4);
  c.setTransform(dpr,0,0,dpr,0,0);
  c.textAlign="left"; c.textBaseline="middle";
  c.font=Math.round(px)+"px "+MONO;
  for(const couche of V.couches){
    if(!couche.visible||!couche.textes.length)continue;
    c.fillStyle=couche.couleur;
    for(const t of couche.textes){
      if(!dansFenetre(f,t.x,t.y,t.x,t.y))continue;
      const p=w2s(t.x,t.y);
      const rot=(t.r||0)*Math.PI/180;
      const mir=(t.m?1:0)^(V.vue.flip?1:0);
      c.save();
      c.translate(p.x,p.y);
      c.rotate(mir?rot:-rot);                // l'écran tourne à l'envers du monde
      if(mir)c.scale(-1,1);
      c.fillText(t.t,0,0);
      c.restore();
    }
  }
}

function peindreCompChoisi(c,dpr,ref){
  const comp=V.parRef.get(ref==null?V.comp:ref);
  if(!comp)return;
  poserMonde(c,dpr);
  const b=comp.boite;
  c.strokeStyle="#f2c744";
  c.lineWidth=Math.max(1.6/V.vue.scale,0.02);
  c.strokeRect(b.x1,b.y1,b.x2-b.x1,b.y2-b.y1);
  /* Les pastilles du composant, elles aussi : un boîtier se reconnaît à son
     empreinte plus qu'à son cadre. */
  const p=new Path2D(), poses=[];
  mdlCompPads(comp,poses);
  for(const q of poses)mdlPadDans(p,q);
  c.globalAlpha=0.5; c.fillStyle="#f2c744";
  c.fill(p,"nonzero"); c.globalAlpha=1;
}
/* Les pastilles d'un composant, replacées dans le monde. Sert au surlignage et
   au survol : c'est le même calcul qu'au chargement, sur un seul boîtier. */
function mdlCompPads(comp,sortie){
  for(const pad of (comp.pads||[]))mdlPadPlace(pad,comp,V.couches,sortie);
  return sortie;
}

function peindreSurvol(c,dpr){
  const s=V.survol;
  poserMonde(c,dpr);
  c.strokeStyle="#fff"; c.globalAlpha=0.9;
  c.lineWidth=Math.max(1.2/V.vue.scale,0.015);
  if(s.type==="composant"&&s.boite){
    c.strokeRect(s.boite.x1,s.boite.y1,s.boite.x2-s.boite.x1,s.boite.y2-s.boite.y1);
  }else if(s.type==="plan"&&s.plan){
    /* Un plan n'a ni centre ni rayon : on en souligne le bord, découpes
       comprises — c'est là qu'on voit lequel des deux plans superposés le
       curseur a attrapé. */
    c.stroke(mdlCheminPlan(s.plan));
  }else if(s.r){
    c.beginPath();
    c.arc(s.x,s.y,s.r+Math.max(1.5/V.vue.scale,0.02),0,2*Math.PI);
    c.stroke();
  }
  c.globalAlpha=1;
}

/* Une règle dans le coin : sans elle, un zoom en pourcentage ne dit rien de la
   taille réelle de ce qu'on regarde. */
function peindreEchelle(c,dpr,W,H){
  if(!V.modele)return;
  const cible=110/V.vue.scale;               // ~110 px, ramenés au pas rond
  const dec=Math.pow(10,Math.floor(Math.log10(cible)));
  const m=cible/dec;
  const pas=dec*(m>=5?5:m>=2?2:1);
  const px=pas*V.vue.scale*dpr;
  const x=14*dpr, y=H-16*dpr;
  c.strokeStyle="#8b919c"; c.fillStyle="#8b919c"; c.lineWidth=dpr;
  c.beginPath();
  c.moveTo(x,y-4*dpr); c.lineTo(x,y); c.lineTo(x+px,y); c.lineTo(x+px,y-4*dpr);
  c.stroke();
  c.font=(10*dpr)+"px "+MONO;
  c.textAlign="left"; c.textBaseline="bottom";
  c.fillText(mdlNb(pas)+" "+V.unite,x,y-6*dpr);
}

function piedZoom(){
  const el=document.getElementById("fZoom");
  if(!el)return;
  /* Le zoom d'une visionneuse n'a pas de « 100 % » naturel : on annonce ce qui
     se lit, le nombre de pixels que vaut l'unité du fichier. */
  el.textContent=mdlNb(V.vue.scale,V.vue.scale<10?2:0)+" px/"+V.unite;
  const f=document.getElementById("fFace");
  if(f)f.textContent=V.vue.flip?"dessous":"dessus";
}
