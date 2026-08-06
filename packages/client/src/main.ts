import Phaser from "phaser";
import { WorldScene } from "./scenes/WorldScene.js";

// Fixed regardless of the active map's actual size — the camera (see
// WorldScene) follows the player and clamps to the map's bounds, so the
// viewport doesn't need to match the map's dimensions.
const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 600;

const loginOverlay = document.querySelector<HTMLDivElement>("#login-overlay")!;
const loginForm = document.querySelector<HTMLFormElement>("#login-form")!;
const usernameInput = document.querySelector<HTMLInputElement>("#username-input")!;

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const username = usernameInput.value.trim();
  if (!username) return;

  loginOverlay.remove();

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    parent: "app",
    backgroundColor: "#222222",
  });

  game.scene.add("world", WorldScene, true, { username });
});
