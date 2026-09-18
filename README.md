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
3. **ParaView** (optionnel mais recommandé) pour la visualisation 3D des champs électromagnétiques.

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
├── index.html              la page
├── css/
│   ├── theme.css           le thème « dashboard nocturne »
│   ├── workspace.css       les panneaux détachables
│   ├── antenne.css         ce que cet outil ajoute
│   └── ia.css              le panneau de l'assistant IA, repris de WEB_CAO
├── js/
│   ├── 00 … 06             lire et afficher la carte IPC-2581
│   ├── 10 … 16             l'outil : état, géométrie, assistant, 3D, résultats
│   ├── 17-objets.js        les objets qui ne sont pas sur la carte
│   ├── 18-champs.js        enregistrer les champs, les ouvrir dans ParaView
│   ├── 19-demarrage.js     les branchements
│   ├── 20 … 23            le mode conception : dessiner au lieu d'importer
│   ├── 24-balayage.js      une ou deux cotes, une plage, une famille de courbes
│   ├── 25-polygones.js     l'intersection exacte de deux polygones
│   ├── 26-exemple.js       le bouton « Exemple » : un cas connu, d'un clic
│   ├── 27-apercu-motif.js  le dessin coté d'un motif d'antenne, avant de le poser
│   ├── 28-projet.js        capturer la séance, et la reprendre
│   ├── 29-tableau-s.js     le tableau S complet, et son fichier Touchstone
│   ├── 30-ia.js            l'assistant IA : vérification locale, et le modèle si on veut
│   ├── 90-workspace.js     les panneaux détachables
│   └── vendor/three.min.js three.js r134, posé ici et non pris sur un CDN
├── python/
│   ├── ipc2581_*.py        le parseur IPC-2581 et sa traduction en JSON
│   ├── openems_modele.py   le document relu, vérifié, complété, maillé, chiffré
│   ├── openems_script.py   le modèle → un script Python autonome
│   ├── openems_run.py      l'exécution en sous-processus, et son suivi
│   ├── openems_antenne.py  la façade : les seules fonctions que web_antenna.py connaît
│   ├── projet.py           les projets sur le disque : où on les range, et comment on les rouvre
│   └── test/banc-openems.py
├── test/
│   ├── carte-antenne.py    fabrique une carte d'essai IPC-2581
│   ├── patch-2450.xml      … celle qu'elle produit
│   ├── banc-polygones.js   le découpage des découpes, cas dégénérés compris
│   └── banc-interface.js   ports, balayage, unités, liste blanche de l'IA
├── env/                    l'environnement virtuel Python (dépendances pip)
├── openEMS/                les binaires du solveur (à télécharger, voir « Installation »)
└── ParaView-…/             le visualiseur 3D des champs (à télécharger, optionnel)
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

### Les simulations écrivent dans le projet

Tant qu'aucun projet n'est ouvert, openEMS écrit dans le dossier temporaire du
système : c'est le bon endroit pour un essai qu'on ne gardera pas. Dès qu'un
projet est ouvert, les dossiers de calcul vont dans `calculs/`. Ce n'est pas un
détail de rangement : un enregistrement de champ fait des centaines de
méga-octets de `.vtr` que ParaView relit, et les laisser dans `TEMP` revient à
les perdre au premier nettoyage de disque, sans que rien ne l'annonce.

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

Ce n'est **pas un éditeur 3D** : quatre formes et des nombres. Dessiner une
pièce mécanique demande un outil de mécanique ; l'importer demanderait un
lecteur de STEP.

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

Le banc d'essai le vérifie par une **vraie simulation** : le même patch, nourri
par une sonde localisée puis par un coaxial, doit résonner au même endroit. Il
le fait à 0,2 % près, avec l'inductance de l'âme en plus sur l'impédance
d'entrée — ce qu'ajoute une sonde réelle.

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
carte entière avec elle. Quand le plafond mord, l'assistant le dit — ce cuivre
là n'est pas résolu, et c'est à l'utilisateur d'imposer le pas s'il y tient.

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

C'est aussi là qu'on demande d'**enregistrer les champs** — avant de lancer :
un calcul déjà fait ne peut plus en produire. Densité de courant, champ
électrique ou magnétique, sur un plan, une coupe, la structure ou toute la
boîte.

Le mode **fréquentiel** rend un champ complexe par fréquence demandée :
quelques fichiers, quelques mégaoctets — 46 fichiers et 0,9 Mo sur la carte
d'essai. Le mode **temporel** rend un fichier **par pas de temps**, des
dizaines de milliers, et remplit un disque en quelques minutes ; il ne sert
qu'à faire une animation, et son poids est annoncé avant. Les fichiers sont
des `.vtr` : deux boutons les ouvrent dans **ParaView** (cherché sur le poste)
ou, à défaut, ouvrent le dossier de calcul.

Un S₁₁ dit que l'antenne résonne à 2,37 GHz ; il ne dit pas **pourquoi**. La
carte du courant de surface, elle, le montre d'un coup d'œil.

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

L'épaisseur de cuivre se prend en onces, comme on la commande.

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
* la **barre d'état** une fois connecté : le modèle (Gemini 2.5 Flash, Gemini
  2.5 Pro, Gemma 4 31B), le contexte détecté, « Vider », « Oublier clé » ;
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

Trois genres de cartes, et rien d'autre : des **réglages** (bande, boîte,
maillage, arrêt, pertes, ports), des **cotes de motif** du mode conception, et
l'**armement d'un balayage**. Jamais la sélection de cuivre, jamais l'empilage
lu dans le fichier, jamais un chemin qui ferait disparaître un travail.

La consigne envoyée au modèle **est engendrée depuis cette liste** : une liste
recopiée à la main aurait dérivé dès le premier champ ajouté, et le modèle
aurait proposé des réglages que la page refuse — ce qui ressemble beaucoup à un
modèle qui se trompe, et n'en est pas un. Le banc d'essai le vérifie
(`test/banc-interface.js`, section 9).

### Ce que le modèle sait de cet outil

Sa consigne porte ce que les mesures de ce dépôt ont tranché, et qu'on ne lit
nulle part ailleurs : que le gabarit patch surestime la résistance de bord d'un
facteur 3,5 et propose donc un encastrement trop profond d'un quart ; que
resserrer les encoches gagne 8 dB ; que λ/20 dans le diélectrique ne suffit pas
face à une ligne étroite ; qu'allonger une ligne d'alimentation **n'adapte
pas**, elle fait tourner Γ sans changer son module. Un modèle générique
proposerait le contraire de chacune de ces quatre choses.

## L'aperçu 3D

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

466 vérifications sans solveur : cotes en z, sens des polygones, maillage,
refus attendus, conversion pouces/millimètres, script généré, les deux
modèles de pertes, les quatre primitives, la conductivité déclarée d'un
conducteur, le poids des enregistrements, les ports multiples et leurs refus,
la géométrie du connecteur coaxial, les points d'un balayage — croisement
compris, où le garde-fou porte sur le produit —, l'assemblage des colonnes
d'un tableau S et le résultat complet que chacune garde, ce qu'un calcul qui
ne rend rien dit de lui-même, le désembedage d'une ligne d'alimentation, la
calibration de la durée sur le débit du poste, et les refus d'un nom de
projet — et la **liste blanche du mode IA**, qui sont les deux seuls endroits
de l'outil où une chaîne venue du réseau touche quelque chose : le système de
fichiers pour l'un, l'état de la simulation pour l'autre.

Trois de ces sections méritent d'être signalées parce qu'elles n'éprouvent pas
du code de ce dépôt au sens ordinaire. Celle du **calcul qui ne rend rien**
fabrique des journaux d'openEMS ligne à ligne — avec son signe détaché,
« (- 7.32dB) », qui avait déjà fait manquer une lecture — et vérifie que les
trois cas se distinguent : une divergence, une descente tronquée, une descente
propre. Celle du **désembedage** extrait du script généré le bloc de calcul et
l'**exécute** : ce bloc est du texte écrit dans le script, pas une fonction du
dépôt, et en tenir une seconde copie dans le banc ne prouverait rien. Celle de
la **liste blanche du mode IA** éprouve une *barrière* et non un calcul : un
calcul faux rend un mauvais nombre et finit par se voir, une barrière qui
laisse passer ne se voit jamais — le réglage change, la simulation tourne, et
le résultat a l'air d'un résultat. Elle vérifie donc qu'un chemin hors liste
est refusé, qu'une valeur hors bornes l'est en disant laquelle, qu'aller puis
revenir remet exactement ce qui était là, que la consigne envoyée au modèle ne
peut pas s'écarter de la liste que la page applique, et que ce qui revient du
réseau est échappé avant d'être affiché. Elle
vérifie l'aller-retour sur la ligne, la demi-onde guidée qui ramène
l'impédance sur elle-même, et un repère chiffré — celui-là même où une manip
antérieure s'était trompée d'εᵣ effectif en prenant la largeur du patch pour
celle de la ligne.

Les deux derniers blocs sont en JavaScript et tournent sous **node**, que le
banc appelle lui-même quand il est installé : le découpage des découpes
(`test/banc-polygones.js`, cas dégénérés compris) et la logique de la page
(`test/banc-interface.js` : la liste des ports, la description d'un balayage,
les conversions d'unité, les motifs d'antenne, les gestes du dessin avec leur
historique, l'ordre des colonnes d'un fichier Touchstone, et le balayage d'une
cote de **motif** — que le dessin revienne en place au bit près, que la carte
et le port suivent la cote, qu'un second port survive au point, et que les
cotes du motif disparaissent dès que le dessin n'en est plus la copie). Ce sont les
endroits de l'interface où une faute ne se voit pas — une conversion fausse
d'un facteur 25,4 rend une antenne qui a l'air d'une antenne, et un `.s2p`
écrit dans l'ordre des lignes au lieu de celui des colonnes échange S₁₂ et
S₂₁ sans que rien ne le montre.

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

Les simulations volumiques exportent les champs électromagnétiques au format VTK (`.vtr`). ParaView permet d'en explorer les isosurfaces, coupes vectorielles et flux.

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
