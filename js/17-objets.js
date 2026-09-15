"use strict";
/* =============================================================================
   Antenne openEMS — 17-objets.js
   Étape « Autour » : ce qui n'est pas sur la carte.

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
  const k=(V.unite==="in")?(1/25.4):1;
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
  const k=(V.unite==="in")?(1/25.4):1;
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

/* Un triplet de champs XYZ. `ou` désigne où écrire dans l'objet : "a", "b",
   "c", ou "pts.2" pour le troisième sommet d'un fil. */
function antXYZ(i,etiquette,ou,v){
  return '<div class="xyz"><label>'+aEsc(etiquette)+'</label>'+
    [0,1,2].map(k=>
      '<input type="number" step="0.1" data-obj="'+i+'" data-ou="'+ou+
      '" data-k="'+k+'" value="'+(v[k]==null?0:v[k])+'">').join("")+
    '<span class="u">'+antUnite()+'</span></div>';
}

function antChampNb(i,etiquette,ou,v,pas,mini){
  return '<div class="xyz"><label>'+etiquette+'</label>'+
    '<input type="number" step="'+(pas||0.05)+'"'+
    (mini!=null?' min="'+mini+'"':"")+
    ' data-obj="'+i+'" data-ou="'+ou+'" value="'+v+'">'+
    '<span class="u">'+antUnite()+'</span></div>';
}

function antObjetFiche(o,i){
  let geo;
  if(o.type==="fil"){
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
      '<input type="number" step="0.1" min="1" data-obj="'+i+'" data-ou="er" value="'+o.er+'">'+
      '<input type="number" step="0.001" min="0" data-obj="'+i+'" data-ou="df" value="'+o.df+'">'+
      '<span class="u"></span></div>'
    : "";

  return '<div class="objet">'+
    '<div class="objet-tete">'+
      '<b>'+aEsc(ANT_FORMES[o.type].titre)+'</b>'+
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
    '<div class="champ"><label>Ajouter</label>'+
    '<div class="raccourcis">'+boutons+'</div>'+
    '<p class="note">Le métal est un <b>conducteur parfait</b>. Un boîtier en '+
    'volume à conductivité finie demanderait de mailler l\'épaisseur de peau — '+
    'quelques microns, hors de portée — pour une différence qui se compte en '+
    'centièmes de décibel sur un blindage.</p></div>'+
    liste+recap;
};

ANT_LIER.objets=function(box){
  box.querySelectorAll("[data-forme]").forEach(function(b){
    b.onclick=function(){
      ANT.primitives.push(antObjetNeuf(b.dataset.forme));
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
    const ecrire=function(){
      const o=ANT.primitives[+el.dataset.obj];
      if(!o)return;
      const ou=el.dataset.ou;
      if(el.type==="number"){
        const v=parseFloat(String(el.value).replace(",","."));
        if(!isFinite(v))return;
        if(ou.indexOf("pts.")===0)o.pts[+ou.slice(4)][+el.dataset.k]=v;
        else if(el.dataset.k!=null)o[ou][+el.dataset.k]=v;
        else o[ou]=v;
      }else{
        o[ou]=el.value;
      }
      /* Un changement de MATIÈRE redessine la fiche — les champs εr
         apparaissent ou disparaissent. Une COTE, non : redessiner à chaque
         frappe ferait perdre le curseur au champ qu'on est en train de
         remplir. */
      antMaj(el.tagName==="SELECT");
    };
    if(el.tagName==="SELECT")el.onchange=ecrire; else el.oninput=ecrire;
  });
};
