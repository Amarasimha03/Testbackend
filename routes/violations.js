const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const { logViolation, getViolations, getViolationStats } = require('../controllers/violationController');

router.use(protect);
router.post('/', logViolation);
router.get('/', adminOnly, getViolations);
router.get('/stats', adminOnly, getViolationStats);

module.exports = router;
