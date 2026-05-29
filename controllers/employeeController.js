const { querySheets } = require('../services/googleSheets');
const crypto = require('crypto');

exports.getEmployees = async (req, res) => {
  try {
    const empRes = await querySheets('getEmployees');
    const all = empRes.data || [];
    const employees = all
      .filter(e => (e.role || '').toLowerCase() !== 'admin')
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      
    res.json({ success: true, count: employees.length, employees });
  } catch (err) {
    console.error('[getEmployees] error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getEmployee = async (req, res) => {
  try {
    const empRes = await querySheets('getEmployees');
    const employees = empRes.data || [];
    const employee = employees.find(e => String(e._id) === String(req.params.id));
    
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    // Fetch assigned assessments properly populated
    let assignedIds = [];
    try { assignedIds = typeof employee.assignedAssessments === 'string' ? JSON.parse(employee.assignedAssessments) : (employee.assignedAssessments || []); } catch(e){}
    
    const assRes = await querySheets('getAssessments');
    const assessments = assRes.data || [];
    employee.assignedAssessments = assessments.filter(a => assignedIds.includes(String(a._id)));

    // Fetch results for this employee
    const resRes = await querySheets('getResults');
    let results = (resRes.data || []).filter(r => String(r.employeeMongoId) === String(req.params.id) || String(r.employeeId) === String(req.params.id));
    
    results = results.map(r => {
      const a = assessments.find(a => String(a._id) === String(r.assessmentId));
      return { ...r, assessment: a ? { title: a.title, category: a.category } : r.assessmentId };
    }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    res.json({ success: true, employee, results });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createEmployee = async (req, res) => {
  try {
    const { fullName, employeeId, email, phone, password, department, designation, company, role, status } = req.body;
    
    const empRes = await querySheets('getEmployees');
    const exists = (empRes.data || []).find(e => e.email === email);
    if (exists) return res.status(400).json({ success: false, message: 'Email already exists' });

    const generatedEmpId = employeeId || `EMP-${Date.now().toString().slice(-6)}`;
    
    const assRes = await querySheets('getAssessments');
    const activeAssessments = (assRes.data || []).filter(a => ['active', 'scheduled'].includes(a.status));
    const assessmentIds = activeAssessments.map(a => String(a._id));

    const isActive = !status || status === 'Active';

    const empData = {
      _id: generatedEmpId,
      fullName, email, phone, password, department, designation, company,
      employeeId: generatedEmpId,
      role: role || 'employee',
      isVerified: true,
      isActive,
      assignedAssessments: assessmentIds,
      loginHistory: [],
      examStats: { totalAttempts: 0, totalPassed: 0, totalFailed: 0, avgScore: 0, totalTimeTaken: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await querySheets('createEmployee', empData);

    // Update assessments to include this employee
    for (const a of activeAssessments) {
      let assTo = [];
      try { assTo = typeof a.assignedTo === 'string' ? JSON.parse(a.assignedTo) : (a.assignedTo || []); } catch(e){}
      assTo.push(generatedEmpId);
      await querySheets('updateAssessment', { _id: a._id, assignedTo: assTo });
    }

    res.status(201).json({ success: true, employee: empData });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateEmployee = async (req, res) => {
  try {
    const { fullName, phone, department, designation, company, isActive, role } = req.body;
    
    const empRes = await querySheets('getEmployees');
    const employee = (empRes.data || []).find(e => String(e._id) === String(req.params.id));
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    
    const updateData = { _id: req.params.id, fullName, phone, department, designation, company, isActive, role, updatedAt: new Date().toISOString() };
    await querySheets('updateEmployee', updateData);
    
    res.json({ success: true, employee: { ...employee, ...updateData } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteEmployee = async (req, res) => {
  const id = req.params.id;
  try {
    await querySheets('deleteEntity', { sheetName: 'employees', _id: id });
    res.json({ success: true, message: 'Employee deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.assignAssessment = async (req, res) => {
  try {
    const { assessmentId } = req.body;
    
    const empRes = await querySheets('getEmployees');
    const employee = (empRes.data || []).find(e => String(e._id) === String(req.params.id));
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    
    let assigned = [];
    try { assigned = typeof employee.assignedAssessments === 'string' ? JSON.parse(employee.assignedAssessments) : (employee.assignedAssessments || []); } catch(e){}
    
    if (!assigned.includes(assessmentId)) {
      assigned.push(assessmentId);
      await querySheets('updateEmployee', { _id: employee._id, assignedAssessments: assigned });
    }
    
    const assRes = await querySheets('getAssessments');
    const assessment = (assRes.data || []).find(a => String(a._id) === String(assessmentId));
    if (assessment) {
      let assTo = [];
      try { assTo = typeof assessment.assignedTo === 'string' ? JSON.parse(assessment.assignedTo) : (assessment.assignedTo || []); } catch(e){}
      if (!assTo.includes(req.params.id)) {
        assTo.push(req.params.id);
        await querySheets('updateAssessment', { _id: assessmentId, assignedTo: assTo });
      }
    }
    
    res.json({ success: true, message: 'Assessment assigned successfully', employee });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.uploadResume = async (req, res) => {
  try {
    const { fileName, fileUrl, fileSize } = req.body;
    const updateData = { _id: req.params.id, resume: { fileName, fileUrl, fileSize, uploadedAt: new Date().toISOString() } };
    await querySheets('updateEmployee', updateData);
    res.json({ success: true, message: 'Resume uploaded' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getEmployeeStats = async (req, res) => {
  try {
    const empRes = await querySheets('getEmployees');
    const employees = (empRes.data || []).filter(e => e.role === 'employee');
    const totalEmployees = employees.length;
    const activeEmployees = employees.filter(e => e.isActive === true || e.isActive === 'true').length;
    res.json({ success: true, stats: { totalEmployees, activeEmployees } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getLoginHistory = async (req, res) => {
  try {
    const empRes = await querySheets('getEmployees');
    const employee = (empRes.data || []).find(e => String(e._id) === String(req.params.id));
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    let history = [];
    try { history = typeof employee.loginHistory === 'string' ? JSON.parse(employee.loginHistory) : (employee.loginHistory || []); } catch(e){}
    res.json({ success: true, loginHistory: history, lastLogin: employee.lastLogin });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.uploadEmployeesExcel = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const XLSX = require('xlsx');
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0) return res.status(400).json({ success: false, message: 'Excel sheet is empty' });

    const empRes = await querySheets('getEmployees');
    const existingEmployees = empRes.data || [];
    
    const assRes = await querySheets('getAssessments');
    const assessmentIds = (assRes.data || []).filter(a => ['active', 'scheduled'].includes(a.status)).map(a => String(a._id));

    let successCount = 0, duplicateCount = 0, failedCount = 0;
    const errors = [];

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const empId = String(row['Employee ID'] || row['employeeId'] || '').trim();
      const fullName = String(row['Employee Name'] || row['fullName'] || row['name'] || '').trim();
      const email = String(row['Email'] || row['email'] || '').trim();
      const phone = String(row['Phone Number'] || row['phone'] || '').trim();
      const department = String(row['Department'] || row['department'] || 'General').trim();
      const role = String(row['Role'] || row['role'] || 'employee').trim();
      const password = String(row['Password'] || row['password'] || '').trim();
      const status = String(row['Status'] || row['status'] || 'Active').trim();

      if (!fullName || !email) {
        failedCount++; errors.push(`Row ${index + 2}: Missing required fields`); continue;
      }

      if (existingEmployees.find(e => e.email === email)) {
        duplicateCount++; errors.push(`Row ${index + 2}: Email exists`); continue;
      }

      const generatedEmpId = empId || `EMP-${Date.now().toString().slice(-6)}-${index}`;
      
      try {
        await querySheets('createEmployee', {
          _id: generatedEmpId,
          employeeId: generatedEmpId,
          fullName, email, phone, department,
          designation: 'Staff', company: 'Enterprise',
          role: role.toLowerCase() === 'admin' ? 'admin' : 'employee',
          password: password || `Pass@${generatedEmpId.slice(-4)}`,
          isActive: status.toLowerCase() !== 'inactive',
          isVerified: true,
          assignedAssessments: assessmentIds,
          loginHistory: [],
          examStats: { totalAttempts: 0, totalPassed: 0, totalFailed: 0, avgScore: 0, totalTimeTaken: 0 },
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        });
        successCount++;
      } catch (err) {
        failedCount++; errors.push(`Row ${index + 2}: DB error`);
      }
    }

    res.json({ success: true, summary: { total: rows.length, success: successCount, duplicates: duplicateCount, failed: failedCount }, errors });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Excel parsing error: ' + err.message });
  }
};
