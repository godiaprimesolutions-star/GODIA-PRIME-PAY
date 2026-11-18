/**
 * GODIA PRIME PAY
 * Cloudflare Worker
 * Safaricom Daraja PRODUCTION
 *
 * Transaction: CustomerBuyGoodsOnline
 *
 * BINDINGS:
 * DB     = D1 database
 * ASSETS = Static assets
 *
 * ENCRYPTED SECRETS:
 * MPESA_CONSUMER_KEY
 * MPESA_CONSUMER_SECRET
 * MPESA_PASSKEY
 * MPESA_CALLBACK_TOKEN
 * MPESA_CALLBACK_URL
 * PAYMENT_API_KEY
 */

const APP_NAME = "GODIA PRIME PAY";
const MPESA_API = "https://api.safaricom.co.ke";

const SHORTCODE = "1222123";
const TILL = "1692851";
const TRANSACTION_TYPE = "CustomerBuyGoodsOnline";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

// ================================================
// RESPONSE
// ================================================

function json(data, status = 200, env = {}) {
  const headers = new Headers(JSON_HEADERS);

  if (env.ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", env.ALLOWED_ORIGIN);
    headers.set("Vary", "Origin");
  }

  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

// ================================================
// SECURITY
// ================================================

function authorized(request, env) {
  return Boolean(
    env.PAYMENT_API_KEY &&
    request.headers.get("Authorization") ===
      "Bearer " + env.PAYMENT_API_KEY
  );
}

function configured(env) {
  return Boolean(
    env.DB &&
    env.MPESA_CONSUMER_KEY &&
    env.MPESA_CONSUMER_SECRET &&
    env.MPESA_PASSKEY &&
    env.MPESA_CALLBACK_TOKEN &&
    env.MPESA_CALLBACK_URL &&
    env.PAYMENT_API_KEY
  );
}

// ================================================
// PHONE VALIDATION
// ================================================

function normalizePhone(value) {
  let phone = String(value || "").replace(/\D/g, "");

  if (phone.startsWith("0")) {
    phone = "254" + phone.slice(1);
  } else if (phone.startsWith("7") || phone.startsWith("1")) {
    phone = "254" + phone;
  }

  if (!/^254[17]\d{8}$/.test(phone)) {
    throw new Error("Enter a valid Kenyan M-Pesa phone number.");
  }

  return phone;
}

// ================================================
// TIMESTAMP
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
    env.MPESA_CONSUMER_KEY + ":" + env.MPESA_CONSUMER_SECRET
  );

  const response = await fetch(
    MPESA_API + "/oauth/v1/generate?grant_type=client_credentials",
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

  url.searchParams.set("token", env.MPESA_CALLBACK_TOKEN);
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
// STK PUSH
// ================================================

async function initiatePayment(request, env) {
  if (!authorized(request, env)) {
    return json({ ok: false, error: "Unauthorized." }, 401, env);
  }

  if (!configured(env)) {
    return json({
      ok: false,
      error: "Payment configuration incomplete."
    }, 503, env);
  }

  let input;

  try {
    input = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request data." }, 400, env);
  }

  let phone;
  let reference;

  try {
    phone = normalizePhone(input.phone);
    reference = createReference(input.reference);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400, env);
  }

  const amount = Number(input.amount);

  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 250000) {
    return json({
      ok: false,
      error: "Amount must be between KES 1 and KES 250,000."
    }, 400, env);
  }

  try {
    const timestamp = createTimestamp();
    const password = base64(SHORTCODE + env.MPESA_PASSKEY + timestamp);
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
      return json({
        ok: false,
        error:
          result.errorMessage ||
          result.ResponseDescription ||
          "Safaricom rejected the payment request."
      }, 502, env);
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
    }, 200, env);

  } catch (error) {
    console.error("STK error:", error.message);
    return json({
      ok: false,
      error: "Unable to initiate payment."
    }, 500, env);
  }
}

// ================================================
// M-PESA CALLBACK
// ================================================

async function processCallback(request, env, url) {
  if (!env.DB || !env.MPESA_CALLBACK_TOKEN) {
    return json({
      ResultCode: 1,
      ResultDesc: "Callback not configured."
    }, 503, env);
  }

  if (url.searchParams.get("token") !== env.MPESA_CALLBACK_TOKEN) {
    return json({
      ResultCode: 1,
      ResultDesc: "Unauthorized callback."
    }, 401, env);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      ResultCode: 1,
      ResultDesc: "Invalid callback."
    }, 400, env);
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
    }, 400, env);
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
      }, 404, env);
    }

    if (existing.status === "PAID" || existing.status === "FAILED") {
      return json({
        ResultCode: 0,
        ResultDesc: "Transaction already processed."
      }, 200, env);
    }

    const metadata = {};

    for (const item of callback.CallbackMetadata?.Item || []) {
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
      paidPhone = metadata.PhoneNumber ? String(metadata.PhoneNumber) : null;
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
        }, 400, env);
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
    }, 200, env);

  } catch (error) {
    console.error("Callback error:", error.message);
    return json({
      ResultCode: 1,
      ResultDesc: "Callback processing failed."
    }, 500, env);
  }
}

// ================================================
// PAYMENT STATUS
// ================================================

async function paymentStatus(request, env, url) {
  if (!authorized(request, env)) {
    return json({ ok: false, error: "Unauthorized." }, 401, env);
  }

  if (!env.DB) {
    return json({ ok: false, error: "Database unavailable." }, 503, env);
  }

  const checkoutId = url.searchParams.get("checkoutRequestId");

  if (!checkoutId) {
    return json({
      ok: false,
      error: "CheckoutRequestID required."
    }, 400, env);
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
        transaction_date,
        created_at,
        updated_at
      FROM gp_payments
      WHERE checkout_id = ?
    `).bind(checkoutId).first();

    if (!payment) {
      return json({ ok: false, error: "Payment not found." }, 404, env);
    }

    return json({ ok: true, payment }, 200, env);

  } catch (error) {
    console.error("Status error:", error.message);
    return json({
      ok: false,
      error: "Unable to retrieve payment status."
    }, 500, env);
  }
}

// ================================================
// MAIN WORKER
// ================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      const headers = {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400"
      };

      if (env.ALLOWED_ORIGIN) {
        headers["Access-Control-Allow-Origin"] = env.ALLOWED_ORIGIN;
      }

      return new Response(null, { status: 204, headers });
    }

    try {
      if (path === "/api/health" && request.method === "GET") {
        return json({
          ok: true,
          app: APP_NAME,
          environment: env.ENVIRONMENT || "production",
          payments: configured(env) ? "configured" : "not-configured",
          database: Boolean(env.DB),
          shortcode: SHORTCODE,
          till: TILL,
          transactionType: TRANSACTION_TYPE
        }, 200, env);
      }

      if (path === "/api/mpesa/stk-push" && request.method === "POST") {
        return await initiatePayment(request, env);
      }

      if (path === "/api/mpesa/callback" && request.method === "POST") {
        return await processCallback(request, env, url);
      }

      if (path === "/api/mpesa/status" && request.method === "GET") {
        return await paymentStatus(request, env, url);
      }

      if (path.startsWith("/api/")) {
        return json({ ok: false, error: "API route not found." }, 404, env);
      }

      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return json({
        ok: false,
        error: "Static assets are not configured."
      }, 503, env);

    } catch (error) {
      console.error("Worker error:", error.message);
      return json({
        ok: false,
        error: "Internal server error."
      }, 500, env);
    }
  }
};
