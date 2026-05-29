const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const { getResults, getResult, getRankList, getAnalytics, deleteResult, getEmployeeResults } = require('../controllers/resultController');
const { apiCacheMiddleware } = require('../middleware/cache');

router.use(protect);
router.get('/analytics', adminOnly, apiCacheMiddleware(), getAnalytics);
router.get('/rank/:assessmentId', apiCacheMiddleware(), getRankList);
router.get('/employee/:id', apiCacheMiddleware(), getEmployeeResults);
router.get('/', apiCacheMiddleware(), getResults);
router.get('/:id', apiCacheMiddleware(), getResult);
router.delete('/:id', adminOnly, deleteResult);

module.exports = router;
