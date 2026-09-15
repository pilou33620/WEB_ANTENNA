#!/usr/bin/python3
# -*- coding: utf-8 -*-
# ==========================================
# VERSIONING
# Version: 1.0.0
# Date: 2026-08-26
# Explication: pont entre le parseur IPC-2581 (ipc2581_parser.py, qui rend un
#   IPCDesign fait d'objets Python) et la visionneuse du navigateur (qui ne
#   sait lire que du JSON). Ce module ne parse rien et ne dessine rien : il
#   traduit, et c'est tout ce qu'il doit faire. Deux partis pris commandent la
#   forme du dictionnaire produit :
#   1. les noms qui se repetent -- couche, net -- deviennent des index dans
#      deux tableaux places en tete. Sur une carte de quelques milliers de
#      pistes, ecrire « TOP » et « GND » a chaque ligne triple le poids du
#      fichier pour rien.
#   2. les suites de points deviennent des tableaux plats [x1,y1,x2,y2,...].
#      Un objet {"x":..,"y":..} par sommet, sur un plan de masse decoupe, c'est
#      dix fois le poids des nombres qu'il porte.
#   Les cles sont courtes pour la meme raison ; le tableau de correspondance
#   est en tete de fichier, et la visionneuse le reprend a l'identique.
# Fonctions : charger_octets, design_en_dict, ipc2581_en_dict
# ==========================================
"""Traduit un IPCDesign en dictionnaire JSON pour la visionneuse web.

    >>> import ipc2581_json
    >>> modele = ipc2581_json.ipc2581_en_dict(open("carte.xml", "rb").read(),
    ...                                       "carte.xml")
    >>> modele["stats"]["composants"]
    213

Le fichier accepte tel quel : XML IPC-2581 (.xml, .cvg) ou archive ZIP en
contenant un -- les fabricants livrent souvent la seconde forme.

Cle par cle, le dictionnaire produit :

    unites      MILLIMETER ou INCH, tel que le declare le fichier
    epaisseur   epaisseur hors-tout de l'empilage
    contour     profil de la carte : {"o": [x,y,...], "t": [[x,y,...], ...]}
                (o = outline, t = trous / decoupes)
    empilage    couches physiques, dans l'ordre de sequence
    couches     noms de couches ; ailleurs, "c" est un index dans ce tableau
    nets        noms de nets   ; ailleurs, "n" est un index dans ce tableau
    pistes      {c, n, w (largeur), p (points a plat), f (remplissage)}
    arcs        {c, n, w, s (debut), e (fin), m (centre), h (horaire)}
    plans       {c, n, f, g: [{o, t}]} -- zones de cuivre remplies
    textes      {c, x, y, r (rotation), m (miroir), t}
    percages    {x, y, d (diametre), p (metallise), ps (padstack), n, a (anneau),
                 a_sup (l'anneau vient d'une pastille devinee, pas du fichier),
                 sa / sb (portee : rangs des couches de depart et d'arrivee,
                 ABSENTS quand le fichier ne la declare pas), ss (d'ou elle
                 vient : "calque" ou "padstack")}
    pads        pastilles libres : {x, y, r, m, ps, pin, n}
    composants  {ref, pkg, c, x, y, r, m, mnt, val, tol, pads, pins}
    padstacks   definitions : {trou, pad, pads: [{c, d, f (forme), a (antipad)}]}
    formes      primitives standard : cercle, rectangle, ovale, polygone...
    formesuser  formes du dictionnaire utilisateur (empreintes complexes)
    stats       comptages, pour l'entete de la visionneuse
"""

import io
import os
import zipfile

from ipc2581_data import IPCDesign
from ipc2581_parser import IPC2581Parser, IPC2581ParseError

FORMAT = "cao-ipc2581-1"

# Assez pour que le micron soit exact en millimetres comme en pouces, sans
# trainer les 17 chiffres d'un float derriere chaque sommet de polygone.
DECIMALES = 6

# Extensions rencontrees dans une archive de fabrication : IPC-2581 sort en
# .xml, parfois en .cvg (« CAD Viewable Geometry ») ou en .ipc.
EXTENSIONS = (".xml", ".cvg", ".ipc", ".ipc2581")


def _r(v):
    """Arrondit un flottant, et rend un int quand la valeur est ronde."""
    try:
        f = round(float(v), DECIMALES)
    except (TypeError, ValueError):
        return 0
    return int(f) if f == int(f) else f


def _pts(points):
    """Suite de Point -> tableau plat [x1, y1, x2, y2, ...]."""
    plat = []
    for p in points:
        plat.append(_r(p.x))
        plat.append(_r(p.y))
    return plat


def _contour(contour):
    """Contour -> {"o": [...], "t": [[...], ...]}, ou None."""
    if contour is None or not contour.outline:
        return None
    out = {"o": _pts(contour.outline)}
    trous = [_pts(c) for c in contour.cutouts if c]
    if trous:
        out["t"] = trous
    return out


class _Flux(io.BytesIO):
    """Octets en memoire qui se presentent sous le nom du fichier d'origine.

    Le parseur nomme « self.xml_file » dans ses messages d'erreur, et il les
    formate avec %s : sans cela, un XML mal forme se plaint d'un
    « <_io.BytesIO object at 0x...> », ce qui n'apprend rien a personne.
    """

    def __init__(self, data, nom):
        super().__init__(data)
        self.name = nom

    def __repr__(self):
        return self.name

    __str__ = __repr__


class _Index:
    """Tableau de noms sans doublon + acces O(1) au rang d'un nom.

    Le rang, c'est ce qui part dans le JSON a la place du nom : une carte de
    dix mille pistes porte dix mille fois le nom de sa couche, sinon.
    """

    def __init__(self):
        self.noms = []
        self._rang = {}

    def rang(self, nom):
        """Rang du nom (il est ajoute s'il est inconnu). Vide -> -1."""
        nom = (nom or "").strip()
        if not nom:
            return -1
        if nom not in self._rang:
            self._rang[nom] = len(self.noms)
            self.noms.append(nom)
        return self._rang[nom]

    def rang_connu(self, nom):
        """Rang du nom, ou -1 -- SANS L'AJOUTER.

        POURQUOI LES DEUX EXISTENT. `rang` sert a enregistrer ce qu'on a vu :
        une couche de serigraphie rencontree dans les features doit entrer dans
        le tableau. Mais une REFERENCE vers une couche -- la portee d'un
        percage, par exemple -- ne cree pas de couche : si « TOP » n'est pas
        dans l'empilage, c'est que le fichier nomme ses couches autrement, et
        l'ajouter fabriquerait un calque fantome que la visionneuse afficherait
        vide. Rendre -1 laisse l'appelant dire « portee non resolue », ce qui
        est la verite.
        """
        return self._rang.get((nom or "").strip(), -1)


def _forme_en_dict(forme):
    """ShapeDefinition -> dict, sans les champs a zero."""
    out = {"t": forme.shape_type}
    if forme.diameter:
        out["d"] = _r(forme.diameter)
    if forme.width:
        out["w"] = _r(forme.width)
    if forme.height:
        out["h"] = _r(forme.height)
    if forme.radius:
        out["r"] = _r(forme.radius)
    if forme.chamfer:
        out["ch"] = _r(forme.chamfer)
    if forme.corners:
        out["co"] = list(forme.corners)
    if forme.points:
        out["p"] = _pts(forme.points)
    if forme.fill_property and forme.fill_property != "UNKNOWN":
        out["f"] = forme.fill_property
    return out


def _pad_en_dict(pad, nets):
    """PadInstance -> dict. La couche n'y est pas : c'est le padstack qui la
    porte, une pastille traversante existant sur plusieurs couches a la fois."""
    out = {"x": _r(pad.location.x), "y": _r(pad.location.y),
           "ps": pad.padstack_ref or ""}
    if pad.rotation:
        out["r"] = _r(pad.rotation)
    if pad.mirror:
        out["m"] = 1
    if pad.pin_ref:
        out["pin"] = pad.pin_ref
    rang = nets.rang(pad.net_name)
    if rang >= 0:
        out["n"] = rang
    return out


def design_en_dict(design: IPCDesign, fichier: str = "") -> dict:
    """IPCDesign -> dictionnaire JSON pour la visionneuse."""
    couches = _Index()
    nets = _Index()

    # Les couches de l'empilage d'abord, et dans leur ordre : c'est celui de la
    # carte physique, et la visionneuse s'en sert pour l'ordre de dessin. Les
    # couches vues plus tard dans les features (serigraphie, masque, cotation)
    # viennent s'ajouter a la suite.
    empilage = []
    for couche in design.stackup:
        couches.rang(couche.name)
        empilage.append({
            "nom": couche.name,
            "seq": couche.sequence,
            "ep": _r(couche.thickness),
            "mat": couche.material,
            "dk": couche.dk,
            "df": couche.df,
            "type": couche.layer_type,
        })

    pistes, arcs, plans = [], [], []
    for net in design.nets.values():
        n = nets.rang(net.name)
        for piste in net.tracks:
            if len(piste.points) < 2:
                continue
            item = {"c": couches.rang(piste.layer_name), "n": n,
                    "w": _r(piste.width), "p": _pts(piste.points)}
            if piste.fill_property and piste.fill_property != "HOLLOW":
                item["f"] = piste.fill_property
            pistes.append(item)
        for arc in net.arcs:
            arcs.append({
                "c": couches.rang(arc.layer_name), "n": n, "w": _r(arc.width),
                "s": [_r(arc.start.x), _r(arc.start.y)],
                "e": [_r(arc.end.x), _r(arc.end.y)],
                "m": [_r(arc.center.x), _r(arc.center.y)],
                "h": 1 if arc.clockwise else 0,
            })
        for plan in net.copper_planes:
            formes = [_contour(c) for c in plan.contours]
            formes = [f for f in formes if f]
            if not formes:
                continue
            plans.append({"c": couches.rang(plan.layer_name), "n": n,
                          "f": plan.fill_property, "g": formes})

    textes = []
    for texte in design.texts:
        item = {"c": couches.rang(texte.layer_name), "t": texte.text,
                "x": _r(texte.location.x), "y": _r(texte.location.y)}
        if texte.rotation:
            item["r"] = _r(texte.rotation)
        if texte.mirror:
            item["m"] = 1
        textes.append(item)

    percages = []
    for trou in design.drills:
        item = {"x": _r(trou.location.x), "y": _r(trou.location.y),
                "d": _r(trou.diameter), "p": trou.plating or "UNKNOWN",
                "ps": trou.padstack_ref or ""}
        rang = nets.rang(trou.net_name)
        if rang >= 0:
            item["n"] = rang
        # LA PORTEE DU PERCAGE, EN RANGS DE COUCHE. Elle ne part QUE si les deux
        # bouts se resolvent sur des couches connues ET DIFFERENTES : une
        # portee a moitie resolue vaudrait moins que rien -- la visionneuse la
        # prendrait pour une declaration et bornerait le via sur une seule
        # couche, ce qui coupe un chemin de courant reel --, et une portee
        # d'une seule couche ne decrit aucun via. Absente, elle veut dire « le
        # fichier ne le dit pas », et l'outil suppose traversant EN LE DISANT.
        if trou.span_declaree:
            a = couches.rang_connu(trou.span_from)
            b = couches.rang_connu(trou.span_to)
            if a >= 0 and b >= 0 and a != b:
                item["sa"] = a
                item["sb"] = b
                item["ss"] = trou.span_source
        anneau = trou.annular_ring
        if anneau:
            item["a"] = _r(anneau)
            # UN ANNEAU DEDUIT D'UNE PASTILLE DEVINEE N'EST PAS UNE MESURE.
            # Sans ce drapeau, la fiche affiche « Anneau 0,15 mm » avec le meme
            # aplomb qu'une cote lue dans le fichier -- alors que 0,15 est la
            # moitie du « + 0,3 » que le lecteur pose lui-meme faute de
            # padstack.
            if trou.annular_ring_supposee:
                item["a_sup"] = True
        percages.append(item)

    pads = [_pad_en_dict(p, nets) for p in design.standalone_pads]

    composants = []
    for comp in design.components:
        item = {
            "ref": comp.ref_des,
            "pkg": comp.package_ref or "",
            "c": couches.rang(comp.layer_ref),
            "x": _r(comp.location.x), "y": _r(comp.location.y),
            "r": _r(comp.rotation),
            "m": 1 if comp.mirror else 0,
            "mnt": comp.mount_type or "UNKNOWN",
            "val": comp.value or "",
            "tol": comp.tolerance or "",
            "type": comp.comp_type or "",
            "part": comp.part_number or "",
            "props": comp.properties or {},
        }
        paquet = comp.package_obj
        if paquet:
            item["pads"] = [_pad_en_dict(p, nets) for p in paquet.pads]
            broches = []
            for pin in paquet.pins:
                b = {"num": pin.number, "x": _r(pin.x), "y": _r(pin.y)}
                # Le net d'une broche vient de <LogicalNet>, pas des <Pad> d'un
                # <Pin> -- ceux-la sont quasiment toujours absents d'un export
                # reel. comp.pin_nets est indexe par _parse_logical_nets.
                net_nom = comp.pin_nets.get(pin.number)
                if net_nom:
                    rang = nets.rang(net_nom)
                    if rang >= 0:
                        b["n"] = rang
                broches.append(b)
            item["pins"] = broches
        composants.append(item)

    padstacks = {}
    for nom, pdef in design.padstacks.items():
        padstacks[nom] = {
            "trou": _r(pdef.hole_diameter),
            "pad": _r(pdef.pad_diameter),
            # « la pastille est supposee » -- absent quand elle est lue, pour
            # ne pas alourdir un document ou c'est le cas ordinaire.
            **({"pad_sup": True} if pdef.pad_supposee else {}),
            "pads": [{"c": p.layer_ref, "d": _r(p.pad_diameter),
                      "f": p.shape_ref, "a": _r(p.antipad_diameter)}
                     for p in pdef.pads],
        }

    formes = {i: _forme_en_dict(f) for i, f in design.shapes.items()}

    formesuser = {}
    for nom, forme in design.user_shapes.items():
        gabarit = {}
        if forme.tracks:
            gabarit["pistes"] = [{"w": _r(t.width), "p": _pts(t.points),
                                  "f": t.fill_property}
                                 for t in forme.tracks if len(t.points) >= 2]
        if forme.arcs:
            gabarit["arcs"] = [{"w": _r(a.width),
                                "s": [_r(a.start.x), _r(a.start.y)],
                                "e": [_r(a.end.x), _r(a.end.y)],
                                "m": [_r(a.center.x), _r(a.center.y)],
                                "h": 1 if a.clockwise else 0}
                               for a in forme.arcs]
        if forme.planes:
            gabarit["plans"] = [g for g in
                                (_contour(c) for p in forme.planes for c in p.contours)
                                if g]
        if forme.texts:
            gabarit["textes"] = [{"t": t.text, "x": _r(t.location.x),
                                  "y": _r(t.location.y), "r": _r(t.rotation)}
                                 for t in forme.texts]
        formesuser[nom] = gabarit

    longueur = sum(net.total_track_length() for net in design.nets.values())
    metallises = sum(1 for d in design.drills
                     if (d.plating or "").upper().startswith("PLATED"))

    return {
        "format": FORMAT,
        "fichier": os.path.basename(fichier) if fichier else "",
        "unites": design.units,
        "epaisseur": _r(design.total_thickness),
        "contour": _contour(design.board_outline),
        "empilage": empilage,
        "couches": couches.noms,
        "nets": nets.noms,
        "pistes": pistes,
        "arcs": arcs,
        "plans": plans,
        "textes": textes,
        "percages": percages,
        "pads": pads,
        "composants": composants,
        "padstacks": padstacks,
        "formes": formes,
        "formesuser": formesuser,
        "stats": {
            "couches": len(couches.noms),
            "empilage": len(empilage),
            "nets": len(nets.noms),
            "pistes": len(pistes),
            "arcs": len(arcs),
            "plans": len(plans),
            "textes": len(textes),
            "percages": len(percages),
            "percages_metallises": metallises,
            "pads": len(pads),
            "composants": len(composants),
            "padstacks": len(padstacks),
            "longueur_cuivre": _r(longueur),
        },
    }


def charger_octets(data: bytes, nom: str = "") -> IPCDesign:
    """Octets d'un fichier (XML ou ZIP) -> IPCDesign.

    Le parseur accepte un objet fichier autant qu'un chemin : les octets
    arrivent du navigateur, rien n'oblige a les poser sur le disque d'abord.
    Leve IPC2581ParseError, comme le parseur.
    """
    if not data:
        raise IPC2581ParseError("Fichier vide.")

    interne = ""
    if data[:2] == b"PK":
        try:
            archive = zipfile.ZipFile(io.BytesIO(data))
            candidats = [i for i in archive.infolist()
                         if not i.is_dir()
                         and i.filename.lower().endswith(EXTENSIONS)]
        except (zipfile.BadZipFile, OSError) as exc:
            raise IPC2581ParseError("Archive ZIP illisible : %s" % exc) from exc
        if not candidats:
            raise IPC2581ParseError(
                "Aucun fichier IPC-2581 dans l'archive (extensions attendues : %s)."
                % ", ".join(EXTENSIONS))
        # Le plus gros : une archive de fabrication contient parfois un petit
        # fichier d'index a cote du modele, et c'est le modele qu'on veut.
        choix = max(candidats, key=lambda i: i.file_size)
        MAX_DECOMPRESSE = 200 * 1024 * 1024  # 200 Mo max
        if choix.file_size > MAX_DECOMPRESSE:
            raise IPC2581ParseError(
                "Le fichier IPC-2581 dans l'archive depasse la taille maximale autorisee (%d Mo)."
                % (MAX_DECOMPRESSE // (1024 * 1024)))
        interne = choix.filename
        # Decompression bornee en streaming pour neutraliser les Zip Bombs
        octets = []
        total_lu = 0
        with archive.open(choix) as flux_zip:
            while True:
                morceau = flux_zip.read(64 * 1024)
                if not morceau:
                    break
                total_lu += len(morceau)
                if total_lu > MAX_DECOMPRESSE:
                    raise IPC2581ParseError(
                        "Decompression interrompue : le volume reel depasse %d Mo (Zip Bomb)."
                        % (MAX_DECOMPRESSE // (1024 * 1024)))
                octets.append(morceau)
        data = b"".join(octets)

    return IPC2581Parser(_Flux(data, interne or nom or "(flux)")).parse()


def ipc2581_en_dict(data: bytes, nom: str = "") -> dict:
    """Octets d'un fichier IPC-2581 (ou ZIP) -> dictionnaire JSON."""
    return design_en_dict(charger_octets(data, nom), nom)


if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) < 2:
        print("usage: python python/ipc2581_json.py <fichier.xml|.zip> [sortie.json]")
        raise SystemExit(2)
    with open(sys.argv[1], "rb") as fichier_entree:
        modele_sortie = ipc2581_en_dict(fichier_entree.read(), sys.argv[1])
    texte = json.dumps(modele_sortie, ensure_ascii=False)
    if len(sys.argv) > 2:
        with open(sys.argv[2], "w", encoding="utf-8") as fichier_sortie:
            fichier_sortie.write(texte)
        print("%s ecrit (%d octets)" % (sys.argv[2], len(texte)))
    else:
        for cle, val in modele_sortie["stats"].items():
            print("  %-22s %s" % (cle, val))
        # L'empilage en clair : c'est lui qui commande le calcul d'impédance de
        # la visionneuse, et c'est la première chose qu'on veut vérifier quand
        # une permittivité manque à l'affichage.
        pile = modele_sortie["empilage"]
        print("\n  Empilage (%d couche(s), %s) :"
              % (len(pile), modele_sortie["unites"]))
        if not pile:
            print("    aucune — ce fichier ne decrit pas d'empilage")
        for couche in pile:
            print("    %-28s %-12s ep %-10s Dk %-8s Df %-8s %s"
                  % (couche["nom"], couche["type"] or "?",
                     couche["ep"] or "?", couche["dk"] or "?",
                     couche["df"] or "?", couche["mat"]))
