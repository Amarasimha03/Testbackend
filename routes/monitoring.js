const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');

// POST webcam snapshot / violation screenshot
router.post('/snapshot', protect, async (req, res) => {
  try {
    // Store base64 image; in production use Multer + cloud storage
    const { imageData, type } = req.body;
    res.json({ success: true, message: 'Snapshot saved', type });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET active exam sessions
router.get('/active', protect, async (req, res) => {
  try {
    const io = req.app.get('io');
    res.json({ success: true, message: 'Use Socket.IO for live data' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
