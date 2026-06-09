const authView = document.querySelector("#auth-view");
const appView = document.querySelector("#app-view");
const loginTab = document.querySelector("#login-tab");
const registerTab = document.querySelector("#register-tab");
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const authError = document.querySelector("#auth-error");
const logoutButton = document.querySelector("#logout-button");
const newInvoiceButton = document.querySelector("#new-invoice-button");

const workspaceTitle = document.querySelector("#workspace-title");
const metricInvoices = document.querySelector("#metric-invoices");
const metricFiles = document.querySelector("#metric-files");
const metricBalance = document.querySelector("#metric-balance");
const invoiceList = document.querySelector("#invoice-list");
const fileList = document.querySelector("#file-list");
const detailTitle = document.querySelector("#detail-title");
const detailOutput = document.querySelector("#detail-output");

const oauthError = new URLSearchParams(window.location.search).get("oauth_error");
if (oauthError) {
  authError.textContent = oauthError;
  window.history.replaceState({}, "", window.location.pathname);
}

function setMode(mode) {
  const isLogin = mode === "login";
  loginTab.classList.toggle("active", isLogin);
  registerTab.classList.toggle("active", !isLogin);
  loginForm.classList.toggle("hidden", !isLogin);
  registerForm.classList.toggle("hidden", isLogin);
  authError.textContent = "";
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function showApp() {
  authView.classList.add("hidden");
  appView.classList.remove("hidden");
}

function showAuth() {
  appView.classList.add("hidden");
  authView.classList.remove("hidden");
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function renderOverview(data) {
  showApp();
  workspaceTitle.textContent = `${data.user.company}`;
  metricInvoices.textContent = String(data.metrics.openInvoices);
  metricFiles.textContent = String(data.metrics.privateFiles);
  metricBalance.textContent = money(data.metrics.balance);

  invoiceList.innerHTML = "";
  for (const invoice of data.invoices) {
    const button = document.createElement("button");
    button.className = "row";
    button.type = "button";
    button.innerHTML = `<strong>${invoice.label}</strong><span>${invoice.id} · ${invoice.status} · ${money(invoice.amount)}</span>`;
    button.addEventListener("click", () => loadInvoice(invoice.id));
    invoiceList.append(button);
  }

  fileList.innerHTML = "";
  for (const file of data.files) {
    const button = document.createElement("button");
    button.className = "row";
    button.type = "button";
    button.innerHTML = `<strong>${file.name}</strong><span>${file.id} · ${file.classification}</span>`;
    button.addEventListener("click", () => loadFile(file.id));
    fileList.append(button);
  }

  if (!data.invoices.length) invoiceList.textContent = "No invoices yet.";
  if (!data.files.length) fileList.textContent = "No private files yet.";
}

async function loadOverview() {
  try {
    const data = await api("/api/overview");
    renderOverview(data);
  } catch {
    showAuth();
  }
}

async function loadInvoice(id) {
  const invoice = await api(`/api/invoices/${encodeURIComponent(id)}`);
  detailTitle.textContent = invoice.label;
  detailOutput.textContent = JSON.stringify(invoice, null, 2);
}

async function loadFile(id) {
  const file = await api(`/api/files/${encodeURIComponent(id)}`);
  detailTitle.textContent = file.name;
  detailOutput.textContent = JSON.stringify(file, null, 2);
}

loginTab.addEventListener("click", () => setMode("login"));
registerTab.addEventListener("click", () => setMode("register"));

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify(formData(loginForm)) });
    await loadOverview();
  } catch (error) {
    authError.textContent = error.message;
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";
  try {
    await api("/api/register", { method: "POST", body: JSON.stringify(formData(registerForm)) });
    await loadOverview();
  } catch (error) {
    authError.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  showAuth();
});

newInvoiceButton.addEventListener("click", async () => {
  await api("/api/invoices", {
    method: "POST",
    body: JSON.stringify({
      label: "Custom service package",
      amount: 240,
      due: "2026-07-12"
    })
  });
  await loadOverview();
});

loadOverview();
