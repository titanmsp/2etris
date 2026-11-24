import { Database, serverTimestamp, ref, onValue, push, set, get, update } from 'firebase/database';

import { Player, newGame } from './game';
import { processEvent, E, EventType, tickEvent, createEvent } from './events';
import { shortId } from './id';

export enum SessionState {
  Claiming,
  Playing,
  Over,
}

const blankSession = {
  state: SessionState.Claiming,
  users: [] as string[],
  claims: {
    [Player.One]: null,
    [Player.Two]: null,
  },
  game: null
};

export function newSession(id: string, me: string, db: Database, onError: (e: Error) => void) {
  let restarting = false;

  const eventsRef = ref(db, `sessions/${id}/events`);
  const s = Object.assign({
    me,
    events: [] as E[],
    easyMode: true,
    startingLevel: 1,
    firebase: {
      lastEvent: null,
      timeOffset: 0,
      pushEvent: (e: E) => { push(eventsRef, e).catch(onError); },
      serverTime: serverTimestamp,
    },
    async restart() {
      if (restarting) return;
      restarting = true;
      try {
        // The other player can join as soon as the redirect event is delivered.
        const nextId = await makeSession(me, db);
        createEvent({ t: EventType.NewSession, id: nextId }, s);
      } catch (error) { onError(error); }
    },
    seed: null,
  }, blankSession);
  
  onValue(eventsRef, function (snapshot) {
    const v = snapshot.val();
    if (v === null) return;
    for (const k in v) {
      const e = v[k];
      e._k = k;
      if (v[e.parent]) {
        // Flicker fix
        e.time = Math.max(e.time, v[e.parent].time + 1);
      }
    }
    s.events = Object.values(v);
    s.events.sort((e1, e2) => e1.time - e2.time);
    const lastTen = []
    for (let i = s.events.length - 1; i >= 0 && lastTen.length < 10; i--) {
      if (s.events[i].user === me && s.events[i].localTime) {
        lastTen.push(s.events[i]);
      }
    }
    s.firebase.lastEvent = s.events.slice(-1)[0]._k;
    s.firebase.timeOffset = lastTen.length > 0 ? lastTen.map(e => e.time - e.localTime).reduce((x, y) => x + y) / lastTen.length: 0;
  }, onError);

  return s;
}

// Gravity ticks have no user; network actions carry the UID verified by RTDB.
function applyPlayerEvent(session, event) {
  if (session.state !== SessionState.Playing) return;
  if (event.user === '' || session.claims[event.player] === event.user) {
    processEvent(event, session.game);
  }
}

export function computeSession(session, end: number) {
  Object.assign(session, blankSession);
  const events = session.events;
  let i = 0;
  const nextEvent = function() {
    if (session.state !== SessionState.Playing) {
      return events [i++];
    }
    const game = session.game!;
    if (
      events[i] &&
      events[i].time < game.activeOminos[Player.One].nextFall &&
      events[i].time < game.activeOminos[Player.Two].nextFall
    ) {
      return events[i++];
    }
    const n =
      game.activeOminos[Player.One].nextFall <
      game.activeOminos[Player.Two].nextFall
        ? game.activeOminos[Player.One]
        : game.activeOminos[Player.Two];
    return tickEvent(n);
  };
  for (let next = nextEvent(); next && next.time < end; next = nextEvent()) {
    if (next.t === EventType.NewSession) {
      const u = new URL(window.location.href);
      u.searchParams.set('session', next.id);
      (window as Window).location = u.toString();
    }
    if (next.t === EventType.Init) {
      session.seed = session.seed ?? next.seed;
      if (session.claims[Player.One] && session.claims[Player.Two] && session.seed) {
        session.game = newGame({
          time: next.time + 1000,
          t: EventType.Init,
          seed: session.seed,
          user: session.me,
          easyMode: session.easyMode,
          startingLevel: session.startingLevel,
        })
        session.state = SessionState.Playing;
      }
      continue;
    }
    if (next.t === EventType.Claim) {
      if (session.claims[next.player] && session.claims[next.player] !== next.user) {
        continue;
      }
      if (session.claims[1 - next.player] === next.user) {
        session.claims[1 - next.player] = null;
      }
      session.claims[next.player] = next.user;
      if (next.both) {
        session.claims[1 - next.player] = next.user;
      }
      if (session.claims[Player.One] && session.claims[Player.Two] && session.seed) {
        session.game = newGame({
          time: next.time + 1000,
          t: EventType.Init,
          seed: session.seed,
          user: session.me,
          easyMode: session.easyMode,
          startingLevel: session.startingLevel,
        })
        session.state = SessionState.Playing;
      }
      continue;
    }
    if (next.t === EventType.ToggleEasy) {
      session.easyMode = next.val;
      continue;
    }
    if (next.t === EventType.SetLevel) {
      session.startingLevel = next.val;
      continue;
    }

    applyPlayerEvent(session, next);
    if (session.game && session.game.over) session.state = SessionState.Over;
  }

  // Jitter mitigation - note that this doesn't actually seem to work :(
  for(i--; i < events.length && events[i].time < end + 1000; i++) {
    if (events[i].time < end) {
      // we already processed this event
      continue;
    }
    applyPlayerEvent(session, events[i]);
  }

  return session;
}

export class RoomError extends Error {}

export async function joinRoom(me: string, db: Database, id: string) {
  const members = ref(db, `sessions/${id}/members`);
  const seats = (await get(members)).val();
  if (!seats?.host) throw new RoomError('Room not found. Check the game code or create a new room.');
  if (seats.host === me || seats.guest === me) return;
  if (seats.guest) throw new RoomError('This room already has two players. Ask for a new game code.');
  // Rules let exactly one guest claim the empty seat, even on racing joins.
  await set(ref(db, `sessions/${id}/members/guest`), me);
}

export async function makeSession(me: string, db: Database, test = false): Promise<string> {
  const id = shortId();
  const fields = { time: serverTimestamp(), localTime: Date.now(), user: me };
  const initial: Record<string, unknown> = {
    'members/host': me,
    'events/0': { ...fields, t: EventType.Init, seed: Math.random().toString() },
  };
  if (test) initial['events/1'] = { ...fields, t: EventType.Claim, player: Player.One, both: true };
  await update(ref(db, `sessions/${id}`), initial);
  return id;
}
