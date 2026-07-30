const mongoose = require('mongoose');

const SystemLogSchema = new mongoose.Schema({
  level: {
    type: String,
    enum: ['info', 'warning', 'error', 'critical'],
    required: true
  },
  action: {
    type: String,
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  ip: String,
  userAgent: String,
  details: mongoose.Schema.Types.Mixed,
  statusCode: Number,
  duration: Number,
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

SystemLogSchema.index({ level: 1, timestamp: -1 });
SystemLogSchema.index({ action: 1, timestamp: -1 });

module.exports = mongoose.model('SystemLog', SystemLogSchema);
