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

/* L'état interactif de la sonde, des marqueurs et du zoom sur les courbes. */
let ANT_COURBE_ETAT={
  survol:false,
  k:null,           // indice du point sous la sonde (0 .. f.length-1)
  x:null,           // position pixel en X
  y:null,           // position pixel en Y
  m1:null,          // indice du marqueur M1 posé
  m2:null,          // indice du marqueur M2 posé
  zoom:null,        // { k0, k1 } ou null si zoom 100%
  glisse:null,      // { downX, downY, moved, k0, k1 } lors du déplacement
  polarSurvol:false,
  polarAngle:null,  // angle theta en degrés
  polarR:null
};

/* Indice dans f de la résonance f0. */
function antIndexF0(){
  const r=antRes();
  if(!r||!r.f||!r.f.length)return 0;
  if(r.f0==null)return 0;
  const i0=r.f.indexOf(r.f0);
  return (i0>=0)?i0:antPlusProche(r.f,r.f0);
}


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
      /* LE CHEMIN LE PLUS COURT ENTRE UN S11 ET SON EXPLICATION. C'est en
         regardant la courbe qu'on se demande POURQUOI elle a cette tête, et
         le bouton doit être là, pas trois panneaux plus loin. Il n'apparaît
         que si ce calcul a effectivement enregistré des champs. */
      ((ANT.modele&&ANT.modele.dumps&&ANT.modele.dumps.actif
        &&typeof chpOuvrir==="function")
        ?'<button class="tb mini" id="bChampsRes" title="La carte du courant et du champ, animée">🎞 Champs</button>':"")+
      '<button class="tb mini" id="bRapportRes" title="Générer un rapport d\'ingénierie complet : résultats, empilage, géométrie, maillage et diagnostic des anomalies">📋 Rapport</button>'+
      '<button class="tb mini" id="bCsv">⤓ .csv</button>'+
      (ts?'<button class="tb mini" id="bSnp">⤓ .s'+ts.ports.length+
           'p</button>'
          :'<button class="tb mini" id="bS1p">⤓ .s1p</button>')+
    '</div>'+
    '<div class="courbe-cadre">'+
      '<canvas id="courbe" tabindex="0" title="Survol : sonder · Clic : poser M1/M2 · Molette : zoomer · Glisser : défiler · Flèches : pas à pas"></canvas>'+
      '<div class="courbe-barre" id="courbeBarre"></div>'+
    '</div>'+
    '<div class="legende" id="legende"></div>'+
    (bal?(bal.croise?antBalMatrice(bal):antBalTableau(bal)):"")+
    (ts?antTsTableau(ts):"");

  // Sécuriser les indices de marqueurs par rapport aux données actuelles
  const curF = r ? r.f : null;
  if(!curF || ANT_COURBE_ETAT.m1 >= curF.length) ANT_COURBE_ETAT.m1 = null;
  if(!curF || ANT_COURBE_ETAT.m2 >= curF.length) ANT_COURBE_ETAT.m2 = null;
  if(!curF || (ANT_COURBE_ETAT.zoom && ANT_COURBE_ETAT.zoom.k1 >= curF.length)) ANT_COURBE_ETAT.zoom = null;
  if(!curF || ANT_COURBE_ETAT.k >= curF.length) ANT_COURBE_ETAT.k = null;

  if(box.querySelectorAll){
    box.querySelectorAll("[data-ong]").forEach(function(b){
      b.onclick=function(){
        ANT_ONGLET=b.dataset.ong;
        ANT_COURBE_ETAT.survol=false;
        ANT_COURBE_ETAT.polarSurvol=false;
        antResultatsRendre();
      };
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
  }
  if(box.querySelector){
    const bRap=box.querySelector("#bRapportRes");
    if(bRap)bRap.onclick=function(){ if(typeof rapOuvrir==="function")rapOuvrir(); };
    const bChp=box.querySelector("#bChampsRes");
    if(bChp)bChp.onclick=function(){ chpOuvrir(true); };
    const bCsv=box.querySelector("#bCsv");
    if(bCsv)bCsv.onclick=antExportCsv;
    const b1p=box.querySelector("#bS1p");
    if(b1p)b1p.onclick=antExportS1p;
    const bnp=box.querySelector("#bSnp");
    if(bnp)bnp.onclick=antExportSnp;
  }

  const cv=aE("courbe");
  if(cv)antCourbeEcouteursAttacher(cv);
  antCourbeDessiner();
  antCourbeBarreMettreAJour();
}

/* LA FIN D'UN CALCUL SE VOIT. La section « Résultats » reparaît si elle était
   fermée, se déplie si elle était repliée, et s'allume un instant — sans
   changer de place (wsReveler, js/90-workspace.js). Rien quand le calcul n'a
   rien rendu : c'est alors le journal qui a quelque chose à dire. */
function antResultatsReveler(){
  if(ANT.resultat&&typeof wsReveler==="function")wsReveler("resultats");
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
      "Cochez « Calculer le diagramme de rayonnement » à l'étape 7."});
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
  if(!cv||!r||typeof cv.getContext!=="function")return;
  const dpr=Math.min(2,window.devicePixelRatio||1);
  const cont=aE("resultats")||cv.parentElement;
  const box=(cont&&typeof cont.getBoundingClientRect==="function")
            ?cont.getBoundingClientRect():{width:400,height:300};
  const pw=(cv.parentElement&&typeof cv.parentElement.getBoundingClientRect==="function")
           ?cv.parentElement.getBoundingClientRect().width:box.width;
  const W=Math.max(200,Math.floor((pw>10?pw:box.width)-2)),
        H=Math.max(160,Math.min(360,Math.round((box.height||300)*0.5)));
  if(cv.style){ cv.style.width=W+"px"; cv.style.height=H+"px"; }
  cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr);
  const c=cv.getContext("2d");
  if(!c)return;
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
  if(!f||!f.length||!series||!series.length)return;
  const G={g:52,d:14,h:14,b:28};
  const x0=G.g, x1=W-G.d, y0=G.h, y1=H-G.b;

  const N=f.length;
  let k0=0, k1=N-1;
  if(ANT_COURBE_ETAT.zoom && N>2){
    k0=Math.max(0,Math.min(N-2,ANT_COURBE_ETAT.zoom.k0));
    k1=Math.max(k0+1,Math.min(N-1,ANT_COURBE_ETAT.zoom.k1));
  }

  let vmin=Infinity,vmax=-Infinity;
  for(const s of series){
    const i0=Math.max(0,k0), i1=Math.min(s.v.length-1,k1);
    for(let i=i0;i<=i1;i++){
      const v=s.v[i];
      if(v<vmin)vmin=v;
      if(v>vmax)vmax=v;
    }
  }
  for(const s of series)
    if(s.seuil!=null){ vmin=Math.min(vmin,s.seuil); vmax=Math.max(vmax,s.seuil); }
  /* Le ROE monte à l'infini là où l'antenne n'est pas adaptée : le laisser
     fixer l'échelle écraserait la seule partie qui nous intéresse. */
  if(ANT_ONGLET==="roe")vmax=Math.min(vmax,10);
  if(ANT_ONGLET==="z"){ vmin=Math.max(vmin,-400); vmax=Math.min(vmax,400); }
  if(!(vmax>vmin)){vmax=vmin+1;}
  const marge=(vmax-vmin)*0.08; vmin-=marge; vmax+=marge;

  const fx=function(i){ return x0+(x1-x0)*(i-k0)/Math.max(1,k1-k0); };
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
    const k=Math.round(k0+(k1-k0)*i/4), x=fx(k);
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

  /* Tracé des courbes clipsé dans la zone graphique */
  c.save();
  c.beginPath();
  c.rect(x0,y0,x1-x0,y1-y0);
  c.clip();

  for(const s of series){
    c.save();
    c.strokeStyle=s.couleur; c.lineWidth=s.epais||1.8;
    if(s.tirets&&s.tirets.length)c.setLineDash(s.tirets);
    c.beginPath();
    const iStart=Math.max(0,k0-1), iEnd=Math.min(s.v.length-1,k1+1);
    for(let i=iStart;i<=iEnd;i++){
      const y=fy(s.v[i]), x=fx(i);
      if(i===iStart)c.moveTo(x,y); else c.lineTo(x,y);
    }
    c.stroke();
    c.restore();
  }
  c.restore();

  /* La résonance, marquée : c'est le seul point qu'on relit toujours. */
  const r=antRes();
  const i0=(r&&r.f)?(r.f.indexOf(r.f0)>=0?r.f.indexOf(r.f0):antPlusProche(r.f,r.f0)):-1;
  if(i0>=k0&&i0<=k1){
    c.strokeStyle="#e6e8ec"; c.setLineDash([2,3]); c.lineWidth=1;
    c.beginPath(); c.moveTo(fx(i0),y0); c.lineTo(fx(i0),y1); c.stroke();
    c.setLineDash([]);
  }

  /* La cible visée, si elle est dans la plage visible */
  if(ANT.bande.fcible>=f[k0]&&ANT.bande.fcible<=f[k1]){
    const ic=antPlusProche(f,ANT.bande.fcible);
    c.strokeStyle="#f2c744"; c.setLineDash([1,4]);
    c.beginPath(); c.moveTo(fx(ic),y0); c.lineTo(fx(ic),y1); c.stroke();
    c.setLineDash([]);
  }

  /* --- INTERACTION : Marqueurs M1/M2, Delta, Sonde et Infobulle HUD --- */
  const m1=ANT_COURBE_ETAT.m1, m2=ANT_COURBE_ETAT.m2;

  // Zone d'écart ombrée si deux marqueurs sont posés
  if(m1!=null&&m2!=null&&m1<f.length&&m2<f.length){
    const xM1=fx(m1), xM2=fx(m2);
    const xL=Math.max(x0,Math.min(xM1,xM2)), xR=Math.min(x1,Math.max(xM1,xM2));
    if(xR>xL){
      c.save();
      c.fillStyle="rgba(242, 199, 68, 0.09)";
      c.fillRect(xL,y0,xR-xL,y1-y0);
      c.restore();
    }
  }

  // Marqueur M1
  if(m1!=null&&m1>=0&&m1<f.length){
    antCartesienDessinerMarqueur(c,m1,"M1","#f2c744",fx,fy,series,x0,x1,y0,y1,k0,k1);
  }

  // Marqueur M2
  if(m2!=null&&m2>=0&&m2<f.length){
    antCartesienDessinerMarqueur(c,m2,"M2","#3fa0ea",fx,fy,series,x0,x1,y0,y1,k0,k1);
  }

  // Réticule de survol (sonde dynamique)
  const survolK=ANT_COURBE_ETAT.survol?ANT_COURBE_ETAT.k:null;
  if(survolK!=null&&survolK>=k0&&survolK<=k1&&survolK<f.length){
    const xk=fx(survolK);
    c.save();
    c.strokeStyle="rgba(138, 240, 255, 0.65)";
    c.setLineDash([3,2]);
    c.lineWidth=1;
    c.beginPath(); c.moveTo(xk,y0); c.lineTo(xk,y1); c.stroke();

    // Pastilles lumineuses sur chaque série
    for(const s of series){
      if(survolK<s.v.length){
        const yk=fy(s.v[survolK]);
        c.fillStyle=s.couleur;
        c.beginPath(); c.arc(xk,yk,3.5,0,2*Math.PI); c.fill();
        c.strokeStyle="#ffffff"; c.lineWidth=1.2; c.setLineDash([]);
        c.beginPath(); c.arc(xk,yk,3.5,0,2*Math.PI); c.stroke();
      }
    }

    // Étiquette fréquence en bas de la ligne
    const txtF=aF(f[survolK]);
    c.font='9.5px "JetBrains Mono",monospace';
    const tw=c.measureText(txtF).width;
    const tagX=Math.max(x0,Math.min(x1-tw-10,xk-tw/2-5));
    c.fillStyle="#0f1012";
    c.fillRect(tagX,y1+2,tw+10,15);
    c.strokeStyle="#8af0ff"; c.lineWidth=1; c.setLineDash([]);
    c.strokeRect(tagX,y1+2,tw+10,15);
    c.fillStyle="#8af0ff";
    c.textAlign="center"; c.textBaseline="middle";
    c.fillText(txtF,tagX+(tw+10)/2,y1+9);
    c.restore();
  }

  // Infobulle HUD incrustée
  const hudK=(survolK!=null)?survolK:((m1!=null&&m1<f.length)?m1:null);
  if(hudK!=null){
    antCartesienDessinerHud(c,hudK,f,series,fx,fy,x0,x1,y0,y1,famille);
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

/* Dessine un marqueur M1 ou M2 sur le graphique cartésien */
function antCartesienDessinerMarqueur(c,k,nom,couleur,fx,fy,series,x0,x1,y0,y1,k0,k1){
  if(k<k0||k>k1)return;
  const x=fx(k);
  c.save();
  c.strokeStyle=couleur;
  c.setLineDash([4,2]);
  c.lineWidth=1.2;
  c.beginPath(); c.moveTo(x,y0); c.lineTo(x,y1); c.stroke();

  for(const s of series){
    if(k<s.v.length){
      const y=fy(s.v[k]);
      c.fillStyle=couleur;
      c.beginPath(); c.arc(x,y,4,0,2*Math.PI); c.fill();
      c.strokeStyle="#ffffff"; c.lineWidth=1.2; c.setLineDash([]);
      c.beginPath(); c.arc(x,y,4,0,2*Math.PI); c.stroke();
    }
  }

  c.fillStyle=couleur;
  c.beginPath();
  if(c.roundRect)c.roundRect(x-11,y0-12,22,12,2);
  else c.rect(x-11,y0-12,22,12);
  c.fill();
  c.fillStyle="#0f1012";
  c.font='bold 8.5px "JetBrains Mono",monospace';
  c.textAlign="center";
  c.textBaseline="middle";
  c.fillText(nom,x,y0-6);
  c.restore();
}

/* Dessine l'infobulle HUD flottante dans le coin opposé au curseur */
function antCartesienDessinerHud(c,k,f,series,fx,fy,x0,x1,y0,y1,famille){
  const r=antRes();
  if(!r)return;
  const titre=aF(f[k]);
  const lignes=[];

  if(ANT_ONGLET==="s11"){
    if(r.s11_db&&k<r.s11_db.length){
      lignes.push({label:"S₁₁",val:aNb(r.s11_db[k],2)+" dB",couleur:"#3fa0ea"});
    }
    if(r.s11_re&&r.s11_im&&k<r.s11_re.length){
      const re=r.s11_re[k], im=r.s11_im[k];
      const mod=Math.hypot(re,im);
      const ang=Math.atan2(im,re)*180/Math.PI;
      lignes.push({label:"|Γ|",val:aNb(mod,3)+" ∠ "+aNb(ang,1)+"°",couleur:"#8b919c"});
    }
    if(r.vswr&&k<r.vswr.length){
      lignes.push({label:"ROE",val:aNb(r.vswr[k],2),couleur:"#f2c744"});
    }
  } else if(ANT_ONGLET==="z"){
    if(r.z_re&&k<r.z_re.length){
      lignes.push({label:"R (réel)",val:aNb(r.z_re[k],1)+" Ω",couleur:"#4cc38a"});
    }
    if(r.z_im&&k<r.z_im.length){
      lignes.push({label:"X (imag)",val:aNb(r.z_im[k],1)+" Ω",couleur:"#c07cf0"});
    }
    if(r.z_re&&r.z_im&&k<r.z_re.length){
      lignes.push({label:"|Z|",val:aNb(Math.hypot(r.z_re[k],r.z_im[k]),1)+" Ω",couleur:"#8af0ff"});
    }
  } else if(ANT_ONGLET==="roe"){
    if(r.vswr&&k<r.vswr.length){
      lignes.push({label:"ROE",val:aNb(r.vswr[k],2),couleur:"#f2c744"});
    }
    if(r.s11_db&&k<r.s11_db.length){
      lignes.push({label:"S₁₁",val:aNb(r.s11_db[k],2)+" dB",couleur:"#3fa0ea"});
    }
  } else if(ANT_ONGLET==="bal"){
    const bal=antBal();
    if(bal&&bal.points&&bal.points.length){
      const ptSel=bal.points[Math.min(ANT_BAL_POINT,bal.points.length-1)];
      if(ptSel&&ptSel.resultat&&ptSel.resultat.s11_db&&k<ptSel.resultat.s11_db.length){
        lignes.push({label:"Choisi ("+ptSel.etiquette+")",
                     val:aNb(ptSel.resultat.s11_db[k],2)+" dB",
                     couleur:"#f2c744"});
      }
      if(ANT_COURBE_ETAT.survol&&ANT_COURBE_ETAT.y!=null){
        let bestPt=null, bestDist=Infinity;
        for(let pi=0;pi<bal.points.length;pi++){
          const p=bal.points[pi];
          if(!p.resultat||!p.resultat.s11_db||k>=p.resultat.s11_db.length)continue;
          const yPt=fy(p.resultat.s11_db[k]);
          const d=Math.abs(ANT_COURBE_ETAT.y-yPt);
          if(d<bestDist){ bestDist=d; bestPt=p; }
        }
        if(bestPt&&bestPt!==ptSel&&bestDist<25){
          lignes.push({label:"Survol ("+bestPt.etiquette+")",
                       val:aNb(bestPt.resultat.s11_db[k],2)+" dB",
                       couleur:"#8af0ff"});
        }
      }
    }
  } else {
    for(const s of series){
      if(k<s.v.length){
        lignes.push({label:s.nom,val:aNb(s.v[k],2)+" dB",couleur:s.couleur});
      }
    }
  }

  if(!lignes.length)return;

  c.save();
  c.font='9.5px "JetBrains Mono","SF Mono",Consolas,monospace';
  let maxW=c.measureText(titre).width;
  for(const l of lignes){
    const w=c.measureText(l.label+": "+l.val).width+18;
    if(w>maxW)maxW=w;
  }
  const padH=8, padV=6, lineH=14;
  const boxW=Math.max(130,Math.ceil(maxW+padH*2));
  const boxH=padV*2+(lignes.length+1)*lineH;

  const xk=fx(k);
  let hx=(xk>(x0+x1)/2)?(x0+8):(x1-boxW-8);
  let hy=y0+6;

  c.fillStyle="rgba(16, 18, 20, 0.92)";
  c.strokeStyle="#3a3e46";
  c.lineWidth=1;
  c.beginPath();
  if(c.roundRect)c.roundRect(hx,hy,boxW,boxH,4);
  else c.rect(hx,hy,boxW,boxH);
  c.fill();
  c.stroke();

  c.fillStyle="#f2c744";
  c.textAlign="left";
  c.textBaseline="top";
  c.fillText(titre,hx+padH,hy+padV);

  let cy=hy+padV+lineH;
  for(const l of lignes){
    if(l.couleur){
      c.fillStyle=l.couleur;
      c.beginPath(); c.arc(hx+padH+3,cy+5,2.5,0,2*Math.PI); c.fill();
    }
    c.fillStyle="#8b919c";
    c.fillText(l.label+":",hx+padH+(l.couleur?10:0),cy);
    c.fillStyle="#e6e8ec";
    c.textAlign="right";
    c.fillText(l.val,hx+boxW-padH,cy);
    c.textAlign="left";
    cy+=lineH;
  }
  c.restore();
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

  // Exploration interactive du diagramme polaire
  if(ANT_COURBE_ETAT.polarSurvol&&ANT_COURBE_ETAT.polarAngle!=null){
    const angleDeg=((Math.round(ANT_COURBE_ETAT.polarAngle)%360)+360)%360;
    const tRad=angleDeg*Math.PI/180;

    c.save();
    c.strokeStyle="rgba(138, 240, 255, 0.75)";
    c.lineWidth=1.2;
    c.setLineDash([3,2]);
    c.beginPath();
    c.moveTo(cx,cy);
    c.lineTo(cx+(R+12)*Math.sin(tRad),cy-(R+12)*Math.cos(tRad));
    c.stroke();

    const iTheta=antPlusProche(th,angleDeg);
    const hudLignes=[];

    nf.phi.forEach(function(phi,ip){
      const ligne=nf.e_norm[ip];
      if(!ligne)return;
      const db=20*Math.log10(Math.max(ligne[iTheta],1e-6));
      const rDot=R*Math.max(0,(db+PLAGE))/PLAGE;
      const xDot=cx+rDot*Math.sin(tRad), yDot=cy-rDot*Math.cos(tRad);

      c.fillStyle=couleurs[ip%couleurs.length];
      c.beginPath(); c.arc(xDot,yDot,4,0,2*Math.PI); c.fill();
      c.strokeStyle="#ffffff"; c.lineWidth=1.2; c.setLineDash([]);
      c.beginPath(); c.arc(xDot,yDot,4,0,2*Math.PI); c.stroke();

      hudLignes.push({label:"φ = "+aNb(phi,0)+"°",
                      val:aNb(db,1)+" dB",
                      couleur:couleurs[ip%couleurs.length]});
    });

    if(hudLignes.length){
      const titrePolaire="θ = "+angleDeg+"° (zénith = 0°)";
      c.font='9.5px "JetBrains Mono","SF Mono",Consolas,monospace';
      let maxW=c.measureText(titrePolaire).width;
      for(const l of hudLignes){
        const w=c.measureText(l.label+": "+l.val).width+18;
        if(w>maxW)maxW=w;
      }
      const padH=8, padV=6, lineH=14;
      const boxW=Math.max(130,Math.ceil(maxW+padH*2));
      const boxH=padV*2+(hudLignes.length+1)*lineH;

      const hx=10, hy=10;
      c.fillStyle="rgba(16, 18, 20, 0.92)";
      c.strokeStyle="#3a3e46";
      c.lineWidth=1;
      c.beginPath();
      if(c.roundRect)c.roundRect(hx,hy,boxW,boxH,4);
      else c.rect(hx,hy,boxW,boxH);
      c.fill();
      c.stroke();

      c.fillStyle="#8af0ff";
      c.textAlign="left";
      c.textBaseline="top";
      c.fillText(titrePolaire,hx+padH,hy+padV);

      let cyLine=hy+padV+lineH;
      for(const l of hudLignes){
        c.fillStyle=l.couleur;
        c.beginPath(); c.arc(hx+padH+3,cyLine+5,2.5,0,2*Math.PI); c.fill();
        c.fillStyle="#8b919c";
        c.fillText(l.label+":",hx+padH+10,cyLine);
        c.fillStyle="#e6e8ec";
        c.textAlign="right";
        c.fillText(l.val,hx+boxW-padH,cyLine);
        c.textAlign="left";
        cyLine+=lineH;
      }
    }
    c.restore();
  }

  const lg=aE("legende");
  if(lg)lg.innerHTML=nf.phi.map((p,i)=>
      '<span><i style="background:'+couleurs[i%couleurs.length]+'"></i>'+
      'plan φ = '+aNb(p,0)+'°</span>').join("")+
    '<span class="note">niveau relatif au maximum, échelle '+PLAGE+' dB ; '+
    'angle θ mesuré depuis le zénith (0° = au-dessus de la carte).</span>';
}

/* =========================================================================
   Écouteurs et barre d'interaction de la courbe
   ========================================================================= */
function antCourbeEcouteursAttacher(cv){
  if(!cv)return;

  if(typeof ResizeObserver==="function"&&!cv._ro){
    cv._ro=new ResizeObserver(function(){ antCourbeDessiner(); });
    if(cv.parentElement)cv._ro.observe(cv.parentElement);
  }

  cv.onpointermove=function(e){
    const r=antRes();
    if(!r)return;
    const rect=cv.getBoundingClientRect();
    const px=e.clientX-rect.left, py=e.clientY-rect.top;
    const W=rect.width, H=rect.height;

    if(ANT_ONGLET==="ff"){
      const cx=W/2, cy=H/2, R=Math.min(W,H)/2-22;
      const dx=px-cx, dy=py-cy;
      const dist=Math.hypot(dx,dy);
      if(dist<=R+25){
        let t=Math.atan2(dx,-dy);
        if(t<0)t+=2*Math.PI;
        ANT_COURBE_ETAT.polarSurvol=true;
        ANT_COURBE_ETAT.polarAngle=t*180/Math.PI;
        ANT_COURBE_ETAT.polarR=dist;
      } else {
        ANT_COURBE_ETAT.polarSurvol=false;
      }
      antCourbeDessiner();
      antCourbeBarreMettreAJour();
      return;
    }

    const f=(ANT_ONGLET==="ts"&&typeof antTs==="function"&&antTs())?antTs().f:r.f;
    if(!f||!f.length)return;
    const G={g:52,d:14,h:14,b:28};
    const x0=G.g, x1=W-G.d, y0=G.h, y1=H-G.b;

    if(ANT_COURBE_ETAT.glisse){
      const dx=px-ANT_COURBE_ETAT.glisse.downX;
      if(Math.abs(dx)>3)ANT_COURBE_ETAT.glisse.moved=true;
      if(ANT_COURBE_ETAT.zoom){
        const span=ANT_COURBE_ETAT.glisse.k1-ANT_COURBE_ETAT.glisse.k0;
        const deltaK=Math.round(-dx/Math.max(1,x1-x0)*span);
        let newK0=ANT_COURBE_ETAT.glisse.k0+deltaK;
        let newK1=ANT_COURBE_ETAT.glisse.k1+deltaK;
        if(newK0<0){ newK1-=newK0; newK0=0; }
        if(newK1>=f.length){ newK0-=(newK1-(f.length-1)); newK1=f.length-1; }
        newK0=Math.max(0,newK0); newK1=Math.min(f.length-1,newK1);
        ANT_COURBE_ETAT.zoom={k0:newK0, k1:newK1};
        antCourbeDessiner();
        antCourbeBarreMettreAJour();
        return;
      }
    }

    if(px>=x0&&px<=x1&&py>=y0&&py<=y1){
      ANT_COURBE_ETAT.survol=true;
      ANT_COURBE_ETAT.x=px;
      ANT_COURBE_ETAT.y=py;
      const k0=ANT_COURBE_ETAT.zoom?ANT_COURBE_ETAT.zoom.k0:0;
      const k1=ANT_COURBE_ETAT.zoom?ANT_COURBE_ETAT.zoom.k1:f.length-1;
      const ratio=Math.max(0,Math.min(1,(px-x0)/Math.max(1,x1-x0)));
      ANT_COURBE_ETAT.k=Math.max(0,Math.min(f.length-1,Math.round(k0+ratio*(k1-k0))));
    } else {
      ANT_COURBE_ETAT.survol=false;
    }
    antCourbeDessiner();
    antCourbeBarreMettreAJour();
  };

  cv.onpointerleave=function(){
    ANT_COURBE_ETAT.survol=false;
    ANT_COURBE_ETAT.polarSurvol=false;
    ANT_COURBE_ETAT.glisse=null;
    cv.classList.remove("glisse");
    antCourbeDessiner();
    antCourbeBarreMettreAJour();
  };

  cv.onpointerdown=function(e){
    cv.focus();
    const rect=cv.getBoundingClientRect();
    const px=e.clientX-rect.left, py=e.clientY-rect.top;
    const r=antRes();
    const f=(ANT_ONGLET==="ts"&&typeof antTs==="function"&&antTs())?antTs().f:(r?r.f:null);
    ANT_COURBE_ETAT.glisse={
      downX:px, downY:py, moved:false,
      k0:ANT_COURBE_ETAT.zoom?ANT_COURBE_ETAT.zoom.k0:0,
      k1:ANT_COURBE_ETAT.zoom?ANT_COURBE_ETAT.zoom.k1:(f?f.length-1:0)
    };
    if(ANT_COURBE_ETAT.zoom)cv.classList.add("glisse");
  };

  cv.onpointerup=function(){
    if(ANT_COURBE_ETAT.glisse&&!ANT_COURBE_ETAT.glisse.moved){
      if(ANT_COURBE_ETAT.k!=null){
        if(ANT_COURBE_ETAT.m1==null){
          ANT_COURBE_ETAT.m1=ANT_COURBE_ETAT.k;
        } else if(ANT_COURBE_ETAT.m2==null){
          if(ANT_COURBE_ETAT.k!==ANT_COURBE_ETAT.m1){
            ANT_COURBE_ETAT.m2=ANT_COURBE_ETAT.k;
          }
        } else {
          ANT_COURBE_ETAT.m1=ANT_COURBE_ETAT.k;
          ANT_COURBE_ETAT.m2=null;
        }
      }
    }
    ANT_COURBE_ETAT.glisse=null;
    cv.classList.remove("glisse");
    antCourbeDessiner();
    antCourbeBarreMettreAJour();
  };

  cv.onwheel=function(e){
    if(ANT_ONGLET==="ff")return;
    const r=antRes();
    const f=(ANT_ONGLET==="ts"&&typeof antTs==="function"&&antTs())?antTs().f:(r?r.f:null);
    if(!f||f.length<4)return;
    e.preventDefault();

    const rect=cv.getBoundingClientRect();
    const px=e.clientX-rect.left;
    const G={g:52,d:14,h:14,b:28};
    const x0=G.g, x1=rect.width-G.d;
    const k0=ANT_COURBE_ETAT.zoom?ANT_COURBE_ETAT.zoom.k0:0;
    const k1=ANT_COURBE_ETAT.zoom?ANT_COURBE_ETAT.zoom.k1:f.length-1;

    const ratio=Math.max(0,Math.min(1,(px-x0)/Math.max(1,x1-x0)));
    const kCenter=k0+ratio*(k1-k0);

    const factor=e.deltaY<0?0.75:1.35;
    const currentSpan=k1-k0;
    const newSpan=Math.max(4,Math.min(f.length-1,currentSpan*factor));

    if(newSpan>=f.length-1){
      ANT_COURBE_ETAT.zoom=null;
    } else {
      let newK0=Math.round(kCenter-ratio*newSpan);
      let newK1=Math.round(newK0+newSpan);
      if(newK0<0){ newK1-=newK0; newK0=0; }
      if(newK1>=f.length){ newK0-=(newK1-(f.length-1)); newK1=f.length-1; }
      newK0=Math.max(0,newK0); newK1=Math.min(f.length-1,newK1);
      ANT_COURBE_ETAT.zoom={k0:newK0, k1:newK1};
    }
    antCourbeDessiner();
    antCourbeBarreMettreAJour();
  };

  cv.ondblclick=function(){
    if(ANT_COURBE_ETAT.zoom){
      ANT_COURBE_ETAT.zoom=null;
    } else {
      ANT_COURBE_ETAT.m1=null;
      ANT_COURBE_ETAT.m2=null;
    }
    antCourbeDessiner();
    antCourbeBarreMettreAJour();
  };

  cv.onkeydown=function(e){
    const r=antRes();
    const f=(ANT_ONGLET==="ts"&&typeof antTs==="function"&&antTs())?antTs().f:(r?r.f:null);
    if(!f||!f.length)return;

    if(e.key==="ArrowLeft"||e.key==="ArrowRight"){
      e.preventDefault();
      const pas=(e.shiftKey?10:1)*(e.key==="ArrowLeft"?-1:1);
      if(ANT_COURBE_ETAT.m2!=null){
        ANT_COURBE_ETAT.m2=Math.max(0,Math.min(f.length-1,ANT_COURBE_ETAT.m2+pas));
        ANT_COURBE_ETAT.k=ANT_COURBE_ETAT.m2;
      } else if(ANT_COURBE_ETAT.m1!=null){
        ANT_COURBE_ETAT.m1=Math.max(0,Math.min(f.length-1,ANT_COURBE_ETAT.m1+pas));
        ANT_COURBE_ETAT.k=ANT_COURBE_ETAT.m1;
      } else {
        const curK=ANT_COURBE_ETAT.k!=null?ANT_COURBE_ETAT.k:0;
        ANT_COURBE_ETAT.m1=Math.max(0,Math.min(f.length-1,curK+pas));
        ANT_COURBE_ETAT.k=ANT_COURBE_ETAT.m1;
      }
      antCourbeDessiner();
      antCourbeBarreMettreAJour();
    } else if(e.key==="Home"){
      e.preventDefault();
      ANT_COURBE_ETAT.m1=0; ANT_COURBE_ETAT.k=0;
      antCourbeDessiner(); antCourbeBarreMettreAJour();
    } else if(e.key==="End"){
      e.preventDefault();
      ANT_COURBE_ETAT.m1=f.length-1; ANT_COURBE_ETAT.k=f.length-1;
      antCourbeDessiner(); antCourbeBarreMettreAJour();
    } else if(e.key==="m"||e.key==="M"){
      e.preventDefault();
      const i0=antIndexF0();
      ANT_COURBE_ETAT.m1=i0; ANT_COURBE_ETAT.k=i0;
      antCourbeDessiner(); antCourbeBarreMettreAJour();
    } else if(e.key==="Escape"){
      e.preventDefault();
      ANT_COURBE_ETAT.m1=null; ANT_COURBE_ETAT.m2=null; ANT_COURBE_ETAT.zoom=null;
      antCourbeDessiner(); antCourbeBarreMettreAJour();
    }
  };
}

function antCourbeBarreMettreAJour(){
  const barre=aE("courbeBarre");
  if(!barre)return;
  const r=antRes();
  if(!r){ barre.innerHTML=""; return; }

  if(ANT_ONGLET==="ff"){
    let txt="";
    if(ANT_COURBE_ETAT.polarSurvol&&ANT_COURBE_ETAT.polarAngle!=null){
      txt='<span class="courbe-badge">θ = <b>'+Math.round(ANT_COURBE_ETAT.polarAngle)+'°</b></span>';
    } else {
      txt='<span class="courbe-astuce">Survolez le diagramme polaire pour sonder le niveau selon l\'angle θ</span>';
    }
    barre.innerHTML=txt;
    return;
  }

  const f=(ANT_ONGLET==="ts"&&typeof antTs==="function"&&antTs())?antTs().f:r.f;
  if(!f||!f.length){ barre.innerHTML=""; return; }

  const s0=(ANT_ONGLET==="ts"&&typeof antTsSeries==="function"&&antTs())
           ?antTsSeries(antTs())[0]:antSeries(r)[0];
  const unite=(ANT_ONGLETS.find(o=>o.id===ANT_ONGLET)||{}).unite||"";

  const m1=ANT_COURBE_ETAT.m1, m2=ANT_COURBE_ETAT.m2;
  const hBadges=[];

  if(m1!=null&&m1<f.length){
    const v1=(s0&&s0.v&&m1<s0.v.length)?aNb(s0.v[m1],2)+" "+unite:"";
    hBadges.push('<span class="courbe-badge m1" title="Marqueur M1"><b>M1</b> '+aF(f[m1])+(v1?' · '+v1:'')+'</span>');
  }

  if(m2!=null&&m2<f.length){
    const v2=(s0&&s0.v&&m2<s0.v.length)?aNb(s0.v[m2],2)+" "+unite:"";
    hBadges.push('<span class="courbe-badge m2" title="Marqueur M2"><b>M2</b> '+aF(f[m2])+(v2?' · '+v2:'')+'</span>');
  }

  if(m1!=null&&m2!=null&&m1<f.length&&m2<f.length){
    const df=f[m2]-f[m1];
    const dfTxt=(df>=0?"+":"−")+aNb(Math.abs(df)/1e6,2)+" MHz";
    let dyTxt="";
    if(s0&&s0.v&&m1<s0.v.length&&m2<s0.v.length){
      const dy=s0.v[m2]-s0.v[m1];
      dyTxt=" ("+(dy>=0?"+":"−")+aNb(Math.abs(dy),2)+" "+unite+")";
    }
    hBadges.push('<span class="courbe-badge delta" title="Écart entre M1 et M2"><b>Δ</b> '+dfTxt+dyTxt+'</span>');
  }

  if(!hBadges.length){
    if(ANT_COURBE_ETAT.survol&&ANT_COURBE_ETAT.k!=null&&ANT_COURBE_ETAT.k<f.length){
      const k=ANT_COURBE_ETAT.k;
      const v=(s0&&s0.v&&k<s0.v.length)?aNb(s0.v[k],2)+" "+unite:"";
      hBadges.push('<span class="courbe-badge">Sonde : <b>'+aF(f[k])+'</b>'+(v?' · <b>'+v+'</b>':'')+'</span>');
    }
  }

  const hOutils=[];
  hOutils.push('<button class="tb mini" id="bCourbeMin" title="Placer M1 au creux de résonance f₀ (Touche M)">🎯 Min f₀</button>');
  if(m1!=null||m2!=null){
    hOutils.push('<button class="tb mini" id="bCourbeClear" title="Effacer les marqueurs (Échap)">✕ Marqueurs</button>');
  }
  if(ANT_COURBE_ETAT.zoom!=null){
    hOutils.push('<button class="tb mini" id="bCourbeResetZoom" title="Réinitialiser le zoom à 100% (Double-clic)">⤢ 100%</button>');
  }

  barre.innerHTML=
    '<div class="courbe-marqueurs">'+hBadges.join("")+'</div>'+
    '<span class="push"></span>'+
    '<div class="courbe-boutons">'+hOutils.join("")+'</div>'+
    '<span class="courbe-astuce">Clic : M1/M2 · Molette : zoom · Flèches : pas à pas</span>';

  if(barre.querySelector){
    const bMin=barre.querySelector("#bCourbeMin");
    if(bMin)bMin.onclick=function(){
      const i0=antIndexF0();
      ANT_COURBE_ETAT.m1=i0;
      ANT_COURBE_ETAT.k=i0;
      antCourbeDessiner();
      antCourbeBarreMettreAJour();
    };
    const bClear=barre.querySelector("#bCourbeClear");
    if(bClear)bClear.onclick=function(){
      ANT_COURBE_ETAT.m1=null;
      ANT_COURBE_ETAT.m2=null;
      antCourbeDessiner();
      antCourbeBarreMettreAJour();
    };
    const bReset=barre.querySelector("#bCourbeResetZoom");
    if(bReset)bReset.onclick=function(){
      ANT_COURBE_ETAT.zoom=null;
      antCourbeDessiner();
      antCourbeBarreMettreAJour();
    };
  }
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
