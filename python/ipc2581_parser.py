# [2026-09-22] Version 1.74: seuls les calques utiles a la simulation sont lus
# Description:
#              - Un export du commerce porte des dizaines de calques qui ne
#                sont pas du cuivre : serigraphie, masque, pate, zones de
#                composant, keepouts, cotation, gabarits. Tous passaient par
#                le meme chemin que le cuivre -- sur antenna4c.xml, le contour
#                « BoardShape » et la zone « CompArea-A » ressortaient en PLANS
#                DE CUIVRE, la serigraphie en piste.
#              - Le tri se fait sur layerFunction (declare dans <Layer>) :
#                cuivre et percage sont lus, BOARD_OUTLINE ne sert que de
#                contour de repli quand <Profile> manque, le reste est ignore
#                et liste dans design.ignored_layers.
#              - Un calque SANS layerFunction reste lu, comme avant : mieux
#                vaut un calque de trop qu'un cuivre perdu.
#              - IPC2581Parser(..., tout_garder=True) retrouve l'ancien
#                comportement.
#
# Liste des fonctions ajoutees/modifiees :
# - [+] _role_calque
# - [~] _parse_ecad (filtre des LayerFeature), __init__ (tout_garder)
#
# [2026-09-03] Version 1.73: la portee des percages est enfin lue
# Description:
#              - IPC-2581 declare entre quelles couches court un percage, mais
#                pas sur le trou : sur le CALQUE de percage,
#                <Layer layerFunction="DRILL"><Span fromLayer toLayer/>. Rien
#                ne le lisait, donc TOUS les trous ressortaient traversants --
#                un via borgne ou enterre etait modelise plus long qu'il n'est
#                (resistance DC surestimee) et, pire, relie des couches qu'il
#                ne relie pas : le controle du chemin de retour faisait passer
#                pour refermee une boucle qui ne l'est pas.
#              - Le padstack sert de second chemin : son <LayerHole layerRef>
#                designe le calque de percage, donc sa portee.
#              - RIEN N'EST DEVINE D'APRES UN NOM DE CALQUE (« drill_1_4 ») :
#                une portee devinee a tort RESTREINT un via traversant et coupe
#                un chemin reel, ce qui est bien pire que de le supposer
#                traversant. Non declaree, la portee reste vide -- et
#                `span_source` permet a l'outil de le DIRE.
#
# Liste des fonctions ajoutees/modifiees :
# - [+] _lire_span, _span_du_percage
# - [~] _process_drill_layer (recoit son layerRef, pose la portee du trou)
# - [~] _parse_ecad (releve le <Span> de chaque calque)
# - [~] _parse_padstack_defs, _process_step_padstack (retiennent hole_layer_ref)
#
# [2026-08-26] Version 1.72: le net d'une broche vient enfin de <LogicalNet>
# Description:
#              - La fiche d'un boitier, dans la visionneuse, promet le net de
#                chaque broche. Rien ne le lisait : le seul chemin envisage
#                passait par les <Pad> internes a un <Pin>, presque toujours
#                absents d'un export reel -- 0 sur 285 composants sur la carte
#                de reference. Le lien existe pourtant dans le fichier, sous
#                une autre forme : <LogicalNet name="..."><PinRef
#                componentRef="U1" pin="3"/>, un element par net logique dans
#                <Ecad><CadData><Step>.
#              - Component.pin_nets (broche -> net) est rempli par
#                _parse_logical_nets, appelee juste apres les composants -- il
#                lui faut l'index refDes -> Component deja construit.
#
# Liste des fonctions ajoutées/modifiées :
# - ✨ _parse_logical_nets
# - ✏️ _parse_ecad (appel de _parse_logical_nets)
#
# [2026-08-26] Version 1.71: le lien composant -> empreinte enfin suivi
# Description:
#              - _process_component lisait l'attribut « part » la ou IPC-2581
#                met le lien vers l'empreinte, « packageRef ». Les deux ne se
#                ressemblent pas : sur un export du commerce, part vaut
#                « CONN_8-2mm-reflow » quand packageRef vaut
#                « CONN_8pts-2mm_reflow ». Le rattrapage par sous-chaine qui
#                suit n'y pouvait rien, et 282 composants sur 285 ressortaient
#                sans package_obj -- donc sans broches ni pastilles dans le
#                modele JSON, et la fiche d'un boitier annoncait « 0 broche »
#                dans la visionneuse.
#              - Trouve par le banc d'essai neuf
#                (visionneuse-ipc2581/test/banc-essai.py).
#
# Liste des fonctions modifiées :
# - ✏️ _process_component
#
# [2026-08-26] Version 1.70: les <Spec> de matériau enfin lues
# Description:
#              - La permittivité d'un stratifié ne vit jamais sur la couche
#                d'empilage : celle-ci pointe une <Spec> par un <SpecRef>. Ni
#                l'un ni l'autre n'était lu, et un fichier parfaitement
#                renseigné ressortait sans le moindre Dk -- d'où une impédance
#                calculée sur un FR-4 supposé.
#              - Deux emplacements pour ces <Spec>, et les deux se rencontrent :
#                sous <Content>, et sous <Ecad><CadHeader> -- c'est là que
#                l'écrivent les outils du commerce (vérifié sur un export
#                Altium/Zuken de 10 Mo).
#              - Deux écritures, aussi. L'attribut direct
#                (<Dielectric dielectricConstant="4.37"/>), et surtout la forme
#                « type + Property », de loin la plus courante :
#                  <Spec name="DielectricLayer-1-2_Dielectric">
#                   <Dielectric type="DIELECTRIC_CONSTANT">
#                    <Property value="4.37"/>
#                Les deux sont lues.
#              - _appliquer_specs applique la spec aux couches d'empilage, par
#                <StackupLayer> ou par <Layer>. Ce qui est écrit sur la couche
#                elle-même l'emporte.
#
# Liste des fonctions ajoutées/modifiées :
# - ✨ _parse_specs, _appliquer_specs
# - ✏️ parse, _parse_stackup, _parse_ecad, __init__
#
# [2026-08-26] Version 1.69: layerFunction retenu dans l'empilage
# Description:
#              - StackupLayer.layer_type existait mais n'était jamais rempli.
#                _parse_ecad lit déjà layerFunction pour repérer les perçages :
#                il le recopie désormais sur la couche d'empilage concernée.
#                Sans lui, rien ne distingue un conducteur d'un diélectrique
#                dans l'empilage -- ni l'épaisseur, ni le Dk, ni le nom.
#
# Liste des fonctions modifiées :
# - ✏️ _parse_ecad
#
# [2026-08-26] Version 1.68: Deux tests de vérité sur des Element XML
# Description:
#              - _parse_line_dictionary : « if line_desc » est faux pour un
#                <LineDesc lineWidth="0.2"/>, qui n'a aucun enfant. Le
#                dictionnaire des largeurs restait donc vide et toute piste
#                référençant un LineDescRef ressortait à une largeur de 0.
#              - _parse_units : même écriture sur <Ecad>, corrigée de même.
#              Les deux comparent désormais à None, comme le reste du fichier.
#
# Liste des fonctions modifiées :
# - ✏️ _parse_line_dictionary, _parse_units
#
# [2026-08-24] Version 1.67: Refactoring fiabilité & performance pour intégration externe
# Description:
#              - Nouvelle exception IPC2581ParseError (hérite de ValueError) : parse()
#                ne renvoie plus silencieusement un design vide en cas d'erreur.
#              - Suppression du handler de logging au niveau module (la bibliothèque
#                n'impose plus sa configuration de logs à l'application hôte).
#              - Suppression des print() dans la validation des vias -> logging.
#              - Helpers _safe_float/_safe_int : un attribut XML invalide ne tue
#                plus tout l'import.
#              - Plus aucun 'except: pass' nu : chaque erreur est tracée en DEBUG.
#              - Extraction des duplications : ShapeDefinition.max_dimension(),
#                _process_features(), calcul de diamètre centralisé.
#              - Parsing BOM en O(n) via index ref_des -> Component.
#              - Garde-fous sur composants/packages sans refDes/name.
#              - Nouvelle API courte : parse_ipc2581_file(path).
#
# Liste des fonctions modifiées :
# - ✏️ parse (levée d'exception au lieu de retour partiel)
# - ✏️ _validate_vias_human_check (logging au lieu de print)
# - ✨ _safe_float / _safe_int / _process_features / parse_ipc2581_file
# - ✏️ _parse_bom (recherche O(n))
# - ✏️ _parse_padstack_defs / _process_step_padstack / _process_pad_instance
#      (utilisation de ShapeDefinition.max_dimension)
# - ✏️ Toutes les conversions numériques via _safe_float/_safe_int

import xml.etree.ElementTree as ET
import re
import math
import logging
from typing import Dict, Optional, List

from ipc2581_data import (IPCDesign, Net, Track, Point, Component, Package, Pin,
                          Drill, PadStackDefinition, PadDef, ShapeDefinition,
                          Contour, CopperPlane, StackupLayer, Arc, UserShape,
                          TextElement, PadInstance)

logger = logging.getLogger(__name__)

# Précision (décimales) utilisée pour dédupliquer les positions de vias
_VIA_COORD_PRECISION = 4


class IPC2581ParseError(ValueError):
    """Levée lorsque le fichier IPC-2581 ne peut pas être parsé (fichier absent, XML corrompu, etc.)."""


def parse_ipc2581_file(xml_file: str) -> IPCDesign:
    """API courte d'intégration : parse un fichier IPC-2581 et retourne l'IPCDesign.

    Lève IPC2581ParseError en cas d'échec.
    """
    return IPC2581Parser(xml_file).parse()


# layerFunction IPC-2581 qui designent du cuivre (CONDUCTOR, SIGNAL, PLANE,
# MIXED, CONDFILM, CONDFOIL, POWER_GROUND...). Meme famille que celle que la
# page reconnait (js/02-modele.js).
_RE_FONCTION_CUIVRE = re.compile(r"COND|SIGNAL|PLANE|POWER|GROUND|MIXED")


class IPC2581Parser:
    def __init__(self, xml_file: str, tout_garder: bool = False):
        self.xml_file = xml_file
        # False : seuls cuivre, percages et contour sont lus (voir _role_calque)
        self.tout_garder = tout_garder
        self.tree = None
        self.root = None
        self.ns: Dict[str, str] = {}
        self.line_width_dict: Dict[str, float] = {}
        self.specs: Dict[str, Dict[str, str]] = {}
        self.design = IPCDesign()
        self.inline_ps_counter = 0

        # Structures pour le comptage et le dédoublonnage des vias
        self.detected_via_counts: Dict[str, int] = {}
        self.via_def_names = set()
        self.via_locations = set()
        # LA PORTÉE DES CALQUES DE PERÇAGE : nom du calque -> (depuis, vers).
        # C'est le seul endroit où IPC-2581 la déclare, et c'est ce qui
        # distingue un via traversant d'un borgne ou d'un enterré. Voir
        # `_lire_span`.
        self.drill_spans: Dict[str, tuple] = {}

    def _verifier_xml_sur(self):
        """Rejette les entites DTD XML (<!ENTITY) pour prevenir les attaques Billion Laughs / DoS."""
        if hasattr(self.xml_file, "seek") and hasattr(self.xml_file, "read"):
            pos = self.xml_file.tell()
            self.xml_file.seek(0)
            debut = self.xml_file.read(65536)
            self.xml_file.seek(pos)
            debut_b = debut.encode("utf-8", errors="ignore") if isinstance(debut, str) else bytes(debut)
            if b"<!ENTITY" in debut_b.upper():
                raise IPC2581ParseError("Declaration d'entite XML interdite (<!ENTITY).")
        elif isinstance(self.xml_file, str):
            try:
                import os
                if os.path.isfile(self.xml_file):
                    with open(self.xml_file, "rb") as f:
                        debut_b = f.read(65536)
                        if b"<!ENTITY" in debut_b.upper():
                            raise IPC2581ParseError("Declaration d'entite XML interdite (<!ENTITY).")
            except OSError:
                pass

    def parse(self) -> IPCDesign:
        logger.info(f"Début de l'import du fichier IPC-2581 : {self.xml_file}")
        self._verifier_xml_sur()
        try:
            self.tree = ET.parse(self.xml_file)
            self.root = self.tree.getroot()
            logger.info("Fichier XML chargé avec succès.")

            if self.root.tag.startswith("{"):
                uri = self.root.tag.split("}")[0].strip("{")
                self.ns = {'ipc': uri}
                logger.debug(f"Espace de nom détecté : {uri}")
            else:
                self.ns = {}
                logger.debug("Aucun espace de nom détecté.")

            logger.info("Étape 1/6 : Extraction des unités...")
            self._parse_units()

            logger.info("Étape 2/6 : Parsing du dictionnaire de lignes...")
            self._parse_line_dictionary()

            logger.info("Étape 3/6 : Parsing du dictionnaire standard...")
            self._parse_standard_dictionary()

            logger.info("Étape 4/6 : Parsing du dictionnaire utilisateur...")
            self._parse_user_dictionary()

            logger.info("Étape 5/6 : Parsing des définitions de padstacks...")
            self._parse_padstack_defs()

            self._parse_specs()

            logger.info("Étape 6/6 : Parsing des données ECAD (composants, empilement, etc.)...")
            self._parse_ecad()

            logger.info("Extraction des valeurs et tolérances depuis le BOM...")
            self._parse_bom()

            self._validate_vias_human_check()

            total_tracks = sum(len(net.tracks) for net in self.design.nets.values())
            total_nets = len(self.design.nets)

            logger.info(f"Import terminé avec succès :")
            logger.info(f"  - Composants : {len(self.design.components)}")
            logger.info(f"  - Vias / Perçages : {len(self.design.drills)}")
            logger.info(f"  - Pistes (Tracks) : {total_tracks}")
            logger.info(f"  - Nets : {total_nets}")
            logger.info(f"  - Unités : {self.design.units}")
            return self.design

        except FileNotFoundError as e:
            logger.error(f"Fichier introuvable : {self.xml_file}")
            raise IPC2581ParseError(f"Fichier introuvable : {self.xml_file}") from e
        except ET.ParseError as e:
            logger.error(f"XML invalide ou corrompu : {self.xml_file} ({e})")
            raise IPC2581ParseError(f"XML invalide ou corrompu : {self.xml_file} ({e})") from e
        except Exception as e:
            logger.error(f"Erreur critique lors du parsing : {e}", exc_info=True)
            raise IPC2581ParseError(f"Erreur lors du parsing de {self.xml_file} : {e}") from e

    # ------------------------------------------------------------------
    # Helpers génériques
    # ------------------------------------------------------------------

    @staticmethod
    def _safe_float(value, default: float = 0.0) -> float:
        """Convertit en float sans lever d'exception (attribut XML manquant/invalide)."""
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _safe_int(value, default: int = 0) -> int:
        """Convertit en int sans lever d'exception."""
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return default

    def _tag(self, tag_name: str) -> str:
        if self.ns:
            return f"{{{self.ns['ipc']}}}{tag_name}"
        return tag_name

    @staticmethod
    def _local_tag(elem: ET.Element) -> str:
        """Nom de balise sans espace de nom, en minuscules."""
        return elem.tag.split('}')[-1].lower()

    def _shape_max_dimension(self, shape_ref: str) -> float:
        """Diamètre équivalent (plus grande dimension) d'une forme référencée."""
        shape = self.design.shapes.get(shape_ref)
        return shape.max_dimension() if shape else 0.0

    @staticmethod
    def _extraire_val_tol(texte: str):
        """Extrait la valeur physique et la tolérance d'une chaîne (ex: 100nF, 10k, 4R7, 10uH, RES-10K)."""
        if not texte:
            return ("", "")
        t = str(texte).strip()
        tol = ""
        tol_match = re.search(r'(?P<tol>\+-[\d\.]+[a-zA-Z]*|\d+(?:\.\d+)?%)', t)
        if tol_match:
            tol = tol_match.group('tol')

        # 1. Unité explicite F, H, R, O, Ohm, Hz ou notation 4R7
        val = ""
        m1 = re.search(
            r'(?:^|[\s_\-–])(?P<val>\d+(?:\.\d+)?[pnumkKMG]?(?:[FROH]|Ohm|hz|Hz)+|\d+[R]\d+|\d+(?:\.\d+)?(?:MHz|KHz|Hz))(?:[\s_\-+%/\)]|$)',
            t, re.IGNORECASE
        )
        if m1:
            val = m1.group('val')
        else:
            # 2. Multiplicateur seul sans unité explicite (ex: 10k, 4.7k, 1M, 100R, 2K2)
            m2 = re.search(
                r'(?:^|[\s_\-–])(?P<val>\d+(?:\.\d+)?[KMR]|\d+[KM]\d+)(?:[\s_\-+%/\)]|$)',
                t, re.IGNORECASE
            )
            if m2:
                val = m2.group('val')

        return (val, tol)

    @staticmethod
    def _qualifier_type_composant(ref_des: str, val: str = "", props: Optional[Dict[str, str]] = None) -> str:
        """Détermine le type de composant : RESISTOR, CAPACITOR, INDUCTOR, DIODE, etc."""
        rd = (ref_des or "").strip().upper()
        # 1. Propriétés explicites
        if props:
            for k in ("TYPE", "COMPONENT_TYPE", "CATEGORY", "DEVICE"):
                for prop_k, prop_v in props.items():
                    if prop_k.upper() == k:
                        pv = prop_v.upper()
                        if "RES" in pv:
                            return "RESISTOR"
                        if "CAP" in pv:
                            return "CAPACITOR"
                        if "IND" in pv or "COIL" in pv or "CHOKE" in pv:
                            return "INDUCTOR"
                        if "DIODE" in pv or "LED" in pv:
                            return "DIODE"
                        if "TRANS" in pv or "MOSFET" in pv:
                            return "TRANSISTOR"
                        if "IC" in pv or "CIRCUIT" in pv:
                            return "IC"
                        if "CONN" in pv or "HEADER" in pv:
                            return "CONNECTOR"

        # 2. Préfixe du RefDes (norme IEEE 315 / ASME Y14.44 / usage CAO)
        m = re.match(r"^([A-Z]+)", rd)
        pfx = m.group(1) if m else ""

        if pfx in ("R", "RN", "RT", "RV", "POT", "RP", "VR"):
            return "RESISTOR"
        if pfx in ("C", "CN", "CP", "TC"):
            return "CAPACITOR"
        if pfx in ("L", "FB", "IND", "BEAD", "CH"):
            return "INDUCTOR"
        if pfx in ("D", "CR", "LED", "TVS", "ZD"):
            return "DIODE"
        if pfx in ("Q", "TR", "MOS", "FET", "T"):
            return "TRANSISTOR"
        if pfx in ("U", "IC"):
            return "IC"
        if pfx in ("J", "P", "CON", "CONN", "HDR"):
            return "CONNECTOR"
        if pfx in ("Y", "X", "XTAL", "OSC"):
            return "CRYSTAL"
        if pfx in ("TP", "TEST"):
            return "TESTPOINT"
        if pfx in ("F", "FUSE"):
            return "FUSE"
        if pfx in ("SW", "PB"):
            return "SWITCH"

        # 3. Unité dans la valeur si le préfixe est inhabituel
        v_upper = (val or "").upper()
        if any(u in v_upper for u in ("PF", "NF", "UF", "MF", " F")) or v_upper.endswith("F"):
            if not any(u in v_upper for u in ("HZ", "HENRY")):
                return "CAPACITOR"
        if any(u in v_upper for u in ("NH", "UH", "MH", " H")) or v_upper.endswith("H"):
            return "INDUCTOR"
        if any(u in v_upper for u in ("OHM", "KOHM", "MOHM", "Ω")) or re.search(r'\d+R\d+|\d+[KMR]$', v_upper):
            return "RESISTOR"

        return "UNKNOWN"

    def _lire_proprietes(self, elem: ET.Element) -> Dict[str, str]:
        """Lit les balises <Property>, <NonstandardAttribute> et <Characteristics> d'un élément XML."""
        props: Dict[str, str] = {}
        for p in elem.findall(self._tag("Property")):
            nom = p.attrib.get("name") or p.attrib.get("property") or ""
            val = p.attrib.get("value") or p.attrib.get("val") or ""
            if nom and val:
                props[nom] = val
        for p in elem.findall(self._tag("NonstandardAttribute")):
            nom = p.attrib.get("name") or ""
            val = p.attrib.get("value") or ""
            if nom and val:
                props[nom] = val
        chars = elem.find(self._tag("Characteristics"))
        if chars is not None:
            for child in chars:
                tag = self._local_tag(child)
                c_val = child.attrib.get("value", "")
                c_tol = child.attrib.get("tolerance", "")
                if c_val:
                    props[tag.upper()] = c_val
                if c_tol:
                    props[f"{tag.upper()}_TOLERANCE"] = c_tol
        return props

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def _validate_vias_human_check(self):
        if not self.detected_via_counts:
            logger.info("Aucun via détecté pour validation.")
            return

        logger.info("=" * 60)
        logger.info("TYPES ET NOMBRES DE VIAS DÉTECTÉS (occurrences physiques) :")
        for via_name, count in sorted(self.detected_via_counts.items()):
            logger.info(f"  - {via_name} : {count} instance(s)")
        logger.info("=" * 60)

    # ------------------------------------------------------------------
    # Étape 1 : Unités
    # ------------------------------------------------------------------

    def _parse_units(self):
        content = self.root.find(self._tag("Content"))
        if content is not None:
            line_dict = content.find(self._tag("DictionaryLineDesc"))
            if line_dict is not None and "units" in line_dict.attrib:
                self.design.units = line_dict.attrib["units"]
                logger.info(f"Unités trouvées (DictionaryLineDesc): {self.design.units}")
            ecad = self.root.find(self._tag("Ecad"))
            # « is not None » et non « if ecad » : un Element sans enfant est
            # faux au sens booléen, et <Ecad> peut n'en avoir qu'un seul.
            if ecad is not None:
                header = ecad.find(self._tag("CadHeader"))
                if header is not None and "units" in header.attrib:
                    self.design.units = header.attrib["units"]
                    logger.info(f"Unités trouvées (CadHeader): {self.design.units}")

    # ------------------------------------------------------------------
    # Étape 2 : Dictionnaire de lignes
    # ------------------------------------------------------------------

    def _parse_line_dictionary(self):
        content = self.root.find(self._tag("Content"))
        if content is None:
            return
        dict_line = content.find(self._tag("DictionaryLineDesc"))
        if dict_line is None:
            return
        for entry in dict_line.findall(self._tag("EntryLineDesc")):
            entry_id = entry.attrib.get("id")
            line_desc = entry.find(self._tag("LineDesc"))
            # <LineDesc lineWidth="0.2"/> n'a pas d'enfant : « if line_desc »
            # le déclarait faux et le dictionnaire restait vide -- toutes les
            # pistes du fichier se retrouvaient alors à une largeur nulle.
            if entry_id and line_desc is not None:
                self.line_width_dict[entry_id] = self._safe_float(line_desc.attrib.get("lineWidth"))

    # ------------------------------------------------------------------
    # Étape 3 : Dictionnaire standard
    # ------------------------------------------------------------------

    def _parse_standard_dictionary(self):
        content = self.root.find(self._tag("Content"))
        if content is None:
            return
        std_dict = content.find(self._tag("DictionaryStandard"))
        if std_dict is None:
            return

        for entry in std_dict.findall(self._tag("EntryStandard")):
            entry_id = entry.attrib.get("id")
            if not entry_id:
                continue

            shape_def = ShapeDefinition(id=entry_id, shape_type="UNKNOWN")

            circle = entry.find(self._tag("Circle"))
            if circle is not None:
                shape_def.shape_type = "CIRCLE"
                shape_def.diameter = self._safe_float(circle.attrib.get("diameter"))
                shape_def.fill_property = self._get_fill_desc(circle)

            rect = entry.find(self._tag("RectCenter"))
            if rect is not None:
                shape_def.shape_type = "RECTCENTER"
                shape_def.width = self._safe_float(rect.attrib.get("width"))
                shape_def.height = self._safe_float(rect.attrib.get("height"))
                shape_def.fill_property = self._get_fill_desc(rect)

            oval = entry.find(self._tag("Oval"))
            if oval is not None:
                shape_def.shape_type = "OVAL"
                shape_def.width = self._safe_float(oval.attrib.get("width"))
                shape_def.height = self._safe_float(oval.attrib.get("height"))
                shape_def.fill_property = self._get_fill_desc(oval)

            rect_round = entry.find(self._tag("RectRound"))
            if rect_round is not None:
                shape_def.shape_type = "RECTROUND"
                shape_def.width = self._safe_float(rect_round.attrib.get("width"))
                shape_def.height = self._safe_float(rect_round.attrib.get("height"))
                shape_def.radius = self._safe_float(rect_round.attrib.get("radius"))
                for corner in ["upperRight", "upperLeft", "lowerRight", "lowerLeft"]:
                    if rect_round.attrib.get(corner, "false").lower() == "true":
                        shape_def.corners.append(corner)
                shape_def.fill_property = self._get_fill_desc(rect_round)

            rect_cham = entry.find(self._tag("RectCham"))
            if rect_cham is not None:
                shape_def.shape_type = "RECTCHAM"
                shape_def.width = self._safe_float(rect_cham.attrib.get("width"))
                shape_def.height = self._safe_float(rect_cham.attrib.get("height"))
                shape_def.chamfer = self._safe_float(rect_cham.attrib.get("chamfer"))
                for corner in ["upperRight", "upperLeft", "lowerRight", "lowerLeft"]:
                    if rect_cham.attrib.get(corner, "false").lower() == "true":
                        shape_def.corners.append(corner)
                shape_def.fill_property = self._get_fill_desc(rect_cham)

            contour = entry.find(self._tag("Contour"))
            polygon = entry.find(self._tag("Polygon"))
            if polygon is None and contour is not None:
                polygon = contour.find(self._tag("Polygon"))

            if polygon is not None:
                shape_def.shape_type = "POLYGON"
                shape_def.points = self._parse_polygon(polygon)
                shape_def.fill_property = self._get_fill_desc(polygon)

            self.design.shapes[entry_id] = shape_def

    # ------------------------------------------------------------------
    # Étape 4 : Dictionnaire utilisateur
    # ------------------------------------------------------------------

    def _parse_user_dictionary(self):
        content = self.root.find(self._tag("Content"))
        if content is None:
            return
        user_dict = content.find(self._tag("DictionaryUser"))
        if user_dict is None:
            return

        for entry in user_dict.findall(self._tag("EntryUser")):
            entry_id = entry.attrib.get("id")
            if not entry_id:
                continue

            user_shape = UserShape(id=entry_id)

            for line in entry.iter(self._tag("Line")):
                try:
                    p1 = Point(float(line.attrib["startX"]), float(line.attrib["startY"]))
                    p2 = Point(float(line.attrib["endX"]), float(line.attrib["endY"]))
                    width = self._get_width(line)
                    fill_prop = self._get_fill_desc(line)
                    user_shape.tracks.append(Track(width=width, points=[p1, p2], fill_property=fill_prop))
                except Exception as e:
                    logger.debug("Ligne ignorée dans EntryUser '%s' : %s", entry_id, e)

            for poly in entry.iter(self._tag("Polyline")):
                width = self._get_width(poly)
                fill_prop = self._get_fill_desc(poly)
                points = self._parse_polygon(poly)
                if len(points) >= 2:
                    user_shape.tracks.append(Track(width=width, points=points, fill_property=fill_prop))

            for arc in entry.iter(self._tag("Arc")):
                try:
                    start = Point(float(arc.attrib["startX"]), float(arc.attrib["startY"]))
                    end = Point(float(arc.attrib["endX"]), float(arc.attrib["endY"]))
                    center = Point(float(arc.attrib["centerX"]), float(arc.attrib["centerY"]))
                    clockwise = arc.attrib.get("clockwise", "false").lower() == "true"
                    width = self._get_width(arc)
                    fill_prop = self._get_fill_desc(arc)
                    user_shape.arcs.append(Arc(width=width, start=start, end=end, center=center,
                                               clockwise=clockwise, fill_property=fill_prop))
                except Exception as e:
                    logger.debug("Arc ignoré dans EntryUser '%s' : %s", entry_id, e)

            for contour in entry.iter(self._tag("Contour")):
                polygon = contour.find(self._tag("Polygon"))
                if polygon is not None:
                    outline_points = self._parse_polygon(polygon)
                    if len(outline_points) >= 3:
                        contour_data = Contour(outline=outline_points)
                        fill_prop = self._get_fill_desc(polygon)

                        for cutout in contour.findall(self._tag("Cutout")):
                            cutout_points = self._parse_polygon(cutout)
                            if len(cutout_points) >= 3:
                                contour_data.cutouts.append(cutout_points)

                        user_shape.planes.append(CopperPlane(layer_name="", net_name="",
                                                             contours=[contour_data], fill_property=fill_prop))

            for text_node in entry.iter(self._tag("Text")):
                self._process_text(text_node, "", "", user_shape.texts)

            self.design.user_shapes[entry_id] = user_shape

    # ------------------------------------------------------------------
    # Accesseurs génériques
    # ------------------------------------------------------------------

    def _get_width(self, elem: ET.Element) -> float:
        line_desc = elem.find(self._tag("LineDesc"))
        if line_desc is not None and "lineWidth" in line_desc.attrib:
            return self._safe_float(line_desc.attrib["lineWidth"])
        ref_id = elem.find(self._tag("LineDescRef"))
        if ref_id is not None:
            return self.line_width_dict.get(ref_id.attrib.get("id"), 0.0)
        return 0.0

    def _get_location(self, parent_elem: ET.Element) -> Point:
        loc = parent_elem.find(self._tag("Location"))
        if loc is not None:
            return Point(self._safe_float(loc.attrib.get("x")), self._safe_float(loc.attrib.get("y")))
        return Point(0.0, 0.0)

    def _get_fill_desc(self, parent_elem: ET.Element) -> str:
        fill_desc = parent_elem.find(self._tag("FillDesc"))
        if fill_desc is not None:
            return fill_desc.attrib.get("fillProperty", "HOLLOW").upper()
        return "UNKNOWN"

    # ------------------------------------------------------------------
    # Étape 5 : Définitions de padstacks
    # ------------------------------------------------------------------

    def _parse_padstack_defs(self):
        for elem in self.root.iter():
            tag = self._local_tag(elem)
            if tag in ["padstackdef", "padstack"]:
                name = elem.attrib.get("name")
                if not name:
                    name = elem.attrib.get("id")
                if not name:
                    for child in elem:
                        if self._local_tag(child) in ["padstackholedef", "layerhole", "hole"]:
                            name = child.attrib.get("name")
                            break
                if not name:
                    continue

                if name in self.design.padstacks:
                    pdef = self.design.padstacks[name]
                else:
                    pdef = PadStackDefinition(name=name)

                is_via = False
                if elem.attrib.get("padUsage", "").upper() == "VIA":
                    is_via = True

                for child in elem:
                    child_tag = self._local_tag(child)

                    if child_tag in ["padstackholedef", "layerhole", "hole"]:
                        # LE CALQUE DE PERCAGE QUE LE TROU DESIGNE : c'est lui
                        # qui portera le <Span>, donc la portee du via. On le
                        # retient ici parce que c'est le seul endroit ou le lien
                        # existe -- le trou lui-meme ne dit rien de ses couches.
                        if child.attrib.get("layerRef"):
                            pdef.hole_layer_ref = child.attrib["layerRef"]
                        if "diameter" in child.attrib:
                            pdef.hole_diameter = self._safe_float(child.attrib.get("diameter"))
                        else:
                            for sub in child:
                                if self._local_tag(sub) == "circle":
                                    pdef.hole_diameter = self._safe_float(sub.attrib.get("diameter"))

                    elif child_tag in ["padstackpaddef", "layerpad"]:
                        layer_ref = child.attrib.get("layerRef", "UNKNOWN")
                        pad_use = child.attrib.get("padUse", "REGULAR").upper()
                        if child.attrib.get("padUsage", "").upper() == "VIA":
                            is_via = True

                        current_pad_diam = 0.0
                        current_shape_ref = ""

                        if "diameter" in child.attrib:
                            current_pad_diam = self._safe_float(child.attrib.get("diameter"))

                        for sub in child:
                            sub_tag = self._local_tag(sub)
                            if sub_tag == "circle":
                                current_pad_diam = self._safe_float(sub.attrib.get("diameter"))
                            elif sub_tag == "standardprimitiveref":
                                current_shape_ref = sub.attrib.get("id", "")

                        if current_shape_ref and current_pad_diam == 0.0:
                            current_pad_diam = self._shape_max_dimension(current_shape_ref)

                        if pad_use == "REGULAR" and current_pad_diam > pdef.pad_diameter:
                            pdef.pad_diameter = current_pad_diam

                        existing_pdef = next((p for p in pdef.pads if p.layer_ref == layer_ref), None)
                        if not existing_pdef:
                            existing_pdef = PadDef(layer_ref=layer_ref)
                            pdef.pads.append(existing_pdef)

                        if pad_use == "ANTIPAD":
                            existing_pdef.antipad_diameter = current_pad_diam
                        else:
                            existing_pdef.pad_diameter = current_pad_diam
                            existing_pdef.shape_ref = current_shape_ref

                if is_via:
                    self.via_def_names.add(name)

                self.design.padstacks[name] = pdef

    def _process_step_padstack(self, ps_elem: ET.Element):
        net_name = ps_elem.attrib.get("net", "")

        self.inline_ps_counter += 1
        ps_name = f"inline_step_ps_{self.inline_ps_counter}"
        pdef = PadStackDefinition(name=ps_name)

        loc = None
        rot = 0.0
        mirror = False
        pin_ref = ""

        for hole in ps_elem.findall(self._tag("LayerHole")):
            if hole.attrib.get("layerRef"):
                pdef.hole_layer_ref = hole.attrib["layerRef"]
            if "diameter" in hole.attrib:
                pdef.hole_diameter = self._safe_float(hole.attrib["diameter"])
                loc_node = hole.find(self._tag("Location"))
                if loc_node is not None:
                    loc = Point(self._safe_float(loc_node.attrib.get("x")),
                                self._safe_float(loc_node.attrib.get("y")))
                else:
                    if "x" in hole.attrib and "y" in hole.attrib:
                        loc = Point(self._safe_float(hole.attrib["x"]), self._safe_float(hole.attrib["y"]))

        for lpad in ps_elem.findall(self._tag("LayerPad")):
            layer_ref = lpad.attrib.get("layerRef", "")
            pad_use = lpad.attrib.get("padUse", "REGULAR").upper()

            if not loc:
                loc_node = lpad.find(self._tag("Location"))
                if loc_node is not None:
                    loc = Point(self._safe_float(loc_node.attrib.get("x")),
                                self._safe_float(loc_node.attrib.get("y")))

            xform = lpad.find(self._tag("Xform"))
            if xform is not None:
                rot = self._safe_float(xform.attrib.get("rotation"))
                mirror = xform.attrib.get("mirror", "false").lower() == "true"

            pref = lpad.find(self._tag("StandardPrimitiveRef"))
            if pref is None:
                pref = lpad.find(self._tag("UserPrimitiveRef"))

            shape_ref = pref.attrib.get("id", "") if pref is not None else ""

            pad_diam = self._shape_max_dimension(shape_ref) if shape_ref else 0.0

            existing_pdef = next((p for p in pdef.pads if p.layer_ref == layer_ref), None)
            if not existing_pdef:
                existing_pdef = PadDef(layer_ref=layer_ref)
                pdef.pads.append(existing_pdef)

            if pad_use == "ANTIPAD":
                existing_pdef.antipad_diameter = pad_diam
            else:
                existing_pdef.pad_diameter = pad_diam
                existing_pdef.shape_ref = shape_ref

            pin_node = lpad.find(self._tag("PinRef"))
            if pin_node is not None and not pin_ref:
                comp_ref = pin_node.attrib.get("componentRef", "")
                pin = pin_node.attrib.get("pin", "")
                pin_ref = f"{comp_ref}.{pin}" if comp_ref else pin

        if not loc:
            return

        self.design.padstacks[ps_name] = pdef

        pad_inst = PadInstance(
            padstack_ref=ps_name,
            location=loc,
            rotation=rot,
            mirror=mirror,
            pin_ref=pin_ref,
            net_name=net_name
        )
        self.design.standalone_pads.append(pad_inst)

    # ------------------------------------------------------------------
    # BOM
    # ------------------------------------------------------------------

    def _parse_bom(self):
        boms = self.root.findall(f".//{self._tag('BomItem')}")
        logger.info(f"Parsing de {len(boms)} éléments de BOM...")

        # Index O(1) ref_des -> Component (première occurrence, comme l'ancienne recherche linéaire)
        comps_by_refdes: Dict[str, Component] = {}
        for comp in self.design.components:
            if comp.ref_des and comp.ref_des not in comps_by_refdes:
                comps_by_refdes[comp.ref_des] = comp

        val_pattern = r'(?:_|-)(?P<val>\d+(?:\.\d+)?[pnumkKMG]?[FROHhz]+|\d+R\d+|\d+(?:\.\d+)?(?:MHz|KHz|Hz))(?:_|-|\+|%|$)'
        tol_pattern = r'(?P<tol>\+-[\d\.]+[a-zA-Z]*|\d+%)'

        for bom in boms:
            part = bom.attrib.get('OEMDesignNumberRef', '')
            bom_props = self._lire_proprietes(bom)

            tol = ""
            for tk in ("TOLERANCE", "TOL", "RESISTANCE_TOLERANCE", "CAPACITANCE_TOLERANCE", "INDUCTANCE_TOLERANCE"):
                for k, v in bom_props.items():
                    if k.upper() == tk:
                        tol = v
                        break
                if tol:
                    break

            val = ""
            for vk in ("VALUE", "VAL", "RESISTANCE", "CAPACITANCE", "INDUCTANCE", "COMMENT", "DEVICE"):
                for k, v in bom_props.items():
                    if k.upper() == vk:
                        val = v
                        break
                if val:
                    break

            if part:
                v_part, t_part = self._extraire_val_tol(part)
                if not val and v_part:
                    val = v_part
                if not tol and t_part:
                    tol = t_part
                if not val:
                    val = part

            for ref_des_elem in bom.findall(self._tag('RefDes')):
                name = ref_des_elem.attrib.get('name', '')
                if not name:
                    continue

                comp = comps_by_refdes.get(name)
                if comp is not None:
                    if not comp.value or comp.value == comp.part_number:
                        if val:
                            comp.value = val
                    if not comp.tolerance and tol:
                        comp.tolerance = tol
                    if not comp.part_number and part:
                        comp.part_number = part
                    for k, v in bom_props.items():
                        if k not in comp.properties:
                            comp.properties[k] = v
                    if not comp.comp_type or comp.comp_type == "UNKNOWN":
                        comp.comp_type = self._qualifier_type_composant(name, comp.value, comp.properties)
                else:
                    pkg_ref = ref_des_elem.attrib.get('packageRef', '')
                    layer = ref_des_elem.attrib.get('layerRef', 'UNKNOWN')
                    ctype = self._qualifier_type_composant(name, val, bom_props)
                    new_comp = Component(ref_des=name, package_ref=pkg_ref, layer_ref=layer,
                                         location=Point(0, 0), value=val, tolerance=tol,
                                         comp_type=ctype, part_number=part, properties=bom_props)
                    self.design.components.append(new_comp)
                    comps_by_refdes[name] = new_comp

    # ------------------------------------------------------------------
    # Étape 6 : ECAD
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # Spécifications de matériau (<Spec> / <SpecRef>)
    # ------------------------------------------------------------------

    # Attributs porteurs de la permittivité, du facteur de perte et du nom de
    # matériau, tels qu'on les rencontre : le schéma en fixe l'orthographe,
    # les outils qui écrivent le fichier s'en écartent parfois.
    _SPEC_DK = ("dielectricconstant", "permittivity", "relativepermittivity",
                "dk", "er", "epsilonr")
    _SPEC_DF = ("losstangent", "dissipationfactor", "df", "tandelta")
    # Volontairement restreint : « type » et « name » désignent ici la nature
    # de la grandeur (DIELECTRIC_CONSTANT, LOSS_TANGENT), pas un matériau.
    _SPEC_MAT = ("material", "materialref", "materialtype")

    def _parse_specs(self):
        """Indexe les <Spec> du fichier : nom -> {dk, df, material}.

        C'est là que vit la permittivité d'un stratifié dans un fichier
        IPC-2581 réel : la couche ne la porte pas, elle pointe une
        spécification par un <SpecRef>. Sans cette table, un fichier
        parfaitement renseigné ressortait sans le moindre Dk.

        Deux emplacements, parce que les deux se rencontrent : sous <Content>,
        et sous <Ecad><CadHeader> -- c'est là que l'écrivent les outils du
        commerce.

        Deux écritures, aussi. La valeur peut être un attribut de la balise
        (<Dielectric dielectricConstant="4.37"/>), ou tenir dans la forme
        « type + Property », de loin la plus courante :

            <Spec name="DielectricLayer-1-2_Dielectric">
             <Dielectric type="DIELECTRIC_CONSTANT">
              <Property value="4.37"/>
             </Dielectric>
            </Spec>

        où c'est le `type` qui dit de quelle grandeur il s'agit, et le
        <Property> qui la porte. On lit les deux formes.
        """
        self.specs: Dict[str, Dict[str, str]] = {}
        racines = []
        content = self.root.find(self._tag("Content"))
        if content is not None:
            racines.append(content)
        ecad = self.root.find(self._tag("Ecad"))
        if ecad is not None:
            racines.append(ecad)
            header = ecad.find(self._tag("CadHeader"))
            if header is not None:
                racines.append(header)

        for racine in racines:
            for spec in racine.findall(self._tag("Spec")):
                name = spec.attrib.get("name") or spec.attrib.get("id")
                if not name:
                    continue
                vals = self.specs.setdefault(name, {})

                # -- forme « type + Property » ---------------------------
                for enfant in spec:
                    genre = (enfant.attrib.get("type") or
                             self._local_tag(enfant)).upper()
                    valeur = ""
                    for noeud in enfant.iter():
                        valeur = (noeud.attrib.get("value") or
                                  noeud.attrib.get("text") or valeur)
                        if valeur:
                            break
                    if not valeur:
                        continue
                    if "DIELECTRIC" in genre or "PERMITTIV" in genre:
                        vals.setdefault("dk", valeur)
                    elif ("LOSS" in genre or "TANGENT" in genre
                          or "DISSIPATION" in genre):
                        vals.setdefault("df", valeur)
                    elif "MATERIAL" in genre:
                        vals.setdefault("material", valeur)

                # -- forme « tout en attributs » -------------------------
                for elem in spec.iter():
                    interne = elem is not spec
                    for cle, valeur in elem.attrib.items():
                        if not valeur:
                            continue
                        bas = cle.lower()
                        if bas in self._SPEC_DK:
                            vals.setdefault("dk", valeur)
                        elif bas in self._SPEC_DF:
                            vals.setdefault("df", valeur)
                        # « name » et « type » ne désignent un matériau que sur
                        # un enfant : sur <Spec>, « name » est le nom de la spec
                        elif bas in self._SPEC_MAT and interne:
                            vals.setdefault("material", valeur)

                if not vals:
                    del self.specs[name]
        if self.specs:
            logger.info("%d spécification(s) de matériau indexée(s).", len(self.specs))

    def _appliquer_specs(self, elem: ET.Element, couche: StackupLayer):
        """Complète une couche d'empilage avec ce que disent ses <SpecRef>.

        Ce qui est écrit sur la couche elle-même l'emporte : la spec est un
        défaut partagé, la propriété locale une précision.
        """
        for ref in elem.findall(self._tag("SpecRef")):
            vals = self.specs.get(ref.attrib.get("id", ""))
            if not vals:
                continue
            couche.dk = couche.dk or vals.get("dk", "")
            couche.df = couche.df or vals.get("df", "")
            couche.material = couche.material or vals.get("material", "")

    def _parse_stackup(self, cad_data: ET.Element):
        stackup_node = cad_data.find(self._tag("Stackup"))
        if stackup_node is not None:
            self.design.total_thickness = self._safe_float(stackup_node.attrib.get("overallThickness"))
            logger.info(f"Épaisseur totale de la carte: {self.design.total_thickness}")
            for group in stackup_node.findall(self._tag("StackupGroup")):
                for layer in group.findall(self._tag("StackupLayer")):
                    name = layer.attrib.get("layerOrGroupRef", "Unknown")
                    thickness = self._safe_float(layer.attrib.get("thickness"))
                    sequence = self._safe_int(layer.attrib.get("sequence"))

                    sl = StackupLayer(
                        name=name,
                        thickness=thickness,
                        sequence=sequence
                    )

                    for prop in layer.findall(self._tag("Property")):
                        p_name = prop.attrib.get("name", "").upper()
                        p_val = prop.attrib.get("value", "")
                        if p_name in ["DIELECTRICCONSTANT", "DK", "DIELECTRIC_CONSTANT"]:
                            sl.dk = p_val
                        elif p_name in ["LOSSTANGENT", "DF", "LOSS_TANGENT"]:
                            sl.df = p_val
                        elif p_name in ["MATERIAL", "MATERIALREF"]:
                            sl.material = p_val

                    # Ce que la couche ne porte pas, sa spécification le dit
                    self._appliquer_specs(layer, sl)

                    self.design.stackup.append(sl)

            self.design.stackup.sort(key=lambda x: x.sequence)

    def _parse_profile(self, step_elem: ET.Element):
        profile = step_elem.find(self._tag("Profile"))
        if profile is not None:
            polygon = profile.find(self._tag("Polygon"))
            if polygon is not None:
                outline_points = self._parse_polygon(polygon)
                if len(outline_points) >= 3:
                    contour_data = Contour(outline=outline_points)
                    for cutout in profile.findall(self._tag("Cutout")):
                        cutout_points = self._parse_polygon(cutout)
                        if len(cutout_points) >= 3:
                            contour_data.cutouts.append(cutout_points)
                    self.design.board_outline = contour_data

    def _parse_ecad(self):
        ecad = self.root.find(self._tag("Ecad"))
        if ecad is None:
            logger.warning("Balise <Ecad> non trouvée.")
            return
        cad_data = ecad.find(self._tag("CadData"))
        if cad_data is None:
            logger.warning("Balise <CadData> non trouvée.")
            return

        logger.info("Parsing de l'empilement (Stackup)...")
        self._parse_stackup(cad_data)

        layer_functions_map = {}
        for layer in cad_data.findall(self._tag("Layer")):
            lname = layer.attrib.get("name")
            lfunc = layer.attrib.get("layerFunction", "").upper()
            if lname:
                layer_functions_map[lname] = lfunc
                span = self._lire_span(layer)
                if span:
                    self.drill_spans[lname] = span

                props = {}
                for prop in layer.findall(self._tag("Property")):
                    p_name = prop.attrib.get("name", "").upper()
                    p_val = prop.attrib.get("value", "")
                    props[p_name] = p_val

                for sl in self.design.stackup:
                    if sl.name == lname:
                        # layerFunction dit ce qu'est physiquement la couche :
                        # CONDUCTOR, PLANE, DIELCORE, DIELPREG, SOLDERMASK...
                        # Sans lui, rien ne distingue un conducteur d'un
                        # diélectrique dans l'empilage, et le nom seul ment.
                        if lfunc:
                            sl.layer_type = lfunc
                        sl.dk = props.get("DIELECTRICCONSTANT") or props.get("DK") or props.get("DIELECTRIC_CONSTANT") or sl.dk
                        sl.df = props.get("LOSSTANGENT") or props.get("DF") or props.get("LOSS_TANGENT") or sl.df
                        sl.material = props.get("MATERIAL") or props.get("MATERIALREF") or sl.material
                        # <Layer> peut lui aussi pointer une spécification
                        self._appliquer_specs(layer, sl)

        logger.debug(f"{len(layer_functions_map)} calques définis dans <CadData>.")

        logger.info(f"Détails de l'Empilement (Stackup) : {len(self.design.stackup)} couches.")
        for layer in self.design.stackup:
            details = []
            if layer.material:
                details.append(f"Matériau: {layer.material}")
            if layer.dk:
                details.append(f"Dk: {layer.dk}")
            if layer.df:
                details.append(f"Df: {layer.df}")
            details_str = ", ".join(details)
            if details_str:
                details_str = f" | {details_str}"
            logger.info(f"  - Couche {layer.sequence:02d} : {layer.name} "
                        f"(Épaisseur: {layer.thickness} {self.design.units}){details_str}")

        step = cad_data.find(self._tag("Step"))
        if step is None:
            logger.warning("Balise <Step> non trouvée.")
            return

        logger.info("Parsing du profil de la carte (Profile)...")
        self._parse_profile(step)

        padstacks = step.findall(self._tag("PadStack"))
        logger.info(f"Parsing de {len(padstacks)} instances de PadStacks (step)...")
        for ps_elem in padstacks:
            self._process_step_padstack(ps_elem)

        packages = step.findall(self._tag("Package"))
        logger.info(f"Parsing de {len(packages)} packages...")
        for pkg in packages:
            self._process_package(pkg)

        components = step.findall(self._tag("Component"))
        logger.info(f"Parsing de {len(components)} composants...")
        for comp in components:
            self._process_component(comp)

        logger.info("Parsing des LogicalNet (broche -> net)...")
        self._parse_logical_nets(step)

        layer_features = step.findall(self._tag("LayerFeature"))
        logger.info(f"Parsing des {len(layer_features)} éléments LayerFeature (pistes, polygones, textes)...")
        for layer_feature in layer_features:
            layer_ref = layer_feature.attrib.get("layerRef", "Unknown")

            local_func = layer_feature.attrib.get("layerFunction", "").upper()
            global_func = layer_functions_map.get(layer_ref, "")

            role = self._role_calque(layer_ref, local_func or global_func)

            if role == "percage":
                self._process_drill_layer(layer_feature, layer_ref)
                continue
            if role == "contour":
                self._contour_de_repli(layer_feature)
                continue
            if role == "ignore":
                self.design.ignored_layers[layer_ref] = local_func or global_func
                continue

            for item_set in layer_feature.findall(self._tag("Set")):
                net_name = item_set.attrib.get("net", "Non-Net")

                for pad_node in item_set.iter(self._tag("Pad")):
                    pad_inst = self._process_pad_instance(pad_node, layer_ref, net_name)
                    self.design.standalone_pads.append(pad_inst)

                for features in item_set.findall(self._tag("Features")):
                    self._process_features(features, layer_ref, net_name)

            for direct_features in layer_feature.findall(self._tag("Features")):
                self._process_features(direct_features, layer_ref, "Non-Net")

        if self.design.ignored_layers:
            logger.info("%d calque(s) hors simulation ignore(s) : %s",
                        len(self.design.ignored_layers),
                        ", ".join(sorted(self.design.ignored_layers)))

    def _role_calque(self, layer_ref: str, fonction: str) -> str:
        """Ce qu'on fait d'un <LayerFeature> : "percage", "cuivre", "contour"
        ou "ignore".

        Seul le cuivre et les percages entrent dans une simulation ; le reste
        d'un export (serigraphie, masque, pate, zones de composant, keepouts,
        cotation) y serait pris pour du metal. Le tri se fait sur layerFunction ;
        un calque qui n'en declare pas est garde -- un cuivre perdu coute plus
        cher qu'un calque de trop.
        """
        nom = layer_ref.upper()
        if "DRILL" in fonction or (not fonction and ("DRILL" in nom or "HOLE" in nom)):
            return "percage"
        if self.tout_garder or not fonction or _RE_FONCTION_CUIVRE.search(fonction):
            return "cuivre"
        if fonction in ("BOARD_OUTLINE", "PROFILE", "BOARDOUTLINE"):
            return "contour"
        return "ignore"

    def _contour_de_repli(self, layer_feature: ET.Element):
        """Un calque BOARD_OUTLINE ne sert que si <Profile> n'a rien donne."""
        if self.design.board_outline is not None:
            return
        for contour in layer_feature.iter(self._tag("Contour")):
            polygon = contour.find(self._tag("Polygon"))
            if polygon is None:
                continue
            points = self._parse_polygon(polygon)
            if len(points) >= 3:
                contour_data = Contour(outline=points)
                for cutout in contour.findall(self._tag("Cutout")):
                    trou = self._parse_polygon(cutout)
                    if len(trou) >= 3:
                        contour_data.cutouts.append(trou)
                self.design.board_outline = contour_data
                return

    def _process_features(self, features_elem: ET.Element, layer_ref: str, net_name: str):
        """Traite un bloc <Features> (ou <UserSpecial>) : lignes, polylignes, arcs, textes, contours."""
        for line in features_elem.findall(self._tag("Line")):
            self._process_simple_line(line, layer_ref, net_name)
        for poly in features_elem.findall(self._tag("Polyline")):
            self._process_polyline(poly, layer_ref, net_name)
        for arc in features_elem.findall(self._tag("Arc")):
            self._process_arc(arc, layer_ref, net_name)
        for text_node in features_elem.findall(self._tag("Text")):
            self._process_text(text_node, layer_ref, net_name, self.design.texts)

        special_node = features_elem.find(self._tag("UserSpecial"))
        if special_node is not None:
            for line in special_node.findall(self._tag("Line")):
                self._process_simple_line(line, layer_ref, net_name)
            for poly in special_node.findall(self._tag("Polyline")):
                self._process_polyline(poly, layer_ref, net_name)
            for arc in special_node.findall(self._tag("Arc")):
                self._process_arc(arc, layer_ref, net_name)
            for text_node in special_node.findall(self._tag("Text")):
                self._process_text(text_node, layer_ref, net_name, self.design.texts)
            for contour in special_node.findall(self._tag("Contour")):
                self._process_contour(contour, layer_ref, net_name)

        for contour in features_elem.findall(self._tag("Contour")):
            self._process_contour(contour, layer_ref, net_name)

    # ------------------------------------------------------------------
    # Perçages (calques DRILL)
    # ------------------------------------------------------------------

    def _lire_span(self, elem: ET.Element):
        """La portée déclarée d'un calque de perçage, ou None.

        OÙ ELLE EST ÉCRITE. IPC-2581 la met sur le CALQUE et non sur le trou :

            <Layer name="drill_1_4" layerFunction="DRILL" side="ALL">
              <Span fromLayer="TOP" toLayer="IN2"/>
            </Layer>

        TROIS FORMES ACCEPTÉES, et c'est de la tolérance d'exportateur, pas de
        la générosité : `<Span>` est la balise du schéma, `<SpanDescriptor>`
        traîne dans des exports plus anciens, et certains outils posent les deux
        noms en attributs du calque lui-même. Les trois disent la même chose ;
        n'en lire qu'une, c'est perdre la portée sur les fichiers des deux
        autres et retomber sur « traversant » sans le savoir.

        CE QU'ON NE FAIT PAS : deviner la portée d'après le NOM du calque
        (« drill_1_4 »). Une portée devinée à tort RESTREINT un via traversant,
        donc coupe un chemin de courant réel — le cuivre d'une couche se
        retrouve flottant et le solveur refuse tout le calcul. Supposer
        traversant se paie d'une résistance surestimée ; supposer borgne se paie
        d'un résultat faux. On ne suppose donc que dans le sens qui ne perd
        aucun chemin, et on le dit.
        """
        for balise in ("Span", "SpanDescriptor"):
            node = elem.find(self._tag(balise))
            if node is not None:
                a = (node.attrib.get("fromLayer")
                     or node.attrib.get("from") or "").strip()
                b = (node.attrib.get("toLayer")
                     or node.attrib.get("to") or "").strip()
                if a and b:
                    return (a, b)
        a = (elem.attrib.get("spanFromLayer") or "").strip()
        b = (elem.attrib.get("spanToLayer") or "").strip()
        return (a, b) if a and b else None

    def _span_du_percage(self, layer_ref: str, padstack_ref: str):
        """La portée d'un perçage : son calque d'abord, son padstack ensuite.

        Rend (depuis, vers, provenance). La provenance est vide quand rien n'est
        déclaré — et c'est une information, pas un manque à taire.
        """
        span = self.drill_spans.get(layer_ref)
        if span:
            return span[0], span[1], "calque"
        pdef = self.design.padstacks.get(padstack_ref)
        if pdef is not None and pdef.hole_layer_ref:
            span = self.drill_spans.get(pdef.hole_layer_ref)
            if span:
                return span[0], span[1], "padstack"
        return "", "", ""

    def _process_drill_layer(self, layer_elem: ET.Element, layer_ref: str = ""):
        # LA PORTÉE DU CALQUE, LUE UNE FOIS. Un calque de perçage porte des
        # centaines de trous et une seule portée : la relire par trou coûterait
        # un `find` chacun pour le même résultat.
        span_calque = self._lire_span(layer_elem)
        if span_calque and layer_ref:
            self.drill_spans.setdefault(layer_ref, span_calque)
        for item_set in layer_elem.findall(self._tag("Set")):
            padstack_ref = item_set.attrib.get("geometry", "")
            net_name = item_set.attrib.get("net", "")
            pad_usage = item_set.attrib.get("padUsage", "").upper()

            holes = item_set.findall(self._tag("Hole"))
            features = item_set.find(self._tag("Features"))
            if features is not None:
                holes.extend(features.findall(self._tag("Hole")))

            for hole in holes:
                diameter = self._safe_float(hole.attrib.get("diameter"))
                plating = hole.attrib.get("platingStatus", "UNKNOWN")

                loc_node = hole.find(self._tag("Location"))
                if loc_node is not None:
                    x = self._safe_float(loc_node.attrib.get("x"))
                    y = self._safe_float(loc_node.attrib.get("y"))
                else:
                    x = self._safe_float(hole.attrib.get("x"))
                    y = self._safe_float(hole.attrib.get("y"))

                loc = Point(x, y)
                drill = Drill(location=loc, diameter=diameter, plating=plating,
                              padstack_ref=padstack_ref, net_name=net_name)
                # LA PORTÉE, TANT QU'ON A LE CALQUE SOUS LA MAIN. Plus loin,
                # `design.drills` n'est qu'une liste de trous : rien n'y dit
                # plus de quel calque ils viennent.
                (drill.span_from, drill.span_to,
                 drill.span_source) = self._span_du_percage(layer_ref,
                                                            padstack_ref)

                is_via_hole = False
                via_key = None

                if pad_usage == "VIA" or padstack_ref in self.via_def_names:
                    is_via_hole = True
                    via_key = padstack_ref if padstack_ref else f"VIA_HOLE_D{diameter}"

                if is_via_hole and via_key:
                    # Arrondi pour absorber les imprécisions de virgule flottante
                    loc_tuple = (round(loc.x, _VIA_COORD_PRECISION), round(loc.y, _VIA_COORD_PRECISION))
                    if loc_tuple not in self.via_locations:
                        self.via_locations.add(loc_tuple)
                        self.detected_via_counts[via_key] = self.detected_via_counts.get(via_key, 0) + 1

                    if via_key not in self.design.padstacks:
                        # AUCUNE DEFINITION DE PADSTACK POUR CE PERCAGE : on en
                        # fabrique une pour avoir quelque chose a dessiner.
                        # « perçage + 0,3 » est un anneau de 0,15 mm pose par
                        # convention -- un ordre de grandeur courant, et rien
                        # de plus. Il est MARQUE comme suppose : la simulation
                        # le fait entrer dans la capacite du via, le controle
                        # d'isolation mesure des distances contre lui, et ni
                        # l'un ni l'autre ne doit le prendre pour une cote du
                        # fichier.
                        pdef = PadStackDefinition(name=via_key)
                        pdef.hole_diameter = diameter
                        pdef.pad_diameter = diameter + 0.3
                        pdef.pad_supposee = True
                        self.design.padstacks[via_key] = pdef
                        self.via_def_names.add(via_key)

                    if not drill.padstack_ref:
                        drill.padstack_ref = via_key

                if drill.padstack_ref in self.design.padstacks:
                    drill.padstack_obj = self.design.padstacks[drill.padstack_ref]

                self.design.drills.append(drill)

    def _process_pad_instance(self, pad_elem: ET.Element, current_layer: str = "ALL",
                              default_net: str = "") -> PadInstance:
        net_name = pad_elem.attrib.get("net", default_net)

        padstack_ref = pad_elem.attrib.get("padstackDefRef", "")
        if not padstack_ref:
            padstack_ref = pad_elem.attrib.get("geometry", "")

        pin_ref = pad_elem.attrib.get("pinRef", "")

        pin_node = pad_elem.find(self._tag("PinRef"))
        if pin_node is not None and not pin_ref:
            comp_ref = pin_node.attrib.get("componentRef", "")
            pin = pin_node.attrib.get("pin", "")
            pin_ref = f"{comp_ref}.{pin}" if comp_ref else pin

        loc = self._get_location(pad_elem)

        xform = pad_elem.find(self._tag("Xform"))
        rot = 0.0
        mirror = False
        if xform is not None:
            rot = self._safe_float(xform.attrib.get("rotation"))
            mirror = xform.attrib.get("mirror", "false").lower() == "true"

        pref = pad_elem.find(self._tag("StandardPrimitiveRef"))
        if pref is None:
            pref = pad_elem.find(self._tag("UserPrimitiveRef"))

        if pref is not None:
            shape_ref = pref.attrib.get("id", "")
            if shape_ref:
                self.inline_ps_counter += 1
                ps_name = f"inline_pad_{self.inline_ps_counter}"
                padstack_ref = ps_name

                pad_diam = self._shape_max_dimension(shape_ref)

                pdef = PadStackDefinition(name=ps_name)
                pdef.pads.append(PadDef(layer_ref=current_layer, pad_diameter=pad_diam, shape_ref=shape_ref))
                self.design.padstacks[ps_name] = pdef

        # Comptage et dédoublonnage pour les vias placés sous forme de "Pad"
        pad_usage = pad_elem.attrib.get("padUsage", "").upper()
        if padstack_ref in self.via_def_names or pad_usage == "VIA":
            if pad_usage == "VIA" and padstack_ref not in self.via_def_names and padstack_ref:
                self.via_def_names.add(padstack_ref)

            loc_tuple = (round(loc.x, _VIA_COORD_PRECISION), round(loc.y, _VIA_COORD_PRECISION))
            if loc_tuple not in self.via_locations:
                self.via_locations.add(loc_tuple)
                self.detected_via_counts[padstack_ref] = self.detected_via_counts.get(padstack_ref, 0) + 1

        return PadInstance(padstack_ref=padstack_ref, location=loc, rotation=rot,
                           mirror=mirror, pin_ref=pin_ref, net_name=net_name)

    # ------------------------------------------------------------------
    # Packages et composants
    # ------------------------------------------------------------------

    def _process_package(self, pkg_elem: ET.Element):
        name = pkg_elem.attrib.get("name") or pkg_elem.attrib.get("id") or ""
        if not name:
            logger.warning("Package ignoré : attribut 'name' manquant.")
            return

        package = Package(name=name)

        for pin_elem in pkg_elem.findall(self._tag("Pin")):
            number = pin_elem.attrib.get("number", "?")
            pin_type = pin_elem.attrib.get("type", "UNKNOWN")
            loc = self._get_location(pin_elem)
            package.pins.append(Pin(number=number, x=loc.x, y=loc.y, type=pin_type))

            for pad_elem in pin_elem.findall(self._tag("Pad")):
                pad_inst = self._process_pad_instance(pad_elem, "ALL")
                if not pad_inst.pin_ref:
                    pad_inst.pin_ref = number
                package.pads.append(pad_inst)

        self.design.packages[name] = package

    def _parse_logical_nets(self, step_elem: ET.Element):
        """<LogicalNet name="..." netClass="..."><PinRef componentRef="U1" pin="3"/>...

        C'est la seule source fiable du net d'une broche : les <Pad> internes
        a un <Pin> qui permettraient de le deduire autrement sont quasiment
        toujours absents d'un export reel (verifie sur un export du commerce
        de 10 Mo, aucun composant n'en porte). Sans cette lecture, la fiche
        d'un boitier ne peut pas repondre a la question qu'on lui pose le plus
        souvent -- "la broche 3, elle va ou ?".
        De plus, l'attribut netClass ("GROUND", "POWER", "SIGNAL", etc.) permet
        d'auto-détecter la nature des équipotentielles pour les simulations.
        """
        index = {c.ref_des: c for c in self.design.components}
        compte = 0
        elems = list(step_elem.findall(self._tag("LogicalNet")))
        # Certains outils placent LogicalNet au niveau de CadData
        ecad = self.root.find(self._tag("Ecad"))
        if ecad is not None:
            cad_data = ecad.find(self._tag("CadData"))
            if cad_data is not None and cad_data is not step_elem:
                elems.extend(cad_data.findall(self._tag("LogicalNet")))

        for net_elem in elems:
            net_name = net_elem.attrib.get("name")
            if not net_name:
                continue
            net_class = (net_elem.attrib.get("netClass") or net_elem.attrib.get("net_class") or "").strip()
            if net_class:
                self.design.get_or_create_net(net_name).net_class = net_class
            for ref in net_elem.findall(self._tag("PinRef")):
                comp = index.get(ref.attrib.get("componentRef", ""))
                pin = ref.attrib.get("pin")
                if comp is None or not pin:
                    continue
                # Le premier net gagne : deux <LogicalNet> ne devraient jamais
                # revendiquer la meme broche, mais un fichier mal forme ne
                # doit pas faire clignoter la valeur au hasard de l'ordre.
                comp.pin_nets.setdefault(pin, net_name)
                compte += 1
        if compte:
            logger.info("%d lien(s) broche -> net indexe(s) depuis %d LogicalNet.",
                        compte, len(elems))

    def _process_component(self, comp_elem: ET.Element):
        ref_des = comp_elem.attrib.get("refDes")
        if not ref_des:
            logger.warning("Composant ignoré : attribut 'refDes' manquant.")
            return

        props = self._lire_proprietes(comp_elem)
        part_attr = comp_elem.attrib.get("part", "")

        # 1. Tolérance depuis Property ou Characteristics
        tolerance = ""
        for tk in ("TOLERANCE", "TOL", "RESISTANCE_TOLERANCE", "CAPACITANCE_TOLERANCE", "INDUCTANCE_TOLERANCE"):
            for k, v in props.items():
                if k.upper() == tk:
                    tolerance = v
                    break
            if tolerance:
                break

        # 2. Valeur depuis attribut, Property ou Characteristics
        value = comp_elem.attrib.get("value", "")
        if not value:
            for vk in ("VALUE", "VAL", "RESISTANCE", "CAPACITANCE", "INDUCTANCE", "COMMENT", "DEVICE"):
                for k, v in props.items():
                    if k.upper() == vk:
                        value = v
                        break
                if value:
                    break

        # 3. Si toujours vide, analyse de part_attr (ex: RES-10K, 100nF, C0603_10uF)
        if not value and part_attr:
            v_part, t_part = self._extraire_val_tol(part_attr)
            if v_part:
                value = v_part
            if not tolerance and t_part:
                tolerance = t_part

        # 4. Si la valeur trouvée contient aussi une tolérance et qu'elle n'était pas renseignée
        if value and not tolerance:
            _, t_val = self._extraire_val_tol(value)
            if t_val:
                tolerance = t_val

        # Part number
        part_number = ""
        for pk in ("PART_NUMBER", "PARTNUMBER", "MPN", "PN", "PART"):
            for k, v in props.items():
                if k.upper() == pk:
                    part_number = v
                    break
            if part_number:
                break
        if not part_number:
            part_number = part_attr

        # Qualification du type
        comp_type = self._qualifier_type_composant(ref_des, value, props)

        inline_pkg = comp_elem.find(self._tag("Package"))
        actual_pkg_ref = "Inline"
        if inline_pkg is not None:
            pkg_name = inline_pkg.attrib.get("name")
            actual_pkg_ref = pkg_name
            if pkg_name not in self.design.packages:
                self._process_package(inline_pkg)
        else:
            # C'est « packageRef » qui designe le <Package> : « part » est le
            # nom de la reference (celui de la nomenclature), qui n'a aucune
            # raison de ressembler au nom de l'empreinte -- sur un fichier
            # reel, part="CONN_8-2mm-reflow" pour packageRef="CONN_8pts-2mm_reflow".
            # Lire « part » ici laissait donc les composants sans empreinte,
            # donc sans broches : la fiche d'un boitier annonçait « 0 broche ».
            actual_pkg_ref = (comp_elem.attrib.get("packageRef")
                              or part_attr or "Unknown")

        layer = comp_elem.attrib.get("layerRef", "TOP")
        mount = comp_elem.attrib.get("mountType", "UNKNOWN")
        loc = self._get_location(comp_elem)

        rotation = 0.0
        mirror = False

        xform = comp_elem.find(self._tag("Xform"))
        if xform is not None:
            rotation = self._safe_float(xform.attrib.get("rotation"))
            mirror = xform.attrib.get("mirror", "false").lower() == "true"

        comp = Component(ref_des=ref_des, package_ref=actual_pkg_ref, layer_ref=layer,
                         location=loc, rotation=rotation, mirror=mirror,
                         mount_type=mount, value=value, tolerance=tolerance,
                         comp_type=comp_type, part_number=part_number, properties=props)

        if actual_pkg_ref in self.design.packages:
            comp.package_obj = self.design.packages[actual_pkg_ref]
        elif not comp.package_obj:
            for key in self.design.packages:
                if actual_pkg_ref in key:
                    comp.package_obj = self.design.packages[key]
                    break
        self.design.components.append(comp)

    # ------------------------------------------------------------------
    # Primitives graphiques
    # ------------------------------------------------------------------

    def _process_text(self, text_elem: ET.Element, layer: str, default_net: str,
                      target_list: List[TextElement]):
        try:
            net = text_elem.attrib.get("net", default_net)
            text_val = text_elem.attrib.get("text", "")
            if not text_val:
                return

            loc = self._get_location(text_elem)
            xform = text_elem.find(self._tag("Xform"))
            rot = 0.0
            mirror = False

            if xform is not None:
                rot = self._safe_float(xform.attrib.get("rotation"))
                mirror = xform.attrib.get("mirror", "false").lower() == "true"

            text_obj = TextElement(text=text_val, location=loc, layer_name=layer,
                                   net_name=net, rotation=rot, mirror=mirror)
            target_list.append(text_obj)
        except Exception as e:
            logger.debug("Texte ignoré : %s", e)

    def _process_simple_line(self, line_elem: ET.Element, layer: str, default_net: str):
        try:
            net = line_elem.attrib.get("net", default_net)
            p1 = Point(float(line_elem.attrib["startX"]), float(line_elem.attrib["startY"]))
            p2 = Point(float(line_elem.attrib["endX"]), float(line_elem.attrib["endY"]))
            width = self._get_width(line_elem)
            fill_prop = self._get_fill_desc(line_elem)
            self.design.add_track(Track(width=width, points=[p1, p2], layer_name=layer,
                                        net_name=net, fill_property=fill_prop))
        except Exception as e:
            logger.debug("Ligne ignorée (couche %s) : %s", layer, e)

    def _parse_polygon(self, poly_elem: ET.Element) -> List[Point]:
        points = []
        for child in poly_elem:
            tag = child.tag.split('}')[-1]

            if tag == "PolyBegin":
                points.append(Point(self._safe_float(child.attrib.get("x")),
                                    self._safe_float(child.attrib.get("y"))))

            elif tag == "PolyStepSegment":
                points.append(Point(self._safe_float(child.attrib.get("x")),
                                    self._safe_float(child.attrib.get("y"))))

            elif tag == "PolyStepCurve":
                end_x = self._safe_float(child.attrib.get("x"))
                end_y = self._safe_float(child.attrib.get("y"))

                if points:
                    start_x = points[-1].x
                    start_y = points[-1].y
                    center_x = self._safe_float(child.attrib.get("centerX"))
                    center_y = self._safe_float(child.attrib.get("centerY"))
                    cw = child.attrib.get("clockwise", "false").lower() == "true"

                    angle_start = math.atan2(start_y - center_y, start_x - center_x)
                    angle_end = math.atan2(end_y - center_y, end_x - center_x)

                    if cw:
                        if angle_end > angle_start:
                            angle_end -= 2 * math.pi
                    else:
                        if angle_end < angle_start:
                            angle_end += 2 * math.pi

                    radius = math.hypot(start_x - center_x, start_y - center_y)

                    sweep_angle = abs(angle_end - angle_start)
                    arc_length = radius * sweep_angle
                    steps = min(360, max(12, int(arc_length / 0.05)))

                    for i in range(1, steps):
                        angle = angle_start + (angle_end - angle_start) * (i / steps)
                        points.append(Point(center_x + radius * math.cos(angle),
                                            center_y + radius * math.sin(angle)))

                points.append(Point(end_x, end_y))

        return points

    def _process_polyline(self, poly_elem: ET.Element, layer: str, default_net: str):
        net = poly_elem.attrib.get("net", default_net)
        width = self._get_width(poly_elem)
        fill_prop = self._get_fill_desc(poly_elem)
        points = self._parse_polygon(poly_elem)
        if len(points) >= 2:
            self.design.add_track(Track(width=width, points=points, layer_name=layer,
                                        net_name=net, fill_property=fill_prop))

    def _process_arc(self, arc_elem: ET.Element, layer: str, default_net: str):
        try:
            net = arc_elem.attrib.get("net", default_net)
            start = Point(float(arc_elem.attrib["startX"]), float(arc_elem.attrib["startY"]))
            end = Point(float(arc_elem.attrib["endX"]), float(arc_elem.attrib["endY"]))
            center = Point(float(arc_elem.attrib["centerX"]), float(arc_elem.attrib["centerY"]))
            clockwise = arc_elem.attrib.get("clockwise", "false").lower() == "true"
            width = self._get_width(arc_elem)
            fill_prop = self._get_fill_desc(arc_elem)

            arc = Arc(width=width, start=start, end=end, center=center, clockwise=clockwise,
                      layer_name=layer, net_name=net, fill_property=fill_prop)
            self.design.add_arc(arc)
        except Exception as e:
            logger.debug("Arc ignoré (couche %s) : %s", layer, e)

    def _process_contour(self, contour_elem: ET.Element, layer: str, default_net: str):
        net = contour_elem.attrib.get("net", default_net)
        polygon = contour_elem.find(self._tag("Polygon"))
        if polygon is None:
            return

        outline_points = self._parse_polygon(polygon)
        if len(outline_points) < 3:
            return

        contour_data = Contour(outline=outline_points)
        fill_prop = self._get_fill_desc(polygon)

        for cutout in contour_elem.findall(self._tag("Cutout")):
            cutout_points = self._parse_polygon(cutout)
            if len(cutout_points) >= 3:
                contour_data.cutouts.append(cutout_points)

        plane = CopperPlane(layer_name=layer, net_name=net, contours=[contour_data],
                            fill_property=fill_prop)
        self.design.add_copper_plane(plane)
