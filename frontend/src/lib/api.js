/**
 * Single place where the frontend talks to the API.
 *
 * Two things this replaces:
 *  - hard-coded `http://localhost:5000` in every page, which only ever worked
 *    on the machine running the backend;
 *  - the `x-user-role` / `x-user-can-view-inventory-logs` headers, which were
 *    client-asserted claims the server had to trust. Authorization is now
 *    decided by the server from the bearer token, so those headers are gone.
 */

const BASE = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

// `user` is kept as the session key every page already reads for display
// purposes (name/role). It is display data only - authorization is always
// decided by the server from `posToken`, never from this object.
const TOKEN_KEY = "posToken";
const USER_KEY = "user";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
};

export const storeSession = (token, user) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
};

/** Absolute URL for a server-relative asset such as /uploads/abc.jpg. */
export const assetUrl = (path) => {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const origin = BASE.replace(/\/api$/, "");
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
};

let onUnauthorized = null;

/** Registered by the app shell so an expired token can force a logout. */
export const setUnauthorizedHandler = (handler) => {
  onUnauthorized = handler;
};

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

async function request(path, { method = "GET", body, headers = {}, signal, raw = false } = {}) {
  const token = getToken();
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const response = await fetch(`${BASE}${path}`, {
    method,
    signal,
    headers: {
      ...(isFormData || body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: isFormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });

  const isLoginRequest = method === "POST" && path === "/login";
  if (response.status === 401 && !isLoginRequest) {
    clearSession();
    if (onUnauthorized) onUnauthorized();
    throw new ApiError("Your session has expired. Please sign in again.", 401, null);
  }

  if (raw) {
    if (!response.ok) throw new ApiError("Request failed", response.status, null);
    return response;
  }

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    throw new ApiError(payload?.message || `Request failed (${response.status})`, response.status, payload);
  }

  return payload;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: "GET" }),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  put: (path, body, options) => request(path, { ...options, method: "PUT", body }),
  del: (path, options) => request(path, { ...options, method: "DELETE" }),
};
