// Scenarios for scripts/probe.mjs: sequences of visitor actions on the frame-stepped clock
// (30 frames a second). Each exercises one of the V2 acceptance checks.

/** Chapter indices of the guided tour (src/world/tour.ts). */
const CHAPTER = { intro: 0, structure: 1, actuators: 2, inside: 3, power: 4, compute: 5, vision: 6, grip: 7, balance: 8, walk: 9, thermal: 10, limit: 11, end: 12 };

export const SCENARIOS = {
  /** 1. Overview → hand → actuators → forces: the idle source is shared by all four. */
  'explore-hands': {
    async run(a) {
      await a.set({ mode: 'explore', system: 'overview' });
      await a.advance(90);
      a.mark('hands');
      await a.set({ mode: 'explore', system: 'hands' });
      await a.advance(75);
      a.mark('actuators');
      await a.set({ mode: 'explore', system: 'actuators' });
      await a.advance(75);
      a.mark('forces');
      await a.set({ mode: 'explore', system: 'forces' });
      await a.advance(75);
      // repeated clicks and back again mid-move
      a.mark('rapid');
      for (const sys of ['hands', 'overview', 'hands', 'actuators', 'hands']) {
        await a.set({ mode: 'explore', system: sys });
        await a.advance(8);
      }
      await a.advance(60);
      // payload while standing: arms go to the carry posture and back
      a.mark('payload');
      await a.eval(() => window.__fabStores.useApp.getState().setConfig({ payload: 15 }));
      await a.advance(45);
      await a.eval(() => window.__fabStores.useApp.getState().setConfig({ payload: 0 }));
      await a.advance(60);
    },
  },

  /** 2. Knee → hip → elbow while open, reversed midway; all six directional handoffs. */
  'actuator-switch': {
    async run(a) {
      await a.set({ mode: 'explore', system: 'actuators', actuator: 'knee' });
      await a.advance(60);
      await a.set({ exploded: true });
      await a.advance(150);
      for (const [to, n] of [['hip', 120], ['elbow', 120], ['knee', 120], ['elbow', 120], ['hip', 120], ['knee', 120]]) {
        a.mark(`to ${to}`);
        await a.set({ actuator: to });
        await a.advance(n);
      }
      // reversed midway
      a.mark('hip then back to knee midway');
      await a.set({ actuator: 'hip' });
      await a.advance(20);
      await a.set({ actuator: 'knee' });
      await a.advance(120);
      // a part in focus survives a change it can, and clears when it cannot
      await a.set({ part: 'rotor' });
      await a.advance(40);
      await a.set({ actuator: 'elbow' });
      await a.advance(120);
      await a.set({ exploded: false });
      await a.advance(120);
    },
  },

  /** 3. Pick and place, one hand and two hands. */
  'manip-stages': {
    async run(a) {
      await a.set({ mode: 'simulate', lab: 'manipulation' });
      await a.lab({ task: 'box' });
      await a.advance(150);
      a.mark('pick box');
      await a.eval(() => window.__fab.manip.pick());
      await a.advance(200);
      a.mark('place box');
      await a.eval(() => window.__fab.manip.place());
      await a.advance(160);
      await a.lab({ task: 'tool' });
      await a.advance(30);
      a.mark('pick tool');
      await a.eval(() => window.__fab.manip.pick());
      await a.advance(200);
      a.mark('place tool');
      await a.eval(() => window.__fab.manip.place());
      await a.advance(160);
      // leave mid-grasp, come back
      await a.lab({ task: 'vial' });
      await a.advance(20);
      await a.eval(() => window.__fab.manip.pick());
      await a.advance(80);
      a.mark('leave mid-grasp');
      await a.set({ mode: 'explore', system: 'hands' });
      await a.advance(90);
      await a.set({ mode: 'simulate', lab: 'manipulation' });
      await a.advance(120);
    },
  },

  /** 4. Walking start/stop, gait change, carrying, walk → balance. */
  'walk-contact': {
    async run(a) {
      await a.set({ mode: 'simulate', lab: 'walk' });
      await a.advance(60);
      a.mark('start');
      await a.lab({ walking: true, gait: 'normal', carry: false });
      await a.advance(150);
      a.mark('fast');
      await a.lab({ gait: 'fast' });
      await a.advance(120);
      a.mark('stop');
      await a.lab({ walking: false });
      await a.advance(90);
      a.mark('carry');
      await a.lab({ carry: true, walking: true, gait: 'slow' });
      await a.advance(150);
      await a.lab({ walking: false });
      await a.advance(60);
      await a.lab({ carry: false });
      await a.advance(30);
      a.mark('walk to balance');
      await a.lab({ walking: true, gait: 'normal' });
      await a.advance(75);
      await a.set({ mode: 'simulate', lab: 'balance' });
      await a.advance(120);
      a.mark('one foot then overview');
      await a.lab({ balanceTask: 'oneFoot' });
      await a.advance(90);
      await a.set({ mode: 'explore', system: 'overview' });
      await a.advance(90);
    },
  },

  /** 5. Watch paused in several chapters: nothing presented may change. */
  'watch-pause': {
    async run(a) {
      await a.set({ mode: 'watch' });
      await a.advance(30);
      for (const [ch, lead] of [['walk', 150], ['inside', 120], ['grip', 150], ['thermal', 120]]) {
        await a.eval((idx) => {
          const w = window.__fab;
          if (w.tour.jump) return w.tour.jump(idx);
          let guard = 20; // V1 has no jump: step with next()
          while (w.tour.index !== idx && guard-- > 0) w.tour.next();
        }, CHAPTER[ch]);
        await a.advance(lead);
        a.mark(`pause ${ch}`);
        await a.eval(() => window.__fab.tour.paused || window.__fab.tour.toggle());
        await a.advance(120);
        a.mark(`resume ${ch}`);
        await a.eval(() => window.__fab.tour.toggle());
        await a.advance(30);
      }
      await a.set({ mode: 'intro' });
      await a.advance(30);
    },
  },

  /** 7. Scene changes every 100–300 ms while everything moves. */
  rapid: {
    async run(a) {
      const places = [
        { mode: 'explore', system: 'overview' },
        { mode: 'explore', system: 'actuators', exploded: true },
        { mode: 'simulate', lab: 'walk' },
        { mode: 'explore', system: 'power' },
        { mode: 'simulate', lab: 'manipulation' },
        { mode: 'explore', system: 'hands' },
        { mode: 'simulate', lab: 'balance' },
        { mode: 'engineer' },
        { mode: 'explore', system: 'thermal' },
        { mode: 'simulate', lab: 'joint' },
        { mode: 'explore', system: 'vision' },
        { mode: 'simulate', lab: 'kinematics' },
        { mode: 'intro' },
      ];
      let seed = 3;
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      await a.lab({ walking: true });
      for (let k = 0; k < 60; k++) {
        const p = places[Math.floor(rnd() * places.length)];
        await a.set({ exploded: false, ...p });
        await a.advance(3 + Math.floor(rnd() * 7));
      }
      await a.set({ mode: 'explore', system: 'overview', exploded: false });
      await a.advance(150);
    },
  },
};
