// Usage: requireRole('admin') as a route middleware, placed AFTER authenticateToken.
// Blocks the request with 403 if req.user.role isn't in the allowed list.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: insufficient permissions' });
    }
    next();
  };
}

module.exports = requireRole;
