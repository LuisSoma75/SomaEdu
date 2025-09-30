// backend/api/middleware/logger.js
export default function requestLogger(req, res, next) {
  const t0 = Date.now();
  const id = Math.random().toString(36).slice(2, 8).toUpperCase();

  // No loguear password
  const safeBody = (() => {
    try {
      if (!req.is("application/json")) return null;
      const { password, contrasena, contraseña, ...rest } = req.body || {};
      return rest;
    } catch {
      return null;
    }
  })();

  console.log(`[REQ ${id}] ${req.method} ${req.originalUrl}`);
  if (safeBody) console.log(`[REQ ${id}] body:`, safeBody);
  if (Object.keys(req.query || {}).length) console.log(`[REQ ${id}] query:`, req.query);

  const end = res.end;
  res.end = function (...args) {
    res.end = end;
    const dt = Date.now() - t0;
    console.log(`[RES ${id}] ${res.statusCode} (${dt}ms) ${req.method} ${req.originalUrl}`);
    return res.end(...args);
  };

  next();
}
