const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const { getResults, getResult, getRankList, getAnalytics } = require('../controllers/resultController');

router.use(protect);
router.get('/analytics', adminOnly, getAnalytics);
router.get('/rank/:assessmentId', getRankList);
router.get('/', getResults);
router.get('/:id', getResult);

module.exports = router;
