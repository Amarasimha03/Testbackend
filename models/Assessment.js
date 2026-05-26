const mongoose = require('../utils/localCache');

const assessmentSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String },
  duration: { type: Number, required: true }, // in minutes
  timePerQuestion: { type: Number, default: 30 }, // in seconds
  passingScore: { type: Number, default: 60 }, // percentage
  totalMarks: { type: Number, default: 0 },
  questions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
  assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  scheduledStart: { type: Date },
  scheduledEnd: { type: Date },
  isRandomized: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  status: { type: String, enum: ['draft', 'scheduled', 'active', 'completed'], default: 'draft' },
  allowRetake: { type: Boolean, default: false },
  maxViolations: { type: Number, default: 3 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  category: { type: String, default: 'General' },
}, { timestamps: true });
// Model export

module.exports = mongoose.model('Assessment', assessmentSchema);
