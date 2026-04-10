import assert from 'node:assert/strict';
import {
  buildConnectionSavePayload,
  buildConnectionTestPayload,
} from '../.tmp-agent-tests/src/features/connections/domain/formTransforms.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest('buildConnectionSavePayload keeps existing edit status', () => {
  const formData = {
    name: 'web',
    host: '10.0.0.1',
    username: 'root',
    port: 22,
    password: 'secret',
  };

  const connections = [{ id: 'c1', name: 'web', status: 'connected' }];
  const payload = buildConnectionSavePayload({
    formData,
    authMethod: 'password',
    editingConnectionId: 'c1',
    connections,
  });

  assert.equal(payload.id, 'c1');
  assert.equal(payload.status, 'connected');
  assert.equal(payload.password, 'secret');
});

runTest('buildConnectionSavePayload sets disconnected for valid new connection', () => {
  const payload = buildConnectionSavePayload({
    formData: { host: '10.0.0.2', username: 'ubuntu', port: 22 },
    authMethod: 'password',
    editingConnectionId: null,
    connections: [],
  });

  assert.equal(payload.status, 'disconnected');
  assert.equal(payload.port, 22);
  assert.equal(payload.privateKeyPath, undefined);
});

runTest('buildConnectionSavePayload throws on invalid port', () => {
  assert.throws(
    () =>
      buildConnectionSavePayload({
        formData: { host: '10.0.0.2', username: 'ubuntu', port: 70000 },
        authMethod: 'password',
        editingConnectionId: null,
        connections: [],
      }),
    /Port must be an integer between 1 and 65535/
  );
});

runTest('buildConnectionTestPayload builds key auth config and jump host', () => {
  const formData = {
    id: 'main',
    name: 'main',
    host: '192.168.0.10',
    username: 'ec2-user',
    port: 22,
    privateKeyPath: '/tmp/key.pem',
    jumpServerId: 'jump1',
  };
  const connections = [
    {
      id: 'jump1',
      name: 'jump',
      host: '192.168.0.1',
      username: 'ubuntu',
      port: 22,
      password: 'jump-pass',
      jumpServerId: 'jump2',
    },
    {
      id: 'jump2',
      name: 'jump-2',
      host: '192.168.0.2',
      username: 'ec2-user',
      port: 2222,
      privateKeyPath: '/tmp/jump2.pem',
    },
  ];

  const payload = buildConnectionTestPayload({
    formData,
    authMethod: 'key',
    connections,
  });

  assert.equal(payload.auth_method.type, 'PrivateKey');
  assert.equal(payload.jump_host?.auth_method.type, 'Password');
  assert.equal(payload.jump_host?.host, '192.168.0.1');
  assert.equal(payload.jump_host?.jump_host?.host, '192.168.0.2');
});

console.log('Connection form transform tests passed.');
