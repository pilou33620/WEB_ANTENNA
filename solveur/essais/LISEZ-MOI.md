# Les références des essais du solveur

`ref/` est la mémoire de ce que faisait le Python d'origine (`python/openems_script.py`,
`openems_run.py`, retirés du dépôt). Les essais Rust (`solveur/tests/references.rs`) les
relisent ; rien ne les réécrit.

## D'où elles viennent

Pour chaque cas, `ref/<cas>/` porte :

- `document.json` : le document de la page ;
- `reference.json` : la **structure** que le script Python généré posait (chaque propriété,
  chaque primitive, chaque cote), notée en exécutant ce script sur un faux `CSXCAD` et avec
  les **vraies classes de ports d'openEMS 0.0.36** ; et le **`resultats.json`** que numpy
  tirait des sondes ;
- `port_ut_*`, `port_it_*` : ces sondes, de synthèse ;
- `champ_lointain/nf2ff.h5` : un champ lointain de synthèse, écrit par la vraie bibliothèque
  HDF5 (libhdf5) dans l'ordre d'appels de `nf2ff` 0.0.36 — la référence du lecteur HDF5 en
  Rust pur (`src/hdf5.rs`).

Elles ont été produites par deux outils Python, `outils/banc_numpy.py` et
`outils/ecrire_nf2ff_h5.py`, qui comparaient le Rust au script Python généré.

## Elles ne sont plus régénérables

Le script Python généré a disparu avec le Python du dépôt, et ces deux outils avec lui : il
n'y a plus rien à quoi comparer. Les références restent **figées**. Un essai qui s'en écarte
signale un changement de comportement du Rust, à juger sur pièces ; on ne « rafraîchit » pas
une référence pour le faire passer. Un cas nouveau s'ajoute avec une référence relevée sur un
vrai openEMS, et le dit.

Il en va de même de `modele/essais/` : les sorties du modèle Python (`references.json`, les
`*.modele.json`, `champs/`) y sont figées.
