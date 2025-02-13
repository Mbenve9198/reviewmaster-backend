// routes/book.routes.js
const express = require('express');
const multer = require('multer');
const bookController = require('../controllers/book.controller');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/upload', upload.single('pdf'), bookController.uploadBook);

module.exports = router;