import os
import secrets
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

SMTP_HOST  = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT  = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER  = os.environ.get("SMTP_USER", "")
SMTP_PASS  = os.environ.get("SMTP_PASS", "")
EMAIL_FROM = os.environ.get("EMAIL_FROM", "")


def generate_otp() -> str:
    return str(secrets.randbelow(900000) + 100000)


def send_email(to: str, subject: str, html: str) -> bool:
    if not SMTP_USER or not SMTP_PASS:
        return False
    sender = EMAIL_FROM or SMTP_USER
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to
    msg.attach(MIMEText(html, "html"))
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, to, msg.as_string())
        return True
    except Exception:
        return False


def otp_email_html(otp: str, action: str) -> str:
    return f"""
    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#0f172a;color:#e2e8f0;border-radius:16px">
      <h1 style="color:#818cf8;margin-bottom:8px">SplitUp</h1>
      <p style="color:#94a3b8;margin-bottom:24px">{action}</p>
      <div style="background:#1e293b;border-radius:12px;padding:24px;text-align:center">
        <p style="font-size:48px;font-weight:700;letter-spacing:12px;color:#e2e8f0;margin:0">{otp}</p>
      </div>
      <p style="color:#64748b;font-size:13px;margin-top:20px">This code expires in 10 minutes. Do not share it.</p>
    </div>"""
