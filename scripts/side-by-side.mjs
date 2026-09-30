#!/usr/bin/env node
// Puts two recordings of the same scenario side by side, each under a caption, frame for frame
// (both are frame-stepped at 30 frames/s from the same scenario, so frame n is the same moment).
//
//   node scripts/side-by-side.mjs <left.mp4> "<left caption>" <right.mp4> "<right caption>" <out.mp4>
//
// Needs ffmpeg ($FFMPEG, `ffmpeg` on the PATH, or Python's imageio-ffmpeg). The captions are
// drawn by Chromium (Playwright), so no font setup is needed for ffmpeg.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [left, leftLabel, right, rightLabel, out] = process.argv.slice(2);
if (!out) {
  console.error('usage: node scripts/side-by-side.mjs <left.mp4> "<caption>" <right.mp4> "<caption>" <out.mp4>');
  process.exit(2);
}
function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    return execFileSync('python3', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  }
}
const FF = ffmpegPath();
/** A video's frame size, from ffmpeg's description of it (ffmpeg exits with an error when given no output). */
function sizeOf(f) {
  let txt = '';
  try {
    execFileSync(FF, ['-hide_banner', '-i', f], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    txt = String(e.stderr ?? '');
  }
  const m = txt.match(/Video:.*?, (\d{2,5})x(\d{2,5})/);
  if (!m) throw new Error(`${f}: not a video`);
  return { w: Number(m[1]), h: Number(m[2]) };
}
const size = sizeOf(left);
const { w, h } = size;
const bar = 40;
const dir = mkdtempSync(join(tmpdir(), 'sbs-'));
const label = join(dir, 'label.png');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: w * 2, height: bar } });
await page.setContent(`<body style="margin:0;background:#0a0b0d;color:#e9eaee;font:600 17px system-ui,sans-serif;display:flex">
  <div style="width:${w}px;height:${bar}px;display:flex;align-items:center;padding-left:16px;box-sizing:border-box">${leftLabel}</div>
  <div style="width:${w}px;height:${bar}px;display:flex;align-items:center;padding-left:16px;box-sizing:border-box;border-left:2px solid #2a2c33">${rightLabel}</div></body>`);
await page.screenshot({ path: label });
await browser.close();
execFileSync(
  FF,
  ['-hide_banner', '-loglevel', 'error', '-y', '-i', left, '-i', right, '-i', label, '-filter_complex', `[0:v]scale=${w}:${h}[a];[1:v]scale=${w}:${h}[b];[a][b]hstack=shortest=1[s];[s]pad=${w * 2}:${h + bar}:0:${bar}:color=0x0a0b0d[p];[p][2:v]overlay=0:0[out]`, '-map', '[out]', '-c:v', 'libx264', '-crf', '24', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', '30', out],
  { stdio: 'inherit' },
);
rmSync(dir, { recursive: true, force: true });
console.log(`${out}: ${w * 2} x ${h + bar}`);
