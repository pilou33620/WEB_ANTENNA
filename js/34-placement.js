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
   haut/bas pour Z, G pour déplacer, X/Y/Z pour l'axe, Échap pour lâcher,
   Ctrl+Z pour annuler.
   ============================================================================= */

const PL={
  sel:null,            // identifiant de la pièce choisie
  corps:-1,            // rang du corps visé au dernier clic
  mode:"choisir",      // choisir | deplacer | accrocher
  axe:"xy",            // xy | x | y | z
  pas:0,               // pas de grille, en unité de la carte ; 0 = libre
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
  let delta=[0,0,0];
  if(PL.axe==="xy"){
    if(Math.abs(d.z)<1e-6)return;
    const s=(h.z-o.z)/d.z;
    if(s<0)return;
    delta=[o.x+s*d.x-h.x, o.y+s*d.y-h.y, 0];
  }else{
    /* Le point de l'axe le plus proche du rayon de la souris. */
    const u=new THREE.Vector3(PL.axe==="x"?1:0,PL.axe==="y"?1:0,PL.axe==="z"?1:0);
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
  ant3dDessiner();
  plAide("Δ "+["x","y","z"].map((a,i)=>a+" "+(reel[i]>=0?"+":"")+aNb(reel[i]/k,3)).join(" · ")+
    " "+antUnite()+" — lâcher pour poser");
}

function plGlisserFin(){
  const g=PL.glisse;
  PL.glisse=null;
  if(!g)return;
  if(g.pos.every((v,i)=>v===g.pos0[i])){ antPlaceBarre(); return; }
  plMemoriser(g.p);
  g.p.position=g.pos;
  plApres();
}

/* ==========================================================================
   La souris (appelée par 14-apercu3d.js)
   ========================================================================== */
function antPlacePointeur(quoi,e){
  if(!ANT3D.pret||!V.modele)return false;
  if(quoi==="down"){
    if(e.button!==0)return false;
    if(PL.mode==="deplacer"&&PL.sel)return plGlisserDebut(e);
    return false;
  }
  if(quoi==="glisse"){ if(PL.glisse)plGlisser(e); return true; }
  if(quoi==="up"){ plGlisserFin(); return true; }
  if(quoi==="survol"){
    const cv=document.getElementById("vue3d");
    if(PL.mode==="deplacer"){
      /* Le curseur dit ce que fera le bouton : saisir la pièce, ou tourner. */
      const sur=!!PL.sel&&plViser(e,o=>plIdDe(o)===PL.sel).length>0;
      cv.style.cursor=sur?"move":"";
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
          (v?mdlNb(v)+" "+antUnite():"libre")+'</option>').join("")+'</select></label>';
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
    bt("data-pl-rendu","transparent","transparent","Plastiques translucides, métal opaque",PL.rendu==="transparent")+
    bt("data-pl-rendu","filaire","filaire","Les triangles seuls",PL.rendu==="filaire")+
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
  b.querySelectorAll("[data-pl-acc]").forEach(el=>el.onclick=function(){
    PL.acc=el.dataset.plAcc; PL.source=null; PL.survol=null; plMarques(); ant3dDessiner(); antPlaceBarre();
  });
  b.querySelectorAll("[data-pl-rendu]").forEach(el=>el.onclick=function(){ PL.rendu=el.dataset.plRendu; refaire(); });
  const lier=function(sel,ev,fn){ const el=q(sel); if(el)el[ev]=function(){ fn(el); }; };
  lier("#plPas","onchange",el=>{ PL.pas=+el.value||0; antPlaceBarre(); });
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
}

function plAideTexte(){
  if(PL.message){ const m=PL.message; PL.message=""; return m; }
  const local=ANT.modele?"":"Aperçu sans modèle (refusé par le serveur). ";
  if(!ANT.pieces.length)return local+"La carte telle qu'elle est — contour, cuivre, composants (hauteurs supposées). Importez un boîtier à l'étape « Autour ».";
  if(PL.mode==="accrocher")return local+plEtape()+". Maj : viser à travers la première paroi. Échap : recommencer.";
  if(PL.mode==="deplacer")return local+(PL.sel
    ? "Glissez la pièce choisie ; ailleurs, la vue tourne. Flèches, Page haut/bas : pas à pas (Maj ×10)."
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

/* Les composants, en UNE géométrie : une carte en porte des centaines, et
   autant d'objets coûteraient à chaque image. */
function plComposants(zh,k,T){
  const P=[], I=[];
  for(const comp of ((V.modele&&V.modele.composants)||[])){
    const b=comp.boite;
    if(!b)continue;
    const x1=b.x1*k, y1=b.y1*k, x2=b.x2*k, y2=b.y2*k;
    const w=x2-x1, l=y2-y1;
    if(!(w>0&&l>0))continue;
    const h=Math.min(4,Math.max(0.35,0.3*Math.sqrt(w*l)));
    const cu=V.couches[comp.c];
    const [z1,z2]=(cu&&cu.dessous)?[-h,0]:[zh,zh+h];
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
