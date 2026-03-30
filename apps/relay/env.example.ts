# =================================================================
# Muster Relay Node — Environment Variables
# =================================================================
# Copy this file to .env and fill in the values.
# Or set them in the systemd service file on the RPi.

# Relay port (default: 4002)
MUSTER_WS_PORT=4002

# Message retention in days (default: 30)
MUSTER_RETENTION_DAYS=30

# =================================================================
# SMTP — Email Verification (optional)
# =================================================================
# If not configured, verification codes are printed to the relay console.
# Uncomment and fill in to enable real email sending.

# --- SendGrid ---
# SMTP_HOST=smtp.sendgrid.net
# SMTP_PORT=587
# SMTP_USER=apikey
# SMTP_PASS=SG.your-api-key-here
# SMTP_FROM=noreply@yourdomain.com

# --- Gmail (for testing) ---
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=your-email@gmail.com
# SMTP_PASS=your-app-password
# SMTP_FROM=your-email@gmail.com
# SMTP_SECURE=false