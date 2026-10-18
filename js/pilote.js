/* Canal de pilotage, côté page : le MCP de web_suite agit dans les onglets ouverts.

   COPIE IDENTIQUE dans WEB_CAO, WEB_ANTENNA et WEB_3D ; l'original est
   web_suite/lanceur/pilote.js et la CI de web_suite vérifie les copies.
   Spec : web_suite/lanceur/docs/SPEC-mcp-canal-pilote.md. Banc : lanceur/banc_pilote.js.

   Usage dans une page :
       Pilote.declarer({page: "pcb", projet: () => nomDuProjet});
       Pilote.capture(() => canevas);
       Pilote.commande("cao_calcul", {executer: async args => rapport});
       Pilote.commande("cao_valeur_composant", {ecriture: true, historique: true,
                                                proposer: args => ({...}), appliquer: args => {...}});

   UN SEUL ONGLET RELAIS PAR NAVIGATEUR : les onglets d'un même outil s'annoncent
   sur un BroadcastChannel ; le plus petit id parmi ceux entendus récemment tient
   seul le long-poll (le navigateur limite les connexions par origine) et
   transmet les commandes aux autres. Pas de navigator.locks : il n'existe pas en
   HTTP sur une adresse du réseau local, ce qu'ouvre l'iPad. */
(function () {
  "use strict";

  const CLE_NAVIGATEUR = "websuite.pilote.navigateur";
  const LARGEUR_MAX = 1600;
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

  function creer(env, reglages) {
    const R = Object.assign({ annonce: 2000, silence: 5000, battement: 20000, repos: 2000 }, reglages || {});
    const P = {
      id: nouvelId(), relais: false, _env: env,
      page: "", projet: () => "", focus: Date.now(), interrupteur: false,
      commandes: {}, capturer: null,
    };
    let canal = null, actif = false, minuteurs = [], arretPoll = null, dernierEnvoi = "";
    const vus = new Map();          // id d'onglet -> {onglet, t}
    const traitees = new Set();     // ids de commandes déjà reçues : une redistribution ne rejoue rien
    const nav = idNavigateur(env.stockage, P.id);

    function vue() {
      let projet = "";
      try { projet = String(P.projet() || ""); } catch (_) { /* projet illisible : vide */ }
      return { id: P.id, page: P.page, projet: projet.slice(0, 200),
               focus_il_y_a: Math.max(0, Date.now() - P.focus), interrupteur: P.interrupteur };
    }

    function vivants() {
      const limite = Date.now() - R.silence;
      return [...vus.values()].filter(v => v.t > limite).map(v => v.onglet);
    }

    async function envoyer(route, corps) {
      const r = await env.fetch("/api/pilote/" + route, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
      if (!r.ok) throw new Error("pilote : " + route + " a répondu " + r.status);
    }

    function repondre(id, etat, resultat) {
      envoyer("reponse", { id, etat, resultat: resultat === undefined ? null : resultat })
        .catch(e => console.warn(e.message));
    }

    // -- relais : battement et long-poll ------------------------------------
    function battre(force) {
      const onglets = [vue()].concat(vivants());
      const cle = onglets.map(o => o.id + o.page + o.projet + o.interrupteur).sort().join("|");
      if (!force && cle === dernierEnvoi) return;
      dernierEnvoi = cle;
      envoyer("battement", { navigateur: nav, onglets }).catch(e => console.warn(e.message));
    }

    async function boucle() {
      while (actif && P.relais) {
        const ctl = typeof AbortController === "function" ? new AbortController() : null;
        arretPoll = ctl;
        try {
          const r = await env.fetch("/api/pilote/attendre?navigateur=" + nav, ctl ? { signal: ctl.signal } : {});
          if (!r.ok) throw new Error("pilote : attendre a répondu " + r.status);
          const d = await r.json();
          (d.commandes || []).forEach(livrer);
        } catch (_) {
          if (actif && P.relais) await new Promise(f => setTimeout(f, R.repos));   // serveur arrêté : on réessaie
        }
      }
    }

    function elire() {
      const ids = [P.id].concat(vivants().map(o => o.id)).sort();
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
    function recevoir(c) {
      if (traitees.has(c.id)) return;
      traitees.add(c.id);
      repondre(c.id, "recue");
      executer(c);
    }

    async function executer(c) {
      const args = c.args || {};
      try {
        if (c.nom === "capture") return repondre(c.id, "finie", capturer());
        const def = P.commandes[c.nom];
        if (!def) throw new Error("Commande « " + c.nom + " » inconnue de cette page (" + P.page + ").");
        if (def.ecriture) return ecrire(c, def, args);
        tracer("Claude a lancé : " + c.nom);
        repondre(c.id, "finie", await def.executer(args));
      } catch (e) {
        repondre(c.id, "echouee", String((e && e.message) || e));
      }
    }

    function capturer() {
      if (!P.capturer) throw new Error("Cette page n'a pas de canevas à capturer.");
      let toile = P.capturer();
      if (toile.width > LARGEUR_MAX) {
        const k = LARGEUR_MAX / toile.width;
        const petite = env.document.createElement("canvas");
        petite.width = LARGEUR_MAX;
        petite.height = Math.max(1, Math.round(toile.height * k));
        petite.getContext("2d").drawImage(toile, 0, 0, petite.width, petite.height);
        toile = petite;
      }
      return { image: toile.toDataURL("image/png"), largeur: toile.width, hauteur: toile.height };
    }

    // -- écritures : carte, interrupteur, annulation ------------------------
    function texte(v) { return typeof v === "string" ? v : JSON.stringify(v); }

    function ecrire(c, def, args) {
      const prop = def.proposer(args) || {};          // une exception remonte en « echouee »
      const carte = { id: c.id, nom: c.nom, def, args, prop, etat: "proposee", jeton: undefined, apres: null };
      if (P.interrupteur) {
        appliquer(carte, true);
      } else {
        dessinerCarte(carte);
        ouvrir(true);
        repondre(c.id, "proposee");
      }
    }

    function appliquer(carte, direct) {
      try {
        carte.jeton = carte.def.appliquer(carte.args);
        if (carte.def.etat) carte.apres = texte(carte.def.etat());   // instantané : l'Annuler compare
        carte.etat = "appliquee";
        repondre(carte.id, "appliquee", { titre: texte(carte.prop.titre || carte.nom), avant: carte.prop.avant,
                                          apres: carte.prop.apres, direct: !!direct });
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
      repondre(carte.id, "refusee");
      dessinerCarte(carte);
      replierPlusTard();
    }

    function annuler(carte) {
      // Seulement si rien n'a bougé depuis : sinon on écraserait le travail fait entre-temps
      if (texte(carte.def.etat()) !== carte.apres) {
        carte.message = "L'état a changé depuis : annuler écraserait tes modifications. Défais à la main " +
                        "(ou Ctrl+Z si l'éditeur en a un).";
      } else {
        try { carte.def.annuler(carte.args, carte.jeton); carte.etat = "annulee"; carte.message = "Annulée."; }
        catch (e) { carte.message = "Annulation impossible : " + ((e && e.message) || e); }
      }
      dessinerCarte(carte);
    }

    // -- panneau « Claude » (texte par textContent seulement : jamais d'innerHTML) --
    let panneau = null, liste = null, minuteurRepli = null;
    const cartesDom = new Map();

    function el(tag, classe, contenu) {
      const e = env.document.createElement(tag);
      if (classe) e.className = classe;
      if (contenu !== undefined) e.textContent = contenu;
      return e;
    }

    function construire() {
      if (panneau || !env.document || !env.document.body) return panneau;
      panneau = el("aside", "pilote");
      const tete = el("button", "pilote-tete", "Claude");
      tete.type = "button";
      tete.addEventListener("click", () => ouvrir(!panneau.classList.contains("ouvert")));
      liste = el("div", "pilote-liste");
      const pied = el("label", "pilote-pied");
      const inter = el("input");
      inter.type = "checkbox";
      inter.checked = false;                          // éteint à chaque chargement (spec, décision 6)
      inter.addEventListener("change", () => { P.interrupteur = !!inter.checked; if (P.relais) battre(false); });
      pied.appendChild(inter);
      pied.appendChild(el("span", "", "Appliquer directement (cet onglet)"));
      panneau.appendChild(tete);
      panneau.appendChild(liste);
      panneau.appendChild(pied);
      env.document.body.appendChild(panneau);
      return panneau;
    }

    function ouvrir(oui) {
      if (!construire()) return;
      clearTimeout(minuteurRepli);
      panneau.classList.toggle("ouvert", !!oui);
    }

    function replierPlusTard() {
      if (!panneau) return;
      clearTimeout(minuteurRepli);
      const enAttente = [...cartesDom.values()].some(d => d.carte.etat === "proposee");
      if (!enAttente) minuteurRepli = setTimeout(() => panneau.classList.remove("ouvert"), 4000);
    }

    function tracer(message) {
      if (!construire()) return;
      liste.appendChild(el("div", "pilote-trace", message));
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
      if (!d) { d = { carte, noeud: el("div", "pilote-carte") }; cartesDom.set(carte.id, d); liste.appendChild(d.noeud); }
      const n = d.noeud;
      n.replaceChildren();
      n.className = "pilote-carte " + carte.etat;
      n.appendChild(el("div", "pilote-titre", texte(carte.prop.titre || carte.nom)));
      if (carte.prop.avant !== undefined || carte.prop.apres !== undefined)
        n.appendChild(el("div", "pilote-diff", texte(carte.prop.avant) + " → " + texte(carte.prop.apres)));
      if (carte.prop.details) n.appendChild(el("div", "pilote-details", texte(carte.prop.details)));
      if (carte.etat === "proposee") {
        n.appendChild(bouton("Appliquer", () => appliquer(carte, false)));
        n.appendChild(bouton("Refuser", () => refuser(carte)));
      } else if (carte.etat === "appliquee") {
        if (carte.def.annuler) n.appendChild(bouton("Annuler", () => annuler(carte)));
        else n.appendChild(el("div", "pilote-aide", "Pour défaire : Ctrl+Z dans l'éditeur."));
      }
      if (carte.message) n.appendChild(el("div", "pilote-message", carte.message));
    }

    // -- API de la page ----------------------------------------------------
    P.declarer = function (o) {
      P.page = String(o.page || "");
      if (typeof o.projet === "function") P.projet = o.projet;
      if (actif || typeof env.BroadcastChannel !== "function") return P;
      actif = true;
      canal = new env.BroadcastChannel(env.canal || "websuite.pilote.v1");
      canal.onmessage = ev => {
        const m = ev.data || {};
        if (m.t === "present" && m.onglet && m.onglet.id) vus.set(m.onglet.id, { onglet: m.onglet, t: Date.now() });
        else if (m.t === "bye") { vus.delete(m.id); elire(); }
        else if (m.t === "commande" && m.c) { if (m.c.onglet === P.id) recevoir(m.c); }
      };
      const annoncer = () => canal.postMessage({ t: "present", onglet: vue() });
      annoncer();
      minuteurs.push(setInterval(annoncer, R.annonce));
      // Écouter les autres avant de se croire seul : sinon chaque onglet ouvrirait son long-poll
      minuteurs.push(setTimeout(() => { elire(); minuteurs.push(setInterval(elire, R.annonce)); }, R.silence));
      minuteurs.push(setInterval(() => { if (P.relais) battre(true); }, R.battement));
      return P;
    };

    P.commande = function (nom, def) {
      if (!NOM.test(nom)) throw new Error("Nom de commande invalide : " + nom);
      if (def.ecriture) {
        // Une écriture = une étape annulable (spec, décision 7)
        if (!def.historique && typeof def.annuler !== "function")
          throw new Error(nom + " : une écriture déclare « historique » ou « annuler »");
        if (typeof def.annuler === "function" && typeof def.etat !== "function")
          throw new Error(nom + " : « annuler » exige « etat » (on n'annule que si rien n'a bougé)");
        if (typeof def.proposer !== "function" || typeof def.appliquer !== "function")
          throw new Error(nom + " : une écriture déclare « proposer » et « appliquer »");
      } else if (typeof def.executer !== "function") {
        throw new Error(nom + " : « executer » manquant");
      }
      P.commandes[nom] = def;
      return P;
    };

    P.capture = function (fn) { P.capturer = fn; return P; };
    P.replier = function () { ouvrir(false); };
    P.focaliser = function () { P.focus = Date.now(); if (P.relais) battre(false); };

    P.arreter = function () {
      if (!actif) return;
      actif = false;
      if (P.relais && env.balise) {
        // Seul onglet de son navigateur, personne d'autre ne préviendrait le serveur : il garderait
        // l'onglet fermé une minute et lui enverrait des commandes. Une balise part même à la fermeture.
        env.balise("/api/pilote/battement", JSON.stringify({ navigateur: nav, onglets: vivants() }));
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
    }
    return P;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { creer };
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    let stockage = null;
    try { stockage = window.localStorage; } catch (_) { /* refusé : un relais par onglet */ }
    // Ouverte sans serveur (monofichier en file://), la page n'a pas de canal : Pilote ne démarre pas
    const servie = /^https?:$/.test(window.location.protocol);
    const balise = (url, corps) => navigator.sendBeacon(url, new Blob([corps], { type: "application/json" }));
    window.Pilote = creer({ fetch: (u, o) => window.fetch(u, o), BroadcastChannel: servie ? window.BroadcastChannel : null,
                            stockage, document, fenetre: window, balise: navigator.sendBeacon ? balise : null });
  }
})();
