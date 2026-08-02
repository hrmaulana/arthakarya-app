// Role & Unit Kerja Authorization Middleware
import { Request, Response, NextFunction } from "express";

/**
 * Require a specific role (or higher).
 * Admin can do everything; operator is scoped to their unit_kerja.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Autentikasi diperlukan." });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Anda tidak memiliki izin untuk aksi ini." });
      return;
    }

    next();
  };
}

/**
 * For operator: force unit_kerja_id from their JWT token.
 * For admin: allow any unit_kerja_id (from request body/params or default).
 *
 * This middleware MUST run after authMiddleware.
 */
export function enforceUnitKerjaScope(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Autentikasi diperlukan." });
    return;
  }

  if (req.user.role === "admin") {
    // Admin can access any unit_kerja — use whatever is in the request
    return next();
  }

  // Operator: force their own unit_kerja_id
  // Override any unit_kerja_id in body or query with their own
  if (req.body.unit_kerja_id !== undefined) {
    req.body.unit_kerja_id = req.user.unit_kerja_id;
  }

  // For GET queries, also enforce the scope
  if (req.query.unit_kerja_id) {
    req.query.unit_kerja_id = String(req.user.unit_kerja_id);
  }

  next();
}

/**
 * For operator reading data: only return records matching their unit_kerja_id.
 * This is applied at the SQL query level via the routes.
 */
export function getUnitKerjaFilter(req: Request): { unitKerjaId: number | null } {
  if (!req.user) return { unitKerjaId: null };
  if (req.user.role === "admin") return { unitKerjaId: null }; // null = no filter
  return { unitKerjaId: req.user.unit_kerja_id };
}
