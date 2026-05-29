const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const { logViolation, getViolations, getViolationStats } = require('../controllers/violationController');
const { apiCacheMiddleware } = require('../middleware/cache');

router.use(protect);
router.post('/', logViolation);
router.get('/', adminOnly, apiCacheMiddleware(), getViolations);
router.get('/stats', adminOnly, apiCacheMiddleware(), getViolationStats);

module.exports = router;
