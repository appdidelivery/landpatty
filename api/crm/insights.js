import { db, firebaseAdmin, requireStaff, send } from "../../lib/firebase.js";

const MAX_REPORT_RECORDS = 1000;
const toDateString = date => date.toISOString().slice(0, 10);
const currentSaoPauloDate = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const value = type => parts.find(part => part.type === type)?.value;
  return value("year") + "-" + value("month") + "-" + value("day");
};
const addCalendarDays = (date, days) =>
  toDateString(new Date(Date.parse(date + "T12:00:00Z") + days * 86400000));

function groupLabel(lead) {
  const source = lead.source || "";
  const utm = lead.campaign || {};
  if (source.startsWith("cadastro_manual_")) {
    const name = source.replace("cadastro_manual_", "");
    const labels = {whatsapp:"WhatsApp (manual)",instagram:"Instagram (manual)",
      indicacao:"Indicação (manual)",telefone:"Telefone (manual)",outro:"Outro (manual)"};
    return labels[name] || "Cadastro manual";
  }
  if (utm.gclid || utm.gbraid || utm.wbraid ||
      ((utm.utm_source || "").toLowerCase() === "google" &&
        /(cpc|paid|ppc)/i.test(utm.utm_medium || "")))
    return "Google Ads (identificado)";
  if (utm.utm_source) return "Campanha: " + String(utm.utm_source).slice(0, 55);
  return source === "botao_servico" ? "Site: botão de serviço" : "Site: formulário";
}
function blankGroup(name) {
  return { name, leads:0, agendados:0, atendidos:0, perdidos:0, revenueCents:0,
    appointmentsWithValue:0 };
}
const money = (entry, field) =>
  Number.isSafeInteger(entry[field]) && entry[field] >= 0 ? entry[field] : null;

export default async function handler(req, res) {
  if(req.method !== "GET") return send(res, 405, {error:"Método não permitido"});
  try {
    await requireStaff(req);
    const days = Number(req.query.days) === 30 ? 30 : 7;
    const until = Date.now();
    const since = new Date(until - days * 86400000);
    const coll = db().collection("patty_leads");
    // Coorte: leads CRIADOS dentro do período, com seu estágio ATUAL.
    const recent = await coll.where("createdAt", ">=", firebaseAdmin().firestore.Timestamp.fromDate(since))
      .orderBy("createdAt", "desc").limit(MAX_REPORT_RECORDS + 1).get();
    const partialCohort = recent.size > MAX_REPORT_RECORDS;
    const docs = recent.docs.slice(0,MAX_REPORT_RECORDS).map(d => d.data())
      .filter(d => d.isTest !== true);

    const today = currentSaoPauloDate();
    const futureLimit = addCalendarDays(today, 30);
    // Agenda: compromissos futuros, independentemente de quando o lead foi criado.
    const appointmentsSnapshot = await coll
      .where("appointmentDate", ">=", today)
      .where("appointmentDate", "<=", futureLimit)
      .limit(MAX_REPORT_RECORDS + 1).get();
    const partialAgenda = appointmentsSnapshot.size > MAX_REPORT_RECORDS;
    const upcoming = appointmentsSnapshot.docs.slice(0,MAX_REPORT_RECORDS)
      .map(d => d.data()).filter(d => d.isTest !== true && d.status === "agendado");

    const stats = {days, since:since.toISOString(), today, through:futureLimit,
      partial:partialCohort || partialAgenda,
      cohort:{leads:docs.length,novos:0,emContato:0,agendados:0,atendidos:0,perdidos:0,
        agendamentoRatePercent:0, realizedRevenueCents:0, attendedWithValue:0,
        attendedWithoutValue:0, averageTicketCents:null, withGoogleAdsAttribution:0},
      agendaNext30Days:{appointments:upcoming.length,withEstimate:0,withoutEstimate:0,
        scheduledValueCents:0},
      byService:[],byChannel:[],lossReasons:[]
    };
    const stages = {novo:"novos",em_contato:"emContato",agendado:"agendados",
      atendido:"atendidos",perdido:"perdidos"};
    const services = new Map(), channels = new Map(), losses = new Map();
    const labels = {preco:"Preço",horario:"Horário",sem_resposta:"Sem resposta",
      desistencia:"Desistência",outro:"Outro motivo",indefinido:"Não informado"};
    for(const d of docs){
      const stage = stages[d.status];
      if(stage) stats.cohort[stage]++;
      const service = d.service || "Não informado";
      const channel = groupLabel(d);
      if(!services.has(service))services.set(service,blankGroup(service));
      if(!channels.has(channel))channels.set(channel,blankGroup(channel));
      if(channel === "Google Ads (identificado)") stats.cohort.withGoogleAdsAttribution++;
      const earned = d.status === "atendido" ? money(d,"revenueCents") : null;
      for(const group of [services.get(service),channels.get(channel)]){
        group.leads++;
        if(d.status==="agendado"||d.status==="atendido")group.agendados++;
        if(d.status==="atendido")group.atendidos++;
        if(d.status==="perdido")group.perdidos++;
        if(earned !== null)group.revenueCents += earned;
      }
      if(d.status==="atendido"){
        if(earned !== null){
          stats.cohort.realizedRevenueCents += earned;
          stats.cohort.attendedWithValue++;
        } else stats.cohort.attendedWithoutValue++;
      }
      if(d.status==="perdido"){
        const reason = labels[d.lostReason] || labels.indefinido;
        losses.set(reason,(losses.get(reason)||0)+1);
      }
    }
    const total = stats.cohort.leads;
    const converted = stats.cohort.agendados+stats.cohort.atendidos;
    stats.cohort.agendamentoRatePercent =
      total ? Math.round((converted / total) * 1000) / 10 : 0;
    stats.cohort.averageTicketCents = stats.cohort.attendedWithValue ?
      Math.round(stats.cohort.realizedRevenueCents / stats.cohort.attendedWithValue) : null;
    stats.byService = [...services.values()].sort((a,b)=>b.leads-a.leads).slice(0,15);
    stats.byChannel = [...channels.values()].sort((a,b)=>b.leads-a.leads).slice(0,15);
    stats.lossReasons = [...losses.entries()].map(([name,count])=>({name,count}))
      .sort((a,b)=>b.count-a.count);
    for(const d of upcoming){
      const estimate = money(d,"estimatedRevenueCents");
      if(estimate===null)stats.agendaNext30Days.withoutEstimate++;
      else {
        stats.agendaNext30Days.withEstimate++;
        stats.agendaNext30Days.scheduledValueCents+=estimate;
      }
    }
    return send(res,200,stats);
  }catch(error){
    if(error.status) return send(res,error.status,{error:error.message});
    console.error("Erro ao calcular insights CRM:",error.message);
    return send(res,500,{error:"Não foi possível calcular os indicadores"});
  }
}
