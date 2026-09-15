const blocked = () => { throw new Error('OFFLINE_TEST_NETWORK_ATTEMPT'); };
globalThis.fetch = blocked;
for (const name of ['node:http', 'node:https']) {
  const mod = require(name); mod.request = blocked; mod.get = blocked;
}
require('node:net').Socket.prototype.connect = blocked;
