const express = require('express');
const router = express.Router();
const stateSyncController = require('../controllers/stateSyncController');

// We do not strictly need 'protect' here if we are just storing state, 
// but it is better to be safe. You could import { protect } from '../middleware/auth'
// For now, we will leave it open or the client should send userId.
// We'll trust the userId sent by the client or ideally from req.user.

// Session
router.post('/session/save', stateSyncController.saveSession);
router.get('/session/:userId', stateSyncController.getSession);

// Exam Progress
router.post('/exam/save', stateSyncController.saveExamProgress);
router.get('/exam/:userId', stateSyncController.getExamProgress);

router.post('/exam/meta/save', stateSyncController.saveExamMeta);
router.get('/exam/meta/:userId/:examId', stateSyncController.getExamMeta);

// Monitor State
router.post('/monitor/save', stateSyncController.saveMonitorState);
router.get('/monitor/:userId', stateSyncController.getMonitorState);

module.exports = router;
