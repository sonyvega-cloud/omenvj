#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// ØMEN CDJ Simulator — Fake CDJ data for testing
// ═══════════════════════════════════════════════════════════════
//
// Usage:
//   npm install ws
//   node simulator.js
//
// Simulates a CDJ playing a techno track:
// - Steady BPM with occasional breakdowns
// - Beat on every beat (1-2-3-4)
// - Track metadata
// ═══════════════════════════════════════════════════════════════

const { WebSocketServer } = require('ws');

const WS_PORT = 9000;
const wss = new WebSocketServer({ port: WS_PORT });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`Client connected (${clients.size})`);
  ws.send(JSON.stringify({ type: 'bridge_hello', status: 'connected' }));
  ws.send(JSON.stringify({
    type: 'cdj_track',
    deviceId: 1,
    title: 'Simulator Track',
    artist: 'ØMEN Test',
    bpm: simBpm,
    duration: 360,
  }));
  ws.on('close', () => { clients.delete(ws); });
});

function broadcast(data) {
  const json = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(json);
  }
}

console.log(`[SIM] WebSocket on ws://localhost:${WS_PORT}`);
console.log('[SIM] Simulating CDJ playback...');

// ── Simulation state ──────────────────────────────────────────
let simBpm = 128;
let simBeat = 0;      // 1-4
let simPlaying = true;
let simTotalBeats = 0;

// ── Track structure (simple pattern) ──────────────────────────
// 0-64 beats: groove (128 BPM)
// 64-80: breakdown (no beats sent — silence)  
// 80-84: buildup (beats accelerate feel via BPM nudge)
// 84+: drop (128 BPM, back to groove)
let structurePos = 0;
const STRUCTURE_LENGTH = 128; // beats per cycle

function isBreakdown() {
  const pos = structurePos % STRUCTURE_LENGTH;
  return pos >= 64 && pos < 80;
}

function isBuildUp() {
  const pos = structurePos % STRUCTURE_LENGTH;
  return pos >= 80 && pos < 84;
}

// ── Beat timer ────────────────────────────────────────────────
function fireBeat() {
  structurePos++;
  
  if (isBreakdown()) {
    // Skip beats during breakdown (simulates no-kick section)
    console.log(`  [break] pos:${structurePos % STRUCTURE_LENGTH}`);
    return;
  }
  
  simBeat = ((simBeat) % 4) + 1; // 1,2,3,4
  simTotalBeats++;
  
  const currentBpm = isBuildUp() ? simBpm + 2 : simBpm; // slight push during buildup
  
  broadcast({
    type: 'cdj_beat',
    deviceId: 1,
    bpm: currentBpm,
    beatInMeasure: simBeat,
    beatTotal: simTotalBeats,
    timestamp: Date.now(),
  });
  
  // Status update every 4 beats
  if (simBeat === 1) {
    broadcast({
      type: 'cdj_status',
      deviceId: 1,
      bpm: currentBpm,
      pitch: 0,
      beatInMeasure: simBeat,
      isPlaying: true,
      isMaster: true,
    });
    
    const pos = structurePos % STRUCTURE_LENGTH;
    const section = pos < 64 ? 'GROOVE' : pos < 80 ? 'BREAK' : pos < 84 ? 'BUILD' : 'DROP';
    console.log(`Beat ${simTotalBeats} | ${currentBpm} BPM | bar ${simBeat}/4 | ${section}`);
  }
}

// Fire beats at BPM interval
setInterval(() => {
  if (simPlaying) fireBeat();
}, 60000 / simBpm);

// Heartbeat
setInterval(() => {
  broadcast({ type: 'bridge_heartbeat', timestamp: Date.now() });
}, 2000);

console.log(`[SIM] Playing at ${simBpm} BPM`);
console.log('[SIM] Structure: 64 beats groove → 16 beats breakdown → 4 beats build → drop → repeat');
