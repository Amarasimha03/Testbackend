const mongoose = require('../utils/localCache');
const bcrypt = require('bcryptjs');

const loginHistorySchema = new mongoose.Schema({
  ip: { type: String },
  userAgent: { type: String },
  device: { type: String },
  loginAt: { type: Date, default: Date.now },
  logoutAt: { type: Date },
  sessionDuration: { type: Number }, // minutes
  status: { type: String, enum: ['success', 'failed'], default: 'success' },
}, { _id: false });

const employeeSchema = new mongoose.Schema({
  // Core Identity
  _id: { type: String },
  fullName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true },
  password: { type: String, required: true, minlength: 6, select: false },

  // Role & Permissions
  role: { type: String, enum: ['employee', 'admin'], default: 'employee' },
  permissions: {
    canCreateAssessment: { type: Boolean, default: false },
    canViewReports: { type: Boolean, default: false },
    canManageEmployees: { type: Boolean, default: false },
    canMonitorLive: { type: Boolean, default: false },
    canExportData: { type: Boolean, default: false },
  },

  // Company / Profile Details
  department: { type: String, default: 'General' },
  designation: { type: String, default: '' },
  employeeId: { type: String, default: '' },        // HR employee ID
  company: { type: String, default: '' },
  companyAddress: { type: String, default: '' },
  companyWebsite: { type: String, default: '' },
  profilePhoto: { type: String, default: '' },

  // Resume / Documents
  resume: {
    fileName: { type: String },
    fileUrl: { type: String },
    uploadedAt: { type: Date },
    fileSize: { type: Number },   // bytes
  },

  // Account Status
  isVerified: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  verificationToken: { type: String },
  otp: { type: String },
  otpExpires: { type: Date },

  // Session Tracking
  activeSession: { type: String, default: null },
  lastLogin: { type: Date },
  loginHistory: { type: [loginHistorySchema], default: [] },

  // Assessments
  assignedAssessments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Assessment' }],

  // Exam Status Summary (denormalized for quick access)
  examStats: {
    totalAttempts: { type: Number, default: 0 },
    totalPassed: { type: Number, default: 0 },
    totalFailed: { type: Number, default: 0 },
    avgScore: { type: Number, default: 0 },
    totalTimeTaken: { type: Number, default: 0 }, // minutes
  },
}, { timestamps: true });

// Unified Pre-save Hook: Hashes password and sets admin permissions
employeeSchema.pre('save', async function () {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  if (this.role === 'admin') {
    this.permissions = {
      canCreateAssessment: true,
      canViewReports: true,
      canManageEmployees: true,
      canMonitorLive: true,
      canExportData: true,
    };
  }
});

employeeSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

employeeSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.verificationToken;
  delete obj.otp;
  return obj;
};

module.exports = mongoose.model('Employee', employeeSchema);
