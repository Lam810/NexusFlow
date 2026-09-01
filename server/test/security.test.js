import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSecureJwtSecret,
  createPinnedLookup,
  isPrivateOrReservedAddress,
  safeFetch,
  sanitizeWorkflowNodes,
  substituteVariables,
} from '../src/security.js';

test('JWT secrets must be strong and non-placeholder values', () => {
  assert.throws(() => assertSecureJwtSecret('short'));
  assert.throws(() => assertSecureJwtSecret('replace-with-a-local-development-secret'));
  assert.throws(() => assertSecureJwtSecret('replace-with-the-generated-value'));
  assert.throws(() => assertSecureJwtSecret(' '.repeat(40)));
  assert.equal(assertSecureJwtSecret('a-secure-random-development-secret-1234'), 'a-secure-random-development-secret-1234');
});

test('private, loopback, link-local and documentation addresses are blocked', () => {
  for (const address of ['127.0.0.1', '10.0.0.8', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1', '2001:db8::1']) {
    assert.equal(isPrivateOrReservedAddress(address), true, address);
  }
  assert.equal(isPrivateOrReservedAddress('8.8.8.8'), false);
  assert.equal(isPrivateOrReservedAddress('2606:4700:4700::1111'), false);
});

test('safe fetch rejects loopback targets before connecting', async () => {
  await assert.rejects(
    () => safeFetch('http://127.0.0.1:1/private'),
    /private or reserved network addresses are blocked/
  );
});

test('pinned DNS lookup supports single and all-address callback shapes', () => {
  const lookup = createPinnedLookup({ address: '8.8.8.8', family: 4 });
  let single;
  let multiple;
  lookup('example.com', { all: false }, (error, address, family) => {
    assert.equal(error, null);
    single = { address, family };
  });
  lookup('example.com', { all: true }, (error, addresses) => {
    assert.equal(error, null);
    multiple = addresses;
  });
  assert.deepEqual(single, { address: '8.8.8.8', family: 4 });
  assert.deepEqual(multiple, [{ address: '8.8.8.8', family: 4 }]);
});

test('workflow secrets are stripped while template references are preserved', () => {
  const [node] = sanitizeWorkflowNodes([{
    data: {
      config: {
        apiKey: 'provider-key',
        api_key: 'alternate-provider-key',
        auth: {
          bearerToken: 'bearer-secret',
          basicAuth: { username: 'demo', password: 'password-secret' },
          oauth2: { accessToken: 'access-secret', clientSecret: '{{oauth_client_secret}}' },
          headers: [
            { key: 'Authorization', value: 'Bearer secret' },
            { key: 'X-API-Key', value: '{{runtime_api_key}}' },
            { key: 'Accept', value: 'application/json' },
          ],
        },
      },
    },
  }]);

  const config = node.data.config;
  assert.equal(config.apiKey, '');
  assert.equal(config.api_key, '');
  assert.equal(config.auth.bearerToken, '');
  assert.equal(config.auth.basicAuth.password, '');
  assert.equal(config.auth.oauth2.accessToken, '');
  assert.equal(config.auth.oauth2.clientSecret, '{{oauth_client_secret}}');
  assert.equal(config.auth.headers[0].value, '');
  assert.equal(config.auth.headers[1].value, '{{runtime_api_key}}');
  assert.equal(config.auth.headers[2].value, 'application/json');
});

test('template variables are substituted literally and recursively', () => {
  const result = substituteVariables({
    url: 'https://example.com/{a[}/{price}',
    headers: ['{a[}', '{missing}'],
  }, {
    'a[': '$&value',
    price: 0,
  });

  assert.deepEqual(result, {
    url: 'https://example.com/$&value/0',
    headers: ['$&value', '{missing}'],
  });
});
