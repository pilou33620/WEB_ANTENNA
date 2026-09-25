"use strict";
/* =============================================================================
   Antenne openEMS — 35-fils.js
   Les fils de calcul d'openEMS, et le banc de vitesse qui dit combien en mettre.

     POST /api/openems/fils?n=N      règle le poste (0 : openEMS choisit)
     POST /api/openems/banc/lancer   la même boîte vide, un essai par nombre de fils

   POURQUOI CE RÉGLAGE EXISTE. Laissé à lui-même, openEMS part d'UN fil et en
   ajoute un tant que la vitesse monte ; le tâtonnement s'arrête souvent à deux
   ou trois, quel que soit le nombre de cœurs. Une carte de 10,8 millions de
   cellules a ainsi tourné à 7 % du processeur pendant des heures.

   POURQUOI UN BANC ET NON « TOUS LES CŒURS ». Le FDTD est borné par la
   mémoire : chaque pas relit tout le maillage pour très peu de calcul. Passé
   quelques fils, un de plus ne fait que disputer la bande passante aux autres
   — sur un poste à dix cœurs, huit fils allaient plus vite que douze. Le bon
   nombre dépend de la machine ; il se mesure en une à deux minutes.

   LE RÉGLAGE APPARTIENT AU POSTE, pas à l'antenne : le serveur le range dans
   ses réglages, comme le débit mesuré, et il vaut pour tous les projets.

   LE BANC N'EMPRUNTE PAS ANT.tache. Il la remplacerait, et avec elle le
   dernier calcul, son journal et ses résultats : on perdrait l'antenne pour
   avoir chronométré la machine. Il a donc son suivi à lui, ici.
   ============================================================================= */

const ANT_FILS={tache:null, suivi:0};

function antFilsEtat(){
  return (ANT.etatServeur&&ANT.etatServeur.fils)||null;
}

/* Les mesures du banc, en nombres : celles du banc qui tourne si c'est le
   cas — la table se remplit sous les yeux —, sinon celles du dernier banc
   rangé sur ce poste. */
function antFilsMesures(){
  const t=ANT_FILS.tache;
  const brut=(t&&t.banc&&Object.keys(t.banc.mesures||{}).length)
    ? t.banc.mesures
    : ((antFilsEtat()||{}).banc||{});
  const out=[];
  for(const k in brut){
    const f=parseInt(k,10), v=Number(brut[k]);
    if(f>0&&isFinite(v))out.push({fils:f, mcps:v});
  }
  return out.sort((a,b)=>a.fils-b.fils);
}

/* Même règle que openems_modele.banc_meilleur : à 3 % près, le plus petit
   nombre gagne — l'écart est dans le bruit, et un fil de moins laisse un
   cœur au reste du poste. */
function antFilsMeilleur(mes){
  if(!mes.length)return 0;
  const top=Math.max.apply(null,mes.map(m=>m.mcps));
  return Math.min.apply(null,mes.filter(m=>m.mcps>=0.97*top).map(m=>m.fils));
}

function antFilsEnCours(){
  const t=ANT_FILS.tache;
  return !!(t&&(t.etat==="calcule"||t.etat==="prepare"));
}

function antFilsHtml(){
  const e=ANT.etatServeur;
  const f=antFilsEtat();
  if(!e||!e.lancer||!f)return "";
  const mes=antFilsMesures();
  const best=antFilsMeilleur(mes);
  const parFils={};
  mes.forEach(m=>{ parFils[m.fils]=m.mcps; });

  /* Le menu va jusqu'au nombre de cœurs logiques, et pas plus loin : au-delà,
     deux fils se partagent un cœur, et la mesure l'a déjà dit. Un réglage
     rangé plus haut (poste changé depuis) reste proposé, pour qu'on le voie. */
  const n=Math.max(f.coeurs||1, f.regle||0);
  let opts='<option value="0"'+(f.regle===0?" selected":"")+'>Auto — openEMS tâtonne</option>';
  for(let i=1;i<=n;i++){
    const v=parFils[i];
    opts+='<option value="'+i+'"'+(f.regle===i?" selected":"")+'>'+i+' fil'+(i>1?"s":"")+
      (v!=null?" — "+aNb(v,0)+" MC/s au banc":"")+(i===best?"  ★ le plus rapide":"")+
      '</option>';
  }

  const encours=antFilsEnCours();
  const t=ANT_FILS.tache;
  const calcul=ANT.tache&&(ANT.tache.etat==="calcule"||ANT.tache.etat==="prepare");
  const essais=(t&&t.banc&&t.banc.essais)||f.essais||[];

  return `
<div class="champ" id="antFilsBloc">
  <label>Fils de calcul
    <small>Combien de cœurs openEMS emploie. En « Auto », il part d'un fil et
    en ajoute tant qu'il y gagne — et s'arrête souvent à deux ou trois. Ce
    poste a <b>${f.coeurs}</b> cœurs logiques ; le calcul étant borné par la
    mémoire, le plus rapide est rarement « tous ».</small></label>
  <div class="champ ligne">
    <span><select id="antFils">${opts}</select></span>
    <button class="tb" id="bBanc"${encours||calcul?" disabled":""}
      title="${calcul?"Un calcul tourne : le banc le mesurerait en même temps que le poste.":
               "Une boîte vide de 2,9 millions de cellules, un essai par nombre de fils."}">
      ${encours?"⏳ Banc en cours…":"⏱ Mesurer la vitesse du poste"}</button>
    ${best&&best!==f.regle&&!encours?'<button class="tb on" id="bFilsBest">Appliquer '+best+' fils</button>':""}
  </div>
  ${antFilsTableHtml(mes,best,essais,f.regle)}
  ${t&&t.etat==="echoue"?'<p class="note alerte">Le banc a échoué : '+aEsc(t.detail||"voir le journal du serveur")+'</p>':""}
  <p class="note">${antFilsNote(mes,best)}</p>
</div>`;
}

/* LA TABLE DIT LE RAPPORT, PAS SEULEMENT LA VITESSE. La boîte vide va bien
   plus vite qu'une antenne — ni PML, ni matériaux, ni enregistrements : 182
   MC/s contre 20 pour un patch, même poste, huit fils —, et son chiffre
   absolu ne promet rien. Ce qui se
   transporte d'une boîte vide à une vraie carte, c'est le gain d'un réglage
   sur l'autre : c'est lui qu'on écrit en gros. */
function antFilsTableHtml(mes,best,essais,regle){
  if(!mes.length&&!antFilsEnCours())return "";
  const top=Math.max(1,...mes.map(m=>m.mcps));
  const un=(mes.find(m=>m.fils===1)||{}).mcps||0;
  const faits={};
  mes.forEach(m=>{ faits[m.fils]=m; });
  const lignes=(antFilsEnCours()?essais:mes.map(m=>m.fils)).map(fl=>{
    const m=faits[fl];
    if(!m)return '<div class="fils-l attente"><span class="fils-n">'+fl+'</span>'+
                 '<span class="fils-barre"><i style="width:0"></i></span>'+
                 '<span class="fils-v">…</span><span class="fils-g"></span></div>';
    return '<div class="fils-l'+(fl===best?" best":"")+(fl===regle?" regle":"")+'">'+
      '<span class="fils-n">'+fl+'</span>'+
      '<span class="fils-barre"><i style="width:'+(100*m.mcps/top).toFixed(1)+'%"></i></span>'+
      '<span class="fils-v">'+aNb(m.mcps,0)+' MC/s</span>'+
      '<span class="fils-g">'+(un?"×"+aNb(m.mcps/un,2):"")+'</span></div>';
  }).join("");
  return '<div class="fils-banc">'+
    '<div class="fils-l tete"><span class="fils-n">fils</span><span class="fils-barre"></span>'+
    '<span class="fils-v">boîte vide</span><span class="fils-g">vs 1 fil</span></div>'+
    lignes+'</div>';
}

function antFilsNote(mes,best){
  const f=antFilsEtat()||{};
  if(antFilsEnCours())
    return "Le banc tourne : une boîte vide, le même nombre de pas, un nombre de fils "+
           "différent à chaque essai. Une à deux minutes ; ne lancez rien d'autre "+
           "entre-temps, cela fausserait les mesures.";
  if(!mes.length)
    return "Jamais mesuré sur ce poste. Le banc dure une à deux minutes et dit "+
           "quel nombre de fils va le plus vite <b>ici</b> — ce n'est pas le même "+
           "sur un portable et sur une station.";
  let t="Les valeurs sont celles d'une boîte vide, plus rapide qu'une antenne : "+
        "c'est le <b>rapport</b> entre deux réglages qui vaut pour vos calculs. "+
        "La durée annoncée plus haut est ramenée au réglage choisi.";
  if(f.regle===0)
    t+=" En « Auto », on ne sait pas d'avance où openEMS s'arrêtera : choisissez "+
       (best?"<b>"+best+" fils</b>":"un nombre")+" pour une durée fiable.";
  t+=" Un poste occupé à autre chose mesure mal : si un résultat paraît "+
     "incohérent, relancez le banc.";
  return t;
}

function antFilsLier(box){
  const s=box.querySelector("#antFils");
  if(s)s.onchange=function(){ antFilsRegler(parseInt(this.value,10)||0); };
  const b=box.querySelector("#bBanc");
  if(b&&!b.disabled)b.onclick=antFilsBanc;
  const a=box.querySelector("#bFilsBest");
  if(a)a.onclick=function(){ antFilsRegler(antFilsMeilleur(antFilsMesures())); };
}

/* Le réglage part au serveur, qui le range ; le modèle est ensuite revérifié
   pour que la durée annoncée suive le nouveau nombre de fils. */
async function antFilsRegler(n){
  try{
    const f=await oePost(OE_ROUTE+"/fils?n="+encodeURIComponent(n),{});
    if(ANT.etatServeur)ANT.etatServeur.fils=f;
    typeof wsHint==="function"&&wsHint(n
      ? "Fils de calcul : "+n+". Les prochains calculs les emploieront."
      : "Fils de calcul : au choix d'openEMS.");
  }catch(e){
    typeof wsHint==="function"&&wsHint("Réglage refusé : "+(e.message||e));
  }
  antFilsRafraichir();
  antMaj(true);
}

async function antFilsBanc(){
  try{
    ANT_FILS.tache=await oePost(OE_ROUTE+"/banc/lancer",{});
  }catch(e){
    typeof wsHint==="function"&&wsHint("Banc refusé : "+(e.message||e));
    return;
  }
  typeof wsHint==="function"&&wsHint("Banc de vitesse lancé : une à deux minutes.");
  antFilsRafraichir();
  const mien=++ANT_FILS.suivi;
  let vues=0;
  while(mien===ANT_FILS.suivi&&antFilsEnCours()){
    await new Promise(r=>setTimeout(r,OE_SONDAGE));
    try{
      const j=await oeAppel(OE_ROUTE+"/journal?id="+encodeURIComponent(ANT_FILS.tache.id)+
                            "&depuis="+vues);
      vues=j.n;
      ANT_FILS.tache=j;
    }catch(e){
      ANT_FILS.tache.etat="echoue";
      ANT_FILS.tache.detail="Le serveur ne répond plus : "+(e.message||e);
    }
    antFilsRafraichir();
  }
  /* LA TABLE RANGÉE EST CELLE DU SERVEUR : on la relit plutôt que de garder
     celle du suivi, pour que ce qu'on voit soit ce qui servira aux durées. */
  try{ await oeEtat(); }catch(e){}
  const t=ANT_FILS.tache;
  if(t&&t.etat==="fini"){
    const best=(antFilsEtat()||{}).meilleur;
    typeof wsHint==="function"&&wsHint("Banc terminé"+(best?" : le plus rapide ici est "+best+" fils.":"."));
    ANT_FILS.tache=null;
  }
  antFilsRafraichir();
  /* La durée annoncée dépend du banc dès qu'un nombre de fils est réglé. */
  antMaj(true);
}

/* SEUL LE BLOC DES FILS EST RÉÉCRIT : l'assistant ne se redessine en entier
   qu'en changeant d'étape, et le réécrire toutes les deux secondes pendant le
   banc ferait perdre la saisie en cours ailleurs dans l'étape. Un menu
   déroulant ouvert n'est pas remplacé sous le pointeur non plus. */
function antFilsRafraichir(){
  const bloc=aE("antFilsBloc");
  if(!bloc){ return; }
  const actif=document.activeElement;
  if(actif&&actif.tagName==="SELECT"&&bloc.contains(actif))return;
  const tmp=document.createElement("div");
  tmp.innerHTML=antFilsHtml();
  const neuf=tmp.firstElementChild;
  if(!neuf)return;
  bloc.replaceWith(neuf);
  antFilsLier(neuf);
}
