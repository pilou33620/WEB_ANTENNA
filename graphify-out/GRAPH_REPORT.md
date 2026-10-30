# Graph Report - WEB_ANTENNA  (2026-10-30)

## Corpus Check
- 80 files · ~409,868 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 11 file(s) not represented in the graph (top: .css 7, (none) 2, .wasm 1)

## Summary
- 4323 nodes · 9193 edges · 170 communities (107 shown, 63 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 313 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7a292016`
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
- Ye
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
- Mt
- Ct
- web_antenna.py
- qs
- 16-resultats.js
- 10-etat.js
- pc
- .applyMatrix4
- Ot
- banc-openems.py
- 03-rendu.js
- yh
- IPC2581Parser
- _maillage
- creer
- Nt
- clone
- xh
- ._tag
- .constructor
- pilote.py
- Tache
- Pilote
- Element
- Ha
- cc
- 21-dessin.js
- gh
- telephone.js
- fils
- 29-tableau-s.js
- Kn
- xl
- xt
- os
- 15-overlay2d.js
- 31-rapport.js
- 37-port-auto.js
- banc-champs.py
- mo
- bi
- 24-balayage.js
- vi
- .setHSL
- 04-interaction.js
- 12-api-openems.js
- na
- Go
- 11-geometrie.js
- 18-champs.js
- _o
- vl
- _ouvrir_ecarts
- Garde
- 35-fils.js
- sh
- xc
- banc-polygones.js
- ec
- i
- dispose
- 25-polygones.js
- createWasm
- 1. Ce qui manque, et qui se voit à l'usage
- Eh
- _ponts_couche
- Appairage
- pt
- rt
- $s
- Serveur web_antenna.py (stdlib seule)
- Les sept etapes de l'assistant
- index.html page principale
- 38-tuto.js
- .mmap
- ta
- 01-api.js
- abort
- cn
- README Antenne openEMS
- dn
- 17-objets.js
- postRun
- bh
- fn
- gn
- 26-exemple.js
- 27-apercu-motif.js
- Pieces STEP: boitier et piles
- hn
- mn
- pn
- un
- yn
- ho
- IPCDesign
- C
- travailleur-occt.js
- craftInvokerFunction
- getCallstack
- ___syscall_ioctl
- Drill
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

## God Nodes (most connected - your core abstractions)
1. `zt` - 115 edges
2. `yt` - 87 edges
3. `copy()` - 76 edges
4. `IPC2581Parser` - 72 edges
5. `rn` - 64 edges
6. `Ct` - 61 edges
7. `Fe` - 59 edges
8. `creer()` - 58 edges
9. `qs` - 57 edges
10. `Poste` - 53 edges

## Surprising Connections (you probably didn't know these)
- `Campagne du 22/10/2026 — ce que les six plans ont tranché` --references--> `wr()`  [INFERRED]
  HISTORIQUE.md → js/vendor/three.min.js
- `La correction du gabarit — quatre cas mesurés, une loi pour L, deux strates pour y₀` --references--> `patchCorrLongueur()`  [INFERRED]
  HISTORIQUE.md → js/22-antennes.js
- `L'adaptation du patch — la mesure a tranché, et ce n'est pas ce qu'on croyait` --references--> `g()`  [INFERRED]
  HISTORIQUE.md → js/vendor/three.min.js
- `La correction du gabarit — quatre cas mesurés, une loi pour L, deux strates pour y₀` --references--> `g()`  [INFERRED]
  HISTORIQUE.md → js/vendor/three.min.js
- `Plans de mesure — arrêtés le 21/10/2026` --references--> `wr()`  [INFERRED]
  HISTORIQUE.md → js/vendor/three.min.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Reglage mesure du patch** — a_faire_patch_adaptation, a_faire_croisement_g_y0, a_faire_correction_gabarit [EXTRACTED 0.95]
- **Pipeline de simulation en sept etapes** — readme_sept_etapes, readme_nettoyage_geometrique, readme_pertes_debye, readme_revetements_exterieurs, readme_port_localise [INFERRED 0.85]

## Communities (170 total, 63 thin omitted)

### Community 0 - "banc-interface.js"
Cohesion: 0.01
Nodes (161): AJOUT7, avantMasque, ax9, BAL3, BAL9, barre, barre2, barre3 (+153 more)

### Community 2 - "three.min.js"
Cohesion: 0.04
Nodes (47): Ar(), as(), br(), Cr(), cs(), ds(), er(), es() (+39 more)

### Community 3 - "Poste"
Cohesion: 0.06
Nodes (3): adresse_lanceur(), Poste, Refus

### Community 4 - "Oi"
Cohesion: 0.22
Nodes (3): ki(), Oi, xi()

### Community 5 - "33-pieces.js"
Cohesion: 0.07
Nodes (70): ANT_CARTE_PIECE, ANT_DEVINE, ANT_FORMATS_3D, ANT_MATIERES, ANT_OCCT_FILE, ANT_OCCT_PARAMS, ANT_PIECES_ARETES, ANT_PIECES_TAB (+62 more)

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
Cohesion: 0.10
Nodes (47): mdlCoucheNom(), mdlEsc(), BOUTON_AFF, ELEMENTS, fermerModalNets(), l3(), LT_TOPO, ltC() (+39 more)

### Community 10 - "projet.py"
Cohesion: 0.06
Nodes (33): banc_lu(), banc_noter(), calculs(), _config_ecrire(), _config_lire(), debit_fils_lu(), debit_lu(), debit_noter() (+25 more)

### Community 12 - "copy"
Cohesion: 0.06
Nodes (9): ai, bs(), copy(), S(), setFromCamera(), ue, A(), zs() (+1 more)

### Community 13 - "appairage.py"
Cohesion: 0.09
Nodes (20): _a_refaire(), adresses_poste(), appairer(), _ca_a_refaire(), _cnf(), contexte_tls(), dossier_tls(), empreinte_ca() (+12 more)

### Community 14 - "openems_modele.py"
Cohesion: 0.04
Nodes (29): _absorber_contenus(), _aire(), _avis(), _avis_coax_contacts(), _avis_ecarts_ouverts(), _avis_ponts_de_maille(), _avis_ports_court_circuit(), _boite_pts() (+21 more)

### Community 15 - "openems_champs.py"
Cohesion: 0.09
Nodes (18): _amplitude_max(), _axe_par_defaut(), _champ_de(), _decouper(), entete_vtr(), ErreurChamps, _etiquette(), _hertz() (+10 more)

### Community 17 - "en"
Cohesion: 0.06
Nodes (7): en(), jh(), Nh, nr(), ra, tr(), update()

### Community 18 - "28-projet.js"
Cohesion: 0.10
Nodes (50): PRJ, prjAccueilRendre(), prjAffichage(), prjAntAppliquer(), prjAntenne(), prjAppel(), prjAppliquer(), prjArchivable() (+42 more)

### Community 19 - ".setAttribute"
Cohesion: 0.08
Nodes (20): v(), bt(), co, constructor(), di, el(), t(), Ga (+12 more)

### Community 20 - "Ye"
Cohesion: 0.09
Nodes (4): getOutput(), rh, ut(), Ye

### Community 22 - "13-assistant.js"
Cohesion: 0.11
Nodes (43): aE(), aEnt(), aEsc(), aF(), aL(), aNb(), ANT_AUTO, ANT_CAUSES (+35 more)

### Community 24 - "32-visionneuse.js"
Cohesion: 0.11
Nodes (45): CHP, CHP_LUT, CHP_MG, CHP_NOMS, CHP_PALETTES, chpAccueil(), chpArret(), chpAxes() (+37 more)

### Community 25 - "14-apercu3d.js"
Cohesion: 0.10
Nodes (44): ANT3D, ANT3D_MAILLE, ANT3D_MAILLE_PLANS, ANT3D_NAV, ant3dAnimer(), ant3dBoites(), ant3dCadrer(), ant3dClef() (+36 more)

### Community 26 - "Ze"
Cohesion: 0.04
Nodes (24): al(), bl, cl(), dl(), hl(), il(), jo(), Ka (+16 more)

### Community 27 - "openems_run.py"
Cohesion: 0.04
Nodes (33): archiver(), banc_en_cours(), _base_calculs(), _base_temporaire(), _chiffre(), dossier_de(), _dossier_de(), _dossier_neuf() (+25 more)

### Community 28 - "openems_pieces.py"
Cohesion: 0.09
Nodes (21): _analyser(), _bords(), corps_inclus(), emprises(), ErreurPiece, _matrice(), _nb(), pieces() (+13 more)

### Community 29 - "rn"
Cohesion: 0.09
Nodes (3): nn(), rn, Wc

### Community 30 - "ErreurModele"
Cohesion: 0.06
Nodes (28): archiver_calcul(), arreter(), balayage(), champ(), champs(), _champs_module(), dossier(), dossier_calculs() (+20 more)

### Community 31 - "openems_script.py"
Cohesion: 0.08
Nodes (21): faces_b64(), _bloc_calcport(), _bloc_debye(), _bloc_dumps(), _bloc_fils(), _bloc_ligne(), _bloc_pieces(), _bloc_ports() (+13 more)

### Community 32 - "23-panneau-conception.js"
Cohesion: 0.13
Nodes (41): CON_DEC_F, CON_ROLES_CU, CON_UNITES, conAff(), conApercuBloc(), conApercuLier(), conApercuMaj(), conBarreRendre() (+33 more)

### Community 33 - "normaliser"
Cohesion: 0.09
Nodes (28): balayage(), _bande(), _boite(), _carte(), _conducteur(), _cuivre(), _dict(), _dumps() (+20 more)

### Community 34 - "22-antennes.js"
Cohesion: 0.09
Nodes (34): CON_GABARITS, CON_MOTIF_DIPOLE, CON_MOTIF_IFA, CON_MOTIF_LIGNE, CON_MOTIF_MIFA, CON_MOTIF_MONOPOLE, CON_MOTIF_PATCH, CON_MOTIF_RESEAU (+26 more)

### Community 35 - "ipc2581_parser.py"
Cohesion: 0.10
Nodes (12): Arc, Component, CopperPlane, Net, Package, PadDef, PadInstance, Pin (+4 more)

### Community 36 - "ipc2581_json.py"
Cohesion: 0.07
Nodes (15): charger_octets(), _contour(), _contre_percage(), design_en_dict(), _Flux, _forme_en_dict(), _Index, ipc2581_en_dict() (+7 more)

### Community 37 - "90-workspace.js"
Cohesion: 0.14
Nodes (38): WS, WS_DOCKS, wsApply(), wsCanvasSync(), wsClose(), wsDefault(), wsDrag, wsEl (+30 more)

### Community 38 - "Fe"
Cohesion: 0.05
Nodes (11): Ca, ea, Fe, getInput(), gi(), mc, parseObject(), qn (+3 more)

### Community 39 - "39-campagne.js"
Cohesion: 0.18
Nodes (20): CAMP, CAMP_BASE, CAMP_CHAMPS, CAMP_PLANS, campArreter(), campChiffrer(), campDerouler(), campDocument() (+12 more)

### Community 40 - "Mt"
Cohesion: 0.08
Nodes (33): Is(), ks(), j(), k(), O(), U(), W(), Mi() (+25 more)

### Community 42 - "web_antenna.py"
Cohesion: 0.07
Nodes (13): banc_au_demarrage(), ip_reseau(), _ipv4_libre(), _lisible(), main(), ouvrir_socket(), _pourquoi(), redemarrer_application() (+5 more)

### Community 43 - "qs"
Cohesion: 0.05
Nodes (13): y(), de, M(), C(), D(), qs, Bt(), Ft() (+5 more)

### Community 44 - "16-resultats.js"
Cohesion: 0.14
Nodes (34): ANT_BAL_TIRETS, ANT_COURBE_ETAT, ANT_ONGLETS, antBal(), antBalAxes(), antBalCouleur(), antBalCouleurDe(), antBalDessiner() (+26 more)

### Community 45 - "10-etat.js"
Cohesion: 0.09
Nodes (25): ANT, ANT_ETAPES, ANT_UNITES_F, antAjouterFormes(), antDevinerCouches(), antDevinerMasse(), antDocument(), antEmpilage() (+17 more)

### Community 46 - "pc"
Cohesion: 0.14
Nodes (3): pc, rc, tc

### Community 47 - ".applyMatrix4"
Cohesion: 0.07
Nodes (7): _a(), ci, _i(), h(), ie, jn(), ro()

### Community 48 - "Ot"
Cohesion: 0.09
Nodes (3): Kt(), Ot, Ht()

### Community 49 - "banc-openems.py"
Cohesion: 0.07
Nodes (18): balaye(), _coque(), _court(), croise(), document(), _pastille_dans_reserve(), _pastille_decalee(), _pave() (+10 more)

### Community 50 - "03-rendu.js"
Cohesion: 0.09
Nodes (45): bcx(), CACHE, centrerSur(), ctx, cv, dansFenetre(), dessiner(), fenetre() (+37 more)

### Community 53 - "_maillage"
Cohesion: 0.05
Nodes (22): _bande_lignes(), _bandes_fines(), _bilan_pistes(), _coller(), _coller_ports(), _cout(), _dans(), _emprise_primitive() (+14 more)

### Community 54 - "creer"
Cohesion: 0.08
Nodes (59): CARTES_ANTENNA, creer(), afficher(), ajouter(), annoncer(), annuler(), appliquer(), base64() (+51 more)

### Community 56 - "clone"
Cohesion: 0.07
Nodes (8): clone(), gs(), lo, Nt(), Sc, ti, wa, yc

### Community 59 - ".constructor"
Cohesion: 0.23
Nodes (7): c(), l(), o(), o(), c(), l(), a()

### Community 60 - "pilote.py"
Cohesion: 0.16
Nodes (5): masquer(), battement(), commander(), H, req()

### Community 61 - "Tache"
Cohesion: 0.09
Nodes (4): _ordonnee(), _pente(), Tache, TacheBanc

### Community 62 - "Pilote"
Cohesion: 0.08
Nodes (11): PILOTE_ANTENNA, PILOTE_PANNEAUX, piloteAntenna(), piloteAntennaEtape(), piloteAntennaPanneau(), piloteAntennaToile(), piloteAntennaVue(), _pieces() (+3 more)

### Community 63 - "Element"
Cohesion: 0.22
Nodes (3): Contour, Point, Track

### Community 65 - "cc"
Cohesion: 0.06
Nodes (14): ao, cc, ei, ft(), hc, ni, oo, Pa (+6 more)

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
Cohesion: 0.12
Nodes (4): jl, Kl, ql, xl

### Community 74 - "xt"
Cohesion: 0.05
Nodes (4): be, Lt, Rt(), xt

### Community 75 - "os"
Cohesion: 0.14
Nodes (3): demarrer(), FauxLanceur, req()

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
Cohesion: 0.15
Nodes (9): _b64(), _base64_octets(), _bloc_binaire(), _tableau(), _b64(), _decoder(), sommets_b64(), _binaire() (+1 more)

### Community 80 - "mo"
Cohesion: 0.12
Nodes (6): fl(), gl(), ml, mo, po, l()

### Community 82 - "24-balayage.js"
Cohesion: 0.28
Nodes (15): antBalayageHtml(), antBalayageLier(), antBalayageSpec(), antBalDuree(), balCombien(), balDiff(), balDocumentPour(), balEtiquette() (+7 more)

### Community 83 - "vi"
Cohesion: 0.14
Nodes (16): d(), u(), y(), x(), ji(), R(), m(), h() (+8 more)

### Community 85 - "04-interaction.js"
Cohesion: 0.18
Nodes (10): boitePiste(), choisirComp(), choisirRien(), couchesDesignation(), designer(), distSegment(), fin(), POINTEURS (+2 more)

### Community 86 - "12-api-openems.js"
Cohesion: 0.23
Nodes (15): oeAppel(), oeArreter(), oeBalayage(), oeBase(), oeDocBalayage(), oeErreur(), oeEtat(), oeLancer() (+7 more)

### Community 87 - "na"
Cohesion: 0.06
Nodes (7): r(), ht(), ll(), Mh, na, Qh, ui()

### Community 90 - "11-geometrie.js"
Cohesion: 0.26
Nodes (15): ANT_CUIVRE_CACHE, antArcEnPolyligne(), antCercle(), antCoucheCochee(), antCuivreCalcul(), antCuivreDuModele(), antEmpriseCuivre(), antFormePoints() (+7 more)

### Community 91 - "18-champs.js"
Cohesion: 0.19
Nodes (13): ANT_CALC, ANT_CHAMPS, ANT_REGIONS, antCalcCharger(), antCalcDate(), antCalcHtml(), antCalcLier(), antCalcLigneHtml() (+5 more)

### Community 92 - "_o"
Cohesion: 0.06
Nodes (6): bo, Do, Fo, io, No, _o

### Community 94 - "_ouvrir_ecarts"
Cohesion: 0.16
Nodes (10): _couper_arete(), _elargir_cellules(), connu(), sain(), soudes(), _inserer(), _lignes_au_tiers(), _meilleures_coupes() (+2 more)

### Community 95 - "Garde"
Cohesion: 0.11
Nodes (6): brancher_tls(), en_https(), filtrer_tls(), Garde, _html(), Visites

### Community 96 - "35-fils.js"
Cohesion: 0.35
Nodes (14): ANT_FILS, antFilsBanc(), antFilsEnCours(), antFilsEtat(), antFilsHtml(), antFilsLier(), antFilsMeilleur(), antFilsMesures() (+6 more)

### Community 99 - "banc-polygones.js"
Cohesion: 0.15
Nodes (10): aire(), aireTotale(), disque, fs, ko, L, r, src (+2 more)

### Community 101 - "i"
Cohesion: 0.10
Nodes (17): ac, dc, Ic, kc, lc, load(), c(), loadAsync() (+9 more)

### Community 103 - "25-polygones.js"
Cohesion: 0.30
Nodes (10): polyAire(), polyCompte(), polyCroise(), polyDedans(), polyInserer(), polyIntersection(), polyListe(), polyPlat() (+2 more)

### Community 104 - "createWasm"
Cohesion: 0.20
Nodes (12): addOnInit(), addRunDependency(), createWasm(), receiveInstance(), receiveInstantiationResult(), findWasmBinary(), getWasmImports(), locateFile() (+4 more)

### Community 105 - "1. Ce qui manque, et qui se voit à l'usage"
Cohesion: 0.15
Nodes (15): 1. Ce qui manque, et qui se voit à l'usage, 2. Les limites connues, et ce qu'on en fait, Campagne du 22/10/2026 — ce que les six plans ont tranché, Ce qui est déjà en travaux, plus haut, Ce qui est une limite du monde, pas de l'outil, Ce qui ne se rouvre pas, Historique — le carnet de mesures et de travaux (jusqu'au 22/10/2026), L'adaptation du patch — la mesure a tranché, et ce n'est pas ce qu'on croyait (+7 more)

### Community 106 - "Eh"
Cohesion: 0.10
Nodes (3): Eh, Ls(), updateMatrixWorld()

### Community 107 - "_ponts_couche"
Cohesion: 0.10
Nodes (11): _couper_seg(), _divise(), _pas_local(), pas(), _ponts_couche(), dedans(), dist(), ranger() (+3 more)

### Community 110 - "rt"
Cohesion: 0.09
Nodes (14): Et, s(), a(), o(), Et(), _t(), Ut(), rt (+6 more)

### Community 112 - "Serveur web_antenna.py (stdlib seule)"
Cohesion: 0.13
Nodes (14): CI banc d'essai workflow, Banc relai GitHub, Banc principal banc-openems.py, Banc serveur, Solveur openEMS FDTD, Le port et le piege Windows, Choix de l'interpreteur Python, Serveur web_antenna.py (stdlib seule) (+6 more)

### Community 113 - "Les sept etapes de l'assistant"
Cohesion: 0.17
Nodes (12): MSLPort: cout du prolongement, Panneaux detachables (assistant, conception, IA), Desembedage ligne d'alimentation, Assistant IA, Port microruban MSLPort (experimental), Nettoyage geometrique et masse cachee, Pertes dielectriques: conductivite vs Debye, Port colle sur la grille (+4 more)

### Community 114 - "index.html page principale"
Cohesion: 0.33
Nodes (6): index.html page principale, Ecran d'accueil: ouvrir, concevoir, exemples, Exemples Patch, IFA, Reseau 3x3, Scripts js/00..38 charges, three.js vendor, Vues 2D / 3D / maillage superposees

### Community 115 - "38-tuto.js"
Cohesion: 0.44
Nodes (8): afficher(), avancer(), basculer(), finir(), montrer(), placer(), proposer(), reposer()

### Community 116 - ".mmap"
Cohesion: 0.31
Nodes (7): createLazyFile(), stream_ops, writeChunks(), get_char(), mmap(), position(), read()

### Community 118 - "01-api.js"
Cohesion: 0.42
Nodes (8): apiCandidats(), apiCharger(), apiConnecter(), apiErreur(), apiImporter(), apiLireJson(), ENTETE_WEB, moPoids()

### Community 119 - "abort"
Cohesion: 0.25
Nodes (8): abort(), assert(), getBinaryPromise(), getBinarySync(), instantiateArrayBuffer(), instantiateAsync(), lookup_name(), ___syscall_unlinkat()

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

### Community 138 - "ho"
Cohesion: 0.10
Nodes (10): bind(), bindSkeletons(), ho, ko, parseAnimations(), parseAsync(), parseShapes(), parseSkeletons() (+2 more)

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

## Knowledge Gaps
- **20 isolated node(s):** `Banc principal banc-openems.py`, `Banc serveur`, `Le port et le piege Windows`, `Choix de l'interpreteur Python`, `CSXCAD` (+15 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1472 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **63 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `t()` connect `.setAttribute` to `banc-interface.js`, `cc`, `Fe`, `Mt`, `ho`, `qs`, `ln`, `na`, `.constructor`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Are the 17 inferred relationships involving `IPC2581Parser` (e.g. with `Arc` and `Component`) actually correct?**
  _`IPC2581Parser` has 17 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Banc principal banc-openems.py`, `Banc serveur`, `Le port et le piege Windows` to the rest of the system?**
  _20 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `banc-interface.js` be split into smaller, more focused modules?**
  _Cohesion score 0.010256410256410256 - nodes in this community are weakly interconnected._
- **Why does `g()` connect `vi` to `clone`, `1. Ce qui manque, et qui se voit à l'usage`, `.setAttribute`, `banc-interface.js`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Should `occt-import-js.js` be split into smaller, more focused modules?**
  _Cohesion score 0.017699115044247787 - nodes in this community are weakly interconnected._
- **Why does `vi()` connect `vi` to `three.min.js`, `Mt`, `Eh`, `qs`, `en`, `.setAttribute`, `yt`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._