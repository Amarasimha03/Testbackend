// ── Load .env first (override:true ensures .env wins over Render dashboard defaults) ─
require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

// ── Hardcoded fallbacks — only used if NOT set in .env OR Render dashboard ─────────
const GOOGLE_SHEET_URL_DEFAULT = 'https://script.google.com/macros/s/AKfycbx3AnqjtgZDFUYc3XrRNmvMIpfjQKcenuySRcRzzJf5DUVfRNs6CPAOE8_Yy8OmxJpZfg/exec';
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

const app = express();

// CORS helper for localhost dev ports and dotenv config URL
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:3004',
  'http://localhost:3005',
];
if (process.env.CLIENT_URL) {
  allowedOrigins.push(process.env.CLIENT_URL);
}
const checkOrigin = (origin, callback) => {
  if (!origin) return callback(null, true);
  const isAllowed =
    allowedOrigins.includes(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ||
    /^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin) ||
    /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/.test(origin) ||
    /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:\d+$/.test(origin) ||
    origin.endsWith('.netlify.app') ||
    origin.endsWith('.onrender.com') ||
    origin === 'https://cabonlinetest.netlify.app';
  if (isAllowed) {
    callback(null, origin || '*');
  } else {
    callback(new Error('Not allowed by CORS'));
  }
};

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000, // high limit for testing
  message: 'Too many requests, please try again later.',
});

app.use(cors({ origin: checkOrigin, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/api', limiter);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Initialize high‑speed local cache
localCache
  .connect()
  .then(() => console.log('✅ Server Local Cache Initialized'))
  .catch((err) => console.error('❌ Cache Error:', err));

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

const { protect, adminOnly } = require('./middleware/auth');

// ── Force-reload data from Google Sheets (admin only) ────────
app.post('/api/sync-db', protect, adminOnly, async (req, res) => {
  try {
    await localCache.connect();
    const { readDB } = require('./utils/localCache');
    const db = readDB();
    res.json({
      success: true,
      message: 'Database reloaded from Google Sheets',
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

    const assessment = await Assessment.findById(result.assessment);

    result.status = 'auto-submitted';
    result.submittedAt = new Date();
    result.completionTime = Math.round((result.submittedAt - result.startedAt) / 60000);
    result.autoSubmitReason = reason || 'Camera Violations';
    await result.save();

    const employee = await Employee.findById(result.employee);

    const correctAnswersCount = result.answers ? result.answers.filter(a => a.isCorrect).length : 0;
    const wrongAnswersCount = result.answers ? (result.answers.length - correctAnswersCount) : 0;

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
      autoSubmitReason:result.autoSubmitReason || '',
      submissionType:  'Automatic',
      correctAnswers:  correctAnswersCount,
      wrongAnswers:    wrongAnswersCount,
      answers:         JSON.stringify(result.answers || []),
    });

    // Save violation specifically to Google Sheets using saveViolation
    persistEntity('saveViolation', {
      employeeId:      employee ? (employee.employeeId || employee._id.toString()) : '',
      name:            employee ? employee.fullName : '',
      warningCount:    result.violationCount || 4,
      reason:          reason || 'Camera Violations',
    });

    // Notify admin
    const io = req.app.get('io');
    if (io) {
      io.to('admin-room').emit('exam:completed', {
        employeeId: result.employee.toString(),
        assessmentId: result.assessment.toString(),
        terminationReason: reason || 'Camera Violations',
      });
    }

    await AuditLog.create({
      user: result.employee,
      action: 'exam-auto-submitted',
      description: `Exam auto-submitted due to: ${reason || 'Camera Violations'}`,
      targetModel: 'Result',
      targetId: result._id,
    });

    res.json({ success: true, message: 'Exam auto-submitted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


app.get('/api/health', (req, res) =>
  res.json({ status: 'OK', timestamp: new Date().toISOString() })
);

// Serve Static Assets from React app build in production
const clientBuildPath = path.join(__dirname, 'build');
app.use(express.static(clientBuildPath));

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
    origin: checkOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'], // polling fallback for restricted networks
  maxHttpBufferSize: 1e8,
  pingTimeout: 60000,
  pingInterval: 25000,
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

  // Employee joins exam and notifies admin
  socket.on('exam:start', (data) => {
    const { employeeId, employeeName, examId } = data;
    socket.join(`exam-${employeeId}`);
    activeSockets.set(String(employeeId), socket.id);
    
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
    for (const [empId, sId] of activeSockets.entries()) {
      if (sId === socket.id) {
        activeSockets.delete(empId);
        break;
      }
    }
    io.to('admin-room').emit('exam:employee-disconnected', { socketId: socket.id });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
