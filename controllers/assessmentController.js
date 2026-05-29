const { querySheets } = require('../services/googleSheets');
const { clearCache } = require('../middleware/cache');

exports.getAssessments = async (req, res) => {
  try {
    const [resData, qRes] = await Promise.all([
      querySheets('getAssessments'),
      querySheets('getQuestions')
    ]);
    
    let assessments = resData.data || [];
    const allQuestions = qRes.data || [];
    
    assessments = assessments.map(a => {
      const aId = String(a._id);
      const matchedQuestions = allQuestions.filter(q => String(q.assessment) === aId || String(q.assessmentId) === aId);
      
      let assTo = [];
      try { assTo = typeof a.assignedTo === 'string' ? JSON.parse(a.assignedTo) : (a.assignedTo || []); } catch(e){}
      return { ...a, questions: matchedQuestions, assignedTo: assTo };
    });

    // Reverse sort by createdAt
    assessments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json({ success: true, assessments });
  } catch (err) { 
    res.status(500).json({ success: false, message: err.message }); 
  }
};

exports.getMyAssessments = async (req, res) => {
  try {
    const empRes = await querySheets('getEmployees');
    const employees = empRes.data || [];
    const employee = employees.find(e => String(e._id) === String(req.user._id));
    
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    const [resultRes, assRes, qRes] = await Promise.all([
      querySheets('getResults'),
      querySheets('getAssessments'),
      querySheets('getQuestions')
    ]);
    
    const allResults = resultRes.data || [];
    const myResults = allResults.filter(r => String(r.employeeMongoId || r.employee) === String(req.user._id));
    
    const completedIds = myResults
      .filter(r => r.status !== 'in-progress')
      .map(r => String(r.assessmentId || r.assessment || ''));

    // Employee's assigned assessments are stored as an array of IDs in 'assignedAssessments'
    let assignedIds = [];
    try {
      if (typeof employee.assignedAssessments === 'string') {
        assignedIds = JSON.parse(employee.assignedAssessments);
      } else if (Array.isArray(employee.assignedAssessments)) {
        assignedIds = employee.assignedAssessments;
      }
    } catch(e) {}

    const allAssessments = assRes.data || [];
    const allQuestions = qRes.data || [];
    
    const myAssessments = allAssessments.filter(a => {
      let assTo = [];
      try {
        if (typeof a.assignedTo === 'string') {
          assTo = JSON.parse(a.assignedTo);
        } else if (Array.isArray(a.assignedTo)) {
          assTo = a.assignedTo;
        }
      } catch (e) {}
      const assToMapped = assTo.map(String);
      return assignedIds.includes(String(a._id)) || assToMapped.includes(String(req.user._id));
    });

    const mapped = myAssessments.map(a => {
      const aId = String(a._id);
      const matchedQuestions = allQuestions.filter(q => String(q.assessment) === aId || String(q.assessmentId) === aId);

      // Get all results for this assessment, sort descending by _id (timestamp)
      const assessmentResults = myResults.filter(r => String(r.assessmentId || r.assessment) === aId);
      assessmentResults.sort((x, y) => String(y._id).localeCompare(String(x._id)));

      // Prefer completed/submitted result over in-progress
      const latestCompleted = assessmentResults.find(r => r.status !== 'in-progress');
      const chosenResult = latestCompleted || assessmentResults[0] || null;

      let parsedResult = null;
      if (chosenResult) {
        parsedResult = {
          ...chosenResult,
          totalScore: parseInt(chosenResult.totalScore, 10) || 0,
          totalMarks: parseInt(chosenResult.totalMarks, 10) || 0,
          percentage: parseInt(chosenResult.percentage, 10) || 0,
          passed: String(chosenResult.passed).toLowerCase() === 'true'
        };
      }

      return {
        ...a,
        questions: matchedQuestions,
        status: completedIds.includes(aId) ? 'completed' : 'pending',
        result: parsedResult,
      };
    });

    res.json({ success: true, assessments: mapped });
  } catch (err) {
    console.error('GET MY ASSESSMENTS ERROR:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getAssessment = async (req, res) => {
  try {
    const assRes = await querySheets('getAssessments');
    const allAssessments = assRes.data || [];
    const assessment = allAssessments.find(a => String(a._id) === String(req.params.id));
    
    if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });
    
    // Fetch questions
    const qRes = await querySheets('getQuestions', req.params.id ? { assessmentId: req.params.id } : {});
    const allQuestions = qRes.data || [];
    let questions = allQuestions.filter(q => String(q.assessment) === String(req.params.id) || String(q.assessmentId) === String(req.params.id));
    
    // Parse options correctly
    const parsedQuestions = questions.map(q => {
      if (typeof q.options === 'string') {
        try { q.options = JSON.parse(q.options); } catch(e) {}
      }
      if (Array.isArray(q.options) && q.options.length > 0 && typeof q.options[0] !== 'object') {
        const correctIdx = parseInt(q.correctOptionIndex !== undefined ? q.correctOptionIndex : 0, 10);
        q.options = q.options.map((opt, idx) => ({ text: String(opt), isCorrect: idx === correctIdx }));
      }
      if (!Array.isArray(q.options) || q.options.length === 0) {
        const opts = [];
        const correctIdx = parseInt(q.correctOptionIndex !== undefined ? q.correctOptionIndex : -1, 10);
        if (q.option1 !== undefined && q.option1 !== '') opts.push({ text: q.option1, isCorrect: correctIdx === 0 });
        if (q.option2 !== undefined && q.option2 !== '') opts.push({ text: q.option2, isCorrect: correctIdx === 1 });
        if (q.option3 !== undefined && q.option3 !== '') opts.push({ text: q.option3, isCorrect: correctIdx === 2 });
        if (q.option4 !== undefined && q.option4 !== '') opts.push({ text: q.option4, isCorrect: correctIdx === 3 });
        q.options = opts;
      }
      // Ensure all options are objects
      if (Array.isArray(q.options)) {
        q.options = q.options.map((o, idx) => {
          if (typeof o === 'object' && o !== null) {
            return { text: o.text || '', isCorrect: !!o.isCorrect };
          }
          return { text: String(o), isCorrect: idx === 0 };
        });
      }
      q.title = q.title || q.question || '';
      return q;
    });

    if (req.user.role === 'employee') {
      let emQs = [...parsedQuestions];
      if (assessment.isRandomized) emQs = emQs.sort(() => Math.random() - 0.5);
      
      const sanitized = emQs.map(q => {
        return {
          _id: q._id || q.id || String(Math.random()), title: q.title, type: q.type,
          options: (q.options || []).map((o, oIdx) => ({ _id: o._id || o.id || String(oIdx), text: o.text })),
          marks: q.marks, difficulty: q.difficulty,
        };
      });
      assessment.questions = sanitized;
      return res.json({ success: true, assessment });
    }
    
    assessment.questions = parsedQuestions;
    res.json({ success: true, assessment });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createAssessment = async (req, res) => {
  try {
    const assessmentData = {
      ...req.body,
      createdBy: req.user._id,
      questions: req.body.questions || [],
      assignedTo: req.body.assignedTo || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (!assessmentData._id || String(assessmentData._id).trim() === '') {
      assessmentData._id = Date.now().toString();
    }

    // Auto-assign to all active employees
    const empRes = await querySheets('getEmployees');
    const activeEmployees = (empRes.data || []).filter(e => e.role === 'employee' && (e.isActive === true || e.isActive === 'true'));
    assessmentData.assignedTo = activeEmployees.map(e => e._id);

    await querySheets('createAssessment', assessmentData);

    // Explicitly invalidate cache first before socket emits to prevent client race conditions
    clearCache();

    if (global.io) {
      console.log('📡 Broadcasting global sync signal for new assessment creation');
      global.io.emit('db:sync');
    }

    res.status(201).json({ success: true, assessment: assessmentData });
  } catch (error) { 
    console.error('CREATE ASSESSMENT ERROR:', error);
    res.status(500).json({ success: false, message: error.message }); 
  }
};

exports.updateAssessment = async (req, res) => {
  try {
    const updateData = { ...req.body, _id: req.params.id };
    const result = await querySheets('updateAssessment', updateData);
    if (!result.success) {
      return res.status(404).json({ success: false, message: result.message || 'Assessment not found' });
    }
    clearCache();
    if (global.io) global.io.emit('db:sync');
    res.json({ success: true, assessment: updateData });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteAssessment = async (req, res) => {
  try {
    await querySheets('deleteEntity', { sheetName: 'assessments', _id: req.params.id });
    clearCache();
    if (global.io) global.io.emit('db:sync');
    res.json({ success: true, message: 'Assessment deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.bulkAssignExam = async (req, res) => {
  try {
    const { employeeIds } = req.body;
    const assessmentId = req.params.id;
    
    const empRes = await querySheets('getEmployees');
    const employees = empRes.data || [];
    
    const targetEmployees = employees.filter(e => employeeIds.includes(String(e._id)));
    
    for (const emp of targetEmployees) {
      let assigned = [];
      try { assigned = typeof emp.assignedAssessments === 'string' ? JSON.parse(emp.assignedAssessments) : (emp.assignedAssessments || []); } catch(e){}
      
      if (!assigned.includes(assessmentId)) {
        assigned.push(assessmentId);
        await querySheets('updateEmployee', { _id: emp._id, assignedAssessments: assigned });
      }
    }

    const assRes = await querySheets('getAssessments');
    const assessments = assRes.data || [];
    const assessment = assessments.find(a => String(a._id) === String(assessmentId));
    
    if (assessment) {
      let assTo = [];
      try { assTo = typeof assessment.assignedTo === 'string' ? JSON.parse(assessment.assignedTo) : (assessment.assignedTo || []); } catch(e){}
      
      let changed = false;
      for (const id of employeeIds) {
        if (!assTo.includes(id)) {
          assTo.push(id);
          changed = true;
        }
      }
      if (changed) {
        await querySheets('updateAssessment', { _id: assessmentId, assignedTo: assTo });
      }
    }

    clearCache();
    if (global.io) global.io.emit('db:sync');
    res.json({ success: true, message: 'Assigned successfully' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getDashboardStats = async (req, res) => {
  try {
    const assRes = await querySheets('getAssessments');
    const activeAssessments = (assRes.data || []).filter(a => a.status === 'active' || a.status === 'scheduled').length;
    
    const empRes = await querySheets('getEmployees');
    const totalEmployees = (empRes.data || []).filter(e => e.role === 'employee').length;

    const resRes = await querySheets('getResults');
    const totalExamsTaken = (resRes.data || []).filter(r => ['submitted', 'auto-submitted'].includes(r.status)).length;

    const vRes = await querySheets('getViolations');
    const violationsLogged = (vRes.data || []).length;

    res.json({ success: true, stats: { activeAssessments, totalEmployees, totalExamsTaken, violationsLogged } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.startExam = async (req, res) => {
  try {
    const { assessmentId } = req.body;

    const resRes = await querySheets('getResults');
    const allResults = resRes.data || [];
    const alreadyAttempted = allResults.find(r => 
      String(r.employee || r.employeeMongoId) === String(req.user._id) && 
      String(r.assessmentId || r.assessment) === String(assessmentId)
    );
    if (alreadyAttempted) {
      return res.status(400).json({
        success: false,
        message: "Exam already attempted or in-progress."
      });
    }
    
    const resultId = Date.now().toString();
    const assRes = await querySheets('getAssessments');
    const assessment = (assRes.data || []).find(a => String(a._id) === String(assessmentId));

    const empRes = await querySheets('getEmployees');
    const employee = (empRes.data || []).find(e => String(e._id) === String(req.user._id));
    
    const newResult = {
      _id: resultId,
      employee: req.user._id.toString(),
      assessment: assessmentId,
      employeeId: employee ? (employee.employeeId || employee._id.toString()) : '',
      employeeMongoId: req.user._id.toString(),
      employeeName: employee ? employee.fullName : '',
      employeeEmail: employee ? employee.email : '',
      assessmentId: assessmentId,
      assessmentTitle: assessment ? assessment.title : 'Exam',
      status: 'in-progress',
      startedAt: new Date().toISOString(),
      examStarted: true,
      examCompleted: false,
      startTime: new Date().toISOString(),
      violationCount: 0,
      screenMonitoring: JSON.stringify({ webcamEnabled: true })
    };

    await querySheets('submitResult', newResult);
    
    // Clear the cache so /assessments/my updates immediately to "in-progress"
    if (req.user && req.user._id) {
      const { clearUserCache } = require('../middleware/cache');
      clearUserCache(req.user._id);
    }

    res.status(201).json({ success: true, result: newResult });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.submitExam = async (req, res) => {
  // Currently handled in index.js at /api/submit-exam. 
  // We can just redirect or implement it here if the route hits it.
  res.status(501).json({ success: false, message: 'Use /api/submit-exam route directly' });
};
