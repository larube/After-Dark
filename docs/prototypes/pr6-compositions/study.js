const moods = ["Surprends-moi", "Suspense et tension", "Étrange / dérangeant", "Envie de rire", "Émotion", "Immersif"];
const art = ["surprise", "tension", "strange", "laugh", "emotion", "immersion"];
document.querySelector(".moods").insertAdjacentHTML("beforeend", moods.map((label, i) => `<label><input type="radio" name="mood" ${i === 1 ? "checked" : ""}><img alt="" src="../../../src/renderer/art/mood-${art[i]}.webp"><b>${label}</b></label>`).join(""));
const films = [
  ["Les heures sombres", "Valeur sûre", "France · 112 min", "Une enquêtrice revient dans une petite ville portuaire à la recherche d’un témoin disparu.", "tension"],
  ["La Chambre rouge", "Pépite", "Espagne · 98 min", "Une nuit de garde fait remonter les secrets d’un hôtel fermé.", "emotion"],
  ["Au bord du jour", "Wildcard", "Japon · 104 min", "Deux inconnus suivent les traces d’un train disparu.", "immersion"],
  ["La Traversée", "Valeur sûre", "Italie · 106 min", "Un retour sur l’île natale change une vieille amitié.", "strange"],
  ["La Dernière Bobine", "Pépite", "France · 92 min", "Un projectionniste découvre une bobine sans étiquette.", ""],
];
document.body.classList.add(new URLSearchParams(location.search).get("layout") === "b" ? "variant-b" : "variant-a");
document.querySelector(".films").innerHTML = films.map(([title, role, meta, synopsis, still], i) => `<article class="${i ? "secondary" : "featured"}">
  <figure>${still ? `<img alt="" src="../../../src/renderer/art/mood-${still}.webp">` : "<span>Affiche indisponible</span>"}</figure>
  <div class="copy"><span class="role" data-role="${role}">${role}</span><h3>${title}</h3><p class="meta">${meta}</p><p>${synopsis}</p>
  <details ${i ? "" : "open"}><summary>Pourquoi ce film ?</summary><p>Raison illustrative · suspense dans les métadonnées.</p></details>
  <details><summary>Actions</summary><p>À voir un jour · Pour ce soir · Déjà vu · Pas intéressé</p></details></div>
</article>`).join("");
document.querySelector("form").addEventListener("submit", event => {
  event.preventDefault();
  document.querySelector(".section").scrollIntoView();
});
