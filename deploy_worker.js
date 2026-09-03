const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, ".cloudflare_config.json");
if (!fs.existsSync(configPath)) {
  console.error("Missing .cloudflare_config.json");
  process.exit(1);
}

const { accountId, deployToken, d1DatabaseId, scriptName } = JSON.parse(fs.readFileSync(configPath, "utf8"));

const workerPath = path.join(__dirname, "backend", "worker.js");
const workerCode = fs.readFileSync(workerPath, "utf8");

async function deploy() {
  console.log("Deploying worker directly to Cloudflare via API...");
  
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
    console.log("✅ Cloudflare Worker deployed successfully!");
  } else {
    console.error("Deploy error:", data.errors);
  }
}

deploy();