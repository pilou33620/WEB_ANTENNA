#!/usr/bin/python3
# -*- coding: utf-8 -*-
# ==========================================================================
# Banc d'essai du lecteur de champs (python/openems_champs.py).
#
#   python python/test/banc-champs.py
#   python python/test/banc-champs.py <dossier-de-calcul>
#
# POURQUOI UN BANC QUI FABRIQUE SES PROPRES .vtr. Le format est du XML qui
# contient du binaire compresse en base 64, avec un entete qui est LUI-MEME
# une chaine base 64 distincte collee devant les donnees. C'est le genre de
# detail qu'on croit avoir compris jusqu'a ce qu'une grille de taille
# differente decale tout d'un octet. Le banc ecrit donc des fichiers dont il
# connait le contenu exact, et verifie que ce qui ressort est bien ce qui est
# entre — y compris quand l'entete n'est pas un multiple de trois octets.
#
# Passe un dossier de calcul en argument, et il verifie en plus l'inventaire
# et le decoupage sur de VRAIS fichiers ecrits par openEMS.
# ==========================================================================

import array
import base64
import math
import os
import shutil
import struct
import sys
import tempfile
import zlib

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(ICI))

import openems_champs as ch                            # noqa: E402

_ok = [0]
_ko = []


def verifie(nom, condition, detail=""):
    if condition:
        _ok[0] += 1
        print("  ok   %s" % nom)
    else:
        _ko.append(nom)
        print("  RATE %s   %s" % (nom, detail))


# --------------------------------------------------------------------------
# Fabriquer un .vtr comme VTK le fait
# --------------------------------------------------------------------------

def _binaire(octets, compresse):
    """Le corps d'un <DataArray format="binary">, tel que VTK l'ecrit."""
    if not compresse:
        return base64.b64encode(struct.pack("<I", len(octets))
                                + octets).decode("ascii")
    bloc = zlib.compress(octets)
    tete = struct.pack("<4I", 1, len(octets), len(octets), len(bloc))
    return (base64.b64encode(tete).decode("ascii")
            + base64.b64encode(bloc).decode("ascii"))


def ecrire_vtr(chemin, x, y, z, champ, ncomp=3, compresse=True):
    """Une grille rectiligne et son champ, au format d'openEMS."""
    ext = "0 %d 0 %d 0 %d" % (len(x) - 1, len(y) - 1, len(z) - 1)
    coord = "".join(
        '      <DataArray type="Float64" Name="Array %d" format="binary">'
        '%s</DataArray>\n'
        % (i, _binaire(array.array("d", a).tobytes(), compresse))
        for i, a in enumerate((x, y, z)))
    xml = (
        '<?xml version="1.0"?>\n'
        '<VTKFile type="RectilinearGrid" version="0.1" '
        'byte_order="LittleEndian" header_type="UInt32"%s>\n'
        '  <RectilinearGrid WholeExtent="%s">\n'
        '  <Piece Extent="%s">\n'
        '    <PointData>\n'
        '      <DataArray type="Float32" Name="E-Field" '
        'NumberOfComponents="%d" format="binary">%s'
        '<InformationKey name="L2_NORM_RANGE" location="vtkDataArray" '
        'length="2"><Value index="0">0</Value></InformationKey>'
        '</DataArray>\n'
        '    </PointData>\n'
        '    <CellData>\n    </CellData>\n'
        '    <Coordinates>\n%s    </Coordinates>\n'
        '  </Piece>\n  </RectilinearGrid>\n</VTKFile>\n'
        % (' compressor="vtkZLibDataCompressor"' if compresse else "",
           ext, ext, ncomp,
           _binaire(array.array("f", champ).tobytes(), compresse), coord))
    with open(chemin, "wb") as f:
        f.write(xml.encode("utf-8"))


# --------------------------------------------------------------------------
# 1. Le format
# --------------------------------------------------------------------------
print("1. Lire un .vtr fabrique a la main")
base = tempfile.mkdtemp(prefix="banc_champs_")
try:
    # Des tailles VOLONTAIREMENT quelconques : c'est quand la longueur de
    # l'entete n'est pas un multiple de trois que le decodage base 64 se
    # decale, et une grille 4 x 4 ne le montrerait jamais.
    nx, ny, nz = 7, 5, 3
    xs = [i * 0.001 for i in range(nx)]
    ys = [j * 0.002 for j in range(ny)]
    zs = [k * 0.003 for k in range(nz)]
    champ = []
    for k in range(nz):
        for j in range(ny):
            for i in range(nx):
                champ += [float(i), float(j), float(k)]

    for compresse in (True, False):
        nom = os.path.join(base, "T_%s.vtr" % ("zlib" if compresse else "nu"))
        ecrire_vtr(nom, xs, ys, zs, champ, compresse=compresse)
        g = ch.lire_vtr(nom)
        etiq = "compresse" if compresse else "non compresse"
        verifie("dimensions relues (%s)" % etiq,
                g["dims"] == (nx, ny, nz), str(g["dims"]))
        verifie("nombre de valeurs (%s)" % etiq,
                len(g["v"]) == nx * ny * nz * 3, str(len(g["v"])))
        verifie("valeurs identiques a l'aller (%s)" % etiq,
                all(abs(g["v"][i] - champ[i]) < 1e-6
                    for i in range(len(champ))))
        verifie("coordonnees relues (%s)" % etiq,
                abs(g["axes"][1][-1] - ys[-1]) < 1e-12)

    e = ch.entete_vtr(os.path.join(base, "T_zlib.vtr"))
    verifie("l'entete seul donne les memes dimensions",
            e and e["dims"] == [nx, ny, nz] and e["ncomp"] == 3, str(e))

    # ----------------------------------------------------------------------
    # 2. Le decoupage d'un volume
    # ----------------------------------------------------------------------
    print()
    print("2. Decouper une tranche")
    g = ch.lire_vtr(os.path.join(base, "T_zlib.vtr"))
    for axe, attendu in (("z", (nx, ny)), ("y", (nx, nz)), ("x", (ny, nz))):
        u, v, comps, sous, ind = ch._decouper(g, axe, 1, ch.MAX_POINTS)
        verifie("tranche perpendiculaire a %s : bonne taille" % axe,
                (len(u), len(v)) == attendu,
                "%d x %d" % (len(u), len(v)))
        verifie("tranche perpendiculaire a %s : bon plan" % axe,
                all(abs(c - 1.0) < 1e-6
                    for c in comps["xyz".index(axe)]),
                "la composante normale doit valoir l'indice, soit 1")

    # Le champ vaut (i, j, k) : la tranche k = 2 a donc une composante z
    # partout egale a 2, et c'est elle qui porte le plus d'energie.
    verifie("la tranche par defaut est la plus forte, et non celle du milieu",
            ch._tranche_forte(g, "z") == nz - 1,
            str(ch._tranche_forte(g, "z")))

    # ----------------------------------------------------------------------
    # 3. L'inventaire, et le couple amplitude / phase
    # ----------------------------------------------------------------------
    print()
    print("3. Inventorier un dossier")
    dos = os.path.join(base, "calcul")
    os.makedirs(dos)
    n = nx * ny * nz * 3
    amp = [1.0 + (i % 5) for i in range(n)]
    pha = [(i % 7) * 0.4 for i in range(n)]
    ecrire_vtr(os.path.join(dos, "J_f=2450000000.000000_abs.vtr"),
               xs, ys, zs, amp)
    ecrire_vtr(os.path.join(dos, "J_f=2450000000.000000_arg.vtr"),
               xs, ys, zs, pha)
    # Un instantane, que l'inventaire doit IGNORER au profit du couple.
    ecrire_vtr(os.path.join(dos, "J_f=2450000000.000000_p=017.vtr"),
               xs, ys, zs, [a * math.cos(p) for a, p in zip(amp, pha)])
    for t in (0, 1, 2, 3):
        ecrire_vtr(os.path.join(dos, "E_%08d.vtr" % t), xs, ys, zs,
                   [v * (t + 1) for v in amp])

    inv = ch.inventaire(dos)
    cles = [s["cle"] for s in inv["series"]]
    verifie("deux series, le courant d'abord", len(cles) == 2
            and cles[0].startswith("fd|J"), str(cles))
    fd = [s for s in inv["series"] if s["mode"] == "frequentiel"][0]
    td = [s for s in inv["series"] if s["mode"] == "temporel"][0]
    verifie("la serie frequentielle s'anime en continu", fd["continu"] is True)
    verifie("la serie temporelle compte ses quatre images",
            td["n_trames"] == 4, str(td["n_trames"]))
    verifie("le volume est reconnu comme tel", fd.get("volume") is True)

    s = ch.serie(dos, fd["cle"], axe="z", indice=0)
    verifie("la serie rend amplitude ET phase",
            len(s["amp"]) == 3 and len(s["pha"]) == 3)
    a0 = array.array("f", base64.b64decode(s["amp"][0]))
    p0 = array.array("f", base64.b64decode(s["pha"][0]))
    verifie("la tranche a le bon nombre de points",
            len(a0) == nx * ny, str(len(a0)))
    verifie("amplitude et phase concordent avec ce qui a ete ecrit",
            abs(a0[0] - amp[0]) < 1e-6 and abs(p0[0] - pha[0]) < 1e-6,
            "%g / %g" % (a0[0], p0[0]))

    st = ch.serie(dos, td["cle"], axe="z", indice=0)
    verifie("la serie temporelle rend ses images",
            len(st["trames"]) == 4, str(len(st.get("trames", []))))
    verifie("les images sont dans l'ordre",
            st["trames"][0]["etiquette"] < st["trames"][3]["etiquette"])

    # Une cle inventee ne doit pas ouvrir de fichier : c'est la seule chose
    # qui empeche une requete de designer un chemin du poste.
    try:
        ch.serie(dos, "fd|../../secret|1.0")
        verifie("une cle inconnue est refusee", False, "aucun refus")
    except ch.ErreurChamps:
        verifie("une cle inconnue est refusee", True)

    # ----------------------------------------------------------------------
    # 4. De vrais fichiers, si on en donne
    # ----------------------------------------------------------------------
    if len(sys.argv) > 1:
        print()
        print("4. Un vrai dossier de calcul : %s" % sys.argv[1])
        inv = ch.inventaire(sys.argv[1])
        verifie("l'inventaire trouve quelque chose", inv["n"] > 0,
                "aucun champ dans ce dossier")
        for x in inv["series"]:
            print("   %-28s %s" % (x["cle"], x["titre"]))
        if inv["n"]:
            s = ch.serie(sys.argv[1], inv["series"][0]["cle"])
            print("   tranche %d x %d, maximum %g %s"
                  % (len(s["u"]), len(s["v"]), s["max"], s["unite"]))
            verifie("la tranche n'est pas vide",
                    len(s["u"]) > 1 and len(s["v"]) > 1)
            verifie("le maximum est fini et non nul",
                    s["max"] > 0 and s["max"] < float("inf"), str(s["max"]))
finally:
    shutil.rmtree(base, ignore_errors=True)

print()
print("%d verifications, %d echec(s)" % (_ok[0] + len(_ko), len(_ko)))
for nom in _ko:
    print("  - %s" % nom)
sys.exit(1 if _ko else 0)
