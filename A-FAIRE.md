# Ce qui reste à faire

État relevé le **15/09/2026**, après la séance qui a traité les quatre
chantiers ouverts de la version précédente et qui a mené la mesure que le
premier réclamait. Le banc passe :
`python python/test/banc-openems.py` → **466 vérifications, toutes passées**,
bancs JavaScript compris. Aucun `TODO` ni `FIXME` dans le code.

Ce qui a été fait — et qui ne se redécouvre donc plus ici : le **balayage
d'une cote de motif** (c'est lui qui a rendu la mesure possible), le
**diagramme de rayonnement de chaque colonne** d'un tableau S, la **famille de
courbes d'un croisement** lisible sur deux codes, le **diagnostic d'un calcul
qui ne rend rien**, et le **désembedage d'une ligne d'alimentation**. Le README
les décrit ; ce fichier ne garde que ce qui reste ouvert.

Le premier chapitre est ce qui **manque**, vérifié dans le code. Le second
reprend les « Limites connues » du README au complet, triées par ce qu'on en
fait : celles déjà en travaux plus haut, celles qui tiennent à une brique en
dessous, et celles qui sont des choix et ne se rouvrent pas. Une limite écrite
sans cette mention se redécouvre à chaque relecture, et on la traite une fois
de trop.

---

## 1. Ce qui manque, et qui se voit à l'usage

### L'adaptation du patch — la mesure a tranché, et ce n'est pas ce qu'on croyait

La question restée ouverte du diagnostic précédent : même bien maillé, le patch
du gabarit s'adapte mal, et son impédance garde une forte partie réactive. Deux
suspects étaient nommés — les **fentes de l'encastrement** (`g`) et la
**profondeur d'encastrement** (`y₀`). Un croisement 3 × 3 les a séparés.

**Neuf simulations, sur le document que la page produit vraiment** — c'est le
balayage d'une cote de motif qui l'a permis, écrit pour l'occasion. 464 000 à
492 000 cellules par point, arrêt à −40 dB, deux heures de calcul. `g` et `y₀`
encadrent chacun la valeur du gabarit à ± 3 mm et ± 1 mm.

| S₁₁ min · résonance · Z au port | y₀ = 8,51 | y₀ = 11,51 *(gabarit)* | y₀ = 14,51 |
|---|---|---|---|
| **g = 1,49** | **−16,02 dB** · 2,3306 GHz · 68,4 − 3,5 j | −2,60 dB · 2,3012 GHz · 43,5 − 103,0 j | −0,91 dB · 2,2681 GHz · 6,8 − 63,5 j |
| **g = 2,49** *(gabarit)* | −13,19 dB · 2,3434 GHz · 75,3 − 10,9 j | −2,50 dB · 2,3159 GHz · 36,5 − 96,0 j | −0,61 dB · 2,2957 GHz · 4,5 − 62,0 j |
| **g = 3,49** | −8,08 dB · 2,3379 GHz · 100,3 − 34,1 j | −0,80 dB · 2,2901 GHz · 11,7 − 100,5 j | −2,18 dB · 2,2442 GHz · 16,0 − 61,1 j |

Quatre choses en sortent, et la première renverse le diagnostic précédent.

**1. C'est `y₀` qui fabrique la réactance, et le calcul de `y₀` est faux.**
Remonter l'encastrement de 11,51 à 8,51 mm — trois millimètres — fait passer le
S₁₁ de −2,5 à −13,2 dB *à `g` inchangé*, et la réactance de −96 à −11 Ω. La
bande à −10 dB, qui n'existait dans aucun point à `y₀` nominal, apparaît :
35 à 44 MHz. Le diagnostic précédent concluait que « la partie réelle est celle
que l'encastrement visait, le calcul de `y₀` tombe donc juste » — c'était lire
une coïncidence. La formule `y₀ = (L/π)·acos(√(50/R_bord))` part de la
résistance de bord du modèle de cavité, **477 Ω** ici. Pour que l'adaptation
tombe à 8,5 mm, il faudrait `R_bord ≈ 135 Ω` : le modèle la surestime d'un
facteur **trois et demi**.

**2. Les fentes comptent, dans le sens attendu, et au second rang.** À `y₀`
tenu, resserrer `g` de 3,49 à 1,49 mm gagne 8 dB (−8,08 → −16,02) et fait
tomber la réactance de −34 à −3,5 Ω. C'est bien une **capacité de fente**, et
elle s'ajoute à celle de l'encastrement. Le premier suspect du diagnostic
précédent était donc réel — simplement second.

**3. Le meilleur point est un COIN du tableau.** L'optimum est *hors* de la
plage balayée, vers des `g` et des `y₀` encore plus petits. C'est la première
chose à refaire, et elle est maintenant bon marché : le balayage sait varier
ces deux cotes-là.

**4. Le champ lointain suit exactement l'adaptation** — ce qui est la seule
façon de vérifier qu'on n'a pas seulement déplacé de l'énergie dans une perte :
1,89 dBi et 40 % de rendement au meilleur point, contre −7,67 dBi et **5 %** au
pire. Un patch désadapté ne rayonne pas, il chauffe.

*Ce que cela ferme.* La réserve du diagnostic précédent — « les valeurs
absolues viennent d'un document reconstruit à la main » — est **levée** : le
document réel donne 2,3159 GHz et −2,50 dB au point du gabarit, contre
2,315 GHz et −2,29 dB sur la reconstruction. La polyligne à bouts ronds ne
changeait rien.

*À faire*, dans cet ordre :

1. **Prolonger le croisement vers le bas** : `y₀` de 5 à 9 mm, `g` de 0,5 à
   2 mm. Neuf points de plus, et l'optimum sera dans la plage.
2. **Puis croiser `L` × `y₀`.** La résonance reste 4,5 % sous la cible dans
   tout le tableau : `L` doit raccourcir, et cela déplacera l'adaptation.
   Les deux cotes ne se lisent pas l'une sans l'autre — c'est le cas d'école
   du croisement.
3. **Ne pas corriger la formule de `y₀` sur ce seul relevé.** Un facteur 3,5
   mesuré sur un substrat, une fréquence et une largeur de patch ne fait pas
   une loi ; et un motif reste un point de départ que la simulation corrige,
   ce qui est exactement ce qui vient de se passer. Ce qui vaut, en revanche,
   c'est de le **dire** dans la fiche du motif — c'est fait.

Le croisement complet est dans `croisement-g-y0.json`, à la racine.

**Une dixième simulation confirme le meilleur point, hors balayage** — gabarit
posé avec `g` = 1,49 et `y₀` = 8,51, maillage refait pour lui seul, ligne
d'alimentation déclarée :

| | |
|---|---|
| résonance | 2,3306 GHz |
| S₁₁ minimal | **−15,89 dB** (le balayage donnait −16,02) |
| bande à −10 dB | **44,1 MHz**, soit 1,89 % |
| Z au port | 68,7 − 3,6 j Ω |
| Z **au pied de l'antenne** | 57,9 + 15,5 j Ω |
| directivité · gain réalisé · rendement | 5,84 dBi · 1,86 dBi · 40,0 % |

Deux choses valent d'être notées. D'abord l'écart au point correspondant du
balayage est de **0,13 dB** : c'est le prix du maillage figé sur le point de
départ, et il est négligeable — la précaution qui rend la famille de courbes
comparable ne fausse pas les courbes. Ensuite l'impédance ramenée au pied du
patch, 57,9 + 15,5 j, est *plus proche de 50 Ω que celle du port* : rien
d'étonnant, la ligne fait tourner. C'est bien à ce plan-là que se lit ce qu'il
reste à corriger **sur l'antenne** — un reste inductif de 15 Ω, qu'un
encastrement un peu plus court compenserait.

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

### L'assistant IA — posé, et ce qu'il lui manque

`js/30-ia.js` et le bouton **✨ IA** : l'**interface de WEB_CAO reprise telle
quelle** — barre de connexion, barre d'état, bulles, puces, manuel local,
cartes d'action, menu du clic droit, Alt+I —, avec deux commandes exécutées en
local (`help` et `verifier`) et, si l'on veut, un modèle de langage qui lit les
mêmes réglages et propose des corrections. Rien ne s'écrit sans un clic, tout
passe par la liste blanche `IA_CHAMPS`, et le banc en éprouve la barrière
(section 9 de `test/banc-interface.js`). Le README le décrit en entier ; ce qui
suit est ce qui reste ouvert.

**1. Les règles locales ne connaissent qu'un motif sur six.** Deux d'entre
elles sont écrites pour le patch : le pas de maillage face à la largeur de
ligne, et l'encastrement `y₀`. Le monopôle, l'IFA, le MIFA et le dipôle n'ont
rien d'équivalent — or chacun a sa cote la moins sûre, et aucune n'est
chiffrée comme celle du patch l'est. *Le travail* : une mesure par motif, comme
le croisement `g` × `y₀` en a fait une. C'est du temps de calcul, pas du code.

**2. Rien ne relit un balayage terminé.** La règle la plus utile serait celle
qu'on ne peut pas encore écrire : « vos quarante courbes disent que l'optimum
est hors de la plage balayée, du côté des petites valeurs ». `ANT.resultat`
porte les points, la lecture reste à faire.

**3. Le contexte est un texte, pas des données.** Il se lit très bien et tient
en soixante lignes, mais un modèle qui devrait comparer neuf points d'un
croisement les recevrait en prose. Si cela devient utile, c'est un tableau
qu'il faudra joindre — pas une phrase de plus.

**4. `css/ia.css` est une copie, et une copie diverge.** La feuille vient de
`commun/ia-assistant.css` de WEB_CAO, et ce qui est propre à cet outil-ci est
ajouté **en fin de fichier**, jamais au milieu — pour qu'une version suivante
de WEB_CAO se reprenne par un `cp` et non par une fusion. Le jour où les deux
dépôts auront trois feuilles communes, ce sera un dossier partagé qu'il faudra,
pas une troisième copie.

**5. Un seul fournisseur.** L'appel est écrit pour Google AI Studio, en dur.
Un poste sans accès réseau n'a que les vérifications locales — ce qui est
délibéré, mais un modèle local (Ollama et consorts) tiendrait dans la même
fonction : c'est une URL et une forme de corps de requête, le reste ne bouge
pas.

---

## 2. Les limites connues, et ce qu'on en fait

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
