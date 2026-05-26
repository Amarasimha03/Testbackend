const mongoose = require('../utils/localCache');

const resultSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  assessment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment', required: true },
  answers: [{
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question' },
    selectedOptions: [Number],
    selectedAnswer: mongoose.Schema.Types.Mixed,
    isCorrect: { type: Boolean, default: false },
    marksObtained: { type: Number, default: 0 },
    timeTaken: { type: Number, default: 0 }, // seconds per question
  }],
  totalScore: { type: Number, default: 0 },
  totalMarks: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },
  passed: { type: Boolean, default: false },
  status: { type: String, enum: ['in-progress', 'submitted', 'auto-submitted', 'disqualified'], default: 'in-progress' },
  startedAt: { type: Date, default: Date.now },
  submittedAt: { type: Date },
  completionTime: { type: Number }, // minutes
  violationCount: { type: Number, default: 0 },
  rank: { type: Number },

  // Screen Monitoring Records
  screenMonitoring: {
    webcamEnabled: { type: Boolean, default: false },
    audioEnabled: { type: Boolean, default: false },
    fullscreenEnforced: { type: Boolean, default: true },
    tabSwitchCount: { type: Number, default: 0 },
    focusLossCount: { type: Number, default: 0 },
    faceDetectionAlerts: { type: Number, default: 0 },
    audioAlerts: { type: Number, default: 0 },
  },

  // Device/Browser info at exam time
  deviceInfo: {
    browser: { type: String },
    os: { type: String },
    ip: { type: String },
    screenResolution: { type: String },
  },

  // Auto-submit reason
  autoSubmitReason: { type: String, enum: ['timeout', 'violations', 'admin-action', null], default: null },
}, { timestamps: true });

// Indexes for fast queries
resultSchema.index({ employee: 1, assessment: 1 });
resultSchema.index({ assessment: 1, percentage: -1 });

module.exports = mongoose.model('Result', resultSchema);
