# Graph Report - WEB_ANTENNA  (2026-11-06)

## Corpus Check
- 80 files · ~407,534 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 11 file(s) not represented in the graph (top: .css 7, (none) 2, .wasm 1)

## Summary
- 4346 nodes · 9271 edges · 179 communities (123 shown, 56 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 315 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `32c9c7c3`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- banc-interface.js
- three.min.js
- ErreurProjet
- Oi
- 33-pieces.js
- 34-placement.js
- 02-modele.js
- 20-conception.js
- 05-panneaux.js
- projet.py
- zt
- .multiplyScalar
- appairage.py
- openems_modele.py
- openems_champs.py
- _c
- ra
- 28-projet.js
- .setAttribute
- _config_ecrire
- ln
- 13-assistant.js
- yt
- 32-visionneuse.js
- 14-apercu3d.js
- ko
- openems_run.py
- openems_pieces.py
- rn
- ErreurModele
- openems_script.py
- 22-antennes.js
- normaliser
- Ye
- ipc2581_parser.py
- ipc2581_json.py
- 90-workspace.js
- Fe
- 39-campagne.js
- Mt
- Ct
- web_antenna.py
- de
- 16-resultats.js
- 10-etat.js
- pc
- copy
- Ot
- banc-openems.py
- 03-rendu.js
- yh
- IPC2581Parser
- _maillage
- creer
- Nt
- gi
- xh
- ._tag
- .constructor
- ltArc
- Tache
- Pilote
- ._process_polyline
- .toArray
- mdlCheminsDe
- rendreModalNets
- 21-dessin.js
- gh
- telephone.js
- fils
- 29-tableau-s.js
- Kn
- xl
- xt
- pilote.py
- 15-overlay2d.js
- 31-rapport.js
- 37-port-auto.js
- i
- mo
- bi
- 24-balayage.js
- vi
- na
- 04-interaction.js
- tc
- ho
- Go
- Poste
- 11-geometrie.js
- 18-champs.js
- _o
- vl
- _ouvrir_ecarts
- Garde
- 35-fils.js
- sh
- Ze
- banc-polygones.js
- ec
- cc
- ai
- 25-polygones.js
- createWasm
- g
- Eh
- _ponts_couche
- Appairage
- pt
- dispose
- Point
- requirements.txt
- xc
- index.html page principale
- 38-tuto.js
- .mmap
- _masse_cachee
- 01-api.js
- abort
- banc-champs.py
- 2. Les limites connues, et ce qu'on en fait
- README Antenne openEMS
- .add
- 17-objets.js
- postRun
- bh
- _mailler
- nc
- 26-exemple.js
- 27-apercu-motif.js
- Pieces STEP: boitier et piles
- _coupable_cellule
- _SansRun
- _Seau
- qs
- clone
- Lt
- C
- travailleur-occt.js
- craftInvokerFunction
- getCallstack
- ___syscall_ioctl
- we
- _ligne_alim
- write
- registerType
- syncfs
- syscallGetVarargI
- H
- 00-espace-config.js
- close
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
- nr
- A-FAIRE: travaux restants
- dossier_calculs
- Les sept etapes de l'assistant
- Serveur web_antenna.py (stdlib seule)
- 31-cartes-antenna.js

## God Nodes (most connected - your core abstractions)
1. `zt` - 115 edges
2. `yt` - 87 edges
3. `IPC2581Parser` - 83 edges
4. `copy()` - 76 edges
5. `rn` - 64 edges
6. `Ct` - 61 edges
7. `Fe` - 59 edges
8. `creer()` - 58 edges
9. `qs` - 57 edges
10. `Poste` - 55 edges

## Surprising Connections (you probably didn't know these)
- `Campagne du 22/10/2026 — ce que les six plans ont tranché` --references--> `wr()`  [INFERRED]
  HISTORIQUE.md → js/vendor/three.min.js
- `La correction du gabarit — quatre cas mesurés, une loi pour L, deux strates pour y₀` --references--> `patchCorrLongueur()`  [INFERRED]
  HISTORIQUE.md → js/22-antennes.js
- `Plans de mesure — arrêtés le 21/10/2026` --references--> `wr()`  [INFERRED]
  HISTORIQUE.md → js/vendor/three.min.js
- `Ce qui est déjà en travaux, plus haut` --references--> `patchCorrRbord()`  [INFERRED]
  HISTORIQUE.md → js/22-antennes.js
- `La correction du gabarit — quatre cas mesurés, une loi pour L, deux strates pour y₀` --references--> `patchCorrRbord()`  [INFERRED]
  HISTORIQUE.md → js/22-antennes.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Reglage mesure du patch** — a_faire_patch_adaptation, a_faire_croisement_g_y0, a_faire_correction_gabarit [EXTRACTED 0.95]
- **Pipeline de simulation en sept etapes** — readme_sept_etapes, readme_nettoyage_geometrique, readme_pertes_debye, readme_revetements_exterieurs, readme_port_localise [INFERRED 0.85]

## Communities (179 total, 56 thin omitted)

### Community 0 - "banc-interface.js"
Cohesion: 0.01
Nodes (154): AJOUT7, avantMasque, ax9, BAL3, BAL9, barre, barre2, barre3 (+146 more)

### Community 2 - "three.min.js"
Cohesion: 0.04
Nodes (40): Ar(), as(), y(), br(), Cr(), cs(), ds(), er() (+32 more)

### Community 3 - "ErreurProjet"
Cohesion: 0.13
Nodes (11): _dossier(), _ecrire_json(), enregistrer(), ErreurProjet, etat(), liste(), ouvert(), ouvrir_explorateur() (+3 more)

### Community 4 - "Oi"
Cohesion: 0.20
Nodes (3): ki(), Oi, Wn

### Community 5 - "33-pieces.js"
Cohesion: 0.07
Nodes (70): ANT_CARTE_PIECE, ANT_DEVINE, ANT_FORMATS_3D, ANT_MATIERES, ANT_OCCT_FILE, ANT_OCCT_PARAMS, ANT_PIECES_ARETES, ANT_PIECES_TAB (+62 more)

### Community 6 - "34-placement.js"
Cohesion: 0.08
Nodes (69): antCarte3d(), antPlaceAccrocher(), antPlaceAnnuler(), antPlaceApres(), antPlaceAvantRendu(), antPlaceBarre(), antPlaceCadrer(), antPlaceChoisir() (+61 more)

### Community 7 - "02-modele.js"
Cohesion: 0.08
Nodes (40): CU_PALETTE, GENRE_COULEUR, LT, ltAire(), ltAutoRole(), ltCleGap(), ltEstPlan(), ltPreparer() (+32 more)

### Community 8 - "20-conception.js"
Cohesion: 0.07
Nodes (64): CON, CON_CONDUCTEURS, CON_DIELECTRIQUES, CON_EP_CUIVRE, CON_GENRES, CON_HIST, CON_MODELES, CON_SORTES (+56 more)

### Community 9 - "05-panneaux.js"
Cohesion: 0.11
Nodes (40): mdlCoucheNom(), mdlEsc(), BOUTON_AFF, ELEMENTS, fermerModalNets(), l3(), LT_TOPO, ltC() (+32 more)

### Community 10 - "projet.py"
Cohesion: 0.13
Nodes (13): calculs(), dossier_calculs(), _entrees_calcul(), importer_calcul(), lire(), _lire_json(), _mtime(), ouvrir() (+5 more)

### Community 12 - ".multiplyScalar"
Cohesion: 0.07
Nodes (4): S(), No, ue, Vc

### Community 13 - "appairage.py"
Cohesion: 0.08
Nodes (21): _a_refaire(), adresses_poste(), appairer(), _ca_a_refaire(), _cnf(), contexte_tls(), dossier_tls(), empreinte_ca() (+13 more)

### Community 14 - "openems_modele.py"
Cohesion: 0.06
Nodes (21): _avis(), _avis_coax_contacts(), _avis_ecarts_ouverts(), _avis_ponts_de_maille(), _avis_ports_court_circuit(), _cause_cellule(), _coax_z0(), _cuivre_sous() (+13 more)

### Community 15 - "openems_champs.py"
Cohesion: 0.09
Nodes (18): _amplitude_max(), _axe_par_defaut(), _champ_de(), _decouper(), entete_vtr(), ErreurChamps, _etiquette(), _hertz() (+10 more)

### Community 17 - "ra"
Cohesion: 0.08
Nodes (6): jh(), Nh, ra, setFromCamera(), update(), Zi()

### Community 18 - "28-projet.js"
Cohesion: 0.10
Nodes (50): PRJ, prjAccueilRendre(), prjAffichage(), prjAntAppliquer(), prjAntenne(), prjAppel(), prjAppliquer(), prjArchivable() (+42 more)

### Community 19 - ".setAttribute"
Cohesion: 0.07
Nodes (14): co, constructor(), el(), t(), Ga, v(), _l, m() (+6 more)

### Community 20 - "_config_ecrire"
Cohesion: 0.16
Nodes (10): banc_lu(), banc_noter(), _config_ecrire(), _config_lire(), debit_fils_lu(), debit_lu(), debit_noter(), definir_racine() (+2 more)

### Community 21 - "ln"
Cohesion: 0.05
Nodes (9): cn, dn, fn, gn, hn, ln, mn, pn (+1 more)

### Community 22 - "13-assistant.js"
Cohesion: 0.11
Nodes (43): aE(), aEnt(), aEsc(), aF(), aL(), aNb(), ANT_AUTO, ANT_CAUSES (+35 more)

### Community 24 - "32-visionneuse.js"
Cohesion: 0.11
Nodes (45): CHP, CHP_LUT, CHP_MG, CHP_NOMS, CHP_PALETTES, chpAccueil(), chpArret(), chpAxes() (+37 more)

### Community 25 - "14-apercu3d.js"
Cohesion: 0.10
Nodes (44): ANT3D, ANT3D_MAILLE, ANT3D_MAILLE_PLANS, ANT3D_NAV, ant3dAnimer(), ant3dBoites(), ant3dCadrer(), ant3dClef() (+36 more)

### Community 26 - "ko"
Cohesion: 0.08
Nodes (16): al(), cl(), dl(), il(), jo(), ko, nl(), qo() (+8 more)

### Community 27 - "openems_run.py"
Cohesion: 0.06
Nodes (27): liste(), banc_en_cours(), _base_calculs(), _base_temporaire(), dossier_de(), _dossier_neuf(), dossier_openems(), _en_cours() (+19 more)

### Community 28 - "openems_pieces.py"
Cohesion: 0.08
Nodes (23): _analyser(), _bords(), corps_inclus(), emprises(), ErreurPiece, _matrice(), _nb(), pieces() (+15 more)

### Community 29 - "rn"
Cohesion: 0.05
Nodes (8): dt(), nn(), rn, $s, ta, tn(), ut(), Wc

### Community 30 - "ErreurModele"
Cohesion: 0.07
Nodes (26): archiver_calcul(), arreter(), balayage(), champ(), champs(), _champs_module(), dossier(), identifiant_neuf() (+18 more)

### Community 31 - "openems_script.py"
Cohesion: 0.08
Nodes (21): faces_b64(), _bloc_calcport(), _bloc_debye(), _bloc_dumps(), _bloc_fils(), _bloc_ligne(), _bloc_pieces(), _bloc_ports() (+13 more)

### Community 32 - "22-antennes.js"
Cohesion: 0.06
Nodes (75): CON_GABARITS, CON_MOTIF_DIPOLE, CON_MOTIF_IFA, CON_MOTIF_LIGNE, CON_MOTIF_MIFA, CON_MOTIF_MONOPOLE, CON_MOTIF_PATCH, CON_MOTIF_RESEAU (+67 more)

### Community 33 - "normaliser"
Cohesion: 0.10
Nodes (25): balayage(), _bande(), _boite(), _carte(), _conducteur(), _cuivre(), _dict(), _dumps() (+17 more)

### Community 35 - "ipc2581_parser.py"
Cohesion: 0.07
Nodes (15): Arc, Component, Contour, CopperPlane, Drill, IPCDesign, Net, Package (+7 more)

### Community 36 - "ipc2581_json.py"
Cohesion: 0.07
Nodes (15): charger_octets(), _contour(), _contre_percage(), design_en_dict(), _Flux, _forme_en_dict(), _Index, ipc2581_en_dict() (+7 more)

### Community 37 - "90-workspace.js"
Cohesion: 0.14
Nodes (38): WS, WS_DOCKS, wsApply(), wsCanvasSync(), wsClose(), wsDefault(), wsDrag, wsEl (+30 more)

### Community 39 - "39-campagne.js"
Cohesion: 0.18
Nodes (20): CAMP, CAMP_BASE, CAMP_CHAMPS, CAMP_PLANS, campArreter(), campChiffrer(), campDerouler(), campDocument() (+12 more)

### Community 40 - "Mt"
Cohesion: 0.12
Nodes (28): Is(), ks(), j(), k(), U(), W(), mt(), J() (+20 more)

### Community 42 - "web_antenna.py"
Cohesion: 0.07
Nodes (13): banc_au_demarrage(), ip_reseau(), _ipv4_libre(), _lisible(), main(), ouvrir_socket(), _pourquoi(), redemarrer_application() (+5 more)

### Community 43 - "de"
Cohesion: 0.06
Nodes (6): bs(), de, en(), ws(), zs(), n()

### Community 44 - "16-resultats.js"
Cohesion: 0.14
Nodes (34): ANT_BAL_TIRETS, ANT_COURBE_ETAT, ANT_ONGLETS, antBal(), antBalAxes(), antBalCouleur(), antBalCouleurDe(), antBalDessiner() (+26 more)

### Community 45 - "10-etat.js"
Cohesion: 0.09
Nodes (25): ANT, ANT_ETAPES, ANT_UNITES_F, antAjouterFormes(), antDevinerCouches(), antDevinerMasse(), antDocument(), antEmpilage() (+17 more)

### Community 46 - "pc"
Cohesion: 0.15
Nodes (3): mc, pc, rc

### Community 47 - "copy"
Cohesion: 0.07
Nodes (7): _a(), ci, copy(), ie, jn(), ro(), wa

### Community 48 - "Ot"
Cohesion: 0.09
Nodes (3): Kt(), Ot, Ht()

### Community 49 - "banc-openems.py"
Cohesion: 0.08
Nodes (17): balaye(), _coque(), _court(), croise(), document(), _pastille_dans_reserve(), _pastille_decalee(), _pave() (+9 more)

### Community 50 - "03-rendu.js"
Cohesion: 0.09
Nodes (45): bcx(), CACHE, centrerSur(), ctx, cv, dansFenetre(), dessiner(), fenetre() (+37 more)

### Community 53 - "_maillage"
Cohesion: 0.08
Nodes (15): _bande_lignes(), _coller(), _coller_ports(), _emprise_primitive(), _fusionner(), _grouper(), _lignes(), _lisser() (+7 more)

### Community 54 - "creer"
Cohesion: 0.08
Nodes (58): creer(), afficher(), ajouter(), annoncer(), annuler(), appliquer(), base64(), battre() (+50 more)

### Community 56 - "gi"
Cohesion: 0.12
Nodes (9): di, gi(), p(), ni, qn, ti, Xn(), yn (+1 more)

### Community 59 - ".constructor"
Cohesion: 0.12
Nodes (7): ea, C(), D(), C(), N(), xs(), ys()

### Community 60 - "ltArc"
Cohesion: 0.27
Nodes (12): ltArc(), ltEeff(), ltEntre(), ltGeom(), ltNet(), ajouterMorceau(), ltPiste(), ltWeff() (+4 more)

### Community 61 - "Tache"
Cohesion: 0.06
Nodes (9): _chiffre(), interprete(), lancer_balayage(), _ordonnee(), _pente(), _resume(), Tache, TacheBalayage (+1 more)

### Community 62 - "Pilote"
Cohesion: 0.07
Nodes (26): oeAppel(), oeArreter(), oeBalayage(), oeBase(), oeDocBalayage(), oeErreur(), oeEtat(), oeLancer() (+18 more)

### Community 64 - ".toArray"
Cohesion: 0.08
Nodes (8): ao, ei, lo, oo, Qh, Lt(), rr, so

### Community 65 - "mdlCheminsDe"
Cohesion: 0.25
Nodes (11): mdlArc(), mdlCheminPlan(), mdlChemins(), mdlCheminsDe(), mdlCheminsNet(), mdlForme(), mdlPadDans(), mdlPlansDans() (+3 more)

### Community 66 - "rendreModalNets"
Cohesion: 0.57
Nodes (7): mettreAJourApercuPrereglages(), mettreAJourBoutonsFiltreModale(), mettreAJourKpiModaleNets(), ouvrirModalNets(), reinitialiserAutoDetectionModaleNets(), rendreModalNets(), toutSignalModaleNets()

### Community 67 - "21-dessin.js"
Cohesion: 0.13
Nodes (14): CON_GRILLE_CHEMIN, CON_MULTIPLES, CON_OUTILS, conGrilleChemin(), conNouvelle(), conPeindreChoisie(), conPeindreCourant(), conPeindreDecoupes() (+6 more)

### Community 69 - "telephone.js"
Cohesion: 0.38
Nodes (9): appliquer(), construire(), mesurer(), ouvrir(), panneaux(), redimensionner(), remplir(), rendre() (+1 more)

### Community 70 - "fils"
Cohesion: 0.06
Nodes (22): banc_noter(), debit(), debit_noter(), etat(), fils(), regler_fils(), banc(), _banc_a() (+14 more)

### Community 71 - "29-tableau-s.js"
Cohesion: 0.17
Nodes (16): antExportSnp(), antTableauSHtml(), antTs(), antTsCase(), antTsColonne(), antTsComplet(), antTsCouleur(), antTsDb() (+8 more)

### Community 73 - "xl"
Cohesion: 0.13
Nodes (3): jl, Kl, xl

### Community 74 - "xt"
Cohesion: 0.06
Nodes (4): be, _i(), h(), xt

### Community 75 - "pilote.py"
Cohesion: 0.08
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

### Community 79 - "i"
Cohesion: 0.12
Nodes (21): c(), l(), o(), o(), hi(), r(), lc, load() (+13 more)

### Community 80 - "mo"
Cohesion: 0.14
Nodes (5): gl(), ml, mo, po, l()

### Community 82 - "24-balayage.js"
Cohesion: 0.28
Nodes (15): antBalayageHtml(), antBalayageLier(), antBalayageSpec(), antBalDuree(), balCombien(), balDiff(), balDocumentPour(), balEtiquette() (+7 more)

### Community 83 - "vi"
Cohesion: 0.15
Nodes (15): v(), d(), u(), y(), x(), ji(), R(), h() (+7 more)

### Community 84 - "na"
Cohesion: 0.12
Nodes (6): bt(), Ca, ht(), na, ui(), i()

### Community 85 - "04-interaction.js"
Cohesion: 0.18
Nodes (10): boitePiste(), choisirComp(), choisirRien(), couchesDesignation(), designer(), distSegment(), fin(), POINTEURS (+2 more)

### Community 87 - "ho"
Cohesion: 0.10
Nodes (5): r(), ho, ll(), Mh, uo

### Community 89 - "Poste"
Cohesion: 0.05
Nodes (3): adresse_lanceur(), Poste, Refus

### Community 90 - "11-geometrie.js"
Cohesion: 0.26
Nodes (15): ANT_CUIVRE_CACHE, antArcEnPolyligne(), antCercle(), antCoucheCochee(), antCuivreCalcul(), antCuivreDuModele(), antEmpriseCuivre(), antFormePoints() (+7 more)

### Community 91 - "18-champs.js"
Cohesion: 0.19
Nodes (13): ANT_CALC, ANT_CHAMPS, ANT_REGIONS, antCalcCharger(), antCalcDate(), antCalcHtml(), antCalcLier(), antCalcLigneHtml() (+5 more)

### Community 92 - "_o"
Cohesion: 0.07
Nodes (5): bo, Do, Fo, io, _o

### Community 93 - "vl"
Cohesion: 0.14
Nodes (3): ql, vl, wl

### Community 94 - "_ouvrir_ecarts"
Cohesion: 0.16
Nodes (10): _couper_arete(), _elargir_cellules(), connu(), sain(), soudes(), _inserer(), _lignes_au_tiers(), _meilleures_coupes() (+2 more)

### Community 95 - "Garde"
Cohesion: 0.10
Nodes (6): brancher_tls(), en_https(), filtrer_tls(), Garde, _html(), Visites

### Community 96 - "35-fils.js"
Cohesion: 0.35
Nodes (14): ANT_FILS, antFilsBanc(), antFilsEnCours(), antFilsEtat(), antFilsHtml(), antFilsLier(), antFilsMeilleur(), antFilsMesures() (+6 more)

### Community 98 - "Ze"
Cohesion: 0.05
Nodes (13): bl, fl(), hl(), hs(), Ka, ol(), pl(), sa (+5 more)

### Community 99 - "banc-polygones.js"
Cohesion: 0.15
Nodes (10): aire(), aireTotale(), disque, fs, ko, L, r, src (+2 more)

### Community 101 - "cc"
Cohesion: 0.07
Nodes (12): ac, cc, dc, ft(), hc, kc, Pa, parseImages() (+4 more)

### Community 102 - "ai"
Cohesion: 0.06
Nodes (3): ai, getOutput(), rh

### Community 103 - "25-polygones.js"
Cohesion: 0.30
Nodes (10): polyAire(), polyCompte(), polyCroise(), polyDedans(), polyInserer(), polyIntersection(), polyListe(), polyPlat() (+2 more)

### Community 104 - "createWasm"
Cohesion: 0.20
Nodes (12): addOnInit(), addRunDependency(), createWasm(), receiveInstance(), receiveInstantiationResult(), findWasmBinary(), getWasmImports(), locateFile() (+4 more)

### Community 105 - "g"
Cohesion: 0.21
Nodes (12): 1. Ce qui manque, et qui se voit à l'usage, Campagne du 22/10/2026 — ce que les six plans ont tranché, Ce qui est déjà en travaux, plus haut, L'adaptation du patch — la mesure a tranché, et ce n'est pas ce qu'on croyait, La correction du gabarit — quatre cas mesurés, une loi pour L, deux strates pour y₀, Le port microruban désembedé (`AddMSLPort`) — le prix, désormais chiffré, Les cartes d'action et l'audit — ce qu'il leur manque, Plans de mesure — arrêtés le 21/10/2026 (+4 more)

### Community 106 - "Eh"
Cohesion: 0.08
Nodes (3): Eh, Ls(), updateMatrixWorld()

### Community 107 - "_ponts_couche"
Cohesion: 0.21
Nodes (6): _couper_seg(), _ponts_couche(), dedans(), dist(), _proches_seg_seg(), _proj_point_seg()

### Community 110 - "dispose"
Cohesion: 0.11
Nodes (10): dispose(), s(), It, a(), Et(), Ut(), rt, G() (+2 more)

### Community 111 - "Point"
Cohesion: 0.19
Nodes (3): Point, UserShape, arc()

### Community 112 - "requirements.txt"
Cohesion: 0.29
Nodes (6): Solveur openEMS FDTD, CSXCAD, h5py, numpy, openEMS bindings, Python 3.10/3.11 requis (roues Windows)

### Community 114 - "index.html page principale"
Cohesion: 0.22
Nodes (9): index.html page principale, Ecran d'accueil: ouvrir, concevoir, exemples, Exemples Patch, IFA, Reseau 3x3, Panneaux detachables (assistant, conception, IA), Scripts js/00..38 charges, three.js vendor, Vues 2D / 3D / maillage superposees, Assistant IA (+1 more)

### Community 115 - "38-tuto.js"
Cohesion: 0.44
Nodes (8): afficher(), avancer(), basculer(), finir(), montrer(), placer(), proposer(), reposer()

### Community 116 - ".mmap"
Cohesion: 0.31
Nodes (7): createLazyFile(), stream_ops, writeChunks(), get_char(), mmap(), position(), read()

### Community 117 - "_masse_cachee"
Cohesion: 0.15
Nodes (6): _absorber_contenus(), _aire(), _boite_pts(), _masse_cachee(), _sens(), _Surface

### Community 118 - "01-api.js"
Cohesion: 0.42
Nodes (8): apiCandidats(), apiCharger(), apiConnecter(), apiErreur(), apiImporter(), apiLireJson(), ENTETE_WEB, moPoids()

### Community 119 - "abort"
Cohesion: 0.25
Nodes (8): abort(), assert(), getBinaryPromise(), getBinarySync(), instantiateArrayBuffer(), instantiateAsync(), lookup_name(), ___syscall_unlinkat()

### Community 120 - "banc-champs.py"
Cohesion: 0.17
Nodes (8): _b64(), _base64_octets(), _bloc_binaire(), _tableau(), _b64(), _decoder(), _binaire(), ecrire_vtr()

### Community 121 - "2. Les limites connues, et ce qu'on en fait"
Cohesion: 0.40
Nodes (4): 2. Les limites connues, et ce qu'on en fait, Ce qui est une limite du monde, pas de l'outil, Ce qui ne se rouvre pas, Historique — le carnet de mesures et de travaux (jusqu'au 22/10/2026)

### Community 122 - "README Antenne openEMS"
Cohesion: 0.43
Nodes (7): Barre d'outils (ouvrir, projet, concevoir, exemples, lancer), README Antenne openEMS, Classification des nets GND/PWR/Signal, Import IPC-2581, Mode conception, Projets sur disque, Visionneuse de champs

### Community 123 - ".add"
Cohesion: 0.08
Nodes (16): bind(), bindSkeletons(), getValue(), Ha, Ic, parse(), parseAnimations(), parseAsync() (+8 more)

### Community 124 - "17-objets.js"
Cohesion: 0.43
Nodes (6): ANT_FORMES, antChampNb(), antHautCarte(), antObjetFiche(), antObjetNeuf(), antXYZ()

### Community 125 - "postRun"
Cohesion: 0.29
Nodes (7): addOnPostRun(), addOnPreRun(), initRuntime(), postRun(), preRun(), run(), doRun()

### Community 127 - "_mailler"
Cohesion: 0.14
Nodes (7): _bandes_fines(), _bilan_pistes(), _cout(), _dans(), _lignes_bandes(), _mailler(), _souder()

### Community 129 - "26-exemple.js"
Cohesion: 0.33
Nodes (4): EX, EX_CAS, EX_IFA, EX_RESEAU

### Community 130 - "27-apercu-motif.js"
Cohesion: 0.53
Nodes (5): APM_COULEURS, apmBoite(), apmPlanche(), apmSVG(), apmVignette()

### Community 131 - "Pieces STEP: boitier et piles"
Cohesion: 0.33
Nodes (6): Licence OpenCascade (LGPL 2.1), Licence occt-import-js, LGPL 2.1, LGPL 2.1 OpenCascade, Pieces STEP: boitier et piles, WEB_3D

### Community 135 - "_Seau"
Cohesion: 0.20
Nodes (5): _divise(), _pas_local(), pas(), ranger(), _Seau

### Community 137 - "qs"
Cohesion: 0.14
Nodes (11): Et, M(), o(), qs, Bt(), Ft(), Nt(), Ot() (+3 more)

### Community 138 - "clone"
Cohesion: 0.17
Nodes (4): clone(), gs(), A(), yc

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

### Community 146 - "_ligne_alim"
Cohesion: 0.29
Nodes (4): _ligne_alim(), microruban_eeff(), microruban_z0(), _substrat_entre()

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

### Community 171 - "nr"
Cohesion: 0.25
Nodes (4): nr(), setValue(), tr(), zh()

### Community 174 - "A-FAIRE: travaux restants"
Cohesion: 0.33
Nodes (7): A-FAIRE: travaux restants, Correction du gabarit patch (loi L, strates y0), Croisements g x y0 et L x y0, Motifs dipole/monopole/IFA/MIFA mesures, Limites connues triees, MIFA reste ouvert, Adaptation du patch: y0 dominant

### Community 179 - "Les sept etapes de l'assistant"
Cohesion: 0.22
Nodes (9): MSLPort: cout du prolongement, Desembedage ligne d'alimentation, Port microruban MSLPort (experimental), Nettoyage geometrique et masse cachee, Pertes dielectriques: conductivite vs Debye, Port colle sur la grille, Port localise en ligne, Revetements exterieurs (masque) hors maillage (+1 more)

### Community 181 - "Serveur web_antenna.py (stdlib seule)"
Cohesion: 0.25
Nodes (8): CI banc d'essai workflow, Banc relai GitHub, Banc principal banc-openems.py, Banc serveur, Le port et le piege Windows, Choix de l'interpreteur Python, Serveur web_antenna.py (stdlib seule), WEB_SUITE lanceur

## Knowledge Gaps
- **20 isolated node(s):** `CSXCAD`, `h5py`, `numpy`, `Python 3.10/3.11 requis (roues Windows)`, `Nettoyage geometrique et masse cachee` (+15 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1480 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **56 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `t()` connect `.setAttribute` to `banc-interface.js`, `Mt`, `zt`, `i`, `ln`, `ho`, `.add`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Are the 17 inferred relationships involving `IPC2581Parser` (e.g. with `Arc` and `Component`) actually correct?**
  _`IPC2581Parser` has 17 INFERRED edges - model-reasoned connections that need verification._
- **What connects `CSXCAD`, `h5py`, `numpy` to the rest of the system?**
  _20 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `banc-interface.js` be split into smaller, more focused modules?**
  _Cohesion score 0.010638297872340425 - nodes in this community are weakly interconnected._
- **Why does `g()` connect `g` to `.setAttribute`, `banc-interface.js`, `clone`, `vi`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Should `occt-import-js.js` be split into smaller, more focused modules?**
  _Cohesion score 0.017699115044247787 - nodes in this community are weakly interconnected._
- **Why does `antMatiereDevinee()` connect `33-pieces.js` to `banc-interface.js`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._