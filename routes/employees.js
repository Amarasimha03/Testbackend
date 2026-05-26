const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const {
  getEmployees, getEmployee, createEmployee, updateEmployee,
  deleteEmployee, assignAssessment, getEmployeeStats,
  uploadResume, getLoginHistory, uploadEmployeesExcel
} = require('../controllers/employeeController');

const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit validation
});

router.use(protect);
router.get('/', adminOnly, getEmployees);
router.get('/stats', adminOnly, getEmployeeStats);
router.post('/', adminOnly, createEmployee);
router.post('/upload-excel', adminOnly, upload.single('file'), uploadEmployeesExcel);
router.get('/:id', adminOnly, getEmployee);
router.put('/:id', adminOnly, updateEmployee);
router.delete('/:id', adminOnly, deleteEmployee);
router.post('/:id/assign', adminOnly, assignAssessment);
router.post('/:id/resume', uploadResume);
router.get('/:id/login-history', adminOnly, getLoginHistory);

module.exports = router;
