const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const { querySheets } = require('../services/googleSheets');

// GET all audit logs (admin only) with pagination and filtering
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const { action, userId, page = 1, limit = 50 } = req.query;
    
    // Apps script doesn't actually have a getAuditLogs action currently, but we can assume it will, 
    // or we can use getDatabase or getMonitoring? Wait, getDatabase returns auditlogs...
    // Actually getDatabase in Code.gs didn't return auditlogs, it returned monitoring.
    // AuditLog mock used `auditlogs`. If Apps Script has it, we just fetch it.
    // Let's implement getting it via getDatabase since Code.gs returns all sheets it can find.
    const dbRes = await querySheets('getDatabase');
    let logs = [];
    if (dbRes && dbRes.data && dbRes.data.auditlogs) {
      logs = dbRes.data.auditlogs;
    } else {
      // Create fallback if it doesn't exist
      logs = [];
    }

    if (action) logs = logs.filter(l => l.action === action);
    if (userId) logs = logs.filter(l => String(l.user) === String(userId));
    
    const total = logs.length;
    
    logs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    
    const startIndex = (page - 1) * limit;
    const paginatedLogs = logs.slice(startIndex, startIndex + parseInt(limit));

    const empRes = await querySheets('getEmployees');
    const employees = empRes.data || [];
    
    const populated = paginatedLogs.map(l => {
      const e = employees.find(e => String(e._id) === String(l.user));
      return { ...l, user: e ? { _id: e._id, fullName: e.fullName, email: e.email, role: e.role } : l.user };
    });

    res.json({
      success: true,
      logs: populated,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET audit log stats summary
router.get('/stats', protect, adminOnly, async (req, res) => {
  try {
    const dbRes = await querySheets('getDatabase');
    let logs = (dbRes && dbRes.data && dbRes.data.auditlogs) ? dbRes.data.auditlogs : [];
    
    const actionMap = {};
    for (const l of logs) {
      actionMap[l.action] = (actionMap[l.action] || 0) + 1;
    }
    const actionStats = Object.keys(actionMap).map(k => ({ _id: k, count: actionMap[k] })).sort((a, b) => b.count - a.count);
    
    logs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const recentLogs = logs.slice(0, 10);
    
    const empRes = await querySheets('getEmployees');
    const employees = empRes.data || [];
    
    const populated = recentLogs.map(l => {
      const e = employees.find(e => String(e._id) === String(l.user));
      return { ...l, user: e ? { _id: e._id, fullName: e.fullName, email: e.email, role: e.role } : l.user };
    });

    res.json({ success: true, actionStats, recentLogs: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
