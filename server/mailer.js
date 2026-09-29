const { google } = require('googleapis');

const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
const refreshToken = (process.env.GMAIL_REFRESH_TOKEN || '').replace(/\s+/g, '');
const senderEmail = (process.env.GMAIL_SENDER || '').trim();

const oauth2Client = new google.auth.OAuth2(
  clientId,
  clientSecret,
  'https://developers.google.com/oauthplayground'
);

oauth2Client.setCredentials({
  refresh_token: refreshToken
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

function createRawEmail(to, subject, htmlContent) {
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const messageParts = [
    `From: Archidesk Security <${senderEmail}>`,
    `To: ${to}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${utf8Subject}`,
    '',
    htmlContent
  ];
  const message = messageParts.join('\n');
  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendOtpEmail(toEmail, otpCode) {
  try {
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b;">
        <h2>Archidesk Verification Code</h2>
        <p>Enter the following 6-digit code to complete your login:</p>
        <h1 style="letter-spacing: 5px; color: #2563eb; font-size: 32px;">${otpCode}</h1>
        <p>This code will expire in 5 minutes.</p>
      </div>
    `;
    const raw = createRawEmail(toEmail, 'Your Archidesk Verification Code', htmlContent);

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw }
    });

    console.log('[GMAIL API SUCCESS] Sent OTP to:', toEmail, res.data.id);
    return true;
  } catch (err) {
    console.error('[GMAIL API ERROR]', err.response?.data || err.message);
    return false;
  }
}

module.exports = {
  sendOtpEmail,
  sendOTPEmail: sendOtpEmail
};

