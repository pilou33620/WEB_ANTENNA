# Antenne openEMS

Prendre une antenne **telle qu'elle est routée** dans un fichier IPC-2581 — ou
**la dessiner ici** quand elle n'existe encore nulle part —, la conduire
jusqu'à **openEMS**, et rendre le S₁₁, l'impédance d'entrée et le diagramme de
rayonnement.

L'outil n'optimise aucune antenne. Il fait la seule chose qui manque entre une
géométrie de cuivre et un solveur de champ : la traduire en un modèle FDTD
**dont on sait ce qu'il contient**, et le dire.

Deux points d'entrée, **un seul chemin derrière** : le fichier de fabrication,
et le mode conception. Le second fabrique un document au format du premier —
tout ce qui suit est le même code, y compris les refus.

Interface en HTML / CSS / JavaScript, traitement en Python.

## Prérequis & Démarrage rapide

L'outil nécessite trois éléments essentiels :
1. **Les binaires openEMS (`openEMS/`)** contenant le solveur, ses DLL (`CSXCAD.dll`, `openEMS.exe`) et les roues Python dans `openEMS/python/`.
2. **L'environnement virtuel Python (`env/`)** créé impérativement avec **Python 3.10 ou 3.11 (64 bits)** avec les dépendances (`pip install -r requirements.txt`).
3. **ParaView** (facultatif). Les champs s'affichent et s'animent désormais **dans l'outil** (panneau « Champs ») : ParaView ne sert plus qu'à ce qu'une carte plane ne montre pas — coupe oblique, lignes de champ, rendu volumique.

*(Voir la section détaillée [Installation complète des prérequis](#installation-complète-des-prérequis) en bas de page pour les liens de téléchargement).*

### Lancement

```bash
# Démarrer le serveur (détecte et bascule automatiquement dans env/ s'il existe)
python web_antenna.py
```

La page s'ouvre toute seule dans votre navigateur. **Le port affiché au démarrage n'est pas
toujours 8000** : voir « Le port » ci-dessous.

Sans carte sous la main :

```bash
python test/carte-antenne.py
```

écrit `test/patch-2450.xml`, un patch 2,45 GHz sur FR-4 de 1,6 mm dont la
résonance se calcule à la main — de quoi essayer l'outil et savoir d'avance ce
qu'on doit trouver.

### Le port

Windows **réserve des plages entières de ports** (Hyper-V, WSL, Docker), et
8000 y tombe souvent — sur le poste de développement, `netsh interface ipv4
show excludedportrange protocol=tcp` le liste noir sur blanc, et le service
HTTP du noyau (PID 4) l'écoute par-dessus le marché. La tentative échoue alors
sur un `WinError 10013`, « accès interdit par ses autorisations », qui laisse
croire à un droit administrateur manquant alors qu'aucun droit n'y changerait
rien.

Le serveur n'abandonne donc pas : il dit pourquoi le port est refusé, rappelle
la commande `netsh` qui le prouve, puis essaie 8080, 8010, 8800, 8081, 5000,
3000 — et, en dernier recours seulement, un port au choix du système. Des
ports fixes d'abord, pour que les favoris du navigateur survivent à un
redémarrage.

Deux pièges Windows sont désamorcés au passage, et tous deux donnaient un
serveur qui **démarre en annonçant une adresse qui n'est pas la sienne** :

* `SO_REUSEADDR` n'a pas le même sens sur Windows. Sur Unix il reprend un port
  laissé en `TIME_WAIT` ; sur Windows il autorise à se lier à un port **qu'un
  autre programme écoute déjà**. Le drapeau est donc désactivé là-bas.
* Une socket IPv6 en double pile se lie à `[::]:8080` **sans broncher** quand
  un autre programme tient `0.0.0.0:8080`, et `IPV6_V6ONLY` continue de rendre
  0 : aucun drapeau ne trahit la situation, et tous les clients IPv4 —
  `127.0.0.1` compris — atterrissent chez l'autre programme. L'IPv4 est donc
  sondée explicitement avant chaque tentative.

### Quel Python

`web_antenna.py` n'a **aucune dépendance** : il démarre sous le Python du système.
openEMS, numpy et h5py, eux, vivent presque toujours dans un environnement
virtuel à côté — et un `python web_antenna.py` lancé depuis une invite ordinaire
ne l'utiliserait pas : le bouton « Lancer » resterait éteint sur un poste où
tout est pourtant installé.

Le serveur cherche donc l'interpréteur qui sait **vraiment** importer CSXCAD :
celui qui le fait tourner d'abord, puis `env/`, `.venv/`, `venv/` à côté de
`web_antenna.py`. Celui qui est retenu est annoncé au démarrage, et la liste des
essais figure dans l'état renvoyé à la page.

## Arborescence

```
├── web_antenna.py          le serveur : trois choses qu'un navigateur ne sait pas faire
├── index.html              la page, avec la modale de classification des nets (PWR, GND, Signal)
├── css/
│   ├── theme.css           le thème « dashboard nocturne » et les styles des modales / badges
│   ├── workspace.css       les panneaux détachables
│   ├── antenne.css         ce que cet outil ajoute
│   └── ia.css              le panneau de l'assistant IA, repris de WEB_CAO
├── js/
│   ├── 00 … 06             lire, afficher et classifier la carte IPC-2581 (GND, PWR, Signal)
│   ├── 10 … 16             l'outil : état, géométrie, assistant, 3D, surimpression 2D accélérée Path2D
│   ├── 17-objets.js        les objets qui ne sont pas sur la carte
│   ├── 18-champs.js        enregistrer les champs, et aller les regarder
│   ├── 19-demarrage.js     les branchements
│   ├── 20 … 23            le mode conception : dessiner au lieu d'importer
│   ├── 24-balayage.js      une ou deux cotes, une plage, une famille de courbes
│   ├── 25-polygones.js     l'intersection exacte de deux polygones
│   ├── 26-exemple.js       les boutons « Patch » et « IFA » : deux cas connus, d'un clic
│   ├── 27-apercu-motif.js  le dessin coté d'un motif d'antenne, avant de le poser
│   ├── 28-projet.js        capturer la séance, et la reprendre
│   ├── 29-tableau-s.js     le tableau S complet, et son fichier Touchstone
│   ├── 30-ia.js            l'assistant IA : vérification locale, et le modèle si on veut
│   ├── 31-rapport.js       le rapport d'ingénierie (avec charge cellules × nmax et localisation de la plus petite cellule)
│   ├── 32-visionneuse.js   la carte de champ animée, lue dans les .vtr — sans ParaView
│   ├── 33-pieces.js        les pièces importées (STEP, STL) : boîtier, piles, une matière par corps
│   ├── 34-placement.js     les placer à la souris en 3D : choisir, glisser, accrocher face contre face
│   ├── travailleur-occt.js le lecteur STEP/IGES/BREP, dans un fil à part
│   ├── 90-workspace.js     les panneaux détachables
│   ├── vendor/three.min.js three.js r134, posé ici et non pris sur un CDN
│   └── vendor/occt/        OpenCascade en WebAssembly (occt-import-js), repris de WEB_3D
├── python/
│   ├── ipc2581_*.py        le parseur IPC-2581 (filtrage calques hors cuivre/perçage, netClass) et sa traduction en JSON
│   ├── openems_modele.py   le document relu, vérifié, nettoyé (masse cachée, fusions, ports), maillé, chiffré
│   ├── openems_pieces.py   les pièces importées : recollées, vérifiées fermées, placées, leurs faces maillées
│   ├── openems_script.py   le modèle → un script Python autonome
│   ├── openems_run.py      l'exécution en sous-processus, et son suivi
│   ├── openems_champs.py   les .vtr relus : inventaire, tranche, amplitude et phase
│   ├── openems_antenne.py  la façade : les seules fonctions que web_antenna.py connaît
│   ├── projet.py           les projets sur le disque : où on les range, et comment on les rouvre
│   └── test/
│       ├── banc-openems.py   le banc principal : 852 vérifications sans solveur, 23 sections
│       └── banc-champs.py    le format .vtr, l'inventaire, le découpage
├── test/
│   ├── carte-antenne.py    fabrique une carte d'essai IPC-2581
│   ├── patch-2450.xml      … celle qu'elle produit
│   ├── banc-polygones.js   le découpage des découpes, cas dégénérés compris
│   └── banc-interface.js   ports, balayage, unités, liste blanche de l'IA, classification nets, robustesse
├── env/                    l'environnement virtuel Python (dépendances pip)
├── openEMS/                les binaires du solveur (à télécharger, voir « Installation »)
└── ParaView-…/             le visualiseur 3D externe (à télécharger, facultatif)
```

## Ce que le serveur fait, et pourquoi il existe

Il ne sert que ce **qu'un navigateur ne sait pas faire** :

1. **lire un fichier IPC-2581.** Le parseur est en Python, il fait soixante-dix
   kilo-octets de code, et aucun navigateur ne l'exécutera. La page envoie le
   fichier tel quel, le modèle traduit revient en JSON, et à partir de là tout
   se passe dans le navigateur ;
2. **appeler openEMS.** Le solveur est un binaire C++ piloté par des liaisons
   Python ;
3. **écrire sur le disque, et relire.** Un projet est un dossier que vous
   choisissez — voir « Les projets » ci-dessous. Une page web n'écrit pas là
   où on lui dit, et le stockage local d'un navigateur n'est ni un dossier,
   ni sauvegardable, ni partageable.

Et une quatrième, minuscule, qui tient à la même raison que la troisième :

4. **relire la clé du mode IA.** `GET /api/ia/cle` rend ce qu'il trouve dans
   `api_key_free_ia_studio.txt` ou dans `GEMINI_API_KEY`. Il ne la garde pas,
   ne s'en sert pas, et n'appelle personne avec — voir « Le mode IA ». C'est
   la **seule route réservée à la boucle locale** : elle rend un secret
   facturable, et ce serveur écoute le réseau local par défaut.

Tout le reste — l'affichage, la désignation du cuivre, l'assistant, la 3D, les
courbes — est dans le navigateur et n'a besoin de personne.

`web_antenna.py` n'a **aucune dépendance externe** : bibliothèque standard
seulement.

## Les projets — choisir où ranger, et reprendre où l'on s'était arrêté

Une antenne ne se dimensionne pas d'une traite : on simule, on allonge le patch
de 0,4 mm, on resimule, et cela prend plusieurs séances. Un projet est ce qui
rend la deuxième séance possible.

**Un projet est un dossier, et vous choisissez lequel.** Le panneau
« 📁 Projet » porte en haut le *dossier de travail* ; chaque projet y reçoit
son propre sous-dossier :

```
<dossier de travail>/<nom du projet>/
├── projet.json      le dessin, les réglages, l'affichage
├── carte.json       le document de la carte, tel que le parseur l'a rendu
├── resultats.json   le dernier résultat : S₁₁, impédance, rayonnement
└── calculs/         un dossier par simulation lancée — scripts, journaux, champs .vtr
```

Le chemin saisi est celui du **poste qui fait tourner le serveur**, et non
celui du navigateur : sur un lecteur réseau, il doit y être connecté. Le choix
est retenu d'une séance à l'autre, dans `~/.antenne-openems.json`.

### Ce qu'un projet garde, et ce qu'il ne garde pas

| gardé | pourquoi |
|---|---|
| le **dessin** — formes, empilage, matériaux, grille, fréquence visée | c'est le seul qui ne se reconstitue pas : sans lui, la deuxième passe recommence au crayon |
| la **carte importée**, telle que le parseur l'a rendue | pour que les rangs auxquels le cuivre désigné fait référence désignent encore la même chose |
| le **cuivre désigné** — nets, formes une à une, plan de masse, couches | sur un fichier sans netlist, c'est un travail de clic qu'on ne veut pas refaire |
| les **réglages** — bande, ports, boîte, maillage, arrêt, champ lointain, enregistrements | |
| les **valeurs d'empilage saisies à la main** | elles décrivent *cette carte-ci*, pas un goût d'affichage |
| le **dernier résultat**, et l'affichage — couches masquées, face, cadrage | les courbes reviennent avec le projet, serveur éteint ou non |

| pas gardé | pourquoi |
|---|---|
| la disposition des panneaux | elle appartient au poste, pas au travail — elle reste dans le stockage local |
| le **suivi** d'une simulation en cours | une simulation tourne dans un processus du serveur ; c'est son *résultat* qui est gardé, et son dossier de calcul reste sur le disque à côté du projet |

| gardé, mais pas dans le document | pourquoi |
|---|---|
| le **dossier de calcul d'openEMS** — journal, script, `.vtr` des champs | il pèse trop pour un fichier JSON ; il vit dans `calculs/`, et « Enregistrer » l'y range même s'il avait commencé dans le `TEMP` |

### Les simulations écrivent dans le projet

Tant qu'aucun projet n'est ouvert, openEMS écrit dans le dossier temporaire du
système : c'est le bon endroit pour un essai qu'on ne gardera pas. Dès qu'un
projet est ouvert, les dossiers de calcul vont dans `calculs/`. Ce n'est pas un
détail de rangement : un enregistrement de champ fait des centaines de
méga-octets de `.vtr` que ParaView relit, et les laisser dans `TEMP` revient à
les perdre au premier nettoyage de disque, sans que rien ne l'annonce.

**Et si le calcul a été lancé avant d'avoir nommé le projet ?** C'est le cas
le plus courant — on nomme son travail quand il a donné quelque chose.
« Enregistrer » **déplace alors le dossier de calcul du `TEMP` vers le
projet**, champs compris : les courbes et les `.vtr` partent ensemble, en un
seul geste, et il n'y a rien de plus à faire. Le bouton
**« 💾 Tout enregistrer dans le projet »**, à la fin de l'étape « Le calcul »,
fait exactement la même chose à l'endroit où l'on regarde quand la simulation
vient de finir.

Trois bornes, et elles comptent : le déplacement ne part **que** d'un dossier
que le serveur a lui-même créé (la page n'envoie jamais un chemin, seulement
un identifiant de simulation), il **refuse** de bouger un calcul qui tourne
encore, et il **n'écrase jamais** un dossier déjà rangé. Si le déplacement
échoue — disque plein, fichier tenu ouvert par ParaView —, le projet est
enregistré quand même et l'outil dit ce qui n'a pas pu être rangé : les
courbes ne se perdent pas parce que les champs ont résisté.

La fin d'une simulation **lève le drapeau « modifications non enregistrées »**,
comme le ferait n'importe quel réglage. Sans cela, un projet enregistré juste
avant le lancement s'affichait « à jour » deux heures plus tard, alors que ses
courbes n'étaient nulle part.

### Retrouver un calcul, et en importer un

`resultats.json` ne retient qu'**un** calcul : le dernier. Un projet, lui, en
accumule un par simulation lancée. Après cinq simulations, cinq dossiers sont
dans `calculs/` avec leurs champs — et pendant longtemps la page n'en
atteignait qu'un seul.

Le bouton **« 📂 Dossiers de calcul du projet »**, à la fin de l'étape « Le
calcul », les liste tous : date, nombre de fichiers de champ, poids. Un clic
sur l'un d'eux l'ouvre dans la visionneuse — le pied du panneau dit alors
lequel on regarde, et « 🎞 Voir les champs » revient au dernier. Un nouveau
calcul lancé lève le choix de lui-même : regarder les champs d'avant-hier sur
une géométrie qu'on vient de modifier est exactement l'erreur qu'il faut
rendre impossible.

**Importer un dossier de calcul.** Le même bloc porte un champ de chemin :
celui d'une clé USB, d'un partage réseau, d'un calcul mené à la main sur une
autre machine. Le dossier est **copié** dans `calculs/` sous un identifiant
neuf, et devient un calcul comme les autres — visible dans la liste, lisible
par la visionneuse, emporté avec le projet.

| ce que l'import fait | ce qu'il ne fait pas |
|---|---|
| **copier** les fichiers d'un dossier de calcul : les `.vtr` des champs, le script, le journal, un seul niveau de sous-dossier | il ne **déplace** rien, et ne modifie jamais l'original — ce dossier-là appartient à quelqu'un |
| écrire dans `<projet>/calculs/<identifiant neuf>`, et nulle part ailleurs | il ne copie pas les fichiers étrangers à un calcul, et le dit : « n fichiers laissés de côté » |
| refuser un dossier **sans aucun `.vtr`** — il n'y aurait rien à regarder | il ne laisse jamais une copie à moitié faite : en cas d'échec, le dossier créé est retiré |

Le chemin est celui du **poste qui fait tourner le serveur**, pas celui du
navigateur : c'est la même règle que pour le dossier de travail, et pour la
même raison. C'est aussi le seul chemin, avec la racine des projets, qu'une
requête dicte au serveur — d'où les trois bornes du tableau ci-dessus.

**Et un projet entier venu d'ailleurs ?** Il n'y a rien à importer : on pointe
le *dossier de travail* sur le dossier qui le contient, ou on copie le projet
dans la racine actuelle. Les chemins absolus écrits dans ses fichiers n'ont
aucune importance — un dossier de calcul se retrouve par son **identifiant**
sous `<projet>/calculs/`, jamais par le chemin stocké. Un projet est donc
transportable tel quel, d'une machine à l'autre et d'un disque à l'autre.

### Enregistrer, reprendre

* **Enregistrer** : le bouton du panneau, ou <kbd>Ctrl</kbd>+<kbd>S</kbd>.
  Changer le nom avant d'enregistrer fait une copie sous ce nouveau nom —
  c'est l'« enregistrer sous » de l'outil, et c'est ce qu'on fait avant
  d'essayer une variante.
* **Reprendre** : la liste du panneau, ou les boutons de l'écran d'accueil.
  C'est la troisième façon de commencer, à côté d'ouvrir un fichier et de
  dessiner — et après la première séance, c'est la plus fréquente.

La carte n'est **réécrite que si elle a changé**. Une carte de fabrication fait
des dizaines de méga-octets ; changer une fréquence ne doit pas les renvoyer.

### Ce que l'outil refuse de faire à votre dossier

Il n'y a **aucune route de suppression**. Le serveur ne crée que des
sous-dossiers dont le nom a passé une liste de ce qui est *permis* — pas de
séparateur, pas de `..`, pas de nom réservé par Windows, quatre-vingts
caractères au plus — et il n'écrit que les trois fichiers nommés ci-dessus. Un
outil qui écrit dans un dossier choisi à la main ne doit pas avoir de moyen
d'en détruire le contenu par une requête.

## Les sept étapes, et pourquoi elles existent

Une simulation FDTD d'antenne échoue toujours de la même poignée de façons, et
**aucune de ces façons ne se voit dans le résultat**. Un S₁₁ calculé avec une
marge d'air trop courte, une permittivité devinée ou un port mal orienté ne
ressemble pas à une erreur : il ressemble à un résultat. Chaque étape existe
pour une de ces fautes.

### 1. Le cuivre — ce qui part au solveur

On désigne l'antenne en la **cliquant sur la carte** ; `Ctrl`+clic en prend
plusieurs morceaux, parce qu'une antenne coupée par un condensateur d'accord
n'est pas un net mais deux.

Ce qui est cliqué entre **par son net** quand le fichier en déclare un, et
**pièce par pièce** sinon. Beaucoup d'exports IPC-2581 ne portent aucune
connectivité : tout leur cuivre tombe alors dans un fourre-tout que le parseur
nomme `Non-Net`, et retenir ce « net » reviendrait à modéliser la carte
entière, antenne et masse confondues — le port exciterait un conducteur contre
lui-même. L'assistant le reconnaît, le dit, et retient la piste, le versement,
la pastille ou le via effectivement montrés du doigt. Chaque morceau retenu a
son jeton, et se retire du même clic.

Le net de **masse** est deviné (le plus grand versement dont le nom le dit, à
défaut le plus grand tout court, jamais un fourre-tout) et reste modifiable. Il compte autant que
l'antenne : une antenne imprimée rayonne **contre** son plan de masse, et le
tronquer change le diagramme et l'impédance.

Les **couches** se cochent une par une. C'est le principal levier sur la taille
du maillage, et c'est pourquoi il est à l'étape 1 et non caché dans les
réglages.

#### La classification des nets (GND, PWR, Signal) & préréglages de simulation

Pour les cartes complexes où cohabitent des dizaines ou centaines d'équipotentielles,
le bouton **« ⚡ Classifier »** du panneau Nets ouvre une modale dédiée :
- **Auto-détection multi-critères** : lit l'attribut officiel IPC-2581 `netClass`
  s'il est présent (`GROUND`, `POWER`, `SIGNAL`), applique des expressions
  régulières exhaustives sur les nomenclatures usuelles (`GND`, `0V`, `VCC`, `VDD`,
  `+3V3`, `1V8`...), calcule la tension nominale des rails, repère les condensateurs
  de découplage reliant une alimentation à la masse, et détecte les versements de
  cuivre surfaciques (> 25 % de l'aire de la carte).
- **Contrôle segmenté immédiat** : chaque net s'assigne d'un clic en ⏚ **GND**,
  ⚡ **PWR** ou 〰 **Signal**. Des filtres rapides par boutons (`Tous`, `Signal`,
  `PWR`, `GND`) et une recherche textuelle permettent un tri instantané.
- **Préréglages de simulation automatiques** : valider applique immédiatement
  le plan de masse dominant, configure les garde-fous pour les lignes RF / signaux
  rapides (SI) et identifie les plans d'alimentation pour l'intégrité de puissance (PI).

#### Le nettoyage géométrique transparent et la masse cachée

Sur une carte de fabrication réelle (comme le cas d'école `P01x274PCB-C.xml`, avec ses milliers de pastilles),
quatre simplifications automatiques évitent au solveur des millions de cellules inutiles :

* **La masse cachée par le plan de référence** : sur un empilage multicouche, le
  cuivre de masse situé entièrement derrière le plan de masse de référence (opaque
  en FDTD aux fréquences de calcul) ne participe pas au rayonnement de l'antenne.
  L'outil le retire automatiquement ainsi que les vias de couture devenus orphelins.
  Une case **« Garder toute la masse »** permet de désactiver ce filtre pour
  comparer — sur une carte 4 couches, l'écart sur le rayonnement est typiquement
  inférieur au dixième de décibel, pour un gain de maillage et de temps considérable.
* **L'absorption des polygones recouverts** : les pastilles et pistes tracées
  *à l'intérieur* d'un plan plein sur la même couche constituent le même métal.
  Leurs arêtes ajoutaient des dizaines de lignes de maillage parasites sans décrire
  la moindre frontière physique : elles sont désormais absorbées et décomptées.
* **L'écart des polygones dégénérés** : les débris d'exportation CAO inférieurs à
  1 µm (rayons de pastilles thermiques discrétisés, contours aplatis) tiraient la
  largeur de cuivre minimale vers zéro et faussaient le pas fin du maillage. Ils
  sont éliminés à l'entrée.
* **La réduction d'empilage** : deux couches diélectriques identiques séparées
  par une couche conductrice entièrement vide (aucun cuivre retenu, aucun via,
  aucun port) sont fusionnées en un seul diélectrique continu d'épaisseur cumulée,
  allégeant le maillage en Z.

### 2. L'empilage — ce que le fichier ne dit pas

Beaucoup de fichiers IPC-2581 ne listent que leurs conducteurs : l'épaisseur
des diélectriques et leur permittivité sont des informations de fabrication, et
l'outil de CAO ne les exporte pas toujours. **Une permittivité fausse de 10 %
déplace la résonance d'environ 5 %** — assez pour être hors bande sans savoir
pourquoi. Chaque valeur porte donc sa provenance : `fichier`, `saisi` ou
`supposé`.

### Les pertes du diélectrique, deux façons de les dire

* **Conductivité équivalente** (défaut) — κ = 2πf·ε₀·εᵣ·tanδ, la seule forme
  qu'openEMS accepte directement. Elle n'est juste qu'à **une seule
  fréquence** : ailleurs tanδ varie comme 1/f, alors qu'un stratifié réel le
  garde à peu près constant. Sur 2–3 GHz, l'écart aux bords atteint **25 %**.
  La fréquence de référence se choisit ; l'écart est affiché.
* **Pôles de Debye** — une somme de relaxations réparties en logarithme, qui
  tient tanδ plat sur toute la bande : **0,02 %** d'écart sur une bande
  étroite, 2,4 % sur une décade. L'écart affiché est **mesuré sur le jeu de
  pôles retenu**, pas promis par le modèle.

  Ce matériau n'est pas atteignable par les liaisons Python : CSXCAD 0.6.3
  n'expose aucune classe dispersive, et `AddMaterial(eps_Delta=…)` répond
  « unknown material property ». Le script écrit donc la structure au format
  XML de CSXCAD, convertit le `<Material>` en `<DebyeMaterial>`, et la relit —
  **dans le même objet**, faute de quoi deux propriétaires pour une seule
  structure C++ font tomber l'interpréteur en faute de segmentation à la
  fermeture. Tout cela est écrit et commenté dans le script généré.

  Une borne dure : openEMS **saute en silence** tout pôle dont le temps de
  relaxation ne dépasse pas deux pas de temps. Les pôles sont donc bornés à
  trois pas, et quand la borne mord, l'assistant le dit.

Le **modèle de cuivre** se choisit aussi ici, et le défaut n'est pas celui
qu'on croit :

* **Feuille conductrice** (défaut) — une surface sans épaisseur géométrique qui
  porte quand même la résistance du cuivre réel. À 2,4 GHz l'épaisseur de peau
  fait 1,3 µm : le courant ne voit pas les 35 µm de la couche, seulement sa
  résistance.
* **Conducteur parfait** — aucune perte. Pour dégrossir une géométrie.
* **Volume** — l'épaisseur entre dans le maillage. Comme le pas de temps FDTD
  est commandé par la **plus petite** cellule du domaine, une couche de 35 µm
  ralentit la simulation entière d'un facteur dix ou plus. À ne garder que si
  la géométrie de la tranche compte vraiment.

### Les revêtements extérieurs — la couche la plus coûteuse était la seule qu'on ne voyait pas

Un fichier IPC-2581 déclare son **masque de soudure** dans l'empilage comme
n'importe quelle autre couche : sur `antenna4c.xml`, `Resist-A` et `Resist-B`,
15 µm de résine de part et d'autre de la carte. Le tableau de cette étape, lui,
ne montrait que deux sortes de lignes — les conducteurs, et le diélectrique
**entre** deux conducteurs. Un vernis n'est ni l'un ni l'autre : il est posé
**sur** le cuivre extérieur, hors de tout intervalle. Il partait donc au
solveur sans jamais s'afficher.

Ce qu'il apporte est du second ordre — une permittivité posée sur un
vingt-cinquième de la hauteur du substrat, de quoi abaisser la résonance
d'environ 1 %. Ce qu'il coûte ne l'est pas : **les deux faces d'une couche de
l'empilage portent chacune une ligne de maillage obligatoire**, et 15 µm entre
deux lignes font une cellule quarante fois plus fine que le pas visé. Le pas de
temps FDTD suit la plus petite cellule de **tout** le domaine. Mesuré sur une
carte d'essai qui reprend l'empilage d'`antenna4c` — quatre couches,
120 × 55 mm, bande centrée sur 868 MHz, quatre millions de cellules :

| | plus petite cellule du domaine | pas de temps | durée annoncée |
|---|---|---|---|
| avec les deux vernis | 15 µm, en z | 0,0497 ps | 21 h |
| sans eux | 200 µm, dans le plan | 0,404 ps | 2 h 30 |

Le maillage ne perd que cent mille cellules sur quatre millions : **ce n'est
pas une économie de mémoire, c'est le pas de temps et rien d'autre.**

Un revêtement extérieur plus fin que **50 µm** reste donc **hors du maillage**,
et il n'est pas effacé en silence : la couche a sa ligne dans le tableau, un
avis la nomme, et une case la remet. « Extérieur » se lit sur l'empilage et non
sur le nom de la couche — est extérieur ce qui n'est pas entre les deux cuivres
extrêmes, qu'un fichier nomme son masque `Resist-A` ou `L9`. **Ce qui est entre
deux conducteurs n'est jamais écarté**, si mince soit-il : c'est un substrat, il
porte le champ, et le supprimer collerait deux couches de cuivre l'une sur
l'autre.

Un masque **posé exprès** en mode conception, lui, reste dans le maillage sans
qu'on ait à le redemander : ce mode ne le pose pas d'usine, il le propose et
écrit ce qu'il coûte (voir plus bas). La borne des 50 µm ne vaut que pour ce qui
arrive dans un fichier sans qu'on l'ait demandé.

### 3. Autour — ce qui n'est pas sur la carte

Une antenne ne rayonne jamais toute seule : elle est dans un boîtier, au
dessus d'une batterie, au bout d'un câble. Le fichier IPC-2581 ne dit rien de
tout cela — il décrit une carte, pas un produit — et une simulation qui
l'ignore rend un diagramme propre et faux.

Quatre formes, saisies en coordonnées et visibles dans la vue 3D : **fil**
(polyligne épaissie : monopole, brin, câble), **cylindre** (vis, entretoise),
**boîte** (boîtier, batterie, écran ; plate, c'est un réflecteur) et
**sphère**. En métal ou en diélectrique.

Ces objets entrent dans l'emprise : la boîte d'air se mesure depuis eux aussi,
sinon un boîtier se retrouverait **dans** la couche absorbante — c'est-à-dire
hors du calcul, sans que rien ne le dise. Leurs faces portent des lignes de
maillage obligatoires.

Le métal est un **conducteur parfait**. Un boîtier en volume à conductivité
finie demanderait de mailler l'épaisseur de peau — quelques microns, hors de
portée — pour une différence qui se compte en centièmes de décibel.

Ce n'est **pas un éditeur 3D** : quatre formes et des nombres. Une pièce
mécanique réelle — un boîtier avec ses parois, ses bossages, ses congés — ne
se saisit pas en coordonnées : elle **s'importe**, en STEP, dans cette même
étape (voir « Le boîtier et les piles » juste en dessous).

### Le boîtier et les piles — des pièces STEP, une matière par corps

C'est le boîtier qui déplace la résonance : une paroi plastique d'εr ≈ 3 à
quelques millimètres d'une antenne imprimée la tire vers le bas de plusieurs
pour cent, et une pile métallique derrière elle lui coupe une part de son
rayonnement. Sa géométrie existe déjà, dans l'outil de mécanique : l'étape
« Autour » la prend telle quelle.

* **Importer** un fichier **STEP, IGES, BREP ou STL** (bouton, ou dépôt sur le
  bloc). Le STEP est lu **dans le navigateur** par OpenCascade compilé en
  WebAssembly — le même noyau que [WEB_3D](../WEB_3D), posé dans
  `js/vendor/occt/` — et triangulé à la finesse d'une grille FDTD (0,1 mm de
  flèche), pas d'un rendu. Chaque solide du fichier devient un **corps**.
* **Ou poser un modèle** : un **boîtier de principe** autour de la carte (jeu,
  hauteur au-dessus et en dessous, épaisseur de paroi réglables), ou une
  **pile** — CR2032, CR2450, AA, AAA, 18650, LiPo 503450 —, métallique, aux
  cotes des normes.
* **Chaque corps reçoit sa matière** : métal (conducteur parfait), un
  plastique de la liste — ABS, PC, PC/ABS, PA66, PA66-GF30, PLA, PMMA, PP,
  PTFE, silicone, verre, FR-4, alumine, mousse —, un diélectrique saisi à la
  main, ou **ignoré**. Les εr et tan δ de la liste sont des valeurs
  **typiques** autour du gigahertz ; la fiche du fournisseur fait foi, et les
  champs se corrigent. La matière est **devinée** sur le nom que la mécanique
  a donné (« Battery », « Vis M2 », « Shield » → métal), et la **carte
  elle-même**, quand l'export la contient, est ignorée d'office : elle est déjà
  dans le modèle, exacte, cuivre compris.
* **Placer** : une position et trois angles (X, puis Y, puis Z, autour du
  centre de la pièce). Position et rotation à zéro laissent la pièce **où son
  fichier la met** : un export fait dans le repère de la carte tombe juste sans
  rien toucher. Un fichier dessiné ailleurs est ramené au milieu de la carte à
  l'import, et l'outil le dit. Les boutons *centrer sur la carte*, *poser
  dessus*, *poser dessous*, *centrer en Z* et les quarts de tour font le reste.

**Placer à la souris, dans la vue 3D.** Le bouton **3D** d'une pièce ouvre la
vue sur elle ; une barre, en bas de la vue, porte trois gestes.

* **Choisir** — un clic sur une pièce la choisit (elle s'allume en jaune, sa
  fiche aussi, et la ligne du corps touché — c'est ainsi qu'on reconnaît un
  corps qu'un export STEP a nommé « Admi05EC3FB26751 » ; sa taille est écrite
  sous son nom). Un second clic au même endroit prend la pièce **derrière** :
  une pile dans un boîtier fermé se choisit ainsi.
* **Déplacer** — glisser la pièce choisie : dans le plan horizontal, ou le
  long d'un seul axe (boutons, ou touches X, Y, Z). Un **pas** arrondit la
  position. Ailleurs que sur la pièce, le glisser fait tourner la vue, comme
  d'habitude. Au clavier : flèches, Page haut/bas pour Z, Maj pour dix fois
  plus.
* **Accrocher** — deux clics : sur la pièce, puis sur ce qu'elle doit
  toucher — la carte, le boîtier, une autre pièce.
  * *face → face* : la pièce **tourne** pour que les deux faces se regardent
    (case « orienter ») et vient au **contact**, à plat ; « centrer » amène en
    plus le centre de sa face sur celui de l'autre. C'est le geste qui pose
    une pile sur un bossage, ou une coque sur la carte.
  * *point → point* : un point sur un point. Le point pris est le plus proche
    du curseur parmi les sommets, les milieux d'arête **et le centre de la
    face** — viser le milieu d'un disque donne son centre, que la
    triangulation ne porte pourtant pas.
  * *point → face* : la pièce glisse le long de la normale jusqu'au plan.

  Une bille et un anneau montrent ce qui sera pris, avant le clic. Maj vise
  **à travers** la première paroi touchée ; **masquer** retire une pièce de la
  vue (pas de la simulation) — le boîtier, le temps de poser ce qu'il
  contient. **Ctrl+Z** défait le dernier placement.

**Regarder.** La même barre porte le **rendu** — *plein* par défaut (le métal
gris acier, le plastique clair et mat, l'ignoré sombre), *transparent* ou
*filaire* —, une **coupe** par un plan X, Y ou Z qu'un curseur déplace (ce qui
est au-delà n'est ni dessiné ni visé), et les **masques** : chaque corps et
chaque pièce a sa case « visible » dans sa fiche, et *masquer le corps* /
*la pièce* fait la même chose depuis la vue. Masquer ne touche pas à la
simulation, et c'est gardé dans le projet.

**La carte, telle qu'elle est.** La vue 3D dessine aussi la carte
électronique entière — son contour, le **cuivre de ses deux faces** en
texture (les mêmes chemins que la vue 2D, perçages découpés) et ses
**composants** en blocs — pour poser un boîtier contre elle, y accrocher une
face, voir qu'un bossage tombe sur un condensateur. Les composants ont une
**hauteur supposée** (0,3 × √surface, entre 0,35 et 4 mm) : le fichier
IPC-2581 ne la donne pas. Cette représentation ne part pas au solveur ; ce qui
y part est dessiné par-dessus — le substrat et le cuivre retenu.

**La carte se place comme une pièce.** Elle se choisit d'un clic dans la vue
3D — y compris à travers un boîtier opaque —, se glisse, se tourne, s'accroche
face contre face, s'annule par Ctrl+Z, et sa fiche (en tête de la liste des
pièces) porte sa position et sa rotation, un quart de tour par bouton et
« ↺ origine ». Déplacer la carte déplace **la carte** : les pièces restent où
elles sont.

Le solveur, lui, ne voit jamais la carte bouger, et c'est voulu : sa grille
est alignée sur elle, et tout ce qu'il reçoit — cuivre, ports, substrat — est
compté dans le repère de la carte. La page garde donc la place de la carte
dans l'**assemblage**, et envoie les pièces **vues de la carte**
(B⁻¹ ∘ pièce). Tourner la carte de +90° envoie le boîtier tourné de −90° :
c'est la même physique, et le banc vérifie que B · (pièce vue de la carte)
redonne exactement la pièce dans l'assemblage. Tourner la carte d'un angle
quelconque met les parois du boîtier en biais dans la grille — des marches
d'escalier : c'est la vérité du calcul, pas un défaut de l'outil.

**Le substrat de la carte entière.** Par défaut, le stratifié simulé suit
désormais le **contour de la carte** (le `<Profile>` du fichier) et non la
seule emprise du cuivre retenu : une carte dont on n'a retenu que l'antenne
était simulée avec un stratifié tronqué, et la paroi d'un boîtier voyait une
carte plus petite que la vraie. Le substrat part en `AddLinPoly`, ses bords
droits portent une ligne de maillage, et l'emprise — donc le maillage fin —
couvre toute la carte — au pas de son stratifié, le pas fin restant sur le
cuivre. La case, en tête du bloc des pièces, rend l'ancien comportement ; un
projet enregistré avant cette option se rouvre avec l'ancien substrat, pour
que ses résultats restent comparables.

Aucun de ces gestes ne place la pièce de lui-même : il écrit sa position et sa
rotation, comme les champs de la fiche, et le modèle est revérifié. **Sans
modèle** — le serveur a refusé, le port n'est pas encore posé —, la vue 3D
dessine quand même la carte, en plaque, et les pièces : placer le boîtier est
souvent la première chose qu'on fait.

**Un solide fermé, ou rien — et c'est vérifié.** CSXCAD décide qu'une cellule
est dans la pièce en comptant les traversées d'un rayon. Sur une surface
**ouverte**, ou dont les sommets ne sont pas recollés, il répond « dehors »
partout, **sans un avertissement** : vérifié sur CSXCAD 0.6.3, un cube dont
les sommets sont dupliqués par face — c'est ainsi qu'OpenCascade les rend —
est vu vide jusqu'en son centre. La page **recolle** donc les sommets, compte
les arêtes qui ne bordent qu'une face, et **répare** ce qui se répare sans
toucher à la forme : sommets recollés à une tolérance croissante (jusqu'à
0,05 mm, par distance vraie et non par arrondi), **jonctions en T** coupées
(un sommet d'une face au milieu d'une arête de la voisine), **petits trous**
bouchés (moins d'1 mm² ou 2 mm de diagonale). Une vraie ouverture — un
couvercle absent — reste ouverte : la boucher serait inventer de la matière.
Un corps encore ouvert naît **ignoré**, marqué en rouge, avec un bouton
*réparer* aux tolérances élargies (0,2 mm, trous jusqu'à 5 mm²) ; lui donner
une matière fait refuser le modèle, avec la raison. Ce qui a été réparé est
écrit sur la ligne (✓, et le détail au survol). Le serveur refait la
vérification.

**Une ligne de maillage sur chaque paroi.** Une paroi de 1,5 mm qui tombe entre
deux lignes d'une grille à 3 mm est vue à moitié, ou pas du tout, selon
l'endroit où elle tombe — et le boîtier change d'épaisseur quand on le déplace.
Les grandes faces planes de chaque corps (alignées sur un axe, plus d'1 mm²,
seize par axe au plus) portent donc une ligne d'**affinage** : une paroi plus
épaisse que le quart du pas garde ses deux faces, donc au moins une cellule
entière à son épaisseur exacte.

**Le pas fin reste sur le cuivre.** Le maillage a trois zones par axe : l'air,
le pas « extérieur » — λ/20/√εr de la matière la plus lente qu'on y trouve,
une paroi de verre, le stratifié de la carte entière — dans le boîtier et la
carte au-delà du cuivre, et le pas fin du diélectrique, tenu par la largeur
des pistes, dans la seule emprise du cuivre et de ses ports. Avant, tout le
boîtier était maillé au pas des pistes : sur un boîtier de 190 × 190 × 80 mm
autour du patch, 34,9 M cellules (≈ 7 h 45) ; aujourd'hui 4,6 M (≈ 1 h), pour
2,9 M sans boîtier.

**Ce qui part au solveur.** Chaque corps devient un `AddPolyhedron` fermé,
écrit **dans le script** (sommets placés en flottants 64 bits, compressés et
encodés) — pas dans un STL à côté, qui se perdrait à la première copie. Un
plastique a la priorité 0 et **cède à la carte** là où ils se recouvrent (un
bossage contre le stratifié) ; un métal a la priorité 20. Un corps ignoré ne
voyage même pas avec ses triangles. La vue 3D dessine les triangles de la page
avec **la matrice que le serveur a appliquée** : le métal opaque, le
diélectrique translucide, l'ignoré en fantôme gris — c'est ainsi qu'on vérifie
qu'un export mécanique tombe sur la carte. Le projet garde les pièces,
triangles compris, et le rapport liste chaque corps avec sa matière.

### 4. La bande — elle commande tout le reste

La longueur d'onde **la plus basse** donne la marge d'air ; la **plus haute**
donne le pas de maillage. Une bande deux fois plus large, c'est huit fois plus
de cellules.

L'**excitation**, elle, est plus large que la bande analysée — une demi-octave
au minimum. La durée de l'impulsion varie comme l'inverse de sa largeur : une
bande d'analyse à ±15 % donnerait une impulsion de près de dix mille pas de
temps, et openEMS refuse de s'arrêter avant qu'elle ne soit finie. Exciter
large raccourcit le calcul, et cela évite en prime de lire les bords de la
courbe là où l'impulsion n'a presque rien mis.

Les trois champs partagent une **liste d'unités** Hz / kHz / MHz / GHz. Elle
n'est pas là par confort : écrire `868` dans un champ étiqueté GHz est une
faute qui ne se voit pas, et qui ne produit ni refus ni champ vide.

### 5. Les ports — par où l'onde entre, et ce qui en ressort

Un port localisé est une résistance de 50 Ω **entre deux conducteurs**,
orientée dans le sens du champ électrique. Trois fautes reviennent toujours,
et les trois sont refusées plutôt que rendues :

* une hauteur nulle (les deux couches se touchent) ;
* un port qui relie une couche à elle-même ;
* un port posé hors du cuivre retenu.

**Ce qui part au solveur est une ligne, pas une boîte**, et ce n'est pas un
détail de style. openEMS mesure le courant du port en intégrant H sur une
surface qui est *toute l'empreinte du port*, prise à mi-hauteur. Donner à
cette empreinte la largeur du ruban revient à y compter, en plus du courant du
port, le courant de déplacement qui traverse le diélectrique sous le ruban — et
celui-là n'est pas du courant de port. Mesuré sur le patch 2,45 GHz de
l'exemple : avec une empreinte de 1,56 × 3,11 mm, la résonance n'apparaît pas
du tout ; avec la ligne, à géométrie et maillage identiques, elle revient.
C'est aussi la forme qu'emploient tous les exemples d'openEMS.

**Cliquer vaut mieux que saisir** : l'assistant place alors le port au point
désigné et devine les deux couches.

#### La ligne d'alimentation, et l'impédance au pied de l'antenne

**L'impédance est lue là où le port est posé**, c'est-à-dire au bord de la
carte quand l'antenne est alimentée par un ruban : le plan de référence est
celui du port, pas le pied de l'antenne. Déclarer la **longueur** et la
**largeur** du ruban qui les sépare permet de l'y ramener, et les deux
impédances s'affichent alors côte à côte — jamais l'une à la place de l'autre :
la première est une mesure, la seconde en est une rotation calculée. En mode
conception, les motifs qui ont une ligne d'alimentation la déclarent tout
seuls, à la pose comme au balayage.

**Cela n'améliore aucune adaptation, et ne le prétend pas.** Une ligne sans
perte dont l'impédance caractéristique est celle de référence ne change pas
|Γ| : elle le fait **tourner**. Le désembedage déplace donc l'impédance lue du
tout au tout, et l'adaptation d'un demi-décibel — ce que six millimètres de
FR-4 à tanδ = 0,02 dissipent, et rien de plus. Mesuré sur le patch du gabarit,
la ligne **doublée** : S₁₁ passe de −0,64 à −1,20 dB à 2,45 GHz pendant que Z
au port passe de 9,0 − 98,9j à 4,3 − 24,2j Ω. Une désadaptation ne s'explique
donc jamais par le plan de référence.

Deux réserves, écrites à côté du nombre et dans le script qui le calcule :

* le Z₀ et l'εᵣ effectif sont **analytiques** (Hammerstad), et donc ceux d'un
  ruban idéal — pas ceux de la ligne telle qu'elle est maillée. Ils se
  calculent sur la **largeur de la ligne**, et c'est le piège : prendre par
  mégarde la largeur du *patch* donne un εᵣ effectif de 3,99 au lieu de 3,27,
  un nombre parfaitement plausible et un résultat entièrement faux ;
* la rotation est **sans perte** : ce que la ligne dissipe reste dans le S₁₁
  lu. Près du bord de l'abaque — une antenne mal adaptée, |Γ| proche de 1 — la
  rotation amplifie toute erreur sur ces deux nombres, et l'impédance ramenée
  y est fragile. Elle se lit alors comme un ordre de grandeur, pas au dixième
  d'ohm.

Un port **coaxial** n'en déclare pas : il porte déjà son propre déport de plan
de référence, ramené à la surface de la carte, et en empiler un second
reviendrait à compter deux fois.

#### Un port collé sur la grille, au chiffre près

Une boîte d'excitation est **plate dans deux directions** : c'est un segment,
pas un volume. openEMS y cherche une composante de champ à exciter, et un
segment posé à quatre **microns** de la ligne de maillage n'en contient
aucune. Le solveur le dit une fois — `Unused primitive (type: Box) detected in
property: port_excite_1` — au milieu de trois cents lignes de démarrage, puis
il calcule jusqu'au bout un champ rigoureusement nul : énergie à 0,00e+00 d'un
bout à l'autre, aucune résonance, et tout le temps de calcul dépensé. C'est la
panne la plus chère que cet outil puisse produire, et la moins visible.

Les quatre microns venaient de **deux arrondis qui ne se parlaient pas** : les
lignes obligatoires sont arrondies au milliardième de millimètre, et le script
écrivait les lignes de maillage à cinq décimales quand il écrivait les côtes du
port à six. Un port à y = 30,111544 tombait sur une grille qui disait
30,11154. Aucune relecture de l'un ou de l'autre ne pouvait le montrer : il
fallait comparer les deux. Le port d'une antenne dessinée à la main tombe
souvent sur un compte rond et ne montrait rien ; celui du patch d'essai, dont
la côte sort d'une formule, tombait à côté **à chaque fois**.

Il y a donc deux verrous, et il en faut deux : les côtes des ports sont
**collées** sur la ligne de maillage la plus proche (elles y étaient posées en
lignes obligatoires — l'écart n'est qu'un arrondi), et le script écrit les
lignes et les côtes à la **même précision**. Deux nombres égaux dans le modèle
doivent s'écrire pareil, sinon le collage ne survit pas à l'impression. Si le
déplacement dépasse l'arrondi, l'assistant crie : cela voudrait dire qu'une
ligne obligatoire a été perdue en route.

#### Le port court-circuité par le cuivre lui-même, et le piège des pastilles parasites

Un cas particulièrement sournois se produit sur les circuits multicouches complexes
(rencontré sur `P01x274PCB-C.xml`) : une pastille de composant ou de test appartenant au
net d'antenne se retrouve dupliquée par l'outil de CAO sur la couche de masse,
dans une réserve (antipad) située *directement sous le port*.
Les deux bornes du port touchent alors le même potentiel ou un îlot parasite,
le solveur FDTD résout un court-circuit franc, et le S₁₁ ressemble à s'y méprendre
à une courbe de réflexion physique. Le calcul va au bout sans la moindre erreur,
et l'opérateur croit analyser son antenne alors qu'il mesure un court-circuit.

L'outil intègre un **contrôle topologique préventif** :
- Il vérifie la présence et la nature du cuivre sous chaque borne du port.
- Si une pastille d'antenne isolée de la masse se trouve sous le port côté masse,
  ou si la masse est présente des deux côtés du port, un avis **grave** bloque la
  validation avant tout lancement inutile.

#### Désignation intelligente au clic

Poser le port sur une antenne alors qu'aucun cuivre n'a encore été retenu (étape 1
laissée vierge) **désigne automatiquement le cuivre sous le curseur** comme antenne
(par son net s'il existe, ou pièce par pièce), en ignorant le plan de masse sous-jacent.
De plus, l'antenne est toujours prioritaire sur la masse lors de la détection de la
couche et de la largeur de ruban : cliquer sur un ruban de face inférieure ne lui
attribue plus par erreur la couche du plan de masse supérieur qui le croise.

#### Plusieurs ports, et le couplage

Un seul port donne le S₁₁. Deux donnent en plus le **S₂₁**, et c'est la seule
grandeur qui réponde à « ces deux antennes se gênent-elles ? » — elle ne se
déduit d'aucun S₁₁, et elle décide pourtant du sort d'un produit à deux
antennes : deux brins à 15 dB d'isolation partagent leur puissance au lieu de
la rayonner, et le diagramme de chacun devient celui de l'ensemble.

**Un seul port excite à la fois, et ce n'est pas un réglage mais une
définition.** S(j,i) vaut « ce qui sort de j QUAND SEUL i excite » : deux
excitations simultanées superposent leurs ondes dans la boîte, et aucun
paramètre S ne se déduit du mélange. Les autres ports sont donc posés **en
charge** — fermés sur leur impédance, ils absorbent ce qui leur arrive et le
mesurent, exactement comme un analyseur de réseau à un port chargé. Une
simulation rend donc **une colonne** du tableau S, celle du port excité ;
l'autre colonne demande une seconde simulation, l'excitation déplacée. Deux
excitations à la fois sont refusées, avec la raison.

Le couplage est affiché **à côté du S₁₁** et non dans un onglet où personne
n'irait le chercher, avec sa valeur à la résonance et sa pire valeur sur la
bande.

#### Le port coaxial — le connecteur, et pas seulement sa trace

`AddCoaxialPort` existe dans l'interface MATLAB d'openEMS, **pas dans les
liaisons Python 0.0.36** : `openEMS/ports.py` n'y définit que `LumpedPort`,
`MSLPort`, `WaveguidePort` et `RectWGPort`. Le connecteur est donc construit
ici, et il est fait de quatre choses : l'âme, la gaine, le diélectrique du
câble, et les **dégagements** — un disque percé dans chaque couche de cuivre
que l'âme traverse, sauf celle où elle se raccorde. Sans eux l'âme touche le
plan de masse, le S₁₁ vaut 0 dB sur toute la bande, et rien dans le résultat
ne dit pourquoi.

**Un port localisé ne pouvait pas faire ce travail**, et c'est la raison
d'être du code ajouté : sa sonde de courant est un segment posé dans le plan
*perpendiculaire* à l'excitation. Radiale ici, elle ne peut par construction
pas encercler l'âme — le courant axial du coaxial ne traverse jamais sa
surface, et l'impédance rendue n'aurait aucun rapport avec celle de la ligne.
Le port est donc bâti sur la classe `Port` de base, avec ses propres sondes :
la tension est l'intégrale de E le long d'un rayon, le courant celle de H sur
une **boucle fermée** autour de l'âme — deux boucles en fait, une de chaque
côté du plan de mesure, parce que dans une grille de Yee E et H ne vivent pas
au même endroit.

L'**excitation**, elle, est approchée : une croix de quatre bras radiaux au
bout du tronçon. Cela n'a pas d'importance, et c'est démontrable — tout ce qui
n'est pas TEM dans un coaxial est évanescent sous le premier mode supérieur,
et celui-là coupe vers 25 GHz pour une SMA. Ce qui n'est pas TEM meurt en
quelques cellules, bien avant le plan de mesure.

L'impédance de la ligne — 60/√εᵣ · ln(b/a) — est calculée et affichée **pendant
qu'on tape les rayons**, parce qu'un connecteur qui ne fait pas 50 Ω ajoute sa
propre désadaptation à celle de l'antenne : on croit corriger l'antenne alors
qu'on corrige le câble. Les paramètres S sont ramenés à la **surface de la
carte** par un déport de plan de référence — exact pour un mode TEM, qui n'est
pas dispersé —, et la longueur du tronçon ne tourne donc pas la phase du
résultat.

**Le dégagement doit passer au-dessus du cuivre.** Sans lui, l'âme touche le
plan de masse : le port est un court-circuit franc, le S₁₁ vaut 0 dB sur toute
la bande, et rien dans le résultat ne dit pourquoi. Il était émis à la
priorité 11, celle des *découpes* d'un versement — mais un plan de masse **sans
découpe** n'est pas émis comme un versement : il part avec les pistes, à la
priorité 12. Douze bat onze. Le dégagement ne perçait donc rien dès que le plan
était plein, ce qui est le cas de toute carte d'essai et de bien des cartes
réelles, et la simulation le disait sans ambiguïté — Z = 0,0 + 1,5j Ω au plan
de référence, |S₁₁| = 0 dB — à qui la lançait. Il est désormais à 15 : au-dessus
du cuivre (12) et des vias (13), en dessous de l'âme et de la gaine (20), parce
que le dégagement creuse le cuivre et non le connecteur.

Le banc d'essai le vérifie par une **vraie simulation** : le même patch, nourri
par une sonde localisée puis par un coaxial, doit résonner au même endroit.
Mesuré — 2,3825 GHz à la sonde (S₁₁ = −8,6 dB, Z = 24,2 + 10,5j Ω) contre
2,3775 GHz au coaxial (S₁₁ = −10,2 dB, Z = 27,4 + 10,2j Ω) : **0,2 % d'écart**,
avec l'inductance de l'âme en plus sur l'impédance d'entrée — ce qu'ajoute une
sonde réelle. La résonance tombe à 2,8 % de la formule du patch.

### 6. La boîte — l'air, la PML, le maillage

**La marge se compte en deux morceaux, et les confondre coûte cher.**

1. l'**air physique** entre l'antenne et le début de la couche absorbante : un
   quart de la longueur d'onde à la fréquence la plus basse. C'est la distance
   au bout de laquelle le champ proche réactif s'est assez éteint pour que la
   PML n'ait plus à l'absorber ;
2. la **PML elle-même**, qui occupe les N cellules les plus extérieures. Ce
   n'est pas de l'air : ce qui s'y trouve n'est pas simulé, il est mangé.

Une marge de « λ/4 » tout court place donc la PML **sur** l'antenne : avec un
pas d'air de λ/20, huit couches de PML font 0,4 λ. Le conseil rendu est la
somme des deux, et le panneau affiche toujours l'air qui reste réellement.

Le maillage vise vingt cellules par longueur d'onde, divisées par √εᵣ là où la
vitesse est plus faible — **mais λ/20 ne voit que la longueur d'onde**, et une
antenne imprimée n'est pas faite que de cela. Sous un ruban de 3 mm le champ
tourne sur la largeur du ruban, qui peut valoir le quart de la cellule que
λ/20 autorise ; le calcul tourne alors sans se plaindre et rend une antenne
**qui ne résonne pas**. Le pas dans le diélectrique est donc aussi borné par
la largeur du cuivre le plus étroit, divisée par quatre.

Cette seconde règle est plafonnée par un **budget** : deux cents lignes par
axe dans l'emprise du cuivre. Une pastille de 0,2 mm ne doit pas emmener la
carte entière avec elle. Quand le cuivre n'est pas résolu, l'assistant le dit
— **y compris quand le pas a été saisi à la main**, ce qui est le cas où cela
compte le plus : un pas de 0,8 mm entré pour aller vite, sur des brins de
1,0 mm, ne fait qu'**une** cellule en travers du cuivre, et la résonance sort
plusieurs pour cent trop haut sans qu'aucune alerte ne le signale. Le pas
saisi reste saisi ; il est commenté, pas corrigé.

Le panneau dit aussi **laquelle des trois règles tient le pas** — λ/20, la
largeur du cuivre, ou le plafond de lignes — parce que cela seul dit si l'on
peut relâcher : un pas tenu par λ/20 se relâche en resserrant la bande, un pas
tenu par le cuivre ne se relâche qu'en acceptant de moins bien le résoudre.

### Deux pas dans le plan — le fond, et les bandes fines

Le plafond de deux cents lignes ne dit pas « ce cuivre est trop fin pour être
résolu ». Il dit **« raffiner toute la carte à ce pas-là coûterait plus de
deux cents lignes par axe »** — et c'est une autre affirmation. Une piste
large de 0,5 mm et longue de 20 ne demande le pas fin qu'**en travers**
d'elle-même, sur un demi-millimètre : le champ tourne sur la largeur du ruban,
pas sur sa longueur. C'est la largeur qui fixe l'impédance.

Le maillage a donc **deux pas dans le plan**. Le *fond* reste ce que le budget
de lignes permet ; des *bandes fines* sont posées en travers de chaque
polygone trop étroit pour lui, **et seulement sur l'axe où il est étroit**.
Les lignes d'une bande tombent exactement sur les deux bords du cuivre, qui a
ainsi un nombre entier de cellules en travers, plus deux cellules de marge de
chaque côté pour que le lissage rattrape le fond sans marche brutale. La règle
du tiers ne s'y applique pas : elle corrige la densité de courant d'un bord
que la grille ne résout **pas**, et une paire de lignes au tiers du pas fin ne
ferait qu'une cellule-copeau de plus — c'est exactement la condition
qu'openEMS se donne lui aussi dans `mesh_hint_from_box`.

**Ce que cela coûte, et le budget qui le borne.** Mesures sur la carte d'essai
du banc (patch 2,45 GHz, plan de masse de 70 mm, fond plafonné à 0,35 mm) :

| cuivre étroit ajouté | pas fin retenu | cellules en travers | prix |
|---|---|---|---|
| une piste de 1 mm | 0,25 mm | 0,9 → **4,0** | **×1,01** |
| vingt pistes de 0,5 mm | 0,125 mm | 1,4 → **4,0** | ×1,34 |
| vingt pistes de 0,3 mm | 0,098 mm *(budget)* | 0,9 → **3,1** | ×2,02 |

Une piste isolée est donc résolue **pour rien** — c'est le cas courant, celui
d'une ligne d'alimentation ou d'un brin d'IFA. Vingt pistes éparpillées se
paient, et le budget décide : il est exprimé en **cellules × pas de temps**
(la seule grandeur qui mesure vraiment le prix d'un maillage, et la seule qui
ne dépende pas de la machine), plafonné à quatre fois le maillage de fond et à
un plafond absolu. Quand il mord, le pas fin **recule d'un cran à la fois** —
trois cellules en travers au lieu de quatre — au lieu de renoncer, et
l'assistant écrit ce qu'il a obtenu et ce qu'il aurait fallu.

### Et trois cellules dans le substrat

Le même travers se cachait en z : `_maillage` avait pour consigne écrite
« au moins trois cellules dans un substrat, une seule ne représente pas le
champ qui se courbe sous une piste » — et cette consigne n'avait **jamais eu
lieu**. Ces lignes étaient rangées dans le *remplissage*, et sur une grande
carte le pas de fond (0,6 mm) est plus épais que le substrat lui-même
(0,37 mm) : le seuil du tiers les effaçait toutes les trois. Le patch d'essai
tournait donc avec **une** cellule pour ses 1,6 mm de FR-4, et c'est ce champ
vertical qui fait l'impédance de la ligne.

Elles sont désormais de l'**affinage**, et leur finesse est bornée par la
moitié de la plus petite cellule du plan : le pas de temps suit
1/√(1/dx² + 1/dy² + 1/dz²), donc une cellule en z deux fois plus fine que la
plus fine du plan pèse quatre contre deux — un facteur 1,4 au plus, pour les
trois cellules qui décrivent le champ sous le ruban. En dessous de ce plancher,
c'est le z qui commanderait le pas de temps de tout le domaine : c'est
exactement ce que faisait le vernis de 15 µm.

### Zéro est un bon état, et un mauvais affichage

Sept réglages se calculent quand on les laisse à zéro : les quatre marges
d'air, les deux pas de maillage, le compteur de pas. Mais un champ qui affiche
« 0 » ne dit pas ce qui part au solveur, et « 0 = calculé » en petit sous le
libellé demande de croire sur parole. Les champs affichent donc **le nombre**,
en gris, avec une étiquette qui dit d'où il vient : `calculé` tant que le
modèle le fournit, `imposé ↺` dès qu'on en tape un — et le bouton rend le
champ au calcul.

Ce qui n'est **pas** écrit dans l'état, c'est ce nombre. Il y resterait figé au
maillage du jour, et l'on retomberait exactement sur le défaut que ces champs
corrigent. L'état garde zéro, l'affichage est rempli, et retaper à l'identique
la valeur affichée ne la fige pas : c'est le nombre qu'on y a mis soi-même.

Ces sept champs sont les mêmes qu'on vienne d'un **fichier IPC-2581**, du
**mode conception** ou d'un exemple : l'ouverture d'une carte les rend tous au
calcul, et le modèle les recalcule à chaque retouche du dessin. Sur une carte
importée à quatre couches, le pas sort ainsi à 0,60 mm — plafonné par le
budget de lignes, ce que le panneau dit — avec l'avis « le cuivre le plus fin
n'est pas résolu » à côté.

### Trois rangs de lignes, et la cellule-copeau qui coûtait trois heures

Le pas de temps FDTD est commandé par la **plus petite cellule de tout le
domaine** : une seule cellule dix fois trop fine multiplie par dix le nombre de
pas à calculer, sans rien décrire de plus. Deux mécanismes en fabriquaient.

Le premier est le dessin : deux arêtes de cuivre à quelques dizaines de microns
l'une de l'autre — l'arrondi d'un bout de piste, un ruban de 1,00 mm qui croise
un ruban de 1,02 mm sur le même axe. Aucun fabricant ne tient cette
différence-là. Les lignes qui en découlent sont donc **regroupées**, et
l'assistant dit combien : *le cuivre, lui, garde ses cotes* — c'est la grille
qu'on simplifie, jamais le dessin envoyé au solveur.

Le second était plus coûteux, et il tient au croisement de deux règles. La
règle du tiers pose ses lignes **là où l'arête tombe**, c'est-à-dire n'importe
où par rapport à la grille régulière : rien n'empêchait une ligne de
remplissage de se poser à quarante microns d'elle. Les lignes ont donc trois
rangs et non deux — la **géométrie**, qui ne cède jamais ; l'**affinage**, les
deux lignes de la règle du tiers et celles des bandes fines ; le
**remplissage**, qui doit désormais laisser un tiers de pas à l'affinage.
Élargir le seuil pour tout le monde serait l'erreur inverse : fusionner deux
lignes d'affinage entre elles efface le raffinement des bords rayonnants, et
cela s'est mesuré — le creux du S₁₁ du patch tombait de −6,6 à −2,1 dB.

**Et le rang décide de l'ordre, l'ordre décide de qui cède.** Les lignes d'une
bande fine rangées dans le remplissage arrivaient dans la même file que celles
du fond, triées par position : une ligne du fond posée juste avant une ligne de
marge était jugée la première, donc gardée, et la marge s'installait ensuite à
0,05 mm d'elle — au seuil *fin*, trois fois plus tolérant. Mesuré sur vingt
pistes de 0,5 mm : une cellule de 0,05 mm pour un pas fin de 0,125, et le pas
de temps de tout le domaine divisé par deux et demi. Chaque ligne est donc
jugée **à son propre seuil**, celui de l'endroit où on la pose, et le fond ne
passe pas sous une bande : elle l'y remplace.

Mesuré sur le F inversé du gabarit : plus petite cellule **0,043 → 0,235 mm**,
pas de temps multiplié par 2,2, et un calcul qui passe de trois heures et demie
à un peu plus d'une heure, *à maillage identique* — la grille n'a pas été
dégrossie, elle a cessé de se contredire.

Deux cellules voisines ne diffèrent jamais d'un facteur supérieur à **deux** :
une grille qui saute de 0,5 à 2 mm réfléchit numériquement sur la marche, et
ce parasite revient au port se confondre avec l'onde réfléchie par l'antenne.

Les lignes qui décrivent la **géométrie** (interfaces
de l'empilage, faces du port) sont posées d'abord et ne cèdent jamais ; les
lignes de remplissage s'écartent pour elles. Sans cela, un substrat de 1,6 mm
dont la face a glissé de 0,3 mm n'est plus le même substrat.

### 7. Le calcul

C'est l'**énergie résiduelle** qui arrête en pratique, pas le nombre de pas :
une simulation qui converge s'arrête à 30 % de `NrTS` et c'est normal.

Le nombre de pas, justement, **se calcule** : laissé à zéro — comme un pas de
maillage à zéro —, il est le plus grand de **deux durées qui n'ont rien à
voir**. Le temps d'**émettre** l'impulsion d'abord : quatre fois sa durée,
openEMS en exigeant trois sous peine de refuser de tourner. Le temps que met
l'antenne à **oublier** ensuite, qui ne dépend que de son facteur de qualité —
une structure résonante rend son énergie en exp(−ωt/Q), et descendre à −40 dB
demande environ 1,5 × Q périodes ; on en prend quarante, soit un Q chargé de
27, l'ordre de grandeur d'une antenne imprimée adaptée sur FR-4.

Le second est le plus long dès qu'une antenne résonne, et c'est celui qu'on
oubliait. Mesure faite sur le F inversé à 2,45 GHz : l'impulsion tenait en
31 125 pas, l'énergie n'est descendue sous −40 dB qu'au **39 165ᵉ**. Un
garde-fou posé sur la seule impulsion aurait coupé le calcul avant la mesure,
et la troncature se serait lue comme une résonance floue — sur la même grille,
la règle des deux critères en propose 43 459.

C'est le seul réglage dont la bonne valeur change avec le **maillage** :
l'impulsion dure un temps physique fixe, mais le nombre de pas qu'elle occupe
dépend du pas de temps, donc de la plus petite cellule. La même antenne
demande 23 000 pas maillée large et 81 000 maillée fin — un nombre saisi une
fois ne vaut plus rien dès qu'on retouche la grille. Il reste saisissable pour
qui veut borner un calcul ; l'assistant dit alors, à côté du nombre imposé,
celui qu'il calculait, et prévient si le premier est plus court que le second.
Le garde-fou ne coûte d'ailleurs rien quand le calcul converge : c'est un
plafond, pas une consigne — l'énergie arrête bien avant.

C'est aussi là qu'on demande d'**enregistrer les champs** — avant de lancer :
un calcul déjà fait ne peut plus en produire. Densité de courant, champ
électrique ou magnétique, sur un plan, une coupe, la structure ou toute la
boîte.

Le mode **fréquentiel** rend un champ complexe par fréquence demandée :
quelques fichiers, quelques mégaoctets — 46 fichiers et 0,9 Mo sur la carte
d'essai. Le mode **temporel** rend un fichier **par pas de temps**, des
dizaines de milliers, et remplit un disque en quelques minutes ; il ne sert
qu'à faire une animation, et son poids est annoncé avant. Les fichiers sont
des `.vtr`, et **l'outil les lit lui-même** : le bouton « Voir les champs »
ouvre le panneau **Champs**, qui affiche la carte et **l'anime**. Les boutons
« ParaView » et « Ouvrir le dossier » restent à côté, pour ce que la carte
plane ne montre pas.

Un S₁₁ dit que l'antenne résonne à 2,37 GHz ; il ne dit pas **pourquoi**. La
carte du courant de surface, elle, le montre d'un coup d'œil — et bien mieux
en mouvement qu'arrêtée : une onde stationnaire et une onde qui se propage
donnent la **même** image figée, et deux comportements opposés une fois
qu'on les regarde vivre.

#### La plus petite cellule, la charge globale et la durée annoncée

Le temps passé dans une simulation FDTD est le produit direct de deux grandeurs :
$$\text{Charge} = \text{Cellules} \times N_\text{pas}$$
Ni le nombre de mailles ni le nombre d'itérations ne résument le coût à eux seuls :
une cellule deux fois plus fine divise le pas de temps CFL par deux, ce qui double
le nombre d'itérations $N_\text{pas}$ nécessaires pour couvrir le même temps physique
tout en augmentant le maillage. La facture se paie donc **deux fois**.

* **Diagnostic précis de la plus petite cellule ("pincée")** : l'outil identifie
  l'axe critique ($x$, $y$ ou $z$), la dimension exacte en millimètres et le ratio
  par rapport au pas visé. Il nomme en clair les deux lignes de maillage qui la
  bornent et leur rang (`obligatoire`, `affinage` ou `remplissage`), ou la couche
  diélectrique responsable en Z (ex: vernis épargné de 15 µm). Si une maille est
  anormalement écrasée sous le plancher de grille, un avertissement en donne la cause
  exacte.
* **Charge totale chiffrée** : le produit $\text{cellules} \times n_\text{max}$ est
  chiffré en mises à jour dans le bilan et reporté fidèlement dans le rapport
  d'ingénierie Markdown (ex: $4{,}2\times 10^6 \times 190\,000 = 8{,}2\times 10^{11}$ mises à jour).
* **Durée annoncée réaliste** : elle se base sur le plafond $n_\text{max}$ entier
  (et non une fraction optimiste), exprimée en clair (« 3 h 26 », « 45 min », « 70 s »).
  Au-delà de deux heures de calcul estimées au débit mesuré du poste, un avertissement
  préventif « *Ce calcul prendra un moment* » s'affiche avant tout lancement.

#### Le diagnostic d'un calcul qui ne rend rien

Une simulation dont les grandeurs de sortie restent indéterminées ou corrompues
est automatiquement analysée sur sa courbe d'énergie résiduelle :
- **Divergence numérique** : l'énergie monte jusqu'au bout au lieu de décroître.
  Le diagnostic renvoie directement à la stabilité du maillage (rapport de pas excessif
  ou cellule aberrante).
- **Coupure prématurée** : le solveur a atteint le plafond d'itérations $n_\text{max}$
  alors que l'énergie était encore en pleine décroissance. Le diagnostic chiffre l'écart
  au seuil d'arrêt et conseille d'augmenter le garde-fou $n_\text{max}$.
- **Énergie éteinte sans résultat utile** : l'impulsion s'est bien dissipée mais aucune
  réflexion physique exploitable n'apparaît. Le diagnostic oriente vers la position
  du port ou un court-circuit métallique sous-jacent.

### Le panneau « Champs »

Le serveur ne renvoie pas des images : il renvoie **l'amplitude et la phase**
de chaque point de la grille (`python/openems_champs.py`). La page recalcule
l'image par `A·cos(φ + ωt)` à la cadence de l'écran — changer de composante,
d'échelle, de palette ou de vitesse ne lui demande donc plus rien. Un
enregistrement temporel, lui, est une vraie suite d'images : le serveur en
échantillonne au plus soixante, régulièrement espacées.

Ce que le panneau offre :

| Réglage | Ce qu'il fait |
| --- | --- |
| **Série** | quel champ (J, E, H, I) et à quelle fréquence |
| **Composante** | le module instantané, l'amplitude (enveloppe), ou Vx / Vy / Vz signés |
| **Échelle** | linéaire, ou décibels sur 20 à 80 dB de dynamique |
| **Gain** | éclaircit une carte trop sombre ; l'échelle affichée suit |
| **Palette** | feu (intensités), glace-feu (grandeurs signées), gris |
| **Cuivre** | le contour du cuivre et du port par-dessus la carte |
| **Coupe** | pour un enregistrement volumique : le plan, et sa position |
| **Transport** | jouer / arrêter (Espace), la phase ou le pas de temps, la vitesse |
| **PNG / film** | l'image affichée, ou un cycle complet en `.webm` |

Deux détails qui comptent. L'échelle est **fixe** pour toute l'animation : une
échelle recalculée à chaque image ferait clignoter la carte et donnerait à un
champ mourant l'air d'un champ intense. Et le maillage FDTD étant **gradué**
— cellules fines sous une piste, larges dans l'air —, chaque pixel est ramené
à sa coordonnée réelle : étaler le tableau de valeurs comme une image donnerait
une carte juste en valeurs et fausse en géométrie.

Deux boutons, un seul chemin : « Écrire le script Python » et « Lancer »
produisent **le même texte**. Ce qui tourne est exactement ce qu'on exporte —
un script exporté qui ne reproduirait pas le résultat de l'interface serait
pire qu'inutile.

### Le balayage — une cote, une plage, une famille de courbes

Un motif d'antenne tombe à 2 ou 5 % de la résonance visée, et la première
simulation ne dit pas « c'est bon » : elle dit « c'est 3 % trop bas ». Le geste
qui suit est toujours le même — rallonger le patch de quatre dixièmes de
millimètre et relancer — et le refaire six fois à la main, c'est six fois
l'occasion de changer deux choses au lieu d'une et de ne plus savoir laquelle
a compté.

**Ce n'est pas un optimiseur**, et c'est délibéré : ni gradient, ni critère, ni
convergence. Une liste de valeurs, une simulation par valeur, une courbe par
valeur. La lecture reste humaine, parce que ce qu'on y lit n'est pas le
meilleur point : c'est la **sensibilité** — de combien la résonance bouge pour
un dixième de millimètre. C'est elle qui dit si la cote devra être tenue en
fabrication, et le point optimal, lui, ne survit pas au prochain lot de
stratifié. La pente est affichée en toutes lettres : « 62 MHz par millimètre ».

Ce qui se balaie dépend de ce qui est à l'écran, et c'est normal : sur une
carte importée la géométrie est routée — on ne rallonge pas un patch qui vient
d'un fichier de fabrication —, mais la position du port, sa largeur et la
permittivité qu'on a supposée, si. En conception, la géométrie est à nous : la
largeur, la hauteur, le rayon ou le diamètre de la forme choisie.

**Et les cotes du motif**, qui ne sont pas celles d'une forme. « La longueur du
patch » ne se recompose pas de tête à partir d'un rectangle : elle déplace le
patch, la carte qui le porte et le port au bout de la ligne — et sur un
méandre, elle redessine quatorze segments. Ce sont pourtant celles-là qu'on
veut faire varier, puisque c'est le motif qui tombe à quelques pour cent. Elles
sont donc proposées telles quelles — *longueur du patch*, *encastrement*,
*largeur des encoches* —, et chaque point **repose le motif** exactement comme
le bouton du panneau : la carte et le port suivent la cote, la bande et l'arrêt
ne bougent pas.

Elles ne sont proposées **que si le dessin est encore la copie exacte du
motif**. Reposer efface ce qu'on aurait ajouté à la main, et cela sur tous les
points à la fois : une famille de courbes décrirait alors une autre antenne que
celle qu'on a sous les yeux, sans que rien ne le dise. Une forme ajoutée, un
via déplacé, et les cotes du motif disparaissent de la liste — celles des
formes, elles, restent.

**Deux cotes se croisent** quand elles ne se lisent pas l'une sans l'autre.
Sur un patch alimenté par ligne encastrée, la longueur pose la *résonance* et
l'encastrement pose l'*adaptation* : les balayer séparément fait tourner en
rond — on corrige l'une, l'autre se dérègle. Le croisement lance une
simulation par couple et range le résultat en tableau à deux entrées, une cote
par axe, la résonance et le S₁₁ minimal dans chaque case ; les cases dont la
résonance tombe à moins d'un pour cent de la cible sont marquées, et c'est la
ligne de crête sur laquelle on choisit ensuite au second critère.

Le prix est un **produit**, et il faut le dire avant : six valeurs croisées
avec six font trente-six simulations, pas douze. Le garde-fou des quarante
points porte donc sur le produit — c'est lui qu'on paie. Et aucune pente n'est
annoncée sur un croisement : du premier au dernier point, deux cotes ont
changé, et un nombre de mégahertz par millimètre ne dirait pas de laquelle.

**La famille de courbes d'un croisement se lit sur deux codes, pas un.** Sur un
balayage à une cote, la couleur porte le rang, qui est la seule chose qui
varie. Sur un croisement, ce rang est celui du produit : trente-six courbes sur
un dégradé unique ne désignent plus aucune des deux cotes. La **couleur** porte
donc le premier axe et le **trait** — plein, tireté, pointillé — porte le
second, si bien qu'une courbe se nomme en la regardant : « la bleue en
tirets ». La légende dit les deux. Le tableau à deux entrées reste ce par quoi
on commence.

**Comment un point est décrit.** Pas par une formule : par ce qu'il *change*
dans le document. Une cote qui existe dans le document se désigne directement,
et le point ne pèse alors que trois nombres. Une cote *dessinée* — la longueur
d'un patch — n'existe nulle part dans le document, qui ne connaît que des
polygones : la page refait alors le document pour chaque valeur et le compare
à celui de départ, ce qui diffère étant la modification. C'est plus lourd, et
c'est la seule façon honnête : la page est le seul endroit qui sache ce qu'est
« la longueur du patch ».

**Tous les points sont vérifiés avant que le premier ne parte.** Découvrir au
quatorzième point, une heure plus tard, que le port y tombe hors du cuivre
serait la pire façon de l'apprendre : le refus arrive avant le lancement, et
il dit quel point est en cause. Les simulations s'enchaînent ensuite une par
une — deux en parallèle ne vont pas deux fois plus vite sur un poste dont la
barrière est la bande passante mémoire, et la séquence laisse le premier
résultat arriver tôt : on voit le sens de la variation avant la fin, et on peut
arrêter dès qu'il est clair. Un point qui échoue n'efface pas les autres.

## Le mode conception — quand l'antenne n'existe pas encore

Le reste de l'outil part d'une antenne **déjà routée**. Mais on ne route pas
une antenne avant de savoir ce qu'elle doit mesurer, et le premier patch d'un
projet n'est dans aucun fichier de fabrication : il se dessine, se simule, se
corrige, et passe en CAO ensuite. Le bouton **✏️ Concevoir** ouvre ce
chemin-là.

### Ce que le mode ne fait pas, et c'est ce qui le rend sûr

Il **ne crée pas un second chemin vers le solveur**. Il fabrique un document
au format exact de celui que rend le parseur Python, et le donne à la même
fonction de chargement. À partir de là, rien ne distingue une carte dessinée
d'une carte importée : même rendu, même désignation du cuivre, même assistant,
même aperçu 3D, même maillage, même script exporté, même solveur.

La conséquence pratique : **tout ce que l'assistant sait refuser, il le refuse
aussi sur une carte dessinée** — port entre une couche et elle-même, marge
d'air trop courte, polygone plus fin que la maille. Un mode qui aurait eu son
propre chemin aurait perdu ces refus en route, et ce sont eux qui font la
valeur de l'outil.

Ce n'est pas un éditeur de CAO : pas de contraintes, pas de DRC, pas de
netlist, pas d'empreintes. Des surfaces de cuivre, un empilage, des
matériaux — ce qu'un solveur de champ sait lire, et rien de plus. Une carte
dessinée ici ne se fabrique pas ; elle se simule.

### L'empilage — la première question, et elle vient avant le premier trait

Un patch n'a pas de cotes dans l'absolu : il en a **sur un substrat**. Dessiné
pour un FR-4 de 1,6 mm puis reporté tel quel sur un RO4350B de 0,762 mm, il
n'est plus un patch — c'est un rectangle de cuivre, à plusieurs centaines de
mégahertz de la bande visée. C'est pourquoi le mode conception s'ouvre sur
l'empilage, tant que rien n'est dessiné et que changer d'avis ne coûte rien :
**combien de couches de cuivre**, et **lequel des empilages qu'un fabricant
sait presser**.

**Les modèles d'usine.** Un fabricant ne vend pas « quatre couches » : il vend
des cuivres, des âmes et des prépregs d'épaisseurs données, tombant sur une
épaisseur totale normalisée. La liste va du double face FR-4 1,6 mm au huit
couches, en passant par les stratifiés hyperfréquence (RO4350B 0,508 et
0,762 mm, RO4003C, RT/duroid 5880 et 5870, RO3003), le polyimide souple, le
patch suspendu sur air et l'empilage hybride — RO4350B en surface, FR-4 au
milieu, qui est celui des cartes radio réelles. **Chaque modèle tombe
exactement sur l'épaisseur qu'il annonce**, et le banc d'essai le vérifie : un
empilage proposé ici se commande tel quel.

**Puis chaque couche se règle.** La coupe se lit comme la feuille d'empilage du
fabricant — du dessus vers le dessous, avec le nom, la matière, le rôle, le
poids de cuivre en onces, l'épaisseur, le Dk et le Df —, et une ligne cliquée
ouvre la fiche de sa couche : rôle (signal, masse, alimentation), métal et
conductivité, épaisseur normalisée pour un cuivre ; matériau de catalogue ou
valeurs libres, nature (âme ou prépreg), épaisseur, εᵣ et tanδ pour un
diélectrique. Un empilage à huit couches fait dix-sept lignes : tout déplier
rendrait illisible ce qu'on vient précisément comparer.

| ce que le panneau ajoute | à quoi cela sert |
|---|---|
| **épaisseur visée** et **répartir** | ramener l'empilage sur 1,6 mm — ou sur la cote mécanique imposée — en répartissant l'écart sur les diélectriques ; le cuivre et le masque ne bougent pas, ils se commandent |
| **synthèse** | l'épaisseur obtenue, le stratifié nu, le cuivre total, l'écart sur la visée |
| **symétriser** | un empilage asymétrique se voile à la cuisson : le fabricant le refuse, ou le compense à sa façon — et rend une carte dont l'empilage n'est plus celui qu'on a simulé |
| **masque** | le vernis épargne, 25 µm d'εᵣ 3,8 sur les deux faces |

**Changer le nombre de couches ne perd pas le dessin.** Les formes désignent
leur couche par un identifiant stable : le cuivre du dessus reste le cuivre du
dessus, celui du dessous aussi, les internes suivent par rang, et les formes
d'une couche interne qui disparaît sont reportées sur la voisine **et
comptées**. Ce qui est signalé aussi, parce que rien d'autre ne le dirait : un
**port devenu faux**. Un port qui reliait le dessus au dessous d'un double face
relie, sur un quatre couches, deux cuivres séparés par deux plans — les deux
couches existent toujours, le solveur ne se plaindra pas, et le S₁₁ sera celui
d'une antenne alimentée en travers de sa masse.

**Le masque n'est pas posé d'usine, et c'est un arbitrage chiffré.** Il compte
— 25 µm d'εᵣ 3,8 abaissent la résonance d'environ 1 % — mais chaque interface
de l'empilage porte une ligne de maillage obligatoire : le masque pose deux
lignes distantes de 25 µm là où la plus petite cellule du modèle en faisait 37,
et le pas de temps FDTD suit la plus petite cellule du domaine. Mesuré sur le
patch 2,45 GHz de l'exemple : **une fois et demie le temps de calcul** pour 2 %
de cellules en plus. On le pose au dernier tour, quand la géométrie est
arrêtée ; pas pendant qu'on la cherche.

**Et tout cela va jusqu'au solveur, par le même chemin que le reste.**
L'empilage réglé ici devient le tableau `empilage` du document — une entrée par
couche, avec son épaisseur, son εᵣ, sa tanδ, sa conductivité et son rôle —, que
`python/openems_modele.py` transforme en cotes z : chaque diélectrique devient
un volume de matériau à pertes, chaque cuivre un plan (ou un volume, au choix
du modèle de cuivre), et chaque interface une ligne de maillage. Le masque y
arrive comme les autres, à une nuance près, et elle va dans le sens du choix
qu'on vient de faire : un revêtement extérieur plus fin que 50 µm est écarté du
maillage **quand il arrive d'un fichier**, parce qu'il n'y a alors rien qui dise
qu'on le voulait (voir « Les revêtements extérieurs », étape 2). Posé ici, il a
été demandé — le document le marque, et il reste. Il n'y a pour le reste aucun
chemin propre au mode conception : une carte dessinée et une carte importée
donnent le même document.

### Les matériaux — les deux nombres qu'aucun fichier ne porte

Une permittivité fausse de 10 % déplace la résonance d'environ 5 %. C'est
exactement la grandeur qu'un export de CAO ne donne jamais, et c'est ici
qu'on la choisit : une quinzaine de stratifiés de catalogue (FR-4, RO4003C,
RO4350B, RT/duroid 5880 et 5870, RO3003, RO3010, FR408HR, Megtron 6,
polyimide, PTFE, alumine, mousse, air), chacun avec son εᵣ, sa tanδ **et la
fréquence à laquelle le fabricant les donne** — l'εᵣ d'un FR-4 tombe de 4,5 à
1 MHz à 4,2 à 10 GHz, et prendre la valeur basse pour dimensionner à 5 GHz
place la résonance à côté. Toute valeur reste modifiable : le stratifié qu'on
a en magasin n'est jamais tout à fait celui du catalogue, et la fiche cesse
alors de prétendre qu'elle vient d'une notice.

Le **conducteur** se choisit aussi — cuivre, argent, or, aluminium, laiton,
encre argent sérigraphiée, ITO — et sa conductivité voyage jusqu'au script :
elle ne compte que par la résistance de surface du modèle « feuille », mais
c'est elle qui sépare un rendement de 80 % d'un rendement de 60 % sur une
antenne sérigraphiée. Un fichier IPC-2581 ne dit jamais de quel métal est sa
couche ; le cuivre reste donc le repli là-bas, et le choix n'existe qu'ici.

L'épaisseur de cuivre se prend en onces, comme on la commande — et la
coupe de l'empilage la redonne en onces à côté des micromètres.

### Les motifs d'antenne — un point de départ, pas une antenne finie

Une galerie de six motifs imprimés, **dessinés** et non nommés : chaque
vignette est un vrai tracé, aux cotes que la fréquence et l'empilage courants
donnent. Un patch à 868 MHz n'a pas la silhouette d'un patch à 5,8 GHz, et
cela se voit dans la galerie.

| motif | ce qu'il pose |
|---|---|
| **Patch rectangulaire** | patch, plan de masse entier, ligne 50 Ω **encastrée** à la profondeur où l'impédance vaut 50 Ω |
| **Monopôle imprimé** | brin quart d'onde sur masse tronquée — la masse EST le second bras |
| **F inversé (IFA)** | quart d'onde replié, court-circuité par un **vrai via** métallisé |
| **F inversé à méandres (MIFA)** | le même quart d'onde replié en accordéon : deux fois plus court, plus étroit de bande |
| **Dipôle imprimé** | un bras par face, sans masse : c'est la forme qui se nourrit du port vertical |
| **Ligne 50 Ω** | pas une antenne : la structure dont on connaît d'avance le résultat |

**Choisir un motif n'écrit rien.** Il ouvre sa fiche : le dessin coté, les
cotes dans des champs, et deux nombres — la résonance que ces cotes-là
donnent, et l'encombrement de la carte. On retouche une cote, le dessin se
refait à la frappe, la résonance estimée suit. Rien n'entre dans le dessin
tant qu'on n'a pas pressé « Dessiner ce motif » — et ce qui entre alors est
exactement ce qui était montré, port compris : l'aperçu et la pose lisent le
même tracé.

**TOUTE longueur réglable est portée sur le dessin, et elle y porte la lettre
de son champ.** Neuf cotes pour un F inversé, dix pour un MIFA : les grandes
en ligne de cote — deux tirets, un trait, un nom, comme sur un plan —, et
celles qu'une ligne de cote ne saurait porter (une largeur de piste, une
largeur d'encoche, un diamètre de via font deux pixels à cette échelle) en
**repère** : un point, un trait, un nom posé là où il reste de la place. Les
largeurs et les marges sont en retrait, parce que ce ne sont pas elles qui
font résonner et qu'une planche où dix cotes crient ensemble ne se lit plus.

Le lien entre la liste et le dessin va dans les **deux sens** : survoler ou
régler un champ allume sa cote, et **cliquer une cote ouvre son champ**, déjà
sélectionné. C'est le chemin qu'on prend le plus souvent — on voit sur le
dessin la longueur qu'on veut changer bien avant de savoir comment elle
s'appelle.

Les cotes qu'on n'a pas touchées suivent la fréquence et le substrat ; celles
qu'on a tapées restent, et la fiche du dessin posé dit lesquelles, avec la
valeur que le calcul proposait en regard.

Les formules sont celles des modèles de ligne de transmission — Hammerstad
pour le microruban, cavité de Balanis pour le patch. Elles ignorent
l'épaisseur du cuivre, le bord de la carte, le couplage ligne-patch, la masse
qui n'est pas infinie. **Leur écart honnête est de 2 à 5 % sur la
résonance** — soit 120 MHz à 2,45 GHz, la largeur de toute la bande ISM. Sur
un MIFA serré, compter davantage : les brins repliés se couplent, et la fiche
prévient dès que leur écartement descend sous deux largeurs de bras.

**Sur le patch, c'est l'encastrement qui est le plus faux, et de loin.** La
résonance tombe à quelques pour cent ; l'*adaptation*, elle, est manquée. Le
calcul de `y₀` part de la résistance de bord du modèle de cavité, qui suppose
un patch **nu** — ni la ligne qui entre, ni les deux fentes qui l'isolent n'y
figurent. Un croisement `g` × `y₀` de neuf simulations, sur FR-4 1,6 mm à
2,45 GHz, le chiffre :

| S₁₁ minimal | y₀ = 8,51 mm | y₀ = 11,51 mm *(calculé)* | y₀ = 14,51 mm |
|---|---|---|---|
| g = 1,49 mm | **−16,0 dB** | −2,6 dB | −0,9 dB |
| g = 2,49 mm *(calculé)* | −13,2 dB | −2,5 dB | −0,6 dB |
| g = 3,49 mm | −8,1 dB | −0,8 dB | −2,2 dB |

Soit une résistance de bord surestimée d'un facteur trois et demi, et un
encastrement trop profond d'un bon quart. Les fentes comptent aussi, dans le
sens attendu — elles ajoutent une capacité, et plus serrées valent mieux — mais
au second rang. Les deux cotes le **disent** maintenant dans leur aide, et la
fiche marque l'impédance de bord comme surestimée : c'est le balayage qui
tranche, et l'écart n'est pas corrigé en douce sur la foi d'un seul relevé.

Un motif n'est donc pas une antenne : c'est un dessin qui tombe assez près
pour que la **première** simulation soit exploitable. Sans lui, elle part d'un
dessin au hasard et ne dit rien ; avec lui, elle dit de combien il faut
allonger le patch. Chaque motif affiche son calcul ligne par ligne — εᵣ
effectif, allongement des bords, impédance au bord, développé du brin replié,
largeur de ligne **relue** et son impédance réelle — parce qu'un chiffre rendu
sans son calcul n'est qu'un chiffre.

La bande est posée à **±15 %** de la cible, et ce n'est pas un détail :
simuler sur ±2 % rendrait une courbe sans creux, dont on ne saurait même pas
de quel côté chercher.

### Dessiner

Rectangle, piste, polygone, disque, via, et la **découpe** — une fente dans un
patch, un dégagement autour de la ligne, un trou dans le plan de masse. Grille
d'accrochage, couche et net courants, largeur de piste.

**Ctrl+Z annule, Ctrl+Y refait** (Ctrl+Maj+Z aussi, et Cmd sur un Mac), et deux
boutons de la barre le montrent — un raccourci qu'on ne voit pas n'existe que
pour qui le connaît déjà. Ce qui est retenu est un *instantané* du dessin et
non le journal des gestes : un motif posé refait la carte, l'empilage, la bande
et le port, et il n'a pas d'inverse simple. L'instantané, lui, n'a rien à
savoir de ce qui a changé — annuler un patch rend donc aussi la carte et le
port d'avant, et non les seules formes, ce qui laisserait un port posé sur du
cuivre effacé. Il se pousse dans `conAppliquer()`, le passage obligé par lequel
toute modification acceptée refait le document : un geste ajouté demain y
entrera sans qu'on ait rien à écrire. Une polyligne *en cours*, elle, se défait
sommet par sommet — tant qu'elle n'est pas fermée, elle n'est dans aucun
historique.

**Les cotes se tapent, elles ne se visent pas.** Un patch dont la longueur
bouge de 0,3 mm à 2,45 GHz se décale de 20 MHz, et personne ne vise 0,3 mm à
la souris : le canevas pose la forme là où elle va, le panneau lui donne sa
cote. Un rectangle se règle en X, Y, **largeur et hauteur** — pas en deux
coins : c'est ainsi qu'on écrit « 38,2 mm de long » sans faire l'addition de
tête.

Une découpe est **coupée au bord du versement** qu'elle perce. C'est un calcul
d'intersection de polygones exact — algorithme de Greiner-Hormann —, et il rend
plusieurs morceaux quand il le faut : une fente qui coupe un versement en U en
donne deux. Ce qui déborde ne retire donc rien ailleurs, et une même fente peut
percer deux versements de la même couche, chacun de son propre morceau.

La vraie difficulté n'est pas l'algorithme, ce sont les **dégénérescences** —
un dégagement rectangulaire aligné sur le bord d'un versement rectangulaire,
c'est-à-dire le cas courant et non le cas rare. Elles sont levées par une
perturbation de 10⁻⁷ mm : un dix-millième de micron, trois ordres de grandeur
sous la plus petite cellule qu'on maille jamais. Et quand le découpage
n'aboutit pas, la découpe est **comptée et dite**, jamais approchée en silence
— une fente qui manque change complètement une antenne, et rien dans le S₁₁ ne
le dirait. `test/banc-polygones.js` vérifie treize cas, les dégénérés compris.

**Les cotes s'écrivent en millimètres, en pouces ou en mils**, au choix, et le
dessin reste en millimètres dans tous les cas : seule leur écriture change.
Changer d'unité ne touche à aucune cote — c'est ce qui rend l'opération sûre.
Le mil est là parce que c'est l'unité réelle du métier en Amérique du Nord :
« 0,012 pouce » ne se lit pas, « 12 mil » se lit.

**La fréquence visée se saisit en Hz, kHz, MHz ou GHz** — la même liste que
l'étape « La bande », et la même pour une raison : la fréquence visée du motif
devient la fréquence cible du balayage à l'instant où le motif est posé. Deux
réglages séparés auraient permis de dimensionner en MHz et de relire la bande
en GHz. Les bandes sub-GHz — 868, 915 — se disent en mégahertz partout, et les
taper en GHz demande une division de tête qui finit par se rater. Là aussi,
changer l'unité ne change pas la fréquence : 2,45 GHz devient 2450 MHz. La
résonance estimée sous le dessin suit l'unité choisie, avec le nombre de
décimales qui garde la même finesse — le dixième de mégahertz.

### Ce que le mode met de côté pendant qu'il tourne

Les valeurs d'empilage saisies à la main sur des cartes importées vivent dans
le stockage local, **par nom de couche**, et elles ont la priorité sur ce que
le document déclare. Ici le document déclare exactement ce qu'on vient de
choisir : une surcharge d'un autre jour, portant le même nom de couche,
écraserait donc en silence la valeur qu'on est en train de régler — on
changerait l'εᵣ sans que rien ne bouge. Elles sont mises de côté à l'entrée du
mode, relues à la sortie, et l'écriture des préférences est suspendue entre
les deux pour que ce vidage ne parte jamais sur le disque.

Une seule chose fait le chemin inverse : le **rôle** des couches. Il est
deviné ailleurs au taux de cuivre qu'une couche porte — un patch qui couvre
plus de 40 % de la carte serait classé « masse » — et ici il est déclaré.
Une décision explicite l'emporte sur une supposition.

Ouvrir un fichier fait sortir du mode : un dessin et une carte réelle ne
cohabitent pas, et le premier coup de crayon effacerait la seconde.

## L'assistant IA — un relecteur, et rien de plus

Sept étapes, une soixantaine de nombres, et deux d'entre eux suffisent à rendre
un résultat faux sans qu'aucun message ne le dise : une marge d'air trop
courte, un maillage qui ne met que deux cellules en travers d'une ligne.
L'assistant des étapes sait déjà **refuser** ce qui ne se calcule pas, et le
serveur sait déjà **chiffrer** ce que ça va coûter. Ni l'un ni l'autre ne sait
dire « votre encastrement est trois millimètres trop profond, et c'est pour ça
que votre patch ne s'adapte pas ».

Le bouton **✨ IA** ouvre un panneau qui sait le dire. Il ne décide de rien : il
lit, il explique, il propose — et **aucune valeur ne s'écrit sans un clic**.

### C'est le panneau de WEB_CAO

Même espace de travail, même thème, même panneau : `js/30-ia.js` reprend
l'interface de `commun/ia-assistant.js` de
[WEB_CAO](https://github.com/pilou33620/WEB_CAO), comme les modules `00` à `06`
de cet outil viennent de sa visionneuse. On y retrouve, à l'identique :

* la **barre de connexion** qui demande la clé, avec son œil pour la relire et
  son lien vers la clé gratuite ;
* la **barre d'état** une fois connecté : le modèle (Gemma 4 31B, Gemini 3.8
  Flash, Gemini 3.8 Flash Thinking), le contexte détecté, « Vider », « Oublier clé » ;
* les **bulles** de discussion, les **puces de questions**, le **manuel local**
  sur fond jaune, les **cartes d'action** bleues ;
* le **menu du clic droit** sur la carte — `js/04-interaction.js` appelait déjà
  `iaAfficherMenuContextuel`, il attendait ce fichier ;
* **Alt+I** pour ouvrir et fermer, **Échap** dans le panneau, **Entrée** pour
  envoyer, **Maj+Entrée** pour aller à la ligne.

### Deux commandes locales, et elles ne demandent rien à personne

Comme `help` dans WEB_CAO, elles sont exécutées par l'outil : **zéro requête,
zéro jeton, et aucune donnée ne sort du poste**. Elles marchent sans clé, et
sur une machine débranchée.

`help` rend le manuel. **`verifier`** — la puce verte, le bouton « 🔎 Vérifier »
de la barre d'état, ou le premier élément du menu du clic droit — lance l'audit
des réglages :

| Ce qui est vérifié | Ce qui est attrapé |
|---|---|
| la bande et la cible | une fréquence visée hors de la bande simulée ; une bande trop étroite pour qu'un creux y apparaisse ; une bande hors du vraisemblable, c'est-à-dire une faute d'unité |
| le cuivre, l'empilage | rien de désigné ; un intervalle sans épaisseur saisie |
| les ports | aucun port posé ; un port qui relie une couche à elle-même ; un coaxial qui ne fait pas son impédance de référence |
| l'arrêt | un garde-fou qui coupera avant que l'énergie soit descendue — ce qui rend une descente tronquée, et une transformée sur une descente tronquée n'est pas une mesure |
| le maillage | moins de trois cellules en travers de la ligne d'alimentation : le cas exact qui fait disparaître la résonance du patch de cet outil |
| le motif patch | un encastrement `y₀` laissé au calcul du gabarit, dont **on sait qu'il est faux** (voir plus bas) |
| le dernier résultat | une résonance au bord de la bande ; un écart à la cible, avec le sens de la correction ; une désadaptation, en séparant ce qui vient de la réactance de ce qui vient de la partie réelle |

L'audit sort en markdown, avec ses corrections en blocs `action` — c'est-à-dire
**par le même rendu que la réponse du modèle**. Une correction locale et une
correction proposée par l'IA donnent la même carte, avec la même barrière
derrière : deux chemins de rendu auraient fini par diverger, et c'est celui qui
écrit dans l'état qu'on ne veut pas voir diverger.

**Poser une question**, en revanche, appelle Google AI Studio. C'est pour tout
ce qu'une règle ne sait pas faire : *pourquoi* la résonance est 80 MHz trop
basse, *quoi* balayer en premier, ce diagramme est-il crédible.

### Ce qui sort du poste, et il faut le dire

Le reste de l'outil ne dépend d'aucun service tiers — three.js est dans le
dépôt pour cette raison, et une simulation qui dépendrait d'un serveur
extérieur ne serait pas reproductible. Ce mode-ci fait exception, et il
l'annonce : quand la case **« Contexte projet »** est cochée, un résumé des
réglages part chez Google.

Le **résumé**, et rien d'autre : la bande, l'empilage, le cuivre retenu en
nombre d'objets, les ports, la boîte, le maillage, l'arrêt, les chiffres que
le serveur a rendus, le motif ouvert avec ses cotes, les cotes balayables, et
le dernier résultat. **Ni le fichier IPC-2581, ni les polygones de cuivre, ni
les courbes.** La case se décoche, et le mode reste utilisable en questions
générales.

### La clé

Elle vient du poste : `GET /api/ia/cle` rend celle que le serveur trouve dans
`api_key_free_ia_studio.txt` à la racine du dépôt, ou dans la variable
d'environnement `GEMINI_API_KEY`. Le fichier est dans `.gitignore`.

**Et elle ne sort pas de ce poste.** C'est la seule route qui exige une
adresse de boucle locale, et la raison tient en une phrase : le contrôle
d'origine arrête les *pages*, pas les *clients*. Une page ouverte sur
`evil.com` ne peut pas lire la réponse d'une route d'ici — il n'y a pas
d'en-tête `Access-Control-Allow-Origin` pour elle — mais un `curl` lancé
depuis n'importe quelle machine du réseau local n'envoie aucun `Origin`, et
rien ne le distinguait du navigateur de la tablette. C'est délibéré pour les
autres routes ; ça ne l'était pas pour une clé personnelle et facturable.
Depuis le réseau, la page demande donc sa clé comme sur un poste qui n'en a
pas — et elle ne vivra que dans cet onglet-là.

Sans elle, la barre de connexion la demande. Elle ne vit alors qu'**en mémoire
vive et dans le `sessionStorage` de cet onglet** : ni stockage local, ni
cookie, ni projet — et **fermer le panneau l'efface**, par le ✕, par Alt+I, par
Échap ou par « Oublier clé ». Le serveur, lui, ne la garde pas, ne s'en sert
pas, et n'appelle personne avec : il la relit à chaque demande et la rend à la
page, qui fait l'appel elle-même.

### La liste blanche, et pourquoi elle est étroite

C'est la seule barrière entre un texte venu du réseau et l'état de la
simulation, et c'est le seul endroit de l'outil où une faute **ne se verrait
pas** : le réglage changerait, la simulation tournerait, et le résultat aurait
l'air d'un résultat.

Une proposition arrive dans un bloc `action` — que le modèle écrit, ou que
l'audit local produit. La page le relit, valide **chemin par chemin** contre
`IA_CHAMPS`, borne chaque valeur, et affiche l'avant en face de l'après :

```
⚡ Affiner le maillage
   pas de maillage dans le diélectrique : 0 (au mailleur de décider) → 0,78 mm
   cellules de PML                      : 8 → 10
   ⚠ « arret.energie » : en dessous de la borne basse (-80).
                                                      [ ⚡ Appliquer ]
```

Ce qui est **refusé est affiché aussi** : une proposition à moitié valable dont
la moitié fautive disparaîtrait donnerait une carte qui ne fait pas ce que le
texte à côté vient d'expliquer. Ce qui est appliqué devient `✓ 2 réglage(s)
appliqué(s)` et **reste annulable** tant que la conversation est ouverte — un
réglage de simulation n'a pas d'historique comme le dessin, et sans ce bouton
il faudrait retrouver la valeur d'avant à la main.

Quatre genres de cartes, et rien d'autre : des **réglages** (bande, boîte,
maillage, arrêt, pertes, ports), des **cotes de motif** du mode conception,
l'**armement d'un balayage**, et de la **géométrie libre** dans le dessin.
Jamais la sélection de cuivre, jamais l'empilage lu dans le fichier, jamais un
chemin qui ferait disparaître un travail.

La consigne envoyée au modèle **est engendrée depuis cette liste** : une liste
recopiée à la main aurait dérivé dès le premier champ ajouté, et le modèle
aurait proposé des réglages que la page refuse — ce qui ressemble beaucoup à un
modèle qui se trompe, et n'en est pas un. Le banc d'essai le vérifie
(`test/banc-interface.js`, section 9).

### La géométrie libre — quand aucun motif ne trace l'antenne

Les six motifs du mode conception couvrent ce qui se calcule : patch, monopôle,
IFA, MIFA, dipôle, ligne étalon. Une fente, un anneau, un patch à coins coupés,
un motif qu'on a en tête — rien de tout cela n'a de gabarit, et la réponse de
l'assistant était jusqu'ici une liste de cotes à reporter à la main, c'est-à-dire
exactement le travail qu'on venait lui confier.

Une carte `formes` pose donc du cuivre. Elle donne une liste de primitives en
millimètres — `rect`, `disque`, `poly`, `piste`, `via`, et `trou` pour une
**découpe** —, chacune sur une couche désignée par « haut », « bas » ou son nom
exact ; plus, en option, la **taille de carte** et le **port** qui vont avec —
sans port, rien ne se simule, et la liste blanche sait *déplacer* un port mais
pas en *poser* un.

La carte **liste chaque forme** avant de rien écrire, parce qu'une carte qui
annoncerait « 12 formes » demanderait de presser pour savoir ce qu'on pose :

```
⚡ Patch à coins coupés — géométrie libre
   formes dessinées   : 0 → 5  (le dessin en cours est effacé)
   port d'excitation  : non posé → 20 ; 0,4, empreinte 3,06 × 0,8 mm,
                        de « Cuivre dessus » à « Cuivre dessous »
   · rectangle · Cuivre dessous · GND · 40 × 45 mm, coin en (0 ; 0)
   · polygone  · Cuivre dessus  · ANTENNE · 6 sommets, encombrement 24 × 24 mm
   · piste     · Cuivre dessus  · ANTENNE · large de 3,06 mm, longue de 12 mm
   · découpe rectangle · Cuivre dessus · 4 × 8 mm, coin en (18 ; 20)
   · via       · Cuivre dessus  · GND · Ø 0,6 mm en (36 ; 41)
   ⚠ forme 6 : genre « trapeze » inconnu ; les genres sont rect, disque,
     poly, piste, via.
                                                      [ ⚡ Appliquer ]
```

La barrière est de même nature que la liste blanche, mais elle porte sur des
formes : un genre connu, une couche de cuivre qui **existe**, des coordonnées
finies et bornées, une étendue dessinable, au plus 40 formes et 200 sommets,
et rien d'entièrement hors carte — **du cuivre hors substrat flotte dans l'air
du volume de calcul, il rayonne, et rien sur la courbe ne dira d'où vient ce
qu'on lit**. Ce qui n'est pas refusé mais qu'on regretterait de ne pas avoir lu
— du cuivre qui affleure le bord, un dessin qui va être effacé, un port absent
— est dit dans un avis bleu, distinct du refus jaune. Une piste, elle, se juge
sur son **axe** et non sur sa largeur : une ligne d'alimentation qui vient
mourir au bord de carte — ce que font les six motifs — aurait sinon débordé de
w/2 à chaque fois, et un avis qui se déclenche toujours ne se lit plus.

Appliquer garde l'état d'avant **en entier** — les formes, la carte, la fiche
de motif, et la pose de tous les ports — pour que le bouton « Annuler » défasse
cette carte-là et elle seule, même si trois formes ont été dessinées à la main
entre-temps ; le Ctrl+Z du mode conception, lui, ne saurait pas faire la
différence.

**Un motif reste préférable dès qu'il en existe un**, et la consigne le dit dans
ces termes : un motif calcule ses cotes, tient une fiche, se repose et se
balaye. Une géométrie libre ne sait rien d'elle-même — c'est un tas de formes,
et l'outil ne peut en dire que ce qu'il mesure.

### Ce que le modèle sait de cet outil

Sa consigne porte ce que les mesures de ce dépôt ont tranché, et qu'on ne lit
nulle part ailleurs : que le gabarit patch surestime la résistance de bord d'un
facteur 3,5 et propose donc un encastrement trop profond d'un quart ; que
resserrer les encoches gagne 8 dB ; que λ/20 dans le diélectrique ne suffit pas
face à une ligne étroite ; qu'allonger une ligne d'alimentation **n'adapte
pas**, elle fait tourner Γ sans changer son module. Un modèle générique
proposerait le contraire de chacune de ces quatre choses.

## La vue 2D et la surimpression — fluidité à 60 fps et saisie fidèle

La vue 2D combine la CAO de la carte et la surimpression de la simulation (le cuivre
retenu, les ports, la boîte d'air et la grille FDTD Yee) :

* **Accélération vectorielle par `Path2D` en cache** : sur une carte multicouche
  complexe ou un maillage fin comprenant des milliers de lignes de coordonnées et des
  centaines d'îlots de cuivre, redécrire la géométrie au contexte Canvas à chaque
  trame faisait chuter le rafraîchissement lors des zooms et déplacements continus.
  Désormais, le cuivre retenu (`antRetenuChemins`), la grille de maillage FDTD
  (`antMaillageChemin`) et le quadrillage du mode conception (`conGrilleChemin`)
  sont matérialisés dans des objets `Path2D` mis en cache. L'affichage s'exécute
  à 60 images par seconde sans aucune saccade.
* **Fidélité stricte des champs contre les fantômes du navigateur** : au
  rechargement de la page ou lors d'une restauration de session, Chrome et Firefox
  remettent parfois dans les champs textuels et menus déroulants les valeurs de la
  session précédente sans émettre d'événement `change` (ce qui laissait par exemple
  afficher un port à d'anciennes coordonnées alors que l'état interne était vierge).
  La fonction `antChampsFideles` réimpose systématiquement ce que l'état mémorise
  et désactive `autocomplete="off"` pour garantir que l'écran reflète fidèlement
  la réalité du modèle envoyé au solveur.

## L'aperçu 3D

**Naviguer : les gestes de WEB_3D.** La vue reprend la navigation de la
visionneuse [WEB_3D](../WEB_3D), son préréglage par défaut :

| geste | effet |
| :--- | :--- |
| clic droit glissé (ou gauche) | tourner, Z restant en haut |
| bouton du milieu, Ctrl + droit, Maj + gauche | déplacer, le long des axes de l'écran |
| Maj + clic droit glissé | zoomer |
| molette | zoomer **vers le curseur** |
| double-clic | le point visé devient le centre de rotation (dans le vide : recadrer) |
| un doigt · deux doigts | tourner · déplacer et pincer |

Un clic gauche sans glisser reste un clic : il choisit une pièce. Le
déplacement suit enfin l'écran — il poussait avant le centre le long du
regard, et l'on s'enfonçait dans la scène en croyant glisser de côté —, et le
clic droit n'ouvre plus le menu du navigateur.


Quatre des fautes qui gâchent une simulation d'antenne ne se voient **pas**
en 2D, parce qu'elles portent sur la hauteur :

* un port posé entre les mauvaises couches (il relie la piste au plan
  d'alimentation et non à la masse : rien ne le distingue vu de dessus) ;
* une boîte d'air trop plate (la marge est bonne en X et Y, dérisoire en Z — et
  c'est par le dessus qu'une antenne rayonne) ;
* un via dont la portée a été supposée traversante alors qu'il est enterré ;
* un connecteur coaxial dont le tronçon plonge dans la couche absorbante —
  c'est-à-dire hors du calcul. L'âme, la gaine et le tronçon sous la carte sont
  dessinés en entier, et c'est ici qu'ils servent le plus : vus de dessus, ils
  ne sont qu'un cercle.

Les quatre sautent aux yeux dès qu'on regarde la pile par le côté. Ce qui est
dessiné est le **modèle normalisé**, celui que le serveur a rendu — pas la
carte. Si un polygone manque là, il manquera dans la simulation. Les ports en
charge y sont plus pâles que celui qui excite : le S₁₁ est celui du vif.

## L'exécution, et pourquoi en sous-processus

Le serveur écrit le script, puis le lance dans un **processus séparé**.

1. **Ce qui tourne est ce qu'on exporte.**
2. **Un solveur qui plante n'emporte pas le serveur.** openEMS est du C++ :
   une géométrie dégénérée peut le faire tomber par une faute de segmentation,
   qui tuerait le processus Python hôte — et avec lui la page et le travail en
   cours.
3. **On peut l'arrêter.** Un calcul de trois heures lancé par erreur se tue par
   son PID ; un appel bloquant dans un fil d'exécution Python, non.

Le suivi se fait par **sondage** et non par flux : la page dit combien de
lignes elle a déjà, le serveur envoie la suite. Fermer l'onglet n'interrompt
pas le calcul, et une veille de l'ordinateur portable ne le perd pas.

## Ce que les résultats disent, et ce qu'ils ne disent pas

Le S₁₁ mesure l'**adaptation**, pas le rayonnement. Une antenne peut afficher
−25 dB et ne rien rayonner : parfaitement adaptée, elle dissipe tout dans le
cuivre et le diélectrique — une charge de 50 ohms très coûteuse. C'est pourquoi
le **rendement**, quand la boîte de champ lointain a tourné, est affiché à côté
du S₁₁ et non dans un onglet où personne n'irait le chercher.

La bande à −10 dB porte trois mentions qui la rendent honnête : elle peut être
**coupée** par le bord de la bande simulée, elle peut être en **plusieurs
morceaux** (deux résonances), et elle peut **ne pas exister**.

Le **couplage** est affiché à côté du S₁₁ dès qu'il y a deux ports, avec sa
valeur à la résonance et sa pire valeur sur la bande. Sur un balayage, un
tableau donne une ligne par point — résonance, écart à la cible, S₁₁ minimal,
impédance, bande — et cliquer une ligne montre les courbes de ce point-là :
l'impédance et le diagramme d'une cote valent autant que son S₁₁.

**Un panneau vide dit pourquoi il est vide.** Une simulation dont toutes les
grandeurs ressortent indéfinies ne tue plus la suite d'un balayage depuis
longtemps ; elle ne disait pas encore ce qui avait raté, et la seule façon de
l'apprendre était de relire quatre mille lignes de journal. La courbe d'énergie
est pourtant suivie pas à pas — c'est elle qui annonce le temps restant —, et
elle distingue trois cas qui ne se corrigent pas de la même façon :

* l'énergie **montait encore** à la fin : le calcul diverge, et une divergence
  FDTD vient du maillage — une cellule beaucoup plus petite que les autres,
  souvent fabriquée par une géométrie dégénérée. Les décibels du journal ne le
  montrent pas : openEMS les compte sur le maximum atteint, si bien qu'un
  calcul qui explose affiche 0,00 dB d'un bout à l'autre, exactement comme un
  calcul dont l'impulsion entre encore. C'est le nombre devant qui tranche ;
* l'énergie **descendait sans atteindre le seuil** : c'est le garde-fou du
  nombre de pas qui a coupé, et la transformée porte alors sur une descente
  tronquée — ce n'est pas une mesure ;
* l'énergie **est bien descendue** : la convergence n'y est pour rien, et ce
  qui reste est du côté de la mesure — un port qui n'excite rien, une sonde
  hors du cuivre.

Le cas est nommé dans le journal et en tête du panneau de résultats ; sur un
balayage, il est dans l'infobulle de la ligne qui n'a que des tirets.

Exports : `.csv`, `.s1p` (Touchstone) et le script Python.

Le **tableau S complet** (bouton « Lancer les N simulations », étape « Le
calcul ») enchaîne une simulation par port, l'excitation déplacée de l'un à
l'autre, et range les colonnes ensemble. Il n'invente rien : chaque colonne
est une simulation ordinaire, vérifiée par le même chemin que les autres, et
la durée est **multipliée par le nombre de ports** — l'annonce le dit avant le
clic. Le tableau ouvre alors un onglet de résultats et l'export `.sNp`.

**Une colonne est une simulation complète, et se clique comme une ligne de
balayage.** Le S₁₁ et les couplages de toutes les colonnes tiennent dans le
tableau ; l'impédance d'entrée, les courbes détaillées et surtout le
**diagramme de rayonnement** appartiennent, eux, à *une* simulation — celle où
tel port émettait. Deux antennes couplées ne rayonnent pas de la même façon
selon celle qu'on alimente : l'autre devient une charge posée à côté, et c'est
même toute la question quand on en pose deux. Cliquer une colonne montre donc
la sienne dans les autres onglets. Les N diagrammes sont calculés de toute
façon — n'en montrer qu'un revenait à jeter les autres.

Deux choses le rendent honnête. D'abord une colonne qui n'a pas abouti laisse
ses cases **vides** et le `.sNp` n'est pas écrit : un lecteur Touchstone lit
une case absente comme un zéro, c'est-à-dire comme une isolation parfaite.
Ensuite l'écart de **réciprocité** est calculé et affiché : une structure
passive vérifie S(i,j) = S(j,i) exactement, les deux moitiés du tableau
sortent de deux simulations indépendantes, et leur écart ne mesure pas
l'antenne mais ce que le calcul a perdu en route. Sur une ligne 50 Ω
traversante de ce dépôt, il vaut 0,04 % — et S₂₂ retombe sur S₁₁ au centième
de décibel près.

Sans tableau complet, le couplage part dans le `.csv` et non dans un `.s2p` :
un fichier à deux ports déclare les **quatre** paramètres, une simulation n'en
rend que deux, et remplir les deux autres de zéros produirait un fichier que
tous les outils liraient sans broncher et dont la moitié serait inventée.

## Banc d'essai

```bash
python python/test/banc-openems.py
```

852 vérifications sans solveur réparties en 23 sections : cotes en z, sens des
polygones, maillage, refus attendus, conversion pouces/millimètres, script
généré, les deux modèles de pertes, les quatre primitives, les pièces
importées (recollage, corps ouvert refusé, lignes sur les parois, rotation, et
— si openEMS est installé — CSXCAD lui-même qui voit la paroi pleine et la
cavité vide, avant et après le passage par le XML), la conductivité
déclarée d'un conducteur, le poids des enregistrements, les ports multiples et
leurs refus, la géométrie du connecteur coaxial, les points d'un balayage —
croisement compris, où le garde-fou porte sur le produit —, l'assemblage des
colonnes d'un tableau S et le résultat complet que chacune garde, la calibration
de la durée sur le débit du poste, la facture du maillage et la plus petite
cellule (« pincée »), le calcul qui ne rend rien et son diagnostic d'énergie,
le désembedage d'une ligne d'alimentation, le port court-circuité par le cuivre
lui-même, et les refus d'un nom de projet — et la **liste blanche du mode IA**,
qui sont les deux seuls endroits de l'outil où une chaîne venue du réseau touche
quelque chose : le système de fichiers pour l'un, l'état de la simulation pour
l'autre.

Cinq de ces sections méritent d'être signalées parce qu'elles n'éprouvent pas
du code de ce dépôt au sens ordinaire :

1. **La facture du maillage et la plus petite cellule** (section 17) : vérifie
   que la plus petite cellule annonce le rang de ses deux bords (`obligatoire`,
   `affinage`, `remplissage`), que la pincée correspond au plancher de l'axe, que
   le substrat divisé en trois n'est pas confondu avec une cellule minuscule,
   que le budget en cellules-pas chiffre exactement ce qui partira au solveur, et
   qu'un calcul de plusieurs heures est annoncé en clair avec l'avis préventif
   adéquat.
2. **Le calcul qui ne rend rien** (section 18) : fabrique des journaux d'openEMS
   ligne à ligne — avec son signe détaché, « (- 7.32dB) », qui avait déjà fait
   manquer une lecture — et vérifie que les trois cas se distinguent : une
   divergence numérique (énergie croissante), une descente tronquée par le
   garde-fou $n_\text{max}$, et une descente propre.
3. **Le désembedage d'une ligne** (section 19) : extrait du script généré le
   bloc de calcul analytique et l'**exécute** : ce bloc est du texte écrit dans
   le script, pas une fonction du dépôt, et en tenir une seconde copie dans le banc
   ne prouverait rien. Il éprouve l'aller-retour sur la ligne, la demi-onde guidée
   qui ramène l'impédance sur elle-même, et vérifie qu'on n'a pas confondu l'εᵣ
   effectif de la ligne avec celui du patch.
4. **Le port court-circuité par le cuivre** (section 20) : simule une pastille
   du net d'antenne recopiée sur le plan de masse sous le port (le cas vu sur
   `P01x274PCB-C.xml`) et vérifie qu'un avis grave bloque le calcul, tout en
   laissant passer une sonde normale ou une pastille fondue dans la masse.
5. **La liste blanche du mode IA** : éprouve une *barrière* et non un calcul : un
   calcul faux rend un mauvais nombre et finit par se voir, une barrière qui
   laisse passer ne se voit jamais — le réglage change, la simulation tourne, et
   le résultat a l'air d'un résultat. Elle vérifie donc qu'un chemin hors liste
   est refusé, qu'une valeur hors bornes l'est en disant laquelle, qu'aller puis
   revenir remet exactement ce qui était là, que la consigne envoyée au modèle ne
   peut pas s'écarter de la liste que la page applique, et que ce qui revient du
   réseau est échappé avant d'être affiché.

Un bloc à part éprouve le **lecteur de champs** (`python/test/banc-champs.py`,
appelé lui aussi par le banc principal, 26 vérifications). Il n'a besoin ni
d'openEMS ni d'un dossier de calcul : il **écrit ses propres `.vtr`**, compressés
et non compressés, avec des grilles de tailles volontairement quelconques — c'est
quand la longueur de l'en-tête n'est pas un multiple de trois octets que le
décodage base 64 se décale, et une grille 4 × 4 ne le montrerait jamais. Il
vérifie ensuite que la tranche extraite d'un volume est bien la bonne dans
les trois directions, que la tranche proposée par défaut est celle qui
**porte le champ** et non celle du milieu (qui, dans une boîte, est de
l'air), que l'inventaire préfère le couple amplitude/phase aux instantanés,
et qu'une clé inventée est refusée plutôt que résolue en chemin. Donnez-lui
un dossier de calcul en argument et il refait le tour sur de vrais fichiers :

```bash
python python/test/banc-champs.py <dossier-de-calcul>
```

Les deux derniers blocs sont en JavaScript et tournent sous **node**, que le
banc appelle lui-même quand il est installé : le découpage des découpes
(`test/banc-polygones.js`, 13 vérifications, cas dégénérés compris) et la logique
de la page (`test/banc-interface.js`, **397 vérifications**) :
- la classification des nets (GND, PWR, Signal), l'auto-détection, les filtres et les préréglages ;
- la mise en cache vectorielle `Path2D` du cuivre, de la grille Yee FDTD et du quadrillage ;
- la fidélité stricte des champs (`antChampsFideles`) neutralisant les valeurs fantômes du navigateur ;
- la génération du rapport Markdown enrichi avec la plus petite cellule ("pincée" bornée) et la charge globale $\text{cellules} \times n_\text{max}$ ;
- la liste des ports, la description d'un balayage, les conversions d'unité, les motifs d'antenne, les gestes du dessin avec leur historique ;
- l'**empilage du mode conception** — chaque modèle d'usine tombe-t-il sur l'épaisseur qu'il annonce, le dessin survit-il à un changement de nombre de couches, le masque arrive-t-il au solveur, un port devenu faux est-il vu — ;
- l'ordre des colonnes d'un fichier Touchstone, et le balayage d'une cote de **motif** — que le dessin revienne en place au bit près, que la carte et le port suivent la cote, qu'un second port survive au point, et que les cotes du motif disparaissent dès que le dessin n'en est plus la copie.

```bash
python python/test/banc-openems.py --simuler
```

lance en plus **deux** vraies simulations FDTD sur le patch d'essai — l'une
nourrie par une sonde localisée, l'autre par un connecteur coaxial — et vérifie
que la résonance tombe à quelques pour-cent de la formule, et que les deux
alimentations tombent au même endroit. Dernier passage :

```
sonde localisée   résonance 2,3750 GHz   S11 −6,72 dB   Z = 19,7 +12,0j Ω
port coaxial      résonance 2,3700 GHz   S11 −7,25 dB   Z = 22,3 +17,4j Ω
                  soit 0,2 % d'écart, et l'inductance de l'âme en plus
directivité 6,88 dBi      gain 2,91 dBi      rendement 40,1 %
```

**C'est cette simulation-là qui a trouvé la faute qu'aucune relecture n'aurait
vue** : le dégagement du plan de masse était d'abord posé en cylindre de
hauteur nulle, qui ne perce pas une feuille conductrice. Le script était
lisible, la géométrie avait l'air juste, et le résultat disait
Z = 0,0 + 5,0j Ω — exactement l'impédance d'une ligne de 1,5 mm
court-circuitée à son bout. Le dégagement est depuis un polygone, comme les
découpes de versement l'ont toujours été.

## Limites connues

* **Une pièce importée est vue en marches d'escalier.** La grille FDTD est
  cartésienne : une paroi plane alignée sur un axe tombe juste (elle porte ses
  lignes), un congé ou une paroi inclinée est rendu par les cellules qui
  l'approchent. Le métal y est un conducteur parfait, et un plastique ne
  remplace jamais la carte là où ils se recouvrent. Le budget est de 400 000
  triangles simulés : au-delà, marquez « ignoré » ce qui ne compte pas (vis
  loin de l'antenne, composants).

* **Une simulation rend une colonne du tableau S**, pas le tableau. Deux ports
  donnent S₁₁ et S₂₁ ; S₂₂ et S₁₂ demandent une seconde simulation,
  l'excitation déplacée. Ce n'est pas un manque de l'outil mais la définition
  d'un paramètre S — « ce qui sort de j quand SEUL i excite ». Le bouton
  « tableau S complet » enchaîne ces simulations et assemble les colonnes ;
  ce qui reste vrai, c'est le **prix** : la durée est multipliée par le nombre
  de ports.
* **Le balayage n'optimise pas.** Une liste de valeurs, une simulation par
  valeur, une famille de courbes. Il n'y a ni gradient, ni critère d'arrêt, ni
  recherche : c'est la lecture qui décide, et c'est voulu. Deux cotes se
  **croisent** quand elles ne se lisent pas l'une sans l'autre — la longueur
  d'un patch pose la résonance, son encastrement pose l'adaptation — et le
  résultat se lit en tableau à deux entrées. Le prix est alors un **produit** :
  six valeurs croisées avec six font trente-six simulations, et le garde-fou
  des quarante points porte sur ce produit.
* **L'excitation du port coaxial est une croix de quatre bras**, pas un mode
  TEM continu sur toute la couronne — `AddCoaxialPort` n'existe pas dans les
  liaisons Python. La MESURE, elle, est rigoureuse : tension radiale, courant
  en boucle fermée autour de l'âme, plan de référence ramené à la carte. Ce que
  l'approximation coûte est borné par le premier mode supérieur du câble, qui
  coupe vers 25 GHz pour une SMA : au plan de mesure, il ne reste que du TEM.
* **Le port coaxial ne fait pas de charge réparti exacte** : les quatre bras
  portent chacun 4·Z₀, et quatre en parallèle font Z₀. C'est une charge
  correcte à quelques pour-cent, pas un absorbeur parfait.
* **Les polygones de cuivre se chevauchent.** Un trait coudé devient un
  rectangle par segment plus un octogone à chaque sommet. Calculer leur union
  exacte serait un travail considérable pour un gain nul : CSXCAD superpose des
  primitives de même matériau sans que cela change le maillage ni le champ.
* **Un via dont la portée n'est pas déclarée est modélisé traversant**, et
  l'assistant le compte et le dit. « Vide » ne veut pas dire « traversant ».
* **Les traits de largeur nulle sont ignorés** et comptés à part.
* **La durée annoncée reste un ordre de grandeur**, mais elle n'est plus
  supposée : openEMS écrit sa vitesse à chaque ligne d'avancement, et le
  serveur retient la **médiane des cinq derniers calculs** de ce poste — d'une
  session à l'autre, dans les réglages de l'utilisateur. Tant qu'aucun calcul
  n'a fini, l'annonce repart de 25 millions de cellules-pas par seconde et
  l'infobulle dit lequel des deux on lit. Elle reste un ordre de grandeur parce
  que le maillage suivant n'a pas la même empreinte mémoire : un petit modèle
  qui tient dans le cache va plus vite par cellule qu'un gros. Sur un balayage,
  elle est multipliée par le nombre de points — c'est là qu'elle compte le
  plus, parce que c'est là qu'on lance une nuit de calcul sans la voir venir.
* **Un polygone plus fin que la maille disparaît**, et openEMS ne le dit
  qu'une fois, au milieu de son démarrage. L'assistant les compte et le
  signale — si l'un d'eux est la pastille du port, le port n'excite plus rien.
* **Les motifs d'antenne sont analytiques**, pas optimisés : 2 à 5 % d'écart
  sur la résonance, davantage sur substrat épais ou εᵣ élevé. C'est un point
  de départ que la simulation corrige, jamais un résultat — et c'est
  exactement ce que le balayage sert à rattraper.
* **L'encastrement d'un patch est franchement faux**, et c'est la seule cote
  dont l'écart soit chiffré ici : mesuré sur FR-4 1,6 mm à 2,45 GHz, il est
  trop profond d'un bon quart, et le patch s'en trouve désadapté (−2,5 dB au
  lieu de −13). La résistance de bord du modèle de cavité en est la cause, et
  la fiche du motif le dit. Ce n'est pas corrigé : un relevé sur un substrat
  ne fait pas une loi.
* **Un méandre serré sort du modèle** : le MIFA pose le développé exact, mais
  deux brins repliés plus proches que deux largeurs de piste se couplent, et
  la résonance remonte au-dessus du calcul. La fiche le signale ; elle ne le
  corrige pas, parce que le corriger demanderait le solveur.
* **La résonance annoncée par une fiche de motif n'est pas une mesure** : elle
  sort de la même formule que les cotes, relue à l'envers. Elle dit dans quel
  sens une cote retouchée déplace l'antenne, pas où l'antenne résonne.
* **Un découpage de polygones peut échouer** sur une géométrie que la
  perturbation ne suffit pas à désambiguïser. La découpe est alors comptée et
  signalée, jamais approchée. Une découpe efface par ailleurs **tout** le métal
  de sa couche à cet endroit, y compris une piste qui passerait dessous.
* **Le mode conception dessine en millimètres**, quelle que soit l'unité
  d'affichage : mm, pouces et mils changent l'écriture des cotes, pas le
  document produit. Les fichiers en pouces, eux, restent en pouces.
* **Un projet s'enregistre à la main**, il ne s'enregistre pas tout seul. Le
  bouton dit quand la dernière écriture a eu lieu et signale les modifications
  qui ne le sont pas, et fermer l'onglet dessus fait apparaître le garde-fou
  du navigateur ; il n'y a pas d'enregistrement automatique, parce qu'écrire
  par-dessus le travail d'hier sans qu'on l'ait demandé est pire que de
  laisser choisir.
* **Un projet n'a pas d'historique** : le dernier enregistrement remplace le
  précédent. Pour garder une variante, enregistrez-la sous un autre nom — ce
  que le champ du panneau fait en une frappe.
* **Le cuivre désigné à la main est rangé par son rang dans le document de la
  carte**, et non par un identifiant : un fichier IPC-2581 n'en donne pas pour
  une piste. C'est fidèle parce que la carte est enregistrée *avec* le projet
  et rouverte telle quelle ; remplacer `carte.json` à la main par un autre
  fichier ferait désigner autre chose, en silence.
* **Le mode IA ne vérifie pas la physique**, il vérifie des **réglages**. Ses
  règles locales attrapent ce qui est incohérent — une cible hors bande, un
  garde-fou qui coupera trop tôt, trois cellules en travers d'une ligne — et
  elles se taisent sur une antenne parfaitement réglée qui ne rayonnera jamais
  dans la bonne direction. « Rien à redire » veut dire « rien ne m'alerte »,
  pas « c'est bon ».
* **Un modèle de langage se trompe, et il se trompe avec aplomb.** Ce qu'il
  propose passe par une liste blanche bornée et ne s'applique qu'au clic, mais
  aucune borne ne rattrape un raisonnement faux : la valeur sera dans les
  limites, et elle pourra être la mauvaise. Ce qu'il dit se relit, et se
  vérifie par une simulation — c'est-à-dire par l'outil, pas par lui.
* **Le mode IA est le seul morceau de cet outil qui dépende d'un service
  tiers**, et le seul qui ait besoin d'un accès réseau. Les vérifications
  locales, elles, n'en demandent aucun : c'est pour cela qu'elles existent.
* **La conversation ne va pas dans le projet.** Elle vit le temps de la page,
  la clé comprise. Ce qui reste d'une séance, ce sont les réglages qu'on a
  appliqués — et ceux-là, le projet les garde comme les autres.
* **Les calques hors simulation dans les exports IPC-2581** : les exports CAO
  industriels portent souvent des dizaines de calques documentaires (sérigraphie,
  masque de soudure, pâte, zones de composants, keepouts, cotations). Le parseur les
  filtre désormais automatiquement via `layerFunction` (`CONDUCTOR`, `SIGNAL`,
  `PLANE`, `POWER`, `GROUND`, `MIXED`, et les perçages `DRILL`) pour éviter qu'une
  zone de composant ou un contour mécanique ne se transforme en plan de cuivre.
  Un calque sans fonction déclarée reste conservé par précaution — un cuivre perdu
  coûtant plus cher qu'un calque de trop.
* **La masse cachée derrière le plan de référence** : sur une carte multicouche,
  le cuivre de masse situé entièrement derrière le plan de masse continu principal
  est retiré par défaut avec ses vias orphelins. Un plan plein étant opaque en FDTD,
  l'écart sur le rayonnement lointain est infime (moins de 0,1 dB) pour un gain de
  maillage appréciable. La case « Garder toute la masse » permet de forcer leur calcul
  si nécessaire.
* **Les ports court-circuités par le cuivre** : une pastille du net d'antenne
  présente par erreur sur la couche de masse sous le port ou un port reliant la masse
  à elle-même sont détectés et bloqués par une alerte grave avant tout lancement,
  évitant de calculer une fausse antenne qui a l'air de résonner.
* **Les valeurs fantômes restaurées par le navigateur** : au rechargement, le
  navigateur pouvait réinjecter d'anciennes valeurs dans les champs sans événement
  `change`. L'alignement strict (`antChampsFideles`) et `autocomplete="off"`
  garantissent désormais que l'interface ne montre que ce que l'état porte réellement.

## Installation complète des prérequis

Le solveur et l'outil s'articulent autour de trois briques qu'il convient de mettre en place dans l'ordre suivant :

### 1. Les binaires openEMS (`openEMS/`)

L'archive officielle openEMS pour Windows contient **à la fois** les binaires C++ (`openEMS.exe`, `CSXCAD.dll`), et les roues d'installation Python (`.whl` pour `openEMS` et `CSXCAD`). **Cette archive doit être extraite en premier**, car `pip` en aura besoin à l'étape suivante.

1. **Télécharger l'archive binaire openEMS pour Windows (64-bit)** :
   - Disponible sur le site officiel : [openems.de/download](https://www.openems.de/download/)
   - Ou depuis les releases GitHub du projet : [openEMS-project Releases](https://github.com/thliebig/openEMS-project/releases) (ex. `openEMS-v0.0.36-win64.zip`)
2. **Extraire l'archive** dans un dossier nommé `openEMS/` placé **directement à la racine du projet** (à côté de `web_antenna.py`).
3. **Vérifier l'arborescence** : le dossier `openEMS/` doit contenir directement :
   ```
   openEMS/
   ├── CSXCAD.dll
   ├── openEMS.dll
   ├── openEMS.exe
   ├── AppCSXCAD.exe
   ├── python/
   │   ├── CSXCAD-0.6.3-cp310-cp310-win_amd64.whl
   │   ├── openEMS-0.0.36-cp310-cp310-win_amd64.whl
   │   └── ...
   └── ...
   ```

> `openems_run.py` ajoute automatiquement ce dossier au chemin de recherche des DLL (`os.add_dll_directory`). Cela élimine l'erreur `DLL load failed` qui survient d'ordinaire lors de `import CSXCAD`.

---

### 2. L'environnement virtuel Python (`env/`)

Il est **impératif d'utiliser Python 3.10 ou Python 3.11 (64 bits)**, versions pour lesquelles les liaisons C++ précompilées d'openEMS sous Windows sont fournies. Avec Python 3.12 ou supérieur, l'installation des roues openEMS échouera.

```powershell
# 1. Créer l'environnement virtuel avec Python 3.10 ou 3.11
# Sur Windows avec plusieurs versions de Python, utiliser le sélecteur py :
py -3.10 -m venv env
# (ou : py -3.11 -m venv env)

# 2. Activer l'environnement
.\env\Scripts\activate

# 3. Installer les dépendances Python
# (requirements.txt va automatiquement chercher CSXCAD et openEMS dans openEMS/python/)
pip install -r requirements.txt
```

> **Bascule automatique dans `env/` :** `web_antenna.py` détecte automatiquement si vous le lancez depuis une invite ordinaire avec le Python système. S'il trouve `env/` à la racine, il se relance de lui-même avec l'interpréteur de l'environnement virtuel.

---

### 3. Visualisation des champs avec ParaView (`ParaView-…/`)

**Facultatif.** Les champs s'affichent et s'animent dans l'outil lui-même
(panneau « Champs », voir plus haut) : rien à installer pour la question de
tous les jours — « où passe le courant ? ». ParaView reste utile pour ce
qu'une carte plane ne montre pas : isosurfaces, coupes obliques, lignes de
champ, rendu volumique.

1. **Télécharger ParaView pour Windows** :
   - Téléchargement sur le site officiel : [paraview.org/download](https://www.paraview.org/download/)
   - Vous pouvez choisir l'archive portable `.zip` (ex: `ParaView-6.x.x-Windows-…-AMD64.zip`) ou l'installateur `.exe`.
2. **Intégration** (deux options au choix) :
   - **Mode portable (sans droits admin)** : Décompressez simplement l'archive dans le répertoire racine du projet (ex. `ParaView-6.1.1-Windows-Python3.12-msvc2017-AMD64/`). `openems_run.py` détecte automatiquement tout dossier commençant par `paraview` à la racine et localise `bin/paraview.exe`.
   - **Mode standard** : Installez-le dans `C:\Program Files\ParaView …` ou assurez-vous que `paraview` est présent dans votre `PATH`.

Au démarrage du serveur, si ParaView est détecté, la console affiche son chemin :
```text
  ParaView          C:\...\ParaView-6.1.1-...\bin\paraview.exe
```
Dans l'interface web, le bouton **ParaView** du panneau des champs s'active automatiquement pour ouvrir directement les fichiers `.vtr` de la simulation sélectionnée.

---

### Pièges rencontrés sur Windows (et contournés dans le code)

Quatre pièges rencontrés sur Windows sont automatiquement gérés : les deux premiers sur le réseau (voir « Le port » plus haut), les deux suivants sur le solveur :

* **Nom court 8.3 du profil utilisateur :** openEMS 0.0.36 vérifie `os.getcwd() == os.path.realpath(sim_path)`. Quand `TEMP` vaut le nom court 8.3 du profil (`PIERRE~1.REN`), les deux ne coïncident pas et le calcul s'arrête sur une `AssertionError` nue. Les chemins sont donc canonisés avant d'être passés au solveur.
* **Unités du champ lointain :** `CalcNF2FF(center=…)` attend des **mètres**, pas l'unité de dessin. Un centre donné en millimètres place le point de phase à des dizaines de mètres et la directivité ressort `nan`, sans la moindre erreur explicite.

## Origine

L'habillage — thème « dashboard nocturne », panneaux détachables — et la
lecture de carte IPC-2581 (`js/01` à `js/05`, `python/ipc2581_*.py`) viennent
de **WEB_CAO** (<https://github.com/pilou33620/WEB_CAO>), sous licence MIT.
`js/06-ouverture.js` en est dérivé, réécrit pour ne plus dépendre des services
propres à ce dépôt-là (profils d'utilisateur, dossiers de projet, reprise de
session d'un outil à l'autre) : ici il n'y a qu'un outil.

L'**assistant IA** en vient aussi. `css/ia.css` est une copie de
`commun/ia-assistant.css`, et `js/30-ia.js` reprend l'interface de
`commun/ia-assistant.js` telle quelle : barre de connexion, barre d'état,
bulles, puces de questions, manuel local, cartes d'action et menu contextuel.
C'est le même panneau, dans le même espace de travail — `js/04-interaction.js`
appelait d'ailleurs déjà `iaAfficherMenuContextuel` sur le clic droit, en
attendant ce fichier. Ce qui change est ce qui devait changer : le contexte
transmis, ce que l'assistant sait du domaine, et ce qu'une carte d'action a le
droit d'écrire.
