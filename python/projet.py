#!/usr/bin/python3
# -*- coding: utf-8 -*-
# ==========================================================================
# VERSIONING
# Version: 1.0.0
# Date: 2026-09-15
# Explication : les projets sur le disque — ou on les range, ce qu'on y
#               ecrit, et comment on en reprend un.
#
#   UN PROJET EST UN DOSSIER, PAS UN FICHIER. C'est le seul choix qui laisse
#   cohabiter les trois choses que produit une seance : ce qu'on a dessine
#   (quelques kilo-octets), la carte qu'on a ouverte (quelques dizaines de
#   mega-octets sur une carte de fabrication) et ce que le solveur a rendu
#   (des courbes, et parfois des giga-octets de champs .vtr que ParaView
#   relit). Un fichier unique obligerait a tout charger pour lire une cote,
#   et a tout reecrire pour changer une frequence.
#
#       <racine>/<nom du projet>/
#           projet.json      le dessin, les reglages, l'affichage
#           carte.json       le document de la carte, tel que le parseur l'a rendu
#           resultats.json   le dernier resultat : S11, impedance, rayonnement
#           calculs/         un dossier par simulation lancee (voir openems_run)
#
#   Chaque morceau est absent quand il n'a pas lieu d'etre : un projet ou
#   l'on n'a fait que dessiner n'a pas de resultats.json, et le relire ne
#   doit pas s'en plaindre.
#
#   POURQUOI LE SERVEUR ET NON LE NAVIGATEUR. Une page web n'ecrit pas sur
#   le disque — et l'API qui le permet (showDirectoryPicker) n'existe que
#   sur Chrome et Edge, redemande l'autorisation a chaque session, et ne
#   sait rien faire des dossiers de calcul qu'openEMS remplit lui-meme.
#   Le serveur, lui, est deja la, tourne sur le poste, et c'est deja lui qui
#   ecrit les .vtr.
#
#   CE QUE CE MODULE NE FAIT PAS : il n'efface pas de PROJET. Aucune route de
#   suppression, aucun ecrasement d'un dossier qui n'est pas un projet. Un
#   outil qui ecrit dans un dossier choisi a la main par l'utilisateur ne
#   doit pas avoir de moyen d'en detruire le contenu par une requete.
#
#   LA SEULE EXCEPTION, ET ELLE EST BORNEE : `enregistrer` retire `carte.json`
#   ou `resultats.json` quand la charge les porte a `null` — c'est ainsi qu'un
#   projet repart d'un dessin apres avoir ete ouvert sur un fichier, et il faut
#   bien que la carte d'hier s'en aille. Absent et nul ne se confondent donc
#   pas : ABSENT veut dire « inchange, n'y touche pas », NUL veut dire « il n'y
#   en a plus ». Cela ne porte que sur ces deux fichiers-la, nommes en dur, et
#   dans un dossier dont le nom a passe `_verifier_nom` et la comparaison a la
#   racine. Rien d'autre n'est jamais retire.
#
# Fonctions : etat, definir_racine, liste, ouvrir, enregistrer, ouvert,
#            fermer, dossier_calculs, ouvrir_explorateur,
#            debit_lu, debit_noter
# ==========================================================================
"""Les projets sur le disque : ou on les range, et comment on les reprend."""

import json
import os
import re
import subprocess
import sys
import time

FORMAT = "antenne-openems/projet"
VERSION = 1

# Le nom des trois fichiers. Ils sont nommes, et pas devines : on ne relit
# que ceux-la, et on n'ecrit que ceux-la.
F_PROJET = "projet.json"
F_CARTE = "carte.json"
F_RESULTATS = "resultats.json"
D_CALCULS = "calculs"

# Combien de projets la liste rend au plus. Une racine qui en contient mille
# n'est pas un cas a servir : elle est un cas a signaler.
MAX_LISTE = 300


class ErreurProjet(Exception):
    """Refus explicite : un message, et le geste qui le leve."""

    def __init__(self, message, conseil=""):
        super().__init__(message)
        self.message = message
        self.conseil = conseil


# ==========================================================================
# La racine : ou sont ranges les projets
# ==========================================================================
# ELLE SE CHOISIT, ET ELLE SE RETIENT. Le reglage vit dans le profil de
# l'utilisateur du systeme, et non dans le depot : deux personnes sur le
# meme poste n'ont pas les memes projets, et un depot qu'on met a jour par
# git ne doit pas trainer le chemin de travail de celui qui l'a clone.
CONFIG = os.path.join(os.path.expanduser("~"), ".antenne-openems.json")


def racine_defaut():
    """« Documents/Antennes openEMS », ou le profil a defaut de Documents."""
    maison = os.path.expanduser("~")
    for nom in ("Documents", "Mes documents"):
        chemin = os.path.join(maison, nom)
        if os.path.isdir(chemin):
            return os.path.join(chemin, "Antennes openEMS")
    return os.path.join(maison, "Antennes openEMS")


def _config_lire():
    try:
        with open(CONFIG, "r", encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _config_ecrire(cle, valeur):
    d = _config_lire()
    d[cle] = valeur
    try:
        with open(CONFIG, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
    except OSError:
        # Un profil en lecture seule ne doit pas faire echouer l'enregistrement
        # du projet lui-meme : la racine vaudra pour la session, et c'est tout
        # ce qu'on perd.
        pass


_RACINE = None


def racine():
    """Le dossier ou sont les projets. Retenu d'une session a l'autre."""
    global _RACINE
    if _RACINE is None:
        chemin = _config_lire().get("racine")
        _RACINE = os.path.abspath(chemin) if chemin else racine_defaut()
    return _RACINE


def definir_racine(chemin):
    """Change le dossier de travail, et le cree s'il n'existe pas.

    LE CHEMIN VIENT DE L'UTILISATEUR, ET C'EST LE POINT DE TOUTE CETTE
    FONCTION : c'est lui qui decide ou vivent ses projets, et un outil local
    qui l'en empecherait ne servirait a rien. Ce qui est borne, en revanche,
    c'est ce qu'on en fait — voir `_dossier` plus bas : sous cette racine, on
    ne lit et n'ecrit que trois fichiers nommes, dans un sous-dossier dont le
    nom est verifie caractere par caractere.
    """
    brut = (chemin or "").strip().strip('"')
    if not brut:
        raise ErreurProjet("Aucun dossier indique.")
    voulu = os.path.abspath(os.path.expanduser(os.path.expandvars(brut)))
    if os.path.isfile(voulu):
        raise ErreurProjet(
            "« %s » est un fichier, pas un dossier." % voulu,
            "Indiquez le dossier qui contiendra les projets — chaque projet "
            "y aura son propre sous-dossier.")
    try:
        os.makedirs(voulu, exist_ok=True)
    except OSError as exc:
        raise ErreurProjet(
            "Ce dossier n'a pas pu etre cree : %s" % exc,
            "Verifiez le chemin et les droits d'ecriture. Sur un lecteur "
            "reseau, verifiez aussi qu'il est connecte.")
    if not os.access(voulu, os.W_OK):
        raise ErreurProjet(
            "Ce dossier n'est pas accessible en ecriture : %s" % voulu)

    global _RACINE
    _RACINE = voulu
    _config_ecrire("racine", voulu)
    return voulu


# ==========================================================================
# Le nom d'un projet
# ==========================================================================
# UN NOM DE PROJET EST UN NOM DE DOSSIER, et c'est la toute la difficulte :
# il arrive d'une requete HTTP et il devient un chemin. Les refus qui
# comptent sont donc ici, et ils sont bornes par une liste de ce qui est
# PERMIS plutot que par une liste de ce qui est interdit — une liste noire
# oublie toujours quelque chose.
_NOM_OK = re.compile(r"^[^\x00-\x1f<>:\"/\\|?*]{1,80}$")

# Les noms que Windows reserve a ses peripheriques. « CON » n'est pas un
# dossier : c'est la console, et un fichier ouvert sous ce nom ecrit dans le
# vide sans lever la moindre erreur.
_RESERVES = {"CON", "PRN", "AUX", "NUL", "CLOCK$"} | \
            {"COM%d" % i for i in range(1, 10)} | \
            {"LPT%d" % i for i in range(1, 10)}


def _verifier_nom(nom):
    n = (nom or "").strip()
    if not n:
        raise ErreurProjet("Le projet n'a pas de nom.")
    if not _NOM_OK.match(n):
        raise ErreurProjet(
            "« %s » ne peut pas etre un nom de dossier." % n,
            "Les caracteres  \\ / : * ? \" < > |  y sont interdits, et le nom "
            "ne doit pas depasser 80 caracteres.")
    if n in (".", "..") or n.endswith("."):
        raise ErreurProjet("Un nom de projet ne peut pas finir par un point.")
    if n.split(".")[0].upper() in _RESERVES:
        raise ErreurProjet(
            "« %s » est un nom reserve par Windows." % n,
            "CON, PRN, AUX, NUL, COM1 a COM9 et LPT1 a LPT9 designent des "
            "peripheriques : aucun dossier ne peut porter ces noms.")
    return n


def _dossier(nom, creer=False):
    """Le dossier d'un projet, verifie deux fois plutot qu'une.

    Le nom est valide caractere par caractere ci-dessus, ET le chemin
    resolu est compare a la racine : un nom qui passerait quand meme la
    premiere barriere — un lien symbolique depose dans la racine, par
    exemple — ne sortirait pas de la seconde.
    """
    n = _verifier_nom(nom)
    base = racine()
    chemin = os.path.join(base, n)
    if creer:
        try:
            os.makedirs(chemin, exist_ok=True)
        except OSError as exc:
            raise ErreurProjet("Ce projet n'a pas pu etre cree : %s" % exc)
    reel = os.path.realpath(chemin)
    souche = os.path.realpath(base)
    try:
        dedans = os.path.commonpath([reel, souche]) == souche
    except ValueError:
        dedans = False                    # deux lecteurs differents
    if not dedans:
        raise ErreurProjet("Ce nom sort du dossier de travail : %s" % n)
    return chemin


# ==========================================================================
# Lire
# ==========================================================================
def _lire_json(chemin):
    """Le contenu d'un fichier JSON, ou None s'il n'est pas la.

    UN FICHIER ILLISIBLE N'EST PAS UN FICHIER ABSENT : on leve, en disant
    lequel. Rendre None ferait rouvrir un projet ampute sans que personne ne
    s'en apercoive — et c'est le dessin de la veille qui manquerait.
    """
    if not os.path.isfile(chemin):
        return None
    try:
        with open(chemin, "r", encoding="utf-8") as f:
            return json.load(f)
    except ValueError as exc:
        raise ErreurProjet(
            "« %s » est illisible : %s" % (os.path.basename(chemin), exc),
            "Le fichier a ete modifie a la main, ou une ecriture a ete "
            "interrompue. Le reste du projet, lui, est intact.")
    except OSError as exc:
        raise ErreurProjet("« %s » n'a pas pu etre lu : %s"
                           % (os.path.basename(chemin), exc))


def _poids(chemin):
    try:
        return os.path.getsize(chemin)
    except OSError:
        return 0


def _resume(dossier, nom):
    """Ce qu'on affiche d'un projet SANS l'ouvrir : le strict necessaire.

    La liste ne lit que `projet.json`, jamais `carte.json` : une racine de
    trente projets contenant chacun une carte de fabrication ferait des
    centaines de mega-octets a relire pour afficher trente lignes.
    """
    chemin = os.path.join(dossier, F_PROJET)
    try:
        with open(chemin, "r", encoding="utf-8") as f:
            tete = json.load(f)
        if not isinstance(tete, dict):
            raise ValueError("ce n'est pas un objet")
    except (OSError, ValueError):
        # Un projet dont l'en-tete ne se lit pas apparait quand meme dans la
        # liste, et il le dit : le faire disparaitre laisserait croire qu'il
        # n'existe plus.
        return {"nom": nom, "modifie": _mtime(chemin), "abime": True,
                "titre": "(en-tete illisible)"}
    return {
        "nom": nom,
        "modifie": tete.get("modifie") or _mtime(chemin),
        "cree": tete.get("cree") or 0,
        "titre": tete.get("titre") or "",
        "carte": os.path.isfile(os.path.join(dossier, F_CARTE)),
        "resultats": os.path.isfile(os.path.join(dossier, F_RESULTATS)),
        "dessin": bool((tete.get("dessin") or {}).get("elements")),
        "poids": (_poids(chemin) + _poids(os.path.join(dossier, F_CARTE))
                  + _poids(os.path.join(dossier, F_RESULTATS))),
    }


def _mtime(chemin):
    try:
        return os.path.getmtime(chemin)
    except OSError:
        return 0


def liste():
    """Les projets de la racine, du plus recemment modifie au plus ancien."""
    base = racine()
    out = []
    try:
        noms = sorted(os.listdir(base))
    except OSError:
        # La racine n'existe pas encore : ce n'est pas une erreur, c'est un
        # dossier vide. On ne la cree pas ici — la creer sur une simple
        # lecture semerait des dossiers a chaque demarrage.
        return out
    for nom in noms:
        dossier = os.path.join(base, nom)
        if not os.path.isdir(dossier):
            continue
        if not os.path.isfile(os.path.join(dossier, F_PROJET)):
            continue
        out.append(_resume(dossier, nom))
        if len(out) >= MAX_LISTE:
            break
    out.sort(key=lambda p: p.get("modifie") or 0, reverse=True)
    return out


def ouvrir(nom):
    """Tout ce qu'un projet contient, pret a repeupler la page."""
    dossier = _dossier(nom)
    tete = _lire_json(os.path.join(dossier, F_PROJET))
    if tete is None:
        raise ErreurProjet(
            "Il n'y a pas de projet nomme « %s » dans %s." % (nom, racine()),
            "Le dossier a ete deplace ou renomme depuis, ou le dossier de "
            "travail n'est pas celui ou ce projet a ete enregistre.")
    if not isinstance(tete, dict) or tete.get("format") != FORMAT:
        raise ErreurProjet(
            "« %s » n'est pas un projet de cet outil." % nom,
            "Son fichier projet.json ne porte pas la marque « %s »." % FORMAT)

    charge = dict(tete)
    charge["nom"] = nom
    charge["dossier"] = dossier
    charge["carte"] = _lire_json(os.path.join(dossier, F_CARTE))
    charge["resultats"] = _lire_json(os.path.join(dossier, F_RESULTATS))
    _ouvrir_memoire(nom, dossier)
    return charge


# ==========================================================================
# Ecrire
# ==========================================================================
def _ecrire_json(chemin, valeur):
    """Ecrit a cote, puis remplace. Une ecriture interrompue ne doit pas
    laisser un projet a moitie ecrit : tant que le remplacement n'a pas eu
    lieu, c'est l'ancien fichier qui est la, entier."""
    provisoire = chemin + ".tmp"
    try:
        with open(provisoire, "w", encoding="utf-8") as f:
            json.dump(valeur, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(provisoire, chemin)
    except OSError as exc:
        try:
            os.remove(provisoire)
        except OSError:
            pass
        raise ErreurProjet(
            "« %s » n'a pas pu etre ecrit : %s"
            % (os.path.basename(chemin), exc),
            "Verifiez qu'il reste de la place sur le disque et que le dossier "
            "n'est pas en lecture seule.")


def enregistrer(charge):
    """Ecrit un projet. Le nom est dans la charge ; le reste est facultatif.

    LES TROIS FICHIERS S'ECRIVENT SEPAREMENT, ET C'EST CE QUI PERMET DE NE
    PAS TOUT REECRIRE : une carte de fabrication ne bouge plus une fois
    ouverte, et la renvoyer a chaque fois qu'on change une frequence ferait
    passer des dizaines de mega-octets sur la boucle locale pour rien. La
    page envoie donc `carte` ABSENTE quand la carte n'a pas change, et le
    fichier deja ecrit reste en place.

    Une carte a `null`, en revanche, veut dire « il n'y en a plus » : c'est
    le cas d'un projet qu'on repart de zero. Absent et nul ne se confondent
    pas.
    """
    if not isinstance(charge, dict):
        raise ErreurProjet("Document de projet illisible.")
    nom = _verifier_nom(charge.get("nom"))
    dossier = _dossier(nom, creer=True)

    try:
        ancien = _lire_json(os.path.join(dossier, F_PROJET))
    except ErreurProjet:
        ancien = None      # un en-tete abime ne bloque pas l'enregistrement

    maintenant = time.time()
    tete = {
        "format": FORMAT,
        "version": VERSION,
        "nom": nom,
        "titre": str(charge.get("titre") or "")[:200],
        "cree": (ancien or {}).get("cree") or maintenant,
        "modifie": maintenant,
        "outil": str(charge.get("outil") or ""),
        # D'OU VIENT LA CARTE, ET COMMENT ELLE S'APPELAIT. « source » dit
        # laquelle des deux branches relire — un dessin se refabrique, un
        # fichier se recharge —, et « fichier » est le nom que portait
        # l'IPC-2581 : il voyage jusque dans le document envoye au solveur,
        # et le remplacer par le nom du projet ferait changer en silence le
        # nom du script Python exporte.
        "source": str(charge.get("source") or ""),
        "fichier": str(charge.get("fichier") or "")[:200],
        "dessin": charge.get("dessin") or {},
        "antenne": charge.get("antenne") or {},
        "affichage": charge.get("affichage") or {},
    }
    _ecrire_json(os.path.join(dossier, F_PROJET), tete)

    for cle, fichier in (("carte", F_CARTE), ("resultats", F_RESULTATS)):
        if cle not in charge:
            continue                          # inchange : on n'y touche pas
        chemin = os.path.join(dossier, fichier)
        if charge[cle] is None:
            try:
                os.remove(chemin)
            except OSError:
                pass
            continue
        _ecrire_json(chemin, charge[cle])

    _ouvrir_memoire(nom, dossier)
    return {"nom": nom, "dossier": dossier, "modifie": maintenant,
            "cree": tete["cree"], "racine": racine(),
            "projets": liste()}


# ==========================================================================
# Le projet ouvert
# ==========================================================================
# POURQUOI LE SERVEUR RETIENT LEQUEL EST OUVERT. Pas pour l'affichage — la
# page sait tres bien ou elle en est —, mais pour les dossiers de calcul :
# une simulation lancee alors qu'un projet est ouvert doit ecrire ses champs
# DANS ce projet, et non dans le dossier temporaire du systeme, ou ils se
# font effacer au premier nettoyage de disque.
_OUVERT = None


def _ouvrir_memoire(nom, dossier):
    global _OUVERT
    _OUVERT = {"nom": nom, "dossier": dossier}


def ouvert():
    """Le projet ouvert, ou None. Rend une copie : personne ne le modifie."""
    return dict(_OUVERT) if _OUVERT else None


def fermer():
    global _OUVERT
    _OUVERT = None


def dossier_calculs():
    """Ou les simulations doivent ecrire, ou "" quand aucun projet n'est
    ouvert — auquel cas openems_run retombe sur le dossier temporaire."""
    if not _OUVERT:
        return ""
    return os.path.join(_OUVERT["dossier"], D_CALCULS)


# ==========================================================================
# Le debit du poste
# --------------------------------------------------------------------------
# IL EST ICI PARCE QUE C'EST ICI QU'EST LE FICHIER DE REGLAGES, et nulle part
# ailleurs : ce module ne sait toujours pas qu'openEMS existe. Il range un
# nombre que le serveur lui donne et le rend quand on le lui demande — ce
# nombre pourrait etre la vitesse d'autre chose, cela ne changerait rien ici.
#
# POURQUOI IL SURVIT A LA SESSION. Le debit est une propriete du POSTE, comme
# la racine des projets : le mesurer a chaque demarrage obligerait a lancer un
# calcul avant que la premiere annonce de duree soit juste — c'est-a-dire
# exactement au moment ou l'on decide de le lancer ou non.
# ==========================================================================
def debit_lu():
    """Le debit retenu pour ce poste, ou 0.0 si l'on n'en a jamais mesure."""
    try:
        return float(_config_lire().get("debit_mcps") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def debit_noter(valeur):
    """Range le debit. Un profil en lecture seule ne fait pas echouer l'appel.

    Rien n'est reecrit quand la valeur n'a pas bouge : cette fonction est
    appelee a chaque calcul termine, et un fichier de reglages reecrit pour
    rien est un fichier de reglages qu'on finit par trouver corrompu apres
    une coupure de courant.
    """
    try:
        v = float(valeur)
    except (TypeError, ValueError):
        return 0.0
    if v <= 0 or abs(v - debit_lu()) < 1e-9:
        return debit_lu()
    _config_ecrire("debit_mcps", v)
    return v


# ==========================================================================
# Etat, et ouverture dans l'explorateur
# ==========================================================================
def etat():
    """Ce que la page affiche avant tout choix : ou l'on range, et ce qu'il
    y a deja."""
    base = racine()
    return {
        "racine": base,
        "defaut": racine_defaut(),
        "existe": os.path.isdir(base),
        "projets": liste(),
        "ouvert": ouvert(),
        "format": FORMAT,
    }


def ouvrir_explorateur(nom=None):
    """Ouvre la racine, ou le dossier d'un projet, dans l'explorateur.

    Meme borne que pour les dossiers de calcul (voir openems_run) : on
    n'ouvre que ce que ce module fabrique lui-meme — la racine choisie, ou
    un sous-dossier dont le nom a passe `_verifier_nom`. Aucun chemin venu
    de la requete n'arrive ici tel quel.
    """
    dossier = _dossier(nom) if nom else racine()
    if not os.path.isdir(dossier):
        raise ErreurProjet("Ce dossier n'existe pas encore : %s" % dossier,
                           "Il sera cree au premier enregistrement.")
    try:
        if sys.platform.startswith("win"):
            os.startfile(dossier)                      # noqa: S606
        elif sys.platform == "darwin":
            subprocess.Popen(["open", dossier], close_fds=True)
        else:
            subprocess.Popen(["xdg-open", dossier], close_fds=True)
    except OSError as exc:
        raise ErreurProjet("Le dossier n'a pas pu etre ouvert : %s" % exc)
    return {"lance": "dossier", "dossier": dossier}
