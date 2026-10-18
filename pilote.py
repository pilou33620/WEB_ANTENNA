"""Canal de pilotage : le MCP de web_suite donne des ordres aux pages ouvertes d'un web tool.

    python pilote.py      vérification (banc d'essai, sans réseau)

COPIE IDENTIQUE dans WEB_CAO, WEB_ANTENNA et WEB_3D ; l'original est
web_suite/lanceur/pilote.py et la CI de web_suite vérifie les copies.
Spec : web_suite/lanceur/docs/SPEC-mcp-canal-pilote.md.

Usage dans un serveur (http.server) :

    PILOTE = pilote.Pilote()
    def do_GET(self):
        if PILOTE.traiter(self): return
        ...
    def do_POST(self):            # après le contrôle d'Origin du serveur
        if PILOTE.traiter(self): return
        ...

Les pages d'un même navigateur élisent un onglet relais : lui seul bat
(/battement), attend les commandes (/attendre, long-poll) et les transmet aux
autres onglets. La page visée répond (/reponse). Le MCP, sur ce poste
seulement, liste les onglets, dépose une commande et en suit l'état.
"""

import ipaddress
import json
import re
import secrets
import threading
import time
import urllib.parse

PREFIXE = "/api/pilote/"
METHODES = {"battement": "POST", "attendre": "GET", "reponse": "POST",
            "commande": "POST", "onglets": "GET", "suivre": "GET"}
ORDRES = ("commande", "onglets", "suivre")      # le MCP, sur ce poste seulement
ETATS_PAGE = ("recue", "proposee", "appliquee", "refusee", "finie", "echouee")
FINAUX = ("appliquee", "refusee", "finie", "echouee", "expiree")
ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
NOM = re.compile(r"^[a-z_][a-z0-9_]{0,63}$")
GARDE_COMMANDES = 3600      # s : une commande finie reste lisible par /suivre pendant une heure


class Refus(Exception):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _texte(v, nom, maxi, vide=False):
    if not isinstance(v, str) or len(v) > maxi or (not vide and not v):
        raise Refus(400, "Champ « %s » invalide." % nom)
    return v


class Pilote:
    def __init__(self, attente=120.0, attente_poll=25.0, oubli=60.0, redistribution=10.0,
                 max_corps=8 * 1024 * 1024):
        self.attente = attente                # s : un appel du MCP attend la réponse de la page
        self.attente_poll = attente_poll      # s : un long-poll du relais
        self.oubli = oubli                    # s : un onglet sans nouvelles est oublié
        self.redistribution = redistribution  # s : livrée mais pas accusée, la commande repart
        self.max_corps = max_corps            # octets : une capture d'écran tient dedans
        self.cond = threading.Condition()
        self.onglets = {}                     # id -> onglet
        self.commandes = {}                   # id -> commande

    @staticmethod
    def ce_poste(handler):
        try:
            ip = ipaddress.ip_address(handler.client_address[0].split("%")[0])
        except (ValueError, IndexError, TypeError):
            return False
        return (getattr(ip, "ipv4_mapped", None) or ip).is_loopback

    # -- entrée -------------------------------------------------------------
    def traiter(self, handler):
        """True si la route était au pilote (la réponse est envoyée), False sinon."""
        url = urllib.parse.urlsplit(handler.path)
        if not url.path.startswith(PREFIXE):
            return False
        route = url.path[len(PREFIXE):]
        try:
            if route not in METHODES:
                raise Refus(404, "Route du pilote inconnue : " + route)
            if handler.command != METHODES[route]:
                raise Refus(405, "Méthode %s refusée sur %s." % (handler.command, route))
            origine = handler.headers.get("Origin")
            if handler.command == "POST" and origine and origine != "http://" + (handler.headers.get("Host") or ""):
                # Un autre site ouvert dans le navigateur : refusé ici, même si le serveur hôte
                # ne contrôle pas l'Origin (WEB_3D n'a pas de garde CSRF)
                raise Refus(403, "Origine refusée.")
            if route in ORDRES and not self.ce_poste(handler):
                raise Refus(403, "Seul le MCP de ce poste donne des ordres aux pages.")
            params = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
            corps = self._corps(handler) if handler.command == "POST" else None
            rendu = getattr(self, "_" + route)(handler, params, corps)
            self._json(handler, 200, rendu)
        except Refus as exc:
            self._json(handler, exc.code, {"detail": exc.detail})
        return True

    def _corps(self, handler):
        try:
            taille = int(handler.headers.get("Content-Length") or 0)
        except ValueError:
            raise Refus(400, "Content-Length invalide.")
        if taille > self.max_corps:
            handler.close_connection = True       # le corps n'est pas lu
            raise Refus(413, "Corps trop gros.")
        try:
            corps = json.loads(handler.rfile.read(taille) or b"null")
        except ValueError:
            raise Refus(400, "JSON illisible.")
        if not isinstance(corps, dict):
            raise Refus(400, "Objet JSON attendu.")
        return corps

    @staticmethod
    def _json(handler, code, donnees):
        corps = json.dumps(donnees, ensure_ascii=False).encode("utf-8")
        handler.send_response(code)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Content-Length", str(len(corps)))
        handler.send_header("Cache-Control", "no-store")
        handler.end_headers()
        handler.wfile.write(corps)

    # -- état (sous self.cond) ----------------------------------------------
    def _menage(self):
        """Oublie les onglets muets ; une commande encore en cours pour eux expire."""
        maintenant = time.monotonic()
        for i in [i for i, o in self.onglets.items() if maintenant - o["vu"] > self.oubli]:
            del self.onglets[i]
        for c in list(self.commandes.values()):
            if c["etat"] not in FINAUX and c["onglet"] not in self.onglets:
                self._finir(c, "expiree", "L'onglet visé a été fermé avant de répondre.")
            elif c["etat"] in FINAUX and maintenant - c["fin"] > GARDE_COMMANDES:
                del self.commandes[c["id"]]

    def _finir(self, c, etat, resultat):
        c.update(etat=etat, resultat=resultat, fin=time.monotonic())
        self.cond.notify_all()

    def _vue_onglet(self, o):
        return {"id": o["id"], "page": o["page"], "projet": o["projet"], "appareil": o["appareil"],
                "navigateur": o["navigateur"], "interrupteur": o["interrupteur"],
                "focus_il_y_a_s": round(time.time() - o["focus"], 1)}

    def _vue(self, c):
        o = self.onglets.get(c["onglet"]) or c["cible"]
        return {"id": c["id"], "nom": c["nom"], "etat": c["etat"], "resultat": c["resultat"],
                "onglet": {k: o[k] for k in ("id", "page", "projet", "appareil")}}

    # -- routes des pages ---------------------------------------------------
    def _battement(self, handler, _params, corps):
        nav = corps.get("navigateur")
        if not isinstance(nav, str) or not ID.match(nav):
            raise Refus(400, "Champ « navigateur » invalide.")
        liste = corps.get("onglets")
        if not isinstance(liste, list) or len(liste) > 50:
            raise Refus(400, "Champ « onglets » invalide.")
        neufs = {}
        for o in liste:
            if not isinstance(o, dict) or not isinstance(o.get("id"), str) or not ID.match(o["id"]):
                raise Refus(400, "Onglet invalide.")
            il_y_a = o.get("focus_il_y_a", 0)
            if type(il_y_a) not in (int, float) or il_y_a < 0:
                raise Refus(400, "Champ « focus_il_y_a » invalide.")
            neufs[o["id"]] = {
                "id": o["id"], "navigateur": nav, "page": _texte(o.get("page"), "page", 40),
                "projet": _texte(o.get("projet") or "", "projet", 200, vide=True),
                "interrupteur": o.get("interrupteur") is True,
                # Le focus est daté par le serveur : les horloges des appareils diffèrent
                "focus": time.time() - il_y_a / 1000.0,
                "appareil": "ce poste" if self.ce_poste(handler) else handler.client_address[0],
                "vu": time.monotonic()}
        with self.cond:
            # La liste du relais fait foi : un onglet absent est fermé
            for i in [i for i, o in self.onglets.items() if o["navigateur"] == nav]:
                del self.onglets[i]
            self.onglets.update(neufs)
            self._menage()
        return {"ok": True}

    def _attendre(self, _handler, params, _corps):
        nav = params.get("navigateur", "")
        if not ID.match(nav):
            raise Refus(400, "Paramètre « navigateur » invalide.")
        fin = time.monotonic() + self.attente_poll
        with self.cond:
            while True:
                maintenant = time.monotonic()
                for o in self.onglets.values():
                    if o["navigateur"] == nav:
                        o["vu"] = maintenant
                self._menage()
                prets = [c for c in self.commandes.values()
                         if c["navigateur"] == nav and (c["etat"] == "a_livrer" or (
                             c["etat"] == "livree" and maintenant - c["livree"] > self.redistribution))]
                if prets or maintenant >= fin:
                    break
                self.cond.wait(min(fin - maintenant, self.redistribution))
            for c in prets:
                c.update(etat="livree", livree=maintenant)
            return {"commandes": [{"id": c["id"], "onglet": c["onglet"], "nom": c["nom"], "args": c["args"],
                                   "ecriture": c["ecriture"]} for c in sorted(prets, key=lambda c: c["cree"])]}

    def _reponse(self, _handler, _params, corps):
        etat = corps.get("etat")
        if etat not in ETATS_PAGE:
            raise Refus(400, "Champ « etat » invalide.")
        with self.cond:
            c = self.commandes.get(corps.get("id"))
            if c is None:
                raise Refus(404, "Commande inconnue.")
            if c["etat"] not in FINAUX:      # un état final ne change plus
                if etat in FINAUX:
                    self._finir(c, etat, corps.get("resultat"))
                else:
                    c["etat"] = etat
                    self.cond.notify_all()
        return {"ok": True}

    # -- routes du MCP (ce poste) -------------------------------------------
    def _commande(self, _handler, _params, corps):
        pages = corps.get("page")
        pages = [pages] if isinstance(pages, str) else pages
        if not isinstance(pages, list) or not pages or not all(isinstance(p, str) for p in pages):
            raise Refus(400, "Champ « page » invalide.")
        nom = corps.get("nom")
        if not isinstance(nom, str) or not NOM.match(nom):
            raise Refus(400, "Champ « nom » invalide.")
        args = corps.get("args", {})
        if not isinstance(args, dict):
            raise Refus(400, "Champ « args » invalide : objet attendu.")
        attente = corps.get("attente", self.attente)
        attente = min(float(attente), self.attente) if type(attente) in (int, float) else self.attente
        with self.cond:
            self._menage()
            voulu = corps.get("onglet")
            if voulu is not None:
                o = self.onglets.get(voulu)
                if o is None:
                    raise Refus(404, "Onglet %s inconnu ou fermé : voir pilote_onglets." % voulu)
                if o["page"] not in pages:
                    raise Refus(404, "L'onglet %s est une page %s, pas %s." % (voulu, o["page"], " ou ".join(pages)))
            else:
                candidats = [o for o in self.onglets.values() if o["page"] in pages]
                if not candidats:
                    raise Refus(404, "Aucun onglet %s ouvert." % " ou ".join(pages))
                o = max(candidats, key=lambda o: o["focus"])
            c = {"id": secrets.token_hex(16), "onglet": o["id"], "navigateur": o["navigateur"], "nom": nom,
                 "args": args, "ecriture": corps.get("ecriture") is True, "etat": "a_livrer", "resultat": None,
                 "cree": time.monotonic(), "livree": 0.0, "fin": 0.0, "cible": dict(o)}
            self.commandes[c["id"]] = c
            self.cond.notify_all()
            fin = time.monotonic() + attente
            while c["etat"] not in FINAUX and time.monotonic() < fin:
                self.cond.wait(fin - time.monotonic())
            return self._vue(c)

    def _onglets(self, _handler, _params, _corps):
        with self.cond:
            self._menage()
            liste = sorted(self.onglets.values(), key=lambda o: -o["focus"])
            return {"onglets": [self._vue_onglet(o) for o in liste]}

    def _suivre(self, _handler, params, _corps):
        with self.cond:
            self._menage()
            c = self.commandes.get(params.get("id", ""))
            if c is None:
                raise Refus(404, "Commande inconnue (ou finie depuis plus d'une heure).")
            return self._vue(c)


if __name__ == "__main__":
    # Vérification : un vrai serveur sur la boucle locale ; une page d'un autre appareil
    # est simulée en faisant croire au pilote que la requête ne vient pas de ce poste.
    import http.client
    import http.server
    import json
    import threading
    import time

    P = Pilote(attente=1.0, attente_poll=0.5, oubli=1.0, redistribution=0.3, max_corps=4096)
    distant = [False]
    P.ce_poste = lambda h: not distant[0]

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            if not P.traiter(self):
                self.send_error(404)

        do_POST = do_GET

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    def req(methode, route, corps=None, brut=None, entetes=None):
        c = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=10)
        donnees = brut if brut is not None else (None if corps is None else json.dumps(corps).encode())
        c.request(methode, route, body=donnees, headers=dict({"Content-Type": "application/json"}, **(entetes or {})))
        r = c.getresponse()
        texte = r.read().decode()
        c.close()
        return r.status, (json.loads(texte) if texte.startswith(("{", "[")) else texte)

    def battement(nav, onglets):
        return req("POST", "/api/pilote/battement", {"navigateur": nav, "onglets": onglets})

    def onglet(id_, page, il_y_a, projet="carte"):
        return {"id": id_, "page": page, "projet": projet, "focus_il_y_a": il_y_a, "interrupteur": False}

    # Une route qui n'est pas au pilote : le serveur la garde pour lui
    assert req("GET", "/api/autre")[0] == 404

    # Battement, puis la liste des onglets (la plus récemment utilisée en tête)
    assert battement("nav1", [onglet("A", "pcb", 5000), onglet("B", "schema", 1000),
                              onglet("C", "pcb", 2000)])[0] == 200
    code, liste = req("GET", "/api/pilote/onglets")
    assert code == 200 and [o["id"] for o in liste["onglets"]] == ["B", "C", "A"], liste
    assert liste["onglets"][0]["appareil"] == "ce poste" and liste["onglets"][0]["page"] == "schema"

    # Une commande sans onglet nommé va au pcb le plus récent (C) ; la réponse de la page
    # débloque l'appel qui attendait
    rendu = {}

    def commander(cle, corps):
        rendu[cle] = req("POST", "/api/pilote/commande", corps)

    t = threading.Thread(target=commander, args=("calc", {"page": "pcb", "nom": "cao_calcul",
                                                          "args": {"analyse": "impedance"}, "ecriture": False}))
    t.start()
    code, recu = req("GET", "/api/pilote/attendre?navigateur=nav1")
    assert code == 200 and len(recu["commandes"]) == 1, recu
    cmd = recu["commandes"][0]
    assert (cmd["onglet"], cmd["nom"], cmd["args"]) == ("C", "cao_calcul", {"analyse": "impedance"}), cmd
    assert req("POST", "/api/pilote/reponse", {"id": cmd["id"], "etat": "finie", "resultat": {"z": 50}})[0] == 200
    t.join(5)
    code, fin = rendu["calc"]
    assert code == 200 and (fin["etat"], fin["resultat"], fin["onglet"]["id"]) == ("finie", {"z": 50}, "C"), fin

    # Plusieurs pages possibles : la plus récente parmi elles
    t = threading.Thread(target=commander, args=("deux", {"page": ["pcb", "schema"], "nom": "x", "args": {}}))
    t.start()
    cmd = req("GET", "/api/pilote/attendre?navigateur=nav1")[1]["commandes"][0]
    assert cmd["onglet"] == "B", cmd
    req("POST", "/api/pilote/reponse", {"id": cmd["id"], "etat": "finie", "resultat": None})
    t.join(5)

    # Pas de réponse dans le délai : « en_attente » avec un id, puis suivre voit la suite
    code, att = req("POST", "/api/pilote/commande", {"onglet": "B", "page": "schema", "nom": "cao_valeur_composant",
                                                     "args": {"ref": "R1", "valeur": "4k7"}, "ecriture": True})
    assert code == 200 and att["etat"] == "a_livrer" and len(att["id"]) >= 32, att
    cmd = req("GET", "/api/pilote/attendre?navigateur=nav1")[1]["commandes"][0]
    assert cmd["id"] == att["id"] and cmd["ecriture"] is True
    req("POST", "/api/pilote/reponse", {"id": cmd["id"], "etat": "proposee"})      # carte affichée
    assert req("GET", "/api/pilote/suivre?id=" + att["id"])[1]["etat"] == "proposee"
    req("POST", "/api/pilote/reponse", {"id": cmd["id"], "etat": "appliquee", "resultat": "R1 = 4k7"})
    vue = req("GET", "/api/pilote/suivre?id=" + att["id"])[1]
    assert (vue["etat"], vue["resultat"]) == ("appliquee", "R1 = 4k7"), vue
    # Un état final ne change plus
    req("POST", "/api/pilote/reponse", {"id": cmd["id"], "etat": "refusee"})
    assert req("GET", "/api/pilote/suivre?id=" + att["id"])[1]["etat"] == "appliquee"

    # Le relais a reçu la commande mais l'onglet ne l'a pas accusée (relais fermé en route) :
    # elle est redistribuée ; une fois accusée (« recue »), plus jamais
    code, att = req("POST", "/api/pilote/commande", {"onglet": "A", "page": "pcb", "nom": "x", "args": {}})
    premier = req("GET", "/api/pilote/attendre?navigateur=nav1")[1]["commandes"]
    assert [c["id"] for c in premier] == [att["id"]]
    time.sleep(0.4)
    second = req("GET", "/api/pilote/attendre?navigateur=nav1")[1]["commandes"]
    assert [c["id"] for c in second] == [att["id"]], second                      # redistribuée
    req("POST", "/api/pilote/reponse", {"id": att["id"], "etat": "recue"})
    time.sleep(0.4)
    assert req("GET", "/api/pilote/attendre?navigateur=nav1")[1]["commandes"] == []  # accusée : rien

    # Cibles impossibles : erreur lisible, rien n'est mis en file
    for corps in ({"onglet": "Z", "page": "pcb", "nom": "x"}, {"page": "3d", "nom": "x"}):
        code, err = req("POST", "/api/pilote/commande", corps)
        assert code == 404 and err["detail"], (corps, err)
    assert req("GET", "/api/pilote/suivre?id=" + "0" * 32)[0] == 404

    # Un autre appareil (page sur l'iPad) : il bat, attend et répond ; il ne commande pas
    distant[0] = True
    assert battement("ipad", [onglet("I", "pcb", 0)])[0] == 200
    for methode, route, corps in (("POST", "/api/pilote/commande", {"page": "pcb", "nom": "x"}),
                                  ("GET", "/api/pilote/onglets", None), ("GET", "/api/pilote/suivre?id=x", None)):
        assert req(methode, route, corps)[0] == 403, route
    distant[0] = False
    ipad = [o for o in req("GET", "/api/pilote/onglets")[1]["onglets"] if o["id"] == "I"][0]
    assert ipad["appareil"] == "127.0.0.1" and ipad["navigateur"] == "ipad", ipad

    # Une autre page web (un autre site ouvert dans le navigateur) ne parle pas au pilote,
    # même si le serveur hôte ne contrôle pas l'Origin (WEB_3D)
    hote = "127.0.0.1:%d" % srv.server_address[1]
    assert req("POST", "/api/pilote/battement", {"navigateur": "n", "onglets": []},
               entetes={"Origin": "https://evil.example"})[0] == 403
    assert req("POST", "/api/pilote/battement", {"navigateur": "n", "onglets": []},
               entetes={"Origin": "http://" + hote})[0] == 200

    # Corps refusés
    assert req("POST", "/api/pilote/battement", brut=b"{pas du json")[0] == 400
    assert req("POST", "/api/pilote/battement", brut=b"x" * 5000)[0] == 413
    assert req("POST", "/api/pilote/battement", {"navigateur": "a b", "onglets": []})[0] == 400
    assert req("POST", "/api/pilote/battement", {"navigateur": "n", "onglets": [{"id": "x"}]})[0] == 400
    assert req("POST", "/api/pilote/reponse", {"id": att["id"], "etat": "piratee"})[0] == 400
    assert req("POST", "/api/pilote/commande", {"page": "pcb", "nom": "x", "args": []})[0] == 400
    assert req("GET", "/api/pilote/inconnue")[0] == 404
    assert req("GET", "/api/pilote/commande")[0] == 405

    # Un battement remplace la liste du navigateur : un onglet fermé disparaît
    battement("nav1", [onglet("B", "schema", 0)])
    assert {o["id"] for o in req("GET", "/api/pilote/onglets")[1]["onglets"]} == {"B", "I"}

    # Onglets muets oubliés ; une commande encore en file pour eux expire
    code, att = req("POST", "/api/pilote/commande", {"onglet": "B", "page": "schema", "nom": "x", "args": {}})
    time.sleep(1.2)
    assert req("GET", "/api/pilote/onglets")[1]["onglets"] == []
    assert req("GET", "/api/pilote/suivre?id=" + att["id"])[1]["etat"] == "expiree"

    srv.shutdown()
    print("OK")
