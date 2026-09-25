#!/usr/bin/python3
# -*- coding: utf-8 -*-
# ==========================================================================
# Banc d'essai de l'outil « Antenne openEMS ».
#
#   python python/test/banc-openems.py            verifications, sans solveur
#   python python/test/banc-openems.py --simuler  lance en plus une vraie
#                                                 simulation FDTD (quelques
#                                                 minutes)
#
# LA CARTE D'ESSAI EST UN PATCH RECTANGULAIRE alimente par sonde coaxiale,
# la geometrie d'antenne dont la resonance se calcule a la main : c'est ce
# qui rend le banc utile. Un patch de largeur W et longueur L sur un
# substrat d'epaisseur h et de permittivite er resonne au voisinage de
#
#       fr = c / (2 . L . racine(er_eff))
#
# et le banc verifie que la simulation tombe a quelques pour-cent de la
# valeur visee. Ce n'est pas une validation d'openEMS — openEMS n'a pas
# besoin de nous pour etre valide — mais une validation de TOUT CE QUI EST
# ENTRE la page et lui : l'empilage retourne, les cotes en z, le sens des
# polygones, le port, le maillage, le depouillement.
# ==========================================================================

import json
import math
import os
import subprocess
import sys
import time

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(ICI))

import openems_modele                                  # noqa: E402
import openems_script                                  # noqa: E402

C0 = 299792458.0

_ok = [0]
_ko = []


def verifie(nom, condition, detail=""):
    if condition:
        _ok[0] += 1
        print("  ok   %s" % nom)
    else:
        _ko.append(nom)
        print("  RATE %s   %s" % (nom, detail))


def rect(x0, y0, w, h):
    """Un rectangle, au format plat de ipc2581_json."""
    return [x0, y0, x0 + w, y0, x0 + w, y0 + h, x0, y0 + h]


# --------------------------------------------------------------------------
# La carte d'essai : patch 2,45 GHz sur FR-4 1,6 mm
# --------------------------------------------------------------------------
ER = 4.3
H = 1.6
# Longueur qui resonne vers 2,45 GHz : er_eff d'un patch large vaut a peu
# pres (er+1)/2 + (er-1)/2 . (1+12h/W)^-1/2.
W_PATCH = 38.0
ER_EFF = (ER + 1) / 2 + (ER - 1) / 2 * (1 + 12 * H / W_PATCH) ** -0.5
L_PATCH = C0 / (2 * 2.45e9 * math.sqrt(ER_EFF)) * 1000 - 2 * 0.4 * H
PLAN = 70.0                                            # cote du plan de masse


def document(**surcharges):
    x0 = (PLAN - W_PATCH) / 2.0
    y0 = (PLAN - L_PATCH) / 2.0
    doc = {
        "nom": "patch-2450.xml",
        "unite": "mm",
        "empilage": [
            {"nom": "TOP", "cuivre": True, "ep": 0.035, "seq": 1, "role": "signal"},
            {"nom": "CORE", "cuivre": False, "ep": H, "er": ER, "df": 0.02, "seq": 2},
            {"nom": "BOTTOM", "cuivre": True, "ep": 0.035, "seq": 3, "role": "gnd"},
        ],
        "cuivre": [
            {"couche": "TOP",
             "polys": [{"o": rect(x0, y0, W_PATCH, L_PATCH)}]},
            {"couche": "BOTTOM",
             "polys": [{"o": rect(0, 0, PLAN, PLAN)}]},
        ],
        "vias": [],
        "port": {
            "type": "localise", "dir": "z",
            # Sonde placee sur l'axe du patch, a un tiers de sa longueur :
            # c'est la ou l'impedance passe par 50 ohms sur un patch ordinaire.
            "x": PLAN / 2.0, "y": y0 + L_PATCH / 3.0,
            "w": 1.0, "l": 1.0, "R": 50.0,
            "de": "TOP", "a": "BOTTOM",
        },
        "bande": {"f1": 2.0e9, "f2": 3.0e9, "n": 401, "fcible": 2.45e9},
        "boite": {},
        "maillage": {},
        "arret": {"energie": -30, "nmax": 20000},
        "nf2ff": {"actif": False},
    }
    doc.update(surcharges)
    return doc


# --------------------------------------------------------------------------
print("Patch d'essai : %.2f x %.2f mm, er_eff = %.3f, fr visee = 2,45 GHz"
      % (W_PATCH, L_PATCH, ER_EFF))
print()
print("1. Normalisation du document")
m = openems_modele.normaliser(document())

cu = {c["nom"]: c for c in m["conducteurs"]}
verifie("z = 0 est sous le cuivre du DESSOUS",
        abs(cu["BOTTOM"]["z0"]) < 1e-9,
        "z0(BOTTOM) = %s" % cu["BOTTOM"]["z0"])
verifie("le cuivre du dessus est au-dessus du substrat",
        cu["TOP"]["z0"] > cu["BOTTOM"]["z1"],
        "TOP z0=%.4f BOTTOM z1=%.4f" % (cu["TOP"]["z0"], cu["BOTTOM"]["z1"]))
verifie("en mode feuille le conducteur est un plan, sans epaisseur geometrique",
        cu["TOP"]["ep_geo"] == 0 and cu["TOP"]["ep"] == 0.035)
verifie("en mode feuille, l'empilage ne fait que l'epaisseur du substrat",
        abs(m["z_haut"] - H) < 1e-9,
        "z_haut = %s, attendu %s" % (m["z_haut"], H))
mv = openems_modele.normaliser(document(modele_cuivre="volume"))
verifie("en mode volume, il fait substrat + 2 x cuivre",
        abs(mv["z_haut"] - (2 * 0.035 + H)) < 1e-9,
        "z_haut = %s" % mv["z_haut"])

# -- LE VERNIS EPARGNE, ET LES 20 HEURES QU'IL COUTAIT ---------------------
# Un IPC-2581 declare son masque de soudure dans l'empilage comme une couche
# ordinaire : 15 microns, dehors, sur le cuivre exterieur. Il ne porte aucun
# champ de ligne, mais ses deux faces portent deux lignes de maillage
# OBLIGATOIRES, et la cellule de 15 microns qui en resulte commande le pas de
# temps de TOUT le domaine : sur une carte d'essai qui reprend l'empilage
# d'antenna4c.xml, 21 h annoncees au lieu de 2 h 30 pour cent mille cellules
# de plus sur quatre millions. Et l'avis accusait « deux aretes de cuivre
# presque confondues » -- c'est-a-dire le dessin, ou il n'y avait rien a
# corriger.
VERNIS = 0.015
PILE_VERNIS = [
    {"nom": "VERNIS-A", "cuivre": False, "ep": VERNIS,
     "er": 3.7, "df": 0.029, "seq": 0},
    {"nom": "TOP", "cuivre": True, "ep": 0.035, "seq": 1, "role": "signal"},
    {"nom": "CORE", "cuivre": False, "ep": H, "er": ER, "df": 0.02, "seq": 2},
    {"nom": "BOTTOM", "cuivre": True, "ep": 0.035, "seq": 3, "role": "gnd"},
    {"nom": "VERNIS-B", "cuivre": False, "ep": VERNIS,
     "er": 3.7, "df": 0.029, "seq": 4},
]


def pile_vernis(**quoi):
    """L'empilage au vernis, avec un « garder » pose sur les couches nommees."""
    import copy as _c
    pile = _c.deepcopy(PILE_VERNIS)
    for e in pile:
        if e["nom"] in quoi:
            e["garder"] = quoi[e["nom"]]
    return pile


mvz = openems_modele.normaliser(document(empilage=pile_vernis()))
verifie("un vernis exterieur de 15 microns n'entre pas dans la geometrie",
        abs(mvz["z_haut"] - H) < 1e-9
        and [d["nom"] for d in mvz["dielectriques"]] == ["CORE"],
        "z_haut = %s, dielectriques = %s"
        % (mvz["z_haut"], [d["nom"] for d in mvz["dielectriques"]]))
verifie("il n'est pas ecarte en silence : le modele le nomme",
        [(r["nom"], r["garde"], r["choisi"]) for r in mvz["revetements"]]
        == [("VERNIS-B", False, False), ("VERNIS-A", False, False)],
        str(mvz["revetements"]))
verifie("et un avis le dit, les deux vernis nommes et au pluriel",
        any(a["titre"] == "Revetements exterieurs hors du maillage"
            and "VERNIS-A" in a["texte"] and "VERNIS-B" in a["texte"]
            and "les couches restent" in a["texte"] for a in mvz["avis"]),
        str([(a["titre"], a["texte"]) for a in mvz["avis"]]))
verifie("sans lui, aucune cellule minuscule ne commande le pas de temps",
        min(mvz["estimation"]["plus_petite_cellule_mm"])
        > mvz["resolution"]["die"] / 20.0,
        "plus petite cellule %.6f mm, pas vise %.4f"
        % (min(mvz["estimation"]["plus_petite_cellule_mm"]),
           mvz["resolution"]["die"]))

# ... ET IL SE REMET, parce qu'un coverlay de flex ou un radome mince, eux,
# comptent : la borne est un defaut, pas une doctrine.
mvo = openems_modele.normaliser(
    document(empilage=pile_vernis(**{"VERNIS-A": True})))
verifie("une case cochee remet le vernis dans la geometrie",
        abs(mvo["z_haut"] - (H + VERNIS)) < 1e-9
        and "VERNIS-A" in [d["nom"] for d in mvo["dielectriques"]],
        "z_haut = %s, dielectriques = %s"
        % (mvo["z_haut"], [d["nom"] for d in mvo["dielectriques"]]))
verifie("et le modele distingue ce choix-la d'un defaut",
        [r["choisi"] for r in mvo["revetements"] if r["nom"] == "VERNIS-A"]
        == [True],
        str(mvo["revetements"]))
# LE COUT REVIENT AVEC LUI, et c'est tout l'interet de le dire : la cellule
# minuscule reparait, et l'avis NOMME desormais la couche qui la fabrique au
# lieu de proposer deux causes probables.
_av = [a for a in mvo["avis"] if a["titre"] == "Une cellule minuscule ralentit tout"]
verifie("le vernis remis fabrique de nouveau la cellule minuscule", len(_av) == 1,
        str([a["titre"] for a in mvo["avis"]]))
verifie("et l'avis nomme la couche, au lieu de faire deviner",
        bool(_av) and "VERNIS-A" in _av[0]["texte"] and "en z" in _av[0]["texte"],
        _av[0]["texte"] if _av else "aucun avis")

# UNE COUCHE ENTRE DEUX CUIVRES N'EST JAMAIS ECARTEE, si mince soit-elle :
# c'est un substrat, il porte le champ, et le supprimer collerait les deux
# conducteurs l'un sur l'autre.
_pile_mince = [
    {"nom": "TOP", "cuivre": True, "ep": 0.035, "seq": 1, "role": "signal"},
    {"nom": "PREPREG", "cuivre": False, "ep": 0.012, "er": ER, "df": 0.02,
     "seq": 2},
    {"nom": "CORE", "cuivre": False, "ep": H, "er": ER, "df": 0.02, "seq": 3},
    {"nom": "BOTTOM", "cuivre": True, "ep": 0.035, "seq": 4, "role": "gnd"},
]
mvi = openems_modele.normaliser(document(empilage=_pile_mince))
verifie("un dielectrique mince ENTRE deux cuivres reste dans le modele",
        [d["nom"] for d in mvi["dielectriques"]] == ["CORE", "PREPREG"]
        and not mvi["revetements"],
        "%s, revetements = %s"
        % ([d["nom"] for d in mvi["dielectriques"]], mvi["revetements"]))
verifie("et c'est lui que l'avis nomme alors",
        any("PREPREG" in a["texte"] for a in mvi["avis"]
            if a["titre"] == "Une cellule minuscule ralentit tout"),
        str([a["texte"] for a in mvi["avis"]
             if a["titre"] == "Une cellule minuscule ralentit tout"]))

# UN REVETEMENT EPAIS, LUI, EST GARDE PAR DEFAUT : la borne ne parle que de ce
# qui coute plus qu'il ne rapporte.
_pile_radome = pile_vernis()
_pile_radome[0]["ep"] = 1.0
mvr = openems_modele.normaliser(document(empilage=_pile_radome))
verifie("un revetement exterieur epais est garde sans qu'on le demande",
        "VERNIS-A" in [d["nom"] for d in mvr["dielectriques"]]
        and [r["garde"] for r in mvr["revetements"]
             if r["nom"] == "VERNIS-A"] == [True],
        str(mvr["revetements"]))
mvd = openems_modele.normaliser(document(
    empilage=[dict(e, **({"garder": False} if e["nom"] == "VERNIS-A" else {}))
              for e in _pile_radome]))
verifie("et une case decochee le sort quand meme",
        "VERNIS-A" not in [d["nom"] for d in mvd["dielectriques"]],
        str([d["nom"] for d in mvd["dielectriques"]]))

# L'ENERGIE D'ARRET, ET POURQUOI ELLE A SA PLACE DANS UN BANC. Elle est
# NEGATIVE — des decibels sous le maximum —, et la seule fonction de lecture
# qui rendait son defaut sur toute valeur <= 0 l'a rendue muette pendant
# longtemps : le document disait -50 dB, le modele et le script disaient -40.
# Rien ne le montrait, puisque le calcul tournait et rendait une courbe. Le
# document d'essai porte -30 dB : c'est ce nombre-la qu'on relit.
verifie("l'energie d'arret saisie est celle qui part au solveur",
        abs(m["arret"]["energie_dB"] + 30.0) < 1e-9,
        "energie_dB = %s, attendu -30" % m["arret"]["energie_dB"])
verifie("une energie plus basse est suivie, et non ramenee au defaut",
        abs(openems_modele.normaliser(
            document(arret={"energie": -55, "nmax": 20000}))
            ["arret"]["energie_dB"] + 55.0) < 1e-9)
verifie("le signe est normalise : 50 et -50 disent la meme chose",
        abs(openems_modele.normaliser(
            document(arret={"energie": 50, "nmax": 20000}))
            ["arret"]["energie_dB"] + 50.0) < 1e-9)
verifie("une energie absente retombe sur le defaut",
        abs(openems_modele.normaliser(document(arret={"nmax": 20000}))
            ["arret"]["energie_dB"] - openems_modele.ENERGIE_DEFAUT) < 1e-9)
verifie("une energie nulle aussi : elle n'arreterait jamais rien",
        abs(openems_modele.normaliser(
            document(arret={"energie": 0, "nmax": 20000}))
            ["arret"]["energie_dB"] - openems_modele.ENERGIE_DEFAUT) < 1e-9)

# TROIS CELLULES DANS LE SUBSTRAT, ET ELLES SURVIVENT. L'intention etait
# ecrite dans `_maillage` depuis toujours : « au moins trois cellules dans un
# substrat, une seule ne represente pas le champ qui se courbe sous une
# piste ». Elle n'avait jamais eu lieu -- ces lignes etaient rangees dans le
# REMPLISSAGE, et le seuil du tiers du pas les effacait toutes les trois. Le
# patch d'essai tournait donc avec UNE cellule pour ses 1,6 mm de FR-4, et
# c'est ce champ-la qui fait l'impedance de la ligne.
_zin = [v for v in m["maillage"]["z"] if 1e-9 < v < H - 1e-9]
verifie("le substrat recoit au moins trois cellules en z",
        len(_zin) >= openems_modele.CELLULES_PAR_SUBSTRAT - 1,
        "%d ligne(s) interieure(s) : %s"
        % (len(_zin), ["%.4f" % v for v in _zin]))

verifie("le port occupe le dielectrique et non le metal",
        abs(m["port"]["z1"] - cu["BOTTOM"]["z1"]) < 1e-9
        and abs(m["port"]["z2"] - cu["TOP"]["z0"]) < 1e-9,
        "port z %.4f -> %.4f" % (m["port"]["z1"], m["port"]["z2"]))
verifie("la hauteur du port est celle du substrat",
        abs((m["port"]["z2"] - m["port"]["z1"]) - H) < 1e-9)

lam_bas = C0 / 2.0e9 * 1000.0
verifie("l'air utile vaut un quart de lambda a la frequence basse",
        abs(m["boite"]["air_utile"] - lam_bas / 4) < 1e-6,
        "air_utile = %.2f, attendu %.2f" % (m["boite"]["air_utile"], lam_bas / 4))
verifie("la marge conseillee ajoute l'epaisseur de la PML a cet air",
        abs(m["boite"]["marge_conseil"]
            - (lam_bas / 4 + m["boite"]["pml"] * m["resolution"]["air"])) < 1e-6,
        "conseil = %.2f, PML = %d x %.3f"
        % (m["boite"]["marge_conseil"], m["boite"]["pml"], m["resolution"]["air"]))
verifie("la marge par defaut est jugee suffisante", m["boite"]["marge_suffisante"])
verifie("il reste bien lambda/4 d'air une fois la PML retranchee",
        abs(m["boite"]["air_restant"] - lam_bas / 4) < 1e-6,
        "air_restant = %.2f" % m["boite"]["air_restant"])

# LA REGRESSION QUI A MOTIVE CE DECOUPAGE : une marge egale a lambda/4 tout
# court laisse la PML mordre dans la structure, et rien ne le disait.
_d = document()
_d["boite"] = {"mx": lam_bas / 4, "my": lam_bas / 4,
               "mz_haut": lam_bas / 4, "mz_bas": lam_bas / 4}
_mm = openems_modele.normaliser(_d)
verifie("une marge de lambda/4 SANS la PML est refusee",
        not _mm["boite"]["marge_suffisante"],
        "air restant = %.2f mm" % _mm["boite"]["air_restant"])
verifie("et l'avis dit de combien la PML deborde",
        any(a["rang"] == "grave" and "Marge" in a["titre"] for a in _mm["avis"]),
        str([a["titre"] for a in _mm["avis"]]))

res = m["resolution"]
lam_haut = C0 / 3.0e9 * 1000.0
verifie("pas d'air = lambda(f_max) / 20",
        abs(res["air"] - lam_haut / 20) < 1e-6,
        "%.4f vs %.4f" % (res["air"], lam_haut / 20))
# Le patch d'essai n'a pas de cuivre etroit : la borne geometrique ne mord
# pas, et le pas reste celui de lambda/20.
verifie("pas dielectrique = pas d'air / racine(er) quand rien n'est etroit",
        abs(res["die"] - lam_haut / 20 / math.sqrt(ER)) < 1e-6,
        "%.4f vs %.4f  (detail %s)"
        % (res["die"], lam_haut / 20 / math.sqrt(ER), res["detail"]))

# ... mais une piste fine, elle, doit tirer le maillage vers le bas : c'est la
# regle qui a fait reapparaitre la resonance du patch de l'exemple.
_d_fin = document()
_d_fin["cuivre"][0]["polys"].append({"o": rect(5.0, 5.0, 20.0, 2.0)})
_m_fin = openems_modele.normaliser(_d_fin)
verifie("une piste de 2 mm impose quatre cellules en travers",
        abs(_m_fin["resolution"]["die"] - 2.0 / 4.0) < 1e-6,
        "%.4f" % _m_fin["resolution"]["die"])
verifie("et le pas de l'air, lui, ne bouge pas",
        abs(_m_fin["resolution"]["air"] - res["air"]) < 1e-9)

# LE FOND S'ARRETE OU LE BUDGET DE LIGNES S'ARRETE, et la carte d'essai fait
# 70 mm : une piste de 1 mm y demanderait 0,25 mm de pas sur TOUTE l'emprise,
# soit 280 lignes par axe. Le fond tient donc a 0,35 mm.
#
# MAIS LA PISTE, ELLE, EST MAILLEE FIN QUAND MEME. C'est tout l'objet des
# bandes : le pas de 0,25 mm n'est pose qu'EN TRAVERS du ruban, sur un
# millimetre et sur le seul axe ou il est etroit. Avant, l'outil renoncait et
# disait « retirez ce cuivre de la selection » ; il ne renonce plus, et ce qu'
# il depense pour cela se chiffre.
_d_1mm = document()
_d_1mm["cuivre"][0]["polys"].append({"o": rect(5.0, 5.0, 20.0, 1.0)})
_m_1mm = openems_modele.normaliser(_d_1mm)
_det1 = _m_1mm["resolution"]["detail"]
_md1 = _m_1mm["maillage_detail"]
verifie("sous le budget de lignes, le FOND s'arrete au plancher",
        abs(_m_1mm["resolution"]["die"] - PLAN / 200.0) < 1e-6,
        "%.4f pour une carte de %.0f mm" % (_m_1mm["resolution"]["die"], PLAN))
verifie("mais une bande fine descend en travers de la piste",
        abs(_det1["fin"] - 1.0 / openems_modele.CELLULES_PAR_PISTE) < 1e-6,
        "pas fin = %.4f, voulu %.4f" % (_det1["fin"], _det1["fin_voulu"]))
verifie("et sur le SEUL axe ou la piste est etroite",
        _md1["bandes_y"] == 1 and _md1["bandes_x"] == 0,
        "x=%d y=%d" % (_md1["bandes_x"], _md1["bandes_y"]))
verifie("la piste a desormais ses quatre cellules en travers",
        _det1["pistes"]["cellules"] > 3.99,
        "%.2f cellules pour %.3f mm"
        % (_det1["pistes"]["cellules"], _det1["pistes"]["largeur"]))
verifie("openEMS ne laissera plus tomber aucun polygone",
        _det1["pistes"]["ignores"] == 0,
        "%d ignore(s)" % _det1["pistes"]["ignores"])
# ET LE PRIX EST LA MOITIE DE LA QUESTION. Un maillage fin partout aurait
# coute des dizaines de fois le fond ; la bande en coute une fraction.
verifie("l'affinage ne coute qu'une fraction du maillage de fond",
        _det1["cout"] < _det1["cout_fond"] * 1.5,
        "%.3g contre %.3g" % (_det1["cout"], _det1["cout_fond"]))
verifie("et l'avis dit ce qui a ete affine, et ce que cela coute",
        any("affine en travers" in a["titre"] for a in _m_1mm["avis"]),
        str([a["titre"] for a in _m_1mm["avis"]]))
verifie("plus personne ne declare cette piste non resolue",
        not any("pas resolu" in a["titre"] for a in _m_1mm["avis"]),
        str([a["titre"] for a in _m_1mm["avis"]]))

# LE BUDGET MORD, ET C'EST SA RAISON D'ETRE. Vingt pistes fines eparpillees
# sur la carte demandent vingt bandes : le pas fin recule alors d'un cran a la
# fois jusqu'a ce que le prix tienne. « Affiner le maillage » ne doit pas
# vouloir dire « multiplier la duree par cinquante » sans que personne l'ait
# demande.
# Vingt pistes de 0,5 mm tiennent encore : quatre cellules chacune pour un
# tiers de maillage en plus.
_d_20 = document()
for _i in range(20):
    _d_20["cuivre"][0]["polys"].append({"o": rect(3.0 + 3.0 * _i, 5.0, 0.5, 40.0)})
_m_20 = openems_modele.normaliser(_d_20)
_det_20 = _m_20["resolution"]["detail"]
verifie("vingt pistes de 0,5 mm : toutes resolues, pour un tiers de plus",
        not _det_20["fin_borne"] and _det_20["pistes"]["cellules"] > 3.99
        and _det_20["cout"] < _det_20["cout_fond"] * 1.5,
        "%.2f cellules, cout x%.2f"
        % (_det_20["pistes"]["cellules"],
           _det_20["cout"] / _det_20["cout_fond"]))

# Les memes en 0,3 mm, elles, ne tiennent plus : le pas voulu descendrait a
# 0,075 mm et le calcul passerait le plafond. L'affinage recule alors d'un cran
# a la fois -- trois cellules en travers au lieu de quatre, et le prix tenu.
_d_fines = document()
for _i in range(20):
    _d_fines["cuivre"][0]["polys"].append(
        {"o": rect(3.0 + 3.0 * _i, 5.0, 0.3, 40.0)})
_m_20 = openems_modele.normaliser(_d_fines)
_det20 = _m_20["resolution"]["detail"]
verifie("vingt pistes de 0,3 mm : le budget arrete l'affinage",
        _det20["fin_borne"] and _det20["fin"] > _det20["fin_voulu"],
        "pas fin %.4f, voulu %.4f" % (_det20["fin"], _det20["fin_voulu"]))
verifie("il recule d'un cran a la fois, il ne renonce pas",
        _det20["pistes"]["cellules"] > 2.0,
        "%.2f cellules en travers" % _det20["pistes"]["cellules"])
verifie("et le prix reste sous le plafond qu'on s'est donne",
        _det20["cout"] <= _det20["cout_fond"]
        * openems_modele.AFFINAGE_COUT_MAX * 1.001,
        "%.3g contre %.3g x %g"
        % (_det20["cout"], _det20["cout_fond"],
           openems_modele.AFFINAGE_COUT_MAX))
verifie("le maillage reste tout de meme meilleur que le fond seul",
        _det20["pistes"]["cellules"] > 0.3 / _m_20["resolution"]["die"],
        "%.2f cellules en travers de 0,3 mm"
        % _det20["pistes"]["cellules"])
verifie("et l'avis dit que le budget a arrete l'affinage",
        any("budget" in a["texte"] for a in _m_20["avis"]),
        str([a["titre"] for a in _m_20["avis"]]))

# QUAND LE FOND SUFFIT, ON N'AFFINE PAS : une piste de 2 mm tire deja le fond
# a 0,5 mm (quatre cellules en travers), et une bande par-dessus ne serait
# qu'un pas de temps plus court pour rien.
verifie("aucune bande quand le fond resout deja le cuivre",
        (_m_fin["resolution"]["detail"]["fin"] or 0.0) == 0.0,
        "pas fin = %s" % _m_fin["resolution"]["detail"].get("fin"))

# Une pastille de 50 microns ne doit pas emmener toute la carte avec elle.
_d_pad = document()
_d_pad["cuivre"][0]["polys"].append({"o": rect(5.0, 5.0, 0.05, 0.05)})
_m_pad = openems_modele.normaliser(_d_pad)
verifie("un detail minuscule est borne, pas suivi",
        _m_pad["resolution"]["die"] >= res["die"] / 8.0 - 1e-9,
        "%.4f" % _m_pad["resolution"]["die"])
# ET AUCUNE BANDE NE VIENT LE SAUVER : une bande plus mince que le pas fin
# retenu poserait une cellule de sa largeur -- 50 microns -- laquelle
# commanderait le pas de temps de TOUT le domaine, pour un cuivre qu'elle ne
# resout meme pas. Le budget recule jusqu'a ce que la bande disparaisse.
verifie("et aucune bande fine n'est posee sur une pastille de 50 microns",
        (_m_pad["resolution"]["detail"]["fin"] or 0.0) == 0.0,
        "pas fin = %s" % _m_pad["resolution"]["detail"].get("fin"))
verifie("et l'avis dit que ce cuivre-la n'est pas resolu",
        any("pas resolu" in a["titre"] for a in _m_pad["avis"]),
        str([a["titre"] for a in _m_pad["avis"]]))

# L'EXCITATION EST PLUS LARGE QUE L'ANALYSE, ET C'EST VOULU : une impulsion
# calquee sur une bande etroite dure des milliers de pas de temps, et openEMS
# refuse alors de la laisser finir. Voir `_bande`.
# LE PORT LOCALISE PART AU SOLVEUR COMME UNE LIGNE, pas comme une boite : sa
# sonde de courant est toute son empreinte, et une empreinte large y compte du
# courant de deplacement qui n'est pas du courant de port.
_p = m["ports"][0]
verifie("le port localise est degenere dans le plan",
        abs(_p["x2"] - _p["x1"]) < 1e-12 and abs(_p["y2"] - _p["y1"]) < 1e-12,
        "%.4f x %.4f" % (_p["x2"] - _p["x1"], _p["y2"] - _p["y1"]))
verifie("mais il garde sa hauteur : c'est elle qui porte la tension",
        _p["z2"] - _p["z1"] > 0.9 * H)
verifie("et les cotes designees le suivent, pour l'affichage",
        _p["w"] > 0 and _p["l"] > 0)
verifie("le script emet un port de meme point de depart et d'arrivee",
        "[%s, %s, 0]" % (openems_script._f(_p["x1"]), openems_script._f(_p["y1"]))
        in openems_script.generer(m))

verifie("l'impulsion est centree sur la bande",
        abs(m["bande"]["f0"] - 2.5e9) < 1)
verifie("elle couvre la bande, et plus large qu'elle",
        m["bande"]["fc"] >= 0.5e9 - 1
        and m["bande"]["fc"] >= 0.4 * m["bande"]["f0"] - 1,
        "fc = %.4g" % m["bande"]["fc"])
verifie("sa duree est dite, pour que le nombre de pas puisse s'en deduire",
        abs(m["bande"]["t_excitation"] - 9.0 / (math.pi * m["bande"]["fc"]))
        < 1e-18)

est = m["estimation"]
print("     maillage %d x %d x %d = %s cellules, %.0f Mo, dt = %.3e s"
      % (est["lignes"][0], est["lignes"][1], est["lignes"][2],
         "{:,}".format(est["cellules"]).replace(",", " "),
         est["memoire_Mo"], est["dt_s"]))
verifie("le maillage est chiffre", est["cellules"] > 1000)
verifie("aucune cellule degeneree",
        min(est["plus_petite_cellule_mm"]) > 1e-4,
        str(est["plus_petite_cellule_mm"]))

lignes_z = m["maillage"]["z"]
verifie("une ligne de maillage tombe sur chaque interface de l'empilage",
        all(any(abs(z - v) < 1e-9 for v in lignes_z)
            for z in (0.0, H)),
        "z obligatoires absents de " + str(lignes_z[:6]))
verifie("en mode volume aussi, les quatre interfaces sont maillees",
        all(any(abs(z - v) < 1e-9 for v in mv["maillage"]["z"])
            for z in (0.0, 0.035, 0.035 + H, mv["z_haut"])))
verifie("les lignes de maillage sont strictement croissantes",
        all(lignes_z[i] < lignes_z[i + 1] for i in range(len(lignes_z) - 1)))

# -- AUCUNE CELLULE-COPEAU, ET C'EST LE PAS DE TEMPS QUI SE JOUE LA ----------
# Le pas de temps FDTD est commande par la plus petite cellule de TOUT le
# domaine : une seule cellule dix fois plus fine que le pas vise multiplie par
# dix le nombre de pas a calculer, sans rien decrire de plus. Deux mecanismes
# en fabriquaient : deux aretes de cuivre presque confondues (l'arrondi d'un
# bout de piste, un ruban de 1,00 mm contre un de 1,02 sur le meme axe), et
# surtout une ligne de remplissage tombee a quelques dizaines de microns d'une
# ligne de la regle du tiers. Mesure sur le F inverse du gabarit : 0,043 mm de
# plus petite cellule pour un pas vise de 0,25 -- trois heures et demie de
# calcul la ou une demi-heure suffisait.
for _axe, _li in (("x", m["maillage"]["x"]), ("y", m["maillage"]["y"])):
    _pas = [_li[i + 1] - _li[i] for i in range(len(_li) - 1)]
    verifie("aucune cellule-copeau en %s : la plus fine vaut au moins le "
            "tiers du pas vise" % _axe,
            min(_pas) >= m["resolution"]["die"] / 3.0 - 1e-9,
            "plus fine %.4f mm, pas vise %.4f mm"
            % (min(_pas), m["resolution"]["die"]))

# Deux aretes separees par moins que la tolerance ne donnent qu'un seul jeu de
# lignes -- et LE CUIVRE, LUI, GARDE SES COTES : c'est la grille qu'on
# simplifie, pas le dessin.
d_eps = document()
d_eps["cuivre"] = [dict(c) for c in d_eps["cuivre"]]
d_eps["cuivre"][0] = {"couche": "TOP",
                      "polys": [{"o": rect(10.0, 10.0, 20.0, 20.0)},
                                {"o": rect(10.01, 31.0, 20.0, 5.0)}]}
m_eps = openems_modele.normaliser(d_eps)
verifie("deux aretes a 0,01 mm l'une de l'autre sont confondues pour le maillage",
        (m_eps.get("maillage_detail") or {}).get("aretes_groupees", 0) >= 1,
        str(m_eps.get("maillage_detail")))
verifie("et l'assistant le dit",
        any("confondues" in a["titre"] for a in m_eps["avis"]),
        str([a["titre"] for a in m_eps["avis"]]))
verifie("le cuivre envoye au solveur garde ses cotes exactes",
        abs(m_eps["cuivre"][0]["polys"][1]["o"][0][0] - 10.01) < 1e-9,
        str(m_eps["cuivre"][0]["polys"][1]["o"][0]))

# -- LE COMPTEUR DE PAS SE CALCULE -------------------------------------------
# Zero veut dire « calcule-le », comme un pas de maillage a zero. Le bon
# nombre depend du pas de temps, donc du maillage : un nombre saisi une fois
# ne vaut plus rien des qu'on retouche la grille.
m_auto = openems_modele.normaliser(document(arret={"energie": -40, "nmax": 0}))
_pas_exc = m_auto["bande"]["t_excitation"] / m_auto["estimation"]["dt_s"]
verifie("un nmax a zero est calcule", m_auto["arret"].get("nmax_auto") is True)
_periodes = (openems_modele.NMAX_PERIODES
             / (m_auto["bande"]["fcible"] * m_auto["estimation"]["dt_s"]))
verifie("il tient l'impulsion, la ou openEMS en exige trois",
        m_auto["arret"]["nmax"] >= 3.0 * _pas_exc,
        "%d pas pour une impulsion de %.0f" % (m_auto["arret"]["nmax"], _pas_exc))
# LE PLUS GRAND DES DEUX CRITERES, ET PAS LA SOMME : l'impulsion et
# l'extinction ne s'ajoutent pas, elles se recouvrent.
verifie("et il tient aussi la decroissance a -40 dB",
        abs(m_auto["arret"]["nmax"]
            - max(4.0 * _pas_exc, _periodes)) < 2,
        "%d pas : impulsion %.0f, decroissance %.0f"
        % (m_auto["arret"]["nmax"], 4.0 * _pas_exc, _periodes))
verifie("un calcul dont le compteur est calcule ne peut plus etre tronque",
        not any("impulsion" in a["titre"] or "garde-fou" in a["titre"]
                for a in m_auto["avis"]),
        str([a["titre"] for a in m_auto["avis"]]))
m_saisi = openems_modele.normaliser(document(arret={"energie": -40, "nmax": 12345}))
verifie("un nmax saisi reste celui qu'on a saisi",
        m_saisi["arret"]["nmax"] == 12345
        and m_saisi["arret"].get("nmax_auto") is False)
# LE NOMBRE CALCULE RESTE LISIBLE A COTE DU NOMBRE SAISI : c'est ce que la
# page affiche pour que l'ecart se voie au lieu de se subir.
verifie("et le nombre calcule reste lisible a cote",
        m_saisi["arret"]["nmax_calcule"] == m_auto["arret"]["nmax"])
m_court = openems_modele.normaliser(
    document(arret={"energie": -40,
                    "nmax": int(m_auto["arret"]["nmax"] * 0.6)}))
verifie("un garde-fou saisi trop court est signale",
        any("garde-fou" in a["titre"] for a in m_court["avis"]),
        str([a["titre"] for a in m_court["avis"]]))
# ... ET SEULEMENT S'IL EST TROP COURT. Un nombre saisi plus genereux que le
# calcul n'a rien de suspect : il ne coute que si l'energie ne descend pas.
m_large = openems_modele.normaliser(
    document(arret={"energie": -40, "nmax": m_auto["arret"]["nmax"] * 3}))
verifie("un garde-fou saisi plus large ne dit rien",
        not any("garde-fou" in a["titre"] for a in m_large["avis"]),
        str([a["titre"] for a in m_large["avis"]]))
# -- LES PAS DE MAILLAGE CALCULES RESTENT LISIBLES ---------------------------
m_pas = openems_modele.normaliser(document(maillage={"res_die": 0.9}))
_d = m_pas["resolution"]["detail"]
verifie("un pas de maillage saisi est signale comme tel",
        _d["saisi"] is True and _d["saisi_air"] is False)
verifie("et le pas calcule reste lisible a cote du pas saisi",
        _d["die"] > 0 and abs(_d["die"] - 0.9) > 1e-9
        and abs(_d["air"] - m_pas["resolution"]["air"]) < 1e-9,
        "calcule %.4f, saisi %.4f" % (_d["die"], m_pas["resolution"]["die"]))

print()
print("2. Refus attendus")


def refuse(nom, doc, morceau):
    try:
        openems_modele.normaliser(doc)
    except openems_modele.ErreurModele as exc:
        verifie(nom, morceau.lower() in (exc.message + exc.conseil).lower(),
                "message obtenu : " + exc.message)
        return
    verifie(nom, False, "aucune erreur levee")


d = document()
d["port"]["a"] = "TOP"
refuse("un port qui relie une couche a elle-meme", d, "elle-meme")

d = document()
d["empilage"][1]["ep"] = 0
refuse("un dielectrique sans epaisseur", d, "epaisseur")

d = document()
d["port"]["x"] = 900.0
refuse("un port pose hors du cuivre", d, "hors du cuivre")

d = document()
d["cuivre"] = []
refuse("une selection vide", d, "aucun cuivre")

d = document()
d["bande"] = {"f1": 2.45e9, "f2": 2.45e9}
refuse("une bande de largeur nulle", d, "etroite")

d = document()
d["cuivre"][0]["couche"] = "MID1"
refuse("du cuivre sur une couche absente de l'empilage", d, "empilage")

print()
print("3. Avis de l'assistant")
d = document()
d["boite"] = {"mx": 2, "my": 2, "mz_haut": 2, "mz_bas": 2}
avis = openems_modele.normaliser(d)["avis"]
verifie("une marge de 2 mm est signalee comme grave",
        any(a["rang"] == "grave" and "Marge" in a["titre"] for a in avis),
        str([a["titre"] for a in avis]))

d = document()
d["empilage"][1]["er"] = 0
d["empilage"][1]["df"] = 0
avis = openems_modele.normaliser(d)["avis"]
verifie("une permittivite absente est dite supposee",
        any("completees" in a["titre"] for a in avis),
        str([a["titre"] for a in avis]))


print()
print("4. Script autonome")
texte = openems_script.generer(m)
try:
    compile(texte, "script-genere", "exec")
    verifie("le script produit est du Python valide", True)
except SyntaxError as exc:
    verifie("le script produit est du Python valide", False, str(exc))

verifie("le script porte l'impulsion, la PML et le port",
        "SetGaussExcite" in texte and "PML_" in texte
        and "AddLumpedPort" in texte)
import re as _re
verifie("aucune valeur NaN ni infinie n'est ecrite dans le script",
        not _re.search(r"(nan|inf|-inf)", texte),
        "trouve : " + str(_re.findall(r"(?:nan|inf|-inf)", texte)[:3]))
verifie("les trois axes de maillage y sont",
        texte.count("mesh.SetLines") == 3)
verifie("la conductivite de pertes est calculee, pas recopiee",
        "kappa=" in texte and "tan d =" in texte)
verifie("le script declare la recherche automatique et relative des DLL",
        "add_dll_directory" in texte and "OPENEMS_DLL" in texte
        and "_candidats" in texte and "CSXCAD.dll" in texte)
_t_dll = openems_script.generer(m, chemin_openems=r"C:\un\dossier\inexistant\openEMS")
verifie("le dossier d'origine est en tete de liste des candidats",
        "inexistant" in _t_dll and "_candidats" in _t_dll)



def aire(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return a / 2.0


print()
print("5. Cuivre avec decoupe (plan troue)")
d = document()
d["cuivre"][1]["polys"][0]["t"] = [rect(30, 30, 10, 10)]
m2 = openems_modele.normaliser(d)
poly = m2["cuivre"][1]["polys"][0]
verifie("la decoupe est conservee", len(poly["t"]) == 1 and len(poly["t"][0]) == 4)
verifie("le contour tourne dans le sens direct, la decoupe a l'envers",
        aire(poly["o"]) > 0 and aire(poly["t"][0]) < 0,
        "aires %.2f / %.2f" % (aire(poly["o"]), aire(poly["t"][0])))
t2 = openems_script.generer(m2)
verifie("la decoupe sort a une priorite superieure au plan de masse",
        "priority=11" in t2 and "priority=10" in t2)
verifie("le conducteur sans trou sort a priorite superieure a la decoupe",
        "priority=12" in t2)
# Des trous sur TOUTES les couches : ceux de dessus se remplissent de
# substrat, ceux de dessous d'air. `air_trou` n'etait cree que si le tout
# premier trou en avait besoin — NameError au lancement sinon.
d = document()
for bloc in d["cuivre"]:
    for poly in bloc["polys"]:
        poly["t"] = [rect(30, 30, 10, 10)]
t3 = openems_script.generer(openems_modele.normaliser(d))
if "air_trou." in t3:
    verifie("air_trou est cree avant d'etre employe",
            "air_trou = CSX.AddMaterial" in t3 and
            t3.index("air_trou = CSX.AddMaterial") < t3.index("air_trou."))
verifie("air_trou n'est cree qu'une fois", t3.count("air_trou = CSX.AddMaterial") <= 1)

print()
print("5b. Les trois modes de cuivre")
for mode, attendu in (("feuille", "AddConductingSheet"),
                      ("pec", "AddMetal"),
                      ("volume", "AddLinPoly")):
    mm = openems_modele.normaliser(document(modele_cuivre=mode))
    tt = openems_script.generer(mm)
    verifie("le mode %s emploie %s" % (mode, attendu), attendu in tt)
    try:
        compile(tt, "s", "exec")
        verifie("le script du mode %s compile" % mode, True)
    except SyntaxError as exc:
        verifie("le script du mode %s compile" % mode, False, str(exc))
# La conductivite declaree par le document. Elle n'arrive que du mode
# conception : un fichier IPC-2581 ne dit jamais de quel metal est sa couche,
# et le cuivre reste le repli. Une antenne serigraphiee a l'encre argent est
# dix fois plus resistive, et cela ne se voit QUE sur le rendement -- le S11,
# lui, reste beau. Si cette valeur se perdait en route, rien ne le dirait.
d_ag = document()
d_ag["empilage"] = [dict(e) for e in d_ag["empilage"]]
d_ag["empilage"][0]["sigma"] = 5.0e6
m_ag = openems_modele.normaliser(d_ag)
cu_ag = {c["nom"]: c for c in m_ag["conducteurs"]}
verifie("la conductivite declaree remplace celle du cuivre",
        abs(cu_ag["TOP"]["sigma"] - 5.0e6) < 1.0,
        "sigma(TOP) = %.3e" % cu_ag["TOP"]["sigma"])
verifie("celle qui n'est pas declaree reste du cuivre",
        abs(cu_ag["BOTTOM"]["sigma"] - 5.8e7) < 1.0,
        "sigma(BOTTOM) = %.3e" % cu_ag["BOTTOM"]["sigma"])
verifie("et elle arrive jusqu'au script",
        "conductivity=5e+06" in openems_script.generer(m_ag))

verifie("le mode feuille ne mange pas le pas de temps",
        openems_modele.normaliser(document())["estimation"]["dt_s"]
        > 5 * mv["estimation"]["dt_s"],
        "feuille %.3e vs volume %.3e"
        % (openems_modele.normaliser(document())["estimation"]["dt_s"],
           mv["estimation"]["dt_s"]))

print()
print("6. Pouces -> millimetres")
d = document()
d["unite"] = "in"
d["empilage"][1]["ep"] = H / 25.4
d["empilage"][0]["ep"] = d["empilage"][2]["ep"] = 0.035 / 25.4
# Le cuivre et le port aussi, sans quoi la comparaison ne porterait que sur
# l'empilage — la partie qui etait deja juste.
d["cuivre"] = [{"couche": c["couche"],
                "polys": [{"o": [v / 25.4 for v in p["o"]]} for p in c["polys"]]}
               for c in document()["cuivre"]]
d["port"] = dict(document()["port"])
for cle in ("x", "y", "w", "l"):
    d["port"][cle] = d["port"][cle] / 25.4
# … et les marges, qui sont dans l'unite du fichier comme tout le reste.
d["boite"] = {"mx": 40 / 25.4, "my": 40 / 25.4,
              "mz_haut": 40 / 25.4, "mz_bas": 40 / 25.4}
m3 = openems_modele.normaliser(d)
verifie("l'empilage en pouces donne les memes cotes en mm",
        abs(m3["z_haut"] - m["z_haut"]) < 1e-6,
        "%.5f vs %.5f" % (m3["z_haut"], m["z_haut"]))
verifie("le cuivre en pouces occupe la meme emprise en mm",
        all(abs(a - b) < 1e-6
            for a, b in zip(m3["boite_cuivre"], m["boite_cuivre"])),
        "%s vs %s" % (m3["boite_cuivre"], m["boite_cuivre"]))
verifie("une marge saisie en pouces vaut bien 40 mm",
        abs(m3["boite"]["mx"] - 40.0) < 1e-6,
        "mx = %.4f mm" % m3["boite"]["mx"])
verifie("le port en pouces retombe au meme endroit en mm",
        abs(m3["port"]["x"] - m["port"]["x"]) < 1e-6
        and abs(m3["port"]["y"] - m["port"]["y"]) < 1e-6,
        "(%.4f, %.4f) vs (%.4f, %.4f)"
        % (m3["port"]["x"], m3["port"]["y"], m["port"]["x"], m["port"]["y"]))

print()
print("7. Doublons de maillage")
d = document()
# Deux polygones dont les aretes sont a un micron l'une de l'autre : sans le
# nettoyage des lignes trop proches, elles fabriquent une cellule minuscule
# qui commande le pas de temps de tout le domaine.
d["cuivre"][0]["polys"].append({"o": rect(16.000001, 20, 10, 10)})
m4 = openems_modele.normaliser(d)
mini = min(m4["estimation"]["plus_petite_cellule_mm"])
verifie("deux aretes presque confondues ne creent pas de cellule minuscule",
        mini > m4["resolution"]["die"] / 20.0,
        "plus petite cellule %.6f mm, pas vise %.4f"
        % (mini, m4["resolution"]["die"]))

print()
print("8. Via")
d = document()
d["vias"] = [{"x": 20.0, "y": 20.0, "d": 0.3, "de": "TOP", "a": "BOTTOM"}]
m5 = openems_modele.normaliser(d)
v = m5["vias"][0]
verifie("le via traverse tout l'empilage",
        abs(v["z0"]) < 1e-9 and abs(v["z1"] - m5["z_haut"]) < 1e-9)
verifie("le diametre devient un rayon", abs(v["r"] - 0.15) < 1e-9)
verifie("le via sort en cylindre dans le script",
        "AddCylinder" in openems_script.generer(m5))


print()
print("9. Les pertes du dielectrique")

# -- kappa : juste a une frequence, et l'ecart se chiffre ------------------
mk = openems_modele.normaliser(document(pertes={"mode": "kappa"}))
verifie("kappa est calcule au centre de la bande par defaut",
        abs(mk["pertes"]["f_kappa"] - 2.5e9) < 1,
        "%.4g Hz" % mk["pertes"]["f_kappa"])
verifie("kappa = 2.pi.f.eps0.er.tan(d)",
        abs(mk["dielectriques"][0]["kappa"]
            - 2 * math.pi * 2.5e9 * 8.8541878128e-12 * ER * 0.02) < 1e-9)
# A kappa constant, tan(d) varie comme 1/f : au bord bas il vaut f_kappa/f1
# fois la valeur visee, soit 25 % de trop sur 2-3 GHz.
verifie("l'ecart de kappa aux bords est chiffre",
        abs(mk["pertes"]["ecart_kappa_pc"] - 25.0) < 0.5,
        "%.1f %%" % mk["pertes"]["ecart_kappa_pc"])
verifie("et il est signale",
        any("une frequence" in a["titre"] for a in mk["avis"]),
        str([a["titre"] for a in mk["avis"]]))

mk2 = openems_modele.normaliser(
    document(pertes={"mode": "kappa", "f_kappa": 2.0e9}))
verifie("la frequence de reference se choisit",
        abs(mk2["pertes"]["f_kappa"] - 2.0e9) < 1)
verifie("et kappa suit",
        mk2["dielectriques"][0]["kappa"] < mk["dielectriques"][0]["kappa"])

# -- debye : tan(d) plat, et mesure et non promis --------------------------
md = openems_modele.normaliser(document(pertes={"mode": "debye"}))
jeu = md["dielectriques"][0]["debye"]
verifie("le mode Debye produit un jeu de poles", jeu is not None)
verifie("au moins trois poles", len(jeu["poles"]) >= 3, str(len(jeu["poles"])))
verifie("tan(delta) tenu a mieux que 1 % sur la bande",
        jeu["ecart_tand_pc"] < 1.0, "%.2f %%" % jeu["ecart_tand_pc"])
verifie("la partie reelle ne derive pas non plus",
        jeu["ecart_er_pc"] < 2.0, "%.2f %%" % jeu["ecart_er_pc"])

# LA BORNE QUI COMPTE : openEMS saute en silence tout pole plus rapide que
# deux pas de temps. On en garde trois.
dt = md["estimation"]["dt_s"]
verifie("aucun pole plus rapide que trois pas de temps",
        min(p["tau"] for p in jeu["poles"]) >= 3.0 * dt - 1e-18,
        "tau min %.3e s, 3.dt = %.3e s"
        % (min(p["tau"] for p in jeu["poles"]), 3 * dt))


def _eps(jeu, f):
    w = 2 * math.pi * f
    re, im = jeu["eps_inf"], 0.0
    for p in jeu["poles"]:
        d = 1 + (w * p["tau"]) ** 2
        re += p["de"] / d
        im -= p["de"] * w * p["tau"] / d
    return re, im


re1, im1 = _eps(jeu, 2.0e9)
re2, im2 = _eps(jeu, 3.0e9)
verifie("tan(delta) vaut bien la valeur visee aux DEUX bords",
        abs((-im1 / re1) / 0.02 - 1) < 0.02 and abs((-im2 / re2) / 0.02 - 1) < 0.02,
        "%.5f a 2 GHz, %.5f a 3 GHz" % (-im1 / re1, -im2 / re2))
verifie("... la ou kappa se tromperait de plus de vingt pour cent",
        mk["pertes"]["ecart_kappa_pc"] > 20)

ts = openems_script.generer(md)
verifie("le script converti le materiau par le XML",
        "DebyeMaterial" in ts and "EpsilonRelaxTime_" in ts and
        "ReadFromXML" in ts)
verifie("et il remet kappa a zero pour ne pas compter les pertes deux fois",
        "'Kappa', '0,0,0'" in ts)
try:
    compile(ts, "s", "exec")
    verifie("le script du mode Debye compile", True)
except SyntaxError as exc:
    verifie("le script du mode Debye compile", False, str(exc))

print()
print("10. Les objets hors carte")

OBJETS = [
    {"nom": "boitier", "type": "boite", "materiau": "metal",
     "a": [-5, -5, -12], "b": [75, 75, -10]},
    {"nom": "monopole", "type": "fil", "materiau": "metal", "r": 0.5,
     "pts": [[35, 65, 1.6], [35, 65, 26.6]]},
    {"nom": "vis", "type": "cylindre", "materiau": "metal", "r": 1.0,
     "a": [5, 5, -10], "b": [5, 5, 0]},
    {"nom": "perle", "type": "sphere", "materiau": "dielectrique",
     "er": 6.0, "df": 0.005, "c": [35, 65, 27.0], "r": 2.0},
]
mo = openems_modele.normaliser(document(primitives=OBJETS))
verifie("les quatre formes sont acceptees", len(mo["primitives"]) == 4)
verifie("l'emprise descend jusqu'au boitier",
        abs(mo["emprise"][2] + 12.0) < 1e-9, "%.2f" % mo["emprise"][2])
verifie("et monte jusqu'a la perle",
        abs(mo["emprise"][5] - 29.0) < 1e-9, "%.2f" % mo["emprise"][5])
verifie("la boite d'air part de l'emprise, pas de la carte",
        mo["boite"]["z1"] < -12.0 and mo["boite"]["z2"] > 29.0)
verifie("l'emprise du fil est gonflee de son rayon",
        abs(openems_modele._emprise_primitive(mo["primitives"][1])[0]
            - (35 - 0.5)) < 1e-9)
zs = mo["maillage"]["z"]
verifie("chaque face d'objet porte une ligne de maillage",
        all(any(abs(v - q) < 1e-9 for q in zs) for v in (-12.0, -10.0, 29.0)))
verifie("un objet fait grossir le maillage, et cela se voit",
        mo["estimation"]["cellules"] > m["estimation"]["cellules"])

to = openems_script.generer(mo)
for attendu in ("AddWire", "AddCylinder", "AddBox", "AddSphere"):
    verifie("le script emet %s" % attendu, attendu in to)
verifie("le metal d'un objet est un conducteur parfait",
        "CSX.AddMetal('boitier')" in to)
verifie("un objet dielectrique porte sa permittivite",
        "CSX.AddMaterial('perle', epsilon=6" in to)
try:
    compile(to, "s", "exec")
    verifie("le script avec objets compile", True)
except SyntaxError as exc:
    verifie("le script avec objets compile", False, str(exc))

print()
print("11. Les enregistrements de champ")

mdf = openems_modele.normaliser(document(
    dumps={"actif": True, "types": ["J"], "mode": "frequentiel",
           "region": "plan_z", "z": 1.6, "sous_ech": 2}))
verifie("un plan est un plan : epaisseur nulle en z",
        mdf["dumps"]["z1"] == mdf["dumps"]["z2"] == 1.6)
verifie("le poids est chiffre", mdf["dumps"]["octets"] > 0)

mdt = openems_modele.normaliser(document(
    dumps={"actif": True, "types": ["J"], "mode": "temporel",
           "region": "boite", "sous_ech": 2}))
verifie("le temporel sur toute la boite pese des ordres de grandeur de plus",
        mdt["dumps"]["octets"] > 100 * mdf["dumps"]["octets"],
        "%.0f Mo contre %.3f Mo" % (mdt["dumps"]["octets"] / 1048576.0,
                                    mdf["dumps"]["octets"] / 1048576.0))
verifie("et il est signale avant, pas decouvert apres",
        any("temporel" in a["titre"] for a in mdt["avis"]),
        str([a["titre"] for a in mdt["avis"]]))

tf = openems_script.generer(mdf)
verifie("le mode frequentiel emet AddFrequency",
        "AddFrequency" in tf and "dump_type=12" in tf)
tt = openems_script.generer(mdt)
verifie("le mode temporel n'en emet pas",
        "AddFrequency" not in tt and "dump_type=2," in tt)
verifie("sans enregistrement, le script le dit et montre ou en ajouter",
        "Aucun enregistrement de champ demande" in openems_script.generer(m))

# --------------------------------------------------------------------------
print()
print("12. Plusieurs ports, et le couplage")
X0 = (PLAN - W_PATCH) / 2.0
Y0 = (PLAN - L_PATCH) / 2.0
# DEUX PORTS NE SONT PAS DEUX SIMULATIONS. Le S21 est ce qui SORT du port 2
# pendant que le port 1 excite : il n'existe que si les deux sont dans la
# meme boite, au meme instant. Aucun S11 ne le contient.
deux = document(ports=[
    dict(document()["port"], excite=True),
    {"type": "localise", "dir": "z", "x": PLAN / 2.0 + 12,
     "y": Y0 + L_PATCH / 3.0, "w": 1.0, "l": 1.0, "R": 50.0,
     "de": "TOP", "a": "BOTTOM", "excite": False},
])
deux.pop("port")
m2 = openems_modele.normaliser(deux)
verifie("deux ports entrent dans le modele", len(m2["ports"]) == 2,
        "%d" % len(m2["ports"]))
verifie("ils sont numerotes 1 et 2",
        [p["n"] for p in m2["ports"]] == [1, 2])
verifie("un seul excite", sum(1 for p in m2["ports"] if p["excite"]) == 1)
verifie("le port excite reste accessible sous son ancien nom",
        m2["port"]["n"] == 1 and m2["port"]["excite"])
verifie("chaque port pose ses aretes sur le maillage",
        all(any(abs(v - p["x1"]) < 1e-9 for v in m2["maillage"]["x"])
            and any(abs(v - p["x2"]) < 1e-9 for v in m2["maillage"]["x"])
            for p in m2["ports"]))

t2 = openems_script.generer(m2)
verifie("le script pose les deux ports",
        "port_1 = FDTD.AddLumpedPort(1," in t2
        and "port_2 = FDTD.AddLumpedPort(2," in t2)
verifie("le second est en charge et n'excite pas",
        "', 0, priority=50)" in t2)
verifie("le depouillement calcule le couplage",
        "couplages[2] = ports[1].uf_ref / port.uf_inc" in t2)
verifie("le script a deux ports compile", compile(t2, "<deux>", "exec") or True)

# L'ancienne forme a un seul port doit continuer de marcher : c'est tout le
# reste du banc qui le verifie, mais on le dit une fois explicitement.
verifie("un document a un seul « port » reste lu",
        len(openems_modele.normaliser(document())["ports"]) == 1)

refuse("deux excitations simultanees sont refusees",
       document(ports=[dict(document()["port"], excite=True),
                       dict(document()["port"], excite=True)]),
       "excites en meme temps")

# -- le tableau complet : N simulations, l'excitation deplacee -------------
# CE QUE CET ENCHAINEMENT AJOUTE, ET CE QU'IL N'INVENTE PAS. Chaque colonne
# est une simulation ORDINAIRE, normalisee par le meme chemin que les autres :
# ce qui est nouveau n'est pas un calcul, c'est le fait de les enchainer et de
# ranger les colonnes ensemble. Ce qui doit tenir : une colonne par port, une
# seule excitation par colonne, le meme maillage partout — sans quoi le
# tableau melangerait deux simulations incomparables.
ts = openems_modele.tableau_s(deux)
verifie("une colonne par port", len(ts["colonnes"]) == 2)
verifie("l'excitation se deplace d'une colonne a l'autre",
        [[q["n"] for q in c["modele"]["ports"] if q["excite"]]
         for c in ts["colonnes"]] == [[1], [2]])
verifie("chaque colonne n'a qu'une excitation",
        all(sum(1 for q in c["modele"]["ports"] if q["excite"]) == 1
            for c in ts["colonnes"]))
verifie("toutes les colonnes partagent le meme maillage",
        len({c["modele"]["estimation"]["cellules"] for c in ts["colonnes"]}) == 1)
verifie("la duree annoncee est celle du TOTAL, pas d'une colonne",
        abs(ts["estimation"]["duree_s"]
            - 2 * openems_modele.duree_estimee(ts["colonnes"][0]["modele"]))
        < 1e-6,
        "%.1f s" % ts["estimation"]["duree_s"])
verifie("le document de depart n'est pas modifie",
        sum(1 for q in deux["ports"] if q.get("excite")) == 1
        and deux["ports"][0]["excite"] is True)

try:
    openems_modele.tableau_s(document())
    verifie("un seul port ne fait pas un tableau", False)
except openems_modele.ErreurModele as exc:
    verifie("un seul port ne fait pas un tableau",
            "au moins deux ports" in exc.message, exc.message)

# L'assemblage : deux colonnes -> un tableau. Les resultats sont fabriques
# ici — ce qui est eprouve est le RANGEMENT, pas le solveur.
try:
    import openems_run as _r_ts
except Exception:                                      # noqa: BLE001
    _r_ts = None
if _r_ts is not None:
    _t = _r_ts.TacheTableauS("essai-ts", ".", ts)
    _f = [2.0e9, 2.45e9, 3.0e9]
    _t.points[0].update(etat="fini", resultat={
        "f": _f, "s11_re": [-0.5, -0.1, 0.2], "s11_im": [0.0, 0.05, -0.1],
        "couplages": {"2": {"re": [0.01, 0.03, 0.02], "im": [0.0, 0.01, 0.0]}}})
    _t.points[1].update(etat="fini", resultat={
        "f": _f, "s11_re": [-0.4, -0.2, 0.3], "s11_im": [0.1, 0.0, 0.0],
        "couplages": {"1": {"re": [0.01, 0.031, 0.02], "im": [0.0, 0.01, 0.0]}}})
    _ass = _t._assembler(_t.points)
    verifie("la diagonale vient du S11 de chaque colonne",
            _ass["s"][0][0]["re"][0] == -0.5 and _ass["s"][1][1]["re"][0] == -0.4)
    verifie("le hors-diagonale vient des couplages, et pas de la meme colonne",
            _ass["s"][1][0]["re"][1] == 0.03 and _ass["s"][0][1]["re"][1] == 0.031,
            "%s / %s" % (_ass["s"][1][0]["re"][1], _ass["s"][0][1]["re"][1]))
    # S(i,j) : i recoit, j excite. Les confondre transpose le tableau, et sur
    # une structure reciproque RIEN ne le montrerait.
    verifie("S(i,j) est bien « i recoit pendant que j excite »",
            _ass["s"][1][0]["re"][1] == 0.03,
            "colonne du port 1, ligne du port 2")
    verifie("l'ecart de reciprocite est calcule, et il dit ou",
            abs(_ass["reciprocite"]["ecart"] - 0.001) < 1e-9
            and _ass["reciprocite"]["ou"] == "S12 / S21",
            str(_ass["reciprocite"]))
    verifie("le premier resultat reste lisible comme une simulation seule",
            _ass["premier"]["s11_re"][0] == -0.5)
    # Une colonne qui n'a pas abouti laisse ses cases VIDES. Les remplir de
    # zeros donnerait une isolation parfaite, c'est-a-dire le contraire d'un
    # aveu d'ignorance.
    _t.points[1].update(etat="echoue", resultat=None, detail="port hors cuivre")
    _ass2 = _t._assembler([_t.points[0]])
    verifie("une colonne ratee laisse ses cases vides, jamais a zero",
            _ass2["s"][1][1] is None and _ass2["s"][0][1] is None
            and _ass2["s"][0][0] is not None)
    verifie("et le tableau dit laquelle, et pourquoi",
            _ass2["colonnes"][1]["etat"] == "echoue"
            and "hors cuivre" in _ass2["colonnes"][1]["detail"])
    verifie("le tableau et le balayage ne se lisent pas sous la meme clef",
            _r_ts.TacheTableauS.CLEF == "tableau_s"
            and _r_ts.TacheBalayage.CLEF == "balayage")

# --------------------------------------------------------------------------
print()
print("13. Le port coaxial")
# `AddCoaxialPort` n'existe pas dans les liaisons Python : le connecteur est
# construit a la main, et la sonde de courant est une BOUCLE autour de l'ame
# — un port localise, dont la sonde est un segment radial, ne peut pas
# mesurer le courant axial d'un coaxial.
coax = document(port={"type": "coaxial", "x": PLAN / 2.0,
                      "y": Y0 + L_PATCH / 3.0, "R": 50.0,
                      "de": "TOP", "a": "BOTTOM"})
mc = openems_modele.normaliser(coax)
c = mc["port"]["coax"]
verifie("l'impedance de ligne est celle de la geometrie, pas 50 par decret",
        abs(c["z0_ligne"] - 60.0 / math.sqrt(2.05) * math.log(2.05 / 0.635)) < 0.5,
        "%.2f ohms" % c["z0_ligne"])
verifie("une SMA ordinaire tombe bien a une cinquantaine d'ohms",
        45 < c["z0_ligne"] < 55, "%.2f" % c["z0_ligne"])
verifie("le troncon sort du cote de la masse", c["sens"] < 0)
verifie("et il descend sous la carte",
        c["z_bas"] < 0 and abs(c["z_bas"] + 3.0) < 1e-9, "%.3f" % c["z_bas"])
verifie("l'ame monte jusqu'a la couche qu'elle alimente",
        abs(c["z_ame"] - cu["TOP"]["z1"]) < 1e-9)
verifie("le plan de mesure est a mi-troncon",
        abs(c["z_mes"] - (c["z_bas"] + c["z_gaine"]) / 2.0) < 1e-9)
verifie("le plan de masse est degage, sinon le port serait court-circuite",
        [d["couche"] for d in c["degagements"]] == ["BOTTOM"],
        str(c["degagements"]))
verifie("la couche de l'ame n'est PAS degagee : c'est la qu'elle se raccorde",
        all(d["couche"] != "TOP" for d in c["degagements"]))
verifie("l'emprise descend jusqu'au bout du connecteur",
        abs(mc["emprise"][2] - c["z_bas"]) < 1e-9,
        "%.3f" % mc["emprise"][2])
verifie("la boite d'air se mesure depuis le connecteur, pas depuis la carte",
        mc["boite"]["z1"] < c["z_bas"])
verifie("chaque rayon porte une ligne de maillage",
        all(any(abs(v - (mc["port"]["x"] + s * r)) < 1e-9
                for v in mc["maillage"]["x"])
            for r in (c["ra"], c["rm"], c["rb"]) for s in (-1, 1)))
verifie("le fond et le plan de mesure aussi",
        all(any(abs(v - z) < 1e-9 for v in mc["maillage"]["z"])
            for z in (c["z_bas"], c["z_mes"])))

tc = openems_script.generer(mc)
verifie("le script pose la classe qui manque aux liaisons Python",
        "class PortCoaxial(Port):" in tc and "from openEMS.ports import Port" in tc)
verifie("il emet l'ame, la gaine et le dielectrique",
        "AddCylindricalShell" in tc and "coax_d1 = CSX.AddMaterial" in tc)
# Une feuille conductrice est une SURFACE : ce qui la perce doit en etre une
# aussi. Un cylindre de hauteur nulle n'a aucun volume — CSXCAD le pose sans
# broncher et il ne recouvre rien. La premiere version du coaxial faisait
# exactement cette faute, et la simulation l'a dit : Z = 0 + 5j ohms au plan
# de reference, soit une ligne court-circuitee a son bout.
_deg = tc[:tc.index("degagement dans BOTTOM")]
verifie("le degagement est un POLYGONE et non un cylindre plat",
        "AddPolygon" in _deg[_deg.rindex("sub_0."):] and
        "AddCylinder" not in _deg[_deg.rindex("sub_0."):])
# ET IL PASSE AU-DESSUS DU CUIVRE, sans quoi il ne perce rien. Le degagement
# etait emis a la priorite 11, celle des DECOUPES d'un versement -- mais un
# plan de masse SANS decoupe n'est pas emis comme un versement : il part avec
# les pistes, a la priorite 12. Douze bat onze, le degagement ne percait rien,
# l'ame du coaxial touchait le plan, et le port etait un court-circuit franc.
# La simulation le disait sans ambiguite -- Z = 0,0 + 1,5j ohms au plan de
# reference et |S11| = 0 dB sur toute la bande --, mais seulement a qui la
# lancait : c'est exactement le genre de faute qu'un banc doit attraper avant.
_prio_deg = int(_deg[_deg.rindex("priority=") + 9:].split(")")[0])
verifie("et il passe au-dessus du cuivre, sinon il ne perce rien",
        _prio_deg > 12, "priorite %d, cuivre a 12" % _prio_deg)
verifie("la sonde de courant encercle l'ame",
        "norm_dir=2" in tc and "p_type=1" in tc)
verifie("le plan de reference est ramene a la surface de la carte",
        "ref_plane_shift=" in tc)
verifie("l'impedance de reference est celle de la ligne, pas 50 par defaut",
        "ref_impedance=%s" % openems_script._f(c["z0_ligne"], 4) in tc)
verifie("le script coaxial compile", compile(tc, "<coax>", "exec") or True)

refuse("une gaine plus etroite que l'ame est refusee",
       document(port={"type": "coaxial", "x": PLAN / 2.0, "y": Y0 + 5,
                      "de": "TOP", "a": "BOTTOM", "ra": 2.0, "rb": 1.0}),
       "pas plus large")
refuse("un troncon de longueur nulle est refuse",
       document(port={"type": "coaxial", "x": PLAN / 2.0, "y": Y0 + 5,
                      "de": "TOP", "a": "BOTTOM", "longueur": 0}),
       "longueur nulle")
refuse("un coaxial entre une couche et elle-meme est refuse comme les autres",
       document(port={"type": "coaxial", "x": PLAN / 2.0, "y": Y0 + 5,
                      "de": "TOP", "a": "TOP"}),
       "a elle-meme")

# --------------------------------------------------------------------------
print()
print("14. Le balayage parametrique")
# TOUS LES POINTS SONT VERIFIES AVANT QUE LE PREMIER NE PARTE : decouvrir au
# quatorzieme, une heure plus tard, que le port y tombe hors du cuivre serait
# la pire facon de l'apprendre.
def balaye(valeurs, chemin="cuivre.0.polys.0.o"):
    d = document()
    d["balayage"] = {"nom": "Longueur du patch", "unite": "mm", "points": [
        {"etiquette": "%.1f" % v, "valeur": v,
         "modifs": [{"chemin": chemin, "valeur": rect(X0, Y0, W_PATCH, v)}]}
        for v in valeurs]}
    return d


b = openems_modele.balayage(balaye([L_PATCH - 1, L_PATCH, L_PATCH + 1]))
verifie("trois points, trois modeles", len(b["points"]) == 3)
# Le patch, et non l'emprise du cuivre : l'emprise est celle du plan de
# masse, qui ne bouge pas d'un point a l'autre.
patchs = [round(max(q[1] for q in p["modele"]["cuivre"][0]["polys"][0]["o"])
                - Y0, 3) for p in b["points"]]
verifie("chacun porte la geometrie qu'on lui a donnee",
        patchs == [round(L_PATCH - 1, 3), round(L_PATCH, 3),
                   round(L_PATCH + 1, 3)], str(patchs))
verifie("le document de depart n'est pas touche",
        len(openems_modele.normaliser(document())["cuivre"]) == 2)
verifie("la duree annoncee est la somme des points",
        b["estimation"]["duree_s"] > 3 * 0.9 *
        openems_modele.duree_estimee(b["points"][0]["modele"]))

def refuse_bal(nom, doc, morceau):
    """Le pendant de `refuse` pour un balayage : le refus doit arriver AVANT
    le lancement, et nommer le point en cause."""
    try:
        openems_modele.balayage(doc)
    except openems_modele.ErreurModele as exc:
        verifie(nom, morceau.lower() in (exc.message + exc.conseil).lower(),
                "message obtenu : " + exc.message)
        return
    verifie(nom, False, "aucune erreur levee")


refuse_bal("un seul point n'est pas un balayage", balaye([L_PATCH]),
           "au moins deux points")
refuse_bal("quarante et un points sont refuses",
           balaye([L_PATCH + i * 0.1 for i in range(41)]), "au plus")
refuse_bal("un chemin qui ne mene nulle part est refuse",
           balaye([L_PATCH, L_PATCH + 1], chemin="cuivre.9.polys.0.o"),
           "n'existe pas")
# Un substrat d'epaisseur nulle au deuxieme point : le port n'a plus de
# hauteur, et le modele ne tient pas debout. Le refus doit arriver avant que
# le PREMIER point ne parte, et nommer le point en cause.
mauvais = balaye([L_PATCH, L_PATCH + 1])
mauvais["balayage"]["points"][1]["modifs"].append(
    {"chemin": "empilage.1.ep", "valeur": 0})
refuse_bal("un point dont le modele ne tient pas debout est refuse AVANT",
           mauvais, "point 2")

# -- le croisement : deux cotes, et un PRODUIT ----------------------------
# LE GARDE-FOU PORTE SUR LE PRODUIT, ET C'EST TOUT CE QUI CHANGE ICI. Un
# croisement arrive au serveur comme une liste PLATE de N*M points : le
# plafond de quarante s'y applique donc deja, sans une ligne de plus. Ce qui
# se verifie est justement cela — que sept valeurs croisees avec sept soient
# refusees, alors que sept sur un seul axe passent largement.
def croise(v1, v2):
    d = document()
    d["balayage"] = {
        "nom": "Longueur du patch", "unite": "mm",
        "croise": True, "nom2": "port X", "unite2": "mm",
        "points": [
            {"etiquette": "%.1f x %.2f" % (a, b), "valeur": a, "valeur2": b,
             "modifs": [{"chemin": "cuivre.0.polys.0.o",
                         "valeur": rect(X0, Y0, W_PATCH, a)},
                        {"chemin": "port.x", "valeur": b}]}
            for a in v1 for b in v2]}
    return d


_c = openems_modele.balayage(croise([L_PATCH - 0.5, L_PATCH, L_PATCH + 0.5],
                                    [PLAN / 2 - 1, PLAN / 2, PLAN / 2 + 1]))
verifie("trois valeurs croisees avec trois font NEUF points",
        len(_c["points"]) == 9, str(len(_c["points"])))
verifie("le croisement est retenu, avec le nom du second axe",
        _c["croise"] is True and _c["nom2"] == "port X")
verifie("chaque point garde sa valeur sur chacun des deux axes",
        _c["points"][0]["valeur2"] == PLAN / 2 - 1
        and _c["points"][4]["valeur2"] == PLAN / 2,
        str([_c["points"][0]["valeur2"], _c["points"][4]["valeur2"]]))
verifie("les DEUX modifications sont appliquees au meme document",
        abs(_c["points"][4]["modele"]["port"]["x"] - PLAN / 2) < 1e-9
        and abs(max(q[1] for q in
                    _c["points"][4]["modele"]["cuivre"][0]["polys"][0]["o"])
                - Y0 - L_PATCH) < 1e-9)
verifie("la duree annoncee est celle des neuf, pas des six",
        _c["estimation"]["duree_s"] > 8 * 0.9 *
        openems_modele.duree_estimee(_c["points"][0]["modele"]))
# Sept sur un axe passent ; sept croises avec sept ne passent pas. C'est la
# meme borne, et c'est ce qui la rend juste.
_sept = [L_PATCH + i * 0.2 for i in range(7)]
verifie("sept points sur un seul axe passent",
        len(openems_modele.balayage(balaye(_sept))["points"]) == 7)
refuse_bal("sept croises avec sept sont refuses : c'est le produit qu'on paie",
           croise(_sept, [PLAN / 2 + i * 0.5 for i in range(7)]), "au plus")
# Un balayage ordinaire n'a pas de second axe, et ne doit pas s'en inventer un.
verifie("un balayage a un seul axe n'est pas marque croise",
        b["croise"] is False and b["nom2"] == ""
        and b["points"][0]["valeur2"] is None)

# --------------------------------------------------------------------------
print()
print("15. Les projets : ou l'on range le travail, et comment on le reprend")
# CE QU'ON VERIFIE ICI N'EST PAS L'ALLER-RETOUR — il est en JavaScript, et le
# banc de la page s'en charge — MAIS LES REFUS. Un nom de projet arrive d'une
# requete HTTP et devient un nom de dossier : c'est le seul endroit de l'outil
# ou une chaine venue du reseau touche le systeme de fichiers, et c'est donc
# le seul qui merite d'etre eprouve caractere par caractere.
import shutil                                          # noqa: E402
import tempfile                                        # noqa: E402

import projet                                          # noqa: E402


class _SansRun(Exception):
    """Le module d'execution manque : la partie qui en depend est sautee."""

_bac = tempfile.mkdtemp(prefix="banc-projets-")
try:
    projet._RACINE = os.path.join(_bac, "travail")
    os.makedirs(projet._RACINE)

    out = projet.enregistrer({
        "nom": "Patch 2,45 GHz",
        "titre": "un essai",
        "source": "dessin",
        "fichier": "patch-2450.xml",
        "dessin": {"elements": [{"k": "rect"}], "carte": {"L": 40, "W": 47}},
        "antenne": {"bande": {"f1": 2.3e9, "f2": 2.6e9}},
        "carte": {"couches": [], "nets": ["GND"]},
    })
    verifie("un projet s'ecrit dans un sous-dossier a son nom",
            os.path.isdir(out["dossier"])
            and os.path.basename(out["dossier"]) == "Patch 2,45 GHz")
    verifie("les trois fichiers sont separes",
            os.path.isfile(os.path.join(out["dossier"], "projet.json"))
            and os.path.isfile(os.path.join(out["dossier"], "carte.json"))
            and not os.path.isfile(os.path.join(out["dossier"], "resultats.json")))

    relu = projet.ouvrir("Patch 2,45 GHz")
    verifie("ce qui est relu est ce qui a ete ecrit",
            relu["dessin"]["elements"] == [{"k": "rect"}]
            and relu["carte"]["nets"] == ["GND"]
            and relu["resultats"] is None)
    verifie("le nom du fichier d'origine survit a l'aller-retour",
            relu.get("fichier") == "patch-2450.xml",
            "il voyage jusque dans le document envoye au solveur")

    # UNE CARTE ABSENTE N'EST PAS UNE CARTE NULLE, et confondre les deux
    # effacerait des dizaines de mega-octets a chaque changement de frequence.
    projet.enregistrer({"nom": "Patch 2,45 GHz", "dessin": {"elements": []}})
    verifie("une carte ABSENTE de la charge n'est pas reecrite",
            os.path.isfile(os.path.join(out["dossier"], "carte.json")))
    projet.enregistrer({"nom": "Patch 2,45 GHz", "carte": None})
    verifie("une carte NULLE est effacee",
            not os.path.isfile(os.path.join(out["dossier"], "carte.json")))

    verifie("la liste rend le projet, du plus recent au plus ancien",
            [p["nom"] for p in projet.liste()] == ["Patch 2,45 GHz"])

    verifie("les calculs vont dans le projet ouvert",
            projet.dossier_calculs() == os.path.join(out["dossier"], "calculs"))
    projet.fermer()
    verifie("aucun projet ouvert : les calculs retombent dans le temporaire",
            projet.dossier_calculs() == "")

    # Les refus. Chacun est un chemin qui sortirait de la racine, ou un nom
    # que le systeme de fichiers ne peut pas porter.
    for mauvais, pourquoi in ((".." , "remonter d'un cran"),
                              ("../autre", "remonter et redescendre"),
                              ("a/b", "un separateur"),
                              ("a\\b", "un separateur Windows"),
                              ("C:\\Windows", "un chemin absolu"),
                              ("CON", "un peripherique Windows"),
                              ("nul.json", "un peripherique deguise"),
                              ("fin.", "un point final"),
                              ("x" * 81, "quatre-vingt-un caracteres"),
                              ("", "rien du tout")):
        try:
            projet._verifier_nom(mauvais)
            verifie("refuse un nom de projet : %s" % pourquoi, False,
                    "« %s » a ete accepte" % mauvais)
        except projet.ErreurProjet:
            verifie("refuse un nom de projet : %s" % pourquoi, True)

    try:
        projet.ouvrir("il-n-existe-pas")
        verifie("ouvrir un projet absent est refuse", False)
    except projet.ErreurProjet as _exc:
        verifie("ouvrir un projet absent est refuse, et le dit",
                "il-n-existe-pas" in _exc.message and _exc.conseil != "")

    # Un dossier qui n'est pas un projet ne doit ni apparaitre dans la liste,
    # ni s'ouvrir : on n'ecrit pas dans un dossier qu'on n'a pas fabrique.
    os.makedirs(os.path.join(projet._RACINE, "pas-un-projet"))
    verifie("un dossier sans projet.json n'est pas un projet",
            [p["nom"] for p in projet.liste()] == ["Patch 2,45 GHz"])
    try:
        projet.ouvrir("pas-un-projet")
        verifie("ouvrir un dossier quelconque est refuse", False)
    except projet.ErreurProjet:
        verifie("ouvrir un dossier quelconque est refuse", True)

    # ----------------------------------------------------------------------
    # RANGER UN CALCUL DEJA FAIT DANS LE PROJET.
    #
    # CE QUE CETTE PARTIE PROTEGE. Le cas courant n'est pas « ouvrir un projet
    # puis lancer » : c'est lancer, regarder la courbe deux heures plus tard,
    # et nommer son travail seulement s'il a donne quelque chose. Les champs
    # sont alors dans le dossier temporaire du systeme, et les y laisser
    # revient a les perdre au premier nettoyage de disque. Ce qui doit tenir,
    # c'est que le deplacement suive sa tache (sans quoi la visionneuse
    # cherche a l'ancienne adresse), qu'il refuse un calcul en cours, et
    # qu'il n'ecrase jamais rien.
    # Comme la section 14 : le module se charge sans openEMS installe — il ne
    # sonde le solveur qu'au lancement —, mais on ne suppose rien.
    try:
        import openems_run
    except Exception:                                  # noqa: BLE001
        openems_run = None
    _tmp = tempfile.mkdtemp(prefix="banc-calculs-")
    try:
        if openems_run is None:
            raise _SansRun()
        openems_run.definir_racine_calculs(os.path.join(_tmp, "ailleurs"))
        _id, _dos = openems_run._dossier_neuf()
        with open(os.path.join(_dos, "J_xy_000.vtr"), "w") as _f:
            _f.write("x" * 4096)

        projet.enregistrer({"nom": "Patch 2,45 GHz"})
        _cible = projet.dossier_calculs()
        _out = openems_run.archiver(_id, _cible)
        # `realpath` des deux cotes : sous Windows, TEMP porte souvent le nom
        # court 8.3 du profil, et openems_run resout le sien — comparer les
        # deux ecritures du meme dossier ferait echouer pour rien.
        verifie("le dossier de calcul est deplace dans le projet",
                _out["deplace"] and
                os.path.realpath(_out["dossier"]) ==
                os.path.realpath(os.path.join(_cible, _id)))
        verifie("... et il ne reste rien a l'ancienne adresse",
                not os.path.isdir(_dos))
        verifie("... avec les champs dedans",
                os.path.isfile(os.path.join(_out["dossier"], "J_xy_000.vtr")))
        verifie("... et son poids est annonce", _out["octets"] == 4096)

        # La tache n'existe qu'en memoire ici ; c'est la base des calculs qui
        # doit permettre de retrouver le dossier, comme apres un redemarrage.
        openems_run.definir_racine_calculs(_cible)
        verifie("le calcul se retrouve a sa nouvelle adresse",
                openems_run.dossier_de(_id) == _out["dossier"])

        _deja = openems_run.archiver(_id, _cible)
        verifie("archiver deux fois ne fait rien la seconde",
                _deja["deja"] and not _deja["deplace"])

        # Un calcul qui tourne ne se deplace pas : openEMS ecrit dedans.
        openems_run.definir_racine_calculs(os.path.join(_tmp, "ailleurs"))
        _id2, _dos2 = openems_run._dossier_neuf()
        _t = openems_run.Tache(_id2, _dos2, {})
        _t.etat = "calcule"
        openems_run._TACHES[_id2] = _t
        try:
            openems_run.archiver(_id2, _cible)
            verifie("un calcul en cours ne se deplace pas", False)
        except openems_modele.ErreurModele:
            verifie("un calcul en cours ne se deplace pas", True)
        verifie("... et ses fichiers n'ont pas bouge", os.path.isdir(_dos2))

        # Rien ne s'ecrase : un dossier deja range porte le meme identifiant.
        _t.etat = "fini"
        _jumeau = os.path.join(os.path.dirname(_dos2), _id)
        os.rename(_dos2, _jumeau)
        _t3 = openems_run.Tache(_id, _jumeau, {})
        _t3.etat = "fini"
        openems_run._TACHES[_id] = _t3
        try:
            openems_run.archiver(_id, _cible)
            verifie("un dossier deja range n'est jamais ecrase", False)
        except openems_modele.ErreurModele:
            verifie("un dossier deja range n'est jamais ecrase", True)
        verifie("... et les champs ranges sont toujours la",
                os.path.isfile(os.path.join(_out["dossier"], "J_xy_000.vtr")))

        # Un identifiant qui n'est pas un des notres n'ouvre aucun chemin.
        for _faux in ("..", "../../windows", "n-importe-quoi", ""):
            try:
                openems_run.archiver(_faux, _cible)
                verifie("un identifiant invente est refuse : %r" % _faux,
                        False)
            except openems_modele.ErreurModele:
                verifie("un identifiant invente est refuse : %r" % _faux, True)

        try:
            openems_run.archiver(_id, "")
            verifie("sans projet ouvert, archiver est refuse", False)
        except openems_modele.ErreurModele:
            verifie("sans projet ouvert, archiver est refuse", True)

        # ------------------------------------------------------------------
        # LISTER LES CALCULS, ET EN IMPORTER UN D'AILLEURS.
        #
        # CE QUE CETTE PARTIE PROTEGE. `resultats.json` ne retient qu'UN
        # calcul ; un projet en accumule un par simulation. La liste est le
        # seul moyen d'atteindre les autres, et l'import le seul moyen de
        # faire entrer le calcul d'un collegue. Ce qui doit tenir, c'est que
        # l'import COPIE — la source d'un tiers ne se deplace jamais —, qu'il
        # ne prenne que ce qui appartient a un dossier de calcul, et qu'un
        # dossier sans champ soit refuse plutot qu'accepte a vide.
        # Les calculs suivent le projet ouvert : c'est ce que le serveur
        # refait apres chaque ouverture et chaque enregistrement (_pr_suivre).
        openems_run.definir_racine_calculs(_cible)

        _liste = projet.calculs()
        verifie("la liste rend le calcul archive",
                [c["id"] for c in _liste] == [_id])
        verifie("... avec son compte de champs et son poids",
                _liste[0]["vtr"] == 1 and _liste[0]["octets"] == 4096)
        verifie("... et il n'est pas marque comme importe",
                _liste[0]["importe"] is None)

        _dehors = os.path.join(_tmp, "cle-usb", "run-du-collegue")
        os.makedirs(os.path.join(_dehors, "nf2ff"))
        for _n in ("Jt_xy_000.vtr", "Jt_xy_001.vtr"):
            with open(os.path.join(_dehors, _n), "w") as _f:
                _f.write("y" * 512)
        with open(os.path.join(_dehors, "simulation.py"), "w") as _f:
            _f.write("# script\n")
        with open(os.path.join(_dehors, "notes.docx"), "w") as _f:
            _f.write("z" * 64)
        with open(os.path.join(_dehors, "nf2ff", "nf2ff.h5"), "w") as _f:
            _f.write("h" * 32)

        _neuf = openems_run.identifiant_neuf()
        verifie("un identifiant neuf a la forme que le module reconnait",
                bool(openems_run._RE_IDENT.match(_neuf)))
        _imp = projet.importer_calcul(_dehors, _neuf)
        verifie("un dossier venu d'ailleurs entre dans le projet",
                _imp["id"] == _neuf and _imp["vtr"] == 2)
        verifie("... et le .docx n'est pas venu avec",
                _imp["ignores"] == 1 and
                not os.path.isfile(os.path.join(_imp["dossier"],
                                                "notes.docx")))
        verifie("... le sous-dossier, si",
                os.path.isfile(os.path.join(_imp["dossier"], "nf2ff",
                                            "nf2ff.h5")))
        verifie("... LA SOURCE N'A PAS BOUGE",
                os.path.isfile(os.path.join(_dehors, "Jt_xy_000.vtr")) and
                os.path.isfile(os.path.join(_dehors, "notes.docx")))
        verifie("... et il se retrouve comme n'importe quel calcul",
                openems_run.dossier_de(_neuf) == _imp["dossier"])

        _liste = projet.calculs()
        verifie("la liste rend les deux calculs", len(_liste) == 2)
        _fiche = [c for c in _liste if c["id"] == _neuf][0]["importe"]
        verifie("... et dit d'ou vient celui qui a ete importe",
                _fiche and _fiche.get("nom") == "run-du-collegue" and
                os.path.realpath(_fiche.get("source", "")) ==
                os.path.realpath(_dehors))

        for _quoi, _ou in (
                ("un dossier sans le moindre .vtr", _tmp),
                ("un dossier qui n'existe pas",
                 os.path.join(_tmp, "nulle-part")),
                ("un fichier au lieu d'un dossier",
                 os.path.join(_dehors, "notes.docx")),
                ("rien du tout", "   ")):
            try:
                projet.importer_calcul(_ou, openems_run.identifiant_neuf())
                verifie("importer est refuse : %s" % _quoi, False)
            except projet.ErreurProjet:
                verifie("importer est refuse : %s" % _quoi, True)
        try:
            projet.importer_calcul(_imp["dossier"],
                                   openems_run.identifiant_neuf())
            verifie("importer est refuse : un dossier deja dans le projet",
                    False)
        except projet.ErreurProjet:
            verifie("importer est refuse : un dossier deja dans le projet",
                    True)
        verifie("aucun de ces refus n'a laisse de dossier a moitie copie",
                len(projet.calculs()) == 2)
    except _SansRun:
        print("  --   archivage des calculs : openems_run indisponible")
    finally:
        if openems_run is not None:
            openems_run._TACHES.clear()
            openems_run.definir_racine_calculs("")
        shutil.rmtree(_tmp, ignore_errors=True)
finally:
    projet._RACINE = None
    projet.fermer()
    shutil.rmtree(_bac, ignore_errors=True)

# --------------------------------------------------------------------------
print()
print("16. Le debit du poste, et la duree annoncee")
# CE QUE CETTE SECTION PROTEGE. La duree annoncee decide si l'on lance ou non,
# et sur un balayage elle est multipliee par le nombre de points : c'est la
# seule prevision de l'outil sur laquelle on engage une nuit. Elle se calait
# jusqu'ici sur un debit suppose, le meme sur toutes les machines ; elle se
# cale maintenant sur ce qu'openEMS a MONTRE sur ce poste. Ce qui doit tenir,
# c'est qu'une valeur aberrante n'entre pas, et qu'une mesure fasse bouger la
# duree dans le bon sens.
openems_modele.oublier_debit()
verifie("sans calcul termine, le debit est celui qui est suppose",
        openems_modele.debit_suppose() == openems_modele.MCPS and
        openems_modele.debit_mesure() is None)

_lent = openems_modele.duree_estimee(openems_modele.normaliser(document()))
openems_modele.noter_debit(openems_modele.MCPS / 4.0)
verifie("un calcul termine fait du debit une mesure",
        openems_modele.debit_mesure() is not None and
        openems_modele.debit_n() == 1)
_m_deb = openems_modele.normaliser(document())
_vrai = openems_modele.duree_estimee(_m_deb)
verifie("un poste quatre fois plus lent annonce quatre fois plus longtemps",
        abs(_vrai / _lent - 4.0) < 0.01, "%.3f" % (_vrai / _lent))
verifie("l'estimation dit d'ou vient son debit",
        _m_deb["estimation"]["mcps_mesure"] is True and
        _m_deb["estimation"]["mcps_n"] == 1)

# Ce qui n'entre pas : une ligne mal lue ferait annoncer des heures pour une
# minute, et une annonce absurde use plus la confiance qu'une approchee.
_avant = openems_modele.debit_mesure()
for _faux in (0.0, -3.0, 1e9, None, "vite"):
    openems_modele.noter_debit(_faux)
verifie("une vitesse hors des bornes du plausible n'est pas retenue",
        openems_modele.debit_mesure() == _avant and
        openems_modele.debit_n() == 1)

# La mediane, et non le dernier : un calcul sur une machine occupee ne doit
# pas emporter l'annonce suivante.
openems_modele.oublier_debit()
for _v in (10.0, 11.0, 9.0, 60.0, 10.5):
    openems_modele.noter_debit(_v)
verifie("la mediane encaisse un calcul qui a mal tourne",
        abs(openems_modele.debit_suppose() - 10.5) < 1e-9,
        str(openems_modele.debit_suppose()))
for _v in (40.0, 41.0, 39.0):
    openems_modele.noter_debit(_v)
verifie("elle suit quand meme le poste s'il change",
        openems_modele.debit_suppose() > 35.0,
        str(openems_modele.debit_suppose()))
verifie("elle ne retient que les derniers calculs",
        openems_modele.debit_n() == openems_modele.MCPS_GARDE)

# Le trajet complet : le journal d'openEMS -> le debit retenu. Les lignes sont
# celles que le solveur ecrit vraiment, prises telles quelles.
openems_modele.oublier_debit()
try:
    import openems_run as _run                         # noqa: E402
except Exception as _exc:                              # noqa: BLE001
    _run = None
    print("   (module d'execution indisponible : %s)" % _exc)
if _run is not None:
    _t = _run.Tache("essai-debit", ".", {"arret": {"nmax": 10000}})
    for _l in (
            "[@     1m40s] Timestep:  1000 || Speed:   1.0 MC/s (1.0e-02 s/TS)",
            "[@     3m20s] Timestep:  2000 || Speed:   8.0 MC/s (1.2e-03 s/TS)",
            "[@     5m00s] Timestep:  3000 || Speed:   8.2 MC/s (1.2e-03 s/TS)",
            "[@     6m40s] Timestep:  4000 || Speed:   7.8 MC/s (1.3e-03 s/TS)"):
        _t._ajouter(_l)
    _t._noter_debit()
    verifie("le debit se lit dans le journal du solveur",
            openems_modele.debit_mesure() is not None and
            abs(openems_modele.debit_suppose() - 8.0) < 0.001,
            str(openems_modele.debit_suppose()))
    verifie("le premier rapport, qui compte le montage du maillage, est ecarte",
            openems_modele.debit_suppose() > 7.0)
    # Un calcul qui n'aboutit pas n'apprend rien du poste : il a passe son
    # temps ailleurs que dans la boucle FDTD.
    openems_modele.oublier_debit()
    _t2 = _run.Tache("essai-arret", ".", {"arret": {"nmax": 10000}})
    _t2._ajouter("[@ 10s] Timestep: 100 || Speed:  0.4 MC/s (2.5e-01 s/TS)")
    verifie("un calcul arrete ou echoue ne note aucun debit",
            openems_modele.debit_mesure() is None)

# Et ce qu'un profil en lecture seule ne doit pas casser : le rangement.
verifie("un debit nul ne s'ecrit pas dans les reglages",
        projet.debit_noter(0.0) == projet.debit_lu())

openems_modele.oublier_debit()

# --------------------------------------------------------------------------
print()
print("16 bis. Les fils de calcul, et le banc de vitesse")
# CE QUE CETTE SECTION PROTEGE. Sans `numThreads`, openEMS tatonne a partir
# d'UN fil et s'arrete souvent a deux ou trois : une carte de 10,8 millions de
# cellules a tourne des heures a 7 % du processeur. Le reglage doit partir
# au solveur, la duree annoncee doit le suivre -- sans quoi on ne verrait pas
# ce qu'il rapporte --, et le banc doit etre lu tel que son script l'ecrit.
verifie("le reglage des fils est borne",
        openems_modele.regler_fils(-3) == 0 and
        openems_modele.regler_fils(10 ** 6) == openems_modele.FILS_MAX and
        openems_modele.regler_fils("vite") == 0)

openems_modele.regler_fils(6)
_m_fils = openems_modele.normaliser(document())
_s_fils = openems_script.generer(_m_fils)
verifie("le nombre de fils regle part au solveur",
        _m_fils["fils"] == 6 and "fils      = 6\n" in _s_fils and
        "numThreads=fils" in _s_fils)
compile(_s_fils, "antenne.py", "exec")
openems_modele.regler_fils(0)
_s_auto = openems_script.generer(openems_modele.normaliser(document()))
verifie("a zero, le choix reste a openEMS, et le script le dit",
        "fils      = 0" in _s_auto and "numThreads=fils" in _s_auto)
_s_banc = openems_script.generer_banc([1, 2, 4])
compile(_s_banc, "banc.py", "exec")
verifie("le script du banc compile, et impose ses fils a chaque essai",
        "numThreads=n" in _s_banc and "FILS    = [1, 2, 4]" in _s_banc)

# LA DUREE SUIT LE REGLAGE, par le rapport que le banc a mesure. Un calcul
# fait sur deux fils a 27 MC/s, un banc qui dit 180 MC/s a deux fils et 250 a
# huit : sur huit fils, on annonce 27 x 250 / 180.
openems_modele.oublier_debit()
openems_modele.noter_banc({"1": 100, "2": 180, "4": 245, "8": 250,
                           "x": 3, "3": -1, "5": 1e9})
verifie("le banc ecarte ce qui n'est pas une mesure",
        sorted(openems_modele.banc()) == [1, 2, 4, 8])
openems_modele.noter_debit(27.0, 2)
openems_modele.regler_fils(8)
verifie("un debit mesure sur 2 fils est ramene a 8 par le banc",
        abs(openems_modele.debit_suppose() - 27.0 * 250 / 180) < 1e-6,
        "%.2f" % openems_modele.debit_suppose())
_m_fils = openems_modele.normaliser(document())
verifie("l'estimation dit qu'elle a ete ramenee, et a combien de fils",
        _m_fils["estimation"]["mcps_ramene"] is True and
        _m_fils["estimation"]["fils"] == 8)
openems_modele.regler_fils(3)
verifie("entre deux mesures du banc, on interpole",
        abs(openems_modele.debit_suppose() - 27.0 * 212.5 / 180) < 1e-6,
        "%.2f" % openems_modele.debit_suppose())
openems_modele.regler_fils(0)
verifie("en « Auto », rien n'est ramene : le tatonnement ne se predit pas",
        openems_modele.debit_suppose() == 27.0)
verifie("a 3 % pres, le plus petit nombre de fils gagne",
        openems_modele.banc_meilleur() == 4, str(openems_modele.banc_meilleur()))

if _run is not None:
    # Les lignes telles qu'openEMS 0.0.36 les ecrit pendant son tatonnement.
    _t = _run.Tache("essai-fils", ".", {"arret": {"nmax": 10000}})
    for _l in ("Multithreaded operator using 12 threads.",
               "Multithreaded engine using 1 threads. Utilization: (201)",
               "Multithreaded engine using 2 threads. Utilization: (101;100)",
               "Multithreaded engine using 3 threads. Utilization: (67;67;67)"):
        _t._ajouter(_l)
    verifie("les fils vraiment employes se lisent dans le journal",
            _t.avancement["fils"] == 3, str(_t.avancement["fils"]))
    _b = _run.TacheBanc("essai-banc", ".", [1, 2, 4, 8])
    for _l in ("Banc : 1 fil(s) -> 74.3 MCells/s",
               "Banc : 2 fil(s) -> echec",
               "Banc : 4 fil(s) -> 141.1 MCells/s"):
        _b._ajouter(_l)
    _vb = _b.vue()
    verifie("le banc se lit essai par essai, echecs compris",
            _vb["banc"]["mesures"] == {"1": 74.3, "4": 141.1} and
            abs(_vb["avancement"]["pourcent"] - 75.0) < 1e-9 and
            _vb["genre"] == "banc")
    verifie("les paliers du banc s'arretent au nombre de coeurs",
            _run.fils_a_essayer(12) == [1, 2, 3, 4, 6, 8, 12] and
            _run.fils_a_essayer(1) == [1])
    # Le banc ne note PAS de debit : une boite vide irait deux a quatre fois
    # plus vite qu'une antenne.
    openems_modele.oublier_debit()
    _b.resultat = {"banc": {"1": 74.3, "4": 141.1}}
    _b._noter_debit()
    verifie("le banc range sa table, et ne touche pas au debit des antennes",
            openems_modele.debit_mesure() is None and
            sorted(openems_modele.banc()) == [1, 4])

openems_modele.regler_fils(0)
openems_modele.noter_banc({})
openems_modele.oublier_debit()

# --------------------------------------------------------------------------
print()
print("17. La facture du maillage : la plus petite cellule, et ce qu'elle coute")
# CE QUE CETTE SECTION PROTEGE, ET POURQUOI ELLE EXISTE. Une carte relais
# 868 MHz a demande cinq heures de calcul pour un S11 a -10,9 dB, et rien dans
# l'outil ne l'avait annonce : la duree n'etait calculee que pour un balayage,
# le budget comptait vingt periodes quand le solveur en recevait quarante, et
# l'avis de cellule minuscule avait un seuil au vingtieme du pas vise que la
# cellule fautive -- huit fois trop fine -- passait sans un mot. Les trois
# defauts sont ici, et chacun a sa verification.
openems_modele.oublier_debit()
_ms = openems_modele.normaliser(document())
_es = _ms["estimation"]
_mds = _ms["maillage_detail"]

verifie("le maillage publie le plancher de chaque axe",
        all(_mds["plancher"].get(a, 0) > 0 for a in "xyz"),
        str(_mds.get("plancher")))
verifie("et la paire de lignes qui serre chaque axe",
        all(_mds["pincee"].get(a) for a in "xyz"))
_pi = _es["cellule"]["pincee"]
verifie("la pincee de l'axe le plus serre EST la plus petite cellule",
        abs(_pi["mm"] - _es["cellule"]["mm"]) < 1e-9,
        "%.6f vs %.6f" % (_pi["mm"], _es["cellule"]["mm"]))
verifie("elle nomme le rang de ses deux bords",
        _pi["rang_a"] in ("obligatoire", "affinage", "remplissage") and
        _pi["rang_b"] in ("obligatoire", "affinage", "remplissage"),
        "%s / %s" % (_pi["rang_a"], _pi["rang_b"]))
verifie("et la distance qu'elle annonce est celle de ses deux bords",
        abs((_pi["b"] - _pi["a"]) - _pi["mm"]) < 1e-9)

# LE FAUX POSITIF QUI A FAIT CHANGER LE CRITERE. Le patch du banc a une plus
# petite cellule QUATRE FOIS ET DEMIE plus fine que le pas vise -- ce n'est pas
# un accident, c'est le substrat de 1,6 mm divise en trois par le maillage
# lui-meme. Un seuil calcule sur le pas vise le signalait ; le plancher de
# l'axe, non. Voir CELLULE_AVIS_MARGE.
verifie("le substrat divise en trois n'est pas une cellule minuscule",
        not [a for a in _ms["avis"]
             if a["titre"] == "Une cellule minuscule ralentit tout"],
        "plus petite %.4f mm en %s pour un pas vise de %.4f"
        % (_es["cellule"]["mm"], _es["cellule"]["axe"], _ms["resolution"]["die"]))
verifie("alors qu'elle est bien plus fine que le pas vise",
        _es["cellule"]["mm"] < _ms["resolution"]["die"] / 4.0)

# LA DUREE COMPTE LE GARDE-FOU ENTIER, ET NON LA MOITIE. Elle recalculait son
# propre nombre de pas -- vingt periodes autour de f0 -- quand `nmax` en
# autorise NMAX_PERIODES autour de la frequence cible.
_att = _es["cellules"] * _ms["arret"]["nmax"] / (_es["mcps_suppose"] * 1e6)
verifie("la duree annoncee compte les pas que le solveur recevra",
        abs(openems_modele.duree_estimee(_ms) - _att) < 1e-6,
        "%.1f vs %.1f" % (openems_modele.duree_estimee(_ms), _att))

# LE BUDGET D'AFFINAGE PARLE DU MEME CALCUL QUE LE SOLVEUR. Sur une carte dont
# le nombre de pas vient de la decroissance -- le cas ordinaire --, le cout
# chiffre vaut exactement cellules x nmax. Il valait la moitie.
_mc = openems_modele.normaliser(document(arret={"energie": -30, "nmax": 0}))
_cd = _mc["arret"]["nmax_detail"]
if _cd["decroissance"] >= _cd["impulsion"]:
    _cout = openems_modele._cout(_mc["estimation"], _mc["bande"])
    verifie("le budget chiffre le meme calcul que celui qui partira",
            abs(_cout / (_mc["estimation"]["cellules"]
                         * _mc["arret"]["nmax"]) - 1.0) < 0.01,
            "%.3e vs %.3e" % (_cout, _mc["estimation"]["cellules"]
                              * _mc["arret"]["nmax"]))
else:
    verifie("le budget chiffre le meme calcul que celui qui partira", True)

# ET ELLE SE DIT, CE QU'ELLE NE FAISAIT PAS. `duree_estimee` n'etait lue que
# par le balayage : une simulation seule partait sans qu'aucun chiffre passe
# devant l'operateur.
_lourd = openems_modele.normaliser(document(maillage={"res_die": 0.25}))
_avd = [a for a in _lourd["avis"] if a["titre"].startswith("Ce calcul")]
verifie("un calcul de plusieurs heures le dit avant de partir",
        len(_avd) == 1 and _avd[0]["rang"] in ("info", "attention"),
        "%s ; duree %.0f s" % ([a["titre"] for a in _lourd["avis"]],
                               openems_modele.duree_estimee(_lourd)))
verifie("et il annonce la duree en clair",
        _avd and "h" in _avd[0]["texte"].split(":")[0])
verifie("au-dela de deux heures, l'avis passe en attention",
        [a for a in openems_modele.normaliser(
            document(maillage={"res_die": 0.20}))["avis"]
         if a["titre"].startswith("Ce calcul")][0]["rang"] == "attention")
verifie("un calcul court ne dit rien",
        not [a for a in _ms["avis"] if a["titre"].startswith("Ce calcul")],
        "%.0f s" % openems_modele.duree_estimee(_ms))
verifie("la duree se lit en heures et minutes",
        openems_modele._duree_texte(3 * 3600 + 26 * 60) == "3 h 26" and
        openems_modele._duree_texte(70) == "70 s" and
        openems_modele._duree_texte(600) == "10 min",
        openems_modele._duree_texte(3 * 3600 + 26 * 60))

# --------------------------------------------------------------------------
print()
print("18. Le calcul qui ne rend rien, et ce qu'il en dit")
# CE QUE CETTE SECTION PROTEGE. Une simulation dont toutes les grandeurs
# ressortent None est survivable depuis longtemps : elle ne tue plus la suite
# d'un balayage. Elle ne disait pas CE QUI avait rate, et la seule facon de
# l'apprendre etait de relire quatre mille lignes d'avancement. Le diagnostic
# se lit sur la courbe d'energie que la tache suit deja pas a pas -- il n'y a
# rien de mesure en plus, seulement un nom pose sur ce qu'on voit.
#
# LES TROIS CAS NE SE CORRIGENT PAS DE LA MEME FACON, et c'est tout l'interet
# de les distinguer : une divergence se corrige au maillage, une descente
# tronquee se corrige au garde-fou, et une descente propre renvoie ailleurs.
# Un diagnostic qui melangerait les trois enverrait deux fois sur trois vers
# le mauvais reglage -- pire que pas de diagnostic du tout.
if _run is not None:
    _ARRET = {"arret": {"nmax": 20000, "energie_dB": -40.0}}

    def _journal(tache, lignes):
        for _l in lignes:
            tache._ajouter(_l)
        return tache

    def _ligne(pas, brute, db):
        # LA LIGNE EST CELLE QU'OPENEMS ECRIT VRAIMENT, y compris son signe
        # detache : « (- 7.32dB) ». C'est cette espace entre le moins et le
        # nombre qui avait deja fait manquer la lecture de l'energie ; un banc
        # qui ecrirait « (-7.32dB) » ne l'eprouverait pas.
        return ("[@ %ds] Timestep: %d || Speed: 20.0 MC/s (1.0e-02 s/TS) "
                "|| Energy: ~%.3e (- %.2fdB)" % (pas // 10, pas, brute,
                                                 abs(db)))

    # 1. LA DIVERGENCE. En decibels elle est invisible : openEMS les compte
    #    sur le maximum atteint jusque-la, et un calcul qui explose affiche
    #    0,00 dB du debut a la fin. C'est le nombre devant qui le dit.
    _div = _run.Tache("essai-diverge", ".", _ARRET)
    _journal(_div, [_ligne(200 * i, 1e-18 * (3.0 ** i), 0.0)
                    for i in range(1, 25)])
    _d = _div.diagnostic_energie()
    verifie("une energie qui monte jusqu'au bout est nommee divergence",
            _d is not None and "diverge" in _d, str(_d)[:70])
    verifie("le diagnostic d'une divergence renvoie au maillage",
            "maillage" in (_d or ""))
    verifie("les decibels seuls ne l'auraient pas vue",
            all(abs(e) < 1e-9 for _, _, e in _div._hist))

    # 1bis. UNE MONTEE MODESTE N'EST PAS UNE DIVERGENCE. Tant que l'impulsion
    #    entre, l'energie monte aussi : un calcul coupe la se corrige au
    #    compteur de pas, pas au maillage. Les confondre enverrait refaire un
    #    maillage qui n'a rien.
    _coupe = _run.Tache("essai-coupe", ".", _ARRET)
    _journal(_coupe, [_ligne(200 * i, 1e-18 * (1.3 ** i), 0.0)
                      for i in range(1, 25)])
    _d = _coupe.diagnostic_energie()
    verifie("une montee modeste est un calcul coupe, pas une divergence",
            _d is not None and "n'est pas une divergence" in _d, str(_d)[:70])
    verifie("et elle renvoie au compteur de pas, pas au maillage",
            "nmax" in (_d or "") and "maillage" not in (_d or ""))

    # 2. LA DESCENTE TRONQUEE. L'energie descend pour de bon, mais le compteur
    #    de pas coupe avant le seuil : la transformee porte alors sur une
    #    descente amputee, et ce qu'elle rend n'est pas une mesure.
    _tronc = _run.Tache("essai-tronque", ".", _ARRET)
    _journal(_tronc, [_ligne(200 * i, 1e-15 * (0.85 ** i), -0.55 * i)
                      for i in range(1, 25)])
    _d = _tronc.diagnostic_energie()
    verifie("une descente arretee trop tot designe le garde-fou",
            _d is not None and "garde-fou" in _d, str(_d)[:70])
    verifie("elle dit de combien on est loin du seuil",
            "-40" in (_d or "") and "13" in (_d or ""), str(_d)[:90])

    # 3. LA DESCENTE PROPRE. Le calcul s'est bien deroule : ce qui manque
    #    n'est pas sa convergence, et l'envoyer relever `nmax` serait le
    #    renvoyer sur un reglage qui n'y est pour rien.
    _propre = _run.Tache("essai-propre", ".", _ARRET)
    _journal(_propre, [_ligne(200 * i, 1e-15 * (0.8 ** i), -2.0 * i)
                       for i in range(1, 25)])
    _d = _propre.diagnostic_energie()
    verifie("une descente qui atteint le seuil renvoie ailleurs qu'a l'energie",
            _d is not None and "bien descendue" in _d, str(_d)[:70])
    verifie("elle ne conseille pas de relever le garde-fou",
            "garde-fou" not in (_d or ""))

    # 4. PAS UNE SEULE LIGNE D'AVANCEMENT. Le solveur s'est arrete avant la
    #    boucle : il n'y a pas de courbe a lire, et le dire vaut mieux que de
    #    se taire.
    _muet = _run.Tache("essai-muet", ".", _ARRET)
    _d = _muet.diagnostic_energie()
    verifie("sans aucun pas de temps, le diagnostic renvoie au debut du journal",
            _d is not None and "aucun pas de temps" in _d, str(_d)[:70])

    # 5. LA COURBE REPART A ZERO A CHAQUE POINT D'UN BALAYAGE. Sans cela, le
    #    maximum d'energie reste celui du point 1 : le temps restant des
    #    points suivants est extrapole a cheval sur deux calculs, et le
    #    diagnostic accuserait le point precedent.
    _suite = _run.Tache("essai-suite", ".", _ARRET)
    _journal(_suite, [_ligne(200 * i, 1e-15 * (0.8 ** i), -2.0 * i)
                      for i in range(1, 25)])
    verifie("la courbe d'energie d'un point est bien remplie",
            len(_suite._hist) > 10 and len(_suite._brute) > 10)
    _suite._repartir_energie()
    verifie("elle repart a zero au point suivant",
            not _suite._hist and not _suite._brute)
    _journal(_suite, [_ligne(200 * i, 1e-18 * (3.0 ** i), 0.0)
                      for i in range(1, 25)])
    verifie("le point suivant est donc diagnostique sur SA courbe",
            "diverge" in (_suite.diagnostic_energie() or ""))

    # 6. LE TABLEAU S GARDE LE RESULTAT COMPLET DE CHAQUE COLONNE. Deux
    #    antennes couplees ne rayonnent pas de la meme facon selon celle qui
    #    emet : n'en remonter qu'un revenait a jeter les autres diagrammes,
    #    pourtant deja calcules.
    _mts = openems_modele.normaliser(document())
    _ts = {"ports": [{"n": 1}, {"n": 2}],
           "colonnes": [{"n": 1, "modele": _mts}, {"n": 2, "modele": _mts}]}
    _tts = _run.TacheTableauS("essai-tableau", ".", _ts)
    for _i, _p in enumerate(_tts.points):
        _p["etat"] = "fini"
        _p["resultat"] = {
            "f": [1.0, 2.0], "s11_re": [0.1 * (_i + 1), 0.0],
            "s11_im": [0.0, 0.0], "f0": 2.4e9 + _i,
            "couplages": {str(2 - _i): {"re": [0.01, 0.0], "im": [0.0, 0.0]}},
            "nf2ff": {"dmax_dbi": 3.0 + _i, "e_norm": [[1.0]]},
        }
    _ass = _tts._assembler(_tts.points)
    verifie("chaque colonne du tableau S porte son resultat complet",
            all(c.get("resultat") for c in _ass["colonnes"]),
            str([bool(c.get("resultat")) for c in _ass["colonnes"]]))
    verifie("et son propre diagramme de rayonnement, qui n'est pas celui du premier",
            _ass["colonnes"][0]["resultat"]["nf2ff"]["dmax_dbi"] !=
            _ass["colonnes"][1]["resultat"]["nf2ff"]["dmax_dbi"])
    verifie("le resultat « ordinaire » reste celui de la premiere colonne",
            _ass["premier"] is _tts.points[0]["resultat"])
    # Une colonne qui n'a pas abouti n'a pas de resultat, et n'en invente pas.
    _tts2 = _run.TacheTableauS("essai-tableau-2", ".", _ts)
    _tts2.points[0]["etat"] = "fini"
    _tts2.points[0]["resultat"] = _tts.points[0]["resultat"]
    _tts2.points[1]["etat"] = "echoue"
    _ass2 = _tts2._assembler([_tts2.points[0]])
    verifie("une colonne qui n'a pas abouti porte un resultat vide",
            _ass2["colonnes"][1].get("resultat") is None)


# --------------------------------------------------------------------------
print()
print("19. La ligne d'alimentation ramenee au pied de l'antenne")
# CE QUE CETTE SECTION PROTEGE, ET LA FAUTE QU'ELLE A DEJA ATTRAPEE.
# L'impedance sort du port, c'est-a-dire du bord de la carte : entre elle et
# l'antenne il y a un bout de ruban, et un ruban FAIT TOURNER l'impedance. La
# ramener demande deux nombres -- le Z0 de la ligne et son er effectif -- et
# c'est la que la faute se cache : une manip anterieure avait ramene
# l'impedance du patch du gabarit avec l'er effectif du PATCH (3,992, calcule
# sur ses 37,6 mm de large) au lieu de celui de la LIGNE (3,266, sur ses
# 3,11 mm). Les deux nombres se ressemblent, la formule accepte les deux, et
# le resultat a l'air d'un resultat.
#
# CE QUI N'EST PAS EN CAUSE, ET QU'ON N'IRA PAS RECHERCHER : l'adaptation. Une
# ligne sans perte dont le Z0 est celui de reference ne change pas |Gamma|,
# elle le fait TOURNER. Le desembedage ne corrige donc aucune desadaptation --
# mesure a l'appui, la ligne du gabarit DOUBLEE fait passer le S11 de -0,64 a
# -1,20 dB, soit ce que 6,4 mm de FR-4 dissipent.
_ER, _H, _WF, _WPATCH = 4.3, 1.6, 3.112, 37.5839
verifie("l'er effectif du microruban est celui de la LIGNE, pas du patch",
        abs(openems_modele.microruban_eeff(_ER, _H, _WF) - 3.2662) < 1e-4 and
        abs(openems_modele.microruban_eeff(_ER, _H, _WPATCH) - 3.9924) < 1e-4,
        "%.4f contre %.4f" % (openems_modele.microruban_eeff(_ER, _H, _WF),
                              openems_modele.microruban_eeff(_ER, _H, _WPATCH)))
# La largeur synthetisee a 50 ohms doit se relire a 50 ohms : c'est la meme
# verification que celle du banc JavaScript, sur l'autre implementation. Les
# deux jeux de formules doivent rendre les MEMES nombres, sans quoi la page
# proposerait une ligne et le serveur en calculerait une autre.
verifie("la largeur du gabarit se relit bien a 50 ohms",
        abs(openems_modele.microruban_z0(_ER, _H, _WF) - 50.24) < 0.01,
        "%.3f ohms" % openems_modele.microruban_z0(_ER, _H, _WF))
verifie("un ruban plus large est de plus basse impedance",
        openems_modele.microruban_z0(_ER, _H, 6.0)
        < openems_modele.microruban_z0(_ER, _H, 3.0))

# -- ce que le document declare, et ce que le modele en fait ---------------
_d_lg = document()
_d_lg["port"] = dict(_d_lg["port"], ligne={"longueur": 6.4, "largeur": _WF})
_m_lg = openems_modele.normaliser(_d_lg)
_lg = _m_lg["port"].get("ligne")
verifie("une ligne declaree arrive au modele avec son Z0 et son er effectif",
        _lg and abs(_lg["z0"] - 50.24) < 0.01 and abs(_lg["eeff"] - 3.2662) < 1e-4,
        repr(_lg))
verifie("le substrat retenu est celui qui separe les deux couches du port",
        _lg and abs(_lg["h"] - H) < 1e-9 and abs(_lg["er"] - ER) < 1e-9)
verifie("aucune ligne declaree, rien n'est ramene",
        openems_modele.normaliser(document())["port"].get("ligne") is None)
# Une longueur sans largeur est un refus, et non un nombre invente : c'est la
# largeur qui donne l'impedance caracteristique.
refuse("une longueur de ligne sans sa largeur",
       dict(_d_lg, port=dict(_d_lg["port"], ligne={"longueur": 6.4})),
       "largeur")

# -- LE CALCUL LUI-MEME, EPROUVE SUR LE CODE QUI TOURNE VRAIMENT ----------
# Le bloc de desembedage n'est pas une fonction de ce depot : c'est du texte
# ECRIT DANS LE SCRIPT. Le banc l'extrait donc du script genere et l'execute,
# plutot que d'en tenir une seconde copie -- deux implementations d'accord
# entre elles ne prouveraient rien, et c'est bien celle qui tourne qu'on veut.
_txt_lg = openems_script.generer(_m_lg, chemin_openems="")
verifie("le script porte le bloc de desembedage",
        "_au_pied" in _txt_lg and "SANS PERTE" in _txt_lg)
verifie("et il dit ses deux reserves la ou on lit le nombre",
        "ANALYTIQUE" in _txt_lg and "abaque" in _txt_lg)
try:
    import numpy as _np_lg
except Exception:                                      # noqa: BLE001
    _np_lg = None
    print("   (numpy indisponible : le calcul n'est pas eprouve)")
if _np_lg is not None:
    _i = _txt_lg.index("_C0 = 299792458.0")
    _j = _txt_lg.index("# port 1 :", _i)
    _env = {"np": _np_lg, "f": _np_lg.array([2.45e9])}
    exec(compile(_txt_lg[_i:_j], "<bloc ligne>", "exec"), _env)  # noqa: S102
    _au_pied = _env["_au_pied"]

    # 1. L'ALLER-RETOUR. On pose une charge, on la fait tourner sur d, puis on
    #    desembede : on doit retomber sur la charge. C'est l'invariant qui ne
    #    depend d'aucun chiffre releve un jour sur une machine.
    def _vers_le_port(Z, z0, eeff, d_mm):
        _b = 2 * _np_lg.pi * _env["f"] * _np_lg.sqrt(eeff) / 299792458.0
        _t = _np_lg.tan(_b * d_mm / 1000.0)
        return z0 * (Z + 1j * z0 * _t) / (z0 + 1j * Z * _t)

    _charge = _np_lg.array([73.0 - 140.0j])
    _au_port = _vers_le_port(_charge, _lg["z0"], _lg["eeff"], _lg["d"])
    _retour = _au_pied(_au_port, _lg["z0"], _lg["eeff"], _lg["d"])
    verifie("l'aller-retour sur la ligne retombe sur la charge",
            abs(_retour[0] - _charge[0]) < 1e-9,
            "%.6f %+.6fj" % (_retour[0].real, _retour[0].imag))
    # Une ligne de longueur nulle ne fait rien -- le cas « non declaree ».
    verifie("une ligne de longueur nulle ne deplace rien",
            abs(_au_pied(_charge, _lg["z0"], _lg["eeff"], 0.0)[0]
                - _charge[0]) < 1e-12)
    # Une demi-longueur d'onde guidee ramene l'impedance sur elle-meme : c'est
    # la propriete de la ligne qu'on connait sans calculer.
    _lam_g = 299792458.0 / 2.45e9 / _np_lg.sqrt(_lg["eeff"]) * 1000.0
    verifie("une demi-onde guidee ramene l'impedance sur elle-meme",
            abs(_au_pied(_charge, _lg["z0"], _lg["eeff"], _lam_g / 2)[0]
                - _charge[0]) < 1e-6,
            "lambda_g = %.3f mm" % _lam_g)

    # 2. LA MESURE DU 15/09, RAMENEE AVEC LE BON er EFFECTIF. Le chiffre est
    #    pris en repere : s'il bouge, c'est que la formule a bouge.
    _z_port = _np_lg.array([9.034813666401092 - 98.86350592412548j])
    _z_pied = _au_pied(_z_port, _lg["z0"], _lg["eeff"], 6.4)[0]
    verifie("le patch du gabarit ramene au pied donne 107 +364j",
            abs(_z_pied.real - 107.07) < 0.05 and
            abs(_z_pied.imag - 364.31) < 0.05,
            "%.2f %+.2fj" % (_z_pied.real, _z_pied.imag))
    # Et la faute d'hier, refaite expres : l'er effectif du PATCH donne un
    # tout autre nombre. Les deux se lisent pareil, et l'un des deux est faux.
    _faux = _au_pied(_z_port, _lg["z0"],
                     openems_modele.microruban_eeff(_ER, _H, _WPATCH), 6.4)[0]
    verifie("l'er effectif du patch aurait donne un tout autre nombre",
            abs(_faux - _z_pied) > 100.0,
            "%.1f %+.1fj au lieu de %.1f %+.1fj"
            % (_faux.real, _faux.imag, _z_pied.real, _z_pied.imag))

# --------------------------------------------------------------------------
print()
print("20. Le port court-circuite par le cuivre lui-meme")
# LE CAS VU SUR P01x274PCB-C.xml : une pastille du net d'antenne recopiee sur
# la couche de masse, juste sous le port. Les deux bornes touchent l'antenne,
# le calcul va au bout, et le S11 a l'air d'un resultat.
_d = document()
_d["cuivre"][1]["polys"][0]["m"] = 1                   # le plan : la masse
_px, _py = _d["port"]["x"], _d["port"]["y"]


def _court(doc):
    return [a for a in openems_modele.normaliser(doc)["avis"]
            if "a elle-meme" in a["titre"]]


verifie("antenne dessus, masse dessous : rien a dire", not _court(_d))

# La pastille est dans un DEGAGEMENT du plan : isolee de la masse, comme la
# pastille fantome l'etait sur la carte reelle.
_dc = json.loads(json.dumps(_d))
_dc["cuivre"][1]["polys"][0]["t"] = [rect(_px - 1.0, _py - 1.0, 2.0, 2.0)]
_dc["cuivre"][1]["polys"].append({"o": rect(_px - 0.5, _py - 0.5, 1.0, 1.0)})
_av = _court(_dc)
verifie("une pastille d'antenne sous le port, cote masse : avis grave",
        len(_av) == 1 and _av[0]["rang"] == "grave"
        and "l'antenne" in _av[0]["titre"], _av)

# Posee DANS le plan plein, elle est le meme metal que la masse : le plan
# devient « mixte », et le port d'une sonde ordinaire n'est pas court-circuite.
_dp = json.loads(json.dumps(_d))
_dp["cuivre"][1]["polys"].append({"o": rect(_px - 0.5, _py - 0.5, 1.0, 1.0)})
verifie("une pastille d'antenne fondue dans le plan de masse : rien a dire",
        not _court(_dp), _court(_dp))

_dm = json.loads(json.dumps(_d))
_dm["cuivre"][0]["polys"].append(
    {"o": rect(_px - 0.5, _py - 0.5, 1.0, 1.0), "m": 1})
_dm["cuivre"][0]["polys"][0]["o"] = rect(0, 0, 5, 5)   # le patch s'ecarte
_av = _court(_dm)
verifie("masse des deux cotes du port : avis grave aussi",
        len(_av) == 1 and "la masse" in _av[0]["titre"], _av)

_dn = json.loads(json.dumps(_dc))
_dn["cuivre"][1]["polys"][0].pop("m")
verifie("sans masse connue (fichier sans nets) : on se tait",
        not _court(_dn))

# --------------------------------------------------------------------------
print()
print("20 bis. L'ecart que le maillage referme")
# LE CAS VU SUR P01x274PCB-C.xml, SUITE : la pastille RF du point de test dans
# sa reserve du plan de masse, a 0,21 mm du bord. Sur le dessin, deux
# conducteurs ; dans la grille, un seul des qu'une arete a cheval sur l'ecart
# a son milieu dans le metal. La regle est rejouee sur la vraie grille : ici
# 0,3 mm autour de la pastille.


def _rond(cx, cy, r, n=32):
    out = []
    for k in range(n):
        a = 2 * math.pi * k / n
        out += [cx + r * math.cos(a), cy + r * math.sin(a)]
    return out


def _pastille_dans_reserve(ecart, forme="rond"):
    doc = json.loads(json.dumps(_d))
    plan = doc["cuivre"][1]["polys"][0]
    if forme == "rond":
        plan["t"] = [_rond(10.0, 10.0, 0.6 + ecart)]
        doc["cuivre"][1]["polys"].append({"o": _rond(10.0, 10.0, 0.6)})
    else:
        plan["t"] = [rect(9.4 - ecart, 9.4 - ecart, 1.2 + 2 * ecart,
                          1.2 + 2 * ecart)]
        doc["cuivre"][1]["polys"].append({"o": rect(9.4, 9.4, 1.2, 1.2)})
    m = openems_modele.normaliser(doc)
    return m, [a for a in m["avis"] if "soude" in a["titre"]]


_m = openems_modele.normaliser(_d)
verifie("antenne dessus, masse dessous : aucun pont", not _m["ponts_maille"],
        _m["ponts_maille"])
for _forme in ("rond", "carre"):
    # Le maillage OUVRE l'ecart lui-meme : deux lignes dedans, et plus de pont.
    _m, _av = _pastille_dans_reserve(0.1, _forme)
    _eo = _m["ecarts_ouverts"]
    verifie("pastille %s a 0,1 mm de la masse, grille de 0,3 mm : ecart "
            "ouvert par le maillage" % _forme,
            _eo["x"] + _eo["y"] >= 2 and not _m["ponts_maille"] and not _av,
            (_eo, _m["ponts_maille"]))
    verifie("... l'ecart dessine est rendu, et non la maille (%s)" % _forme,
            abs(_eo["plus_petit_ecart"] - 0.1) < 0.005, _eo)
    # LE TIERS DE L'ECART N'EST PLUS LE PRIX : `_elargir_cellules` reprend
    # la plus petite cellule une fois l'ecart ouvert, et le controle des ponts
    # rejoue a chaque essai dit jusqu'ou elle peut grandir.
    _pc = min(_m["estimation"]["plus_petite_cellule_mm"][:2])
    verifie("... et le prix est dit, une cellule elargie au-dela du tiers de "
            "l'ecart (%s)" % _forme,
            0.1 / 3 < _pc < 0.3
            and any("ouvert" in a["titre"] for a in _m["avis"]),
            _m["estimation"]["plus_petite_cellule_mm"])
    # Ce que le controle dit SANS l'ouverture : zero tour, et le pont reste,
    # annonce en avis grave. C'est ce que la grille faisait avant.
    _tours = openems_modele.ECARTS_TOURS
    openems_modele.ECARTS_TOURS = 0
    try:
        _m2, _av2 = _pastille_dans_reserve(0.1, _forme)
    finally:
        openems_modele.ECARTS_TOURS = _tours
    verifie("... sans ouverture, le pont est la, en avis grave (%s)" % _forme,
            _m2["ponts_maille"] and _m2["ponts_maille"][0]["couche"] == "BOTTOM"
            and len(_av2) == 1 and _av2[0]["rang"] == "grave",
            (_m2["ponts_maille"][:1], _av2))
    _m, _av = _pastille_dans_reserve(0.21, _forme)
    verifie("pastille %s a 0,21 mm, grille de 0,3 mm : une ligne tombe "
            "dedans, rien a dire" % _forme, not _av, _m["ponts_maille"])

# LA PLUS PETITE CELLULE, REPRISE APRES L'OUVERTURE (`_elargir_cellules`).
# Sur P01x274, une ligne d'ecart finissait a 0,034 mm d'une ligne de grille :
# 49 h annoncees. On balaie la pastille dans sa reserve -- trois ecarts, cinq
# positions sur la grille -- avec et sans la reprise : elle ne doit jamais
# ressouder, jamais rendre la cellule plus petite, et la grandir la ou les
# lignes au tiers la pincaient.


def _pastille_decalee(ecart, dx, essais=None):
    doc = json.loads(json.dumps(_d))
    plan = doc["cuivre"][1]["polys"][0]
    plan["t"] = [_rond(10.0 + dx, 10.0, 0.6 + ecart)]
    doc["cuivre"][1]["polys"].append({"o": _rond(10.0 + dx, 10.0, 0.6)})
    garde = openems_modele.ELARGIR_ESSAIS
    if essais is not None:
        openems_modele.ELARGIR_ESSAIS = essais
    try:
        m = openems_modele.normaliser(doc)
    finally:
        openems_modele.ELARGIR_ESSAIS = garde
    return m, min(m["estimation"]["plus_petite_cellule_mm"][:2])


_pire_sans, _pire_avec, _soudes, _recule = 1.0, 1.0, [], []
for _ec in (0.1, 0.14, 0.18):
    for _i in range(5):
        _dx = 0.043 * _i
        _ma, _avec = _pastille_decalee(_ec, _dx)
        _ms, _sans = _pastille_decalee(_ec, _dx, essais=0)
        _pire_sans, _pire_avec = min(_pire_sans, _sans), min(_pire_avec, _avec)
        if _ma["ponts_maille"] and not _ms["ponts_maille"]:
            _soudes.append((_ec, _dx))
        if _avec < _sans - 1e-9:
            _recule.append((_ec, _dx, _sans, _avec))
verifie("reprise de la plus petite cellule : aucun ecart ressoude",
        not _soudes, _soudes)
verifie("... jamais une cellule plus petite qu'avant",
        not _recule, _recule)
verifie("... et la pire cellule grandit nettement",
        _pire_avec > 1.5 * _pire_sans, (_pire_sans, _pire_avec))

# L'IFA DE P01x274 (A400) : la patte de court-circuit s'arrete a 0,01 mm du
# morceau de plan de masse, et la carte reelle les soude. La reprise ne doit
# ni l'ouvrir ni y toucher, et la pastille a 0,14 mm d'a cote reste ouverte.
_dfa = json.loads(json.dumps(_d))
_pl = _dfa["cuivre"][1]["polys"][0]
_pl["t"] = [_rond(10.0, 10.0, 0.74), rect(20, 20, 10, 10)]
_dfa["cuivre"][1]["polys"] += [{"o": _rond(10.0, 10.0, 0.6)},
                               {"o": rect(24, 20.01, 1, 9)}]
_mfa = openems_modele.normaliser(_dfa)
_pts = _mfa["ponts_maille"]
verifie("IFA : la patte a 0,01 mm de la masse reste soudee",
        any(s["ecart"] < 0.02 and 23.9 <= s["x"] <= 25.1 for s in _pts),
        [(s["ecart"], s["x"], s["y"]) for s in _pts])
verifie("... et aucun ecart ouvrable n'est soude a cote",
        not [s for s in _pts if s["ecart"] >= openems_modele.ECART_OUVRABLE_MM],
        [(s["ecart"], s["x"], s["y"]) for s in _pts])

# Une languette d'antenne qui TOUCHE la masse (la patte d'un IFA) : le contact
# est dessine, pas fabrique par la grille.
_di = json.loads(json.dumps(_d))
_di["cuivre"][1]["polys"][0]["t"] = [rect(5, 5, 10, 10)]
_di["cuivre"][1]["polys"].append({"o": rect(5, 9, 6, 1)})
_m = openems_modele.normaliser(_di)
verifie("une patte qui touche la masse n'est pas un pont",
        not _m["ponts_maille"], _m["ponts_maille"])

_dn = json.loads(json.dumps(_d))
_dn["cuivre"][1]["polys"][0].pop("m")
_dn["cuivre"][1]["polys"][0]["t"] = [_rond(10.0, 10.0, 0.7)]
_dn["cuivre"][1]["polys"].append({"o": _rond(10.0, 10.0, 0.6)})
verifie("sans masse connue : on se tait",
        not openems_modele.normaliser(_dn)["ponts_maille"])

# --------------------------------------------------------------------------
print()
print("20 ter. La masse cachee, quand l'antenne est des deux cotes du plan")
# LE CAS DE P01x274PCB-C.xml : la sonde se pose sur le point de test du
# DESSUS, le trou metallise porte le signal jusqu'a l'antenne, sur le
# DESSOUS. La couche « de » du port ne dit pas ou l'antenne rayonne.


def _pile3(dessus, dessous, de, a, px, py):
    return document(
        empilage=[
            {"nom": "TOP", "cuivre": True, "ep": 0.035, "seq": 1},
            {"nom": "D1", "cuivre": False, "ep": 0.37, "er": 4.37, "df": 0.02, "seq": 2},
            {"nom": "MID", "cuivre": True, "ep": 0.035, "seq": 3},
            {"nom": "D2", "cuivre": False, "ep": 0.71, "er": 4.37, "df": 0.02, "seq": 4},
            {"nom": "BOT", "cuivre": True, "ep": 0.035, "seq": 5},
        ],
        cuivre=[
            {"couche": "TOP", "polys": dessus},
            {"couche": "MID", "polys": [{"o": rect(0, 0, 40, 40), "m": 1}]},
            {"couche": "BOT", "polys": dessous},
        ],
        port={"type": "localise", "dir": "z", "x": px, "y": py,
              "w": 0.5, "l": 0.5, "R": 50.0, "de": de, "a": a},
        bande={"f1": 0.8e9, "f2": 0.95e9, "n": 101, "fcible": 0.868e9})


_masse_haut = {"o": rect(30, 30, 2, 2), "m": 1}      # loin de tout
_masse_bas = {"o": rect(5, 30, 2, 2), "m": 1}        # loin de tout
_bord_bas = {"o": rect(24, 10, 1, 1), "m": 1}        # a 1 mm du rayonnant
_bord_haut = {"o": rect(21.5, 19.5, 1, 1), "m": 1}   # a 1 mm de la pastille
_rayonnant = {"o": rect(18, 5, 5, 20)}                 # 100 mm2, sur BOT
_pastille = {"o": rect(19.5, 19.5, 1, 1)}              # le point de test, sur TOP

_mc = openems_modele.normaliser(_pile3(
    [_masse_haut], [_rayonnant, _masse_bas],
    "BOT", "MID", 20.0, 10.0))["masse_cachee"]
verifie("antenne dessous, port dessous : la masse du dessus est cachee",
        _mc["retires"] == {"TOP": 1} and not _mc["gardes_proches"], _mc)

_m3 = openems_modele.normaliser(_pile3(
    [_pastille, _masse_haut], [_rayonnant, _masse_bas, _bord_bas],
    "TOP", "MID", 20.0, 20.0))
_mc = _m3["masse_cachee"]
verifie("port sur la pastille du dessus : la masse qui borde l'antenne reste",
        _mc["gardes_proches"] == 1 and "BOT" in _mc["antenne_derriere"], _mc)
verifie("et celle qui en est loin part quand meme",
        _mc["retires"] == {"BOT": 1}, _mc)
verifie("l'avis dit ce qui est garde, et pourquoi",
        any("gardes quand meme" in a["texte"] for a in _m3["avis"]),
        [a["titre"] for a in _m3["avis"]])

_mc = openems_modele.normaliser(_pile3(
    [_pastille, _bord_haut, _masse_haut], [_rayonnant, _masse_bas],
    "BOT", "MID", 20.0, 10.0))["masse_cachee"]
verifie("P01x274 : le point de test du dessus garde sa masse, le reste part",
        _mc["retires"] == {"TOP": 1} and _mc["gardes_proches"] == 1, _mc)

_mc = openems_modele.normaliser(_pile3(
    [_pastille, _bord_haut], [_rayonnant, _masse_bas],
    "BOT", "MID", 20.0, 10.0))["masse_cachee"]
verifie("tout ce qui est cache borde l'antenne : rien n'est retire, et on le sait",
        not _mc["retires"] and _mc["reference"] == "MID"
        and _mc["gardes_proches"] == 1, _mc)

# Le meme document, port DANS LE PLAN : « a » n'est qu'une couche voisine
# exigee par le format (37-port-auto.js), pas un plan de reference.
_dp = _pile3([_masse_haut], [_rayonnant, _masse_bas], "BOT", "MID", 20.0, 10.0)
_dp["port"]["dir"] = "x"
_dp["port"]["ecart"] = 0.2
_mc = openems_modele.normaliser(_dp)["masse_cachee"]
verifie("port dans le plan : sa couche « vers » ne cache aucune masse",
        _mc["reference"] is None and not _mc["retires"], _mc)

# --------------------------------------------------------------------------
print()
print("21. Le lecteur de champs .vtr")
# IL A SON PROPRE BANC, parce qu'il fabrique ses fichiers d'essai et qu'il
# n'a besoin ni d'openEMS ni d'un dossier de calcul : le format .vtr se
# verifie en ecrivant des fichiers dont on connait le contenu, ce qui est
# plus sur qu'un calcul de dix minutes. On le lance d'ici pour qu'une seule
# commande suffise a tout verifier ; pour l'eprouver en plus sur de VRAIS
# fichiers, on lui passe a la main un dossier de calcul :
#
#     python python/test/banc-champs.py <dossier>
#
try:
    _r = subprocess.run([sys.executable, os.path.join(ICI, "banc-champs.py")],
                        capture_output=True, text=True, timeout=300)
    _sortie = ((_r.stdout or "") + (_r.stderr or "")).strip()
    if _r.returncode == 0:
        for _l in _sortie.splitlines():
            if _l.strip().startswith("ok "):
                _ok[0] += 1
        print("   banc-champs.py         %s" % _sortie.splitlines()[-1])
    else:
        for _l in _sortie.splitlines():
            if _l.strip().startswith("RATE"):
                _ko.append(_l.strip()[5:].strip())
        print(_sortie)
except Exception as _exc:                              # noqa: BLE001
    print("   banc-champs.py non lance : %s" % _exc)

# --------------------------------------------------------------------------
print()
print("22. Les pieces importees (STEP, STL) : boitier, piles")
# CE QUE LE BANC VERIFIE ICI, C'EST CE QUE CSXCAD NE DIRAIT PAS. Un polyedre
# ouvert, ou dont les sommets ne sont pas recolles, y est vu vide PARTOUT --
# verifie a la main sur CSXCAD 0.6.3, IsInside = faux au centre d'un cube non
# recolle. Le boitier partirait au solveur et n'y existerait pas. Le modele
# doit donc recoller, refuser l'ouvert, et poser des lignes sur les parois --
# sans quoi une paroi de 1,5 mm tombe entre deux lignes et disparait a moitie.
import base64 as _b64                                  # noqa: E402
import struct as _struct                               # noqa: E402
import openems_pieces                                  # noqa: E402

_QUADS = [[(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)],
          [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
          [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)],
          [(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)],
          [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)],
          [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)]]


def _pave(o, d, inverse=False, soude=True, faces=6):
    """Un pave en triangles ; `soude=False` duplique les sommets par face,
    comme OpenCascade les rend."""
    S, T, idx = [], [], {}
    for q in _QUADS[:faces]:
        ids = []
        for p in q:
            v = tuple(o[k] + d[k] * p[k] for k in range(3))
            if soude and v in idx:
                ids.append(idx[v])
                continue
            idx[v] = len(S)
            S.append(v)
            ids.append(idx[v])
        a, b, c, e = ids
        tr = [(a, b, c), (a, c, e)]
        T += [t[::-1] for t in tr] if inverse else tr
    return S, T


def _coque(o, d, ep):
    S1, T1 = _pave(o, d)
    S2, T2 = _pave([o[k] + ep for k in range(3)],
                   [d[k] - 2 * ep for k in range(3)], inverse=True)
    n = len(S1)
    return S1 + S2, T1 + [tuple(i + n for i in t) for t in T2]


def _corps(nom, ST, materiau="dielectrique", er=2.8, df=0.006):
    S, T = ST
    return {"nom": nom, "materiau": materiau, "matiere": "ABS", "er": er, "df": df,
            "sommets": _b64.b64encode(_struct.pack(
                "<%df" % (3 * len(S)), *[c for v in S for c in v])).decode(),
            "triangles": _b64.b64encode(_struct.pack(
                "<%dI" % (3 * len(T)), *[i for t in T for i in t])).decode()}


def _piece(*corps, **quoi):
    p = {"id": "p1", "nom": "boitier", "position": [0, 0, 0],
         "rotation": [0, 0, 0], "corps": list(corps)}
    p.update(quoi)
    return p


_COQUE = _coque([-5, -5, -8], [80, 80, 20], 1.5)
mp = openems_modele.normaliser(document(pieces=[_piece(_corps("coque", _COQUE))]))
_c = mp["pieces"][0]["corps"][0]
verifie("une coque fermee est acceptee", _c["ferme"] and _c["triangles"] == 24)
verifie("l'emprise s'etend au boitier",
        mp["emprise"][2] == -8.0 and mp["emprise"][5] == 12.0, mp["emprise"])
verifie("la boite d'air part du boitier, pas de la carte",
        mp["boite"]["z1"] < -8.0 and mp["boite"]["z2"] > 12.0)
for _ax, _v in (("x", (-5.0, -3.5, 73.5, 75.0)), ("z", (-8.0, -6.5, 10.5, 12.0))):
    verifie("les DEUX faces de chaque paroi portent une ligne (%s)" % _ax,
            all(any(abs(q - v) < 1e-6 for q in mp["maillage"][_ax]) for v in _v),
            [v for v in _v if not any(abs(q - v) < 1e-6 for q in mp["maillage"][_ax])])
verifie("un boitier fait grossir le maillage, et cela se voit",
        mp["estimation"]["cellules"] > m["estimation"]["cellules"])
_sg = openems_pieces.sans_geometrie(mp)
verifie("la page recoit le modele SANS les triangles, et il est du JSON",
        all("_geo" not in c for p in _sg["pieces"] for c in p["corps"])
        and "_geo" in mp["pieces"][0]["corps"][0] and bool(json.dumps(_sg)))

_verre = openems_modele.normaliser(document(pieces=[_piece(
    _corps("vitre", _COQUE, er=6.5, df=0.015))]))
verifie("une piece en verre (er 6,5) resserre le pas DE SA REGION, pas celui du cuivre",
        _verre["resolution"]["ext"] < mp["resolution"]["ext"]
        and _verre["resolution"]["die"] == mp["resolution"]["die"]
        and _verre["resolution"]["er_max"] == mp["resolution"]["er_max"],
        (_verre["resolution"]["ext"], mp["resolution"]["ext"]))

# LE PAS FIN RESTE SUR LE CUIVRE. Un boitier ABS autour du patch ne se maille
# pas au pas qu'impose le cuivre : entre l'emprise du cuivre et celle du
# boitier, les lignes sont a lambda/20/racine(2,8).
_GRAND = _coque([-40, -40, -25], [150, 150, 55], 2.0)
_fin = {"res_die": 0.4}
_mg = openems_modele.normaliser(document(pieces=[_piece(_corps("coque", _GRAND))], maillage=_fin))
_fe = _mg["emprise_fin"]
_xs = [v for v in _mg["maillage"]["x"] if _mg["emprise"][0] + 2.5 < v < _fe[0] - 1e-6]
_ecarts = [b - a for a, b in zip(_xs, _xs[1:])]
verifie("hors du cuivre, le boitier est maille a son pas et non au pas fin",
        _ecarts and max(_ecarts) > 4 * 0.4 and min(_ecarts) > 0.4 * 1.5,
        (_ecarts, _mg["resolution"]["ext"]))
_c0 = openems_modele.normaliser(document(maillage=_fin))["estimation"]["cellules"]
verifie("un grand boitier coute moins que trois fois l'antenne seule",
        _mg["estimation"]["cellules"] < 3 * _c0, (_mg["estimation"]["cellules"], _c0))

# LES CORPS IGNORES NE COMPTENT PAS DANS LA LIMITE : un export complet, carte
# peuplee comprise, passe tant que peu de corps partent au solveur.
_n = openems_pieces.MAX_CORPS
_beaucoup = [{"nom": "composant %d" % i, "materiau": "ignore"} for i in range(_n + 50)]
_mi = openems_modele.normaliser(document(pieces=[_piece(_corps("coque", _COQUE), *_beaucoup)]))
verifie("450 corps dont 1 simule : le modele passe",
        _mi["stats"]["corps"] == 1)
refuse("au-dela de 400 corps SIMULES, le refus dit de marquer « ignore »",
       document(pieces=[_piece(*[_corps("vis %d" % i, _COQUE, "metal") for i in range(_n + 1)])]),
       "ignore")

# LA SOUDURE DU SERVEUR NE FUSIONNE QUE L'IDENTIQUE : deux sommets a 0,8 um
# que la page a gardes distincts le restent.
_S, _T = _pave([0, 0, 0], [5, 5, 5])
_S = _S + [(0.0008, 0.0006, 0.0)]
_T = _T + [(0, 1, len(_S) - 1), (0, len(_S) - 1, 1)]
_a = openems_pieces._analyser("t", _corps("x", (_S, _T))["sommets"], _corps("x", (_S, _T))["triangles"])
verifie("un sommet a moins d'un micron d'un autre n'est pas fusionne par le serveur",
        _a["n_sommets"] == 9, _a["n_sommets"])

# UNE PIECE DE BIAIS DANS LA GRILLE LE DIT.
_bi = openems_modele.normaliser(document(pieces=[_piece(_corps("coque", _COQUE), rotation=[0, 0, 30])]))
verifie("une piece tournee de 30 degres par rapport a la carte donne un avis",
        any("biais" in a["titre"] for a in _bi["avis"]))
verifie("un quart de tour, non",
        not any("biais" in a["titre"] for a in openems_modele.normaliser(
            document(pieces=[_piece(_corps("coque", _COQUE), rotation=[0, 0, 90])]))["avis"]))

_ouvert = _pave([10, 10, 5], [5, 5, 5], faces=5)
refuse("un corps OUVERT est refuse (CSXCAD le verrait vide)",
       document(pieces=[_piece(_corps("vis", _ouvert, "metal"))]),
       "n'est pas ferme")
_ign = openems_modele.normaliser(document(pieces=[_piece(
    _corps("coque", _COQUE), {"nom": "PCB", "materiau": "ignore"},
    _corps("vis", _ouvert, "ignore"))]))
verifie("un corps ignore n'a pas besoin de ses triangles, et ne compte pas",
        _ign["stats"]["corps"] == 1 and _ign["stats"]["triangles"] == 24,
        _ign["stats"])
refuse("une permittivite sous 1 est refusee",
       document(pieces=[_piece(_corps("coque", _COQUE, er=0.5))]),
       "permittivite")

_brut = _pave([10, 10, 5], [5, 5, 5], soude=False)
_sd = openems_modele.normaliser(document(pieces=[_piece(
    _corps("pile", _brut, "metal"), rotation=[0, 90, 0], position=[1, 2, 3])]))
_cs = _sd["pieces"][0]["corps"][0]
verifie("des sommets dupliques par face sont recolles (24 -> 8)",
        _cs["sommets"] == 8 and _cs["ferme"], _cs)
verifie("la rotation tourne sur le centre de la piece, la position deplace",
        all(abs(a - b) < 1e-9 for a, b in
            zip(_cs["emprise"], (11, 12, 8, 16, 17, 13))), _cs["emprise"])
_cz = openems_modele.normaliser(document(pieces=[_piece(
    _corps("pile", _brut, "metal"), rotation=[0, 0, 90], centre=[10, 10, 5])]))
verifie("le centre envoye par la page fait foi (corps ignores compris)",
        all(abs(a - b) < 1e-9 for a, b in
            zip(_cz["pieces"][0]["corps"][0]["emprise"], (5, 10, 5, 10, 15, 10))),
        _cz["pieces"][0]["corps"][0]["emprise"])
verifie("un metal passe au-dessus du cuivre, un plastique sous le substrat",
        _cs["priorite"] > 13 and _c["priorite"] < 1)

_max = openems_pieces.MAX_TRIANGLES
openems_pieces.MAX_TRIANGLES = 10
refuse("un budget de triangles depasse est refuse, et dit quoi faire",
       document(pieces=[_piece(_corps("coque", _COQUE))]), "triangles")
openems_pieces.MAX_TRIANGLES = _max

_sp = openems_script.generer(mp)
try:
    compile(_sp, "pieces.py", "exec")
    verifie("le script avec pieces compile", True)
except SyntaxError as exc:
    verifie("le script avec pieces compile", False, str(exc))
verifie("chaque corps simule devient un polyedre",
        _sp.count("_polyedre(piece_") == 1 and "AddPolyhedron" in _sp)
verifie("un plastique part en materiau, avec sa permittivite",
        "epsilon=2.8" in _sp)

# -- le substrat de la carte entiere ---------------------------------------
# Par defaut le stratifie simule s'arrete a l'emprise du cuivre retenu ; avec
# le contour de la carte, il a la taille de la vraie -- et le maillage aussi.
_CONTOUR = [-10, -10, 80, -10, 80, 95, 40, 110, -10, 95]
_mc = openems_modele.normaliser(document(carte={"substrat": True,
                                                "contour": _CONTOUR}))
verifie("le substrat de la carte entiere agrandit l'emprise a son contour",
        _mc["emprise"][:2] == [-10.0, -10.0] and _mc["emprise"][3:5] == [80.0, 110.0],
        _mc["emprise"])
verifie("ses bords droits portent une ligne de maillage",
        all(any(abs(q - v) < 1e-6 for q in _mc["maillage"][a])
            for a, v in (("x", -10.0), ("x", 80.0), ("y", -10.0))))
_sc = openems_script.generer(_mc)
verifie("le substrat part en polygone (AddLinPoly), et non en boite",
        "sub_0.AddLinPoly(" in _sc and "sub_0.AddBox(" not in _sc)
_mo = openems_modele.normaliser(document(carte={"substrat": False,
                                                "contour": _CONTOUR}))
verifie("decoche, rien ne change : le substrat reste l'emprise du cuivre",
        _mo["emprise"] == m["emprise"] and _mo.get("carte") is None)

# LA VRAIE QUESTION, POSEE A CSXCAD LUI-MEME quand il est installe : la paroi
# est-elle pleine, la cavite vide, et le reste-t-elles apres le passage par le
# XML (le chemin des pertes de Debye) ?
try:
    import openems_run                                 # noqa: E402
    _exe = openems_run.interprete() if openems_run.etat().get("dispo") else ""
except Exception:                                      # noqa: BLE001
    _exe = ""
if _exe:
    _code = (
        "import os, sys, tempfile\n"
        "d = os.environ.get('OPENEMS_DLL', '')\n"
        "if d and hasattr(os, 'add_dll_directory'):\n"
        "    os.add_dll_directory(d)\n"
        "import numpy as np\n"
        "from CSXCAD import ContinuousStructure\n"
        "CSX = ContinuousStructure()\n"
        "exec(sys.stdin.read(), {'np': np, 'CSX': CSX})\n"
        "x = os.path.join(tempfile.mkdtemp(), 'p.xml')\n"
        "CSX.Write2XML(x)\n"
        "C2 = ContinuousStructure(); C2.ReadFromXML(x)\n"
        "for C in (CSX, C2):\n"
        "    p = C.GetAllProperties()[0].GetAllPrimitives()[0]; p.Update()\n"
        "    print(p.IsInside([-4.2, 30, 0]), p.IsInside([30, 30, 0]),"
        " p.IsInside([80, 30, 0]))\n")
    try:
        _r = subprocess.run([_exe, "-c", _code], input=openems_script._bloc_pieces(mp),
                            capture_output=True, text=True, timeout=120,
                            env=openems_run._preparer_env())
        _l = (_r.stdout or "").strip().splitlines()
        verifie("CSXCAD voit la paroi pleine, la cavite et le dehors vides",
                len(_l) == 2 and _l[0] == "True False False", _r.stdout + _r.stderr[-300:])
        verifie("et toujours apres le passage par le XML",
                len(_l) == 2 and _l[1] == "True False False", _l)
    except Exception as exc:                           # noqa: BLE001
        verifie("CSXCAD relit les pieces", False, str(exc))
else:
    print("   CSXCAD absent : la lecture des polyedres par le solveur n'est pas")
    print("   verifiee ici.")

# --------------------------------------------------------------------------
print()
print("23. Les bancs JavaScript (decoupage de polygones, logique de la page)")
# IL EST EN JAVASCRIPT, ET IL EST QUAND MEME VERIFIE ICI. Le decoupage d'une
# decoupe au bord d'un versement est le seul morceau de l'outil dont on ne
# voit PAS le resultat : une fente mal coupee ne fait pas d'erreur, elle fait
# une antenne differente. Le laisser sans banc sous pretexte qu'il n'est pas
# en Python serait le laisser sans filet la ou il en faut le plus.
_RACINE = os.path.dirname(os.path.dirname(ICI))
for _nom in ("banc-polygones.js", "banc-interface.js"):
    try:
        _r = subprocess.run(["node", os.path.join(_RACINE, "test", _nom)],
                            capture_output=True, text=True, timeout=120)
        _sortie = ((_r.stdout or "") + (_r.stderr or "")).strip()
        if _r.returncode == 0:
            for _l in _sortie.splitlines():
                if _l.strip().startswith("ok "):
                    _ok[0] += 1
            print("   %-22s %s" % (_nom, _sortie.splitlines()[-1]))
        else:
            for _l in _sortie.splitlines():
                if _l.strip().startswith("RATE"):
                    _ko.append(_l.strip()[5:].strip())
            print(_sortie)
    except FileNotFoundError:
        print("   node n'est pas installe : les bancs JavaScript n'ont pas")
        print("   tourne — le decoupage des decoupes, la liste des ports et")
        print("   les conversions d'unite ne sont donc pas verifies.")
        break
    except Exception as _exc:                          # noqa: BLE001
        print("   %s non lance : %s" % (_nom, _exc))

# --------------------------------------------------------------------------
print()
if _ko:
    print("%d verification(s) sur %d ont echoue :" % (len(_ko), _ok[0] + len(_ko)))
    for nom in _ko:
        print("   - " + nom)
else:
    print("%d verifications, toutes passees." % _ok[0])

# --------------------------------------------------------------------------
# La vraie simulation, sur demande. Elle demande openEMS installe et
# quelques minutes ; le reste du banc n'en depend pas.
# --------------------------------------------------------------------------
if "--simuler" in sys.argv:
    import openems_run
    print()
    print("20. Simulation FDTD reelle : la sonde localisee")
    etat = openems_run.etat()
    if not etat.get("dispo"):
        print("   openEMS indisponible : %s" % etat.get("detail"))
        sys.exit(1 if _ko else 0)

    vue = openems_run.lancer(m)
    ident, vu = vue["id"], 0
    print("   tache %s, dossier %s" % (ident, vue["dossier"]))
    while True:
        time.sleep(3)
        j = openems_run.journal(ident, vu)
        vu = j["n"]
        for ligne in j["lignes"][-3:]:
            print("   | " + ligne[:110])
        if j["etat"] in ("fini", "echoue", "arrete"):
            break
    if j["etat"] != "fini":
        print("   ECHEC : %s" % j["detail"])
        sys.exit(1)

    # UN CALCUL QUI VA AU BOUT SANS RIEN RENDRE EST LE CAS LE PLUS INSTRUCTIF,
    # et le banc y repondait par un TypeError nu : « must be real number, not
    # NoneType ». C'est arrive pour de bon -- une boite d'excitation posee a
    # quatre microns d'une ligne de maillage n'excite rien, et le solveur
    # calcule vingt mille pas d'un champ nul (voir `_coller_ports`). Le dire
    # est la moitie du travail d'un banc d'essai.
    r = j["resultat"] or {}
    if not r.get("f0"):
        print("   ECHEC : la simulation a fini sans rien rendre.")
        print("   %s" % (j.get("detail") or ""))
        verifie("la simulation rend une resonance", False,
                "aucune grandeur exploitable -- le port a-t-il excite ?")
        sys.exit(1)
    fr = r["f0"] / 1e9
    print()
    print("   resonance a %.4f GHz, S11 = %.2f dB, Z = %.1f %+.1fj ohms"
          % (fr, r["s11_min_db"], r["z0_re"], r["z0_im"]))
    ecart = abs(fr - 2.45) / 2.45 * 100
    print("   ecart a la valeur visee : %.1f %%" % ecart)
    verifie("la resonance tombe a moins de 8 % de la formule du patch",
            ecart < 8.0, "%.1f %%" % ecart)
    verifie("l'antenne est adaptee (S11 < -6 dB)", r["s11_min_db"] < -6.0,
            "%.2f dB" % r["s11_min_db"])
    verifie("la partie reelle de Z est du bon ordre",
            10 < r["z0_re"] < 200, "%.1f ohms" % r["z0_re"])

    # ----------------------------------------------------------------------
    # Le meme patch, alimente par un connecteur coaxial.
    #
    # C'EST LE SEUL JUGE DU PORT COAXIAL. Le signe des sondes de tension et de
    # courant ne se verifie pas a la lecture, et la premiere version de ce
    # port-la etait fausse sans que rien dans le script ne le montre : le
    # degagement du plan de masse etait pose en cylindre de hauteur nulle, qui
    # ne perce pas une feuille conductrice. La simulation, elle, l'a dit tout
    # de suite — Z = 0,0 + 5,0j ohms au plan de reference, soit exactement une
    # ligne de 1,5 mm court-circuitee a son bout.
    #
    # Deux indices decisifs, et ils ne se remplacent pas l'un l'autre :
    #   - |S11| <= 1 PARTOUT. Un port qui rend plus d'energie qu'il n'en recoit
    #     est un port dont le courant est compte a l'envers ;
    #   - la resonance tombe au meme endroit que celle de la sonde localisee.
    #     Le connecteur change l'impedance d'entree — il ajoute l'inductance de
    #     son ame —, il ne change pas la longueur du patch.
    print()
    print("18. Simulation FDTD reelle : le port coaxial")
    mcoax = openems_modele.normaliser(document(port={
        "type": "coaxial", "x": PLAN / 2.0, "y": Y0 + L_PATCH / 3.0,
        "R": 50.0, "de": "TOP", "a": "BOTTOM"}))
    vue = openems_run.lancer(mcoax)
    ident, vu = vue["id"], 0
    print("   tache %s, dossier %s" % (ident, vue["dossier"]))
    while True:
        time.sleep(3)
        j = openems_run.journal(ident, vu)
        vu = j["n"]
        for ligne in j["lignes"][-3:]:
            print("   | " + ligne[:110])
        if j["etat"] in ("fini", "echoue", "arrete"):
            break
    if j["etat"] != "fini":
        print("   ECHEC : %s" % j["detail"])
        sys.exit(1)

    rc = j["resultat"]
    pire = max(abs(complex(a, b))
               for a, b in zip(rc["s11_re"], rc["s11_im"]))
    print()
    print("   resonance a %.4f GHz, S11 = %.2f dB, Z = %.1f %+.1fj ohms"
          % (rc["f0"] / 1e9, rc["s11_min_db"], rc["z0_re"], rc["z0_im"]))
    print("   |S11| maximal sur la bande : %.4f" % pire)
    verifie("le coaxial ne cree pas d'energie (|S11| <= 1)", pire < 1.02,
            "%.4f" % pire)
    ecart_c = abs(rc["f0"] - r["f0"]) / r["f0"] * 100
    verifie("il resonne au meme endroit que la sonde localisee",
            ecart_c < 3.0, "%.2f %% d'ecart" % ecart_c)
    verifie("l'impedance n'est ni un court-circuit ni un circuit ouvert",
            5 < rc["z0_re"] < 300, "%.1f ohms" % rc["z0_re"])
    verifie("l'ame ajoute de l'inductance, comme une sonde reelle",
            rc["z0_im"] > r["z0_im"] - 1.0,
            "%.1fj contre %.1fj" % (rc["z0_im"], r["z0_im"]))

sys.exit(1 if _ko else 0)
