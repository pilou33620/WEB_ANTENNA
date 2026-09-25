"use strict";
/* =============================================================================
   Antenne openEMS — 37-port-auto.js
   Un clic sur l'antenne, et le port se pose tout seul là où il est juste.

   CE QUE LE CLIC NE DISAIT PAS. Il donnait le point, la largeur de la piste
   et la couche de l'antenne ; la couche « vers » était devinée sur l'empilage
   seul (`antMasseSous`), et gardée d'un clic à l'autre. Sur P01x274PCB-C.xml
   — antenne sur Conductor-4, alimentée par le trou métallisé d'un point de
   test du dessus —, le port cliqué allait de Conductor-4 à Conductor-2 : il
   traversait Conductor-3 et arrivait dans la réserve de Conductor-2, à
   0,04 mm de son bord. Rien ne le disait avant le calcul, et 0,8 mm plus
   loin, le long du même ruban, un port de Conductor-4 à Conductor-3 était
   franc.

   CE QUE FAIT LE CLIC, DÉSORMAIS :
     1. « vers » se lit dans le cuivre retenu, au point : la couche de masse
        la plus proche en z dont le cuivre est PLEIN sous le port, à
        ANT_PORT_MARGE_MM de tout bord — la grille se cale à une maille près,
        et un port posé contre un bord tombe d'un côté ou de l'autre selon
        elle. Les couches traversées pour l'atteindre doivent être vides au
        point, avec la même marge : un port qui traverse du métal est
        court-circuité par lui. Aucun trou métallisé qui passe entre les deux
        couches ne doit être à moins de cette marge.
     2. Si le point cliqué ne le permet pas, on cherche, en cercles de plus
        en plus larges jusqu'à ANT_PORT_RAYON_MM, le point le plus proche SUR
        L'ANTENNE où il le permet, et l'on y déplace le port — en le disant.
     3. Si aucun port vertical n'est possible — une antenne coplanaire, sans
        masse dessous —, on pose un port DANS LE PLAN, en travers de la fente
        la plus étroite entre l'antenne et sa masse, sur la même couche.
   Les listes et les cotes restent là pour reprendre la main.

   LA RÈGLE EST CELLE DU VERDICT (36-port-verdict.js), ET C'EST LE MÊME CODE :
   `antPortFranc`, `antPortTraverse` et `antPortViaGenant` servent aux deux.
   Deux règles voisines se contrediraient — un port posé « franc » par le
   clic, puis marqué d'un ✗ par le verdict, ou l'inverse.

   LA DÉCISION EST UNE FONCTION PURE (`antPortChercher`) : elle ne lit la
   carte que par la fonction `nature` qu'on lui passe, et test/banc-
   interface.js l'éprouve sur des cartes faites à la main.
   ============================================================================= */

/* Les distances, en mm ; `antPortChercher` les convertit à l'unité du
   fichier par le facteur `k` qu'on lui passe. */
const ANT_PORT_MARGE_MM=0.3;       // cuivre plein autour de la borne de masse
const ANT_PORT_MARGE_ANT_MM=0.05;  // autour de la borne d'antenne : un ruban est étroit
const ANT_PORT_MARGE_FIN_MM=0.01;  // ... et pour un ruban plus fin que deux fois cela
const ANT_PORT_RAYON_MM=3.0;       // jusqu'où l'on cherche un meilleur point
const ANT_PORT_PAS_MM=0.05;        // finesse de cette recherche
const ANT_PORT_FENTE_MAX_MM=2.0;   // au-delà, un port dans le plan mesure une ligne

/* --------------------------------------------------------------------------
   Les critères, partagés avec le verdict
   -------------------------------------------------------------------------- */
/* Ce cuivre-là, au point ET tout autour jusqu'à la distance r : seize
   directions, sur trois cercles (r/3, 2r/3, r). Huit rayons sur le seul
   cercle extérieur laissaient passer un coin de réserve logé entre deux
   d'entre eux. */
function antPortFranc(nature,c,x,y,r,val){
  if(nature(c,x,y)!==val)return false;
  for(let n=1;n<=3;n++){
    const d=r*n/3;
    for(let a=0;a<16;a++){
      const t=a*Math.PI/8;
      if(nature(c,x+d*Math.cos(t),y+d*Math.sin(t))!==val)return false;
    }
  }
  return true;
}

/* La distance au bord le plus proche — le premier point, en cercles de `pas`
   jusqu'à `rmax`, où le cuivre n'est plus `val`. null s'il n'y en a pas.
   Pour le dire, pas pour décider : la décision est `antPortFranc`. */
function antPortBord(nature,c,x,y,val,rmax,pas){
  if(nature(c,x,y)!==val)return 0;
  for(let d=pas;d<=rmax+1e-12;d+=pas)
    for(let a=0;a<16;a++){
      const t=a*Math.PI/8;
      if(nature(c,x+d*Math.cos(t),y+d*Math.sin(t))!==val)return d;
    }
  return null;
}

/* Les couches STRICTEMENT entre « de » et « a » dans l'empilage : celles que
   la ligne du port traverse. */
function antPortEntre(couches,de,a){
  const i=couches.findIndex(c=>c.nom===de), j=couches.findIndex(c=>c.nom===a);
  if(i<0||j<0)return [];
  return couches.slice(Math.min(i,j)+1,Math.max(i,j));
}

/* Ce que la ligne du port rencontre en chemin, au point : [{nom, nature}]. */
function antPortTraverse(nature,couches,de,a,x,y){
  const out=[];
  for(const c of antPortEntre(couches,de,a)){
    const n=nature(c.nom,x,y);
    if(n)out.push({nom:c.nom,nature:n});
  }
  return out;
}

/* Le trou métallisé qui gêne un port vertical de « de » à « a » en (x, y) :
   celui qui PASSE entre ces deux couches — son fût et la ligne du port
   partagent une hauteur — et dont le bord est à moins de `marge`. Rend
   {v, jeu} (jeu : distance du bord du fût au port, ≤ 0 s'il est dessus) ou
   null. Un via qui ne fait que s'arrêter sur l'une des deux couches n'est
   pas entre elles : il ne double pas le port. Une couche inconnue de
   l'empilage compte pour tout l'empilage — mieux vaut écarter un point de
   trop que d'en garder un court-circuité. */
function antPortViaGenant(vias,couches,de,a,x,y,marge){
  const i=couches.findIndex(c=>c.nom===de), j=couches.findIndex(c=>c.nom===a);
  if(i<0||j<0||!vias||!vias.length)return null;
  const p1=Math.min(i,j), p2=Math.max(i,j);
  let pire=null;
  for(const v of vias){
    let a1=couches.findIndex(c=>c.nom===v.de), a2=couches.findIndex(c=>c.nom===v.a);
    if(a1<0||a2<0){ a1=0; a2=couches.length-1; }
    if(Math.max(p1,Math.min(a1,a2))>=Math.min(p2,Math.max(a1,a2)))continue;
    const jeu=Math.hypot(v.x-x,v.y-y)-(v.d||0)/2;
    if(jeu<=marge&&(!pire||jeu<pire.jeu))pire={v:v,jeu:jeu};
  }
  return pire;
}

/* --------------------------------------------------------------------------
   La décision
   -------------------------------------------------------------------------- */
/* q = {x, y, de, couches:[{nom, z}] dans l'ordre de l'empilage,
        nature:(nomCouche, x, y) => "antenne" | "masse" | "", k,
        vias:[{x, y, d, de, a}] (facultatif)}
   Rend {x, y, de, a, dir, ecart, deplace, fente} ou {echec: "…"}. */
function antPortChercher(q){
  const k=q.k||1;
  const marge=ANT_PORT_MARGE_MM*k;
  const rayon=ANT_PORT_RAYON_MM*k, pas=ANT_PORT_PAS_MM*k;
  const nature=q.nature, couches=q.couches||[], de=q.de, vias=q.vias||[];
  const i=couches.findIndex(c=>c.nom===de);
  if(i<0)return {echec:"la couche de l'antenne n'est pas dans l'empilage"};

  /* La masse franche la plus proche en z, sans traverser de métal. */
  const vers=function(x,y){
    let mieux=null;
    for(const s of [1,-1]){
      for(let j=i+s;j>=0&&j<couches.length;j+=s){
        const c=couches[j].nom;
        if(antPortFranc(nature,c,x,y,marge,"masse")){
          const dz=Math.abs(couches[j].z-couches[i].z);
          if(!mieux||dz<mieux.dz)mieux={nom:c,dz:dz};
          break;
        }
        if(!antPortFranc(nature,c,x,y,marge,""))break;  // du métal, ou un bord trop près
      }
    }
    return mieux&&mieux.nom;
  };

  const x0=q.x, y0=q.y;
  let premier=null;                 // le point d'antenne le plus proche, pour la fente
  /* UN RUBAN PLUS FIN QUE DEUX MARGES N'EST JAMAIS « SUR L'ANTENNE » : un
     méandre de 0,08 mm refusait tout port, et le refus disait « aucun cuivre
     à moins de 3 mm » quand on avait cliqué dessus. La marge ordinaire
     d'abord ; si elle ne trouve aucun cuivre d'antenne, une marge de
     ANT_PORT_MARGE_FIN_MM — le port se pose alors au milieu du ruban. */
  for(const margeAnt of [ANT_PORT_MARGE_ANT_MM*k, ANT_PORT_MARGE_FIN_MM*k]){
    const essai=function(x,y){
      if(!antPortFranc(nature,de,x,y,margeAnt,"antenne"))return null;
      if(!premier)premier={x:x,y:y};
      const a=vers(x,y);
      if(!a||antPortViaGenant(vias,couches,de,a,x,y,marge))return null;
      return {x:x,y:y,de:de,a:a,dir:"z",
              deplace:Math.hypot(x-x0,y-y0),fente:false};
    };
    let r=essai(x0,y0);
    if(r)return r;
    for(let d=pas;d<=rayon+1e-12;d+=pas){
      const n=Math.max(8,Math.ceil(2*Math.PI*d/pas));
      for(let m=0;m<n;m++){
        const t=2*Math.PI*m/n;
        r=essai(x0+d*Math.cos(t),y0+d*Math.sin(t));
        if(r)return r;
      }
    }
    if(premier)break;
  }

  /* Pas de port vertical : la fente la plus étroite vers la masse de la
     même couche, depuis le point d'antenne le plus proche du clic. */
  if(!premier)
    return {echec:"aucun cuivre d'antenne retenu à moins de "+
                  ANT_PORT_RAYON_MM+" mm du clic, sur « "+de+" »"};
  const fin=0.01*k, loin=ANT_PORT_FENTE_MAX_MM*k;
  /* Le bord, entre deux échantillons : `dedans` est vrai en s0, faux en s1.
     Le pas de 0,01 mm laissait jusqu'à 10 % d'erreur sur une fente de
     0,1 mm, et c'est l'écart que le port enjambe. */
  const bord=function(ux,uy,s0,s1,dedans){
    for(let n=0;n<16;n++){
      const m=(s0+s1)/2;
      if(dedans(nature(de,premier.x+ux*m,premier.y+uy*m)))s0=m; else s1=m;
    }
    return (s0+s1)/2;
  };
  let fente=null;
  for(const [ux,uy,axe] of [[1,0,"x"],[-1,0,"x"],[0,1,"y"],[0,-1,"y"]]){
    let s1=-1, s2=-1;
    for(let s=0;s<=loin+rayon;s+=fin){
      const v=nature(de,premier.x+ux*s,premier.y+uy*s);
      if(s1<0){ if(v!=="antenne")s1=s; if(v==="masse"){s2=s;break;} continue; }
      if(v==="masse"){s2=s;break;}
      if(v==="antenne"||s-s1>loin)break;        // retour dans l'antenne, ou trop loin
    }
    if(s1<0||s2<0||s2-s1<=0)continue;
    const e1=bord(ux,uy,s1-fin,s1,v=>v==="antenne");
    const e2=bord(ux,uy,s2-fin,s2,v=>v!=="masse");
    const g=e2-e1, c=(e1+e2)/2;
    if(!(g>0))continue;
    if(!fente||g<fente.ecart)
      fente={x:premier.x+ux*c,y:premier.y+uy*c,dir:axe,ecart:g};
  }
  if(!fente)
    return {echec:"ni masse franche sous l'antenne, ni masse à moins de "+
                  ANT_PORT_FENTE_MAX_MM+" mm sur « "+de+" »"};
  /* « vers » n'a pas de sens physique pour un port dans le plan, mais le
     serveur exige deux couches distinctes : la voisine. Le serveur ne la
     prend pas pour un plan de référence (`_masse_cachee`). */
  const voisine=couches[i+1]||couches[i-1];
  return {x:fente.x,y:fente.y,de:de,a:voisine?voisine.nom:de,dir:fente.dir,
          ecart:fente.ecart,deplace:Math.hypot(fente.x-x0,fente.y-y0),
          fente:true};
}

/* Les couches de cuivre dans l'ordre de l'empilage, avec leur cote z tirée
   des épaisseurs de diélectrique (une épaisseur inconnue compte pour 1). */
function antCouchesEnZ(){
  let z=0;
  return LT.cu.map(function(c,i){
    if(i>0){ const g=LT.gap[i-1]; z-=(g&&g.t>0)?g.t:1; }
    return {nom:c.nom,z:z};
  });
}

/* --------------------------------------------------------------------------
   Le branchement : appelé par `antPortEn` (15-overlay2d.js) après le clic
   -------------------------------------------------------------------------- */
/* Ce que le dernier clic a décidé, par port — pour la note du panneau. Pas
   dans le port lui-même : il part au serveur et dans le projet. */
const ANT_PORT_AUTO=new WeakMap();

/* Une cote ou une couche retouchée à la main : la note du dernier clic ne
   décrit plus le port, elle s'en va. Le verdict, lui, reste et juge. */
function antPortAutoOublier(p){
  if(p)ANT_PORT_AUTO.delete(p);
}

function antPortAuto(){
  const p=ANT.port;
  if(!p||p.type==="coaxial"||!p.de||!V.modele)return null;
  const k=V.unite==="in"?1/25.4:1;
  const couches=antCouchesEnZ();
  const cu=antCuivreDuModele();
  const vias=(cu&&cu.vias)||[];
  const chercher=de=>antPortChercher({x:p.x,y:p.y,de:de,couches:couches,
                                      nature:antCuivreRetenuEn,k:k,vias:vias});
  let r=chercher(p.de);
  /* UN CLIC À CÔTÉ DE L'ANTENNE NE DIT PAS SA COUCHE : « de » est alors
     celle du clic précédent. On cherche sur chaque couche, et l'on garde le
     point le plus proche du clic. */
  if(antCuivreRetenuEn(p.de,p.x,p.y)!=="antenne")
    for(const c of couches){
      if(c.nom===p.de)continue;
      const r2=chercher(c.nom);
      if(!r2.echec&&(r.echec||r2.deplace<r.deplace))r=r2;
    }
  if(!r.echec)p.de=r.de;
  let texte;
  if(r.echec){
    /* RIEN DU CLIC PRÉCÉDENT NE RESTE. Son orientation, son écart et sa
       couche « vers » avaient été décidés pour un AUTRE point : un port
       dans le plan restait dans le plan, en travers d'une fente qui n'est
       pas ici. On revient au port vertical et à la masse devinée par
       l'empilage ; le verdict dira ce qu'ils touchent. */
    p.dir="z";
    p.a=typeof antMasseSous==="function"?antMasseSous(p.de):"";
    texte="Port laissé où il a été cliqué : "+r.echec+". Vérifiez les deux "+
          "couches à la main.";
  } else {
    p.x=+r.x.toFixed(4); p.y=+r.y.toFixed(4);
    p.a=r.a; p.dir=r.dir;
    if(r.fente)p.ecart=+r.ecart.toFixed(4);
    /* La largeur du port suit le point où il est posé, pas celui du clic. */
    const t=typeof antPisteSous==="function"?antPisteSous(r.x,r.y):null;
    if(t&&t.w>0){ p.w=+Math.max(t.w,0.05).toFixed(4); p.l=p.w; }
    const loin=r.deplace>0.001*k;
    texte=r.fente
      ? "Aucune masse franche sous l'antenne : port posé dans le plan de « "+
        r.de+" », en travers de la fente de "+aL(r.ecart)+" vers la masse"+
        (loin?", à "+aL(r.deplace)+" du clic":"")+"."
      : (loin?"Port déplacé de "+aL(r.deplace)+" : ici, ":"Ici, ")+
        "la masse de « "+r.a+" » est pleine sous le port, à "+
        aL(ANT_PORT_MARGE_MM*k)+" au moins de tout bord et de tout trou "+
        "métallisé, et rien n'est traversé entre « "+r.de+" » et elle.";
  }
  ANT_PORT_AUTO.set(p,{texte:texte,ok:!r.echec});
  if(typeof wsHint==="function")wsHint(texte);
  return r;
}

/* La note du panneau : ce que le dernier clic a fait du port. */
function antPortAutoHtml(){
  const d=ANT.port&&ANT_PORT_AUTO.get(ANT.port);
  if(!d)return "";
  return '<div class="avis"><div class="av '+(d.ok?"info":"attention")+
         '"><span>'+(d.ok?"⌖ ":"")+aEsc(d.texte)+'</span></div></div>';
}
