"use strict";
/* =============================================================================
   Antenne openEMS — 17-objets.js
   Étape 3, « Autour » : ce qui n'est pas sur la carte.

   UNE ANTENNE NE RAYONNE JAMAIS TOUTE SEULE. Elle est dans un boîtier, au
   dessus d'une batterie, à côté d'un écran, au bout d'un câble. Le fichier
   IPC-2581 ne dit rien de tout cela — il décrit une carte, pas un produit —
   et une simulation qui l'ignore rend un diagramme propre et faux : un
   boîtier métallique à dix millimètres d'un patch déplace sa résonance de
   plusieurs pour cent et lui coupe une bonne part de son rayonnement
   arrière. Rien, dans le S₁₁, ne dira que l'objet manquait.

   CE N'EST PAS UN ÉDITEUR 3D, et ça ne cherche pas à l'être. Quatre formes,
   des nombres, et la vue 3D pour vérifier qu'on a posé l'objet là où on le
   croyait. Dessiner une pièce mécanique demande un outil de mécanique ;
   l'importer demanderait un lecteur de STEP.

   Ce module s'enregistre dans `ANT_CORPS` / `ANT_LIER` (13-assistant.js) :
   il est chargé après lui, et l'assistant n'a rien à savoir de son contenu.
   ============================================================================= */

const ANT_FORMES={
  fil:      {titre:"Fil",      aide:"une polyligne épaissie : monopole, brin, câble"},
  cylindre: {titre:"Cylindre", aide:"vis, entretoise, âme de coaxial"},
  boite:    {titre:"Boîte",    aide:"boîtier, batterie, écran ; plate, c'est un réflecteur"},
  sphere:   {titre:"Sphère",   aide:"perle de ferrite, goutte de colle, tête de vis"}
};

/* Le haut de l'empilage, dans l'unité du fichier : c'est le plan de référence
   à partir duquel on pose tout ce qui est au-dessus de la carte. */
function antHautCarte(){
  const k=1/antKmm();
  let h=0;
  for(const e of (LT.pile||[]))if(!e.cuivre)h+=e.ep;
  return +(h*k).toFixed(4);
}

/* Un objet neuf, posé au centre de la carte et un peu au-dessus. Il doit être
   VISIBLE tout de suite : un objet créé à l'origine se cherche dans la vue 3D
   au lieu de se régler. */
function antObjetNeuf(type){
  const b=V.bbox||{x1:0,y1:0,x2:10,y2:10};
  const cx=+((b.x1+b.x2)/2).toFixed(3), cy=+((b.y1+b.y2)/2).toFixed(3);
  const k=1/antKmm();
  const h=+(10*k).toFixed(3), r=+(0.5*k).toFixed(3), z=antHautCarte();
  const base={nom:ANT_FORMES[type].titre.toLowerCase()+" "+(ANT.primitives.length+1),
              type:type, materiau:"metal", er:4.3, df:0.02, priorite:20};
  if(type==="fil")
    return Object.assign(base,{r:r, pts:[[cx,cy,z],[cx,cy,+(z+h).toFixed(3)]]});
  if(type==="cylindre")
    return Object.assign(base,{r:+(r*2).toFixed(3), a:[cx,cy,z],
                               b:[cx,cy,+(z+h).toFixed(3)]});
  if(type==="boite")
    return Object.assign(base,{a:[b.x1,b.y1,+(z+h).toFixed(3)],
                               b:[b.x2,b.y2,+(z+h+r*2).toFixed(3)]});
  return Object.assign(base,{c:[cx,cy,+(z+h).toFixed(3)], r:+(r*4).toFixed(3)});
}

/* ==========================================================================
   Les fils d'antenne : brin coudé, brin droit, hélice
   --------------------------------------------------------------------------
   UNE ANTENNE FILAIRE EST UN « FIL » COMME LES AUTRES pour le solveur : une
   polyligne de métal. Ce qui change est ici — quelques cotes au lieu d'une
   liste de sommets — et dans le maillage : le fil porte un `pas`, et le
   serveur maille son emprise à ce pas (maillage.rs). openEMS pose un fil sur
   les arêtes de sa grille ; sans ce pas, les spires d'une hélice tombent
   dans la même cellule.

   Le pied est soudé sur une pastille de la carte : c'est entre cette pastille
   et la masse qu'on pose le port, comme pour une antenne imprimée.

   g = {type, pied:[x,y,z], h, L | D, p, N, incl, azim, d}, tout dans la même
   unité de longueur. `incl` : 0° le brin est parallèle à la carte, 90° il
   est vertical. `azim` : sa direction dans le plan, 0° vers +x, 90° vers +y.
   ========================================================================== */
const ANT_FILS_ANTENNE={
  brin:   {titre:"Brin coudé", aide:"un fil soudé par un pied plié, puis un brin droit ; à 90° d'inclinaison, c'est un brin droit vertical"},
  helice: {titre:"Hélice",     aide:"un fil enroulé (antenne ressort) au bout d'un pied droit"}
};
/* `antFilTrace` et `antFilAppliquer` — le tracé lui-même — sont dans
   22-antennes.js : les motifs du mode conception s'en servent aussi. */

/* Le dessus du cuivre de la face supérieure, là où se soude le pied : lu
   dans le modèle quand il y en a un, sinon le haut de l'empilage. */
function antHautCuivre(){
  const c=(ANT.modele&&ANT.modele.conducteurs)||[];
  if(!c.length)return antHautCarte();
  return +(Math.max.apply(null,c.map(q=>q.z1))/antKmm()).toFixed(4);
}

/* Un fil d'antenne neuf : le pied sur le port s'il est posé — c'est là qu'est
   la pastille —, le quart d'onde de la fréquence visée pour longueur. */
function antFilAntenneNeuf(type){
  const k=1/antKmm(), b=V.bbox||{x1:0,y1:0,x2:10,y2:10};
  const p=ANT.port&&ANT.port.pose?ANT.port:{x:(b.x1+b.x2)/2, y:(b.y1+b.y2)/2};
  const f=(ANT.bande&&ANT.bande.fcible)||2.45e9;
  const q=CON_BRIN_K*299792458e3/(4*f)*k;         // le quart d'onde, au facteur mesuré
  const g={type:type, pied:[+(+p.x).toFixed(4), +(+p.y).toFixed(4), antHautCuivre()],
           h:+(3*k).toFixed(4), incl:type==="helice"?90:0, azim:0, d:+(0.8*k).toFixed(4)};
  if(type==="helice"){
    g.D=+(5*k).toFixed(4); g.p=+(2*k).toFixed(4);
    g.N=+conHeliceSpires(299792458e3/(4*f),g.h/k,g.D/k,f,0).toFixed(1);   // la loi mesurée, en mm
  }else g.L=+Math.max(q-g.h,k).toFixed(3);
  return antFilAppliquer({nom:ANT_FILS_ANTENNE[type].titre.toLowerCase()+" "+(ANT.primitives.length+1),
                          type:"fil", materiau:"metal", er:4.3, df:0.02, priorite:20, gen:g});
}

/* Un triplet de champs XYZ. `ou` désigne où écrire dans l'objet : "a", "b",
   "c", ou "pts.2" pour le troisième sommet d'un fil. */
function antXYZ(i,etiquette,ou,v){
  return '<div class="xyz"><label>'+aEsc(etiquette)+'</label>'+
    [0,1,2].map(k=>
      '<input type="text" inputmode="decimal" spellcheck="false" data-obj="'+i+'" data-ou="'+ou+
      '" data-k="'+k+'" value="'+mdlNb(v[k]==null?0:v[k])+'">').join("")+
    '<span class="u">'+antUnite()+'</span></div>';
}

function antChampNb(i,etiquette,ou,v,pas,mini,unite){
  return '<div class="xyz"><label>'+etiquette+'</label>'+
    '<input type="text" inputmode="decimal" spellcheck="false"'+
    (mini!=null?' min="'+mini+'"':"")+
    ' data-obj="'+i+'" data-ou="'+ou+'" value="'+mdlNb(v)+'">'+
    '<span class="u">'+(unite!=null?unite:antUnite())+'</span></div>';
}

/* Ce que les cotes donnent : le développé, le pas du maillage, et le fil qui
   traverserait la carte. Récrit à chaque frappe, sans redessiner la fiche. */
function antFilNote(o){
  const g=o.gen, t=antFilTrace(g);
  const dev=g.type==="helice" ? g.h+g.N*Math.hypot(Math.PI*g.D,g.p) : g.h+g.L;
  return 'Inclinaison : 0° parallèle à la carte, 90° vertical. Direction : 0° vers +x, 90° vers +y. '+
    'Fil développé : <b>'+mdlNb(+dev.toFixed(2))+' '+antUnite()+'</b> ; maillé au pas de '+mdlNb(t.pas)+' '+antUnite()+'. '+
    'Le port se pose sur la pastille du pied, entre elle et la masse.'+
    (t.zmin<g.pied[2]-1e-9 ? ' <b>⚠ Le fil descend sous son pied</b> ('+mdlNb(+(g.pied[2]-t.zmin).toFixed(3))+' '+antUnite()+') : il traverse la carte. Augmentez la hauteur du pied.' : '');
}

/* La fiche d'un fil d'antenne : ses cotes, pas ses sommets. */
function antFilFiche(o,i){
  const g=o.gen, helice=g.type==="helice";
  return antXYZ(i,"pied (soudure)","gen.pied",g.pied)+
    '<div class="pnl-bar"><button class="tb mini" data-fil-port="'+i+'" title="Amener le pied sur le port actif : la pastille où le fil est soudé">⌖ pied au port</button></div>'+
    antChampNb(i,"hauteur du pied","gen.h",g.h)+
    (helice
      ? antChampNb(i,"diamètre des spires","gen.D",g.D)+
        antChampNb(i,"pas entre spires","gen.p",g.p)+
        antChampNb(i,"nombre de spires","gen.N",g.N,null,null,"")
      : antChampNb(i,"longueur du brin","gen.L",g.L))+
    antChampNb(i,"inclinaison","gen.incl",g.incl,null,null,"°")+
    antChampNb(i,"direction","gen.azim",g.azim,null,null,"°")+
    antChampNb(i,"diamètre du fil","gen.d",g.d)+
    '<p class="note" data-fil-note="'+i+'">'+antFilNote(o)+'</p>';
}

function antObjetFiche(o,i){
  let geo;
  if(o.type==="fil"&&o.gen){
    geo=antFilFiche(o,i);
  }else if(o.type==="fil"){
    geo=o.pts.map((p,k)=>antXYZ(i,"sommet "+(k+1),"pts."+k,p)).join("")+
      '<div class="pnl-bar">'+
      '<button class="tb mini" data-pt-plus="'+i+'">+ un sommet</button>'+
      (o.pts.length>2
        ? '<button class="tb mini" data-pt-moins="'+i+'">− le dernier</button>' : "")+
      '</div>'+
      antChampNb(i,"rayon","r",o.r,0.05,0.01);
  }else if(o.type==="cylindre"){
    geo=antXYZ(i,"d'un bout","a",o.a)+antXYZ(i,"à l'autre","b",o.b)+
        antChampNb(i,"rayon","r",o.r,0.05,0.01);
  }else if(o.type==="boite"){
    geo=antXYZ(i,"coin","a",o.a)+antXYZ(i,"coin opposé","b",o.b);
  }else{
    geo=antXYZ(i,"centre","c",o.c)+antChampNb(i,"rayon","r",o.r,0.05,0.01);
  }

  const matiere=(o.materiau==="dielectrique")
    ? '<div class="xyz"><label>&epsilon;<sub>r</sub> · tan&delta;</label>'+
      '<input type="text" inputmode="decimal" spellcheck="false" data-obj="'+i+'" data-ou="er" value="'+mdlNb(o.er)+'">'+
      '<input type="text" inputmode="decimal" spellcheck="false" data-obj="'+i+'" data-ou="df" value="'+mdlNb(o.df)+'">'+
      '<span class="u"></span></div>'
    : "";

  return '<div class="objet">'+
    '<div class="objet-tete">'+
      '<b>'+aEsc(o.gen?ANT_FILS_ANTENNE[o.gen.type].titre:ANT_FORMES[o.type].titre)+'</b>'+
      '<input type="text" class="nom" data-obj="'+i+'" data-ou="nom" value="'+aEsc(o.nom)+'">'+
      '<select data-obj="'+i+'" data-ou="materiau">'+
        '<option value="metal"'+(o.materiau==="metal"?" selected":"")+'>métal</option>'+
        '<option value="dielectrique"'+(o.materiau==="dielectrique"?" selected":"")+'>diélectrique</option>'+
      '</select>'+
      '<button class="tb mini" data-suppr="'+i+'" title="Retirer cet objet">✕</button>'+
    '</div>'+matiere+geo+'</div>';
}

ANT_CORPS.objets=function(){
  const m=ANT.modele;
  const boutons=Object.keys(ANT_FORMES).map(t=>
    '<button class="tb mini" data-forme="'+t+'" title="'+aEsc(ANT_FORMES[t].aide)+
    '">+ '+aEsc(ANT_FORMES[t].titre)+'</button>').join("");

  const fils=Object.keys(ANT_FILS_ANTENNE).map(t=>
    '<button class="tb mini" data-fil-antenne="'+t+'" title="'+aEsc(ANT_FILS_ANTENNE[t].aide)+
    '">+ '+aEsc(ANT_FILS_ANTENNE[t].titre)+'</button>').join("");

  const liste=ANT.primitives.length
    ? ANT.primitives.map(antObjetFiche).join("")
    : '<div class="rien">Aucun objet. La simulation ne verra que la carte — '+
      'ce qui est juste pour une antenne nue, et faux dès qu\'elle est montée '+
      'dans quelque chose.</div>';

  const recap=(m&&m.primitives.length)
    ? '<div class="recap">'+
      '<span>'+aEnt(m.primitives.length)+' objet(s)</span>'+
      '<span>emprise '+aNb(m.emprise[3]-m.emprise[0],1)+' × '+
        aNb(m.emprise[4]-m.emprise[1],1)+' × '+
        aNb(m.emprise[5]-m.emprise[2],1)+' mm</span>'+
      '<span>'+aEnt(m.estimation.cellules)+' cellules</span></div>'
    : "";

  return '<p class="intro">Le fichier IPC-2581 décrit une carte, pas un '+
    'produit. Un boîtier métallique à dix millimètres d\'un patch déplace sa '+
    'résonance de plusieurs pour cent et lui coupe une bonne part de son '+
    'rayonnement arrière — et rien dans le S<sub>11</sub> ne dira que l\'objet '+
    'manquait.</p>'+
    /* LES PIÈCES D'ABORD : un boîtier réel, des piles, ce que la mécanique a
       dessiné (33-pieces.js). Les formes simples viennent ensuite — une vis,
       un fil, un réflecteur saisis en coordonnées. */
    ((typeof antPiecesHtml==="function")
      ? '<div class="champ pieces" id="antPieces">'+antPiecesHtml()+'</div>' : "")+
    '<div class="champ"><label>Antenne filaire <small>soudée sur une pastille de la carte</small></label>'+
    '<div class="raccourcis">'+fils+'</div>'+
    '<p class="note">Posez d\'abord le port sur la pastille où le fil est soudé : le pied s\'y place. '+
    'Une antenne 3D du commerce (tôle pliée, PIFA) s\'importe en STEP ci-dessus, matière « métal ».</p></div>'+
    '<div class="champ"><label>Formes simples <small>fil, cylindre, boîte, sphère — en coordonnées</small></label>'+
    '<div class="raccourcis">'+boutons+'</div>'+
    '<p class="note">Le métal est un <b>conducteur parfait</b>. Un boîtier en '+
    'volume à conductivité finie demanderait de mailler l\'épaisseur de peau — '+
    'quelques microns, hors de portée — pour une différence qui se compte en '+
    'centièmes de décibel sur un blindage.</p></div>'+
    liste+recap;
};

ANT_LIER.objets=function(box){
  if(typeof antPiecesLier==="function")antPiecesLier(box.querySelector("#antPieces"));
  box.querySelectorAll("[data-forme]").forEach(function(b){
    b.onclick=function(){
      ANT.primitives.push(antObjetNeuf(b.dataset.forme));
      antMaj(true);
    };
  });
  box.querySelectorAll("[data-fil-antenne]").forEach(function(b){
    b.onclick=function(){
      ANT.primitives.push(antFilAntenneNeuf(b.dataset.filAntenne));
      antMaj(true);
    };
  });
  box.querySelectorAll("[data-fil-port]").forEach(function(b){
    b.onclick=function(){
      const o=ANT.primitives[+b.dataset.filPort];
      if(!o||!o.gen||!ANT.port||!ANT.port.pose)return;
      o.gen.pied[0]=ANT.port.x; o.gen.pied[1]=ANT.port.y; o.gen.pied[2]=antHautCuivre();
      antFilAppliquer(o);
      antMaj(true);
    };
  });
  box.querySelectorAll("[data-suppr]").forEach(function(b){
    b.onclick=function(){ ANT.primitives.splice(+b.dataset.suppr,1); antMaj(true); };
  });
  box.querySelectorAll("[data-pt-plus]").forEach(function(b){
    b.onclick=function(){
      const o=ANT.primitives[+b.dataset.ptPlus];
      const d=o.pts[o.pts.length-1];
      o.pts.push([d[0],d[1],+(d[2]+10).toFixed(3)]);
      antMaj(true);
    };
  });
  box.querySelectorAll("[data-pt-moins]").forEach(function(b){
    b.onclick=function(){
      const o=ANT.primitives[+b.dataset.ptMoins];
      if(o.pts.length>2)o.pts.pop();
      antMaj(true);
    };
  });

  box.querySelectorAll("[data-obj]").forEach(function(el){
    const ecrire=function(commit){
      const o=ANT.primitives[+el.dataset.obj];
      if(!o)return;
      const ou=el.dataset.ou;
      if(el.type==="number"||el.inputMode==="decimal"){
        const s=String(el.value).trim().replace(",",".");
        if(!commit&&(s===""||s==="."||s==="-"||s.endsWith(".")))return;
        const v=parseFloat(s);
        if(!isFinite(v))return;
        if(commit)el.value=mdlNb(v);
        /* « gen.h » : une cote de fil d'antenne, dont les sommets découlent. */
        const gen=ou.indexOf("gen.")===0, cible=gen?o.gen:o, cle=gen?ou.slice(4):ou;
        if(ou.indexOf("pts.")===0)o.pts[+ou.slice(4)][+el.dataset.k]=v;
        else if(el.dataset.k!=null)cible[cle][+el.dataset.k]=v;
        else cible[cle]=v;
        if(gen){
          antFilAppliquer(o);
          const n=box.querySelector('[data-fil-note="'+el.dataset.obj+'"]');
          if(n)n.innerHTML=antFilNote(o);
        }
      }else{
        o[ou]=el.value;
      }
      /* Un changement de MATIÈRE redessine la fiche — les champs εr
         apparaissent ou disparaissent. Une COTE, non : redessiner à chaque
         frappe ferait perdre le curseur au champ qu'on est en train de
         remplir. */
      antMaj(el.tagName==="SELECT");
    };
    if(el.tagName==="SELECT"){
      el.onchange=function(){ ecrire(true); };
    }else{
      el.oninput=function(){ ecrire(false); };
      el.onchange=function(){ ecrire(true); };
    }
  });
};
