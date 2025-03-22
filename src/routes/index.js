const express = require('express');
const router = express.Router();

// Route di base per testare l'API
router.get('/status', (req, res) => {
  res.json({ status: 'API is running', timestamp: new Date().toISOString() });
});

module.exports = router; 