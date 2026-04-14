#!/usr/bin/env node
// ØMEN CDJ Simulator — test without real CDJ
const { WebSocketServer } = require('ws');

const WS_PORT = 9000;
const wss = new WebSocketServer({ port: WS_PORT });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`Client connected (${clients.size})`);
  ws.send(JSON.stringify({ type: 'bridge_hello', status: 'connected' }));
  ws.send(JSON.stringify({
    type: 'cdj_track', deviceId: 1,
    title: 'Simulator Track', artist: 'ØMEN Test',
    bpm: simBpm, duration: 360, key: 'Am',
  }));
  ws.on('close', () => { clients.delete(ws); });
});

function broadcast(data) {
  const json = JSON.stringify(data);
  for (const ws of clients) { if (ws.readyState === 1) ws.send(json); }
}

console.log(`[SIM] ws://localhost:${WS_PORT}`);

let simBpm = 128;
let simBeat = 0;
let simTotalBeats = 0;
let structurePos = 0;
const STRUCTURE_LENGTH = 128;

function isBreakdown() { const p = structurePos % STRUCTURE_LENGTH; return p >= 64 && p < 80; }
function isBuildUp() { const p = structurePos % STRUCTURE_LENGTH; return p >= 80 && p < 84; }

function fireBeat() {
  structurePos++;
  if (isBreakdown()) { console.log(`  [break] pos:${structurePos % STRUCTURE_LENGTH}`); return; }
  
  simBeat = (simBeat % 4) + 1; // 1,2,3,4
  simTotalBeats++;
  const currentBpm = isBuildUp() ? simBpm + 2 : simBpm;
  
  broadcast({
    type: 'cdj_beat', deviceId: 1,
    bpm: currentBpm,
    beatInMeasure: simBeat, // ← KEY: 1,2,3,4
    beatTotal: simTotalBeats,
    timestamp: Date.now(),
  });
  
  if (simBeat === 1) {
    broadcast({
      type: 'cdj_status', deviceId: 1,
      bpm: currentBpm, pitch: 0, beatInMeasure: simBeat,
      isPlaying: true, isMaster: true,
    });
    const pos = structurePos % STRUCTURE_LENGTH;
    const section = pos < 64 ? 'GROOVE' : pos < 80 ? 'BREAK' : pos < 84 ? 'BUILD' : 'DROP';
    console.log(`Beat ${simTotalBeats} | ${currentBpm} BPM | bar ${simBeat}/4 | ${section}`);
  }
}

setInterval(() => fireBeat(), 60000 / simBpm);
setInterval(() => broadcast({ type: 'bridge_heartbeat', timestamp: Date.now() }), 2000);
console.log(`[SIM] ${simBpm} BPM | Structure: groove→break→build→drop`);
