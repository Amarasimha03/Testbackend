const Employee = require('../models/Employee');
const Assessment = require('../models/Assessment');
const Result = require('../models/Result');
const AuditLog = require('../models/AuditLog');
const Violation = require('../models/Violation');
const { persistEntity } = require('../utils/localCache');

// GET all employees (admin)
exports.getEmployees = async (req, res) => {
  try {
    const mongoose = require('../utils/localCache');
    await mongoose.connect(); // Force fresh sync from Google Sheets

    // Find all users with role 'employee' (case-insensitive guard)
    const all = await Employee.find({});
    const employees = all
      .filter(e => (e.role || '').toLowerCase() !== 'admin')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    console.log(`[getEmployees] total in DB: ${all.length}, non-admin: ${employees.length}`);
    res.json({ success: true, count: employees.length, employees });
  } catch (err) {
    console.error('[getEmployees] error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET single employee with full details
exports.getEmployee = async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id).populate('assignedAssessments');
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    // Attach exam results for this employee
    const results = await Result.find({ employee: req.params.id })
      .populate('assessment', 'title category')
      .sort({ createdAt: -1 });

    res.json({ success: true, employee, results });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST create employee (admin)
exports.createEmployee = async (req, res) => {
  try {
    const { fullName, employeeId, email, phone, password, department, designation, company, role, status } = req.body;
    const exists = await Employee.findOne({ email });
    if (exists) return res.status(400).json({ success: false, message: 'Email already exists' });

    // Generate employee ID if not provided
    const generatedEmpId = employeeId || `EMP-${Date.now().toString().slice(-6)}`;

    // Automatically fetch and assign all currently active or scheduled assessments
    const activeAssessments = await Assessment.find({ status: { $in: ['active', 'scheduled'] } });
    const assessmentIds = activeAssessments.map(a => a._id);

    const isActive = !status || status === 'Active';

    const employee = await Employee.create({
      _id: generatedEmpId,
      fullName, email, phone, password, department, designation, company,
      employeeId: generatedEmpId,
      role: role || 'employee',
      isVerified: true,
      isActive,
      assignedAssessments: assessmentIds,
      loginHistory: [],
      examStats: { totalAttempts: 0, totalPassed: 0, totalFailed: 0, avgScore: 0, totalTimeTaken: 0 }
    });

    if (assessmentIds.length > 0) {
      await Assessment.updateMany(
        { _id: { $in: assessmentIds } },
        { $addToSet: { assignedTo: employee._id } }
      );
    }

    // Audit
    await AuditLog.create({
      user: req.user._id, action: 'employee-created',
      description: `Admin created employee: ${fullName} (${email}) [ID: ${generatedEmpId}] and auto-assigned ${assessmentIds.length} assessments`,
      targetModel: 'Employee', targetId: employee._id,
    });

    // Persist employee to Google Sheets — 16 columns match sheet headers exactly
    // Await so the admin knows if it succeeded or failed
    try {
      await persistEntity('createEmployee', {
        _id:                 employee._id.toString(),
        employeeId:          generatedEmpId,
        fullName,
        email,
        phone:               phone || '',
        department:          department || 'General',
        designation:         designation || '',
        company:             company || '',
        role:                role || 'employee',
        password,
        isActive:            isActive.toString(),
        isVerified:          'true',
        assignedAssessments: assessmentIds.map(String),
        examStats:           { totalAttempts: 0, totalPassed: 0, totalFailed: 0, avgScore: 0, totalTimeTaken: 0 },
        createdAt:           employee.createdAt || new Date().toISOString(),
        updatedAt:           employee.updatedAt || new Date().toISOString(),
      });
      console.log('[createEmployee] ✅ Saved to Google Sheets:', employee._id.toString());
    } catch (sheetErr) {
      console.error('[createEmployee] ❌ Google Sheets save FAILED:', sheetErr.message);
      // Don't fail the request — employee is in memory; sheet will sync on next restart
    }

    res.status(201).json({ success: true, employee });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// PUT update employee
exports.updateEmployee = async (req, res) => {
  try {
    const { fullName, phone, department, designation, company, isActive, role } = req.body;
    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { fullName, phone, department, designation, company, isActive, role },
      { new: true, runValidators: true }
    );
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    // Audit
    await AuditLog.create({
      user: req.user._id, action: 'employee-updated',
      description: `Updated employee: ${employee.fullName}`,
      targetModel: 'Employee', targetId: employee._id,
    });

    // Persist updated employee to Google Sheets — 16 columns
    persistEntity('updateEmployee', {
      _id:                 employee._id.toString(),
      employeeId:          employee.employeeId || '',
      fullName:            employee.fullName,
      email:               employee.email || '',
      phone:               employee.phone || '',
      department:          employee.department || 'General',
      designation:         employee.designation || '',
      company:             employee.company || '',
      role:                employee.role || 'employee',
      isActive:            employee.isActive !== undefined ? employee.isActive.toString() : 'true',
      isVerified:          'true',
      assignedAssessments: (employee.assignedAssessments || []).map(String), // raw array
      examStats:           employee.examStats || { totalAttempts: 0, totalPassed: 0, totalFailed: 0, avgScore: 0, totalTimeTaken: 0 }, // raw object
      updatedAt:           new Date().toISOString(),
    });

    res.json({ success: true, employee });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// DELETE employee
exports.deleteEmployee = async (req, res) => {
  const id = req.params.id;
  try {
    // Step 1 (CRITICAL): Delete the employee — if this fails, return 500
    const employee = await Employee.findByIdAndDelete(id);

    if (employee) {
      // Step 2 (non-critical): Delete associated exam results
      try {
        const results = await Result.find({ employee: id });
        await Result.deleteMany({ employee: id });
        for (const r of results) {
          persistEntity('deleteEntity', { sheetName: 'results', _id: r._id.toString() }).catch(() => {});
        }
      } catch (e) {
        console.warn('[deleteEmployee] Non-critical: failed to delete results —', e.message);
      }

      // Step 3 (non-critical): Delete associated violations
      try {
        const ViolationModel = require('../models/Violation');
        await ViolationModel.deleteMany({ employee: id });
      } catch (e) {
        console.warn('[deleteEmployee] Non-critical: failed to delete violations —', e.message);
      }

      // Step 4 (non-critical): Delete from Google Sheets
      persistEntity('deleteEntity', { sheetName: 'employees', _id: id }).catch(() => {});

      // Step 5 (non-critical): Write audit log
      try {
        await AuditLog.create({
          user: req.user._id,
          action: 'employee-deactivated',
          description: `Deleted employee: ${employee.fullName} (${employee.email})`,
          targetModel: 'Employee',
          targetId: id,
        });
      } catch (e) {
        console.warn('[deleteEmployee] Non-critical: audit log failed —', e.message);
      }
    }

    res.json({ success: true, message: 'Employee and all related records deleted' });
  } catch (err) {
    console.error('[deleteEmployee] CRITICAL ERROR:', err.message, err.stack);
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT assign assessment to employee
exports.assignAssessment = async (req, res) => {
  try {
    const { assessmentId } = req.body;
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    
    const hasAssessment = employee.assignedAssessments.some(id => id.toString() === assessmentId.toString());
    if (!hasAssessment) {
      employee.assignedAssessments.push(assessmentId);
      await employee.save();
    }
    
    const assessment = await Assessment.findById(assessmentId);
    if (assessment) {
      const hasEmployee = assessment.assignedTo.some(id => id.toString() === req.params.id.toString());
      if (!hasEmployee) {
        assessment.assignedTo.push(req.params.id);
        await assessment.save();
      }
    }
    
    res.json({ success: true, message: 'Assessment assigned successfully', employee });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST upload resume
exports.uploadResume = async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    // In production: use multer + cloud storage. For demo, accept base64 / file path.
    const { fileName, fileUrl, fileSize } = req.body;
    employee.resume = { fileName, fileUrl, fileSize, uploadedAt: new Date() };
    await employee.save();

    await AuditLog.create({
      user: req.user._id, action: 'resume-uploaded',
      description: `Resume uploaded for ${employee.fullName}: ${fileName}`,
      targetModel: 'Employee', targetId: employee._id,
    });

    res.json({ success: true, message: 'Resume uploaded', employee });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET employee stats
exports.getEmployeeStats = async (req, res) => {
  try {
    const totalEmployees = await Employee.countDocuments({ role: 'employee' });
    const activeEmployees = await Employee.countDocuments({ role: 'employee', isActive: true });
    res.json({ success: true, stats: { totalEmployees, activeEmployees } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET login history for a specific employee
exports.getLoginHistory = async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id).select('fullName email loginHistory lastLogin');
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    res.json({ success: true, loginHistory: employee.loginHistory, lastLogin: employee.lastLogin });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST bulk upload Excel / CSV
exports.uploadEmployeesExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const XLSX = require('xlsx');
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Excel sheet is empty' });
    }

    const activeAssessments = await Assessment.find({ status: { $in: ['active', 'scheduled'] } });
    const assessmentIds = activeAssessments.map(a => a._id);

    let successCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;
    const errors = [];

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      // Normalize spreadsheet keys (case-insensitive keys mapping)
      const empId = String(row['Employee ID'] || row['employeeId'] || '').trim();
      const fullName = String(row['Employee Name'] || row['fullName'] || row['name'] || '').trim();
      const email = String(row['Email'] || row['email'] || '').trim();
      const phone = String(row['Phone Number'] || row['phone'] || '').trim();
      const department = String(row['Department'] || row['department'] || 'General').trim();
      const role = String(row['Role'] || row['role'] || 'employee').trim();
      const password = String(row['Password'] || row['password'] || '').trim();
      const status = String(row['Status'] || row['status'] || 'Active').trim();

      // Required fields check
      if (!fullName || !email) {
        failedCount++;
        errors.push(`Row ${index + 2}: Missing required fields (Employee Name or Email)`);
        continue;
      }

      // Unique ID / Email validation against DB
      const emailExists = await Employee.findOne({ email });
      if (emailExists) {
        duplicateCount++;
        errors.push(`Row ${index + 2}: Duplicate employee found (Email "${email}" already exists)`);
        continue;
      }

      if (empId) {
        const idExists = await Employee.findOne({ employeeId: empId });
        if (idExists) {
          duplicateCount++;
          errors.push(`Row ${index + 2}: Duplicate employee ID found ("${empId}" already exists)`);
          continue;
        }
      }

      // Generate default ID and secure passwords
      const generatedEmpId = empId || `EMP-${Date.now().toString().slice(-6)}-${index}`;
      const defaultPassword = password || `Pass@${generatedEmpId.slice(-4)}`;

      try {
        const employee = await Employee.create({
          _id: generatedEmpId,
          fullName,
          email,
          phone,
          password: defaultPassword,
          department,
          designation: 'Staff',
          company: 'Enterprise',
          employeeId: generatedEmpId,
          role: role.toLowerCase() === 'admin' ? 'admin' : 'employee',
          isVerified: true,
          isActive: status.toLowerCase() !== 'inactive',
          assignedAssessments: assessmentIds,
          loginHistory: [],
          examStats: { totalAttempts: 0, totalPassed: 0, totalFailed: 0, avgScore: 0, totalTimeTaken: 0 }
        });

        // Map assignments to active exams
        if (assessmentIds.length > 0) {
          await Assessment.updateMany(
            { _id: { $in: assessmentIds } },
            { $addToSet: { assignedTo: employee._id } }
          );
        }

        // Persist to Google Sheets — 16 columns match sheet headers
        persistEntity('createEmployee', {
          _id:                 employee._id.toString(),
          employeeId:          generatedEmpId,
          fullName,
          email,
          phone,
          department,
          designation:         'Staff',
          company:             'Enterprise',
          role:                employee.role,
          password:            defaultPassword,
          isActive:            employee.isActive.toString(),
          isVerified:          'true',
          assignedAssessments: assessmentIds.map(String),  // raw array
          examStats:           { totalAttempts: 0, totalPassed: 0, totalFailed: 0, avgScore: 0, totalTimeTaken: 0 }, // raw object
          createdAt:           new Date().toISOString(),
          updatedAt:           new Date().toISOString(),
        });

        successCount++;
      } catch (err) {
        failedCount++;
        errors.push(`Row ${index + 2}: Database error (${err.message})`);
      }
    }

    res.json({
      success: true,
      summary: {
        total: rows.length,
        success: successCount,
        duplicates: duplicateCount,
        failed: failedCount
      },
      errors
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Invalid Excel format or parsing error: ' + err.message });
  }
};
