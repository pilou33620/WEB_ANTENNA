#!/usr/bin/python3
# -*- coding: utf-8 -*-
# ==========================================================================
# VERSIONING
# Version: 1.0.0
# Date: 2026-09-14
# Explication : lance vraiment openEMS, et rend compte pendant qu'il tourne.
#
#   CE MODULE NE CONSTRUIT PAS LE MODELE DANS LE PROCESSUS DU SERVEUR, ET
#   C'EST DELIBERE. Il ecrit le script produit par openems_script.py, puis il
#   le lance dans un processus separe. Trois raisons, dans l'ordre ou elles
#   comptent :
#
#   1. CE QUI TOURNE EST EXACTEMENT CE QU'ON EXPORTE. Le bouton « Exporter le
#      script » et le bouton « Lancer » passent par le meme texte. Un script
#      exporte qui ne reproduirait pas le resultat de l'interface serait pire
#      qu'inutile : il serait trompeur.
#   2. UN SOLVEUR QUI PLANTE NE DOIT PAS EMPORTER LE SERVEUR. openEMS est du
#      C++ appele par des liaisons : une geometrie degeneree peut le faire
#      tomber par une faute de segmentation, qui tuerait le processus Python
#      hote — et avec lui la page, les autres outils et le travail en cours.
#   3. ON PEUT L'ARRETER. Un calcul de trois heures lance par erreur se tue
#      par son PID ; un appel bloquant dans un fil d'execution Python, non.
#
#   Le prix a payer est le demarrage d'un interpreteur (une seconde) et le
#   passage des resultats par un fichier JSON. C'est un prix derisoire devant
#   une simulation qui dure des minutes.
#
# Fonctions : etat, lancer, lancer_balayage, lancer_tableau_s, journal,
#            resultat, arreter, nettoyer, definir_racine_calculs
# ==========================================================================
"""Execute une simulation openEMS en sous-processus et suit son avancement."""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid

import openems_modele
import openems_script

# Racine du depot : python/ est a cote de serveur.py, openEMS/ aussi.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MAX_CORPS = openems_modele.MAX_CORPS

# Une tache oubliee garde son dossier de calcul et ses champs : on ne les
# efface pas (ParaView en a besoin), mais on cesse de suivre la tache elle-meme
# au bout d'un moment, sinon le serveur les accumule sans fin.
DUREE_MEMOIRE = 12 * 3600


def dossier_openems():
    """Ou sont les DLL d'openEMS, si elles sont dans le depot.

    Sur Windows les liaisons Python d'openEMS ne trouvent pas CSXCAD.dll
    toute seule : le paquet pip installe le module, les DLL viennent de
    l'archive binaire, et rien ne relie les deux. Sans `os.add_dll_directory`,
    « import CSXCAD » echoue sur un « DLL load failed » qui ne nomme pas le
    fichier manquant — l'erreur la plus opaque de toute l'installation.
    """
    for nom in ("openEMS", "openems"):
        chemin = os.path.join(ROOT, nom)
        if os.path.isfile(os.path.join(chemin, "CSXCAD.dll")):
            return chemin
        if os.path.isfile(os.path.join(chemin, "libCSXCAD.so")):
            return chemin
    return ""


def _preparer_env():
    """Environnement du sous-processus : les DLL d'openEMS d'abord."""
    env = dict(os.environ)
    dll = dossier_openems()
    if dll:
        env["PATH"] = dll + os.pathsep + env.get("PATH", "")
        env["OPENEMS_DLL"] = dll
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUNBUFFERED"] = "1"
    return env


# ==========================================================================
# Quel Python lance le solveur
# ==========================================================================
# CE N'EST PAS FORCEMENT CELUI QUI FAIT TOURNER LE SERVEUR, et c'est la
# deuxieme surprise de l'installation apres les DLL. `serveur.py` n'a aucune
# dependance : il demarre parfaitement sous le Python du systeme. openEMS,
# numpy et h5py, eux, sont presque toujours dans un environnement virtuel a
# cote — et un `python serveur.py` lance depuis une invite ordinaire
# n'utiliserait alors PAS cet environnement. Le bouton « Lancer » resterait
# eteint sur un poste ou tout est pourtant installe.
#
# On cherche donc l'interpreteur qui sait VRAIMENT importer CSXCAD, en
# commencant par celui qui nous fait tourner.
_VENVS = ("env", ".venv", "venv")
_INTERPRETE = None


def _interpretes_candidats():
    out = [sys.executable]
    for nom in _VENVS:
        for sous in (("Scripts", "python.exe"), ("bin", "python")):
            chemin = os.path.join(ROOT, nom, *sous)
            if os.path.isfile(chemin) and chemin not in out:
                out.append(chemin)
    return out


def _sait_importer(exe):
    """Cet interpreteur voit-il CSXCAD et openEMS ? Rend (oui, detail)."""
    code = (
        "import os,sys,json\n"
        "d=os.environ.get('OPENEMS_DLL','')\n"
        "if d and hasattr(os,'add_dll_directory'):\n"
        "    os.add_dll_directory(d)\n"
        "try:\n"
        "    import CSXCAD, openEMS\n"
        "    print(json.dumps({'dispo':True,"
        "'version':str(getattr(openEMS,'__version__','?'))}))\n"
        "except Exception as e:\n"
        "    print(json.dumps({'dispo':False,"
        "'detail':'%s: %s'%(type(e).__name__,e)}))\n"
    )
    try:
        p = subprocess.run([exe, "-c", code], capture_output=True, text=True,
                           timeout=90, env=_preparer_env())
        lignes = (p.stdout or "").strip().splitlines()
        if lignes:
            return json.loads(lignes[-1])
        return {"dispo": False,
                "detail": (p.stderr or "aucune reponse").strip()[-300:]}
    except Exception as exc:                           # noqa: BLE001
        return {"dispo": False, "detail": "%s: %s" % (type(exc).__name__, exc)}


def interprete():
    """L'interpreteur retenu pour lancer les simulations."""
    if _INTERPRETE is None:
        etat()
    return _INTERPRETE or sys.executable


_ETAT_CACHE = None


def etat(refaire=False):
    """openEMS est-il utilisable, et par quel interpreteur ?

    On le verifie en l'IMPORTANT POUR DE VRAI, dans un sous-processus : un
    import rate ici ne doit rien casser, et une reponse devinee ne vaudrait
    rien -- c'est exactement le genre de chose qui echoue pour une raison
    qu'on n'aurait pas pensee.
    """
    global _ETAT_CACHE, _INTERPRETE
    if _ETAT_CACHE is not None and not refaire:
        return _ETAT_CACHE

    essais = []
    retenu, out = None, {"dispo": False, "detail": "sonde impossible"}
    for exe in _interpretes_candidats():
        r = _sait_importer(exe)
        essais.append({"python": exe, "dispo": bool(r.get("dispo")),
                       "detail": r.get("detail", "")})
        if r.get("dispo"):
            retenu, out = exe, r
            break
        out = r

    _INTERPRETE = retenu
    out["dll"] = dossier_openems()
    out["python"] = retenu or sys.executable
    out["serveur_python"] = sys.executable
    out["essais"] = essais
    out["max"] = MAX_CORPS

    if not out.get("dispo"):
        conseil = (
            "openEMS et CSXCAD s'installent en deux morceaux : le module "
            "Python (« pip install openEMS CSXCAD ») et les binaires. Sur "
            "Windows, posez l'archive binaire dans un dossier « openEMS » a "
            "cote de serveur.py : ce module y cherche CSXCAD.dll et l'ajoute "
            "au chemin de recherche lui-meme.")
        # LE CAS LE PLUS FREQUENT, ET LE PLUS DEROUTANT : tout est installe,
        # mais dans un environnement virtuel que le Python du serveur ne voit
        # pas. On le nomme, plutot que de laisser chercher.
        if len(essais) > 1:
            conseil += ("\nAucun des %d interpreteurs essayes ne l'importe : "
                        "%s. Si openEMS est installe ailleurs, lancez le "
                        "serveur AVEC cet interpreteur-la."
                        % (len(essais),
                           ", ".join(e["python"] for e in essais)))
        else:
            conseil += ("\nUn seul interpreteur a ete essaye (%s) : si openEMS "
                        "vit dans un environnement virtuel, posez-le dans un "
                        "dossier « env » a cote de serveur.py, ou lancez le "
                        "serveur avec le python de cet environnement."
                        % sys.executable)
        out["conseil"] = conseil
    _ETAT_CACHE = out
    return out


# ==========================================================================
# Le suivi d'avancement
# ==========================================================================
# openEMS ecrit une ligne par tranche de pas de temps, de cette forme :
#
#   [@     1m40s] Timestep:    14586 || Speed:  7.1 MC/s (8.654e-03 s/TS)
#   || Energy: ~2.68e-17 (-39.06dB)
#
# IL N'Y A PAS DE POURCENTAGE DANS CETTE LIGNE, et c'est pour cela qu'on le
# calcule ici : le rapport au nombre maximal de pas ne figure pas dans la
# sortie d'openEMS 0.0.36, alors que la page a besoin d'une barre qui avance.
# Ce pourcentage-la ne dit d'ailleurs pas grand-chose — NrTS est un garde-fou,
# pas le critere d'arret : une simulation qui converge s'arrete a 30 % et
# c'est normal. C'est l'ENERGIE qui dit vraiment ou on en est, et c'est elle
# que la page montre en grand.
_RE_PAS = re.compile(r"Timestep:?\s+(\d+)")
# « (- 1.88dB) » : openEMS aligne ses colonnes en glissant une ESPACE entre le
# signe et le nombre. Sans le `\s*` qui suit le moins, l'energie ne se lit que
# sur les lignes ou elle passe les dix decibels — c'est-a-dire jamais au debut,
# quand on la regarde le plus.
_RE_ENERGIE = re.compile(r"Energy:\s*~?([\d.eE+-]+)\s*\(\s*(-?\s*[\d.]+)\s*dB")
_RE_VITESSE = re.compile(r"Speed:\s*([\d.]+)\s*MC/s")


def _ordonnee(points, x):
    """L'energie que la droite ajustee donne au pas `x`."""
    n = len(points)
    mx = sum(p[1] for p in points) / n
    my = sum(p[2] for p in points) / n
    return my + _pente(points) * (x - mx)


def _pente(points):
    """Pente de l'energie (dB) en fonction du pas, aux moindres carres.

    Une difference entre le premier et le dernier point suffirait si l'energie
    descendait sagement. Elle ne le fait pas : elle ressaute d'un facteur deux
    d'une ligne a l'autre, et deux points mal tombes donnent une pente nulle ou
    montante. La regression, elle, encaisse le bruit.
    """
    n = len(points)
    sx = sum(p[1] for p in points)
    sy = sum(p[2] for p in points)
    sxx = sum(p[1] * p[1] for p in points)
    sxy = sum(p[1] * p[2] for p in points)
    d = n * sxx - sx * sx
    return 0.0 if abs(d) < 1e-9 else (n * sxy - sx * sy) / d


class Tache(object):
    """Une simulation : son dossier, son processus, son journal, son resultat."""

    def __init__(self, ident, dossier, modele):
        self.id = ident
        self.dossier = dossier
        self.modele = modele
        self.etat = "prepare"          # prepare | calcule | fini | echoue | arrete
        self.journal = []
        self.avancement = {"pas": 0, "pourcent": 0.0, "energie_dB": None,
                           "vitesse": 0.0, "restant_s": None, "cause": ""}
        # L'historique (instant, pas, energie en dB) des dernieres lignes
        # d'avancement. Il sert a estimer le temps restant -- voir `_reste`.
        self._hist = []
        # L'energie BRUTE (pas, valeur), qui dit ce que les decibels cachent :
        # voir `_ajouter` et `diagnostic_energie`.
        self._brute = []
        # Les vitesses qu'openEMS a annoncees, dans l'ordre. Elles servent
        # apres coup, quand le calcul a fini : voir `_noter_debit`.
        self._vitesses = []
        self.resultat = None
        self.detail = ""
        self.debut = time.time()
        self.fin = 0.0
        self.proc = None
        self._verrou = threading.Lock()

    # -- journal ---------------------------------------------------------
    def _ajouter(self, ligne):
        ligne = ligne.rstrip("\r\n")
        if not ligne:
            return
        with self._verrou:
            self.journal.append(ligne)
            # Une simulation bavarde peut ecrire des dizaines de milliers de
            # lignes. On garde le debut (ou sont les erreurs de geometrie) et
            # la fin (ou est l'avancement), pas le milieu.
            if len(self.journal) > 4000:
                del self.journal[200:1200]
                self.journal.insert(200, "  … (lignes intermediaires omises) …")

        m = _RE_PAS.search(ligne)
        if m:
            pas = int(m.group(1))
            self.avancement["pas"] = pas
            nmax = self.modele.get("arret", {}).get("nmax") or 0
            if nmax > 0:
                self.avancement["pourcent"] = min(100.0, 100.0 * pas / nmax)
        m = _RE_ENERGIE.search(ligne)
        if m:
            try:
                self.avancement["energie_dB"] = float(m.group(2).replace(" ", ""))
            except ValueError:
                pass
            # L'ENERGIE BRUTE EN PLUS DES DECIBELS, ET C'EST ELLE QUI DISTINGUE
            # UNE DIVERGENCE. Les decibels d'openEMS sont pris sur le MAXIMUM
            # ATTEINT JUSQUE-LA : un calcul qui explose les affiche a 0,00 dB
            # d'un bout a l'autre, exactement comme un calcul dont l'impulsion
            # entre encore. Les deux se lisent pareil en dB et n'ont rien a
            # voir -- seul le nombre devant le dit.
            try:
                self._brute.append((self.avancement["pas"],
                                    float(m.group(1))))
                if len(self._brute) > 400:
                    del self._brute[:200]
            except ValueError:
                pass
        m = _RE_VITESSE.search(ligne)
        if m:
            try:
                self.avancement["vitesse"] = float(m.group(1))
                self._vitesses.append(self.avancement["vitesse"])
            except ValueError:
                pass
        # Une ligne d'avancement porte le pas ET l'energie : c'est celle-la, et
        # elle seule, qui entre dans l'historique.
        if _RE_PAS.search(ligne) and self.avancement["energie_dB"] is not None:
            self._hist.append((time.time(), self.avancement["pas"],
                               self.avancement["energie_dB"]))
            if len(self._hist) > 400:
                del self._hist[:200]
            self._reste()

    # -- le temps restant ------------------------------------------------
    def _reste(self):
        """Combien de temps encore, et a cause de quoi.

        DEUX COMPTEURS COURENT, ET CE N'EST PAS LE MEME QUI GAGNE SELON LES
        CAS. Le garde-fou `nmax` donne une borne franche : il reste tant de
        pas, on sait a quelle vitesse ils defilent. Mais ce n'est presque
        jamais lui qui arrete -- c'est l'ENERGIE RESIDUELLE, qui doit tomber
        sous un seuil. Un pourcentage calcule sur `nmax` annoncerait donc
        systematiquement trois fois trop de temps, et une barre qui ment est
        pire qu'une barre absente.

        L'ENERGIE DECROIT EN EXPONENTIELLE, donc en DROITE quand on la lit en
        decibels : une regression sur les derniers points donne la pente, et
        la pente dit dans combien de pas le seuil sera franchi. On rend le
        plus court des deux, et on DIT lequel commande -- « l'energie » ou
        « le garde-fou » ne veulent pas dire la meme chose pour qui regarde.

        DEUX PRECAUTIONS. On ne regarde que les points posterieurs au MAXIMUM
        d'energie : tant que l'impulsion entre, l'energie monte, et une pente
        montante extrapolerait l'infini. Et on ne rend rien tant qu'on n'a pas
        quelques points apres ce maximum -- l'energie ressaute d'un facteur
        deux d'une ligne a l'autre, une estimation sur deux points serait un
        chiffre au hasard.
        """
        self.avancement["restant_s"] = None
        self.avancement["cause"] = ""
        h = self._hist
        if len(h) < 10:
            return
        # APRES LE MAXIMUM D'ENERGIE, ET SUR TOUT CE QUI SUIT -- pas seulement
        # sur les derniers points. La descente est une droite en decibels : plus
        # la fenetre est longue, plus la pente est sure, et une fenetre glissante
        # de trente points faisait sauter l'annonce de 5 a 44 minutes d'une ligne
        # a l'autre. On jette le premier quart, ou l'impulsion finit de sortir et
        # ou la descente n'a pas encore sa pente definitive.
        i_max = max(range(len(h)), key=lambda i: h[i][2])
        apres = h[i_max + 1:]
        fen = apres[len(apres) // 4:]
        if len(fen) < 8:
            return

        t0, pas0, _ = fen[0]
        t1, pas1 = fen[-1][0], fen[-1][1]
        # L'ENERGIE DE DEPART EST CELLE DE LA DROITE, PAS CELLE DU DERNIER
        # POINT. Le dernier point ressaute volontiers de quatre decibels ; le
        # prendre pour depart ferait osciller l'annonce du simple au triple a
        # chaque rafraichissement. On lit donc l'energie SUR la droite ajustee.
        e1 = _ordonnee(fen, pas1)
        if pas1 <= pas0 or t1 <= t0:
            return
        pas_par_s = (pas1 - pas0) / (t1 - t0)

        nmax = self.modele.get("arret", {}).get("nmax") or 0
        cible = self.modele.get("arret", {}).get("energie_dB")
        fins = []
        if nmax > 0:
            fins.append((nmax, "le garde-fou"))

        pente = _pente(fen)            # dB par pas, negative quand ca descend
        if cible is not None and pente < -1e-9 and e1 > cible:
            fins.append((pas1 + (e1 - cible) / (-pente), "l'energie"))

        if not fins:
            return
        fin, cause = min(fins)
        self.avancement["restant_s"] = max(0.0, (fin - pas1) / pas_par_s)
        self.avancement["cause"] = cause

    def vue(self, depuis=0):
        """Ce que la page affiche : l'etat, l'avancement, les lignes nouvelles."""
        with self._verrou:
            total = len(self.journal)
            depuis = max(0, min(depuis, total))
            lignes = self.journal[depuis:]
        out = {
            "id": self.id,
            "etat": self.etat,
            "avancement": dict(self.avancement),
            "lignes": lignes,
            "n": total,
            "duree": (self.fin or time.time()) - self.debut,
            "detail": self.detail,
            "dossier": self.dossier,
        }
        if self.etat == "fini":
            out["resultat"] = self.resultat
        return out

    # -- execution -------------------------------------------------------
    def demarrer(self, script):
        chemin = os.path.join(self.dossier, "antenne.py")
        with open(chemin, "w", encoding="utf-8") as f:
            f.write(script)
        self._ajouter("Script ecrit : %s" % chemin)
        self._ajouter("Interpreteur : %s" % interprete())
        self._ajouter("Dossier de calcul : %s" % self.dossier)
        self._ajouter("")
        self.etat = "calcule"
        fil = threading.Thread(target=self._courir, args=(chemin,), daemon=True)
        fil.start()

    def _courir(self, chemin):
        try:
            self.proc = subprocess.Popen(
                [interprete(), "-u", chemin],
                cwd=self.dossier, env=_preparer_env(),
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace", bufsize=1)
        except Exception as exc:                       # noqa: BLE001
            self.etat = "echoue"
            self.detail = "Impossible de lancer l'interpreteur : %s" % exc
            self.fin = time.time()
            return

        for ligne in self.proc.stdout:
            self._ajouter(ligne)
        code = self.proc.wait()
        self.fin = time.time()

        if self.etat == "arrete":
            self.detail = "Arrete a la demande."
            return
        if code != 0:
            self.etat = "echoue"
            self.detail = self._diagnostic(code)
            return

        chemin_json = os.path.join(self.dossier, "resultats.json")
        if not os.path.isfile(chemin_json):
            self.etat = "echoue"
            self.detail = ("Le calcul s'est termine sans ecrire de resultats. "
                           "Le journal ci-dessous dit ou il s'est arrete.")
            return
        try:
            with open(chemin_json, "r", encoding="utf-8") as f:
                self.resultat = json.load(f)
        except Exception as exc:                       # noqa: BLE001
            self.etat = "echoue"
            self.detail = "Resultats illisibles : %s" % exc
            return
        self.etat = "fini"
        # UNE SIMULATION SEULE MERITE LE MEME DIAGNOSTIC QU'UN POINT DE
        # BALAYAGE. Elle est meme le cas le plus frequent : c'est par elle
        # qu'on commence, et c'est donc elle qui rend pour la premiere fois un
        # panneau de resultats entierement vide.
        if isinstance(self.resultat, dict) \
                and self.resultat.get("s11_min_db") is None:
            d = self.diagnostic_energie()
            if d:
                self.resultat["diagnostic"] = d
                self.detail = d
                self._ajouter("")
                self._ajouter("Aucune grandeur exploitable : la simulation "
                              "n'a rien rendu de fini.")
                self._ajouter(d)
        self._noter_debit()

    def _noter_debit(self):
        """Ce que ce calcul a appris du poste : sa vitesse.

        ELLE NE SE NOTE QU'A LA FIN, ET SEULEMENT SI LE CALCUL A ABOUTI. Une
        simulation arretee a la main ou tombee sur une erreur a souvent passe
        son temps ailleurs que dans la boucle FDTD, et sa vitesse moyenne ne
        dit rien du poste.

        LA PREMIERE LIGNE EST ECARTEE quand il y en a d'autres : le premier
        rapport d'openEMS compte le temps de montage du maillage avec les
        premiers pas de temps, et annonce donc une vitesse plus basse que le
        regime etabli. La mediane de ce qui reste va au modele, qui la range
        avec celles des calculs precedents.
        """
        v = self._vitesses[1:] if len(self._vitesses) > 2 else self._vitesses
        if not v:
            return
        t = sorted(v)
        n = len(t)
        med = t[n // 2] if n % 2 else 0.5 * (t[n // 2 - 1] + t[n // 2])
        openems_modele.noter_debit(med)

    def _repartir_energie(self):
        """La courbe d'energie repart a zero : elle decrit UNE simulation.

        POURQUOI C'EST UNE METHODE, ET POURQUOI ELLE EXISTE. Un balayage
        enchaine N calculs dans la MEME tache, et l'historique s'y accumulait
        d'un point sur l'autre : le maximum d'energie restait celui du point 1,
        si bien que le temps restant des points suivants etait extrapole sur
        une pente calculee a cheval sur deux calculs. La meme courbe sert
        maintenant a `diagnostic_energie`, qui dirait alors ce qui a diverge
        au point precedent.

        LES VITESSES, ELLES, NE SONT PAS REMISES A ZERO : celles-la decrivent
        le poste et non le point, et c'est leur mediane sur toute la suite qui
        cale les durees annoncees.
        """
        self._hist = []
        self._brute = []

    # -- quand il ne revient AUCUN chiffre ---------------------------------
    def diagnostic_energie(self):
        """Pourquoi ce calcul n'a rien rendu d'exploitable.

        CE QUI MANQUAIT, ET CE QUE CELA COUTAIT. Une simulation dont toutes
        les grandeurs ressortent `None` etait deja survivable — elle ne tue
        plus la suite d'un balayage, et le journal disait « aucune grandeur
        exploitable ». Il ne disait pas CE QUI a rate, et la seule facon de
        l'apprendre etait de relire quatre mille lignes d'avancement pour y
        chercher une courbe d'energie. Or cette courbe, la tache la suit deja
        pas a pas : elle sert a annoncer le temps restant. Il n'y a donc rien
        a mesurer de plus, seulement a nommer.

        TROIS CAS, ET ILS NE SE CORRIGENT PAS DE LA MEME FACON :

        - l'energie MONTE encore a la fin. Une impulsion qui entre monte
          aussi, mais elle s'arrete ; une montee qui ne s'arrete pas est une
          divergence, et elle vient du maillage -- une cellule trop petite
          quelque part, ou une geometrie degeneree qui en fabrique une.
        - l'energie DESCEND mais n'arrive pas au seuil. C'est le garde-fou
          `nmax` qui a coupe, et la transformee porte alors sur une descente
          tronquee : elle ne rend pas une mesure, elle rend un artefact.
        - l'energie est BIEN descendue. Le calcul s'est deroule normalement,
          et ce qui manque est ailleurs -- un port qui n'excite rien, une
          sonde qui ne voit aucun cuivre.

        LES DECIBELS NE SUFFISENT PAS A TRANCHER LE PREMIER, et c'est la
        raison d'etre de `self._brute` : openEMS rapporte ses decibels par
        rapport au maximum atteint jusque-la, si bien qu'un calcul qui explose
        affiche 0,00 dB du debut a la fin.

        Rend `None` quand il n'y a rien a dire -- pas de journal d'avancement,
        donc pas de courbe a lire.
        """
        h = self._hist
        if len(h) < 6 or len(self._brute) < 6:
            if not h:
                return ("openEMS n'a publie aucun pas de temps : il s'est "
                        "arrete avant la boucle de calcul. Le debut du "
                        "journal dit sur quoi -- le maillage et la geometrie "
                        "y passent en premier.")
            return None

        brutes = [v for _, v in self._brute]
        i_max = max(range(len(brutes)), key=lambda i: brutes[i])
        fin = len(brutes) - 1
        e_fin = h[-1][2]
        cible = self.modele.get("arret", {}).get("energie_dB")

        # 1. Ca montait encore. Le maximum est dans le dernier dixieme de ce
        #    qu'on a vu : l'impulsion est finie depuis longtemps.
        if i_max >= 0.9 * fin and fin > 5:
            debut = sorted(brutes[:max(1, fin // 3)])
            ref = debut[len(debut) // 2] or 1e-300
            facteur = brutes[fin] / ref if ref else 0.0
            # UNE MONTEE N'EST PAS FORCEMENT UNE DIVERGENCE. Tant que
            # l'impulsion entre, l'energie monte aussi -- c'est normal, et un
            # calcul coupe la se corrige au compteur de pas, pas au maillage.
            # Ce qui les separe est l'ORDRE DE GRANDEUR : une impulsion fait
            # monter l'energie de quelques decades pendant sa montee, une
            # divergence de beaucoup plus, et sans jamais s'arreter. Envoyer
            # au mauvais reglage est pire que ne rien dire.
            if facteur < 1e3:
                return ("L'energie MONTAIT encore quand le calcul s'est arrete, "
                        "mais modestement (x%.3g) : le compteur de pas a coupe "
                        "pendant que l'impulsion entrait encore. Ce n'est pas "
                        "une divergence, c'est un calcul interrompu avant "
                        "d'avoir commence a mesurer. Relevez `nmax` : openEMS "
                        "demande au moins trois fois la duree de l'excitation, "
                        "et une antenne resonante en demande bien davantage "
                        "pour se vider ensuite." % facteur)
            return ("L'energie MONTAIT encore quand le calcul s'est arrete "
                    "(x%.3g depuis le debut) : le calcul diverge, il ne "
                    "converge pas lentement. Une divergence FDTD vient du "
                    "maillage -- une cellule beaucoup plus petite que les "
                    "autres, souvent fabriquee par une geometrie degeneree : "
                    "deux bords a un micron l'un de l'autre, un polygone "
                    "d'aire nulle, un port plus mince qu'une cellule. "
                    "Regardez le maillage avant de relancer : les decibels "
                    "du journal, eux, ne le montrent pas -- openEMS les "
                    "compte sur le maximum atteint, et ils restent a 0,00 dB "
                    "pendant toute la montee." % facteur)

        # 2. Ca descendait, mais pas assez loin.
        if cible is not None and e_fin > cible + 6:
            return ("L'energie n'est descendue qu'a %.1f dB, pour un seuil "
                    "demande a %.0f dB : c'est le garde-fou du nombre de pas "
                    "qui a arrete le calcul, pas l'energie. La transformee "
                    "porte alors sur une descente tronquee, et ce qu'elle "
                    "rend n'est pas une mesure. Relevez `nmax`, ou remontez "
                    "le seuil si cette antenne se vide vraiment lentement -- "
                    "une antenne resonante met du temps, c'est normal."
                    % (e_fin, cible))

        # 3. La descente s'est bien passee : ce n'est pas elle.
        return ("L'energie est bien descendue (%.1f dB) : le calcul s'est "
                "deroule normalement, et ce qui manque ne vient pas de sa "
                "convergence. Les causes qui restent sont du cote de la "
                "mesure -- un port qui n'excite rien parce que sa pastille "
                "est plus fine que la maille, ou une sonde posee hors du "
                "cuivre. L'assistant compte ces deux cas AVANT le lancement : "
                "relisez ses avis." % e_fin)

    def _diagnostic(self, code):
        """Le code de sortie seul n'apprend rien : on cherche dans le journal
        les pannes qu'on sait nommer."""
        texte = "\n".join(self.journal[-80:])
        if "DLL load failed" in texte or "ImportError" in texte:
            return ("Les liaisons Python d'openEMS n'ont pas pu etre chargees. "
                    "Verifiez que le dossier openEMS/ contient bien les DLL "
                    "(CSXCAD.dll, openEMS.dll) et qu'il est a cote de "
                    "serveur.py.")
        if "MemoryError" in texte or "bad_alloc" in texte:
            return ("Memoire insuffisante pour ce maillage. Elargissez le pas "
                    "de maillage ou reduisez la bande vers le haut : le "
                    "nombre de cellules varie comme le cube de la frequence "
                    "maximale.")
        if "Mesh" in texte and "invalid" in texte.lower():
            return ("openEMS a refuse le maillage. Une ligne en double ou une "
                    "boite plus petite que la geometrie en sont les causes "
                    "habituelles.")
        if code < 0:
            return ("Le solveur s'est arrete brutalement (signal %d). Une "
                    "geometrie degeneree — polygone d'aire nulle, port "
                    "d'epaisseur nulle — en est la cause la plus frequente."
                    % -code)
        return "Le calcul s'est arrete (code %d). Voir le journal." % code

    def arreter(self):
        if self.proc and self.proc.poll() is None:
            self.etat = "arrete"
            try:
                self.proc.terminate()
            except Exception:                          # noqa: BLE001
                pass
            return True
        return False


def _chiffre(v, echelle, forme):
    """Un nombre pour le journal, ou un tiret quand il n'y en a pas."""
    try:
        return forme % (float(v) / echelle)
    except (TypeError, ValueError):
        return "—"


def _resume(r):
    """Ce qu'on peut dire d'un resultat en cinq nombres. Sert au suivi d'un
    balayage : la ligne de tableau apparait des que le point est fini, sans
    attendre la fin de la serie."""
    if not r:
        return {"resume": None}
    return {"resume": {
        "f0": r.get("f0"), "s11_min_db": r.get("s11_min_db"),
        "z0_re": r.get("z0_re"), "z0_im": r.get("z0_im"),
        "bp": ((r.get("bp_f2") - r.get("bp_f1"))
               if r.get("bp_f1") and r.get("bp_f2") else None),
    }}


class TacheBalayage(Tache):
    """Une suite de simulations, une par valeur du parametre.

    UNE SEULE A LA FOIS, ET C'EST DELIBERE. Chaque point demande la memoire
    d'un maillage complet ; deux en parallele ne vont pas deux fois plus vite
    sur un poste dont la barre est la bande passante memoire, et trois font
    tomber la machine dans le fichier d'echange. La sequence, elle, laisse
    aussi le premier resultat arriver tot : on voit le sens de la variation
    avant la fin, et on peut arreter des qu'il est clair.

    CE QUI EST VERIFIE L'EST AVANT, PAS PENDANT. Les modeles des N points sont
    tous normalises — et donc tous refusables — avant que le premier ne parte.
    Apprendre au quatorzieme point, une heure plus tard, que le port y tombe
    hors du cuivre serait la pire facon de l'apprendre.
    """

    # SOUS QUELLE CLEF LA PAGE LIT CETTE SUITE. Un balayage et un tableau S
    # sont la meme mecanique — N simulations a la suite, un dossier par point,
    # un resultat assemble a la fin — et c'est la seule chose qui les separe :
    # ce qu'ils rendent, et sous quel nom la page va le chercher.
    CLEF = "balayage"

    def __init__(self, ident, dossier, bal):
        Tache.__init__(self, ident, dossier, bal["points"][0]["modele"])
        self.balayage = bal
        self.points = []
        for i, p in enumerate(bal["points"]):
            self.points.append({
                "n": i + 1,
                "etiquette": p["etiquette"],
                "valeur": p["valeur"],
                "valeur2": p.get("valeur2"),
                "etat": "attend",         # attend | calcule | fini | echoue
                "resultat": None,
                "detail": "",
                "dossier": os.path.join(dossier, "p%02d" % (i + 1)),
            })
        self.courant = 0

    # -- vue -------------------------------------------------------------
    def vue(self, depuis=0):
        out = Tache.vue(self, depuis)
        out[self.CLEF] = {
            "nom": self.balayage["nom"],
            "unite": self.balayage["unite"],
            "croise": bool(self.balayage.get("croise")),
            "nom2": self.balayage.get("nom2") or "",
            "unite2": self.balayage.get("unite2") or "",
            "courant": self.courant,
            "total": len(self.points),
            # UN RESUME, ET NON LES COURBES. Cette vue est demandee toutes
            # les deux secondes ; y mettre les quatre cents points de chaque
            # courbe ferait passer des megaoctets par sondage, pour afficher
            # une ligne de tableau. Les courbes partent une fois, a la fin,
            # dans le resultat.
            "points": [dict({k: p[k] for k in
                             ("n", "etiquette", "valeur", "valeur2",
                              "etat", "detail")},
                            **_resume(p["resultat"]))
                       for p in self.points],
        }
        return out

    # -- execution -------------------------------------------------------
    def _entete(self):
        return ("Balayage de « %s » : %d points, de %s a %s %s"
                % (self.balayage["nom"], len(self.points),
                   self.points[0]["etiquette"],
                   self.points[-1]["etiquette"],
                   self.balayage["unite"]))

    def demarrer_tout(self):
        self._ajouter(self._entete())
        self._ajouter("Interpreteur : %s" % interprete())
        self._ajouter("Dossier de calcul : %s" % self.dossier)
        self._ajouter("")
        self.etat = "calcule"
        fil = threading.Thread(target=self._courir_tout, daemon=True)
        fil.start()

    def _courir_tout(self):
        for i, pt in enumerate(self.points):
            if self.etat == "arrete":
                break
            self.courant = i + 1
            m = self.balayage["points"][i]["modele"]
            # Le pourcentage d'avancement se lit sur le modele EN COURS : les
            # points n'ont pas tous le meme nombre de pas de temps.
            self.modele = m
            self.avancement = {"pas": 0, "pourcent": 0.0, "energie_dB": None,
                               "vitesse": 0.0, "point": i + 1,
                               "points": len(self.points)}
            self._repartir_energie()
            pt["etat"] = "calcule"
            self._ajouter("")
            self._ajouter("=== point %d/%d — %s = %s %s ==="
                          % (i + 1, len(self.points), self.balayage["nom"],
                             pt["etiquette"], self.balayage["unite"]))
            # UN POINT QUI TOURNE MAL NE DOIT PAS EMPORTER LA SUITE, et c'est
            # arrive : un resultat dont toutes les grandeurs sont NaN — une
            # simulation divergee — rendait `None` la ou la ligne de journal
            # attendait un nombre, l'exception tuait le FIL, et la tache
            # restait « calcule » pour toujours. Personne ne voyait d'erreur :
            # la barre s'arretait a 99 %, et c'est tout. Une suite de N
            # simulations doit survivre a chacune d'elles.
            try:
                self._un_point(pt, m)
            except Exception as exc:                   # noqa: BLE001
                pt["etat"] = "echoue"
                pt["detail"] = ("Ce point n'a pas pu etre depouille : %s: %s"
                                % (type(exc).__name__, exc))
                self._ajouter("  … point %s : %s"
                              % (pt["etiquette"], pt["detail"]))

        self.fin = time.time()
        if self.etat == "arrete":
            self.detail = ("Arrete a la demande apres %d point%s sur %d."
                           % (self.courant, "" if self.courant < 2 else "s",
                              len(self.points)))
            return
        finis = [p for p in self.points if p["etat"] == "fini"]
        if not finis:
            self.etat = "echoue"
            self.detail = ("Aucun point n'a abouti. Le journal ci-dessous dit "
                           "ou le premier s'est arrete.")
            return
        # UN POINT RATE N'EFFACE PAS LES AUTRES. Une geometrie degeneree au
        # milieu d'une plage est une information en soi — et les courbes deja
        # obtenues valent ce qu'elles valent, c'est-a-dire beaucoup.
        self.etat = "fini"
        # UNE SUITE APPREND AUTANT DU POSTE QU'UNE SIMULATION SEULE, et meme
        # davantage : elle a tourne N fois. Les vitesses de tous les points
        # sont dans le meme sac, et c'est leur mediane qui part au modele.
        self._noter_debit()
        if len(finis) < len(self.points):
            self.detail = ("%d point%s sur %d ont abouti ; les autres sont "
                           "marques dans la liste, avec leur raison."
                           % (len(finis), "" if len(finis) < 2 else "s",
                              len(self.points)))
        self.resultat = self._assembler(finis)

    def _un_point(self, pt, m):
        os.makedirs(pt["dossier"], exist_ok=True)
        dossier = os.path.realpath(pt["dossier"])
        script = openems_script.generer(m, chemin_openems=dossier_openems(),
                                        dossier_sim=dossier) + _epilogue(m)
        chemin = os.path.join(dossier, "antenne.py")
        with open(chemin, "w", encoding="utf-8") as f:
            f.write(script)
        try:
            self.proc = subprocess.Popen(
                [interprete(), "-u", chemin],
                cwd=dossier, env=_preparer_env(),
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace", bufsize=1)
        except Exception as exc:                       # noqa: BLE001
            pt["etat"] = "echoue"
            pt["detail"] = "Impossible de lancer l'interpreteur : %s" % exc
            return
        for ligne in self.proc.stdout:
            self._ajouter(ligne)
        code = self.proc.wait()
        if self.etat == "arrete":
            pt["etat"] = "echoue"
            pt["detail"] = "Arrete a la demande."
            return
        if code != 0:
            pt["etat"] = "echoue"
            pt["detail"] = self._diagnostic(code)
            self._ajouter("  … point %s : %s" % (pt["etiquette"], pt["detail"]))
            return
        chemin_json = os.path.join(dossier, "resultats.json")
        try:
            with open(chemin_json, "r", encoding="utf-8") as f:
                pt["resultat"] = json.load(f)
        except Exception as exc:                       # noqa: BLE001
            pt["etat"] = "echoue"
            pt["detail"] = "Resultats illisibles : %s" % exc
            return
        pt["etat"] = "fini"
        r = pt["resultat"]
        # UN RESULTAT PEUT NE PAS AVOIR DE CHIFFRES. Le depouillement remplace
        # par `None` toute grandeur qui n'est pas un nombre fini — un NaN dans
        # du JSON n'est pas du JSON —, et une simulation qui a diverge les rend
        # TOUTES a None. La ligne de journal doit le dire, pas s'y casser.
        self._ajouter("  → %s = %s %s : resonance %s, S11 %s"
                      % (self.balayage["nom"], pt["etiquette"],
                         self.balayage["unite"],
                         _chiffre(r.get("f0"), 1e9, "%.4f GHz"),
                         _chiffre(r.get("s11_min_db"), 1.0, "%.2f dB")))
        if r.get("s11_min_db") is None:
            self._ajouter("     (aucune grandeur exploitable : la simulation "
                          "n'a rien rendu de fini.)")
            # ET POURQUOI. La courbe d'energie de CE point vient d'etre lue
            # pas a pas ; la nommer ici epargne de relire quatre mille lignes.
            d = self.diagnostic_energie()
            if d:
                r["diagnostic"] = d
                pt["detail"] = d
                self._ajouter("     " + d)

    def _assembler(self, finis):
        """Le resultat du balayage : la famille de courbes, et le tableau qui
        se lit d'un coup d'oeil — une ligne par point, la resonance, le S11
        minimal, la bande. C'est ce tableau qui repond a la seule question
        qu'on se pose vraiment : de quel cote faut-il aller, et de combien.

        Le PREMIER point sert aussi de resultat « ordinaire », pour que les
        courbes, les exports et le diagramme marchent sans rien savoir du
        balayage."""
        lignes = []
        for p in finis:
            r = p["resultat"]
            bp = None
            if r.get("bp_f1") and r.get("bp_f2"):
                bp = r["bp_f2"] - r["bp_f1"]
            lignes.append({
                "n": p["n"], "etiquette": p["etiquette"], "valeur": p["valeur"],
                "valeur2": p.get("valeur2"),
                "f0": r.get("f0"), "s11_min_db": r.get("s11_min_db"),
                "z0_re": r.get("z0_re"), "z0_im": r.get("z0_im"),
                "bp": bp, "bp_bord": r.get("bp_bord"),
                "rendement": (r.get("nf2ff") or {}).get("rendement"),
                "gain_dbi": (r.get("nf2ff") or {}).get("gain_dbi"),
            })
        # LA SENSIBILITE, ET NON LE MEILLEUR POINT. « 0,42 MHz par centieme de
        # millimetre » dit combien la cote doit etre tenue en fabrication ;
        # « le meilleur est 38,4 » ne le dit pas, et c'est pourtant la seule
        # des deux qui survive au prochain lot de stratifie.
        #
        # SUR UN CROISEMENT, CETTE PENTE N'EN EST PAS UNE. Du premier au
        # dernier point, DEUX cotes ont change : le rapport rendrait un nombre
        # de MHz par millimetre qui ne dirait de quelle cote, et personne ne
        # peut le deviner en le lisant. On ne le calcule donc pas — un chiffre
        # absent se voit, un chiffre faux non.
        pente = None
        croise = bool(self.balayage.get("croise"))
        if len(lignes) >= 2 and not croise:
            a0, a1 = lignes[0], lignes[-1]
            dv = a1["valeur"] - a0["valeur"]
            if dv and a0["f0"] and a1["f0"]:
                pente = (a1["f0"] - a0["f0"]) / dv
        return {
            "balayage": True,
            "nom": self.balayage["nom"],
            "unite": self.balayage["unite"],
            "croise": croise,
            "nom2": self.balayage.get("nom2") or "",
            "unite2": self.balayage.get("unite2") or "",
            "lignes": lignes,
            "pente_hz_par_unite": pente,
            # LES RESULTATS COMPLETS, POINT PAR POINT. Ils partent une seule
            # fois, quand tout est fini : l'impedance et le diagramme du point
            # 38,4 mm valent autant que sa courbe de S11, et les jeter
            # obligerait a relancer la simulation pour les revoir.
            "points": [{"etiquette": p["etiquette"], "valeur": p["valeur"],
                        "valeur2": p.get("valeur2"),
                        "resultat": p["resultat"]} for p in finis],
            "premier": finis[0]["resultat"],
        }

    def arreter(self):
        """Arreter un balayage, c'est arreter le point en cours ET ne pas
        lancer les suivants. Ne tuer que le processus laisserait la sequence
        enchainer sur le point d'apres — l'inverse de ce qu'on demande."""
        self.etat = "arrete"
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
            except Exception:                          # noqa: BLE001
                pass
        return True


class TacheTableauS(TacheBalayage):
    """Le tableau S complet : une simulation par port excite.

    C'EST LA MEME SUITE QUE LE BALAYAGE, ET C'EST VOULU. Un tableau S est
    N simulations a la suite dont on assemble les resultats ; un balayage
    aussi. Tout ce qui a ete ecrit pour l'un — la sequence, le journal,
    l'arret qui n'enchaine pas sur le point suivant, le point rate qui
    n'efface pas les autres — vaut ici sans etre recopie. Ne changent que
    l'etiquette des points et ce qu'on en fait a la fin.

    CE QUE CHAQUE COLONNE APPORTE. Le port j excite rend S(j,j) — c'est le
    « s11 » de son resultat, qui porte ce nom parce qu'il est la reflexion du
    port qui emet — et S(i,j) pour chaque autre port i, dans ses couplages.
    N colonnes font donc le tableau entier, et rien n'y est invente.
    """

    CLEF = "tableau_s"

    def __init__(self, ident, dossier, ts):
        self.ports = ts["ports"]
        TacheBalayage.__init__(self, ident, dossier, {
            "nom": "port excite",
            "unite": "",
            "points": [{"etiquette": "port %d" % c["n"],
                        "valeur": float(c["n"]),
                        "modele": c["modele"]} for c in ts["colonnes"]],
        })

    def _entete(self):
        return ("Tableau S complet : %d simulations, l'excitation deplacee "
                "d'un port a l'autre" % len(self.points))

    def vue(self, depuis=0):
        out = TacheBalayage.vue(self, depuis)
        out[self.CLEF]["ports"] = self.ports
        return out

    def _assembler(self, finis):
        """Les colonnes rangees ensemble : S[i][j], i recoit, j excite.

        UNE COLONNE MANQUANTE RESTE MANQUANTE. Si la simulation du port 2 n'a
        pas abouti, sa colonne vaut `null` et la page le dit — la remplir de
        zeros produirait un tableau que tous les outils liraient sans broncher
        et dont un quart serait invente. C'est la meme regle que pour le .s1p
        d'hier, et c'est elle qui rend le .sNp d'aujourd'hui honnete.
        """
        n = len(self.ports)
        r0 = finis[0]["resultat"]
        f = r0.get("f") or []
        s = [[None] * n for _ in range(n)]

        for pt in finis:
            r = pt["resultat"]
            j = int(round(pt["valeur"])) - 1        # le port excite, 0-indexe
            if not (0 <= j < n):
                continue
            s[j][j] = {"re": r.get("s11_re") or [], "im": r.get("s11_im") or []}
            for clef, c in (r.get("couplages") or {}).items():
                try:
                    i = int(clef) - 1
                except (TypeError, ValueError):
                    continue
                if 0 <= i < n and i != j:
                    s[i][j] = {"re": c.get("re") or [], "im": c.get("im") or []}

        return {
            "tableau_s": True,
            "ports": self.ports,
            "f": f,
            "s": s,
            # LE RESULTAT COMPLET DE CHAQUE COLONNE VOYAGE AVEC ELLE, et c'est
            # le diagramme de rayonnement qui l'exige. Deux antennes couplees
            # ne rayonnent pas de la meme facon selon celle qui emet : le
            # champ lointain de la colonne 2 n'est pas celui de la colonne 1,
            # et c'est meme toute la question quand on pose deux ports. Les
            # champs sont deja calcules et deja ecrits — n'en remonter qu'un
            # revenait a jeter les autres, et a relancer N simulations pour
            # revoir ce qu'on avait deja. Une colonne qui n'a pas abouti porte
            # `null` : c'est la meme regle que ses cases du tableau.
            "colonnes": [{"n": int(round(p["valeur"])), "etat": p["etat"],
                          "detail": p["detail"],
                          "resultat": p.get("resultat")}
                         for p in self.points],
            "reciprocite": _reciprocite(s),
            # Le premier resultat sert de resultat « ordinaire » : les courbes,
            # le diagramme et les exports d'une simulation seule continuent de
            # marcher sans rien savoir du tableau.
            "premier": r0,
        }


def _reciprocite(s):
    """De combien S(i,j) et S(j,i) different, et ou.

    POURQUOI CE CHIFFRE VAUT D'ETRE CALCULE. Une structure passive et sans
    materiau gyrotrope est RECIPROQUE : S(i,j) = S(j,i), exactement, par la
    physique. Les deux moities du tableau sortent pourtant de deux simulations
    independantes, avec deux excitations differentes. Leur ecart ne mesure
    donc pas l'antenne : il mesure ce que le calcul a perdu en route — un
    maillage trop laches, une energie residuelle trop haute, une PML trop
    proche. C'est la seule verification interne que ce tableau permette, et
    elle est gratuite.
    """
    pire = 0.0
    ou = ""
    ampl = 0.0
    n = len(s)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = s[i][j], s[j][i]
            if not a or not b:
                continue
            k = min(len(a["re"]), len(b["re"]), len(a["im"]), len(b["im"]))
            for x in range(k):
                d = ((a["re"][x] - b["re"][x]) ** 2
                     + (a["im"][x] - b["im"][x]) ** 2) ** 0.5
                ampl = max(ampl, (a["re"][x] ** 2 + a["im"][x] ** 2) ** 0.5)
                if d > pire:
                    pire = d
                    ou = "S%d%d / S%d%d" % (i + 1, j + 1, j + 1, i + 1)
    return {"ecart": pire, "ou": ou, "amplitude": ampl}


# ==========================================================================
# Le registre des taches
# ==========================================================================
_TACHES = {}
_VERROU = threading.Lock()


def _oublier_les_vieilles():
    limite = time.time() - DUREE_MEMOIRE
    with _VERROU:
        for k in [k for k, t in _TACHES.items()
                  if t.etat in ("fini", "echoue", "arrete") and t.fin < limite]:
            del _TACHES[k]


def _epilogue(m):
    """Ce qui s'ajoute au script exporte pour que le serveur recupere des
    chiffres et non du texte imprime. Le script exporte n'en a pas besoin —
    il s'adresse a un humain ; celui-ci s'adresse a une page web."""
    t = []
    a = t.append
    a("\n\n# --------------------------------------------------------------\n")
    a("# 10. Resultats au format JSON (ajoute par l'outil ; le script\n")
    a("#     exporte a la main n'en a pas besoin, il imprime ses chiffres).\n")
    a("# --------------------------------------------------------------\n")
    a("import json as _json\n")
    # LE ROE DEVIENT NEGATIF DES QUE |S11| DEPASSE 1, et |S11| depasse 1 aux
    # bords de la bande : la ou l'impulsion n'a presque plus d'energie, le
    # rapport de deux nombres minuscules n'a plus de sens. Un « ROE = -397 »
    # dans un tableau ne veut rien dire de physique ; on sature, et la page
    # affiche la saturation au lieu de tracer une courbe qui plonge.
    a("_a = np.clip(np.abs(s11), 0.0, 0.999999)\n")
    a("_vswr = (1 + _a) / (1 - _a)\n")
    a("_out = {\n")
    a("    'f': [float(v) for v in f],\n")
    a("    's11_db': [float(20 * np.log10(max(abs(v), 1e-12))) for v in s11],\n")
    a("    's11_re': [float(v.real) for v in s11],\n")
    a("    's11_im': [float(v.imag) for v in s11],\n")
    a("    'z_re': [float(v.real) for v in Zin],\n")
    a("    'z_im': [float(v.imag) for v in Zin],\n")
    a("    'vswr': [float(min(v, 99.0)) for v in _vswr],\n")
    a("    'f0': float(f[i0]),\n")
    a("    's11_min_db': float(20 * np.log10(max(abs(s11[i0]), 1e-12))),\n")
    a("    'z0_re': float(Zin[i0].real),\n")
    a("    'z0_im': float(Zin[i0].imag),\n")
    a("}\n")
    # L'IMPEDANCE RAMENEE AU PIED DE L'ANTENNE, quand la ligne d'alimentation
    # est declaree. Elle est calculee plus haut par le script lui-meme (voir
    # `_bloc_ligne`) : ce qui est ajoute ici est seulement son passage a la
    # page. Les reserves voyagent AVEC les nombres -- rotation sans perte, Z0
    # analytique -- parce qu'une impedance ramenee qu'on lirait sans elles
    # serait crue au dixieme d'ohm.
    _lg = (m["port"].get("ligne") or None)
    if _lg:
        a("_out['ligne'] = {'d': %r, 'w': %r, 'h': %r, 'er': %r,\n"
          "                 'z0': %r, 'eeff': %r}\n"
          % (_lg["d"], _lg["w"], _lg["h"], _lg["er"],
             _lg["z0"], _lg["eeff"]))
        a("_out['z_pied_re'] = [float(v.real) for v in Z_pied]\n")
        a("_out['z_pied_im'] = [float(v.imag) for v in Z_pied]\n")
        a("_out['z0_pied_re'] = float(Z_pied[i0].real)\n")
        a("_out['z0_pied_im'] = float(Z_pied[i0].imag)\n")
    a("# La bande passante : ou le S11 reste sous -10 dB (VSWR < 2), la\n")
    a("# convention d'usage pour une antenne. Elle n'a de sens que si la\n")
    a("# resonance est DANS la bande simulee — sinon on mesure un bord.\n")
    a("_db = np.array(_out['s11_db'])\n")
    a("_sous = np.where(_db < -10.0)[0]\n")
    a("if len(_sous):\n")
    a("    _out['bp_f1'] = float(f[_sous[0]])\n")
    a("    _out['bp_f2'] = float(f[_sous[-1]])\n")
    a("    _out['bp_continue'] = bool(len(_sous) == _sous[-1] - _sous[0] + 1)\n")
    a("    _out['bp_bord'] = bool(_sous[0] == 0 or _sous[-1] == len(f) - 1)\n")
    if len(m["ports"]) > 1:
        # LES COUPLAGES, PORT PAR PORT. Un S21 ne se lit pas dans un S11 et ne
        # s'en deduit pas : c'est une mesure a part, et la seule qui dise si
        # deux antennes se genent. On garde le complexe entier — la page trace
        # des decibels, mais l'abaque de Smith aurait besoin des deux parties,
        # et les jeter ici serait les jeter pour de bon.
        a("_out['ports'] = %s\n" % repr(
            [{"n": p["n"], "nom": p["nom"], "type": p["type"],
              "excite": bool(p["excite"]), "R": p["R"],
              "z0_ligne": (p.get("coax") or {}).get("z0_ligne", 0.0)}
             for p in m["ports"]]))
        a("_out['excite'] = %d\n"
          % next(p["n"] for p in m["ports"] if p["excite"]))
        a("_out['couplages'] = {}\n")
        a("for _n, _s in couplages.items():\n")
        a("    _out['couplages'][str(_n)] = {\n")
        a("        'db': [float(20 * np.log10(max(abs(v), 1e-12))) for v in _s],\n")
        a("        're': [float(v.real) for v in _s],\n")
        a("        'im': [float(v.imag) for v in _s],\n")
        a("        'pire_db': float(20 * np.log10(max(np.max(np.abs(_s)), 1e-12))),\n")
        a("        'db_f0': float(20 * np.log10(max(abs(_s[i0]), 1e-12))),\n")
        a("    }\n")
    if m["nf2ff"]["actif"]:
        # Le maximum peut etre nul si la boite n'a rien enregistre : diviser
        # par lui remplirait le diagramme entier de NaN.
        a("_emax = float(np.max(res_nf.E_norm[0]))\n")
        a("_enorm = res_nf.E_norm[0] / (_emax if _emax > 0 else 1.0)\n")
        a("_out['nf2ff'] = {\n")
        a("    'theta': [float(v) for v in theta],\n")
        a("    'phi': [float(v) for v in phi],\n")
        a("    'f': float(f[i0]),\n")
        # Dmax peut etre « nan » quand la boite de champ lointain n'a rien pu
        # integrer. Un NaN dans du JSON n'est pas du JSON : json.dump ecrit
        # `NaN`, que JSON.parse refuse, et la page perd TOUT le resultat — le
        # S11 compris — pour un diagramme manquant.
        a("    'dmax_dbi': (float(10 * np.log10(res_nf.Dmax[0]))\n")
        a("                 if np.isfinite(res_nf.Dmax[0]) and res_nf.Dmax[0] > 0\n")
        a("                 else None),\n")
        a("    'prad': float(res_nf.Prad[0]) if np.isfinite(res_nf.Prad[0]) else None,\n")
        # E_norm[0] est indexe [theta][phi] : une LIGNE par angle theta. La
        # page, elle, trace une COURBE PAR PLAN — c'est-a-dire par phi. On
        # transpose ici plutot que la-bas : c'est le cote qui connait la
        # convention d'openEMS, et une transposition oubliee ne se voit pas
        # sur un diagramme (elle rend un lobe, juste pas le bon).
        a("    'e_norm': [[float(v) for v in ligne] for ligne in _enorm.T.tolist()],\n")
        a("}\n")
        a("if p_acc > 0 and np.isfinite(res_nf.Dmax[0]):\n")
        a("    _out['nf2ff']['rendement'] = float(res_nf.Prad[0] / p_acc)\n")
        a("    _out['nf2ff']['gain_dbi'] = float(\n")
        a("        10 * np.log10(res_nf.Dmax[0] * res_nf.Prad[0] / p_acc))\n")
    a("\n")
    a("# UN NaN DANS DU JSON N'EST PAS DU JSON. json.dump ecrit « NaN » sans\n")
    a("# broncher, JSON.parse le refuse, et la page perd TOUT le resultat —\n")
    a("# le S11 compris — parce qu'une seule grandeur n'a pas converge.\n")
    a("def _sain(v):\n")
    a("    if isinstance(v, float):\n")
    a("        return v if v == v and v not in (float('inf'), float('-inf')) else None\n")
    a("    if isinstance(v, dict):\n")
    a("        return {k: _sain(x) for k, x in v.items()}\n")
    a("    if isinstance(v, list):\n")
    a("        return [_sain(x) for x in v]\n")
    a("    return v\n")
    a("_out = _sain(_out)\n")
    a("with open(os.path.join(dossier, 'resultats.json'), 'w',\n")
    a("          encoding='utf-8') as _f:\n")
    a("    _json.dump(_out, _f, allow_nan=False)\n")
    a("print('resultats.json ecrit')\n")
    return "".join(t)


def script_exportable(modele):
    """Le script tel qu'on le donne a l'utilisateur : lisible, sans epilogue."""
    return openems_script.generer(modele, chemin_openems=dossier_openems())


# OU LES CALCULS ECRIVENT. Par defaut le dossier temporaire du systeme :
# c'est le bon endroit pour un essai qu'on ne gardera pas, et le nettoyage de
# disque de Windows s'en charge. Des qu'un PROJET est ouvert, en revanche, ils
# doivent aller dedans — un enregistrement de champ fait des centaines de
# mega-octets de .vtr que ParaView relit, et les laisser dans TEMP revient a
# les perdre au premier nettoyage, sans que rien ne l'annonce.
#
# Le chemin est POSE PAR LE SERVEUR (voir projet.dossier_calculs) et jamais
# lu d'une requete : ce module ne sait pas ce qu'est un projet, il sait
# seulement ou ecrire.
_RACINE_CALCULS = ""


def definir_racine_calculs(chemin):
    """Ou creer les dossiers de calcul. "" remet le dossier temporaire."""
    global _RACINE_CALCULS
    _RACINE_CALCULS = chemin or ""
    return _RACINE_CALCULS


def _base_temporaire():
    return os.path.realpath(os.path.join(tempfile.gettempdir(),
                                         "openems_antenne"))


def _base_calculs():
    """La base du moment. Un projet devenu inaccessible — cle USB retiree,
    lecteur reseau tombe — ne doit pas empecher de lancer : on retombe sur
    le dossier temporaire, ce que le journal de la tache dit ligne 1 en
    annoncant son dossier de calcul."""
    if _RACINE_CALCULS:
        try:
            os.makedirs(_RACINE_CALCULS, exist_ok=True)
            return os.path.realpath(_RACINE_CALCULS)
        except OSError:
            pass
    return _base_temporaire()


def _dossier_neuf():
    """Un dossier de calcul vierge, et son identifiant.

    `realpath` : voir le commentaire que le script porte au meme sujet.
    openEMS 0.0.36 compare os.getcwd() a os.path.realpath(sim_path), et sur
    Windows TEMP vaut souvent le nom court 8.3 du profil — les deux ne
    coincident alors pas, et le calcul s'arrete sur une AssertionError nue.
    """
    ident = uuid.uuid4().hex[:12]
    dossier = os.path.join(_base_calculs(), ident)
    os.makedirs(dossier, exist_ok=True)
    return ident, dossier


def _exiger_solveur():
    e = etat()
    if not e.get("dispo"):
        raise openems_modele.ErreurModele(
            "openEMS n'est pas utilisable sur ce poste : %s"
            % e.get("detail", "raison inconnue"),
            e.get("conseil", ""))


def lancer(modele):
    """Demarre une simulation. Rend la vue initiale de la tache."""
    _exiger_solveur()
    _oublier_les_vieilles()
    ident, dossier = _dossier_neuf()
    script = openems_script.generer(modele, chemin_openems=dossier_openems(),
                                    dossier_sim=dossier)
    tache = Tache(ident, dossier, modele)
    with _VERROU:
        _TACHES[ident] = tache
    tache.demarrer(script + _epilogue(modele))
    return tache.vue()


def lancer_balayage(bal):
    """Demarre un balayage : N simulations a la suite, une par valeur.

    Le balayage arrive DEJA VERIFIE — `openems_modele.balayage()` a normalise
    les N modeles, et refuse l'ensemble si l'un d'eux ne tient pas debout.
    Ici on ne fait plus que les faire tourner.
    """
    _exiger_solveur()
    _oublier_les_vieilles()
    ident, dossier = _dossier_neuf()
    tache = TacheBalayage(ident, dossier, bal)
    with _VERROU:
        _TACHES[ident] = tache
    tache.demarrer_tout()
    return tache.vue()


def lancer_tableau_s(ts):
    """Demarre un tableau S complet : une simulation par port excite.

    Le tableau arrive DEJA VERIFIE — `openems_modele.tableau_s()` a normalise
    les N colonnes et refuse l'ensemble si l'une d'elles ne tient pas debout.
    """
    _exiger_solveur()
    _oublier_les_vieilles()
    ident, dossier = _dossier_neuf()
    tache = TacheTableauS(ident, dossier, ts)
    with _VERROU:
        _TACHES[ident] = tache
    tache.demarrer_tout()
    return tache.vue()


def journal(ident, depuis=0):
    with _VERROU:
        tache = _TACHES.get(ident)
    if tache is None:
        raise openems_modele.ErreurModele(
            "Cette simulation n'existe plus (%s)." % ident,
            "Le serveur oublie les taches terminees au bout de douze heures, "
            "et toutes lorsqu'il redemarre. Les fichiers de calcul, eux, "
            "restent sur le disque.")
    return tache.vue(depuis)


def arreter(ident):
    with _VERROU:
        tache = _TACHES.get(ident)
    if tache is None:
        raise openems_modele.ErreurModele("Cette simulation n'existe plus.")
    arrete = tache.arreter()
    return {"arrete": arrete, "etat": tache.etat}


# ==========================================================================
# Regarder les champs : ParaView
# ==========================================================================
# LES ENREGISTREMENTS DE CHAMP SONT DES .vtr, et rien dans une page web ne
# sait les lire. ParaView, si -- et il est souvent pose a cote du solveur. On
# ne l'embarque pas, on le CHERCHE : s'il n'est pas la, on ouvre simplement
# le dossier, ce qui laisse l'utilisateur libre de son outil.
_PARAVIEW = None


def chemin_paraview(refaire=False):
    """Ou est ParaView sur ce poste, ou "" s'il est introuvable."""
    global _PARAVIEW
    if _PARAVIEW is not None and not refaire:
        return _PARAVIEW

    candidats = []
    # 1. a cote du depot : le dossier decompresse tel qu'il se telecharge.
    #    ON DESCEND D'UN NIVEAU DE PLUS, parce qu'une archive ouverte « dans
    #    un dossier du meme nom » -- ce que font la plupart des outils de
    #    decompression par defaut -- donne ParaView-x/ParaView-x/bin.
    try:
        for nom in sorted(os.listdir(ROOT)):
            if not nom.lower().startswith("paraview"):
                continue
            bases = [os.path.join(ROOT, nom)]
            try:
                bases += [os.path.join(ROOT, nom, s)
                          for s in sorted(os.listdir(os.path.join(ROOT, nom)))
                          if s.lower().startswith("paraview")]
            except OSError:
                pass
            for base in bases:
                for sous in ("bin", ""):
                    for exe in ("paraview.exe", "paraview"):
                        candidats.append(os.path.join(base, sous, exe))
    except OSError:
        pass
    # 2. les emplacements d'installation habituels
    for base in (os.environ.get("ProgramFiles", r"C:\Program Files"),
                 os.environ.get("ProgramFiles(x86)", "")):
        if not base or not os.path.isdir(base):
            continue
        try:
            for nom in sorted(os.listdir(base), reverse=True):
                if nom.lower().startswith("paraview"):
                    candidats.append(os.path.join(base, nom, "bin",
                                                  "paraview.exe"))
        except OSError:
            pass
    # 3. dans le PATH
    trouve = shutil.which("paraview")
    if trouve:
        candidats.append(trouve)

    for c in candidats:
        if c and os.path.isfile(c):
            _PARAVIEW = c
            return c
    _PARAVIEW = ""
    return ""


_RE_IDENT = re.compile(r"^[0-9a-f]{12}$")


def _dossier_de(ident):
    """Le dossier d'une tache. On n'ouvre que ce qu'on a cree soi-meme : une
    route qui lance un programme sur un chemin venu de la requete ouvrirait
    bien autre chose que ParaView.

    LA LISTE DES TACHES NE SURVIT PAS AU SERVEUR, LES DOSSIERS SI. `_TACHES`
    est un dictionnaire en memoire : redemarrer serveur.py le vide, et la page
    restee ouverte garde pourtant l'identifiant de son calcul. Refuser alors
    par « cette simulation n'existe plus » serait faux deux fois — elle existe,
    ses fichiers sont la, et le message accuserait un oubli au bout de douze
    heures qui n'a pas eu lieu. On retombe donc sur le dossier, a deux
    conditions qui ferment la porte a tout le reste : l'identifiant a
    EXACTEMENT la forme que `_dossier_neuf` fabrique, et le dossier est sous
    la base que nous seuls remplissons.
    """
    with _VERROU:
        tache = _TACHES.get(ident)
    if tache is not None:
        if not os.path.isdir(tache.dossier):
            raise openems_modele.ErreurModele(
                "Le dossier de calcul a disparu : %s" % tache.dossier)
        return tache.dossier

    # DEUX BASES A REGARDER, ET NON UNE : le dossier temporaire, et celui du
    # projet ouvert. Une page rouverte sur un projet d'hier tient l'identifiant
    # d'un calcul qui est sous ce projet-la, et le chercher dans TEMP seul
    # ferait repondre « cette simulation n'existe plus » sur des fichiers
    # parfaitement presents.
    if _RE_IDENT.match(ident or ""):
        for base in (_base_calculs(), _base_temporaire()):
            dossier = os.path.join(base, ident)
            if os.path.isdir(dossier):
                return dossier

    raise openems_modele.ErreurModele(
        "Cette simulation n'existe plus (%s)." % ident,
        "Ses fichiers ont ete effaces, ou le dossier temporaire a ete vide.")


def _ouvrir(commande):
    """Lance sans attendre, et sans laisser le processus fils nous tenir."""
    subprocess.Popen(commande, cwd=os.path.dirname(commande[-1]) or None,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     close_fds=True)


def paraview(ident):
    """Ouvre les champs de cette simulation dans ParaView."""
    dossier = _dossier_de(ident)
    vtr = sorted(f for f in os.listdir(dossier) if f.endswith(".vtr"))
    exe = chemin_paraview()
    if not exe:
        return dict(ouvrir_dossier(ident),
                    detail="ParaView est introuvable sur ce poste : le "
                           "dossier de calcul a ete ouvert a la place.")
    if not vtr:
        return dict(ouvrir_dossier(ident),
                    detail="Aucun fichier de champ dans ce dossier. Cochez "
                           "« Enregistrer les champs » AVANT de lancer : un "
                           "calcul deja fait ne peut plus en produire.")
    try:
        _ouvrir([exe, os.path.join(dossier, vtr[0])])
    except OSError as exc:
        raise openems_modele.ErreurModele(
            "ParaView n'a pas pu etre lance : %s" % exc)
    return {"lance": "paraview", "exe": exe, "dossier": dossier,
            "fichiers": len(vtr), "premier": vtr[0]}


def ouvrir_dossier(ident):
    """Ouvre le dossier de calcul dans l'explorateur du systeme."""
    dossier = _dossier_de(ident)
    try:
        if sys.platform.startswith("win"):
            os.startfile(dossier)                      # noqa: S606
        elif sys.platform == "darwin":
            _ouvrir(["open", dossier])
        else:
            _ouvrir(["xdg-open", dossier])
    except OSError as exc:
        raise openems_modele.ErreurModele(
            "Le dossier n'a pas pu etre ouvert : %s" % exc)
    return {"lance": "dossier", "dossier": dossier}


def liste():
    with _VERROU:
        taches = list(_TACHES.values())
    return {"taches": [
        {"id": t.id, "etat": t.etat, "debut": t.debut,
         "duree": (t.fin or time.time()) - t.debut,
         "nom": t.modele.get("nom", ""), "dossier": t.dossier}
        for t in sorted(taches, key=lambda t: t.debut, reverse=True)]}
