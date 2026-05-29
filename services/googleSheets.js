// Use native fetch (Node 18+)

const CACHE_TTL_MS = 1000; // 1 second
const cache = new Map();

// Helper to determine if an action should be cached
const isCacheableAction = (action) => [
  'getAssessments',
  'getResults',
  'getEmployees',
  'getQuestions',
  'getViolations'
].includes(action);

/**
 * Send a direct POST request to Google Apps Script (Code.gs).
 * 
 * @param {string} action - The action string (e.g. 'getEmployees', 'createAssessment')
 * @param {object} payload - The data to send
 * @returns {Promise<any>} The parsed JSON response from Google Sheets
 */
exports.querySheets = async (action, payload = {}) => {
  const sheetUrl = process.env.GOOGLE_SHEET_URL;
  if (!sheetUrl) {
    throw new Error('GOOGLE_SHEET_URL is not defined in environment variables.');
  }

  const cacheKey = action + (payload ? JSON.stringify(payload) : '');

  // 1. Check Cache for Read Actions
  if (isCacheableAction(action) && cache.has(cacheKey)) {
    const cachedEntry = cache.get(cacheKey);
    if (Date.now() - cachedEntry.timestamp < CACHE_TTL_MS) {
      console.log(`[querySheets] 🟢 Serving ${action} from memory cache`);
      return JSON.parse(cachedEntry.data); // Return a copy to prevent mutation
    } else {
      cache.delete(cacheKey); // Expired
    }
  }

  // 2. Clear relevant cache on writes
  if (action === 'createEmployee' || action === 'updateEmployee' || action === 'deleteEntity') {
    for (const key of cache.keys()) if (key.startsWith('getEmployees')) cache.delete(key);
  }
  if (action === 'createAssessment' || action === 'updateAssessment' || action === 'deleteEntity') {
    for (const key of cache.keys()) if (key.startsWith('getAssessments')) cache.delete(key);
  }
  if (action === 'submitResult' || action === 'deleteEntity') {
    for (const key of cache.keys()) if (key.startsWith('getResults')) cache.delete(key);
  }
  if (action === 'createQuestion' || action === 'updateQuestion' || action === 'deleteEntity') {
    for (const key of cache.keys()) if (key.startsWith('getQuestions')) cache.delete(key);
  }

  // 3. Not cached or write action, hit Google Sheets
  const body = { action, ...payload };
  let parsed;

  try {
    const res = await fetch(sheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const text = await res.text();

    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.error('[querySheets] Failed to parse JSON from Apps Script:', text.substring(0, 500));
      throw new Error('Invalid JSON response from Google Apps Script');
    }
  } catch (err) {
    console.error(`[querySheets] Network/Execution error for action "${action}":`, err.message);
    throw err;
  }

  // 4. Update Cache or Invalidate
  if (isCacheableAction(action)) {
    // Save to cache
    cache.set(cacheKey, { timestamp: Date.now(), data: JSON.stringify(parsed) });
  } else {
    // It's a mutation (create, update, delete). Clear entire cache to guarantee freshness!
    console.log(`[querySheets] 🟡 Mutation detected (${action}). Clearing memory cache.`);
    cache.clear();
  }

  return parsed;
};
