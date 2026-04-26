/**
 * BandwidthMonitor — R25 / Phase 9.
 *
 * Adaptive cap on relay-to-relay swarm traffic.
 *
 * What it tracks (BETA_ROADMAP §Phase 9, ARCHITECTURE.md §Bandwidth):
 *
 *   - Outbound bytes per second, 60 s rolling window.
 *   - Peak outbound bps observed during the first MEASUREMENT_WINDOW_MS (the
 *     "one-shot upload measurement"). The peak is treated as the user's
 *     practical upload ceiling. We don't run an active probe — burning
 *     someone's bandwidth on speedtest just to learn it is rude. Passive
 *     observation is good enough because the swarm itself is the workload.
 *   - EWMA RTT from in-flight swarm WANT lifecycles. Baseline = first stable
 *     EWMA after MIN_RTT_SAMPLES samples. When current EWMA > 2× baseline,
 *     we declare the link congested and `getInFlightCap()` halves the
 *     SWARM_MAX_CONCURRENT_PER_PEER limit until RTT recovers.
 *
 * Hard cap precedence:
 *   1. `MUSTER_MAX_BW_KBPS`  — explicit env override, never exceeded.
 *   2. tier defaults already apply via `MUSTER_MAX_BW_MB` at the relay
 *      startup level (existing knob); we don't duplicate that here.
 *   3. 10 % of measuredUploadBps once measurement settles. Until then the
 *      monitor uses INITIAL_SOFT_CAP_BPS so the swarm has somewhere to go
 *      while we observe.
 *
 * Persistence: one-row table `bandwidth_config(id=1, measuredUploadBps,
 * capBps, lastUpdated)`. Loaded on construct so a relay that already
 * measured doesn't re-learn from cold every reboot.
 *
 * Stats are published on demand via `snapshot()` and surface to the
 * desktop UI through the `BANDWIDTH_STATS_REQUEST` message (handled in
 * `index.ts`).
 *
 * Gated by MUSTER_TWO_LAYER=1. Phase 10 will drop the gate.
 */

import type Database from 'better-sqlite3';
import { SWARM_MAX_CONCURRENT_PER_PEER } from '@muster/protocol';

// ─── Tunables ──────────────────────────────────────────────────────────────

/** Length of the upload-measurement window after first ever boot. 5 min. */
const MEASUREMENT_WINDOW_MS = 5 * 60 * 1000;

/** Rolling window for the outbound bps figure surfaced to the UI. */
const ROLLING_WINDOW_MS = 60 * 1000;

/** Soft cap while we have no measurement yet. 64 KB/s — generous enough for
 *  a few peers to swap pieces, low enough to not saturate a domestic uplink. */
const INITIAL_SOFT_CAP_BPS = 64 * 1024;

/** Default share of measured upload to allow the swarm to use. */
const DEFAULT_CAP_FRACTION = 0.10;

/** Floor cap once measured — never go below this even if 10 % is tiny. */
const MIN_MEASURED_CAP_BPS = 32 * 1024;

/** EWMA smoothing factor for RTT. */
const RTT_EWMA_ALPHA = 0.2;

/** Need at least this many RTT samples before we set baseline. */
const MIN_RTT_SAMPLES = 8;

/** RTT congestion ratio above which we throttle concurrency. */
const RTT_CONGESTION_RATIO = 2.0;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface BandwidthSnapshot {
  outboundBps: number;
  capBps: number;
  measuredUploadBps: number;
  measuring: boolean;
  ewmaRttMs: number;
  baselineRttMs: number;
  congested: boolean;
  inFlightCap: number;
}

interface ConfigRow {
  measuredUploadBps: number;
  capBps: number;
  lastUpdated: number;
}

// ─── DB schema ─────────────────────────────────────────────────────────────

function initBandwidthTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bandwidth_config (
      id                  INTEGER PRIMARY KEY CHECK (id = 1),
      measuredUploadBps   INTEGER NOT NULL DEFAULT 0,
      capBps              INTEGER NOT NULL DEFAULT 0,
      lastUpdated         INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO bandwidth_config (id, measuredUploadBps, capBps, lastUpdated)
    VALUES (1, 0, 0, 0);
  `);
}

// ─── Monitor ───────────────────────────────────────────────────────────────

export class BandwidthMonitor {
  private db: Database.Database;

  /** Each entry: [tsMs, bytes] outbound. Pruned to ROLLING_WINDOW_MS. */
  private outSamples: Array<[number, number]> = [];

  private measuredUploadBps = 0;
  private capBps = 0;
  /** When monitor first started counting (for measurement window cutoff). */
  private startedAt = Date.now();
  /** Highest 1 s outbound bps seen during the measurement window. */
  private peakBps = 0;
  private measuring = true;

  private ewmaRttMs = 0;
  private baselineRttMs = 0;
  private rttSampleCount = 0;

  private hardEnvCapBps: number | null = null;

  constructor(db: Database.Database) {
    this.db = db;
    initBandwidthTable(db);
    const row = db.prepare(`SELECT measuredUploadBps, capBps, lastUpdated FROM bandwidth_config WHERE id = 1`).get() as ConfigRow | undefined;
    if (row && row.measuredUploadBps > 0) {
      this.measuredUploadBps = row.measuredUploadBps;
      this.capBps = row.capBps > 0 ? row.capBps : Math.max(MIN_MEASURED_CAP_BPS, Math.floor(row.measuredUploadBps * DEFAULT_CAP_FRACTION));
      this.measuring = false;
    } else {
      this.capBps = INITIAL_SOFT_CAP_BPS;
    }

    // Env override is hard — never exceed it regardless of measurement.
    const env = process.env.MUSTER_MAX_BW_KBPS;
    if (env) {
      const kbps = parseInt(env, 10);
      if (Number.isFinite(kbps) && kbps > 0) {
        this.hardEnvCapBps = kbps * 1024;
        this.capBps = Math.min(this.capBps, this.hardEnvCapBps);
      }
    }

    console.log(`[bw] BandwidthMonitor ready: cap=${this.kb(this.capBps)}KB/s measured=${this.measuredUploadBps > 0 ? this.kb(this.measuredUploadBps) + 'KB/s' : 'pending'}${this.hardEnvCapBps ? ` envCap=${this.kb(this.hardEnvCapBps)}KB/s` : ''}`);
  }

  // ── Sample inputs ─────────────────────────────────────────────────────

  /** Called by swarmHandler.sendSwarmTo with the size of every outbound
   *  swarm frame. Updates rolling window + measurement peak. */
  recordOutBytes(bytes: number): void {
    if (bytes <= 0) return;
    const now = Date.now();
    this.outSamples.push([now, bytes]);
    this.pruneOutSamples(now);
    if (this.measuring) {
      const bps = this.computeBps(now);
      if (bps > this.peakBps) this.peakBps = bps;
      if (now - this.startedAt >= MEASUREMENT_WINDOW_MS) this.finaliseMeasurement(now);
    }
  }

  /** Called when a WANT_RESPONSE arrives for an in-flight WANT we issued. */
  recordRttSample(rttMs: number): void {
    if (!Number.isFinite(rttMs) || rttMs <= 0 || rttMs > 60_000) return;
    if (this.ewmaRttMs === 0) {
      this.ewmaRttMs = rttMs;
    } else {
      this.ewmaRttMs = (RTT_EWMA_ALPHA * rttMs) + ((1 - RTT_EWMA_ALPHA) * this.ewmaRttMs);
    }
    this.rttSampleCount += 1;
    if (this.rttSampleCount === MIN_RTT_SAMPLES) {
      this.baselineRttMs = this.ewmaRttMs;
      console.log(`[bw] RTT baseline locked: ${Math.round(this.baselineRttMs)}ms`);
    }
  }

  // ── Outputs ───────────────────────────────────────────────────────────

  /** Bytes/sec the swarm has spent in the last ROLLING_WINDOW_MS. */
  outboundBps(): number {
    return this.computeBps(Date.now());
  }

  /** Hard cap currently enforceable on aggregate swarm outbound, in bytes/sec. */
  getCapBps(): number {
    return this.capBps;
  }

  /** Concurrency limit per peer, halved while congested. */
  getInFlightCap(): number {
    return this.isCongested() ? Math.max(1, Math.floor(SWARM_MAX_CONCURRENT_PER_PEER / 2)) : SWARM_MAX_CONCURRENT_PER_PEER;
  }

  /** True when current outbound bps already exceeds the cap. swarmHandler
   *  uses this to defer non-essential frames (HAVE deltas, fresh WANTs). */
  isOverCap(): boolean {
    return this.outboundBps() > this.capBps;
  }

  isCongested(): boolean {
    if (this.baselineRttMs === 0) return false;
    return this.ewmaRttMs > this.baselineRttMs * RTT_CONGESTION_RATIO;
  }

  snapshot(): BandwidthSnapshot {
    return {
      outboundBps: this.outboundBps(),
      capBps: this.capBps,
      measuredUploadBps: this.measuredUploadBps,
      measuring: this.measuring,
      ewmaRttMs: Math.round(this.ewmaRttMs),
      baselineRttMs: Math.round(this.baselineRttMs),
      congested: this.isCongested(),
      inFlightCap: this.getInFlightCap(),
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private finaliseMeasurement(now: number): void {
    this.measuring = false;
    if (this.peakBps > 0) {
      this.measuredUploadBps = this.peakBps;
      const target = Math.max(MIN_MEASURED_CAP_BPS, Math.floor(this.measuredUploadBps * DEFAULT_CAP_FRACTION));
      this.capBps = this.hardEnvCapBps !== null ? Math.min(this.hardEnvCapBps, target) : target;
      this.persist(now);
      console.log(`[bw] measurement done: peak=${this.kb(this.peakBps)}KB/s cap=${this.kb(this.capBps)}KB/s`);
    } else {
      // No traffic during the window — keep INITIAL_SOFT_CAP_BPS, try
      // again next reboot.
      console.log('[bw] measurement window closed with no traffic; retaining soft cap');
    }
  }

  private persist(now: number): void {
    this.db.prepare(`
      UPDATE bandwidth_config
      SET measuredUploadBps = ?, capBps = ?, lastUpdated = ?
      WHERE id = 1
    `).run(this.measuredUploadBps, this.capBps, now);
  }

  private pruneOutSamples(now: number): void {
    const cutoff = now - ROLLING_WINDOW_MS;
    while (this.outSamples.length > 0 && this.outSamples[0]![0] < cutoff) this.outSamples.shift();
  }

  private computeBps(now: number): number {
    this.pruneOutSamples(now);
    if (this.outSamples.length === 0) return 0;
    let total = 0;
    for (const [, b] of this.outSamples) total += b;
    const span = Math.max(1000, now - this.outSamples[0]![0]);
    return Math.round((total * 1000) / span);
  }

  private kb(bps: number): number {
    return Math.round(bps / 1024);
  }
}
