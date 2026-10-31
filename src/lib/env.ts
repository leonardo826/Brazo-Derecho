export function appUrl() {
  return (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
}

export function whatsappEnv() {
  return {
    token: process.env.WHATSAPP_TOKEN?.trim() ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN?.trim() ?? "",
    appSecret: process.env.WHATSAPP_APP_SECRET?.trim() ?? "",
  };
}
