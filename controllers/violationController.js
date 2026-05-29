const { querySheets } = require('../services/googleSheets');

exports.logViolation = async (req, res) => {
  try {
    const { assessmentId, resultId, type, description, severity } = req.body;
    
    const deviceInfo = { browser: req.headers['user-agent'] || '', ip: req.ip || '' };
    
    const violationData = {
      _id: Date.now().toString(),
      employeeId: req.user.employeeId || req.user._id,
      employeeMongoId: req.user._id,
      employeeName: req.user.fullName || '',
      assessmentId: assessmentId || '',
      resultId: resultId || '',
      type: type || '',
      description: description || '',
      severity: severity || 'medium',
      timestamp: new Date().toISOString(),
      deviceInfo: JSON.stringify(deviceInfo)
    };

    await querySheets('addViolation', violationData);

    // Fetch result to check max violations
    const resRes = await querySheets('getResults');
    const result = (resRes.data || []).find(r => String(r._id) === String(resultId));
    let autoSubmit = false;
    let newCount = (parseInt(result?.violationCount) || 0) + 1;

    if (result) {
      const assRes = await querySheets('getAssessments');
      const assessment = (assRes.data || []).find(a => String(a._id) === String(assessmentId));
      
      const maxV = parseInt(assessment?.maxViolations) || 0;
      
      let updateData = { _id: resultId, violationCount: newCount };

      let sm = {};
      try { sm = typeof result.screenMonitoring === 'string' ? JSON.parse(result.screenMonitoring) : (result.screenMonitoring || {}); } catch(e){}
      
      if (type === 'tab-switch') sm.tabSwitchCount = (sm.tabSwitchCount || 0) + 1;
      else if (type === 'focus-loss') sm.focusLossCount = (sm.focusLossCount || 0) + 1;
      else if (['no-face', 'multiple-persons', 'multiple-faces'].includes(type)) sm.faceDetectionAlerts = (sm.faceDetectionAlerts || 0) + 1;
      else if (type === 'audio-noise') sm.audioAlerts = (sm.audioAlerts || 0) + 1;
      
      updateData.screenMonitoring = sm;

      if (maxV > 0 && newCount >= maxV) {
        updateData.status = 'disqualified';
        updateData.autoSubmitReason = 'violations';
        autoSubmit = true;
      }
      
      // Update result via submitResult or updateResult? 
      // Code.gs doesn't have an updateResult explicitly, but it has saveViolation which we just did, 
      // wait, Code.gs 'submitResult' can update it. Let's use submitResult but just patch.
      // But submitResult calculates scores. We might just pass status='disqualified' and Code.gs can patch.
      // Or we can add an updateResult to Code.gs if it fails. 
      // Actually submitResult handles partial updates if we pass partial data? 
      // Code.gs submitResult requires full answers object to calculate score.
      // Since this is just monitoring, we can pass it.
      await querySheets('submitResult', { ...result, ...updateData });
    }

    const io = req.app.get('io');
    if (io) {
      io.to('admin-room').emit('violation:alert', {
        employeeId: req.user._id, employeeName: req.user.fullName,
        assessmentId, type, description, severity, timestamp: new Date(), autoSubmit
      });
    }

    res.status(201).json({ success: true, violation: violationData, autoSubmit, violationCount: newCount });
  } catch (err) {
    console.error('[logViolation] ERROR:', err);
    res.status(500).json({ success: false, message: err.message, error: err.message });
  }
};

exports.getViolations = async (req, res) => {
  try {
    const { assessmentId, employeeId } = req.query;
    
    const vRes = await querySheets('getViolations');
    let violations = vRes.data || [];
    
    if (assessmentId) violations = violations.filter(v => String(v.assessmentId) === String(assessmentId) || String(v.assessment) === String(assessmentId));
    if (employeeId) violations = violations.filter(v => String(v.employeeMongoId) === String(employeeId) || String(v.employee) === String(employeeId));
    
    const empRes = await querySheets('getEmployees');
    const employees = empRes.data || [];
    const assRes = await querySheets('getAssessments');
    const assessments = assRes.data || [];

    const mapped = violations.map(v => {
      const e = employees.find(e => String(e._id) === String(v.employeeMongoId || v.employee));
      const a = assessments.find(a => String(a._id) === String(v.assessmentId || v.assessment));
      return {
        ...v,
        employee: e ? { _id: e._id, fullName: e.fullName, email: e.email, department: e.department } : { _id: v.employeeMongoId, fullName: v.employeeName || 'Unknown' },
        assessment: a ? { _id: a._id, title: a.title } : v.assessmentId
      };
    }).sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

    res.json({ success: true, violations: mapped });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getViolationStats = async (req, res) => {
  try {
    const vRes = await querySheets('getViolations');
    const violations = vRes.data || [];
    
    const map = {};
    for (const v of violations) {
      if (!map[v.type]) map[v.type] = 0;
      map[v.type]++;
    }
    
    const stats = Object.keys(map).map(k => ({ _id: k, count: map[k] })).sort((a, b) => b.count - a.count);
    res.json({ success: true, stats });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
