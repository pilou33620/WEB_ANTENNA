"use strict";
/* =============================================================================
   visionneuse IPC-2581 — 02-modele.js
   Le modèle reçu du serveur (voir python/ipc2581_json.py) est compact : les couches et
   les nets y sont des index, les points des tableaux plats. C'est ce qu'il faut
   pour le transporter ; ce n'est pas ce qu'il faut pour dessiner.

   Ce fichier fait le travail une fois pour toutes, au chargement :
     - il dresse la table des couches (nom, genre, couleur, visibilité) ;
     - il range chaque objet dans sa couche et dans son net ;
     - il transforme les pastilles en géométrie du monde (une empreinte est
       décrite autour de son origine, le composant la place et la tourne) ;
     - il assemble le tout en Path2D, un par couche et par largeur de trait.

   Ce dernier point est ce qui rend l'affichage tenable : une carte de
   fabrication porte couramment vingt mille pistes, et vingt mille appels à
   stroke() ne passent pas à soixante images par seconde. Groupées par largeur,
   elles tiennent en une poignée d'appels — le navigateur, lui, sait tracer un
   chemin de cent mille segments sans transpirer.
   ============================================================================= */

/* ==========================================================================
   État
   ========================================================================== */
const V={
  modele:null,          // le JSON, tel que reçu
  fichier:"",           // nom du fichier ouvert
  unite:"mm",           // mm ou in, selon ce que déclare le fichier
  couches:[],           // table des couches (voir mdlCouches)
  parNet:[],            // net index -> {pistes, arcs, plans, pads, trous, …}
  parRef:null,          // repère -> composant (Map)
  parXY:null,           // position -> perçage (Map), voir mdlTrouEn
  trous:{pth:null,npth:null},   // Path2D des perçages, métallisés ou non
  bbox:null,            // {x1,y1,x2,y2} de la carte
  vue:{scale:1,ox:0,oy:0,flip:false},
  aff:{plans:true,pistes:true,pads:true,trous:true,textes:true,
       composants:true,refs:false,contour:true,jsurf:false,maillage:false},
  net:-1,               // net mis en évidence, -1 = aucun
  /* Jusqu'où va cette mise en évidence. Un net traverse la carte : le montrer
     en entier répond à « où va ce signal », le montrer sur la seule couche
     cliquée répond à « qu'est-ce qui court ici ». Les deux questions se
     posent, et c'est Maj qui choisit laquelle (voir 04-interaction.js).
       couche : -1 pour toutes, sinon la seule couche montrée
       quoi   : "" tout le cuivre du net, "trous" ses seuls perçages
       seul   : un objet unique — le perçage cliqué, et rien d'autre */
  mev:{couche:-1,quoi:"",seul:null},
  comp:"",              // repère du composant sélectionné
  survol:null,          // ce que le curseur désigne
  /* LA SÉLECTION, QUAND ELLE PORTE SUR PLUSIEURS MORCEAUX. Ctrl+clic ajoute au
     lieu de remplacer : chaque entrée est un `{s, mev}` — ce que le clic a
     désigné, et jusqu'où sa mise en évidence va.

     `net`, `comp`, `mev` et `survol` ci-dessus ne disparaissent pas pour
     autant : ils REFLÈTENT la dernière entrée, celle qu'on vient de cliquer.
     Toutes les fiches, la liste des nets, le panneau d'empilage et la ligne de
     transmission continuent donc de lire ce qu'ils ont toujours lu, et un clic
     simple — le geste de tous les jours — se comporte exactement comme avant.
     Ce qui s'ajoute est la LISTE, que seuls la mise en évidence, la fiche de
     sélection et la simulation parcourent. Voir `selPoser`, 04-interaction.js. */
  sel:[],
  /* Ce que l'utilisateur a complété faute de le trouver dans le fichier :
     épaisseur d'un conducteur, épaisseur et permittivité d'un intervalle,
     et rôle forcé (signal vs plan).
     Rangé par nom de couche, comme les couches masquées, et gardé dans le
     profil — un empilage se saisit une fois, pas à chaque ouverture. */
  sur:{cu:{},gap_t:{},gap_er:{},role:{}}
};

/* ==========================================================================
   Couleurs
   Le cuivre d'abord : rouge dessus, bleu dessous — la convention de tous les
   outils de CAO, et celle de l'éditeur PCB de ce dépôt. Les couches internes
   prennent la suite de la palette. Le reste se reconnaît à son nom.
   ========================================================================== */
const CU_PALETTE=["#e8443a","#f2c744","#4cc38a","#c07cf0","#ff9d4d","#8af0ff",
                  "#7ee081","#ff7ab8","#b7c24d","#6fd3d3","#d98cf0","#e0a35c"];
const CU_DESSOUS="#3fa0ea";
const GENRE_COULEUR={
  serigraphie:"#e6e8ec", masque:"#9b6cd8", pate:"#8b919c", dielectrique:"#6b6f61",
  contour:"#f2c744", percage:"#8b919c", autre:"#6ee0c0"
};

/* Le genre d'une couche, dans l'ordre où l'on peut s'y fier : d'abord ce que
   le fichier déclare (layerFunction, recopié dans l'empilage par le parseur),
   ensuite le nom. La déclaration tranche parce qu'un nom peut mentir, et
   surtout parce qu'un empilage mélange conducteurs et diélectriques : sans
   elle, « DielectricLayer-1-2 » passait pour du cuivre, prenait une couleur
   de cuivre et décalait toute la palette. */
function mdlGenre(nom,entree){
  const t=String((entree&&entree.type)||"").toUpperCase();
  if(t&&t!=="UNKNOWN"){
    if(/CONDUCTOR|SIGNAL|PLANE|POWER|GROUND|MIXED/.test(t))return "cuivre";
    if(/DIEL|PREPREG|PREG|CORE|SUBSTRATE|LAMINATE/.test(t))return "dielectrique";
    if(/SOLDERMASK|SOLDERRESIST|COVERLAY|MASK/.test(t))return "masque";
    if(/SILK|LEGEND|COMPONENT/.test(t))return "serigraphie";
    if(/PASTE|STENCIL/.test(t))return "pate";
    if(/DRILL|HOLE/.test(t))return "percage";
    if(/OUTLINE|PROFILE|BOARD|ASSEMBLY|DOCUMENT|FABRICATION/.test(t))return "contour";
  }
  const n=String(nom||"").toUpperCase();
  if(/SILK|LEGEND|SERIGRAPH|NOMENCLATURE/.test(n))return "serigraphie";
  if(/MASK|RESIST|VERNIS/.test(n))return "masque";
  if(/PASTE|CREAM|STENCIL|ETAIN/.test(n))return "pate";
  if(/DRILL|HOLE|PERCAGE/.test(n))return "percage";
  if(/DIELECTRIC|PREPREG|DIELECTRIQUE/.test(n))return "dielectrique";
  if(/OUTLINE|PROFILE|CONTOUR|BOARD|EDGE|MECA|DIMENSION|ASSEMBLY|ASSEMB|DOC|FAB/.test(n))
    return "contour";
  return entree?"cuivre":"autre";
}

/* ==========================================================================
   Petites conversions
   ========================================================================== */
function mdlEsc(s){
  return String(s==null?"":s).replace(/[&<>"'`]/g,ch=>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","`":"&#96;"}[ch]));
}
/* Un nombre lisible : la virgule française, et juste assez de décimales pour
   que le micron reste visible sans noyer la valeur sous les zéros. */
function mdlNb(v,dec){
  if(v==null||isNaN(v))return "—";
  const d=(dec==null)?(V.unite==="in"?4:3):dec;
  return Number(v).toFixed(d).replace(/\.?0+$/,"").replace(".",",")||"0";
}
function mdlMes(v,dec){ return mdlNb(v,dec)+" "+V.unite; }
function mdlEntier(n){ return String(n).replace(/\B(?=(\d{3})+(?!\d))/g," "); }
function mdlNetNom(i){
  const t=V.modele&&V.modele.nets;
  return (t&&i>=0&&i<t.length)?t[i]:"";
}
function mdlCoucheNom(i){
  const c=V.couches[i];
  return c?c.nom:"";
}

/* ==========================================================================
   Géométrie
   ========================================================================== */
/* Placement d'une empreinte : le composant tourne autour de son origine, et
   sa face du dessous est un miroir en X. L'ordre compte — miroir d'abord,
   rotation ensuite : l'inverse retourne aussi la rotation, et un boîtier posé
   dessous se retrouve tourné du mauvais côté. */
function mdlPlacer(px,py,cx,cy,rot,mir){
  if(mir)px=-px;
  const a=(rot||0)*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
  return {x:cx+px*c-py*s, y:cy+px*s+py*c};
}
function mdlLongueur(p){
  let t=0;
  for(let i=0;i+3<p.length;i+=2)t+=Math.hypot(p[i+2]-p[i],p[i+3]-p[i+1]);
  return t;
}
/* Arc IPC-2581 : début, fin, centre, sens. Le rayon se déduit du début, et
   l'angle de fin est ramené du bon côté du départ selon le sens. */
function mdlArc(a){
  const r=Math.hypot(a.s[0]-a.m[0],a.s[1]-a.m[1]);
  let d=Math.atan2(a.s[1]-a.m[1],a.s[0]-a.m[0]);
  let f=Math.atan2(a.e[1]-a.m[1],a.e[0]-a.m[0]);
  /* Début et fin confondus : c'est un cercle entier, pas un arc nul. */
  if(Math.abs(d-f)<1e-9)f=d+(a.h?-2*Math.PI:2*Math.PI);
  return {r:r,d:d,f:f,h:!!a.h,cx:a.m[0],cy:a.m[1]};
}
function mdlArcAngle(g){
  let d=g.f-g.d;
  if(g.h){ while(d>0)d-=2*Math.PI; }
  else   { while(d<0)d+=2*Math.PI; }
  return Math.abs(d);
}
function mdlArcLongueur(a){
  if(!a||!a.s||!a.e||!a.m)return 0;
  const g=mdlArc(a);
  if(!(g.r>0))return Math.hypot(a.e[0]-a.s[0],a.e[1]-a.s[1]);
  return g.r*mdlArcAngle(g);
}

/* ==========================================================================
   Formes de pastilles
   Une pastille est une primitive du dictionnaire — cercle, rectangle, ovale,
   polygone — décrite autour de son origine. On en fait un Path2D une fois, et
   on le recopie ensuite à chaque emplacement avec sa matrice.
   ========================================================================== */
const MDL_FORMES=new Map();     // id de forme -> Path2D (ou null)

function mdlRectArrondi(p,w,h,r){
  const x=-w/2, y=-h/2;
  r=Math.max(0,Math.min(r,Math.min(w,h)/2));
  if(r<=0){p.rect(x,y,w,h);return;}
  p.moveTo(x+r,y);
  p.lineTo(x+w-r,y); p.arcTo(x+w,y,x+w,y+r,r);
  p.lineTo(x+w,y+h-r); p.arcTo(x+w,y+h,x+w-r,y+h,r);
  p.lineTo(x+r,y+h); p.arcTo(x,y+h,x,y+h-r,r);
  p.lineTo(x,y+r); p.arcTo(x,y,x+r,y,r);
  p.closePath();
}
function mdlPolyDans(p,pts,fermer){
  if(!pts||pts.length<4)return;
  p.moveTo(pts[0],pts[1]);
  for(let i=2;i+1<pts.length;i+=2)p.lineTo(pts[i],pts[i+1]);
  if(fermer!==false)p.closePath();
}
/* ==========================================================================
   LES PLANS : UN CHEMIN PAR CONTOUR, ET NON UN SEUL POUR TOUTE LA COUCHE
   --------------------------------------------------------------------------
   LE DÉFAUT, ET IL SE VOYAIT À L'ŒIL. Tous les contours de plans d'une couche
   étaient versés dans UN SEUL Path2D, rempli en « evenodd ». Or evenodd n'est
   pas une union : c'est un OU EXCLUSIF. Trois conséquences, toutes visibles :

     · deux DÉGAGEMENTS qui se recouvrent — le cas ordinaire d'un connecteur à
       broches serrées — se rendent mutuellement leur cuivre : la lentille
       commune se remplit, et un anneau de cuivre apparaît entre deux pastilles
       là où le fondeur n'en a pas laissé ;
     · deux ÎLOTS de plan qui se recouvrent s'annulent : leur intersection
       devient un TROU noir, avec le contour de l'intersection pour forme — ce
       qui donne des blobs incompréhensibles autour d'un boîtier ;
     · le dégagement d'un contour, s'il traverse un autre contour, cesse d'être
       un trou.

   LA BONNE GRANULARITÉ EST LE CONTOUR. À l'intérieur d'un contour, evenodd est
   exactement ce qu'il faut : un dégagement est INCLUS dans son extérieur, donc
   le OU exclusif y fait un trou. Entre deux contours, c'est une UNION qu'il
   faut, et deux `fill()` successifs en sont une — le pinceau ne se souvient pas
   du coup précédent.

   CE QUE ÇA COÛTE : un appel de remplissage par contour au lieu d'un par
   couche. Un plan arrosé en compte quelques dizaines, pas quelques milliers, et
   le prix d'un dessin juste n'est pas discutable.
   ========================================================================== */
function mdlPlansDans(plans){
  const out=[];
  for(const g of (plans||[]))
    for(const ct of (g.g||[])){
      if(!ct||!ct.o||ct.o.length<6)continue;
      const p=new Path2D();
      mdlPolyDans(p,ct.o);
      for(const t of (ct.t||[]))mdlPolyDans(p,t);
      out.push(p);
    }
  return out.length?out:null;
}

/* Le perçage qui se trouve à ce point, s'il y en a un. IPC-2581 ne relie pas
   une pastille à son trou : ils sont décrits séparément, et c'est leur position
   commune qui les réunit — au micron, le pas auquel tout le reste est arrondi
   ici. C'est ce qui permet de reconnaître un via sous le curseur : ce qu'on
   désigne au centre d'un via, c'est sa pastille, jamais le trou lui-même. */
function mdlCleXY(x,y){ return Math.round(x*1000)+","+Math.round(y*1000); }
function mdlTrouEn(x,y){
  return (V.parXY&&V.parXY.get(mdlCleXY(x,y)))||null;
}

/* Un point tombe-t-il dans un polygone ? Lancer de rayon vers la droite : on
   compte les côtés traversés, impair dedans. Les contours d'IPC-2581 sont
   fermés implicitement — le dernier point rejoint le premier, et la boucle en
   tient compte plutôt que de recopier le point de départ. */
function mdlDansPoly(pts,x,y){
  if(!pts||pts.length<6)return false;
  const n=pts.length;
  let dedans=false;
  for(let i=0,j=n-2;i<n;j=i,i+=2){
    const xi=pts[i], yi=pts[i+1], xj=pts[j], yj=pts[j+1];
    if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)dedans=!dedans;
  }
  return dedans;
}

/* ==========================================================================
   Plans
   Un plan de masse est le plus gros objet de la carte : sa boîte, son contour
   et son aire sont calculés une fois et gardés sur l'objet. Sans cela, chaque
   survol repasserait sur les milliers de points de son bord.
   ========================================================================== */
function mdlBoitePlan(g){
  if(g._b)return g._b;
  let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
  for(const ct of g.g){
    const p=ct.o;
    for(let i=0;i+1<p.length;i+=2){
      if(p[i]<x1)x1=p[i]; else if(p[i]>x2)x2=p[i];
      if(p[i+1]<y1)y1=p[i+1]; else if(p[i+1]>y2)y2=p[i+1];
    }
  }
  g._b={x1:x1,y1:y1,x2:x2,y2:y2};
  return g._b;
}
/* Le point tombe-t-il sur le cuivre du plan ? Dans un contour, et dans aucune
   de ses découpes : un plan est troué partout — dégagements autour des vias,
   isolations de pastilles — et viser le vide au milieu d'un dégagement, ce
   n'est pas viser le plan. */
function mdlPlanContient(g,x,y){
  const b=mdlBoitePlan(g);
  if(x<b.x1||x>b.x2||y<b.y1||y>b.y2)return false;
  for(const ct of g.g){
    if(!mdlDansPoly(ct.o,x,y))continue;
    let troue=false;
    for(const t of (ct.t||[]))if(mdlDansPoly(t,x,y)){troue=true;break;}
    if(!troue)return true;
  }
  return false;
}
/* Le contour d'un seul plan, pour le souligner au survol. */
function mdlCheminPlan(g){
  if(g._p)return g._p;
  const p=new Path2D();
  for(const ct of g.g){
    mdlPolyDans(p,ct.o);
    for(const t of (ct.t||[]))mdlPolyDans(p,t);
  }
  g._p=p;
  return p;
}
/* L'aire de cuivre d'un plan, découpes déduites. */
function mdlAirePlan(g){
  if(g._a!=null)return g._a;
  let a=0;
  for(const ct of g.g){
    a+=ltAire(ct.o);
    for(const t of (ct.t||[]))a-=ltAire(t);
  }
  g._a=Math.max(0,a);
  return g._a;
}

/* Le chemin d'une forme, construit à la demande et gardé. Renvoie null quand
   la forme est inconnue : l'appelant retombe alors sur un disque du diamètre
   annoncé par le padstack, ce que le parseur calcule justement pour ça. */
function mdlForme(id){
  if(!id)return null;
  if(MDL_FORMES.has(id))return MDL_FORMES.get(id);
  const f=V.modele.formes[id], u=V.modele.formesuser[id];
  let p=null;
  if(f){
    p=new Path2D();
    switch(f.t){
      case "CIRCLE": p.arc(0,0,(f.d||0)/2,0,2*Math.PI); break;
      case "RECTCENTER": p.rect(-(f.w||0)/2,-(f.h||0)/2,f.w||0,f.h||0); break;
      case "OVAL": mdlRectArrondi(p,f.w||0,f.h||0,Math.min(f.w||0,f.h||0)/2); break;
      case "RECTROUND": mdlRectArrondi(p,f.w||0,f.h||0,f.r||0); break;
      /* Le chanfrein est rendu comme un arrondi : à l'échelle où l'on regarde
         une pastille, la différence tient dans l'épaisseur du trait. */
      case "RECTCHAM": mdlRectArrondi(p,f.w||0,f.h||0,f.ch||0); break;
      case "POLYGON": mdlPolyDans(p,f.p); break;
      default: p=null;
    }
  }else if(u){
    /* Forme du dictionnaire utilisateur : une empreinte complexe, décrite par
       ses contours. Les traits qu'elle contient sont ignorés ici — une
       pastille est une surface, et c'est la surface qui compte. */
    p=new Path2D();
    let vide=true;
    for(const g of (u.plans||[])){
      mdlPolyDans(p,g.o); vide=false;
      for(const t of (g.t||[]))mdlPolyDans(p,t);
    }
    if(vide)p=null;
  }
  MDL_FORMES.set(id,p);
  return p;
}

/* ==========================================================================
   Table des couches
   ========================================================================== */
function mdlCouches(m){
  const empilage=new Map();
  for(const e of m.empilage)empilage.set(e.nom,e);

  const couches=m.couches.map(function(nom,i){
    const e=empilage.get(nom);
    const genre=mdlGenre(nom,e);
    return {i:i,nom:nom,genre:genre,cuivre:genre==="cuivre",
            seq:e?e.seq:0, ep:e?e.ep:0, mat:e?e.mat:"", dk:e?e.dk:"", df:e?e.df:"",
            type:e?(e.type||""):"", empile:!!e,
            visible:true, couleur:"#6ee0c0", airePlans:0,
            pistes:[],arcs:[],plans:[],textes:[],pads:[],
            chemins:null, cpt:0};
  });

  /* Les couches de cuivre dans l'ordre de l'empilage : la première est le
     dessus, la dernière le dessous, et ce sont ces deux-là qui prennent les
     couleurs qu'on reconnaît sans réfléchir. */
  const cu=couches.filter(c=>c.cuivre).sort((a,b)=>a.seq-b.seq);
  cu.forEach(function(c,rang){
    c.rangCu=rang;
    c.dessus=(rang===0);
    c.dessous=(rang===cu.length-1);
    c.couleur=(cu.length>1&&rang===cu.length-1)?CU_DESSOUS:CU_PALETTE[rang%CU_PALETTE.length];
  });
  for(const c of couches)
    if(!c.cuivre)c.couleur=GENRE_COULEUR[c.genre]||GENRE_COULEUR.autre;
  return couches;
}

/* Index d'une couche par son nom, tel qu'il apparaît dans un padstack. */
function mdlCoucheDe(nom){
  if(!nom)return -1;
  const t=V.modele.couches, n=String(nom);
  let i=t.indexOf(n);
  if(i>=0)return i;
  /* Les noms de couche d'un padstack ne sont pas toujours ceux des features
     (majuscules, préfixes) : on retente sans la casse avant de renoncer. */
  const bas=n.toLowerCase();
  for(i=0;i<t.length;i++)if(t[i].toLowerCase()===bas)return i;
  return -1;
}

/* ==========================================================================
   Pastilles : du padstack à la géométrie du monde
   ========================================================================== */
/* Une pastille placée donne un objet par couche où le padstack en définit une.
   `hote` est le composant qui la porte, ou null pour une pastille libre : il
   sert de repli quand le padstack désigne une couche inconnue (« ALL », ou le
   nom d'une couche que les features n'ont jamais nommée). */
function mdlPadPlace(pad,hote,couches,sortie){
  const ps=V.modele.padstacks[pad.ps];
  const base=hote
    ? mdlPlacer(pad.x,pad.y,hote.x,hote.y,hote.r,!!hote.m)
    : {x:pad.x,y:pad.y};
  const mir=(hote&&hote.m?1:0)^(pad.m?1:0);
  /* La forme tourne avec le composant ET avec la pastille ; un miroir change
     le sens de la rotation, sans quoi une empreinte posée dessous tourne à
     l'envers. */
  const rot=(hote?(hote.m?-hote.r:hote.r):0)+(mir?-(pad.r||0):(pad.r||0));

  const defauts=hote&&hote.c>=0?[hote.c]:null;
  const pads=(ps&&ps.pads&&ps.pads.length)?ps.pads:null;

  if(!pads){
    /* Padstack inconnu : la pastille existe pourtant — un perçage mécanique
       référence souvent une définition absente. On la pose sur la couche du
       composant, ou sur le premier cuivre, avec le diamètre du trou. */
    const c=defauts?defauts[0]:mdlPremierCuivre();
    if(c>=0&&couches[c])
      sortie.push({c:c,x:base.x,y:base.y,rot:rot,mir:mir,d:ps?ps.pad:0,
                   forme:"",pad:pad,hote:hote});
    return;
  }
  for(const pd of pads){
    if(pd.a&&!pd.d)continue;                 // antipad seul : rien à remplir
    let c=mdlCoucheDe(pd.c);
    if(c<0){
      /* « ALL » et compagnie : une pastille traversante existe sur tous les
         cuivres, une pastille de composant sur celui du composant. */
      if(defauts)c=defauts[0];
      else{ for(const k of mdlCuivres())
              sortie.push({c:k,x:base.x,y:base.y,rot:rot,mir:mir,
                           d:pd.d||(ps?ps.pad:0),forme:pd.f,pad:pad,hote:hote});
            continue; }
    }
    if(c<0||!couches[c])continue;
    sortie.push({c:c,x:base.x,y:base.y,rot:rot,mir:mir,
                 d:pd.d||(ps?ps.pad:0),forme:pd.f,pad:pad,hote:hote});
  }
}
function mdlCuivres(){
  const out=[];
  for(const c of V.couches)if(c.cuivre)out.push(c.i);
  return out;
}
function mdlPremierCuivre(){
  for(const c of V.couches)if(c.cuivre)return c.i;
  return V.couches.length?0:-1;
}

/* ==========================================================================
   LA SÉLECTION
   --------------------------------------------------------------------------
   ELLE EST ICI PARCE QU'ELLE N'EST QUE DE L'ÉTAT. Le geste qui la construit est
   dans 04-interaction.js — c'est lui qui lit Ctrl et Maj — mais ce qui suit ne
   touche ni au canevas ni aux panneaux : ça range `V.sel` et ça met le reflet
   à jour. Les avoir ici les rend éprouvables sans monter un écran.
   ========================================================================== */

/* Deux désignations portent-elles sur LE MÊME objet ? C'est ce qui décide si
   Ctrl+clic ajoute ou retire. On compare les objets du modèle quand il y en a —
   une piste, un plan, un perçage sont des objets uniques —, et à défaut ce qui
   les identifie : le repère d'un composant, la position et la couche d'une
   pastille. Comparer les coordonnées d'un clic ne marcherait pas : deux clics
   sur la même piste ne tombent jamais au même endroit. */
/* Retrouver toute la chaîne continue de pistes et arcs d'un même net sur la même couche. */
function mdlChainePistesMemeCouche(piste0){
  if(!V.modele||!piste0)return [piste0];
  const netIdx=(piste0.n!=null&&piste0.n>=0)?piste0.n:-1;
  if(netIdx<0||!V.parNet||!V.parNet[netIdx])return [piste0];
  const n=V.parNet[netIdx];
  const cands=n.pistes.filter(p=>p.c===piste0.c&&p.p&&p.p.length>=4);
  const arcs=(n.arcs||[]).filter(a=>a.c===piste0.c);
  if(cands.length<=1&&!arcs.length)return cands.length?cands:[piste0];

  const tol=(/INCH/i.test(V.unite||"")?0.02/25.4:0.02);

  const boutsMap=new Map();
  for(const p of cands){
    boutsMap.set(p, [
      {x:p.p[0], y:p.p[1]},
      {x:p.p[p.p.length-2], y:p.p[p.p.length-1]}
    ]);
  }
  for(const a of arcs){
    if(a.s&&a.e){
      boutsMap.set(a, [
        {x:a.s[0], y:a.s[1]},
        {x:a.e[0], y:a.e[1]}
      ]);
    }
  }

  const tous=[...cands, ...arcs.filter(a=>boutsMap.has(a))];
  const retenus=new Set([piste0]);
  const stack=[piste0];

  while(stack.length){
    const cur=stack.pop();
    const curBouts=boutsMap.get(cur);
    if(!curBouts)continue;
    for(const cand of tous){
      if(retenus.has(cand))continue;
      const candBouts=boutsMap.get(cand);
      if(!candBouts)continue;
      let touche=false;
      for(const b1 of curBouts){
        for(const b2 of candBouts){
          if(Math.hypot(b1.x-b2.x, b1.y-b2.y)<=tol){
            touche=true; break;
          }
        }
        if(touche)break;
      }
      if(touche){
        retenus.add(cand);
        stack.push(cand);
      }
    }
  }
  return [...retenus];
}

function selMeme(a,b){
  if(!a||!b||a.type!==b.type)return false;
  if(a.type==="piste"){
    if(a.piste===b.piste)return true;
    if(a.couche===b.couche&&a.net===b.net&&a.net>=0){
      const chaine=mdlChainePistesMemeCouche(a.piste);
      return chaine.indexOf(b.piste)>=0;
    }
    return false;
  }
  if(a.type==="plan")return a.plan===b.plan;
  if(a.type==="percage")return a.trou===b.trou;
  if(a.type==="composant")return a.ref===b.ref;
  if(a.type==="net")return a.net===b.net;
  if(a.type==="pad")
    return a.couche===b.couche&&Math.abs(a.x-b.x)<1e-9&&Math.abs(a.y-b.y)<1e-9;
  return false;
}

/* Le reflet : la dernière entrée de la liste, recopiée là où tout le monde la
   lit déjà. Une liste vide remet l'état d'avant tout clic. */
function selRefleter(){
  const e=V.sel.length?V.sel[V.sel.length-1]:null;
  if(!e){V.net=-1; V.comp=""; V.mev=mdlMevTout(); return;}
  const s=e.s;
  V.mev=e.mev||mdlMevTout();
  if(s.type==="composant"){V.comp=s.ref; V.net=-1; return;}
  V.net=(s.net!=null&&s.net>=0)?s.net:-1;
  /* Une pastille appartient a deux choses a la fois : un net, et le boitier
     qui la porte. On retient les deux -- la fiche les montre ensemble. */
  V.comp=s.comp||"";
}

/* Poser une désignation. `ajouter` vrai la fait basculer dans la liste — elle
   y entre si elle n'y est pas, elle en sort si elle y est ; faux la remplace,
   ce qui est le clic ordinaire.
   `isDbl` vrai préserve l'élément déjà sélectionné (évite le dédoublement de bascule). */
function selPoser(s,mev,ajouter,isDbl){
  if(!s){if(!ajouter)V.sel=[];selRefleter();return;}
  if(!ajouter){V.sel=[{s:s,mev:mev||mdlMevTout()}];selRefleter();return;}
  const k=V.sel.findIndex(e=>selMeme(e.s,s));
  if(k>=0){
    if(!isDbl)V.sel.splice(k,1);
    else V.sel[k]={s:s,mev:mev||V.sel[k].mev||mdlMevTout()};
  } else {
    V.sel.push({s:s,mev:mev||mdlMevTout()});
  }
  selRefleter();
}
/* Les nets et les boîtiers que la sélection touche, pour que les listes
   marquent TOUTES leurs lignes retenues et pas seulement la dernière. */
function selNets(){
  const out=new Set();
  for(const e of V.sel)
    if(e.s&&e.s.net!=null&&e.s.net>=0)out.add(e.s.net);
  if(!out.size&&V.net>=0)out.add(V.net);
  return out;
}
function selRefs(){
  const out=new Set();
  for(const e of V.sel){
    if(!e.s)continue;
    if(e.s.type==="composant")out.add(e.s.ref);
    else if(e.s.comp)out.add(e.s.comp);
  }
  if(!out.size&&V.comp)out.add(V.comp);
  return out;
}

/* ==========================================================================
   Chargement
   ========================================================================== */
function mdlCharger(modele,nomFichier){
  V.modele=modele;
  V.fichier=nomFichier||modele.fichier||"carte";
  V.unite=/INCH/i.test(modele.unites||"")?"in":"mm";
  V.couches=mdlCouches(modele);
  V.net=-1; V.comp=""; V.survol=null; V.mev=mdlMevTout(); V.sel=[];
  MDL_FORMES.clear();

  /* Un net par entrée du tableau des noms, plus une case pour « hors net » :
     les objets sans net portent -1, et cette case-là n'est jamais affichée
     dans la liste. */
  V.parNet=modele.nets.map(function(nom,i){
    return {i:i,nom:nom,pistes:[],arcs:[],plans:[],pads:[],trous:[],
            longueur:0,couches:new Set()};
  });
  const net=function(i){return (i>=0&&i<V.parNet.length)?V.parNet[i]:null;};

  for(const p of modele.pistes){
    const c=V.couches[p.c]; if(c){c.pistes.push(p);c.cpt++;}
    const n=net(p.n);
    if(n){n.pistes.push(p);n.longueur+=mdlLongueur(p.p);if(p.c>=0)n.couches.add(p.c);}
  }
  for(const a of modele.arcs){
    const c=V.couches[a.c]; if(c){c.arcs.push(a);c.cpt++;}
    const n=net(a.n); if(n){n.arcs.push(a);n.longueur+=mdlArcLongueur(a);if(a.c>=0)n.couches.add(a.c);}
  }
  for(const g of modele.plans){
    const c=V.couches[g.c]; if(c){c.plans.push(g);c.cpt++;}
    const n=net(g.n); if(n){n.plans.push(g);if(g.c>=0)n.couches.add(g.c);}
  }
  for(const t of modele.textes){
    const c=V.couches[t.c]; if(c){c.textes.push(t);c.cpt++;}
  }

  /* Les pastilles : libres d'abord, puis celles que portent les composants. */
  const poses=[];
  for(const pad of modele.pads)mdlPadPlace(pad,null,V.couches,poses);
  V.parRef=new Map();
  for(const comp of modele.composants){
    V.parRef.set(comp.ref,comp);
    comp.boite=mdlBoiteComp(comp);
    for(const pad of (comp.pads||[]))mdlPadPlace(pad,comp,V.couches,poses);
  }
  for(const q of poses){
    const c=V.couches[q.c]; if(!c)continue;
    c.pads.push(q); c.cpt++;
    const n=net(q.pad.n==null?-1:q.pad.n);
    if(n){n.pads.push(q);n.couches.add(q.c);}
  }
  V.parXY=new Map();
  for(const t of modele.percages){
    const n=net(t.n==null?-1:t.n); if(n)n.trous.push(t);
    V.parXY.set(mdlCleXY(t.x,t.y),t);
  }

  mdlChemins();
  V.bbox=mdlBoite();
  ltPreparer();
  return V;
}

/* Boîte d'un composant : ce que couvrent ses pastilles et ses broches, avec
   une marge. Elle sert au cadrage, au survol et au rectangle de sélection —
   IPC-2581 ne donne pas de contour d'empreinte exploitable ici. */
function mdlBoiteComp(comp){
  let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
  const voir=function(px,py,marge){
    const q=mdlPlacer(px,py,comp.x,comp.y,comp.r,!!comp.m);
    x1=Math.min(x1,q.x-marge); y1=Math.min(y1,q.y-marge);
    x2=Math.max(x2,q.x+marge); y2=Math.max(y2,q.y+marge);
  };
  for(const p of (comp.pads||[])){
    const ps=V.modele.padstacks[p.ps];
    voir(p.x,p.y,(ps&&ps.pad?ps.pad:0.5)/2);
  }
  for(const p of (comp.pins||[]))voir(p.x,p.y,0.2);
  if(!isFinite(x1)){                       // ni pastille ni broche connue
    const d=(V.unite==="in")?0.02:0.5;
    return {x1:comp.x-d,y1:comp.y-d,x2:comp.x+d,y2:comp.y+d};
  }
  return {x1:x1,y1:y1,x2:x2,y2:y2};
}

/* Boîte de la carte : son profil s'il est donné, sinon tout ce qu'on connaît.
   Un fichier sans <Profile> n'est pas rare, et un cadrage sur du vide non
   plus : on retombe alors sur l'étendue réelle du dessin. */
function mdlBoite(){
  const m=V.modele;
  let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
  const pt=function(x,y){
    if(x<x1)x1=x; if(y<y1)y1=y; if(x>x2)x2=x; if(y>y2)y2=y;
  };
  const plat=function(p){for(let i=0;i+1<p.length;i+=2)pt(p[i],p[i+1]);};
  if(m.contour&&m.contour.o&&m.contour.o.length>=6){
    plat(m.contour.o);
  }else{
    for(const p of m.pistes)plat(p.p);
    for(const g of m.plans)for(const c of g.g)plat(c.o);
    for(const t of m.percages)pt(t.x,t.y);
    for(const c of V.couches)for(const q of c.pads)pt(q.x,q.y);
    for(const c of m.composants){pt(c.boite.x1,c.boite.y1);pt(c.boite.x2,c.boite.y2);}
  }
  if(!isFinite(x1))return {x1:0,y1:0,x2:100,y2:100};
  if(x2-x1<1e-6){x1-=1;x2+=1;}
  if(y2-y1<1e-6){y1-=1;y2+=1;}
  return {x1:x1,y1:y1,x2:x2,y2:y2};
}

/* ==========================================================================
   Chemins
   Un Path2D par couche et par largeur de trait, plus un pour les surfaces et
   un pour les pastilles. C'est ce qui permet de redessiner toute la carte à
   chaque déplacement de la souris sans y penser.
   ========================================================================== */
function mdlChemins(){
  for(const c of V.couches)c.chemins=mdlCheminsDe(c);
  const m=V.modele;
  V.trous.pth=new Path2D(); V.trous.npth=new Path2D();
  V.trous.n=0;
  for(const t of m.percages){
    const r=(t.d||0)/2;
    if(r<=0)continue;
    const p=/NON/i.test(t.p||"")?V.trous.npth:V.trous.pth;
    p.moveTo(t.x+r,t.y); p.arc(t.x,t.y,r,0,2*Math.PI);
    V.trous.n++;
  }
  V.contour=null;
  if(m.contour&&m.contour.o&&m.contour.o.length>=6){
    const p=new Path2D();
    mdlPolyDans(p,m.contour.o);
    for(const t of (m.contour.t||[]))mdlPolyDans(p,t);
    V.contour=p;
  }
}

/* Les traits d'une couche, groupés par largeur. Les largeurs sont arrondies au
   micron : deux pistes à 0,2000001 et 0,2 sont la même piste pour l'œil, et
   les distinguer ferait deux groupes là où un suffit. */
function mdlCheminsDe(c){
  const traits=new Map();
  const brin=function(w){
    const cle=Math.round((w||0)*1000)/1000;
    let p=traits.get(cle);
    if(!p){p=new Path2D();traits.set(cle,p);}
    return p;
  };
  for(const t of c.pistes){
    const p=brin(t.w), pts=t.p;
    p.moveTo(pts[0],pts[1]);
    for(let i=2;i+1<pts.length;i+=2)p.lineTo(pts[i],pts[i+1]);
  }
  for(const a of c.arcs){
    const g=mdlArc(a), p=brin(a.w);
    p.moveTo(g.cx+g.r*Math.cos(g.d),g.cy+g.r*Math.sin(g.d));
    p.arc(g.cx,g.cy,g.r,g.d,g.f,g.h);
  }
  /* UN CHEMIN PAR CONTOUR, ET SURTOUT PAS UN SEUL POUR TOUTE LA COUCHE.
     Voir `mdlPlansDans`. */
  const plans=mdlPlansDans(c.plans);
  let pads=null;
  if(c.pads.length){
    pads=new Path2D();
    for(const q of c.pads)mdlPadDans(pads,q);
  }
  return {traits:traits,plans:plans,pads:pads};
}

/* Une pastille posée, ajoutée à un chemin : sa forme, tournée et placée. */
function mdlPadDans(chemin,q){
  const f=mdlForme(q.forme);
  if(!f){
    const r=(q.d||0)/2;
    if(r<=0)return;
    chemin.moveTo(q.x+r,q.y);
    chemin.arc(q.x,q.y,r,0,2*Math.PI);
    return;
  }
  const a=(q.rot||0)*Math.PI/180, co=Math.cos(a), si=Math.sin(a), k=q.mir?-1:1;
  /* Path2D.addPath prend une matrice : la forme n'est construite qu'une fois,
     et chaque emplacement n'en coûte que la transformation. */
  chemin.addPath(f,{a:co*k,b:si*k,c:-si,d:co,e:q.x,f:q.y});
}

/* ==========================================================================
   Chemins d'un net (mise en évidence)
   Construits à la demande, pour le seul net choisi : les garder tous coûterait
   la mémoire d'une deuxième carte, pour un usage qui n'en regarde qu'un.

   La portée fait partie de la clé du cache : le même net montré sur une couche
   ou sur toutes n'est pas le même dessin, et on fait l'aller-retour entre les
   deux d'un clic — les recalculer à chaque fois se verrait sur une masse.
   ========================================================================== */
/* La portée par défaut : le net entier, comme quand on le choisit dans la
   liste. C'est le seul endroit qui décrit cet objet en entier ; les autres
   partent de là. */
function mdlMevTout(){ return {couche:-1,quoi:"",seul:null}; }

/* Un perçage, en anneau. Un via se montre en le cerclant, jamais en le
   remplissant : un trou rempli de blanc n'est plus un trou. */
function mdlTrouDans(chemin,t){
  const r=(t.d||0)/2;
  if(r<=0)return;
  chemin.moveTo(t.x+r,t.y);
  chemin.arc(t.x,t.y,r,0,2*Math.PI);
}

function mdlCheminsNet(i,mev){
  const p=mev||V.mev;
  /* Un objet unique : le via qu'on vient de cliquer, et rien d'autre. Un seul
     arc à construire, ça ne vaut pas un cache. */
  if(p&&p.seul){
    const seul=new Path2D();
    mdlTrouDans(seul,p.seul);
    return {traits:new Map(),plans:null,pads:null,trous:seul};
  }
  const n=V.parNet[i];
  if(!n)return null;
  const couche=(p&&p.couche>=0)?p.couche:-1;
  const quoi=(p&&p.quoi)||"";
  const cle=couche+"|"+quoi;
  if(!n.chemins)n.chemins=new Map();
  const garde=n.chemins.get(cle);
  if(garde)return garde;

  const traits=new Map(), brin=function(w){
    const k=Math.round((w||0)*1000)/1000;
    let p2=traits.get(k);
    if(!p2){p2=new Path2D();traits.set(k,p2);}
    return p2;
  };
  const g={traits:traits,plans:null,pads:null,trous:null};

  /* Les seuls perçages : c'est la question qu'on pose à un via — « par où ce
     net change-t-il de couche ? ». Y ajouter le cuivre du net, c'est recouvrir
     la carte du plan de masse et ne plus voir aucun via. */
  if(quoi==="trous"){
    g.trous=new Path2D();
    for(const t of n.trous)mdlTrouDans(g.trous,t);
    n.chemins.set(cle,g);
    return g;
  }

  for(const t of n.pistes){
    if(couche>=0&&t.c!==couche)continue;
    const p2=brin(t.w), pts=t.p;
    p2.moveTo(pts[0],pts[1]);
    for(let k=2;k+1<pts.length;k+=2)p2.lineTo(pts[k],pts[k+1]);
  }
  for(const a of n.arcs){
    if(couche>=0&&a.c!==couche)continue;
    const arc=mdlArc(a), p2=brin(a.w);
    p2.moveTo(arc.cx+arc.r*Math.cos(arc.d),arc.cy+arc.r*Math.sin(arc.d));
    p2.arc(arc.cx,arc.cy,arc.r,arc.d,arc.f,arc.h);
  }
  /* MÊME RÈGLE QUE POUR LE DESSIN ORDINAIRE : un chemin par contour, sinon la
     mise en évidence d'un plan de masse trouerait sa propre surface là où deux
     îlots se recouvrent. Voir `mdlPlansDans`. */
  g.plans=mdlPlansDans(n.plans.filter(pl=>couche<0||pl.c===couche));
  const pads=new Path2D();
  let aPad=false;
  for(const q of n.pads){
    if(couche>=0&&q.c!==couche)continue;
    mdlPadDans(pads,q); aPad=true;
  }
  if(aPad)g.pads=pads;

  n.chemins.set(cle,g);
  return g;
}

/* ==========================================================================
   Ligne de transmission — ce qu'une piste vaut électriquement
   --------------------------------------------------------------------------
   Une piste n'est pas un fil : c'est une ligne, et l'empilage que porte le
   fichier dit déjà tout ce qu'il faut pour la calculer — la hauteur de
   diélectrique qui la sépare de son plan de référence, la permittivité du
   stratifié, l'épaisseur du cuivre. C'est exactement ce que montre l'éditeur
   PCB de ce dépôt quand on y sélectionne une piste ; les formules sont les
   siennes, à l'identique (editeur-pcb/js/01-core.js), pour que les deux outils
   ne racontent pas deux histoires sur la même carte :

     Hammerstad pour la permittivité effective, Wheeler pour l'impédance du
     microruban, IPC-2141A pour la triplaque.

   Une différence de fond avec l'éditeur, et elle commande tout le reste : là-
   bas, l'empilage est saisi et les rôles de couche sont déclarés. Ici, tout
   vient du fichier, et le fichier ne dit pas toujours tout. Chaque valeur
   manquante est donc signalée plutôt que supposée en silence — c'est le champ
   `suppose` que remonte ltPiste().

   Les calculs se font en millimètres, quelle que soit l'unité du fichier : la
   vitesse de la lumière est écrite en mm/s, et les retards sortent alors en
   secondes, les capacités en farads, les selfs en henrys, sans facteur de
   conversion caché en chemin.
   ========================================================================== */
const LT_C0=2.99792458e11;     // vitesse de la lumière, en mm/s
const LT_ER=4.3;               // εr de repli : FR-4 courant, faute de mieux
const LT_EP_CU=0.035;          // épaisseur de cuivre de repli, en mm (1 oz)
const LT_DF=0.02;              // tan δ de repli : FR-4 courant, faute de mieux
/* Part de la carte qu'une zone de cuivre doit couvrir pour qu'on la tienne
   pour un plan de référence. Un plan de masse découpé descend rarement sous la
   moitié ; un simple îlot de cuivre n'y arrive jamais. */
const LT_SEUIL_PLAN=0.4;

/* L'empilage tel que le calcul le voit : la suite des conducteurs, et entre
   deux conducteurs voisins le diélectrique qui les sépare. C'est cette forme-là
   qui compte — l'impédance ne connaît que des conducteurs et des intervalles —
   et c'est aussi celle que l'utilisateur complète quand le fichier est muet. */
let LT={pile:[],cu:[],gap:[],aire:0,pret:false};

/* Aire d'un polygone donné à plat, par la formule du lacet. Le signe dépend du
   sens de parcours, dont on n'a que faire : on prend la valeur absolue. */
function ltAire(p){
  let a=0;
  for(let i=0,n=p.length;i+1<n;i+=2){
    const j=(i+2)%n;
    a+=p[i]*p[j+1]-p[j]*p[i+1];
  }
  return Math.abs(a)/2;
}
/* Le nom d'un intervalle : les deux conducteurs qu'il sépare. C'est ce nom qui
   sert de clé aux valeurs saisies, et il vaut d'un fichier à l'autre tant que
   les couches gardent leur nom — comme pour les couches masquées. */
function ltCleGap(a,b){ return a+" ↔ "+b; }

/* Une valeur saisie par l'utilisateur, ou rien. Les surcharges vivent dans
   V.sur, que 06-demarrage.js lit et écrit dans le profil. */
function ltSaisi(quoi,cle){
  const t=V.sur&&V.sur[quoi];
  const v=t?t[cle]:null;
  return (typeof v==="number"&&isFinite(v)&&v>0)?v:null;
}

/* Dresse l'empilage de calcul. Refait à chaque chargement et à chaque valeur
   saisie : il ne coûte qu'un parcours de l'empilage et des plans. */
function ltPreparer(){
  const m=V.modele, k=(V.unite==="in")?25.4:1;      // tout en millimètres
  const parNom=new Map();
  for(const c of V.couches)parNom.set(c.nom,c);

  LT.pile=(m.empilage||[]).slice()
    .sort(function(a,b){return (a.seq||0)-(b.seq||0);})
    .map(function(e){
      const c=parNom.get(e.nom);
      const genre=c?c.genre:mdlGenre(e.nom,e);
      const dk=parseFloat(String(e.dk||"").replace(",","."));
      /* Le Df voyage AVEC le Dk. Il ne servait à rien tant que seule
         l'impédance était calculée — elle n'en a pas besoin —, mais la
         simulation EM en tire les pertes diélectriques, et il était perdu ici :
         `LT.pile` le laissait tomber, si bien que le panneau reprenait son
         repli 0,02 sur toutes les cartes, y compris celles qui portent la
         valeur dans leur fichier. */
      const df=parseFloat(String(e.df||"").replace(",","."));
      return {nom:e.nom, genre:genre, cuivre:genre==="cuivre",
              ep:(e.ep||0)*k, er:isFinite(dk)&&dk>0?dk:0,
              df:isFinite(df)&&df>0?df:0,
              type:e.type||"", couche:c?c.i:-1};
    });

  /* Les conducteurs, dans l'ordre physique. Leur épaisseur peut venir du
     fichier, d'une saisie, ou d'un repli — on retient laquelle : la fiche le
     dit, et l'utilisateur sait alors où il en est. */
  LT.cu=[];
  LT.pile.forEach(function(e,rang){
    if(!e.cuivre)return;
    const saisi=ltSaisi("cu",e.nom);
    LT.cu.push({nom:e.nom, rang:rang, couche:e.couche,
                ep:saisi||e.ep||LT_EP_CU,
                epSrc:saisi?"saisi":(e.ep?"fichier":"")});
  });

  /* Un intervalle par couple de conducteurs voisins : l'épaisseur de
     diélectrique qui les sépare, et sa permittivité moyenne. Un empilage qui
     ne liste que ses conducteurs donne des intervalles vides — c'est
     exactement ce que la saisie vient combler. */
  LT.gap=[];
  for(let i=0;i+1<LT.cu.length;i++){
    const a=LT.cu[i], b=LT.cu[i+1];
    let t=0,s=0,sdf=0,tdf=0,connu=false,dfConnu=false;
    for(let r=a.rang+1;r<b.rang;r++){
      const e=LT.pile[r];
      if(!e||e.cuivre)continue;
      const er=e.er||LT_ER;
      if(e.er)connu=true;
      t+=e.ep; s+=e.ep*er;
      /* Le Df se moyenne comme le Dk, pondéré par l'épaisseur — mais sur les
         seules couches qui en portent un : moyenner un repli avec une valeur
         mesurée donnerait un chiffre qui n'est ni l'un ni l'autre. */
      if(e.df>0){tdf+=e.ep; sdf+=e.ep*e.df; dfConnu=true;}
    }
    const cle=ltCleGap(a.nom,b.nom);
    const tSaisi=ltSaisi("gap_t",cle), erSaisi=ltSaisi("gap_er",cle);
    LT.gap.push({
      cle:cle, a:a.nom, b:b.nom,
      t:tSaisi||t, tSrc:tSaisi?"saisi":(t>0?"fichier":""),
      er:erSaisi||(t>0?s/t:0)||LT_ER,
      erSrc:erSaisi?"saisi":(connu?"fichier":""),
      df:dfConnu&&tdf>0?sdf/tdf:LT_DF,
      dfSrc:dfConnu?"fichier":""
    });
  }

  /* L'aire de la carte, et celle que couvre le cuivre plein de chaque couche :
     c'est ce qui distingue un plan de référence d'un simple îlot, faute de
     rôle déclaré dans le fichier. */
  LT.aire=0;
  if(m.contour&&m.contour.o&&m.contour.o.length>=6){
    LT.aire=ltAire(m.contour.o);
    for(const t of (m.contour.t||[]))LT.aire-=ltAire(t);
  }
  if(!(LT.aire>0)&&V.bbox)
    LT.aire=(V.bbox.x2-V.bbox.x1)*(V.bbox.y2-V.bbox.y1);
  for(const c of V.couches){
    let a=0;
    for(const g of c.plans)for(const ct of g.g){
      a+=ltAire(ct.o);
      for(const t of (ct.t||[]))a-=ltAire(t);
    }
    c.airePlans=Math.max(0,a);
    c.tauxPlan=LT.aire>0?a/LT.aire:0;
  }
  for(const e of LT.cu){
    e.planSrcAuto=ltEstPlan(e);
    e.roleAuto=ltAutoRole(e);
    const surRole=V.sur&&V.sur.role&&V.sur.role[e.nom];
    if(surRole==="gnd"||surRole==="pwr"||surRole==="signal"||surRole==="plan"){
      e.role=(surRole==="plan"?"gnd":surRole);
      e.plan=(e.role==="gnd"||e.role==="pwr");
      e.planSrc="saisi";
      e.roleSaisi=true;
    }else{
      e.role=e.roleAuto;
      e.planSrc=e.planSrcAuto;
      e.plan=(e.role==="gnd"||e.role==="pwr");
      e.roleSaisi=false;
    }
    const c=V.couches[e.couche];
    e.taux=c?c.tauxPlan:0;
  }
  LT.pret=LT.cu.length>0;
}

/* Auto-détection fine du rôle de la couche : GND, PWR ou Signal */
function ltAutoRole(cu){
  if(!cu)return "signal";
  const e=LT.pile[cu.rang];
  const typeStr=String((e&&e.type)||"").toUpperCase();
  const nomStr=String(cu.nom||"").toUpperCase();
  if(/GROUND|GND/.test(typeStr)||/GND|MASSE|0V|VSS/i.test(nomStr))return "gnd";
  if(/POWER|PWR/.test(typeStr)||/POWER|PWR|VCC|VDD|ALIM|\+3V|\+5V|\+12V/i.test(nomStr))return "pwr";
  /* LE NET AVANT LE TYPE, ET C'EST LE CORRECTIF. `/PLANE/ -> "gnd"` passait
     AVANT toute lecture du net : une couche déclarée PLANE dans le fichier
     sortait « masse » quels que soient les versements qu'elle porte, et le test
     des noms au-dessus ne regarde que le nom de la COUCHE — « Conductor-3 » n'y
     répond rien. Un plan d'alimentation d'un fichier IPC-2581 ordinaire était
     donc systématiquement pris pour une masse, et il fallait forcer le rôle à
     la main pour que l'outil voie le changement de référence.
     ON LIT DONC LE CUIVRE : le net du plus grand versement de la couche dit ce
     qu'elle est, bien mieux que son type. Le nom de net l'emporte sur le type
     déclaré, jamais l'inverse. */
  const netPlan=(typeof simNetDuPlanIpc==="function")?simNetDuPlanIpc(cu.couche):"";
  if(/GND|MASSE|0V|VSS/i.test(netPlan))return "gnd";
  if(/VCC|VDD|\+|PWR|POWER|ALIM/i.test(netPlan))return "pwr";
  if(/PLANE/.test(typeStr))return "gnd";
  const c=V.couches[cu.couche];
  if(c&&c.tauxPlan>=LT_SEUIL_PLAN){
    if(typeof simNetDuPlanIpc==="function"){
      const net=simNetDuPlanIpc(cu.couche);
      if(/VCC|VDD|\+|PWR|POWER|ALIM/i.test(net))return "pwr";
    }
    return "gnd";
  }
  return "signal";
}

/* Une couche de cuivre sert-elle de plan de référence ? Le fichier le dit
   parfois (layerFunction PLANE, POWER, GROUND). Sinon, on regarde le cuivre
   réellement posé : une zone qui couvre la carte est un plan, quel que soit
   le nom qu'on lui a donné. Même parti pris que le DRC de l'éditeur PCB —
   le cuivre en place, pas l'intention. */
function ltEstPlan(cu){
  if(!cu)return "";
  const e=LT.pile[cu.rang];
  if(e&&/PLANE|POWER|GROUND/i.test(e.type||""))return "declare";
  const c=V.couches[cu.couche];
  /* On rend la raison, pas seulement le verdict : « plan parce que le fichier
     le dit » et « plan parce que le cuivre couvre la carte » ne se valent pas,
     et la fiche d'une piste doit pouvoir le montrer. */
  return (c&&c.tauxPlan>=LT_SEUIL_PLAN)?"cuivre":"";
}
/* Ce qui sépare deux conducteurs, intervalles cumulés : épaisseur totale de
   diélectrique et permittivité moyenne pondérée. Les conducteurs traversés au
   passage ne comptent pas — c'est le diélectrique qui fait la distance
   électrique. */
function ltEntre(ka,kb){
  if(kb<ka){const k=ka;ka=kb;kb=k;}
  let t=0,s=0,connu=true,vide=false;
  for(let i=ka;i<kb;i++){
    const g=LT.gap[i];
    if(!g)continue;
    if(!g.t)vide=true;
    if(!g.erSrc)connu=false;
    t+=g.t; s+=g.t*g.er;
  }
  return {t:t, er:t>0?s/t:LT_ER, connu:connu&&!vide&&t>0};
}
/* La géométrie que voient les formules, pour une couche de cuivre donnée :
   microruban quand elle n'a de plan que d'un côté, triplaque quand elle en a
   de part et d'autre. */
function ltGeom(coucheIdx){
  if(!LT.pret)return null;
  const k=LT.cu.findIndex(e=>e.couche===coucheIdx);
  if(k<0)return null;

  let haut=-1,bas=-1;
  for(let i=k-1;i>=0;i--)if(LT.cu[i].plan){haut=i;break;}
  for(let i=k+1;i<LT.cu.length;i++)if(LT.cu[i].plan){bas=i;break;}

  const t=LT.cu[k].ep, epSupposee=!LT.cu[k].epSrc;

  if(haut>=0&&bas>=0){
    const a=ltEntre(haut,k), c=ltEntre(k,bas);
    const mini=Math.min(a.t,c.t), maxi=Math.max(a.t,c.t);
    return {kind:"strip", h:mini, b:a.t+c.t+t, t:t,
            er:(a.er*a.t+c.er*c.t)/Math.max(1e-6,a.t+c.t),
            erConnu:a.connu&&c.connu, epSupposee:epSupposee,
            /* La formule IPC-2141A suppose la piste à mi-hauteur entre les
               deux plans. Un empilage 4 couches courant ne l'est pas du tout —
               âme épaisse d'un côté, préimprégné mince de l'autre — et la
               valeur sort alors trop haute. On mesure l'écart pour pouvoir le
               dire, plutôt que de présenter un chiffre optimiste sans un mot. */
            dissym:maxi>0?(1-mini/maxi):0,
            ref:2, planHaut:LT.cu[haut].nom, planBas:LT.cu[bas].nom,
            kHaut:haut, kBas:bas};
  }
  const pres=haut>=0?haut:bas;
  if(pres<0){
    /* Aucun plan dans tout l'empilage : on prend le diélectrique voisin pour
       avoir une cote, et on prévient que le chiffre ne vaut rien tant qu'un
       plan ne répond pas à la piste. */
    const voisin=k>0?k-1:(LT.cu.length>1?k+1:-1);
    const d=voisin>=0?ltEntre(k,voisin):{t:0,er:LT_ER,connu:false};
    return {kind:"micro", h:d.t||0, b:0, t:t, er:d.er, erConnu:d.connu,
            epSupposee:epSupposee, dissym:0, ref:0, planHaut:"", planBas:"",
            kHaut:-1, kBas:-1};
  }
  const d=ltEntre(k,pres);
  return {kind:"micro", h:d.t, b:0, t:t, er:d.er, erConnu:d.connu,
          epSupposee:epSupposee, dissym:0, ref:1,
          planHaut:haut>=0?LT.cu[haut].nom:"",
          planBas:bas>=0?LT.cu[bas].nom:"",
          kHaut:haut, kBas:bas};
}
/* L'ÉPAISSEUR DU CUIVRE, RAMENÉE À UNE LARGEUR (Wheeler).

   Hammerstad-Jensen traite un ruban d'épaisseur nulle. Un ruban épais porte de
   la charge sur ses flancs : il se comporte comme un ruban mince un peu plus
   large. Sans cette correction, la fiche lisait systématiquement HAUT — 51,0 Ω
   là où le solveur de section donne 48,0 —, et l'écart passait pour le prix de
   la formule légère alors que c'était un terme manquant. Avec elle, la même
   formule donne 48,1 : le mode rapide et le mode Simulation EM s'accordent
   désormais à quelques dixièmes de pour cent, et quand ils divergent c'est que
   la géométrie sort du domaine de la formule — ce qui est une information.

   C'est mot pour mot `_largeur_effective()` de python/ligne_mom.py. */
function ltWeff(g,w){
  const t=g.t||0, h=Math.max(g.h,1e-4);
  if(!(t>0)||!(w>0))return w;
  return w+(t/Math.PI)*(1+Math.log(2*h/t));
}
/* Permittivité effective (Hammerstad). Le microruban a de l'air d'un côté :
   il voit une moyenne entre l'air et le stratifié, et d'autant plus de
   stratifié que la piste est large devant la hauteur du diélectrique. La
   triplaque, noyée, ne voit que le stratifié. */
function ltEeff(g,w){
  if(g.kind==="strip")return g.er;
  const h=Math.max(g.h,1e-4), x=Math.max(ltWeff(g,w),1e-4);
  return (g.er+1)/2+(g.er-1)/2/Math.sqrt(1+12*h/x);
}
/* Impédance caractéristique. Microruban : Hammerstad-Jensen, en deux branches
   selon que la piste est plus étroite ou plus large que la hauteur du
   diélectrique — c'est la même courbe, mais aucune des deux expressions ne la
   suit sur toute sa longueur. Triplaque : l'approximation de l'IPC-2141A.

   CE QUE CETTE FORMULE EST, ET CE QU'ELLE N'EST PAS. C'est l'aperçu : elle
   répond au clic, sans serveur ni Python, et elle vaut mieux que le pour cent
   sur un microruban courant. Elle ne voit pas ce que voit le panneau
   « Simulation EM » — une triplaque décentrée, une piste interne couverte, une
   section qui sort de son domaine d'ajustement. Les deux ne se remplacent pas
   l'un l'autre ; ils se recoupent, et c'est le recoupement qui informe. */
function ltZ0(g,w){
  if(!(w>0))return 0;
  if(g.kind==="strip"){
    const b=Math.max(g.b,1e-4);
    const x=4*b/(0.67*Math.PI*(0.8*w+g.t));
    return x>1?60/Math.sqrt(g.er)*Math.log(x):0;
  }
  if(!(g.h>0))return 0;
  const h=g.h, e=Math.sqrt(ltEeff(g,w)), u=ltWeff(g,w)/h;
  return u<=1 ? 60/e*Math.log(8/u+u/4)
              : 120*Math.PI/(e*(u+1.393+0.667*Math.log(u+1.444)));
}
/* Ce qu'une piste vaut : sa géométrie, son impédance, son retard, et les deux
   éléments répartis qui s'en déduisent — C = t/Z₀, L = t·Z₀. Renvoie null
   quand la couche n'est pas du cuivre de l'empilage : sans empilage, il n'y a
   pas de ligne, seulement un trait. */
function ltPiste(piste,coucheIdx){
  const g=ltGeom(coucheIdx==null?piste.c:coucheIdx);
  if(!g)return null;
  const k=(V.unite==="in")?25.4:1;
  const w=(piste.w||0)*k, len=mdlLongueur(piste.p)*k;
  const eeff=ltEeff(g,w), z0=ltZ0(g,w);
  const tpd=len*Math.sqrt(eeff)/LT_C0;
  return {g:g, w:w, len:len, eeff:eeff, z0:z0, tpd:tpd,
          c:z0>0?tpd/z0:0, ind:tpd*z0,
          psmm:len>0?tpd*1e12/len:0,
          /* Ce sur quoi il a fallu se rabattre : la fiche le dit, plutôt que
             de présenter une valeur devinée comme une valeur lue. */
          suppose:{er:!g.erConnu, ep:g.epSupposee, plan:g.ref===0,
                   larg:!(piste.w>0)}};
}

function ltArc(arc,coucheIdx){
  const g=ltGeom(coucheIdx==null?arc.c:coucheIdx);
  if(!g)return null;
  const k=(V.unite==="in")?25.4:1;
  const w=(arc.w||0)*k, len=mdlArcLongueur(arc)*k;
  const eeff=ltEeff(g,w), z0=ltZ0(g,w);
  const tpd=len*Math.sqrt(eeff)/LT_C0;
  return {g:g, w:w, len:len, eeff:eeff, z0:z0, tpd:tpd,
          c:z0>0?tpd/z0:0, ind:tpd*z0,
          psmm:len>0?tpd*1e12/len:0,
          suppose:{er:!g.erConnu, ep:g.epSupposee, plan:g.ref===0,
                   larg:!(arc.w>0)}};
}

/* Ce que vaut un net entier comme ligne. Un net n'a pas une impédance : il en
   a autant que de morceaux — une largeur ici, un changement de couche là — et
   en faire une somme n'aurait aucun sens. Ce qui s'additionne, ce sont les
   grandeurs réparties : la longueur, le retard, la capacité au plan et
   l'inductance série. Z₀ est rendue telle qu'elle est, en étendue et en
   moyenne pondérée par la longueur — la seule façon honnête de résumer un net
   qui court à 50 Ω sur trois centimètres et à 70 Ω sur trois millimètres.

   Rien n'est gardé en cache : l'empilage se corrige à la main dans « La
   carte », et une valeur saisie doit se voir aussitôt sur la fiche ouverte.
   Le net le plus fourni de cette carte fait trois cents pistes ; les
   parcourir ne se sent pas. */
function ltNet(i){
  const n=V.parNet[i];
  if(!n||(!n.pistes.length&&!n.arcs.length))return null;
  const k=(V.unite==="in")?25.4:1;
  const morceaux=new Map();
  const out={len:0, tpd:0, c:0, ind:0, pistes:0, arcs:0,
             z0min:Infinity, z0max:0, z0moy:0, lenZ0:0,
             lenHors:0, couchesHors:[], morceaux:[],
             suppose:{er:false, ep:false, plan:false, larg:false}};
  const hors=new Set();

  function ajouterMorceau(e, obj, isArc){
    if(!e){
      const segLen=(isArc?mdlArcLongueur(obj):mdlLongueur(obj.p))*k;
      out.lenHors+=segLen;
      hors.add(obj.c);
      return;
    }
    out.len+=e.len; out.tpd+=e.tpd; out.c+=e.c; out.ind+=e.ind;
    if(isArc)out.arcs++; else out.pistes++;
    for(const f in out.suppose)if(e.suppose[f])out.suppose[f]=true;
    if(e.z0>0){
      if(e.z0<out.z0min)out.z0min=e.z0;
      if(e.z0>out.z0max)out.z0max=e.z0;
      out.z0moy+=e.z0*e.len; out.lenZ0+=e.len;
    }
    const cle=obj.c+"|"+Math.round((obj.w||0)*1000);
    let m=morceaux.get(cle);
    if(!m){
      m={couche:obj.c, w:e.w, z0:e.z0, eeff:e.eeff, len:0, n:0, pistes:0, arcs:0};
      morceaux.set(cle,m);
    }
    m.len+=e.len; m.n++;
    if(isArc)m.arcs++; else m.pistes++;
  }

  for(const p of n.pistes)ajouterMorceau(ltPiste(p,p.c),p,false);
  for(const a of n.arcs)ajouterMorceau(ltArc(a,a.c),a,true);

  out.z0moy=out.lenZ0>0?out.z0moy/out.lenZ0:0;
  if(!(out.z0max>0))out.z0min=0;
  out.couchesHors=[...hors];
  out.morceaux=[...morceaux.values()].sort((a,b)=>b.len-a.len);
  return out;
}

/* Ce que l'empilage ne dit pas, et que la fiche d'une piste devra supposer.
   Sert à prévenir dès l'import, avant qu'on ne lise un chiffre en croyant
   qu'il vient du fichier. */
function ltManques(){
  const out={ep:[],er:[],epaisseur:[],aucunPlan:false,total:0};
  if(!LT.pret)return out;
  for(const e of LT.cu)if(!e.epSrc)out.ep.push(e.nom);
  for(const g of LT.gap){
    if(!g.tSrc)out.epaisseur.push(g.cle);
    else if(!g.erSrc)out.er.push(g.cle);
  }
  out.aucunPlan=!LT.cu.some(e=>e.plan);
  out.total=out.ep.length+out.er.length+out.epaisseur.length;
  return out;
}
