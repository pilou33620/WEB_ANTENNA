"use strict";
/* =============================================================================
   Antenne openEMS — 25-polygones.js
   L'intersection de deux polygones, et rien d'autre.

   POURQUOI ELLE MANQUAIT. Une découpe — une fente dans un patch, un
   dégagement autour d'une ligne — entre dans le modèle comme un TROU du
   versement qu'elle perce : le script redessine le substrat par-dessus le
   cuivre, à une priorité plus haute, et c'est ainsi que CSXCAD fait des trous.
   Tant que la découpe est entièrement à l'intérieur du versement, il n'y a
   rien à calculer : le trou EST la découpe.

   Mais une découpe à cheval sur le bord ne se représente pas ainsi. La partie
   qui déborde recouvrirait du cuivre voisin — une piste qui passe à côté, un
   second versement sur la même couche — et l'effacerait sans le dire. Jusqu'ici
   ces découpes-là étaient comptées et écartées ; c'était honnête, et c'était
   quand même une fente qui manquait dans l'antenne.

   CE QUE FAIT CE MODULE : il coupe la découpe AU BORD du versement. Ce qui
   reste est exactement la partie qui doit être retirée, et rien d'autre ne
   bouge. Un trou qui touche le bord n'est pas un problème pour la suite : le
   mécanisme de priorité ne demande pas que le trou soit intérieur, seulement
   qu'il recouvre du cuivre.

   L'ALGORITHME est celui de Greiner-Hormann : on marque les intersections des
   deux contours, on les insère dans les deux listes de sommets, on marque
   chaque intersection « entrée » ou « sortie » selon qu'on pénètre ou qu'on
   quitte l'autre polygone, puis on suit les bords en changeant de polygone à
   chaque intersection. Il rend PLUSIEURS morceaux quand il le faut — une
   fente en U coupée par un bord en donne deux —, et c'est bien ce qu'on veut.

   LES DÉGÉNÉRESCENCES SONT LA VRAIE DIFFICULTÉ, et elles sont ici la règle et
   non l'exception : un dégagement rectangulaire aligné sur le bord d'un
   versement rectangulaire, c'est exactement le cas que l'algorithme ne sait
   pas traiter — un sommet posé sur une arête, deux arêtes confondues. On les
   lève par une PERTURBATION de 10⁻⁷ mm, soit un dix-millième de micron :
   trois ordres de grandeur sous la plus petite cellule qu'on maille jamais, et
   six sous la cote la plus fine qu'une carte porte. La géométrie en est
   changée de l'épaisseur d'un atome ; le maillage, lui, n'en saura rien.

   ET QUAND ÇA NE MARCHE PAS, ON LE DIT. La fonction rend `null` plutôt qu'un
   résultat approché : l'appelant compte alors la découpe comme non prise, et
   le panneau l'affiche. Une fente qui manque change complètement une antenne,
   et rien dans le S₁₁ ne dirait qu'elle manquait.
   ============================================================================= */

/* La perturbation qui lève les dégénérescences. Voir l'en-tête : elle est
   choisie assez grande pour sortir du bruit du calcul flottant, assez petite
   pour être invisible partout ailleurs. */
const POLY_EPS=1e-7;

/* Deux points confondus, à la tolérance près. */
function polyMeme(a,b){
  return Math.abs(a.x-b.x)<1e-12&&Math.abs(a.y-b.y)<1e-12;
}

/* Un tableau plat [x,y,x,y,…] — le format de tout le reste de l'outil — vers
   une liste chaînée de sommets. */
function polyListe(plat,eps){
  const n=[];
  for(let i=0;i+1<plat.length;i+=2)
    n.push({x:plat[i]+(eps||0), y:plat[i+1]+(eps||0),
            inter:false, entre:false, visite:false,
            voisin:null, alpha:0, suiv:null, prec:null});
  if(n.length<3)return null;
  for(let i=0;i<n.length;i++){
    n[i].suiv=n[(i+1)%n.length];
    n[i].prec=n[(i-1+n.length)%n.length];
  }
  return n[0];
}

function polyPlat(debut){
  const out=[];
  let p=debut;
  do{ out.push(p.x,p.y); p=p.suiv; }while(p&&p!==debut);
  return out;
}

/* L'aire signée : elle dit le sens de parcours, et sert à écarter les
   morceaux d'aire nulle que la perturbation peut produire. */
function polyAire(plat){
  let a=0;
  for(let i=0;i+1<plat.length;i+=2){
    const j=(i+2)%plat.length;
    a+=plat[i]*plat[j+1]-plat[j]*plat[i+1];
  }
  return a/2;
}

/* Le point est-il dans le polygone ? Lancer de rayon, impair = dedans. */
function polyDedans(pt,debut){
  let dedans=false, p=debut;
  do{
    const q=p.suiv;
    if((p.y>pt.y)!==(q.y>pt.y)){
      const x=p.x+(pt.y-p.y)/(q.y-p.y)*(q.x-p.x);
      if(pt.x<x)dedans=!dedans;
    }
    p=q;
  }while(p!==debut);
  return dedans;
}

/* L'intersection de deux segments, en paramètres. `null` quand ils sont
   parallèles ou quand elle tombe hors des deux segments. */
function polyCroise(a,b,c,d){
  const rx=b.x-a.x, ry=b.y-a.y, sx=d.x-c.x, sy=d.y-c.y;
  const den=rx*sy-ry*sx;
  if(Math.abs(den)<1e-14)return null;
  const t=((c.x-a.x)*sy-(c.y-a.y)*sx)/den;
  const u=((c.x-a.x)*ry-(c.y-a.y)*rx)/den;
  if(t<=0||t>=1||u<=0||u>=1)return null;
  return {t:t, u:u, x:a.x+t*rx, y:a.y+t*ry};
}

function polyInserer(entre,apres,noeud){
  let p=apres;
  while(p.suiv!==entre&&p.suiv.inter&&p.suiv.alpha<noeud.alpha)p=p.suiv;
  noeud.suiv=p.suiv; noeud.prec=p;
  p.suiv.prec=noeud; p.suiv=noeud;
}

/* L'INTERSECTION DE DEUX POLYGONES. Rend une liste de contours plats, ou
   `null` si le calcul n'aboutit pas — auquel cas l'appelant doit compter la
   découpe comme non prise, et le dire. */
function polyIntersection(platA,platB){
  const A=polyListe(platA,0), B=polyListe(platB,POLY_EPS);
  if(!A||!B)return null;

  /* 1. les intersections, insérées dans les deux listes -------------------- */
  let n=0;
  let a=A;
  do{
    if(!a.inter){
      let b=B;
      do{
        if(!b.inter){
          const s=polyCroise(a,polySuivSommet(a),b,polySuivSommet(b));
          if(s){
            const ia={x:s.x,y:s.y,inter:true,entre:false,visite:false,
                      alpha:s.t,voisin:null,suiv:null,prec:null};
            const ib={x:s.x,y:s.y,inter:true,entre:false,visite:false,
                      alpha:s.u,voisin:null,suiv:null,prec:null};
            ia.voisin=ib; ib.voisin=ia;
            polyInserer(polySuivSommet(a),a,ia);
            polyInserer(polySuivSommet(b),b,ib);
            n++;
          }
        }
        b=b.suiv;
      }while(b!==B);
    }
    a=a.suiv;
  }while(a!==A);

  /* 2. aucun croisement : l'un contient l'autre, ou ils sont disjoints ----- */
  if(!n){
    if(polyDedans(B,A))return [polyPlat(B)];      // la découpe est dedans
    if(polyDedans(A,B))return [polyPlat(A)];      // le versement est dedans
    return [];                                     // rien de commun
  }
  /* Un nombre IMPAIR de croisements est impossible sur deux contours fermés :
     s'il s'en trouve un, c'est qu'un sommet tombe exactement sur une arête et
     que la perturbation n'a pas suffi. On refuse plutôt que de rendre un
     morceau ouvert. */
  if(n%2)return null;

  /* 3. entrée ou sortie ---------------------------------------------------- */
  let dedans=polyDedans(A,B);
  a=A;
  do{
    if(a.inter){ a.entre=!dedans; dedans=!dedans; }
    a=a.suiv;
  }while(a!==A);
  dedans=polyDedans(B,A);
  let b=B;
  do{
    if(b.inter){ b.entre=!dedans; dedans=!dedans; }
    b=b.suiv;
  }while(b!==B);

  /* 4. le parcours --------------------------------------------------------
     On part d'une intersection, on suit le contour EN AVANT quand on entre
     dans l'autre polygone et EN ARRIERE quand on en sort, et on change de
     polygone a chaque intersection rencontree. Ce qu'on decrit ainsi est
     exactement le bord de la partie commune. */
  const sortie=[];
  let garde=0;
  const maxi=8*(polyCompte(A)+polyCompte(B))+64;
  for(;;){
    const depart=polyPremiereLibre(A);
    if(!depart)break;
    const contour=[depart.x,depart.y];
    let p=depart;
    do{
      p.visite=true;
      if(p.voisin)p.voisin.visite=true;
      if(p.entre){
        do{ p=p.suiv; contour.push(p.x,p.y);
            if(++garde>maxi)return null; }while(!p.inter);
      }else{
        do{ p=p.prec; contour.push(p.x,p.y);
            if(++garde>maxi)return null; }while(!p.inter);
      }
      p.visite=true;
      if(!p.voisin)return null;
      p.voisin.visite=true;
      p=p.voisin;
    }while(p!==depart&&garde<=maxi);
    if(garde>maxi)return null;
    /* Le dernier point rejoint le premier : on ne le garde pas deux fois. */
    if(contour.length>=4&&
       Math.abs(contour[contour.length-2]-contour[0])<1e-12&&
       Math.abs(contour[contour.length-1]-contour[1])<1e-12)
      contour.length-=2;
    /* Les morceaux d'aire nulle sont ceux que la perturbation a créés : un
       contour qui longe une arete commune. Ils ne retirent aucun cuivre. */
    if(contour.length>=6&&Math.abs(polyAire(contour))>1e-9)
      sortie.push(contour);
  }

  return sortie;
}

/* La premiere intersection encore inexploree, ou rien. */
function polyPremiereLibre(debut){
  let p=debut;
  do{ if(p.inter&&!p.visite)return p; p=p.suiv; }while(p!==debut);
  return null;
}

function polyCompte(debut){
  let n=0,p=debut;
  do{ n++; p=p.suiv; }while(p!==debut);
  return n;
}

/* Le sommet d'origine suivant, en sautant les intersections déjà insérées :
   c'est entre DEUX SOMMETS qu'on cherche des croisements, pas entre deux
   points d'intersection. */
function polySuivSommet(p){
  let q=p.suiv;
  while(q.inter)q=q.suiv;
  return q;
}
