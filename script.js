const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const backgroundCanvas = document.createElement("canvas");
const backgroundCtx = backgroundCanvas.getContext("2d");

const scoreEl = document.querySelector("#score");
const scoreCardEl = document.querySelector(".score-card");
const bestEl = document.querySelector("#best");
const timerEl = document.querySelector("#timer");
const homingEl = document.querySelector("#homing");
const homingCardEl = document.querySelector("#homingCard");
const overlay = document.querySelector("#overlay");
const panelMode = document.querySelector("#panelMode");
const panelTitle = document.querySelector("#panelTitle");
const panelText = document.querySelector("#panelText");
const startBtn = document.querySelector("#startBtn");
const launchBtn = document.querySelector("#launchBtn");
const stage = document.querySelector(".stage-wrap");

const TAU = Math.PI * 2;
const BEST_KEY = "orbit-breaker-best";
const VIEW_SCALE = 0.78;

let state = "ready";
let score = 0;
let best = Number(localStorage.getItem(BEST_KEY) || 0);
let lastTime = 0;
let time = 0;
let runTime = 0;
let capturePulse = 0;
let dangerPulse = 0;
let screenShake = 0;
let deathTimer = 0;
let deathReason = "miss";
let deathFragments = [];
let perfectWindow = 0;
let particles = [];
let engineSparks = [];
let sparkAccumulator = 0;
let stars = [];
let nebulae = [];
let hazards = [];
let wormhole = null;
let homingPickup = null;
let fadingObjects = [];
let homingCharges = 0;
let homingActiveThisLaunch = false;

let camera = { x: 0, y: 0 };
let currentPlanet;
let targetPlanet;
let satellite;

const palette = [
  { core: "#6ee7ff", glow: "rgba(93, 231, 255, 0.55)" },
  { core: "#9b7cff", glow: "rgba(155, 124, 255, 0.56)" },
  { core: "#ffd166", glow: "rgba(255, 209, 102, 0.5)" },
  { core: "#a7f36b", glow: "rgba(167, 243, 107, 0.48)" },
  { core: "#ff8fab", glow: "rgba(255, 143, 171, 0.45)" },
];

bestEl.textContent = best;
timerEl.textContent = "0:00";

function newPlanet(x, y, options = {}) {
  const color = options.color || palette[Math.floor(Math.random() * palette.length)];
  const difficulty = Math.min(16, Math.max(0, score));
  return {
    x,
    y,
    r: options.r ?? Math.max(22, 38 - difficulty * 0.7 + Math.random() * 4),
    gravity: options.gravity ?? Math.max(54, 102 - difficulty * 2.3),
    orbit: options.orbit ?? 62,
    color,
    vx: options.vx ?? 0,
    vy: options.vy ?? 0,
    golden: Boolean(options.golden),
    birth: options.birth ?? 0,
  };
}

function resetGame() {
  state = "orbiting";
  score = 0;
  runTime = 0;
  particles = [];
  engineSparks = [];
  sparkAccumulator = 0;
  hazards = [];
  wormhole = null;
  homingPickup = null;
  fadingObjects = [];
  homingCharges = 0;
  homingActiveThisLaunch = false;
  capturePulse = 0;
  dangerPulse = 0;
  screenShake = 0;
  deathTimer = 0;
  deathReason = "miss";
  deathFragments = [];
  perfectWindow = 0;
  camera = { x: 0, y: 0 };

  currentPlanet = newPlanet(0, 0, {
    r: 42,
    gravity: 112,
    orbit: 72,
    color: palette[1],
  });

  satellite = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    orbitDir: 1,
    orbitSpeed: 1.65,
    trail: [],
  };

  spawnNextPlanet(true);
  updateHud();
  overlay.classList.add("hidden");
  startBtn.textContent = "Restart";
}

function updateHud() {
  scoreEl.textContent = score;
  bestEl.textContent = best;
  timerEl.textContent = formatRunTime(runTime);
  homingEl.textContent = homingCharges > 0 ? "Ready" : "Empty";
  homingCardEl.classList.toggle("ready", homingCharges > 0);
  scoreCardEl.classList.remove("heat-1", "heat-2", "heat-3", "heat-4");
  const heatTier = Math.min(4, Math.floor(score / 4));
  if (heatTier > 0) scoreCardEl.classList.add(`heat-${heatTier}`);
}

function formatRunTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = String(total % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function screenCenter() {
  if (screenShake <= 0) return { x: canvas.width / 2, y: canvas.height / 2 };
  const force = screenShake * screenShake * 12;
  return {
    x: canvas.width / 2 + Math.sin(time * 78) * force,
    y: canvas.height / 2 + Math.cos(time * 91) * force,
  };
}

function toScreen(point) {
  const c = screenCenter();
  return {
    x: (point.x - camera.x) * VIEW_SCALE + c.x,
    y: (point.y - camera.y) * VIEW_SCALE + c.y,
  };
}

function view(value) {
  return value * VIEW_SCALE;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function easeOutBack(value) {
  const t = clamp01(value) - 1;
  return 1 + t * t * (2.7 * t + 1.7);
}

function easeIn(value) {
  const t = clamp01(value);
  return t * t;
}

function norm(vx, vy) {
  const len = Math.hypot(vx, vy) || 1;
  return { x: vx / len, y: vy / len };
}

function launchVectorFor(angle) {
  // The satellite nose points away from the current planet. Launch uses that
  // exact radial direction so the guide line, sprite, and motion all agree.
  return norm(Math.cos(angle), Math.sin(angle));
}

function satelliteOrbitPosition(angle = satellite.angle) {
  return {
    x: currentPlanet.x + Math.cos(angle) * currentPlanet.orbit,
    y: currentPlanet.y + Math.sin(angle) * currentPlanet.orbit,
  };
}

function spawnNextPlanet(first = false) {
  if (!first) clearRoundObjects();
  const futureAngle = satellite.angle + randomBetween(0.95, 2.55) * satellite.orbitDir;
  const launchFrom = satelliteOrbitPosition(futureAngle);
  const dir = launchVectorFor(futureAngle);
  const normal = { x: -dir.y, y: dir.x };
  const distance = first ? 360 : randomBetween(340, 470);
  const targetGravity = Math.max(58, 108 - score * 2.2);
  const offset = randomBetween(-targetGravity * 0.28, targetGravity * 0.28);
  const x = launchFrom.x + dir.x * distance + normal.x * offset;
  const y = launchFrom.y + dir.y * distance + normal.y * offset;
  const speed = first ? 0 : Math.min(18, 3 + score * 0.8);
  const driftAngle = randomBetween(0, TAU);
  const golden = score > 3 && Math.random() < 0.13;

  targetPlanet = newPlanet(x, y, {
    gravity: golden ? targetGravity * 1.08 : targetGravity,
    r: golden ? 30 : undefined,
    vx: Math.cos(driftAngle) * speed,
    vy: Math.sin(driftAngle) * speed,
    golden,
    color: golden ? { core: "#ffd166", glow: "rgba(255, 209, 102, 0.62)" } : undefined,
  });

  if (score >= 4) spawnBlackHole();
  if (score >= 7 && Math.random() < 0.45) spawnWormhole();
  if (!first && score >= 2 && Math.random() < 0.34) spawnHomingPickup();
}

function clearRoundObjects() {
  for (const hole of hazards) fadeObject("hazard", { ...hole });
  if (wormhole) fadeObject("wormhole", { ...wormhole });
  if (homingPickup) fadeObject("pickup", { ...homingPickup });
  hazards = [];
  wormhole = null;
  homingPickup = null;
}

function fadeObject(type, object, duration = 0.28) {
  fadingObjects.push({ type, object, age: 0, duration });
  if (fadingObjects.length > 18) fadingObjects.shift();
}

function spawnBlackHole() {
  const from = currentPlanet;
  const to = targetPlanet;
  const t = randomBetween(0.38, 0.68);
  const px = from.x + (to.x - from.x) * t;
  const py = from.y + (to.y - from.y) * t;
  const line = norm(to.x - from.x, to.y - from.y);
  const normal = { x: -line.y, y: line.x };
  hazards.push({
    x: px + normal.x * randomBetween(-120, 120),
    y: py + normal.y * randomBetween(-120, 120),
    r: Math.min(42, 28 + score * 0.8),
    pull: 64 + score * 4,
    birth: 0,
  });
}

function spawnWormhole() {
  const from = currentPlanet;
  const to = targetPlanet;
  wormhole = {
    x: from.x + (to.x - from.x) * randomBetween(0.25, 0.75) + randomBetween(-150, 150),
    y: from.y + (to.y - from.y) * randomBetween(0.25, 0.75) + randomBetween(-150, 150),
    r: 34,
    cooldown: 0,
    birth: 0,
  };
}

function spawnHomingPickup() {
  const from = currentPlanet;
  const to = targetPlanet;
  const line = norm(to.x - from.x, to.y - from.y);
  const normal = { x: -line.y, y: line.x };
  homingPickup = {
    x: from.x + (to.x - from.x) * randomBetween(0.32, 0.62) + normal.x * randomBetween(-70, 70),
    y: from.y + (to.y - from.y) * randomBetween(0.32, 0.62) + normal.y * randomBetween(-70, 70),
    r: 22,
    bob: randomBetween(0, TAU),
    birth: 0,
  };
}

function nearestHomingPlanet() {
  const candidates = [targetPlanet];
  let bestPlanet = candidates[0];
  let bestDistance = Infinity;
  for (const planet of candidates) {
    const dx = planet.x - satellite.x;
    const dy = planet.y - satellite.y;
    const distance = Math.hypot(dx, dy);
    const forward = dx * satellite.vx + dy * satellite.vy;
    if (forward <= 0) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPlanet = planet;
    }
  }
  return bestPlanet || targetPlanet;
}

function isSafeFromHazards(x, y, margin = 16) {
  for (const hole of hazards) {
    const distance = Math.hypot(x - hole.x, y - hole.y);
    if (distance < hole.r + margin) return false;
  }
  return true;
}

function routeThroughWormhole() {
  const speed = Math.hypot(satellite.vx, satellite.vy) || 1;
  const incoming = norm(satellite.vx, satellite.vy);
  const toTarget = norm(targetPlanet.x - wormhole.x, targetPlanet.y - wormhole.y);

  // Exit on the approach side of the next planet so the portal preserves the
  // run's forward motion instead of dumping the player behind the target.
  const exitDir = (incoming.x * toTarget.x + incoming.y * toTarget.y) > 0.2
    ? incoming
    : toTarget;
  let exitX = targetPlanet.x - exitDir.x * (targetPlanet.gravity + targetPlanet.r + 68);
  let exitY = targetPlanet.y - exitDir.y * (targetPlanet.gravity + targetPlanet.r + 68);
  let corrected = norm(targetPlanet.x - exitX, targetPlanet.y - exitY);
  let foundSafeExit = false;

  // Try a handful of exit lanes around the target so a wormhole never places
  // the player directly inside a black hole.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const angleOffset = (attempt - 4.5) * 0.18;
    const cos = Math.cos(angleOffset);
    const sin = Math.sin(angleOffset);
    const rotated = {
      x: exitDir.x * cos - exitDir.y * sin,
      y: exitDir.x * sin + exitDir.y * cos,
    };
    const normal = { x: -rotated.y, y: rotated.x };
    const exitDistance = targetPlanet.gravity + targetPlanet.r + 54 + attempt * 8;
    const sideJitter = attempt === 0 ? 0 : randomBetween(-targetPlanet.gravity * 0.12, targetPlanet.gravity * 0.12);
    const candidateX = targetPlanet.x - rotated.x * exitDistance + normal.x * sideJitter;
    const candidateY = targetPlanet.y - rotated.y * exitDistance + normal.y * sideJitter;
    if (!isSafeFromHazards(candidateX, candidateY, 20)) continue;

    exitX = candidateX;
    exitY = candidateY;
    corrected = norm(targetPlanet.x - exitX, targetPlanet.y - exitY);
    foundSafeExit = true;
    break;
  }

  // If every nearby lane is bad, fall back to the far side of the target.
  if (!foundSafeExit) {
    exitX = targetPlanet.x - exitDir.x * (targetPlanet.gravity + targetPlanet.r + 124);
    exitY = targetPlanet.y - exitDir.y * (targetPlanet.gravity + targetPlanet.r + 124);
    corrected = norm(targetPlanet.x - exitX, targetPlanet.y - exitY);
  }

  satellite.x = exitX;
  satellite.y = exitY;
  satellite.vx = corrected.x * speed;
  satellite.vy = corrected.y * speed;
  satellite.trail = [{ x: satellite.x, y: satellite.y }];
}

function launch() {
  if (state === "ready" || state === "lost") {
    resetGame();
    return;
  }
  if (state !== "orbiting") return;

  const dir = launchVectorFor(satellite.angle);
  const pos = satelliteOrbitPosition();
  const speed = 290 + Math.min(score, 18) * 10;
  homingActiveThisLaunch = homingCharges > 0;
  if (homingActiveThisLaunch) homingCharges -= 1;

  satellite.x = pos.x;
  satellite.y = pos.y;
  satellite.vx = dir.x * speed;
  satellite.vy = dir.y * speed;
  satellite.trail = [{ x: satellite.x, y: satellite.y }];
  state = "flying";
  burst(satellite.x, satellite.y, "#9b7cff", 18, 150);
  playTone(260, 0.055, "triangle", 0.035);
  updateHud();
}

function capture(planet) {
  const impactSpeed = Math.hypot(satellite.vx, satellite.vy);
  const streakHeat = Math.min(1, score / 16);
  fadeObject("planet", { ...currentPlanet, isTargetVisual: false }, 0.28);
  fadeObject("planet", { ...planet, isTargetVisual: true }, 0.34);
  score += planet.golden ? 3 : 1;
  best = Math.max(best, score);
  localStorage.setItem(BEST_KEY, String(best));

  currentPlanet = newPlanet(planet.x, planet.y, {
    r: planet.r,
    gravity: planet.gravity,
    orbit: Math.max(50, planet.r + 28),
    color: planet.color,
  });
  satellite.angle = Math.atan2(satellite.y - currentPlanet.y, satellite.x - currentPlanet.x);
  satellite.orbitDir = Math.random() > 0.5 ? 1 : -1;
  satellite.orbitSpeed = Math.min(3.5, 1.65 + score * 0.06);
  satellite.trail = [];
  satellite.vx = 0;
  satellite.vy = 0;
  homingActiveThisLaunch = false;
  state = "orbiting";
  capturePulse = 0.42;
  if (score >= 3 || impactSpeed > 320) {
    screenShake = Math.min(1, 0.26 + streakHeat * 0.42 + (planet.golden ? 0.18 : 0));
  }
  burst(currentPlanet.x, currentPlanet.y, planet.golden ? "#ffd166" : "#5de7ff", 28, 220);
  if (score >= 3) burst(currentPlanet.x, currentPlanet.y, "#ff8a2a", 12 + Math.round(streakHeat * 12), 260);
  playTone(planet.golden ? 720 : 520, 0.07, "sine", 0.04);
  spawnNextPlanet();
  updateHud();
}

function lose(reason) {
  if (state === "dying" || state === "lost") return;
  state = "dying";
  deathReason = reason;
  deathTimer = 0;
  best = Math.max(best, score);
  localStorage.setItem(BEST_KEY, String(best));
  panelMode.textContent = reason === "blackhole" ? "Crushed" : "Lost signal";
  panelTitle.textContent = `${score} points`;
  panelText.textContent = reason === "blackhole"
    ? "The black hole ate the transfer. Launch around its edge or wait for a cleaner angle."
    : "You missed the gravity field and drifted into deep space. Watch the violet line and fire when it cuts the next planet's glow.";
  startBtn.textContent = "Try again";
  launchBtn.classList.remove("ready");
  triggerDeathAnimation(reason);
  updateHud();
  playTone(92, 0.18, "sawtooth", 0.045);
}

function triggerDeathAnimation(reason) {
  const speed = Math.hypot(satellite.vx, satellite.vy) || 180;
  const direction = norm(satellite.vx || Math.cos(satellite.angle), satellite.vy || Math.sin(satellite.angle));
  const normal = { x: -direction.y, y: direction.x };
  const color = reason === "blackhole" ? "#ff5277" : "#ffd166";

  deathFragments = [];
  for (let i = 0; i < 11; i += 1) {
    const spray = randomBetween(-1, 1);
    const push = randomBetween(60, 210) + speed * 0.18;
    deathFragments.push({
      x: satellite.x + normal.x * randomBetween(-8, 8),
      y: satellite.y + normal.y * randomBetween(-8, 8),
      vx: direction.x * randomBetween(18, 80) + normal.x * spray * push,
      vy: direction.y * randomBetween(18, 80) + normal.y * spray * push,
      size: randomBetween(4, 11),
      rot: randomBetween(0, TAU),
      spin: randomBetween(-9, 9),
      life: randomBetween(0.55, 0.95),
      maxLife: 0.95,
      color: i % 3 === 0 ? color : i % 2 === 0 ? "#ffffff" : "#ff8a2a",
    });
  }

  burst(satellite.x, satellite.y, color, reason === "blackhole" ? 42 : 34, reason === "blackhole" ? 320 : 250);
  burst(satellite.x, satellite.y, "#ffffff", 12, 120);
  satellite.trail = [];
  screenShake = reason === "blackhole" ? 1 : 0.72;
  dangerPulse = reason === "blackhole" ? 0.72 : 0.36;
}

function burst(x, y, color, count, force) {
  for (let i = 0; i < count; i += 1) {
    const a = Math.random() * TAU;
    const s = randomBetween(force * 0.3, force);
    particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      r: randomBetween(1.5, 4.5),
      color,
      life: randomBetween(0.35, 0.8),
      maxLife: 0.8,
    });
  }
}

function update(dt) {
  time += dt;
  runTime += dt;
  timerEl.textContent = formatRunTime(runTime);
  targetPlanet.x += targetPlanet.vx * dt;
  targetPlanet.y += targetPlanet.vy * dt;
  camera.x += (currentPlanet.x - camera.x) * Math.min(1, dt * 3.2);
  camera.y += (currentPlanet.y - camera.y) * Math.min(1, dt * 3.2);

  if (state === "orbiting") {
    satellite.angle += satellite.orbitDir * satellite.orbitSpeed * dt;
    const pos = satelliteOrbitPosition();
    satellite.x = pos.x;
    satellite.y = pos.y;
    perfectWindow = alignmentQuality();
    launchBtn.classList.toggle("ready", perfectWindow > 0.78);
  }

  if (state === "flying") {
    if (homingActiveThisLaunch) {
      const homingTarget = nearestHomingPlanet();
      const steer = norm(homingTarget.x - satellite.x, homingTarget.y - satellite.y);
      const speed = Math.hypot(satellite.vx, satellite.vy) || 1;
      const current = norm(satellite.vx, satellite.vy);
      const mix = Math.min(1, dt * 2.35);
      const blended = norm(
        current.x * (1 - mix) + steer.x * mix,
        current.y * (1 - mix) + steer.y * mix
      );
      satellite.vx = blended.x * speed;
      satellite.vy = blended.y * speed;
    }

    satellite.x += satellite.vx * dt;
    satellite.y += satellite.vy * dt;
    satellite.trail.push({ x: satellite.x, y: satellite.y });
    if (satellite.trail.length > 36) satellite.trail.shift();

    if (homingPickup) {
      homingPickup.bob += dt * 3.2;
      const dPickup = Math.hypot(satellite.x - homingPickup.x, satellite.y - homingPickup.y);
      if (dPickup < homingPickup.r + 10) {
        homingCharges = 1;
        fadeObject("pickup", { ...homingPickup }, 0.24);
        homingPickup = null;
        burst(satellite.x, satellite.y, "#6fffb7", 22, 170);
        playTone(610, 0.08, "triangle", 0.03);
        updateHud();
      }
    }

    const dTarget = Math.hypot(satellite.x - targetPlanet.x, satellite.y - targetPlanet.y);
    if (dTarget < targetPlanet.gravity) {
      capture(targetPlanet);
    }

    for (const hole of hazards) {
      const dHole = Math.hypot(satellite.x - hole.x, satellite.y - hole.y);
      if (dHole < hole.r) {
        dangerPulse = 0.4;
        lose("blackhole");
      } else if (dHole < hole.pull) {
        const pull = (hole.pull - dHole) / hole.pull;
        satellite.vx += (hole.x - satellite.x) * pull * dt * 1.5;
        satellite.vy += (hole.y - satellite.y) * pull * dt * 1.5;
      }
    }

    if (wormhole && wormhole.cooldown <= 0) {
      const dWorm = Math.hypot(satellite.x - wormhole.x, satellite.y - wormhole.y);
      if (dWorm < wormhole.r) {
        routeThroughWormhole();
        wormhole.cooldown = 1.5;
        burst(wormhole.x, wormhole.y, "#9b7cff", 22, 180);
        playTone(380, 0.09, "square", 0.025);
      }
    }

    const drift = Math.hypot(satellite.x - currentPlanet.x, satellite.y - currentPlanet.y);
    if (drift > 1180) lose("miss");
  }

  if (state === "dying") {
    deathTimer += dt;
    updateDeathFragments(dt);
    if (deathTimer > 0.82) {
      state = "lost";
      overlay.classList.remove("hidden");
    }
  }

  emitEngineSparks(dt);
  updateEngineSparks(dt);
  if (wormhole) wormhole.cooldown = Math.max(0, wormhole.cooldown - dt);
  updateObjectLifecycles(dt);
  particles.forEach((p) => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.life -= dt;
  });
  particles = particles.filter((p) => p.life > 0);
  capturePulse = Math.max(0, capturePulse - dt);
  dangerPulse = Math.max(0, dangerPulse - dt);
  screenShake = Math.max(0, screenShake - dt * 3.6);
}

function updateDeathFragments(dt) {
  deathFragments.forEach((fragment) => {
    fragment.x += fragment.vx * dt;
    fragment.y += fragment.vy * dt;
    fragment.vx *= 0.982;
    fragment.vy *= 0.982;
    fragment.rot += fragment.spin * dt;
    fragment.life -= dt;
  });
  deathFragments = deathFragments.filter((fragment) => fragment.life > 0);
}

function updateObjectLifecycles(dt) {
  currentPlanet.birth = Math.min(1, (currentPlanet.birth ?? 1) + dt * 3.6);
  targetPlanet.birth = Math.min(1, (targetPlanet.birth ?? 1) + dt * 3.6);
  hazards.forEach((hole) => {
    hole.birth = Math.min(1, (hole.birth ?? 1) + dt * 3.8);
  });
  if (wormhole) wormhole.birth = Math.min(1, (wormhole.birth ?? 1) + dt * 3.8);
  if (homingPickup) homingPickup.birth = Math.min(1, (homingPickup.birth ?? 1) + dt * 4.2);

  fadingObjects.forEach((item) => {
    item.age += dt;
  });
  fadingObjects = fadingObjects.filter((item) => item.age < item.duration);
}

function emitEngineSparks(dt) {
  const heat = Math.min(1, score / 18);
  if (score < 2 || (state !== "flying" && state !== "orbiting")) return;

  const flyingBoost = state === "flying" ? 1.55 : 1;
  sparkAccumulator += dt * (13 + heat * 36) * flyingBoost;
  while (sparkAccumulator >= 1) {
    sparkAccumulator -= 1;
    if (engineSparks.length > 130) break;
    const angle = state === "flying" ? Math.atan2(satellite.vy, satellite.vx) : satellite.angle;
    const back = { x: -Math.cos(angle), y: -Math.sin(angle) };
    const side = { x: -Math.sin(angle), y: Math.cos(angle) };
    const jitter = randomBetween(-7 - heat * 4, 7 + heat * 4);
    const speed = randomBetween(34, 88 + heat * 92);
    const size = randomBetween(1.7, 4.8 + heat * 4.2);
    const life = randomBetween(0.34, 0.7 + heat * 0.16);
    const hot = heat > 0.52 || Math.random() < heat;

    engineSparks.push({
      x: satellite.x + back.x * (18 + heat * 8) + side.x * jitter,
      y: satellite.y + back.y * (18 + heat * 8) + side.y * jitter,
      vx: back.x * speed + side.x * randomBetween(-18, 18),
      vy: back.y * speed + side.y * randomBetween(-18, 18),
      r: size,
      life,
      maxLife: life,
      color: hot ? "#ffd166" : "#ff8a2a",
    });
  }
}

function updateEngineSparks(dt) {
  engineSparks.forEach((spark) => {
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
    spark.vx *= 0.96;
    spark.vy *= 0.96;
    spark.life -= dt;
  });
  engineSparks = engineSparks.filter((spark) => spark.life > 0);
}

function alignmentQuality() {
  const from = satelliteOrbitPosition();
  const dir = launchVectorFor(satellite.angle);
  const tx = targetPlanet.x - from.x;
  const ty = targetPlanet.y - from.y;
  const projection = tx * dir.x + ty * dir.y;
  if (projection < 60) return 0;
  const closestX = from.x + dir.x * projection;
  const closestY = from.y + dir.y * projection;
  const miss = Math.hypot(targetPlanet.x - closestX, targetPlanet.y - closestY);
  return Math.max(0, 1 - miss / targetPlanet.gravity);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawSpace();
  drawPlanet(targetPlanet, true);
  drawHazards();
  if (wormhole) drawWormhole(wormhole);
  if (homingPickup) drawHomingPickup(homingPickup);
  drawFadingObjects();
  drawPlanet(currentPlanet, false);
  drawLaunchGuide();
  drawTrail();
  drawEngineSparks();
  if (state !== "dying") drawSatellite();
  drawDeathFragments();
  drawParticles();
  drawScreenEffects();
}

function spawnScale(object) {
  return easeOutBack(object.birth ?? 1);
}

function fadeScale(item) {
  return Math.max(0.03, 1 - easeIn(item.age / item.duration));
}

function fadeAlpha(item) {
  return 1 - clamp01(item.age / item.duration);
}

function drawFadingObjects() {
  for (const item of fadingObjects) {
    const scale = fadeScale(item);
    const alpha = fadeAlpha(item);
    if (item.type === "planet") drawPlanet(item.object, item.object.isTargetVisual ?? true, scale, alpha);
    if (item.type === "hazard") drawHazard(item.object, scale, alpha);
    if (item.type === "wormhole") drawWormhole(item.object, scale, alpha);
    if (item.type === "pickup") drawHomingPickup(item.object, scale, alpha);
  }
}

function drawSpace() {
  if (backgroundCanvas.width) {
    ctx.drawImage(backgroundCanvas, 0, 0);
  } else {
    ctx.fillStyle = "#050611";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.save();
  for (let i = 0; i < stars.length; i += 4) {
    const star = stars[i];
    const driftX = ((star.x - camera.x * star.depth) % canvas.width + canvas.width) % canvas.width;
    const driftY = ((star.y - camera.y * star.depth) % canvas.height + canvas.height) % canvas.height;
    ctx.globalAlpha = star.alpha * 0.45 * (0.7 + Math.sin(time * star.twinkle + star.x) * 0.18);
    ctx.beginPath();
    ctx.arc(driftX, driftY, Math.max(0.6, star.r * 0.72), 0, TAU);
    ctx.fillStyle = star.tint;
    ctx.fill();
  }
  ctx.restore();
}

function drawStarGrid(targetCtx = ctx) {
  const spacing = 92;
  const offsetX = 0;
  const offsetY = 0;

  targetCtx.save();
  targetCtx.globalAlpha = 0.13;
  targetCtx.lineWidth = 1;
  targetCtx.strokeStyle = "rgba(166, 140, 255, 0.14)";
  for (let x = offsetX; x < backgroundCanvas.width; x += spacing) {
    targetCtx.beginPath();
    targetCtx.moveTo(x, 0);
    targetCtx.lineTo(x, backgroundCanvas.height);
    targetCtx.stroke();
  }
  for (let y = offsetY; y < backgroundCanvas.height; y += spacing) {
    targetCtx.beginPath();
    targetCtx.moveTo(0, y);
    targetCtx.lineTo(backgroundCanvas.width, y);
    targetCtx.stroke();
  }
  targetCtx.restore();
}

function drawPlanet(planet, isTarget, scale = spawnScale(planet), alpha = 1) {
  const p = toScreen(planet);
  const gravityPulse = isTarget ? Math.sin(time * 3.2) * 3 : capturePulse * 28;
  const bodyRadius = view(planet.r) * scale;
  const gravityRadius = view(planet.gravity + gravityPulse) * scale;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.save();
  ctx.shadowColor = isTarget ? "rgba(97, 234, 255, 0.28)" : "rgba(166, 140, 255, 0.24)";
  ctx.shadowBlur = isTarget ? 24 : 18;
  ctx.beginPath();
  ctx.arc(p.x, p.y, gravityRadius, 0, TAU);
  ctx.strokeStyle = isTarget ? "rgba(97, 234, 255, 0.42)" : "rgba(166, 140, 255, 0.28)";
  ctx.lineWidth = isTarget ? 2 : 1.5;
  ctx.setLineDash(isTarget ? [2, 10] : [7, 13]);
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(p.x, p.y, view(planet.orbit) * scale, 0, TAU);
  ctx.strokeStyle = isTarget ? "rgba(97, 234, 255, 0.12)" : "rgba(166, 140, 255, 0.36)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, view(planet.r * 4) * scale);
  glow.addColorStop(0, planet.color.glow);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(p.x, p.y, view(planet.r * 4) * scale, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate((planet.x + planet.y) * 0.003 + time * (planet.golden ? 0.45 : 0.16));
  if (isTarget || planet.golden) {
    ctx.globalAlpha = planet.golden ? 0.58 : 0.28;
    ctx.strokeStyle = planet.golden ? "rgba(255, 246, 200, 0.62)" : "rgba(214, 251, 255, 0.42)";
    ctx.lineWidth = view(2);
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyRadius * 1.75, bodyRadius * 0.45, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, bodyRadius, 0, TAU);
  ctx.clip();

  const body = ctx.createRadialGradient(
    p.x - bodyRadius * 0.35,
    p.y - bodyRadius * 0.42,
    bodyRadius * 0.08,
    p.x,
    p.y,
    bodyRadius * 1.18
  );
  body.addColorStop(0, "#ffffff");
  body.addColorStop(0.16, planet.golden ? "#fff6c8" : planet.color.core);
  body.addColorStop(0.68, planet.color.core);
  body.addColorStop(1, "#15142d");
  ctx.fillStyle = body;
  ctx.fillRect(p.x - bodyRadius, p.y - bodyRadius, bodyRadius * 2, bodyRadius * 2);

  ctx.globalAlpha = 0.2;
  ctx.fillStyle = "#ffffff";
  for (let i = -2; i <= 2; i += 1) {
    ctx.beginPath();
    ctx.ellipse(
      p.x + Math.sin(time * 0.3 + i) * bodyRadius * 0.16,
      p.y + i * bodyRadius * 0.32,
      bodyRadius * 0.92,
      bodyRadius * 0.06,
      Math.sin(i) * 0.18,
      0,
      TAU
    );
    ctx.fill();
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(p.x, p.y, bodyRadius, 0, TAU);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.38)";
  ctx.shadowColor = planet.color.glow;
  ctx.shadowBlur = 16;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(p.x - bodyRadius * 0.3, p.y - bodyRadius * 0.34, bodyRadius * 0.25, 0, TAU);
  ctx.fillStyle = "rgba(255, 255, 255, 0.42)";
  ctx.fill();

  if (isTarget) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-time * 0.7);
    ctx.strokeStyle = "rgba(97, 234, 255, 0.48)";
    ctx.lineWidth = 2;
    ctx.setLineDash([bodyRadius * 0.32, bodyRadius * 0.2]);
    ctx.beginPath();
    ctx.arc(0, 0, gravityRadius * 0.72, -0.9, 1.6);
    ctx.stroke();
    ctx.restore();
  }

  if (planet.golden) {
    ctx.fillStyle = "#fff6c8";
    ctx.font = "900 18px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("+3", p.x, p.y - view(planet.gravity) - 12);
  }

  ctx.restore();
}

function drawLaunchGuide() {
  if (state !== "orbiting") return;
  const from = satelliteOrbitPosition();
  const dir = launchVectorFor(satellite.angle);
  const start = toScreen(from);
  const end = toScreen({ x: from.x + dir.x * 900, y: from.y + dir.y * 900 });
  const quality = alignmentQuality();
  const homingReady = homingCharges > 0;

  ctx.save();
  ctx.shadowColor = homingReady
    ? "rgba(111, 255, 183, 0.48)"
    : quality > 0.78 ? "rgba(97, 234, 255, 0.42)" : "rgba(166, 140, 255, 0.24)";
  ctx.shadowBlur = homingReady || quality > 0.78 ? 18 : 10;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.strokeStyle = homingReady
    ? "rgba(111, 255, 183, 0.82)"
    : quality > 0.78 ? "rgba(97, 234, 255, 0.82)" : "rgba(166, 140, 255, 0.46)";
  ctx.lineWidth = homingReady || quality > 0.78 ? 3 : 2;
  ctx.setLineDash(homingReady ? [4, 10] : [10, 16]);
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = 0.72;
  ctx.beginPath();
  ctx.arc(end.x, end.y, 4, 0, TAU);
  ctx.fillStyle = homingReady ? "#6fffb7" : quality > 0.78 ? "#61eaff" : "#a68cff";
  ctx.fill();
  ctx.restore();
}

function drawSatellite() {
  const p = toScreen(satellite);
  const angle = state === "flying" ? Math.atan2(satellite.vy, satellite.vx) : satellite.angle;
  const heat = Math.min(1, score / 20);

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  ctx.shadowColor = heat > 0.2 ? `rgba(255, ${150 + Math.round(heat * 70)}, 42, 0.88)` : "rgba(166, 140, 255, 0.9)";
  ctx.shadowBlur = 18 + heat * 20;

  ctx.beginPath();
  ctx.ellipse(view(-5), 0, view(22), view(14), 0, 0, TAU);
  ctx.fillStyle = heat > 0.5 ? "rgba(255, 177, 68, 0.15)" : "rgba(166, 140, 255, 0.16)";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(view(17), 0);
  ctx.lineTo(view(-10), view(-8));
  ctx.lineTo(view(-6), 0);
  ctx.lineTo(view(-10), view(8));
  ctx.closePath();
  ctx.fillStyle = heat > 0.55 ? "#fff5dd" : "#ffffff";
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(view(4), 0);
  ctx.lineTo(view(-8), view(-4));
  ctx.lineTo(view(-5), 0);
  ctx.lineTo(view(-8), view(4));
  ctx.closePath();
  ctx.fillStyle = "#61eaff";
  ctx.globalAlpha = 0.75;
  ctx.fill();
  ctx.restore();
}

function drawDeathFragments() {
  if (state !== "dying" && !deathFragments.length) return;

  const center = toScreen(satellite);
  const ringProgress = clamp01(deathTimer / 0.58);
  if (state === "dying") {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = (1 - ringProgress) * 0.72;
    ctx.beginPath();
    ctx.arc(center.x, center.y, view(18 + ringProgress * 92), 0, TAU);
    ctx.strokeStyle = deathReason === "blackhole" ? "#ff5277" : "#ffd166";
    ctx.lineWidth = 4 * (1 - ringProgress) + 1;
    ctx.stroke();

    ctx.globalAlpha = (1 - ringProgress) * 0.16;
    ctx.beginPath();
    ctx.arc(center.x, center.y, view(26 + ringProgress * 135), 0, TAU);
    ctx.fillStyle = deathReason === "blackhole" ? "#ff5277" : "#ff8a2a";
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (const fragment of deathFragments) {
    const p = toScreen(fragment);
    const alpha = clamp01(fragment.life / fragment.maxLife);
    const size = view(fragment.size) * (0.75 + alpha * 0.55);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(fragment.rot);
    ctx.shadowColor = fragment.color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = fragment.color;
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.45, -size * 0.62);
    ctx.lineTo(-size * 0.2, size * 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawEngineSparks() {
  if (!engineSparks.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (const spark of engineSparks) {
    const p = toScreen(spark);
    const alpha = Math.max(0, spark.life / spark.maxLife);
    const heatSize = view(spark.r);
    const tail = toScreen({
      x: spark.x - spark.vx * 0.038,
      y: spark.y - spark.vy * 0.038,
    });

    ctx.globalAlpha = alpha * 0.34;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = spark.color === "#ffd166" ? "#ffd166" : "#ff7a1a";
    ctx.lineWidth = Math.max(1, heatSize * 1.7);
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, heatSize * 3.1, 0, TAU);
    ctx.fillStyle = spark.color === "#ffd166"
      ? "rgba(255, 209, 102, 0.22)"
      : "rgba(255, 138, 42, 0.2)";
    ctx.fill();

    ctx.globalAlpha = alpha * 0.92;
    ctx.beginPath();
    ctx.arc(p.x, p.y, heatSize, 0, TAU);
    ctx.fillStyle = spark.color;
    ctx.fill();
  }
  ctx.restore();
}

function drawTrail() {
  if (state !== "flying") return;
  if (satellite.trail.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = "rgba(166, 140, 255, 0.36)";
  ctx.shadowBlur = 14;
  for (let i = 1; i < satellite.trail.length; i += 1) {
    const a = i / satellite.trail.length;
    const p0 = toScreen(satellite.trail[i - 1]);
    const p1 = toScreen(satellite.trail[i]);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.strokeStyle = `rgba(166, 140, 255, ${a * 0.5})`;
    ctx.lineWidth = 1.5 + a * 5;
    ctx.stroke();
  }
  ctx.restore();
}

function drawHazards() {
  for (const hole of hazards) {
    drawHazard(hole);
  }
}

function drawHazard(hole, scale = spawnScale(hole), alpha = 1) {
  const p = toScreen(hole);
  ctx.save();
  ctx.globalAlpha = alpha;
  const pull = ctx.createRadialGradient(p.x, p.y, view(hole.r) * 0.4 * scale, p.x, p.y, view(hole.pull) * scale);
  pull.addColorStop(0, "rgba(255, 82, 119, 0.3)");
  pull.addColorStop(0.45, "rgba(255, 82, 119, 0.08)");
  pull.addColorStop(1, "rgba(255, 82, 119, 0)");
  ctx.fillStyle = pull;
  ctx.beginPath();
  ctx.arc(p.x, p.y, view(hole.pull) * scale, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(-time * 2.4);
  ctx.strokeStyle = "rgba(255, 151, 98, 0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 0, view(hole.r * 1.55) * scale, view(hole.r * 0.58) * scale, 0, 0, TAU);
  ctx.stroke();
  ctx.rotate(1.15);
  ctx.strokeStyle = "rgba(255, 82, 119, 0.38)";
  ctx.beginPath();
  ctx.ellipse(0, 0, view(hole.r * 1.35) * scale, view(hole.r * 0.5) * scale, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(p.x, p.y, view(hole.r + Math.sin(time * 6) * 2) * scale, 0, TAU);
  ctx.fillStyle = "#020208";
  ctx.shadowColor = "#ff5277";
  ctx.shadowBlur = 22;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255, 82, 119, 0.86)";
  ctx.stroke();
  ctx.restore();
}

function drawWormhole(hole, scale = spawnScale(hole), alpha = 1) {
  const p = toScreen(hole);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y);
  ctx.rotate(time * 2.2);
  ctx.shadowColor = "rgba(166, 140, 255, 0.72)";
  ctx.shadowBlur = 22;
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath();
    ctx.ellipse(0, 0, view(hole.r + i * 7) * scale, view(hole.r * 0.42 + i * 4) * scale, 0, 0, TAU);
    ctx.strokeStyle = `rgba(${i % 2 ? "97, 234, 255" : "166, 140, 255"}, ${0.48 - i * 0.07})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, view(hole.r * 0.34) * scale, 0, TAU);
  ctx.fillStyle = "rgba(251, 248, 255, 0.82)";
  ctx.fill();
  ctx.restore();
}

function drawHomingPickup(pickup, scale = spawnScale(pickup), alpha = 1) {
  const p = toScreen(pickup);
  const wobble = Math.sin(pickup.bob) * 3;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y + wobble);
  ctx.rotate(time * 1.6);
  ctx.shadowColor = "rgba(111, 255, 183, 0.68)";
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(0, 0, view(pickup.r + 10) * scale, 0, TAU);
  ctx.fillStyle = "rgba(111, 255, 183, 0.14)";
  ctx.fill();
  ctx.strokeStyle = "rgba(111, 255, 183, 0.42)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  for (let i = 0; i < 4; i += 1) {
    ctx.rotate(TAU / 4);
    ctx.beginPath();
    ctx.moveTo(0, view(-7) * scale);
    ctx.lineTo(view(6) * scale, 0);
    ctx.lineTo(0, view(7) * scale);
    ctx.lineTo(view(-6) * scale, 0);
    ctx.closePath();
    ctx.strokeStyle = i % 2 === 0 ? "#6fffb7" : "#5de7ff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, view(8) * scale, 0, TAU);
  ctx.fillStyle = "#dcfff3";
  ctx.fill();
  ctx.restore();
}

function drawParticles() {
  ctx.save();
  for (const particle of particles) {
    const p = toScreen(particle);
    ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
    ctx.beginPath();
    ctx.arc(p.x, p.y, particle.r, 0, TAU);
    ctx.fillStyle = particle.color;
    ctx.fill();
  }
  ctx.restore();
}

function drawScreenEffects() {
  if (homingCharges > 0 && state === "orbiting") {
    const pulse = 0.045 + Math.sin(time * 3.4) * 0.018;
    ctx.fillStyle = `rgba(91, 255, 180, ${pulse})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const c = screenCenter();
    const glow = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, canvas.width * 0.62);
    glow.addColorStop(0, "rgba(111, 255, 183, 0)");
    glow.addColorStop(0.72, "rgba(111, 255, 183, 0)");
    glow.addColorStop(1, "rgba(111, 255, 183, 0.16)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (dangerPulse > 0) {
    ctx.fillStyle = `rgba(255, 82, 119, ${dangerPulse * 0.22})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function loop(now = 0) {
  const dt = Math.min(0.033, (now - lastTime) / 1000 || 0);
  lastTime = now;
  if (state !== "ready" && state !== "lost") update(dt);
  draw();
  requestAnimationFrame(loop);
}

function playTone(freq, duration, type = "sine", volume = 0.025) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const audio = playTone.context || new AudioContext();
  playTone.context = audio;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + duration);
}

function buildStars() {
  const area = Math.max(1, (canvas.width * canvas.height) / (960 * 960));
  const count = Math.min(180, Math.max(90, Math.round(105 * area)));
  stars = Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 1.8 + 0.25,
    alpha: Math.random() * 0.72 + 0.22,
    depth: Math.random() * 0.13 + 0.025,
    twinkle: Math.random() * 2 + 1,
    tint: Math.random() > 0.82 ? "#d7fbff" : Math.random() > 0.7 ? "#fff0c8" : "#ffffff",
  }));

  const colors = [
    "rgba(97, 234, 255, 0.16)",
    "rgba(166, 140, 255, 0.18)",
    "rgba(255, 129, 173, 0.11)",
    "rgba(255, 209, 102, 0.08)",
  ];
  nebulae = Array.from({ length: 5 }, (_, i) => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: randomBetween(canvas.width * 0.14, canvas.width * 0.32),
    alpha: randomBetween(0.34, 0.64),
    depth: randomBetween(0.008, 0.035),
    speed: randomBetween(0.08, 0.18),
    seed: Math.random() * 100 + i,
    color: colors[i % colors.length],
  }));
  renderBackground();
}

function renderBackground() {
  backgroundCanvas.width = canvas.width;
  backgroundCanvas.height = canvas.height;
  const c = { x: backgroundCanvas.width / 2, y: backgroundCanvas.height / 2 };
  const grd = backgroundCtx.createRadialGradient(
    c.x,
    c.y,
    0,
    c.x,
    c.y,
    Math.max(backgroundCanvas.width, backgroundCanvas.height) * 0.78
  );
  grd.addColorStop(0, "#101737");
  grd.addColorStop(0.48, "#080b1d");
  grd.addColorStop(1, "#02030b");
  backgroundCtx.fillStyle = grd;
  backgroundCtx.fillRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);

  backgroundCtx.save();
  backgroundCtx.globalCompositeOperation = "screen";
  for (const cloud of nebulae) {
    const glow = backgroundCtx.createRadialGradient(cloud.x, cloud.y, 0, cloud.x, cloud.y, cloud.r);
    glow.addColorStop(0, cloud.color);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    backgroundCtx.globalAlpha = cloud.alpha;
    backgroundCtx.fillStyle = glow;
    backgroundCtx.beginPath();
    backgroundCtx.arc(cloud.x, cloud.y, cloud.r, 0, TAU);
    backgroundCtx.fill();
  }
  backgroundCtx.restore();

  drawStarGrid(backgroundCtx);

  backgroundCtx.save();
  for (const star of stars) {
    backgroundCtx.globalAlpha = star.alpha * 0.8;
    backgroundCtx.beginPath();
    backgroundCtx.arc(star.x, star.y, star.r, 0, TAU);
    backgroundCtx.fillStyle = star.tint;
    backgroundCtx.fill();
  }
  backgroundCtx.restore();
}

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const width = Math.max(320, rect.width || window.innerWidth);
  const height = Math.max(320, rect.height || window.innerHeight);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  if (!stars.length) buildStars();
}

function safeLaunch(event) {
  event.preventDefault();
  launch();
}

startBtn.addEventListener("click", resetGame);
launchBtn.addEventListener("click", safeLaunch);
stage.addEventListener("pointerdown", safeLaunch);

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    launch();
  }
});

window.addEventListener("resize", () => {
  stars = [];
  nebulae = [];
  resizeCanvas();
});

resizeCanvas();
currentPlanet = newPlanet(0, 0, { r: 42, gravity: 112, orbit: 72, color: palette[1], birth: 1 });
targetPlanet = newPlanet(360, -120, { gravity: 108, color: palette[0], birth: 1 });
satellite = { x: 0, y: -72, vx: 0, vy: 0, angle: -Math.PI / 2, orbitDir: 1, orbitSpeed: 1.65, trail: [] };
requestAnimationFrame(loop);
