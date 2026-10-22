# À faire — fonctionnalités et bugs

Ce qui reste à coder dans WEB_ANTENNA, au 22/10/2026 : nouvelles fonctionnalités et bugs, rien
d'autre. Les calculs et mesures à mener sont dans [TESTS-A-FAIRE.md](TESTS-A-FAIRE.md) ; le
carnet de mesures et de travaux d'avant, avec les limites connues et ce qu'on en a décidé, dans
[HISTORIQUE.md](HISTORIQUE.md).

## Bugs

Aucun bug connu ouvert (banc du 21/10/2026 : `python python/test/banc-openems.py`, 1053
vérifications passées ; aucun `TODO` ni `FIXME` dans le code).

## Fonctionnalités

Presque tout ce qui reste attend une mesure : le code suit le résultat de l'essai nommé.

- [ ] **MIFA, défaut de `kd`** : le développé visé vaut 100 % du quart d'onde, et le MIFA
  résonne au-dessus de 3,5 GHz pour 2,45 visés. Remplacer ce 100 par la loi que donnera le
  croisement `kd` × `n` (en fonction de l'écartement / largeur de bras). *Attend l'essai « MIFA,
  `kd` × `n` ».*
- [ ] **Monopôle, défaut de `wr`** : il reste une réactance de +16j à la résonance. Passer le
  défaut de `wr` au rapport où Im Z ≈ 0. *Attend l'essai « Monopôle, `wr` × `Lm` ».*
- [ ] **Facteurs du dipôle, du monopôle et de l'IFA** (bras × 1,165, brin × 1,29, bras ×
  1,018) : mesurés sur un cas chacun. Si un écart de résonance dépasse 2 % hors de ce cas,
  corriger le facteur de ce motif (croisement à mener à cette fréquence). *Attend l'essai «
  Facteurs hors de leur cas ».*
- [ ] **Patch, les 15 Ω inductifs au pied** : reporter sur la strate de `patchCorrRbord` le recul
  de `y₀` où Im Z s'annule. *Attend l'essai « Patch, balayage fin de `y₀` ».*
- [ ] **Patch, deux strates de plus dans `patchCorrRbord`** : la correction n'est mesurée que sur
  FR-4 et RO4350B ; ajouter le FR-4 haute fréquence (tan δ 0,012) et le RO4003C 1,524 mm. *Attend
  l'essai « Patch, deux strates de plus ».*
- [ ] **`AddMSLPort`, défaut ou option** : il déplace la résonance de +1 % (2,476 contre
  2,450 GHz). Si l'écart vient du maillage, le MSLPort devient le défaut ; sinon il reste une
  option. *Attend l'essai « MSLPort, maillage ou port ».*
- [ ] **`AddMSLPort`, prolongement hors carte** (piste, non commencée) : prolonger ruban,
  substrat et plan de masse jusqu'à la paroi du domaine, comme le veut le port d'openEMS. Touche
  `openems_modele.py`, `openems_script.py`, le panneau des ports, la vue 3D et le banc (détail
  dans l'historique, *Le port microruban désembedé*). Seulement si le MSLPort devient le défaut.
