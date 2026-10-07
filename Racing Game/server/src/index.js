import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import admin from "firebase-admin";

const PORT = Number(process.env.PORT || 10000);

if (!admin.apps.length) {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey
    })
  });
}

const db = admin.firestore();

const app = express();
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    game: "Raflido Online Racing",
    serverTime: new Date().toISOString()
  });
});

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const waiting = [];
const rooms = new Map();

const REWARD = {
  1: { coins: 100, xp: 100 },
  2: { coins: 60, xp: 60 },
  3: { coins: 30, xp: 30 }
};

function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data) {
  for (const p of room.players) send(p.ws, data);
}

async function ensurePlayer(uid, decoded) {
  const ref = db.collection("players").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    await ref.set({
      playerId: uid,
      displayName: decoded.name || "Racer",
      email: decoded.email || null,
      coins: 0,
      xp: 0,
      wins: 0,
      races: 0,
      selectedCar: "starter",
      customization: {},
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
}

async function addRaceResult(uid, position, raceId) {
  const reward = REWARD[position] || { coins: 0, xp: 0 };
  const ref = db.collection("players").doc(uid);

  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const old = snap.exists ? snap.data() : {};
    tx.set(ref, {
      coins: Number(old.coins || 0) + reward.coins,
      xp: Number(old.xp || 0) + reward.xp,
      wins: Number(old.wins || 0) + (position === 1 ? 1 : 0),
      races: Number(old.races || 0) + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });

  await db.collection("raceResults").doc(`${raceId}_${uid}`).set({
    raceId,
    playerId: uid,
    position,
    coins: reward.coins,
    xp: reward.xp,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

function createRoom(players) {
  const roomId = `race_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const room = {
    id: roomId,
    players,
    started: false,
    finished: new Set()
  };

  rooms.set(roomId, room);

  for (const p of players) {
    p.roomId = roomId;
    send(p.ws, {
      type: "match_found",
      roomId,
      players: players.map(x => ({
        id: x.uid,
        name: x.name,
        ai: !!x.ai
      }))
    });
  }

  let count = 5;
  const timer = setInterval(() => {
    broadcast(room, { type: "countdown", value: count });
    count--;

    if (count < 0) {
      clearInterval(timer);
      room.started = true;
      room.startTime = Date.now();
      broadcast(room, { type: "race_start", startTime: room.startTime });
    }
  }, 1000);
}

function tryMatch() {
  while (waiting.length >= 3) {
    createRoom(waiting.splice(0, 3));
  }
}

function addAIIfNeeded() {
  while (waiting.length > 0 && waiting.length < 3) {
    waiting.push({
      uid: `ai_${Math.random().toString(36).slice(2, 9)}`,
      name: "AI Racer",
      ai: true,
      ws: null,
      roomId: null
    });
  }
  tryMatch();
}

wss.on("connection", ws => {
  let player = null;

  send(ws, { type: "connected" });

  ws.on("message", async raw => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "auth") {
        if (!msg.token) return send(ws, { type: "error", message: "Missing Firebase token" });

        const decoded = await admin.auth().verifyIdToken(msg.token);
        await ensurePlayer(decoded.uid, decoded);

        player = {
          uid: decoded.uid,
          name: decoded.name || "Racer",
          ws,
          ai: false,
          roomId: null
        };

        send(ws, {
          type: "authenticated",
          player: {
            uid: decoded.uid,
            name: player.name
          }
        });
        return;
      }

      if (!player) {
        return send(ws, { type: "error", message: "Authenticate first" });
      }

      if (msg.type === "join_queue") {
        if (player.roomId) return;

        if (!waiting.includes(player)) waiting.push(player);

        send(ws, { type: "queue_joined", size: waiting.length });

        // Demo behaviour: fill missing slots with AI.
        if (waiting.length === 1) {
          setTimeout(addAIIfNeeded, 1500);
        } else {
          tryMatch();
        }
        return;
      }

      if (msg.type === "input") {
        if (!player.roomId) return;

        const room = rooms.get(player.roomId);
        if (!room || !room.started) return;

        // Demo network relay. In the real Unity game, validate speed,
        // acceleration and track checkpoints server-side.
        broadcast(room, {
          type: "player_input",
          playerId: player.uid,
          input: {
            throttle: Math.max(-1, Math.min(1, Number(msg.throttle || 0))),
            steer: Math.max(-1, Math.min(1, Number(msg.steer || 0)))
          }
        });
        return;
      }

      if (msg.type === "finish") {
        if (!player.roomId) return;

        const room = rooms.get(player.roomId);
        if (!room || !room.started || room.finished.has(player.uid)) return;

        room.finished.add(player.uid);
        const position = room.finished.size;

        await addRaceResult(player.uid, position, room.id);

        broadcast(room, {
          type: "player_finished",
          playerId: player.uid,
          position,
          reward: REWARD[position]
        });

        if (room.finished.size >= 3) {
          broadcast(room, { type: "race_finished" });
          rooms.delete(room.id);
        }
      }
    } catch (err) {
      console.error(err);
      send(ws, { type: "error", message: "Server error" });
    }
  });

  ws.on("close", () => {
    if (player) {
      const i = waiting.indexOf(player);
      if (i >= 0) waiting.splice(i, 1);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Raflido racing server listening on port ${PORT}`);
});
