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

# LA REGLE S'ARRETE OU LE BUDGET S'ARRETE, et la carte d'essai fait 70 mm :
# une piste de 1 mm y demanderait 0,25 mm de pas, soit 280 lignes par axe. Le
# plancher tient a 0,35 mm — et l'avis le dit, ce qui est la seule chose qui
# distingue une borne assumee d'un silence.
_d_1mm = document()
_d_1mm["cuivre"][0]["polys"].append({"o": rect(5.0, 5.0, 20.0, 1.0)})
_m_1mm = openems_modele.normaliser(_d_1mm)
verifie("sous le budget de lignes, le pas s'arrete au plancher",
        abs(_m_1mm["resolution"]["die"] - PLAN / 200.0) < 1e-6,
        "%.4f pour une carte de %.0f mm" % (_m_1mm["resolution"]["die"], PLAN))
verifie("et l'avis nomme la piste qui n'est pas resolue",
        any("pas resolu" in a["titre"] for a in _m_1mm["avis"]),
        str([a["titre"] for a in _m_1mm["avis"]]))

# Une pastille de 50 microns ne doit pas emmener toute la carte avec elle.
_d_pad = document()
_d_pad["cuivre"][0]["polys"].append({"o": rect(5.0, 5.0, 0.05, 0.05)})
_m_pad = openems_modele.normaliser(_d_pad)
verifie("un detail minuscule est borne, pas suivi",
        _m_pad["resolution"]["die"] >= res["die"] / 8.0 - 1e-9,
        "%.4f" % _m_pad["resolution"]["die"])
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
verifie("la decoupe sort a une priorite superieure au metal",
        "priority=11" in t2 and "priority=10" in t2)

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
        "priority=11)" in _deg[-40:] and
        "AddPolygon" in _deg[_deg.rindex("sub_0."):] and
        "AddCylinder" not in _deg[_deg.rindex("sub_0."):])
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
finally:
    projet._RACINE = None
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
print("17. Le calcul qui ne rend rien, et ce qu'il en dit")
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
print("18. La ligne d'alimentation ramenee au pied de l'antenne")
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
print("19. Les bancs JavaScript (decoupage de polygones, logique de la page)")
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

    r = j["resultat"]
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
