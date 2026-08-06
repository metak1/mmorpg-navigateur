import { renderMonstersPage } from "./pages/monsters.js";
import { renderSpellsPage } from "./pages/spells.js";
import { renderMapsPage } from "./pages/maps.js";

const content = document.querySelector<HTMLElement>("#content")!;
const links = document.querySelectorAll<HTMLAnchorElement>("#sidebar a");

const routes: Record<string, (container: HTMLElement) => void | Promise<void>> = {
  monsters: renderMonstersPage,
  spells: renderSpellsPage,
  maps: renderMapsPage,
};

function render() {
  const tab = location.hash.replace("#", "") || "monsters";
  links.forEach((link) => link.classList.toggle("active", link.dataset.tab === tab));
  content.innerHTML = "";
  void (routes[tab] ?? routes.monsters)(content);
}

window.addEventListener("hashchange", render);
render();
