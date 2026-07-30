const Alert = require('../models/Alert');
const AlertHistory = require('../models/AlertHistory');
const Notification = require('../models/Notification');
const User = require('../models/User');
const MarketDataService = require('./marketDataService');
const EmailService = require('./emailService');
const { redis, logger } = require('../config/db');

class AlertEngine {
  static async evaluateAlerts() {
    try {
      const alerts = await Alert.find({ isActive: true }).populate('stock');
      logger.info(`Evaluating ${alerts.length} active alerts`);

      const groupedBySymbol = {};
      alerts.forEach(alert => {
        const symbol = alert.symbol || alert.stock?.symbol;
        if (!symbol) return;
        if (!groupedBySymbol[symbol]) groupedBySymbol[symbol] = [];
        groupedBySymbol[symbol].push(alert);
      });

      for (const [symbol, alertGroup] of Object.entries(groupedBySymbol)) {
        const quote = await MarketDataService.getLiveQuote(symbol);
        if (!quote) continue;

        for (const alert of alertGroup) {
          const triggered = this.evaluateRules(alert, quote);

          if (triggered) {
            const cooldownKey = `alert_cooldown:${alert._id}`;
            const inCooldown = await redis.get(cooldownKey);

            if (!inCooldown) {
              await this.triggerAlert(alert, quote, triggered);
              await redis.setex(cooldownKey, (alert.cooldownMinutes || 60) * 60, '1');
            }
          }
        }
      }
    } catch (error) {
      logger.error('Alert evaluation error:', error.message);
    }
  }

  static evaluateRules(alert, quote) {
    const results = [];

    for (const rule of alert.rules) {
      let result = false;

      switch (rule.type) {
        case 'price_above':
          result = quote.lastPrice > rule.value;
          break;
        case 'price_below':
          result = quote.lastPrice < rule.value;
          break;
        case 'pct_change_above':
          result = quote.changePercent > rule.value;
          break;
        case 'pct_change_below':
          result = quote.changePercent < rule.value;
          break;
        case 'volume_spike':
          result = quote.volume > rule.value;
          break;
        case 'week52_high':
          result = quote.lastPrice >= quote.yearHigh * 0.98;
          break;
        case 'week52_low':
          result = quote.lastPrice <= quote.yearLow * 1.02;
          break;
      }

      results.push({ type: rule.type, triggered: result, value: rule.value, actual: this.getActualValue(rule.type, quote) });
    }

    if (alert.logic === 'AND') {
      const allTriggered = results.every(r => r.triggered);
      return allTriggered ? results : null;
    } else {
      const anyTriggered = results.some(r => r.triggered);
      return anyTriggered ? results.filter(r => r.triggered) : null;
    }
  }

  static getActualValue(type, quote) {
    switch (type) {
      case 'price_above':
      case 'price_below':
        return quote.lastPrice;
      case 'pct_change_above':
      case 'pct_change_below':
        return quote.changePercent;
      case 'volume_spike':
        return quote.volume;
      default:
        return quote.lastPrice;
    }
  }

  static async triggerAlert(alert, quote, triggeredRules) {
    const message = this.buildAlertMessage(alert, quote, triggeredRules);

    await AlertHistory.create({
      alert: alert._id,
      user: alert.user,
      stock: alert.stock,
      symbol: alert.symbol || quote.symbol,
      ruleType: triggeredRules.map(r => r.type).join(', '),
      triggeredValue: triggeredRules[0]?.actual || quote.lastPrice,
      thresholdValue: triggeredRules[0]?.value,
      message
    });

    await Alert.findByIdAndUpdate(alert._id, {
      isTriggered: true,
      lastTriggered: new Date()
    });

    if (alert.notifyVia.includes('in_app')) {
      await Notification.create({
        user: alert.user,
        type: 'alert_trigger',
        title: `Alert Triggered: ${alert.name}`,
        message,
        data: {
          alertId: alert._id,
          symbol: alert.symbol || quote.symbol,
          price: quote.lastPrice,
          change: quote.changePercent
        }
      });
    }

    if (alert.notifyVia.includes('email')) {
      try {
        const user = await User.findById(alert.user);
        if (user?.email) {
          await EmailService.sendAlertEmail(user.email, user.name || 'Trader', alert, quote, message);
        }
      } catch (err) {
        logger.error(`Email notification error for alert ${alert._id}: ${err.message}`);
      }
    }

    const io = require('../index').io;
    if (io) {
      io.to(`user:${alert.user}`).emit('alertTriggered', {
        alertId: alert._id,
        symbol: alert.symbol || quote.symbol,
        message,
        price: quote.lastPrice,
        timestamp: new Date()
      });

      io.to(`user:${alert.user}`).emit('notification', {
        type: 'alert_trigger',
        title: `Alert: ${alert.name}`,
        message,
        timestamp: new Date()
      });
    }

    logger.info(`Alert triggered: ${alert.name} for ${alert.symbol || quote.symbol}`);
  }

  static buildAlertMessage(alert, quote, triggeredRules) {
    const symbol = alert.symbol || quote.symbol;
    const parts = triggeredRules.map(rule => {
      switch (rule.type) {
        case 'price_above':
          return `${symbol} price (₹${quote.lastPrice}) is above ₹${rule.value}`;
        case 'price_below':
          return `${symbol} price (₹${quote.lastPrice}) is below ₹${rule.value}`;
        case 'pct_change_above':
          return `${symbol} changed +${quote.changePercent}% (threshold: +${rule.value}%)`;
        case 'pct_change_below':
          return `${symbol} changed ${quote.changePercent}% (threshold: -${rule.value}%)`;
        case 'volume_spike':
          return `${symbol} volume (${(quote.volume / 1000000).toFixed(1)}M) exceeded threshold`;
        case 'week52_high':
          return `${symbol} is near 52-week high (₹${quote.yearHigh})`;
        case 'week52_low':
          return `${symbol} is near 52-week low (₹${quote.yearLow})`;
        default:
          return `${alert.name} triggered`;
      }
    });

    return parts.join(' | ');
  }

  static async getUserAlerts(userId) {
    return Alert.find({ user: userId })
      .populate('stock', 'symbol name sector')
      .sort({ createdAt: -1 });
  }

  static async createAlert(userId, alertData) {
    return Alert.create({ ...alertData, user: userId });
  }

  static async updateAlert(userId, alertId, updateData) {
    return Alert.findOneAndUpdate(
      { _id: alertId, user: userId },
      updateData,
      { new: true, runValidators: true }
    );
  }

  static async deleteAlert(userId, alertId) {
    return Alert.findOneAndDelete({ _id: alertId, user: userId });
  }

  static async toggleAlert(userId, alertId) {
    const alert = await Alert.findOne({ _id: alertId, user: userId });
    if (!alert) return null;
    alert.isActive = !alert.isActive;
    await alert.save();
    return alert;
  }

  static async getAlertHistory(userId, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [history, total] = await Promise.all([
      AlertHistory.find({ user: userId })
        .populate('alert', 'name symbol')
        .sort({ triggeredAt: -1 })
        .skip(skip)
        .limit(limit),
      AlertHistory.countDocuments({ user: userId })
    ]);

    return { history, total, page, pages: Math.ceil(total / limit) };
  }

  static async acknowledgeAlertHistory(userId, historyId) {
    return AlertHistory.findOneAndUpdate(
      { _id: historyId, user: userId },
      { acknowledged: true, acknowledgedAt: new Date() },
      { new: true }
    );
  }
}

module.exports = AlertEngine;
