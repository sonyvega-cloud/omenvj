// ═══════════════════════════════════════════════════════════════
// ØMEN WebSocket Relay — Mobile Controller ↔ PC Player
// ═══════════════════════════════════════════════════════════════
//
// Deploy as Cloudflare Worker with Durable Objects
//
// Flow:
//   1. Player opens WS → gets 4-digit PIN
//   2. Mobile opens WS with PIN → joined to same session
//   3. Messages relayed between player ↔ controller(s)
//
// ═══════════════════════════════════════════════════════════════

export class OmenSession {
  constructor(state, env) {
    this.state = state;
    this.players = new Set();
    this.controllers = new Set();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get('role') || 'controller';

    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();

    if (role === 'player') {
      this.players.add(server);
      server.addEventListener('message', (e) => {
        // Player → all controllers
        for (const ws of this.controllers) {
          try { ws.send(e.data); } catch (_) {}
        }
      });
      server.addEventListener('close', () => {
        this.players.delete(server);
      });
    } else {
      this.controllers.add(server);
      server.addEventListener('message', (e) => {
        // Controller → all players
        for (const ws of this.players) {
          try { ws.send(e.data); } catch (_) {}
        }
      });
      server.addEventListener('close', () => {
        this.controllers.delete(server);
      });
    }

    // Send connection confirmation
    server.send(JSON.stringify({
      type: 'ws_connected',
      role,
      players: this.players.size,
      controllers: this.controllers.size,
    }));

    // Notify others
    const notify = JSON.stringify({
      type: 'ws_peer',
      players: this.players.size,
      controllers: this.controllers.size,
    });
    for (const ws of [...this.players, ...this.controllers]) {
      try { if (ws !== server) ws.send(notify); } catch (_) {}
    }

    return new Response(null, { status: 101, webSocket: client });
  }
}

// ── Main Worker ───────────────────────────────────────────────

// Active PINs: pin → Durable Object ID
const activePins = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // ── POST /session/create → Player creates session, gets PIN ──
    if (url.pathname === '/session/create' && request.method === 'POST') {
      const pin = String(Math.floor(1000 + Math.random() * 9000));
      const id = env.OMEN_SESSIONS.newUniqueId();

      // Store PIN → DO ID mapping in KV (expire in 24h)
      await env.OMEN_PINS.put(pin, id.toString(), { expirationTtl: 86400 });

      return new Response(JSON.stringify({ pin, sessionId: id.toString() }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // ── GET /session/join?pin=XXXX → Check if PIN is valid ───────
    if (url.pathname === '/session/join') {
      const pin = url.searchParams.get('pin');
      if (!pin) return new Response('Missing pin', { status: 400, headers: cors });

      const sessionId = await env.OMEN_PINS.get(pin);
      if (!sessionId) {
        return new Response(JSON.stringify({ error: 'Invalid PIN' }), {
          status: 404,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ pin, sessionId }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // ── GET /ws?session=ID&role=player|controller → WebSocket ────
    if (url.pathname === '/ws') {
      const sessionId = url.searchParams.get('session');
      const role = url.searchParams.get('role') || 'controller';

      if (!sessionId) return new Response('Missing session', { status: 400, headers: cors });

      const id = env.OMEN_SESSIONS.idFromString(sessionId);
      const stub = env.OMEN_SESSIONS.get(id);

      // Forward request to Durable Object
      const doUrl = new URL(request.url);
      doUrl.searchParams.set('role', role);
      return stub.fetch(new Request(doUrl.toString(), request));
    }

    // ── Default ──────────────────────────────────────────────────
    return new Response('OMEN Relay v1', { headers: cors });
  },
};
