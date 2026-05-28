// ── Load .env first (override:true ensures .env wins over Render dashboard defaults) ─
require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

// ── Hardcoded fallbacks — only used if NOT set in .env OR Render dashboard ─────────
const GOOGLE_SHEET_URL_DEFAULT = 'https://script.google.com/macros/s/AKfycbzhAH4jIu3GopFZ0jMzPSpi-W7tmYIMwDYuc4KFg0Fl7dpjgnFfRgVM5Jnp1Z_-L_l3-A/exec';
process.env.JWT_SECRET        = process.env.JWT_SECRET        || 'onlinetest_jwt_secret_2024_secure_key';
process.env.JWT_EXPIRES_IN    = process.env.JWT_EXPIRES_IN    || '7d';
process.env.ADMIN_EMAIL       = process.env.ADMIN_EMAIL       || 'admin@gmail.com';
process.env.ADMIN_PASSWORD    = process.env.ADMIN_PASSWORD    || 'Admin123';
process.env.NODE_ENV          = process.env.NODE_ENV          || 'production';
process.env.GOOGLE_SHEET_URL  = process.env.GOOGLE_SHEET_URL  || GOOGLE_SHEET_URL_DEFAULT;

const express = require('express');
const cors = require('cors');
const localCache = require('./utils/localCache');
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
      process.env.CLIENT_URL || "https://onlinetest-vpb4.onrender.com"
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
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Initialize DB from Google Sheets BEFORE accepting any requests
async function startServer() {
  try {
    await localCache.connect();
    const { readDB } = require('./utils/localCache');
    const db = readDB();
    console.log(`✅ Google Sheets DB loaded — employees: ${db.employees?.length||0}, questions: ${db.questions?.length||0}, assessments: ${db.assessments?.length||0}, results: ${db.results?.length||0}, violations: ${db.violations?.length||0}, auditlogs: ${db.auditLogs?.length||0}`);
  } catch (err) {
    console.error('❌ DB connect failed, using seed-only state:', err.message);
  }

  // Auto sync Google Sheets every 10 seconds
  setInterval(async () => {
    try {
      await localCache.connect(true);
    } catch (err) {
      console.error('❌ Auto sync failed:', err.message);
    }
  }, 10000);

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

// ── Force-reload data from Google Sheets (admin only) ────────────
app.post('/api/sync-db', protect, adminOnly, async (req, res) => {
  try {
    await localCache.connect(true);
    const { readDB, writeDB } = require('./utils/localCache');
    const db = readDB();

    // Dedup employees by email — sheet entry wins over seed when emails match
    // This fixes the 5-vs-4 employee count when admin appears in both seed and sheet
    const seen = new Map();
    db.employees.forEach(e => {
      const key = (e.email || '').toLowerCase().trim();
      if (key) seen.set(key, e); // later entry (sheet) overwrites earlier (seed)
    });
    db.employees = Array.from(seen.values());
    writeDB(db);

    res.json({
      success: true,
      message: 'Database reloaded from Google Sheets (deduped)',
      counts: {
        employees:   db.employees?.length   || 0,
        assessments: db.assessments?.length || 0,
        questions:   db.questions?.length   || 0,
        results:     db.results?.length     || 0,
        violations:  db.violations?.length  || 0,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DB Status (admin only) ────────────────────────────────────
app.get('/api/db-status', protect, adminOnly, (req, res) => {
  const { readDB } = require('./utils/localCache');
  const db = readDB();
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
});


app.post('/api/submit-exam', protect, async (req, res) => {
  try {
    const { employeeId, reason, resultId } = req.body;
    const Result = require('./models/Result');
    const Employee = require('./models/Employee');
    const Assessment = require('./models/Assessment');
    const AuditLog = require('./models/AuditLog');
    const { persistEntity } = require('./utils/localCache');

    let result;
    if (resultId) {
      result = await Result.findById(resultId);
    } else {
      result = await Result.findOne({ employee: employeeId || req.user._id, status: 'in-progress' });
    }

    if (!result) {
      return res.status(404).json({ success: false, message: 'Active exam result not found' });
    }

    const assessment = await Assessment.findById(result.assessment).populate('questions');
    let totalScore = 0;
    let correctAnswersCount = 0;
    let wrongAnswersCount = 0;
    let processedAnswers = [];

    if (req.body.answers && Array.isArray(req.body.answers)) {
      processedAnswers = req.body.answers.map(ans => {
        const question = assessment.questions.find(q => q._id.toString() === ans.questionId);
        if (!question) return ans;
        let isCorrect = false;
        let marksObtained = 0;
        let correctAnswerText = '';
        let selectedAnswerText = '';

        const optionsText = question.options.map(o => o.text);
        
        if (question.type === 'mcq' || question.type === 'true-false') {
          const correctIdx = question.options.findIndex(o => o.isCorrect);
          isCorrect = ans.selectedOptions?.[0] === correctIdx;
          if (isCorrect) marksObtained = question.marks;
          correctAnswerText = question.options[correctIdx]?.text || '';
          selectedAnswerText = (ans.selectedOptions && ans.selectedOptions.length > 0) ? question.options[ans.selectedOptions[0]]?.text : 'Not Attempted';
        } else if (question.type === 'multiple-select') {
          const correctIdxs = question.options.map((o, i) => o.isCorrect ? i : null).filter(i => i !== null);
          isCorrect = JSON.stringify(ans.selectedOptions?.sort()) === JSON.stringify(correctIdxs.sort());
          if (isCorrect) marksObtained = question.marks;
          correctAnswerText = correctIdxs.map(i => question.options[i]?.text).join(', ');
          selectedAnswerText = (ans.selectedOptions && ans.selectedOptions.length > 0) ? ans.selectedOptions.map(i => question.options[i]?.text).join(', ') : 'Not Attempted';
        }

        totalScore += marksObtained;
        return { 
          question: ans.questionId, 
          questionText: question.title,
          options: optionsText,
          selectedOptions: ans.selectedOptions, 
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
      correctAnswersCount = result.answers ? result.answers.filter(a => a.isCorrect).length : 0;
      wrongAnswersCount = result.answers ? (result.answers.length - correctAnswersCount) : 0;
    }

    // Determine if this is a user-initiated cancellation
    const isUserCancelled = reason && reason.toLowerCase().includes('user cancelled');
    
    result.status = isUserCancelled ? 'cancelled' : 'auto-submitted';
    result.submittedAt = new Date();
    result.completionTime = Math.round((result.submittedAt - result.startedAt) / 60000);
    result.autoSubmitReason = reason || 'Camera Violations';
    await result.save();

    // Update in-memory DB
    const resIdx = IN_MEMORY_DB.results.findIndex(r => r._id.toString() === result._id.toString());
    if (resIdx !== -1) IN_MEMORY_DB.results[resIdx] = result.toObject();

    const employee = await Employee.findById(result.employee);

    // Persist final result to Google Sheets
    persistEntity('submitResult', {
      _id:             result._id.toString(),
      employeeId:      employee ? (employee.employeeId || employee._id.toString()) : '',
      employeeMongoId: result.employee.toString(),
      employeeName:    employee ? employee.fullName : '',
      employeeEmail:   employee ? employee.email : '',
      assessmentId:    result.assessment.toString(),
      assessmentTitle: assessment ? assessment.title : 'Exam',
      totalScore:      result.totalScore,
      totalMarks:      result.totalMarks,
      percentage:      result.percentage,
      passed:          result.passed,
      status:          result.status,
      violationCount:  result.violationCount || 0,
      completionTime:  result.completionTime || 0,
      startedAt:       result.startedAt ? result.startedAt.toISOString() : '',
      submittedAt:     result.submittedAt ? result.submittedAt.toISOString() : '',
      cancelTime:      isUserCancelled ? new Date().toISOString() : '',
      autoSubmitReason:result.autoSubmitReason || '',
      submissionType:  isUserCancelled ? 'User Cancelled' : 'Automatic',
      correctAnswers:  correctAnswersCount,
      wrongAnswers:    wrongAnswersCount,
      answers:         JSON.stringify(result.answers || []),
    });

    // Save violation specifically to Google Sheets using saveViolation
    persistEntity('saveViolation', {
      employeeId:      employee ? (employee.employeeId || employee._id.toString()) : '',
      name:            employee ? employee.fullName : '',
      warningCount:    result.violationCount || (isUserCancelled ? 0 : 4),
      reason:          reason || 'Camera Violations',
    });

    // Notify admin
    const io = req.app.get('io');
    if (io) {
      io.to('admin-room').emit('exam:completed', {
        employeeId: result.employee.toString(),
        assessmentId: result.assessment.toString(),
        terminationReason: reason || 'Camera Violations',
        status: result.status,
      });
    }

    const auditAction = isUserCancelled ? 'exam-cancelled' : 'exam-auto-submitted';
    const auditDesc = isUserCancelled
      ? `Exam cancelled by user. Reason: ${reason}`
      : `Exam auto-submitted due to: ${reason || 'Camera Violations'}`;

    await AuditLog.create({
      user: result.employee,
      action: auditAction,
      description: auditDesc,
      targetModel: 'Result',
      targetId: result._id,
    });

    res.json({ success: true, message: isUserCancelled ? 'Exam cancelled successfully' : 'Exam auto-submitted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


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
  cors: {
      origin: [
          process.env.CLIENT_URL || "https://onlinetest-vpb4.onrender.com"
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

  // Employee joins exam and notifies admin
  socket.on('exam:start', (data) => {
    const { employeeId, employeeName, examId } = data;
    socket.join(`exam-${employeeId}`);
    activeSockets.set(String(employeeId), { socketId: socket.id, examId });
    
    // Notify admin
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
    // data.to is the employee's socket ID
    io.to(data.to).emit('webrtc:answer', {
      answer: data.answer
    });
  });

  // WebRTC Signaling: ICE Candidate
  socket.on('webrtc:ice-candidate', (data) => {
    if (data.toAdmin) {
      // Send candidate from Employee to Admin
      io.to('admin-room').emit('webrtc:ice-candidate', {
        employeeId: data.employeeId,
        candidate: data.candidate
      });
    } else if (data.to) {
      // Send candidate from Admin to Employee
      io.to(data.to).emit('webrtc:ice-candidate', {
        candidate: data.candidate
      });
    }
  });

  // Fallback for older camera Active state, or handling disconnects
  socket.on('exam:frame', (data) => {
    // If we still use exam:frame for cameraActive status
    io.to('admin-room').emit('exam:frame-update', data);
  });

  socket.on('exam:submit', (data) => {
    io.to('admin-room').emit('exam:completed', data);
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
  app.get('/api/debug-db', protect, adminOnly, (req, res) => {
    const { readDB } = require('./utils/localCache');
    const db = readDB();
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
        admin:    (db.employees||[]).filter(e => e.role === 'admin').length,
        other:    (db.employees||[]).filter(e => e.role !== 'employee' && e.role !== 'admin').length,
      }
    });
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
