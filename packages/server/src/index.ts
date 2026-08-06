import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { WorldRoom } from "./rooms/WorldRoom.js";
import { monstersRouter } from "./api/monsters.js";
import { spellsRouter } from "./api/spells.js";
import { mapsRouter } from "./api/maps.js";

const port = Number(process.env.PORT ?? 2567);

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/monsters", monstersRouter);
app.use("/api/spells", spellsRouter);
app.use("/api/maps", mapsRouter);

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define(WorldRoom.NAME, WorldRoom);

gameServer.listen(port).then(() => {
  console.log(`Colyseus + REST API listening on http://localhost:${port}`);
});
