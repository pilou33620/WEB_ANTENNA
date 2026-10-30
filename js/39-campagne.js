"use strict";
/* =============================================================================
   Antenne openEMS — 39-campagne.js
   La campagne de mesures : les « Plans de mesure » d'HISTORIQUE.md, enchaînés
   seuls, une nuit durant s'il le faut. Outil provisoire : à retirer une fois
   le recalage du patch rendu (A-FAIRE.md).

   CE FICHIER N'INVENTE AUCUN GESTE. Chaque étape refait ce que ferait la main,
   par les mêmes fonctions : le motif comme le bouton « Exemple » (exPoser,
   26-exemple.js), le balayage par ANT.balayage et oeLancerBalayage
   (24-balayage.js, 12-api-openems.js), le suivi par oeSuivre. Un relevé fait
   ici vaut donc un relevé fait au clic.

   CE QUI SURVIT À UN RECHARGEMENT : l'avancement (plan, étape, tâche en cours)
   et les relevés déjà faits, dans le stockage du navigateur. Le calcul, lui,
   tourne dans son propre processus : rouvrir la page le reprend au suivi.

   Chaque plan fini se TÉLÉCHARGE sous le nom que lui donne HISTORIQUE.md
   (recalage-patch-maillage-fin.json) : à poser à la racine de WEB_ANTENNA, puis à
   pousser, pour que les corrections de A-FAIRE.md soient écrites d'après eux.
   ============================================================================= */

/* Les réglages d'usine du cas de référence (EX, 26-exemple.js) : FR-4 1,53 mm,
   arrêt à −40 dB, garde-fou et maillage au mailleur. */
const CAMP_BASE={modele:"fr4-2c-16", f:2.45e9};

/* Une étape : un motif posé (cotes du gabarit, sauf `cotes`), puis un
   balayage (`bal`, croisé si `source2`) ou une simulation seule. `rel` donne
   une plage en fraction de la cote posée : [min, max, pas]. */
const CAMP_PLANS=[
  /* La campagne du 22/10/2026 (six plans, relevés à la racine) a montré le
     port localisé sous-maillé ; le ruban se maille fin depuis. Reste à recaler
     les deux lois du patch (patchCorrLongueur, patchCorrRbord) sur ce
     maillage : L de 0 à +2 % (le maillage fin remonte la résonance de
     0,74 %), y₀ à ± 20 % de la loi provisoire. 868 MHz n'y est pas : trop cher. */
  {id:"recalage-patch", fichier:"recalage-patch-maillage-fin.json",
   titre:"Recalage du patch, maillage fin — L × y₀ (5 × 15 points)",
   etapes:[["fr4-2c-16", 2.45e9, "FR-4 1,53 mm · 2,45 GHz"],
           ["fr4-2c-16-hf", 2.45e9, "FR-4 haute fréquence · 2,45 GHz"],
           ["ro4003-2c-1524", 2.45e9, "RO4003C 1,524 mm · 2,45 GHz"],
           ["ro4350-2c-0762", 2.45e9, "RO4350B 0,762 mm · 2,45 GHz"],
           ["fr4-2c-16", 5.8e9, "FR-4 1,53 mm · 5,8 GHz"]].map(c=>({motif:"patch", modele:c[0], f:c[1], nom:c[2],
            bal:{source:"m.L", rel:[0, 0.02, 0.01], source2:"m.y0", rel2:[-0.2, 0.2, 0.1]}}))}
];

const CAMP_CLE="antenne.campagne";
const CAMP={etat:null, enCours:false, stop:false, coches:null};

function campLire(){
  try{ return JSON.parse(localStorage.getItem(CAMP_CLE)||"null"); }catch(_){ return null; }
}
function campGarder(){
  try{ localStorage.setItem(CAMP_CLE, JSON.stringify(CAMP.etat)); }catch(_){}
}

/* Poser une étape : les gestes d'exPoser, sur l'empilage et la fréquence de l'étape. */
function campPoser(e){
  conEntrer();
  const m=conModeleEmpilage(e.modele||CAMP_BASE.modele);
  if(!m)throw new Error("empilage inconnu : "+e.modele);
  CON.pile=conPileDeModele(m);
  if(e.ep)CON.pile.forEach(c=>{ if(c.er!=null&&!conEstMasque(c))c.ep=e.ep; });
  CON.modele="";
  CON.coucheActive=conPremierCuivre();
  CON.demarrage=false;
  CON.fcible=e.f||CAMP_BASE.f;
  CON.wmax=0;
  if(!conGabaritPoser(e.motif, null))throw new Error("motif « "+e.motif+" » non posé");
  if(e.cotes&&!conGabaritPoser(e.motif, Object.assign({}, CON.gabaritP, e.cotes(CON.gabaritP))))
    throw new Error("cotes du motif « "+e.motif+" » refusées");
  ANT.arret.energie=-40; ANT.arret.nmax=0;
  ANT.maillage.res_air=0; ANT.maillage.res_die=0;
  ANT.ports.forEach(p=>{ p.msl=e.msl||false; });
  for(const k of Object.keys(ANT.balayage))if(k!=="points")delete ANT.balayage[k];
  if(e.bal){
    Object.assign(ANT.balayage, campPlage(e.bal), {actif:true});
    // balSource retombe sur la première cote venue quand la sienne manque : ici, c'est un refus
    const s1=balSource(), s2=balSource2();
    if(!s1||s1.id!==e.bal.source||(e.bal.source2&&(!s2||s2.id!==e.bal.source2)))
      throw new Error("cote « "+e.bal.source+(e.bal.source2?" × "+e.bal.source2:"")+" » non balayable sur ce motif");
  }
  antMaj(true);
}

/* La plage d'un axe : donnée, relative à la cote posée (rel), ou décalée d'elle (dec). */
function campPlage(b){
  const axe=function(source, abs, rel, dec){
    if(!source)return null;
    const v=CON.gabaritP[source.slice(2)];
    if(rel)return [v*(1+rel[0]), v*(1+rel[1]), Math.abs(v*rel[2])];
    if(dec)return [v+dec[0], v+dec[1], dec[2]];
    return abs;
  };
  const a=axe(b.source, [b.min, b.max, b.pas], b.rel, b.dec);
  const c=axe(b.source2, [b.min2, b.max2, b.pas2], b.rel2, b.dec2);
  const r=x=>+x.toFixed(6);
  const out={source:b.source, min:r(a[0]), max:r(a[1]), pas:r(a[2]), croise:!!c};
  if(c)Object.assign(out, {source2:b.source2, min2:r(c[0]), max2:r(c[1]), pas2:r(c[2])});
  return out;
}

/* Ce qu'on garde d'un résultat : les colonnes des croisement-*.json déjà à la racine. */
const CAMP_CHAMPS=["f0", "s11_min_db", "z0_re", "z0_im", "z0_pied_re", "z0_pied_im",
                   "bp_f1", "bp_f2", "nf2ff", "msl"];
function campResume(q){
  const o={};
  for(const k of CAMP_CHAMPS)if(q&&q[k]!=null)o[k]=q[k];
  return o;
}
function campReleve(r){
  if(r&&r.balayage&&Array.isArray(r.points))
    return {balayage:{nom:r.nom, unite:r.unite, nom2:r.nom2, unite2:r.unite2, croise:!!r.croise},
            points:r.points.map(p=>Object.assign({etiquette:p.etiquette, valeur:p.valeur,
                                                  valeur2:p.valeur2}, campResume(p.resultat)))};
  return campResume(r);
}

function campEtapes(){
  const out=[];
  CAMP.etat.plans.forEach(id=>{
    const plan=CAMP_PLANS.find(p=>p.id===id);
    plan.etapes.forEach((e, j)=>out.push({plan, e, j}));
  });
  return out;
}

/* Le devis de chaque étape, sans rien lancer. */
async function campChiffrer(ids){
  const lignes=[];
  let total=0;
  for(const id of ids){
    const plan=CAMP_PLANS.find(p=>p.id===id);
    for(const e of plan.etapes){
      try{
        campPoser(e);
        const d=e.bal?(await oeBalayage()).estimation:(await oePreparer()).estimation;
        total+=d.duree_s||0;
        lignes.push(plan.titre+(e.nom?" · "+e.nom:"")+" : "+campDuree(d.duree_s));
      }catch(err){ lignes.push(plan.titre+(e.nom?" · "+e.nom:"")+" : REFUSÉ — "+String(err.message||err).split("\n")[0]); }
    }
  }
  return {lignes, total};
}

function campDuree(s){
  if(!(s>0))return "?";
  const h=Math.floor(s/3600), m=Math.round((s%3600)/60);
  return h?h+" h "+String(m).padStart(2, "0"):m+" min";
}

function campNouvelle(ids){
  CAMP.etat={plans:ids, k:0, tache:null, releves:{}, debut:new Date().toISOString()};
  campGarder();
}

/* La boucle : une étape après l'autre, reprise à `k`. Une étape refusée ou
   échouée est notée et la campagne continue : une nuit ne s'arrête pas sur un point. */
async function campDerouler(rendre){
  if(CAMP.enCours||!CAMP.etat)return;
  CAMP.enCours=true; CAMP.stop=false;
  const etapes=campEtapes();
  try{
    while(CAMP.etat.k<etapes.length&&!CAMP.stop){
      const {plan, e, j}=etapes[CAMP.etat.k];
      const rel=CAMP.etat.releves[plan.id]=CAMP.etat.releves[plan.id]||{etapes:[]};
      const fiche={nom:e.nom||plan.titre, motif:e.motif, modele:e.modele||CAMP_BASE.modele,
                   f:e.f||CAMP_BASE.f};
      try{
        if(CAMP.etat.tache){
          ANT.tache={id:CAMP.etat.tache, etat:"en cours", lignes:[]};      // rechargement : on reprend le suivi
        }else{
          campPoser(e);
          fiche.cotes=Object.assign({}, CON.gabaritP);
          fiche.balayage=e.bal?Object.assign({}, ANT.balayage):null;
          CAMP.etat.fiche=fiche;
          await (e.bal?oeLancerBalayage():oeLancer());
          CAMP.etat.tache=ANT.tache.id;
          campGarder();
        }
        rendre&&rendre();
        const t=await oeSuivre(()=>rendre&&rendre());
        if(!t)break;               // suivi arrêté (autre projet ouvert) : « Reprendre » le reprend
        if(CAMP.stop&&t.etat!=="fini"){                // « Reprendre » refera cette étape
          CAMP.etat.tache=null; campGarder(); break;
        }
        Object.assign(fiche, CAMP.etat.fiche||{});
        if(t.etat==="fini")fiche.resultat=campReleve(ANT.resultat);
        else fiche.erreur=t.etat+(t.detail?" — "+t.detail:"");
      }catch(err){
        fiche.erreur=String(err.message||err).split("\n")[0];
      }
      rel.etapes[j]=fiche;
      CAMP.etat.tache=null; CAMP.etat.fiche=null; CAMP.etat.k++;
      campGarder();
      if(j===plan.etapes.length-1)campTelecharger(plan.id);
      rendre&&rendre();
    }
  }finally{
    CAMP.enCours=false;
    rendre&&rendre();
  }
}

function campDocument(id){
  const plan=CAMP_PLANS.find(p=>p.id===id);
  return {_note:"Campagne de mesures (js/39-campagne.js) : « "+plan.titre+" », plans de "+
                "mesure d'HISTORIQUE.md. Réglages du cas de référence : arrêt à −40 dB, "+
                "maillage au mailleur.",
          plan:plan.id, debut:CAMP.etat.debut, fin:new Date().toISOString(),
          etapes:(CAMP.etat.releves[id]||{etapes:[]}).etapes};
}

function campTelecharger(id){
  const plan=CAMP_PLANS.find(p=>p.id===id);
  const blob=new Blob([JSON.stringify(campDocument(id), null, 1)], {type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=plan.fichier;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 10000);
}

async function campArreter(){
  CAMP.stop=true;
  try{ await oeArreter(); }catch(_){}
}

/* ==========================================================================
   Le panneau : les plans à cocher, le devis, le lancement, l'avancement
   ========================================================================== */
function campEsc(t){ return String(t).replace(/[&<>"]/g, c=>({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;"}[c])); }

function campRendre(){
  const box=document.getElementById("campagne");
  if(!box||box.hidden)return;
  const etat=CAMP.etat, etapes=etat?campEtapes():[];
  const fait=id=>etat&&etat.releves[id]&&etat.releves[id].etapes.filter(Boolean).length===
                     CAMP_PLANS.find(p=>p.id===id).etapes.length;
  let h='<h3>Campagne de mesures</h3><p class="campNote">Les plans d\'HISTORIQUE.md, lancés '+
        "l'un après l'autre. Chaque plan fini se télécharge : posez le fichier à la racine de "+
        "WEB_ANTENNA. Le dessin en cours est remplacé.</p>";
  h+=CAMP_PLANS.map(p=>'<label class="campPlan"><input type="checkbox" data-camp="'+p.id+'"'+
       ((CAMP.coches||(etat?etat.plans:CAMP_PLANS.map(q=>q.id))).includes(p.id)?" checked":"")+(CAMP.enCours?" disabled":"")+"> "+
       campEsc(p.titre)+(fait(p.id)?' <button class="tb mini" data-camp-dl="'+p.id+'">⬇ '+
       campEsc(p.fichier)+"</button>":"")+"</label>").join("");
  if(etat&&etapes.length){
    const cur=etapes[Math.min(etat.k, etapes.length-1)];
    h+='<p class="campAvance">'+(etat.k>=etapes.length?"Campagne terminée : "+etapes.length+" étape(s).":
       "Étape "+(etat.k+1)+" / "+etapes.length+" — "+campEsc(cur.plan.titre)+(cur.e.nom?" · "+campEsc(cur.e.nom):"")+
       (CAMP.enCours&&ANT.tache?" — "+campEsc(ANT.tache.etat||"")+(ANT.tache.progres!=null?" "+ANT.tache.progres+" %":""):
        CAMP.enCours?"":" — en pause"))+"</p>";
  }
  if(CAMP.devis)h+='<pre class="campDevis">'+campEsc(CAMP.devis)+"</pre>";
  h+='<div class="campBoutons">'+
     '<button class="tb" data-camp-chiffrer'+(CAMP.enCours?" disabled":"")+">Chiffrer</button>"+
     '<button class="tb on" data-camp-lancer'+(CAMP.enCours?" disabled":"")+">"+
       (etat&&etat.k<etapes.length&&etat.k>0?"Reprendre":"Lancer")+"</button>"+
     '<button class="tb" data-camp-arreter'+(CAMP.enCours?"":" disabled")+">Arrêter</button>"+
     '<button class="tb" data-camp-fermer>Fermer</button></div>';
  box.innerHTML=h;
  // les cases survivent au rendu suivant : il refait le panneau
  const coches=()=>[...box.querySelectorAll("[data-camp]")].filter(c=>c.checked).map(c=>c.dataset.camp);
  box.querySelectorAll("[data-camp]").forEach(c=>c.onchange=()=>{ CAMP.coches=coches(); });
  box.querySelectorAll("[data-camp-dl]").forEach(b=>b.onclick=ev=>{ ev.preventDefault(); campTelecharger(b.dataset.campDl); });
  box.querySelector("[data-camp-chiffrer]").onclick=async()=>{
    if(CON.elements.length&&!window.confirm("Le chiffrage pose chaque motif : le dessin en cours sera remplacé. Continuer ?"))return;
    const ids=coches();
    CAMP.devis="Chiffrage…"; campRendre();
    const d=await campChiffrer(ids);
    CAMP.devis=d.lignes.join("\n")+"\nEn tout : "+campDuree(d.total)+" (estimation du poste).";
    campRendre();
  };
  box.querySelector("[data-camp-lancer]").onclick=()=>{
    const ids=coches();
    if(!ids.length)return;
    const reprise=CAMP.etat&&CAMP.etat.k<campEtapes().length&&CAMP.etat.k>0&&
                  JSON.stringify(CAMP.etat.plans)===JSON.stringify(ids);
    if(!reprise){
      if(CON.elements.length&&!window.confirm("La campagne remplace le dessin en cours. Continuer ?"))return;
      campNouvelle(ids);
    }
    campDerouler(campRendre);
  };
  box.querySelector("[data-camp-arreter]").onclick=()=>campArreter();
  box.querySelector("[data-camp-fermer]").onclick=()=>{ box.hidden=true; };
}

function campOuvrir(){
  let box=document.getElementById("campagne");
  if(!box){
    box=document.createElement("div");
    box.id="campagne";
    document.body.appendChild(box);
  }
  box.hidden=false;
  campRendre();
}

window.addEventListener("DOMContentLoaded", function(){
  const b=document.getElementById("bCampagne");
  if(b)b.onclick=campOuvrir;
  CAMP.etat=campLire();
  // une campagne coupée par un rechargement reprend d'elle-même, au suivi de sa tâche
  if(CAMP.etat&&CAMP.etat.tache){ campOuvrir(); campDerouler(campRendre); }
});
