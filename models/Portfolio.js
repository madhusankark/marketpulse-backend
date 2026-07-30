const mongoose = require('mongoose');

const TradeSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  type: { type: String, enum: ['buy', 'sell'], required: true },
  quantity: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true },
  total: { type: Number, required: true },
  tradeDate: { type: Date, default: Date.now },
  notes: String
});

const PortfolioSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true, default: 'My Portfolio'
  },
  trades: [TradeSchema],
  initialBalance: { type: Number, default: 100000 }
}, { timestamps: true });

PortfolioSchema.index({ user: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Portfolio', PortfolioSchema);
