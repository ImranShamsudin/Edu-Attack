// Minimal in-memory rate limiter (no extra dependency). Good enough for a single
// Node process; use a shared store (e.g. Redis) if you ever run several instances.
function rateLimit({ windowMs, max, message, keyFn }) {
  const hits = new Map(); // key -> { count, resetAt }

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, Math.min(windowMs, 60 * 1000));
  timer.unref();

  const keyOf = (req) => (keyFn ? keyFn(req) : req.ip);

  const middleware = (req, res, next) => {
    const key = keyOf(req);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: message || 'Too many requests. Please try again later.' });
    }
    next();
  };

  // Forget a key (e.g. after a successful login).
  middleware.reset = (req) => hits.delete(keyOf(req));
  return middleware;
}

module.exports = rateLimit;
