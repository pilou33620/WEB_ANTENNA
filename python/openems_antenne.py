#!/usr/bin/python3
# -*- coding: utf-8 -*-
# ==========================================================================
# VERSIONING
# Version: 1.0.0
# Date: 2026-09-14
# Explication : la porte unique de l'outil « Antenne openEMS ».
#
#   web_antenna.py n'importe que ce module, et n'en connait que ses fonctions.
#   Tout le reste — la lecture du document, le maillage, la generation du
#   script, le lancement du solveur — est derriere.
#
#   POURQUOI UNE FACADE POUR TROIS MODULES. Parce que deux d'entre eux
#   peuvent manquer independamment. openems_modele ne depend de rien et
#   fonctionne toujours : l'assistant, les verifications et le script
#   s'obtiennent sur n'importe quel poste. openems_run, lui, a besoin
#   d'openEMS installe. Sans la facade, web_antenna.py devrait porter cette
#   nuance dans ses routes ; avec elle, il pose la question une fois et la
#   reponse dit exactement ce qui marche et ce qui ne marche pas.
#
# Fonctions : etat, preparer, script, balayage, tableau_s, lancer,
#            lancer_balayage, lancer_tableau_s, journal, arreter, liste,
#            paraview, dossier, dossier_calculs, archiver_calcul,
#            identifiant_neuf,
#            debit, debit_noter, fils, regler_fils, banc_noter, lancer_banc,
#            champs, champ
# ==========================================================================
"""Porte d'entree de l'outil antenne : preparation, script, execution."""

import os

import openems_modele
import openems_pieces
from openems_modele import ErreurModele          # noqa: F401  (re-export)

MAX_CORPS = openems_modele.MAX_CORPS

try:
    import openems_run
    ERREUR_RUN = None
except Exception as _exc:                              # noqa: BLE001
    openems_run = None
    ERREUR_RUN = _exc

try:
    import openems_script
    ERREUR_SCRIPT = None
except Exception as _exc:                              # noqa: BLE001
    openems_script = None
    ERREUR_SCRIPT = _exc

# LE LECTEUR DE CHAMPS NE DEPEND DE RIEN -- ni d'openEMS, ni de numpy, ni de
# VTK : il n'ouvre que du XML et de la zlib, tous deux dans la bibliotheque
# standard. Il est donc disponible la ou le solveur ne l'est pas, et cela
# compte : on relit sur son poste les champs d'un calcul mene ailleurs.
try:
    import openems_champs
    ERREUR_CHAMPS = None
except Exception as _exc:                              # noqa: BLE001
    openems_champs = None
    ERREUR_CHAMPS = _exc


def etat():
    """Ce que ce poste sait faire, et ce qu'il ne sait pas.

    Deux disponibilites distinctes, et la page les distingue : « preparer »
    marche toujours, « lancer » demande openEMS. Une interface qui se
    contenterait d'un booleen unique se griserait entierement sur un poste
    ou l'on peut parfaitement preparer une simulation et exporter son script.
    """
    out = openems_modele.etat()
    out["preparer"] = True
    # La visionneuse de champs est interne a l'outil : elle marche des que le
    # lecteur de .vtr s'importe, solveur present ou non.
    out["visionneuse"] = openems_champs is not None
    out["script"] = openems_script is not None
    if openems_script is None:
        out["script_detail"] = str(ERREUR_SCRIPT)

    if openems_run is None:
        out["lancer"] = False
        out["lancer_detail"] = "Module d'execution indisponible : %s" % ERREUR_RUN
        return out

    solveur = openems_run.etat()
    out["lancer"] = bool(solveur.get("dispo"))
    out["fils"] = fils()
    out["solveur"] = solveur
    out["paraview"] = openems_run.chemin_paraview()
    if not out["lancer"]:
        out["lancer_detail"] = solveur.get("detail", "")
        out["lancer_conseil"] = solveur.get("conseil", "")
    return out


def preparer(doc):
    """Verifie et complete le document. C'est l'appel de l'assistant : il a
    lieu a chaque modification d'un champ, et il ne calcule rien de lourd.

    Les triangles des pieces importees ne remontent pas : la page les a deja,
    c'est elle qui les a envoyes. Voir openems_pieces.sans_geometrie."""
    return openems_pieces.sans_geometrie(openems_modele.normaliser(doc))


def script(doc):
    """Le script Python autonome, en texte. Rien n'est ecrit sur le disque."""
    if openems_script is None:
        raise ErreurModele("Generateur de script indisponible : %s" % ERREUR_SCRIPT)
    modele = openems_modele.normaliser(doc)
    chemin = openems_run.dossier_openems() if openems_run else ""
    texte = openems_script.generer(modele, chemin_openems=chemin)
    nom = (modele.get("nom") or "antenne").rsplit(".", 1)[0]
    return {"nom": nom + "_openems.py", "script": texte,
            "estimation": modele["estimation"], "avis": modele["avis"]}


def lancer(doc):
    if openems_run is None:
        raise ErreurModele(
            "Execution indisponible : %s" % ERREUR_RUN,
            "Le module openems_run n'a pas pu etre importe. Preparer le "
            "modele et exporter le script restent possibles.")
    return openems_run.lancer(openems_modele.normaliser(doc))


def balayage(doc):
    """Prepare un balayage : N documents -> N modeles verifies, sans rien
    lancer. C'est le pendant de `preparer` : la page l'appelle pour chiffrer
    la plage avant de s'engager — combien de points, combien de cellules,
    combien de temps — et pour se faire refuser tout de suite un point qui ne
    tient pas debout."""
    bal = openems_modele.balayage(doc)
    # Les modeles complets ne remontent pas a la page : une trentaine de
    # maillages entiers font des megaoctets de JSON pour un tableau de trois
    # colonnes. Ce qui remonte, c'est ce qui se lit.
    return {
        "nom": bal["nom"], "unite": bal["unite"],
        "estimation": bal["estimation"],
        "points": [{"etiquette": p["etiquette"], "valeur": p["valeur"],
                    "cellules": p["modele"]["estimation"]["cellules"],
                    "avis": p["modele"]["avis"]}
                   for p in bal["points"]],
    }


def tableau_s(doc):
    """Chiffre un tableau S complet sans rien lancer : combien de colonnes,
    combien de cellules, combien de temps. C'est le pendant de `balayage` — et
    il a la meme vertu, celle de faire arriver le refus AVANT l'engagement.

    Les modeles complets ne remontent pas a la page : N maillages entiers font
    des megaoctets de JSON pour afficher trois nombres.
    """
    ts = openems_modele.tableau_s(doc)
    return {
        "ports": ts["ports"],
        "estimation": ts["estimation"],
        "colonnes": [{"n": c["n"], "nom": c["nom"],
                      "cellules": c["modele"]["estimation"]["cellules"],
                      "avis": c["modele"]["avis"]} for c in ts["colonnes"]],
    }


def lancer_tableau_s(doc):
    if openems_run is None:
        raise ErreurModele(
            "Execution indisponible : %s" % ERREUR_RUN,
            "Le module openems_run n'a pas pu etre importe. Preparer le "
            "modele et exporter le script restent possibles.")
    return openems_run.lancer_tableau_s(openems_modele.tableau_s(doc))


def lancer_balayage(doc):
    if openems_run is None:
        raise ErreurModele(
            "Execution indisponible : %s" % ERREUR_RUN,
            "Le module openems_run n'a pas pu etre importe. Preparer le "
            "modele et exporter le script restent possibles.")
    return openems_run.lancer_balayage(openems_modele.balayage(doc))


def journal(ident, depuis=0):
    if openems_run is None:
        raise ErreurModele("Execution indisponible : %s" % ERREUR_RUN)
    return openems_run.journal(ident, depuis)


def arreter(ident):
    if openems_run is None:
        raise ErreurModele("Execution indisponible : %s" % ERREUR_RUN)
    return openems_run.arreter(ident)


def liste():
    if openems_run is None:
        return {"taches": []}
    return openems_run.liste()


def paraview(ident):
    """Ouvre les champs enregistres dans ParaView, ou a defaut le dossier."""
    if openems_run is None:
        raise ErreurModele("Execution indisponible : %s" % ERREUR_RUN)
    return openems_run.paraview(ident)


def dossier(ident):
    """Ouvre le dossier de calcul dans l'explorateur du systeme."""
    if openems_run is None:
        raise ErreurModele("Execution indisponible : %s" % ERREUR_RUN)
    return openems_run.ouvrir_dossier(ident)


# ==========================================================================
# Regarder les champs SANS quitter l'outil
# ==========================================================================
# `paraview()` ci-dessus reste : il y a des jours ou l'on veut une coupe
# oblique, un streamline et un export .avi, et ce jour-la ParaView est le bon
# outil. Mais ce n'est pas le cas courant. Le cas courant est « montre-moi ou
# passe le courant », et les deux fonctions qui suivent y repondent dans la
# page, en deux secondes, sans rien installer.

def _champs_module():
    if openems_champs is None:
        raise ErreurModele(
            "Lecteur de champs indisponible : %s" % ERREUR_CHAMPS,
            "Le bouton « Ouvrir le dossier » reste utilisable.")
    if openems_run is None:
        raise ErreurModele(
            "Execution indisponible : %s" % ERREUR_RUN,
            "Sans ce module, le serveur ne sait pas a quel dossier "
            "correspond un identifiant de simulation.")
    return openems_champs


def champs(ident):
    """Ce que ce calcul a laisse a regarder : la liste, sans les donnees.

    Ne lit que des noms de fichiers : un dossier de plusieurs giga-octets
    repond instantanement.
    """
    mod = _champs_module()
    dos = openems_run.dossier_de(ident)
    try:
        return mod.inventaire(dos)
    except mod.ErreurChamps as exc:
        raise ErreurModele(exc.message, exc.conseil)


def champ(ident, cle, axe="", indice=-1, max_points=0):
    """Une carte de champ, prete a animer dans la page.

    `cle` designe une serie de l'inventaire ; `axe` et `indice` decoupent la
    tranche a regarder quand l'enregistrement est un volume. Aucun nom de
    fichier ne circule : la page ne connait que des cles.
    """
    mod = _champs_module()
    dos = openems_run.dossier_de(ident)
    try:
        return mod.serie(dos, cle, axe=axe, indice=indice,
                         max_points=max_points or mod.MAX_POINTS)
    except mod.ErreurChamps as exc:
        raise ErreurModele(exc.message, exc.conseil)


def debit():
    """Le debit sur lequel les durees sont annoncees, et d'ou il vient.

    Le serveur le lit apres chaque calcul pour le ranger dans les reglages du
    poste : c'est lui qui fait le pont, parce que projet.py ne sait pas
    qu'openEMS existe et qu'openems_run ne sait pas ce qu'est un projet.
    """
    # `mcps_brut` ET NON `mcps` VA DANS LES REGLAGES : `mcps` est ramene au
    # nombre de fils du moment, et le ranger puis le ramener une seconde fois
    # au redemarrage compterait le gain deux fois.
    return {"mcps": openems_modele.debit_suppose(),
            "mcps_brut": openems_modele.debit_mesure(),
            "fils": openems_modele.debit_fils(),
            "mesure": openems_modele.debit_mesure() is not None,
            "n": openems_modele.debit_n()}


def debit_noter(mcps, fils_mesure=0):
    """Recolle un debit retenu d'une session precedente. Sans effet s'il est
    nul ou hors des bornes du plausible — un reglage abime ne doit pas faire
    annoncer des heures pour une minute."""
    return openems_modele.noter_debit(mcps, fils_mesure)


def fils():
    """Le reglage des fils de calcul, et ce que le banc en sait.

    Le serveur le range dans les reglages du poste, comme le debit : c'est
    une propriete de la machine, pas de l'antenne.
    """
    coeurs = os.cpu_count() or 0
    return {"regle": openems_modele.fils_regle(),
            "coeurs": coeurs,
            "max": openems_modele.FILS_MAX,
            "banc": {str(k): v for k, v in openems_modele.banc().items()},
            "meilleur": openems_modele.banc_meilleur(),
            "essais": (openems_run.fils_a_essayer(coeurs)
                       if openems_run is not None else [])}


def regler_fils(n):
    openems_modele.regler_fils(n)
    return fils()


def banc_noter(mesures):
    """Recolle un banc de vitesse d'une session precedente."""
    openems_modele.noter_banc(mesures)
    return fils()


def lancer_banc():
    """Demarre le banc de vitesse : une boite vide, un essai par nombre de
    fils. Rend la vue de la tache, que la page suit comme un calcul."""
    if openems_run is None:
        raise ErreurModele("Execution indisponible : %s" % ERREUR_RUN)
    return openems_run.lancer_banc()


def dossier_calculs(chemin):
    """Ou les prochaines simulations ecriront. "" remet le dossier temporaire.

    C'est le serveur qui l'appelle, a l'ouverture et a l'enregistrement d'un
    projet : les champs d'une simulation appartiennent au projet qui l'a
    demandee, et le dossier temporaire du systeme se vide tout seul. Sans
    openEMS sur le poste, l'appel ne fait rien — il n'y a rien a ecrire.
    """
    if openems_run is None:
        return ""
    return openems_run.definir_racine_calculs(chemin)


def identifiant_neuf():
    """Un identifiant de calcul neuf, a la forme qu'openems_run reconnait.

    Il sert a UN seul cas : un dossier de calcul importe d'ailleurs, que le
    serveur range dans le projet. Un nom quelconque ferait un dossier que la
    visionneuse ne retrouverait pas apres un redemarrage — c'est
    `openems_run._RE_IDENT` qui garde cette porte, et elle ne s'ouvre que sur
    douze caracteres hexadecimaux.
    """
    if openems_run is None:
        raise ErreurModele(
            "Execution indisponible : %s" % ERREUR_RUN,
            "Sans ce module, le serveur ne sait pas nommer un dossier de "
            "calcul, ni le relire ensuite.")
    return openems_run.identifiant_neuf()


def archiver_calcul(ident, base_destination):
    """Range le dossier d'un calcul deja fait sous `base_destination`.

    LE PENDANT DE `dossier_calculs`, POUR LE PASSE. La premiere dit ou les
    prochains calculs ecriront ; celle-ci rapatrie ceux qui ont deja ecrit
    ailleurs — c'est-a-dire dans le dossier temporaire du systeme, ce qui est
    le cas de tout calcul lance avant qu'un projet ne soit ouvert. Sans elle,
    « enregistrer le projet » apres une simulation gardait les courbes et
    perdait les champs : quelques centaines de mega-octets de .vtr que le
    nettoyage de disque efface un jour sans prevenir.

    Le serveur fait le pont, ici comme ailleurs : projet.py donne le dossier,
    openems_run deplace et met sa tache a jour, et aucun des deux ne connait
    l'autre.
    """
    if openems_run is None:
        raise ErreurModele("Execution indisponible : %s" % ERREUR_RUN)
    return openems_run.archiver(ident, base_destination)
