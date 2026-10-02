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
serveur.shutdown()
print("%d/%d ok" % (len(CAS) + 1 - echecs, len(CAS) + 1))
sys.exit(1 if echecs else 0)
