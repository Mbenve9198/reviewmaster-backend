const express = require('express');
const router = express.Router();
const ruleController = require('../controllers/rule.controller');

// Analisi dei temi ricorrenti
router.get('/analyze/:hotelId', ruleController.analyzeThemes);

// CRUD delle regole
router.post('/', ruleController.createRule);
router.get('/:hotelId', ruleController.getRules);
router.put('/:ruleId', ruleController.updateRule);
router.patch('/:ruleId', ruleController.toggleRule);
router.delete('/:ruleId', ruleController.deleteRule);

module.exports = router; 