"use strict";
/* =============================================================================
   Antenne openEMS — 27-apercu-motif.js
   Le rendu d'un motif d'antenne : un dessin SVG, coté, AVANT de le poser.

   POURQUOI CE MODULE EXISTE. Choisir un motif dans une liste de noms demande
   de savoir à quoi ressemble un « F inversé à méandres » et sur quelle cote
   il se règle. Un dessin le dit en une seconde, et il dit AUSSI ce qu'une
   cote retouchée change — puisqu'il se refait à chaque frappe.

   DEUX FAÇONS D'ANNOTER, ET IL EN FALLAIT DEUX. La ligne de cote — deux
   tirets, un trait, un nom — porte les longueurs qu'on voit : un patch, un
   bras, un plan de masse. Elle ne peut RIEN porter en dessous de trois
   pixels, et une largeur de piste ou un diamètre de via en font deux. Ces
   longueurs-là se règlent pourtant comme les autres, et les taire reviendrait
   à dire qu'elles ne se règlent pas ; elles sont donc annotées en REPÈRE (un
   point, un trait, un nom posé plus loin), ce que fait tout plan pour la même
   raison. Chaque champ du motif a ainsi son annotation, et une seule.

   CE QU'IL NE FAIT PAS, ET C'EST LE POINT. Il n'écrit rien : ni dans
   `CON.elements`, ni dans le document, ni dans le port. Il appelle
   `tracer()` de 22-antennes.js, exactement celui que la pose appellera, et il
   met en image ce qu'il rend. Deux tracés différents — un pour voir, un pour
   poser — finiraient par diverger, et c'est l'aperçu qu'on croirait.

   LES DÉCOUPES SONT PEINTES PAR-DESSUS, en couleur de substrat. C'est une
   approximation d'AFFICHAGE : une découpe n'efface ici que ce qui est
   au-dessous d'elle à l'écran, pas seulement le cuivre de sa couche. Sur les
   motifs du catalogue les deux coïncident (les seules découpes sont les
   encoches du patch, sur la couche du dessus). Le document, lui, est construit
   par 25-polygones.js, qui découpe pour de bon.
   ============================================================================= */

/* La palette de l'aperçu. Les variables du thème sont lues telles quelles :
   un aperçu qui aurait ses propres couleurs jurerait avec la carte. */
const APM_COULEURS={
  substrat:"var(--panel2)",
  bord:"var(--border2)",
  haut:"var(--yellow)",
  bas:"var(--blue)",
  via:"var(--txt)",
  port:"var(--red)",
  cote:"var(--txt-dim)"
};

/* ==========================================================================
   L'étendue à montrer
   --------------------------------------------------------------------------
   La carte, plus la place que prennent les cotes portées à l'extérieur. Une
   cote posée hors du contour est la règle du dessin technique — et c'est
   aussi la seule façon de ne pas écrire par-dessus le cuivre.
   ========================================================================== */
function apmBoite(t,avecCotes){
  const b={x1:0, y1:0, x2:t.carte.L, y2:t.carte.W};
  if(avecCotes)(t.cotes||[]).forEach(function(k){
    /* Un repère porte son étiquette au bout de son trait : c'est ce point-là
       qu'il faut garder dans le cadre, avec de quoi écrire trois ou quatre
       caractères à côté. */
    if(k.rep){
      b.x1=Math.min(b.x1,k.x2-4); b.x2=Math.max(b.x2,k.x2+4);
      b.y1=Math.min(b.y1,k.y2-2); b.y2=Math.max(b.y2,k.y2+2);
      return;
    }
    /* Le décalage est perpendiculaire : en y pour une cote horizontale, en x
       pour une cote verticale. Une marge d'un millimètre et demi laisse la
       place de l'étiquette. */
    const m=1.5+Math.abs(k.dec);
    if(Math.abs(k.y1-k.y2)<1e-9){
      const y=k.y1+k.dec;
      b.y1=Math.min(b.y1,y-1.5); b.y2=Math.max(b.y2,y+1.5);
    }else{
      const x=k.x1+k.dec;
      b.x1=Math.min(b.x1,x-m); b.x2=Math.max(b.x2,x+m);
    }
  });
  return b;
}

/* ==========================================================================
   Le dessin
   --------------------------------------------------------------------------
   `opts` : {w, h} la place en pixels, `cotes` pour les annoter, `port` pour
   le montrer. Les vignettes de la galerie n'ont ni cotes ni port — à cette
   taille, elles ne feraient qu'une tache ; la planche du motif choisi a les
   deux.
   ========================================================================== */
function apmSVG(g,p,opts){
  opts=opts||{};
  const W=opts.w||300, H=opts.h||190;
  const marge=opts.cotes?16:5;

  let t;
  try{
    const c=conContexte();
    t=g.tracer(c,conGabaritCotes(g,c,p));
  }catch(e){ t=null; }
  if(!t||!(t.carte.L>0)||!(t.carte.W>0))
    return '<svg class="apm" viewBox="0 0 '+W+' '+H+'"></svg>';

  const b=apmBoite(t,!!opts.cotes);
  const k=Math.min((W-2*marge)/Math.max(b.x2-b.x1,1e-6),
                   (H-2*marge)/Math.max(b.y2-b.y1,1e-6));
  /* Centré dans la place donnée, et l'axe y RETOURNÉ : le dessin a son
     origine en bas à gauche comme la carte, l'écran l'a en haut à gauche. */
  const ox=(W-(b.x2-b.x1)*k)/2-b.x1*k;
  const oy=(H+(b.y2-b.y1)*k)/2+b.y1*k;
  const X=mm=>+(ox+mm*k).toFixed(2);
  const Y=mm=>+(oy-mm*k).toFixed(2);
  const E=mm=>+(mm*k).toFixed(2);

  const out=[];
  out.push('<svg class="apm" viewBox="0 0 '+W+' '+H+'" '+
           'preserveAspectRatio="xMidYMid meet">');

  /* 1. Le substrat. */
  out.push('<rect x="'+X(0)+'" y="'+Y(t.carte.W)+'" width="'+E(t.carte.L)+
           '" height="'+E(t.carte.W)+'" fill="'+APM_COULEURS.substrat+
           '" stroke="'+APM_COULEURS.bord+'" stroke-width="1"/>');

  /* 2. Le cuivre, la couche du dessous d'abord — elle passe SOUS celle du
        dessus, comme sur la carte. */
  const forme=function(f,couleur,opacite){
    if(f.type==="rect"){
      const x1=Math.min(f.x1,f.x2), x2=Math.max(f.x1,f.x2);
      const y1=Math.min(f.y1,f.y2), y2=Math.max(f.y1,f.y2);
      out.push('<rect x="'+X(x1)+'" y="'+Y(y2)+'" width="'+E(x2-x1)+
               '" height="'+E(y2-y1)+'" fill="'+couleur+
               '" fill-opacity="'+opacite+'"/>');
    }else if(f.type==="piste"){
      out.push('<polyline points="'+
        f.pts.map(q=>X(q[0])+","+Y(q[1])).join(" ")+
        '" fill="none" stroke="'+couleur+'" stroke-opacity="'+opacite+
        '" stroke-width="'+Math.max(E(f.w),1)+
        '" stroke-linecap="round" stroke-linejoin="round"/>');
    }else if(f.type==="via"){
      out.push('<circle cx="'+X(f.x)+'" cy="'+Y(f.y)+'" r="'+
        Math.max(E(f.d/2),1.5)+'" fill="none" stroke="'+APM_COULEURS.via+
        '" stroke-width="1.2"/>');
      out.push('<circle cx="'+X(f.x)+'" cy="'+Y(f.y)+'" r="'+
        Math.max(E(f.d/4),0.8)+'" fill="'+APM_COULEURS.via+'"/>');
    }
  };
  /* 2. Le cuivre : la couche du dessous d'abord, puis ses éventuelles
        découpes (décroché de masse), puis la couche du dessus et ses
        découpes (encoches de patch), et enfin les vias. Découper le bas
        avant de peindre le haut permet à une piste supérieure traversant un
        décroché de masse de rester visible au-dessus du substrat. */
  t.formes.forEach(f=>{ if(f.cu==="bas"&&!f.trou)forme(f,APM_COULEURS.bas,0.45); });
  t.formes.forEach(f=>{ if(f.cu==="bas"&&f.trou)forme(f,APM_COULEURS.substrat,1); });
  t.formes.forEach(f=>{ if(f.cu!=="bas"&&!f.trou&&f.type!=="via")
                          forme(f,APM_COULEURS.haut,0.9); });
  t.formes.forEach(f=>{ if(f.cu!=="bas"&&f.trou)forme(f,APM_COULEURS.substrat,1); });
  t.formes.forEach(f=>{ if(f.type==="via")forme(f,APM_COULEURS.via,1); });

  /* 3. Le port, que le motif pose lui-même. Le montrer est le seul moyen de
        vérifier d'un coup d'œil qu'il tombe bien là où l'antenne s'alimente
        — au bout de la ligne, au pied du court-circuit, au centre du dipôle.
        Il ne porte PAS son nom : à cette taille, une étiquette tombe
        forcément sur le cuivre qu'elle explique. C'est la légende, sous le
        dessin, qui dit ce qu'est le rectangle rouge. */
  if(opts.port!==false&&t.port){
    const px=t.port.x-t.port.w/2, py=t.port.y-t.port.l/2;
    out.push('<rect x="'+X(px)+'" y="'+Y(py+t.port.l)+'" width="'+
      Math.max(E(t.port.w),2)+'" height="'+Math.max(E(t.port.l),2)+
      '" fill="'+APM_COULEURS.port+'" fill-opacity="0.35" stroke="'+
      APM_COULEURS.port+'" stroke-width="1"/>');
  }

  /* 4. Les cotes, et les repères des longueurs trop petites pour en porter
        une. Chaque annotation porte `data-cote` : c'est ce qui permet au
        panneau d'allumer celle du champ qu'on règle, et de renvoyer au champ
        celle sur laquelle on clique. */
  if(opts.cotes)(t.cotes||[]).forEach(function(c){
    const cls="apm-cote"+(c.sec?" sec":"");

    /* Le repère : un point, un trait, un nom. Pas de tirets d'extrémité —
       ils diraient « cette longueur-là va d'ici à là », ce qu'un repère ne
       dit justement pas : il DÉSIGNE, il ne mesure pas. */
    if(c.rep){
      const droite=c.x2>=c.x1;
      out.push('<g class="'+cls+'" data-cote="'+c.id+'">'+
        '<line x1="'+X(c.x1)+'" y1="'+Y(c.y1)+'" x2="'+X(c.x2)+'" y2="'+
          Y(c.y2)+'" class="apm-attache"/>'+
        '<circle cx="'+X(c.x1)+'" cy="'+Y(c.y1)+'" r="1.7" '+
          'class="apm-pointe"/>'+
        '<text x="'+(X(c.x2)+(droite?3:-3))+'" y="'+(Y(c.y2)+3)+
          '" text-anchor="'+(droite?"start":"end")+'">'+c.t+'</text>'+
        '</g>');
      return;
    }

    const horiz=Math.abs(c.y1-c.y2)<1e-9;
    const a=horiz?{x:c.x1,y:c.y1+c.dec}:{x:c.x1+c.dec,y:c.y1};
    const z=horiz?{x:c.x2,y:c.y2+c.dec}:{x:c.x2+c.dec,y:c.y2};
    if(Math.abs((horiz?z.x-a.x:z.y-a.y))*k<3)return;   // trop courte pour se lire
    const g2=['<g class="'+cls+'" data-cote="'+c.id+'">'];
    /* Les lignes d'attache, du point coté jusqu'à la ligne de cote. */
    g2.push('<line x1="'+X(c.x1)+'" y1="'+Y(c.y1)+'" x2="'+X(a.x)+'" y2="'+
            Y(a.y)+'" class="apm-attache"/>');
    g2.push('<line x1="'+X(c.x2)+'" y1="'+Y(c.y2)+'" x2="'+X(z.x)+'" y2="'+
            Y(z.y)+'" class="apm-attache"/>');
    g2.push('<line x1="'+X(a.x)+'" y1="'+Y(a.y)+'" x2="'+X(z.x)+'" y2="'+
            Y(z.y)+'" class="apm-trait"/>');
    /* Les deux tirets d'extrémité, perpendiculaires à la cote. */
    const t1=horiz?[0,3]:[3,0];
    [a,z].forEach(function(q){
      g2.push('<line x1="'+(X(q.x)-t1[0])+'" y1="'+(Y(q.y)-t1[1])+
              '" x2="'+(X(q.x)+t1[0])+'" y2="'+(Y(q.y)+t1[1])+
              '" class="apm-trait"/>');
    });
    const mx=(X(a.x)+X(z.x))/2, my=(Y(a.y)+Y(z.y))/2;
    if(horiz)
      g2.push('<text x="'+mx+'" y="'+(my+(c.dec>=0?-4:11))+
              '" text-anchor="middle">'+c.t+'</text>');
    else
      g2.push('<text x="'+(mx+(c.dec>=0?5:-5))+'" y="'+(my+3)+
              '" text-anchor="'+(c.dec>=0?"start":"end")+'">'+c.t+'</text>');
    g2.push('</g>');
    out.push(g2.join(""));
  });

  out.push('</svg>');
  return out.join("");
}

/* La vignette de la galerie : le motif aux cotes du calcul, sans annotation.
   Elle est refaite à chaque rendu du panneau — donc elle suit la fréquence et
   le substrat, et un patch à 868 MHz n'a pas la silhouette d'un patch à
   5,8 GHz. */
function apmVignette(g){
  return apmSVG(g,null,{w:150, h:96, cotes:false, port:false});
}

/* La planche du motif choisi : cotée, port compris. */
function apmPlanche(g,p){
  return apmSVG(g,p,{w:340, h:225, cotes:true, port:true});
}
