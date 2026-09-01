import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fetch from 'node-fetch';

const BLOCKED_ADDRESSES = new net.BlockList();

for (const [address, prefix, family] of [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.0.0.0', 24, 'ipv4'],
  ['192.0.2.0', 24, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['198.18.0.0', 15, 'ipv4'],
  ['198.51.100.0', 24, 'ipv4'],
  ['203.0.113.0', 24, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'],
  ['::1', 128, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
  ['2001:db8::', 32, 'ipv6'],
]) {
  BLOCKED_ADDRESSES.addSubnet(address, prefix, family);
}

const PLACEHOLDER_SECRETS = new Set([
  'replace-with-a-local-development-secret',
  'replace-with-a-random-secret',
  'replace-with-the-generated-value',
  'your-jwt-secret',
]);

export function assertSecureJwtSecret(secret) {
  const normalized = String(secret || '').trim();
  if (normalized.length < 32 || PLACEHOLDER_SECRETS.has(normalized.toLowerCase())) {
    throw new Error('JWT_SECRET must be a non-placeholder secret of at least 32 characters.');
  }
  return normalized;
}

export function parseAllowedOrigins(originsValue = 'http://localhost:5173,http://127.0.0.1:5173') {
  return new Set(
    originsValue.split(',').map(origin => origin.trim()).filter(Boolean)
  );
}

export function createCorsOptions(originsValue = 'http://localhost:5173,http://127.0.0.1:5173') {
  const allowedOrigins = parseAllowedOrigins(originsValue);

  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin is not allowed by CORS policy.'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: true,
    maxAge: 600,
  };
}

export function createRateLimiter({ windowMs, max, keyPrefix }) {
  const buckets = new Map();
  let lastSweep = Date.now();

  return (req, res, next) => {
    const now = Date.now();
    if (now - lastSweep >= windowMs) {
      for (const [bucketKey, bucketValue] of buckets) {
        if (bucketValue.resetAt <= now) buckets.delete(bucketKey);
      }
      lastSweep = now;
    }
    const key = `${keyPrefix}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: '请求过于频繁，请稍后重试' });
      return;
    }

    next();
  };
}

function readCookie(req, name) {
  const cookieHeader = String(req.headers.cookie || '');
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function createJwtAuthenticator(jwt, secret, cookieNames = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    const [scheme, bearerToken] = typeof authHeader === 'string' ? authHeader.trim().split(/\s+/) : [];
    const tokenFromHeader = scheme === 'Bearer' && bearerToken ? bearerToken : null;
    const tokenFromCookie = cookieNames.map(name => readCookie(req, name)).find(Boolean) || null;
    const token = tokenFromHeader || tokenFromCookie;

    if (!token) {
      res.status(401).json({ error: '访问令牌缺失' });
      return;
    }

    jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: 'nexusflow',
      audience: 'nexusflow-client',
    }, (error, user) => {
      if (error || typeof user !== 'object' || !user?.id) {
        res.status(403).json({ error: '访问令牌无效' });
        return;
      }
      req.user = user;
      req.authMethod = tokenFromHeader ? 'bearer' : 'cookie';
      next();
    });
  };
}

export function createCookieOriginGuard(originsValue) {
  const allowedOrigins = parseAllowedOrigins(originsValue);
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

  return (req, res, next) => {
    if (req.authMethod !== 'cookie' || safeMethods.has(req.method)) {
      next();
      return;
    }
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !allowedOrigins.has(origin)) {
      res.status(403).json({ error: '请求来源校验失败' });
      return;
    }
    next();
  };
}

export function isPrivateOrReservedAddress(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized.startsWith('::ffff:')) {
    return isPrivateOrReservedAddress(normalized.slice(7));
  }

  const family = net.isIP(normalized);
  if (family === 4) return BLOCKED_ADDRESSES.check(normalized, 'ipv4');
  if (family === 6) return BLOCKED_ADDRESSES.check(normalized, 'ipv6');
  return true;
}

async function resolveSafeTarget(rawUrl, allowPrivate) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid target URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are allowed.');
  }
  if (url.username || url.password) {
    throw new Error('Credentials in target URLs are not allowed.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literalFamily = net.isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await dns.lookup(hostname, { all: true, verbatim: true });

  if (addresses.length === 0) throw new Error('Target hostname did not resolve.');
  if (!allowPrivate && addresses.some(item => isPrivateOrReservedAddress(item.address))) {
    throw new Error('Requests to private or reserved network addresses are blocked.');
  }

  const selected = addresses[0];
  const lookup = (_hostname, _options, callback) => {
    callback(null, selected.address, selected.family);
  };
  const agent = url.protocol === 'https:'
    ? new https.Agent({ lookup, keepAlive: false })
    : new http.Agent({ lookup, keepAlive: false });

  return { url, agent };
}

function stripSensitiveRedirectHeaders(headers = {}) {
  const result = { ...headers };
  for (const key of Object.keys(result)) {
    if (['authorization', 'cookie', 'proxy-authorization'].includes(key.toLowerCase())) {
      delete result[key];
    }
  }
  return result;
}

export async function safeFetch(rawUrl, options = {}, securityOptions = {}) {
  const {
    allowPrivate = false,
    maxRedirects = 3,
    timeoutMs = 30_000,
  } = securityOptions;

  let currentUrl = String(rawUrl);
  let method = String(options.method || 'GET').toUpperCase();
  let body = options.body;
  let headers = { ...(options.headers || {}) };

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const { url, agent } = await resolveSafeTarget(currentUrl, allowPrivate);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(timeoutMs, 1_000), 60_000));
    timeout.unref?.();

    let response;
    try {
      response = await fetch(url, {
        ...options,
        method,
        body,
        headers,
        redirect: 'manual',
        agent,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      if (error?.name === 'AbortError') throw new Error('Upstream request timed out.');
      throw error;
    }

    const clearRequestTimeout = () => clearTimeout(timeout);
    response.body?.once('end', clearRequestTimeout);
    response.body?.once('close', clearRequestTimeout);
    response.body?.once('error', clearRequestTimeout);
    if (!response.body) clearRequestTimeout();

    const location = response.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
      return response;
    }
    if (redirectCount === maxRedirects) {
      response.body?.destroy();
      throw new Error('Too many upstream redirects.');
    }

    const previousOrigin = url.origin;
    currentUrl = new URL(location, url).toString();
    const nextOrigin = new URL(currentUrl).origin;
    response.body?.destroy();

    if (previousOrigin !== nextOrigin) headers = stripSensitiveRedirectHeaders(headers);
    if (response.status === 303 || ([301, 302].includes(response.status) && method === 'POST')) {
      method = 'GET';
      body = undefined;
      for (const key of Object.keys(headers)) {
        if (['content-length', 'content-type'].includes(key.toLowerCase())) delete headers[key];
      }
    }
  }

  throw new Error('Unable to complete upstream request.');
}

export async function readTextLimited(response, maxBytes = 2 * 1024 * 1024) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) {
    response.body?.destroy();
    throw new Error('Upstream response is too large.');
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of response.body || []) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      response.body?.destroy();
      throw new Error('Upstream response is too large.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function substituteVariables(value, variables = {}) {
  if (typeof value === 'string') {
    let result = value;
    for (const [key, replacement] of Object.entries(variables)) {
      result = result.split(`{${key}}`).join(String(replacement));
    }
    return result;
  }
  if (Array.isArray(value)) return value.map(item => substituteVariables(item, variables));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, substituteVariables(child, variables)])
    );
  }
  return value;
}

function containsSecretName(value) {
  return /authorization|api[-_ ]?key|token|secret|password/i.test(String(value || ''));
}

function isTemplateReference(value) {
  return typeof value === 'string' && /^\s*\{\{[^}]+\}\}\s*$/.test(value);
}

function scrubSecrets(value, parentKey = '') {
  if (Array.isArray(value)) return value.map(item => scrubSecrets(item, parentKey));
  if (!value || typeof value !== 'object') return value;

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^(authorization|api[-_ ]?key|bearer[-_ ]?token|password|client[-_ ]?secret|access[-_ ]?token|refresh[-_ ]?token|private[-_ ]?key|secret)$/i.test(key)) {
      result[key] = isTemplateReference(child) ? child : '';
      continue;
    }
    if (key === 'clientId' && parentKey === 'oauth2') {
      // Older workflows stored an access token in this field.
      result[key] = '';
      continue;
    }
    result[key] = scrubSecrets(child, key);
  }

  if (typeof result.key === 'string' && containsSecretName(result.key) && 'value' in result) {
    result.value = isTemplateReference(result.value) ? result.value : '';
  }
  return result;
}

export function sanitizeWorkflowNodes(nodes) {
  if (!Array.isArray(nodes)) return [];
  return scrubSecrets(nodes);
}
