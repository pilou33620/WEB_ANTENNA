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
#   que serveur.py applique a ses solveurs.
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
        })
    entrees.sort(key=lambda e: e["seq"])
    entrees.reverse()                        # du bas vers le haut

    conducteurs, dielectriques = [], []
    z = 0.0
    supposes = []
    volume = (modele_cu == "volume")
    for e in entrees:
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

    return conducteurs, dielectriques, z, supposes


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
    return res_air, res_die, {"lambda": res_lam, "largeur_cuivre": largeur,
                              "plancher": plancher, "bornee": bornee}


def _lignes(debut, fin, pas):
    """Une suite de lignes de maillage regulieres, bornes comprises."""
    if fin <= debut:
        return [debut]
    n = max(1, int(math.ceil((fin - debut) / pas)))
    h = (fin - debut) / n
    return [debut + i * h for i in range(n + 1)]


def _fusionner(lignes, mini, obligatoires=()):
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
    """
    obl = sorted(set(round(v, 9) for v in obligatoires))
    autres = sorted(set(round(v, 9) for v in lignes) - set(obl))

    out = []
    for v in obl:
        # Deux obligatoires trop proches l'une de l'autre restent toutes les
        # deux : elles decrivent la geometrie, et c'est a l'assistant de
        # signaler la cellule mince qui en resulte, pas a nous de la cacher.
        if not out or v - out[-1] > 1e-9:
            out.append(v)

    for v in autres:
        i = _place(out, v)
        gauche = out[i - 1] if i > 0 else None
        droite = out[i] if i < len(out) else None
        if gauche is not None and v - gauche < mini:
            continue
        if droite is not None and droite - v < mini:
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
    pas.
    """
    ratio = GRADIENT_MAX if ratio is None else ratio
    out = sorted(lignes)
    n = len(out) - 1
    if n < 2 or ratio <= 1.0:
        return out
    pas = [out[i + 1] - out[i] for i in range(n)]
    lim = [max(v, plancher) for v in pas]
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


def _maillage(modele, bande, res_air, res_die):
    """Les trois listes de lignes de maillage.

    Le principe : un fond regulier a la resolution de l'air sur toute la
    boite, remplace par la resolution du dielectrique dans l'emprise de la
    carte, plus une ligne posee sur chaque cote de cuivre en z, plus -- si la
    regle du tiers est demandee -- un raffinement aux aretes du cuivre dans
    le plan. openEMS ajoute lui-meme les aretes par AddEdges2Grid ; ce qui
    suit sert a l'estimation et au script autonome, pour qu'ils annoncent le
    meme nombre de cellules que ce qui sera calcule.
    """
    boite = modele["boite"]
    em = modele["emprise"]
    z_haut = modele["z_haut"]

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
        # Au moins trois cellules dans un substrat : une seule ne represente
        # pas le champ qui s'y courbe sous une piste. Celles-la sont du
        # remplissage — elles peuvent ceder.
        n = max(3, int(math.ceil(d["ep"] / res_die)))
        for i in range(1, n):
            z.append(d["z0"] + d["ep"] * i / n)
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
    # exploser le maillage, et openEMS s'en charge mieux par AddEdges2Grid.
    if modele["maillage_tiers"]:
        d = res_die / 3.0
        for bloc in modele["cuivre"]:
            for poly in bloc["polys"]:
                xs = [q[0] for q in poly["o"]]
                ys = [q[1] for q in poly["o"]]
                for v in (min(xs), max(xs)):
                    x += [v - d, v + 2 * d]
                for v in (min(ys), max(ys)):
                    y += [v - d, v + 2 * d]

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
    mini = res_die / 8.0
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
    plancher = res_die
    return (_lisser(_fusionner(x, mini, x_obl), plancher),
            _lisser(_fusionner(y, mini, y_obl), plancher),
            _lisser(_fusionner(z, mini, z_obl), plancher))


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


def _dumps(doc, emprise, boite, bande, mx, my, mz):
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
        octets = nc * OCTETS_PAR_CELLULE_DUMP * _nb_pos(
            _dict(doc.get("arret")).get("nmax"), NMAX_DEFAUT) * len(types)

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

    conducteurs, dielectriques, z_haut, supposes = _empilage(doc, k_mm, modele_cu)
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
    res_air = _nb_pos(m.get("res_air"), 0.0) * k_mm or res_air
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
            "energie_dB": -abs(_nb_pos(arret.get("energie"), abs(ENERGIE_DEFAUT))),
            "nmax": int(_nb_pos(arret.get("nmax"), NMAX_DEFAUT)),
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
        "stats": {"polygones": n_polys, "vias": len(vias),
                  "couches_cuivre": len(cuivre),
                  "primitives": len(primitives)},
    }

    mx, my, mz = _maillage(modele, bande, res_air, res_die)
    modele["maillage"] = {"x": mx, "y": my, "z": mz}
    modele["estimation"] = _estimation(mx, my, mz, res_die)

    modele["dumps"] = _dumps(doc, emprise, boite, bande, mx, my, mz)

    # LES PERTES APRES LE MAILLAGE, ET NON L'INVERSE : la borne qui decide
    # quels poles de Debye le solveur acceptera est « trois pas de temps », et
    # le pas de temps ne se connait qu'une fois la plus petite cellule connue.
    modele["pertes"] = _pertes(doc, dielectriques, bande,
                               modele["estimation"]["dt_s"])

    # Ce que l'assistant a a dire : des avis, pas des refus. Ils partent avec
    # le modele et la page les affiche tels quels.
    modele["avis"] = _avis(modele)
    return modele


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

    petite = min(est["plus_petite_cellule_mm"])
    if petite < m["resolution"]["die"] / 20.0:
        cause = ("l'epaisseur du cuivre, que le mode « volume » fait entrer "
                 "dans le maillage" if m["modele_cuivre"] == "volume"
                 else "deux aretes de cuivre presque confondues, ou un "
                      "substrat tres mince")
        out.append({
            "rang": "attention",
            "titre": "Une cellule minuscule ralentit tout",
            "texte": "La plus petite cellule fait %.4f mm, soit %.0f fois "
                     "moins que le pas vise. Le pas de temps FDTD est "
                     "commande par elle SEULE : cette cellule-la ralentit la "
                     "simulation entiere. Cause probable : %s."
                     % (petite, m["resolution"]["die"] / max(petite, 1e-9),
                        cause),
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
    fin = 0
    petit = None
    for bloc in m["cuivre"]:
        for poly in bloc["polys"]:
            xs = [q[0] for q in poly["o"]]
            ys = [q[1] for q in poly["o"]]
            d = min(max(xs) - min(xs), max(ys) - min(ys))
            if d < m["resolution"]["die"]:
                fin += 1
                petit = d if petit is None else min(petit, d)
    if fin:
        out.append({
            "rang": "attention",
            "titre": "%d polygone(s) plus fins que la maille" % fin,
            "texte": "Le plus petit fait %.3f mm de large, pour un pas de "
                     "maillage de %.3f mm. openEMS les ignorera en silence — "
                     "il l'ecrit une fois dans son journal, au milieu du "
                     "demarrage. Si l'un d'eux est la pastille du port, le "
                     "port n'excitera plus rien. Affinez le maillage, ou "
                     "verifiez que ces polygones-la ne portent rien "
                     "d'essentiel." % (petit, m["resolution"]["die"]),
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
    if dt > 0 and t_exc > 0:
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

    # -- le cuivre le plus fin est-il resolu ? -------------------------------
    det = m["resolution"].get("detail") or {}
    if det.get("bornee") and not det.get("saisi"):
        out.append({
            "rang": "attention",
            "titre": "Le cuivre le plus fin n'est pas resolu",
            "texte": "Le plus etroit des polygones retenus fait %.3f mm ; il "
                     "en faudrait %g cellules en travers, soit un pas de "
                     "%.3f mm. Le maillage s'arrete a %.3f mm — c'est le pas "
                     "en dessous duquel l'emprise du cuivre demanderait plus "
                     "de %d lignes par axe, et le calcul ne finirait pas. "
                     "Ce qui est plus fin que cela est "
                     "rendu par la cellule qui l'approche : son impedance "
                     "n'est pas la bonne. Retirez ce cuivre de la selection "
                     "s'il ne rayonne pas, ou imposez le pas a la main."
                     % (det.get("largeur_cuivre") or 0.0, CELLULES_PAR_PISTE,
                        (det.get("largeur_cuivre") or 0.0) / CELLULES_PAR_PISTE,
                        det.get("plancher") or 0.0, int(LIGNES_MAX_EMPRISE)),
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
