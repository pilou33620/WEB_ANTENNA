/* Repli de la barre d'outils du haut, comme le ruban de WEB_CAO : replié, il ne
   reste que le titre (et, dans WEB_ANTENNA, la progression et Stop d'une
   simulation) ; la vue prend la place. Mémorisé par appareil. */
(function(){
  const barre = document.querySelector("body>header");
  if(!barre) return;
  const b = document.createElement("button");
  b.type = "button"; b.className = "barre-pli";
  barre.appendChild(b);
  function plier(replie, memoriser){
    document.body.classList.toggle("barre-repliee", replie);
    b.textContent = replie ? "▾" : "▴";
    b.title = replie ? "Déplier la barre d'outils" : "Replier la barre d'outils : plus de place pour la vue";
    b.setAttribute("aria-expanded", String(!replie));
    if(memoriser) try{ localStorage.setItem("barre.repliee", replie ? "1" : "0"); }catch(_){}
  }
  let lu = null;
  try{ lu = localStorage.getItem("barre.repliee"); }catch(_){}
  plier(lu === "1", false);
  b.addEventListener("click", function(){ plier(!document.body.classList.contains("barre-repliee"), true); });
})();
