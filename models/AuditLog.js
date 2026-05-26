const mongoose = require('../utils/localCache');

const auditLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  action: {
    type: String,
    enum: [
      'login', 'logout', 'login-failed',
      'assessment-created', 'assessment-updated', 'assessment-deleted',
      'employee-created', 'employee-updated', 'employee-deactivated',
      'question-created', 'question-updated', 'question-deleted',
      'exam-started', 'exam-submitted', 'exam-auto-submitted', 'exam-disqualified',
      'violation-logged',
      'report-exported', 'report-viewed',
      'password-reset', 'profile-updated',
      'resume-uploaded',
      'other'
    ],
    required: true,
  },
  description: { type: String },
  targetModel: { type: String }, // e.g. 'Employee', 'Assessment', 'Result'
  targetId: { type: mongoose.Schema.Types.ObjectId },
  metadata: { type: mongoose.Schema.Types.Mixed }, // extra context
  ip: { type: String },
  userAgent: { type: String },
}, { timestamps: true });

auditLogSchema.index({ user: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
