'use strict';
const express = require('express');
const router = express.Router();

router.post('/webhook', async (req, res) => {
  // Proxy architecture no longer uses in-memory DB cache. 
  // Acknowledge webhook success immediately.
  res.json({ success: true, message: 'Webhook received. Proxy architecture relies on direct fetch.' });
});

router.get('/status', (_req, res) => {
  res.json({
    success: true,
    message: 'Proxy architecture active. No local cache.',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
