const { querySheets } = require('../services/googleSheets');

exports.getResults = async (req, res) => {
  try {
    const { assessmentId, employeeId } = req.query;
    
    const resRes = await querySheets('getResults');
    let results = resRes.data || [];
    
    if (assessmentId) results = results.filter(r => String(r.assessmentId || r.assessment) === String(assessmentId));
    if (employeeId) results = results.filter(r => String(r.employeeMongoId || r.employee) === String(employeeId));
    if (req.user.role === 'employee') results = results.filter(r => String(r.employeeMongoId || r.employee) === String(req.user._id));
    
    // Sort
    results.sort((a, b) => new Date(b.submittedAt || b.createdAt || 0) - new Date(a.submittedAt || a.createdAt || 0));

    // Populate employee and assessment details
    const empRes = await querySheets('getEmployees');
    const employees = empRes.data || [];
    const assRes = await querySheets('getAssessments');
    const assessments = assRes.data || [];

    const mapped = results.map(r => {
      const eId = r.employee || r.employeeMongoId;
      const aId = r.assessment || r.assessmentId;
      const e = employees.find(e => String(e._id) === String(eId) || String(e.employeeId) === String(eId));
      const a = assessments.find(a => String(a._id) === String(aId));
      return {
        ...r,
        employee: e ? { _id: e._id, fullName: e.fullName, email: e.email, department: e.department } : { _id: eId, fullName: r.employeeName || 'Unknown', email: 'No Email', department: 'General' },
        assessment: a ? { _id: a._id, title: a.title, passingScore: a.passingScore } : aId
      };
    });

    res.json({ success: true, results: mapped });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getResult = async (req, res) => {
  try {
    const resRes = await querySheets('getResults');
    const result = (resRes.data || []).find(r => String(r._id) === String(req.params.id));
    if (!result) {
      // Fallback: treat the ID as an assessmentId to list results for that assessment
      req.query.assessmentId = req.params.id;
      return exports.getResults(req, res);
    }
    
    const empRes = await querySheets('getEmployees');
    const eId = result.employee || result.employeeMongoId;
    const e = (empRes.data || []).find(e => String(e._id) === String(eId));
    result.employee = e ? { _id: e._id, fullName: e.fullName, email: e.email, department: e.department } : { _id: eId };

    const assRes = await querySheets('getAssessments');
    const aId = result.assessment || result.assessmentId;
    const a = (assRes.data || []).find(a => String(a._id) === String(aId));
    
    if (a) {
      const qRes = await querySheets('getQuestions');
      const questions = (qRes.data || []).filter(q => String(q.assessment) === String(a._id) || String(q.assessmentId) === String(a._id));
      a.questions = questions.map(q => {
        let parsedOptions = [];
        try { parsedOptions = typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || []); } catch(e){}
        if (parsedOptions.length === 0) {
          if (q.option1 || q.option2 || q.option3 || q.option4) {
             parsedOptions = [q.option1, q.option2, q.option3, q.option4].filter(Boolean);
          }
        }
        return {
          ...q,
          question: q.title || q.question || '',
          options: parsedOptions.map(o => typeof o === 'object' ? o.text : String(o))
        };
      });
      result.assessment = a;
    } else {
      result.assessment = { _id: aId, title: result.assessmentTitle || 'Exam' };
    }

    if (req.user.role === 'employee') {
      const empId = result.employeeMongoId || result.employeeId || result.employee?._id || result.employee;
      if (String(empId) !== String(req.user._id)) {
        return res.status(403).json({ success: false, message: 'Access denied to this result' });
      }
      if (result.status === 'in-progress') {
        return res.status(403).json({ success: false, message: 'Answers and results are hidden during an active exam.' });
      }
    }

    // Try to map answers to actual question objects if possible
    let parsedAnswers = [];
    try { parsedAnswers = typeof result.answers === 'string' ? JSON.parse(result.answers) : (result.answers || []); } catch(e){}
    
    if (result.assessment && result.assessment.questions) {
      parsedAnswers = parsedAnswers.map(ans => {
        const qObj = result.assessment.questions.find(q => String(q._id) === String(ans.question || ans.questionId));
        return { ...ans, question: qObj || ans.question };
      });
    }
    result.answers = parsedAnswers;

    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getRankList = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const resRes = await querySheets('getResults');
    let results = (resRes.data || []).filter(r => 
      String(r.assessmentId || r.assessment) === String(assessmentId) &&
      ['submitted', 'auto-submitted'].includes(r.status)
    );
    
    const empRes = await querySheets('getEmployees');
    const employees = empRes.data || [];
    
    results = results.map(r => {
      const e = employees.find(e => String(e._id) === String(r.employeeMongoId || r.employeeId || r.employee));
      return {
        ...r,
        employee: e ? { _id: e._id, fullName: e.fullName, email: e.email, department: e.department } : r.employee
      };
    });

    results.sort((a, b) => {
      if ((b.totalScore || 0) !== (a.totalScore || 0)) return (b.totalScore || 0) - (a.totalScore || 0);
      return (a.completionTime || 0) - (b.completionTime || 0);
    });

    const ranked = results.map((r, i) => ({ ...r, rank: i + 1 }));
    res.json({ success: true, rankList: ranked });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getAnalytics = async (req, res) => {
  try {
    const resRes = await querySheets('getResults');
    const allResults = (resRes.data || []).filter(r => ['submitted', 'auto-submitted'].includes(r.status));
    
    const totalResults = allResults.length;
    const passedResults = allResults.filter(r => r.passed === true || r.passed === 'true').length;
    const failedResults = totalResults - passedResults;
    const passRate = totalResults ? Math.round((passedResults / totalResults) * 100) : 0;
    
    const sumScore = allResults.reduce((acc, r) => acc + (parseFloat(r.percentage) || 0), 0);
    const avgScore = totalResults ? Math.round(sumScore / totalResults) : 0;
    
    const sumTime = allResults.reduce((acc, r) => acc + (parseInt(r.completionTime) || 0), 0);
    const avgCompletionTime = totalResults ? Math.round(sumTime / totalResults) : 0;
    
    const empRes = await querySheets('getEmployees');
    const employees = empRes.data || [];
    
    const deptMap = {};
    for (const r of allResults) {
      const e = employees.find(e => String(e._id) === String(r.employeeMongoId || r.employeeId || r.employee));
      const dept = e ? (e.department || 'General') : 'General';
      if (!deptMap[dept]) deptMap[dept] = { count: 0, sumScore: 0 };
      deptMap[dept].count++;
      deptMap[dept].sumScore += (parseFloat(r.percentage) || 0);
    }
    
    const departmentPerformance = Object.keys(deptMap).map(k => ({
      _id: k,
      count: deptMap[k].count,
      avgScore: Math.round(deptMap[k].sumScore / deptMap[k].count)
    })).sort((a, b) => b.avgScore - a.avgScore);

    const vRes = await querySheets('getViolations');
    const totalViolations = (vRes.data || []).length;

    res.json({
      success: true, analytics: {
        totalResults, passedResults, failedResults, passRate,
        avgScore, avgCompletionTime, departmentPerformance, totalViolations
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteResult = async (req, res) => {
  try {
    await querySheets('deleteEntity', { sheetName: 'results', _id: req.params.id });
    res.json({ success: true, message: 'Result deleted successfully' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getEmployeeResults = async (req, res) => {
  try {
    req.query.employeeId = req.params.id;
    return exports.getResults(req, res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
