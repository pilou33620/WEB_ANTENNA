"use strict";
/* =============================================================================
   Antenne openEMS — 15-overlay2d.js
   Ce que la simulation ajoute sur la vue de dessus.

   TROIS CHOSES, ET PAS UNE DE PLUS :
     — le cuivre RETENU, peint par-dessus le reste, pour qu'on voie d'un coup
       d'œil ce qui part au solveur et ce qui n'y va pas ;
     — l'emprise de la boîte d'air et celle de la PML, en plan ;
     — le port, là où il est posé.

   LE MOYEN : `peindre` (03-rendu.js) est une fonction déclarée à la portée
   globale d'un script classique — c'est donc une propriété de l'objet global,
   et `dessiner()` la résout par la chaîne de portée. On l'enveloppe ici plutôt
   que d'ajouter une ligne dans 03-rendu.js : ce fichier appartient à la
   visionneuse, il évoluera de son côté, et une modification locale se
   perdrait à la première mise à jour. L'enveloppe, elle, survit.
   ============================================================================= */

(function(){
  const base=window.peindre;
  if(typeof base!=="function")return;
  window.peindre=function(c,dpr,W,H){
    base(c,dpr,W,H);
    try{ antSurimpression(c,dpr,W,H); }
    catch(e){ /* une surimpression ne doit jamais empêcher la carte de s'afficher */ }
  };
})();

function antSurimpression(c,dpr,W,H){
  if(!V.modele||ANT.vue==="3d")return;
  antPeindreRetenu(c,dpr);
  antPeindreObjets(c,dpr);
  antPeindreBoite(c,dpr);
  antPeindreMaillage(c,dpr);
  antPeindrePort(c,dpr);
}

/* -------------------------------------------------------------------------
   Les objets hors carte, vus de dessus
   -------------------------------------------------------------------------
   EN TRAIT SEUL, JAMAIS EN PLEIN. Vu de dessus, un boîtier recouvre la carte
   entière : le peindre masquerait exactement ce qu'on est venu regarder. Le
   contour suffit à dire « il y a quelque chose ici », et la vue 3D dit à
   quelle hauteur.
   ------------------------------------------------------------------------- */
/* DEUX CHEMINS, UN PAR COULEUR, construits une fois — même raison que pour le
   cuivre retenu plus bas : ce sont les objets du modèle, ils ne bougent qu'avec
   lui, et les redécrire à chaque image était du travail rendu au navigateur
   pour un dessin identique. Le pointillé, lui, reste posé sur le contexte à
   chaque image : son pas est en unités du monde, il DOIT suivre le zoom. */
/* LA CLÉ EST LE MODÈLE ENTIER, et non sa seule liste de primitives : les
   pièces importées (33-pieces.js) y sont peintes aussi, et le modèle est un
   objet neuf à chaque réponse du serveur. */
const ANT_OBJETS_CHEMINS={m:null, k:0, metal:null, autre:null};

function antObjetsChemins(m,k){
  if(ANT_OBJETS_CHEMINS.m===m&&ANT_OBJETS_CHEMINS.k===k)
    return ANT_OBJETS_CHEMINS;
  const metal=new Path2D(), autre=new Path2D();
  /* Les pièces importées : le rectangle de chaque corps simulé. Un contour
     exact de boîtier vu de dessus ne dirait rien de plus que son emprise, et
     il coûterait cent mille segments à chaque image. */
  if(typeof antPiecesEmpreintes==="function")
    for(const e of antPiecesEmpreintes(m,k))(e.metal?metal:autre).rect(e.x,e.y,e.w,e.h);
  for(const o of (m.primitives||[])){
    const p=(o.materiau==="metal")?metal:autre;
    if(o.type==="boite"){
      p.rect(o.a[0]*k,o.a[1]*k,(o.b[0]-o.a[0])*k,(o.b[1]-o.a[1])*k);
    }else if(o.type==="sphere"){
      p.moveTo((o.c[0]+o.r)*k,o.c[1]*k);
      p.arc(o.c[0]*k,o.c[1]*k,o.r*k,0,2*Math.PI);
    }else if(o.type==="cylindre"){
      p.moveTo(o.a[0]*k,o.a[1]*k); p.lineTo(o.b[0]*k,o.b[1]*k);
      p.moveTo((o.a[0]+o.r)*k,o.a[1]*k);
      p.arc(o.a[0]*k,o.a[1]*k,o.r*k,0,2*Math.PI);
    }else{
      o.pts.forEach((q,i)=>i?p.lineTo(q[0]*k,q[1]*k):p.moveTo(q[0]*k,q[1]*k));
      /* Un fil vertical se projette en UN POINT : sans ce cercle, il
         disparaîtrait de la vue de dessus alors qu'il est bien dans le
         modèle. */
      const r=Math.max(o.r,0.3)*k;
      p.moveTo(o.pts[0][0]*k+r,o.pts[0][1]*k);
      p.arc(o.pts[0][0]*k,o.pts[0][1]*k,r,0,2*Math.PI);
    }
  }
  ANT_OBJETS_CHEMINS.m=m; ANT_OBJETS_CHEMINS.k=k;
  ANT_OBJETS_CHEMINS.metal=metal; ANT_OBJETS_CHEMINS.autre=autre;
  return ANT_OBJETS_CHEMINS;
}

function antPeindreObjets(c,dpr){
  const m=ANT.modele;
  if(!m||!((m.primitives||[]).length||(m.pieces||[]).length))return;
  const k=(V.unite==="in")?(1/25.4):1;
  const ch=antObjetsChemins(m,k);
  poserMonde(c,dpr);
  c.save();
  c.lineWidth=1.2/V.vue.scale;
  c.setLineDash([4/V.vue.scale,3/V.vue.scale]);
  c.strokeStyle="#c8ccd2"; c.stroke(ch.metal);
  c.strokeStyle="#8af0ff"; c.stroke(ch.autre);
  c.restore();
}

/* -------------------------------------------------------------------------
   Le cuivre retenu
   -------------------------------------------------------------------------
   Il est peint EN BLANC TRANSLUCIDE et non dans une couleur à lui : la carte
   porte déjà une couleur par couche, et en ajouter une quatorzième ferait de
   la mise en évidence un motif de plus au lieu d'une réponse. Le blanc à
   faible opacité éclaircit sans effacer — on continue de lire de quelle
   couche il s'agit.
   ------------------------------------------------------------------------- */
/* LES CHEMINS SONT RETENUS, ET C'EST LA MOITIÉ QUI MANQUAIT. 11-geometrie.js
   garde déjà le RÉSULTAT de `antCuivreDuModele` — les tableaux de sommets ne
   sont plus recalculés à chaque image. Mais les Path2D qu'on en tirait, eux,
   l'étaient : un `new Path2D()` par bloc et un parcours de tous les sommets,
   soixante fois par seconde pendant un déplacement. Sur un plan de masse
   découpé à quelques milliers de sommets, c'est exactement ce que la
   visionneuse évite depuis toujours en construisant ses chemins UNE FOIS
   (`mdlChemins`, 02-modele.js) — la surimpression était le seul endroit qui
   avait échappé à la règle, et c'est pour cela qu'une carte lourde traînait
   ici et pas dans WEB_CAO.

   LA CLÉ EST L'IDENTITÉ DU CUIVRE, et il n'en faut pas d'autre. Tant que
   `antCuivreDuModele()` rend le MÊME objet, sa géométrie n'a pas bougé : ses
   deux clés à lui — l'âge de l'état et l'identité de la carte — sont déjà la
   bonne réponse à « qu'est-ce qui a changé ». En recopier les conditions ici
   ferait deux vérités pour une seule question, et la seconde finirait par
   dater. */
const ANT_RETENU_CHEMINS={cuivre:null, chemins:null};

function antRetenuChemins(cu){
  if(ANT_RETENU_CHEMINS.cuivre===cu)return ANT_RETENU_CHEMINS.chemins;
  const chemins=cu.blocs.map(function(bloc){
    const p=new Path2D();
    for(const poly of bloc.polys){
      mdlPolyDans(p,poly.o);
      for(const t of (poly.t||[]))mdlPolyDans(p,t);
    }
    return p;
  });
  ANT_RETENU_CHEMINS.cuivre=cu;
  ANT_RETENU_CHEMINS.chemins=chemins;
  return chemins;
}

function antPeindreRetenu(c,dpr){
  if(!ANT.nets.size&&!ANT.formes.length&&ANT.netMasse<0)return;
  const cu=antCuivreDuModele();
  if(!cu.blocs.length)return;

  poserMonde(c,dpr);
  c.save();
  c.fillStyle="rgba(255,255,255,0.30)";
  for(const p of antRetenuChemins(cu))c.fill(p,"evenodd");
  c.restore();
}

/* -------------------------------------------------------------------------
   La boîte et la PML, vues de dessus
   ------------------------------------------------------------------------- */
function antPeindreBoite(c,dpr){
  const m=ANT.modele;
  if(!m)return;
  /* Le modèle est en millimètres ; la carte est dans l'unité du fichier. */
  const k=(V.unite==="in")?(1/25.4):1;
  const b=m.boite;
  poserMonde(c,dpr);
  c.save();
  c.lineWidth=1.4/V.vue.scale;
  c.strokeStyle="#3fa0ea";
  c.setLineDash([]);
  c.strokeRect(b.x1*k,b.y1*k,(b.x2-b.x1)*k,(b.y2-b.y1)*k);

  /* L'epaisseur de la PML est celle que le serveur a calculee : la
     recalculer ici ferait deux verites pour une seule grandeur. */
  const e=(b.ep_pml||b.pml*m.resolution.air)*k;
  if((b.x2-b.x1)*k>2.2*e&&(b.y2-b.y1)*k>2.2*e){
    c.strokeStyle="#e8443a";
    c.setLineDash([6/V.vue.scale,4/V.vue.scale]);
    c.strokeRect(b.x1*k+e,b.y1*k+e,(b.x2-b.x1)*k-2*e,(b.y2-b.y1)*k-2*e);
  }
  c.restore();

  /* L'étiquette en pixels et non en unités du monde : une légende qui
     grossit avec le zoom devient illisible dès qu'on s'approche.

     `setTransform(dpr, …)` ET NON `setTransform(1, …)` : `w2s` rend des
     pixels CSS — il est bâti sur `V.vue.scale/ox/oy`, qui le sont — alors que
     la toile est en pixels physiques. Sans le facteur, tout ce qu'on place
     par `w2s` atterrit à la moitié de sa place sur un écran à densité double,
     et nulle part ailleurs. C'est la convention que suit `peindreTextes`. */
  c.setTransform(dpr,0,0,dpr,0,0);
  const a=w2s(b.x1*k,b.y2*k);
  c.save();
  c.font='11px "JetBrains Mono","SF Mono",Consolas,monospace';
  c.fillStyle="#3fa0ea";
  c.textBaseline="bottom";
  c.fillText("boîte de calcul — marge "+
             (Math.min(b.mx,b.my)*k).toFixed(1).replace(".",",")+" "+antUnite()+
             " dont "+((b.ep_pml||0)*k).toFixed(1).replace(".",",")+" de PML",
             a.x+6,a.y-6);
  c.restore();
}

/* -------------------------------------------------------------------------
   Le maillage FDTD (grille Yee), vu de dessus
   -------------------------------------------------------------------------
   UNE GRILLE FINE EN COMPTE DES MILLIERS DE LIGNES, et c'est justement quand
   elle est fine qu'on l'affiche pour la juger. La décrire à chaque image
   revenait à dicter au navigateur, soixante fois par seconde, un dessin qui
   ne change qu'avec le maillage. Il est donc retenu comme les autres : les
   tableaux de coordonnées viennent du serveur, et leur identité suffit à dire
   qu'ils n'ont pas bougé. L'emprise de la boîte entre dans la clé — elle
   grandit avec les marges sans que le maillage change de tableau.
   ------------------------------------------------------------------------- */
const ANT_MAILLAGE_CHEMIN={mx:null, my:null, cle:"", chemin:null};

function antMaillageChemin(mx,my,k,x1,y1,x2,y2){
  const cle=k+"|"+x1+"|"+y1+"|"+x2+"|"+y2;
  if(ANT_MAILLAGE_CHEMIN.mx===mx&&ANT_MAILLAGE_CHEMIN.my===my&&
     ANT_MAILLAGE_CHEMIN.cle===cle)
    return ANT_MAILLAGE_CHEMIN.chemin;
  const p=new Path2D();
  for(let i=0;i<mx.length;i++){
    const x=mx[i]*k;
    p.moveTo(x,y1); p.lineTo(x,y2);
  }
  for(let j=0;j<my.length;j++){
    const y=my[j]*k;
    p.moveTo(x1,y); p.lineTo(x2,y);
  }
  ANT_MAILLAGE_CHEMIN.mx=mx; ANT_MAILLAGE_CHEMIN.my=my;
  ANT_MAILLAGE_CHEMIN.cle=cle; ANT_MAILLAGE_CHEMIN.chemin=p;
  return p;
}

function antPeindreMaillage(c,dpr){
  if(!ANT.vueMaillage)return;
  const m=ANT.modele;
  if(!m||!m.maillage||!m.maillage.x||!m.maillage.y)return;
  const k=(V.unite==="in")?(1/25.4):1;
  const b=m.boite;
  const x1=b.x1*k, x2=b.x2*k;
  const y1=b.y1*k, y2=b.y2*k;
  const mx=m.maillage.x, my=m.maillage.y;

  poserMonde(c,dpr);
  c.save();
  c.lineWidth=0.75/V.vue.scale;
  c.strokeStyle="rgba(63, 160, 234, 0.28)";
  c.stroke(antMaillageChemin(mx,my,k,x1,y1,x2,y2));
  c.restore();

  /* Étiquette en pixels CSS dans le coin supérieur gauche */
  c.setTransform(dpr,0,0,dpr,0,0);
  const a=w2s(x1,y1);
  c.save();
  c.font='10px "JetBrains Mono","SF Mono",Consolas,monospace';
  c.fillStyle="#3fa0ea";
  c.textBaseline="bottom";
  c.fillText("grille FDTD : "+mx.length+" × "+my.length+" lignes (X × Y)"+
             (m.estimation?" · "+(m.estimation.cellules||0).toLocaleString("fr-FR")+" cellules":""),
             a.x+6,a.y-6);
  c.restore();
}

function antBasculerVueMaillage(force){
  ANT.vueMaillage=(force!==undefined)?!!force:!ANT.vueMaillage;
  const btn=document.getElementById("bVueMaillage");
  if(btn && btn.classList && typeof btn.classList.toggle==="function")btn.classList.toggle("on",ANT.vueMaillage);
  if(ANT.vue==="3d"){
    if(typeof ant3dMaj==="function")ant3dMaj();
  }else{
    if(typeof dessiner==="function")dessiner();
  }
}

/* -------------------------------------------------------------------------
   Les ports
   -------------------------------------------------------------------------
   Une croix et un cercle, pas une tache : on doit voir le CUIVRE en dessous,
   c'est lui qui dit si le point est bien sur la piste d'alimentation. Le
   rayon est en pixels — le port fait quelques dixièmes de millimètre, il
   disparaîtrait dès qu'on dézoome.

   TOUS LES PORTS SONT DESSINÉS, et ils ne se ressemblent pas : celui qui
   excite est plein, ceux qui sont en charge sont en pointillé. C'est la
   seule différence qui compte pour lire un résultat — le S₁₁ est celui du
   plein, les S₂₁ ceux des autres —, et la cacher obligerait à rouvrir le
   panneau pour s'en souvenir. Celui qu'on règle porte un anneau de plus.
   ------------------------------------------------------------------------- */
function antPeindrePort(c,dpr){
  /* Pixels CSS : voir la note de `antPeindreBoite`. */
  c.setTransform(dpr,0,0,dpr,0,0);
  ANT.ports.forEach(function(p,i){
    if(!p.pose)return;
    const s=w2s(p.x,p.y);
    c.save();
    const R=9;
    c.strokeStyle=p.excite?"#f2c744":"#8fb8d8";
    c.lineWidth=p.excite?1.8:1.4;
    if(!p.excite)c.setLineDash([3,3]);
    c.beginPath(); c.arc(s.x,s.y,R,0,2*Math.PI); c.stroke();
    c.beginPath();
    c.moveTo(s.x-R*1.7,s.y); c.lineTo(s.x+R*1.7,s.y);
    c.moveTo(s.x,s.y-R*1.7); c.lineTo(s.x,s.y+R*1.7);
    c.stroke();
    /* Un coaxial a une gaine, et elle occupe de la place sur la carte : le
       dégagement qu'elle impose dans le plan de masse fait deux fois son
       rayon, et c'est une surface qu'on doit voir pour savoir si elle mord
       sur une piste voisine. */
    if(p.type==="coaxial"&&p.rb>0){
      const s2=w2s(p.x+p.rb,p.y);
      const rp=Math.abs(s2.x-s.x);
      if(rp>2){
        c.setLineDash([2,3]);
        c.beginPath(); c.arc(s.x,s.y,rp,0,2*Math.PI); c.stroke();
      }
    }
    if(i===ANT.portActif&&ANT.ports.length>1){
      c.setLineDash([]);
      c.lineWidth=1;
      c.beginPath(); c.arc(s.x,s.y,R+4,0,2*Math.PI); c.stroke();
    }
    c.setLineDash([]);
    c.font='11px "JetBrains Mono","SF Mono",Consolas,monospace';
    c.fillStyle=p.excite?"#f2c744":"#8fb8d8";
    c.textBaseline="top";
    const nom=(ANT.ports.length>1?"port "+(i+1)+" ":"port ");
    const txt=p.de&&p.a
      ? (nom+p.de+" → "+p.a+(p.excite?"":" (en charge)"))
      : (nom+"(couches à choisir)");
    c.fillText(txt,s.x+R*1.9,s.y+4);
    c.restore();
  });
}

/* =========================================================================
   Poser le port au clic
   -------------------------------------------------------------------------
   La capture est posée en phase CAPTURE et coupe la propagation : sans cela
   le clic servirait aussi à désigner du cuivre (04-interaction.js), et l'on
   changerait la sélection en même temps qu'on pose le port — deux effets
   pour un geste, dont un non voulu.
   ========================================================================= */
function antPosePortInstaller(){
  const cv=document.getElementById("carte");
  if(!cv)return;
  cv.addEventListener("pointerdown",function(e){
    if(!ANT.posePort||e.button!==0)return;
    e.stopPropagation();
    e.preventDefault();
    /* Pixels CSS, sans facteur de densité : `s2w` est l'inverse de `w2s`,
       et c'est ainsi que 04-interaction.js convertit ses propres clics. */
    const r=cv.getBoundingClientRect();
    const w=s2w(e.clientX-r.left, e.clientY-r.top);
    antPortEn(w.x,w.y);
  },true);
}

/* Ce que le clic apprend, en plus de deux coordonnées.

   LA LARGEUR DU PORT VIENT DE LA PISTE, PAS D'UN CHAMP. Un port plus large
   que la ligne d'alimentation court-circuite les bords ; plus étroit, il
   n'excite qu'une partie du conducteur et l'impédance d'entrée ressort trop
   haute. La prendre sous le curseur évite les deux, et c'est une mesure du
   fichier — pas une valeur par défaut.

   LES DEUX COUCHES SE DEVINENT AUSSI : celle qu'on vient de cliquer, et le
   plan de masse le plus proche en dessous. C'est la configuration de toutes
   les antennes imprimées ; les deux listes restent là pour les autres. */
function antPortEn(wx,wy){
  ANT.port.x=+wx.toFixed(4);
  ANT.port.y=+wy.toFixed(4);
  ANT.port.pose=true;

  antAntenneSousPort(wx,wy);
  const trouve=antPisteSous(wx,wy);
  if(trouve){
    if(trouve.w>0){
      ANT.port.w=+Math.max(trouve.w,0.05).toFixed(4);
      ANT.port.l=ANT.port.w;
    }
    ANT.port.de=V.couches[trouve.c]?V.couches[trouve.c].nom:ANT.port.de;
  }
  if(!ANT.port.de&&LT.cu.length)ANT.port.de=LT.cu[0].nom;
  if(!ANT.port.a)ANT.port.a=antMasseSous(ANT.port.de);

  ANT.posePort=false;
  document.body.classList.remove("pose-port");
  antMaj(true);
}

/* POSER LE PORT SUR L'ANTENNE LA DÉSIGNE, QUAND RIEN NE L'A ÉTÉ. Le geste dit
   « c'est ici qu'on alimente l'antenne » : si l'étape « Le cuivre » n'a rien
   retenu, le cuivre sous le clic — hors net de masse — est l'antenne, et le
   laisser dehors donnait un modèle fait de la seule masse, que le serveur
   refuse (« Aucune antenne designee »). On ne touche à rien quand une antenne
   est déjà désignée : ce qui a été choisi à la main ne se remplace pas au
   passage. Ni quand la masse est un fourre-tout : il porte déjà toute la
   carte, antenne comprise.

   Ce qui est trouvé entre comme le ferait « Prendre la sélection » : par son
   net quand c'en est un vrai, pièce par pièce sinon. */
function antAntenneSousPort(wx,wy){
  if(ANT.nets.size||ANT.formes.length)return null;
  if(ANT.netMasse>=0&&antNetFourreTout(ANT.netMasse))return null;
  let trouve=null;
  const prendre=function(net,f){
    if(trouve||net===ANT.netMasse)return;
    trouve=(typeof net==="number"&&net>=0&&!antNetFourreTout(net))
      ? {net:net,c:f.c} : {forme:f,c:f.c};
  };
  for(const couche of V.couches){
    if(!couche.cuivre||!ANT.couches.has(couche.i))continue;
    for(const q of couche.pads){
      if(Math.hypot(wx-q.x,wy-q.y)>Math.max((q.d||0)/2,1e-6))continue;
      prendre(q.pad?q.pad.n:-1,{k:"pad",c:q.c,o:q});
    }
    for(const p of couche.pistes){
      const demi=Math.max((p.w||0)/2,1e-6);
      for(let i=0;i+3<p.p.length;i+=2)
        if(antDistSeg(wx,wy,p.p[i],p.p[i+1],p.p[i+2],p.p[i+3])<=demi){
          prendre(p.n,{k:"piste",c:p.c,o:p}); break;
        }
    }
    for(const g of couche.plans)
      if(mdlPlanContient(g,wx,wy))prendre(g.n,{k:"plan",c:g.c,o:g});
  }
  if(!trouve)return null;
  if(trouve.forme)antAjouterFormes([trouve.forme]);
  else ANT.nets.add(trouve.net);
  antVieillir();
  if(typeof wsHint==="function")
    wsHint("Antenne désignée par le port : "+
           (trouve.forme?antFormeNom(trouve.forme)
                        :"net « "+((V.parNet[trouve.net]||{}).nom||"?")+" »")+
           ". Complétez-la à l'étape « Le cuivre » si elle a d'autres morceaux.");
  return trouve;
}

/* La piste ou la pastille de cuivre retenue qui passe sous ce point, s'il y
   en a une. On ne cherche que dans le cuivre RETENU : cliquer à côté, sur une
   piste qui n'est pas dans le modèle, ne doit pas donner sa largeur au port.

   L'ANTENNE AVANT LA MASSE. Une antenne du dessous passe sous la masse du
   dessus : au même point, la piste de masse de la couche 1 donnait au port sa
   largeur ET sa couche — un port posé sur la mauvaise face. La masse ne sert
   que si aucun cuivre de l'antenne n'est sous le clic. Un versement de
   l'antenne compte aussi, pour la couche seulement (w:0 : il n'a pas de
   largeur de piste à prêter). */
function antPisteSous(wx,wy){
  let meilleur=null, d2=Infinity;

  const piste=function(p){
    if(!ANT.couches.has(p.c))return;
    const demi=Math.max((p.w||0)/2,1e-6);
    for(let i=0;i+3<p.p.length;i+=2){
      const d=antDistSeg(wx,wy,p.p[i],p.p[i+1],p.p[i+2],p.p[i+3]);
      if(d<=demi&&d*d<d2){d2=d*d;meilleur={w:p.w,c:p.c};}
    }
  };
  const pastille=function(q){
    if(!ANT.couches.has(q.c))return;
    const r=Math.max((q.d||0)/2,1e-6);
    const d=Math.hypot(wx-q.x,wy-q.y);
    if(d<=r&&d*d<d2){d2=d*d;meilleur={w:q.d||r*2,c:q.c};}
  };
  const plan=function(g){
    if(!meilleur&&ANT.couches.has(g.c)&&mdlPlanContient(g,wx,wy))
      meilleur={w:0,c:g.c};
  };
  const parcourir=function(ni){
    const n=V.parNet[ni];
    if(!n)return;
    for(const p of n.pistes)piste(p);
    for(const q of n.pads)pastille(q);
  };

  for(const ni of ANT.nets)parcourir(ni);
  /* Les formes désignées à la main comptent autant : sur une carte sans nets,
     c'est le SEUL cuivre du modèle, et sans elles poser le port ne trouverait
     aucune largeur de piste sous le curseur. */
  for(const f of ANT.formes){
    if(f.k==="piste")piste(f.o);
    else if(f.k==="pad")pastille(f.o);
  }
  for(const ni of ANT.nets){ const n=V.parNet[ni]; if(n)for(const g of n.plans)plan(g); }
  for(const f of ANT.formes)if(f.k==="plan")plan(f.o);
  if(meilleur)return meilleur;
  if(ANT.netMasse>=0&&!ANT.nets.has(ANT.netMasse))parcourir(ANT.netMasse);
  return meilleur;
}

function antDistSeg(px,py,x1,y1,x2,y2){
  const dx=x2-x1, dy=y2-y1, L2=dx*dx+dy*dy;
  if(!(L2>0))return Math.hypot(px-x1,py-y1);
  let t=((px-x1)*dx+(py-y1)*dy)/L2;
  t=Math.max(0,Math.min(1,t));
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
}

/* Le conducteur de masse le plus proche sous celui-ci. « Le plus proche » et
   non « le dernier » : sur une carte à six couches, l'antenne du dessus
   travaille contre la couche 2, pas contre le dessous. */
function antMasseSous(nomDepart){
  const i=LT.cu.findIndex(e=>e.nom===nomDepart);
  if(i<0)return LT.cu.length?LT.cu[LT.cu.length-1].nom:"";
  for(let k=i+1;k<LT.cu.length;k++)
    if(LT.cu[k].role==="gnd")return LT.cu[k].nom;
  for(let k=i-1;k>=0;k--)
    if(LT.cu[k].role==="gnd")return LT.cu[k].nom;
  return LT.cu.length>1?LT.cu[LT.cu.length-1].nom:"";
}
