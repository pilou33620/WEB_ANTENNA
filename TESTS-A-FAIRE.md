# Tests à faire

Les essais et mesures encore à faire pour WEB_ANTENNA, au 22/10/2026. Ce qui reste ouvert sur la
physique des antennes se tranche au solveur : les calculs se lancent depuis la page (balayage
d'une cote de motif, croisé au besoin) et chaque relevé s'enregistre à la racine comme
`croisement-*.json`. Sauf mention contraire : FR-4 1,53 mm, 2,45 GHz, réglages du croisement du
patch. Les plans détaillés sont dans [HISTORIQUE.md](HISTORIQUE.md) (§ 1, *Plans de mesure*) ;
chaque essai a sa spec dans web_suite (`tasks/essais/`), avec la consigne pour Claude in Chrome.
Le code qui suivra chaque résultat est dans [A-FAIRE.md](A-FAIRE.md).

## Calculs openEMS

- [ ] **MIFA, `kd` × `n`** : `kd` = 100 / 120 / 140 / 160 × `n` = 1 / 2 / 3, 12 points →
  `croisement-mifa-kd-n.json` —
  [ESSAI-antenna-mifa-kd-n.md](https://github.com/pilou33620/web_suite/blob/main/tasks/essais/ESSAI-antenna-mifa-kd-n.md)
- [ ] **Monopôle, `wr` × `Lm`** : `wr` × 0,6 / 1 / 1,5 / 2 × `Lm` − 3 % / 0 / + 3 %, 12 points →
  `croisement-monopole-wr-Lm.json` —
  [ESSAI-antenna-monopole-wr-lm.md](https://github.com/pilou33620/web_suite/blob/main/tasks/essais/ESSAI-antenna-monopole-wr-lm.md)
- [ ] **Facteurs du dipôle, du monopôle et de l'IFA hors de leur cas** : 5,8 GHz sur FR-4
  1,53 mm et 2,45 GHz sur RO4003C 0,813 mm, 6 points ; un écart de résonance sous 2 % confirme
  le facteur → `validation-facteurs.json` —
  [ESSAI-antenna-facteurs-5g8.md](https://github.com/pilou33620/web_suite/blob/main/tasks/essais/ESSAI-antenna-facteurs-5g8.md)
- [ ] **Patch, balayage fin de `y₀`** : de − 1,5 à 0 mm sous le défaut corrigé, pas de 0,25 mm,
  7 points (FR-4 1,6 mm) → `balayage-patch-y0-fin.json`. *Plage à valider avant le lancement.* —
  [ESSAI-antenna-patch-y0-fin.md](https://github.com/pilou33620/web_suite/blob/main/tasks/essais/ESSAI-antenna-patch-y0-fin.md)
- [ ] **Patch, deux strates de plus** : FR-4 haute fréquence (tan δ 0,012) et RO4003C 1,524 mm.
  *Plan à valider avant.* —
  [ESSAI-antenna-patch-strates.md](https://github.com/pilou33620/web_suite/blob/main/tasks/essais/ESSAI-antenna-patch-strates.md)
- [ ] **`AddMSLPort`, l'écart de + 1 %** : « localisé + maillage du MSLPort » et « MSLPort sans
  affinage », deux calculs à comparer à 2,450 et 2,476 GHz —
  [ESSAI-antenna-mslport.md](https://github.com/pilou33620/web_suite/blob/main/tasks/essais/ESSAI-antenna-mslport.md)

## Banc

- [ ] **`python python/test/banc-openems.py --simuler`** : les deux vraies simulations FDTD
  passaient au relevé du 02/10/2026 et n'ont pas été relancées depuis (le banc sans
  `--simuler` passe : 1053 vérifications le 21/10/2026).

Le canal de pilotage depuis l'iPad et Claude Code avec le MCP (Pi, Windows) concernent toute la
suite : ils sont dans le
[TESTS-A-FAIRE de web_suite](https://github.com/pilou33620/web_suite/blob/main/TESTS-A-FAIRE.md).
