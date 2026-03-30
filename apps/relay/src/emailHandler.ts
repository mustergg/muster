/**
 * Email handler — manages email registration and verification.
 *
 * For now, the verification code is logged to the relay console
 * (visible to the node operator). In production, this would use
 * nodemailer with an external SMTP service.
 *
 * To enable real email sending, set these environment variables:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 */

import { UserDB } from './userDB';
import type { RelayClient } from './types';

// Optional: nodemailer for real email sending
let transporter: any = null;

async function initMailer(): Promise<void> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.log('[email] No SMTP configured — verification codes will be logged to console.');
    return;
  }

  try {
    // @ts-ignore — nodemailer is optional, only needed if SMTP is configured
    const nodemailer = await import('nodemailer');
    transporter = nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    console.log(`[email] SMTP configured: ${host}:${process.env.SMTP_PORT || '587'}`);
  } catch (err) {
    console.warn('[email] Failed to init nodemailer — codes will be logged to console.');
  }
}

// Initialize on load
initMailer();

async function sendVerificationEmail(email: string, code: string, username: string): Promise<void> {
  if (transporter) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@muster.gg',
        to: email,
        subject: 'Muster — Email Verification Code',
        text: `Hello ${username},\n\nYour verification code is: ${code}\n\nThis code expires in 24 hours.\n\n— Muster`,
        html: `<p>Hello <strong>${username}</strong>,</p><p>Your verification code is: <strong style="font-size:24px;letter-spacing:4px">${code}</strong></p><p>This code expires in 24 hours.</p><p>— Muster</p>`,
      });
      console.log(`[email] Verification code sent to ${email.slice(0, 3)}***`);
    } catch (err) {
      console.error('[email] Failed to send:', err);
      // Fall through to console log
    }
  }

  // Always log to console (for development / no-SMTP setups)
  console.log(`[email] ====================================`);
  console.log(`[email]  VERIFICATION CODE for ${username}`);
  console.log(`[email]  Code: ${code}`);
  console.log(`[email] ====================================`);
}

export function handleEmailMessage(
  client: RelayClient,
  msg: any,
  userDB: UserDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  switch (msg.type) {
    case 'REGISTER_EMAIL':
      handleRegisterEmail(client, msg, userDB, sendToClient);
      break;
    case 'VERIFY_EMAIL':
      handleVerifyEmail(client, msg, userDB, sendToClient);
      break;
    case 'RESEND_VERIFICATION':
      handleResendVerification(client, userDB, sendToClient);
      break;
    case 'ACCOUNT_INFO_REQUEST':
      handleAccountInfoRequest(client, userDB, sendToClient);
      break;
  }
}

function handleRegisterEmail(
  client: RelayClient, msg: any, userDB: UserDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  const { email } = msg.payload || {};

  if (!email || !email.includes('@')) {
    sendToClient(client, {
      type: 'EMAIL_REGISTERED',
      payload: { success: false, message: 'Please enter a valid email address.' },
      timestamp: Date.now(),
    });
    return;
  }

  const result = userDB.registerEmail(client.publicKey, email);

  if (result.error) {
    sendToClient(client, {
      type: 'EMAIL_REGISTERED',
      payload: { success: false, message: result.error },
      timestamp: Date.now(),
    });
    return;
  }

  // Send the code
  sendVerificationEmail(email, result.code, client.username);

  sendToClient(client, {
    type: 'EMAIL_REGISTERED',
    payload: { success: true, message: 'Verification code sent! Check your email (or relay console).' },
    timestamp: Date.now(),
  });
}

function handleVerifyEmail(
  client: RelayClient, msg: any, userDB: UserDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  const { code } = msg.payload || {};

  if (!code) {
    sendToClient(client, {
      type: 'EMAIL_VERIFIED',
      payload: { success: false, tier: 'basic', message: 'Please enter the verification code.' },
      timestamp: Date.now(),
    });
    return;
  }

  const result = userDB.verifyEmail(client.publicKey, code);

  if (!result.success) {
    sendToClient(client, {
      type: 'EMAIL_VERIFIED',
      payload: { success: false, tier: 'basic', message: result.error || 'Verification failed.' },
      timestamp: Date.now(),
    });
    return;
  }

  // Send updated account info
  sendToClient(client, {
    type: 'EMAIL_VERIFIED',
    payload: { success: true, tier: 'verified', message: 'Email verified! Your account is now fully unlocked.' },
    timestamp: Date.now(),
  });

  // Also send updated account info
  const info = userDB.getAccountInfo(client.publicKey);
  sendToClient(client, {
    type: 'ACCOUNT_INFO',
    payload: info,
    timestamp: Date.now(),
  });
}

function handleResendVerification(
  client: RelayClient, userDB: UserDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  const user = userDB.getUser(client.publicKey);
  if (!user || user.tier === 'verified') {
    sendToClient(client, {
      type: 'EMAIL_REGISTERED',
      payload: { success: false, message: 'Account is already verified.' },
      timestamp: Date.now(),
    });
    return;
  }

  if (!user.emailHash) {
    sendToClient(client, {
      type: 'EMAIL_REGISTERED',
      payload: { success: false, message: 'No email registered. Register an email first.' },
      timestamp: Date.now(),
    });
    return;
  }

  // Generate a new code (we don't have the original email, so code goes to console only)
  const code = UserDB.generateCode();
  const expiry = Date.now() + 24 * 60 * 60 * 1000;

  // Can't re-send to email since we only store the hash — log to console
  console.log(`[email] ====================================`);
  console.log(`[email]  RESEND: Verification code for ${user.username}`);
  console.log(`[email]  Code: ${code}`);
  console.log(`[email] ====================================`);

  // Update the code in DB
  userDB['db'].prepare(
    'UPDATE users SET verificationCode = ?, verificationExpiry = ? WHERE publicKey = ?'
  ).run(code, expiry, client.publicKey);

  sendToClient(client, {
    type: 'EMAIL_REGISTERED',
    payload: { success: true, message: 'New verification code generated. Check relay console or email.' },
    timestamp: Date.now(),
  });
}

function handleAccountInfoRequest(
  client: RelayClient, userDB: UserDB,
  sendToClient: (client: RelayClient, msg: Record<string, unknown>) => void,
): void {
  const info = userDB.getAccountInfo(client.publicKey);
  sendToClient(client, {
    type: 'ACCOUNT_INFO',
    payload: info,
    timestamp: Date.now(),
  });
}
