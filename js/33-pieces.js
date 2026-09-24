"use strict";
/* =============================================================================
   Antenne openEMS — 33-pieces.js
   Étape 3, « Autour » : le boîtier, les piles, ce qui entoure la carte —
   en vraies pièces, importées d'un fichier STEP ou posées depuis un modèle.

   CE QUE L'ÉTAPE « AUTOUR » NE SAVAIT PAS FAIRE. Quatre formes saisies en
   coordonnées décrivent une vis ou un réflecteur ; elles ne décrivent pas un
   boîtier réel, avec ses parois de deux millimètres, ses bossages et ses
   congés. Or c'est lui qui déplace la résonance : une paroi plastique de
   εr ≈ 3 à quelques millimètres d'une antenne imprimée la tire vers le bas
   de plusieurs pour cent, et une pile métallique posée derrière lui coupe une
   part de son rayonnement. La géométrie de ce boîtier existe déjà — dans
   l'outil de mécanique, en STEP. On la prend telle quelle.

   LE CHEMIN D'UNE PIÈCE, DE L'OCTET AU SOLVEUR.
     1. OpenCascade (le noyau de WEB_3D, en WebAssembly, dans un travailleur)
        triangule chaque solide du fichier. La finesse est celle d'une grille
        FDTD, pas d'un rendu : un dixième de millimètre de flèche.
     2. Les sommets sont RECOLLÉS ici. OpenCascade triangule chaque face à
        part et duplique les sommets de leurs arêtes communes ; un maillage
        non recollé est vu VIDE par CSXCAD — vérifié, sans un avertissement.
     3. Chaque corps reçoit une matière : métal, un plastique de la liste
        (εr et tan δ typiques, modifiables), ou « ignoré ».
     4. Le serveur revérifie tout, place la pièce, pose des lignes de maillage
        sur ses grandes faces planes, et l'écrit dans le script en polyèdre
        fermé (python/openems_pieces.py).

   CE QUI EST DESSINÉ EN 3D EST CE QUE LE SERVEUR A PLACÉ : la page garde les
   triangles, le serveur rend la matrice qu'il leur a appliquée, et la vue les
   combine. Une rotation mal comprise se voit donc là où elle compte.
   ============================================================================= */

/* ==========================================================================
   Les matières
   --------------------------------------------------------------------------
   DES VALEURS TYPIQUES, ET LE PANNEAU LE DIT. La permittivité d'un plastique
   dépend du grade, de la charge, de l'humidité — un PA66 sec et un PA66 à
   l'équilibre ne sont pas le même matériau à 2,4 GHz. Ces nombres sont ceux
   qu'on trouve dans la littérature autour du gigahertz ; ils valent mieux
   que l'air, et moins que la fiche du fournisseur. Les champs εr et tan δ
   restent donc modifiables à côté de la liste.
   ========================================================================== */
const ANT_MATIERES=[
  {id:"metal",   nom:"Métal (conducteur parfait)", m:"metal"},
  {id:"abs",     nom:"ABS",                        m:"dielectrique", er:2.8,  df:0.006},
  {id:"pc",      nom:"Polycarbonate (PC)",         m:"dielectrique", er:2.9,  df:0.007},
  {id:"pcabs",   nom:"PC/ABS",                     m:"dielectrique", er:2.9,  df:0.007},
  {id:"pa66",    nom:"Polyamide PA66",             m:"dielectrique", er:3.2,  df:0.02},
  {id:"pa66gf",  nom:"PA66 chargé verre 30 %",     m:"dielectrique", er:3.8,  df:0.015},
  {id:"pla",     nom:"PLA (impression 3D pleine)", m:"dielectrique", er:2.8,  df:0.01},
  {id:"pmma",    nom:"PMMA (acrylique)",           m:"dielectrique", er:2.6,  df:0.006},
  {id:"pp",      nom:"Polypropylène (PP)",         m:"dielectrique", er:2.25, df:0.0005},
  {id:"ptfe",    nom:"PTFE",                       m:"dielectrique", er:2.1,  df:0.0002},
  {id:"silicone",nom:"Silicone",                   m:"dielectrique", er:3.0,  df:0.01},
  {id:"verre",   nom:"Verre sodocalcique",         m:"dielectrique", er:6.5,  df:0.015},
  {id:"fr4",     nom:"FR-4",                       m:"dielectrique", er:4.3,  df:0.02},
  {id:"alumine", nom:"Alumine (céramique)",        m:"dielectrique", er:9.8,  df:0.0002},
  {id:"mousse",  nom:"Mousse (PE/PU expansé)",     m:"dielectrique", er:1.1,  df:0.001},
  {id:"autre",   nom:"Autre diélectrique",         m:"dielectrique"},
  {id:"ignore",  nom:"Ignoré (hors simulation)",   m:"ignore"}
];

function antMatiere(id){
  return ANT_MATIERES.find(x=>x.id===id)||ANT_MATIERES[ANT_MATIERES.length-1];
}

/* DEVINER N'EST PAS DÉCIDER, mais une liste de deux cents corps tous à
   « ABS » demanderait deux cents clics pour retrouver les vis. Le nom que
   l'outil de mécanique a donné dit presque toujours ce qu'est la pièce. La
   CARTE ELLE-MÊME est reconnue et ignorée : elle est déjà dans le modèle,
   exacte, avec son cuivre — la doubler en plastique la remplacerait.

   Les motifs sont testés dans l'ordre : « pcb » avant « pile », parce qu'un
   corps « PCB_pile » est une carte, pas une pile. */
/* DES MOTS, ET NON DES BOUTS DE MOTS. « alu » reconnaissait « Valuation »,
   « can » « Scan », « vis » « Devis » : une fenêtre plastique partait au
   solveur en conducteur parfait. Un mot commence et finit sur autre chose
   qu'une lettre — le souligné et les chiffres des noms de CAO comptent comme
   séparateurs : « Vis_M2 », « Batt1 », « capot_alu » sont reconnus. */
function antMots(liste,prefixe){
  return new RegExp("(?<![a-zà-ÿ])(?:"+liste+")"+(prefixe?"":"(?![a-zà-ÿ])"),"i");
}
const ANT_DEVINE=[
  [antMots("pcba?|carte|board|circuit"),                                  "ignore"],
  [antMots("pile|piles|batt|accu|cells?|cr\\d{4}|18650|lipo|li-?ion"),   "metal"],
  [antMots("batt|accu|ressort|spring|insert|rivet",true),                "metal"],
  [antMots("vis|screws?|bolts?|[eé]crous?|nuts?|washers?|rondelles?"),     "metal"],
  [antMots("blindage|shield|can|m[eé]tal|metal|alu|aluminium|aluminum|steel|acier|inox|laiton|brass|copper|cuivre|zamak"),"metal"],
  [antMots("[eé]cran|display|lcd|oled|verre|glass|vitre"),                "verre"],
  [antMots("joint|gasket|seal|silicone|clavier|keypad"),                  "silicone"],
  [antMots("mousse|foam"),                                                "mousse"],
  [antMots("pmma|acryl|acrylique|plexi|light.?pipe|guide.?lum"),          "pmma"]
];
function antMatiereDevinee(nom){
  for(const [re,id] of ANT_DEVINE)if(re.test(nom||""))return id;
  return "abs";
}

/* ==========================================================================
   Les triangles : recoller, vérifier, encoder
   ========================================================================== */
/* Le micron, comme le serveur (openems_pieces.SOUDURE_MM). */
const ANT_SOUDURE=1e-3;

function antSouder(pos,idx,tol){
  /* UNE VRAIE TOLÉRANCE, ET NON UN ARRONDI. Arrondir les coordonnées à la
     grille de la tolérance sépare deux points distants de 0,03 mm dès qu'une
     frontière de maille tombe entre eux — c'est-à-dire au hasard. On cherche
     donc dans les 27 mailles voisines un sommet déjà retenu à moins de `tol`. */
  const t=tol||ANT_SOUDURE, q=1/t, t2=t*t;
  const n=pos.length/3;
  const mailles=new Map(), renvoi=new Uint32Array(n);
  const out=[];
  for(let i=0;i<n;i++){
    const x=pos[3*i], y=pos[3*i+1], z=pos[3*i+2];
    const cx=Math.floor(x*q), cy=Math.floor(y*q), cz=Math.floor(z*q);
    let j=-1;
    for(let a=-1;a<=1&&j<0;a++)for(let b=-1;b<=1&&j<0;b++)for(let c=-1;c<=1&&j<0;c++){
      const l=mailles.get((cx+a)+","+(cy+b)+","+(cz+c));
      if(!l)continue;
      for(const k of l){
        const dx=out[3*k]-x, dy=out[3*k+1]-y, dz=out[3*k+2]-z;
        if(dx*dx+dy*dy+dz*dz<=t2){ j=k; break; }
      }
    }
    if(j<0){
      j=out.length/3; out.push(x,y,z);
      const cle=cx+","+cy+","+cz;
      const l=mailles.get(cle);
      if(l)l.push(j); else mailles.set(cle,[j]);
    }
    renvoi[i]=j;
  }
  const tri=[];
  const src=(idx&&idx.length)?idx:null;
  const nt=src?src.length:n;
  for(let k=0;k+2<nt;k+=3){
    const a=renvoi[src?src[k]:k], b=renvoi[src?src[k+1]:k+1], c=renvoi[src?src[k+2]:k+2];
    if(a===b||b===c||a===c)continue;
    tri.push(a,b,c);
  }
  return {pos:new Float32Array(out), idx:new Uint32Array(tri)};
}

/* Les arêtes qui ne bordent pas un nombre pair de triangles. Zéro pour un
   solide fermé — la seule forme que CSXCAD sache remplir. */
function antBords(idx){
  const compte=new Map();
  let nmax=0;
  for(let k=0;k<idx.length;k++)if(idx[k]>nmax)nmax=idx[k];
  const N=nmax+1;
  for(let k=0;k+2<idx.length;k+=3){
    const t=[idx[k],idx[k+1],idx[k+2]];
    for(let e=0;e<3;e++){
      const u=t[e], v=t[(e+1)%3];
      const cle=(u<v)?u*N+v:v*N+u;
      compte.set(cle,(compte.get(cle)||0)+1);
    }
  }
  let bords=0;
  compte.forEach(function(n){ if(n%2)bords++; });
  return bords;
}

/* ==========================================================================
   Fermer un corps qui ne l'est pas
   --------------------------------------------------------------------------
   UN BOÎTIER « OUVERT » N'EST PAS UN BOÎTIER : CSXCAD le verrait vide, et il
   part donc ignoré. Or c'est souvent la pièce qui compte le plus, et elle
   n'est presque jamais vraiment ouverte : ce qui la trahit, ce sont trois
   défauts de l'export, qui se réparent sans toucher à la forme.

     1. Des sommets qui devraient coïncider et ne le font qu'à quelques
        centièmes près — deux faces d'un STEP mal cousu. On recolle à des
        tolérances croissantes, jusqu'à 0,05 mm : dix fois moins que la plus
        fine cellule qu'on pose autour d'un boîtier.
     2. Des JONCTIONS EN T : un sommet d'une face tombe au milieu d'une arête
        de la voisine. Les deux bords se touchent, mais aucune arête n'est
        partagée. On coupe l'arête à ce sommet.
     3. De petits trous — une fente de quelques centièmes le long d'une arête,
        une facette oubliée. On les bouche en éventail, s'ils sont petits :
        moins d'un millimètre carré, ou deux millimètres de diagonale. Une
        vraie ouverture, un couvercle absent, reste ouverte : la boucher serait
        inventer de la matière.

   Ce qui a été fait est ÉCRIT sur le corps (`repare`), et la ligne du tableau
   le dit. Un corps qui reste ouvert après tout cela est une SURFACE — un
   export en coques et non en solides — et seule la mécanique peut le rendre.
   ========================================================================== */
function antJonctionsT(pos,tri,tol){
  const N=pos.length/3;
  const compte=new Map(), porteur=new Map();
  for(let t=0;t<tri.length/3;t++)for(let e=0;e<3;e++){
    const u=tri[3*t+e], v=tri[3*t+(e+1)%3];
    const cle=(u<v)?u*N+v:v*N+u;
    compte.set(cle,(compte.get(cle)||0)+1);
    porteur.set(cle,[t,u,v]);
  }
  const bords=[], bv=new Set();
  compte.forEach(function(n,cle){
    if(!(n%2))return;
    const [t,u,v]=porteur.get(cle);
    bords.push({t:t,a:u,b:v}); bv.add(u); bv.add(v);
  });
  const liste=Array.from(bv);
  if(!bords.length||bords.length*liste.length>6e7)return {tri:tri, n:0};
  const coupes=new Map();
  const t2=tol*tol;
  for(const e of bords){
    if(coupes.has(e.t))continue;             // une arête par triangle et par passe
    const ax=pos[3*e.a], ay=pos[3*e.a+1], az=pos[3*e.a+2];
    const dx=pos[3*e.b]-ax, dy=pos[3*e.b+1]-ay, dz=pos[3*e.b+2]-az;
    const L2=dx*dx+dy*dy+dz*dz;
    if(!(L2>0))continue;
    const sur=[];
    for(const v of liste){
      if(v===e.a||v===e.b)continue;
      const px=pos[3*v]-ax, py=pos[3*v+1]-ay, pz=pos[3*v+2]-az;
      const s=(px*dx+py*dy+pz*dz)/L2;
      if(s<=1e-6||s>=1-1e-6)continue;
      const qx=px-s*dx, qy=py-s*dy, qz=pz-s*dz;
      if(qx*qx+qy*qy+qz*qz<t2)sur.push([s,v]);
    }
    if(sur.length){ sur.sort((p,q)=>p[0]-q[0]); coupes.set(e.t,{a:e.a,b:e.b,sur:sur}); }
  }
  if(!coupes.size)return {tri:tri, n:0};
  const out=[];
  for(let t=0;t<tri.length/3;t++){
    const c=coupes.get(t);
    if(!c){ out.push(tri[3*t],tri[3*t+1],tri[3*t+2]); continue; }
    /* Le triangle est (a, b, s) dans son sens de parcours : l'éventail
       a → v1 → … → b autour de s garde ce sens. */
    let s=-1;
    for(let k=0;k<3;k++){ const w=tri[3*t+k]; if(w!==c.a&&w!==c.b)s=w; }
    const chaine=[c.a].concat(c.sur.map(x=>x[1]),[c.b]);
    for(let k=0;k+1<chaine.length;k++)out.push(chaine[k],chaine[k+1],s);
  }
  return {tri:out, n:coupes.size};
}

function antBoucher(pos,tri,aireMax,diagMax){
  const N=pos.length/3;
  const compte=new Map(), sens=new Map();
  for(let t=0;t<tri.length/3;t++)for(let e=0;e<3;e++){
    const u=tri[3*t+e], v=tri[3*t+(e+1)%3];
    const cle=(u<v)?u*N+v:v*N+u;
    compte.set(cle,(compte.get(cle)||0)+1);
    sens.set(cle,[u,v]);
  }
  /* Le bouchon parcourt le bord À REBOURS du triangle qui le borde : c'est
     ce qui garde une surface orientée d'un seul tenant. */
  const suite=new Map(), double=new Set();
  compte.forEach(function(n,cle){
    if(!(n%2))return;
    const [u,v]=sens.get(cle);
    if(suite.has(v))double.add(v);
    suite.set(v,u);
  });
  const pts=Array.from(pos), out=tri.slice(), vu=new Set();
  let bouches=0;
  suite.forEach(function(_,depart){
    if(vu.has(depart)||double.has(depart))return;
    const boucle=[];
    let w=depart;
    while(w!==undefined&&!vu.has(w)&&boucle.length<4096){ vu.add(w); boucle.push(w); w=suite.get(w); }
    if(w!==depart||boucle.length<3||boucle.some(x=>double.has(x)))return;
    let cx=0,cy=0,cz=0,nx=0,ny=0,nz=0;
    const b=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
    for(let k=0;k<boucle.length;k++){
      const i=boucle[k], j=boucle[(k+1)%boucle.length];
      const x=pos[3*i],y=pos[3*i+1],z=pos[3*i+2], x2=pos[3*j],y2=pos[3*j+1],z2=pos[3*j+2];
      cx+=x; cy+=y; cz+=z;
      nx+=(y-y2)*(z+z2); ny+=(z-z2)*(x+x2); nz+=(x-x2)*(y+y2);
      b[0]=Math.min(b[0],x); b[1]=Math.min(b[1],y); b[2]=Math.min(b[2],z);
      b[3]=Math.max(b[3],x); b[4]=Math.max(b[4],y); b[5]=Math.max(b[5],z);
    }
    const aire=Math.hypot(nx,ny,nz)/2, diag=Math.hypot(b[3]-b[0],b[4]-b[1],b[5]-b[2]);
    if(!(aire<=aireMax||diag<=diagMax))return;
    const m=pts.length/3;
    pts.push(cx/boucle.length,cy/boucle.length,cz/boucle.length);
    for(let k=0;k<boucle.length;k++)out.push(boucle[k],boucle[(k+1)%boucle.length],m);
    bouches++;
  });
  return {pos:new Float32Array(pts), tri:out, n:bouches};
}

/* Recoller, vérifier, et réparer si besoin. `fort` élargit les tolérances :
   c'est le bouton « réparer » d'une ligne restée ouverte. */
function antFermer(pos,idx,fort){
  const tols=fort?[1e-3,1e-2,5e-2,0.1,0.2]:[1e-3,1e-2,5e-2];
  let mieux=null;
  for(const tol of tols){
    const s=antSouder(pos,idx,tol);
    const b=antBords(s.idx);
    if(!mieux||b<mieux.bords)mieux={pos:s.pos, idx:s.idx, bords:b, tol:tol};
    if(!b)break;
  }
  const rapport=[];
  if(mieux.tol>ANT_SOUDURE&&mieux.bords<antBords(antSouder(pos,idx).idx))
    rapport.push("sommets recollés à "+mdlNb(mieux.tol)+" mm");
  if(!mieux.bords)return {pos:mieux.pos, idx:mieux.idx, bords:0, repare:rapport.join(", ")};
  let p=mieux.pos, tri=Array.from(mieux.idx), jonctions=0, bouches=0;
  for(let passe=0;passe<4;passe++){
    const r=antJonctionsT(p,tri,fort?0.2:0.05);
    if(!r.n)break;
    tri=r.tri; jonctions+=r.n;
  }
  if(jonctions)rapport.push(jonctions+" jonction(s) en T coupée(s)");
  let bords=antBords(tri);
  if(bords){
    const r=antBoucher(p,tri,fort?5:1,fort?5:2);
    if(r.n){ p=r.pos; tri=r.tri; bouches=r.n; rapport.push(bouches+" trou(s) bouché(s)"); }
    bords=antBords(tri);
  }
  return {pos:p, idx:new Uint32Array(tri), bords:bords, repare:rapport.join(", ")};
}

/* Retenter la fermeture d'un corps déjà importé. Rend un corps neuf (même
   nom, même matière si elle tient encore), ou null si rien n'a changé. */
function antCorpsReparer(c,fort){
  const t=antCorpsTab(c);
  const r=antCorpsNeuf(c.nom,t.pos,t.idx,null,fort);
  if(r.bords>=c.bords&&!fort)return null;
  r.masque=!!c.masque;
  if(!r.bords){
    /* Fermé : il reprend la matière qu'on lui avait donnée — ou, s'il était
       ignoré faute d'être fermé, celle que son nom suggère. */
    const voulu=(c.matiere!=="ignore")?c.matiere:antMatiereDevinee(c.nom);
    const m=antMatiere(voulu);
    r.matiere=m.id; r.er=(c.matiere!=="ignore")?c.er:(m.er||1);
    r.df=(c.matiere!=="ignore")?c.df:(m.df||0);
  }
  return r;
}

function antBoiteDe(pos){
  const b=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(let i=0;i<pos.length;i+=3)
    for(let k=0;k<3;k++){
      const v=pos[i+k];
      if(v<b[k])b[k]=v;
      if(v>b[k+3])b[k+3]=v;
    }
  return b;
}

/* Base64 dans les deux sens, par tranches : `String.fromCharCode.apply` sur
   dix mégaoctets d'un coup dépasse la pile d'appels. */
function antB64(tab){
  const o=new Uint8Array(tab.buffer,tab.byteOffset,tab.byteLength);
  let s="";
  for(let i=0;i<o.length;i+=0x8000)
    s+=String.fromCharCode.apply(null,o.subarray(i,i+0x8000));
  return btoa(s);
}
function antDeB64(b64,Type){
  const s=atob(b64||"");
  const o=new Uint8Array(s.length);
  for(let i=0;i<s.length;i++)o[i]=s.charCodeAt(i);
  return new Type(o.buffer);
}

/* LES TABLEAUX DÉCODÉS NE VIVENT PAS DANS L'ÉTAT. `ANT.pieces` part tel quel
   dans le projet (JSON) : un Float32Array y deviendrait un objet à clés
   numériques, dix fois plus lourd que sa chaîne base64. Ils sont donc gardés
   à part, à côté de l'objet qui les porte, et reconstruits à la demande. */
const ANT_PIECES_TAB=new WeakMap();
function antCorpsTab(c){
  let t=ANT_PIECES_TAB.get(c);
  if(!t||t.s!==c.sommets){
    t={s:c.sommets, pos:antDeB64(c.sommets,Float32Array),
       idx:antDeB64(c.triangles,Uint32Array)};
    ANT_PIECES_TAB.set(c,t);
  }
  return t;
}

/* Un corps neuf, à partir de triangles bruts (en millimètres). */
function antCorpsNeuf(nom,pos,idx,matiere,fort){
  const s=antFermer(pos,idx,fort);
  const bords=s.bords;
  const id=matiere||antMatiereDevinee(nom);
  /* UN CORPS OUVERT NAÎT IGNORÉ, et le dit. Le serveur le refuserait — à
     juste titre, CSXCAD le verrait vide —, et un refus dès l'import pour une
     vis mal exportée bloquerait toute la pièce. Il reste visible, grisé, et
     le choix d'une matière le renverra au refus qui explique pourquoi. */
  const mat=antMatiere(bords?"ignore":id);
  const c={nom:nom, matiere:mat.id, er:mat.er||antMatiere(id).er||1,
           df:mat.df||antMatiere(id).df||0,
           sommets:antB64(s.pos), triangles:antB64(s.idx),
           nS:s.pos.length/3, nT:s.idx.length/3, bords:bords,
           boite:antBoiteDe(s.pos)};
  if(s.repare)c.repare=s.repare;
  ANT_PIECES_TAB.set(c,{s:c.sommets, pos:s.pos, idx:s.idx});
  return c;
}

/* ==========================================================================
   Des pièces sans fichier : les piles, un boîtier autour de la carte
   --------------------------------------------------------------------------
   Les cotes des piles sont celles des normes (IEC 60086) ; les trois
   dernières sont celles des formats courants. Toutes sont MÉTALLIQUES : le
   godet d'une pile bouton, le fût d'une AA, la poche d'une LiPo (aluminium
   laminé) sont des conducteurs, et c'est tout ce que l'antenne voit.
   ========================================================================== */
const ANT_PILES={
  cr2032:{nom:"Pile CR2032", d:20,   h:3.2,  axe:"z"},
  cr2450:{nom:"Pile CR2450", d:24.5, h:5.0,  axe:"z"},
  aa:    {nom:"Pile AA",     d:14.5, h:50.5, axe:"x"},
  aaa:   {nom:"Pile AAA",    d:10.5, h:44.5, axe:"x"},
  li18650:{nom:"Accu 18650", d:18.4, h:65.0, axe:"x"},
  lipo:  {nom:"Batterie LiPo 503450", boite:[50,34,5]}
};

function antMaillageBoite(x1,y1,z1,x2,y2,z2,inverse){
  const P=[x1,y1,z1, x2,y1,z1, x2,y2,z1, x1,y2,z1,
           x1,y1,z2, x2,y1,z2, x2,y2,z2, x1,y2,z2];
  /* Normales dehors ; `inverse` les tourne dedans, pour la cavité d'une
     coque. CSXCAD compte des traversées et ne regarde pas le sens, mais le
     rendu, lui, le regarde. */
  let T=[0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4,
         1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7];
  if(inverse)for(let k=0;k<T.length;k+=3){ const t=T[k+1]; T[k+1]=T[k+2]; T[k+2]=t; }
  return {pos:new Float32Array(P), idx:new Uint32Array(T)};
}

/* Un cylindre fermé, centré sur l'origine, selon `axe`. Quarante côtés :
   l'erreur de rayon est de 0,3 %, soit 25 µm sur une AA — vingt fois moins
   que la plus fine cellule qu'on maille jamais autour d'une pile. */
function antMaillageCylindre(r,h,axe,n){
  n=n||40;
  const P=[], T=[];
  const pt=function(u,v,w){
    if(axe==="x")P.push(w,u,v); else if(axe==="y")P.push(v,w,u); else P.push(u,v,w);
  };
  pt(0,0,-h/2); pt(0,0,h/2);
  for(let i=0;i<n;i++){
    const a=2*Math.PI*i/n, u=r*Math.cos(a), v=r*Math.sin(a);
    pt(u,v,-h/2); pt(u,v,h/2);
  }
  for(let i=0;i<n;i++){
    const b0=2+2*i, h0=b0+1, b1=2+2*((i+1)%n), h1=b1+1;
    T.push(0,b1,b0, 1,h0,h1, b0,b1,h1, b0,h1,h0);
  }
  return {pos:new Float32Array(P), idx:new Uint32Array(T)};
}

/* Deux maillages en un seul : la coque et sa cavité, l'extérieur et
   l'intérieur d'une même paroi. */
function antMaillageJoindre(a,b){
  const n=a.pos.length/3;
  const pos=new Float32Array(a.pos.length+b.pos.length);
  pos.set(a.pos,0); pos.set(b.pos,a.pos.length);
  const idx=new Uint32Array(a.idx.length+b.idx.length);
  idx.set(a.idx,0);
  for(let k=0;k<b.idx.length;k++)idx[a.idx.length+k]=b.idx[k]+n;
  return {pos:pos, idx:idx};
}

/* Millimètres par unité du fichier : la position se saisit dans l'unité de
   la carte, les sommets sont toujours en millimètres. */
function antKmm(){ return (V.unite==="in")?25.4:1; }

/* La carte, en millimètres : son contour en xy, son épaisseur en z. */
function antCarteMm(){
  const k=antKmm();
  const b=V.bbox||{x1:0,y1:0,x2:10,y2:10};
  const h=(ANT.modele&&isFinite(ANT.modele.z_haut))?ANT.modele.z_haut:antHautCarte()*k;
  return {x1:b.x1*k, y1:b.y1*k, x2:b.x2*k, y2:b.y2*k, z1:0, z2:h};
}

let ANT_PIECE_NO=0;
function antPieceId(){ return "p"+Date.now().toString(36)+(ANT_PIECE_NO++); }

function antPieceNeuve(nom,source,corps){
  return {id:antPieceId(), nom:nom, source:source||"",
          position:[0,0,0], rotation:[0,0,0], corps:corps};
}

function antPiecePile(type){
  const t=ANT_PILES[type];
  const g=t.boite
    ? antMaillageBoite(-t.boite[0]/2,-t.boite[1]/2,-t.boite[2]/2,
                       t.boite[0]/2,t.boite[1]/2,t.boite[2]/2)
    : antMaillageCylindre(t.d/2,t.h,t.axe);
  const p=antPieceNeuve(t.nom,"modèle",[antCorpsNeuf(t.nom,g.pos,g.idx,"metal")]);
  /* Posée sur la carte, en son milieu : visible tout de suite, et à sa
     place la plus courante — au-dessus de la carte, puisque c'est de ce
     côté-là qu'on la cherche en 3D. On la déplace ensuite. */
  antPiecePoser(p,"centrer");
  antPiecePoser(p,"dessus");
  return p;
}

/* Le boîtier autour de la carte : une coque de paroi `ep`, à `jeu` de la
   carte sur les côtés, `dessus` au-dessus, `dessous` en dessous. Toutes les
   cotes en millimètres. C'est un boîtier de principe — celui qu'on pose
   quand la mécanique n'existe pas encore et qu'on veut savoir ce que dix
   millimètres de plastique font à la résonance. */
function antBoitierMaillage(g){
  const c=antCarteMm();
  const x1=c.x1-g.jeu, y1=c.y1-g.jeu, z1=c.z1-g.dessous;
  const x2=c.x2+g.jeu, y2=c.y2+g.jeu, z2=c.z2+g.dessus;
  const e=g.ep;
  return antMaillageJoindre(
    antMaillageBoite(x1-e,y1-e,z1-e,x2+e,y2+e,z2+e),
    antMaillageBoite(x1,y1,z1,x2,y2,z2,true));
}

function antPieceBoitier(){
  const g={type:"boitier", jeu:2, dessus:5, dessous:5, ep:2};
  const m=antBoitierMaillage(g);
  const p=antPieceNeuve("Boîtier","modèle",[antCorpsNeuf("coque",m.pos,m.idx,"abs")]);
  p.gen=g;
  antPieceSurCarte(p);
  return p;
}

function antPieceRegenerer(p){
  if(!p.gen||p.gen.type!=="boitier")return;
  const m=antBoitierMaillage(p.gen);
  const ancien=p.corps[0]||{};
  const c=antCorpsNeuf("coque",m.pos,m.idx,ancien.matiere||"abs");
  if(ancien.matiere){ c.matiere=ancien.matiere; c.er=ancien.er; c.df=ancien.df; }
  /* LA COQUE CHANGE DE TAILLE, DONC DE CENTRE — et le centre est le pivot de
     la rotation. Sans compensation, une coque tournée glisserait à chaque
     millimètre de paroi : t' = t + (R − I)(c' − c) garde la même transformation. */
  const c0=antPieceCentre(p);
  p.corps=[c];
  const c1=antPieceCentre(p), R=antRotation(p.rotation), k=antKmm();
  const dc=[c1[0]-c0[0],c1[1]-c0[1],c1[2]-c0[2]];
  for(let a=0;a<3;a++){
    const v=R[a][0]*dc[0]+R[a][1]*dc[1]+R[a][2]*dc[2]-dc[a];
    p.position[a]=+(p.position[a]+v/k).toFixed(6);
  }
}

/* ==========================================================================
   Le placement
   --------------------------------------------------------------------------
   p' = R·(p − c) + c + t, avec R = Rz·Ry·Rx (on tourne d'abord autour de X,
   puis de Y, puis de Z, les trois axes étant ceux de la CARTE) et c le
   centre de la pièce entière. C'est la même formule que le serveur
   (openems_pieces._rotation) : ici elle ne sert qu'aux boutons de pose — le
   dessin, lui, prend la matrice que le serveur rend.

   POURQUOI LE CENTRE DE LA PIÈCE ET NON L'ORIGINE DU FICHIER. Position et
   rotation à zéro laissent la pièce EXACTEMENT où le fichier la met : un
   export mécanique fait dans le repère de la carte tombe donc juste sans
   rien toucher. Et une rotation la fait tourner sur elle-même, au lieu de
   l'envoyer à l'autre bout de la boîte parce que l'origine du fichier était
   ailleurs.
   ========================================================================== */
function antRotation(r){
  const rad=Math.PI/180;
  const ca=Math.cos(r[0]*rad), sa=Math.sin(r[0]*rad);
  const cb=Math.cos(r[1]*rad), sb=Math.sin(r[1]*rad);
  const cc=Math.cos(r[2]*rad), sc=Math.sin(r[2]*rad);
  return [[cc*cb, cc*sb*sa-sc*ca, cc*sb*ca+sc*sa],
          [sc*cb, sc*sb*sa+cc*ca, sc*sb*ca-cc*sa],
          [-sb,   cb*sa,          cb*ca]];
}

/* Le centre de la pièce entière, corps ignorés compris, en mm, dans le
   repère du fichier. Il part dans le document : le serveur ne reçoit pas les
   corps ignorés et ne saurait pas le calculer. */
function antPieceCentre(p){
  if(p&&p.id==="carte")return antCarteCentre();
  const b=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(const c of p.corps)for(let k=0;k<3;k++){
    b[k]=Math.min(b[k],c.boite[k]); b[k+3]=Math.max(b[k+3],c.boite[k+3]);
  }
  if(!isFinite(b[0]))return [0,0,0];
  return [(b[0]+b[3])/2,(b[1]+b[4])/2,(b[2]+b[5])/2];
}

/* L'emprise PLACÉE de la pièce, en mm — des corps simulés seulement, sauf
   s'il n'y en a aucun. On pose ce qu'on simule : un boîtier dont la carte
   STEP est ignorée se pose par sa coque. */
function antPieceEmprise(p,tous){
  if(p&&p.id==="carte"){ const c=antCarteMonde(); return [c.x1,c.y1,c.z1,c.x2,c.y2,c.z2]; }
  const R=antRotation(p.rotation), c=antPieceCentre(p), k=antKmm();
  const t=[p.position[0]*k,p.position[1]*k,p.position[2]*k];
  const b=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  const simules=tous?[]:p.corps.filter(q=>q.matiere!=="ignore");
  for(const q of (simules.length?simules:p.corps)){
    const pos=antCorpsTab(q).pos;
    for(let i=0;i<pos.length;i+=3){
      const x=pos[i]-c[0], y=pos[i+1]-c[1], z=pos[i+2]-c[2];
      for(let a=0;a<3;a++){
        const v=R[a][0]*x+R[a][1]*y+R[a][2]*z+c[a]+t[a];
        if(v<b[a])b[a]=v;
        if(v>b[a+3])b[a+3]=v;
      }
    }
  }
  return b;
}

/* La matrice 4×4 (par colonnes, comme three.js) du placement, calculée ici.
   Elle ne sert que quand le serveur n'a pas rendu la sienne — modèle refusé :
   voir `antPlaceModeleLocal` (34-placement.js). Même formule que
   openems_pieces._matrice. */
function antPieceMatrice(p){
  const k=antKmm();
  return antMatriceDe(antRotation(p.rotation),antPieceCentre(p),p.position.map(v=>v*k));
}

/* p -> R·(p − c) + c + t, en 4×4 par colonnes. */
function antMatriceDe(R,c,t){
  const d=[0,1,2].map(i=>c[i]+t[i]-(R[i][0]*c[0]+R[i][1]*c[1]+R[i][2]*c[2]));
  return [R[0][0],R[1][0],R[2][0],0, R[0][1],R[1][1],R[2][1],0,
          R[0][2],R[1][2],R[2][2],0, d[0],d[1],d[2],1];
}

/* La matrice d'une pièce DANS LE REPÈRE DE LA CARTE — ce que le serveur
   reçoit. Sert à l'aperçu sans modèle (34-placement.js). */
function antPieceMatriceCarte(p){
  const r=antPieceRelative(p), k=antKmm();
  return antMatriceDe(antRotation(r.rotation),antPieceCentre(p),r.position.map(v=>v*k));
}

/* ==========================================================================
   La carte dans l'assemblage
   --------------------------------------------------------------------------
   ON DÉPLACE LA CARTE COMME UNE PIÈCE, MAIS LE SOLVEUR NE LE SAIT PAS. Sa
   grille est alignée sur la carte, et tout ce que le serveur reçoit est
   compté dans le repère de la carte : cuivre, ports, substrat. La carte a
   donc une position et une rotation dans l'ASSEMBLAGE (`ANT.carte3d`, dans
   l'unité du fichier et en degrés, autour de son centre), et ce sont les
   pièces qu'on envoie au serveur exprimées PAR RAPPORT À ELLE :

       pièce vue de la carte = B⁻¹ ∘ pièce dans l'assemblage

   Déplacer la carte dans un boîtier revient donc exactement à déplacer le
   boîtier autour de la carte en sens inverse — ce que la simulation voit —,
   mais c'est la carte qui bouge à l'écran, comme on l'a demandé. Tourner la
   carte de 30° tourne le boîtier de −30° dans la grille : ses parois y
   deviennent des marches d'escalier, et c'est la vérité du calcul.
   ========================================================================== */
function antCarteRepere(){
  if(!ANT.carte3d||!Array.isArray(ANT.carte3d.position))
    ANT.carte3d={position:[0,0,0], rotation:[0,0,0]};
  return ANT.carte3d;
}
/* LE PIVOT DE LA CARTE NE DÉPEND QUE DE LA CARTE. Il se prenait sur
   `antCarteMm`, dont la hauteur vient du DERNIER MODÈLE rendu — ou, après un
   refus, de l'empilage seul, sans l'épaisseur du cuivre. Le pivot changeait
   alors d'une requête à l'autre, et avec une carte tournée autour de X ou Y
   la place des pièces envoyée au solveur bougeait toute seule. Le pivot est
   un choix de convention : il doit seulement être le même à chaque fois. */
function antCarteCentre(){
  const k=antKmm();
  const b=V.bbox||{x1:0,y1:0,x2:10,y2:10};
  return [(b.x1+b.x2)/2*k,(b.y1+b.y2)/2*k,antHautCarte()*k/2];
}
function antCarteTransfo(){
  const r=antCarteRepere(), k=antKmm();
  return {R:antRotation(r.rotation), c:antCarteCentre(), t:r.position.map(v=>v*k)};
}
function antCarteBouge(){
  const r=antCarteRepere();
  return r.position.some(v=>v)||r.rotation.some(v=>v);
}
function antCarteMatrice(){
  const B=antCarteTransfo();
  return antMatriceDe(B.R,B.c,B.t);
}
/* La boîte de la carte DANS L'ASSEMBLAGE (mm) : c'est contre elle que se
   font « centrer sur la carte », « poser dessus », et le rapatriement d'une
   pièce importée loin. Tournée, la carte a pour boîte celle de ses coins. */
function antCarteMonde(){
  const c=antCarteMm();
  if(!antCarteBouge())return c;
  const B=antCarteTransfo();
  const b=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(const x of [c.x1,c.x2])for(const y of [c.y1,c.y2])for(const z of [c.z1,c.z2]){
    const q=[x-B.c[0],y-B.c[1],z-B.c[2]];
    for(let a=0;a<3;a++){
      const v=B.R[a][0]*q[0]+B.R[a][1]*q[1]+B.R[a][2]*q[2]+B.c[a]+B.t[a];
      b[a]=Math.min(b[a],v); b[a+3]=Math.max(b[a+3],v);
    }
  }
  return {x1:b[0],y1:b[1],z1:b[2],x2:b[3],y2:b[4],z2:b[5]};
}

/* R = Rz·Ry·Rx -> les trois angles, en degrés. Les quarts de tour sortent
   ronds : un 89,99999997 dans un champ se lit comme une erreur. */
function antAngles(R){
  const deg=180/Math.PI;
  let a, c;
  /* atan2 et non asin : près d'un quart de tour, asin perd la moitié de ses
     chiffres, et 90° ressortait 89,999999. */
  const b=Math.atan2(-R[2][0],Math.hypot(R[0][0],R[1][0]));
  if(Math.abs(Math.cos(b))>1e-9){
    a=Math.atan2(R[2][1],R[2][2]);
    c=Math.atan2(R[1][0],R[0][0]);
  }else{
    a=0; c=Math.atan2(-R[0][1],R[1][1]);
  }
  return [a,b,c].map(function(x){
    let d=x*deg;
    const r=Math.round(d);
    if(Math.abs(d-r)<1e-6)d=r;
    d=+d.toFixed(6);
    return (d<=-180)?d+360:d;
  });
}

/* La position et la rotation d'une pièce VUES DE LA CARTE : ce que reçoit le
   serveur. Rb^T·Rp pour la rotation ; pour la position, l'image du centre
   de la pièce ramenée dans le repère de la carte. */
function antPieceRelative(p){
  if(!antCarteBouge())return {position:p.position.slice(), rotation:p.rotation.slice()};
  const B=antCarteTransfo(), k=antKmm();
  const Rp=antRotation(p.rotation), c=antPieceCentre(p), tp=p.position.map(v=>v*k);
  const Rt=[0,1,2].map(i=>[0,1,2].map(j=>B.R[j][i]));
  const R2=[0,1,2].map(i=>[0,1,2].map(j=>Rt[i][0]*Rp[0][j]+Rt[i][1]*Rp[1][j]+Rt[i][2]*Rp[2][j]));
  const w=[0,1,2].map(a=>c[a]+tp[a]-B.c[a]-B.t[a]);
  const t2=[0,1,2].map(a=>Rt[a][0]*w[0]+Rt[a][1]*w[1]+Rt[a][2]*w[2]+B.c[a]-c[a]);
  return {position:t2.map(v=>+(v/k).toFixed(6)), rotation:antAngles(R2)};
}

/* Poser une pièce générée dans le repère de la carte là où la carte EST :
   même rotation qu'elle, et la translation qui fait coïncider les deux. */
function antPieceSurCarte(p){
  if(!antCarteBouge())return;
  const B=antCarteTransfo(), c=antPieceCentre(p), k=antKmm();
  p.rotation=antCarteRepere().rotation.slice();
  const d=[c[0]-B.c[0],c[1]-B.c[1],c[2]-B.c[2]];
  p.position=[0,1,2].map(a=>+((B.R[a][0]*d[0]+B.R[a][1]*d[1]+B.R[a][2]*d[2]+B.c[a]+B.t[a]-c[a])/k).toFixed(6));
}

/* La carte vue par les outils de placement : une « pièce » dont la position
   et la rotation SONT celles de `ANT.carte3d`. Les gestes (glisser, flèches,
   accrocher, annuler) l'écrivent sans rien savoir d'elle. */
const ANT_CARTE_PIECE={id:"carte", nom:"Carte électronique", source:"carte", corps:[],
  get position(){ return antCarteRepere().position; },
  set position(v){ antCarteRepere().position=v; },
  get rotation(){ return antCarteRepere().rotation; },
  set rotation(v){ antCarteRepere().rotation=v; }};

/* Les gestes de pose. Ils ne touchent QU'À LA POSITION : la rotation reste
   celle qu'on a saisie, et un « poser dessus » après un quart de tour pose
   la pièce couchée, pas la pièce d'avant. */
function antPiecePoser(p,quoi){
  const b=antPieceEmprise(p), c=antCarteMonde(), k=antKmm();
  if(!isFinite(b[0]))return;
  const d=[0,0,0];
  if(quoi==="centrer"){
    d[0]=(c.x1+c.x2)/2-(b[0]+b[3])/2;
    d[1]=(c.y1+c.y2)/2-(b[1]+b[4])/2;
  }else if(quoi==="dessus")  d[2]=c.z2-b[2];
  else if(quoi==="dessous")  d[2]=c.z1-b[5];
  else if(quoi==="milieu")   d[2]=(c.z1+c.z2)/2-(b[2]+b[5])/2;
  for(let a=0;a<3;a++)p.position[a]=+((p.position[a]*k+d[a])/k).toFixed(4);
}

/* ==========================================================================
   L'import
   ========================================================================== */
const ANT_FORMATS_3D={stp:"step", step:"step", igs:"iges", iges:"iges",
                      brep:"brep", brp:"brep", stl:"stl"};

/* LA FINESSE D'UNE GRILLE FDTD, PAS CELLE D'UN RENDU. Un dixième de
   millimètre de flèche est cinq fois plus fin que la plus petite cellule
   qu'on pose autour d'un boîtier ; une triangulation plus fine ne changerait
   rien à ce que le solveur voit, et multiplierait le temps qu'il passe à
   décider ce qui est dedans. */
const ANT_OCCT_PARAMS={linearUnit:"millimeter", linearDeflectionType:"absolute_value",
                       linearDeflection:0.1, angularDeflection:0.5};

let ANT_OCCT=null, ANT_OCCT_FILE=Promise.resolve();

function antOcctLire(format,tampon,nom,surProgres){
  const tache=ANT_OCCT_FILE.then(function(){
    return new Promise(function(ok,ko){
      if(!ANT_OCCT)ANT_OCCT=new Worker("js/travailleur-occt.js");
      const w=ANT_OCCT;
      const ecouter=function(ev){
        const d=ev.data;
        if(d.type==="progres"){ if(surProgres)surProgres(d.etape); return; }
        w.removeEventListener("message",ecouter);
        if(d.type==="erreur")ko(new Error(d.message)); else ok(d);
      };
      w.addEventListener("message",ecouter);
      w.onerror=function(e){
        w.removeEventListener("message",ecouter);
        /* Un travailleur mort ne se relève pas : le suivant sera neuf. */
        ANT_OCCT=null;
        ko(new Error("Le lecteur CAO s'est interrompu : "+(e.message||"erreur inconnue")));
      };
      w.postMessage({format:format, tampon:tampon, nom:nom, params:ANT_OCCT_PARAMS},[tampon]);
    });
  });
  ANT_OCCT_FILE=tache.catch(function(){});
  return tache;
}

/* Le STL : binaire ou texte, sans nom ni unité. Une unité de fichier vaut un
   millimètre, comme dans WEB_3D — c'est la convention des chaînes
   d'impression 3D, d'où viennent presque tous les STL. */
function antStlLire(tampon){
  const o=new Uint8Array(tampon);
  const dv=new DataView(tampon);
  const n=o.length>=84?dv.getUint32(80,true):0;
  if(o.length>=84&&84+50*n===o.length){
    const pos=new Float32Array(9*n);
    for(let i=0;i<n;i++){
      const base=84+50*i+12;
      for(let k=0;k<9;k++)pos[9*i+k]=dv.getFloat32(base+4*k,true);
    }
    return pos;
  }
  const texte=new TextDecoder().decode(o);
  const v=[];
  const re=/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  let m;
  while((m=re.exec(texte)))v.push(+m[1],+m[2],+m[3]);
  if(!v.length||v.length%9)throw new Error("Ce STL n'est ni un STL binaire ni un STL texte lisible.");
  return new Float32Array(v);
}

function antPiecesDire(html,rang){
  const el=document.getElementById("antPiecesEtat");
  if(!el)return;
  el.className="note"+(rang==="alerte"?" alerte":"");
  el.innerHTML=html||"";
  el.hidden=!html;
}

async function antPiecesImporter(fichiers){
  for(const f of Array.from(fichiers||[])){
    const ext=(f.name.split(".").pop()||"").toLowerCase();
    const format=ANT_FORMATS_3D[ext];
    if(!format){
      antPiecesDire("« "+aEsc(f.name)+" » : format non pris en charge. "+
        "Formats lus : STEP, IGES, BREP, STL.","alerte");
      continue;
    }
    try{
      antPiecesDire("Lecture de « "+aEsc(f.name)+" »…");
      const tampon=await f.arrayBuffer();
      const corps=[];
      if(format==="stl"){
        const pos=antStlLire(tampon);
        const nom=f.name.replace(/\.[^.]+$/,"");
        corps.push(antCorpsNeuf(nom,pos,null));
      }else{
        const r=await antOcctLire(format,tampon,f.name,function(t){ antPiecesDire(aEsc(t)); });
        r.maillages.forEach(function(m,i){
          if(!m.index.length&&!m.position.length)return;
          corps.push(antCorpsNeuf(m.nom||m.noeud||("corps "+(i+1)),m.position,m.index));
        });
      }
      if(!corps.length)throw new Error("Aucun solide dans ce fichier.");
      const p=antPieceNeuve(f.name.replace(/\.[^.]+$/,""),f.name,corps);

      /* UN FICHIER DANS LE REPÈRE DE LA CARTE TOMBE JUSTE, ET ON NE LE
         TOUCHE PAS. Un fichier dessiné ailleurs — une pile modélisée à
         l'origine, un boîtier dont l'origine est un coin — tomberait loin de
         l'antenne : on le ramène alors au milieu de la carte, posé dessus,
         et on le dit. */
      const b=antPieceEmprise(p), c=antCarteMonde();
      const marge=Math.max(c.x2-c.x1,c.y2-c.y1);
      const loin=!(b[3]>c.x1-marge&&b[0]<c.x2+marge&&b[4]>c.y1-marge&&b[1]<c.y2+marge);
      if(loin){ antPiecePoser(p,"centrer"); antPiecePoser(p,"dessus"); }

      ANT.pieces.push(p);
      const ouverts=corps.filter(q=>q.bords).length;
      const nT=corps.reduce((s,q)=>s+q.nT,0);
      antPiecesDire("« "+aEsc(f.name)+" » : "+corps.length+" corps, "+aEnt(nT)+
        " triangles."+(loin?" Son repère était loin de la carte : elle est "+
        "posée au milieu, dessus — les boutons de pose la déplacent.":
        " Elle garde la place que son fichier lui donne.")+
        (ouverts?" <b>"+ouverts+" corps ouvert(s)</b>, ignoré(s) : CSXCAD les "+
        "verrait vides.":""),ouverts?"alerte":"");
      antPiecesRafraichir();
      antMaj(true);
    }catch(e){
      antPiecesDire("« "+aEsc(f.name)+" » : "+aEsc(e.message||e),"alerte");
    }
  }
}

/* ==========================================================================
   Le document
   ========================================================================== */
function antPiecesDoc(){
  return ANT.pieces.map(function(p){
    const r=antPieceRelative(p);
    return {id:p.id, nom:p.nom, position:r.position,
            rotation:r.rotation, centre:antPieceCentre(p),
            corps:p.corps.map(function(c){
              const mat=antMatiere(c.matiere);
              const d={nom:c.nom, materiau:mat.m, matiere:mat.nom};
              if(mat.m==="ignore")return d;
              d.sommets=c.sommets; d.triangles=c.triangles;
              if(mat.m==="dielectrique"){ d.er=c.er; d.df=c.df; }
              return d;
            })};
  });
}

/* La relecture d'un projet. Une pièce qui a perdu ses triangles ne se
   répare pas : on la laisse tomber plutôt que d'envoyer au serveur une coque
   vide qui le ferait refuser tout le reste. */
function antPiecesRelire(liste){
  if(!Array.isArray(liste))return [];
  const out=[];
  for(const p of liste){
    if(!p||!Array.isArray(p.corps))continue;
    const corps=p.corps.filter(c=>c&&typeof c.sommets==="string"&&typeof c.triangles==="string")
      .map(function(c){
        let q=Object.assign({},c);
        if(!ANT_MATIERES.some(x=>x.id===q.matiere))q.matiere="ignore";
        /* Un corps enregistré ouvert, avant que l'outil sache réparer : on
           retente à la relecture, et il revient fermé s'il peut l'être. */
        if(q.bords>0){
          const r=antCorpsReparer(q,false);
          if(r)q=r;
        }
        if(!Array.isArray(q.boite)||q.boite.length!==6)q.boite=antBoiteDe(antCorpsTab(q).pos);
        return q;
      });
    if(!corps.length)continue;
    const trois=function(v){ return (Array.isArray(v)&&v.length===3)?v.map(x=>+x||0):[0,0,0]; };
    out.push({id:String(p.id||antPieceId()), nom:String(p.nom||"pièce"),
              source:String(p.source||""), position:trois(p.position),
              rotation:trois(p.rotation), corps:corps, masque:!!p.masque,
              ...(p.gen&&p.gen.type==="boitier"?{gen:p.gen}:{})});
  }
  return out;
}

/* ==========================================================================
   Le panneau
   ========================================================================== */
function antPiecesListeMatieres(sel){
  return ANT_MATIERES.map(x=>'<option value="'+x.id+'"'+(x.id===sel?" selected":"")+'>'+
    aEsc(x.nom)+'</option>').join("");
}

/* Ce que le serveur a dit d'un corps : fermé ou pas, combien de triangles
   ont PARTI. Lu dans le modèle, par l'identifiant de la pièce et le rang du
   corps : c'est le seul endroit où l'on apprend ce qui a été réellement
   retenu. */
function antPieceModele(p){
  const m=ANT.modele;
  return (m&&m.pieces||[]).find(q=>q.id===p.id)||null;
}

function antCorpsLigne(p,i,c,j){
  const mat=antMatiere(c.matiere);
  const die=(mat.m==="dielectrique");
  const etat=c.bords
    ? '<span class="piece-etat ko" title="'+c.bords+' arête(s) ne bordent qu\'une face : CSXCAD verrait ce corps vide.'+
      (c.repare?' Déjà tenté : '+aEsc(c.repare)+'.':'')+'">ouvert</span>'+
      '<button class="tb mini" data-p-reparer="'+i+'" data-c="'+j+'" title="Retenter de le fermer, tolérances élargies (0,2 mm, trous jusqu\'à 5 mm²)">réparer</button>'
    : '<span class="piece-etat'+(c.repare?' repare':'')+'"'+
      (c.repare?' title="Fermé par l\'outil : '+aEsc(c.repare)+'"':'')+'>'+aEnt(c.nT)+' tri.'+
      (c.repare?' ✓':'')+'</span>';
  const oeil='<input type="checkbox" class="oeil" data-p-oeil="'+i+'" data-c="'+j+'"'+
    (c.masque?"":" checked")+' title="Visible dans la vue 3D (sans effet sur la simulation)">';
  /* LA TAILLE SOUS LE NOM : un export STEP nomme ses corps
     « Admi05EC3FB26751 », et c'est souvent « 20 × 20 × 3,2 » qui dit qu'on
     regarde la pile. Le clic dans la vue 3D, lui, allume la ligne. */
  const b=c.boite, k=antKmm();
  const taille=[0,1,2].map(a=>aNb((b[a+3]-b[a])/k,1)).join(" × ");
  return '<tr class="'+(mat.m==="ignore"?"ignore":mat.m)+(c.masque?" masque":"")+'" data-corps="'+j+'">'+
    '<td>'+oeil+'</td>'+
    '<td class="nom" title="'+aEsc(c.nom)+'">'+aEsc(c.nom)+
      '<small>'+taille+' '+antUnite()+'</small></td>'+
    '<td><select data-p="'+i+'" data-c="'+j+'" data-ou="matiere">'+
      antPiecesListeMatieres(c.matiere)+'</select></td>'+
    '<td>'+(die?'<input type="text" inputmode="decimal" spellcheck="false" data-p="'+i+
      '" data-c="'+j+'" data-ou="er" value="'+mdlNb(c.er)+'" title="εr">':"")+'</td>'+
    '<td>'+(die?'<input type="text" inputmode="decimal" spellcheck="false" data-p="'+i+
      '" data-c="'+j+'" data-ou="df" value="'+mdlNb(c.df)+'" title="tan δ">':"")+'</td>'+
    '<td>'+etat+'</td></tr>';
}

/* Ce que la pièce est, en un mot : d'où elle vient. */
function antPieceGenre(p){
  if(p.gen)return "Boîtier";
  if(p.source==="modèle")return "Modèle";
  const ext=(String(p.source||"").split(".").pop()||"").toLowerCase();
  const f=ANT_FORMATS_3D[ext];
  return f?f.toUpperCase():"Pièce";
}

function antPieceFiche(p,i){
  const u=antUnite();
  const nSim=p.corps.filter(c=>c.matiere!=="ignore").length;
  const nT=p.corps.reduce((s,c)=>s+(c.matiere!=="ignore"?c.nT:0),0);
  const xyz=function(etq,ou,v,unite){
    return '<div class="xyz"><label>'+etq+'</label>'+[0,1,2].map(k=>
      '<input type="text" inputmode="decimal" spellcheck="false" data-p="'+i+
      '" data-ou="'+ou+'" data-k="'+k+'" value="'+mdlNb(v[k])+'">').join("")+
      '<span class="u">'+unite+'</span></div>';
  };
  let gen="";
  if(p.gen&&p.gen.type==="boitier"){
    const g=p.gen;
    const champ=function(etq,cle){
      return '<span><label>'+etq+'</label><input type="text" inputmode="decimal" spellcheck="false" data-p="'+i+
        '" data-gen="'+cle+'" value="'+mdlNb(g[cle])+'"></span>';
    };
    gen='<div class="ligne">'+champ("jeu autour","jeu")+champ("au-dessus","dessus")+
      champ("en dessous","dessous")+champ("paroi","ep")+'<span class="unite">mm</span></div>';
  }
  const tous=(p.corps.length>1)
    ? '<div class="xyz"><label>tous les corps</label><select data-p-tous="'+i+'">'+
      '<option value="">— appliquer à tous —</option>'+antPiecesListeMatieres("")+'</select></div>'
    : "";
  const choisie=(typeof PL!=="undefined"&&PL.sel===p.id);
  return '<div class="objet piece'+(choisie?" choisie":"")+'" data-p-fiche="'+i+'">'+
    '<div class="objet-tete">'+
      '<b>'+aEsc(antPieceGenre(p))+'</b>'+
      '<input type="text" class="nom" data-p="'+i+'" data-ou="nom" value="'+aEsc(p.nom)+'">'+
      '<span class="piece-compte">'+nSim+'/'+p.corps.length+' corps · '+aEnt(nT)+' tri.</span>'+
      '<input type="checkbox" class="oeil" data-p-oeil="'+i+'"'+(p.masque?"":" checked")+' title="Pièce visible dans la vue 3D (sans effet sur la simulation)">'+
      '<button class="tb mini" data-p-voir="'+i+'" title="Voir la pièce en 3D, la choisir, et la placer à la souris">3D</button>'+
      '<button class="tb mini" data-p-suppr="'+i+'" title="Retirer cette pièce">✕</button>'+
    '</div>'+gen+
    xyz("position","position",p.position,u)+
    xyz("rotation X Y Z","rotation",p.rotation,"°")+
    '<div class="pnl-bar piece-pose">'+
      '<button class="tb mini" data-p-poser="centrer" data-p="'+i+'" title="Centre la pièce sur la carte en X et Y">centrer sur la carte</button>'+
      '<button class="tb mini" data-p-poser="dessus" data-p="'+i+'" title="Le dessous de la pièce sur le dessus de la carte">poser dessus</button>'+
      '<button class="tb mini" data-p-poser="dessous" data-p="'+i+'" title="Le dessus de la pièce sous le dessous de la carte">poser dessous</button>'+
      '<button class="tb mini" data-p-poser="milieu" data-p="'+i+'" title="Centre la pièce en Z sur l\'épaisseur de la carte — un boîtier qui l\'entoure">centrer en Z</button>'+
      '<button class="tb mini" data-p-tourner="0" data-p="'+i+'" title="Un quart de tour autour de X">↻ X</button>'+
      '<button class="tb mini" data-p-tourner="1" data-p="'+i+'" title="Un quart de tour autour de Y">↻ Y</button>'+
      '<button class="tb mini" data-p-tourner="2" data-p="'+i+'" title="Un quart de tour autour de Z">↻ Z</button>'+
    '</div>'+tous+
    '<div class="piece-corps"><table><thead><tr><th title="Visible en 3D">3D</th><th>corps</th><th>matière</th>'+
      '<th>ε<sub>r</sub></th><th>tan δ</th><th></th></tr></thead><tbody>'+
      p.corps.map((c,j)=>antCorpsLigne(p,i,c,j)).join("")+'</tbody></table></div>'+
    '<div class="piece-emprise" data-p-emprise="'+i+'">'+antPieceEmpriseHtml(p)+'</div>'+
    '</div>';
}

/* Où le SERVEUR a posé la pièce — ce qui part au solveur, et non ce que la
   page croit avoir demandé. */
function antPieceEmpriseHtml(p){
  const sm=antPieceModele(p);
  if(!sm||!sm.emprise)return "";
  const k=antKmm();
  return "placée de ("+sm.emprise.slice(0,3).map(v=>aNb(v/k,2)).join(" ; ")+
    ") à ("+sm.emprise.slice(3).map(v=>aNb(v/k,2)).join(" ; ")+") "+antUnite();
}

/* À chaque réponse du serveur : les emprises, sans redessiner les champs. */
function antPiecesActualiser(box){
  if(!box)return;
  box.querySelectorAll("[data-p-emprise]").forEach(function(el){
    const p=ANT.pieces[+el.dataset.pEmprise];
    if(p)el.innerHTML=antPieceEmpriseHtml(p);
  });
}

/* La fiche de la carte : sa place dans l'assemblage. Mêmes champs, mêmes
   gestes que ceux d'une pièce — elle se choisit, se glisse et s'accroche
   aussi dans la vue 3D. */
function antCarteFiche(){
  const r=antCarteRepere(), u=antUnite();
  const choisie=(typeof PL!=="undefined"&&PL.sel==="carte");
  const xyz=function(etq,ou,v,unite){
    return '<div class="xyz"><label>'+etq+'</label>'+[0,1,2].map(k=>
      '<input type="text" inputmode="decimal" spellcheck="false" data-carte-ou="'+ou+
      '" data-k="'+k+'" value="'+mdlNb(v[k])+'">').join("")+'<span class="u">'+unite+'</span></div>';
  };
  return '<div class="objet piece carte'+(choisie?" choisie":"")+'" data-p-fiche="carte">'+
    '<div class="objet-tete"><b>Carte</b><span class="nom">'+aEsc(V.fichier||"la carte")+'</span>'+
      '<button class="tb mini" data-carte-voir title="Voir la carte en 3D, la choisir, la placer à la souris">3D</button>'+
      '<button class="tb mini" data-carte-zero title="Remettre la carte à l\'origine (les pièces ne bougent pas)"'+
        (antCarteBouge()?"":" disabled")+'>↺ origine</button></div>'+
    xyz("position","position",r.position,u)+
    xyz("rotation X Y Z","rotation",r.rotation,"°")+
    '<div class="pnl-bar piece-pose">'+
      '<button class="tb mini" data-carte-tourner="0" title="Un quart de tour autour de X">↻ X</button>'+
      '<button class="tb mini" data-carte-tourner="1" title="Un quart de tour autour de Y">↻ Y</button>'+
      '<button class="tb mini" data-carte-tourner="2" title="Un quart de tour autour de Z">↻ Z</button>'+
    '</div>'+
    '<p class="note">Déplacer la carte déplace la carte, pas les pièces. Le calcul, lui, se fait '+
    'toujours dans le repère de la carte : c\'est le boîtier qu\'il voit bouger autour d\'elle.</p>'+
    '</div>';
}

function antPiecesHtml(){
  const piles=Object.keys(ANT_PILES).map(t=>
    '<button class="tb mini" data-p-pile="'+t+'" title="'+aEsc(ANT_PILES[t].nom)+
    ', métallique, posée sur la carte">+ '+aEsc(ANT_PILES[t].nom.replace(/^(Pile|Accu|Batterie) /,""))+
    '</button>').join("");
  const carte=V.modele?antCarteFiche():"";
  const liste=ANT.pieces.length
    ? ANT.pieces.map(antPieceFiche).join("")
    : '<div class="rien">Aucune pièce. L\'antenne est simulée nue, dans l\'air — '+
      'juste pour un module seul, faux dès qu\'il est dans un produit.</div>';
  return `
<label>Le boîtier, les piles — ce qui entoure la carte
  <small>STEP · IGES · BREP · STL, une matière par corps</small></label>
<p class="note">Un boîtier plastique à quelques millimètres d'une antenne
  imprimée la <b>désaccorde de plusieurs pour cent</b> ; une pile métallique
  derrière elle lui <b>coupe une part de son rayonnement</b>. Importez la
  pièce telle que la mécanique l'a dessinée : chaque solide du fichier
  devient un corps, et chaque corps reçoit sa matière. Le bouton
  <b>3D</b> d'une pièce l'ouvre dans la vue 3D, où elle se <b>choisit</b>,
  se <b>déplace</b> à la souris et s'<b>accroche</b> — une face contre une
  face, un point sur un point.</p>
${antSubstratCarteHtml()}
<div class="raccourcis">
  <button class="tb mini" id="antPieceImporter" title="STEP, IGES, BREP ou STL — plusieurs à la fois">Importer un fichier 3D…</button>
  <button class="tb mini" data-p-boitier title="Une coque plastique de principe, autour de la carte">+ Boîtier autour de la carte</button>
</div>
<div class="raccourcis piles"><span>Piles</span>${piles}</div>
<input type="file" id="antPieceFichier" accept=".step,.stp,.iges,.igs,.brep,.brp,.stl" multiple hidden>
<p class="note" id="antPiecesEtat" hidden></p>
${carte}${liste}
<p class="note">Les εr et tan δ de la liste sont <b>typiques</b> autour du
  gigahertz ; la fiche du fournisseur fait foi, et les champs se corrigent.
  Le métal est un conducteur parfait. Un corps <b>ignoré</b> reste dessiné en
  gris dans la vue 3D — c'est ainsi qu'on vérifie qu'un export mécanique
  tombe sur la carte — mais ne part pas au solveur. La carte elle-même, quand
  l'export la contient, est ignorée d'office : elle est déjà dans le modèle,
  cuivre compris.</p>`;
}

/* LE SUBSTRAT DE LA CARTE ENTIÈRE. Sans lui, le stratifié simulé s'arrête à
   l'emprise du cuivre retenu — l'antenne et sa masse —, et le reste de la
   carte n'existe pas pour le solveur. Avec un boîtier autour, c'est ce qui
   fausse le plus : la paroi voit une carte plus petite que la vraie. */
function antSubstratCarteHtml(){
  const c=V.modele&&V.modele.contour&&V.modele.contour.o;
  if(!c||c.length<6)return '<p class="note">Le fichier ne donne pas de contour de carte : '+
    'le substrat simulé couvre l\'emprise du cuivre retenu.</p>';
  const b=V.bbox||{x1:0,y1:0,x2:0,y2:0}, u=antUnite();
  return '<label class="ck"><input type="checkbox" id="antSubstratCarte"'+
    (ANT.substratCarte?" checked":"")+'> Le substrat suit le <b>contour de la carte entière</b> ('+
    aNb(b.x2-b.x1,1)+' × '+aNb(b.y2-b.y1,1)+' '+u+')'+
    '<small>et non la seule emprise du cuivre retenu. Le maillage couvre alors toute la carte : '+
    'plus de cellules, mais un stratifié qui a la taille du vrai — ce que la paroi d\'un '+
    'boîtier voit.</small></label>';
}

/* Redessine le bloc des pièces, et lui seul : le reste de l'étape garde ses
   champs, son curseur et ce qu'on y tapait. */
function antPiecesRafraichir(){
  const box=document.getElementById("antPieces");
  if(!box)return;
  const etat=document.getElementById("antPiecesEtat");
  const garde=etat&&!etat.hidden?{html:etat.innerHTML, cls:etat.className}:null;
  box.innerHTML=antPiecesHtml();
  if(garde){
    const e=document.getElementById("antPiecesEtat");
    if(e){ e.innerHTML=garde.html; e.className=garde.cls; e.hidden=false; }
  }
  antChampsFideles(box);
  antPiecesLier(box);
}

function antPiecesLier(box){
  if(!box)return;
  const q=function(sel){ return box.querySelectorAll(sel); };
  const entree=box.querySelector("#antPieceFichier");
  const bImp=box.querySelector("#antPieceImporter");
  if(bImp&&entree){
    bImp.onclick=function(){ entree.value=""; entree.click(); };
    entree.onchange=function(){ antPiecesImporter(entree.files); };
  }
  /* Le dépôt d'un fichier sur le bloc : le geste qu'on fait déjà pour
     ouvrir une carte. Il s'arrête ici — la page, elle, ouvrirait le STEP
     comme une carte et le refuserait. */
  box.ondragover=function(e){ e.preventDefault(); e.stopPropagation(); box.classList.add("depot"); };
  box.ondragleave=function(){ box.classList.remove("depot"); };
  box.ondrop=function(e){
    e.preventDefault(); e.stopPropagation(); box.classList.remove("depot");
    if(e.dataTransfer&&e.dataTransfer.files)antPiecesImporter(e.dataTransfer.files);
  };

  const b=box.querySelector("[data-p-boitier]");
  if(b)b.onclick=function(){
    ANT.pieces.push(antPieceBoitier());
    antPiecesDire("Boîtier ABS posé à 2 mm de la carte, paroi de 2 mm. Les "+
      "cotes se règlent dans sa fiche.");
    antPiecesRafraichir(); antMaj(true);
  };
  q("[data-p-pile]").forEach(function(el){
    el.onclick=function(){
      ANT.pieces.push(antPiecePile(el.dataset.pPile));
      antPiecesDire("");
      antPiecesRafraichir(); antMaj(true);
    };
  });
  q("[data-p-oeil]").forEach(function(el){
    el.onchange=function(){
      const p=ANT.pieces[+el.dataset.pOeil];
      if(!p)return;
      if(el.dataset.c!=null){ const c=p.corps[+el.dataset.c]; if(c)c.masque=!el.checked; }
      else p.masque=!el.checked;
      const tr=el.closest("tr");
      if(tr)tr.classList.toggle("masque",!el.checked);
      if(typeof antPlaceVisibilite==="function")antPlaceVisibilite();
    };
  });
  q("[data-p-reparer]").forEach(function(el){
    el.onclick=function(){
      const p=ANT.pieces[+el.dataset.pReparer], j=+el.dataset.c;
      if(!p||!p.corps[j])return;
      const avant=p.corps[j].bords;
      const r=antCorpsReparer(p.corps[j],true);
      p.corps[j]=r;
      antPiecesDire(r.bords
        ? "« "+aEsc(r.nom)+" » reste ouvert ("+r.bords+" arête(s) de bord, "+avant+" avant) : "+
          "c'est une surface, pas un solide. Réexportez-le en solide depuis la mécanique."
        : "« "+aEsc(r.nom)+" » est fermé ("+aEsc(r.repare||"recollé")+") et reprend une matière.",
        r.bords?"alerte":"");
      antPiecesRafraichir(); antMaj(true);
    };
  });
  const sc=box.querySelector("#antSubstratCarte");
  if(sc)sc.onchange=function(){ ANT.substratCarte=sc.checked; antMaj(true); };
  const bVoir=box.querySelector("[data-carte-voir]");
  if(bVoir)bVoir.onclick=function(){ if(typeof antPlaceVoir==="function")antPlaceVoir("carte"); };
  const bZero=box.querySelector("[data-carte-zero]");
  if(bZero)bZero.onclick=function(){
    if(typeof plMemoriser==="function")plMemoriser(ANT_CARTE_PIECE);
    ANT.carte3d={position:[0,0,0], rotation:[0,0,0]};
    antPiecesRafraichir(); antMaj(true);
    if(ANT.vue==="3d"&&typeof ant3dMaj==="function")ant3dMaj();
  };
  q("[data-carte-tourner]").forEach(function(el){
    el.onclick=function(){
      const r=antCarteRepere(), k=+el.dataset.carteTourner;
      if(typeof plMemoriser==="function")plMemoriser(ANT_CARTE_PIECE);
      r.rotation[k]=((Math.round(r.rotation[k])+90)%360+360)%360;
      antPiecesRafraichir(); antMaj(true);
      if(ANT.vue==="3d"&&typeof ant3dMaj==="function")ant3dMaj();
    };
  });
  q("[data-carte-ou]").forEach(function(el){
    const ecrire=function(fin){
      const s=String(el.value).trim().replace(",",".");
      if(!fin&&(s===""||s==="."||s==="-"||s.endsWith(".")))return;
      const v=parseFloat(s);
      if(!isFinite(v))return;
      antCarteRepere()[el.dataset.carteOu][+el.dataset.k]=v;
      if(fin)el.value=mdlNb(v);
      antMaj(fin);
      if(ANT.vue==="3d"&&typeof ant3dMaj==="function")ant3dMaj();
    };
    el.oninput=function(){ ecrire(false); };
    el.onchange=function(){ ecrire(true); };
  });
  q("[data-p-voir]").forEach(function(el){
    el.onclick=function(){
      const p=ANT.pieces[+el.dataset.pVoir];
      if(p&&typeof antPlaceVoir==="function")antPlaceVoir(p.id);
    };
  });
  q("[data-p-suppr]").forEach(function(el){
    el.onclick=function(){
      ANT.pieces.splice(+el.dataset.pSuppr,1);
      antPiecesRafraichir(); antMaj(true);
    };
  });
  q("[data-p-poser]").forEach(function(el){
    el.onclick=function(){
      const p=ANT.pieces[+el.dataset.p];
      if(!p)return;
      antPiecePoser(p,el.dataset.pPoser);
      antPiecesRafraichir(); antMaj(true);
    };
  });
  q("[data-p-tourner]").forEach(function(el){
    el.onclick=function(){
      const p=ANT.pieces[+el.dataset.p];
      if(!p)return;
      const k=+el.dataset.pTourner;
      p.rotation[k]=((Math.round(p.rotation[k])+90)%360+360)%360;
      antPiecesRafraichir(); antMaj(true);
    };
  });
  q("[data-p-tous]").forEach(function(el){
    el.onchange=function(){
      const p=ANT.pieces[+el.dataset.pTous];
      if(!p||!el.value)return;
      const mat=antMatiere(el.value);
      /* Les corps ouverts restent ignorés : leur donner une matière en bloc
         ferait refuser toute la pièce pour une vis mal exportée. */
      for(const c of p.corps){
        if(c.bords)continue;
        c.matiere=mat.id;
        if(mat.er){ c.er=mat.er; c.df=mat.df; }
      }
      antPiecesRafraichir(); antMaj(true);
    };
  });
  q("[data-gen]").forEach(function(el){
    const ecrire=function(fin){
      const p=ANT.pieces[+el.dataset.p];
      if(!p||!p.gen)return;
      const s=String(el.value).trim().replace(",",".");
      if(!fin&&(s===""||s.endsWith(".")||s==="-"))return;
      const v=parseFloat(s);
      if(!isFinite(v))return;
      /* La paroi ne descend pas sous un dixième de millimètre : en dessous,
         aucune grille ne la verrait, et la coque deviendrait une surface. */
      p.gen[el.dataset.gen]=(el.dataset.gen==="ep")?Math.max(0.1,v):Math.max(0,v);
      antPieceRegenerer(p);
      if(fin)el.value=mdlNb(p.gen[el.dataset.gen]);
      antMaj(fin);
    };
    el.oninput=function(){ ecrire(false); };
    el.onchange=function(){ ecrire(true); };
  });
  q("[data-p][data-ou]").forEach(function(el){
    const ecrire=function(fin){
      const p=ANT.pieces[+el.dataset.p];
      if(!p)return;
      const ou=el.dataset.ou;
      const c=(el.dataset.c!=null)?p.corps[+el.dataset.c]:null;
      if(ou==="nom"){ p.nom=el.value; antMaj(fin); return; }
      if(ou==="matiere"&&c){
        const mat=antMatiere(el.value);
        c.matiere=mat.id;
        if(mat.er){ c.er=mat.er; c.df=mat.df; }
        antPiecesRafraichir(); antMaj(true);
        return;
      }
      const s=String(el.value).trim().replace(",",".");
      if(!fin&&(s===""||s==="."||s==="-"||s.endsWith(".")))return;
      const v=parseFloat(s);
      if(!isFinite(v))return;
      if(c){
        /* Une valeur retouchée n'est plus celle du catalogue : la ligne
           passe à « autre », sans quoi « ABS » s'afficherait devant une
           permittivité qui n'est pas celle de l'ABS. */
        c[ou]=(ou==="er")?Math.max(1,v):Math.max(0,v);
        const lib=antMatiere(c.matiere);
        if(lib.er&&(c.er!==lib.er||c.df!==lib.df))c.matiere="autre";
        if(fin){ el.value=mdlNb(c[ou]); antPiecesRafraichir(); }
      }else{
        p[ou][+el.dataset.k]=v;
        if(fin)el.value=mdlNb(v);
      }
      antMaj(fin);
    };
    if(el.tagName==="SELECT")el.onchange=function(){ ecrire(true); };
    else{
      el.oninput=function(){ ecrire(false); };
      el.onchange=function(){ ecrire(true); };
    }
  });
}

/* ==========================================================================
   La vue 3D
   --------------------------------------------------------------------------
   Appelée par 14-apercu3d.js. Les triangles viennent de la page, la matrice
   du serveur. Le métal est opaque, le diélectrique translucide — sans quoi un
   boîtier masquerait tout ce qu'il contient —, l'ignoré est un fantôme gris.
   ========================================================================== */
/* TROIS RENDUS, choisis dans la barre de la vue 3D (34-placement.js).
   « plein » par défaut : un boîtier se regarde comme un objet, opaque, et
   c'est ainsi qu'on voit ce qu'il cache — puis on le masque, on le coupe, ou
   l'on passe en transparent. Le métal est gris acier et brillant, le
   plastique mat et clair, l'ignoré sombre : les trois se distinguent sans
   légende. */
function antPieceMateriau3d(mat){
  const rendu=(typeof PL!=="undefined"&&PL.rendu)||"plein";
  if(rendu==="filaire")
    return new THREE.MeshBasicMaterial({wireframe:true, transparent:true,
      color:mat==="metal"?0xc8ccd2:(mat==="dielectrique"?0x8af0ff:0x6c727c),
      opacity:mat==="ignore"?0.25:0.6, depthWrite:false});
  if(rendu==="transparent")
    return new THREE.MeshPhongMaterial({flatShading:true, side:THREE.DoubleSide,
      color:mat==="metal"?0xc8ccd2:(mat==="dielectrique"?0x8af0ff:0x6c727c),
      transparent:mat!=="metal", opacity:mat==="metal"?1:(mat==="dielectrique"?0.26:0.14),
      depthWrite:mat==="metal", shininess:30});
  return new THREE.MeshPhongMaterial({flatShading:true, side:THREE.DoubleSide,
    color:mat==="metal"?0x9ea6b0:(mat==="dielectrique"?0xd9d4c7:0x4a4f57),
    shininess:mat==="metal"?80:12, specular:mat==="metal"?0x777777:0x1a1a1a});
}

function antPieces3d(m,racine,cx,cy,cz){
  if(typeof THREE==="undefined")return;
  for(const sp of (m.pieces||[])){
    const p=ANT.pieces.find(q=>q.id===sp.id);
    if(!p)continue;
    const M=new THREE.Matrix4().fromArray(sp.matrice);
    /* Le serveur a placé la pièce DANS LE REPÈRE DE LA CARTE ; la carte est
       elle-même placée dans l'assemblage : B·M. */
    M.premultiply(new THREE.Matrix4().fromArray(antCarteMatrice()));
    M.premultiply(new THREE.Matrix4().makeTranslation(-cx,-cy,-cz));
    p.corps.forEach(function(c,j){
      const sc=sp.corps[j]||{};
      const mat=sc.materiau||antMatiere(c.matiere).m;
      const t=antCorpsTab(c);
      const geo=new THREE.BufferGeometry();
      geo.setAttribute("position",new THREE.BufferAttribute(t.pos,3));
      geo.setIndex(new THREE.BufferAttribute(t.idx,1));
      const mesh=new THREE.Mesh(geo,antPieceMateriau3d(mat));
      mesh.matrixAutoUpdate=false;
      mesh.matrix.copy(M);
      /* Ce qui permet à 34-placement.js de savoir ce qu'un clic a touché. */
      mesh.userData={piece:p.id, corps:j};
      racine.add(mesh);
    });
  }
}

/* L'empreinte vue de dessus, pour la surimpression 2D (15-overlay2d.js) :
   le rectangle de chaque corps simulé, en unité du fichier. */
function antPiecesEmpreintes(m,k){
  const out=[];
  for(const sp of (m.pieces||[]))
    for(const c of sp.corps)
      if(c.emprise)out.push({metal:c.materiau==="metal",
        x:c.emprise[0]*k, y:c.emprise[1]*k,
        w:(c.emprise[3]-c.emprise[0])*k, h:(c.emprise[4]-c.emprise[1])*k});
  return out;
}
