import crypto from "node:crypto";

const DEFAULT_OWNER_FIELDS = [
  "ownerId",
  "owner_id",
  "userId",
  "user_id",
  "accountId",
  "account_id",
  "createdBy",
  "created_by",
  "tenantId",
  "tenant_id"
];

const OBJECT_PATH = /^(.*?)\/([^/]+)\/?$/;
const ID_LIKE = /^[0-9]+$|^[0-9a-fA-F-]{6,}$|^[a-z]+_[0-9a-zA-Z]+$/;

function resolveConfig(config = {}) {
  const ingestUrl = config.ingestUrl ?? process.env.BOLD_INGEST_URL ?? "";
  const ingestKey = config.ingestKey ?? process.env.BOLD_INGEST_KEY ?? "";
  if (!ingestUrl || !ingestKey) return null;

  const ownerFields =
    config.ownerFields ??
    (process.env.BOLD_OWNER_FIELDS
      ? process.env.BOLD_OWNER_FIELDS.split(",").map((field) => field.trim()).filter(Boolean)
      : DEFAULT_OWNER_FIELDS);

  return { ingestUrl, ingestKey, ownerFields };
}

function identityFrom(req) {
  const authMaterial = req.headers.authorization || req.headers.cookie || "";
  if (!authMaterial) return null;
  const digest = crypto.createHash("sha256").update(authMaterial).digest("hex");
  return `id_${digest.slice(0, 16)}`;
}

export function endpointAndObject(pathname) {
  const match = pathname.match(OBJECT_PATH);
  if (!match) return { endpoint: pathname, objectId: null };

  const [, prefix, last] = match;
  if (!ID_LIKE.test(last)) return { endpoint: pathname, objectId: null };
  return { endpoint: `${prefix}/{id}`, objectId: last };
}

export function declaredOwner(json, ownerFields) {
  const look = (object) => {
    for (const field of ownerFields) {
      const value = object[field];
      if (value !== undefined && value !== null) return String(value);
    }
    return null;
  };

  if (json && typeof json === "object" && !Array.isArray(json)) {
    const topLevel = look(json);
    if (topLevel) return topLevel;

    for (const value of Object.values(json)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested = look(value);
        if (nested) return nested;
      }
    }
  }

  return null;
}

function methodToAction(method) {
  const normalized = method.toUpperCase();
  if (["GET", "POST", "PUT", "PATCH", "DELETE"].includes(normalized)) return normalized;
  return null;
}

export function observeBold(req, payload, statusCode, config) {
  const cfg = resolveConfig(config);
  if (!cfg) return;

  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const { endpoint, objectId } = endpointAndObject(url.pathname);
    const method = methodToAction(req.method || "");
    if (!objectId || !method) return;

    const event = {
      identity: identityFrom(req),
      method,
      endpoint,
      object_id: objectId,
      status_code: statusCode,
      declared_owner: declaredOwner(payload, cfg.ownerFields)
    };

    void fetch(cfg.ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.ingestKey}`
      },
      body: JSON.stringify(event),
      keepalive: true
    }).catch(() => {});
  } catch {
    // BoLD monitoring must never alter or break the app being monitored.
  }
}

