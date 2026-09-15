/* =============================================================================
   Banc d'essai du decoupage de polygones (js/25-polygones.js).

     node test/banc-polygones.js

   POURQUOI UN BANC A PART. Le decoupage d'une decoupe au bord d'un versement
   est le seul morceau de l'outil dont on ne voit PAS le resultat : une fente
   mal coupee ne fait pas d'erreur, elle fait une antenne differente. Les cas
   degeneres — une decoupe alignee sur le bord, un sommet pose sur une arete —
   sont ici la regle et non l'exception, et ce sont eux que ce banc vise.

   Le banc d'essai principal (python/test/banc-openems.py) lance celui-ci
   quand node est installe : il n'y a qu'une commande a retenir.
   ============================================================================= */
const fs=require("fs");
const src=fs.readFileSync(process.argv[2]||require("path").join(__dirname,"..","js","25-polygones.js"),"utf8");
eval(src.replace(/^"use strict";/,""));

let ok=0; const ko=[];
function aire(p){ let a=0;
  for(let i=0;i+1<p.length;i+=2){ const j=(i+2)%p.length;
    a+=p[i]*p[j+1]-p[j]*p[i+1]; }
  return Math.abs(a/2); }
function verifie(nom,cond,detail){
  if(cond){ ok++; console.log("  ok   "+nom); }
  else { ko.push(nom); console.log("  RATE "+nom+"   "+(detail||"")); }
}
function rect(x,y,w,h){ return [x,y, x+w,y, x+w,y+h, x,y+h]; }
function aireTotale(r){ return (r||[]).reduce((s,p)=>s+aire(p),0); }

const versement=rect(0,0,40,30);

// 1. entierement dedans : le trou EST la decoupe
let r=polyIntersection(versement,rect(10,10,5,5));
verifie("une decoupe interieure ressort telle quelle",
        r&&r.length===1&&Math.abs(aireTotale(r)-25)<1e-3,
        JSON.stringify(r));

// 2. a cheval sur le bord droit : la moitie qui deborde est coupee
r=polyIntersection(versement,rect(35,10,10,5));
verifie("une decoupe a cheval est coupee au bord",
        r&&r.length===1&&Math.abs(aireTotale(r)-25)<1e-2,
        "aire="+aireTotale(r));

// 3. a cheval sur un coin
r=polyIntersection(versement,rect(38,28,10,10));
verifie("une decoupe sur un coin garde le quart interieur",
        r&&Math.abs(aireTotale(r)-4)<1e-2, "aire="+aireTotale(r));

// 4. entierement dehors
r=polyIntersection(versement,rect(60,60,5,5));
verifie("une decoupe hors du versement ne donne rien",
        r&&r.length===0, JSON.stringify(r));

// 5. le versement est dans la decoupe
r=polyIntersection(versement,rect(-10,-10,100,100));
verifie("une decoupe qui couvre tout rend le versement entier",
        r&&r.length===1&&Math.abs(aireTotale(r)-1200)<1e-2,
        "aire="+aireTotale(r));

// 6. une bande qui traverse de part en part
r=polyIntersection(versement,rect(-5,12,50,3));
verifie("une fente traversante garde la partie interieure",
        r&&Math.abs(aireTotale(r)-120)<1e-1, "aire="+aireTotale(r));

// 7. un versement en L, decoupe a cheval sur la rentrance
const L=[0,0, 40,0, 40,10, 15,10, 15,30, 0,30];
r=polyIntersection(L,rect(10,5,20,20));
verifie("un versement en L : seule la matiere presente est retiree",
        r&&aireTotale(r)>0&&aireTotale(r)<400, "aire="+aireTotale(r));
// la reponse exacte : (10..15)x(5..25) = 100, plus (15..30)x(5..10) = 75
verifie("… et l'aire retiree est exactement celle du recouvrement",
        r&&Math.abs(aireTotale(r)-175)<1e-1, "aire="+aireTotale(r));

// 8. deux morceaux : une fente en U coupee par le bord
const U=[0,0, 40,0, 40,30, 30,30, 30,10, 10,10, 10,30, 0,30];
r=polyIntersection(U,rect(-5,20,50,5));
verifie("une decoupe qui coupe un U en deux rend DEUX morceaux",
        r&&r.length===2, "morceaux="+(r?r.length:"null"));
verifie("… et leurs aires font bien 2 x 10 x 5",
        r&&Math.abs(aireTotale(r)-100)<1e-1, "aire="+aireTotale(r));

// 9. arete exactement confondue : le cas degenere que la perturbation leve
r=polyIntersection(versement,rect(0,0,10,5));
verifie("une decoupe posee exactement dans un coin est acceptee",
        r&&r.length>=1&&Math.abs(aireTotale(r)-50)<1e-2,
        "aire="+aireTotale(r)+" morceaux="+(r?r.length:"null"));

// 10. decoupe affleurant un bord, debordant de l'autre cote
r=polyIntersection(versement,rect(-3,0,10,30));
verifie("une decoupe qui longe deux bords et deborde du troisieme",
        r&&Math.abs(aireTotale(r)-210)<1e-1, "aire="+aireTotale(r));

// 11. un disque a cheval (polygone a 48 cotes)
const disque=[]; for(let i=0;i<48;i++){ const a=2*Math.PI*i/48;
  disque.push(40+6*Math.cos(a), 15+6*Math.sin(a)); }
r=polyIntersection(versement,disque);
verifie("un disque a cheval garde a peu pres sa moitie",
        r&&Math.abs(aireTotale(r)-Math.PI*36/2)<1.0, "aire="+aireTotale(r));

console.log("");
console.log(ok+" verifications, "+(ko.length?ko.length+" RATEES : "+ko.join(" | ")
                                            :"toutes passees."));
process.exit(ko.length?1:0);
