# mmorpg-navigateur

A 2D top-down browser MMORPG. Client renders with [Phaser 3](https://phaser.io/); the server is an authoritative [Colyseus](https://colyseus.io/) room.

## Structure

- `packages/shared` — TypeScript types and Colyseus `Schema` classes shared by client and server
- `packages/server` — Colyseus server (`WorldRoom` holds authoritative player state)
- `packages/client` — Vite + Phaser app

## Getting started

```
npm install
npm run dev
```

This builds `shared`, then starts the Colyseus server (`ws://localhost:2567`) and the Vite dev server (`http://localhost:5173`) together. Open the client URL in two browser tabs to see multiplayer sync — each tab's own player renders green, other players render orange.

## Milestones

See the project plan for the full roadmap. Current status: **M0 (scaffolding) and the M2 movement-sync proof (two clients, one authoritative room) are working.** Next up: M1-style real tilemap/collision, then persistence (M3).
