import { db, firebaseAdmin, requireStaff, send } from "../../lib/firebase.js";

const statuses = new Set(["novo", "em_contato", "agendado", "atendido", "perdido"]);
const getText = (v, limit) => typeof v === "string" ? v.trim().slice(0, limit) : "";
const encode = doc => {
  const d = doc.data();
  const toIso = v => v?.toDate ? v.toDate().toISOString() : null;
  return { id: doc.id, reference: d.reference, name: d.name, phone: d.phone,
    service: d.service, source: d.source, campaign: d.campaign || {},
    status: d.status, revenueCents: d.revenueCents,
    appointmentDate: d.appointmentDate || null, notes: d.notes || "",
    createdAt: toIso(d.createdAt), updatedAt: toIso(d.updatedAt) };
};

export default async function handler(req, res) {
  if (!["GET", "PATCH"].includes(req.method))
    return send(res, 405, { error: "Método não permitido" });
  try {
    const staff = await requireStaff(req);
    const coll = db().collection("patty_leads");
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
    if ("revenueCents" in body) {
      if (body.revenueCents !== null &&
          (!Number.isSafeInteger(body.revenueCents) || body.revenueCents < 0 || body.revenueCents > 100000000))
        return send(res, 400, { error: "Valor inválido" });
      update.revenueCents = body.revenueCents;
    }
    if ("appointmentDate" in body) {
      if (body.appointmentDate !== null &&
          (typeof body.appointmentDate !== "string" ||
           !/^\d{4}-\d{2}-\d{2}$/.test(body.appointmentDate)))
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
