const jwt = require('jsonwebtoken');
const Employee = require('../models/Employee');

// Fallback secret so server doesn't crash when env var is missing on deployment
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_jwt_secret_onlinetest_2024_change_me';

exports.protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) return res.status(401).json({ success: false, message: 'Not authorized, no token' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const employee = await Employee.findById(decoded.id);
    if (!employee) return res.status(401).json({ success: false, message: 'User not found' });
    if (!employee.isActive) return res.status(403).json({ success: false, message: 'Account deactivated' });

    req.user = employee;
    next();
  } catch (err) {
    console.error('AUTH MIDDLEWARE ERROR:', err.message);
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};

exports.adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ success: false, message: 'Admin access required' });
};

exports.generateToken = (id) => {
  return jwt.sign({ id }, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '30d' });
};
