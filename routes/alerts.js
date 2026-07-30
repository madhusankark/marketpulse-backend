const express = require('express');
const router = express.Router();
const AlertEngine = require('../services/alertEngine');
const { protect } = require('../middleware/auth');

// GET /api/alerts
router.get('/', protect, async (req, res) => {
  try {
    const alerts = await AlertEngine.getUserAlerts(req.user._id);
    res.json({ success: true, data: alerts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/alerts
router.post('/', protect, async (req, res) => {
  try {
    const { name, symbol, rules, logic, cooldownMinutes, notifyVia } = req.body;

    if (!name || !rules || rules.length === 0) {
      return res.status(400).json({ success: false, message: 'Name and at least one rule required' });
    }

    const alert = await AlertEngine.createAlert(req.user._id, {
      name,
      symbol: symbol?.toUpperCase(),
      rules,
      logic: logic || 'OR',
      cooldownMinutes: cooldownMinutes || 60,
      notifyVia: notifyVia || ['in_app']
    });

    res.status(201).json({ success: true, data: alert });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/alerts/:id
router.put('/:id', protect, async (req, res) => {
  try {
    const alert = await AlertEngine.updateAlert(req.user._id, req.params.id, req.body);
    if (!alert) {
      return res.status(404).json({ success: false, message: 'Alert not found' });
    }
    res.json({ success: true, data: alert });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/alerts/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    const alert = await AlertEngine.deleteAlert(req.user._id, req.params.id);
    if (!alert) {
      return res.status(404).json({ success: false, message: 'Alert not found' });
    }
    res.json({ success: true, message: 'Alert deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/alerts/:id/toggle
router.put('/:id/toggle', protect, async (req, res) => {
  try {
    const alert = await AlertEngine.toggleAlert(req.user._id, req.params.id);
    if (!alert) {
      return res.status(404).json({ success: false, message: 'Alert not found' });
    }
    res.json({ success: true, data: alert });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/alerts/history?page=1&limit=20
router.get('/history', protect, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const history = await AlertEngine.getAlertHistory(req.user._id, parseInt(page), parseInt(limit));
    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/alerts/history/:id/acknowledge
router.put('/history/:id/acknowledge', protect, async (req, res) => {
  try {
    const history = await AlertEngine.acknowledgeAlertHistory(req.user._id, req.params.id);
    if (!history) {
      return res.status(404).json({ success: false, message: 'Alert history not found' });
    }
    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
