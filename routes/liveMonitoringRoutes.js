const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { querySheets } = require('../services/googleSheets');

// GET live monitoring active exam sessions
router.get('/', protect, async (req, res) => {
  try {
    const resRes = await querySheets('getResults');
    const activeResults = (resRes.data || []).filter(r => r.status === 'in-progress');

    const empRes = await querySheets('getEmployees');
    const employees = empRes.data || [];
    const assRes = await querySheets('getAssessments');
    const assessments = assRes.data || [];

    const activeSockets = req.app.get('activeSockets') || new Map();

    const activeExams = activeResults.map(r => {
      const e = employees.find(e => String(e._id) === String(r.employee));
      const a = assessments.find(a => String(a._id) === String(r.assessment));

      const empId = e?._id ? String(e._id) : String(r.employee);
      const socketData = activeSockets.get(empId);
      const isCorrectExam = socketData && String(socketData.examId) === String(a?._id || r.assessment);

      let sm = {};
      try { sm = typeof r.screenMonitoring === 'string' ? JSON.parse(r.screenMonitoring) : (r.screenMonitoring || {}); } catch(e){}

      return {
        employeeId: empId,
        employeeName: e?.fullName || r.employeeName || 'Candidate',
        assessmentId: a?._id || r.assessment || '',
        assessmentTitle: a?.title || 'Exam',
        violationCount: r.violationCount || 0,
        startedAt: r.startedAt,
        cameraActive: sm.webcamEnabled === true || sm.webcamEnabled === 'true',
        screenShareStatus: (sm.webcamEnabled === true || sm.webcamEnabled === 'true') ? 'active' : 'stopped',
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
