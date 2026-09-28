const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY || 're_placeholder_until_env_configured');

async function sendOtpEmail(toEmail, otpCode) {
  try {
    if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY.startsWith('re_placeholder')) {
      console.log(`\n📨 [SIMULATED RESEND EMAIL TO: ${toEmail}] (Configure RESEND_API_KEY in .env to dispatch live emails)`);
      console.log(`🔐 Subject: Your Archidesk Verification Code`);
      console.log(`🔢 Code: ${otpCode} (Valid for 5 minutes)\n`);
      return true;
    }

    const { data, error } = await resend.emails.send({
      from: 'Archidesk Security <onboarding@resend.dev>',
      to: toEmail,
      subject: 'Your Archidesk Verification Code',
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
          <h2>Archidesk Verification Code</h2>
          <p>Your 6-digit one-time code is:</p>
          <h1 style="letter-spacing: 5px; color: #2563eb;">${otpCode}</h1>
          <p>This code will expire in 5 minutes.</p>
        </div>
      `
    });
    if (error) {
      console.error('[RESEND ERROR]', error);
      return false;
    }
    console.log('[RESEND SUCCESS] Sent code to:', toEmail, data);
    return true;
  } catch (err) {
    console.error('[RESEND EXCEPTION]', err);
    return false;
  }
}

module.exports = { resend, sendOtpEmail, sendOTPEmail: sendOtpEmail };
