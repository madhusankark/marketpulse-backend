const mongoose = require('mongoose');

const AlertHistorySchema = new mongoose.Schema({
  alert: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Alert',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  stock: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Stock'
  },
  symbol: String,
  triggeredAt: {
    type: Date,
    default: Date.now
  },
  ruleType: String,
  triggeredValue: Number,
  thresholdValue: Number,
  message: String,
  acknowledged: {
    type: Boolean,
    default: false
  },
  acknowledgedAt: Date
}, { timestamps: true });

AlertHistorySchema.index({ user: 1, triggeredAt: -1 });
AlertHistorySchema.index({ alert: 1, triggeredAt: -1 });

module.exports = mongoose.model('AlertHistory', AlertHistorySchema);
