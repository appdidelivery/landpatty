import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

for (const file of ["lib/firebase.js", "api/config.js", "api/leads.js", "api/crm/leads.js"]) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
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
  }
  console.log("Validação de sintaxe do MVP concluída");
} finally { rmSync(tmp, { recursive: true, force: true }); }
