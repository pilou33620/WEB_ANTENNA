"use strict";
/* =============================================================================
   Antenne openEMS — 16-resultats.js
   Ce que le solveur a rendu, et ce que ça vaut.

   QUATRE COURBES, ET LE JUGEMENT QUI VA AVEC. Un S11 tracé sans rien d'autre
   laisse croire que tout ce qui descend est bon. Or une antenne peut afficher
   −25 dB et ne rien rayonner : le S11 mesure l'ADAPTATION, pas le rayonnement,
   et une antenne parfaitement adaptée qui dissipe tout dans le cuivre et le
   diélectrique est une charge de 50 ohms très coûteuse. C'est pourquoi le
   rendement, quand la boîte de champ lointain a tourné, est affiché à côté du
   S11 et non dans un onglet où personne n'irait le chercher.
   ============================================================================= */

let ANT_ONGLET="s11";
/* Quel point du balayage les onglets détaillés montrent. Le tableau le
   choisit ; par défaut le premier. */
let ANT_BAL_POINT=0;

const ANT_ONGLETS=[
  {id:"bal",  titre:"Balayage",     unite:"dB"},
  {id:"ts",   titre:"Tableau S",    unite:"dB"},
  {id:"s11",  titre:"S₁₁",          unite:"dB"},
  {id:"s21",  titre:"Couplage",     unite:"dB"},
  {id:"roe",  titre:"ROE",          unite:""},
  {id:"z",    titre:"Impédance",    unite:"Ω"},
  {id:"ff",   titre:"Rayonnement",  unite:"dBi"}
];

/* Le résultat du balayage, s'il y en a un. Il enveloppe les résultats
   ordinaires plutôt que de les remplacer : tout ce qui suit continue de
   travailler sur UN résultat, celui du point choisi. */
function antBal(){
  const r=ANT.resultat;
  return (r&&r.balayage&&r.points&&r.points.length)?r:null;
}

/* Le résultat qu'on regarde : celui du point choisi quand c'est un balayage,
   le résultat tout court sinon. */
function antRes(){
  const b=antBal();
  if(b){
    const p=b.points[Math.min(ANT_BAL_POINT,b.points.length-1)];
    return p?p.resultat:null;
  }
  /* Un tableau S enveloppe lui aussi un résultat ordinaire : celui de la
     colonne choisie, c'est-à-dire la simulation où CE port-là excitait — la
     première tant qu'on n'a rien cliqué. Tout ce qui suit continue de
     travailler sur UN résultat, et n'a rien à savoir du tableau. */
  const t=(typeof antTs==="function")?antTs():null;
  if(t)return ((typeof antTsResultat==="function")
                 ? antTsResultat(t) : t.premier)||null;
  return ANT.resultat;
}

function antResultatsRendre(){
  const box=aE("resultats");
  if(!box)return;
  const bal=antBal();
  const r=antRes();
  if(!r){
    box.innerHTML='<div class="rien">Aucun résultat. Lancez le calcul depuis '+
      'l\'étape « Le calcul » — ou exportez le script et lancez-le à la main.</div>';
    return;
  }
  /* Un onglet qui n'a rien à montrer ne doit pas rester sélectionné : arriver
     sur un panneau vide sans savoir pourquoi est pire que ne pas avoir
     l'onglet. */
  const ts=(typeof antTs==="function")?antTs():null;
  if(ANT_ONGLET==="bal"&&!bal)ANT_ONGLET="s11";
  if(ANT_ONGLET==="ts"&&!ts)ANT_ONGLET="s11";
  if(ANT_ONGLET==="s21"&&!r.couplages)ANT_ONGLET="s11";
  if(bal&&ANT_ONGLET==="s11"&&!ANT_BAL_VU){ANT_ONGLET="bal";ANT_BAL_VU=true;}

  const bp=antBandePassante(r);
  const nf=r.nf2ff;

  box.innerHTML=
    (bal?antBalVerdict(bal):"")+
    '<div class="verdict">'+
      '<div class="cle"><b>'+aF(r.f0)+'</b><span>résonance</span></div>'+
      '<div class="cle"><b>'+aNb(r.s11_min_db,2)+' dB</b><span>S₁₁ minimal</span></div>'+
      '<div class="cle"><b>'+aNb(r.z0_re,1)+' '+(r.z0_im>=0?"+":"−")+
        aNb(Math.abs(r.z0_im),1)+'j Ω</b><span>impédance d\'entrée'+
        (r.ligne?' (au port)':'')+'</span></div>'+
      /* L'IMPÉDANCE RAMENÉE AU PIED DE L'ANTENNE, à côté de celle du port et
         jamais à sa place. Les deux décrivent la même antenne ; seule la
         seconde dit quoi corriger SUR l'antenne, et seule la première est une
         mesure — l'autre en est une rotation analytique. Les substituer
         l'une à l'autre ferait croire à une mesure ce qui est un calcul. */
      (r.ligne&&r.z0_pied_re!=null
        ?'<div class="cle"><b>'+aNb(r.z0_pied_re,1)+' '+
          (r.z0_pied_im>=0?"+":"−")+aNb(Math.abs(r.z0_pied_im),1)+
          'j Ω</b><span>au pied de l\'antenne ('+antLongModele(r.ligne.d)+
          ' de ruban)</span></div>':"")+
      (bp.existe
        ? '<div class="cle"><b>'+aNb(bp.largeur/1e6,1)+' MHz</b>'+
          '<span>bande à −10 dB ('+aNb(bp.relative,2)+' %)</span></div>'
        : '<div class="cle ko"><b>aucune</b><span>jamais sous −10 dB</span></div>')+
      antCouplageVerdict(r)+
      (nf&&nf.dmax_dbi!=null
        ?'<div class="cle"><b>'+aNb(nf.dmax_dbi,2)+' dBi</b>'+
          '<span>directivité</span></div>':"")+
      (nf&&nf.gain_dbi!=null
        ?'<div class="cle"><b>'+aNb(nf.gain_dbi,2)+' dBi</b>'+
          '<span>gain réalisé</span></div>':"")+
      (nf&&nf.rendement!=null
        ?'<div class="cle"><b>'+aNb(nf.rendement*100,1)+' %</b>'+
         '<span>rendement de rayonnement</span></div>':"")+
    '</div>'+
    (ts?antTsVerdict(ts):"")+
    antVerdictTexte(r,bp,nf)+
    '<div class="onglets">'+ANT_ONGLETS.map(function(o){
        const mort=(o.id==="ff"&&!(nf&&nf.e_norm&&nf.e_norm.length))||
                   (o.id==="s21"&&!r.couplages)||
                   (o.id==="ts"&&!ts)||
                   (o.id==="bal"&&!bal);
        if(mort&&(o.id==="s21"||o.id==="bal"||o.id==="ts"))return "";
        return '<button class="ong'+(o.id===ANT_ONGLET?" on":"")+
          (mort?" mort":"")+'" data-ong="'+o.id+'"'+(mort?" disabled":"")+'>'+
          o.titre+'</button>';
      }).join("")+
      '<span class="push"></span>'+
      '<button class="tb mini" id="bCsv">⤓ .csv</button>'+
      (ts?'<button class="tb mini" id="bSnp">⤓ .s'+ts.ports.length+
           'p</button>'
          :'<button class="tb mini" id="bS1p">⤓ .s1p</button>')+
    '</div>'+
    '<canvas id="courbe"></canvas>'+
    '<div class="legende" id="legende"></div>'+
    (bal?(bal.croise?antBalMatrice(bal):antBalTableau(bal)):"")+
    (ts?antTsTableau(ts):"");

  box.querySelectorAll("[data-ong]").forEach(function(b){
    b.onclick=function(){ ANT_ONGLET=b.dataset.ong; antResultatsRendre(); };
  });
  box.querySelectorAll("[data-balpt]").forEach(function(b){
    b.onclick=function(){
      ANT_BAL_POINT=+b.dataset.balpt;
      if(ANT_ONGLET==="bal")ANT_ONGLET="s11";
      antResultatsRendre();
    };
  });
  /* Une colonne du tableau S se clique comme une ligne du balayage, et pour la
     même raison : c'est une simulation complète, dont le diagramme vaut autant
     que la case de décibels qu'on en montre. */
  box.querySelectorAll("[data-tscol]").forEach(function(b){
    b.onclick=function(){
      ANT_TS_COL=+b.dataset.tscol;
      if(ANT_ONGLET==="ts"){
        const rc=antRes();
        ANT_ONGLET=(rc&&rc.nf2ff&&rc.nf2ff.e_norm&&rc.nf2ff.e_norm.length)
                   ?"ff":"s11";
      }
      antResultatsRendre();
    };
  });
  box.querySelector("#bCsv").onclick=antExportCsv;
  const b1p=box.querySelector("#bS1p");
  if(b1p)b1p.onclick=antExportS1p;
  const bnp=box.querySelector("#bSnp");
  if(bnp)bnp.onclick=antExportSnp;
  antCourbeDessiner();
}

/* Une fois : la première fois qu'un balayage arrive, on montre la famille de
   courbes plutôt que le S₁₁ d'un point isolé. Ensuite l'onglet choisi reste
   celui qu'on a choisi. */
let ANT_BAL_VU=false;

/* ==========================================================================
   Le balayage
   ========================================================================== */
/* CE QUI SE LIT EN PREMIER N'EST PAS LE MEILLEUR POINT, C'EST LA PENTE. « La
   résonance descend de 62 MHz par millimètre » dit du même coup de combien il
   faut corriger ET avec quelle précision la cote devra être tenue en
   fabrication. Le meilleur point, lui, ne survit pas au prochain lot de
   stratifié. */
function antBalVerdict(bal){
  const p=bal.pente_hz_par_unite;
  const n=bal.points.length;
  return '<div class="verdict bal">'+
    '<div class="cle"><b>'+aEsc(bal.nom)+(bal.croise?" × "+aEsc(bal.nom2):"")+
      '</b><span>cote'+(bal.croise?"s croisées":" balayée")+'</span></div>'+
    '<div class="cle"><b>'+n+'</b><span>point'+(n>1?"s":"")+' calculé'+
      (n>1?"s":"")+'</span></div>'+
    (p?'<div class="cle"><b>'+aNb(p/1e6,1)+' MHz</b><span>par '+
       aEsc(bal.unite||"unité")+' de '+aEsc(bal.nom)+'</span></div>':"")+
    '</div>';
}

/* Une ligne par point, et l'écart à la cible en toutes lettres : c'est la
   colonne qu'on lit, et celle qui dit où aller. */
function antBalTableau(bal){
  const cible=ANT.bande.fcible;
  return '<table class="bal-table"><thead><tr>'+
    '<th>'+aEsc(bal.nom)+(bal.unite?" ("+aEsc(bal.unite)+")":"")+'</th>'+
    '<th>résonance</th><th>écart à la cible</th><th>S₁₁ min</th>'+
    '<th>impédance</th><th>bande −10 dB</th></tr></thead><tbody>'+
    bal.points.map(function(p,i){
      const r=p.resultat;
      const bp=antBandePassante(r);
      const ec=cible>0?100*(r.f0-cible)/cible:0;
      /* Un point qui n'a rien rendu porte sa raison dans l'infobulle de sa
         ligne : elle est au bout du curseur, là où l'on cherche pourquoi cette
         ligne-là n'a que des tirets. */
      return '<tr class="'+(i===ANT_BAL_POINT?"on":"")+
        '" data-balpt="'+i+'" title="'+
        (r.diagnostic?aEsc(r.diagnostic):"Voir les courbes de ce point")+'">'+
        '<td><b>'+aEsc(p.etiquette)+'</b></td>'+
        '<td>'+aF(r.f0)+'</td>'+
        '<td class="'+(Math.abs(ec)<1?"ok":"")+'">'+(ec>=0?"+":"")+
          aNb(ec,2)+' %</td>'+
        '<td>'+aNb(r.s11_min_db,1)+' dB</td>'+
        '<td>'+aNb(r.z0_re,0)+' '+(r.z0_im>=0?"+":"−")+
          aNb(Math.abs(r.z0_im),0)+'j</td>'+
        '<td>'+(bp.existe?aNb(bp.largeur/1e6,0)+' MHz':"—")+'</td></tr>';
    }).join("")+'</tbody></table>'+
    '<p class="note">Une ligne par simulation complète. Cliquez-en une pour '+
    'voir ses courbes dans les autres onglets — l\'impédance et le diagramme '+
    'du point choisi valent autant que son S₁₁.</p>';
}

/* DEUX COTES CROISÉES NE SE LISENT PAS EN LISTE. Trente-six lignes ordonnées
   par « longueur, puis encastrement » cachent exactement ce qu'on est venu
   chercher : la ligne de crête où la résonance tombe juste, et l'endroit sur
   cette ligne où l'adaptation est la meilleure. Un tableau à deux entrées les
   montre d'un coup d'œil — une cote par axe, et la couleur de la case dit ce
   que valent ses deux chiffres.

   CHAQUE CASE EST UNE SIMULATION COMPLÈTE, et se clique comme une ligne du
   balayage simple : les courbes des autres onglets sont celles de la case
   choisie. */
function antBalMatrice(bal){
  const cible=ANT.bande.fcible;
  const lignes=[], colonnes=[];
  bal.points.forEach(function(p){
    if(lignes.indexOf(p.valeur)<0)lignes.push(p.valeur);
    if(colonnes.indexOf(p.valeur2)<0)colonnes.push(p.valeur2);
  });
  lignes.sort((a,b)=>a-b); colonnes.sort((a,b)=>a-b);
  const rang={};
  bal.points.forEach(function(p,i){ rang[p.valeur+"|"+p.valeur2]=i; });

  let h='<table class="bal-table"><thead><tr><th>'+aEsc(bal.nom)+
    (bal.unite?" ("+aEsc(bal.unite)+")":"")+'  \\  '+aEsc(bal.nom2)+
    (bal.unite2?" ("+aEsc(bal.unite2)+")":"")+'</th>'+
    colonnes.map(c=>'<th>'+balEtiquette(c)+'</th>').join("")+'</tr></thead><tbody>';
  lignes.forEach(function(l){
    h+='<tr><td><b>'+balEtiquette(l)+'</b></td>';
    colonnes.forEach(function(c){
      const i=rang[l+"|"+c];
      const p=(i==null)?null:bal.points[i];
      if(!p){ h+='<td>—</td>'; return; }
      const r=p.resultat;
      const ec=cible>0?100*(r.f0-cible)/cible:0;
      h+='<td class="'+(i===ANT_BAL_POINT?"on":(Math.abs(ec)<1?"ok":""))+
        '" data-balpt="'+i+'" title="'+aEsc(bal.nom+" = "+balEtiquette(l)+
        ", "+bal.nom2+" = "+balEtiquette(c))+' — voir ses courbes">'+
        aF(r.f0)+'<br><small>'+aNb(r.s11_min_db,1)+' dB</small></td>';
    });
    h+='</tr>';
  });
  return h+'</tbody></table>'+
    '<p class="note">Une case par simulation complète : la résonance en haut, '+
    'le S<sub>11</sub> minimal en dessous. Les cases marquées sont celles dont '+
    "la résonance tombe à moins d'un pour cent de la cible — c'est la ligne de "+
    "crête, et c'est dessus qu'on choisit sur le second critère. Cliquez-en une "+
    "pour voir ses courbes.</p>"+
    '<p class="note">' +
    "Aucune pente n'est annoncée ici : du premier au dernier point, DEUX "+
    "cotes ont changé, et un nombre de mégahertz par millimètre ne dirait "+
    "pas de laquelle. Lisez-la sur une ligne ou sur une colonne.</p>";
}

/* Le couplage, dans le bandeau : c'est la grandeur qu'on vient chercher quand
   on pose deux ports, et la laisser dans un onglet reviendrait à la cacher. */
function antCouplageVerdict(r){
  if(!r.couplages)return "";
  return Object.keys(r.couplages).map(function(n){
    const c=r.couplages[n];
    return '<div class="cle'+(c.pire_db>-10?" ko":"")+'"><b>'+
      aNb(c.db_f0,1)+' dB</b><span>S<sub>'+aEsc(n)+
      (r.excite||1)+'</sub> à la résonance ('+aNb(c.pire_db,1)+
      ' dB au pire)</span></div>';
  }).join("");
}

/* La bande à −10 dB. Trois choses la rendent fausse quand on ne les dit pas :
   elle peut être coupée par le bord de la bande simulée, elle peut être en
   plusieurs morceaux (deux résonances), et elle peut ne pas exister. */
function antBandePassante(r){
  if(r.bp_f1==null)return {existe:false};
  return {existe:true, f1:r.bp_f1, f2:r.bp_f2,
          largeur:r.bp_f2-r.bp_f1,
          relative:100*(r.bp_f2-r.bp_f1)/((r.bp_f2+r.bp_f1)/2),
          continue:r.bp_continue!==false,
          bord:!!r.bp_bord};
}

function antVerdictTexte(r,bp,nf){
  const dits=[];
  /* UN PANNEAU VIDE DOIT DIRE POURQUOI IL EST VIDE, et c'est le premier avis :
     quand la simulation n'a rien rendu de fini, tout le reste — la bande, la
     résonance, le rendement — porte sur des grandeurs absentes, et les
     commenter serait commenter des tirets. Le serveur a lu la courbe
     d'énergie pas à pas ; c'est lui qui nomme la cause, ici on la montre. */
  /* Le texte d'un avis est du TEXTE : il est échappé au rendu, et le baliser
     afficherait les balises. Ce qui doit ressortir ressort par le rang. */
  if(r.diagnostic){
    dits.push({rang:"attention",t:"Aucune grandeur exploitable — "+
      r.diagnostic});
    return '<div class="avis">'+dits.map(d=>
      '<div class="av '+d.rang+'"><span>'+d.t+'</span></div>').join("")+'</div>';
  }
  if(bp.existe&&bp.bord)
    dits.push({rang:"attention",t:"La bande à −10 dB touche le bord de la "+
      "bande simulée : elle est peut-être plus large que ce qui est affiché. "+
      "Élargissez la bande pour la voir en entier."});
  if(bp.existe&&!bp.continue)
    dits.push({rang:"attention",t:"Le S₁₁ repasse au-dessus de −10 dB à "+
      "l'intérieur de la plage : il y a plusieurs résonances, et la largeur "+
      "affichée est celle de l'enveloppe, pas d'une bande utilisable."});
  if(Math.abs(r.f0-ANT.bande.fcible)/ANT.bande.fcible>0.02)
    dits.push({rang:"info",t:"La résonance est à "+aF(r.f0)+", la cible était "+
      aF(ANT.bande.fcible)+" — soit "+
      aNb(100*(r.f0-ANT.bande.fcible)/ANT.bande.fcible,1)+" % d'écart. "+
      "Une permittivité de substrat incertaine suffit à l'expliquer."});
  if(r.ligne&&r.z0_pied_re!=null)
    dits.push({rang:"info",t:"L'impédance au pied de l'antenne est une "+
      "rotation ANALYTIQUE de celle du port, sur "+antLongModele(r.ligne.d)+
      " de ruban de "+aNb(r.ligne.z0,1)+" Ω (εr effectif "+
      aNb(r.ligne.eeff,3)+"). Elle ne change pas l'adaptation et ne le "+
      "prétend pas : une ligne sans perte au Z₀ de référence fait tourner |Γ|, "+
      "elle ne le réduit pas. Deux réserves : ces deux nombres sont ceux de "+
      "Hammerstad, pas ceux de la ligne telle qu'elle est maillée ; et la "+
      "rotation est sans perte, si bien que près du bord de l'abaque — ici "+
      "S₁₁ = "+aNb(r.s11_min_db,1)+" dB — elle amplifie toute erreur sur eux."});
  if(nf&&nf.dmax_dbi==null)
    dits.push({rang:"attention",t:"Le champ lointain n'a pas pu être calculé : "+
      "la directivité est ressortie indéfinie. La cause habituelle est une "+
      "boîte de champ lointain qui n'a rien enregistré — vérifiez que la "+
      "marge d'air laisse de la place entre l'antenne et la PML."});
  if(nf&&nf.rendement!=null&&nf.rendement<0.5)
    dits.push({rang:"attention",t:"Moins de la moitié de la puissance acceptée "+
      "est rayonnée : le reste part en pertes dans le cuivre et le "+
      "diélectrique. Un S₁₁ profond n'y change rien — il dit que l'antenne "+
      "absorbe, pas qu'elle émet."});
  if(!nf)
    dits.push({rang:"info",t:"Le diagramme de rayonnement n'a pas été calculé : "+
      "le S₁₁ seul ne dit rien du rendement ni de la direction d'émission. "+
      "Cochez « Calculer le diagramme de rayonnement » à l'étape 6."});
  if(!dits.length)return "";
  return '<div class="avis">'+dits.map(d=>
    '<div class="av '+d.rang+'"><span>'+aEsc(d.t)+'</span></div>').join("")+'</div>';
}

/* =========================================================================
   Le tracé
   ========================================================================= */
function antCourbeDessiner(){
  const cv=aE("courbe");
  const r=antRes();
  if(!cv||!r)return;
  const dpr=Math.min(2,window.devicePixelRatio||1);
  const box=cv.parentElement.getBoundingClientRect();
  const W=Math.max(200,box.width-2), H=Math.max(140,Math.min(340,box.height*0.5));
  cv.style.width=W+"px"; cv.style.height=H+"px";
  cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr);
  const c=cv.getContext("2d");
  c.setTransform(dpr,0,0,dpr,0,0);
  c.clearRect(0,0,W,H);

  if(ANT_ONGLET==="ff"){ antFfDessiner(c,W,H,r.nf2ff); return; }
  if(ANT_ONGLET==="bal"){ antBalDessiner(c,W,H); return; }
  if(ANT_ONGLET==="ts"){
    const ts=antTs();
    /* Les N² courbes partagent l'axe du tableau, et non celui d'un résultat :
       c'est le même pour toutes les colonnes, et le serveur l'a vérifié.

       PAS « FAMILLE » ICI, et la nuance compte. Une famille de balayage se
       légende par les deux bouts de son dégradé : ses courbes n'ont pas de
       nom, seulement un rang. Celles-ci en ont un — S₁₁, S₂₁ — et c'est
       justement ce qu'on vient lire. */
    if(ts)antCartesien(c,W,H,ts.f,antTsSeries(ts));
    return;
  }

  const series=antSeries(r);
  antCartesien(c,W,H,r.f,series);
}

/* LA FAMILLE DE COURBES, ET C'EST ELLE QU'ON VIENT VOIR. Une courbe par
   valeur, du plus froid au plus chaud : on lit d'un coup d'œil dans quel sens
   la résonance se déplace, si elle se déplace linéairement, et si la
   profondeur du creux se dégrade aux extrémités — trois choses qu'aucun
   tableau ne montre aussi vite. */
/* LES DEUX AXES D'UN CROISEMENT, chacun dans sa liste de valeurs. Le rang d'un
   point, lui, est celui du PRODUIT : trente-six courbes rangées par « longueur,
   puis encastrement ». */
function antBalAxes(bal){
  const v1=[], v2=[];
  bal.points.forEach(function(p){
    if(v1.indexOf(p.valeur)<0)v1.push(p.valeur);
    if(p.valeur2!=null&&v2.indexOf(p.valeur2)<0)v2.push(p.valeur2);
  });
  v1.sort((a,b)=>a-b); v2.sort((a,b)=>a-b);
  return {v1:v1, v2:v2};
}

/* Six traits qui se distinguent à l'œil, du plein au pointillé serré. Au-delà
   de six valeurs sur le second axe ils se répètent : c'est moins bon, mais une
   famille de plus de six traits ne se lit plus de toute façon, et le tableau à
   deux entrées est alors le bon outil. */
const ANT_BAL_TIRETS=[[],[7,4],[2,3],[10,3,2,3],[4,2,1,2],[1,3]];

function antBalTirets(bal,p){
  const v2=antBalAxes(bal).v2;
  const k=v2.indexOf(p.valeur2);
  return (k<0)?null:ANT_BAL_TIRETS[k%ANT_BAL_TIRETS.length];
}

/* La couleur d'un point. Sur un croisement elle porte le PREMIER axe ; sinon
   elle porte le rang, qui est alors la seule chose qui varie. */
function antBalCouleurDe(bal,p,i){
  if(bal.croise){
    const v1=antBalAxes(bal).v1;
    return antBalCouleur(v1.length>1?v1.indexOf(p.valeur)/(v1.length-1):0);
  }
  return antBalCouleur(bal.points.length>1?i/(bal.points.length-1):0);
}

/* Un échantillon de trait pour la légende, au même motif que la courbe. */
function antTiretsCss(t,couleur){
  if(!t||!t.length)return "background:"+couleur;
  let x=0, on=true; const stops=[];
  for(const d of t){
    stops.push((on?couleur:"transparent")+" "+x+"px "+(x+d)+"px");
    x+=d; on=!on;
  }
  return "background:repeating-linear-gradient(90deg,"+stops.join(",")+")";
}

function antBalDessiner(c,W,H){
  const bal=antBal();
  if(!bal)return;
  /* SUR UN CROISEMENT, LE RANG DU POINT NE DIT PLUS RIEN. Il est celui du
     produit : un dégradé unique indexé dessus rend trente-six courbes dont la
     couleur ne désigne aucune des deux cotes — on voit une famille, on ne voit
     plus laquelle varie. La couleur porte donc le PREMIER axe, le trait porte
     le SECOND, et une courbe se nomme alors en la regardant : « la bleue en
     tirets ». */
  const croise=!!bal.croise;
  const series=bal.points.map(function(p,i){
    return {nom:p.etiquette,v:p.resultat.s11_db,
            couleur:antBalCouleurDe(bal,p,i),
            tirets:croise?antBalTirets(bal,p):null,
            epais:(i===ANT_BAL_POINT)?2.6:1.3,
            seuil:(i===0)?-10:null, seuilNom:(i===0)?"−10 dB":null};
  });
  /* Tous les points partagent la même bande : c'est la même simulation à une
     cote près. On prend donc l'axe du premier. */
  antCartesien(c,W,H,bal.points[0].resultat.f,series,true);
}

/* Du bleu froid au jaune chaud. L'ordre des couleurs EST l'ordre des valeurs :
   une légende de quarante entrées ne se lit pas, un dégradé si. */
function antBalCouleur(t){
  const a=[63,160,234], b=[242,199,68];
  return "rgb("+a.map((v,i)=>Math.round(v+(b[i]-v)*t)).join(",")+")";
}

/* Les séries de l'onglet courant, avec leur couleur et l'échelle qu'elles
   partagent. Deux séries d'unités différentes sur un même axe n'auraient pas
   de sens : la partie réelle et la partie imaginaire d'une impédance sont
   toutes deux en ohms, un S11 et un ROE ne le sont pas. */
function antSeries(r){
  switch(ANT_ONGLET){
    case "roe": return [{nom:"ROE",v:r.vswr,couleur:"#f2c744",
                         seuil:2,seuilNom:"ROE = 2 (−10 dB)"}];
    case "z":   return [{nom:"partie réelle",v:r.z_re,couleur:"#4cc38a",
                         seuil:50,seuilNom:"50 Ω"},
                        {nom:"partie imaginaire",v:r.z_im,couleur:"#c07cf0",
                         seuil:0,seuilNom:"réactance nulle"}];
    /* LE COUPLAGE SUR SON PROPRE AXE, et non superposé au S11. Les deux sont
       en décibels, mais l'un descend à −25 dB quand tout va bien et l'autre
       quand tout va mal : les mêlér sur une échelle commune écraserait celui
       qui compte. Le repère est à −15 dB, l'isolation en dessous de laquelle
       deux antennes d'un même produit se gênent pour de bon. */
    case "s21": {
      const cs=r.couplages||{};
      const noms=Object.keys(cs);
      return noms.map(function(n,i){
        return {nom:"S"+n+(r.excite||1),v:cs[n].db,
                couleur:["#e0705a","#4cc38a","#c07cf0","#3fa0ea"][i%4],
                seuil:(i===0)?-15:null,
                seuilNom:(i===0)?"−15 dB (isolation usuelle)":null};
      });
    }
    default:    return [{nom:"S₁₁",v:r.s11_db,couleur:"#3fa0ea",
                         seuil:-10,seuilNom:"−10 dB"}];
  }
}

function antCartesien(c,W,H,f,series,famille){
  const G={g:52,d:14,h:12,b:28};
  const x0=G.g, x1=W-G.d, y0=G.h, y1=H-G.b;

  let vmin=Infinity,vmax=-Infinity;
  for(const s of series)
    for(const v of s.v){ if(v<vmin)vmin=v; if(v>vmax)vmax=v; }
  for(const s of series)
    if(s.seuil!=null){ vmin=Math.min(vmin,s.seuil); vmax=Math.max(vmax,s.seuil); }
  /* Le ROE monte à l'infini là où l'antenne n'est pas adaptée : le laisser
     fixer l'échelle écraserait la seule partie qui nous intéresse. */
  if(ANT_ONGLET==="roe")vmax=Math.min(vmax,10);
  if(ANT_ONGLET==="z"){ vmin=Math.max(vmin,-400); vmax=Math.min(vmax,400); }
  if(!(vmax>vmin)){vmax=vmin+1;}
  const marge=(vmax-vmin)*0.08; vmin-=marge; vmax+=marge;

  const fx=function(i){ return x0+(x1-x0)*i/Math.max(1,f.length-1); };
  const fy=function(v){ return y1-(y1-y0)*(Math.min(vmax,Math.max(vmin,v))-vmin)/(vmax-vmin); };

  c.fillStyle="#101214"; c.fillRect(x0,y0,x1-x0,y1-y0);

  /* Grille et graduations. Cinq lignes : assez pour lire, assez peu pour ne
     pas cacher la courbe. */
  c.font='10px "JetBrains Mono","SF Mono",Consolas,monospace';
  c.strokeStyle="#23262b"; c.fillStyle="#8b919c"; c.lineWidth=1;
  c.textAlign="right"; c.textBaseline="middle";
  for(let i=0;i<=5;i++){
    const v=vmin+(vmax-vmin)*i/5, y=fy(v);
    c.beginPath(); c.moveTo(x0,y); c.lineTo(x1,y); c.stroke();
    c.fillText(aNb(v,ANT_ONGLET==="roe"?2:1),x0-6,y);
  }
  c.textAlign="center"; c.textBaseline="top";
  for(let i=0;i<=4;i++){
    const k=Math.round((f.length-1)*i/4), x=fx(k);
    c.beginPath(); c.moveTo(x,y0); c.lineTo(x,y1); c.stroke();
    c.fillText(aNb(f[k]/antKf(),3),x,y1+5);
  }
  c.textAlign="right";
  c.fillText(ANT.uniteF,x1,y1+5);

  /* Les seuils AVANT les courbes : ce sont des repères, ils passent dessous. */
  for(const s of series)
    if(s.seuil!=null&&s.seuil>=vmin&&s.seuil<=vmax){
      c.save();
      c.strokeStyle="#5a6069"; c.setLineDash([5,4]);
      const y=fy(s.seuil);
      c.beginPath(); c.moveTo(x0,y); c.lineTo(x1,y); c.stroke();
      c.restore();
    }

  for(const s of series){
    c.save();
    c.strokeStyle=s.couleur; c.lineWidth=s.epais||1.8;
    /* Le trait pointillé porte le SECOND axe d'un croisement — voir
       `antBalDessiner`. Ailleurs il n'y en a pas, et la courbe est pleine. */
    if(s.tirets&&s.tirets.length)c.setLineDash(s.tirets);
    c.beginPath();
    for(let i=0;i<f.length;i++){
      const y=fy(s.v[i]);
      if(i)c.lineTo(fx(i),y); else c.moveTo(fx(i),y);
    }
    c.stroke();
    c.restore();
  }

  /* La résonance, marquée : c'est le seul point qu'on relit toujours. */
  const r=antRes();
  const i0=r.f.indexOf(r.f0)>=0?r.f.indexOf(r.f0):antPlusProche(r.f,r.f0);
  c.strokeStyle="#e6e8ec"; c.setLineDash([2,3]); c.lineWidth=1;
  c.beginPath(); c.moveTo(fx(i0),y0); c.lineTo(fx(i0),y1); c.stroke();
  c.setLineDash([]);

  /* La cible visée, si elle est dans la plage : l'écart entre les deux traits
     est la question qu'on se pose en ouvrant ce panneau. */
  if(ANT.bande.fcible>=f[0]&&ANT.bande.fcible<=f[f.length-1]){
    const ic=antPlusProche(f,ANT.bande.fcible);
    c.strokeStyle="#f2c744"; c.setLineDash([1,4]);
    c.beginPath(); c.moveTo(fx(ic),y0); c.lineTo(fx(ic),y1); c.stroke();
    c.setLineDash([]);
  }

  const lg=aE("legende");
  /* UNE FAMILLE NE SE LÉGENDE PAS COURBE PAR COURBE : quarante entrées ne se
     lisent pas. Les deux bouts du dégradé suffisent — l'ordre des couleurs
     est l'ordre des valeurs, et le tableau dessous donne les chiffres. */
  if(lg&&famille){
    const bal=antBal();
    /* UN CROISEMENT SE LÉGENDE EN DEUX TEMPS, comme il se dessine : les deux
       bouts du dégradé pour le premier axe, un trait par valeur pour le
       second. C'est cette légende-là qui rend la courbe nommable — sans elle,
       la couleur et le tiret sont deux codes qu'on ne sait pas lire. */
    if(bal.croise){
      const ax=antBalAxes(bal);
      lg.innerHTML=
        '<span><em>'+aEsc(bal.nom)+'</em></span>'+
        '<span><i style="background:'+antBalCouleur(0)+'"></i>'+
          balEtiquette(ax.v1[0])+' '+aEsc(bal.unite)+'</span>'+
        '<span><i style="background:'+antBalCouleur(1)+'"></i>'+
          balEtiquette(ax.v1[ax.v1.length-1])+' '+aEsc(bal.unite)+'</span>'+
        '<span><em>'+aEsc(bal.nom2)+'</em></span>'+
        ax.v2.map(function(v,k){
          const t=ANT_BAL_TIRETS[k%ANT_BAL_TIRETS.length];
          return '<span><i class="tir" style="'+antTiretsCss(t,"#c8ccd4")+
            '"></i>'+balEtiquette(v)+' '+aEsc(bal.unite2)+'</span>';
        }).join("")+
        '<span><i class="trait blanc"></i>résonance du point choisi</span>'+
        '<span><i class="trait jaune"></i>fréquence visée</span>'+
        '<p class="note">La couleur porte « '+aEsc(bal.nom)+' », le trait porte '+
        '« '+aEsc(bal.nom2)+' » : une courbe se nomme en la regardant. Le '+
        'tableau à deux entrées, lui, se lit d\'un coup d\'œil — c\'est par lui '+
        'qu\'on commence.</p>';
      return;
    }
    lg.innerHTML=
      '<span><i style="background:'+antBalCouleur(0)+'"></i>'+
        aEsc(bal.points[0].etiquette)+' '+aEsc(bal.unite)+'</span>'+
      '<span><i style="background:'+antBalCouleur(1)+'"></i>'+
        aEsc(bal.points[bal.points.length-1].etiquette)+' '+aEsc(bal.unite)+'</span>'+
      '<span><i class="trait blanc"></i>résonance du point choisi</span>'+
      '<span><i class="trait jaune"></i>fréquence visée</span>';
    return;
  }
  if(lg)lg.innerHTML=series.map(s=>
      '<span><i style="background:'+s.couleur+'"></i>'+aEsc(s.nom)+
      (s.seuilNom?' <em>· repère '+aEsc(s.seuilNom)+'</em>':"")+'</span>').join("")+
    '<span><i class="trait blanc"></i>résonance</span>'+
    '<span><i class="trait jaune"></i>fréquence visée</span>';
}

function antPlusProche(t,v){
  let k=0,d=Infinity;
  for(let i=0;i<t.length;i++){
    const e=Math.abs(t[i]-v);
    if(e<d){d=e;k=i;}
  }
  return k;
}

/* -------------------------------------------------------------------------
   Le diagramme de rayonnement
   -------------------------------------------------------------------------
   En coordonnées polaires et en décibels, une coupe par valeur de phi. Le
   maximum est ramené à 0 dB : ce qu'on lit sur un diagramme, c'est la FORME
   — où l'antenne émet et où elle n'émet pas —, et le niveau absolu est déjà
   au-dessus, en dBi.
   ------------------------------------------------------------------------- */
function antFfDessiner(c,W,H,nf){
  if(!nf||!nf.e_norm||!nf.e_norm.length){
    c.fillStyle="#8b919c"; c.font='12px system-ui';
    c.fillText("Pas de champ lointain dans ce résultat.",12,24);
    return;
  }
  const PLAGE=40;                      // dB affichés, du centre au bord
  const cx=W/2, cy=H/2, R=Math.min(W,H)/2-22;

  c.strokeStyle="#23262b"; c.fillStyle="#8b919c";
  c.font='10px "JetBrains Mono","SF Mono",Consolas,monospace';
  c.textAlign="center"; c.textBaseline="middle";
  for(let i=1;i<=4;i++){
    const r=R*i/4;
    c.beginPath(); c.arc(cx,cy,r,0,2*Math.PI); c.stroke();
    c.fillText((-PLAGE+PLAGE*i/4).toFixed(0),cx+4,cy-r);
  }
  for(let a=0;a<360;a+=30){
    const t=a*Math.PI/180;
    c.beginPath(); c.moveTo(cx,cy);
    c.lineTo(cx+R*Math.sin(t),cy-R*Math.cos(t)); c.stroke();
    c.fillText(a+"°",cx+(R+13)*Math.sin(t),cy-(R+13)*Math.cos(t));
  }

  const couleurs=["#3fa0ea","#4cc38a","#c07cf0","#f2c744"];
  const th=nf.theta;
  nf.phi.forEach(function(phi,ip){
    const ligne=nf.e_norm[ip];
    if(!ligne)return;
    c.strokeStyle=couleurs[ip%couleurs.length]; c.lineWidth=1.8;
    c.beginPath();
    for(let i=0;i<th.length;i++){
      /* e_norm est un rapport d'amplitudes normalisé à 1 : 20 log, et non 10. */
      const db=20*Math.log10(Math.max(ligne[i],1e-6));
      const r=R*Math.max(0,(db+PLAGE))/PLAGE;
      const t=th[i]*Math.PI/180;
      const x=cx+r*Math.sin(t), y=cy-r*Math.cos(t);
      if(i)c.lineTo(x,y); else c.moveTo(x,y);
    }
    c.stroke();
  });

  const lg=aE("legende");
  if(lg)lg.innerHTML=nf.phi.map((p,i)=>
      '<span><i style="background:'+couleurs[i%couleurs.length]+'"></i>'+
      'plan φ = '+aNb(p,0)+'°</span>').join("")+
    '<span class="note">niveau relatif au maximum, échelle '+PLAGE+' dB ; '+
    'angle θ mesuré depuis le zénith (0° = au-dessus de la carte).</span>';
}

/* =========================================================================
   Exports
   ========================================================================= */
/* Le point exporté est celui qu'on regarde. Sur un balayage, son étiquette
   entre dans le nom du fichier : quarante fichiers nommés « patch-s11.csv »
   dans un même dossier ne s'identifient plus. */
function antSuffixe(){
  const b=antBal();
  if(!b)return "";
  const p=b.points[Math.min(ANT_BAL_POINT,b.points.length-1)];
  return "-"+String(p.etiquette).replace(/[^0-9a-zA-Z,.-]/g,"_");
}

function antExportCsv(){
  const r=antRes();
  if(!r)return;
  const cs=r.couplages||{};
  const noms=Object.keys(cs);
  const l=["frequence_Hz;s11_dB;s11_reel;s11_imag;Z_reel_ohm;Z_imag_ohm;ROE"+
           noms.map(n=>";s"+n+(r.excite||1)+"_dB").join("")];
  for(let i=0;i<r.f.length;i++)
    l.push([r.f[i],r.s11_db[i],r.s11_re[i],r.s11_im[i],
            r.z_re[i],r.z_im[i],r.vswr[i]]
           .concat(noms.map(n=>cs[n].db[i]))
           .map(v=>String(v).replace(".",",")).join(";"));
  telecharger(new Blob([l.join("\r\n")],{type:"text/csv;charset=utf-8"}),
              nomBase()+antSuffixe()+"-s11.csv");
}

/* Touchstone à un port. Le format exige que l'en-tête dise l'unité, le
   paramètre, le format et l'impédance de référence : un .s1p sans sa ligne
   « # » est illisible par tout le monde, y compris par celui qui l'a écrit.

   POURQUOI CELUI-CI S'ARRÊTE À UN PORT. Un fichier à deux ports déclare les
   QUATRE paramètres — S11, S12, S21, S22 —, et UNE simulation n'en rend que
   deux : ceux du port excité. Écrire un .s2p en remplissant les cases
   manquantes de zéros produirait un fichier que tous les outils liraient sans
   broncher, et dont la moitié serait inventée.

   C'EST LE TABLEAU S COMPLET QUI LE REND POSSIBLE, et lui seul : il enchaîne
   une simulation par port et remplit toutes les cases. L'export .sNp vit donc
   dans 29-tableau-s.js, avec ce qui le remplit, et le bouton ci-contre prend
   sa place dès qu'un tableau est là. Sans tableau, le couplage part dans le
   .csv, où il est nommé pour ce qu'il est. */
function antExportS1p(){
  const r=antRes();
  if(!r)return;
  const p=antPortExcite();
  const l=[
    "! Antenne openEMS — "+(V.fichier||"antenne"),
    "! "+new Date().toISOString(),
    "! port "+(p.type==="coaxial"?"coaxial":"localise")+" "+p.de+" -> "+p.a+
      ", R = "+p.R+" ohms",
    "# HZ S RI R "+p.R
  ];
  const b=antBal();
  if(b){
    const pt=b.points[Math.min(ANT_BAL_POINT,b.points.length-1)];
    l.splice(2,0,"! balayage : "+b.nom+" = "+pt.etiquette+" "+b.unite);
  }
  if(r.couplages)
    l.splice(2,0,"! un seul port est decrit ici : une simulation ne rend que "+
                 "la colonne du port excite");
  for(let i=0;i<r.f.length;i++)
    l.push([r.f[i],r.s11_re[i],r.s11_im[i]].join("  "));
  telecharger(new Blob([l.join("\r\n")],{type:"text/plain;charset=utf-8"}),
              nomBase()+antSuffixe()+".s1p");
}
