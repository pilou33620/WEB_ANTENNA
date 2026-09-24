/* =============================================================================
   Banc d'essai de la logique de l'interface.

     node test/banc-interface.js

   CE QU'IL VERIFIE, ET CE QU'IL NE VERIFIE PAS. Il n'ouvre aucun navigateur
   et ne dessine rien : il charge les modules qui portent des DECISIONS — la
   liste des ports, la description d'un balayage, la conversion d'unite — et
   il les exerce. Tout ce qui est rendu a l'ecran reste hors de sa portee.

   POURQUOI CES TROIS-LA. Ce sont les seuls endroits de l'interface ou une
   faute ne se voit pas : un port excite en trop part au solveur et revient
   en refus, mais une conversion d'unite fausse d'un facteur 25,4 rend une
   antenne qui a l'air d'une antenne, et un balayage dont les modifications
   ne s'appliquent pas rend quarante courbes superposees qu'on prendrait
   pour un resultat.

   Le banc d'essai principal (python/test/banc-openems.py) lance celui-ci
   quand node est installe.
   ============================================================================= */
const fs=require("fs");
const path=require("path");
const JS=path.join(__dirname,"..","js");

let ok=0; const ko=[];
function verifie(nom,cond,detail){
  if(cond){ ok++; console.log("  ok   "+nom); }
  else { ko.push(nom); console.log("  RATE "+nom+"   "+(detail||"")); }
}

/* -- les appuis dont les modules ont besoin, et rien de plus -------------- */
/* Les ecouteurs de la fenetre sont RETENUS, et non jetes : c'est par eux que
   le banc eprouve le clavier du mode conception. Un raccourci qu'on appelle
   par sa fonction ne prouve rien de la touche qui le declenche — or c'est la
   touche qui se trompe de garde. */
const ECOUTE={};
global.window={addEventListener(t,f){ (ECOUTE[t]=ECOUTE[t]||[]).push(f); }};
function touche(o){
  const e=Object.assign({key:"", ctrlKey:false, shiftKey:false, altKey:false,
                         metaKey:false, target:{tagName:"BODY"},
                         stopPropagation(){}, preventDefault(){}}, o);
  (ECOUTE.keydown||[]).forEach(f=>f(e));
  return e;
}
global.document={
  getElementById(){ return null; },
  querySelector(){ return null; },
  querySelectorAll(){ return []; },
  addEventListener(){},
  body:{classList:{toggle(){},remove(){},add(){}}}
};
global.localStorage={getItem(){return null;},setItem(){}};
global.V={unite:"mm", couches:[], parNet:[], sel:[], modele:null, fichier:""};
global.LT={pile:[], cu:[], gap:[]};
global.mdlEsc=s=>String(s);
global.mdlDansPoly=()=>false;

/* L'EVALUATION INDIRECTE MET LES `function` DANS L'OBJET GLOBAL, MAIS PAS LES
   `const`. Les declarations de premier niveau sont donc reecrites en `var`, qui
   lui devient bien une propriete globale — c'est la seule transformation, et
   elle ne touche qu'aux lignes commencant en colonne zero. */
function charger(nom){
  const src=fs.readFileSync(path.join(JS,nom),"utf8")
    .replace(/^"use strict";/,"")
    .replace(/^(const|let) /gm,"var ");
  (0,eval)(src);
}
/* UNE SEULE FONCTION D'UN FICHIER QU'ON NE PEUT PAS CHARGER EN ENTIER.
   `02-modele.js` construit le modele de la carte et parle a la page : le
   charger ici demanderait un navigateur. Mais `mdlDansPoly` — « ce point
   est-il dans ce polygone ? » — est pure, et une section du banc a besoin de
   SA reponse, pas d'un appui muet. On l'extrait de sa source plutot que d'en
   reecrire une seconde : deux implementations d'accord entre elles ne
   prouveraient rien, et c'est bien celle de l'outil qu'on veut eprouver. */
function extraire(nom,fn){
  const src=fs.readFileSync(path.join(JS,nom),"utf8");
  const i=src.indexOf("function "+fn+"(");
  if(i<0)throw new Error(fn+" introuvable dans "+nom);
  let n=0, j=src.indexOf("{",i);
  for(let k=j;k<src.length;k++){
    if(src[k]==="{")n++;
    else if(src[k]==="}"&&!--n){ j=k+1; break; }
  }
  let deb=(i>=6&&src.slice(i-6,i)==="async ")?i-6:i;
  (0,eval)(src.slice(deb,j).replace(/^(async\s+)?function /,"var "+fn+"=$1function "));
}

charger("25-polygones.js");
charger("10-etat.js");
charger("24-balayage.js");

console.log("1. Les ports");
verifie("un seul port au depart, et il excite",
        ANT.ports.length===1&&ANT.ports[0].excite);
verifie("ANT.port designe le port courant",
        ANT.port===ANT.ports[0]);
antPortAjouter();
verifie("ajouter un port le rend courant",
        ANT.ports.length===2&&ANT.portActif===1&&ANT.port===ANT.ports[1]);
verifie("le port ajoute n'excite pas : un seul excite a la fois",
        ANT.ports.filter(p=>p.excite).length===1&&!ANT.ports[1].excite);
ANT.port.x=12.5;
verifie("ecrire dans ANT.port ecrit dans le port courant",
        ANT.ports[1].x===12.5&&ANT.ports[0].x===0);
antPortExciter(1);
verifie("exciter le second eteint le premier",
        ANT.ports[1].excite&&!ANT.ports[0].excite);
verifie("antPortExcite() rend celui qui excite",
        antPortExcite()===ANT.ports[1]);
antPortRetirer(1);
verifie("retirer le port excite rend l'excitation au premier",
        ANT.ports.length===1&&ANT.ports[0].excite);
verifie("on ne peut pas retirer le dernier port",
        antPortRetirer(0)===false&&ANT.ports.length===1);

const d=antPortDoc(ANT.ports[0],0);
verifie("un port localise n'emporte pas les cotes d'un coaxial",
        d.ra===undefined&&d.type==="localise");
ANT.ports[0].type="coaxial";
const dc=antPortDoc(ANT.ports[0],0);
verifie("un port coaxial les emporte",
        dc.ra===0.635&&dc.rb===2.05&&dc.er===2.05&&dc.longueur===3);

/* 60/racine(2,05).ln(2,05/0,635) = 49,1 ohms : une SMA ordinaire. La page
   calcule cette valeur PENDANT qu'on tape les rayons, parce qu'un connecteur
   qui ne fait pas 50 ohms ajoute sa desadaptation a celle de l'antenne. */
verifie("l'impedance du coaxial est calculee aussi cote page",
        Math.abs(antCoaxZ0(ANT.ports[0])-49.08)<0.1,
        antCoaxZ0(ANT.ports[0]).toFixed(2));
verifie("une gaine plus etroite que l'ame ne rend pas un nombre",
        antCoaxZ0({ra:2,rb:1,er:2.05})===0);
ANT.ports[0].type="localise";

console.log("");
console.log("2. Le balayage");
ANT.balayage={actif:true,source:"",nom:"",min:10,max:11,pas:0.25,points:[]};
let v=balValeurs();
verifie("la plage est fermee des deux cotes",
        v.length===5&&v[0]===10&&v[4]===11, JSON.stringify(v));
ANT.balayage.pas=0;
verifie("un pas nul ne rend aucun point", balValeurs().length===0);
ANT.balayage.pas=0.3; ANT.balayage.min=11; ANT.balayage.max=10;
verifie("une plage a l'envers ne rend aucun point", balValeurs().length===0);
verifie("l'etiquette porte la virgule decimale",
        balEtiquette(38.25)==="38,25");

/* LA COMPARAISON PROFONDE EST CE QUI PERMET DE BALAYER UNE COTE DESSINEE :
   le document ne connait que des polygones, et c'est en comparant deux
   documents qu'on retrouve ce qu'une cote a change. */
const base={a:1,b:{c:[1,2,3]},d:"x"};
let mods=balDiff(base,{a:1,b:{c:[1,9,3]},d:"x"});
verifie("une seule coordonnee changee donne une seule modification",
        mods.length===1&&mods[0].chemin==="b.c.1"&&mods[0].valeur===9,
        JSON.stringify(mods));
mods=balDiff(base,{a:1,b:{c:[1,2,3,4]},d:"x"});
verifie("un tableau de longueur differente est remplace en entier",
        mods.length===1&&mods[0].chemin==="b.c"&&mods[0].valeur.length===4,
        JSON.stringify(mods));
verifie("deux documents identiques ne donnent aucune modification",
        balDiff(base,JSON.parse(JSON.stringify(base))).length===0);

/* -- le croisement : deux cotes, et un PRODUIT ---------------------------- */
/* CE QUI SE VERIFIE ICI EST UN COMPTE, ET C'EST LE SEUL QUI IMPORTE. Six
   valeurs croisees avec six ne font pas douze simulations mais trente-six, et
   le garde-fou de quarante points lu une fois par axe les laisserait toutes
   passer — c'est-a-dire une nuit de calcul lancee sous une limite qu'on croit
   respecter. */
ANT.balayage={actif:true, source:"p0.x", nom:"", min:10, max:11, pas:0.5,
              croise:false, source2:"", min2:0, max2:0, pas2:0, points:[]};
verifie("sans croisement, le compte est celui du seul axe",
        balValeurs().length===3&&balValeurs2().length===0&&balCombien()===3,
        String(balCombien()));
ANT.balayage.croise=true;
ANT.balayage.source2="p0.y";
ANT.balayage.min2=20; ANT.balayage.max2=21; ANT.balayage.pas2=0.5;
verifie("avec croisement, le compte est le PRODUIT, pas la somme",
        balCombien()===9, String(balCombien()));
verifie("la seconde cote ne peut pas etre la premiere",
        (ANT.balayage.source2="p0.x")&&balSource2().id!=="p0.x",
        balSource2()&&balSource2().id);
ANT.balayage.source2="p0.y";

const spec=antBalayageSpec();
verifie("un point par couple", spec.points.length===9,
        String(spec.points.length));
verifie("le croisement est annonce au serveur, avec le nom du second axe",
        spec.croise===true&&spec.nom2===balSource2().nom);
verifie("chaque point porte les DEUX modifications",
        spec.points.every(p=>p.modifs.length===2));
verifie("chaque point porte sa valeur sur chaque axe",
        spec.points[0].valeur===10&&spec.points[0].valeur2===20&&
        spec.points[8].valeur===11&&spec.points[8].valeur2===21,
        JSON.stringify([spec.points[0].valeur,spec.points[0].valeur2,
                        spec.points[8].valeur,spec.points[8].valeur2]));
/* La premiere cote varie lentement, la seconde vite : c'est l'ordre dans
   lequel on lit un tableau, et celui dans lequel la page le reconstruit. */
verifie("la premiere cote varie lentement, la seconde vite",
        spec.points.slice(0,3).every(p=>p.valeur===10)&&
        spec.points.slice(0,3).map(p=>p.valeur2).join()==="20,20.5,21");
verifie("l'etiquette porte les deux valeurs",
        spec.points[0].etiquette==="10 × 20", spec.points[0].etiquette);
verifie("les modifications designent bien les deux chemins",
        spec.points[4].modifs.map(m=>m.chemin).sort().join()
        ==="ports.0.x,ports.0.y");
verifie("et portent les valeurs du couple",
        spec.points[4].modifs.find(m=>m.chemin==="ports.0.x").valeur===10.5&&
        spec.points[4].modifs.find(m=>m.chemin==="ports.0.y").valeur===20.5);

/* Une seconde plage vide n'est pas un croisement : le balayage retombe sur la
   premiere cote seule, plutot que de rendre zero point. */
ANT.balayage.pas2=0;
verifie("une seconde plage vide fait retomber sur un seul axe",
        balCombien()===3&&antBalayageSpec().points.length===3&&
        antBalayageSpec().croise===false);
ANT.balayage.croise=false;

/* OUVRIR UN AUTRE FICHIER REMET LE BALAYAGE A NEUF — LES DEUX AXES. Le second
   avait ete oublie, et l'oubli ne se voyait pas : `croise` repartait a
   `undefined`, donc faux, donc le bloc croise ne s'affichait pas. Il ne se
   serait vu qu'au premier « Croiser » coche apres une seconde ouverture, sous
   la forme de trois champs de saisie nes a « undefined ». Un etat a moitie
   remis a neuf est pire qu'un etat garde : on ne sait plus lequel on lit. */
ANT.balayage={actif:true, source:"p0.x", nom:"port — X", min:1, max:9, pas:1,
              croise:true, source2:"p0.y", min2:2, max2:8, pas2:2,
              points:[{etiquette:"vieux"}], devis:{cellules:1}};
antRaz();
verifie("ouvrir une autre carte remet le balayage a neuf, second axe compris",
        ["actif","source","nom","min","max","pas","croise","source2",
         "min2","max2","pas2","points","devis"]
          .every(k=>k in ANT.balayage),
        Object.keys(ANT.balayage).join());
verifie("et aucun de ses champs ne reste indefini",
        Object.keys(ANT.balayage).every(k=>ANT.balayage[k]!==undefined),
        Object.keys(ANT.balayage)
              .filter(k=>ANT.balayage[k]===undefined).join() || "(aucun)");
verifie("les deux plages sont bien vides",
        ANT.balayage.min2===0&&ANT.balayage.max2===0&&ANT.balayage.pas2===0&&
        ANT.balayage.croise===false&&ANT.balayage.source2==="");

console.log("");
console.log("3. Les unites du mode conception");
global.CON={unite:"mm"};
global.conNb=function(v,dec){
  return Number(v).toFixed(dec==null?3:dec).replace(".",",");
};
charger("23-panneau-conception.js");
verifie("en millimetres, l'affichage est la valeur",
        conAff(1.6)===1.6&&conLire(1.6)===1.6);
CON.unite="in";
verifie("en pouces, 25,4 mm font un pouce",
        Math.abs(conAff(25.4)-1)<1e-9&&Math.abs(conLire(1)-25.4)<1e-9);
CON.unite="mil";
verifie("en mils, 0,254 mm font dix milliemes",
        Math.abs(conAff(0.254)-10)<1e-9&&Math.abs(conLire(10)-0.254)<1e-9);
/* L'aller-retour passe par l'AFFICHAGE, qui est arrondi : ce qu'on verifie
   est qu'il ne perd pas plus que la precision affichee — un centieme de mil,
   soit un quart de micron. */
verifie("l'aller-retour ne perd que la precision affichee",
        Math.abs(conLire(conAff(1.5))-1.5)<0.0003,
        String(conLire(conAff(1.5))));
/* ET CHANGER D'UNITE NE TOUCHE A RIEN : c'est ce qui rend l'operation sure. */
CON.largeur=1.0; CON.grille=0.25;
CON.unite="in"; CON.unite="mil"; CON.unite="mm";
verifie("changer d'unite ne modifie aucune cote",
        CON.largeur===1.0&&CON.grille===0.25);
CON.unite="mil";
verifie("le pas de saisie suit l'unite",
        conPas(0.05)>=1, String(conPas(0.05)));
verifie("une longueur s'ecrit avec son unite",
        conLong(0.254,1)==="10,0 mil", conLong(0.254,1));
CON.unite="mm";
verifie("le pas revient a celui du millimetre", conPas(0.05)===0.05);

console.log("");
console.log("4. Les motifs d'antenne");
/* CE QUE CETTE SECTION EPROUVE, ET POURQUOI ELLE EXISTE. Les motifs sont les
   formules analytiques qui decident du PREMIER dessin. Une faute de facteur
   n'y fait rien planter : elle rend une antenne qui a l'air d'une antenne, et
   qu'on ne soupconne qu'apres une nuit de calcul. C'est exactement le critere
   qui a fait ecrire les trois sections precedentes.

   On eprouve donc ce qui se verifie sans solveur : qu'une largeur synthetisee
   RELUE redonne son impedance, qu'une longueur resonante tombe ou la theorie
   la met, que le developpe d'un meandre vaut bien ce que la fiche annonce, et
   que la pose met le cuivre et le port la ou le trace les a mis. */
global.hint=function(){};
charger("20-conception.js");
charger("22-antennes.js");
charger("27-apercu-motif.js");

CON.pile=conPileDefaut();
CON.coucheActive=conPremierCuivre();
CON.fcible=2.45e9;

/* -- la ligne 50 ohms, synthetisee puis relue ---------------------------- */
/* Une synthese qu'on ne relit pas est une synthese qu'on croit sur parole :
   la largeur est arrondie au micron avant d'etre dessinee, et c'est CETTE
   largeur-la qui doit encore faire 50 ohms. Trois stratifies du catalogue,
   du FR-4 epais au duroid mince. */
[["FR-4 1,6",4.30,1.60],
 ["RO4003C 0,813",3.55,0.813],
 ["duroid 5880 0,787",2.20,0.787]].forEach(function(m){
  const w=conLargeurMicroruban(50,m[1],m[2]);
  const z=conZ0Microruban(m[1],m[2],w);
  verifie("50 ohms relus sur "+m[0],
          Math.abs(z-50)<1.0, z.toFixed(2)+" ohms pour w="+w+" mm");
});
verifie("une ligne plus large est de plus basse impedance",
        conZ0Microruban(4.3,1.6,6)<conZ0Microruban(4.3,1.6,3));

/* -- le patch : la longueur resonante ------------------------------------ */
/* La theorie pose L = lambda/(2.racine(er_eff)) MOINS deux fois l'allongement
   des bords. Ce raccourcissement est ce que le modele de cavite apporte de
   plus qu'un demi-onde naif : il vaut quelques pour cent, et l'ignorer
   decale la resonance d'autant. */
const cx=conContexte();
const pPatch=conGabaritDefauts(CON_MOTIF_PATCH,cx);
const eeP=conEeff(cx.er,cx.h,pPatch.W);
const demi=CON_C0/(2*cx.f*Math.sqrt(eeP));
const raccourci=(demi-pPatch.L)/demi;
verifie("la longueur du patch est raccourcie de 2 a 5 % du demi-onde",
        raccourci>0.015&&raccourci<0.06,
        (100*raccourci).toFixed(2)+" % (L="+pPatch.L.toFixed(3)+
        " pour "+demi.toFixed(3)+" mm)");
verifie("la largeur du patch tombe entre le demi et le plein demi-onde libre",
        pPatch.W>demi&&pPatch.W<CON_C0/(2*cx.f),
        pPatch.W.toFixed(3)+" mm");
verifie("l'encastrement reste dans le patch",
        pPatch.y0>0&&pPatch.y0<pPatch.L/2, pPatch.y0.toFixed(3)+" mm");

/* La resonance que le trace annonce pour SES cotes doit retomber sur la
   frequence visee : c'est l'aller-retour du calcul sur lui-meme, et il
   attrape toute faute de signe sur l'allongement des bords. */
const tPatch=CON_MOTIF_PATCH.tracer(cx,pPatch);
verifie("la resonance estimee du patch retombe sur la frequence visee",
        Math.abs(tPatch.calcul.festim-cx.f)/cx.f<0.005,
        (tPatch.calcul.festim/1e9).toFixed(4)+" GHz");
/* Et un patch ALLONGE doit resonner PLUS BAS. Une antenne dont on ne sait
   pas dans quel sens corriger ne se corrige pas. */
const tLong=CON_MOTIF_PATCH.tracer(cx,
  Object.assign({},pPatch,{L:pPatch.L*1.05}));
verifie("allonger le patch abaisse la resonance",
        tLong.calcul.festim<tPatch.calcul.festim*0.98,
        (tLong.calcul.festim/1e9).toFixed(4)+" GHz");

/* -- ce que la pose ecrit ------------------------------------------------ */
verifie("poser un motif rend vrai", conGabaritPoser("patch")===true);
const cuP=conCuivres();
verifie("le patch pose du cuivre sur les deux faces",
        CON.elements.some(e=>e.cu===cuP[0].e.uid)&&
        CON.elements.some(e=>e.cu===cuP[1].e.uid));
verifie("le plan de masse couvre toute la carte",
        CON.elements.some(e=>e.cu===cuP[1].e.uid&&e.type==="rect"&&
          Math.abs(e.x2-e.x1-CON.carte.L)<1e-3&&
          Math.abs(e.y2-e.y1-CON.carte.W)<1e-3));
verifie("le port est vertical, du dessus vers le dessous",
        ANT.port.pose&&ANT.port.dir==="z"&&
        ANT.port.de===cuP[0].e.nom&&ANT.port.a===cuP[1].e.nom,
        ANT.port.de+" -> "+ANT.port.a);
verifie("un seul port, et il excite",
        ANT.ports.length===1&&ANT.ports[0].excite);
verifie("le port tombe sur la carte",
        ANT.port.x>=0&&ANT.port.x<=CON.carte.L&&
        ANT.port.y>=0&&ANT.port.y<=CON.carte.W);
verifie("la bande est ouverte a +/-15 % autour de la cible",
        Math.abs(ANT.bande.f1-0.85*CON.fcible)<1&&
        Math.abs(ANT.bande.f2-1.15*CON.fcible)<1);

/* -- l'IFA : le court-circuit et les coutures sont réels -------------- */
conGabaritPoser("ifa");
const viasAnt=CON.elements.filter(e=>e.type==="via"&&e.net==="ANTENNE");
verifie("l'IFA pose 2 vias de court-circuit", viasAnt.length===2);
const doc=conModele();
const perc=doc.perçages||doc.percages||[];
verifie("les vias relient bien la premiere et la derniere couche de cuivre",
        perc.length>=2&&perc.every(p=>p.sa===conCuivres()[0].i&&
                                      p.sb===conCuivres()[conCuivres().length-1].i),
        JSON.stringify(perc[0]||null));
/* Le pied du court-circuit doit tomber SUR le plan de masse, pas a cote :
   un via pose au ras du bord ne court-circuite rien. */
const pIfa=conGabaritDefauts(CON_MOTIF_IFA,cx);
verifie("le pied des vias est sur le plan de masse",
        viasAnt[0].y<pIfa.Lg&&viasAnt[0].y>pIfa.Lg-pIfa.sc-1e-9,
        "y="+viasAnt[0].y+" pour une masse jusqu'a "+pIfa.Lg);
const tIfa=CON_MOTIF_IFA.tracer(cx,pIfa);
const quart=CON_C0/(4*cx.f*Math.sqrt(cx.eeffAir));
const mesure=function(t){
  const bras=t.formes.filter(f=>f.type==="piste")
    .sort((a,b)=>b.pts.length-a.pts.length)[0];
  let d=0;
  for(let i=1;i<bras.pts.length;i++)
    d+=Math.hypot(bras.pts[i][0]-bras.pts[i-1][0],
                  bras.pts[i][1]-bras.pts[i-1][1]);
  return d;
};
verifie("le bras dessine de l'IFA mesure sc + ha + La - wb/2",
        Math.abs(mesure(tIfa)-(pIfa.La-pIfa.wb/2+pIfa.ha+pIfa.sc))<0.1,
        mesure(tIfa).toFixed(4));
/* ET CE DEVELOPPE EST LE QUART D'ONDE DU MOTIF, a l'arrondi d'affichage des
   cotes pres. C'est ce que les proportions classiques promettent : `La` est
   choisie pour boucler le compte, et si la formule de `conIfaClassique` et
   celle de `tracer` cessaient de s'accorder, c'est ici que ca se verrait. */
const quartIfa=CON_C0/(4*cx.f*Math.sqrt(CON_IFA_EEFF));
verifie("le developpe de l'IFA vaut le quart d'onde du motif",
        Math.abs(mesure(tIfa)-quartIfa)<0.02,
        mesure(tIfa).toFixed(4)+" pour "+quartIfa.toFixed(4)+" mm");
/* La resonance annoncee par la fiche doit donc retomber sur la cible : c'est
   la meme egalite, lue du cote de la frequence. */
verifie("et la resonance annoncee retombe sur la frequence visee",
        Math.abs(tIfa.calcul.festim-cx.f)<cx.f*0.005,
        (tIfa.calcul.festim/1e9).toFixed(4)+" GHz pour "+
        (cx.f/1e9).toFixed(4)+" GHz");
verifie("l'alimentation est entre le court-circuit et le bout du bras",
        pIfa.d>0&&pIfa.d<pIfa.La);
verifie("le port de l'IFA est au fond du decroche",
        Math.abs(tIfa.port.y-(pIfa.Lg-pIfa.ed))<1e-4);
verifie("les vias de court-circuit restent hors du decroche",
        viasAnt[0].x<(pIfa.marge+pIfa.d));
verifie("l'IFA par defaut pose un plan de masse en haut (masseTop)",
        tIfa.formes.some(f=>f.cu==="haut"&&!f.trou&&f.type==="rect"&&f.net==="GND"));
verifie("l'IFA avec masseTop pose aussi son decroche d'isolation sur le dessus",
        tIfa.formes.some(f=>f.cu==="haut"&&f.trou&&f.type==="rect"));
verifie("l'IFA pose des vias de couture de masse le long du bord",
        tIfa.formes.some(f=>f.type==="via"&&f.net==="GND"));

/* -- le MIFA : replier ne raccourcit pas le fil -------------------------- */
const pMifa=conGabaritDefauts(CON_MOTIF_MIFA,cx);
const tMifa=CON_MOTIF_MIFA.tracer(cx,pMifa);
verifie("le developpe dessine du meandre vaut aussi le quart d'onde",
        Math.abs(mesure(tMifa)-quart)<0.01,
        mesure(tMifa).toFixed(4)+" pour "+quart.toFixed(4)+" mm");
verifie("le meandre tient sur une carte plus courte que l'IFA droit",
        tMifa.carte.L<tIfa.carte.L*0.8,
        tMifa.carte.L.toFixed(2)+" contre "+tIfa.carte.L.toFixed(2)+" mm");
/* Allonger l'empreinte jusqu'au quart d'onde doit ANNULER les dents : le
   MIFA redevient alors l'IFA droit, et c'est la continuite qui prouve que
   les deux comptent la meme longueur. */
const tPlat=CON_MOTIF_MIFA.tracer(cx,
  Object.assign({},pMifa,{Lx:quart-pMifa.ha-pMifa.sc}));
verifie("une empreinte egale au quart d'onde annule le meandre",
        Math.abs(mesure(tPlat)-quart)<0.01&&tPlat.formes
          .filter(f=>f.type==="piste")[0].pts.length===3,
        mesure(tPlat).toFixed(4)+" mm");
/* Doubler les replis ne change pas le fil, seulement sa forme. */
const tN4=CON_MOTIF_MIFA.tracer(cx,Object.assign({},pMifa,{n:4}));
verifie("doubler les replis ne change pas le developpe",
        Math.abs(mesure(tN4)-quart)<0.01, mesure(tN4).toFixed(4)+" mm");
verifie("le MIFA a un decroche de masse sous l'alimentation",
        tMifa.formes.some(f=>f.cu==="bas"&&f.trou&&f.type==="rect"));
verifie("le port du MIFA est au fond du decroche",
        Math.abs(tMifa.port.y-(pMifa.Lg-pMifa.ed))<1e-4);

/* -- le dipole : un bras par face, aucune masse -------------------------- */
conGabaritPoser("dipole");
const cuD=conCuivres();
verifie("le dipole pose un bras sur chaque face",
        CON.elements.filter(e=>e.cu===cuD[0].e.uid).length===1&&
        CON.elements.filter(e=>e.cu===cuD[1].e.uid).length===1);
verifie("le dipole n'a aucun plan de masse",
        !CON.elements.some(e=>e.net==="GND"));
verifie("la seconde couche n'est plus declaree masse",
        cuD[1].e.role==="signal");
verifie("le port est au centre, dans le chevauchement",
        Math.abs(ANT.port.x-CON.carte.L/2)<1e-3&&
        Math.abs(ANT.port.y-CON.carte.W/2)<1e-3);

/* -- les cotes reprises a la main ---------------------------------------- */
/* Un champ vide pendant la saisie ne doit pas faire disparaitre le dessin :
   la cote manquante retombe sur celle du calcul. */
const cq=conGabaritCotes(CON_MOTIF_PATCH,cx,{L:null,W:undefined,y0:NaN});
verifie("une cote absente retombe sur celle du calcul",
        Math.abs(cq.L-pPatch.L)<1e-9&&Math.abs(cq.W-pPatch.W)<1e-9);
verifie("une cote negative est refusee, pas dessinee",
        conGabaritCotes(CON_MOTIF_PATCH,cx,{L:-3}).L===pPatch.L);
verifie("un encastrement nul est accepte : un patch alimente au bord existe",
        conGabaritCotes(CON_MOTIF_PATCH,cx,{y0:0}).y0===0);
verifie("un nombre de replis est un entier, jamais zero",
        conGabaritCotes(CON_MOTIF_MIFA,cx,{n:0.4}).n===1&&
        conGabaritCotes(CON_MOTIF_MIFA,cx,{n:3.6}).n===4);
verifie("une cote reprise a la main est signalee",
        conGabaritEcarts(CON_MOTIF_PATCH,cx,
          Object.assign({},pPatch,{L:pPatch.L+1})).length===1);
verifie("une cote laissee telle quelle ne l'est pas",
        conGabaritEcarts(CON_MOTIF_PATCH,cx,pPatch).length===0);

/* -- une cote IMPOSEE survit au rafraichissement du panneau --------------- */
/* LE PIEGE ETAIT SILENCIEUX, ET C'EST POURQUOI IL A DURE. `conGabaritPoser`
   pose les cotes recues dans le dessin, mais `conGabaritRafraichir` ne garde
   que celles qui sont marquees comme reprises a la main et rend les autres au
   calcul. L'exemple patch etait donc DESSINE a 27,5 mm -- la carte le prouve --
   pendant que l'etat du panneau retombait aux 29,16 mm du calcul. Le dessin
   n'etait alors plus la copie du motif que l'etat decrit, et le balayage de
   cote, qui repose le motif a chaque point, refusait de se proposer. */
conGabaritPoser("patch",{L:27.5,y0:8.1,g:1.49});
verifie("une cote imposee reste dans l'etat apres rafraichissement",
        (conGabaritRafraichir(),
         Math.abs(CON.gabaritP.L-27.5)<1e-6&&
         Math.abs(CON.gabaritP.y0-8.1)<1e-6&&
         Math.abs(CON.gabaritP.g-1.49)<1e-6),
        JSON.stringify(CON.gabaritP));
verifie("elle est signalee comme reprise, et elle seule",
        CON.gabaritTouche.L===true&&CON.gabaritTouche.y0===true&&
        CON.gabaritTouche.g===true&&CON.gabaritTouche.W===undefined);
verifie("le dessin reste donc la copie exacte du motif : le balayage est offert",
        conGabaritConforme()===true);
/* Une cote posee SUR la valeur du calcul n'est pas une reprise : la fiche ne
   doit pas annoncer un ecart qui n'existe pas. */
const dPatch=conGabaritDefauts(CON_MOTIF_PATCH,cx);
conGabaritPoser("patch",{L:dPatch.L});
verifie("reposer une cote sur la valeur du calcul n'est pas une reprise",
        CON.gabaritTouche.L===undefined);
conGabaritPoser("patch",null);

/* -- l'apercu ne dessine rien -------------------------------------------- */
/* C'EST LA GARANTIE DE TOUT LE MODE : regarder un motif ne doit pas effacer
   le travail en cours. On compte les formes avant et apres avoir rendu les
   six apercus, cotes comprises. */
const avant=CON.elements.length, carteAvant=CON.carte.L;
let svg="";
CON_GABARITS.forEach(function(g){
  svg+=apmVignette(g)+apmPlanche(g,null);
});
verifie("rendre les apercus ne touche ni au dessin ni a la carte",
        CON.elements.length===avant&&CON.carte.L===carteAvant);
verifie("chaque motif rend un dessin non vide",
        (svg.match(/<svg/g)||[]).length===2*CON_GABARITS.length&&
        svg.indexOf("<rect")>=0);
/* Le port est un rectangle rouge et RIEN d'autre : pas d'etiquette dans le
   dessin, qui tomberait forcement sur le cuivre qu'elle designe. C'est la
   legende du panneau qui le nomme. */
const planche=apmPlanche(CON_MOTIF_PATCH,null);
verifie("la planche porte ses cotes",
        planche.indexOf('data-cote="L"')>=0&&
        planche.indexOf('data-cote="y0"')>=0);
const plancheIfa=apmPlanche(CON_MOTIF_IFA,null);
verifie("la planche IFA porte ses cotes de decroche ed et gd",
        plancheIfa.indexOf('data-cote="ed"')>=0&&
        plancheIfa.indexOf('data-cote="gd"')>=0);
verifie("la planche montre le port, et la vignette non",
        planche.indexOf("var(--red)")>=0&&
        apmVignette(CON_MOTIF_PATCH).indexOf("var(--red)")<0);

/* -- tous les motifs, une passe de bon sens ------------------------------ */
/* Ce qu'aucun motif n'a le droit de faire, quelle que soit la frequence :
   sortir du substrat, poser un port hors carte, ou rendre une carte nulle.
   Trois bandes qui couvrent l'usage — 868 MHz, 2,45 GHz, 5,8 GHz. */
[868e6,2.45e9,5.8e9].forEach(function(f){
  CON.fcible=f;
  const c=conContexte();
  CON_GABARITS.forEach(function(g){
    const t=g.tracer(c,conGabaritCotes(g,c,null));
    const ok=t.carte.L>0&&t.carte.W>0&&
      t.port.x>=0&&t.port.x<=t.carte.L&&
      t.port.y>=0&&t.port.y<=t.carte.W&&
      t.port.w>0&&t.port.l>0&&
      t.formes.length>0;
    verifie(g.id+" tient sur sa carte a "+(f/1e9).toFixed(3)+" GHz", ok,
            JSON.stringify(t.carte)+" port "+JSON.stringify(t.port));
  });
});
CON.fcible=2.45e9;

console.log("");
console.log("5. Les gestes du dessin, et l'historique");
/* POURQUOI CETTE SECTION A MIS SI LONGTEMPS A S'ECRIRE, ET CE QU'ELLE PEUT.
   `21-dessin.js` traduit des pointeurs en formes : une faute y est VISIBLE —
   le rectangle part de travers, et on le voit. C'est ce qui l'a rendue moins
   urgente que les formules, qui, elles, rendaient une antenne d'allure
   normale. Restent trois choses qui ne se voient pas a l'oeil : un accrochage
   a la grille qui rend un nombre presque rond, une polyligne refusee sans
   qu'on sache pourquoi, et un historique qui recule d'un cran de trop.

   Le banc n'ouvre aucun navigateur : `cv` est nul, donc les ecouteurs du
   canevas ne se posent pas. Ce qui s'eprouve ici est ce qui DECIDE — les
   fonctions que les gestes appellent, et le clavier, qui lui est bien pose
   sur la fenetre et qu'on declenche pour de bon. */
global.cv=null;
global.V.vue={scale:1, ox:0, oy:0, flip:false};
/* Ce que `conAppliquer` appelle et que le banc n'a pas : la vue, le modele,
   les panneaux. Ces appuis ne cachent rien — ils rendent la main a la seule
   partie qui decide, celle qui refait le document et pousse l'historique. */
global.mdlCharger=function(){};
global.pnlTout=function(){};
global.fit=function(){};
global.dessiner=function(){};
global.redessiner=function(){};
global.antMaj=function(){};
/* Celui-la n'est plus un appui muet : c'est lui qui dit quelle forme un clic
   designe. */
extraire("02-modele.js","mdlDansPoly");
charger("21-dessin.js");

/* -- l'accrochage a la grille -------------------------------------------- */
CON.grille=0.25;
verifie("un point accroche tombe sur un multiple du pas",
        [0.13,1.3,7.77,-2.2,0].every(function(v){
          const q=conSnap(v)/CON.grille;
          return Math.abs(q-Math.round(q))<1e-9;
        }));
verifie("il tombe sur le multiple LE PLUS PROCHE",
        conSnap(1.3)===1.25&&conSnap(1.4)===1.5, String(conSnap(1.3)));
CON.grille=0;
verifie("une grille nulle n'accroche rien mais arrondit au dix-millieme",
        conSnap(1.23456789)===1.2346, String(conSnap(1.23456789)));
CON.grille=0.25;

/* -- une polyligne trop courte n'est pas une forme ------------------------ */
CON.actif=true;
CON.elements=[]; CON.sel=-1; CON.calcul=null;
CON.carte.L=60; CON.carte.W=50;
CON.coucheActive=conPremierCuivre();
conHistRaz();
verifie("au depart de la seance, il n'y a rien a annuler",
        !conPeutAnnuler()&&!conPeutRefaire());

CON.courant={type:"poly", pts:[[0,0],[5,0]]};
conTerminerPolyligne();
verifie("un polygone de moins de trois points est refuse",
        CON.elements.length===0&&CON.courant===null);
CON.courant={type:"piste", pts:[[0,0]]};
conTerminerPolyligne();
verifie("une piste d'un seul point est refusee aussi",
        CON.elements.length===0);
const ptsSrc=[[0,0],[5,0],[5,5]];
CON.courant={type:"poly", pts:ptsSrc};
conTerminerPolyligne();
verifie("trois points font un polygone", CON.elements.length===1);
ptsSrc[0][0]=99;
verifie("la forme posee ne partage plus ses points avec le trace",
        CON.elements[0].pts[0][0]===0, String(CON.elements[0].pts[0][0]));

/* -- une forme trop petite est un clic qui a bouge ------------------------ */
verifie("un rectangle plus petit que la grille n'est pas une forme",
        conAssezGrande({type:"rect",x1:0,y1:0,x2:0.05,y2:0.05})===false);
verifie("un rectangle d'un pas de grille en est une",
        conAssezGrande({type:"rect",x1:0,y1:0,x2:0.25,y2:0.25})===true);

/* -- deplacer deplace TOUT, et du meme vecteur ---------------------------- */
const poly={type:"poly", pts:[[1,1],[4,1],[4,3]]};
conDeplacer(poly,2.5,-0.5);
verifie("deplacer un polygone decale tous ses sommets du meme vecteur",
        poly.pts.every(function(q,i){
          return Math.abs(q[0]-([1,4,4][i]+2.5))<1e-9&&
                 Math.abs(q[1]-([1,1,3][i]-0.5))<1e-9;
        }), JSON.stringify(poly.pts));
const rc={type:"rect",x1:0,y1:0,x2:10,y2:4};
conDeplacer(rc,1,2);
verifie("un rectangle garde ses dimensions en se deplacant",
        rc.x1===1&&rc.y1===2&&rc.x2===11&&rc.y2===6);
const dq={type:"disque",cx:5,cy:5,r:2};
conDeplacer(dq,-1,0);
verifie("un disque garde son rayon", dq.cx===4&&dq.cy===5&&dq.r===2);

/* -- la forme sous le curseur est la plus RECENTE ------------------------- */
CON.elements=[];
conNouvelle("rect",{x1:0,y1:0,x2:40,y2:30});      // un plan
conNouvelle("rect",{x1:10,y1:10,x2:20,y2:20});    // une decoupe posee dessus
verifie("le clic prend la forme posee en dernier, pas la plus grande",
        conFormeSous(15,15)===1&&conFormeSous(2,2)===0);
verifie("un clic dans le vide ne prend rien", conFormeSous(100,100)===-1);

/* -- l'historique --------------------------------------------------------- */
CON.elements=[]; CON.sel=-1;
conHistRaz();
conNouvelle("rect",{x1:0,y1:0,x2:10,y2:10});   conAppliquer(false);
conNouvelle("rect",{x1:20,y1:0,x2:30,y2:10});  conAppliquer(false);
verifie("chaque modification acceptee est un cran",
        CON.elements.length===2&&conPeutAnnuler()&&!conPeutRefaire());
conAnnuler();
verifie("annuler retire la derniere forme", CON.elements.length===1,
        String(CON.elements.length));
conAnnuler();
verifie("annuler jusqu'au bout rend le dessin vide, et s'y arrete",
        CON.elements.length===0&&!conPeutAnnuler());
conRefaire(); conRefaire();
verifie("refaire les remet toutes les deux, et s'arrete aussi",
        CON.elements.length===2&&!conPeutRefaire());
conAnnuler();
conNouvelle("disque",{cx:5,cy:5,r:2}); conAppliquer(false);
verifie("dessiner apres une annulation coupe la branche abandonnee",
        !conPeutRefaire()&&CON.elements.length===2&&
        CON.elements[1].type==="disque");

/* Supprimer se defait : c'est le geste qu'on regrette le plus, parce qu'une
   touche suffit a le faire sans l'avoir voulu. */
CON.sel=1;
conSupprimerChoisie();
verifie("supprimer la forme choisie est un cran aussi",
        CON.elements.length===1&&CON.sel===-1);
conAnnuler();
verifie("annuler ramene la forme supprimee",
        CON.elements.length===2&&CON.elements[1].type==="disque");

/* Un etat identique ne se pousse pas : le balayage remet le dessin en place
   par `conAppliquer`, et quarante points de balayage enterreraient sinon le
   geste d'avant. */
const crans=CON_HIST.pile.length;
conAppliquer(false); conAppliquer(false);
verifie("appliquer sans rien changer n'ajoute aucun cran",
        CON_HIST.pile.length===crans,
        CON_HIST.pile.length+" au lieu de "+crans);

/* -- un gabarit s'annule EN ENTIER ---------------------------------------- */
/* C'est le cas qui a decide de la forme de l'historique : un motif refait la
   carte, l'empilage, la bande et le port. Annuler ses seules formes
   laisserait un port pose sur du cuivre efface. */
const carteAv=CON.carte.L+" x "+CON.carte.W;
const portAv=JSON.stringify(ANT.ports);
const nAv=CON.elements.length;
conGabaritPoser("patch");
verifie("poser un motif refait bien la carte",
        (CON.carte.L+" x "+CON.carte.W)!==carteAv&&CON.elements.length!==nAv);
conAnnuler();
verifie("annuler un motif rend la carte d'avant",
        (CON.carte.L+" x "+CON.carte.W)===carteAv,
        CON.carte.L+" x "+CON.carte.W+" au lieu de "+carteAv);
verifie("annuler un motif rend aussi les ports d'avant",
        JSON.stringify(ANT.ports)===portAv);
verifie("et les formes d'avant", CON.elements.length===nAv);

/* -- le clavier, pour de bon ---------------------------------------------- */
/* Les raccourcis sont declenches par l'ecouteur REEL, pose sur la fenetre au
   chargement du module : c'est la garde qui se trompe, jamais la fonction. */
const nClav=CON.elements.length;
conNouvelle("rect",{x1:50,y1:0,x2:55,y2:5}); conAppliquer(false);
touche({key:"z", ctrlKey:true});
verifie("Ctrl+Z annule depuis le clavier", CON.elements.length===nClav,
        String(CON.elements.length));
touche({key:"y", ctrlKey:true});
verifie("Ctrl+Y refait", CON.elements.length===nClav+1);
touche({key:"z", ctrlKey:true});
touche({key:"Z", ctrlKey:true, shiftKey:true});
verifie("Ctrl+Maj+Z refait, comme partout, et la majuscule ne le gene pas",
        CON.elements.length===nClav+1, String(CON.elements.length));
touche({key:"z", metaKey:true});
verifie("Cmd+Z annule sur un Mac", CON.elements.length===nClav);
touche({key:"y", ctrlKey:true});

/* Ce que le raccourci ne doit PAS prendre. */
const nGarde=CON.elements.length;
touche({key:"z", ctrlKey:true, target:{tagName:"INPUT"}});
verifie("Ctrl+Z dans un champ de saisie appartient au champ",
        CON.elements.length===nGarde);
touche({key:"z", ctrlKey:true, altKey:true});
verifie("Ctrl+Alt+Z n'est pas Ctrl+Z", CON.elements.length===nGarde);
touche({key:"s", ctrlKey:true});
verifie("les autres raccourcis a Ctrl passent leur chemin",
        CON.elements.length===nGarde);

/* Une polyligne en cours se defait sommet par sommet : elle n'est dans aucun
   historique tant qu'elle n'est pas fermee. */
CON.courant={type:"poly", pts:[[0,0],[1,0],[2,0]], apercu:[2,0]};
touche({key:"z", ctrlKey:true});
verifie("Ctrl+Z pendant une polyligne retire un sommet, pas la forme d'avant",
        CON.courant&&CON.courant.pts.length===2&&
        CON.elements.length===nGarde,
        JSON.stringify(CON.courant&&CON.courant.pts));
touche({key:"z", ctrlKey:true});
touche({key:"z", ctrlKey:true});
verifie("le dernier sommet retire ferme le trace, sans rien annuler d'autre",
        CON.courant===null&&CON.elements.length===nGarde);
CON.actif=false;

console.log("");
console.log("6. Le tableau S complet, et son fichier Touchstone");
/* POURQUOI CETTE SECTION EXISTE, ET C'EST LE MEME CRITERE QUE LES AUTRES.
   L'ordre des colonnes d'un fichier Touchstone a deux ports est S11 S21 S12
   S22 — par COLONNES —, alors que le format range par LIGNES des trois ports
   et au-dela. Un .s2p ecrit dans l'ordre des lignes echange S12 et S21 ; et
   comme les deux sont presque egaux sur une structure reciproque, RIEN ne le
   montre. C'est exactement le genre de faute que ce banc existe pour
   attraper : elle ne fait rien planter, elle rend un fichier qui a l'air d'un
   fichier.

   Le second interdit est celui qui a empeche ce fichier d'exister jusqu'ici :
   une case manquante ne s'ecrit pas. Un lecteur Touchstone lit une case
   absente comme un zero, c'est-a-dire comme une isolation parfaite. */
global.Blob=function(parts){ this.parts=parts; };
let ECRIT=null;
global.telecharger=function(blob,nom){ ECRIT={nom:nom, texte:blob.parts[0]}; };
let DIT="";
global.wsHint=function(t){ DIT=String(t); };
global.nomBase=function(){ return "antenne"; };
global.aEsc=function(t){ return String(t==null?"":t); };
global.aNb=function(v,d){ return Number(v).toFixed(d==null?3:d); };
global.aEnt=function(v){ return String(Math.round(v)); };
global.aF=function(v){ return (v/1e9).toFixed(3)+" GHz"; };
global.antDuree=function(v){ return Math.round(v)+" s"; };
global.antBalCouleur=function(){ return "#000"; };
global.V.fichier="deux-brins.xml";
charger("29-tableau-s.js");

/* Un tableau a deux ports, fabrique de toutes pieces : trois frequences, des
   valeurs que l'oeil distingue, et S12 = S21 a un cheveu pres — comme sur une
   vraie structure passive. */
function caseS(re,im){ return {re:re, im:im}; }
const TS2={
  tableau_s:true,
  ports:[{n:1,nom:"port 1",type:"localise",R:50},
         {n:2,nom:"port 2",type:"localise",R:50}],
  f:[2.0e9,2.45e9,3.0e9],
  s:[[caseS([-0.5,-0.1,0.2],[0,0.05,-0.1]), caseS([0.01,0.03,0.02],[0,0.01,0])],
     [caseS([0.01,0.031,0.02],[0,0.01,0]), caseS([-0.4,-0.2,0.3],[0.1,0,0])]],
  colonnes:[{n:1,etat:"fini",detail:""},{n:2,etat:"fini",detail:""}],
  reciprocite:{ecart:0.001, ou:"S12 / S21", amplitude:0.0326},
  premier:{f0:2.45e9}
};
ANT.resultat=TS2;
verifie("un resultat de tableau est reconnu comme tel", antTs()===TS2);
verifie("les decibels d'une case sont ceux de son module",
        Math.abs(antTsDb(antTsCase(TS2,0,0),0)-20*Math.log10(0.5))<1e-9,
        String(antTsDb(antTsCase(TS2,0,0),0)));
verifie("la ligne lue est celle de la resonance, pas la premiere",
        antTsIndexF0(TS2)===1, String(antTsIndexF0(TS2)));
verifie("un tableau dont toutes les cases sont la est complet",
        antTsComplet(TS2)===true);
verifie("les N carres courbes sont toutes la, nommees Sij",
        antTsSeries(TS2).map(s=>s.nom).join(" ")==="S11 S12 S21 S22",
        antTsSeries(TS2).map(s=>s.nom).join(" "));

/* -- le fichier ----------------------------------------------------------- */
ECRIT=null; DIT="";
antExportSnp();
verifie("un tableau a deux ports s'ecrit en .s2p",
        !!ECRIT&&ECRIT.nom==="antenne.s2p", ECRIT&&ECRIT.nom);
const L2=ECRIT.texte.split("\r\n");
verifie("l'entete Touchstone dit l'unite, le parametre, le format et R",
        L2.some(l=>l==="# HZ S RI R 50"), L2.slice(0,8).join(" | "));
verifie("tout ce qui n'est pas donnee est en commentaire",
        L2.filter(l=>l&&!l.startsWith("!")&&!l.startsWith("#"))
          .every(l=>/^[\d.eE+-]/.test(l)));
/* LA VERIFICATION QUI JUSTIFIE LA SECTION. La deuxieme paire de la ligne est
   S21 et non S12 : l'ordre historique du .s2p est celui des COLONNES. */
const ligne0=L2.filter(l=>l&&!l.startsWith("!")&&!l.startsWith("#"))[0]
              .trim().split(/\s+/).map(Number);
verifie("une ligne de .s2p porte la frequence et quatre paires",
        ligne0.length===9, String(ligne0.length));
verifie("l'ordre est S11 S21 S12 S22, par colonnes et non par lignes",
        ligne0[1]===-0.5&&ligne0[3]===0.01&&ligne0[5]===0.01&&ligne0[7]===-0.4&&
        ligne0[4]===0&&ligne0[8]===0.1,
        JSON.stringify(ligne0));
verifie("S21 et S12 ne sont pas la meme case",
        antTsCase(TS2,1,0).re[1]!==antTsCase(TS2,0,1).re[1]);
const ligne1=L2.filter(l=>l&&!l.startsWith("!")&&!l.startsWith("#"))[1]
              .trim().split(/\s+/).map(Number);
verifie("la deuxieme ligne prend bien S21 a la deuxieme frequence",
        Math.abs(ligne1[3]-0.031)<1e-12, String(ligne1[3]));
/* La virgule decimale est la convention de toute la page ; un fichier
   Touchstone, lui, est lu par des machines qui ne connaissent que le point.
   Seules les lignes de DONNEES sont concernees — un commentaire peut porter
   toutes les virgules qu'il veut. */
/* La frequence s'ecrit en hertz entiers : « 2.45e+9 » est du Touchstone
   valide, mais « la plupart des lecteurs l'acceptent » n'est pas assez pour
   un fichier qu'on donne a un outil qu'on ne choisit pas. */
verifie("la frequence s'ecrit sans exposant",
        /^2000000000\s/.test(L2.filter(l=>l&&!l.startsWith("!")&&
                                          !l.startsWith("#"))[0]),
        L2.filter(l=>l&&!l.startsWith("!")&&!l.startsWith("#"))[0].slice(0,30));
verifie("les nombres portent le point decimal, pas la virgule",
        L2.filter(l=>l&&!l.startsWith("!")&&!l.startsWith("#"))
          .every(l=>l.indexOf(",")<0));
verifie("le fichier dit d'ou il vient et combien de simulations",
        ECRIT.texte.indexOf("tableau S complet")>0);

/* -- ce qui ne s'ecrit pas ------------------------------------------------ */
/* Une case absente serait lue comme un zero, c'est-a-dire comme une isolation
   parfaite : le fichier ne s'ecrit pas, et il est dit pourquoi. */
const TSrate=JSON.parse(JSON.stringify(TS2));
TSrate.s[0][1]=null; TSrate.s[1][1]=null;
TSrate.colonnes[1].etat="echoue";
ANT.resultat=TSrate;
ECRIT=null; DIT="";
antExportSnp();
verifie("un tableau incomplet ne s'exporte pas", ECRIT===null);
verifie("et l'on dit laquelle des deux choses manque",
        DIT.indexOf("incomplet")>0, DIT);
verifie("le verdict compte les colonnes qui n'ont pas abouti",
        antTsVerdict(TSrate).indexOf("pas abouti")>0);

/* Touchstone 1.1 ne declare qu'UNE impedance de reference : des ports de R
   differents ne s'y ecrivent pas sans mentir sur l'un d'eux. */
const TSr=JSON.parse(JSON.stringify(TS2));
TSr.ports[1].R=75;
ANT.resultat=TSr;
ECRIT=null; DIT="";
antExportSnp();
verifie("des ports de references differentes ne s'exportent pas",
        ECRIT===null&&DIT.indexOf("75")>0&&DIT.indexOf("Touchstone")>0, DIT);

/* -- trois ports : l'ordre redevient celui des lignes --------------------- */
const TS3={
  tableau_s:true,
  ports:[{n:1,nom:"p1",type:"localise",R:50},
         {n:2,nom:"p2",type:"localise",R:50},
         {n:3,nom:"p3",type:"localise",R:50}],
  f:[2.4e9,2.5e9],
  s:[], colonnes:[{n:1,etat:"fini"},{n:2,etat:"fini"},{n:3,etat:"fini"}],
  reciprocite:{ecart:0,ou:"",amplitude:0}, premier:{f0:2.4e9}
};
for(let i=0;i<3;i++){
  TS3.s.push([]);
  for(let j=0;j<3;j++)
    TS3.s[i].push(caseS([(i+1)*10+(j+1),(i+1)*10+(j+1)],[0,0]));
}
ANT.resultat=TS3;
ECRIT=null; DIT="";
antExportSnp();
verifie("trois ports s'ecrivent en .s3p", !!ECRIT&&ECRIT.nom==="antenne.s3p",
        ECRIT&&ECRIT.nom);
const D3=ECRIT.texte.split("\r\n")
          .filter(l=>l&&!l.startsWith("!")&&!l.startsWith("#"));
verifie("chaque frequence occupe une ligne de fichier par ligne de matrice",
        D3.length===6, String(D3.length));
const m3=D3.map(l=>l.trim().split(/\s+/).map(Number));
verifie("la frequence n'est ecrite qu'une fois, au debut du bloc",
        m3[0].length===7&&m3[1].length===6, m3[0].length+"/"+m3[1].length);
verifie("au-dela de deux ports, l'ordre est celui des LIGNES",
        m3[0][1]===11&&m3[0][3]===12&&m3[0][5]===13&&
        m3[1][0]===21&&m3[2][0]===31,
        JSON.stringify([m3[0].slice(0,7),m3[1].slice(0,2)]));

/* -- le panneau de lancement --------------------------------------------- */
ANT.resultat=null;
ANT.etatServeur={lancer:true};
/* Le cout annonce se calcule sur le modele courant : sans lui, la page n'a
   rien a multiplier, et c'est justement la ligne qu'on veut voir. */
ANT.modele={estimation:{cellules:5e6, dt_s:1e-12, mcps_suppose:25},
            arret:{nmax:30000}, bande:{f0:2.45e9}};
verifie("un seul port ne propose pas de tableau",
        ANT.ports.length===1&&antTableauSHtml()==="");
antPortAjouter();
const h=antTableauSHtml();
verifie("deux ports le proposent, et annoncent DEUX simulations",
        h.indexOf("2</b> ports, donc <b>2</b> simulations")>0);
verifie("le cout annonce est celui du total, pas d'une colonne",
        h.indexOf("en tout, contre")>0);
antPortRetirer(1);


console.log("");
console.log("7. Balayer une cote de MOTIF, et lire un croisement");
/* POURQUOI CETTE SECTION EXISTE. « La longueur du patch » n'est pas la largeur
   d'un rectangle : elle deplace le patch, la carte qui le porte et le port au
   bout de la ligne, et sur un meandre elle redessine quatorze segments. Faire
   varier une cote de motif, c'est donc REPOSER le motif a chaque point — et
   c'est la que les fautes ne se voient pas :

   - un dessin qu'on ne restaure pas laisse le dernier point pose a l'ecran, et
     la seance continue sur une antenne qu'on n'a pas choisie ;
   - une carte qui ne suit pas la cote fait depasser le patch du substrat, sans
     qu'aucun cuivre n'ait tort ;
   - un motif repose sur un dessin retouche a la main efface la retouche sur
     TOUS les points, et rien dans la famille de courbes ne le dirait.

   Les trois rendent une courbe qui a l'air d'une courbe. */
CON.actif=true;
CON.pile=conPileDefaut();
CON.coucheActive=conPremierCuivre();
CON.fcible=2.45e9;
CON.gabarit=null;
conGabaritPoser("patch");
const mP=Object.assign({},CON.gabaritP);

verifie("le dessin est la copie exacte du motif qu'on vient de poser",
        conGabaritConforme());

/* `conGabaritTrace` ne touche a rien : c'est ce qui permet de reposer le motif
   quarante fois sans que le dessin bouge d'un micron. */
const n7=CON.elements.length, L7=CON.carte.L, px7=ANT.port.x;
const tr7=conGabaritTrace(conGabarit("patch"),conContexte(),
                          Object.assign({},mP,{L:mP.L+5}));
verifie("tracer un motif ne touche ni au dessin, ni a la carte, ni au port",
        CON.elements.length===n7&&CON.carte.L===L7&&ANT.port.x===px7);
verifie("mais il rend bien le motif demande, plus long",
        tr7&&tr7.elements.length===n7&&tr7.t.carte.L>L7,
        tr7?String(tr7.t.carte.L)+" contre "+L7:"rien");

/* -- ce que le balayage propose ------------------------------------------ */
let srcs7=balSources();
verifie("les cotes du motif sont proposees au balayage",
        ["m.L","m.W","m.y0","m.g"].every(id=>srcs7.some(s=>s.id===id)),
        srcs7.map(s=>s.id).join());
verifie("et portent la cote posee, pas celle du calcul",
        srcs7.find(s=>s.id==="m.g").valeur===mP.g);

/* LE GARDE-FOU. Un dessin qui n'est plus le motif ne propose plus ses cotes :
   reposer effacerait ce qu'on y a ajoute, sur tous les points a la fois. */
CON.elements.push({type:"rect",cu:conCuivres()[0].e.uid,net:"",
                   x1:0,y1:0,x2:1,y2:1});
verifie("un dessin retouche ne propose plus les cotes du motif",
        !conGabaritConforme()&&
        !balSources().some(s=>String(s.id).indexOf("m.")===0));
CON.elements.pop();
verifie("et il les repropose des que le dessin redevient le motif",
        conGabaritConforme()&&balSources().some(s=>s.id==="m.L"));

/* -- le document tel qu'il SERAIT ---------------------------------------- */
/* Le document complet demande la visionneuse, qui demande un navigateur. Ce
   qui s'eprouve ici est ce que le balayage attend de lui : que reposer le
   motif entraine le dessin, la carte ET le port, et que tout revienne
   exactement en place ensuite. */
global.antDocument=function(){
  return {carte:[CON.carte.L,CON.carte.W],
          port:[ANT.port.x,ANT.port.y,ANT.port.w,ANT.port.l],
          formes:JSON.parse(JSON.stringify(CON.elements))};
};
const D0=JSON.stringify(antDocument()), d0=JSON.parse(D0);
const sg7=balSources().find(s=>s.id==="m.g");
const sW7=balSources().find(s=>s.id==="m.W");
const dG=balDocumentPour([{src:sg7, v:mP.g+1}]);
verifie("une cote de motif change bien le document",
        JSON.stringify(dG)!==D0);
verifie("et le dessin revient exactement en place",
        JSON.stringify(antDocument())===D0);
const dW=balDocumentPour([{src:sW7, v:mP.W+4}]);
verifie("elargir le patch elargit la carte",
        dW.carte[1]>d0.carte[1],
        String(dW.carte[1])+" contre "+d0.carte[1]);
verifie("et deplace le port, qui est pose au bord",
        dW.port[1]!==d0.port[1],
        String(dW.port[1])+" contre "+d0.port[1]);
verifie("la carte revient elle aussi",
        JSON.stringify(antDocument())===D0);
/* LES OBJETS DES PORTS SONT REMIS EN PLACE, ET NON REMPLACES PAR DES COPIES.
   `conPoser` tronque le tableau a un seul port ; rendre a la place un tableau
   neuf laisserait l'overlay et le panneau designer un objet que plus rien ne
   met a jour — un port qu'on deplacerait a la souris ne bougerait plus dans
   le document, et rien ne le dirait. */
const refTab7=ANT.ports, refPort7=ANT.ports[0];
balDocumentPour([{src:sW7, v:mP.W+6}]);
verifie("le balayage rend les objets de port, et non des copies",
        ANT.ports===refTab7&&ANT.ports[0]===refPort7);
verifie("et le port a retrouve sa position",
        ANT.ports[0].y===d0.port[1],
        String(ANT.ports[0].y)+" contre "+d0.port[1]);

/* UN SECOND PORT SURVIT AU BALAYAGE D'UNE COTE DE MOTIF. La POSE d'un motif
   le supprime — il désignait du cuivre qui n'existe plus —, mais un point de
   balayage ne déplace qu'une cote : l'effacer à chaque point retirerait le
   couplage de TOUTES les courbes, et rien ne le dirait. */
antPortAjouter&&antPortAjouter();
ANT.ports[1].x=3; ANT.ports[1].y=4; ANT.ports[1].de="Cuivre dessus";
ANT.ports[1].a="Cuivre dessous"; ANT.ports[1].excite=false;
ANT.ports[0].excite=true; ANT.portActif=0;
const ref2=ANT.ports[1];
const dDeux=balDocumentPour([{src:sg7, v:mP.g+1}]);
verifie("un second port survit a un point de balayage de motif",
        dDeux.port.length===4&&ANT.ports.length===2,
        "ports rendus : "+ANT.ports.length);
verifie("et il est remis en place, objet compris",
        ANT.ports.length===2&&ANT.ports[1]===ref2&&
        ANT.ports[1].x===3&&ANT.ports[1].y===4);
verifie("l'excitation n'a pas change de port",
        ANT.ports[0].excite===true&&ANT.ports[1].excite===false);
antPortRetirer(1);
verifie("le dessin est toujours celui de depart apres tout cela",
        JSON.stringify(antDocument())===D0);

/* -- le croisement de deux cotes de motif -------------------------------- */
ANT.balayage={actif:true, source:"m.g", min:mP.g-1, max:mP.g+1, pas:1,
              croise:true, source2:"m.y0",
              min2:mP.y0-3, max2:mP.y0+3, pas2:3, points:[]};
const sp7=antBalayageSpec();
verifie("croiser deux cotes de motif fait neuf points",
        sp7.points.length===9, String(sp7.points.length));
/* LE POINT AUX COTES POSEES NE CHANGE RIEN, et c'est la meilleure preuve que
   le motif est repose a l'identique : le document refait est alors le document
   de depart, au bit pres. */
const centre=sp7.points.find(p=>Math.abs(p.valeur-mP.g)<1e-9&&
                                Math.abs(p.valeur2-mP.y0)<1e-9);
verifie("le point aux cotes posees ne change rien au document",
        centre&&centre.modifs.length===0,
        centre?String(centre.modifs.length):"point introuvable");
verifie("les huit autres, si",
        sp7.points.filter(p=>p.modifs.length>0).length===8);
verifie("et le dessin est toujours celui de depart",
        JSON.stringify(antDocument())===D0);

/* -- le tableau S : chaque colonne a son diagramme ----------------------- */
/* DEUX ANTENNES COUPLEES NE RAYONNENT PAS PAREIL SELON CELLE QUI EMET :
   l'autre devient une charge posee a cote. Le diagramme de la colonne 2 n'est
   donc pas celui de la colonne 1, et les deux sont deja calcules. */
charger("16-resultats.js");
TS2.colonnes[0].resultat={f0:2.45e9, nf2ff:{dmax_dbi:3.0}};
TS2.colonnes[1].resultat={f0:2.46e9, nf2ff:{dmax_dbi:5.5}};
ANT.resultat=TS2;
ANT_TS_COL=0;
verifie("par defaut, les onglets montrent la premiere colonne",
        antTsResultat(TS2).nf2ff.dmax_dbi===3.0);
ANT_TS_COL=1;
verifie("choisir une colonne change le diagramme montre",
        antTsResultat(TS2).nf2ff.dmax_dbi===5.5);
verifie("et c'est bien celui-la que prennent les onglets detailles",
        antRes().nf2ff.dmax_dbi===5.5);
ANT_TS_COL=7;
verifie("une colonne hors liste ne sort pas du tableau",
        antTsResultat(TS2).nf2ff.dmax_dbi===5.5);
TS2.colonnes[1].resultat=null;
ANT_TS_COL=1;
verifie("une colonne qui n'a pas abouti retombe sur le resultat ordinaire",
        antTsResultat(TS2)===TS2.premier);
ANT_TS_COL=0;

/* -- la famille de courbes d'un croisement ------------------------------- */
/* TRENTE-SIX COURBES SUR UN DEGRADE UNIQUE NE SE LISENT PAS : le rang d'un
   point est celui du PRODUIT, et la couleur ne designe alors aucune des deux
   cotes. La couleur porte le premier axe, le trait porte le second. */
const BAL9={balayage:true, croise:true, nom:"g", unite:"mm",
            nom2:"y0", unite2:"mm", points:[]};
[1,2,3].forEach(a=>[10,11].forEach(b=>BAL9.points.push(
  {valeur:a, valeur2:b, etiquette:a+" × "+b,
   resultat:{s11_db:[-3], f:[2.45e9], f0:2.45e9}})));
const ax9=antBalAxes(BAL9);
verifie("les deux axes d'un croisement se retrouvent dans les points",
        ax9.v1.join()==="1,2,3"&&ax9.v2.join()==="10,11",
        JSON.stringify(ax9));
verifie("deux points de meme premiere cote ont la meme couleur",
        antBalCouleurDe(BAL9,BAL9.points[0],0)===
        antBalCouleurDe(BAL9,BAL9.points[1],1));
verifie("deux premieres cotes differentes ont des couleurs differentes",
        antBalCouleurDe(BAL9,BAL9.points[0],0)!==
        antBalCouleurDe(BAL9,BAL9.points[2],2));
verifie("deux points de meme seconde cote ont le meme trait",
        JSON.stringify(antBalTirets(BAL9,BAL9.points[0]))===
        JSON.stringify(antBalTirets(BAL9,BAL9.points[2])));
verifie("deux secondes cotes differentes ont des traits differents",
        JSON.stringify(antBalTirets(BAL9,BAL9.points[0]))!==
        JSON.stringify(antBalTirets(BAL9,BAL9.points[1])));
/* Sans croisement, rien ne change : la couleur porte le rang, et le trait est
   plein. Une famille a un seul axe se lisait deja tres bien. */
const BAL3={balayage:true, croise:false, points:BAL9.points.slice(0,3)};
verifie("un balayage a un seul axe garde son degrade par rang",
        antBalCouleurDe(BAL3,BAL3.points[0],0)!==
        antBalCouleurDe(BAL3,BAL3.points[1],1));
verifie("et n'a aucun trait tirete",
        antBalTirets({points:[{valeur:1,valeur2:null}]},
                     {valeur:1,valeur2:null})===null);
verifie("l'echantillon de legende reprend le motif du trait",
        antTiretsCss([7,4],"#fff").indexOf("repeating-linear-gradient")>=0&&
        antTiretsCss([],"#fff")==="background:#fff",
        antTiretsCss([7,4],"#fff"));

/* ==========================================================================
   9. Le mode IA — la liste blanche, et rien d'autre
   --------------------------------------------------------------------------
   POURQUOI CETTE SECTION EXISTE. Tout le reste du banc eprouve des calculs :
   une conversion fausse rend un mauvais nombre, et on finit par le voir. Ici
   on eprouve une BARRIERE, et une barriere qui laisse passer ne se voit
   jamais — le reglage change, la simulation tourne, le resultat a l'air d'un
   resultat. C'est le seul endroit de l'outil ou du texte venu du reseau
   touche a l'etat, et c'est donc celui qui doit etre verifie ligne a ligne.

   `js/30-ia.js` est une fermeture, comme l'assistant de WEB_CAO dont il
   reprend l'interface : ce qui suit passe par les fonctions qu'il expose sur
   `window`, c'est-a-dire exactement celles dont la justesse doit etre prouvee.
   ========================================================================== */
console.log("");
console.log("9. Le mode IA");

global.hint=function(){};
global.antMaj=function(){};
global.antAssistantRendre=function(){};
global.btoa=s=>Buffer.from(s,"binary").toString("base64");
global.atob=s=>Buffer.from(s,"base64").toString("binary");
charger("30-ia.js");

const iaResoudre=window.iaResoudre, iaValider=window.iaValider,
      iaProposition=window.iaProposition, iaAppliquer=window.iaAppliquer,
      iaAnnuler=window.iaAnnuler, iaControles=window.iaControles,
      iaGrammaire=window.iaGrammaire, iaMd=window.iaFormaterMarkdown,
      IA_CHAMPS=window.IA_CHAMPS;

verifie("le module expose ce qu'il faut pour l'eprouver",
        [iaResoudre,iaValider,iaProposition,iaAppliquer,iaAnnuler,
         iaControles,iaGrammaire,iaMd].every(f=>typeof f==="function")&&
        !!IA_CHAMPS);

/* -- ce qui est refuse --------------------------------------------------- */
verifie("un chemin hors de la liste blanche est refuse",
        !!iaResoudre("arret.secret").refus);
verifie("un chemin qui ressemble a un vrai est refuse aussi",
        !!iaResoudre("bande.f3").refus);
verifie("on ne peut pas ecrire dans la selection de cuivre",
        !!iaResoudre("nets").refus&&!!iaResoudre("formes").refus);
verifie("un port qui n'existe pas est refuse",
        !!iaResoudre("ports.7.x").refus);
CON.actif=false;
verifie("les chemins du mode conception sont refuses hors de ce mode",
        !!iaResoudre("con.carte.L").refus);

/* -- ce qui est accepte, et borne ---------------------------------------- */
ANT.bande={f1:2.4e9, f2:2.5e9, n:401, fcible:2.45e9};
ANT.balayage.actif=false;
const IA_CIBLE=iaResoudre("bande.f1");
verifie("un chemin de la liste blanche se resout",
        !IA_CIBLE.refus&&IA_CIBLE.obj===ANT.bande&&IA_CIBLE.cle==="f1");
verifie("une valeur hors bornes est refusee en disant laquelle",
        iaValider(IA_CIBLE.descr,1e15).ok===false&&
        iaValider(IA_CIBLE.descr,1e15).pourquoi.indexOf("borne haute")>=0);
verifie("un nombre ecrit a la virgule passe quand meme",
        iaValider(IA_CHAMPS["arret.energie"],"-45,5").v===-45.5);
verifie("un entier reste entier",
        iaValider(IA_CHAMPS["boite.pml"],"8,4").v===8);
verifie("un choix hors liste est refuse",
        iaValider(IA_CHAMPS["pertes.mode"],"debye").ok===true&&
        iaValider(IA_CHAMPS["pertes.mode"],"lorentz").ok===false);

/* -- « port. » vise le port en cours de reglage -------------------------- */
antPortAjouter();
ANT.portActif=1;
verifie("« port.x » vise le port courant, pas le premier",
        iaResoudre("port.x").obj===ANT.ports[1]);
ANT.portActif=0;
antPortRetirer(1);

/* -- une proposition : l'avant, l'apres, et l'aller-retour ---------------- */
const IA_P=iaProposition({type:"reglages", titre:"Recentrer",
                          valeurs:{"bande.f1":2.08e9, "bande.f2":2.82e9,
                                   "bande.f9":1, "boite.pml":99}});
verifie("une proposition garde l'avant en face de l'apres",
        IA_P.lignes.length===2&&IA_P.lignes[0].avant===2.4e9&&
        IA_P.lignes[0].apres===2.08e9);
verifie("et elle dit ce qu'elle a refuse au lieu de le taire",
        IA_P.refus.length===2);
verifie("preparer une proposition n'ecrit rien",
        ANT.bande.f1===2.4e9);
iaAppliquer(IA_P);
verifie("l'appliquer ecrit, et seulement ce qui etait valide",
        ANT.bande.f1===2.08e9&&ANT.bande.f2===2.82e9&&ANT.boite.pml!==99);
iaAnnuler(IA_P);
verifie("l'annuler remet exactement ce qui etait la",
        ANT.bande.f1===2.4e9&&ANT.bande.f2===2.5e9);

/* -- les verifications locales ------------------------------------------- */
/* Elles doivent marcher sans reseau NI clef : c'est leur raison d'etre. */
V.modele={};
ANT.bande.fcible=5.8e9;
const IA_C=iaControles();
const IA_HORS=IA_C.find(a=>a.titre.indexOf("hors de la bande")>=0);
verifie("une cible hors de la bande est relevee comme grave",
        !!IA_HORS&&IA_HORS.rang==="grave");
verifie("et la remarque porte sa correction",
        !!IA_HORS.prop&&IA_HORS.prop.valeurs["bande.f1"]>4.9e9);
iaAppliquer(iaProposition(IA_HORS.prop));
verifie("appliquer la correction remet la cible dans la bande",
        ANT.bande.fcible>ANT.bande.f1&&ANT.bande.fcible<ANT.bande.f2);
verifie("et la faute ne se releve plus",
        !iaControles().some(a=>a.titre.indexOf("hors de la bande")>=0));

/* -- la consigne envoyee au modele ne peut pas deriver -------------------- */
/* Elle est ENGENDREE depuis la liste blanche. Un champ ajoute a IA_CHAMPS
   sans toucher a la consigne y apparait donc tout seul ; sans cela, le modele
   proposerait des reglages que la page refuse — ce qui ressemble beaucoup a
   un modele qui se trompe, et n'en est pas un. */
const IA_G=iaGrammaire();
verifie("la consigne liste tous les chemins de la liste blanche, et eux seuls",
        Object.keys(IA_CHAMPS).every(c=>IA_G.indexOf(c+"  (")>=0)&&
        IA_G.split("\n").length===Object.keys(IA_CHAMPS).length);

/* -- ce qui revient du reseau est une donnee, jamais du HTML -------------- */
verifie("le texte du modele est echappe avant d'etre rendu",
        iaMd("<img src=x onerror=alert(1)>").indexOf("<img")<0);

/* UN BLOC DE CODE EST RENDU TEL QUEL, Y COMPRIS SES DOLLARS. Les blocs sont
   mis de cote pendant le rendu puis reinseres a leur place ; tant que la
   reinsertion se faisait par une CHAINE, `$&`, `$'` et « $-accent-grave » y
   etaient lus comme des motifs de remplacement — et un bloc de shell ou de
   perl se reecrivait tout seul. Ce n'etait pas une faille, tout est deja
   echappe a ce stade ; c'etait un bloc de code qui n'etait plus celui qu'on
   avait ecrit, ce qui est le pire defaut possible pour un bloc de code. */
const IA_D=iaMd("Avant.\n```sh\necho \"$& et $' et $\\u0060\"\n```\nApres.");
verifie("un bloc de code garde ses dollars, sans se reecrire",
        IA_D.indexOf("$&amp;")>=0&&IA_D.indexOf("$&#39;")>=0&&
        IA_D.indexOf("CODEBLOCK")<0,
        IA_D.replace(/\s+/g," ").slice(0,160));
verifie("et le texte autour du bloc est intact",
        IA_D.indexOf("Avant.")>=0&&IA_D.indexOf("Apres.")>=0);

/* -- les blocs d'action deviennent des cartes ---------------------------- */
/* Le rendu est celui de WEB_CAO : un bloc ```action devient une carte, et un
   bloc casse est ignore SANS emporter la reponse qui l'entoure. */
/* Le bloc casse fait ecrire un avertissement a la console : c'est ce qu'on
   veut de l'outil, pas ce qu'on veut du banc. On le tait le temps de l'appel,
   sans quoi une trace de pile au milieu des « ok » ferait croire a une panne. */
const _warn=console.warn; console.warn=function(){};
const IA_H=iaMd("Voici.\n```action\n{\"type\":\"reglages\",\"titre\":\"Essai\","+
                "\"valeurs\":{\"boite.pml\":10}}\n```\nEt un bloc casse :\n"+
                "```action\n{ pas du json\n```\n");
console.warn=_warn;
verifie("un bloc d'action devient une carte cliquable",
        IA_H.indexOf("ia-action-card")>=0&&
        IA_H.indexOf("data-ia-appliquer")>=0);
verifie("la carte montre l'avant en face de l'apres",
        IA_H.indexOf("cellules de PML")>=0&&IA_H.indexOf("10")>=0);
verifie("un bloc casse est ignore sans emporter la reponse",
        IA_H.indexOf("Voici.")>=0&&IA_H.indexOf("bloc casse")>=0);

/* -- la geometrie libre : la seule carte qui pose du CUIVRE --------------- */
/* POURQUOI CELLE-CI MERITE SES PROPRES EPREUVES. Les trois autres cartes
   deplacent des nombres qu'un humain relit ; celle-ci ecrit dans le dessin,
   c'est-a-dire dans l'antenne. Une forme qui passe la barriere alors qu'elle
   n'aurait pas du ne fait rien planter : elle pose du cuivre quelque part, la
   simulation tourne, et le resultat a l'air d'un resultat. On eprouve donc
   les deux sens — ce qui est refuse, et ce qui se defait. */
CON.actif=false;
verifie("hors du mode conception, une carte « formes » ne pose rien",
        iaProposition({type:"formes", elements:[
          {type:"rect", couche:"haut", x1:0, y1:0, x2:10, y2:10}
        ]}).refus.length===1);

CON.actif=true;
CON.pile=conPileDefaut();
CON.coucheActive=conPremierCuivre();
CON.carte.L=40; CON.carte.W=45;
CON.elements=[]; CON.sel=-1; CON.gabarit=null; CON.calcul=null;
ANT.ports=[antPortNeuf(true)]; ANT.portActif=0;
conHistRaz();

const IA_F=iaProposition({type:"formes", titre:"Essai",
  elements:[
    {type:"rect",  couche:"bas",  net:"GND",     x1:0, y1:0, x2:40, y2:45},
    {type:"poly",  couche:"haut", net:"ANTENNE", pts:[[8,12],[30,12],[30,36],[8,36]]},
    {type:"piste", couche:"haut", net:"ANTENNE", pts:[[20,0],[20,12]], w:3.06},
    {type:"via",   couche:"haut", net:"GND",     x:5, y:5, d:0.6},
    {type:"rect",  couche:"Cuivre dessous", net:"GND", x1:1, y1:1, x2:3, y2:3},
    {type:"cercle",couche:"haut", cx:5, cy:5, r:1},
    {type:"poly",  couche:"haut", pts:[[0,0],[1,0]]},
    {type:"rect",  couche:"haut", x1:100, y1:100, x2:110, y2:110},
    {type:"rect",  couche:"couche imaginaire", x1:0, y1:0, x2:5, y2:5}
  ],
  port:{x:20, y:0.4, w:3.06, l:0.8}});

verifie("une geometrie libre prepare ses formes une par une",
        IA_F.els.length===5&&IA_F.refus.length===4,
        IA_F.els.length+" posees, "+IA_F.refus.length+" refusees");
verifie("un genre inconnu est refuse en le nommant",
        IA_F.refus.some(r=>r.indexOf("cercle")>=0));
verifie("un polygone de deux sommets est refuse comme au dessin",
        IA_F.refus.some(r=>r.indexOf("trois sommets")>=0));
verifie("une forme entierement hors de la carte est refusee",
        IA_F.refus.some(r=>r.indexOf("hors de la carte")>=0));
verifie("une couche qui n'existe pas est refusee",
        IA_F.refus.some(r=>r.indexOf("imaginaire")>=0));
verifie("le nom exact d'une couche vaut le raccourci qui la designe",
        IA_F.els[4].cu===IA_F.els[0].cu);
verifie("les nets proposes sont repris tels quels",
        IA_F.els[0].net==="GND"&&IA_F.els[1].net==="ANTENNE");
verifie("preparer une geometrie n'ecrit rien",
        CON.elements.length===0&&ANT.port.pose===false);

iaAppliquer(IA_F);
verifie("l'appliquer pose le cuivre ET le port",
        CON.elements.length===5&&ANT.port.pose===true&&
        Math.abs(ANT.port.x-20)<1e-9&&ANT.port.dir==="z",
        CON.elements.length+" formes");
/* LA MEME RAISON QUE POUR LE TRACE D'UN MOTIF : la proposition est recalculee
   a chaque reaffichage de la liste, et un dessin qui partagerait ses points
   avec elle changerait sous le doigt. */
verifie("les formes posees sont des copies, pas les objets prepares",
        CON.elements[1].pts!==IA_F.els[1].pts);
iaAnnuler(IA_F);
verifie("l'annuler rend le dessin et le port a ce qu'ils etaient",
        CON.elements.length===0&&ANT.port.pose===false);

/* -- le garde-fou du nombre de formes ------------------------------------- */
const IA_FN=[];
for(let i=0;i<60;i++)IA_FN.push({type:"rect",couche:"haut",
                                 x1:0,y1:0,x2:1,y2:1});
verifie("au-dela du garde-fou, aucune forme n'est preparee",
        iaProposition({type:"formes", elements:IA_FN}).els.length===0);

/* -- la carte est jugee AVANT les formes qu'elle accueille ---------------- */
/* Une forme mesuree contre l'ANCIENNE taille serait refusee alors que la
   proposition agrandit justement la carte pour elle. */
const IA_FC=iaProposition({type:"formes", carte:{L:60, W:50},
  elements:[{type:"rect",couche:"haut",net:"ANTENNE",x1:0,y1:0,x2:55,y2:48}]});
verifie("une forme qui n'entre que dans la carte proposee est acceptee",
        IA_FC.els.length===1&&IA_FC.refus.length===0,
        (IA_FC.refus[0]||""));

/* -- ce qui deborde est pose, mais dit --------------------------------- */
const IA_FD=iaProposition({type:"formes",
  elements:[{type:"rect",couche:"haut",net:"ANTENNE",x1:-5,y1:5,x2:10,y2:15}]});
verifie("une forme a cheval sur le bord est posee, et la carte le signale",
        IA_FD.els.length===1&&IA_FD.avis.some(a=>a.indexOf("borde")>=0));

/* UNE PISTE SE JUGE SUR SON AXE, ET C'EST MESURE. `conBoite` elargit une
   piste d'une demi-largeur : une ligne d'alimentation qui vient mourir au
   bord de la carte — ce que font les six motifs de l'outil — debordait donc
   toujours de w/2, et l'avis se serait allume sur presque chaque
   proposition. Un avis qui se declenche tout le temps ne se lit plus. */
const IA_FL=iaProposition({type:"formes",
  elements:[{type:"piste",couche:"haut",net:"ANTENNE",
             pts:[[20,0],[20,12]], w:3.06}]});
verifie("une ligne qui meurt au bord de la carte ne passe pas pour un debord",
        IA_FL.els.length===1&&!IA_FL.avis.some(a=>a.indexOf("borde")>=0),
        IA_FL.avis.join(" | "));

/* -- « remplacer » efface, et l'annulation rend tout ---------------------- */
CON.elements=[{type:"rect", cu:conPremierCuivre(), net:"ANTENNE", trou:false,
               x1:1, y1:1, x2:5, y2:5}];
ANT.port.pose=true; ANT.port.x=9; ANT.port.y=9;
const IA_FX=iaProposition({type:"formes", remplacer:true,
  elements:[{type:"rect",couche:"haut",net:"ANTENNE",x1:2,y1:2,x2:8,y2:8}]});
iaAppliquer(IA_FX);
verifie("« remplacer » efface le dessin et depose les ports",
        CON.elements.length===1&&CON.elements[0].x2===8&&
        ANT.port.pose===false);
iaAnnuler(IA_FX);
verifie("et l'annuler rend le dessin d'avant ET le port qui allait avec",
        CON.elements.length===1&&CON.elements[0].x2===5&&
        ANT.port.pose===true&&ANT.port.x===9);

/* -- la consigne envoyee au modele decrit bien cette quatrieme carte ------ */
verifie("la consigne annonce la geometrie libre et ses genres",
        window.iaPromptSysteme().indexOf('"type":"formes"')>=0&&
        window.iaPromptSysteme().indexOf("GEOMETRIE LIBRE")>=0);

/* -- la carte rendue LISTE ce qu'elle va poser --------------------------- */
/* C'est la moitie visible de la barriere : une carte qui annoncerait
   « 2 formes » sans les dire demanderait de presser pour savoir ce qu'on pose,
   et un refus qu'elle tairait ferait croire au dessin qu'on vient de lire. */
const IA_HF=iaMd("Voici.\n```action\n"+JSON.stringify({type:"formes",
  titre:"Essai de trace",
  elements:[{type:"rect",couche:"haut",net:"ANTENNE",x1:2,y1:2,x2:12,y2:22},
            {type:"trapeze",couche:"haut"}]})+"\n```\n");
verifie("la carte d'une geometrie libre liste chaque forme qu'elle pose",
        IA_HF.indexOf("ia-action-liste")>=0&&IA_HF.indexOf("rectangle")>=0,
        IA_HF.replace(/\s+/g," ").slice(0,200));
verifie("et elle affiche le refus a cote de ce qu'elle pose",
        IA_HF.indexOf("ia-action-refus")>=0&&IA_HF.indexOf("trapeze")>=0);

CON.actif=false;
CON.elements=[]; CON.sel=-1;
ANT.ports=[antPortNeuf(true)]; ANT.portActif=0;

/* ==========================================================================
   10. La barre de chargement et le bouton d'arret de simulation
   ========================================================================== */
console.log("");
console.log("10. La barre de chargement et le bouton d'arret");

extraire("13-assistant.js","aE");
extraire("13-assistant.js","antDuree");
extraire("13-assistant.js","aEsc");
extraire("13-assistant.js","aEnt");
extraire("13-assistant.js","aNb");
extraire("13-assistant.js","antBoutonsEtat");
extraire("13-assistant.js","antArreter");

const elements = {};
function fakeEl(id){
  return (elements[id] = elements[id] || {
    id, style:{display:""}, classList:{add(){},remove(){}},
    disabled:false, textContent:"", innerHTML:"", className:""
  });
}
global.document.getElementById = function(id){ return fakeEl(id); };

ANT.etatServeur = { lancer: true };
V.modele = {};
ANT.modele = {};

// 1. Au repos (aucun calcul en cours)
ANT.tache = null;
antBoutonsEtat();
verifie("au repos, le bouton lancer affiche ▶ Lancer",
        fakeEl("bLancer").textContent === "▶ Lancer");
verifie("au repos, le bouton arreter est masque",
        fakeEl("bArreter").style.display === "none");
verifie("au repos, la barre de chargement est masquee",
        fakeEl("simProgression").style.display === "none");

// 2. Pendant un calcul (etat calcule)
ANT.tache = {
  id: "sim-123",
  etat: "calcule",
  avancement: { pas: 4500, pourcent: 42.0, restant_s: 180, energie_dB: -22.5, vitesse: 45.0 },
  duree: 35
};
antBoutonsEtat();
verifie("en cours, le bouton lancer est desactive",
        fakeEl("bLancer").disabled === true);
verifie("en cours, le bouton arreter principal est affiche",
        fakeEl("bArreter").style.display === "inline-flex");
verifie("en cours, la barre de chargement est visible",
        fakeEl("simProgression").style.display === "inline-flex");
verifie("en cours, la jauge affiche la bonne largeur",
        fakeEl("simProgFill").style.width === "42%");
verifie("en cours, le texte affiche 42 %",
        fakeEl("simProgTxt").textContent === "42 %");
verifie("en cours, le temps restant est annonce",
        fakeEl("simProgReste").textContent.indexOf("3 min") >= 0);
verifie("en cours, la boite assistant est active et affiche l'etat",
        fakeEl("assistSimBox").style.display === "block" &&
        fakeEl("assistSimBox").innerHTML.indexOf("Calcul en cours") >= 0);

// 3. Apres arret (etat arrete)
ANT.tache = {
  id: "sim-123",
  etat: "arrete",
  avancement: { pas: 4500, pourcent: 42.0, restant_s: null },
  duree: 36
};
antBoutonsEtat();
verifie("apres arret, le bouton lancer est reactive",
        fakeEl("bLancer").disabled === false && fakeEl("bLancer").textContent === "▶ Lancer");
verifie("apres arret, le bouton arreter est masque",
        fakeEl("bArreter").style.display === "none");
verifie("apres arret, la barre affiche Arrete",
        fakeEl("simProgTxt").textContent === "Arrêté");
verifie("apres arret, le pied de page confirme l'arret",
        fakeEl("fAvancement").textContent.indexOf("arrêtée") >= 0);

/* -- 11. L'exploration interactive des courbes (Sonde, Marqueurs, Zoom) ---- */
console.log("");
console.log("11. L'exploration interactive des courbes");
charger("16-resultats.js");
verifie("l'etat interactif ANT_COURBE_ETAT est initialise",
        typeof ANT_COURBE_ETAT === "object" && ANT_COURBE_ETAT !== null);
verifie("aucun marqueur n'est pose au depart",
        ANT_COURBE_ETAT.m1 === null && ANT_COURBE_ETAT.m2 === null);
verifie("le zoom par defaut est desactive (vue 100%)",
        ANT_COURBE_ETAT.zoom === null);

ANT.resultat = {
  f: [2.40e9, 2.42e9, 2.45e9, 2.48e9, 2.50e9],
  f0: 2.45e9,
  s11_db: [-5.0, -8.0, -22.5, -9.0, -4.5]
};
verifie("antIndexF0 trouve l'indice exact de la resonance",
        antIndexF0() === 2);

ANT.resultat.f0 = 2.449e9; // pas exactement sur la grille
verifie("antIndexF0 se rabat sur la frequence la plus proche",
        antIndexF0() === 2);

ANT_COURBE_ETAT.m1 = 1;
ANT_COURBE_ETAT.m2 = 3;
verifie("les marqueurs M1 et M2 se retiennent",
        ANT_COURBE_ETAT.m1 === 1 && ANT_COURBE_ETAT.m2 === 3);

const df = ANT.resultat.f[ANT_COURBE_ETAT.m2] - ANT.resultat.f[ANT_COURBE_ETAT.m1];
verifie("l'ecart en frequence delta f est bien calcule",
        Math.round(df / 1e6) === 60);

ANT_COURBE_ETAT.zoom = { k0: 1, k1: 3 };
verifie("le zoom enregistre la fenetre d'indices",
        ANT_COURBE_ETAT.zoom.k0 === 1 && ANT_COURBE_ETAT.zoom.k1 === 3);

// Rechargement des resultats et nettoyage de securite
ANT_COURBE_ETAT.m1 = 99; // hors borne
antResultatsRendre();
verifie("un indice de marqueur hors borne est securise a null",
        ANT_COURBE_ETAT.m1 === null);

// 20. L'antenne exemple et la vue du maillage FDTD
charger("26-exemple.js");
charger("15-overlay2d.js");
verifie("l'exemple patch porte des cotes adaptees",
        typeof EX==="object"&&EX.cotes&&EX.cotes.L===27.5&&EX.cotes.y0===8.1&&EX.cotes.g===1.49);
/* L'EXEMPLE IFA PORTE SES COTES RECALÉES EN 3D FDTD (openEMS) :
   - La = 24.35 mm (corrige le décalage de +9,85 % vers 2,45 GHz)
   - d = 3.80 mm (remonte l'impédance vers 50 Ω au lieu de 33 Ω)
   - Lg = 50.0 mm et Lb = 50.0 mm (plan de masse étendu à 50 × 50 mm pour 45-55 % de rendement) */
verifie("l'exemple IFA porte des cotes adaptees 3D",
        typeof EX_IFA==="object"&&EX_IFA.motif==="ifa"&&
        EX_IFA.cotes&&EX_IFA.cotes.La===24.35&&EX_IFA.cotes.d===3.8&&
        EX_IFA.cotes.Lg===50&&EX_IFA.cotes.Lb===50&&EX_IFA.f===2.45e9);
verifie("les deux exemples sont deux cas distincts",
        EX.motif==="patch"&&EX_CAS.patch===EX&&EX_CAS.ifa===EX_IFA);
/* Le motif que l'exemple designe doit exister : une cle mal orthographiee ne
   se verrait qu'au clic, et le bouton ne ferait rien. */
verifie("les deux exemples designent des motifs du catalogue",
        Object.keys(EX_CAS).every(k=>!!conGabarit(EX_CAS[k].motif)));
verifie("l'etat initial du maillage est desactive",
        ANT.vueMaillage === false);
antBasculerVueMaillage(true);
verifie("antBasculerVueMaillage(true) active le maillage",
        ANT.vueMaillage === true);
antBasculerVueMaillage();
verifie("antBasculerVueMaillage() inverse l'etat",
        ANT.vueMaillage === false);

console.log("");
console.log("21. Le cuivre retenu, et pourquoi il est garde en cache");
/* CE QUI S'EPROUVE ICI N'EST PAS LA GEOMETRIE, C'EST LA DISCIPLINE DU CACHE.
   `antCuivreDuModele` epaissit chaque polyligne de l'antenne en rectangles et
   en octogones : c'est le calcul le plus lourd de la page, et la surimpression
   de la carte l'appelle a chaque image d'un deplacement ou d'un zoom. Il est
   donc retenu — et c'est precisement une mise en cache qui peut rendre FAUX
   un outil qui etait seulement lent.

   Les trois verifications ci-dessous sont les trois facons de se tromper :
   ne pas retenir (on n'a rien gagne), retenir trop longtemps apres un geste
   (l'assistant montre le cuivre d'avant), et surtout retenir d'une CARTE a
   l'autre — ce dernier cas est celui du balayage, qui recharge un modele par
   point sans passer par `antMaj` : rendre la le cuivre du point precedent
   enverrait N documents identiques au solveur, et N courbes superposees
   qu'on prendrait pour un resultat.

   On compte les calculs plutot que de dresser une carte : c'est la regle de
   rafraichissement qu'on met a l'epreuve, pas l'epaississement des traits —
   celui-la se lit dans le modele que le banc Python normalise. */
charger("11-geometrie.js");
const vraiCalcul = global.antCuivreCalcul;
let calculs = 0;
global.antCuivreCalcul = function(){
  calculs++;
  return {blocs:[], vias:[], compte:{pistes:0,arcs:0,plans:0,pads:0,fins:0}};
};

V.modele = {marque:"carte A"};
antVieillir();
const c1 = antCuivreDuModele();
const c2 = antCuivreDuModele();
verifie("deux appels de suite ne calculent qu'une fois",
        calculs === 1, calculs + " calcul(s)");
verifie("et rendent le meme objet, sans le recopier",
        c1 === c2);

antVieillir();
antCuivreDuModele();
verifie("un geste de l'utilisateur fait recalculer",
        calculs === 2, calculs + " calcul(s)");

/* LE CAS DU BALAYAGE, ET C'EST LE SEUL QUI RENDRAIT L'OUTIL FAUX. `antMaj`
   n'est pas appele : seul `V.modele` a change, comme le fait `mdlCharger`
   dans `balDocumentPour`. */
V.modele = {marque:"carte B"};
antCuivreDuModele();
verifie("une carte rechargee fait recalculer, meme sans geste",
        calculs === 3, calculs + " calcul(s)");
antCuivreDuModele();
verifie("et la nouvelle carte est retenue a son tour",
        calculs === 3, calculs + " calcul(s)");

/* CE QUE CE BANC NE PEUT PAS PROUVER, ET OU CELA SE LIT. Le troisieme maillon
   est que `antMaj` — le passage oblige apres chaque modification acceptee —
   appelle bien `antVieillir()`, et qu'il le fasse TOUT DE SUITE plutot que
   dans son travail differe de 220 ms : sinon la carte repeindrait l'ancien
   cuivre pendant qu'on regarde si le clic a pris. `antMaj` vit dans
   13-assistant.js, qui demande un DOM et que ce banc remplace par un bouchon
   (voir plus haut) ; l'appel est donc a relire la-bas, en premiere ligne de
   la fonction. Ce qui s'eprouve ici est la regle de rafraichissement, qui est
   la partie ou l'on se trompe. */

global.antCuivreCalcul = vraiCalcul;
V.modele = null;

console.log("");
console.log("22. Les chemins de la surimpression, retenus eux aussi");
/* CE QUI S'EPROUVE ICI EST LA SECONDE MOITIE DU MEME PROBLEME QUE LA SECTION
   21. Celle-la garde le RESULTAT de `antCuivreDuModele` — les tableaux de
   sommets ne sont plus recalcules a chaque image. Mais les Path2D qu'on en
   tirait l'etaient encore : un chemin neuf par bloc, et tous les sommets
   redecrits au navigateur, soixante fois par seconde pendant un deplacement.
   C'est ce qui rendait une carte de fabrication plus lourde a manipuler ici
   que dans la visionneuse de WEB_CAO, dont c'est pourtant le meme code : la
   visionneuse construit ses chemins UNE FOIS (`mdlChemins`), la surimpression
   etait le seul endroit qui y avait echappe.

   ON COMPTE LES CONSTRUCTIONS, pas les pixels : ce qu'on met a l'epreuve est
   la regle de rafraichissement, et les trois facons de s'y tromper sont les
   memes qu'a la section 21 — ne rien retenir, retenir apres un changement, et
   retenir d'une carte a l'autre. La troisieme est ici gratuite : la cle est
   l'identite de l'objet rendu par `antCuivreDuModele`, donc les deux cles de
   la section 21 valent pour celle-ci sans etre recopiees. */
const vraiPath2D = global.Path2D;
let chemins = 0;
global.Path2D = function(){
  chemins++;
  this.moveTo=function(){}; this.lineTo=function(){};
  this.arc=function(){};    this.rect=function(){};
};
const vraiPolyDans = global.mdlPolyDans;
global.mdlPolyDans = function(){};

const cuA = {blocs:[{couche:"L1",polys:[{o:[0,0,1,0,1,1],t:[]}]},
                    {couche:"L2",polys:[{o:[0,0,2,0,2,2],t:[[0,0,1,0,1,1]]}]}]};
const chA = antRetenuChemins(cuA);
verifie("un cuivre neuf construit un chemin par bloc",
        chemins === 2 && chA.length === 2, chemins + " chemin(s)");
const chA2 = antRetenuChemins(cuA);
verifie("le repeindre a l'identique n'en construit aucun",
        chemins === 2, chemins + " chemin(s)");
verifie("et rend les memes chemins, sans les recopier",
        chA === chA2);

/* Le cuivre a ete recalcule : `antCuivreDuModele` rend un AUTRE objet, et
   c'est la seule chose que ce cache a besoin de voir. */
const cuB = {blocs:[{couche:"L1",polys:[{o:[0,0,3,0,3,3],t:[]}]}]};
antRetenuChemins(cuB);
verifie("un cuivre recalcule refait ses chemins",
        chemins === 3, chemins + " chemin(s)");
antRetenuChemins(cuB);
verifie("et le nouveau est retenu a son tour",
        chemins === 3, chemins + " chemin(s)");

/* LE MAILLAGE : des milliers de lignes quand il est fin, c'est-a-dire
   exactement quand on l'affiche pour le juger. */
chemins = 0;
const mx = [0,1,2], my = [0,1];
antMaillageChemin(mx,my,1,0,0,10,10);
antMaillageChemin(mx,my,1,0,0,10,10);
verifie("la grille FDTD n'est decrite qu'une fois",
        chemins === 1, chemins + " chemin(s)");
antMaillageChemin(mx,my,1/25.4,0,0,10,10);
verifie("changer d'unite la refait",
        chemins === 2, chemins + " chemin(s)");
antMaillageChemin(mx,my,1,0,0,12,12);
verifie("une boite qui grandit la refait aussi",
        chemins === 3, chemins + " chemin(s)");

/* LES OBJETS HORS CARTE : deux chemins, un par couleur. */
chemins = 0;
const mObj = {primitives:[{type:"boite",materiau:"metal",a:[0,0,0],b:[1,1,1]},
                          {type:"sphere",materiau:"air",c:[0,0,0],r:1},
                          {type:"fil",materiau:"metal",r:0.2,pts:[[0,0],[1,1]]}]};
antObjetsChemins(mObj,1);
antObjetsChemins(mObj,1);
verifie("les objets tiennent en deux chemins, construits une fois",
        chemins === 2, chemins + " chemin(s)");
antObjetsChemins(mObj,1/25.4);
verifie("changer d'unite les refait",
        chemins === 4, chemins + " chemin(s)");

global.Path2D = vraiPath2D;
global.mdlPolyDans = vraiPolyDans;

console.log("");
console.log("12. L'empilage du mode conception");
/* CE QUE CETTE SECTION EPROUVE, ET POURQUOI. L'empilage est le seul reglage
   du mode qui ne se voit pas sur le dessin : une couche de trop, un
   dielectrique de la mauvaise epaisseur, un modele d'usine qui ne tombe pas
   sur l'epaisseur qu'il annonce ne changent rien a ce qu'on regarde a
   l'ecran, et tout a ce que le solveur calcule. C'est exactement le critere
   qui a fait ecrire les sections precedentes.

   Et le changement de nombre de couches porte le risque propre a ce mode :
   les formes designent leur couche par un `uid`, et un empilage refait avec
   des uid neufs laisserait tout le cuivre dessine pointer dans le vide —
   sans erreur, sans message, et avec un dessin qui a toujours l'air d'en
   etre un. */

CON.elements=[];
CON.pile=conPileDefaut();
CON.coucheActive=conPremierCuivre();

/* -- les modeles d'usine tombent sur ce qu'ils annoncent ------------------ */
/* Un modele qui n'atteint pas son epaisseur ne se commande pas : le
   fabricant repondrait par un empilage a lui, et la carte pressee ne serait
   plus celle qu'on a simulee. */
let modelesFaux=[];
CON_MODELES.forEach(function(m){
  let s=0;
  m.cu.forEach(function(e){ s+=e; });
  (m.die||[]).forEach(function(d){ s+=d.ep; });
  if(Math.abs(s-m.cible)>1e-6)
    modelesFaux.push(m.id+" ("+s.toFixed(4)+" au lieu de "+m.cible+")");
  if(m.cu.length!==m.n)modelesFaux.push(m.id+" : "+m.cu.length+" cuivres pour n="+m.n);
  if((m.die||[]).length!==Math.max(1,m.n-1))
    modelesFaux.push(m.id+" : "+(m.die||[]).length+" dielectriques");
});
verifie("chaque modele d'usine tombe sur l'epaisseur qu'il annonce",
        modelesFaux.length===0, modelesFaux.join(" | "));
verifie("chaque modele nomme un dielectrique du catalogue",
        CON_MODELES.every(m=>(m.die||[]).every(d=>
          CON_DIELECTRIQUES.some(x=>x.id===d.mat))));

/* -- l'empilage d'usine --------------------------------------------------- */
verifie("l'empilage d'usine a deux couches de cuivre",
        conCuivres().length===2);
verifie("et fait 1,6 mm en tout",
        Math.abs(conEpTotale()-1.6)<1e-9, conEpTotale()+" mm");
verifie("la seconde couche est declaree masse — une antenne imprimee "+
        "rayonne contre un plan",
        conCuivres()[1].e.role==="gnd");
verifie("le substrat vu par les gabarits est celui d'entre les deux cuivres",
        Math.abs(conSubstrat().h-1.53)<1e-9&&
        Math.abs(conSubstrat().er-4.3)<1e-9, JSON.stringify(conSubstrat()));

/* -- changer le nombre de couches, sans perdre le dessin ------------------ */
const uidHaut=conPremierCuivre(), uidBas=conDernierCuivre();
CON.elements=[{type:"rect", cu:uidHaut, net:"ANTENNE", x1:0,y1:0,x2:10,y2:10},
              {type:"rect", cu:uidBas,  net:"GND",     x1:0,y1:0,x2:20,y2:20}];
const vers4=conPileVers(4);
verifie("passer a quatre couches prend le modele d'usine du nouveau compte",
        conCuivres().length===4&&vers4.modele.n===4, vers4&&vers4.modele.id);
verifie("le cuivre du dessus garde son uid : les formes le designent encore",
        conPremierCuivre()===uidHaut&&CON.elements[0].cu===uidHaut);
verifie("celui du dessous aussi",
        conDernierCuivre()===uidBas&&CON.elements[1].cu===uidBas);
verifie("aucune forme n'a eu a etre reportee",
        vers4.deplacees===0, String(vers4.deplacees));
verifie("les quatre couches ont des uid distincts",
        new Set(conCuivres().map(c=>c.e.uid)).size===4);
verifie("et des noms distincts — un nom de couche sert de cle partout",
        new Set(CON.pile.map(e=>e.nom)).size===CON.pile.length);
verifie("le quatre couches fait toujours 1,6 mm",
        Math.abs(conEpTotale()-1.6)<1e-9, conEpTotale()+" mm");

/* Une forme posee sur une couche INTERNE, puis un retour a deux couches :
   c'est le cas qui perdrait du cuivre en silence. */
const uidInterne=conCuivres()[1].e.uid;
CON.elements.push({type:"rect", cu:uidInterne, net:"GND", x1:1,y1:1,x2:2,y2:2});
const vers2=conPileVers(2);
verifie("revenir a deux couches reporte les formes des couches disparues",
        vers2.deplacees===1, String(vers2.deplacees));
verifie("et aucune forme ne reste orpheline",
        CON.elements.every(el=>conCoucheDeUid(el.cu)>=0));
verifie("le dessus et le dessous n'ont toujours pas bouge",
        CON.elements[0].cu===uidHaut&&CON.elements[1].cu===uidBas);

/* -- le masque ------------------------------------------------------------ */
const avantMasque=conEpTotale(), substratAvant=conSubstrat().h;
conMasquePoser(true);
verifie("le masque se pose sur les deux faces, en bout d'empilage",
        conMasques().haut&&conMasques().bas);
verifie("il ajoute 2 x 25 µm a l'epaisseur totale",
        Math.abs(conEpTotale()-avantMasque-0.05)<1e-9,
        conEpTotale()+" mm");
verifie("il ne change pas le substrat vu par les gabarits — il n'est pas "+
        "entre deux cuivres",
        Math.abs(conSubstrat().h-substratAvant)<1e-9);
verifie("le stratifie nu, lui, l'ignore",
        Math.abs(conEpStratifie()-avantMasque)<1e-9);
/* Il doit arriver au solveur : c'est tout l'objet de l'empilage. */
const docMasque=conModele();
const entreeMasque=docMasque.empilage[0];
verifie("le masque part au solveur comme un dielectrique",
        entreeMasque.type==="DIELECTRIC"&&Math.abs(entreeMasque.dk-3.8)<1e-9,
        JSON.stringify(entreeMasque));
conMasquePoser(false);
verifie("et se retire des deux faces d'un coup",
        !conMasques().haut&&!conMasques().bas&&
        Math.abs(conEpTotale()-avantMasque)<1e-9);

/* -- l'epaisseur visee ---------------------------------------------------- */
CON.cible=1.0;
verifie("repartir l'ecart tombe sur l'epaisseur visee",
        conAjusterEpaisseur()&&Math.abs(conEpTotale()-1.0)<1e-3,
        conEpTotale()+" mm");
verifie("le cuivre n'a pas bouge — il se commande, il ne se negocie pas",
        Math.abs(conEpCuivre()-0.07)<1e-9, conEpCuivre()+" mm");
CON.cible=0.02;
verifie("une visee plus mince que le cuivre est refusee plutot qu'ecrasee",
        conAjusterEpaisseur()===false);

/* -- la symetrie ---------------------------------------------------------- */
CON.pile=conPileDefaut();
conPileVers(4);
verifie("un empilage d'usine a quatre couches est symetrique",
        conAsymetrie().length===0, JSON.stringify(conAsymetrie()));
CON.pile.filter(e=>e.k==="die")[0].ep=0.4;
verifie("un dielectrique epaissi d'un seul cote est signale",
        conAsymetrie().length===1, JSON.stringify(conAsymetrie()));
conSymetriser();
verifie("symetriser fait la moyenne des couches deux a deux",
        conAsymetrie().length===0&&
        Math.abs(CON.pile.filter(e=>e.k==="die")[0].ep-0.305)<1e-9,
        String(CON.pile.filter(e=>e.k==="die")[0].ep));

/* -- le port que l'empilage vient de rendre faux -------------------------- */
/* Les deux couches existent toujours et portent toujours leur nom : rien ne
   refusera ce port, et le S11 sera celui d'une antenne alimentee en travers
   de sa masse. C'est la seule faute de cette section que le solveur ne
   signalerait pas. */
CON.pile=conPileDefaut();
ANT.ports=[{pose:true, de:"Cuivre dessus", a:"Cuivre dessous"}];
verifie("un port entre deux cuivres voisins n'est pas suspect",
        conPortsSuspects().length===0);
conPileVers(4);
verifie("le meme port sur un quatre couches est signale",
        conPortsSuspects().length===1, JSON.stringify(conPortsSuspects()));
ANT.ports[0].a=conCuivres()[1].e.nom;
verifie("ramene sur le plan qui est juste sous l'antenne, il redevient bon",
        conPortsSuspects().length===0);
ANT.ports=[];

/* -- ce que le document emporte jusqu'au solveur -------------------------- */
/* LE POINT DE JONCTION ENTRE L'EMPILAGE ET LA SIMULATION. Tout le reste de
   cette section serait sans objet si le document rendu par `conModele()` ne
   portait pas ce qui vient d'etre regle : c'est lui, et lui seul, que
   `mdlCharger` puis `antEmpilage` conduisent jusqu'a python. */
CON.pile=conPileDefaut();
CON.elements=[];
const docPile=conModele();
verifie("le document porte une entree d'empilage par couche",
        docPile.empilage.length===CON.pile.length);
verifie("le cuivre de masse est declare GROUND",
        docPile.empilage[2].type==="GROUND"&&docPile.empilage[2].sigma>5e7,
        JSON.stringify(docPile.empilage[2]));
verifie("le dielectrique emporte son Dk et son Df",
        docPile.empilage[1].type==="DIELECTRIC"&&
        Math.abs(docPile.empilage[1].dk-4.3)<1e-9&&
        Math.abs(docPile.empilage[1].df-0.02)<1e-9,
        JSON.stringify(docPile.empilage[1]));
verifie("l'epaisseur declaree du document est celle de l'empilage",
        Math.abs(docPile.epaisseur-conEpTotale())<1e-9,
        docPile.epaisseur+" contre "+conEpTotale());

/* -- appliquer un modele sans toucher au dessin --------------------------- */
const uidAvant=conCuivres().map(c=>c.e.uid).join(",");
conAppliquerModele("ro4350-2c-0762");
verifie("changer de stratifie a compte de couches egal garde les uid",
        conCuivres().map(c=>c.e.uid).join(",")===uidAvant);
verifie("et pose bien le nouveau substrat",
        Math.abs(conSubstrat().er-3.66)<1e-9&&
        Math.abs(conSubstrat().h-0.762)<1e-9, JSON.stringify(conSubstrat()));
conAppliquerModele("fr4-4c-16");
verifie("un modele d'un autre compte refait l'empilage",
        conCuivres().length===4&&CON.modele==="fr4-4c-16");
CON.pile=conPileDefaut();
CON.elements=[];

/* -- les revetements EXTERIEURS de l'empilage ----------------------------- */
/* CE QUE LE PANNEAU NE MONTRAIT PAS, ET QUI COUTAIT LE PLUS CHER. Un vernis
   epargne n'est ni un conducteur ni un intervalle entre deux conducteurs : il
   est pose SUR le cuivre exterieur. Le tableau de l'empilage ne montre que les
   deux premieres sortes, si bien que les 15 microns de resine partaient au
   solveur sans jamais s'afficher -- et leurs deux faces, toutes deux
   obligatoires dans le maillage, commandaient a elles seules le pas de temps
   de toute la simulation. */
LT.pile=[
  {nom:"Resist-A", cuivre:false, ep:0.015, er:3.7, df:0.029},
  {nom:"TOP",      cuivre:true,  ep:0.035},
  {nom:"CORE",     cuivre:false, ep:1.6,   er:4.3, df:0.02},
  {nom:"BOTTOM",   cuivre:true,  ep:0.035},
  {nom:"Resist-B", cuivre:false, ep:0.015, er:3.7, df:0.029}
];
LT.cu=[{nom:"TOP", rang:1, ep:0.035, role:"signal"},
       {nom:"BOTTOM", rang:3, ep:0.035, role:"gnd"}];
LT.gap=[];
ANT.revetements={}; ANT.modele=null;
verifie("les deux vernis sont reconnus comme revetements exterieurs",
        antRevetements().map(r=>r.nom).join(",")==="Resist-A,Resist-B",
        JSON.stringify(antRevetements()));
verifie("le substrat INTERIEUR n'est jamais candidat",
        !antRevetements().some(r=>r.nom==="CORE"));
verifie("sous 50 microns, aucun n'entre dans le maillage",
        antRevetements().every(r=>!r.garde&&!r.choisi));
verifie("et le document ne porte « garder » tant que personne n'a tranche",
        antEmpilage().every(e=>!("garder" in e)),
        JSON.stringify(antEmpilage()));
ANT.revetements["Resist-A"]=true;
verifie("une case cochee part au serveur, et sur CETTE couche seulement",
        antEmpilage().filter(e=>"garder" in e)
                     .map(e=>e.nom+"="+e.garder).join(",")==="Resist-A=true",
        JSON.stringify(antEmpilage().filter(e=>"garder" in e)));
verifie("la page l'affiche alors comme un choix, pas comme un defaut",
        antRevetements().some(r=>r.nom==="Resist-A"&&r.garde&&r.choisi));
/* L'ORDRE DU SERVEUR EST L'INVERSE DE CELUI DU TABLEAU -- il range son
   empilage du bas vers le haut pour poser ses cotes en z. Les deux lignes ne
   doivent pas sauter de place a la premiere reponse. */
ANT.modele={revetements:[{nom:"Resist-B", ep:0.015, er:3.7, df:0.029, garde:false, choisi:false},
                         {nom:"Resist-A", ep:0.015, er:3.7, df:0.029, garde:true,  choisi:true}]};
verifie("le modele renvoye ne reordonne pas le tableau",
        antRevetements().map(r=>r.nom).join(",")==="Resist-A,Resist-B",
        antRevetements().map(r=>r.nom).join(","));
ANT.revetements={}; ANT.modele=null;

/* EN CONCEPTION, LE MASQUE N'EST PAS UN ACCIDENT DE FICHIER. Le mode ne le
   pose pas d'usine : il le propose, ecrit ce qu'il coute — une fois et demie
   le temps de calcul sur le patch de l'exemple — et laisse cocher. Present, il
   a donc ete demande, et la borne des 50 microns ne doit pas defaire le choix
   qu'on vient de faire deux panneaux plus loin. */
const conSauve=CON.actif;
CON.actif=true;
verifie("un masque pose expres en conception reste dans le maillage",
        antRevetements().every(r=>r.garde)&&
        antEmpilage().filter(e=>e.garder===true).map(e=>e.nom).join(",")
          ==="Resist-A,Resist-B",
        JSON.stringify(antEmpilage().filter(e=>"garder" in e)));
ANT.revetements["Resist-A"]=false;
verifie("et il se retire quand meme si on decoche la case",
        antEmpilage().find(e=>e.nom==="Resist-A").garder===false&&
        antRevetements().find(r=>r.nom==="Resist-A").garde===false);
CON.actif=conSauve;
ANT.revetements={}; ANT.modele=null;
LT.pile=[]; LT.cu=[]; LT.gap=[];

/* =============================================================================
   13. Le Rapport d'Ingénierie & Diagnostics FDTD
   ============================================================================= */
console.log("");
console.log("13. Le Rapport d'Ingénierie & Diagnostics FDTD");
charger("31-rapport.js");

verifie("les fonctions du rapport sont définies",
        typeof rapCollecterDonnees === "function" &&
        typeof rapDiagnostiquer === "function" &&
        typeof rapGenererHtml === "function" &&
        typeof rapGenererMarkdown === "function");

const rapDonneesInit = rapCollecterDonnees();
verifie("la collecte initiale extrait la géométrie et l'empilage",
        rapDonneesInit && rapDonneesInit.empilage && Array.isArray(rapDonneesInit.empilage.couches));

const diagsInit = rapDiagnostiquer(rapDonneesInit);
verifie("un modèle non simulé est diagnostiqué comme prêt",
        diagsInit.some(d => d.id === "non_simule"));

// Test cas de résultat avec non-convergence (arrêt prématuré nmax)
const donneesNonConv = JSON.parse(JSON.stringify(rapDonneesInit));
donneesNonConv.resultat = {
  f0: 2.45e9,
  s11_min_db: -18.2,
  z0_re: 48.5,
  z0_im: -1.2,
  bp: { existe: true, f1: 2.41e9, f2: 2.49e9, largeur: 80e6, relative: 3.2, continue: true, bord: false }
};
donneesNonConv.solver.energie_arret_dB = -40;
donneesNonConv.solver.nmax = 30000;
donneesNonConv.tache = {
  etat: "fini",
  avancement: { pas: 30000, energie_dB: -22.5 }
};
const diagsNonConv = rapDiagnostiquer(donneesNonConv);
verifie("l'arrêt à nmax avec énergie résiduelle élevée est détecté comme avertissement",
        diagsNonConv.some(d => d.id === "arret_nmax" && d.rang === "warn"));

// Test cas de convergence complète
const donneesConv = JSON.parse(JSON.stringify(donneesNonConv));
donneesConv.tache.avancement = { pas: 14200, energie_dB: -42.1 };
const diagsConv = rapDiagnostiquer(donneesConv);
verifie("la convergence sous le seuil d'énergie est validée en OK",
        diagsConv.some(d => d.id === "conv_ok" && d.rang === "ok"));

// Test cas de maillage diélectrique trop grossier
const donneesMaille = JSON.parse(JSON.stringify(donneesConv));
donneesMaille.maillage.res_die_mm = 2.5; // trop grand pour lambda_d / 15
donneesMaille.maillage.lambda_min_mm = 60.0;
donneesMaille.maillage.er_max = 4.3; // lambda_d/15 = 60 / (15 * 2.07) = 1.93 mm
const diagsMaille = rapDiagnostiquer(donneesMaille);
/* LE FAUX POSITIF QUI CRIAIT AU LOUP SUR TOUT MODELE A MARGES AUTOMATIQUES.
   La boite automatique se pose EXACTEMENT au conseil : air utile (lambda/4) +
   epaisseur de PML. L'air qui reste une fois la PML retranchee vaut donc
   lambda/4 tout rond -- c'est juste, et ce doit etre muet. Le diagnostic
   comparait cet air restant a la marge conseillee COMPLETE, PML comprise, et
   se declenchait donc toujours. */
(function(){
  const sauve = ANT.modele;
  ANT.modele = {boite:{air_restant:36.0, air_utile:36.0, marge_conseil:78.6,
                       ep_pml:42.6, pml:8},
                estimation:{}, resolution:{die:0.25, air:5.0}, arret:{}};
  const d1 = rapCollecterDonnees();
  verifie("une boite posee au conseil ne declenche plus l'alerte PML",
          !rapDiagnostiquer(d1).some(x=>x.id==="pml_proche"));
  ANT.modele.boite.air_restant = 12.0;
  const d2 = rapCollecterDonnees();
  verifie("mais une PML vraiment trop proche est toujours signalee",
          rapDiagnostiquer(d2).some(x=>x.id==="pml_proche"));
  ANT.modele = sauve;
})();

verifie("un maillage diélectrique supérieur à lambda_d/15 est signalé",
        diagsMaille.some(d => d.id === "maillage_grossier"));

/* -- LA CELLULE MINUSCULE, ET LA COUCHE QUI LA FABRIQUE ------------------- */
/* Le conseil etait ecrit en dur et renvoyait au DESSIN : « verifiez qu'aucun
   sommet n'est decale d'une fraction de micron ». Sur antenna4c, la cellule de
   15 microns etait le vernis epargne de l'empilage — rien a corriger dans le
   dessin, et la seule couche du modele que le panneau de l'empilage ne montrait
   pas. La cause vient desormais du modele (`estimation.cellule`), et le rapport
   la nomme. */
const donneesCell = JSON.parse(JSON.stringify(rapDonneesInit));
donneesCell.maillage.min_cell_mm = [0.1997, 0.1997, 0.015];
donneesCell.maillage.dt_ps = 0.0497;
donneesCell.maillage.cellule = {mm:0.015, axe:"z", quoi:"dielectrique",
                                couche:"Resist-A", ep:0.015, revetement:true};
const diagCellRev = rapDiagnostiquer(donneesCell)
  .find(x => x.id === "cellule_minuscule");
verifie("le rapport nomme la couche qui fabrique la cellule minuscule",
        !!diagCellRev && diagCellRev.desc.indexOf("Resist-A") >= 0,
        diagCellRev ? diagCellRev.desc : "aucun diagnostic");
verifie("et pour un revetement exterieur, il dit ou le decocher",
        !!diagCellRev && /rev\u00eatement EXT\u00c9RIEUR/.test(diagCellRev.conseil)
        && /L'empilage/.test(diagCellRev.conseil),
        diagCellRev ? diagCellRev.conseil : "aucun conseil");
donneesCell.maillage.cellule = {mm:0.012, axe:"z", quoi:"dielectrique",
                                couche:"PREPREG", ep:0.012, revetement:false};
const diagCellSub = rapDiagnostiquer(donneesCell)
  .find(x => x.id === "cellule_minuscule");
verifie("un substrat INTERIEUR, lui, doit rester : le rapport ne dit pas de l'oter",
        !!diagCellSub && /doit rester/.test(diagCellSub.conseil)
        && !/d\u00e9cocher/.test(diagCellSub.conseil),
        diagCellSub ? diagCellSub.conseil : "aucun conseil");
donneesCell.maillage.cellule = {mm:0.035, axe:"z", quoi:"cuivre",
                                couche:"TOP", ep:0.035, revetement:false};
verifie("et en mode volume, il renvoie au mode feuille",
        /mode .{0,3}feuille/.test((rapDiagnostiquer(donneesCell)
          .find(x => x.id === "cellule_minuscule") || {}).conseil || ""),
        String((rapDiagnostiquer(donneesCell)
          .find(x => x.id === "cellule_minuscule") || {}).conseil));

// Test cas d'impédance anormale (court-circuit)
const donneesCourtJus = JSON.parse(JSON.stringify(donneesConv));
donneesCourtJus.resultat.z0_re = 1.2;
const diagsCourtJus = rapDiagnostiquer(donneesCourtJus);
verifie("une impédance d'entrée quasi-nulle est signalée en critique",
        diagsCourtJus.some(d => d.id === "zin_court_circuit" && d.rang === "crit"));

// Test cas de faible rendement de rayonnement sur bon S11
const donneesPertes = JSON.parse(JSON.stringify(donneesConv));
donneesPertes.resultat.s11_min_db = -22.0;
donneesPertes.resultat.nf2ff = { dmax_dbi: 5.5, gain_dbi: 0.2, rendement: 0.28 };
const diagsPertes = rapDiagnostiquer(donneesPertes);
verifie("un rendement de rayonnement inférieur à 50% sur bon S11 est signalé",
        diagsPertes.some(d => d.id === "faible_rendement"));

// Test génération HTML & Markdown
const htmlRapport = rapGenererHtml(donneesConv, diagsConv);
verifie("le rapport HTML contient les sections clés",
        htmlRapport.includes("Résonance f₀") &&
        htmlRapport.includes("S₁₁ minimal") &&
        htmlRapport.includes("Empilage PCB") &&
        htmlRapport.includes("Maillage FDTD"));

const mdRapport = rapGenererMarkdown(donneesConv, diagsConv);
verifie("le rapport Markdown contient les titres et données structurées",
        mdRapport.includes("# Rapport Technique d'Ingénierie") &&
        mdRapport.includes("## 1. Synthèse & Indicateurs Clés") &&
        mdRapport.includes("## 4. Empilage PCB (Stack-up)"));

/* LA PLUS PETITE CELLULE ET LA CHARGE, DANS LE MARKDOWN. Le tableau HTML les
   portait déjà ; le Markdown — celui qu'on relit pour comprendre pourquoi un
   calcul a duré cinq heures — ne disait que le pas visé et le pas de temps,
   c'est-à-dire tout sauf le chiffre qui commande les deux. */
const donneesPc = JSON.parse(JSON.stringify(donneesConv));
donneesPc.maillage.res_die_mm = 0.599;
donneesPc.maillage.cellules = 4226775;
donneesPc.maillage.min_cell_mm = [0.0744, 0.483, 0.1233];
donneesPc.maillage.cellule = {mm:0.0744, axe:"x", quoi:"lignes", couche:"",
                                pincee:{mm:0.0744, a:8.0156, b:8.0900,
                                        rang_a:"obligatoire",
                                        rang_b:"remplissage"}};
donneesPc.solver.nmax = 193873;
const mdPc = rapGenererMarkdown(donneesPc, diagsConv);
verifie("le rapport Markdown dit la plus petite cellule et son axe",
        mdPc.includes("Plus petite cellule : 0,0744 mm en x"), mdPc);
verifie("il dit de combien elle est sous le pas visé",
        mdPc.includes("8,1 fois moins que le pas visé"), mdPc);
verifie("il nomme les deux lignes qui la bornent et leur rang",
        mdPc.includes("(obligatoire)") && mdPc.includes("(remplissage)"),
        mdPc);
verifie("et il chiffre la charge, qui est le produit des deux facteurs",
        /Charge : 4226775 cellules × 193873 pas = 8,19e\+11/.test(mdPc)
        || /Charge : 4226775 cellules × 193873 pas = 8\.19e\+11/.test(mdPc),
        mdPc);

/* UNE COUCHE NOMMEE QUAND LA CELLULE EST EN Z, et pas une paire de lignes :
   le vernis épargné de 15 microns est le cas d'école, et il se corrige dans
   l'empilage, pas dans le dessin. */
const donneesPcZ = JSON.parse(JSON.stringify(donneesPc));
donneesPcZ.maillage.min_cell_mm = [0.483, 0.483, 0.015];
donneesPcZ.maillage.cellule = {mm:0.015, axe:"z", quoi:"dielectrique",
                                 couche:"Resist-A", ep:0.015,
                                 revetement:true, pincee:null};
verifie("en z, c'est la couche qui est nommée",
        rapGenererMarkdown(donneesPcZ, diagsConv)
          .includes("la couche « Resist-A »"));

console.log("\n14. La saisie décimale robuste dans l'assistant");
console.log("");
console.log("15. Les reglages calcules : la valeur s'affiche, l'etat reste a zero");
/* CE QUI S'EPROUVE ICI EST UN EQUILIBRE, ET LES DEUX COTES SE CASSENT
   SILENCIEUSEMENT. D'un cote, un champ qui affiche « 0 » ne dit pas ce qui
   part au solveur : c'est la plainte d'ou vient cette section. De l'autre,
   ecrire la valeur calculee DANS l'etat pour l'afficher la figerait au
   maillage du jour — et le pas de temps, donc le nombre de pas, change des
   qu'on retouche la grille. L'affichage doit donc etre rempli et l'etat
   rester a zero, ce qu'aucun clic ne montre.

   VRAI DES TROIS ORIGINES. Le meme etat sert au fichier IPC-2581, au mode
   conception et aux exemples : `antRaz()` est le passage oblige de toute
   ouverture de carte, et c'est lui qui rend les sept reglages au calcul. */
extraire("02-modele.js", "mdlNb");
extraire("02-modele.js", "mdlEntier");
charger("13-assistant.js");
antRaz();
verifie("une carte qui s'ouvre rend les sept reglages au calcul",
        ANT.boite.mx === 0 && ANT.boite.my === 0 && ANT.boite.mz_haut === 0 &&
        ANT.boite.mz_bas === 0 && ANT.maillage.res_air === 0 &&
        ANT.maillage.res_die === 0 && ANT.arret.nmax === 0);
verifie("et les sept champs calcules sont bien ces sept-la",
        ANT_AUTO.length === 7 &&
        ANT_AUTO.map(c => c.c).join(",") ===
          "mx,my,mz_haut,mz_bas,res_air,res_die,nmax");

/* Un faux panneau : chaque champ est un objet, comme dans la section 14. */
function champFaux(){ return {value:"", dataset:{}, classList:{
  _n:{}, toggle(c,v){ this._n[c]=!!v; }, contient(c){ return !!this._n[c]; }}}; }
const CH={}, ETQ={};
ANT_AUTO.forEach(c => { CH[c.id]=champFaux(); });
["antMargeEtq","antRaEtq","antRdEtq","antNmaxEtq"].forEach(
  i => { ETQ[i]={textContent:"", className:"", disabled:false, title:"",
                onclick:null}; });
const panneau={ querySelector(sel){ const id=sel.slice(1);
  return CH[id]||ETQ[id]||null; } };
/* L'espace fine insecable des milliers, celle que `mdlEntier` pose. Ecrire
   une espace ordinaire ici ferait echouer la comparaison sur un caractere
   qu'aucun oeil ne distingue. */
const FIN = String.fromCharCode(8239);

ANT.modele={
  boite:{marge_conseil:69.3},
  resolution:{air:4.164, die:0.25, detail:{air:4.164, die:0.25,
              lambda:2.95, largeur_cuivre:1.0, plancher:0.15, bornee:false}},
  arret:{nmax:49691, nmax_calcule:49691, nmax_auto:true,
         nmax_detail:{impulsion:31125, decroissance:49691, periodes:40,
                      f_res:2.45e9}}
};
antAutoEcrire(panneau);
verifie("un reglage laisse a zero affiche la valeur que le modele calcule",
        CH.antRd.value === "0,25" && CH.antRa.value === "4,164" &&
        CH.antMx.value === "69,3" && CH.antNmax.value === "49"+FIN+"691",
        CH.antRd.value+" / "+CH.antRa.value+" / "+CH.antNmax.value);
verifie("... sans rien ecrire dans l'etat, qui reste a zero",
        ANT.maillage.res_die === 0 && ANT.arret.nmax === 0 &&
        ANT.boite.mx === 0);
verifie("... et le dit : le champ est marque calcule",
        CH.antRd.classList.contient("auto") &&
        ETQ.antRdEtq.textContent === "calculé" &&
        ETQ.antRdEtq.disabled === true);

/* LE NOMBRE AFFICHE N'EST PAS UNE SAISIE. Le retrouver a l'identique — un
   passage de tabulation, un « valider » sans rien changer — ne doit pas
   figer le reglage : c'est le nombre qu'on a mis dans le champ soi-meme. */
extraire("13-assistant.js", "antLierNombre");
let majAuto = 0;
global.antMaj = function(){ majAuto++; };
antLierNombre(CH.antNmax, ANT.arret, "nmax", {min:0, defaut:0, entier:true});
CH.antNmax.onchange();
verifie("revalider la valeur calculee sans la changer ne la fige pas",
        ANT.arret.nmax === 0 && majAuto === 0,
        "nmax="+ANT.arret.nmax);
/* ... et le nombre groupe par milliers se relit quand meme : « 49 691 »
   passe par parseInt, qui s'arrete au premier espace et lisait 49. */
CH.antNmax.value = "60 000";
CH.antNmax.onchange();
verifie("un nombre groupe par milliers se relit en entier",
        ANT.arret.nmax === 60000, "nmax="+ANT.arret.nmax);

antAutoEcrire(panneau);
verifie("un reglage impose est marque comme tel, et se rend",
        !CH.antNmax.classList.contient("auto") &&
        ETQ.antNmaxEtq.textContent === "imposé ↺" &&
        ETQ.antNmaxEtq.disabled === false &&
        typeof ETQ.antNmaxEtq.onclick === "function");
ETQ.antNmaxEtq.onclick();
verifie("le rendre remet l'etat a zero, donc au calcul",
        ANT.arret.nmax === 0);
/* Une etiquette pour quatre champs : elle ne dit « calcule » que si les
   QUATRE le sont, sinon le bouton de retour manquerait pour les trois
   autres. */
ANT.boite.my = 12;
antAutoEcrire(panneau);
verifie("une seule marge imposee suffit a rendre l'etiquette des quatre",
        ETQ.antMargeEtq.textContent === "imposé ↺");
ETQ.antMargeEtq.onclick();
verifie("et le retour rend les quatre a la fois",
        ANT.boite.mx === 0 && ANT.boite.my === 0 &&
        ANT.boite.mz_haut === 0 && ANT.boite.mz_bas === 0);

/* La note qui dit LEQUEL des deux criteres tient le compteur : sans elle, le
   nombre est un nombre de plus. */
const noteNmax = antNmaxNoteHtml(ANT.modele);
verifie("la note du compteur dit les deux criteres et celui qui gagne",
        noteNmax.includes("49"+FIN+"691") && noteNmax.includes("31"+FIN+"125") &&
        noteNmax.includes("teindre"), noteNmax);
ANT.modele.arret.nmax = 40000; ANT.modele.arret.nmax_auto = false;
verifie("et devant un compteur impose, elle dit ce qu'il refuse",
        antNmaxNoteHtml(ANT.modele).includes("calculerait"));

extraire("02-modele.js", "mdlNb");
extraire("13-assistant.js", "antLierNombre");

/* `dataset` EXISTE SUR TOUT ELEMENT REEL, et la liaison s'en sert pour
   reconnaitre une valeur calculee affichee dans le champ (section 15). Un
   faux element sans `dataset` eprouverait un cas qui n'arrive jamais. */
const elTest = { value: "0", dataset: {} };
const cibleTest = { res_die: 0.5 };
let majCompteur = 0;
global.antMaj = function() { majCompteur++; };

antLierNombre(elTest, cibleTest, "res_die", { min: 0, defaut: 0 });

elTest.value = "0,";
elTest.oninput();
verifie("taper '0,' ne remet pas la valeur cible à 0 et ne déclenche pas antMaj",
        cibleTest.res_die === 0.5 && majCompteur === 0);

elTest.value = "0,8";
elTest.oninput();
verifie("taper '0,8' met à jour la valeur cible à 0.8",
        cibleTest.res_die === 0.8 && majCompteur === 1);

elTest.value = ",";
elTest.oninput();
verifie("une virgule isolée n'écrase rien",
        cibleTest.res_die === 0.8 && majCompteur === 1);

elTest.value = "0,8";
elTest.onchange();
verifie("onchange normalise la valeur avec virgule",
        elTest.value === "0,8" && cibleTest.res_die === 0.8);

elTest.value = "-2";
elTest.onchange();
verifie("une valeur sous le minimum est ramenée au min sur change",
        cibleTest.res_die === 0 && elTest.value === "0");

console.log("");
console.log("16. Un panneau reconstruit ne montre QUE ce que l'etat porte");
/* LA PANNE EPROUVEE ICI NE SE VOIT SUR AUCUNE CAPTURE D'ECRAN. Au
   rechargement de la page — la reprise de session en est un —, le navigateur
   remet dans les champs et les listes ce qu'ils portaient avant, sans
   qu'aucun `change` ne parte. L'assistant affichait alors un port pose a
   4,726 mm entre « Conductor-4 » et « Conductor-2 » pendant qu'`ANT.ports`
   portait un port vierge, et le serveur refusait un document dont les deux
   couches etaient vides : « recues : « ? » et « ? » ». Une demi-journee pour
   comprendre qu'il fallait croire le refus et non l'ecran.

   `antChampsFideles` reecrit chaque champ avec ce que le BALISAGE declare,
   c'est-a-dire l'etat, puisque c'est lui qui vient de le rendre. */
const posesAuto=[];
function champRestaure(o){
  return Object.assign({setAttribute(n,v){ posesAuto.push(n+"="+v); }}, o);
}
const inputFantome=champRestaure({tagName:"INPUT", type:"text",
                                  value:"4,726", defaultValue:"0"});
const caseFantome=champRestaure({tagName:"INPUT", type:"checkbox",
                                 checked:true, defaultChecked:false});
const listeVide=champRestaure({tagName:"SELECT", multiple:false, selectedIndex:2,
  options:[{defaultSelected:false},{defaultSelected:false},
           {defaultSelected:false}]});
const listeChoisie=champRestaure({tagName:"SELECT", multiple:false, selectedIndex:0,
  options:[{defaultSelected:false},{defaultSelected:true},
           {defaultSelected:false}]});
const champsFantomes=[inputFantome,caseFantome,listeVide,listeChoisie];
antChampsFideles({querySelectorAll(){ return champsFantomes; }});

verifie("un champ restaure par le navigateur revient a ce que l'etat a ecrit",
        inputFantome.value === "0", inputFantome.value);
verifie("une case a cocher restauree revient elle aussi",
        caseFantome.checked === false);
verifie("une liste dont l'etat n'a rien choisi revient a « — choisir — »",
        listeVide.selectedIndex === 0, String(listeVide.selectedIndex));
verifie("et celle que l'etat a remplie garde SON option, pas la premiere",
        listeChoisie.selectedIndex === 1, String(listeChoisie.selectedIndex));
verifie("chaque champ dit au navigateur de ne rien retenir la fois suivante",
        posesAuto.length === 4 &&
        posesAuto.every(p => p === "autocomplete=off"));
/* Appelee sur un panneau absent — un dock replie, un panneau ferme —, elle
   ne doit pas casser le rendu de tout le reste. */
antChampsFideles(null);
antChampsFideles({});
verifie("une racine absente ou sans champs ne fait rien exploser", true);

console.log("");
console.log("23. Les pieces importees : recoller, verifier, placer");
/* CE QUI S'EPROUVE ICI EST CE QUE CSXCAD NE DIRAIT PAS. Un polyedre dont les
   sommets ne sont pas recolles, ou dont une face manque, y est vu VIDE, sans
   un avertissement : le boitier partirait au solveur et n'y existerait pas.
   La page recolle et compte les bords avant d'envoyer quoi que ce soit ; le
   serveur refait la meme verification (banc Python, section 23). */
charger("17-objets.js");
charger("33-pieces.js");
V.bbox={x1:0, y1:0, x2:40, y2:20};
LT.pile=[{cuivre:true, ep:0.035},{cuivre:false, ep:1.6},{cuivre:true, ep:0.035}];
ANT.modele=null;

/* Un cube a sommets dupliques par face, comme OpenCascade les rend. */
function cubeDuplique(ouvert){
  const Q=[[[0,0,0],[0,1,0],[1,1,0],[1,0,0]],[[0,0,1],[1,0,1],[1,1,1],[0,1,1]],
           [[0,0,0],[1,0,0],[1,0,1],[0,0,1]],[[0,1,0],[0,1,1],[1,1,1],[1,1,0]],
           [[0,0,0],[0,0,1],[0,1,1],[0,1,0]],[[1,0,0],[1,1,0],[1,1,1],[1,0,1]]];
  const P=[], T=[];
  (ouvert?Q.slice(0,5):Q).forEach(function(q){
    const n=P.length/3;
    q.forEach(p=>P.push(p[0]*10,p[1]*2,p[2]*2));
    T.push(n,n+1,n+2, n,n+2,n+3);
  });
  return {pos:new Float32Array(P), idx:new Uint32Array(T)};
}
const cd=cubeDuplique(false);
const cs=antSouder(cd.pos,cd.idx);
verifie("les sommets dupliques par face sont recolles : 24 -> 8",
        cs.pos.length/3===8&&cs.idx.length/3===12, (cs.pos.length/3)+" / "+(cs.idx.length/3));
verifie("un cube recolle est ferme", antBords(cs.idx)===0);
verifie("le meme cube NON recolle ne l'est pas (CSXCAD le verrait vide)",
        antBords(cd.idx)>0);
const co=cubeDuplique(true);
const corpsOuvert=antCorpsNeuf("Coque",co.pos,co.idx);
verifie("un corps ouvert nait ignore, et dit combien d'aretes le trahissent",
        corpsOuvert.matiere==="ignore"&&corpsOuvert.bords===4, JSON.stringify([corpsOuvert.matiere,corpsOuvert.bords]));

const f32=new Float32Array([1.5,-2.25,3e-4,1e6]);
const rf=antDeB64(antB64(f32),Float32Array);
verifie("le base64 rend les flottants au bit pres",
        rf.length===4&&rf.every((v,i)=>v===f32[i]));

verifie("le cylindre d'une pile est ferme",
        antBords(antMaillageCylindre(5,10,"x").idx)===0);
const coquePc=antMaillageJoindre(antMaillageBoite(0,0,0,10,10,10),antMaillageBoite(2,2,2,8,8,8,true));
verifie("une coque (dehors + cavite) est fermee", antBords(coquePc.idx)===0);
verifie("toutes les piles du catalogue sont metalliques",
        Object.keys(ANT_PILES).every(t=>antPiecePile(t).corps[0].matiere==="metal"));

verifie("la carte d'un export mecanique est ignoree d'office",
        antMatiereDevinee("PCB_main")==="ignore"&&antMatiereDevinee("Carte principale")==="ignore");
verifie("une pile, une vis, un blindage sont du metal",
        ["Battery CR2032","Vis M2x6","Shield can"].every(n=>antMatiereDevinee(n)==="metal"));
verifie("un corps sans nom parlant est de l'ABS", antMatiereDevinee("Coque_haut")==="abs");

/* LA ROTATION DE LA PAGE EST CELLE DU SERVEUR. Les boutons de pose la
   calculent ici ; le dessin prend celle que le serveur rend. Si les deux
   divergeaient, « poser dessus » poserait une piece a cote de l'endroit ou
   elle est simulee. Les valeurs attendues sont celles d'openems_pieces. */
const Rref=[[0.353553390593,-0.573223304703,0.73919891974],
            [0.612372435696,0.73919891974,0.28033008589],
            [-0.707106781187,0.353553390593,0.612372435696]];
const Rp=antRotation([30,45,60]);
verifie("R = Rz.Ry.Rx, comme openems_pieces._rotation",
        Rp.every((l,i)=>l.every((v,j)=>Math.abs(v-Rref[i][j])<1e-9)));

const barre=antPieceNeuve("barre","barre.stl",[antCorpsNeuf("barre",cd.pos,cd.idx,"metal")]);
barre.rotation=[0,0,90];
let e=antPieceEmprise(barre);
verifie("un quart de tour en Z couche la barre de 10 mm selon Y, sur place",
        Math.abs((e[3]-e[0])-2)<1e-5&&Math.abs((e[4]-e[1])-10)<1e-5&&
        Math.abs((e[0]+e[3])/2-5)<1e-5, JSON.stringify(e));
antPiecePoser(barre,"centrer"); antPiecePoser(barre,"dessus");
e=antPieceEmprise(barre);
verifie("« centrer » puis « poser dessus » : au milieu de la carte, sur sa face",
        Math.abs((e[0]+e[3])/2-20)<1e-4&&Math.abs((e[1]+e[4])/2-10)<1e-4&&
        Math.abs(e[2]-1.6)<1e-4, JSON.stringify(e));
antPiecePoser(barre,"dessous");
e=antPieceEmprise(barre);
verifie("« poser dessous » : le dessus de la piece sous la carte", Math.abs(e[5])<1e-4);

const tete=antPieceNeuve("assemblage","a.step",[
  antCorpsNeuf("coque",cs.pos,cs.idx,"abs"),
  antCorpsNeuf("PCB",cs.pos,cs.idx)]);
ANT.pieces=[tete];
const dp=antPiecesDoc()[0];
verifie("un corps ignore voyage SANS ses triangles",
        dp.corps[1].materiau==="ignore"&&dp.corps[1].sommets===undefined);
verifie("un dielectrique voyage avec εr et tan δ",
        dp.corps[0].materiau==="dielectrique"&&dp.corps[0].er===2.8&&dp.corps[0].df===0.006&&
        typeof dp.corps[0].sommets==="string");
verifie("le centre de rotation part avec la piece, corps ignores compris",
        Array.isArray(dp.centre)&&Math.abs(dp.centre[0]-5)<1e-6);
/* Une section plus haut a remplace `antDocument` par un appui : on recharge
   le vrai, qui remet aussi `ANT` a neuf. */
charger("10-etat.js");
ANT.pieces=[tete];
let docSim=null;
try{ docSim=antDocument(); }catch(err){ docSim={erreur:String(err)}; }
verifie("le document de simulation porte les pieces",
        Array.isArray(docSim.pieces)&&docSim.pieces.length===1, JSON.stringify(docSim).slice(0,200));

const relu=antPiecesRelire(JSON.parse(JSON.stringify(ANT.pieces)));
verifie("un projet relu rend la piece, triangles compris",
        relu.length===1&&relu[0].corps.length===2&&
        antCorpsTab(relu[0].corps[0]).pos.length===cs.pos.length);
verifie("une piece sans triangles ne survit pas a la relecture",
        antPiecesRelire([{nom:"x",corps:[{nom:"y"}]}]).length===0);
const bt=antPieceBoitier();
verifie("le boitier autour de la carte est ferme, et l'entoure",
        bt.corps[0].bords===0&&bt.corps[0].boite[0]<0&&bt.corps[0].boite[3]>40&&
        bt.corps[0].boite[2]<0&&bt.corps[0].boite[5]>1.6, JSON.stringify(bt.corps[0].boite));
bt.gen.ep=3; antPieceRegenerer(bt);
verifie("changer la paroi regenere la coque, matiere gardee",
        bt.corps[0].matiere==="abs"&&Math.abs(bt.corps[0].boite[0]-(-5))<1e-5);
ANT.pieces=[];

console.log("");
console.log("23bis. Fermer un corps que l'export a laisse ouvert");
/* Trois defauts d'un STEP mal cousu, et un corps VRAIMENT ouvert qu'il ne
   faut pas « reparer » en inventant de la matiere. */
function paveTri(x1,y1,z1,x2,y2,z2){ const g=antMaillageBoite(x1,y1,z1,x2,y2,z2); return {pos:Array.from(g.pos), idx:Array.from(g.idx)}; }
// 1. une jonction en T : la face du dessus coupee en deux par un sommet
//    au milieu d'une arete, que la face voisine ne partage pas.
(function(){
  const P=[0,0,0, 10,0,0, 10,10,0, 0,10,0, 0,0,10, 10,0,10, 10,10,10, 0,10,10, 5,0,10];
  const T=[0,2,1, 0,3,2,  4,8,6, 8,5,6, 4,6,7,  0,1,5, 0,5,4,  1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7];
  verifie("une jonction en T laisse le corps ouvert tel quel", antBords(new Uint32Array(T))>0);
  const r=antFermer(new Float32Array(P),new Uint32Array(T));
  verifie("... et la reparation le ferme en coupant l'arete", r.bords===0&&/jonction/.test(r.repare), JSON.stringify([r.bords,r.repare]));
})();
// 2. une fente de 0,03 mm : une face cousue a trois centiemes pres.
(function(){
  const g=cubeDuplique(false);
  g.pos[0]+=0.03;                            // la copie d'un coin, sur UNE face
  verifie("un coin decale de 0,03 mm ouvre le corps au micron",
          antBords(antSouder(g.pos,g.idx).idx)>0);
  const r=antFermer(g.pos,g.idx);
  verifie("... et le recollage progressif le referme",
          r.bords===0&&/recoll/.test(r.repare), JSON.stringify([r.bords,r.repare]));
})();
// 3. une vraie ouverture : une boite sans couvercle ne se bouche pas.
(function(){
  const g=antMaillageBoite(0,0,0,60,90,30);
  const T=Array.from(g.idx); T.splice(6,6);  // le dessus, 60 x 90 mm, retire
  const r=antFermer(g.pos,new Uint32Array(T));
  verifie("un couvercle absent reste absent : l'outil n'invente pas de matiere", r.bords>0);
  const c=antCorpsNeuf("coque",g.pos,new Uint32Array(T));
  verifie("... et le corps reste ignore", c.matiere==="ignore");
})();
// 4. un petit trou (une facette oubliee) se bouche.
(function(){
  const g=antMaillageCylindre(1,2,"z",12);
  const T=Array.from(g.idx); T.splice(0,3);  // une facette du fond
  const r=antFermer(g.pos,new Uint32Array(T));
  verifie("une facette oubliee de 0,3 mm2 est bouchee", r.bords===0&&/bouch/.test(r.repare), JSON.stringify([r.bords,r.repare]));
})();

console.log("");
console.log("24. L'accroche a la souris : la geometrie derriere le clic");
/* La souris ne s'eprouve pas ici, la geometrie si : ce qu'une accroche ECRIT
   dans la position et la rotation de la piece. Une face posee contre la
   carte doit la toucher, a plat, et au bon endroit — sinon le boitier
   « accroche » flotte d'un demi-millimetre, et rien ne le montre. */
(0,eval)(fs.readFileSync(path.join(JS,"vendor","three.min.js"),"utf8"));
global.ANT3D={pret:false, centre:{x:0,y:0,z:0}};
charger("34-placement.js");
verifie("les angles relus d'une rotation sont ceux qui l'ont faite",
        plAngles(antRotation([30,45,60])).every((v,i)=>Math.abs(v-[30,45,60][i])<1e-6));
verifie("un quart de tour sort rond", JSON.stringify(plAngles(antRotation([90,0,0])))==="[90,0,0]");

const V3=(x,y,z)=>new THREE.Vector3(x,y,z);
const barre2=antPieceNeuve("barre","b.stl",[antCorpsNeuf("barre",cs.pos,cs.idx,"metal")]);
antPlaceAccrocher(barre2,{p:V3(10,2,2),n:V3(1,0,0)},{p:V3(20,20,5),n:V3(0,0,1)},"pp");
let eb=antPieceEmprise(barre2);
verifie("point -> point : le coin de la barre tombe sur le point vise",
        Math.abs(eb[3]-20)<1e-6&&Math.abs(eb[4]-20)<1e-6&&Math.abs(eb[5]-5)<1e-6, JSON.stringify(eb));

const barre3=antPieceNeuve("barre","b.stl",[antCorpsNeuf("barre",cs.pos,cs.idx,"metal")]);
antPlaceAccrocher(barre3,{p:V3(10,1,1),n:V3(1,0,0)},{p:V3(20,10,1.6),n:V3(0,0,1)},"ff",true,false);
eb=antPieceEmprise(barre3);
verifie("face -> face : le bout de la barre se pose A PLAT sur la carte, debout",
        Math.abs(eb[2]-1.6)<1e-6&&Math.abs(eb[5]-11.6)<1e-6, JSON.stringify(eb));
verifie("et sans « centrer », elle reste la ou etait sa face",
        Math.abs((eb[0]+eb[3])/2-10)<1e-6&&Math.abs((eb[1]+eb[4])/2-1)<1e-6, JSON.stringify(eb));
verifie("la rotation ecrite est un quart de tour propre",
        barre3.rotation.every(v=>Math.abs(v-Math.round(v))<1e-9)&&
        barre3.rotation.some(v=>Math.abs(Math.abs(v)-90)<1e-9), JSON.stringify(barre3.rotation));

const barre4=antPieceNeuve("barre","b.stl",[antCorpsNeuf("barre",cs.pos,cs.idx,"metal")]);
antPlaceAccrocher(barre4,{p:V3(5,1,0),n:V3(0,0,-1)},{p:V3(20,10,1.6),n:V3(0,0,1)},"ff",true,true);
eb=antPieceEmprise(barre4);
verifie("face -> face « centrer » : couchee sur la carte, centree sur le point",
        Math.abs(eb[2]-1.6)<1e-6&&Math.abs((eb[0]+eb[3])/2-20)<1e-6&&
        Math.abs((eb[1]+eb[4])/2-10)<1e-6&&barre4.rotation.every(v=>v===0), JSON.stringify([eb,barre4.rotation]));

const barre5=antPieceNeuve("barre","b.stl",[antCorpsNeuf("barre",cs.pos,cs.idx,"metal")]);
antPlaceAccrocher(barre5,{p:V3(3,1,0),n:V3(0,0,-1)},{p:V3(30,30,1.6),n:V3(0,0,1)},"pf");
eb=antPieceEmprise(barre5);
verifie("point -> face : la barre descend sur le plan sans bouger en x ni en y",
        Math.abs(eb[2]-1.6)<1e-6&&Math.abs(eb[0])<1e-6&&Math.abs(eb[1])<1e-6, JSON.stringify(eb));
console.log("");
console.log("24bis. La carte se deplace comme une piece, et le calcul reste juste");
/* La grille du solveur est alignee sur la carte : deplacer la carte dans
   l'assemblage, c'est envoyer au serveur les pieces deplacees en sens
   inverse. Si la composition etait fausse, le boitier « bougerait » dans la
   simulation sans avoir bouge a l'ecran — et rien ne le montrerait. */
(function(){
  const pc=antPieceNeuve("barre","b.stl",[antCorpsNeuf("barre",cs.pos,cs.idx,"metal")]);
  pc.position=[3,-2,5]; pc.rotation=[0,30,0];
  const W=antPieceMatrice(pc);                 // la piece dans l'assemblage
  ANT.carte3d={position:[0,0,0],rotation:[0,0,0]};
  const r0=antPieceRelative(pc);
  verifie("carte a l'origine : la piece part telle quelle",
          JSON.stringify(r0.position)===JSON.stringify(pc.position)&&JSON.stringify(r0.rotation)===JSON.stringify(pc.rotation));
  ANT.carte3d={position:[12,-7,4],rotation:[0,0,90]};
  const B=new THREE.Matrix4().fromArray(antCarteMatrice());
  const Mrel=new THREE.Matrix4().fromArray(antPieceMatriceCarte(pc));
  const compose=B.clone().multiply(Mrel).elements;
  verifie("carte deplacee et tournee : B · (piece vue de la carte) = piece dans l'assemblage",
          compose.every((v,i)=>Math.abs(v-W[i])<1e-6), JSON.stringify([compose.map(v=>+v.toFixed(3)),W.map(v=>+v.toFixed(3))]));
  const avant=antPieceEmprise(pc);
  antPiecePoser(pc,"dessus");
  const apres=antPieceEmprise(pc), cm=antCarteMonde();
  verifie("« poser dessus » vise la carte LA OU ELLE EST",
          Math.abs(apres[2]-cm.z2)<1e-4&&Math.abs(cm.z2-(4+1.6))<1e-4, JSON.stringify([apres,cm]));
  /* L'accroche deplace la carte comme une piece : sa face du dessus contre
     un point a z = 30 — la carte monte, elle ne tourne pas. */
  ANT.carte3d={position:[0,0,0],rotation:[0,0,0]};
  antPlaceAccrocher(ANT_CARTE_PIECE,{p:V3(20,10,1.6),n:V3(0,0,1)},{p:V3(20,10,30),n:V3(0,0,1)},"pf");
  verifie("la carte s'accroche comme une piece (point -> face)",
          Math.abs(ANT.carte3d.position[2]-28.4)<1e-6&&ANT.carte3d.rotation.every(v=>v===0), JSON.stringify(ANT.carte3d));
  ANT.carte3d={position:[0,0,0],rotation:[0,0,0]};
})();

console.log("");
console.log("24ter. Les corrections de la revue");
verifie("la matiere se devine sur des MOTS : Valuation, Scan_window, Devis ne sont pas du metal",
        ["Valuation","Scan_window","Devis","Calumet"].every(n=>antMatiereDevinee(n)==="abs"),
        JSON.stringify(["Valuation","Scan_window","Devis","Calumet"].map(antMatiereDevinee)));
verifie("... et capot_alu, Batt1, Battery, Vis_M2, Evaluation_board sont reconnus",
        antMatiereDevinee("capot_alu")==="metal"&&antMatiereDevinee("Batt1")==="metal"&&
        antMatiereDevinee("Battery")==="metal"&&antMatiereDevinee("Vis_M2")==="metal"&&
        antMatiereDevinee("Evaluation_board")==="ignore");
(function(){
  const sauve=ANT.modele;
  ANT.modele=null; const c1=antCarteCentre();
  ANT.modele={z_haut:7.3}; const c2=antCarteCentre();
  ANT.modele=sauve;
  verifie("le pivot de la carte ne depend pas de la derniere reponse du serveur",
          JSON.stringify(c1)===JSON.stringify(c2), JSON.stringify([c1,c2]));
})();
(function(){
  ANT.carte3d={position:[100,0,0],rotation:[0,0,0]};
  ANT.pieces=[];
  const b=plBoiteAssemblage();
  ANT.carte3d={position:[0,0,0],rotation:[0,0,0]};
  verifie("la coupe balaie l'assemblage : la carte deplacee de 100 mm y est",
          Math.abs(b.x1-100)<1e-9&&Math.abs(b.x2-140)<1e-9, JSON.stringify(b));
})();
(function(){
  /* Le double-clic, sur un canevas en trompe-l'oeil : deux clics rapides au
     meme endroit ne doivent donner qu'UN clic au placement. */
  global.window.ResizeObserver=undefined;
  charger("14-apercu3d.js");
  const h={};
  const cv={addEventListener(t,f){ h[t]=f; }, setPointerCapture(){}, releasePointerCapture(){},
            classList:{add(){},remove(){}}};
  const recus=[];
  global.antPlacePointeur=function(q){ if(q==="clic")recus.push(q); return false; };
  ant3dSouris(cv);
  const ev=(t,x)=>Object.assign({type:t, clientX:x, clientY:50, button:0, pointerId:1,
                                  pointerType:"mouse", shiftKey:false, ctrlKey:false, metaKey:false,
                                  preventDefault(){}});
  h.pointerdown(ev("pointerdown",100)); h.pointerup(ev("pointerup",100));
  h.pointerdown(ev("pointerdown",101)); h.pointerup(ev("pointerup",101));
  verifie("un double-clic ne donne qu'UN clic au placement", recus.length===1, recus.length);
  const t0=performance.now(); while(performance.now()-t0<380){}
  h.pointerdown(ev("pointerdown",101)); h.pointerup(ev("pointerup",101));
  verifie("... un clic plus lent reste un clic (la piece derriere)", recus.length===2, recus.length);
  delete global.antPlacePointeur;
})();

ANT.pieces=[barre3];
V.modele={};
const ml=antPlaceModeleLocal();
verifie("sans modele du serveur, l'apercu 3D dessine quand meme carte et pieces",
        ml&&ml.local&&ml.pieces.length===1&&ml.pieces[0].matrice.length===16&&
        ml.boite.z2>11.6, JSON.stringify(ml&&ml.boite));
ANT.pieces=[];

console.log("");
console.log(ok+" verifications, "+(ko.length?ko.length+" RATEES : "+ko.join(" | ")
                                            :"toutes passees."));
process.exit(ko.length?1:0);

