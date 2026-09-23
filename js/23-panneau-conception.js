"use strict";
/* =============================================================================
   Antenne openEMS — 23-panneau-conception.js
   Le panneau du mode conception : l'empilage, les matériaux, les gabarits,
   les outils, et la liste des formes.

   POURQUOI LES COTES SE TAPENT ICI ET NE SE VISENT PAS À LA SOURIS. Une
   antenne se dimensionne au centième de millimètre : un patch dont la
   longueur bouge de 0,3 mm à 2,45 GHz se décale de 20 MHz, et personne ne
   vise 0,3 mm à la souris. Le canevas sert à POSER une forme là où elle va ;
   ce panneau sert à lui donner sa cote. Les deux vont ensemble, et c'est ici
   que se fait le travail sérieux.

   MÊME RÈGLE QUE L'ASSISTANT : tout ce qui est supposé est écrit. La largeur
   de ligne synthétisée est relue et son impédance affichée ; la permittivité
   choisie porte la fréquence à laquelle le fabricant la donne ; une découpe
   qu'aucun versement n'a prise est comptée. Un panneau qui tait ce qu'il a
   deviné rend des nombres auxquels on ne peut pas se fier.
   ============================================================================= */

/* La mise à jour d'un champ de cote ne redessine PAS le panneau : on perdrait
   le curseur du champ qu'on est en train de remplir. Elle est différée de
   quelques dizaines de millisecondes pour qu'une saisie au clavier ne refasse
   pas le document à chaque touche. */
let CON_ATTENTE=0;
function conMajDifferee(){
  clearTimeout(CON_ATTENTE);
  CON_ATTENTE=setTimeout(function(){ conAppliquer(false,true); },180);
}

function conNb(v,dec){
  if(v==null||!isFinite(v))return "—";
  return Number(v).toFixed(dec==null?3:dec).replace(".",",");
}

/* ==========================================================================
   L'unité d'affichage
   --------------------------------------------------------------------------
   LE DESSIN RESTE EN MILLIMÈTRES, TOUJOURS. C'est l'unité du document que ce
   mode fabrique, celle dans laquelle les gabarits calculent, celle que le
   maillage voit. Ce qui change ici est ce qu'on LIT et ce qu'on TAPE — et
   cela seul, parce qu'une antenne se dimensionne certes en longueurs d'onde,
   mais qu'un stratifié se commande en pouces, qu'un connecteur se cote en
   millièmes, et qu'une carte dessinée à côté d'une carte importée en pouces
   se compare mal quand les deux ne parlent pas la même langue.

   POURQUOI LE MIL. C'est l'unité réelle du métier en Amérique du Nord : les
   largeurs de piste, les dégagements et les épaisseurs de cuivre s'y écrivent
   en millièmes de pouce, jamais en pouces décimaux. « 0,012 pouce » ne se lit
   pas ; « 12 mil » se lit.

   CHANGER D'UNITÉ NE TOUCHE À AUCUNE COTE. Rien n'est réécrit : le panneau
   est refait, et chaque champ affiche la même longueur dans une autre
   écriture. C'est ce qui rend l'opération sûre — un dessin ne dérive pas
   parce qu'on l'a regardé en pouces.

   L'AFFICHAGE, LUI, EST ARRONDI, et il faut le dire : 1,5 mm s'écrit
   « 59,06 mil » et non « 59,0551… ». Tant qu'on ne touche pas au champ, la
   valeur stockée reste 1,5 ; si on le valide tel qu'il est affiché, elle
   devient 1,50012 — un dix-millième de millimètre, cent fois moins que la
   plus petite cellule qu'on maille jamais. C'est le prix d'un affichage
   lisible, et il est payé là où il ne coûte rien.
   ========================================================================== */
const CON_UNITES={
  mm:  {nom:"mm",  k:1.0,    pas:0.05, dec:3},
  in:  {nom:"in",  k:25.4,   pas:0.005,dec:5},
  mil: {nom:"mil", k:0.0254, pas:1,    dec:2}
};

/* Millimètres par unité d'affichage. */
function conK(){ return (CON_UNITES[CON.unite]||CON_UNITES.mm).k; }
function conU(){ return (CON_UNITES[CON.unite]||CON_UNITES.mm).nom; }

/* Un pas de saisie qui a du sens dans l'unité courante : 0,05 mm et 1 mil
   sont du même ordre, 0,05 pouce ne l'est pas du tout. `ref` est le pas
   voulu en millimètres. */
function conPas(ref){
  const u=CON_UNITES[CON.unite]||CON_UNITES.mm;
  if(CON.unite==="mm")return ref;
  return +(Math.max(u.pas,ref/u.k)).toFixed(6);
}

/* mm -> affichage. Le nombre est arrondi pour être lisible, pas pour être
   stocké : ce qui est stocké n'est jamais ce qui est affiché. */
function conAff(mm,dec){
  const u=CON_UNITES[CON.unite]||CON_UNITES.mm;
  return +((mm/u.k).toFixed(dec==null?u.dec:dec));
}

/* affichage -> mm. */
function conLire(v){ return v*conK(); }

/* Une longueur, écrite avec son unité. Sert aux textes — « h = 1,6 mm » —
   qui ne sont pas des champs de saisie. */
function conLong(mm,dec){
  return conNb(conAff(mm,dec),dec==null?
    ((CON_UNITES[CON.unite]||CON_UNITES.mm).dec):dec)+" "+conU();
}

/* ==========================================================================
   L'unité des fréquences
   --------------------------------------------------------------------------
   ELLE N'EST PAS PROPRE À CE MODE. C'est `ANT.uniteF`, celle de l'étape « La
   bande » de l'assistant, et il n'en fallait pas une seconde : la fréquence
   visée du motif DEVIENT la fréquence cible du balayage à l'instant où le
   motif est posé. Deux réglages séparés auraient permis de dimensionner en
   MHz et de relire la bande en GHz — soit exactement la faute de lecture
   qu'une unité écrite existe pour empêcher.

   POURQUOI ELLE SE CHOISIT. Un « 868 » tapé dans un champ marqué GHz ne
   produit ni refus ni champ vide : seulement une antenne trois cents fois
   trop petite, et un dessin qui a l'air d'en être un. Les bandes sub-GHz —
   868, 915 — se disent en mégahertz partout ailleurs qu'ici ; les taper en
   GHz demande de diviser de tête, et une division de tête finit toujours par
   se rater une fois.

   LES DÉCIMALES SUIVENT L'UNITÉ, et ce n'est pas qu'un détail d'affichage :
   quatre décimales de gigahertz valent 100 kHz, quatre décimales de hertz ne
   valent rien. Le tableau vise la même finesse — le dixième de mégahertz —
   quelle que soit l'unité choisie.
   ========================================================================== */
const CON_DEC_F={Hz:0, kHz:0, MHz:1, GHz:4};

/* `ANT.uniteF`, `ANT_UNITES_F` et `antKf()` viennent de 10-etat.js. */
function conUF(){ return ANT_UNITES_F[ANT.uniteF]?ANT.uniteF:"GHz"; }
function conFreq(hz,dec){
  const u=conUF();
  return conNb(hz/antKf(),dec==null?CON_DEC_F[u]:dec)+" "+u;
}

/* ==========================================================================
   Le corps du panneau
   ========================================================================== */
function conPanneauRendre(){
  const corps=document.getElementById("conceptionCorps");
  if(!corps)return;
  if(!CON.actif){
    corps.innerHTML=conEteint();
    const b=corps.querySelector("[data-con-entrer]");
    if(b)b.onclick=conEntrer;
    conBarreRendre();
    return;
  }
  corps.innerHTML=
    conBlocCarte()+
    conBlocEmpilage()+
    conBlocGabarits()+
    conBlocOutils()+
    conBlocFormes();
  /* Même raison qu'à l'assistant : voir `antChampsFideles`. */
  antChampsFideles(corps);
  conPanneauLier(corps);
  conBarreRendre();
}

function conEteint(){
  return '<p class="intro">Ce mode remplace le fichier IPC-2581 par un '+
    'dessin : on pose le cuivre, on choisit le substrat et ses matériaux, et '+
    'le reste de l\'outil ne fait aucune différence — même assistant, mêmes '+
    'refus, même script Python, même solveur.</p>'+
    '<div class="champ"><button class="tb on" data-con-entrer>'+
    '✏️ Entrer en conception</button>'+
    '<p class="note">La carte ouverte, s\'il y en a une, sera remplacée par '+
    'le dessin. Rouvrir un fichier fait sortir du mode et rend la main à la '+
    'carte réelle.</p></div>';
}

/* -------------------------------------------------------------------------
   1. La carte
   ------------------------------------------------------------------------- */
function conBlocCarte(){
  /* L'UNITE EST EN HAUT DU PANNEAU, et non dans un réglage caché : c'est la
     première chose à régler et la dernière qu'on veut découvrir après avoir
     tapé vingt cotes. Elle ne change que l'affichage et la saisie — le dessin
     reste en millimètres, et les gabarits calculent en millimètres. */
  const u=Object.keys(CON_UNITES).map(k=>
    '<option value="'+k+'"'+(CON.unite===k?" selected":"")+'>'+
    CON_UNITES[k].nom+'</option>').join("");
  return '<div class="champ"><label>La carte '+
    '<small>le contour du stratifié. Il n\'est pas décoratif : la masse '+
    'tronquée d\'un monopole EST une partie de l\'antenne, et une carte trop '+
    'courte change la résonance.</small></label>'+
    '<div class="ligne">'+
      '<span><label>longueur X</label><input type="number" step="'+conPas(0.5)+
        '" min="0" data-con-carte="L" value="'+conAff(CON.carte.L)+'"></span>'+
      '<span><label>largeur Y</label><input type="number" step="'+conPas(0.5)+
        '" min="0" data-con-carte="W" value="'+conAff(CON.carte.W)+'"></span>'+
      '<span><label>cotes en</label>'+
        '<select data-con-unite>'+u+'</select></span>'+
    '</div></div>';
}

/* -------------------------------------------------------------------------
   2. L'empilage et les matériaux
   -------------------------------------------------------------------------
   DEUX VUES DU MÊME EMPILAGE, ET C'EST VOULU. La COUPE, en haut, se lit d'un
   coup : c'est la feuille d'empilage du fabricant, du dessus vers le dessous,
   avec ce qu'on commande — nom, matière, rôle, poids de cuivre, épaisseur,
   Dk, Df. La FICHE, en dessous, ne montre qu'une couche à la fois, mais elle
   la montre entière : les listes de matériaux, les valeurs modifiables, et ce
   que chaque nombre signifie pour le calcul.

   Un empilage à huit couches fait dix-sept lignes. Tout déplier ferait un
   panneau de trois écrans où la couche qu'on cherche n'est jamais visible en
   même temps que celle à laquelle on la compare ; c'est précisément ce que la
   coupe permet, et c'est pour cela qu'elle vient en premier.
   ------------------------------------------------------------------------- */
function conOptionsDie(sel){
  return CON_DIELECTRIQUES.map(m=>
    '<option value="'+m.id+'"'+(m.id===sel?" selected":"")+'>'+
    aEsc(m.nom)+' — εr '+String(m.er).replace(".",",")+'</option>').join("")+
    '<option value="libre"'+(sel==="libre"?" selected":"")+'>Autre (saisi)</option>';
}
function conOptionsCond(sel){
  return CON_CONDUCTEURS.map(m=>
    '<option value="'+m.id+'"'+(m.id===sel?" selected":"")+'>'+
    aEsc(m.nom)+'</option>').join("");
}
function conOptionsEp(v){
  const connu=CON_EP_CUIVRE.some(e=>Math.abs(e.ep-v)<1e-9);
  return CON_EP_CUIVRE.map(e=>
    '<option value="'+e.ep+'"'+(Math.abs(e.ep-v)<1e-9?" selected":"")+'>'+
    aEsc(e.nom)+'</option>').join("")+
    (connu?"":'<option value="'+v+'" selected>'+conNb(v*1000,1)+' µm</option>');
}

/* Le poids du cuivre, en onces par pied carré. C'est l'unité dans laquelle un
   cuivre se commande, et la seule qu'un fabricant reconnaisse au premier coup
   d'œil : 1 oz/pi² ≈ 34,8 µm. Les valeurs de catalogue tombent sur des demis,
   les autres sont écrites telles quelles plutôt qu'arrondies à un demi qu'on
   n'aurait pas demandé. */
const CON_OZ=0.0348;
function conOz(ep){
  const o=(+ep||0)/CON_OZ, r=Math.round(o*2)/2;
  return (Math.abs(o-r)<0.06?conNb(r,r%1?1:0):conNb(o,2))+" oz";
}

/* Le rôle affiché dans la coupe : celui d'une couche de cuivre se choisit,
   celui d'un diélectrique dit sa nature — c'est ce qui distingue une âme d'un
   prépreg sur la feuille du fabricant. */
const CON_ROLES_CU={signal:"Signal", gnd:"Plan de masse", pwr:"Plan d'alim."};
function conRoleTxt(e){
  if(e.k==="cu")return CON_ROLES_CU[e.role]||"Signal";
  return (CON_SORTES[e.sorte]||"âme (core)").replace(/^./,c=>c.toUpperCase());
}

/* Une ligne de la coupe. `rang` est le numéro de la couche de cuivre — celui
   qui sert à en parler (« la couche 2 »), et qui ne compte pas les
   diélectriques ; un diélectrique n'a pas de numéro, il a deux voisins. */
function conLigneCoupe(e,i,rang){
  const sel=(CON.pileSel===i)?" on":"";
  const die=(e.k==="die");
  const mat=die?conDielectrique(e.mat).nom:conConducteur(e.mat).nom;
  return '<tr class="'+(die?"gap":"cu")+sel+'" data-con-voir="'+i+'" '+
      'title="Régler cette couche">'+
    '<td>'+(die?"":rang)+'</td>'+
    '<td class="nom">'+aEsc(e.nom)+'</td>'+
    '<td>'+aEsc(mat)+'</td>'+
    '<td>'+aEsc(conRoleTxt(e))+'</td>'+
    '<td>'+(die?"—":conOz(e.ep))+'</td>'+
    '<td>'+conNb(conAff(e.ep),3)+'</td>'+
    '<td>'+(die?conNb(e.er,2):"—")+'</td>'+
    '<td>'+(die?conNb(e.df,4):"—")+'</td>'+
    '</tr>';
}

function conCoupe(){
  let rang=0;
  const lignes=CON.pile.map(function(e,i){
    if(e.k==="cu")rang++;
    return conLigneCoupe(e,i,rang);
  }).join("");
  return '<table class="empilage coupe">'+
    '<thead><tr><th>#</th><th>nom</th><th>matière</th><th>rôle</th>'+
    '<th>poids</th><th>épaiss. '+conU()+'</th><th>Dk</th><th>Df</th></tr></thead>'+
    '<tbody>'+lignes+'</tbody></table>';
}

/* La fiche de la couche choisie : tout ce qui se règle, et pourquoi. */
function conFicheCouche(e,i){
  const occupee=(e.k==="cu")&&conCoucheOccupee(e.uid);
  const masque=conEstMasque(e);
  const tete='<div class="objet-tete">'+
    '<b>'+(e.k==="cu"?"Cuivre":(masque?"Masque":"Diélectrique"))+'</b>'+
    '<input type="text" class="nom" data-con-pile="'+i+'" data-ou="nom" '+
      'value="'+aEsc(e.nom)+'">'+
    '<button class="tb mini" data-con-pile-suppr="'+i+'"'+
      (occupee?' disabled title="Cette couche porte du cuivre dessiné : '+
        'retirez d\'abord ses formes. Effacer du dessin parce qu\'on a touché '+
        'à l\'empilage est une perte qu\'on ne remarque qu\'au résultat."'
       :' title="Retirer cette couche"')+'>✕</button>'+
    '</div>';

  if(e.k==="cu"){
    const c=conConducteur(e.mat);
    return '<div class="objet cu">'+tete+
      '<div class="ligne">'+
        '<span><label>rôle</label><select data-con-pile="'+i+'" data-ou="role">'+
          '<option value="signal"'+(e.role==="signal"?" selected":"")+'>signal / antenne</option>'+
          '<option value="gnd"'+(e.role==="gnd"?" selected":"")+'>masse</option>'+
          '<option value="pwr"'+(e.role==="pwr"?" selected":"")+'>alimentation</option>'+
        '</select></span>'+
        '<span><label>métal</label><select data-con-pile="'+i+'" data-ou="mat">'+
          conOptionsCond(e.mat)+'</select></span>'+
        '<span><label>épaisseur</label><select data-con-pile="'+i+'" data-ou="ep">'+
          conOptionsEp(e.ep)+'</select></span>'+
      '</div>'+
      '<p class="note">σ = '+c.sigma.toExponential(2).replace(".",",")+
        ' S/m. Elle ne compte que par la résistance de surface du modèle '+
        '« feuille » — à 2,4 GHz l\'épaisseur de peau du cuivre fait 1,3 µm, '+
        'le courant ne voit jamais les '+conNb(e.ep*1000,1)+' µm de la couche.'+
        (c.note?' <b>'+aEsc(c.note)+'</b>':"")+'</p>'+
      '</div>';
  }

  const m=conDielectrique(e.mat);
  const colle=Math.abs(m.er-e.er)<1e-6&&Math.abs(m.df-e.df)<1e-9;
  return '<div class="objet die'+(masque?" masque":"")+'">'+tete+
    '<div class="ligne">'+
      '<span style="flex:1 1 180px"><label>matériau</label>'+
        '<select data-con-pile="'+i+'" data-ou="mat">'+
        conOptionsDie(colle?e.mat:"libre")+'</select></span>'+
      '<span><label>épaisseur</label><input type="number" step="'+conPas(0.05)+
        '" min="0" data-con-pile="'+i+'" data-ou="ep" value="'+
        conAff(e.ep)+'"></span>'+
      '<span class="unite">'+conU()+'</span>'+
      (masque?"":'<span><label>nature</label>'+
        '<select data-con-pile="'+i+'" data-ou="sorte">'+
          '<option value="core"'+(e.sorte!=="prepreg"?" selected":"")+'>âme (core)</option>'+
          '<option value="prepreg"'+(e.sorte==="prepreg"?" selected":"")+'>prépreg</option>'+
        '</select></span>')+
    '</div>'+
    '<div class="ligne">'+
      '<span><label>ε<sub>r</sub></label><input type="number" step="0.01" min="1" '+
        'data-con-pile="'+i+'" data-ou="er" value="'+e.er+'"></span>'+
      '<span><label>tan δ</label><input type="number" step="0.0005" min="0" '+
        'data-con-pile="'+i+'" data-ou="df" value="'+e.df+'"></span>'+
    '</div>'+
    '<p class="note">'+(masque
      ? 'Le vernis épargne compte deux fois : il abaisse la résonance d\'un '+
        'pour cent environ, et ses '+conNb(e.ep*1000,1)+' µm posent deux '+
        'lignes de maillage obligatoires là où la plus petite cellule du '+
        'modèle en faisait 37. Le pas de temps FDTD suit la plus petite '+
        'cellule du domaine : compter une fois et demie le temps de calcul.'
      : (colle
        ? 'Valeurs de notice, données à '+aEsc(m.f)+
          (m.note?'. '+aEsc(m.note):"")+
          '. La tolérance réelle est plus large que l\'affichage : ±2 % sur un '+
          'FR-4 déplace la résonance d\'un pour cent.'
        : 'Valeurs saisies à la main : elles ne viennent plus d\'une notice, et '+
          'c\'est très bien — le stratifié qu\'on a en magasin n\'est jamais tout '+
          'à fait celui du catalogue.'))+'</p>'+
    '</div>';
}

/* Le choix du modèle d'usine et du nombre de couches. Les deux vont ensemble :
   changer le compte prend le premier modèle du nouveau compte, changer le
   modèle peut changer le compte. */
function conOptionsModele(){
  const n=conCuivres().length;
  const liste=conModelesPour(n);
  const autres=CON_MODELES.filter(m=>m.n!==n);
  const opt=m=>'<option value="'+m.id+'"'+(CON.modele===m.id?" selected":"")+
    '>'+aEsc(m.nom)+'</option>';
  return '<option value=""'+(CON.modele?"":" selected")+'>— empilage libre —</option>'+
    (liste.length?'<optgroup label="'+n+' couche'+(n>1?"s":"")+'">'+
      liste.map(opt).join("")+'</optgroup>':"")+
    '<optgroup label="autres comptes de couches">'+
      autres.map(opt).join("")+'</optgroup>';
}

function conBlocDemarrage(){
  const n=conCuivres().length;
  const boutons=conComptesCuivre().map(c=>
    '<button class="tb'+(c===n?" on":"")+'" data-con-ncu-bouton="'+c+'">'+
    c+' couche'+(c>1?"s":"")+'</button>').join("");
  const modeles=conModelesPour(n).map(function(m){
    return '<button class="tb large'+(CON.modele===m.id?" on":"")+'" '+
      'data-con-modele-bouton="'+m.id+'">'+aEsc(m.nom)+
      '<small>'+conNb(m.cible,3)+' mm'+(m.note?' · '+aEsc(m.note):"")+
      '</small></button>';
  }).join("");
  return '<div class="champ demarrage"><label>Sur quelle carte ? '+
    '<small>C\'est la première question, et elle vient avant le premier trait : '+
    'les cotes d\'un motif sont calculées SUR un substrat — un patch dessiné '+
    'pour un FR-4 de 1,6 mm et reporté tel quel sur un RO4350B de 0,762 mm '+
    'n\'est plus un patch, c\'est un rectangle de cuivre. Rien n\'est dessiné '+
    'pour l\'instant : c\'est le seul moment où changer d\'empilage ne coûte '+
    'rien.</small></label>'+
    '<div class="raccourcis">'+boutons+'</div>'+
    '<div class="modeles">'+modeles+'</div>'+
    '<div class="pnl-bar">'+
      '<button class="tb on" data-con-demarrer>Empilage arrêté, dessiner</button>'+
      '<span class="note-inline">Tout reste modifiable ensuite, couche par '+
      'couche — mais les cotes déjà dessinées, elles, ne se recalculent pas '+
      'toutes seules.</span>'+
    '</div></div>';
}

function conBlocEmpilage(){
  const s=conSubstrat();
  const cu=conCuivres();
  const masques=conMasques();
  const obtenue=conEpTotale();
  const ecart=obtenue-(+CON.cible||0);
  const asym=conAsymetrie();
  const i=Math.min(Math.max(CON.pileSel|0,0),Math.max(CON.pile.length-1,0));
  const fiche=CON.pile[i]?conFicheCouche(CON.pile[i],i):"";

  return (CON.demarrage?conBlocDemarrage():"")+
    '<div class="champ"><label>L\'empilage et les matériaux '+
    '<small>ce que le solveur mettra entre les couches de cuivre, et ce que '+
    'le fabricant pressera. Une permittivité fausse de 10 % déplace la '+
    'résonance d\'environ 5 % — assez pour être hors bande sans savoir '+
    'pourquoi.</small></label>'+

    (CON.demarrage?"":'<div class="ligne">'+
      '<span style="flex:1 1 200px"><label>modèle d\'usine</label>'+
        '<select data-con-modele>'+conOptionsModele()+'</select></span>'+
      '<span><label>couches de cuivre</label><select data-con-ncu>'+
        conComptesCuivre().map(c=>'<option value="'+c+'"'+
          (c===cu.length?" selected":"")+'>'+c+'</option>').join("")+
        (conComptesCuivre().indexOf(cu.length)<0
          ? '<option value="'+cu.length+'" selected>'+cu.length+'</option>':"")+
      '</select></span>'+
    '</div>')+

    conCoupe()+
    fiche+

    '<div class="ligne">'+
      '<span><label>épaisseur visée</label><input type="number" step="'+
        conPas(0.05)+'" min="0" data-con-cible value="'+conAff(CON.cible)+
        '"></span>'+
      '<span class="unite">'+conU()+'</span>'+
      '<span><label>&nbsp;</label><button class="tb mini" data-con-ajuster '+
        'title="Répartir l\'écart sur les diélectriques, au prorata. Le cuivre '+
        'et le masque ne bougent pas : ils se commandent.">répartir</button></span>'+
    '</div>'+

    '<div class="recap">'+
      '<span>obtenue <b>'+conLong(obtenue)+'</b></span>'+
      '<span>stratifié nu '+conLong(conEpStratifie())+'</span>'+
      '<span>cuivre total '+conLong(conEpCuivre())+'</span>'+
      (conEpMasque()?'<span>masque '+conLong(conEpMasque())+'</span>':"")+
      (Math.abs(ecart)>0.0005
        ? '<span class="alerte">écart '+(ecart>0?"+":"−")+
          conLong(Math.abs(ecart))+' sur la visée</span>'
        : '<span>visée atteinte</span>')+
    '</div>'+

    '<div class="pnl-bar">'+
      '<button class="tb mini" data-con-ajout-couche>+ diélectrique et cuivre</button>'+
      '<button class="tb mini'+(masques.haut||masques.bas?" on":"")+'" '+
        'data-con-masque title="Le vernis épargne : 25 µm d\'εr 3,8 sur les '+
        'deux faces. Il abaisse la résonance d\'environ 1 %, et il allonge '+
        'le calcul d\'environ moitié — le pas de temps FDTD suit ses '+
        '25 µm.">masque</button>'+
      (asym.length?'<button class="tb mini" data-con-symetriser '+
        'title="Faire la moyenne des couches deux à deux">symétriser</button>':"")+
    '</div>'+

    (asym.length?'<p class="note alerte">Empilage asymétrique : '+
      asym.map(a=>aEsc(a.a)+" / "+aEsc(a.b)+" ("+aEsc(a.dit)+")").join(", ")+
      '. Une carte asymétrique se voile à la cuisson ; le fabricant la refuse, '+
      'ou la compense à sa façon — et rend alors une carte dont l\'empilage '+
      'n\'est plus celui qu\'on a simulé.</p>':"")+

    '<p class="note">'+cu.length+' couche(s) de cuivre · substrat vu par les '+
      'gabarits : h = '+conLong(s.h)+', ε<sub>r</sub> = '+conNb(s.er,3)+
      ', tan δ = '+conNb(s.df,4)+'. C\'est le diélectrique entre la PREMIÈRE '+
      'couche de cuivre et la SUIVANTE : une antenne imprimée travaille contre '+
      'le plan qui est juste sous elle, pas contre le dessous de la carte.</p>'+
    '</div>';
}

/* -------------------------------------------------------------------------
   3. Les motifs d'antenne
   -------------------------------------------------------------------------
   TROIS TEMPS, ET C'EST VOULU : on choisit un motif dans la galerie, on règle
   ses cotes en regardant le dessin se refaire, puis on le pose. L'ancien
   bouton posait à l'instant du clic — ce qui effaçait le dessin en cours
   avant qu'on ait vu ce qu'on prenait, et ne laissait aucun moyen de changer
   une cote autrement qu'en reprenant les formes une à une après coup.

   L'APERÇU N'EST PAS UNE ILLUSTRATION : il sort du même `tracer()` que la
   pose (22-antennes.js), donc ce qui est montré est exactement ce qui sera
   dessiné, port compris. Voir 27-apercu-motif.js.
   ------------------------------------------------------------------------- */

/* La cote dont l'aperçu est allumé : celle du champ qu'on est en train de
   régler. Elle vit ici plutôt que dans CON — c'est un état d'affichage du
   panneau, pas du dessin, et rien d'autre ne la lit. */
let CON_COTE_ON="";

/* Les cotes qui n'ont pas été reprises à la main suivent la fréquence et le
   substrat ; celles qu'on a tapées restent. C'est la seule façon de pouvoir
   changer la fréquence après avoir fixé une largeur de bras sans que l'une
   écrase l'autre. */
function conGabaritRafraichir(){
  const g=conGabarit(CON.gabarit);
  if(!g){ CON.gabaritP={}; CON.gabaritTouche={}; return null; }
  const d=conGabaritDefauts(g,conContexte());
  const p={};
  g.champs.forEach(function(ch){
    p[ch.id]=(CON.gabaritTouche[ch.id]&&CON.gabaritP[ch.id]!=null)
      ? CON.gabaritP[ch.id] : d[ch.id];
  });
  CON.gabaritP=p;
  return g;
}

/* Le dessin coté, et les deux nombres qui disent ce qu'il vaut : la résonance
   que ces cotes-là donnent, et l'encombrement de la carte. */
function conApercuBloc(g){
  const c=conContexte();
  let t=null;
  try{ t=g.tracer(c,conGabaritCotes(g,c,CON.gabaritP)); }catch(e){ t=null; }
  let etat="";
  if(t){
    let f="";
    if(t.calcul.festim>0){
      const ec=100*(t.calcul.festim-c.f)/c.f;
      const a=Math.abs(ec);
      f='<span class="'+(a<=2?"pres":(a<=8?"tiede":"loin"))+'">'+
        'résonance estimée '+conFreq(t.calcul.festim)+' ('+
        (ec>=0?"+":"−")+conNb(a,1)+' %)</span>';
    }
    etat='<div class="apm-etat">'+f+'<span>carte '+conLong(t.carte.L,1)+
         ' × '+conLong(t.carte.W,1)+'</span></div>';
  }
  /* La légende dit les trois couleurs du dessin. Elle est sous l'image et non
     dedans : une étiquette posée sur un dessin de cette taille recouvre
     toujours le cuivre qu'elle désigne. */
  /* Les deux couches nommées sont celles où le motif dessine : la PREMIÈRE et
     la SECONDE du cuivre — pas la dernière. Sur un empilage à quatre couches,
     une antenne travaille contre le plan qui est juste sous elle. */
  const cu=conCuivres();
  const legende='<div class="apm-legende">'+
    '<span class="l-haut">'+aEsc(cu.length?cu[0].e.nom:"dessus")+'</span>'+
    '<span class="l-bas">'+aEsc(cu.length>1?cu[1].e.nom:"dessous")+'</span>'+
    '<span class="l-port">port</span></div>';
  return apmPlanche(g,CON.gabaritP)+etat+legende;
}

/* Allumer une cote du dessin, et elle seule. C'est un changement de CLASSE,
   pas un redessin : passer la souris sur un champ ne doit pas refaire le SVG
   sous le curseur — le survol s'éteindrait aussitôt, faute d'élément pour
   recevoir le « mouseleave ». */
function conCoteAllumer(id){
  const d=document.getElementById("conApercu");
  if(!d)return;
  d.querySelectorAll("[data-cote]").forEach(function(n){
    n.classList.toggle("on",n.getAttribute("data-cote")===id);
  });
}

/* Refaire le seul aperçu, sans toucher au reste du panneau : une cote se tape
   au clavier, et un panneau qui se reconstruit à chaque touche perd le
   curseur du champ en cours — même raison que conMajDifferee() plus haut. */
function conApercuMaj(){
  const d=document.getElementById("conApercu");
  const g=conGabarit(CON.gabarit);
  if(!d||!g)return;
  d.innerHTML=conApercuBloc(g);
  antChampsFideles(d);
  conApercuLier();
}

/* Rendre les cotes du dessin vivantes. À APPELER APRÈS CHAQUE ÉCRITURE du
   SVG — celle de conApercuMaj à la frappe, mais aussi celle de la fiche, qui
   vient de conPanneauRendre : un dessin fraîchement ouvert dont les cotes ne
   répondaient pas au clic n'avait l'air de rien, sinon d'être en panne. */
function conApercuLier(){
  const d=document.getElementById("conApercu");
  if(!d)return;
  d.querySelectorAll("[data-cote]").forEach(function(n){
    const id=n.getAttribute("data-cote");
    n.classList.toggle("on",id===CON_COTE_ON);
    /* DU DESSIN VERS LE CHAMP. Le chemin inverse du focus, et c'est celui
       qu'on prend le plus souvent : on voit SUR le dessin la longueur qu'on
       veut changer, on clique dessus, le champ s'ouvre déjà sélectionné. Sans
       lui il faudrait retrouver « ha » dans une liste de neuf noms. */
    n.onclick=function(){
      const e=document.querySelector('[data-con-cote="'+id+'"]');
      if(!e)return;
      e.focus();
      if(e.select)e.select();
    };
    n.onmouseenter=function(){ n.classList.add("on"); };
    n.onmouseleave=function(){ n.classList.toggle("on",id===CON_COTE_ON); };
  });
}

/* Un champ de cote. `n` (le nombre de replis du méandre) est un compte, pas
   une longueur : il ne se convertit pas en pouces et ne porte pas d'unité. */
function conChampCote(ch,val){
  if(ch.booleen){
    return '<span><label class="ck" title="'+aEsc(ch.aide)+'">'+
      '<input type="checkbox" data-con-cote="'+ch.id+'"'+(val?' checked':'')+'> '+
      '<b>'+aEsc(conSymbole(ch))+'</b> '+aEsc(ch.nom)+'</label></span>';
  }
  /* LE SYMBOLE D'ABORD, et en gras : c'est la lettre portée sur le dessin
     juste au-dessus. Sans elle, il faut lire « hauteur au-dessus de la
     masse » et deviner que c'est le « ha » du croquis — ce qui, sur un motif
     qui a neuf cotes, revient à les essayer une par une. */
  const lab='<label title="'+aEsc(ch.aide)+'"><b>'+aEsc(conSymbole(ch))+
    '</b> '+aEsc(ch.nom)+'</label>';
  if(ch.entier)
    return '<span>'+lab+
      '<input type="number" step="1" min="1" data-con-cote="'+ch.id+
      '" value="'+Math.round(val)+'"></span>';
  return '<span>'+lab+
    '<input type="number" step="'+conPas(0.05)+'" min="0" data-con-cote="'+
    ch.id+'" value="'+conAff(val)+'"></span>';
}

function conFicheMotif(g){
  const champs=g.champs.map(ch=>conChampCote(ch,CON.gabaritP[ch.id])).join("");
  /* L'empilage peut ne pas convenir au motif, et il vaut mieux le dire ICI,
     sous le dessin, que de laisser presser un bouton qui refusera. L'aperçu,
     lui, reste affiché : il est calculé sur le substrat de repli, et voir la
     forme qu'on ne peut pas encore poser aide à comprendre ce qui manque. */
  const manque=(conCuivres().length<2)
    ? '<p class="note alerte">'+aEsc(g.besoin)+' Ajoutez une couche dans '+
      'l\'empilage ci-dessus ; le dessin ci-dessous est calculé sur un FR-4 '+
      'de 1,6 mm en attendant.</p>'
    : "";
  return '<div class="motif-fiche">'+
    '<div class="motif-tete"><b>'+aEsc(g.nom)+'</b>'+
      '<button class="tb mini" data-con-motif-fermer title="Refermer la fiche : '+
      'le dessin n\'est pas touché">✕</button></div>'+
    '<p class="note">'+aEsc(g.aide)+'</p>'+manque+
    '<div class="apercu" id="conApercu">'+conApercuBloc(g)+'</div>'+
    '<p class="note">Toutes les longueurs du motif sont réglables : chaque '+
    'lettre du dessin a son champ ci-dessous, et chaque champ allume sa cote '+
    'sur le dessin. Cliquez une cote pour ouvrir son champ. Le dessin se '+
    'refait à chaque frappe.</p>'+
    '<div class="ligne cotes-motif">'+champs+
      '<span class="unite">'+conU()+'</span></div>'+
    '<div class="pnl-bar">'+
      '<button class="tb on" data-con-motif-poser>Dessiner ce motif</button>'+
      '<button class="tb mini" data-con-motif-calcul title="Rendre à chaque '+
      'cote la valeur que le calcul propose">↻ cotes du calcul</button>'+
    '</div>'+
    '<p class="note alerte">Dessiner ce motif REMPLACE tout ce qui est '+
    'dessiné, et remet le port là où le motif l\'alimente.</p>'+
    '</div>';
}

function conBlocGabarits(){
  const g=conGabaritRafraichir();

  const galerie=CON_GABARITS.map(function(m){
    return '<button class="motif'+(CON.gabarit===m.id?" on":"")+
      '" data-con-gabarit="'+m.id+'" title="'+aEsc(m.aide)+'">'+
      apmVignette(m)+'<span>'+aEsc(m.nom)+'</span></button>';
  }).join("");

  let calcul="";
  if(CON.calcul){
    calcul='<div class="calcul"><b>'+aEsc(CON.calcul.titre)+'</b>'+
      '<table>'+CON.calcul.lignes.map(l=>
        '<tr><td>'+l[0]+'</td><td>'+aEsc(l[1])+'</td></tr>').join("")+
      '</table>'+
      '<p class="note alerte">Modèle de ligne de transmission : l\'écart '+
      'honnête est de 2 à 5 % sur la résonance, davantage sur substrat épais '+
      'ou ε<sub>r</sub> élevé. C\'est un point de départ, pas une antenne '+
      'finie — le solveur tranche, et on corrige la cote.</p></div>';
  }

  /* La fréquence est STOCKÉE en hertz et AFFICHÉE dans l'unité choisie. */
  const f=+(CON.fcible/antKf()).toFixed(6);
  const uf=Object.keys(ANT_UNITES_F).map(n=>
    '<option'+(n===conUF()?" selected":"")+'>'+n+'</option>').join("");
  return '<div class="champ"><label>Partir d\'un motif d\'antenne '+
    '<small>la fréquence et l\'empilage ci-dessus donnent les cotes ; on les '+
    'retouche, le dessin suit, et le port se pose avec lui.</small></label>'+
    '<div class="ligne">'+
      '<span><label>fréquence visée</label>'+
        '<input type="number" step="any" min="0" data-con-f value="'+
        f+'"></span>'+
      '<span><label>en</label><select data-con-uf>'+uf+'</select></span>'+
    '</div>'+
    '<div class="galerie-motifs">'+galerie+'</div>'+
    (g?conFicheMotif(g):
      '<p class="note">Choisissez un motif : son dessin apparaît, coté, avec '+
      'les valeurs que le calcul propose. Rien n\'est dessiné tant que vous '+
      'n\'avez pas pressé « Dessiner ce motif ».</p>')+
    calcul+'</div>';
}

/* -------------------------------------------------------------------------
   4. Les outils de dessin
   ------------------------------------------------------------------------- */
function conBlocOutils(){
  const cu=conCuivres();
  const outils=CON_OUTILS.map(o=>
    '<button class="tb mini'+(CON.outil===o.id?" on":"")+'" data-con-outil="'+
    o.id+'" title="'+aEsc(o.aide)+'">'+aEsc(o.nom)+'</button>').join("");

  const couches=cu.map(c=>
    '<option value="'+c.e.uid+'"'+(c.e.uid===CON.coucheActive?" selected":"")+
    '>'+aEsc(c.e.nom)+'</option>').join("");

  return '<div class="champ"><label>Dessiner '+
    '<small>le canevas pose la forme ; les cotes se règlent en dessous. '+
    'Double-clic ou Entrée ferme une polyligne, Échap l\'annule, Suppr retire '+
    'la forme choisie, Ctrl+Z annule le dernier geste et Ctrl+Y le '+
    'refait.</small></label>'+
    '<div class="raccourcis outils">'+outils+'</div>'+
    '<div class="ligne">'+
      '<span style="flex:1 1 140px"><label>couche</label>'+
        '<select data-con-reglage="coucheActive">'+couches+'</select></span>'+
      '<span><label>net</label><select data-con-reglage="netActif">'+
        '<option value="ANTENNE"'+(CON.netActif==="ANTENNE"?" selected":"")+'>ANTENNE</option>'+
        '<option value="GND"'+(CON.netActif==="GND"?" selected":"")+'>GND</option>'+
      '</select></span>'+
    '</div>'+
    '<div class="ligne">'+
      '<span><label>largeur de piste</label><input type="number" step="'+
        conPas(0.05)+'" min="0" data-con-reglage="largeur" value="'+
        conAff(CON.largeur)+'"></span>'+
      '<span><label>grille</label><input type="number" step="'+conPas(0.05)+
        '" min="0" data-con-reglage="grille" value="'+conAff(CON.grille)+
        '"></span>'+
      '<span><label>⌀ via</label><input type="number" step="'+conPas(0.05)+
        '" min="0" data-con-reglage="diametreVia" value="'+
        conAff(CON.diametreVia)+'"></span>'+
      '<span class="unite">'+conU()+'</span>'+
    '</div>'+
    '<label class="ck"><input type="checkbox" data-con-trou'+
      (CON.trou?" checked":"")+'>'+
      '<span>Dessiner des <b>découpes</b> et non du cuivre'+
      '<small>une fente dans un patch, un dégagement autour de la ligne, un '+
      'trou dans le plan de masse. Une découpe est COUPÉE au bord du versement '+
      'qu\'elle perce : ce qui déborde ne retire rien ailleurs, et une fente '+
      'à cheval entre donc dans le modèle pour ce qu\'elle y retire vraiment. '+
      'Celles qui ne recouvrent aucun cuivre sont comptées et dites. Une '+
      'découpe efface TOUT le métal de sa couche à cet endroit — y compris '+
      'une piste qui passerait dessous.</small></span></label>'+
    '</div>';
}

/* -------------------------------------------------------------------------
   5. La liste des formes
   ------------------------------------------------------------------------- */
/* `v` arrive TOUJOURS en millimètres : c'est l'unité du dessin. La
   conversion vers l'unité d'affichage se fait ici, et la conversion inverse
   dans le gestionnaire de saisie — une seule paire d'endroits pour toutes les
   cotes de toutes les formes. */
function conChamp(i,etiquette,ou,v,pas,k){
  return '<span><label>'+etiquette+'</label>'+
    '<input type="number" step="'+conPas(pas||0.1)+'" data-con-el="'+i+
    '" data-ou="'+ou+'"'+(k!=null?' data-k="'+k+'"':"")+
    ' value="'+conAff(v)+'"></span>';
}

function conFicheElement(el,i){
  const cu=conCuivres();
  let geo="";
  if(el.type==="rect"){
    const x1=Math.min(el.x1,el.x2), y1=Math.min(el.y1,el.y2);
    geo='<div class="ligne">'+
      conChamp(i,"X","x1",+x1.toFixed(4))+
      conChamp(i,"Y","y1",+y1.toFixed(4))+
      conChamp(i,"largeur","dx",+Math.abs(el.x2-el.x1).toFixed(4))+
      conChamp(i,"hauteur","dy",+Math.abs(el.y2-el.y1).toFixed(4))+
      '<span class="unite">'+conU()+'</span></div>';
  }else if(el.type==="disque"){
    geo='<div class="ligne">'+
      conChamp(i,"centre X","cx",el.cx)+conChamp(i,"centre Y","cy",el.cy)+
      conChamp(i,"rayon","r",el.r,0.05)+'<span class="unite">'+conU()+'</span></div>';
  }else if(el.type==="via"){
    geo='<div class="ligne">'+
      conChamp(i,"X","x",el.x)+conChamp(i,"Y","y",el.y)+
      conChamp(i,"⌀","d",el.d,0.05)+'<span class="unite">'+conU()+'</span></div>';
  }else{
    geo=el.pts.map((q,k)=>'<div class="ligne">'+
      conChamp(i,"sommet "+(k+1)+" · X","pt",q[0],0.1,k*2)+
      conChamp(i,"Y","pt",q[1],0.1,k*2+1)+
      '<span class="unite">'+conU()+'</span></div>').join("");
    if(el.type==="piste")
      geo+='<div class="ligne">'+conChamp(i,"largeur","w",el.w,0.05)+
           '<span class="unite">'+conU()+'</span></div>';
  }

  const couches=cu.map(c=>
    '<option value="'+c.e.uid+'"'+(c.e.uid===el.cu?" selected":"")+'>'+
    aEsc(c.e.nom)+'</option>').join("");

  return '<div class="objet forme'+(i===CON.sel?" on":"")+
    (el.trou?" trou":"")+'" data-con-choisir="'+i+'">'+
    '<div class="objet-tete">'+
      '<b>'+aEsc(conNomElement(el))+'</b>'+
      (el.type==="via"?"":'<select data-con-el="'+i+'" data-ou="cu">'+couches+'</select>')+
      (el.trou?'<span class="jeton">découpe</span>'
             :'<select data-con-el="'+i+'" data-ou="net">'+
               '<option value="ANTENNE"'+(el.net==="ANTENNE"?" selected":"")+'>ANTENNE</option>'+
               '<option value="GND"'+(el.net==="GND"?" selected":"")+'>GND</option>'+
               '</select>')+
      '<button class="tb mini" data-con-el-suppr="'+i+'" title="Retirer">✕</button>'+
    '</div>'+geo+'</div>';
}

function conBlocFormes(){
  if(!CON.elements.length)
    return '<div class="champ"><label>Les formes</label>'+
      '<div class="rien">Rien de dessiné. Posez un gabarit ci-dessus, ou '+
      'prenez le rectangle et tracez un patch : tout ce qui est dessiné part '+
      'au solveur comme du cuivre réel.</div></div>';

  /* DEUX CAUSES, ET ELLES N'APPELLENT PAS LA MÊME RÉPONSE. Une découpe posée
     à côté du cuivre se corrige en la déplaçant ; une découpe que le calcul
     de la partie commune n'a pas su traiter est un aveu de l'outil, et il
     doit le dire comme tel. Les deux ont en commun de ne PAS être dans le
     modèle, et c'est ce qui compte le plus : une fente qui manque change
     complètement une antenne, et rien dans le S₁₁ ne le dirait. */
  const orph=(CON.decoupesOrphelines>0
    ? '<p class="note alerte">'+CON.decoupesOrphelines+' découpe(s) ne sont '+
      'entrées dans aucun versement : elles ne recouvrent aucun cuivre de '+
      'leur couche, et elles ne sont PAS dans le modèle. Une fente qui '+
      'manque change complètement une antenne, et rien dans le S<sub>11</sub> '+
      'ne le dirait.</p>'
    : "")+(CON.decoupesRatees>0
    ? '<p class="note alerte">'+CON.decoupesRatees+' découpe(s) n\'ont pas pu '+
      'être découpées au bord du versement : le calcul de la partie commune '+
      'n\'a pas abouti sur cette géométrie-là. Elles ne sont PAS dans le '+
      'modèle. Déplacez-les d\'un dixième de millimètre, ou refaites-les '+
      'entièrement à l\'intérieur du versement.</p>'
    : "");

  return '<div class="champ"><label>Les formes '+
    '<small>cliquez une fiche pour la mettre en évidence sur la carte.</small>'+
    '</label>'+orph+
    CON.elements.map(conFicheElement).join("")+'</div>';
}

/* -------------------------------------------------------------------------
   La barre du bas
   ------------------------------------------------------------------------- */
function conBarreRendre(){
  const box=document.getElementById("conceptionBarre");
  if(!box)return;
  if(!CON.actif){
    box.innerHTML='<span class="note-inline">Mode conception éteint — '+
      'l\'outil travaille sur le fichier ouvert.</span>';
    return;
  }
  const cu=conCuivres();
  box.innerHTML=
    '<span class="recap-item">'+CON.elements.length+' forme(s)</span>'+
    '<span class="recap-item">'+cu.length+' couche(s) de cuivre</span>'+
    '<span class="recap-item">'+conNb(conAff(CON.carte.L),1)+' × '+
      conLong(CON.carte.W,1)+'</span>'+
    /* ANNULER SE VOIT, sans quoi il n'existe que pour qui connaît déjà le
       raccourci. Les deux boutons sont éteints quand il n'y a rien à défaire :
       un bouton qui ne fait rien au clic est pire qu'un bouton grisé. */
    '<button class="tb mini" data-con-annuler'+
      (conPeutAnnuler()?"":" disabled")+' title="Annuler le dernier geste '+
      '(Ctrl+Z)">↶ Annuler</button>'+
    '<button class="tb mini" data-con-refaire'+
      (conPeutRefaire()?"":" disabled")+' title="Refaire (Ctrl+Y)">'+
      '↷ Refaire</button>'+
    '<button class="tb mini" data-con-vider>Tout effacer</button>'+
    '<button class="tb mini" data-con-sortir title="Rendre la main aux '+
      'fichiers ouverts. La carte dessinée reste chargée.">Quitter le mode</button>';
  box.querySelectorAll("[data-con-annuler]").forEach(function(b){
    b.onclick=conAnnuler;
  });
  box.querySelectorAll("[data-con-refaire]").forEach(function(b){
    b.onclick=conRefaire;
  });
  box.querySelectorAll("[data-con-vider]").forEach(function(b){
    b.onclick=function(){
      CON.elements=[]; CON.sel=-1; CON.calcul=null;
      /* TOUS les ports, et pas seulement celui qu'on règle : ils désignaient
         du cuivre qu'on vient d'effacer. */
      ANT.ports.forEach(function(p){ p.pose=false; });
      conAppliquer(false);
    };
  });
  box.querySelectorAll("[data-con-sortir]").forEach(function(b){
    b.onclick=conSortir;
  });
}

/* ==========================================================================
   Le câblage
   ========================================================================== */
function conPanneauLier(box){
  /* -- la carte -- */
  box.querySelectorAll("[data-con-carte]").forEach(function(el){
    el.oninput=function(){
      const v=parseFloat(String(el.value).replace(",","."));
      if(!isFinite(v)||v<=0)return;
      CON.carte[el.dataset.conCarte]=conLire(v);
      conMajDifferee();
    };
  });

  /* -- l'empilage -- */
  box.querySelectorAll("[data-con-pile]").forEach(function(el){
    const appliquer=function(rendre){
      const e=CON.pile[+el.dataset.conPile];
      if(!e)return;
      const ou=el.dataset.ou;
      if(ou==="mat"&&e.k==="die"){
        if(el.value!=="libre"){
          const m=conDielectrique(el.value);
          e.mat=m.id; e.er=m.er; e.df=m.df;
        }else e.mat="libre";
      }else if(ou==="nom"){
        const n=String(el.value).trim();
        if(!n)return;
        /* Deux couches du même nom rendraient le port et les vias ambigus
           sans qu'aucun message ne le dise. */
        if(CON.pile.some(o=>o!==e&&o.nom===n))return;
        e.nom=n;
      }else if(el.tagName==="SELECT"){
        e[ou]=(ou==="ep")?parseFloat(el.value):el.value;
      }else{
        const v=parseFloat(String(el.value).replace(",","."));
        if(!isFinite(v)||v<0)return;
        /* Une ÉPAISSEUR est une longueur et suit l'unité d'affichage ; une
           permittivité et une tangente de pertes n'en sont pas, et n'ont
           d'unité dans aucun système. */
        e[ou]=(ou==="ep")?conLire(v):v;
        /* Une valeur tapée à la main ne vient plus d'une notice : la fiche
           doit cesser de prétendre le contraire. */
        if(ou==="er"||ou==="df")rendre=true;
      }
      /* CE QUI EST RETOUCHÉ N'EST PLUS UN EMPILAGE DE CATALOGUE. Le nom du
         modèle est donc lâché : il désignait une commande possible, et une
         épaisseur reprise à la main n'en est plus une. Le NOM et le RÔLE
         d'une couche, eux, ne changent rien à ce qu'on commande — un plan de
         masse et une couche de signal se pressent pareil. */
      if(ou==="ep"||ou==="er"||ou==="df"||ou==="mat"||ou==="sorte")
        CON.modele="";
      if(rendre)conAppliquer(false);
      else conMajDifferee();
    };
    if(el.tagName==="SELECT")el.onchange=function(){ appliquer(true); };
    else el.oninput=function(){ appliquer(false); };
    if(el.type==="number"||el.type==="text")
      el.onchange=function(){ appliquer(true); };
  });

  /* La coupe : une ligne cliquée ouvre la fiche de cette couche. C'est la
     seule façon de régler un empilage à huit couches sans dérouler dix-sept
     fiches — et c'est aussi ainsi qu'on lit une feuille d'empilage. */
  box.querySelectorAll("[data-con-voir]").forEach(function(tr){
    tr.onclick=function(){
      CON.pileSel=+tr.dataset.conVoir;
      conPanneauRendre();
    };
  });

  /* Le modèle d'usine. Il peut changer le nombre de couches — « 4 couches
     FR-4 1,0 mm » depuis un double face —, et `conAppliquerModele` s'en
     charge : ce n'est pas au panneau de décider si l'empilage se retouche ou
     se refait. */
  box.querySelectorAll("[data-con-modele],[data-con-modele-bouton]").forEach(
    function(el){
      const id=el.dataset.conModeleBouton;
      const faire=function(v){
        if(!v)return;                       // « empilage libre » : rien à poser
        const avant=conCuivres().length;
        conAppliquerModele(v);
        const m=conModeleEmpilage(v);
        if(m&&m.n!==avant){
          const susp=conPortsSuspects();
          hint("Empilage « "+m.nom+" » posé : "+m.n+" couches de cuivre."+
               (susp.length?" ⚠ Le port "+susp.join(", ")+" relie deux couches "+
                "qui ne sont plus voisines : reprenez-le à l'étape « Les "+
                "ports ».":""));
        }
        CON.pileSel=0;
        conAppliquer(false);
      };
      if(id)el.onclick=function(){ faire(id); };
      else el.onchange=function(){ faire(el.value); };
    });

  /* Le nombre de couches. Les formes dessinées sur une couche interne qui
     disparaît sont reportées et COMPTÉES : c'est la seule chose que
     l'utilisateur ne peut pas voir tout seul sur le dessin. */
  box.querySelectorAll("[data-con-ncu],[data-con-ncu-bouton]").forEach(
    function(el){
      const b=el.dataset.conNcuBouton;
      const faire=function(n){
        if(!(n>0))return;
        if(n===conCuivres().length)return;
        const r=conPileVers(n);
        if(!r)return;
        CON.pileSel=0;
        const susp=conPortsSuspects();
        hint("Empilage « "+r.modele.nom+" » posé"+
             (r.deplacees?" — "+r.deplacees+" forme(s) reportée(s) sur une "+
              "couche voisine : leur couche d'origine n'existe plus.":".")+
             (susp.length?" ⚠ Le port "+susp.join(", ")+" relie deux couches "+
              "qui ne sont plus voisines : reprenez-le à l'étape « Les ports », "+
              "sans quoi l'antenne sera alimentée en travers de sa masse.":""));
        conAppliquer(false);
      };
      if(b)el.onclick=function(){ faire(+b); };
      else el.onchange=function(){ faire(+el.value); };
    });

  box.querySelectorAll("[data-con-demarrer]").forEach(function(b){
    b.onclick=function(){
      CON.demarrage=false;
      conPanneauRendre();
      hint("Empilage arrêté. Les cotes des motifs sont maintenant calculées "+
           "sur ce substrat.");
    };
  });

  box.querySelectorAll("[data-con-cible]").forEach(function(el){
    el.onchange=function(){
      const v=parseFloat(String(el.value).replace(",","."));
      if(!isFinite(v)||v<=0)return;
      CON.cible=conLire(v);
      conPanneauRendre();
    };
  });
  box.querySelectorAll("[data-con-ajuster]").forEach(function(b){
    b.onclick=function(){
      if(!conAjusterEpaisseur()){
        hint("Épaisseur visée intenable : le cuivre et le masque font déjà "+
             "plus que ce qui est demandé. Le diélectrique ne peut pas être "+
             "négatif.");
        return;
      }
      CON.modele="";
      conAppliquer(false);
    };
  });
  box.querySelectorAll("[data-con-masque]").forEach(function(b){
    b.onclick=function(){
      const a=conMasques();
      conMasquePoser(!(a.haut||a.bas));
      CON.pileSel=0;
      if(!(a.haut||a.bas))
        hint("Masque posé : il abaisse la résonance d'environ 1 %, et allonge "+
             "le calcul d'environ moitié — le pas de temps FDTD suit ses "+
             "25 µm. On le retire tant que la géométrie bouge.");
      conAppliquer(false);
    };
  });
  box.querySelectorAll("[data-con-symetriser]").forEach(function(b){
    b.onclick=function(){ conSymetriser(); CON.modele=""; conAppliquer(false); };
  });

  box.querySelectorAll("[data-con-pile-suppr]").forEach(function(b){
    b.onclick=function(){
      conRetirerCouche(+b.dataset.conPileSuppr);
      CON.pileSel=Math.min(CON.pileSel,Math.max(CON.pile.length-1,0));
      conAppliquer(false);
    };
  });
  box.querySelectorAll("[data-con-ajout-couche]").forEach(function(b){
    b.onclick=function(){ conAjouterCouche(); conAppliquer(false); };
  });

  /* -- les motifs d'antenne --
     La fréquence se lit à la frappe et l'aperçu suit ; la galerie, elle, ne
     se refait qu'au relâchement du champ (`onchange`), sinon on perdrait le
     curseur au milieu de « 2,45 ». */
  box.querySelectorAll("[data-con-f]").forEach(function(el){
    el.oninput=function(){
      const v=parseFloat(String(el.value).replace(",","."));
      if(!isFinite(v)||v<=0)return;
      CON.fcible=v*antKf();
      conGabaritRafraichir();
      conApercuMaj();
    };
    el.onchange=function(){ conPanneauRendre(); };
  });
  /* ON CHANGE L'UNITÉ, PAS LA FRÉQUENCE : 2,45 GHz reste 2,45 GHz quand on
     passe en MHz, il s'écrit 2450. L'inverse — garder le nombre et changer
     l'unité — est la faute que cette liste existe pour empêcher. L'assistant
     est refait avec : c'est SON unité, et son étape « La bande » l'affiche. */
  box.querySelectorAll("[data-con-uf]").forEach(function(el){
    el.onchange=function(){
      if(!ANT_UNITES_F[el.value])return;
      ANT.uniteF=el.value;
      conPanneauRendre();
      if(typeof antAssistantRendre==="function")antAssistantRendre();
    };
  });
  box.querySelectorAll("[data-con-gabarit]").forEach(function(b){
    b.onclick=function(){
      /* Choisir un motif n'écrit RIEN : cela ouvre sa fiche, avec les cotes
         du calcul. Rechoisir le même la referme. */
      const id=b.dataset.conGabarit;
      CON.gabarit=(CON.gabarit===id)?null:id;
      CON.gabaritTouche={};
      CON_COTE_ON="";
      conGabaritRafraichir();
      conPanneauRendre();
    };
  });
  box.querySelectorAll("[data-con-motif-fermer]").forEach(function(b){
    b.onclick=function(){ CON.gabarit=null; conPanneauRendre(); };
  });
  box.querySelectorAll("[data-con-motif-calcul]").forEach(function(b){
    b.onclick=function(){
      CON.gabaritTouche={};
      conGabaritRafraichir();
      conPanneauRendre();
    };
  });
  box.querySelectorAll("[data-con-motif-poser]").forEach(function(b){
    b.onclick=function(){
      const g=conGabarit(CON.gabarit);
      if(g)conGabaritPoser(g,CON.gabaritP);
    };
  });
  box.querySelectorAll("[data-con-cote]").forEach(function(el){
    const ch=(conGabarit(CON.gabarit)||{champs:[]}).champs
      .find(c=>c.id===el.dataset.conCote);
    if(!ch)return;
    if(ch.booleen){
      el.onchange=function(){
        CON.gabaritP[ch.id]=el.checked?1:0;
        CON.gabaritTouche[ch.id]=true;
        conApercuMaj();
      };
      return;
    }
    el.oninput=function(){
      const v=parseFloat(String(el.value).replace(",","."));
      if(!isFinite(v))return;
      CON.gabaritP[ch.id]=ch.entier?Math.max(1,Math.round(v)):conLire(v);
      CON.gabaritTouche[ch.id]=true;
      conApercuMaj();
    };
    /* Le champ qu'on règle allume sa cote sur le dessin : c'est ce qui dit
       QUELLE longueur on est en train de changer, sans avoir à deviner le
       nom. */
    el.onfocus=function(){ CON_COTE_ON=ch.id; conCoteAllumer(ch.id); };
    el.onblur =function(){ CON_COTE_ON="";    conCoteAllumer(""); };
    /* Le survol allume aussi : on parcourt la liste des cotes à la souris
       pour SAVOIR laquelle est laquelle, avant d'en toucher une. */
    el.onmouseenter=function(){ conCoteAllumer(ch.id); };
    el.onmouseleave=function(){ conCoteAllumer(CON_COTE_ON); };
  });
  /* Le dessin de la fiche vient d'être écrit par conPanneauRendre : ses cotes
     n'ont encore aucun gestionnaire. */
  conApercuLier();

  /* -- les outils -- */
  box.querySelectorAll("[data-con-outil]").forEach(function(b){
    b.onclick=function(){
      CON.outil=b.dataset.conOutil;
      CON.courant=null;
      document.body.classList.toggle("con-dessin",CON.outil!=="select");
      conPanneauRendre();
      hint(conAide());
      redessiner();
    };
  });
  box.querySelectorAll("[data-con-reglage]").forEach(function(el){
    const ecrire=function(){
      const ou=el.dataset.conReglage;
      if(el.tagName==="SELECT"){
        CON[ou]=(ou==="coucheActive")?+el.value:el.value;
      }else{
        const v=parseFloat(String(el.value).replace(",","."));
        if(!isFinite(v)||v<0)return;
        CON[ou]=conLire(v);
      }
      redessiner();
    };
    if(el.tagName==="SELECT")el.onchange=ecrire; else el.oninput=ecrire;
  });
  /* CHANGER D'UNITÉ NE CHANGE PAS LE DESSIN, et c'est le point : les cotes
     stockées restent en millimètres, seule leur écriture change. Le panneau
     entier est refait pour que tous les champs passent d'un coup. */
  box.querySelectorAll("[data-con-unite]").forEach(function(el){
    el.onchange=function(){
      if(CON_UNITES[el.value]){
        CON.unite=el.value;
        conPanneauRendre();
      }
    };
  });
  box.querySelectorAll("[data-con-trou]").forEach(function(el){
    el.onchange=function(){ CON.trou=el.checked; };
  });

  /* -- les formes -- */
  box.querySelectorAll("[data-con-choisir]").forEach(function(d){
    d.addEventListener("pointerdown",function(e){
      if(e.target.closest("input,select,button"))return;
      CON.sel=+d.dataset.conChoisir;
      conPanneauRendre();
      redessiner();
    });
  });
  box.querySelectorAll("[data-con-el-suppr]").forEach(function(b){
    b.onclick=function(){
      CON.elements.splice(+b.dataset.conElSuppr,1);
      CON.sel=-1;
      conAppliquer(false);
    };
  });
  box.querySelectorAll("[data-con-el]").forEach(function(el){
    const ecrire=function(rendre){
      const o=CON.elements[+el.dataset.conEl];
      if(!o)return;
      const ou=el.dataset.ou;
      if(el.tagName==="SELECT"){
        o[ou]=(ou==="cu")?+el.value:el.value;
        conAppliquer(false);
        return;
      }
      /* Toutes les cotes d'une forme sont des longueurs : la conversion
         est donc sans exception ici. */
      const v=conLire(parseFloat(String(el.value).replace(",",".")));
      if(!isFinite(v))return;
      if(ou==="pt"){
        const k=+el.dataset.k;
        o.pts[k>>1][k&1]=v;
      }else if(ou==="dx"){
        /* La cote qu'on tape est une DIMENSION, pas un second coin : c'est
           ainsi qu'on dimensionne un patch, et c'est la seule façon de taper
           « 38,2 mm de long » sans faire l'addition de tête. */
        const x1=Math.min(o.x1,o.x2);
        o.x1=x1; o.x2=x1+Math.abs(v);
      }else if(ou==="dy"){
        const y1=Math.min(o.y1,o.y2);
        o.y1=y1; o.y2=y1+Math.abs(v);
      }else if(ou==="x1"){
        const d=v-Math.min(o.x1,o.x2); o.x1+=d; o.x2+=d;
      }else if(ou==="y1"){
        const d=v-Math.min(o.y1,o.y2); o.y1+=d; o.y2+=d;
      }else o[ou]=v;
      conArrondir(o);
      if(rendre)conAppliquer(false);
      else conMajDifferee();
    };
    if(el.tagName==="SELECT")el.onchange=function(){ ecrire(true); };
    else{ el.oninput=function(){ ecrire(false); }; }
  });
}

/* ==========================================================================
   Les branchements
   ========================================================================== */
window.addEventListener("DOMContentLoaded",function(){
  const b=document.getElementById("bConcevoir");
  if(b)b.onclick=function(){ CON.actif?conSortir():conEntrer(); };
  const b2=document.getElementById("bConcevoir2");
  if(b2)b2.onclick=conEntrer;
  conPanneauRendre();
});
