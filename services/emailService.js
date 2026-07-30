const nodemailer = require('nodemailer');
const { logger } = require('../config/db');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

class EmailService {
  static async sendAlertEmail(userEmail, userName, alert, quote, message) {
    try {
      const symbol = alert.symbol || quote.symbol;
      const info = await transporter.sendMail({
        from: `"MarketPulse Alerts" <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: `Alert Triggered: ${alert.name} (${symbol})`,
        html: `
          <div style="font-family: 'Inter', Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #FF6B35, #D94A1A); padding: 24px 28px; text-align: center;">
              <h1 style="margin: 0; color: #fff; font-size: 1.4rem;">MarketPulse Alert</h1>
            </div>
            <div style="padding: 28px;">
              <p style="margin: 0 0 16px; color: #475569;">Hi <strong>${userName}</strong>,</p>
              <p style="margin: 0 0 20px; color: #475569;">Your alert has been triggered:</p>
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 20px; margin-bottom: 20px;">
                <p style="margin: 0 0 6px; font-size: 0.85rem; color: #94a3b8;">ALERT NAME</p>
                <p style="margin: 0 0 14px; font-weight: 600; font-size: 1.1rem; color: #0f172a;">${alert.name}</p>
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                  <div><p style="margin: 0 0 2px; font-size: 0.8rem; color: #94a3b8;">SYMBOL</p><p style="margin: 0; font-weight: 600; color: #FF6B35;">${symbol}</p></div>
                  <div style="text-align: right;"><p style="margin: 0 0 2px; font-size: 0.8rem; color: #94a3b8;">CURRENT PRICE</p><p style="margin: 0; font-weight: 600; color: #0f172a;">₹${quote.lastPrice}</p></div>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <div><p style="margin: 0 0 2px; font-size: 0.8rem; color: #94a3b8;">CHANGE</p><p style="margin: 0; font-weight: 600; color: ${quote.change >= 0 ? '#16a34a' : '#dc2626'};">${quote.change >= 0 ? '+' : ''}${quote.change} (${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent}%)</p></div>
                  <div style="text-align: right;"><p style="margin: 0 0 2px; font-size: 0.8rem; color: #94a3b8;">VOLUME</p><p style="margin: 0; font-weight: 600; color: #0f172a;">${(quote.volume || 0).toLocaleString('en-IN')}</p></div>
                </div>
              </div>
              <div style="background: #fff7ed; border-left: 4px solid #FF6B35; border-radius: 6px; padding: 12px 16px; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 0.9rem; color: #9a3412;">${message}</p>
              </div>
              <p style="margin: 0 0 4px; font-size: 0.8rem; color: #94a3b8; text-align: center;">Triggered at ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
              <p style="margin: 0; font-size: 0.8rem; color: #94a3b8; text-align: center;">MarketPulse &mdash; Real-time NSE Stock Monitoring</p>
            </div>
          </div>
        `
      });
      logger.info(`Alert email sent to ${userEmail} for ${symbol}: ${info.messageId}`);
    } catch (error) {
      logger.error(`Failed to send alert email to ${userEmail}: ${error.message}`);
    }
  }
}

module.exports = EmailService;
