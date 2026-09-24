#!/usr/bin/python3
# -*- coding: utf-8 -*-
# ==========================================================================
# Antenne openEMS -- le serveur.
#
#   python web_antenna.py
#
# IL NE SERT QUE TROIS CHOSES QU'UN NAVIGATEUR NE SAIT PAS FAIRE :
#
#   1. LIRE UN FICHIER IPC-2581. Le parseur est en Python (python/), il fait
#      soixante-dix kilo-octets de code, et aucun navigateur ne l'executera.
#      La page envoie le fichier tel quel, le modele traduit revient en JSON,
#      et a partir de la tout se passe dans le navigateur : c'est aussi
#      pourquoi « Exporter .json » existe.
#
#   2. APPELER openEMS. Le solveur est un binaire C++ pilote par des liaisons
#      Python. Il tourne dans un processus a lui (voir openems_run.py), et
#      cette page l'interroge sur son avancement.
#
#   3. ECRIRE SUR LE DISQUE, ET RELIRE. Un projet — le dessin, les reglages,
#      la carte, les resultats, les champs — est un dossier que l'utilisateur
#      choisit (voir python/projet.py). Une page web n'ecrit pas la ou on lui
#      dit, et le stockage local d'un navigateur n'est ni un dossier, ni
#      partageable, ni sauvegarde.
#
# Et une quatrieme, minuscule, qui tient a la meme raison que la troisieme :
#
#   4. RELIRE LA CLE DU MODE IA. Une page ne lit pas un fichier du disque, et
#      la seule autre facon de ne pas retaper une cle a chaque seance serait
#      de l'ecrire dans le stockage local du navigateur -- en clair, pour
#      toujours, dans un dossier que personne ne surveille. Le serveur ne la
#      garde pas et ne s'en sert pas : il la relit et la rend. Voir _ia_cle.
#      C'est la SEULE route reservee a la boucle locale : elle rend un secret
#      facturable, et ce serveur ecoute le reseau local par defaut.
#
# Tout le reste -- l'affichage, la designation du cuivre, l'assistant, la 3D,
# les courbes -- est dans le navigateur et n'a besoin de personne.
#
# CE FICHIER N'A AUCUNE DEPENDANCE EXTERNE : bibliotheque standard seulement.
# Les modules qu'il importe, eux, en ont (numpy pour openEMS), et ils sont
# importes de facon TOLERANTE : un poste sans openEMS sert quand meme la
# page, lit quand meme les fichiers IPC-2581, prepare quand meme les modeles
# et exporte quand meme leurs scripts. Seul « Lancer » s'eteint, en disant
# pourquoi.
# ==========================================================================
"""Serveur local de l'outil « Antenne openEMS »."""

import argparse
import http.server
import json
import os
import posixpath
import re
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import urllib.parse
import webbrowser

PORT_DEFAUT = 8000
# DES PORTS DE REPLI, ET NON UN TIRAGE AU SORT TOUT DE SUITE. Windows
# reserve des plages entieres (Hyper-V, WSL, Docker) et le 8000 y tombe
# souvent -- c'est le cas sur bien des postes d'entreprise. Un port pris
# au hasard marcherait, mais changerait a chaque demarrage : les favoris
# du navigateur ne suivraient pas. On essaie donc d'abord une poignee de
# ports usuels, et le tirage au sort ne vient qu'en dernier.
PORTS_REPLI = (8080, 8010, 8800, 8081, 5000, 3000)
ROOT = os.path.dirname(os.path.abspath(__file__))

# python/ est a cote de ce fichier : c'est ce qui rend « import ipc2581_json »
# possible sans que les modules aient a bouger. Ce sont des imports de module
# ordinaires, pas des imports de paquet -- python/ n'a pas de __init__.py et
# n'en a pas besoin.
DOSSIER_PYTHON = os.path.join(ROOT, "python")
if DOSSIER_PYTHON not in sys.path:
    sys.path.insert(0, DOSSIER_PYTHON)

try:
    import ipc2581_json
    ERREUR_IPC = None
except Exception as _exc:                              # noqa: BLE001
    ipc2581_json = None
    ERREUR_IPC = _exc

try:
    import openems_antenne
    ERREUR_OPENEMS = None
except Exception as _exc:                              # noqa: BLE001
    openems_antenne = None
    ERREUR_OPENEMS = _exc

# LE TROISIEME SERVICE QU'UN NAVIGATEUR NE SAIT PAS FAIRE : ecrire dans un
# dossier que l'utilisateur a choisi. Voir python/projet.py pour ce qu'on y
# ecrit — et surtout pour ce qu'on refuse d'y faire.
try:
    import projet
    ERREUR_PROJET = None
except Exception as _exc:                              # noqa: BLE001
    projet = None
    ERREUR_PROJET = _exc

# Un IPC-2581 est un XML bavard : une carte de taille moyenne pese quelques
# dizaines de mega-octets, et l'archive ZIP d'un fabricant guere moins une
# fois ouverte. Le plafond protege la memoire du serveur, rien d'autre.
MAX_IPC = 192 * 1024 * 1024
MAX_OPENEMS = getattr(openems_antenne, "MAX_CORPS", 24 * 1024 * 1024)
# Un projet porte la carte entiere quand elle a change : le plafond est donc
# celui d'un IPC-2581 traduit, et non celui d'un document de simulation.
MAX_PROJET = MAX_IPC

# QUI A LE DROIT DE PARLER A CE SERVEUR. Il ecoute en clair sur le reseau
# local pour qu'une tablette puisse ouvrir la page ; il refuse en revanche les
# requetes modificatrices venues d'une origine qui n'est pas du reseau prive.
# Sans cela, n'importe quelle page ouverte dans le meme navigateur pourrait
# lancer des calculs ici.
ORIGINES = re.compile(
    r"^https?://("
    r"localhost|127\.0\.0\.1|\[::1\]|"
    r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"192\.168\.\d{1,3}\.\d{1,3}|"
    r"172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
    r")(:\d+)?$")


class Refus(Exception):
    """Refus explicite : code HTTP + message lisible par un humain."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


class Poste(http.server.SimpleHTTPRequestHandler):
    """Les fichiers de la page, plus les routes de l'API."""

    # Les types que ce serveur distribue. On ne s'en remet pas au registre du
    # systeme : sous Windows, la base de registre rend parfois text/plain pour
    # un .js, et le navigateur refuse alors de l'executer.
    TYPES = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".xml": "application/xml; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
        # Le noyau OpenCascade des pieces STEP (js/vendor/occt/). Sans ce
        # type, le navigateur refuse la compilation en flux et retombe sur
        # une compilation plus lente, en le signalant dans la console.
        ".wasm": "application/wasm",
    }

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    # -- journal ---------------------------------------------------------
    def log_message(self, format, *args):              # noqa: A002
        sys.stderr.write("  " + (format % args) + "\n")

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        return self.TYPES.get(ext) or super().guess_type(path)

    # -- garde-fous ------------------------------------------------------
    def _route(self):
        return urllib.parse.urlsplit(self.path).path.rstrip("/") or "/"

    def _params(self):
        return urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)

    def _cors(self):
        origine = self.headers.get("Origin")
        if origine and ORIGINES.match(origine):
            self.send_header("Access-Control-Allow-Origin", origine)
            self.send_header("Vary", "Origin")

    def _csrf(self):
        origine = self.headers.get("Origin")
        if origine and not ORIGINES.match(origine):
            self._json({"detail": "Origine inter-site refusee"}, 403)
            return False
        return True

    def _boucle_locale(self):
        """La requete vient-elle de CETTE machine ?

        LE CONTROLE D'ORIGINE NE SUFFIT PAS ICI, ET C'EST LA NUANCE QUI
        COMPTE. `_csrf` et `_cors` protegent contre une PAGE : un navigateur
        qui charge evil.com ne peut pas lire la reponse d'une route d'ici,
        faute d'en-tete `Access-Control-Allow-Origin`. Mais ils ne protegent
        de rien contre un client qui n'est pas un navigateur : un `curl` sur
        le reseau local n'envoie aucun `Origin`, et `_csrf` le laisse passer
        — deliberement, puisque c'est ainsi qu'une tablette ouvre la page.

        Pour la cle du mode IA, ce marche-la ne tient plus : elle est
        personnelle et facturable, et le serveur ecoute sur toutes les
        interfaces par defaut pour que la tablette y arrive. Une adresse de
        boucle locale est le seul filtre qui distingue « ce poste » de « le
        reseau », et c'est exactement la distinction qu'on veut ici.
        """
        hote = (self.client_address[0] if self.client_address else "") or ""
        # ::ffff:127.0.0.1 : une IPv4 vue par la socket en double pile.
        if hote.startswith("::ffff:"):
            hote = hote[7:]
        return hote == "::1" or hote == "127.0.0.1" or hote.startswith("127.")

    def _json(self, charge, code=200):
        corps = json.dumps(charge).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corps)))
        self._cors()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(corps)

    def _api(self, action):
        """Execute action() et traduit les refus en {"detail": "..."}.

        UN REFUS N'EST PAS UNE PANNE, et la page les traite differemment :
        « le port relie une couche a elle-meme » est une consigne, pas une
        erreur de serveur. D'ou un message lisible plutot qu'une trace.
        """
        try:
            self._json(action())
        except Refus as exc:
            self.close_connection = True   # le corps n'a peut-etre pas ete lu
            self._json({"detail": exc.message}, exc.code)
        except Exception as exc:                       # noqa: BLE001
            self.close_connection = True
            self._json({"detail": "Erreur interne : %s" % exc}, 500)

    def _corps(self, plafond):
        """Le corps de la requete en octets. Refuse vide, trop gros.

        UN REFUS QUI N'ARRIVE PAS N'EST PAS UN REFUS. Repondre 413 sans lire
        le corps laisse les octets dans le tuyau, le systeme coupe la
        connexion avant que le client ait lu la reponse, et la page affiche
        « Failed to fetch » au lieu de « Fichier trop grand ». On vide donc,
        mais pas sans limite : le double du plafond, et l'on ferme au-dela.
        """
        try:
            taille = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise Refus(400, "Content-Length invalide")
        if taille <= 0:
            raise Refus(400, "Requete vide")
        if taille > plafond:
            reste = min(taille, 2 * plafond)
            try:
                while reste > 0:
                    bloc = self.rfile.read(min(65536, reste))
                    if not bloc:
                        break
                    reste -= len(bloc)
            except OSError:
                pass
            if taille > 2 * plafond:
                self.close_connection = True
            raise Refus(413, "Trop grand : %.1f Mo, maximum %d Mo"
                             % (taille / 1048576.0, plafond // 1048576))
        return self.rfile.read(taille)

    def _document(self, plafond):
        try:
            return json.loads(self._corps(plafond).decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise Refus(400, "Document JSON illisible : %s" % exc)

    # ==================================================================
    # Route 1 : lire un fichier IPC-2581
    # ==================================================================
    def _ipc_etat(self):
        if ipc2581_json is None:
            return {"dispo": False,
                    "detail": "Parseur IPC-2581 indisponible : %s" % ERREUR_IPC}
        return {"dispo": True, "format": ipc2581_json.FORMAT,
                "extensions": list(ipc2581_json.EXTENSIONS) + [".zip"],
                "max": MAX_IPC}

    def _ipc_lire(self):
        if ipc2581_json is None:
            raise Refus(503, "Parseur IPC-2581 indisponible : %s" % ERREUR_IPC)
        data = self._corps(MAX_IPC)
        nom = os.path.basename((self._params().get("nom") or [""])[0])[:200]
        try:
            modele = ipc2581_json.ipc2581_en_dict(data, nom)
        except ipc2581_json.IPC2581ParseError as exc:
            raise Refus(422, str(exc))
        except MemoryError:
            raise Refus(413, "Fichier trop volumineux pour la memoire disponible")
        sys.stderr.write("  IPC-2581 « %s » : %d composant(s), %d piste(s),"
                         " %d percage(s)\n"
                         % (nom or "(sans nom)", modele["stats"]["composants"],
                            modele["stats"]["pistes"],
                            modele["stats"]["percages"]))
        return modele

    # ==================================================================
    # Routes 2 a 6 : l'antenne
    # ==================================================================
    def _oe(self):
        if openems_antenne is None:
            raise Refus(503, "Outil antenne indisponible : %s" % ERREUR_OPENEMS)

    def _oe_modele(self, action):
        """Appelle action(doc) et traduit un refus de modele en 422.

        Le message et le conseil partent ensemble, separes d'une ligne : la
        page les affiche tels quels, l'un au-dessus de l'autre.
        """
        self._oe()
        doc = self._document(MAX_OPENEMS)
        try:
            return action(doc)
        except openems_antenne.ErreurModele as exc:
            detail = exc.message
            if exc.conseil:
                detail += "\n" + exc.conseil
            raise Refus(422, detail)
        except MemoryError:
            raise Refus(413, "Modele trop lourd pour la memoire disponible")

    def _oe_etat(self):
        if openems_antenne is None:
            return {"dispo": False, "preparer": False, "lancer": False,
                    "detail": "Outil antenne indisponible : %s" % ERREUR_OPENEMS}
        return openems_antenne.etat()

    def _oe_journal(self):
        self._oe()
        p = self._params()
        ident = (p.get("id") or [""])[0]
        if not ident:
            raise Refus(400, "Identifiant de simulation manquant")
        try:
            depuis = int((p.get("depuis") or ["0"])[0])
        except ValueError:
            depuis = 0
        try:
            vue = openems_antenne.journal(ident, depuis)
            self._oe_ranger_debit()
            return vue
        except openems_antenne.ErreurModele as exc:
            detail = exc.message
            if exc.conseil:
                detail += "\n" + exc.conseil
            raise Refus(404, detail)

    def _oe_ranger_debit(self):
        """Le debit qu'un calcul termine a montre va dans les reglages du poste.

        POURQUOI ICI, ET NON A LA FIN DU CALCUL. Le calcul finit dans un fil
        d'openems_run, qui ne sait pas ce qu'est un projet ni ou vivent les
        reglages — c'est la separation que `_pr_suivre` dit deja, et elle vaut
        dans les deux sens. Le suivi du journal, lui, passe par le serveur et
        s'arrete quand le calcul s'arrete : c'est le dernier endroit ou l'on
        est sur de repasser, et le seul qui connaisse les deux cotes.

        `debit_noter` ne reecrit rien quand la valeur n'a pas bouge : appelee a
        chaque rafraichissement du journal, elle ne touche au fichier qu'une
        fois par calcul.
        """
        if projet is None:
            return
        try:
            d = openems_antenne.debit()
            if d.get("mesure"):
                projet.debit_noter(d["mcps"])
        except Exception:                              # noqa: BLE001
            pass

    def _oe_voir(self, action):
        """Ouvre les champs d'une simulation : ParaView, ou le dossier.

        LE SERVEUR LANCE UN PROGRAMME DU POSTE, et cela merite une borne :
        l'identifiant est resolu en dossier par openems_run, qui ne connait
        que les taches QU'IL A CREEES. Un chemin venu de la requete
        n'atteindrait donc jamais cette route — sans quoi elle ouvrirait bien
        autre chose que ParaView.
        """
        self._oe()
        ident = (self._params().get("id") or [""])[0]
        if not ident:
            raise Refus(400, "Identifiant de simulation manquant")
        try:
            return action(ident)
        except openems_antenne.ErreurModele as exc:
            detail = exc.message
            if exc.conseil:
                detail += "\n" + exc.conseil
            raise Refus(404, detail)

    def _oe_champs(self):
        """La liste de ce qu'un calcul a laisse a regarder.

        MEME BORNE QUE ParaView, ET POUR LA MEME RAISON : l'identifiant est
        resolu en dossier par openems_run, qui ne connait que les dossiers
        qu'il a crees. Aucun chemin ne vient de la requete — sans quoi cette
        route lirait n'importe quel fichier du poste et le renverrait au
        navigateur.
        """
        self._oe()
        ident = (self._params().get("id") or [""])[0]
        if not ident:
            raise Refus(400, "Identifiant de simulation manquant")
        try:
            return openems_antenne.champs(ident)
        except openems_antenne.ErreurModele as exc:
            raise Refus(404, self._detail(exc))

    def _oe_champ(self):
        """Une carte de champ, prete a animer.

        La page ne designe jamais un fichier : elle donne la CLE d'une serie
        de l'inventaire, et le serveur la resout. Les autres parametres ne
        decident que du decoupage — quel plan, a quelle hauteur, et combien
        de points au plus.
        """
        self._oe()
        p = self._params()
        ident = (p.get("id") or [""])[0]
        cle = (p.get("cle") or [""])[0]
        if not ident or not cle:
            raise Refus(400, "Identifiant ou enregistrement manquant")
        axe = (p.get("axe") or [""])[0]
        try:
            indice = int((p.get("indice") or ["-1"])[0])
        except ValueError:
            indice = -1
        try:
            points = int((p.get("points") or ["0"])[0])
        except ValueError:
            points = 0
        try:
            return openems_antenne.champ(ident, cle, axe=axe, indice=indice,
                                         max_points=points)
        except openems_antenne.ErreurModele as exc:
            raise Refus(404, self._detail(exc))

    @staticmethod
    def _detail(exc):
        """Message + conseil en un seul texte : la page coupe a la premiere
        ligne pour le titre et garde le reste comme explication."""
        if exc.conseil:
            return "%s\n%s" % (exc.message, exc.conseil)
        return exc.message

    def _oe_arreter(self):
        self._oe()
        ident = (self._params().get("id") or [""])[0]
        if not ident:
            raise Refus(400, "Identifiant de simulation manquant")
        try:
            return openems_antenne.arreter(ident)
        except openems_antenne.ErreurModele as exc:
            raise Refus(404, exc.message)

    # ==================================================================
    # Routes 7 a 12 : les projets
    # ------------------------------------------------------------------
    # LA PAGE NE CHOISIT PAS UN CHEMIN, ELLE CHOISIT UN NOM. Un seul chemin
    # traverse ces routes — la racine, que l'utilisateur pose lui-meme et qui
    # est le sujet meme de la fonctionnalite. Tout le reste est un NOM de
    # projet, verifie caractere par caractere par projet.py et recolle a la
    # racine la-bas. Aucune de ces routes n'accepte de chemin de fichier.
    # ==================================================================
    def _pr(self):
        if projet is None:
            raise Refus(503, "Gestion des projets indisponible : %s"
                             % ERREUR_PROJET)

    def _pr_action(self, action):
        """Execute action() et traduit un refus de projet en 422.

        Comme pour l'antenne : le message et le conseil partent ensemble,
        separes d'une ligne, et la page les affiche l'un au-dessus de l'autre.
        """
        self._pr()
        try:
            return action()
        except projet.ErreurProjet as exc:
            detail = exc.message
            if exc.conseil:
                detail += "\n" + exc.conseil
            raise Refus(422, detail)

    def _pr_suivre(self):
        """Les calculs suivent le projet ouvert.

        Appele apres chaque ouverture, enregistrement ou fermeture : c'est
        le seul lien entre les deux modules, et il va dans un seul sens —
        projet.py ne sait pas qu'openEMS existe, openems_run ne sait pas ce
        qu'est un projet.
        """
        if openems_antenne is not None:
            try:
                openems_antenne.dossier_calculs(projet.dossier_calculs())
            except Exception:                          # noqa: BLE001
                pass

    def _pr_etat(self):
        if projet is None:
            return {"dispo": False,
                    "detail": "Gestion des projets indisponible : %s"
                              % ERREUR_PROJET}
        return dict(projet.etat(), dispo=True)

    def _pr_ouvrir(self):
        nom = (self._params().get("nom") or [""])[0]
        if not nom:
            raise Refus(400, "Nom de projet manquant")
        charge = self._pr_action(lambda: projet.ouvrir(nom))
        self._pr_suivre()
        sys.stderr.write("  Projet « %s » ouvert : %s\n"
                         % (nom, charge.get("dossier", "")))
        return charge

    def _pr_racine(self):
        doc = self._document(4096)
        chemin = (doc or {}).get("chemin") if isinstance(doc, dict) else None
        self._pr_action(lambda: projet.definir_racine(chemin))
        # La racine change : le projet ouvert etait dans l'ancienne, et son
        # nom ne designe plus le meme dossier. On le ferme plutot que de le
        # laisser pointer a cote — un enregistrement silencieux ailleurs est
        # exactement ce qu'on ne veut pas.
        projet.fermer()
        self._pr_suivre()
        return self._pr_etat()

    def _pr_enregistrer(self):
        doc = self._document(MAX_PROJET)
        out = self._pr_action(lambda: projet.enregistrer(doc))
        self._pr_suivre()
        sys.stderr.write("  Projet « %s » enregistre : %s\n"
                         % (out.get("nom", ""), out.get("dossier", "")))
        return out

    def _pr_fermer(self):
        self._pr()
        projet.fermer()
        self._pr_suivre()
        return self._pr_etat()

    def _pr_dossier(self):
        """Ouvre dans l'explorateur la racine, ou le dossier d'un projet."""
        nom = (self._params().get("nom") or [""])[0]
        return self._pr_action(lambda: projet.ouvrir_explorateur(nom or None))

    def _pr_archiver(self):
        """Range le dossier d'un calcul deja fait DANS le projet ouvert.

        LE TROU QUE CETTE ROUTE BOUCHE. `_pr_suivre` ne vaut que pour les
        calculs A VENIR : elle dit ou les prochains ecriront. Un calcul lance
        avant qu'un projet ne soit ouvert a ecrit ses .vtr dans le dossier
        temporaire du systeme, et enregistrer le projet apres coup n'y
        changeait rien — on gardait les courbes et l'on perdait les champs,
        sans que rien ne l'annonce, le jour ou Windows vide son TEMP.

        LE PONT EST ICI, ET IL NE VA QUE DANS UN SENS, comme `_pr_suivre` :
        projet.py donne un dossier, openems_run deplace le sien et met sa
        tache a jour. Aucun chemin ne vient de la requete — seulement un
        identifiant de simulation, que openems_run resout lui-meme et
        seulement pour les taches qu'il a creees.
        """
        self._pr()
        if openems_antenne is None:
            raise Refus(503, "Execution indisponible : %s" % ERREUR_OPENEMS)
        ident = (self._document(4096) or {}).get("id") or ""
        if not ident:
            raise Refus(400, "Identifiant de simulation manquant")
        base = projet.dossier_calculs()
        if not base:
            raise Refus(422, "Aucun projet n'est ouvert : donnez un nom au "
                             "projet et enregistrez-le d'abord, c'est lui "
                             "qui fournit le dossier.")
        try:
            out = openems_antenne.archiver_calcul(ident, base)
        except openems_antenne.ErreurModele as exc:
            detail = exc.message
            if exc.conseil:
                detail += "\n" + exc.conseil
            raise Refus(422, detail)
        if out.get("deplace"):
            sys.stderr.write("  Calcul %s range dans le projet : %s\n"
                             % (ident, out.get("dossier", "")))
        return out

    def _pr_calculs(self):
        """Les dossiers de calcul du projet ouvert.

        POURQUOI CETTE ROUTE. `resultats.json` ne retient qu'UN calcul, le
        dernier ; le projet en accumule un par simulation lancee. Sans cette
        liste, les precedents restaient sur le disque avec leurs champs, et
        la page n'avait aucun moyen de les designer.
        """
        self._pr()
        return {"calculs": projet.calculs(),
                "dossier": projet.dossier_calculs()}

    def _pr_importer(self):
        """Copie un dossier de calcul venu d'ailleurs dans le projet ouvert.

        UN CHEMIN VENU DE LA REQUETE, ET C'EST LE SEUL DE TOUTES CES ROUTES
        AVEC LA RACINE. La regle que l'outil s'etait fixee — « on ne lit que
        des dossiers qu'on a crees soi-meme » — vaut pour les identifiants de
        simulation, qui arrivent d'une page et designent un calcul en cours.
        Elle ne peut pas valoir ici : personne d'autre que l'utilisateur ne
        sait ou est la cle USB de son collegue. Ce qui la remplace tient en
        trois bornes, et elles sont dans projet.py :

          - on ne fait que LIRE la source, jamais l'effacer ni la deplacer ;
          - on n'en copie que les fichiers dont l'extension est celle d'un
            dossier de calcul, un seul niveau de sous-dossier ;
          - on n'ecrit QUE dans `<projet>/calculs/<identifiant neuf>`.

        L'identifiant vient d'openems_run : un dossier importe doit porter la
        meme forme que les autres, sinon il serait le seul que la visionneuse
        ne retrouverait pas apres un redemarrage du serveur.
        """
        self._pr()
        if openems_antenne is None:
            raise Refus(503, "Execution indisponible : %s" % ERREUR_OPENEMS)
        chemin = (self._document(4096) or {}).get("chemin") or ""
        if not chemin:
            raise Refus(400, "Aucun dossier indique.")
        try:
            ident = openems_antenne.identifiant_neuf()
        except openems_antenne.ErreurModele as exc:
            raise Refus(503, exc.message)
        out = self._pr_action(lambda: projet.importer_calcul(chemin, ident))
        sys.stderr.write("  Calcul importe dans le projet : %s -> %s\n"
                         % (out.get("source", ""), out.get("dossier", "")))
        return out

    # ==================================================================
    # La cle du mode IA
    # ==================================================================
    # POURQUOI LE SERVEUR TOUCHE A CA, alors qu'il ne sert que ce qu'un
    # navigateur ne sait pas faire. Justement : une page ne lit pas un
    # fichier du disque, et la seule autre facon de ne pas retaper une cle
    # a chaque seance serait de l'ecrire dans le stockage local du
    # navigateur -- c'est-a-dire en clair, dans un dossier de profil que
    # personne ne surveille, pour toujours. Un fichier a la racine du
    # depot, ignore par git, se voit, se lit, et se supprime.
    #
    # LA CLE N'EST PAS UN SECRET DE CE SERVEUR : il ne la garde pas, ne
    # l'utilise pas, et n'appelle personne avec. Il la relit a chaque
    # demande et la rend a la page, qui la garde en memoire vive le temps
    # de la session (voir js/30-ia.js).
    #
    # MAIS CE SERVEUR N'ECOUTE PAS QUE LA BOUCLE LOCALE, et c'est ce qui a
    # manque longtemps ici. Il se lie a toutes les interfaces par defaut
    # pour qu'une tablette puisse ouvrir la page -- il faut `--local` pour
    # qu'il s'en abstienne. Le controle d'origine, lui, arrete les pages et
    # non les clients : un `curl` du reseau local n'envoie aucun `Origin` et
    # passait donc, cle comprise. C'est la seule route ou ce marche ne tient
    # pas, et c'est la seule qui exige desormais une adresse de boucle
    # locale -- voir `_boucle_locale`. Depuis le reseau, la page demande sa
    # cle comme sur un poste qui n'en a pas.
    CLE_IA = "api_key_free_ia_studio.txt"

    def _ia_cle(self):
        """GET /api/ia/cle : la cle Google AI Studio posee sur ce poste.

        ELLE NE SORT PAS DE CETTE MACHINE, et c'est la seule route qui le
        vérifie. Voir `_boucle_locale` pour pourquoi le controle d'origine
        n'y suffisait pas : il arrete les pages, pas les clients. Une
        tablette qui ouvre la page depuis le reseau local voit donc l'ecran
        de saisie de cle, comme n'importe quel poste sans fichier — ce qui
        est exactement ce qu'on veut, la cle du poste restant au poste.
        """
        if not self._boucle_locale():
            return {"dispo": False, "cle": "", "origine": "",
                    "fichier": self.CLE_IA,
                    "detail": "La cle de ce poste n'est rendue qu'a la "
                              "machine qui fait tourner le serveur. Depuis "
                              "le reseau, saisissez la votre dans le "
                              "panneau : elle ne vivra que dans cet onglet."}
        cle = (os.environ.get("GEMINI_API_KEY")
               or os.environ.get("GOOGLE_API_KEY") or "").strip()
        origine = "environnement"
        if not cle:
            chemin = os.path.join(ROOT, self.CLE_IA)
            if os.path.isfile(chemin):
                try:
                    with open(chemin, "r", encoding="utf-8") as f:
                        txt = f.read().strip()
                    # Un gabarit laisse en place n'est pas une cle. Le
                    # rendre ferait echouer l'appel avec un message de
                    # Google, et on chercherait la panne du mauvais cote.
                    if txt and not txt.upper().startswith(("YOUR_", "AIZA_")):
                        cle = txt
                        origine = "fichier"
                except OSError:
                    pass
        return {"dispo": bool(cle), "cle": cle,
                "origine": origine if cle else "",
                "fichier": self.CLE_IA}

    # ==================================================================
    # Aiguillage
    # ==================================================================
    API = ("/api/ipc2581", "/api/openems", "/api/openems/script",
           "/api/openems/balayage", "/api/openems/balayage/lancer",
           "/api/openems/tableau-s", "/api/openems/tableau-s/lancer",
           "/api/openems/lancer", "/api/openems/arreter",
           "/api/openems/journal", "/api/openems/paraview",
           "/api/openems/dossier",
           "/api/openems/champs", "/api/openems/champ",
           "/api/projet", "/api/projet/ouvrir", "/api/projet/racine",
           "/api/projet/enregistrer", "/api/projet/fermer",
           "/api/projet/dossier", "/api/projet/archiver",
           "/api/projet/calculs", "/api/projet/importer",
           "/api/ia/cle")

    def do_GET(self):
        route = self._route()
        if route == "/api/ipc2581":
            self._api(self._ipc_etat)
            return
        if route == "/api/openems":
            self._api(self._oe_etat)
            return
        if route == "/api/openems/journal":
            self._api(self._oe_journal)
            return
        # Les deux routes de la visionneuse de champs sont en GET : elles ne
        # changent rien, elles LISENT le dossier d'un calcul deja fait.
        if route == "/api/openems/champs":
            self._api(self._oe_champs)
            return
        if route == "/api/openems/champ":
            self._api(self._oe_champ)
            return
        if route == "/api/projet":
            self._api(self._pr_etat)
            return
        if route == "/api/projet/calculs":
            self._api(self._pr_calculs)
            return
        if route == "/api/projet/ouvrir":
            self._api(self._pr_ouvrir)
            return
        if route == "/api/ia/cle":
            self._api(self._ia_cle)
            return
        if route.startswith("/api/"):
            self._json({"detail": "Route inconnue : %s" % route}, 404)
            return
        super().do_GET()

    def do_HEAD(self):
        if self._route().startswith("/api/"):
            self.do_GET()
            return
        super().do_HEAD()

    def do_POST(self):
        if not self._csrf():
            return
        route = self._route()
        if route == "/api/ipc2581":
            self._api(self._ipc_lire)
            return
        if route == "/api/openems":
            self._api(lambda: self._oe_modele(openems_antenne.preparer))
            return
        if route == "/api/openems/script":
            self._api(lambda: self._oe_modele(openems_antenne.script))
            return
        if route == "/api/openems/lancer":
            self._api(lambda: self._oe_modele(openems_antenne.lancer))
            return
        # Le balayage prend le MEME document, augmente d'une liste de points.
        # « balayage » le chiffre sans rien lancer, « balayage/lancer » le
        # lance : la meme separation qu'entre « preparer » et « lancer », et
        # pour la meme raison — on ne s'engage pas dans une heure de calcul
        # sans avoir vu ce qu'elle va couter.
        if route == "/api/openems/balayage":
            self._api(lambda: self._oe_modele(openems_antenne.balayage))
            return
        if route == "/api/openems/balayage/lancer":
            self._api(lambda: self._oe_modele(openems_antenne.lancer_balayage))
            return
        if route == "/api/openems/tableau-s":
            self._api(lambda: self._oe_modele(openems_antenne.tableau_s))
            return
        if route == "/api/openems/tableau-s/lancer":
            self._api(
                lambda: self._oe_modele(openems_antenne.lancer_tableau_s))
            return
        if route == "/api/openems/arreter":
            self._api(self._oe_arreter)
            return
        if route == "/api/openems/paraview":
            self._api(lambda: self._oe_voir(openems_antenne.paraview))
            return
        if route == "/api/openems/dossier":
            self._api(lambda: self._oe_voir(openems_antenne.dossier))
            return
        if route == "/api/projet/racine":
            self._api(self._pr_racine)
            return
        if route == "/api/projet/enregistrer":
            self._api(self._pr_enregistrer)
            return
        if route == "/api/projet/fermer":
            self._api(self._pr_fermer)
            return
        if route == "/api/projet/dossier":
            self._api(self._pr_dossier)
            return
        if route == "/api/projet/archiver":
            self._api(self._pr_archiver)
            return
        if route == "/api/projet/importer":
            self._api(self._pr_importer)
            return
        self._json({"detail": "Route inconnue : %s" % route}, 404)

    def do_OPTIONS(self):
        if self._route() not in self.API:
            self.send_error(405, "Unsupported method (OPTIONS)")
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self._cors()
        self.end_headers()

    # Un fichier servi en clair ne doit pas etre mis en cache par le
    # navigateur : on modifie ces fichiers-la en travaillant, et un .js garde
    # en cache donne des heures de debogage sur du code qui n'existe plus.
    def end_headers(self):
        if not self._route().startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def translate_path(self, path):
        """Sert le dossier du script, et lui seul.

        SimpleHTTPRequestHandler nettoie deja « .. », mais il sert le
        REPERTOIRE COURANT : lance depuis ailleurs, le serveur publierait
        autre chose que ce depot.
        """
        chemin = posixpath.normpath(urllib.parse.unquote(
            urllib.parse.urlsplit(path).path))
        morceaux = [m for m in chemin.split("/")
                    if m and m not in (os.curdir, os.pardir)]
        return os.path.join(ROOT, *morceaux)


class Serveur(socketserver.ThreadingTCPServer):
    """Un fil par requete : le suivi d'une simulation sonde pendant que la
    page continue de charger ses fichiers."""

    daemon_threads = True

    # SO_REUSEADDR N'A PAS LE MEME SENS SUR WINDOWS, et le croire coute cher.
    # Sur Unix il autorise a reprendre un port laisse en TIME_WAIT par un
    # processus mort -- c'est utile, et sans danger. Sur Windows il autorise
    # a se lier a un port QU'UN AUTRE PROGRAMME ECOUTE DEJA : le bind reussit,
    # deux serveurs se retrouvent sur le meme port, et les connexions partent
    # a l'un ou a l'autre au hasard. On voit alors la page d'un logiciel qu'on
    # n'a pas lance, ou pire, une requete sur deux qui arrive ici et l'autre
    # ailleurs. Mieux vaut un refus franc : le repli de `main` cherchera un
    # autre port, ce qui est exactement ce qu'on veut.
    allow_reuse_address = (os.name != "nt")


class ServeurDoublePile(Serveur):
    """Ecoute IPv4 et IPv6 sur la meme socket quand le systeme le permet."""

    address_family = socket.AF_INET6

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except (AttributeError, OSError):
            pass
        super().server_bind()


def ip_reseau():
    """L'adresse du poste sur le reseau local, pour l'afficher au demarrage.

    Le connect() d'un socket UDP n'envoie rien : il demande seulement au
    systeme par quelle interface il sortirait. C'est la facon la plus sure de
    savoir quelle adresse une tablette devra taper.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def url_locale(hote, port):
    """L'adresse a ouvrir sur CETTE machine pour un serveur lie a (hote, port)."""
    if hote in ("", "::", "0.0.0.0", "::1"):
        hote = "127.0.0.1"
    if ":" in hote:                                    # IPv6 litterale
        hote = "[%s]" % hote
    return "http://%s:%d/" % (hote, port)


def _ipv4_libre(port):
    """L'IPv4 de ce port est-il reellement libre ?

    IL FAUT LE DEMANDER, PARCE QUE LE BIND NE LE DIRA PAS. Sur Windows, une
    socket IPv6 en double pile se lie a « [::]:8080 » SANS BRONCHER alors
    qu'un autre programme ecoute deja « 0.0.0.0:8080 » -- et IPV6_V6ONLY
    continue de rendre 0, si bien qu'aucun drapeau ne trahit la situation. Le
    serveur demarre, annonce fierement son adresse, et tous les clients IPv4
    -- c'est-a-dire tout le monde, `127.0.0.1` compris -- atterrissent chez
    l'autre programme. On a alors une page qu'on n'a pas ecrite a l'adresse
    qu'on vient d'ouvrir.

    Une seconde de course subsiste entre cette sonde et le vrai bind. Pour un
    outil local, c'est sans commune mesure avec le defaut qu'elle evite.
    """
    if port == 0:
        return True                                    # le systeme choisira
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("0.0.0.0", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def ouvrir_socket(hote, port):
    """Ouvre un serveur sur (hote, port), ou rend None et les echecs.

    C'EST A L'APPELANT DE JUGER. Une tentative ratee suivie d'un repli reussi
    n'est pas une panne, et l'afficher comme telle donne l'impression d'un
    plantage. On rend donc la liste de ce qui n'a pas marche, sans rien dire.
    """
    if hote in ("", "::") and not _ipv4_libre(port):
        return None, ["%s:%d -- l'IPv4 de ce port est deja pris "
                      "(une socket IPv6 s'y lierait quand meme, et les "
                      "clients IPv4 iraient chez l'autre programme)"
                      % (hote or "toutes", port)]
    if hote in ("", "::"):
        # Double pile d'abord, IPv4 seule ensuite : AF_INET6 n'existe pas
        # partout. Sans ce repli, on retomberait en silence sur un acces
        # local uniquement.
        familles = [ServeurDoublePile, Serveur]
    else:
        # Une adresse explicite peut etre IPv4 : la double pile echouerait.
        familles = [Serveur, ServeurDoublePile]
    echecs = []
    for cls in familles:
        pile = "IPv6 (double pile)" if cls is ServeurDoublePile else "IPv4"
        try:
            return cls((hote, port), Poste), echecs
        except OSError as exc:
            echecs.append("%s, %s:%d -- %s"
                          % (pile, hote or "toutes", port, _pourquoi(exc)))
    return None, echecs


def _lisible(texte):
    """Les guillemets et apostrophes typographiques que Windows met dans ses
    messages d'erreur ne passent pas la console (cp850) : ils y ressortent en
    losanges noirs, et le message devient illisible la ou il compte le plus.
    On les ramene a leurs equivalents ASCII."""
    for a, b in (("’", "'"), ("‘", "'"),
                 ("“", '"'), ("”", '"'),
                 ("–", "-"), ("—", "-"), (" ", " ")):
        texte = texte.replace(a, b)
    return texte


def _pourquoi(exc):
    """Traduit l'erreur systeme en quelque chose d'actionnable.

    WSAEACCES (10013) EST LA PLUS TROMPEUSE. « Accès interdit par ses
    autorisations » laisse croire a un droit administrateur manquant, alors
    que la cause habituelle sur Windows est tout autre : Hyper-V, WSL et
    Docker RESERVENT des plages entieres de ports au demarrage, et le 8000
    tombe souvent dedans. Aucun droit n'y changerait rien — il faut un autre
    port, ce que ce serveur fait tout seul.
    """
    win = getattr(exc, "winerror", None)
    msg = _lisible(str(exc))
    if win == 10013:
        return ("%s\n        Sur Windows, Hyper-V, WSL et Docker reservent des "
                "plages de ports entieres.\n        Pour les voir : "
                "netsh interface ipv4 show excludedportrange protocol=tcp"
                % msg)
    if win == 10048 or getattr(exc, "errno", None) == 98:
        return "%s -- un autre programme ecoute deja sur ce port." % msg
    return msg


def _reexecuter_dans_env():
    """Relance web_antenna.py dans l'environnement virtuel du projet s'il existe.

    Sur Windows, lancer « python web_antenna.py » depuis une invite ordinaire
    utilise le Python du systeme (ex: 3.12 ou 3.13), alors que les paquets
    compiles d'openEMS sont installes dans le venv « env/ » (Python 3.10 ou 3.11).
    Cette fonction detecte l'interpreteur du venv et s'y relance directement.
    """
    if os.environ.get("_ANTENNE_REEXEC") == "1":
        return

    for nom in ("env", ".venv", "venv"):
        for sous in (("Scripts", "python.exe"), ("bin", "python")):
            exe = os.path.join(ROOT, nom, *sous)
            if os.path.isfile(exe):
                try:
                    if os.path.samefile(sys.executable, exe):
                        return
                except (OSError, ValueError):
                    if os.path.abspath(sys.executable).lower() == os.path.abspath(exe).lower():
                        return

                env = dict(os.environ)
                env["_ANTENNE_REEXEC"] = "1"
                import subprocess
                cmd = [exe, os.path.abspath(__file__)] + sys.argv[1:]
                print("  [*] Bascule vers l'environnement virtuel : %s" % exe)
                try:
                    code = subprocess.call(cmd, env=env)
                    sys.exit(code)
                except KeyboardInterrupt:
                    sys.exit(0)
                except Exception as exc:
                    print("  [!] Echec de la bascule vers le venv (%s), poursuite..." % exc)
                    return


def verifier_et_appliquer_maj(dossier_racine=None):
    """Recherche les mises a jour sur GitHub via Git et les applique si disponible.

    Renvoie True si une mise a jour a ete telechargee et appliquee avec succes
    (necessitant un redemarrage du script pour executer le code a jour), ou False
    si l'outil est deja a jour, hors-ligne, ou dans l'impossibilite d'appliquer
    la mise a jour sans intervention manuelle.
    """
    racine = dossier_racine or ROOT
    # Git doit etre disponible dans l'environnement
    if not shutil.which("git"):
        return False

    # Le dossier doit etre un depot Git
    dossier_git = os.path.join(racine, ".git")
    if not os.path.isdir(dossier_git):
        res_test = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=racine, capture_output=True, text=True
        )
        if res_test.returncode != 0:
            return False

    print("[*] Recherche de mises a jour sur GitHub...")
    env_git = os.environ.copy()
    env_git["GIT_TERMINAL_PROMPT"] = "0"

    try:
        fetch = subprocess.run(
            ["git", "fetch", "--quiet", "origin"],
            cwd=racine, capture_output=True, text=True, timeout=10, env=env_git
        )
        if fetch.returncode != 0:
            print("[!] Impossible de contacter GitHub (hors ligne ou depot distant inaccessible).")
            print("[*] Demarrage normal de l'outil...")
            return False
    except subprocess.TimeoutExpired:
        print("[!] Delai de recherche de mise a jour depasse (reseau lent ou indisponible).")
        print("[*] Demarrage normal de l'outil...")
        return False
    except Exception as exc:                           # noqa: BLE001
        print("[!] Echec de la recherche de mise a jour : %s" % exc)
        print("[*] Demarrage normal de l'outil...")
        return False

    # Determination de la branche amont (upstream) ou repli sur origin/main
    upstream = "@{u}"
    res_up = subprocess.run(
        ["git", "rev-parse", "--verify", "@{u}"],
        cwd=racine, capture_output=True, text=True, timeout=5, env=env_git
    )
    if res_up.returncode != 0:
        res_main = subprocess.run(
            ["git", "rev-parse", "--verify", "origin/main"],
            cwd=racine, capture_output=True, text=True, timeout=5, env=env_git
        )
        if res_main.returncode == 0:
            upstream = "origin/main"
        else:
            # Aucune branche amont connue
            return False

    # Nombre de commits distants en attente de recuperation
    res_count = subprocess.run(
        ["git", "rev-list", "HEAD..%s" % upstream, "--count"],
        cwd=racine, capture_output=True, text=True, timeout=5, env=env_git
    )
    if res_count.returncode != 0:
        return False

    try:
        nb_commits = int(res_count.stdout.strip())
    except ValueError:
        return False

    if nb_commits <= 0:
        print("[*] Le logiciel est a jour.")
        return False

    print()
    print("=" * 60)
    print("MISE A JOUR DISPONIBLE (%d nouveau(x) commit(s) sur GitHub)" % nb_commits)
    print("=" * 60)
    print("  Application de la mise a jour en cours...")

    # Detection de modifications locales non commitees dans les fichiers suivis
    st_res = subprocess.run(
        ["git", "status", "--porcelain", "-uno"],
        cwd=racine, capture_output=True, text=True, timeout=5, env=env_git
    )
    dirty = bool(st_res.stdout.strip())
    stashed = False
    if dirty:
        print("  Modifications locales detectees : mise en reserve temporaire...")
        stash_res = subprocess.run(
            ["git", "stash", "push", "-m", "Auto-stash WEB_ANTENNA avant mise a jour"],
            cwd=racine, capture_output=True, text=True, timeout=10, env=env_git
        )
        stashed = (stash_res.returncode == 0)

    pull = subprocess.run(
        ["git", "pull"],
        cwd=racine, capture_output=True, text=True, timeout=30, env=env_git
    )

    if stashed:
        print("  Restauration des modifications locales...")
        subprocess.run(
            ["git", "stash", "pop"],
            cwd=racine, capture_output=True, text=True, timeout=10, env=env_git
        )

    if pull.returncode != 0:
        err = pull.stderr.strip() or pull.stdout.strip()
        print("[!] Echec de l'application de la mise a jour : %s" % err)
        print("[*] Poursuite avec la version actuelle...")
        return False

    print()
    print("=" * 60)
    print("MISE A JOUR APPLIQUEE AVEC SUCCES")
    print("=" * 60)
    print("  Redemarrage automatique de l'outil...")
    print("=" * 60)
    print()
    return True


def redemarrer_application(argv=None):
    """Relance le processus actuel avec les memes arguments apres une mise a jour."""
    env = os.environ.copy()
    env["WEB_ANTENNA_DEJA_MAJ"] = "1"
    cmd = [sys.executable, os.path.abspath(__file__)] + (sys.argv[1:] if argv is None else list(argv))
    try:
        if os.name == "nt":
            # Sous Windows, subprocess.call permet de conserver la fenetre console
            # ouverte (en particulier lors d'un lancement par double-clic).
            code = subprocess.call(cmd, env=env)
            os._exit(code)
        else:
            # Sous Unix / macOS, execv remplace l'image du processus courant
            os.execv(sys.executable, cmd)
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as exc:                           # noqa: BLE001
        print("[!] Erreur lors du redemarrage automatique : %s" % exc)
        print("[*] Poursuite avec le processus actuel...")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=PORT_DEFAUT,
                    help="port d'ecoute (defaut : %d)" % PORT_DEFAUT)
    ap.add_argument("--local", action="store_true",
                    help="n'ecouter que sur 127.0.0.1 : aucun acces reseau")
    ap.add_argument("--sans-navigateur", dest="navigateur",
                    action="store_false",
                    help="ne pas ouvrir le navigateur au demarrage")
    ap.add_argument("--sans-maj", dest="verifier_maj", action="store_false",
                    default=True,
                    help="ne pas verifier les mises a jour GitHub au demarrage")
    args = ap.parse_args(argv)

    # LA MISE A JOUR AVANT TOUT LE RESTE, ET AVANT LA BASCULE DANS LE VENV.
    # Le code telecharge ne sert a rien tant que c'est l'ancien qui tourne :
    # on relance donc le script tel quel, avec ses arguments, et c'est la
    # nouvelle version qui choisira son interpreteur. Le temoin
    # d'environnement evite la boucle si elle trouve encore a tirer.
    if args.verifier_maj and os.environ.get("WEB_ANTENNA_DEJA_MAJ") != "1":
        if verifier_et_appliquer_maj(ROOT):
            redemarrer_application(argv)
    _reexecuter_dans_env()

    hote = "127.0.0.1" if args.local else ""

    # TROIS TENTATIVES, DE LA PLUS SOUHAITABLE A LA PLUS SURE. Un port refuse
    # n'est pas une raison de ne pas demarrer : ce qu'on veut, c'est une page
    # qui s'ouvre. On le dit, on se rabat, et on annonce ou l'on a atterri.
    def detailler(echecs):
        for ligne in echecs:
            print("      %s" % ligne)

    serveur, echecs = ouvrir_socket(hote, args.port)
    if serveur is None and args.port != 0:
        print()
        print("  [!] Le port %d est refuse :" % args.port)
        detailler(echecs)
        for repli in PORTS_REPLI:
            if repli == args.port:
                continue
            print("  [*] Essai du port %d..." % repli)
            serveur, echecs = ouvrir_socket(hote, repli)
            if serveur is not None:
                break
            detailler(echecs)
    if serveur is None and args.port != 0:
        print("  [*] Recherche d'un port libre, au choix du systeme...")
        serveur, echecs = ouvrir_socket(hote, 0)
    if serveur is None and hote != "127.0.0.1":
        print("  [!] Aucune interface reseau n'accepte l'ecoute :")
        detailler(echecs)
        print("  [*] Tentative en local seulement...")
        serveur, echecs = ouvrir_socket("127.0.0.1", 0)
    if serveur is None:
        print()
        print("  [X] Impossible de demarrer le serveur :")
        detailler(echecs)
        return 1

    lie, port = serveur.server_address[0], serveur.server_address[1]
    local_seul = lie in ("127.0.0.1", "::1")
    url = url_locale(lie, port)

    # LE DEBIT DU POSTE, RECOLLE AVANT LA PREMIERE PAGE. Sans lui, la premiere
    # annonce de duree de la session repartirait de la valeur supposee — et
    # c'est la premiere qu'on lit, celle sur laquelle on decide de lancer ou
    # non. Le pont est ici et nulle part ailleurs : projet.py range un nombre
    # sans savoir ce qu'il mesure, openems_antenne le mesure sans savoir ou on
    # le range.
    if openems_antenne is not None and projet is not None:
        try:
            v = projet.debit_lu()
            if v > 0:
                openems_antenne.debit_noter(v)
        except Exception:                              # noqa: BLE001
            pass

    print()
    print("  Antenne openEMS")
    print("  " + "-" * 48)
    print("  Dossier   %s" % ROOT)
    print("  Adresse   %s" % url)
    if not local_seul:
        print("            http://%s:%d/   (reseau local)" % (ip_reseau(), port))
    if port != args.port:
        print("            (le port %d etait refuse : celui-ci a ete pris a"
              " sa place)" % args.port)
    print()
    print("  Parseur IPC-2581  %s"
          % ("pret" if ipc2581_json else "ABSENT : %s" % ERREUR_IPC))
    if openems_antenne is None:
        print("  Solveur openEMS   ABSENT : %s" % ERREUR_OPENEMS)
    else:
        etat = openems_antenne.etat()
        solveur = etat.get("solveur") or {}
        print("  Solveur openEMS   %s"
              % ("pret" if etat.get("lancer")
                 else "indisponible (%s)" % etat.get("lancer_detail", "?")))
        # QUEL PYTHON LANCERA LE SOLVEUR. Il n'est pas forcement celui qui
        # fait tourner ce serveur : web_antenna.py n'a aucune dependance et
        # demarre sous le Python du systeme, alors qu'openEMS vit presque
        # toujours dans un environnement virtuel a cote. Le dire evite une
        # demi-heure de recherche quand « Lancer » reste eteint.
        exe = solveur.get("python")
        if exe and exe != sys.executable:
            print("                    via %s" % exe)
        if not etat.get("lancer"):
            print("                    la preparation et l'export du script")
            print("                    restent possibles")
            for ligne in (etat.get("lancer_conseil") or "").splitlines():
                if ligne.strip():
                    print("                    %s" % ligne.strip())
        if solveur.get("dll"):
            print("  DLL               %s" % solveur["dll"])
        if etat.get("paraview"):
            print("  ParaView          %s" % etat["paraview"])
        d = openems_antenne.debit()
        print("  Debit annonce     %.1f Mcellules/s  (%s)"
              % (d["mcps"],
                 ("mesure sur %d calcul(s) de ce poste" % d["n"])
                 if d["mesure"] else "suppose : aucun calcul n'a encore fini"))
    print()
    print("  Ctrl+C pour arreter.")
    print()
    # VIDER LE TAMPON MAINTENANT. Python ne vide stdout par ligne que si c'est
    # un terminal ; lance depuis un lanceur, un service ou avec la sortie
    # redirigee, la banniere resterait dans le tampon jusqu'a l'arret du
    # serveur -- c'est-a-dire qu'on ne verrait JAMAIS l'adresse a ouvrir,
    # puisque serve_forever() ne rend la main qu'a la fin.
    sys.stdout.flush()

    if args.navigateur:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        print("\n  Arret.")
    finally:
        serveur.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
