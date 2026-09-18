#!/usr/bin/python3
# -*- coding: utf-8 -*-
# ==========================================================================
# VERSIONING
# Version: 1.0.0
# Date: 2026-09-14
# Explication : le modele normalise -> un script Python autonome.
#
#   POURQUOI CE MODULE EXISTE. Une interface graphique qui lance un solveur
#   et ne rend qu'une courbe laisse son utilisateur sans recours : il ne peut
#   ni rejouer le calcul dans six mois, ni le montrer a un collegue, ni
#   changer LA chose que l'interface n'a pas prevue. Le script rendu ici est
#   le contraire de cela : il ne depend plus ni du serveur, ni de la page, ni
#   de ce depot. Il s'ouvre, il se lit, il se modifie, il se relance.
#
#   Il est aussi la meilleure documentation de ce que l'outil a fait : tout
#   ce que l'assistant a devine -- marge d'air, pas de maillage, largeur de
#   l'impulsion -- y est ecrit en clair, avec la raison en commentaire.
#
# Fonctions : generer
# ==========================================================================
"""Traduit un modele normalise en script openEMS autonome.

    >>> import openems_modele, openems_script
    >>> m = openems_modele.normaliser(doc)
    >>> open("antenne.py", "w", encoding="utf-8").write(openems_script.generer(m))
"""

import math
import os

C0 = 299792458.0
EPS0 = 8.8541878128e-12


def _f(v, dec=6):
    """Un flottant ecrit court : les coordonnees viennent d'un fichier de
    CAO au micron, dix-sept chiffres apres la virgule n'apprennent rien."""
    s = ("%." + str(dec) + "f") % float(v)
    s = s.rstrip("0").rstrip(".")
    return s if s and s not in ("-", "-0") else "0"


def _liste(vals, dec=6, par_ligne=8, indent=4):
    """Une liste Python lisible, coupee en lignes."""
    if not vals:
        return "[]"
    mots = [_f(v, dec) for v in vals]
    lignes, courant = [], []
    for mot in mots:
        courant.append(mot)
        if len(courant) >= par_ligne:
            lignes.append(", ".join(courant))
            courant = []
    if courant:
        lignes.append(", ".join(courant))
    tab = " " * indent
    return "[\n" + "".join(tab + l + ",\n" for l in lignes) + " " * (indent - 4) + "]"


def _poly(pts, dec=6, indent=8):
    """Un polygone au format que veut AddLinPoly : [[x...],[y...]]."""
    tab = " " * indent
    xs = _liste([p[0] for p in pts], dec, 8, indent + 4)
    ys = _liste([p[1] for p in pts], dec, 8, indent + 4)
    return "[\n%s%s,\n%s%s]" % (tab, xs, tab, ys)


# Un disque n'existe pas en 2D dans CSXCAD : il s'approche par un polygone
# regulier. Vingt-quatre cotes donnent une erreur de rayon de 0,9 % au pire,
# soit 18 microns sur un degagement de SMA — trente fois moins que la cellule
# la plus fine qu'on maille jamais a ces frequences.
DISQUE_COTES = 24


def _disque(x, y, r, n=DISQUE_COTES):
    """Un disque, en polygone, dans le plan xy."""
    return [(x + r * math.cos(2 * math.pi * i / n),
             y + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def _ident(nom, prefixe="p"):
    """Un nom de propriete CSXCAD sur : lettres, chiffres, souligne."""
    sortie = []
    for ch in str(nom):
        sortie.append(ch if (ch.isalnum() and ord(ch) < 128) else "_")
    s = "".join(sortie).strip("_") or "x"
    if s[0].isdigit():
        s = prefixe + "_" + s
    return s


def _kappa(er, df, f0):
    """Conductivite equivalente d'un dielectrique a pertes.

    openEMS decrit les pertes dielectriques par une conductivite kappa et non
    par une tangente de pertes : kappa = 2.pi.f.eps0.er.tan(delta). Elle est
    donc JUSTE A UNE SEULE FREQUENCE -- celle ou on la calcule. On prend le
    centre de la bande : c'est la ou la mesure compte, et l'erreur aux bords
    reste sous le pour-cent sur une bande etroite. Sur une bande large, le
    modele de Debye d'openEMS serait plus juste ; le script le dit pour que
    celui qui en a besoin sache par quoi remplacer la ligne.
    """
    return 2.0 * math.pi * f0 * EPS0 * er * df


def _bloc_debye(m, pertes):
    """Le passage par le XML de CSXCAD, ecrit DANS le script.

    POURQUOI IL FAUT EN PASSER PAR LA. openEMS sait simuler un dielectrique
    de Debye -- son moteur porte une « Drude/Lorentz Dispersive Material
    Extension » -- mais les liaisons Python de CSXCAD 0.6.3 n'exposent AUCUN
    materiau dispersif : il n'y a pas de classe pour lui, et
    `AddMaterial(eps_Delta=...)` repond « unknown material property ». Le seul
    chemin est le format de fichier : on ecrit la structure, on convertit le
    <Material> en <DebyeMaterial>, et on la relit.

    DEUX PIEGES, TOUS DEUX CONTOURNES ICI :

      1. la relecture se fait DANS LE MEME OBJET CSX. Creer un second objet et
         le passer a FDTD.SetCSX() laisse deux proprietaires pour une seule
         structure C++, et l'interpreteur tombe en faute de segmentation a la
         fermeture ;
      2. les poles sont des ATTRIBUTS de l'element <Property> deja present,
         nommes EpsilonDelta_p / EpsilonRelaxTime_p, et non un element a part.
         Mal places, ils sont lus comme des zeros : le solveur annonce alors
         « debye relaxation time is to small, skipping » et le materiau
         ressort SANS PERTES, sans que rien d'autre ne le signale.
    """
    t = []
    a = t.append
    a("\n# --- pertes de Debye : conversion par le XML de CSXCAD ---------------\n")
    a("# (voir l'explication complete dans openems_script.py)\n")
    a("import xml.etree.ElementTree as _ET\n\n")
    a("_POLES = {\n")
    for d in m["dielectriques"]:
        j = d.get("debye")
        if not j:
            continue
        a("    '%s': {'eps_inf': %.8f, 'poles': [\n" % (_ident(d["nom"], "die"),
                                                        j["eps_inf"]))
        for p in j["poles"]:
            a("        (%.8e, %.8e),\n" % (p["de"], p["tau"]))
        a("    ]},   # %s : tan d tenu a %.2f %% pres sur la bande\n"
          % (d["nom"], j["ecart_tand_pc"]))
    a("}\n\n")
    a("def _en_debye(chemin):\n")
    a("    arbre = _ET.parse(chemin)\n")
    a("    convertis = []\n")
    a("    for props in arbre.getroot().iter('Properties'):\n")
    a("        for mat in list(props):\n")
    a("            jeu = _POLES.get(mat.get('Name'))\n")
    a("            if mat.tag != 'Material' or jeu is None:\n")
    a("                continue\n")
    a("            mat.tag = 'DebyeMaterial'\n")
    a("            prop = mat.find('Property')\n")
    a("            poids = mat.find('Weight')\n")
    a("            # eps_inf remplace eps_r : le reste vient des poles.\n")
    a("            prop.set('Epsilon', '%.8e,%.8e,%.8e'\n")
    a("                     % ((jeu['eps_inf'],) * 3))\n")
    a("            # kappa ne doit PAS s'ajouter aux poles, sinon les pertes\n")
    a("            # sont comptees deux fois.\n")
    a("            prop.set('Kappa', '0,0,0')\n")
    a("            for i, (de, tau) in enumerate(jeu['poles'], 1):\n")
    a("                prop.set('EpsilonDelta_%d' % i, '%.8e,%.8e,%.8e' % ((de,) * 3))\n")
    a("                prop.set('EpsilonRelaxTime_%d' % i,\n")
    a("                         '%.8e,%.8e,%.8e' % ((tau,) * 3))\n")
    a("                if poids is not None:\n")
    a("                    poids.set('EpsilonDelta_%d' % i, '1,1,1')\n")
    a("                    poids.set('EpsilonRelaxTime_%d' % i, '1,1,1')\n")
    a("            convertis.append(mat.get('Name'))\n")
    a("    arbre.write(chemin, encoding='utf-8', xml_declaration=True)\n")
    a("    return convertis\n\n")
    a("_xml = os.path.join(dossier, 'antenne.xml')\n")
    a("print('Debye : materiaux convertis ->', _en_debye(_xml))\n")
    a("CSX.ReadFromXML(_xml)          # EN PLACE : un seul proprietaire\n")
    a("print('Debye : %d propriete(s), %d primitive(s) apres relecture'\n")
    a("      % (CSX.GetQtyProperties(), CSX.GetQtyPrimitives()))\n")
    a("# Le solveur doit annoncer « Drude/Lorentz Dispersive Material\n")
    a("# Extension » avec des « Active cells » NON NULLES. A zero, les poles\n")
    a("# ont ete sautes et le substrat est sans pertes.\n\n")
    return "".join(t)


def generer(m, chemin_openems=None, dossier_sim=None):
    """Modele normalise -> texte du script. Rien n'est ecrit sur le disque."""
    b = m["bande"]
    box = m["boite"]
    est = m["estimation"]
    res = m["resolution"]
    port = m["port"]
    maille = m["maillage"]

    candidats = []
    if chemin_openems:
        candidats.append("        r%r," % chemin_openems)
    candidats.extend([
        '        os.path.join(_ici, "openEMS"),',
        '        os.path.join(_ici, "openems"),',
        '        os.path.join(_ici, "..", "openEMS"),',
        '        os.path.join(_ici, "..", "openems"),',
        '        os.path.join(_ici, "..", "..", "openEMS"),',
        '        os.path.join(_ici, "..", "..", "openems"),',
        '        os.path.join(os.getcwd(), "openEMS"),',
        '        os.path.join(os.getcwd(), "openems"),',
        '        os.environ.get("OPENEMS_DLL", ""),',
        '        r"C:\\openEMS",',
        '        r"C:\\openems",',
    ])
    liste_candidats = "\n".join(candidats)

    dll = (
        "# Les DLL d'openEMS ne sont pas dans le PATH de cet environnement :\n"
        "# sans cette recherche, « import CSXCAD » echoue sur un\n"
        "# « DLL load failed » qui ne dit pas lequel manque.\n"
        "# Recherche automatique : dossier d'origine, relatif au script, ou OPENEMS_DLL.\n"
        "if hasattr(os, \"add_dll_directory\"):\n"
        "    _ici = os.path.dirname(os.path.abspath(__file__)) if \"__file__\" in locals() else os.getcwd()\n"
        "    _candidats = [\n"
        "%s\n"
        "    ]\n"
        "    for _d in _candidats:\n"
        "        if _d and os.path.isdir(_d) and os.path.isfile(os.path.join(_d, \"CSXCAD.dll\")):\n"
        "            try:\n"
        "                os.add_dll_directory(os.path.realpath(_d))\n"
        "                break\n"
        "            except OSError:\n"
        "                pass\n"
        "    else:\n"
        "        for _d in _candidats:\n"
        "            if _d and os.path.isdir(_d):\n"
        "                try:\n"
        "                    os.add_dll_directory(os.path.realpath(_d))\n"
        "                    break\n"
        "                except OSError:\n"
        "                    pass\n\n"
        % liste_candidats
    )

    sim = dossier_sim or os.path.join("~", "openems_antenne")

    t = []
    a = t.append

    a('#!/usr/bin/python3\n')
    a('# -*- coding: utf-8 -*-\n')
    a('"""Simulation openEMS — %s\n\n' % (m["nom"] or "antenne"))
    a("Script produit par l'outil « Antenne openEMS » a partir d'un fichier\n")
    a("IPC-2581. Il est autonome : il ne depend ni du serveur, ni de la page\n")
    a("qui l'a produit. Tout ce que l'assistant a choisi est ecrit en clair\n")
    a("ci-dessous, avec la raison du choix.\n\n")
    a("Bande simulee    : %.4g a %.4g GHz (%d points)\n"
      % (b["f1"] / 1e9, b["f2"] / 1e9, b["n"]))
    a("Impulsion        : f0 = %.4g GHz, fc = %.4g GHz\n"
      % (b["f0"] / 1e9, b["fc"] / 1e9))
    a("Maillage         : %d x %d x %d lignes, %s cellules\n"
      % (est["lignes"][0], est["lignes"][1], est["lignes"][2],
         "{:,}".format(est["cellules"]).replace(",", " ")))
    a("Memoire estimee  : %.0f Mo\n" % est["memoire_Mo"])
    a('"""\n\n')

    a("import os\n")
    a("import numpy as np\n\n")
    a(dll)
    a("from CSXCAD import ContinuousStructure\n")
    a("from openEMS import openEMS\n\n")

    a("# --------------------------------------------------------------------\n")
    a("# 0. Reglages\n")
    a("# --------------------------------------------------------------------\n")
    a("unit      = 1e-3          # toutes les cotes ci-dessous sont en millimetres\n")
    a("f0        = %.6e     # centre de l'impulsion gaussienne, Hz\n" % b["f0"])
    a("fc        = %.6e     # demi-largeur : elle couvre [f0-fc, f0+fc]\n" % b["fc"])
    a("f_debut   = %.6e\n" % b["f1"])
    a("f_fin     = %.6e\n" % b["f2"])
    a("n_points  = %d\n" % b["n"])
    a("\n")
    a("# LE `realpath` N'EST PAS UNE COQUETTERIE. openEMS 0.0.36 se place dans\n")
    a("# le dossier de calcul puis verifie son travail par\n")
    a("#     assert os.getcwd() == os.path.realpath(sim_path)\n")
    a("# Sur Windows, TEMP vaut souvent le nom court 8.3 du profil\n")
    a("# (« PIERRE~1.REN ») : os.getcwd() rend alors ce nom court, realpath le\n")
    a("# nom long, et l'assertion tombe sur une AssertionError nue, sans\n")
    a("# message, avant meme que la simulation ne commence.\n")
    a("dossier   = os.path.realpath(os.path.expanduser(r%r))\n\n" % sim)

    a("# --------------------------------------------------------------------\n")
    a("# 1. Le solveur\n")
    a("# --------------------------------------------------------------------\n")
    a("# EndCriteria : la simulation s'arrete quand l'energie residuelle dans\n")
    a("# la boite est tombee de %.0f dB. C'est ce critere, et non le nombre de\n"
      % abs(m["arret"]["energie_dB"]))
    a("# pas, qui decide en pratique — NrTS n'est qu'un garde-fou.\n")
    a("FDTD = openEMS(NrTS=%d, EndCriteria=%.3e)\n"
      % (m["arret"]["nmax"], 10.0 ** (m["arret"]["energie_dB"] / 10.0)))
    a("FDTD.SetGaussExcite(f0, fc)\n")
    a("# PML_%d sur les six faces : la boite rayonne dans l'espace libre.\n"
      % box["pml"])
    a("FDTD.SetBoundaryCond(['PML_%d'] * 6)\n\n" % box["pml"])

    a("CSX  = ContinuousStructure()\n")
    a("FDTD.SetCSX(CSX)\n")
    a("mesh = CSX.GetGrid()\n")
    a("mesh.SetDeltaUnit(unit)\n\n")

    pertes = m.get("pertes") or {"mode": "kappa", "f_kappa": b["f0"]}
    a("# --------------------------------------------------------------------\n")
    a("# 2. Le substrat\n")
    a("# --------------------------------------------------------------------\n")
    if pertes.get("actif"):
        a("# Les pertes sont decrites par un jeu de POLES DE DEBYE (etape 9),\n")
        a("# qui tient tan(delta) a peu pres constant sur toute la bande. Le\n")
        a("# materiau est pose ici en dielectrique ordinaire ; il sera converti\n")
        a("# plus bas, parce que les liaisons Python ne savent pas le\n")
        a("# construire directement.\n")
    else:
        a("# openEMS ne connait pas la tangente de pertes : il veut une\n")
        a("# conductivite kappa = 2.pi.f.eps0.er.tan(delta), donc JUSTE A UNE\n")
        a("# SEULE FREQUENCE -- celle ou on la calcule. Ailleurs tan(delta)\n")
        a("# varie comme 1/f, alors qu'un stratifie reel le garde a peu pres\n")
        a("# constant : aux bords de la bande, l'ecart atteint %.0f %%.\n"
          % pertes.get("ecart_kappa_pc", 0.0))
    for i, d in enumerate(m["dielectriques"]):
        nom = _ident(d["nom"], "die")
        k = d.get("kappa")
        if k is None:
            k = _kappa(d["er"], d["df"], pertes.get("f_kappa") or b["f0"])
        a("sub_%d = CSX.AddMaterial('%s', epsilon=%s, kappa=%.6e)"
          "   # %s, tan d = %s a %.4g GHz\n"
          % (i, nom, _f(d["er"], 4), k, d["nom"], _f(d["df"], 5),
             (pertes.get("f_kappa") or b["f0"]) / 1e9))
        a("sub_%d.AddBox([%s, %s, %s], [%s, %s, %s], priority=1)\n"
          % (i,
             _f(m["boite_cuivre"][0]), _f(m["boite_cuivre"][1]), _f(d["z0"]),
             _f(m["boite_cuivre"][2]), _f(m["boite_cuivre"][3]), _f(d["z1"])))
    a("\n")

    mode = m.get("modele_cuivre", "feuille")
    a("# --------------------------------------------------------------------\n")
    a("# 3. Le cuivre\n")
    a("# --------------------------------------------------------------------\n")
    if mode == "volume":
        a("# MODE « VOLUME » : le cuivre est extrude sur son epaisseur reelle.\n")
        a("# C'est le plus fidele et de loin le plus cher — l'epaisseur entre\n")
        a("# dans le maillage et commande le pas de temps de tout le domaine.\n")
    elif mode == "pec":
        a("# MODE « PEC » : conducteur parfait, surface sans epaisseur. Aucune\n")
        a("# perte ohmique — le rendement en ressort surestime.\n")
    else:
        a("# MODE « FEUILLE » : surface sans epaisseur qui porte quand meme la\n")
        a("# resistance du cuivre reel (AddConductingSheet). A 2,4 GHz\n")
        a("# l'epaisseur de peau fait 1,3 micron : le courant ne voit pas les\n")
        a("# 35 microns de la couche, mais il voit sa resistance. On gagne le\n")
        a("# maillage de l'epaisseur sans perdre les pertes.\n")
    a("#\n")
    a("# Les DECOUPES d'un versement (les trous d'un plan de masse) ne sont pas\n")
    a("# portees par le polygone : elles sont redessinees ensuite avec le\n")
    a("# materiau du substrat a une priorite PLUS HAUTE. C'est ainsi que\n")
    a("# CSXCAD fait des trous — la priorite tranche, pas l'ordre d'ajout.\n")
    n_trou = 0
    for bloc in m["cuivre"]:
        nom = _ident(bloc["couche"], "cu")
        if mode == "volume":
            a("\ncu_%s = CSX.AddMetal('cu_%s')\n" % (nom, nom))
        elif mode == "pec":
            a("\ncu_%s = CSX.AddMetal('cu_%s')\n" % (nom, nom))
        else:
            a("\ncu_%s = CSX.AddConductingSheet('cu_%s', conductivity=%.4g,\n"
              "                                 thickness=%.6e)"
              "   # %s mm de cuivre\n"
              % (nom, nom, bloc.get("sigma", 5.8e7), bloc["ep"] * 1e-3,
                 _f(bloc["ep"], 4)))

        # 1. Les versements portant des decoupes (plans de masse) a priorite 10.
        for poly in bloc["polys"]:
            if poly.get("t"):
                if mode == "volume":
                    a("cu_%s.AddLinPoly(%s, 'z', %s, %s, priority=10)\n"
                      % (nom, _poly(poly["o"]), _f(bloc["z0"]),
                         _f(bloc.get("ep_geo") or bloc["ep"])))
                else:
                    a("cu_%s.AddPolygon(%s, 'z', %s, priority=10)\n"
                      % (nom, _poly(poly["o"]), _f(bloc["z0"])))

        # 2. Les decoupes dans ces versements a priorite 11 (remplies de dielectrique).
        for poly in bloc["polys"]:
            for trou in poly.get("t", ()):
                # Le trou est rempli par le dielectrique qui se trouve juste
                # sous la couche ; a defaut, de l'air.
                sous = None
                for i, d in enumerate(m["dielectriques"]):
                    if abs(d["z1"] - bloc["z0"]) < 1e-9:
                        sous = i
                        break
                cible = ("sub_%d" % sous) if sous is not None else "air_trou"
                if sous is None and n_trou == 0:
                    a("air_trou = CSX.AddMaterial('air_trou', epsilon=1.0)\n")
                if mode == "volume":
                    a("%s.AddLinPoly(%s, 'z', %s, %s, priority=11)"
                      "   # decoupe\n"
                      % (cible, _poly(trou), _f(bloc["z0"]),
                         _f(bloc.get("ep_geo") or bloc["ep"])))
                else:
                    a("%s.AddPolygon(%s, 'z', %s, priority=11)"
                      "   # decoupe\n"
                      % (cible, _poly(trou), _f(bloc["z0"])))
                n_trou += 1

        # 3. Les conducteurs sans decoupe (pistes de signal, brins d'antenne, pastilles)
        # a priorite 12. Ils passent PAR-DESSUS les decoupes pour ne pas etre
        # effaces par une encoche d'isolation ou un degagement de plan de masse.
        for poly in bloc["polys"]:
            if not poly.get("t"):
                if mode == "volume":
                    a("cu_%s.AddLinPoly(%s, 'z', %s, %s, priority=12)\n"
                      % (nom, _poly(poly["o"]), _f(bloc["z0"]),
                         _f(bloc.get("ep_geo") or bloc["ep"])))
                else:
                    a("cu_%s.AddPolygon(%s, 'z', %s, priority=12)\n"
                      % (nom, _poly(poly["o"]), _f(bloc["z0"])))
    a("\n")

    if m["vias"]:
        a("# --------------------------------------------------------------------\n")
        a("# 4. Les vias\n")
        a("# --------------------------------------------------------------------\n")
        a("# Cylindres PLEINS et non tubes creux : a ces frequences l'epaisseur\n")
        a("# de peau fait quelques microns, le courant ne voit pas la\n")
        a("# difference, et un tube demanderait deux cellules dans la\n")
        a("# metallisation — un maillage dix fois plus fin pour rien.\n")
        a("vias = CSX.AddMetal('vias')\n")
        for v in m["vias"]:
            a("vias.AddCylinder([%s, %s, %s], [%s, %s, %s], %s, priority=13)\n"
              % (_f(v["x"]), _f(v["y"]), _f(v["z0"]),
                 _f(v["x"]), _f(v["y"]), _f(v["z1"]), _f(v["r"])))
        a("\n")

    if m.get("primitives"):
        a("# --------------------------------------------------------------------\n")
        a("# 4bis. Les objets qui ne sont pas sur la carte\n")
        a("# --------------------------------------------------------------------\n")
        a("# Une antenne ne rayonne jamais toute seule : elle est dans un\n")
        a("# boitier, au-dessus d'une batterie, au bout d'un cable. Le fichier\n")
        a("# IPC-2581 ne dit rien de tout cela — il decrit une carte, pas un\n")
        a("# produit — et ces objets-la comblent le trou.\n")
        a("#\n")
        a("# Le metal est ici un CONDUCTEUR PARFAIT. Un boitier en volume avec\n")
        a("# une conductivite finie demanderait de mailler l'epaisseur de peau,\n")
        a("# soit quelques microns : hors de portee, et sans interet — la\n")
        a("# difference sur un blindage se compte en centiemes de decibel.\n")
        for i, o in enumerate(m["primitives"]):
            nom = _ident(o["nom"], "obj")
            v = "obj_%d" % i
            if o["materiau"] == "metal":
                a("\n%s = CSX.AddMetal('%s')   # %s\n" % (v, nom, o["nom"]))
            else:
                k = _kappa(o["er"], o["df"], b["f0"])
                a("\n%s = CSX.AddMaterial('%s', epsilon=%s, kappa=%.6e)"
                  "   # %s\n" % (v, nom, _f(o["er"], 4), k, o["nom"]))
            pr = o["priorite"]
            if o["type"] == "fil":
                a("%s.AddWire([\n" % v)
                for axe in range(3):
                    a("    %s,\n" % _liste([q[axe] for q in o["pts"]], 5, 8, 8))
                a("    ], %s, priority=%d)\n" % (_f(o["r"]), pr))
            elif o["type"] == "cylindre":
                a("%s.AddCylinder([%s, %s, %s], [%s, %s, %s], %s, priority=%d)\n"
                  % (v, _f(o["a"][0]), _f(o["a"][1]), _f(o["a"][2]),
                     _f(o["b"][0]), _f(o["b"][1]), _f(o["b"][2]),
                     _f(o["r"]), pr))
            elif o["type"] == "boite":
                a("%s.AddBox([%s, %s, %s], [%s, %s, %s], priority=%d)\n"
                  % (v, _f(o["a"][0]), _f(o["a"][1]), _f(o["a"][2]),
                     _f(o["b"][0]), _f(o["b"][1]), _f(o["b"][2]), pr))
            else:
                a("%s.AddSphere([%s, %s, %s], %s, priority=%d)\n"
                  % (v, _f(o["c"][0]), _f(o["c"][1]), _f(o["c"][2]),
                     _f(o["r"]), pr))
        a("\n")

    a("# --------------------------------------------------------------------\n")
    a("# 5. Le maillage\n")
    a("# --------------------------------------------------------------------\n")
    a("# Pas vise : %s mm dans l'air, %s mm dans le dielectrique — vingt\n"
      % (_f(res["air"], 4), _f(res["die"], 4)))
    a("# cellules par longueur d'onde a %.4g GHz, divisees par racine(er)\n"
      % (b["f2"] / 1e9))
    a("# la ou la vitesse est plus faible (er max = %s).\n" % _f(res["er_max"], 3))
    a("# Marge : %s mm au plus court, dont %s mm de PML (%d cellules) — il\n"
      % (_f(min(box["mx"], box["my"], box["mz_haut"], box["mz_bas"]), 3),
         _f(box.get("ep_pml", 0), 3), box["pml"]))
    a("# reste %s mm d'air physique entre l'antenne et l'absorbeur, pour %s\n"
      % (_f(box.get("air_restant", 0), 3), _f(box.get("air_utile", 0), 3)))
    a("# conseilles (lambda/4 a %.4g GHz)%s.\n"
      % (b["f1"] / 1e9,
         "" if box["marge_suffisante"] else " — C'EST INSUFFISANT"))
    a("mesh.SetLines('x', np.array(%s))\n" % _liste(maille["x"], 5, 8, 4))
    a("mesh.SetLines('y', np.array(%s))\n" % _liste(maille["y"], 5, 8, 4))
    a("mesh.SetLines('z', np.array(%s))\n" % _liste(maille["z"], 5, 8, 4))
    if m["maillage_tiers"]:
        a("\n# La regle du tiers : au bord d'un conducteur la ligne ne se pose\n")
        a("# pas SUR l'arete mais a un tiers dehors, deux tiers dedans. C'est\n")
        a("# ce qui rend la densite de courant de bord correcte sans raffiner\n")
        a("# partout ailleurs.\n")
        a("FDTD.AddEdges2Grid(dirs='xy', properties=[%s], metal_edge_res=%s)\n"
          % (", ".join("cu_%s" % _ident(c["couche"], "cu") for c in m["cuivre"]),
             _f(res["die"] / 2.0, 5)))
    a("\n")

    a(_bloc_ports(m))

    if m["nf2ff"]["actif"]:
        a("# --------------------------------------------------------------------\n")
        a("# 7. La boite de champ lointain\n")
        a("# --------------------------------------------------------------------\n")
        a("# Elle enregistre le champ tangentiel sur une surface fermee autour\n")
        a("# de l'antenne ; le diagramme de rayonnement s'en deduit apres coup\n")
        a("# par transformation champ proche / champ lointain. Elle doit etre\n")
        a("# DANS la boite de calcul mais HORS de la PML, sinon elle integre\n")
        a("# un champ deja absorbe.\n")
        a("nf2ff = FDTD.CreateNF2FFBox()\n\n")

    a(_bloc_dumps(m))

    a("# --------------------------------------------------------------------\n")
    a("# 8. Calcul\n")
    a("# --------------------------------------------------------------------\n")
    a("if not os.path.isdir(dossier):\n")
    a("    os.makedirs(dossier)\n")
    a("CSX.Write2XML(os.path.join(dossier, 'antenne.xml'))\n")
    if pertes.get("actif"):
        a(_bloc_debye(m, pertes))
    a("FDTD.Run(dossier, verbose=3, cleanup=False)\n\n")

    a("# --------------------------------------------------------------------\n")
    a("# 9. Depouillement\n")
    a("# --------------------------------------------------------------------\n")
    a("f = np.linspace(f_debut, f_fin, n_points)\n")
    a(_bloc_calcport(m))
    a("s11 = port.uf_ref / port.uf_inc\n")
    a("Zin = port.uf_tot / port.if_tot\n")
    if len(m["ports"]) > 1:
        a("# LES COUPLAGES. S(j,%d) = ce qui RESSORT du port j divise par ce qui\n"
          % port["n"])
        a("# ENTRE par le port %d. Le denominateur est donc toujours celui du\n"
          % port["n"])
        a("# port excite : un S21 rapporte a l'onde incidente du port 2 — qui\n")
        a("# est nulle, puisqu'il n'excite pas — ne serait qu'une division par\n")
        a("# du bruit numerique.\n")
        a("couplages = {}\n")
        for q in m["ports"]:
            if q["n"] == port["n"]:
                continue
            a("couplages[%d] = ports[%d].uf_ref / port.uf_inc\n"
              % (q["n"], q["n"] - 1))
    a("# |S11| depasse 1 aux bords de la bande, la ou l'impulsion n'a presque\n")
    a("# plus d'energie : le rapport de deux nombres minuscules n'y a plus de\n")
    a("# sens. Sans la saturation, le ROE y ressort negatif — une valeur qui\n")
    a("# n'existe pas et qu'on lirait pourtant dans le tableau.\n")
    a("vswr = (1 + np.clip(np.abs(s11), 0, 0.999999)) \\\n")
    a("     / (1 - np.clip(np.abs(s11), 0, 0.999999))\n\n")
    a("for i in range(0, n_points, max(1, n_points // 20)):\n")
    a("    print('%9.4f GHz   S11 %7.2f dB   Z %7.2f %+7.2fj   VSWR %5.2f'\n")
    a("          % (f[i] / 1e9, 20 * np.log10(np.abs(s11[i])),\n")
    a("             Zin[i].real, Zin[i].imag, vswr[i]))\n\n")
    a("i0 = int(np.argmin(np.abs(s11)))\n")
    a("print()\n")
    a("print('Resonance : %.4f GHz, S11 = %.2f dB, Z = %.1f %+.1fj ohms'\n")
    a("      % (f[i0] / 1e9, 20 * np.log10(np.abs(s11[i0])),\n")
    a("         Zin[i0].real, Zin[i0].imag))\n")
    a(_bloc_ligne(m))
    if len(m["ports"]) > 1:
        a("for _n, _s in sorted(couplages.items()):\n")
        a("    print('S%%d%d       : %%.2f dB a la resonance, %%.2f dB au pire'\n"
          % port["n"])
        a("          % (_n, 20 * np.log10(max(abs(_s[i0]), 1e-12)),\n")
        a("             20 * np.log10(max(np.max(np.abs(_s)), 1e-12))))\n")

    if m["nf2ff"]["actif"]:
        a("\n# Le champ lointain a la resonance.\n")
        a("theta = np.array(%s)\n" % _liste(m["nf2ff"]["theta"], 2, 12, 4))
        a("phi   = np.array(%s)\n" % _liste(m["nf2ff"]["phi"], 2, 12, 4))
        a("# LE CENTRE DE PHASE EST EN METRES, pas dans l'unite de dessin.\n")
        a("# CalcNF2FF le passe tel quel au noyau C++, a cote d'un rayon qui\n")
        a("# vaut 1 metre par defaut. Un centre donne en millimetres place le\n")
        a("# point de phase a des dizaines de metres, hors de la boite\n")
        a("# d'enregistrement — et la directivite ressort « nan », sans la\n")
        a("# moindre erreur pour le dire.\n")
        a("centre = np.array([%s, %s, %s]) * unit\n"
          % (_f((m["boite_cuivre"][0] + m["boite_cuivre"][2]) / 2.0),
             _f((m["boite_cuivre"][1] + m["boite_cuivre"][3]) / 2.0),
             _f(m["z_haut"] / 2.0)))
        a("res_nf = nf2ff.CalcNF2FF(dossier, f[i0], theta, phi, center=centre)\n")
        a("\n# LA PUISSANCE ACCEPTEE PAR L'ANTENNE, et non 0.5.Re(V.I*) : le\n")
        a("# signe de cette derniere depend du sens de reference du courant du\n")
        a("# port, et un rendement negatif n'apprend rien a personne. Ce qui\n")
        a("# entre vraiment, c'est l'incidente moins la reflechie.\n")
        a("p_inc = abs(0.5 * np.real(port.uf_inc[i0] * np.conj(port.if_inc[i0])))\n")
        a("p_acc = p_inc * (1 - abs(s11[i0]) ** 2)\n")
        a("print('Directivite : %.2f dBi' % (10 * np.log10(res_nf.Dmax[0])))\n")
        a("if p_acc > 0:\n")
        a("    print('Rendement   : %.1f %%' % (100 * res_nf.Prad[0] / p_acc))\n")
        a("    print('Gain        : %.2f dBi'\n")
        a("          % (10 * np.log10(res_nf.Dmax[0] * res_nf.Prad[0] / p_acc)))\n")

    return "".join(t)


def _die_contre(m, z, tol=1e-9):
    """L'indice du dielectrique dont une face touche la cote z, ou None.

    Sert aux DEGAGEMENTS du coaxial comme aux decoupes d'un versement : un
    trou dans du cuivre se fait en redessinant la matiere qui l'entoure a une
    priorite plus haute, et cette matiere-la est le substrat voisin.
    """
    for i, d in enumerate(m["dielectriques"]):
        if abs(d["z1"] - z) < tol or abs(d["z0"] - z) < tol:
            return i
    return None


# Le prologue du port coaxial : une classe, ecrite une seule fois, quel que
# soit le nombre de connecteurs. Elle est POSEE DANS LE SCRIPT et non importee
# d'openEMS, parce qu'elle n'y existe pas -- c'est tout l'objet du commentaire.
COAX_CLASSE = '''
# --------------------------------------------------------------------
# La classe qui manque aux liaisons Python : le port coaxial
# --------------------------------------------------------------------
# `AddCoaxialPort` existe dans l'interface MATLAB d'openEMS. Dans les liaisons
# Python 0.0.36, openEMS/ports.py ne definit que LumpedPort, MSLPort,
# WaveguidePort et RectWGPort -- pas de coaxial. On le construit donc ici sur
# la classe `Port` de base, qui sait deja tout faire a partir d'une tension et
# d'un courant : la decomposition en onde incidente et onde reflechie, le
# deport de plan de reference, les puissances.
#
# CE QU'UN PORT LOCALISE NE PEUT PAS FAIRE ICI, et c'est la raison d'etre de
# cette classe : sa sonde de courant est un segment pose dans le plan
# PERPENDICULAIRE a l'excitation. Pour une excitation radiale, ce plan
# contient l'axe du cable -- la sonde ne peut par construction pas encercler
# l'ame, le courant axial ne traverse jamais sa surface, et l'impedance rendue
# n'a aucun rapport avec celle de la ligne. Il faut une BOUCLE FERMEE autour
# de l'ame, dans un plan perpendiculaire a l'axe : c'est ce que fait
# `AddProbe(p_type=1, norm_dir=2)` sur une boite carree centree sur l'ame.
#
# DEUX BOUCLES ET NON UNE. Dans une grille de Yee, E et H ne sont ni au meme
# endroit ni au meme instant : les composantes de H vivent une demi-cellule
# plus loin que celles de E. Mesurer U et I sur le meme plan nominal revient
# donc a les mesurer a une demi-cellule l'un de l'autre, et l'impedance en
# ressort biaisee de la moitie d'une cellule de ligne. On encadre donc le plan
# de tension par deux boucles de courant et on en prend la moyenne -- c'est
# ce que fait MSLPort, pour la meme raison.
from openEMS.ports import Port, UI_data


class PortCoaxial(Port):
    """Un port coaxial : tension radiale, courant en boucle, Z0 analytique."""

    def __init__(self, CSX, port_nr, x, y, ra, rb, rm, er, Z0,
                 z_source, z_mesure, z_lignes, sens, excite=0, priority=50):
        # `start`/`stop` : le bras +x de la croix. La classe de base ne s'en
        # sert que pour nommer et situer le port.
        super(PortCoaxial, self).__init__(
            CSX, port_nr=port_nr,
            start=[x + ra, y - ra, z_source], stop=[x + rb, y + ra, z_source],
            excite=excite)
        self.Z_ref = Z0
        self.er = er
        self.measplane_shift = 0.0

        # -- la croix : quatre bras radiaux ---------------------------------
        # Le mode TEM d'un coaxial a un champ E radial, continu sur toute la
        # couronne. Quatre bras ne le reproduisent pas exactement, et cela n'a
        # pas d'importance : le premier mode superieur d'une SMA coupe vers
        # 25 GHz, tout ce qui n'est pas TEM est donc evanescent et meurt en
        # quelques cellules -- bien avant le plan de mesure.
        bras = [(0, +1, [x + ra, y - ra, z_source], [x + rb, y + ra, z_source]),
                (0, -1, [x - rb, y - ra, z_source], [x - ra, y + ra, z_source]),
                (1, +1, [x - ra, y + ra, z_source], [x + ra, y + rb, z_source]),
                (1, -1, [x - ra, y - rb, z_source], [x + ra, y - ra, z_source])]
        for k, (ny, signe, deb, fin) in enumerate(bras):
            # Quatre resistances de 4.Z0 en parallele font Z0 : le port est
            # ferme sur sa propre impedance, qu'il excite ou non. Un port qui
            # n'est pas ferme sur Z0 renvoie ce qu'il recoit, et le S21 des
            # AUTRES ports s'en trouve faux -- les parametres S se definissent
            # tous les autres ports adaptes.
            res = CSX.AddLumpedElement('%s_r%d' % (self.lbl_temp.format('coax'), k),
                                       ny=ny, caps=True, R=4.0 * Z0)
            res.AddBox(deb, fin, priority=priority)
            if excite != 0:
                vec = [0, 0, 0]
                vec[ny] = signe * excite
                exc = CSX.AddExcitation('%s_e%d' % (self.lbl_temp.format('coax'), k),
                                        exc_type=0, exc_val=vec)
                exc.AddBox(deb, fin, priority=priority)

        # -- le plan de mesure, pose sur une ligne de maillage --------------
        z_lignes = np.array(z_lignes)
        i = int(np.argmin(np.abs(z_lignes - z_mesure)))
        i = min(max(i, 1), len(z_lignes) - 2)
        z_u = float(z_lignes[i])
        z_i = [0.5 * (z_lignes[i - 1] + z_lignes[i]),
               0.5 * (z_lignes[i] + z_lignes[i + 1])]
        self.z_mesure = z_u

        # La TENSION : E integre le long d'un rayon, de l'ame vers la gaine.
        # Positive quand l'ame est au potentiel haut, comme sur un cable.
        self.U_filenames = [self.lbl_temp.format('ut')]
        sonde = CSX.AddProbe(self.U_filenames[0], p_type=0, weight=1)
        sonde.AddBox([x + ra, y, z_u], [x + rb, y, z_u])

        # Le COURANT : H integre sur une boucle fermee autour de l'ame, une de
        # chaque cote du plan de tension. `sens` pointe vers l'exterieur de la
        # carte ; le courant est compte positif vers la carte, c'est-a-dire
        # dans le sens de propagation de l'onde incidente.
        self.I_filenames = []
        for k, z in enumerate(z_i):
            nom = self.lbl_temp.format('it') + 'AB'[k]
            self.I_filenames.append(nom)
            sonde = CSX.AddProbe(nom, p_type=1, weight=-sens, norm_dir=2)
            sonde.AddBox([x - rm, y - rm, float(z)], [x + rm, y + rm, float(z)])

    def ReadUIData(self, sim_path, freq, signal_type='pulse'):
        """Une tension, deux courants moyennes. La classe de base ne sait pas
        faire cette moyenne : elle somme les fichiers de courant sur le nombre
        de fichiers de TENSION, et s'arreterait donc au premier."""
        u = UI_data(self.U_filenames, sim_path, freq, signal_type)
        self.uf_tot = u.ui_f_val[0]
        self.ut_tot = u.ui_val[0]
        i = UI_data(self.I_filenames, sim_path, freq, signal_type)
        self.if_tot = 0.5 * (i.ui_f_val[0] + i.ui_f_val[1])
        self.it_tot = 0.5 * (i.ui_val[0] + i.ui_val[1])
        # La constante de propagation du mode TEM : exacte, et sans
        # dispersion. C'est elle qui permet de ramener le plan de reference du
        # milieu du troncon a la surface de la carte.
        self.beta = 2 * np.pi * np.array(freq) * np.sqrt(self.er) / 2.99792458e8

'''


def _bloc_ports(m):
    """Les ports : la geometrie des connecteurs, puis les sources.

    UN SEUL PORT EXCITE, ET C'EST UNE DEFINITION AVANT D'ETRE UN REGLAGE.
    S(j,i) vaut « ce qui sort en j quand SEUL i excite » : deux excitations
    simultanees superposeraient leurs ondes dans la boite et aucun parametre S
    ne se deduirait du melange. Les autres ports sont donc poses en CHARGE :
    fermes sur leur impedance, ils absorbent ce qui leur arrive et le
    mesurent. C'est exactement ce qu'est un analyseur de reseau a un port
    charge : cinquante ohms et un voltmetre.
    """
    t = []
    a = t.append
    ports = m["ports"]
    mode = m.get("modele_cuivre", "feuille")
    excite = next(p for p in ports if p["excite"])
    coaxiaux = [p for p in ports if p.get("coax")]

    a("# --------------------------------------------------------------------\n")
    a("# 6. %s\n" % ("Le port d'excitation" if len(ports) == 1
                     else "Les %d ports" % len(ports)))
    a("# --------------------------------------------------------------------\n")
    if len(ports) > 1:
        a("# Le port %d excite ; %s pose%s en charge, c'est-a-dire en\n"
          % (excite["n"],
             "l'autre est" if len(ports) == 2 else "les autres sont",
             "" if len(ports) == 2 else "s"))
        a("# recepteur. C'est de la que vient le S21 : ce qui ressort d'un port\n")
        a("# qui n'a rien emis est ce que l'autre lui a transmis, et aucun S11\n")
        a("# ne le dit.\n")
    if coaxiaux:
        a(COAX_CLASSE)

    air_pose = [False]

    def _air():
        if not air_pose[0]:
            a("coax_air = CSX.AddMaterial('coax_air', epsilon=1.0)\n")
            air_pose[0] = True
        return "coax_air"

    for p in ports:
        n = p["n"]
        c = p.get("coax")
        if not c:
            a("\n# -- port %d : element localise ---------------------------------\n"
              % n)
            a("# Une resistance de %s ohms repartie sur un petit volume, orientee\n"
              % _f(p["R"], 3))
            a("# selon %s — le sens du champ electrique a l'entree. Elle relie\n"
              % p["dir"])
            a("# « %s » a « %s ».\n" % (p["de"], p["a"]))
            a("port_%d = FDTD.AddLumpedPort(%d, %s, [%s, %s, %s], [%s, %s, %s],\n"
              "                            '%s', %s, priority=50)%s\n"
              % (n, n, _f(p["R"], 3),
                 _f(p["x1"]), _f(p["y1"]), _f(p["z1"]),
                 _f(p["x2"]), _f(p["y2"]), _f(p["z2"]), p["dir"],
                 "1.0" if p["excite"] else "0",
                 "" if p["excite"] else "   # en charge : il mesure, il n'emet pas"))
            continue

        ecart = 100.0 * abs(c["z0_ligne"] - p["R"]) / max(p["R"], 1e-9)
        a("\n# -- port %d : connecteur coaxial -------------------------------\n" % n)
        a("# Ame de %s mm de rayon, gaine de %s : Z0 = 60/racine(%s).ln(b/a)\n"
          % (_f(c["ra"], 4), _f(c["rb"], 4), _f(c["er"], 3)))
        a("#   = %s ohms, la ou le port est declare a %s ohms%s\n"
          % (_f(c["z0_ligne"], 2), _f(p["R"], 2),
             "." if ecart <= 5.0
             else " — SOIT %.0f %% D'ECART.\n"
                  "# Cet ecart-la n'est pas une erreur de calcul : c'est une\n"
                  "# desadaptation reelle, et elle se lira dans le S11 comme si\n"
                  "# elle venait de l'antenne." % ecart))
        a("# Troncon de %s mm. Les S sont ramenes a la SURFACE DE LA CARTE par\n"
          % _f(c["longueur"], 3))
        a("# un deport de plan de reference (voir le depouillement) : sans lui,\n")
        a("# le S11 tournerait sur l'abaque de Smith de toute la longueur du\n")
        a("# connecteur, et l'impedance lue ne serait pas celle de l'antenne.\n")
        a("coax_d%d = CSX.AddMaterial('coax_d%d', epsilon=%s)\n"
          % (n, n, _f(c["er"], 4)))
        a("coax_m%d = CSX.AddMetal('coax_m%d')\n" % (n, n))
        a("# Le dielectrique du cable d'abord, l'ame et la gaine par-dessus :\n")
        a("# c'est la priorite qui tranche, pas l'ordre d'ajout.\n")
        a("coax_d%d.AddCylinder([%s, %s, %s], [%s, %s, %s], %s, priority=4)\n"
          % (n, _f(p["x"]), _f(p["y"]), _f(c["z_bas"]),
             _f(p["x"]), _f(p["y"]), _f(c["z_gaine"]), _f(c["rb"])))
        a("coax_m%d.AddCylinder([%s, %s, %s], [%s, %s, %s], %s, priority=20)"
          "   # l'ame\n"
          % (n, _f(p["x"]), _f(p["y"]), _f(c["z_bas"]),
             _f(p["x"]), _f(p["y"]), _f(c["z_ame"]), _f(c["ra"])))
        a("coax_m%d.AddCylindricalShell([%s, %s, %s], [%s, %s, %s], %s, %s,\n"
          "                            priority=20)   # la gaine\n"
          % (n, _f(p["x"]), _f(p["y"]), _f(c["z_bas"]),
             _f(p["x"]), _f(p["y"]), _f(c["z_gaine"]),
             _f(c["rb"] + c["ep_gaine"] / 2.0), _f(c["ep_gaine"])))
        if c["degagements"]:
            a("# LES DEGAGEMENTS. Sans eux l'ame touche %s : le port est un\n"
              % " et ".join("« %s »" % d["couche"] for d in c["degagements"]))
            a("# court-circuit franc, le S11 vaut 0 dB sur toute la bande, et\n")
            a("# rien dans le resultat ne dit pourquoi.\n")
        for d in c["degagements"]:
            i = _die_contre(m, d["z0"])
            if i is None:
                i = _die_contre(m, d["z1"])
            cible = ("sub_%d" % i) if i is not None else _air()
            disque = _disque(p["x"], p["y"], d["r"])
            if mode == "volume":
                a("%s.AddLinPoly(%s, 'z', %s, %s, priority=11)"
                  "   # degagement dans %s\n"
                  % (cible, _poly(disque), _f(d["z0"]),
                     _f(d["z1"] - d["z0"]), d["couche"]))
            else:
                a("%s.AddPolygon(%s, 'z', %s, priority=11)"
                  "   # degagement dans %s\n"
                  % (cible, _poly(disque), _f(d["z0"]), d["couche"]))
        a("port_%d = PortCoaxial(CSX, %d, %s, %s, %s, %s, %s, %s, %s,\n"
          "                     z_source=%s, z_mesure=%s,\n"
          "                     z_lignes=mesh.GetLines('z'), sens=%s,\n"
          "                     excite=%s)%s\n"
          % (n, n, _f(p["x"]), _f(p["y"]), _f(c["ra"]), _f(c["rb"]),
             _f(c["rm"]), _f(c["er"], 4), _f(c["z0_ligne"], 4),
             _f(c["z_bas"]), _f(c["z_mes"]), _f(c["sens"], 1),
             "1.0" if p["excite"] else "0",
             "" if p["excite"] else "   # en charge : il mesure, il n'emet pas"))

    a("\n")
    a("ports = [%s]\n" % ", ".join("port_%d" % p["n"] for p in ports))
    a("port  = port_%d   # le port excite : c'est lui qui donne le S11\n"
      % excite["n"])
    a("\n")
    return "".join(t)


def _bloc_calcport(m):
    """L'appel qui depouille chaque port. Un coaxial demande deux choses de
    plus : son impedance de reference, qui est celle de la ligne et non 50
    ohms par convention, et le deport du plan de reference."""
    t = []
    a = t.append
    for p in m["ports"]:
        c = p.get("coax")
        if not c:
            a("port_%d.CalcPort(dossier, f)\n" % p["n"])
            continue
        a("# Le plan de mesure est a mi-troncon ; on le ramene a la surface de\n")
        a("# la carte, sur %s mm de ligne.\n" % _f(abs(c["z_mes"] - c["z_gaine"]), 4))
        a("port_%d.CalcPort(dossier, f, ref_impedance=%s,\n"
          "                ref_plane_shift=%s)\n"
          % (p["n"], _f(c["z0_ligne"], 4), _f(abs(c["z_mes"] - c["z_gaine"]), 5)))
    return "".join(t)


def _bloc_ligne(m):
    """Ramener l'impedance lue au PIED DE L'ANTENNE, quand la ligne
    d'alimentation est declaree.

    CE QUE CE BLOC REPOND. L'impedance sort du port, c'est-a-dire du bord de
    la carte : entre elle et l'antenne, il y a un bout de ruban, et un bout de
    ruban FAIT TOURNER l'impedance. « 49,7 - 119,6j au bord de la carte » et
    « au pied du patch » decrivent la meme antenne ; seule la seconde dit quoi
    corriger SUR l'antenne.

    CE QU'IL NE REPOND PAS, ET C'EST LE PIEGE A EVITER. Il n'ameliore aucune
    adaptation, et il ne peut pas : une ligne sans perte dont le Z0 est celui
    de reference ne change pas |Gamma|, elle le fait TOURNER. Deux simulations
    du patch du gabarit, la seconde avec la ligne DOUBLEE, donnent -0,64 dB et
    -1,20 dB a 2,45 GHz -- un demi-decibel, soit ce que 6,4 mm de FR-4 a
    tan d = 0,02 dissipent. Qui cherche un ROE de 7 ne le trouvera pas ici.

    DEUX RESERVES, ECRITES DANS LE SCRIPT LUI-MEME parce que c'est la qu'on
    lit le nombre :

      - le Z0 et l'er effectif sont ANALYTIQUES (Hammerstad), pas ceux de la
        ligne telle qu'elle est maillee ;
      - la rotation est SANS PERTE. Pres du bord de l'abaque -- une antenne
        mal adaptee -- elle amplifie toute erreur sur ces deux nombres, et
        l'impedance ramenee y devient fragile.
    """
    lignes = [(p, p["ligne"]) for p in m["ports"] if p.get("ligne")]
    if not lignes:
        return ""
    t = []
    a = t.append
    a("\n# -- l'impedance ramenee au pied de l'antenne -------------------\n")
    a("# Une ligne de longueur d fait tourner l'impedance :\n")
    a("#   Z(entree) = Z0 . (Z(charge) + j.Z0.tan(beta.d))\n")
    a("#                   / (Z0 + j.Z(charge).tan(beta.d))\n")
    a("# On la retourne. ATTENTION A CE QUE CELA VEUT DIRE : la rotation est\n")
    a("# SANS PERTE et son Z0 est ANALYTIQUE (Hammerstad). Elle ne change donc\n")
    a("# pas l'adaptation -- elle ne fait que deplacer le plan de reference --\n")
    a("# et pres du bord de l'abaque de Smith, la ou une antenne est mal\n")
    a("# adaptee, elle amplifie toute erreur sur Z0 et sur er effectif.\n")
    a("_C0 = 299792458.0\n")
    a("def _au_pied(Z, z0, eeff, d_mm):\n")
    a("    _b = 2 * np.pi * f * np.sqrt(eeff) / _C0\n")
    a("    _t = np.tan(_b * d_mm / 1000.0)\n")
    a("    return z0 * (Z - 1j * z0 * _t) / (z0 - 1j * Z * _t)\n")
    for p, lg in lignes:
        v = "Z_pied" if p["excite"] else "Z_pied_%d" % p["n"]
        src = "Zin" if p["excite"] else "ports[%d].uf_tot / ports[%d].if_tot" % (
            p["n"] - 1, p["n"] - 1)
        a("# port %d : ruban de %s mm de large sur %s mm de substrat er = %s,\n"
          % (p["n"], _f(lg["w"], 4), _f(lg["h"], 4), _f(lg["er"], 3)))
        a("#          soit Z0 = %s ohms et er effectif = %s, sur %s mm.\n"
          % (_f(lg["z0"], 2), _f(lg["eeff"], 4), _f(lg["d"], 3)))
        a("%s = _au_pied(%s, %s, %s, %s)\n"
          % (v, src, _f(lg["z0"], 6), _f(lg["eeff"], 6), _f(lg["d"], 6)))
        a("print('Au pied de l\\'antenne (port %d, ligne de %s mm) : "
          "Z = %%.1f %%+.1fj ohms'\n" % (p["n"], _f(lg["d"], 3)))
        a("      %% (%s[i0].real, %s[i0].imag))\n" % (v, v))
    return "".join(t)


def _bloc_dumps(m):
    """Les enregistrements de champ, a poser AVANT le Run."""
    d = m.get("dumps") or {}
    if not d.get("actif"):
        return ("\n# Aucun enregistrement de champ demande. Pour en ajouter un,\n"
                "# cochez « Enregistrer les champs » a l'etape « Le calcul » —\n"
                "# ou ecrivez ici un CSX.AddDump(...) suivi d'un AddBox(...).\n")
    from openems_modele import DUMP_TYPES
    t = []
    a = t.append
    a("# --------------------------------------------------------------------\n")
    a("# 7bis. Les enregistrements de champ\n")
    a("# --------------------------------------------------------------------\n")
    if d["mode"] == "frequentiel":
        a("# Mode FREQUENTIEL : un champ complexe par frequence demandee,\n")
        a("# soit quelques fichiers. C'est ce qu'il faut pour voir OU passe le\n")
        a("# courant — la question qu'un S11 ne repond pas.\n")
    else:
        a("# Mode TEMPOREL : openEMS ecrit un fichier PAR PAS DE TEMPS. Utile\n")
        a("# pour une animation, ruineux pour le disque (%.0f Mo estimes).\n"
          % (d["octets"] / 1048576.0))
    a("# Fichiers .vtr, lisibles directement par ParaView.\n")
    for nom in d["types"]:
        dt_temps, dt_freq, libelle = DUMP_TYPES[nom]
        dt = dt_freq if d["mode"] == "frequentiel" else dt_temps
        v = "dump_%s" % nom
        a("%s = CSX.AddDump('%s', dump_type=%d, file_type=0,\n"
          "                  sub_sampling=[%d, %d, %d])   # %s\n"
          % (v, nom, dt, d["sous_ech"], d["sous_ech"], d["sous_ech"], libelle))
        if d["mode"] == "frequentiel":
            a("%s.AddFrequency(%s)\n"
              % (v, "[" + ", ".join("%.6e" % f for f in d["f"]) + "]"))
        a("%s.AddBox([%s, %s, %s], [%s, %s, %s])\n"
          % (v, _f(d["x1"]), _f(d["y1"]), _f(d["z1"]),
             _f(d["x2"]), _f(d["y2"]), _f(d["z2"])))
    a("\n")
    return "".join(t)
