"""Banc du serveur : ce qu'il sert, ce qu'il refuse.

    python python/test/banc-serveur.py

Demarre le serveur en memoire sur un port libre de 127.0.0.1 et verifie que
la page se charge, que rien d'autre du depot ne sort (.git, cle IA, scripts,
chemins Windows) et qu'un Host etranger est refuse (DNS rebinding).
"""
import http.client
import os
import sys
import threading

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(ICI)))
import web_antenna  # noqa: E402

serveur = web_antenna.Serveur(("127.0.0.1", 0), web_antenna.Poste)
threading.Thread(target=serveur.serve_forever, daemon=True).start()
PORT = serveur.server_address[1]


def code(chemin, hote=None, methode="GET"):
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    c.putrequest(methode, chemin, skip_host=True)
    c.putheader("Host", hote or "127.0.0.1:%d" % PORT)
    c.endheaders()
    r = c.getresponse()
    r.read()
    c.close()
    return r.status


CAS = [
    ("/", None, 200),
    ("/index.html", None, 200),
    ("/css/theme.css", None, 200),
    ("/js/01-api.js", None, 200),
    ("/js/vendor/occt/occt-import-js.wasm", None, 200),
    ("/api/openems", None, 200),
    ("/.git/config", None, 404),
    ("/.git/", None, 404),
    ("/js/", None, 404),
    ("/js/../web_antenna.py", None, 404),
    ("/js/%2e%2e/web_antenna.py", None, 404),
    ("/web_antenna.py", None, 404),
    ("/README.md", None, 404),
    ("/api_key_free_ia_studio.txt", None, 404),
    ("/C:%5cWindows%5cwin.ini", None, 404),
    ("/js/..%5c..%5cweb_antenna.py", None, 404),
    ("/env/pyvenv.cfg", None, 404),
    ("/", "192.168.1.20:8000", 200),
    ("/", "[::1]:8000", 200),
    ("/", "localhost:8000", 200),
    ("/", "evil.example:8000", 403),
    ("/api/ia/cle", "evil.example", 403),
    ("/api/ia/cle", None, 404),      # l'assistant IA est retire : plus de route de cle
]

echecs = 0
for chemin, hote, attendu in CAS:
    obtenu = code(chemin, hote)
    if obtenu != attendu:
        echecs += 1
        print("ECHEC %-40s Host=%-20s attendu %d, obtenu %d"
              % (chemin, hote, attendu, obtenu))
if code("/.git/config", methode="HEAD") != 404:
    echecs += 1
    print("ECHEC HEAD /.git/config")


# Canal de pilotage (pilote.py, MCP de web_suite) : une page bat, le MCP de ce poste voit
# l'onglet ; une autre origine est refusée ; les fichiers de la page sont servis
def pilote(methode, route, corps=None, origine=None, entete=True):
    import json
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    entetes = {"Content-Type": "application/json"}
    if entete:
        entetes["X-WEB_ANTENNA"] = "1"     # l'en-tête maison que la page pose (js/01-api.js)
    if origine:
        entetes["Origin"] = origine
    c.request(methode, route, body=None if corps is None else json.dumps(corps), headers=entetes)
    r = c.getresponse()
    donnees = r.read()
    c.close()
    return r.status, (json.loads(donnees) if donnees[:1] == b"{" else None)


onglet = {"id": "o1", "page": "antenna", "projet": "dipole", "focus_il_y_a": 0}
PILOTE = [
    ("autre origine refusée", pilote("POST", "/api/pilote/battement", {"navigateur": "n1", "onglets": [onglet]},
                                     origine="http://evil.example")[0] == 403),
    ("battement de la page", pilote("POST", "/api/pilote/battement", {"navigateur": "n1", "onglets": [onglet]},
                                    origine="http://127.0.0.1:%d" % PORT)[0] == 200),
    ("onglet vu par le MCP", [o["id"] for o in pilote("GET", "/api/pilote/onglets")[1]["onglets"]] == ["o1"]),
    # En-tête maison X-WEB_ANTENNA (REGLES §2.3) : sans lui, tout POST est refusé et rien n'est noté
    ("sans en-tête maison : 403, rien de noté",
     pilote("POST", "/api/pilote/battement", {"navigateur": "n2", "onglets": [dict(onglet, id="o2")]},
            entete=False)[0] == 403
     and pilote("POST", "/api/projet/fermer", {}, entete=False)[0] == 403
     and [o["id"] for o in pilote("GET", "/api/pilote/onglets")[1]["onglets"]] == ["o1"]),
    # Ouvrir change le projet courant : POST {nom}, plus de GET
    ("ouvrir un projet : POST seulement", pilote("GET", "/api/projet/ouvrir?nom=x")[0] == 404
     and pilote("POST", "/api/projet/ouvrir", {}, entete=False)[0] == 403
     and pilote("POST", "/api/projet/ouvrir", {})[0] == 400),
    ("js/pilote.js servi", code("/js/pilote.js") == 200 and code("/js/pilote-antenna.js") == 200),
    ("css/pilote.css servi", code("/css/pilote.css") == 200),
]
_c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
_c.request("GET", "/")
_r = _c.getresponse(); _r.read(); _c.close()
PILOTE.append(("cadres : même origine seulement", _r.getheader("X-Frame-Options") == "SAMEORIGIN"
               and "frame-ancestors 'self'" in (_r.getheader("Content-Security-Policy") or "")))
# Une panne interne : 500 court, sans le texte de l'exception (chemins du disque)
_vrai = web_antenna.Poste._pr_etat
web_antenna.Poste._pr_etat = lambda self: open("/chemin/secret/introuvable.json")
_sys_err, sys.stderr = sys.stderr, open(os.devnull, "w")      # la trace part au terminal
try:
    _st, _rep = pilote("GET", "/api/projet")
finally:
    sys.stderr.close(); sys.stderr = _sys_err
    web_antenna.Poste._pr_etat = _vrai
PILOTE.append(("500 : message court, sans chemin", _st == 500 and "secret" not in _rep["detail"]
               and "FileNotFoundError" in _rep["detail"]))
for nom, bon in PILOTE:
    if not bon:
        echecs += 1
        print("ECHEC canal de pilotage : " + nom)
CAS += [None] * len(PILOTE)
serveur.shutdown()
print("%d/%d ok" % (len(CAS) + 1 - echecs, len(CAS) + 1))
sys.exit(1 if echecs else 0)
