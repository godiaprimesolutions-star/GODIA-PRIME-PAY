
/**
 * GODIA PRIME PAY
 * Cloudflare Worker
 * Safaricom Daraja PRODUCTION
 *
 * OWNER-ONLY PAYMENT MANAGEMENT
 *
 * EXISTING BINDINGS:
 * DB = D1 database
 * ASSETS = Static assets
 *
 * CLOUDFLARE SECRETS:
 * OWNER_PASSWORD
 * MPESA_CONSUMER_KEY
 * MPESA_CONSUMER_SECRET
 * MPESA_PASSKEY
 * MPESA_CALLBACK_TOKEN
 * MPESA_CALLBACK_URL
 * PAYMENT_API_KEY
 *
 * EXISTING DATABASE TABLE:
 * gp_payments
 */

const APP_NAME = "GODIA PRIME PAY";
const MPESA_API = "https://api.safaricom.co.ke";

const SHORTCODE = "1222123";
const TILL = "1692851";
const TRANSACTION_TYPE = "CustomerBuyGoodsOnline";

const SESSION_COOKIE = "gpp_owner_session";
const SESSION_DURATION = 12 * 60 * 60;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

// ================================================
// RESPONSE HELPERS
// ================================================

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(JSON_HEADERS);

  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }

  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

function errorResponse(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

// ================================================
// SECURITY HELPERS
// ================================================

function bytesToBase64Url(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padded = normalized + "=".repeat(
    (4 - normalized.length % 4) % 4
  );

  const binary = atob(padded);

  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function hmac(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign", "verify"]
  );

  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(message)
    )
  );
}

function safeCompare(a, b) {
  if (!a || !b || a.length !== b.length) {
    return false;
  }

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

async function verifyOwnerPassword(input, env) {
  if (
    typeof input !== "string" ||
    !env.OWNER_PASSWORD ||
    input.length < 1 ||
    input.length > 256
  ) {
    return false;
  }

  const submitted = await hmac(
    "GODIA-PRIME-PAY-OWNER:" + input,
    env.OWNER_PASSWORD
  );

  const expected = await hmac(
    "GODIA-PRIME-PAY-OWNER:" + env.OWNER_PASSWORD,
    env.OWNER_PASSWORD
  );

  // Compare HMACs of the submitted and configured passwords.
  return safeCompare(
    submitted,
    await hmac(
      "GODIA-PRIME-PAY-OWNER:" + env.OWNER_PASSWORD,
      env.OWNER_PASSWORD
    )
  ) && input === env.OWNER_PASSWORD;
}

// ================================================
// SESSION MANAGEMENT
// ================================================

async function createSession(env) {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_DURATION;

  const random = crypto.randomUUID();

  const payload = expiry + "." + random;

  const signature = await hmac(
    payload,
    env.OWNER_PASSWORD
  );

  return payload + "." + bytesToBase64Url(signature);
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";

  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");

    if (index < 0) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key === name) {
      return value;
    }
  }

  return null;
}

async function verifySession(request, env) {
  if (!env.OWNER_PASSWORD) return false;

  const token = getCookie(request, SESSION_COOKIE);

  if (!token) return false;

  const parts = token.split(".");

  if (parts.length !== 3) return false;

  const expiry = Number(parts[0]);
  const random = parts[1];

  if (
    !Number.isSafeInteger(expiry) ||
    expiry <= Math.floor(Date.now() / 1000) ||
    expiry > Math.floor(Date.now() / 1000) + SESSION_DURATION + 60 ||
    !/^[0-9a-f-]{36}$/i.test(random)
  ) {
    return false;
  }

  const payload = parts[0] + "." + random;

  try {
    const expected = await hmac(
      payload,
      env.OWNER_PASSWORD
    );

    const received = base64UrlToBytes(parts[2]);

    return safeCompare(expected, received);
  } catch {
    return false;
  }
}

function sessionCookie(value, maxAge = SESSION_DURATION) {
  return (
    SESSION_COOKIE + "=" + value +
    "; Path=/" +
    "; HttpOnly" +
    "; Secure" +
    "; SameSite=Strict" +
    "; Max-Age=" + maxAge
  );
}

function clearSessionCookie() {
  return (
    SESSION_COOKIE + "=" +
    "; Path=/" +
    "; HttpOnly" +
    "; Secure" +
    "; SameSite=Strict" +
    "; Max-Age=0"
  );
}

async function requireOwner(request, env) {
  return verifySession(request, env);
}

// ================================================
// REQUEST PROTECTION
// ================================================

function sameOrigin(request) {
  const origin = request.headers.get("Origin");

  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// ================================================
// APPLICATION CONFIGURATION
// ================================================

function configured(env) {
  return Boolean(
    env.DB &&
    env.OWNER_PASSWORD &&
    env.MPESA_CONSUMER_KEY &&
    env.MPESA_CONSUMER_SECRET &&
    env.MPESA_PASSKEY &&
    env.MPESA_CALLBACK_TOKEN &&
    env.MPESA_CALLBACK_URL &&
    env.PAYMENT_API_KEY
  );
}

function paymentConfigured(env) {
  return Boolean(
    env.DB &&
    env.MPESA_CONSUMER_KEY &&
    env.MPESA_CONSUMER_SECRET &&
    env.MPESA_PASSKEY &&
    env.MPESA_CALLBACK_TOKEN &&
    env.MPESA_CALLBACK_URL
  );
}

// ================================================
// PHONE VALIDATION
// ================================================

function normalizePhone(value) {
  let phone = String(value || "").replace(/\D/g, "");

  if (phone.startsWith("0")) {
    phone = "254" + phone.slice(1);
  } else if (
    phone.startsWith("7") ||
    phone.startsWith("1")
  ) {
    phone = "254" + phone;
  }

  if (!/^254[17]\d{8}$/.test(phone)) {
    throw new Error(
      "Enter a valid Kenyan M-Pesa phone number."
    );
  }

  return phone;
}

// ================================================
// TIMESTAMP AND ENCODING
// ================================================

function createTimestamp() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const values = {};

  for (const part of parts) {
    values[part.type] = part.value;
  }

  return (
    values.year +
    values.month +
    values.day +
    values.hour +
    values.minute +
    values.second
  );
}

function base64(value) {
  return btoa(value);
}

// ================================================
// DARAJA AUTHENTICATION
// ================================================

async function getMpesaToken(env) {
  const credentials = base64(
    env.MPESA_CONSUMER_KEY +
    ":" +
    env.MPESA_CONSUMER_SECRET
  );

  const response = await fetch(
    MPESA_API +
    "/oauth/v1/generate?grant_type=client_credentials",
    {
      headers: {
        Authorization: "Basic " + credentials
      }
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error("Daraja authentication failed.");
  }

  return data.access_token;
}

// ================================================
// CALLBACK URL
// ================================================

function getCallbackUrl(env) {
  const url = new URL(env.MPESA_CALLBACK_URL);

  if (url.protocol !== "https:") {
    throw new Error("Callback URL must use HTTPS.");
  }

  url.searchParams.set(
    "token",
    env.MPESA_CALLBACK_TOKEN
  );

  return url.toString();
}

// ================================================
// PAYMENT REFERENCE
// ================================================

function createReference(value) {
  const reference = String(value || "GODIAPAY")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 12);

  if (!reference) {
    throw new Error("Invalid payment reference.");
  }

  return reference;
}

// ================================================
// OWNER LOGIN
// ================================================

async function ownerLogin(request, env) {
  if (!env.OWNER_PASSWORD) {
    return errorResponse(
      "Owner password is not configured.",
      503
    );
  }

  if (!sameOrigin(request)) {
    return errorResponse("Invalid request origin.", 403);
  }

  const input = await readJson(request);

  if (!input || typeof input.password !== "string") {
    return errorResponse("Enter your owner password.");
  }

  if (input.password.length > 256) {
    return errorResponse("Invalid password.");
  }

  const valid = input.password === env.OWNER_PASSWORD;

  if (!valid) {
    return errorResponse("Incorrect owner password.", 401);
  }

  const session = await createSession(env);

  return json({
    ok: true,
    message: "Owner login successful."
  }, 200, {
    "Set-Cookie": sessionCookie(session)
  });
}

async function ownerLogout(request) {
  if (!sameOrigin(request)) {
    return errorResponse("Invalid request origin.", 403);
  }

  return json({
    ok: true,
    message: "Logged out."
  }, 200, {
    "Set-Cookie": clearSessionCookie()
  });
}

async function ownerMe(request, env) {
  const authenticated = await requireOwner(request, env);

  return json({
    ok: true,
    authenticated
  });
}

// ================================================
// STK PUSH
// ================================================

async function initiatePayment(request, env) {
  if (!(await requireOwner(request, env))) {
    return errorResponse("Please log in first.", 401);
  }

  if (!paymentConfigured(env)) {
    return errorResponse(
      "Payment configuration incomplete.",
      503
    );
  }

  if (!sameOrigin(request)) {
    return errorResponse("Invalid request origin.", 403);
  }

  const input = await readJson(request);

  if (!input) {
    return errorResponse("Invalid request data.");
  }

  let phone;
  let reference;

  try {
    phone = normalizePhone(input.phone);
    reference = createReference(input.reference);
  } catch (error) {
    return errorResponse(error.message);
  }

  const amount = Number(input.amount);

  if (
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    amount > 250000
  ) {
    return errorResponse(
      "Amount must be between KES 1 and KES 250,000."
    );
  }

  try {
    const timestamp = createTimestamp();

    const password = base64(
      SHORTCODE +
      env.MPESA_PASSKEY +
      timestamp
    );

    const token = await getMpesaToken(env);

    const payload = {
      BusinessShortCode: SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: TRANSACTION_TYPE,
      Amount: amount,
      PartyA: phone,
      PartyB: TILL,
      PhoneNumber: phone,
      CallBackURL: getCallbackUrl(env),
      AccountReference: reference,
      TransactionDesc: "GODIA PRIME PAY"
    };

    const response = await fetch(
      MPESA_API + "/mpesa/stkpush/v1/processrequest",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const result = await response.json();

    if (
      !response.ok ||
      !result.CheckoutRequestID ||
      !result.MerchantRequestID
    ) {
      return errorResponse(
        result.errorMessage ||
        result.ResponseDescription ||
        "Safaricom rejected the payment request.",
        502
      );
    }

    await env.DB.prepare(`
      INSERT INTO gp_payments (
        checkout_id,
        merchant_id,
        phone,
        amount,
        reference,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP)
    `).bind(
      result.CheckoutRequestID,
      result.MerchantRequestID,
      phone,
      amount,
      reference
    ).run();

    return json({
      ok: true,
      message: "STK Push sent. Enter your M-Pesa PIN.",
      checkoutRequestId: result.CheckoutRequestID,
      merchantRequestId: result.MerchantRequestID,
      customerMessage: result.CustomerMessage || ""
    });

  } catch (error) {
    console.error("STK error:", error.message);

    return errorResponse(
      "Unable to initiate payment.",
      500
    );
  }
}

// ================================================
// M-PESA CALLBACK
// PUBLIC SAFARICOM ENDPOINT
// ================================================

async function processCallback(request, env, url) {
  if (!env.DB || !env.MPESA_CALLBACK_TOKEN) {
    return json({
      ResultCode: 1,
      ResultDesc: "Callback not configured."
    }, 503);
  }

  if (
    url.searchParams.get("token") !==
    env.MPESA_CALLBACK_TOKEN
  ) {
    return json({
      ResultCode: 1,
      ResultDesc: "Unauthorized callback."
    }, 401);
  }

  const body = await readJson(request);

  if (!body) {
    return json({
      ResultCode: 1,
      ResultDesc: "Invalid callback."
    }, 400);
  }

  const callback = body?.Body?.stkCallback;

  if (
    !callback ||
    !callback.CheckoutRequestID ||
    callback.ResultCode === undefined
  ) {
    return json({
      ResultCode: 1,
      ResultDesc: "Invalid callback structure."
    }, 400);
  }

  try {
    const checkoutId = callback.CheckoutRequestID;

    const existing = await env.DB.prepare(`
      SELECT checkout_id, status, amount, phone
      FROM gp_payments
      WHERE checkout_id = ?
    `).bind(checkoutId).first();

    if (!existing) {
      return json({
        ResultCode: 1,
        ResultDesc: "Unknown transaction."
      }, 404);
    }

    if (
      existing.status === "PAID" ||
      existing.status === "FAILED"
    ) {
      return json({
        ResultCode: 0,
        ResultDesc: "Transaction already processed."
      });
    }

    const metadata = {};

    for (
      const item of callback.CallbackMetadata?.Item || []
    ) {
      metadata[item.Name] = item.Value;
    }

    const resultCode = Number(callback.ResultCode);

    let status = "FAILED";
    let receipt = null;
    let paidAmount = null;
    let paidPhone = null;
    let transactionDate = null;

    if (resultCode === 0) {
      paidAmount = Number(metadata.Amount);

      paidPhone = metadata.PhoneNumber
        ? String(metadata.PhoneNumber)
        : null;

      receipt = metadata.MpesaReceiptNumber || null;

      transactionDate = metadata.TransactionDate
        ? String(metadata.TransactionDate)
        : null;

      if (
        !receipt ||
        paidAmount !== Number(existing.amount) ||
        paidPhone !== existing.phone
      ) {
        return json({
          ResultCode: 1,
          ResultDesc: "Payment verification failed."
        }, 400);
      }

      status = "PAID";
    }

    await env.DB.prepare(`
      UPDATE gp_payments
      SET
        status = ?,
        result_code = ?,
        result_description = ?,
        mpesa_receipt = ?,
        paid_amount = ?,
        paid_phone = ?,
        transaction_date = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE checkout_id = ?
        AND status = 'PENDING'
    `).bind(
      status,
      resultCode,
      String(callback.ResultDesc || "").slice(0, 250),
      receipt,
      paidAmount,
      paidPhone,
      transactionDate,
      checkoutId
    ).run();

    return json({
      ResultCode: 0,
      ResultDesc: "Accepted"
    });

  } catch (error) {
    console.error("Callback error:", error.message);

    return json({
      ResultCode: 1,
      ResultDesc: "Callback processing failed."
    }, 500);
  }
}

// ================================================
// PAYMENT HISTORY
// ================================================

async function paymentHistory(request, env, url) {
  if (!(await requireOwner(request, env))) {
    return errorResponse("Please log in first.", 401);
  }

  if (!env.DB) {
    return errorResponse("Database unavailable.", 503);
  }

  const limitValue = Number(url.searchParams.get("limit") || 50);

  const limit = Math.min(
    100,
    Math.max(
      1,
      Number.isSafeInteger(limitValue) ? limitValue : 50
    )
  );

  try {
    const result = await env.DB.prepare(`
      SELECT
        checkout_id,
        merchant_id,
        phone,
        amount,
        reference,
        status,
        mpesa_receipt,
        result_code,
        result_description,
        paid_amount,
        paid_phone,
        transaction_date,
        created_at,
        updated_at
      FROM gp_payments
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(limit).all();

    return json({
      ok: true,
      payments: result.results || []
    });

  } catch (error) {
    console.error("History error:", error.message);

    return errorResponse(
      "Unable to retrieve payment history.",
      500
    );
  }
}

// ================================================
// PAYMENT STATUS
// ================================================

async function paymentStatus(request, env, url) {
  if (!(await requireOwner(request, env))) {
    return errorResponse("Please log in first.", 401);
  }

  if (!env.DB) {
    return errorResponse("Database unavailable.", 503);
  }

  const checkoutId = url.searchParams.get(
    "checkoutRequestId"
  );

  if (!checkoutId) {
    return errorResponse(
      "CheckoutRequestID required."
    );
  }

  try {
    const payment = await env.DB.prepare(`
      SELECT
        checkout_id,
        merchant_id,
        phone,
        amount,
        reference,
        status,
        mpesa_receipt,
        result_code,
        result_description,
        paid_amount,
        paid_phone,
        transaction_date,
        created_at,
        updated_at
      FROM gp_payments
      WHERE checkout_id = ?
    `).bind(checkoutId).first();

    if (!payment) {
      return errorResponse("Payment not found.", 404);
    }

    return json({
      ok: true,
      payment
    });

  } catch (error) {
    console.error("Status error:", error.message);

    return errorResponse(
      "Unable to retrieve payment status.",
      500
    );
  }
}

// ================================================
// MAIN WORKER
// ================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    try {
      // PUBLIC HEALTH CHECK
      if (
        path === "/api/health" &&
        method === "GET"
      ) {
        return json({
          ok: true,
          app: APP_NAME,
          environment: env.ENVIRONMENT || "production",
          payments: paymentConfigured(env)
            ? "configured"
            : "not-configured",
          ownerLogin: Boolean(env.OWNER_PASSWORD),
          database: Boolean(env.DB),
          shortcode: SHORTCODE,
          till: TILL,
          transactionType: TRANSACTION_TYPE
        });
      }

      // OWNER LOGIN
      if (
        path === "/api/auth/login" &&
        method === "POST"
      ) {
        return await ownerLogin(request, env);
      }

      // OWNER LOGOUT
      if (
        path === "/api/auth/logout" &&
        method === "POST"
      ) {
        return await ownerLogout(request);
      }

      // OWNER SESSION CHECK
      if (
        path === "/api/auth/me" &&
        method === "GET"
      ) {
        return await ownerMe(request, env);
      }

      // M-PESA CALLBACK
      if (
        path === "/api/mpesa/callback" &&
        method === "POST"
      ) {
        return await processCallback(request, env, url);
      }

      // OWNER-ONLY PAYMENT INITIATION
      if (
        path === "/api/mpesa/stk-push" &&
        method === "POST"
      ) {
        return await initiatePayment(request, env);
      }

      // OWNER-ONLY PAYMENT STATUS
      if (
        path === "/api/mpesa/status" &&
        method === "GET"
      ) {
        return await paymentStatus(request, env, url);
      }

      // OWNER-ONLY PAYMENT HISTORY
      if (
        path === "/api/mpesa/history" &&
        method === "GET"
      ) {
        return await paymentHistory(request, env, url);
      }

      if (path.startsWith("/api/")) {
        return errorResponse(
          "API route not found.",
          404
        );
      }

      // WEBSITE ASSETS
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return errorResponse(
        "Static assets are not configured.",
        503
      );

    } catch (error) {
      console.error("Worker error:", error.message);

      return errorResponse(
        "Internal server error.",
        500
      );
    }
  }
};
