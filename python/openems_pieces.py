#!/usr/bin/python3
# -*- coding: utf-8 -*-
# ==========================================================================
# VERSIONING
# Version: 1.0.0
# Date: 2026-09-24
# Explication : les pieces mecaniques importees -- boitier, piles, vis --,
#   c'est-a-dire des MAILLAGES TRIANGULES fermes, et ce qu'il faut en faire
#   pour qu'openEMS les voie.
#
#   La page lit le fichier STEP (OpenCascade compile en WebAssembly, repris
#   de WEB_3D) et envoie des triangles. Ce module les relit, les soude, les
#   verifie, les place, et en tire ce dont le maillage FDTD a besoin : leur
#   emprise et les plans de leurs faces.
#
# Fonctions : pieces, corps_inclus, emprises, sans_geometrie, sommets_b64,
#             faces_b64
# ==========================================================================
"""Pieces 3D importees : lecture, soudure, verification, placement."""

import array
import base64
import collections
import hashlib
import math
import sys
import threading
import zlib


class ErreurPiece(Exception):
    """Un refus, avec ce qu'il faut changer -- meme forme qu'ErreurModele,
    que openems_modele convertit : ce module ne depend pas de lui."""

    def __init__(self, message, conseil=""):
        Exception.__init__(self, message)
        self.message = message
        self.conseil = conseil


# -- les bornes -------------------------------------------------------------
# UN BUDGET DE TRIANGLES, ET NON UNE TAILLE DE FICHIER. Ce qui coute, c'est
# ce qu'openEMS fait de chaque triangle : pour chaque cellule du maillage, il
# demande « ce point est-il dans la piece ? », et la reponse parcourt un arbre
# de triangles. Un boitier triangule a la finesse d'un rendu (deux cent mille
# triangles, des conges au centieme) n'apprend rien de plus a une grille dont
# la cellule fait un demi-millimetre -- et la page triangule deja grossier
# pour cette raison (voir 33-pieces.js).
MAX_TRIANGLES = 400000
MAX_PIECES = 32
# LES CORPS SIMULES, ET EUX SEULS. Un export mecanique complet porte la carte,
# ses composants, sa visserie : des centaines de corps, presque tous ignores,
# et qui ne voyagent meme pas avec leurs triangles. Les compter refusait en
# bloc un produit dont vingt corps seulement partaient au solveur. Le nombre
# TOTAL n'a qu'un garde-fou, contre un document aberrant.
MAX_CORPS = 400
MAX_CORPS_TOTAL = 20000

# LA SOUDURE : deux sommets plus proches que cela sont UN sommet. OpenCascade
# triangule chaque face B-Rep a part, et chaque face porte ses propres copies
# des sommets de ses aretes : le maillage n'est alors ferme qu'a la condition
# de les recoller. Le micron suffit : aucune piece mecanique n'a deux sommets
# distincts a moins d'un micron, et les coordonnees d'une meme arete
# discretisee ne different que du bruit d'un flottant 32 bits.
SOUDURE_MM = 1e-3

# Les plans des faces qui meritent une ligne de maillage. Voir `_plans`.
PLAN_TOLERANCE = 0.9999     # |n.axe| au-dessus duquel une face est « plane »
PLAN_GROUPE_MM = 0.02       # deux faces a moins de cela sont un seul plan
PLAN_AIRE_MIN_MM2 = 1.0     # en dessous, c'est un detail, pas une paroi
PLANS_PAR_AXE = 16          # par corps : une piece n'emporte pas la grille

# LES PRIORITES, ET POURQUOI LE DIELECTRIQUE PASSE SOUS LA CARTE. Le substrat
# est a 1, le cuivre a 10 et au-dessus. Un plastique a 0 cede donc a la
# carte partout ou ils se recouvrent -- et ils se recouvrent souvent : un
# export mecanique porte la carte elle-meme, et un bossage de vissage touche
# le stratifie. La carte decrite par le fichier IPC-2581 est la verite ; le
# plastique autour ne la remplace pas. Le metal, lui, passe au-dessus de tout
# ce qui n'est pas un port : une pile posee sur la carte est une pile.
PRIORITE_DIELECTRIQUE = 0
PRIORITE_METAL = 20

MATERIAUX = ("metal", "dielectrique", "ignore")


# ==========================================================================
# Petits outils de lecture
# ==========================================================================
def _nb(v, defaut=0.0):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return defaut
    return x if math.isfinite(x) else defaut


def _texte(v, maxi=80):
    if not isinstance(v, str):
        return ""
    return v.strip()[:maxi]


def _trois(v, defaut=0.0):
    if not isinstance(v, (list, tuple)) or len(v) < 3:
        return [defaut, defaut, defaut]
    return [_nb(v[0], defaut), _nb(v[1], defaut), _nb(v[2], defaut)]


def _decoder(texte, code, nom, quoi):
    """Une chaine base64 -> un array.array petit-boutiste."""
    try:
        brut = base64.b64decode(texte or "", validate=False)
    except (ValueError, TypeError):
        raise ErreurPiece(
            "Le corps « %s » porte des %s illisibles." % (nom, quoi),
            "Le document a ete abime en route : reimportez la piece.")
    t = array.array(code)
    if len(brut) % t.itemsize:
        raise ErreurPiece(
            "Le corps « %s » a des %s tronques." % (nom, quoi),
            "Reimportez la piece.")
    t.frombytes(brut)
    if sys.byteorder != "little":
        t.byteswap()
    return t


# ==========================================================================
# Un corps : relu, soude, verifie -- une fois
# ==========================================================================
# LA MEME PIECE REVIENT A CHAQUE FRAPPE. La page revalide le document a
# chaque retouche d'un champ, et le document porte les triangles : relire,
# souder et verifier cent mille triangles a chaque chiffre tape rendrait le
# panneau inutilisable. Le resultat est garde, indexe par l'empreinte des
# deux chaines -- une piece qu'on deplace n'a pas change de forme.
_CACHE = collections.OrderedDict()
_PLACES = collections.OrderedDict()
# BORNES EN OCTETS ET NON EN NOMBRE D'ENTREES. Un assemblage de cent vis et un
# boitier de deux cent mille triangles ne pesent pas pareil : borner a 64
# entrees videait le cache en boucle des le 65e corps, et chaque frappe
# refaisait toute la soudure.
_CACHE_OCTETS = 256 * 1024 * 1024
_VERROU = threading.Lock()


def _poids(entree):
    return 8 * len(entree.get("sommets") or ()) + 4 * len(entree.get("faces") or ())


def _ranger(cache, cle, valeur):
    with _VERROU:
        cache[cle] = valeur
        cache.move_to_end(cle)
        total = sum(_poids(v) for v in cache.values())
        while len(cache) > 1 and total > _CACHE_OCTETS:
            _, vieux = cache.popitem(last=False)
            total -= _poids(vieux)


def _souder(s, t):
    """Recolle les sommets IDENTIQUES, retire les triangles degeneres.

    Rend (sommets en liste plate de flottants, triangles en array('I')).

    PAS DE TOLERANCE ICI, ET C'EST UNE CORRECTION. La page soude deja, a une
    vraie distance (33-pieces.js, `antSouder`), et envoie des sommets distincts.
    Les ressouder ici par ARRONDI au micron pouvait fusionner deux sommets que
    la page avait gardes -- a un micron d'ecart en diagonale, ils tombent dans
    la meme maille --, rendre leurs triangles degeneres, et refuser comme
    « ouvert » un corps que la page montrait ferme. Seuls les doublons exacts
    sont recolles : un document qui n'aurait pas ete soude est alors vu
    ouvert, ce qu'il est pour CSXCAD.
    """
    n = len(s) // 3
    cles = {}
    nouveaux = array.array("d")
    renvoi = array.array("I", bytes(4 * n))
    for i in range(n):
        x, y, z = s[3 * i], s[3 * i + 1], s[3 * i + 2]
        c = (x, y, z)
        j = cles.get(c)
        if j is None:
            j = len(nouveaux) // 3
            cles[c] = j
            nouveaux.extend((x, y, z))
        renvoi[i] = j
    faces = array.array("I")
    for k in range(0, len(t) - 2, 3):
        a, b, c = renvoi[t[k]], renvoi[t[k + 1]], renvoi[t[k + 2]]
        if a == b or b == c or a == c:
            continue
        faces.extend((a, b, c))
    return nouveaux, faces


def _bords(faces):
    """Le nombre d'aretes qui ne sont pas partagees par un nombre PAIR de
    triangles : zero pour une surface fermee.

    POURQUOI C'EST UN REFUS ET NON UN AVIS. CSXCAD decide qu'une cellule est
    dans la piece en comptant les traversees d'un rayon ; sur une surface
    ouverte, il repond « dehors » partout, SANS UN MOT. Verifie sur CSXCAD
    0.6.3 : un cube dont une face manque, ou dont les sommets ne sont pas
    recolles, rend IsInside = faux au centre meme du cube. La piece partirait
    au solveur et n'y existerait pas -- le pire des resultats, parce qu'il a
    l'air d'en etre un.
    """
    compte = {}
    for k in range(0, len(faces), 3):
        a, b, c = faces[k], faces[k + 1], faces[k + 2]
        for u, v in ((a, b), (b, c), (c, a)):
            e = (u, v) if u < v else (v, u)
            compte[e] = compte.get(e, 0) + 1
    return sum(1 for n in compte.values() if n % 2)


def _analyser(nom, s64, t64):
    cle = hashlib.sha1((s64 or "").encode("ascii", "ignore") + b"|" +
                       (t64 or "").encode("ascii", "ignore")).hexdigest()
    with _VERROU:
        if cle in _CACHE:
            _CACHE.move_to_end(cle)
            return _CACHE[cle]

    s = _decoder(s64, "f", nom, "sommets")
    t = _decoder(t64, "I", nom, "triangles")
    if len(s) % 3 or len(t) % 3:
        raise ErreurPiece("Le corps « %s » est mal forme." % nom,
                          "Reimportez la piece.")
    n = len(s) // 3
    if n < 4 or len(t) < 12:
        raise ErreurPiece(
            "Le corps « %s » n'a pas de volume : %d sommet(s), %d triangle(s)."
            % (nom, n, len(t) // 3),
            "Un volume ferme demande au moins quatre triangles. Marquez ce "
            "corps « ignore » s'il ne represente rien.")
    if max(t) >= n:
        raise ErreurPiece(
            "Le corps « %s » designe un sommet qui n'existe pas." % nom,
            "Reimportez la piece.")
    for v in s:
        if not math.isfinite(v):
            raise ErreurPiece(
                "Le corps « %s » a un sommet non fini (NaN ou infini)." % nom,
                "Le fichier source est abime a cet endroit.")

    sommets, faces = _souder(s, t)
    if len(faces) < 12:
        raise ErreurPiece(
            "Le corps « %s » s'efface a la soudure : il est plat ou "
            "degenere." % nom,
            "Marquez-le « ignore ».")
    xs, ys, zs = sommets[0::3], sommets[1::3], sommets[2::3]
    out = {
        "sommets": sommets,
        "faces": faces,
        "n_sommets": len(sommets) // 3,
        "n_triangles": len(faces) // 3,
        "bords": _bords(faces),
        "boite": (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)),
    }
    out["cle"] = cle
    _ranger(_CACHE, cle, out)
    return out


def _place(a, R, centre, pos):
    """Les sommets places, l'emprise et les plans d'un corps -- en cache.

    La page revalide a chaque frappe, meme quand on ne touche qu'a la bande :
    refaire la transformation et la recherche des plans de chaque corps en
    Python, a chaque fois, coutait des secondes sur un gros boitier. Une piece
    qui n'a pas bouge rend ce qu'elle rendait.
    """
    cle = (a["cle"], tuple(round(v, 12) for l in R for v in l),
           tuple(round(v, 9) for v in centre), tuple(round(v, 9) for v in pos))
    with _VERROU:
        if cle in _PLACES:
            _PLACES.move_to_end(cle)
            return _PLACES[cle]
    s = _transformer(a["sommets"], R, centre, pos)
    out = {"sommets": s, "faces": a["faces"],
           "emprise": (min(s[0::3]), min(s[1::3]), min(s[2::3]),
                       max(s[0::3]), max(s[1::3]), max(s[2::3])),
           "plans": _plans(s, a["faces"])}
    _ranger(_PLACES, cle, out)
    return out


# ==========================================================================
# Le placement
# ==========================================================================
def _rotation(rx, ry, rz):
    """R = Rz.Ry.Rx, angles en degres : on tourne d'abord autour de X, puis
    de Y, puis de Z, les trois axes etant ceux de la CARTE (fixes). C'est
    l'ordre dans lequel les champs se lisent, de gauche a droite."""
    a, b, c = (math.radians(v) for v in (rx, ry, rz))
    ca, sa = math.cos(a), math.sin(a)
    cb, sb = math.cos(b), math.sin(b)
    cc, sc = math.cos(c), math.sin(c)
    # Les quarts de tour rendent des zeros et des uns EXACTS : un cosinus de
    # 90 degres qui vaut 6e-17 deplacerait une face « plane » hors de son
    # plan, et son ligne de maillage avec elle.
    arr = lambda v: 0.0 if abs(v) < 1e-12 else (
        1.0 if abs(v - 1) < 1e-12 else (-1.0 if abs(v + 1) < 1e-12 else v))
    ca, sa, cb, sb, cc, sc = (arr(v) for v in (ca, sa, cb, sb, cc, sc))
    return [
        [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa],
        [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa],
        [-sb, cb * sa, cb * ca],
    ]


def _matrice(R, c, t):
    """La matrice 4x4 (rangee par colonnes, comme three.js l'attend) de
    p -> R.(p - c) + c + t. La page dessine avec ELLE, et non avec un calcul
    a elle : ce qui est vu est ce qui est simule."""
    d = [c[k] + t[k] - sum(R[k][j] * c[j] for j in range(3)) for k in range(3)]
    return [R[0][0], R[1][0], R[2][0], 0.0,
            R[0][1], R[1][1], R[2][1], 0.0,
            R[0][2], R[1][2], R[2][2], 0.0,
            d[0], d[1], d[2], 1.0]


def _transformer(sommets, R, c, t):
    out = array.array("d", bytes(8 * len(sommets)))
    d = [c[k] + t[k] - sum(R[k][j] * c[j] for j in range(3)) for k in range(3)]
    r00, r01, r02 = R[0]
    r10, r11, r12 = R[1]
    r20, r21, r22 = R[2]
    for i in range(0, len(sommets), 3):
        x, y, z = sommets[i], sommets[i + 1], sommets[i + 2]
        out[i] = r00 * x + r01 * y + r02 * z + d[0]
        out[i + 1] = r10 * x + r11 * y + r12 * z + d[1]
        out[i + 2] = r20 * x + r21 * y + r22 * z + d[2]
    return out


def _plans(sommets, faces):
    """Les plans des grandes faces d'un corps, axe par axe.

    POURQUOI UNE PAROI DEMANDE SES LIGNES. Un boitier plastique a des parois
    de un a deux millimetres ; la grille, dans l'air, en a souvent trois ou
    six. openEMS ne voit la matiere qu'aux points ou il la cherche : une paroi
    qui tombe entre deux lignes y est vue a moitie, ou pas du tout, selon
    l'endroit ou elle tombe -- et la piece change d'epaisseur quand on la
    deplace d'un demi-millimetre. Une ligne sur CHAQUE face plane d'une paroi
    lui donne au moins une cellule entiere, a son epaisseur exacte.

    Seules les faces alignees sur un axe comptent (une grille cartesienne ne
    sait pas suivre une pente), et seulement les grandes : un chanfrein, un
    congé, un logo en relief n'ont pas a mailler la boite. Les plus grandes
    d'abord, `PLANS_PAR_AXE` au plus.
    """
    aires = ({}, {}, {})
    for k in range(0, len(faces), 3):
        a, b, c = 3 * faces[k], 3 * faces[k + 1], 3 * faces[k + 2]
        ux = sommets[b] - sommets[a]
        uy = sommets[b + 1] - sommets[a + 1]
        uz = sommets[b + 2] - sommets[a + 2]
        vx = sommets[c] - sommets[a]
        vy = sommets[c + 1] - sommets[a + 1]
        vz = sommets[c + 2] - sommets[a + 2]
        n = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
        L = math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2])
        if L <= 0:
            continue
        for ax in range(3):
            if abs(n[ax]) >= PLAN_TOLERANCE * L:
                v = (sommets[a + ax] + sommets[b + ax] + sommets[c + ax]) / 3.0
                cle = round(v / PLAN_GROUPE_MM)
                aires[ax][cle] = aires[ax].get(cle, 0.0) + 0.5 * L
                break
    out = []
    for ax in range(3):
        # Deux cles voisines sont le meme plan a l'arrondi pres : on les
        # rassemble, l'aire s'ajoute et la cote est la moyenne ponderee.
        tri = sorted(aires[ax].items())
        grappes = []
        for cle, aire in tri:
            if grappes and cle - grappes[-1][0] <= 1:
                g = grappes[-1]
                g[1] += aire
                g[2] += aire * cle
                g[0] = cle
            else:
                grappes.append([cle, aire, aire * cle])
        plans = [(g[1], g[2] / g[1] * PLAN_GROUPE_MM) for g in grappes
                 if g[1] >= PLAN_AIRE_MIN_MM2]
        plans.sort(reverse=True)
        out.append(sorted(round(v, 6) for _, v in plans[:PLANS_PAR_AXE]))
    return out


# ==========================================================================
# Le document -> les pieces
# ==========================================================================
def pieces(doc_pieces, k_mm):
    """Les pieces du document, verifiees, placees, pretes a mailler.

    `k_mm` convertit l'unite du fichier (celle de la POSITION) en mm. Les
    sommets, eux, sont toujours en millimetres : c'est l'unite qu'OpenCascade
    rend, et la page ne les convertit pas.
    """
    if not isinstance(doc_pieces, list):
        return []
    if len(doc_pieces) > MAX_PIECES:
        raise ErreurPiece(
            "%d pieces importees, %d au plus." % (len(doc_pieces), MAX_PIECES),
            "Rassemblez-les dans un assemblage STEP, ou retirez celles qui "
            "sont loin de l'antenne.")
    out = []
    total = 0
    for i, p in enumerate(doc_pieces):
        if not isinstance(p, dict):
            continue
        nom = _texte(p.get("nom"), 60) or ("piece %d" % (i + 1))
        corps_doc = p.get("corps") if isinstance(p.get("corps"), list) else []
        n_sim = sum(1 for c in corps_doc if isinstance(c, dict) and
                    (_texte(c.get("materiau"), 16) or "ignore").lower()
                    in ("metal", "dielectrique"))
        if n_sim > MAX_CORPS or len(corps_doc) > MAX_CORPS_TOTAL:
            raise ErreurPiece(
                "La piece « %s » a %d corps simules (%d au total), %d au plus."
                % (nom, n_sim, len(corps_doc), MAX_CORPS),
                "Marquez « ignore » ce qui ne compte pas pour l'antenne : les "
                "composants, la visserie loin d'elle. Seuls les corps simules "
                "sont comptes.")
        rot = _trois(p.get("rotation"))
        pos = [v * k_mm for v in _trois(p.get("position"))]

        corps = []
        for j, c in enumerate(corps_doc):
            if not isinstance(c, dict):
                continue
            cn = _texte(c.get("nom"), 60) or ("corps %d" % (j + 1))
            mat = (_texte(c.get("materiau"), 16) or "ignore").lower()
            if mat not in MATERIAUX:
                mat = "ignore"
            er = _nb(c.get("er"), 0.0)
            df = max(0.0, _nb(c.get("df"), 0.0))
            if mat == "dielectrique" and not (er >= 1.0):
                raise ErreurPiece(
                    "Le corps « %s » de « %s » a une permittivite de %s."
                    % (cn, nom, er),
                    "Une permittivite relative vaut au moins 1 (le vide). "
                    "Choisissez une matiere dans la liste, ou saisissez "
                    "celle de la fiche du fournisseur.")
            # UN CORPS IGNORE NE VOYAGE PAS AVEC SES TRIANGLES. Un export
            # mecanique complet porte la carte, ses deux cents composants,
            # la visserie : les renvoyer a chaque frappe pour ne rien en
            # faire serait le gros du document. Son nom suffit au bilan.
            a = None
            if mat != "ignore":
                a = _analyser("%s / %s" % (nom, cn), c.get("sommets"),
                              c.get("triangles"))
            corps.append({"nom": cn, "materiau": mat,
                          "matiere": _texte(c.get("matiere"), 30),
                          "er": er, "df": df,
                          "_a": a})
            if a is not None:
                total += a["n_triangles"]
                if a["bords"]:
                    raise ErreurPiece(
                        "Le corps « %s » de « %s » n'est pas ferme : %d "
                        "arete(s) ne bordent qu'une face."
                        % (cn, nom, a["bords"]),
                        "openEMS ne saurait pas dire ce qui est dedans : il "
                        "l'ignorerait sans rien dire. Marquez ce corps "
                        "« ignore », ou reexportez la piece en solide (et "
                        "non en surfaces) depuis l'outil de mecanique.")

        if total > MAX_TRIANGLES:
            raise ErreurPiece(
                "%d triangles dans les pieces importees, %d au plus."
                % (total, MAX_TRIANGLES),
                "Reimportez avec une triangulation plus grossiere, ou "
                "marquez « ignore » les corps qui ne comptent pas (vis, "
                "composants loin de l'antenne).")

        # LE CENTRE DE ROTATION EST CELUI DE LA PIECE ENTIERE, corps ignores
        # compris : sans quoi ignorer une vis ferait bouger le boitier. La
        # page le calcule -- elle seule a encore les corps ignores -- et
        # l'envoie, en millimetres, dans le repere du fichier. A defaut, le
        # centre des corps recus.
        centre = p.get("centre")
        if (isinstance(centre, (list, tuple)) and len(centre) >= 3
                and all(isinstance(v, (int, float)) and math.isfinite(v)
                        for v in centre[:3])):
            centre = [float(v) for v in centre[:3]]
        else:
            bx = [c["_a"]["boite"] for c in corps if c["_a"]]
            centre = ([(min(b[k] for b in bx) + max(b[k + 3] for b in bx)) / 2.0
                       for k in range(3)] if bx else [0.0, 0.0, 0.0])
        R = _rotation(*rot)
        piece = {"id": _texte(p.get("id"), 40) or ("p%d" % i),
                 "nom": nom, "rotation": rot, "position_mm": pos,
                 "centre_mm": centre, "matrice": _matrice(R, centre, pos),
                 "corps": []}
        for c in corps:
            a = c.pop("_a")
            q = {"nom": c["nom"], "materiau": c["materiau"],
                 "matiere": c["matiere"], "er": c["er"], "df": c["df"]}
            if a is not None:
                q.update({"triangles": a["n_triangles"],
                          "sommets": a["n_sommets"],
                          "ferme": a["bords"] == 0, "bords": a["bords"]})
                pl = _place(a, R, centre, pos)
                q["emprise"] = pl["emprise"]
                q["plans"] = pl["plans"]
                q["priorite"] = (PRIORITE_METAL if c["materiau"] == "metal"
                                 else PRIORITE_DIELECTRIQUE)
                q["_geo"] = (pl["sommets"], pl["faces"])
            piece["corps"].append(q)
        inclus = [q["emprise"] for q in piece["corps"] if "emprise" in q]
        if inclus:
            piece["emprise"] = tuple(
                [min(e[k] for e in inclus) for k in range(3)] +
                [max(e[k] for e in inclus) for k in range(3, 6)])
        out.append(piece)
    return out


def corps_inclus(liste):
    """Les corps qui partent au solveur, dans l'ordre."""
    for p in liste:
        for c in p["corps"]:
            if c["materiau"] != "ignore":
                yield p, c


def emprises(liste):
    return [c["emprise"] for _, c in corps_inclus(liste)]


def sans_geometrie(modele):
    """Le modele tel que la page le recoit : sans les triangles.

    Ils y sont venus, ils n'en repartent pas. La page les a deja -- c'est elle
    qui les a envoyes --, et les lui renvoyer placés doublerait a chaque frappe
    le poids de l'aller-retour. Elle dessine avec la matrice.
    """
    if not modele.get("pieces"):
        return modele
    m = dict(modele)
    m["pieces"] = []
    for p in modele["pieces"]:
        q = dict(p)
        q["corps"] = [{k: v for k, v in c.items() if k != "_geo"}
                      for c in p["corps"]]
        m["pieces"].append(q)
    return m


def _b64(t, code):
    a = array.array(code, t)
    if sys.byteorder != "little":
        a.byteswap()
    return base64.b64encode(zlib.compress(a.tobytes(), 6)).decode("ascii")


def sommets_b64(corps):
    """Les sommets PLACES, en millimetres, flottants 64 bits compresses."""
    return _b64(corps["_geo"][0], "d")


def faces_b64(corps):
    return _b64(corps["_geo"][1], "I")
