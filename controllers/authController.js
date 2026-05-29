const { querySheets } = require('../services/googleSheets');
const { generateToken } = require('../middleware/auth');
const crypto = require('crypto');

const getDeviceInfo = (req) => ({
  ip: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '',
  userAgent: req.headers['user-agent'] || '',
  device: /mobile/i.test(req.headers['user-agent'] || '') ? 'Mobile' : 'Desktop',
});

exports.register = async (req, res) => {
  try {
    const { fullName, email, phone, password, department } = req.body;

    // Check if exists
    const empRes = await querySheets('getEmployees');
    const employees = empRes.data || [];
    const exists = employees.find(e => e.email === email);

    if (exists) return res.status(400).json({ success: false, message: 'Email already registered' });

    const newEmp = {
      _id: Date.now().toString(),
      fullName, email, phone, password, department,
      isVerified: true,
      isActive: true,
      role: 'employee',
      assignedAssessments: [],
      examStats: { totalAttempts: 0, totalPassed: 0, totalFailed: 0, avgScore: 0, totalTimeTaken: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await querySheets('createEmployee', newEmp);
    const token = generateToken(newEmp._id);

    res.status(201).json({ success: true, token, user: newEmp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    let { email, password } = req.body;
    email = String(email || '').trim();
    password = String(password || '').trim();

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@gmail.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123';

    let employee = null;

    // Fast-path for Admin login (bypass Google Sheets entirely)
    if (email.toLowerCase() === 'admin' || email.toLowerCase() === adminEmail.toLowerCase()) {
      employee = {
        _id: 'admin_id',
        email: adminEmail,
        password: adminPassword,
        role: 'admin',
        isActive: true,
        fullName: 'Admin User'
      };
    } else {
      // Employee login: query sheets (cached)
      const empRes = await querySheets('getEmployees');
      const employees = empRes.data || [];

      employee = employees.find(e =>
        (e.email || '').toLowerCase() === email.toLowerCase() ||
        (e.employeeId || '').toLowerCase() === email.toLowerCase()
      );
    }

    if (!employee) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    let isValid = false;
    if (employee.email.toLowerCase() === adminEmail.toLowerCase()) {
      isValid = employee.password === password || password === adminPassword || password.toLowerCase() === adminPassword.toLowerCase();
    } else {
      isValid = String(employee.password).trim() === password;
    }

    if (!isValid) {
      // Log failed attempt
      const info = getDeviceInfo(req);
      const history = Array.isArray(employee.loginHistory) ? employee.loginHistory : [];
      history.push({ ...info, status: 'failed' });

      if (employee._id !== 'admin_id') {
        // Fire-and-forget async update (non-blocking)
        querySheets('updateEmployee', { _id: employee._id, loginHistory: history })
          .catch(err => console.error('[Login] Failed to sync failed history:', err.message));
      }
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (!employee.isActive && employee.isActive !== 'true') {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    // Track login
    const info = getDeviceInfo(req);
    let history = Array.isArray(employee.loginHistory) ? employee.loginHistory : [];
    if (typeof history === 'string') {
      try { history = JSON.parse(history); } catch (e) { history = []; }
    }
    history.push({ ...info, status: 'success' });
    if (history.length > 50) history = history.slice(-50);

    employee.lastLogin = new Date().toISOString();
    employee.loginHistory = history;

    if (employee._id !== 'admin_id') {
      // Fire-and-forget async update (non-blocking) to return 0-1s response
      querySheets('updateEmployee', {
        _id: employee._id,
        loginHistory: history,
        lastLogin: employee.lastLogin
      }).catch(err => console.error('[Login] Failed to sync login history:', err.message));
    }

    const token = generateToken(employee._id);

    // Remove password from response
    const safeUser = { ...employee };
    delete safeUser.password;

    res.json({ success: true, token, user: safeUser });
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getMe = async (req, res) => {
  res.json({ success: true, user: req.user });
};

exports.forgotPassword = async (req, res) => {
  res.status(501).json({ success: false, message: 'Not implemented in Apps Script yet' });
};

exports.resetPassword = async (req, res) => {
  res.status(501).json({ success: false, message: 'Not implemented in Apps Script yet' });
};

exports.logout = async (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
};
