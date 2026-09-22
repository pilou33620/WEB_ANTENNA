#!/usr/bin/python3
# -*- coding: utf-8 -*-
# ==========================================================================
# VERSIONING
# Version: 1.0.0
# Date: 2026-09-14
# Explication : le document d'antenne, relu et complete.
#
#   Ce module ne simule rien et n'importe pas openEMS. Il prend le document
#   que la page envoie -- un empilage, du cuivre, une boite, un port, une
#   bande de frequence --, il le VERIFIE, il COMPLETE ce que l'utilisateur
#   n'a pas saisi par les regles de l'art du FDTD, et il rend un modele
#   normalise que les deux autres modules consomment tel quel :
#
#       openems_script.py   -> un .py autonome qui refait la simulation
#       openems_run.py      -> le lance vraiment, par les liaisons Python
#
#   POURQUOI IL EST SEPARE, ET POURQUOI IL N'IMPORTE PAS openEMS. L'assistant
#   de la page a besoin de ces valeurs AVANT toute simulation : « ta boite
#   fait 12 mm de marge, il en faudrait 30 », « ton maillage donne 4,2
#   millions de cellules, compte deux heures ». Sur un poste ou les DLL
#   d'openEMS manquent, ce module fonctionne quand meme, et l'outil reste
#   utilisable pour preparer et exporter le script. C'est la meme tolerance
#   que web_antenna.py applique a ses solveurs.
#
# Fonctions : etat, normaliser, ErreurModele
# ==========================================================================
"""Relit et complete un document d'antenne pour openEMS.

    >>> import openems_modele
    >>> m = openems_modele.normaliser(doc)
    >>> m["estimation"]["cellules"]
    412500

Le document d'entree est decrit dans `antenne-openems/README.md`. Tout y est
en millimetres et en hertz -- la page ne convertit rien, c'est ici que les
pouces d'un fichier IPC-2581 en pouces sont ramenes au millimetre.
"""

import copy
import math

# Le document porte des polygones de cuivre : il est plus gros qu'un document
# de ligne de transmission, plus petit qu'un document de chute DC.
MAX_CORPS = 24 * 1024 * 1024

C0 = 299792458.0            # m/s
MU0 = 4e-7 * math.pi
EPS0 = 1.0 / (MU0 * C0 * C0)

# Replis quand le fichier ne dit rien. Ce sont des valeurs de FR-4 ordinaire ;
# elles sont marquees « suppose » dans le modele rendu, et la page les affiche
# comme telles -- une permittivite devinee n'est pas une permittivite mesuree.
ER_DEFAUT = 4.3
DF_DEFAUT = 0.02
EP_CU_DEFAUT = 0.035        # mm, 1 oz
SIGMA_CU = 5.8e7            # S/m

# -- regles de l'art du FDTD ------------------------------------------------
# MARGE D'AIR. Entre la structure rayonnante et la PML il faut de la place :
# la PML absorbe bien les ondes qui la traversent presque normalement, mal le
# champ proche reactif qui l'atteint de biais. Un quart de la longueur d'onde
# LA PLUS BASSE de la bande est la valeur que donnent les exemples d'openEMS
# et la litterature FDTD ; en dessous, l'impedance d'entree derive.
MARGE_LAMBDA = 0.25
# Le maillage : vingt cellules par longueur d'onde dans le milieu le plus
# lent. Dans le dielectrique la longueur d'onde est divisee par racine(er),
# la cellule doit donc l'etre aussi.
CELLULES_PAR_LAMBDA = 20.0
# ... MAIS LAMBDA/20 NE VOIT QUE LA LONGUEUR D'ONDE, ET UNE ANTENNE IMPRIMEE
# n'est pas faite que de longueurs d'onde. Sous un ruban de 3 mm, le champ
# tourne sur la LARGEUR DU RUBAN et sur l'EPAISSEUR DU SUBSTRAT, qui valent
# ici le quart de la cellule que lambda/20 autorise. Le calcul tourne quand
# meme, il ne previent pas, et il rend une antenne qui ne resonne pas : mesure
# faite sur le patch 2,45 GHz de l'exemple, la resonance DISPARAIT a 2,57 mm
# de pas et revient a 0,8 mm, meme geometrie, meme port. Deux bornes de plus,
# donc, prises sur la geometrie et non sur la frequence.
CELLULES_PAR_PISTE = 4.0      # en travers du cuivre le plus etroit
# ET RIEN DE PLUS. L'epaisseur du substrat, elle, ne borne PAS le pas dans le
# plan : le tutoriel de reference d'openEMS (Simple_Patch_Antenna) maille son
# patch a 5 mm sur un substrat de 1,5 mm -- trois fois l'epaisseur -- et rend
# une resonance juste. Une regle liee au substrat mettrait toute carte un peu
# grande a des dizaines de millions de cellules sans rien y gagner.
# JUSQU'OU LA GEOMETRIE A LE DROIT DE RAFFINER. Une carte reelle porte des
# pastilles de 0,2 mm dont personne ne demande le champ : sans borne, la regle
# ci-dessus mettrait la carte entiere a 0,05 mm et le calcul ne finirait
# jamais.
#
# LA BORNE EST UN BUDGET, ET NON UN RAPPORT. Un rapport fixe -- « pas plus de
# huit fois plus fin que lambda/20 » -- parait prudent et ne l'est pas : il
# interdit de resoudre une piste de 1 mm, qui n'a rien d'extraordinaire, tout
# en laissant passer une carte de 300 mm ou le meme rapport fait cent millions
# de cellules. Ce qui coute, c'est le NOMBRE DE LIGNES dans l'emprise du
# cuivre ; c'est donc lui qu'on plafonne. Deux cents lignes par axe, et le
# plancher du pas s'en deduit tout seul, a la taille de la carte.
LIGNES_MAX_EMPRISE = 200.0
# ... MAIS UN PAS UNIQUE SUR TOUTE L'EMPRISE ETAIT LE VRAI COUPABLE. La borne
# ci-dessus ne dit pas « ce cuivre est trop fin pour etre resolu », elle dit
# « raffiner TOUTE la carte a ce pas-la couterait plus de deux cents lignes par
# axe ». Or une piste large de 0,5 mm et longue de 20 ne demande le pas fin
# qu'en TRAVERS d'elle-meme, sur un demi-millimetre : le champ tourne sur la
# largeur du ruban, pas sur sa longueur. D'ou les bandes fines de `_maillage`,
# et les trois constantes qui les bornent.
#
# MARGE_BANDE : de combien de cellules fines la bande depasse le cuivre, de
# chaque cote. Zero marcherait — le lissage rattraperait le fond des la cellule
# suivante —, mais le champ de bord d'un ruban s'etend sur a peu pres
# l'epaisseur du substrat, et deux cellules fines de plus le decrivent pour
# deux lignes par bande.
MARGE_BANDE = 2
# DE COMBIEN ON RECULE quand le budget refuse, et combien d'essais. Reculer
# plus vite ferait manquer le pas juste en dessous du budget ; plus lentement
# construirait des maillages pour rien.
AFFINAGE_RECUL = 1.3
AFFINAGE_ESSAIS = 24
# LE BUDGET DE L'AFFINAGE, EN CELLULES-PAS DE TEMPS (voir `_cout`) : un plafond
# absolu, et un plafond relatif au maillage de fond. Les deux sont
# necessaires. Sans l'absolu, une grande carte s'affinerait jusqu'a la nuit de
# calcul ; sans le relatif, une petite carte dont le fond coute trois minutes
# s'affinerait cent fois — et « affiner le maillage » ne doit pas vouloir dire
# « multiplier la duree par cent » sans que personne l'ait demande.
#
# 5e11 cellules-pas, c'est environ six heures au debit suppose de 25 Mcps, et
# quatre fois le fond. MESURE sur la carte d'essai qui reprend l'empilage
# d'antenna4c (quatre couches, 120 x 55 mm, 868 MHz) : le fond seul coute
# 2,3e11 ; le budget laisse donc l'affinage doubler le prix, pas davantage.
CELLULES_PAS_MAX = 5.0e11
AFFINAGE_COUT_MAX = 4.0
# COMBIEN DE CELLULES EN Z DANS UN DIELECTRIQUE. Une seule ne represente pas le
# champ qui se courbe sous une piste — et c'est ce champ-la qui fait
# l'impedance de la ligne. Trois le font. C'est le nombre que ce module visait
# depuis toujours sans jamais l'atteindre : voir `_maillage`, section z.
CELLULES_PAR_SUBSTRAT = 3
# Le rapport maximal entre deux cellules voisines. Une grille qui passe de
# 0,5 a 2 mm d'un coup reflechit numeriquement sur la marche ; openEMS lisse
# par SmoothMeshLines, et 1,4 est la valeur de ses exemples.
#
# ON PREND DEUX, ET LA RAISON EST CHIFFREE. Les exemples d'openEMS partent
# d'une grille deja presque uniforme : y imposer 1,4 ne coute rien. Ici la
# grille est volontairement contrastee -- fine sur la carte, grossiere dans
# l'air, et le rapport entre les deux vaut sept. Mesure faite sur l'exemple :
# a 1,4 le maillage passe de 340 000 a 3 200 000 cellules, soit neuf fois le
# calcul, pour combler des marches qui sont presque toutes loin de l'antenne.
# A 2,0, plus aucune cellule ne double sa voisine et le surcout est de 1,7.
GRADIENT_MAX = 2.0
# Nombre de couches de PML. Huit est le reglage d'usine d'openEMS et celui de
# tous ses exemples d'antenne ; six suffit parfois, dix ne se justifie que
# pour des structures tres resonantes.
PML_DEFAUT = 8
# Largeur minimale de l'impulsion d'excitation, en fraction de sa frequence
# centrale. Une demi-octave : c'est ce qu'emploient les exemples d'openEMS
# (f0 = 2 GHz, fc = 1 GHz pour le patch). Voir `_bande` pour le pourquoi.
EXCITATION_LARGEUR_MIN = 0.4
# La regle du tiers : au bord d'un conducteur, la ligne de maillage ne se pose
# pas SUR l'arete mais de part et d'autre, a un tiers dehors et deux tiers
# dedans. C'est ce qui rend la densite de courant de bord correcte sans
# raffiner partout. openEMS l'applique par AddEdges2Grid.
TIERS_DEFAUT = True

# Criteres d'arret. -40 dB d'energie residuelle est le reglage courant pour
# une antenne ; -50 dB pour un resonateur a fort Q, au prix du temps.
ENERGIE_DEFAUT = -40.0
NMAX_DEFAUT = 30000
# LE NOMBRE DE PAS SE CALCULE, IL NE SE DEVINE PAS. openEMS refuse de tourner
# si le garde-fou est plus court que TROIS fois l'impulsion d'excitation ; on
# en prend quatre, ce qui laisse a la structure le temps de se vider apres que
# la source s'est tue. Le reste -- s'arreter des que l'energie est tombee --
# est le travail du seuil en decibels, pas celui du compteur.
NMAX_IMPULSIONS = 4.0
# ... MAIS QUATRE IMPULSIONS NE SUFFISENT PAS A UNE ANTENNE QUI RESONNE, et
# c'est une mesure qui l'a dit, pas une crainte. L'impulsion partie, il reste
# l'extinction : une structure resonante rend son energie en exp(-w.t/Q), et
# descendre a -40 dB demande environ 1,5 x Q periodes. Sur le F inverse de
# 2,45 GHz, l'energie n'est tombee sous -40 dB qu'au 39 165e pas, alors que le
# critere d'impulsion seul en proposait 31 125 : le garde-fou aurait coupe le
# calcul AVANT la mesure, et la troncature se serait lue comme une resonance
# floue. On prend donc le plus grand des deux criteres.
#
# QUARANTE PERIODES, ET POURQUOI CE NOMBRE. C'est 1,5 x Q pour un Q charge de
# 27 -- l'ordre de grandeur d'une antenne imprimee adaptee sur FR-4, pertes
# comprises. Le run ci-dessus a demande 35 periodes ; le patch de l'exemple,
# 21. Quarante les couvre tous les deux avec une marge, et ne coute RIEN quand
# le calcul converge : c'est un plafond, pas une consigne -- l'energie arrete
# la simulation bien avant. Il ne coute que dans le seul cas ou l'on veut
# justement qu'il coute : une antenne qui ne s'eteint pas.
NMAX_PERIODES = 40.0
NMAX_PLANCHER = 5000
# CE QUI SEPARE DEUX ARETES DE CUIVRE SANS RIEN SEPARER DU TOUT. Deux bords a
# quelques dizaines de microns l'un de l'autre ne sont pas deux bords : c'est
# le meme, rendu deux fois -- l'arrondi d'un bout de piste, un ruban de 1,00 mm
# qui croise un ruban de 1,02 mm sur le meme axe, deux sommets d'un fichier de
# CAO. Aucun fabricant ne tient cette difference-la, et aucune onde ne la voit.
# Le maillage, lui, la paie plein tarif : chaque bord pose ses lignes au tiers,
# et deux bords presque confondus en posent quatre au lieu de deux, dont deux
# se touchent. La cellule minuscule qui en resulte commande le pas de temps de
# TOUT le domaine -- mesure faite sur l'IFA du gabarit : 3,26 millions de
# cellules et 3 h 25 au lieu de 820 000 et vingt minutes, pour la meme antenne.
# CES RELEVES DATENT DE L'IFA D'AVANT : le gabarit tirait alors ses cotes d'une
# note d'application, il les calcule desormais des proportions classiques du
# motif. Les nombres ne se reproduisent donc plus tels quels ; ce qu'ils
# montrent -- deux aretes presque confondues paient plein tarif -- ne depend
# d'aucune cote.
EPS_ARETES_MM = 0.05
# CE QU'UN VERNIS COUTE, ET CE QU'IL APPORTE. Un fichier IPC-2581 declare son
# masque de soudure dans l'empilage comme n'importe quelle autre couche : sur
# antenna4c.xml, « Resist-A » et « Resist-B », 15 microns de resine de part et
# d'autre de la carte. Ces deux couches-la ne sont pas ENTRE les conducteurs,
# elles sont DEHORS, posees sur le cuivre exterieur. Ce qu'elles ajoutent est
# du SECOND ORDRE : une permittivite posee sur un vingt-cinquieme de la hauteur
# du substrat, la ou le champ d'un microruban est deja sorti du dielectrique --
# de quoi abaisser la resonance de l'ordre du pour-cent, pas de quoi la
# deplacer. (Cet ordre de grandeur-la n'est PAS mesure ici ; ce qui suit l'est.)
#
# LE MAILLAGE, LUI, LES PAIE AU PRIX DU PAS DE TEMPS. Les deux faces d'une
# couche de l'empilage portent chacune une ligne OBLIGATOIRE -- sans quoi le
# substrat glisse, et un substrat qui glisse n'est plus le meme substrat --,
# donc 15 microns entre deux lignes font une cellule QUARANTE fois plus fine
# que le pas vise sur la carte ci-dessous (0,599 mm). Comme le pas de temps FDTD est commande par la
# plus petite cellule de TOUT le domaine, ces 30 microns de resine coutent un
# facteur HUIT sur la duree du calcul. MESURE FAITE sur une carte d'essai qui
# reprend l'empilage d'antenna4c.xml -- quatre couches, 120 x 55 mm, bande
# centree sur 868 MHz, quatre millions de cellules : pas de temps 0,0497 ps
# avec les deux vernis, 0,404 ps sans eux, duree annoncee 21 h contre 2 h 30.
# Le maillage, lui, ne perd que cent mille cellules sur quatre millions --
# ce n'est pas une economie de memoire, c'est le pas de temps et rien d'autre.
#
# UN REVETEMENT EXTERIEUR PLUS FIN QUE CETTE BORNE N'ENTRE DONC PAS DANS LA
# GEOMETRIE. Il n'est pas efface en silence : le modele le nomme dans
# `revetements`, un avis le dit, et la page laisse le remettre d'une case a
# cocher -- un radome mince ou un coverlay de flex peuvent compter, et c'est
# a l'utilisateur d'en decider. CE QUI EST ENTRE DEUX CONDUCTEURS N'EST JAMAIS
# ECARTE, si mince soit-il : c'est un substrat, il porte le champ, et le
# supprimer collerait deux couches de cuivre l'une sur l'autre.
EP_REVETEMENT_MM = 0.05

# -- pertes dielectriques ---------------------------------------------------
# DEUX FACONS DE DECRIRE UN DIELECTRIQUE A PERTES, ET ELLES NE SE VALENT PAS.
#
#   « kappa » -- une conductivite equivalente, kappa = 2.pi.f.eps0.er.tan(d).
#       C'est ce qu'openEMS accepte directement, et c'est JUSTE A UNE SEULE
#       FREQUENCE : celle ou on la calcule. Ailleurs, tan(d) varie comme 1/f,
#       alors que le FR-4 reel garde un tan(d) a peu pres constant. Sur une
#       bande de plus ou moins dix pour cent l'erreur reste sous le pour-cent ;
#       sur une octave elle depasse la moitie de la valeur.
#
#   « debye » -- une somme de poles de relaxation :
#           eps(w) = eps_inf + somme_p  d_eps_p / (1 + j.w.tau_p)
#       Avec des tau repartis uniformement EN LOGARITHME et un d_eps identique
#       sur chacun, la somme approche la distribution continue de
#       Djordjevic-Sarkar, dont la tangente de pertes est plate. C'est le
#       comportement d'un stratifie reel.
DEBYE_DECADES = 1.5          # de combien on deborde la bande, de chaque cote
DEBYE_POLES_PAR_DECADE = 3
DEBYE_POLES_MIN = 3
DEBYE_POLES_MAX = 8
# openEMS IGNORE EN SILENCE un pole dont le temps de relaxation ne depasse pas
# DEUX PAS DE TEMPS : `if ((C_L[n]>0) && (t_relax>0) && (t_relax>2.0*dT))`,
# dans FDTD/extensions/operator_ext_lorentzmaterial.cpp. En dessous, le pole
# est simplement saute -- le calcul tourne, et le materiau n'a pas les pertes
# qu'on croit. On garde une marge de trois pas, et on le DIT quand la borne
# mord.
DEBYE_TAU_SUR_DT = 3.0

# Une cellule FDTD coute, en gros, 6 composantes de champ x 4 octets, plus les
# coefficients de mise a jour -- openEMS tourne autour de 100 octets par
# cellule en simple precision avec materiaux constants par cellule.
OCTETS_PAR_CELLULE = 100.0
# Debit typique d'openEMS sur un poste de travail recent, en millions de
# cellules-pas de temps par seconde. Sert UNIQUEMENT a donner un ordre de
# grandeur de la duree ; il est annonce comme tel. C'est la valeur DE DEPART :
# tant qu'aucun calcul n'a fini sur ce poste, on n'a que la supposition.
MCPS = 25.0

# ==========================================================================
# Le debit mesure
# --------------------------------------------------------------------------
# POURQUOI SUPPOSER QUAND ON PEUT MESURER. openEMS ecrit lui-meme sa vitesse a
# chaque ligne d'avancement : « Speed: 7.1 MC/s ». Le premier calcul termine
# donne donc le debit REEL de la machine, et toutes les annonces suivantes
# peuvent s'y caler. L'ecart n'est pas academique : entre le portable a quatre
# fils et la station a trente-deux, il y a un facteur cinq, et c'est sur un
# balayage — la duree multipliee par le nombre de points — qu'il se paie.
#
# POURQUOI LA MEDIANE DE PLUSIEURS, ET NON LE DERNIER. Le debit d'un calcul
# n'est pas seulement celui du processeur : un petit maillage qui tient dans
# le cache va plus vite par cellule qu'un gros, et une machine occupee a
# autre chose va moins vite qu'une machine libre. Un seul nombre retenu tel
# quel ferait donc suivre l'annonce aux hasards de la derniere fois. La
# mediane des derniers calculs encaisse l'un et l'autre, et suit quand meme
# le poste s'il change.
#
# CE QUI N'EST PAS RETENU : une valeur hors des bornes du plausible. Une
# ligne mal lue, un journal tronque, un « Speed: 0.0 » du tout premier
# rapport avant que le calcul ait commence — les prendre ferait annoncer des
# heures pour une minute, et une annonce absurde use plus la confiance qu'une
# annonce approchee.
MCPS_MIN = 0.05
MCPS_MAX = 5000.0
MCPS_GARDE = 5                       # combien de calculs entrent dans la mediane

_MCPS_VUS = []


def noter_debit(mcps):
    """Retient le debit d'un calcul termine. Rend le debit retenu, ou None."""
    try:
        v = float(mcps)
    except (TypeError, ValueError):
        return debit_mesure()
    if not (MCPS_MIN <= v <= MCPS_MAX):
        return debit_mesure()
    _MCPS_VUS.append(v)
    del _MCPS_VUS[:-MCPS_GARDE]
    return debit_mesure()


def oublier_debit():
    """Repart de la valeur supposee. Le banc d'essai s'en sert ; rien d'autre."""
    del _MCPS_VUS[:]


def debit_mesure():
    """La mediane des derniers calculs, ou None si aucun n'a encore fini."""
    if not _MCPS_VUS:
        return None
    t = sorted(_MCPS_VUS)
    n = len(t)
    return t[n // 2] if n % 2 else 0.5 * (t[n // 2 - 1] + t[n // 2])


def debit_n():
    """Sur combien de calculs la mediane porte."""
    return len(_MCPS_VUS)


def debit_suppose():
    """Le debit sur lequel les durees sont annoncees."""
    return debit_mesure() or MCPS


class ErreurModele(Exception):
    """Refus explicite : message lisible + ce qu'il faut changer."""

    def __init__(self, message, conseil=""):
        super().__init__(message)
        self.message = message
        self.conseil = conseil


def etat():
    """Ce que ce module sait faire. La page l'interroge au demarrage."""
    return {
        "dispo": True,
        "version": "1.0.0",
        "max": MAX_CORPS,
        "regles": {
            "marge_lambda": MARGE_LAMBDA,
            "cellules_par_lambda": CELLULES_PAR_LAMBDA,
            "pml": PML_DEFAUT,
            "er_defaut": ER_DEFAUT,
            "df_defaut": DF_DEFAUT,
        },
    }


# ==========================================================================
# Lecture defensive du document
# ==========================================================================

def _nb(valeur, defaut=0.0):
    """Un nombre fini, ou le repli. JSON venu d'un champ de saisie : tout
    peut arriver, y compris "1,6" avec une virgule et "" tout court."""
    if valeur is None:
        return defaut
    if isinstance(valeur, str):
        valeur = valeur.strip().replace(",", ".")
        if not valeur:
            return defaut
    try:
        v = float(valeur)
    except (TypeError, ValueError):
        return defaut
    if not math.isfinite(v):
        return defaut
    return v


def _nb_pos(valeur, defaut=0.0):
    v = _nb(valeur, defaut)
    return v if v > 0 else defaut


def _texte(valeur, maxi=120):
    if valeur is None:
        return ""
    return str(valeur)[:maxi]


def _dict(valeur):
    return valeur if isinstance(valeur, dict) else {}


def _liste(valeur):
    return valeur if isinstance(valeur, list) else []


def _polyligne(plat):
    """[x1,y1,x2,y2,...] -> [(x,y), ...]. C'est la forme que produit
    ipc2581_json et que la page transmet sans la retoucher."""
    pts = []
    if isinstance(plat, list) and plat and isinstance(plat[0], (list, tuple)):
        for p in plat:                       # deja par couples
            if len(p) >= 2:
                x, y = _nb(p[0]), _nb(p[1])
                pts.append((x, y))
    else:
        plat = _liste(plat)
        for i in range(0, len(plat) - 1, 2):
            pts.append((_nb(plat[i]), _nb(plat[i + 1])))
    # Un polygone ferme explicitement repete son premier point : openEMS le
    # referme lui-meme, et le doublon fait une arete de longueur nulle.
    while len(pts) >= 2 and pts[0] == pts[-1]:
        pts.pop()
    return pts


def _aire(pts):
    """Aire algebrique (formule du lacet). Le signe dit le sens de parcours."""
    a = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return a / 2.0


def _sens(pts, horaire=False):
    """Force le sens de parcours. openEMS ne l'exige pas pour AddLinPoly,
    mais un contour et ses trous parcourus dans le meme sens se dessinent
    mal des qu'on les rend a une bibliotheque geometrique, et la page 3D en
    fait des `THREE.Shape` ou le sens decide de ce qui est plein."""
    if len(pts) < 3:
        return pts
    # `(a < 0)` dit « ce polygone est parcouru dans le sens horaire ». Il ne
    # faut le retourner que si ce n'est PAS le sens demande.
    if (_aire(pts) < 0) == bool(horaire):
        return pts
    return list(reversed(pts))


# ==========================================================================
# L'empilage : du tableau de couches aux cotes en z
# ==========================================================================

def _empilage(doc, k_mm, modele_cu):
    """Conducteurs et dielectriques, ranges du bas vers le haut, en mm.

    La page envoie l'empilage dans l'ordre physique du fichier -- sequence 1
    en premier, c'est-a-dire le DESSUS. On le retourne ici une fois pour
    toutes : dans tout ce qui suit, z croit vers le haut et z = 0 est la face
    inferieure du cuivre du dessous. Une simulation dont le repere est
    retourne par rapport a la carte est une source d'erreurs sans fin quand
    vient le moment de placer un port.

    L'EPAISSEUR DU CUIVRE NE COMPTE PAS DANS L'EMPILAGE, SAUF SI ON LE
    DEMANDE. 35 microns de cuivre entre deux lignes de maillage, c'est une
    cellule quarante fois plus fine que le pas vise -- et comme le pas de
    temps FDTD est commande par la plus petite cellule du domaine, c'est la
    simulation ENTIERE qui devient quarante fois plus longue, pour modeliser
    une epaisseur que le courant ne voit pas : a 2,4 GHz l'epaisseur de peau
    dans le cuivre fait 1,3 micron. Les deux modes sans epaisseur posent donc
    le conducteur sur un PLAN, et les 35 microns ne servent plus qu'a calculer
    ses pertes ohmiques (mode « feuille »). Le mode « volume » existe pour les
    cas ou la geometrie de la tranche compte vraiment -- une fente etroite, un
    couplage par le flanc --, et il annonce son prix.
    """
    pile = _liste(_dict(doc).get("empilage"))
    if not pile:
        raise ErreurModele(
            "Empilage absent du document.",
            "Ouvrez le panneau « Empilage » et completez au moins une couche "
            "de cuivre et le dielectrique qui la porte.")

    # Ordre du fichier : sequence croissante = du dessus vers le dessous.
    entrees = []
    for rang, e in enumerate(pile):
        e = _dict(e)
        entrees.append({
            "nom": _texte(e.get("nom")) or ("couche %d" % (rang + 1)),
            "cuivre": bool(e.get("cuivre")),
            "ep": _nb_pos(e.get("ep"), 0.0) * k_mm,
            "er": _nb_pos(e.get("er"), 0.0),
            "df": max(0.0, _nb(e.get("df"), 0.0)),
            "role": _texte(e.get("role"), 20),
            "seq": _nb(e.get("seq"), rang),
            # La conductivite du conducteur, quand le document la porte. Elle
            # n'arrive que du mode conception : un fichier IPC-2581 ne declare
            # pas de quel metal est sa couche, et le cuivre est alors le seul
            # repli raisonnable. Une antenne serigraphiee a l'encre argent est
            # dix fois plus resistive que du cuivre, et cela se lit sur le
            # rendement -- pas sur le S11, qui reste beau.
            "sigma": _nb_pos(e.get("sigma"), 0.0),
            # Ce que la page a decide d'un revetement exterieur : None quand
            # elle n'a rien dit, et c'est alors la borne qui tranche. Un
            # booleen plutot qu'un defaut recopie ici : recopier le defaut
            # rendrait un choix indistinguable d'un silence.
            "garder": (None if e.get("garder") is None
                       else bool(e.get("garder"))),
            "ecarte": False,
        })
    entrees.sort(key=lambda e: e["seq"])
    entrees.reverse()                        # du bas vers le haut

    # -- les revetements exterieurs, ecartes par defaut ---------------------
    # Voir EP_REVETEMENT_MM : un vernis de 15 microns pose SUR le cuivre
    # exterieur ne porte pas de champ de ligne, mais ses deux faces portent
    # deux lignes de maillage obligatoires, et la cellule qui en resulte
    # commande le pas de temps de toute la simulation. « Exterieur » se lit
    # sur l'empilage et non sur le nom de la couche : est exterieur ce qui
    # n'est pas entre les deux cuivres extremes. Un fichier qui nomme son
    # masque « L9 » est traite comme celui qui le nomme « Resist-A ».
    rangs_cu = [i for i, e in enumerate(entrees) if e["cuivre"]]
    revetements = []
    if rangs_cu:
        for i, e in enumerate(entrees):
            if e["cuivre"] or rangs_cu[0] < i < rangs_cu[-1]:
                continue
            # La page a tranche, ou elle n'a rien dit et la borne tranche.
            garder = e["garder"]
            if garder is None:
                garder = e["ep"] > EP_REVETEMENT_MM
            e["ecarte"] = not garder
            revetements.append({
                "nom": e["nom"], "ep": e["ep"],
                "er": e["er"], "df": e["df"],
                "garde": bool(garder),
                # « choisi » dit si le OUI ou le NON vient de l'utilisateur ou
                # de la borne : la page n'affiche pas les deux pareil, et un
                # defaut qu'on prend pour un choix est un defaut qu'on ne
                # rediscute jamais.
                "choisi": e["garder"] is not None,
            })

    conducteurs, dielectriques = [], []
    z = 0.0
    supposes = []
    volume = (modele_cu == "volume")
    for e in entrees:
        if e.get("ecarte"):
            continue
        if e["cuivre"]:
            ep = e["ep"] or EP_CU_DEFAUT
            if not e["ep"]:
                supposes.append("epaisseur de « %s » (%.3f mm)" % (e["nom"], ep))
            conducteurs.append({
                "nom": e["nom"],
                "z0": z, "z1": z + (ep if volume else 0.0),
                # `ep` reste l'epaisseur PHYSIQUE meme quand la geometrie est
                # plate : le mode « feuille » en a besoin pour la resistance
                # de surface, et la fiche l'affiche.
                "ep": ep, "ep_geo": ep if volume else 0.0,
                "sigma": e["sigma"] or SIGMA_CU,
                "role": e["role"] or "signal",
            })
            if volume:
                z += ep
        else:
            ep = e["ep"]
            if ep <= 0:
                # Un intervalle d'epaisseur nulle n'est pas un intervalle :
                # deux conducteurs colles court-circuitent la carte entiere.
                raise ErreurModele(
                    "Le dielectrique « %s » n'a pas d'epaisseur." % e["nom"],
                    "Saisissez-la dans le panneau « Empilage » : le fichier "
                    "IPC-2581 ne la declare pas toujours.")
            er = e["er"] or ER_DEFAUT
            df = e["df"] if e["df"] > 0 else DF_DEFAUT
            if not e["er"]:
                supposes.append("permittivite de « %s » (%.2f)" % (e["nom"], er))
            if not e["df"]:
                supposes.append("tangente de pertes de « %s » (%.3f)" % (e["nom"], df))
            dielectriques.append({
                "nom": e["nom"], "z0": z, "z1": z + ep, "ep": ep,
                "er": er, "df": df,
            })
            z += ep

    if not conducteurs:
        raise ErreurModele(
            "Aucune couche de cuivre dans l'empilage.",
            "Une antenne est faite de cuivre : cochez au moins une couche.")

    return conducteurs, dielectriques, z, supposes, revetements


def _conducteur(conducteurs, nom):
    for c in conducteurs:
        if c["nom"] == nom:
            return c
    return None


# ==========================================================================
# Le cuivre
# ==========================================================================

def _cuivre(doc, conducteurs, k_mm):
    """Les polygones designes, ranges par couche, avec leurs cotes en z.

    La page envoie ce qu'elle a extrait du modele IPC-2581 : un tableau par
    couche, chaque polygone sous la forme {"o": contour, "t": [trous]} --
    exactement la forme que ipc2581_json donne aux versements de cuivre.
    """
    out = []
    boite = None
    total = 0
    for bloc in _liste(_dict(doc).get("cuivre")):
        bloc = _dict(bloc)
        nom = _texte(bloc.get("couche"))
        cond = _conducteur(conducteurs, nom)
        if cond is None:
            raise ErreurModele(
                "Le cuivre designe est sur « %s », qui n'est pas dans "
                "l'empilage." % (nom or "(sans nom)"),
                "Cochez cette couche dans le panneau « Empilage », ou "
                "retirez-la de la selection.")
        polys = []
        for p in _liste(bloc.get("polys")):
            p = _dict(p)
            o = _sens(_polyligne(p.get("o")), horaire=False)
            if len(o) < 3:
                continue
            trous = []
            for t in _liste(p.get("t")):
                tp = _sens(_polyligne(t), horaire=True)
                if len(tp) >= 3:
                    trous.append(tp)
            polys.append({"o": o, "t": trous})
            total += 1
            for x, y in o:
                x *= k_mm
                y *= k_mm
                if boite is None:
                    boite = [x, y, x, y]
                else:
                    boite[0] = min(boite[0], x)
                    boite[1] = min(boite[1], y)
                    boite[2] = max(boite[2], x)
                    boite[3] = max(boite[3], y)
        if not polys:
            continue
        # Mise a l'echelle apres le calcul de la boite : les deux parcourent
        # les memes points, autant ne les parcourir qu'une fois.
        if k_mm != 1.0:
            for p in polys:
                p["o"] = [(x * k_mm, y * k_mm) for x, y in p["o"]]
                p["t"] = [[(x * k_mm, y * k_mm) for x, y in t] for t in p["t"]]
        out.append({
            "couche": nom, "z0": cond["z0"], "z1": cond["z1"],
            "ep": cond["ep"], "ep_geo": cond["ep_geo"],
            "sigma": cond["sigma"], "role": cond["role"], "polys": polys,
        })

    if not out:
        raise ErreurModele(
            "Aucun cuivre dans la selection.",
            "Designez l'antenne sur la carte : cliquez son net, ou "
            "Ctrl+clic pour en prendre plusieurs.")
    return out, boite, total


def _vias(doc, conducteurs, k_mm):
    """Les tubes metallises qui relient deux couches.

    Un via est modelise par un CYLINDRE PLEIN et non par un tube creux, et
    c'est un choix, pas un oubli : a ces frequences l'epaisseur de peau est
    de quelques microns, le courant ne voit pas la difference, et un tube
    creux demanderait deux cellules dans l'epaisseur de la metallisation --
    soit un maillage dix fois plus fin pour rien.
    """
    out = []
    for v in _liste(_dict(doc).get("vias")):
        v = _dict(v)
        r = _nb_pos(v.get("d"), 0.0) * k_mm / 2.0 or _nb_pos(v.get("r"), 0.0) * k_mm
        if r <= 0:
            continue
        ca = _conducteur(conducteurs, _texte(v.get("de")))
        cb = _conducteur(conducteurs, _texte(v.get("a")))
        if ca is None or cb is None:
            # Portee non declaree, ou couche hors empilage : le via traverse.
            ca, cb = conducteurs[0], conducteurs[-1]
        z0 = min(ca["z0"], cb["z0"])
        z1 = max(ca["z1"], cb["z1"])
        out.append({"x": _nb(v.get("x")) * k_mm, "y": _nb(v.get("y")) * k_mm,
                    "r": r, "z0": z0, "z1": z1,
                    "de": ca["nom"], "a": cb["nom"]})
    return out


# ==========================================================================
# Le port d'excitation
# ==========================================================================

# ==========================================================================
# Les objets qui ne sont pas sur la carte
# ==========================================================================
# UNE ANTENNE NE RAYONNE JAMAIS TOUTE SEULE. Elle est dans un boitier, au
# dessus d'une batterie, a cote d'un ecran, au bout d'un cable. Le fichier
# IPC-2581 ne dit rien de tout cela -- il decrit une carte, pas un produit --
# et une simulation qui l'ignore rend un diagramme de rayonnement propre et
# faux. Ces primitives-la comblent le trou : elles se saisissent a la main,
# en coordonnees, et elles entrent dans le maillage comme le reste.
#
# CE QU'ELLES NE SONT PAS : un editeur 3D. Quatre formes, des nombres, et la
# vue 3D pour verifier. Dessiner une piece mecanique demande un outil de
# mecanique, et l'importer demanderait un lecteur de STEP.
PRIMITIVES = ("fil", "cylindre", "boite", "sphere")


def _xyz(valeur, k_mm, defaut=(0.0, 0.0, 0.0)):
    v = _liste(valeur)
    if len(v) < 3:
        return tuple(x * k_mm for x in defaut)
    return (_nb(v[0]) * k_mm, _nb(v[1]) * k_mm, _nb(v[2]) * k_mm)


def _primitives(doc, k_mm):
    """Les objets hors carte, verifies et ramenes au millimetre."""
    out = []
    for i, p in enumerate(_liste(_dict(doc).get("primitives"))):
        p = _dict(p)
        genre = (_texte(p.get("type"), 12) or "").lower()
        if genre not in PRIMITIVES:
            raise ErreurModele(
                "Objet %d : type « %s » inconnu." % (i + 1, genre),
                "Les formes possibles sont : " + ", ".join(PRIMITIVES) + ".")
        nom = _texte(p.get("nom"), 40) or ("objet %d" % (i + 1))

        mat = (_texte(p.get("materiau"), 14) or "metal").lower()
        if mat not in ("metal", "dielectrique"):
            mat = "metal"
        er = _nb_pos(p.get("er"), 0.0) or ER_DEFAUT
        df = max(0.0, _nb(p.get("df"), 0.0))

        o = {"nom": nom, "type": genre, "materiau": mat,
             "er": er, "df": df,
             "priorite": int(_nb(p.get("priorite"), 20))}

        if genre == "fil":
            pts = [_xyz(q, k_mm) for q in _liste(p.get("pts"))]
            if len(pts) < 2:
                raise ErreurModele(
                    "Le fil « %s » n'a qu'un point." % nom,
                    "Un fil est une polyligne : il lui faut au moins deux "
                    "sommets.")
            r = _nb_pos(p.get("r"), 0.0) * k_mm
            if r <= 0:
                raise ErreurModele(
                    "Le fil « %s » n'a pas de rayon." % nom,
                    "Un fil sans epaisseur n'existe pas pour le maillage : "
                    "donnez-lui son rayon reel (0,5 mm pour un fil de 1 mm "
                    "de diametre).")
            o["pts"] = pts
            o["r"] = r
        elif genre == "cylindre":
            o["a"] = _xyz(p.get("a"), k_mm)
            o["b"] = _xyz(p.get("b"), k_mm)
            o["r"] = _nb_pos(p.get("r"), 0.0) * k_mm
            if o["r"] <= 0:
                raise ErreurModele("Le cylindre « %s » n'a pas de rayon." % nom)
            if o["a"] == o["b"]:
                raise ErreurModele(
                    "Le cylindre « %s » a ses deux extremites au meme point."
                    % nom, "Il serait d'epaisseur nulle.")
        elif genre == "boite":
            a, b = _xyz(p.get("a"), k_mm), _xyz(p.get("b"), k_mm)
            o["a"] = tuple(min(a[k], b[k]) for k in range(3))
            o["b"] = tuple(max(a[k], b[k]) for k in range(3))
            # Une boite plate est LEGITIME -- c'est ainsi qu'on pose un plan
            # reflecteur. Une boite nulle sur DEUX axes ne decrit rien.
            plats = sum(1 for k in range(3) if o["b"][k] - o["a"][k] <= 0)
            if plats >= 2:
                raise ErreurModele(
                    "La boite « %s » est degeneree : elle est plate sur %d "
                    "axes." % (nom, plats),
                    "Une boite plate sur UN axe decrit un plan, et c'est "
                    "accepte ; sur deux, il ne reste qu'un segment.")
        else:                                            # sphere
            o["c"] = _xyz(p.get("c"), k_mm)
            o["r"] = _nb_pos(p.get("r"), 0.0) * k_mm
            if o["r"] <= 0:
                raise ErreurModele("La sphere « %s » n'a pas de rayon." % nom)
        out.append(o)
    return out


def _emprise_primitive(o):
    """La boite englobante d'un objet, pour le cadrage et le maillage."""
    if o["type"] == "fil":
        xs = [q[0] for q in o["pts"]]
        ys = [q[1] for q in o["pts"]]
        zs = [q[2] for q in o["pts"]]
        r = o["r"]
        return (min(xs) - r, min(ys) - r, min(zs) - r,
                max(xs) + r, max(ys) + r, max(zs) + r)
    if o["type"] == "cylindre":
        r = o["r"]
        return (min(o["a"][0], o["b"][0]) - r, min(o["a"][1], o["b"][1]) - r,
                min(o["a"][2], o["b"][2]) - r,
                max(o["a"][0], o["b"][0]) + r, max(o["a"][1], o["b"][1]) + r,
                max(o["a"][2], o["b"][2]) + r)
    if o["type"] == "boite":
        return (o["a"][0], o["a"][1], o["a"][2],
                o["b"][0], o["b"][1], o["b"][2])
    r = o["r"]
    return (o["c"][0] - r, o["c"][1] - r, o["c"][2] - r,
            o["c"][0] + r, o["c"][1] + r, o["c"][2] + r)


# ==========================================================================
# Les ports d'excitation
# ==========================================================================
# COMBIEN DE PORTS, ET POURQUOI PLUSIEURS. Un seul port donne le S11 : ce que
# l'antenne renvoie a son alimentation. Deux ports donnent en plus le S21 --
# ce qui passe de l'un a l'autre -- et c'est la seule grandeur qui reponde a
# la question « ces deux antennes se genent-elles ? ». Elle ne se deduit
# d'aucun S11, et elle decide pourtant du sort d'un produit a deux antennes :
# deux brins a 15 dB d'isolation partagent leur puissance au lieu de la
# rayonner, et le diagramme de chacun devient celui de l'ensemble.
#
# UN SEUL PORT EXCITE A LA FOIS, ET CE N'EST PAS UNE LIMITE TECHNIQUE. openEMS
# accepte plusieurs excitations simultanees ; mais leurs ondes se superposent
# alors dans la boite, et aucun parametre S ne se deduit plus de ce melange --
# S21 est par definition « ce qui sort en 2 QUAND SEUL 1 excite ». Ce qu'une
# simulation rend, c'est donc UNE COLONNE du tableau S, celle du port excite ;
# l'autre colonne demande une seconde simulation, excitation deplacee.
MAX_PORTS = 8

# -- le port coaxial --------------------------------------------------------
# `AddCoaxialPort` EXISTE DANS L'INTERFACE MATLAB D'openEMS, PAS DANS LES
# LIAISONS PYTHON 0.0.36 : openEMS/python/openEMS/ports.py n'y definit que
# LumpedPort, MSLPort, WaveguidePort et RectWGPort. Un port coaxial se
# construit donc ici a la main, et il est fait de quatre choses :
#
#   1. l'ame -- un cylindre plein de rayon a, qui traverse la carte et vient
#      toucher la couche de l'antenne ;
#   2. la gaine -- un tube de rayon interieur b, qui vient toucher le plan de
#      masse et s'arrete la ;
#   3. le dielectrique du cable entre les deux, de permittivite er_c ;
#   4. les DEGAGEMENTS -- un disque de rayon b perce dans chaque couche de
#      cuivre que l'ame traverse, sauf celle a laquelle elle se raccorde.
#      Sans eux l'ame touche le plan de masse : le port est court-circuite,
#      le S11 vaut 0 dB, et rien dans le resultat ne dit pourquoi.
#
# L'EXCITATION ET LA MESURE NE SE RESSEMBLENT PAS, ET C'EST LA TOUT LE SUJET.
#
#   L'EXCITATION est approchee : une CROIX de quatre bras radiaux au bout du
#   troncon -- +x, -x, +y, -y --, chacun portant une source de champ E dirigee
#   vers l'exterieur et une resistance de 4.Z0 (quatre en parallele font Z0).
#   Ce n'est pas le profil exact du mode TEM, qui est continu sur toute la
#   couronne. Cela n'a aucune importance : tout ce qui n'est pas TEM dans un
#   coaxial est EVANESCENT en dessous du premier mode superieur, et ce mode-la
#   (TE11) coupe vers c/(pi.(a+b).racine(er)) -- 25 GHz pour une SMA. Ce qui
#   n'est pas TEM meurt donc en quelques cellules, bien avant le plan de
#   mesure.
#
#   LA MESURE, elle, est exacte, et c'est pour cela qu'on ne pouvait pas se
#   contenter d'un port localise : la sonde de courant d'un `LumpedPort` est
#   un segment place dans le plan PERPENDICULAIRE a l'excitation. Radiale
#   ici, elle ne peut par construction pas encercler l'ame -- le courant
#   axial du coaxial ne traverse jamais sa surface, et l'impedance rendue
#   n'aurait aucun rapport avec celle de la ligne. Le port est donc bati sur
#   la classe `Port` de base d'openEMS, avec ses propres sondes :
#
#     - la TENSION : l'integrale de E le long d'un rayon, de l'ame a la gaine,
#       dans un plan de mesure a mi-troncon ;
#     - le COURANT : l'integrale de H sur une BOUCLE FERMEE autour de l'ame,
#       dans le meme plan. Deux boucles en fait, une de chaque cote du plan,
#       dont on prend la moyenne : dans une grille de Yee, E et H ne vivent
#       pas au meme endroit, et ne pas le corriger biaise l'impedance d'une
#       demi-cellule de ligne.
#
# Le plan de mesure est donc a mi-troncon, et les S sont ramenes a la SURFACE
# DE LA CARTE par un deport de plan de reference -- beta = 2.pi.f.racine(er)/c,
# exact pour un mode TEM, qui n'est pas disperse.
COAX_RA = 0.635             # mm, rayon de l'ame d'une SMA (1,27 mm de diametre)
COAX_RB = 2.05              # mm, rayon interieur de la gaine
COAX_ER = 2.05              # PTFE
COAX_EP = 0.3               # mm, epaisseur de la gaine
COAX_LONGUEUR = 3.0         # mm, troncon modelise sous la carte


def _coax_z0(ra, rb, er):
    """Impedance caracteristique d'un coaxial : 60/racine(er) . ln(b/a).

    C'EST LE CHIFFRE QUI PIEGE. Un connecteur dessine « a peu pres » ne fait
    pas 50 ohms, et une ligne d'alimentation qui n'a pas l'impedance du port
    ajoute sa propre desadaptation a celle de l'antenne : on croit corriger
    l'antenne alors qu'on corrige le cable.
    """
    if ra <= 0 or rb <= ra or er <= 0:
        return 0.0
    return 59.9585 / math.sqrt(er) * math.log(rb / ra)


def _port_volume_localise(p, ca, cb, direction, x, y, w, l, k_mm):
    """Le petit volume d'un port localise, entre deux conducteurs.

    LE PORT EST UNE LIGNE, PAS UNE BOITE, ET CE N'EST PAS UN DETAIL DE STYLE.
    openEMS mesure le courant du port en integrant H sur une SURFACE qui est
    toute l'empreinte du port, prise a mi-hauteur (voir `LumpedPort.__init__`
    dans openEMS/ports.py). Donner a cette empreinte la largeur du ruban
    revient a y compter, en plus du courant du port, le courant de deplacement
    qui traverse le dielectrique sous le ruban -- lequel n'est pas du courant
    de port. L'impedance d'entree qui en sort n'est plus celle de l'antenne.
    Mesure faite sur le patch 2,45 GHz de l'exemple : avec une empreinte de
    1,56 x 3,11 mm la resonance n'apparait pas du tout ; avec la ligne
    ci-dessous, a maillage et geometrie identiques, elle revient. C'est aussi
    la forme qu'emploient tous les exemples d'openEMS.

    `w` et `l` ne sont donc plus la taille de la source : ils restent la
    trace de ce que l'utilisateur a designe, et 15-overlay2d.js continue de
    les dessiner. Ce qui part au solveur est la ligne qui joint les deux
    conducteurs au point du port.
    """
    if direction == "z":
        # Entre la face superieure du conducteur du bas et la face
        # inferieure de celui du haut : le port occupe le dielectrique, pas
        # le metal. Un port qui mord dans le cuivre est court-circuite.
        haut, bas = (ca, cb) if ca["z0"] > cb["z0"] else (cb, ca)
        z0, z1 = bas["z1"], haut["z0"]
        if z1 - z0 <= 0:
            raise ErreurModele(
                "Les deux couches du port se touchent : hauteur nulle.",
                "Verifiez l'epaisseur du dielectrique entre « %s » et "
                "« %s »." % (ca["nom"], cb["nom"]))
        return {"x1": x, "x2": x, "y1": y, "y2": y,
                "z1": z0, "z2": z1}
    # Port dans le plan : l'excitation est horizontale (fente, dipole
    # imprime). La hauteur est celle du conducteur designe.
    z0, z1 = ca["z0"], ca["z1"]
    ecart = _nb_pos(p.get("ecart"), 0.2) * k_mm
    # Meme regle en travers : l'ECART reste -- c'est la fente aux bornes de
    # laquelle la tension existe, la degenerer supprimerait le port -- mais la
    # largeur s'efface. L'epaisseur en z est celle du conducteur, nulle des
    # que le cuivre est modelise en feuille.
    if direction == "x":
        return {"x1": x - ecart / 2.0, "x2": x + ecart / 2.0,
                "y1": y, "y2": y,
                "z1": z0, "z2": z1}
    return {"x1": x, "x2": x,
            "y1": y - ecart / 2.0, "y2": y + ecart / 2.0,
            "z1": z0, "z2": z1}


def _port_coaxial(p, ca, cb, conducteurs, x, y, k_mm):
    """Le connecteur : ame, gaine, dielectrique, degagements, et la source.

    `ca` porte l'ame (la couche de l'antenne), `cb` la gaine (le plan de
    masse). Le troncon sort de la carte DU COTE DE LA MASSE : c'est la que se
    visse un connecteur, et c'est le seul sens ou la gaine puisse toucher le
    plan sans traverser l'antenne.
    """
    ra = _nb_pos(p.get("ra"), COAX_RA) * k_mm
    rb = _nb_pos(p.get("rb"), COAX_RB) * k_mm
    ep = _nb_pos(p.get("ep_gaine"), COAX_EP) * k_mm
    er = _nb_pos(p.get("er"), COAX_ER) or COAX_ER
    # `_nb` ET NON `_nb_pos` : une longueur explicitement nulle doit etre
    # refusee, pas remplacee en silence par le defaut. Absente, elle vaut le
    # troncon standard ; ecrite a zero, elle est une faute.
    lg = _nb(p.get("longueur"), COAX_LONGUEUR) * k_mm

    if rb <= ra:
        raise ErreurModele(
            "Le coaxial du port a une gaine (rayon %.3f mm) qui n'est pas "
            "plus large que son ame (%.3f mm)." % (rb, ra),
            "L'impedance d'un coaxial vaut 60/racine(er).ln(b/a) : il lui "
            "faut b > a. Une SMA ordinaire donne a = 0,635 et b = 2,05 mm.")
    if lg <= 0:
        raise ErreurModele(
            "Le troncon de coaxial a une longueur nulle.",
            "Donnez-lui quelques millimetres : c'est la ligne de transmission "
            "entre la source et la carte, et le plan de reference des S est a "
            "son extremite.")

    # Le sens ou sort le connecteur : du cote de la masse.
    sens = -1.0 if cb["z0"] < ca["z0"] else 1.0
    z_gaine = cb["z0"] if sens < 0 else cb["z1"]
    z_bas = z_gaine + sens * lg
    # L'ame va du bout du troncon jusqu'a la face exterieure de la couche a
    # laquelle elle se raccorde : elle traverse donc toute la carte.
    z_ame = ca["z1"] if sens < 0 else ca["z0"]
    # LA CROIX D'ALIMENTATION EST AU BOUT DU TRONCON, ET IL N'Y A RIEN
    # DERRIERE. C'est exactement la disposition d'un port localise : la source
    # et sa resistance occupent le meme volume, et le cote oppose est le bord
    # du modele. Un fond metallique pose derriere la source la court-
    # circuiterait ; pose derriere une charge, il la renverrait a un
    # court-circuit -- et un port 2 court-circuite au lieu d'etre adapte rend
    # un S21 qui ne veut rien dire, puisque les S se definissent tous autres
    # ports FERMES SUR LEUR IMPEDANCE.
    z_feed = z_bas
    # Le plan de mesure : a mi-troncon. Assez loin de la source pour que les
    # modes superieurs soient morts, assez loin de la carte pour que le champ
    # de bord du degagement ne soit pas compte comme de la ligne.
    z_mes = 0.5 * (z_bas + z_gaine)
    # Le rayon de la boucle de courant : au milieu de la couronne, la ou le
    # champ H est le mieux represente.
    rm = 0.5 * (ra + rb)

    # LES DEGAGEMENTS. Toute couche de cuivre que l'ame traverse doit etre
    # percee, sauf celle qui la recoit. Celle de la gaine en fait partie : sans
    # son degagement l'ame touche le plan de masse, et le port est un
    # court-circuit.
    zmin, zmax = min(z_ame, z_bas), max(z_ame, z_bas)
    degagements = []
    for c in conducteurs:
        if c["nom"] == ca["nom"]:
            continue
        if c["z1"] < zmin - 1e-9 or c["z0"] > zmax + 1e-9:
            continue
        degagements.append({"couche": c["nom"], "z0": c["z0"], "z1": c["z1"],
                            "r": rb})

    coax = {
        "ra": ra, "rb": rb, "ep_gaine": ep, "er": er, "longueur": lg,
        "sens": sens, "z_gaine": z_gaine, "z_bas": z_bas, "z_ame": z_ame,
        "z_feed": z_feed, "z_mes": z_mes, "rm": rm,
        "z0_ligne": _coax_z0(ra, rb, er),
        "degagements": degagements,
    }
    # Le « volume » declare du port : le bras +x de la croix. Il ne sert qu'a
    # ce qui regarde tous les ports sans distinction -- le maillage, l'emprise,
    # la vue 3D. La croix entiere, elle, est ecrite par le script.
    volume = {"x1": x + ra, "x2": x + rb,
              "y1": y - ra, "y2": y + ra,
              "z1": z_feed, "z2": z_feed}
    return coax, volume


# ==========================================================================
# Le microruban : ce que la ligne d'alimentation fait a l'impedance lue
# --------------------------------------------------------------------------
# POURQUOI CES FORMULES SONT ICI AUSSI. Elles vivent deja dans la page
# (22-antennes.js), qui s'en sert pour SYNTHETISER une largeur de ligne a
# 50 ohms. Ce qu'on en fait ici est l'inverse : une ligne DEJA dessinee, dont
# on veut savoir ce qu'elle fait a l'impedance qu'on mesure a son bout. Les
# deux jeux doivent rendre les memes nombres -- Hammerstad dans sa forme
# usuelle, la meme des deux cotes --, et le banc le verifie.
def microruban_eeff(er, h, w):
    """La permittivite effective : une partie du champ passe dans l'air."""
    return (er + 1) / 2.0 + (er - 1) / 2.0 * (1 + 12.0 * h / max(w, 1e-6)) ** -0.5


def microruban_z0(er, h, w):
    """L'impedance caracteristique d'un ruban de largeur w sur h."""
    e = microruban_eeff(er, h, w)
    u = w / max(h, 1e-9)
    if u <= 1:
        return 60.0 / math.sqrt(e) * math.log(8.0 / u + u / 4.0)
    return 120.0 * math.pi / (math.sqrt(e)
                              * (u + 1.393 + 0.667 * math.log(u + 1.444)))


def _substrat_entre(dielectriques, ca, cb):
    """L'epaisseur et la permittivite du dielectrique qui separe deux
    conducteurs. Rend (0, 0) s'il n'y a rien entre les deux -- un port dans le
    plan, par exemple, dont les deux bornes sont sur la MEME couche.

    Plusieurs dielectriques empiles se resument a leur epaisseur totale et a
    la permittivite du plus epais. C'est une approximation, et elle est dite :
    un microruban sur un empilage mixte n'a pas d'er effectif elementaire, et
    pretendre le calculer exactement ici serait pretendre plus que ce que le
    modele de ligne sait faire.
    """
    zb = min(ca["z1"], cb["z1"])
    zh = max(ca["z0"], cb["z0"])
    if zh - zb <= 0:
        return 0.0, 0.0
    h, er, ep_max = 0.0, 0.0, 0.0
    for d in dielectriques:
        d0, d1 = max(d["z0"], zb), min(d["z1"], zh)
        if d1 - d0 <= 0:
            continue
        h += d1 - d0
        if d1 - d0 > ep_max:
            ep_max, er = d1 - d0, d["er"]
    return h, er


def _ligne_alim(p, ca, cb, dielectriques, k_mm, rang):
    """La ligne d'alimentation DECLAREE entre le port et le pied de l'antenne.

    CE QU'ELLE SERT A FAIRE, ET CE QU'ELLE NE FAIT PAS. L'impedance est lue la
    ou le port est pose -- au bord de la carte quand l'antenne est alimentee
    par un ruban. Ce n'est pas la meme chose que l'impedance de l'antenne : il
    y a un bout de ligne entre les deux, et une ligne FAIT TOURNER
    l'impedance. Declarer sa longueur et sa largeur permet de ramener la
    mesure au pied de l'antenne, ce qui est le seul endroit ou elle dise quoi
    corriger sur l'antenne.

    ELLE NE CHANGE PAS L'ADAPTATION, et c'est demontre : une ligne sans perte
    dont le Z0 est celui de reference ne change pas |Gamma|, elle le fait
    TOURNER. Deux simulations du gabarit, la seconde avec la ligne DOUBLEE,
    donnent -0,64 dB et -1,20 dB a 2,45 GHz -- un demi-decibel, soit ce que
    6,4 mm de FR-4 a tan d = 0,02 dissipent, et rien de plus. Qui cherche une
    desadaptation ne la trouvera jamais ici.

    LE DESEMBEDAGE EST SANS PERTE, ET IL FAUT LE DIRE. La rotation se fait sur
    un Z0 reel : ce que la ligne dissipe reste dans le S11 lu. Et pres du bord
    de l'abaque -- une antenne mal adaptee, |Gamma| proche de 1 -- la rotation
    amplifie toute erreur sur Z0 et sur er effectif : l'impedance ramenee y est
    fragile, et le savoir vaut mieux que de la croire au dixieme d'ohm.
    """
    b = _dict(p.get("ligne"))
    d = _nb_pos(b.get("longueur"), 0.0) * k_mm
    if d <= 0:
        return None
    w = _nb_pos(b.get("largeur"), 0.0) * k_mm
    if w <= 0:
        raise ErreurModele(
            "Le port %d declare une ligne d'alimentation de %.3f mm de long "
            "sans dire sa largeur." % (rang, d),
            "C'est la largeur du ruban qui donne son impedance "
            "caracteristique : sans elle, ramener la mesure au pied de "
            "l'antenne reviendrait a inventer un nombre.")
    h, er = _substrat_entre(dielectriques, ca, cb)
    if h <= 0 or er <= 0:
        raise ErreurModele(
            "Le port %d declare une ligne d'alimentation, mais il n'y a aucun "
            "dielectrique entre « %s » et « %s »." % (rang, ca["nom"], cb["nom"]),
            "Un microruban est un ruban AU-DESSUS d'un plan de masse, separe "
            "par un substrat. Completez l'empilage a l'etape 2.")
    return {"d": d, "w": w, "h": h, "er": er,
            "eeff": microruban_eeff(er, h, w),
            "z0": microruban_z0(er, h, w)}


def _un_port(p, rang, conducteurs, dielectriques, k_mm, boite_cu):
    """Un port : ce qu'il relie, ou il est, et le volume qu'il occupe.

    TROIS FAUTES REVIENNENT TOUJOURS, et les trois sont refusees plutot que
    rendues : un volume d'epaisseur nulle (les deux couches se touchent), un
    port qui relie une couche a elle-meme, et un port pose hors du cuivre
    retenu. Aucune ne se voit dans le S11 : elles ressemblent toutes a des
    resultats.
    """
    genre = (_texte(p.get("type"), 20) or "localise").lower()
    genre = "coaxial" if genre.startswith("coax") else "localise"
    direction = (_texte(p.get("dir"), 2) or "z").lower()
    if direction not in ("x", "y", "z"):
        direction = "z"

    x = _nb(p.get("x")) * k_mm
    y = _nb(p.get("y")) * k_mm
    # L'etendue du port dans le plan : une petite plage, pas un point. Par
    # defaut la largeur de la piste d'alimentation, a defaut un dixieme de
    # millimetre -- assez pour qu'une cellule s'y pose.
    w = _nb_pos(p.get("w"), 0.3) * k_mm
    l = _nb_pos(p.get("l"), 0.3) * k_mm

    nom_a = _texte(p.get("de"))
    nom_b = _texte(p.get("a"))
    ca = _conducteur(conducteurs, nom_a)
    cb = _conducteur(conducteurs, nom_b)
    if ca is None or cb is None:
        raise ErreurModele(
            "Le port %d doit relier deux couches de l'empilage "
            "(recues : « %s » et « %s »)." % (rang, nom_a or "?", nom_b or "?"),
            "Choisissez la couche de l'antenne et celle du plan de masse "
            "dans le panneau « Le port ».")
    if ca["nom"] == cb["nom"]:
        raise ErreurModele(
            "Le port %d relie « %s » a elle-meme." % (rang, ca["nom"]),
            "Un port excite une DIFFERENCE de potentiel : il lui faut deux "
            "conducteurs distincts.")

    coax = None
    if genre == "coaxial":
        coax, volume = _port_coaxial(p, ca, cb, conducteurs, x, y, k_mm)
        direction = "x"                 # la source est radiale, selon +x
    else:
        volume = _port_volume_localise(p, ca, cb, direction, x, y, w, l, k_mm)

    if boite_cu:
        marge = 1.0
        if not (boite_cu[0] - marge <= x <= boite_cu[2] + marge
                and boite_cu[1] - marge <= y <= boite_cu[3] + marge):
            raise ErreurModele(
                "Le port %d est pose hors du cuivre selectionne "
                "(%.3f ; %.3f mm)." % (rang, x, y),
                "Cliquez le point d'alimentation sur la carte plutot que "
                "de saisir des coordonnees a la main.")

    out = {
        "n": rang,
        "nom": _texte(p.get("nom"), 40) or ("port %d" % rang),
        "type": genre,
        "dir": direction,
        "x": x, "y": y, "w": w, "l": l,
        "R": _nb_pos(p.get("R"), 50.0),
        "de": ca["nom"], "a": cb["nom"],
        "excite": bool(p.get("excite", True)),
    }
    out.update(volume)
    if coax:
        out["coax"] = coax
    else:
        # UN COAXIAL NE DECLARE PAS DE LIGNE : il porte deja son propre deport
        # de plan de reference, ramene a la surface de la carte, et empiler un
        # second desembedage par-dessus reviendrait a compter deux fois.
        ligne = _ligne_alim(p, ca, cb, dielectriques, k_mm, rang)
        if ligne:
            out["ligne"] = ligne
    return out


def _ports(doc, conducteurs, dielectriques, k_mm, boite_cu):
    """Tous les ports du modele, dans l'ordre ou la page les a poses.

    L'ANCIENNE FORME RESTE LUE. Un document qui ne porte qu'un `port` -- ceux
    qu'ecrivait la version a un seul port, et ceux du banc d'essai -- vaut une
    liste d'un element : le format d'entree ne casse pas parce que l'outil a
    appris a en compter deux.
    """
    bruts = [_dict(p) for p in _liste(_dict(doc).get("ports")) if _dict(p)]
    if not bruts:
        p = _dict(_dict(doc).get("port"))
        bruts = [p] if p else []
    if not bruts:
        raise ErreurModele(
            "Aucun port d'excitation.",
            "Posez le port a l'etape « Le port » : c'est par lui que l'onde "
            "entre, et c'est lui qui donne le S11.")
    if len(bruts) > MAX_PORTS:
        raise ErreurModele(
            "%d ports demandes, %d au plus." % (len(bruts), MAX_PORTS),
            "Au-dela, les volumes de port pesent plus que l'antenne et le "
            "tableau des S devient illisible.")

    out = [_un_port(p, i + 1, conducteurs, dielectriques, k_mm, boite_cu)
           for i, p in enumerate(bruts)]

    excites = [p for p in out if p["excite"]]
    if len(excites) > 1:
        raise ErreurModele(
            "%d ports sont excites en meme temps (%s)."
            % (len(excites), ", ".join(str(p["n"]) for p in excites)),
            "Un parametre S se definit par « ce qui sort de j QUAND SEUL i "
            "excite » : deux excitations simultanees superposent leurs ondes, "
            "et aucun S ne s'en deduit. Excitez-en un, relancez pour l'autre.")
    if not excites:
        out[0]["excite"] = True
    return out


def _emprise_port(p):
    """Ce qu'un port ajoute a l'emprise. Un connecteur coaxial sort de la
    carte : une boite d'air mesuree sans lui le laisserait DANS la PML --
    c'est-a-dire hors du calcul, sans que rien ne le dise."""
    c = p.get("coax")
    if not c:
        return (p["x1"], p["y1"], p["z1"], p["x2"], p["y2"], p["z2"])
    r = c["rb"] + c["ep_gaine"]
    zs = (c["z_bas"], c["z_gaine"], c["z_ame"])
    return (p["x"] - r, p["y"] - r, min(zs),
            p["x"] + r, p["y"] + r, max(zs))


# ==========================================================================
# La bande de frequence et l'excitation
# ==========================================================================

def _bande(doc):
    b = _dict(_dict(doc).get("bande"))
    f1 = _nb_pos(b.get("f1"), 0.0)
    f2 = _nb_pos(b.get("f2"), 0.0)
    if f1 <= 0 or f2 <= 0:
        raise ErreurModele(
            "Bande de frequence absente ou nulle.",
            "Saisissez la bande a simuler a l'etape 5 (par exemple "
            "2,0 a 3,0 GHz pour une antenne 2,45 GHz).")
    if f2 < f1:
        f1, f2 = f2, f1
    if f2 - f1 < f2 * 1e-4:
        raise ErreurModele(
            "La bande est trop etroite (%.4g a %.4g Hz)." % (f1, f2),
            "Une impulsion gaussienne a besoin d'une largeur : prenez au "
            "moins quelques pour cent autour de la frequence visee.")
    n = int(_nb_pos(b.get("n"), 401))
    n = max(21, min(4001, n))
    # L'impulsion gaussienne d'openEMS est decrite par son centre f0 et sa
    # demi-largeur fc : elle couvre alors [f0-fc, f0+fc].
    f0 = (f1 + f2) / 2.0
    #
    # ON EXCITE PLUS LARGE QU'ON N'ANALYSE, ET C'EST UN GAIN DES DEUX COTES.
    # La duree de l'impulsion varie comme 1/fc : une bande d'analyse a plus ou
    # moins 15 % donnait une impulsion de 7,8 ns, soit pres de DIX MILLE pas
    # de temps rien que pour l'emettre. openEMS s'en plaint lui-meme --
    # « max. number of timesteps is smaller than three times the excitation »
    # -- et il a raison : une simulation coupee avant que l'impulsion ne soit
    # finie ne rend pas une mesure, elle rend une troncature. En excitant sur
    # une demi-octave, l'impulsion tombe a 2,9 ns et le calcul raccourcit
    # d'autant.
    #
    # Le second gain est la ou on ne l'attend pas : aux BORDS de la bande. Par
    # definition, une gaussienne n'a plus que -20 dB d'energie a f0 +/- fc ;
    # calquer fc sur la bande analysee revenait a mesurer les extremites de la
    # courbe la ou l'excitation n'a presque rien mis. Le S11 y devenait le
    # rapport de deux petits nombres, et il en sortait des |S11| superieurs a
    # 1 qu'il fallait ecreter apres coup.
    #
    # L'analyse, elle, ne bouge pas : f1 et f2 restent la bande demandee.
    fc = max((f2 - f1) / 2.0, EXCITATION_LARGEUR_MIN * f0)
    return {"f1": f1, "f2": f2, "n": n, "f0": f0, "fc": fc,
            # La duree de l'impulsion, telle qu'openEMS la calcule
            # (Gauss : 2 x 9/(2.pi.fc)). C'est elle qui fixe le nombre de pas
            # minimal, et l'assistant la relit pour le dire.
            "t_excitation": 9.0 / (math.pi * fc),
            "fcible": _nb_pos(b.get("fcible"), 0.0) or f0}


# ==========================================================================
# La boite d'air, la PML et le maillage
# ==========================================================================

def _boite(doc, emprise, bande, res_air, k_mm):
    """La boite de calcul : le cuivre, l'air, puis la PML.

    LA MARGE SE COMPTE EN DEUX MORCEAUX, ET LES CONFONDRE EST LA FAUTE QUI
    COUTE LE PLUS CHER ICI.

      1. l'AIR PHYSIQUE, entre l'antenne et le debut de la couche absorbante :
         un quart de la longueur d'onde a la frequence LA PLUS BASSE. C'est la
         distance au bout de laquelle le champ proche reactif s'est assez
         eteint pour que la PML n'ait plus a l'absorber. Trop court,
         l'impedance d'entree derive et la resonance se deplace — sans que
         rien ne le signale ;
      2. la PML ELLE-MEME, qui occupe les N cellules les plus exterieures de
         la boite. Ce n'est pas de l'air : c'est un materiau absorbant, et ce
         qui s'y trouve n'est pas simule mais mange.

    Une marge de « lambda/4 » tout court place donc la PML SUR l'antenne :
    avec un pas d'air de lambda/20, huit couches de PML font 8/20 = 0,4
    lambda, c'est-a-dire plus que le quart de lambda qu'on croyait s'etre
    reserve. Le conseil rendu ici est la SOMME des deux.
    """
    b = _dict(_dict(doc).get("boite"))
    lam_max = C0 / bande["f1"] * 1000.0            # mm, a la frequence basse
    pml = int(_nb_pos(b.get("pml"), PML_DEFAUT))
    pml = max(4, min(20, pml))

    air_utile = MARGE_LAMBDA * lam_max
    ep_pml = pml * res_air
    marge_conseil = air_utile + ep_pml

    # LES MARGES SONT DANS L'UNITE DU FICHIER, comme tout le reste du
    # document : sur une carte en pouces, saisir une marge en millimetres a
    # cote de coordonnees en pouces serait une invitation a se tromper. Elles
    # passent donc par k_mm, exactement comme les polygones et le port. Sans
    # cela une carte en pouces recevait une boite vingt-cinq fois trop
    # petite — et l'erreur ne se voyait que sur le nombre de cellules.
    mx = _nb_pos(b.get("mx"), 0.0) * k_mm or marge_conseil
    my = _nb_pos(b.get("my"), 0.0) * k_mm or marge_conseil
    mz_h = _nb_pos(b.get("mz_haut"), 0.0) * k_mm or marge_conseil
    mz_b = _nb_pos(b.get("mz_bas"), 0.0) * k_mm or marge_conseil

    mini = min(mx, my, mz_h, mz_b)
    x1, y1, z1, x2, y2, z2 = emprise
    return {
        "x1": x1 - mx, "x2": x2 + mx,
        "y1": y1 - my, "y2": y2 + my,
        "z1": z1 - mz_b, "z2": z2 + mz_h,
        "mx": mx, "my": my, "mz_haut": mz_h, "mz_bas": mz_b,
        "pml": pml,
        "ep_pml": ep_pml,
        "air_utile": air_utile,
        "marge_conseil": marge_conseil,
        # L'air qui RESTE une fois la PML retranchee : c'est lui qui compte,
        # et il peut etre negatif — une marge plus courte que la PML veut dire
        # que l'absorbeur mord dans la structure.
        "air_restant": mini - ep_pml,
        "marge_suffisante": (mini - ep_pml) >= air_utile * 0.95,
    }


def _largeur_cuivre_min(cuivre):
    """Le plus petit cote du plus petit polygone de cuivre, dans le plan.

    C'EST UNE APPROXIMATION, ET ELLE SE TROMPE TOUJOURS DU BON COTE. On prend
    le petit cote de la BOITE ENGLOBANTE de chaque polygone : pour un troncon
    de piste droit -- le cas courant, et celui qui compte -- c'est exactement
    sa largeur. Pour une piste coudee, la boite est plus grosse que la piste :
    la regle raffine alors MOINS qu'il ne faudrait, jamais plus. Une regle qui
    se tromperait dans l'autre sens ferait exploser le maillage sur une carte
    reelle sans que personne ne l'ait demande.
    """
    mini = None
    for bloc in cuivre:
        for poly in bloc.get("polys", ()):
            # LE CONTOUR SEUL, ET PAS LES DECOUPES. Compter aussi les fentes
            # serait defendable — une encoche etroite porte du champ — mais
            # mesure faite sur l'exemple, cela divise encore le pas par 1,25
            # et multiplie le calcul par pres de deux, pour une resonance qui
            # etait deja juste sans. Une structure dont la FENTE est l'organe
            # rayonnant (antenne a fente, patch a fente couplee) demande donc
            # encore un pas saisi a la main ; c'est dit ici plutot que
            # decouvert apres coup.
            pts = poly.get("o") or ()
            if len(pts) < 3:
                continue
            xs = [q[0] for q in pts]
            ys = [q[1] for q in pts]
            cote = min(max(xs) - min(xs), max(ys) - min(ys))
            if cote > 1e-9 and (mini is None or cote < mini):
                mini = cote
    return mini


def _resolution(bande, er_max, cuivre=(), boite_cu=None):
    """Le pas de maillage le plus grand admissible, dans l'air et dans le
    dielectrique.

    DEUX BORNES, ET C'EST LA PLUS PETITE QUI GAGNE :

      1. lambda/20 dans le milieu le plus lent, a la frequence LA PLUS HAUTE
         de la bande -- c'est elle qui a la longueur d'onde la plus courte,
         donc elle qui commande. C'est la borne classique, et elle suffit a
         une antenne filaire dans l'air ;
      2. la LARGEUR DU CUIVRE LE PLUS ETROIT, divisee par
         CELLULES_PAR_PISTE. Un ruban rendu par deux cellules n'a pas
         l'impedance d'un ruban.

    La seconde ne s'applique QU'AU DIELECTRIQUE : l'air n'a pas de piste, et
    le raffiner couterait des cellules pour rien. Elle est bornee par
    LIGNES_MAX_EMPRISE -- voir la constante.
    """
    lam_air = C0 / bande["f2"] * 1000.0
    res_air = lam_air / CELLULES_PAR_LAMBDA
    res_lam = lam_air / (CELLULES_PAR_LAMBDA * math.sqrt(max(1.0, er_max)))

    res_die = res_lam
    largeur = _largeur_cuivre_min(cuivre)
    if largeur:
        res_die = min(res_die, largeur / CELLULES_PAR_PISTE)

    if boite_cu:
        cote = max(boite_cu[2] - boite_cu[0], boite_cu[3] - boite_cu[1])
    else:
        cote = 0.0
    plancher = (cote / LIGNES_MAX_EMPRISE) if cote > 0 else res_lam / 8.0
    # Un plancher plus grossier que le pas de lambda/20 n'aurait pas de sens :
    # la borne est la pour freiner le raffinement, pas pour degrader le fond.
    plancher = min(plancher, res_lam)
    bornee = res_die < plancher
    res_die = max(res_die, plancher)
    # `air` et `die` sont les pas CALCULES. Ils restent lisibles meme quand le
    # document en impose d'autres : la page affiche alors les deux, et l'ecart
    # se voit au lieu de se subir.
    return res_air, res_die, {"lambda": res_lam, "largeur_cuivre": largeur,
                              "plancher": plancher, "bornee": bornee,
                              "air": res_air, "die": res_die}


def _lignes(debut, fin, pas):
    """Une suite de lignes de maillage regulieres, bornes comprises."""
    if fin <= debut:
        return [debut]
    n = max(1, int(math.ceil((fin - debut) / pas)))
    h = (fin - debut) / n
    return [debut + i * h for i in range(n + 1)]


def _grouper(valeurs, eps):
    """Rassemble en UNE coordonnee celles qui ne different que de `eps`.

    LA GEOMETRIE N'EST PAS TOUCHEE, LA GRILLE SEULE L'EST. Ce qui part au
    solveur reste le polygone exact ; ce qui est regroupe ici, ce sont les
    lignes de maillage qu'on en deduit. Un bord a 32,810 et un bord a 32,800
    donnent donc un seul jeu de lignes au lieu de deux jeux qui se touchent,
    et le cuivre, lui, garde ses cotes au micron.

    Une grappe est bornee a `eps` DEPUIS SON PREMIER ELEMENT et non de proche
    en proche : sans cela une file de bords espaces d'un demi-eps se
    ramasserait en un seul point, et le dernier aurait glisse de bien plus que
    la tolerance qu'on s'est donnee.

    Rend les coordonnees regroupees et le nombre de bords absorbes -- c'est ce
    second nombre que l'assistant rapporte, parce qu'un regroupement silencieux
    serait exactement le genre de correction qu'on decouvre trop tard.
    """
    tri = sorted(set(round(v, 9) for v in valeurs))
    if eps <= 0 or not tri:
        return tri, 0
    grappes, courante = [], [tri[0]]
    for v in tri[1:]:
        if v - courante[0] > eps:
            grappes.append(courante)
            courante = []
        courante.append(v)
    grappes.append(courante)
    absorbes = sum(len(g) - 1 for g in grappes)
    return [sum(g) / len(g) for g in grappes], absorbes


def _fusionner(lignes, mini, obligatoires=(), affinage=(), mini_affinage=None):
    """Trie, dedoublonne, et supprime les lignes trop proches.

    DEUX LIGNES DE MAILLAGE A UN MICRON L'UNE DE L'AUTRE NE RAFFINENT RIEN :
    elles fabriquent une cellule minuscule, et comme le pas de temps FDTD est
    commande par la PLUS PETITE cellule de tout le domaine, cette cellule-la
    ralentit la simulation entiere. C'est la panne la plus frequente d'un
    maillage construit a partir de geometrie reelle, ou les coordonnees se
    repetent a l'epsilon pres.

    MAIS TOUTES LES LIGNES NE SE VALENT PAS, et les confondre etait un defaut
    a part entiere : une interface de l'empilage, une face du port, ne sont
    pas des lignes de remplissage. Les effacer parce qu'une ligne d'air passe
    a cote deplace physiquement la geometrie -- un substrat de 1,6 mm dont la
    face superieure a glisse de 0,3 mm n'est plus le meme substrat. Les
    lignes OBLIGATOIRES sont donc posees d'abord et ne cedent jamais : ce sont
    les lignes ordinaires qui s'ecartent pour elles.

    LES SEUILS PEUVENT ETRE DES FONCTIONS DE L'ENDROIT, et non des nombres :
    depuis qu'il y a deux pas dans le plan — le fond, et le pas fin d'une bande
    en travers d'une piste —, un seuil unique calcule sur le fond effacerait
    une par une les lignes de la bande. Voir `_pas_local`.

    CHAQUE LIGNE EST JUGEE A SON SEUIL, CELUI DE L'ENDROIT OU ON LA POSE, et
    non au plus serre des deux voisinages. La difference se paie comptant au
    bord d'une bande : une ligne du FOND qui tombe a 0,05 mm d'une ligne de
    bande doit ceder -- elle n'a rien a decrire la, et sa cellule de 0,05 mm
    commanderait le pas de temps de tout le domaine --, tandis que la ligne de
    BANDE, elle, reste a son propre seuil, trois fois plus serre. Juger les
    deux au seuil le plus serre laissait passer la premiere : mesure sur vingt
    pistes de 0,5 mm, la plus petite cellule tombait a 0,05 mm pour un pas fin
    de 0,125, soit deux fois et demie le pas de temps qu'il fallait.

    TROIS RANGS, ET LE TROISIEME EST CELUI QUI COUTAIT CHER. Entre la ligne
    qu'on ne peut pas bouger et celle qui remplit, il y a celle de l'AFFINAGE
    -- les deux lignes que la regle du tiers pose de part et d'autre d'une
    arete de cuivre. Elle tombe ou l'arete tombe, c'est-a-dire n'importe ou
    par rapport a la grille reguliere : rien n'empeche une ligne de
    remplissage de se poser a quarante microns d'elle, et cette cellule-la
    commande alors le pas de temps de tout le domaine. C'est ce qui est arrive
    sur l'IFA du gabarit -- 0,0433 mm entre la ligne d'affinage 4,7067 et la
    ligne de remplissage 4,7500, pour un pas vise de 0,25 mm. (Cotes de l'IFA
    d'avant, quand le gabarit les tirait d'une note d'application ; la
    collision, elle, ne tient pas a la cote qui l'a revelee.)

    Le remede n'est PAS d'elargir le seuil pour tout le monde : fusionner deux
    lignes d'affinage entre elles efface le raffinement des bords rayonnants,
    et cela s'est mesure -- au tiers du pas, le creux de S11 du patch tombait
    de -6,6 a -2,1 dB. C'est le REMPLISSAGE qui doit s'ecarter : la ou
    l'affinage decrit deja le voisinage d'une arete, une ligne reguliere de
    plus n'ajoute rien qu'une cellule mince. L'affinage garde donc le seuil
    serre, le remplissage en recoit un plus large (`mini_affinage`), et ce
    qu'on perd est exactement ce qui ne servait a rien.
    """
    obl = sorted(set(round(v, 9) for v in obligatoires))
    aff = sorted(set(round(v, 9) for v in affinage) - set(obl))
    autres = sorted(set(round(v, 9) for v in lignes) - set(obl) - set(aff))
    seuil_autres = mini if mini_affinage is None else mini_affinage

    out = []
    for v in obl:
        # Deux obligatoires trop proches l'une de l'autre restent toutes les
        # deux : elles decrivent la geometrie, et c'est a l'assistant de
        # signaler la cellule mince qui en resulte, pas a nous de la cacher.
        if not out or v - out[-1] > 1e-9:
            out.append(v)

    for v in aff:
        i = _place(out, v)
        gauche = out[i - 1] if i > 0 else None
        droite = out[i] if i < len(out) else None
        if gauche is not None and v - gauche < _val(mini, v):
            continue
        if droite is not None and droite - v < _val(mini, v):
            continue
        out.insert(i, v)

    for v in autres:
        i = _place(out, v)
        gauche = out[i - 1] if i > 0 else None
        droite = out[i] if i < len(out) else None
        if gauche is not None and v - gauche < _val(seuil_autres, v):
            continue
        if droite is not None and droite - v < _val(seuil_autres, v):
            continue
        out.insert(i, v)
    return out


def _lisser(lignes, plancher, ratio=None):
    """Adoucit les marches du maillage : deux cellules voisines ne different
    plus d'un facteur beaucoup superieur a `ratio`.

    POURQUOI UNE MARCHE COUTE QUELQUE CHOSE. Une onde qui passe d'une cellule
    de 0,5 mm a une cellule de 2 mm voit un changement brusque de la grille et
    s'y REFLECHIT -- numeriquement, sans qu'aucun objet physique ne soit la.
    Ce parasite revient au port, s'ajoute a l'onde reflechie par l'antenne, et
    rien dans le resultat ne dit lequel des deux on lit. C'est la raison d'etre
    de SmoothMeshLines chez openEMS, et de cette fonction ici.

    ON N'AJOUTE QUE DES LIGNES, ON N'EN DEPLACE AUCUNE : les interfaces de
    l'empilage, les faces du port et les aretes de cuivre restent exactement
    ou `_fusionner` les a posees.

    LA TAILLE ADMISSIBLE SE PROPAGE D'ABORD, LA SUBDIVISION VIENT APRES, et
    cet ordre est tout le sujet. Une premiere version coupait chaque grande
    cellule des qu'une voisine etait plus fine ; la meme cellule se faisait
    alors decouper deux fois, une fois par chaque bord, et les deux series de
    coupes s'entremelaient en copeaux. Le maillage d'essai passait de cent
    mille a vingt-sept millions de cellules. On calcule donc D'ABORD, pour
    chaque cellule, la taille que ses voisines lui autorisent -- une passe
    vers la droite, une vers la gauche --, PUIS on coupe chacune une seule
    fois, en parts egales.

    `plancher` empeche une cellule mince isolee -- deux aretes de cuivre
    presque confondues, l'epaisseur d'un conducteur -- d'imposer sa finesse a
    tout le domaine de proche en proche. Elle reste mince ; elle ne contamine
    pas. Il peut etre une FONCTION DE L'ENDROIT : dans une bande fine, le
    plancher est le pas fin, sinon le lissage subdiviserait la bande jusqu'a
    rattraper le fond de proche en proche.
    """
    ratio = GRADIENT_MAX if ratio is None else ratio
    out = sorted(lignes)
    n = len(out) - 1
    if n < 2 or ratio <= 1.0:
        return out
    pas = [out[i + 1] - out[i] for i in range(n)]
    lim = [max(pas[i], _seuil(plancher, out[i], out[i + 1]))
           for i in range(n)]
    for i in range(1, n):
        lim[i] = min(lim[i], lim[i - 1] * ratio)
    for i in range(n - 2, -1, -1):
        lim[i] = min(lim[i], lim[i + 1] * ratio)

    coupe = [out[0]]
    for i in range(n):
        k = int(math.ceil(pas[i] / lim[i] - 1e-9)) if lim[i] > 0 else 1
        k = max(1, min(k, 64))
        for j in range(1, k):
            coupe.append(round(out[i] + pas[i] * j / k, 9))
        coupe.append(out[i + 1])
    return coupe


def _place(triee, v):
    """Index d'insertion de v dans une liste triee (bissection)."""
    lo, hi = 0, len(triee)
    while lo < hi:
        mi = (lo + hi) // 2
        if triee[mi] < v:
            lo = mi + 1
        else:
            hi = mi
    return lo


def _pas_local(bandes, res_die, res_fin):
    """Le pas VISE en un point de l'axe : le fond, ou le pas fin d'une bande.

    TOUS LES SEUILS DE `_fusionner` ET DE `_lisser` EN DECOULENT, et c'est la
    seule facon de faire tenir deux pas sur un meme axe. Les seuils sont des
    fractions du pas vise -- le quart pour l'affinage, le tiers pour le
    remplissage --, et calcules sur le pas de FOND ils effacent toute ligne
    posee a moins de 0,2 mm d'une autre : les lignes d'une bande a 0,13 mm y
    passeraient une par une, et le raffinement n'aurait jamais lieu.

    REND UN NOMBRE QUAND IL N'Y A PAS DE BANDE. Le chemin sans affinage local
    reste alors exactement celui d'avant, aux memes valeurs mesurees -- il n'y
    a pas deux codes a eprouver.
    """
    if not bandes or res_fin <= 0 or res_fin >= res_die:
        return res_die

    def pas(v):
        for a, b in bandes:
            if a <= v <= b:
                return res_fin
        return res_die
    return pas


def _divise(pas, k):
    """`pas / k`, que `pas` soit un nombre ou une fonction de la position."""
    if callable(pas):
        return lambda v: pas(v) / k
    return pas / k


def _val(x, v):
    """La valeur d'un seuil a un endroit donne, qu'il soit nombre ou fonction."""
    return x(v) if callable(x) else x


def _seuil(x, v, w):
    """Le seuil d'une CELLULE, entre deux lignes : le plus serre des deux bouts.

    Sert au lissage, ou le seuil qualifie une cellule et non une ligne : une
    cellule a cheval sur le bord d'une bande a le droit d'etre fine comme la
    bande, sinon le lissage la redecouperait pour rattraper le fond.
    """
    return min(_val(x, v), _val(x, w))


def _dans(bandes, v):
    """Ce point tombe-t-il dans une bande fine ?"""
    for a, b in bandes:
        if a <= v <= b:
            return True
    return False


def _souder(bandes):
    """Bandes triees, celles qui se chevauchent reunies en une seule."""
    out = []
    for a, b in sorted(bandes):
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def _bandes_fines(cuivre, seuil):
    """Les intervalles, axe par axe, ou le cuivre est trop etroit pour le pas
    de fond -- et SEULEMENT sur l'axe ou il est etroit.

    C'EST TOUT CE QUI REND LE RAFFINEMENT PAYABLE. Une piste longue de 20 mm
    et large de 0,5 ne demande le pas fin que sur un demi-millimetre : le champ
    tourne EN TRAVERS du ruban, pas le long. C'est la largeur qui fixe
    l'impedance ; la longueur se contente du pas de fond. Raffiner les deux
    axes couterait quarante fois plus de lignes pour la meme physique, et
    raffiner toute l'emprise -- ce que faisait le pas unique -- en couterait
    mille : c'est la, et pas ailleurs, que le budget de LIGNES_MAX_EMPRISE
    mordait et que l'outil renoncait.

    UN POLYGONE ETROIT DANS LES DEUX AXES -- une pastille, un bout de piste --
    donne deux bandes. C'est correct et c'est rarement ce qu'on veut payer : le
    budget s'en charge, et une bande plus mince que le pas fin retenu est
    abandonnee (voir `_maillage`).
    """
    bx, by = [], []
    for bloc in cuivre:
        for poly in bloc.get("polys", ()):
            pts = poly.get("o") or ()
            if len(pts) < 3:
                continue
            xs = [q[0] for q in pts]
            ys = [q[1] for q in pts]
            x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
            if 1e-9 < x1 - x0 < seuil:
                bx.append((x0, x1))
            if 1e-9 < y1 - y0 < seuil:
                by.append((y0, y1))
    return {"x": _souder(bx), "y": _souder(by)}


def _bande_lignes(a, b, pas):
    """Les lignes d'une bande fine : le cuivre en parts egales, et MARGE_BANDE
    cellules de plus de chaque cote.

    LES LIGNES TOMBENT SUR LES DEUX BORDS DU RUBAN, et c'est voulu. Le ruban a
    donc un nombre ENTIER de cellules en travers, ses bords sur la grille, et
    sa largeur est exactement celle qu'on a dessinee. Un bord de conducteur
    parfait pose SUR une ligne est le cas normal des qu'il est resolu ; la
    regle du tiers ne sert qu'a corriger la densite de courant d'un bord que la
    grille ne resout PAS -- c'est exactement la condition qu'openEMS se donne
    lui aussi dans `mesh_hint_from_box` : au-dela de `metal_edge_res` il
    decale, en deca il pose les lignes sur les aretes.
    """
    out = _lignes(a, b, pas)
    h = (b - a) / max(1, len(out) - 1)
    for i in range(1, MARGE_BANDE + 1):
        out.append(a - i * h)
        out.append(b + i * h)
    return out


def _maillage(modele, bande, res_air, res_die, res_fin=0.0, bandes=None):
    """Les trois listes de lignes de maillage.

    Le principe : un fond regulier a la resolution de l'air sur toute la
    boite, remplace par la resolution du dielectrique dans l'emprise de la
    carte, plus une ligne posee sur chaque cote de cuivre en z, plus -- si la
    regle du tiers est demandee -- un raffinement aux aretes du cuivre dans le
    plan, plus des BANDES FINES en travers du cuivre trop etroit pour le fond.

    CE QUI PART AU SOLVEUR, C'EST CETTE GRILLE-LA, ET RIEN D'AUTRE. Le
    commentaire d'avant disait « openEMS ajoute lui-meme les aretes par
    AddEdges2Grid » ; c'etait faux, et c'etait l'idee fausse la plus couteuse
    de ce module. `AddEdges2Grid` demande a chaque primitive un « hint », et
    `mesh_hint_from_primitive` (openEMS/automesh.py) n'en rend QUE pour un
    point ou une boite : pour un polygone elle rend None, sans un mot. Or tout
    le cuivre part en AddPolygon et en AddLinPoly. L'appel etait donc SANS
    EFFET -- verifie sur CSXCAD 0.6.3 et openEMS 0.0.36, grille identique avant
    et apres --, et le script ne l'emet plus. La bonne nouvelle est que le
    nombre de cellules et le pas de temps annonces ici sont ceux que le solveur
    calculera vraiment ; la mauvaise, qu'aucune arete n'etait raffinee par
    personne d'autre que ce module.

    DEUX PAS DANS LE PLAN, ET NON UN SEUL. `res_die` est le FOND : lambda/20
    dans le dielectrique, borne par le budget de lignes de l'emprise (voir
    LIGNES_MAX_EMPRISE). Sur une carte de 120 mm ce fond tombe a 0,6 mm, et une
    piste de 0,5 mm n'a plus une cellule en travers : son impedance n'est plus
    la sienne, sa resonance sort trop haut, et l'outil n'avait rien d'autre a
    proposer que « retirez ce cuivre de la selection ». `res_fin` est le pas
    des BANDES : il ne s'applique qu'en travers du cuivre etroit, sur le seul
    axe ou ce cuivre est etroit. Voir `_bandes_fines` pour l'axe, et `_mailler`
    pour le budget qui borne le tout.
    """
    boite = modele["boite"]
    em = modele["emprise"]
    z_haut = modele["z_haut"]

    # UNE BANDE PLUS MINCE QUE LE PAS FIN N'EST PAS UNE BANDE : elle poserait
    # une cellule de sa largeur, laquelle commanderait le pas de temps de tout
    # le domaine pour un cuivre qu'elle ne resout meme pas. Ces polygones-la
    # restent a la regle du tiers, et l'avis dit qu'ils ne sont pas resolus.
    bandes = bandes or {"x": [], "y": []}
    fin = res_fin if 0 < res_fin < res_die else 0.0
    bx = [(a, b) for a, b in bandes.get("x", ()) if b - a >= fin] if fin else []
    by = [(a, b) for a, b in bandes.get("y", ()) if b - a >= fin] if fin else []
    if not (bx or by):
        fin = 0.0
    # LA ZONE FINE COMPREND LES MARGES, et l'oublier coutait les marges
    # elles-memes : posees HORS de [a, b], elles etaient jugees au seuil du
    # fond -- le tiers de 0,35 mm contre un pas fin de 0,125 -- et sautaient
    # une fois sur deux, selon la carte. Ce sont des lignes de la bande ; elles
    # sont jugees comme telles.
    marge = MARGE_BANDE * fin
    large_x = _souder([(a - marge, b + marge) for a, b in bx])
    large_y = _souder([(a - marge, b + marge) for a, b in by])
    pas_x = _pas_local(large_x, res_die, fin)
    pas_y = _pas_local(large_y, res_die, fin)

    # -- x et y : fond d'air, structure plus fine ----------------------------
    # « Structure » et non « carte » : un boitier ou un fil ajoute a la main
    # rayonne autant que le cuivre, et un maillage d'air autour de lui ne le
    # represente pas. C'est aussi pourquoi un gros objet fait exploser le
    # nombre de cellules — le bilan le montre plutot que de le cacher.
    x = _lignes(boite["x1"], em[0], res_air)
    x += _lignes(em[0], em[3], res_die)
    x += _lignes(em[3], boite["x2"], res_air)
    y = _lignes(boite["y1"], em[1], res_air)
    y += _lignes(em[1], em[4], res_die)
    y += _lignes(em[4], boite["y2"], res_air)

    # -- les bandes fines, en travers du cuivre etroit -----------------------
    # LE FOND NE PASSE PAS SOUS UNE BANDE : elle l'y remplace, plus fin. Une
    # ligne du fond tombee dans une bande n'y decrit rien de plus -- la bande
    # a deja quatre lignes la ou le fond en avait une -- et elle y laisse une
    # cellule de quelques centiemes de millimetre, laquelle commande le pas de
    # temps de TOUT le domaine. Mesure sur vingt pistes de 0,5 mm : une ligne
    # du fond a 0,05 mm d'une ligne de marge, et le pas de temps divise par
    # deux et demi pour rien. Aucun filtrage ne saurait les distinguer apres
    # coup -- une ligne ne dit pas d'ou elle vient --, on ne les pose donc pas.
    if large_x:
        x = [v for v in x if not _dans(large_x, v)]
    if large_y:
        y = [v for v in y if not _dans(large_y, v)]
    # ET ELLES SONT DE L'AFFINAGE, PAS DU REMPLISSAGE, ce qui decide de l'ORDRE
    # dans lequel `_fusionner` les pose -- et l'ordre decide de qui cede a qui.
    # Rangees dans le remplissage, elles arrivaient dans la meme file que les
    # lignes du fond, triees par position : une ligne du fond posee juste avant
    # une ligne de marge etait jugee la premiere, donc gardee, et la marge
    # ensuite -- au seuil FIN, trois fois plus tolerant -- s'installait a 0,05
    # mm d'elle. Mesure sur vingt pistes de 0,5 mm : cellule de 0,05 mm pour un
    # pas fin de 0,125, et le pas de temps de tout le domaine avec elle. Posees
    # d'abord, ce sont les lignes du fond qui s'ecartent -- ce qu'elles doivent
    # faire, puisqu'il n'y a rien a decrire la ou la bande decrit deja.
    x_aff, y_aff = [], []
    for a, b in bx:
        x_aff += _bande_lignes(a, b, fin)
    for a, b in by:
        y_aff += _bande_lignes(a, b, fin)

    # -- z : chaque interface de l'empilage porte une ligne ------------------
    # Elles sont OBLIGATOIRES : une interface de substrat qui glisse parce
    # qu'une ligne d'air passait a cote, c'est un autre substrat.
    z_obl = [0.0, z_haut]
    z = []
    for c in modele["conducteurs"]:
        z_obl.append(c["z0"])
        z_obl.append(c["z1"])
    for d in modele["dielectriques"]:
        z_obl.append(d["z0"])
        z_obl.append(d["z1"])
    z += _lignes(boite["z1"], em[2], res_air)
    z += _lignes(em[2], 0.0, res_die)
    z += _lignes(z_haut, em[5], res_die)
    z += _lignes(em[5], boite["z2"], res_air)

    # -- les aretes du port, qui doivent tomber sur des lignes ---------------
    # Elles aussi sont obligatoires : un port dont une face a glisse sur la
    # ligne voisine n'excite plus le meme volume, et c'est le S11 entier qui
    # s'en ressent.
    x_obl, y_obl = [], []
    for p in modele["ports"]:
        x_obl += [p["x1"], p["x2"]]
        y_obl += [p["y1"], p["y2"]]
        z_obl += [p["z1"], p["z2"]]
        c = p.get("coax")
        if not c:
            continue
        # LE COAXIAL EST UNE GEOMETRIE RONDE DANS UNE GRILLE CARREE, et c'est
        # la seule facon de la rater : si aucune ligne ne tombe sur le rayon
        # de l'ame, le cylindre est rendu par les cellules qui l'approchent --
        # une ame de 0,635 mm dans une maille de 1 mm devient un carre de
        # 1 mm, ou disparait. On pose donc une ligne sur CHAQUE rayon, des
        # deux cotes de l'axe, plus trois lignes dans la couronne isolante :
        # c'est elle qui porte le champ du mode TEM.
        for r in (c["ra"], c["rm"], c["rb"], c["rb"] + c["ep_gaine"]):
            x_obl += [p["x"] - r, p["x"] + r]
            y_obl += [p["y"] - r, p["y"] + r]
        x_obl.append(p["x"])
        y_obl.append(p["y"])
        pas = (c["rb"] - c["ra"]) / 3.0
        for i in (1, 2):
            x += [p["x"] - c["ra"] - i * pas, p["x"] + c["ra"] + i * pas]
            y += [p["y"] - c["ra"] - i * pas, p["y"] + c["ra"] + i * pas]
        # Le fond du connecteur, le plan de la source et la sortie de carte :
        # trois cotes en z qu'un glissement d'une demi-cellule fausserait,
        # puisque c'est la longueur du troncon qui transforme l'impedance.
        z_obl += [c["z_bas"], c["z_mes"], c["z_gaine"], c["z_ame"]]
        z += _lignes(min(c["z_bas"], c["z_gaine"]),
                     max(c["z_bas"], c["z_gaine"]), res_die)

    # -- les aretes des objets hors carte ------------------------------------
    # Obligatoires pour la meme raison : une face de boitier qui glisse d'une
    # demi-cellule, c'est un boitier d'une autre taille. APRES le port, parce
    # que c'est lui qui cree x_obl et y_obl.
    for o in modele["primitives"]:
        e = _emprise_primitive(o)
        x_obl += [e[0], e[3]]
        y_obl += [e[1], e[4]]
        z_obl += [e[2], e[5]]

    # -- la regle du tiers aux aretes de cuivre ------------------------------
    # On ne la pose que sur les aretes qui bornent l'emprise du cuivre : poser
    # trois lignes sur chacun des sommets d'un plan de masse decoupe ferait
    # exploser le maillage.
    aretes_groupees = 0
    eps_aretes = 0.0
    # Les lignes de l'affinage tiennent leur propre liste : ce ne sont ni des
    # lignes qu'on ne peut pas bouger, ni du remplissage. Voir `_fusionner`.
    # Les bandes fines y sont deja.
    if modele["maillage_tiers"]:
        d = res_die / 3.0
        # LA TOLERANCE EST LA PLUS SERREE DES TROIS, ET CHACUNE DIT NON A UNE
        # FAUTE DIFFERENTE : le vingtieme du cuivre le plus etroit interdit de
        # confondre deux rubans voisins, le huitieme du pas vise interdit
        # d'effacer un raffinement que le maillage aurait vraiment demande, et
        # les cinquante microns interdisent de depasser ce qu'un fabricant
        # tient. Sur un dessin en ondes millimetriques, c'est la premiere qui
        # gagne et la tolerance descend avec le cuivre.
        largeur = (modele["resolution"].get("detail") or {}).get("largeur_cuivre") or 0.0
        eps_aretes = min(res_die / 8.0, EPS_ARETES_MM)
        if largeur > 0:
            eps_aretes = min(eps_aretes, largeur / 20.0)
        ax, ay = [], []
        for bloc in modele["cuivre"]:
            for poly in bloc["polys"]:
                xs = [q[0] for q in poly["o"]]
                ys = [q[1] for q in poly["o"]]
                ax += [min(xs), max(xs)]
                ay += [min(ys), max(ys)]
        ax, n_ax = _grouper(ax, eps_aretes)
        ay, n_ay = _grouper(ay, eps_aretes)
        aretes_groupees = n_ax + n_ay
        # PAS DE REGLE DU TIERS DANS UNE BANDE FINE, et ce n'est pas une
        # economie de lignes : la bande resout deja le ruban en plusieurs
        # cellules et son arete tombe sur une ligne. La paire du tiers n'y
        # decrirait rien de plus et poserait une cellule au tiers du pas FIN --
        # laquelle commanderait le pas de temps de tout le domaine. Ce serait
        # payer le raffinement une deuxieme fois, et sur tout le calcul.
        for v in ax:
            if _dans(bx, v):
                continue
            x_aff += [v - d, v + 2 * d]
        for v in ay:
            if _dans(by, v):
                continue
            y_aff += [v - d, v + 2 * d]
    modele["maillage_detail"] = {"eps_aretes": eps_aretes,
                                 "aretes_groupees": aretes_groupees,
                                 "bandes_x": len(bx), "bandes_y": len(by)}

    # Deux lignes plus proches que cela ne raffinent rien : elles coutent un
    # pas de temps, et LE PAS DE TEMPS EST COMMANDE PAR LA PLUS PETITE CELLULE
    # DE TOUT LE DOMAINE. Une seule cellule-copeau ralentit donc la simulation
    # entiere, sans rien decrire de plus.
    #
    # LE HUITIEME DU PAS VISE, ET PAS DAVANTAGE — ESSAYE, ET REGRETTE. Le
    # huitieme laisse subsister des cellules de 0,10 mm la ou le pas vise est
    # de 0,78, ce qui divise le pas de temps par 2,7 : la tentation de le
    # porter au tiers pour aller trois fois plus vite est forte. Elle coute le
    # resultat. Ces cellules-la ne sont pas du gaspillage : ce sont les lignes
    # que la regle du tiers pose de part et d'autre des aretes de cuivre, et
    # deux aretes voisines en produisent naturellement de tres rapprochees.
    # Les fusionner efface le raffinement des bords rayonnants. Mesure faite
    # sur le patch de l'exemple : au tiers, le creux de S11 tombe de -6,6 a
    # -2,1 dB et la resistance de resonance de 118 a 11 ohms. Le huitieme
    # laisse de la place a la regle du tiers sans laisser passer les
    # coordonnees presque confondues d'un fichier de CAO ; c'est tout ce qu'on
    # lui demande.
    # LE SEUIL DE L'AFFINAGE CONTRE LUI-MEME. Deux aretes de cuivre plus
    # proches que le pas vise demandent chacune leurs deux lignes, et ces
    # lignes-la se croisent : sur l'IFA, le bord du plan de masse (25,000) et
    # le bout du patin de court-circuit (24,700) — 0,3 mm d'ecart, deux aretes
    # bien reelles — posent 24,9167 et 24,8667, soit une cellule de 50 microns.
    # (Cotes de l'IFA d'avant : le gabarit pose aujourd'hui sa masse ailleurs,
    # mais la paire d'aretes rapprochees, elle, revient a chaque motif.)
    # La grille ne PEUT PAS mettre les deux aretes au tiers de leur cellule
    # sans descendre sous le pas vise ; insister rend une cellule mince qui
    # commande le pas de temps de toute la simulation. Le quart du pas est la
    # borne : la paire voulue autour d'UNE arete est espacee de 3d, c'est-a-
    # dire du pas vise entier, soit quatre fois ce seuil — elle ne peut donc
    # jamais se refermer sur elle-meme.
    #
    # ET DESORMAIS CES SEUILS SONT LOCAUX : dans une bande fine, c'est le pas
    # FIN qu'il faut diviser par quatre et par trois, sans quoi le seuil du
    # fond effacerait les lignes de la bande une par une. Voir `_pas_local`.
    mini_x, mini_y = _divise(pas_x, 4.0), _divise(pas_y, 4.0)
    # CE QU'UNE LIGNE DE REMPLISSAGE DOIT LAISSER A UNE LIGNE D'AFFINAGE :
    # exactement le decalage de la regle du tiers, `d = res_die / 3`. En deca,
    # la ligne reguliere tombe DANS le motif que la regle vient de dessiner
    # autour d'une arete : elle n'y decrit rien de plus et n'y laisse qu'une
    # cellule mince, qui commande alors le pas de temps de tout le domaine.
    #
    # LES QUATRE VALEURS ONT ETE MESUREES, sur l'IFA du gabarit (le maillage a
    # eprouver, dans les cotes qu'il avait alors) et sur le patch sonde du banc
    # (l'ajustement de Debye, qui se degrade des que le pas de temps grandit --
    # openEMS refuse tout pole plus rapide que trois pas de temps) :
    #
    #   seuil      IFA : cellules / dt        patch du banc : poles, ecart tan(d)
    #   res_die/2  2 784 804 / 0,235 ps       7 poles, 1,42 %
    #   res_die/3  2 921 314 / 0,235 ps       8 poles, 0,64 %      <- retenu
    #   res_die/4  3 090 528 / 0,163 ps       8 poles, 0,53 %
    #   res_die/6  3 247 405 / 0,108 ps       8 poles, 0,29 %
    #
    # Le tiers prend tout le gain de pas de temps (0,108 -> 0,235 ps, deux fois
    # moins de pas a calculer) pour cinq pour cent de cellules de plus que le
    # demi, et il laisse au modele de pertes ses huit poles. Descendre plus bas
    # ne rend rien : a res_die/6 on est revenu au point de depart.
    remp_x, remp_y = _divise(pas_x, 3.0), _divise(pas_y, 3.0)
    # LE LISSAGE EN DERNIER, ET APRES LA FUSION : il raisonne sur les cellules
    # telles qu'elles seront, et une ligne supprimee apres coup rouvrirait la
    # marche qu'il vient de combler.
    # LE PLANCHER DU LISSAGE EST LE PAS VISE LUI-MEME, et ce choix vaut un
    # facteur deux sur le calcul. Une cellule plus fine que le pas vise est un
    # ACCIDENT LOCAL — deux aretes de cuivre voisines, l'epaisseur d'un
    # conducteur — et non une consigne de finesse : la laisser propager sa
    # taille de proche en proche ferait remonter tout le voisinage avec elle.
    # Mesure faite sur l'exemple : plancher au quart du pas, le lissage coute
    # 2,7 fois le maillage ; plancher au pas, il en coute 1,45 — et il comble
    # les memes marches, celles qui separent la carte de l'air.
    mx = _lisser(_fusionner(x, mini_x, x_obl, x_aff, remp_x), pas_x)
    my = _lisser(_fusionner(y, mini_y, y_obl, y_aff, remp_y), pas_y)

    # -- z : les cellules du substrat, apres le plan et a cause de lui -------
    # AU MOINS TROIS CELLULES DANS UN SUBSTRAT, ET CETTE FOIS ELLES SURVIVENT.
    # Une seule ne represente pas le champ qui se courbe sous une piste -- or
    # c'est ce champ-la qui fait l'impedance de la ligne. L'intention etait
    # ecrite ici depuis toujours et n'avait jamais eu lieu : ces lignes etaient
    # rangees dans le REMPLISSAGE, et sur une grande carte le pas de fond
    # (0,6 mm) est plus epais que le substrat lui-meme (0,37 mm), si bien que
    # le seuil du tiers les effacait toutes les trois. Elles sont donc de
    # l'AFFINAGE -- une finesse demandee, pas un remplissage.
    #
    # LE PLANCHER EN Z EST LA MOITIE DE LA PLUS PETITE CELLULE DU PLAN, et ce
    # n'est pas un chiffre en l'air : le pas de temps suit
    # 1/racine(1/dx^2 + 1/dy^2 + 1/dz^2), donc une cellule en z deux fois plus
    # fine que la plus fine du plan pese quatre contre deux -- un facteur 1,4
    # au plus sur le pas de temps, pour les trois cellules qui decrivent le
    # champ sous le ruban. En dessous de ce plancher, c'est le z qui
    # commanderait le pas de temps de tout le domaine : c'est exactement ce que
    # faisait le vernis de 15 microns.
    plan = min(_plus_petit(mx), _plus_petit(my))
    plancher_z = plan / 2.0 if plan > 0 else 0.0
    z_aff = []
    for d in modele["dielectriques"]:
        n = max(1, int(math.ceil(d["ep"] / res_die)))
        if plancher_z > 0:
            n = max(n, min(CELLULES_PAR_SUBSTRAT,
                           int(d["ep"] / plancher_z)))
        for i in range(1, n):
            z_aff.append(d["z0"] + d["ep"] * i / n)
    mini_z = plancher_z if plancher_z > 0 else res_die / 4.0
    mz = _lisser(_fusionner(z, mini_z, z_obl, z_aff, res_die / 3.0), res_die)
    return mx, my, mz


def _plus_petit(lignes):
    """La plus petite cellule d'une liste de lignes."""
    return min((lignes[i + 1] - lignes[i] for i in range(len(lignes) - 1)),
               default=0.0)


def _coller(lignes, v):
    """La ligne de maillage la plus proche de `v`."""
    i = _place(lignes, v)
    cands = [lignes[j] for j in (i - 1, i) if 0 <= j < len(lignes)]
    return min(cands, key=lambda w: abs(w - v)) if cands else v


def _coller_ports(modele):
    """Colle les cotes des ports SUR les lignes de maillage, exactement.

    UNE BOITE D'EXCITATION EST PLATE DANS DEUX DIRECTIONS, et c'est ce qui
    rend ce detail mortel. openEMS cherche dans cette boite une composante de
    champ a exciter ; une boite d'epaisseur nulle posee a quatre MICRONS de la
    ligne de maillage n'en contient aucune. Le solveur le dit une fois --
    « Unused primitive (type: Box) detected in property: port_excite_1 » --,
    au milieu de trois cents lignes de demarrage, puis il calcule jusqu'au
    bout un champ rigoureusement nul : energie a 0,00e+00 d'un bout a l'autre,
    aucune resonance, et tout le temps de calcul depense. C'est la panne la
    plus chere que cet outil puisse produire, et la moins visible.

    D'OU VENAIENT LES QUATRE MICRONS. De deux arrondis qui ne se parlaient
    pas : `_fusionner` arrondit les lignes obligatoires au milliardieme de
    millimetre, et le script ecrivait les lignes de maillage a cinq decimales
    quand il ecrivait les cotes du port a six. Un port a y = 30,111544 tombait
    sur une grille qui disait 30,11154, et personne ne pouvait le voir en
    relisant l'un ou l'autre : il fallait comparer les deux. Le port d'une
    antenne dessinee a la main tombe souvent sur un compte rond et ne montrait
    rien ; celui du patch d'essai, dont la cote sort d'une formule, tombait a
    cote a chaque fois.

    DEUX VERROUS, ET IL EN FAUT DEUX. Ici, les cotes sont collees sur la
    ligne -- elles y etaient posees en obligatoires, l'ecart n'est qu'un
    arrondi. Dans le script, les lignes et les cotes s'ecrivent desormais a la
    MEME precision : deux nombres egaux dans le modele doivent s'ecrire
    pareil, sans quoi le collage d'ici ne survit pas a l'impression.

    Rend le plus grand deplacement, pour que l'assistant puisse crier si ce
    n'etait pas un arrondi.
    """
    mx = modele["maillage"]["x"]
    my = modele["maillage"]["y"]
    mz = modele["maillage"]["z"]
    pire = 0.0
    for p in modele["ports"]:
        cotes = [("x1", mx), ("x2", mx), ("y1", my), ("y2", my),
                 ("z1", mz), ("z2", mz)]
        if "x" in p:
            cotes += [("x", mx), ("y", my)]
        for cle, lignes in cotes:
            v = _coller(lignes, p[cle])
            pire = max(pire, abs(v - p[cle]))
            p[cle] = v
        c = p.get("coax")
        if not c:
            continue
        for cle in ("z_bas", "z_mes", "z_gaine", "z_ame"):
            if cle not in c:
                continue
            v = _coller(mz, c[cle])
            pire = max(pire, abs(v - c[cle]))
            c[cle] = v
    return pire


def _cout(est, bande):
    """Le prix d'un maillage, en cellules-pas de temps.

    C'EST LA SEULE GRANDEUR QUI MESURE VRAIMENT CE QUE COUTE UN MAILLAGE. Le
    nombre de cellules seul n'en dit que la moitie : l'autre moitie est dans le
    NOMBRE DE PAS, c'est-a-dire dans la plus petite cellule du domaine. Un
    maillage deux fois plus fin dans une seule bande coute peu de cellules et
    peut couter le double de pas.

    ET C'EST LA SEULE QUI NE DEPENDE PAS DE LA MACHINE. Une duree en heures
    suppose un debit, et le debit de ce poste se mesure et remonte des qu'un
    calcul y finit (voir `noter_debit`) : un maillage qui changerait parce
    qu'une autre simulation a fini serait une surprise tres desagreable. Le
    nombre de pas est celui de `duree_estimee`, pour que le budget et la duree
    annoncee parlent de la meme chose.
    """
    dt = est.get("dt_s") or 0.0
    f0 = bande.get("f0") or bande.get("fcible") or 0.0
    if dt <= 0 or f0 <= 0 or not est.get("cellules"):
        return 0.0
    return est["cellules"] * max(2000.0, 20.0 / (f0 * dt))


def _bilan_pistes(cuivre, res_die, fin, bx, by):
    """Comment chaque polygone est resolu PAR LA GRILLE QUI LE CONCERNE.

    PAS LE PLUS ETROIT : LE PLUS MAL RESOLU. Ce n'est plus la meme question
    depuis qu'il y a deux pas dans le plan. Un ruban de 0,5 mm dans une bande a
    0,13 mm en a quatre en travers ; un ruban de 1,2 mm laisse au pas de fond
    de 0,6 n'en a que deux, et c'est celui-la qu'il faut nommer. Les deux avis
    qui parlaient de largeur de cuivre comparaient tout au pas de fond : l'un
    annoncait « resolu » ce qui ne l'etait pas, l'autre « ignore » ce qu'une
    bande venait de sauver.

    Rend le pire cas (largeur, cellules en travers) et le compte de ceux qu'
    openEMS laissera tomber faute d'une cellule entiere.
    """
    pire = None
    ignores, plus_petit = 0, None
    for bloc in cuivre:
        for poly in bloc.get("polys", ()):
            pts = poly.get("o") or ()
            if len(pts) < 3:
                continue
            xs = [q[0] for q in pts]
            ys = [q[1] for q in pts]
            x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
            cas = None
            for larg, deb, bandes in ((x1 - x0, x0, bx), (y1 - y0, y0, by)):
                if larg <= 1e-9:
                    continue
                pas = fin if (fin > 0 and _dans(bandes, deb)) else res_die
                n = larg / pas
                if cas is None or n < cas[1]:
                    cas = (larg, n)
            if cas is None:
                continue
            if pire is None or cas[1] < pire[1]:
                pire = cas
            if cas[1] < 1.0:
                ignores += 1
                plus_petit = (cas[0] if plus_petit is None
                              else min(plus_petit, cas[0]))
    return {"largeur": pire[0] if pire else 0.0,
            "cellules": pire[1] if pire else 0.0,
            "ignores": ignores, "ignore_mm": plus_petit or 0.0}


def _mailler(modele, bande, res_air, res_die):
    """Le maillage, et le budget qui borne son affinage local.

    POURQUOI UNE BOUCLE, ET NON UNE FORMULE. Le prix d'un raffinement ne se
    calcule pas d'avance : il depend du nombre de bandes, de leurs
    chevauchements, des lignes que la fusion supprimera, de celles que le
    lissage ajoutera, et surtout de la plus petite cellule qui en sortira --
    laquelle commande le nombre de pas. On construit donc le maillage, on le
    chiffre, et on RECULE d'un cran tant qu'il depasse le budget. Un maillage
    coute quelques millisecondes a construire ; une vingtaine d'essais ne se
    voit pas, et c'est le seul moyen de tenir une promesse chiffree.

    LE BUDGET A DEUX BORNES, ET LA PLUS SERREE GAGNE : un plafond absolu
    (CELLULES_PAS_MAX, de quoi ne pas lancer une nuit de calcul sans l'avoir
    demande) et un plafond RELATIF au maillage de fond (AFFINAGE_COUT_MAX) --
    sans lui, une petite carte dont le fond coute trois minutes se verrait
    affinee cent fois, ce qui est exactement « exploser le temps de
    simulation ». Et le maillage de fond passe toujours : on refuse d'affiner,
    jamais de calculer.
    """
    det = modele["resolution"].setdefault("detail", {})
    largeur = det.get("largeur_cuivre") or 0.0
    voulu = (largeur / CELLULES_PAR_PISTE) if largeur > 0 else 0.0
    det["fin_voulu"] = voulu
    det["fin"] = 0.0
    det["fin_borne"] = False
    det["cout_fond"] = 0.0
    det["cout"] = 0.0

    fond = _maillage(modele, bande, res_air, res_die)
    cout_fond = _cout(_estimation(fond[0], fond[1], fond[2], res_die), bande)
    det["cout_fond"] = cout_fond
    det["cout"] = cout_fond
    if voulu <= 0 or voulu >= res_die:
        # Le fond resout deja le cuivre le plus etroit : il n'y a rien a
        # affiner, et le chemin reste celui d'avant, ligne pour ligne.
        det["pistes"] = _bilan_pistes(modele["cuivre"], res_die, 0.0, [], [])
        return fond

    bandes = _bandes_fines(modele["cuivre"], CELLULES_PAR_PISTE * res_die)
    if not (bandes["x"] or bandes["y"]):
        det["pistes"] = _bilan_pistes(modele["cuivre"], res_die, 0.0, [], [])
        return fond

    budget = max(cout_fond, min(CELLULES_PAS_MAX,
                                cout_fond * AFFINAGE_COUT_MAX))
    fin = voulu
    for _ in range(AFFINAGE_ESSAIS):
        if fin >= res_die:
            break
        # LES BANDES QUI SURVIVENT A CE PAS-LA, ET ELLES SEULES. Une bande plus
        # mince que le pas fin est abandonnee (voir `_maillage`) : quand il n'en
        # reste plus aucune, il n'y a plus d'affinage a chiffrer -- et
        # continuer a reculer annoncerait un pas fin qui ne maille rien.
        bx = [t for t in bandes["x"] if t[1] - t[0] >= fin]
        by = [t for t in bandes["y"] if t[1] - t[0] >= fin]
        if not (bx or by):
            break
        essai = _maillage(modele, bande, res_air, res_die, fin, bandes)
        cout = _cout(_estimation(essai[0], essai[1], essai[2], res_die), bande)
        if cout <= budget:
            det["fin"] = fin
            det["fin_borne"] = fin > voulu * 1.001
            det["cout"] = cout
            det["pistes"] = _bilan_pistes(modele["cuivre"], res_die,
                                          fin, bx, by)
            return essai
        fin *= AFFINAGE_RECUL
    # Aucun pas fin ne tient dans le budget : le fond, et l'avis le dira.
    # ON LE RECONSTRUIT, et ce n'est pas du gaspillage : `_maillage` ecrit dans
    # `modele["maillage_detail"]` a chaque appel, et le dernier essai y a laisse
    # SES bandes. Rendre le fond en laissant parler d'un affinage qui n'a pas
    # eu lieu, c'est le genre de chiffre qu'on croit et qu'on ne verifie pas.
    det["fin_borne"] = True
    det["pistes"] = _bilan_pistes(modele["cuivre"], res_die, 0.0, [], [])
    return _maillage(modele, bande, res_air, res_die)


# ==========================================================================
# Les pertes dielectriques
# ==========================================================================

def _kappa(er, df, f):
    """Conductivite equivalente d'un dielectrique a pertes, a la frequence f."""
    return 2.0 * math.pi * f * EPS0 * er * df


def _eps_debye(eps_inf, poles, f):
    """Permittivite complexe du jeu de poles, a la frequence f."""
    w = 2.0 * math.pi * f
    re, im = eps_inf, 0.0
    for de, tau in poles:
        d = 1.0 + (w * tau) ** 2
        re += de / d
        im -= de * w * tau / d
    return re, im


def _debye(er, df, f1, f2, dt_s):
    """Un jeu de poles de Debye qui rend tan(delta) plat sur [f1, f2].

    LA FORMULE ASYMPTOTIQUE NE SUFFIT PAS. La distribution continue donne
    tan(d) ~ (pi/2).(d_eps_total / ln(tau_max/tau_min)) / er, et c'est de
    l'ordre de DIX POUR CENT trop bas des qu'on la discretise sur quatre
    poles : le nombre fini de poles et la plage finie de tau y mordent tous
    les deux. On s'en sert comme point de depart, puis on CALIBRE -- eps''
    est lineaire en d_eps et eps' est tenu a er par construction, si bien que
    quelques tours suffisent a tomber sur la valeur visee.

    Rend None quand la borne du pas de temps ne laisse pas de place.
    """
    tau_max = 1.0 / (2.0 * math.pi * (f1 / 10.0 ** DEBYE_DECADES))
    tau_min = 1.0 / (2.0 * math.pi * (f2 * 10.0 ** DEBYE_DECADES))

    borne = DEBYE_TAU_SUR_DT * dt_s
    bornee = tau_min < borne
    if bornee:
        tau_min = borne
    if tau_min >= tau_max / 1.5:
        return None

    etendue = math.log10(tau_max / tau_min)
    n = int(round(DEBYE_POLES_PAR_DECADE * etendue))
    n = max(DEBYE_POLES_MIN, min(DEBYE_POLES_MAX, n))

    L = math.log(tau_max / tau_min)
    taus = [tau_min * math.exp(L * (i + 0.5) / n) for i in range(n)]

    f_ref = math.sqrt(f1 * f2)
    de = (2.0 / math.pi) * er * df * L / n          # depart asymptotique
    eps_inf = er
    for _ in range(8):
        poles = [(de, t) for t in taus]
        eps_inf = er - (_eps_debye(0.0, poles, f_ref)[0])
        re, im = _eps_debye(eps_inf, poles, f_ref)
        obtenu = -im / re if re > 0 else 0.0
        if obtenu <= 0:
            break
        de *= df / obtenu

    poles = [(de, t) for t in taus]
    eps_inf = er - (_eps_debye(0.0, poles, f_ref)[0])

    # CE QUE LE JEU VAUT VRAIMENT, mesure et non suppose : on parcourt la
    # bande et on garde les ecarts les plus grands. C'est ce chiffre que la
    # page affiche, pas la promesse du modele.
    pire_d, pire_e = 0.0, 0.0
    for i in range(41):
        f = f1 * (f2 / f1) ** (i / 40.0)
        re, im = _eps_debye(eps_inf, poles, f)
        if re <= 0:
            continue
        pire_d = max(pire_d, abs((-im / re) / df - 1.0))
        pire_e = max(pire_e, abs(re / er - 1.0))

    return {
        "eps_inf": eps_inf,
        "poles": [{"de": d, "tau": t} for d, t in poles],
        "ecart_tand_pc": 100.0 * pire_d,
        "ecart_er_pc": 100.0 * pire_e,
        "borne_par_dt": bornee,
        "tau_min": taus[0], "tau_max": taus[-1],
    }


def _pertes(doc, dielectriques, bande, dt_s):
    """Complete chaque dielectrique avec son modele de pertes.

    Rend le mode retenu et ce qu'il coute en justesse. Le mode « debye »
    peut echouer par manque de place entre le pas de temps et la bande : on
    retombe alors sur kappa EN LE DISANT, plutot que de rendre un materiau
    dont les poles seraient sautes en silence par le solveur.
    """
    p = _dict(doc.get("pertes"))
    mode = (_texte(p.get("mode"), 10) or "kappa").lower()
    if mode not in ("kappa", "debye"):
        mode = "kappa"
    f_kappa = _nb_pos(p.get("f_kappa"), 0.0) or bande["f0"]
    f_kappa = max(bande["f1"] * 0.1, min(bande["f2"] * 10.0, f_kappa))

    replis = []
    for d in dielectriques:
        d["kappa"] = _kappa(d["er"], d["df"], f_kappa)
        d["debye"] = None
        if mode != "debye" or d["df"] <= 0:
            continue
        jeu = _debye(d["er"], d["df"], bande["f1"], bande["f2"], dt_s)
        if jeu is None:
            replis.append(d["nom"])
        else:
            d["debye"] = jeu

    # L'ERREUR DE kappa SE CHIFFRE SANS RIEN CALCULER : a kappa constant,
    # tan(d) varie comme 1/f. Au bord bas de la bande il vaut f_kappa/f1 fois
    # la valeur visee, au bord haut f_kappa/f2 fois.
    ecart = max(abs(f_kappa / bande["f1"] - 1.0),
                abs(f_kappa / bande["f2"] - 1.0)) * 100.0

    return {
        "mode": mode,
        "f_kappa": f_kappa,
        "ecart_kappa_pc": ecart,
        "replis": replis,
        # Ce que le mode Debye a reellement obtenu, pire cas sur les couches.
        "ecart_debye_pc": max([d["debye"]["ecart_tand_pc"]
                               for d in dielectriques if d.get("debye")] or [0.0]),
        "actif": any(d.get("debye") for d in dielectriques),
    }


# ==========================================================================
# Les enregistrements de champ
# ==========================================================================
# CE QU'ON VIENT CHERCHER ICI. Un S11 dit que l'antenne resonne a 2,37 GHz ;
# il ne dit pas POURQUOI. La carte du courant de surface, elle, montre d'un
# coup d'oeil ou il circule -- et l'on voit tout de suite qu'il fait le tour
# d'une fente qu'on n'avait pas remarquee, ou qu'il se perd dans un plan de
# masse trop court.
#
# LE DOMAINE FREQUENTIEL PLUTOT QUE TEMPOREL, ET DE LOIN. Un enregistrement
# frequentiel rend UN champ complexe par frequence demandee : quelques
# fichiers, quelques mega-octets. Un enregistrement temporel rend un fichier
# PAR PAS DE TEMPS -- des dizaines de milliers -- et remplit un disque en
# quelques minutes. Le temporel ne sert qu'a faire une animation ; pour
# comprendre, le frequentiel suffit et coute mille fois moins.
DUMP_TYPES = {
    # nom    (type temporel, type frequentiel, libelle)
    "E": (0, 10, "champ electrique"),
    "H": (1, 11, "champ magnetique"),
    "J": (2, 12, "densite de courant"),
    "I": (3, 13, "courant total (rot H)"),
}
DUMP_REGIONS = ("structure", "plan_z", "coupe_x", "coupe_y", "boite")
# Un flottant simple precision par composante, trois composantes par cellule.
OCTETS_PAR_CELLULE_DUMP = 12.0


def _dumps(doc, emprise, boite, bande, mx, my, mz, nmax=0):
    """Ce qu'on enregistre du champ, et ce que cela coutera en disque."""
    d = _dict(_dict(doc).get("dumps"))
    if not d.get("actif"):
        return {"actif": False}

    types = [t for t in _liste(d.get("types")) if t in DUMP_TYPES] or ["J"]
    mode = (_texte(d.get("mode"), 14) or "frequentiel").lower()
    if mode not in ("frequentiel", "temporel"):
        mode = "frequentiel"
    region = (_texte(d.get("region"), 12) or "structure").lower()
    if region not in DUMP_REGIONS:
        region = "structure"
    sous = max(1, min(20, int(_nb_pos(d.get("sous_ech"), 2))))

    x1, y1, z1, x2, y2, z2 = emprise
    if region == "boite":
        x1, y1, z1 = boite["x1"], boite["y1"], boite["z1"]
        x2, y2, z2 = boite["x2"], boite["y2"], boite["z2"]
    elif region == "plan_z":
        # Un plan horizontal : c'est la vue qui montre le courant sur le
        # cuivre, et c'est celle qu'on regarde neuf fois sur dix.
        z = _nb(d.get("z"), 0.0) * (25.4 if str(doc.get("unite", "")).lower()
                                    .startswith("in") else 1.0)
        z1 = z2 = z
    elif region == "coupe_x":
        x1 = x2 = _nb(d.get("x"), (x1 + x2) / 2.0)
    elif region == "coupe_y":
        y1 = y2 = _nb(d.get("y"), (y1 + y2) / 2.0)

    def cellules(lignes, a, b):
        n = sum(1 for v in lignes if a - 1e-9 <= v <= b + 1e-9)
        return max(1, n)

    nc = (cellules(mx, x1, x2) * cellules(my, y1, y2) * cellules(mz, z1, z2))
    nc = max(1, nc // (sous ** 3) if region == "boite" or z1 != z2 else nc // (sous ** 2))

    freqs = [f for f in (_nb_pos(v, 0.0) for v in _liste(d.get("f"))) if f] \
        or [bande["fcible"]]

    # LE POIDS SUR LE DISQUE, ANNONCE AVANT ET NON DECOUVERT APRES. En
    # temporel, openEMS ecrit un fichier par pas de temps : le facteur n'est
    # pas le nombre de frequences mais le nombre de PAS.
    if mode == "frequentiel":
        octets = nc * OCTETS_PAR_CELLULE_DUMP * len(freqs) * 2 * len(types)
    else:
        # LE NOMBRE DE PAS RESOLU, et non celui du document : a zero, le
        # document dit « calcule-le », et chiffrer le disque sur un defaut
        # annoncerait des gigaoctets qui ne correspondent a aucun calcul.
        octets = nc * OCTETS_PAR_CELLULE_DUMP * (
            nmax or _nb_pos(_dict(doc.get("arret")).get("nmax"),
                            NMAX_DEFAUT)) * len(types)

    return {
        "actif": True, "types": types, "mode": mode, "region": region,
        "sous_ech": sous, "f": freqs,
        "x1": x1, "y1": y1, "z1": z1, "x2": x2, "y2": y2, "z2": z2,
        "cellules": nc, "octets": octets,
    }


def _estimation(mx, my, mz, res_die):
    """Cellules, memoire, pas de temps et duree — avec ce que ces chiffres
    valent, dit sans detour : le pas de temps est celui de Courant sur la
    plus petite cellule, la duree est un ordre de grandeur."""
    nx, ny, nz = len(mx), len(my), len(mz)
    cellules = max(0, (nx - 1)) * max(0, (ny - 1)) * max(0, (nz - 1))

    def plus_petit(t):
        return min((t[i + 1] - t[i] for i in range(len(t) - 1)), default=res_die)

    dx = plus_petit(mx) / 1000.0             # mm -> m
    dy = plus_petit(my) / 1000.0
    dz = plus_petit(mz) / 1000.0
    # Condition de Courant-Friedrichs-Lewy en 3D, dans le vide.
    dt = 1.0 / (C0 * math.sqrt(1.0 / dx ** 2 + 1.0 / dy ** 2 + 1.0 / dz ** 2))
    return {
        "lignes": [nx, ny, nz],
        "cellules": cellules,
        "memoire_Mo": cellules * OCTETS_PAR_CELLULE / 1048576.0,
        "plus_petite_cellule_mm": [dx * 1000.0, dy * 1000.0, dz * 1000.0],
        "dt_s": dt,
        # Le debit sur lequel la duree est annoncee, et D'OU IL VIENT. La page
        # le dit : « ordre de grandeur » sur une valeur supposee n'est pas la
        # meme promesse que « mesure sur ce poste ».
        "mcps_suppose": debit_suppose(),
        "mcps_mesure": debit_mesure() is not None,
        "mcps_n": debit_n(),
    }


# ==========================================================================
# Le point d'entree
# ==========================================================================

def normaliser(doc):
    """Document de la page -> modele complet, verifie et chiffre.

    Leve ErreurModele avec un message et un conseil quand le document ne
    decrit pas une simulation qu'on puisse lancer.
    """
    if not isinstance(doc, dict):
        raise ErreurModele("Document JSON (objet) attendu.")

    unite = (_texte(doc.get("unite"), 12) or "mm").lower()
    k_mm = 25.4 if unite.startswith("in") else 1.0

    # Comment le cuivre est modelise. « feuille » par defaut : une surface
    # sans epaisseur qui porte quand meme la resistance du cuivre reel.
    modele_cu = (_texte(doc.get("modele_cuivre"), 12) or "feuille").lower()
    if modele_cu not in ("feuille", "pec", "volume"):
        modele_cu = "feuille"

    (conducteurs, dielectriques, z_haut,
     supposes, revetements) = _empilage(doc, k_mm, modele_cu)
    cuivre, boite_cu, n_polys = _cuivre(doc, conducteurs, k_mm)
    vias = _vias(doc, conducteurs, k_mm)
    bande = _bande(doc)
    ports = _ports(doc, conducteurs, dielectriques, k_mm, boite_cu)
    # LE PORT EXCITE RESTE ACCESSIBLE SOUS SON ANCIEN NOM. C'est lui que la
    # vue 3D dessine en rouge, lui que l'export Touchstone nomme, lui dont
    # l'assistant recapitule le volume : tout ce qui ne parle que d'UN port
    # parle de celui-la, et n'a pas eu a changer.
    port = next(p for p in ports if p["excite"])
    primitives = _primitives(doc, k_mm)

    # L'EMPRISE EST L'UNION DE TOUT CE QUI EXISTE, et pas seulement du cuivre :
    # une marge d'air mesuree depuis la carte seule laisserait un boitier ou
    # un fil DANS la couche absorbante — c'est-a-dire hors du calcul, sans
    # que rien ne le dise.
    emprise = [boite_cu[0], boite_cu[1], 0.0,
               boite_cu[2], boite_cu[3], z_haut]
    for e in ([_emprise_primitive(o) for o in primitives]
              + [_emprise_port(p) for p in ports]):
        for k in range(3):
            emprise[k] = min(emprise[k], e[k])
            emprise[k + 3] = max(emprise[k + 3], e[k + 3])

    # LA RESOLUTION AVANT LA BOITE, ET NON L'INVERSE : l'epaisseur de la PML
    # vaut N cellules, donc la marge conseillee depend du pas de maillage.
    er_max = max([d["er"] for d in dielectriques] or [1.0])
    res_air, res_die, res_detail = _resolution(bande, er_max, cuivre, boite_cu)
    m = _dict(doc.get("maillage"))
    res_air_saisi = _nb_pos(m.get("res_air"), 0.0) * k_mm
    res_air = res_air_saisi or res_air
    res_detail["saisi_air"] = bool(res_air_saisi)
    # UNE VALEUR SAISIE RESTE UNE VALEUR SAISIE. Les bornes ci-dessus sont des
    # defauts calcules : si l'utilisateur a ecrit un pas, c'est le sien qui
    # part au solveur, meme plus grossier -- il sait ce qu'il eprouve.
    res_die_saisi = _nb_pos(m.get("res_die"), 0.0) * k_mm
    res_die = res_die_saisi or res_die
    res_detail["saisi"] = bool(res_die_saisi)
    boite = _boite(doc, emprise, bande, res_air, k_mm)
    tiers = m.get("tiers")
    tiers = TIERS_DEFAUT if tiers is None else bool(tiers)

    arret = _dict(doc.get("arret"))
    nf2ff = _dict(doc.get("nf2ff"))

    modele = {
        "format": "openems-antenne-1",
        "nom": _texte(doc.get("nom"), 200),
        "unite_mm": k_mm,
        "modele_cuivre": modele_cu,
        "conducteurs": conducteurs,
        "dielectriques": dielectriques,
        "z_haut": z_haut,
        "cuivre": cuivre,
        "vias": vias,
        "boite_cuivre": boite_cu,
        "emprise": emprise,
        "primitives": primitives,
        "port": port,
        "ports": ports,
        "bande": bande,
        "boite": boite,
        "maillage_tiers": tiers,
        "resolution": {"air": res_air, "die": res_die,
                       "er_max": er_max,
                       "detail": res_detail,
                       "lambda_min_mm": C0 / bande["f2"] * 1000.0,
                       "lambda_max_mm": C0 / bande["f1"] * 1000.0},
        "arret": {
            # L'ENERGIE D'ARRET EST NEGATIVE, ET C'EST TOUT LE PIEGE. Elle
            # s'ecrit en decibels sous le maximum : -40 dB, -50 dB pour un
            # resonateur a fort Q. La page l'envoie donc toujours negative
            # (voir `ANT.arret.energie = -Math.abs(v)` dans 13-assistant.js).
            # La passer a `_nb_pos`, qui rend son defaut des que la valeur est
            # <= 0, rendait le champ MUET : toute saisie retombait sur -40, y
            # compris le -50 dB que l'interface conseille elle-meme. C'est
            # `_nb` qu'il faut, et le `or` ne couvre que le zero — une bande
            # d'arret nulle n'arreterait jamais rien.
            #
            # LE SIGNE EST NORMALISE ET NON EXIGE : ecrire 50 ou -50 veut dire
            # la meme chose pour qui parle de « cinquante decibels sous le
            # maximum », et refuser l'un des deux ne protegerait de rien.
            # La VALEUR, elle, n'est pas bornee : une valeur saisie reste une
            # valeur saisie, comme pour le pas de maillage plus haut.
            "energie_dB": -abs(_nb(arret.get("energie"), ENERGIE_DEFAUT)
                               or ENERGIE_DEFAUT),
            # ZERO VEUT DIRE « CALCULE-LE », comme partout ailleurs dans ce
            # document -- un pas de maillage a zero veut deja dire « au
            # mailleur de decider ». Le compteur est le seul reglage dont la
            # bonne valeur ne se devine pas : elle depend du pas de temps,
            # donc du maillage, donc de la geometrie. Trente mille pas etaient
            # de trop pour un monopole et trois fois trop peu pour un IFA
            # finement maille, et rien dans le nombre ne le disait. Il est
            # resolu plus bas, une fois le pas de temps connu.
            "nmax": int(_nb_pos(arret.get("nmax"), 0)),
        },
        "nf2ff": {
            "actif": bool(nf2ff.get("actif")),
            # Les angles sont en degres dans le document, en radians nulle
            # part : c'est la page qui les affiche, autant qu'ils restent
            # lisibles de bout en bout.
            "theta": [float(v) for v in _liste(nf2ff.get("theta"))] or
                     [float(i) for i in range(-180, 181, 2)],
            "phi": [float(v) for v in _liste(nf2ff.get("phi"))] or [0.0, 90.0],
            "f": [_nb_pos(v, 0.0) for v in _liste(nf2ff.get("f")) if _nb_pos(v, 0.0)]
                 or [bande["fcible"]],
        },
        "supposes": supposes,
        # Les revetements exterieurs de l'empilage, gardes ou non, avec ce qui
        # l'a decide. La page en fait une ligne par couche et une case a
        # cocher ; l'avis, plus bas, nomme ceux qui sont sortis.
        "revetements": revetements,
        "stats": {"polygones": n_polys, "vias": len(vias),
                  "couches_cuivre": len(cuivre),
                  "primitives": len(primitives)},
    }

    mx, my, mz = _mailler(modele, bande, res_air, res_die)
    modele["maillage"] = {"x": mx, "y": my, "z": mz}
    # LES COTES DES PORTS, COLLEES SUR LES LIGNES DE MAILLAGE. Un ecart de
    # quatre microns suffit a ce qu'une boite d'excitation plate n'excite plus
    # rien du tout, sans autre signe qu'un avertissement noye au demarrage et
    # une energie nulle. Voir `_coller_ports`.
    modele["ports_colles_mm"] = _coller_ports(modele)
    modele["estimation"] = _estimation(mx, my, mz, res_die)
    # QUI FABRIQUE LA PLUS PETITE CELLULE -- la question que l'avis et le
    # rapport posaient chacun de son cote, et a laquelle le modele repond
    # desormais une fois pour toutes. Voir `_coupable_cellule`.
    modele["estimation"]["cellule"] = _coupable_cellule(modele)

    # -- le compteur de pas, calcule si on ne l'a pas impose -----------------
    # APRES L'ESTIMATION, PARCE QU'IL FAUT LE PAS DE TEMPS. L'impulsion dure un
    # temps physique fixe -- il ne depend que de la largeur de bande -- mais le
    # nombre de PAS qu'elle occupe depend de dt, c'est-a-dire de la plus petite
    # cellule. C'est toute la raison pour laquelle un nombre saisi une fois ne
    # vaut plus rien des qu'on retouche le maillage.
    dt_s = modele["estimation"]["dt_s"]
    t_exc = bande.get("t_excitation") or 0.0
    f_res = bande.get("fcible") or bande.get("f0") or 0.0
    # DEUX CRITERES, ET C'EST LE PLUS GRAND QUI GAGNE : le temps d'emettre
    # l'impulsion, et le temps de l'oublier. Voir NMAX_PERIODES.
    n_imp = (NMAX_IMPULSIONS * t_exc / dt_s) if (dt_s > 0 and t_exc > 0) else 0.0
    n_dec = (NMAX_PERIODES / (f_res * dt_s)) if (dt_s > 0 and f_res > 0) else 0.0
    if n_imp > 0 or n_dec > 0:
        nmax_calcule = max(NMAX_PLANCHER, int(math.ceil(max(n_imp, n_dec))))
    else:
        nmax_calcule = NMAX_DEFAUT
    # IL EST CALCULE MEME QUAND IL EST IMPOSE, et la page s'en sert pour dire
    # a cote d'un nombre saisi celui que le modele proposait. Un reglage qu'on
    # impose sans voir ce qu'on refuse n'est pas un reglage, c'est un pari.
    modele["arret"]["nmax_calcule"] = nmax_calcule
    modele["arret"]["nmax_detail"] = {
        "impulsion": int(math.ceil(n_imp)),
        "decroissance": int(math.ceil(n_dec)),
        "periodes": NMAX_PERIODES,
        "f_res": f_res,
    }
    if modele["arret"]["nmax"] <= 0:
        modele["arret"]["nmax"] = nmax_calcule
        modele["arret"]["nmax_auto"] = True
    else:
        modele["arret"]["nmax_auto"] = False

    modele["dumps"] = _dumps(doc, emprise, boite, bande, mx, my, mz,
                             modele["arret"]["nmax"])

    # LES PERTES APRES LE MAILLAGE, ET NON L'INVERSE : la borne qui decide
    # quels poles de Debye le solveur acceptera est « trois pas de temps », et
    # le pas de temps ne se connait qu'une fois la plus petite cellule connue.
    modele["pertes"] = _pertes(doc, dielectriques, bande,
                               modele["estimation"]["dt_s"])

    # Ce que l'assistant a a dire : des avis, pas des refus. Ils partent avec
    # le modele et la page les affiche tels quels.
    modele["avis"] = _avis(modele)
    return modele


def _coupable_cellule(m):
    """La plus petite cellule du domaine, son axe, et la couche qui la fait.

    UNE SEULE AUTORITE POUR UNE SEULE QUESTION. Deux surfaces posent celle-ci
    -- l'avis de l'assistant et le rapport d'ingenierie --, et elles y
    repondaient chacune de son cote, toutes deux a cote de la plaque : « deux
    aretes de cuivre presque confondues » pour l'un, « un sommet decale d'une
    fraction de micron » pour l'autre, quand la cause etait le vernis epargne
    de l'empilage. Le modele repond ici, une fois ; la page et le rapport
    lisent.
    """
    cotes = m["estimation"]["plus_petite_cellule_mm"]
    mm = min(cotes)
    out = {"mm": mm, "axe": "xyz"[cotes.index(mm)],
           "quoi": "", "couche": "", "ep": 0.0, "revetement": False}
    if out["axe"] != "z":
        # Une cellule mince dans le plan ne vient pas d'une couche : elle
        # vient de deux aretes de cuivre que la grille n'a pas confondues.
        return out
    noms_rev = set(r["nom"] for r in m["revetements"])
    for d in m["dielectriques"]:
        if abs(d["ep"] - mm) < 1e-6:
            out.update(quoi="dielectrique", couche=d["nom"], ep=d["ep"],
                       revetement=d["nom"] in noms_rev)
            return out
    if m["modele_cuivre"] == "volume":
        for c in m["conducteurs"]:
            if c["ep_geo"] > 0 and abs(c["ep_geo"] - mm) < 1e-6:
                out.update(quoi="cuivre", couche=c["nom"], ep=c["ep_geo"])
                return out
    return out


def _cause_cellule(m):
    """La meme chose en une phrase, pour l'avis.

    L'AVIS PROPOSAIT DEUX CAUSES PROBABLES, ET LA VRAIE ETAIT UNE TROISIEME.
    Sur antenna4c.xml, la cellule de 15 microns n'etait ni du cuivre presque
    confondu ni un substrat mince : c'etait le VERNIS EPARGNE, declare dans
    l'empilage comme une couche a part entiere et invisible dans le panneau
    qui montre l'empilage, lequel n'affiche que les conducteurs et ce qui les
    separe. Lire « deux aretes presque confondues, ou un substrat tres mince »
    envoyait donc chercher dans le DESSIN ce qui etait dans l'EMPILAGE, et
    aucune retouche du dessin n'y aurait rien change. Le modele connait
    l'epaisseur et le NOM de chaque couche : il n'a aucune raison de faire
    deviner.

    L'AXE DECIDE OU CHERCHER, et il coute un mot : une cellule mince en z
    vient d'une couche, une cellule mince en x ou en y vient de deux aretes de
    cuivre que la grille n'a pas su confondre. Les melanger, c'est renvoyer la
    moitie des lecteurs au mauvais endroit.
    """
    c = m["estimation"]["cellule"]
    if c["quoi"] == "dielectrique":
        suite = (" C'est un revetement EXTERIEUR : l'etape « L'empilage » le "
                 "sort du maillage d'une case a decocher." if c["revetement"]
                 else " C'est un substrat -- il est entre deux conducteurs, "
                      "il porte le champ, et il doit rester.")
        return ("Cause : le dielectrique « %s » ne fait que %.4f mm, et ses "
                "deux faces portent chacune une ligne de maillage qu'on ne "
                "peut pas deplacer sans deplacer la couche elle-meme.%s"
                % (c["couche"], c["ep"], suite))
    if c["quoi"] == "cuivre":
        return ("Cause : l'epaisseur de « %s » (%.4f mm), que le mode "
                "« volume » fait entrer dans le maillage. Le mode "
                "« feuille » donne le meme resultat en une fraction du temps."
                % (c["couche"], c["ep"]))
    if c["axe"] == "z":
        return ("Cause : deux lignes obligatoires voisines en z -- une "
                "interface de l'empilage, une face de port, un objet ajoute "
                "a la main -- posees a cette distance l'une de l'autre.")
    return ("Cause probable : deux aretes de cuivre presque confondues dans "
            "le plan, que la tolerance de regroupement n'a pas rapprochees.")


def _avis(m):
    """Les remarques de l'assistant : ce qui passera, ce qui coincera.

    Chacune porte un rang -- « info », « attention », « grave » -- et dit ce
    qu'il faut changer. Aucune n'empeche de lancer : l'utilisateur sait des
    choses que ce module ne sait pas, a commencer par le temps dont il
    dispose.
    """
    out = []
    b, est = m["boite"], m["estimation"]

    if not b["marge_suffisante"]:
        if b["air_restant"] <= 0:
            texte = ("La couche absorbante mord DANS la structure : la marge "
                     "fait %.1f mm et la PML a elle seule en occupe %.1f "
                     "(%d cellules de %.2f mm). Ce qui se trouve dans la PML "
                     "n'est pas simule, il est mange — le resultat ne veut "
                     "rien dire. Portez la marge a %.1f mm."
                     % (min(b["mx"], b["my"], b["mz_haut"], b["mz_bas"]),
                        b["ep_pml"], b["pml"], m["resolution"]["air"],
                        b["marge_conseil"]))
        else:
            texte = ("Il ne reste que %.1f mm d'air entre l'antenne et le "
                     "debut de la PML ; il en faudrait %.1f, soit un quart de "
                     "la longueur d'onde a %.4g GHz. Trop pres, la PML absorbe "
                     "du champ proche reactif qu'elle n'est pas faite pour "
                     "absorber : l'impedance d'entree derive et la resonance "
                     "se deplace, sans que rien ne le signale. Marge totale "
                     "conseillee : %.1f mm (%.1f d'air + %.1f de PML)."
                     % (b["air_restant"], b["air_utile"],
                        m["bande"]["f1"] / 1e9, b["marge_conseil"],
                        b["air_utile"], b["ep_pml"]))
        out.append({"rang": "grave", "titre": "Marge d'air trop courte",
                    "texte": texte})

    if est["cellules"] > 20e6:
        out.append({
            "rang": "grave",
            "titre": "Maillage hors de portee",
            "texte": "%.1f millions de cellules, soit %.1f Go. Elargissez le "
                     "pas de maillage, reduisez la bande vers le haut, ou "
                     "restreignez la selection de cuivre."
                     % (est["cellules"] / 1e6, est["memoire_Mo"] / 1024.0),
        })
    elif est["cellules"] > 5e6:
        out.append({
            "rang": "attention",
            "titre": "Maillage lourd",
            "texte": "%.1f millions de cellules, environ %.0f Mo. Le calcul "
                     "se comptera en dizaines de minutes."
                     % (est["cellules"] / 1e6, est["memoire_Mo"]),
        })

    petite = est["cellule"]["mm"]
    if petite < m["resolution"]["die"] / 20.0:
        out.append({
            "rang": "attention",
            "titre": "Une cellule minuscule ralentit tout",
            "texte": "La plus petite cellule fait %.4f mm en %s, soit %.0f "
                     "fois moins que le pas vise. Le pas de temps FDTD est "
                     "commande par elle SEULE : cette cellule-la ralentit la "
                     "simulation entiere. %s"
                     % (petite, est["cellule"]["axe"],
                        m["resolution"]["die"] / max(petite, 1e-9),
                        _cause_cellule(m)),
        })

    ecartes = [r for r in m["revetements"] if not r["garde"]]
    if ecartes:
        # LE PLURIEL SE DECLINE, PARCE QU'UN AVIS SE LIT. Un masque de soudure
        # arrive presque toujours par DEUX -- une face et l'autre --, et « la
        # couche reste dans la fiche » sur deux couches est la petite negligence
        # qui fait douter du reste du texte.
        n = len(ecartes)
        mince = min(r["ep"] for r in ecartes)
        out.append({
            "rang": "info",
            "titre": ("Revetements exterieurs hors du maillage" if n > 1
                      else "Revetement exterieur hors du maillage"),
            "texte": "%s pose%s sur le cuivre exterieur, ecarte%s du "
                     "modele : %s dans la fiche mais pas dans la geometrie. "
                     "%s deux faces porteraient deux lignes de maillage a "
                     "%.4f mm l'une de l'autre, soit %.0f fois moins que le "
                     "pas vise, et cette cellule-la commanderait le pas de "
                     "temps de TOUTE la simulation -- un facteur huit sur la "
                     "duree, mesure sur une carte de quatre millions de "
                     "cellules. Ce qu'%s apporterai%s en echange est du "
                     "second "
                     "ordre : une permittivite posee au-dessus du ruban, sur "
                     "un vingt-cinquieme de la hauteur du substrat. L'etape "
                     "« L'empilage » laisse %s remettre si %s compte%s -- un "
                     "coverlay de flex, un radome mince."
                     % (", ".join("« %s » (%.4f mm)" % (r["nom"], r["ep"])
                                  for r in ecartes),
                        "s" if n > 1 else "",
                        "s" if n > 1 else "",
                        "les couches restent" if n > 1
                        else "la couche reste",
                        "Leurs" if n > 1 else "Ses",
                        mince, m["resolution"]["die"] / max(mince, 1e-9),
                        "elles" if n > 1 else "elle",
                        "ent" if n > 1 else "t",
                        "les" if n > 1 else "la",
                        "elles" if n > 1 else "elle",
                        "nt" if n > 1 else ""),
        })

    if m["modele_cuivre"] == "volume":
        out.append({
            "rang": "attention",
            "titre": "Cuivre modelise en volume",
            "texte": "L'epaisseur du cuivre (quelques dizaines de microns) "
                     "entre dans le maillage et commande le pas de temps. A "
                     "2,4 GHz l'epaisseur de peau fait 1,3 micron : le "
                     "courant ne voit pas cette epaisseur, et le mode "
                     "« feuille » donne le meme resultat en une fraction du "
                     "temps. Ne gardez « volume » que si la geometrie de la "
                     "tranche compte — une fente etroite, un couplage par le "
                     "flanc.",
        })
    elif m["modele_cuivre"] == "pec":
        out.append({
            "rang": "info",
            "titre": "Cuivre suppose parfait",
            "texte": "Sans pertes ohmiques, le rendement ressort surestime et "
                     "la resonance plus pointue qu'en realite. C'est le bon "
                     "mode pour degrossir une geometrie, pas pour annoncer un "
                     "gain.",
        })

    # -- une cote de port qui n'etait pas sur une ligne --------------------
    # ELLE DEVRAIT TOUJOURS L'ETRE : les faces des ports sont posees en lignes
    # OBLIGATOIRES, et une obligatoire ne cede jamais. Un deplacement plus
    # grand qu'un arrondi veut donc dire qu'une de ces lignes a disparu en
    # route -- et une boite d'excitation plate qui n'est pas sur une ligne
    # n'excite RIEN, pour un calcul qui va au bout et rend une energie nulle.
    colle = m.get("ports_colles_mm") or 0.0
    if colle > 1e-6:
        out.append({
            "rang": "grave",
            "titre": "Une cote de port n'etait pas sur une ligne de maillage",
            "texte": "Elle a ete deplacee de %.4g mm pour y tomber. Les faces "
                     "d'un port sont pourtant posees en lignes obligatoires : "
                     "un tel ecart signale que l'une d'elles a ete perdue. "
                     "Verifiez la position du port -- une boite d'excitation "
                     "qui n'est pas sur une ligne n'excite rien du tout, et "
                     "le calcul va au bout en rendant une energie nulle."
                     % colle,
        })

    # -- les ports ---------------------------------------------------------
    if len(m["ports"]) > 1:
        exc = next(p for p in m["ports"] if p["excite"])
        autres = [p["n"] for p in m["ports"] if not p["excite"]]
        rendus = ", ".join("S%d%d" % (n, exc["n"])
                           for n in [exc["n"]] + autres)
        manquants = ", ".join("S%d%d" % (n, n) for n in autres)
        out.append({
            "rang": "info",
            "titre": "Une colonne du tableau S, pas le tableau",
            "texte": "Le port %d excite ; %s en charge. Cette simulation rend "
                     "donc %s — ce qui sort de chaque port pendant que "
                     "celui-la emet, et rien d'autre. %s demande%s une seconde "
                     "simulation, l'excitation deplacee : c'est la definition "
                     "d'un parametre S, pas une limite de l'outil. Le bouton "
                     "« Tableau S complet » enchaine ces %d simulations et "
                     "range les colonnes ensemble — la duree est multipliee "
                     "par %d."
                     % (exc["n"],
                        ", ".join("le %d" % n for n in autres),
                        rendus, manquants,
                        "nt" if len(autres) > 1 else "",
                        len(m["ports"]), len(m["ports"])),
        })

    for p in m["ports"]:
        c = p.get("coax")
        if not c:
            continue
        ecart = 100.0 * abs(c["z0_ligne"] - p["R"]) / max(p["R"], 1e-9)
        if ecart > 5.0:
            out.append({
                "rang": "attention" if ecart < 20 else "grave",
                "titre": "Le coaxial du port %d ne fait pas %.0f ohms"
                         % (p["n"], p["R"]),
                "texte": "Sa geometrie donne %.1f ohms : 60/racine(%.2f) . "
                         "ln(%.3f/%.3f). Un coaxial n'est a l'impedance voulue "
                         "que par le RAPPORT de ses deux rayons, et cet ecart "
                         "de %.0f %% n'est pas une erreur de calcul — c'est une "
                         "desadaptation reelle, qui se lira dans le S11 comme "
                         "si elle venait de l'antenne. Une SMA ordinaire fait "
                         "a = 0,635 et b = 2,05 mm dans du PTFE."
                         % (c["z0_ligne"], c["er"], c["rb"], c["ra"], ecart),
            })
        # L'AME EST RONDE DANS UNE GRILLE CARREE. Si la maille est plus large
        # que son diametre, le cylindre est rendu par les cellules qui
        # l'approchent : il grossit, maigrit, ou disparait -- et le port
        # n'excite plus rien. La borne est ici le rayon, parce qu'il faut au
        # moins deux cellules dans le diametre pour que le rond soit un rond.
        if c["ra"] < m["resolution"]["die"]:
            out.append({
                "rang": "attention",
                "titre": "L'ame du port %d est plus fine que la maille" % p["n"],
                "texte": "Rayon %.3f mm contre un pas de %.3f mm dans le "
                         "dielectrique. Le maillage pose bien une ligne sur "
                         "chaque rayon, mais entre deux lignes il n'y a rien : "
                         "l'ame sera rendue par une ou deux cellules, et son "
                         "inductance avec. Resserrez le maillage, ou prenez un "
                         "connecteur plus gros."
                         % (c["ra"], m["resolution"]["die"]),
            })
        if not c["degagements"]:
            out.append({
                "rang": "info",
                "titre": "Aucun degagement pour le port %d" % p["n"],
                "texte": "L'ame ne traverse aucune couche de cuivre autre que "
                         "la sienne : rien a percer. C'est normal sur un "
                         "empilage a deux couches ou la masse est du meme "
                         "cote ; cela ne l'est pas si vous attendiez un "
                         "connecteur qui traverse la carte.",
            })

    # -- les pertes dielectriques -----------------------------------------
    p = m["pertes"]
    if p["mode"] == "kappa" and p["ecart_kappa_pc"] > 8.0:
        out.append({
            "rang": "attention" if p["ecart_kappa_pc"] < 40 else "grave",
            "titre": "Les pertes ne sont justes qu'a une frequence",
            "texte": "La conductivite equivalente est calculee a %.4g GHz. "
                     "Ailleurs, tan(delta) varie comme 1/f alors qu'un "
                     "stratifie reel le garde a peu pres constant : aux bords "
                     "de la bande l'ecart atteint %.0f %%. Passez au modele de "
                     "Debye, ou resserrez la bande."
                     % (p["f_kappa"] / 1e9, p["ecart_kappa_pc"]),
        })
    if p["replis"]:
        out.append({
            "rang": "attention",
            "titre": "Debye impossible, retour a la conductivite",
            "texte": "Pour %s, le pas de temps (%.3g s) ne laisse pas de place "
                     "a un jeu de poles : openEMS ignore tout pole plus rapide "
                     "que deux pas de temps. C'est kappa qui s'applique, avec "
                     "l'erreur que cela suppose. Un maillage plus fin — donc "
                     "un pas de temps plus court — rouvrirait la porte."
                     % (", ".join("« %s »" % n for n in p["replis"]),
                        m["estimation"]["dt_s"]),
        })
    elif p["actif"]:
        bornes = [d["nom"] for d in m["dielectriques"]
                  if d.get("debye") and d["debye"]["borne_par_dt"]]
        out.append({
            "rang": "attention" if p["ecart_debye_pc"] > 5 else "info",
            "titre": "Pertes large bande (Debye)",
            "texte": "tan(delta) est tenu a %.2f %% pres sur toute la bande "
                     "(mesure sur le jeu de poles retenu, pas promis)."
                     % p["ecart_debye_pc"]
                     + (" Les poles les plus rapides ont ete ramenes a trois "
                        "pas de temps pour %s — la borne en dessous de "
                        "laquelle openEMS les sauterait ; l'ecart ci-dessus en "
                        "tient compte."
                        % ", ".join("« %s »" % n for n in bornes) if bornes else "")
                     + " Ce materiau n'est pas construit par les liaisons "
                       "Python d'openEMS, qui ne les exposent pas : le script "
                       "ecrit le XML de CSXCAD et le relit. C'est documente "
                       "dans le script lui-meme.",
        })

    d = m.get("dumps") or {}
    if d.get("actif"):
        mo = d["octets"] / 1048576.0
        if d["mode"] == "temporel":
            out.append({
                "rang": "grave" if mo > 20000 else "attention",
                "titre": "Enregistrement temporel : %s sur le disque"
                         % (("%.1f Go" % (mo / 1024)) if mo > 1024
                            else ("%.0f Mo" % mo)),
                "texte": "openEMS ecrit un fichier PAR PAS DE TEMPS, pas par "
                         "frequence. Le temporel ne sert qu'a faire une "
                         "animation ; pour voir ou passe le courant, le mode "
                         "frequentiel rend la meme information en quelques "
                         "mega-octets.",
            })
        elif mo > 200:
            out.append({
                "rang": "attention",
                "titre": "Enregistrement volumineux (%.0f Mo)" % mo,
                "texte": "Reduisez la region, ou augmentez le sous-"
                         "echantillonnage : un champ vu une cellule sur deux "
                         "se lit aussi bien et pese huit fois moins.",
            })

    # -- le cuivre trop fin pour le maillage -------------------------------
    # UN POLYGONE PLUS PETIT QU'UNE CELLULE NE DISPARAIT PAS AVEC FRACAS : il
    # disparait, voila tout. openEMS le signale par un « Warning: Unused
    # primitive » noye au milieu de trois cents lignes de demarrage, et le
    # calcul continue sans lui. Une pastille d'alimentation evaporee, et le
    # port n'est plus relie a rien — pour un S11 qui a toujours l'air d'un S11.
    # LE COMPTE VIENT DU BILAN PAR POLYGONE, chacun mesure contre LA GRILLE
    # QUI LE CONCERNE : une piste prise dans une bande fine n'est pas plus fine
    # que sa maille, et la compter ici envoyait chercher un probleme resolu.
    pistes = (m["resolution"].get("detail") or {}).get("pistes") or {}
    if pistes.get("ignores"):
        pas_fin = (m["resolution"].get("detail") or {}).get("fin") or 0.0
        out.append({
            "rang": "attention",
            "titre": "%d polygone(s) plus fins que la maille"
                     % pistes["ignores"],
            "texte": "Le plus petit fait %.3f mm de large, pour une maille de "
                     "%.3f mm a cet endroit-la. openEMS les ignorera en "
                     "silence — il l'ecrit une fois dans son journal, au "
                     "milieu du demarrage. Si l'un d'eux est la pastille du "
                     "port, le port n'excitera plus rien. Affinez le "
                     "maillage, ou verifiez que ces polygones-la ne portent "
                     "rien d'essentiel."
                     % (pistes["ignore_mm"], pas_fin or m["resolution"]["die"]),
        })

    if m["supposes"]:
        out.append({
            "rang": "info",
            "titre": "Valeurs completees faute de mieux",
            "texte": "Le fichier ne les declare pas : " +
                     ", ".join(m["supposes"]) + ". Une permittivite devinee "
                     "deplace la resonance de plusieurs pour cent — "
                     "corrigez-la si vous la connaissez.",
        })

    if not m["vias"]:
        out.append({
            "rang": "info",
            "titre": "Aucun via dans le modele",
            "texte": "Si l'antenne a une masse sur une autre couche que son "
                     "cuivre rayonnant, les vias qui les relient font partie "
                     "de la structure : sans eux le chemin de retour n'existe "
                     "pas et le S11 est faux.",
        })

    masses = [c for c in m["cuivre"] if c["role"] in ("gnd", "masse")]
    if not masses:
        out.append({
            "rang": "attention",
            "titre": "Pas de plan de masse dans la selection",
            "texte": "Une antenne imprimee rayonne CONTRE quelque chose. Si "
                     "le plan de masse est le contrepoids, il doit etre dans "
                     "le modele, sur toute son etendue reelle : le tronquer "
                     "change le diagramme et l'impedance.",
        })

    # -- l'impulsion a-t-elle seulement le temps de sortir ? -----------------
    # openEMS pose la question lui-meme dans son journal, une fois la
    # simulation lancee et le temps deja engage. On la pose ici, avant.
    dt = est.get("dt_s") or 0.0
    t_exc = m["bande"].get("t_excitation") or 0.0
    if dt > 0 and t_exc > 0 and not m["arret"].get("nmax_auto"):
        pas_exc = t_exc / dt
        mini = int(math.ceil(3.0 * pas_exc))
        if m["arret"]["nmax"] < mini:
            out.append({
                "rang": "attention",
                "titre": "Le calcul s'arretera avant la fin de l'impulsion",
                "texte": "L'impulsion d'excitation dure a elle seule %d pas "
                         "de temps (%.2f ns). Le garde-fou est a %d pas, soit "
                         "%.1f fois cette duree ; openEMS en demande trois, et "
                         "en dessous ce n'est plus une mesure mais une "
                         "troncature — la transformee lit une impulsion "
                         "coupee. Portez le nombre de pas a %d au moins."
                         % (int(pas_exc), t_exc * 1e9, m["arret"]["nmax"],
                            m["arret"]["nmax"] / pas_exc, mini),
            })

    # -- un garde-fou impose plus court que la decroissance attendue --------
    # CE N'EST PAS UN REFUS, C'EST UN CHIFFRE A COTE D'UN AUTRE. Le nombre
    # saisi peut etre le bon -- une antenne large bande s'eteint vite. Mais
    # quand il est plus court que ce que le modele calcule, le calcul a des
    # chances de finir sur le compteur au lieu de finir sur l'energie, et
    # cela ne se voit qu'apres coup, dans le rapport.
    calc = m["arret"].get("nmax_calcule") or 0
    if (not m["arret"].get("nmax_auto") and calc
            and m["arret"]["nmax"] < calc * 0.95):
        det = m["arret"].get("nmax_detail") or {}
        out.append({
            "rang": "attention",
            "titre": "Le garde-fou est plus court que la decroissance attendue",
            "texte": "Le compteur est a %d pas ; le modele en calcule %d pour "
                     "ce maillage — %d pour emettre l'impulsion, %d pour "
                     "laisser l'antenne s'eteindre (%.0f periodes a %.3f GHz, "
                     "soit environ -40 dB pour un Q charge ordinaire). Si "
                     "l'energie n'est pas descendue avant, la simulation "
                     "s'arretera sur le compteur et la transformee lira une "
                     "reponse coupee. Laissez le champ a zero pour que le "
                     "nombre suive le maillage."
                     % (m["arret"]["nmax"], calc,
                        det.get("impulsion") or 0, det.get("decroissance") or 0,
                        det.get("periodes") or NMAX_PERIODES,
                        (det.get("f_res") or 0.0) / 1e9),
        })

    # -- des aretes ont-elles ete confondues pour le maillage ? --------------
    # ON LE DIT PLUTOT QUE DE S'EN FELICITER EN SILENCE. Le regroupement fait
    # gagner un facteur quatre sur un dessin ordinaire, mais il signale aussi
    # un dessin qui porte des bords presque confondus — deux rubans de largeurs
    # voisines sur le meme axe, un arrondi de bout de piste. Les voir est utile
    # a qui dessine, et les taire reviendrait a corriger le dessin de quelqu'un
    # sans le lui dire.
    md = m.get("maillage_detail") or {}
    if md.get("aretes_groupees"):
        out.append({
            "rang": "info",
            "titre": "Des aretes de cuivre ont ete confondues pour le maillage",
            "texte": "%d bord(s) se trouvaient a moins de %.3f mm d'un autre "
                     "et ne recoivent qu'un seul jeu de lignes. LE CUIVRE, LUI, "
                     "GARDE SES COTES : seule la grille est simplifiee. Sans "
                     "cela, chacun poserait ses lignes au tiers et deux cellules "
                     "minuscules en resulteraient — or la plus petite cellule du "
                     "domaine commande le pas de temps de toute la simulation."
                     % (md["aretes_groupees"], md.get("eps_aretes") or 0.0),
        })

    # -- le cuivre le plus fin est-il resolu ? -------------------------------
    # CET AVIS NE REGARDE PLUS QUI A CHOISI LE PAS, ET C'EST UNE CORRECTION.
    # Il ne sortait qu'en mode automatique : un pas saisi a la main etait
    # repute assume, donc tu. C'etait exactement le cas a ne pas taire — un
    # pas de 0,80 mm entre a la main pour des brins de 1,00 mm ne fait qu'UNE
    # cellule en travers du cuivre, la resonance part plusieurs pour cent trop
    # haut, et rien ne le disait. Le pas saisi reste saisi : on ne le corrige
    # pas, on le commente.
    det = m["resolution"].get("detail") or {}
    res_die = m["resolution"]["die"]
    pas_fin = det.get("fin") or 0.0
    pistes = det.get("pistes") or {}
    largeur = pistes.get("largeur") or 0.0
    cellules = pistes.get("cellules") or 0.0

    # -- l'affinage local a eu lieu : on le dit ----------------------------
    # UN MAILLAGE A DEUX PAS NE SE LIT PAS SUR LE SEUL « PAS DE MAILLAGE ». La
    # page affiche le fond ; sans cet avis, personne ne saurait qu'une piste
    # de 0,5 mm est maillee cinq fois plus fin que la carte qui la porte, ni ce
    # que cela a coute.
    if pas_fin > 0:
        md = m.get("maillage_detail") or {}
        cout, fond = det.get("cout") or 0.0, det.get("cout_fond") or 0.0
        borne = ""
        if det.get("fin_borne"):
            borne = (" Le budget a arrete l'affinage la : pour %g cellules en "
                     "travers du cuivre le plus etroit il faudrait descendre a "
                     "%.3f mm, et le calcul coutait alors plus de %g fois le "
                     "maillage de fond."
                     % (CELLULES_PAR_PISTE, det.get("fin_voulu") or 0.0,
                        AFFINAGE_COUT_MAX))
        out.append({
            "rang": "info",
            "titre": "Maillage affine en travers du cuivre etroit",
            "texte": "Le fond reste a %.3f mm — c'est ce que l'emprise du "
                     "cuivre permet — mais %d bande(s) en x et %d en y "
                     "descendent a %.3f mm. Elles sont posees EN TRAVERS des "
                     "pistes trop fines pour le fond, et sur ce seul axe : le "
                     "champ tourne sur la largeur d'un ruban, pas sur sa "
                     "longueur, et raffiner les deux axes couterait quarante "
                     "fois plus de lignes pour la meme physique. Le plus mal "
                     "resolu des polygones a maintenant %.1f cellules en "
                     "travers. Prix : %.1f fois le maillage de fond.%s"
                     % (res_die, md.get("bandes_x") or 0,
                        md.get("bandes_y") or 0, pas_fin, cellules,
                        (cout / fond) if fond > 0 else 1.0, borne),
        })

    # -- ce qui reste mal resolu, et pourquoi ------------------------------
    if largeur > 0 and cellules < CELLULES_PAR_PISTE * 0.999:
        if det.get("saisi"):
            cause = ("Le pas est celui que vous avez saisi : %.3f mm. "
                     "Mettez-le a %.3f mm pour resoudre ce cuivre, ou "
                     "rendez-le automatique en le remettant a zero."
                     % (res_die, largeur / CELLULES_PAR_PISTE))
        elif pas_fin > 0 or det.get("fin_borne"):
            cause = ("Le maillage est deja affine en travers du cuivre "
                     "etroit, et c'est le BUDGET qui arrete l'affinage : "
                     "au-dela, le nombre de cellules et le nombre de pas de "
                     "temps faisaient plus de %g fois le maillage de fond. "
                     "Retirez de la selection le cuivre qui ne rayonne pas — "
                     "c'est lui qui paie, chaque piste fine coutant sa propre "
                     "bande." % AFFINAGE_COUT_MAX)
        else:
            cause = ("Le maillage s'arrete a %.3f mm — c'est le pas en "
                     "dessous duquel l'emprise du cuivre demanderait plus de "
                     "%d lignes par axe, et le calcul ne finirait pas. "
                     "Retirez ce cuivre de la selection s'il ne rayonne pas."
                     % (det.get("plancher") or 0.0, int(LIGNES_MAX_EMPRISE)))
        out.append({
            "rang": "attention",
            "titre": "Le cuivre le plus fin n'est pas resolu",
            "texte": "Le plus mal resolu des polygones retenus fait %.3f mm "
                     "de large ; il en faudrait %g cellules en travers, et il "
                     "n'en a que %.1f. Un ruban rendu par une cellule ou deux "
                     "n'a pas la largeur qu'on a dessinee : son impedance "
                     "n'est pas la bonne, et sa resonance sort trop haut. %s"
                     % (largeur, CELLULES_PAR_PISTE, cellules, cause),
        })

    return out


def duree_estimee(m):
    """Un ordre de grandeur : cellules x pas de temps divise par un debit.

    Ce debit est celui que ce poste a MONTRE, des qu'un calcul y a fini (voir
    `noter_debit`) ; avant cela, c'est la valeur supposee. Meme mesure, la
    duree reste un ordre de grandeur : le maillage suivant n'a pas la meme
    empreinte memoire, et annoncer « 14 min 32 s » serait une precision
    mensongere. Sert au balayage, qui multiplie cette duree par son nombre de
    points : c'est la que l'ordre de grandeur compte vraiment, parce que c'est
    la qu'on lance une nuit de calcul sans la voir venir.
    """
    e = m["estimation"]
    pas = min(m["arret"]["nmax"],
              max(2000, round(20.0 / (m["bande"]["f0"] * e["dt_s"]))))
    return e["cellules"] * pas / (e["mcps_suppose"] * 1e6)


# ==========================================================================
# Le balayage parametrique
# ==========================================================================
# POURQUOI IL EXISTE. Un gabarit d'antenne tombe a 2 ou 5 % de la resonance
# visee, et la premiere simulation ne dit pas « c'est bon » : elle dit « c'est
# 3 % trop bas ». Le geste qui suit est toujours le meme -- rallonger le patch
# de quatre dixiemes de millimetre et relancer -- et le refaire a la main six
# fois, c'est six fois l'occasion de changer deux choses au lieu d'une et de
# ne plus savoir laquelle a compte.
#
# CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS. Il ne cherche rien : ce
# n'est pas un optimiseur, il n'y a ni gradient, ni critere, ni convergence.
# Il prend UNE liste de valeurs, et il rend UNE courbe par valeur. La lecture
# reste humaine, et c'est voulu : un optimiseur qui rend « L = 38,46 mm » sans
# la famille de courbes cache la seule chose qui apprenne quelque chose, la
# SENSIBILITE -- de combien la resonance bouge pour un dixieme de millimetre.
#
# COMMENT UN POINT EST DECRIT. Pas par une formule, mais par des MODIFICATIONS
# du document : « remplace tel polygone par celui-ci ». C'est la page qui les
# calcule, parce que c'est elle qui sait ce qu'est « la longueur du patch » --
# un modele FDTD, lui, ne connait que du metal. Le serveur, de son cote, ne
# voit qu'un document par point, qu'il relit exactement comme les autres :
# aucun chemin de code n'echappe aux refus habituels.
MAX_POINTS = 40


def _pas_a_pas(racine, chemin):
    """Le conteneur et la derniere clef d'un chemin « a.b.0.c ».

    Les segments entiers indexent une liste, les autres une table. Un chemin
    qui ne mene nulle part est un refus et non un silence : une modification
    qui ne s'applique pas donnerait un point de balayage IDENTIQUE aux autres,
    et une courbe superposee qu'on prendrait pour un resultat.
    """
    bouts = [b for b in str(chemin).split(".") if b != ""]
    if not bouts:
        raise ErreurModele("Chemin de modification vide.",
                           "Chaque point de balayage doit dire ce qu'il change.")
    ou = racine
    for i, b in enumerate(bouts[:-1]):
        try:
            ou = ou[int(b)] if isinstance(ou, list) else ou[b]
        except (KeyError, IndexError, ValueError, TypeError):
            raise ErreurModele(
                "Le balayage designe « %s », qui n'existe pas dans le "
                "document (bloque a « %s »)." % (chemin, ".".join(bouts[:i + 1])),
                "C'est la page qui calcule ces chemins : celui-ci designe une "
                "geometrie qui a change depuis. Refaites le balayage.")
    return ou, bouts[-1]


def _appliquer(racine, chemin, valeur):
    ou, clef = _pas_a_pas(racine, chemin)
    if isinstance(ou, list):
        try:
            ou[int(clef)] = valeur
        except (IndexError, ValueError):
            raise ErreurModele(
                "Le balayage ecrit a l'indice « %s » d'une liste qui ne va "
                "pas jusque-la (« %s »)." % (clef, chemin),
                "Refaites le balayage : le dessin a change depuis.")
    elif isinstance(ou, dict):
        ou[clef] = valeur
    else:
        raise ErreurModele(
            "Le balayage ecrit dans « %s », qui n'est ni une liste ni un "
            "objet." % chemin, "Refaites le balayage.")


def balayage(doc):
    """Un document + une liste de points -> autant de modeles verifies.

    TOUS LES POINTS SONT VERIFIES AVANT QUE LE PREMIER NE PARTE. Decouvrir au
    quatorzieme point, une heure plus tard, que le port y tombe hors du cuivre
    serait la pire facon de l'apprendre : le refus arrive donc avant le
    lancement, et il dit QUEL point est en cause.
    """
    if not isinstance(doc, dict):
        raise ErreurModele("Document JSON (objet) attendu.")
    b = _dict(doc.get("balayage"))
    points = _liste(b.get("points"))
    if len(points) < 2:
        raise ErreurModele(
            "Un balayage demande au moins deux points (%d recu%s)."
            % (len(points), "" if len(points) < 2 else "s"),
            "Un seul point, c'est une simulation ordinaire : le bouton "
            "« Lancer » la fait.")
    if len(points) > MAX_POINTS:
        raise ErreurModele(
            "%d points demandes, %d au plus." % (len(points), MAX_POINTS),
            "Chaque point est une simulation complete. Au-dela, c'est une "
            "nuit de calcul qu'on lance sans la voir venir : resserrez la "
            "plage, ou elargissez le pas.")

    base = {k: v for k, v in doc.items() if k != "balayage"}

    # LE MAILLAGE SE FIGE SUR LE POINT DE DEPART, ET IL LE FAUT DEPUIS QUE LE
    # PAS DEPEND DE LA GEOMETRIE. Une cote balayee change la largeur du cuivre
    # le plus etroit ; sans cette ligne, chaque point recevrait un maillage
    # different, et la famille de courbes melangerait ce que la cote fait a
    # l'antenne avec ce que le maillage fait au calcul — c'est-a-dire
    # exactement ce qu'un balayage sert a separer. On normalise donc le
    # document de depart une fois, et on impose SON pas a tous les points.
    reference = normaliser(base)
    m_base = _dict(base.get("maillage"))
    if not _nb_pos(m_base.get("res_die"), 0.0):
        m_base = dict(m_base)
        m_base["res_die"] = reference["resolution"]["die"] / reference["unite_mm"]
        m_base["res_air"] = (m_base.get("res_air")
                             or reference["resolution"]["air"]
                             / reference["unite_mm"])
        base["maillage"] = m_base

    out = []
    for i, pt in enumerate(points):
        pt = _dict(pt)
        d = copy.deepcopy(base)
        for mod in _liste(pt.get("modifs")):
            mod = _dict(mod)
            _appliquer(d, _texte(mod.get("chemin"), 400), mod.get("valeur"))
        try:
            m = normaliser(d)
        except ErreurModele as exc:
            raise ErreurModele(
                "Le point %d du balayage (%s) est refuse : %s"
                % (i + 1, _texte(pt.get("etiquette"), 40) or "?", exc.message),
                exc.conseil or "")
        # `valeur2` n'existe que sur un balayage CROISE : c'est la cote du
        # second axe. Elle ne sert a rien ici — le point est deja decrit par
        # ses modifications — mais elle permet a la page de ranger les
        # resultats en tableau au lieu d'une liste de N*M lignes.
        v2 = pt.get("valeur2")
        out.append({
            "etiquette": _texte(pt.get("etiquette"), 40) or str(i + 1),
            "valeur": _nb(pt.get("valeur"), float(i)),
            "valeur2": (_nb(v2, 0.0) if isinstance(v2, (int, float))
                        else None),
            "modele": m,
        })

    cellules = sum(p["modele"]["estimation"]["cellules"] for p in out)
    secondes = sum(duree_estimee(p["modele"]) for p in out)
    croise = bool(b.get("croise")) and any(p["valeur2"] is not None
                                          for p in out)
    return {
        "nom": _texte(b.get("nom"), 80) or "parametre",
        "unite": _texte(b.get("unite"), 16) or "",
        # LE SECOND AXE EST UN PRODUIT, PAS UNE SOMME, et c'est la seule chose
        # qui change ici : `MAX_POINTS` porte sur la liste des points, donc
        # deja sur le produit. Six valeurs croisees avec six font trente-six
        # points, et le garde-fou les compte tous les trente-six.
        "croise": croise,
        "nom2": _texte(b.get("nom2"), 80) if croise else "",
        "unite2": _texte(b.get("unite2"), 16) if croise else "",
        "points": out,
        "estimation": {"cellules": cellules, "duree_s": secondes,
                       "memoire_Mo": max(p["modele"]["estimation"]["memoire_Mo"]
                                         for p in out)},
    }


# ==========================================================================
# Le tableau S complet
# --------------------------------------------------------------------------
# CE QUI MANQUAIT, ET CE QUE CELA CHANGE. Une simulation rend UNE COLONNE du
# tableau : le port j excite, on lit ce qui revient en j et ce qui sort de
# chacun des autres. C'est la definition meme d'un parametre S, et ce n'etait
# pas une limite de l'outil -- mais obtenir le tableau entier demandait de
# deplacer l'excitation a la main, de relancer, et de ranger soi-meme les
# colonnes ensemble. Ce que cette fonction ajoute n'est donc PAS un calcul :
# c'est l'ENCHAINEMENT. N documents identiques a un drapeau pres, verifies
# tous avant que le premier ne parte.
#
# POURQUOI C'EST LE MEME CHEMIN QUE LE BALAYAGE. Les deux font la meme chose
# -- une suite de simulations dont on assemble les resultats --, et un second
# chemin vers le solveur serait un second endroit ou les refus pourraient
# diverger. Chaque colonne passe par `normaliser` comme n'importe quel
# document : le port qui tombe hors du cuivre est refuse ici aussi.
#
# CE QUE CELA COUTE, ET IL FAUT LE DIRE AVANT. La duree est multipliee par le
# nombre de ports. Quatre ports, c'est quatre fois la nuit de calcul -- et
# c'est exactement le genre d'engagement qu'on prend sans le voir venir si
# l'annonce ne le dit pas. `estimation.duree_s` porte le total, pas la colonne.
def tableau_s(doc):
    """Un document a N ports -> N modeles verifies, un par port excite."""
    if not isinstance(doc, dict):
        raise ErreurModele("Document JSON (objet) attendu.")

    base = {k: v for k, v in doc.items() if k != "balayage"}
    reference = normaliser(base)
    ports = reference["ports"]
    n = len(ports)
    if n < 2:
        raise ErreurModele(
            "Un tableau S complet demande au moins deux ports (%d pose)." % n,
            "Avec un seul port, le tableau se reduit a S11 — c'est ce que le "
            "bouton « Lancer » rend deja, en une simulation.")

    bruts = [q for q in _liste(base.get("ports")) if isinstance(q, dict)]
    if len(bruts) != n:
        raise ErreurModele(
            "Le document ne porte pas la liste de ses %d ports." % n,
            "Le tableau complet deplace l'excitation d'un port a l'autre : il "
            "lui faut la liste, et non le port unique de l'ancienne forme.")

    colonnes = []
    for j in range(n):
        d = copy.deepcopy(base)
        for k, q in enumerate(d["ports"]):
            q["excite"] = (k == j)
        try:
            m = normaliser(d)
        except ErreurModele as exc:
            raise ErreurModele(
                "La colonne du port %d est refusee : %s"
                % (j + 1, exc.message), exc.conseil or "")
        colonnes.append({"n": j + 1, "nom": ports[j]["nom"], "modele": m})

    # LES COLONNES DOIVENT PARTAGER LEUR AXE DE FREQUENCE, sans quoi elles ne
    # se rangent pas dans un meme tableau. Elles le partagent par construction
    # -- seul un drapeau les separe --, et c'est justement pour cela qu'on le
    # verifie : ce qui doit etre vrai par construction est ce qui se casse en
    # silence le jour ou la construction change.
    for c in colonnes[1:]:
        if (c["modele"]["bande"] != colonnes[0]["modele"]["bande"] or
                c["modele"]["estimation"]["cellules"]
                != colonnes[0]["modele"]["estimation"]["cellules"]):
            raise ErreurModele(
                "Les colonnes du tableau S n'ont pas le meme maillage ou la "
                "meme bande.",
                "Elles ne different que par le port excite : si le reste "
                "differe, le tableau melangerait deux simulations "
                "incomparables.")

    cellules = sum(c["modele"]["estimation"]["cellules"] for c in colonnes)
    secondes = sum(duree_estimee(c["modele"]) for c in colonnes)
    return {
        "ports": [{"n": q["n"], "nom": q["nom"], "type": q["type"],
                   "R": q["R"]} for q in ports],
        "colonnes": colonnes,
        "estimation": {
            "cellules": cellules, "duree_s": secondes,
            "memoire_Mo": max(c["modele"]["estimation"]["memoire_Mo"]
                              for c in colonnes)},
    }
