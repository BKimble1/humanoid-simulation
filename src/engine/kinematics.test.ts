import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DIM, HIP_HEIGHT } from '../spec/body';
import { ankleFromSole, solveArm, solveLeg } from './ik';
import { RobotModel } from './robot';
import { DEG, Kinematics, Pose, SEGMENTS, restPose } from './skeleton';

describe('forward kinematics', () => {
  it('stands the zero pose on its soles with the documented dimensions', () => {
    const kin = new Kinematics();
    const p = new Pose();
    kin.update(p);
    expect(kin.sole('L').y).toBeCloseTo(0, 6);
    expect(kin.sole('R').y).toBeCloseTo(0, 6);
    expect(kin.sole('L').x).toBeCloseTo(DIM.hipHalfWidth, 6);
    expect(HIP_HEIGHT).toBeCloseTo(0.905, 6);
    // shoulder joint height ≈ 0.818 of standing height (Winter)
    const sh = kin.jointPos[kin.jointPos.length - 1];
    expect(sh).toBeDefined();
    const shoulder = kin.point('L_shoulder_link', [0, 0, 0]);
    expect(shoulder.y / DIM.height).toBeGreaterThan(0.8);
    expect(shoulder.y / DIM.height).toBeLessThan(0.84);
  });

  it('has every segment in topological order', () => {
    expect(SEGMENTS[0]).toBe('pelvis');
    expect(SEGMENTS.length).toBe(1 + 29);
  });

  it('bends the knee backwards and the hip forwards for positive angles', () => {
    const kin = new Kinematics();
    const p = new Pose().setDeg({ L_hip_pitch: 30, L_knee: 60 });
    kin.update(p);
    const knee = kin.point('L_shin', [0, 0, 0]);
    const ankle = kin.point('L_ankle_link', [0, 0, 0]);
    expect(knee.z).toBeGreaterThan(0.1); // thigh forward
    expect(ankle.z).toBeLessThan(knee.z); // shin back from the knee
  });
});

describe('leg inverse kinematics', () => {
  const cases: [string, Vector3, Quaternion][] = [
    ['under the hip, crouched', new Vector3(DIM.hipHalfWidth, 0.12, 0.02), new Quaternion()],
    ['forward and out, yawed', new Vector3(0.14, 0.15, 0.2), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3)],
    ['behind, rolled and pitched', new Vector3(0.05, 0.2, -0.15), new Quaternion().setFromAxisAngle(new Vector3(1, 0.3, 0).normalize(), 0.25)],
  ];
  for (const [name, ankle, q] of cases) {
    it(`reaches the target: ${name}`, () => {
      const kin = new Kinematics();
      const p = new Pose();
      p.pelvisPos.set(0, 0.86, 0);
      p.pelvisQuat.setFromAxisAngle(new Vector3(0, 1, 0), 0.1);
      const r = solveLeg(p, 'L', ankle, q, kin.scale);
      expect(r.reached).toBe(true);
      kin.update(p);
      const got = kin.point('L_foot', [0, 0, 0]);
      expect(got.distanceTo(ankle)).toBeLessThan(1e-6);
      const gq = new Quaternion().setFromRotationMatrix(kin.frames.get('L_foot')!);
      expect(Math.abs(gq.dot(q))).toBeGreaterThan(1 - 1e-9);
    });
  }

  it('mirrors correctly for the right leg', () => {
    const kin = new Kinematics();
    const p = new Pose();
    p.pelvisPos.set(0, 0.87, 0);
    const target = new Vector3(-0.12, 0.1, 0.1);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -0.2);
    solveLeg(p, 'R', target, q, kin.scale);
    kin.update(p);
    expect(kin.point('R_foot', [0, 0, 0]).distanceTo(target)).toBeLessThan(1e-6);
    // positive knee is flexion on both sides
    expect(p.get('R_knee')).toBeGreaterThan(0);
  });

  it('reports a target out of reach', () => {
    const kin = new Kinematics();
    const p = new Pose();
    p.pelvisPos.set(0, 1.2, 0);
    const r = solveLeg(p, 'L', ankleFromSole(new Vector3(DIM.hipHalfWidth, 0, 0), new Quaternion()), new Quaternion(), kin.scale);
    expect(r.reached).toBe(false);
    expect(r.shortfall).toBeGreaterThan(0.2);
  });
});

describe('arm inverse kinematics', () => {
  it('reaches a point in front of the chest', () => {
    const kin = new Kinematics();
    const p = restPose();
    p.pelvisPos.set(0, 0.9, 0);
    const target = new Vector3(0.25, 1.15, 0.4);
    const r = solveArm(p, 'L', target, kin);
    expect(r.reached).toBe(true);
    expect(r.error).toBeLessThan(0.002);
  });

  it('reports an unreachable target with the remaining distance', () => {
    const kin = new Kinematics();
    const p = restPose();
    p.pelvisPos.set(0, 0.9, 0);
    const r = solveArm(p, 'L', new Vector3(0.3, 1.3, 1.4), kin);
    expect(r.reached).toBe(false);
    expect(r.error).toBeGreaterThan(0.5);
  });

  it('keeps every joint inside its limits', () => {
    const kin = new Kinematics();
    const p = restPose();
    solveArm(p, 'R', new Vector3(-0.6, 1.6, -0.2), kin);
    for (const id of ['R_elbow', 'R_shoulder_roll', 'R_shoulder_pitch'] as const) {
      const v = p.get(id) / DEG;
      expect(v).toBeGreaterThanOrEqual(-60.01);
      expect(v).toBeLessThanOrEqual(180.01);
    }
    expect(p.get('R_elbow')).toBeGreaterThanOrEqual(0);
  });
});

describe('mass model', () => {
  it('sums the component budget to a plausible adult humanoid', () => {
    const m = new RobotModel();
    expect(m.robotMass).toBeGreaterThan(58);
    expect(m.robotMass).toBeLessThan(70);
    const by = m.bySubsystem();
    expect(by.power).toBeCloseTo(m.pack.mass + 0.9, 3);
    expect(by.actuator / m.robotMass).toBeGreaterThan(0.3);
    expect(by.actuator / m.robotMass).toBeLessThan(0.5);
  });

  it('puts the standing centre of mass near 0.55–0.6 of height, centred', () => {
    const m = new RobotModel();
    const kin = new Kinematics();
    const p = new Pose();
    kin.update(p);
    const c = m.com(kin);
    expect(c.y / DIM.height).toBeGreaterThan(0.54);
    expect(c.y / DIM.height).toBeLessThan(0.61);
    expect(Math.abs(c.x)).toBeLessThan(1e-9);
    expect(Math.abs(c.z)).toBeLessThan(0.03);
  });

  it('moves the centre of mass forward with a payload held in front', () => {
    const kin = new Kinematics();
    const p = new Pose();
    kin.update(p);
    const base = new RobotModel().com(kin);
    const loaded = new RobotModel({ ...new RobotModel().config, payload: 20 });
    const c = loaded.com(kin, new Vector3(0, 1.1, 0.36));
    expect(c.z).toBeGreaterThan(base.z + 0.08);
    expect(loaded.totalMass - loaded.robotMass).toBeCloseTo(20, 9);
  });
});
