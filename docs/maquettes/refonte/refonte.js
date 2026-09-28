/* Maquette seulement : injecte la navigation et la barre de maquette, applique ?etat=… .
   Rien de ceci n'ira dans l'app. Aucune donnée : les « n » sont des emplacements. */
(function () {
  var p = new URLSearchParams(location.search);
  var etat = p.get("etat") || "normal";
  document.documentElement.setAttribute("data-etat", etat);
  if (p.get("capture")) document.documentElement.setAttribute("data-capture", "1");

  var I = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    book: '<path d="M4 4h11a3 3 0 013 3v13H7a3 3 0 01-3-3z"/><path d="M8 8h6"/>',
    box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'
  };
  var NAV = [
    ["index", "accueil.html", "Accueil", I.home],
    ["recettes", "recettes.html", "Recettes", I.book],
    ["batch", "batch.html", "Batchs", I.box],
    ["assistant", "assistant.html", "Assistant", I.chat],
    ["catalogue", "catalogue.html", "Catalogue", I.compass]
  ];
  var page = document.body.getAttribute("data-page") || "";
  var actif = page === "courses" ? "batch" : page === "accueil" ? "index" : page;
  var nav = '<nav class="nav" aria-label="Navigation principale"><div class="nav-marque">BatchChef</div>';
  NAV.forEach(function (n) {
    nav += '<a href="' + n[1] + location.search + '"' + (n[0] === actif ? ' aria-current="page"' : "") +
      '><svg viewBox="0 0 24 24" aria-hidden="true">' + n[3] + "</svg>" + n[2] + "</a>";
  });
  nav += "</nav>";
  var main = document.querySelector("main");
  var coque = document.createElement("div");
  coque.className = "coque";
  main.parentNode.insertBefore(coque, main);
  coque.insertAdjacentHTML("beforeend", nav);
  coque.appendChild(main);

  var etats = (document.body.getAttribute("data-etats") || "normal,vide,chargement,erreur").split(",");
  var bar = '<div class="maquette"><b>MAQUETTE</b> <span>les « n » sont des emplacements, aucune donnée réelle</span> <span>état :</span>';
  etats.forEach(function (e) {
    var q = new URLSearchParams(location.search); q.set("etat", e);
    bar += ' <a href="?' + q.toString() + '"' + (e === etat ? ' style="font-weight:700"' : "") + ">" + e + "</a>";
  });
  bar += ' <a href="index.html">galerie</a></div>';
  document.body.insertAdjacentHTML("afterbegin", bar);
})();
