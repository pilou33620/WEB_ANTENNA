"use strict";
/* =============================================================================
   Antenne openEMS — 36-port-verdict.js
   Ce que l'on vérifie d'un port avant de le laisser partir au solveur.

   Un port posé au clic passe par un VERDICT : ce que touche chacune de ses
   deux bornes dans le cuivre qui part au solveur. Sur P01x274PCB-C.xml, le
   port de l'antenne 868 MHz avait été cliqué à 0,03 mm du bord d'une réserve
   de masse : une heure trois quarts de calcul pour un S₁₁ plat à 0 dB, et
   rien, dans la courbe, pour le dire. Le serveur voit déjà le cuivre dessiné
   sous le port (`_avis_ports_court_circuit`) et les écarts que la grille
   referme (`_ponts_de_maille`) ; la page voit, elle, la carte entière, et le
   dit pendant qu'on pose.

   LA RÈGLE EST CELLE DU CLIC (37-port-auto.js) : même marge autour de la
   borne de masse, mêmes couches traversées, même trou métallisé qui gêne.
   Un port que le clic pose « franc » n'a pas ici de ✗, et un port retouché
   à la main contre un bord n'a pas de ✓.

   LIMITE CONNUE. La masse n'est reconnue que par son NET. Sur un fichier sans
   connectivité (antenna4c.xml), le cuivre désigné au clic entre comme
   antenne, et le verdict ne sait pas y distinguer la masse.
   ============================================================================= */

/* --------------------------------------------------------------------------
   Ce que le solveur verra en un point — indexé
   -------------------------------------------------------------------------- */
/* Le cuivre RETENU en (x, y) sur une couche : « antenne », « masse », ou "".
   Il est lu dans ce qui part au solveur (`antCuivreDuModele`), pas dans la
   carte : une piste que la sélection laisse dehors est de l'air pour openEMS,
   et un port qui s'y appuierait n'aurait rien sous sa borne.

   LA QUESTION EST POSÉE DES DIZAINES DE MILLIERS DE FOIS — à chaque image de
   la surimpression, et par la recherche du clic —, et un plan de masse porte
   des milliers de polygones. Chaque bloc de cuivre reçoit donc une grille de
   seaux de ANT_SEAU_MM, rangée à côté de lui et non sur lui : le cuivre du
   modèle est partagé, on n'y écrit pas (voir `antCuivreDuModele`). Un
   polygone qui couvrirait plus de 400 seaux va dans une liste à part, lue à
   chaque fois. L'antenne l'emporte sur la masse au même point. */
const ANT_SEAU_MM=1.0;
const ANT_SEAUX_BLOC=new WeakMap();
function antSeauxBloc(b,pas){
  let s=ANT_SEAUX_BLOC.get(b);
  if(s&&s.pas===pas)return s;
  s={pas:pas,seaux:new Map(),grands:[]};
  for(const p of b.polys){
    let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
    for(let i=0;i+1<p.o.length;i+=2){
      if(p.o[i]<x1)x1=p.o[i]; if(p.o[i]>x2)x2=p.o[i];
      if(p.o[i+1]<y1)y1=p.o[i+1]; if(p.o[i+1]>y2)y2=p.o[i+1];
    }
    const e={x1:x1,y1:y1,x2:x2,y2:y2,p:p};
    const i1=Math.floor(x1/pas), i2=Math.floor(x2/pas);
    const j1=Math.floor(y1/pas), j2=Math.floor(y2/pas);
    if((i2-i1+1)*(j2-j1+1)>400){ s.grands.push(e); continue; }
    for(let i=i1;i<=i2;i++)for(let j=j1;j<=j2;j++){
      const cle=i+","+j;
      if(!s.seaux.has(cle))s.seaux.set(cle,[]);
      s.seaux.get(cle).push(e);
    }
  }
  ANT_SEAUX_BLOC.set(b,s);
  return s;
}

function antCuivreRetenuEn(nomCouche,x,y){
  const cu=antCuivreDuModele();
  const b=cu&&cu.blocs.find(k=>k.couche===nomCouche);
  if(!b)return "";
  const pas=ANT_SEAU_MM*(V.unite==="in"?1/25.4:1);
  const s=antSeauxBloc(b,pas);
  const seau=s.seaux.get(Math.floor(x/pas)+","+Math.floor(y/pas))||[];
  let vu="";
  for(const liste of [seau,s.grands])
    for(const e of liste){
      if(x<e.x1||x>e.x2||y<e.y1||y>e.y2)continue;
      const p=e.p;
      if(!mdlDansPoly(p.o,x,y))continue;
      if((p.t||[]).some(t=>mdlDansPoly(t,x,y)))continue;
      if(!p.m)return "antenne";
      vu="masse";
    }
  return vu;
}

/* --------------------------------------------------------------------------
   Les deux bornes d'un port dans le plan
   -------------------------------------------------------------------------- */
/* Où elles sont, et ce qu'elles touchent — lu un centième de millimètre
   au-delà de chacune, du côté du cuivre. Le verdict et la surimpression
   (15-overlay2d.js) lisent les MÊMES points : une borne rouge à l'écran et
   un ✓ dans le panneau ne peuvent pas se contredire. */
function antPortBornesPlan(p){
  const k=V.unite==="in"?1/25.4:1, d=0.01*k;
  const e=(p.ecart>0?p.ecart:0.2*k)/2;
  const ux=p.dir==="x"?1:0, uy=p.dir==="y"?1:0;
  return [-1,1].map(function(sg){
    return {x:p.x+sg*ux*e, y:p.y+sg*uy*e,
            touche:antCuivreRetenuEn(p.de,p.x+sg*ux*(e+d),p.y+sg*uy*(e+d))};
  });
}

/* --------------------------------------------------------------------------
   Le verdict : ce que touche chaque borne, et ce qui est entre elles
   -------------------------------------------------------------------------- */
/* Au-delà, le port dans le plan est long : il compte dans sa mesure un bout
   de ligne qui n'est ni l'antenne ni la source. */
const ANT_PORT_ECART_LONG_MM=0.5;

/* Une ligne par constat, {ok, t}. `ok` vaut true, false, ou null quand il n'y
   a rien à reprocher mais quelque chose à savoir. */
function antPortVerdict(p){
  const out=[];
  if(!p||!p.pose||!V.modele)return out;
  if(!p.de||!p.a){
    out.push({ok:false,t:"Les deux couches du port ne sont pas choisies."});
    return out;
  }
  if(p.type==="coaxial")return out;       // le connecteur a ses propres avis
  const k=V.unite==="in" ? 1/25.4 : 1;
  const nom=function(n){ return n==="antenne"?"l'antenne":n==="masse"?"la masse":"rien"; };

  if(p.dir==="x"||p.dir==="y"){
    const e=(p.ecart>0?p.ecart:0.2*k)/2;
    const [b1,b2]=antPortBornesPlan(p).map(b=>b.touche);
    const milieu=antCuivreRetenuEn(p.de,p.x,p.y);
    if(milieu)
      out.push({ok:false,t:"Le milieu du port est sur du cuivre ("+nom(milieu)+
        ") : un port dans le plan enjambe un ÉCART, et celui-ci est court-"+
        "circuité par le métal qu'il traverse."});
    const paire=[b1,b2].sort().join("|");
    if(paire==="antenne|masse"){
      out.push({ok:true,t:"Une borne sur l'antenne, l'autre sur la masse, "+
        "sur « "+p.de+" », à "+aL(2*e)+" l'une de l'autre."});
      if(2*e>ANT_PORT_ECART_LONG_MM*k)
        out.push({ok:null,t:"L'écart fait "+aL(2*e)+" : c'est long pour une "+
          "source localisée, le port mesure avec lui un bout de ligne. Un "+
          "point d'alimentation dont la masse est plus proche — le "+
          "connecteur, le point de test — donnera une mesure plus propre."});
    }
    else if(b1===b2&&b1)
      out.push({ok:false,t:"Les deux bornes touchent "+nom(b1)+" : le port "+
        "relie ce cuivre à lui-même, il ne mesurera rien."});
    else
      out.push({ok:false,t:"Une borne touche "+nom(b1)+", l'autre "+nom(b2)+
        " : un port dont une borne est dans le vide est un circuit ouvert."});
    return out;
  }

  /* LE PORT VERTICAL. Même marge que le clic (`ANT_PORT_MARGE_MM`) : la
     grille se cale à une maille près, et une borne posée à 0,03 mm d'une
     réserve tombe dedans ou non selon elle — c'est le port de P01x274 qui
     avait coûté une heure trois quarts de calcul. */
  const marge=ANT_PORT_MARGE_MM*k, fin=0.01*k;
  const couches=antCouchesEnZ();
  const haut=antCuivreRetenuEn(p.de,p.x,p.y);
  const bas=antCuivreRetenuEn(p.a,p.x,p.y);
  out.push({ok:haut==="antenne",
    t:"Borne « "+p.de+" » : "+(haut==="antenne"?"sur l'antenne."
      :haut==="masse"?"sur la MASSE — le port y part du mauvais cuivre."
      :"dans le vide — aucun cuivre retenu sous le port.")});
  if(bas==="masse"&&!antPortFranc(antCuivreRetenuEn,p.a,p.x,p.y,marge,"masse")){
    const d=antPortBord(antCuivreRetenuEn,p.a,p.x,p.y,"masse",marge,fin);
    out.push({ok:null,
      t:"Borne « "+p.a+" » : sur la masse, mais à "+aL(d!=null?d:marge)+
        " d'un bord — moins de "+aL(marge)+". La grille se cale à une maille "+
        "près : la borne peut tomber dans la réserve, et le port s'ouvrir. "+
        "Reposez-le au clic : il glisse vers un point franc."});
  }
  else
    out.push({ok:bas==="masse",
      t:"Borne « "+p.a+" » : "+(bas==="masse"?"sur la masse."
        :bas==="antenne"?"sur du cuivre de l'ANTENNE — le port est court-"+
          "circuité par ce cuivre."
        :"dans le vide — une réserve, un dégagement : le port est ouvert. "+
          "Un port vertical demande la masse JUSTE sous lui.")});

  /* LES COUCHES ENTRE LES DEUX BORNES. La ligne du port les traverse : du
     métal au point la court-circuite, sans que rien dans les deux bornes ne
     le trahisse — un port de Conductor-4 à Conductor-2 à travers la masse
     pleine de Conductor-3 avait deux ✓. */
  for(const c of antPortEntre(couches,p.de,p.a)){
    const n=antCuivreRetenuEn(c.nom,p.x,p.y);
    if(n)
      out.push({ok:false,t:"Le port traverse "+nom(n)+" sur « "+c.nom+
        " » pour aller de « "+p.de+" » à « "+p.a+" » : ce métal le court-"+
        "circuite."+(n==="masse"?" Prenez « "+c.nom+" » pour couche « vers »."
                                 :"")});
    else if(!antPortFranc(antCuivreRetenuEn,c.nom,p.x,p.y,marge,"")){
      const d=antPortBord(antCuivreRetenuEn,c.nom,p.x,p.y,"",marge,fin);
      out.push({ok:null,t:"Le port passe à "+aL(d!=null?d:marge)+" du cuivre "+
        "de « "+c.nom+" », qu'il traverse : la grille peut l'y souder."});
    }
  }

  /* Le trou métallisé qui passe entre les deux couches : le seul qui double
     le port. Un via qui s'arrête sur l'une d'elles ne le touche pas. */
  const cu=antCuivreDuModele();
  const g=antPortViaGenant((cu&&cu.vias)||[],couches,p.de,p.a,p.x,p.y,marge);
  if(g&&g.jeu<=0)
    out.push({ok:false,t:"Le port est posé sur un trou métallisé ("+aL(g.v.d)+
      ", de « "+g.v.de+" » à « "+g.v.a+" ») : le métal du via double le port "+
      "et le court-circuite."});
  else if(g)
    out.push({ok:null,t:"Un trou métallisé ("+aL(g.v.d)+", de « "+g.v.de+
      " » à « "+g.v.a+" ») passe à "+aL(g.jeu)+" du port, entre ses deux "+
      "couches : la grille peut les réunir."});
  return out;
}

/* Le verdict, sous les cotes : ce que touche chaque borne. */
function antPortVerdictHtml(){
  const v=antPortVerdict(ANT.port);
  if(!v.length)return "";
  return '<div class="avis">'+v.map(d=>
    '<div class="av '+(d.ok===false?"grave":d.ok?"info":"attention")+'"><span>'+
    (d.ok===false?"✗ ":d.ok?"✓ ":"")+aEsc(d.t)+'</span></div>').join("")+
    '</div>';
}
