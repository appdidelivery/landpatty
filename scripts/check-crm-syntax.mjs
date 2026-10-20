import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { sanitizeAttribution, legacyCampaignFromAttribution } from "../lib/attribution.js";

for (const file of ["lib/firebase.js", "lib/attribution.js", "api/config.js", "api/leads.js", "api/crm/leads.js", "api/crm/insights.js"]) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
// Testes independentes de Firebase: dados de origem são limitados e nenhum parâmetro arbitrário passa.
const test = sanitizeAttribution({
  firstTouch:{utm_source:"google",utm_campaign:"123",gclid:"abc-id",landingPath:"/servicos",email:"example@invalid.test"},
  lastTouch:{utm_source:"instagram",fbclid:"fb-test",referrerHost:"www.instagram.com",
    landingPath:"/?secret=123",otherKey:"PRIVATE"}
});
assert.equal(test.firstTouch.utm_source,"google");
assert.equal(test.lastTouch.utm_source,"instagram");
assert.equal(test.firstEvidence,"click_id_detected");
assert.equal(test.lastEvidence,"click_id_detected");
assert.equal(test.firstTouch.email,undefined);
assert.equal(test.lastTouch.otherKey,undefined);
assert.equal(test.lastTouch.landingPath,undefined);
assert.equal(legacyCampaignFromAttribution(test).fbclid,"fb-test");
assert.equal(legacyCampaignFromAttribution(test).gclid,undefined);
assert.equal(sanitizeAttribution({}, {utm_source:"google"}).lastTouch.utm_source,"google");

const tmp = mkdtempSync(join(tmpdir(), "patty-crm-"));
try {
  for (const file of ["index.html", "crm.html"]) {
    const html = readFileSync(file, "utf8");
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter(m => !/type\s*=\s*["']application\/ld\+json/i.test(m[1]) && m[2].trim());
    if (!scripts.length) throw Error("Sem scripts inline em " + file);
    scripts.forEach((script, index) => {
      const filename = join(tmp, "check-" + index + (/\btype\s*=\s*["']module/i.test(script[1]) ? ".mjs" : ".js"));
      writeFileSync(filename, script[2]);
      execFileSync(process.execPath, ["--check", filename], { stdio: "inherit" });
    });
    if (file === "index.html" && (!html.includes("privacy-ack") || !html.includes("/api/leads"))) {
      throw Error("Captação do formulário não presente");
    }
    if (file === "index.html" &&
        (!html.includes('pattyAtribuicao') || !html.includes('patty-reels-cta') ||
         !html.includes('social_outbound_click') || !html.includes('whatsapp_profissional') ||
         !html.includes('pattyUltimoReelId'))) {
      throw Error("Eventos de campanha, Reels ou equipe não encontrados");
    }
    if (file === "crm.html" &&
        (!html.includes('manual-add') || !html.includes('/api/crm/insights') ||
         !html.includes('detail-estimate') || !html.includes('detail-test') ||
         !html.includes('manual-followup'))) {
      throw Error("Painel comercial ou cadastro manual ausente em crm.html");
    }
    if (file === "crm.html" && (!html.includes('insights-campaigns') ||
        !html.includes('insights-ctas') || !html.includes('firstTouch') ||
        !html.includes('lastTouch'))) {
      throw Error("Atribuição no painel ausente");
    }
  }
  console.log("Validação de sintaxe do MVP concluída");
} finally { rmSync(tmp, { recursive: true, force: true }); }
