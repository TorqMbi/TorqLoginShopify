import "server-only";

export type OtpChannel = "whatsapp" | "log";

export type OtpSender = {
  channel: OtpChannel;
  send(mobileNumber: string, code: string): Promise<void>;
};

type Env = Record<string, string | undefined>;

type WhatsAppConfig = {
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  language: string;
  graphVersion: string;
};

const WHATSAPP_TIMEOUT_MS = 10_000;

async function sendWhatsAppCode(config: WhatsAppConfig, mobileNumber: string, code: string): Promise<void> {
  const response = await fetch(
    `https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(config.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      // Authentication template: the code fills the body and the copy-code button.
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: mobileNumber.replace(/^\+/, ""),
        type: "template",
        template: {
          name: config.templateName,
          language: { code: config.language },
          components: [
            { type: "body", parameters: [{ type: "text", text: code }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
          ],
        },
      }),
      signal: AbortSignal.timeout(WHATSAPP_TIMEOUT_MS),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`WhatsApp did not accept the reset code message (HTTP ${response.status}): ${detail.slice(0, 300)}`);
  }
}

/**
 * Returns the configured way to deliver reset codes, or null when none is set
 * up. With no sender, the portal keeps the staff-assisted reset flow.
 */
export function getOtpSender(env: Env = process.env): OtpSender | null {
  const provider = env.OTP_PROVIDER?.trim().toLowerCase();

  if (provider === "whatsapp") {
    const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim();
    const templateName = env.WHATSAPP_OTP_TEMPLATE?.trim();
    if (!phoneNumberId || !accessToken || !templateName) return null;
    const config: WhatsAppConfig = {
      phoneNumberId,
      accessToken,
      templateName,
      language: env.WHATSAPP_OTP_TEMPLATE_LANGUAGE?.trim() || "en_US",
      graphVersion: env.WHATSAPP_GRAPH_VERSION?.trim() || "v25.0",
    };
    return { channel: "whatsapp", send: (mobileNumber, code) => sendWhatsAppCode(config, mobileNumber, code) };
  }

  // Local development only: prints the code to the server console.
  if (provider === "log" && env.NODE_ENV !== "production") {
    return {
      channel: "log",
      send: async (mobileNumber, code) => {
        console.info(`[development] Password reset code for ${mobileNumber}: ${code}`);
      },
    };
  }

  return null;
}

export function isOtpResetEnabled(env: Env = process.env): boolean {
  return getOtpSender(env) !== null;
}
