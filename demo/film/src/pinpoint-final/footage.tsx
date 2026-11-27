import type {FootageSceneProps} from "./scenes/FootageScene";
import {localMark as m, segsOf, SCENES} from "./timeline";
import t3 from "./t3-real.json";

const dur = (id: "walk" | "everyday") => {
  const s = SCENES.find((x) => x.id === id)!;
  return s.end - s.start;
};
const toSegs = (id: "walk" | "everyday") => segsOf(id).map((s) => ({at: s.at, dur: s.dur, src: s.src, from: s.from, rate: s.rate}));

const tagsSim = [{text: "Even Hub simulator"}, {text: "Sample workspace", sample: true}];

const replyBody = (before: string, after: string) => (
  <>
    <span className="old">{before}</span> <span style={{color: "#96a69c"}}>→</span> <span className="new">{after}</span>
  </>
);

export const WALK: FootageSceneProps = {
  label: "Morning walk · developer",
  duration: dur("walk"),
  photos: [
    {at: 0, src: "stills/final/walk-street.jpg", push: 0.06, pan: -30},
    {at: m("walk.deck", 0.2), src: "stills/final/walk-crossing.jpg", push: 0.06, pan: 30},
  ],
  segs: toSegs("walk"),
  rail: [
    {at: m("walk.on", -0.3), dur: 5.0, label: "Put them on", sub: "caught up at once", mode: "idle"},
    {at: m("walk.catchup-focus", 0.0), dur: 3.6, label: "Tap", sub: "see what changed", mode: "tap"},
    {at: m("walk.login-open", -0.2), dur: 4.4, label: "Tap", sub: "opens on the line", mode: "tap"},
    {at: m("walk.deck", 0.0), dur: 3.4, label: "Hold · Ask", sub: "then speak", mode: "talk"},
    {at: m("walk.back-on-line", 0.1), dur: 2.9, label: "Say the fix", sub: "tap to talk", mode: "talk"},
    {at: m("walk.noted", 0.1), dur: 3.0, label: "Tap send", sub: "5 s to undo", mode: "tap"},
  ],
  overlays: [
    {kind: "chip", at: m("walk.on", 0.2), dur: 3.8, text: "3 numbers, one glance", x: 372, y: 748, tone: "green", size: 38},
    {kind: "chip", at: m("walk.login-open", 0.5), dur: 1.9, text: "6 routine steps stay quiet", x: 372, y: 748, tone: "green", size: 38},
    {kind: "chip", at: m("walk.login-open", 2.5), dur: 2.4, text: "Why: it can't be undone", x: 372, y: 748, tone: "red", size: 38},
    {kind: "menu", at: m("walk.deck", -0.5), dur: 3.8, items: ["Ask", "Send review", "Refresh"], pick: 0, note: "Menu drawn for this film: the simulator can't show it."},
    {
      kind: "reply",
      at: m("walk.sent", 0.5),
      dur: 7.0,
      who: "T3 Code · Codex · project pinpoint",
      tag: "Real",
      body: replyBody(t3.login.before, t3.login.after),
      meta: `Real thread · answered in ${t3.login.seconds} s · the glasses show the sample workspace`,
    },
  ],
  tags: tagsSim,
};

export const EVERYDAY: FootageSceneProps = {
  label: "Everyday · a parent",
  duration: dur("everyday"),
  photos: [{at: 0, src: "stills/final/cafe.jpg", push: 0.06, pan: 24}],
  segs: toSegs("everyday"),
  rail: [
    {at: m("everyday.plan-open", -0.2), dur: 3.0, label: "Tap", sub: "opens on the line", mode: "tap"},
    {at: m("everyday.plan-deck", 1.2), dur: 2.9, label: "Say the fix", sub: "tap to talk", mode: "talk"},
    {at: m("everyday.draft-open", -0.2), dur: 3.0, label: "Tap", sub: "opens on the line", mode: "tap"},
    {at: m("everyday.draft-deck", 1.4), dur: 2.9, label: "Say the fix", sub: "tap to talk", mode: "talk"},
    {at: m("everyday.task-listen", 0.0), dur: 3.2, label: "Say the job", sub: "tap to stop", mode: "talk"},
    {at: m("everyday.dentist-options", -1.0), dur: 3.6, label: "One tap", sub: "choose", mode: "tap"},
  ],
  overlays: [
    {kind: "chip", at: m("everyday.plan-open", 0.6), dur: 3.4, text: "Flagged: 9°C and windy", x: 372, y: 748, tone: "amber", size: 38},
    {
      kind: "reply",
      at: m("everyday.plan-sent", 0.25),
      dur: 4.4,
      who: "T3 Code · Codex · project pinpoint",
      tag: "Real",
      body: replyBody(t3.saturday.before, t3.saturday.after),
      meta: `Real thread · answered in ${t3.saturday.seconds} s · the glasses show the sample workspace`,
    },
    {kind: "chip", at: m("everyday.draft-deck", 2.4), dur: 3.4, text: "Changed in place · 5% → 3%", x: 372, y: 748, tone: "green", size: 38},
    {kind: "menu", at: m("everyday.task-listen", -1.2), dur: 3.4, items: ["New task", "Agree & send", "Refresh"], pick: 0, note: "Menu drawn for this film: the simulator can't show it."},
    {kind: "chip", at: m("everyday.dentist-options", -0.2), dur: 3.8, text: "Sample result: nothing is booked", x: 372, y: 748, tone: "amber", size: 38},
  ],
  tags: tagsSim,
};
