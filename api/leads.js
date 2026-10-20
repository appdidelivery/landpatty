import { createHmac } from "node:crypto";
import { db, firebaseAdmin, send } from "../lib/firebase.js";
import { sanitizeAttribution, legacyCampaignFromAttribution } from "../lib/attribution.js";

const services = new Set([
  "Cabelos e Cachos", "Nail Design", "Sobrancelhas e Micropigmentação",
  "Estética", "Cílios", "Maquiagem", "Depilação", "Massoterapia e Terapias"
]);

function onlyString(v, length = 150) {
  return typeof v === "string" ? v.trim().slice(0, length) : "";
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Não mantemos IP nem telefone em claro nos documentos de controle antispam.
function hashIdentifier(value) {
  const key = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON).private_key;
  return createHmac("sha256", key).update(value).digest("hex").slice(0, 40);
}

function rateLimitBuckets(req, phone, now, database) {
  const fifteenMinutes = 15 * 60 * 1000;
  const day = 24 * 60 * 60 * 1000;
  const collection = database.collection("patty_capture_rate_limits");
  const policies = [
    { prefix: "phone15", value: phone, interval: fifteenMinutes, max: 3 },
    { prefix: "phoneDay", value: phone, interval: day, max: 12 }
  ];
  // Header de IP atribuído pela infraestrutura Vercel (não pelo cliente).
  const ip = onlyString(req.headers["x-vercel-forwarded-for"], 80).split(",")[0].trim();
  if (ip) {
    policies.push({ prefix: "ip15", value: ip, interval: fifteenMinutes, max: 8 });
    policies.push({ prefix: "ipDay", value: ip, interval: day, max: 40 });
  }
  return policies.map(policy => ({
    ref: collection.doc(policy.prefix + "-" + hashIdentifier(policy.value) +
      "-" + String(Math.floor(now / policy.interval))),
    max: policy.max,
    expiration: new Date(now + policy.interval * 2)
  }));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Método não permitido" });
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
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
    const source = body.source === "botao_servico" ? "botao_servico" : "formulario_site";
    if (name.length < 2 || phone.length < 10 || phone.length > 13 ||
        !services.has(service) || !/^PTY-[A-Z0-9]{10,16}$/.test(reference))
      return send(res, 400, { error: "Dados do agendamento inválidos" });

    // Salva primeira e última origem informadas no navegador, com whitelist estrita.
    const attribution = sanitizeAttribution(body.attribution, body.campaign);
    const campaign = legacyCampaignFromAttribution(attribution);
    const cta = body.cta && typeof body.cta === "object" ? body.cta : {};
    const ctaArea = onlyString(cta.area,60);
    const ctaId = onlyString(cta.id,70);
    const ctaProfessional = onlyString(cta.professional,90);
    const ctaReelId = onlyString(cta.reelId,30);

    const database = db();
    const now = Date.now();
    const leadRef = database.collection("patty_leads").doc(reference);
    const buckets = rateLimitBuckets(req, phone, now, database);
    const data = {
      reference, name, phone, service, campaign, attribution,
      cta: {area:ctaArea, id:ctaId, professional:ctaProfessional, reelId:ctaReelId},
      source, status: "novo", revenueCents: null,
      appointmentDate: null, notes: "",
      createdAt: firebaseAdmin().firestore.FieldValue.serverTimestamp(),
      updatedAt: firebaseAdmin().firestore.FieldValue.serverTimestamp(),
      privacyNoticeVersion: "2026-10-19",
      history: [{ status: "novo", at: new Date(now), by: "site" }]
    };

    const created = await database.runTransaction(async tx => {
      // A mesma referência nunca é salva duas vezes, mesmo com envios simultâneos.
      const existing = await tx.get(leadRef);
      if (existing.exists) return false;

      // Todas as leituras vêm antes das gravações, conforme exige o Firestore.
      const snapshots = await Promise.all(buckets.map(item => tx.get(item.ref)));
      for (let i = 0; i < buckets.length; i++) {
        if ((snapshots[i].data()?.count || 0) >= buckets[i].max)
          throw httpError(429, "Muitas solicitações. Aguarde alguns minutos ou fale pelo WhatsApp.");
      }
      for (let i = 0; i < buckets.length; i++) {
        tx.set(buckets[i].ref, {
          count: (snapshots[i].data()?.count || 0) + 1,
          expiresAt: buckets[i].expiration
        });
      }
      tx.create(leadRef, data);
      return true;
    });

    return send(res, created ? 201 : 200, { ok: true, reference });
  } catch (err) {
    if (err.status) return send(res, err.status, { error: err.message });
    console.error("Erro CRM leads:", err.message);
    return send(res, 500, { error: "Não foi possível registrar o contato" });
  }
}
