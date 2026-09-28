const nodemailer = require('nodemailer');

function createTransporter() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_APP_PASSWORD;

  if (!user || !pass) {
    console.warn('⚠️ Nodemailer: EMAIL_USER and/or EMAIL_APP_PASSWORD not set in environment. Simulated emails will be logged to console.');
  }

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: user || '',
      pass: pass || ''
    }
  });
}

const transporter = createTransporter();

async function sendOTPEmail(toEmail, otp) {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_APP_PASSWORD;

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your Archidesk Verification Code</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
        .container { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; padding: 36px 30px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
        .badge { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; background: #0f172a; color: #ffffff; font-size: 20px; border-radius: 10px; margin-bottom: 12px; }
        .title { font-size: 22px; font-weight: 700; color: #0f172a; margin: 0 0 4px; }
        .subtitle { font-size: 13px; color: #64748b; margin: 0 0 24px; }
        .otp-container { background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
        .otp-code { font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #0f172a; margin: 0; }
        .info-text { font-size: 14px; line-height: 1.6; color: #475569; text-align: center; }
        .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8; }
      </style>
    </head>
    <body>
      <div class="container">
        <div style="text-align: center;">
          <div class="badge">📐</div>
          <h1 class="title">SHASWAT DESIGNS</h1>
          <p class="subtitle">Architecture • Engineering • Digital Studio</p>
        </div>

        <p class="info-text">
          Use the 6-digit verification code below to complete your Google sign-in and access your architectural workspace:
        </p>

        <div class="otp-container">
          <div class="otp-code">${otp}</div>
        </div>

        <p class="info-text" style="font-size: 13px; color: #64748b;">
          Your verification code is <strong>${otp}</strong>. It expires in 5 minutes.
        </p>

        <div class="footer">
          If you did not attempt to sign in to SHASWAT DESIGNS, please disregard this email.<br>
          &copy; ${new Date().getFullYear()} SHASWAT DESIGNS • All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  if (!user || !pass) {
    console.log('\n======================================================');
    console.log(`📨 [SIMULATED EMAIL TO: ${toEmail}]`);
    console.log(`🔐 Subject: Your Archidesk Verification Code`);
    console.log(`🔢 Code: ${otp}`);
    console.log(`⏰ Text: Your verification code is ${otp}. It expires in 5 minutes.`);
    console.log('======================================================\n');
    return { simulated: true, otp };
  }

  return await transporter.sendMail({
    from: `"SHASWAT DESIGNS" <${user}>`,
    to: toEmail,
    subject: 'Your Archidesk Verification Code',
    text: `Your verification code is ${otp}. It expires in 5 minutes.`,
    html
  });
}

module.exports = { transporter, sendOTPEmail };
