const { resend, sendOtpEmail } = require('./mailer');

module.exports = {
  resend,
  sendOtpEmail,
  sendOTPEmail: sendOtpEmail
};
