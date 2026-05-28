const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Result = require('../models/Result');

// GET live monitoring active exam sessions
router.get('/', protect, async (req, res) => {
  try {
    const activeResults = await Result.find({ status: 'in-progress' })
      .populate('employee', 'fullName employeeId email')
      .populate('assessment', 'title duration maxViolations');

    const activeSockets = req.app.get('activeSockets') || new Map();

    const activeExams = activeResults.map(r => {
      const empId = r.employee?._id ? String(r.employee._id) : '';
      const socketData = activeSockets.get(empId);
      const isCorrectExam = socketData && String(socketData.examId) === String(r.assessment?._id);

      return {
        employeeId: empId,
        employeeName: r.employee?.fullName || 'Candidate',
        assessmentId: r.assessment?._id || '',
        assessmentTitle: r.assessment?.title || 'Exam',
        violationCount: r.violationCount || 0,
        startedAt: r.startedAt,
        cameraActive: r.screenMonitoring?.webcamEnabled || false,
        screenShareStatus: r.screenMonitoring?.webcamEnabled ? 'active' : 'stopped',
        webrtcConnected: false,
        socketId: isCorrectExam ? socketData.socketId : '',
      };
    }).filter(exam => exam.socketId !== ''); // Only show if they are currently connected

    res.json(activeExams);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
