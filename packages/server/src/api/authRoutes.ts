import { Router } from "express";
import { hash, verify } from "@node-rs/argon2";
import type { AccountDTO } from "shared";
import { prisma } from "../db.js";
import { asyncRoute } from "./errors.js";
import { requireAuth } from "./adminAuth.js";
import { signToken } from "../auth/jwt.js";

export const authRouter = Router();

function accountDTO(account: { id: string; username: string; role: "player" | "admin" }): AccountDTO {
  return { id: account.id, username: account.username, role: account.role };
}

authRouter.post(
  "/register",
  asyncRoute(async (req, res) => {
    const { username, password } = req.body as { username?: string; password?: string };

    const trimmedUsername = username?.trim() ?? "";
    if (trimmedUsername.length < 3 || trimmedUsername.length > 24) {
      res.status(400).json({ error: "Username must be 3-24 characters." });
      return;
    }
    if (!password || password.length < 8 || password.length > 128) {
      res.status(400).json({ error: "Password must be 8-128 characters." });
      return;
    }

    const passwordHash = await hash(password);

    let account;
    try {
      account = await prisma.account.create({ data: { username: trimmedUsername, passwordHash } });
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
        res.status(409).json({ error: "Username already taken." });
        return;
      }
      throw err;
    }

    const token = signToken({ sub: account.id, username: account.username, role: account.role });
    res.status(201).json({ token, account: accountDTO(account) });
  }),
);

authRouter.post(
  "/login",
  asyncRoute(async (req, res) => {
    const { username, password } = req.body as { username?: string; password?: string };

    const account = username ? await prisma.account.findUnique({ where: { username } }) : null;

    const valid = account && password ? await verify(account.passwordHash, password) : false;
    if (!account || !valid) {
      res.status(401).json({ error: "Invalid username or password." });
      return;
    }

    const token = signToken({ sub: account.id, username: account.username, role: account.role });
    res.json({ token, account: accountDTO(account) });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncRoute(async (req, res) => {
    const account = await prisma.account.findUnique({ where: { id: req.account!.sub } });
    if (!account) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json(accountDTO(account));
  }),
);
