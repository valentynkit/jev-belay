// vhs frames -> the captioned 1920x1080 clip. Finds the BLOCKED and PASSED moments by
// colour in the right pane, speeds through the stretches where Claude is working, holds
// the moments that matter, and overlays explanations rendered from HTML by the headless
// Chromium vhs already installed (this ffmpeg build has no drawtext, and Chromium sets
// type better anyway).
//
//   node demo/render.mjs <framesDir> <out.mp4> '{"fps":15,"t1":4,"t2AfterBlock":77}'
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

const [dir, out, json] = process.argv.slice(2);
const T = JSON.parse(json);
const FPS = T.fps || 15;
const FAST = T.fast || 6;
const W = 1920, H = 1080, BAND = 120;
const CHROME = readdirSync(join(homedir(), ".cache/rod/browser")).map((d) =>
  join(homedir(), ".cache/rod/browser", d, "Chromium.app/Contents/MacOS/Chromium"))[0];

const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${args.join(" ").slice(0, 160)}\n${r.stderr}`);
  return r.stdout;
};
const ffmpeg = (args) => sh("ffmpeg", ["-loglevel", "error", "-y", ...args]);
const work = mkdtempSync(join(tmpdir(), "belay-render-"));
const frames = readdirSync(dir).filter((f) => f.startsWith("frame-text-")).length;

// The verdict bands are the only full-width runs of one colour in the right pane. A 48x108
// downscale keeps a 22 px band as two clean rows. Colours are what xterm.js paints for
// the Kanagawa red and green backgrounds, sampled from a recording.
function findBands() {
  const w = 48, h = 108;
  const raw = sh("ffmpeg", ["-loglevel", "error", "-framerate", String(FPS), "-i", `${dir}/frame-text-%05d.png`,
    "-vf", `crop=iw*0.45:ih:iw*0.55:0,scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const near = (i, R, G, B) => Math.abs(raw[i] - R) < 40 && Math.abs(raw[i + 1] - G) < 40 && Math.abs(raw[i + 2] - B) < 40;
  let blocked, passed;
  for (let f = 0; f < raw.length / (w * h * 3); f++) {
    for (let y = 0; y < h && !(blocked && passed); y++) {
      let red = 0, green = 0;
      for (let x = 0; x < w; x++) {
        const i = ((f * h + y) * w + x) * 3;
        if (near(i, 232, 36, 36)) red++;
        if (near(i, 118, 148, 106)) green++;
      }
      if (red > w * 0.7 && blocked === undefined) blocked = f / FPS;
      if (green > w * 0.7 && passed === undefined) passed = f / FPS;
    }
  }
  if (blocked === undefined || passed === undefined) throw new Error(`bands not found: blocked=${blocked} passed=${passed}`);
  return { blocked, passed };
}

const { blocked: tBlocked, passed: tPassed } = findBands();
const t1 = T.t1, t2 = tBlocked + T.t2AfterBlock, tEnd = frames / FPS;
console.log(JSON.stringify({ frames, t1, tBlocked, t2, tPassed, tEnd }));

const CSS = `
  * { margin: 0; box-sizing: border-box; }
  body { background: transparent; font-family: 'JetBrainsMono Nerd Font Mono', monospace; color: #dcd7ba; }
  .card { width: ${W}px; height: ${H}px; background: #1f1f28; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 18px; }
  .band { width: ${W}px; height: ${BAND}px; background: rgba(31,31,40,.95); border-top: 2px solid #2a2a37;
          display: flex; align-items: center; justify-content: center; padding: 0 80px; position: relative; }
  .band p { font-size: 32px; line-height: 1.35; text-align: center; }
  .band .speed { position: absolute; right: 36px; top: 34px; font-size: 26px; color: #727169; }
  .band b { color: #e46876; font-weight: 700; } .band i { color: #98bb6c; font-style: normal; font-weight: 700; }
  .card h1 { font-size: 84px; font-weight: 700; } .card h1.red { color: #e46876; }
  .card p { font-size: 30px; color: #a6a69c; margin-top: 30px; }
  .card code { font-size: 42px; color: #dcd7ba; display: block; line-height: 1.6; }
  .card .url { color: #98bb6c; font-size: 34px; margin-top: 40px; }
`;
const shot = (name, body, height) => {
  const html = join(work, `${name}.html`), png = join(work, `${name}.png`);
  writeFileSync(html, `<html><head><style>${CSS}</style></head><body>${body}</body></html>`);
  sh(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
    `--window-size=${W},${height}`, `--screenshot=${png}`, `file://${html}`]);
  return png;
};
const still = (png, secs, path) => ffmpeg(["-loop", "1", "-framerate", "30", "-i", png, "-t", String(secs), "-vf", "format=yuv420p",
  "-c:v", "libx264", "-preset", "fast", "-crf", "18", path]);

still(shot("title", `<div class="card"><h1>Claude Code said Done.</h1><h1 class="red">Nothing ran.</h1>
  <p>jev-belay: a Stop hook that reads the transcript before it believes the claim</p></div>`, H), 2.8, join(work, "title.mp4"));
still(shot("end", `<div class="card"><code>/plugin marketplace add valentynkit/jev-belay<br>/plugin install jev-belay@jev-belay</code>
  <p>one Jev call on the 17% of stops that need it, $0.00002 each, every error path exits 0</p>
  <div class="url">github.com/valentynkit/jev-belay</div></div>`, H), 3.5, join(work, "end.mp4"));

// Source timeline segments: [from, to, speed, caption]. Held at 1x around the events,
// FAST through the model's working stretches.
const segs = [
  [0, t1 + 1.0, 1, "A real Claude Code session. Two prompts, and neither one mentions tests."],
  [t1 + 1.0, tBlocked - 3.5, FAST, "Claude reads the files and makes the change"],
  [tBlocked - 3.5, tBlocked + 1.2, 1, "It says <b>Done</b>. belay reads the transcript first: files changed, <b>nothing ran</b>"],
  [tBlocked + 1.2, tBlocked + 8.5, 1, "One Jev call, four questions, $0.00002. <b>BLOCKED</b>, and the reason goes back to Claude"],
  [tBlocked + 8.5, t2 - 0.6, FAST, "Claude runs the suite itself, finds a real failure it was about to skip, and fixes it"],
  [t2 - 0.6, t2 + 4.0, 1, "Next task"],
  [t2 + 4.0, tPassed - 2.0, FAST, "This time it runs the tests before reporting"],
  [tPassed - 2.0, tEnd, 1, "A passing check after the last change: <i>no call, $0</i>. belay only speaks when nothing ran"],
].filter(([a, b]) => b > a + 0.2);

const parts = [join(work, "title.mp4")];
let total = 2.8 + 3.5;
segs.forEach(([from, to, speed, caption], i) => {
  const band = shot(`band${i}`, `<div class="band"><p>${caption}</p>${speed > 1 ? `<div class="speed">${speed}x</div>` : ""}</div>`, BAND);
  const path = join(work, `seg${i}.mp4`);
  // -t before -i bounds the frames read; after it, it would bound the retimed output.
  ffmpeg(["-framerate", String(FPS), "-start_number", String(Math.max(1, Math.round(from * FPS) + 1)), "-t", String(to - from),
    "-i", `${dir}/frame-text-%05d.png`, "-i", band,
    "-filter_complex", `[0:v]setpts=PTS/${speed},scale=${W}:${H}:flags=lanczos[v];[v][1:v]overlay=0:${H - BAND}:format=auto,format=yuv420p[o]`,
    "-map", "[o]", "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "18", path]);
  parts.push(path);
  total += (to - from) / speed;
});
parts.push(join(work, "end.mp4"));

writeFileSync(join(work, "list.txt"), parts.map((p) => `file '${p}'`).join("\n"));
ffmpeg(["-f", "concat", "-safe", "0", "-i", join(work, "list.txt"), "-c:v", "libx264", "-preset", "slow", "-crf", "19",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
console.log(`wrote ${out}: about ${total.toFixed(1)}s`);
