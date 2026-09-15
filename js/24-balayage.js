"use strict";
/* =============================================================================
   Antenne openEMS — 24-balayage.js
   Une cote, une plage, une famille de courbes.

   POURQUOI CE MODULE EXISTE. Un gabarit d'antenne tombe à 2 ou 5 % de la
   résonance visée, et la première simulation ne dit pas « c'est bon » : elle
   dit « c'est 3 % trop bas ». Le geste qui suit est toujours le même —
   rallonger le patch de quatre dixièmes de millimètre et relancer — et le
   refaire six fois à la main, c'est six fois l'occasion de changer deux choses
   au lieu d'une et de ne plus savoir laquelle a compté.

   CE N'EST PAS UN OPTIMISEUR, et c'est délibéré : ni gradient, ni critère, ni
   convergence. Une liste de valeurs, une courbe par valeur, et la lecture
   reste humaine. Un optimiseur qui rendrait « L = 38,46 mm » sans la famille
   de courbes cacherait la seule chose qui apprenne quelque chose — la
   SENSIBILITÉ, c'est-à-dire de combien la résonance bouge pour un dixième de
   millimètre. C'est elle qui dit si la cote doit être tenue en fabrication, et
   aucun point optimal ne la remplace.

   COMMENT UN POINT EST DÉCRIT. Pas par une formule : par ce qu'il CHANGE dans
   le document. Deux chemins, et ils ne se valent pas :

     - une COTE DU DOCUMENT (position du port, épaisseur ou permittivité d'un
       diélectrique) se désigne directement — « ports.0.x » —, et le point ne
       pèse que trois nombres ;

     - une COTE DESSINÉE (la longueur d'un patch) n'existe nulle part dans le
       document : le document ne connaît que des polygones. On refait donc le
       document pour chaque valeur, et on le COMPARE au document de départ : ce
       qui diffère est la modification. C'est plus lourd, et c'est la seule
       façon honnête — la page est le seul endroit qui sache ce qu'est « la
       longueur du patch ».
   ============================================================================= */

/* Combien de points au plus. La même borne qu'au serveur : la dépasser ici
   rendrait un refus qui arriverait après coup. */
const BAL_MAX=40;

/* ==========================================================================
   Ce qu'on peut balayer
   --------------------------------------------------------------------------
   La liste dépend de ce qui est à l'écran, et c'est normal : sur une carte
   importée, la géométrie est routée — on ne rallonge pas un patch qui vient
   d'un fichier de fabrication, on déplace son point d'alimentation ou on
   corrige la permittivité qu'on avait supposée. En conception, la géométrie
   est à nous, et c'est elle qu'on veut faire varier.
   ========================================================================== */
function balSources(){
  const out=[];
  const u=antUnite();

  ANT.ports.forEach(function(p,i){
    const n=ANT.ports.length>1?("port "+(i+1)+" — "):"port — ";
    out.push({id:"p"+i+".x", nom:n+"X",        unite:u, valeur:p.x,
              chemin:"ports."+i+".x"});
    out.push({id:"p"+i+".y", nom:n+"Y",        unite:u, valeur:p.y,
              chemin:"ports."+i+".y"});
    if(p.type==="coaxial"){
      out.push({id:"p"+i+".rb", nom:n+"rayon de gaine", unite:u, valeur:p.rb,
                chemin:"ports."+i+".rb"});
    }else{
      out.push({id:"p"+i+".w", nom:n+"largeur", unite:u, valeur:p.w,
                chemin:"ports."+i+".w"});
    }
  });

  /* L'empilage : les deux nombres qu'aucun fichier ne porte, et dont on a
     toujours un doute. Balayer εr, c'est répondre à « et si le stratifié
     n'était pas celui du catalogue ? » — une question qui vaut souvent plus
     qu'un dixième de millimètre de cuivre. */
  antEmpilage().forEach(function(e,k){
    if(e.cuivre)return;
    out.push({id:"e"+k+".ep", nom:"« "+e.nom+" » — épaisseur", unite:u,
              valeur:e.ep, chemin:"empilage."+k+".ep"});
    out.push({id:"e"+k+".er", nom:"« "+e.nom+" » — permittivité", unite:"",
              valeur:e.er, chemin:"empilage."+k+".er"});
  });

  /* Le dessin : les cotes de la forme choisie. Elles n'ont pas de chemin dans
     le document — c'est le document entier qu'on refera. */
  if(typeof CON!=="undefined"&&CON.actif&&CON.sel>=0&&CON.elements[CON.sel]){
    const el=CON.elements[CON.sel];
    const nom=(typeof conNomElement==="function")?conNomElement(el):"forme";
    const cote=function(champ,titre,valeur){
      out.push({id:"f."+champ, nom:nom+" — "+titre, unite:"mm",
                valeur:valeur, forme:CON.sel, champ:champ});
    };
    if(el.type==="rect"){
      cote("largeur","largeur",Math.abs(el.x2-el.x1));
      cote("hauteur","hauteur",Math.abs(el.y2-el.y1));
      cote("x","position X",Math.min(el.x1,el.x2));
      cote("y","position Y",Math.min(el.y1,el.y2));
    }else if(el.type==="disque"){
      cote("r","rayon",el.r);
      cote("cx","centre X",el.cx);
      cote("cy","centre Y",el.cy);
    }else if(el.type==="piste"){
      cote("w","largeur de piste",el.w||CON.largeur);
    }else if(el.type==="via"){
      cote("d","diamètre",el.d);
      cote("x","position X",el.x);
      cote("y","position Y",el.y);
    }
  }

  /* LES COTES DU MOTIF, qui ne sont pas celles d'une forme. « La longueur du
     patch » n'est pas la largeur d'un rectangle : elle déplace le rectangle du
     patch, la carte qui le porte, le port au bout de la ligne — et sur un
     méandre, elle redessine quatorze segments. Les proposer par la forme
     reviendrait à demander de les recomposer de tête, et ce sont pourtant
     elles qu'on veut faire varier : un gabarit tombe à quelques pour cent, et
     c'est SA cote qu'on corrige.

     Chaque point repose donc le motif, exactement comme le bouton du panneau
     — d'où le garde-fou de `conGabaritConforme` : si le dessin n'est plus la
     copie exacte du motif, ces cotes ne sont pas proposées. Reposer
     effacerait ce qu'on y aurait ajouté à la main, sur tous les points à la
     fois, et rien dans la famille de courbes ne le dirait. */
  if(typeof CON!=="undefined"&&CON.actif&&
     typeof conGabaritConforme==="function"&&conGabaritConforme()){
    const g=conGabarit(CON.gabarit);
    g.champs.forEach(function(ch){
      const v=CON.gabaritP[ch.id];
      if(!isFinite(v))return;
      out.push({id:"m."+ch.id, nom:g.nom+" — "+ch.nom,
                unite:ch.entier?"":"mm", valeur:v, motif:ch.id});
    });
  }
  return out;
}

function balSource(){
  const l=balSources();
  return l.find(s=>s.id===ANT.balayage.source)||l[0]||null;
}

/* La seconde cote, quand le croisement est demandé. Elle ne peut pas être la
   même que la première : croiser une cote avec elle-même ne décrit rien, et
   les deux modifications se marcheraient dessus dans le même document. */
function balSource2(){
  if(!ANT.balayage.croise)return null;
  const l=balSources();
  const s1=balSource();
  const s=l.find(s=>s.id===ANT.balayage.source2);
  if(s&&(!s1||s.id!==s1.id))return s;
  return l.find(q=>!s1||q.id!==s1.id)||null;
}

/* ==========================================================================
   Les valeurs
   ========================================================================== */
function balValeurs(){
  return balPlage(ANT.balayage.min,ANT.balayage.max,ANT.balayage.pas);
}

/* Les valeurs du second axe. Une plage vide quand le croisement est éteint :
   le reste du module multiplie alors par un, et il n'y a nulle part de « si
   croisé » dans le calcul des points. */
function balValeurs2(){
  const b=ANT.balayage;
  if(!b.croise||!balSource2())return [];
  return balPlage(b.min2,b.max2,b.pas2);
}

function balPlage(min,max,pas){
  pas=Math.abs(pas);
  if(!(pas>0)||!(max>min))return [];
  const out=[];
  for(let v=min; v<=max+pas*1e-6 && out.length<BAL_MAX+1; v+=pas)
    out.push(+v.toFixed(6));
  return out;
}

/* COMBIEN DE SIMULATIONS EN TOUT. C'est un PRODUIT dès qu'il y a deux axes,
   et c'est le seul nombre qui compte : le garde-fou porte sur lui, l'annonce
   de durée aussi. Compter par axe laisserait passer 6×6 = 36 simulations sous
   une limite de quarante lue deux fois. */
function balCombien(){
  const n=balValeurs().length;
  const m=balValeurs2().length;
  return m?n*m:n;
}

function balEtiquette(v){
  return String(+v.toFixed(4)).replace(".",",");
}

/* ==========================================================================
   Du dessin modifié aux modifications du document
   --------------------------------------------------------------------------
   UNE COMPARAISON PROFONDE, ET NON UNE LISTE DE CAS. Changer la hauteur d'un
   rectangle déplace quatre coordonnées d'un polygone ; changer le diamètre
   d'un via en déplace d'autres. Écrire à la main quel champ bouge pour quelle
   cote serait une table à tenir à jour, et donc une table qui aurait tort un
   jour. On compare les deux documents, et ce qui diffère EST la modification.
   ========================================================================== */
function balDiff(base,autre,prefixe,out){
  out=out||[];
  prefixe=prefixe||"";
  const tableau=Array.isArray(base)&&Array.isArray(autre);
  const objet=!tableau&&base&&autre&&typeof base==="object"&&
              typeof autre==="object";
  if(tableau&&base.length===autre.length){
    for(let i=0;i<base.length;i++)
      balDiff(base[i],autre[i],prefixe+"."+i,out);
    return out;
  }
  if(objet){
    for(const k of Object.keys(autre))
      balDiff(base[k],autre[k],prefixe?prefixe+"."+k:k,out);
    return out;
  }
  if(JSON.stringify(base)!==JSON.stringify(autre))
    out.push({chemin:prefixe.replace(/^\./,""), valeur:autre});
  return out;
}

/* Le document tel qu'il serait si CES cotes valaient ces valeurs. Rien n'est
   affiché : on recharge le modèle en mémoire, on prend le document, et on
   remet tout en place à la fin.

   IL EN PREND PLUSIEURS, ET C'EST CE QUI PERMET DE CROISER. Deux cotes
   dessinées peuvent tomber sur la MÊME forme — la largeur et la hauteur d'un
   même rectangle —, et les poser l'une après l'autre en sauvant la forme deux
   fois rendrait la première à la restauration. On sauve donc chaque forme UNE
   fois, par son rang, et on restaure à la fin. */
function balDocumentPour(poses){
  if(!Array.isArray(poses))poses=[{src:arguments[0], v:arguments[1]}];
  const motifs=poses.filter(q=>q.src.motif);
  const formes=poses.filter(q=>!q.src.motif);

  /* UNE COTE DE MOTIF REPOSE LE MOTIF, et repose donc AUSSI le port et la
     carte : allonger un patch déplace le bord où le port est posé. C'est
     `conGabaritTrace` qui dessine — le tracé de l'outil, pas un second —, mais
     ce qu'il rend est écrit ici à la main dans `CON.elements` et `ANT.ports`,
     sans passer par `conGabaritPoser` : celui-ci remettrait au passage la
     bande à ±15 % de la cible et le zoom à l'échelle de la carte. Une bande
     resserrée à la main serait alors rétablie en silence à chaque point.

     L'ordre compte : le motif d'abord, les formes ensuite. Les rangs des
     formes désignent le dessin du motif — c'est le garde-fou de
     `conGabaritConforme` qui le garantit —, et les poser avant serait les
     poser sur un dessin qu'on s'apprête à remplacer. */
  const elAvant=motifs.length?CON.elements:null;
  /* LE TABLEAU DES PORTS EST REMIS TEL QUEL, objets compris, et non remplacé
     par une copie. `conPoser` le tronque à un seul port ; rendre à la place un
     tableau neuf laisserait tout ce qui tient une référence sur un port —
     l'overlay, le panneau — désigner un objet que plus rien ne met à jour. On
     garde donc le tableau d'origine ET le contenu de chaque port, et on les
     recolle à la fin. */
  const portsAvant=motifs.length
    ?{t:ANT.ports, o:ANT.ports.slice(),
      p:ANT.ports.map(q=>JSON.parse(JSON.stringify(q))),
      i:ANT.portActif}:null;
  const carteAvant=motifs.length?{L:CON.carte.L, W:CON.carte.W}:null;
  if(motifs.length){
    const g=conGabarit(CON.gabarit);
    const c=conContexte();
    const q={};
    for(const k in CON.gabaritP)q[k]=CON.gabaritP[k];
    for(const m of motifs)q[m.src.motif]=m.v;
    const r=conGabaritTrace(g,c,conGabaritCotes(g,c,q));
    if(r){
      CON.elements=r.elements;
      /* LA CARTE SUIT LE MOTIF, et c'est le contour du document : un patch
         rallongé sur une carte restée courte dépasserait du substrat, et le
         modèle serait faux sans que la géométrie du cuivre ait tort. Même
         arrondi qu'à la pose. */
      CON.carte.L=+r.t.carte.L.toFixed(3);
      CON.carte.W=+r.t.carte.W.toFixed(3);
      conPoser(r.t.port,r.t.ligne);
      /* LES AUTRES PORTS SURVIVENT AU BALAYAGE, alors que la POSE les
         supprime — et les deux ont raison. Poser un motif refait la carte
         entière : les ports supplémentaires y désignaient du cuivre qui
         n'existe plus, les garder serait les garder dans le vide. Un point de
         balayage, lui, déplace une cote de quelques dixièmes : effacer le
         second port à chaque point retirerait le couplage de TOUS les points,
         et la famille de courbes décrirait une antenne seule sans le dire.

         Ils sont remis tels quels, aux mêmes coordonnées absolues, ET AVEC
         LEUR EXCITATION : si la carte a bougé sous l'un d'eux, il tombe hors
         du cuivre et le serveur refuse CE point-là en le nommant, avant tout
         lancement. C'est le bon endroit pour l'apprendre. */
      for(let i=1;i<portsAvant.p.length;i++)
        ANT.ports.push(JSON.parse(JSON.stringify(portsAvant.p[i])));
      ANT.ports[0].excite=!!portsAvant.p[0].excite;
      ANT.portActif=portsAvant.i;
    }
  }

  const avant={};
  for(const q of formes){
    if(avant[q.src.forme]===undefined)
      avant[q.src.forme]=JSON.parse(JSON.stringify(CON.elements[q.src.forme]));
  }
  for(const q of formes)balPoser(CON.elements[q.src.forme],q.src.champ,q.v);
  /* Les mêmes rôles de couche que dans `conAppliquer` : sans eux, le document
     obtenu différerait de celui de départ sur des couches qu'on n'a pas
     touchées, et la comparaison y verrait des modifications qui n'en sont
     pas. */
  conRolesDeclares();
  mdlCharger(conModele(),"conception");
  const doc=antDocument();
  for(const i in avant)Object.assign(CON.elements[i],avant[i]);
  if(elAvant){
    CON.elements=elAvant;
    ANT.ports=portsAvant.t;
    ANT.ports.length=portsAvant.p.length;
    portsAvant.p.forEach(function(q,i){
      ANT.ports[i]=Object.assign(portsAvant.o[i],q);
    });
    ANT.portActif=portsAvant.i;
    CON.carte.L=carteAvant.L; CON.carte.W=carteAvant.W;
  }
  return doc;
}

/* Poser une cote sur une forme. Les rectangles se règlent en largeur et
   hauteur, PAS en deux coins : c'est ainsi qu'on écrit « 38,2 mm de long »
   sans faire l'addition de tête, et c'est la même règle que dans le panneau
   de conception. */
function balPoser(el,champ,v){
  if(el.type==="rect"){
    const x1=Math.min(el.x1,el.x2), y1=Math.min(el.y1,el.y2);
    const w=Math.abs(el.x2-el.x1), h=Math.abs(el.y2-el.y1);
    if(champ==="largeur"){ el.x1=x1; el.x2=x1+v; el.y1=y1; el.y2=y1+h; }
    else if(champ==="hauteur"){ el.x1=x1; el.x2=x1+w; el.y1=y1; el.y2=y1+v; }
    else if(champ==="x"){ el.x1=v; el.x2=v+w; }
    else if(champ==="y"){ el.y1=v; el.y2=v+h; }
    return;
  }
  el[champ]=v;
}

/* La description que le serveur attend. Construite au moment de l'envoi, et
   pas conservée : les cotes du dessin bougent, et un balayage préparé il y a
   dix minutes décrirait une géométrie qui n'existe plus. */
function antBalayageSpec(){
  const s1=balSource(), v1=balValeurs();
  if(!s1||v1.length<2)return {points:[]};
  const s2=balSource2(), v2=balValeurs2();
  const croise=!!(s2&&v2.length>=2);

  /* LE PRODUIT CARTÉSIEN, ET DANS CET ORDRE : la première cote varie
     lentement, la seconde vite. C'est l'ordre dans lequel on lit un tableau,
     et c'est aussi celui dans lequel les courbes se rangent — toutes celles
     d'une même longueur à la suite. */
  const couples=[];
  for(const a of v1){
    if(croise)for(const b of v2)couples.push([a,b]);
    else couples.push([a,null]);
  }

  /* Les cotes DESSINÉES n'existent nulle part dans le document : c'est le
     document entier qu'on refait, et qu'on compare. Celles qui ont un chemin
     s'écrivent directement. Un croisement peut mêler les deux, et les
     modifications se cumulent alors sans se gêner : elles ne touchent pas aux
     mêmes endroits du document. */
  const dessinees=[s1,s2].filter((s,i)=>s&&!s.chemin&&(i===0||croise));
  const base=dessinees.length?antDocument():null;

  const points=[];
  for(const c of couples){
    let modifs=[];
    const poses=[];
    if(s1.chemin)modifs.push({chemin:s1.chemin, valeur:c[0]});
    else poses.push({src:s1, v:c[0]});
    if(croise){
      if(s2.chemin)modifs.push({chemin:s2.chemin, valeur:c[1]});
      else poses.push({src:s2, v:c[1]});
    }
    if(poses.length)
      modifs=modifs.concat(balDiff(base,balDocumentPour(poses)));
    points.push({etiquette:croise?(balEtiquette(c[0])+" × "+balEtiquette(c[1]))
                                 :balEtiquette(c[0]),
                 valeur:c[0], valeur2:c[1], modifs:modifs});
  }
  /* Le modèle en mémoire porte encore la dernière valeur essayée : on le
     remet dans l'état du dessin, par le chemin ordinaire — celui qui remet
     aussi les couches visibles, la sélection et le panneau. L'état du dessin
     est donc restauré même quand une valeur intermédiaire produit une
     géométrie que le serveur refusera : c'est lui qui refuse, pas nous qui
     cachons. */
  if(dessinees.length)conAppliquer(false,true);

  return {nom:s1.nom, unite:s1.unite, croise:croise,
          nom2:croise?s2.nom:"", unite2:croise?s2.unite:"",
          points:points};
}

/* ==========================================================================
   Le panneau, greffé dans l'étape « Le calcul »
   ========================================================================== */
function antBalayageHtml(){
  const b=ANT.balayage;
  const sources=balSources();
  if(!sources.length)return "";
  const src=balSource();
  const vals=balValeurs();
  const src2=balSource2();
  const vals2=balValeurs2();
  const total=balCombien();
  const e=ANT.etatServeur;
  const peut=e&&e.lancer;

  return `
<div class="champ">
  <label class="ck"><input type="checkbox" id="antBalOn"${b.actif?" checked":""}>
    Balayer une cote
    <small>Une simulation par valeur, à la suite. Ce n'est pas une
    optimisation : c'est une famille de courbes, et ce qu'on y lit est la
    <b>sensibilité</b> — de combien la résonance bouge pour un dixième de
    millimètre. C'est elle qui dit si la cote devra être tenue en
    fabrication.</small></label>
</div>
${b.actif?`
<div class="champ ligne">
  <span><label>Cote</label>
    <select id="antBalSrc">${sources.map(s=>
      '<option value="'+aEsc(s.id)+'"'+(src&&s.id===src.id?" selected":"")+'>'+
      aEsc(s.nom)+'</option>').join("")}</select></span>
</div>
<div class="champ ligne">
  <span><label>De</label><input type="number" step="0.05" id="antBalMin" value="${b.min}"></span>
  <span><label>à</label><input type="number" step="0.05" id="antBalMax" value="${b.max}"></span>
  <span><label>par pas de</label><input type="number" step="0.05" min="0.0001" id="antBalPas" value="${b.pas}"></span>
  <span class="unite">${aEsc(src?src.unite:"")}</span>
</div>
<div class="champ">
  <label class="ck"><input type="checkbox" id="antBalCroise"${b.croise?" checked":""}>
    Croiser avec une seconde cote
    <small>Deux cotes qui ne se lisent pas l'une sans l'autre : sur un patch
    alimenté par ligne encastrée, la longueur pose la <b>résonance</b> et
    l'encastrement pose l'<b>adaptation</b>, et les balayer séparément fait
    tourner en rond — on corrige l'une, l'autre se dérègle. Le prix est un
    PRODUIT : 6×6 font 36 simulations, pas douze.</small></label>
</div>
${b.croise?`
<div class="champ ligne">
  <span><label>Seconde cote</label>
    <select id="antBalSrc2">${sources.filter(s=>!src||s.id!==src.id).map(s=>
      '<option value="'+aEsc(s.id)+'"'+(src2&&s.id===src2.id?" selected":"")+'>'+
      aEsc(s.nom)+'</option>').join("")}</select></span>
</div>
<div class="champ ligne">
  <span><label>De</label><input type="number" step="0.05" id="antBalMin2" value="${b.min2}"></span>
  <span><label>à</label><input type="number" step="0.05" id="antBalMax2" value="${b.max2}"></span>
  <span><label>par pas de</label><input type="number" step="0.05" min="0.0001" id="antBalPas2" value="${b.pas2}"></span>
  <span class="unite">${aEsc(src2?src2.unite:"")}</span>
</div>`:""}
${(src&&src.motif)||(src2&&src2.motif)?`<p class="note">Une cote de motif
   <b>repose le motif</b> à chaque point : la carte et le port suivent, comme
   à la pose. La bande, l'arrêt et le maillage, eux, ne bougent pas — c'est
   la cote qu'on lit, pas le réglage.</p>`:""}
${src&&!vals.length?`<p class="note alerte">La plage est vide : il faut
   « de » &lt; « à » et un pas positif.</p>`:""}
${b.croise&&src2&&vals2.length<2?`<p class="note alerte">La seconde plage est
   vide : sans au moins deux valeurs, il n'y a rien à croiser — le balayage
   retombe sur la première cote seule.</p>`:""}
${total>BAL_MAX?`<p class="note alerte">${vals.length}${vals2.length?" × "+
   vals2.length+" = "+total:""} points, ${BAL_MAX} au plus. Chaque point est
   une simulation complète — au-delà, c'est une nuit de calcul qu'on lance
   sans la voir venir. Élargissez le pas.${vals2.length?
   " Le garde-fou porte sur le PRODUIT : c'est lui qu'on paie, pas la somme."
   :""}</p>`:""}
${vals.length>=2&&total<=BAL_MAX?`
<div class="recap">
  <span><b>${total}</b> simulations${vals2.length?" ("+vals.length+" × "+
    vals2.length+")":""}</span>
  <span>de <b>${balEtiquette(vals[0])}</b> à
        <b>${balEtiquette(vals[vals.length-1])}</b> ${aEsc(src.unite)}</span>
  ${vals2.length?'<span>et de <b>'+balEtiquette(vals2[0])+'</b> à <b>'+
    balEtiquette(vals2[vals2.length-1])+'</b> '+aEsc(src2.unite)+'</span>':""}
  ${ANT.modele?'<span>≈ <b>'+antDuree(antBalDuree()*total)+
    '</b> en tout</span>':""}
</div>
<p class="note">La valeur courante est <b>${balEtiquette(src.valeur)}
   ${aEsc(src.unite)}</b>. Elle n'est pas modifiée : le balayage travaille sur
   des copies du document, et le dessin reste tel qu'il est.</p>
<div class="champ actions">
  <button class="tb" id="bBalDevis">∑ Chiffrer la plage</button>
  <button class="tb on" id="bBalLancer"${peut?"":" disabled"}>▶ Lancer le balayage</button>
</div>
${b.devis?`<div class="recap${b.devis.refus?" ko":""}">
  ${b.devis.refus
    ? '<span>'+aEsc(b.devis.refus)+'</span>'
    : '<span><b>'+aEnt(b.devis.cellules/1e6)+'</b> millions de cellules en tout</span>'+
      '<span>≈ <b>'+antDuree(b.devis.duree)+'</b> de calcul</span>'+
      '<span>le point le plus lourd : <b>'+aEnt(b.devis.pire)+'</b> cellules</span>'}
</div>`:""}
<p class="note">« Chiffrer » vérifie les ${total} points au serveur — les
   mêmes refus qu'une simulation ordinaire, mais tous d'un coup, et sans rien
   lancer. C'est la réponse à « combien de temps si je pars maintenant ».</p>`:""}`:""}`;
}

/* La durée d'UN point, à partir du modèle courant. Le serveur la recalcule
   pour chacun — ils n'ont pas tous le même maillage —, mais il faut bien
   annoncer un ordre de grandeur avant d'appeler. */
function antBalDuree(){
  const m=ANT.modele;
  if(!m)return 0;
  const e=m.estimation;
  const pas=Math.min(m.arret.nmax,
                     Math.max(2000,Math.round(20/(m.bande.f0*e.dt_s))));
  return e.cellules*pas/(e.mcps_suppose*1e6);
}

function antBalayageLier(box){
  const on=box.querySelector("#antBalOn");
  if(on)on.onchange=function(){
    ANT.balayage.actif=this.checked;
    ANT.balayage.devis=null;
    /* Une plage vide au premier affichage ne sert à rien : on la centre sur
       la valeur courante, à plus ou moins cinq pour cent. C'est l'ordre de
       grandeur de l'écart d'un gabarit analytique — exactement ce qu'on
       cherche à rattraper. */
    const s=balSource();
    if(this.checked&&s&&!(ANT.balayage.max>ANT.balayage.min)){
      const v=s.valeur||1;
      ANT.balayage.source=s.id;
      ANT.balayage.min=+(v*0.95).toFixed(3);
      ANT.balayage.max=+(v*1.05).toFixed(3);
      ANT.balayage.pas=+(Math.abs(v)*0.02).toFixed(3)||0.1;
    }
    antAssistantRendre();
  };
  const s=box.querySelector("#antBalSrc");
  if(s)s.onchange=function(){
    ANT.balayage.source=this.value;
    ANT.balayage.devis=null;
    const src=balSource();
    if(src){
      const v=src.valeur||1;
      ANT.balayage.min=+(v*0.95).toFixed(3);
      ANT.balayage.max=+(v*1.05).toFixed(3);
      ANT.balayage.pas=+(Math.abs(v)*0.02).toFixed(3)||0.1;
    }
    antAssistantRendre();
  };
  const n=function(id,cle){
    const el=box.querySelector(id);
    if(!el)return;
    el.oninput=function(){
      const v=parseFloat(String(el.value).replace(",","."));
      /* Le devis porte sur la plage qu'on vient de changer : il ne vaut plus
         rien, et un chiffre qui ne correspond plus à ce qui est affiché est
         pire que pas de chiffre du tout. */
      if(isFinite(v)){ ANT.balayage[cle]=v; ANT.balayage.devis=null;
                       antAssistantRendre(); }
    };
  };
  n("#antBalMin","min"); n("#antBalMax","max"); n("#antBalPas","pas");
  n("#antBalMin2","min2"); n("#antBalMax2","max2"); n("#antBalPas2","pas2");

  const cr=box.querySelector("#antBalCroise");
  if(cr)cr.onchange=function(){
    ANT.balayage.croise=this.checked;
    ANT.balayage.devis=null;
    /* Une seconde plage vide au premier affichage ne sert à rien : on la
       centre sur la valeur courante de la cote choisie, comme on le fait
       déjà pour la première. */
    const s2=balSource2();
    if(this.checked&&s2&&!(ANT.balayage.max2>ANT.balayage.min2)){
      const v=s2.valeur||1;
      ANT.balayage.source2=s2.id;
      ANT.balayage.min2=+(v*0.95).toFixed(3);
      ANT.balayage.max2=+(v*1.05).toFixed(3);
      ANT.balayage.pas2=+(Math.abs(v)*0.05).toFixed(3)||0.1;
    }
    antAssistantRendre();
  };
  const s2=box.querySelector("#antBalSrc2");
  if(s2)s2.onchange=function(){
    ANT.balayage.source2=this.value;
    ANT.balayage.devis=null;
    const src=balSource2();
    if(src){
      const v=src.valeur||1;
      ANT.balayage.min2=+(v*0.95).toFixed(3);
      ANT.balayage.max2=+(v*1.05).toFixed(3);
      ANT.balayage.pas2=+(Math.abs(v)*0.05).toFixed(3)||0.1;
    }
    antAssistantRendre();
  };
  const b=box.querySelector("#bBalLancer");
  if(b&&!b.disabled)b.onclick=antLancerBalayage;
  const dv=box.querySelector("#bBalDevis");
  if(dv)dv.onclick=antBalayageDevis;
}

/* Le devis : ce que la plage va coûter, vérifiée point par point, sans rien
   lancer. C'est le pendant de « préparer » pour une simulation seule, et il
   a la même vertu — un refus arrive AVANT l'engagement, pas au quatorzième
   point une heure plus tard. */
async function antBalayageDevis(){
  ANT.balayage.devis=null;
  try{
    const d=await oeBalayage();
    ANT.balayage.devis={
      cellules:d.estimation.cellules,
      duree:d.estimation.duree_s,
      pire:Math.max.apply(null,d.points.map(p=>p.cellules))
    };
  }catch(e){
    ANT.balayage.devis={refus:String(e.message||e).split(String.fromCharCode(10))[0]};
  }
  antAssistantRendre();
}

async function antLancerBalayage(){
  try{
    typeof wsHint==="function"&&wsHint("Vérification des points…");
    await oeLancerBalayage();
  }catch(e){
    typeof wsHint==="function"&&wsHint("Balayage refusé : "+(e.message||e));
    antAssistantRendre();
    return;
  }
  antAssistantRendre();
  antJournalRendre();
  antBoutonsEtat();
  await oeSuivre(function(){ antJournalRendre(); antBoutonsEtat(); });
  antResultatsRendre();
  antAssistantRendre();
}
