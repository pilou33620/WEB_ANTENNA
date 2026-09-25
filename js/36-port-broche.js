"use strict";
/* =============================================================================
   Antenne openEMS — 36-port-broche.js
   Le port posé sur une broche de composant, et ce que l'on vérifie de tout
   port avant de le laisser partir au solveur.

   POURQUOI UNE BROCHE ET PAS UN CLIC. Un clic donne deux coordonnées ; il ne
   dit pas CE QUE l'on a voulu désigner. Sur P01x274PCB-C.xml, le port de
   l'antenne 868 MHz avait été cliqué à 0,03 mm du bord d'une réserve de masse,
   au-dessus d'une pastille RF que le trou métallisé du point de test PTST401
   reliait à l'antenne : une heure trois quarts de calcul pour un S₁₁ plat à
   0 dB, et rien, dans la courbe, pour le dire. « PTST401, broche 1 » dit
   exactement ce qui alimente l'antenne, et tout le reste s'en déduit :

     — la COUCHE, celle où le cuivre de l'antenne quitte la pastille ;
     — la MASSE, cherchée sur la même couche autour de la pastille — les
       broches de masse du connecteur, le bord du plan — et le port posé EN
       TRAVERS de cet écart, dans le plan, exactement là où la sonde de mesure
       pose son âme et sa gaine ;
     — ce que le port REMPLACE : la broche est l'endroit où l'onde entre, et
       ce qui la prolonge vers les couches internes — son trou métallisé, ses
       pastilles sur les autres couches — mène au circuit radio, qui n'est pas
       dans le modèle. Le garder, c'est garder un tronçon qui pend sous la
       source, et sur cette carte, le chemin même du court-circuit.

   LE CLIC RESTE. Poser le port à la main sur la carte est toujours possible,
   et tout port, cliqué ou accroché, passe par le même VERDICT : ce que touche
   chacune de ses deux bornes dans le cuivre qui part au solveur. C'est le
   contrôle qui manquait — le serveur voit déjà le cuivre dessiné sous le port
   (`_avis_ports_court_circuit`) et les écarts que la grille referme
   (`_ponts_de_maille`) ; la page voit, elle, la carte entière, et le dit
   pendant qu'on pose.
   ============================================================================= */

/* La broche choisie dans le panneau, avant qu'on ne la pose. Ce n'est pas de
   l'état du document : rien ne change tant qu'on n'a pas cliqué « Poser ». */
const ANT_BROCHE_CHOIX={ref:"", num:""};

/* Jusqu'où chercher la masse autour de la pastille, en millimètres. Au-delà,
   ce n'est plus la masse du connecteur mais celle de la carte, et un port de
   3 mm de long n'est plus une source localisée. */
const ANT_BROCHE_PORTEE_MM=3;
const ANT_BROCHE_PAS_MM=0.005;

function antKmm(){ return V.unite==="in" ? 1/25.4 : 1; }

/* --------------------------------------------------------------------------
   Retrouver une broche
   -------------------------------------------------------------------------- */
/* Les pastilles posées d'une broche : une par couche où son padstack en met.
   DEUX FORMES DANS LES FICHIERS, et il faut lire les deux. Une empreinte de
   bibliothèque porte ses pastilles (`hote` renseigné, `pin` = « 1 ») ; un
   padstack posé à même la carte — celui du point de test PTST401 — est une
   pastille LIBRE, et son seul lien au composant est `pin` = « PTST401.1 ». */
/* ET LES JUMELLES SANS NOM. Le même padstack sort souvent deux fois de
   l'export : une pastille nommée par sa broche, et une copie anonyme au même
   endroit, sur le même net — celle du trou. Sur P01x274PCB-C.xml, chaque
   couche de PTST401.1 en porte deux ; ne retirer que la nommée laissait la
   copie sur les couches internes, à 0,21 mm de la masse. */
function antBrochePads(ref,num){
  const cle=ref+"."+num, out=[];
  for(const c of V.couches){
    if(!c.cuivre)continue;
    for(const q of c.pads){
      const p=String(q.pad.pin||"");
      if(q.hote ? (q.hote.ref===ref&&(p===num||p===cle)) : p===cle)out.push(q);
    }
  }
  const tol=1e-6;
  for(const c of V.couches){
    if(!c.cuivre)continue;
    for(const q of c.pads){
      if(q.pad.pin||out.indexOf(q)>=0)continue;
      if(out.some(o=>Math.abs(o.x-q.x)<tol&&Math.abs(o.y-q.y)<tol&&
                     o.pad.n===q.pad.n))out.push(q);
    }
  }
  return out;
}

/* Une broche : où elle est, sur quel net, avec quelles pastilles. */
function antBroche(ref,num){
  const comp=V.parRef&&V.parRef.get(ref);
  if(!comp)return null;
  const pads=antBrochePads(ref,num);
  const def=(comp.pins||[]).find(b=>String(b.num)===String(num));
  let x,y,net;
  if(pads.length){
    x=pads[0].x; y=pads[0].y;
    net=pads[0].pad.n;
  }else if(def){
    const w=mdlPlacer(def.x,def.y,comp.x,comp.y,comp.r,!!comp.m);
    x=w.x; y=w.y;
  }else return null;
  if(net==null&&def)net=def.n;
  return {ref:ref, num:String(num), comp:comp, x:x, y:y,
          net:(net==null?-1:net), pads:pads, trou:mdlTrouEn(x,y)};
}

/* Les broches d'un composant, pour la liste : numéro et net. Celles des
   empreintes d'abord ; à défaut, celles que ses pastilles libres nomment. */
function antBrochesDe(ref){
  const comp=V.parRef&&V.parRef.get(ref);
  if(!comp)return [];
  const vus=new Map();
  for(const b of (comp.pins||[]))vus.set(String(b.num),b.n==null?-1:b.n);
  if(!vus.size)
    for(const c of V.couches)
      for(const q of c.pads){
        const p=String(q.pad.pin||"");
        if(p.startsWith(ref+".")){
          const num=p.slice(ref.length+1);
          if(!vus.has(num))vus.set(num,q.pad.n==null?-1:q.pad.n);
        }
      }
  return Array.from(vus,([num,n])=>({num:num,net:n}))
    .sort((a,b)=>String(a.num).localeCompare(String(b.num),undefined,{numeric:true}));
}

/* Les composants, ceux qui touchent l'antenne en tête : c'est parmi eux que
   se trouve presque toujours le point d'alimentation — le connecteur, le
   point de test, la puce d'antenne. */
function antBrocheComposants(){
  const comps=(V.modele&&V.modele.composants)||[];
  const touche=function(c){
    return (c.pins||[]).some(b=>b.n!=null&&ANT.nets.has(b.n));
  };
  return comps.map(c=>({ref:c.ref, antenne:touche(c)}))
    .sort((a,b)=>(b.antenne-a.antenne)||
      a.ref.localeCompare(b.ref,undefined,{numeric:true}));
}

/* --------------------------------------------------------------------------
   Ce que le solveur verra en un point
   -------------------------------------------------------------------------- */
/* Le cuivre RETENU en (x, y) sur une couche : « antenne », « masse », ou "".
   Il est lu dans ce qui part au solveur (`antCuivreDuModele`), pas dans la
   carte : une piste que la sélection laisse dehors est de l'air pour openEMS,
   et un port qui s'y appuierait n'aurait rien sous sa borne. */
/* Les boîtes des polygones d'un bloc, gardées à côté de lui : un rayon pose
   la question des milliers de fois, et un plan de masse porte des milliers de
   sommets. Rangées par bloc et non sur lui — le cuivre du modèle est partagé,
   on n'y écrit pas (voir `antCuivreDuModele`). */
const ANT_BOITES_BLOC=new WeakMap();
function antBoitesBloc(b){
  let t=ANT_BOITES_BLOC.get(b);
  if(t)return t;
  t=b.polys.map(function(p){
    let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
    for(let i=0;i+1<p.o.length;i+=2){
      if(p.o[i]<x1)x1=p.o[i]; if(p.o[i]>x2)x2=p.o[i];
      if(p.o[i+1]<y1)y1=p.o[i+1]; if(p.o[i+1]>y2)y2=p.o[i+1];
    }
    return {x1:x1,y1:y1,x2:x2,y2:y2,p:p};
  });
  ANT_BOITES_BLOC.set(b,t);
  return t;
}

function antCuivreRetenuEn(nomCouche,x,y){
  const cu=antCuivreDuModele();
  const b=cu.blocs.find(k=>k.couche===nomCouche);
  if(!b)return "";
  let vu="";
  for(const e of antBoitesBloc(b)){
    if(x<e.x1||x>e.x2||y<e.y1||y>e.y2)continue;
    const p=e.p;
    if(!mdlDansPoly(p.o,x,y))continue;
    if((p.t||[]).some(t=>mdlDansPoly(t,x,y)))continue;
    if(!p.m)return "antenne";
    vu="masse";
  }
  return vu;
}

/* Le via retenu qui passe en (x, y), s'il y en a un. */
function antViaRetenuEn(x,y){
  const cu=antCuivreDuModele();
  return cu.vias.find(v=>Math.hypot(v.x-x,v.y-y)<=v.d/2)||null;
}

/* --------------------------------------------------------------------------
   Ce qu'un port posé sur une broche remplace
   -------------------------------------------------------------------------- */
/* Les pastilles et les perçages que les ports accrochés à une broche
   retirent du modèle, et les pastilles qu'ils y FORCENT.

   Retirés : le trou métallisé de la broche et ses pastilles sur les autres
   couches. Forcée : sa pastille sur la couche du port, même quand la case
   « pastilles » est décochée — c'est sur elle que la borne du port s'appuie,
   et sans elle le port toucherait le vide.

   Appelée par `antCuivreCalcul` (11-geometrie.js), donc sous son cache : ce
   qu'elle rend ne change qu'avec l'état, qu'on vieillit à chaque pose. */
/* ET LA PISTE QUI REPART VERS LA RADIO. Sur les autres couches, le cuivre du
   net qui part de la broche mène au circuit que le port remplace ; privé du
   trou métallisé, il ne tient plus à rien, et il flotte à côté de la masse.
   Sur P01x274PCB-C.xml c'était la piste de Conductor-1, à 0,14 mm de son
   plan : le maillage la soudait — sans conséquence pour l'alimentation —,
   mais l'ouvrir coûtait une cellule de 0,05 mm, donc un pas de temps divisé
   par deux pour tout le calcul, pour un morceau de cuivre qui ne sert à
   rien. On la retire : la piste qui touche la pastille, et toute la chaîne
   de pistes qui la continue sur la même couche. */
function antBrochesRemplacees(){
  const out={pads:new Set(), trous:new Set(), forces:[], pistes:new Set()};
  if(!V.modele||!ANT.ports)return out;
  for(const p of ANT.ports){
    if(!p.pose||!p.broche)continue;
    const b=antBroche(p.broche.ref,p.broche.num);
    if(!b)continue;
    for(const q of b.pads){
      const couche=V.couches[q.c];
      const nom=couche?couche.nom:"";
      if(nom===p.de){out.forces.push(q); continue;}
      out.pads.add(q);
      if(!couche||b.net<0)continue;
      const r=Math.max((q.d||0)/2,1e-6);
      for(const t of couche.pistes){
        if(t.n!==b.net||out.pistes.has(t))continue;
        let touche=false;
        for(let i=0;i+3<t.p.length&&!touche;i+=2)
          touche=antDistSeg(q.x,q.y,t.p[i],t.p[i+1],t.p[i+2],t.p[i+3])<=r+(t.w||0)/2;
        if(touche)for(const u of mdlChainePistesMemeCouche(t))out.pistes.add(u);
      }
    }
    if(b.trou)out.trous.add(mdlCleXY(b.trou.x,b.trou.y));
  }
  return out;
}

/* --------------------------------------------------------------------------
   Poser le port sur une broche
   -------------------------------------------------------------------------- */
/* La couche du port : celle où le cuivre de l'antenne QUITTE la pastille, et
   s'il la quitte sur plusieurs couches, celle où il va LE PLUS LOIN.

   LE NET NE SUFFIT PAS À DIRE OÙ EST L'ANTENNE. Un point de test RF est posé
   ENTRE la radio et l'antenne : sur P01x274PCB-C.xml, le net RF_SIGN00480
   porte à la fois la piste de 2 mm qui repart vers la radio, sur Conductor-1,
   et le brin de 50 mm qui rayonne, sur Conductor-4. Les deux quittent la
   pastille ; c'est le brin qu'il faut alimenter. On regarde donc juste
   au-delà du bord — un anneau de points à 115 % du contour — quels morceaux
   de l'antenne y passent, et l'on retient la couche du plus grand. */
function antBrocheCouche(b){
  let meilleur=null, score=-1;
  for(const q of b.pads){
    const couche=V.couches[q.c];
    if(!couche||!ANT.couches.has(q.c))continue;
    const bloc=antCuivreDuModele().blocs.find(k=>k.couche===couche.nom);
    if(!bloc)continue;
    const poly=antPadEnPoly(q)||antBrocheRond(q);
    let n=0;
    for(let i=0;i+1<poly.length;i+=2){
      const x=q.x+(poly[i]-q.x)*1.15, y=q.y+(poly[i+1]-q.y)*1.15;
      for(const e of antBoitesBloc(bloc)){
        if(e.p.m||x<e.x1||x>e.x2||y<e.y1||y>e.y2)continue;
        if(!mdlDansPoly(e.p.o,x,y))continue;
        n=Math.max(n,Math.hypot(e.x2-e.x1,e.y2-e.y1));
      }
    }
    /* À étendue égale, la couche du composant : c'est là qu'est son corps. */
    if(n>score||(n===score&&b.comp&&q.c===b.comp.c)){score=n;meilleur=q;}
  }
  return meilleur;
}

function antBrocheRond(q){
  const r=Math.max((q.d||0)/2,1e-6), out=[];
  for(let k=0;k<24;k++){
    const a=2*Math.PI*k/24;
    out.push(q.x+r*Math.cos(a), q.y+r*Math.sin(a));
  }
  return out;
}

/* La masse la plus proche de la pastille, sur sa couche, par quatre rayons
   dans les axes de la grille. DANS LES AXES, parce qu'un port localisé dans
   le plan est une arête de la grille : en biais, il n'existe pas.

   Chaque rayon part du centre, traverse la pastille — et le cuivre de
   l'antenne qui la prolonge —, puis compte le vide jusqu'au premier cuivre.
   Il ne vaut que si ce premier cuivre est de la masse ; ailleurs, c'est
   l'antenne qui continue, ou un autre morceau d'elle. */
function antBrocheRayons(q,nomCouche){
  const k=antKmm();
  const pas=ANT_BROCHE_PAS_MM*k, loin=ANT_BROCHE_PORTEE_MM*k;
  const poly=antPadEnPoly(q)||antBrocheRond(q);
  const out=[];
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    let t=0, sortie=null, masse=null;
    for(;t<=loin;t+=pas){
      const x=q.x+dx*t, y=q.y+dy*t;
      const ici=mdlDansPoly(poly,x,y)?"antenne":antCuivreRetenuEn(nomCouche,x,y);
      if(sortie==null){
        if(ici==="antenne")continue;             // encore la pastille, ou sa piste
        if(ici==="masse")break;                  // la masse la touche : pas d'écart
        sortie=t;
      }else if(ici){
        if(ici==="masse")masse=t;
        break;
      }
    }
    if(sortie!=null&&masse!=null&&masse>sortie)
      out.push({dx:dx, dy:dy, t0:sortie, t1:masse, ecart:masse-sortie});
  }
  return out.sort((a,b)=>a.ecart-b.ecart);
}

/* Pose le port courant sur la broche. Rend un texte d'explication, ou lève
   une erreur qui dit pourquoi ce n'est pas possible. */
function antPortSurBroche(ref,num){
  const b=antBroche(ref,num);
  if(!b)throw new Error("« "+ref+" », broche « "+num+" » : introuvable sur la carte.");
  const nomNet=(V.parNet[b.net]||{}).nom||"sans net";
  if(b.net>=0&&b.net===ANT.netMasse)
    throw new Error("La broche "+ref+"."+num+" est sur le net de masse « "+nomNet+
      " » : un port s'appuie sur la broche qui porte le SIGNAL, et va chercher "+
      "la masse lui-même.");
  /* Le net de la broche est l'antenne : s'il n'est pas encore retenu, le
     désigner est ce que le geste veut dire — comme le fait le clic du port
     (`antAntenneSousPort`, 15-overlay2d.js). */
  if(b.net>=0&&!ANT.nets.has(b.net)&&!antNetFourreTout(b.net)){
    ANT.nets.add(b.net);
    antVieillir();
  }
  if(!b.pads.length)
    throw new Error("La broche "+ref+"."+num+" n'a aucune pastille de cuivre "+
      "dans le fichier : rien sur quoi poser une borne.");
  const q=antBrocheCouche(b);
  if(!q)throw new Error("Aucune pastille de "+ref+"."+num+" n'est sur une "+
    "couche cochée à l'étape « L'empilage ».");
  const couche=V.couches[q.c].nom;

  const p=ANT.port;
  p.type="localise";
  p.broche={ref:ref, num:String(num)};
  p.de=couche;
  p.a=antMasseSous(couche)||p.a;
  p.pose=true;
  antVieillir();

  /* D'ABORD DANS LE PLAN : la masse du connecteur est à côté de sa broche,
     sur la même couche, et c'est entre les deux que la sonde de mesure pose
     son âme et sa gaine. */
  const rayons=antBrocheRayons(q,couche);
  const r=rayons[0];
  if(r){
    const tm=(r.t0+r.t1)/2;
    p.dir=r.dx?"x":"y";
    p.x=+(q.x+r.dx*tm).toFixed(4);
    p.y=+(q.y+r.dy*tm).toFixed(4);
    p.ecart=+r.ecart.toFixed(4);
    p.w=p.ecart; p.l=p.ecart;
    return "Port posé sur "+ref+"."+num+" (« "+nomNet+" »), dans le plan de « "+
      couche+" » : en travers des "+aL(r.ecart)+" qui séparent la pastille de "+
      "la masse, vers "+(r.dx>0?"+x":r.dx<0?"−x":r.dy>0?"+y":"−y")+
      ". Le trou métallisé, les pastilles des autres couches et les pistes "+
      "qui en repartent sont retirés du modèle : ils menaient au circuit "+
      "radio, que le port remplace.";
  }
  /* SINON, À LA VERTICALE, si la couche de masse passe bien sous la
     pastille. Au milieu d'une réserve, la borne du bas ne toucherait rien. */
  if(antCuivreRetenuEn(p.a,q.x,q.y)==="masse"){
    p.dir="z";
    p.x=+q.x.toFixed(4); p.y=+q.y.toFixed(4);
    p.w=+(q.d||0.5).toFixed(4); p.l=p.w;
    return "Aucune masse à moins de "+aNb(ANT_BROCHE_PORTEE_MM,0)+" mm sur « "+
      couche+" » : port vertical sous la broche, de « "+couche+" » vers « "+
      p.a+" », dont le plan passe sous la pastille.";
  }
  p.pose=false;
  p.broche=null;
  throw new Error("Aucune masse retenue à moins de "+aNb(ANT_BROCHE_PORTEE_MM,0)+
    " mm de la pastille sur « "+couche+" », et « "+p.a+"» est dégagée sous "+
    "elle : le port n'aurait rien contre quoi s'appuyer. Vérifiez que le net "+
    "de masse est choisi à l'étape « Le cuivre », ou posez le port à la main.");
}

/* Le port reste-t-il accroché à sa broche ? Le déplacer à la main — un clic,
   une cote saisie — le décroche : il n'est plus sur la broche, et continuer
   de retirer son trou métallisé serait retirer du cuivre à un endroit que
   plus rien ne justifie. */
function antPortDecrocher(p){
  if(p&&p.broche){p.broche=null; antVieillir();}
}

/* --------------------------------------------------------------------------
   Le verdict : ce que touche chaque borne
   -------------------------------------------------------------------------- */
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
  const k=antKmm(), d=0.01*k;
  const nom=function(n){ return n==="antenne"?"l'antenne":n==="masse"?"la masse":"rien"; };

  if(p.dir==="x"||p.dir==="y"){
    const e=(p.ecart>0?p.ecart:0.2*k)/2;
    const ux=p.dir==="x"?1:0, uy=p.dir==="y"?1:0;
    const b1=antCuivreRetenuEn(p.de,p.x-ux*(e+d),p.y-uy*(e+d));
    const b2=antCuivreRetenuEn(p.de,p.x+ux*(e+d),p.y+uy*(e+d));
    const milieu=antCuivreRetenuEn(p.de,p.x,p.y);
    if(milieu)
      out.push({ok:false,t:"Le milieu du port est sur du cuivre ("+nom(milieu)+
        ") : un port dans le plan enjambe un ÉCART, et celui-ci est court-"+
        "circuité par le métal qu'il traverse."});
    const paire=[b1,b2].sort().join("|");
    if(paire==="antenne|masse")
      out.push({ok:true,t:"Une borne sur l'antenne, l'autre sur la masse, "+
        "sur « "+p.de+" », à "+aL(2*e)+" l'une de l'autre."});
    else if(b1===b2&&b1)
      out.push({ok:false,t:"Les deux bornes touchent "+nom(b1)+" : le port "+
        "relie ce cuivre à lui-même, il ne mesurera rien."});
    else
      out.push({ok:false,t:"Une borne touche "+nom(b1)+", l'autre "+nom(b2)+
        " : un port dont une borne est dans le vide est un circuit ouvert."});
    return out;
  }

  const haut=antCuivreRetenuEn(p.de,p.x,p.y);
  const bas=antCuivreRetenuEn(p.a,p.x,p.y);
  out.push({ok:haut==="antenne",
    t:"Borne « "+p.de+" » : "+(haut==="antenne"?"sur l'antenne."
      :haut==="masse"?"sur la MASSE — le port y part du mauvais cuivre."
      :"dans le vide — aucun cuivre retenu sous le port.")});
  out.push({ok:bas==="masse",
    t:"Borne « "+p.a+" » : "+(bas==="masse"?"sur la masse."
      :bas==="antenne"?"sur du cuivre de l'ANTENNE — le port est court-"+
        "circuité par ce cuivre."
      :"dans le vide — une réserve, un dégagement : le port est ouvert. "+
        "Un port vertical demande la masse JUSTE sous lui.")});
  const v=antViaRetenuEn(p.x,p.y);
  if(v)
    out.push({ok:false,t:"Le port est posé sur un trou métallisé ("+aL(v.d)+
      ", de « "+v.de+" » à « "+v.a+" ») : le métal du via double le port "+
      "et le court-circuite."});
  return out;
}

/* La broche sous le port, s'il en est une et qu'il n'y est pas accroché :
   l'accrocher est alors l'affaire d'un clic. */
function antBrocheSousPort(p){
  if(!p||!p.pose||p.broche)return null;
  for(const c of V.couches){
    if(!c.cuivre||c.nom!==p.de)continue;
    for(const q of c.pads){
      const poly=antPadEnPoly(q)||antBrocheRond(q);
      if(!mdlDansPoly(poly,p.x,p.y))continue;
      const pin=String(q.pad.pin||"");
      if(q.hote)return {ref:q.hote.ref, num:pin.split(".").pop()};
      const i=pin.lastIndexOf(".");
      if(i>0)return {ref:pin.slice(0,i), num:pin.slice(i+1)};
    }
  }
  return null;
}

/* --------------------------------------------------------------------------
   Le panneau
   -------------------------------------------------------------------------- */
function antPortBrocheHtml(){
  const p=ANT.port;
  if(p.broche&&!ANT_BROCHE_CHOIX.ref){
    ANT_BROCHE_CHOIX.ref=p.broche.ref; ANT_BROCHE_CHOIX.num=p.broche.num;
  }
  const comps=antBrocheComposants();
  const ref=ANT_BROCHE_CHOIX.ref;
  const broches=ref?antBrochesDe(ref):[];
  if(ref&&broches.length&&!broches.some(b=>b.num===ANT_BROCHE_CHOIX.num)){
    /* La broche proposée par défaut : celle qui est sur l'antenne. */
    const sur=broches.find(b=>ANT.nets.has(b.net))||
              broches.find(b=>b.net>=0&&b.net!==ANT.netMasse)||broches[0];
    ANT_BROCHE_CHOIX.num=sur.num;
  }
  const netNom=n=>(n>=0&&V.parNet[n])?V.parNet[n].nom:"sans net";
  return `
<div class="champ">
  <label>Sur une broche de composant
    <small>Le connecteur, le point de test, la puce d'antenne : nommez la
    broche qui porte le signal. L'assistant en tire la couche, cherche la
    masse à côté d'elle et pose le port <b>en travers de l'écart</b> ; il
    retire du modèle le trou métallisé de la broche et les pistes qui en
    repartent sur les autres couches, qui menaient au circuit radio que le
    port remplace.</small></label>
</div>
<div class="champ ligne">
  <span><label>Composant</label><input type="text" list="antPrefListe" spellcheck="false"
    id="antPref" value="${aEsc(ref)}" placeholder="ex. J1, PTST401"></span>
  <span><label>Broche</label><select id="antPpin"${broches.length?"":" disabled"}>
    ${broches.map(b=>'<option value="'+aEsc(b.num)+'"'+
      (b.num===ANT_BROCHE_CHOIX.num?" selected":"")+'>'+aEsc(b.num)+" — "+
      aEsc(netNom(b.net))+(ANT.nets.has(b.net)?" ◆":"")+
      (b.net===ANT.netMasse&&b.net>=0?" (masse)":"")+'</option>').join("")}
  </select></span>
</div>
<datalist id="antPrefListe">${comps.map(c=>'<option value="'+aEsc(c.ref)+'">'+
  (c.antenne?"touche l'antenne":"")+'</option>').join("")}</datalist>
<div class="champ">
  <button class="tb" id="bPortBroche"${broches.length?"":" disabled"}>⌖ Poser sur ${ref&&ANT_BROCHE_CHOIX.num?aEsc(ref+"."+ANT_BROCHE_CHOIX.num):"la broche"}</button>
  ${p.broche?'<span class="note"> accroché à <b>'+aEsc(p.broche.ref+"."+p.broche.num)+'</b></span>':""}
</div>`;
}

/* Le verdict, sous les cotes : ce que touche chaque borne. */
function antPortVerdictHtml(){
  const p=ANT.port;
  const v=antPortVerdict(p);
  const sous=antBrocheSousPort(p);
  if(!v.length&&!sous)return "";
  return '<div class="avis">'+v.map(d=>
    '<div class="av '+(d.ok===false?"grave":d.ok?"info":"attention")+'"><span>'+
    (d.ok===false?"✗ ":d.ok?"✓ ":"")+aEsc(d.t)+'</span></div>').join("")+
    (sous?'<div class="av attention"><span>Le port est sur la broche <b>'+
      aEsc(sous.ref+"."+sous.num)+'</b> sans y être accroché. <button class="tb mini" '+
      'id="bPortAccrocher" data-ref="'+aEsc(sous.ref)+'" data-num="'+aEsc(sous.num)+
      '">Accrocher à '+aEsc(sous.ref+"."+sous.num)+'</button></span></div>':"")+
    '</div>';
}

function antPortBrocheLier(box){
  const poser=function(ref,num){
    try{
      const t=antPortSurBroche(ref,num);
      if(typeof wsHint==="function")wsHint(t);
    }catch(e){
      if(typeof wsHint==="function")wsHint(e.message);
      else alert(e.message);
    }
    ANT.posePort=false;
    document.body.classList.remove("pose-port");
    antMaj(true);
    antAssistantRendre(true);
  };
  const ref=box.querySelector("#antPref");
  if(ref)ref.onchange=function(){
    ANT_BROCHE_CHOIX.ref=this.value.trim();
    ANT_BROCHE_CHOIX.num="";
    antAssistantRendre(true);
  };
  const pin=box.querySelector("#antPpin");
  if(pin)pin.onchange=function(){
    ANT_BROCHE_CHOIX.num=this.value;
    antAssistantRendre(true);
  };
  const b=box.querySelector("#bPortBroche");
  if(b)b.onclick=function(){
    if(ANT_BROCHE_CHOIX.ref&&ANT_BROCHE_CHOIX.num)
      poser(ANT_BROCHE_CHOIX.ref,ANT_BROCHE_CHOIX.num);
  };
  const acc=box.querySelector("#bPortAccrocher");
  if(acc)acc.onclick=function(){
    ANT_BROCHE_CHOIX.ref=this.dataset.ref; ANT_BROCHE_CHOIX.num=this.dataset.num;
    poser(this.dataset.ref,this.dataset.num);
  };
}
