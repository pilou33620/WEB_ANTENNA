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

   CE MODULE NE DESSINE PAS LES CHAMPS. Les fichiers sont des `.vtr`, et rien
   dans une page web ne sait les lire ; ParaView, si. Le serveur le cherche
   sur le poste et l'ouvre — à défaut, il ouvre le dossier, ce qui laisse
   chacun libre de son outil.
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
    <small>pour les regarder dans ParaView après le calcul. À cocher
    <b>avant</b> de lancer : un calcul déjà fait ne peut plus en produire.</small></label>
</div>

${d.actif?`
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
  const eut=ANT.modele&&ANT.modele.dumps&&ANT.modele.dumps.actif;
  return `
<div class="champ actions">
  <button class="tb" id="bParaview"${pv?"":" disabled"}>📈 Ouvrir dans ParaView</button>
  <button class="tb" id="bDossier">📁 Ouvrir le dossier de calcul</button>
</div>
<p class="note" id="voirDit" hidden></p>
${pv?"":'<p class="note alerte">ParaView est introuvable sur ce poste : posez-le '+
  'à côté de web_antenna.py, ou ouvrez le dossier et servez-vous de votre outil.</p>'}
${eut?"":'<p class="note">Aucun champ n\'a été enregistré pour ce calcul — '+
  'la case est plus haut, et elle doit être cochée <b>avant</b> de lancer.</p>'}`;
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
}
