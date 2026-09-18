"use strict";
/* =============================================================================
   Antenne openEMS — 11-geometrie.js
   Du cuivre routé aux polygones que le solveur sait mailler.

   LE PROBLÈME, EN UNE PHRASE. Un fichier IPC-2581 décrit le cuivre par des
   TRAITS — une polyligne et une largeur, un arc et une largeur —, alors qu'un
   solveur de champ ne connaît que des SURFACES. Entre les deux, quelqu'un doit
   transformer « ce trait de 0,4 mm de large » en « ce polygone fermé ». C'est
   tout ce que fait ce fichier.

   POURQUOI LES POLYGONES SE CHEVAUCHENT, ET POURQUOI C'EST VOULU. Un trait
   coudé devient ici un rectangle par segment plus un disque à chaque sommet,
   qui se recouvrent largement. On pourrait calculer leur union exacte ; ce
   serait un travail considérable (offset de polyligne, arcs de jonction, cas
   dégénérés) pour un gain nul : CSXCAD superpose des primitives de MÊME
   matériau sans que cela change quoi que ce soit au maillage ni au champ. Deux
   morceaux de métal qui se touchent sont un morceau de métal. En revanche, le
   nombre de primitives compte pour le temps de construction du modèle — d'où
   le disque réduit à un octogone, et non à trente-deux côtés.

   CE QUI N'EST PAS TRAITÉ, ET SE VOIT DANS L'ASSISTANT :
     — les textes de sérigraphie (ce n'est pas du cuivre conducteur utile) ;
     — les formes « utilisateur » dont le dictionnaire ne donne que des traits ;
     — les découpes internes d'une pastille (un padstack en donne rarement).
   ============================================================================= */

/* Nombre de côtés d'un cercle discrétisé. Huit pour les jonctions de traits
   — invisibles dans le résultat —, vingt-quatre pour une pastille ou un via,
   dont la forme, elle, porte du courant de bord. */
const ANT_COTES_JONCTION=8;
const ANT_COTES_PASTILLE=24;

/* --------------------------------------------------------------------------
   Primitives
   -------------------------------------------------------------------------- */
function antCercle(cx,cy,r,cotes){
  const p=[];
  const n=cotes||ANT_COTES_PASTILLE;
  for(let i=0;i<n;i++){
    const a=2*Math.PI*i/n;
    p.push(cx+r*Math.cos(a), cy+r*Math.sin(a));
  }
  return p;
}

/* Le rectangle d'un segment de trait : le segment épaissi de sa demi-largeur
   de part et d'autre. */
function antSegment(x1,y1,x2,y2,demi){
  const dx=x2-x1, dy=y2-y1, L=Math.hypot(dx,dy);
  if(!(L>0))return null;
  const nx=-dy/L*demi, ny=dx/L*demi;
  return [x1+nx,y1+ny, x2+nx,y2+ny, x2-nx,y2-ny, x1-nx,y1-ny];
}

/* Un rectangle centré, tourné puis déplacé. */
function antRect(cx,cy,w,h,rotDeg){
  const a=(rotDeg||0)*Math.PI/180, co=Math.cos(a), si=Math.sin(a);
  const out=[];
  for(const [dx,dy] of [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]])
    out.push(cx+dx*co-dy*si, cy+dx*si+dy*co);
  return out;
}

/* Un rectangle aux coins arrondis, en polygone. Un ovale est le cas r = min/2. */
function antRectArrondi(cx,cy,w,h,r,rotDeg){
  r=Math.max(0,Math.min(r,Math.min(w,h)/2));
  if(r<=0)return antRect(cx,cy,w,h,rotDeg);
  const a=(rotDeg||0)*Math.PI/180, co=Math.cos(a), si=Math.sin(a);
  const n=6;                       // points par coin
  const out=[];
  const coins=[[ w/2-r,  h/2-r, 0],
               [-w/2+r,  h/2-r, Math.PI/2],
               [-w/2+r, -h/2+r, Math.PI],
               [ w/2-r, -h/2+r, 3*Math.PI/2]];
  for(const [qx,qy,a0] of coins)
    for(let i=0;i<=n;i++){
      const t=a0+Math.PI/2*i/n;
      const dx=qx+r*Math.cos(t), dy=qy+r*Math.sin(t);
      out.push(cx+dx*co-dy*si, cy+dx*si+dy*co);
    }
  return out;
}

/* --------------------------------------------------------------------------
   Traits et arcs
   -------------------------------------------------------------------------- */
/* Une polyligne de largeur w -> une liste de polygones fermés.
   Un trait de largeur nulle (`f` = HOLLOW sans épaisseur) n'est pas du cuivre
   remplissable : on lui donne malgré tout une largeur minimale plutôt que de
   le perdre, et l'assistant le compte à part. */
function antPolyligneEnPolys(pts,w,sortie){
  const demi=Math.max(w,0)/2;
  if(!(demi>0)||pts.length<4)return 0;
  let n=0;
  for(let i=0;i+3<pts.length;i+=2){
    const r=antSegment(pts[i],pts[i+1],pts[i+2],pts[i+3],demi);
    if(r){sortie.push({o:r});n++;}
  }
  /* Les jonctions et les extrémités : un disque de la demi-largeur. Il tient
     lieu de raccord ET de bout arrondi, ce qui est la convention IPC-2581
     pour un trait ordinaire. */
  for(let i=0;i+1<pts.length;i+=2)
    sortie.push({o:antCercle(pts[i],pts[i+1],demi,ANT_COTES_JONCTION)});
  return n;
}

/* Un arc -> une polyligne, puis des polygones. Le pas angulaire est choisi
   pour que la corde s'écarte du cercle de moins d'un centième de la largeur
   du trait : plus fin ne se verrait pas, plus grossier ferait un polygone à
   la place d'un arc. */
function antArcEnPolyligne(a){
  const g=mdlArc(a);
  if(!(g.r>0))return [a.s[0],a.s[1],a.e[0],a.e[1]];
  const total=mdlArcAngle(g);
  const fleche=Math.max((a.w||0.1)/100, g.r/1000);
  let pas=2*Math.acos(Math.max(-1,Math.min(1,1-fleche/g.r)));
  if(!(pas>1e-4))pas=1e-4;
  const n=Math.max(2,Math.min(512,Math.ceil(total/pas)));
  const sens=g.h?-1:1;
  const out=[];
  for(let i=0;i<=n;i++){
    const t=g.d+sens*total*i/n;
    out.push(g.cx+g.r*Math.cos(t), g.cy+g.r*Math.sin(t));
  }
  return out;
}

/* --------------------------------------------------------------------------
   Pastilles
   -------------------------------------------------------------------------- */
/* La forme d'une pastille, en polygone, autour de son origine. `d` est le
   diamètre de repli quand le padstack ne référence aucune forme connue —
   c'est fréquent sur un perçage mécanique. */
function antFormePoints(id,d){
  const f=V.modele.formes[id];
  if(!f){
    return d>0 ? antCercle(0,0,d/2,ANT_COTES_PASTILLE) : null;
  }
  switch(f.t){
    case "CIRCLE":     return antCercle(0,0,(f.d||d||0)/2,ANT_COTES_PASTILLE);
    case "RECTCENTER": return antRect(0,0,f.w||0,f.h||0,0);
    case "OVAL":       return antRectArrondi(0,0,f.w||0,f.h||0,
                                             Math.min(f.w||0,f.h||0)/2,0);
    case "RECTROUND":  return antRectArrondi(0,0,f.w||0,f.h||0,f.r||0,0);
    /* Le chanfrein rendu comme un arrondi : à l'échelle où le maillage
       travaille, la différence tient dans une cellule. */
    case "RECTCHAM":   return antRectArrondi(0,0,f.w||0,f.h||0,f.ch||0,0);
    case "POLYGON":    return (f.p&&f.p.length>=6)?f.p.slice():null;
    default:           return d>0?antCercle(0,0,d/2,ANT_COTES_PASTILLE):null;
  }
}

/* Une pastille posée (telle que `mdlPadPlace` la produit) -> un polygone du
   monde. Rotation et miroir viennent du boîtier qui la porte. */
function antPadEnPoly(q){
  const brut=antFormePoints(q.forme,q.d);
  if(!brut||brut.length<6)return null;
  const a=(q.rot||0)*Math.PI/180, co=Math.cos(a), si=Math.sin(a);
  const mir=q.mir?-1:1;
  const out=[];
  for(let i=0;i+1<brut.length;i+=2){
    const x=brut[i]*mir, y=brut[i+1];
    out.push(q.x+x*co-y*si, q.y+x*si+y*co);
  }
  return out;
}

/* --------------------------------------------------------------------------
   Le rassemblement
   -------------------------------------------------------------------------- */
/* Tout le cuivre retenu, rangé par couche, plus les vias.

   CE QUI EST RETENU : les objets dont le net est dans `ANT.nets` OU dans le
   net de masse, et dont la couche est cochée. Les deux conditions, pas une :
   un net d'antenne qui court sur une couche non modélisée n'a rien à faire
   dans le modèle, et une couche cochée ne fait pas entrer tous ses nets.

   ET LES FORMES DE `ANT.formes`, sous la même règle de couche. Elles sont là
   pour les fichiers qui ne déclarent pas de connectivité — tout leur cuivre
   tombe dans un seul fourre-tout, voir `antNetFourreTout` — et pour les cas
   où le net est plus gros que l'antenne. Elles passent après les nets et
   sautent ce qui y est déjà entré : le même polygone deux fois au même
   endroit, ce sont des arêtes en double à mailler, pour rien.
*/
/* LE RÉSULTAT EST RETENU, PARCE QU'IL EST DEMANDÉ BIEN PLUS SOUVENT QU'IL NE
   CHANGE. Cinq endroits l'appellent, et l'un d'eux est la surimpression de la
   carte (15-overlay2d.js) — c'est-à-dire le chemin de `peindre`, donc CHAQUE
   image d'un déplacement ou d'un zoom. Sur une carte de fabrication dont le
   plan de masse porte mille sommets, c'était quelques milliers d'allocations
   par image pour redonner exactement le même tableau.

   DEUX CLÉS, ET IL EN FALLAIT DEUX. L'âge de l'état (`ANT_AGE`, voir
   10-etat.js) dit qu'une décision a changé — un net désigné, une couche
   décochée. L'identité de `V.modele` dit que la CARTE a changé, ce que l'âge
   ne verrait pas : le balayage recharge un modèle par point sans passer par
   `antMaj`, et rendre là le cuivre du point précédent enverrait N documents
   identiques au solveur — N courbes superposées qu'on prendrait pour un
   résultat. C'est exactement la faute que 24-balayage.js existe pour éviter.

   EFFET DE BORD RANGÉ AU PASSAGE. Cette fonction ÉCRIT `ANT.viasSupposes`,
   que l'étape « Le cuivre » affiche. Il était donc recalculé pendant un
   repaint : un état de l'assistant que le zoom pouvait toucher. Il ne bouge
   plus qu'avec le résultat qu'il décrit.

   CE QUI EST RENDU N'EST PAS UNE COPIE : les cinq appelants le lisent, aucun
   ne le modifie, et en faire une copie profonde coûterait ce qu'on vient
   d'économiser. Un appelant qui voudrait y toucher doit copier ce qu'il prend.
*/
const ANT_CUIVRE_CACHE={age:-1, modele:null, valeur:null};

function antCuivreDuModele(){
  if(ANT_CUIVRE_CACHE.valeur &&
     ANT_CUIVRE_CACHE.age===ANT_AGE &&
     ANT_CUIVRE_CACHE.modele===V.modele)
    return ANT_CUIVRE_CACHE.valeur;
  const valeur=antCuivreCalcul();
  ANT_CUIVRE_CACHE.age=ANT_AGE;
  ANT_CUIVRE_CACHE.modele=V.modele;
  ANT_CUIVRE_CACHE.valeur=valeur;
  return valeur;
}

function antCuivreCalcul(){
  const blocs=new Map();          // index de couche -> {couche, polys}
  const compte={pistes:0,arcs:0,plans:0,pads:0,fins:0};

  const nets=new Set(ANT.nets);
  if(ANT.netMasse>=0)nets.add(ANT.netMasse);

  const bloc=function(ci){
    if(!blocs.has(ci))
      blocs.set(ci,{couche:V.couches[ci].nom,polys:[]});
    return blocs.get(ci);
  };

  for(const ni of nets){
    const n=V.parNet[ni];
    if(!n)continue;

    for(const p of n.pistes){
      if(!ANT.couches.has(p.c))continue;
      if(!(p.w>0)){compte.fins++;continue;}
      compte.pistes+=antPolyligneEnPolys(p.p,p.w,bloc(p.c).polys);
    }

    for(const a of n.arcs){
      if(!ANT.couches.has(a.c))continue;
      if(!(a.w>0)){compte.fins++;continue;}
      antPolyligneEnPolys(antArcEnPolyligne(a),a.w,bloc(a.c).polys);
      compte.arcs++;
    }

    /* Les versements : ils sont DÉJÀ des surfaces, avec leurs découpes. C'est
       le seul cuivre qui n'a rien à subir ici, et c'est aussi celui qui pèse
       le plus lourd — un plan de masse découpé porte parfois mille sommets. */
    for(const g of n.plans){
      if(!ANT.couches.has(g.c))continue;
      for(const ct of (g.g||[])){
        if(!ct.o||ct.o.length<6)continue;
        blocs.has(g.c)||bloc(g.c);
        bloc(g.c).polys.push({o:ct.o.slice(),
                              t:(ct.t||[]).filter(t=>t&&t.length>=6)
                                          .map(t=>t.slice())});
        compte.plans++;
      }
    }

    if(ANT.avecPastilles)
      for(const q of n.pads){
        if(!ANT.couches.has(q.c))continue;
        const poly=antPadEnPoly(q);
        if(poly){bloc(q.c).polys.push({o:poly});compte.pads++;}
      }
  }

  /* Les formes désignées une à une. `deja` répond à « cet objet est-il déjà
     entré par son net ? » sans tenir de liste : il suffit de relire la
     condition qui l'aurait fait entrer. Elle s'appuie sur le fait que le net
     PORTÉ par l'objet est celui du casier où `mdlCharger` l'a rangé — les
     casiers sont construits à partir de ce champ-là, les deux ne peuvent pas
     diverger. */
  const deja=function(net,ci,cond){
    return cond!==false&&typeof net==="number"&&net>=0&&nets.has(net)&&
           ANT.couches.has(ci);
  };
  const trous=[];
  for(const f of ANT.formes){
    const o=f.o;
    if(f.k==="via"){trous.push(o);continue;}
    if(!ANT.couches.has(f.c))continue;
    if(f.k==="piste"){
      if(deja(o.n,o.c))continue;
      if(!(o.w>0)){compte.fins++;continue;}
      compte.pistes+=antPolyligneEnPolys(o.p,o.w,bloc(o.c).polys);
    }else if(f.k==="plan"){
      if(deja(o.n,o.c))continue;
      for(const ct of (o.g||[])){
        if(!ct.o||ct.o.length<6)continue;
        bloc(o.c).polys.push({o:ct.o.slice(),
                              t:(ct.t||[]).filter(t=>t&&t.length>=6)
                                          .map(t=>t.slice())});
        compte.plans++;
      }
    }else if(f.k==="pad"){
      if(deja(o.pad?o.pad.n:-1,o.c,ANT.avecPastilles))continue;
      const poly=antPadEnPoly(o);
      if(poly){bloc(o.c).polys.push({o:poly});compte.pads++;}
    }
  }

  /* Les vias des nets d'abord — c'est là que `ANT.viasSupposes` se remet à
     zéro —, les perçages désignés ensuite. Ceux-là entrent MÊME SI la case
     « vias de ces nets » est décochée : cette case dit « ne traîne pas tous
     les vias du net », pas « ignore celui que je viens de cliquer ». */
  let vias=[];
  if(ANT.avecVias)vias=antVias(nets);
  else ANT.viasSupposes=0;          // sans antVias, personne ne le remet à zéro
  for(const t of trous){
    const v=antViaDeTrou(t);
    if(v&&!vias.some(w=>w.x===v.x&&w.y===v.y&&w.d===v.d))vias.push(v);
  }

  return {blocs:Array.from(blocs.values()),
          vias:vias,
          compte:compte};
}

/* Les perçages métallisés des nets retenus.

   LA PORTÉE D'UN VIA EST LA CHOSE QU'ON LIT LE PLUS SOUVENT DE TRAVERS. Le
   fichier ne la met pas sur le trou mais sur le CALQUE de perçage, et quand
   elle manque, « vide » ne veut pas dire « traversant » : il veut dire « le
   fichier ne le dit pas ». Le parseur distingue les deux (`sa`/`sb` absents
   quand rien n'est déclaré) et on garde la distinction jusqu'ici : un via
   dont la portée est inconnue est modélisé traversant — c'est le seul repli
   raisonnable — mais l'assistant le COMPTE et le dit, parce qu'un via enterré
   pris pour traversant relie des couches qu'il ne relie pas.
*/
function antVias(nets){
  const out=[];
  ANT.viasSupposes=0;
  for(const ni of nets){
    const n=V.parNet[ni];
    if(!n)continue;
    for(const t of n.trous){
      const v=antViaDeTrou(t);
      if(v)out.push(v);
    }
  }
  return out;
}

/* UN perçage -> un via, ou rien. Sortie de `antVias` pour que les perçages
   DÉSIGNÉS à la main y passent par le même chemin : un via cliqué sur une
   carte sans nets doit être modélisé exactement comme un via pris par son
   net, portée supposée comprise. */
function antViaDeTrou(t){
  if(!t)return null;
  if(t.p===0||t.p==="NONPLATED")return null;   // non métallisé : pas un conducteur
  if(!(t.d>0))return null;
  const cuivres=V.couches.filter(c=>c.cuivre).sort((a,b)=>a.seq-b.seq);
  if(!cuivres.length)return null;
  let de="", a="";
  /* `sa` et `sb` sont des INDEX DANS LA TABLE DES COUCHES, pas des rangs
     de cuivre : ipc2581_json les produit par `couches.rang_connu(nom)`,
     qui renvoie la place du nom dans `modele.couches`. Les prendre pour
     des rangs de conducteur donne des portées fausses dès qu'un
     diélectrique s'intercale dans la table — c'est-à-dire toujours. */
  if(typeof t.sa==="number"&&typeof t.sb==="number"){
    if(V.couches[t.sa])de=V.couches[t.sa].nom;
    if(V.couches[t.sb])a=V.couches[t.sb].nom;
  }
  if(!de||!a){
    de=cuivres[0].nom; a=cuivres[cuivres.length-1].nom;
    ANT.viasSupposes++;
  }
  /* Un via dont les deux extrémités sont sur des couches non modélisées
     ne relie rien dans ce modèle : il n'y entre pas. */
  if(!antCoucheCochee(de)&&!antCoucheCochee(a))return null;
  return {x:t.x,y:t.y,d:t.d,de:de,a:a};
}

function antCoucheCochee(nom){
  for(const i of ANT.couches)
    if(V.couches[i]&&V.couches[i].nom===nom)return true;
  return false;
}

/* L'emprise du cuivre retenu, en unités du fichier. L'assistant s'en sert
   pour proposer une position de port et pour dire de quelle taille est la
   structure — la marge d'air se compare à elle. */
function antEmpriseCuivre(){
  let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
  const cu=antCuivreDuModele();
  for(const b of cu.blocs)
    for(const p of b.polys)
      for(let i=0;i+1<p.o.length;i+=2){
        if(p.o[i]<x1)x1=p.o[i];
        if(p.o[i]>x2)x2=p.o[i];
        if(p.o[i+1]<y1)y1=p.o[i+1];
        if(p.o[i+1]>y2)y2=p.o[i+1];
      }
  return isFinite(x1)?{x1:x1,y1:y1,x2:x2,y2:y2}:null;
}
