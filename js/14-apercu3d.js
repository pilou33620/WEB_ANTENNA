"use strict";
/* =============================================================================
   Antenne openEMS — 14-apercu3d.js
   Le modèle qui part au solveur, vu de l'extérieur.

   POURQUOI UNE VUE 3D DANS UN OUTIL QUI POURRAIT S'EN PASSER. Trois des cinq
   fautes qui gâchent une simulation d'antenne ne se voient PAS en 2D, parce
   qu'elles portent sur la hauteur :

     — un port posé entre les mauvaises couches (il relie la piste au plan
       d'alimentation et non à la masse : rien ne le distingue vu de dessus) ;
     — une boîte d'air trop plate (la marge est bonne en X et Y, dérisoire en
       Z — et c'est par le dessus qu'une antenne rayonne) ;
     — un via dont la portée a été supposée traversante alors qu'il est
       enterré.

   Les trois sautent aux yeux dès qu'on regarde la pile par le côté. C'est
   tout ce que cette vue sert à faire : elle ne remplace pas la 2D pour
   désigner du cuivre, et elle ne prétend pas être un rendu.

   CE QUI EST DESSINÉ EST LE MODÈLE NORMALISÉ, celui que le serveur a rendu —
   pas la carte. Si un polygone manque ici, il manquera dans la simulation.
   ============================================================================= */

const ANT3D={
  pret:false, rendu:null, scene:null, cam:null, racine:null,
  centre:null, rayon:1,
  orbite:{theta:-0.9, phi:1.05, dist:3, cx:0, cy:0, cz:0},
  clef:""                     // empreinte du dernier modèle dessiné
};

/* Les couleurs suivent celles de la 2D : le cuivre du dessus rouge, celui du
   dessous bleu. Un modèle dont les couches ne se reconnaissent pas d'une vue
   à l'autre force à recompter les couches à chaque regard. */
function ant3dCouleurCouche(nom){
  const c=V.couches.find(x=>x.nom===nom);
  return c?parseInt(c.couleur.slice(1),16):0xcc8844;
}

function ant3dInit(){
  if(ANT3D.pret)return true;
  if(typeof THREE==="undefined")return false;
  const cv=document.getElementById("vue3d");
  if(!cv)return false;

  ANT3D.rendu=new THREE.WebGLRenderer({canvas:cv,antialias:true});
  ANT3D.rendu.setClearColor(0x0b0c0d,1);
  ANT3D.scene=new THREE.Scene();
  ANT3D.cam=new THREE.PerspectiveCamera(38,1,0.01,100000);

  /* Deux sources et un fond : assez pour que les faces se distinguent, pas
     assez pour qu'on croie regarder une image de synthèse. Une pièce de
     cuivre qui brille joliment n'apprend rien de plus qu'une pièce mate. */
  ANT3D.scene.add(new THREE.AmbientLight(0xffffff,0.55));
  const d1=new THREE.DirectionalLight(0xffffff,0.7); d1.position.set(1,1,2);
  const d2=new THREE.DirectionalLight(0x88bbff,0.35); d2.position.set(-2,-1,0.5);
  ANT3D.scene.add(d1); ANT3D.scene.add(d2);

  /* DEUX GROUPES, DEUX REPÈRES. `monde` est l'assemblage : les pièces y sont
     dessinées là où on les a posées. `racine` est la CARTE et tout ce qui
     part au solveur avec elle — substrat, cuivre, ports, boîte d'air,
     grille : il porte la position et la rotation de la carte dans
     l'assemblage (`ANT.carte3d`, voir 33-pieces.js). La grille FDTD est
     toujours alignée sur la carte ; c'est l'assemblage qui tourne autour. */
  ANT3D.monde=new THREE.Group();
  ANT3D.scene.add(ANT3D.monde);
  ANT3D.racine=new THREE.Group();
  ANT3D.monde.add(ANT3D.racine);

  ant3dSouris(cv);
  ANT3D.pret=true;
  return true;
}

/* --------------------------------------------------------------------------
   La caméra : la navigation de WEB_3D
   --------------------------------------------------------------------------
   LES MÊMES GESTES QUE LA VISIONNEUSE WEB_3D (son préréglage par défaut,
   celui d'Onshape), pour qu'on n'ait pas à changer de mains en passant d'un
   outil à l'autre :

     clic droit glissé          tourner
     bouton du milieu glissé    déplacer        (aussi Ctrl + clic droit)
     Maj + clic droit glissé    zoomer
     molette                    zoomer VERS LE CURSEUR
     double-clic                le point visé devient le centre de rotation ;
                                dans le vide, la vue se recadre
     tactile                    un doigt tourne, deux doigts déplacent et pincent

   Et, parce qu'ici le clic gauche ne sert pas à tracer un rectangle de
   sélection : le glisser GAUCHE tourne aussi, Maj + gauche déplace. Un clic
   gauche sans glisser reste un clic — il choisit une pièce (34-placement.js).

   L'ORBITE GARDE Z EN HAUT — l'orbite « contrainte » de WEB_3D. Une carte a
   un dessus et un dessous, et c'est par eux qu'on la lit : la retourner sans
   le vouloir fait perdre le sens de l'empilage.

   CE QUI N'ALLAIT PAS AVANT, et que le panoramique de WEB_3D règle : le
   glisser horizontal poussait le centre le long de la direction du REGARD
   (cos θ, sin θ) au lieu de la droite de l'écran, et le glisser vertical ne
   montait qu'en z quel que soit l'angle de vue. On croyait se déplacer, on
   s'enfonçait. Ici un pixel de souris vaut un pixel de modèle, le long des
   axes de l'écran. Et le clic droit n'ouvre plus le menu du navigateur.
   -------------------------------------------------------------------------- */
const ANT3D_NAV={geste:null, x:0, y:0, xd:0, yd:0, t0:0, pris:false,
                 pointeurs:new Map(), pince:null, vO:{x:0,y:0}, vP:{x:0,y:0},
                 anim:null, boucle:0};

function ant3dGeste(e){
  const b=e.button;
  if(b===1)return (e.shiftKey)?"orbite":"pano";
  if(b===2){
    if(e.ctrlKey||e.metaKey)return "pano";
    if(e.shiftKey)return "zoom";
    return "orbite";
  }
  if(b===0)return (e.shiftKey||e.ctrlKey||e.metaKey)?"pano":"orbite";
  return null;
}

/* Tourner autour du centre, Z en haut. */
function ant3dOrbiter(dx,dy){
  const o=ANT3D.orbite;
  o.theta-=dx*0.006;
  /* Le pôle est interdit d'un cheveu : à l'aplomb exact, la vue se
     retournerait et l'on ne saurait plus où est le dessus de la carte. */
  o.phi=Math.max(1e-3,Math.min(Math.PI-1e-3,o.phi-dy*0.006));
  ant3dPoserCamera();
}

/* Déplacer le long des axes DE L'ÉCRAN : un pixel de souris vaut un pixel de
   modèle à la distance du centre visé. */
function ant3dDeplacer(dx,dy){
  const cv=document.getElementById("vue3d");
  const h=(cv&&cv.clientHeight)||1;
  const o=ANT3D.orbite, cam=ANT3D.cam;
  cam.updateMatrixWorld();
  const k=2*Math.tan(cam.fov*Math.PI/360)*ANT3D.rayon*o.dist/h;
  const e=cam.matrixWorld.elements;
  const droite=[e[0],e[1],e[2]], haut=[e[4],e[5],e[6]];
  o.cx+=-dx*k*droite[0]+dy*k*haut[0];
  o.cy+=-dx*k*droite[1]+dy*k*haut[1];
  o.cz+=-dx*k*droite[2]+dy*k*haut[2];
  ant3dPoserCamera();
}

/* Le point de la scène sous le curseur : ce que le rayon touche, sinon le
   plan face à l'écran qui passe par le centre visé. */
function ant3dSousCurseur(e){
  const cv=document.getElementById("vue3d");
  const r=cv.getBoundingClientRect();
  const ndc={x:((e.clientX-r.left)/r.width)*2-1, y:-((e.clientY-r.top)/r.height)*2+1};
  const rc=ANT3D.rayonNav||(ANT3D.rayonNav=new THREE.Raycaster());
  ANT3D.cam.updateMatrixWorld();
  rc.setFromCamera(ndc,ANT3D.cam);
  const cibles=[];
  (ANT3D.monde||ANT3D.racine).traverse(function(o){ if(o.isMesh&&o.visible)cibles.push(o); });
  const plan=(typeof PL!=="undefined")?PL.plan:null;
  const hits=rc.intersectObjects(cibles,false).filter(h=>!plan||plan.distanceToPoint(h.point)>=0);
  if(hits.length)return hits[0].point.clone();
  const o=ANT3D.orbite, n=new THREE.Vector3();
  ANT3D.cam.getWorldDirection(n);
  const p=new THREE.Vector3();
  const pl=new THREE.Plane().setFromNormalAndCoplanarPoint(n,new THREE.Vector3(o.cx,o.cy,o.cz));
  return rc.ray.intersectPlane(pl,p)?p:null;
}

/* Zoomer ; avec un évènement, VERS LE CURSEUR : le centre glisse vers ce qui
   est sous la souris, et c'est ainsi qu'on plonge dans un détail — une
   pastille, un bossage — sans recadrer à la main. */
function ant3dZoomer(f,e){
  const o=ANT3D.orbite;
  const d=Math.max(0.002,Math.min(200,o.dist*f));
  const reel=d/o.dist;
  if(e){
    const p=ant3dSousCurseur(e);
    if(p){
      o.cx+=(p.x-o.cx)*(1-reel);
      o.cy+=(p.y-o.cy)*(1-reel);
      o.cz+=(p.z-o.cz)*(1-reel);
    }
  }
  o.dist=d;
  ant3dPoserCamera();
}

/* L'inertie et les animations : une seule boucle, qui s'arrête d'elle-même
   quand plus rien ne bouge. */
function ant3dAnimer(){
  if(ANT3D_NAV.boucle)return;
  let avant=performance.now();
  const pas=function(t){
    const dt=Math.min(0.05,(t-avant)/1000); avant=t;
    const N=ANT3D_NAV;
    let encore=false;
    if(N.anim){
      const a=N.anim;
      a.t=Math.min(1,a.t+dt/a.duree);
      const k=a.t<0.5?4*a.t*a.t*a.t:1-Math.pow(-2*a.t+2,3)/2;
      const o=ANT3D.orbite;
      o.cx=a.de[0]+(a.a[0]-a.de[0])*k;
      o.cy=a.de[1]+(a.a[1]-a.de[1])*k;
      o.cz=a.de[2]+(a.a[2]-a.de[2])*k;
      /* La caméra NE BOUGE PAS : c'est le regard qui tourne vers le nouveau
         centre. Angles et distance se recalculent depuis sa place. */
      const dx=a.cam[0]-o.cx, dy=a.cam[1]-o.cy, dz=a.cam[2]-o.cz;
      const L=Math.max(1e-9,Math.hypot(dx,dy,dz));
      o.theta=Math.atan2(dy,dx);
      o.phi=Math.max(1e-3,Math.min(Math.PI-1e-3,Math.acos(Math.max(-1,Math.min(1,dz/L)))));
      o.dist=L/Math.max(1e-9,ANT3D.rayon);
      ant3dPoserCamera();
      if(a.t>=1)N.anim=null; else encore=true;
    }
    if(!N.geste){
      const frein=Math.pow(0.0025,dt);
      if(Math.hypot(N.vO.x,N.vO.y)>0.15){
        N.vO.x*=frein; N.vO.y*=frein;
        ant3dOrbiter(N.vO.x*dt*12,N.vO.y*dt*12); encore=true;
      }else N.vO.x=N.vO.y=0;
      if(Math.hypot(N.vP.x,N.vP.y)>0.15){
        N.vP.x*=frein; N.vP.y*=frein;
        ant3dDeplacer(N.vP.x*dt*12,N.vP.y*dt*12); encore=true;
      }else N.vP.x=N.vP.y=0;
    }
    N.boucle=encore?requestAnimationFrame(pas):0;
  };
  ANT3D_NAV.boucle=requestAnimationFrame(pas);
}

/* Le point visé devient le centre de rotation, sans que la caméra change de
   place : c'est le geste qui évite de tourner autour du vide. */
function ant3dPivoter(p){
  const o=ANT3D.orbite, c=ANT3D.cam.position;
  ANT3D_NAV.anim={t:0, duree:0.35, de:[o.cx,o.cy,o.cz], a:[p.x,p.y,p.z],
                  cam:[c.x,c.y,c.z]};
  ant3dAnimer();
}

function ant3dPince(){
  const [a,b]=[...ANT3D_NAV.pointeurs.values()];
  return {d:Math.hypot(a.x-b.x,a.y-b.y), cx:(a.x+b.x)/2, cy:(a.y+b.y)/2};
}

/* LES PIÈCES PASSENT D'ABORD (34-placement.js). Un geste qu'elles prennent —
   saisir la pièce choisie pour la déplacer, cliquer un point à accrocher —
   n'arrive pas à la caméra ; tous les autres, si. Et un clic gauche sans
   glisser leur est rendu : c'est ainsi qu'on choisit une pièce. */
function ant3dPlace(quoi,e){
  return typeof antPlacePointeur==="function"&&antPlacePointeur(quoi,e);
}

function ant3dSouris(cv){
  const N=ANT3D_NAV;
  /* Sans cela, le clic droit ouvre le menu du navigateur au milieu du geste,
     et le bouton du milieu lance son défilement automatique. */
  cv.addEventListener("contextmenu",function(e){ e.preventDefault(); });
  cv.addEventListener("pointerdown",function(e){
    try{ cv.setPointerCapture(e.pointerId); }catch(err){}
    N.pointeurs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    N.xd=e.clientX; N.yd=e.clientY; N.t0=performance.now();
    N.x=e.clientX; N.y=e.clientY;
    N.anim=null; N.vO.x=N.vO.y=N.vP.x=N.vP.y=0;
    if(e.pointerType==="touch"&&N.pointeurs.size===2){
      N.geste=null; N.pris=false; N.pince=ant3dPince();
      return;
    }
    N.pris=ant3dPlace("down",e);
    if(N.pris){ N.geste=null; return; }
    N.geste=(e.pointerType==="touch")?"orbite":ant3dGeste(e);
    N.bouton=e.button;
    if(e.button===1||e.button===2)e.preventDefault();
    if(N.geste)cv.classList.add(N.geste==="pano"?"pano":"orbite");
  });
  const finir=function(e){
    try{ cv.releasePointerCapture(e.pointerId); }catch(err){}
    N.pointeurs.delete(e.pointerId);
    if(N.pointeurs.size<2)N.pince=null;
    cv.classList.remove("pano","orbite");
    if(N.pris){ N.pris=false; ant3dPlace("up",e); return; }
    const clic=N.geste&&N.bouton===0&&e.type==="pointerup"&&
               Math.hypot(e.clientX-N.xd,e.clientY-N.yd)<4&&performance.now()-N.t0<600;
    N.geste=null;
    /* LE SECOND CLIC D'UN DOUBLE-CLIC N'EST PAS UN CLIC. Il servait deux fois :
       au placement, qui prenait alors la pièce DERRIÈRE — ou exécutait une
       accroche en mode Accrocher, sur ce qui était dessous —, et au
       double-clic, qui pose le centre de rotation. Un clic qui suit le
       précédent de moins de 350 ms, au même endroit, appartient au
       double-clic : il ne va qu'à lui. */
    if(clic){
      const t=performance.now(), d=N.dernier;
      const double=d&&t-d.t<350&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<6;
      N.dernier=double?null:{t:t, x:e.clientX, y:e.clientY};
      if(!double)ant3dPlace("clic",e);
    }
    else ant3dAnimer();                 // l'inertie prend le relais
  };
  cv.addEventListener("pointerup",finir);
  cv.addEventListener("pointercancel",finir);
  cv.addEventListener("pointermove",function(e){
    const p=N.pointeurs.get(e.pointerId);
    if(p){ p.x=e.clientX; p.y=e.clientY; }
    if(N.pince&&N.pointeurs.size===2){
      const q=ant3dPince(), a=N.pince;
      if(a.d>1&&q.d>1)ant3dZoomer(a.d/q.d,null);
      ant3dDeplacer(q.cx-a.cx,q.cy-a.cy);
      N.pince=q;
      return;
    }
    if(N.pris){ ant3dPlace("glisse",e); return; }
    if(!N.geste){ ant3dPlace("survol",e); return; }
    const dx=e.clientX-N.x, dy=e.clientY-N.y;
    N.x=e.clientX; N.y=e.clientY;
    if(N.geste==="orbite"){ ant3dOrbiter(dx,dy); N.vO.x=dx; N.vO.y=dy; }
    else if(N.geste==="pano"){ ant3dDeplacer(dx,dy); N.vP.x=dx; N.vP.y=dy; }
    else if(N.geste==="zoom")ant3dZoomer(Math.pow(1.005,dy),null);
  });
  cv.addEventListener("wheel",function(e){
    e.preventDefault();
    let d=e.deltaY;
    if(e.deltaMode===1)d*=16; else if(e.deltaMode===2)d*=100;
    /* Le pincement d'un pavé tactile arrive en molette + Ctrl, à petits pas :
       on le rend plus vif pour qu'il suive les doigts. */
    const pince=e.ctrlKey&&e.deltaMode===0&&Math.abs(e.deltaY)<50;
    ant3dZoomer(Math.pow(0.9988,-d*(pince?2.2:1)),e);
  },{passive:false});
  cv.addEventListener("dblclick",function(e){
    const p=ant3dSousCurseur(e);
    /* Sur la géométrie, le point devient le centre ; dans le vide, on
       recadre tout. */
    const cibles=[];
    (ANT3D.monde||ANT3D.racine).traverse(function(o){ if(o.isMesh&&o.visible)cibles.push(o); });
    const rc=ANT3D.rayonNav;
    if(p&&rc&&rc.intersectObjects(cibles,false).length)ant3dPivoter(p);
    else ant3dCadrer();
  });
}

function ant3dPoserCamera(){
  const o=ANT3D.orbite, R=ANT3D.rayon*o.dist;
  ANT3D.cam.position.set(
    o.cx+R*Math.sin(o.phi)*Math.cos(o.theta),
    o.cy+R*Math.sin(o.phi)*Math.sin(o.theta),
    o.cz+R*Math.cos(o.phi));
  ANT3D.cam.up.set(0,0,1);            // z vers le haut, comme l'empilage
  ANT3D.cam.lookAt(o.cx,o.cy,o.cz);
  ant3dDessiner();
}

function ant3dCadrer(){
  ANT3D.orbite.cx=0; ANT3D.orbite.cy=0; ANT3D.orbite.cz=0;
  ANT3D.orbite.dist=2.6; ANT3D.orbite.theta=-0.9; ANT3D.orbite.phi=1.05;
  ant3dPoserCamera();
}

function ant3dTaille(){
  const cv=document.getElementById("vue3d");
  if(!cv||!ANT3D.pret)return;
  const r=cv.parentElement.getBoundingClientRect();
  const dpr=Math.min(2,window.devicePixelRatio||1);
  ANT3D.rendu.setPixelRatio(dpr);
  ANT3D.rendu.setSize(Math.max(1,r.width),Math.max(1,r.height),false);
  ANT3D.cam.aspect=Math.max(0.01,r.width/Math.max(1,r.height));
  ANT3D.cam.updateProjectionMatrix();
  ant3dDessiner();
}

function ant3dDessiner(){
  if(!(ANT3D.pret&&ANT3D.scene&&ANT3D.cam))return;
  /* Le manipulateur garde la même taille à l'écran quel que soit le zoom. */
  if(typeof antPlaceAvantRendu==="function")antPlaceAvantRendu();
  ANT3D.rendu.render(ANT3D.scene,ANT3D.cam);
}

/* --------------------------------------------------------------------------
   La construction
   -------------------------------------------------------------------------- */
/* Une empreinte du modèle : tant qu'elle ne change pas, on ne reconstruit
   rien. Reconstruire une scène de plusieurs milliers de polygones à chaque
   frappe dans un champ de saisie rendrait la 3D inutilisable. */
function ant3dClef(m){
  return [m.cuivre.length, m.stats.polygones, m.vias.length,
          m.modele_cuivre, m.z_haut, !!ANT.vueMaillage,
          JSON.stringify(m.primitives), JSON.stringify(m.pieces||[]),
          m.boite.x1,m.boite.x2,m.boite.y1,m.boite.y2,m.boite.z1,m.boite.z2,
          JSON.stringify(m.ports||[m.port]), JSON.stringify(ANT.carte3d||null)
         ].join("|");
}

function ant3dMaj(){
  if(!ant3dInit())return;
  /* SANS MODÈLE, LES PIÈCES SE DESSINENT QUAND MÊME. Un modèle refusé — le
     port n'est pas encore posé, la bande est vide — ne doit pas empêcher de
     placer un boîtier : c'est souvent la première chose qu'on fait. La page
     dresse alors un modèle d'aperçu, la carte en simple plaque (voir
     `antPlaceModeleLocal`), et l'étiquette de la vue le dit. */
  const m=ANT.modele||((typeof antPlaceModeleLocal==="function")?antPlaceModeleLocal():null);
  if(!m){ ant3dVider(); ant3dDessiner(); return; }
  const clef=ant3dClef(m);
  if(clef===ANT3D.clef){ ant3dDessiner(); return; }
  ANT3D.clef=clef;

  ant3dVider();

  /* Le repère : origine au centre de la boîte de calcul, échelle ramenée à
     l'unité. Sans cela, une carte en millimètres à cinq cents unités de
     l'origine donne des artefacts de profondeur — la précision d'un flottant
     32 bits est relative, pas absolue. */
  const cx=(m.boite.x1+m.boite.x2)/2, cy=(m.boite.y1+m.boite.y2)/2,
        cz=(m.boite.z1+m.boite.z2)/2;
  const ancien=ANT3D.centre, rayon0=ANT3D.rayon;
  ANT3D.centre={x:cx,y:cy,z:cz};
  ANT3D.rayon=Math.max(1e-6,0.5*Math.hypot(
    m.boite.x2-m.boite.x1, m.boite.y2-m.boite.y1, m.boite.z2-m.boite.z1));
  /* LA CAMÉRA RESTE OÙ ELLE EST DANS LE MONDE. La boîte de calcul enveloppe
     les pièces : en poser une plus loin l'agrandit, et son centre — l'origine
     de la scène — se déplace. Sans compensation, la caméra, qui vit en
     coordonnées de scène, suivait ce centre : la pièce qu'on venait de poser
     semblait rester sur place et c'était la boîte, la carte et tout le reste
     qui sautaient, avec un zoom qui changeait. On ramène donc le point visé
     et la distance de vue en millimètres, avant et après. */
  if(ancien){
    const o=ANT3D.orbite;
    o.cx+=ancien.x-cx; o.cy+=ancien.y-cy; o.cz+=ancien.z-cz;
    o.dist*=rayon0/ANT3D.rayon;
  }
  const T=function(x,y,z){ return [x-cx,y-cy,z-cz]; };

  ant3dSubstrat(m,T);
  if(typeof antCarte3d==="function")antCarte3d(m,ANT3D.racine,T);
  ant3dCuivre(m,T);
  ant3dVias(m,T);
  ant3dObjets(m,T);
  ant3dPorts(m,T);
  if(!m.local)ant3dBoites(m,T);
  ant3dMaillage(m,T);
  ant3dRepere(m,T);

  /* La carte se désigne d'un clic comme une pièce : tout ce qui est dans son
     groupe la représente — sauf les flèches, qui ne sont que des repères. */
  ANT3D.racine.traverse(function(o){
    if(o.isMesh&&!o.userData.carte&&!(o.parent&&o.parent.type==="ArrowHelper"))
      o.userData.carte="modele";
  });
  /* T(−C)·B·T(C) : la carte placée dans l'assemblage, vue depuis le centre
     de la scène. */
  if(typeof antCarteMatrice==="function"){
    const B=new THREE.Matrix4().fromArray(antCarteMatrice());
    ANT3D.racine.matrixAutoUpdate=false;
    ANT3D.racine.matrix.makeTranslation(-cx,-cy,-cz).multiply(B)
      .multiply(new THREE.Matrix4().makeTranslation(cx,cy,cz));
  }
  if(typeof antPieces3d==="function")antPieces3d(m,ANT3D.monde,cx,cy,cz);
  if(typeof antPlaceApres==="function")antPlaceApres(m);

  ant3dPoserCamera();
}

/* TOUT CE QUI A ÉTÉ ALLOUÉ SUR LA CARTE GRAPHIQUE EST RENDU, Y COMPRIS CE QUI
   N'EST PAS UN MAILLAGE. Un `ArrowHelper` — la flèche d'excitation d'un port,
   les trois axes du trièdre — est un GROUPE : sa tige et son cône sont des
   ENFANTS, et ne portent eux-mêmes ni `geometry` ni `material`. La boucle
   d'avant ne dépilait que le premier niveau : les flèches n'étaient donc
   jamais libérées, et la scène est refaite à chaque changement d'empreinte du
   modèle. On descend l'arbre.

   UNE GÉOMÉTRIE PARTAGÉE N'EST LIBÉRÉE QU'UNE FOIS. Les vias se dessinent
   tous sur le même cylindre unité (voir `ant3dVias`) : le libérer une fois
   par via redéclencherait autant de fois l'événement que le moteur de rendu
   écoute. Un ensemble de ce qu'on a déjà vu suffit. */
function ant3dVider(){
  const r=ANT3D.monde;
  if(!r)return;
  const vus=new Set();
  const rendre=function(o){
    if(o.geometry&&!vus.has(o.geometry)){ vus.add(o.geometry); o.geometry.dispose(); }
    const m=o.material;
    if(m){
      for(const um of (Array.isArray(m)?m:[m]))
        if(um&&!vus.has(um)){ vus.add(um); um.dispose(); }
    }
  };
  while(r.children.length){
    const o=r.children.pop();
    if(typeof o.traverse==="function")o.traverse(rendre);
    else rendre(o);
  }
  ANT3D.grille=null; ANT3D.grilleM=null; ANT3D.grilleT=null;
  /* Un groupe neuf pour la carte, à la place de l'ancien. */
  ANT3D.racine=new THREE.Group();
  r.add(ANT3D.racine);
}

/* Un polygone plat (tableau [[x,y],…]) -> une THREE.Shape, trous compris. */
function ant3dShape(poly){
  const s=new THREE.Shape();
  const o=poly.o;
  s.moveTo(o[0][0],o[0][1]);
  for(let i=1;i<o.length;i++)s.lineTo(o[i][0],o[i][1]);
  s.closePath();
  for(const t of (poly.t||[])){
    const h=new THREE.Path();
    h.moveTo(t[0][0],t[0][1]);
    for(let i=1;i<t.length;i++)h.lineTo(t[i][0],t[i][1]);
    h.closePath();
    s.holes.push(h);
  }
  return s;
}

function ant3dCuivre(m,T){
  for(const bloc of m.cuivre){
    const couleur=ant3dCouleurCouche(bloc.couche);
    const mat=new THREE.MeshLambertMaterial({color:couleur,side:THREE.DoubleSide});
    const formes=bloc.polys.map(ant3dShape);
    if(!formes.length)continue;
    /* Épaisseur nulle -> une surface ; épaisseur réelle -> une extrusion.
       C'est exactement ce que le solveur recevra, et c'est le but : ce qu'on
       voit ici est ce qui sera maillé, pas une jolie approximation. */
    const geo=(bloc.ep_geo>0)
      ? new THREE.ExtrudeGeometry(formes,{depth:bloc.ep_geo,bevelEnabled:false})
      : new THREE.ShapeGeometry(formes);
    const mesh=new THREE.Mesh(geo,mat);
    const p=T(0,0,bloc.z0);
    mesh.position.set(p[0],p[1],p[2]);
    ANT3D.racine.add(mesh);
  }
}

function ant3dSubstrat(m,T){
  const b=m.boite_cuivre;
  /* LE SUBSTRAT DE LA CARTE ENTIÈRE, quand il est demandé : le contour
     exact, extrudé, et non la boîte du cuivre. C'est ce qui part au solveur. */
  if(m.carte&&m.carte.contour&&m.carte.contour.length>=3){
    const f=new THREE.Shape();
    m.carte.contour.forEach((p,i)=>i?f.lineTo(p[0],p[1]):f.moveTo(p[0],p[1]));
    f.closePath();
    for(const d of m.dielectriques){
      const mesh=new THREE.Mesh(
        new THREE.ExtrudeGeometry(f,{depth:Math.max(1e-4,d.z1-d.z0),bevelEnabled:false}),
        new THREE.MeshLambertMaterial({color:0x2d7a4a, transparent:true, opacity:0.22,
                                       depthWrite:false, side:THREE.DoubleSide}));
      const p=T(0,0,d.z0);
      mesh.position.set(p[0],p[1],p[2]);
      ANT3D.racine.add(mesh);
    }
    return;
  }
  for(const d of m.dielectriques){
    const geo=new THREE.BoxGeometry(b[2]-b[0], b[3]-b[1], d.ep);
    /* Translucide : le cuivre des couches internes doit se deviner au
       travers, sinon la pile n'est qu'une brique verte. */
    const mat=new THREE.MeshLambertMaterial({
      color:0x2d7a4a, transparent:true, opacity:0.22,
      depthWrite:false, side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(geo,mat);
    const p=T((b[0]+b[2])/2,(b[1]+b[3])/2,(d.z0+d.z1)/2);
    mesh.position.set(p[0],p[1],p[2]);
    ANT3D.racine.add(mesh);
  }
}

/* UNE SEULE GÉOMÉTRIE POUR TOUS LES VIAS, ET CETTE FOIS C'EST VRAI. Le
   commentaire l'annonçait déjà, le code en fabriquait une par via : mille
   vias faisaient mille géométries de douze faces, alors qu'une carte à mille
   vias est un cas ordinaire.

   CE QUI L'EMPÊCHAIT est que deux vias n'ont ni le même rayon ni la même
   portée. Un cylindre UNITÉ — rayon 1, hauteur 1 — et une échelle par via le
   règlent : `scale` s'applique dans le repère local, donc avant la rotation
   qui couche l'axe, et `scale.y` reste bien le long du cylindre. C'est le
   nombre d'OBJETS qui coûte à l'affichage, mais c'est le nombre de
   géométries qui coûte à la mémoire de la carte graphique — et c'était le
   second qu'on payait pour rien. */
function ant3dVias(m,T){
  if(!m.vias.length)return;
  const mat=new THREE.MeshLambertMaterial({color:0xc0c6cc});
  const geo=new THREE.CylinderGeometry(1,1,1,12);
  for(const v of m.vias){
    const mesh=new THREE.Mesh(geo,mat);
    mesh.scale.set(v.r,Math.max(1e-4,v.z1-v.z0),v.r);
    mesh.rotation.x=Math.PI/2;            // le cylindre de three.js est selon y
    const p=T(v.x,v.y,(v.z0+v.z1)/2);
    mesh.position.set(p[0],p[1],p[2]);
    ANT3D.racine.add(mesh);
  }
}

/* Les objets qui ne sont pas sur la carte.

   C'EST ICI QU'ILS SERVENT VRAIMENT. Un boîtier saisi en coordonnées est une
   suite de six nombres dont on ne sait pas, en les lisant, s'ils entourent
   l'antenne ou la traversent. Vu du côté, on le sait en une seconde. Le
   métal est opaque, le diélectrique translucide — sans quoi un radôme
   masquerait tout ce qu'il est censé protéger. */
function ant3dObjets(m,T){
  for(const o of (m.primitives||[])){
    const metal=(o.materiau==="metal");
    const mat=new THREE.MeshLambertMaterial({
      color:metal?0xc8ccd2:0x8af0ff,
      transparent:!metal, opacity:metal?1:0.28,
      depthWrite:metal, side:THREE.DoubleSide});
    let geo=null, centre=[0,0,0];
    if(o.type==="boite"){
      geo=new THREE.BoxGeometry(Math.max(1e-4,o.b[0]-o.a[0]),
                                Math.max(1e-4,o.b[1]-o.a[1]),
                                Math.max(1e-4,o.b[2]-o.a[2]));
      centre=[(o.a[0]+o.b[0])/2,(o.a[1]+o.b[1])/2,(o.a[2]+o.b[2])/2];
    }else if(o.type==="sphere"){
      geo=new THREE.SphereGeometry(o.r,20,14);
      centre=o.c;
    }else if(o.type==="cylindre"){
      ant3dTube(o.a,o.b,o.r,mat,T);
      continue;
    }else{
      /* Un fil est une polyligne : un tube par segment, plus une petite
         sphère à chaque coude — sans quoi les angles sont creux. */
      for(let i=0;i+1<o.pts.length;i++)ant3dTube(o.pts[i],o.pts[i+1],o.r,mat,T);
      for(const q of o.pts){
        const b=new THREE.Mesh(new THREE.SphereGeometry(o.r,10,8),mat);
        const p=T(q[0],q[1],q[2]);
        b.position.set(p[0],p[1],p[2]);
        ANT3D.racine.add(b);
      }
      continue;
    }
    const mesh=new THREE.Mesh(geo,mat);
    const p=T(centre[0],centre[1],centre[2]);
    mesh.position.set(p[0],p[1],p[2]);
    ANT3D.racine.add(mesh);
  }
}

/* Un cylindre entre deux points quelconques. THREE.CylinderGeometry est
   aligné sur y : il faut le coucher sur la direction voulue. */
function ant3dTube(a,b,r,mat,T){
  const dx=b[0]-a[0], dy=b[1]-a[1], dz=b[2]-a[2];
  const L=Math.hypot(dx,dy,dz);
  if(!(L>0))return;
  const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,L,14),mat);
  const p=T((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);
  mesh.position.set(p[0],p[1],p[2]);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),
    new THREE.Vector3(dx/L,dy/L,dz/L));
  ANT3D.racine.add(mesh);
}

/* Les ports : un volume jaune vif, et une flèche qui dit dans quel sens il
   excite. L'orientation est ce qu'on vient vérifier ici — un port dont la
   flèche est couchée alors qu'on croyait l'avoir posé debout est une faute
   qu'aucun chiffre du panneau ne montre.

   LE CONNECTEUR COAXIAL SE DESSINE EN ENTIER, et c'est ici qu'il sert le
   plus : l'âme, la gaine et le tronçon qui sort sous la carte sont
   précisément ce qu'on ne voit pas en 2D. Un tronçon qui plonge dans la PML
   — c'est-à-dire hors du calcul — saute aux yeux vu de côté, et de nulle
   part ailleurs.

   Les ports en charge sont plus pâles que celui qui excite : le S₁₁ est
   celui du vif. */
function ant3dPorts(m,T){
  (m.ports||[m.port]).forEach(function(p){
    const couleur=p.excite?0xf2c744:0x6e93b4;
    /* LE PORT LOCALISÉ EST UNE LIGNE DANS LE MODÈLE, et une ligne ne se voit
       pas à l'échelle d'une carte. On lui redonne ici, POUR L'AFFICHAGE
       SEULEMENT, l'empreinte que l'utilisateur a désignée — `w` et `l`, qui
       voyagent avec le port justement pour cela. Ce qui excite reste l'axe ;
       ce petit volume dit seulement où il est. */
    const dx=Math.max(p.x2-p.x1, p.dir==="x"?1e-4:(p.w||0.2)),
          dy=Math.max(p.y2-p.y1, p.dir==="y"?1e-4:(p.l||p.w||0.2)),
          dz=Math.max(1e-4,p.z2-p.z1);
    const mat=new THREE.MeshLambertMaterial({color:couleur,
      transparent:true,opacity:p.excite?0.85:0.55});
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(dx,dy,dz),mat);
    const c=T((p.x1+p.x2)/2,(p.y1+p.y2)/2,(p.z1+p.z2)/2);
    mesh.position.set(c[0],c[1],c[2]);
    ANT3D.racine.add(mesh);

    if(p.excite){
      const sens=new THREE.Vector3(p.dir==="x"?1:0,p.dir==="y"?1:0,
                                   p.dir==="z"?1:0);
      const L=ANT3D.rayon*0.18;
      const fl=new THREE.ArrowHelper(sens,new THREE.Vector3(c[0],c[1],c[2]),
                                     L,0xffe680,L*0.3,L*0.16);
      ANT3D.racine.add(fl);
    }

    const k=p.coax;
    if(!k)return;
    /* L'âme : du bout du tronçon jusqu'à la couche qu'elle alimente, en
       traversant toute la carte. */
    ant3dTube([p.x,p.y,k.z_bas],[p.x,p.y,k.z_ame],k.ra,
              new THREE.MeshLambertMaterial({color:0xd8b55a}),T);
    /* La gaine : dessinée par son cylindre extérieur en transparence — ce
       qui compte ici est son emprise et sa longueur, pas son épaisseur. */
    ant3dTube([p.x,p.y,k.z_bas],[p.x,p.y,k.z_gaine],k.rb+k.ep_gaine,
              new THREE.MeshLambertMaterial({color:0x9aa6b2,
                transparent:true,opacity:0.30}),T);
  });
}

/* Les deux boîtes : celle du calcul, et celle où le calcul est encore
   physique — c'est-à-dire hors de la PML. L'écart entre les deux EST la
   marge d'air, et c'est la seule façon de la voir d'un coup d'œil. */
function ant3dBoites(m,T){
  const b=m.boite;
  const cadre=function(x1,y1,z1,x2,y2,z2,couleur,pointille){
    const geo=new THREE.BoxGeometry(x2-x1,y2-y1,z2-z1);
    const seg=new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      pointille
        ? new THREE.LineDashedMaterial({color:couleur,dashSize:ANT3D.rayon*0.06,
                                        gapSize:ANT3D.rayon*0.04})
        : new THREE.LineBasicMaterial({color:couleur}));
    const p=T((x1+x2)/2,(y1+y2)/2,(z1+z2)/2);
    seg.position.set(p[0],p[1],p[2]);
    if(pointille)seg.computeLineDistances();
    geo.dispose();
    ANT3D.racine.add(seg);
  };

  cadre(b.x1,b.y1,b.z1,b.x2,b.y2,b.z2,0x3fa0ea,false);

  /* L'épaisseur de la PML en unités de longueur : elle vaut N cellules, et
     la cellule fait le pas d'air. C'est une estimation — openEMS pose la PML
     sur les N premières lignes de maillage, qui ne sont pas forcément
     régulières —, et l'étiquette de la vue le dit. */
  const e=b.ep_pml||(m.boite.pml*m.resolution.air);
  /* Elle se dessine MEME quand elle est trop epaisse — c'est justement le cas
     qu'il faut voir : un cadre rouge plus petit que la carte dit d'un coup
     d'oeil que l'absorbeur mord dans la structure. On ne s'abstient que si le
     cadre est degenere au point de ne plus rien montrer. */
  if(b.x2-b.x1>2.05*e&&b.y2-b.y1>2.05*e&&b.z2-b.z1>2.05*e)
    cadre(b.x1+e,b.y1+e,b.z1+e,b.x2-e,b.y2-e,b.z2-e,0xe8443a,true);
}

/* LA GRILLE FDTD, DANS LES TROIS SENS. Le plan XY seul ne dit rien de ce qui
   se passe en hauteur — or c'est en Z que le maillage est le plus serré (les
   trois cellules du substrat, les faces du cuivre) et c'est en Z qu'une boîte
   d'air trop plate se voit. On dessine donc des COUPES : un plan par normale,
   chacun posé sur une ligne de maillage et déplaçable ligne à ligne, plus, à
   la demande, le volume entier en très pâle.

   Les coupes partent du PORT EXCITÉ : c'est là que le maillage se resserre et
   c'est là qu'on vient le vérifier. La couleur d'un plan est celle de sa
   normale dans le trièdre — XY bleu (Z), XZ vert (Y), YZ rouge (X).

   La grille vit dans son propre groupe : déplacer une coupe ne reconstruit
   que lui, pas le cuivre ni les pièces. */
const ANT3D_MAILLE={
  xy:true, xz:false, yz:false, vol:false,
  actif:"xy",                       // la coupe que le curseur déplace
  pos:{xy:null, xz:null, yz:null}   // cote de chaque coupe, en unités du modèle
};
const ANT3D_MAILLE_PLANS={
  xy:{axe:"z", couleur:0x3fa0ea},
  xz:{axe:"y", couleur:0x4cc38a},
  yz:{axe:"x", couleur:0xe8443a}
};
const ANT3D_MAILLE_VOL_MAX=250000;  // segments, au-delà on sous-échantillonne

function ant3dMailleLignes(m){
  const g=m&&m.maillage;
  if(!g||!g.x||!g.y||!g.x.length||!g.y.length)return null;
  return {x:g.x, y:g.y, z:(g.z&&g.z.length)?g.z:null};
}

/* L'indice de la ligne la plus proche d'une cote. */
function ant3dMailleIndice(li,v){
  let k=0, d=Infinity;
  for(let i=0;i<li.length;i++){ const e=Math.abs(li[i]-v); if(e<d){ d=e; k=i; } }
  return k;
}

/* La cote par défaut d'une coupe : le port excité, sinon le plan de l'antenne
   pour XY et le milieu de la boîte pour les deux autres. */
function ant3dMailleDefaut(m,axe){
  const p=(m.ports||[m.port]).find(q=>q&&q.excite)||m.port;
  if(axe==="z")return (m.z_haut!=null)?m.z_haut:(p?(p.z1+p.z2)/2:(m.boite.z1+m.boite.z2)/2);
  if(p)return axe==="x"?(p.x1+p.x2)/2:(p.y1+p.y2)/2;
  return axe==="x"?(m.boite.x1+m.boite.x2)/2:(m.boite.y1+m.boite.y2)/2;
}

/* La cote effective d'une coupe, recollée sur une ligne de maillage. */
function ant3dMailleCote(m,L,plan){
  const axe=ANT3D_MAILLE_PLANS[plan].axe, li=L[axe];
  if(!li)return null;
  const v=(ANT3D_MAILLE.pos[plan]!=null)?ANT3D_MAILLE.pos[plan]:ant3dMailleDefaut(m,axe);
  const k=ant3dMailleIndice(li,v);
  return {k:k, v:li[k], n:li.length};
}

function ant3dMaillage(m,T){
  ANT3D.grille=null;
  ANT3D.grilleM=m; ANT3D.grilleT=T;
  if(!ANT.vueMaillage){ ant3dMailleUI(); return; }
  const L=ant3dMailleLignes(m);
  if(!L){ ant3dMailleUI(); return; }
  const g=new THREE.Group();
  ANT3D.grille=g;
  ANT3D.racine.add(g);
  ant3dMailleRemplir(m,T,L,g);
  ant3dMailleUI();
}

function ant3dMailleRemplir(m,T,L,g){
  const mx=L.x, my=L.y, mz=L.z;
  const x1=mx[0], x2=mx[mx.length-1], y1=my[0], y2=my[my.length-1];
  const z1=mz?mz[0]:m.boite.z1, z2=mz?mz[mz.length-1]:m.boite.z2;
  const seg=function(pos,a,b){
    const p=T(a[0],a[1],a[2]), q=T(b[0],b[1],b[2]);
    pos.push(p[0],p[1],p[2], q[0],q[1],q[2]);
  };
  const poser=function(pos,couleur,opacite){
    if(!pos.length)return;
    const geo=new THREE.BufferGeometry();
    geo.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
    g.add(new THREE.LineSegments(geo,new THREE.LineBasicMaterial(
      {color:couleur,transparent:true,opacity:opacite,depthWrite:false})));
  };

  /* Le volume entier : une ligne par couple d'indices, dans chaque sens. */
  if(ANT3D_MAILLE.vol&&mz){
    const n=my.length*mz.length+mx.length*mz.length+mx.length*my.length;
    const pas=Math.max(1,Math.ceil(Math.sqrt(n/ANT3D_MAILLE_VOL_MAX)));
    ANT3D.grillePas=pas;
    const pos=[];
    for(let j=0;j<my.length;j+=pas)for(let k=0;k<mz.length;k+=pas)
      seg(pos,[x1,my[j],mz[k]],[x2,my[j],mz[k]]);
    for(let i=0;i<mx.length;i+=pas)for(let k=0;k<mz.length;k+=pas)
      seg(pos,[mx[i],y1,mz[k]],[mx[i],y2,mz[k]]);
    for(let i=0;i<mx.length;i+=pas)for(let j=0;j<my.length;j+=pas)
      seg(pos,[mx[i],my[j],z1],[mx[i],my[j],z2]);
    poser(pos,0x7fb8e8,0.07);
  }else ANT3D.grillePas=1;

  /* Les coupes. */
  for(const plan of ["xy","xz","yz"]){
    if(!ANT3D_MAILLE[plan])continue;
    const c=ant3dMailleCote(m,L,plan);
    if(!c)continue;
    const v=c.v, pos=[], bord=[];
    if(plan==="xy"){
      for(const x of mx)seg(pos,[x,y1,v],[x,y2,v]);
      for(const y of my)seg(pos,[x1,y,v],[x2,y,v]);
      seg(bord,[x1,y1,v],[x2,y1,v]); seg(bord,[x2,y1,v],[x2,y2,v]);
      seg(bord,[x2,y2,v],[x1,y2,v]); seg(bord,[x1,y2,v],[x1,y1,v]);
    }else if(plan==="xz"){
      for(const x of mx)seg(pos,[x,v,z1],[x,v,z2]);
      for(const z of mz)seg(pos,[x1,v,z],[x2,v,z]);
      seg(bord,[x1,v,z1],[x2,v,z1]); seg(bord,[x2,v,z1],[x2,v,z2]);
      seg(bord,[x2,v,z2],[x1,v,z2]); seg(bord,[x1,v,z2],[x1,v,z1]);
    }else{
      for(const y of my)seg(pos,[v,y,z1],[v,y,z2]);
      for(const z of mz)seg(pos,[v,y1,z],[v,y2,z]);
      seg(bord,[v,y1,z1],[v,y2,z1]); seg(bord,[v,y2,z1],[v,y2,z2]);
      seg(bord,[v,y2,z2],[v,y1,z2]); seg(bord,[v,y1,z2],[v,y1,z1]);
    }
    const col=ANT3D_MAILLE_PLANS[plan].couleur;
    poser(pos,col,0.38);
    poser(bord,col,0.9);
  }
}

/* Redessiner la grille seule — un déplacement de coupe, un plan de plus. */
function ant3dMailleMaj(){
  const m=ANT3D.grilleM, T=ANT3D.grilleT;
  if(!m||!T||!ANT3D.racine){ ant3dMaj(); return; }
  if(ANT3D.grille){
    ANT3D.grille.traverse(function(o){
      if(o.geometry)o.geometry.dispose();
      if(o.material)o.material.dispose();
    });
    ANT3D.racine.remove(ANT3D.grille);
  }
  ant3dMaillage(m,T);
  ant3dDessiner();
}

/* La barre des coupes : visible en 3D, maillage affiché. */
function ant3dMailleUI(){
  const bar=document.getElementById("maille3d");
  if(!bar)return;
  const voir=(ANT.vue==="3d")&&!!ANT.vueMaillage;
  bar.hidden=!voir;
  if(!voir)return;
  const m=ANT3D.grilleM, L=m?ant3dMailleLignes(m):null;
  for(const q of ["xy","xz","yz","vol"]){
    const b=document.getElementById("bMaille_"+q);
    if(!b)continue;
    b.classList.toggle("on",!!ANT3D_MAILLE[q]);
    b.classList.toggle("actif",q===ANT3D_MAILLE.actif&&!!ANT3D_MAILLE[q]);
    b.disabled=!L||(q!=="xy"&&!L.z);
  }
  const r=document.getElementById("maille3dPos"), t=document.getElementById("maille3dTxt");
  const plan=ANT3D_MAILLE.actif;
  const c=(L&&ANT3D_MAILLE[plan])?ant3dMailleCote(m,L,plan):null;
  if(r){
    r.disabled=!c;
    if(c){ r.min=0; r.max=c.n-1; r.step=1; r.value=c.k; }
  }
  if(t){
    let s="";
    if(L)s=L.x.length+" × "+L.y.length+(L.z?" × "+L.z.length:"")+" lignes";
    if(c){
      const mm=c.v*(m.unite_mm||1);
      s+=" · "+plan.toUpperCase()+" à "+ANT3D_MAILLE_PLANS[plan].axe+" = "+
         (+mm.toFixed(4))+" mm ("+(c.k+1)+"/"+c.n+")";
    }
    if(ANT3D_MAILLE.vol&&ANT3D.grillePas>1)s+=" · volume 1 ligne sur "+ANT3D.grillePas;
    t.textContent=s;
  }
}

/* Un bouton de coupe : le premier clic l'allume et lui donne le curseur, un
   second clic sur la coupe qui a déjà le curseur l'éteint. */
function ant3dMailleBasculer(q){
  if(q==="vol") ANT3D_MAILLE.vol=!ANT3D_MAILLE.vol;
  else if(!ANT3D_MAILLE[q]){ ANT3D_MAILLE[q]=true; ANT3D_MAILLE.actif=q; }
  else if(ANT3D_MAILLE.actif!==q) ANT3D_MAILLE.actif=q;
  else{
    ANT3D_MAILLE[q]=false;
    ANT3D_MAILLE.actif=["xy","xz","yz"].find(p=>ANT3D_MAILLE[p])||q;
  }
  ant3dMailleMaj();
}

function ant3dMailleGlisser(k){
  const m=ANT3D.grilleM, L=m?ant3dMailleLignes(m):null;
  const plan=ANT3D_MAILLE.actif;
  if(!L)return;
  const li=L[ANT3D_MAILLE_PLANS[plan].axe];
  if(!li)return;
  ANT3D_MAILLE.pos[plan]=li[Math.max(0,Math.min(li.length-1,k|0))];
  ant3dMailleMaj();
}

window.addEventListener("DOMContentLoaded",function(){
  for(const q of ["xy","xz","yz","vol"]){
    const b=document.getElementById("bMaille_"+q);
    if(b)b.addEventListener("click",function(){ ant3dMailleBasculer(q); });
  }
  const r=document.getElementById("maille3dPos");
  if(r)r.addEventListener("input",function(){ ant3dMailleGlisser(+r.value); });
});

/* Un trièdre, coin de la boîte : sans lui, une vue tournée ne dit plus où
   est X et où est Y, et c'est justement ce qu'on vient vérifier. */
function ant3dRepere(m,T){
  const L=ANT3D.rayon*0.22;
  const o=T(m.boite.x1,m.boite.y1,m.boite.z1);
  const O=new THREE.Vector3(o[0],o[1],o[2]);
  ANT3D.racine.add(new THREE.ArrowHelper(new THREE.Vector3(1,0,0),O,L,0xe8443a,L*0.2,L*0.1));
  ANT3D.racine.add(new THREE.ArrowHelper(new THREE.Vector3(0,1,0),O,L,0x4cc38a,L*0.2,L*0.1));
  ANT3D.racine.add(new THREE.ArrowHelper(new THREE.Vector3(0,0,1),O,L,0x3fa0ea,L*0.2,L*0.1));
}

/* --------------------------------------------------------------------------
   Le passage d'une vue à l'autre
   -------------------------------------------------------------------------- */
function antVuePoser(quoi){
  ANT.vue=(quoi==="3d")?"3d":"2d";
  const c2=document.getElementById("carte"), c3=document.getElementById("vue3d");
  const b2=document.getElementById("bVue2d"), b3=document.getElementById("bVue3d");
  if(!c2||!c3)return;
  c2.hidden=(ANT.vue==="3d");
  c3.hidden=(ANT.vue!=="3d");
  b2.classList.toggle("on",ANT.vue==="2d");
  b3.classList.toggle("on",ANT.vue==="3d");

  const h=document.getElementById("vueHint");
  if(h)h.textContent=(ANT.vue==="3d")
    ? "clic droit (ou gauche) glissé : tourner · milieu, Ctrl+droit ou Maj+gauche : déplacer · molette : zoom vers le curseur · double-clic : centre de rotation"
    : "clic : désigner du cuivre · Ctrl+clic : en ajouter · molette : zoom";

  if(ANT.vue==="3d"){
    if(ant3dInit()){ ant3dMaj(); ant3dTaille(); }
    else if(h)h.textContent="Aperçu 3D indisponible : three.js n'a pas été chargé.";
  }else{
    resize();
  }
  ant3dMailleUI();
  if(typeof antPlaceBarre==="function")antPlaceBarre();
}

if(window.ResizeObserver){
  const ro=new ResizeObserver(function(){ if(ANT.vue==="3d")ant3dTaille(); });
  window.addEventListener("DOMContentLoaded",function(){
    const w=document.getElementById("canvasWrap");
    if(w)ro.observe(w);
  });
}
