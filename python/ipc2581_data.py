# ------------------------------------------------------------------------------
# Fichier : ipc2581_data.py
# Version : 1.42
# Date    : 2026-08-24
#
# Modifications :
# - [2026-08-24] Version 1.42: Refactoring pour intégration externe
#   - Suppression des énumérations non utilisées (~600 lignes de code mort).
#   - Point : dataclass frozen + slots (hashable, ~50% moins de mémoire).
#   - Track.length : mise en cache (cached_property).
#   - add_track/add_arc/add_copper_plane : plus de perte silencieuse si net vide.
#   - Suppression du champ IPCDesign.layers et de la classe Layer (jamais peuplés).
#
# Liste des fonctions modifiées/ajoutées :
# - ✏️ Point (frozen=True, slots=True)
# - ✏️ Track.length (cached_property)
# - ✏️ IPCDesign.add_track / add_arc / add_copper_plane (warning si net vide)
# - 🗑️ Énumérations non utilisées, Layer, IPCDesign.layers
# ------------------------------------------------------------------------------

import math
import logging
from dataclasses import dataclass, field
from functools import cached_property
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Point:
    x: float
    y: float


@dataclass
class StackupLayer:
    """Représente une couche physique dans l'empilage (Stackup)."""
    name: str
    thickness: float
    sequence: int = 0
    material: str = ""
    dk: str = ""
    df: str = ""
    layer_type: str = "Unknown"  # "Signal", "GND", "Power", or "Unknown"


@dataclass
class ShapeDefinition:
    """Définit une primitive standard (cercle, rectangle, ovale, polygone)."""
    id: str
    shape_type: str            # 'CIRCLE', 'RECTCENTER', 'OVAL', 'POLYGON', 'RECTROUND', 'RECTCHAM', 'UNKNOWN'
    diameter: float = 0.0      # Pour CIRCLE
    width: float = 0.0         # Pour RECT/OVAL
    height: float = 0.0        # Pour RECT/OVAL
    radius: float = 0.0        # Pour RECTROUND
    chamfer: float = 0.0       # Pour RECTCHAM
    corners: List[str] = field(default_factory=list) # Coins affectés ('upperRight', etc.)
    points: List[Point] = field(default_factory=list) # Pour POLYGON
    fill_property: str = "UNKNOWN"

    def max_dimension(self) -> float:
        """Plus grande dimension hors-tout de la forme (diamètre équivalent)."""
        if self.shape_type == "CIRCLE":
            return self.diameter
        if self.shape_type in ("RECTCENTER", "RECTROUND", "OVAL", "RECTCHAM"):
            return max(self.width, self.height)
        if self.shape_type == "POLYGON" and self.points:
            xs = [p.x for p in self.points]
            ys = [p.y for p in self.points]
            return max(max(xs) - min(xs), max(ys) - min(ys))
        return 0.0


@dataclass
class Contour:
    """Définit un polygone avec de potentiels trous (cutouts)."""
    outline: List[Point] = field(default_factory=list)
    cutouts: List[List[Point]] = field(default_factory=list)


@dataclass
class CopperPlane:
    """Représente une zone de cuivre remplie sur le PCB."""
    layer_name: str
    net_name: str
    contours: List[Contour] = field(default_factory=list)
    fill_property: str = "FILL"


@dataclass
class PadDef:
    """Définit la géométrie d'un pad sur une couche spécifique."""
    layer_ref: str
    pad_diameter: float = 0.0
    shape_ref: str = ""
    antipad_diameter: float = 0.0


@dataclass
class PadStackDefinition:
    """Définit les propriétés physiques d'un via/pad multicouches."""
    name: str
    pad_diameter: float = 0.0  # Conservé pour rétro-compatibilité (diamètre max ou par défaut)
    hole_diameter: float = 0.0 # Diamètre défini dans le stack (par défaut)
    shape_ref: str = ""        # Conservé pour rétro-compatibilité
    pads: List[PadDef] = field(default_factory=list) # Définitions par couche
    # LA PASTILLE A-T-ELLE ÉTÉ LUE, OU DEVINÉE ? Quand un perçage de via ne
    # renvoie à aucune définition de padstack, le lecteur en fabrique une avec
    # « perçage + 0,3 mm » — soit un anneau de 0,15 mm posé par convention.
    # C'est un repli raisonnable pour dessiner quelque chose ; ce n'est PAS une
    # cote du fichier, et tout ce qui s'en sert doit pouvoir le savoir : la
    # simulation la fait entrer dans la capacité du via, le contrôle
    # d'isolation mesure des distances contre elle.
    pad_supposee: bool = False
    # LE CALQUE DE PERCAGE QUE CE PADSTACK DESIGNE. C'est <LayerHole
    # layerRef="..."> : le padstack ne dit pas lui-meme entre quelles couches
    # son trou court, il RENVOIE au calque DRILL, et c'est ce calque qui porte
    # le <Span>. Sans ce chainon, la portee d'un via se perd des que le trou est
    # decouvert par le padstack plutot que par le calque.
    hole_layer_ref: str = ""


@dataclass
class PadInstance:
    """Représente l'instanciation physique d'un Pad (dans un boîtier ou libre)."""
    padstack_ref: str
    location: Point
    rotation: float = 0.0
    mirror: bool = False
    pin_ref: str = ""
    net_name: str = ""


@dataclass
class Drill:
    """Représente un perçage physique sur la carte."""
    location: Point
    diameter: float       # Diamètre du trou
    plating: str          # PLATED (PTH) ou NONPLATED (NPTH)
    padstack_ref: str     # Référence vers la définition
    net_name: str = ""

    # ==================================================================
    # LA PORTÉE DU PERÇAGE — ENTRE QUELLES COUCHES IL COURT
    # ------------------------------------------------------------------
    # POURQUOI ELLE COMPTE, ET DES DEUX CÔTÉS. Un trou pris pour traversant
    # alors qu'il est borgne est modélisé PLUS LONG qu'il n'est : sa
    # résistance ressort surestimée dans le solveur DC — l'erreur du côté
    # prudent — mais surtout il RELIE des couches qu'il ne relie pas, ce qui
    # invente un chemin de courant. Et pour le contrôle du chemin de retour,
    # l'erreur penche du côté qui rassure : un via enterré compté comme
    # traversant fait passer pour refermée une boucle qui ne l'est pas.
    #
    # OÙ ELLE SE LIT. IPC-2581 ne la met pas sur le trou : elle est sur le
    # CALQUE de perçage, `<Layer layerFunction="DRILL"><Span fromLayer="..."
    # toLayer="..."/></Layer>`. Le perçage y renvoie par son `layerRef`, le
    # padstack par le `layerRef` de son `<LayerHole>`.
    #
    # VIDE VEUT DIRE « LE FICHIER NE LE DIT PAS », et non « traversant » :
    # tout ce qui s'en sert doit alors le supposer ET LE DIRE. Les deux
    # cas ne se confondent pas — `span_source` les distingue.
    # ==================================================================
    span_from: str = ""      # nom de la couche de départ, tel que déclaré
    span_to: str = ""        # nom de la couche d'arrivée
    span_source: str = ""    # "calque", "padstack", ou "" (non déclarée)

    # Référence vers l'objet définition pour calculs (anneaux)
    padstack_obj: Optional[PadStackDefinition] = None

    @property
    def span_declaree(self) -> bool:
        """La portée vient-elle du fichier ?"""
        return bool(self.span_from and self.span_to and self.span_source)

    @property
    def annular_ring(self) -> float:
        """Calcule la taille de l'anneau : (Diamètre Pad Max - Diamètre Trou) / 2"""
        if self.padstack_obj and self.padstack_obj.pad_diameter > self.diameter:
            return (self.padstack_obj.pad_diameter - self.diameter) / 2.0
        return 0.0

    @property
    def annular_ring_supposee(self) -> bool:
        """L'anneau vient-il du fichier, ou de la pastille devinée ?

        UN ANNEAU DE 0,15 mm QUI SORT TOUJOURS A 0,15 mm N'EST PAS UNE MESURE.
        C'est « perçage + 0,3 » divise par deux, c'est-a-dire la convention du
        lecteur relue a l'envers. Affiche comme une cote, il donne a croire que
        le fabricant a declare cet anneau-la.
        """
        return bool(self.padstack_obj and self.padstack_obj.pad_supposee)


@dataclass
class Pin:
    number: str
    x: float
    y: float
    type: str = "UNKNOWN"


@dataclass
class Package:
    name: str
    pins: List[Pin] = field(default_factory=list)
    pads: List[PadInstance] = field(default_factory=list)


@dataclass
class Component:
    ref_des: str
    package_ref: str
    layer_ref: str
    location: Point
    rotation: float = 0.0
    mirror: bool = False
    mount_type: str = "UNKNOWN"
    value: str = ""  # Valeur du composant (ex: 10k, 100nF)
    tolerance: str = ""  # Tolérance du composant (ex: +-0.1pF, 5%)
    comp_type: str = ""  # Type de composant (RESISTOR, CAPACITOR, INDUCTOR, etc.)
    part_number: str = ""  # Référence de pièce / OEMDesignNumberRef
    properties: Dict[str, str] = field(default_factory=dict)  # Propriétés personnalisées (<Property>)
    package_obj: Optional[Package] = None
    # Broche -> nom de net, tel que le donnent les <LogicalNet><PinRef> du
    # fichier -- pas les <Pad> internes a un <Pin>, quasi toujours absents
    # d'un export reel. Cle : le numero de broche (Pin.number), tel quel.
    pin_nets: Dict[str, str] = field(default_factory=dict)


@dataclass
class Track:
    width: float
    points: List[Point] = field(default_factory=list)
    layer_name: str = ""
    net_name: str = ""
    fill_property: str = "HOLLOW"

    @cached_property
    def length(self) -> float:
        """Longueur totale du tracé (mise en cache au premier accès)."""
        total = 0.0
        if len(self.points) < 2:
            return 0.0
        for i in range(len(self.points) - 1):
            total += math.hypot(self.points[i+1].x - self.points[i].x,
                                self.points[i+1].y - self.points[i].y)
        return total


@dataclass
class Arc:
    """Représente un arc de cercle."""
    width: float
    start: Point
    end: Point
    center: Point
    clockwise: bool
    layer_name: str = ""
    net_name: str = ""
    fill_property: str = "HOLLOW"


@dataclass
class TextElement:
    """Représente un texte graphique (référence, valeur, sérigraphie libre)."""
    text: str
    location: Point
    layer_name: str = ""
    net_name: str = ""
    rotation: float = 0.0
    mirror: bool = False


@dataclass
class UserShape:
    """Représente une forme personnalisée (empreinte ou polygone complexe) du dictionnaire utilisateur."""
    id: str
    tracks: List[Track] = field(default_factory=list)
    arcs: List[Arc] = field(default_factory=list)
    planes: List[CopperPlane] = field(default_factory=list)
    texts: List[TextElement] = field(default_factory=list)


@dataclass
class Net:
    name: str
    tracks: List[Track] = field(default_factory=list)
    arcs: List[Arc] = field(default_factory=list)
    copper_planes: List[CopperPlane] = field(default_factory=list)

    def total_track_length(self) -> float:
        return sum(t.length for t in self.tracks)


@dataclass
class IPCDesign:
    units: str = "MILLIMETER"
    total_thickness: float = 0.0
    board_outline: Optional[Contour] = None
    stackup: List[StackupLayer] = field(default_factory=list)
    nets: Dict[str, Net] = field(default_factory=dict)
    packages: Dict[str, Package] = field(default_factory=dict)
    components: List[Component] = field(default_factory=list)

    padstacks: Dict[str, PadStackDefinition] = field(default_factory=dict)
    standalone_pads: List[PadInstance] = field(default_factory=list)
    drills: List[Drill] = field(default_factory=list)
    shapes: Dict[str, ShapeDefinition] = field(default_factory=dict)
    user_shapes: Dict[str, UserShape] = field(default_factory=dict)
    texts: List[TextElement] = field(default_factory=list)

    def get_or_create_net(self, net_name: str) -> Net:
        if net_name not in self.nets:
            self.nets[net_name] = Net(name=net_name)
        return self.nets[net_name]

    def add_track(self, track: Track):
        if track.net_name:
            self.get_or_create_net(track.net_name).tracks.append(track)
        else:
            logger.warning("Piste ignorée (perte de données) : net_name vide, couche '%s', %d point(s)",
                           track.layer_name, len(track.points))

    def add_arc(self, arc: Arc):
        if arc.net_name:
            self.get_or_create_net(arc.net_name).arcs.append(arc)
        else:
            logger.warning("Arc ignoré (perte de données) : net_name vide, couche '%s'", arc.layer_name)

    def add_copper_plane(self, plane: CopperPlane):
        if plane.net_name:
            self.get_or_create_net(plane.net_name).copper_planes.append(plane)
        else:
            logger.warning("Plan de cuivre ignoré (perte de données) : net_name vide, couche '%s'",
                           plane.layer_name)
