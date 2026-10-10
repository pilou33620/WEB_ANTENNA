"""Appairage des web tools : un code à 6 chiffres ouvre l'accès réseau à un appareil.

    python appairage.py      vérification (banc d'essai, sans réseau)

COPIE IDENTIQUE dans chaque web tool (web_suite, WEB_CAO, WEB_ANTENNA, WEB_3D,
web_ferme) : une correction se fait partout.

Un serveur qui écoute sur le réseau local exige des autres appareils un jeton.
Le taper (22 caractères) était pénible : le serveur affiche donc dans son
terminal un code à 6 chiffres, que l'on saisit sur la tablette. Le code ne
remplace pas le jeton, il le DONNE : bon code, la tablette reçoit le cookie du
jeton. Seul un appareil qui voit l'écran du serveur peut donc entrer. Ce poste
lui-même (boucle locale) n'a jamais besoin de code.

UN SEUL JETON, UN SEUL COOKIE POUR TOUS LES TOOLS D'UN POSTE : le jeton est
dans ~/.web_tools/jeton-reseau.txt, et un navigateur envoie un cookie à tous
les ports d'une même adresse. Une tablette appairée une fois (au lanceur ou à
n'importe quel tool) est reconnue par tous les tools de ce poste.

Usage dans un serveur (http.server) :

    GARDE = appairage.Garde("WEB_3D", actif=ecoute_sur_le_reseau)
    class Gestionnaire(SimpleHTTPRequestHandler):
        def parse_request(self):
            return super().parse_request() and GARDE.filtrer(self)
    ...
    GARDE.annoncer()     # au démarrage : affiche le code dans le terminal
"""

import hmac
import ipaddress
import json
import os
import secrets
import socket
import threading
import time
import urllib.parse
from http.cookies import CookieError, SimpleCookie

BISCUIT = "websuite_jeton"          # le nom posé par WEB·SUITE depuis toujours : ses appareils restent appairés
PAGE = "/appairage"                 # la page du code (sa propre adresse : Safari ressortait « / » de son cache)
ROUTE = "/api/appairer"             # la seule route ouverte sans jeton, en POST
ENTETE = "X-Appairage"              # en-tête maison : un autre site ne peut pas l'ajouter sans pré-vol CORS


def fichier_jeton():
    return os.environ.get("WEB_TOOLS_JETON_FICHIER") or os.path.join(
        os.path.expanduser("~"), ".web_tools", "jeton-reseau.txt")


def _lire(chemin):
    try:
        with open(chemin, encoding="utf-8") as f:
            j = f.read().strip()
        return j if len(j) >= 16 else None
    except OSError:
        return None


def jeton(ancien=None):
    """Le jeton partagé par les tools de ce poste, gardé d'un démarrage à l'autre
    (les favoris de la tablette restent bons). Supprimer le fichier en crée un neuf.

    ancien : fichier d'un jeton propre à un tool (lanceur/jeton-reseau.txt de
    WEB·SUITE) ; repris s'il n'y a pas encore de jeton partagé, pour que les
    appareils déjà appairés le restent."""
    chemin = fichier_jeton()
    j = _lire(chemin)
    if j:
        return j
    neuf = (ancien and _lire(ancien)) or secrets.token_urlsafe(16)
    try:
        os.makedirs(os.path.dirname(chemin), exist_ok=True)
        # O_EXCL : deux tools qui démarrent ensemble ne s'écrasent pas leur jeton
        fd = os.open(chemin, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        for _ in range(50):                 # l'autre tool est en train de l'écrire
            j = _lire(chemin)
            if j:
                return j
            time.sleep(0.02)
        return neuf
    except OSError:
        # Dossier personnel en lecture seule (Pyto sur iPad…) : un jeton pour
        # cette session seulement ; les appareils redonneront le code au redémarrage.
        return neuf
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(neuf + "\n")
    return neuf


def hote_permis(entete):
    """L'en-tête Host désigne-t-il ce poste ? (parade au DNS rebinding)

    Une page piégée qui fait résoudre son nom vers 127.0.0.1 devient « de même
    origine » ; elle envoie alors SON nom dans Host. Une IP littérale ne se
    rebranche pas : on accepte toutes les IP (la tablette tape celle du poste),
    localhost et le nom du poste."""
    h = (entete or "").strip().lower().rstrip(".")
    if h.startswith("["):
        h = h[1:].split("]")[0]
    elif h.count(":") == 1:
        h = h.split(":")[0]
    nom = socket.gethostname().lower()
    if h in ("", "localhost", nom, nom + ".local"):
        return True
    try:
        ipaddress.ip_address(h.split("%")[0])
        return True
    except ValueError:
        return False


class Appairage:
    """Le code court. Deviner : un code ne vit que DUREE secondes, sert une fois,
    et ESSAIS erreurs le brûlent, avec PAUSE secondes avant le suivant. Chaque
    nouveau code s'affiche dans le terminal : une série d'essais se voit."""
    DUREE, ESSAIS, PAUSE = 600, 5, 60

    def __init__(self, afficher=None, nom=""):
        self.afficher = afficher or (lambda texte: print(texte, flush=True))
        self.nom = nom
        self.verrou = threading.Lock()
        self.code = None
        self.expire = 0.0
        self.echecs = 0
        self.bloque = 0.0

    @staticmethod
    def lisible(code):
        return code[:3] + " " + code[3:]

    def _neuf(self, maintenant):
        self.code = "%06d" % secrets.randbelow(10 ** 6)
        self.expire = maintenant + self.DUREE
        self.echecs = 0
        self.afficher("  Code d'appairage%s : %s   (à saisir sur la tablette, valable %d min)"
                      % (" " + self.nom if self.nom else "", self.lisible(self.code), self.DUREE // 60))

    def preparer(self):
        """Un code valable existe (en créer un, et l'afficher, s'il le faut).
        Renvoie les secondes d'attente si les essais sont suspendus, sinon 0."""
        with self.verrou:
            maintenant = time.monotonic()
            if maintenant < self.bloque:
                return int(self.bloque - maintenant) + 1
            if not self.code or maintenant >= self.expire:
                self._neuf(maintenant)
            return 0

    def essayer(self, saisi):
        """Renvoie (ok, message)."""
        saisi = "".join(c for c in str(saisi or "") if c.isdigit())
        with self.verrou:
            maintenant = time.monotonic()
            if maintenant < self.bloque:
                return False, ("Trop d'essais : attendez %d s, un nouveau code s'affichera "
                               "sur le serveur." % (int(self.bloque - maintenant) + 1))
            if not self.code or maintenant >= self.expire:
                self._neuf(maintenant)
                return False, "Code expiré : un nouveau code est affiché sur le serveur."
            if len(saisi) == 6 and hmac.compare_digest(saisi, self.code):
                self.code = None                   # usage unique
                return True, "Appareil autorisé."
            self.echecs += 1
            if self.echecs >= self.ESSAIS:
                self.code = None
                self.bloque = maintenant + self.PAUSE
                return False, ("Trop d'essais : code annulé. Dans %d s, rechargez la page : "
                               "un nouveau code s'affichera sur le serveur." % self.PAUSE)
            return False, "Code incorrect (%d essai(s) restant(s))." % (self.ESSAIS - self.echecs)


class Garde:
    """Le contrôle d'accès d'un serveur, à appeler par filtrer() en tête de chaque requête.

    actif=False (le serveur n'écoute que sur 127.0.0.1) : seul l'en-tête Host est vérifié."""

    def __init__(self, nom, actif=True, afficher=None, ancien=None):
        self.nom = nom
        self.actif = actif
        self.jeton = jeton(ancien) if actif else None
        self.code = Appairage(afficher, nom) if actif else None

    def annoncer(self):
        """Au démarrage, en mode réseau : affiche le code dans le terminal."""
        if self.actif:
            self.code.preparer()

    @staticmethod
    def ce_poste(handler):
        try:
            ip = ipaddress.ip_address(handler.client_address[0].split("%")[0])
        except (ValueError, IndexError, TypeError):
            return False
        return (getattr(ip, "ipv4_mapped", None) or ip).is_loopback

    def _jeton_url(self, handler):
        return urllib.parse.parse_qs(urllib.parse.urlsplit(handler.path).query).get("jeton", [""])[0]

    def jeton_recu(self, handler):
        try:
            biscuit = SimpleCookie(handler.headers.get("Cookie") or "")
        except CookieError:
            biscuit = {}
        recus = [self._jeton_url(handler), biscuit[BISCUIT].value if BISCUIT in biscuit else ""]
        return any(r and hmac.compare_digest(r, self.jeton) for r in recus)

    def autorise(self, handler):
        return not self.actif or self.ce_poste(handler) or self.jeton_recu(handler)

    def biscuit(self):
        return "%s=%s; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict" % (BISCUIT, self.jeton)

    # -- réponses ---------------------------------------------------------
    @staticmethod
    def _repondre(handler, code, corps=b"", type_="text/plain; charset=utf-8", entetes=()):
        if isinstance(corps, str):
            corps = corps.encode("utf-8")
        handler.close_connection = True           # le corps d'une requête refusée n'est pas lu
        handler.send_response(code)
        for k, v in entetes:
            handler.send_header(k, v)
        handler.send_header("Content-Type", type_)
        handler.send_header("Content-Length", str(len(corps)))
        handler.send_header("Cache-Control", "no-store")
        handler.end_headers()
        if handler.command != "HEAD":
            handler.wfile.write(corps)

    def _json(self, handler, code, donnees, entetes=()):
        self._repondre(handler, code, json.dumps(donnees, ensure_ascii=False),
                       "application/json; charset=utf-8", entetes)

    def filtrer(self, handler):
        """True : la requête suit son cours. False : la réponse est déjà envoyée."""
        if not hote_permis(handler.headers.get("Host")):
            self._repondre(handler, 403, "Host non autorisé (protection DNS rebinding)")
            return False
        if not self.actif:
            return True
        u = urllib.parse.urlsplit(handler.path)
        lecture = handler.command in ("GET", "HEAD")
        if self.autorise(handler):
            if lecture and self._jeton_url(handler):
                # Le jeton passe dans un cookie et quitte l'adresse : il ne reste
                # ni dans l'historique, ni dans un lien recopié.
                reste = urllib.parse.urlencode([(k, v) for k, v in urllib.parse.parse_qsl(u.query)
                                                if k != "jeton"])
                self._repondre(handler, 303, entetes=[("Set-Cookie", self.biscuit()),
                                                      ("Location", u.path + ("?" + reste if reste else ""))])
                return False
            if lecture and u.path == PAGE:
                self._repondre(handler, 303, entetes=[("Location", "/")])
                return False
            if handler.command == "POST" and u.path == ROUTE:
                self._json(handler, 200, {"ok": True, "message": "Cet appareil est déjà autorisé."})
                return False
            return True
        if lecture and u.path == PAGE:
            self.code.preparer()
            self._repondre(handler, 200, PAGE_HTML.replace("__NOM__", _html(self.nom)),
                           "text/html; charset=utf-8")
            return False
        if handler.command == "POST" and u.path == ROUTE and handler.headers.get(ENTETE) == "1":
            try:
                n = int(handler.headers.get("Content-Length") or 0)
                corps = json.loads(handler.rfile.read(n) or b"{}") if 0 <= n <= 4096 else {}
            except (ValueError, OSError):
                corps = {}
            ok, texte = self.code.essayer(corps.get("code") if isinstance(corps, dict) else "")
            self._json(handler, 200 if ok else 403, {"ok": ok, "message": texte},
                       [("Set-Cookie", self.biscuit())] if ok else ())
            return False
        accepte = handler.headers.get("Accept") or ""
        if lecture and (u.path in ("/", "/index.html") or "text/html" in accepte):
            # une page : vers celle du code (le code s'affiche dans le terminal du serveur)
            self._repondre(handler, 303, entetes=[("Location", PAGE)])
            return False
        self._json(handler, 403, {"detail": "Appareil non appairé : ouvrez la page de ce "
                                            "serveur et saisissez le code d'appairage."})
        return False


def _html(texte):
    return (str(texte).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


PAGE_HTML = """<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__NOM__ · Appairage</title>
<style>
  :root { --fond:#f4f6fa; --carte:#fff; --texte:#141a24; --doux:#5d6878; --trait:#d5dbe4;
          --accent:#2563eb; --ok:#15803d; --err:#b91c1c; }
  @media (prefers-color-scheme: dark) {
    :root { --fond:#0d1117; --carte:#161b22; --texte:#e6edf3; --doux:#8b96a5; --trait:#2b333e;
            --accent:#6ea8fe; --ok:#4ade80; --err:#f87171; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; min-height:100dvh; display:grid; place-items:center;
         padding:24px 16px; background:var(--fond); color:var(--texte);
         font:15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { width:100%; max-width:400px; padding:28px 24px; background:var(--carte);
         border:1px solid var(--trait); border-radius:14px; text-align:center; }
  .nom { font-weight:600; letter-spacing:.08em; color:var(--doux); font-size:13px; }
  h1 { font-size:20px; margin:10px 0 6px; }
  p { color:var(--doux); margin:0 0 20px; font-size:14px; }
  input { width:100%; padding:14px 10px; border-radius:10px; border:1px solid var(--trait);
          background:var(--fond); color:var(--texte); text-align:center; outline:none;
          font:600 30px/1 ui-monospace, Menlo, Consolas, monospace; letter-spacing:.3em; }
  input:focus { border-color:var(--accent); }
  button { margin-top:14px; width:100%; padding:12px; border-radius:10px; border:0;
           background:var(--accent); color:#fff; font:600 15px/1 inherit; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  #etat { min-height:1.5em; margin-top:14px; font-size:14px; }
  #etat.err { color:var(--err); } #etat.ok { color:var(--ok); }
</style>
</head>
<body>
<main>
  <div class="nom">__NOM__</div>
  <h1>Code d'appairage</h1>
  <p>Saisissez le code à 6 chiffres affiché dans le terminal du serveur (ou dans les logs
     de ce tool, dans WEB·SUITE). Cet appareil s'en souviendra ensuite,
     pour tous les web tools de ce serveur.</p>
  <form id="f" autocomplete="off">
    <input id="code" inputmode="numeric" pattern="[0-9 ]*" maxlength="7"
           autocomplete="one-time-code" placeholder="000 000" aria-label="Code d'appairage" autofocus>
    <button id="ok" type="submit">Valider</button>
  </form>
  <div id="etat" role="status"></div>
</main>
<script>
const champ = document.getElementById('code'), etat = document.getElementById('etat');
const bouton = document.getElementById('ok');
let envoi = false;
function dire(t, c) { etat.textContent = t; etat.className = c || ''; }
async function valider() {
  const code = champ.value.replace(/\\D/g, '');
  if (code.length !== 6) { dire('Le code a 6 chiffres.', 'err'); return; }
  if (envoi) return;
  envoi = true; bouton.disabled = true; dire('Vérification…');
  try {
    const r = await fetch('/api/appairer', { method: 'POST', credentials: 'same-origin',
      headers: { 'X-Appairage': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const d = await r.json().catch(() => ({}));
    if (d.ok) { dire('Appareil autorisé.', 'ok'); location.replace('/'); return; }
    dire(d.message || ('Refusé (' + r.status + ').'), 'err'); champ.select();
  } catch (e) { dire('Serveur injoignable : ' + e.message, 'err'); }
  envoi = false; bouton.disabled = false;
}
document.getElementById('f').addEventListener('submit', e => { e.preventDefault(); valider(); });
champ.addEventListener('input', () => {
  const c = champ.value.replace(/\\D/g, '').slice(0, 6);
  champ.value = c.length > 3 ? c.slice(0, 3) + ' ' + c.slice(3) : c;
  if (c.length === 6) valider();
});
</script>
</body>
</html>
"""


if __name__ == "__main__":
    # Vérification : un vrai serveur sur la boucle locale ; « l'autre appareil » est
    # simulé en faisant croire au garde que la requête ne vient pas de ce poste.
    import http.client
    import http.server
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        os.environ["WEB_TOOLS_JETON_FICHIER"] = os.path.join(tmp, "partage", "jeton.txt")
        ancien = os.path.join(tmp, "ancien.txt")
        with open(ancien, "w") as f:
            f.write("a" * 22 + "\n")
        assert jeton(ancien) == "a" * 22                         # l'ancien jeton est repris
        assert jeton() == "a" * 22                               # puis partagé
        os.remove(os.environ["WEB_TOOLS_JETON_FICHIER"])
        j = jeton()
        assert len(j) >= 16 and j != "a" * 22 and jeton() == j
        os.environ["WEB_TOOLS_JETON_FICHIER"] = os.path.join(ancien, "impossible", "jeton.txt")
        assert len(jeton()) >= 16                                 # pas de plantage sans dossier inscriptible
        os.environ["WEB_TOOLS_JETON_FICHIER"] = os.path.join(tmp, "partage", "jeton.txt")

        affiches = []
        g = Garde("TEST", afficher=affiches.append)
        distant = [True]
        g.ce_poste = lambda h: not distant[0]

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def parse_request(self):
                return super().parse_request() and g.filtrer(self)

            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"ok")
            do_POST = do_GET

        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        port = srv.server_address[1]

        def req(chemin, methode="GET", entetes=None, corps=None):
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            c.request(methode, chemin, body=corps, headers=entetes or {})
            r = c.getresponse()
            r.corps = r.read()
            c.close()
            return r

        def appairer(code, x=True, biscuit=None):
            e = {"Content-Type": "application/json"}
            if x:
                e[ENTETE] = "1"
            if biscuit:
                e["Cookie"] = biscuit
            return req(ROUTE, "POST", e, json.dumps({"code": code}))

        r = req("/")
        assert (r.status, r.getheader("Location")) == (303, PAGE)
        assert req("/app.js").status == 403
        assert req("/app.js", entetes={"Accept": "text/html"}).getheader("Location") == PAGE
        assert req("/api/x", "POST").status == 403
        assert req("/", entetes={"Host": "piege.example:80"}).status == 403
        r = req(PAGE)
        assert r.status == 200 and b"/api/appairer" in r.corps and b"TEST" in r.corps
        code = g.code.code
        assert affiches and Appairage.lisible(code) in affiches[-1]
        assert appairer(code, x=False).status == 403              # sans en-tête : refusé
        assert g.code.code == code                                # … et sans brûler d'essai
        faux = "000000" if code != "000000" else "111111"
        assert appairer(faux).status == 403
        r = appairer(code[:3] + " " + code[3:])                   # tel qu'affiché
        assert r.status == 200 and json.loads(r.corps)["ok"]
        biscuit = r.getheader("Set-Cookie").split(";")[0]
        assert biscuit == BISCUIT + "=" + j
        assert appairer(code).status == 403                       # usage unique
        assert req("/", entetes={"Cookie": biscuit}).corps == b"ok"
        assert req("/app.js", entetes={"Cookie": biscuit}).corps == b"ok"
        assert req("/api/x", "POST", {"Cookie": biscuit}).corps == b"ok"
        assert req(PAGE, entetes={"Cookie": biscuit}).getheader("Location") == "/"
        assert json.loads(appairer("x", biscuit=biscuit).corps)["ok"]
        assert req("/", entetes={"Cookie": BISCUIT + "=faux"}).status == 303
        assert req("/", entetes={"Cookie": '";;=='}).status == 303
        r = req("/outil?a=1&jeton=" + j)                          # adresse avec ?jeton=
        assert r.status == 303 and r.getheader("Location") == "/outil?a=1"
        assert r.getheader("Set-Cookie").startswith(BISCUIT + "=" + j)
        assert req("/?jeton=faux").getheader("Location") == PAGE
        # cinq erreurs : code brûlé, pause
        req(PAGE)
        code = g.code.code
        for _ in range(Appairage.ESSAIS):
            appairer("000000" if code != "000000" else "111111")
        assert appairer(code).status == 403
        assert "attendez" in json.loads(appairer(code).corps)["message"]
        g.code.bloque = 0
        req(PAGE)
        assert appairer(g.code.code).status == 200
        distant[0] = False                                        # ce poste : pas de code
        assert req("/").corps == b"ok"
        inactif = Garde("LOCAL", actif=False)
        assert inactif.jeton is None
        srv.shutdown()
        srv.server_close()
    print("OK")
