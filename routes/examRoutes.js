// ─────────────────────────────────────────────────────────────
//  examRoutes.js  –  Backend API for Exam Results Mapping
//  Express + Mongoose integration mapping standard Result data
// ─────────────────────────────────────────────────────────────

const express = require("express");
const router = express.Router();
const Result = require("../models/Result");
const { protect, adminOnly } = require("../middleware/auth");

// ─────────────────────────────────
//  GET /api/exam/result/:resultId
//  Fetch full result formatted for ResultPage.jsx
// ─────────────────────────────────
router.get("/result/:resultId", protect, async (req, res) => {
  try {
    const result = await Result.findById(req.params.resultId)
      .populate("employee", "fullName email department")
      .populate({ path: "assessment", populate: { path: "questions" } })
      .populate("answers.question");

    if (!result) return res.status(404).json({ error: "Result not found" });

    // Format data exactly as expected by ResultPage.jsx
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
            const isCorrect = qa.isCorrect;
            const isUnanswered = !qa.selectedAnswer || qa.selectedAnswer === 'Not Attempted' || qa.selectedAnswer === 'Not Answered';
            const status = isCorrect ? "correct" : isUnanswered ? "unattempted" : "wrong";

            return {
              questionNumber: index + 1,
              question: qa.questionText || "",
              options: qa.options || [],
              selectedAnswer: isUnanswered ? null : qa.selectedAnswer,
              correctAnswer: qa.correctAnswer || "",
              isCorrect: qa.isCorrect,
              status: status,
            };
          });
        } else if (result.assessment && result.assessment.questions) {
          return result.assessment.questions.map((q, index) => {
            const optionsText = (q.options || []).map(o => o.text);
            const correctOpt = (q.options || []).find(o => o.isCorrect);
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

// ─────────────────────────────────
//  GET /api/exam/results
//  List all results mapped for ResultPage
// ─────────────────────────────────
router.get("/results", protect, async (req, res) => {
  try {
    const filter = {};
    if (req.query.examId) filter.assessment = req.query.examId;
    if (req.query.employeeId) filter.employee = req.query.employeeId;
    if (req.user.role === 'employee') filter.employee = req.user._id;

    const results = await Result.find(filter)
      .populate("assessment", "title")
      .populate("employee", "fullName email department")
      .sort({ submittedAt: -1 });

    const mapped = results.map(r => ({
      resultId: r._id,
      exam: { title: r.assessment?.title },
      employee: { name: r.employee?.fullName, email: r.employee?.email, department: r.employee?.department },
      submittedAt: r.submittedAt,
      summary: {
        scorePercent: r.percentage,
        passed: r.passed
      }
    }));

    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch results" });
  }
});

module.exports = router;
