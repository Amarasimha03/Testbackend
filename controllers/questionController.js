const { querySheets } = require('../services/googleSheets');
const mcqGenerator = require('../services/mcqGenerator');
const { clearCache } = require('../middleware/cache');

exports.getQuestions = async (req, res) => {
  try {
    const { assessmentId } = req.query;
    const qRes = await querySheets('getQuestions', assessmentId ? { assessmentId } : {});
    const allQuestions = qRes.data || [];
    
    const questions = assessmentId 
      ? allQuestions.filter(q => String(q.assessment) === String(assessmentId) || String(q.assessmentId) === String(assessmentId))
      : allQuestions;
      
    // Parse options if they are strings or reconstruct from individual columns
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

    res.json({ success: true, questions: parsedQuestions });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createQuestion = async (req, res) => {
  try {
    const questionData = {
      ...req.body,
      createdBy: req.user._id,
      _id: Date.now().toString(),
      assessmentId: req.body.assessmentId || req.body.assessment
    };

    // Validate MCQ options schema before save
    if (questionData.type === 'mcq') {
      if (!Array.isArray(questionData.options) || questionData.options.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'MCQ options missing'
        });
      }
    }

    // Check for duplicates
    if (questionData.assessmentId) {
      const qRes = await querySheets('getQuestions', { assessmentId: questionData.assessmentId });
      const allQs = qRes.data || [];
      const existingQs = allQs.filter(q => String(q.assessment) === String(questionData.assessmentId) || String(q.assessmentId) === String(questionData.assessmentId));
      
      const normalizedNewTitle = (questionData.title || questionData.question || '').trim().toLowerCase();
      const exists = existingQs.find(eq => {
        const t = (eq.title || eq.question || '').trim().toLowerCase();
        return t === normalizedNewTitle;
      });

      if (exists) {
        return res.status(400).json({
          success: false,
          message: 'Question already exists'
        });
      }
    }

    const addRes = await querySheets('addQuestion', questionData);
    if (addRes && addRes.message === 'Question already exists in this assessment') {
      return res.status(400).json({
        success: false,
        message: 'Question already exists'
      });
    }

    if (questionData.assessmentId) {
      const assRes = await querySheets('getAssessments');
      const assessments = assRes.data || [];
      const assessment = assessments.find(a => String(a._id) === String(questionData.assessmentId));
      if (assessment) {
        let qList = [];
        try { qList = typeof assessment.questions === 'string' ? JSON.parse(assessment.questions) : (assessment.questions || []); } catch(e){}
        if (!qList.includes(questionData._id)) {
          qList.push(questionData._id);
          await querySheets('updateAssessment', { _id: assessment._id, questions: qList });
        }
      }
    }

    clearCache();
    if (global.io) global.io.emit('db:sync');

    res.status(201).json({ success: true, question: questionData });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.bulkCreateQuestions = async (req, res) => {
  try {
    const { questions, assessmentId } = req.body;
    if (!Array.isArray(questions)) {
      return res.status(400).json({ success: false, message: 'questions must be an array' });
    }

    const created = [];
    let idCounter = Date.now();

    const qRes = await querySheets('getQuestions', assessmentId ? { assessmentId } : {});
    const allQs = qRes.data || [];
    const existingQs = assessmentId 
      ? allQs.filter(q => String(q.assessment) === String(assessmentId) || String(q.assessmentId) === String(assessmentId))
      : [];
      
    const existingTitles = new Set(existingQs.map(q => {
      const t = q.title || q.question || q.text || q.q || '';
      return t.trim().toLowerCase();
    }));

    for (const q of questions) {
      const title = q.title || q.question || q.text || q.q || 'Untitled Question';
      const normalizedTitle = title.trim().toLowerCase();

      // Skip duplicate questions within the same assessment
      if (existingTitles.has(normalizedTitle)) {
        continue;
      }
      existingTitles.add(normalizedTitle);
      const type = q.type || 'mcq';
      const difficulty = q.difficulty || 'medium';
      const marks = q.marks || 2;
      
      let options = [];
      if (Array.isArray(q.options)) {
        if (typeof q.options[0] === 'object' && q.options[0] !== null) {
          options = q.options.map(opt => ({
            text: opt.text || opt.title || '',
            isCorrect: opt.isCorrect === true || opt.isCorrect === 'true'
          }));
        } else {
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
          if (correctIdx === -1) correctIdx = 0;
          options = q.options.map((opt, idx) => ({ text: String(opt), isCorrect: idx === correctIdx }));
        }
      } else {
        options = [
          { text: 'Option A', isCorrect: true }, { text: 'Option B', isCorrect: false },
          { text: 'Option C', isCorrect: false }, { text: 'Option D', isCorrect: false }
        ];
      }

      if (!options.some(o => o.isCorrect)) options[0].isCorrect = true;

      const qData = {
        _id: (idCounter++).toString(),
        title, type, options, difficulty, marks,
        explanation: q.explanation || '',
        createdBy: req.user._id,
        assessmentId: assessmentId || req.body.assessment || ''
      };

      created.push(qData);
    }

    if (created.length > 0) {
      await querySheets('bulkAddQuestions', { questions: created, assessmentId });
    }

    clearCache();
    if (global.io) global.io.emit('db:sync');

    res.status(201).json({ success: true, count: created.length, questions: created });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateQuestion = async (req, res) => {
  res.status(501).json({ success: false, message: 'Update question not implemented in Apps Script yet' });
};

exports.deleteQuestion = async (req, res) => {
  try {
    const qRes = await querySheets('getQuestions');
    const question = (qRes.data || []).find(q => String(q._id) === String(req.params.id));
    
    await querySheets('deleteEntity', { sheetName: 'questions', _id: req.params.id });

    if (question && (question.assessment || question.assessmentId)) {
      const assId = question.assessment || question.assessmentId;
      const assRes = await querySheets('getAssessments');
      const assessment = (assRes.data || []).find(a => String(a._id) === String(assId));
      if (assessment) {
        let qList = [];
        try { qList = typeof assessment.questions === 'string' ? JSON.parse(assessment.questions) : (assessment.questions || []); } catch(e){}
        qList = qList.filter(id => String(id) !== String(req.params.id));
        await querySheets('updateAssessment', { _id: assId, questions: qList });
      }
    }

    clearCache();
    if (global.io) global.io.emit('db:sync');

    res.json({ success: true, message: 'Question deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
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
