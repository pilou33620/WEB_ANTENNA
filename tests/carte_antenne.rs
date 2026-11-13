// ==========================================================================
// Fabrique une carte d'essai IPC-2581 portant une antenne patch 2,45 GHz.
//
//   cargo test --test carte_antenne                                   compare a test/patch-2450.xml
//   CARTE_ANTENNE_SORTIE=sortie.xml cargo test --test carte_antenne   ecrit la carte
//
// POURQUOI UNE CARTE FABRIQUEE ET NON UN EXPORT REEL. Un fichier de
// fabrication reel porte le nom du client, la revision du produit et le
// routage entier : il ne se met pas dans un depot. Celui-ci est minimal et
// EXACT — deux couches, un patch dont la resonance se calcule a la main, un
// plan de masse — et il sert a trois choses : essayer l'outil sans rien avoir
// sous la main, verifier que la chaine complete tourne, et donner un resultat
// dont on connait d'avance l'ordre de grandeur.
//
// La geometrie est celle des essais du modele (modele/essais/) : un patch
// rectangulaire alimente par sonde, sur FR-4 de 1,6 mm. Sa resonance attendue
// est de 2,45 GHz a quelques pour-cent pres.
//
// C'est test/carte-antenne.py : le fichier rendu est le meme, a l'octet.
// ==========================================================================

const C0: f64 = 299792458.0;

const ER: f64 = 4.3;
const DF: f64 = 0.02;
const H: f64 = 1.6; // epaisseur du substrat, mm
const EP_CU: f64 = 0.035;

const CARTE_X: f64 = 70.0; // la carte, et le plan de masse
const CARTE_Y: f64 = 70.0;
const W_PATCH: f64 = 38.0;

// La sonde d'alimentation : sur l'axe du patch, au tiers de sa longueur.
// C'est la, en gros, que l'impedance d'entree d'un patch passe par 50 ohms.
const FEED_D: f64 = 1.3; // diametre du percage de la sonde

/// Une <Polygon> IPC-2581 a partir d'une liste de couples.
fn poly(points: &[(f64, f64)]) -> String {
    let mut pts = points.to_vec();
    if pts[0] != pts[pts.len() - 1] {
        pts.push(pts[0]);
    }
    let mut out = vec![format!("      <PolyBegin x=\"{:.4}\" y=\"{:.4}\"/>", pts[0].0, pts[0].1)];
    out.extend(pts[1..].iter().map(|p| format!("      <PolyStepSegment x=\"{:.4}\" y=\"{:.4}\"/>", p.0, p.1)));
    out.join("\n")
}

fn rect(x0: f64, y0: f64, w: f64, h: f64) -> Vec<(f64, f64)> {
    vec![(x0, y0), (x0 + w, y0), (x0 + w, y0 + h), (x0, y0 + h)]
}

fn cercle(cx: f64, cy: f64, r: f64) -> Vec<(f64, f64)> {
    let n = 32;
    let angle = |i: i32| 2.0 * std::f64::consts::PI * i as f64 / n as f64;
    (0..n).map(|i| (cx + r * angle(i).cos(), cy + r * angle(i).sin())).collect()
}

const XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<IPC-2581 revision="B" xmlns="http://webstds.ipc.org/2581">
 <Content roleRef="owner">
  <FunctionMode mode="USERDEF" level="1"/>
  <StepRef name="PATCH-2450"/>
  <DictionaryLineDesc units="MILLIMETER">
   <EntryLineDesc id="l50"><LineDesc lineEnd="ROUND" lineWidth="0.5"/></EntryLineDesc>
  </DictionaryLineDesc>
  <DictionaryStandard units="MILLIMETER">
   <EntryStandard id="pad25"><Circle diameter="2.5"/></EntryStandard>
   <EntryStandard id="pad_gnd"><Circle diameter="1.0"/></EntryStandard>
  </DictionaryStandard>
 </Content>
 <Ecad name="patch-2450">
  <CadHeader units="MILLIMETER">
   <Spec name="CORE_Dielectric">
    <Dielectric type="DIELECTRIC_CONSTANT"><Property value="%(er)"/></Dielectric>
   </Spec>
   <Spec name="CORE_Perte">
    <Dielectric type="LOSS_TANGENT"><Property value="%(df)"/></Dielectric>
   </Spec>
  </CadHeader>
  <CadData>
   <Layer name="TOP" layerFunction="SIGNAL" side="TOP" polarity="POSITIVE"/>
   <Layer name="CORE" layerFunction="DIELPREG" side="INTERNAL"/>
   <Layer name="BOTTOM" layerFunction="PLANE" side="BOTTOM" polarity="POSITIVE"/>
   <Layer name="Hole1-2" layerFunction="DRILL" side="ALL">
    <Span fromLayer="TOP" toLayer="BOTTOM"/>
   </Layer>
   <Stackup overallThickness="%(total)">
    <StackupGroup name="AllStackupLayers" thickness="%(total)">
     <StackupLayer layerOrGroupRef="TOP" thickness="%(cu)" sequence="1"/>
     <StackupLayer layerOrGroupRef="CORE" thickness="%(h)" sequence="2">
      <SpecRef id="CORE_Dielectric"/>
      <SpecRef id="CORE_Perte"/>
     </StackupLayer>
     <StackupLayer layerOrGroupRef="BOTTOM" thickness="%(cu)" sequence="3"/>
    </StackupGroup>
   </Stackup>
   <Step name="PATCH-2450">
    <Datum x="0" y="0"/>
    <Profile>
     <Polygon>
%(contour)
     </Polygon>
    </Profile>
    <LogicalNet name="ANT" netClass="SIGNAL"/>
    <LogicalNet name="GND" netClass="GROUND"/>

    <LayerFeature layerRef="TOP">
     <Set net="ANT">
      <Features>
       <Contour>
        <Polygon>
%(patch)
        </Polygon>
       </Contour>
      </Features>
     </Set>
     <Set net="ANT" padUsage="TERMINATION" geometry="pad25">
      <Pad>
       <Location x="%(fx)" y="%(fy)"/>
       <StandardPrimitiveRef id="pad25"/>
      </Pad>
     </Set>
    </LayerFeature>

    <LayerFeature layerRef="BOTTOM">
     <Set net="GND">
      <Features>
       <Contour>
        <Polygon>
%(plan)
        </Polygon>
        <Cutout>
%(degagement)
        </Cutout>
       </Contour>
      </Features>
     </Set>
    </LayerFeature>

    <LayerFeature layerRef="Hole1-2">
     <Set net="ANT" padUsage="VIA" geometry="sonde">
      <Hole name="sonde" diameter="%(fd)" platingStatus="PLATED"
            plusTol="0" minusTol="0" x="%(fx)" y="%(fy)"/>
     </Set>
    </LayerFeature>
   </Step>
  </CadData>
 </Ecad>
</IPC-2581>
"#;

/// La carte, et (longueur du patch, x et y de la sonde) pour le compte rendu.
fn fabriquer() -> (String, f64, f64, f64) {
    let er_eff = (ER + 1.0) / 2.0 + (ER - 1.0) / 2.0 * (1.0 + 12.0 * H / W_PATCH).powf(-0.5);
    let l_patch = C0 / (2.0 * 2.45e9 * er_eff.sqrt()) * 1000.0 - 2.0 * 0.4 * H;
    let x0 = (CARTE_X - W_PATCH) / 2.0;
    let y0 = (CARTE_Y - l_patch) / 2.0;
    let feed_x = CARTE_X / 2.0;
    let feed_y = y0 + l_patch / 3.0;
    let valeurs = [
        ("er", format!("{:.2}", ER)),
        ("df", format!("{:.3}", DF)),
        ("h", format!("{:.3}", H)),
        ("cu", format!("{:.3}", EP_CU)),
        ("total", format!("{:.3}", H + 2.0 * EP_CU)),
        ("contour", poly(&rect(0.0, 0.0, CARTE_X, CARTE_Y))),
        ("patch", poly(&rect(x0, y0, W_PATCH, l_patch))),
        ("plan", poly(&rect(0.0, 0.0, CARTE_X, CARTE_Y))),
        // Le degagement autour de la sonde : sans lui, l'ame du connecteur
        // touche le plan de masse et l'antenne est un court-circuit. C'est un
        // detail de la carte reelle, et c'est aussi ce qui fait que le modele
        // FDTD a un sens : la decoupe doit se retrouver dans le maillage.
        ("degagement", poly(&cercle(feed_x, feed_y, FEED_D * 1.2))),
        ("fx", format!("{:.4}", feed_x)),
        ("fy", format!("{:.4}", feed_y)),
        ("fd", format!("{:.3}", FEED_D)),
    ];
    let xml = valeurs.iter().fold(XML.to_string(), |xml, (cle, v)| xml.replace(&format!("%({cle})"), v));
    (xml, l_patch, feed_x, feed_y)
}

#[test]
fn carte_antenne() {
    let (xml, l_patch, feed_x, feed_y) = fabriquer();
    let reference = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test").join("patch-2450.xml");
    if let Some(sortie) = std::env::var_os("CARTE_ANTENNE_SORTIE").filter(|s| !s.is_empty()) {
        std::fs::write(&sortie, &xml).unwrap();
        println!("Carte d'essai ecrite : {}", std::path::Path::new(&sortie).display());
        println!("  patch      {:.2} x {:.2} mm sur FR-4 {:.1} mm (er = {:.2})", W_PATCH, l_patch, H, ER);
        println!("  sonde      x = {:.2}, y = {:.2} mm", feed_x, feed_y);
        println!("  resonance attendue : 2,45 GHz a quelques pour-cent pres");
    }
    // les fins de ligne du fichier suivi peuvent etre celles du poste (autocrlf)
    let suivi = std::fs::read_to_string(&reference).unwrap().replace("\r\n", "\n");
    assert!(xml == suivi, "test/patch-2450.xml n'est plus la carte fabriquee ici");
}
