const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const {
  getAssessments, getMyAssessments, getAssessment,
  createAssessment, updateAssessment, deleteAssessment,
  startExam, submitExam, getDashboardStats, bulkAssignExam
} = require('../controllers/assessmentController');

router.use(protect);
router.get('/stats', adminOnly, getDashboardStats);
router.get('/my', getMyAssessments);
router.get('/', adminOnly, getAssessments);
router.post('/', adminOnly, createAssessment);
router.get('/:id', getAssessment);
router.put('/:id', adminOnly, updateAssessment);
router.delete('/:id', adminOnly, deleteAssessment);
router.post('/start', startExam);
router.post('/submit', submitExam);
router.post('/:id/assign-bulk', adminOnly, bulkAssignExam);

module.exports = router;
