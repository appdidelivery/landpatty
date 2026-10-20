import { randomBytes } from "node:crypto";
import { db, firebaseAdmin, requireStaff, send } from "../../lib/firebase.js";

const statuses = new Set(["novo", "em_contato", "agendado", "atendido", "perdido"]);
const getText = (v, limit) => typeof v === "string" ? v.trim().slice(0, limit) : "";
const manualSources = new Set(["whatsapp", "instagram", "indicacao", "telefone", "outro"]);
const services = new Set([
  "A definir", "Cabelos e Cachos", "Nail Design",
  "Sobrancelhas e Micropigmentação", "Estética", "Cílios",
  "Maquiagem", "Depilação", "Massoterapia e Terapias"
]);
const validDate = value => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value + "T12:00:00Z")) &&
  new Date(value + "T12:00:00Z").toISOString().startsWith(value);

const encode = doc => {
  const d = doc.data();
  const toIso = v => v?.toDate ? v.toDate().toISOString() : null;
  return { id: doc.id, reference: d.reference, name: d.name, phone: d.phone,
    service: d.service, source: d.source, campaign: d.campaign || {},
    attribution: d.attribution || null, cta: d.cta || null,
    status: d.status, revenueCents: d.revenueCents,
    estimatedRevenueCents: d.estimatedRevenueCents ?? null,
    lostReason: d.lostReason || null, isTest: d.isTest === true,
    appointmentDate: d.appointmentDate || null,
    followUpDate: d.followUpDate || null, notes: d.notes || "",
    createdAt: toIso(d.createdAt), updatedAt: toIso(d.updatedAt) };
};

export default async function handler(req, res) {
  if (!["GET", "POST", "PATCH"].includes(req.method))
    return send(res, 405, { error: "Método não permitido" });
  try {
    const staff = await requireStaff(req);
    const coll = db().collection("patty_leads");
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const name = getText(body.name, 120);
      const phone = getText(body.phone, 24).replace(/\D/g, "");
      const service = getText(body.service, 100) || "A definir";
      const source = getText(body.source, 30);
      const status = getText(body.status, 20) || "novo";
      const notes = getText(body.notes, 600);
      const date = body.appointmentDate || null;
      const followUp = body.followUpDate || null;
      const revenue = body.revenueCents ?? null;
      const expected = body.estimatedRevenueCents ?? null;
      const isTest = body.isTest === true;
      if (name.length < 2 || phone.length < 10 || phone.length > 13 ||
          !services.has(service) || !manualSources.has(source) ||
          !statuses.has(status) || (date && !validDate(date)) || (followUp && !validDate(followUp)) ||
          (revenue !== null && (!Number.isSafeInteger(revenue) || revenue < 0 || revenue > 100000000)) ||
          (expected !== null && (!Number.isSafeInteger(expected) || expected < 0 || expected > 100000000))) {
        return send(res, 400, { error: "Revise nome, telefone, serviço, origem e dados do atendimento" });
      }
      if (status === "agendado" && !date)
        return send(res, 400, { error: "Informe a data do agendamento" });
      if (status === "atendido" && revenue === null)
        return send(res, 400, { error: "Informe o valor recebido, mesmo que seja zero" });
      // Evita duplicar um contato ativo recente quando o atendente tenta salvar duas vezes.
      const recent = await coll.where("phone", "==", phone).limit(10).get();
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const duplicate = recent.docs.find(d => {
        const lead = d.data();
        const ms = lead.createdAt?.toMillis?.() || 0;
        return lead.isTest !== true && lead.service === service && ms >= cutoff && lead.status !== "atendido" && lead.status !== "perdido";
      });
      if (duplicate)
        return send(res, 409, { error: "Este telefone e serviço já têm um lead recente no CRM. Abra o cadastro existente.", reference: duplicate.id });
      const reference = "PTY-" + randomBytes(6).toString("hex").toUpperCase();
      const now = firebaseAdmin().firestore.FieldValue.serverTimestamp();
      await coll.doc(reference).create({
        reference, name, phone, service, source: "cadastro_manual_" + source,
        campaign: {}, status, notes, appointmentDate: date,
        followUpDate: followUp, revenueCents: revenue,
        estimatedRevenueCents: expected, isTest, lostReason: null,
        ...(status === "agendado" ? {bookedAt: now} : {}),
        ...(status === "atendido" ? {completedAt: now} : {}),
        ...(status === "perdido" ? {lostAt: now} : {}),
        createdAt: now, updatedAt: now, updatedBy: staff.email, createdBy: staff.email,
        history: [{status, at: new Date(), by: staff.email}]
      });
      return send(res, 201, {ok: true, reference});
    }
    if (req.method === "GET") {
      let q = coll.orderBy("createdAt", "desc").limit(100);
      if (req.query.cursor) {
        const cursor = await coll.doc(String(req.query.cursor).slice(0, 40)).get();
        if (!cursor.exists) return send(res, 400, { error: "Página inválida" });
        q = q.startAfter(cursor);
      }
      const snap = await q.get();
      return send(res, 200, { leads: snap.docs.map(encode),
        nextCursor: snap.size === 100 ? snap.docs[snap.docs.length - 1].id : null });
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const id = getText(body.id, 40);
    if (!/^PTY-[A-Z0-9]{10,16}$/.test(id))
      return send(res, 400, { error: "Identificador inválido" });
    const update = {};
    if ("status" in body) {
      if (!statuses.has(body.status)) return send(res, 400, { error: "Status inválido" });
      update.status = body.status;
    }
    if ("estimatedRevenueCents" in body) {
      if (body.estimatedRevenueCents !== null &&
          (!Number.isSafeInteger(body.estimatedRevenueCents) ||
           body.estimatedRevenueCents < 0 || body.estimatedRevenueCents > 100000000))
        return send(res, 400, { error: "Previsão de valor inválida" });
      update.estimatedRevenueCents = body.estimatedRevenueCents;
    }
    if ("lostReason" in body) {
      const reasons = ["preco", "horario", "sem_resposta", "desistencia", "outro"];
      if (body.lostReason !== null && !reasons.includes(body.lostReason))
        return send(res, 400, { error: "Motivo de perda inválido" });
      update.lostReason = body.lostReason;
    }
    if ("isTest" in body) {
      if (typeof body.isTest !== "boolean")
        return send(res, 400, { error: "Marcador de teste inválido" });
      update.isTest = body.isTest;
    }
    if ("revenueCents" in body) {
      if (body.revenueCents !== null &&
          (!Number.isSafeInteger(body.revenueCents) || body.revenueCents < 0 || body.revenueCents > 100000000))
        return send(res, 400, { error: "Valor inválido" });
      update.revenueCents = body.revenueCents;
    }
    if ("followUpDate" in body) {
      if (body.followUpDate !== null && !validDate(body.followUpDate))
        return send(res, 400, {error: "Data de retorno inválida"});
      update.followUpDate = body.followUpDate;
    }
    if ("appointmentDate" in body) {
      if (body.appointmentDate !== null && !validDate(body.appointmentDate))
        return send(res, 400, { error: "Data inválida" });
      update.appointmentDate = body.appointmentDate;
    }
    if ("notes" in body) update.notes = getText(body.notes, 600);
    if (!Object.keys(update).length) return send(res, 400, { error: "Sem alterações" });
    const ref = coll.doc(id);
    await db().runTransaction(async tx => {
      const old = await tx.get(ref);
      if (!old.exists) { const e = new Error("Lead não encontrado"); e.status = 404; throw e; }
      update.updatedAt = firebaseAdmin().firestore.FieldValue.serverTimestamp();
      update.updatedBy = staff.email;
      if (update.status && update.status !== old.data().status) {
        const field = {em_contato: "firstContactAt", agendado: "bookedAt",
          atendido: "completedAt", perdido: "lostAt"}[update.status];
        if (field) update[field] = firebaseAdmin().firestore.FieldValue.serverTimestamp();
        update.history = firebaseAdmin().firestore.FieldValue.arrayUnion({
          status: update.status, at: new Date(), by: staff.email
        });
      }
      tx.update(ref, update);
    });
    return send(res, 200, { ok: true });
  } catch (err) {
    if (err.status) return send(res, err.status, { error: err.message });
    console.error("Erro CRM painel:", err.message);
    return send(res, 500, { error: "Falha no CRM" });
  }
}
