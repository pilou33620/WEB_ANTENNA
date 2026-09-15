#!/usr/bin/python3
# -*- coding: utf-8 -*-
# ==========================================================================
# Fabrique une carte d'essai IPC-2581 portant une antenne patch 2,45 GHz.
#
#   python antenne-openems/test/carte-antenne.py [sortie.xml]
#
# POURQUOI UNE CARTE FABRIQUEE ET NON UN EXPORT REEL. Un fichier de
# fabrication reel porte le nom du client, la revision du produit et le
# routage entier : il ne se met pas dans un depot. Celui-ci est minimal et
# EXACT — deux couches, un patch dont la resonance se calcule a la main, un
# plan de masse — et il sert a trois choses : essayer l'outil sans rien avoir
# sous la main, verifier que la chaine complete tourne, et donner un resultat
# dont on connait d'avance l'ordre de grandeur.
#
# La geometrie est celle du banc python/test/banc-openems.py : un patch
# rectangulaire alimente par sonde, sur FR-4 de 1,6 mm. Sa resonance attendue
# est de 2,45 GHz a quelques pour-cent pres.
# ==========================================================================

import math
import os
import sys

C0 = 299792458.0

ER = 4.3
DF = 0.02
H = 1.6                                   # epaisseur du substrat, mm
EP_CU = 0.035

CARTE_X, CARTE_Y = 70.0, 70.0             # la carte, et le plan de masse
W_PATCH = 38.0
_ER_EFF = (ER + 1) / 2 + (ER - 1) / 2 * (1 + 12 * H / W_PATCH) ** -0.5
L_PATCH = C0 / (2 * 2.45e9 * math.sqrt(_ER_EFF)) * 1000 - 2 * 0.4 * H

X0 = (CARTE_X - W_PATCH) / 2.0
Y0 = (CARTE_Y - L_PATCH) / 2.0

# La sonde d'alimentation : sur l'axe du patch, au tiers de sa longueur.
# C'est la, en gros, que l'impedance d'entree d'un patch passe par 50 ohms.
FEED_X = CARTE_X / 2.0
FEED_Y = Y0 + L_PATCH / 3.0
FEED_D = 1.3                              # diametre du percage de la sonde


def poly(points, fermer=True):
    """Une <Polygon> IPC-2581 a partir d'une liste de couples."""
    pts = list(points)
    if fermer and pts[0] != pts[-1]:
        pts.append(pts[0])
    out = ['      <PolyBegin x="%.4f" y="%.4f"/>' % pts[0]]
    for p in pts[1:]:
        out.append('      <PolyStepSegment x="%.4f" y="%.4f"/>' % p)
    return "\n".join(out)


def rect(x0, y0, w, h):
    return [(x0, y0), (x0 + w, y0), (x0 + w, y0 + h), (x0, y0 + h)]


def cercle(cx, cy, r, n=32):
    return [(cx + r * math.cos(2 * math.pi * i / n),
             cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


XML = """<?xml version="1.0" encoding="UTF-8"?>
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
    <Dielectric type="DIELECTRIC_CONSTANT"><Property value="%(er).2f"/></Dielectric>
   </Spec>
   <Spec name="CORE_Perte">
    <Dielectric type="LOSS_TANGENT"><Property value="%(df).3f"/></Dielectric>
   </Spec>
  </CadHeader>
  <CadData>
   <Layer name="TOP" layerFunction="SIGNAL" side="TOP" polarity="POSITIVE"/>
   <Layer name="CORE" layerFunction="DIELPREG" side="INTERNAL"/>
   <Layer name="BOTTOM" layerFunction="PLANE" side="BOTTOM" polarity="POSITIVE"/>
   <Layer name="Hole1-2" layerFunction="DRILL" side="ALL">
    <Span fromLayer="TOP" toLayer="BOTTOM"/>
   </Layer>
   <Stackup overallThickness="%(total).3f">
    <StackupGroup name="AllStackupLayers" thickness="%(total).3f">
     <StackupLayer layerOrGroupRef="TOP" thickness="%(cu).3f" sequence="1"/>
     <StackupLayer layerOrGroupRef="CORE" thickness="%(h).3f" sequence="2">
      <SpecRef id="CORE_Dielectric"/>
      <SpecRef id="CORE_Perte"/>
     </StackupLayer>
     <StackupLayer layerOrGroupRef="BOTTOM" thickness="%(cu).3f" sequence="3"/>
    </StackupGroup>
   </Stackup>
   <Step name="PATCH-2450">
    <Datum x="0" y="0"/>
    <Profile>
     <Polygon>
%(contour)s
     </Polygon>
    </Profile>
    <LogicalNet name="ANT" netClass="SIGNAL"/>
    <LogicalNet name="GND" netClass="GROUND"/>

    <LayerFeature layerRef="TOP">
     <Set net="ANT">
      <Features>
       <Contour>
        <Polygon>
%(patch)s
        </Polygon>
       </Contour>
      </Features>
     </Set>
     <Set net="ANT" padUsage="TERMINATION" geometry="pad25">
      <Pad>
       <Location x="%(fx).4f" y="%(fy).4f"/>
       <StandardPrimitiveRef id="pad25"/>
      </Pad>
     </Set>
    </LayerFeature>

    <LayerFeature layerRef="BOTTOM">
     <Set net="GND">
      <Features>
       <Contour>
        <Polygon>
%(plan)s
        </Polygon>
        <Cutout>
%(degagement)s
        </Cutout>
       </Contour>
      </Features>
     </Set>
    </LayerFeature>

    <LayerFeature layerRef="Hole1-2">
     <Set net="ANT" padUsage="VIA" geometry="sonde">
      <Hole name="sonde" diameter="%(fd).3f" platingStatus="PLATED"
            plusTol="0" minusTol="0" x="%(fx).4f" y="%(fy).4f"/>
     </Set>
    </LayerFeature>
   </Step>
  </CadData>
 </Ecad>
</IPC-2581>
"""


def fabriquer():
    return XML % {
        "er": ER, "df": DF, "h": H, "cu": EP_CU,
        "total": H + 2 * EP_CU,
        "contour": poly(rect(0, 0, CARTE_X, CARTE_Y)),
        "patch": poly(rect(X0, Y0, W_PATCH, L_PATCH)),
        "plan": poly(rect(0, 0, CARTE_X, CARTE_Y)),
        # Le degagement autour de la sonde : sans lui, l'ame du connecteur
        # touche le plan de masse et l'antenne est un court-circuit. C'est un
        # detail de la carte reelle, et c'est aussi ce qui fait que le modele
        # FDTD a un sens : la decoupe doit se retrouver dans le maillage.
        "degagement": poly(cercle(FEED_X, FEED_Y, FEED_D * 1.2)),
        "fx": FEED_X, "fy": FEED_Y, "fd": FEED_D,
    }


if __name__ == "__main__":
    sortie = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "patch-2450.xml")
    with open(sortie, "w", encoding="utf-8") as f:
        f.write(fabriquer())
    print("Carte d'essai ecrite : %s" % sortie)
    print("  patch      %.2f x %.2f mm sur FR-4 %.1f mm (er = %.2f)"
          % (W_PATCH, L_PATCH, H, ER))
    print("  sonde      x = %.2f, y = %.2f mm" % (FEED_X, FEED_Y))
    print("  resonance attendue : 2,45 GHz a quelques pour-cent pres")
