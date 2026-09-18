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

  ANT3D.racine=new THREE.Group();
  ANT3D.scene.add(ANT3D.racine);

  ant3dSouris(cv);
  ANT3D.pret=true;
  return true;
}

/* --------------------------------------------------------------------------
   La caméra : orbite, molette, déplacement
   Écrite ici plutôt que prise dans OrbitControls : ce sont quarante lignes,
   et OrbitControls est un fichier de plus à poser dans le dépôt et à garder
   en phase avec la version de three.js.
   -------------------------------------------------------------------------- */
function ant3dSouris(cv){
  let bouton=0, x0=0, y0=0, actif=false;
  cv.addEventListener("pointerdown",function(e){
    actif=true; bouton=e.button; x0=e.clientX; y0=e.clientY;
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointerup",function(e){
    actif=false;
    try{cv.releasePointerCapture(e.pointerId);}catch(err){}
  });
  cv.addEventListener("pointermove",function(e){
    if(!actif)return;
    const dx=e.clientX-x0, dy=e.clientY-y0;
    x0=e.clientX; y0=e.clientY;
    const o=ANT3D.orbite;
    if(bouton===0){
      o.theta-=dx*0.008;
      /* La colatitude est bornée : passer par le pôle retourne l'image et
         l'on ne sait plus où est le dessus de la carte. */
      o.phi=Math.max(0.02,Math.min(Math.PI-0.02,o.phi-dy*0.008));
    }else{
      const k=ANT3D.rayon*o.dist*0.0022;
      const s=Math.sin(o.theta), c=Math.cos(o.theta);
      o.cx-= (dx*c)*k; o.cy-= (dx*s)*k;
      o.cz+= dy*k;
    }
    ant3dPoserCamera();
  });
  cv.addEventListener("wheel",function(e){
    e.preventDefault();
    ANT3D.orbite.dist=Math.max(0.25,Math.min(40,
      ANT3D.orbite.dist*(e.deltaY>0?1.12:1/1.12)));
    ant3dPoserCamera();
  },{passive:false});
  cv.addEventListener("dblclick",function(){ ant3dCadrer(); });
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
  if(ANT3D.pret&&ANT3D.scene&&ANT3D.cam)
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
          JSON.stringify(m.primitives),
          m.boite.x1,m.boite.x2,m.boite.y1,m.boite.y2,m.boite.z1,m.boite.z2,
          JSON.stringify(m.ports||[m.port])
         ].join("|");
}

function ant3dMaj(){
  if(!ant3dInit())return;
  const m=ANT.modele;
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
  ANT3D.centre={x:cx,y:cy,z:cz};
  ANT3D.rayon=Math.max(1e-6,0.5*Math.hypot(
    m.boite.x2-m.boite.x1, m.boite.y2-m.boite.y1, m.boite.z2-m.boite.z1));
  const T=function(x,y,z){ return [x-cx,y-cy,z-cz]; };

  ant3dSubstrat(m,T);
  ant3dCuivre(m,T);
  ant3dVias(m,T);
  ant3dObjets(m,T);
  ant3dPorts(m,T);
  ant3dBoites(m,T);
  ant3dMaillage(m,T);
  ant3dRepere(m,T);

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
  const r=ANT3D.racine;
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

/* La grille FDTD : lignes de maillage en 3D dans le plan de l'antenne */
function ant3dMaillage(m,T){
  if(!ANT.vueMaillage)return;
  const maille=m.maillage;
  if(!maille||!maille.x||!maille.y)return;
  const mx=maille.x, my=maille.y;
  const b=m.boite;
  const zPlane=m.z_haut||0;
  const positions=[];
  for(let i=0;i<mx.length;i++){
    const p1=T(mx[i],b.y1,zPlane);
    const p2=T(mx[i],b.y2,zPlane);
    positions.push(p1[0],p1[1],p1[2], p2[0],p2[1],p2[2]);
  }
  for(let j=0;j<my.length;j++){
    const p1=T(b.x1,my[j],zPlane);
    const p2=T(b.x2,my[j],zPlane);
    positions.push(p1[0],p1[1],p1[2], p2[0],p2[1],p2[2]);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  const mat=new THREE.LineBasicMaterial({color:0x3fa0ea,transparent:true,opacity:0.32});
  const lines=new THREE.LineSegments(geo,mat);
  ANT3D.racine.add(lines);
}

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
    ? "glisser : tourner · clic droit : déplacer · molette : zoom · double-clic : cadrer"
    : "clic : désigner du cuivre · Ctrl+clic : en ajouter · molette : zoom";

  if(ANT.vue==="3d"){
    if(ant3dInit()){ ant3dMaj(); ant3dTaille(); }
    else if(h)h.textContent="Aperçu 3D indisponible : three.js n'a pas été chargé.";
  }else{
    resize();
  }
}

if(window.ResizeObserver){
  const ro=new ResizeObserver(function(){ if(ANT.vue==="3d")ant3dTaille(); });
  window.addEventListener("DOMContentLoaded",function(){
    const w=document.getElementById("canvasWrap");
    if(w)ro.observe(w);
  });
}
