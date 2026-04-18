# Review: Security

> **Review Date:** April 18, 2026  
> **Scope:** Authentication, authorization, input validation, API protection, data exposure

---

## Summary

The application has a solid foundation with Supabase Auth, Zod validation, and RLS policies on all tables. However, **four simulation API routes have zero authentication** — this is the most critical finding in the entire review. Additionally, there is no rate limiting, no CSRF header validation, and several information-disclosure issues.

---

## Findings

### 1. CRITICAL: Simulation API Routes Have No Authentication

**Severity:** 🔴 CRITICAL  
**Files:**

- `src/app/api/sim/run/route.ts`
- `src/app/api/sim/run-due/route.ts`
- `src/app/api/sim/sim-all/route.ts`
- `src/app/api/sim/reset/route.ts`

**Issue:** All four simulation endpoints accept unauthenticated POST requests. Anyone who knows (or guesses) the URL can:

- **Simulate any game** (`/api/sim/run`) — pass any `scheduleId`
- **Simulate all due games** (`/api/sim/run-due`) — trigger batch simulation
- **Simulate the entire season** (`/api/sim/sim-all`) — run all 147+ games
- **Reset the entire season** (`/api/sim/reset`) — **delete all game data, stats, and standings**

These routes use the **service-role key** (admin-level Supabase access) internally, meaning they bypass all RLS policies.

**How the middleware allows this:** The middleware in `src/middleware.ts` explicitly allows `/api/*` routes through without authentication:

```typescript
if (
  pathname.startsWith("/login") ||
  pathname.startsWith("/signup") ||
  pathname.startsWith("/api/") || // ← All API routes bypass middleware auth
  pathname === "/"
) {
  return response;
}
```

Other sensitive API routes (payroll, training/run, challenges/sim) correctly check a Bearer token:

```typescript
const authHeader = request.headers.get("authorization");
if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

**The sim routes simply omit this check entirely.**

**Recommendation:** Add the same Bearer token check to all four sim routes:

```typescript
const authHeader = request.headers.get("authorization");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

---

### 2. HIGH: No Rate Limiting on Any Endpoint

**Severity:** 🟠 HIGH  
**Scope:** All 18 API routes

**Issue:** No rate limiting exists anywhere. An attacker (or misbehaving client) could:

- Hammer the sim endpoint to consume server resources
- Spam trade offers to flood opponents with notifications
- Repeatedly attempt free-agent signings to create race conditions
- DoS the server by triggering expensive operations in parallel

**Note:** `bullmq` and `ioredis` are installed as dependencies but not used for rate limiting or job queuing.

**Recommendation:** Implement rate limiting at the API layer. Options:

- **Vercel Edge Config** — built-in rate limiting if deploying to Vercel
- **Upstash Redis** — lightweight rate limiter compatible with serverless
- **next-rate-limit** — simple middleware for Next.js API routes
- Target: 10 req/min for mutation endpoints, 60 req/min for reads

---

### 3. HIGH: Information Disclosure in Error Messages

**Severity:** 🟠 HIGH  
**Files:** Multiple API routes

**Issue:** Several error responses leak internal data:

**Budget amounts exposed:**

```typescript
// src/app/api/market/sign/route.ts
return NextResponse.json(
  {
    error: `Insufficient funds. Need $${cost}, have $${budget.balance}`,
  },
  { status: 400 },
);
```

**Database error messages forwarded:**

```typescript
// Various routes
if (error) {
  return NextResponse.json({ error: error.message }, { status: 500 });
}
```

Supabase error messages can contain table names, column names, and constraint details — schema information that should not be exposed to clients.

**Recommendation:**

- Replace budget-specific messages with generic: `"Insufficient funds"`
- Replace database errors with generic: `"An internal error occurred"` and log the real error server-side
- Never pass `error.message` from Supabase directly to the response

---

### 4. MEDIUM: No CSRF Header Validation on API Routes

**Severity:** 🟡 MEDIUM  
**Scope:** All POST API routes

**Issue:** The application relies solely on `SameSite` cookie attributes for CSRF protection. While this is reasonable for modern browsers, it doesn't protect against:

- Older browsers that don't support `SameSite`
- Subdomain-based attacks if the app ever runs on a subdomain
- Scenarios where the attacker controls a same-site page

Next.js Server Actions have built-in CSRF protection, but the raw API routes (`/api/*`) do not.

**Recommendation:** Add `Origin` header validation to POST routes:

```typescript
const origin = request.headers.get("origin");
const allowedOrigin = process.env.NEXT_PUBLIC_SITE_URL;
if (origin && origin !== allowedOrigin) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

---

### 5. MEDIUM: No Security Response Headers

**Severity:** 🟡 MEDIUM  
**File:** `next.config.mjs`

**Issue:** No security headers are configured:

- No `Content-Security-Policy` — allows inline scripts/styles, no XSS mitigation
- No `X-Frame-Options` or `frame-ancestors` — app could be embedded in an iframe (clickjacking)
- No `X-Content-Type-Options: nosniff`
- No `Referrer-Policy`
- No `Permissions-Policy`

**Recommendation:** Add security headers in `next.config.mjs`:

```javascript
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];
```

---

### 6. MEDIUM: Service-Role Key Usage Pattern

**Severity:** 🟡 MEDIUM  
**Files:** `src/lib/supabase/service.ts`, various API routes

**Issue:** The service-role key is an admin-level credential that bypasses all RLS policies. Its usage is appropriate in protected routes (payroll, training cron, challenge sim) that require system-level access. However:

- The unprotected sim routes (Finding #1) use it without any auth gate
- There's no audit trail of service-role operations
- If the key leaks (e.g., via error messages or logs), all data is exposed

**Recommendation:**

- Fix Finding #1 first (add auth to sim routes)
- Ensure the service-role key never appears in error messages or client-side code
- Consider rotating the key periodically

---

### 7. LOW: Concurrent Free-Agent Signing Race Condition

**Severity:** 🟢 LOW  
**File:** `src/app/api/market/sign/route.ts`

**Issue:** The signing flow queries the player's status, checks it's `free_agent`, then updates. Between the check and the update, another team could sign the same player.

The code uses `.eq('roster_status', 'free_agent')` in the update clause, which is a good defensive pattern — the update would affect 0 rows if the player was already signed. However, the error handling after this doesn't explicitly check the update count.

**Recommendation:** Check the update's affected row count and return a 409 Conflict if zero:

```typescript
const { count } = await supabase
  .from("players")
  .update({ team_id: team.id, roster_status: "active" })
  .eq("id", playerId)
  .eq("roster_status", "free_agent");

if (count === 0) {
  return NextResponse.json({ error: "Player already signed" }, { status: 409 });
}
```

---

### 8. LOW: Auth Callback Route Security

**Severity:** 🟢 LOW  
**File:** `src/app/auth/callback/route.ts`

**Issue:** The OAuth callback route exchanges a code for a session. This is standard Supabase Auth behavior and appears correct. However, the redirect URL after authentication is not validated against an allow-list, which could enable open-redirect attacks if the callback URL is manipulated.

**Recommendation:** Validate the post-auth redirect URL against `NEXT_PUBLIC_SITE_URL`.

---

## Authentication Coverage Matrix

| Endpoint                       | Auth Type          | Status         |
| ------------------------------ | ------------------ | -------------- |
| `POST /api/provision`          | User Session       | ✅ Protected   |
| `POST /api/challenges/send`    | User Session       | ✅ Protected   |
| `POST /api/challenges/respond` | User Session       | ✅ Protected   |
| `POST /api/challenges/sim`     | Bearer Token       | ✅ Protected   |
| `GET /api/games/[id]`          | Public (read-only) | ✅ Intentional |
| `POST /api/market/sign`        | User Session       | ✅ Protected   |
| `POST /api/market/release`     | User Session       | ✅ Protected   |
| `POST /api/payroll/run`        | Bearer Token       | ✅ Protected   |
| `POST /api/trades/list`        | User Session       | ✅ Protected   |
| `POST /api/trades/offer`       | User Session       | ✅ Protected   |
| `POST /api/trades/respond`     | User Session       | ✅ Protected   |
| `POST /api/trades/withdraw`    | User Session       | ✅ Protected   |
| `POST /api/training/assign`    | User Session       | ✅ Protected   |
| `POST /api/training/run`       | Bearer Token       | ✅ Protected   |
| `POST /api/sim/run`            | **None**           | 🔴 VULNERABLE  |
| `POST /api/sim/run-due`        | **None**           | 🔴 VULNERABLE  |
| `POST /api/sim/sim-all`        | **None**           | 🔴 VULNERABLE  |
| `POST /api/sim/reset`          | **None**           | 🔴 VULNERABLE  |

---

## Summary Table

| #   | Finding                                 | Severity | Category               |
| --- | --------------------------------------- | -------- | ---------------------- |
| 1   | 4 sim routes with zero auth             | CRITICAL | Authentication         |
| 2   | No rate limiting anywhere               | HIGH     | Availability           |
| 3   | Internal data in error messages         | HIGH     | Information Disclosure |
| 4   | No CSRF header validation on API routes | MEDIUM   | CSRF                   |
| 5   | No security response headers            | MEDIUM   | Headers                |
| 6   | Service-role key in unprotected routes  | MEDIUM   | Credential Exposure    |
| 7   | Free-agent signing race condition       | LOW      | Authorization          |
| 8   | Auth callback redirect not validated    | LOW      | Open Redirect          |
