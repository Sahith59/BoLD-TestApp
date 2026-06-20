import crypto from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { observeBold } from "./lib/bold.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 3000);
const appOrigin = process.env.APP_ORIGIN || `http://localhost:${port}`;
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${appOrigin}/auth/google/callback`;
const sessionSecret = process.env.SESSION_SECRET || "bold-local-dev-session-secret";

const users = [
  {
    id: "usr_101",
    name: "Maya Chen",
    email: "maya@demo.test",
    password: "password123",
    role: "member",
    company: "Northstar Labs"
  },
  {
    id: "usr_202",
    name: "Leo Martin",
    email: "leo@demo.test",
    password: "password123",
    role: "member",
    company: "HarborOps"
  },
  {
    id: "usr_900",
    name: "Admin User",
    email: "admin@demo.test",
    password: "admin123",
    role: "admin",
    company: "BOLD Support"
  }
];

const invoices = [
  {
    id: "inv_7001",
    ownerId: "usr_101",
    label: "Prototype hosting",
    amount: 184,
    status: "Due",
    due: "2026-06-18",
    accountEmail: "billing@northstar.example"
  },
  {
    id: "inv_7002",
    ownerId: "usr_101",
    label: "Workflow automation",
    amount: 460,
    status: "Paid",
    due: "2026-05-28",
    accountEmail: "ops@northstar.example"
  },
  {
    id: "inv_8101",
    ownerId: "usr_202",
    label: "Customer analytics",
    amount: 920,
    status: "Due",
    due: "2026-06-21",
    accountEmail: "finance@harborops.example"
  },
  {
    id: "inv_8102",
    ownerId: "usr_202",
    label: "Priority support",
    amount: 140,
    status: "Draft",
    due: "2026-07-02",
    accountEmail: "leo@harborops.example"
  }
];

const files = [
  {
    id: "file_3301",
    ownerId: "usr_101",
    name: "northstar-q2-plan.pdf",
    classification: "Private",
    note: "Contains pipeline targets and renewal forecast."
  },
  {
    id: "file_4401",
    ownerId: "usr_202",
    name: "harborops-customers.csv",
    classification: "Confidential",
    note: "Contains active customer export and internal tags."
  }
];

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function monitoredJson(req, res, status, payload, callerId) {
  await observeBold(req, payload, status, { callerId });
  json(res, status, payload);
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function fromBase64Url(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function createSignedValue(payload) {
  const encoded = base64Url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function readSignedValue(value) {
  if (!value || !value.includes(".")) return null;
  const [encoded, signature] = value.split(".");
  const expected = sign(encoded);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return JSON.parse(fromBase64Url(encoded));
}

function setCookie(res, cookie) {
  const existing = res.getHeader("set-cookie");
  if (!existing) {
    res.setHeader("set-cookie", cookie);
    return;
  }
  res.setHeader("set-cookie", Array.isArray(existing) ? [...existing, cookie] : [existing, cookie]);
}

function currentUser(req) {
  const session = readSignedValue(parseCookies(req).bold_session);
  if (!session?.user?.id) return null;
  return users.find((user) => user.id === session.user.id) || session.user;
}

function createSession(res, user) {
  const value = createSignedValue({ user: publicUser(user), createdAt: Date.now() });
  setCookie(res, `bold_session=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/`);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) {
    json(res, 401, { error: "Please sign in first." });
    return null;
  }
  return user;
}

function publicPath(pathname) {
  const safePath = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  return join(publicDir, safePath);
}

async function serveStatic(req, res, pathname) {
  try {
    const file = await readFile(publicPath(pathname));
    const type =
      {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".svg": "image/svg+xml"
      }[extname(pathname === "/" ? "/index.html" : pathname)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function publicUser(user) {
  const { password, googleSub, ...safe } = user;
  return safe;
}

function findOrCreateGoogleUser(profile) {
  const email = profile.email?.toLowerCase();
  let user = users.find((candidate) => candidate.email.toLowerCase() === email);
  if (user) {
    user.googleSub = profile.sub;
    return user;
  }

  user = {
    id: `usr_${crypto.randomInt(1000, 9999)}`,
    name: profile.name || email.split("@")[0],
    email,
    password: null,
    role: "member",
    company: `${profile.given_name || profile.name || "Google"} Workspace`,
    googleSub: profile.sub
  };
  users.push(user);
  invoices.push({
    id: `inv_${crypto.randomInt(9000, 9999)}`,
    ownerId: user.id,
    label: "Google workspace starter plan",
    amount: 49,
    status: "Due",
    due: "2026-07-01",
    accountEmail: user.email
  });
  files.push({
    id: `file_${crypto.randomInt(5000, 9999)}`,
    ownerId: user.id,
    name: "google-onboarding-notes.txt",
    classification: "Private",
    note: "Created automatically for the Google OAuth test account."
  });
  return user;
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

async function handleGoogleStart(req, res) {
  if (!googleClientId || !googleClientSecret) {
    return redirect(res, "/?oauth_error=Google%20OAuth%20is%20not%20configured");
  }

  const state = crypto.randomBytes(24).toString("hex");
  const stateValue = createSignedValue({ state, createdAt: Date.now() });
  setCookie(res, `bold_oauth_state=${encodeURIComponent(stateValue)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: googleRedirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account"
  });
  redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

async function handleGoogleCallback(req, res, url) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = readSignedValue(parseCookies(req).bold_oauth_state);
  setCookie(res, "bold_oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");

  if (!code || !storedState || state !== storedState.state || Date.now() - storedState.createdAt > 10 * 60 * 1000) {
    return redirect(res, "/?oauth_error=Google%20OAuth%20state%20expired");
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: googleRedirectUri,
        grant_type: "authorization_code"
      })
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokens.error_description || tokens.error || "Token exchange failed");

    const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = await profileRes.json();
    if (!profileRes.ok || !profile.email || !profile.sub || profile.email_verified === false) {
      throw new Error("Could not read verified Google profile");
    }

    const user = findOrCreateGoogleUser(profile);
    createSession(res, user);
    redirect(res, "/");
  } catch (error) {
    console.error("Google OAuth failed:", error);
    redirect(res, `/?oauth_error=${encodeURIComponent("Google sign-in failed")}`);
  }
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/oauth/debug") {
    return json(res, 200, {
      appOrigin,
      googleRedirectUri,
      googleClientIdPrefix: googleClientId.slice(0, 12),
      googleClientIdSuffix: googleClientId.slice(-28),
      googleClientSecretConfigured: Boolean(googleClientSecret),
      googleClientIdLooksLikeOAuthClient: googleClientId.endsWith(".apps.googleusercontent.com")
    });
  }

  if (req.method === "POST" && pathname === "/api/login") {
    const body = await readBody(req);
    const user = users.find((candidate) => candidate.email === body.email && candidate.password === body.password);
    if (!user) return json(res, 401, { error: "Invalid email or password." });

    createSession(res, user);
    return json(res, 200, { user: publicUser(user) });
  }

  if (req.method === "POST" && pathname === "/api/register") {
    const body = await readBody(req);
    if (!body.name || !body.email || !body.password) return json(res, 400, { error: "Name, email, and password are required." });
    if (users.some((user) => user.email === body.email)) return json(res, 409, { error: "That email is already registered." });

    const user = {
      id: `usr_${crypto.randomInt(1000, 9999)}`,
      name: body.name,
      email: body.email,
      password: body.password,
      role: "member",
      company: body.company || "New Workspace"
    };
    users.push(user);

    const invoice = {
      id: `inv_${crypto.randomInt(9000, 9999)}`,
      ownerId: user.id,
      label: "Starter subscription",
      amount: 29,
      status: "Due",
      due: "2026-07-01",
      accountEmail: user.email
    };
    invoices.push(invoice);

    createSession(res, user);
    return json(res, 201, { user: publicUser(user) });
  }

  if (req.method === "POST" && pathname === "/api/logout") {
    res.setHeader("set-cookie", "bold_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && pathname === "/api/me") {
    const user = requireUser(req, res);
    if (!user) return;
    return json(res, 200, { user: publicUser(user) });
  }

  if (req.method === "GET" && pathname === "/api/overview") {
    const user = requireUser(req, res);
    if (!user) return;
    const ownInvoices = invoices.filter((invoice) => invoice.ownerId === user.id);
    const ownFiles = files.filter((file) => file.ownerId === user.id);
    return json(res, 200, {
      user: publicUser(user),
      metrics: {
        openInvoices: ownInvoices.filter((invoice) => invoice.status !== "Paid").length,
        privateFiles: ownFiles.length,
        balance: ownInvoices.reduce((sum, invoice) => sum + (invoice.status === "Paid" ? 0 : invoice.amount), 0)
      },
      invoices: ownInvoices.map(({ ownerId, accountEmail, ...invoice }) => invoice),
      files: ownFiles.map(({ ownerId, ...file }) => file)
    });
  }

  if (req.method === "POST" && pathname === "/api/invoices") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const invoice = {
      id: `inv_${crypto.randomInt(1000, 9999)}`,
      ownerId: user.id,
      label: body.label || "Untitled invoice",
      amount: Number(body.amount || 0),
      status: "Draft",
      due: body.due || "2026-07-15",
      accountEmail: user.email
    };
    invoices.push(invoice);
    return json(res, 201, invoice);
  }

  const invoiceMatch = pathname.match(/^\/api\/invoices\/([^/]+)$/);
  if (invoiceMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const invoice = invoices.find((item) => item.id === invoiceMatch[1]);
    if (!invoice) return json(res, 404, { error: "Invoice not found." });

    if (req.method === "GET") {
      // Intentional IDOR/BOLA: authenticated users can fetch invoices they do not own.
      return monitoredJson(req, res, 200, invoice, user.id);
    }

    if (req.method === "PATCH") {
      // Intentional BOLA write flaw: ownership is not checked before updates.
      const body = await readBody(req);
      if (body.status) invoice.status = body.status;
      if (body.label) invoice.label = body.label;
      if (body.amount !== undefined) invoice.amount = Number(body.amount);
      return monitoredJson(req, res, 200, invoice, user.id);
    }
  }

  const fileMatch = pathname.match(/^\/api\/files\/([^/]+)$/);
  if (fileMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const file = files.find((item) => item.id === fileMatch[1]);
    if (!file) return json(res, 404, { error: "File not found." });

    if (req.method === "GET") {
      // Intentional IDOR/BOLA: direct file lookup leaks another user's private metadata.
      return json(res, 200, file);
    }
  }

  if (req.method === "GET" && pathname === "/api/admin/users") {
    const user = requireUser(req, res);
    if (!user) return;
    // Intentional broken function-level authorization: role is not enforced.
    return json(res, 200, {
      requestedBy: user.id,
      users: users.map(publicUser)
    });
  }

  return json(res, 404, { error: "API route not found." });
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/auth/google") {
      await handleGoogleStart(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/auth/google/callback") {
      await handleGoogleCallback(req, res, url);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "Unexpected server error." });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createServer(handler);
  server.listen(port, () => {
    console.log(`BOLD vulnerable demo app running at http://localhost:${port}`);
  });
}
