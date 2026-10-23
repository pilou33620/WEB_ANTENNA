# À faire — fonctionnalités et bugs

Ce qui reste à coder dans WEB_ANTENNA, au 22/10/2026 : nouvelles fonctionnalités et bugs, rien
d'autre (les essais et mesures sont repoussés à plus tard) ; le carnet de mesures et de travaux d'avant, avec les limites connues et ce qu'on en a décidé, dans
[HISTORIQUE.md](HISTORIQUE.md).

## Bugs

Aucun bug connu ouvert (banc du 21/10/2026 : `python python/test/banc-openems.py`, 1053
vérifications passées ; aucun `TODO` ni `FIXME` dans le code).

## Fonctionnalités

La campagne de mesures du 22/10/2026 (six plans, relevés à la racine, bilan dans
[HISTORIQUE.md](HISTORIQUE.md), « Campagne du 22/10/2026 ») a tranché quatre lignes. Les
décisions du 23/10/2026 : ruban maillé fin par défaut, une petite campagne pour recaler le
patch, pas de seconde campagne pour le MIFA ni pour les facteurs.

- [ ] **Recaler le patch sur le maillage fin** : lancer la campagne « Recalage du patch »
  (bouton **📋 Campagne**, environ 11 h annoncées, la première a tenu en 2 h 30), poser
  `recalage-patch-maillage-fin.json` à la racine, puis recaler `PATCH_K_LONGUEUR` et
  `PATCH_RBORD` (`js/22-antennes.js`) sur ses cinq cas. D'ici là, sur ce maillage, un patch
  tombe environ 0,7 % au-dessus de sa cible.
- [ ] **Retirer la campagne de mesures** une fois ce recalage rendu : le bouton
  « 📋 Campagne » (`index.html`), `js/39-campagne.js`, son style (`css/antenne.css`), sa
  section du banc (`test/banc-interface.js`, « Campagne de mesures ») et du README.
- [ ] **MIFA, défaut de `kd`** : avec un repli, `kd` ≈ 137 % donne 2,45 GHz (mal adapté,
  −5 dB) ; avec deux ou trois, la résonance reste au-dessus de 2,82 GHz jusqu'à `kd` = 160 %.
  *Bloqué : il faudrait `kd` au-delà de 160 % et une bande jusqu'à 4 GHz, campagne non lancée
  (23/10/2026).*
- [ ] **Facteurs du dipôle, du monopôle et de l'IFA** : ils ne tiennent pas hors de leur cas
  (dipôle −8,3 % à 5,8 GHz et +3,5 % sur RO4003C 0,813 mm, monopôle −15 % ou plus à 5,8 GHz,
  IFA −10,5 % et +14 % ; seul le monopôle sur RO4003C tient, −0,3 %). *Bloqué : il faudrait
  un balayage de longueur par cas pour en tirer une loi, campagne non lancée (23/10/2026).*
- [x] **Patch, deux strates de plus dans `patchCorrRbord`** (23/10/2026) : FR-4 haute
  fréquence k = 0,246, RO4003C 1,524 mm k = 0,310. La loi devient 1/k = a(h) + b·tan δ : c'est
  l'épaisseur, pas les pertes, qui sépare RO4003C et RO4350B. Provisoire jusqu'au recalage.
- [x] **Patch, les 15 Ω inductifs au pied** (23/10/2026) : disparus. Au `y₀` du gabarit,
  −23,5 dB à 2,4496 GHz ; rien à reporter.
- [x] **Monopôle, la réactance de +16j** (23/10/2026) : `wr` n'en est pas le levier (+12j à
  × 0,6, +23j à × 2) ; le S₁₁ est déjà de −16 dB. Point fermé, `wr` inchangé.
- [x] **`AddMSLPort`, défaut ou option** (23/10/2026) : l'écart venait du maillage (le port
  localisé maillé fin monte à 2,468 GHz). Le ruban déclaré se maille désormais fin sous le port
  localisé ; le MSLPort reste une option, et son prolongement hors carte n'est plus à faire.
