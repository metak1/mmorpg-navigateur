import http from "node:http";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { WorldRoom } from "./rooms/WorldRoom.js";
import { monstersRouter } from "./api/monsters.js";
import { spellsRouter } from "./api/spells.js";
import { mapsRouter } from "./api/maps.js";
import { classesRouter } from "./api/classes.js";
import { authRouter } from "./api/authRoutes.js";
import { charactersRouter } from "./api/characters.js";
import { npcsRouter } from "./api/npcs.js";
import { itemsRouter } from "./api/items.js";
import { questsRouter } from "./api/quests.js";
import { talentsRouter } from "./api/talents.js";

const port = Number(process.env.PORT ?? 2567);
// Bind all interfaces in production (most hosts route traffic to the
// container/VM via a non-loopback address) — localhost-only is fine for dev.
const host = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "localhost");

// Comma-separated list of allowed origins for production (e.g. the deployed
// client/admin URLs). Left unset, cors() defaults to allowing any origin,
// which is fine for local dev but should be locked down once this is public.
const corsOrigin = process.env.CORS_ORIGIN?.split(",").map((origin) => origin.trim());

const app = express();
app.use(cors(corsOrigin ? { origin: corsOrigin } : undefined));
app.use(express.json());
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/monsters", monstersRouter);
app.use("/api/spells", spellsRouter);
app.use("/api/maps", mapsRouter);
app.use("/api/classes", classesRouter);
app.use("/api/auth", authRouter);
app.use("/api/characters", charactersRouter);
app.use("/api/npcs", npcsRouter);
app.use("/api/items", itemsRouter);
app.use("/api/quests", questsRouter);
app.use("/api/talents", talentsRouter);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// Last-resort handler: logs the real error server-side but never forwards
// message/stack to the client (Express's default HTML error page used to
// leak internal file paths for anything asyncRoute didn't special-case).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define(WorldRoom.NAME, WorldRoom);

gameServer.listen(port, host).then(() => {
  console.log(`Colyseus + REST API listening on http://${host}:${port}`);
});
