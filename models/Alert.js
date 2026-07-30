const mongoose = require('mongoose');

const AlertRuleSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['price_above', 'price_below', 'pct_change_above', 'pct_change_below',
           'volume_spike', 'index_movement', 'sector_movement', 'week52_high', 'week52_low'],
    required: true
  },
  value: {
    type: Number,
    required: true
  },
  operator: {
    type: String,
    enum: ['>', '<', '>=', '<=', '=='],
    default: '>'
  }
});

const AlertSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  stock: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Stock'
  },
  symbol: String,
  name: {
    type: String,
    required: true
  },
  rules: [AlertRuleSchema],
  logic: {
    type: String,
    enum: ['AND', 'OR'],
    default: 'OR'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isTriggered: {
    type: Boolean,
    default: false
  },
  lastTriggered: Date,
  cooldownMinutes: {
    type: Number,
    default: 60
  },
  notifyVia: {
    type: [String],
    enum: ['in_app', 'email'],
    default: ['in_app']
  }
}, { timestamps: true });

AlertSchema.index({ user: 1, isActive: 1 });
AlertSchema.index({ symbol: 1, isActive: 1 });

module.exports = mongoose.model('Alert', AlertSchema);
