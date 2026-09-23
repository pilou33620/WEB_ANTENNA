"use strict";
/* =============================================================================
   Antenne openEMS — 21-dessin.js
   Le geste : poser du cuivre à la souris, et le voir pendant qu'on le pose.

   CE MODULE NE CONNAÎT QUE LE CANEVAS. Il traduit des pointeurs en formes et
   les range dans `CON.elements` (20-conception.js) ; c'est ce module-là qui
   sait ensuite en faire un document. La séparation n'est pas décorative : le
   dessin se règle aussi bien au clavier, dans le panneau, en tapant des
   cotes — et une antenne se dimensionne BIEN MIEUX en tapant des cotes qu'en
   visant à la souris. Le canevas est un confort, pas la source de vérité.

   POURQUOI LA CAPTURE, ET POURQUOI ELLE COUPE LA PROPAGATION. Le canevas a
   déjà un propriétaire : 04-interaction.js y lit le survol, la sélection de
   cuivre, le déplacement de la vue. Un clic qui pose un coin de rectangle ne
   doit pas, en plus, désigner la piste qui passe dessous — deux effets pour
   un geste, dont un non voulu. On se pose donc en phase CAPTURE, comme le
   fait déjà la pose du port (15-overlay2d.js), et on ne laisse passer que ce
   qui ne nous concerne pas : le bouton du milieu, le bouton droit, la molette
   et le clic dans le vide en mode « choisir » continuent de déplacer la vue.
   ============================================================================= */

/* Les multiples d'un pas de grille qui restent lisibles : la suite 1-2-5,
   celle de toutes les règles graduées. */
const CON_MULTIPLES=[1,2,5,10,20,50,100,200,500,1000,2000,5000];

/* La grille d'accrochage. Zéro = aucun magnétisme. */
function conSnap(v){
  const g=CON.grille;
  return (g>0)?+(Math.round(v/g)*g).toFixed(4):+v.toFixed(4);
}

/* Le point du monde sous le pointeur, en millimètres et accroché. */
function conPoint(e){
  const r=cv.getBoundingClientRect();
  const w=s2w(e.clientX-r.left, e.clientY-r.top);
  return {x:conSnap(w.x), y:conSnap(w.y)};
}

/* Les outils, et ce qu'ils posent. L'ordre est celui de la barre. */
const CON_OUTILS=[
  {id:"select",  nom:"Choisir",    aide:"choisir une forme, la déplacer, la régler au clavier"},
  {id:"rect",    nom:"Rectangle",  aide:"glisser d'un coin à l'autre : un patch, un plan de masse, un bras"},
  {id:"piste",   nom:"Piste",      aide:"cliquer les sommets : une ligne d'alimentation, un brin"},
  {id:"poly",    nom:"Polygone",   aide:"cliquer les sommets ; double-clic pour fermer"},
  {id:"disque",  nom:"Disque",     aide:"glisser du centre au bord : un patch circulaire, une pastille"},
  {id:"via",     nom:"Via",        aide:"cliquer : un court-circuit métallisé de la face haute à la face basse"}
];

/* ==========================================================================
   Créer une forme
   ========================================================================== */
function conNouvelle(type,champs){
  const el=Object.assign({type:type, cu:CON.coucheActive, net:CON.netActif,
                          trou:!!CON.trou&&type!=="via"&&type!=="piste"},
                         champs);
  /* Une découpe n'appartient à aucun net : elle ne pose pas de cuivre, elle
     en retire. Lui laisser un net ferait croire qu'elle conduit. */
  if(el.trou)el.net="";
  conArrondir(el);
  CON.elements.push(el);
  CON.sel=CON.elements.length-1;
  return el;
}

/* Une forme trop petite n'est pas une forme : c'est un clic qui a bougé.
   La poser quand même remplirait le dessin de rectangles d'un micron, qu'on
   ne verrait pas et qu'on ne saurait pas retirer. */
function conAssezGrande(el){
  const b=conBoite(el);
  const min=Math.max(CON.grille,0.02);
  return (b.x2-b.x1)>=min&&(b.y2-b.y1)>=min;
}

/* ==========================================================================
   Le pointeur
   ========================================================================== */
let CON_GLISSE=null;        // {mode:"forme"|"deplace", …} pendant un glissement

function conDessinActif(){
  return CON.actif&&CON.outil!=="select";
}

/* Ce que la barre d'état dit au curseur : sans cela, on ne sait pas qu'un
   double-clic ferme un polygone, et on cherche le bouton qui n'existe pas. */
function conAide(){
  if(!CON.actif)return "";
  if(CON.courant)
    return CON.courant.type==="piste"
      ? "Cliquez les sommets — double-clic ou Entrée pour finir, Échap pour annuler."
      : "Cliquez les sommets — double-clic ou Entrée pour fermer, Échap pour annuler.";
  const o=CON_OUTILS.find(o=>o.id===CON.outil);
  return o?(o.nom+" : "+o.aide):"";
}

(function(){
  if(!cv)return;

  cv.addEventListener("pointerdown",function(e){
    if(!CON.actif||e.button!==0)return;

    const p=conPoint(e);

    /* Mode « choisir » : on ne prend la main QUE si le clic tombe sur une
       forme. Ailleurs, le clic appartient à la visionneuse — il déplace la
       vue, et c'est ce qu'on attend d'un clic dans le vide. */
    if(CON.outil==="select"){
      const i=conFormeSous(p.x,p.y);
      if(i<0){ CON.sel=-1; conRafraichirPanneau(); return; }
      e.stopPropagation(); e.preventDefault();
      CON.sel=i;
      CON_GLISSE={mode:"deplace", x:p.x, y:p.y, bouge:false};
      try{ cv.setPointerCapture(e.pointerId); }catch(err){}
      conRafraichirPanneau();
      redessiner();
      return;
    }

    e.stopPropagation(); e.preventDefault();

    if(CON.outil==="via"){
      conNouvelle("via",{x:p.x, y:p.y, d:CON.diametreVia});
      conAppliquer(false);
      return;
    }

    if(CON.outil==="piste"||CON.outil==="poly"){
      /* Une polyligne se construit clic par clic. Le premier clic l'ouvre, les
         suivants l'allongent, le double-clic la ferme. */
      if(!CON.courant)
        CON.courant={type:CON.outil, pts:[[p.x,p.y]], apercu:[p.x,p.y]};
      else
        CON.courant.pts.push([p.x,p.y]);
      redessiner();
      return;
    }

    /* Rectangle et disque : un glissement, d'un coin à l'autre ou du centre
       au bord. */
    CON_GLISSE={mode:"forme", x:p.x, y:p.y};
    CON.courant=(CON.outil==="rect")
      ? {type:"rect", x1:p.x, y1:p.y, x2:p.x, y2:p.y}
      : {type:"disque", cx:p.x, cy:p.y, r:0};
    try{ cv.setPointerCapture(e.pointerId); }catch(err){}
    redessiner();
  },true);

  cv.addEventListener("pointermove",function(e){
    if(!CON.actif)return;

    if(CON_GLISSE&&CON_GLISSE.mode==="deplace"){
      e.stopPropagation(); e.preventDefault();
      const p=conPoint(e);
      const dx=p.x-CON_GLISSE.x, dy=p.y-CON_GLISSE.y;
      if(!dx&&!dy)return;
      const el=CON.elements[CON.sel];
      if(el){ conDeplacer(el,dx,dy); CON_GLISSE.bouge=true; }
      CON_GLISSE.x=p.x; CON_GLISSE.y=p.y;
      redessiner();
      return;
    }

    if(CON_GLISSE&&CON_GLISSE.mode==="forme"){
      e.stopPropagation(); e.preventDefault();
      const p=conPoint(e);
      if(CON.courant.type==="rect"){ CON.courant.x2=p.x; CON.courant.y2=p.y; }
      else CON.courant.r=+Math.hypot(p.x-CON.courant.cx,
                                     p.y-CON.courant.cy).toFixed(4);
      redessiner();
      return;
    }

    /* Le fil élastique d'une polyligne en cours : sans lui, on pose des
       sommets à l'aveugle. */
    if(CON.courant&&CON.courant.pts){
      const p=conPoint(e);
      CON.courant.apercu=[p.x,p.y];
      redessiner();
    }
  },true);

  const finir=function(e){
    if(!CON_GLISSE)return;
    const g=CON_GLISSE;
    CON_GLISSE=null;
    try{ cv.releasePointerCapture(e.pointerId); }catch(err){}

    if(g.mode==="deplace"){
      e.stopPropagation();
      if(g.bouge)conAppliquer(false);
      return;
    }

    e.stopPropagation(); e.preventDefault();
    const c=CON.courant;
    CON.courant=null;
    if(!c)return;
    if(!conAssezGrande(c)){ redessiner(); conRafraichirPanneau(); return; }
    if(c.type==="rect")conNouvelle("rect",{x1:c.x1,y1:c.y1,x2:c.x2,y2:c.y2});
    else conNouvelle("disque",{cx:c.cx, cy:c.cy, r:c.r});
    conAppliquer(false);
  };
  cv.addEventListener("pointerup",finir,true);
  cv.addEventListener("pointercancel",function(e){
    if(!CON_GLISSE)return;
    CON_GLISSE=null; CON.courant=null; redessiner();
  },true);

  /* Le double-clic ferme une polyligne. Il est capté AVANT celui de la
     visionneuse, qui sinon prendrait tout le net sous le curseur. */
  cv.addEventListener("dblclick",function(e){
    if(!CON.actif||!CON.courant||!CON.courant.pts)return;
    e.stopPropagation(); e.preventDefault();
    conTerminerPolyligne();
  },true);
})();

/* La forme la plus récente sous ce point. « La plus récente » et non « la plus
   grande » : on dessine du plus grand au plus petit — un plan de masse, puis
   une découpe dedans —, et c'est toujours la dernière posée qu'on veut
   reprendre. */
function conFormeSous(x,y){
  for(let i=CON.elements.length-1;i>=0;i--)
    if(conDedans(CON.elements[i],x,y))return i;
  return -1;
}

function conTerminerPolyligne(){
  const c=CON.courant;
  CON.courant=null;
  if(!c||!c.pts){ redessiner(); return; }
  if(c.type==="piste"&&c.pts.length>=2)
    conNouvelle("piste",{pts:c.pts.map(q=>q.slice()), w:CON.largeur});
  else if(c.type==="poly"&&c.pts.length>=3)
    conNouvelle("poly",{pts:c.pts.map(q=>q.slice())});
  else{ redessiner(); conRafraichirPanneau(); return; }
  conAppliquer(false);
}

function conAnnulerCourant(){
  CON.courant=null;
  CON_GLISSE=null;
  redessiner();
}

function conSupprimerChoisie(){
  if(CON.sel<0||CON.sel>=CON.elements.length)return;
  CON.elements.splice(CON.sel,1);
  CON.sel=-1;
  conAppliquer(false);
}

function conRafraichirPanneau(){
  if(typeof conPanneauRendre==="function")conPanneauRendre();
}

/* ==========================================================================
   Le clavier
   --------------------------------------------------------------------------
   En capture, et seulement pour les touches qu'on consomme : le reste
   appartient à la visionneuse (F pour ajuster, B pour retourner la carte) et
   à l'assistant, et les lui prendre casserait des raccourcis qui marchent.
   ========================================================================== */
window.addEventListener("keydown",function(e){
  if(!CON.actif)return;
  if(e.target&&/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;

  /* ANNULER ET REFAIRE SONT LES SEULS RACCOURCIS À MODIFICATEUR, et ils
     passent AVANT le renvoi qui suit. Les trois écritures sont acceptées
     parce que les trois existent : Ctrl+Y sur Windows, Ctrl+Maj+Z partout
     ailleurs, et Cmd sur un Mac — quelqu'un qui cherche à annuler essaie
     celle qu'il connaît, et une seule qui réponde suffit à ne pas savoir
     laquelle marche.

     Une polyligne EN COURS se défait sommet par sommet, comme le fait déjà
     Retour arrière : tant qu'elle n'est pas fermée, elle n'est dans aucun
     historique — l'historique ne retient que ce qui a été accepté. */
  if((e.ctrlKey||e.metaKey)&&!e.altKey){
    const k=String(e.key).toLowerCase();
    const annuler=(k==="z"&&!e.shiftKey);
    const refaire=(k==="y")||(k==="z"&&e.shiftKey);
    if(!annuler&&!refaire)return;
    e.stopPropagation(); e.preventDefault();
    if(annuler&&CON.courant&&CON.courant.pts){
      CON.courant.pts.pop();
      if(!CON.courant.pts.length)CON.courant=null;
      redessiner();
      return;
    }
    if(annuler)conAnnuler();
    else conRefaire();
    return;
  }
  if(e.altKey)return;

  if(e.key==="Escape"&&(CON.courant||CON_GLISSE)){
    e.stopPropagation(); e.preventDefault();
    conAnnulerCourant();
    return;
  }
  if((e.key==="Enter")&&CON.courant&&CON.courant.pts){
    e.stopPropagation(); e.preventDefault();
    conTerminerPolyligne();
    return;
  }
  if(e.key==="Backspace"&&CON.courant&&CON.courant.pts){
    e.stopPropagation(); e.preventDefault();
    CON.courant.pts.pop();
    if(!CON.courant.pts.length)CON.courant=null;
    redessiner();
    return;
  }
  if((e.key==="Delete"||e.key==="Suppr")&&CON.sel>=0&&!CON.courant){
    e.stopPropagation(); e.preventDefault();
    conSupprimerChoisie();
  }
},true);

/* ==========================================================================
   Ce que le mode ajoute sur la vue de dessus
   --------------------------------------------------------------------------
   TROIS CHOSES SEULEMENT, et aucune n'est du cuivre : le cuivre dessiné est
   DÉJÀ dans le document, et c'est le rendu ordinaire qui le peint. Ce qui
   manque, c'est ce qui n'existe pas encore ou ce qui n'existe pas du tout :
   la grille, la forme en cours, et la forme choisie.
   ========================================================================== */
(function(){
  const base=window.peindre;
  if(typeof base!=="function")return;
  window.peindre=function(c,dpr,W,H){
    base(c,dpr,W,H);
    try{ conSurimpression(c,dpr,W,H); }
    catch(e){ /* un repère ne doit jamais empêcher la carte de s'afficher */ }
  };
})();

function conSurimpression(c,dpr,W,H){
  if(!CON.actif||ANT.vue==="3d")return;
  conPeindreGrille(c,dpr);
  conPeindreChoisie(c,dpr);
  conPeindreCourant(c,dpr);
  conPeindreDecoupes(c,dpr);
}

/* La grille. Elle ne se dessine que quand elle se lit : sous six pixels de
   pas, un quadrillage devient un aplat gris qui masque le cuivre au lieu de
   le situer. */
function conPeindreGrille(c,dpr){
  const g=CON.grille;
  if(!(g>0))return;
  /* Un pas de grille trop fin pour l'écran est remplacé par son premier
     multiple lisible, dans la suite 1-2-5 : la grille reste juste, elle
     s'éclaircit seulement. En dessous de six pixels, un quadrillage n'est
     plus un repère mais un aplat gris qui masque le cuivre. */
  let pas=0;
  for(const m of CON_MULTIPLES){
    if(g*m*V.vue.scale>=6){ pas=g*m; break; }
  }
  if(!pas)return;

  const L=CON.carte.L, W=CON.carte.W;
  poserMonde(c,dpr);
  c.save();
  c.strokeStyle="rgba(140,150,165,0.13)";
  c.lineWidth=0.7/V.vue.scale;
  c.stroke(conGrilleChemin(pas,L,W));
  c.restore();
}

/* LE QUADRILLAGE EST RETENU, comme les chemins de la visionneuse et ceux de
   la surimpression (15-overlay2d.js) : il ne dépend que du pas retenu et de
   la carte, pas de l'image. Le pas, lui, change par PALIERS — il suit la
   suite 1-2-5 et ne bouge qu'en franchissant six pixels —, si bien qu'un zoom
   continu ne reconstruit le chemin qu'aux quelques instants où le dessin
   change vraiment. */
const CON_GRILLE_CHEMIN={cle:"", chemin:null};

function conGrilleChemin(pas,L,W){
  const cle=pas+"|"+L+"|"+W;
  if(CON_GRILLE_CHEMIN.cle===cle)return CON_GRILLE_CHEMIN.chemin;
  const p=new Path2D();
  for(let x=0;x<=L+1e-9;x+=pas){ p.moveTo(x,0); p.lineTo(x,W); }
  for(let y=0;y<=W+1e-9;y+=pas){ p.moveTo(0,y); p.lineTo(L,y); }
  CON_GRILLE_CHEMIN.cle=cle; CON_GRILLE_CHEMIN.chemin=p;
  return p;
}

/* La forme choisie : un liseré, pas un aplat. On doit continuer de voir le
   cuivre — c'est lui qu'on est en train de régler. */
function conPeindreChoisie(c,dpr){
  const el=CON.elements[CON.sel];
  if(!el)return;
  poserMonde(c,dpr);
  c.save();
  c.strokeStyle="#f2c744";
  c.lineWidth=2/V.vue.scale;
  c.setLineDash([5/V.vue.scale,3/V.vue.scale]);
  const b=conBoite(el);
  c.strokeRect(b.x1,b.y1,b.x2-b.x1,b.y2-b.y1);
  c.restore();
}

/* Les découpes : elles ne posent pas de cuivre, donc rien ne les dessine — et
   une fente invisible est une fente qu'on croit avoir faite. Un hachurage
   suffit à dire « ici, il n'y a plus de métal ». */
function conPeindreDecoupes(c,dpr){
  const liste=CON.elements.filter(el=>el.trou);
  if(!liste.length)return;
  poserMonde(c,dpr);
  c.save();
  c.strokeStyle="#e8443a";
  c.lineWidth=1.2/V.vue.scale;
  c.setLineDash([3/V.vue.scale,2/V.vue.scale]);
  for(const el of liste){
    const p=conContour(el);
    if(!p)continue;
    c.beginPath();
    for(let i=0;i+1<p.length;i+=2)
      i?c.lineTo(p[i],p[i+1]):c.moveTo(p[i],p[i+1]);
    c.closePath();
    c.stroke();
  }
  c.restore();
}

/* La forme en cours. En jaune, comme tout ce qui n'est pas encore décidé. */
function conPeindreCourant(c,dpr){
  const k=CON.courant;
  if(!k)return;
  poserMonde(c,dpr);
  c.save();
  c.strokeStyle="#f2c744";
  c.fillStyle="rgba(242,199,68,0.16)";
  c.lineWidth=1.5/V.vue.scale;

  if(k.type==="rect"){
    const x=Math.min(k.x1,k.x2), y=Math.min(k.y1,k.y2);
    c.fillRect(x,y,Math.abs(k.x2-k.x1),Math.abs(k.y2-k.y1));
    c.strokeRect(x,y,Math.abs(k.x2-k.x1),Math.abs(k.y2-k.y1));
  }else if(k.type==="disque"){
    c.beginPath(); c.arc(k.cx,k.cy,Math.max(k.r,1e-6),0,2*Math.PI);
    c.fill(); c.stroke();
  }else if(k.pts){
    c.beginPath();
    k.pts.forEach((q,i)=>i?c.lineTo(q[0],q[1]):c.moveTo(q[0],q[1]));
    if(k.apercu)c.lineTo(k.apercu[0],k.apercu[1]);
    if(k.type==="poly"&&k.pts.length>=2){ c.closePath(); c.fill(); }
    /* La piste se montre à SA LARGEUR : une polyligne d'un pixel ne dit pas
       si la ligne d'alimentation fait 1 mm ou 3, et c'est la seule chose qui
       compte pour son impédance. */
    c.lineWidth=(k.type==="piste")?Math.max(CON.largeur,0.05)
                                  :1.5/V.vue.scale;
    c.lineCap="round"; c.lineJoin="round";
    c.stroke();
    c.lineWidth=1.2/V.vue.scale;
    for(const q of k.pts){
      c.beginPath();
      c.arc(q[0],q[1],3/V.vue.scale,0,2*Math.PI);
      c.stroke();
    }
  }
  c.restore();
}
