import type { Request, Response, NextFunction } from "express";

type Handler = (req: Request, res: Response) => Promise<void>;

// Wraps an async Express handler so a thrown/rejected error becomes a JSON
// error response instead of an unhandled rejection. Prisma's unique-
// constraint violation (P2002) becomes a 400 with a readable message, since
// that's the one failure mode admin forms can actually trigger (duplicate
// spell keybind, etc); anything else is a 500.
export function asyncRoute(handler: Handler) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch((err: unknown) => {
      if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
        res.status(400).json({ error: "A record with that unique value already exists." });
        return;
      }
      next(err);
    });
  };
}
