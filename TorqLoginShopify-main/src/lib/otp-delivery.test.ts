import { afterEach, describe, expect, it, vi } from "vitest";
import { getOtpSender, isOtpResetEnabled } from "./otp-delivery";

const whatsappEnv = {
  OTP_PROVIDER: "whatsapp",
  WHATSAPP_PHONE_NUMBER_ID: "1234567890",
  WHATSAPP_ACCESS_TOKEN: "test-token",
  WHATSAPP_OTP_TEMPLATE: "torq_reset_code",
};

describe("getOtpSender", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is off when no provider is set, keeping the staff reset flow", () => {
    expect(getOtpSender({})).toBeNull();
    expect(isOtpResetEnabled({ OTP_PROVIDER: "" })).toBe(false);
  });

  it("is off when the WhatsApp settings are incomplete", () => {
    expect(getOtpSender({ ...whatsappEnv, WHATSAPP_ACCESS_TOKEN: "" })).toBeNull();
    expect(getOtpSender({ ...whatsappEnv, WHATSAPP_OTP_TEMPLATE: undefined })).toBeNull();
  });

  it("allows printing codes to the console only outside production", async () => {
    expect(getOtpSender({ OTP_PROVIDER: "log", NODE_ENV: "production" })).toBeNull();
    const sender = getOtpSender({ OTP_PROVIDER: "log", NODE_ENV: "development" });
    expect(sender?.channel).toBe("log");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await sender!.send("+923001234567", "123456");
    expect(info).toHaveBeenCalledWith(expect.stringContaining("123456"));
  });

  it("sends the code through the WhatsApp authentication template", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const sender = getOtpSender(whatsappEnv);
    expect(sender?.channel).toBe("whatsapp");
    await sender!.send("+923001234567", "042917");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v25.0/1234567890/messages");
    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "923001234567",
      type: "template",
      template: {
        name: "torq_reset_code",
        language: { code: "en_US" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "042917" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "042917" }] },
        ],
      },
    });
  });

  it("reports a failed WhatsApp send", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"bad template"}', { status: 400 })));
    const sender = getOtpSender(whatsappEnv);
    await expect(sender!.send("+923001234567", "123456")).rejects.toThrow("HTTP 400");
  });
});
