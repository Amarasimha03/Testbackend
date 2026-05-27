// routes/sheetsWebhook.js
// ─────────────────────────────────────────────────────────────────
// Called by Google Apps Script whenever a row is deleted/changed in
// the connected Google Sheet.
// NO auth middleware — Apps Script cannot send a Bearer token.
// ─────────────────────────────────────────────────────────────────
'use strict';

const express    = require('express');
const router     = express.Router();
const localCache = require('../utils/localCache');

// ── POST /api/sheets/webhook ─────────────────────────────────────
// Body: { rows: [...], sheetName: "employees" | "assessments" }
router.post('/webhook', async (req, res) => {
  try {
    const { rows, sheetName } = req.body;

    if (!rows || !Array.isArray(rows)) {
      return res.status(400).json({ success: false, message: 'No rows array provided' });
    }

    const sheet = (sheetName || 'employees').toLowerCase().trim();
    console.log(`[SheetsWebhook] Received ${rows.length} rows for sheet: "${sheet}"`);

    const db  = localCache.readDB();

    // ── EMPLOYEES sheet ──────────────────────────────────────────
    if (sheet === 'employees' || sheet === 'sheet1') {
      const adminEmail = (process.env.ADMIN_EMAIL || 'admin@gmail.com').toLowerCase();

      if (rows.length === 0) {
        // Sheet is empty — remove all non-admin employees from memory
        const before = db.employees.length;
        db.employees = db.employees.filter(
          e => e.role === 'admin' || e.email?.toLowerCase() === adminEmail
        );
        localCache.writeDB(db);
        const deleted = before - db.employees.length;
        console.log(`[SheetsWebhook] Sheet empty — removed ${deleted} employee(s)`);
        return res.json({ success: true, deleted, synced: 0 });
      }

      // Build set of emails still present in the sheet
      const incomingEmails = new Set(
        rows
          .map(r => (r['Email'] || r['email'] || '').toLowerCase().trim())
          .filter(Boolean)
      );

      // Delete employees whose email is no longer in the sheet (never delete admin)
      const before = db.employees.length;
      db.employees = db.employees.filter(emp => {
        if (emp.role === 'admin' || emp.email?.toLowerCase() === adminEmail) return true;
        return incomingEmails.has(emp.email?.toLowerCase().trim());
      });
      const deleted = before - db.employees.length;

      // Update fields for remaining employees from sheet data
      let updated = 0;
      for (const row of rows) {
        const email = (row['Email'] || row['email'] || '').toLowerCase().trim();
        if (!email) continue;
        const emp = db.employees.find(e => e.email?.toLowerCase() === email);
        if (emp) {
          if (row['Name']        || row['fullName'])    emp.fullName    = row['Name'] || row['fullName'];
          if (row['Phone']       || row['phone'])       emp.phone       = row['Phone'] || row['phone'];
          if (row['Department']  || row['department'])  emp.department  = row['Department'] || row['department'];
          if (row['Designation'] || row['designation']) emp.designation = row['Designation'] || row['designation'];
          if (row['Company']     || row['company'])     emp.company     = row['Company'] || row['company'];
          emp.updatedAt = new Date().toISOString();
          updated++;
        }
      }

      localCache.writeDB(db);
      console.log(`[SheetsWebhook] Employees — deleted: ${deleted}, updated: ${updated}`);
      return res.json({
        success: true,
        deleted,
        updated,
        total: db.employees.length,
        message: `${deleted} deleted, ${updated} updated`,
      });
    }

    // ── ASSESSMENTS sheet ────────────────────────────────────────
    if (sheet === 'assessments') {
      if (rows.length === 0) {
        const before = db.assessments.length;
        db.assessments = [];
        localCache.writeDB(db);
        console.log(`[SheetsWebhook] Assessments sheet empty — removed ${before} assessment(s)`);
        return res.json({ success: true, deleted: before, synced: 0 });
      }

      // Match by _id first, then by title as fallback
      const incomingIds = new Set(
        rows.map(r => String(r['_id'] || r['id'] || '').trim()).filter(Boolean)
      );
      const incomingTitles = new Set(
        rows.map(r => String(r['Title'] || r['title'] || '').trim().toLowerCase()).filter(Boolean)
      );

      const before = db.assessments.length;
      db.assessments = db.assessments.filter(a => {
        if (incomingIds.size > 0 && incomingIds.has(String(a._id))) return true;
        if (incomingTitles.size > 0 && incomingTitles.has(a.title?.toLowerCase())) return true;
        // If sheet rows have no _id at all, keep all (cannot determine which to delete)
        if (incomingIds.size === 0 && incomingTitles.size === 0) return true;
        return false;
      });
      const deleted = before - db.assessments.length;
      localCache.writeDB(db);
      console.log(`[SheetsWebhook] Assessments — deleted: ${deleted}`);
      return res.json({ success: true, deleted, total: db.assessments.length });
    }

    // Unknown sheet — acknowledge without action
    return res.json({
      success: true,
      message: `Sheet "${sheet}" is not configured — no changes made`,
    });

  } catch (err) {
    console.error('[SheetsWebhook] Error:', err);
    return res.status(500).json({ success: false, message: 'Webhook processing failed: ' + err.message });
  }
});

// ── GET /api/sheets/status ───────────────────────────────────────
// Health check — returns current in-memory DB row counts
router.get('/status', (_req, res) => {
  const db = localCache.readDB();
  res.json({
    success: true,
    counts: {
      employees:   (db.employees   || []).length,
      assessments: (db.assessments || []).length,
      questions:   (db.questions   || []).length,
      results:     (db.results     || []).length,
    },
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
