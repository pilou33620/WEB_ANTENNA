"use strict";
/* =============================================================================
   Antenne openEMS — 18-champs.js
   Enregistrer les champs, et aller les regarder.

   CE QU'ON VIENT CHERCHER. Un S₁₁ dit que l'antenne résonne à 2,37 GHz ; il
   ne dit pas POURQUOI. La carte du courant de surface, elle, le montre d'un
   coup d'œil — et l'on voit tout de suite que le courant fait le tour d'une
   fente qu'on n'avait pas remarquée, ou qu'il se perd dans un plan de masse
   trop court pour lui servir de contrepoids.

   LE DOMAINE FRÉQUENTIEL PLUTÔT QUE TEMPOREL, ET DE LOIN. Un enregistrement
   fréquentiel rend UN champ complexe par fréquence demandée : quelques
   fichiers, quelques mégaoctets. Un enregistrement temporel rend un fichier
   PAR PAS DE TEMPS — des dizaines de milliers — et remplit un disque en
   quelques minutes. Le temporel ne sert qu'à faire une animation ; pour
   comprendre, le fréquentiel suffit et coûte mille fois moins. C'est pour
   cela qu'il est le défaut, et que l'autre affiche son poids avant.

   CE MODULE NE DESSINE PAS LES CHAMPS, IL LES DEMANDE. Les fichiers sont
   des `.vtr` ; le serveur sait maintenant les lire (python/openems_champs.py)
   et la page sait les animer (js/32-visionneuse.js). Le bouton « Voir les
   champs » ouvre donc la carte ICI, sans rien installer. ParaView reste
   proposé à côté, pour ce qu'une carte plane ne montre pas — une coupe
   oblique, des lignes de champ, un rendu volumique — et le bouton
   « dossier » laisse chacun libre de son outil.
   ============================================================================= */

const ANT_CHAMPS={
  J:"densité de courant  ·  où passe le courant sur le cuivre",
  E:"champ électrique  ·  où se concentre la tension",
  H:"champ magnétique",
  I:"courant total (rot H)"
};

const ANT_REGIONS={
  plan_z:"un plan horizontal  ·  la vue qui montre le courant sur le cuivre",
  structure:"toute la structure  ·  carte et objets, sans l'air autour",
  coupe_x:"une coupe verticale, à X constant",
  coupe_y:"une coupe verticale, à Y constant",
  boite:"toute la boîte de calcul  ·  l'air compris, donc très lourd"
};

function antPoids(octets){
  if(!octets)return "—";
  const mo=octets/1048576;
  if(mo<1)return Math.round(octets/1024)+" ko";
  if(mo<1024)return Math.round(mo)+" Mo";
  return (mo/1024).toFixed(1).replace(".",",")+" Go";
}

/* Le morceau qui s'insère dans l'étape « Le calcul ».

   LES HAUTEURS DE L'EMPILAGE PASSENT PAR `antLongModele`, ET NON PAR `aNb`.
   Le modèle travaille en millimètres — c'est le serveur qui a converti, une
   fois —, alors que le champ « Hauteur Z » juste à côté est dans l'unité du
   fichier. Écrire « 1,600 mm » en face d'un champ étiqueté « in » met deux
   unités sur la même ligne, et l'on saisit alors une hauteur qui n'est pas
   celle qu'on vient de lire. La conversion est celle de 13-assistant.js. */
function antChampsHtml(){
  const d=ANT.dumps, m=ANT.modele;
  const info=(m&&m.dumps&&m.dumps.actif)?m.dumps:null;
  return `
<div class="champ">
  <label class="ck"><input type="checkbox" id="antDump"${d.actif?" checked":""}>
    Enregistrer les champs
    <small>pour les regarder — animés — dès la fin du calcul. À cocher
    <b>avant</b> de lancer : un calcul déjà fait ne peut plus en produire.</small></label>
</div>

${d.actif?`
${antChampsOuHtml()}
<div class="champ">
  <label>Quoi</label>
  <div class="cks">
    ${Object.keys(ANT_CHAMPS).map(t=>
      '<label class="ck"><input type="checkbox" data-champ="'+t+'"'+
      (d.types.indexOf(t)>=0?" checked":"")+'><b>'+t+'</b> '+
      aEsc(ANT_CHAMPS[t])+'</label>').join("")}
  </div>
</div>

<div class="champ">
  <label>Comment</label>
  <label class="rd"><input type="radio" name="antDumpMode" value="frequentiel"${d.mode==="frequentiel"?" checked":""}>
    <b>À la fréquence de résonance</b> <small>un champ complexe, quelques
    fichiers. C'est ce qu'il faut pour comprendre.</small></label>
  <label class="rd"><input type="radio" name="antDumpMode" value="temporel"${d.mode==="temporel"?" checked":""}>
    <b>Au cours du temps</b> <small>un fichier par pas de temps. Pour une
    animation — et pour rien d'autre, vu le prix.</small></label>
</div>

<div class="champ">
  <label>Où</label>
  <select id="antDumpRegion">
    ${Object.keys(ANT_REGIONS).map(r=>
      '<option value="'+r+'"'+(d.region===r?" selected":"")+'>'+
      aEsc(ANT_REGIONS[r])+'</option>').join("")}
  </select>
  ${d.region==="plan_z"?`<div class="ligne">
    <span><label>Hauteur Z</label><input type="text" inputmode="decimal" spellcheck="false" id="antDumpZ" value="${mdlNb(d.z)}"></span>
    <span class="unite">${antUnite()}</span>
    <span class="note-inline">Le cuivre du dessus est à
      ${ANT.modele?antLongModele(ANT.modele.conducteurs[ANT.modele.conducteurs.length-1].z0,3):"—"},
      celui du dessous à 0.</span>
  </div>`:""}
  ${d.region==="coupe_x"?`<div class="ligne">
    <span><label>Abscisse X</label><input type="text" inputmode="decimal" spellcheck="false" id="antDumpX" value="${mdlNb(d.x)}"></span>
    <span class="unite">${antUnite()}</span></div>`:""}
  ${d.region==="coupe_y"?`<div class="ligne">
    <span><label>Ordonnée Y</label><input type="text" inputmode="decimal" spellcheck="false" id="antDumpY" value="${mdlNb(d.y)}"></span>
    <span class="unite">${antUnite()}</span></div>`:""}
</div>

<div class="champ ligne">
  <span><label>Une cellule sur</label>
    <input type="text" inputmode="numeric" spellcheck="false" id="antDumpSous" value="${d.sous_ech}"></span>
  <span class="note-inline">Un champ vu une cellule sur deux se lit aussi
    bien et pèse huit fois moins.</span>
</div>

${info?`<div class="recap">
  <span>${aEnt(info.cellules)} cellules enregistrées</span>
  <span class="${info.octets>200*1048576?"alerte":""}">≈ ${antPoids(info.octets)} sur le disque</span>
</div>`:""}
`:""}`;
}

/* OÙ LES FICHIERS VONT ATTERRIR, ET CE QUE ÇA CHANGE.

   C'est la question qu'on ne se pose jamais avant, et toujours trop tard. Un
   calcul lancé sans projet ouvert écrit ses champs dans le dossier temporaire
   du système : quelques centaines de méga-octets que Windows efface au
   premier nettoyage de disque, sans prévenir. Les courbes, elles, tiennent
   dans le projet qu'on enregistrera après coup — les champs, non, parce
   qu'ils ne sont pas dans la page mais sur le disque du serveur.

   Depuis que « Enregistrer » range aussi le dossier de calcul (28-projet.js),
   ce n'est plus une perte sèche : c'est un geste à ne pas oublier. L'avis
   ci-dessous le dit AVANT, là où la décision se prend, plutôt que de laisser
   découvrir la chose des mois plus tard devant un « cette simulation n'existe
   plus ». */
function antChampsOuHtml(){
  const prj=(typeof PRJ!=="undefined"&&PRJ.dispo)?PRJ:null;
  if(!prj)return "";
  if(prj.nom)
    return '<p class="note">Les fichiers iront dans le projet '+
      '<b>'+aEsc(prj.nom)+'</b>, sous <code>calculs/</code> : ils y restent.</p>';
  return '<p class="note alerte">Aucun projet n\'est ouvert : les fichiers '+
    'iront dans le <b>dossier temporaire du système</b>, que Windows vide '+
    'sans prévenir. Ils ne seront pas perdus pour autant — « Enregistrer » '+
    'dans le panneau « Projet » les rangera avec le reste, à la fin du '+
    'calcul comme avant.</p>';
}

function antChampsLier(box){
  const dump=box.querySelector("#antDump");
  if(!dump)return;
  dump.onchange=function(){ ANT.dumps.actif=this.checked; antMaj(true); };

  box.querySelectorAll("[data-champ]").forEach(function(b){
    b.onchange=function(){
      const t=b.dataset.champ, i=ANT.dumps.types.indexOf(t);
      if(b.checked&&i<0)ANT.dumps.types.push(t);
      if(!b.checked&&i>=0)ANT.dumps.types.splice(i,1);
      /* Tout décocher n'a pas de sens : le serveur retomberait sur « J » sans
         que la case le montre. On garde donc au moins celle-là. */
      if(!ANT.dumps.types.length){ ANT.dumps.types=["J"]; }
      antMaj(true);
    };
  });
  box.querySelectorAll('input[name="antDumpMode"]').forEach(function(r){
    r.onchange=function(){ ANT.dumps.mode=r.value; antMaj(true); };
  });
  const reg=box.querySelector("#antDumpRegion");
  if(reg)reg.onchange=function(){ ANT.dumps.region=this.value; antMaj(true); };

  const nb=function(id,cle,ent){
    const el=box.querySelector(id);
    if(!el)return;
    antLierNombre(el, ANT.dumps, cle, {entier: !!ent});
  };
  nb("#antDumpZ","z"); nb("#antDumpX","x"); nb("#antDumpY","y");
  nb("#antDumpSous","sous_ech",true);
}

/* ==========================================================================
   Aller regarder
   ========================================================================== */
/* Les deux boutons n'apparaissent qu'une fois un calcul terminé : proposer
   « ouvrir les champs » avant d'en avoir produit serait proposer une porte
   qui ne mène nulle part. */
function antVoirHtml(){
  const t=ANT.tache;
  if(!t||(t.etat!=="fini"&&t.etat!=="arrete"))return "";
  const pv=ANT.etatServeur&&ANT.etatServeur.paraview;
  const vis=!ANT.etatServeur||ANT.etatServeur.visionneuse!==false;
  const eut=ANT.modele&&ANT.modele.dumps&&ANT.modele.dumps.actif;
  const prj=(typeof PRJ!=="undefined"&&PRJ.dispo)?PRJ:null;
  return `
<div class="champ actions">
  <button class="tb on" id="bVoirChamps"${vis?"":" disabled"}>🎞 Voir les champs</button>
  <button class="tb" id="bDossier">📁 Ouvrir le dossier de calcul</button>
  ${pv?"<button class=\"tb\" id=\"bParaview\" title=\"Pour ce qu'une carte plane ne montre pas : coupe oblique, lignes de champ, rendu volumique\">📈 ParaView</button>":""}
</div>
${prj?`<div class="champ actions">
  <button class="tb${prj.modifie?" on":""}" id="bToutGarder">💾 ${prj.nom
    ? "Tout enregistrer dans « "+aEsc(prj.nom)+" »"
    : "Tout enregistrer dans un projet"}</button>
</div>
<p class="note">${antGarderNoteHtml()}</p>`:""}
<p class="note" id="voirDit" hidden></p>
${eut?"":"<p class=\"note\">Aucun champ n'a été enregistré pour ce calcul — "+
  "la case est plus haut, et elle doit être cochée <b>avant</b> de lancer.</p>"}`;
}

/* ==========================================================================
   Les dossiers de calcul du projet
   --------------------------------------------------------------------------
   CE QUE CE BLOC RÉPARE. Un projet accumule un dossier de calcul par
   simulation lancée ; `resultats.json`, lui, n'en retient qu'UN : le dernier.
   Après cinq simulations, cinq dossiers sont sur le disque avec leurs champs,
   et la page n'en atteignait qu'un seul. Les quatre autres étaient là,
   parfaitement lisibles, et il fallait ouvrir ParaView à la main pour les
   revoir — alors que la visionneuse est à deux clics.

   ET CE QU'IL AJOUTE. Le même endroit sert à faire ENTRER un dossier qui n'y
   était pas : celui d'un collègue, d'une clé USB, d'un calcul mené à la main
   sur une autre machine. Le serveur le copie dans `<projet>/calculs/` sous un
   identifiant neuf, et il devient un calcul comme les autres — visible dans
   cette liste, lisible par la visionneuse, emporté avec le projet.

   POURQUOI UNE COPIE ET NON UNE LECTURE SUR PLACE. Parce qu'un dossier
   désigné par son chemin peut disparaître : la clé se retire, le partage se
   déconnecte, et le projet garderait une référence vers rien. Copier coûte
   le temps d'une copie, une fois, et rend le projet complet — c'est la même
   raison qui fait qu'« Enregistrer » range le dossier de calcul plutôt que
   d'en noter l'adresse.
   ========================================================================== */
const ANT_CALC={
  ouvert:false,        // la liste est-elle dépliée
  liste:null,          // ce que le serveur a répondu, null tant qu'on n'a pas demandé
  erreur:"",
  occupe:false,
  chemin:"",           // ce qui est tapé dans le champ d'import
  dit:""               // la réponse au dernier geste
};

function antCalcDate(ms){
  if(!ms)return "—";
  const d=new Date(ms);
  if(isNaN(d.getTime()))return "—";
  const auj=new Date();
  const h=String(d.getHours()).padStart(2,"0")+":"+
          String(d.getMinutes()).padStart(2,"0");
  return (d.toDateString()===auj.toDateString())
    ? ("aujourd'hui à "+h)
    : (d.toLocaleDateString("fr-FR")+" à "+h);
}

function antCalcLigneHtml(c){
  const courant=!!(ANT.tache&&ANT.tache.id===c.id);
  const vu=(typeof CHP!=="undefined"&&CHP.id===c.id);
  const imp=c.importe;
  const marques=[antCalcDate((c.modifie||0)*1000)];
  marques.push(c.vtr ? (c.vtr+" fichier"+(c.vtr>1?"s":"")+" de champ")
                     : "aucun champ");
  if(c.octets)marques.push(antPoids(c.octets));
  return '<div class="prj-ligne'+(vu?" prj-ouvert":"")+'">'+
    '<button class="prj-nom" data-calc="'+aEsc(c.id)+'" '+
      'data-calc-nom="'+aEsc(imp&&imp.nom?imp.nom:c.id)+'"'+
      (c.vtr?'':' disabled')+
      ' title="'+(c.vtr?"Regarder les champs de ce calcul"
                      :"Ce dossier ne contient aucun champ à regarder")+'">'+
      (imp&&imp.nom?("📥 "+aEsc(imp.nom)):aEsc(c.id))+
      (courant?'  <span class="alerte">· le calcul en cours</span>':"")+
      '</button>'+
    '<div class="prj-sous">'+marques.join(" · ")+'</div>'+
    (imp&&imp.source
      ? '<div class="prj-sous">importé de '+aEsc(imp.source)+'</div>'
      : (imp?"":'<div class="prj-sous">'+aEsc(c.id)+'</div>'))+
    '</div>';
}

function antCalcHtml(){
  const prj=(typeof PRJ!=="undefined"&&PRJ.dispo)?PRJ:null;
  if(!prj)return "";
  if(!ANT_CALC.ouvert)
    return '<div class="champ actions">'+
      '<button class="tb" id="bCalcListe">📂 Dossiers de calcul du projet'+
      '</button></div>';

  let corps;
  if(!prj.nom)
    corps='<p class="note">Aucun projet ouvert : il n\'y a pas encore de '+
      'dossier où ranger des calculs. Donnez un nom au projet dans le '+
      'panneau « Projet », puis « Enregistrer ».</p>';
  else if(ANT_CALC.erreur)
    corps='<p class="note alerte">'+aEsc(ANT_CALC.erreur)+'</p>';
  else if(ANT_CALC.liste===null)
    corps='<p class="note">Lecture du dossier…</p>';
  else if(!ANT_CALC.liste.length)
    corps='<p class="note">Ce projet n\'a encore aucun dossier de calcul. '+
      'Lancez une simulation, ou importez un dossier ci-dessous.</p>';
  else
    corps='<div class="prj-liste">'+
      ANT_CALC.liste.map(antCalcLigneHtml).join("")+'</div>';

  return `
<div class="champ">
  <label>Dossiers de calcul du projet
    <small>du plus récent au plus ancien. Un projet en garde un par
    simulation lancée ; les courbes, elles, ne reviennent que pour le
    dernier.</small></label>
  ${corps}
</div>
${prj.nom?`<div class="champ">
  <label>Importer un dossier de calcul
    <small>celui d'un collègue, d'une clé USB, d'un calcul mené ailleurs. Il
    est <b>copié</b> dans le projet — l'original n'est ni déplacé ni
    modifié.</small></label>
  <div class="ligne">
    <span style="flex:1 1 auto"><input type="text" id="antCalcChemin"
      value="${aEsc(ANT_CALC.chemin)}" spellcheck="false"
      placeholder="D:\\calculs\\mon-patch ou \\\\serveur\\partage\\run"></span>
    <span><button class="tb mini" id="bCalcImport"${ANT_CALC.occupe?" disabled":""}
      >${ANT_CALC.occupe?"⏳ Copie…":"Importer"}</button></span>
  </div>
  <p class="note">Le chemin est celui du <b>poste qui fait tourner le
    serveur</b>, et non celui du navigateur : un lecteur réseau doit y être
    connecté. Seuls les fichiers d'un dossier de calcul sont copiés — les
    <code>.vtr</code> des champs, le script, le journal — et un seul niveau
    de sous-dossier.</p>
</div>`:""}
${ANT_CALC.dit?'<p class="note'+(ANT_CALC.erreur?" alerte":"")+'">'+
  aEsc(ANT_CALC.dit)+'</p>':""}
<div class="champ actions">
  <button class="tb mini" id="bCalcFermer">Replier la liste</button>
  <button class="tb mini" id="bCalcRelire">↻ Relire</button>
</div>`;
}

async function antCalcCharger(){
  ANT_CALC.erreur="";
  if(typeof prjCalculs!=="function"){
    ANT_CALC.liste=[];
    ANT_CALC.erreur="La gestion des projets n'est pas chargée.";
    return;
  }
  try{
    const r=await prjCalculs();
    ANT_CALC.liste=Array.isArray(r.calculs)?r.calculs:[];
  }catch(e){
    ANT_CALC.liste=[];
    ANT_CALC.erreur="Liste impossible : "+(e.message||e);
  }
}

function antCalcLier(box){
  /* `antAssistantRendre(true)` ET NON `antAssistantRendre()`. Sans le
     forçage, l'assistant ne repeint que lorsqu'on CHANGE d'étape : la liste
     se serait dépliée dans l'état sans rien changer à l'écran. Le forçage,
     lui, respecte une saisie en cours — il ne détruit pas le champ sous le
     curseur, et le chemin tapé est de toute façon retenu dans `ANT_CALC`. */
  const refaire=function(){
    antAssistantRendre(true);
  };
  const b=box.querySelector("#bCalcListe");
  if(b)b.onclick=async function(){
    ANT_CALC.ouvert=true; ANT_CALC.liste=null; ANT_CALC.dit="";
    refaire();
    await antCalcCharger();
    refaire();
  };
  const bf=box.querySelector("#bCalcFermer");
  if(bf)bf.onclick=function(){ ANT_CALC.ouvert=false; refaire(); };
  const br=box.querySelector("#bCalcRelire");
  if(br)br.onclick=async function(){
    ANT_CALC.liste=null; ANT_CALC.dit=""; refaire();
    await antCalcCharger();
    refaire();
  };

  /* LE CHEMIN TAPÉ EST RETENU DANS L'ÉTAT, ET NON DANS LE CHAMP. L'étape se
     refait à chaque réglage touché ailleurs, et un `innerHTML` sous le
     curseur perd la frappe en cours — c'est la même précaution que prend le
     panneau des projets. */
  const ch=box.querySelector("#antCalcChemin");
  if(ch)ch.oninput=function(){ ANT_CALC.chemin=this.value; };

  const bi=box.querySelector("#bCalcImport");
  if(bi)bi.onclick=async function(){
    const chemin=(ANT_CALC.chemin||"").trim();
    if(!chemin){
      ANT_CALC.erreur=""; ANT_CALC.dit="Indiquez le dossier à importer.";
      refaire();
      return;
    }
    ANT_CALC.occupe=true; ANT_CALC.erreur=""; ANT_CALC.dit="Copie en cours…";
    refaire();
    try{
      const r=await prjImporterCalcul(chemin);
      ANT_CALC.dit=r.fichiers+" fichier"+(r.fichiers>1?"s":"")+" copié"+
        (r.fichiers>1?"s":"")+" ("+antPoids(r.octets)+", dont "+r.vtr+
        " de champ)"+
        (r.ignores?(" — "+r.ignores+" fichier(s) sans rapport avec un "+
                    "calcul ont été laissés de côté"):"")+".";
      ANT_CALC.chemin="";
    }catch(e){
      ANT_CALC.erreur=String(e.message||e);
      ANT_CALC.dit=ANT_CALC.erreur;
    }finally{
      ANT_CALC.occupe=false;
    }
    if(!ANT_CALC.erreur)await antCalcCharger();
    refaire();
  };

  for(const bc of box.querySelectorAll("[data-calc]")){
    if(bc.disabled)continue;
    bc.onclick=function(){
      if(typeof chpOuvrirCalcul!=="function"){
        ANT_CALC.dit="La visionneuse de champs n'est pas chargée.";
        refaire();
        return;
      }
      chpOuvrirCalcul(bc.dataset.calc,bc.dataset.calcNom);
    };
  }
}

/* LE RAPPEL D'APRÈS-CALCUL, ET POURQUOI IL EST ICI PLUTÔT QUE DANS LE
   PANNEAU « PROJET ».

   Parce que c'est ici qu'on regarde quand le calcul vient de finir. Le
   panneau des projets, lui, on l'ouvre quand on a déjà décidé d'enregistrer
   — c'est-à-dire précisément la décision qu'on ne prend pas, deux heures
   après avoir lancé, quand la courbe s'affiche et qu'on veut d'abord la
   lire. Ce bouton ne fait rien de plus que celui du panneau : le même
   `prjEnregistrerTout`, à l'endroit où l'on est. */
function antGarderNoteHtml(){
  const prj=(typeof PRJ!=="undefined"&&PRJ.dispo)?PRJ:null;
  if(!prj)return "";
  const dossier=(ANT.tache&&ANT.tache.dossier)||"";
  const range=!!(prj.nom&&dossier&&prj.racine&&
                 dossier.indexOf(prj.racine)===0);
  if(range&&!prj.modifie)
    return "Tout est sur le disque : le document, les courbes, et le dossier "+
      "de calcul avec ses champs.";
  if(range)
    return "Le dossier de calcul est déjà dans le projet ; les courbes et "+
      "les réglages de ce calcul, eux, ne sont pas encore écrits.";
  return "Le dossier de calcul est dans le dossier temporaire du système. "+
    "Enregistrer le range dans le projet, avec les courbes et les réglages "+
    "— c'est le seul geste qui garde les champs pour plus tard.";
}

function antVoirLier(box){
  /* LA RÉPONSE S'ÉCRIT SOUS LE BOUTON, ET PLUS SEULEMENT DANS LE PIED DE PAGE.
     Le cas courant n'est pas la réussite : c'est « aucun champ enregistré »,
     parce que la case se coche AVANT de lancer et qu'on y pense après. Ce
     refus-là arrivait dans `hint()`, à l'autre bout de l'écran, sur une ligne
     que le clic n'attire pas — et le bouton avait l'air de ne rien faire. */
  const dire=function(texte,ok){
    const el=box.querySelector("#voirDit");
    if(el){ el.textContent=texte; el.hidden=false;
            el.className="note"+(ok?"":" alerte"); }
    hint(texte);
  };
  const appel=async function(route,bouton){
    if(!ANT.tache)return;
    bouton.disabled=true;
    try{
      const r=await oePost(route+"?id="+encodeURIComponent(ANT.tache.id),{});
      dire(r.detail || (r.lance==="paraview"
        ? ("ParaView ouvert sur "+r.fichiers+" fichier(s) de champ.")
        : ("Dossier ouvert : "+r.dossier)), !r.detail);
    }catch(e){
      dire("Impossible : "+(e.message||e), false);
    }finally{ bouton.disabled=false; }
  };
  const pv=box.querySelector("#bParaview");
  if(pv&&!pv.disabled)pv.onclick=function(){ appel("/api/openems/paraview",pv); };
  const bd=box.querySelector("#bDossier");
  if(bd)bd.onclick=function(){ appel("/api/openems/dossier",bd); };

  /* LA VISIONNEUSE INTERNE NE PASSE PAS PAR `appel` : elle n'ouvre pas un
     programme du poste, elle ouvre un panneau — et c'est lui qui dira ce
     qu'il a trouvé, ou ce qui manque. */
  const vc=box.querySelector("#bVoirChamps");
  if(vc&&!vc.disabled)vc.onclick=function(){
    if(typeof chpOuvrir!=="function"){
      dire("La visionneuse de champs n'est pas chargée.",false);
      return;
    }
    /* CE BOUTON DIT « LES CHAMPS », SOUS-ENTENDU CEUX DU CALCUL QU'ON VIENT
       DE FAIRE. Il lève donc un dossier choisi à la main dans la liste des
       calculs du projet : sans cela, on cliquerait « Voir les champs » après
       une nouvelle simulation et l'on reverrait ceux d'avant-hier. */
    chpOuvrirCalcul(ANT.tache&&ANT.tache.id);
  };

  /* « TOUT ENREGISTRER » SANS NOM DE PROJET NE PEUT PAS DEVINER. On n'invente
     pas un nom à la place de quelqu'un — un dossier « sans-titre-3 » sur le
     disque ne se retrouve pas —, alors on ouvre le panneau et l'on met le
     curseur dans le champ. Le geste s'y termine, par le même bouton. */
  const bg=box.querySelector("#bToutGarder");
  if(bg)bg.onclick=async function(){
    if(typeof prjEnregistrerTout!=="function"){
      dire("La gestion des projets n'est pas chargée.",false);
      return;
    }
    if(!PRJ.nom){
      if(typeof wsShow==="function")wsShow("projet");
      if(typeof prjRendre==="function")prjRendre();
      const champ=document.getElementById("prjNom");
      if(champ)champ.focus();
      dire("Donnez un nom au projet dans le panneau, puis « Enregistrer » : "+
           "le dossier de calcul et ses champs suivront.",true);
      return;
    }
    bg.disabled=true;
    const avant=bg.textContent;
    bg.textContent="⏳ Enregistrement…";
    try{
      const r=await prjEnregistrerTout(PRJ.nom);
      const dit="Projet « "+r.projet.nom+" » enregistré."+
                (typeof prjDireCalcul==="function"?prjDireCalcul(r.calcul):"");
      const ok=!(r.calcul&&r.calcul.erreur);
      /* L'ORDRE : refaire l'étape D'ABORD, écrire la réponse ENSUITE. Le
         bouton et la note du dessus changent de texte une fois le dossier
         rangé, et `antAssistantRendre` remplace tout le bloc — y compris le
         paragraphe où `dire` vient d'écrire. */
      if(typeof prjRendre==="function")prjRendre();
      antAssistantRendre();
      const el=document.getElementById("voirDit");
      if(el){ el.textContent=dit; el.hidden=false;
              el.className="note"+(ok?"":" alerte"); }
      hint(dit);
    }catch(e){
      dire("Enregistrement impossible : "+(e.message||e), false);
      bg.disabled=false; bg.textContent=avant;
    }
  };
}
