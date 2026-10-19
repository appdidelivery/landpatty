import admin from "firebase-admin";

export function firebaseAdmin() {
  if (!admin.apps.length) {
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!json) throw new Error("Firebase service account not configured");
    const serviceAccount = JSON.parse(json);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin;
}

export function db() {
  return firebaseAdmin().firestore();
}

export async function requireStaff(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    const err = new Error("Não autenticado"); err.status = 401; throw err;
  }
  const decoded = await firebaseAdmin().auth().verifyIdToken(authHeader.slice(7), true);
  const allowed = (process.env.CRM_ALLOWED_EMAILS || "")
    .split(",").map(email => email.trim().toLowerCase()).filter(Boolean);
  if (!decoded.email_verified || !decoded.email ||
      !allowed.includes(decoded.email.toLowerCase())) {
    const err = new Error("Acesso não autorizado"); err.status = 403; throw err;
  }
  return decoded;
}

export function send(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(data);
}
