// Lightweight P2P netcode using PeerJS public cloud.
// Host runs full simulation; clients send input + hit claims and render snapshots.
//
// Wire format keeps things compact: arrays of primitive values, not objects.

import { Peer, DataConnection } from "peerjs";
import { store, GameState } from "@/game/store";
import * as THREE from "three";
import { Soldier, SoldierClass, Team } from "@/game/types";

export type NetMode = "solo" | "host" | "client";

export interface RemotePlayerInput {
  // Position & orientation of the remote player's avatar (their "soldier slot")
  px: number; py: number; pz: number;
  yaw: number;
  pitch: number;
  // Combat intent
  fire: boolean;
  reload: boolean;
  // Class (set once at join, but we resend periodically — cheap)
  cls: SoldierClass;
  // Hit claims accumulated since last input — host validates loosely
  hits: HitClaim[];
}

export interface HitClaim {
  targetId: number;        // soldier id, or 0 for host's local player
  damage: number;
  head: boolean;
  weapon: string;          // for muzzle color hint
}

interface SoldierSnap {
  id: number;
  team: number;            // 0=blue 1=red
  cls: number;             // 0=assault 1=sniper 2=support 3=medic
  x: number; y: number; z: number;
  yaw: number;
  hp: number;
  alive: number;           // 1/0
  state: number;           // 0..7 SoldierState index
  remote: number;          // 1 if controlled by a remote player
}

interface PlayerSnap { hp: number; hpMax: number; x: number; y: number; z: number; }

interface Snapshot {
  t: number;               // server time
  hostPlayer: PlayerSnap;
  soldiers: SoldierSnap[];
  blueScore: number;
  redScore: number;
  score: number;
  kills: number;
  capture: { id: number; owner: number; progress: number }[]; // owner: 0=blue 1=red 2=null
}

const SOLDIER_STATES = ["patrol","chase","attack","cover","flank","retreat","suppress","investigate"] as const;
const CLASS_LIST: SoldierClass[] = ["assault","sniper","support","medic"];

export type NetEventListener = (ev: { kind: string; data?: any }) => void;

class NetManagerImpl {
  mode: NetMode = "solo";
  peer: Peer | null = null;
  // Host-side
  private connections = new Map<string, DataConnection>(); // peerId -> conn
  private remoteToSoldierId = new Map<string, number>();   // peerId -> soldier id reserved for them
  private lastInputs = new Map<string, RemotePlayerInput>();
  // Client-side
  private hostConn: DataConnection | null = null;
  latestSnapshot: Snapshot | null = null;
  private snapshotTimer = 0;
  private inputTimer = 0;
  private pendingHits: HitClaim[] = [];

  roomCode: string | null = null;       // host's peer id
  connectedPeers: string[] = [];        // for UI
  onEvent: NetEventListener | null = null;

  // ---------- LOBBY ----------

  async hostRoom(): Promise<string> {
    this.cleanup();
    this.mode = "host";
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 1 });
      this.peer = peer;
      peer.on("open", (id) => {
        this.roomCode = id;
        this.emit("hosted", { code: id });
        resolve(id);
      });
      peer.on("error", (err) => {
        this.emit("error", { message: String(err) });
        reject(err);
      });
      peer.on("connection", (conn) => this.acceptClient(conn));
    });
  }

  async joinRoom(code: string): Promise<void> {
    this.cleanup();
    this.mode = "client";
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 1 });
      this.peer = peer;
      peer.on("open", () => {
        const conn = peer.connect(code, { reliable: false, serialization: "json" });
        this.hostConn = conn;
        conn.on("open", () => {
          this.emit("joined", { code });
          // Tell host our class
          conn.send({ k: "join", cls: store.state.loadout.soldierClass });
          resolve();
        });
        conn.on("data", (d: any) => this.onClientReceive(d));
        conn.on("close", () => {
          this.emit("disconnected", {});
          this.mode = "solo";
        });
        conn.on("error", (e) => reject(e));
      });
      peer.on("error", (err) => {
        this.emit("error", { message: String(err) });
        reject(err);
      });
    });
  }

  leave() {
    if (this.mode === "host") {
      for (const c of this.connections.values()) c.close();
    } else if (this.mode === "client" && this.hostConn) {
      this.hostConn.close();
    }
    this.cleanup();
    this.mode = "solo";
    this.emit("left", {});
  }

  private cleanup() {
    this.connections.clear();
    this.remoteToSoldierId.clear();
    this.lastInputs.clear();
    this.hostConn = null;
    this.latestSnapshot = null;
    this.pendingHits = [];
    if (this.peer) {
      try { this.peer.destroy(); } catch {}
      this.peer = null;
    }
    this.roomCode = null;
    this.connectedPeers = [];
  }

  private emit(kind: string, data?: any) {
    this.onEvent?.({ kind, data });
  }

  // ---------- HOST SIDE ----------

  private acceptClient(conn: DataConnection) {
    this.connections.set(conn.peer, conn);
    this.connectedPeers = Array.from(this.connections.keys());
    this.emit("clientJoined", { peerId: conn.peer });

    conn.on("data", (d: any) => this.onHostReceive(conn, d));
    conn.on("close", () => {
      // Free their soldier slot back to AI
      const sid = this.remoteToSoldierId.get(conn.peer);
      if (sid != null) {
        const s = store.state.soldiers.find((x) => x.id === sid);
        if (s) (s as any).__remoteOwner = null;
      }
      this.connections.delete(conn.peer);
      this.remoteToSoldierId.delete(conn.peer);
      this.lastInputs.delete(conn.peer);
      this.connectedPeers = Array.from(this.connections.keys());
      this.emit("clientLeft", { peerId: conn.peer });
    });
  }

  private onHostReceive(conn: DataConnection, msg: any) {
    if (!msg || typeof msg !== "object") return;
    if (msg.k === "join") {
      // Reserve a blue AI slot for this player
      const sid = this.reserveBlueSoldier(conn.peer, msg.cls || "assault");
      conn.send({ k: "joined", soldierId: sid });
    } else if (msg.k === "input") {
      this.lastInputs.set(conn.peer, msg.i as RemotePlayerInput);
    }
  }

  private reserveBlueSoldier(peerId: string, cls: SoldierClass): number {
    // Find an alive blue soldier not yet remotely owned
    const cands = store.state.soldiers.filter(
      (s) => s.team === "blue" && s.alive && !(s as any).__remoteOwner,
    );
    const pick = cands[Math.floor(Math.random() * cands.length)] || store.state.soldiers.find((s) => s.team === "blue");
    if (!pick) return -1;
    (pick as any).__remoteOwner = peerId;
    pick.soldierClass = cls;
    this.remoteToSoldierId.set(peerId, pick.id);
    return pick.id;
  }

  /** Apply received remote-player inputs to their owned soldier (called every engine tick on host). */
  applyRemoteInputs(state: GameState, dt: number, time: number) {
    if (this.mode !== "host") return;
    for (const [peerId, inp] of this.lastInputs) {
      const sid = this.remoteToSoldierId.get(peerId);
      if (sid == null) continue;
      const s = state.soldiers.find((x) => x.id === sid);
      if (!s || !s.alive) continue;

      // Replace position/orientation directly (client is authoritative on its own avatar).
      s.pos.set(inp.px, inp.py, inp.pz);
      s.yaw = inp.yaw;
      s.desiredYaw = inp.yaw;

      // Apply hit claims (loose validation: clamp damage & target must exist)
      for (const h of inp.hits) {
        const dmg = Math.max(0, Math.min(150, h.damage));
        if (h.targetId === 0) {
          // Targeted host's local player
          if (state.player.hp > 0) {
            state.player.hp -= dmg;
            state.player.lastDamagedAt = time;
            state.damageFlash = Math.min(1, state.damageFlash + 0.4);
          }
        } else {
          const tgt = state.soldiers.find((x) => x.id === h.targetId);
          if (tgt && tgt.alive && tgt.team === "red") {
            tgt.hp -= dmg;
            if (tgt.hp <= 0) {
              tgt.alive = false;
              state.kills += 1;
              if (h.head) state.headshots += 1;
              state.score += h.head ? 200 : 100;
              state.blueScore += 1;
            }
          }
        }
      }
      // Clear consumed hits so they don't re-apply
      inp.hits = [];
    }
  }

  /** Determine if a soldier is currently controlled by a remote player (host only). */
  isRemoteControlled(soldierId: number): boolean {
    if (this.mode !== "host") return false;
    for (const sid of this.remoteToSoldierId.values()) {
      if (sid === soldierId) return true;
    }
    return false;
  }

  /** Send a snapshot to all clients (~12-15 Hz). */
  hostBroadcast(state: GameState, dt: number, time: number) {
    if (this.mode !== "host") return;
    if (this.connections.size === 0) return;
    this.snapshotTimer += dt;
    if (this.snapshotTimer < 0.07) return;
    this.snapshotTimer = 0;

    const snap: Snapshot = {
      t: time,
      hostPlayer: {
        hp: state.player.hp,
        hpMax: state.player.hpMax,
        x: state.player.pos.x, y: state.player.pos.y, z: state.player.pos.z,
      },
      soldiers: state.soldiers.map((s) => ({
        id: s.id,
        team: s.team === "blue" ? 0 : 1,
        cls: CLASS_LIST.indexOf(s.soldierClass),
        x: round2(s.pos.x), y: round2(s.pos.y), z: round2(s.pos.z),
        yaw: round2(s.yaw),
        hp: Math.round(s.hp),
        alive: s.alive ? 1 : 0,
        state: SOLDIER_STATES.indexOf(s.state as any),
        remote: this.isRemoteControlled(s.id) ? 1 : 0,
      })),
      blueScore: state.blueScore,
      redScore: state.redScore,
      score: state.score,
      kills: state.kills,
      capture: state.capturePoints.map((cp) => ({
        id: cp.id,
        owner: cp.owner === "blue" ? 0 : cp.owner === "red" ? 1 : 2,
        progress: round2(cp.progress),
      })),
    };
    const payload = { k: "snap", s: snap };
    for (const c of this.connections.values()) {
      try { c.send(payload); } catch {}
    }
  }

  // ---------- CLIENT SIDE ----------

  private onClientReceive(msg: any) {
    if (!msg || typeof msg !== "object") return;
    if (msg.k === "snap") {
      this.latestSnapshot = msg.s as Snapshot;
      this.applySnapshotToStore();
    } else if (msg.k === "joined") {
      this.emit("assignedSoldier", { soldierId: msg.soldierId });
    }
  }

  /** Apply received snapshot into client's store so HUD + scene render correctly. */
  private applySnapshotToStore() {
    const snap = this.latestSnapshot;
    if (!snap) return;
    const st = store.state;
    st.blueScore = snap.blueScore;
    st.redScore = snap.redScore;
    st.score = snap.score;
    st.kills = snap.kills;

    // Soldiers: reconcile by id
    const byId = new Map(st.soldiers.map((s) => [s.id, s]));
    const seen = new Set<number>();
    for (const ss of snap.soldiers) {
      seen.add(ss.id);
      let s = byId.get(ss.id);
      const team: Team = ss.team === 0 ? "blue" : "red";
      const cls = CLASS_LIST[ss.cls] || "assault";
      const stateName = SOLDIER_STATES[ss.state] || "patrol";
      if (!s) {
        s = {
          id: ss.id, team,
          pos: new THREE.Vector3(ss.x, ss.y, ss.z),
          vel: new THREE.Vector3(),
          hp: ss.hp, hpMax: 100,
          alive: ss.alive === 1,
          lastShotAt: 0,
          state: stateName as any,
          patrolTarget: new THREE.Vector3(),
          yaw: ss.yaw, targetId: null,
          coverTarget: null, coverTimer: 0,
          soldierClass: cls,
          lastSeenPos: null, lastSeenAt: -999,
          reactionDelay: 0, alertness: 0, flankDir: 1,
          nextTacticalDecisionAt: 0, lastGrenadeAt: -10, lastSmokeAt: -10,
          desiredYaw: ss.yaw,
          moveDir: new THREE.Vector3(),
          lastThreatDir: null,
          stuckTimer: 0,
          lastPosCheck: new THREE.Vector3(),
          squadOffset: new THREE.Vector3(),
        };
        st.soldiers.push(s);
      } else {
        // Smooth interpolation toward snapshot position
        s.pos.lerp(_v.set(ss.x, ss.y, ss.z), 0.5);
        s.yaw = ss.yaw;
        s.hp = ss.hp;
        s.alive = ss.alive === 1;
        s.team = team;
        s.soldierClass = cls;
        s.state = stateName as any;
      }
    }
    // Remove soldiers that no longer exist on host
    if (snap.soldiers.length > 0) {
      for (let i = st.soldiers.length - 1; i >= 0; i--) {
        if (!seen.has(st.soldiers[i].id)) st.soldiers.splice(i, 1);
      }
    }
    st.enemies = st.soldiers;

    // Capture points
    for (const cs of snap.capture) {
      const cp = st.capturePoints.find((c) => c.id === cs.id);
      if (cp) {
        cp.owner = cs.owner === 0 ? "blue" : cs.owner === 1 ? "red" : null;
        cp.progress = cs.progress;
      }
    }

    // Host's player rendered as a friendly soldier-like marker
    // (handled separately by scene if needed; for now we just sync HP for downed detection)
    store.emit();
  }

  /** Client: send local input snapshot to host (~20Hz). */
  clientSendInput(state: GameState, dt: number, fire: boolean, reload: boolean) {
    if (this.mode !== "client" || !this.hostConn || !this.hostConn.open) return;
    this.inputTimer += dt;
    if (this.inputTimer < 0.05) return;
    this.inputTimer = 0;
    const p = state.player;
    const inp: RemotePlayerInput = {
      px: round2(p.pos.x), py: round2(p.pos.y - 1.7), pz: round2(p.pos.z), // store as foot pos
      yaw: round2(p.yaw), pitch: round2(p.pitch),
      fire, reload,
      cls: state.loadout.soldierClass,
      hits: this.pendingHits,
    };
    try { this.hostConn.send({ k: "input", i: inp }); } catch {}
    this.pendingHits = [];
  }

  /** Client: queue a hit claim to send with the next input packet. */
  clientReportHit(claim: HitClaim) {
    if (this.mode !== "client") return;
    this.pendingHits.push(claim);
  }
}

const _v = new THREE.Vector3();
function round2(n: number) { return Math.round(n * 100) / 100; }

export const NetManager = new NetManagerImpl();
