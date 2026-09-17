"use strict";
/* =============================================================================
   Antenne openEMS — 22-antennes.js
   Le catalogue des motifs d'antenne imprimée : une fréquence, l'empilage et
   quelques cotes donnent un dessin complet, port compris.

   CE QUE CES FORMULES SONT, ET SURTOUT CE QU'ELLES NE SONT PAS. Ce sont les
   modèles de ligne de transmission — Hammerstad pour le microruban, le modèle
   de cavité de Balanis pour le patch. Ils ignorent tout ce qui fait la
   différence entre un calcul et une antenne : l'épaisseur du cuivre, le bord
   de la carte, le couplage entre la ligne et le patch, la masse qui n'est pas
   infinie, le connecteur. Leur écart honnête est de **2 à 5 %** sur la
   résonance, davantage sur un substrat épais ou un εr élevé.

   Cinq pour cent à 2,45 GHz, c'est 120 MHz — la largeur de toute la bande
   ISM. Un motif n'est donc PAS une antenne finie : c'est un point de départ
   qui tombe assez près pour que la première simulation soit exploitable, et
   qu'on corrige ensuite à la cote.

   POURQUOI LA GÉOMÉTRIE EST SÉPARÉE DE SA POSE. Chaque motif se décrit ici en
   deux temps : `defauts()` rend les cotes que le calcul propose, `tracer()`
   rend les formes et le port QUE CES COTES DONNENT — sans rien écrire dans le
   dessin. C'est ce qui permet au panneau d'AFFICHER un motif avant de le
   poser, et de le réafficher à chaque cote qu'on retouche. Un aperçu qui
   redessinerait la carte pour se montrer effacerait le travail en cours à
   chaque frappe ; un aperçu qui redessinerait autrement que la pose mentirait.
   Ici les deux lisent le même `tracer()`, donc ce qu'on voit est ce qu'on aura.

   LE SOLVEUR RESTE L'ARBITRE. Rien de ce qui est calculé ici n'entre dans le
   modèle FDTD autrement que comme des coordonnées de cuivre. openEMS ne sait
   pas qu'il simule un « patch » ; il simule le métal qu'on lui donne.
   ============================================================================= */

/* La vitesse de la lumière en mm/s : toutes les longueurs de ce fichier sont
   en millimètres, comme le dessin. */
const CON_C0=2.99792458e11;

/* ==========================================================================
   Le substrat vu par les formules
   --------------------------------------------------------------------------
   C'est le diélectrique entre la PREMIÈRE couche de cuivre et la SUIVANTE :
   une antenne imprimée travaille contre le plan qui est juste en dessous
   d'elle, pas contre le dessous de la carte. Sur un empilage à quatre
   couches, prendre l'épaisseur totale donnerait un patch deux fois trop
   court.
   ========================================================================== */
function conSubstrat(){
  const cu=conCuivres();
  if(cu.length<2)return {h:1.6, er:4.3, df:0.02, complet:false};
  let h=0,s=0,sdf=0;
  for(let i=cu[0].i+1;i<cu[1].i;i++){
    const e=CON.pile[i];
    if(e.k!=="die")continue;
    h+=e.ep; s+=e.ep*(e.er||1); sdf+=e.ep*(e.df||0);
  }
  if(!(h>0))return {h:1.6, er:4.3, df:0.02, complet:false};
  return {h:h, er:s/h, df:sdf/h, complet:true};
}

/* ==========================================================================
   Microruban : synthèse et analyse (Hammerstad-Jensen, forme usuelle)
   ========================================================================== */
/* La largeur qui donne Z0 sur ce substrat. Les deux branches de la formule
   se recouvrent : on prend celle qui est valable dans le domaine où tombe le
   résultat, ce qui est la façon dont la synthèse est écrite. */
function conLargeurMicroruban(Z0,er,h){
  const A=Z0/60*Math.sqrt((er+1)/2)+(er-1)/(er+1)*(0.23+0.11/er);
  let wh=8*Math.exp(A)/(Math.exp(2*A)-2);
  if(!(wh>0)||wh>2){
    const B=377*Math.PI/(2*Z0*Math.sqrt(er));
    wh=2/Math.PI*(B-1-Math.log(2*B-1)+
        (er-1)/(2*er)*(Math.log(B-1)+0.39-0.61/er));
  }
  return Math.max(0.05,+(wh*h).toFixed(3));
}

/* La permittivité effective : une partie du champ passe dans l'air, la ligne
   est donc plus rapide que le substrat ne le laisserait croire. */
function conEeff(er,h,w){
  return (er+1)/2+(er-1)/2*Math.pow(1+12*h/Math.max(w,1e-6),-0.5);
}

/* L'impédance d'une largeur donnée : elle sert à DIRE ce que la ligne fait
   vraiment, une fois la largeur arrondie à une cote dessinable. Une synthèse
   qui ne se relit pas est une synthèse qu'on croit sur parole. */
function conZ0Microruban(er,h,w){
  const ee=conEeff(er,h,w), u=w/h;
  return (u<=1)
    ? 60/Math.sqrt(ee)*Math.log(8/u+u/4)
    : 120*Math.PI/(Math.sqrt(ee)*(u+1.393+0.667*Math.log(u+1.444)));
}

/* ==========================================================================
   Le contexte de calcul
   --------------------------------------------------------------------------
   Ce que TOUS les motifs lisent avant de calculer quoi que ce soit : la
   fréquence visée, le substrat, et la largeur de ligne 50 Ω qui en découle.
   Il est refait à chaque appel plutôt que retenu : changer une permittivité
   dans l'empilage doit changer le dessin proposé à la frappe suivante.
   ========================================================================== */
function conContexte(){
  const s=conSubstrat();
  return {
    f:CON.fcible, s:s, er:s.er, h:s.h, df:s.df,
    wf:conLargeurMicroruban(50,s.er,s.h),
    /* Le brin d'une antenne qui sort du plan de masse a la moitié de son
       champ dans l'air : (εr+1)/2 est l'approximation d'usage, et elle vaut
       pour le monopôle, l'IFA, le MIFA et le dipôle. */
    eeffAir:(s.er+1)/2
  };
}

/* ==========================================================================
   Les formes, écrites sans savoir sur quelle couche elles iront
   --------------------------------------------------------------------------
   « haut » et « bas » désignent la première et la seconde couche de cuivre.
   La traduction en `uid` se fait à la pose : un motif calculé pour un aperçu
   n'a pas à connaître l'empilage courant, et un motif posé ne doit pas
   inventer une couche qui n'existe pas.
   ========================================================================== */
function gRect(cu,net,x1,y1,x2,y2,trou){
  return {type:"rect", cu:cu, net:trou?"":net, trou:!!trou,
          x1:x1, y1:y1, x2:x2, y2:y2};
}
function gPiste(cu,net,pts,w){
  return {type:"piste", cu:cu, net:net, trou:false,
          pts:pts.map(q=>q.slice()), w:w};
}
function gVia(net,x,y,d){
  return {type:"via", cu:"haut", net:net, trou:false, x:x, y:y, d:d};
}
/* Une cote de l'aperçu : deux points, un décalage perpendiculaire en
   millimètres (positif = vers la droite ou vers le haut), et le nom de la
   grandeur. `id` est celui du champ de saisie — c'est ce qui permet au
   panneau d'allumer la cote du champ qu'on est en train de régler. */
function gCote(id,x1,y1,x2,y2,dec,t,sec){
  return {id:id, x1:x1, y1:y1, x2:x2, y2:y2, dec:dec||0, t:t, sec:!!sec};
}
/* Un REPÈRE, pour les longueurs qu'une ligne de cote ne saurait porter : la
   largeur d'une piste, la largeur d'une encoche, le diamètre d'un via. À
   l'échelle du dessin, ces cotes-là font deux pixels — la ligne, ses deux
   tirets et son étiquette ne tiendraient pas. Un trait part donc du détail et
   va poser son nom là où il reste de la place, comme sur un plan.

   `x,y` : le point désigné. `tx,ty` : où l'étiquette se pose. Un repère est
   secondaire par défaut : c'est une largeur, pas la cote qui fait résonner. */
function gRepere(id,x,y,tx,ty,t,sec){
  return {id:id, rep:true, x1:x, y1:y, x2:tx, y2:ty, dec:0, t:t,
          sec:(sec===undefined)?true:!!sec};
}

/* ==========================================================================
   Le symbole d'une cote : la MÊME lettre sur le dessin et sur le champ
   --------------------------------------------------------------------------
   Sans elle, il faut lire « longueur du bras » dans la liste et deviner que
   c'est le « La » du dessin. Le symbole est donné par l'identifiant du champ
   plutôt que répété dans chaque motif, et c'est voulu : la même lettre désigne
   la même grandeur d'un motif à l'autre — `wf` est toujours la largeur du brin
   d'alimentation, `Lg` toujours le plan de masse. Un motif qui aurait besoin
   d'une lettre à lui pose `sym` sur son champ.
   ========================================================================== */
const CON_SYMBOLES={
  L:"L", W:"W", y0:"y₀", g:"g", Lf:"Lf", marge:"m",
  Lm:"Lm", wr:"wr", Lg:"Lg", Lb:"Lb", wf:"wf",
  La:"La", ha:"ha", wb:"wb", d:"d", sc:"sc", dVia:"⌀via",
  Lx:"Lx", n:"n", wd:"wd", ov:"ov", Ll:"ℓ"
};
function conSymbole(ch){
  return ch.sym||CON_SYMBOLES[ch.id]||ch.id;
}

/* ==========================================================================
   1. Le patch rectangulaire, alimenté par une ligne encastrée
   --------------------------------------------------------------------------
   C'est l'antenne imprimée de référence, et c'est aussi celle dont le calcul
   à la main est le plus sûr : modèle de cavité, deux fentes rayonnantes, une
   longueur qui vaut une demi-longueur d'onde dans le substrat moins
   l'allongement des bords.

   L'ENCASTREMENT N'EST PAS UN ORNEMENT. Le bord d'un patch présente 150 à
   250 Ω : y brancher une ligne 50 Ω rend un S11 de −3 dB, c'est-à-dire une
   antenne qui renvoie la moitié de ce qu'on lui donne. On entre donc la ligne
   DANS le patch, à la profondeur où l'impédance vaut 50 Ω — elle varie en
   cos²(π·y/L), ce qui est la seule chose qu'il faut retenir.
   ========================================================================== */
const CON_MOTIF_PATCH={
  id:"patch", nom:"Patch rectangulaire", role:"gnd",
  aide:"l'antenne imprimée de référence, ligne encastrée à 50 Ω",
  besoin:"Il faut au moins deux couches de cuivre : un patch rayonne CONTRE "+
         "un plan de masse.",
  champs:[
    {id:"L",  nom:"longueur du patch",
     aide:"c'est elle qui fixe la résonance : λ/2 dans le substrat, moins "+
          "l'allongement des bords"},
    {id:"W",  nom:"largeur du patch",
     aide:"elle décide du rendement et de l'impédance de bord, peu de la "+
          "fréquence"},
    {id:"y0", nom:"encastrement",
     aide:"la profondeur d'entrée de la ligne dans le patch : c'est le "+
          "réglage d'adaptation, et la cote la moins sûre du motif. Mesuré "+
          "sur FR-4 1,6 mm à 2,45 GHz, il faut l'écourter d'un bon quart : "+
          "le calcul proposait 11,5 mm pour −2,5 dB, 8,5 mm en rend −13. "+
          "Balayez-le"},
    {id:"wf", nom:"largeur de la ligne",
     aide:"synthétisée pour 50 Ω sur ce substrat"},
    {id:"g",  nom:"largeur des encoches",
     aide:"le vide qui isole la ligne du cuivre du patch sur toute la "+
          "profondeur d'encastrement. Elles ajoutent une capacité que le "+
          "modèle de cavité ignore : plus serrées, mieux adapté — 8 dB "+
          "gagnés de 3,5 à 1,5 mm sur le cas mesuré"},
    {id:"Lf", nom:"longueur de ligne",
     aide:"entre le bord de la carte, où est le port, et le patch"},
    {id:"marge", nom:"marge de carte",
     aide:"le substrat et la masse qui dépassent du patch"}
  ],
  defauts:function(c){
    const er=c.er, h=c.h, f=c.f;
    /* La largeur : celle qui donne le meilleur rendement pour ce substrat. */
    const W=CON_C0/(2*f)*Math.sqrt(2/(er+1));
    const ee=conEeff(er,h,W);
    /* L'allongement des bords : le champ déborde du patch, il est donc
       électriquement plus long qu'il n'est dessiné. Deux fois 0,4 mm sur un
       FR-4 de 1,6 mm — soit 2 % de la longueur à 2,45 GHz. */
    const dL=0.412*h*(ee+0.3)*(W/h+0.264)/((ee-0.258)*(W/h+0.8));
    const L=CON_C0/(2*f*Math.sqrt(ee))-2*dL;
    /* L'impédance au bord, par la conductance de fente. */
    const lam0=CON_C0/f;
    const G1=(W/lam0<1)?(1/90)*Math.pow(W/lam0,2):(1/120)*(W/lam0);
    const Rin=1/(2*G1);
    return {
      W:W, L:L,
      y0:(Rin>50)?(L/Math.PI)*Math.acos(Math.sqrt(50/Rin)):0,
      wf:c.wf,
      g:Math.max(c.wf*0.8,0.3),
      Lf:Math.max(6,4*h),
      marge:Math.max(3*h,2)
    };
  },
  tracer:function(c,p){
    const Lb=p.Lf+p.L+p.marge, Wb=p.W+2*p.marge;
    const x0=p.Lf, yb=(Wb-p.W)/2, yc=Wb/2;
    const formes=[
      /* Le plan de masse : toute la carte. Un patch dont la masse s'arrête au
         bord du patch rayonne vers l'arrière et son impédance n'est plus
         celle du calcul. */
      gRect("bas","GND",0,0,Lb,Wb),
      gRect("haut","ANTENNE",x0,yb,x0+p.L,yb+p.W),
      gPiste("haut","ANTENNE",[[0,yc],[x0+p.y0,yc]],p.wf)
    ];
    /* Les deux encoches : elles isolent la ligne du cuivre du patch sur toute
       la profondeur d'encastrement. Sans elles, la ligne touche le bord et
       l'encastrement ne sert à rien. */
    if(p.y0>0.05){
      formes.push(gRect("haut","",x0,yc+p.wf/2,x0+p.y0,yc+p.wf/2+p.g,true));
      formes.push(gRect("haut","",x0,yc-p.wf/2-p.g,x0+p.y0,yc-p.wf/2,true));
    }

    /* Ce que les cotes DESSINÉES donnent, et non ce que le calcul proposait :
       c'est tout l'intérêt d'une cote qu'on retouche à la main. */
    const ee=conEeff(c.er,c.h,p.W);
    const dL=0.412*c.h*(ee+0.3)*(p.W/c.h+0.264)/((ee-0.258)*(p.W/c.h+0.8));
    const festim=CON_C0/(2*(p.L+2*dL)*Math.sqrt(ee));
    const lam0=CON_C0/c.f;
    const G1=(p.W/lam0<1)?(1/90)*Math.pow(p.W/lam0,2):(1/120)*(p.W/lam0);
    const Rin=1/(2*G1);
    const Zin=Rin*Math.pow(Math.cos(Math.PI*p.y0/Math.max(p.L,1e-6)),2);

    return {
      carte:{L:Lb, W:Wb},
      formes:formes,
      port:{x:p.wf/4, y:yc, w:p.wf/2, l:p.wf},
      /* LA LIGNE D'ALIMENTATION, DÉCLARÉE POUR CE QU'ELLE EST. Le port est au
         bord de la carte, le patch commence `Lf` plus loin : l'impédance lue
         au port n'est donc pas celle de l'antenne, elle en est la rotation le
         long de ce ruban. La déclarer permet de la ramener au pied du patch —
         le seul endroit où elle dise quoi corriger SUR l'antenne. Elle
         n'améliore aucune adaptation, et ne le prétend pas. */
      ligne:{d:p.Lf, w:p.wf},
      cotes:[
        gCote("L",x0,0,x0+p.L,0,-2.2,"L"),
        gCote("W",Lb,yb,Lb,yb+p.W,2.2,"W"),
        gCote("y0",x0,yb+p.W,x0+p.y0,yb+p.W,p.marge+2.2,"y₀"),
        gCote("Lf",0,0,x0,0,-2.2,"Lf"),
        gCote("marge",0,0,0,yb,-2.2,"m",true),
        gRepere("wf",x0*0.5,yc+p.wf/2,-4,yc+3,"wf"),
        gRepere("g",x0+Math.max(p.y0,0.6)*0.5,yc+p.wf/2+p.g/2,
                x0+p.L*0.6,Wb+7,"g")
      ],
      calcul:{
        titre:"Patch rectangulaire",
        resume:"L = "+conLong(p.L,2)+", W = "+conLong(p.W,2)+", "+
               "ligne "+conLong(p.wf,2)+" encastrée de "+conLong(p.y0,2),
        festim:festim,
        lignes:[
          ["Substrat", "εr = "+c.er.toFixed(3)+" · tanδ = "+c.df.toFixed(4)+
                       " · h = "+conLong(c.h,3)],
          ["εr effectif", ee.toFixed(3)],
          ["Allongement des bords ΔL", conLong(dL,3)+" (×2)"],
          /* LA RÉSISTANCE DE BORD EST LE TERME LE PLUS FRAGILE DU MOTIF, et
             c'est celui dont dépend l'encastrement. Elle sort du modèle de
             cavité, qui suppose un patch NU : ni la ligne qui entre, ni les
             deux fentes qui l'isolent n'y figurent. Mesurée sur le patch de
             ce gabarit — FR-4 1,6 mm, 2,45 GHz —, elle est surestimée d'un
             facteur trois et demi, et l'encastrement s'en trouve trop
             profond d'un bon quart. On l'affiche donc avec ce qu'elle vaut
             plutôt que de la corriger : un relevé sur un substrat ne fait
             pas une loi, et c'est le balayage qui tranche. */
          ["Impédance au bord", Rin.toFixed(0)+" Ω  (modèle de cavité, "+
                                "surestimé — balayez y₀)"],
          ["Impédance à l'encastrement", Zin.toFixed(1)+" Ω"],
          ["Ligne d'alimentation", conLong(p.wf,3)+" → "+
           conZ0Microruban(c.er,c.h,p.wf).toFixed(1)+" Ω"],
          ["Carte", conLong(Lb,2)+" × "+conLong(Wb,2)]
        ]
      }
    };
  }
};

/* ==========================================================================
   2. Le monopôle imprimé sur masse tronquée
   --------------------------------------------------------------------------
   L'antenne des modules radio : un brin de cuivre au-dessus d'un plan de
   masse qui s'arrête. Elle est large de bande, peu sensible au substrat, et
   sa longueur se calcule au quart d'onde — à ceci près que le champ se
   partage entre l'air et le substrat, d'où un εr effectif proche de
   (εr+1)/2.

   CE QUI LA FAIT MARCHER N'EST PAS LE BRIN, C'EST LA MASSE. Le plan de masse
   tronqué est le second bras du dipôle : sa longueur change la résonance
   autant que celle du brin, et une carte plus courte que ce motif ne rendra
   pas le même résultat. C'est pour cela que la carte entière est dessinée, et
   pas seulement l'antenne.
   ========================================================================== */
const CON_MOTIF_MONOPOLE={
  id:"monopole", nom:"Monopôle imprimé", role:"gnd",
  aide:"un brin quart d'onde sur masse tronquée : l'antenne des modules radio",
  besoin:"Il faut au moins deux couches de cuivre : le monopôle imprimé "+
         "travaille contre une masse tronquée.",
  champs:[
    {id:"Lm", nom:"longueur du brin",
     aide:"le quart d'onde : c'est la cote qui fixe la résonance"},
    {id:"wr", nom:"largeur du brin",
     aide:"plus il est large, plus la bande est large et la résonance basse"},
    {id:"Lg", nom:"masse tronquée",
     aide:"c'est le second bras de l'antenne : la raccourcir déplace la "+
          "résonance"},
    {id:"wf", nom:"largeur de la ligne", aide:"synthétisée pour 50 Ω"},
    {id:"Lb", nom:"largeur de la carte", aide:"de part et d'autre du brin"},
    {id:"marge", nom:"marge au-dessus du brin",
     aide:"le substrat qui dépasse du bout du brin"}
  ],
  defauts:function(c){
    const Lm=CON_C0/(4*c.f*Math.sqrt(c.eeffAir));
    const wr=Math.max(2*c.wf,Lm/6);
    const marge=Math.max(3*c.h,2);
    return {
      Lm:Lm, wr:wr,
      Lg:Math.max(Lm*0.8,10),
      wf:c.wf,
      Lb:Math.max(wr+4*marge,20),
      marge:marge
    };
  },
  tracer:function(c,p){
    const Lb=p.Lb, Wb=p.Lg+p.Lm+p.marge, xc=Lb/2;
    const festim=CON_C0/(4*p.Lm*Math.sqrt(c.eeffAir));
    return {
      carte:{L:Lb, W:Wb},
      formes:[
        gRect("bas","GND",0,0,Lb,p.Lg),
        gPiste("haut","ANTENNE",[[xc,0],[xc,p.Lg]],p.wf),
        gRect("haut","ANTENNE",xc-p.wr/2,p.Lg,xc+p.wr/2,p.Lg+p.Lm)
      ],
      port:{x:xc, y:p.wf/4, w:p.wf, l:p.wf/2},
      /* Le brin commence où la masse s'arrête : c'est `Lg` de ruban entre le
         port et le pied de l'antenne. */
      ligne:{d:p.Lg, w:p.wf},
      cotes:[
        gCote("Lm",Lb,p.Lg,Lb,p.Lg+p.Lm,2.2,"Lm"),
        gCote("Lg",0,0,0,p.Lg,-2.2,"Lg"),
        gCote("wr",xc-p.wr/2,p.Lg+p.Lm,xc+p.wr/2,p.Lg+p.Lm,2.2,"wr"),
        gCote("marge",Lb,p.Lg+p.Lm,Lb,Wb,2.2,"m",true),
        gCote("Lb",0,0,Lb,0,-2.2,"Lb",true),
        gRepere("wf",xc+p.wf/2,p.Lg*0.45,Lb+4,p.Lg*0.45,"wf")
      ],
      calcul:{
        titre:"Monopôle imprimé",
        resume:"brin "+conLong(p.Lm,2)+" × "+conLong(p.wr,2)+
               " sur masse de "+conLong(p.Lg,1),
        festim:festim,
        lignes:[
          ["εr effectif retenu", c.eeffAir.toFixed(3)+
             "  ((εr+1)/2 : le brin est hors masse)"],
          ["Quart d'onde calculé",
             conLong(CON_C0/(4*c.f*Math.sqrt(c.eeffAir)),3)],
          ["Masse tronquée", conLong(p.Lg,2)+" — c'est le second bras"],
          ["Ligne d'alimentation", conLong(p.wf,3)+" → "+
           conZ0Microruban(c.er,c.h,p.wf).toFixed(1)+" Ω"],
          ["Carte", conLong(Lb,2)+" × "+conLong(Wb,2)]
        ]
      }
    };
  }
};

/* ==========================================================================
   3. L'antenne F inversé imprimée (IFA)
   --------------------------------------------------------------------------
   Celle qu'on trouve dans presque tout objet connecté : un quart d'onde
   replié au-dessus du bord d'un plan de masse, court-circuité à une
   extrémité, alimenté un peu plus loin. Le court-circuit et le point
   d'alimentation forment une boucle dont la position règle l'impédance sans
   toucher à la résonance — c'est tout son intérêt, et c'est aussi ce qui la
   rend délicate : deux réglages qui interagissent.

   LE COURT-CIRCUIT EST UN VIA, ET IL EST RÉEL. Il relie le bras à la masse de
   la face opposée, et il entre dans le modèle comme un cylindre métallisé —
   pas comme une hypothèse. Un IFA dont le court-circuit serait oublié ne
   résonne pas du tout ; le S11 le dirait, mais trop tard.

   LA LONGUEUR QUI RÉSONNE EST LE DÉVELOPPÉ : le chemin que le courant
   parcourt du court-circuit au bout ouvert. Trois morceaux, et non deux —
   l'enfoncement du via dans la masse, la hauteur au-dessus de la masse, puis
   le bras horizontal. Le premier ne se voit pas et se néglige volontiers :
   c'est une faute, parce qu'un via posé au ras du bord tomberait à moitié
   hors du cuivre, qu'il faut donc bien l'enfoncer, et que 0,8 mm à 2,45 GHz
   font 4 % du quart d'onde — davantage que l'écart qu'on annonce.

   CE QUE LE COMPTER SUPPOSE. Entre le via et le bord de la masse, le brin
   court AU-DESSUS du plan : c'est une ligne, pas un rayonneur, et sa longueur
   électrique n'est pas tout à fait celle d'un brin en l'air. Le compter en
   entier surestime donc un peu ; l'ignorer sous-estime de tout. On le compte,
   et c'est écrit.
   ========================================================================== */
const CON_MOTIF_IFA={
  id:"ifa", nom:"F inversé (IFA)", role:"gnd",
  aide:"quart d'onde replié, court-circuité par un via : compact, large bande",
  besoin:"Il faut au moins deux couches de cuivre : un F inversé se "+
         "court-circuite à la masse.",
  champs:[
    {id:"La", nom:"longueur du bras",
     aide:"avec la hauteur, elle forme le quart d'onde développé"},
    {id:"ha", nom:"hauteur au-dessus de la masse",
     aide:"elle compte dans le développé, et elle élargit la bande"},
    {id:"wb", nom:"largeur du bras", aide:"plus large, plus large de bande"},
    {id:"d",  nom:"court-circuit → alimentation",
     aide:"le seul réglage d'impédance : il déplace peu la résonance"},
    {id:"sc", nom:"enfoncement du court-circuit",
     aide:"de combien le via entre dans la masse : cette longueur compte "+
          "dans le développé"},
    {id:"Lg", nom:"plan de masse",
     aide:"il fait partie de l'antenne : un quart d'onde au moins"},
    {id:"wf", nom:"largeur du brin d'alimentation",
     aide:"synthétisé pour 50 Ω"},
    {id:"dVia", nom:"diamètre du via", aide:"le court-circuit, traversant"},
    {id:"marge", nom:"marge de carte", aide:"le substrat qui dépasse du bras"}
  ],
  defauts:function(c){
    const quart=CON_C0/(4*c.f*Math.sqrt(c.eeffAir));
    const ha=Math.max(quart*0.18,2.5);
    const dVia=Math.min(CON.diametreVia,0.8);
    /* Le via doit tomber ENTIÈREMENT sur le cuivre de masse : son
       enfoncement ne descend donc jamais sous son propre rayon, augmenté
       d'un dégagement du même ordre. */
    const sc=Math.max(0.8,dVia);
    return {
      La:quart-ha-sc, ha:ha, sc:sc,
      wb:Math.max(quart/12,1.0),
      d:Math.max((quart-ha-sc)/4,1.5),
      Lg:Math.max(quart,15),
      wf:c.wf,
      dVia:dVia,
      marge:Math.max(3*c.h,2)
    };
  },
  tracer:function(c,p){
    const Lb=p.La+2*p.marge+p.wb;
    const Wb=p.Lg+p.ha+p.wb+p.marge;
    const x0=p.marge;          // bord gauche du bras
    const yg=p.Lg;             // bord de la masse
    const yb=yg+p.ha;          // axe du bras horizontal
    const ys=yg-p.sc;          // pied du court-circuit, sur la masse
    const dev=p.La+p.ha+p.sc;
    const festim=CON_C0/(4*dev*Math.sqrt(c.eeffAir));
    return {
      carte:{L:Lb, W:Wb},
      formes:[
        gRect("bas","GND",0,0,Lb,p.Lg),
        /* Le bras et son court-circuit : une seule piste coudée. Le brin
           d'alimentation en est une seconde, plus fine. */
        gPiste("haut","ANTENNE",[[x0,ys],[x0,yb],[x0+p.La,yb]],p.wb),
        gPiste("haut","ANTENNE",[[x0+p.d,yb],[x0+p.d,ys]],p.wf),
        gVia("ANTENNE",x0,ys,p.dVia)
      ],
      port:{x:x0+p.d, y:ys+0.3, w:p.wf, l:0.6},
      cotes:[
        gCote("La",x0,Wb,x0+p.La,Wb,2.2,"La"),
        gCote("ha",0,yg,0,yb,-2.2,"ha"),
        gCote("Lg",Lb,0,Lb,p.Lg,2.2,"Lg"),
        gCote("d",x0,yg,x0+p.d,yg,-1.4,"d"),
        gCote("marge",0,Wb,x0,Wb,2.2,"m",true),
        gRepere("wb",x0+p.La,yb+p.wb/2,Lb+3.5,yb+p.wb/2+2,"wb"),
        gRepere("wf",x0+p.d+p.wf/2,(ys+yb)/2,x0+p.d+4,yg*0.62,"wf"),
        gRepere("sc",x0,(ys+yg)/2,-4.5,yg-4,"sc"),
        gRepere("dVia",x0+p.dVia/2,ys-p.dVia/2,-4.5,yg-9,"⌀via")
      ],
      calcul:{
        titre:"F inversé imprimé",
        resume:"bras "+conLong(p.La,2)+" à "+conLong(p.ha,2)+
               " de la masse, alimentation à "+conLong(p.d,2)+
               " du court-circuit",
        festim:festim,
        lignes:[
          ["Quart d'onde visé",
             conLong(CON_C0/(4*c.f*Math.sqrt(c.eeffAir)),3)],
          ["Développé dessiné (sc + ha + La)", conLong(dev,3)],
          ["Court-circuit → alimentation", conLong(p.d,3)],
          ["Via de court-circuit", "⌀ "+conLong(p.dVia,2)+", traversant"],
          ["Plan de masse", conLong(p.Lg,1)+" — il fait partie de l'antenne"],
          ["Carte", conLong(Lb,2)+" × "+conLong(Wb,2)]
        ]
      }
    };
  }
};

/* ==========================================================================
   4. Le F inversé à méandres (MIFA)
   --------------------------------------------------------------------------
   Le même quart d'onde, REPLIÉ EN ACCORDÉON pour tenir sur une empreinte deux
   fois plus courte. C'est l'antenne des clés USB, des traceurs et de tout ce
   qui n'a pas la place d'un IFA droit.

   CE QUE LE MÉANDRE COÛTE, ET IL FAUT LE SAVOIR AVANT DE DESSINER. Replier ne
   raccourcit pas le fil : le développé reste le quart d'onde, et c'est
   l'empreinte seule qui diminue. On le paie trois fois — la bande se
   rétrécit (les brins repliés rayonnent en opposition et s'annulent deux à
   deux), le rendement baisse, et les brins voisins SE COUPLENT : au-delà d'un
   certain serrement, la résonance remonte au-dessus du calcul parce que le
   courant ne parcourt plus toute la longueur dessinée.

   LE CALCUL EST DONC UNE BORNE, PAS UNE PRÉVISION. Il pose le développé
   exact ; la fiche prévient dès que l'écartement des brins descend sous deux
   fois leur largeur, parce que c'est là que le modèle du fil déplié cesse de
   valoir. Sur un MIFA serré, attendre 5 à 10 % d'écart, pas 2 à 5 %.

   COMMENT LES COTES SE COMPOSENT. L'empreinte `Lx` et le nombre de replis `n`
   sont ce qu'on choisit ; la hauteur des dents s'en déduit, parce que c'est
   elle qui doit boucher le compte :

       développé = sc + ha + Lx + 2·n·hm  =  quart d'onde

   Allonger l'empreinte raccourcit donc les dents, et les supprime quand elle
   atteint le quart d'onde — ce qui est exactement l'IFA droit. `sc` est
   l'enfoncement du court-circuit dans la masse, compté comme sur l'IFA et
   pour la même raison.
   ========================================================================== */
const CON_MOTIF_MIFA={
  id:"mifa", nom:"F inversé à méandres (MIFA)", role:"gnd",
  aide:"le quart d'onde replié en accordéon : deux fois plus court, plus "+
       "étroit de bande",
  besoin:"Il faut au moins deux couches de cuivre : un F inversé se "+
         "court-circuite à la masse.",
  champs:[
    {id:"Lx", nom:"empreinte du méandre",
     aide:"la longueur hors-tout occupée : c'est ce qu'on gagne sur l'IFA "+
          "droit"},
    {id:"n",  nom:"nombre de replis", entier:true,
     aide:"plus il y en a, plus les dents sont courtes et les brins serrés"},
    {id:"ha", nom:"hauteur au-dessus de la masse",
     aide:"elle compte dans le développé, comme sur l'IFA"},
    {id:"wb", nom:"largeur du bras",
     aide:"c'est elle qui décide de la distance minimale entre deux brins"},
    {id:"d",  nom:"court-circuit → alimentation",
     aide:"le réglage d'impédance"},
    {id:"sc", nom:"enfoncement du court-circuit",
     aide:"de combien le via entre dans la masse : cette longueur compte "+
          "dans le développé"},
    {id:"Lg", nom:"plan de masse", aide:"il fait partie de l'antenne"},
    {id:"wf", nom:"largeur du brin d'alimentation",
     aide:"synthétisé pour 50 Ω"},
    {id:"dVia", nom:"diamètre du via", aide:"le court-circuit, traversant"},
    {id:"marge", nom:"marge de carte", aide:"le substrat qui dépasse"}
  ],
  defauts:function(c){
    const quart=CON_C0/(4*c.f*Math.sqrt(c.eeffAir));
    const ha=Math.max(quart*0.18,2.5);
    const dVia=Math.min(CON.diametreVia,0.8);
    return {
      /* Une empreinte au tiers du quart d'onde et deux replis : c'est le
         compromis des modules du commerce — assez court pour que le méandre
         serve, assez lâche pour que le couplage reste supportable. */
      Lx:quart*0.35,
      n:2,
      ha:ha,
      wb:Math.max(quart/20,0.6),
      d:Math.max(quart*0.35/4,1.0),
      sc:Math.max(0.8,dVia),
      Lg:Math.max(quart,15),
      wf:c.wf,
      dVia:dVia,
      marge:Math.max(3*c.h,2)
    };
  },
  tracer:function(c,p){
    const quart=CON_C0/(4*c.f*Math.sqrt(c.eeffAir));
    const n=Math.max(1,Math.round(p.n));
    const pas=p.Lx/n;
    /* La hauteur des dents est ce qui reste à loger : elle peut tomber à zéro
       (l'empreinte suffit déjà) mais jamais en dessous — un méandre négatif
       n'existe pas, et la fiche dit alors que le développé est trop court. */
    const hm=Math.max(0,(quart-p.ha-p.sc-p.Lx)/(2*n));

    const x0=p.marge, yg=p.Lg, yb=yg+p.ha, ys=yg-p.sc;
    /* Le tracé part du pied du court-circuit, monte à la hauteur du bras,
       puis pose n dents : chacune monte de hm, avance d'un demi-pas,
       redescend, et avance du demi-pas suivant. Développé d'une dent :
       2·hm + pas ; empreinte d'une dent : pas. */
    const pts=[[x0,ys],[x0,yb]];
    if(hm>0.01){
      for(let i=0;i<n;i++){
        const xg=x0+i*pas;
        pts.push([xg,yb+hm]);
        pts.push([xg+pas/2,yb+hm]);
        pts.push([xg+pas/2,yb]);
        pts.push([xg+pas,yb]);
      }
    }else{
      /* Plus de dent à poser : le bras est droit, et on le dit en UN segment.
         Empiler n points alignés donnerait le même cuivre et un document plus
         lourd, mais surtout une piste qu'on ne peut plus reprendre à la main
         sans tomber sur des sommets qui ne veulent rien dire. */
      pts.push([x0+p.Lx,yb]);
    }
    const Lb=p.Lx+2*p.marge+p.wb;
    const Wb=p.Lg+p.ha+hm+p.wb+p.marge;
    const dev=p.sc+p.ha+p.Lx+2*n*hm;
    const festim=CON_C0/(4*dev*Math.sqrt(c.eeffAir));
    /* L'écartement entre deux brins voisins : c'est le demi-pas moins la
       largeur du bras, et c'est le nombre qui dit si le méandre est sain. */
    const ecart=pas/2-p.wb;

    const lignes=[
      ["Quart d'onde visé", conLong(quart,3)],
      ["Développé dessiné (sc + ha + Lx + 2·n·hm)", conLong(dev,3)],
      ["Hauteur des dents hm",
         conLong(hm,3)+" ("+n+" repli"+(n>1?"s":"")+")"],
      ["Pas du méandre", conLong(pas,3)],
      ["Écartement des brins", conLong(ecart,3)+
        " (largeur de bras : "+conLong(p.wb,3)+")"],
      ["Gain d'encombrement",
        (100*(1-p.Lx/Math.max(quart-p.ha-p.sc,1e-6))).toFixed(0)+
        " % sur l'IFA droit"],
      ["Plan de masse", conLong(p.Lg,1)],
      ["Carte", conLong(Lb,2)+" × "+conLong(Wb,2)]
    ];
    if(hm<=0.01)
      lignes.push(["⚠ Méandre nul",
        "l'empreinte suffit déjà au développé : c'est un IFA droit"]);
    else if(ecart<2*p.wb)
      lignes.push(["⚠ Brins serrés",
        "moins de deux largeurs de bras : le couplage remonte la résonance"]);

    return {
      carte:{L:Lb, W:Wb},
      formes:[
        gRect("bas","GND",0,0,Lb,p.Lg),
        gPiste("haut","ANTENNE",pts,p.wb),
        gPiste("haut","ANTENNE",[[x0+p.d,yb],[x0+p.d,ys]],p.wf),
        gVia("ANTENNE",x0,ys,p.dVia)
      ],
      port:{x:x0+p.d, y:ys+0.3, w:p.wf, l:0.6},
      cotes:[
        gCote("Lx",x0,Wb,x0+p.Lx,Wb,2.2,"Lx"),
        gCote("ha",0,yg,0,yb,-2.2,"ha"),
        gCote("Lg",Lb,0,Lb,p.Lg,2.2,"Lg"),
        gCote("n",x0,yb,x0,yb+hm,-1.4,"hm"),
        gCote("d",x0,yg,x0+p.d,yg,-1.4,"d"),
        gCote("marge",0,Wb,x0,Wb,2.2,"m",true),
        gRepere("wb",x0+(n-1)*pas+pas/4,yb+hm+p.wb/2,
                Lb+3.5,yb+hm+2,"wb"),
        gRepere("wf",x0+p.d+p.wf/2,(ys+yb)/2,x0+p.d+4,yg*0.62,"wf"),
        gRepere("sc",x0,(ys+yg)/2,-4.5,yg-4,"sc"),
        gRepere("dVia",x0+p.dVia/2,ys-p.dVia/2,-4.5,yg-9,"⌀via")
      ],
      calcul:{
        titre:"F inversé à méandres",
        resume:"développé "+conLong(dev,2)+" replié sur "+conLong(p.Lx,2)+
               " en "+n+" repli"+(n>1?"s":""),
        festim:festim,
        lignes:lignes
      }
    };
  }
};

/* ==========================================================================
   5. Le dipôle imprimé, un bras par face
   --------------------------------------------------------------------------
   Deux bras d'un quart d'onde, l'un sur le dessus, l'autre sur le dessous,
   qui se chevauchent au centre. C'est une antenne équilibrée, sans plan de
   masse — donc sans le rayonnement arrière d'un patch, et avec un diagramme
   en huit.

   POURQUOI UN BRAS PAR FACE, ET NON DEUX SUR LA MÊME. Le port de cet outil
   est LOCALISÉ ET VERTICAL : il excite une différence de potentiel entre deux
   couches. Deux bras coplanaires demanderaient un port dans le plan de la
   carte, que l'assistant sait poser (« dir » x ou y) mais qu'il faudrait
   régler à la main. Un bras par face est la forme qui se nourrit
   naturellement de ce port — et c'est une antenne qui se fabrique vraiment :
   le dipôle imprimé à ligne équilibrée est exactement cela.
   ========================================================================== */
const CON_MOTIF_DIPOLE={
  id:"dipole", nom:"Dipôle imprimé", role:"signal",
  aide:"un bras par face, sans plan de masse : diagramme en huit",
  besoin:"Il faut deux couches de cuivre : un bras du dipôle est sur chaque "+
         "face.",
  champs:[
    {id:"La", nom:"longueur d'un bras",
     aide:"le quart d'onde : les deux bras font la demi-onde du dipôle"},
    {id:"wd", nom:"largeur des bras",
     aide:"plus large, plus large de bande"},
    {id:"ov", nom:"chevauchement central",
     aide:"c'est le volume du port : les deux bras s'y superposent d'une face "+
          "à l'autre"},
    {id:"marge", nom:"marge de carte",
     aide:"le substrat qui dépasse des bras"}
  ],
  defauts:function(c){
    const La=CON_C0/(4*c.f*Math.sqrt(c.eeffAir));
    return {
      La:La,
      wd:Math.max(La/12,1.0),
      ov:Math.max(c.h,0.5),
      marge:Math.max(4*c.h,3)
    };
  },
  tracer:function(c,p){
    const Lb=2*p.La+2*p.marge, Wb=p.wd+4*p.marge;
    const xc=Lb/2, yc=Wb/2;
    const festim=CON_C0/(4*p.La*Math.sqrt(c.eeffAir));
    return {
      carte:{L:Lb, W:Wb},
      formes:[
        gRect("haut","ANTENNE",xc-p.ov/2,yc-p.wd/2,xc-p.ov/2+p.La,yc+p.wd/2),
        gRect("bas","ANTENNE",xc+p.ov/2-p.La,yc-p.wd/2,xc+p.ov/2,yc+p.wd/2)
      ],
      port:{x:xc, y:yc, w:p.ov, l:p.wd},
      cotes:[
        gCote("La",xc-p.ov/2,Wb,xc-p.ov/2+p.La,Wb,2.2,"La"),
        gCote("wd",Lb,yc-p.wd/2,Lb,yc+p.wd/2,2.2,"wd"),
        gCote("ov",xc-p.ov/2,0,xc+p.ov/2,0,-2.2,"ov"),
        gCote("marge",0,0,p.marge,0,-2.2,"m",true)
      ],
      calcul:{
        titre:"Dipôle imprimé",
        resume:"deux bras de "+conLong(p.La,2)+", un par face, chevauchement "+
               conLong(p.ov,2),
        festim:festim,
        lignes:[
          ["εr effectif retenu", c.eeffAir.toFixed(3)],
          ["Quart d'onde calculé",
             conLong(CON_C0/(4*c.f*Math.sqrt(c.eeffAir)),3)],
          ["Longueur totale rayonnante", conLong(2*p.La,3)],
          ["Chevauchement central",
             conLong(p.ov,3)+" — c'est le volume du port"],
          ["Plan de masse", "aucun : l'antenne est équilibrée"],
          ["Carte", conLong(Lb,2)+" × "+conLong(Wb,2)]
        ]
      }
    };
  }
};

/* ==========================================================================
   6. La ligne 50 Ω seule — l'étalon
   --------------------------------------------------------------------------
   Ce n'est pas une antenne : c'est une ligne microruban ouverte au bout,
   au-dessus d'un plan de masse entier. Elle ne rayonne presque pas, et c'est
   ce qui la rend utile : on sait d'avance ce qu'elle doit rendre.

   CE QU'ON ATTEND N'EST PAS 50 Ω, ET LE DIRE ÉTAIT UNE FAUTE. Une ligne
   OUVERTE au bout ne présente jamais 50 Ω à son entrée : elle présente
   −jZ₀·cot(βℓ), c'est-à-dire un pur réactif qui passe par zéro et par
   l'infini. Les 50 Ω sont son impédance CARACTÉRISTIQUE — ce qu'elle fait
   voir à une onde qui la parcourt, pas ce qu'un pont de mesure lit à son
   entrée.

   CE QU'IL FAUT REGARDER. La ligne fait exactement une demi-longueur d'onde
   guidée à la fréquence visée : à cette fréquence-là, et à elle seule,
   l'ouverture du bout se retrouve telle quelle à l'entrée — |Z| passe par un
   MAXIMUM. Si ce maximum tombe à la fréquence visée à un ou deux pour cent
   près, alors εr effectif, l'épaisseur du substrat, le maillage et le port
   disent tous la même chose que le calcul à la main.
   ========================================================================== */
const CON_MOTIF_LIGNE={
  id:"ligne", nom:"Ligne 50 Ω (étalon)", role:"gnd",
  aide:"pas une antenne : la structure dont on connaît d'avance le résultat",
  besoin:"Il faut deux couches de cuivre : une ligne microruban court "+
         "au-dessus d'un plan.",
  champs:[
    {id:"wf", nom:"largeur de la ligne",
     aide:"synthétisée pour 50 Ω, et relue ci-dessous"},
    {id:"Ll", nom:"longueur de la ligne",
     aide:"une demi-longueur d'onde guidée : c'est ce qu'on éprouve"},
    {id:"marge", nom:"marge de carte",
     aide:"le substrat et la masse autour de la ligne"}
  ],
  defauts:function(c){
    const ee=conEeff(c.er,c.h,c.wf);
    return {
      wf:c.wf,
      Ll:CON_C0/(c.f*Math.sqrt(ee))/2,
      marge:Math.max(5*c.h,3)
    };
  },
  tracer:function(c,p){
    const ee=conEeff(c.er,c.h,p.wf);
    /* La carte dépasse la ligne du côté OUVERT seulement : le port est à
       l'autre bout, au ras du bord, et la ligne doit faire λg/2 entre les
       deux — c'est cette longueur-là qu'on éprouve. */
    const Lb=p.Ll+p.marge, Wb=p.wf+6*p.marge, yc=Wb/2;
    const festim=CON_C0/(2*p.Ll*Math.sqrt(ee));
    return {
      carte:{L:Lb, W:Wb},
      formes:[
        gRect("bas","GND",0,0,Lb,Wb),
        gPiste("haut","ANTENNE",[[0,yc],[p.Ll,yc]],p.wf)
      ],
      port:{x:p.wf/4, y:yc, w:p.wf/2, l:p.wf},
      cotes:[
        gCote("Ll",0,0,p.Ll,0,-2.2,"ℓ"),
        gCote("wf",Lb,yc-p.wf/2,Lb,yc+p.wf/2,2.2,"wf"),
        gCote("marge",p.Ll,0,Lb,0,-2.2,"m",true)
      ],
      calcul:{
        titre:"Ligne microruban 50 Ω",
        resume:"largeur "+conLong(p.wf,3)+", longueur "+conLong(p.Ll,2)+
               " (λg/2), ouverte au bout",
        festim:festim,
        lignes:[
          ["Impédance relue", conZ0Microruban(c.er,c.h,p.wf).toFixed(2)+" Ω"],
          ["εr effectif", ee.toFixed(3)],
          ["Longueur d'onde guidée", conLong(CON_C0/(c.f*Math.sqrt(ee)),2)],
          ["Ce qu'on attend", "|Z| maximal à "+conFreq(festim)+" "+
                              "(ligne ouverte de λg/2), et non 50 Ω"],
          ["Carte", conLong(Lb,2)+" × "+conLong(Wb,2)]
        ]
      }
    };
  }
};

/* La liste, dans l'ordre où le panneau la montre : les motifs qu'on dessine
   le plus souvent d'abord, l'étalon en dernier — il ne rayonne pas, et il ne
   se cherche que lorsqu'on doute du reste. */
const CON_GABARITS=[
  CON_MOTIF_PATCH, CON_MOTIF_MONOPOLE, CON_MOTIF_IFA,
  CON_MOTIF_MIFA, CON_MOTIF_DIPOLE, CON_MOTIF_LIGNE
];

function conGabarit(id){
  return CON_GABARITS.find(g=>g.id===id)||null;
}

/* ==========================================================================
   Les cotes : proposées, retouchées, remises d'aplomb
   ========================================================================== */
/* Les cotes du calcul, arrondies au dixième de micron comme le dessin. Un
   champ qui affiche quinze décimales invite à croire à la quinzième. */
function conGabaritDefauts(g,c){
  const d=g.defauts(c||conContexte());
  const out={};
  g.champs.forEach(function(ch){
    const v=d[ch.id];
    out[ch.id]=ch.entier?Math.max(1,Math.round(v)):+(+v).toFixed(4);
  });
  return out;
}

/* Ce que le tracé recevra : les cotes données, complétées par le calcul pour
   celles qui manquent, et bornées à des valeurs dessinables. UNE COTE VIDE OU
   NÉGATIVE NE SE REFUSE PAS ICI — elle se remplace par celle du calcul : un
   champ vidé pendant la saisie ne doit pas faire disparaître l'aperçu. */
function conGabaritCotes(g,c,p){
  const d=conGabaritDefauts(g,c);
  const out={};
  g.champs.forEach(function(ch){
    let v=(p&&p[ch.id]!=null)?+p[ch.id]:NaN;
    if(!isFinite(v))v=d[ch.id];
    if(ch.entier)v=Math.max(1,Math.round(v));
    /* L'encastrement est la seule cote qui a le droit d'être nulle : un patch
       alimenté au bord existe, il est juste mal adapté. */
    else if(v<0||(v===0&&ch.id!=="y0"))v=d[ch.id];
    out[ch.id]=v;
  });
  return out;
}

/* Ce que l'utilisateur a repris à la main, pour que la fiche le dise. Le
   seuil est de deux pour mille : en dessous, c'est l'arrondi de l'affichage,
   pas une décision. */
function conGabaritEcarts(g,c,p){
  const d=conGabaritDefauts(g,c);
  const out=[];
  g.champs.forEach(function(ch){
    const a=d[ch.id], b=p[ch.id];
    if(a==null||b==null)return;
    if(Math.abs(a-b)>Math.max(1e-4,Math.abs(a)*0.002))
      out.push({champ:ch, calcul:a, pose:b});
  });
  return out;
}

/* ==========================================================================
   Poser un motif
   ========================================================================== */
/* Le rôle des couches FAIT PARTIE DU MOTIF. Un patch travaille contre une
   masse, un dipôle équilibré n'en a aucune : laisser la seconde couche
   déclarée « masse » parce que c'est le réglage d'usine ferait dire au
   document le contraire de ce que l'antenne est. */
function conRoleSeconde(role){
  const cu=conCuivres();
  if(cu.length>1)cu[1].e.role=role;
}

/* Tous les motifs passent par ici : on vide le dessin, on pose la carte, on
   règle la bande autour de la fréquence visée.

   LA BANDE EST ÉLARGIE À ±15 %, et ce n'est pas un détail. Un motif tombe à
   quelques pour cent de la cible ; simuler sur ±2 % rendrait une courbe sans
   creux, dont on ne saurait même pas de quel côté chercher. Une bande large
   coûte des cellules, mais elle DIT dans quel sens corriger. */
function conGabaritDebut(f,L,W){
  CON.elements=[];
  CON.sel=-1;
  CON.courant=null;
  CON.carte.L=+L.toFixed(3);
  CON.carte.W=+W.toFixed(3);
  CON.fcible=f;
  ANT.bande.f1=f*0.85;
  ANT.bande.f2=f*1.15;
  ANT.bande.fcible=f;
  ANT.nf2ff.actif=true;
}

/* La virgule décimale, comme partout ailleurs dans l'outil. Elle est posée
   ICI, en une passe sur le résultat, plutôt que dans chaque `toFixed` des six
   motifs : un formatage dispersé à quarante endroits finit toujours par en
   oublier un, et une fiche où deux nombres sur trois portent une virgule se
   lit plus mal qu'une fiche qui n'en porte aucune. */
function conVirgules(t){ return String(t).replace(/(\d)\.(\d)/g,"$1,$2"); }

/* Le port d'une antenne imprimée : vertical, entre la couche du dessus et le
   premier plan de masse. `w` est l'étendue en x, `l` celle en y — c'est ainsi
   que python/openems_modele.py construit son volume, et les confondre pose un
   port en travers de la ligne. */
function conPoser(port,ligne){
  const cu=conCuivres();
  /* UN MOTIF REFAIT LA CARTE ENTIÈRE : les ports supplémentaires posés sur le
     dessin précédent désignaient du cuivre qui n'existe plus. On revient donc
     à un seul port, celui que le motif alimente. */
  ANT.ports=[ANT.ports[0]];
  ANT.portActif=0;
  ANT.ports[0].excite=true;
  ANT.port.pose=true;
  ANT.port.dir="z";
  ANT.port.x=+port.x.toFixed(4);
  ANT.port.y=+port.y.toFixed(4);
  ANT.port.w=+Math.max(port.w,0.05).toFixed(4);
  ANT.port.l=+Math.max(port.l,0.05).toFixed(4);
  ANT.port.de=cu.length?cu[0].e.nom:"";
  ANT.port.a=cu.length>1?cu[1].e.nom:"";
  /* La ligne d'alimentation du motif, quand il en a une. Elle est REPOSÉE à
     chaque pose — y compris à zéro pour un motif qui n'en a pas : hériter de
     la ligne du motif précédent ferait ramener l'impédance sur une longueur
     de ruban qui n'existe plus, et le nombre aurait l'air d'un nombre. */
  ANT.port.ligne_d=(ligne&&ligne.d>0)?+ligne.d.toFixed(4):0;
  ANT.port.ligne_w=(ligne&&ligne.w>0)?+ligne.w.toFixed(4):0;
}

/* La fiche : ce que le motif a calculé, ce que les cotes posées donnent, et
   ce qui a été repris à la main. LA RÉSONANCE ESTIMÉE EST CALCULÉE SUR LES
   COTES DESSINÉES, pas sur la fréquence visée — c'est elle qui dit ce qu'une
   cote retouchée a changé, et c'est la seule raison de retoucher une cote
   sans lancer le solveur. */
function conGabaritFiche(g,c,p,t){
  const lignes=[["Fréquence visée",conFreq(c.f)]];
  if(t.calcul.festim>0){
    const ec=100*(t.calcul.festim-c.f)/c.f;
    lignes.push(["Résonance estimée (cotes dessinées)",
      conFreq(t.calcul.festim)+"  ("+
      (ec>=0?"+":"")+ec.toFixed(1)+" %)"]);
  }
  const fiche={titre:t.calcul.titre, resume:t.calcul.resume,
               lignes:lignes.concat(t.calcul.lignes)};
  conGabaritEcarts(g,c,p).forEach(function(e){
    fiche.lignes.push(["↻ "+e.champ.nom,
      (e.champ.entier?String(e.pose):conLong(e.pose,3))+" au lieu de "+
      (e.champ.entier?String(e.calcul):conLong(e.calcul,3))]);
  });
  return fiche;
}

function conGabaritFin(calcul){
  calcul.resume=conVirgules(calcul.resume);
  calcul.lignes=calcul.lignes.map(l=>[l[0],conVirgules(l[1])]);
  CON.calcul=calcul;
  CON.outil="select";
  conAppliquer(true);
  hint(calcul.titre+" posé : "+calcul.resume+
       " — c'est un point de départ à ±5 %, pas une antenne finie. "+
       "Lancez la simulation, puis corrigez à la cote.");
}

/* Le motif tracé, mis en éléments de dessin — ET RIEN D'AUTRE. Aucun état
   n'est touché : ni `CON.elements`, ni la carte, ni le port, ni la bande.

   EXTRAIT DE `conGabaritPoser` PARCE QUE LE BALAYAGE EN A BESOIN AUSSI. Faire
   varier une cote de motif, c'est reposer le motif pour chaque valeur ; le
   faire en appelant `conGabaritPoser` remettrait au passage la bande à ±15 %
   et le zoom à l'échelle de la carte — une bande resserrée à la main serait
   silencieusement rétablie à chaque point, et on ne le verrait qu'en lisant
   les quarante courbes. Deux implémentations du tracé, en revanche, finiraient
   par diverger : c'est bien LE tracé de l'outil qu'un balayage doit éprouver.
   Rend `null` quand il manque une couche — le balayage n'a alors rien à
   proposer, et le panneau non plus. */
function conGabaritTrace(g,c,q){
  const cu=conCuivres();
  if(cu.length<2)return null;
  const t=g.tracer(c,q);
  const uid={haut:cu[0].e.uid, bas:cu[1].e.uid};
  const elements=t.formes.map(function(fo){
    const el={};
    for(const k in fo)el[k]=fo[k];
    el.cu=(uid[fo.cu]!=null)?uid[fo.cu]:uid.haut;
    if(fo.pts)el.pts=fo.pts.map(a=>a.slice());
    return conArrondir(el);
  });
  return {t:t, elements:elements};
}

/* LE DESSIN EST-IL ENCORE LE MOTIF, ET RIEN QUE LUI ?

   La question n'est pas cosmétique, c'est un garde-fou de balayage. Faire
   varier une cote de motif REPOSE le motif à chaque point : un via ajouté à
   la main, une piste déplacée, un second élément quelconque disparaîtraient
   de tous les points sans que rien ne le dise, et la famille de courbes
   décrirait une autre antenne que celle qu'on a sous les yeux. C'est
   exactement le genre de résultat qu'on croit sur parole.

   On repose donc le motif dans le vide et on compare : si le dessin en est
   la copie exacte, la cote est balayable ; sinon elle n'est pas proposée, et
   les cotes des formes le restent, elles. */
function conGabaritConforme(){
  const g=conGabarit(CON.gabarit);
  if(!g||!CON.gabaritP)return false;
  let r=null;
  try{ r=conGabaritTrace(g,conContexte(),
                         conGabaritCotes(g,conContexte(),CON.gabaritP)); }
  catch(e){ return false; }
  if(!r||r.elements.length!==CON.elements.length)return false;
  return JSON.stringify(r.elements)===JSON.stringify(CON.elements);
}

/* Poser le motif `id` avec les cotes `p` (celles du calcul si `p` manque).
   C'EST LE SEUL POINT D'ENTRÉE QUI ÉCRIT : l'aperçu, lui, appelle `tracer()`
   et ne touche à rien. */
function conGabaritPoser(id,p){
  const g=(typeof id==="string")?conGabarit(id):id;
  if(!g)return false;
  const cu=conCuivres();
  if(cu.length<2){ hint(g.besoin); return false; }

  const c=conContexte();
  const q=conGabaritCotes(g,c,p);
  const r=conGabaritTrace(g,c,q);
  if(!r)return false;
  const t=r.t;

  /* Le motif posé reste le motif choisi, avec les cotes qui ont servi : le
     panneau montre donc la fiche de CE qui est dessiné, et la passe suivante
     — allonger le patch de 0,4 mm et reposer — part de là. Un motif posé par
     un autre chemin que la fiche (le bouton « Exemple ») remet les cotes à
     plat, faute de quoi la fiche prétendrait qu'on a repris à la main des
     cotes qu'on n'a jamais vues. */
  if(CON.gabarit!==g.id){ CON.gabarit=g.id; CON.gabaritTouche={}; }
  CON.gabaritP=q;

  conGabaritDebut(c.f,t.carte.L,t.carte.W);
  conRoleSeconde(g.role);
  r.elements.forEach(function(el){ CON.elements.push(el); });
  conPoser(t.port,t.ligne);
  conGabaritFin(conGabaritFiche(g,c,q,t));
  return true;
}
