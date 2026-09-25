"use strict";
/* =============================================================================
   Antenne openEMS — 34-placement.js
   Placer les pièces À LA SOURIS, dans la vue 3D : les choisir d'un clic, les
   faire glisser, et les ACCROCHER — un point sur un point, une face contre
   une face — pour les poser exactement où elles vont.

   POURQUOI DES ACCROCHES ET PAS SEULEMENT DES NOMBRES. Une pile se pose sur
   un bossage, une carte dans ses glissières, un boîtier se referme sur sa
   carte : ce sont des CONTACTS, et les écrire en coordonnées demande de
   connaître la cote de chaque face dans deux repères différents — celui du
   fichier STEP et celui de la carte. Cliquer la face de la pile puis celle du
   bossage donne la même chose au micron, sans rien lire.

   TROIS GESTES, ET LE SERVEUR DERRIÈRE CHACUN. Rien ici ne place la pièce
   pour de bon : le geste écrit la position et la rotation de la pièce, comme
   le feraient les champs de sa fiche, et le modèle est revérifié. Ce qu'on
   voit après le lâcher est ce que le serveur a placé.

     Choisir    un clic sur une pièce la choisit. Un second clic au même
                endroit prend la pièce DERRIÈRE — c'est ainsi qu'on atteint une
                pile dans un boîtier fermé.
     Déplacer   glisser la pièce choisie : dans le plan horizontal, ou le long
                d'un seul axe (X, Y, Z). Un pas de grille arrondit la position.
     Accrocher  deux clics : un point ou une face de la pièce, puis un point
                ou une face de ce qu'on veut toucher — la carte, le boîtier,
                une autre pièce. Le point le plus proche du curseur parmi les
                sommets, les milieux d'arête et le CENTRE DE LA FACE est pris :
                viser le milieu d'un disque donne son centre.

   Le clavier, pièce choisie et vue 3D ouverte : flèches (Maj : ×10), Page
   haut/bas pour Z, G pour déplacer, X/Y/Z pour l'axe, M pour le manipulateur
   (flèches et anneaux, voir plus bas), Échap pour lâcher,
   Ctrl+Z pour annuler.
   ============================================================================= */

const PL={
  sel:null,            // identifiant de la pièce choisie
  corps:-1,            // rang du corps visé au dernier clic
  mode:"choisir",      // choisir | deplacer | accrocher
  axe:"xy",            // xy | x | y | z
  pas:0,               // pas de grille, en unité de la carte ; 0 = libre
  manip:true,          // le manipulateur : trois flèches et trois anneaux
  pasAngle:15,         // pas des anneaux, en degrés ; 0 = libre
  gizmo:null,          // son groupe dans la scène
  survolManip:null,    // la poignée sous le curseur
  acc:"ff",            // pp : point → point · ff : face → face · pf : point → face
  orienter:true,       // face → face : tourner la pièce pour mettre les faces en regard
  centrer:false,       // face → face : amener aussi le centre sur le centre
  source:null,         // {id, genre, p, n, quoi} en mm, repère de la carte
  survol:null,         // la même chose, sous le curseur
  glisse:null,         // le glisser en cours
  pile:[],             // pour annuler
  marques:null,
  dernierClic:null,    // pour prendre la pièce DERRIÈRE au second clic
  /* LE RENDU DE LA VUE : « plein », « transparent », « filaire ». Plein par
     défaut — un boîtier se regarde comme un objet. Ce qu'il cache se voit en
     le MASQUANT (corps par corps : `masque` sur le corps ou la pièce, gardé
     dans le projet, sans effet sur la simulation) ou en le COUPANT. */
  rendu:"plein",
  opacite:0.2,         // des plastiques, en rendu transparent
  controle:null,       // le dernier contrôle d'interférences, voir plControler
  alertes:null,        // son groupe dans la scène : les facettes fautives
  /* La coupe : un plan perpendiculaire à X, Y ou Z, posé à une fraction de
     la boîte de calcul. Ce qui est au-delà n'est ni dessiné ni visé. */
  coupe:{axe:"", t:0.5},
  plan:null,
  /* LA CARTE ÉLECTRONIQUE, telle qu'elle est et non telle qu'elle part au
     solveur : son contour, son cuivre des deux faces en texture, et ses
     composants en blocs. C'est ce contre quoi on pose un boîtier. */
  voirCarte:true,
  voirComposants:true,
  replie:false,
  boite:null,
  /* Ce que le dernier geste a fait, dit une fois : la barre est redessinée à
     chaque réponse du serveur, et le message s'effacerait avant d'être lu. */
  message:""
};

/* ==========================================================================
   Le repère
   --------------------------------------------------------------------------
   La scène est centrée sur la boîte de calcul (14-apercu3d.js : précision des
   flottants 32 bits). Tout ce que ce module retient est en millimètres, dans
   le repère de la CARTE : la scène change de centre à chaque nouvelle boîte,
   et une accroche qui se souviendrait d'une coordonnée de scène serait fausse
   dès que la pièce a bougé.
   ========================================================================== */
function plMonde(v){
  const c=ANT3D.centre||{x:0,y:0,z:0};
  return new THREE.Vector3(v.x+c.x,v.y+c.y,v.z+c.z);
}
function plScene(v){
  const c=ANT3D.centre||{x:0,y:0,z:0};
  return new THREE.Vector3(v.x-c.x,v.y-c.y,v.z-c.z);
}
/* LA CARTE EST UNE PIÈCE POUR LES OUTILS : « carte » la désigne, et
   `ANT_CARTE_PIECE` (33-pieces.js) lit et écrit sa place dans l'assemblage.
   Tous les gestes — glisser, flèches, accrocher, annuler — la traitent donc
   sans rien savoir d'elle. */
function plPiece(id){
  if(id==="carte")return (typeof ANT_CARTE_PIECE!=="undefined")?ANT_CARTE_PIECE:null;
  return ANT.pieces.find(p=>p.id===id)||null;
}
/* Ce qu'un maillage de la scène représente : une pièce, la carte, ou rien. */
function plIdDe(o){
  return (o&&o.userData)?(o.userData.piece||(o.userData.carte?"carte":null)):null;
}

/* ==========================================================================
   Le modèle d'aperçu, quand le serveur n'en rend pas
   ========================================================================== */
function antPlaceModeleLocal(){
  if(!V.modele||(!ANT.pieces.length&&!PL.voirCarte)||typeof antPieceMatrice!=="function")return null;
  const c=antCarteMm();
  const b=[c.x1,c.y1,c.z1,c.x2,c.y2,c.z2];
  const pieces=ANT.pieces.map(function(p){
    /* Dans le repère de la carte, comme le serveur les aurait rendues. */
    const r=antPieceRelative(p);
    const e=antPieceEmprise({position:r.position, rotation:r.rotation, corps:p.corps},true);
    for(let k=0;k<3;k++){ b[k]=Math.min(b[k],e[k]); b[k+3]=Math.max(b[k+3],e[k+3]); }
    return {id:p.id, nom:p.nom, matrice:antPieceMatriceCarte(p),
            corps:p.corps.map(q=>({nom:q.nom, materiau:antMatiere(q.matiere).m}))};
  });
  const marge=0.08*Math.max(b[3]-b[0],b[4]-b[1],b[5]-b[2]);
  return {local:true, cuivre:[], stats:{polygones:0}, vias:[], modele_cuivre:"",
          z_haut:c.z2, primitives:[], pieces:pieces, ports:[],
          boite_cuivre:[c.x1,c.y1,c.x2,c.y2],
          dielectriques:PL.voirCarte?[]:[{z0:c.z1, z1:c.z2, ep:Math.max(1e-3,c.z2-c.z1)}],
          boite:{x1:b[0]-marge, y1:b[1]-marge, z1:b[2]-marge,
                 x2:b[3]+marge, y2:b[4]+marge, z2:b[5]+marge},
          maillage:null, resolution:{air:1}};
}

/* ==========================================================================
   Viser
   ========================================================================== */
const PL_RAYON=(typeof THREE!=="undefined")?new THREE.Raycaster():null;

function plNdc(e){
  const cv=document.getElementById("vue3d");
  const r=cv.getBoundingClientRect();
  return {x:((e.clientX-r.left)/r.width)*2-1, y:-((e.clientY-r.top)/r.height)*2+1,
          px:e.clientX-r.left, py:e.clientY-r.top, w:r.width, h:r.height};
}

/* Tout ce qui est touché sous le curseur, du plus proche au plus loin. Les
   traits (cadres, flèches, grille) ne se visent pas : on n'accroche pas une
   pièce au cadre de la PML. */
function plViser(e,filtre){
  if(!PL_RAYON||!ANT3D.pret)return [];
  const n=plNdc(e);
  ANT3D.cam.updateMatrixWorld();
  ANT3D.monde.updateMatrixWorld(true);
  PL_RAYON.setFromCamera({x:n.x,y:n.y},ANT3D.cam);
  const objets=[];
  ANT3D.monde.traverse(function(o){
    if(o.isMesh&&o.visible&&o.geometry&&(!filtre||filtre(o)))objets.push(o);
  });
  let hits=PL_RAYON.intersectObjects(objets,false);
  /* Ce qui est au-delà du plan de coupe n'est pas dessiné : il ne se vise
     pas non plus, sinon le clic accrocherait une paroi qu'on ne voit pas. */
  if(PL.plan)hits=hits.filter(h=>PL.plan.distanceToPoint(h.point)>=0);
  /* MAJ : À TRAVERS. La première chose touchée est écartée — toute la pièce,
     ses deux parois comprises —, et c'est ce qu'il y a derrière qui compte.
     C'est le geste pour viser la carte au fond d'un boîtier sans le masquer. */
  if(e.shiftKey&&hits.length){
    const h0=hits[0].object, id0=plIdDe(h0);
    hits=hits.filter(h=>id0?plIdDe(h.object)!==id0:h.object!==h0);
  }
  return hits;
}

/* Un sommet d'un maillage de la scène, en monde (mm). */
function plSommet(o,i){
  const a=o.geometry.attributes.position;
  return plMonde(new THREE.Vector3(a.getX(i),a.getY(i),a.getZ(i)).applyMatrix4(o.matrixWorld));
}
function plTriangle(o,f){
  const idx=o.geometry.index;
  return idx?[idx.getX(3*f),idx.getX(3*f+1),idx.getX(3*f+2)]:[3*f,3*f+1,3*f+2];
}

/* LA FACE ENTIÈRE, et non le triangle cliqué : les triangles coplanaires
   voisins, de proche en proche. C'est son centre qui compte — le centre d'un
   disque, d'un bossage, d'une paroi —, et aucun sommet n'y tombe : une
   triangulation d'OpenCascade borde un disque, elle ne le rayonne pas.
   Les voisinages sont construits une fois par géométrie, sur les positions
   (et non les indices : une ExtrudeGeometry n'en a pas). */
const PL_VOISINS=new WeakMap();
function plVoisinage(g){
  let v=PL_VOISINS.get(g);
  if(v)return v;
  const a=g.attributes.position, idx=g.index;
  const nT=idx?idx.count/3:a.count/3;
  const cle=new Array(a.count), par=new Map();
  for(let i=0;i<a.count;i++)
    cle[i]=Math.round(a.getX(i)*1e4)+","+Math.round(a.getY(i)*1e4)+","+Math.round(a.getZ(i)*1e4);
  for(let f=0;f<nT;f++)
    for(let s=0;s<3;s++){
      const i=idx?idx.getX(3*f+s):3*f+s;
      let l=par.get(cle[i]);
      if(!l){ l=[]; par.set(cle[i],l); }
      l.push(f);
    }
  v={cle:cle, par:par, nT:nT};
  PL_VOISINS.set(g,v);
  return v;
}

function plFace(o,f0){
  const g=o.geometry, a=g.attributes.position, idx=g.index;
  const V3=function(i){ return new THREE.Vector3(a.getX(i),a.getY(i),a.getZ(i)); };
  const tri=function(f){ return idx?[idx.getX(3*f),idx.getX(3*f+1),idx.getX(3*f+2)]:[3*f,3*f+1,3*f+2]; };
  const t0=tri(f0).map(V3);
  const n0=new THREE.Vector3().subVectors(t0[1],t0[0]).cross(new THREE.Vector3().subVectors(t0[2],t0[0]));
  if(n0.lengthSq()===0)return null;
  n0.normalize();
  const vs=plVoisinage(g);
  const tol=1e-3*Math.max(1,g.boundingSphere?g.boundingSphere.radius:1);
  const vu=new Set([f0]), file=[f0];
  const somme=new THREE.Vector3();
  let aire=0;
  while(file.length&&vu.size<20000){
    const f=file.pop();
    const t=tri(f), p=t.map(V3);
    const n=new THREE.Vector3().subVectors(p[1],p[0]).cross(new THREE.Vector3().subVectors(p[2],p[0]));
    const s=n.length();
    if(s>0){
      aire+=s/2;
      somme.addScaledVector(p[0].clone().add(p[1]).add(p[2]).multiplyScalar(1/3),s/2);
    }
    for(const i of t)for(const g2 of vs.par.get(vs.cle[i])||[]){
      if(vu.has(g2))continue;
      const q=tri(g2).map(V3);
      const m=new THREE.Vector3().subVectors(q[1],q[0]).cross(new THREE.Vector3().subVectors(q[2],q[0]));
      if(m.lengthSq()===0)continue;
      m.normalize();
      if(m.dot(n0)<0.9999)continue;
      if(q.some(w=>Math.abs(n0.dot(new THREE.Vector3().subVectors(w,t0[0])))>tol))continue;
      vu.add(g2); file.push(g2);
    }
  }
  const centre=aire>0?somme.multiplyScalar(1/aire):t0[0];
  return {centre:plMonde(centre.applyMatrix4(o.matrixWorld)),
          n:n0.transformDirection(o.matrixWorld), triangles:vu.size};
}

/* Ce qu'on vise : une FACE (son plan, son centre) ou un POINT (le sommet, le
   milieu d'arête ou le centre de face le plus proche du curseur, à l'écran).
   La normale est tournée vers l'œil : on vise toujours le côté qu'on voit,
   et c'est lui qui doit toucher. */
function plCible(e,genre,filtre){
  const hits=plViser(e,filtre);
  const h=hits[0];
  if(!h||h.faceIndex==null)return null;
  const o=h.object, face=plFace(o,h.faceIndex);
  if(!face)return null;
  if(face.n.dot(PL_RAYON.ray.direction)>0)face.n.negate();
  const id=plIdDe(o);
  if(genre==="face")
    return {genre:"face", p:face.centre, n:face.n, quoi:"face", id:id,
            corps:o.userData.corps, objet:o};
  const t=plTriangle(o,h.faceIndex).map(i=>plSommet(o,i));
  const cand=[
    {p:t[0],quoi:"sommet"},{p:t[1],quoi:"sommet"},{p:t[2],quoi:"sommet"},
    {p:t[0].clone().add(t[1]).multiplyScalar(0.5),quoi:"milieu d'arête"},
    {p:t[1].clone().add(t[2]).multiplyScalar(0.5),quoi:"milieu d'arête"},
    {p:t[2].clone().add(t[0]).multiplyScalar(0.5),quoi:"milieu d'arête"},
    {p:face.centre,quoi:"centre de face"}
  ];
  const n=plNdc(e);
  let mieux=null, dmin=Infinity;
  for(const c of cand){
    const s=plScene(c.p).project(ANT3D.cam);
    const d=Math.hypot((s.x+1)/2*n.w-n.px,(1-s.y)/2*n.h-n.py);
    if(d<dmin){ dmin=d; mieux=c; }
  }
  return {genre:"point", p:mieux.p, n:face.n, quoi:mieux.quoi, id:id,
          corps:o.userData.corps, objet:o};
}

/* ==========================================================================
   Les marques : ce qu'on vise, ce qu'on a déjà pris
   ========================================================================== */
function plMarques(){
  if(!ANT3D.pret)return;
  if(!PL.marques){ PL.marques=new THREE.Group(); ANT3D.scene.add(PL.marques); }
  const g=PL.marques;
  while(g.children.length){
    const o=g.children.pop();
    if(o.geometry)o.geometry.dispose();
    if(o.material)o.material.dispose();
  }
  const r=Math.max(1e-3,ANT3D.rayon*0.012);
  const poser=function(c,couleur){
    if(!c)return;
    const q=plScene(c.p);
    const bille=new THREE.Mesh(new THREE.SphereGeometry(r,14,10),
      new THREE.MeshBasicMaterial({color:couleur, depthTest:false, transparent:true}));
    bille.position.copy(q); bille.renderOrder=10;
    g.add(bille);
    if(c.genre==="face"||PL.acc!=="pp"){
      const anneau=new THREE.Mesh(new THREE.RingGeometry(r*1.8,r*2.6,32),
        new THREE.MeshBasicMaterial({color:couleur, side:THREE.DoubleSide, depthTest:false,
                                     transparent:true, opacity:0.8}));
      anneau.position.copy(q);
      anneau.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),c.n);
      anneau.renderOrder=10;
      g.add(anneau);
      const fl=new THREE.ArrowHelper(c.n,q,r*7,couleur,r*2.2,r*1.4);
      fl.traverse(function(x){ if(x.material){ x.material.depthTest=false; x.renderOrder=10; } });
      g.add(fl);
    }
  };
  poser(PL.source,0xff9d3a);
  poser(PL.survol,PL.source?0x4cc38a:0xf2c744);
}

/* La pièce choisie se voit : ses faces prennent une lueur jaune. */
function plSurligner(){
  if(!ANT3D.monde)return;
  const carte=(PL.sel==="carte");
  ANT3D.racine.traverse(function(o){
    if(!o.isMesh||!o.userData.carte||!o.material)return;
    for(const m of (Array.isArray(o.material)?o.material:[o.material]))
      if(m&&m.emissive)m.emissive.setHex(carte?0x3a3000:0x000000);
  });
  ANT3D.monde.traverse(function(o){
    if(!o.isMesh||!o.userData.piece||!o.material)return;
    const p=plPiece(o.userData.piece), c=p&&p.corps[o.userData.corps];
    o.visible=!!p&&!p.masque&&!(c&&c.masque);
    const oui=(o.userData.piece===PL.sel);
    if(o.material.emissive)o.material.emissive.setHex(oui?0x4a3c00:0x000000);
    else if(o.material.wireframe)o.material.color.setHex(oui?0xf2c744:0x6c727c);
  });
}

/* Appelée par 14-apercu3d.js après chaque reconstruction de la scène. */
/* Après une case « visible » cochée dans une fiche : sans reconstruire. */
function antPlaceVisibilite(){
  plSurligner(); ant3dDessiner(); antPlaceBarre();
}

function antPlaceApres(m){
  if(PL.sel&&!plPiece(PL.sel))PL.sel=null;
  if(m&&m.boite)PL.boite=m.boite;
  plCouper();
  plSurligner();
  plMarques();
  plControler();
  antPlaceBarre();
}

/* ==========================================================================
   Le choix
   ========================================================================== */
function antPlaceChoisir(id,corps){
  PL.sel=id; PL.corps=(corps==null)?-1:corps;
  plSurligner(); ant3dDessiner();
  antPlaceBarre();
  /* La fiche de la pièce se montre, et la ligne du corps visé s'allume :
     les noms qu'un export STEP donne aux corps (« Admi05EC3FB26751 ») ne
     disent rien, c'est le clic qui les désigne. */
  document.querySelectorAll("#antPieces .objet.piece").forEach(function(f){
    const p=(f.dataset.pFiche==="carte")?ANT_CARTE_PIECE:ANT.pieces[+f.dataset.pFiche];
    const oui=!!p&&!!id&&p.id===id;
    f.classList.toggle("choisie",oui);
    f.querySelectorAll("tr[data-corps]").forEach(function(tr){
      tr.classList.toggle("vise",oui&&+tr.dataset.corps===PL.corps);
    });
    if(oui){
      const tr=f.querySelector("tr.vise");
      (tr||f).scrollIntoView({block:"nearest"});
    }
  });
}

/* Cadrer la pièce : la vue tourne autour d'elle, à une distance qui la
   montre entière. */
function antPlaceCadrer(id){
  const p=plPiece(id);
  if(!p||!ANT3D.pret)return;
  const e=antPieceEmprise(p,true);
  const c=plScene(new THREE.Vector3((e[0]+e[3])/2,(e[1]+e[4])/2,(e[2]+e[5])/2));
  const d=Math.hypot(e[3]-e[0],e[4]-e[1],e[5]-e[2]);
  ANT3D.orbite.cx=c.x; ANT3D.orbite.cy=c.y; ANT3D.orbite.cz=c.z;
  ANT3D.orbite.dist=Math.max(0.002,Math.min(200,1.6*d/Math.max(1e-6,ANT3D.rayon)));
  ant3dPoserCamera();
}

/* Depuis la fiche : ouvrir la 3D sur cette pièce. */
function antPlaceVoir(id){
  if(ANT.vue!=="3d")antVuePoser("3d");
  antPlaceChoisir(id,-1);
  antPlaceCadrer(id);
}

/* ==========================================================================
   Écrire un placement — et pouvoir le défaire
   ========================================================================== */
function plMemoriser(p){
  PL.pile.push({id:p.id, position:p.position.slice(), rotation:p.rotation.slice()});
  if(PL.pile.length>60)PL.pile.shift();
}

function antPlaceAnnuler(){
  const d=PL.pile.pop();
  if(!d)return false;
  const p=plPiece(d.id);
  if(!p)return antPlaceAnnuler();
  p.position=d.position; p.rotation=d.rotation;
  plApres();
  return true;
}

function plApres(){
  if(typeof antPiecesRafraichir==="function")antPiecesRafraichir();
  if(PL.sel)antPlaceChoisir(PL.sel,PL.corps);
  antMaj(true);
  /* Sans modèle, rien ne reviendra du serveur pour redessiner : la scène
     d'aperçu se refait tout de suite. */
  if(!ANT.modele&&ANT.vue==="3d")ant3dMaj();
}

function plArrondir(v){ return +(+v).toFixed(4); }

/* Les angles d'une rotation : voir `antAngles` (33-pieces.js). */
function plAngles(R){ return antAngles(R); }
function plMul(A,B){
  const C=[[0,0,0],[0,0,0],[0,0,0]];
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)
    for(let k=0;k<3;k++)C[i][j]+=A[i][k]*B[k][j];
  return C;
}
function plApp(R,v){
  return [R[0][0]*v[0]+R[0][1]*v[1]+R[0][2]*v[2],
          R[1][0]*v[0]+R[1][1]*v[1]+R[1][2]*v[2],
          R[2][0]*v[0]+R[2][1]*v[1]+R[2][2]*v[2]];
}

/* L'ACCROCHE. `s` est sur la pièce qui bouge, `t` sur ce qu'elle doit
   toucher ; tout est en millimètres, repère de la carte.

     point → point  la pièce glisse de s à t ;
     point → face   elle glisse le long de la normale de t jusqu'à son plan ;
     face → face    elle tourne (si « orienter ») pour que les deux faces se
                    regardent, autour du point pris sur sa face — qui ne bouge
                    donc pas —, puis glisse jusqu'au contact. « Centrer » amène
                    en plus le centre de sa face sur le centre de l'autre.

   La formule est celle du serveur : monde = R·(p − c) + c + t. Tourner autour
   d'un autre point que c revient à changer t, et c'est ce qu'on fait. */
function antPlaceAccrocher(p,s,t,acc,orienter,centrer){
  const k=antKmm(), c=antPieceCentre(p);
  let R=antRotation(p.rotation);
  let tt=p.position.map(v=>v*k);
  const S=[s.p.x,s.p.y,s.p.z], T=[t.p.x,t.p.y,t.p.z];
  const N=[t.n.x,t.n.y,t.n.z];
  const dot=(u,v)=>u[0]*v[0]+u[1]*v[1]+u[2]*v[2];
  const d=[T[0]-S[0],T[1]-S[1],T[2]-S[2]];
  if(acc==="pp"){
    tt=tt.map((v,i)=>v+d[i]);
  }else if(acc==="pf"){
    const h=dot(d,N);
    tt=tt.map((v,i)=>v+h*N[i]);
  }else{
    if(orienter){
      const q=new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(s.n.x,s.n.y,s.n.z).normalize(),
        new THREE.Vector3(-N[0],-N[1],-N[2]).normalize());
      const m=new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
      const Q=[[m[0],m[4],m[8]],[m[1],m[5],m[9]],[m[2],m[6],m[10]]];
      /* Le point pris sur la face reste en place : on retrouve son
         antécédent l0 dans le fichier, et on choisit t' pour qu'il retombe
         au même endroit sous la nouvelle rotation. */
      const Rt=[[R[0][0],R[1][0],R[2][0]],[R[0][1],R[1][1],R[2][1]],[R[0][2],R[1][2],R[2][2]]];
      const l0=plApp(Rt,[S[0]-c[0]-tt[0],S[1]-c[1]-tt[1],S[2]-c[2]-tt[2]]).map((v,i)=>v+c[i]);
      const R2=plMul(Q,R);
      const w=plApp(R2,[l0[0]-c[0],l0[1]-c[1],l0[2]-c[2]]);
      tt=[S[0]-w[0]-c[0],S[1]-w[1]-c[1],S[2]-w[2]-c[2]];
      R=R2;
      p.rotation=plAngles(R);
    }
    if(centrer)tt=tt.map((v,i)=>v+d[i]);
    else{
      const h=dot(d,N);
      tt=tt.map((v,i)=>v+h*N[i]);
    }
  }
  p.position=tt.map(v=>plArrondir(v/k));
}

/* ==========================================================================
   Le glisser
   ========================================================================== */
function plPlacer(base,delta){
  const k=antKmm();
  const pos=base.slice();
  for(let a=0;a<3;a++){
    if(!delta[a])continue;
    let v=pos[a]+delta[a]/k;
    if(PL.pas>0)v=Math.round(v/PL.pas)*PL.pas;
    pos[a]=plArrondir(v);
  }
  return pos;
}

function plGlisserDebut(e){
  const hits=plViser(e,o=>plIdDe(o)===PL.sel);
  if(!hits.length)return false;
  const p=plPiece(PL.sel);
  if(!p)return false;
  const maillages=[];
  if(PL.sel==="carte")maillages.push({o:ANT3D.racine, m0:ANT3D.racine.matrix.clone()});
  else ANT3D.monde.traverse(function(o){
    if(o.isMesh&&o.userData.piece===PL.sel)maillages.push({o:o, m0:o.matrix.clone()});
  });
  PL.glisse={p:p, h:hits[0].point.clone(), pos0:p.position.slice(),
             maillages:maillages, pos:p.position.slice()};
  return true;
}

function plGlisser(e){
  const g=PL.glisse;
  const n=plNdc(e);
  ANT3D.cam.updateMatrixWorld();
  PL_RAYON.setFromCamera({x:n.x,y:n.y},ANT3D.cam);
  const o=PL_RAYON.ray.origin, d=PL_RAYON.ray.direction, h=g.h;
  const axe=g.axe||PL.axe;
  let delta=[0,0,0];
  if(axe==="xy"){
    if(Math.abs(d.z)<1e-6)return;
    const s=(h.z-o.z)/d.z;
    if(s<0)return;
    delta=[o.x+s*d.x-h.x, o.y+s*d.y-h.y, 0];
  }else{
    /* Le point de l'axe le plus proche du rayon de la souris. */
    const u=new THREE.Vector3(axe==="x"?1:0,axe==="y"?1:0,axe==="z"?1:0);
    const w0=new THREE.Vector3().subVectors(h,o);
    const b=u.dot(d), den=1-b*b;
    if(Math.abs(den)<1e-6)return;
    const s=(b*d.dot(w0)-u.dot(w0))/den;
    delta=[u.x*s,u.y*s,u.z*s];
  }
  const pos=plPlacer(g.pos0,delta);
  const k=antKmm();
  const reel=[0,1,2].map(a=>(pos[a]-g.pos0[a])*k);
  g.pos=pos;
  const T=new THREE.Matrix4().makeTranslation(reel[0],reel[1],reel[2]);
  for(const x of g.maillages)x.o.matrix.copy(x.m0).premultiply(T);
  if(PL.gizmo&&g.gizmo0)PL.gizmo.position.copy(g.gizmo0).add(new THREE.Vector3(reel[0],reel[1],reel[2]));
  ant3dDessiner();
  plAide("Δ "+["x","y","z"].map((a,i)=>a+" "+(reel[i]>=0?"+":"")+aNb(reel[i]/k,3)).join(" · ")+
    " "+antUnite()+" — lâcher pour poser");
}

function plGlisserFin(){
  const g=PL.glisse;
  PL.glisse=null;
  if(!g)return;
  if(g.rot){ plTournerFin(g); return; }
  if(g.pos.every((v,i)=>v===g.pos0[i])){ if(PL.alertes)PL.alertes.visible=true; antPlaceBarre(); return; }
  plMemoriser(g.p);
  g.p.position=g.pos;
  plApres();
}

/* ==========================================================================
   Le manipulateur
   --------------------------------------------------------------------------
   TROIS FLÈCHES ET TROIS ANNEAUX, au centre de la pièce choisie, en mode
   Déplacer. Une flèche fait glisser la pièce le long de son axe ; un anneau
   la fait tourner autour de l'axe qu'il entoure — X rouge, Y vert, Z bleu,
   les axes FIXES de la vue, comme les boutons ↻ de la fiche.

   LE PIVOT EST LE CENTRE DE LA PIÈCE, et c'est ce qui rend l'anneau simple :
   la pièce est placée par p' = R·(p − c) + c + t, son centre visible est
   donc c + t. Tourner de Q autour de ce point donne Q·R·(p − c) + c + t : la
   position ne change pas, seule la rotation devient Q·R.

   Le manipulateur est dessiné par-dessus tout (sans test de profondeur) :
   la pièce est souvent DANS un boîtier, et une poignée cachée ne sert à rien.
   Sa taille est fixe à l'écran (voir `antPlaceAvantRendu`).
   ========================================================================== */
const PL_AXES=[{a:"x", v:[1,0,0], coul:0xe8443a},
               {a:"y", v:[0,1,0], coul:0x4cc38a},
               {a:"z", v:[0,0,1], coul:0x3fa0ea}];

/* Le centre visible de la pièce, en mm dans l'assemblage : c + t. */
function plPivot(p){
  const c=antPieceCentre(p), k=antKmm();
  return new THREE.Vector3(c[0]+p.position[0]*k, c[1]+p.position[1]*k, c[2]+p.position[2]*k);
}

function plManipCreer(){
  const g=new THREE.Group();
  g.renderOrder=20;
  const trait=function(geo,coul){
    return new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:coul, depthTest:false,
      depthWrite:false, transparent:true, opacity:0.95}));
  };
  /* Les zones de prise, plus épaisses que ce qu'on voit : une poignée de
     deux pixels ne se saisit pas. Invisibles, mais touchées par le rayon. */
  const prise=function(geo){
    return new THREE.Mesh(geo,new THREE.MeshBasicMaterial({transparent:true, opacity:0,
      depthTest:false, depthWrite:false, colorWrite:false}));
  };
  const haut=new THREE.Vector3(0,1,0);
  for(const ax of PL_AXES){
    const v=new THREE.Vector3(...ax.v);
    const qFleche=new THREE.Quaternion().setFromUnitVectors(haut,v);
    /* La flèche : unité 1 = la taille du manipulateur. */
    const tige=trait(new THREE.CylinderGeometry(0.014,0.014,0.8,8).translate(0,0.4,0),ax.coul);
    const cone=trait(new THREE.ConeGeometry(0.055,0.2,16).translate(0,0.9,0),ax.coul);
    const pf=prise(new THREE.CylinderGeometry(0.07,0.07,1,8).translate(0,0.5,0));
    /* L'anneau : un tore dans le plan perpendiculaire à l'axe. */
    const qAnneau=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),v);
    const anneau=trait(new THREE.TorusGeometry(0.62,0.012,8,72),ax.coul);
    const pa=prise(new THREE.TorusGeometry(0.62,0.06,8,72));
    for(const o of [tige,cone,pf])o.quaternion.copy(qFleche);
    for(const o of [anneau,pa])o.quaternion.copy(qAnneau);
    for(const o of [tige,cone,anneau,pf,pa])o.renderOrder=20;
    pf.userData.poignee={genre:"fleche", axe:ax.a, vus:[tige,cone], coul:ax.coul};
    pa.userData.poignee={genre:"anneau", axe:ax.a, vus:[anneau], coul:ax.coul};
    g.add(tige,cone,anneau,pf,pa);
  }
  /* Une bille au centre : le pivot, là où la pièce tourne. */
  const bille=trait(new THREE.SphereGeometry(0.035,12,8),0xf2c744);
  bille.renderOrder=20;
  g.add(bille);
  return g;
}

/* Montrer, cacher, poser le manipulateur là où est la pièce choisie. */
function plManip(){
  if(!ANT3D.pret||typeof THREE==="undefined")return;
  const p=plPiece(PL.sel);
  const voir=PL.manip&&PL.mode==="deplacer"&&!!p&&ANT.vue==="3d";
  if(!voir&&!PL.gizmo)return;
  if(!PL.gizmo){ PL.gizmo=plManipCreer(); ANT3D.scene.add(PL.gizmo); }
  if(PL.gizmo.parent!==ANT3D.scene)ANT3D.scene.add(PL.gizmo);
  const avant=PL.gizmo.visible;
  PL.gizmo.visible=voir;
  if(voir)PL.gizmo.position.copy(plScene(plPivot(p)));
  else PL.survolManip=null;
  plManipCouleurs();
  if(avant||voir)ant3dDessiner();
}

function plManipCouleurs(){
  if(!PL.gizmo)return;
  const actif=(PL.glisse&&PL.glisse.poignee)||PL.survolManip;
  PL.gizmo.traverse(function(o){
    const h=o.userData&&o.userData.poignee;
    if(!h)return;
    for(const v of h.vus)v.material.color.setHex(h===actif?0xf2c744:h.coul);
  });
}

/* Taille constante à l'écran : environ un septième de la hauteur de vue. */
function antPlaceAvantRendu(){
  const g=PL.gizmo;
  if(!g||!g.visible)return;
  const cam=ANT3D.cam;
  const d=cam.position.distanceTo(g.position);
  const s=Math.max(1e-6,d*Math.tan(cam.fov*Math.PI/360)*0.3);
  g.scale.setScalar(s);
}

/* La poignée sous le curseur, ou rien. */
function plManipViser(e){
  const g=PL.gizmo;
  if(!g||!g.visible||!PL_RAYON)return null;
  const n=plNdc(e);
  ANT3D.cam.updateMatrixWorld();
  antPlaceAvantRendu();
  g.updateMatrixWorld(true);
  PL_RAYON.setFromCamera({x:n.x,y:n.y},ANT3D.cam);
  const prises=g.children.filter(o=>o.userData.poignee);
  const hits=PL_RAYON.intersectObjects(prises,false);
  /* Une flèche passe devant son anneau au croisement : la flèche l'emporte. */
  const f=hits.find(h=>h.object.userData.poignee.genre==="fleche");
  const h=f||hits[0];
  return h?Object.assign({point:h.point},h.object.userData.poignee,{objet:h.object}):null;
}

function plManipDebut(e){
  if(!PL.manip)return false;
  const h=plManipViser(e);
  if(!h)return false;
  const p=plPiece(PL.sel);
  if(!p)return false;
  const maillages=[];
  if(PL.sel==="carte")maillages.push({o:ANT3D.racine, m0:ANT3D.racine.matrix.clone()});
  else ANT3D.monde.traverse(function(o){
    if(o.isMesh&&o.userData.piece===PL.sel)maillages.push({o:o, m0:o.matrix.clone()});
  });
  const base={p:p, maillages:maillages, pos0:p.position.slice(), pos:p.position.slice(),
              gizmo0:PL.gizmo.position.clone()};
  /* La poignée garde sa couleur « prise » pendant tout le geste. */
  const poignee=h.objet.userData.poignee;
  if(h.genre==="fleche"){
    PL.glisse=Object.assign(base,{h:h.point.clone(), axe:h.axe, poignee:poignee});
  }else{
    const u=new THREE.Vector3(...PL_AXES.find(x=>x.a===h.axe).v);
    const vue=new THREE.Vector3().subVectors(ANT3D.cam.position,PL.gizmo.position).normalize();
    PL.glisse=Object.assign(base,{rot:true, axe:h.axe, u:u, poignee:poignee, angle:0,
      /* Anneau vu de face ou de biais : l'angle se mesure DANS SON PLAN, et
         un quart de tour à la souris est un quart de tour de la pièce. Vu
         par la tranche, ce plan se réduit à un trait : on prend alors
         l'angle à l'écran, faute de mieux. */
      dansPlan:Math.abs(vue.dot(u))>0.2, rot0:p.rotation.slice()});
    PL.glisse.a0=plAngleAnneau(e,PL.glisse);
  }
  plManipCouleurs();
  document.getElementById("vue3d").style.cursor="grabbing";
  return true;
}

/* L'angle du curseur autour du pivot, compté positivement autour de l'axe
   de l'anneau (règle de la main droite). */
function plAngleAnneau(e,g){
  const C=PL.gizmo.position, u=g.u;
  const n=plNdc(e);
  if(g.dansPlan){
    ANT3D.cam.updateMatrixWorld();
    PL_RAYON.setFromCamera({x:n.x,y:n.y},ANT3D.cam);
    const p=PL_RAYON.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(u,C),
                                        new THREE.Vector3());
    if(p){
      /* Une base du plan de l'anneau : e1, puis e2 = u × e1. */
      const e1=new THREE.Vector3(u.z,u.x,u.y);
      const e2=new THREE.Vector3().crossVectors(u,e1);
      const v=p.sub(C);
      return Math.atan2(v.dot(e2),v.dot(e1));
    }
  }
  /* À l'écran, le sens trigonométrique est positif autour de l'axe qui
     POINTE VERS NOUS ; s'il s'éloigne, le sens s'inverse. */
  const c=C.clone().project(ANT3D.cam);
  const cx=(c.x+1)/2*n.w, cy=(1-c.y)/2*n.h;
  const versNous=u.dot(new THREE.Vector3().subVectors(ANT3D.cam.position,C))>=0;
  return Math.atan2(-(n.py-cy),n.px-cx)*(versNous?1:-1);
}

function plTourner(e){
  const g=PL.glisse;
  const C=PL.gizmo.position, u=g.u;
  /* Déroulé : on cumule les petits pas, pour suivre les tours complets au
     lieu de sauter de +180° à −180°. */
  const a=plAngleAnneau(e,g), d=a-g.a0;
  g.a0=a;
  g.brut=(g.brut||0)+Math.atan2(Math.sin(d),Math.cos(d));
  let deg=g.brut*180/Math.PI;
  const pas=e.shiftKey?1:PL.pasAngle;
  if(pas>0)deg=Math.round(deg/pas)*pas;
  g.angle=deg;
  const Q=new THREE.Matrix4().makeRotationAxis(u,deg*Math.PI/180);
  const T=new THREE.Matrix4().makeTranslation(C.x,C.y,C.z).multiply(Q)
    .multiply(new THREE.Matrix4().makeTranslation(-C.x,-C.y,-C.z));
  for(const x of g.maillages)x.o.matrix.copy(x.m0).premultiply(T);
  ant3dDessiner();
  plAide("rotation autour de "+g.axe.toUpperCase()+" : "+(deg>=0?"+":"")+aNb(deg,1)+"°"+
    (pas>0?" (pas "+pas+"°, Maj : 1°)":"")+" — lâcher pour poser");
}

function plTournerFin(g){
  plManipCouleurs();
  const deg=((g.angle%360)+360)%360;
  if(!deg){ if(PL.alertes)PL.alertes.visible=true; plManip(); antPlaceBarre(); return; }
  const q=[0,0,0]; q["xyz".indexOf(g.axe)]=g.angle;
  const Q=antRotation(q), R=antRotation(g.rot0);
  const QR=[0,1,2].map(i=>[0,1,2].map(j=>Q[i][0]*R[0][j]+Q[i][1]*R[1][j]+Q[i][2]*R[2][j]));
  plMemoriser(g.p);
  g.p.rotation=antAngles(QR);
  plApres();
}

/* ==========================================================================
   La souris (appelée par 14-apercu3d.js)
   ========================================================================== */
function antPlacePointeur(quoi,e){
  if(!ANT3D.pret||!V.modele)return false;
  if(quoi==="down"){
    if(e.button!==0)return false;
    if(PL.mode==="deplacer"&&PL.sel){
      const pris=plManipDebut(e)||plGlisserDebut(e);
      /* Les facettes fautives datent de la place d'avant : on les cache le
         temps du geste, le contrôle se refait au lâcher. */
      if(pris&&PL.alertes)PL.alertes.visible=false;
      return pris;
    }
    return false;
  }
  if(quoi==="glisse"){ if(PL.glisse)(PL.glisse.rot?plTourner:plGlisser)(e); return true; }
  if(quoi==="up"){ plGlisserFin(); return true; }
  if(quoi==="survol"){
    const cv=document.getElementById("vue3d");
    if(PL.mode==="deplacer"){
      /* Le curseur dit ce que fera le bouton : saisir une poignée, la
         pièce, ou tourner la vue. */
      const h=plManipViser(e);
      if(h!==PL.survolManip){ PL.survolManip=h; plManipCouleurs(); ant3dDessiner(); }
      const sur=!!h||(!!PL.sel&&plViser(e,o=>plIdDe(o)===PL.sel).length>0);
      cv.style.cursor=h?"grab":(sur?"move":"");
      return false;
    }
    cv.style.cursor=(PL.mode==="accrocher")?"crosshair":"";
    if(PL.mode!=="accrocher")return false;
    const genre=plGenreAttendu();
    const filtre=PL.source?(o=>plIdDe(o)!==PL.source.id):(o=>!!plIdDe(o));
    PL.survol=plCible(e,genre,filtre);
    plMarques(); ant3dDessiner();
    if(PL.survol)plAide(plEtape()+" · "+PL.survol.quoi);
    return false;
  }
  if(quoi==="clic"){
    if(PL.mode==="accrocher")plClicAccroche(e);
    else plClicChoix(e);
    return true;
  }
  return false;
}

/* Un clic choisit la pièce touchée. Au même endroit, le clic suivant prend
   celle qui est DERRIÈRE : sans cela, une pile dans un boîtier fermé ne se
   choisirait jamais à la souris. */
function plClicChoix(e){
  const hits=plViser(e,o=>!!plIdDe(o));
  const ids=[];
  for(const h of hits){
    const id=plIdDe(h.object);
    if(!ids.some(x=>x.id===id))ids.push({id:id, corps:h.object.userData.piece?h.object.userData.corps:-1});
  }
  if(!ids.length){ antPlaceChoisir(null,-1); return; }
  let i=0;
  const ici=PL.dernierClic&&Math.hypot(e.clientX-PL.dernierClic[0],e.clientY-PL.dernierClic[1])<6;
  if(ici){
    const j=ids.findIndex(x=>x.id===PL.sel);
    if(j>=0)i=(j+1)%ids.length;
  }
  PL.dernierClic=[e.clientX,e.clientY];
  antPlaceChoisir(ids[i].id,ids[i].corps);
}

function plGenreAttendu(){
  if(PL.acc==="pp")return "point";
  if(PL.acc==="ff")return "face";
  return PL.source?"face":"point";
}

function plEtape(){
  const quoi={point:"un point", face:"une face"}[plGenreAttendu()];
  return PL.source
    ? "2/2 : cliquez "+quoi+" de ce qu'elle doit toucher — carte, boîtier, autre pièce"
    : "1/2 : cliquez "+quoi+" de la pièce à placer";
}

function plClicAccroche(e){
  const genre=plGenreAttendu();
  if(!PL.source){
    const s=plCible(e,genre,o=>!!plIdDe(o));
    if(!s)return;
    PL.source=s; PL.survol=null;
    antPlaceChoisir(s.id,s.corps);
    plMarques(); ant3dDessiner();
    plAide(plEtape());
    return;
  }
  const t=plCible(e,genre,o=>plIdDe(o)!==PL.source.id);
  if(!t)return;
  const p=plPiece(PL.source.id);
  if(!p){ PL.source=null; return; }
  plMemoriser(p);
  antPlaceAccrocher(p,PL.source,t,PL.acc,PL.orienter,PL.centrer);
  PL.source=null; PL.survol=null;
  plMarques();
  PL.message="Accrochée ("+{ff:"face contre face",pp:"point sur point",pf:"point sur face"}[PL.acc]+
    "). Ctrl+Z pour revenir ; un nouveau clic recommence.";
  plApres();
}

/* ==========================================================================
   Le clavier
   ========================================================================== */
window.addEventListener("keydown",function(e){
  if(ANT.vue!=="3d"||!V.modele)return;
  if(e.target&&/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName))return;
  const k=e.key;
  const prendre=function(){ e.preventDefault(); e.stopPropagation(); };
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&String(k).toLowerCase()==="z"){
    if(PL.pile.length){ prendre(); antPlaceAnnuler(); }
    return;
  }
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(k==="Escape"){
    if(PL.source||PL.survol){ prendre(); PL.source=null; PL.survol=null; plMarques(); ant3dDessiner(); antPlaceBarre(); }
    else if(PL.sel){ prendre(); antPlaceChoisir(null,-1); }
    return;
  }
  const p=plPiece(PL.sel);
  if(!p)return;
  const kl=String(k).toLowerCase();
  if(kl==="g"){ prendre(); PL.mode=(PL.mode==="deplacer")?"choisir":"deplacer"; antPlaceBarre(); return; }
  if(kl==="m"){ prendre(); PL.manip=!PL.manip; PL.mode="deplacer"; antPlaceBarre(); return; }
  if(kl==="x"||kl==="y"||kl==="z"){
    prendre(); PL.axe=(PL.axe===kl)?"xy":kl; PL.mode="deplacer"; antPlaceBarre(); return;
  }
  const pas=(PL.pas>0?PL.pas:(V.unite==="in"?0.02:0.5))*(e.shiftKey?10:1)*antKmm();
  const d={ArrowLeft:[-pas,0,0], ArrowRight:[pas,0,0], ArrowUp:[0,pas,0], ArrowDown:[0,-pas,0],
           PageUp:[0,0,pas], PageDown:[0,0,-pas]}[k];
  if(!d)return;
  prendre();
  plMemoriser(p);
  p.position=plPlacer(p.position,d);
  if(typeof antPiecesRafraichir==="function")antPiecesRafraichir();
  antMaj();
  if(!ANT.modele)ant3dMaj();
},true);

/* ==========================================================================
   La barre, posée sur la vue 3D
   ========================================================================== */
function plAide(t){
  const el=document.getElementById("plAide");
  if(el)el.textContent=t;
}

function antPlaceBarre(){
  const wrap=document.getElementById("canvasWrap");
  if(!wrap)return;
  let b=document.getElementById("place3d");
  const montrer=(ANT.vue==="3d"&&!!V.modele);
  if(!montrer){
    if(b)b.hidden=true;
    if(PL.mode==="accrocher"||PL.source){ PL.source=null; PL.survol=null; plMarques(); }
    plManip();
    return;
  }
  if(!b){
    b=document.createElement("div");
    b.id="place3d"; b.className="place3d";
    wrap.appendChild(b);
    b.addEventListener("pointerdown",function(e){ e.stopPropagation(); });
  }
  b.hidden=false;
  const p=plPiece(PL.sel);
  const c=(p&&PL.corps>=0)?p.corps[PL.corps]:null;
  const on=(x)=>x?" on":"";
  const bt=(attr,val,txt,titre,actif)=>'<button class="vb'+on(actif)+'" '+attr+'="'+val+'" title="'+aEsc(titre)+'">'+txt+'</button>';
  const nMasques=ANT.pieces.reduce((n,q)=>n+(q.masque?1:0)+q.corps.filter(x=>x.masque).length,0);

  /* LA LIGNE DES PIÈCES n'existe que s'il y en a : la vue, elle, sert aussi à
     regarder la carte seule. */
  let pieces="";
  {
    let outils="";
    if(PL.mode==="deplacer"){
      outils=bt("data-pl-axe","xy","plan XY","Glisser dans le plan horizontal",PL.axe==="xy")+
        bt("data-pl-axe","x","X","Glisser le long de X (touche X)",PL.axe==="x")+
        bt("data-pl-axe","y","Y","Glisser le long de Y (touche Y)",PL.axe==="y")+
        bt("data-pl-axe","z","Z","Glisser le long de Z (touche Z)",PL.axe==="z")+
        '<label class="pl-pas">pas <select id="plPas">'+
        [0,0.01,0.1,0.5,1,5].map(v=>'<option value="'+v+'"'+(PL.pas===v?" selected":"")+'>'+
          (v?mdlNb(v)+" "+antUnite():"libre")+'</option>').join("")+'</select></label>'+
        '<span class="vsep"></span>'+
        bt("data-pl-manip","1","✥ flèches + anneaux","Le manipulateur : flèches pour glisser le long d'un axe, anneaux pour tourner autour (touche M)",PL.manip)+
        (PL.manip?'<label class="pl-pas" title="Pas de rotation des anneaux ; Maj pendant le geste : 1°">pas ∠ <select id="plPasAngle">'+
          [0,1,5,15,45,90].map(v=>'<option value="'+v+'"'+(PL.pasAngle===v?" selected":"")+'>'+
            (v?v+"°":"libre")+'</option>').join("")+'</select></label>':"");
    }else if(PL.mode==="accrocher"){
      outils=bt("data-pl-acc","ff","face → face","Une face de la pièce contre une face de la cible",PL.acc==="ff")+
        bt("data-pl-acc","pp","point → point","Un point de la pièce sur un point de la cible",PL.acc==="pp")+
        bt("data-pl-acc","pf","point → face","Un point de la pièce sur le plan d'une face",PL.acc==="pf")+
        (PL.acc==="ff"
          ? '<label class="pl-ck" title="Tourner la pièce pour que les deux faces se regardent"><input type="checkbox" id="plOrienter"'+(PL.orienter?" checked":"")+'> orienter</label>'+
            '<label class="pl-ck" title="Amener aussi le centre de la face sur le centre de l\'autre"><input type="checkbox" id="plCentrer"'+(PL.centrer?" checked":"")+'> centrer</label>'
          : "");
    }
    pieces='<div class="pl-ligne">'+
      '<span class="pl-nom" title="'+aEsc(p?(p.nom+(c?" / "+c.nom:"")):"")+'">'+
        (p?"<b>"+aEsc(p.nom)+"</b>"+(c?" / "+aEsc(c.nom):""):"aucune pièce choisie")+'</span>'+
      bt("data-pl-mode","choisir","Choisir","Un clic choisit une pièce ; le suivant, au même endroit, celle de derrière",PL.mode==="choisir")+
      bt("data-pl-mode","deplacer","Déplacer","Glisser la pièce choisie (touche G)",PL.mode==="deplacer")+
      bt("data-pl-mode","accrocher","Accrocher","Deux clics : la pièce, puis ce qu'elle doit toucher",PL.mode==="accrocher")+
      (outils?'<span class="vsep"></span>'+outils:"")+
      '<span class="vsep"></span>'+
      '<button class="vb" id="plCadrer" title="Cadrer la vue sur la pièce choisie"'+(p?"":" disabled")+'>cadrer</button>'+
      '<button class="vb" id="plAnnuler" title="Défaire le dernier placement (Ctrl+Z)"'+(PL.pile.length?"":" disabled")+'>↶ annuler</button>'+
    '</div>';
  }

  const vue='<div class="pl-ligne">'+
    '<span class="pl-etq">rendu</span>'+
    bt("data-pl-rendu","plein","plein","Pièces opaques",PL.rendu==="plein")+
    bt("data-pl-rendu","transparent","transparent","Plastiques translucides avec leurs arêtes, métal opaque — et contrôle des interférences avec la carte",PL.rendu==="transparent")+
    bt("data-pl-rendu","filaire","filaire","Les triangles seuls",PL.rendu==="filaire")+
    (PL.rendu==="transparent"
      ? '<input type="range" id="plOpacite" min="3" max="70" value="'+Math.round(PL.opacite*100)+'" title="Opacité des plastiques">'+
        (PL.controle?'<span class="vsep"></span>'+plControleHtml():"")
      : "")+
    '<span class="vsep"></span>'+
    '<label class="pl-ck" title="La carte telle qu\'elle est : contour, cuivre des deux faces, composants — pour y poser le boîtier. Elle ne part pas au solveur : ce qui y part est le substrat et le cuivre retenu."><input type="checkbox" id="plCarte"'+(PL.voirCarte?" checked":"")+'> carte</label>'+
    '<label class="pl-ck" title="Les composants en blocs. HAUTEURS SUPPOSÉES : le fichier IPC-2581 ne les donne pas."><input type="checkbox" id="plComposants"'+(PL.voirComposants?" checked":"")+(PL.voirCarte?"":" disabled")+'> composants</label>'+
    '<span class="vsep"></span>'+
    '<label class="pl-pas" title="Couper la vue par un plan : ce qui est au-delà n\'est ni dessiné ni visé">coupe <select id="plCoupe">'+
      ["","x","y","z"].map(a=>'<option value="'+a+'"'+(PL.coupe.axe===a?" selected":"")+'>'+(a?a.toUpperCase():"aucune")+'</option>').join("")+
    '</select></label>'+
    (PL.coupe.axe?'<input type="range" id="plCoupeT" min="0" max="1000" value="'+Math.round(PL.coupe.t*1000)+'">':"")+
    (ANT.pieces.length?'<span class="vsep"></span>'+
      '<button class="vb" id="plMasquer" title="Masquer dans la vue le corps choisi — pas dans la simulation"'+(c?"":" disabled")+'>masquer le corps</button>'+
      '<button class="vb" id="plMasquerP" title="Masquer dans la vue la pièce entière"'+(p&&p.id!=="carte"?"":" disabled")+'>la pièce</button>'+
      (nMasques?'<button class="vb" id="plMontrer" title="Remontrer tout ce qui est masqué">tout montrer ('+nMasques+')</button>':""):"")+
    '<span class="vsep"></span>'+
    '<button class="vb" id="plReplier" title="Replier la barre">'+(PL.replie?"▴":"▾")+'</button>'+
  '</div>';

  b.innerHTML=PL.replie
    ? '<div class="pl-ligne"><span class="pl-nom">'+(p?"<b>"+aEsc(p.nom)+"</b>":"placement")+'</span>'+
      '<button class="vb" id="plReplier" title="Déplier la barre">▴</button></div>'
    : pieces+vue+'<div class="pl-aide" id="plAide">'+aEsc(plAideTexte())+'</div>';

  const q=(sel)=>b.querySelector(sel);
  const refaire=function(){ ANT3D.clef=""; ant3dMaj(); antPlaceBarre(); };
  b.querySelectorAll("[data-pl-mode]").forEach(el=>el.onclick=function(){
    PL.mode=el.dataset.plMode; PL.source=null; PL.survol=null; plMarques(); ant3dDessiner(); antPlaceBarre();
  });
  b.querySelectorAll("[data-pl-axe]").forEach(el=>el.onclick=function(){ PL.axe=el.dataset.plAxe; antPlaceBarre(); });
  b.querySelectorAll("[data-pl-manip]").forEach(el=>el.onclick=function(){ PL.manip=!PL.manip; antPlaceBarre(); });
  b.querySelectorAll("[data-pl-acc]").forEach(el=>el.onclick=function(){
    PL.acc=el.dataset.plAcc; PL.source=null; PL.survol=null; plMarques(); ant3dDessiner(); antPlaceBarre();
  });
  b.querySelectorAll("[data-pl-rendu]").forEach(el=>el.onclick=function(){ PL.rendu=el.dataset.plRendu; refaire(); });
  const lier=function(sel,ev,fn){ const el=q(sel); if(el)el[ev]=function(){ fn(el); }; };
  lier("#plPas","onchange",el=>{ PL.pas=+el.value||0; antPlaceBarre(); });
  /* L'opacité change sur place, sans refaire la scène : on la met à
     l'échelle, le rapport entre plastique et diélectrique reste le même. */
  lier("#plOpacite","oninput",el=>{
    const v=Math.max(0.03,(+el.value)/100), r=v/PL.opacite;
    PL.opacite=v;
    ANT3D.monde.traverse(function(o){
      if(o.isMesh&&o.userData.piece&&o.material&&o.material.transparent&&!o.material.wireframe)
        o.material.opacity=Math.min(1,o.material.opacity*r);
    });
    ant3dDessiner();
  });
  lier("#plPasAngle","onchange",el=>{ PL.pasAngle=+el.value||0; antPlaceBarre(); });
  lier("#plOrienter","onchange",el=>{ PL.orienter=el.checked; });
  lier("#plCentrer","onchange",el=>{ PL.centrer=el.checked; });
  lier("#plCadrer","onclick",()=>{ if(PL.sel)antPlaceCadrer(PL.sel); });
  lier("#plAnnuler","onclick",()=>{ antPlaceAnnuler(); });
  lier("#plCarte","onchange",el=>{ PL.voirCarte=el.checked; refaire(); });
  lier("#plComposants","onchange",el=>{ PL.voirComposants=el.checked; refaire(); });
  lier("#plCoupe","onchange",el=>{ PL.coupe.axe=el.value; plCouper(); ant3dDessiner(); antPlaceBarre(); });
  lier("#plCoupeT","oninput",el=>{ PL.coupe.t=(+el.value)/1000; plCouper(); ant3dDessiner(); });
  lier("#plReplier","onclick",()=>{ PL.replie=!PL.replie; antPlaceBarre(); });
  const masquer=function(corps){
    const pp=plPiece(PL.sel);
    if(!pp)return;
    if(corps&&pp.corps[PL.corps])pp.corps[PL.corps].masque=true; else pp.masque=true;
    PL.sel=null; PL.corps=-1;
    if(typeof antPiecesRafraichir==="function")antPiecesRafraichir();
    antPlaceVisibilite();
  };
  lier("#plMasquer","onclick",()=>masquer(true));
  lier("#plMasquerP","onclick",()=>masquer(false));
  lier("#plMontrer","onclick",()=>{
    for(const pp of ANT.pieces){ pp.masque=false; for(const x of pp.corps)x.masque=false; }
    if(typeof antPiecesRafraichir==="function")antPiecesRafraichir();
    antPlaceVisibilite();
  });
  plManip();
}

function plAideTexte(){
  if(PL.message){ const m=PL.message; PL.message=""; return m; }
  const local=ANT.modele?"":"Aperçu sans modèle (refusé par le serveur). ";
  if(!ANT.pieces.length)return local+"La carte telle qu'elle est — contour, cuivre, composants (hauteurs supposées). Importez un boîtier à l'étape « Autour ».";
  if(PL.mode==="accrocher")return local+plEtape()+". Maj : viser à travers la première paroi. Échap : recommencer.";
  if(PL.mode==="deplacer")return local+(PL.sel
    ? (PL.manip?"Flèche : glisser le long de l'axe · anneau : tourner autour (Maj : 1°) · ":"")+
      "Glissez la pièce choisie ; ailleurs, la vue tourne. Flèches, Page haut/bas : pas à pas (Maj ×10)."
    : "Choisissez d'abord une pièce d'un clic.");
  return local+"Cliquez une pièce pour la choisir ; recliquez au même endroit pour celle de derrière.";
}

/* ==========================================================================
   La coupe
   ========================================================================== */
/* La boîte de l'ASSEMBLAGE (mm) : la carte là où elle est, et toutes les
   pièces. C'est elle que balaie le curseur de coupe — la boîte de calcul,
   elle, est comptée dans le repère de la carte, et dès que la carte a bougé
   la coupe tranchait à côté de ce qu'on regardait. */
function plBoiteAssemblage(){
  if(typeof antCarteMonde!=="function")return PL.boite;
  const c=antCarteMonde();
  const b={x1:c.x1,y1:c.y1,z1:c.z1,x2:c.x2,y2:c.y2,z2:c.z2};
  for(const p of ANT.pieces){
    const e=antPieceEmprise(p,true);
    if(!isFinite(e[0]))continue;
    b.x1=Math.min(b.x1,e[0]); b.y1=Math.min(b.y1,e[1]); b.z1=Math.min(b.z1,e[2]);
    b.x2=Math.max(b.x2,e[3]); b.y2=Math.max(b.y2,e[4]); b.z2=Math.max(b.z2,e[5]);
  }
  return b;
}

function plCouper(){
  if(!ANT3D.pret)return;
  const a=PL.coupe.axe;
  const b=a?plBoiteAssemblage():null;
  PL.plan=null;
  if(a&&b){
    const c=ANT3D.centre||{x:0,y:0,z:0};
    const v=b[a+"1"]+PL.coupe.t*(b[a+"2"]-b[a+"1"])-c[a];
    /* On garde ce qui est EN DEÇÀ : n·p + d ≥ 0, n pointant vers l'origine
       de l'axe. */
    PL.plan=new THREE.Plane(new THREE.Vector3(a==="x"?-1:0,a==="y"?-1:0,a==="z"?-1:0),v);
  }
  ANT3D.rendu.localClippingEnabled=!!PL.plan;
  ANT3D.monde.traverse(function(o){
    if(!o.material)return;
    for(const m of (Array.isArray(o.material)?o.material:[o.material]))
      m.clippingPlanes=PL.plan?[PL.plan]:null;
  });
}

/* ==========================================================================
   La carte électronique, telle qu'elle est
   --------------------------------------------------------------------------
   CE N'EST PAS CE QUI PART AU SOLVEUR, et la vue le dessine à part : le
   solveur reçoit le substrat et le cuivre RETENU ; ceci est la carte entière,
   pour poser contre elle ce qui l'entoure.

   Le cuivre des deux faces extérieures est peint dans une texture, avec les
   mêmes chemins que la vue 2D (`couche.chemins`), et les perçages y sont
   découpés : c'est la carte qu'on connaît, vue en relief. Les composants sont
   des blocs sur l'emprise de leurs pastilles, à une HAUTEUR SUPPOSÉE — le
   fichier IPC-2581 ne la donne pas — d'autant plus haute que le boîtier est
   grand : 0,3 × √(surface), entre 0,35 et 4 mm. Assez pour voir qu'un bossage
   de boîtier tombe sur un condensateur, pas pour le coter.
   ========================================================================== */
const PL_TEX={modele:null, haut:null, bas:null};
const PL_CUIVRE="#c9a34e", PL_FR4="#1f5c38";

function plTexture(couche){
  const b=V.bbox, W=b.x2-b.x1, H=b.y2-b.y1;
  const s=2048/Math.max(W,H,1e-9);
  const cv=document.createElement("canvas");
  cv.width=Math.max(2,Math.ceil(W*s)); cv.height=Math.max(2,Math.ceil(H*s));
  const c=cv.getContext("2d");
  c.setTransform(s,0,0,-s,-b.x1*s,b.y2*s);
  c.fillStyle=PL_FR4;
  if(V.contour)c.fill(V.contour,"evenodd"); else c.fillRect(b.x1,b.y1,W,H);
  if(couche&&couche.chemins){
    const ch=couche.chemins;
    c.fillStyle=PL_CUIVRE; c.strokeStyle=PL_CUIVRE;
    if(ch.plans){ c.globalAlpha=0.9; for(const p of ch.plans)c.fill(p,"evenodd"); c.globalAlpha=1; }
    c.lineCap="round"; c.lineJoin="round";
    for(const [w,p] of (ch.traits||[])){ c.lineWidth=Math.max(w||0,1/s); c.stroke(p); }
    if(ch.pads)c.fill(ch.pads,"nonzero");
  }
  c.globalCompositeOperation="destination-out";
  if(V.trous&&V.trous.pth){ c.fill(V.trous.pth,"nonzero"); c.fill(V.trous.npth,"nonzero"); }
  c.globalCompositeOperation="source-over";
  const t=new THREE.CanvasTexture(cv);
  t.anisotropy=4;
  /* Les UV d'une ShapeGeometry sont ses coordonnées (en mm) : la texture est
     calée sur la boîte de la carte par sa répétition et son décalage. */
  const k=antKmm();
  t.repeat.set(1/(W*k),1/(H*k));
  t.offset.set(-b.x1/W,-b.y1/H);
  return t;
}

function plTextures(){
  if(PL_TEX.modele===V.modele&&PL_TEX.haut)return PL_TEX;
  if(PL_TEX.haut)PL_TEX.haut.dispose();
  if(PL_TEX.bas)PL_TEX.bas.dispose();
  const cu=V.couches.filter(c=>c.cuivre).sort((a,b)=>a.seq-b.seq);
  PL_TEX.haut=plTexture(cu[0]);
  PL_TEX.bas=plTexture(cu[cu.length-1]);
  PL_TEX.modele=V.modele;
  return PL_TEX;
}

function plForme(k){
  const m=V.modele, o=m&&m.contour&&m.contour.o;
  const pts=[];
  if(o&&o.length>=6)for(let i=0;i+1<o.length;i+=2)pts.push([o[i]*k,o[i+1]*k]);
  else{
    const b=V.bbox;
    pts.push([b.x1*k,b.y1*k],[b.x2*k,b.y1*k],[b.x2*k,b.y2*k],[b.x1*k,b.y2*k]);
  }
  const f=new THREE.Shape();
  pts.forEach((p,i)=>i?f.lineTo(p[0],p[1]):f.moveTo(p[0],p[1]));
  f.closePath();
  for(const t of ((m&&m.contour&&m.contour.t)||[])){
    const h=new THREE.Path();
    for(let i=0;i+1<t.length;i+=2)i?h.lineTo(t[i]*k,t[i+1]*k):h.moveTo(t[i]*k,t[i+1]*k);
    h.closePath();
    f.holes.push(h);
  }
  return f;
}

/* Les blocs des composants, en mm dans le repère de la carte :
   [x1, y1, z1, x2, y2, z2], à leur hauteur supposée. */
function plBlocsComposants(zh,k){
  const out=[];
  for(const comp of ((V.modele&&V.modele.composants)||[])){
    const b=comp.boite;
    if(!b)continue;
    const x1=b.x1*k, y1=b.y1*k, x2=b.x2*k, y2=b.y2*k;
    const w=x2-x1, l=y2-y1;
    if(!(w>0&&l>0))continue;
    const h=Math.min(4,Math.max(0.35,0.3*Math.sqrt(w*l)));
    const cu=V.couches[comp.c];
    const [z1,z2]=(cu&&cu.dessous)?[-h,0]:[zh,zh+h];
    out.push([x1,y1,z1,x2,y2,z2]);
  }
  return out;
}

/* Les composants, en UNE géométrie : une carte en porte des centaines, et
   autant d'objets coûteraient à chaque image. */
function plComposants(zh,k,T){
  const P=[], I=[];
  for(const [x1,y1,z1,x2,y2,z2] of plBlocsComposants(zh,k)){
    const n=P.length/3;
    for(const [x,y,z] of [[x1,y1,z1],[x2,y1,z1],[x2,y2,z1],[x1,y2,z1],[x1,y1,z2],[x2,y1,z2],[x2,y2,z2],[x1,y2,z2]]){
      const q=T(x,y,z); P.push(q[0],q[1],q[2]);
    }
    for(const t of [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7])I.push(n+t);
  }
  if(!I.length)return null;
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(P,3));
  g.setIndex(I);
  const mesh=new THREE.Mesh(g,new THREE.MeshPhongMaterial({color:0x33373e, flatShading:true,
    shininess:20, side:THREE.DoubleSide}));
  mesh.userData={carte:"composants"};
  return mesh;
}

/* Appelée par 14-apercu3d.js, après le substrat. */
function antCarte3d(m,racine,T){
  if(!PL.voirCarte||!V.modele||!V.bbox||typeof THREE==="undefined")return;
  const k=antKmm();
  const zh=isFinite(m.z_haut)&&m.z_haut>0?m.z_haut:antCarteMm().z2;
  const forme=plForme(k);
  const tx=plTextures();
  const o=T(0,0,0);
  /* LES FACES TEXTURÉES SONT UN RIEN EN DEÇÀ DES FACES DE LA CARTE, et ce
     n'est pas un détail : le cuivre RETENU pour la simulation est dessiné
     exactement sur ces faces, et c'est lui qui doit se voir par-dessus la
     photographie de la carte. */
  const eps=Math.min(0.02,zh/10);
  const face=function(tex,z){
    const mesh=new THREE.Mesh(new THREE.ShapeGeometry(forme),
      new THREE.MeshLambertMaterial({map:tex, side:THREE.DoubleSide, transparent:true,
                                     alphaTest:0.5}));
    mesh.position.set(o[0],o[1],o[2]+z);
    mesh.userData={carte:"face"};
    racine.add(mesh);
  };
  face(tx.haut,zh-eps);
  face(tx.bas,eps);
  /* La tranche, sans ses deux faces : les faces sont les textures. */
  const tranche=new THREE.Mesh(new THREE.ExtrudeGeometry(forme,{depth:zh,bevelEnabled:false}),
    [new THREE.MeshBasicMaterial({visible:false}),
     new THREE.MeshLambertMaterial({color:0x1a4d30, side:THREE.DoubleSide})]);
  tranche.position.set(o[0],o[1],o[2]);
  tranche.userData={carte:"tranche"};
  racine.add(tranche);
  if(PL.voirComposants){
    const comp=plComposants(zh,k,T);
    if(comp)racine.add(comp);
  }
}

/* ==========================================================================
   Le contrôle : la carte est-elle bien dans son boîtier ?
   --------------------------------------------------------------------------
   EN RENDU TRANSPARENT, CHAQUE PLACEMENT EST VÉRIFIÉ. Voir la carte à travers
   la coque ne dit pas si une nervure la traverse d'un dixième : on le
   calcule. Chaque facette des corps simulés du boîtier est ramenée dans le
   repère de la carte, puis :

     rouge   elle entre dans l'ÉPAISSEUR de la carte, à l'intérieur de son
             contour — trous de fixation exclus : un bossage qui passe dans
             un trou de vis est à sa place ;
     orange  elle entre dans le bloc d'un composant. Les hauteurs sont
             SUPPOSÉES (le fichier IPC-2581 ne les donne pas) : c'est un
             « à vérifier », pas un verdict.

   UN CONTACT N'EST PAS UNE INTERFÉRENCE : la carte posée sur ses appuis par
   « Accrocher » touche exactement la face de la nervure. On laisse donc un
   jeu de 10 µm (`PL_JEU`) avant de compter.
   ========================================================================== */
const PL_JEU=0.01;

/* Le contour de la carte, en mm : l'extérieur et les trous. */
function plContour(k){
  const c=V.modele&&V.modele.contour;
  const lire=function(a){ const p=[]; for(let i=0;i+1<a.length;i+=2)p.push([a[i]*k,a[i+1]*k]); return p; };
  if(c&&c.o&&c.o.length>=6)return {o:lire(c.o), t:(c.t||[]).map(lire).filter(t=>t.length>=3)};
  const b=V.bbox;
  return {o:[[b.x1*k,b.y1*k],[b.x2*k,b.y1*k],[b.x2*k,b.y2*k],[b.x1*k,b.y2*k]], t:[]};
}
function plDansPoly(P,x,y){
  let d=false;
  for(let i=0,j=P.length-1;i<P.length;j=i++){
    const a=P[i], b=P[j];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])d=!d;
  }
  return d;
}
function plDansCarte(R,x,y){ return plDansPoly(R.o,x,y)&&!R.t.some(t=>plDansPoly(t,x,y)); }
/* Deux segments qui se coupent franchement (se toucher ne compte pas). */
function plCroise(a,b,c,d){
  const o=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  const d1=o(a,b,c), d2=o(a,b,d), d3=o(c,d,a), d4=o(c,d,b);
  return ((d1>0&&d2<0)||(d1<0&&d2>0))&&((d3>0&&d4<0)||(d3<0&&d4>0));
}
/* Sutherland–Hodgman sur un plan : on garde s·(p[a] − v) > 0. */
function plCouperPoly(P,a,v,s){
  const out=[];
  for(let i=0;i<P.length;i++){
    const p=P[i], q=P[(i+1)%P.length];
    const dp=s*(p[a]-v), dq=s*(q[a]-v);
    if(dp>0)out.push(p);
    if((dp>0)!==(dq>0)&&dp!==dq){
      const t=dp/(dp-dq);
      out.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1]),p[2]+t*(q[2]-p[2])]);
    }
  }
  return out;
}
/* Le morceau de facette pris dans l'épaisseur de la carte recouvre-t-il la
   carte, vu de dessus ? Un sommet dedans, une arête qui croise le contour,
   ou la carte entière sous la facette. */
function plRecouvreCarte(P,R,aretes){
  for(const p of P)if(plDansCarte(R,p[0],p[1]))return true;
  for(let i=0;i<P.length;i++){
    const a=P[i], b=P[(i+1)%P.length];
    for(const e of aretes)if(plCroise(a,b,e[0],e[1]))return true;
  }
  return P.length>=3&&plDansPoly(P,R.o[0][0],R.o[0][1]);
}

function plControler(){
  PL.controle=null;
  if(PL.rendu!=="transparent"||!V.modele||!ANT.pieces.length||
     typeof antPieceMatrice!=="function"){ plAlertes(null); return; }
  const t0=performance.now();
  const k=antKmm(), c=antCarteMm(), R=plContour(k), j=PL_JEU;
  const aretes=[];
  for(const P of [R.o].concat(R.t))
    for(let i=0;i<P.length;i++)aretes.push([P[i],P[(i+1)%P.length]]);
  const blocs=plBlocsComposants(c.z2,k);
  /* La boîte de tout ce qui peut être touché : une facette hors d'elle est
     écartée d'emblée — presque toutes, sur un boîtier. */
  const G=[c.x1,c.y1,c.z1,c.x2,c.y2,c.z2];
  for(const b of blocs)for(let a=0;a<3;a++){ G[a]=Math.min(G[a],b[a]); G[a+3]=Math.max(G[a+3],b[a+3]); }
  const B=antCarteTransfo();
  const res={carte:[], comp:[], pieces:[]};
  for(const p of ANT.pieces){
    const M=antPieceMatrice(p);
    let nc=0, nk=0;
    for(const corps of p.corps){
      if(corps.matiere==="ignore")continue;
      const t=antCorpsTab(corps), pos=t.pos, idx=t.idx;
      /* Chaque sommet une fois : dans l'assemblage (W, pour dessiner) et
         dans le repère de la carte (Q, pour tester). Q = Bᵀ·(W − c − t) + c. */
      const W=new Float64Array(pos.length), Q=new Float64Array(pos.length);
      for(let i=0;i<pos.length;i+=3){
        const x=pos[i], y=pos[i+1], z=pos[i+2];
        const wx=M[0]*x+M[4]*y+M[8]*z+M[12], wy=M[1]*x+M[5]*y+M[9]*z+M[13],
              wz=M[2]*x+M[6]*y+M[10]*z+M[14];
        W[i]=wx; W[i+1]=wy; W[i+2]=wz;
        const dx=wx-B.c[0]-B.t[0], dy=wy-B.c[1]-B.t[1], dz=wz-B.c[2]-B.t[2];
        for(let a=0;a<3;a++)Q[i+a]=B.R[0][a]*dx+B.R[1][a]*dy+B.R[2][a]*dz+B.c[a];
      }
      for(let f=0;f<idx.length;f+=3){
        const i0=3*idx[f], i1=3*idx[f+1], i2=3*idx[f+2];
        let dehors=false;
        for(let a=0;a<3&&!dehors;a++){
          const lo=Math.min(Q[i0+a],Q[i1+a],Q[i2+a]), hi=Math.max(Q[i0+a],Q[i1+a],Q[i2+a]);
          dehors=hi<=G[a]+j||lo>=G[a+3]-j;
        }
        if(dehors)continue;
        const T=[[Q[i0],Q[i0+1],Q[i0+2]],[Q[i1],Q[i1+1],Q[i1+2]],[Q[i2],Q[i2+1],Q[i2+2]]];
        let quoi="";
        let P=plCouperPoly(T,2,c.z1+j,1);
        if(P.length)P=plCouperPoly(P,2,c.z2-j,-1);
        if(P.length&&plRecouvreCarte(P,R,aretes))quoi="carte";
        else for(const b of blocs){
          let P2=T;
          for(let a=0;a<3&&P2.length;a++){
            P2=plCouperPoly(P2,a,b[a]+j,1);
            if(P2.length)P2=plCouperPoly(P2,a,b[a+3]-j,-1);
          }
          if(P2.length){ quoi="comp"; break; }
        }
        if(!quoi)continue;
        (quoi==="carte"?res.carte:res.comp).push(W[i0],W[i0+1],W[i0+2],W[i1],W[i1+1],W[i1+2],W[i2],W[i2+1],W[i2+2]);
        if(quoi==="carte")nc++; else nk++;
      }
    }
    res.pieces.push({nom:p.nom, carte:nc, comp:nk});
  }
  res.ms=performance.now()-t0;
  PL.controle=res;
  plAlertes(res);
}

/* Les facettes fautives, par-dessus tout : rouge pour la carte, orange pour
   les composants. */
function plAlertes(res){
  if(!ANT3D.pret)return;
  if(!PL.alertes){ PL.alertes=new THREE.Group(); ANT3D.scene.add(PL.alertes); }
  if(PL.alertes.parent!==ANT3D.scene)ANT3D.scene.add(PL.alertes);
  const g=PL.alertes;
  while(g.children.length){
    const o=g.children.pop();
    if(o.geometry)o.geometry.dispose();
    if(o.material)o.material.dispose();
  }
  g.visible=true;
  if(!res)return;
  const ctr=ANT3D.centre||{x:0,y:0,z:0};
  for(const [tab,coul] of [[res.carte,0xff3b30],[res.comp,0xff9d3a]]){
    if(!tab.length)continue;
    const P=new Float32Array(tab.length);
    for(let i=0;i<tab.length;i+=3){ P[i]=tab[i]-ctr.x; P[i+1]=tab[i+1]-ctr.y; P[i+2]=tab[i+2]-ctr.z; }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute("position",new THREE.BufferAttribute(P,3));
    const plein=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:coul, side:THREE.DoubleSide,
      transparent:true, opacity:0.75, depthTest:false, depthWrite:false}));
    /* Le fil de fer par-dessus : une facette vue par la tranche reste un trait. */
    const fil=new THREE.Mesh(geo.clone(),new THREE.MeshBasicMaterial({color:coul, wireframe:true,
      depthTest:false, depthWrite:false, transparent:true}));
    plein.renderOrder=fil.renderOrder=15;
    g.add(plein,fil);
  }
}

/* Ce que dit le contrôle, dans la barre. */
function plControleHtml(){
  const r=PL.controle;
  if(!r)return "";
  if(!r.pieces.some(p=>p.carte||p.comp))
    return '<span class="pl-ok" title="Aucune facette du boîtier dans l\'épaisseur de la carte ni dans un composant (jeu de 10 µm)">✓ aucune interférence</span>';
  const txt=[];
  for(const p of r.pieces.filter(p=>p.carte))
    txt.push('<span class="pl-ko" title="Facettes dans l\'épaisseur de la carte, en rouge dans la vue">⚠ '+
      aEsc(p.nom)+' traverse la carte ('+p.carte+' facettes)</span>');
  for(const p of r.pieces.filter(p=>p.comp))
    txt.push('<span class="pl-avert" title="Facettes dans un bloc de composant, en orange. Hauteurs de composants SUPPOSÉES : à vérifier">'+
      aEsc(p.nom)+' touche des composants ('+p.comp+')</span>');
  return txt.join(" ");
}
