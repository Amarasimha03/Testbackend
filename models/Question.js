const mongoose = require('../utils/localCache');

const questionSchema = new mongoose.Schema({
  title: { type: String, required: true },
  type: { type: String, enum: ['mcq', 'multiple-select', 'true-false', 'coding'], required: true },
  options: [{ text: String, isCorrect: { type: Boolean, default: false } }],
  correctAnswer: { type: mongoose.Schema.Types.Mixed }, // for true/false
  marks: { type: Number, default: 1 },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
  explanation: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  assessment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment' },
}, { timestamps: true });

module.exports = mongoose.model('Question', questionSchema);
