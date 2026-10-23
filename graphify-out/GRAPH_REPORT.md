# Graph Report - WEB_ANTENNA  (2026-10-23)

## Corpus Check
- 73 files · ~361,966 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 10 file(s) not represented in the graph (top: .css 6, (none) 2, .wasm 1)

## Summary
- 4287 nodes · 9132 edges · 183 communities (118 shown, 65 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 309 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d17fb311`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- banc-interface.js
- three.min.js
- Poste
- Oi
- 33-pieces.js
- 34-placement.js
- 02-modele.js
- 20-conception.js
- 05-panneaux.js
- projet.py
- zt
- copy
- appairage.py
- openems_modele.py
- openems_champs.py
- _c
- en
- 28-projet.js
- .setAttribute
- Eh
- ln
- 13-assistant.js
- yt
- 32-visionneuse.js
- 14-apercu3d.js
- Ze
- openems_run.py
- openems_pieces.py
- rn
- ErreurModele
- openems_script.py
- 23-panneau-conception.js
- normaliser
- 22-antennes.js
- ipc2581_parser.py
- ipc2581_json.py
- 90-workspace.js
- Fe
- 39-campagne.js
- ks
- Ct
- web_antenna.py
- qs
- 16-resultats.js
- 10-etat.js
- pc
- ko
- Ot
- banc-openems.py
- 03-rendu.js
- yh
- IPC2581Parser
- _maillage
- creer
- Nt
- parseObject
- xh
- ._tag
- ho
- carte-antenne.py
- Tache
- Pilote
- Element
- es
- Lt
- .toJSON
- 21-dessin.js
- gh
- lancer
- _estimation
- 29-tableau-s.js
- lancer_banc
- xl
- xt
- pilote.py
- 15-overlay2d.js
- 31-rapport.js
- 37-port-auto.js
- banc-champs.py
- mo
- fils
- 24-balayage.js
- update
- TacheBalayage
- 04-interaction.js
- 12-api-openems.js
- na
- Go
- _masse_cachee
- 11-geometrie.js
- 18-champs.js
- _o
- vl
- _ouvrir_ecarts
- Garde
- 35-fils.js
- sh
- _mailler
- banc-polygones.js
- Kn
- load
- dispose
- 25-polygones.js
- createWasm
- g
- Mt
- _ponts_couche
- Appairage
- rt
- .removeEventListener
- lancer_tableau_s
- Serveur web_antenna.py (stdlib seule)
- Les sept etapes de l'assistant
- index.html page principale
- 38-tuto.js
- .mmap
- .updateMatrix
- 01-api.js
- abort
- _exiger_libre
- be
- README Antenne openEMS
- 17-objets.js
- postRun
- bh
- io
- we
- 26-exemple.js
- 27-apercu-motif.js
- Pieces STEP: boitier et piles
- z
- _ligne_alim
- Do
- Fo
- No
- qn
- parseAsync
- IPCDesign
- C
- travailleur-occt.js
- craftInvokerFunction
- getCallstack
- ___syscall_ioctl
- .annoncer
- Drill
- dossier_calculs
- write
- registerType
- syncfs
- syscallGetVarargI
- H
- 00-espace-config.js
- close
- ht
- allocate
- ioctl
- llseek
- lookup
- mknod
- mount
- readdir
- readlink
- rename
- rmdir
- symlink
- unlink
- _ordonnee
- ServeurDoublePile
- ea
- _h
- bo
- uo

## God Nodes (most connected - your core abstractions)
1. `zt` - 115 edges
2. `yt` - 87 edges
3. `copy()` - 76 edges
4. `IPC2581Parser` - 72 edges
5. `rn` - 64 edges
6. `Ct` - 61 edges
7. `Fe` - 59 edges
8. `qs` - 57 edges
9. `Poste` - 55 edges
10. `ln` - 51 edges

## Surprising Connections (you probably didn't know these)
- `La correction du gabarit — quatre cas mesurés, une loi pour L, deux strates pour y₀` --references--> `patchCorrLongueur()`  [INFERRED]
  HISTORIQUE.md → js/22-antennes.js
- `Plans de mesure — arrêtés le 21/10/2026` --references--> `wr()`  [INFERRED]
  HISTORIQUE.md → js/vendor/three.min.js
- `Ce qui est déjà en travaux, plus haut` --references--> `patchCorrRbord()`  [INFERRED]
  HISTORIQUE.md → js/22-antennes.js
- `La correction du gabarit — quatre cas mesurés, une loi pour L, deux strates pour y₀` --references--> `patchCorrRbord()`  [INFERRED]
  HISTORIQUE.md → js/22-antennes.js
- `Plans de mesure — arrêtés le 21/10/2026` --references--> `patchCorrRbord()`  [INFERRED]
  HISTORIQUE.md → js/22-antennes.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Reglage mesure du patch** — a_faire_patch_adaptation, a_faire_croisement_g_y0, a_faire_correction_gabarit [EXTRACTED 0.95]
- **Pipeline de simulation en sept etapes** — readme_sept_etapes, readme_nettoyage_geometrique, readme_pertes_debye, readme_revetements_exterieurs, readme_port_localise [INFERRED 0.85]

## Communities (183 total, 65 thin omitted)

### Community 0 - "banc-interface.js"
Cohesion: 0.01
Nodes (161): AJOUT7, avantMasque, ax9, BAL3, BAL9, barre, barre2, barre3 (+153 more)

### Community 2 - "three.min.js"
Cohesion: 0.04
Nodes (36): Ar(), br(), co, Cr(), el(), er(), fr(), getOutput() (+28 more)

### Community 3 - "Poste"
Cohesion: 0.06
Nodes (3): adresse_lanceur(), Poste, Refus

### Community 4 - "Oi"
Cohesion: 0.22
Nodes (3): ki(), Oi, xi()

### Community 5 - "33-pieces.js"
Cohesion: 0.07
Nodes (71): ANT_CARTE_PIECE, ANT_DEVINE, ANT_FORMATS_3D, ANT_MATIERES, ANT_OCCT_FILE, ANT_OCCT_PARAMS, ANT_PIECES_ARETES, ANT_PIECES_TAB (+63 more)

### Community 6 - "34-placement.js"
Cohesion: 0.08
Nodes (69): antCarte3d(), antPlaceAccrocher(), antPlaceAnnuler(), antPlaceApres(), antPlaceAvantRendu(), antPlaceBarre(), antPlaceCadrer(), antPlaceChoisir() (+61 more)

### Community 7 - "02-modele.js"
Cohesion: 0.06
Nodes (63): CU_PALETTE, GENRE_COULEUR, LT, ltAire(), ltArc(), ltAutoRole(), ltCleGap(), ltEeff() (+55 more)

### Community 8 - "20-conception.js"
Cohesion: 0.07
Nodes (64): CON, CON_CONDUCTEURS, CON_DIELECTRIQUES, CON_EP_CUIVRE, CON_GENRES, CON_HIST, CON_MODELES, CON_SORTES (+56 more)

### Community 9 - "05-panneaux.js"
Cohesion: 0.07
Nodes (60): mdlCoucheNom(), mdlEsc(), BOUTON_AFF, ELEMENTS, fermerModalNets(), l3(), LT_TOPO, ltC() (+52 more)

### Community 10 - "projet.py"
Cohesion: 0.06
Nodes (33): banc_lu(), banc_noter(), calculs(), _config_ecrire(), _config_lire(), debit_fils_lu(), debit_lu(), debit_noter() (+25 more)

### Community 12 - "copy"
Cohesion: 0.06
Nodes (12): ai, bs(), copy(), S(), y(), setFromCamera(), ue, ut() (+4 more)

### Community 13 - "appairage.py"
Cohesion: 0.10
Nodes (19): _a_refaire(), adresses_poste(), appairer(), _ca_a_refaire(), _cnf(), contexte_tls(), dossier_tls(), empreinte_ca() (+11 more)

### Community 14 - "openems_modele.py"
Cohesion: 0.06
Nodes (21): _avis(), _avis_coax_contacts(), _avis_ecarts_ouverts(), _avis_ponts_de_maille(), _avis_ports_court_circuit(), _cause_cellule(), _coax_z0(), _coupable_cellule() (+13 more)

### Community 15 - "openems_champs.py"
Cohesion: 0.09
Nodes (19): _amplitude_max(), _axe_par_defaut(), _champ_de(), _decouper(), entete_vtr(), ErreurChamps, _etiquette(), _hertz() (+11 more)

### Community 17 - "en"
Cohesion: 0.05
Nodes (9): _a(), ci, en(), jn(), Nh, nr(), ra, ro() (+1 more)

### Community 18 - "28-projet.js"
Cohesion: 0.10
Nodes (50): PRJ, prjAccueilRendre(), prjAffichage(), prjAntAppliquer(), prjAntenne(), prjAppel(), prjAppliquer(), prjArchivable() (+42 more)

### Community 19 - ".setAttribute"
Cohesion: 0.07
Nodes (28): bt(), c(), l(), o(), clone(), constructor(), t(), Ga (+20 more)

### Community 20 - "Eh"
Cohesion: 0.04
Nodes (4): Eh, ie, rh, Ye

### Community 21 - "ln"
Cohesion: 0.05
Nodes (10): cn, dn, fn, gn, hn, ln, mn, pn (+2 more)

### Community 22 - "13-assistant.js"
Cohesion: 0.11
Nodes (43): aE(), aEnt(), aEsc(), aF(), aL(), aNb(), ANT_AUTO, ANT_CAUSES (+35 more)

### Community 24 - "32-visionneuse.js"
Cohesion: 0.11
Nodes (45): CHP, CHP_LUT, CHP_MG, CHP_NOMS, CHP_PALETTES, chpAccueil(), chpArret(), chpAxes() (+37 more)

### Community 25 - "14-apercu3d.js"
Cohesion: 0.11
Nodes (43): ANT3D, ANT3D_MAILLE, ANT3D_MAILLE_PLANS, ANT3D_NAV, ant3dAnimer(), ant3dBoites(), ant3dCadrer(), ant3dClef() (+35 more)

### Community 26 - "Ze"
Cohesion: 0.06
Nodes (11): bl, dl(), fl(), Ka, ol(), sa, sn, ul() (+3 more)

### Community 27 - "openems_run.py"
Cohesion: 0.11
Nodes (13): liste(), archiver(), _base_calculs(), _base_temporaire(), _chiffre(), dossier_de(), _dossier_de(), _dossier_neuf() (+5 more)

### Community 28 - "openems_pieces.py"
Cohesion: 0.09
Nodes (19): _analyser(), _bords(), corps_inclus(), _decoder(), emprises(), ErreurPiece, _matrice(), _nb() (+11 more)

### Community 29 - "rn"
Cohesion: 0.05
Nodes (8): dt(), nn(), Qh, rn, $s, ta, tn(), Wc

### Community 30 - "ErreurModele"
Cohesion: 0.08
Nodes (22): archiver_calcul(), arreter(), balayage(), champ(), champs(), _champs_module(), dossier(), identifiant_neuf() (+14 more)

### Community 31 - "openems_script.py"
Cohesion: 0.08
Nodes (20): _bloc_calcport(), _bloc_debye(), _bloc_dumps(), _bloc_fils(), _bloc_ligne(), _bloc_pieces(), _bloc_ports(), _chaine_b64() (+12 more)

### Community 32 - "23-panneau-conception.js"
Cohesion: 0.13
Nodes (41): CON_DEC_F, CON_ROLES_CU, CON_UNITES, conAff(), conApercuBloc(), conApercuLier(), conApercuMaj(), conBarreRendre() (+33 more)

### Community 33 - "normaliser"
Cohesion: 0.10
Nodes (26): balayage(), _bande(), _boite(), _carte(), _conducteur(), _cuivre(), _dict(), _dumps() (+18 more)

### Community 34 - "22-antennes.js"
Cohesion: 0.09
Nodes (33): CON_GABARITS, CON_MOTIF_DIPOLE, CON_MOTIF_IFA, CON_MOTIF_LIGNE, CON_MOTIF_MIFA, CON_MOTIF_MONOPOLE, CON_MOTIF_PATCH, CON_MOTIF_RESEAU (+25 more)

### Community 35 - "ipc2581_parser.py"
Cohesion: 0.10
Nodes (12): Arc, Component, CopperPlane, Net, Package, PadDef, PadInstance, Pin (+4 more)

### Community 36 - "ipc2581_json.py"
Cohesion: 0.07
Nodes (15): charger_octets(), _contour(), _contre_percage(), design_en_dict(), _Flux, _forme_en_dict(), _Index, ipc2581_en_dict() (+7 more)

### Community 37 - "90-workspace.js"
Cohesion: 0.14
Nodes (38): WS, WS_DOCKS, wsApply(), wsCanvasSync(), wsClose(), wsDefault(), wsDrag, wsEl (+30 more)

### Community 39 - "39-campagne.js"
Cohesion: 0.18
Nodes (20): CAMP, CAMP_BASE, CAMP_CHAMPS, CAMP_PLANS, campArreter(), campChiffrer(), campDerouler(), campDocument() (+12 more)

### Community 40 - "ks"
Cohesion: 0.22
Nodes (12): ks(), j(), k(), q(), U(), W(), G(), H() (+4 more)

### Community 42 - "web_antenna.py"
Cohesion: 0.08
Nodes (11): banc_au_demarrage(), ip_reseau(), _ipv4_libre(), _lisible(), main(), ouvrir_socket(), _pourquoi(), redemarrer_application() (+3 more)

### Community 43 - "qs"
Cohesion: 0.04
Nodes (13): de, M(), C(), D(), qs, Ft(), Nt(), Ot() (+5 more)

### Community 44 - "16-resultats.js"
Cohesion: 0.14
Nodes (34): ANT_BAL_TIRETS, ANT_COURBE_ETAT, ANT_ONGLETS, antBal(), antBalAxes(), antBalCouleur(), antBalCouleurDe(), antBalDessiner() (+26 more)

### Community 45 - "10-etat.js"
Cohesion: 0.09
Nodes (24): ANT, ANT_ETAPES, ANT_UNITES_F, antAjouterFormes(), antDevinerCouches(), antDevinerMasse(), antDocument(), antEmpilage() (+16 more)

### Community 47 - "ko"
Cohesion: 0.08
Nodes (14): al(), cl(), hl(), il(), jo(), ko, nl(), pl() (+6 more)

### Community 48 - "Ot"
Cohesion: 0.08
Nodes (5): v(), Kt(), Ot, Ht(), Ut()

### Community 49 - "banc-openems.py"
Cohesion: 0.09
Nodes (18): balaye(), _coque(), _court(), croise(), document(), _pastille_dans_reserve(), _pastille_decalee(), _pave() (+10 more)

### Community 50 - "03-rendu.js"
Cohesion: 0.14
Nodes (32): bcx(), CACHE, centrerSur(), ctx, cv, dansFenetre(), dessiner(), fenetre() (+24 more)

### Community 53 - "_maillage"
Cohesion: 0.08
Nodes (15): _bande_lignes(), _coller(), _coller_ports(), _emprise_primitive(), _fusionner(), _grouper(), _lignes(), _lisser() (+7 more)

### Community 54 - "creer"
Cohesion: 0.10
Nodes (45): CARTES_ANTENNA, creer(), afficher(), ajouter(), annoncer(), annuler(), appliquer(), base64() (+37 more)

### Community 56 - "parseObject"
Cohesion: 0.06
Nodes (7): cc, Ha, lo, oo, parseObject(), wa, za

### Community 60 - "carte-antenne.py"
Cohesion: 0.53
Nodes (4): cercle(), fabriquer(), poly(), rect()

### Community 61 - "Tache"
Cohesion: 0.15
Nodes (3): interprete(), _preparer_env(), Tache

### Community 62 - "Pilote"
Cohesion: 0.09
Nodes (11): PILOTE_ANTENNA, PILOTE_PANNEAUX, piloteAntenna(), piloteAntennaEtape(), piloteAntennaPanneau(), piloteAntennaToile(), piloteAntennaVue(), _pieces() (+3 more)

### Community 63 - "Element"
Cohesion: 0.22
Nodes (3): Contour, Point, Track

### Community 64 - "es"
Cohesion: 0.11
Nodes (15): as(), y(), cs(), ds(), es(), fs(), hs(), ms() (+7 more)

### Community 65 - "Lt"
Cohesion: 0.11
Nodes (10): ao, ei, hc, Pa, parseImages(), parseImagesAsync(), parseTextures(), Lt() (+2 more)

### Community 67 - "21-dessin.js"
Cohesion: 0.13
Nodes (14): CON_GRILLE_CHEMIN, CON_MULTIPLES, CON_OUTILS, conGrilleChemin(), conNouvelle(), conPeindreChoisie(), conPeindreCourant(), conPeindreDecoupes() (+6 more)

### Community 68 - "gh"
Cohesion: 0.08
Nodes (3): getValue(), gh, setValue()

### Community 69 - "lancer"
Cohesion: 0.15
Nodes (8): dossier_openems(), _epilogue(), etat(), _exiger_solveur(), _interpretes_candidats(), lancer(), _sait_importer(), script_exportable()

### Community 70 - "_estimation"
Cohesion: 0.11
Nodes (11): debit(), debit_noter(), _banc_a(), debit_fils(), debit_mesure(), debit_n(), debit_suppose(), _estimation() (+3 more)

### Community 71 - "29-tableau-s.js"
Cohesion: 0.17
Nodes (16): antExportSnp(), antTableauSHtml(), antTs(), antTsCase(), antTsColonne(), antTsComplet(), antTsCouleur(), antTsDb() (+8 more)

### Community 72 - "lancer_banc"
Cohesion: 0.17
Nodes (3): fils_a_essayer(), lancer_banc(), TacheBanc

### Community 73 - "xl"
Cohesion: 0.12
Nodes (4): jl, Kl, ql, xl

### Community 75 - "pilote.py"
Cohesion: 0.11
Nodes (7): battement(), commander(), H, req(), demarrer(), FauxLanceur, req()

### Community 76 - "15-overlay2d.js"
Cohesion: 0.17
Nodes (18): ANT_MAILLAGE_CHEMIN, ANT_OBJETS_CHEMINS, ANT_RETENU_CHEMINS, antAntenneSousPort(), antDistSeg(), antMaillageChemin(), antMasseSous(), antObjetsChemins() (+10 more)

### Community 77 - "31-rapport.js"
Cohesion: 0.23
Nodes (17): RAP_AVIS_ETAPE, RAP_ORDRE, rapCollecterDonnees(), rapCopier(), rapDiagnostiquer(), rapEscHtml(), rapEtatEtapes(), rapFallbackCopier() (+9 more)

### Community 78 - "37-port-auto.js"
Cohesion: 0.16
Nodes (15): ANT_SEAUX_BLOC, antCuivreRetenuEn(), antPortBornesPlan(), antPortVerdict(), antPortVerdictCoax(), antPortVerdictHtml(), antSeauxBloc(), ANT_PORT_AUTO (+7 more)

### Community 79 - "banc-champs.py"
Cohesion: 0.14
Nodes (8): _b64(), _base64_octets(), _bloc_binaire(), _b64(), faces_b64(), sommets_b64(), _binaire(), ecrire_vtr()

### Community 80 - "mo"
Cohesion: 0.14
Nodes (4): gl(), ml, mo, po

### Community 81 - "fils"
Cohesion: 0.11
Nodes (11): banc_noter(), etat(), fils(), regler_fils(), banc(), banc_meilleur(), etat(), fils_effectif() (+3 more)

### Community 82 - "24-balayage.js"
Cohesion: 0.28
Nodes (15): antBalayageHtml(), antBalayageLier(), antBalayageSpec(), antBalDuree(), balCombien(), balDiff(), balDocumentPour(), balEtiquette() (+7 more)

### Community 83 - "update"
Cohesion: 0.05
Nodes (33): d(), u(), di, gi(), p(), gs(), x(), _i() (+25 more)

### Community 84 - "TacheBalayage"
Cohesion: 0.19
Nodes (3): lancer_balayage(), _resume(), TacheBalayage

### Community 85 - "04-interaction.js"
Cohesion: 0.18
Nodes (10): boitePiste(), choisirComp(), choisirRien(), couchesDesignation(), designer(), distSegment(), fin(), POINTEURS (+2 more)

### Community 86 - "12-api-openems.js"
Cohesion: 0.23
Nodes (15): oeAppel(), oeArreter(), oeBalayage(), oeBase(), oeDocBalayage(), oeErreur(), oeEtat(), oeLancer() (+7 more)

### Community 87 - "na"
Cohesion: 0.13
Nodes (4): Ca, ft(), na, ui()

### Community 89 - "_masse_cachee"
Cohesion: 0.15
Nodes (6): _absorber_contenus(), _aire(), _boite_pts(), _masse_cachee(), _sens(), _Surface

### Community 90 - "11-geometrie.js"
Cohesion: 0.26
Nodes (15): ANT_CUIVRE_CACHE, antArcEnPolyligne(), antCercle(), antCoucheCochee(), antCuivreCalcul(), antCuivreDuModele(), antEmpriseCuivre(), antFormePoints() (+7 more)

### Community 91 - "18-champs.js"
Cohesion: 0.19
Nodes (13): ANT_CALC, ANT_CHAMPS, ANT_REGIONS, antCalcCharger(), antCalcDate(), antCalcHtml(), antCalcLier(), antCalcLigneHtml() (+5 more)

### Community 94 - "_ouvrir_ecarts"
Cohesion: 0.16
Nodes (10): _couper_arete(), _elargir_cellules(), connu(), sain(), soudes(), _inserer(), _lignes_au_tiers(), _meilleures_coupes() (+2 more)

### Community 95 - "Garde"
Cohesion: 0.13
Nodes (5): brancher_tls(), en_https(), filtrer_tls(), Garde, _html()

### Community 96 - "35-fils.js"
Cohesion: 0.35
Nodes (14): ANT_FILS, antFilsBanc(), antFilsEnCours(), antFilsEtat(), antFilsHtml(), antFilsLier(), antFilsMeilleur(), antFilsMesures() (+6 more)

### Community 98 - "_mailler"
Cohesion: 0.14
Nodes (7): _bandes_fines(), _bilan_pistes(), _cout(), _dans(), _lignes_bandes(), _mailler(), _souder()

### Community 99 - "banc-polygones.js"
Cohesion: 0.15
Nodes (10): aire(), aireTotale(), disque, fs, ko, L, r, src (+2 more)

### Community 100 - "Kn"
Cohesion: 0.05
Nodes (8): Le port microruban désembedé (`AddMSLPort`) — le prix, désormais chiffré, bi, ec, Kn, nc(), Sc, tc, xc

### Community 101 - "load"
Cohesion: 0.10
Nodes (11): ac, dc, Ic, kc, lc, load(), loadAsync(), parse() (+3 more)

### Community 102 - "dispose"
Cohesion: 0.33
Nodes (3): dispose(), It, i()

### Community 103 - "25-polygones.js"
Cohesion: 0.30
Nodes (10): polyAire(), polyCompte(), polyCroise(), polyDedans(), polyInserer(), polyIntersection(), polyListe(), polyPlat() (+2 more)

### Community 104 - "createWasm"
Cohesion: 0.20
Nodes (12): addOnInit(), addRunDependency(), createWasm(), receiveInstance(), receiveInstantiationResult(), findWasmBinary(), getWasmImports(), locateFile() (+4 more)

### Community 105 - "g"
Cohesion: 0.17
Nodes (14): 1. Ce qui manque, et qui se voit à l'usage, 2. Les limites connues, et ce qu'on en fait, Ce qui est déjà en travaux, plus haut, Ce qui est une limite du monde, pas de l'outil, Ce qui ne se rouvre pas, Historique — le carnet de mesures et de travaux (jusqu'au 22/10/2026), L'adaptation du patch — la mesure a tranché, et ce n'est pas ce qu'on croyait, La correction du gabarit — quatre cas mesurés, une loi pour L, deux strates pour y₀ (+6 more)

### Community 106 - "Mt"
Cohesion: 0.17
Nodes (10): Is(), Ls(), Mt(), Tt(), Vs(), K(), Q(), tt() (+2 more)

### Community 107 - "_ponts_couche"
Cohesion: 0.10
Nodes (11): _couper_seg(), _divise(), _pas_local(), pas(), _ponts_couche(), dedans(), dist(), ranger() (+3 more)

### Community 109 - "rt"
Cohesion: 0.16
Nodes (5): Et, pt(), rt, D(), wt()

### Community 110 - ".removeEventListener"
Cohesion: 0.21
Nodes (6): s(), a(), Et(), vh, G(), H()

### Community 111 - "lancer_tableau_s"
Cohesion: 0.14
Nodes (4): lancer_tableau_s(), _oublier_les_vieilles(), _reciprocite(), TacheTableauS

### Community 112 - "Serveur web_antenna.py (stdlib seule)"
Cohesion: 0.13
Nodes (14): CI banc d'essai workflow, Banc relai GitHub, Banc principal banc-openems.py, Banc serveur, Solveur openEMS FDTD, Le port et le piege Windows, Choix de l'interpreteur Python, Serveur web_antenna.py (stdlib seule) (+6 more)

### Community 113 - "Les sept etapes de l'assistant"
Cohesion: 0.22
Nodes (9): MSLPort: cout du prolongement, Desembedage ligne d'alimentation, Port microruban MSLPort (experimental), Nettoyage geometrique et masse cachee, Pertes dielectriques: conductivite vs Debye, Port colle sur la grille, Port localise en ligne, Revetements exterieurs (masque) hors maillage (+1 more)

### Community 114 - "index.html page principale"
Cohesion: 0.22
Nodes (9): index.html page principale, Ecran d'accueil: ouvrir, concevoir, exemples, Exemples Patch, IFA, Reseau 3x3, Panneaux detachables (assistant, conception, IA), Scripts js/00..38 charges, three.js vendor, Vues 2D / 3D / maillage superposees, Assistant IA (+1 more)

### Community 115 - "38-tuto.js"
Cohesion: 0.44
Nodes (8): afficher(), avancer(), basculer(), finir(), montrer(), placer(), proposer(), reposer()

### Community 116 - ".mmap"
Cohesion: 0.31
Nodes (7): createLazyFile(), stream_ops, writeChunks(), get_char(), mmap(), position(), read()

### Community 118 - "01-api.js"
Cohesion: 0.50
Nodes (7): apiCandidats(), apiCharger(), apiConnecter(), apiErreur(), apiImporter(), apiLireJson(), moPoids()

### Community 119 - "abort"
Cohesion: 0.25
Nodes (8): abort(), assert(), getBinaryPromise(), getBinarySync(), instantiateArrayBuffer(), instantiateAsync(), lookup_name(), ___syscall_unlinkat()

### Community 120 - "_exiger_libre"
Cohesion: 0.33
Nodes (3): banc_en_cours(), _en_cours(), _exiger_libre()

### Community 122 - "README Antenne openEMS"
Cohesion: 0.21
Nodes (14): A-FAIRE: travaux restants, Correction du gabarit patch (loi L, strates y0), Croisements g x y0 et L x y0, Motifs dipole/monopole/IFA/MIFA mesures, Limites connues triees, MIFA reste ouvert, Adaptation du patch: y0 dominant, Barre d'outils (ouvrir, projet, concevoir, exemples, lancer) (+6 more)

### Community 124 - "17-objets.js"
Cohesion: 0.43
Nodes (6): ANT_FORMES, antChampNb(), antHautCarte(), antObjetFiche(), antObjetNeuf(), antXYZ()

### Community 125 - "postRun"
Cohesion: 0.29
Nodes (7): addOnPostRun(), addOnPreRun(), initRuntime(), postRun(), preRun(), run(), doRun()

### Community 129 - "26-exemple.js"
Cohesion: 0.33
Nodes (4): EX, EX_CAS, EX_IFA, EX_RESEAU

### Community 130 - "27-apercu-motif.js"
Cohesion: 0.53
Nodes (5): APM_COULEURS, apmBoite(), apmPlanche(), apmSVG(), apmVignette()

### Community 131 - "Pieces STEP: boitier et piles"
Cohesion: 0.33
Nodes (6): Licence OpenCascade (LGPL 2.1), Licence occt-import-js, LGPL 2.1, LGPL 2.1 OpenCascade, Pieces STEP: boitier et piles, WEB_3D

### Community 132 - "z"
Cohesion: 0.43
Nodes (8): mt(), J(), B(), F(), N(), W(), X(), z()

### Community 133 - "_ligne_alim"
Cohesion: 0.29
Nodes (4): _ligne_alim(), microruban_eeff(), microruban_z0(), _substrat_entre()

### Community 138 - "parseAsync"
Cohesion: 0.14
Nodes (9): bind(), bindSkeletons(), ll(), parseAnimations(), parseAsync(), parseGeometries(), parseShapes(), parseSkeletons() (+1 more)

### Community 140 - "C"
Cohesion: 0.40
Nodes (3): C, CS, S

### Community 142 - "craftInvokerFunction"
Cohesion: 0.67
Nodes (4): craftInvokerFunction(), createJsInvoker(), newFunc(), usesDestructorStack()

### Community 143 - "getCallstack"
Cohesion: 0.50
Nodes (3): _emscripten_get_callstack(), getCallstack(), jsStackTrace()

### Community 144 - "___syscall_ioctl"
Cohesion: 0.50
Nodes (4): ioctl_tcgets(), ioctl_tcsets(), ioctl_tiocgwinsz(), ___syscall_ioctl()

### Community 148 - "write"
Cohesion: 0.67
Nodes (3): msync(), put_char(), write()

### Community 149 - "registerType"
Cohesion: 0.67
Nodes (3): onComplete(), registerType(), sharedRegisterType()

### Community 150 - "syncfs"
Cohesion: 1.00
Nodes (3): syncfs(), doCallback(), done()

### Community 151 - "syscallGetVarargI"
Cohesion: 0.67
Nodes (3): ___syscall_fcntl64(), ___syscall_openat(), syscallGetVarargI()

### Community 156 - "ht"
Cohesion: 0.20
Nodes (3): ht(), Lt, Rt()

## Knowledge Gaps
- **20 isolated node(s):** `Le port et le piege Windows`, `Choix de l'interpreteur Python`, `CSXCAD`, `h5py`, `numpy` (+15 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1461 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **65 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `t()` connect `.setAttribute` to `banc-interface.js`, `.toJSON`, `Fe`, `parseAsync`, `Mt`, `ln`, `parseObject`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Are the 17 inferred relationships involving `IPC2581Parser` (e.g. with `Arc` and `Component`) actually correct?**
  _`IPC2581Parser` has 17 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Le port et le piege Windows`, `Choix de l'interpreteur Python`, `CSXCAD` to the rest of the system?**
  _20 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `banc-interface.js` be split into smaller, more focused modules?**
  _Cohesion score 0.010309278350515464 - nodes in this community are weakly interconnected._
- **Why does `g()` connect `g` to `.setAttribute`, `banc-interface.js`, `update`, `copy`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Should `occt-import-js.js` be split into smaller, more focused modules?**
  _Cohesion score 0.017699115044247787 - nodes in this community are weakly interconnected._
- **Why does `constructor()` connect `.setAttribute` to `we`, `three.min.js`, `gh`, `Kn`, `copy`, `.removeEventListener`, `en`, `update`, `ln`, `Ze`, `ho`, `rn`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._