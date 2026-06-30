/**
 * API client. The browser never holds a model key and never calls Anthropic (that
 * is the server gateway's job). For local dev it obtains a real signed JWT per role
 * from /auth/dev-token (the genuine verified-JWT path; see server routes/auth.ts),
 * caches it per role, and attaches it as a Bearer token. In production this is
 * replaced by the SSO session token. TODO(fable5): swap dev-token for the SSO flow.
 */
import type { Role } from "@hr-os/contracts";

const BASE: string =
  (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ??
  "http://localhost:8080";

/**
 * Profile D disables the dev-token route, so in demo we obtain a short-lived,
 * tenant-pinned session token from /demo/session instead. Both endpoints return
 * { token }. In production this is replaced by the SSO session token.
 */
const DEMO: boolean =
  (import.meta as unknown as { env?: { VITE_DEMO_MODE?: string } }).env?.VITE_DEMO_MODE === "true";
const AUTH_PATH = DEMO ? "/demo/session" : "/auth/dev-token";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

const tokenCache = new Map<Role, string>();

async function tokenFor(role: Role): Promise<string> {
  const cached = tokenCache.get(role);
  if (cached) return cached;
  const res = await fetch(`${BASE}${AUTH_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new ApiError(`could not obtain session token (HTTP ${res.status})`, res.status);
  const data = (await res.json()) as { token: string };
  tokenCache.set(role, data.token);
  return data.token;
}

async function authed<T>(role: Role, path: string, init?: RequestInit): Promise<T> {
  const token = await tokenFor(role);
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ApiError(res.status === 403 ? "forbidden" : `request failed (HTTP ${res.status})`, res.status);
  return (await res.json()) as T;
}

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export interface PersonRow {
  id: string;
  file_number: string;
  first_name: string;
  last_name: string;
  status: string;
  worksite: string | null;
  title: string | null;
  employment_type: string;
  pay?: number | null;
  pay_unit?: string | null;
}
export interface CompRow {
  id: string;
  last_name: string;
  title: string | null;
  amount: number;
  unit: string;
  effective_date: string;
  hours_worked_12mo: number | null;
}
export interface BandRow {
  id: string;
  title_key: string;
  unit: string;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  confidence: number | null;
  locked: boolean;
}
export interface LeaveCaseRow {
  id: string;
  worker_id: string;
  first_name: string;
  last_name: string;
  reason_id: string;
  designation: string[] | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  intermittent: boolean;
  priority: string;
  jurisdiction: string;
}

export const api = {
  base: BASE,
  getPeople: (role: Role) => authed<{ rows: PersonRow[]; payVisible: boolean; masked: string[] }>(role, "/people"),
  getCompRecords: (role: Role) => authed<{ rows: CompRow[] }>(role, "/comp/records"),
  getBands: (role: Role) => authed<{ rows: BandRow[] }>(role, "/comp/bands"),
  getLeaveCases: (role: Role) => authed<{ rows: LeaveCaseRow[] }>(role, "/leave/cases"),
  eligibility: (role: Role, body: Record<string, unknown>) =>
    authed<{ eligibility: { eligible: boolean; tenureMonths: number; hoursLast12mo: number; reasons: { tenure: boolean; hours: boolean } }; suggestedClocks: string[] }>(
      role,
      "/leave/eligibility",
      jsonPost(body),
    ),
  createLeaveCase: (role: Role, body: Record<string, unknown>) =>
    authed<{ case: Record<string, unknown> }>(role, "/leave/cases", jsonPost(body)),

  /** AI dispatch over SSE. Calls onEvent(eventName, data) for each frame. */
  async aiDispatch(
    role: Role,
    body: Record<string, unknown>,
    onEvent: (event: string, data: unknown) => void,
  ): Promise<void> {
    const token = await tokenFor(role);
    const res = await fetch(`${BASE}/ai/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      // 422 PII block / 429 rate / 400 — surface as a synthetic event.
      let detail: unknown = undefined;
      try { detail = await res.json(); } catch { /* no body */ }
      onEvent("error", { status: res.status, detail });
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const f of frames) {
        let ev = "message";
        let data = "";
        for (const line of f.split("\n")) {
          if (line.startsWith("event:")) ev = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (data) {
          try { onEvent(ev, JSON.parse(data)); } catch { onEvent(ev, data); }
        }
      }
    }
  },
};
