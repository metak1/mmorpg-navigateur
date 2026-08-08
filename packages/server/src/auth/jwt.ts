import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";

function requireSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not set. Add it to packages/server/.env — it must stay stable across restarts.",
    );
  }
  return secret;
}

const secret = requireSecret();

export interface AuthPayload {
  sub: string;
  username: string;
  role: Role;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, secret, { expiresIn: "30d" });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, secret) as unknown as AuthPayload;
  } catch {
    return null;
  }
}
