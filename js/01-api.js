"use strict";
/* =============================================================================
   visionneuse IPC-2581 — 01-api.js
   Le fichier part au serveur, le modèle en revient.

   Pourquoi passer par un serveur alors que les deux éditeurs se passent de
   tout ? Parce que le parseur IPC-2581 est en Python (python/ipc2581_parser.py)
   et qu'un navigateur ne peut pas l'exécuter. Le rendu, lui,
   est bien ici : une fois le modèle traduit en JSON, la page n'a plus besoin
   de personne — c'est aussi pourquoi « Exporter .json » existe, et pourquoi le
   .json exporté se rouvre en double-clic, serveur éteint.

   L'adresse du serveur est cherchée dans le même ordre que pour la recherche
   de composants :
     1. l'origine qui sert la page (cas normal : c'est serveur.py) ;
     2. le même hôte sur le port par défaut de serveur.py ;
     3. http://127.0.0.1:8000 (page ouverte en file://).
   ============================================================================= */

const API_PORT=8000;                   // DEFAULT_PORT de serveur.py
const API_ROUTE="/api/ipc2581";

let API_BASE=null;                     // racine retenue, "" = même origine
let API_ETAT=null;                     // réponse de la sonde : {dispo, max, …}

/* racines à essayer, sans doublon */
function apiCandidats(){
  const out=[], ajoute=function(v){if(v!==null&&out.indexOf(v)<0)out.push(v);};
  if(location.protocol==="http:"||location.protocol==="https:"){
    ajoute("");                                        // même origine
    ajoute(location.protocol+"//"+location.hostname+":"+API_PORT);
  }
  ajoute("http://127.0.0.1:"+API_PORT);
  return out;
}

/* message d'erreur lisible : le serveur répond {"detail": "..."} */
async function apiErreur(rep){
  let detail="";
  try{
    const j=await rep.json();
    detail=(j&&(j.detail||j.message))||"";
    if(typeof detail!=="string")detail=JSON.stringify(detail);
  }catch(e){}
  return detail||("HTTP "+rep.status);
}

/* Cherche un serveur capable de parser. Renvoie son état, ou lève.
   Le résultat est gardé : on ne sonde qu'une fois par session. */
async function apiConnecter(){
  if(API_ETAT)return API_ETAT;
  const essais=[];
  for(const base of apiCandidats()){
    try{
      const rep=await fetch(base+API_ROUTE,{headers:{Accept:"application/json"}});
      if(!rep.ok){essais.push((base||"cette page")+" : "+await apiErreur(rep));continue;}
      const j=await rep.json();
      if(!j||!j.dispo){
        essais.push((base||"cette page")+" : "+(j&&j.detail||"parseur absent"));
        continue;
      }
      API_BASE=base; API_ETAT=j;
      return API_ETAT;
    }catch(e){
      essais.push((base||"cette page")+" : "+(e.message||"injoignable"));
    }
  }
  throw new Error("Aucun serveur pour lire l'IPC-2581.\n\n"+
    "Le parseur est en Python : lancez « python serveur.py » depuis le dossier "+
    "du dépôt, puis ouvrez cette page par l'adresse qu'il affiche.\n\n"+
    "Tentatives :\n  "+essais.join("\n  "));
}

/* Envoie le fichier et renvoie le modèle. Le corps est le fichier tel quel :
   pas de base64, pas de multipart — rien à emballer ni à défaire des deux
   côtés, et un fichier de cinquante mégaoctets ne gonfle pas d'un tiers. */
async function apiImporter(fichier){
  const etat=await apiConnecter();
  if(etat.max&&fichier.size>etat.max)
    throw new Error("Fichier trop grand : "+moPoids(fichier.size)+
                    " (maximum "+moPoids(etat.max)+").");
  const rep=await fetch(API_BASE+API_ROUTE+"?nom="+encodeURIComponent(fichier.name),{
    method:"POST",
    headers:{"Content-Type":"application/octet-stream"},
    body:fichier
  });
  if(!rep.ok)throw new Error(await apiErreur(rep));
  const modele=await rep.json();
  if(!modele||typeof modele!=="object"||!Array.isArray(modele.couches))
    throw new Error("Réponse inattendue du serveur.");
  return modele;
}

/* Un .json déjà exporté : la page le relit elle-même, sans serveur. C'est ce
   qui rend la visionneuse utilisable en double-clic une fois la traduction
   faite — et ce qui permet d'archiver une carte lue à un instant donné. */
async function apiLireJson(fichier){
  let modele;
  try{ modele=JSON.parse(await fichier.text()); }
  catch(e){ throw new Error("Ce .json est illisible : "+e.message); }
  if(!modele||typeof modele!=="object"||!Array.isArray(modele.couches))
    throw new Error("Ce .json n'est pas un modèle de carte "+
                    "(exportez-le depuis cette page).");
  return modele;
}

function moPoids(n){
  if(!n)return "0";
  if(n<1024)return n+" o";
  if(n<1048576)return (n/1024).toFixed(0)+" ko";
  return (n/1048576).toFixed(1).replace(".",",")+" Mo";
}

/* Le geste complet : un fichier choisi ou déposé -> un modèle.
   C'est l'extension qui tranche, et elle seule : un .json vient d'ici, tout le
   reste part au parseur. */
async function apiCharger(fichier){
  return /\.json$/i.test(fichier.name)
    ? apiLireJson(fichier)
    : apiImporter(fichier);
}
