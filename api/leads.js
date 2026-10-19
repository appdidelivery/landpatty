import { db, firebaseAdmin, send } from "../lib/firebase.js";

const services = new Set([
  "Cabelos e Cachos", "Nail Design", "Sobrancelhas e Micropigmentação",
  "Estética", "Cílios", "Maquiagem", "Depilação", "Massoterapia e Terapias"
]);
function onlyString(v, length = 150) {
  return typeof v === "string" ? v.trim().slice(0, length) : "";
}

async function verifyTurnstile(token) {
  const body = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET_KEY,
    response: token
  });
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(5000)
  });
  return response.ok && (await response.json()).success === true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Método não permitido" });
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON || !process.env.TURNSTILE_SECRET_KEY)
    return send(res, 503, { error: "Captação CRM ainda não configurada" });
  const allowed = (process.env.CRM_ALLOWED_ORIGINS ||
    "https://www.pattycentrodebeleza.com.br,https://pattycentrodebeleza.com.br")
    .split(",").map(x => x.trim()).filter(Boolean);
  if (!allowed.includes(req.headers.origin))
    return send(res, 403, { error: "Origem não permitida" });
  if (Number(req.headers["content-length"] || 0) > 12000)
    return send(res, 413, { error: "Requisição muito grande" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    if (body.website) return send(res, 200, { ok: true }); // honeypot
    if (body.privacyAcknowledged !== true)
      return send(res, 400, { error: "Confirme a ciência do aviso de privacidade" });
    const name = onlyString(body.name, 120);
    const phone = onlyString(body.phone, 24).replace(/\D/g, "");
    const service = onlyString(body.service, 100);
    const reference = onlyString(body.reference, 30);
    if (name.length < 2 || phone.length < 10 || phone.length > 13 ||
        !services.has(service) || !/^PTY-[A-Z0-9]{10,16}$/.test(reference))
      return send(res, 400, { error: "Dados do agendamento inválidos" });
    if (!body.turnstileToken || !(await verifyTurnstile(body.turnstileToken)))
      return send(res, 400, { error: "Verificação de segurança não concluída" });

    const campaign = {};
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_id",
                        "utm_content", "utm_term", "gclid", "gbraid", "wbraid"])
      campaign[key] = onlyString(body.campaign?.[key], 150);
    const data = {
      reference, name, phone, service, campaign,
      source: "formulario_site", status: "novo", revenueCents: null,
      appointmentDate: null, notes: "", createdAt: firebaseAdmin().firestore.FieldValue.serverTimestamp(),
      updatedAt: firebaseAdmin().firestore.FieldValue.serverTimestamp(),
      privacyNoticeVersion: "2026-10-19",
      history: [{ status: "novo", at: new Date(), by: "site" }]
    };
    try {
      await db().collection("patty_leads").doc(reference).create(data);
    } catch (err) {
      if (err.code !== 6 && err.code !== "already-exists") throw err;
      // Idempotência: mesmo ID não gera lead duplicado.
    }
    return send(res, 201, { ok: true, reference });
  } catch (err) {
    console.error("Erro CRM leads:", err.message);
    return send(res, 500, { error: "Não foi possível registrar o contato" });
  }
}
