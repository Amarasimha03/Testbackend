const Violation = require('../models/Violation');
const Result = require('../models/Result');
const Assessment = require('../models/Assessment');
const AuditLog = require('../models/AuditLog');
const { persistEntity } = require('../utils/localCache');

exports.logViolation = async (req, res) => {
  try {
    const { assessmentId, resultId, type, description, severity } = req.body;
    const violation = await Violation.create({
      employee: req.user._id,
      assessment: assessmentId,
      result: resultId,
      type, description, severity: severity || 'medium',
      deviceInfo: {
        browser: req.headers['user-agent'] || '',
        ip: req.ip || '',
      },
    });

    // Increment violation count in result and update screen monitoring
    const updateOps = { $inc: { violationCount: 1 } };
    if (type === 'tab-switch') updateOps.$inc['screenMonitoring.tabSwitchCount'] = 1;
    else if (type === 'focus-loss') updateOps.$inc['screenMonitoring.focusLossCount'] = 1;
    else if (type === 'no-face' || type === 'multiple-persons' || type === 'multiple-faces') updateOps.$inc['screenMonitoring.faceDetectionAlerts'] = 1;
    else if (type === 'audio-noise') updateOps.$inc['screenMonitoring.audioAlerts'] = 1;

    const result = await Result.findByIdAndUpdate(resultId, updateOps, { new: true });
    const assessment = await Assessment.findById(assessmentId);
    let autoSubmit = false;
    if (result && assessment && result.violationCount >= assessment.maxViolations) {
      result.status = 'disqualified';
      result.autoSubmitReason = 'violations';
      await result.save();
      autoSubmit = true;

      // Audit disqualification
      await AuditLog.create({
        user: req.user._id, action: 'exam-disqualified',
        description: `Disqualified from "${assessment.title}" after ${result.violationCount} violations`,
        targetModel: 'Result', targetId: resultId,
        metadata: { violationCount: result.violationCount, lastViolationType: type },
      });
    }

    // Audit every violation
    await AuditLog.create({
      user: req.user._id, action: 'violation-logged',
      description: `Violation: ${type} — ${description}`,
      targetModel: 'Violation', targetId: violation._id,
      metadata: { assessmentId, type, severity },
    });

    // Emit to admin
    const io = req.app.get('io');
    if (io) {
      io.to('admin-room').emit('violation:alert', {
        employeeId: req.user._id, employeeName: req.user.fullName,
        assessmentId, type, description, severity, timestamp: new Date(), autoSubmit
      });
    }

    // Persist violation to Google Sheets (full payload)
    persistEntity('addViolation', {
      _id:             violation._id.toString(),
      employeeId:      req.user.employeeId || req.user._id.toString(),
      employeeMongoId: req.user._id.toString(),
      employeeName:    req.user.fullName || '',
      assessmentId:    assessmentId || '',
      resultId:        resultId || '',
      type:            type || '',
      description:     description || '',
      severity:        severity || 'medium',
      timestamp:       new Date().toISOString(),
    });

    res.status(201).json({ success: true, violation, autoSubmit, violationCount: result?.violationCount });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getViolations = async (req, res) => {
  try {
    const { assessmentId, employeeId } = req.query;
    const filter = {};
    if (assessmentId) filter.assessment = assessmentId;
    if (employeeId) filter.employee = employeeId;
    const violations = await Violation.find(filter)
      .populate('employee', 'fullName email department')
      .populate('assessment', 'title')
      .sort({ timestamp: -1 });
    res.json({ success: true, violations });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getViolationStats = async (req, res) => {
  try {
    const stats = await Violation.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    res.json({ success: true, stats });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
