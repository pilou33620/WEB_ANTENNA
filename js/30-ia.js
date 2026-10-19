"use strict";
/* =============================================================================
   Antenne openEMS — 30-ia.js
   Assistant IA technique — Google AI Studio, ou un modèle local compatible
   OpenAI (Ollama, LM Studio…).

   LA MÊME INTERFACE QUE CELLE DE WEB_CAO, et ce n'est pas un hasard : les
   modules 00 à 06 de cet outil viennent de la visionneuse de WEB_CAO
   (https://github.com/pilou33620/WEB_CAO), l'espace de travail est le même,
   le thème est le même — et `js/04-interaction.js` appelle déjà
   `iaAfficherMenuContextuel` sur le clic droit, en attendant ce fichier. Le
   panneau, la barre de connexion, la barre d'état, les bulles, les puces de
   questions, le manuel local, les cartes d'action et le menu contextuel sont
   donc repris tels quels de `commun/ia-assistant.js`. Ce qui change est ce qui
   DOIT changer : le contexte transmis, ce que l'assistant sait du domaine, et
   ce qu'une carte d'action a le droit d'écrire.

   GESTION STRICTE DE LA CLÉ API — la règle de WEB_CAO, sans exception :
   - la clé ne vit qu'en mémoire vive et dans le `sessionStorage` de l'onglet ;
   - à chaque fermeture du panneau (✕, Alt+I, Échap, « Oublier clé »), elle est
     effacée — `_cleApi = ""` — et redemandée à la prochaine ouverture ;
   - aucun `localStorage`, aucun cookie, aucun profil, aucun projet.
   Le serveur peut la donner sans qu'on la tape : `GET /api/ia/cle` rend ce
   qu'il trouve dans `api_key_free_ia_studio.txt` ou dans `GEMINI_API_KEY`.

   CE QUE L'ASSISTANT NE FAIT PAS, ET C'EST LA RÈGLE QUI COMMANDE LE RESTE.
   Il n'écrit rien lui-même. Il propose, l'utilisateur applique. Une valeur
   proposée est validée contre une liste blanche de chemins (`IA_CHAMPS`),
   bornée, affichée avec l'avant en face de l'après, et elle ne devient un
   réglage qu'au clic sur la carte d'action. C'est le seul endroit de l'outil
   où du texte venu du réseau touche l'état d'une simulation, et c'est pour
   cela que la barrière est étroite et que le banc l'éprouve.

   DEUX CHOSES SE FONT SANS RÉSEAU NI CLÉ, comme le manuel de WEB_CAO :
   `help` rend le manuel, et `verifier` rend l'audit des réglages — une liste
   de règles écrites ici, en clair, avec leurs corrections en cartes d'action.
   Zéro jeton, zéro requête, et cela marche sur un poste débranché.
   ============================================================================= */

(function(){

  /* ==========================================================================
     État privé éphémère
     ========================================================================== */
  let _cleApi = "";               // EN MÉMOIRE VIVE. Jamais localStorage.
  let _modele = "gemma-4-31b-it";
  let _historique = [];           // les messages de la session en cours
  let _enAttente = false;
  let _etape = "";               // ce que l'assistant consulte pendant l'attente
  let _inclureContexte = true;    // transmettre l'état des réglages
  let _domConstruit = false;
  let _questionEnAttente = "";    // question préparée depuis le menu contextuel

  /* Les cartes d'action déjà rendues, par leur charge utile encodée. Elles
     survivent au réaffichage de la liste : sans cela, poser une seconde
     question ferait réapparaître « Appliquer » sur un réglage déjà appliqué,
     et on l'appliquerait deux fois sans le voir. */
  const _actions = new Map();

  const IA_SESSION_CLE = "openems_ia_cle";
  const IA_URL = "https://generativelanguage.googleapis.com/v1beta/models/";

  /* LE SECOND FOURNISSEUR : UN MODÈLE LOCAL, compatible OpenAI — Ollama,
     LM Studio, llama.cpp, vLLM parlent tous `/v1/chat/completions`. Il tient
     dans la même fonction d'appel (`requeteIa`) : une URL et une forme de
     corps, le reste ne bouge pas — même contexte, même consigne, même
     nettoyage, même rendu échappé, même barrière `IA_CHAMPS` derrière les
     cartes. Son choix vit COMME LA CLÉ : en mémoire vive et dans le
     `sessionStorage` de l'onglet, oublié à la fermeture du panneau. Pas de
     clé : un serveur local n'en demande pas, et en inventer une ici serait
     une seconde chose à garder. */
  let _fournisseur = "google";      // "google" | "local"
  let _local = {url:"http://localhost:11434", modele:""};
  const IA_SESSION_LOCAL = "openems_ia_local";

  /* Le contexte, les outils de lecture et leurs aides vivent dans 29-lecture-antenna.js,
     partagés avec le canal de pilotage de web_suite. */
  const { contexte: extraireContexteOpenems, carte: OUTILS_CARTE, balayage: OUTIL_BALAYAGE } = LECTURE_ANTENNA;
  const { nb, nbp, fHz, uniteDoc, balayageTermine, resultatCourant, s11ALaCible } = LECTURE_ANTENNA.aides;

  /* ==========================================================================
     Suggestions rapides
     --------------------------------------------------------------------------
     Elles changent selon ce qui est ouvert, comme celles de WEB_CAO changent
     selon l'éditeur : on ne pose pas la même question devant une page blanche,
     devant une antenne dessinée, et devant une courbe qui vient de revenir.
     ========================================================================== */
  const SUGGESTIONS = {
    vide: [
      "Quel substrat choisir pour un patch 2,45 GHz ?",
      "Quelle taille de carte faut-il prévoir pour une antenne à 868 MHz ?",
      "Monopôle, IFA ou patch : lequel pour un objet connecté ?",
      "Que faut-il régler avant de lancer une première simulation FDTD ?"
    ],
    regle: [
      "Relis mes réglages et dis-moi lequel est le plus douteux.",
      "Quel maillage faut-il ici, et pourquoi celui-là ?",
      "Ma marge d'air et ma PML sont-elles cohérentes avec la bande ?",
      "Quelle cote balayer en premier pour gagner le plus ?"
    ],
    resultat: [
      "Ma résonance n'est pas où je la veux : que corriger en premier ?",
      "Mon S11 ne descend pas : est-ce la longueur ou le point d'alimentation ?",
      "Ce résultat est-il crédible ? Qu'est-ce qui pourrait le rendre faux ?",
      "Comment élargir la bande passante de cette antenne ?"
    ]
  };

  function jeuDeSuggestions(){
    if(typeof ANT === "undefined") return SUGGESTIONS.vide;
    if(ANT.resultat) return SUGGESTIONS.resultat;
    if(typeof V !== "undefined" && V.modele) return SUGGESTIONS.regle;
    return SUGGESTIONS.vide;
  }


  /* ==========================================================================
     LES OUTILS DE LECTURE
     --------------------------------------------------------------------------
     Le contexte ci-dessus est un RESUME : il garde ce que les cartes d'action
     exigent (couches, ports, cotes balayables), et rien de ce qui peut peser
     lourd. Le detail de la carte importee et le tableau d'un balayage, le
     modele les demande lui-meme par un bloc ```outil, et la page ne lui rend
     que ce qu'il a demande. Ces reponses servent a la question en cours et ne
     restent PAS dans l'historique. Meme mecanique que WEB_CAO
     (commun/ia-assistant.js), et pour la meme raison : un bloc de texte
     passe par tous les modeles, Gemma, Gemini ou un serveur local.
     ========================================================================== */
  const OUTIL_MAX = 12000;   // caracteres rendus par un appel
  const OUTIL_TOURS = 4;     // allers-retours au plus pour une question


  function outilsLecture(){
    if(!_inclureContexte) return {};
    const o = {};
    if(typeof V !== "undefined" && V.modele && !(typeof CON !== "undefined" && CON.actif))
      Object.assign(o, OUTILS_CARTE);
    if(balayageTermine()) Object.assign(o, OUTIL_BALAYAGE);
    return o;
  }

  function consigneOutils(outils){
    const noms = Object.keys(outils);
    if(!noms.length) return "";
    return ["",
"OUTILS DE LECTURE. Le contexte joint a la question est un RESUME. Quand la",
"reponse demande un detail (un composant, un net de la carte, le tableau d'un",
"balayage), DEMANDE-LE avant de repondre : ecris seulement un ou plusieurs",
"blocs, sans autre texte :",
"```outil",
'{"outil":"nets","filtre":"ANT"}',
"```",
"La page te renvoie les donnees, puis tu reponds. Ne demande que ce dont la",
"question a besoin ; n'invente jamais une donnee que tu peux demander. Au plus " + OUTIL_TOURS,
"allers-retours. Outils disponibles :"]
      .concat(noms.map(n => "- " + n + (outils[n].args ? (" {" + outils[n].args + "}") : "") +
                            " : " + outils[n].desc)).join("\n");
  }

  /* Les blocs ```outil d'une reponse, executes. Rend null s'il n'y en a pas. */
  function executerOutils(texte, outils){
    const blocs = [...texte.matchAll(/```outil\s*\n([\s\S]*?)```/g)];
    if(!blocs.length) return null;
    return blocs.slice(0, 8).map(function(b){
      let a;
      try{ a = JSON.parse(b[1]); }
      catch(e){ return {titre:"?", texte:"Bloc illisible : JSON attendu, par exemple {\"outil\":\"nets\"}."}; }
      const o = outils[a.outil];
      const arg = a.nom || a.ref || a.filtre;
      const titre = a.outil + (arg ? (" " + arg) : "");
      if(!o) return {titre:titre, texte:"Outil « " + a.outil + " » inconnu. Outils : " + Object.keys(outils).join(", ") + "."};
      let t;
      try{ t = [].concat(o.fn(a)).join("\n"); }catch(e){ t = "Echec de l'outil : " + e.message; }
      if(t.length > OUTIL_MAX) t = t.slice(0, OUTIL_MAX) + "\n... (tronque a " + OUTIL_MAX + " caracteres : demande plus cible)";
      return {titre:titre, texte:t};
    });
  }


  /* Le registre des cartes et l'audit vivent dans 31-cartes-antenna.js (CARTES_ANTENNA). */
  const { CHAMPS: IA_CHAMPS, FORMES_MAX: IA_FORMES_MAX, PTS_MAX: IA_PTS_MAX, resoudre, valider,
          valeurTexte, proposition, appliquer, annuler, controles, grammaire } = CARTES_ANTENNA;

  /* L'audit, écrit en markdown avec ses corrections en blocs ```action.

     IL PASSE PAR LE MÊME RENDU QUE LA RÉPONSE DU MODÈLE, et c'est voulu : une
     correction locale et une correction proposée par l'IA donnent la même
     carte, avec la même barrière derrière. Deux chemins de rendu auraient fini
     par diverger, et c'est celui qui écrit dans l'état qu'on ne veut pas voir
     diverger. */
  function genererAuditLocal(){
    const l = controles();
    const rang = {grave:0, attention:1, info:2};
    const ico = {grave:"🔴", attention:"🟡", info:"🔵"};
    const tri = l.slice().sort((a, b) => (rang[a.rang] || 9) - (rang[b.rang] || 9));
    const graves = l.filter(a => a.rang === "grave").length;

    let t = "### 🔎 Vérification locale des réglages\n\n" +
            "*(Audit exécuté en local par l'outil — 0 jeton API consommé, " +
            "aucune donnée n'est sortie du poste)*\n\n";
    t += graves
      ? ("**" + graves + " faute(s) grave(s)** relevée(s) sur " + l.length +
         " remarque(s).\n\n---\n\n")
      : ("**Aucune faute grave** sur " + l.length + " remarque(s).\n\n---\n\n");

    tri.forEach(function(a){
      t += "### " + (ico[a.rang] || "•") + " " + a.titre + "\n";
      t += a.texte + "\n\n";
      if(a.prop)
        t += "```action\n" + JSON.stringify(a.prop) + "\n```\n\n";
    });

    t += "---\n\n*Ces règles portent sur ce que le serveur ne peut pas voir : " +
         "l'intention. Elles ne disent pas que l'antenne est bonne, seulement " +
         "que rien ne les alerte dans la façon dont la simulation est réglée. " +
         "Tapez `help` pour le manuel complet.*";
    return t;
  }

  /* ==========================================================================
     Le manuel local — celui de WEB_CAO, écrit pour cet outil-ci
     ========================================================================== */
  function estCommandeAide(txt){
    if(!txt) return false;
    const s = txt.trim().toLowerCase();
    return s === "help" || s === "/help" || s === "aide" || s === "/aide" ||
           s === "?" || s === "man" || s === "manuel";
  }
  function estCommandeAudit(txt){
    if(!txt) return false;
    const s = txt.trim().toLowerCase().replace(/^\//, "");
    return s === "verifier" || s === "vérifier" || s === "verif" ||
           s === "check" || s === "reglages" || s === "réglages" ||
           s === "audit";
  }
  function estCommandeVider(txt){
    if(!txt) return false;
    const s = txt.trim().toLowerCase().replace(/^\//, "");
    return s === "clear" || s === "effacer";
  }

  function genererManuelLocal(){
    return (
      "### 📖 Manuel de l'assistant — Antenne openEMS\n\n" +
      "*(Manuel généré instantanément en local par l'application — 0 jeton API consommé)*\n\n" +
      "---\n\n" +
      "### 1. 🔎 Vérification locale des réglages (sans réseau, sans clé)\n" +
      "Tapez **`verifier`** — ou faites un clic droit sur la carte — pour lancer un audit complet des réglages de simulation. Il applique une liste de règles écrites dans l'outil, et **aucune donnée ne sort du poste**. Ce qu'il attrape :\n" +
      "- **La bande et la cible** : une fréquence visée hors de la bande simulée, une bande trop étroite pour qu'un creux y apparaisse, une bande hors du vraisemblable — c'est-à-dire une faute d'unité.\n" +
      "- **Le cuivre et l'empilage** : rien de désigné pour le solveur, un intervalle sans épaisseur saisie.\n" +
      "- **Les ports** : aucun port posé, un port qui relie une couche à elle-même, un coaxial qui ne fait pas son impédance de référence.\n" +
      "- **L'arrêt** : un garde-fou qui coupera avant que l'énergie soit descendue — une transformée sur une descente tronquée n'est pas une mesure.\n" +
      "- **Le maillage** : moins de trois cellules en travers de la ligne d'alimentation, le cas exact qui fait disparaître la résonance d'un patch.\n" +
      "- **L'empilage dessiné** : une couche déclarée masse qui ne porte aucun cuivre — le dipôle imprimé posé en géométrie libre, dont la seconde couche reste « masse » d'usine.\n" +
      "- **Le dernier résultat** : une résonance au bord de la bande, un écart à la cible *avec le sens de la correction*, une désadaptation en séparant ce qui vient de la réactance de ce qui vient de la partie réelle.\n" +
      "- **Un balayage terminé** : où est le meilleur point, chiffres à l'appui, et s'il est **au bord** de la plage balayée — cote par cote, coin compris sur un croisement. Un optimum de bord n'est que le meilleur des points essayés.\n\n" +
      "---\n\n" +
      "### 2. ⚡ Cartes d'action — les réglages appliqués en 1 clic\n" +
      "L'assistant ne se contente pas d'expliquer : quand il préconise des valeurs, il produit une **carte d'action cliquable** qui montre **l'avant en face de l'après** avant d'écrire quoi que ce soit.\n" +
      "- **Réglages de simulation** : bande, marges d'air, PML, pas de maillage, arrêt, modèle de pertes, cotes et impédance d'un port.\n" +
      "- **Cotes d'un motif** (mode conception) : longueur, largeur, encastrement, encoches… La carte peut se contenter de mettre la fiche à jour, ou redessiner le motif.\n" +
      "- **Géométrie libre** (mode conception) : des rectangles, des disques, des polygones, des pistes, des vias et des découpes posés aux coordonnées données, avec la taille de carte et le port qui vont avec. C'est le recours quand aucun des six motifs ne trace l'antenne voulue — la carte liste **chaque forme** avant de rien poser, et un motif reste préférable dès qu'il en existe un, parce que lui seul tient une fiche et se balaye.\n" +
      "- **Balayage** : armer une cote, une plage et un pas — l'étape « Le calcul » en donne le devis avant de lancer.\n" +
      "- *Barrière* : tout passe par une **liste blanche** de chemins, bornée champ par champ. Un chemin hors liste ou une valeur hors bornes est **refusé et affiché comme tel**, jamais écrit en silence.\n" +
      "- *Annulation* : une carte appliquée reste **annulable** tant que la conversation est ouverte.\n\n" +
      "---\n\n" +
      "### 3. 🖱️ Inspection contextuelle par clic droit\n" +
      "Faites un **clic droit** sur la carte pour lancer un diagnostic :\n" +
      "- **🔎 Vérifier les réglages** : l'audit local, sans consommer de jeton.\n" +
      "- **📐 Analyser le net cuivre** : quand un net est désigné, l'IA reçoit son cuivre, ses couches et son rôle dans le modèle.\n" +
      "- **🔍 Inspecter le composant** : le repère et ce que le fichier en dit.\n" +
      "- **✏️ Analyser le motif dessiné** : les cotes posées, celles du calcul, et l'écart entre les deux.\n" +
      "- **💬 Poser une question technique…** : ouvre simplement le panneau.\n\n" +
      "---\n\n" +
      "### 4. ⌨️ Commandes locales & raccourcis clavier\n" +
      "- **`help`** ou **`aide`** : affiche ce manuel (local, 0 requête réseau, 0 jeton).\n" +
      "- **`verifier`** : lance l'audit des réglages (local, 0 jeton).\n" +
      "- **`clear`** ou **`effacer`** : vide la conversation active.\n" +
      "- **`Alt + I`** : affiche ou masque le panneau IA.\n" +
      "- **`Échap`** : ferme le panneau quand le curseur est dedans.\n" +
      "- **`Entrée`** : envoyer · **`Maj + Entrée`** : saut de ligne.\n\n" +
      "---\n\n" +
      "### 5. 🔒 Sécurité, clé API éphémère et données transmises\n" +
      "- **Zéro stockage persistant** : la clé Google AI Studio ne vit qu'en mémoire vive et dans le `sessionStorage` de cet onglet.\n" +
      "- **Purge automatique** : à la fermeture du panneau (✕, Alt+I, Échap, *« Oublier clé »*), elle est effacée et redemandée à la prochaine ouverture.\n" +
      "- **Sans la taper** : posez-la dans `api_key_free_ia_studio.txt` à la racine du dépôt, ou dans la variable d'environnement `GEMINI_API_KEY` — le serveur la rendra à la page, et le fichier est ignoré par git.\n" +
      "- **Ce qui est transmis** quand *« Contexte projet »* est coché : le **résumé** des réglages — bande, empilage, cuivre retenu en nombre d'objets, ports, boîte, maillage, arrêt, chiffres du serveur, motif ouvert, cotes balayables, dernier résultat. **Ni le fichier IPC-2581, ni les polygones de cuivre, ni les courbes.**\n" +
      "- **Un modèle local** : choisissez « Local » dans la barre de connexion, donnez l'adresse du serveur (`http://localhost:11434` pour Ollama) et le nom du modèle. Le même résumé part alors vers CE serveur, et nulle part ailleurs ; aucune clé ne lui est envoyée. Choix oublié à la fermeture, comme la clé.\n" +
      "- **Sans réseau** : le manuel et la vérification des réglages marchent quand même. C'est pour cela qu'ils existent."
    );
  }

  function promptSysteme(){
    return [
"Tu es l'ingenieur antennes de l'outil « Antenne openEMS » : une page qui mene",
"une carte imprimee — importee d'un fichier IPC-2581 ou dessinee sur place —",
"jusqu'a une simulation FDTD openEMS, et qui en rend le S11, l'impedance",
"d'entree et le diagramme de rayonnement.",
"",
"CONTEXTE : cet outil, WEB_ANTENNA, fait partie de WEB·SUITE, trois outils web",
"locaux lances depuis un meme lanceur : WEB_CAO (schema, PCB, bibliotheque,",
"visionneuse IPC-2581, simulations SI / PI / RF), WEB_ANTENNA (cet outil) et",
"WEB_3D (visionneuse 3D STEP, mesure, assemblage). La carte importee ici est",
"en general un export IPC-2581 de WEB_CAO : une modification du cuivre se fait",
"dans l'editeur PCB de WEB_CAO, puis la carte se reexporte. Lance depuis",
"WEB·SUITE, un projet est enregistre dans PROJETS/ANTENNA/<projet>, synchronise",
"sur GitHub.",
"",
"EXIGENCE ABSOLUE : tu reponds EXCLUSIVEMENT EN FRANCAIS. Aucun mot, aucun",
"meta-commentaire, aucun plan en anglais (bannis tout 'Role:', 'Task:',",
"'Context:', 'Constraint:'). Commence immediatement par ta reponse technique,",
"brievement et avec des chiffres : une explication sans nombre n'aide pas a",
"regler une simulation.",
"",
"CE QUE TU NE FAIS PAS :",
"- tu n'ecris rien toi-meme ; tu proposes, l'utilisateur applique ;",
"- tu n'inventes aucun chiffre du projet : si une grandeur n'est pas dans le",
"  contexte fourni, tu dis qu'elle manque et tu demandes ou la lire ;",
"- tu ne promets pas un resultat : une simulation se relance et se verifie.",
"",
"LES CONVENTIONS DE L'OUTIL, A RESPECTER A LA LETTRE :",
"- les frequences sont TOUJOURS en hertz dans les propositions (2.45e9), quelle",
"  que soit l'unite affichee a l'ecran ;",
"- les longueurs sont dans l'unite du document (mm sauf mention contraire dans",
"  le contexte), sauf les cotes de motif, toujours en millimetres ;",
"- zero veut dire « au mailleur de decider » pour les marges d'air et les pas",
"  de maillage : proposer zero est une decision legitime, pas un oubli ;",
"- l'arret se fait sur l'energie residuelle (-40 dB d'usine) ; le nombre de pas",
"  de temps est un garde-fou et ne doit pas etre ce qui arrete.",
"",
"CE QUE TU SAIS DE CET OUTIL-CI, mesure sur lui et non lu ailleurs :",
"- la marge d'air visee est le quart de la longueur d'onde a la frequence",
"  BASSE, PML comprise ; en dessous, la PML absorbe du champ proche reactif et",
"  la resonance derive sans que rien ne le signale ;",
"- un gabarit d'antenne de l'outil tombe a plus ou moins 5 % de sa cible : le",
"  premier dessin est un point de depart, pas une antenne finie ;",
"- le gabarit patch corrige le modele de cavite par la mesure : sa longueur",
"  (L x (1 - 0,466.racine(h/lambda0)), quatre cas a 0,2 % pres) et sa",
"  resistance de bord (0,17 fois la conductance de fente sur FR-4, 0,72 sur",
"  RO4350B, interpolee en tan delta entre les deux). Sans correction, y0",
"  sortait 40 a 55 % trop profond sur FR-4 ;",
"- sur ce meme patch, resserrer les encoches g de 3,5 a 1,5 mm gagne 8 dB :",
"  elles ajoutent une capacite que le modele de cavite ignore ;",
"- lambda/20 dans le dielectrique NE SUFFIT PAS quand une ligne d'alimentation",
"  est etroite : il faut au moins trois a quatre cellules en travers de la",
"  ligne, soit un pas au quart de sa largeur ;",
"- allonger une ligne d'alimentation N'ADAPTE PAS : une ligne sans perte au Z0",
"  de reference ne change pas le module de Gamma, elle le fait tourner ;",
"- une resonance trop haute se corrige en allongeant la cote resonante du meme",
"  pourcentage environ (f proportionnel a 1/L au premier ordre) ; on ne",
"  corrige qu'une cote a la fois.",
"",
"LES CARTES D'ACTION.",
"Quand tu preconises des valeurs concretes, termine par un bloc JSON balise",
"```action. L'outil le transforme en une carte cliquable qui montre l'avant en",
"face de l'apres ; l'utilisateur presse, ou ne presse pas. Tu peux en poser",
"plusieurs, une par idee. Quatre formes, et aucune autre :",
"",
"1. Des reglages de simulation :",
"```action",
'{"type":"reglages","titre":"Recentrer la bande sur 2,45 GHz","valeurs":{"bande.f1":2.08e9,"bande.f2":2.82e9}}',
"```",
"",
"2. Des cotes d'un motif du mode conception (en millimetres). « tracer » a vrai",
"   redessine le motif — ce qui efface le dessin en cours et remet la bande a",
"   plus ou moins 15 % ; a faux, seule la fiche et son apercu changent :",
"```action",
'{"type":"cotes","motif":"patch","valeurs":{"y0":8.5,"g":1.5},"tracer":false}',
"```",
"",
"3. Armer un balayage sur une cote :",
"```action",
'{"type":"balayage","titre":"Balayer l encastrement","source":"m.y0","min":6,"max":12,"pas":1}',
"```",
"",
"4. Poser de la GEOMETRIE LIBRE dans le dessin du mode conception. Les",
"   coordonnees sont en millimetres, l'origine est au coin de la carte, x va",
"   de 0 a L et y de 0 a W. « couche » vaut « haut », « bas » ou le nom exact",
"   d'une couche listee dans le contexte ; « remplacer » a vrai EFFACE le",
"   dessin en cours et depose les ports ; « carte » et « port » sont",
"   facultatifs, mais sans port rien ne se simule :",
"```action",
'{"type":"formes","titre":"Patch a coins coupes","carte":{"L":40,"W":45},"remplacer":true,"elements":[{"type":"rect","couche":"bas","net":"GND","x1":0,"y1":0,"x2":40,"y2":45},{"type":"poly","couche":"haut","net":"ANTENNE","pts":[[8,12],[30,12],[32,14],[32,36],[10,36],[8,34]]},{"type":"piste","couche":"haut","net":"ANTENNE","pts":[[20,0],[20,12]],"w":3.06}],"port":{"x":20,"y":0.4,"w":3.06,"l":0.8}}',
"```",
"   Genres admis, et aucun autre : rect (x1,y1,x2,y2), disque (cx,cy,r),",
"   poly (pts, au moins trois sommets), piste (pts et w), via (x,y,d).",
"   « trou » a vrai fait une DECOUPE, qui retire du cuivre au lieu d'en poser,",
"   et ne vaut que pour rect, disque et poly. Au plus " + IA_FORMES_MAX +
" formes par carte et " + IA_PTS_MAX + " sommets par forme ; une forme",
"   entierement hors de la carte est refusee.",
"",
"QUAND PREFERER UN MOTIF A DE LA GEOMETRIE LIBRE : toujours, des qu'il en",
"existe un. Un motif calcule ses cotes, tient une fiche, se repose et se",
"balaye ; une geometrie libre ne sait rien d'elle-meme, et l'outil ne peut en",
"dire que ce qu'il mesure. Ne la propose que pour une antenne qu'aucun des six",
"motifs ne trace — et dis-le en une phrase quand tu le fais.",
"",
"LES SEULS CHEMINS ACCEPTES pour « reglages ». Tout autre chemin est refuse par",
"la page et ta carte devient morte :",
grammaire(),
"",
"« port.X » vise le port en cours de reglage ; « ports.0.X » vise le premier.",
"Les chemins « con.* » n'existent que si le mode conception est actif.",
"Pour « cotes », les identifiants sont ceux que le contexte liste sous",
"« MOTIF OUVERT ». Pour « balayage », « source » est l'un des identifiants",
"listes sous « COTES BALAYABLES », recopie a la lettre ; si le contexte n'en",
"liste aucun, ne propose pas de balayage. Le garde-fou est a " + BAL_MAX +
" points."
    ].join("\n");
  }

  /* ==========================================================================
     Encodage / décodage Base64 UTF-8 sécurisé
     ========================================================================== */
  function encoderBase64Utf8(str){
    try{
      return btoa(Array.from(new TextEncoder().encode(str),
                             b => String.fromCharCode(b)).join(""));
    }catch(_){ return ""; }
  }
  function decoderBase64Utf8(b64){
    try{
      return new TextDecoder().decode(
        Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
    }catch(_){ return ""; }
  }

  /* ==========================================================================
     L'état d'une carte d'action
     --------------------------------------------------------------------------
     La charge utile encodée sert de clé : le même bloc ```action rend toujours
     la même chaîne, et une carte retrouve donc son état à chaque réaffichage
     de la liste. Tant qu'elle n'est pas appliquée, sa proposition est
     RECALCULÉE — l'« avant » doit être celui du moment, pas celui d'il y a
     trois questions.
     ========================================================================== */
  function etatAction(b64){
    const e = _actions.get(b64);
    if(e && e.faite) return e;
    let brut = null;
    try{ brut = JSON.parse(decoderBase64Utf8(b64)); }catch(_){}
    const neuf = {brut:brut, prop:brut ? proposition(brut) : null, faite:false};
    _actions.set(b64, neuf);
    return neuf;
  }

  /* ==========================================================================
     Markdown léger et sécurisé — celui de WEB_CAO
     --------------------------------------------------------------------------
     TOUT EST ÉCHAPPÉ D'ABORD. Ce qui revient du réseau est une donnée, jamais
     du HTML : l'injecter tel quel donnerait à un tiers le droit d'écrire dans
     cette page.
     ========================================================================== */
  function echapperHtml(s){
    return String(s).replace(/[&<>"']/g, ch => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[ch]));
  }

  function carteAction(b64){
    const e = etatAction(b64);
    const p = e.prop;
    if(!p){
      return '<div class="ia-action-card">' +
        '<div class="ia-action-head"><span class="ia-action-icon">⚠</span>' +
        '<span class="ia-action-title">Proposition illisible</span></div>' +
        '<div class="ia-action-desc">Le bloc d’action n’est pas du ' +
        'JSON valide : rien n’a été préparé.</div></div>';
    }
    const desc = p.lignes.map(function(l){
      const av = l.texte ? l.avant : valeurTexte(l.descr, l.avant);
      const ap = l.texte ? l.apres : valeurTexte(l.descr, l.apres);
      return echapperHtml(l.nom) + " : " + echapperHtml(av) +
             " <b>→ " + echapperHtml(ap) + "</b>";
    }).join("<br>");
    const refus = p.refus.map(r => "⚠ " + echapperHtml(r)).join("<br>");
    /* CE QU'UNE CARTE « formes » VA POSER, FORME PAR FORME. Une carte qui
       annoncerait « 12 formes » demanderait de presser pour savoir ce qu'on
       pose — c'est-à-dire l'inverse de ce qu'une carte d'action est. */
    const detail = (p.detail && p.detail.length)
      ? p.detail.map(t => "· " + echapperHtml(t)).join("<br>") : "";
    /* Ce qui n'est pas un refus, mais qu'on regretterait de ne pas avoir lu :
       du cuivre qui déborde du substrat, un dessin effacé, un port absent. */
    const avis = (p.avis && p.avis.length)
      ? p.avis.map(t => "ⓘ " + echapperHtml(t)).join("<br>") : "";

    let pied;
    if(!p.lignes.length){
      pied = '<span class="ia-action-vide">' +
             (p.type === "formes"
                ? 'Rien à poser : aucune forme de cette proposition n’a passé ' +
                  'les garde-fous.'
                : 'Rien à appliquer : ces valeurs sont déjà celles des ' +
                  'réglages.') + '</span>';
    }else if(e.faite){
      pied = '<button type="button" class="ia-btn-action done" disabled>✓ ' +
             echapperHtml(e.resume || "appliqué") + '</button>' +
             (p.type === "balayage" ? "" :
               '<button type="button" class="ia-subbar-btn" ' +
               'data-ia-annuler="' + b64 + '">Annuler</button>');
    }else{
      pied = '<button type="button" class="ia-btn-action" ' +
             'data-ia-appliquer="' + b64 + '">⚡ Appliquer</button>';
    }

    return '<div class="ia-action-card">' +
        '<div class="ia-action-head">' +
          '<span class="ia-action-icon">⚡</span>' +
          '<span class="ia-action-title">' + echapperHtml(p.titre) + '</span>' +
        '</div>' +
        (desc ? ('<div class="ia-action-desc">' + desc + '</div>') : '') +
        (detail ? ('<div class="ia-action-liste">' + detail + '</div>') : '') +
        (avis ? ('<div class="ia-action-avis">' + avis + '</div>') : '') +
        (refus ? ('<div class="ia-action-refus">' + refus + '</div>') : '') +
        '<div class="ia-action-footer">' + pied + '</div>' +
      '</div>';
  }

  function formaterMarkdown(texte){
    if(!texte) return "";

    const codeBlocks = [];
    let txt = texte.replace(/```([a-zA-Z0-9_:-]*)[^\S\r\n]*\r?\n([\s\S]*?)```/g,
      function(_, lang, code){
        const idx = codeBlocks.length;
        const langLower = (lang || "").toLowerCase();

        if(langLower === "action" || langLower.indexOf("action:") === 0){
          try{
            const act = JSON.parse(code.trim());
            const b64 = encoderBase64Utf8(JSON.stringify(act));
            codeBlocks.push(carteAction(b64));
            return "%%CODEBLOCK_" + idx + "%%";
          }catch(e){
            console.warn("Bloc action illisible :", e);
          }
        }

        const langLabel = lang || "code";
        codeBlocks.push(
          '<div class="ia-code-wrap">' +
            '<div class="ia-code-head">' +
              '<span>' + echapperHtml(langLabel) + '</span>' +
              '<button type="button" class="ia-btn-copy" data-ia-copier="1">Copier</button>' +
            '</div>' +
            '<pre class="ia-code-block"><code>' + echapperHtml(code.trim()) +
            '</code></pre>' +
          '</div>'
        );
        return "%%CODEBLOCK_" + idx + "%%";
      });

    const lignes = txt.split("\n");
    const out = [];
    let inList = false;

    for(let i = 0; i < lignes.length; i++){
      const l = lignes[i];

      if(l.indexOf("%%CODEBLOCK_") >= 0){
        if(inList){ out.push("</ul>"); inList = false; }
        out.push(l);
        continue;
      }
      if(l.indexOf("### ") === 0){
        if(inList){ out.push("</ul>"); inList = false; }
        out.push("<b>" + echapperHtml(l.slice(4)) + "</b><br>");
        continue;
      }
      if(l.indexOf("## ") === 0){
        if(inList){ out.push("</ul>"); inList = false; }
        out.push("<b style='color:var(--yellow,#f2c744);font-size:1.1em;'>" +
                 echapperHtml(l.slice(3)) + "</b><br>");
        continue;
      }

      const mList = l.match(/^(\s*)[-*+]\s+(.*)$/);
      if(mList){
        if(!inList){ out.push("<ul>"); inList = true; }
        out.push("<li>" + echapperHtml(mList[2])
          .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
          .replace(/`([^`]+)`/g, "<code>$1</code>") + "</li>");
        continue;
      }else if(inList){
        out.push("</ul>");
        inList = false;
      }

      if(!l.trim()){ out.push("<br>"); continue; }

      out.push("<p>" + echapperHtml(l)
        .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
        .replace(/\*(.*?)\*/g, "<em>$1</em>")
        .replace(/`([^`]+)`/g, "<code>$1</code>") + "</p>");
    }
    if(inList) out.push("</ul>");

    /* LE BLOC EST RÉINSÉRÉ PAR UNE FONCTION, ET NON COMME CHAÎNE. Le second
       argument de `String.replace` est un MOTIF quand c'est une chaîne : `$&`
       y vaut le texte trouvé, `$'` tout ce qui le suit, `` $` `` tout ce qui le
       précède. Un bloc de code contenant l'un des trois — et `$&` n'a rien
       d'exotique dans du shell ou du perl — se réécrivait donc tout seul.
       Aucune faille : tout est déjà échappé à ce stade, et ce qui serait
       recopié est du HTML sûr. Mais le bloc affiché n'était plus celui que le
       modèle avait écrit, et c'est exactement ce qu'on ne veut pas d'un bloc
       de code. La forme fonction ne fait aucune substitution. */
    let finalHtml = out.join("");
    codeBlocks.forEach(function(bloc, idx){
      finalHtml = finalHtml.replace("%%CODEBLOCK_" + idx + "%%",
                                    function(){ return bloc; });
    });
    return finalHtml;
  }

  /* ==========================================================================
     Rendu de l'historique
     ========================================================================== */
  function nomModele(){
    if(_fournisseur === "local") return "Local · " + (_local.modele || "?");
    const sel = document.getElementById("iaModelSelect");
    if(sel && sel.selectedIndex >= 0) return sel.options[sel.selectedIndex].text;
    return _modele;
  }

  function rendreMessages(){
    const cont = document.getElementById("iaMessages");
    if(!cont) return;

    cont.innerHTML = "";

    if(_historique.length === 0){
      const chips = jeuDeSuggestions();
      const welcome = document.createElement("div");
      welcome.className = "ia-msg model";
      welcome.innerHTML =
        '<span class="ia-msg-role">' + echapperHtml(nomModele()) + '</span>' +
        '<div class="ia-msg-bubble">' +
          '<p>Bonjour ! Je suis votre assistant technique spécialisé en ' +
          'antennes imprimées, simulation FDTD openEMS, empilages et ' +
          'adaptation.</p>' +
          '<p>Que souhaitez-vous régler ou vérifier aujourd’hui ?</p>' +
          '<div class="ia-chips-wrap">' +
            '<div class="ia-chips-title">Vérification locale, manuel et ' +
            'questions fréquentes :</div>' +
            '<div class="ia-chips-grid">' +
              '<button type="button" class="ia-chip ia-chip-audit" ' +
              'data-ia-chip="verifier" title="Audit complet des réglages, ' +
              'en local (0 jeton)">🔎 Vérifier les réglages (verifier)</button>' +
              '<button type="button" class="ia-chip ia-chip-help" ' +
              'data-ia-chip="help" title="Affiche le manuel complet en local ' +
              '(0 jeton)">📖 Manuel &amp; capacités (help)</button>' +
              chips.map(c => '<button type="button" class="ia-chip" ' +
                'data-ia-chip="' + echapperHtml(c) + '">' + echapperHtml(c) +
                '</button>').join("") +
            '</div>' +
          '</div>' +
        '</div>';
      cont.appendChild(welcome);
      lierMessages(cont);
      return;
    }

    _historique.forEach(function(m){
      const d = document.createElement("div");
      d.className = "ia-msg " + m.role + (m.localOutil ? " local-tool" : "");
      let roleLabel = (m.role === "user") ? "Vous" : (m.modele || nomModele());
      if(m.localOutil)
        roleLabel = m.localTitre ||
          "🛠️ Réponse locale de l'outil (aucune donnée transmise)";
      const texte = (m.parts && m.parts[0] && m.parts[0].text) ? m.parts[0].text : "";
      d.innerHTML =
        '<span class="ia-msg-role' + (m.localOutil ? " local-tool" : "") + '">' +
          echapperHtml(roleLabel) + '</span>' +
        '<div class="ia-msg-bubble' + (m.localOutil ? " ia-manual-bubble" : "") +
          '">' + formaterMarkdown(texte) + '</div>';
      cont.appendChild(d);
    });

    if(_enAttente){
      const loading = document.createElement("div");
      loading.className = "ia-loading-bubble";
      loading.innerHTML =
        '<div class="ia-dots"><span class="ia-dot"></span>' +
        '<span class="ia-dot"></span><span class="ia-dot"></span></div>' +
        '<span>' + (_etape ? ('🔎 Consulte : ' + echapperHtml(_etape) + '…')
                           : (echapperHtml(nomModele()) + ' analyse vos réglages...')) + '</span>';
      cont.appendChild(loading);
    }

    lierMessages(cont);
    cont.scrollTop = cont.scrollHeight;
  }

  /* Les écouteurs des éléments engendrés. Ils sont posés ICI plutôt qu'en
     `onclick` dans le HTML : une charge utile encodée dans un attribut
     `onclick` demande d'échapper des apostrophes dans une chaîne qui en
     contient déjà, et c'est exactement le genre de détail qui casse en
     silence. */
  function lierMessages(cont){
    cont.querySelectorAll("[data-ia-chip]").forEach(function(b){
      b.onclick = function(){ poserQuestionRapide(b.dataset.iaChip); };
    });
    cont.querySelectorAll("[data-ia-appliquer]").forEach(function(b){
      b.onclick = function(){ executerAction(b.dataset.iaAppliquer); };
    });
    cont.querySelectorAll("[data-ia-annuler]").forEach(function(b){
      b.onclick = function(){ annulerAction(b.dataset.iaAnnuler); };
    });
    cont.querySelectorAll("[data-ia-copier]").forEach(function(b){
      b.onclick = function(){ copierCode(b); };
    });
  }

  function copierCode(btn){
    const wrap = btn.closest(".ia-code-wrap");
    const code = wrap ? wrap.querySelector("code") : null;
    if(!code) return;
    navigator.clipboard.writeText(code.textContent).then(function(){
      const orig = btn.textContent;
      btn.textContent = "✓ Copié !";
      btn.style.color = "#44cf6c";
      setTimeout(function(){ btn.textContent = orig; btn.style.color = ""; }, 1500);
    }).catch(function(e){ console.warn("Échec de copie :", e); });
  }

  function poserQuestionRapide(q){
    const input = document.getElementById("iaInput");
    if(!input) return;
    input.value = q;
    envoyerMessage();
  }

  /* ==========================================================================
     Exécuter une carte d'action
     ========================================================================== */
  function executerAction(b64){
    const e = etatAction(b64);
    if(!e.prop || e.faite) return;
    try{
      const resume = appliquer(e.prop);
      e.faite = true;
      e.resume = resume;
      rendreMessages();
      if(typeof hint === "function") hint("IA — " + resume + ".");
    }catch(err){
      console.error("Application d'une carte d'action :", err);
      afficherErreur("Application impossible : " + err.message);
    }
  }

  function annulerAction(b64){
    const e = _actions.get(b64);
    if(!e || !e.faite) return;
    annuler(e.prop);
    e.faite = false;
    e.resume = "";
    /* La proposition est jetée : le prochain rendu la recalculera sur l'état
       remis en place, et son « avant » sera de nouveau celui du moment. */
    _actions.delete(b64);
    rendreMessages();
    if(typeof hint === "function") hint("IA — réglage annulé.");
  }

  /* ==========================================================================
     Le menu contextuel au clic droit
     --------------------------------------------------------------------------
     `js/04-interaction.js` l'appelle déjà : il attendait ce fichier.
     ========================================================================== */
  function iaCacherMenuContextuel(){
    const menu = document.getElementById("iaContextMenu");
    if(menu) menu.hidden = true;
  }

  /* Ce qui est désigné à l'écran, et qui vaut la peine d'être analysé. */
  function selectionDetaillee(){
    if(typeof V === "undefined" || !V.modele) return null;

    if(typeof CON !== "undefined" && CON.actif && CON.gabarit){
      const g = conGabarit(CON.gabarit);
      if(g){
        const c = conContexte();
        const d = conGabaritDefauts(g, c);
        const cotes = g.champs.map(function(ch){
          return {id:ch.id, nom:ch.nom, pose:CON.gabaritP[ch.id],
                  calcul:d[ch.id], repris:!!CON.gabaritTouche[ch.id]};
        });
        return {type:"motif", titre:"Motif dessiné : " + g.nom, badge:g.id,
                json:{motif:g.id, frequence_visee_Hz:CON.fcible,
                      substrat:{er:c.er, h_mm:c.h, tand:c.df}, cotes:cotes}};
      }
    }

    if(V.net >= 0 && V.parNet && V.parNet[V.net]){
      const n = V.parNet[V.net];
      const couches = new Set();
      (n.pistes || []).forEach(p => couches.add(p.c));
      (n.plans || []).forEach(p => couches.add(p.c));
      return {type:"net", titre:"Net cuivre : " + (n.nom || V.net),
              badge:(n.nom || ("#" + V.net)),
              json:{net:n.nom, segments_de_piste:(n.pistes || []).length,
                    versements:(n.plans || []).length,
                    pastilles:(n.pads || []).length,
                    couches:Array.from(couches).map(i => (V.couches[i] || {}).nom),
                    retenu_pour_le_solveur:ANT.nets.has(V.net),
                    est_la_masse:(ANT.netMasse === V.net)}};
    }

    if(V.comp){
      return {type:"composant", titre:"Composant : " + V.comp, badge:V.comp,
              json:{repere:V.comp}};
    }
    return null;
  }

  function questionDeSelection(d){
    if(!d) return "";
    const bloc = "\n\nDonnées techniques (JSON) :\n```json\n" +
                 JSON.stringify(d.json, null, 2) + "\n```\n\n";
    if(d.type === "motif")
      return "Analyse les cotes de ce motif d'antenne dessiné dans l'outil." +
             bloc +
             "Question : ces cotes sont-elles cohérentes avec la fréquence " +
             "visée et ce substrat ? Laquelle est la plus douteuse, et " +
             "laquelle faut-il balayer en premier ?";
    if(d.type === "net")
      return "Analyse ce net de cuivre de la carte." + bloc +
             "Question : ce net doit-il entrer dans le modèle FDTD, et à quel " +
             "titre — élément rayonnant, plan de masse, ligne d'alimentation ? " +
             "Que faut-il vérifier avant de le retenir ?";
    if(d.type === "composant")
      return "Inspecte ce composant de la carte." + bloc +
             "Question : que devient un composant dans une simulation de " +
             "champ, et faut-il le représenter d'une façon ou d'une autre ?";
    return "";
  }

  function lancerAnalyseSelection(d){
    const q = questionDeSelection(d);
    if(!q){ iaOuvrir(); return; }
    _questionEnAttente = q;
    iaOuvrir();
    if(_cleApi || _fournisseur === "local"){
      const input = document.getElementById("iaInput");
      if(input){
        input.value = q;
        input.style.height = "auto";
        input.style.height = Math.max(56, Math.min(input.scrollHeight, 160)) + "px";
        _questionEnAttente = "";
        setTimeout(() => input.focus(), 60);
      }
    }
  }

  function iaAfficherMenuContextuel(e){
    if(!e) return false;

    /* Laisser la priorité aux gestes en cours : poser un port, tracer une
       forme. Un menu qui s'ouvrirait par-dessus volerait le clic qui annule. */
    if(typeof ANT !== "undefined" && ANT.posePort) return false;
    if(typeof CON !== "undefined" && CON.actif && CON.courant) return false;

    let menu = document.getElementById("iaContextMenu");
    if(!menu){
      menu = document.createElement("div");
      menu.id = "iaContextMenu";
      menu.className = "ia-context-menu";
      menu.hidden = true;
      document.body.appendChild(menu);
      window.addEventListener("pointerdown", function(evt){
        if(!menu.hidden && !menu.contains(evt.target)) menu.hidden = true;
      });
      window.addEventListener("keydown", function(evt){
        if(evt.key === "Escape" && !menu.hidden) menu.hidden = true;
      });
    }

    const d = selectionDetaillee();
    const carte = (typeof V !== "undefined" && V.modele);
    let html = '<div class="ia-menu-head"><span>Assistant IA — ' +
               echapperHtml(nomModele()) + '</span></div>';

    /* L'AUDIT LOCAL EN PREMIER, et c'est délibéré : il ne coûte rien, il ne
       sort pas du poste, et il répond à la question qu'on se pose le plus
       souvent devant un réglage — « est-ce que je peux lancer ? ». */
    if(carte){
      html +=
        '<div class="ia-menu-item primary" id="iaMenuActAudit">' +
          '<div class="ia-menu-item-left">' +
            '<span class="ia-menu-ico">🔎</span>' +
            '<div><div>Vérifier les réglages ✨</div>' +
            '<div class="ia-menu-subtext">En local, sans réseau ni clé</div>' +
            '</div>' +
          '</div>' +
          '<span class="ia-menu-badge">0 jeton</span>' +
        '</div>';
    }

    if(d){
      let titre = "📐 Analyser avec l'IA ✨", sous = "Inspection des données techniques";
      if(d.type === "motif"){ titre = "✏️ Analyser le motif dessiné ✨"; sous = "Cotes posées, cotes calculées, écarts"; }
      else if(d.type === "net"){ titre = "📐 Analyser le net cuivre ✨"; sous = "Couches, rôle dans le modèle, retenue"; }
      else if(d.type === "composant"){ titre = "🔍 Inspecter le composant ✨"; sous = "Ce qu'il devient dans un calcul de champ"; }
      html +=
        '<div class="ia-menu-sep"></div>' +
        '<div class="ia-menu-item primary" id="iaMenuActSelection">' +
          '<div class="ia-menu-item-left">' +
            '<span class="ia-menu-ico">✨</span>' +
            '<div><div>' + titre + '</div>' +
            '<div class="ia-menu-subtext">' + sous + '</div></div>' +
          '</div>' +
          (d.badge ? ('<span class="ia-menu-badge">' + echapperHtml(d.badge) +
                      '</span>') : '') +
        '</div>';
    }

    html +=
      '<div class="ia-menu-sep"></div>' +
      '<div class="ia-menu-item" id="iaMenuActGeneral">' +
        '<div class="ia-menu-item-left">' +
          '<span class="ia-menu-ico">💬</span>' +
          '<div><div>Poser une question technique…</div>' +
          '<div class="ia-menu-subtext">Dimensionnement, maillage, adaptation</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    menu.innerHTML = html;

    const bAudit = menu.querySelector("#iaMenuActAudit");
    if(bAudit) bAudit.onclick = function(){
      menu.hidden = true;
      iaOuvrir();
      auditLocal();
    };
    const bSel = menu.querySelector("#iaMenuActSelection");
    if(bSel) bSel.onclick = function(){
      menu.hidden = true;
      lancerAnalyseSelection(d);
    };
    const bGen = menu.querySelector("#iaMenuActGeneral");
    if(bGen) bGen.onclick = function(){ menu.hidden = true; iaOuvrir(); };

    menu.style.visibility = "hidden";
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    const mw = r.width || 260, mh = r.height || 120;
    menu.style.left = Math.max(10, Math.min(e.clientX + 2, window.innerWidth - mw - 10)) + "px";
    menu.style.top = Math.max(10, Math.min(e.clientY + 2, window.innerHeight - mh - 10)) + "px";
    menu.style.visibility = "visible";
    return true;
  }

  /* ==========================================================================
     Construction du DOM dans la section de l'espace de travail
     ========================================================================== */
  function construireDom(){
    if(_domConstruit) return;
    const panneau = document.getElementById("iaPanneau");
    /* Le panneau est déclaré dans index.html. S'il manque, c'est la page qui
       est incomplète, et en fabriquer un ici ne ferait que masquer la faute
       — le banc d'essai, qui charge ce fichier sans DOM, passe aussi par là. */
    if(!panneau) return;
    _domConstruit = true;

    panneau.innerHTML =
      '<div class="ia-panneau-wrap">' +
        /* 1. Barre de connexion (tant qu'il n'y a pas de clé) */
        '<div class="ia-panel-connect" id="iaPanelConnect">' +
          '<form class="ia-connect-row" id="iaKeyForm" onsubmit="return false;">' +
            '<select id="iaFournisseur" class="ia-model-select" title="Fournisseur du modèle de langage" aria-label="Fournisseur">' +
              '<option value="google">Google</option>' +
              '<option value="local">Local</option>' +
            '</select>' +
            '<span class="ia-lock-ico" id="iaLockIco" title="Sécurité éphémère : clé conservée en mémoire vive uniquement">🔒</span>' +
            '<input type="password" id="iaKeyInput" class="ia-key-input-compact" autocomplete="off" spellcheck="false" placeholder="Clé API Google AI Studio (AIzaSy...)" aria-label="Clé API Google AI Studio">' +
            '<button type="button" class="ia-btn-eye-compact" id="iaBtnEye" title="Afficher/Masquer la clé">👁</button>' +
            /* Le modèle local : son adresse et son nom. Rien de secret, donc
               du texte en clair — mais la même vie que la clé. */
            '<input type="text" id="iaUrlInput" class="ia-key-input-compact" hidden autocomplete="off" spellcheck="false" value="' + echapperHtml(_local.url) + '" placeholder="http://localhost:11434" aria-label="Adresse du serveur local compatible OpenAI">' +
            '<input type="text" id="iaModeleLocalInput" class="ia-key-input-compact" hidden autocomplete="off" spellcheck="false" placeholder="modèle (llama3.1…)" aria-label="Nom du modèle local">' +
            '<button type="submit" class="ia-btn-ok-compact" id="iaBtnSubmitKey">Valider</button>' +
          '</form>' +
          '<div class="ia-connect-hint">' +
            '<span id="iaConnectHintTxt">🔒 Mémoire vive seule · Oubliée à la fermeture</span>' +
            '<a id="iaLienCle" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Clé gratuite ↗</a>' +
          '</div>' +
          /* SANS CLÉ, LE PANNEAU N'EST PAS INUTILE, et il faut le dire ici :
             c'est le seul endroit où quelqu'un qui n'en a pas regardera. */
          '<div class="ia-connect-local">' +
            'Sans clé, <b>« Vérifier les réglages »</b> et <b>« Manuel »</b> ' +
            'marchent quand même : ils sont exécutés en local.' +
          '</div>' +
        '</div>' +

        /* 2. Barre de statut (dès la clé validée) */
        '<div class="ia-panel-status" id="iaPanelStatus" hidden>' +
          '<div class="ia-status-left">' +
            '<span class="ia-status-dot"></span>' +
            '<select id="iaModelSelect" class="ia-model-select" title="Modèle Google AI Studio">' +
              '<option value="gemma-4-31b-it">Gemma 4 31B</option>' +
              '<option value="gemini-3.8-flash">Gemini 3.8 Flash</option>' +
              '<option value="gemini-3.8-flash-thinking">Gemini 3.8 Flash (Thinking)</option>' +
            '</select>' +
            '<span class="ia-status-ctx" id="iaContextText">Prêt</span>' +
          '</div>' +
          '<div class="ia-status-actions">' +
            '<button type="button" class="ia-subbar-btn" id="iaBtnAudit" title="Vérifier les réglages en local (0 jeton)">🔎 Vérifier</button>' +
            '<button type="button" class="ia-subbar-btn" id="iaBtnClear" title="Vider les échanges de cette session">Vider</button>' +
            '<button type="button" class="ia-subbar-btn danger" id="iaBtnPurgeKey" title="Effacer la clé de la mémoire">Oublier clé</button>' +
          '</div>' +
        '</div>' +

        /* 3. Bannière d'erreur */
        '<div class="ia-error-banner" id="iaErrorBanner" hidden>' +
          '<span id="iaErrorText"></span>' +
          '<button type="button" id="iaBtnDismissError">✕</button>' +
        '</div>' +

        /* 4. Liste des messages */
        '<div class="ia-messages scroll" id="iaMessages"></div>' +

        /* 5. Pied : saisie et envoi */
        '<div class="ia-footer">' +
          '<div class="ia-input-row">' +
            '<textarea id="iaInput" class="ia-textarea" rows="2" placeholder="Posez votre question sur ces réglages... (Entrée pour envoyer, Maj+Entrée pour nouvelle ligne)"></textarea>' +
            '<button type="button" class="ia-btn-send" id="iaBtnSend" title="Envoyer (Entrée)">' +
              '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>' +
            '</button>' +
          '</div>' +
          '<div class="ia-footer-hints">' +
            '<label title="Transmet le résumé des réglages de simulation pour guider la réponse. Ni le fichier IPC-2581, ni les polygones, ni les courbes.">' +
              '<input type="checkbox" id="iaChkContext" checked> Contexte projet' +
            '</label>' +
            '<span id="iaFooterModelLabel">Gemma 4 31B · Session active</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    const selModel = document.getElementById("iaModelSelect");
    if(selModel){
      selModel.value = _modele;
      const lbl = document.getElementById("iaFooterModelLabel");
      if(lbl && selModel.selectedIndex >= 0) {
        lbl.textContent = selModel.options[selModel.selectedIndex].text + " · Session active";
      }
      selModel.addEventListener("change", function(){
        _modele = this.value;
        if(lbl) lbl.textContent = this.options[this.selectedIndex].text +
                                  " · Session active";
      });
    }

    /* Le ✕ de l'en-tête du panneau purge la clé, comme dans WEB_CAO. */
    const section = document.querySelector('.pnl[data-pnl="ia"]');
    if(section){
      const btnClose = section.querySelector('.pnl-btn[data-act="close"]');
      if(btnClose) btnClose.addEventListener("click", iaPurgerCle);
    }

    document.getElementById("iaBtnPurgeKey").addEventListener("click", iaPurgerCle);
    document.getElementById("iaBtnAudit").addEventListener("click", auditLocal);

    const btnEye = document.getElementById("iaBtnEye");
    const inputCle = document.getElementById("iaKeyInput");
    btnEye.addEventListener("click", function(){
      const estPswd = inputCle.type === "password";
      inputCle.type = estPswd ? "text" : "password";
      btnEye.textContent = estPswd ? "🙈" : "👁";
    });

    document.getElementById("iaFournisseur").addEventListener("change", function(){
      montrerFournisseur(this.value);
    });

    document.getElementById("iaKeyForm").addEventListener("submit", function(e){
      e.preventDefault();
      validerCle();
    });
    document.getElementById("iaBtnSubmitKey").addEventListener("click", validerCle);

    document.getElementById("iaBtnClear").addEventListener("click", function(){
      _historique = [];
      _actions.clear();
      rendreMessages();
    });

    document.getElementById("iaBtnDismissError").addEventListener("click", function(){
      document.getElementById("iaErrorBanner").hidden = true;
    });

    const textarea = document.getElementById("iaInput");
    textarea.addEventListener("keydown", function(e){
      if(e.key === "Enter" && !e.shiftKey){
        e.preventDefault();
        envoyerMessage();
      }
    });
    textarea.addEventListener("input", function(){
      this.style.height = "auto";
      this.style.height = Math.max(56, Math.min(this.scrollHeight, 160)) + "px";
    });

    document.getElementById("iaBtnSend").addEventListener("click", envoyerMessage);
    document.getElementById("iaChkContext").addEventListener("change", function(){
      _inclureContexte = this.checked;
    });

    /* Alt+I ouvre et ferme. */
    window.addEventListener("keydown", function(e){
      if(e.altKey && (e.key === "i" || e.key === "I")){
        e.preventDefault();
        if(typeof wsPlaceOf === "function" && wsPlaceOf("ia") !== "hidden") iaFermer();
        else iaOuvrir();
      }
    });

    /* Échap quand le focus est dans le panneau. */
    panneau.addEventListener("keydown", function(e){
      if(e.key === "Escape") iaFermer();
    });

    rendreMessages();
  }

  /* ==========================================================================
     Clé : demander, valider, purger
     ========================================================================== */
  function afficherEcranCle(){
    const c = document.getElementById("iaPanelConnect");
    const s = document.getElementById("iaPanelStatus");
    const i = document.getElementById("iaKeyInput");
    if(c) c.hidden = false;
    if(s) s.hidden = true;
    if(i) i.value = "";
    const f = document.getElementById("iaFournisseur");
    montrerFournisseur(f ? f.value : "google");
  }

  /* Le formulaire de connexion selon le fournisseur : la clé pour Google,
     l'adresse et le nom du modèle pour un serveur local. */
  function montrerFournisseur(f){
    const local = (f === "local");
    ["iaLockIco", "iaKeyInput", "iaBtnEye", "iaLienCle"].forEach(function(id){
      const el = document.getElementById(id);
      if(el) el.hidden = local;
    });
    ["iaUrlInput", "iaModeleLocalInput"].forEach(function(id){
      const el = document.getElementById(id);
      if(el) el.hidden = !local;
    });
    const h = document.getElementById("iaConnectHintTxt");
    if(h) h.textContent = local
      ? "🖥 Ollama, LM Studio… (/v1/chat/completions) · Oublié à la fermeture"
      : "🔒 Mémoire vive seule · Oubliée à la fermeture";
    const cible = document.getElementById(local ? "iaModeleLocalInput" : "iaKeyInput");
    if(cible) setTimeout(() => cible.focus(), 50);
  }

  function validerLocal(){
    const iu = document.getElementById("iaUrlInput");
    const im = document.getElementById("iaModeleLocalInput");
    const url = (iu ? iu.value : "").trim();
    const modele = (im ? im.value : "").trim();
    const faute = !/^https?:\/\/[^\s]+$/i.test(url) ? iu : (!modele ? im : null);
    if(faute){
      faute.focus();
      faute.style.borderColor = "var(--red, #e8443a)";
      setTimeout(() => faute.style.borderColor = "", 1500);
      return false;
    }
    _fournisseur = "local";
    _local = {url:url, modele:modele};
    try{ sessionStorage.setItem(IA_SESSION_LOCAL, JSON.stringify(_local)); }catch(_){}
    return true;
  }

  function validerCle(){
    const f = document.getElementById("iaFournisseur");
    if(f && f.value === "local"){
      if(!validerLocal()) return;
      basculerVersChat();
      if(_questionEnAttente){
        const inputChat = document.getElementById("iaInput");
        if(inputChat){ inputChat.value = _questionEnAttente; _questionEnAttente = ""; }
        envoyerMessage();
      }
      return;
    }
    const input = document.getElementById("iaKeyInput");
    const val = (input ? input.value : "").trim();
    if(!val){
      if(input){
        input.focus();
        input.style.borderColor = "var(--red, #e8443a)";
        setTimeout(() => input.style.borderColor = "", 1500);
      }
      return;
    }
    _cleApi = val;
    _fournisseur = "google";
    try{ sessionStorage.setItem(IA_SESSION_CLE, val); }catch(_){}
    input.value = "";                        // vider le champ tout de suite
    basculerVersChat();

    if(_questionEnAttente){
      const inputChat = document.getElementById("iaInput");
      if(inputChat){
        inputChat.value = _questionEnAttente;
        _questionEnAttente = "";
      }
      envoyerMessage();
    }
  }

  function basculerVersChat(){
    const c = document.getElementById("iaPanelConnect");
    const s = document.getElementById("iaPanelStatus");
    if(c) c.hidden = true;
    if(s) s.hidden = false;

    /* En local, le sélecteur de modèles Google n'a rien à dire : le nom du
       modèle est celui qu'on a tapé, et il s'affiche au pied du panneau. */
    const local = (_fournisseur === "local");
    const sel = document.getElementById("iaModelSelect");
    if(sel) sel.hidden = local;
    const lbl = document.getElementById("iaFooterModelLabel");
    if(lbl) lbl.textContent = nomModele() + " · Session active";
    const bp = document.getElementById("iaBtnPurgeKey");
    if(bp) bp.textContent = local ? "Déconnecter" : "Oublier clé";

    const ctx = document.getElementById("iaContextText");
    if(ctx){
      let quoi = "aucune carte";
      if(typeof CON !== "undefined" && CON.actif) quoi = "conception";
      else if(typeof V !== "undefined" && V.modele) quoi = "IPC-2581";
      if(typeof ANT !== "undefined" && ANT.resultat) quoi += " · simulé";
      ctx.textContent = "Contexte : " + quoi;
    }

    rendreMessages();

    const input = document.getElementById("iaInput");
    if(input){
      if(_questionEnAttente){
        input.value = _questionEnAttente;
        input.style.height = "auto";
        input.style.height = Math.max(56, Math.min(input.scrollHeight, 160)) + "px";
        _questionEnAttente = "";
      }
      setTimeout(() => input.focus(), 60);
    }
  }

  /* La clé est effacée à la fermeture du panneau. Ce n'est pas du zèle : une
     page laissée ouverte une nuit sur un poste partagé garderait sinon de quoi
     facturer quelqu'un d'autre. */
  function iaPurgerCle(){
    _cleApi = "";
    /* Le modèle local part avec : même vie que la clé. L'adresse tapée reste
       dans son champ — elle n'a rien de secret, et la retaper à chaque
       ouverture ne protégerait rien. */
    _fournisseur = "google";
    try{ sessionStorage.removeItem(IA_SESSION_CLE); }catch(_){}
    try{ sessionStorage.removeItem(IA_SESSION_LOCAL); }catch(_){}
    const fs = document.getElementById("iaFournisseur");
    if(fs) fs.value = "google";
    _historique = [];
    _actions.clear();
    _questionEnAttente = "";
    iaCacherMenuContextuel();

    const ik = document.getElementById("iaKeyInput");
    if(ik) ik.value = "";
    const ic = document.getElementById("iaInput");
    if(ic) ic.value = "";
    const eb = document.getElementById("iaErrorBanner");
    if(eb) eb.hidden = true;

    afficherEcranCle();
    rendreMessages();

    const btn = document.getElementById("bIaAssistant");
    if(btn) btn.classList.remove("on");
  }

  function afficherErreur(msg){
    const b = document.getElementById("iaErrorBanner");
    const t = document.getElementById("iaErrorText");
    if(t) t.textContent = msg;
    if(b) b.hidden = false;
  }

  /* ==========================================================================
     L'audit local — une commande, pas une requête
     ========================================================================== */
  function auditLocal(){
    construireDom();
    _historique.push({role:"user", parts:[{text:"verifier"}]});
    _historique.push({role:"model", localOutil:true,
                      localTitre:"🛠️ Vérification locale (aucune donnée transmise)",
                      parts:[{text:genererAuditLocal()}]});
    rendreMessages();
    const graves = controles().filter(a => a.rang === "grave").length;
    if(typeof hint === "function")
      hint(graves
        ? (graves + " faute(s) grave(s) relevée(s) dans les réglages — voir le "+
           "panneau IA.")
        : "Vérifications locales passées : rien d'alarmant dans les réglages.");
  }

  /* ==========================================================================
     Nettoyage des monologues en anglais (Gemma)
     ========================================================================== */
  function scoreFrancais(texte){
    if(!texte) return 0;
    const propre = texte.replace(/^[#*>`_\s\-+0-9.)]+/, "");
    const mots = propre.toLowerCase().match(/[a-zà-ÿ]+/g) || [];
    if(mots.length === 0) return 0;
    const motsFr = new Set([
      "le","la","les","un","une","des","du","de","d","ce","cette","ces","cet",
      "dans","sur","pour","avec","sans","par","est","sont","qui","que","au","aux",
      "antenne","patch","substrat","couche","cuivre","masse","port","bande",
      "frequence","fréquence","resonance","résonance","maillage","boite","boîte",
      "impedance","impédance","adaptation","gabarit","motif","encastrement",
      "il","elle","nous","vous","ils","elles","on","se","sa","son","ses","leur",
      "voici","bonjour","calcul","valeur","valeurs","analyse","permet","utilise",
      "simulation","solveur","cellules","longueur","largeur","epaisseur"
    ]);
    let nbFr = 0;
    for(const m of mots) if(motsFr.has(m) || /[éèêëàâîïôùûç]/.test(m)) nbFr++;
    return nbFr / mots.length;
  }

  function nettoyerReponse(texte){
    if(!texte) return "";
    let s = texte.trim();
    /* « think » : la balise des modèles de raisonnement servis en local
       (DeepSeek-R1, Qwen3 sous Ollama), qui rendent leurs pensées dans le
       texte même. */
    s = s.replace(/<(?:thought|thinking|think)>[\s\S]*?<\/(?:thought|thinking|think)>/gi, "").trim();

    /* Les blocs de code sont protégés AVANT le décollage des phrases : une
       carte d'action est du JSON, et y insérer un saut de ligne au milieu
       d'une clé la rendrait illisible. */
    const blocs = [];
    s = s.replace(/```[\s\S]*?```/g, function(m){
      blocs.push(m);
      return "___BLOC_CODE_" + (blocs.length - 1) + "___";
    });
    s = s.replace(/([a-zà-ÿ]{2,}[.!?])([A-ZÀ-Ÿ][a-zà-ÿ]+)/g, "$1\n\n$2");
    if(blocs.length)
      s = s.replace(/___BLOC_CODE_(\d+)___/g, (_, i) => blocs[+i] || "");

    const premier = (s.split("\n")[0] || "").replace(/^[#*>`_\s\-+0-9.)]+/, "").trim();
    if(scoreFrancais(premier) >= 0.35 &&
       !/^(?:Role|Constraint|Context|Task|Thinking|Elite|Senior)\b/i.test(premier))
      return s;

    const paras = s.split(/\n+/);
    for(let i = 0; i < paras.length; i++){
      const p = paras[i].trim();
      if(!p) continue;
      const net = p.replace(/^[#*>`_\s\-+0-9.)]+/, "").trim();
      if(/^(?:Cette antenne|Ce patch|Ce motif|Votre|Le port|La bande|Il s'agit|Voici|Bonjour|Dans ce|Pour |L'analyse|Le maillage|Analyse|Description)/i.test(net) ||
         (scoreFrancais(net) >= 0.28 &&
          !/^(?:Role|Constraint|Context|Task|Thinking|Direct|Explain|Verify|Analyze)\b/i.test(net))){
        if(i > 0) return paras.slice(i).join("\n\n").trim();
        break;
      }
    }
    return s;
  }

  /* ==========================================================================
     La requête, selon le fournisseur
     --------------------------------------------------------------------------
     UNE FONCTION PURE, et c'est pour le banc : elle rend l'URL et ce que
     `fetch` reçoit, sans rien envoyer. Ce qui doit y être prouvé tient en
     trois lignes — la clé Google dans l'en-tête `x-goog-api-key` et JAMAIS
     dans l'URL (une URL finit dans les journaux et les proxys), aucune clé
     vers un serveur local, et le même historique sous les deux formes.

     `p` : {cle, url, modele, systeme, contents, genConfig}. `contents` est
     l'historique à la forme Google ({role:"user"|"model", parts:[{text}]}) :
     c'est celle de la conversation, et le corps OpenAI s'en déduit. */
  function requeteIa(fournisseur, p){
    if(fournisseur === "local"){
      const base = String(p.url || "").trim().replace(/\/+$/, "");
      if(!/^https?:\/\/[^\s]+$/i.test(base))
        throw new Error("L'adresse du modèle local doit commencer par http:// "+
                        "ou https://.");
      /* « http://localhost:11434 » (Ollama), « …:1234/v1 » (LM Studio) ou
         l'adresse complète : les trois désignent la même route. */
      const url = /\/chat\/completions$/.test(base) ? base
                : base + (/\/v1$/.test(base) ? "" : "/v1") + "/chat/completions";
      const messages = [];
      if(p.systeme) messages.push({role:"system", content:p.systeme});
      (p.contents || []).forEach(function(m){
        messages.push({role:(m.role === "model") ? "assistant" : "user",
                       content:(m.parts && m.parts[0] && m.parts[0].text) || ""});
      });
      return {url:url, init:{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:p.modele, messages:messages,
                             temperature:0.2, stream:false})}};
    }
    const corps = {contents:p.contents, generationConfig:p.genConfig};
    if(p.systeme) corps.systemInstruction = {parts:[{text:p.systeme}]};
    return {url:IA_URL + encodeURIComponent(p.modele) + ":generateContent",
            init:{
              method:"POST",
              // la clé en en-tête, pas dans l'URL : une URL finit dans les journaux et les proxys
              headers:{"Content-Type":"application/json", "x-goog-api-key":p.cle},
              body:JSON.stringify(corps)}};
  }

  /* Le texte de la réponse, sans les pensées du modèle quand il les rend à
     part. */
  function texteReponse(fournisseur, d){
    if(fournisseur === "local"){
      const c = d && d.choices && d.choices[0];
      return (c && c.message && typeof c.message.content === "string")
               ? c.message.content : "";
    }
    const c = d && d.candidates && d.candidates[0];
    if(!(c && c.content && Array.isArray(c.content.parts))) return "";
    let parts = c.content.parts.filter(q => !q.thought);
    if(!parts.length) parts = c.content.parts;
    return parts.map(q => q.text || "").join("");
  }

  /* ==========================================================================
     Envoi au modèle — Google AI Studio ou serveur local
     ========================================================================== */
  async function envoyerMessage(){
    if(_enAttente) return;
    const input = document.getElementById("iaInput");
    const q = (input ? input.value : "").trim();
    if(!q) return;

    /* 1. Le manuel : exécuté par l'outil, sans clé et sans requête. */
    if(estCommandeAide(q)){
      input.value = ""; input.style.height = "";
      _historique.push({role:"user", parts:[{text:q}]});
      _historique.push({role:"model", localOutil:true,
                        localTitre:"🛠️ Manuel du système (réponse locale)",
                        parts:[{text:genererManuelLocal()}]});
      rendreMessages();
      return;
    }

    /* 2. L'audit des réglages : même chose, et c'est le plus utile des deux. */
    if(estCommandeAudit(q)){
      input.value = ""; input.style.height = "";
      auditLocal();
      return;
    }

    /* 3. Vider. */
    if(estCommandeVider(q)){
      input.value = ""; input.style.height = "";
      _historique = [];
      _actions.clear();
      rendreMessages();
      return;
    }

    /* 4. Tout le reste demande la clé — ou un modèle local. */
    if(!_cleApi && _fournisseur !== "local"){
      _questionEnAttente = q;
      afficherEcranCle();
      const ik = document.getElementById("iaKeyInput");
      if(ik){
        ik.focus();
        ik.style.borderColor = "var(--yellow, #f2c744)";
        setTimeout(() => ik.style.borderColor = "", 1500);
      }
      return;
    }

    input.value = ""; input.style.height = "";
    _historique.push({role:"user", parts:[{text:q}]});
    _enAttente = true;
    _etape = "";
    rendreMessages();

    const errBanner = document.getElementById("iaErrorBanner");
    if(errBanner) errBanner.hidden = true;

    /* LE CONTEXTE EST JOINT AU DERNIER MESSAGE et non une fois pour toutes :
       entre deux questions, l'utilisateur a pu appliquer une carte, relancer
       un calcul, changer de motif. Un contexte posé au début de la
       conversation serait périmé dès la seconde question — et le modèle
       raisonnerait sur des réglages qui n'existent plus. */
    let contexte = "";
    if(_inclureContexte)
      contexte = "ETAT COURANT DES REGLAGES DANS L'OUTIL :\n" +
                 extraireContexteOpenems();

    let endpointModel = _modele;
    let thinkingLevel = null;
    let temperature = 0.2;
    const estGemma = _modele.indexOf("gemma") >= 0;

    if(_modele === "gemini-3.8-flash-thinking"){
      endpointModel = "gemini-3.8-flash";
      thinkingLevel = "high";
      temperature = 0.2;
    } else if(_modele === "gemini-3.8-flash"){
      endpointModel = "gemini-3.8-flash";
      thinkingLevel = "low";
      temperature = 0.2;
    } else if(estGemma){
      endpointModel = "gemma-4-31b-it";
      temperature = 0.7;
    }

    const contents = [];
    const passes = _historique.filter(m => !m.localOutil);
    passes.forEach(function(m, i){
      let t = (m.parts && m.parts[0] && m.parts[0].text) || "";
      if(i === passes.length - 1 && m.role === "user" && contexte)
        t = contexte + "\n\n----\nQUESTION : " + t;
      contents.push({role:m.role, parts:[{text:t}]});
    });

    const genConfig = {
      temperature: temperature,
      maxOutputTokens: 8192
    };
    if(thinkingLevel){
      genConfig.thinkingConfig = { thinkingLevel: thinkingLevel };
    }

    const local = (_fournisseur === "local");
    const outils = outilsLecture();
    const systeme = promptSysteme() + consigneOutils(outils);
    const params = {cle:_cleApi, url:_local.url,
                    modele:local ? _local.modele : endpointModel,
                    systeme:systeme, contents:contents,
                    genConfig:genConfig};
    const appelerApi = async (p) => {
      const r = requeteIa(_fournisseur, p);
      return await fetch(r.url, r.init);
    };

    /* Un appel au modèle, avec ses secours ; le repli sans consigne système,
       une fois pris, vaut pour les tours suivants de la même question. */
    let sansSysteme = false;
    const demander = async (conv) => {
      const avecConsigne = () => {
        const alt = JSON.parse(JSON.stringify(conv));
        if(alt.length && alt[0].role === "user")
          alt[0].parts[0].text = systeme + "\n\n" + alt[0].parts[0].text;
        return Object.assign({}, params, {systeme:"", contents:alt});
      };
      const p = sansSysteme ? avecConsigne() : Object.assign({}, params, {contents:conv});
      let rep = await appelerApi(p);

      /* Retry automatique en cas d'erreur 500 / 503 (transitoire côté Google) */
      if(rep.status >= 500){
        await new Promise(r => setTimeout(r, 1500));
        rep = await appelerApi(p);
      }

      /* Repli si le modèle refuse `systemInstruction` (HTTP 400). Propre à
         Google : un serveur compatible OpenAI prend la consigne comme un
         message « system », et n'a rien à refuser. */
      if(!local && !sansSysteme && rep.status === 400){
        sansSysteme = true;
        rep = await appelerApi(avecConsigne());
      }

      if(!rep.ok){
        let err = {};
        try{ err = await rep.json(); }catch(_){}
        /* Google et OpenAI rendent {error:{message}}, Ollama natif {error:"…"}. */
        const em = err.error && (typeof err.error === "string"
                                   ? err.error : err.error.message);
        throw new Error(em || ("Erreur HTTP " + rep.status));
      }
      return texteReponse(_fournisseur, await rep.json());
    };

    try{
      /* LA BOUCLE DES OUTILS DE LECTURE : tant que le modèle demande des
         données par des blocs ```outil, la page les lui rend et il reprend.
         Ces tours ne vivent que dans `conv` ; l'historique ne garde que la
         question et la réponse finale, avec la liste de ce qui a été lu. */
      const conv = contents.slice();
      const consultes = [];
      let texte = await demander(conv);
      for(let tour = 1; tour <= OUTIL_TOURS; tour++){
        const resultats = executerOutils(texte, outils);
        if(!resultats) break;
        resultats.forEach(r => consultes.push(r.titre));
        _etape = resultats.map(r => r.titre).join(" · ");
        rendreMessages();
        conv.push({role:"model", parts:[{text:texte}]});
        conv.push({role:"user", parts:[{text:"RESULTATS DES OUTILS :\n\n" +
          resultats.map(r => "### " + r.titre + "\n" + r.texte).join("\n\n") +
          (tour === OUTIL_TOURS ? "\n\nDERNIER TOUR : reponds maintenant avec ces donnees, sans nouveau bloc outil." : "")}]});
        texte = await demander(conv);
      }
      texte = texte.replace(/```outil\s*\n[\s\S]*?```/g, "").trim();
      if(!texte) texte = "*(aucune réponse textuelle reçue du modèle)*";
      texte = nettoyerReponse(texte);
      if(consultes.length)
        texte = "*🔎 Consulté : " + Array.from(new Set(consultes)).join(" · ") + "*\n\n" + texte;

      _historique.push({role:"model", modele:nomModele(),
                        parts:[{text:texte}]});
    }catch(e){
      /* Le message de l'utilisateur est retiré : l'API attend une alternance
         stricte question / réponse, et une question restée sans réponse ferait
         refuser tout le reste de la conversation. */
      if(_historique.length && _historique[_historique.length - 1].role === "user")
        _historique.pop();
      const m = String(e.message || e);
      console.error(local ? "Appel du modèle local :" : "Appel Google AI Studio :", e);
      /* « Failed to fetch » ne dit pas pourquoi, et en local il y a deux
         causes, pas une : le serveur n'est pas lancé, ou il refuse l'ORIGINE
         de la page. Ollama n'accepte d'emblée que localhost et 127.0.0.1 — une
         page ouverte par l'adresse réseau du poste (--reseau) est refusée tant
         que OLLAMA_ORIGINS ne la nomme pas. */
      const pasDeReponse = m.indexOf("Failed to fetch") >= 0 ||
                           m.indexOf("NetworkError") >= 0;
      afficherErreur(local
        ? (pasDeReponse
            ? "Pas de réponse du modèle local à " + _local.url + " : est-il "+
              "lancé ? Ollama refuse aussi une page d'une autre origine que "+
              "localhost tant que OLLAMA_ORIGINS ne la nomme pas."
            : m)
        : (m.indexOf("API_KEY_INVALID") >= 0 || m.indexOf("API key not valid") >= 0)
          ? "Clé API Google AI Studio invalide. Vérifiez-la, ou générez-en une autre."
          : (pasDeReponse
              ? "Pas de réponse de Google AI Studio : ce poste a-t-il un accès "+
                "réseau ? « verifier » et « help », eux, marchent sans."
              : m));
      _questionEnAttente = q;
      const inputEl = document.getElementById("iaInput");
      if(inputEl){
        inputEl.value = q;
        inputEl.style.height = "auto";
        inputEl.focus();
      }
    }
    _enAttente = false;
    _etape = "";
    rendreMessages();
  }

  /* ==========================================================================
     Ouvrir, fermer
     ========================================================================== */
  window.iaOuvrir = async function(){
    construireDom();
    if(typeof wsShow === "function"){
      wsShow("ia");
      if(typeof WS !== "undefined" && WS.panels && WS.panels.ia &&
         WS.panels.ia.collapsed && typeof wsToggleCollapse === "function")
        wsToggleCollapse("ia");
    }
    const btn = document.getElementById("bIaAssistant");
    if(btn) btn.classList.add("on");

    /* Un modèle local choisi dans cet onglet, et que la fermeture n'a pas
       encore oublié (un rechargement de page, par exemple) : on le reprend. */
    if(!_cleApi && _fournisseur !== "local"){
      try{
        const l = JSON.parse(sessionStorage.getItem(IA_SESSION_LOCAL) || "null");
        if(l && l.url && l.modele){ _fournisseur = "local"; _local = l; }
      }catch(_){}
    }
    if(_fournisseur === "local"){ basculerVersChat(); return; }

    if(!_cleApi){
      try{
        const stocke = sessionStorage.getItem(IA_SESSION_CLE);
        if(stocke) _cleApi = stocke;
      }catch(_){}
      if(!_cleApi){
        try{
          const base = (typeof oeBase === "function") ? oeBase() : "";
          const resp = await fetch(base + "/api/ia/cle");
          if(resp.ok){
            const data = await resp.json();
            if(data && data.dispo && data.cle) _cleApi = data.cle;
          }
        }catch(_){}
      }
    }

    if(!_cleApi) afficherEcranCle();
    else basculerVersChat();
  };

  window.iaFermer = function(){
    iaPurgerCle();
    if(typeof wsClose === "function") wsClose("ia");
    const btn = document.getElementById("bIaAssistant");
    if(btn) btn.classList.remove("on");
  };

  /* ==========================================================================
     Ce qui est exposé
     --------------------------------------------------------------------------
     Les trois premières pour les menus contextuels des outils, comme dans
     WEB_CAO. Les suivantes pour le banc d'essai : il charge ce fichier sans
     navigateur et ne peut pas atteindre l'intérieur de la fermeture, or c'est
     précisément la barrière — liste blanche, bornes, aller-retour — qui doit
     être prouvée ligne à ligne. Les exposer est le prix de cette preuve.
     ========================================================================== */
  window.iaAfficherMenuContextuel = iaAfficherMenuContextuel;
  window.iaCacherMenuContextuel = iaCacherMenuContextuel;
  window.iaPurgerCle = iaPurgerCle;
  window.iaAuditLocal = auditLocal;

  window.iaResoudre = resoudre;
  window.iaValider = valider;
  window.iaProposition = proposition;
  window.iaAppliquer = appliquer;
  window.iaAnnuler = annuler;
  window.iaControles = controles;
  window.iaGrammaire = grammaire;
  /* LA CONSIGNE ELLE-MÊME. Le banc vérifie qu'elle décrit bien les cartes que
     le code sait appliquer : une quatrième carte ajoutée sans la décrire
     serait une capacité que le modèle n'utiliserait jamais, et personne ne
     s'en apercevrait — elle ne casse rien, elle ne sert simplement à rien. */
  window.iaPromptSysteme = promptSysteme;
  /* Le contexte envoyé au modèle, tel quel : le banc y relit le tableau d'un
     balayage terminé. */
  window.iaContexte = extraireContexteOpenems;
  window.iaOutils = outilsLecture;
  window.iaExecuterOutils = executerOutils;
  /* LA REQUÊTE ET SA LECTURE, sans réseau : le banc vérifie que la clé Google
     reste dans l'en-tête et qu'aucune ne part vers un serveur local. */
  window.iaRequete = requeteIa;
  window.iaTexteReponse = texteReponse;
  window.iaFormaterMarkdown = formaterMarkdown;
  window.IA_CHAMPS = IA_CHAMPS;

  /* ==========================================================================
     Les branchements
     ========================================================================== */
  function initialiserLiaisons(){
    construireDom();

    /* Fermer la section purge la clé — c'est la promesse de l'en-tête, et elle
       ne vaut que si elle est tenue par le code. */
    if(typeof window.wsClose === "function"){
      const base = window.wsClose;
      window.wsClose = function(id){
        if(id === "ia") iaPurgerCle();
        return base.apply(this, arguments);
      };
    }

    /* La disposition peut masquer le panneau sans passer par `wsClose` — un
       profil rechargé, une remise à plat. Le bouton doit suivre, et la clé
       partir avec. */
    if(typeof window.wsApply === "function"){
      const base = window.wsApply;
      window.wsApply = function(){
        const res = base.apply(this, arguments);
        const btn = document.getElementById("bIaAssistant");
        if(btn && typeof wsPlaceOf === "function"){
          const ouvert = wsPlaceOf("ia") !== "hidden";
          btn.classList.toggle("on", ouvert);
          if(!ouvert && (_cleApi || _fournisseur === "local")) iaPurgerCle();
        }
        return res;
      };
    }

    const btn = document.getElementById("bIaAssistant");
    if(btn){
      btn.classList.add("tb-ia");
      btn.onclick = function(e){
        e.preventDefault();
        if(typeof wsPlaceOf === "function" && wsPlaceOf("ia") !== "hidden") iaFermer();
        else iaOuvrir();
      };
    }
  }

  if(typeof document !== "undefined" && document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialiserLiaisons);
  else
    initialiserLiaisons();

})();
