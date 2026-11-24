// Test harness for the two-player engine. It drives the real src/session.ts
// computeSession() and the real key mapping in src/controls.ts registerControls().
// No browser, DOM, Firebase, or network is used. Time is a fake clock owned by
// the harness, so every replay is deterministic.
import { computeSession, SessionState } from "../src/session";
import { EventType } from "../src/events";
import { Player, level as levelOf } from "../src/game";

import { registerControls } from "../src/controls";

// computeSession copies a module-level blankSession by reference, so the
// `claims` object is shared by every session in the process. Clear it before
// each replay so one test cannot leak claims into another.
export function resetSharedClaims() {
  const probe: any = { events: [], firebase: {} };
  computeSession(probe, 0);
  probe.claims[Player.One] = null;
  probe.claims[Player.Two] = null;
}

export interface Stroke {
  at: number; // fake clock (ms)
  user: string;
  code: string; // KeyboardEvent.code
}

// A script step is one user's keystrokes. Keys inside a step are KEY_GAP ms
// apart. The next step starts STEP_GAP ms after the previous step's last key.
export const KEY_GAP = 25;
export const STEP_GAP = 50;
export interface ScriptStep {
  user: string;
  keys: string; // space separated KeyboardEvent.code values, "Code*n" repeats
  wait?: number; // idle ms before this step's first key
}

export function expandScript(steps: ScriptStep[], start: number): Stroke[] {
  const out: Stroke[] = [];
  let t = start;
  for (const step of steps) {
    t += step.wait ?? 0;
    for (const tok of step.keys.split(/\s+/).filter(Boolean)) {
      const m = /^([A-Za-z]+)(?:\*(\d+))?$/.exec(tok);
      if (!m) throw new Error(`bad key token: ${tok}`);
      const n = m[2] ? parseInt(m[2], 10) : 1;
      for (let i = 0; i < n; i++) {
        out.push({ at: t, user: step.user, code: m[1] });
        t += KEY_GAP;
      }
    }
    t += STEP_GAP - KEY_GAP;
  }
  return out;
}

export function createHarness(opts: { seed: string; startingLevel?: number; easyMode?: boolean }) {
  resetSharedClaims();
  let now = 0;
  const listeners: Record<string, Function[]> = { keydown: [], keyup: [] };
  (globalThis as any).window = {
    location: { href: "http://localhost/game?session=test" },
    addEventListener(name: string, fn: Function) {
      (listeners[name] ??= []).push(fn);
    },
  };
  const element = () => ({ addEventListener() {}, checked: false, value: "" } as unknown as HTMLInputElement);
  // The current controls.ts reads document (new-game buttons) and Element
  // (Space guard). Neither is needed for keyboard behaviour, so stub them.
  (globalThis as any).document = { querySelectorAll: () => [], activeElement: null };
  if (typeof (globalThis as any).Element === "undefined") {
    (globalThis as any).Element = class {};
  }
  const session: any = {
    me: "p1",
    events: [] as any[],
    easyMode: opts.easyMode ?? false,
    startingLevel: opts.startingLevel ?? 1,
    firebase: {
      lastEvent: null,
      timeOffset: 0,
      pushEvent: (e: any) => {
        session.events.push(e);
      },
      serverTime: () => now,
    },
    seed: null,
  };
  const ui = {
    blackButton: element(),
    whiteButton: element(),
    easyButton: element(),
    levelPicker: element(),
  };
  registerControls(ui, session);

  // The Init event that the UI's makeSession() would normally write to Firebase.
  session.events.push({ t: EventType.Init, time: 0, user: "p1", seed: opts.seed });

  function advance(t: number) {
    computeSession(session, t);
    return session;
  }

  function quietly(fn: () => void) {
    const log = console.log;
    console.log = () => {}; // createEvent logs every timestamp
    try {
      fn();
    } finally {
      console.log = log;
    }
  }

  // Dispatches a browser-style keydown/keyup pair as `user` at fake time `at`.
  function press(s: Stroke) {
    now = s.at;
    session.me = s.user;
    advance(s.at);
    quietly(() => {
      const down = { code: s.code, repeat: false, preventDefault() {} };
      for (const fn of listeners.keydown ?? []) fn(down);
      const up = { code: s.code, repeat: false, preventDefault() {} };
      for (const fn of listeners.keyup ?? []) fn(up);
    });
  }

  function keydown(at: number, user: string, code: string, repeat = false) {
    now = at;
    session.me = user;
    advance(at);
    quietly(() => {
      const e = { code, repeat, preventDefault() {} };
      for (const fn of listeners.keydown ?? []) fn(e);
    });
  }

  function keyup(at: number, user: string, code: string) {
    now = at;
    session.me = user;
    advance(at);
    quietly(() => {
      const e = { code, repeat: false, preventDefault() {} };
      for (const fn of listeners.keyup ?? []) fn(e);
    });
  }

  // Raw claim event, as written by the UI's claim checkbox.
  function claim(at: number, user: string, player: Player) {
    session.events.push({ t: EventType.Claim, time: at, user, player, localTime: at });
  }

  function replay(steps: ScriptStep[], start: number) {
    for (const s of expandScript(steps, start)) press(s);
  }

  return { session, advance, press, keydown, keyup, claim, replay };
}

// Plain-data view of the engine state, for deepEqual against captured values.
export function snapshot(session: any) {
  const g = session.game;
  return {
    state: session.state,
    scores: [g.scores[Player.One], g.scores[Player.Two]],
    lines: g.lines,
    level: levelOf(g),
    hold: [g.hold[Player.One], g.hold[Player.Two]],
    active: [Player.One, Player.Two].map((p) => {
      const o = g.activeOminos[p];
      return { id: o.id, shape: o.shape, rotation: o.rotation, x: o.x, y: o.y, held: o.held };
    }),
    over: g.over,
    gridRows: g.grid.map((r: number[]) => r.join("")),
  };
}

export { SessionState, Player };
