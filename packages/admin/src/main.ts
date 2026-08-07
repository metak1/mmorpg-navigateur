import { renderClassesPage } from "./pages/classes.js";
import { renderMonstersPage } from "./pages/monsters.js";
import { renderSpellsPage } from "./pages/spells.js";
import { renderMapsPage } from "./pages/maps.js";
import { getToken, setToken, clearToken } from "./auth.js";

const app = document.querySelector<HTMLElement>("#app")!;
const content = document.querySelector<HTMLElement>("#content")!;
const links = document.querySelectorAll<HTMLAnchorElement>("#sidebar a");
const logoutLink = document.querySelector<HTMLAnchorElement>("#logout-link")!;

const routes: Record<string, (container: HTMLElement) => void | Promise<void>> = {
  classes: renderClassesPage,
  monsters: renderMonstersPage,
  spells: renderSpellsPage,
  maps: renderMapsPage,
};

function renderLogin() {
  app.style.display = "none";

  let overlay = document.querySelector<HTMLDivElement>("#login-overlay");
  if (overlay) return;

  overlay = document.createElement("div");
  overlay.id = "login-overlay";
  overlay.innerHTML = `
    <form id="admin-login-form">
      <h1>Admin Login</h1>
      <input id="admin-token-input" type="password" placeholder="Admin token" autocomplete="off" required />
      <button type="submit">Enter</button>
    </form>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector<HTMLFormElement>("#admin-login-form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = overlay!.querySelector<HTMLInputElement>("#admin-token-input")!;
    const token = input.value.trim();
    if (!token) return;
    setToken(token);
    overlay!.remove();
    app.style.display = "";
    render();
  });
}

function render() {
  if (!getToken()) {
    renderLogin();
    return;
  }
  const tab = location.hash.replace("#", "") || "classes";
  links.forEach((link) => link.classList.toggle("active", link.dataset.tab === tab));
  content.innerHTML = "";
  void (routes[tab] ?? routes.classes)(content);
}

logoutLink.addEventListener("click", (event) => {
  event.preventDefault();
  clearToken();
  render();
});

window.addEventListener("hashchange", render);
window.addEventListener("admin-unauthorized", render);
render();
