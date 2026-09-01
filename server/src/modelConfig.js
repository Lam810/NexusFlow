import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ENCRYPTION_VERSION = 'v1';

export function assertModelConfigEncryptionKey(value) {
  const normalized = String(value || '').trim();
  if (normalized.length < 32) {
    throw new Error('MODEL_CONFIG_ENCRYPTION_KEY must be at least 32 characters.');
  }
  return normalized;
}

function encryptionKey(value) {
  return createHash('sha256').update(assertModelConfigEncryptionKey(value)).digest();
}

export function encryptModelApiKey(apiKey, masterKey, userId) {
  const plaintext = String(apiKey || '');
  if (!plaintext) throw new Error('API key cannot be empty.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(masterKey), iv);
  cipher.setAAD(Buffer.from(String(userId)));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTION_VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptModelApiKey(payload, masterKey, userId) {
  const [version, ivValue, tagValue, encryptedValue, ...extra] = String(payload || '').split('.');
  if (version !== ENCRYPTION_VERSION || !ivValue || !tagValue || !encryptedValue || extra.length > 0) {
    throw new Error('Stored model API key is invalid.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(masterKey), Buffer.from(ivValue, 'base64url'));
    decipher.setAAD(Buffer.from(String(userId)));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Stored model API key could not be decrypted.');
  }
}

export function normalizeOpenAIBaseUrl(value, { requireHttps = false } = {}) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('Base URL must be a valid HTTP or HTTPS URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Base URL must use HTTP or HTTPS.');
  }
  if (requireHttps && url.protocol !== 'https:') {
    throw new Error('Production model Base URL must use HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL cannot include credentials, query parameters, or fragments.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (/\/(?:chat\/completions|embeddings)$/i.test(url.pathname)) {
    throw new Error('Base URL must stop before /chat/completions or /embeddings.');
  }
  return url.toString().replace(/\/$/, '');
}

export function normalizeModelName(value, { required = true } = {}) {
  const model = String(value || '').trim();
  if (!model && !required) return '';
  if (!model || model.length > 200 || /[\u0000-\u001f\u007f]/.test(model)) {
    throw new Error('Model name must contain 1 to 200 visible characters.');
  }
  return model;
}

export function openAICompatibleEndpoint(baseUrl, resource) {
  return `${String(baseUrl).replace(/\/+$/, '')}/${resource}`;
}
