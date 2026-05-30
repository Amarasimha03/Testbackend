const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { apiCacheMiddleware } = require("../middleware/cache");
const { querySheets } = require("../services/googleSheets");

router.get("/result/:resultId", protect, apiCacheMiddleware(), async (req, res) => {
  try {
    // Fetch all datasets in parallel to eliminate sequential timeout delays
    const [resRes, empRes, assRes, qRes] = await Promise.all([
      querySheets('getResults'),
      querySheets('getEmployees'),
      querySheets('getAssessments'),
      querySheets('getQuestions')
    ]);

    const result = (resRes.data || []).find(r => String(r._id || r.id) === String(req.params.resultId));
    if (!result) return res.status(404).json({ error: "Result not found" });

    const e = (empRes.data || []).find(e => String(e._id || e.id) === String(result.employeeMongoId || result.employee));
    result.employee = e || result.employee;

    const a = (assRes.data || []).find(a => String(a._id || a.id) === String(result.assessmentId || result.assessment));
    if (a) {
      const assessmentId = a._id || a.id;
      const questions = (qRes.data || []).filter(q => String(q.assessment) === String(assessmentId) || String(q.assessmentId) === String(assessmentId));
      a.questions = questions;
      result.assessment = a;
    }

    let parsedAnswers = [];
    try { parsedAnswers = typeof result.answers === 'string' ? JSON.parse(result.answers) : (result.answers || []); } catch(e){}
    result.answers = parsedAnswers;

    const responsePayload = {
      resultId: result._id,
      exam: {
        title: result.assessment?.title || "Exam",
        passingScore: result.assessment?.passingScore || 60,
        maxDurationMinutes: result.assessment?.duration || 30,
      },
      employee: {
        name: result.employee?.fullName || "Candidate",
        email: result.employee?.email || "",
        department: result.employee?.department || "General",
      },
      submittedAt: result.submittedAt || result.createdAt,
      startTime: result.startTime || result.startedAt || null,
      endTime: result.endTime || result.submittedAt || null,
      durationSeconds: (result.completionTime || 0) * 60,
      summary: {
        totalQuestions: result.answers ? result.answers.length : 0,
        correctCount: result.correctAnswers || 0,
        wrongCount: result.wrongAnswers || 0,
        unattemptedCount: result.answers 
          ? result.answers.filter(a => !a.selectedOptions || a.selectedOptions.length === 0).length 
          : 0,
        scoreRaw: result.correctAnswers || 0,
        scorePercent: result.percentage || 0,
        passed: result.passed,
      },
      questionAnalysis: (() => {
        if (result.answers && result.answers.length > 0) {
          return result.answers.map((qa, index) => {
            const isCorrect = qa.isCorrect === true || qa.isCorrect === 'true';
            const isUnanswered = !qa.selectedAnswer || qa.selectedAnswer === 'Not Attempted' || qa.selectedAnswer === 'Not Answered';
            const status = isCorrect ? "correct" : isUnanswered ? "unattempted" : "wrong";

            let qOptions = [];
            try { qOptions = typeof qa.options === 'string' ? JSON.parse(qa.options) : (qa.options || []); } catch(e){}

            return {
              questionNumber: index + 1,
              question: qa.questionText || qa.questionTitle || "",
              options: qOptions,
              selectedAnswer: isUnanswered ? null : qa.selectedAnswer,
              correctAnswer: qa.correctAnswer || "",
              isCorrect: isCorrect,
              status: status,
            };
          });
        } else if (result.assessment && result.assessment.questions) {
          return result.assessment.questions.map((q, index) => {
            let qOptions = [];
            try { qOptions = typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || []); } catch(e){}
            const optionsText = qOptions.map(o => o.text);
            const correctOpt = qOptions.find(o => o.isCorrect === true || o.isCorrect === 'true');
            const correctAnswer = correctOpt ? correctOpt.text : "";

            return {
              questionNumber: index + 1,
              question: q.title || "",
              options: optionsText,
              selectedAnswer: null,
              correctAnswer: correctAnswer,
              isCorrect: false,
              status: "unattempted",
            };
          });
        }
        return [];
      })(),
    };

    res.json(responsePayload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch result" });
  }
});

router.get("/results", protect, apiCacheMiddleware(), async (req, res) => {
  try {
    // Fetch all required sheets in parallel to eliminate timeout latencies
    const [resRes, empRes, assRes] = await Promise.all([
      querySheets('getResults'),
      querySheets('getEmployees'),
      querySheets('getAssessments')
    ]);

    let results = resRes.data || [];
    const employees = empRes.data || [];
    const assessments = assRes.data || [];
    
    if (req.query.examId) results = results.filter(r => String(r.assessmentId || r.assessment) === String(req.query.examId));
    if (req.query.employeeId) results = results.filter(r => String(r.employeeMongoId || r.employee) === String(req.query.employeeId));
    if (req.user.role === 'employee') results = results.filter(r => String(r.employeeMongoId || r.employee) === String(req.user._id));

    const mapped = results.map(r => {
      const e = employees.find(e => String(e._id) === String(r.employeeMongoId || r.employee));
      const a = assessments.find(a => String(a._id) === String(r.assessmentId || r.assessment));
      return {
        resultId: r._id,
        exam: { title: a ? a.title : '' },
        employee: { name: e?.fullName, email: e?.email, department: e?.department },
        submittedAt: r.submittedAt,
        summary: { scorePercent: r.percentage, passed: r.passed }
      };
    }).sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));

    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch results" });
  }
});

module.exports = router;
