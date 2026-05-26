const Question = require('../models/Question');
const Assessment = require('../models/Assessment');
const mcqGenerator = require('../services/mcqGenerator');
const { persistEntity } = require('../utils/localCache');

exports.getQuestions = async (req, res) => {
  try {
    const { assessmentId } = req.query;
    const filter = assessmentId ? { assessment: assessmentId } : {};
    const questions = await Question.find(filter);
    res.json({ success: true, questions });
  } catch (err) { console.error('QUESTION ERROR:', err); res.status(500).json({ success: false, message: err.message }); }
};

exports.createQuestion = async (req, res) => {
  try {
    const question = await Question.create({ ...req.body, createdBy: req.user._id });
    if (req.body.assessmentId) {
      await Assessment.findByIdAndUpdate(req.body.assessmentId, { $push: { questions: question._id } });
    }

    // Persist question to Google Sheets
    persistEntity('addQuestion', {
      _id:         question._id.toString(),
      assessmentId:req.body.assessmentId || '',
      title:       question.title,
      type:        question.type || 'mcq',
      options:     question.options,
      marks:       question.marks,
      difficulty:  question.difficulty,
      explanation: question.explanation || '',
      createdBy:   req.user._id.toString(),
    });

    res.status(201).json({ success: true, question });
  } catch (err) { console.error('QUESTION ERROR:', err); res.status(500).json({ success: false, message: err.message }); }
};

exports.bulkCreateQuestions = async (req, res) => {
  try {
    const { questions, assessmentId } = req.body;
    if (!Array.isArray(questions)) {
      return res.status(400).json({ success: false, message: 'questions must be an array' });
    }

    const sanitizedQuestions = questions.map(q => {
      // 1. Title
      const title = q.title || q.question || q.text || q.q || 'Untitled Question';
      // 2. Type
      const type = q.type || 'mcq';
      // 3. Difficulty
      const difficulty = q.difficulty || 'medium';
      // 4. Marks
      const marks = q.marks || 2;
      // 5. Options mapping
      let options = [];
      if (Array.isArray(q.options)) {
        if (typeof q.options[0] === 'object' && q.options[0] !== null) {
          options = q.options.map(opt => ({
            text: opt.text || opt.title || '',
            isCorrect: opt.isCorrect === true || opt.isCorrect === 'true'
          }));
        } else {
          // Options are strings
          let correctIdx = -1;
          const correctVal = q.correct !== undefined ? q.correct : q.correctAnswer;
          if (correctVal !== undefined && correctVal !== null) {
            const correctStr = String(correctVal).trim().toLowerCase();
            if (['a', 'b', 'c', 'd'].includes(correctStr)) {
              correctIdx = ['a', 'b', 'c', 'd'].indexOf(correctStr);
            } else if (['0', '1', '2', '3'].includes(correctStr)) {
              correctIdx = parseInt(correctStr, 10);
            } else {
              correctIdx = q.options.findIndex(opt => String(opt).trim().toLowerCase() === correctStr);
            }
          }
          if (correctIdx === -1) correctIdx = 0; // fallback

          options = q.options.map((opt, idx) => ({
            text: String(opt),
            isCorrect: idx === correctIdx
          }));
        }
      } else {
        // Create default options if missing
        options = [
          { text: 'Option A', isCorrect: true },
          { text: 'Option B', isCorrect: false },
          { text: 'Option C', isCorrect: false },
          { text: 'Option D', isCorrect: false }
        ];
      }

      // Ensure at least one correct option
      if (!options.some(o => o.isCorrect)) {
        options[0].isCorrect = true;
      }

      return {
        title,
        type,
        options,
        difficulty,
        marks,
        createdBy: req.user._id,
        assessment: assessmentId
      };
    });

    const created = await Question.insertMany(sanitizedQuestions);
    if (assessmentId) {
      const ids = created.map(q => q._id);
      await Assessment.findByIdAndUpdate(assessmentId, { $push: { questions: { $each: ids } } });
    }

    // Persist each question to Google Sheets
    created.forEach(q => {
      persistEntity('addQuestion', {
        _id:         q._id.toString(),
        assessmentId:assessmentId || '',
        title:       q.title,
        type:        q.type || 'mcq',
        options:     q.options,
        marks:       q.marks,
        difficulty:  q.difficulty,
        explanation: q.explanation || '',
        createdBy:   req.user._id.toString(),
      });
    });

    res.status(201).json({ success: true, count: created.length, questions: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateQuestion = async (req, res) => {
  try {
    const question = await Question.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, question });
  } catch (err) { console.error('QUESTION ERROR:', err); res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteQuestion = async (req, res) => {
  try {
    const question = await Question.findByIdAndDelete(req.params.id);
    if (question?.assessment) {
      await Assessment.findByIdAndUpdate(question.assessment, { $pull: { questions: question._id } });
    }
    res.json({ success: true, message: 'Question deleted' });
  } catch (err) { console.error('QUESTION ERROR:', err); res.status(500).json({ success: false, message: err.message }); }
};

exports.generateQuestionsFromFile = async (req, res) => {
  try {
    const { fileName, fileContent } = req.body;
    if (!fileName || !fileContent) {
      return res.status(400).json({ success: false, message: 'fileName and fileContent are required' });
    }
    const questions = await mcqGenerator.generateQuestionsFromText(fileName, fileContent);
    res.json({ success: true, questions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
