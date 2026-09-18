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

/* -- l'IFA : le court-circuit et les coutures sont réels (Silicon Labs AN1088) -- */
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
verifie("le bras dessine de l'IFA mesure La + ha + sc (AN1088)",
        Math.abs(mesure(tIfa)-(pIfa.La-pIfa.wb/2+pIfa.ha+pIfa.sc))<0.1,
        mesure(tIfa).toFixed(4));
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
verifie("un maillage diélectrique supérieur à lambda_d/15 est signalé",
        diagsMaille.some(d => d.id === "maillage_grossier"));

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

console.log("\n14. La saisie décimale robuste dans l'assistant");
extraire("02-modele.js", "mdlNb");
extraire("13-assistant.js", "antLierNombre");

const elTest = { value: "0" };
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
console.log(ok+" verifications, "+(ko.length?ko.length+" RATEES : "+ko.join(" | ")
                                            :"toutes passees."));
process.exit(ko.length?1:0);

