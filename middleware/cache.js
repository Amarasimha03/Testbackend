const cache = new Map();

const apiCacheMiddleware = (duration = 1000) => {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();

    const key = `${req.originalUrl || req.url}__${req.user?._id || 'anon'}`;
    const cached = cache.get(key);

    if (cached && Date.now() - cached.time < duration) {
      return res.json(cached.body);
    }

    const originalJson = res.json;
    res.json = function (body) {
      if (res.statusCode >= 200 && res.statusCode < 300 && body && body.success !== false) {
        cache.set(key, { body, time: Date.now() });
      }
      return originalJson.call(this, body);
    };
    next();
  };
};

const clearCache = () => {
  console.log('[Cache] Clearing all apiCacheMiddleware entries.');
  cache.clear();
};

const clearUserCache = (userId) => {
  if (!userId) return;
  const suffix = `__${userId}`;
  console.log(`[Cache] Clearing apiCacheMiddleware entries for user: ${userId}`);
  for (const key of cache.keys()) {
    if (key.endsWith(suffix)) {
      cache.delete(key);
    }
  }
};

module.exports = {
  apiCacheMiddleware,
  clearCache,
  clearUserCache
};
