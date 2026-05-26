const Assessment = require('../models/Assessment');
const Question = require('../models/Question');
const Result = require('../models/Result');
const Employee = require('../models/Employee');
const AuditLog = require('../models/AuditLog');
const { persistEntity } = require('../utils/localCache');

// GET all assessments (admin)
exports.getAssessments = async (req, res) => {
  try {
    const assessments = await Assessment.find()
      .populate('createdBy', 'fullName email')
      .populate('questions')
      .sort({ createdAt: -1 });
    res.json({ success: true, assessments });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET employee's assigned assessments
exports.getMyAssessments = async (req, res) => {
  try {
    const employee = await Employee.findById(req.user._id).populate('assignedAssessments');
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    const results = await Result.find({ employee: req.user._id });
    const completedIds = results
      .filter(r => r.status !== 'in-progress')
      .map(r => r.assessment ? r.assessment.toString() : '');

    const rawAssessments = employee.assignedAssessments || [];

    const assessments = rawAssessments.map(a => {
      const plain = typeof a.toObject === 'function' ? a.toObject() : { ...a };
      const aId = (plain._id || a._id || '').toString();
      return {
        ...plain,
        status: completedIds.includes(aId) ? 'completed' : 'pending',
        result: results.find(r => r.assessment && r.assessment.toString() === aId) || null,
      };
    });

    res.json({ success: true, assessments });
  } catch (err) {
    console.error('GET MY ASSESSMENTS ERROR:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET single assessment
exports.getAssessment = async (req, res) => {
  try {
    const assessment = await Assessment.findById(req.params.id).populate('questions');
    if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });
    if (req.user.role === 'employee') {
      let questions = assessment.questions;
      if (assessment.isRandomized) questions = questions.sort(() => Math.random() - 0.5);
      const sanitized = questions.map(q => ({
        _id: q._id, title: q.title, type: q.type,
        options: q.options.map(o => ({ _id: o._id, text: o.text })),
        marks: q.marks, difficulty: q.difficulty,
      }));
      return res.json({ success: true, assessment: { ...assessment.toObject(), questions: sanitized } });
    }
    res.json({ success: true, assessment });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST create assessment
exports.createAssessment = async (req, res) => {
  try {
    const assessment = new Assessment({ ...req.body, createdBy: req.user._id });
    const employees = await Employee.find({ role: 'employee', isActive: true });
    const employeeIds = employees.map(emp => emp._id);
    assessment.assignedTo = employeeIds;
    await assessment.save();

    if (employeeIds.length > 0) {
      await Employee.updateMany(
        { _id: { $in: employeeIds } },
        { $addToSet: { assignedAssessments: assessment._id } }
      );

      // Persist assignment records to Google Sheets (one per employee)
      for (const emp of employees) {
        persistEntity('assignAssessment', {
          employeeId:      emp.employeeId || emp._id.toString(),
          employeeMongoId: emp._id.toString(),
          assessmentId:    assessment._id.toString(),
          examName:        assessment.title,
          status:          'pending',
          assignedBy:      req.user ? req.user.fullName : 'Admin',
        });

        // Real-time socket notification to the employee
        if (global.io) {
          global.io.to(`exam-${emp._id}`).emit(`notification:${emp._id}`, {
            title: 'New Exam Assigned',
            message: `You have been assigned: "${assessment.title}"`,
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    // Persist assessment itself to Google Sheets
    persistEntity('createAssessment', {
      _id:          assessment._id.toString(),
      title:        assessment.title,
      description:  assessment.description || '',
      duration:     assessment.duration,
      passingScore: assessment.passingScore,
      category:     assessment.category || 'General',
      status:       assessment.status,
      maxViolations:assessment.maxViolations,
      isRandomized: assessment.isRandomized,
      questions:    JSON.stringify([]),
      assignedTo:   JSON.stringify(employeeIds.map(String)),
      createdBy:    req.user._id.toString(),
    });

    // Audit
    await AuditLog.create({
      user: req.user._id, action: 'assessment-created',
      description: `Assessment created: "${assessment.title}" and assigned to ${employeeIds.length} employees`,
      targetModel: 'Assessment', targetId: assessment._id,
      metadata: { assignedCount: employeeIds.length, category: assessment.category },
    });

    res.status(201).json({ success: true, assessment });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// PUT update assessment
exports.updateAssessment = async (req, res) => {
  try {
    const assessment = await Assessment.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });

    if (assessment.status === 'active' || assessment.status === 'scheduled') {
      const employees = await Employee.find({ role: 'employee', isActive: true });
      const employeeIds = employees.map(emp => emp._id);
      assessment.assignedTo = employeeIds;
      await assessment.save();
      await Employee.updateMany(
        { _id: { $in: employeeIds } },
        { $addToSet: { assignedAssessments: assessment._id } }
      );

      for (const emp of employees) {
        persistEntity('assignAssessment', {
          employeeId:      emp.employeeId || emp._id.toString(),
          employeeMongoId: emp._id.toString(),
          assessmentId:    assessment._id.toString(),
          examName:        assessment.title,
          status:          'pending',
          assignedBy:      req.user ? req.user.fullName : 'Admin',
        });

        // Real-time socket notification to the employee of an update
        if (global.io) {
          global.io.to(`exam-${emp._id}`).emit(`notification:${emp._id}`, {
            title: 'Exam Updated',
            message: `Exam "${assessment.title}" has been updated.`,
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    // Persist updated assessment
    persistEntity('updateAssessment', {
      _id:          assessment._id.toString(),
      title:        assessment.title,
      description:  assessment.description || '',
      duration:     assessment.duration,
      passingScore: assessment.passingScore,
      category:     assessment.category || 'General',
      status:       assessment.status,
      maxViolations:assessment.maxViolations,
    });

    await AuditLog.create({
      user: req.user._id, action: 'assessment-updated',
      description: `Assessment updated: "${assessment.title}"`,
      targetModel: 'Assessment', targetId: assessment._id,
    });

    res.json({ success: true, assessment });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// DELETE assessment
exports.deleteAssessment = async (req, res) => {
  try {
    const assessment = await Assessment.findByIdAndDelete(req.params.id);
    await Question.deleteMany({ assessment: req.params.id });
    if (assessment) {
      await AuditLog.create({
        user: req.user._id, action: 'assessment-deleted',
        description: `Assessment deleted: "${assessment.title}"`,
        targetModel: 'Assessment', targetId: req.params.id,
      });
    }
    res.json({ success: true, message: 'Assessment and its questions deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST start exam (create result record)
exports.startExam = async (req, res) => {
  try {
    const { assessmentId } = req.body;
    const existing = await Result.findOne({ employee: req.user._id, assessment: assessmentId, status: 'in-progress' });
    if (existing) return res.json({ success: true, result: existing });

    const assessment = await Assessment.findById(assessmentId).populate('questions');
    if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });

    const result = await Result.create({
      employee: req.user._id,
      assessment: assessmentId,
      totalMarks: assessment.questions.reduce((sum, q) => sum + q.marks, 0),
      startedAt: new Date(),
      screenMonitoring: {
        webcamEnabled: true,
        audioEnabled: true,
        fullscreenEnforced: true,
      },
      deviceInfo: {
        browser: req.headers['user-agent'] || '',
        ip: req.ip || '',
      },
    });

    // Persist exam start to Google Sheets
    persistEntity('startExam', {
      _id:             result._id.toString(),
      employeeId:      req.user.employeeId || req.user._id.toString(),
      employeeMongoId: req.user._id.toString(),
      employeeName:    req.user.fullName || '',
      employeeEmail:   req.user.email || '',
      assessmentId:    assessmentId,
      assessmentTitle: assessment.title,
      startedAt:       result.startedAt ? result.startedAt.toISOString() : new Date().toISOString(),
    });

    await AuditLog.create({
      user: req.user._id, action: 'exam-started',
      description: `Started exam: "${assessment.title}"`,
      targetModel: 'Result', targetId: result._id,
    });

    res.status(201).json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST submit exam
exports.submitExam = async (req, res) => {
  try {
    const { resultId, answers } = req.body;
    const result = await Result.findById(resultId);
    if (!result) return res.status(404).json({ success: false, message: 'Result not found' });

    const assessment = await Assessment.findById(result.assessment).populate('questions');
    let totalScore = 0;

    const processedAnswers = answers.map(ans => {
      const question = assessment.questions.find(q => q._id.toString() === ans.questionId);
      if (!question) return ans;
      let isCorrect = false;
      let marksObtained = 0;
      if (question.type === 'mcq' || question.type === 'true-false') {
        const correctIdx = question.options.findIndex(o => o.isCorrect);
        isCorrect = ans.selectedOptions?.[0] === correctIdx;
        if (isCorrect) marksObtained = question.marks;
      } else if (question.type === 'multiple-select') {
        const correctIdxs = question.options.map((o, i) => o.isCorrect ? i : null).filter(i => i !== null);
        isCorrect = JSON.stringify(ans.selectedOptions?.sort()) === JSON.stringify(correctIdxs.sort());
        if (isCorrect) marksObtained = question.marks;
      }
      totalScore += marksObtained;
      return { question: ans.questionId, selectedOptions: ans.selectedOptions, isCorrect, marksObtained, timeTaken: ans.timeTaken || 0 };
    });

    result.answers = processedAnswers;
    result.totalScore = totalScore;
    result.percentage = Math.round((totalScore / result.totalMarks) * 100);
    result.passed = result.percentage >= assessment.passingScore;
    result.status = req.body.autoSubmit ? 'auto-submitted' : 'submitted';
    result.submittedAt = new Date();
    result.completionTime = Math.round((result.submittedAt - result.startedAt) / 60000);
    result.autoSubmitReason = req.body.terminationReason || (req.body.autoSubmit ? 'violations' : null);
    await result.save();

    const correctAnswersCount = processedAnswers.filter(a => a.isCorrect).length;
    const wrongAnswersCount = processedAnswers.length - correctAnswersCount;
    const submissionType = req.body.autoSubmit ? 'Automatic' : 'Manual';

    // Persist final result to Google Sheets
    const employee = await Employee.findById(result.employee);
    persistEntity('submitResult', {
      _id:             result._id.toString(),
      employeeId:      employee ? (employee.employeeId || employee._id.toString()) : '',
      employeeMongoId: result.employee.toString(),
      employeeName:    employee ? employee.fullName : '',
      employeeEmail:   employee ? employee.email : '',
      assessmentId:    assessment._id.toString(),
      assessmentTitle: assessment.title,
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
      submissionType:  submissionType,
      correctAnswers:  correctAnswersCount,
      wrongAnswers:    wrongAnswersCount,
      answers:         JSON.stringify(processedAnswers),
    });

    // Update employee exam stats
    const allResults = await Result.find({
      employee: result.employee,
      status: { $in: ['submitted', 'auto-submitted'] },
    });
    const stats = {
      totalAttempts: allResults.length,
      totalPassed:   allResults.filter(r => r.passed).length,
      totalFailed:   allResults.filter(r => !r.passed).length,
      avgScore:      allResults.length ? Math.round(allResults.reduce((s, r) => s + r.percentage, 0) / allResults.length) : 0,
      totalTimeTaken:allResults.reduce((s, r) => s + (r.completionTime || 0), 0),
    };
    await Employee.findByIdAndUpdate(result.employee, { examStats: stats });

    // Persist updated employee stats
    if (employee) {
      persistEntity('updateEmployee', {
        _id:       result.employee.toString(),
        examStats: JSON.stringify(stats),
      });
    }

    const action = req.body.autoSubmit ? 'exam-auto-submitted' : 'exam-submitted';
    await AuditLog.create({
      user: result.employee, action,
      description: `Exam "${assessment.title}" ${action}: Score ${result.percentage}% - ${result.passed ? 'PASSED' : 'FAILED'}`,
      targetModel: 'Result', targetId: result._id,
      metadata: { percentage: result.percentage, passed: result.passed, completionTime: result.completionTime },
    });

    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET dashboard stats
exports.getDashboardStats = async (req, res) => {
  try {
    const [totalEmployees, totalAssessments, completedExams, results] = await Promise.all([
      Employee.countDocuments({ role: 'employee' }),
      Assessment.countDocuments(),
      Result.countDocuments({ status: { $in: ['submitted', 'auto-submitted'] } }),
      Result.find({ status: { $in: ['submitted', 'auto-submitted'] } }),
    ]);
    const avgScore = results.length ? Math.round(results.reduce((s, r) => s + r.percentage, 0) / results.length) : 0;
    res.json({ success: true, stats: { totalEmployees, totalAssessments, completedExams, avgScore } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST bulk assign exam to employees (with Socket.IO notification)
exports.bulkAssignExam = async (req, res) => {
  try {
    const { employeeIds } = req.body;
    const assessmentId = req.params.id;

    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No employees provided' });
    }

    const assessment = await Assessment.findById(assessmentId);
    if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });

    let assignedCount = 0;
    const assignedEmployees = [];
    for (const empId of employeeIds) {
      const emp = await Employee.findById(empId);
      if (!emp) continue;

      const alreadyAssigned = (emp.assignedAssessments || []).map(String).includes(String(assessmentId));
      if (!alreadyAssigned) {
        if (!emp.assignedAssessments) emp.assignedAssessments = [];
        emp.assignedAssessments.push(assessmentId);
        await emp.save();
      }

      const alreadyInList = (assessment.assignedTo || []).map(String).includes(String(empId));
      if (!alreadyInList) {
        if (!assessment.assignedTo) assessment.assignedTo = [];
        assessment.assignedTo.push(empId);
      }

      assignedCount++;
      assignedEmployees.push(emp);
    }

    await assessment.save();

    await AuditLog.create({
      user: req.user._id, action: 'exam-assigned',
      description: `Admin assigned exam "${assessment.title}" to ${assignedCount} employee(s)`,
      targetModel: 'Assessment', targetId: assessment._id,
    });

    // Socket.IO notifications
    const io = req.app.get('io');
    if (io) {
      for (const emp of assignedEmployees) {
        io.emit(`notification:${emp._id}`, {
          type: 'exam-assigned',
          title: 'New Exam Assigned!',
          message: `"${assessment.title}" has been assigned to you. Duration: ${assessment.duration} min.`,
          assessmentId: assessment._id,
          timestamp: new Date(),
        });
      }
      io.to('admin-room').emit('exam:bulk-assigned', {
        assessmentId, assessmentTitle: assessment.title,
        assignedCount, assignedBy: req.user.fullName,
        timestamp: new Date(),
      });
    }

    // Persist each assignment to Google Sheets
    for (const emp of assignedEmployees) {
      persistEntity('assignAssessment', {
        employeeId:      emp.employeeId || emp._id.toString(),
        employeeMongoId: emp._id.toString(),
        assessmentId:    assessment._id.toString(),
        examName:        assessment.title,
        status:          'pending',
        assignedBy:      req.user.fullName || 'Admin',
      });
    }

    res.json({ success: true, message: `Exam assigned to ${assignedCount} employee(s)`, assignedCount });
  } catch (err) {
    console.error('BULK ASSIGN ERROR:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
