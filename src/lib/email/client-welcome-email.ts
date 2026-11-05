/**
 * The welcome email a new client receives with their portal login.
 *
 * It carries a single-use link to set a password and never a password
 * (KI-091). Client-only on purpose: nothing here is shared with a staff
 * email. This builds the message; it never sends it.
 *
 * Email-client-safe by construction: table layout, inline styles, a system
 * font stack (email clients do not load the app's web fonts), no images, no
 * scripts, and every interpolated value escaped. `text` is the plain-text
 * alternative for clients that do not render HTML.
 */

/** Keep in step with the interval in app_server_claim_client_welcome_email. */
export const ACTIVATION_LINK_DAYS = 7;

export type ClientWelcomeEmailInput = {
  name: string | null;
  email: string;
  /** Absolute URL of the set-password page, token included. */
  activationUrl: string;
};

export type ClientWelcomeEmail = {
  subject: string;
  text: string;
  html: string;
};

const NAVY = "#000d51";
const GOLD = "#c9a449";
const INK = "#1f2637";
const MUTED = "#5b6378";
const HAIRLINE = "#e3e6ee";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** https everywhere; plain http only for a local dev server. */
function safeUrl(value: string): string {
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("The set-password link must be an https URL.");
  }
  return url.toString();
}

export function clientWelcomeEmail(input: ClientWelcomeEmailInput): ClientWelcomeEmail {
  const email = input.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A valid recipient email is required.");
  }

  const activationUrl = safeUrl(input.activationUrl);
  // A display name can fall back to the email address; never greet with that.
  const name = input.name?.trim();
  const greeting = name && !name.includes("@") ? `Hi ${name},` : "Hello,";
  const expiry = `The link works once and expires in ${ACTIVATION_LINK_DAYS} days.`;

  const subject = "Your Wolf Forge client portal is ready";

  const nextSteps = [
    "Open the secure link and choose a password only you know.",
    "Sign in with this email address and your new password.",
    "Your projects, invoices and Tickets with our team are all in the portal.",
  ];

  const text = [
    greeting,
    "",
    "Welcome to Wolf Forge. Your client portal is set up: one place for your projects, invoices and conversations with our team.",
    "",
    "SET YOUR PASSWORD",
    `Your sign-in email: ${email}`,
    `Set your password: ${activationUrl}`,
    expiry,
    "",
    "WHAT HAPPENS NEXT",
    ...nextSteps.map((step) => `- ${step}`),
    "",
    "Questions, or has the link expired? Reply to this email and we will send a new one.",
    "",
    "Please do not forward this email. Until it is used, the link can set your password.",
    "",
    "Wolf Forge",
    `You are receiving this because a Wolf Forge team member created a client portal account for ${email}.`,
  ].join("\n");

  const e = {
    greeting: escapeHtml(greeting),
    email: escapeHtml(email),
    url: escapeHtml(activationUrl),
  };

  /*
   * Label above value, never side by side: at phone width a label column
   * leaves the value ~150px. Stacked, the value has the full width in every
   * client with no media query.
   */
  const detailRow = (label: string, value: string, valueStyle = "") => `
              <tr>
                <td style="padding:12px 0 3px;border-top:1px solid ${HAIRLINE};color:${MUTED};font-size:12px;line-height:16px;">${label}</td>
              </tr>
              <tr>
                <td style="padding:0 0 12px;color:${INK};font-size:15px;line-height:22px;font-weight:600;overflow-wrap:anywhere;${valueStyle}">${value}</td>
              </tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f3f4f8;">Set your password for the Wolf Forge client portal.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f8;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:12px;font-family:${FONT};">
        <tr>
          <td style="padding:26px 32px 22px;background:${NAVY};border-radius:11px 11px 0 0;">
            <span style="color:#ffffff;font-size:15px;font-weight:700;letter-spacing:0.16em;">WOLF FORGE</span>
          </td>
        </tr>
        <tr>
          <td style="height:3px;line-height:3px;font-size:0;background:${GOLD};">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:32px 32px 8px;color:${INK};">
            <p style="margin:0 0 14px;font-size:16px;line-height:24px;">${e.greeting}</p>
            <h1 style="margin:0 0 12px;color:${NAVY};font-size:22px;line-height:30px;font-weight:700;">Your client portal is ready</h1>
            <p style="margin:0;font-size:15px;line-height:24px;color:${INK};">Welcome to Wolf Forge. Your portal is one place for your projects, invoices and conversations with our team.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="${NAVY}" style="border-radius:8px;">
                  <a href="${e.url}" style="display:inline-block;padding:14px 26px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">Set your password</a>
                </td>
              </tr>
            </table>
            <p style="margin:12px 0 0;font-size:13px;line-height:20px;color:${MUTED};">${escapeHtml(expiry)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8f9fc;border:1px solid ${HAIRLINE};border-radius:10px;">
              <tr>
                <td style="padding:16px 20px 6px;">
                  <p style="margin:0 0 4px;color:${NAVY};font-size:12px;font-weight:700;letter-spacing:0.06em;">YOUR SIGN-IN DETAILS</p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${detailRow("Email", e.email)}${detailRow("Button not working? Open this link", `<a href="${e.url}" style="color:${NAVY};text-decoration:underline;">${e.url}</a>`, "font-weight:500;word-break:break-all;")}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px 8px;color:${INK};">
            <p style="margin:0 0 10px;color:${NAVY};font-size:15px;font-weight:700;">What happens next</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${nextSteps
              .map(
                (step) => `
              <tr>
                <td style="width:16px;padding:4px 0;vertical-align:top;color:${NAVY};font-size:15px;line-height:22px;">&#8226;</td>
                <td style="padding:4px 0;font-size:15px;line-height:22px;color:${INK};">${escapeHtml(step)}</td>
              </tr>`,
              )
              .join("")}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 28px;">
            <p style="margin:0 0 10px;font-size:14px;line-height:22px;color:${INK};">Questions, or has the link expired? Reply to this email and we will send a new one.</p>
            <p style="margin:0;font-size:13px;line-height:20px;color:${MUTED};">Please do not forward this email. Until it is used, the link can set your password.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px 24px;border-top:1px solid ${HAIRLINE};">
            <p style="margin:0 0 4px;color:${NAVY};font-size:13px;font-weight:700;">Wolf Forge</p>
            <p style="margin:0;color:${MUTED};font-size:12px;line-height:18px;">You are receiving this because a Wolf Forge team member created a client portal account for ${e.email}.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
