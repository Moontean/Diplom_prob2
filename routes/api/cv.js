const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');

const CV = require('../../models/CV');
const User = require('../../models/User');

// @route    GET api/cv/me
// @desc     Get current user's CV
// @access   Private
router.get('/me', auth, async (req, res) => {
  try {
    const cv = await CV.findOne({ user: req.user.id });

    if (!cv) {
      return res.status(400).json({ msg: 'There is no CV for this user' });
    }

    res.json(cv);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route    POST api/cv
// @desc     Create or update user CV
// @access   Private
router.post(
  '/',
  [auth, [check('cvData', 'CV data is required').not().isEmpty()]],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { cvData, template } = req.body;

    const cvFields = {};
    cvFields.user = req.user.id;
    if (cvData) cvFields.cvData = cvData;
    if (template) cvFields.template = template;

    try {
      let cv = await CV.findOne({ user: req.user.id });

      if (cv) {
        // Update
        cv = await CV.findOneAndUpdate(
          { user: req.user.id },
          { $set: cvFields },
          { new: true }
        );
        return res.json(cv);
      }

      // Create
      cv = new CV(cvFields);
      await cv.save();
      res.json(cv);
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server Error');
    }
  }
);

// @route    GET api/cv
// @desc     Get all CVs
// @access   Public (for testing, should be private in production)
router.get('/', async (req, res) => {
  try {
    const cvs = await CV.find().populate('user', ['name']);
    res.json(cvs);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
