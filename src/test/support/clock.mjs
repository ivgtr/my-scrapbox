export function fakeClock(initial = Date.parse('2026-09-26T10:00:00Z')) {
  let time = initial;
  return {
    sleeps: [],
    now: () => time,
    monotonic: () => time,
    sleep: async function (ms) { this.sleeps.push(ms); time += ms; },
    advance: ms => { time += ms; }
  };
}
