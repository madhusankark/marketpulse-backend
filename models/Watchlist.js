const mongoose = require('mongoose');

const WatchlistSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  stocks: [{
    symbol: {
      type: String,
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    },
    notes: String
  }],
  isDefault: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

WatchlistSchema.index({ user: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Watchlist', WatchlistSchema);
