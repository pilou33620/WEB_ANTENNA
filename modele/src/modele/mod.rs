//! Relit et complete un document d'antenne pour openEMS.
//! Le portage de python/openems_modele.py (1.0.0, 2026-09-14).
//!
//! Explication : le document d'antenne, relu et complete.
//!
//!   Ce module ne simule rien et n'importe pas openEMS. Il prend le document
//!   que la page envoie -- un empilage, du cuivre, une boite, un port, une
//!   bande de frequence --, il le VERIFIE, il COMPLETE ce que l'utilisateur
//!   n'a pas saisi par les regles de l'art du FDTD, et il rend un modele
//!   normalise que les deux autres modules consomment tel quel :
//!
//!       openems_script.py   -> un .py autonome qui refait la simulation
//!       openems_run.py      -> le lance vraiment, par les liaisons Python
//!
//!   POURQUOI IL EST SEPARE, ET POURQUOI IL N'IMPORTE PAS openEMS. L'assistant
//!   de la page a besoin de ces valeurs AVANT toute simulation : « ta boite
//!   fait 12 mm de marge, il en faudrait 30 », « ton maillage donne 4,2
//!   millions de cellules, compte deux heures ». Sur un poste ou les DLL
//!   d'openEMS manquent, ce module fonctionne quand meme, et l'outil reste
//!   utilisable pour preparer et exporter le script. C'est la meme tolerance
//!   que web_antenna.py applique a ses solveurs.
//!
//! Fonctions : etat, normaliser, ErreurModele
//!
//!     let m = antenne_modele::modele::normaliser(&doc)?;
//!     m.m["estimation"]["cellules"]            // 412500
//!
//! Le document d'entree est decrit dans `antenne-openems/README.md`. Tout y est
//! en millimetres et en hertz -- la page ne convertit rien, c'est ici que les
//! pouces d'un fichier IPC-2581 en pouces sont ramenes au millimetre.
//!
//! Le modele reste ce qu'il etait en Python : un dict, ici un `Json` dont les cles gardent leur
//! ordre, pour que le JSON rendu a la page soit celui de `json.dumps`, a l'octet. Seuls les
//! triangles des pieces importees (`_geo`) vivent a cote, dans `Modele::pieces`.
//!
//! Le fichier suit le Python section par section : `structure` (l'empilage, le cuivre, les
//! objets, les ports, la bande), `maillage` (la boite, la grille, son budget, les pertes, les
//! enregistrements, l'estimation), `ponts` (les ecarts que la grille soude) et `avis`.

mod avis;
mod maillage;
mod ponts;
mod structure;

use crate::obj;
use crate::outils::{fmt_g, max_de, maxi, min_de, mini, nombres, py_str};
use crate::pieces::{self, Piece};
use ipc2581::py::{self, Json, Objet};
use std::sync::Mutex;

pub use avis::{_cause_cellule, _coupable_cellule};
pub use maillage::{_cout, _estimation, DUMP_REGIONS, DUMP_TYPES};
pub use ponts::_ponts_de_maille;
pub use structure::{_emprise_primitive, microruban_eeff, microruban_z0};

use avis::_avis;
use maillage::*;
use ponts::_ouvrir_ecarts;
use structure::*;

// Le document porte des polygones de cuivre : il est plus gros qu'un document
// de ligne de transmission, plus petit qu'un document de chute DC. Et depuis
// qu'il porte aussi les pieces importees -- un boitier, des piles, en
// triangles --, il lui faut la place de leur budget (voir
// openems_pieces.MAX_TRIANGLES : quatre cent mille triangles font une
// dizaine de megaoctets en base64).
pub const MAX_CORPS: usize = 64 * 1024 * 1024;

pub const C0: f64 = 299792458.0; // m/s
pub const MU0: f64 = 4e-7 * std::f64::consts::PI;
pub const EPS0: f64 = 1.0 / (MU0 * C0 * C0);

// Replis quand le fichier ne dit rien. Ce sont des valeurs de FR-4 ordinaire ;
// elles sont marquees « suppose » dans le modele rendu, et la page les affiche
// comme telles -- une permittivite devinee n'est pas une permittivite mesuree.
pub const ER_DEFAUT: f64 = 4.3;
pub const DF_DEFAUT: f64 = 0.02;
pub const EP_CU_DEFAUT: f64 = 0.035; // mm, 1 oz
pub const SIGMA_CU: f64 = 5.8e7; // S/m

// -- regles de l'art du FDTD ------------------------------------------------
// MARGE D'AIR. Entre la structure rayonnante et la PML il faut de la place :
// la PML absorbe bien les ondes qui la traversent presque normalement, mal le
// champ proche reactif qui l'atteint de biais. Un quart de la longueur d'onde
// LA PLUS BASSE de la bande est la valeur que donnent les exemples d'openEMS
// et la litterature FDTD ; en dessous, l'impedance d'entree derive.
pub const MARGE_LAMBDA: f64 = 0.25;
// Le maillage : vingt cellules par longueur d'onde dans le milieu le plus
// lent. Dans le dielectrique la longueur d'onde est divisee par racine(er),
// la cellule doit donc l'etre aussi.
pub const CELLULES_PAR_LAMBDA: f64 = 20.0;
// ... MAIS LAMBDA/20 NE VOIT QUE LA LONGUEUR D'ONDE, ET UNE ANTENNE IMPRIMEE
// n'est pas faite que de longueurs d'onde. Sous un ruban de 3 mm, le champ
// tourne sur la LARGEUR DU RUBAN et sur l'EPAISSEUR DU SUBSTRAT, qui valent
// ici le quart de la cellule que lambda/20 autorise. Le calcul tourne quand
// meme, il ne previent pas, et il rend une antenne qui ne resonne pas : mesure
// faite sur le patch 2,45 GHz de l'exemple, la resonance DISPARAIT a 2,57 mm
// de pas et revient a 0,8 mm, meme geometrie, meme port. Deux bornes de plus,
// donc, prises sur la geometrie et non sur la frequence.
pub const CELLULES_PAR_PISTE: f64 = 4.0; // en travers du cuivre le plus etroit
// ET RIEN DE PLUS. L'epaisseur du substrat, elle, ne borne PAS le pas dans le
// plan : le tutoriel de reference d'openEMS (Simple_Patch_Antenna) maille son
// patch a 5 mm sur un substrat de 1,5 mm -- trois fois l'epaisseur -- et rend
// une resonance juste. Une regle liee au substrat mettrait toute carte un peu
// grande a des dizaines de millions de cellules sans rien y gagner.
// JUSQU'OU LA GEOMETRIE A LE DROIT DE RAFFINER. Une carte reelle porte des
// pastilles de 0,2 mm dont personne ne demande le champ : sans borne, la regle
// ci-dessus mettrait la carte entiere a 0,05 mm et le calcul ne finirait
// jamais.
//
// LA BORNE EST UN BUDGET, ET NON UN RAPPORT. Un rapport fixe -- « pas plus de
// huit fois plus fin que lambda/20 » -- parait prudent et ne l'est pas : il
// interdit de resoudre une piste de 1 mm, qui n'a rien d'extraordinaire, tout
// en laissant passer une carte de 300 mm ou le meme rapport fait cent millions
// de cellules. Ce qui coute, c'est le NOMBRE DE LIGNES dans l'emprise du
// cuivre ; c'est donc lui qu'on plafonne. Deux cents lignes par axe, et le
// plancher du pas s'en deduit tout seul, a la taille de la carte.
pub const LIGNES_MAX_EMPRISE: f64 = 200.0;
// ... MAIS UN PAS UNIQUE SUR TOUTE L'EMPRISE ETAIT LE VRAI COUPABLE. La borne
// ci-dessus ne dit pas « ce cuivre est trop fin pour etre resolu », elle dit
// « raffiner TOUTE la carte a ce pas-la couterait plus de deux cents lignes par
// axe ». Or une piste large de 0,5 mm et longue de 20 ne demande le pas fin
// qu'en TRAVERS d'elle-meme, sur un demi-millimetre : le champ tourne sur la
// largeur du ruban, pas sur sa longueur. D'ou les bandes fines de `_maillage`,
// et les trois constantes qui les bornent.
//
// ... ET LE FOND NE DOIT PLUS SUIVRE LE CUIVRE JUSQU'EN BAS. Les bandes sont
// arrivees, mais `_resolution` continuait de poser le fond de TOUTE l'emprise
// a largeur / CELLULES_PAR_PISTE : sur l'exemple F inverse (brins de 1,22 mm,
// carte de 50 x 58 mm), le plan de masse entier tombait a 0,305 mm, les bandes
// n'avaient plus rien a affiner, et le calcul durait 2 h 13 -- 3,9 millions de
// cellules. Fond borne et bandes sur les brins : 1,0 million, 27 minutes, les
// memes quatre cellules en travers des brins, et une resonance a 0,4 % pres
// (2,569 GHz contre 2,580, S11 -29 dB contre -37, rendement 9,5 % contre
// 9,7 %). La largeur du
// cuivre ne descend donc le fond que jusqu'a lambda/20 divise par
// FOND_DIVISEUR_MAX ; en dessous, ce sont les bandes qui mettent les quatre
// cellules en travers de la piste, la ou elle est, et sous le budget de
// `_mailler`. Ce n'est pas le « rapport fixe » refuse plus haut : il borne le
// FOND, pas la resolution du cuivre, que les bandes assurent toujours.
//
// QUATRE, ET LE PATCH N'EN VOIT RIEN. A 2,45 GHz sur FR-4, le fond ne descend
// plus sous 0,64 mm ; celui du patch de l'exemple est a 0,74 mm (sa ligne de
// 2,98 mm divisee par quatre), au-dessus : sa grille reste la meme, ligne pour
// ligne. Et la mesure de CELLULES_PAR_PISTE -- la resonance revient a 0,8 mm
// -- dit qu'un fond a 0,64 n'est pas un fond grossier.
pub const FOND_DIVISEUR_MAX: f64 = 4.0;
//
// MARGE_BANDE : de combien de cellules fines la bande depasse le cuivre, de
// chaque cote. Zero marcherait — le lissage rattraperait le fond des la cellule
// suivante —, mais le champ de bord d'un ruban s'etend sur a peu pres
// l'epaisseur du substrat, et deux cellules fines de plus le decrivent pour
// deux lignes par bande.
pub const MARGE_BANDE: usize = 2;
// DE COMBIEN ON RECULE quand le budget refuse, et combien d'essais. Reculer
// plus vite ferait manquer le pas juste en dessous du budget ; plus lentement
// construirait des maillages pour rien.
pub const AFFINAGE_RECUL: f64 = 1.3;
pub const AFFINAGE_ESSAIS: usize = 24;
// AU-DELA DE TANT DE LIGNES DE BANDE SUR UN AXE, l'essai n'est meme pas
// construit : vingt mille lignes, c'est cent fois un maillage d'antenne
// ordinaire, et le budget en cellules-pas le refuserait de toute facon --
// mais apres des minutes de fusion. Voir `_mailler`.
pub const LIGNES_MAX_BANDES: f64 = 20000.0;
// UN POLYGONE PLUS MINCE QU'UN MICRON N'EST PAS DU CUIVRE, C'EST UN DECHET
// D'EXPORT : rayon de pastille thermique, contour aplati, copeau de
// remplissage. openEMS l'ignorerait en silence, mais d'ici la il fixait la
// « largeur de cuivre minimale » a zero -- donc le pas fin vise, les
// avertissements « cuivre non resolu », et les essais d'affinage. 707 sur
// P01x274PCB-C.xml. On les ecarte a l'entree, et on les compte.
pub const LARGEUR_DEGENEREE_MM: f64 = 1e-3;
// CE QUE VOIT LE CUIVRE D'ANTENNE POSE DU COTE « CACHE » d'un plan de
// reference (voir `_masse_cachee`) : la masse a moins de PROCHE_ANTENNE_MM de
// lui, dans le plan. Une piste a 0,37 mm de son plan tient son champ a
// quelques hauteurs de dielectrique de ses bords ; 2 mm, c'est cinq fois
// cela. Au-dela, la masse de cette face ne fait que doubler le contour du
// plan de reference.
pub const PROCHE_ANTENNE_MM: f64 = 2.0;
// LE BUDGET DE L'AFFINAGE, EN CELLULES-PAS DE TEMPS (voir `_cout`) : un plafond
// absolu, et un plafond relatif au maillage de fond. Les deux sont
// necessaires. Sans l'absolu, une grande carte s'affinerait jusqu'a la nuit de
// calcul ; sans le relatif, une petite carte dont le fond coute trois minutes
// s'affinerait cent fois — et « affiner le maillage » ne doit pas vouloir dire
// « multiplier la duree par cent » sans que personne l'ait demande.
//
// 5e11 cellules-pas, c'est environ six heures au debit suppose de 25 Mcps, et
// quatre fois le fond. MESURE sur la carte d'essai qui reprend l'empilage
// d'antenna4c (quatre couches, 120 x 55 mm, 868 MHz) : le fond seul coute
// 2,3e11 ; le budget laisse donc l'affinage doubler le prix, pas davantage.
pub const CELLULES_PAS_MAX: f64 = 5.0e11;
pub const AFFINAGE_COUT_MAX: f64 = 4.0;
// COMBIEN DE CELLULES EN Z DANS UN DIELECTRIQUE. Une seule ne represente pas le
// champ qui se courbe sous une piste — et c'est ce champ-la qui fait
// l'impedance de la ligne. Trois le font. C'est le nombre que ce module visait
// depuis toujours sans jamais l'atteindre : voir `_maillage`, section z.
pub const CELLULES_PAR_SUBSTRAT: i64 = 3;
// Le rapport maximal entre deux cellules voisines. Une grille qui passe de
// 0,5 a 2 mm d'un coup reflechit numeriquement sur la marche ; openEMS lisse
// par SmoothMeshLines, et 1,4 est la valeur de ses exemples.
//
// ON PREND DEUX, ET LA RAISON EST CHIFFREE. Les exemples d'openEMS partent
// d'une grille deja presque uniforme : y imposer 1,4 ne coute rien. Ici la
// grille est volontairement contrastee -- fine sur la carte, grossiere dans
// l'air, et le rapport entre les deux vaut sept. Mesure faite sur l'exemple :
// a 1,4 le maillage passe de 340 000 a 3 200 000 cellules, soit neuf fois le
// calcul, pour combler des marches qui sont presque toutes loin de l'antenne.
// A 2,0, plus aucune cellule ne double sa voisine et le surcout est de 1,7.
pub const GRADIENT_MAX: f64 = 2.0;
// Nombre de couches de PML. Huit est le reglage d'usine d'openEMS et celui de
// tous ses exemples d'antenne ; six suffit parfois, dix ne se justifie que
// pour des structures tres resonantes.
pub const PML_DEFAUT: i64 = 8;
// Largeur minimale de l'impulsion d'excitation, en fraction de sa frequence
// centrale. Une demi-octave : c'est ce qu'emploient les exemples d'openEMS
// (f0 = 2 GHz, fc = 1 GHz pour le patch). Voir `_bande` pour le pourquoi.
pub const EXCITATION_LARGEUR_MIN: f64 = 0.4;
// La regle du tiers : au bord d'un conducteur, la ligne de maillage ne se pose
// pas SUR l'arete mais de part et d'autre, a un tiers dehors et deux tiers
// dedans. C'est ce qui rend la densite de courant de bord correcte sans
// raffiner partout. openEMS l'applique par AddEdges2Grid.
pub const TIERS_DEFAUT: bool = true;

// Criteres d'arret. -40 dB d'energie residuelle est le reglage courant pour
// une antenne ; -50 dB pour un resonateur a fort Q, au prix du temps.
pub const ENERGIE_DEFAUT: f64 = -40.0;
pub const NMAX_DEFAUT: i64 = 30000;
// LE NOMBRE DE PAS SE CALCULE, IL NE SE DEVINE PAS. openEMS refuse de tourner
// si le garde-fou est plus court que TROIS fois l'impulsion d'excitation ; on
// en prend quatre, ce qui laisse a la structure le temps de se vider apres que
// la source s'est tue. Le reste -- s'arreter des que l'energie est tombee --
// est le travail du seuil en decibels, pas celui du compteur.
pub const NMAX_IMPULSIONS: f64 = 4.0;
// ... MAIS QUATRE IMPULSIONS NE SUFFISENT PAS A UNE ANTENNE QUI RESONNE, et
// c'est une mesure qui l'a dit, pas une crainte. L'impulsion partie, il reste
// l'extinction : une structure resonante rend son energie en exp(-w.t/Q), et
// descendre a -40 dB demande environ 1,5 x Q periodes. Sur le F inverse de
// 2,45 GHz, l'energie n'est tombee sous -40 dB qu'au 39 165e pas, alors que le
// critere d'impulsion seul en proposait 31 125 : le garde-fou aurait coupe le
// calcul AVANT la mesure, et la troncature se serait lue comme une resonance
// floue. On prend donc le plus grand des deux criteres.
//
// QUARANTE PERIODES, ET POURQUOI CE NOMBRE. C'est 1,5 x Q pour un Q charge de
// 27 -- l'ordre de grandeur d'une antenne imprimee adaptee sur FR-4, pertes
// comprises. Le run ci-dessus a demande 35 periodes ; le patch de l'exemple,
// 21. Quarante les couvre tous les deux avec une marge, et ne coute RIEN quand
// le calcul converge : c'est un plafond, pas une consigne -- l'energie arrete
// la simulation bien avant. Il ne coute que dans le seul cas ou l'on veut
// justement qu'il coute : une antenne qui ne s'eteint pas.
pub const NMAX_PERIODES: f64 = 40.0;
pub const NMAX_PLANCHER: i64 = 5000;
// A PARTIR DE QUAND UNE CELLULE MINCE SE SIGNALE. Le vingtieme du pas vise
// etait un chiffre rond, et il laissait passer exactement ce qu'il fallait
// attraper : sur une carte relais 868 MHz, une cellule de 0,074 mm pour un pas
// de 0,599 -- huit fois trop fine, un facteur 3,5 sur le pas de temps, DONC
// 3,5 fois plus de pas -- passait sous le seuil de 0,030 mm sans un mot, et le
// calcul a dure cinq heures au lieu d'une heure et demie.
//
// MAIS AUCUN RATIO AU PAS VISE NE FAIT L'AFFAIRE, ET C'EST LA MESURE QUI L'A
// DIT. Resserrer au quart attrapait bien les 0,074 mm -- et signalait du meme
// coup un patch 2,45 GHz parfaitement sain, dont la plus petite cellule
// (0,533 mm pour un pas vise de 2,41) n'est rien d'autre que le substrat de
// 1,6 mm divise en trois, c'est-a-dire l'affinage que le maillage s'impose
// LUI-MEME. Un substrat mince devant le pas vise rend ce rapport aussi grand
// qu'on veut sans qu'aucune faute ait ete commise.
//
// LE BON REPERE EST DONC LE PLANCHER QUE LA GRILLE S'EST DONNE SUR CET AXE
// -- `pas_local/4` dans le plan, `plan/2` en z, tous deux ecrits dans
// `maillage_detail["plancher"]`. En dessous, aucune ligne ORDINAIRE ne peut
// descendre : `_fusionner` les filtre. Ce qui passe quand meme est forcement
// une paire d'obligatoires, c'est-a-dire un accident de geometrie -- et c'est
// exactement ce qu'on veut signaler, ni plus ni moins. Le facteur ci-dessous
// n'est qu'une marge d'arrondi.
pub const CELLULE_AVIS_MARGE: f64 = 0.9;
// A PARTIR DE QUAND UNE DUREE SE DIT. `duree_estimee` existait depuis
// toujours et n'etait lue que par le balayage : une simulation SEULE partait
// sans qu'aucun chiffre passe devant l'operateur -- et c'est pourtant par elle
// qu'on commence. Une demi-heure est le seuil ou l'on cesse d'attendre devant
// l'ecran, c'est-a-dire celui ou l'on veut avoir choisi.
pub const DUREE_AVIS_S: f64 = 1800.0;
// CE QUI SEPARE DEUX ARETES DE CUIVRE SANS RIEN SEPARER DU TOUT. Deux bords a
// quelques dizaines de microns l'un de l'autre ne sont pas deux bords : c'est
// le meme, rendu deux fois -- l'arrondi d'un bout de piste, un ruban de 1,00 mm
// qui croise un ruban de 1,02 mm sur le meme axe, deux sommets d'un fichier de
// CAO. Aucun fabricant ne tient cette difference-la, et aucune onde ne la voit.
// Le maillage, lui, la paie plein tarif : chaque bord pose ses lignes au tiers,
// et deux bords presque confondus en posent quatre au lieu de deux, dont deux
// se touchent. La cellule minuscule qui en resulte commande le pas de temps de
// TOUT le domaine -- mesure faite sur l'IFA du gabarit : 3,26 millions de
// cellules et 3 h 25 au lieu de 820 000 et vingt minutes, pour la meme antenne.
// CES RELEVES DATENT DE L'IFA D'AVANT : le gabarit tirait alors ses cotes d'une
// note d'application, il les calcule desormais des proportions classiques du
// motif. Les nombres ne se reproduisent donc plus tels quels ; ce qu'ils
// montrent -- deux aretes presque confondues paient plein tarif -- ne depend
// d'aucune cote.
pub const EPS_ARETES_MM: f64 = 0.05;
// CE QU'UN VERNIS COUTE, ET CE QU'IL APPORTE. Un fichier IPC-2581 declare son
// masque de soudure dans l'empilage comme n'importe quelle autre couche : sur
// antenna4c.xml, « Resist-A » et « Resist-B », 15 microns de resine de part et
// d'autre de la carte. Ces deux couches-la ne sont pas ENTRE les conducteurs,
// elles sont DEHORS, posees sur le cuivre exterieur. Ce qu'elles ajoutent est
// du SECOND ORDRE : une permittivite posee sur un vingt-cinquieme de la hauteur
// du substrat, la ou le champ d'un microruban est deja sorti du dielectrique --
// de quoi abaisser la resonance de l'ordre du pour-cent, pas de quoi la
// deplacer. (Cet ordre de grandeur-la n'est PAS mesure ici ; ce qui suit l'est.)
//
// LE MAILLAGE, LUI, LES PAIE AU PRIX DU PAS DE TEMPS. Les deux faces d'une
// couche de l'empilage portent chacune une ligne OBLIGATOIRE -- sans quoi le
// substrat glisse, et un substrat qui glisse n'est plus le meme substrat --,
// donc 15 microns entre deux lignes font une cellule QUARANTE fois plus fine
// que le pas vise sur la carte ci-dessous (0,599 mm). Comme le pas de temps FDTD est commande par la
// plus petite cellule de TOUT le domaine, ces 30 microns de resine coutent un
// facteur HUIT sur la duree du calcul. MESURE FAITE sur une carte d'essai qui
// reprend l'empilage d'antenna4c.xml -- quatre couches, 120 x 55 mm, bande
// centree sur 868 MHz, quatre millions de cellules : pas de temps 0,0497 ps
// avec les deux vernis, 0,404 ps sans eux, duree annoncee 21 h contre 2 h 30.
// Le maillage, lui, ne perd que cent mille cellules sur quatre millions --
// ce n'est pas une economie de memoire, c'est le pas de temps et rien d'autre.
//
// UN REVETEMENT EXTERIEUR PLUS FIN QUE CETTE BORNE N'ENTRE DONC PAS DANS LA
// GEOMETRIE. Il n'est pas efface en silence : le modele le nomme dans
// `revetements`, un avis le dit, et la page laisse le remettre d'une case a
// cocher -- un radome mince ou un coverlay de flex peuvent compter, et c'est
// a l'utilisateur d'en decider. CE QUI EST ENTRE DEUX CONDUCTEURS N'EST JAMAIS
// ECARTE, si mince soit-il : c'est un substrat, il porte le champ, et le
// supprimer collerait deux couches de cuivre l'une sur l'autre.
pub const EP_REVETEMENT_MM: f64 = 0.05;

// -- pertes dielectriques ---------------------------------------------------
// DEUX FACONS DE DECRIRE UN DIELECTRIQUE A PERTES, ET ELLES NE SE VALENT PAS.
//
//   « kappa » -- une conductivite equivalente, kappa = 2.pi.f.eps0.er.tan(d).
//       C'est ce qu'openEMS accepte directement, et c'est JUSTE A UNE SEULE
//       FREQUENCE : celle ou on la calcule. Ailleurs, tan(d) varie comme 1/f,
//       alors que le FR-4 reel garde un tan(d) a peu pres constant. Sur une
//       bande de plus ou moins dix pour cent l'erreur reste sous le pour-cent ;
//       sur une octave elle depasse la moitie de la valeur.
//
//   « debye » -- une somme de poles de relaxation :
//           eps(w) = eps_inf + somme_p  d_eps_p / (1 + j.w.tau_p)
//       Avec des tau repartis uniformement EN LOGARITHME et un d_eps identique
//       sur chacun, la somme approche la distribution continue de
//       Djordjevic-Sarkar, dont la tangente de pertes est plate. C'est le
//       comportement d'un stratifie reel.
pub const DEBYE_DECADES: f64 = 1.5; // de combien on deborde la bande, de chaque cote
pub const DEBYE_POLES_PAR_DECADE: f64 = 3.0;
pub const DEBYE_POLES_MIN: i64 = 3;
pub const DEBYE_POLES_MAX: i64 = 8;
// openEMS IGNORE EN SILENCE un pole dont le temps de relaxation ne depasse pas
// DEUX PAS DE TEMPS : `if ((C_L[n]>0) && (t_relax>0) && (t_relax>2.0*dT))`,
// dans FDTD/extensions/operator_ext_lorentzmaterial.cpp. En dessous, le pole
// est simplement saute -- le calcul tourne, et le materiau n'a pas les pertes
// qu'on croit. On garde une marge de trois pas, et on le DIT quand la borne
// mord.
pub const DEBYE_TAU_SUR_DT: f64 = 3.0;

// Une cellule FDTD coute, en gros, 6 composantes de champ x 4 octets, plus les
// coefficients de mise a jour -- openEMS tourne autour de 100 octets par
// cellule en simple precision avec materiaux constants par cellule.
pub const OCTETS_PAR_CELLULE: f64 = 100.0;
// Debit typique d'openEMS sur un poste de travail recent, en millions de
// cellules-pas de temps par seconde. Sert UNIQUEMENT a donner un ordre de
// grandeur de la duree ; il est annonce comme tel. C'est la valeur DE DEPART :
// tant qu'aucun calcul n'a fini sur ce poste, on n'a que la supposition.
pub const MCPS: f64 = 25.0;

// ==========================================================================
// Le debit mesure
// --------------------------------------------------------------------------
// POURQUOI SUPPOSER QUAND ON PEUT MESURER. openEMS ecrit lui-meme sa vitesse a
// chaque ligne d'avancement : « Speed: 7.1 MC/s ». Le premier calcul termine
// donne donc le debit REEL de la machine, et toutes les annonces suivantes
// peuvent s'y caler. L'ecart n'est pas academique : entre le portable a quatre
// fils et la station a trente-deux, il y a un facteur cinq, et c'est sur un
// balayage — la duree multipliee par le nombre de points — qu'il se paie.
//
// POURQUOI LA MEDIANE DE PLUSIEURS, ET NON LE DERNIER. Le debit d'un calcul
// n'est pas seulement celui du processeur : un petit maillage qui tient dans
// le cache va plus vite par cellule qu'un gros, et une machine occupee a
// autre chose va moins vite qu'une machine libre. Un seul nombre retenu tel
// quel ferait donc suivre l'annonce aux hasards de la derniere fois. La
// mediane des derniers calculs encaisse l'un et l'autre, et suit quand meme
// le poste s'il change.
//
// CE QUI N'EST PAS RETENU : une valeur hors des bornes du plausible. Une
// ligne mal lue, un journal tronque, un « Speed: 0.0 » du tout premier
// rapport avant que le calcul ait commence — les prendre ferait annoncer des
// heures pour une minute, et une annonce absurde use plus la confiance qu'une
// annonce approchee.
pub const MCPS_MIN: f64 = 0.05;
pub const MCPS_MAX: f64 = 5000.0;
pub const MCPS_GARDE: usize = 5; // combien de calculs entrent dans la mediane

// ==========================================================================
// Les fils de calcul
// --------------------------------------------------------------------------
// OPENEMS NE PREND PAS TOUS LES COEURS DE LUI-MEME, et c'est ce qui a fait
// tourner une carte de 10,8 millions de cellules a 7 % du processeur. Sans
// `numThreads`, il part d'UN fil et en ajoute un tant que la vitesse monte :
//
//     Multithreaded engine using 1 threads. Utilization: (201)
//     Multithreaded engine using 2 threads. Utilization: (101;100)
//     Multithreaded engine using 3 threads. Utilization: (67;67;67)
//
// Le tatonnement s'arrete au premier palier qui ne gagne rien -- et le bruit
// d'une mesure de quelques secondes suffit a l'arreter a deux ou trois fils.
//
// POURQUOI CE N'EST PAS « TOUS LES COEURS ». Le FDTD est borne par la memoire,
// pas par le calcul : chaque pas relit tout le maillage pour tres peu
// d'operations. Sur un poste a dix coeurs, une boite de 2,9 millions de
// cellules a donne 121 MC/s sur un fil, 215 sur deux, 243 sur huit -- et 223
// sur douze. Au-dela du debit de la memoire, un fil de plus ne fait qu'en
// disputer la bande passante aux autres. La bonne valeur se MESURE : c'est
// le travail du banc de vitesse (openems_run.lancer_banc), dont le resultat
// est range ici.
//
// LE REGLAGE EST UNE PROPRIETE DU POSTE, pas du projet : la meme carte n'a pas
// le meme optimum sur un portable et sur une station. Le serveur le range avec
// le debit, dans les reglages du poste.
// ==========================================================================
pub const FILS_MAX: i64 = 256;

/// Ce que le module retient du POSTE, hors de tout document : `_MCPS_VUS`, `_FILS` et `_BANC`
/// du Python, derriere un seul verrou.
struct Poste {
    // Chaque entree est (debit, fils) : le debit d'un calcul termine et le nombre
    // de fils qu'openEMS y a VRAIMENT employes (0 quand le journal ne l'a pas dit).
    vus: Vec<(f64, i64)>,
    /// 0 : openEMS choisit (son tatonnement)
    fils: i64,
    /// fils -> MC/s mesures par le banc, dans l'ordre ou le banc les a donnes
    banc: Vec<(i64, f64)>,
}

static POSTE: Mutex<Poste> = Mutex::new(Poste { vus: Vec::new(), fils: 0, banc: Vec::new() });

fn poste() -> std::sync::MutexGuard<'static, Poste> {
    POSTE.lock().unwrap_or_else(|e| e.into_inner())
}

fn _mediane(t: impl IntoIterator<Item = f64>) -> f64 {
    let mut t: Vec<f64> = t.into_iter().collect();
    t.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = t.len();
    if n % 2 == 1 { t[n / 2] } else { 0.5 * (t[n / 2 - 1] + t[n / 2]) }
}

impl Poste {
    fn debit_mesure(&self) -> Option<f64> {
        if self.vus.is_empty() { None } else { Some(_mediane(self.vus.iter().map(|(v, _)| *v))) }
    }

    fn debit_suppose(&self) -> f64 {
        if self.vus.is_empty() {
            return MCPS;
        }
        _mediane(self.vus.iter().map(|(v, f)| *v * self.facteur_fils(*f)))
    }

    fn banc_meilleur(&self) -> i64 {
        if self.banc.is_empty() {
            return 0;
        }
        let top = max_de(self.banc.iter().map(|(_, v)| *v));
        self.banc.iter().filter(|(_, v)| *v >= 0.97 * top).map(|(f, _)| *f).min().unwrap_or(0)
    }

    fn fils_effectif(&self) -> i64 {
        if self.fils > 0 { self.fils } else { self.banc_meilleur() }
    }

    /// Le debit du banc a `f` fils, interpole entre deux mesures voisines.
    fn _banc_a(&self, f: i64) -> f64 {
        let mut ks = self.banc.clone();
        ks.sort_by_key(|(k, _)| *k);
        let (premier, dernier) = (ks[0], ks[ks.len() - 1]);
        if f <= premier.0 {
            return premier.1;
        }
        if f >= dernier.0 {
            return dernier.1;
        }
        for w in ks.windows(2) {
            let ((a, va), (b, vb)) = (w[0], w[1]);
            if a <= f && f <= b {
                return va + (vb - va) * (f - a) as f64 / (b - a) as f64;
            }
        }
        dernier.1
    }

    fn facteur_fils(&self, fils_mesure: i64) -> f64 {
        let fils = self.fils_effectif();
        if self.banc.is_empty() || fils <= 0 || fils_mesure <= 0 {
            return 1.0;
        }
        let r = self._banc_a(fils_mesure);
        if r > 0.0 { self._banc_a(fils) / r } else { 1.0 }
    }
}

/// Retient le debit d'un calcul termine. Rend le debit retenu, ou None.
pub fn noter_debit(mcps: f64, fils: i64) -> Option<f64> {
    let mut p = poste();
    if !(MCPS_MIN <= mcps && mcps <= MCPS_MAX) {
        return p.debit_mesure();
    }
    p.vus.push((mcps, fils.max(0)));
    let trop = p.vus.len().saturating_sub(MCPS_GARDE);
    p.vus.drain(..trop);
    p.debit_mesure()
}

/// Repart de la valeur supposee. Le banc d'essai s'en sert ; rien d'autre.
pub fn oublier_debit() {
    poste().vus.clear();
}

/// La mediane des derniers calculs, ou None si aucun n'a encore fini.
pub fn debit_mesure() -> Option<f64> {
    poste().debit_mesure()
}

/// Les fils du dernier calcul retenu (0 : inconnus). Le serveur les range
/// avec le debit, pour que la mise a l'echelle survive au redemarrage.
pub fn debit_fils() -> i64 {
    poste().vus.last().map(|(_, f)| *f).unwrap_or(0)
}

/// Sur combien de calculs la mediane porte.
pub fn debit_n() -> usize {
    poste().vus.len()
}

/// Le debit sur lequel les durees sont annoncees.
///
/// RAMENE AU NOMBRE DE FILS REGLE quand le banc de vitesse permet de le
/// faire. Un calcul mesure a 27 MC/s sur deux fils ne dit pas ce que donnera
/// le suivant sur huit : sans cette mise a l'echelle, changer le reglage
/// laisserait la duree annoncee exactement ou elle etait, et l'on ne verrait
/// pas ce qu'il rapporte. Chaque calcul retenu est ramene a part, avec SES
/// fils ; la mediane porte sur les valeurs ramenees.
pub fn debit_suppose() -> f64 {
    poste().debit_suppose()
}

/// Pose le nombre de fils des prochains calculs. 0 rend la main a openEMS.
pub fn regler_fils(n: i64) -> i64 {
    let mut p = poste();
    p.fils = n.clamp(0, FILS_MAX);
    p.fils
}

pub fn fils_regle() -> i64 {
    poste().fils
}

/// Retient un banc de vitesse : {fils: MC/s}. Les valeurs hors du
/// plausible sont ecartees, comme pour le debit.
pub fn noter_banc(mesures: impl IntoIterator<Item = (i64, f64)>) -> Vec<(i64, f64)> {
    let mut propre: Vec<(i64, f64)> = Vec::new();
    for (f, x) in mesures {
        if (1..=FILS_MAX).contains(&f) && MCPS_MIN <= x && x <= MCPS_MAX {
            match propre.iter_mut().find(|(k, _)| *k == f) {
                Some(e) => e.1 = x,
                None => propre.push((f, x)),
            }
        }
    }
    let mut p = poste();
    p.banc = propre;
    p.banc.clone()
}

pub fn banc() -> Vec<(i64, f64)> {
    poste().banc.clone()
}

/// Le nombre de fils le plus rapide au banc, ou 0 sans banc.
///
/// A VITESSE EGALE A 3 % PRES, LE PLUS PETIT GAGNE : l'ecart est dans le
/// bruit de la mesure, et un fil de moins laisse un coeur au reste du poste.
pub fn banc_meilleur() -> i64 {
    poste().banc_meilleur()
}

/// Les fils que les calculs recoivent VRAIMENT : le reglage s'il y en a
/// un, sinon le meilleur du banc, sinon 0 (openEMS tatonne).
///
/// « AUTO » VEUT DIRE « LE BON NOMBRE », PAS « LE TATONNEMENT D'OPENEMS ».
/// Laisse a lui-meme, openEMS s'arretait a deux ou trois fils : l'exemple
/// F inverse a tourne a 2 fils et 30 MC/s sur un poste dont le banc mesure
/// 138 MC/s a deux fils et 222 a huit. Le banc passe au demarrage du
/// serveur (web_antenna.py) : des qu'il a parle, ses fils vont a tous les
/// calculs -- exemples, conception, balayages -- sans qu'on ait rien a
/// choisir. Un nombre choisi a la main reste un choix, et passe devant.
pub fn fils_effectif() -> i64 {
    poste().fils_effectif()
}

/// De combien un debit mesure a `fils_mesure` fils change au reglage.
///
/// 1.0 quand on ne sait pas : pas de banc, ou fils de la mesure inconnus.
/// Sans banc, le reglage « Auto » laisse openEMS tatonner, et son
/// tatonnement ne se predit pas ; avec un banc, « Auto » vaut son meilleur
/// nombre (voir `fils_effectif`), et la mise a l'echelle se fait sur lui.
pub fn facteur_fils(fils_mesure: i64) -> f64 {
    poste().facteur_fils(fils_mesure)
}

/// Refus explicite : message lisible + ce qu'il faut changer.
#[derive(Debug, Clone, PartialEq)]
pub struct ErreurModele {
    pub message: String,
    pub conseil: String,
}

impl std::fmt::Display for ErreurModele {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ErreurModele {}

pub(crate) fn refus(message: impl Into<String>, conseil: &str) -> ErreurModele {
    ErreurModele { message: message.into(), conseil: conseil.to_string() }
}

type Res<T> = Result<T, ErreurModele>;

/// Ce que ce module sait faire. La page l'interroge au demarrage.
pub fn etat() -> Json {
    obj! {
        "dispo" => true,
        "version" => "1.0.0",
        "max" => MAX_CORPS,
        "regles" => obj! {
            "marge_lambda" => MARGE_LAMBDA,
            "cellules_par_lambda" => CELLULES_PAR_LAMBDA,
            "pml" => PML_DEFAUT,
            "er_defaut" => ER_DEFAUT,
            "df_defaut" => DF_DEFAUT,
        },
    }
}

// ==========================================================================
// Le dict de Python, lu et ecrit
// ==========================================================================
// Ce que `m["boite"]["x1"]`, `d.get("ep") or 0.0` et `p["cle"] = v` faisaient sans y penser.

/// Un nombre du modele ; 0.0 pour ce qui n'en est pas un.
fn f(v: &Json) -> f64 {
    v.as_f64().unwrap_or(0.0)
}

/// Un entier du modele.
fn ent(v: &Json) -> i64 {
    match v {
        Json::Entier(i) => *i,
        Json::Flottant(x) => *x as i64,
        Json::Bool(b) => *b as i64,
        _ => 0,
    }
}

/// Un texte du modele ; "" pour ce qui n'en est pas un.
fn txt(v: &Json) -> &str {
    v.as_str().unwrap_or("")
}

/// Une liste du modele ; vide pour ce qui n'en est pas une (`_liste`, et `x or ()`).
fn liste(v: &Json) -> &[Json] {
    v.as_liste().map(|l| l.as_slice()).unwrap_or(&[])
}

/// Une liste de nombres du modele.
fn reels(v: &Json) -> Vec<f64> {
    liste(v).iter().map(f).collect()
}

/// o[cle] = v ; reecrire une cle ne la deplace pas.
fn poser(o: &mut Json, cle: &str, v: impl Into<Json>) {
    if let Json::Objet(o) = o {
        o.insert(cle.to_string(), v.into());
    }
}

/// o[cle], a modifier en place (cree a None s'il manquait).
fn champ<'a>(o: &'a mut Json, cle: &str) -> &'a mut Json {
    if !matches!(o, Json::Objet(_)) {
        *o = Json::Objet(Objet::new());
    }
    match o {
        Json::Objet(m) => m.entry(cle.to_string()).or_insert(Json::Nul),
        _ => unreachable!(),
    }
}

/// La liste o[cle], a modifier en place.
fn liste_mut<'a>(o: &'a mut Json, cle: &str) -> &'a mut Vec<Json> {
    let v = champ(o, cle);
    if !matches!(v, Json::Liste(_)) {
        *v = Json::Liste(Vec::new());
    }
    match v {
        Json::Liste(l) => l,
        _ => unreachable!(),
    }
}

/// `a or b` sur deux nombres.
fn ou(a: f64, b: f64) -> f64 {
    if a != 0.0 { a } else { b }
}

/// `a or b` sur deux textes.
fn ou_texte(a: String, b: impl Into<String>) -> String {
    if a.is_empty() { b.into() } else { a }
}

/// L'ordre de `sorted()` sur des flottants (stable, sans NaN ici).
fn croissant(a: &f64, b: &f64) -> std::cmp::Ordering {
    a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)
}

/// sorted(set(valeurs)) : de deux valeurs egales (0.0 et -0.0), la premiere venue reste.
fn ensemble_trie(valeurs: impl IntoIterator<Item = f64>) -> Vec<f64> {
    let mut vus = std::collections::HashSet::new();
    let mut out: Vec<f64> = valeurs.into_iter().filter(|v| vus.insert((*v + 0.0).to_bits())).collect();
    out.sort_by(croissant);
    out
}

/// set(round(v, 9) for v in valeurs), pour y chercher.
fn ensemble9(valeurs: impl IntoIterator<Item = f64>) -> std::collections::HashSet<u64> {
    valeurs.into_iter().map(|v| (py::round(v, 9) + 0.0).to_bits()).collect()
}

/// Un point du plan.
pub type P = (f64, f64);

fn pts_json(pts: &[P]) -> Json {
    Json::Liste(pts.iter().map(|(x, y)| nombres([*x, *y])).collect())
}

fn pts_de(v: &Json) -> Vec<P> {
    liste(v).iter().map(|q| (f(&q[0]), f(&q[1]))).collect()
}

/// Un polygone de cuivre : son contour, ses decoupes, et d'ou il vient (« m » : le net de
/// masse seul ; « mixte » : une masse qui a avale un morceau d'antenne).
#[derive(Debug, Clone)]
pub struct Poly {
    pub o: Vec<P>,
    pub t: Vec<Vec<P>>,
    pub m: bool,
    pub mixte: bool,
}

/// Le cuivre d'une couche, avec les cotes de son conducteur.
#[derive(Debug, Clone)]
pub struct Bloc {
    pub couche: String,
    pub z0: f64,
    pub z1: f64,
    pub ep: f64,
    pub ep_geo: f64,
    pub sigma: f64,
    pub role: String,
    pub polys: Vec<Poly>,
}

impl Bloc {
    fn json(&self) -> Json {
        let polys = self.polys.iter().map(|p| {
            let mut q = obj! {"o" => pts_json(&p.o), "t" => Json::Liste(p.t.iter().map(|t| pts_json(t)).collect())};
            if p.m {
                poser(&mut q, "m", true);
            }
            if p.mixte {
                poser(&mut q, "mixte", true);
            }
            q
        }).collect();
        obj! {"couche" => self.couche.clone(), "z0" => self.z0, "z1" => self.z1, "ep" => self.ep,
              "ep_geo" => self.ep_geo, "sigma" => self.sigma, "role" => self.role.clone(),
              "polys" => Json::Liste(polys)}
    }
}

/// m["cuivre"], relu en polygones types pour les calculs de geometrie.
pub(crate) fn cuivre_de(m: &Json) -> Vec<Bloc> {
    liste(&m["cuivre"]).iter().map(|b| Bloc {
        couche: txt(&b["couche"]).to_string(),
        z0: f(&b["z0"]), z1: f(&b["z1"]), ep: f(&b["ep"]), ep_geo: f(&b["ep_geo"]), sigma: f(&b["sigma"]),
        role: txt(&b["role"]).to_string(),
        polys: liste(&b["polys"]).iter().map(|q| Poly {
            o: pts_de(&q["o"]),
            t: liste(&q["t"]).iter().map(pts_de).collect(),
            m: q["m"].vrai(),
            mixte: q["mixte"].vrai(),
        }).collect(),
    }).collect()
}

// ==========================================================================
// Lecture defensive du document
// ==========================================================================
/// Un nombre fini, ou le repli. JSON venu d'un champ de saisie : tout
/// peut arriver, y compris "1,6" avec une virgule et "" tout court.
fn _nb(valeur: &Json, defaut: f64) -> f64 {
    let v = match valeur {
        Json::Nul => return defaut,
        Json::Texte(t) => {
            let t = py::strip(t).replace(',', ".");
            if t.is_empty() {
                return defaut;
            }
            match py::float(&t) {
                Some(v) => v,
                None => return defaut,
            }
        }
        Json::Bool(b) => *b as i64 as f64,
        Json::Entier(i) => *i as f64,
        Json::Flottant(x) => *x,
        Json::GrandEntier(t) => t.parse().unwrap_or(f64::INFINITY),
        _ => return defaut,
    };
    if v.is_finite() { v } else { defaut }
}

fn _nb_pos(valeur: &Json, defaut: f64) -> f64 {
    let v = _nb(valeur, defaut);
    if v > 0.0 { v } else { defaut }
}

fn _texte(valeur: &Json, maxi: usize) -> String {
    match valeur {
        Json::Nul => String::new(),
        v => py_str(v).chars().take(maxi).collect(),
    }
}

/// Millimetres par unite du fichier : « in », « um » (MICRON) ou mm.
fn _k_mm(unite: &Json) -> f64 {
    let u = _texte(unite, 12).to_lowercase();
    if u.starts_with("in") {
        return 25.4;
    }
    if u.starts_with("um") || u.starts_with("micron") || u.starts_with("\u{b5}m") { 1e-3 } else { 1.0 }
}

/// [x1,y1,x2,y2,...] -> [(x,y), ...]. C'est la forme que produit
/// ipc2581_json et que la page transmet sans la retoucher.
fn _polyligne(plat: &Json) -> Vec<P> {
    let plat = liste(plat);
    let mut pts = Vec::new();
    if matches!(plat.first(), Some(Json::Liste(_))) {
        for p in plat { // deja par couples
            if liste(p).len() >= 2 {
                pts.push((_nb(&p[0], 0.0), _nb(&p[1], 0.0)));
            }
        }
    } else {
        for c in plat.chunks_exact(2) {
            pts.push((_nb(&c[0], 0.0), _nb(&c[1], 0.0)));
        }
    }
    // Un polygone ferme explicitement repete son premier point : openEMS le
    // referme lui-meme, et le doublon fait une arete de longueur nulle.
    while pts.len() >= 2 && pts[0] == pts[pts.len() - 1] {
        pts.pop();
    }
    pts
}

/// Aire algebrique (formule du lacet). Le signe dit le sens de parcours.
fn _aire(pts: &[P]) -> f64 {
    let mut a = 0.0;
    let n = pts.len();
    for i in 0..n {
        let (x1, y1) = pts[i];
        let (x2, y2) = pts[(i + 1) % n];
        a += x1 * y2 - x2 * y1;
    }
    a / 2.0
}

/// Force le sens de parcours. openEMS ne l'exige pas pour AddLinPoly,
/// mais un contour et ses trous parcourus dans le meme sens se dessinent
/// mal des qu'on les rend a une bibliotheque geometrique, et la page 3D en
/// fait des `THREE.Shape` ou le sens decide de ce qui est plein.
fn _sens(mut pts: Vec<P>, horaire: bool) -> Vec<P> {
    if pts.len() < 3 {
        return pts;
    }
    // `(a < 0)` dit « ce polygone est parcouru dans le sens horaire ». Il ne
    // faut le retourner que si ce n'est PAS le sens demande.
    if (_aire(&pts) < 0.0) == horaire {
        return pts;
    }
    pts.reverse();
    pts
}

// ==========================================================================
// Le point d'entree
// ==========================================================================

/// Le modele normalise : le dict que la page recoit (`m`, sans triangles), et a cote les pieces
/// importees avec leurs triangles places -- ce que le Python rangeait sous « _geo ».
#[derive(Debug, Clone)]
pub struct Modele {
    pub m: Json,
    pub pieces: Vec<Piece>,
}

/// Document de la page -> modele complet, verifie et chiffre.
///
/// Leve ErreurModele avec un message et un conseil quand le document ne
/// decrit pas une simulation qu'on puisse lancer.
pub fn normaliser(doc: &Json) -> Res<Modele> {
    if doc.as_objet().is_none() {
        return Err(refus("Document JSON (objet) attendu.", ""));
    }

    let k_mm = _k_mm(&doc["unite"]);

    // Comment le cuivre est modelise. « feuille » par defaut : une surface
    // sans epaisseur qui porte quand meme la resistance du cuivre reel.
    let mut modele_cu = ou_texte(_texte(&doc["modele_cuivre"], 12), "feuille").to_lowercase();
    if !matches!(modele_cu.as_str(), "feuille" | "pec" | "volume") {
        modele_cu = "feuille".into();
    }

    let Empilage { conducteurs, dielectriques, z_haut, supposes, revetements } = _empilage(doc, k_mm, &modele_cu)?;
    let Cuivre { blocs: mut cuivre, boite: boite_cu, polygones: mut n_polys, degeneres: n_degeneres, absorbes: n_absorbes } =
        _cuivre(doc, &conducteurs, k_mm)?;
    let mut vias = _vias(doc, &conducteurs, k_mm);
    let bande = _bande(doc)?;
    // La boite de chaque couche : le port microruban part du bord du plan.
    let boites: Vec<(String, [f64; 4])> = cuivre.iter()
        .map(|b| (b.couche.clone(), _boite_pts(&b.polys.iter().flat_map(|p| p.o.iter().copied()).collect::<Vec<P>>()))).collect();
    let mut ports = _ports(doc, &conducteurs, &dielectriques, k_mm, &boite_cu, &boites)?;
    _retards(&mut ports, &bande);
    let primitives = _primitives(doc, k_mm)?;
    let pieces = _pieces(doc, k_mm)?;
    let carte = _carte(doc, k_mm)?;
    // LA MASSE SEULE N'EST PAS UNE ANTENNE. Si tout le cuivre recu vient du
    // net de masse (marque « m » par la page), rien n'a ete designe comme
    // antenne : le calcul porterait sur le plan de masse de la carte, et il
    // durerait des heures pour ne rien dire.
    if cuivre.iter().flat_map(|b| &b.polys).all(|q| q.m) && cuivre.iter().flat_map(|b| &b.polys).any(|q| q.m) {
        return Err(refus(
            "Aucune antenne designee : seul le net de masse est retenu.",
            "A l'etape « Le cuivre », cliquez le cuivre de l'antenne sur la \
             carte (Ctrl+clic pour plusieurs morceaux), puis « Prendre la \
             selection de la carte »."));
    }
    let n_vias_avant = vias.len();
    let masse = _masse_cachee(doc, &mut cuivre, &conducteurs, &mut vias, &ports);
    n_polys -= masse.retires.iter().map(|(_, n)| *n).sum::<i64>();
    let (conducteurs, dielectriques, empilage_reduit) = _reduire_empilage(conducteurs, dielectriques, &cuivre, &vias, &ports);
    // UN DEGAGEMENT NE PERCE QUE CE QUI EXISTE. Ceux du coaxial ont ete poses
    // sur l'empilage entier, avant la fusion : une couche interne vide,
    // fusionnee avec ses deux substrats, gardait le sien -- et le script
    // l'ecrivait en disque d'AIR au milieu du FR-4 fusionne, faute de face de
    // substrat a sa cote.
    for p in ports.iter_mut().filter(|p| p["coax"].vrai()) {
        liste_mut(champ(p, "coax"), "degagements").retain(|d| conducteurs.iter().any(|c| c["nom"] == d["couche"]));
    }

    // L'EMPRISE EST L'UNION DE TOUT CE QUI EXISTE, et pas seulement du cuivre :
    // une marge d'air mesuree depuis la carte seule laisserait un boitier ou
    // un fil DANS la couche absorbante — c'est-a-dire hors du calcul, sans
    // que rien ne le dise.
    //
    // DEUX EMPRISES, ET LE PAS FIN SEULEMENT DANS LA PREMIERE. `emprise_fin`
    // est ce que le pas du DIELECTRIQUE doit couvrir : le cuivre, ses ports,
    // les objets saisis a la main. Le reste de l'emprise -- la carte au-dela
    // du cuivre, un boitier, des piles -- recoit le pas de SA matiere,
    // lambda/20/racine(er). Avant, tout etait au pas fin, et ce pas-la est
    // souvent tenu par la largeur d'une piste : un boitier ABS de 60 mm
    // maille au quart d'un ruban de 0,5 mm faisait trois fois le calcul de
    // l'antenne seule, pour une paroi qui n'en demandait pas tant.
    let mut emprise_fin = [boite_cu[0], boite_cu[1], 0.0, boite_cu[2], boite_cu[3], z_haut];
    let etendre = |emprise: &mut [f64; 6], e: &[f64; 6]| {
        for k in 0..3 {
            emprise[k] = mini(emprise[k], e[k]);
            emprise[k + 3] = maxi(emprise[k + 3], e[k + 3]);
        }
    };
    for e in primitives.iter().map(_emprise_primitive).chain(ports.iter().map(_emprise_port)) {
        etendre(&mut emprise_fin, &e);
    }
    let mut emprise = emprise_fin;
    if let Some(carte) = &carte {
        let cb = reels(&carte["boite"]);
        emprise = [mini(emprise[0], cb[0]), mini(emprise[1], cb[1]), emprise[2],
                   maxi(emprise[3], cb[2]), maxi(emprise[4], cb[3]), emprise[5]];
    }
    for e in pieces::emprises(&pieces) {
        etendre(&mut emprise, &e);
    }

    // LA RESOLUTION AVANT LA BOITE, ET NON L'INVERSE : l'epaisseur de la PML
    // vaut N cellules, donc la marge conseillee depend du pas de maillage.
    let er_max = if dielectriques.is_empty() { 1.0 } else { max_de(dielectriques.iter().map(|d| f(&d["er"]))) };
    let (res_air, res_die, mut res_detail) = _resolution(&bande, er_max, &cuivre, &boite_cu);
    // LE PAS HORS DU CUIVRE : lambda/20 dans la matiere la plus lente qu'on y
    // trouve -- une paroi de verre (er 6,5), le stratifie de la carte entiere.
    // Jamais plus fin que le pas du dielectrique, jamais plus grossier que
    // celui de l'air.
    let ers: Vec<f64> = pieces::corps_inclus(&pieces).filter(|(_, c)| c.materiau == "dielectrique").map(|(_, c)| c.er)
        .chain(carte.is_some().then_some(er_max)).collect();
    let er_ext = if ers.is_empty() { 1.0 } else { max_de(ers) };
    let m = &doc["maillage"];
    let res_air_saisi = _nb_pos(&m["res_air"], 0.0) * k_mm;
    let res_air = ou(res_air_saisi, res_air);
    poser(&mut res_detail, "saisi_air", res_air_saisi != 0.0);
    // UNE VALEUR SAISIE RESTE UNE VALEUR SAISIE. Les bornes ci-dessus sont des
    // defauts calcules : si l'utilisateur a ecrit un pas, c'est le sien qui
    // part au solveur, meme plus grossier -- il sait ce qu'il eprouve.
    let res_die_saisi = _nb_pos(&m["res_die"], 0.0) * k_mm;
    let res_die = ou(res_die_saisi, res_die);
    poser(&mut res_detail, "saisi", res_die_saisi != 0.0);
    let res_ext = mini(res_air, maxi(res_die, res_air / maxi(1.0, er_ext).sqrt()));
    poser(&mut res_detail, "ext", res_ext);
    poser(&mut res_detail, "er_ext", er_ext);
    let boite = _boite(doc, &emprise, &bande, res_air, k_mm);
    let tiers = if matches!(m["tiers"], Json::Nul) { TIERS_DEFAUT } else { m["tiers"].vrai() };

    let arret = &doc["arret"];
    let nf2ff = &doc["nf2ff"];
    // float(v) : ce que Python ne saurait pas convertir est laisse (il s'y arretait)
    let angles = |v: &Json, defaut: Vec<f64>| -> Json {
        let lus: Vec<f64> = liste(v).iter().filter_map(|a| match a {
            Json::Texte(t) => py::float(t),
            Json::Liste(_) | Json::Objet(_) | Json::Nul => None,
            a => a.as_f64(),
        }).collect();
        nombres(if lus.is_empty() { defaut } else { lus })
    };
    let frequences: Vec<f64> = liste(&nf2ff["f"]).iter().map(|v| _nb_pos(v, 0.0)).filter(|v| *v != 0.0).collect();
    let n_corps = pieces::corps_inclus(&pieces).count();
    let n_triangles: usize = pieces::corps_inclus(&pieces).filter_map(|(_, c)| c.inclus.as_ref()).map(|i| i.triangles).sum();
    let dict = |paires: &[(String, Json)]| Json::Objet(paires.iter().cloned().collect());

    let mut modele = obj! {
        "format" => "openems-antenne-1",
        "nom" => _texte(&doc["nom"], 200),
        "unite_mm" => k_mm,
        "modele_cuivre" => modele_cu,
        "conducteurs" => Json::Liste(conducteurs),
        "dielectriques" => Json::Liste(dielectriques),
        "z_haut" => z_haut,
        "cuivre" => Json::Liste(cuivre.iter().map(Bloc::json).collect()),
        "vias" => Json::Liste(vias.clone()),
        "boite_cuivre" => nombres(boite_cu),
        "emprise" => nombres(emprise),
        "emprise_fin" => nombres(emprise_fin),
        "primitives" => Json::Liste(primitives.clone()),
        "pieces" => Json::Liste(pieces.iter().map(Piece::json).collect()),
        "carte" => carte.unwrap_or(Json::Nul),
        // Le port excite : le meme objet que dans « ports » ; il est repris a la fin, une fois
        // ses cotes collees sur la grille.
        "port" => Json::Nul,
        "ports" => Json::Liste(ports.clone()),
        // Plusieurs ports excites ensemble : un reseau (voir MAX_PORTS).
        "reseau" => ports.iter().filter(|p| p["excite"].vrai()).count() > 1,
        "bande" => bande.clone(),
        "boite" => boite.clone(),
        "maillage_tiers" => tiers,
        "resolution" => obj! {"air" => res_air, "die" => res_die, "ext" => res_ext,
                              "er_max" => er_max,
                              "detail" => res_detail,
                              "lambda_min_mm" => C0 / f(&bande["f2"]) * 1000.0,
                              "lambda_max_mm" => C0 / f(&bande["f1"]) * 1000.0},
        "arret" => obj! {
            // L'ENERGIE D'ARRET EST NEGATIVE, ET C'EST TOUT LE PIEGE. Elle
            // s'ecrit en decibels sous le maximum : -40 dB, -50 dB pour un
            // resonateur a fort Q. La page l'envoie donc toujours negative
            // (voir `ANT.arret.energie = -Math.abs(v)` dans 13-assistant.js).
            // La passer a `_nb_pos`, qui rend son defaut des que la valeur est
            // <= 0, rendait le champ MUET : toute saisie retombait sur -40, y
            // compris le -50 dB que l'interface conseille elle-meme. C'est
            // `_nb` qu'il faut, et le `or` ne couvre que le zero — une bande
            // d'arret nulle n'arreterait jamais rien.
            //
            // LE SIGNE EST NORMALISE ET NON EXIGE : ecrire 50 ou -50 veut dire
            // la meme chose pour qui parle de « cinquante decibels sous le
            // maximum », et refuser l'un des deux ne protegerait de rien.
            // La VALEUR, elle, n'est pas bornee : une valeur saisie reste une
            // valeur saisie, comme pour le pas de maillage plus haut.
            "energie_dB" => -f64::abs(ou(_nb(&arret["energie"], ENERGIE_DEFAUT), ENERGIE_DEFAUT)),
            // ZERO VEUT DIRE « CALCULE-LE », comme partout ailleurs dans ce
            // document -- un pas de maillage a zero veut deja dire « au
            // mailleur de decider ». Le compteur est le seul reglage dont la
            // bonne valeur ne se devine pas : elle depend du pas de temps,
            // donc du maillage, donc de la geometrie. Trente mille pas etaient
            // de trop pour un monopole et trois fois trop peu pour un IFA
            // finement maille, et rien dans le nombre ne le disait. Il est
            // resolu plus bas, une fois le pas de temps connu.
            "nmax" => _nb_pos(&arret["nmax"], 0.0) as i64,
        },
        // Les fils de calcul passes a openEMS (`numThreads`). Reglage du
        // POSTE et non du document -- voir « Les fils de calcul » plus haut.
        // Le reglage, ou a defaut le meilleur du banc (`fils_effectif`) ; 0
        // seulement quand aucun banc n'a encore parle : openEMS tatonne.
        "fils" => fils_effectif(),
        "nf2ff" => obj! {
            "actif" => nf2ff["actif"].vrai(),
            // Les angles sont en degres dans le document, en radians nulle
            // part : c'est la page qui les affiche, autant qu'ils restent
            // lisibles de bout en bout.
            "theta" => angles(&nf2ff["theta"], (-180..=180).step_by(2).map(|i| i as f64).collect()),
            "phi" => angles(&nf2ff["phi"], vec![0.0, 90.0]),
            "f" => nombres(if frequences.is_empty() { vec![f(&bande["fcible"])] } else { frequences }),
        },
        "supposes" => Json::Liste(supposes.into_iter().map(Json::Texte).collect()),
        // Les revetements exterieurs de l'empilage, gardes ou non, avec ce qui
        // l'a decide. La page en fait une ligne par couche et une case a
        // cocher ; l'avis, plus bas, nomme ceux qui sont sortis.
        "revetements" => Json::Liste(revetements),
        // Couches de cuivre inutilisees retirees de l'empilage, leurs deux
        // dielectriques identiques fusionnes. Voir `_reduire_empilage`.
        "empilage_reduit" => Json::Liste(empilage_reduit.into_iter().map(Json::Texte).collect()),
        // La masse retiree parce que le plan de reference la cache a
        // l'antenne. Voir `_masse_cachee`.
        "masse_cachee" => obj! {"reference" => masse.reference.map(Json::Texte).unwrap_or(Json::Nul),
                                "retires" => dict(&masse.retires.iter().map(|(c, n)| (c.clone(), Json::Entier(*n))).collect::<Vec<_>>()),
                                "vias_retires" => n_vias_avant - vias.len(),
                                "antenne_derriere" => dict(&masse.antenne_derriere.iter().map(|(c, a)| (c.clone(), Json::Flottant(*a))).collect::<Vec<_>>()),
                                "gardes_proches" => masse.proches},
        "stats" => obj! {"polygones" => n_polys, "degeneres" => n_degeneres,
                         "absorbes" => n_absorbes,
                         "vias" => vias.len(),
                         "couches_cuivre" => cuivre.len(),
                         "primitives" => primitives.len(),
                         "pieces" => pieces.len(),
                         "corps" => n_corps,
                         "triangles" => n_triangles},
    };

    let (mx, my, mz) = _mailler(&mut modele, &cuivre, &pieces, &bande, res_air, res_die)?;
    poser(&mut modele, "maillage", obj! {"x" => nombres(mx), "y" => nombres(my), "z" => nombres(mz.iter().copied())});
    // LES ECARTS QUE CETTE GRILLE SOUDERAIT, ouverts avant tout le reste : le
    // collage des ports, l'estimation et le pas de temps doivent voir la
    // grille finale. `mx` et `my` sont completes EN PLACE.
    // Voir `_ouvrir_ecarts`.
    let bilan = _ouvrir_ecarts(&mut modele, &cuivre);
    poser(&mut modele, "ecarts_ouverts", bilan);
    let (mx, my) = (reels(&modele["maillage"]["x"]), reels(&modele["maillage"]["y"]));
    // LES COTES DES PORTS, COLLEES SUR LES LIGNES DE MAILLAGE. Un ecart de
    // quatre microns suffit a ce qu'une boite d'excitation plate n'excite plus
    // rien du tout, sans autre signe qu'un avertissement noye au demarrage et
    // une energie nulle. Voir `_coller_ports`.
    let colle = _coller_ports(&mut modele);
    poser(&mut modele, "ports_colles_mm", colle);
    // APRES LE MAILLAGE, ET SUR LUI : un ecart n'est franc ou soude que selon
    // les lignes qui tombent dedans. Voir `_ponts_de_maille`.
    let sites = ponts::ponts(&cuivre, &mx, &my, res_die, true);
    poser(&mut modele, "ponts_maille", Json::Liste(sites.iter().map(ponts::Site::json).collect()));
    poser(&mut modele, "estimation", _estimation(&mx, &my, &mz, res_die));
    // QUI FABRIQUE LA PLUS PETITE CELLULE -- la question que l'avis et le
    // rapport posaient chacun de son cote, et a laquelle le modele repond
    // desormais une fois pour toutes. Voir `_coupable_cellule`.
    let cellule = _coupable_cellule(&modele);
    poser(champ(&mut modele, "estimation"), "cellule", cellule);

    // -- le compteur de pas, calcule si on ne l'a pas impose -----------------
    // APRES L'ESTIMATION, PARCE QU'IL FAUT LE PAS DE TEMPS. L'impulsion dure un
    // temps physique fixe -- il ne depend que de la largeur de bande -- mais le
    // nombre de PAS qu'elle occupe depend de dt, c'est-a-dire de la plus petite
    // cellule. C'est toute la raison pour laquelle un nombre saisi une fois ne
    // vaut plus rien des qu'on retouche le maillage.
    let dt_s = f(&modele["estimation"]["dt_s"]);
    let t_exc = f(&bande["t_excitation"]);
    let f_res = ou(f(&bande["fcible"]), f(&bande["f0"]));
    // DEUX CRITERES, ET C'EST LE PLUS GRAND QUI GAGNE : le temps d'emettre
    // l'impulsion, et le temps de l'oublier. Voir NMAX_PERIODES.
    // Un port dephase part EN RETARD : son impulsion finit plus tard d'autant.
    let retards: Vec<f64> = liste(&modele["ports"]).iter().map(|p| f(&p["retard_s"])).collect();
    let retard = if retards.is_empty() { 0.0 } else { max_de(retards) };
    let n_imp = if dt_s > 0.0 && t_exc > 0.0 { (NMAX_IMPULSIONS * t_exc + retard) / dt_s } else { 0.0 };
    let n_dec = if dt_s > 0.0 && f_res > 0.0 { NMAX_PERIODES / (f_res * dt_s) } else { 0.0 };
    let nmax_calcule = if n_imp > 0.0 || n_dec > 0.0 {
        NMAX_PLANCHER.max(maxi(n_imp, n_dec).ceil() as i64)
    } else {
        NMAX_DEFAUT
    };
    // IL EST CALCULE MEME QUAND IL EST IMPOSE, et la page s'en sert pour dire
    // a cote d'un nombre saisi celui que le modele proposait. Un reglage qu'on
    // impose sans voir ce qu'on refuse n'est pas un reglage, c'est un pari.
    let regle = champ(&mut modele, "arret");
    poser(regle, "nmax_calcule", nmax_calcule);
    poser(regle, "nmax_detail", obj! {
        "impulsion" => n_imp.ceil() as i64,
        "decroissance" => n_dec.ceil() as i64,
        "periodes" => NMAX_PERIODES,
        "f_res" => f_res,
    });
    if ent(&regle["nmax"]) <= 0 {
        poser(regle, "nmax", nmax_calcule);
        poser(regle, "nmax_auto", true);
    } else {
        poser(regle, "nmax_auto", false);
    }
    let nmax = ent(&regle["nmax"]);

    // LA DUREE PART AVEC LE MODELE, calculee ICI et nulle part ailleurs. La
    // page refaisait son propre compte -- vingt periodes a f0 -- et affichait
    // « 87 min » au-dessus d'un avis qui disait « 3 h 06 » sur le meme
    // maillage. Un seul chiffre, celui de `duree_estimee`.
    let duree = duree_estimee(&modele);
    poser(champ(&mut modele, "estimation"), "duree_s", duree);

    poser(&mut modele, "dumps", _dumps(doc, &emprise, &boite, &bande, &mx, &my, &mz, nmax));

    // LES PERTES APRES LE MAILLAGE, ET NON L'INVERSE : la borne qui decide
    // quels poles de Debye le solveur acceptera est « trois pas de temps », et
    // le pas de temps ne se connait qu'une fois la plus petite cellule connue.
    let pertes = _pertes(doc, liste_mut(&mut modele, "dielectriques"), &bande, dt_s);
    poser(&mut modele, "pertes", pertes);

    // Ce que l'assistant a a dire : des avis, pas des refus. Ils partent avec
    // le modele et la page les affiche tels quels.
    let remarques = _avis(&modele);
    poser(&mut modele, "avis", Json::Liste(remarques));
    // LE PORT EXCITE RESTE ACCESSIBLE SOUS SON ANCIEN NOM. C'est lui que la
    // vue 3D dessine en rouge, lui que l'export Touchstone nomme, lui dont
    // l'assistant recapitule le volume : tout ce qui ne parle que d'UN port
    // parle de celui-la, et n'a pas eu a changer.
    let port = liste(&modele["ports"]).iter().find(|p| p["excite"].vrai()).cloned().unwrap_or(Json::Nul);
    poser(&mut modele, "port", port);
    Ok(Modele { m: modele, pieces })
}

/// Un ordre de grandeur : cellules x pas de temps divise par un debit.
///
/// Ce debit est celui que ce poste a MONTRE, des qu'un calcul y a fini (voir
/// `noter_debit`) ; avant cela, c'est la valeur supposee. Meme mesure, la
/// duree reste un ordre de grandeur : le maillage suivant n'a pas la meme
/// empreinte memoire, et annoncer « 14 min 32 s » serait une precision
/// mensongere. Sert au balayage, qui multiplie cette duree par son nombre de
/// points : c'est la que l'ordre de grandeur compte vraiment, parce que c'est
/// la qu'on lance une nuit de calcul sans la voir venir.
pub fn duree_estimee(m: &Json) -> f64 {
    // LE GARDE-FOU, ET NON UNE MOITIE DE GARDE-FOU. Cette fonction recalculait
    // son propre nombre de pas -- 20 periodes autour de f0 -- et rendait le
    // plus petit des deux, si bien qu'elle annoncait systematiquement la
    // moitie de ce que `nmax` autorise. L'energie arrete presque toujours la
    // simulation avant ; PRESQUE, et c'est le mot qui coute : une antenne qui
    // ne s'eteint pas va jusqu'au bout, et c'est precisement le cas ou l'on
    // aurait voulu etre prevenu.
    let e = &m["estimation"];
    // un produit d'entiers, exact, avant la division
    (ent(&e["cellules"]) as i128 * ent(&m["arret"]["nmax"]) as i128) as f64 / (f(&e["mcps_suppose"]) * 1e6)
}

/// Une duree en toutes lettres, a la precision qu'elle merite.
pub fn _duree_texte(s: f64) -> String {
    if s < 90.0 {
        return format!("{} s", s.round_ties_even() as i64);
    }
    if s < 5400.0 {
        return format!("{} min", (s / 60.0).round_ties_even() as i64);
    }
    let mut h = (s / 3600.0).floor() as i64;
    let mut m = ((s - 3600.0 * h as f64) / 60.0).round_ties_even() as i64;
    if m == 60 {
        (h, m) = (h + 1, 0);
    }
    format!("{} h {:02}", h, m)
}

// ==========================================================================
// Le balayage parametrique
// ==========================================================================
// POURQUOI IL EXISTE. Un gabarit d'antenne tombe a 2 ou 5 % de la resonance
// visee, et la premiere simulation ne dit pas « c'est bon » : elle dit « c'est
// 3 % trop bas ». Le geste qui suit est toujours le meme -- rallonger le patch
// de quatre dixiemes de millimetre et relancer -- et le refaire a la main six
// fois, c'est six fois l'occasion de changer deux choses au lieu d'une et de
// ne plus savoir laquelle a compte.
//
// CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS. Il ne cherche rien : ce
// n'est pas un optimiseur, il n'y a ni gradient, ni critere, ni convergence.
// Il prend UNE liste de valeurs, et il rend UNE courbe par valeur. La lecture
// reste humaine, et c'est voulu : un optimiseur qui rend « L = 38,46 mm » sans
// la famille de courbes cache la seule chose qui apprenne quelque chose, la
// SENSIBILITE -- de combien la resonance bouge pour un dixieme de millimetre.
//
// COMMENT UN POINT EST DECRIT. Pas par une formule, mais par des MODIFICATIONS
// du document : « remplace tel polygone par celui-ci ». C'est la page qui les
// calcule, parce que c'est elle qui sait ce qu'est « la longueur du patch » --
// un modele FDTD, lui, ne connait que du metal. Le serveur, de son cote, ne
// voit qu'un document par point, qu'il relit exactement comme les autres :
// aucun chemin de code n'echappe aux refus habituels.
pub const MAX_POINTS: usize = 40;

/// int(b) pour un segment de chemin, et l'indice qu'il designe dans une liste de `n` elements
/// (un indice negatif compte depuis la fin).
fn indice(b: &str, n: usize) -> Option<usize> {
    let i: i64 = py::strip(b).parse().ok()?;
    let i = if i < 0 { i + n as i64 } else { i };
    (0 <= i && (i as usize) < n).then_some(i as usize)
}

/// Le conteneur et la derniere clef d'un chemin « a.b.0.c ».
///
/// Les segments entiers indexent une liste, les autres une table. Un chemin
/// qui ne mene nulle part est un refus et non un silence : une modification
/// qui ne s'applique pas donnerait un point de balayage IDENTIQUE aux autres,
/// et une courbe superposee qu'on prendrait pour un resultat.
fn _pas_a_pas<'a>(racine: &'a mut Json, chemin: &str) -> Res<(&'a mut Json, String)> {
    let bouts: Vec<&str> = chemin.split('.').filter(|b| !b.is_empty()).collect();
    let Some((dernier, debut)) = bouts.split_last() else {
        return Err(refus("Chemin de modification vide.",
                         "Chaque point de balayage doit dire ce qu'il change."));
    };
    let mut ici = racine;
    for (i, b) in debut.iter().enumerate() {
        let suite = match ici {
            Json::Liste(l) => indice(b, l.len()).map(|k| &mut l[k]),
            Json::Objet(o) => o.get_mut(*b),
            _ => None,
        };
        let Some(suite) = suite else {
            return Err(refus(
                format!("Le balayage designe « {} », qui n'existe pas dans le \
                         document (bloque a « {} »).", chemin, bouts[..i + 1].join(".")),
                "C'est la page qui calcule ces chemins : celui-ci designe une \
                 geometrie qui a change depuis. Refaites le balayage."));
        };
        ici = suite;
    }
    Ok((ici, dernier.to_string()))
}

fn _appliquer(racine: &mut Json, chemin: &str, valeur: Json) -> Res<()> {
    let (ici, clef) = _pas_a_pas(racine, chemin)?;
    match ici {
        Json::Liste(l) => match indice(&clef, l.len()) {
            Some(k) => l[k] = valeur,
            None => {
                return Err(refus(
                    format!("Le balayage ecrit a l'indice « {} » d'une liste qui ne va \
                             pas jusque-la (« {} »).", clef, chemin),
                    "Refaites le balayage : le dessin a change depuis."));
            }
        },
        Json::Objet(o) => {
            o.insert(clef, valeur);
        }
        _ => {
            return Err(refus(
                format!("Le balayage ecrit dans « {} », qui n'est ni une liste ni un \
                         objet.", chemin), "Refaites le balayage."));
        }
    }
    Ok(())
}

/// Ce que `balayage` et `tableau_s` rendent : le dict de la page -- chaque « modele » y est
/// sans triangles -- et, dans le meme ordre, les pieces de chaque modele avec les leurs.
#[derive(Debug, Clone)]
pub struct Suite {
    pub json: Json,
    pub pieces: Vec<Vec<Piece>>,
}

/// Le document sans son « balayage ».
fn sans_balayage(doc: &Json) -> Json {
    Json::Objet(doc.as_objet().map(|o| o.iter().filter(|(k, _)| *k != "balayage").map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default())
}

/// La somme des cellules, celle des durees et la plus grosse memoire d'une suite de modeles.
fn estimation_suite(modeles: &[&Json]) -> Json {
    obj! {"cellules" => modeles.iter().map(|m| ent(&m["estimation"]["cellules"])).sum::<i64>(),
          "duree_s" => py::sum(modeles.iter().map(|m| duree_estimee(m))),
          "memoire_Mo" => max_de(modeles.iter().map(|m| f(&m["estimation"]["memoire_Mo"])))}
}

/// Un document + une liste de points -> autant de modeles verifies.
///
/// TOUS LES POINTS SONT VERIFIES AVANT QUE LE PREMIER NE PARTE. Decouvrir au
/// quatorzieme point, une heure plus tard, que le port y tombe hors du cuivre
/// serait la pire facon de l'apprendre : le refus arrive donc avant le
/// lancement, et il dit QUEL point est en cause.
pub fn balayage(doc: &Json) -> Res<Suite> {
    if doc.as_objet().is_none() {
        return Err(refus("Document JSON (objet) attendu.", ""));
    }
    let b = &doc["balayage"];
    let points = liste(&b["points"]);
    if points.len() < 2 {
        return Err(refus(
            format!("Un balayage demande au moins deux points ({} recu).", points.len()),
            "Un seul point, c'est une simulation ordinaire : le bouton \
             « Lancer » la fait."));
    }
    if points.len() > MAX_POINTS {
        return Err(refus(
            format!("{} points demandes, {} au plus.", points.len(), MAX_POINTS),
            "Chaque point est une simulation complete. Au-dela, c'est une \
             nuit de calcul qu'on lance sans la voir venir : resserrez la \
             plage, ou elargissez le pas."));
    }

    let mut base = sans_balayage(doc);

    // LE MAILLAGE SE FIGE SUR LE POINT DE DEPART, ET IL LE FAUT DEPUIS QUE LE
    // PAS DEPEND DE LA GEOMETRIE. Une cote balayee change la largeur du cuivre
    // le plus etroit ; sans cette ligne, chaque point recevrait un maillage
    // different, et la famille de courbes melangerait ce que la cote fait a
    // l'antenne avec ce que le maillage fait au calcul — c'est-a-dire
    // exactement ce qu'un balayage sert a separer. On normalise donc le
    // document de depart une fois, et on impose SON pas a tous les points.
    let reference = normaliser(&base)?.m;
    if _nb_pos(&base["maillage"]["res_die"], 0.0) == 0.0 {
        let unite = f(&reference["unite_mm"]);
        let mut m_base = if base["maillage"].as_objet().is_some() { base["maillage"].clone() } else { obj! {} };
        poser(&mut m_base, "res_die", f(&reference["resolution"]["die"]) / unite);
        if !m_base["res_air"].vrai() {
            poser(&mut m_base, "res_air", f(&reference["resolution"]["air"]) / unite);
        }
        poser(&mut base, "maillage", m_base);
    }

    let (mut out, mut pieces) = (Vec::new(), Vec::new());
    for (i, pt) in points.iter().enumerate() {
        let mut d = base.clone();
        for modif in liste(&pt["modifs"]) {
            _appliquer(&mut d, &_texte(&modif["chemin"], 400), modif["valeur"].clone())?;
        }
        let m = normaliser(&d).map_err(|exc| refus(
            format!("Le point {} du balayage ({}) est refuse : {}",
                    i + 1, ou_texte(_texte(&pt["etiquette"], 40), "?"), exc.message),
            &exc.conseil))?;
        // `valeur2` n'existe que sur un balayage CROISE : c'est la cote du
        // second axe. Elle ne sert a rien ici — le point est deja decrit par
        // ses modifications — mais elle permet a la page de ranger les
        // resultats en tableau au lieu d'une liste de N*M lignes.
        let v2 = &pt["valeur2"];
        out.push(obj! {
            "etiquette" => ou_texte(_texte(&pt["etiquette"], 40), (i + 1).to_string()),
            "valeur" => _nb(&pt["valeur"], i as f64),
            "valeur2" => if matches!(v2, Json::Entier(_) | Json::Flottant(_) | Json::Bool(_) | Json::GrandEntier(_)) {
                Json::Flottant(_nb(v2, 0.0))
            } else {
                Json::Nul
            },
            "modele" => m.m,
        });
        pieces.push(m.pieces);
    }

    let estimation = estimation_suite(&out.iter().map(|p| &p["modele"]).collect::<Vec<_>>());
    let croise = b["croise"].vrai() && out.iter().any(|p| !matches!(p["valeur2"], Json::Nul));
    Ok(Suite {
        json: obj! {
            "nom" => ou_texte(_texte(&b["nom"], 80), "parametre"),
            "unite" => _texte(&b["unite"], 16),
            // LE SECOND AXE EST UN PRODUIT, PAS UNE SOMME, et c'est la seule chose
            // qui change ici : `MAX_POINTS` porte sur la liste des points, donc
            // deja sur le produit. Six valeurs croisees avec six font trente-six
            // points, et le garde-fou les compte tous les trente-six.
            "croise" => croise,
            "nom2" => if croise { _texte(&b["nom2"], 80) } else { String::new() },
            "unite2" => if croise { _texte(&b["unite2"], 16) } else { String::new() },
            "points" => Json::Liste(out),
            "estimation" => estimation,
        },
        pieces,
    })
}

// ==========================================================================
// Le tableau S complet
// --------------------------------------------------------------------------
// CE QUI MANQUAIT, ET CE QUE CELA CHANGE. Une simulation rend UNE COLONNE du
// tableau : le port j excite, on lit ce qui revient en j et ce qui sort de
// chacun des autres. C'est la definition meme d'un parametre S, et ce n'etait
// pas une limite de l'outil -- mais obtenir le tableau entier demandait de
// deplacer l'excitation a la main, de relancer, et de ranger soi-meme les
// colonnes ensemble. Ce que cette fonction ajoute n'est donc PAS un calcul :
// c'est l'ENCHAINEMENT. N documents identiques a un drapeau pres, verifies
// tous avant que le premier ne parte.
//
// POURQUOI C'EST LE MEME CHEMIN QUE LE BALAYAGE. Les deux font la meme chose
// -- une suite de simulations dont on assemble les resultats --, et un second
// chemin vers le solveur serait un second endroit ou les refus pourraient
// diverger. Chaque colonne passe par `normaliser` comme n'importe quel
// document : le port qui tombe hors du cuivre est refuse ici aussi.
//
// CE QUE CELA COUTE, ET IL FAUT LE DIRE AVANT. La duree est multipliee par le
// nombre de ports. Quatre ports, c'est quatre fois la nuit de calcul -- et
// c'est exactement le genre d'engagement qu'on prend sans le voir venir si
// l'annonce ne le dit pas. `estimation.duree_s` porte le total, pas la colonne.
/// Un document a N ports -> N modeles verifies, un par port excite.
pub fn tableau_s(doc: &Json) -> Res<Suite> {
    if doc.as_objet().is_none() {
        return Err(refus("Document JSON (objet) attendu.", ""));
    }

    let base = sans_balayage(doc);
    let reference = normaliser(&base)?.m;
    let ports = liste(&reference["ports"]);
    let n = ports.len();
    if n < 2 {
        return Err(refus(
            format!("Un tableau S complet demande au moins deux ports ({} pose).", n),
            "Avec un seul port, le tableau se reduit a S11 — c'est ce que le \
             bouton « Lancer » rend deja, en une simulation."));
    }

    if liste(&base["ports"]).iter().filter(|q| q.as_objet().is_some()).count() != n {
        return Err(refus(
            format!("Le document ne porte pas la liste de ses {} ports.", n),
            "Le tableau complet deplace l'excitation d'un port a l'autre : il \
             lui faut la liste, et non le port unique de l'ancienne forme."));
    }

    let (mut colonnes, mut pieces) = (Vec::new(), Vec::new());
    for j in 0..n {
        let mut d = base.clone();
        for (k, q) in liste_mut(&mut d, "ports").iter_mut().enumerate() {
            poser(q, "excite", k == j);
        }
        let m = normaliser(&d).map_err(|exc| refus(
            format!("La colonne du port {} est refusee : {}", j + 1, exc.message), &exc.conseil))?;
        colonnes.push(obj! {"n" => j + 1, "nom" => ports[j]["nom"].clone(), "modele" => m.m});
        pieces.push(m.pieces);
    }

    // LES COLONNES DOIVENT PARTAGER LEUR AXE DE FREQUENCE, sans quoi elles ne
    // se rangent pas dans un meme tableau. Elles le partagent par construction
    // -- seul un drapeau les separe --, et c'est justement pour cela qu'on le
    // verifie : ce qui doit etre vrai par construction est ce qui se casse en
    // silence le jour ou la construction change.
    for c in &colonnes[1..] {
        if c["modele"]["bande"] != colonnes[0]["modele"]["bande"]
            || c["modele"]["estimation"]["cellules"] != colonnes[0]["modele"]["estimation"]["cellules"] {
            return Err(refus(
                "Les colonnes du tableau S n'ont pas le meme maillage ou la \
                 meme bande.",
                "Elles ne different que par le port excite : si le reste \
                 differe, le tableau melangerait deux simulations \
                 incomparables."));
        }
    }

    let estimation = estimation_suite(&colonnes.iter().map(|c| &c["modele"]).collect::<Vec<_>>());
    Ok(Suite {
        json: obj! {
            "ports" => Json::Liste(ports.iter().map(|q| obj! {"n" => q["n"].clone(), "nom" => q["nom"].clone(),
                                                              "type" => q["type"].clone(), "R" => q["R"].clone()}).collect()),
            "colonnes" => Json::Liste(colonnes),
            "estimation" => estimation,
        },
        pieces,
    })
}
