import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const configuredToken = process.env.ADMIN_TOKEN;

// Fails closed rather than open: without an explicit ADMIN_TOKEN, generate a
// random one for this process so local dev still works, but it changes every
// restart. Set ADMIN_TOKEN in packages/server/.env for a stable login.
export const ADMIN_TOKEN = configuredToken || crypto.randomUUID();

if (!configuredToken) {
  console.warn(
    "\n⚠️  ADMIN_TOKEN not set — generated a random token for this session:\n" +
      `   ${ADMIN_TOKEN}\n` +
      "   Use this to log into the admin panel. Set ADMIN_TOKEN in packages/server/.env\n" +
      "   to keep it stable across restarts.\n",
  );
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (token !== ADMIN_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
