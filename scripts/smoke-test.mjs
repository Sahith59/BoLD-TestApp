import { spawn } from "node:child_process";
import { observeBold } from "../lib/bold.js";

const port = 3137;
const base = `http://localhost:${port}`;
const server = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});

function assertBoldMonitorEvent() {
  let captured = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true };
  };

  try {
    observeBold(
      {
        method: "GET",
        url: "/api/invoices/inv_8101",
        headers: {
          host: "localhost:3137",
          cookie: "bold_session=test-session"
        }
      },
      { id: "inv_8101", ownerId: "usr_202", amount: 920 },
      200,
      {
        ingestUrl: "https://bold.example.test/api/live/ingest",
        ingestKey: "test-key",
        ownerFields: ["ownerId"]
      }
    );

    const event = JSON.parse(captured.options.body);
    if (captured.url !== "https://bold.example.test/api/live/ingest") throw new Error("BoLD ingest URL was not used.");
    if (captured.options.headers.authorization !== "Bearer test-key") throw new Error("BoLD ingest key was not used.");
    if (event.method !== "GET") throw new Error("BoLD event method was not captured.");
    if (event.endpoint !== "/api/invoices/{id}") throw new Error("BoLD endpoint template was not captured.");
    if (event.object_id !== "inv_8101") throw new Error("BoLD object id was not captured.");
    if (event.status_code !== 200) throw new Error("BoLD status code was not captured.");
    if (event.declared_owner !== "usr_202") throw new Error("BoLD declared owner was not captured.");
    if (!event.identity?.startsWith("id_")) throw new Error("BoLD identity hash was not captured.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  for (let index = 0; index < 40; index += 1) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return;
    } catch {
      await wait(100);
    }
  }
  throw new Error("Server did not start.");
}

async function login(email) {
  const res = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password123" })
  });
  if (!res.ok) throw new Error(`Login failed for ${email}`);
  return res.headers.get("set-cookie").split(";")[0];
}

async function get(path, cookie) {
  const res = await fetch(`${base}${path}`, { headers: { cookie } });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path} failed: ${JSON.stringify(body)}`);
  return body;
}

async function patch(path, cookie, payload) {
  const res = await fetch(`${base}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(payload)
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path} failed: ${JSON.stringify(body)}`);
  return body;
}

try {
  assertBoldMonitorEvent();
  await waitForServer();
  const mayaCookie = await login("maya@demo.test");
  const leoCookie = await login("leo@demo.test");

  const mayaOverview = await get("/api/overview", mayaCookie);
  const leoOverview = await get("/api/overview", leoCookie);

  if (mayaOverview.invoices.some((invoice) => invoice.id === "inv_8101")) {
    throw new Error("Normal overview leaked Leo invoice into Maya account.");
  }
  if (leoOverview.invoices.some((invoice) => invoice.id === "inv_7001")) {
    throw new Error("Normal overview leaked Maya invoice into Leo account.");
  }

  const leakedInvoice = await get("/api/invoices/inv_8101", mayaCookie);
  if (leakedInvoice.ownerId !== "usr_202") throw new Error("IDOR invoice check did not expose Leo-owned invoice.");

  const leakedFile = await get("/api/files/file_4401", mayaCookie);
  if (leakedFile.ownerId !== "usr_202") throw new Error("IDOR file check did not expose Leo-owned file.");

  const updatedInvoice = await patch("/api/invoices/inv_8102", mayaCookie, { status: "Paid" });
  if (updatedInvoice.ownerId !== "usr_202" || updatedInvoice.status !== "Paid") {
    throw new Error("BOLA write check did not update Leo-owned invoice.");
  }

  const adminUsers = await get("/api/admin/users", mayaCookie);
  if (!adminUsers.users.some((user) => user.role === "admin")) {
    throw new Error("Broken function authorization check did not expose admin user list.");
  }

  console.log("Smoke test passed: BoLD metadata is emitted; normal usage is scoped; intentional BOLA/IDOR routes are reachable.");
} finally {
  server.kill("SIGTERM");
}
