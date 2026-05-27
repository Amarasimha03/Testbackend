// routes/sheetsWebhook.js
// ─────────────────────────────────────────────────────────────────
// Called by Google Apps Script whenever a row is added/deleted in
// the connected Google Sheet.  No auth middleware — Apps Script
// cannot send a Bearer token.
// ─────────────────────────────────────────────────────────────────
const express   = require('express');
const router    = express.Router();
const localCache = require('../utils/localCache');

// ── helpers ──────────────────────────────────────────────────────
const { readDB, writeDB } = (() => {
  // re-export from localCache module
  const mod = require('../utils/localCache');
  // localCache exports connect / readDB / writeDB via module.exports
  return { readDB: mod.readDB, writeDB: mod.writeDB };
})();

// ── POST /api/sheets/webhook ─────────────────────────────────────
// Body: { rows: [...], sheetName: "employees" | "assessments" }
router.post('/webhook', async (req, res) => {
  try {
    const { rows, sheetName } = req.body;

    if (!rows || !Array.isArray(rows)) {
      return res.status(400).json({ success: false, message: 'No rows array provided' });
    }

    const sheet = (sheetName || '').toLowerCase().trim();
    console.log(`[SheetsWebhook] Received ${rows.length} rows for sheet: "${sheet}"`);

    const db = localCache.readDB();

    // ── Employees sheet ──────────────────────────────────────────
    if (sheet === 'employees' || sheet === 'sheet1' || sheet === '') {
      const adminEmail = (process.env.ADMIN_EMAIL || 'admin@gmail.com').toLowerCase();

      if (rows.length === 0) {
        // Sheet empty — keep only the admin account
        db.employees = db.employees.filter(
          e => e.role === 'admin' || e.email?.toLowerCase() === adminEmail
        );
        localCache.writeDB(db);
        console.log('[SheetsWebhook] Employees sheet empty — cleared all non-admin employees');
        return res.json({ success: true, deleted: 'all-non-admin', synced: 0 });
      }

      // Build set of emails still present in the sheet
      const incomingEmails = new Set(
        rows.map(r => (r['Email'] || r['email'] || '').toLowerCase().trim()).filter(Boolean)
      );

      // Remove employees that are no longer in the sheet (preserve admin)
      const before = db.employees.length;
      db.employees = db.employees.filter(emp => {
        if (emp.role === 'admin' || emp.email?.toLowerCase() === adminEmail) return true;
        return incomingEmails.has(emp.email?.toLowerCase().trim());
      });
      const deleted = before - db.employees.length;

      // Upsert remaining rows
      let upserted = 0;
      for (const row of rows) {
        const email = (row['Email'] || row['email'] || '').toLowerCase().trim();
        if (!email) continue;
        const existing = db.employees.find(e => e.email?.toLowerCase() === email);
        if (existing) {
          // Update fields from sheet
          if (row['Name']        || row['fullName'])    existing.fullName    = row['Name'] || row['fullName'];
          if (row['Phone']       || row['phone'])       existing.phone       = row['Phone'] || row['phone'];
          if (row['Department']  || row['department'])  existing.department  = row['Department'] || row['department'];
          if (row['Designation'] || row['designation']) existing.designation = row['Designation'] || row['designation'];
          if (row['Company']     || row['company'])     existing.company     = row['Company'] || row['company'];
          existing.updatedAt = new Date().toISOString();
          upserted++;
        }
        // We do NOT auto-create new employees from sheet — only admins create them
      }

      localCache.writeDB(db);
      console.log(`[SheetsWebhook] Employees — deleted: ${deleted}, updated: ${upserted}`);
      return res.json({ success: true, deleted, updated: upserted, total: db.employees.length });
    }

    // ── Assessments sheet ────────────────────────────────────────
    if (sheet === 'assessments') {
      if (rows.length === 0) {
        db.assessments = [];
        localCache.writeDB(db);
        return res.json({ success: true, deleted: 'all', synced: 0 });
      }

      const incomingIds = new Set(
        rows.map(r => (r['_id'] || r['id'] || r['Title'] || r['title'] || '').trim()).filter(Boolean)
      );

      const before = db.assessments.length;
      // Match by _id if present, else by title
      db.assessments = db.assessments.filter(a => {
        return incomingIds.has(String(a._id)) || incomingIds.has(a.title);
      });
      const deleted = before - db.assessments.length;
      localCache.writeDB(db);
      console.log(`[SheetsWebhook] Assessments — deleted: ${deleted}`);
      return res.json({ success: true, deleted, total: db.assessments.length });
    }

    // Unknown sheet — just acknowledge
    return res.json({ success: true, message: `Sheet "${sheet}" not handled — no action taken` });

  } catch (err) {
    console.error('[SheetsWebhook] Error:', err);
    res.status(500).json({ success: false, message: 'Webhook processing failed: ' + err.message });
  }
});

// ── GET /api/sheets/status ───────────────────────────────────────
// Health check — returns current in-memory counts
router.get('/status', (req, res) => {
  const db = localCache.readDB();
  res.json({
    success: true,
    counts: {
      employees:   db.employees?.length   || 0,
      assessments: db.assessments?.length || 0,
      questions:   db.questions?.length   || 0,
      results:     db.results?.length     || 0,
    },
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
