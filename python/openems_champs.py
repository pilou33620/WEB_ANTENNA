#!/usr/bin/python3
# -*- coding: utf-8 -*-
# ==========================================================================
# VERSIONING
# Version: 1.0.0
# Date: 2026-09-21
# Explication : lit les enregistrements de champ .vtr et les rend affichables
#               dans la page — sans ParaView.
#
#   POURQUOI CE MODULE EXISTE. Jusqu'ici, regarder un champ voulait dire
#   quitter l'outil : le serveur cherchait ParaView sur le poste et lui
#   passait le dossier. Cela marche, mais cela coute une installation de
#   deux gigaoctets, une fenetre de plus, et surtout un apprentissage —
#   ParaView ne montre RIEN tant qu'on n'a pas choisi une representation,
#   une composante et une echelle. Or la question qu'on se pose apres un
#   calcul tient en une phrase : « ou passe le courant, et a quel moment ».
#   Une carte animee y repond en une seconde.
#
#   CE QUE LE MODULE FAIT, ET CE QU'IL NE FAIT PAS. Il lit les .vtr, il en
#   tire une grille rectiligne et un champ vectoriel, il en decoupe une
#   TRANCHE plane, et il rend des tableaux de flottants que la page dessine
#   elle-meme. Il ne fabrique aucune image : le coloriage, l'echelle et
#   l'animation sont dans le navigateur, ou ils sont reglables sans aller
#   -retour avec le serveur.
#
#   L'ANIMATION NE COUTE PAS UN FICHIER PAR IMAGE. En mode frequentiel,
#   openEMS ecrit `<champ>_f=<f>_abs.vtr` (l'amplitude) et
#   `<champ>_f=<f>_arg.vtr` (la phase) — et, en prime, une vingtaine
#   d'instantanes `_p=<degres>.vtr` qui ne sont que
#   `amplitude x cos(phase + wt)` echantillonnes. On ignore donc les
#   instantanes et on renvoie le COUPLE amplitude/phase : deux tableaux
#   suffisent a rejouer l'onde a n'importe quelle cadence, aussi finement
#   qu'un ecran sait l'afficher. C'est verifie : la reconstruction retombe
#   sur les instantanes d'openEMS a la precision du flottant simple.
#
#   LE TEMPOREL, LUI, EST UNE VRAIE SUITE D'IMAGES — un fichier par pas de
#   temps, des milliers parfois. On n'en garde qu'un echantillon regulier :
#   soixante images font une animation fluide, six mille font une attente.
#
# Fonctions : inventaire, serie, lire_vtr, entete_vtr
# ==========================================================================
"""Lecture des .vtr d'openEMS et extraction de tranches animables."""

import array
import base64
import os
import re
import struct
import sys
import threading
import xml.etree.ElementTree as ET
import zlib


class ErreurChamps(Exception):
    """Un refus lisible : le message part tel quel a la page."""

    def __init__(self, message, conseil=""):
        super().__init__(message)
        self.message = message
        self.conseil = conseil


# LES BORNES, ET POURQUOI ELLES SONT LA. Un enregistrement « toute la boite »
# a 300 x 300 x 200 cellules tient sur le disque ; le meme en JSON dans un
# navigateur, non. On ne refuse pas pour autant : on SOUS-ECHANTILLONNE, et
# on le dit. Une carte de champ lue une cellule sur deux montre exactement la
# meme chose -- c'est d'ailleurs deja l'argument du reglage « une cellule
# sur » au moment d'enregistrer.
MAX_POINTS = 90000          # points d'une tranche, apres sous-echantillonnage
MAX_TRAMES = 60             # images d'une animation temporelle
MAX_FICHIERS = 20000        # garde-fou de lecture de dossier

# LE BUDGET D'UNE ANIMATION TEMPORELLE, ET POURQUOI IL EST SEPARE. Une
# tranche frequentielle, c'est deux tableaux ; une animation temporelle, c'est
# soixante fois trois. Garder MAX_POINTS par image ferait une reponse de
# quatre-vingts mega-octets, que le navigateur mettrait plus de temps a lire
# que le solveur a produire. On repartit donc un budget total entre les
# images : moins de points chacune, mais un mouvement qu'on voit.
BUDGET_VALEURS = 2000000

# Un .vtr d'une boite 3D decompresse pese quelques centaines de mega-octets.
# Le cache en garde donc au plus quatre, ET au plus ce volume-la : la borne
# en nombre de fichiers ne protege de rien quand chacun fait 300 Mo.
CACHE_OCTETS = 400 * 1024 * 1024

# Ce que chaque champ mesure. openEMS ne l'ecrit nulle part dans le .vtr :
# c'est le nom du fichier qui le porte, et ce nom vient de nous
# (`CSX.AddDump('J', ...)` dans openems_script.py).
UNITES = {
    "E": ("V/m", "champ electrique"),
    "H": ("A/m", "champ magnetique"),
    "J": ("A/m^2", "densite de courant"),
    "I": ("A", "courant total (rot H)"),
}

AXES = ("x", "y", "z")


# ==========================================================================
# 1. Le format .vtr
# ==========================================================================
# UN .vtr EST DU XML QUI CONTIENT DU BINAIRE EN BASE 64, et le binaire a son
# propre entete. VTK ecrit, pour un tableau compresse :
#
#     base64(nblocs, taille_bloc, taille_dernier, taille_comprimee[nblocs])
#   + base64(bloc_zlib_1 ... bloc_zlib_n)
#
# — DEUX chaines base64 COLLEES, et non une seule chaine sur l'ensemble.
# C'est le seul piege du format : decoder le tout d'un coup rend des octets
# decales des que la longueur de l'entete n'est pas un multiple de trois.
# On lit donc l'entete d'abord (ses quatre premiers octets disent combien de
# blocs suivent, donc sa propre longueur), puis le corps.

def _base64_octets(txt, n):
    """Les n premiers octets d'une chaine base64, sans decoder la suite."""
    return base64.b64decode(txt[:((n + 2) // 3) * 4])[:n]


def _bloc_binaire(txt, compresse):
    """Le contenu brut d'un <DataArray format="binary">."""
    txt = "".join(txt.split())
    if not txt:
        return b""
    if not compresse:
        tete = base64.b64decode(txt[:8])
        n = struct.unpack("<I", tete[:4])[0]
        # Entete et donnees sont ici une SEULE chaine base64 : VTK ne les
        # separe que lorsqu'il compresse.
        return base64.b64decode(txt)[4:4 + n]

    nblocs = struct.unpack("<I", _base64_octets(txt, 4))[0]
    if nblocs > 1 << 20:
        raise ErreurChamps("Fichier de champ illisible : entete incoherent.")
    taille_tete = (3 + nblocs) * 4
    fin_tete = ((taille_tete + 2) // 3) * 4
    tete = base64.b64decode(txt[:fin_tete])
    tailles = struct.unpack("<%dI" % (3 + nblocs), tete[:taille_tete])[3:]
    corps = base64.b64decode(txt[fin_tete:])
    morceaux = []
    pos = 0
    for t in tailles:
        morceaux.append(zlib.decompress(corps[pos:pos + t]))
        pos += t
    return b"".join(morceaux)


_TYPES = {"Float32": "f", "Float64": "d",
          "Int32": "i", "UInt32": "I", "Int64": "q", "UInt64": "Q"}


def _tableau(da, compresse, simple=True):
    """Un <DataArray> -> array.array de flottants.

    `simple` ramene le resultat en simple precision : c'est ce qu'on veut
    pour le CHAMP, qu'openEMS ecrit deja ainsi et qui part en base 64 vers
    la page. Les COORDONNEES, elles, restent en double : elles sont en
    metres, et ramener 0,033 82 m a un flottant simple deplace une arete de
    maillage de quelques nanometres — invisible ici, mais c'est le genre
    d'arrondi gratuit qu'on regrette quand une comparaison de bornes tombe
    du mauvais cote.

    `.text` et non `itertext()` : un DataArray porte parfois un enfant
    <InformationKey> apres ses donnees, et sa queue de texte n'est pas de la
    base 64.
    """
    forme = _TYPES.get(da.get("type"))
    if forme is None:
        raise ErreurChamps("Type de donnees .vtr non gere : %s"
                           % da.get("type"))
    fmt = (da.get("format") or "binary").lower()
    if fmt == "ascii":
        return array.array("f" if simple else "d",
                           [float(v) for v in (da.text or "").split()])
    if fmt != "binary":
        raise ErreurChamps(
            "Ce .vtr range ses donnees en « %s », que l'outil ne lit pas."
            % fmt,
            "Ouvrez le dossier de calcul : ParaView, lui, les lira.")
    brut = _bloc_binaire(da.text or "", compresse)
    a = array.array(forme)
    a.frombytes(brut[:len(brut) - (len(brut) % a.itemsize)])
    if sys.byteorder != "little":
        a.byteswap()
    if forme == "f" or not simple:
        return a
    return array.array("f", a)


def lire_vtr(chemin):
    """Un .vtr -> {dims, x, y, z, nom, ncomp, v}.

    `v` est le champ, en simple precision, range comme VTK le range : x
    varie le plus vite, puis y, puis z, et les composantes sont cote a cote.
    """
    with open(chemin, "rb") as f:
        texte = f.read().decode("utf-8", "replace")
    try:
        racine = ET.fromstring(texte)
    except ET.ParseError as exc:
        raise ErreurChamps("Fichier de champ illisible (%s) : %s"
                           % (os.path.basename(chemin), exc))
    if racine.get("type") != "RectilinearGrid":
        raise ErreurChamps(
            "Ce .vtr n'est pas une grille rectiligne (%s)."
            % racine.get("type"),
            "L'outil ne dessine que les grilles d'openEMS.")
    compresse = bool(racine.get("compressor"))
    grille = racine.find("RectilinearGrid")
    piece = grille.find("Piece") if grille is not None else None
    if piece is None:
        raise ErreurChamps("Fichier de champ vide : %s"
                           % os.path.basename(chemin))

    coords = piece.find("Coordinates")
    axes = [_tableau(da, compresse, simple=False)
            for da in (coords.findall("DataArray")
                       if coords is not None else [])]
    while len(axes) < 3:
        axes.append(array.array("d", [0.0]))
    nx, ny, nz = len(axes[0]), len(axes[1]), len(axes[2])

    donnees = piece.find("PointData")
    tableaux = donnees.findall("DataArray") if donnees is not None else []
    if not tableaux:
        # Certaines versions ecrivent le champ en CellData. Le decalage d'une
        # demi-cellule ne change rien a ce qu'on regarde.
        donnees = piece.find("CellData")
        tableaux = donnees.findall("DataArray") if donnees is not None else []
        if tableaux:
            nx, ny, nz = max(1, nx - 1), max(1, ny - 1), max(1, nz - 1)
    if not tableaux:
        raise ErreurChamps("Aucune donnee dans %s" % os.path.basename(chemin))

    da = tableaux[0]
    ncomp = int(da.get("NumberOfComponents") or 1)
    v = _tableau(da, compresse)
    attendu = nx * ny * nz * ncomp
    if len(v) < attendu:
        raise ErreurChamps(
            "Fichier de champ tronque : %s (%d valeurs pour %d attendues)."
            % (os.path.basename(chemin), len(v), attendu))
    return {"dims": (nx, ny, nz), "axes": axes, "nom": da.get("Name") or "",
            "ncomp": ncomp, "v": v}


# ---- un cache, parce qu'on relit les memes deux fichiers a chaque tranche --
# Changer de tranche dans une boite 3D redemande le MEME fichier : le relire
# et le decompresser a chaque mouvement d'un curseur rendrait l'interface
# poisseuse. Trois fichiers suffisent (amplitude, phase, et le precedent) ;
# au-dela on oublie le plus ancien, parce qu'un .vtr decompresse peut peser
# quelques centaines de mega-octets.
_CACHE = {}
_CACHE_ORDRE = []
_CACHE_MAX = 4
_VERROU = threading.Lock()


def _poids(grille):
    return grille["v"].itemsize * len(grille["v"])


def _lire_cache(chemin):
    try:
        cle = (chemin, os.path.getmtime(chemin), os.path.getsize(chemin))
    except OSError as exc:
        raise ErreurChamps("Fichier de champ introuvable : %s" % exc)
    with _VERROU:
        trouve = _CACHE.get(cle)
        if trouve is not None:
            return trouve
    grille = lire_vtr(chemin)
    with _VERROU:
        _CACHE[cle] = grille
        _CACHE_ORDRE.append(cle)
        total = sum(_poids(g) for g in _CACHE.values())
        while len(_CACHE_ORDRE) > 1 and (len(_CACHE_ORDRE) > _CACHE_MAX
                                         or total > CACHE_OCTETS):
            vieux = _CACHE.pop(_CACHE_ORDRE.pop(0), None)
            if vieux is not None:
                total -= _poids(vieux)
    return grille


_RE_EXTENT = re.compile(r'WholeExtent\s*=\s*"([-\d\s]+)"')
_RE_NCOMP = re.compile(r'NumberOfComponents\s*=\s*"(\d+)"')


def entete_vtr(chemin):
    """Les dimensions d'un .vtr, sans lire ses donnees.

    L'INVENTAIRE DOIT RESTER INSTANTANE, MEME SUR UN DOSSIER DE PLUSIEURS
    GIGA-OCTETS. Ouvrir chaque serie pour connaitre sa taille reviendrait a
    decompresser trois cents mega-octets par champ, juste pour remplir une
    liste deroulante. Tout ce qu'il faut tient dans le premier kilo-octet du
    fichier, en clair, avant la base 64.
    """
    try:
        with open(chemin, "rb") as f:
            tete = f.read(4096).decode("utf-8", "replace")
    except OSError:
        return None
    m = _RE_EXTENT.search(tete)
    if not m:
        return None
    try:
        e = [int(v) for v in m.group(1).split()]
    except ValueError:
        return None
    if len(e) < 6:
        return None
    dims = [e[1] - e[0] + 1, e[3] - e[2] + 1, e[5] - e[4] + 1]
    n = _RE_NCOMP.search(tete)
    return {"dims": dims, "ncomp": int(n.group(1)) if n else 1}


# ==========================================================================
# 2. L'inventaire : quels champs ce calcul a-t-il laisses ?
# ==========================================================================
# LES NOMS DE FICHIERS SONT LE SEUL CATALOGUE. openEMS n'ecrit pas d'index ;
# il ecrit des fichiers dont le nom dit tout :
#
#   frequentiel :  J_f=2450000000.000000_abs.vtr      l'amplitude
#                  J_f=2450000000.000000_arg.vtr      la phase, en radians
#                  J_f=2450000000.000000_p=017.vtr    un instantane (ignore)
#   temporel    :  J_00000123.vtr                     un pas de temps
#
# La derniere regle est volontairement large : si une version d'openEMS
# nommait autrement, un groupe « tout ce qui finit par des chiffres » les
# rattrape quand meme, et l'outil affiche une animation plutot qu'un refus.

_RE_FD = re.compile(
    r"^(?P<nom>.+?)_f=(?P<f>[0-9][0-9.eE+-]*)_"
    r"(?:p=(?P<p>\d+)|(?P<part>abs|arg))\.vtr$")
_RE_TD = re.compile(r"^(?P<nom>.+?)[_.](?P<n>\d+)\.vtr$")


def _champ_de(nom):
    """« J », « E_haut », « Et » -> la lettre du champ, si on la reconnait."""
    tete = nom.split("_")[0]
    for lettre in ("E", "H", "J", "I"):
        if tete == lettre or tete == lettre + "t" or tete == lettre + "f":
            return lettre
    return tete[:1].upper() if tete[:1].upper() in UNITES else ""


def _etiquette(champ, nom, mode, f):
    base = UNITES.get(champ, ("", nom))[1]
    if mode == "frequentiel":
        return "%s  ·  %s  ·  %s" % (nom, base, _hertz(f))
    return "%s  ·  %s  ·  au cours du temps" % (nom, base)


def _hertz(f):
    if not f:
        return ""
    if f >= 1e9:
        return ("%.4f" % (f / 1e9)).rstrip("0").rstrip(".") + " GHz"
    if f >= 1e6:
        return ("%.4f" % (f / 1e6)).rstrip("0").rstrip(".") + " MHz"
    return "%g Hz" % f


def _series(dossier):
    """Les series du dossier, champs prives compris (« _abs », « _trames »).

    Le tri ne lit AUCUN fichier de donnees : rien que les noms. Un dossier
    de plusieurs giga-octets se catalogue donc instantanement — seule la
    geometrie de la grille, tout en bas, ouvre un fichier par serie, et le
    cache fait que c'est la derniere fois.
    """
    try:
        noms = sorted(os.listdir(dossier))[:MAX_FICHIERS]
    except OSError as exc:
        raise ErreurChamps("Dossier de calcul illisible : %s" % exc)

    fd = {}          # (nom, f) -> {"abs":fichier, "arg":fichier, "p":[...]}
    td = {}          # nom      -> [(n, fichier), ...]
    for n in noms:
        if not n.lower().endswith(".vtr"):
            continue
        m = _RE_FD.match(n)
        if m:
            try:
                f = float(m.group("f"))
            except ValueError:
                f = 0.0
            g = fd.setdefault((m.group("nom"), f),
                              {"abs": "", "arg": "", "p": []})
            if m.group("part"):
                g[m.group("part")] = n
            else:
                g["p"].append((int(m.group("p")), n))
            continue
        m = _RE_TD.match(n)
        if m:
            td.setdefault(m.group("nom"), []).append((int(m.group("n")), n))

    series = []
    for (nom, f), g in sorted(fd.items()):
        # SANS AMPLITUDE NI PHASE, ON RETOMBE SUR LES INSTANTANES. C'est le
        # cas d'un calcul interrompu pile entre deux ecritures, et ce n'est
        # pas une raison pour ne rien montrer.
        if g["abs"] and g["arg"]:
            trames, source = [], "abs_arg"
        elif g["p"]:
            trames = [{"etiquette": "%d°" % d, "fichier": n}
                      for d, n in sorted(g["p"])]
            source = "instantanes"
        else:
            continue
        champ = _champ_de(nom)
        series.append({
            "cle": "fd|%s|%r" % (nom, f), "nom": nom, "champ": champ,
            "mode": "frequentiel", "f": f, "source": source,
            "unite": UNITES.get(champ, ("", ""))[0],
            "titre": _etiquette(champ, nom, "frequentiel", f),
            # « continu » : l'animation ne se joue pas image par image mais
            # se CALCULE, aussi finement que l'ecran le demande.
            "continu": source == "abs_arg",
            "n_trames": len(trames),
            "_abs": g["abs"], "_arg": g["arg"],
            "_trames": trames,
        })

    for nom, paires in sorted(td.items()):
        paires.sort()
        champ = _champ_de(nom)
        series.append({
            "cle": "td|%s" % nom, "nom": nom, "champ": champ,
            "mode": "temporel", "f": 0.0, "source": "pas_de_temps",
            "unite": UNITES.get(champ, ("", ""))[0],
            "titre": _etiquette(champ, nom, "temporel", 0),
            "continu": False,
            "n_trames": len(paires),
            "_abs": "", "_arg": "",
            "_trames": [{"etiquette": "pas %d" % n, "fichier": f}
                        for n, f in paires],
        })

    # LA TAILLE DE LA GRILLE VIENT DE L'ENTETE, ET NON DU FICHIER ENTIER.
    # Elle est indicative : c'est `serie()` qui fait foi, apres une vraie
    # lecture. Ici elle ne sert qu'a dire, dans la liste, si l'on a affaire a
    # une image ou a un volume.
    for s in series:
        premier = s["_abs"] or (s["_trames"][0]["fichier"] if s["_trames"]
                                else "")
        if not premier:
            continue
        e = entete_vtr(os.path.join(dossier, premier))
        if not e:
            continue
        s["dims"] = e["dims"]
        s["ncomp"] = e["ncomp"]
        s["volume"] = min(e["dims"]) > 1

    # L'ORDRE DE LA LISTE EST CELUI DE L'INTERET, ET NON L'ALPHABET. On
    # ouvre un calcul pour voir ou passe le COURANT — « J » d'abord, donc,
    # puis le champ electrique qui dit ou se concentre la tension.
    rang = {"J": 0, "E": 1, "H": 2, "I": 3}
    series.sort(key=lambda s: (rang.get(s["champ"], 9), s["nom"], s["f"]))
    return series


def inventaire(dossier):
    """Ce qu'il y a a regarder dans ce dossier de calcul, pour la page.

    Les champs prives — les noms de fichiers — ne remontent pas : la page
    designe une serie par sa CLE, et c'est le serveur qui la resout en
    fichiers. Une route qui accepterait un nom de fichier venu de la
    requete ouvrirait tout autre chose qu'un champ.
    """
    series = _series(dossier)
    publiques = [{k: v for k, v in s.items() if not k.startswith("_")}
                 for s in series]
    return {"series": publiques, "dossier": dossier,
            "n": len(publiques)}


# ==========================================================================
# 3. Une tranche, prete a dessiner
# ==========================================================================

def _plan(dims, axe):
    """Quel axe est normal a l'image, et quels deux axes la remplissent."""
    i = AXES.index(axe)
    u, v = [k for k in (0, 1, 2) if k != i]
    return i, u, v


def _axe_par_defaut(dims):
    """La normale la plus evidente : la direction ou la grille est plate.

    Un dump `plan_z` fait une seule cellule en z — c'est une image, il n'y a
    rien a choisir. Une boite 3D n'a pas de reponse evidente : on prend z,
    parce que c'est le plan du cuivre et que c'est ce qu'on regarde.
    """
    for i, n in enumerate(dims):
        if n <= 1:
            return AXES[i]
    return "z"


def _tranche_forte(grille, axe):
    """L'indice de la tranche ou le champ est le plus fort.

    LE MILIEU D'UNE BOITE, C'EST DE L'AIR. Un enregistrement volumique coupe
    par defaut a mi-hauteur montre donc une carte noire, et laisse croire que
    le calcul n'a rien donne. La tranche interessante est celle qui porte
    l'energie — le plan du cuivre, neuf fois sur dix —, et la trouver ne
    coute qu'un parcours echantillonne du tableau.
    """
    dims = grille["dims"]
    i_n, i_u, i_v = _plan(dims, axe)
    n_n = dims[i_n]
    if n_n <= 1:
        return 0
    ncomp = grille["ncomp"]
    v = grille["v"]
    nx, ny, _nz = dims
    saut = (ncomp, nx * ncomp, nx * ny * ncomp)
    plan = dims[i_u] * dims[i_v]
    # Au plus deux millions de valeurs lues en tout, quel que soit le volume.
    pas = max(1, (n_n * plan * ncomp) // 2000000)
    meilleur, force = 0, -1.0
    for k in range(n_n):
        base = k * saut[i_n]
        s = 0.0
        for j in range(0, dims[i_v], pas):
            d0 = base + j * saut[i_v]
            for i in range(0, dims[i_u], pas):
                d = d0 + i * saut[i_u]
                for c in range(ncomp):
                    x = v[d + c]
                    s += x * x
        if s > force:
            force, meilleur = s, k
    return meilleur


def _decouper(grille, axe, indice, max_points):
    """Extrait une tranche plane : coordonnees en mm et composantes.

    Rend (u_mm, v_mm, comps) ou `comps` est une liste de `ncomp` tableaux de
    flottants, chacun de len(u_mm) * len(v_mm), rangee u en premier.
    """
    dims = grille["dims"]
    i_n, i_u, i_v = _plan(dims, axe)
    n_n, n_u, n_v = dims[i_n], dims[i_u], dims[i_v]
    indice = max(0, min(n_n - 1, int(indice)))

    # Le sous-echantillonnage porte sur les DEUX axes de l'image a la fois :
    # une tranche deux fois moins fine dans chaque direction pese quatre fois
    # moins, et se lit exactement pareil.
    pu = pv = 1
    while ((n_u + pu - 1) // pu) * ((n_v + pv - 1) // pv) > max_points:
        if (n_u // pu) >= (n_v // pv):
            pu += 1
        else:
            pv += 1
        if pu > 64 or pv > 64:
            break

    us = list(range(0, n_u, pu))
    vs = list(range(0, n_v, pv))
    ncomp = grille["ncomp"]
    v = grille["v"]
    nx, ny, _nz = dims

    # Le pas d'un indice de grille dans le tableau lineaire, par axe. VTK
    # range x le plus vite.
    saut = (ncomp, nx * ncomp, nx * ny * ncomp)
    base = indice * saut[i_n]
    su, sv = saut[i_u], saut[i_v]

    comps = [array.array("f", bytes(4 * len(us) * len(vs)))
             for _ in range(ncomp)]
    k = 0
    for jv in vs:
        dv = base + jv * sv
        for ju in us:
            d = dv + ju * su
            for c in range(ncomp):
                comps[c][k] = v[d + c]
            k += 1

    u_mm = [grille["axes"][i_u][j] * 1000.0 for j in us]
    v_mm = [grille["axes"][i_v][j] * 1000.0 for j in vs]
    return u_mm, v_mm, comps, (pu, pv), indice


def _b64(a):
    if sys.byteorder != "little":
        a = array.array("f", a)
        a.byteswap()
    return base64.b64encode(a.tobytes()).decode("ascii")


def _amplitude_max(comps):
    """Le plus grand module vectoriel de la tranche.

    C'est l'echelle par defaut de l'animation. Elle est FIXE pour toute la
    duree : une echelle recalculee a chaque image fait clignoter la carte et
    donne a un champ mourant l'air d'un champ intense.
    """
    n = len(comps[0]) if comps else 0
    maxi = 0.0
    for k in range(n):
        s = 0.0
        for c in comps:
            s += c[k] * c[k]
        if s > maxi:
            maxi = s
    return maxi ** 0.5


def serie(dossier, cle, axe="", indice=-1, max_points=MAX_POINTS,
          max_trames=MAX_TRAMES):
    """Les donnees d'une serie, pretes a animer dans la page.

    Frequentiel : deux tableaux (amplitude, phase) par composante. La page
    rejoue l'onde par `A cos(phi + wt)`, aussi finement qu'elle veut, sans
    rien redemander au serveur.

    Temporel : jusqu'a `max_trames` images regulierement espacees.
    """
    s = _trouver(dossier, cle)
    dims = None
    max_points = max(256, min(MAX_POINTS, int(max_points or MAX_POINTS)))

    def tranche(fichier):
        g = _lire_cache(os.path.join(dossier, fichier))
        return g, _decouper(g, axe_final, indice, max_points)

    # L'axe et l'indice se decident sur la geometrie, donc apres une premiere
    # lecture — mais la premiere lecture a besoin de l'axe. On lit d'abord la
    # grille (le cache la gardera), puis on tranche.
    premier = s["_abs"] or (s["_trames"][0]["fichier"] if s["_trames"] else "")
    if not premier:
        raise ErreurChamps("Cet enregistrement ne contient aucun fichier.")
    g0 = _lire_cache(os.path.join(dossier, premier))
    dims = g0["dims"]
    axe_final = axe if axe in AXES else _axe_par_defaut(dims)
    i_n, i_u, i_v = _plan(dims, axe_final)
    if indice is None or int(indice) < 0:
        indice = _tranche_forte(g0, axe_final)

    sortie = {
        "cle": s["cle"], "nom": s["nom"], "champ": s["champ"],
        "titre": s["titre"], "mode": s["mode"], "f": s["f"],
        "unite": s["unite"], "source": s["source"],
        "axe": axe_final, "axes_image": [AXES[i_u], AXES[i_v]],
        "n_tranches": dims[i_n], "dims": list(dims),
    }

    if s["mode"] == "frequentiel" and s["source"] == "abs_arg":
        ga, (u_mm, v_mm, amp, sous, ind) = tranche(s["_abs"])
        gp, (_u, _v, pha, _s, _i) = tranche(s["_arg"])
        if len(amp) != len(pha):
            raise ErreurChamps("Amplitude et phase ne concordent pas.")
        sortie.update({
            "u": [round(x, 6) for x in u_mm],
            "v": [round(x, 6) for x in v_mm],
            "indice": ind,
            "position_mm": round(ga["axes"][i_n][ind] * 1000.0, 6),
            "sous_ech": list(sous), "ncomp": len(amp),
            "max": _amplitude_max(amp),
            "amp": [_b64(c) for c in amp],
            "pha": [_b64(c) for c in pha],
        })
        return sortie

    # -- une vraie suite d'images -----------------------------------------
    trames = s["_trames"]
    if not trames:
        raise ErreurChamps("Cet enregistrement ne contient aucune image.")
    n = len(trames)
    max_trames = max(1, min(MAX_TRAMES, int(max_trames or MAX_TRAMES)))
    # Le budget se repartit entre les images : c'est lui, et non MAX_POINTS,
    # qui fixe la finesse d'une animation temporelle.
    ncomp0 = max(1, g0["ncomp"])
    max_points = max(1024, min(
        max_points, BUDGET_VALEURS // (min(n, max_trames) * ncomp0)))
    if n > max_trames:
        pris = [trames[round(i * (n - 1) / (max_trames - 1))]
                for i in range(max_trames)] if max_trames > 1 else [trames[0]]
    else:
        pris = trames

    images, maxi = [], 0.0
    u_mm = v_mm = []
    ind = indice
    for t in pris:
        g, (u_mm, v_mm, comps, sous, ind) = tranche(t["fichier"])
        maxi = max(maxi, _amplitude_max(comps))
        images.append({"etiquette": t["etiquette"],
                       "c": [_b64(c) for c in comps]})
    sortie.update({
        "u": [round(x, 6) for x in u_mm],
        "v": [round(x, 6) for x in v_mm],
        "indice": ind,
        "position_mm": round(g0["axes"][i_n][ind] * 1000.0, 6),
        "sous_ech": list(sous), "ncomp": g0["ncomp"],
        "max": maxi, "trames": images,
        "n_total": n, "n_rendues": len(images),
    })
    return sortie


def _trouver(dossier, cle):
    """La serie complete — champs prives compris — portant cette cle."""
    for s in _series(dossier):
        if s["cle"] == cle:
            return s
    raise ErreurChamps(
        "Cet enregistrement de champ n'est plus dans le dossier de calcul.",
        "Rechargez la liste : le dossier a peut-etre ete vide ou remplace.")
