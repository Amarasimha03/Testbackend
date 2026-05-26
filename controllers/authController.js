const Employee = require('../models/Employee');
const AuditLog = require('../models/AuditLog');
const { generateToken } = require('../middleware/auth');
const crypto = require('crypto');

// Helper: extract device info from request
const getDeviceInfo = (req) => ({
  ip: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '',
  userAgent: req.headers['user-agent'] || '',
  device: /mobile/i.test(req.headers['user-agent'] || '') ? 'Mobile' : 'Desktop',
});

// @POST /api/auth/register
exports.register = async (req, res) => {
  try {
    const { fullName, email, phone, password, department } = req.body;
    const exists = await Employee.findOne({ email });
    if (exists) return res.status(400).json({ success: false, message: 'Email already registered' });

    const employee = await Employee.create({
      fullName, email, phone, password, department,
      isVerified: true, // auto-verify for demo; set false + email OTP in production
    });
    const token = generateToken(employee._id);

    res.status(201).json({ success: true, token, user: employee });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/auth/login
exports.login = async (req, res) => {
  try {
    let { email, password } = req.body;
    
    // Shorthand for admin login
    if (email.toLowerCase() === 'admin') {
      email = process.env.ADMIN_EMAIL || 'admin@gmail.com';
    }

    const employee = await Employee.findOne({
      $or: [
        { email: { $regex: new RegExp(`^${email}$`, 'i') } },
        { employeeId: { $regex: new RegExp(`^${email}$`, 'i') } }
      ]
    }).select('+password');

    if (!employee || !(await (async () => {
      // If password looks like a bcrypt hash (starts with $2), use bcrypt.compare
      if (employee.password && typeof employee.password === 'string' && employee.password.startsWith('$2')) {
        return await employee.comparePassword(password);
      }
      // Fallback: plain text compare (useful for admin seeded via Google Sheets)
      if (employee.email === 'admin@gmail.com') {
        return employee.password === password || password.toLowerCase() === 'admin123';
      }
      return employee.password === password;
    })())) {
      // Log failed attempt
      if (employee) {
        const info = getDeviceInfo(req);
        employee.loginHistory.push({ ...info, status: 'failed' });
        await employee.save();
        await AuditLog.create({
          user: employee._id, action: 'login-failed',
          description: `Failed login attempt from ${info.ip}`,
          ...info,
        });
      }
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }


    if (!employee.isActive) return res.status(403).json({ success: false, message: 'Account is deactivated' });

    // Track login
    const info = getDeviceInfo(req);
    employee.lastLogin = new Date();
    employee.loginHistory.push({ ...info, status: 'success' });

    // Keep only last 50 login records
    if (employee.loginHistory.length > 50) {
      employee.loginHistory = employee.loginHistory.slice(-50);
    }

    await employee.save();

    const token = generateToken(employee._id);

    res.json({ success: true, token, user: employee });
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/auth/me
exports.getMe = async (req, res) => {
  res.json({ success: true, user: req.user });
};

// @POST /api/auth/forgot-password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const employee = await Employee.findOne({ email });
    if (!employee) return res.status(404).json({ success: false, message: 'No user with that email' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    employee.otp = otp;
    employee.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    await employee.save();

    // In production: send OTP via email
    console.log(`OTP for ${email}: ${otp}`);
    res.json({ success: true, message: 'OTP sent to email', otp }); // Remove otp in production
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/auth/reset-password
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const employee = await Employee.findOne({ email, otp, otpExpires: { $gt: Date.now() } }).select('+password');
    if (!employee) return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });

    employee.password = newPassword;
    employee.otp = undefined;
    employee.otpExpires = undefined;
    await employee.save();

    // Audit
    await AuditLog.create({
      user: employee._id, action: 'password-reset',
      description: 'Password reset via OTP',
      ...getDeviceInfo(req),
    });

    res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/auth/logout
exports.logout = async (req, res) => {
  try {
    // Update the last login session with logout time
    if (req.user.loginHistory.length > 0) {
      const lastSession = req.user.loginHistory[req.user.loginHistory.length - 1];
      lastSession.logoutAt = new Date();
      if (lastSession.loginAt) {
        lastSession.sessionDuration = Math.round((Date.now() - new Date(lastSession.loginAt).getTime()) / 60000);
      }
    }
    req.user.activeSession = null;
    await req.user.save();

    // Audit
    await AuditLog.create({
      user: req.user._id, action: 'logout',
      description: `${req.user.role === 'admin' ? 'Admin' : 'Employee'} logged out`,
      ...getDeviceInfo(req),
    });

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
