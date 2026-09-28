const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY || 're_placeholder_until_env_configured');

async function sendOtpEmail(toEmail, otpCode) {
  try {
    const response = await resend.emails.send({
      from: 'Archidesk Security <onboarding@resend.dev>',
      to: toEmail,
      subject: 'Your Archidesk Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b;">
          <h2>Your Archidesk Verification Code</h2>
          <p>Enter the following 6-digit code to complete your login:</p>
          <h1 style="letter-spacing: 5px; color: #2563eb; font-size: 32px;">${otpCode}</h1>
          <p>This code will expire in 5 minutes.</p>
        </div>
      `
    });
    if (response && response.error) {
      console.error('[RESEND ERROR] Failed to send email:', response.error);
      return false;
    }
    console.log('[RESEND SUCCESS] Email sent successfully:', response);
    return true;
  } catch (err) {
    console.error('[RESEND ERROR] Failed to send email:', err);
    return false;
  }
}

module.exports = { resend, sendOtpEmail, sendOTPEmail: sendOtpEmail };
