#!/usr/bin/python3
"""La comparaison du Rust avec ce que faisait le Python, sans solveur.

Pour chaque document, on EXECUTE le script que python/openems_script.py genere (suivi de
l'epilogue de python/openems_run.py), mais sur de faux modules `CSXCAD` et `openEMS` :

  - un faux `ContinuousStructure` qui NOTE chaque propriete et chaque primitive posees ;
  - les VRAIES classes de ports d'openEMS 0.0.36 (python/openEMS/ports.py et utilities.py,
    lus dans le dossier donne par --openems : ils ne sont pas dans ce depot), qui posent
    donc leurs sondes et depouillent comme sur un vrai calcul ;
  - un faux `Run` qui ecrit des fichiers de sonde de synthese, et un faux `CalcNF2FF` qui
    rend un champ lointain de synthese (ecrit aussi en HDF5 par la vraie libhdf5).

Deux comparaisons en sortent :
  1. la structure notee, contre le XML qu'ecrit `antenne_xml` (chaque propriete, chaque
     primitive, chaque cote) ;
  2. le resultats.json du script (numpy), contre `antenne_xml --depouiller` sur les memes
     fichiers de sonde.

    python3 banc_numpy.py --openems DOSSIER_SOURCES [--figer DOSSIER] cas.json ...

--figer range, pour chaque cas, le document, les sondes, la structure et les resultats de
reference dans DOSSIER/<cas>/ : ce que relisent les essais Rust (tests/references.rs).
"""
import argparse
import io
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import types
import xml.etree.ElementTree as ET
import zlib
import contextlib

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.normpath(os.path.join(ICI, "..", "..", ".."))
sys.path.insert(0, os.path.join(RACINE, "python"))
sys.path.insert(0, ICI)
import ecrire_nf2ff_h5                                   # noqa: E402

AXES = {"x": 0, "y": 1, "z": 2, 0: 0, 1: 1, 2: 2}


def fl(v):
    return [float(x) for x in np.array(v, float).ravel()]


class Prim(object):
    def __init__(self, genre, **a):
        self.genre, self.a = genre, a

    def AddVertex(self, x, y, z):
        self.a["sommets"] += [float(x), float(y), float(z)]

    def AddFace(self, tri):
        self.a["faces"] += [float(v) for v in tri]


class Prop(object):
    def __init__(self, genre, nom, **a):
        self.genre, self.nom, self.a, self.prims = genre, nom, a, []

    def _p(self, genre, kw, **a):
        a["Priority"] = float(kw.get("priority", 0))
        p = Prim(genre, **a)
        self.prims.append(p)
        return p

    def AddBox(self, start, stop, **kw):
        return self._p("Box", kw, P1=fl(start), P2=fl(stop))

    def AddCylinder(self, start, stop, radius, **kw):
        return self._p("Cylinder", kw, P1=fl(start), P2=fl(stop), Radius=float(radius))

    def AddCylindricalShell(self, start, stop, radius, shell_width, **kw):
        return self._p("CylindricalShell", kw, P1=fl(start), P2=fl(stop), Radius=float(radius),
                       ShellWidth=float(shell_width))

    def AddSphere(self, center, radius, **kw):
        return self._p("Sphere", kw, Center=fl(center), Radius=float(radius))

    def AddPolygon(self, points, norm_dir, elevation, **kw):
        return self._p("Polygon", kw, pts=fl(np.array(points, float).T), NormDir=float(AXES[norm_dir]),
                       Elevation=float(elevation))

    def AddLinPoly(self, points, norm_dir, elevation, length, **kw):
        return self._p("LinPoly", kw, pts=fl(np.array(points, float).T), NormDir=float(AXES[norm_dir]),
                       Elevation=float(elevation), Length=float(length))

    def AddWire(self, points, radius, **kw):
        return self._p("Wire", kw, pts=fl(np.array(points, float).T), WireRadius=float(radius))

    def AddPolyhedron(self, **kw):
        return self._p("Polyhedron", kw, sommets=[], faces=[])

    def AddFrequency(self, freq):
        self.a["FD_Samples"] = fl(freq)


class Grille(object):
    def __init__(self):
        self.l, self.unite = [np.array([])] * 3, 1.0

    def SetDeltaUnit(self, u):
        self.unite = u

    def GetDeltaUnit(self):
        return self.unite

    def SetLines(self, ny, lignes):
        self.l[AXES[ny]] = np.array(lignes, float)

    def GetLines(self, ny, do_sort=False):
        return self.l[AXES[ny]]

    def IsValid(self):
        return True


class ContinuousStructure(object):
    def __init__(self):
        self.props, self.grille = [], Grille()

    def _a(self, genre, nom, **a):
        p = Prop(genre, nom, **a)
        self.props.append(p)
        return p

    def GetGrid(self):
        return self.grille

    def AddMaterial(self, nom, **kw):
        return self._a("Material", nom, Epsilon=float(kw.get("epsilon", 1.0)), Kappa=float(kw.get("kappa", 0.0)))

    def AddMetal(self, nom):
        return self._a("Metal", nom)

    def AddConductingSheet(self, nom, conductivity, thickness):
        return self._a("ConductingSheet", nom, Conductivity=float(conductivity), Thickness=float(thickness))

    def AddLumpedElement(self, nom, ny, caps, R):
        return self._a("LumpedElement", nom, Direction=float(AXES[ny]), Caps=float(bool(caps)), R=float(R))

    def AddExcitation(self, nom, exc_type, exc_val, **kw):
        return self._a("Excitation", nom, Type=float(exc_type), Excite=fl(exc_val), Delay=float(kw.get("delay", 0)))

    def AddProbe(self, nom, p_type, **kw):
        return self._a("ProbeBox", nom, Type=float(p_type), Weight=float(kw.get("weight", 1)),
                       NormDir=float(AXES.get(kw.get("norm_dir", -1), -1)))

    def AddDump(self, nom, **kw):
        a = dict(DumpType=float(kw.get("dump_type", 0)), DumpMode=float(kw.get("dump_mode", 0)),
                 FileType=float(kw.get("file_type", 0)))
        if "sub_sampling" in kw:
            a["SubSampling"] = fl(kw["sub_sampling"])
        return self._a("DumpBox", nom, **a)

    # -- le detour par le XML des pertes de Debye : assez de XML pour que le script s'y retrouve
    def Write2XML(self, chemin):
        r = ET.Element("ContinuousStructure")
        ps = ET.SubElement(r, "Properties")
        for i, p in enumerate(self.props):
            e = ET.SubElement(ps, p.genre, Name=p.nom, Rang=str(i))
            if p.genre == "Material":
                ET.SubElement(e, "Property", Epsilon=repr(p.a["Epsilon"]), Kappa=repr(p.a["Kappa"]))
                ET.SubElement(e, "Weight")
        ET.ElementTree(r).write(chemin)

    def ReadFromXML(self, chemin):
        for e in ET.parse(chemin).getroot().iter("DebyeMaterial"):
            p = self.props[int(e.get("Rang"))]
            p.genre = "DebyeMaterial"
            p.a = {k: float(v.split(",")[0]) for k, v in e.find("Property").attrib.items()}
            assert all(v == "1,1,1" for v in e.find("Weight").attrib.values())

    def GetQtyProperties(self):
        return len(self.props)

    def GetQtyPrimitives(self):
        return sum(len(p.prims) for p in self.props)


def sonde_de_synthese(nom, n=600, dt=1.3e-12):
    """Un signal de sonde plausible : des sinusoides amorties, propres a chaque nom."""
    g = np.random.default_rng(zlib.crc32(nom.encode()))
    t = np.arange(n) * dt
    v = np.zeros(n)
    for _ in range(3):
        fr, tau, a, ph = g.uniform(1.8e9, 3.2e9), g.uniform(60, 200) * dt, g.uniform(0.2, 1.0), g.uniform(0, 6.28)
        v += a * np.exp(-t / tau) * np.sin(2 * np.pi * fr * t + ph) * (1 - np.exp(-t / (8 * dt)))
    if "_it" in nom:
        v *= 0.02
    return t, v


class FauxNF2FF(object):
    def __init__(self, etat):
        self.etat = etat

    def CalcNF2FF(self, sim_path, freq, theta, phi, radius=1, center=[0, 0, 0], **kw):
        theta_r, phi_r, e_t, e_p, p_rad, dmax, prad = ecrire_nf2ff_h5.champs(1, len(theta), len(phi))
        ecrire_nf2ff_h5.ecrire(os.path.join(sim_path, "nf2ff.h5"), 1, float(freq))
        self.etat["nf2ff_appel"] = {"freq": float(freq), "theta": fl(np.deg2rad(theta)), "phi": fl(np.deg2rad(phi)),
                                    "centre": fl(center), "rayon": float(radius)}
        r = types.SimpleNamespace()
        r.Dmax, r.Prad = np.array([dmax]), np.array([prad])
        r.E_norm = [np.sqrt(np.abs(e_t) ** 2 + np.abs(e_p) ** 2)]
        return r


def modules(dossier_openems, etat):
    """Les faux CSXCAD et openEMS, et les vraies classes de ports."""
    for nom in [k for k in sys.modules if k.split(".")[0] in ("CSXCAD", "openEMS")]:
        del sys.modules[nom]
    csxcad = types.ModuleType("CSXCAD")
    csxcad.ContinuousStructure = ContinuousStructure
    util = types.ModuleType("CSXCAD.Utilities")
    util.CheckNyDir = lambda ny: AXES[ny]
    csxcad.Utilities = util
    oe = types.ModuleType("openEMS")
    oe.__path__ = []
    const = types.ModuleType("openEMS.physical_constants")
    const.C0, const.MUE0 = 299792458.0, 4e-7 * math.pi
    const.EPS0 = 1 / (const.MUE0 * const.C0 ** 2)
    const.Z0 = math.sqrt(const.MUE0 / const.EPS0)
    sys.modules.update({"CSXCAD": csxcad, "CSXCAD.Utilities": util, "openEMS": oe, "openEMS.physical_constants": const})
    for nom in ("utilities", "ports"):
        mod = types.ModuleType("openEMS." + nom)
        sys.modules["openEMS." + nom] = mod
        setattr(oe, nom, mod)
        chemin = os.path.join(dossier_openems, nom + ".py")
        exec(compile(open(chemin, encoding="utf-8").read(), chemin, "exec"), mod.__dict__)
    ports = sys.modules["openEMS.ports"]

    class openEMS(object):
        def __init__(self, NrTS=1e9, EndCriteria=1e-5, **kw):
            etat["fdtd"] = {"NumberOfTimesteps": float(NrTS), "endCriteria": float(EndCriteria)}

        def SetGaussExcite(self, f0, fc):
            etat["fdtd"].update(f0=float(f0), fc=float(fc))

        def SetBoundaryCond(self, bc):
            etat["fdtd"]["bords"] = list(bc)

        def SetCSX(self, csx):
            self.csx = csx
            etat["csx"] = csx

        def AddLumpedPort(self, port_nr, R, start, stop, p_dir, excite=0, **kw):
            return ports.LumpedPort(self.csx, port_nr, R, start, stop, p_dir, excite, **kw)

        def AddMSLPort(self, port_nr, metal_prop, start, stop, prop_dir, exc_dir, excite=0, **kw):
            return ports.MSLPort(self.csx, port_nr, metal_prop, start, stop, prop_dir, exc_dir, excite, **kw)

        def CreateNF2FFBox(self, name="nf2ff"):
            # openEMS.pyx et nf2ff.py de 0.0.36 : une ligne apres la PML, six faces par sonde
            taille = int(etat["fdtd"]["bords"][0].split("_")[1]) + 1
            start, stop = np.zeros(3), np.zeros(3)
            for n in range(3):
                l = self.csx.GetGrid().GetLines(n)
                assert len(l) > 2 * taille
                start[n], stop[n] = l[taille], l[-taille - 1]
            e = self.csx.AddDump(name + "_E", dump_type=0, dump_mode=1, file_type=1)
            h = self.csx.AddDump(name + "_H", dump_type=1, dump_mode=1, file_type=1)
            for ny in range(3):
                a, b = np.array(start), np.array(stop)
                b[ny] = a[ny]
                e.AddBox(a, b); h.AddBox(a, b)
                a, b = np.array(start), np.array(stop)
                a[ny] = b[ny]
                e.AddBox(a, b); h.AddBox(a, b)
            return FauxNF2FF(etat)

        def Run(self, sim_path, **kw):
            etat["fils"] = kw.get("numThreads")
            for p in self.csx.props:
                if p.genre == "ProbeBox":
                    t, v = sonde_de_synthese(p.nom)
                    with open(os.path.join(sim_path, p.nom), "w") as f:
                        f.write("% time-domain voltage integration by openEMS (synthese)\n% t/s\tvoltage\n")
                        for a, b in zip(t, v):
                            f.write("%.12g\t%.12g\n" % (a, b))

    oe.openEMS = openEMS


def structure_du_script(csx):
    out = []
    for p in csx.props:
        out.append({"genre": p.genre, "nom": p.nom, "a": p.a, "prims": [{"genre": q.genre, "a": q.a} for q in p.prims]})
    return out


def nombres(texte):
    return [float(v) for v in texte.split(",")]


def structure_du_xml(texte):
    """Le XML du Rust, ramene a la forme de `structure_du_script`."""
    racine = ET.fromstring(texte)
    out = []
    for e in racine.find("ContinuousStructure").find("Properties"):
        a = {}
        g = e.tag
        if g in ("Material", "DebyeMaterial"):
            pr = e.find("Property").attrib
            for k, v in pr.items():
                trois = nombres(v) if "," in v else [float(v)]
                assert len(set(trois)) == 1
                if g == "DebyeMaterial" or k in ("Epsilon", "Kappa"):
                    a[k] = trois[0]
                else:
                    assert trois[0] == {"Mue": 1.0}.get(k, 0.0), (k, v)
            assert all(set(nombres(v)) == {1.0} for v in e.find("Weight").attrib.values())
            if g == "DebyeMaterial":
                for k in ("Mue", "Sigma", "Density"):
                    a.pop(k)
        elif g == "ConductingSheet":
            a = {k: float(e.get(k)) for k in ("Conductivity", "Thickness")}
        elif g == "LumpedElement":
            a = {k: float(e.get(k)) for k in ("Direction", "Caps", "R")}
            assert e.get("C") is None and e.get("L") is None
        elif g == "Excitation":
            a = {"Type": float(e.get("Type")), "Excite": nombres(e.get("Excite")), "Delay": float(e.get("Delay"))}
        elif g == "ProbeBox":
            a = {k: float(e.get(k)) for k in ("Type", "Weight", "NormDir")}
        elif g == "DumpBox":
            a = {k: float(e.get(k)) for k in ("DumpType", "DumpMode", "FileType")}
            if e.get("SubSampling"):
                a["SubSampling"] = nombres(e.get("SubSampling"))
            if e.find("FD_Samples") is not None:
                a["FD_Samples"] = nombres(e.find("FD_Samples").text)
        prims = []
        for q in e.find("Primitives"):
            b = {"Priority": float(q.get("Priority"))}
            for k in ("Radius", "ShellWidth", "Elevation", "NormDir", "Length", "WireRadius"):
                if q.get(k) is not None:
                    b[k] = float(q.get(k))
            for k in ("P1", "P2", "Center"):
                if q.find(k) is not None:
                    b[k] = [float(q.find(k).get(c)) for c in "XYZ"]
            if q.tag in ("Polygon", "LinPoly"):
                b["pts"] = [float(v.get(c)) for v in q.findall("Vertex") for c in ("X1", "X2")]
                assert int(q.get("QtyVertices")) == len(b["pts"]) // 2
            elif q.tag == "Wire":
                b["pts"] = [float(v.get(c)) for v in q.findall("Vertex") for c in "XYZ"]
            elif q.tag == "Polyhedron":
                b["sommets"] = [x for v in q.findall("Vertex") for x in nombres(v.text)]
                b["faces"] = [x for v in q.findall("Face") for x in nombres(v.text)]
            prims.append({"genre": q.tag, "a": b})
        out.append({"genre": g, "nom": e.get("Name"), "a": a, "prims": prims})
    g = racine.find("ContinuousStructure").find("RectilinearGrid")
    grille = {"unite": float(g.get("DeltaUnit")), "x": nombres(g.find("XLines").text), "y": nombres(g.find("YLines").text),
              "z": nombres(g.find("ZLines").text)}
    fd = racine.find("FDTD")
    fdtd = {"NumberOfTimesteps": float(fd.get("NumberOfTimesteps")), "endCriteria": float(fd.get("endCriteria")),
            "f0": float(fd.find("Excitation").get("f0")), "fc": float(fd.find("Excitation").get("fc")),
            "bords": [fd.find("BoundaryCond").get(k) for k in ("xmin", "xmax", "ymin", "ymax", "zmin", "zmax")]}
    assert fd.find("Excitation").get("Type") == "0"
    return out, grille, fdtd


def ecart(a, b, chemin="", tol=1e-9):
    """Le premier ecart entre deux valeurs JSON, ou None. Les nombres a `tol` pres, en relatif."""
    if isinstance(a, dict) and isinstance(b, dict):
        if list(a) != list(b) and set(a) != set(b):
            return "%s : cles %s / %s" % (chemin, sorted(set(a) - set(b)), sorted(set(b) - set(a)))
        for k in a:
            e = ecart(a[k], b[k], chemin + "/" + str(k), tol)
            if e:
                return e
        return None
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return "%s : %d / %d elements" % (chemin, len(a), len(b))
        for i, (x, y) in enumerate(zip(a, b)):
            e = ecart(x, y, "%s[%d]" % (chemin, i), tol)
            if e:
                return e
        return None
    if isinstance(a, bool) or isinstance(b, bool) or a is None or b is None or isinstance(a, str) or isinstance(b, str):
        return None if a == b else "%s : %r / %r" % (chemin, a, b)
    if abs(a - b) <= tol * max(1.0, abs(a), abs(b)):
        return None
    return "%s : %r / %r" % (chemin, a, b)


def un_cas(chemin_doc, dossier_openems, exe, figer=None, tol=1e-9):
    import openems_modele
    import openems_run
    import openems_script
    nom = os.path.splitext(os.path.basename(chemin_doc))[0]
    doc = json.load(open(chemin_doc, encoding="utf-8"))
    try:
        m = openems_modele.normaliser(doc)
    except openems_modele.ErreurModele as exc:
        r = subprocess.run([exe, chemin_doc], capture_output=True, text=True)
        return ("refus", None if r.returncode != 0 and exc.message in r.stderr else "refus different : %s" % r.stderr[:200])
    dossier = tempfile.mkdtemp(prefix="banc_numpy_")
    etat = {}
    modules(dossier_openems, etat)
    script = openems_script.generer(m, dossier_sim=dossier) + openems_run._epilogue(m)
    sortie = io.StringIO()
    with contextlib.redirect_stdout(sortie):
        exec(compile(script, nom + ".py", "exec"), {"__name__": "__main__", "__file__": os.path.join(dossier, "antenne.py")})
    journal = sortie.getvalue().splitlines()
    ref_structure = structure_du_script(etat["csx"])
    ref_resultats = json.load(open(os.path.join(dossier, "resultats.json")))

    # 1. la structure
    r = subprocess.run([exe, chemin_doc], capture_output=True, text=True)
    if r.returncode != 0:
        return ("xml", "antenne_xml : %s" % r.stderr[:300])
    props, grille, fdtd = structure_du_xml(r.stdout)
    g = etat["csx"].grille
    e = (ecart(ref_structure, props, "structure", 1e-12)
         or ecart({"unite": g.unite, "x": fl(g.l[0]), "y": fl(g.l[1]), "z": fl(g.l[2])}, grille, "grille", 0)
         or ecart(etat["fdtd"], fdtd, "fdtd", 1e-15))
    if e:
        return ("structure", e)

    # 2. le depouillement
    r = subprocess.run([exe, "--depouiller", chemin_doc, dossier], capture_output=True, text=True)
    if r.returncode != 0:
        return ("depouillement", "antenne_xml --depouiller : %s" % r.stderr[:300])
    e = ecart(ref_resultats, json.loads(r.stdout), "resultats", tol)
    if e:
        return ("resultats", e)
    # les lignes imprimees : celles du script, moins celles de son detour par le XML
    lignes_py = [l for l in journal if not l.startswith("Debye :") and l != "resultats.json ecrit"]
    lignes_rs = r.stderr.splitlines()
    if lignes_py != lignes_rs:
        diff = [(a, b) for a, b in zip(lignes_py, lignes_rs) if a != b]
        return ("journal", "%d / %d lignes ; %r" % (len(lignes_py), len(lignes_rs), diff[:1]))
    if "nf2ff_appel" in etat:
        x = ET.parse(os.path.join(dossier, "nf2ff.xml")).getroot()
        vu = {"freq": float(x.get("freq")), "theta": nombres(x.find("theta").text), "phi": nombres(x.find("phi").text),
              "centre": nombres(x.get("Center")), "rayon": float(x.get("Radius"))}
        e = ecart(etat["nf2ff_appel"], vu, "nf2ff", 1e-12)
        if e:
            return ("nf2ff", e)
    if figer:
        cible = os.path.join(figer, nom)
        shutil.rmtree(cible, ignore_errors=True)
        os.makedirs(cible)
        shutil.copy(chemin_doc, os.path.join(cible, "document.json"))
        for f in os.listdir(dossier):
            if f.startswith("port_") or f == "nf2ff.h5":
                shutil.copy(os.path.join(dossier, f), cible)
        json.dump({"structure": ref_structure, "fdtd": etat["fdtd"], "resultats": ref_resultats, "journal": lignes_py,
                   "nf2ff": etat.get("nf2ff_appel")}, open(os.path.join(cible, "reference.json"), "w"), ensure_ascii=False)
    shutil.rmtree(dossier, ignore_errors=True)
    return ("ok", None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--openems", required=True, help="dossier ou sont ports.py et utilities.py d'openEMS 0.0.36")
    ap.add_argument("--exe", default=os.path.join(RACINE, "target", "debug", "antenne_xml"))
    ap.add_argument("--figer")
    ap.add_argument("--tol", type=float, default=1e-9)
    ap.add_argument("cas", nargs="+")
    a = ap.parse_args()
    bilan = {}
    for c in a.cas:
        try:
            quoi, e = un_cas(c, a.openems, a.exe, a.figer, a.tol)
        except Exception as exc:                          # noqa: BLE001
            quoi, e = "exception", "%s: %s" % (type(exc).__name__, exc)
        cle = quoi if not e else "RATE " + quoi
        bilan[cle] = bilan.get(cle, 0) + 1
        if e:
            print("RATE %s [%s] %s" % (os.path.basename(c), quoi, e))
    print(json.dumps(bilan, ensure_ascii=False))
    sys.exit(1 if any(k.startswith("RATE") for k in bilan) else 0)


if __name__ == "__main__":
    main()
