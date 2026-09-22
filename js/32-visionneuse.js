"use strict";
/* =============================================================================
   Antenne openEMS — 32-visionneuse.js
   Regarder les champs ici, et non dans ParaView.

   CE QU'ON VIENT VOIR, ET POURQUOI UNE ANIMATION. Un S₁₁ dit qu'une antenne
   résonne ; il ne dit pas pourquoi. La carte du courant, elle, le montre —
   et elle le montre bien mieux en mouvement qu'arrêtée : une onde
   stationnaire et une onde qui se propage donnent la MÊME image figée, et
   deux comportements opposés une fois qu'on les regarde vivre. On voit
   alors, sans rien mesurer, si le courant fait le tour d'une fente, s'il
   rebondit au bout d'un brin, ou s'il s'en va bêtement dans le plan de
   masse.

   POURQUOI L'ANIMATION NE COÛTE PRESQUE RIEN. Le serveur n'envoie pas des
   images : il envoie l'AMPLITUDE et la PHASE de chaque point (voir
   python/openems_champs.py). Une image se recalcule ici, par
   `A·cos(φ + ωt)`, à la cadence de l'écran. Changer de vitesse, de
   composante, d'échelle ou de palette ne demande donc rien au serveur — et
   une carte de mille points se rejoue soixante fois par seconde sans
   transpirer.

   LA GRILLE N'EST PAS RÉGULIÈRE, ET C'EST TOUT LE PIÈGE DU DESSIN. Un
   maillage FDTD est gradué : les cellules sont fines sous une piste et
   larges dans l'air. Étaler le tableau de valeurs sur le canevas comme une
   image donnerait une carte juste en valeurs et FAUSSE en géométrie — le
   patch y serait deux fois trop large. Chaque pixel est donc ramené à sa
   coordonnée réelle, par une table calculée une fois par taille de vue.

   CE MODULE NE REMPLACE PAS ParaView POUR TOUT. Une coupe oblique, des
   lignes de champ en 3D, un rendu volumique : c'est son métier, et le
   bouton qui l'ouvre reste. Mais la question de tous les jours — « où passe
   le courant ? » — se répond ici, en deux secondes, sans rien installer.
   ============================================================================= */

const CHP={
  id:"",            // la tâche dont on regarde les champs
  /* LE DOSSIER CHOISI À LA MAIN, quand ce n'est pas celui du dernier calcul.
     Un projet accumule un dossier de calcul par simulation, et l'on veut
     pouvoir revenir sur celui d'avant-hier — ou sur un dossier importé
     d'ailleurs. Vide veut dire « suis la tâche en cours », ce qui reste le
     cas ordinaire et le comportement d'avant. */
  force:"", forceNom:"",
  inv:null,         // l'inventaire renvoyé par le serveur
  cle:"",           // la série choisie
  serie:null,       // ses données, déjà décodées
  amp:null, pha:null, trames:null,
  comp:"mag",       // mag | amp | 0 | 1 | 2
  echelle:"lin",    // lin | db
  dyn:40,           // dynamique de l'échelle logarithmique, en dB
  gain:1,
  palette:"",       // "" : au choix de la composante
  joue:true,
  phase:0,          // radians, pour le frequentiel
  trame:0,          // indice d'image, pour le temporel
  vitesse:1,
  axe:"", indice:-1,
  cuivre:true,
  occupe:false,
  erreur:"",
  anim:0, horloge:0,
  survol:null,
  enreg:null,
  /* Tables pixel -> case de la grille. Elles ne dépendent que de la taille
     de la vue et des coordonnées de la série : on les garde tant que ni
     l'une ni l'autre ne bouge. */
  mapU:null, mapV:null, mapCle:""
};

/* Une période d'onde dure deux secondes à vitesse 1 : assez lent pour suivre
   un maximum qui se déplace, assez vif pour ne pas s'ennuyer. */
const CHP_PERIODE=2000;
const CHP_FPS_TEMPOREL=12;

/* ==========================================================================
   Palettes
   ========================================================================== */
/* DEUX FAMILLES, ET LE CHOIX N'EST PAS DÉCORATIF. Une grandeur SIGNÉE — la
   composante x du champ — demande une palette qui distingue le signe et qui
   éteint le zéro : on veut voir d'un coup où le champ change de sens, et où
   il n'y a rien. Un MODULE, toujours positif, demande au contraire une
   palette qui monte du noir au blanc en passant par le feu, parce que l'œil
   y lit une intensité sans avoir à consulter l'échelle. */
const CHP_PALETTES={
  feu:[[0,[0,0,4]],[0.15,[27,12,65]],[0.3,[74,12,107]],[0.45,[120,28,109]],
       [0.6,[165,44,96]],[0.75,[207,68,70]],[0.86,[237,105,37]],
       [0.94,[251,155,6]],[1,[252,255,164]]],
  glace:[[0,[168,230,255]],[0.12,[58,167,240]],[0.3,[20,68,110]],
         [0.5,[13,14,16]],[0.7,[110,42,20]],[0.88,[240,116,58]],
         [1,[255,224,168]]],
  gris:[[0,[0,0,0]],[1,[255,255,255]]]
};

function chpLut(nom){
  const anc=CHP_PALETTES[nom]||CHP_PALETTES.feu;
  const lut=new Uint8Array(256*3);
  let k=0;
  for(let i=0;i<256;i++){
    const t=i/255;
    while(k<anc.length-2&&t>anc[k+1][0])k++;
    const a=anc[k], b=anc[k+1]||anc[k];
    const d=(b[0]-a[0])||1, f=Math.max(0,Math.min(1,(t-a[0])/d));
    lut[i*3  ]=a[1][0]+(b[1][0]-a[1][0])*f;
    lut[i*3+1]=a[1][1]+(b[1][1]-a[1][1])*f;
    lut[i*3+2]=a[1][2]+(b[1][2]-a[1][2])*f;
  }
  return lut;
}

const CHP_LUT={};
function chpLutDe(nom){
  if(!CHP_LUT[nom])CHP_LUT[nom]=chpLut(nom);
  return CHP_LUT[nom];
}

/* Signée ou pas : c'est la composante qui décide, et la palette suit. */
function chpSignee(){
  return CHP.echelle==="lin"&&CHP.comp!=="mag"&&CHP.comp!=="amp";
}
function chpPalette(){
  if(CHP.palette)return CHP.palette;
  return chpSignee()?"glace":"feu";
}

/* LE TITRE D'UNE SÉRIE S'ÉCRIT ICI, ET NON SUR LE SERVEUR. Les fichiers
   Python de ce dépôt sont en ASCII pur — voir n'importe lequel d'entre eux —
   et « densite de courant » sans accents au milieu d'une interface qui en
   porte partout se voit tout de suite. Le serveur envoie donc la lettre du
   champ ; la page l'écrit en français. `titre` reste le repli pour un nom
   de dump qu'on ne connaît pas. */
const CHP_NOMS={
  J:"densité de courant", E:"champ électrique",
  H:"champ magnétique",   I:"courant total (rot H)"
};

/* « A/m^2 » est ce qu'un fichier Python en ASCII pur sait ecrire ; « A/m² »
   est ce qu'on lit sur une planche. La conversion est ici, comme les noms. */
function chpUnite(u){
  return String(u||"").replace(/\^2/g,"²").replace(/\^3/g,"³");
}

function chpHertz(f){
  if(!f)return "";
  if(f>=1e9)return aNb(f/1e9,3)+" GHz";
  if(f>=1e6)return aNb(f/1e6,2)+" MHz";
  return aNb(f,0)+" Hz";
}

function chpTitre(x){
  if(!x)return "";
  const n=CHP_NOMS[x.champ];
  if(!n)return x.titre||x.nom||"";
  return x.nom+"  ·  "+n+"  ·  "+
    (x.mode==="frequentiel"?chpHertz(x.f):"au cours du temps");
}

/* ==========================================================================
   Les données
   ========================================================================== */
function chpDecoder(b64){
  const s=atob(b64), n=s.length, buf=new ArrayBuffer(n), o=new Uint8Array(buf);
  for(let i=0;i<n;i++)o[i]=s.charCodeAt(i);
  return new Float32Array(buf);
}

/* QUEL DOSSIER ON REGARDE. Une seule fonction le dit, et tout le reste
   passe par elle : le forcé s'il y en a un, celui de la tâche sinon. */
function chpCible(){
  return CHP.force || (ANT.tache&&ANT.tache.id) || "";
}

async function chpInventaire(){
  const id=chpCible();
  if(!id)throw new Error("Aucune simulation à regarder.");
  CHP.id=id;
  CHP.inv=await oeAppel(OE_ROUTE+"/champs?id="+encodeURIComponent(id));
  if(!CHP.inv.series.length)
    throw new Error("Ce calcul n'a enregistré aucun champ.\n"+
      "La case « Enregistrer les champs » se coche AVANT de lancer : un "+
      "calcul déjà fait ne peut plus en produire.");
  if(!CHP.cle||!CHP.inv.series.some(s=>s.cle===CHP.cle))
    CHP.cle=CHP.inv.series[0].cle;
  return CHP.inv;
}

async function chpCharger(){
  if(!CHP.id||!CHP.cle)return;
  CHP.occupe=true; CHP.erreur=""; chpBarres();
  try{
    const q="?id="+encodeURIComponent(CHP.id)+
            "&cle="+encodeURIComponent(CHP.cle)+
            (CHP.axe?("&axe="+CHP.axe):"")+
            (CHP.indice>=0?("&indice="+CHP.indice):"");
    const s=await oeAppel(OE_ROUTE+"/champ"+q);
    CHP.serie=s;
    CHP.axe=s.axe; CHP.indice=s.indice;
    CHP.amp=s.amp?s.amp.map(chpDecoder):null;
    CHP.pha=s.pha?s.pha.map(chpDecoder):null;
    CHP.trames=s.trames?s.trames.map(t=>t.c.map(chpDecoder)):null;
    /* Une composante qui n'existe plus — on passait d'un vecteur à un
       scalaire — laisserait une carte vide sans rien dire. */
    if(CHP.comp!=="mag"&&CHP.comp!=="amp"&&(+CHP.comp)>=s.ncomp)CHP.comp="mag";
    if(CHP.comp==="amp"&&!CHP.amp)CHP.comp="mag";
    CHP.trame=0; CHP.phase=0; CHP.mapCle="";
  }catch(e){
    CHP.serie=null; CHP.erreur=String(e.message||e);
  }finally{
    CHP.occupe=false; chpBarres(); chpDessiner();
  }
}

/* ==========================================================================
   Le champ scalaire du moment
   ========================================================================== */
/* UN SEUL TABLEAU, RECALCULÉ UNE FOIS PAR IMAGE — et non un cosinus par
   pixel. La vue fait trois cent mille pixels ; la grille, mille points. En
   calculant sur la grille puis en peignant par table, on divise le travail
   par trois cents, et l'animation tient les soixante images par seconde même
   sur un portable. */
function chpValeurs(){
  const s=CHP.serie;
  if(!s)return null;
  const n=s.u.length*s.v.length;
  if(!CHP.buf||CHP.buf.length!==n)CHP.buf=new Float32Array(n);
  const out=CHP.buf;

  if(CHP.comp==="amp"&&CHP.amp){
    for(let i=0;i<n;i++){
      let q=0;
      for(let c=0;c<CHP.amp.length;c++){const a=CHP.amp[c][i];q+=a*a;}
      out[i]=Math.sqrt(q);
    }
    return out;
  }

  if(CHP.amp&&CHP.pha){
    const w=CHP.phase;
    if(CHP.comp==="mag"){
      for(let i=0;i<n;i++){
        let q=0;
        for(let c=0;c<CHP.amp.length;c++){
          const x=CHP.amp[c][i]*Math.cos(CHP.pha[c][i]+w);
          q+=x*x;
        }
        out[i]=Math.sqrt(q);
      }
    }else{
      const c=+CHP.comp, A=CHP.amp[c], P=CHP.pha[c];
      for(let i=0;i<n;i++)out[i]=A[i]*Math.cos(P[i]+w);
    }
    return out;
  }

  if(CHP.trames&&CHP.trames.length){
    const f=CHP.trames[Math.min(CHP.trames.length-1,Math.max(0,CHP.trame|0))];
    if(CHP.comp==="mag"){
      for(let i=0;i<n;i++){
        let q=0;
        for(let c=0;c<f.length;c++){const x=f[c][i];q+=x*x;}
        out[i]=Math.sqrt(q);
      }
    }else{
      const A=f[Math.min(f.length-1,+CHP.comp||0)];
      for(let i=0;i<n;i++)out[i]=A[i];
    }
    return out;
  }
  return null;
}

/* La valeur pleine échelle : le plus grand module de la série, corrigé du
   gain. Elle est FIXE pour toute l'animation — une échelle recalculée à
   chaque image ferait clignoter la carte et donnerait à un champ mourant
   l'air d'un champ intense. */
function chpPleineEchelle(){
  const m=(CHP.serie&&CHP.serie.max)||0;
  return (m>0?m:1)/(CHP.gain||1);
}

/* ==========================================================================
   Le dessin
   ========================================================================== */
/* Les marges, et ce qu'elles doivent tenir. À droite, la barre de couleurs
   ET ses valeurs : « 3,4·10⁻¹² » fait une soixantaine de pixels, et une
   marge calculée sur « 1,0 » coupe l'exposant — c'est-à-dire l'information.
   À gauche, les graduations en millimètres et le nom de l'axe. */
const CHP_MG={g:52,d:108,h:12,b:30};

function chpCadre(W,H){
  const s=CHP.serie;
  const u0=s.u[0], u1=s.u[s.u.length-1];
  const v0=s.v[0], v1=s.v[s.v.length-1];
  const du=Math.abs(u1-u0)||1, dv=Math.abs(v1-v0)||1;
  const aw=Math.max(40,W-CHP_MG.g-CHP_MG.d), ah=Math.max(40,H-CHP_MG.h-CHP_MG.b);
  /* MÊME NOMBRE DE MILLIMÈTRES PAR PIXEL DANS LES DEUX SENS. Sans cela une
     carte carrée s'affiche en rectangle et l'on juge de travers la forme
     d'un mode. */
  const k=Math.min(aw/du,ah/dv);
  const w=du*k, h=dv*k;
  return {x0:CHP_MG.g+(aw-w)/2, y0:CHP_MG.h+(ah-h)/2, w:w, h:h, k:k,
          u0:Math.min(u0,u1), u1:Math.max(u0,u1),
          v0:Math.min(v0,v1), v1:Math.max(v0,v1)};
}

/* Pixel -> case de la grille. Les coordonnées ne sont pas régulières : on
   cherche la case la plus proche, une fois pour toutes. */
function chpTables(cad,Wd,Hd){
  const s=CHP.serie;
  const cle=[CHP.cle,CHP.axe,CHP.indice,Wd,Hd,cad.w|0,cad.h|0].join("|");
  if(CHP.mapCle===cle&&CHP.mapU&&CHP.mapU.length===Wd)return;
  const mu=new Int32Array(Wd), mv=new Int32Array(Hd);
  const proche=function(tab,val){
    let lo=0, hi=tab.length-1;
    if(val<=tab[0])return 0;
    if(val>=tab[hi])return hi;
    while(hi-lo>1){const m=(lo+hi)>>1; if(tab[m]<=val)lo=m; else hi=m;}
    return (val-tab[lo]<=tab[hi]-val)?lo:hi;
  };
  for(let i=0;i<Wd;i++)
    mu[i]=proche(s.u,cad.u0+(i+0.5)/Wd*(cad.u1-cad.u0));
  for(let j=0;j<Hd;j++)
    mv[j]=proche(s.v,cad.v1-(j+0.5)/Hd*(cad.v1-cad.v0));
  CHP.mapU=mu; CHP.mapV=mv; CHP.mapCle=cle;
}

function chpTeinte(val,pleine,signee){
  let t;
  if(CHP.echelle==="db"){
    const a=Math.abs(val)/pleine;
    t=a>0?(1+20*Math.log10(a)/CHP.dyn):0;
  }else if(signee){
    t=0.5+0.5*(val/pleine);
  }else{
    t=val/pleine;
  }
  if(!(t>0))t=0; else if(t>1)t=1;
  return (t*255)|0;
}

function chpDessiner(){
  const cv=aE("chpCanvas");
  if(!cv||typeof cv.getContext!=="function")return;
  const hote=cv.parentElement;
  const box=hote?hote.getBoundingClientRect():{width:520,height:360};
  const W=Math.max(220,Math.floor(box.width-2));
  const H=Math.max(180,Math.floor(box.height-2));
  const dpr=Math.min(2,window.devicePixelRatio||1);
  cv.style.width=W+"px"; cv.style.height=H+"px";
  cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr);
  const c=cv.getContext("2d");
  if(!c)return;
  c.setTransform(dpr,0,0,dpr,0,0);
  const fond=getComputedStyle(document.body).getPropertyValue("--panel")||"#17181b";
  c.fillStyle=fond.trim()||"#17181b";
  c.fillRect(0,0,W,H);

  const s=CHP.serie;
  if(!s){
    c.fillStyle="#8b919c";
    c.font='13px var(--ui, "Segoe UI"), sans-serif';
    c.textAlign="center";
    c.fillText(CHP.occupe?"Lecture des champs…"
               :(CHP.erreur?"—":"Choisissez un enregistrement."),W/2,H/2);
    return;
  }

  const cad=chpCadre(W,H);
  const X0=Math.round(cad.x0*dpr), Y0=Math.round(cad.y0*dpr);
  const Wd=Math.max(1,Math.round(cad.w*dpr)), Hd=Math.max(1,Math.round(cad.h*dpr));
  chpTables(cad,Wd,Hd);

  const vals=chpValeurs();
  if(!vals)return;
  const nu=s.u.length;
  const pleine=chpPleineEchelle();
  const signee=chpSignee();
  const lut=chpLutDe(chpPalette());
  const img=c.createImageData(Wd,Hd);
  const px=img.data;
  const mu=CHP.mapU, mv=CHP.mapV;
  let p=0;
  for(let j=0;j<Hd;j++){
    const base=mv[j]*nu;
    for(let i=0;i<Wd;i++){
      const t=chpTeinte(vals[base+mu[i]],pleine,signee)*3;
      px[p++]=lut[t]; px[p++]=lut[t+1]; px[p++]=lut[t+2]; px[p++]=255;
    }
  }
  c.putImageData(img,X0,Y0);

  chpCuivre(c,cad);
  chpAxes(c,cad,W,H);
  chpBarreCouleur(c,cad,W,H,pleine,signee,lut);
}

/* LE CUIVRE PAR-DESSUS, ET C'EST LUI QUI DONNE SON SENS À LA CARTE. Une
   tache rouge ne dit rien ; la même tache posée sur le bord rayonnant d'un
   patch dit tout. On ne trace que le contour — un remplissage cacherait
   justement ce qu'on est venu voir. */
function chpCuivre(c,cad){
  if(!CHP.cuivre)return;
  const s=CHP.serie;
  if(!s||s.axes_image[0]!=="x"||s.axes_image[1]!=="y")return;
  const m=ANT.modele;
  if(!m||!m.cuivre||!m.cuivre.length)return;
  const px=u=>cad.x0+(u-cad.u0)*cad.k;
  const py=v=>cad.y0+(cad.v1-v)*cad.k;
  c.save();
  c.beginPath();
  c.rect(cad.x0,cad.y0,cad.w,cad.h);
  c.clip();
  c.lineWidth=1;
  c.strokeStyle="rgba(255,255,255,0.45)";
  m.cuivre.forEach(function(couche){
    couche.polys.forEach(function(poly){
      [poly.o].concat(poly.t||[]).forEach(function(ctr){
        if(!ctr||ctr.length<3)return;
        c.beginPath();
        c.moveTo(px(ctr[0][0]),py(ctr[0][1]));
        for(let i=1;i<ctr.length;i++)c.lineTo(px(ctr[i][0]),py(ctr[i][1]));
        c.closePath();
        c.stroke();
      });
    });
  });
  /* Le port : un rectangle jaune, parce que c'est de là que tout part et
     qu'on veut voir le courant le quitter. */
  c.strokeStyle="rgba(242,199,68,0.85)";
  (m.ports||[]).forEach(function(p){
    c.strokeRect(px(p.x1),py(p.y2),(p.x2-p.x1)*cad.k,(p.y2-p.y1)*cad.k);
  });
  c.restore();
}

function chpAxes(c,cad,W,H){
  const s=CHP.serie;
  c.save();
  c.strokeStyle="rgba(139,145,156,0.35)";
  c.lineWidth=1;
  c.strokeRect(cad.x0+0.5,cad.y0+0.5,cad.w,cad.h);
  c.fillStyle="#8b919c";
  c.font='10px var(--mono, monospace)';
  const grad=function(a,b,n){
    const brut=(b-a)/n, e=Math.pow(10,Math.floor(Math.log10(brut)));
    const m=brut/e;
    const pas=(m<=1?1:m<=2?2:m<=5?5:10)*e;
    const out=[];
    for(let v=Math.ceil(a/pas)*pas;v<=b+1e-9;v+=pas)out.push(v);
    return out;
  };
  c.textAlign="center"; c.textBaseline="top";
  grad(cad.u0,cad.u1,6).forEach(function(u){
    const x=cad.x0+(u-cad.u0)*cad.k;
    c.fillText(aNb(u,1),x,cad.y0+cad.h+4);
  });
  c.textAlign="right"; c.textBaseline="middle";
  grad(cad.v0,cad.v1,5).forEach(function(v){
    const y=cad.y0+(cad.v1-v)*cad.k;
    c.fillText(aNb(v,1),cad.x0-5,y);
  });
  c.textAlign="left"; c.textBaseline="top";
  c.fillText(s.axes_image[0]+" (mm)",cad.x0,cad.y0+cad.h+15);
  c.save();
  c.translate(11,cad.y0+cad.h/2);
  c.rotate(-Math.PI/2);
  c.textAlign="center"; c.textBaseline="top";
  c.fillText(s.axes_image[1]+" (mm)",0,0);
  c.restore();
  c.restore();
}

function chpBarreCouleur(c,cad,W,H,pleine,signee,lut){
  const x=W-CHP_MG.d+10, y=cad.y0, h=Math.max(40,cad.h), w=12;
  c.save();
  for(let j=0;j<h;j++){
    const t=(1-j/(h-1))*255|0;
    c.fillStyle="rgb("+lut[t*3]+","+lut[t*3+1]+","+lut[t*3+2]+")";
    c.fillRect(x,y+j,w,1);
  }
  c.strokeStyle="rgba(139,145,156,0.4)";
  c.strokeRect(x+0.5,y+0.5,w,h);
  c.fillStyle="#8b919c";
  c.font='10px var(--mono, monospace)';
  c.textAlign="left"; c.textBaseline="middle";
  if(CHP.echelle==="db"){
    c.fillText("0 dB",x+w+4,y+5);
    c.fillText("−"+CHP.dyn+" dB",x+w+4,y+h-5);
  }else{
    c.fillText(chpExposant(pleine),x+w+4,y+5);
    c.fillText(signee?("−"+chpExposant(pleine)):"0",x+w+4,y+h-5);
    /* L'unité sous la barre, et non couchée à côté : la place à droite est
       déjà prise par des nombres en notation scientifique. */
    c.fillText(chpUnite(CHP.serie.unite),x,y+h+12);
  }
  c.restore();
}

/* Un ordre de grandeur lisible : « 3,4·10⁻³ » plutôt que quinze chiffres. */
function chpExposant(v){
  if(!isFinite(v)||v===0)return "0";
  const e=Math.floor(Math.log10(Math.abs(v)));
  if(e>=-2&&e<=3)return aNb(v,Math.max(0,2-e));
  const m=v/Math.pow(10,e);
  const chiffres="⁻⁰¹²³⁴⁵⁶⁷⁸⁹";
  const exp=String(Math.abs(e)).split("").map(d=>chiffres[+d+1]).join("");
  return aNb(m,1)+"·10"+(e<0?"⁻":"")+exp;
}

/* ==========================================================================
   L'animation
   ========================================================================== */
function chpBoucle(t){
  CHP.anim=0;
  /* UN PANNEAU FERMÉ NE DOIT PAS CONTINUER À CALCULER. Sans cette sortie,
     une animation tourne à soixante images par seconde derrière un panneau
     que personne ne regarde, et fait chauffer le portable pendant le reste
     de la séance. `chpOuvrir` la relance. */
  if(!CHP.serie||(!chpVisible()&&!CHP.enreg)){CHP.horloge=0;return;}
  const dt=CHP.horloge?Math.min(200,t-CHP.horloge):16;
  CHP.horloge=t;
  if(CHP.joue){
    if(CHP.amp&&CHP.pha){
      CHP.phase+=2*Math.PI*CHP.vitesse*dt/CHP_PERIODE;
      if(CHP.phase>2*Math.PI)CHP.phase-=2*Math.PI;
    }else if(CHP.trames&&CHP.trames.length>1){
      CHP.avance=(CHP.avance||0)+CHP_FPS_TEMPOREL*CHP.vitesse*dt/1000;
      if(CHP.avance>=1){
        CHP.trame=(CHP.trame+Math.floor(CHP.avance))%CHP.trames.length;
        CHP.avance-=Math.floor(CHP.avance);
      }
    }
    chpCurseurSync();
  }
  chpDessiner();
  if(CHP.joue||CHP.enreg)chpRelancer();
}

function chpRelancer(){
  if(CHP.anim)return;
  CHP.anim=requestAnimationFrame(chpBoucle);
}

function chpArret(){
  if(CHP.anim)cancelAnimationFrame(CHP.anim);
  CHP.anim=0; CHP.horloge=0;
}

/* ==========================================================================
   L'interface
   ========================================================================== */
function chpVisible(){
  const el=document.querySelector('[data-pnl="champs"]');
  return !!(el&&el.offsetParent!==null);
}

function chpCorpsHtml(){
  return `
<div class="pnl-bar chp-bar" id="chpBarre"></div>
<div class="chp-vue"><canvas id="chpCanvas"></canvas></div>
<div class="pnl-bar chp-bar" id="chpTransport"></div>
<div class="chp-pied" id="chpPied"></div>`;
}

function chpBarres(){
  const b=aE("chpBarre");
  if(!b)return;
  const inv=CHP.inv, s=CHP.serie;
  const nc=s?s.ncomp:3;
  const comps=[["mag","|V| instantané"]];
  if(s&&s.amp)comps.push(["amp","amplitude (enveloppe)"]);
  for(let i=0;i<nc&&i<3;i++)comps.push([String(i),"V"+"xyz"[i]]);

  b.innerHTML=`
<select id="chpSerie" title="Quel champ regarder">
  ${(inv?inv.series:[]).map(x=>'<option value="'+aEsc(x.cle)+'"'+
     (x.cle===CHP.cle?" selected":"")+'>'+aEsc(chpTitre(x))+'</option>').join("")}
</select>
<select id="chpComp" title="Quelle composante">
  ${comps.map(([v,t])=>'<option value="'+v+'"'+(CHP.comp===v?" selected":"")+
    '>'+aEsc(t)+'</option>').join("")}
</select>
<select id="chpEch" title="Échelle des couleurs">
  <option value="lin"${CHP.echelle==="lin"?" selected":""}>linéaire</option>
  <option value="db"${CHP.echelle==="db"?" selected":""}>décibels</option>
</select>
${CHP.echelle==="db"?`<select id="chpDyn" title="Dynamique affichée">
  ${[20,30,40,60,80].map(d=>'<option value="'+d+'"'+(CHP.dyn===d?" selected":"")+
    '>'+d+' dB</option>').join("")}
</select>`:`<label class="chp-gain" title="Éclaircir une carte trop sombre — l'échelle affichée suit">
  ×<input type="range" id="chpGain" min="-1" max="2.5" step="0.05" value="${Math.log10(CHP.gain)}">
  <b>${chpExposant(CHP.gain)}</b></label>`}
<select id="chpPal" title="Palette">
  <option value=""${CHP.palette===""?" selected":""}>palette auto</option>
  <option value="feu"${CHP.palette==="feu"?" selected":""}>feu</option>
  <option value="glace"${CHP.palette==="glace"?" selected":""}>glace-feu</option>
  <option value="gris"${CHP.palette==="gris"?" selected":""}>gris</option>
</select>
<label class="ck mini" title="Contour du cuivre et du port par-dessus la carte"><input type="checkbox" id="chpCu"${CHP.cuivre?" checked":""}> cuivre</label>
${(s&&s.n_tranches>1)?`<span class="chp-tranche">
  <select id="chpAxe" title="Le plan de coupe">
    ${["x","y","z"].map(a=>'<option value="'+a+'"'+(CHP.axe===a?" selected":"")+
      '>⟂ '+a+'</option>').join("")}
  </select>
  <input type="range" id="chpInd" min="0" max="${s.n_tranches-1}" value="${s.indice}"
         title="À quelle hauteur couper">
  <b>${aNb(s.position_mm,2)} mm</b></span>`:""}
<span class="push"></span>
<button class="tb mini" id="chpRafr" title="Relire le dossier de calcul">↻</button>`;

  chpTransport();
  chpPied();
  chpLier();
}

function chpTransport(){
  const t=aE("chpTransport");
  if(!t)return;
  const s=CHP.serie;
  if(!s){t.innerHTML="";return;}
  const continu=!!(CHP.amp&&CHP.pha);
  const n=continu?360:(CHP.trames?CHP.trames.length:1);
  const pos=continu?Math.round(CHP.phase*180/Math.PI):CHP.trame;
  t.innerHTML=`
<button class="tb mini${CHP.joue?" on":""}" id="chpJoue" title="Jouer / arrêter (Espace)">${CHP.joue?"❚❚":"▶"}</button>
<input type="range" id="chpCurseur" min="0" max="${n-1}" value="${pos}"
       title="${continu?"Phase de l'onde":"Pas de temps"}">
<b id="chpPos">${continu?(pos+"°"):((pos+1)+" / "+n)}</b>
<select id="chpVit" title="Vitesse">
  ${[0.25,0.5,1,2,4].map(v=>'<option value="'+v+'"'+(CHP.vitesse===v?" selected":"")+
    '>×'+String(v).replace(".",",")+'</option>').join("")}
</select>
<span class="push"></span>
<button class="tb mini" id="chpPng" title="Enregistrer l'image affichée">🖼 PNG</button>
${(typeof MediaRecorder!=="undefined")?
 `<button class="tb mini${CHP.enreg?" danger":""}" id="chpFilm"
   title="Enregistrer l'animation en vidéo .webm">${CHP.enreg?"■ arrêter":"⏺ film"}</button>`:""}`;
}

function chpCurseurSync(){
  const c=aE("chpCurseur"), p=aE("chpPos");
  if(!c||!p)return;
  const continu=!!(CHP.amp&&CHP.pha);
  if(continu){
    const d=Math.round(CHP.phase*180/Math.PI)%360;
    c.value=d; p.textContent=d+"°";
  }else{
    c.value=CHP.trame;
    p.textContent=(CHP.trame+1)+" / "+(CHP.trames?CHP.trames.length:1);
  }
}

function chpPied(){
  const el=aE("chpPied");
  if(!el)return;
  if(CHP.erreur){
    const i=CHP.erreur.indexOf("\n");
    el.innerHTML='<p class="note alerte"><b>'+
      aEsc(i>0?CHP.erreur.slice(0,i):CHP.erreur)+'</b>'+
      (i>0?"<br>"+aEsc(CHP.erreur.slice(i+1)):"")+'</p>';
    return;
  }
  const s=CHP.serie;
  if(!s){el.innerHTML='<p class="note">Aucun champ chargé.</p>';return;}
  const sous=(s.sous_ech&&(s.sous_ech[0]>1||s.sous_ech[1]>1))
    ? '<span class="alerte">affiché une case sur '+s.sous_ech[0]+
      (s.sous_ech[1]!==s.sous_ech[0]?("×"+s.sous_ech[1]):"")+
      ' — la carte est complète, la finesse non</span>' : "";
  const v=CHP.survol;
  /* UNE CARTE PÉRIMÉE NE DOIT PAS SE FAIRE PASSER POUR LA BONNE. On relance
     un calcul, on revient au panneau resté ouvert : il montre encore les
     champs d'AVANT, et rien à l'écran ne le dit. C'est la pire façon de se
     tromper — on conclut sur la modification qu'on vient de faire, en
     regardant l'image d'avant elle. */
  /* DEUX FAÇONS DE NE PAS REGARDER LE DERNIER CALCUL, et elles n'appellent
     pas la même phrase. On l'a CHOISI — un dossier pris dans la liste du
     projet, ou importé — et il faut alors dire lequel, et comment revenir.
     Ou bien on ne l'a pas choisi : le panneau était resté ouvert pendant
     qu'une simulation se relançait, et là c'est un avertissement. */
  const vieux=ANT.tache&&ANT.tache.id&&ANT.tache.id!==CHP.id;
  const tete=CHP.force
    ? ('<p class="note">Dossier de calcul choisi : <b>'+
       aEsc(CHP.forceNom||CHP.force)+'</b>. Le bouton ↻ le relit ; '+
       '« 🎞 Voir les champs », à l\'étape « Le calcul », revient au dernier '+
       'calcul.</p>')
    : (vieux?'<p class="note alerte">Ces champs sont ceux d\'un '+
       'calcul précédent. Le bouton ↻ relit le dernier.</p>':"");
  el.innerHTML=tete+
`<div class="chp-info">
  <span>${aEsc(chpTitre(s))}</span>
  <span>${s.u.length} × ${s.v.length} points dans le plan ${aEsc(s.axes_image.join("–"))}</span>
  ${s.n_tranches>1?'<span>coupe ⟂'+aEsc(s.axe)+' à '+aNb(s.position_mm,3)+' mm</span>':""}
  <span>maximum ${chpExposant(s.max)} ${aEsc(chpUnite(s.unite))}</span>
  ${s.mode==="temporel"?'<span>'+s.n_rendues+" images sur "+s.n_total+"</span>":""}
  ${sous}
  ${v?'<span class="chp-lu">en ('+aNb(v.u,2)+" ; "+aNb(v.v,2)+") : <b>"+
      chpExposant(v.val)+" "+aEsc(chpUnite(s.unite))+"</b></span>":""}
</div>`;
}

function chpLier(){
  const q=id=>aE(id);
  const surSerie=q("chpSerie");
  if(surSerie)surSerie.onchange=function(){
    CHP.cle=this.value; CHP.axe=""; CHP.indice=-1; chpCharger();
  };
  const c=q("chpComp");
  if(c)c.onchange=function(){CHP.comp=this.value;chpBarres();chpDessiner();};
  const e=q("chpEch");
  if(e)e.onchange=function(){CHP.echelle=this.value;chpBarres();chpDessiner();};
  const d=q("chpDyn");
  if(d)d.onchange=function(){CHP.dyn=+this.value;chpDessiner();};
  const g=q("chpGain");
  if(g)g.oninput=function(){
    CHP.gain=Math.pow(10,+this.value);
    const b=this.parentElement.querySelector("b");
    if(b)b.textContent=chpExposant(CHP.gain);
    chpDessiner();
  };
  const p=q("chpPal");
  if(p)p.onchange=function(){CHP.palette=this.value;chpDessiner();};
  const cu=q("chpCu");
  if(cu)cu.onchange=function(){CHP.cuivre=this.checked;chpDessiner();};
  const ax=q("chpAxe");
  if(ax)ax.onchange=function(){CHP.axe=this.value;CHP.indice=-1;chpCharger();};
  const ind=q("chpInd");
  if(ind)ind.onchange=function(){CHP.indice=+this.value;chpCharger();};
  const r=q("chpRafr");
  if(r)r.onclick=function(){chpOuvrir(true);};

  const j=q("chpJoue");
  if(j)j.onclick=function(){
    CHP.joue=!CHP.joue; chpTransport(); chpLier();
    if(CHP.joue)chpRelancer(); else {chpArret();chpDessiner();}
  };
  const cur=q("chpCurseur");
  if(cur)cur.oninput=function(){
    CHP.joue=false;
    if(CHP.amp&&CHP.pha)CHP.phase=(+this.value)*Math.PI/180;
    else CHP.trame=+this.value;
    chpCurseurSync(); chpTransport(); chpLier(); chpDessiner();
  };
  const v=q("chpVit");
  if(v)v.onchange=function(){CHP.vitesse=+this.value;};
  const png=q("chpPng");
  if(png)png.onclick=chpPng;
  const film=q("chpFilm");
  if(film)film.onclick=chpFilm;

  const cv=q("chpCanvas");
  if(cv){
    cv.onmousemove=chpSurvol;
    cv.onmouseleave=function(){CHP.survol=null;chpPied();};
  }
}

function chpSurvol(ev){
  const s=CHP.serie;
  if(!s)return;
  const cv=ev.currentTarget, r=cv.getBoundingClientRect();
  const cad=chpCadre(r.width,r.height);
  const x=ev.clientX-r.left, y=ev.clientY-r.top;
  if(x<cad.x0||x>cad.x0+cad.w||y<cad.y0||y>cad.y0+cad.h){
    CHP.survol=null; chpPied(); return;
  }
  const u=cad.u0+(x-cad.x0)/cad.k, v=cad.v1-(y-cad.y0)/cad.k;
  const proche=function(tab,val){
    let k=0, d=Infinity;
    for(let i=0;i<tab.length;i++){
      const e=Math.abs(tab[i]-val);
      if(e<d){d=e;k=i;}
    }
    return k;
  };
  const vals=CHP.buf||chpValeurs();
  if(!vals)return;
  const i=proche(s.u,u), j=proche(s.v,v);
  CHP.survol={u:s.u[i],v:s.v[j],val:vals[j*s.u.length+i]};
  chpPied();
}

/* ==========================================================================
   Emporter ce qu'on voit
   ========================================================================== */
function chpNomFichier(ext){
  const n=(ANT.modele&&ANT.modele.nom?ANT.modele.nom:"antenne")
          .replace(/\.[^.]*$/,"").replace(/[^\w-]+/g,"_");
  const s=CHP.serie;
  const c={mag:"module",amp:"amplitude","0":"x","1":"y","2":"z"}[CHP.comp]||CHP.comp;
  return n+"_"+(s?s.nom:"champ")+"_"+c+"."+ext;
}

function chpPng(){
  const cv=aE("chpCanvas");
  if(!cv||!cv.toBlob)return;
  cv.toBlob(function(b){
    if(b)telecharger(b,chpNomFichier("png"));
    hint("Image enregistrée.");
  });
}

/* LE FILM EST CELUI QU'ON REGARDE, ET NON UN RENDU SÉPARÉ. On capte le flux
   du canevas : ce qui part dans le fichier est exactement ce qui est à
   l'écran, palette, contour du cuivre et échelle compris. Un cycle complet
   suffit — une onde périodique n'a rien à dire de plus au second tour. */
function chpFilm(){
  const cv=aE("chpCanvas");
  if(!cv||typeof MediaRecorder==="undefined"||!cv.captureStream)return;
  if(CHP.enreg){ CHP.enreg.stop(); return; }
  let flux, rec;
  try{
    flux=cv.captureStream(30);
    rec=new MediaRecorder(flux,{mimeType:"video/webm"});
  }catch(e){
    hint("Enregistrement vidéo impossible : "+(e.message||e));
    return;
  }
  const morceaux=[];
  rec.ondataavailable=e=>{ if(e.data&&e.data.size)morceaux.push(e.data); };
  rec.onstop=function(){
    CHP.enreg=null;
    telecharger(new Blob(morceaux,{type:"video/webm"}),chpNomFichier("webm"));
    hint("Animation enregistrée.");
    chpTransport(); chpLier();
  };
  CHP.enreg=rec;
  CHP.joue=true;
  CHP.phase=0; CHP.trame=0;
  rec.start();
  chpRelancer();
  chpTransport(); chpLier();
  /* La durée d'un cycle, à la vitesse courante — ou quatre secondes pour une
     série temporelle, qui n'a pas de période. */
  const duree=(CHP.amp&&CHP.pha)?CHP_PERIODE/CHP.vitesse
    :Math.min(20000,1000*(CHP.trames?CHP.trames.length:24)/
              (CHP_FPS_TEMPOREL*CHP.vitesse));
  setTimeout(function(){ if(CHP.enreg===rec)rec.stop(); },duree+250);
}

/* ==========================================================================
   Ouverture
   ========================================================================== */
/* DÉTACHÉ PLUTÔT QU'EMPILÉ DANS UN DOCK, à la première ouverture. Le dock du
   bas fait deux cents pixels de haut : une carte de champ y serait une bande
   illisible, et il faudrait redimensionner avant de voir quoi que ce soit.
   Une fois le panneau rangé où l'on veut, on n'y touche plus — « masqué » est
   le seul état qui appelle une décision de notre part. */
function chpMontrer(){
  if(typeof wsPlaceOf!=="function")return;
  if(wsPlaceOf("champs")==="hidden"){
    if(typeof wsToggleFloat==="function")wsToggleFloat("champs");
    else if(typeof wsShow==="function")wsShow("champs");
  }else if(wsPlaceOf("champs")==="float"&&typeof wsRaise==="function"){
    wsRaise("champs");
  }
}

async function chpOuvrir(recharger){
  chpMontrer();
  /* ON NE REMPLACE PAS L'ACCUEIL PAR UN CANEVAS NOIR TANT QU'ON N'A RIEN.
     Le cas le plus fréquent n'est pas la réussite, c'est « aucun champ
     enregistré » — la case se coche avant de lancer, et l'on y pense après.
     Ce refus-là doit rester lisible, avec son explication et son bouton, et
     non se réduire à une ligne sous une carte vide. */
  try{
    if(recharger||!CHP.inv||CHP.id!==chpCible()){
      CHP.erreur="";
      await chpInventaire();
      CHP.serie=null;
    }
  }catch(e){
    CHP.inv=null; CHP.serie=null; CHP.erreur=String(e.message||e);
    chpArret();
    chpAccueil();
    return;
  }

  const corps=aE("champsCorps");
  if(corps&&!aE("chpCanvas")){corps.innerHTML=chpCorpsHtml();chpObserver();}
  if(!CHP.serie)await chpCharger();
  chpBarres();
  chpDessiner();
  chpRelancer();
}

/* OUVRIR UN DOSSIER DE CALCUL DÉSIGNÉ, et non « le dernier ».

   Appelée par la liste des calculs du projet (18-champs.js). Passer
   l'identifiant de la tâche en cours équivaut à revenir au comportement
   ordinaire : le forçage se lève de lui-même, et le panneau suivra de
   nouveau les simulations à venir. */
async function chpOuvrirCalcul(ident,etiquette){
  const id=String(ident||"");
  const courant=(ANT.tache&&ANT.tache.id)||"";
  CHP.force=(!id||id===courant)?"":id;
  CHP.forceNom=CHP.force?String(etiquette||""):"";
  await chpOuvrir(true);
}

/* UN NOUVEAU CALCUL LÈVE LE DOSSIER CHOISI À LA MAIN.

   Sans cela, on regarde le calcul d'avant-hier, on relance une simulation,
   et le panneau continue de montrer avant-hier — en toute discrétion, sur
   une géométrie qui n'est plus celle qu'on vient de modifier. C'est la même
   faute que l'avertissement « ces champs sont ceux d'un calcul précédent »
   sert à éviter, et il vaut mieux la rendre impossible que la signaler.

   On enveloppe les trois lancements plutôt que d'aller poser une ligne dans
   chacun : c'est le procédé qu'emploient déjà 28-projet.js et l'ouverture du
   panneau juste en dessous. */
(function(){
  for(const nom of ["oeLancer","oeLancerBalayage","oeLancerTableauS"]){
    const base=window[nom];
    if(typeof base!=="function")continue;
    window[nom]=function(){
      CHP.force=""; CHP.forceNom="";
      return base.apply(this,arguments);
    };
  }
})();

/* LE PANNEAU CHANGE DE TAILLE SANS QUE LA FENÊTRE BOUGE — on tire une
   poignée de dock, on replie un voisin, on détache le panneau. Écouter
   `resize` sur la fenêtre raterait tous ces cas et laisserait une carte
   étirée dans un canevas qui a grandi. */
function chpObserver(){
  const vue=document.querySelector(".chp-vue");
  if(!vue||CHP.obs||typeof ResizeObserver!=="function")return;
  CHP.obs=new ResizeObserver(function(){
    if(chpVisible())chpDessiner();
  });
  CHP.obs.observe(vue);
}

/* CE QUE LE PANNEAU DIT AVANT D'AVOIR QUOI QUE CE SOIT À MONTRER. Il
   s'ouvre aussi par le menu « Espace de travail », et un panneau vide qui
   s'ouvre sur du noir laisse croire à une panne. */
function chpAccueil(){
  const corps=aE("champsCorps");
  if(!corps)return;
  const e=CHP.erreur, i=e?e.indexOf("\n"):-1;
  corps.innerHTML=`
<div class="chp-accueil">
  ${e?'<p class="note alerte"><b>'+aEsc(i>0?e.slice(0,i):e)+'</b>'+
      (i>0?"<br>"+aEsc(e.slice(i+1)):"")+'</p>'
    :"<b>Rien à montrer pour l'instant.</b>"}
  <p>La carte de champ se lit dans les fichiers qu'openEMS écrit pendant le
     calcul — et il ne les écrit que si <b>« Enregistrer les champs »</b> a
     été coché <b>avant</b> de lancer, à l'étape « Le calcul » de
     l'assistant. Un calcul déjà fait ne peut plus en produire.</p>
  <button class="tb" id="chpCharge">🎞 Charger les champs du dernier calcul</button>
</div>`;
  const b=aE("chpCharge");
  if(b)b.onclick=function(){
    /* « du dernier calcul » : le bouton dit ce qu'il fait, donc il lève un
       forçage laissé par un dossier choisi à la main. */
    chpOuvrirCalcul(ANT.tache&&ANT.tache.id);
  };
}

(function chpInit(){
  let min=0;
  window.addEventListener("resize",function(){
    if(min)return;
    min=setTimeout(function(){min=0;if(chpVisible())chpDessiner();},120);
  });
  /* Le panneau se rouvre aussi par le menu « Espace de travail ». On
     enveloppe `wsShow` comme le fait deja 28-projet.js, et dans un
     DOMContentLoaded pour la meme raison : 90-workspace.js vient APRES ce
     fichier, et la fonction n'existe pas encore a ce moment-la. */
  window.addEventListener("DOMContentLoaded",function(){
    chpAccueil();
    const base=window.wsShow;
    if(typeof base==="function")window.wsShow=function(id){
      const out=base.apply(this,arguments);
      if(id==="champs")chpOuvrir();
      return out;
    };
  });

  document.addEventListener("keydown",function(e){
    if(e.key!==" "||!chpVisible())return;
    if(e.target&&/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;
    e.preventDefault();
    const j=aE("chpJoue");
    if(j)j.click();
  });
})();
