import Phaser from "phaser";
import { WorldScene } from "./scenes/WorldScene.js";
import { Sidebar } from "./ui/Sidebar.js";
import { fetchClasses, login, register, fetchMe, fetchCharacters, createCharacter } from "./net/api.js";
import { getToken, setToken, clearToken } from "./net/auth.js";
import { MAX_CHARACTERS_PER_ACCOUNT, type CharacterDTO } from "shared";

new Sidebar();

// Fixed regardless of the active map's actual size — the camera (see
// WorldScene) follows the player and clamps to the map's bounds, so the
// viewport doesn't need to match the map's dimensions.
const VIEWPORT_WIDTH = 1000;
const VIEWPORT_HEIGHT = 700;

const loginOverlay = document.querySelector<HTMLDivElement>("#login-overlay")!;
const loginForm = document.querySelector<HTMLFormElement>("#login-form")!;
const usernameInput = document.querySelector<HTMLInputElement>("#username-input")!;
const passwordInput = document.querySelector<HTMLInputElement>("#password-input")!;
const loginError = document.querySelector<HTMLParagraphElement>("#login-error")!;
const loginSubmit = document.querySelector<HTMLButtonElement>("#login-submit")!;
const loginModeToggle = document.querySelector<HTMLButtonElement>("#login-mode-toggle")!;

const characterOverlay = document.querySelector<HTMLDivElement>("#character-overlay")!;
const characterSelectPanel = document.querySelector<HTMLDivElement>("#character-select-panel")!;
const characterList = document.querySelector<HTMLUListElement>("#character-list")!;
const characterListEmpty = document.querySelector<HTMLParagraphElement>("#character-list-empty")!;
const characterSelectError = document.querySelector<HTMLParagraphElement>("#character-select-error")!;
const characterCreateToggle = document.querySelector<HTMLButtonElement>("#character-create-toggle")!;

const characterForm = document.querySelector<HTMLFormElement>("#character-form")!;
const characterNameInput = document.querySelector<HTMLInputElement>("#character-name-input")!;
const classSelect = document.querySelector<HTMLSelectElement>("#class-select")!;
const characterFormError = document.querySelector<HTMLParagraphElement>("#character-form-error")!;
const characterCreateCancel = document.querySelector<HTMLButtonElement>("#character-create-cancel")!;

const loadingOverlay = document.querySelector<HTMLDivElement>("#loading-overlay")!;
const loadingError = document.querySelector<HTMLParagraphElement>("#loading-error")!;

let mode: "login" | "register" = "login";

function applyMode() {
  loginSubmit.textContent = mode === "register" ? "Create account" : "Log in";
  loginModeToggle.textContent = mode === "register" ? "Already registered? Log in" : "New player? Create an account";
  loginError.textContent = "";
}

loginModeToggle.addEventListener("click", () => {
  mode = mode === "login" ? "register" : "login";
  applyMode();
});

let classesLoaded: Promise<void> | undefined;
function ensureClassesLoaded() {
  if (!classesLoaded) {
    classesLoaded = fetchClasses()
      .then((classes) => {
        for (const cls of classes) {
          const option = document.createElement("option");
          option.value = cls.name;
          option.textContent = cls.name;
          classSelect.appendChild(option);
        }
      })
      .catch((err) => console.error("Failed to load classes for character creation:", err));
  }
  return classesLoaded;
}

function startGame(token: string, characterId: string) {
  loginOverlay.remove();
  characterOverlay.remove();

  loadingError.textContent = "";
  loadingOverlay.style.display = "flex";

  // WorldScene dispatches these once it either finishes connecting and the
  // local player spawns, or fails (bad token, fetch/room-join error) — see
  // WorldScene.create()/buildWorld().
  window.addEventListener("world-ready", () => loadingOverlay.remove(), { once: true });
  window.addEventListener(
    "world-error",
    ((event: CustomEvent<string>) => {
      loadingError.textContent = event.detail || "Failed to load world.";
    }) as EventListener,
    { once: true },
  );

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    parent: "app",
    backgroundColor: "#222222",
    disableContextMenu: true,
  });

  game.scene.add("world", WorldScene, true, { token, characterId });
}

function renderCharacterList(token: string, characters: CharacterDTO[]) {
  characterList.innerHTML = "";
  characterListEmpty.style.display = characters.length === 0 ? "" : "none";
  characterCreateCancel.style.display = characters.length === 0 ? "none" : "";
  characterCreateToggle.style.display = characters.length >= MAX_CHARACTERS_PER_ACCOUNT ? "none" : "";

  for (const character of characters) {
    const li = document.createElement("li");
    li.innerHTML = `
      <span>
        <span class="character-name">${character.name}</span>
        <span class="character-class"> — ${character.className ?? "no class"}</span>
      </span>
    `;
    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.textContent = "Play";
    playButton.addEventListener("click", () => startGame(token, character.id));
    li.appendChild(playButton);
    characterList.appendChild(li);
  }
}

function showCharacterCreateForm() {
  characterSelectPanel.style.display = "none";
  characterForm.style.display = "flex";
  characterFormError.textContent = "";
  void ensureClassesLoaded();
}

function showCharacterSelectPanel() {
  characterForm.style.display = "none";
  characterSelectPanel.style.display = "flex";
}

async function proceedAfterAuth(token: string) {
  loginOverlay.style.display = "none";
  characterOverlay.style.display = "flex";
  characterSelectError.textContent = "";

  try {
    const characters = await fetchCharacters(token);
    renderCharacterList(token, characters);
    if (characters.length === 0) {
      showCharacterCreateForm();
    } else {
      showCharacterSelectPanel();
    }
  } catch (err) {
    characterSelectError.textContent = err instanceof Error ? err.message : "Failed to load characters.";
  }
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) return;

  loginError.textContent = "";
  loginSubmit.disabled = true;

  const request = mode === "register" ? register(username, password) : login(username, password);

  request
    .then(({ token }) => {
      setToken(token);
      return proceedAfterAuth(token);
    })
    .catch((err: unknown) => {
      loginError.textContent = err instanceof Error ? err.message : "Login failed.";
    })
    .finally(() => {
      loginSubmit.disabled = false;
    });
});

characterCreateToggle.addEventListener("click", showCharacterCreateForm);
characterCreateCancel.addEventListener("click", showCharacterSelectPanel);

characterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const token = getToken();
  if (!token) return;
  const name = characterNameInput.value.trim();
  if (!name) return;

  characterFormError.textContent = "";

  createCharacter(token, name, classSelect.value)
    .then((character) => startGame(token, character.id))
    .catch((err: unknown) => {
      characterFormError.textContent = err instanceof Error ? err.message : "Failed to create character.";
    });
});

applyMode();

const existingToken = getToken();
if (existingToken) {
  fetchMe(existingToken)
    .then((account) => {
      if (account) {
        void proceedAfterAuth(existingToken);
      } else {
        clearToken();
      }
    })
    .catch(() => clearToken());
}
