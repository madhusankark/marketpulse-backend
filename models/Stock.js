const mongoose = require('mongoose');

const StockSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  exchange: {
    type: String,
    enum: ['NSE', 'BSE'],
    default: 'NSE'
  },
  sector: {
    type: String,
    required: true,
    index: true
  },
  industry: String,
  isin: String,
  listingDate: Date,
  marketCap: Number,
  faceValue: Number,
  status: {
    type: String,
    enum: ['active', 'suspended', 'delisted'],
    default: 'active'
  }
}, { timestamps: true });

StockSchema.index({ name: 'text', symbol: 'text' });
StockSchema.index({ sector: 1, status: 1 });

module.exports = mongoose.model('Stock', StockSchema);
