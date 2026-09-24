/* =============================================================================
   Antenne openEMS — travailleur-occt.js
   Le fil d'exécution qui lit les fichiers de CAO : STEP, IGES, BREP.

   REPRIS DE WEB_3D (js/travailleur-occt.js), avec le même noyau : OpenCascade
   compilé en WebAssembly (js/vendor/occt/). Il est ici dans un travailleur
   pour la même raison que là-bas — trianguler un assemblage prend de quelques
   dixièmes de seconde à plusieurs minutes, et la page doit rester vivante
   pendant ce temps.

   CE QUI CHANGE PAR RAPPORT À LA VISIONNEUSE : ce fichier rend, pour chaque
   maillage, le NOM DU NŒUD d'assemblage qui le porte. Un corps s'appelle
   « Pile_CR2032 » dans l'arbre et souvent rien du tout dans le maillage ; or
   c'est ce nom qui permet de deviner sa matière, et de la choisir en sachant
   de quoi l'on parle.
   ============================================================================= */
"use strict";

importScripts("vendor/occt/occt-import-js.js");

let occt=null;

async function noyau(){
  if(occt)return occt;
  postMessage({type:"progres", etape:"Chargement du noyau OpenCascade…"});
  occt=await occtimportjs({
    locateFile:function(chemin){ return new URL("vendor/occt/"+chemin, self.location.href).href; }
  });
  return occt;
}

function lire(n, format, octets, params){
  if(format==="iges")return n.ReadIgesFile(octets, params);
  if(format==="brep")return n.ReadBrepFile(octets, params);
  return n.ReadStepFile(octets, params);
}

/* Le nom de chaque maillage : celui du nœud qui le porte, ou à défaut du plus
   proche parent nommé. Un nœud anonyme sous « Boitier_haut » est une face de
   ce boîtier, pas un objet à part. */
function nommer(racine, n){
  const noms=new Array(n).fill("");
  const descendre=function(nd, parent){
    const nom=(nd&&nd.name)||parent||"";
    for(const i of (nd&&nd.meshes)||[])if(i<n&&!noms[i])noms[i]=nom;
    for(const e of (nd&&nd.children)||[])descendre(e, nom);
  };
  descendre(racine, "");
  return noms;
}

onmessage=async function(ev){
  const d=ev.data;
  try{
    const n=await noyau();
    postMessage({type:"progres", etape:"Lecture de "+d.nom+" — triangulation des surfaces…"});
    const debut=performance.now();
    const r=lire(n, d.format, new Uint8Array(d.tampon), d.params);
    if(!r||!r.success){
      postMessage({type:"erreur", message:
        "OpenCascade n'a pas pu lire ce fichier. Vérifiez qu'il s'agit bien "+
        "d'un fichier "+d.format.toUpperCase()+" non compressé et non tronqué."});
      return;
    }
    const meshes=r.meshes||[];
    const noms=nommer(r.root, meshes.length);
    const transferts=[], maillages=[];
    meshes.forEach(function(m,i){
      const pos=Float32Array.from((m.attributes&&m.attributes.position&&m.attributes.position.array)||[]);
      const idx=Uint32Array.from((m.index&&m.index.array)||[]);
      transferts.push(pos.buffer, idx.buffer);
      maillages.push({nom:m.name||noms[i]||"", noeud:noms[i]||"",
                      couleur:m.color||null, position:pos, index:idx});
    });
    postMessage({type:"ok", maillages:maillages,
                 duree:Math.round(performance.now()-debut)}, transferts);
  }catch(e){
    postMessage({type:"erreur", message:(e&&e.message)?e.message:String(e)});
  }
};
