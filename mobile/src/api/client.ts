/**
 * API client.
 *
 * One rule worth keeping: rule refusals from the server are not errors to be
 * swallowed. A 422 carrying a fiqh explanation is a real answer and the UI
 * needs the whole payload, so it is surfaced as a typed result rather than a
 * thrown exception with a lost body.
 */

import { say } from '../lang';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

/**
 * Session state.
 *
 * The slug is no longer read from config. It comes back from the login
 * response, because the server decides which institution a user belongs to.
 * A client that picks its own slug is a client that can ask for someone
 * else's ledger.
 */
let TOKEN: string | null = null;
let SLUG = '';
let onExpired: (() => void) | null = null;

export function setSession(token: string | null, slug = '') {
  TOKEN = token;
  SLUG = slug;
}

export function onSessionExpired(cb: () => void) {
  onExpired = cb;
}

let onMustChange: (() => void) | null = null;

export function onPasswordChangeRequired(cb: () => void) {
  onMustChange = cb;
}

export interface Session {
  token: string;
  name: string;
  role: 'admin' | 'treasurer' | 'auditor' | 'committee';
  institution_slug: string;
  institution?: string;
  email?: string;
  must_change_password?: boolean;
}

export function canApprove(role: Session['role'] | undefined): boolean {
  return role === 'committee' || role === 'admin';
}

export function canSeeDonors(role: Session['role'] | undefined): boolean {
  return role !== 'committee';
}

export interface Approval {
  id: string;
  kind: 'spend' | 'reversal';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  amount: string;
  fund_code: string | null;
  purpose: string | null;
  description: string;
  target_reference: string | null;
  result_reference: string | null;
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  can_decide: boolean;
  can_cancel: boolean;
}

export interface ReceiptInfo {
  number: string;
  institution: string;
  reference: string;
  donor_name: string | null;
  amount: string;
  fund_ms: string;
  fund_en: string;
  description: string;
  issued_by: string | null;
  issued_at: string;
  valid: boolean;
}

export interface Answer {
  answered: boolean;
  intent: string | null;
  lang: 'ms' | 'en';
  text_ms: string;
  text_en: string;
  rows: { label_ms: string; label_en: string; value: string }[];
  basis_ms: string | null;
  basis_en: string | null;
  links: { label_ms: string; label_en: string; href: string }[];
  suggestions: string[];
  context: { intent: string; funds: string[]; period: string | null } | null;
  as_of: string;
}

export interface Person {
  id: string;
  name: string;
  email: string | null;
  role: Session['role'];
  active: boolean;
  must_change_password: boolean;
}

/** Sent with a form so a retry after a lost connection is recorded once. */
export function newRequestId(): string {
  const r = () => Math.random().toString(36).slice(2, 12);
  return `${Date.now().toString(36)}-${r()}${r()}`;
}

export function canWrite(role: Session['role'] | undefined): boolean {
  return role === 'treasurer' || role === 'admin';
}

export type FundCategory =
  | 'zakat'
  | 'sadaqah'
  | 'infaq'
  | 'waqf_principal'
  | 'waqf_income'
  | 'nazar'
  | 'fidyah'
  | 'khairat';

export interface Fund {
  id: string;
  code: string;
  category: FundCategory;
  label_ms: string;
  label_en: string;
  balance: string;
  provisional: string;
  spendable: boolean;
  constraint_note: string;
}

export interface Txn {
  reference: string;
  description: string;
  occurred_at: string;
  channel: string;
  status: 'provisional' | 'confirmed' | 'void';
  amount: string;
  direction?: 'in' | 'out' | null;
  fund_code?: string | null;
}

export interface RuleVerdict {
  allowed: boolean;
  code: string;
  message_en: string;
  message_ms: string;
  suggested_funds: string[];
}

export interface CountResult {
  alert_raised?: boolean;
  counted: string;
  estimated: string;
  variance: string;
  flagged: boolean;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'open' | 'acknowledged' | 'escalated';

export interface Alert {
  id: string;
  seq: number;
  kind: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  detail: string;
  device_label: string | null;
  related_reference: string | null;
  occurred_at: string;
  has_photo: boolean;
  photo_sha256: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

/** ok is null when a check does not apply, for example no photo attached. */
export interface Check {
  key: string;
  label: string;
  ok: boolean | null;
  detail: string;
}

export interface AlertVerification {
  intact: boolean;
  seq: number;
  photo_sha256: string | null;
  recomputed_sha256: string | null;
  payload_hash: string;
  prev_hash: string;
  chain_hash: string;
  checks: Check[];
}

export interface Proof {
  reference: string;
  description: string;
  amount: string;
  seq: number;
  sealed_at: string;
  payload_hash: string;
  recomputed_payload_hash: string;
  prev_hash: string;
  chain_hash: string;
  intact: boolean;
  status: Txn['status'];
  has_receipt: boolean;
  reversible: boolean;
  checks: Check[];
}

/** Treasurers handle the cash, so they cannot be the ones who clear its alerts. */
export function canReview(role: Session['role'] | undefined): boolean {
  return role === 'committee' || role === 'admin' || role === 'auditor';
}

export interface LiveEvent {
  id: string;
  kind: string;
  detail: string;
  device_label: string | null;
  occurred_at: string;
  alert_id: string | null;
  severity: AlertSeverity | null;
  has_photo: boolean;
}

export interface DeviceStatus {
  serial: string;
  label: string;
  online: boolean;
  last_seen_at: string | null;
  door_state: 'open' | 'closed' | null;
  door_opened_at: string | null;
}

export type LiveMessage =
  | { type: 'hello' }
  | { type: 'event'; event: LiveEvent }
  | { type: 'status'; device: DeviceStatus }
  | { type: 'alert_count'; open: number; critical_open: number };

/** WebSocket URL for the live feed. The token rides in the query string
 *  because a phone WebSocket cannot set an Authorization header. */
export function liveSocketUrl(): string {
  return `${BASE_URL.replace(/^http/, 'ws')}/i/${SLUG}/live?token=${encodeURIComponent(TOKEN ?? '')}`;
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; refusal: RuleVerdict }
  | { ok: false; error: string; code?: string };

function authHeaders(): Record<string, string> {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}

const offline = () =>
  say(
    'Tiada sambungan ke pelayan. Semak internet dan cuba lagi.',
    'No connection to the server. Check the internet and try again.',
  );
const expired = () =>
  say('Sesi tamat. Sila log masuk semula.', 'Your session has ended. Please sign in again.');
const wording = (d?: { message_ms?: string; message_en?: string }) =>
  say(d?.message_ms ?? d?.message_en ?? '', d?.message_en ?? d?.message_ms ?? '') || undefined;

async function reach(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(offline());
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await reach(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    // Token expired or revoked. Bounce to login rather than showing a
    // confusing empty screen.
    setSession(null);
    onExpired?.();
    throw new Error(expired());
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body?.detail;
    if (detail?.code === 'password_change_required') onMustChange?.();
    throw new Error(
      (typeof detail === 'string' ? detail : wording(detail)) ??
        say(`Permintaan gagal (${res.status})`, `Request failed (${res.status})`),
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function login(email: string, password: string): Promise<Session> {
  // The login endpoint takes form encoding, not JSON: it follows the OAuth2
  // password flow so FastAPI's own docs page can drive it too.
  const body = new URLSearchParams({ username: email, password });
  const res = await reach(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? say('E-mel atau kata laluan salah.', 'Wrong email or password.')
        : res.status === 429
          ? say(
              'Terlalu banyak cubaan. Cuba lagi selepas 15 minit.',
              'Too many attempts. Try again in 15 minutes.',
            )
          : say(`Tidak dapat log masuk (${res.status})`, `Could not sign in (${res.status})`),
    );
  }
  const data = await res.json();
  const session: Session = {
    token: data.access_token,
    name: data.name,
    role: data.role,
    institution_slug: data.institution_slug,
    institution: data.institution,
    must_change_password: data.must_change_password,
  };
  setSession(session.token, session.institution_slug);
  return session;
}

export const api = {
  funds: () => request<Fund[]>(`/i/${SLUG}/funds`),

  ask: (question: string, context: Answer['context']) =>
    request<Answer>(`/i/${SLUG}/assistant`, {
      method: 'POST',
      body: JSON.stringify({ question, context }),
    }),

  transactions: (limit = 30) =>
    request<Txn[]>(`/i/${SLUG}/transactions?limit=${limit}`),

  verify: () =>
    request<{ intact: boolean; checked: number; summary: string; head_hash: string }>(
      `/i/${SLUG}/verify`,
    ),

  checkSpend: (fund_code: string, purpose: string) =>
    request<RuleVerdict>(`/i/${SLUG}/check-spend`, {
      method: 'POST',
      body: JSON.stringify({ fund_code, purpose }),
    }),

  approvals: (status?: Approval['status']) =>
    request<Approval[]>(`/i/${SLUG}/approvals${status ? `?status=${status}` : ''}`),

  requestSpend: (body: {
    fund_code: string;
    amount: string;
    purpose: string;
    description: string;
    request_id: string;
  }) =>
    request<Approval>(`/i/${SLUG}/approvals`, { method: 'POST', body: JSON.stringify(body) }),

  decide: (id: string, action: 'approve' | 'reject', note?: string) =>
    request<Approval>(`/i/${SLUG}/approvals/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ action, note: note || null }),
    }),

  cancelApproval: (id: string) =>
    request<Approval>(`/i/${SLUG}/approvals/${id}/cancel`, { method: 'POST' }),

  requestReversal: (reference: string, reason: string) =>
    request<Approval>(`/i/${SLUG}/transactions/${encodeURIComponent(reference)}/reversal`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  receipt: (reference: string) =>
    request<ReceiptInfo>(`/i/${SLUG}/transactions/${encodeURIComponent(reference)}/receipt`),

  people: () => request<Person[]>(`/i/${SLUG}/users`),

  addPerson: (body: { name: string; email: string; role: Session['role'] }) =>
    request<Person & { temporary_password: string }>(`/i/${SLUG}/users`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  changePerson: (id: string, body: { role?: Session['role']; active?: boolean }) =>
    request<Person>(`/i/${SLUG}/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  resetPassword: (id: string) =>
    request<{ temporary_password: string }>(`/i/${SLUG}/users/${id}/reset-password`, {
      method: 'POST',
    }),

  changePassword: (current: string, next: string) =>
    request<void>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current, new: next }),
    }),

  donate: (body: {
    fund_code: string;
    amount: string;
    description: string;
    donor_name?: string;
    request_id: string;
  }) =>
    request<{ reference: string; balance: string; receipt_number: string }>(`/i/${SLUG}/donations`, {
      method: 'POST',
      body: JSON.stringify({ ...body, channel: 'dashboard' }),
    }),

  /** Returns a refusal instead of throwing, because a refusal is the feature. */
  async disburse(body: {
    fund_code: string;
    amount: string;
    purpose: string;
    description: string;
    request_id: string;
  }): Promise<Result<{ reference: string; balance: string }>> {
    let res: Response;
    try {
      res = await reach(`${BASE_URL}/i/${SLUG}/disbursements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, error: offline() };
    }
    const payload = await res.json().catch(() => null);

    if (res.status === 401) {
      setSession(null);
      onExpired?.();
      return { ok: false, error: expired() };
    }
    if (res.status === 403) {
      return {
        ok: false,
        error:
          wording(payload?.detail) ??
          say(
            'Peranan anda tidak dibenarkan merekod perbelanjaan.',
            'Your role is not allowed to record spending.',
          ),
      };
    }
    if (res.ok) return { ok: true, data: payload };
    if (res.status === 422 && payload?.detail?.code) {
      return { ok: false, refusal: payload.detail as RuleVerdict };
    }
    return {
      ok: false,
      code: payload?.detail?.code,
      error: wording(payload?.detail) ?? say(`Tidak dapat merekod (${res.status})`, `Could not record (${res.status})`),
    };
  },

  devices: () => request<DeviceStatus[]>(`/i/${SLUG}/devices`),

  registerPushToken: (token: string, lang: string) =>
    request<void>(`/i/${SLUG}/push-token`, {
      method: 'POST',
      body: JSON.stringify({ token, platform: 'android', lang }),
    }),
  // Not through request(): a sign out that is refused must not sign out again.
  removePushToken: async (token: string) => {
    const res = await fetch(`${BASE_URL}/i/${SLUG}/push-token?token=${encodeURIComponent(token)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(String(res.status));
  },
  testPush: () =>
    request<{ ok: boolean; phones: number; problem: string | null }>(`/i/${SLUG}/push-test`, { method: 'POST' }),

  liveEvents: (limit = 40) => request<LiveEvent[]>(`/i/${SLUG}/live/events?limit=${limit}`),

  alertSummary: () =>
    request<{ open: number; critical_open: number }>(`/i/${SLUG}/alerts/summary`),

  alerts: (status?: AlertStatus) =>
    request<Alert[]>(`/i/${SLUG}/alerts${status ? `?status_filter=${status}` : ''}`),

  alert: (id: string) => request<Alert>(`/i/${SLUG}/alerts/${id}`),

  verifyAlert: (id: string) =>
    request<AlertVerification>(`/i/${SLUG}/alerts/${id}/verify`, { method: 'POST' }),

  reviewAlert: (id: string, action: 'acknowledge' | 'escalate', note?: string) =>
    request<Alert>(`/i/${SLUG}/alerts/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, note: note || null }),
    }),

  proof: (reference: string) =>
    request<Proof>(`/i/${SLUG}/transactions/${encodeURIComponent(reference)}/proof`),

  /** The photo needs the bearer token, so it cannot be a bare URL. */
  photoSource: (id: string) => ({
    uri: `${BASE_URL}/i/${SLUG}/alerts/${id}/photo`,
    headers: authHeaders(),
  }),

  /** Fetches the photo with the bearer token and returns it as a data URI.
   * Android's image loader is unreliable with auth headers, so the app
   * downloads the bytes itself and hands the picture over from memory. */
  photoDataUri: async (id: string): Promise<string> => {
    const res = await fetch(`${BASE_URL}/i/${SLUG}/alerts/${id}/photo`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`photo ${res.status}`);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('photo read failed'));
      reader.readAsDataURL(blob);
    });
  },

  closeCount: (body: {
    device_serial?: string;
    counted_total: string;
    fund_code?: string;
    witnesses: string[];
    note?: string;
    request_id: string;
  }) =>
    request<CountResult>(`/i/${SLUG}/counts`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
