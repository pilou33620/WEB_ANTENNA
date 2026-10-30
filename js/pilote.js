/* Canal de pilotage, côté page : le MCP de web_suite agit dans les onglets ouverts.

   COPIE IDENTIQUE dans WEB_CAO, WEB_ANTENNA et WEB_3D ; l'original est
   web_suite/lanceur/pilote.js et la CI de web_suite vérifie les copies.
   Spec : web_suite/lanceur/docs/SPEC-mcp-canal-pilote.md. Banc : lanceur/banc_pilote.js.

   Usage dans une page (ENTETE_WEB déclaré avant ce script : l'en-tête maison des POST de l'outil) :
       const ENTETE_WEB = { "X-WEB_CAO": "1" };
       Pilote.declarer({page: "pcb", projet: () => nomDuProjet});
       Pilote.capture(() => canevas);
       Pilote.commande("cao_calcul", {executer: async args => rapport});
       Pilote.commande("cao_valeur_composant", {ecriture: true, historique: true,
                                                proposer: args => ({...}), appliquer: args => {...}});

   DANS L'AUTRE SENS : la zone de texte du panneau envoie une demande à Claude Code du poste
   (/api/pilote/demande, que le lanceur de web_suite lui passe : claude_pages.py) et affiche
   la conversation au fil de l'eau (/api/pilote/conversation).

   UN SEUL ONGLET RELAIS PAR NAVIGATEUR : les onglets d'un même outil s'annoncent
   sur un BroadcastChannel ; le plus petit id parmi ceux entendus récemment tient
   seul le long-poll (le navigateur limite les connexions par origine) et
   transmet les commandes aux autres. Pas de navigator.locks : il n'existe pas en
   HTTP sur une adresse du réseau local, ce qu'ouvre l'iPad. */
(function () {
  "use strict";

  const CLE_NAVIGATEUR = "websuite.pilote.navigateur";
  const LARGEUR_MAX = 1600;        // px, en largeur comme en hauteur
  const MAX_PANNEAU = 30;          // entrées gardées dans le panneau
  const MAX_TEXTE = 8000;          // caractères d'une demande (pilote.py)
  // Pièces jointes (pilote.py, SPEC-claude-pages.md) : la page prévient, le serveur fait foi
  const MAX_PIECES = 10, MAX_PIECES_OCTETS = 20 * 1024 * 1024, MAX_PIECES_TEXTE = 400000;
  const MAX_IMAGE = 3932160;       // octets : 5 Mo en base64, la limite de l'API par image
  const COTE_IMAGE = 2000;         // px : au-delà, l'image est réduite ici
  const IMAGES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  const MODELES = [["opus", "Opus"], ["sonnet", "Sonnet"], ["haiku", "Haiku"]];   // pilote.py, le premier par défaut
  const FINAUX = ["appliquee", "refusee", "finie", "echouee"];
  const NOM = /^[a-z_][a-z0-9_]{0,63}$/;

  function nouvelId() {
    const o = new Uint8Array(12);
    crypto.getRandomValues(o);      // existe aussi hors contexte sécurisé, contrairement à randomUUID
    return Array.from(o, b => b.toString(16).padStart(2, "0")).join("");
  }

  function idNavigateur(stockage, repli) {
    try {
      let id = stockage.getItem(CLE_NAVIGATEUR);
      if (!/^[0-9a-f]{24}$/.test(id || "")) { id = nouvelId(); stockage.setItem(CLE_NAVIGATEUR, id); }
      return id;
    } catch (_) {
      return repli;                 // stockage interdit (navigation privée stricte) : un relais par onglet
    }
  }

  /* « Ctrl+Shift+Z », « Delete », « Escape », « r »… pour le geste « touche » : la touche en dernier,
     au nom du DOM (KeyboardEvent.key). */
  function touches(texte) {
    const m = /^(.*?)\+?([^+]+|\+)$/.exec(String(texte || "").trim());
    if (!m) throw new Error("Touche vide : « Ctrl+Z », « Delete », « Escape », « r »…");
    const mods = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    for (const p of m[1].split("+").filter(Boolean)) {
      const cle = { ctrl: "ctrlKey", control: "ctrlKey", shift: "shiftKey", maj: "shiftKey", alt: "altKey",
                    meta: "metaKey", cmd: "metaKey" }[p.toLowerCase()];
      if (!cle) throw new Error("Modificateur « " + p + " » inconnu : Ctrl, Shift, Alt, Meta.");
      mods[cle] = true;
    }
    let key = m[2];
    if (key.length === 1) key = mods.shiftKey ? key.toUpperCase() : key.toLowerCase();
    const code = /^[a-z]$/i.test(key) ? "Key" + key.toUpperCase() : /^\d$/.test(key) ? "Digit" + key : key;
    return Object.assign({ key, code }, mods);
  }

  function creer(env, reglages) {
    /* silence > 60 s : après 5 min en arrière-plan, Chrome ne réveille plus les minuteurs d'un onglet
       qu'une fois par minute ; un onglet caché s'annonce donc rarement, mais il est vivant. Un onglet
       qui se ferme proprement le dit (« bye ») : l'attente ne joue que pour un onglet tué net. */
    const R = Object.assign({ annonce: 2000, amorce: 5000, silence: 90000, battement: 20000, repos: 2000 },
                            reglages || {});
    const P = {
      id: nouvelId(), relais: false, _env: env,
      page: "", projet: () => "", focus: Date.now(), interrupteur: false,
      commandes: {}, capturer: null,
    };
    let canal = null, actif = false, minuteurs = [], arretPoll = null, dernierEnvoi = "";
    const vus = new Map();          // id d'onglet -> {onglet, t}
    const traitees = new Set();     // ids de commandes déjà reçues : une redistribution ne rejoue rien
    const originaux = new WeakMap(); // def d'écriture -> son « appliquer » d'origine, que seul le clic appelle
    const nav = idNavigateur(env.stockage, P.id);
    // En-tête maison de l'outil (X-WEB_CAO…), que son serveur exige sur tout POST : REGLES §2.3
    const enJson = Object.assign({ "Content-Type": "application/json" }, env.entete);

    function visible() {
      if (env.visible) return !!env.visible();
      return !(env.document && env.document.visibilityState === "hidden");
    }

    /* Le focus voyage en heure absolue : les onglets d'un navigateur partagent la même horloge, et
       le relais le convertit en « il y a » au moment d'écrire au serveur (qui, lui, a la sienne). */
    function vue() {
      let projet = "";
      try { projet = String(P.projet() || ""); } catch (_) { /* projet illisible : vide */ }
      return { id: P.id, page: P.page, projet: projet.slice(0, 200), focus: P.focus,
               interrupteur: P.interrupteur, visible: visible() };
    }

    function pourServeur(onglets) {
      return onglets.map(o => ({ id: o.id, page: o.page, projet: o.projet, interrupteur: o.interrupteur,
                                 focus_il_y_a: Math.max(0, Date.now() - o.focus) }));
    }

    function vivants() {
      const limite = Date.now() - R.silence;
      return [...vus.values()].filter(v => v.t > limite).map(v => v.onglet);
    }

    async function envoyer(route, corps) {
      const r = await env.fetch("/api/pilote/" + route, {
        method: "POST", headers: enJson, body: JSON.stringify(corps) });
      if (!r.ok) {
        const e = new Error("pilote : " + route + " a répondu " + r.status);
        e.statut = r.status;
        throw e;
      }
      return true;
    }

    /* La réponse porte le navigateur : le serveur n'accepte que celui de la commande. Un état final
       perdu laisserait Claude attendre pour rien : trop gros, on le dit ; sinon, un second essai. */
    function repondre(id, etat, resultat) {
      const corps = { navigateur: nav, id, etat, resultat: resultat === undefined ? null : resultat };
      return envoyer("reponse", corps).catch(e => {
        if (!FINAUX.includes(etat)) { console.warn(e.message); return false; }
        const suite = e.statut === 413
          ? envoyer("reponse", { navigateur: nav, id, etat: "echouee", resultat: "Réponse trop grosse pour le serveur." })
          : new Promise(f => setTimeout(f, 1000)).then(() => envoyer("reponse", corps));
        return suite.catch(e2 => { console.warn(e2.message); return false; });
      });
    }

    // -- relais : battement et long-poll ------------------------------------
    function battre(force) {
      const onglets = pourServeur([vue()].concat(vivants()));
      // L'ordre par focus fait partie de la clé : un clic dans un autre onglet part aussitôt
      const cle = onglets.slice().sort((a, b) => a.focus_il_y_a - b.focus_il_y_a)
        .map(o => o.id + o.page + o.projet + o.interrupteur).join("|");
      if (!force && cle === dernierEnvoi) return;
      dernierEnvoi = cle;
      envoyer("battement", { navigateur: nav, onglets }).catch(e => { dernierEnvoi = ""; console.warn(e.message); });
    }

    function annoncer() {
      if (canal) canal.postMessage({ t: "present", onglet: vue() });
    }

    async function boucle() {
      let enPanne = false;
      while (actif && P.relais) {
        const ctl = typeof AbortController === "function" ? new AbortController() : null;
        arretPoll = ctl;
        try {
          const r = await env.fetch("/api/pilote/attendre?navigateur=" + nav, ctl ? { signal: ctl.signal } : {});
          if (!r.ok) throw new Error("pilote : attendre a répondu " + r.status);
          if (enPanne) { enPanne = false; battre(true); }    // serveur redémarré : il ne connaît plus nos onglets
          const d = await r.json();
          (d.commandes || []).forEach(livrer);
        } catch (_) {
          enPanne = true;
          if (actif && P.relais) await new Promise(f => setTimeout(f, R.repos));   // serveur arrêté : on réessaie
        }
      }
    }

    /* Le relais : le plus petit id parmi les onglets visibles s'il y en a. Un onglet caché, que le
       navigateur ralentit, s'annonce mal et tiendrait mal le long-poll. */
    function elire() {
      const tous = [vue()].concat(vivants());
      const visibles = tous.filter(o => o.visible !== false);
      const ids = (visibles.length ? visibles : tous).map(o => o.id).sort();
      const moi = ids[0] === P.id;
      if (moi && !P.relais) { P.relais = true; battre(true); boucle(); }
      else if (!moi && P.relais) { P.relais = false; if (arretPoll) arretPoll.abort(); }
      if (P.relais) battre(false);
    }

    function livrer(c) {
      if (c.onglet === P.id) recevoir(c);
      else if (canal) canal.postMessage({ t: "commande", c });
    }

    // -- onglet visé : exécuter --------------------------------------------
    /* N'exécuter qu'une commande que le serveur reconnaît (accusé accepté) : un script de la même
       origine ne peut pas en fabriquer une sur le BroadcastChannel. */
    async function recevoir(c) {
      if (traitees.has(c.id)) return;
      traitees.add(c.id);
      if (!(await repondre(c.id, "recue"))) { traitees.delete(c.id); return; }   // la redistribution réessaiera
      executer(c);
    }

    async function executer(c) {
      const args = c.args || {};
      try {
        if (c.nom === "capture") { const image = capturer(); tracer("Claude a capturé la vue."); return repondre(c.id, "finie", image); }
        if (c.nom === "interface_lire") { tracer("Claude a lu l'interface."); return repondre(c.id, "finie", lireInterface(args)); }
        if (c.nom === "interface") return await ecrire(c, INTERFACE, args);
        const def = P.commandes[c.nom];
        if (!def) throw new Error("Commande « " + c.nom + " » inconnue de cette page (" + P.page + ").");
        if (def.ecriture) return await ecrire(c, def, args);
        // déjà annoncée par la conversation du panneau (« → nom ») : pas deux lignes pour un geste
        if (dernierOutil !== c.nom) tracer("Claude a lancé : " + c.nom);
        dernierOutil = null;
        repondre(c.id, "finie", await def.executer(args));
      } catch (e) {
        repondre(c.id, "echouee", String((e && e.message) || e));
      }
    }

    function capturer() {
      if (!P.capturer) throw new Error("Cette page n'a pas de canevas à capturer.");
      let toile = P.capturer();
      const k = Math.min(1, LARGEUR_MAX / toile.width, LARGEUR_MAX / toile.height);
      if (k < 1) {
        const petite = env.document.createElement("canvas");
        petite.width = Math.max(1, Math.round(toile.width * k));
        petite.height = Math.max(1, Math.round(toile.height * k));
        petite.getContext("2d").drawImage(toile, 0, 0, petite.width, petite.height);
        toile = petite;
      }
      return { image: toile.toDataURL("image/png"), largeur: toile.width, hauteur: toile.height };
    }

    // -- l'interface de la page, comme l'utilisateur la voit ------------------
    /* interface_lire numérote les contrôles visibles (data-pilote) ; interface y fait un geste, pour ce
       qu'aucune commande de la page ne fait. Le panneau n'en fait jamais partie : Claude n'appuie pas
       sur ses propres cartes ni sur l'interrupteur. */
    const CONTROLES = "button, a[href], input, select, textarea, summary, [contenteditable=true], [onclick], " +
                      "[role=button], [role=tab], [role=menuitem], [role=checkbox], [role=option], [role=switch]";

    function dansPanneau(e) { return !!(panneau && e && panneau.contains(e)); }

    function libelle(e) {
      // un champ n'a pas de texte à lui (celui d'un select, ce sont ses choix) : son <label>, ou celui qui le précède
      const champ = /^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName), avant = e.previousElementSibling;
      let t = e.getAttribute("aria-label") || (champ ? (e.labels && e.labels[0] && e.labels[0].textContent) ||
              (avant && avant.tagName === "LABEL" && avant.textContent) || e.placeholder || e.name : e.innerText) || "";
      if (e.title && e.title !== t) t = t ? t + " — " + e.title : e.title;   // l'infobulle des boutons à icône
      return String(t).replace(/\s+/g, " ").trim().slice(0, 100);
    }

    function etatControle(e) {
      const t = (e.type || "").toLowerCase(), d = [];
      if (t === "checkbox" || t === "radio") d.push(e.checked ? "coché" : "décoché");
      else if (e.tagName === "SELECT")
        d.push("= « " + (e.selectedOptions[0] ? e.selectedOptions[0].text.trim() : "") + " » parmi : " +
               [...e.options].slice(0, 40).map(o => o.text.trim()).join(" | ") + (e.options.length > 40 ? " | …" : ""));
      else if (/^(INPUT|TEXTAREA)$/.test(e.tagName) && !/^(button|submit|reset|file)$/.test(t))
        d.push("= « " + String(e.value).slice(0, 80) + " »");
      if (e.disabled) d.push("désactivé");
      if (e.getAttribute("aria-selected") === "true" || e.getAttribute("aria-pressed") === "true" || e.classList.contains("active"))
        d.push("actif");
      return d.join(", ");
    }

    /* La toile de capture, si elle est à l'écran : les gestes « souris » sont en pixels de la capture. */
    function toileEcran() {
      const t = P.capturer && P.capturer();
      return t && t.isConnected && t.getBoundingClientRect().width ? t : null;
    }
    function echelle(t) { return Math.min(1, LARGEUR_MAX / t.width, LARGEUR_MAX / t.height); }

    function lireInterface(a) {
      const doc = env.document, filtre = String(a.filtre || "").toLowerCase(), L = [];
      doc.querySelectorAll("[data-pilote]").forEach(e => e.removeAttribute("data-pilote"));
      let n = 0;
      for (const e of doc.querySelectorAll(CONTROLES)) {
        if (dansPanneau(e) || e.type === "hidden" || !e.getClientRects().length ||
            env.fenetre.getComputedStyle(e).visibility === "hidden") continue;
        e.dataset.pilote = ++n;        // numéroté même hors filtre : un numéro ne dépend pas du filtre
        const lib = libelle(e), etat = etatControle(e);
        if (filtre && !(lib + " " + etat + " " + e.id).toLowerCase().includes(filtre)) continue;
        L.push("[" + n + "] " + e.tagName.toLowerCase() + (e.type && e.tagName === "INPUT" ? "/" + e.type : "") +
               (e.id ? " #" + e.id : "") + " « " + lib + " »" + (etat ? " (" + etat + ")" : ""));
      }
      const t = toileEcran();
      if (t) L.unshift("Canevas (gestes « souris ») : " + Math.round(t.width * echelle(t)) + " × " +
                       Math.round(t.height * echelle(t)) + " px, les coordonnées de la capture.");
      return (L.length ? L : ["Aucun contrôle visible" + (filtre ? " pour « " + filtre + " »." : ".")]).join("\n");
    }

    function cibleUi(c) {
      const s = String(c == null ? "" : c).trim();
      let e = null;
      try { e = /^\d+$/.test(s) ? env.document.querySelector('[data-pilote="' + s + '"]') : s && env.document.querySelector(s); }
      catch (_) { throw new Error("« cible » : un numéro rendu par interface_lire, ou un sélecteur CSS (#bDrc)."); }
      if (!e) throw new Error("Cible « " + s + " » introuvable : relis l'interface, elle a pu changer.");
      if (dansPanneau(e)) throw new Error("Le panneau « Claude » est réservé à l'utilisateur.");
      if (e.disabled) throw new Error("« " + libelle(e) + " » est désactivé.");
      return e;
    }

    function souris(e, type, x, y, o) {
      const W = env.fenetre, Ev = type.startsWith("pointer") ? W.PointerEvent : type === "wheel" ? W.WheelEvent : W.MouseEvent;
      return e.dispatchEvent(new Ev(type, Object.assign({ bubbles: true, cancelable: true, composed: true, view: W,
        clientX: x, clientY: y, button: 0, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }, o)));
    }

    /* Un clic comme le navigateur le fait : pointer puis souris (sauf pointerdown empêché), puis click. */
    function clic(e, x, y, o, detail) {
      const bas = Object.assign({}, o, { buttons: o.button === 2 ? 2 : 1, detail }), haut = Object.assign({}, o, { detail });
      const compat = souris(e, "pointerdown", x, y, bas);
      if (compat) souris(e, "mousedown", x, y, bas);
      souris(e, "pointerup", x, y, haut);
      if (compat) souris(e, "mouseup", x, y, haut);
      souris(e, o.button === 2 ? "contextmenu" : "click", x, y, haut);
    }

    function changer(e) {
      e.dispatchEvent(new env.fenetre.Event("input", { bubbles: true }));
      e.dispatchEvent(new env.fenetre.Event("change", { bubbles: true }));
    }

    /* Le geste, vérifié pour la carte (proposer) et recalculé au clic : le contrôle a pu bouger depuis. */
    function geste(a) {
      const g = a.geste;
      if (g === "cliquer" || g === "saisir") {
        const e = cibleUi(a.cible), lib = "« " + libelle(e) + " »";
        if (g === "cliquer") return { titre: "Interface : cliquer " + lib, faire: () => {
          const r = e.getBoundingClientRect();
          if (typeof e.focus === "function") e.focus();
          clic(e, r.left + r.width / 2, r.top + r.height / 2, { button: 0 }, 1);
          return "Cliqué " + lib + ".";
        } };
        if (a.valeur == null) throw new Error("« saisir » : donne « valeur ».");
        const t = (e.type || "").toLowerCase(), v = a.valeur;
        if (t === "checkbox" || t === "radio") {
          const voulu = v === true || /^(true|1|oui|coché)$/i.test(String(v));
          return { titre: "Interface : " + lib, avant: e.checked ? "coché" : "décoché", apres: voulu ? "coché" : "décoché",
                   faire: () => { if (e.checked !== voulu) e.click(); return lib + (e.checked ? " coché." : " décoché."); } };
        }
        if (e.tagName === "SELECT") {
          const q = String(v).trim().toLowerCase(), opts = [...e.options];
          const o = opts.find(x => x.value.toLowerCase() === q) || opts.find(x => x.text.trim().toLowerCase() === q);
          if (!o) throw new Error(lib + " : « " + v + " » n'est pas un choix (" + opts.map(x => x.text.trim()).join(" | ") + ").");
          return { titre: "Interface : " + lib, avant: e.selectedOptions[0] ? e.selectedOptions[0].text.trim() : "", apres: o.text.trim(),
                   faire: () => { e.value = o.value; changer(e); return lib + " = « " + o.text.trim() + " »."; } };
        }
        if (!/^(INPUT|TEXTAREA)$/.test(e.tagName) && !e.isContentEditable) throw new Error(lib + " n'est pas un champ à remplir.");
        return { titre: "Interface : " + lib, avant: e.isContentEditable ? e.innerText : e.value, apres: String(v), faire: () => {
          if (typeof e.focus === "function") e.focus();
          if (e.isContentEditable) e.textContent = String(v);
          // le setter natif : une valeur posée par e.value = … échappe aux composants qui le surchargent
          else Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), "value").set.call(e, String(v));
          changer(e);
          return lib + " = « " + String(v).slice(0, 80) + " ».";
        } };
      }
      if (g === "touche") {
        const k = touches(a.touche), nom = String(a.touche).trim();
        return { titre: "Interface : touche " + nom, faire: () => {
          const doc = env.document;
          let e = a.cible != null ? cibleUi(a.cible) : doc.activeElement;
          if (!e || e === doc.documentElement || dansPanneau(e)) e = doc.body;   // pas le bouton « Appliquer » de la carte
          const o = Object.assign({ bubbles: true, cancelable: true, composed: true, view: env.fenetre }, k);
          e.dispatchEvent(new env.fenetre.KeyboardEvent("keydown", o));
          e.dispatchEvent(new env.fenetre.KeyboardEvent("keyup", o));
          return "Touche " + nom + ".";
        } };
      }
      if (g === "souris") {
        const t = toileEcran();
        if (!t) throw new Error("Pas de canevas à l'écran dans cette page : « cliquer » un contrôle d'interface_lire.");
        const k = echelle(t);
        const point = (x, y) => {
          if (typeof x !== "number" || typeof y !== "number") throw new Error("« souris » : x et y, en pixels de la capture.");
          const r = t.getBoundingClientRect();
          return [r.left + x / k * r.width / t.width, r.top + y / k * r.height / t.height];
        };
        const [x, y] = point(a.x, a.y);
        const fin = a.x2 != null || a.y2 != null ? point(a.x2, a.y2) : null;
        const mods = a.modificateurs ? touches(a.modificateurs + "+x") : {};
        delete mods.key; delete mods.code;
        const quoi = a.molette ? "molette " + a.molette : fin ? "glisser jusqu'à (" + a.x2 + ", " + a.y2 + ")" :
                     a.double ? "double-clic" : a.droit ? "clic droit" : "clic";
        return { titre: "Interface : " + quoi + " sur le canevas en (" + a.x + ", " + a.y + ")" +
                        (a.modificateurs ? " avec " + a.modificateurs : ""), faire: () => {
          const e = env.document.elementFromPoint(x, y);
          if (!e) throw new Error("Ce point du canevas est hors de l'écran : recadre la vue, puis une nouvelle capture.");
          if (dansPanneau(e)) throw new Error("Le panneau « Claude » couvre ce point : demande à l'utilisateur de le replier.");
          const o = Object.assign({ button: a.droit ? 2 : 0 }, mods);
          souris(e, "pointermove", x, y, o);
          souris(e, "mousemove", x, y, o);
          if (a.molette) souris(e, "wheel", x, y, Object.assign({ deltaY: a.molette, deltaMode: 0 }, o));
          else if (fin) {
            const bas = Object.assign({}, o, { buttons: 1 });
            souris(e, "pointerdown", x, y, bas);
            souris(e, "mousedown", x, y, bas);
            for (let i = 1; i <= 8; i++) {
              const xi = x + (fin[0] - x) * i / 8, yi = y + (fin[1] - y) * i / 8;
              souris(e, "pointermove", xi, yi, bas);
              souris(e, "mousemove", xi, yi, bas);
            }
            souris(e, "pointerup", fin[0], fin[1], o);
            souris(e, "mouseup", fin[0], fin[1], o);
          } else {
            clic(e, x, y, o, 1);
            if (a.double) { clic(e, x, y, o, 2); souris(e, "dblclick", x, y, Object.assign({ detail: 2 }, o)); }
          }
          return quoi[0].toUpperCase() + quoi.slice(1) + " fait sur le canevas.";
        } };
      }
      throw new Error("« geste » : cliquer, saisir, touche ou souris.");
    }

    // Une écriture comme celles des pages : la carte attend le clic, sauf interrupteur allumé
    const INTERFACE = {
      irreversible: "Un geste dans l'interface, comme le tien : la carte ne l'annule pas (Ctrl+Z dans l'éditeur, " +
                    "si le geste y fait une étape).",
      proposer: a => { const p = geste(a); return { titre: p.titre, avant: p.avant, apres: p.apres }; },
      appliquer: async a => {
        const dit = geste(a).faire();
        await new Promise(r => env.fenetre.requestAnimationFrame(() => setTimeout(r, 50)));   // laisser la page se redessiner
        return dit;
      },
    };

    // -- écritures : carte, interrupteur, annulation ------------------------
    function texte(v) { return typeof v === "string" ? v : JSON.stringify(v); }

    async function ecrire(c, def, args) {
      // proposer peut lire avant de montrer la carte (liste de fichiers) : un rejet remonte en « echouee »
      const prop = (await def.proposer(args)) || {};
      const carte = { id: c.id, nom: c.nom, def, args, prop, etat: "proposee", jeton: undefined, apres: null };
      // « clic » : la carte attend toujours le clic, même interrupteur allumé (une écriture partagée)
      if (P.interrupteur && !def.clic) {
        appliquer(carte, true);
      } else {
        dessinerCarte(carte);
        ouvrir(true);
        repondre(c.id, "proposee");
      }
    }

    /* appliquer et annuler peuvent être asynchrones (ouvrir lit des fichiers) : pendant l'attente,
       la carte est « en cours », sans bouton, donc un double clic ne rejoue rien. */
    async function appliquer(carte, direct) {
      if (carte.etat !== "proposee") return;
      carte.etat = "en_cours";
      dessinerCarte(carte);
      try {
        // La proposition affichée suit : l'adaptateur vérifie qu'elle n'a pas changé depuis
        carte.jeton = await (originaux.get(carte.def) || carte.def.appliquer).call(carte.def, carte.args, carte.prop);
        if (carte.def.etat) carte.apres = texte(carte.def.etat());   // instantané : l'Annuler compare
        carte.etat = "appliquee";
        repondre(carte.id, "appliquee", { titre: texte(carte.prop.titre || carte.nom), avant: carte.prop.avant,
                                          apres: carte.prop.apres, direct: !!direct,
                                          // une écriture irréversible n'a pas de jeton d'annulation : son retour
                                          // (le chemin du fichier créé…) est pour Claude
                                          retour: carte.def.irreversible ? carte.jeton : undefined });
      } catch (e) {
        carte.etat = "echouee";
        carte.message = String((e && e.message) || e);
        repondre(carte.id, "echouee", carte.message);
      }
      if (direct) carte.message = carte.message || "Appliquée directement (interrupteur allumé).";
      dessinerCarte(carte);
      replierPlusTard();
    }

    function refuser(carte) {
      carte.etat = "refusee";
      // crochet facultatif : la page oublie ce qu'elle montrait pour cette carte (un aperçu dessiné)
      if (typeof carte.def.refuser === "function") {
        try { carte.def.refuser(carte.args, carte.prop); } catch (e) { console.warn(e); }
      }
      repondre(carte.id, "refusee");
      dessinerCarte(carte);
      replierPlusTard();
    }

    async function annuler(carte) {
      if (carte.etat !== "appliquee") return;
      // Seulement si rien n'a bougé depuis : sinon on écraserait le travail fait entre-temps
      if (texte(carte.def.etat()) !== carte.apres) {
        carte.message = "L'état a changé depuis : annuler écraserait tes modifications. Défais à la main " +
                        "(ou Ctrl+Z si l'éditeur en a un).";
      } else {
        carte.etat = "en_cours";
        dessinerCarte(carte);
        try { await carte.def.annuler(carte.args, carte.jeton); carte.etat = "annulee"; carte.message = "Annulée."; }
        catch (e) { carte.etat = "appliquee"; carte.message = "Annulation impossible : " + ((e && e.message) || e); }
      }
      dessinerCarte(carte);
    }

    // -- demandes écrites à Claude ------------------------------------------
    let saisie = null, envoi = null, enCours = false, nouvelle = false, dernierOutil = null;
    let pieces = [], puces = null, vueBouton = null;     // pièces jointes de la prochaine demande
    let lectures = 0;                                    // fichiers en cours de lecture
    let pret = true, etatLigne = null, choixModele = null; // pret : faux si le test de connexion a échoué

    /* À chaque ouverture du panneau : le lanceur écoute-t-il, Claude Code est-il installé et connecté ?
       Sans requête au modèle (pilote.py : statut). En rouge, « Envoyer » est désactivé. */
    async function tester() {
      montrerEtat("attente", "Test de la connexion à Claude…");
      let s = null;
      try {
        const r = await env.fetch("/api/pilote/statut");
        if (r.ok) s = await lireJson(r);
      } catch (_) { /* réseau coupé : s reste vide */ }
      if (!s) montrerEtat("ko", "Le serveur de l'outil ne répond pas.");
      else if (!s.lanceur) montrerEtat("ko", "Le lanceur WEB·SUITE ne répond pas : lance l'outil depuis WEB·SUITE pour écrire à Claude.");
      else if (!s.claude) montrerEtat("ko", "Le lanceur n'a pas répondu au test : rouvre le panneau pour réessayer.");
      else montrerEtat(s.claude.pret ? "ok" : "ko", String(s.claude.message || ""));
    }

    function montrerEtat(classe, texte) {
      etatLigne.className = "pilote-etat " + classe;
      etatLigne.textContent = texte;
      pret = classe !== "ko";
      occupe(enCours);
    }

    function base64(octets) {
      let s = "";
      for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
      return btoa(s);
    }

    const poids = c => (c.texte !== undefined ? c.texte.length : Math.floor(c.donnees.length * 3 / 4));
    const taille = o => (o < 1048576 ? Math.max(1, Math.round(o / 1024)) + " Ko" : (o / 1048576).toFixed(1) + " Mo");

    /* Une image passe telle quelle si l'API la prend ; sinon (trop grande, HEIC de l'iPad…) elle est
       redessinée en JPEG d'au plus 2000 px. */
    async function image(f, nom) {
      let bmp = null;
      try { if (env.decoderImage) bmp = await env.decoderImage(f); } catch (_) { /* format illisible ici */ }
      if (IMAGES.includes(f.type) && f.size <= MAX_IMAGE && (!bmp || Math.max(bmp.width, bmp.height) <= COTE_IMAGE))
        return { nom, type: f.type, donnees: base64(new Uint8Array(await f.arrayBuffer())) };
      if (!bmp) throw new Error("« " + nom + " » : image que ce navigateur ne sait pas lire.");
      const k = Math.min(1, COTE_IMAGE / bmp.width, COTE_IMAGE / bmp.height);
      const toile = env.document.createElement("canvas");
      toile.width = Math.max(1, Math.round(bmp.width * k));
      toile.height = Math.max(1, Math.round(bmp.height * k));
      const ctx = toile.getContext("2d");
      ctx.fillStyle = "#fff";                        // le JPEG n'a pas de transparence
      ctx.fillRect(0, 0, toile.width, toile.height);
      ctx.drawImage(bmp, 0, 0, toile.width, toile.height);
      const url = toile.toDataURL("image/jpeg", 0.9);
      return { nom, type: "image/jpeg", donnees: url.slice(url.indexOf(",") + 1) };
    }

    /* Image ou PDF en base64, tout autre fichier lisible en UTF-8 en texte ; un binaire est refusé :
       Claude ne le lirait pas. */
    async function lirePiece(f) {
      const nom = String(f.name || "fichier").replace(/[\u0000-\u001f]/g, " ").slice(0, 200);
      if (/^image\//.test(f.type) && f.type !== "image/svg+xml") return image(f, nom);   // un SVG est du texte
      const octets = new Uint8Array(await f.arrayBuffer());
      if (f.type === "application/pdf" || /\.pdf$/i.test(nom)) return { nom, type: "application/pdf", donnees: base64(octets) };
      let texte = null;
      try { texte = new TextDecoder("utf-8", { fatal: true }).decode(octets); } catch (_) { /* pas de l'UTF-8 */ }
      if (texte === null || texte.includes("\u0000")) throw new Error("« " + nom + " » : fichier binaire, Claude ne peut pas le lire.");
      return { nom, texte };
    }

    function ajouter(c) {
      if (pieces.length >= MAX_PIECES) throw new Error("au plus " + MAX_PIECES + " pièces jointes par demande.");
      const toutes = pieces.concat(c);
      if (toutes.reduce((t, p) => t + poids(p), 0) > MAX_PIECES_OCTETS)
        throw new Error("« " + c.nom + " » dépasse les 20 Mo joints par demande.");
      if (toutes.reduce((t, p) => t + (p.texte || "").length, 0) > MAX_PIECES_TEXTE)
        throw new Error("« " + c.nom + " » dépasse les " + MAX_PIECES_TEXTE + " caractères de texte joint.");
      pieces.push(c);
    }

    function refuserPiece(e) { afficher({ genre: "erreur", texte: "Pièce jointe refusée : " + ((e && e.message) || e) }); }

    async function joindre(fichiers) {
      if (!construire()) return;
      ouvrir(true);
      lectures++;
      try {
        for (const f of Array.from(fichiers || [])) {
          try { ajouter(await lirePiece(f)); } catch (e) { refuserPiece(e); }
        }
      } finally { lectures--; }
      dessinerPieces();
    }

    function joindreVue() {
      try {
        const url = capturer().image;
        ajouter({ nom: "vue-" + (P.page || "page") + ".png", type: "image/png", donnees: url.slice(url.indexOf(",") + 1) });
      } catch (e) { refuserPiece(e); }
      dessinerPieces();
    }

    function dessinerPieces() {
      puces.replaceChildren(...pieces.map(p => {
        const puce = el("span", "pilote-piece", p.nom + " (" + taille(poids(p)) + ")");
        const retirer = bouton("×", () => { pieces = pieces.filter(x => x !== p); dessinerPieces(); });
        retirer.title = "Retirer " + p.nom;
        retirer.setAttribute("aria-label", "Retirer " + p.nom);
        puce.appendChild(retirer);
        return puce;
      }));
    }

    function afficher(m) {
      dernierOutil = m.genre === "outil" ? m.texte : null;
      if (m.genre === "outil") tracer("→ " + m.texte);
      else if (m.genre === "info") tracer(m.texte);
      else garder(liste.appendChild(el("div", m.genre === "erreur" ? "pilote-erreur" : "pilote-reponse", m.texte)));
      liste.scrollTop = liste.scrollHeight;
    }

    function occupe(oui) {
      enCours = oui;
      envoi.disabled = oui || !pret;
      envoi.textContent = oui ? "Claude travaille…" : "Envoyer";
    }

    async function lireJson(r) {
      try { return await r.json(); } catch (_) { return {}; }
    }

    /* La demande part au serveur de l'outil, qui la garde pour le lanceur ; la conversation se
       lit ensuite par long-poll. Une coupure réseau (iPad en veille) se retente quelques fois. */
    async function demander() {
      const texteSaisi = (saisie.value || "").trim();
      if (!texteSaisi || enCours || !construire()) return;
      saisie.value = "";
      occupe(true);
      while (lectures > 0) await new Promise(f => setTimeout(f, 100));   // un fichier déposé à l'instant part aussi
      const envoyees = pieces.slice();
      garder(liste.appendChild(el("div", "pilote-moi", texteSaisi +
        (envoyees.length ? "\nJoint : " + envoyees.map(p => p.nom).join(", ") : ""))));
      ouvrir(true);
      occupe(true);
      try {
        const r = await env.fetch("/api/pilote/demande", {
          method: "POST", headers: enJson,
          body: JSON.stringify({ navigateur: nav, onglet: P.id, texte: texteSaisi, nouvelle, pieces: envoyees,
                                 modele: choixModele.value }) });
        const d = await lireJson(r);
        if (!r.ok) throw new Error(d.detail || "le serveur a répondu " + r.status);
        nouvelle = false;
        pieces = pieces.filter(p => !envoyees.includes(p));   // refusée, la demande garde ses pièces
        dessinerPieces();
        let depuis = 0, coupures = 0;
        for (;;) {
          let c;
          try {
            const rc = await env.fetch("/api/pilote/conversation?navigateur=" + nav + "&id=" + d.id + "&depuis=" + depuis);
            c = await lireJson(rc);
            if (!rc.ok) throw Object.assign(new Error(c.detail || "le serveur a répondu " + rc.status), { definitif: true });
          } catch (e) {
            if (e.definitif || ++coupures > 5) throw e;
            await new Promise(f => setTimeout(f, R.repos));
            continue;
          }
          coupures = 0;
          (c.messages || []).forEach(afficher);
          depuis += (c.messages || []).length;
          if (c.etat === "finie" || c.etat === "echouee") break;
        }
      } catch (e) {
        afficher({ genre: "erreur", texte: "Demande non aboutie : " + ((e && e.message) || e) });
      }
      occupe(false);
    }

    // -- panneau « Claude » (texte par textContent seulement : jamais d'innerHTML) --
    let panneau = null, liste = null, minuteurRepli = null;
    const cartesDom = new Map(), entrees = [];

    function garder(noeud) {
      entrees.push(noeud);
      // Les plus vieilles entrées partent ; jamais une carte qui attend un clic ou qu'on peut encore annuler
      while (entrees.length > MAX_PANNEAU) {
        const i = entrees.findIndex(n => !n.aGarder);
        if (i < 0) break;
        const [vieux] = entrees.splice(i, 1);
        vieux.remove();
        if (vieux.idCarte) cartesDom.delete(vieux.idCarte);
      }
    }

    function el(tag, classe, contenu) {
      const e = env.document.createElement(tag);
      if (classe) e.className = classe;
      if (contenu !== undefined) e.textContent = contenu;
      return e;
    }

    /* Place et masquage du panneau, gardés d'une visite à l'autre : il couvrait
       les avis de la page, coin bas droit. Stockage refusé : rien de gardé. */
    const PREF = "websuite.pilote.";
    function pref(cle, val) {
      try {
        if (!env.stockage) return null;
        if (val === undefined) return env.stockage.getItem(PREF + cle);
        env.stockage.setItem(PREF + cle, val);
      } catch (_) { /* navigation privée stricte */ }
      return null;
    }

    function construire() {
      if (panneau || !env.document || !env.document.body) return panneau;
      panneau = el("aside", "pilote");
      const barre = el("div", "pilote-barre");
      const tete = el("button", "pilote-tete", "Claude");
      tete.type = "button";
      tete.title = "Ouvrir / replier — glisser pour déplacer";
      /* Glisser la tête déplace le panneau ; un clic sans glisser l'ouvre. Ancré
         en bas à droite (il grandit vers le haut) : on garde ses deux écarts. */
      let glisse = null;
      tete.addEventListener("pointerdown", e => {
        const r = panneau.getBoundingClientRect ? panneau.getBoundingClientRect() : null;
        if (!r) return;
        glisse = { x: e.clientX, y: e.clientY, dr: r.right - e.clientX, db: r.bottom - e.clientY, bouge: false };
        try { tete.setPointerCapture(e.pointerId); } catch (_) { /* pointeur déjà relâché */ }
      });
      tete.addEventListener("pointermove", e => {
        if (!glisse || (!glisse.bouge && Math.hypot(e.clientX - glisse.x, e.clientY - glisse.y) < 5)) return;
        glisse.bouge = true;
        const f = env.fenetre || {};
        const W = f.innerWidth || 1e4, H = f.innerHeight || 1e4;
        const droite = Math.min(Math.max(0, W - e.clientX - glisse.dr), W - 60);
        const bas = Math.min(Math.max(0, H - e.clientY - glisse.db), H - 30);
        panneau.style.right = droite + "px";
        panneau.style.bottom = bas + "px";
      });
      tete.addEventListener("pointerup", () => {
        if (glisse && glisse.bouge) pref("place", panneau.style.right + " " + panneau.style.bottom);
      });
      tete.addEventListener("click", () => {
        if (glisse && glisse.bouge) { glisse = null; return; }   // fin d'un glisser, pas un clic
        glisse = null;
        const ouvrant = !panneau.classList.contains("ouvert");
        ouvrir(ouvrant);
        if (ouvrant) tester();
      });
      const masquer = el("button", "pilote-masquer", "×");
      masquer.type = "button";
      masquer.title = "Réduire en pastille — un clic sur « Claude » le rouvre";
      masquer.addEventListener("click", () => {
        panneau.classList.remove("ouvert");
        panneau.classList.add("masque");
        pref("masque", "1");
      });
      barre.appendChild(tete);
      barre.appendChild(masquer);
      const place = /^(\d+(?:\.\d+)?px) (\d+(?:\.\d+)?px)$/.exec(pref("place") || "");
      if (place) { panneau.style.right = place[1]; panneau.style.bottom = place[2]; }
      if (pref("masque") === "1") panneau.classList.add("masque");
      liste = el("div", "pilote-liste");
      liste.setAttribute("aria-live", "polite");
      const pied = el("label", "pilote-pied");
      const inter = el("input");
      inter.type = "checkbox";
      inter.checked = false;                          // éteint à chaque chargement (spec, décision 6)
      inter.addEventListener("change", () => { P.interrupteur = !!inter.checked; if (P.relais) battre(false); });
      pied.appendChild(inter);
      pied.appendChild(el("span", "", "Appliquer directement (cet onglet)"));
      const demande = el("div", "pilote-demande");
      saisie = el("textarea", "pilote-saisie");
      saisie.rows = 2;
      saisie.maxLength = MAX_TEXTE;
      saisie.placeholder = "Demander à Claude… (Entrée pour envoyer)";
      saisie.setAttribute("aria-label", "Demande à Claude");
      saisie.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); demander(); }
      });
      // Une image collée devient une pièce jointe ; un texte collé reste du texte
      saisie.addEventListener("paste", e => {
        const f = e.clipboardData && e.clipboardData.files;
        if (f && f.length) { e.preventDefault(); joindre(f); }
      });
      // Déposé sur le panneau, un fichier est pour Claude : la page (qui ouvre ce qu'on lui dépose) ne le voit pas
      ["dragenter", "dragover"].forEach(t => panneau.addEventListener(t, e => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) { e.preventDefault(); e.stopPropagation(); }
      }));
      panneau.addEventListener("drop", e => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          e.preventDefault();
          e.stopPropagation();
          joindre(e.dataTransfer.files);
        }
      });
      puces = el("div", "pilote-pieces");
      const choix = el("input");
      choix.type = "file";
      choix.multiple = true;
      choix.hidden = true;
      choix.addEventListener("change", () => { joindre(choix.files); choix.value = ""; });
      const trombone = bouton("Joindre", () => choix.click());
      trombone.title = "Joindre des fichiers : images, PDF, texte (glisser-déposer et coller marchent aussi)";
      vueBouton = bouton("Vue", joindreVue);
      vueBouton.title = "Joindre l'image de cet onglet";
      vueBouton.hidden = !P.capturer;
      envoi = bouton("Envoyer", demander);
      choixModele = el("select", "pilote-modele");
      choixModele.title = "Modèle de Claude (gardé sur cet appareil)";
      choixModele.setAttribute("aria-label", "Modèle de Claude");
      MODELES.forEach(([valeur, nom]) => { const o = el("option", "", nom); o.value = valeur; choixModele.appendChild(o); });
      choixModele.value = MODELES.some(m => m[0] === pref("modele")) ? pref("modele") : MODELES[0][0];
      choixModele.addEventListener("change", () => pref("modele", choixModele.value));
      etatLigne = el("div", "pilote-etat");
      etatLigne.setAttribute("aria-live", "polite");
      const neuve = bouton("Nouvelle conversation", () => {
        nouvelle = true;
        // Le panneau se vide ; une carte qui attend un clic, ou qu'on peut encore annuler, reste
        const gardees = entrees.filter(n => n.aGarder);
        entrees.filter(n => !n.aGarder).forEach(n => { n.remove(); if (n.idCarte) cartesDom.delete(n.idCarte); });
        entrees.splice(0, entrees.length, ...gardees);
        tracer("Nouvelle conversation : Claude repart de zéro à ta prochaine demande.");
      });
      demande.appendChild(puces);
      demande.appendChild(saisie);
      demande.appendChild(envoi);
      demande.appendChild(trombone);
      demande.appendChild(vueBouton);
      demande.appendChild(choixModele);
      demande.appendChild(choix);
      demande.appendChild(neuve);
      panneau.appendChild(barre);
      panneau.appendChild(etatLigne);
      panneau.appendChild(liste);
      panneau.appendChild(demande);
      panneau.appendChild(pied);
      env.document.body.appendChild(panneau);
      return panneau;
    }

    function ouvrir(oui) {
      if (!construire()) return;
      clearTimeout(minuteurRepli);
      panneau.classList.toggle("ouvert", !!oui);
      // une carte à valider ne reste pas cachée : le panneau masqué revient
      if (oui && panneau.classList.contains("masque")) { panneau.classList.remove("masque"); pref("masque", "0"); }
    }

    function replierPlusTard() {
      if (!panneau) return;
      clearTimeout(minuteurRepli);
      // ni carte qui attend un clic, ni conversation en cours ou demande en train de s'écrire
      const enAttente = [...cartesDom.values()].some(d => d.carte.etat === "proposee") ||
                        enCours || !!(saisie && saisie.value) || pieces.length > 0;
      if (!enAttente) minuteurRepli = setTimeout(() => panneau.classList.remove("ouvert"), 4000);
    }

    function tracer(message) {
      if (!construire()) return;
      garder(liste.appendChild(el("div", "pilote-trace", message)));
    }

    function bouton(libelle, action) {
      const b = el("button", "pilote-bouton", libelle);
      b.type = "button";
      b.addEventListener("click", action);
      return b;
    }

    function dessinerCarte(carte) {
      if (!construire()) return;
      let d = cartesDom.get(carte.id);
      if (!d) {
        d = { carte, noeud: el("div", "pilote-carte") };
        d.noeud.idCarte = carte.id;
        cartesDom.set(carte.id, d);
        garder(liste.appendChild(d.noeud));
      }
      const n = d.noeud;
      n.aGarder = carte.etat === "proposee" || carte.etat === "en_cours" ||
                  (carte.etat === "appliquee" && !!carte.def.annuler);
      n.replaceChildren();
      n.className = "pilote-carte " + carte.etat;
      n.appendChild(el("div", "pilote-titre", texte(carte.prop.titre || carte.nom)));
      // La flèche seulement si l'on a les deux côtés : sinon « … → undefined »
      if (carte.prop.avant !== undefined && carte.prop.apres !== undefined)
        n.appendChild(el("div", "pilote-diff", texte(carte.prop.avant) + " → " + texte(carte.prop.apres)));
      else if (carte.prop.avant !== undefined || carte.prop.apres !== undefined)
        n.appendChild(el("div", "pilote-diff", texte(carte.prop.avant !== undefined ? carte.prop.avant : carte.prop.apres)));
      if (carte.prop.details) n.appendChild(el("div", "pilote-details", texte(carte.prop.details)));
      if (carte.def.irreversible) n.appendChild(el("div", "pilote-aide", carte.def.irreversible));
      if (carte.etat === "en_cours") n.appendChild(el("div", "pilote-aide", "En cours…"));
      if (carte.etat === "proposee") {
        n.appendChild(bouton("Appliquer", () => appliquer(carte, false)));
        n.appendChild(bouton("Refuser", () => refuser(carte)));
      } else if (carte.etat === "appliquee") {
        if (carte.def.annuler) n.appendChild(bouton("Annuler", () => annuler(carte)));
        else if (carte.def.historique) n.appendChild(el("div", "pilote-aide", "Pour défaire : Ctrl+Z dans l'éditeur."));
      }
      if (carte.message) n.appendChild(el("div", "pilote-message", carte.message));
    }

    // -- API de la page ----------------------------------------------------
    let declaration = null;
    P.declarer = function (o) {
      declaration = o;
      P.page = String(o.page || "");
      if (typeof o.projet === "function") P.projet = o.projet;
      if (actif || typeof env.BroadcastChannel !== "function") return P;
      actif = true;
      canal = new env.BroadcastChannel(env.canal || "websuite.pilote.v1");
      canal.onmessage = ev => {
        const m = ev.data || {};
        if (m.t === "present" && m.onglet && m.onglet.id) {
          vus.set(m.onglet.id, { onglet: m.onglet, t: Date.now() });
          if (P.relais) battre(false);      // un clic ailleurs part tout de suite (battre ne renvoie que s'il y a du nouveau)
        }
        else if (m.t === "bye") { vus.delete(m.id); elire(); }
        else if (m.t === "commande" && m.c) { if (m.c.onglet === P.id) recevoir(m.c); }
      };
      annoncer();
      if (env.document && env.document.addEventListener)   // visible ou caché : l'élection en dépend
        env.document.addEventListener("visibilitychange", annoncer);
      // Le bouton « Claude » et l'interrupteur dès le chargement : on doit pouvoir l'allumer avant toute carte
      if (env.document && env.document.body) construire();
      else if (env.document && env.document.addEventListener) env.document.addEventListener("DOMContentLoaded", construire);
      minuteurs.push(setInterval(annoncer, R.annonce));
      // Écouter les autres avant de se croire seul : sinon chaque onglet ouvrirait son long-poll
      minuteurs.push(setTimeout(() => { elire(); minuteurs.push(setInterval(elire, R.annonce)); }, R.amorce));
      minuteurs.push(setInterval(() => { if (P.relais) battre(true); }, R.battement));
      return P;
    };

    P.commande = function (nom, def) {
      if (!NOM.test(nom)) throw new Error("Nom de commande invalide : " + nom);
      if (def.ecriture) {
        // Une écriture = une étape annulable (spec, décision 7)
        // ou, pour ce qui ne se défait pas (un fichier créé), « irreversible » : le message que la carte affiche
        if (!def.historique && typeof def.annuler !== "function" && !(typeof def.irreversible === "string" && def.irreversible))
          throw new Error(nom + " : une écriture déclare « historique », « annuler » ou « irreversible »");
        if (typeof def.annuler === "function" && typeof def.etat !== "function")
          throw new Error(nom + " : « annuler » exige « etat » (on n'annule que si rien n'a bougé)");
        if (typeof def.proposer !== "function" || typeof def.appliquer !== "function")
          throw new Error(nom + " : une écriture déclare « proposer » et « appliquer »");
        /* Le clic n'est pas une barrière (un script de la page peut tout), c'est l'accord de
           l'utilisateur : une écriture appliquée sans sa carte se voit dans le panneau. */
        if (!originaux.has(def)) {
          const original = def.appliquer;
          originaux.set(def, original);
          def.appliquer = function () {
            const m = "« " + nom + " » appliquée sans carte ni clic (console ou script de la page).";
            tracer(m);
            ouvrir(true);
            if (typeof console !== "undefined") console.warn("Pilote : " + m);
            return original.apply(this, arguments);
          };
        }
      } else if (typeof def.executer !== "function") {
        throw new Error(nom + " : « executer » manquant");
      }
      P.commandes[nom] = def;
      return P;
    };

    P.capture = function (fn) { P.capturer = fn; if (vueBouton) vueBouton.hidden = !fn; return P; };
    P.demander = function (texteDemande) { if (construire()) { saisie.value = String(texteDemande); return demander(); } };
    P.replier = function () { ouvrir(false); };
    P.focaliser = function () { P.focus = Date.now(); annoncer(); if (P.relais) battre(false); };

    P.arreter = function () {
      if (!actif) return;
      actif = false;
      if (P.relais && env.balise) {
        // Seul onglet de son navigateur, personne d'autre ne préviendrait le serveur : il garderait
        // l'onglet fermé une minute et lui enverrait des commandes. Une balise part même à la fermeture.
        env.balise("/api/pilote/battement", JSON.stringify({ navigateur: nav, onglets: pourServeur(vivants()) }));
      }
      P.relais = false;
      minuteurs.forEach(m => { clearInterval(m); clearTimeout(m); });
      if (arretPoll) arretPoll.abort();
      try { canal.postMessage({ t: "bye", id: P.id }); canal.close(); } catch (_) { /* déjà fermé */ }
    };

    if (env.fenetre) {
      env.fenetre.addEventListener("focus", P.focaliser);
      env.fenetre.addEventListener("pointerdown", P.focaliser);
      env.fenetre.addEventListener("pagehide", P.arreter);
      // Revenue du cache de navigation (bouton Précédent) : la page reprend le canal
      env.fenetre.addEventListener("pageshow", e => { if (e.persisted && !actif && declaration) P.declarer(declaration); });
    }
    return P;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { creer, touches };
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    let stockage = null;
    try { stockage = window.localStorage; } catch (_) { /* refusé : un relais par onglet */ }
    // Ouverte sans serveur (monofichier en file://), la page n'a pas de canal : Pilote ne démarre pas
    const servie = /^https?:$/.test(window.location.protocol);
    // Posé par la page avant ce script : { "X-WEB_CAO": "1" }, { "X-WEB_ANTENNA": "1" }, { "X-Web3D": "1" }
    const entete = typeof ENTETE_WEB === "object" ? ENTETE_WEB : null;
    // fetch keepalive et non sendBeacon, qui ne peut pas porter l'en-tête maison : il part aussi à la fermeture
    const balise = (url, corps) => window.fetch(url, { method: "POST", keepalive: true, body: corps,
      headers: Object.assign({ "Content-Type": "application/json" }, entete) }).catch(() => {});
    window.Pilote = creer({ fetch: (u, o) => window.fetch(u, o), BroadcastChannel: servie ? window.BroadcastChannel : null,
                            stockage, document, fenetre: window, balise, entete,
                            decoderImage: window.createImageBitmap ? f => window.createImageBitmap(f) : null });
  }
})();
