# Ce qui reste à faire

État relevé le **15/09/2026**, après la séance qui a traité les cinq chantiers
de la version précédente de ce fichier. Le banc passe :
`python python/test/banc-openems.py` → **374 vérifications, toutes passées**,
bancs JavaScript compris. Aucun `TODO` ni `FIXME` dans le code.

Ce qui a été fait — et qui ne se redécouvre donc plus ici : l'**annuler /
refaire** du mode conception, le **banc du dessin à la main**, la **calibration
de la durée annoncée** sur le débit réel du poste, le **tableau S complet** avec
son export `.sNp`, et le **croisement de deux cotes** au balayage. Le README les
décrit ; ce fichier ne garde que ce qui reste ouvert.

Les deux premiers chapitres sont ce qui **manque** — vérifié dans le code,
références de lignes à l'appui. Le troisième reprend les « Limites connues » du
README au complet, triées par ce qu'on en fait : celles déjà en travaux plus
haut, celles qui tiennent à une brique en dessous, et celles qui sont des choix
et ne se rouvrent pas. Une limite écrite sans cette mention se redécouvre à
chaque relecture, et on la traite une fois de trop.

---

## 1. Ce qui manque, et qui se voit à l'usage

### L'adaptation du patch — ce que la mesure a tranché, ce qu'elle laisse ouvert

C'était la question restée ouverte du diagnostic du 15/09 : même bien maillé,
le patch du gabarit s'adapte mal, et son impédance garde une forte partie
réactive. Deux candidats étaient en lice, et ils sont **maintenant séparés**.

**Le plan de référence n'y est pour rien, et c'est démontrable.** Une ligne
sans perte dont l'impédance caractéristique est celle de référence ne change
pas |Γ| : elle le fait TOURNER. Le désembedage ne peut donc pas améliorer
d'un dixième de décibel une adaptation mesurée au bord de la carte.

Deux simulations le confirment sur le patch du gabarit (458 000 puis 511 000
cellules, arrêt à −40 dB) — la seconde avec la ligne d'alimentation
**doublée**, ce qui est la façon expérimentale de poser la question : si le
plan de référence était en cause, allonger la ligne changerait l'adaptation.

| à 2,45 GHz | S₁₁ | Z au port | Z ramené au patch |
|---|---|---|---|
| ligne du gabarit, 6,4 mm | −0,64 dB | 9,0 − 98,9 j Ω | 50,1 + 252,2 j Ω |
| ligne doublée, 12,8 mm | −1,20 dB | 4,3 − 24,2 j Ω | 82,6 + 226,2 j Ω |

L'impédance lue change du tout au tout ; l'adaptation, elle, bouge d'un demi-
décibel — l'ordre de grandeur de ce que 6,4 mm de FR-4 à tanδ = 0,02
dissipent, et rien de plus. **`AddMSLPort` n'aurait donc rien corrigé** : on
cherchait une désadaptation de 7 en ROE, on trouve une perte de ligne.

*Au passage, la même mesure justifie l'autre moitié du chantier suivant* : les
deux impédances ramenées au patch devraient coïncider et ne coïncident pas
(50 + 252 j contre 83 + 226 j). Le désembedage a été fait ici avec le Z₀ et
l'εᵣ effectif du **calcul analytique** — 50,2 Ω et 3,992 —, qui ne sont pas
tout à fait ceux de la ligne telle qu'elle est maillée. `MSLPort`, lui, mesure
son propre `Z_ref`.

**Ce qui reste, et où chercher.** À sa propre résonance (2,315 GHz, soit 5,5 %
sous la cible — davantage que les 2 à 5 % annoncés), le patch présente au port
**49,7 − 119,6 j Ω**. La partie réelle est celle que l'encastrement visait :
le calcul de `y0` sur la résistance de bord du modèle de cavité (477 Ω) **tombe
juste**. C'est la réactance de −120 Ω qui ruine tout — un ROE de 7,6 pour une
résistance parfaite.

*À faire* : trouver d'où vient cette réactance. Les deux pistes, dans l'ordre
du plus probable :

1. **Les deux fentes de l'encastrement.** Le modèle de cavité les ignore : il
   donne la résistance au bord d'un patch nu et suppose qu'on y entre sans rien
   perturber. Or elles font ici `g` = 2,49 mm, soit huit dixièmes de la largeur
   de ligne, sur une profondeur de 11,5 mm. Un croisement `g` × `y0` le dirait
   en neuf simulations — c'est exactement ce que le balayage croisé sait faire
   depuis cette séance, et c'est le premier usage à lui donner.
2. **La résonance basse de 5,5 %**, qui déplace tout le reste. L'allongement
   des bords ΔL vaut 0,741 mm par bord dans le calcul ; s'il est sous-estimé,
   la longueur posée est trop grande.

*Attention* : les valeurs absolues relevées ici (−2,29 dB au creux, −3,35 dB
avec la ligne doublée) ont été obtenues
sur un document **reconstruit à la main** à partir des cotes du gabarit — mêmes
cuivres, mêmes fentes, même port, mais la ligne d'alimentation est un rectangle
au lieu d'une polyligne à bouts ronds. L'argument sur le plan de référence n'en
dépend pas ; la profondeur du creux, elle, est à reprendre sur le document que
la page produit vraiment avant d'en conclure quoi que ce soit.

### Le port microruban désembedé (`AddMSLPort`) — le prix, désormais chiffré

**L'essentiel de ce qu'on en attendait est fait autrement**, et sans lui : la
ligne d'alimentation se **déclare** au port (longueur, largeur), et l'outil
ramène l'impédance au pied de l'antenne par la formule de ligne, avec le Z₀ et
l'εᵣ effectif de Hammerstad. Les deux impédances s'affichent côte à côte, les
motifs déclarent leur ligne tout seuls, et les deux réserves voyagent avec le
nombre — rotation **sans perte**, Z₀ **analytique**. Voir le README, § « Les
ports ».

Ce qui reste à `MSLPort`, et lui seul :

* le **Z₀ réel de la ligne telle qu'elle est maillée** (`Z_ref`), que le
  solveur mesure au lieu de le calculer sur un ruban idéal ;
* une **absorption propre** de ce qui revient vers le connecteur, au lieu d'un
  port localisé qui réfléchit ;
* une excitation en **onde progressive** plutôt qu'une source localisée.

**Le prix est maintenant connu, et il est plus élevé qu'annoncé.** Lecture
faite de `openEMS/ports.py` (`class MSLPort`) et du tutoriel `MSL_NotchFilter`
livré avec le solveur :

1. le port n'est pas un point mais **un tronçon de ligne** : il dessine son
   propre ruban de `start` à `stop`, pose trois sondes de tension et deux de
   courant, et exige **au moins cinq lignes de maillage** dans la direction de
   propagation ;
2. ce tronçon doit **partir du mur du domaine** — le tutoriel excite à dix
   cellules du bord et mesure au tiers de la ligne. Or la ligne du gabarit fait
   6,4 mm et s'arrête au **bord de la carte**, à l'intérieur de la boîte d'air.
   L'outil devrait donc **prolonger le ruban, le substrat ET le plan de masse
   hors de la carte** jusqu'à la paroi — c'est-à-dire simuler une géométrie qui
   n'est pas celle qui est dessinée. Déclarée, mais ajoutée ;
3. la PML mange les huit premières cellules : avec le pas de 0,78 mm que la
   ligne impose, elle couvrirait 6,2 mm — soit toute la ligne du gabarit. Le
   prolongement n'est donc pas un détail de bord, c'est plusieurs centimètres ;
4. et il traverse tout : `openems_modele.py` (cotes, vérifications, lignes de
   maillage, emprise, boîte — le port a besoin de la boîte, que le modèle
   calcule *après* les ports), `openems_script.py`, le panneau des ports, la
   vue 3D qui doit montrer ce prolongement, et le banc.

*La décision* : à prendre quand on aura besoin du Z₀ mesuré plutôt que calculé.
Ce n'est pas le cas aujourd'hui — l'écart entre les deux est justement ce que
la réserve écrite à côté du nombre annonce.

---

## 2. Confort, à décider avant d'écrire

*(Les deux chantiers de cette section — la lisibilité d'un croisement et le
diagnostic d'un calcul qui ne rend rien — ont été traités. Voir le README.)*

---

## 3. Les limites connues, et ce qu'on en fait

La liste complète, telle que le README l'établit — mais triée ici par la seule
question qui intéresse une liste de travaux : **est-ce que ça se traite ?**
Trois réponses possibles, et deux d'entre elles ferment le sujet.

### Ce qui est déjà en travaux, plus haut

| limite | où |
|---|---|
| **Les motifs d'antenne sont analytiques**, pas optimisés : 2 à 5 % d'écart sur la résonance, davantage sur substrat épais ou εᵣ élevé. | La limite reste — c'est un point de départ que la simulation corrige, et c'est ce que le balayage rattrape. Mais le patch mesuré tombe à 5,5 %, et son encastrement est franchement faux : § 1. |
| **Un ruban n'est pas désembedé par le solveur** : l'impédance est mesurée au bord de la carte. | Elle est maintenant **ramenée au pied de l'antenne par le calcul**, quand la ligne est déclarée — avec ses deux réserves. Ce n'est PAS une cause de désadaptation, c'est démontré. Le désembedage par le solveur reste au § 1, « `AddMSLPort` ». |

### Ce qui est une limite du monde, pas de l'outil

Rien à faire ici tant que la brique en dessous ne bouge pas.

* **L'excitation du port coaxial est une croix de quatre bras**, pas un mode
  TEM continu sur toute la couronne — `AddCoaxialPort` n'existe pas dans les
  liaisons Python. La MESURE, elle, est rigoureuse : tension radiale, courant
  en boucle fermée autour de l'âme, plan de référence ramené à la carte. Ce
  que l'approximation coûte est borné par le premier mode supérieur du câble,
  qui coupe vers 25 GHz pour une SMA. *Se rouvre si les liaisons Python
  gagnent un port coaxial — pas avant.*
* **Le port coaxial ne fait pas de charge répartie exacte** : les quatre bras
  portent chacun 4·Z₀, et quatre en parallèle font Z₀. Correct à quelques
  pour-cent, pas un absorbeur parfait. Même condition que ci-dessus.
* **Un via dont la portée n'est pas déclarée est modélisé traversant**, et
  l'assistant le compte et le dit. « Vide » ne veut pas dire « traversant » :
  c'est le fichier qui est muet, et deviner à sa place serait pire.
* **Les traits de largeur nulle sont ignorés** et comptés à part.
* **Un polygone plus fin que la maille disparaît**, et openEMS ne le dit
  qu'une fois, au milieu de son démarrage. L'assistant les compte et le
  signale — si l'un d'eux est la pastille du port, le port n'excite plus rien.
* **Un découpage de polygones peut échouer** sur une géométrie que la
  perturbation de 10⁻⁷ mm ne suffit pas à désambiguïser. La découpe est alors
  comptée et signalée, **jamais approchée**. Une découpe efface par ailleurs
  tout le métal de sa couche à cet endroit, y compris une piste qui passerait
  dessous. *Se rouvre seulement si un cas réel échoue* — treize cas dégénérés
  passent aujourd'hui (`test/banc-polygones.js`).

### Ce qui ne se rouvre pas

Des choix, pas des manques. Noté pour que la question ne revienne pas à
chaque relecture.

* **Une simulation rend une colonne du tableau S**, et c'est la définition d'un
  paramètre S, pas une limite. Ce qui manquait était l'enchaînement, et il est
  écrit ; le **diagramme de chaque colonne** aussi, depuis qu'une colonne se
  clique comme une ligne de balayage. Ce qui reste vrai est le **prix** : la
  durée est multipliée par le nombre de ports, et l'annonce le dit avant le
  clic.
* **Le balayage n'optimise pas.** Une liste de valeurs, une simulation par
  valeur, une famille de courbes : ni gradient, ni critère d'arrêt, ni
  recherche. C'est la lecture qui décide, et c'est voulu. Le croisement de deux
  cotes ne change rien à cela — il ajoute un axe, pas une recherche.
* **La durée annoncée reste un ordre de grandeur**, même mesurée : le maillage
  suivant n'a pas la même empreinte mémoire, et un petit modèle qui tient dans
  le cache va plus vite par cellule qu'un gros. Ce qui a changé, c'est qu'elle
  ne suppose plus le poste.
* **Les polygones de cuivre se chevauchent.** Un trait coudé devient un
  rectangle par segment plus un octogone à chaque sommet. Calculer leur union
  exacte serait un travail considérable pour un gain nul : CSXCAD superpose
  des primitives de même matériau sans que cela change le maillage ni le
  champ.
* **Le mode conception n'est pas un éditeur de CAO** — pas de contraintes,
  pas de DRC, pas de netlist, pas d'empreintes. Une carte dessinée ici se
  simule ; elle ne se fabrique pas.
* **Le mode conception dessine en millimètres**, quelle que soit l'unité
  d'affichage : mm, pouces et mils changent l'écriture des cotes, pas le
  document produit. Les fichiers en pouces, eux, restent en pouces. C'est
  cette séparation qui rend le changement d'unité sûr.
* **Un projet s'enregistre à la main, et n'a pas d'historique.** Le dernier
  enregistrement remplace le précédent ; une variante se garde sous un autre
  nom, ce que le champ du panneau fait en une frappe. L'annuler / refaire du
  mode conception ne change rien à cela : il vit le temps de la séance, il est
  remis à zéro à l'ouverture d'un projet, et il n'est pas enregistré. Écrire
  par-dessus le travail d'hier sans qu'on l'ait demandé serait pire que de
  laisser choisir, et un outil de calcul n'est pas un gestionnaire de versions
  — le dossier de projet, lui, se met où l'on veut, donc sous une sauvegarde
  ou un dépôt si l'on en a un.
* **Le mode conception ne crée pas un second chemin vers le solveur.** Il
  fabrique un document au format exact du parseur et le donne à la même
  fonction de chargement — donc tous les refus de l'assistant valent aussi
  sur une carte dessinée. Toute idée qui contournerait ce passage est à
  refuser d'emblée : ce sont ces refus qui font la valeur de l'outil. Le
  tableau S complet et le balayage croisé suivent la même règle : N documents
  ordinaires, normalisés un par un, refusés comme les autres.
