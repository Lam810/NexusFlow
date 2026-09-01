import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptModelApiKey,
  encryptModelApiKey,
  normalizeModelName,
  normalizeOpenAIBaseUrl,
  openAICompatibleEndpoint,
} from '../src/modelConfig.js';

const encryptionKey = 'model-config-test-key-with-more-than-32-characters';

test('model API keys are encrypted and bound to one user', () => {
  const encrypted = encryptModelApiKey('sk-private-value', encryptionKey, 'user-a');
  assert.notEqual(encrypted, 'sk-private-value');
  assert.equal(encrypted.includes('sk-private-value'), false);
  assert.equal(decryptModelApiKey(encrypted, encryptionKey, 'user-a'), 'sk-private-value');
  assert.throws(() => decryptModelApiKey(encrypted, encryptionKey, 'user-b'), /could not be decrypted/);
});

test('OpenAI-compatible fields are normalized and unsafe shapes are rejected', () => {
  assert.equal(normalizeOpenAIBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
  assert.equal(openAICompatibleEndpoint('https://example.com/v1/', 'chat/completions'), 'https://example.com/v1/chat/completions');
  assert.equal(normalizeModelName(' vendor/model:latest '), 'vendor/model:latest');
  assert.equal(normalizeModelName('', { required: false }), '');
  assert.throws(() => normalizeOpenAIBaseUrl('https://example.com/v1/chat/completions'), /must stop before/);
  assert.throws(() => normalizeOpenAIBaseUrl('http://example.com/v1', { requireHttps: true }), /must use HTTPS/);
  assert.throws(() => normalizeOpenAIBaseUrl('https://user:pass@example.com/v1'), /cannot include credentials/);
});
