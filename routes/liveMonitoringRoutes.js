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
        socketId: activeSockets.get(empId) || '',
      };
    });

    res.json(activeExams);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
