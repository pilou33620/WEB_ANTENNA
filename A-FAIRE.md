# Ce qui reste à faire

État relevé le **15/09/2026**, après la séance qui a traité les quatre
chantiers ouverts de la version précédente et qui a mené la mesure que le
premier réclamait. Le banc passe (relevé du 02/10/2026) :
`python python/test/banc-openems.py` → **991 vérifications, toutes passées**,
bancs JavaScript compris ; `--simuler` (deux vraies simulations FDTD) aussi. Aucun `TODO` ni `FIXME` dans le code.

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

1. ~~**Prolonger le croisement vers le bas**~~ — **fait le 02/10/2026**, voir
   plus bas : l'optimum est maintenant dans la plage.
2. ~~**Puis croiser `L` × `y₀`.**~~ — **fait le 02/10/2026**, voir plus
   bas : le patch est à 2,450 GHz et à −40 dB. La résonance reste 4,5 % sous la cible dans
   tout le tableau : `L` doit raccourcir, et cela déplacera l'adaptation.
   Les deux cotes ne se lisent pas l'une sans l'autre — c'est le cas d'école
   du croisement.
3. ~~**Ne pas corriger la formule de `y₀` sur ce seul relevé.**~~ — trois
   autres cas ont été mesurés le 03/10/2026, et le gabarit est **corrigé**
   (voir « La correction du gabarit », plus bas).

Le croisement complet est dans `croisement-g-y0.json`, à la racine.

**Le prolongement vers le bas (02/10/2026) a trouvé l'optimum — et il est
encadré.** Neuf points de plus, même document (FR-4 **1,6 mm** : depuis le
18/09 la page propose 1,53 mm d'âme pour 1,6 mm de carte, il a fallu le
remettre pour que les deux tableaux se lisent ensemble), mêmes réglages,
430 000 cellules par point, 56 minutes en tout. Données dans
`croisement-g-y0-bas.json`.

| S₁₁ min · résonance · Z au port | y₀ = 5 | y₀ = 7 | y₀ = 9 |
|---|---|---|---|
| **g = 0,5** | −9,72 dB · 2,3195 GHz · 31,2 − 19,8 j | −10,10 dB · 2,3214 GHz · 31,3 − 18,2 j | −10,32 dB · 2,3232 GHz · 31,0 − 16,6 j |
| **g = 1,25** | −14,90 dB · 2,3306 GHz · 36,2 − 7,2 j | **−33,87 dB** · 2,3306 GHz · **48,1 − 0,6 j** | −11,82 dB · 2,3214 GHz · 83,0 − 9,1 j |
| **g = 2** | −16,33 dB · 2,3361 GHz · 37,7 − 5,3 j | −30,50 dB · 2,3342 GHz · 53,1 + 0,3 j | −10,32 dB · 2,3232 GHz · 90,7 − 14,2 j |

Ce qui en sort :

* **L'adaptation est réglée** : `g` ≈ 1,25 à 2 mm, `y₀` ≈ 7 mm, S₁₁ sous
  −30 dB et une impédance à 1 Ω de 50 Ω. Le point est entouré de moins bons
  sur les deux axes : ce n'est plus un coin. Bande à −10 dB : 57 MHz, 2,4 %.
* **`y₀` est la cote sensible**, `g` beaucoup moins : entre 1,25 et 2 mm le
  S₁₁ reste sous −30 dB, mais ± 2 mm sur `y₀` le ramènent vers −12 / −16 dB.
  C'est la cote à tenir. Des encoches trop fines (0,5 mm) plafonnent à
  −10 dB quel que soit `y₀` : la partie réelle reste à 31 Ω.
* **Le calcul de `y₀` se trompe de 40 %** : il propose 11,5 mm, l'optimum est
  à 7. La règle « ne pas corriger la formule sur un seul relevé » tient
  toujours ; l'aide de la cote le dit.
* **Le rendement ne bouge plus** : 39 à 40 % sur les neuf points, gain
  réalisé 1,8 dBi au meilleur. Ce qui limite maintenant, ce sont les pertes du
  FR-4 (tan δ 0,02), plus l'adaptation.
* **La résonance reste à 2,33 GHz, 4,9 % sous la cible** : c'est l'étape 2,
  `L` × `y₀`, autour de `g` = 1,5 mm et `y₀` = 7 mm.

**L'étape 2, `L` × `y₀` à `g` = 1,5 mm (02/10/2026), a fini le réglage.**
Même document, 420 000 cellules par point, 46 minutes. Données dans
`croisement-L-y0.json`.

| S₁₁ min · résonance · Z au port | y₀ = 6 | y₀ = 7 | y₀ = 8 |
|---|---|---|---|
| **L = 27,2** | −26,37 dB · 2,4757 GHz · 45,7 − 1,7 j | −23,29 dB · 2,4739 GHz · 57,3 − 0,4 j | −12,80 dB · 2,4684 GHz · 78,5 − 7,6 j |
| **L = 27,7** | −22,32 dB · 2,4408 GHz · 43,2 − 2,2 j | −26,68 dB · 2,4390 GHz · 54,8 − 0,7 j | −14,39 dB · 2,4353 GHz · 73,0 − 4,5 j |
| **L = 28,2** | −21,38 dB · 2,4004 GHz · 42,3 − 1,9 j | −33,94 dB · 2,3986 GHz · 52,0 + 0,3 j | −16,22 dB · 2,3949 GHz · 68,2 − 1,5 j |

* **`L` fait la fréquence, et presque seul** : −75 MHz par millimètre, à
  moins de 10 MHz près quel que soit `y₀`. **`y₀` fait l'adaptation** : la
  partie réelle traverse 50 Ω entre 6 et 7 mm sur chaque ligne. Les deux
  cotes sont presque indépendantes autour de l'optimum : ce que le
  croisement devait vérifier, et qui permet d'interpoler.
* **Le point interpolé, simulé seul** — `L` = 27,55 mm, `y₀` = 6,6 mm,
  `g` = 1,5 mm :

| | |
|---|---|
| résonance | **2,4500 GHz** (cible 2,45) |
| S₁₁ minimal | **−39,9 dB** |
| Z au port · au pied de l'antenne | 50,9 − 0,5 j Ω · 50,9 + 0,4 j Ω |
| bande à −10 dB | 2,4206 à 2,4794 GHz, **58,8 MHz** (2,4 %) |
| directivité · gain réalisé · rendement | 5,90 dBi · **2,26 dBi** · 43 % |

* **Ce que le gabarit propose, et ce qu'il faut** (FR-4 1,6 mm, 2,45 GHz) :
  `L` 29,14 → **27,55 mm** (−5,5 %), `y₀` 11,51 → **6,6 mm** (−43 %), `g`
  2,49 → **1,5 mm**. La bande à −10 dB ne couvre pas toute la bande ISM
  (2,400 à 2,4835 GHz) : c'est la limite d'un patch sur 1,6 mm de FR-4, pas
  d'un réglage — l'élargir demande un substrat plus épais ou moins tenu.
* **Le meilleur S₁₁ du tableau n'est pas la bonne antenne.** Le −33,9 dB de
  `L` = 28,2 résonne à 2,40 GHz. La relecture d'un balayage par l'assistant
  (`lireBalayage`, js/30-ia.js) classe les points par le seul S₁₁ minimal :
  sur un balayage de `L`, elle désignerait ce point-là. **Corrigé le même
  jour** : avec les courbes, elle juge le S₁₁ **à** `fcible` ; sans elles, elle
  garde le S₁₁ minimal et dit de combien le point désigné résonne à côté.

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

### La correction du gabarit — quatre cas mesurés, une loi pour L, deux strates pour y₀

Le 02 et le 03/10/2026, le même réglage — croisement `L` × `y₀` à `g` = 0,48 ·
largeur de ligne, centré sur ce que le 2,45 GHz avait appris, prolongé quand
l'optimum sortait, puis **une simulation de confirmation** du point
interpolé — sur trois autres cas. Données dans `croisement-patch-2026-10.json`.

| cas | L calcul → réglé | y₀ calcul → réglé | confirmation |
|---|---|---|---|
| FR-4 1,6 mm, **868 MHz** | 83,09 → 80,54 mm | 32,82 → 15,0 mm | 0,8673 GHz · **−61,7 dB** · 49,9 Ω · bande 859,5–875,2 MHz (toute la bande 863–870) · gain réalisé −4,0 dBi, rendement 13 % |
| FR-4 1,6 mm, 2,45 GHz | 29,14 → 27,55 mm | 11,51 → 6,6 mm | 2,4500 GHz · −39,9 dB (étape 2, plus haut) |
| FR-4 1,6 mm, **5,8 GHz** | 11,88 → 10,92 mm | 4,69 → 2,34 mm | 5,7739 GHz · **−35,6 dB** · 51,6 Ω · bande 5,630–5,909 GHz (toute la bande 5,725–5,875) · 4,6 dBi, 66 % |
| **RO4350B 0,762 mm**, 2,45 GHz | 31,84 → 30,74 mm | 12,35 → 11,3 mm | balayage de `y₀` à `L` réglé : −34,3 dB à 11,4 mm, 2,448 GHz |

**La longueur suit une loi, et une seule.** Le raccourcissement que la mesure
ajoute au modèle de cavité vaut 0,463 · √(h/λ₀) à 868 MHz, 0,477 à 2,45 GHz,
0,481 à 5,8 GHz et 0,444 sur RO4350B : un coefficient de 0,466 tient les
quatre cas à **0,2 % de fréquence** près. Le gabarit pose donc
`L = L_cavité · (1 − 0,466·√(h/λ₀))` (`patchCorrLongueur`, 22-antennes.js).

**La résistance de bord dépend du stratifié, pas de la fréquence.** Ramenée de
l'encastrement réglé par cos²(π·y₀/L), elle vaut 0,151, 0,196 et 0,173 fois la
conductance de fente sur FR-4 aux trois fréquences — un même 0,17 à ±13 % —,
et **0,72** sur RO4350B. L'écart suit les pertes (tan δ 0,02 contre 0,0037),
dans le sens attendu : plus de pertes, moins de résistance au bord,
encastrement moins profond. Le gabarit interpole en tan δ entre ces deux
strates et s'y borne (`patchCorrRbord`) ; **c'est une hypothèse à deux
points**, et l'assistant le dit pour tout stratifié qui n'est ni l'un ni
l'autre, en proposant de balayer `y₀`. *À mesurer* : le FR-4 haute fréquence
(tan δ 0,012), qui dira si la droite tient — et un stratifié épais à faibles
pertes (RO4003C 1,524 mm), qui séparera les pertes de l'épaisseur.

**Les encoches** passent à 0,48 fois la largeur de ligne (1,25 à 2 mm pour une
ligne de 3,1 mm gardaient −30 dB). **L'exemple patch** ne reprend plus aucune
cote à la main : il pose le gabarit corrigé.

**Une limite du monde, pas de l'outil** : à 868 MHz, 1,6 mm de FR-4 ne fait
que 0,5 % de λ₀, et le patch n'y rayonne que 13 % de ce qu'il reçoit
(−4 dBi). Il s'adapte parfaitement — il chauffe. Un patch sub-GHz demande un
substrat épais à faibles pertes, ou une autre antenne.

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

*Fait le 03/10/2026, en expérimental*, et **sans** le prolongement hors carte
des points 2 à 4 : le port se pose sur le ruban dessiné, du point
d'alimentation au pied de l'antenne, avec sa résistance de source (`Feed_R`)
qui absorbe l'onde de retour. Il mesure le Z₀ (47,5 Ω sur la ligne du patch,
50,2 calculés) et ramène l'impédance au pied par sa propre propagation.
**Ce qui reste ouvert** : il déplace la résonance du patch de +1 % par rapport
au port localisé (2,476 contre 2,450 GHz). Le suspect est le maillage plus fin
qu'il impose le long du ruban — à vérifier en posant ces mêmes lignes de
maillage sous un port localisé. Tant que ce n'est pas tranché, il reste une
option, pas le défaut.

### L'assistant IA — posé, et ce qu'il lui manque

`js/30-ia.js` et le bouton **✨ IA** : l'**interface de WEB_CAO reprise telle
quelle** — barre de connexion, barre d'état, bulles, puces, manuel local,
cartes d'action, menu du clic droit, Alt+I —, avec deux commandes exécutées en
local (`help` et `verifier`) et, si l'on veut, un modèle de langage qui lit les
mêmes réglages et propose des corrections. Rien ne s'écrit sans un clic, tout
passe par la liste blanche `IA_CHAMPS`, et le banc en éprouve la barrière
(section 9 de `test/banc-interface.js`). Le README le décrit en entier ; ce qui
suit est ce qui reste ouvert.

Faits le 02/10/2026, et décrits au README : la **relecture d'un balayage terminé** (l'optimum est-il au bord de la plage, cote par cote), un **modèle local** compatible OpenAI à côté de Google, et la règle qui relève **une couche déclarée masse sans cuivre** (le dipôle imprimé en géométrie libre).

**1. Les règles locales ne connaissent qu'un motif sur six.** Deux d'entre
elles sont écrites pour le patch : le pas de maillage face à la largeur de
ligne, et l'encastrement `y₀`. Le monopôle, l'IFA, le MIFA et le dipôle n'ont
rien d'équivalent — or chacun a sa cote la moins sûre, et aucune n'est
chiffrée comme celle du patch l'est. *Le travail* : une mesure par motif, comme
le croisement `g` × `y₀` en a fait une. C'est du temps de calcul, pas du code.

Faits le 03/10/2026 : le **contexte porte un balayage terminé en tableau**
(une ligne par point, S₁₁ à la cible compris) ; la **copie de `css/ia.css`
est surveillée** — la CI de WEB_SUITE vérifie que ses 785 lignes communes
restent un début de `commun/ia-assistant.css` de WEB_CAO, un dossier partagé
étant exclu tant que chaque outil doit tourner seul ; et **des formes ajoutées
par-dessus un motif ne retirent plus ses cotes du balayage** — chaque point
repose le motif et recolle les ajouts aux mêmes coordonnées.

**2. Une géométrie entièrement libre ne sait toujours rien d'elle-même.** Pas
de fiche, pas de résonance estimée. Ses formes se balayent (largeur d'un
rectangle, rayon d'un disque…), mais pas « la longueur de l'antenne » : il
faudrait savoir *laquelle* des coordonnées est une cote, c'est-à-dire
reconstruire ce qu'un gabarit sait par construction. Rien à faire de simple ;
c'est l'argument qui fait préférer un motif dès qu'il en existe un — et,
depuis qu'on peut lui ajouter des formes sans perdre ses cotes, de partir d'un
motif même quand l'antenne voulue s'en écarte.

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
* **Un dossier de calcul importé est copié, jamais lu sur place.** Un chemin
  vers une clé USB ou un partage réseau désigne quelque chose qui peut
  disparaître : le projet garderait une référence vers rien. La copie coûte
  le temps d'une copie, une fois, et rend le projet complet. Seuls les
  fichiers d'un dossier de calcul sont pris — `.vtr`, script, journal — et un
  seul niveau de sous-dossier : ce n'est pas une commande « copie ce dossier
  chez moi », c'est un import de calcul.
* **La liste des calculs ne dit pas ce qu'ils valaient.** Elle donne la date,
  le poids et le nombre de fichiers de champ ; elle ne rend pas les courbes
  d'un calcul précédent — `resultats.json` n'en garde qu'un, le dernier.
  Retrouver un S₁₁ d'avant-hier passe toujours par un projet enregistré sous
  un autre nom, ce que le champ du panneau fait en une frappe.
* **La visionneuse de champs montre un PLAN, pas un volume.** Elle découpe
  une tranche de la grille et la colorie ; elle ne fait ni isosurface, ni
  coupe oblique, ni ligne de champ, ni rendu volumique. C'est délibéré : la
  question de tous les jours — « où passe le courant ? » — se répond sur un
  plan, et coder un moteur de rendu volumique dans une page pour le reste
  reviendrait à réécrire ParaView, qui est à côté et qui le fait bien. Ce
  qu'elle apporte, c'est l'immédiateté et le mouvement : deux secondes, aucune
  installation, et une animation qui distingue une onde stationnaire d'une
  onde qui se propage — ce qu'une image figée ne fait pas.
* **Une animation temporelle est échantillonnée.** openEMS écrit un fichier
  par pas de temps, des milliers ; le serveur en garde au plus soixante,
  régulièrement espacés, et réduit la finesse spatiale pour tenir dans un
  budget. Ce qui est montré est juste ; ce n'est pas tout ce qui a été écrit,
  et le pied du panneau l'annonce.
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
* **« Enregistrer » déplace le dossier de calcul, et cela peut prendre du
  temps.** Un calcul lancé avant d'avoir nommé le projet a écrit ses champs
  dans le `TEMP` du système ; l'enregistrement les range dans `calculs/`. Sur
  le même disque, c'est instantané ; d'un disque à l'autre — un projet sur un
  lecteur réseau, un `TEMP` local —, c'est une vraie copie, et plusieurs
  centaines de méga-octets prennent le temps qu'ils prennent. Le panneau
  annonce ce qui sera écrit avant de le faire. Si le déplacement échoue, le
  projet est enregistré quand même et l'outil dit ce qui n'a pas pu suivre :
  perdre les courbes parce que les champs ont résisté serait pire.
* **Le mode conception ne crée pas un second chemin vers le solveur.** Il
  fabrique un document au format exact du parseur et le donne à la même
  fonction de chargement — donc tous les refus de l'assistant valent aussi
  sur une carte dessinée. Toute idée qui contournerait ce passage est à
  refuser d'emblée : ce sont ces refus qui font la valeur de l'outil. Le
  tableau S complet et le balayage croisé suivent la même règle : N documents
  ordinaires, normalisés un par un, refusés comme les autres.
