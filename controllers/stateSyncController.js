const { querySheets } = require('../services/googleSheets');

exports.saveSession = async (req, res) => {
  try {
    const { userId, name, email, role, status } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'userId required' });

    const result = await querySheets('saveSession', {
      userId,
      name: name || req.user?.fullName,
      email: email || req.user?.email,
      role: role || req.user?.role,
      loginTime: new Date().toISOString(),
      status: status || 'active',
    });

    res.json({ success: true, message: 'Session saved', result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getSession = async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await querySheets('getSession', { userId });
    if (!result?.success) return res.json({ success: false, message: 'No session found' });
    res.json({ success: true, session: result.session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.saveExamProgress = async (req, res) => {
  try {
    const { userId, examId, questionId, selectedAnswer, answerLabel } = req.body;
    if (!userId || !examId) return res.status(400).json({ success: false, message: 'userId and examId required' });

    const result = await querySheets('saveExam', {
      userId,
      examId,
      questionId: questionId || '',
      selectedAnswer,
      answerLabel: answerLabel || '',
    });

    res.json({ success: true, message: 'Exam progress saved', result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getExamProgress = async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await querySheets('getExam', { userId });
    if (!result?.success) return res.json({ success: true, examData: [] });
    res.json({ success: true, examData: result.examData || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.saveExamMeta = async (req, res) => {
  try {
    const { userId, examId, phase, currentQ, timer, resultId, violations } = req.body;
    if (!userId || !examId) return res.status(400).json({ success: false, message: 'userId and examId required' });

    const result = await querySheets('saveExamMeta', {
      userId, examId, phase, currentQ, timer, resultId, violations
    });

    res.json({ success: true, message: 'Exam meta saved', result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getExamMeta = async (req, res) => {
  try {
    const { userId, examId } = req.params;
    const result = await querySheets('getExamMeta', { userId, examId });
    if (!result?.success) return res.json({ success: true, meta: null });
    res.json({ success: true, meta: result.meta });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.saveMonitorState = async (req, res) => {
  try {
    const { userId, cameraStatus, screenShareStatus, warningCount } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'userId required' });

    const result = await querySheets('saveMonitoring', {
      userId,
      cameraStatus: cameraStatus || 'unknown',
      screenShareStatus: screenShareStatus || 'unknown',
      warningCount: warningCount || 0,
    });

    res.json({ success: true, message: 'Monitoring state saved', result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getMonitorState = async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await querySheets('getMonitoring', { userId });
    if (!result?.success) return res.json({ success: true, monitoring: null });
    res.json({ success: true, monitoring: result.monitoring });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
