// controllers/stateSyncController.js
// Bridges Express API <-> Google Apps Script for persistent state

const SHEETS_URL = process.env.GOOGLE_APPS_SCRIPT_STATE_URL || process.env.GOOGLE_SHEET_URL || 'https://script.google.com/macros/s/AKfycbx3AnqjtgZDFUYc3XrRNmvMIpfjQKcenuySRcRzzJf5DUVfRNs6CPAOE8_Yy8OmxJpZfg/exec';

const sheetsPost = async (payload) => {
  if (!SHEETS_URL) {
    console.warn('[StateSync] GOOGLE_APPS_SCRIPT_STATE_URL not set – skipping.');
    return null;
  }
  try {
    const url = new URL(SHEETS_URL);
    if (payload && payload.action) {
      url.searchParams.set('action', payload.action);
    }
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err) {
    console.error('StateSync POST error:', err);
    return null;
  }
};

const sheetsGet = async (params) => {
  if (!SHEETS_URL) return null;
  try {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${SHEETS_URL}?${qs}`);
    return await res.json();
  } catch (err) {
    console.error('StateSync GET error:', err);
    return null;
  }
};

// ===========================================================
// USER SESSION
// ===========================================================

exports.saveSession = async (req, res) => {
  try {
    const { userId, name, email, role, status } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'userId required' });

    const result = await sheetsPost({
      action: 'saveSession',
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
    const result = await sheetsGet({ action: 'getSession', userId });
    if (!result?.success) return res.status(404).json({ success: false, message: 'No session found' });
    res.json({ success: true, session: result.session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ===========================================================
// EXAM PROGRESS
// ===========================================================

exports.saveExamProgress = async (req, res) => {
  try {
    const { userId, examId, questionId, selectedAnswer, answerLabel } = req.body;
    if (!userId || !examId) return res.status(400).json({ success: false, message: 'userId and examId required' });

    const result = await sheetsPost({
      action: 'saveExam',
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
    const result = await sheetsGet({ action: 'getExam', userId });
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

    const result = await sheetsPost({
      action: 'saveExamMeta',
      userId,
      examId,
      phase,
      currentQ,
      timer,
      resultId,
      violations
    });

    res.json({ success: true, message: 'Exam meta saved', result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getExamMeta = async (req, res) => {
  try {
    const { userId, examId } = req.params;
    const result = await sheetsGet({ action: 'getExamMeta', userId, examId });
    if (!result?.success) return res.json({ success: true, meta: null });
    res.json({ success: true, meta: result.meta });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ===========================================================
// MONITORING STATE
// ===========================================================

exports.saveMonitorState = async (req, res) => {
  try {
    const { userId, cameraStatus, screenShareStatus, warningCount } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'userId required' });

    const result = await sheetsPost({
      action: 'saveMonitoring',
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
    const result = await sheetsGet({ action: 'getMonitoring', userId });
    if (!result?.success) return res.json({ success: true, monitoring: null });
    res.json({ success: true, monitoring: result.monitoring });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
