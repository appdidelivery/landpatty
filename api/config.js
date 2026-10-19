import { send } from "../lib/firebase.js";

export default function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Método não permitido" });
  return send(res, 200, {
    firebase: {
      apiKey: process.env.FIREBASE_WEB_API_KEY || "",
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
      projectId: process.env.FIREBASE_PROJECT_ID || "",
      appId: process.env.FIREBASE_WEB_APP_ID || ""
    },
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || "",
    captureEnabled: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON &&
      process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY)
  });
}
