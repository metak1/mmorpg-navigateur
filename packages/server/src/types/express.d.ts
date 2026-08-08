import type { AuthPayload } from "../auth/jwt.js";

declare global {
  namespace Express {
    interface Request {
      account?: AuthPayload;
    }
  }
}

export {};
