// Dados de campanha são declarados pelo navegador/anunciante, não verificados com a API Ads.
// Nunca copiar dados pessoais, URL inteira nem query params não autorizados.
export const CLICK_IDS = ["gclid", "gbraid", "wbraid", "fbclid", "msclkid", "ttclid"];
export const TRACKING_FIELDS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_id", "utm_content", "utm_term",
  ...CLICK_IDS, "gad_source", "gad_campaignid", "campaign_id", "adgroup_id",
  "ad_id", "creative", "network", "device", "placement", "matchtype", "keyword"
];
const normalizedValue = (value, length=150) =>
  typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0,length) : "";
function normalizeTouch(touch) {
  const input = touch && typeof touch === "object" && !Array.isArray(touch) ? touch : {};
  const result = {};
  for(const key of TRACKING_FIELDS) {
    const value = normalizedValue(input[key]);
    if (value) result[key] = value;
  }
  const ref = normalizedValue(input.referrerHost,120);
  if (ref && /^[a-z0-9.-]+$/i.test(ref)) result.referrerHost = ref.toLowerCase();
  const path = normalizedValue(input.landingPath,180);
  if(path.startsWith("/") && !path.startsWith("//") && !path.includes("?") && !path.includes("#"))
    result.landingPath = path;
  const stamped = normalizedValue(input.recordedAt,35);
  if(stamped && !Number.isNaN(Date.parse(stamped))) result.recordedAt = stamped;
  return result;
}
function channelFromTouch(touch) {
  if(touch.gclid || touch.gbraid || touch.wbraid) return {name:"Google Ads (ID de clique)",level:"click_id_detected"};
  if(touch.fbclid) return {name:"Meta/Facebook (ID de clique)",level:"click_id_detected"};
  if(touch.msclkid) return {name:"Microsoft Ads (ID de clique)",level:"click_id_detected"};
  if(touch.ttclid) return {name:"TikTok (ID de clique)",level:"click_id_detected"};
  if(touch.utm_source) return {name:"Campanha UTM: "+touch.utm_source,level:"utm_tagged"};
  if(touch.referrerHost) return {name:"Referência: "+touch.referrerHost,level:"referrer_only"};
  return {name:"Direto / não identificado",level:"unknown"};
}
export function sanitizeAttribution(input, legacyCampaign={}) {
  const obj = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const fallback = normalizeTouch(legacyCampaign);
  const first = normalizeTouch(obj.firstTouch);
  const last = normalizeTouch(obj.lastTouch);
  const firstTouch = Object.keys(first).length ? first : fallback;
  const lastTouch = Object.keys(last).length ? last : fallback;
  const firstChannel = channelFromTouch(firstTouch);
  const lastChannel = channelFromTouch(lastTouch);
  return {
    firstTouch, lastTouch,
    firstChannel:firstChannel.name, lastChannel:lastChannel.name,
    firstEvidence:firstChannel.level, lastEvidence:lastChannel.level,
    collectionVersion:"2026-10-v2",
  };
}
export function legacyCampaignFromAttribution(attr) {
  const touch = attr.lastTouch || {};
  const obj={};
  for(const key of TRACKING_FIELDS) if(touch[key])obj[key]=touch[key];
  return obj;
}
