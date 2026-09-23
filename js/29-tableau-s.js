"use strict";
/* =============================================================================
   Antenne openEMS — 29-tableau-s.js
   Le tableau S complet : N simulations, l'excitation déplacée d'un port à
   l'autre, et les colonnes rangées ensemble.

   CE QUI MANQUAIT, ET CE QUE CE MODULE N'INVENTE PAS. Une simulation rend UNE
   COLONNE du tableau : le port j excite, on lit ce qui revient en j (son S₁₁)
   et ce qui sort de chaque autre port i (le couplage S(i,j)). C'est la
   définition d'un paramètre S, et ce n'était pas une limite de l'outil — mais
   obtenir le tableau entier demandait de déplacer l'excitation à la main, de
   relancer, et de ranger soi-même les colonnes. Ce module ne calcule donc
   RIEN : il enchaîne, et il assemble.

   CE QUE CELA COÛTE, ET POURQUOI C'EST DIT TROIS FOIS. La durée est
   multipliée par le nombre de ports. Deux ports, c'est deux fois ; quatre,
   c'est quatre fois — et c'est exactement le genre de nuit de calcul qu'on
   lance sans la voir venir. L'annonce le dit avant le clic, le devis le
   confirme, et le journal le répète à chaque colonne.

   POURQUOI LE .sNp EST ICI ET NON DANS 16-resultats.js. Parce que c'est le
   tableau qui le rend possible : un .s2p écrit à partir d'UNE simulation
   aurait la moitié de ses cases inventées, et c'est précisément la raison
   pour laquelle l'export d'hier s'arrêtait au .s1p. Le fichier et ce qui le
   remplit vivent donc ensemble.
   ============================================================================= */

/* ==========================================================================
   Le résultat
   ========================================================================== */
/* Le tableau, s'il y en a un. Il ENVELOPPE un résultat ordinaire — celui de
   la première colonne — plutôt que de le remplacer : tout ce que la page
   sait déjà faire d'un S₁₁, d'une impédance et d'un diagramme continue de
   marcher sans rien savoir du tableau. C'est la même règle que le balayage. */
function antTs(){
  const r=ANT.resultat;
  return (r&&r.tableau_s&&r.s&&r.s.length)?r:null;
}

/* QUELLE COLONNE LES AUTRES ONGLETS MONTRENT. Le tableau range les S₁₁ et les
   couplages de toutes les colonnes ; l'impédance d'entrée, les courbes
   détaillées et surtout le DIAGRAMME DE RAYONNEMENT, eux, appartiennent à UNE
   simulation — celle où tel port émettait. Deux antennes couplées ne rayonnent
   pas de la même façon selon celle qu'on alimente : l'autre est alors une
   charge parasite posée à côté, et c'est même toute la question quand on en
   pose deux. Montrer toujours la première reviendrait à jeter les N−1 autres
   diagrammes, qui sont pourtant déjà calculés.

   Le choix se fait comme au balayage : on clique la colonne. */
let ANT_TS_COL=0;

function antTsColonne(ts){
  return Math.min(Math.max(ANT_TS_COL,0),(ts.colonnes||[]).length-1);
}

/* Le résultat complet de la colonne choisie. Une colonne qui n'a pas abouti
   n'en a pas : on retombe alors sur celui de la première, plutôt que de vider
   tous les onglets d'un coup. */
function antTsResultat(ts){
  const c=(ts.colonnes||[])[antTsColonne(ts)];
  return (c&&c.resultat)||ts.premier||null;
}

/* Une case du tableau : {re,im} ou null quand sa colonne n'a pas abouti. */
function antTsCase(ts,i,j){
  const l=ts.s[i];
  return (l&&l[j])?l[j]:null;
}

function antTsDb(c,k){
  if(!c)return null;
  const m=Math.hypot(c.re[k]||0,c.im[k]||0);
  return 20*Math.log10(Math.max(m,1e-12));
}

/* L'indice de la résonance du port 1 : c'est là qu'on lit le tableau. Le
   prendre sur le premier résultat plutôt que sur chaque case évite de
   comparer des grandeurs prises à des fréquences différentes — un couplage
   à 2,3 GHz et une adaptation à 2,45 GHz ne se lisent pas sur la même ligne. */
function antTsIndexF0(ts){
  const f=ts.f||[];
  const f0=(ts.premier&&ts.premier.f0)||ANT.bande.fcible;
  let best=0, ec=Infinity;
  for(let k=0;k<f.length;k++){
    const d=Math.abs(f[k]-f0);
    if(d<ec){ ec=d; best=k; }
  }
  return best;
}

function antTsComplet(ts){
  const n=ts.ports.length;
  for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(!antTsCase(ts,i,j))return false;
  return true;
}

/* ==========================================================================
   Le panneau de lancement, greffé dans l'étape « Le calcul »
   ========================================================================== */
let ANT_TS_DEVIS=null;

function antTableauSHtml(){
  /* UN SEUL PORT NE FAIT PAS DE TABLEAU : il fait un S₁₁, que le bouton
     « Lancer » rend déjà. Proposer ici un enchaînement d'une simulation
     serait proposer le même calcul sous un autre nom. */
  if(!ANT.ports||ANT.ports.length<2)return "";
  const n=ANT.ports.length;
  const e=ANT.etatServeur;
  const peut=e&&e.lancer;
  const un=(typeof antBalDuree==="function")?antBalDuree():0;
  const d=ANT_TS_DEVIS;
  return `
<div class="champ">
  <label>Le tableau S complet
    <small>Une simulation rend la colonne du port excité : ${antTsRendus()}.
    Les autres colonnes demandent une simulation chacune, l'excitation
    déplacée — c'est la définition d'un paramètre S, pas une limite de
    l'outil. Ce bouton les enchaîne et range les colonnes ensemble.</small>
  </label>
  <div class="recap">
    <span><b>${n}</b> ports, donc <b>${n}</b> simulations</span>
    ${un?'<span>≈ <b>'+antDuree(un*n)+'</b> en tout, contre <b>'+
         antDuree(un)+'</b> pour une seule</span>':""}
  </div>
  <div class="champ actions">
    <button class="tb" id="bTsDevis">∑ Chiffrer le tableau</button>
    <button class="tb on" id="bTsLancer"${peut?"":" disabled"}>▶ Lancer les
      ${n} simulations</button>
  </div>
  ${d?`<div class="recap${d.refus?" ko":""}">
    ${d.refus
      ? '<span>'+aEsc(d.refus)+'</span>'
      : '<span><b>'+aEnt(d.cellules/1e6)+'</b> millions de cellules en tout</span>'+
        '<span>≈ <b>'+antDuree(d.duree)+'</b> de calcul</span>'}
  </div>`:""}
  <p class="note">La géométrie ne change pas d'une colonne à l'autre : seul le
     port qui émet change. Les ${n} colonnes partagent donc le même maillage et
     la même bande — c'est ce qui permet de les ranger dans un même tableau, et
     le serveur le vérifie avant de lancer.${antTsSansBalayage()}</p>
</div>`;
}

/* Le balayage réglé au-dessus ne s'applique PAS au tableau : un tableau S par
   point de balayage serait le produit des deux, et personne ne lance cela sans
   l'avoir demandé deux fois. Dit seulement quand un balayage est armé — une
   phrase qui prévient d'un piège absent est une phrase de trop. */
function antTsSansBalayage(){
  if(!(ANT.balayage&&ANT.balayage.actif))return "";
  return " Le balayage réglé au-dessus n'entre pas ici : un tableau S par "+
         "point de balayage serait le produit des deux.";
}

/* « S₁₁, S₂₁ » — ce qu'UNE simulation rend, écrit en toutes lettres. */
function antTsRendus(){
  const exc=(typeof antPortExcite==="function"&&antPortExcite())||ANT.ports[0];
  return ANT.ports.map(p=>"S<sub>"+p.n+(exc.n||1)+"</sub>").join(", ");
}

function antTableauSLier(box){
  const l=box.querySelector("#bTsLancer");
  if(l&&!l.disabled)l.onclick=antLancerTableauS;
  const d=box.querySelector("#bTsDevis");
  if(d)d.onclick=antTableauSDevis;
}

/* Le devis : ce que le tableau va coûter, chaque colonne vérifiée, sans rien
   lancer. Même vertu que celui du balayage — le refus arrive AVANT
   l'engagement, et non à la troisième colonne une heure plus tard. */
async function antTableauSDevis(){
  ANT_TS_DEVIS=null;
  try{
    const d=await oeTableauS();
    ANT_TS_DEVIS={cellules:d.estimation.cellules, duree:d.estimation.duree_s};
  }catch(e){
    ANT_TS_DEVIS={refus:String(e.message||e).split(String.fromCharCode(10))[0]};
  }
  antAssistantRendre();
}

async function antLancerTableauS(){
  try{
    typeof wsHint==="function"&&wsHint("Vérification des colonnes…");
    await oeLancerTableauS();
  }catch(e){
    typeof wsHint==="function"&&wsHint("Tableau S refusé : "+(e.message||e));
    antAssistantRendre();
    return;
  }
  antAssistantRendre();
  antJournalRendre();
  antBoutonsEtat();
  await oeSuivre(function(){ antJournalRendre(); antBoutonsEtat(); });
  antJournalRendre();
  antBoutonsEtat();
  antResultatsRendre();
  antResultatsReveler();
  antAssistantRendre();
  antBoutonsEtat();
  if(ANT.tache&&ANT.tache.etat==="arrete"){
    typeof wsHint==="function"&&wsHint("Tableau S arrêté. Les fichiers de calcul ont été conservés.");
  }
}

/* ==========================================================================
   Ce que le tableau montre
   ========================================================================== */
/* LA RÉCIPROCITÉ EST LA SEULE VÉRIFICATION INTERNE QUE CE TABLEAU PERMETTE,
   et elle est gratuite. Une structure passive, sans ferrite ni plasma, est
   réciproque : S(i,j) = S(j,i), exactement, par la physique. Les deux moitiés
   du tableau sortent pourtant de deux simulations indépendantes. Leur écart
   ne mesure donc pas l'antenne — il mesure ce que le calcul a perdu en
   route : un maillage trop lâche, une énergie résiduelle trop haute, une PML
   trop proche. Un tableau qui ne se contredit pas ne prouve pas qu'il est
   juste ; un tableau qui se contredit prouve qu'il ne l'est pas. */
function antTsVerdict(ts){
  const rec=ts.reciprocite||{};
  const n=ts.ports.length;
  const rates=(ts.colonnes||[]).filter(c=>c.etat!=="fini");
  const rel=(rec.amplitude>0)?rec.ecart/rec.amplitude:0;
  const dits=[];
  if(rates.length)
    dits.push({rang:"attention",t:rates.length+" colonne"+
      (rates.length>1?"s n'ont":" n'a")+" pas abouti (port "+
      rates.map(c=>c.n).join(", ")+"). Les cases correspondantes sont vides "+
      "et le restent : les remplir de zéros donnerait un tableau que tous les "+
      "outils liraient sans broncher et dont un quart serait inventé."});
  if(rec.ou&&rel>0.1)
    dits.push({rang:"attention",t:"Les deux moitiés du tableau ne coïncident "+
      "pas : "+aEsc(rec.ou)+" diffèrent de "+aNb(100*rel,0)+" % de "+
      "l'amplitude du couplage. Une structure passive est réciproque — cet "+
      "écart vient du calcul, pas de l'antenne. Resserrez le maillage, ou "+
      "descendez le seuil d'énergie résiduelle."});
  else if(rec.ou)
    dits.push({rang:"info",t:"Réciprocité vérifiée : "+aEsc(rec.ou)+
      " coïncident à "+aNb(100*rel,1)+" % près. Les deux moitiés du tableau "+
      "viennent de deux simulations indépendantes ; qu'elles se rejoignent "+
      "est le seul contrôle interne que ce tableau permette."});
  return '<div class="verdict bal">'+
    '<div class="cle"><b>'+n+'×'+n+'</b><span>tableau S complet</span></div>'+
    '<div class="cle"><b>'+(ts.colonnes||[]).filter(c=>c.etat==="fini").length+
      '</b><span>colonne(s) calculée(s)</span></div>'+
    '</div>'+
    (dits.length?'<div class="avis">'+dits.map(d=>
      '<div class="av '+d.rang+'"><span>'+d.t+'</span></div>').join("")+
      '</div>':"");
}

/* Le tableau lui-même, à la résonance. Les décibels en cases, et la diagonale
   mise en valeur : c'est elle qui dit ce qui est adapté, le reste dit ce qui
   fuit d'un port à l'autre. */
function antTsTableau(ts){
  const k=antTsIndexF0(ts);
  const n=ts.ports.length;
  const f=(ts.f||[])[k];
  const sel=antTsColonne(ts);
  let h='<table class="bal-table"><thead><tr><th>à '+aF(f)+'</th>'+
    ts.ports.map((p,j)=>'<th class="'+(j===sel?"on":"")+'" data-tscol="'+j+
      '" title="Voir les courbes et le diagramme de cette colonne">'+
      'excité : port '+p.n+'</th>').join("")+
    '</tr></thead><tbody>';
  for(let i=0;i<n;i++){
    h+='<tr><td><b>reçu : port '+ts.ports[i].n+'</b></td>';
    for(let j=0;j<n;j++){
      const db=antTsDb(antTsCase(ts,i,j),k);
      h+='<td class="'+(j===sel?"on":"")+'" data-tscol="'+j+
        '" title="S'+(i+1)+(j+1)+' — colonne du port '+ts.ports[j].n+'">'+
        (db==null?"—":aNb(db,1)+" dB")+'</td>';
    }
    h+='</tr>';
  }
  return h+'</tbody></table>'+
    '<p class="note">S<sub>ij</sub> : ce qui sort du port <b>i</b> pendant que '+
    'le port <b>j</b> émet, seul. La diagonale est l\'adaptation de chaque '+
    'port ; le reste est le couplage, c\'est-à-dire la puissance qui part '+
    'dans l\'autre antenne au lieu de rayonner.</p>'+
    '<p class="note">Une <b>colonne</b> est une simulation complète. Cliquez-en '+
    'une pour voir la sienne dans les autres onglets : son impédance, ses '+
    'courbes, et surtout son <b>diagramme de rayonnement</b> — deux antennes '+
    'couplées ne rayonnent pas de la même façon selon celle qui émet, l\'autre '+
    'devenant une charge posée à côté. Colonne montrée : <b>port '+
    ts.ports[sel].n+'</b>.</p>';
}

/* Les N² courbes, sur un axe commun. La diagonale en trait épais : c'est ce
   qu'on regarde d'abord, et une famille de seize courbes de même épaisseur ne
   se lit pas. */
function antTsSeries(ts){
  const n=ts.ports.length;
  const out=[];
  for(let i=0;i<n;i++)for(let j=0;j<n;j++){
    const c=antTsCase(ts,i,j);
    if(!c)continue;
    const v=c.re.map((re,k)=>20*Math.log10(
      Math.max(Math.hypot(re,c.im[k]||0),1e-12)));
    out.push({nom:"S"+ts.ports[i].n+ts.ports[j].n, v:v,
              couleur:antTsCouleur(i,j,n), epais:(i===j)?2.4:1.2,
              seuil:(i===0&&j===0)?-10:null,
              seuilNom:(i===0&&j===0)?"−10 dB":null});
  }
  return out;
}

/* La diagonale dans les chaudes, le couplage dans les froides : la position
   dans le tableau se lit dans la couleur, sans passer par la légende. */
function antTsCouleur(i,j,n){
  if(i===j)return antBalCouleur(n>1?i/(n-1):0);
  const t=(n>1)?((i*n+j)%(n*n))/(n*n-1):0;
  return "rgb("+[120,140,170].map((v,k)=>
    Math.round(v+([80,-20,60][k])*t)).join(",")+")";
}

/* ==========================================================================
   Touchstone .sNp
   --------------------------------------------------------------------------
   POURQUOI CE FICHIER N'EXISTAIT PAS AVANT. Un .s2p déclare les QUATRE
   paramètres ; une simulation n'en rend que deux. Le remplir de zéros aurait
   produit un fichier que tous les outils lisent sans broncher et dont la
   moitié est inventée — la pire sorte d'erreur, celle qui ne se voit pas.
   Maintenant que les N colonnes existent, le fichier est complet ou il n'est
   pas écrit.

   L'ORDRE DES COLONNES EST UN PIÈGE, ET IL N'EN A QU'UN. Le format Touchstone
   range la matrice par LIGNES — S11 S12 S13, puis S21 S22 S23… — SAUF pour
   deux ports, où l'ordre historique est S11 S21 S12 S22, c'est-à-dire par
   COLONNES. Ce n'est pas une coquetterie de spécification : un .s2p écrit
   dans l'ordre des lignes échange S12 et S21, et comme les deux sont presque
   égaux sur une structure réciproque, RIEN NE LE MONTRE — sauf sur une
   antenne dont le calcul n'a pas convergé, où l'on croira alors avoir un
   problème de réciprocité qu'on n'a pas.

   UNE SEULE IMPÉDANCE DE RÉFÉRENCE. Touchstone 1.1 n'en déclare qu'une, pour
   tous les ports. Des ports de R différents ne s'écrivent donc pas dans ce
   format sans mentir sur l'un d'eux : l'export est refusé, et il dit pourquoi.
   ========================================================================== */
function antExportSnp(){
  const ts=antTs();
  if(!ts)return;
  const n=ts.ports.length;

  if(!antTsComplet(ts)){
    typeof wsHint==="function"&&wsHint(
      "Export .s"+n+"p impossible : le tableau est incomplet. Une colonne n'a "+
      "pas abouti, et un fichier Touchstone à cases vides n'existe pas — "+
      "celles-ci seraient lues comme des zéros.");
    return;
  }
  const R=ts.ports[0].R;
  if(ts.ports.some(p=>Math.abs(p.R-R)>1e-9)){
    typeof wsHint==="function"&&wsHint(
      "Export .s"+n+"p impossible : les ports n'ont pas la même impédance de "+
      "référence ("+ts.ports.map(p=>p.R+" Ω").join(", ")+"). Le format "+
      "Touchstone n'en déclare qu'une, pour tous les ports : le fichier "+
      "mentirait sur les autres.");
    return;
  }

  const l=[
    "! Antenne openEMS — "+(V.fichier||"antenne"),
    "! "+new Date().toISOString(),
    "! tableau S complet : "+n+" simulations, l'excitation deplacee d'un port "+
      "a l'autre",
    "! "+ts.ports.map(p=>"port "+p.n+" : "+p.type+", R = "+p.R+" ohms").join(" | "),
  ];
  const rec=ts.reciprocite||{};
  if(rec.ou)
    l.push("! reciprocite : "+rec.ou+" different de "+
           rec.ecart.toExponential(2)+" en amplitude lineaire");
  l.push("# HZ S RI R "+R);
  if(n===2)
    l.push("! deux ports : l'ordre Touchstone est S11 S21 S12 S22");

  const cell=(i,j,k)=>{
    const c=antTsCase(ts,i,j);
    return [antTsNb(c.re[k]),antTsNb(c.im[k])];
  };

  for(let k=0;k<ts.f.length;k++){
    if(n===1){
      l.push([antTsFreq(ts.f[k])].concat(cell(0,0,k)).join("  "));
    }else if(n===2){
      /* L'exception historique : par colonnes, et non par lignes. */
      l.push([antTsFreq(ts.f[k])].concat(cell(0,0,k),cell(1,0,k),
                                       cell(0,1,k),cell(1,1,k)).join("  "));
    }else{
      /* Par lignes, une ligne de matrice par ligne de fichier — au plus
         quatre paires par ligne écrite, comme le format le demande. */
      for(let i=0;i<n;i++){
        let paires=[];
        for(let j=0;j<n;j++)paires.push(cell(i,j,k));
        for(let d=0;d<paires.length;d+=4){
          const morceau=[].concat.apply([],paires.slice(d,d+4));
          l.push(((i===0&&d===0)?antTsFreq(ts.f[k])+"  ":"       ")+
                 morceau.join("  "));
        }
      }
    }
  }
  telecharger(new Blob([l.join("\r\n")+"\r\n"],
                       {type:"text/plain;charset=utf-8"}),
              nomBase()+".s"+n+"p");
  typeof wsHint==="function"&&wsHint(
    "Tableau S écrit : "+nomBase()+".s"+n+"p ("+n+"×"+n+" paramètres, "+
    ts.f.length+" fréquences).");
}

/* Le point décimal, et pas la virgule : un fichier Touchstone est lu par des
   machines, et celles-là ne connaissent que le point. C'est l'inverse de tout
   le reste de la page, et c'est exactement pour cela qu'on l'écrit ici. */
function antTsNb(v){
  const x=Number(v);
  return (isFinite(x)?x:0).toPrecision(9).replace(",",".");
}

/* LA FRÉQUENCE S'ÉCRIT EN TOUTES LETTRES, sans exposant. « 2.45e+9 » est du
   Touchstone valide et la plupart des lecteurs l'acceptent ; « la plupart »
   n'est pas assez pour un fichier qu'on donne à un outil qu'on ne choisit
   pas. Écrite en hertz entiers, elle est lue partout. */
function antTsFreq(v){
  const x=Number(v);
  return String(isFinite(x)?+x.toFixed(3):0);
}
