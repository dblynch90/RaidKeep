import { Request, Response, NextFunction } from "express";

export interface SessionUser {
  id: number;
  username: string;
  role: string;
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

export function requireLeader(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.session.user.role !== "leader") {
    res.status(403).json({ error: "Guild leader access required" });
    return;
  }
  next();
}
