#!/usr/bin/python3
# -*- coding: utf-8 -*-
# ==========================================================================
# VERSIONING
# Version: 1.0.0
# Date: 2026-09-14
# Explication : la porte unique de l'outil « Antenne openEMS ».
#
#   serveur.py n'importe que ce module, et n'en connait que ses fonctions.
#   Tout le reste — la lecture du document, le maillage, la generation du
#   script, le lancement du solveur — est derriere.
#
#   POURQUOI UNE FACADE POUR TROIS MODULES. Parce que deux d'entre eux
#   peuvent manquer independamment. openems_modele ne depend de rien et
#   fonctionne toujours : l'assistant, les verifications et le script
#   s'obtiennent sur n'importe quel poste. openems_run, lui, a besoin
#   d'openEMS installe. Sans la facade, serveur.py devrait porter cette
#   nuance dans ses routes ; avec elle, il pose la question une fois et la
#   reponse dit exactement ce qui marche et ce qui ne marche pas.
#
# Fonctions : etat, preparer, script, balayage, tableau_s, lancer,
#            lancer_balayage, lancer_tableau_s, journal, arreter, liste,
#            paraview, dossier, dossier_calculs, debit, debit_noter
# ==========================================================================
"""Porte d'entree de l'outil antenne : preparation, script, execution."""

import openems_modele
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


def etat():
    """Ce que ce poste sait faire, et ce qu'il ne sait pas.

    Deux disponibilites distinctes, et la page les distingue : « preparer »
    marche toujours, « lancer » demande openEMS. Une interface qui se
    contenterait d'un booleen unique se griserait entierement sur un poste
    ou l'on peut parfaitement preparer une simulation et exporter son script.
    """
    out = openems_modele.etat()
    out["preparer"] = True
    out["script"] = openems_script is not None
    if openems_script is None:
        out["script_detail"] = str(ERREUR_SCRIPT)

    if openems_run is None:
        out["lancer"] = False
        out["lancer_detail"] = "Module d'execution indisponible : %s" % ERREUR_RUN
        return out

    solveur = openems_run.etat()
    out["lancer"] = bool(solveur.get("dispo"))
    out["solveur"] = solveur
    out["paraview"] = openems_run.chemin_paraview()
    if not out["lancer"]:
        out["lancer_detail"] = solveur.get("detail", "")
        out["lancer_conseil"] = solveur.get("conseil", "")
    return out


def preparer(doc):
    """Verifie et complete le document. C'est l'appel de l'assistant : il a
    lieu a chaque modification d'un champ, et il ne calcule rien de lourd."""
    return openems_modele.normaliser(doc)


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


def debit():
    """Le debit sur lequel les durees sont annoncees, et d'ou il vient.

    Le serveur le lit apres chaque calcul pour le ranger dans les reglages du
    poste : c'est lui qui fait le pont, parce que projet.py ne sait pas
    qu'openEMS existe et qu'openems_run ne sait pas ce qu'est un projet.
    """
    return {"mcps": openems_modele.debit_suppose(),
            "mesure": openems_modele.debit_mesure() is not None,
            "n": openems_modele.debit_n()}


def debit_noter(mcps):
    """Recolle un debit retenu d'une session precedente. Sans effet s'il est
    nul ou hors des bornes du plausible — un reglage abime ne doit pas faire
    annoncer des heures pour une minute."""
    return openems_modele.noter_debit(mcps)


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
