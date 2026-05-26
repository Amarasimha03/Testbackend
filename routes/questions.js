const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const { getQuestions, createQuestion, bulkCreateQuestions, updateQuestion, deleteQuestion, generateQuestionsFromFile } = require('../controllers/questionController');

router.use(protect, adminOnly);
router.get('/', getQuestions);
router.post('/', createQuestion);
router.post('/bulk', bulkCreateQuestions);
router.post('/generate', generateQuestionsFromFile);
router.put('/:id', updateQuestion);
router.delete('/:id', deleteQuestion);

module.exports = router;
