import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { WorldRoom } from "./rooms/WorldRoom.js";
import { monstersRouter } from "./api/monsters.js";
import { spellsRouter } from "./api/spells.js";
import { mapsRouter } from "./api/maps.js";
import { classesRouter } from "./api/classes.js";

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

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define(WorldRoom.NAME, WorldRoom);

gameServer.listen(port, host).then(() => {
  console.log(`Colyseus + REST API listening on http://${host}:${port}`);
});
