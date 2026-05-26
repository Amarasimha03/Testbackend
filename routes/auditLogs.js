const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const { protect, adminOnly } = require('../middleware/auth');

// GET all audit logs (admin only) with pagination and filtering
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const { action, userId, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (action) filter.action = action;
    if (userId) filter.user = userId;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate('user', 'fullName email role')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit)),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      logs,
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
    const [actionStats, recentLogs] = await Promise.all([
      AuditLog.aggregate([
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      AuditLog.find()
        .populate('user', 'fullName email role')
        .sort({ createdAt: -1 })
        .limit(10),
    ]);

    res.json({ success: true, actionStats, recentLogs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
