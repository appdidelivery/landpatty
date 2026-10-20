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
  if (source.startsWith("cadastro_manual_")) {
    const name=source.replace("cadastro_manual_", "");
    const labels={whatsapp:"WhatsApp (informado)",instagram:"Instagram (informado)",
      indicacao:"Indicação (informada)",telefone:"Telefone (informado)",outro:"Outro (informado)",
      google_ads:"Google Ads (informado pela equipe)",meta_ads:"Meta Ads (informado pela equipe)",site:"Site (informado pela equipe)"};
    return labels[name] || "Cadastro manual";
  }
  if (lead.attribution?.lastChannel) return lead.attribution.lastChannel;
  const utm=lead.campaign||{};
  if (utm.gclid || utm.gbraid || utm.wbraid) return "Google Ads (ID de clique)";
  if (utm.fbclid) return "Meta/Facebook (ID de clique)";
  if (utm.msclkid) return "Microsoft Ads (ID de clique)";
  if (utm.utm_source) return "Campanha UTM: "+String(utm.utm_source).slice(0,55);
  return source==="botao_whatsapp"?"Site: outro botão WhatsApp":
    source==="botao_servico"?"Site: botão de serviço":"Site: formulário";
}
function campaignLabel(lead) {
  if ((lead.source||"").startsWith("cadastro_manual_")) return "Manual (sem campanha comprovada)";
  const touch=lead.attribution?.lastTouch || lead.campaign || {};
  const campaign=touch.utm_campaign || touch.utm_id || touch.campaign_id || touch.gad_campaignid;
  return campaign ? String(campaign).slice(0,90) : "Campanha não identificada";
}
function ctaLabel(lead) {
  const data=lead.cta||{};
  if(data.professional) return "Equipe: "+String(data.professional).slice(0,80);
  if(data.reelId) return "Vídeo (Reel): "+String(data.reelId).slice(0,35);
  const labels={servicos:"Botão de serviço",hero:"Formulário principal",
    equipe:"Equipe",flutuante:"WhatsApp flutuante",destaques:"Vídeos em destaque"};
  return labels[data.area] || (lead.source||"").replace("cadastro_manual_","Manual: ") || "Não identificado";
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
    // Fluxo realizado DURANTE a janela: usa a data registrada da mudança de estágio,
    // não a data em que o lead entrou pelo site.
    const completedSnapshot = await coll
      .where("completedAt", ">=", firebaseAdmin().firestore.Timestamp.fromDate(since))
      .limit(MAX_REPORT_RECORDS + 1).get();
    const partialCompleted = completedSnapshot.size > MAX_REPORT_RECORDS;
    const completed = completedSnapshot.docs.slice(0,MAX_REPORT_RECORDS).map(d=>d.data())
      .filter(d=>d.isTest !== true && d.status==="atendido");
    const bookedSnapshot = await coll
      .where("bookedAt", ">=", firebaseAdmin().firestore.Timestamp.fromDate(since))
      .limit(MAX_REPORT_RECORDS + 1).get();
    const partialBookings = bookedSnapshot.size > MAX_REPORT_RECORDS;
    const bookedDuringPeriod = bookedSnapshot.docs.slice(0,MAX_REPORT_RECORDS)
      .map(d=>d.data()).filter(d=>d.isTest !== true);
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
    const followUpsSnapshot = await coll.where("followUpDate", "<=", today)
      .limit(MAX_REPORT_RECORDS + 1).get();
    const partialFollowUps = followUpsSnapshot.size > MAX_REPORT_RECORDS;
    const followUpsDue = followUpsSnapshot.docs.slice(0,MAX_REPORT_RECORDS).map(d => d.data())
      .filter(d => d.isTest !== true && ["novo","em_contato"].includes(d.status));
    const upcoming = appointmentsSnapshot.docs.slice(0,MAX_REPORT_RECORDS)
      .map(d => d.data()).filter(d => d.isTest !== true && d.status === "agendado");

    const stats = {days, since:since.toISOString(), today, through:futureLimit,
      partial:partialCohort || partialAgenda || partialFollowUps || partialCompleted || partialBookings,
      cohort:{leads:docs.length,novos:0,emContato:0,agendados:0,atendidos:0,perdidos:0,
        agendamentoRatePercent:0, realizedRevenueCents:0, attendedWithValue:0,
        attendedWithoutValue:0, averageTicketCents:null, withGoogleAdsAttribution:0},
      agendaNext30Days:{appointments:upcoming.length,withEstimate:0,withoutEstimate:0,
        scheduledValueCents:0},
      periodActivity:{bookingsRecorded:bookedDuringPeriod.length,attended:completed.length,
        realizedRevenueCents:0,withValue:0,withoutValue:0,averageTicketCents:null},
      dueFollowUps:followUpsDue.length,
      byService:[],byChannel:[],byCampaign:[],byCTA:[],lossReasons:[]
    };
    const stages = {novo:"novos",em_contato:"emContato",agendado:"agendados",
      atendido:"atendidos",perdido:"perdidos"};
    const services = new Map(), channels = new Map(), campaigns = new Map(), ctas = new Map(), losses = new Map();
    const labels = {preco:"Preço",horario:"Horário",sem_resposta:"Sem resposta",
      desistencia:"Desistência",outro:"Outro motivo",indefinido:"Não informado"};
    for(const d of docs){
      const stage = stages[d.status];
      if(stage) stats.cohort[stage]++;
      const service = d.service || "Não informado";
      const channel = groupLabel(d);
      const campaign = campaignLabel(d);
      const cta = ctaLabel(d);
      if(!services.has(service))services.set(service,blankGroup(service));
      if(!channels.has(channel))channels.set(channel,blankGroup(channel));
      if(!campaigns.has(campaign))campaigns.set(campaign,blankGroup(campaign));
      if(!ctas.has(cta))ctas.set(cta,blankGroup(cta));
      if(channel === "Google Ads (ID de clique)") stats.cohort.withGoogleAdsAttribution++;
      const earned = d.status === "atendido" ? money(d,"revenueCents") : null;
      for(const group of [services.get(service),channels.get(channel),campaigns.get(campaign),ctas.get(cta)]){
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
    stats.byCampaign = [...campaigns.values()].sort((a,b)=>b.leads-a.leads).slice(0,20);
    stats.byCTA = [...ctas.values()].sort((a,b)=>b.leads-a.leads).slice(0,20);
    stats.lossReasons = [...losses.entries()].map(([name,count])=>({name,count}))
      .sort((a,b)=>b.count-a.count);
    for(const d of completed) {
      const received = money(d,"revenueCents");
      if(received === null) stats.periodActivity.withoutValue++;
      else {
        stats.periodActivity.withValue++;
        stats.periodActivity.realizedRevenueCents += received;
      }
    }
    stats.periodActivity.averageTicketCents = stats.periodActivity.withValue ?
      Math.round(stats.periodActivity.realizedRevenueCents / stats.periodActivity.withValue) : null;
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
