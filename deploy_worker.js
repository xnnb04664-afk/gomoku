const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const configPath = path.join(__dirname, ".cloudflare_config.json");
if (!fs.existsSync(configPath)) {
  console.error("Missing .cloudflare_config.json");
  process.exit(1);
}

const { accountId, deployToken, d1DatabaseId, scriptName } = JSON.parse(fs.readFileSync(configPath, "utf8"));

const workerPath = path.join(__dirname, "backend", "worker.js");
const workerCode = fs.readFileSync(workerPath, "utf8");

// Ensure pages_build exists
if (!fs.existsSync("pages_build")) fs.mkdirSync("pages_build");
fs.writeFileSync("pages_build/index.html", "<h1>Gomoku Backend API Ready</h1>", "utf8");
fs.writeFileSync("pages_build/_worker.js", workerCode, "utf8");

async function deploy() {
  console.log(">>> [1/2] 正在部署到 Cloudflare Workers (脚本: " + scriptName + ")...");
  
  const form = new FormData();
  const metadata = {
    main_module: "worker.js",
    compatibility_date: "2024-09-03",
    bindings: [
      {
        type: "d1",
        name: "DB",
        id: d1DatabaseId
      }
    ]
  };

  form.append("metadata", JSON.stringify(metadata));
  const fileBlob = new Blob([workerCode], { type: "application/javascript+module" });
  form.append("worker.js", fileBlob, "worker.js");

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${deployToken}`
    },
    body: form
  });

  const data = await res.json();
  if (data.success) {
    console.log("✅ [1/2] Cloudflare Worker deployed successfully!");
  } else {
    console.error("Deploy Worker error:", data.errors);
  }

  console.log(">>> [2/2] 正在部署到 Cloudflare Pages (国内极速直连: gomoku-api.pages.dev)...");
  try {
    const out = execSync("npx wrangler pages deploy pages_build --project-name gomoku-api --branch main --commit-dirty=true", {
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: deployToken },
      encoding: "utf8"
    });
    console.log("✅ [2/2] Cloudflare Pages deployed successfully!");
  } catch(e) {
    console.warn("Pages deploy warning:", e.stdout || e.message);
  }
}

deploy();