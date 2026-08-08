import { renderClassesPage } from "./pages/classes.js";
import { renderMonstersPage } from "./pages/monsters.js";
import { renderSpellsPage } from "./pages/spells.js";
import { renderMapsPage } from "./pages/maps.js";
import { renderNpcsPage } from "./pages/npcs.js";
import { renderItemsPage } from "./pages/items.js";
import { renderQuestsPage } from "./pages/quests.js";
import { getToken, setToken, clearToken } from "./auth.js";
import { login, api } from "./api.js";

const app = document.querySelector<HTMLElement>("#app")!;
const content = document.querySelector<HTMLElement>("#content")!;
const links = document.querySelectorAll<HTMLAnchorElement>("#sidebar a");
const logoutLink = document.querySelector<HTMLAnchorElement>("#logout-link")!;

const routes: Record<string, (container: HTMLElement) => void | Promise<void>> = {
  classes: renderClassesPage,
  monsters: renderMonstersPage,
  spells: renderSpellsPage,
  maps: renderMapsPage,
  npcs: renderNpcsPage,
  items: renderItemsPage,
  quests: renderQuestsPage,
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
      <input id="admin-username-input" type="text" placeholder="Username" autocomplete="username" required />
      <input id="admin-password-input" type="password" placeholder="Password" autocomplete="current-password" required />
      <p id="admin-login-error"></p>
      <button type="submit">Enter</button>
    </form>
  `;
  document.body.appendChild(overlay);

  const errorEl = overlay.querySelector<HTMLParagraphElement>("#admin-login-error")!;
  const submitBtn = overlay.querySelector<HTMLButtonElement>("button[type=submit]")!;

  overlay.querySelector<HTMLFormElement>("#admin-login-form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = overlay!.querySelector<HTMLInputElement>("#admin-username-input")!.value.trim();
    const password = overlay!.querySelector<HTMLInputElement>("#admin-password-input")!.value;
    if (!username || !password) return;

    errorEl.textContent = "";
    submitBtn.disabled = true;

    login(username, password)
      .then(({ token, account }) => {
        if (account.role !== "admin") {
          errorEl.textContent = "This account does not have admin access.";
          return;
        }
        setToken(token);
        overlay!.remove();
        app.style.display = "";
        render();
      })
      .catch((err: unknown) => {
        errorEl.textContent = err instanceof Error ? err.message : "Login failed.";
      })
      .finally(() => {
        submitBtn.disabled = false;
      });
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

const existingToken = getToken();
if (existingToken) {
  api
    .me()
    .then(() => render())
    .catch(() => {
      clearToken();
      render();
    });
} else {
  render();
}
