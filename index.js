// ── Load .env first (override:true ensures .env wins over Render dashboard defaults) ─
require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

// ── Hardcoded fallbacks — only used if NOT set in .env OR Render dashboard ─────────
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

const GOOGLE_SHEET_URL_DEFAULT = 'https://script.google.com/macros/s/AKfycbxUVUnaXv_aOcxT9m__tsqAlpMaLKtwmvVXhfUiRgoJ7hFGv3EFVWFF3r7dPRYZJuJa-A/exec';
process.env.JWT_SECRET        = process.env.JWT_SECRET        || 'onlinetest_jwt_secret_2024_secure_key';
process.env.JWT_EXPIRES_IN    = process.env.JWT_EXPIRES_IN    || '7d';
process.env.ADMIN_EMAIL       = process.env.ADMIN_EMAIL       || 'admin@gmail.com';
process.env.ADMIN_PASSWORD    = process.env.ADMIN_PASSWORD    || 'Admin123';
process.env.NODE_ENV          = process.env.NODE_ENV          || 'production';
process.env.GOOGLE_SHEET_URL  = process.env.GOOGLE_SHEET_URL  || GOOGLE_SHEET_URL_DEFAULT;

const express = require('express');
const cors = require('cors');
// localCache removed
const rateLimit = require('express-rate-limit');
const path = require('path');
const clientBuildPath = path.join(__dirname, 'build');


// ── Startup diagnostics ─────────────────────────────────────
console.log('🔍 ENV CHECK:');
console.log('  JWT_SECRET:', process.env.JWT_SECRET ? '✅ SET' : '❌ MISSING');
console.log('  GOOGLE_SHEET_URL:', process.env.GOOGLE_SHEET_URL ? '✅ SET' : '⚠️  Not set (memory-only mode)');
console.log('  ADMIN_EMAIL:', process.env.ADMIN_EMAIL);
console.log('  NODE_ENV:', process.env.NODE_ENV);
console.log('  PORT:', process.env.PORT || '5000 (default)');


// Route imports
const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employees');
const assessmentRoutes = require('./routes/assessments');
const questionRoutes = require('./routes/questions');
const resultRoutes = require('./routes/results');
const violationRoutes = require('./routes/violations');
const monitoringRoutes = require('./routes/monitoring');
const auditLogRoutes = require('./routes/auditLogs');
const stateSyncRoutes = require('./routes/stateSync');
const liveMonitoringRoutes = require('./routes/liveMonitoringRoutes');
const examRoutes = require('./routes/examRoutes');
const sheetsWebhookRoutes = require('./routes/sheetsWebhook');

const app = express();
const compression = require('compression');
app.use(compression());

app.use(cors({
  origin: [
      process.env.CLIENT_URL || "https://onlinetest-vpb4.onrender.com",
      "http://localhost:3001"
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"]
}));
// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000, // high limit for testing
  message: 'Too many requests, please try again later.',
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/api', limiter);

// Clear API cache on mutations (POST, PUT, DELETE) to prevent stale cached reads on client
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const { clearCache } = require('./middleware/cache');
    clearCache();
  }
  next();
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Server startup logic
async function startServer() {
  console.log('✅ Node server starting in proxy mode (bypassing local DB cache)');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/assessments', assessmentRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/violations', violationRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/state', stateSyncRoutes);
app.use('/api/live-monitoring', liveMonitoringRoutes);
app.use('/api/exam', examRoutes);
// No auth middleware — called directly by Google Apps Script
app.use('/api/sheets', sheetsWebhookRoutes);

const { protect, adminOnly } = require('./middleware/auth');

// ── DB Status (admin only) ────────────────────────────────────
app.get('/api/db-status', protect, adminOnly, async (req, res) => {
  try {
    const { querySheets } = require('./services/googleSheets');
    const dbRes = await querySheets('getDatabase');
    const db = dbRes.data || {};
    res.json({
      success: true,
      sheetsUrl: process.env.GOOGLE_SHEET_URL ? '✅ configured' : '❌ missing',
      counts: {
        employees:   db.employees?.length   || 0,
        assessments: db.assessments?.length || 0,
        questions:   db.questions?.length   || 0,
        results:     db.results?.length     || 0,
        violations:  db.violations?.length  || 0,
      },
      adminEmail: process.env.ADMIN_EMAIL,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


const submitExamHandler = async (req, res) => {
  try {
    console.log("========== SUBMIT EXAM ==========");
    console.log("BODY:", req.body);
    
    const { employeeId, reason, resultId, autoSubmit } = req.body;
    const { querySheets } = require('./services/googleSheets');
    
    const resRes = await querySheets('getResults');
    const results = resRes.data || [];

    let result;
    if (resultId) {
      result = results.find(r => String(r._id) === String(resultId));
    } else {
      result = results.find(r => (String(r.employeeMongoId) === String(employeeId || req.user._id) || String(r.employeeId) === String(employeeId || req.user._id)) && r.status === 'in-progress');
    }

    if (!result) {
      return res.status(404).json({ success: false, message: 'Active exam result not found' });
    }

    const assRes = await querySheets('getAssessments');
    const assessment = (assRes.data || []).find(a => String(a._id || a.id) === String(result.assessmentId || result.assessment));
    
    let questions = [];
    if (assessment) {
      const assessmentId = assessment._id || assessment.id;
      const qRes = await querySheets('getQuestions', { assessmentId });
      const rawQuestions = (qRes.data || []).filter(q => String(q.assessment) === String(assessmentId) || String(q.assessmentId) === String(assessmentId));
      questions = rawQuestions.map(q => {
        if (typeof q.options === 'string') {
          try { q.options = JSON.parse(q.options); } catch(e) {}
        }
        if (Array.isArray(q.options) && q.options.length > 0 && typeof q.options[0] !== 'object') {
          const correctIdx = parseInt(q.correctOptionIndex !== undefined ? q.correctOptionIndex : 0, 10);
          q.options = q.options.map((opt, idx) => ({ text: String(opt), isCorrect: idx === correctIdx }));
        }
        if (!Array.isArray(q.options) || q.options.length === 0) {
          const opts = [];
          const correctIdx = parseInt(q.correctOptionIndex !== undefined ? q.correctOptionIndex : -1, 10);
          if (q.option1 !== undefined && q.option1 !== '') opts.push({ text: q.option1, isCorrect: correctIdx === 0 });
          if (q.option2 !== undefined && q.option2 !== '') opts.push({ text: q.option2, isCorrect: correctIdx === 1 });
          if (q.option3 !== undefined && q.option3 !== '') opts.push({ text: q.option3, isCorrect: correctIdx === 2 });
          if (q.option4 !== undefined && q.option4 !== '') opts.push({ text: q.option4, isCorrect: correctIdx === 3 });
          q.options = opts;
        }
        if (Array.isArray(q.options)) {
          q.options = q.options.map((o, idx) => {
            if (typeof o === 'object' && o !== null) {
              return { text: o.text || '', isCorrect: !!o.isCorrect };
            }
            return { text: String(o), isCorrect: idx === 0 };
          });
        }
        q.title = q.title || q.question || '';
        return q;
      });
    }

    const totalMarks = questions.reduce((sum, q) => sum + (parseInt(q.marks) || 0), 0);
    result.totalMarks = totalMarks;

    let totalScore = 0;
    let correctAnswersCount = 0;
    let wrongAnswersCount = 0;
    let processedAnswers = [];

    if (req.body.answers && Array.isArray(req.body.answers)) {
      processedAnswers = req.body.answers.map(ans => {
        const question = questions.find(q => String(q._id || q.id) === String(ans.questionId));
        if (!question) return ans;
        let isCorrect = false;
        let marksObtained = 0;
        let correctAnswerText = '';
        let selectedAnswerText = '';

        let qOptions = question.options || [];

        const optionsText = qOptions.map(o => o.text);
        
        const qType = question.type || 'mcq';
        let selectedIdx = undefined;
        let selectedIdxs = [];
        if (ans.selectedAnswer !== undefined) {
          selectedIdx = Array.isArray(ans.selectedAnswer) ? ans.selectedAnswer[0] : ans.selectedAnswer;
          selectedIdxs = Array.isArray(ans.selectedAnswer) ? ans.selectedAnswer : [ans.selectedAnswer];
        } else if (ans.selectedOptions !== undefined) {
          selectedIdx = ans.selectedOptions[0];
          selectedIdxs = ans.selectedOptions;
        }

        if (qType === 'mcq' || qType === 'true-false' || qType === 'multiple-choice') {
          const correctIdx = qOptions.findIndex(o => o.isCorrect === true || o.isCorrect === 'true');
          isCorrect = selectedIdx != null && String(selectedIdx) === String(correctIdx);
          if (isCorrect) marksObtained = parseInt(question.marks) || 0;
          correctAnswerText = qOptions[correctIdx]?.text || '';
          selectedAnswerText = (selectedIdx !== undefined && selectedIdx !== null) ? (qOptions[selectedIdx]?.text || 'Not Attempted') : 'Not Attempted';
        } else if (question.type === 'multiple-select') {
          const correctIdxs = qOptions.map((o, i) => (o.isCorrect === true || o.isCorrect === 'true') ? i : null).filter(i => i !== null);
          isCorrect = JSON.stringify(selectedIdxs.map(Number).sort()) === JSON.stringify(correctIdxs.map(Number).sort());
          if (isCorrect) marksObtained = parseInt(question.marks) || 0;
          correctAnswerText = correctIdxs.map(i => qOptions[i]?.text).join(', ');
          selectedAnswerText = (selectedIdxs && selectedIdxs.length > 0) ? selectedIdxs.map(i => qOptions[i]?.text).filter(Boolean).join(', ') : 'Not Attempted';
        }

        totalScore += marksObtained;
        return { 
          question: ans.questionId, 
          questionText: question.title,
          options: optionsText,
          selectedOptions: selectedIdxs, 
          selectedAnswer: selectedAnswerText,
          correctAnswer: correctAnswerText,
          isCorrect, 
          marksObtained, 
          timeTaken: ans.timeTaken || 0 
        };
      });

      correctAnswersCount = processedAnswers.filter(a => a.isCorrect).length;
      wrongAnswersCount = processedAnswers.length - correctAnswersCount;

      result.answers = processedAnswers;
      result.totalScore = totalScore;
      result.percentage = result.totalMarks ? Math.round((totalScore / result.totalMarks) * 100) : 0;
      result.passed = result.percentage >= (assessment ? assessment.passingScore : 60);
      result.correctAnswers = correctAnswersCount;
      result.wrongAnswers = wrongAnswersCount;
    } else {
      let rAnswers = [];
      try { rAnswers = typeof result.answers === 'string' ? JSON.parse(result.answers) : (result.answers || []); } catch(e){}
      correctAnswersCount = rAnswers.filter(a => a.isCorrect === true || a.isCorrect === 'true').length;
      wrongAnswersCount = rAnswers.length - correctAnswersCount;
    }

    const isUserCancelled = reason && reason.toLowerCase().includes('user cancelled');
    
    result.status = isUserCancelled ? 'cancelled' : 'completed';
    result.submittedAt = new Date().toISOString();
    result.examCompleted = true;
    result.endTime = new Date().toISOString();
    result.completionTime = Math.round((new Date(result.submittedAt) - new Date(result.startedAt || 0)) / 60000);
    result.autoSubmitReason = reason || (autoSubmit ? 'Camera Violations' : 'Manual Submission');

    const empRes = await querySheets('getEmployees');
    const empId = result.employeeMongoId || result.employeeId || req.user._id;
    const employee = (empRes.data || []).find(e => String(e._id) === String(empId));

    await querySheets('submitResult', {
      _id:             result._id,
      employeeId:      employee ? (employee.employeeId || employee._id.toString()) : '',
      employeeMongoId: empId.toString(),
      employee:        empId.toString(),
      employeeName:    employee ? employee.fullName : '',
      employeeEmail:   employee ? employee.email : '',
      assessmentId:    (result.assessmentId || result.assessment || assessment?._id || '').toString(),
      assessment:      (result.assessmentId || result.assessment || assessment?._id || '').toString(),
      assessmentTitle: assessment ? assessment.title : 'Exam',
      totalScore:      result.totalScore,
      totalMarks:      result.totalMarks,
      percentage:      result.percentage,
      passed:          result.passed,
      status:          result.status,
      violationCount:  result.violationCount || 0,
      completionTime:  result.completionTime || 0,
      startedAt:       result.startedAt || '',
      submittedAt:     result.submittedAt || '',
      examStarted:     true,
      examCompleted:   true,
      startTime:       result.startTime || result.startedAt || '',
      endTime:         result.endTime || result.submittedAt || '',
      cancelTime:      isUserCancelled ? new Date().toISOString() : '',
      autoSubmitReason:result.autoSubmitReason || '',
      submissionType:  isUserCancelled ? 'User Cancelled' : 'Submitted',
      correctAnswers:  correctAnswersCount,
      wrongAnswers:    wrongAnswersCount,
      answers:         JSON.stringify(result.answers || []),
    });

    await querySheets('saveViolation', {
      employeeId:      employee ? (employee.employeeId || employee._id.toString()) : '',
      name:            employee ? employee.fullName : '',
      warningCount:    result.violationCount || (isUserCancelled ? 0 : 4),
      reason:          reason || 'Camera Violations',
    });

    const io = req.app.get('io');
    if (io) {
      io.to('admin-room').emit('exam:completed', {
        employeeId: empId.toString(),
        assessmentId: (result.assessment || assessment?._id || '').toString(),
        terminationReason: reason || 'Camera Violations',
        status: result.status,
      });
    }

    // Clear cache so the dashboard reflects the completed exam immediately
    if (req.user && req.user._id) {
      const { clearUserCache } = require('./middleware/cache');
      clearUserCache(req.user._id);
    }

    res.json({ success: true, message: isUserCancelled ? 'Exam cancelled successfully' : 'Exam auto-submitted successfully' });
  } catch (err) {
    console.error('[/api/submit-exam] ERROR:', err);
    res.status(500).json({ success: false, message: err.message, error: err.message });
  }
};

app.post('/api/submit-exam', protect, submitExamHandler);
app.post('/api/results/submit', protect, submitExamHandler);


app.get('/api/health', (req, res) =>
  res.json({ status: 'OK', timestamp: new Date().toISOString() })
);

// Serve Static Assets with aggressive browser caching in production
app.use(express.static(clientBuildPath, {
  maxAge: '1y',
  etag: true,
  setHeaders: (res, filepath) => {
    if (path.basename(filepath) === 'index.html') {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// SPA fallback: redirect all unhandled requests to React index.html so refreshing routes (e.g. /dashboard) doesn't throw 404
app.get('/*splat', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return next();
  }
  // Exclude missing static assets from HTML redirection to avoid MIME type errors
  if (/\.(js|css|png|jpg|jpeg|gif|ico|json|svg|woff|woff2|ttf|map)$/i.test(req.path)) {
    return res.status(404).send('Not Found');
  }
  res.sendFile(path.join(clientBuildPath, 'index.html'), (err) => {
    if (err) {
      console.error('SPA Fallback Error:', err);
      res.status(500).send('Frontend static files or index.html missing at ' + path.join(clientBuildPath, 'index.html') + ': ' + err.message);
    }
  });
});

const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  transports: ["websocket", "polling"],
  cors: {
      origin: [
          process.env.CLIENT_URL || "https://onlinetest-vpb4.onrender.com",
          "http://localhost:3001"
      ],
      methods: ["GET", "POST"],
      credentials: true
  }
});

// Attach io globally and to express app so controllers can use it
global.io = io;
app.set('io', io);

const activeSockets = new Map();
app.set('activeSockets', activeSockets);

// Socket.IO signaling logic
io.on('connection', (socket) => {
  // Admin joins a dedicated room
  socket.on('admin:join', () => {
    socket.join('admin-room');
    // Request active employee renegotiation when admin returns/joins
    io.emit('webrtc:request-renegotiate');
  });

  // Employee joins room for dashboard notifications without marking them as "in exam"
  socket.on('employee:join-room', (data) => {
    socket.join(`exam-${data.employeeId}`);
  });

  // Employee joins exam via official user prompt spec
  socket.on('join-exam', (data) => {
    const { examId, userId, employeeName } = data;
    socket.join(examId);
    activeSockets.set(String(userId), { socketId: socket.id, examId });
    
    // Notify admin using default fallback and spec room
    io.to('admin-room').emit('exam:employee-joined', {
      employeeId: userId,
      employeeName: employeeName || 'Employee',
      examId,
      socketId: socket.id,
      joinedAt: new Date()
    });
  });

  // Employee camera stream specification
  socket.on('camera-stream', (data) => {
    const { examId } = data;
    io.to(examId).emit('camera-stream', data);
    // Maintain admin console live frame update compatibility
    io.to('admin-room').emit('exam:frame-update', data);
  });

  // Employee screen share stream specification
  socket.on('screen-share', (data) => {
    const { examId } = data;
    io.to(examId).emit('screen-share', data);
    io.to('admin-room').emit('admin-live-frame', data);
  });

  // Employee violation specification
  socket.on('violation', (data) => {
    const { examId } = data;
    io.to(examId).emit('violation', data);
    io.to('admin-room').emit('violation:alert', data);
  });

  // Employee exam submit specification
  socket.on('submit-exam', (data) => {
    const { examId } = data;
    io.to(examId).emit('exam-submitted', data);
    io.to('admin-room').emit('exam:completed', data);
  });

  // Maintain backwards compatibility for existing hooks
  socket.on('exam:start', (data) => {
    const { employeeId, employeeName, examId } = data;
    socket.join(examId);
    activeSockets.set(String(employeeId), { socketId: socket.id, examId });
    io.to('admin-room').emit('exam:employee-joined', {
      employeeId,
      employeeName,
      examId,
      socketId: socket.id,
      joinedAt: new Date()
    });
  });

  // WebRTC Signaling: Offer from Employee -> Admin
  socket.on('webrtc:offer', (data) => {
    io.to('admin-room').emit('webrtc:offer', {
      employeeId: data.employeeId,
      offer: data.offer,
      socketId: socket.id
    });
  });

  // WebRTC Signaling: Answer from Admin -> Employee
  socket.on('webrtc:answer', (data) => {
    io.to(data.to).emit('webrtc:answer', {
      answer: data.answer
    });
  });

  // WebRTC Signaling: ICE Candidate
  socket.on('webrtc:ice-candidate', (data) => {
    if (data.toAdmin) {
      io.to('admin-room').emit('webrtc:ice-candidate', {
        employeeId: data.employeeId,
        candidate: data.candidate
      });
    } else if (data.to) {
      io.to(data.to).emit('webrtc:ice-candidate', {
        candidate: data.candidate
      });
    }
  });

  socket.on('exam:frame', (data) => {
    io.to('admin-room').emit('exam:frame-update', data);
  });

  socket.on('exam:submit', (data) => {
    io.to('admin-room').emit('exam:completed', data);
  });

  socket.on('candidate-frame', (data) => {
    io.to('admin-room').emit('admin-live-frame', data);
  });

  socket.on('violation:detected', (data) => {
    io.to('admin-room').emit('violation:alert', data);
  });

  socket.on('heartbeat', () => {
    socket.emit('heartbeat-ack');
  });

  socket.on('disconnect', () => {
    for (const [empId, sData] of activeSockets.entries()) {
      if (sData.socketId === socket.id) {
        activeSockets.delete(empId);
        break;
      }
    }
    io.to('admin-room').emit('exam:employee-disconnected', { socketId: socket.id });
  });
});

  // ── Debug: see exactly what's in in-memory DB right now ─────
  app.get('/api/debug-db', protect, adminOnly, async (req, res) => {
    try {
      const { querySheets } = require('./services/googleSheets');
      const dbRes = await querySheets('getDatabase');
      const db = dbRes.data || {};
      const empSample = (db.employees || []).slice(0, 3).map(e => ({
        _id: e._id, role: e.role, fullName: e.fullName, isActive: e.isActive
      }));
      res.json({
        success: true,
        sheetsUrl: process.env.GOOGLE_SHEET_URL ? '✅ set' : '❌ MISSING',
        counts: {
          employees:   db.employees?.length   || 0,
          assessments: db.assessments?.length || 0,
          questions:   db.questions?.length   || 0,
          results:     db.results?.length     || 0,
          violations:  db.violations?.length  || 0,
        },
        employeeSample: empSample,
        roleBreakdown: {
          employee: (db.employees||[]).filter(e => e.role === 'employee').length,
          admin:    (db.employees||[]).filter(e => (e.role || '').toLowerCase() === 'admin').length,
        }
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ── Test Google Sheets connectivity ─────────────────────────
  app.get('/api/test-sheets', protect, adminOnly, async (req, res) => {
    const SHEETS_URL = process.env.GOOGLE_SHEET_URL;
    if (!SHEETS_URL) return res.json({ success: false, message: 'GOOGLE_SHEET_URL not set' });
    try {
      const url = new URL(SHEETS_URL);
      url.searchParams.set('action', 'getDatabase');
      const r = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
      const text = await r.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 300) }; }
      res.json({ success: true, status: r.status, url: SHEETS_URL, response: parsed });
    } catch (err) {
      res.json({ success: false, url: SHEETS_URL, error: err.message });
    }
  });

  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

startServer();
